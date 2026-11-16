import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { root, audit, baseline, project, region, targetNames, changedFiles, functionUrl,
  schedulerUrl, schedulerConfiguration, accessToken, readCloud, sourceUrl, zipInventory,
  inventory, sha, assertRuntime, resourceFields, resourceValue } from './prepare-wispi-volatility-release.mjs';

// Read-only: local package, current cloud baseline, or post-deploy source/resources.
assert.ok(process.argv.slice(2).every(value => ['--local-only', '--after'].includes(value)), 'Unsupported argument');
const localOnly = process.argv.includes('--local-only'), after = process.argv.includes('--after');
assert.ok(!(localOnly && after), '--after requires cloud verification');
const groups = JSON.parse(await fs.readFile(path.join(audit, 'prepared.json'), 'utf8'));
assert.equal(groups.length, 1, 'Expected one scheduler package');
const group = groups[0], directory = path.resolve(group.directory);
assert.equal(group.schemaVersion, 1); assert.equal(group.baseline, baseline); assert.equal(group.project, project);
assert.deepEqual(group.targets.map(target => target.name), targetNames);
assert.deepEqual(group.changes, changedFiles); assert.deepEqual(group.added, []);
assert.ok(directory.startsWith(path.join(audit, 'prepared') + path.sep), 'Package outside release scope');
assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')),
  Object.fromEntries(Object.entries(group).filter(([key]) => key !== 'directory')), 'Manifest mismatch');
const expected = Object.entries(group.expectedHashes).map(([file, hash]) => ({ path: file, sha256: hash })).sort((a, b) => a.path.localeCompare(b.path));
assert.deepEqual(await inventory(path.join(directory, 'functions')), expected, 'Prepared package changed');
assert.deepEqual(expected.map(entry => entry.path), group.originalInventory.map(entry => entry.path), 'Original file inventory changed');
for (const original of group.originalInventory) if (!changedFiles.includes(original.path))
  assert.equal(group.expectedHashes[original.path], original.sha256, `Out-of-scope change: ${original.path}`);
for (const file of changedFiles) assert.equal(sha(await fs.readFile(path.join(root, 'functions', file))), group.expectedHashes[file], `Repository changed: ${file}`);
const target = group.targets[0]; assert.equal(target.region, region);
const result = { name: target.name, region, packageMatches: true, preservedFiles: group.preservedFiles };
if (!localOnly) {
  const token = accessToken(), metadata = await (await readCloud(functionUrl(target.name), token)).json();
  assertRuntime(metadata);
  assert.equal(metadata.buildConfig.runtime, target.runtime);
  assert.equal(metadata.buildConfig.entryPoint, target.name);
  for (const field of resourceFields) assert.deepEqual(resourceValue(metadata.serviceConfig, field), resourceValue(target.serviceConfig, field), `${target.name}/${field}`);
  if (after) {
    const bytes = Buffer.from(await (await readCloud(sourceUrl(metadata.buildConfig.source.storageSource), token)).arrayBuffer());
    const entries = await zipInventory(bytes);
    assert.deepEqual(entries.map(({ body, ...entry }) => entry), expected, 'Deployed source differs from reviewed package');
  } else assert.deepEqual(metadata.buildConfig.source.storageSource, target.sourceStorage, 'Live baseline changed; prepare again');
  const scheduler = await (await readCloud(schedulerUrl, token)).json();
  assert.deepEqual(schedulerConfiguration(scheduler), group.schedulerConfig, 'Scheduler configuration changed');
  Object.assign(result, { state: metadata.state, runtimeMatches: true, sourceMatches: true, schedulerMatches: true });
}
const mode = localOnly ? 'local-only' : after ? 'post-deploy' : 'pre-deploy';
const report = { mode, baseline, project, productionWrites: 0, results: [result] };
await fs.writeFile(path.join(audit, `verification-${mode}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
