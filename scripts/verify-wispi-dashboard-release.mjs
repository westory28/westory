import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { audit, root, baseline, project, region, targetNames, managementNames, tradingNames, changedFiles,
  supportFiles, functionUrl, schedulerUrl, accessToken, assertRuntime } from './prepare-wispi-dashboard-release.mjs';
import { readCloud, sourceUrl, zipInventory, inventory, sha, resourceFields, resourceValue } from './prepare-wispi-market-release.mjs';

// Read-only verification before or after deployment. No production data writes.
assert(process.argv.slice(2).every(value => ['--after', '--local-only'].includes(value)));
const after = process.argv.includes('--after'), localOnly = process.argv.includes('--local-only');
assert(!(after && localOnly));
const prepared = JSON.parse(await fs.readFile(path.join(audit, 'prepared.json'), 'utf8'));
assert.deepEqual(prepared.flatMap(group => group.targets.map(target => target.name)).sort(), [...targetNames].sort());
assert.deepEqual(prepared[0].deploymentBatches[0], ['advanceWisStockPrices'], 'Price scheduler must deploy first');
const token = localOnly ? '' : await accessToken(), sourceCache = new Map(), results = [];
for (const group of prepared) {
  assert.equal(group.schemaVersion, 1); assert.equal(group.project, project); assert.equal(group.baseline, baseline);
  assert(group.changed.every(file => [...changedFiles, ...supportFiles].includes(file)));
  assert(group.added.every(file => supportFiles.includes(file)));
  assert.deepEqual(group.deploymentBatches.flat().sort(), group.targets.map(target => target.name).sort());
  const directory = path.resolve(group.directory), sourceDirectory = path.join(directory, 'functions');
  assert(directory.startsWith(path.join(audit, 'prepared') + path.sep));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')), group);
  const expected = Object.entries(group.expectedHashes).map(([file, hash]) => ({ path: file, sha256: hash })).sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(await inventory(sourceDirectory), expected, 'Prepared source changed');
  assert.deepEqual(expected.map(entry => entry.path).sort(), [...group.originalInventory.map(entry => entry.path), ...group.added].sort());
  for (const original of group.originalInventory) if (!group.changed.includes(original.path))
    assert.equal(group.expectedHashes[original.path], original.sha256, `Unrelated production source changed: ${original.path}`);
  for (const file of [...changedFiles, ...supportFiles]) assert.equal(sha(await fs.readFile(path.join(root, 'functions', file))), group.expectedHashes[file], `Repository changed: ${file}`);
  const originalIndex = await fs.readFile(path.join(group.targets[0].snapshotDirectory, 'index.js'));
  assert.equal(sha(await fs.readFile(path.join(sourceDirectory, 'index.js'))), sha(originalIndex), 'Entrypoint changed');
  const endpoints = JSON.parse(execFileSync(process.execPath, ['-e',
    "const e=require('./'); console.log(JSON.stringify(Object.fromEntries(Object.entries(e).map(([n,f])=>[n,f.__endpoint]))));"], {
    cwd: sourceDirectory, encoding: 'utf8', env: { ...process.env, NODE_PATH: path.join(root, 'functions/node_modules'),
      FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-westory-wispi-dashboard-release' }) },
  }));
  const exportsActivation = originalIndex.toString('utf8').includes('exports.activateWisStockCatalogPlan');
  assert.deepEqual(Object.keys(endpoints).sort(), [...tradingNames, ...managementNames.filter(name => exportsActivation || name !== 'activateWisStockCatalogPlan')].sort());
  assert.deepEqual(endpoints.settleWisStockOrderTask.taskQueueTrigger.invoker, ['177587430482-compute@developer.gserviceaccount.com']);
  for (const target of group.targets) assert(endpoints[target.name], `Target absent from entrypoint: ${target.name}`);
  if (localOnly) { results.push({ targets: group.targets.map(target => target.name), files: expected.length, packageMatches: true }); continue; }
  for (const target of group.targets) {
    const metadata = await (await readCloud(functionUrl(target.name), token)).json();
    assertRuntime(metadata);
    for (const field of resourceFields) assert.deepEqual(resourceValue(metadata.serviceConfig, field), resourceValue(target.serviceConfig, field), `${target.name}/${field}`);
    assert.equal(metadata.buildConfig.runtime, target.runtime);
    // Eventarc trigger identifiers and transport topics are managed by Google;
    // compare the semantic trigger and authority fields rather than update metadata.
    for (const field of ['eventType', 'triggerRegion', 'serviceAccountEmail', 'retryPolicy'])
      assert.deepEqual(metadata.eventTrigger?.[field] ?? null, target.eventTrigger?.[field] ?? null, `${target.name}/eventTrigger/${field}`);
    const filters = trigger => [...(trigger?.eventFilters || [])].sort((a, b) => a.attribute.localeCompare(b.attribute));
    assert.deepEqual(filters(metadata.eventTrigger), filters(target.eventTrigger), `${target.name}/eventTrigger/eventFilters`);
    if (after) {
      const sourceKey = sourceUrl(metadata.buildConfig.source.storageSource);
      if (!sourceCache.has(sourceKey)) sourceCache.set(sourceKey, await zipInventory(Buffer.from(await (await readCloud(sourceKey, token)).arrayBuffer())));
      assert.deepEqual(sourceCache.get(sourceKey).map(({ body, ...entry }) => entry), expected, `${target.name}: deployed archive differs`);
    } else assert.deepEqual(metadata.buildConfig.source.storageSource, target.sourceStorage, `${target.name}: live source changed since snapshot`);
    results.push({ name: target.name, region, state: metadata.state, files: expected.length, sourceMatches: true, resourcesMatch: true });
  }
}
if (!localOnly) for (const { name, job: previous } of JSON.parse(await fs.readFile(path.join(audit, 'schedulers-before.json'), 'utf8'))) {
  const job = await (await readCloud(schedulerUrl(name), token)).json();
  for (const key of ['schedule', 'timeZone', 'state']) assert.equal(job[key], previous[key], `${name}/${key}`);
  for (const key of ['uri', 'httpMethod', 'oidcToken', 'oauthToken']) assert.deepEqual(job.httpTarget?.[key], previous.httpTarget?.[key], `${name}/identity/${key}`);
  results.push({ scheduler: name, schedule: job.schedule, state: job.state });
}
const mode = localOnly ? 'local-only' : after ? 'post-deploy' : 'pre-deploy';
const report = { mode, baseline, project, productionWrites: 0, results };
await fs.writeFile(path.join(audit, `verification-${mode}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
