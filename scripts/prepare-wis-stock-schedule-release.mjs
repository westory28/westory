import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readCloud, sourceUrl, zipInventory, inventory, sha, normalize,
  assertRuntime } from './prepare-wispi-market-release.mjs';

// Snapshot and prepare only: no deploy, scheduler invocation, or market writes.
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const audit = path.join(root, 'output/wis-stock-schedule-20261116/release');
export const baseline = 'fa749dff82326d44e9350722f7cb736b61fd9f57';
export const project = 'history-quiz-yongsin';
export const region = 'us-central1';
export const targetNames = ['advanceWisStockPrices', 'getWisStockManagement', 'saveWisStock',
  'saveWisStockMarketRules', 'setWisStockMarketHalted'];
export const newTarget = 'activateWisStockCatalogPlan';
export const changedFiles = ['wisStocks.js'];
export const addedFiles = ['wisStockCatalogSchedule.js', 'wisStockCatalog.json'];
export const functionUrl = name => `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${region}/functions/${name}`;
export const schedulerUrl = `https://cloudscheduler.googleapis.com/v1/projects/${project}/locations/${region}/jobs/firebase-schedule-advanceWisStockPrices-${region}`;
const baselineText = file => execFileSync('git', ['show', `${baseline}:functions/${file}`], { cwd: root, encoding: 'utf8' });

