import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { accessToken, cloud, readCallablePolicy } from './wispi-bonus-claim-release-cloud.mjs';
import { inventory, normalize, resourceFields, resourceValue, sha, sourceUrl, zipInventory } from './prepare-wispi-market-release.mjs';

// Read-only cloud transport and isolated local packaging. The caller must use
// the three explicit function names when deploying; this script never deploys
// or reads/writes weekly plans, rankings, profiles, wallets, or student ledgers.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audit = path.join(root, 'output/weplay-teacher-weekly-20261123');
const release = path.join(audit, 'prepared');
const baseline = '2924a27bc0eef64717d029d776660812b8cf3511';
const names = ['getWeplayWeeklyRewards', 'saveWeplayWeeklyRewards', 'settleWeplayWeeklyRewards'];
const region = 'asia-northeast3';
const filename = 'weplayWeeklyRewards.js';
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const writeJson = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
const functionUrl = name => `https://cloudfunctions.googleapis.com/v2/projects/history-quiz-yongsin/locations/${region}/functions/${name}`;
const schedulerUrl = `https://cloudscheduler.googleapis.com/v1/projects/history-quiz-yongsin/locations/${region}/jobs/firebase-schedule-settleWeplayWeeklyRewards-${region}`;
const configuration = metadata => ({
  runtime: metadata.buildConfig.runtime,
  fields: Object.fromEntries(resourceFields.map(field => [field, resourceValue(metadata.serviceConfig, field)])),
  allTrafficOnLatestRevision: metadata.serviceConfig.allTrafficOnLatestRevision,
  environmentHash: sha(JSON.stringify(metadata.serviceConfig.environmentVariables || {})),
  secretEnvironmentHash: sha(JSON.stringify(metadata.serviceConfig.secretEnvironmentVariables || [])),
  eventTrigger: metadata.eventTrigger || null,
});
const schedulerConfiguration = value => Object.fromEntries(
  ['name', 'state', 'schedule', 'timeZone', 'attemptDeadline', 'retryConfig', 'httpTarget', 'pubsubTarget']
    .map(field => [field, value[field] ?? null]),
);
const selectedNames = process.argv.slice(3);
assert(selectedNames.every(name => names.includes(name)), 'Only the three weekly handlers are allowed');
const mode = process.argv[2];
assert(['prepare', 'before', 'after'].includes(mode), 'Choose prepare, before, or after');
assert(mode !== 'prepare' || selectedNames.length === 0, 'Prepare one reviewed package for all three handlers');
const token = await accessToken();

