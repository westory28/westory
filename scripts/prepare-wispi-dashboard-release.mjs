import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readCloud, sourceUrl, zipInventory, inventory, sha, normalize, resourceValue } from './prepare-wispi-market-release.mjs';
import { accessToken } from './prepare-wis-stock-schedule-release.mjs';
export { accessToken };

// Read-only snapshots and isolated packages; never deploys or changes market data.
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const audit = path.join(root, 'output/wispi-dashboard-20261116/release');
export const baseline = '687ee767855d2dcdf45d0a0d9eb0621484abcfa5';
export const priorBaseline = 'fa749dff82326d44e9350722f7cb736b61fd9f57';
export const project = 'history-quiz-yongsin', region = 'us-central1';
export const managementNames = ['advanceWisStockPrices', 'getWisStockManagement', 'saveWisStock',
  'saveWisStockMarketRules', 'setWisStockMarketHalted', 'activateWisStockCatalogPlan'];
export const tradingNames = ['getStudentWisStockState', 'getStudentWisStockHistory', 'transferStudentWisStock',
  'placeStudentWisStockOrder', 'cancelStudentWisStockOrder', 'settleWisStockOrderTask',
  'onWisStockOrderCreated', 'onWisStockMarketTradingWrite', 'onWisStockEnrollmentSlotWritten', 'recoverWisStockOrders'];
