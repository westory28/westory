import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { root, audit, baseline, project, region, targetName, unchangedName, changedFiles, functionUrl,
  accessToken, readCloud, sourceUrl, zipInventory, inventory, sha, resourceFields, resourceValue } from './prepare-wispi-holdings-release.mjs';

// Read-only package/source/resource verification. No account data is queried.
assert.ok(process.argv.slice(2).every(value => ['--local-only', '--after'].includes(value)), 'Unsupported verification option');
const localOnly = process.argv.includes('--local-only'), after = process.argv.includes('--after');
assert.ok(!(localOnly && after), '--after needs cloud verification');
const prepared = JSON.parse(await fs.readFile(path.join(audit, 'prepared.json'), 'utf8'));
const { directory, ...manifest } = prepared;
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.baseline, baseline);
assert.equal(manifest.project, project);
assert.equal(manifest.region, region);
assert.equal(manifest.targetName, targetName);
assert.deepEqual(manifest.changedFiles, changedFiles);
assert.ok(path.resolve(directory).startsWith(path.join(audit, 'prepared') + path.sep), 'Package outside release directory');
assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')), manifest);
const expected = Object.entries(manifest.expectedHashes).map(([file, hash]) => ({ path: file, sha256: hash })).sort((a, b) => a.path.localeCompare(b.path));
assert.deepEqual(await inventory(path.join(directory, 'functions')), expected, 'Prepared package changed');
assert.deepEqual(expected.map(entry => entry.path), manifest.originalInventory.map(entry => entry.path), 'File inventory changed');
for (const original of manifest.originalInventory) if (!changedFiles.includes(original.path))
  assert.equal(manifest.expectedHashes[original.path], original.sha256, `Unchanged source modified: ${original.path}`);
for (const file of changedFiles) assert.equal(sha(await fs.readFile(path.join(root, 'functions', file))), manifest.expectedHashes[file], `Repository patch changed: ${file}`);
const result = { targetName, mode: localOnly ? 'local-only' : after ? 'post-deploy' : 'pre-deploy',
  packageMatches: true, changedFiles, preservedFiles: manifest.preservedFiles, productionDataReads: 0, productionWrites: 0 };
if (!localOnly) {
  const token = await accessToken();
  const metadata = await (await readCloud(functionUrl(targetName), token)).json();
  assert.equal(metadata.state, 'ACTIVE');
  assert.equal(metadata.buildConfig.runtime, manifest.runtime);
  assert.equal(metadata.buildConfig.entryPoint, targetName);
  // Compare without printing configuration values if an assertion fails.
  for (const field of [...resourceFields, 'environmentVariables', 'secretEnvironmentVariables'])
    assert.ok(isDeepStrictEqual(resourceValue(metadata.serviceConfig, field), resourceValue(manifest.serviceConfig, field)), `Runtime field changed: ${field}`);
  if (after) {
    const entries = await zipInventory(Buffer.from(await (await readCloud(sourceUrl(metadata.buildConfig.source.storageSource), token)).arrayBuffer()));
    assert.deepEqual(entries.map(({ body, ...entry }) => entry), expected, 'Deployed source differs from prepared package');
    const response = await fetch(`https://${region}-${project}.cloudfunctions.net/${targetName}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: {} }), signal: AbortSignal.timeout(60000),
    });
    assert.ok([401, 403].includes(response.status), 'Anonymous history access was not denied');
    result.anonymousStatus = response.status;
  } else assert.deepEqual(metadata.buildConfig.source.storageSource, manifest.sourceStorage, 'Live source changed; prepare again');
  const unchanged = await (await readCloud(functionUrl(unchangedName), token)).json();
  assert.deepEqual(unchanged.buildConfig.source.storageSource, manifest.unchangedFunction.sourceStorage, 'Other history function source changed');
  for (const field of [...resourceFields, 'environmentVariables', 'secretEnvironmentVariables'])
    assert.ok(isDeepStrictEqual(resourceValue(unchanged.serviceConfig, field), resourceValue(manifest.unchangedFunction.serviceConfig, field)), `Other function runtime changed: ${field}`);
  Object.assign(result, { state: metadata.state, sourceMatches: true, runtimeMatches: true, otherHistoryFunctionPreserved: true });
}
await fs.writeFile(path.join(audit, `verification-${result.mode}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
