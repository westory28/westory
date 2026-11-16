import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { accessToken, readCloud, sourceUrl, zipInventory, inventory, sha, normalize,
  assertRuntime, resourceFields, resourceValue } from './prepare-wispi-market-release.mjs';

// Read-only cloud snapshots and a local package. Never invokes the scheduler or deploys.
export { accessToken, readCloud, sourceUrl, zipInventory, inventory, sha, normalize,
  assertRuntime, resourceFields, resourceValue };
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const audit = path.join(root, 'output/wispi-volatility-20261116/release');
export const baseline = 'e6ef7576d785598ade627dd00deb55b1a6c4195d';
export const project = 'history-quiz-yongsin';
export const region = 'us-central1';
export const targetNames = ['advanceWisStockPrices'];
export const changedFiles = ['wisStocks.js', 'wisStockPriceModel.mjs'];
export const functionUrl = name => `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${region}/functions/${name}`;
export const schedulerUrl = `https://cloudscheduler.googleapis.com/v1/projects/${project}/locations/${region}/jobs/firebase-schedule-advanceWisStockPrices-${region}`;
export const schedulerConfiguration = scheduler => Object.fromEntries([
  'name', 'schedule', 'timeZone', 'state', 'attemptDeadline', 'retryConfig', 'httpTarget', 'pubsubTarget',
].map(field => [field, scheduler[field] ?? null]));
const baselineText = file => execFileSync('git', ['show', `${baseline}:functions/${file}`], { cwd: root, encoding: 'utf8' });

async function main() {
  assert.ok(process.argv.slice(2).every(value => value === '--snapshot-only'), 'Only --snapshot-only is supported');
  assert.equal(path.resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim()).toLowerCase(), root.toLowerCase());
  const token = accessToken();
  const name = targetNames[0];
  const metadata = await (await readCloud(functionUrl(name), token)).json();
  assertRuntime(metadata);
  assert.equal(metadata.name, `projects/${project}/locations/${region}/functions/${name}`);
  assert.equal(metadata.buildConfig.entryPoint, name);
  const source = metadata.buildConfig.source.storageSource;
  assert.ok(source.bucket && source.object && /^\d+$/.test(String(source.generation)), 'Missing versioned source');
  const directory = path.join(audit, 'originals', `${name}--${region}`, String(source.generation));
  await fs.mkdir(directory, { recursive: true });
  let bytes;
  try { bytes = await fs.readFile(path.join(directory, 'source.zip')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    bytes = Buffer.from(await (await readCloud(sourceUrl(source), token)).arrayBuffer());
  }
  const entries = await zipInventory(bytes), byName = new Map(entries.map(entry => [entry.path, entry]));
  const dependencies = ['wisStockPriceModel.js', 'wisStockMarketRules.js', 'wisStockMarketRules.mjs',
    'wisStockCatalogSchedule.js', 'wisStockCatalog.json'];
  for (const file of [...changedFiles, ...dependencies]) {
    assert.equal(normalize(byName.get(file)?.body.toString('utf8') || ''), normalize(baselineText(file)), `Unreviewed live difference: ${name}/${file}`);
    if (!changedFiles.includes(file)) assert.equal(normalize(await fs.readFile(path.join(root, 'functions', file), 'utf8')),
      normalize(baselineText(file)), `Out-of-scope dependency changed: ${file}`);
  }
  const index = byName.get('index.js')?.body.toString('utf8') || '';
  assert.ok(index.includes("require('./wisStocks').createWisStockHandlers"), 'Unexpected production entrypoint');
  assert.ok(index.includes('exports.advanceWisStockPrices ='), 'Missing scheduler export');
  const originalInventory = entries.map(({ body, ...entry }) => entry);
  try { assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'inventory.json'), 'utf8')), originalInventory, 'Versioned archive changed'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.writeFile(path.join(directory, 'source.zip'), bytes);
  await fs.writeFile(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2));
  await fs.writeFile(path.join(directory, 'inventory.json'), JSON.stringify(originalInventory, null, 2));
  await fs.writeFile(path.join(directory, 'index.js'), index);
  const scheduler = await (await readCloud(schedulerUrl, token)).json();
  assert.equal(scheduler.schedule, '0 * * * *');
  assert.equal(scheduler.timeZone, 'Asia/Seoul');
  assert.equal(scheduler.state, 'ENABLED');
  const schedulerConfig = schedulerConfiguration(scheduler);
  await fs.writeFile(path.join(audit, 'scheduler-before.json'), JSON.stringify(schedulerConfig, null, 2));
  await fs.writeFile(path.join(audit, 'snapshots.json'), JSON.stringify([{ name, region, directory,
    sourceGeneration: source.generation, sourceInventorySha256: sha(JSON.stringify(originalInventory)) }], null, 2));
  console.log(`Preserved ${name}/${region}: ${entries.length} files; ${changedFiles.length + dependencies.length} baseline modules match; hourly scheduler preserved`);
  if (process.argv.includes('--snapshot-only')) return;

  const patches = new Map(await Promise.all(changedFiles.map(async file => [file, await fs.readFile(path.join(root, 'functions', file))])));
  for (const [file, body] of patches) assert.notEqual(normalize(body.toString('utf8')), normalize(baselineText(file)), `Expected patch is missing: ${file}`);
  const key = sha(JSON.stringify([originalInventory, [...patches].map(([file, body]) => [file, sha(body)])])).slice(0, 20);
  const preparedDirectory = path.join(audit, 'prepared', key), destination = path.join(preparedDirectory, 'functions');
  for (const entry of entries) {
    const file = path.join(destination, entry.path);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, patches.get(entry.path) || entry.body);
  }
  const expected = originalInventory.map(entry => ({ ...entry, sha256: patches.has(entry.path) ? sha(patches.get(entry.path)) : entry.sha256 }));
  assert.deepEqual(await inventory(destination), expected, 'Unexpected file or lost production source');
  for (const file of changedFiles) execFileSync(process.execPath, ['--check', path.join(destination, file)]);
  const manifest = { schemaVersion: 1, baseline, project, changes: changedFiles, added: [],
    targets: [{ name, region, runtime: metadata.buildConfig.runtime, serviceConfig: metadata.serviceConfig,
      sourceStorage: source, sourceGeneration: source.generation, snapshotDirectory: directory }],
    originalInventory, expectedHashes: Object.fromEntries(expected.map(entry => [entry.path, entry.sha256])),
    preservedFiles: originalInventory.length - changedFiles.length, schedulerConfig, productionWrites: 0,
    deploymentCommand: `firebase deploy --only "functions:${name}" --project ${project} --config firebase.json` };
  await fs.writeFile(path.join(preparedDirectory, 'firebase.json'), JSON.stringify({ functions: {
    source: 'functions', codebase: 'default', ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'],
  } }, null, 2));
  await fs.writeFile(path.join(preparedDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  for (const [file, body] of patches) assert.equal(sha(await fs.readFile(path.join(root, 'functions', file))), sha(body), `Source changed during preparation: ${file}`);
  await fs.writeFile(path.join(audit, 'prepared.json'), JSON.stringify([{ directory: preparedDirectory, ...manifest }], null, 2));
  console.log(JSON.stringify({ directory: preparedDirectory, targets: targetNames, changes: changedFiles, preservedFiles: manifest.preservedFiles }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