if (mode === 'prepare') {
  const snapshot = await json(path.join(audit, 'source-snapshot.json'));
  assert.equal(snapshot.baseline, baseline);
  assert.deepEqual(snapshot.reports.map(report => report.name).sort(), [...names].sort());
  const base = normalize(execFileSync('git', ['show', `${baseline}:functions/${filename}`], { cwd: root, encoding: 'utf8' }));
  const updated = Buffer.from(normalize(await fs.readFile(path.join(root, 'functions', filename), 'utf8')));
  assert.notEqual(updated.toString(), base, 'Wait for the reviewed weekly-policy patch before preparing');
  const groups = new Map();
  for (const saved of snapshot.reports) {
    assert.equal(saved.weeklySourceMatchesBaseline, true);
    assert(path.resolve(saved.directory).startsWith(path.resolve(audit) + path.sep));
    const metadata = (await cloud(functionUrl(saved.name), token)).json();
    assert.equal(metadata.state, 'ACTIVE');
    assert.equal(metadata.updateTime, saved.updateTime);
    assert.deepEqual(metadata.buildConfig.source.storageSource, saved.source, `${saved.name}: concurrent deployment`);
    assert.deepEqual(configuration(metadata), saved.configuration);
    assert.equal(sha(JSON.stringify(await readCallablePolicy(token, metadata))), saved.iamHash);
    const bytes = await fs.readFile(path.join(saved.directory, 'source.zip'));
    assert.equal(sha(bytes), saved.archiveSha);
    const entries = await zipInventory(bytes);
    assert.equal(normalize(entries.find(entry => entry.path === filename)?.body.toString() || ''), base);
    const key = sha(JSON.stringify(entries.map(({ body, ...entry }) => entry))).slice(0, 16);
    if (!groups.has(key)) groups.set(key, { key, entries, targets: [] });
    groups.get(key).targets.push(saved);
  }
  const scheduler = schedulerConfiguration((await cloud(schedulerUrl, token)).json());
  assert.equal(sha(JSON.stringify(scheduler)), snapshot.schedulerHash);
  const plans = [];
  await fs.mkdir(release, { recursive: true });
  for (const group of groups.values()) {
    const directory = path.join(release, group.key), functions = path.join(directory, 'functions');
    await fs.mkdir(directory); // Reject stale or partial preparation reuse.
    const expected = [];
    for (const entry of group.entries) {
      const body = entry.path === filename ? updated : entry.body;
      const destination = path.join(functions, entry.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, body);
      expected.push({ path: entry.path, sha256: sha(body) });
    }
    await writeJson(path.join(directory, 'firebase.json'), { functions: {
      source: 'functions', codebase: 'default', runtime: 'nodejs22',
      ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'],
    } });
    assert.deepEqual(await inventory(functions), expected);
    const plan = { directory, expected, targets: group.targets, changed: [filename], patchSha: sha(updated) };
    await writeJson(path.join(directory, 'manifest.json'), plan);
    plans.push(plan);
  }
  assert.equal(sha(Buffer.from(normalize(await fs.readFile(path.join(root, 'functions', filename), 'utf8')))), sha(updated), 'Patch changed during preparation');
  await writeJson(path.join(release, 'plans.json'), { baseline, schedulerHash: snapshot.schedulerHash, plans });
  console.log(JSON.stringify({ prepared: plans.map(plan => ({ directory: plan.directory,
    targets: plan.targets.map(target => target.name), sourceFiles: plan.expected.length, changed: plan.changed })),
    studentDocumentReads: 0, productionWrites: 0 }));
} else {
  const prepared = await json(path.join(release, 'plans.json'));
  assert.equal(prepared.baseline, baseline);
  const reports = [];
  for (const plan of prepared.plans) {
    assert.deepEqual(await inventory(path.join(plan.directory, 'functions')), plan.expected);
    assert.equal(sha(Buffer.from(normalize(await fs.readFile(path.join(root, 'functions', filename), 'utf8')))), plan.patchSha, 'Repository patch changed after preparation');
    for (const saved of plan.targets.filter(target => !selectedNames.length || selectedNames.includes(target.name))) {
      const metadata = (await cloud(functionUrl(saved.name), token)).json();
      assert.equal(metadata.state, 'ACTIVE');
      assert.deepEqual(configuration(metadata), saved.configuration, `${saved.name}: runtime or environment changed`);
      assert.equal(sha(JSON.stringify(await readCallablePolicy(token, metadata))), saved.iamHash, `${saved.name}: IAM changed`);
      if (mode === 'before') {
        assert.deepEqual(metadata.buildConfig.source.storageSource, saved.source, `${saved.name}: concurrent deployment`);
        assert.equal(metadata.updateTime, saved.updateTime);
      } else {
        const entries = await zipInventory((await cloud(sourceUrl(metadata.buildConfig.source.storageSource), token)).body);
        assert.deepEqual(entries.map(({ body, ...entry }) => entry), plan.expected, `${saved.name}: deployed files differ`);
      }
      reports.push({ name: saved.name, state: metadata.state, revision: metadata.serviceConfig.revision,
        generation: metadata.buildConfig.source.storageSource.generation });
    }
  }
  assert.equal(reports.length, selectedNames.length || names.length);
  const scheduler = schedulerConfiguration((await cloud(schedulerUrl, token)).json());
  assert.equal(sha(JSON.stringify(scheduler)), prepared.schedulerHash, 'Scheduler configuration changed');
  const report = { checkedAt: new Date().toISOString(), mode, reports, sourceAndConfigurationMatch: true,
    schedulerConfigurationMatch: true, studentDocumentReads: 0, productionWrites: 0 };
  const suffix = selectedNames.length ? '-' + [...selectedNames].sort().join('-') : '';
  await writeJson(path.join(audit, `verified-${mode}${suffix}.json`), report);
  console.log(JSON.stringify(report));
}
