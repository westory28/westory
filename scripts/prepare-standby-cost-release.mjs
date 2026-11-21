import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { accessToken, functionUrl, readCloud, resourceFields, resourceValue, root, sha, sourceUrl, zipInventory } from './prepare-wispi-market-release.mjs';

const release = path.join(root, 'output/server-usage-20261121/standby');
const targets = [
  { name: 'commandYutRoomFast', file: 'index.js', declaration: 'exports.commandYutRoomFast = onCall({' },
  { name: 'executeWisCommandFast', file: 'productionGateway/commandGateway.js', declaration: 'executeWisCommandFast: onCall({' },
  { name: 'getWisRankingPreview', file: 'wisRankingPreview.js', declaration: 'exports.getWisRankingPreview = onCallWithStudentMaintenance(' },
];
const token = accessToken();
const mode = process.argv[2];
assert.ok(['prepare', 'preflight', 'verify'].includes(mode));
const requested = process.argv.slice(3);
for (const name of requested) assert.ok(targets.some(target => target.name === name), name);
for (const { name, file, declaration } of targets.filter(target => !requested.length || requested.includes(target.name))) {
  const dir = path.join(release, name);
  const manifest = path.join(dir, 'manifest.json');
  const metadata = await (await readCloud(functionUrl(name), token)).json();
  assert.equal(metadata.state, 'ACTIVE', name);
  const source = metadata.buildConfig.source.storageSource;
  const generation = String(source.generation);
  if (mode === 'preflight') {
    const expected = JSON.parse(await fs.readFile(manifest, 'utf8'));
    assert.equal(generation, expected.generation, name);
    assert.equal(metadata.updateTime, expected.updateTime, name);
    continue;
  }
  const entries = await zipInventory(Buffer.from(await (await readCloud(sourceUrl(source), token)).arrayBuffer()));
  if (mode === 'verify') {
    const expected = JSON.parse(await fs.readFile(manifest, 'utf8'));
    assert.deepEqual(Object.fromEntries(entries.map(entry => [entry.path, entry.sha256])), expected.hashes, name);
    for (const field of resourceFields) {
      assert.equal(resourceValue(metadata.serviceConfig, field), field === 'minInstanceCount' ? 0 : resourceValue(expected.resource, field), name + '/' + field);
    }
    for (const field of ['environmentVariables', 'secretEnvironmentVariables', 'allTrafficOnLatestRevision']) {
      assert.deepEqual(metadata.serviceConfig[field], expected.resource[field], name + '/' + field);
    }
    assert.equal(metadata.buildConfig.runtime, expected.runtime);
    console.log(name, metadata.state, 'min=0', metadata.serviceConfig.revision);
    continue;
  }
  assert.equal(metadata.serviceConfig.minInstanceCount, 1, name);
  // Refuse to reuse a partial or stale package, even if the previous source had fewer files.
  await fs.mkdir(release, { recursive: true });
  await fs.mkdir(dir);
  const hashes = {};
  let changed = 0;
  for (const entry of entries) {
    let body = entry.body;
    if (entry.path === file) {
      const original = body.toString('utf8');
      assert.equal(original.split(declaration).length, 2, name);
      const start = original.indexOf(declaration);
      const end = original.indexOf('}', start);
      const options = original.slice(start, end);
      assert.equal(options.split('minInstances: 1').length, 2, name);
      body = Buffer.from(original.slice(0, start) + options.replace('minInstances: 1', 'minInstances: 0') + original.slice(end));
      changed++;
    }
    const output = path.join(dir, 'functions', entry.path);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, body);
    hashes[entry.path] = sha(body);
  }
  assert.equal(changed, 1);
  await fs.writeFile(path.join(dir, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', runtime: metadata.buildConfig.runtime } }));
  await fs.writeFile(manifest, JSON.stringify({ generation, updateTime: metadata.updateTime, hashes, resource: metadata.serviceConfig, runtime: metadata.buildConfig.runtime }));
  console.log(name, 'prepared', entries.length, 'files; one configuration value changed');
}
