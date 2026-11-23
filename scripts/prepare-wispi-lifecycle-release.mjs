import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { accessToken, cloud, readCallablePolicy } from './wispi-bonus-claim-release-cloud.mjs';
import { root, inventory, normalize, resourceFields, resourceValue, sha, sourceUrl, zipInventory } from './prepare-wispi-market-release.mjs';

// Preserve each deployed source archive. Only the two reviewed modules and new
// dependencies change; unrelated files, IAM, environment and resources stay intact.
const audit = path.join(root, 'output/wispi-lifecycle-20261123');
const baseline = '139ad72f4f67cc826a6579922c91b80ac9a2ac65';
const names = ['getWisStockManagement', 'saveWisStock', 'saveWisStockMarketRules',
  'setWisStockMarketHalted', 'activateWisStockCatalogPlan', 'advanceWisStockPrices'];
const addedName = 'activateWisStockCatalogExits';
const changed = ['wisStocks.js', 'wisStockCatalogSchedule.js'];
const added = ['wisStockCatalogTimeline.js', 'wisStockCatalogTimeline.mjs'];
const mode = process.argv[2];
assert.ok(['snapshot', 'prepare', 'before', 'after'].includes(mode));
const token = await accessToken();
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const functionUrl = name => `https://cloudfunctions.googleapis.com/v2/projects/history-quiz-yongsin/locations/us-central1/functions/${name}`;
const config = value => ({ runtime: value.buildConfig.runtime,
  resources: Object.fromEntries(resourceFields.map(field => [field, resourceValue(value.serviceConfig, field)])),
  environmentHash: sha(JSON.stringify(value.serviceConfig.environmentVariables || {})),
  secretHash: sha(JSON.stringify(value.serviceConfig.secretEnvironmentVariables || [])),
  eventTrigger: value.eventTrigger || null });
