import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { accessToken } from './prepare-wis-stock-schedule-release.mjs';
import { readCloud, sourceUrl, zipInventory, inventory, sha, normalize, resourceFields, resourceValue } from './prepare-wispi-market-release.mjs';

// Preserve the live source and deploy only the new, read-only history callable.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audit = path.join(root, 'output/wispi-history-20261117/release');
const directory = path.join(audit, 'prepared');
const project = 'history-quiz-yongsin';
const region = 'us-central1';
const baseline = 'c30f889740350cb683f6530a185c16b388c1a782';
const sourceName = 'getStudentWisStockHistory';
const targetName = 'getWisStockInvestmentHistory';
const changed = ['wisStockTradingExports.js'];
const added = ['wisStockInvestmentHistory.js', 'wisStockInvestmentHistorySeries.mjs'];
const functionUrl = name => `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${region}/functions/${name}`;
const token = await accessToken();
const mode = process.argv[2] || '--prepare';
assert(['--snapshot-only', '--prepare', '--verify'].includes(mode));

if (mode === '--verify') {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
  const expected = Object.entries(manifest.expectedHashes).map(([path, sha256]) => ({ path, sha256 })).sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(await inventory(path.join(directory, 'functions')), expected);
  const metadata = await (await readCloud(functionUrl(targetName), token)).json();
  assert.equal(metadata.state, 'ACTIVE');
  assert.equal(metadata.buildConfig.runtime, 'nodejs22');
  const deployed = await zipInventory(Buffer.from(await (await readCloud(sourceUrl(metadata.buildConfig.source.storageSource), token)).arrayBuffer()));
  assert.deepEqual(deployed.map(({ body, ...entry }) => entry), expected);
  for (const field of resourceFields) assert.equal(resourceValue(metadata.serviceConfig, field), resourceValue(manifest.sourceServiceConfig, field), field);
  const prior = await (await readCloud(functionUrl(sourceName), token)).json();
  assert.deepEqual(prior.buildConfig.source.storageSource, manifest.sourceStorage, 'Existing history function was changed');
  for (const field of resourceFields) assert.equal(resourceValue(prior.serviceConfig, field), resourceValue(manifest.sourceServiceConfig, field), `existing/${field}`);
  const anonymous = await fetch(`https://${region}-${project}.cloudfunctions.net/${targetName}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: {} }), signal: AbortSignal.timeout(60000),
  });
  assert([401, 403].includes(anonymous.status), 'Anonymous history must be denied');
  const result = { targetName, state: metadata.state, runtime: metadata.buildConfig.runtime, files: expected.length, sourceGeneration: metadata.buildConfig.source.storageSource.generation, existingFunctionPreserved: true, anonymousStatus: anonymous.status };
  await fs.writeFile(path.join(audit, 'verified.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} else {
  const metadata = await (await readCloud(functionUrl(sourceName), token)).json();
  assert.equal(metadata.state, 'ACTIVE');
  assert.equal(metadata.buildConfig.runtime, 'nodejs22');
  const source = metadata.buildConfig.source.storageSource;
  const originalDir = path.join(audit, 'originals', String(source.generation));
  await fs.mkdir(originalDir, { recursive: true });
  let bytes;
  try { bytes = await fs.readFile(path.join(originalDir, 'source.zip')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    bytes = Buffer.from(await (await readCloud(sourceUrl(source), token)).arrayBuffer());
    await fs.writeFile(path.join(originalDir, 'source.zip'), bytes);
  }
  const original = await zipInventory(bytes);
  const entries = new Map(original.map(entry => [entry.path, entry.body]));
  for (const file of changed) {
    const reference = execFileSync('git', ['show', `${baseline}:functions/${file}`], { cwd: root, encoding: 'utf8' });
    assert.equal(normalize(entries.get(file)?.toString('utf8') || ''), normalize(reference), `Unreviewed live source: ${file}`);
  }
  assert(entries.get('index.js').toString('utf8').includes("require('./wisStockTradingExports')"));
  await fs.writeFile(path.join(originalDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  await fs.writeFile(path.join(originalDir, 'inventory.json'), JSON.stringify(original.map(({ body, ...entry }) => entry), null, 2));
  console.log(`Preserved ${sourceName}: ${original.length} files; generation ${source.generation}`);
  if (mode === '--prepare') {
    for (const file of added) assert(!entries.has(file), `Unexpected existing module: ${file}`);
    for (const file of [...changed, ...added]) entries.set(file, await fs.readFile(path.join(root, 'functions', file)));
    const destination = path.join(directory, 'functions');
    for (const [file, body] of entries) {
      const filename = path.join(destination, file);
      await fs.mkdir(path.dirname(filename), { recursive: true });
      try { if (sha(await fs.readFile(filename)) === sha(body)) continue; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.writeFile(filename, body);
    }
    const expected = [...entries].map(([file, body]) => ({ path: file, sha256: sha(body) })).sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(await inventory(destination), expected);
    const differences = original.filter(entry => sha(entries.get(entry.path)) !== entry.sha256).map(entry => entry.path);
    assert.deepEqual(differences.sort(), changed.slice().sort());
    for (const file of [...changed, ...added]) execFileSync(process.execPath, ['--check', path.join(destination, file)]);
    assert(entries.get('wisStockTradingExports.js').toString('utf8').includes(targetName));
    await fs.writeFile(path.join(directory, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', codebase: 'default', ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'] } }, null, 2));
    const manifest = { project, region, baseline, targetName, sourceName, directory, changed, added, sourceStorage: source, sourceServiceConfig: metadata.serviceConfig, expectedHashes: Object.fromEntries(expected.map(entry => [entry.path, entry.sha256])) };
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({ directory, targetName, changed, added, files: expected.length, deploy: `firebase deploy --only functions:${targetName} --project ${project}` }));
  }
}
