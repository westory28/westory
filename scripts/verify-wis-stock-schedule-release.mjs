import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { audit, root, baseline, project, region, targetNames, newTarget, changedFiles, addedFiles,
  functionUrl, schedulerUrl, patchIndex, accessToken } from './prepare-wis-stock-schedule-release.mjs';
import { readCloud, sourceUrl, zipInventory, inventory, sha, assertRuntime, resourceFields,
  resourceValue } from './prepare-wispi-market-release.mjs';

// Default verifies the package and unchanged live source. --after verifies the
// exact deployed archive, runtime resources, and aligned Cloud Scheduler job.
assert.ok(process.argv.slice(2).every(value => ['--after', '--local-only'].includes(value)), 'Unsupported verification argument');
const after = process.argv.includes('--after'), localOnly = process.argv.includes('--local-only');
assert.ok(!(after && localOnly), '--after requires cloud verification');
const prepared = JSON.parse(await fs.readFile(path.join(audit, 'prepared.json'), 'utf8'));
assert.ok(prepared.length > 0);
assert.deepEqual(prepared.flatMap(group => group.targets.map(target => target.name)).sort(), [...targetNames].sort());
assert.deepEqual(prepared.flatMap(group => group.newTargets), [newTarget]);
const tradingNames = ['getStudentWisStockState', 'getStudentWisStockHistory', 'transferStudentWisStock',
  'placeStudentWisStockOrder', 'cancelStudentWisStockOrder', 'settleWisStockOrderTask',
  'onWisStockOrderCreated', 'onWisStockMarketTradingWrite', 'onWisStockEnrollmentSlotWritten', 'recoverWisStockOrders'];
const token = localOnly ? '' : await accessToken(), sourceCache = new Map(), results = [];
for (const group of prepared) {
  assert.equal(group.schemaVersion, 1);
  assert.equal(group.project, project);
  assert.equal(group.baseline, baseline);
  assert.deepEqual(group.changed, [...changedFiles, 'index.js']);
  assert.deepEqual(group.added, addedFiles);
  const directory = path.resolve(group.directory), sourceDirectory = path.join(directory, 'functions');
  assert.ok(directory.startsWith(path.join(audit, 'prepared') + path.sep), 'Release directory outside expected scope');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')), group);
  const expected = Object.entries(group.expectedHashes).map(([file, hash]) => ({ path: file, sha256: hash })).sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(await inventory(sourceDirectory), expected, 'Prepared source changed after review');
  assert.deepEqual(expected.map(entry => entry.path).sort(), [...group.originalInventory.map(entry => entry.path), ...addedFiles].sort());
  for (const original of group.originalInventory) if (!group.changed.includes(original.path))
    assert.equal(group.expectedHashes[original.path], original.sha256, `Unrelated deployed dependency changed: ${original.path}`);
  for (const file of [...changedFiles, ...addedFiles]) assert.equal(sha(await fs.readFile(path.join(root, 'functions', file))),
    group.expectedHashes[file], `Repository changed after preparing: ${file}`);
  const originalIndex = await fs.readFile(path.join(group.targets[0].snapshotDirectory, 'index.js'), 'utf8');
  assert.equal(await fs.readFile(path.join(sourceDirectory, 'index.js'), 'utf8'), patchIndex(originalIndex));
  const endpoints = JSON.parse(execFileSync(process.execPath, ['-e',
    "const e=require('./'); console.log(JSON.stringify(Object.fromEntries(Object.entries(e).map(([n,f])=>[n,f.__endpoint]))));"], {
    cwd: sourceDirectory, encoding: 'utf8', env: { ...process.env,
      NODE_PATH: path.join(root, 'functions/node_modules'), FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-westory-stock-schedule-release' }) },
  }));
  assert.deepEqual(Object.keys(endpoints).sort(), [...targetNames, ...tradingNames, newTarget].sort());
  assert.equal(endpoints.advanceWisStockPrices.scheduleTrigger.schedule, '0 * * * *');
  assert.equal(endpoints.advanceWisStockPrices.scheduleTrigger.timeZone, 'Asia/Seoul');
  assert.equal(endpoints[newTarget].platform, 'gcfv2');
  assert.deepEqual(endpoints[newTarget].region, [region]);
  assert.ok(endpoints[newTarget].callableTrigger);
  assert.deepEqual(endpoints.settleWisStockOrderTask.taskQueueTrigger.invoker, ['177587430482-compute@developer.gserviceaccount.com']);
  if (localOnly) { results.push({ files: expected.length, packageMatches: true, productionWrites: 0 }); continue; }
  for (const target of [...group.targets, ...(after ? group.newTargets.map(name => ({ name, region })) : [])]) {
    const metadata = await (await readCloud(functionUrl(target.name), token)).json();
    assertRuntime(metadata);
    if (target.serviceConfig) {
      for (const field of resourceFields) assert.deepEqual(resourceValue(metadata.serviceConfig, field),
        resourceValue(target.serviceConfig, field), `${target.name}/${field}`);
      assert.equal(metadata.buildConfig.runtime, target.runtime);
    }
    if (after) {
      const sourceKey = sourceUrl(metadata.buildConfig.source.storageSource);
      if (!sourceCache.has(sourceKey)) sourceCache.set(sourceKey,
        await zipInventory(Buffer.from(await (await readCloud(sourceKey, token)).arrayBuffer())));
      assert.deepEqual(sourceCache.get(sourceKey).map(({ body, ...entry }) => entry), expected,
        `${target.name}: deployed archive differs from the reviewed source`);
    } else assert.deepEqual(metadata.buildConfig.source.storageSource, target.sourceStorage,
      `${target.name}: baseline changed since snapshot; prepare again`);
    results.push({ name: target.name, region, state: metadata.state, files: expected.length, sourceMatches: true, resourcesMatch: true });
  }
}
if (!localOnly) {
  const job = await (await readCloud(schedulerUrl, token)).json();
  const previous = JSON.parse(await fs.readFile(path.join(audit, 'scheduler-before.json'), 'utf8'));
  assert.equal(job.schedule, after ? '0 * * * *' : previous.schedule);
  assert.equal(job.timeZone, 'Asia/Seoul');
  assert.equal(job.state, 'ENABLED');
  for (const key of ['uri', 'httpMethod', 'oidcToken', 'oauthToken'])
    assert.deepEqual(job.httpTarget?.[key], previous.httpTarget?.[key], `Scheduler target/identity changed: ${key}`);
  results.push({ scheduler: 'advanceWisStockPrices', schedule: job.schedule, timeZone: job.timeZone, state: job.state });
}
const mode = localOnly ? 'local-only' : after ? 'post-deploy' : 'pre-deploy';
const report = { mode, baseline, project, productionWrites: 0, results };
await fs.writeFile(path.join(audit, `verification-${mode}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