export async function accessToken() {
  const require = createRequire(import.meta.url);
  const auth = require(path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/auth.js'));
  const account = auth.getProjectDefaultAccount(root);
  assert.ok(account?.tokens?.refresh_token, 'An authenticated Firebase CLI account is required');
  const tokens = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  assert.ok(tokens.access_token, 'Firebase CLI access token unavailable');
  return tokens.access_token;
}

export function patchIndex(original) {
  assert.ok(original.includes("require('./wisStocks').createWisStockHandlers"), 'Unexpected stock entrypoint');
  assert.ok(!original.includes(newTarget), 'Plan activation already exists in the live entrypoint');
  assert.deepEqual([...original.matchAll(/exports\.(\w+)\s*=/g)].map(match => match[1]).sort(), [...targetNames].sort());
  const matches = [...original.matchAll(/schedule:\s*(['"])every 60 minutes\1/g)];
  assert.equal(matches.length, 1, 'Expected exactly one hourly stock scheduler');
  return original.replace(/schedule:\s*(['"])every 60 minutes\1/, "schedule: '0 * * * *'")
    + "\nexports.activateWisStockCatalogPlan = onCall({ region: 'us-central1', memory: '256MiB', maxInstances: 10 }, handlers.activateWisStockCatalogPlan);\n";
}

async function main() {
  assert.ok(process.argv.slice(2).every(value => value === '--snapshot-only'), 'Only --snapshot-only is supported');
  assert.equal(path.resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim()).toLowerCase(), root.toLowerCase());
  const token = await accessToken(), snapshots = [];
  await fs.mkdir(audit, { recursive: true });
  let cursor = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < targetNames.length) {
      const name = targetNames[cursor++];
      const metadata = await (await readCloud(functionUrl(name), token)).json();
      assertRuntime(metadata);
      const source = metadata.buildConfig.source.storageSource;
      assert.ok(source.bucket && source.object && /^\d+$/.test(String(source.generation)));
      const directory = path.join(audit, 'originals', `${name}--${region}`, String(source.generation));
      await fs.mkdir(directory, { recursive: true });
      let bytes;
      try { bytes = await fs.readFile(path.join(directory, 'source.zip')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        bytes = Buffer.from(await (await readCloud(sourceUrl(source), token)).arrayBuffer());
      }
      const entries = await zipInventory(bytes), byName = new Map(entries.map(entry => [entry.path, entry]));
      for (const file of changedFiles) assert.equal(normalize(byName.get(file)?.body.toString('utf8') || ''),
        normalize(baselineText(file)), `Unreviewed live source: ${name}/${file}`);
      for (const file of addedFiles) assert.ok(!byName.has(file), `Unexpected existing schedule module: ${file}`);
      patchIndex(byName.get('index.js').body.toString('utf8'));
      const originalInventory = entries.map(({ body, ...entry }) => entry);
      try {
        assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'inventory.json'), 'utf8')), originalInventory,
          'A versioned source snapshot changed');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.writeFile(path.join(directory, 'source.zip'), bytes);
      await fs.writeFile(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2));
      await fs.writeFile(path.join(directory, 'inventory.json'), JSON.stringify(originalInventory, null, 2));
      await fs.writeFile(path.join(directory, 'index.js'), byName.get('index.js').body);
      snapshots.push({ name, metadata, directory, entries, originalInventory });
      console.log(`Preserved ${name}/${region}: ${entries.length} files; baseline matches`);
    }
  }));
  snapshots.sort((a, b) => a.name.localeCompare(b.name));
  await fs.writeFile(path.join(audit, 'snapshots.json'), JSON.stringify(snapshots.map(({ entries, ...snapshot }) => snapshot), null, 2));
  const scheduler = await (await readCloud(schedulerUrl, token)).json();
  assert.equal(scheduler.schedule, 'every 60 minutes');
  assert.equal(scheduler.timeZone, 'Asia/Seoul');
  assert.equal(scheduler.state, 'ENABLED');
  await fs.writeFile(path.join(audit, 'scheduler-before.json'), JSON.stringify(scheduler, null, 2));
  if (process.argv.includes('--snapshot-only')) return;

  const patches = new Map(await Promise.all([...changedFiles, ...addedFiles].map(async file =>
    [file, await fs.readFile(path.join(root, 'functions', file))])));
  const groups = new Map();
  for (const snapshot of snapshots) {
    const key = sha(JSON.stringify([snapshot.originalInventory, [...patches].map(([file, body]) => [file, sha(body)])])).slice(0, 20);
    if (!groups.has(key)) groups.set(key, { key, entries: snapshot.entries, originalInventory: snapshot.originalInventory, targets: [] });
    groups.get(key).targets.push({ name: snapshot.name, region, runtime: snapshot.metadata.buildConfig.runtime,
      serviceConfig: snapshot.metadata.serviceConfig, sourceStorage: snapshot.metadata.buildConfig.source.storageSource,
      snapshotDirectory: snapshot.directory });
  }
  const prepared = [];
  let activationAssigned = false;
  for (const group of groups.values()) {
    const directory = path.join(audit, 'prepared', group.key), destination = path.join(directory, 'functions');
    const entries = new Map(group.entries.map(entry => [entry.path, entry.body]));
    for (const [file, body] of patches) entries.set(file, body);
    entries.set('index.js', Buffer.from(patchIndex(entries.get('index.js').toString('utf8'))));
    for (const [file, body] of entries) {
      const filename = path.join(destination, file);
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await fs.writeFile(filename, body);
    }
    const expected = [...entries].map(([file, body]) => ({ path: file, sha256: sha(body) })).sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(await inventory(destination), expected, 'Unexpected prepared source or missing production file');
    for (const file of ['index.js', ...changedFiles, ...addedFiles.filter(file => file.endsWith('.js'))])
      execFileSync(process.execPath, ['--check', path.join(destination, file)]);
    const newTargets = activationAssigned ? [] : [newTarget];
    activationAssigned = true;
    const manifest = { schemaVersion: 1, project, baseline, directory, targets: group.targets, newTargets,
      changed: [...changedFiles, 'index.js'], added: addedFiles, originalInventory: group.originalInventory,
      expectedHashes: Object.fromEntries(expected.map(entry => [entry.path, entry.sha256])), productionWrites: 0,
      deploymentCommand: `firebase deploy --only "${[...group.targets.map(target => target.name), ...newTargets].map(name => `functions:${name}`).join(',')}" --project ${project} --config firebase.json` };
    await fs.writeFile(path.join(directory, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', codebase: 'default',
      ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'] } }, null, 2));
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
    prepared.push(manifest);
  }
  for (const [file, body] of patches) assert.equal(sha(await fs.readFile(path.join(root, 'functions', file))), sha(body), `Source changed while preparing: ${file}`);
  await fs.writeFile(path.join(audit, 'prepared.json'), JSON.stringify(prepared, null, 2));
  console.log(JSON.stringify(prepared.map(({ directory, targets, newTargets, deploymentCommand }) =>
    ({ directory, targets: targets.map(target => target.name), newTargets, deploymentCommand })), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
