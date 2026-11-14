import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { audit, root, project, region, baseline, targetNames, changedFiles, addedFiles, sha,
  accessToken, readCloud, functionUrl, sourceUrl, zipInventory, inventory, assertExports,
  assertRuntime, resourceFields, resourceValue } from './prepare-wispi-market-release.mjs';

// Default: verify local package + unchanged live baseline. --after checks all
// deployed files and resources. --local-only performs no cloud calls at all.
assert.ok(process.argv.slice(2).every(value => ['--after', '--local-only'].includes(value)), 'Unsupported verification argument');
const after = process.argv.includes('--after'), localOnly = process.argv.includes('--local-only');
assert.ok(!(after && localOnly), '--after requires a live source check');
const groups = JSON.parse(await fs.readFile(path.join(audit, 'prepared.json'), 'utf8'));
assert.ok(groups.length > 0, 'No prepared release');
assert.deepEqual(groups.flatMap(group => group.targets.map(target => target.name)).sort(), [...targetNames].sort(), 'Unexpected deployment scope');
const token = localOnly ? '' : accessToken(), results = [];
for (const group of groups) {
  assert.equal(group.schemaVersion, 1); assert.equal(group.baseline, baseline); assert.equal(group.project, project);
  assert.deepEqual(group.changes, changedFiles); assert.deepEqual(group.added, addedFiles);
  const directory = path.resolve(group.directory);
  assert.ok(directory.startsWith(path.join(audit, 'prepared') + path.sep), 'Prepared directory outside release scope');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')),
    Object.fromEntries(Object.entries(group).filter(([key]) => key !== 'directory')), 'Prepared manifest differs from release summary');
  const expected = Object.entries(group.expectedHashes).map(([file, hash]) => ({ path: file, sha256: hash })).sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(await inventory(path.join(directory, 'functions')), expected, 'Prepared source was modified after review');
  const originalNames = group.originalInventory.map(entry => entry.path);
  assert.deepEqual(expected.map(entry => entry.path).sort(), [...originalNames, ...addedFiles].sort());
  for (const original of group.originalInventory) if (!changedFiles.includes(original.path))
    assert.equal(group.expectedHashes[original.path], original.sha256, `Out-of-scope deployed file changed: ${original.path}`);
  for (const filename of [...changedFiles, ...addedFiles]) assert.equal(
    sha(await fs.readFile(path.join(root, 'functions', filename))), group.expectedHashes[filename], `Repository changed after preparation: ${filename}`);
  assertExports(await fs.readFile(path.join(directory, 'functions/index.js'), 'utf8'));
  for (const target of group.targets) {
    assert.equal(target.region, region);
    const row = { name: target.name, region, packageMatches: true, studentTradingExports: 0 };
    if (!localOnly) {
      const metadata = await (await readCloud(functionUrl(target.name), token)).json();
      assertRuntime(metadata);
      for (const field of resourceFields) assert.deepEqual(resourceValue(metadata.serviceConfig, field), resourceValue(target.serviceConfig, field), `${target.name}/${field}`);
      assert.equal(metadata.buildConfig.runtime, target.runtime);
      if (after) {
        const bytes = Buffer.from(await (await readCloud(sourceUrl(metadata.buildConfig.source.storageSource), token)).arrayBuffer());
        const entries = await zipInventory(bytes);
        assert.deepEqual(entries.map(({ body, ...entry }) => entry), expected, `${target.name}: deployed source differs from reviewed package`);
        assertExports(entries.find(entry => entry.path === 'index.js').body.toString('utf8'));
      } else assert.deepEqual(metadata.buildConfig.source.storageSource, target.sourceStorage, `${target.name}: live baseline changed; prepare again`);
      Object.assign(row, { state: metadata.state, resourcesMatch: true, sourceMatches: true });
    }
    results.push(row);
  }
}
const mode = localOnly ? 'local-only' : after ? 'post-deploy' : 'pre-deploy';
const report = { mode, baseline, project, productionWrites: 0, results };
await fs.writeFile(path.join(audit, `verification-${mode}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
