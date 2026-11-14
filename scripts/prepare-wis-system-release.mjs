import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

// Snapshot and prepare only. Deployment remains an explicit, separately checked step.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audit = path.join(root, 'output/wis-system-20261114/release');
const project = 'history-quiz-yongsin';
const baseline = 'afd184a79905d5a6e5cf5879e6b870dd59cfece3';
const normalize = text => text.replace(/\r\n/g, '\n');
const sha = value => createHash('sha256').update(value).digest('hex');
const targets = [
  ...['getWeplayLobby', 'startWeplayGame', 'finishWeplayGame', 'settleWeplayOnSchedule',
    'commandYutRoom', 'claimStudentLearningReward'].map(name => ({ name, region: 'asia-northeast3', files: ['studentWisWallet.js'] })),
  { name: 'commandYutRoomFast', region: 'us-central1', files: ['studentWisWallet.js'] },
  { name: 'executeCommand', region: 'asia-northeast3', files: ['productionGateway/wisEconomy.js', 'productionGateway/archiveEnrollment.js'], added: ['wisLedgerIntegrity.js'] },
  ...['getWisEconomyState', 'getWisEconomyStateFast', 'getWisRankingPreview'].map(name => ({ name, region: 'us-central1',
      files: ['productionGateway/wisEconomyQuery.js'], added: ['wisOverviewQuery.js'] })),
  { name: 'getWisEconomyState', region: 'asia-northeast3', files: ['productionGateway/wisEconomyQuery.js'], added: ['wisOverviewQuery.js'] },
];
const token = String(execFileSync('cmd.exe', ['/d', '/s', '/c', 'gcloud.cmd auth print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).trim();
const request = async url => {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  assert.ok(response.ok, `Source snapshot request failed: ${response.status}`);
  return response;
};
const walk = async directory => {
  const result = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    if (item.name === 'node_modules') continue;
    assert.ok(!item.isSymbolicLink());
    const filename = path.join(directory, item.name);
    if (item.isDirectory()) result.push(...await walk(filename)); else result.push(filename);
  }
  return result.sort();
};
await fs.mkdir(audit, { recursive: true });
let cursor = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (cursor < targets.length) {
    const target = targets[cursor++];
    const id = `${target.name}--${target.region}`;
    const directory = path.join(audit, 'originals', id);
    await fs.mkdir(directory, { recursive: true });
    const metadata = await (await request(`https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${target.region}/functions/${target.name}`)).json();
    await fs.writeFile(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2));
    const { bucket, object, generation } = metadata.buildConfig.source.storageSource;
    const generationDirectory = path.join(directory, String(generation));
    await fs.mkdir(generationDirectory, { recursive: true });
    const archive = path.join(generationDirectory, 'source.zip');
    let bytes;
    try { bytes = await fs.readFile(archive); }
    catch {
      bytes = Buffer.from(await (await request(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media&generation=${generation}`)).arrayBuffer());
      await fs.writeFile(archive, bytes);
    }
    const zip = await JSZip.loadAsync(bytes);
    for (const [name, item] of Object.entries(zip.files)) {
      if (item.dir) continue;
      const filename = path.resolve(generationDirectory, 'source', name);
      assert.ok(filename.startsWith(path.join(generationDirectory, 'source') + path.sep), 'Unsafe source archive');
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await fs.writeFile(filename, await item.async('nodebuffer'));
    }
    console.log(`Snapshotted ${id}`);
  }
}));
if (process.argv.includes('--snapshot-only')) process.exit(0);
const groups = new Map();
for (const target of targets) {
  const id = `${target.name}--${target.region}`;
  const directory = path.join(audit, 'originals', id);
  const metadata = JSON.parse(await fs.readFile(path.join(directory, 'metadata.json'), 'utf8'));
  const source = path.join(directory, String(metadata.buildConfig.source.storageSource.generation), 'source');
  const inventory = [];
  for (const filename of await walk(source)) inventory.push({ path: path.relative(source, filename).replaceAll('\\', '/'), sha256: sha(await fs.readFile(filename)) });
  const key = sha(JSON.stringify([inventory, target.files, target.added])).slice(0, 16);
  if (!groups.has(key)) groups.set(key, { key, source, inventory, files: target.files, added: target.added || [], targets: [] });
  groups.get(key).targets.push({ name: target.name, region: target.region, serviceConfig: metadata.serviceConfig,
    runtime: metadata.buildConfig.runtime, sourceGeneration: metadata.buildConfig.source.storageSource.generation });
}
const report = [];
for (const group of groups.values()) {
  const directory = path.join(audit, 'prepared', group.key);
  const destination = path.join(directory, 'functions');
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(group.source, destination, { recursive: true });
  for (const file of group.files) {
    const before = execFileSync('git', ['show', `${baseline}:functions/${file}`], { cwd: root, encoding: 'utf8' });
    const deployed = await fs.readFile(path.join(group.source, file), 'utf8');
    let expected = normalize(before);
    let patched = await fs.readFile(path.join(root, 'functions', file), 'utf8');
    // Older game/reward deployments predate the optional profile hook. Keep
    // their authorization closure unchanged and transplant only wallet guards.
    if (file === 'studentWisWallet.js' && !deployed.includes('validateStudentProfile')) {
      const preserveOlderHook = value => value.replace(", validateStudentProfile }) => {", " }) => {")
        .replace('    if (validateStudentProfile) await validateStudentProfile(profile);\n', '');
      expected = preserveOlderHook(expected);
      patched = preserveOlderHook(normalize(patched));
    }
    assert.ok(normalize(deployed) === expected, `Unreviewed live source difference: ${group.targets[0].name}/${file}`);
    await fs.writeFile(path.join(destination, file), patched);
  }
  for (const file of group.added) {
    assert.ok(!group.inventory.some(item => item.path === file));
    await fs.copyFile(path.join(root, 'functions', file), path.join(destination, file));
  }
  const changes = [];
  for (const item of group.inventory) {
    const after = sha(await fs.readFile(path.join(destination, item.path)));
    if (after !== item.sha256) changes.push(item.path);
  }
  assert.ok(changes.every(file => group.files.includes(file)));
  for (const file of [...changes, ...group.added]) execFileSync(process.execPath, ['--check', path.join(destination, file)]);
  await fs.writeFile(path.join(directory, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', codebase: 'default', ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'] } }, null, 2));
  const expectedHashes = Object.fromEntries(await Promise.all([...changes, ...group.added].map(async file =>
    [file, sha(await fs.readFile(path.join(destination, file)))])));
  const manifest = { baseline, targets: group.targets, changes, added: group.added, expectedHashes, preservedFiles: group.inventory.length - changes.length,
    deploymentCommand: `firebase deploy --only "${[...new Set(group.targets.map(item => `functions:${item.name}`))].join(',')}" --project ${project} --config firebase.json` };
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  report.push({ directory, ...manifest });
}
await fs.writeFile(path.join(audit, 'prepared.json'), JSON.stringify(report, null, 2));
// New teacher-only endpoints have no existing deployment to preserve. Use an
// isolated entry so deploying them cannot export any legacy wallet writers.
const stocksDirectory = path.join(audit, 'prepared', 'stocks');
const stocksFunctions = path.join(stocksDirectory, 'functions');
await fs.mkdir(stocksFunctions, { recursive: true });
await fs.cp(path.join(root, 'functions'), stocksFunctions, { recursive: true,
  filter: filename => path.basename(filename) !== 'node_modules' && !path.basename(filename).endsWith('.log') });
await fs.writeFile(path.join(stocksFunctions, 'index.js'), `const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { onCall } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
initializeApp();
const handlers = require('./wisStocks').createWisStockHandlers({ db: getFirestore() });
exports.getWisStockManagement = onCall({ region: 'us-central1', memory: '256MiB', maxInstances: 10 }, handlers.getWisStockManagement);
exports.saveWisStock = onCall({ region: 'us-central1', memory: '256MiB', maxInstances: 10 }, handlers.saveWisStock);
exports.advanceWisStockPrices = onSchedule({ schedule: 'every 60 minutes', region: 'us-central1', timeZone: 'Asia/Seoul', maxInstances: 1, memory: '256MiB' }, handlers.advanceWisStockPrices);
`);
await fs.writeFile(path.join(stocksDirectory, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', codebase: 'default',
  ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'] } }, null, 2));
console.log(JSON.stringify(report.map(({ directory, targets, changes, added, preservedFiles }) => ({ directory, targets: targets.map(item => `${item.name}--${item.region}`), changes, added, preservedFiles })), null, 2));
