import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { accessToken, cloud, readCallablePolicy } from './wispi-bonus-claim-release-cloud.mjs';
import { root, inventory, normalize, resourceFields, resourceValue, sha, sourceUrl, zipInventory } from './prepare-wispi-market-release.mjs';

// Read-only production source/configuration audit and local release preparation.
// Deploy only the two named functions from their prepared directories.
const audit = path.join(root, 'output/wispi-ranking-pages-20261123');
const baseline = '2924a27bc0eef64717d029d776660812b8cf3511';
const names = ['getStudentWisStockRanking', 'publishWisStockDailyRanking'];
const changedFile = 'wisStockDailyRanking.js';
const mode = process.argv[2];
assert.ok(['snapshot', 'prepare', 'before', 'after'].includes(mode));
const token = await accessToken();
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const configuration = value => ({
  runtime: value.buildConfig.runtime,
  resources: Object.fromEntries(resourceFields.map(field => [field, resourceValue(value.serviceConfig, field)])),
  allTrafficOnLatestRevision: value.serviceConfig.allTrafficOnLatestRevision,
  environmentHash: sha(JSON.stringify(value.serviceConfig.environmentVariables || {})),
  secretEnvironmentHash: sha(JSON.stringify(value.serviceConfig.secretEnvironmentVariables || [])),
  eventTrigger: value.eventTrigger || null,
});
const groups = [];
for (const name of names) {
  const metadata = (await cloud(`https://cloudfunctions.googleapis.com/v2/projects/history-quiz-yongsin/locations/us-central1/functions/${name}`, token)).json();
  assert.equal(metadata.state, 'ACTIVE');
  assert.equal(metadata.buildConfig.runtime, 'nodejs22');
  const source = metadata.buildConfig.source.storageSource;
  const config = configuration(metadata);
  const iam = await readCallablePolicy(token, metadata);
  const directory = path.join(audit, name);
  const release = path.join(directory, 'release');
  const originalPath = path.join(directory, 'original.json');
  if (mode === 'snapshot') {
    await fs.mkdir(directory, { recursive: true });
    try { await fs.access(originalPath); throw new Error('An original snapshot already exists; do not overwrite it'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const bytes = (await cloud(sourceUrl(source), token)).body;
    const entries = await zipInventory(bytes);
    const live = entries.find(entry => entry.path === changedFile);
    assert.ok(live);
    assert.equal(normalize(live.body.toString()), normalize(execFileSync('git', ['show', `${baseline}:functions/${changedFile}`], { cwd: root, encoding: 'utf8' })), 'Review unexpected production source changes first');
    await fs.writeFile(path.join(directory, 'original.zip'), bytes);
    await fs.writeFile(originalPath, JSON.stringify({ source, updateTime: metadata.updateTime, configuration: config, iam, archiveSha: sha(bytes) }, null, 2));
    console.log(JSON.stringify({ name, snapshotted: true, fileCount: entries.length, matchesBaseline: baseline }));
    continue;
  }
  const original = await json(originalPath);
  if (mode === 'prepare') {
    assert.deepEqual(source, original.source, 'Concurrent deployment detected');
    assert.equal(metadata.updateTime, original.updateTime);
    assert.deepEqual(config, original.configuration);
    assert.deepEqual(iam, original.iam);
    const bytes = await fs.readFile(path.join(directory, 'original.zip'));
    assert.equal(sha(bytes), original.archiveSha);
    const entries = await zipInventory(bytes);
    await fs.mkdir(release); // Refuse stale preparation or accidental source mixing.
    const expected = [];
    for (const entry of entries) {
      const body = entry.path === changedFile ? await fs.readFile(path.join(root, 'functions', changedFile)) : entry.body;
      const destination = path.join(release, 'functions', entry.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, body);
      expected.push({ path: entry.path, sha256: sha(body) });
    }
    await fs.writeFile(path.join(release, 'firebase.json'), JSON.stringify({ functions: {
      source: 'functions', codebase: 'default', runtime: 'nodejs22',
      ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'],
    } }, null, 2));
    await fs.writeFile(path.join(release, 'manifest.json'), JSON.stringify({ name, expected, changedFiles: [changedFile] }, null, 2));
    assert.deepEqual(await inventory(path.join(release, 'functions')), expected);
    execFileSync(process.execPath, ['--check', path.join(release, 'functions', changedFile)]);
    groups.push({ name, directory: release });
    console.log(JSON.stringify({ name, prepared: release, changedFiles: [changedFile], fileCount: expected.length }));
    continue;
  }
  const manifest = await json(path.join(release, 'manifest.json'));
  assert.deepEqual(await inventory(path.join(release, 'functions')), manifest.expected);
  assert.equal(sha(await fs.readFile(path.join(root, 'functions', changedFile))), manifest.expected.find(entry => entry.path === changedFile)?.sha256, 'Prepared handler differs from the reviewed workspace');
  assert.deepEqual(config, original.configuration, 'Runtime or configuration changed');
  assert.deepEqual(iam, original.iam, 'IAM changed');
  if (mode === 'before') {
    assert.deepEqual(source, original.source, 'Concurrent deployment detected');
    assert.equal(metadata.updateTime, original.updateTime);
  } else {
    const entries = await zipInventory((await cloud(sourceUrl(source), token)).body);
    assert.deepEqual(entries.map(({ body, ...entry }) => entry), manifest.expected, 'Deployed source differs');
  }
  const report = { name, mode, checkedAt: new Date().toISOString(), revision: metadata.serviceConfig.revision, sourceAndConfigurationMatch: true };
  await fs.writeFile(path.join(directory, `verified-${mode}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
if (mode === 'prepare') await fs.writeFile(path.join(audit, 'groups.json'), JSON.stringify(groups, null, 2));
