import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { accessToken } from './prepare-wis-stock-schedule-release.mjs';
import { readCloud, sourceUrl, zipInventory, inventory, sha, normalize, resourceFields, resourceValue } from './prepare-wispi-market-release.mjs';

// Snapshot the target's current source; change only its read-only response module.
// Never deploys, invokes a student account query, or changes runtime settings.
export { accessToken, readCloud, sourceUrl, zipInventory, inventory, sha, resourceFields, resourceValue };
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const audit = path.join(root, 'output/wispi-holdings-20261117/release');
export const baseline = '328029eb6d32c5ed72c25cd1ae11d2b005602760';
export const project = 'history-quiz-yongsin';
export const region = 'us-central1';
export const targetName = 'getWisStockInvestmentHistory';
export const unchangedName = 'getStudentWisStockHistory';
export const changedFiles = ['wisStockInvestmentHistory.js'];
export const functionUrl = name => `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${region}/functions/${name}`;

async function main() {
  assert.ok(process.argv.slice(2).every(value => value === '--snapshot-only'), 'Unsupported preparation option');
  assert.equal(path.resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim()).toLowerCase(), root.toLowerCase());
  const token = await accessToken();
  const [metadata, unchanged] = await Promise.all([targetName, unchangedName].map(async name => (await readCloud(functionUrl(name), token)).json()));
  assert.equal(metadata.state, 'ACTIVE');
  assert.equal(metadata.buildConfig.runtime, 'nodejs22');
  assert.equal(metadata.buildConfig.entryPoint, targetName);
  const storage = metadata.buildConfig.source.storageSource;
  assert.ok(storage.bucket && storage.object && /^\d+$/.test(String(storage.generation)), 'Versioned source required');
  const snapshotDirectory = path.join(audit, 'originals', String(storage.generation));
  await fs.mkdir(snapshotDirectory, { recursive: true });
  let bytes;
  try { bytes = await fs.readFile(path.join(snapshotDirectory, 'source.zip')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    bytes = Buffer.from(await (await readCloud(sourceUrl(storage), token)).arrayBuffer());
  }
  const entries = await zipInventory(bytes), originalInventory = entries.map(({ body, ...entry }) => entry);
  const byName = new Map(entries.map(entry => [entry.path, entry]));
  for (const file of changedFiles) {
    const before = execFileSync('git', ['show', `${baseline}:functions/${file}`], { cwd: root, encoding: 'utf8' });
    assert.equal(normalize(byName.get(file)?.body.toString('utf8') || ''), normalize(before), `Unreviewed target module: ${file}`);
  }
  assert.ok(byName.get('index.js')?.body.toString('utf8').includes("require('./wisStockTradingExports')"), 'Unexpected live entrypoint');
  assert.ok(byName.get('wisStockTradingExports.js')?.body.toString('utf8').includes(targetName), 'Missing live target export');
  try { assert.deepEqual(JSON.parse(await fs.readFile(path.join(snapshotDirectory, 'inventory.json'), 'utf8')), originalInventory, 'Versioned archive changed'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.writeFile(path.join(snapshotDirectory, 'source.zip'), bytes);
  await fs.writeFile(path.join(snapshotDirectory, 'metadata.json'), JSON.stringify(metadata, null, 2));
  await fs.writeFile(path.join(snapshotDirectory, 'inventory.json'), JSON.stringify(originalInventory, null, 2));
  console.log(JSON.stringify({ preservedTarget: targetName, sourceFiles: entries.length, generation: storage.generation }));
  if (process.argv.includes('--snapshot-only')) return;

  const patches = new Map(await Promise.all(changedFiles.map(async file => [file, await fs.readFile(path.join(root, 'functions', file))])));
  for (const [file, body] of patches) assert.notEqual(sha(body), byName.get(file).sha256, `Missing patch: ${file}`);
  const key = sha(JSON.stringify([originalInventory, [...patches].map(([file, body]) => [file, sha(body)])])).slice(0, 20);
  const directory = path.join(audit, 'prepared', key), destination = path.join(directory, 'functions');
  for (const entry of entries) {
    const file = path.join(destination, entry.path);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, patches.get(entry.path) || entry.body);
  }
  const expected = originalInventory.map(entry => ({ ...entry, sha256: patches.has(entry.path) ? sha(patches.get(entry.path)) : entry.sha256 }));
  assert.deepEqual(await inventory(destination), expected, 'Prepared file set differs');
  assert.deepEqual(expected.filter((entry, index) => entry.sha256 !== originalInventory[index].sha256).map(entry => entry.path), changedFiles);
  for (const file of changedFiles) execFileSync(process.execPath, ['--check', path.join(destination, file)]);
  const manifest = { schemaVersion: 1, baseline, project, region, targetName, changedFiles,
    sourceStorage: storage, runtime: metadata.buildConfig.runtime, serviceConfig: metadata.serviceConfig,
    unchangedFunction: { name: unchangedName, sourceStorage: unchanged.buildConfig.source.storageSource, serviceConfig: unchanged.serviceConfig },
    originalInventory, expectedHashes: Object.fromEntries(expected.map(entry => [entry.path, entry.sha256])),
    preservedFiles: originalInventory.length - changedFiles.length, productionWrites: 0,
    deploymentCommand: `firebase deploy --only functions:${targetName} --project ${project} --config firebase.json` };
  await fs.writeFile(path.join(directory, 'firebase.json'), JSON.stringify({ functions: {
    source: 'functions', codebase: 'default', ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'],
  } }, null, 2));
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(audit, 'prepared.json'), JSON.stringify({ directory, ...manifest }, null, 2));
  console.log(JSON.stringify({ directory, targetName, changedFiles, preservedFiles: manifest.preservedFiles }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
