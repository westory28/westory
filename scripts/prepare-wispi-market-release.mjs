import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

// Read-only cloud snapshots and a local release package. This script never deploys.
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const audit = path.join(root, 'output/wispi-market-20261114/release');
export const project = 'history-quiz-yongsin';
export const region = 'us-central1';
export const baseline = '618cb5eeea1c02ba4c17eda0ae4079f8e5d3a6b7';
export const targetNames = ['advanceWisStockPrices', 'getWisStockManagement', 'saveWisStock',
  'saveWisStockMarketRules', 'setWisStockMarketHalted'];
export const changedFiles = ['wisStocks.js'];
// The .js adapter synchronously requires the .mjs implementation on Node 22.
export const addedFiles = ['wisStockPriceModel.js', 'wisStockPriceModel.mjs'];
export const normalize = value => value.replace(/\r\n/g, '\n');
export const sha = value => createHash('sha256').update(value).digest('hex');
export const resourceFields = ['availableMemory', 'availableCpu', 'timeoutSeconds', 'minInstanceCount',
  'maxInstanceCount', 'maxInstanceRequestConcurrency', 'serviceAccountEmail', 'ingressSettings',
  'vpcConnector', 'vpcConnectorEgressSettings'];
export const resourceValue = (config, field) => field === 'minInstanceCount' ? config[field] || 0 : config[field] ?? null;
export function assertRuntime(metadata) {
  assert.equal(metadata.state, 'ACTIVE', metadata.name);
  assert.equal(metadata.buildConfig.runtime, 'nodejs22', metadata.name);
  const config = metadata.serviceConfig;
  const scheduler = metadata.name.endsWith('/advanceWisStockPrices');
  for (const [field, expected] of Object.entries({ availableMemory: '256Mi', availableCpu: '1',
    minInstanceCount: 0, maxInstanceCount: scheduler ? 1 : 10, maxInstanceRequestConcurrency: 80, timeoutSeconds: 60 })) {
    const actual = field === 'availableCpu' ? String(config[field]) : resourceValue(config, field);
    assert.equal(actual, expected, `${metadata.name}/${field}`);
  }
}
export const accessToken = () => String(execFileSync('cmd.exe', ['/d', '/s', '/c', 'gcloud.cmd auth print-access-token'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).trim();
export async function readCloud(url, token) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
  assert.ok(response.ok, `Read-only source request failed: HTTP ${response.status}`);
  return response;
}
export const functionUrl = name => `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${region}/functions/${name}`;
export const sourceUrl = source => `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(source.bucket)}/o/${encodeURIComponent(source.object)}?alt=media&generation=${encodeURIComponent(source.generation)}`;
export async function zipInventory(bytes) {
  const zip = await JSZip.loadAsync(bytes), entries = [];
  for (const [filename, item] of Object.entries(zip.files)) {
    if (item.dir) continue;
    assert.ok(filename === (item.unsafeOriginalName || filename) && !filename.includes('\\')
      && !path.posix.isAbsolute(filename) && !filename.split('/').some(part => !part || part === '..' || part === '.')
      && !filename.includes(':') && !filename.split('/').includes('node_modules'), `Unsafe source entry: ${filename}`);
    assert.ok((Number(item.unixPermissions || 0) & 0o170000) !== 0o120000, 'Symlink in source archive');
    const body = await item.async('nodebuffer');
    entries.push({ path: filename, sha256: sha(body), body });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}
export async function inventory(directory) {
  const entries = [];
  async function visit(current) {
    for (const item of await fs.readdir(current, { withFileTypes: true })) {
      if (item.name === 'node_modules') continue;
      assert.ok(!item.isSymbolicLink(), 'Symlink in release source');
      const file = path.join(current, item.name);
      if (item.isDirectory()) await visit(file);
      else entries.push({ path: path.relative(directory, file).replaceAll('\\', '/'), sha256: sha(await fs.readFile(file)) });
    }
  }
  await visit(directory);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}
export function assertExports(index) {
  assert.ok(index.includes("require('./wisStocks').createWisStockHandlers("), 'Unexpected production entrypoint');
  assert.deepEqual([...index.matchAll(/exports\.(\w+)\s*=/g)].map(match => match[1]).sort(), [...targetNames].sort());
}
const gitBaseline = filename => execFileSync('git', ['show', `${baseline}:functions/${filename}`], { cwd: root, encoding: 'utf8' });

async function main() {
  assert.ok(process.argv.slice(2).every(value => value === '--snapshot-only'), 'Only --snapshot-only is supported');
  assert.equal(path.resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim()).toLowerCase(), root.toLowerCase());
  const token = accessToken(), snapshots = [];
  await fs.mkdir(audit, { recursive: true });
  let cursor = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < targetNames.length) {
      const name = targetNames[cursor++];
      const metadata = await (await readCloud(functionUrl(name), token)).json();
      assertRuntime(metadata);
      assert.equal(metadata.name, `projects/${project}/locations/${region}/functions/${name}`);
      const source = metadata.buildConfig.source.storageSource;
      assert.ok(source.bucket && source.object && /^\d+$/.test(String(source.generation)), 'Missing versioned source');
      const directory = path.join(audit, 'originals', `${name}--${region}`, String(source.generation));
      await fs.mkdir(directory, { recursive: true });
      const archive = path.join(directory, 'source.zip');
      let bytes;
      try { bytes = await fs.readFile(archive); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        bytes = Buffer.from(await (await readCloud(sourceUrl(source), token)).arrayBuffer());
        await fs.writeFile(archive, bytes);
      }
      const entries = await zipInventory(bytes), sourceInventory = entries.map(({ body, ...entry }) => entry);
      try {
        const captured = JSON.parse(await fs.readFile(path.join(directory, 'inventory.json'), 'utf8'));
        assert.deepEqual(sourceInventory, captured, `Cached original archive changed: ${name}`);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const byName = new Map(entries.map(entry => [entry.path, entry]));
      assertExports(byName.get('index.js').body.toString('utf8'));
      const comparisons = [];
      for (const entry of entries) {
        let local;
        try { local = await fs.readFile(path.join(root, 'functions', entry.path)); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        comparisons.push({ path: entry.path, deployedSha256: entry.sha256,
          repositorySha256: local ? sha(local) : null, repositoryMatches: local ? normalize(local.toString('utf8')) === normalize(entry.body.toString('utf8')) : false });
      }
      for (const filename of changedFiles) assert.equal(normalize(byName.get(filename)?.body.toString('utf8') || ''),
        normalize(gitBaseline(filename)), `Unreviewed live difference from ${baseline}: ${name}/${filename}`);
      for (const filename of addedFiles) assert.ok(!byName.has(filename), `New runtime file already deployed: ${name}/${filename}`);
      // Rules, account and order lifecycle are outside this patch and must stay unchanged.
      for (const prefix of ['wisStockAccount', 'wisStockOrderLifecycle', 'wisStockMarketRules']) for (const extension of ['js', 'mjs']) {
        const filename = `${prefix}.${extension}`, deployed = byName.get(filename);
        assert.ok(deployed, `Missing unchanged runtime module: ${filename}`);
        const local = await fs.readFile(path.join(root, 'functions', filename), 'utf8');
        assert.equal(normalize(deployed.body.toString('utf8')), normalize(gitBaseline(filename)), `Unreviewed production dependency: ${filename}`);
        assert.equal(normalize(local), normalize(gitBaseline(filename)), `Out-of-scope dependency changed: ${filename}`);
      }
      await fs.writeFile(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2));
      await fs.writeFile(path.join(directory, 'inventory.json'), JSON.stringify(sourceInventory, null, 2));
      await fs.writeFile(path.join(directory, 'repository-comparison.json'), JSON.stringify(comparisons, null, 2));
      snapshots.push({ name, metadata, directory, entries, inventory: sourceInventory });
      console.log(`Snapshotted ${name}--${region}: ${entries.length} files; baseline matches`);
    }
  }));
  const ordered = snapshots.sort((a, b) => a.name.localeCompare(b.name));
  await fs.writeFile(path.join(audit, 'snapshots.json'), JSON.stringify(ordered.map(({ name, metadata, directory, inventory: files }) => ({
    name, region, directory, sourceGeneration: metadata.buildConfig.source.storageSource.generation, archiveInventorySha256: sha(JSON.stringify(files)),
  })), null, 2));
  if (process.argv.includes('--snapshot-only')) return;

  const patches = new Map(await Promise.all([...changedFiles, ...addedFiles].map(async filename => [filename, await fs.readFile(path.join(root, 'functions', filename))])));
  assert.ok(patches.get('wisStocks.js').toString('utf8').includes("require('./wisStockPriceModel')"), 'Expected price-model dependency missing');
  assert.ok(patches.get('wisStockPriceModel.js').toString('utf8').includes("require('./wisStockPriceModel.mjs')"), 'Expected shared runtime dependency missing');
  const groups = new Map();
  for (const snapshot of ordered) {
    const key = sha(JSON.stringify([snapshot.inventory, [...patches].map(([file, body]) => [file, sha(body)])])).slice(0, 20);
    if (!groups.has(key)) groups.set(key, { key, entries: snapshot.entries, inventory: snapshot.inventory, targets: [] });
    groups.get(key).targets.push({ name: snapshot.name, region, runtime: snapshot.metadata.buildConfig.runtime,
      serviceConfig: snapshot.metadata.serviceConfig, sourceGeneration: snapshot.metadata.buildConfig.source.storageSource.generation,
      sourceStorage: snapshot.metadata.buildConfig.source.storageSource, snapshotDirectory: snapshot.directory });
  }
  const report = [];
  for (const group of groups.values()) {
    const directory = path.join(audit, 'prepared', group.key), destination = path.join(directory, 'functions');
    await fs.mkdir(destination, { recursive: true });
    for (const entry of group.entries) {
      const filename = path.join(destination, entry.path);
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await fs.writeFile(filename, patches.get(entry.path) || entry.body);
    }
    for (const filename of addedFiles) await fs.writeFile(path.join(destination, filename), patches.get(filename));
    const expectedInventory = group.inventory.map(entry => ({ ...entry, sha256: patches.has(entry.path) ? sha(patches.get(entry.path)) : entry.sha256 }));
    expectedInventory.push(...addedFiles.map(filename => ({ path: filename, sha256: sha(patches.get(filename)) })));
    expectedInventory.sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(await inventory(destination), expectedInventory, 'Unexpected prepared file or lost production source');
    for (const filename of [...changedFiles, ...addedFiles]) execFileSync(process.execPath, ['--check', path.join(destination, filename)]);
    const expectedHashes = Object.fromEntries(expectedInventory.map(entry => [entry.path, entry.sha256]));
    const manifest = { schemaVersion: 1, baseline, project, targets: group.targets, changes: changedFiles, added: addedFiles,
      expectedHashes, originalInventory: group.inventory, preservedFiles: group.inventory.length - changedFiles.length,
      studentTradingExports: 0, productionWrites: 0,
      deploymentCommand: `firebase deploy --only "${group.targets.map(target => `functions:${target.name}`).join(',')}" --project ${project} --config firebase.json` };
    await fs.writeFile(path.join(directory, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', codebase: 'default',
      ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'] } }, null, 2));
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
    report.push({ directory, ...manifest });
  }
  // Do not publish a package whose inputs changed while it was being constructed.
  for (const [filename, body] of patches) assert.equal(sha(await fs.readFile(path.join(root, 'functions', filename))), sha(body), `Source changed during preparation: ${filename}`);
  await fs.writeFile(path.join(audit, 'prepared.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.map(({ directory, targets, changes, added, preservedFiles }) => ({ directory,
    targets: targets.map(target => target.name), changes, added, preservedFiles })), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