const groups = new Map();
for (const name of names) {
  const metadata = (await cloud(functionUrl(name), token)).json();
  assert.equal(metadata.state, 'ACTIVE');
  assert.equal(metadata.buildConfig.runtime, 'nodejs22');
  const source = metadata.buildConfig.source.storageSource;
  const directory = path.join(audit, name);
  const originalPath = path.join(directory, 'original.json');
  const iam = await readCallablePolicy(token, metadata);
  if (mode === 'snapshot') {
    await fs.mkdir(directory, { recursive: true });
    try { await fs.access(originalPath); throw new Error('Snapshot exists; refusing overwrite'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const bytes = (await cloud(sourceUrl(source), token)).body;
    const entries = await zipInventory(bytes);
    await fs.writeFile(path.join(directory, 'original.zip'), bytes);
    await fs.writeFile(originalPath, JSON.stringify({ source, updateTime: metadata.updateTime,
      configuration: config(metadata), iam, archiveSha: sha(bytes) }, null, 2));
    console.log(JSON.stringify({ name, files: entries.length,
      baselineMatches: Object.fromEntries(changed.map(file => [file,
        normalize(entries.find(e => e.path === file)?.body.toString() || '') === normalize(
          execFileSync('git', ['show', `${baseline}:functions/${file}`], { cwd: root, encoding: 'utf8' }))])) }));
    continue;
  }
  const original = await json(originalPath);
  assert.deepEqual(config(metadata), original.configuration, `${name} runtime changed`);
  assert.deepEqual(iam, original.iam, `${name} IAM changed`);
  if (mode === 'prepare' || mode === 'before') {
    assert.deepEqual(source, original.source, `${name} concurrently deployed`);
    assert.equal(metadata.updateTime, original.updateTime);
  }
  if (mode === 'prepare') {
    const bytes = await fs.readFile(path.join(directory, 'original.zip'));
    assert.equal(sha(bytes), original.archiveSha);
    const key = sha(bytes).slice(0, 16);
    if (!groups.has(key)) groups.set(key, { key, names: [], bytes });
    groups.get(key).names.push(name);
  } else {
    const releases = await json(path.join(audit, 'releases.json'));
    const release = releases.find(group => group.names.includes(name));
    assert.ok(release);
    const manifest = await json(path.join(release.directory, 'manifest.json'));
    assert.deepEqual(await inventory(path.join(release.directory, 'functions')), manifest.expected);
    for (const file of [...changed, ...added]) assert.equal(
      sha(await fs.readFile(path.join(root, 'functions', file))),
      manifest.expected.find(entry => entry.path === file)?.sha256,
      `Workspace changed after preparation: ${file}`);
    if (mode === 'after') {
      const live = await zipInventory((await cloud(sourceUrl(source), token)).body);
      assert.deepEqual(live.map(({ body, ...entry }) => entry), manifest.expected, `${name} deployed source mismatch`);
    }
    console.log(JSON.stringify({ name, mode, matches: true, revision: metadata.serviceConfig.revision }));
  }
}
if (mode === 'prepare') {
  const releases = [];
  for (const group of groups.values()) {
    const entries = await zipInventory(group.bytes);
    // The read-only management/rules sources predate the already-deployed
    // opening-price change. Both recognized bases were reviewed explicitly.
    const sourceBaseline = [baseline, '1854e214c1b9cd5921dcc1ed12c41b66a31771f5'].find(commit =>
      changed.every(file => normalize(entries.find(e => e.path === file)?.body.toString() || '') ===
        normalize(execFileSync('git', ['show', `${commit}:functions/${file}`], { cwd: root, encoding: 'utf8' }))));
    assert.ok(sourceBaseline, 'Unreviewed production source');
    const directory = path.join(audit, 'prepared-reviewed', group.key);
    await fs.mkdir(directory, { recursive: true });
    await fs.mkdir(path.join(directory, 'functions')); // Refuse stale preparation.
    for (const entry of entries) {
      const destination = path.join(directory, 'functions', entry.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, entry.body);
    }
    for (const file of changed)
      await fs.copyFile(path.join(root, 'functions', file), path.join(directory, 'functions', file));
    for (const file of added) {
      assert.ok(!entries.some(entry => entry.path === file), `Unexpected existing ${file}`);
      await fs.copyFile(path.join(root, 'functions', file), path.join(directory, 'functions', file));
    }
    const indexPath = path.join(directory, 'functions/index.js');
    const index = await fs.readFile(indexPath, 'utf8');
    const handler = index.match(/exports\.activateWisStockCatalogPlan\s*=\s*onCall\(([\s\S]*?),\s*(\w+)\.activateWisStockCatalogPlan\s*\);/);
    assert.ok(handler, 'Existing activation callable export not found');
    assert.ok(!index.includes(addedName));
    await fs.writeFile(indexPath, index + '\n' + handler[0].replaceAll('activateWisStockCatalogPlan', addedName) + '\n');
    const expected = await inventory(path.join(directory, 'functions'));
    const allowed = new Set([...changed, ...added, 'index.js']);
    for (const entry of entries) if (!allowed.has(entry.path))
      assert.equal(expected.find(e => e.path === entry.path)?.sha256, entry.sha256, `Unrelated source changed: ${entry.path}`);
    for (const file of [...changed, ...added, 'index.js'])
      execFileSync(process.execPath, ['--check', path.join(directory, 'functions', file)]);
    for (const file of [...changed, ...added]) assert.equal(
      sha(await fs.readFile(path.join(directory, 'functions', file))),
      sha(await fs.readFile(path.join(root, 'functions', file))), `Prepared module mismatch: ${file}`);
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ expected, allowed: [...allowed], baseline, sourceBaseline }, null, 2));
    await fs.writeFile(path.join(directory, 'firebase.json'), JSON.stringify({ functions: {
      source: 'functions', codebase: 'default', runtime: 'nodejs22',
      ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'],
    } }, null, 2));
    const names = [...group.names, ...(releases.length ? [] : [addedName])];
    releases.push({ directory, names });
    console.log(JSON.stringify({ prepared: directory, names, files: expected.length }));
  }
  await fs.writeFile(path.join(audit, 'releases.json'), JSON.stringify(releases, null, 2));
}
if (mode === 'after') {
  const releases = await json(path.join(audit, 'releases.json'));
  const release = releases.find(group => group.names.includes(addedName));
  const manifest = await json(path.join(release.directory, 'manifest.json'));
  const metadata = (await cloud(functionUrl(addedName), token)).json();
  assert.equal(metadata.state, 'ACTIVE');
  const live = await zipInventory((await cloud(sourceUrl(metadata.buildConfig.source.storageSource), token)).body);
  assert.deepEqual(live.map(({ body, ...entry }) => entry), manifest.expected);
  const original = await json(path.join(audit, 'activateWisStockCatalogPlan/original.json'));
  const template = (await cloud(functionUrl('activateWisStockCatalogPlan'), token)).json();
  const beforeEnv = template.serviceConfig.environmentVariables || {};
  const newEnv = metadata.serviceConfig.environmentVariables || {};
  assert.equal(newEnv.FUNCTION_TARGET, addedName);
  assert.equal(newEnv.EVENTARC_CLOUD_EVENT_SOURCE,
    beforeEnv.EVENTARC_CLOUD_EVENT_SOURCE.replaceAll('activateWisStockCatalogPlan', addedName));
  assert.equal(beforeEnv.FUNCTION_SIGNATURE_TYPE || 'http', 'http');
  assert.equal(newEnv.FUNCTION_SIGNATURE_TYPE || 'http', 'http');
  // The platform derives these three values from the new HTTP function name.
  // Check them above, then compare all user configuration without exclusions.
  const comparableEnv = { ...newEnv };
  for (const key of ['FUNCTION_TARGET', 'EVENTARC_CLOUD_EVENT_SOURCE', 'FUNCTION_SIGNATURE_TYPE']) {
    if (Object.hasOwn(beforeEnv, key)) comparableEnv[key] = beforeEnv[key];
    else delete comparableEnv[key];
  }
  assert.deepEqual(comparableEnv, beforeEnv, 'New callable user environment differs');
  assert.deepEqual(config({ ...metadata, serviceConfig: {
    ...metadata.serviceConfig, environmentVariables: beforeEnv,
  } }), original.configuration);
  assert.deepEqual(await readCallablePolicy(token, metadata), original.iam);
  console.log(JSON.stringify({ name: addedName, mode, matches: true }));
}
const job = (await cloud('https://cloudscheduler.googleapis.com/v1/projects/history-quiz-yongsin/locations/us-central1/jobs/firebase-schedule-advanceWisStockPrices-us-central1', token)).json();
assert.equal(job.schedule, '0,30 * * * *');
assert.equal(job.timeZone, 'Asia/Seoul');
assert.equal(job.state, 'ENABLED');
console.log(JSON.stringify({ schedule: job.schedule, state: job.state }));