export const targetNames = [...managementNames, ...tradingNames];
export const changedFiles = ['wisStocks.js', 'wisStockMarketRules.mjs'];
export const supportFiles = ['wisStockIndex.js', 'wisStockCatalogSchedule.js', 'wisStockCatalog.json'];
export const functionUrl = name => `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${region}/functions/${name}`;
export const schedulerUrl = name => `https://cloudscheduler.googleapis.com/v1/projects/${project}/locations/${region}/jobs/firebase-schedule-${name}-${region}`;
const baselineText = (file, commit = baseline) => execFileSync('git', ['show', `${commit}:functions/${file}`], { cwd: root, encoding: 'utf8' });
export function assertRuntime(metadata) {
  const name = metadata.name.split('/').at(-1);
  assert(targetNames.includes(name));
  assert.equal(metadata.state, 'ACTIVE', name);
  assert.equal(metadata.buildConfig.runtime, 'nodejs22', name);
  const expected = { availableMemory: '256Mi', availableCpu: '1', minInstanceCount: 0,
    maxInstanceCount: name === 'settleWisStockOrderTask' ? 5 : ['advanceWisStockPrices', 'recoverWisStockOrders'].includes(name) ? 1 : 10,
    maxInstanceRequestConcurrency: tradingNames.includes(name) ? 40 : 80, timeoutSeconds: 60 };
  for (const [field, value] of Object.entries(expected)) assert.equal(field === 'availableCpu'
    ? String(metadata.serviceConfig[field]) : resourceValue(metadata.serviceConfig, field), value, `${name}/${field}`);
}
function assertOriginal(name, entries) {
  const files = new Map(entries.map(entry => [entry.path, entry.body.toString('utf8')]));
  const allowedBaselines = managementNames.includes(name) ? [baseline] : [baseline, priorBaseline];
  const matched = allowedBaselines.find(commit => normalize(files.get('wisStocks.js') || '') === normalize(baselineText('wisStocks.js', commit)));
  assert.ok(matched, `Unreviewed live source: ${name}/wisStocks.js`);
  assert.equal(normalize(files.get('wisStockMarketRules.mjs') || ''), normalize(baselineText('wisStockMarketRules.mjs')), `${name}/rules`);
  for (const file of supportFiles.filter(file => file !== 'wisStockIndex.js')) if (files.has(file))
    assert.equal(normalize(files.get(file)), normalize(baselineText(file)), `${name}/${file}`);
  assert.ok(!files.has('wisStockIndex.js'), `${name}: index module already deployed; review the new baseline`);
  const index = files.get('index.js') || '';
  assert(index.includes("require('./wisStocks').createWisStockHandlers"));
  assert(index.includes("require('./wisStockTradingExports')"));
  const expected = managementNames.filter(item => item !== 'activateWisStockCatalogPlan' || index.includes('exports.activateWisStockCatalogPlan'));
  assert.deepEqual([...index.matchAll(/exports\.(\w+)\s*=/g)].map(match => match[1]).sort(), expected.sort(), `${name}: unrelated entrypoint exports`);
  return matched;
}
async function main() {
  assert(process.argv.slice(2).every(value => value === '--snapshot-only'));
  assert.equal(path.resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim()).toLowerCase(), root.toLowerCase());
  const token = await accessToken(), snapshots = [], downloads = new Map();
  await fs.mkdir(audit, { recursive: true });
  let cursor = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < targetNames.length) {
      const name = targetNames[cursor++], metadata = await (await readCloud(functionUrl(name), token)).json();
      assertRuntime(metadata);
      const source = metadata.buildConfig.source.storageSource;
      assert(source.bucket && source.object && /^\d+$/.test(String(source.generation)));
      const directory = path.join(audit, 'originals', `${name}--${region}`, String(source.generation));
      await fs.mkdir(directory, { recursive: true });
      let bytes;
      try { bytes = await fs.readFile(path.join(directory, 'source.zip')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const url = sourceUrl(source);
        if (!downloads.has(url)) downloads.set(url, readCloud(url, token).then(response => response.arrayBuffer()).then(Buffer.from));
        bytes = await downloads.get(url);
      }
      const entries = await zipInventory(bytes), matchedBaseline = assertOriginal(name, entries);
      const originalInventory = entries.map(({ body, ...entry }) => entry);
      try { assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'inventory.json'), 'utf8')), originalInventory); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.writeFile(path.join(directory, 'source.zip'), bytes);
      await fs.writeFile(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2));
      await fs.writeFile(path.join(directory, 'inventory.json'), JSON.stringify(originalInventory, null, 2));
      await fs.writeFile(path.join(directory, 'index.js'), entries.find(entry => entry.path === 'index.js').body);
      snapshots.push({ name, metadata, directory, entries, originalInventory, matchedBaseline });
      console.log(`Preserved ${name}: ${entries.length} files; ${matchedBaseline.slice(0, 8)}`);
    }
  }));
  snapshots.sort((a, b) => a.name.localeCompare(b.name));
  await fs.writeFile(path.join(audit, 'snapshots.json'), JSON.stringify(snapshots.map(({ entries, ...snapshot }) => snapshot), null, 2));
  const schedulers = [];
  for (const name of ['advanceWisStockPrices', 'recoverWisStockOrders']) {
    const job = await (await readCloud(schedulerUrl(name), token)).json();
    assert.equal(job.schedule, name === 'advanceWisStockPrices' ? '0 * * * *' : 'every 5 minutes');
    assert.equal(job.timeZone, 'Asia/Seoul'); assert.equal(job.state, 'ENABLED');
    schedulers.push({ name, job });
  }
  await fs.writeFile(path.join(audit, 'schedulers-before.json'), JSON.stringify(schedulers, null, 2));
  if (process.argv.includes('--snapshot-only')) return;
  const patches = new Map(await Promise.all([...changedFiles, ...supportFiles].map(async file => [file, await fs.readFile(path.join(root, 'functions', file))])));
  const groups = new Map();
  for (const snapshot of snapshots) {
    const key = sha(JSON.stringify([snapshot.originalInventory, [...patches].map(([file, body]) => [file, sha(body)])])).slice(0, 20);
    if (!groups.has(key)) groups.set(key, { key, entries: snapshot.entries, originalInventory: snapshot.originalInventory, targets: [] });
    groups.get(key).targets.push({ name: snapshot.name, region, runtime: snapshot.metadata.buildConfig.runtime,
      serviceConfig: snapshot.metadata.serviceConfig, eventTrigger: snapshot.metadata.eventTrigger || null,
      sourceStorage: snapshot.metadata.buildConfig.source.storageSource, snapshotDirectory: snapshot.directory, matchedBaseline: snapshot.matchedBaseline });
  }
  const prepared = [];
  for (const group of groups.values()) {
    const directory = path.join(audit, 'prepared', group.key), destination = path.join(directory, 'functions');
    const entries = new Map(group.entries.map(entry => [entry.path, entry.body]));
    const added = supportFiles.filter(file => !entries.has(file));
    for (const [file, body] of patches) entries.set(file, body);
    for (const [file, body] of entries) {
      const filename = path.join(destination, file);
      await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, body);
    }
    const expected = [...entries].map(([file, body]) => ({ path: file, sha256: sha(body) })).sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(await inventory(destination), expected);
    for (const file of ['index.js', ...changedFiles, ...supportFiles.filter(file => file.endsWith('.js'))])
      execFileSync(process.execPath, ['--check', path.join(destination, file)]);
    const changed = group.originalInventory.filter(entry => sha(entries.get(entry.path)) !== entry.sha256).map(entry => entry.path);
    assert(changed.every(file => [...changedFiles, ...supportFiles].includes(file)), 'Unrelated original source changed');
    const names = group.targets.map(target => target.name);
    const deploymentBatches = names.includes('advanceWisStockPrices')
      ? [['advanceWisStockPrices'], names.filter(name => name !== 'advanceWisStockPrices')].filter(batch => batch.length)
      : [names];
    const manifest = { schemaVersion: 1, project, baseline, directory, targets: group.targets, changed, added,
      originalInventory: group.originalInventory, expectedHashes: Object.fromEntries(expected.map(entry => [entry.path, entry.sha256])), productionWrites: 0,
      deploymentBatches,
      deploymentCommands: deploymentBatches.map(batch => `firebase deploy --only "${batch.map(name => `functions:${name}`).join(',')}" --project ${project} --config firebase.json`) };
    await fs.writeFile(path.join(directory, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', codebase: 'default',
      ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'] } }, null, 2));
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
    prepared.push(manifest);
  }
  for (const [file, body] of patches) assert.equal(sha(await fs.readFile(path.join(root, 'functions', file))), sha(body), `Source changed during preparation: ${file}`);
  prepared.sort((a, b) => Number(b.targets.some(target => target.name === 'advanceWisStockPrices')) - Number(a.targets.some(target => target.name === 'advanceWisStockPrices')));
  await fs.writeFile(path.join(audit, 'prepared.json'), JSON.stringify(prepared, null, 2));
  console.log(JSON.stringify(prepared.map(({ directory, targets, changed, added, deploymentCommands }) =>
    ({ directory, targets: targets.map(target => target.name), changed, added, deploymentCommands })), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
