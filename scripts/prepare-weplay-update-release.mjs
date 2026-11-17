import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { accessToken } from './prepare-weplay-avatar-release.mjs';
import { readCloud, sourceUrl, zipInventory, sha, normalize, resourceFields, resourceValue } from './prepare-wispi-market-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'output/weplay-update-20261117/release');
const baseline = 'c30f889740350cb683f6530a185c16b388c1a782';
const rankingFiles = ['weplayRanking.js', 'weplayRankingStore.js', 'rhythmRankingCore/rhythmCore.js', 'rhythmRankingCore/rhythmSongs.js', 'rhythmChallenge.js'];
const targets = [
  ...['getWeplayRanking', 'startRhythmRankingGame', 'finishRhythmRankingGame'].map(name => ({ name, region: 'asia-northeast3', files: rankingFiles })),
  { name: 'commandYutRoom', region: 'asia-northeast3', files: ['yut.js', 'yutCore.mjs', 'weplayRankingStore.js'] },
  { name: 'commandYutRoomFast', region: 'us-central1', files: ['yut.js', 'yutCore.mjs', 'weplayRankingStore.js'] },
];
const additions = ['getRhythmChallengeState', 'saveRhythmChallengeSettings', 'getWeplayWeeklyRewards', 'saveWeplayWeeklyRewards', 'settleWeplayWeeklyRewards'];
const metadataUrl = target => `https://cloudfunctions.googleapis.com/v2/projects/history-quiz-yongsin/locations/${target.region}/functions/${target.name}`;
const transplant = (file, original, value) => file === 'yut.js' && !original.includes('const getYutPublication =')
  ? value.replace(/  const getYutPublication = async \(request\) => \{[\s\S]*?\n  const getYutLobby =/, '  const getYutLobby =').replace('return { getYutPublication, getYutLobby,', 'return { getYutLobby,') : value;
const writeJson = (file, data) => fs.writeFile(file, JSON.stringify(data, null, 2));
await fs.mkdir(release, { recursive: true });
const token = await accessToken();
if (process.argv.includes('--verify')) {
  const plans = JSON.parse(await fs.readFile(path.join(release, 'prepared.json'), 'utf8'));
  for (const plan of plans) for (const target of plan.targets) {
    const metadata = await (await readCloud(metadataUrl(target), token)).json();
    assert.equal(metadata.state, 'ACTIVE');
    const entries = await zipInventory(Buffer.from(await (await readCloud(sourceUrl(metadata.buildConfig.source.storageSource), token)).arrayBuffer()));
    assert.deepEqual(Object.fromEntries(entries.map(entry => [entry.path, entry.sha256])), plan.expectedHashes, `deployed source: ${target.name}`);
    if (target.resource) for (const field of resourceFields) assert.equal(resourceValue(metadata.serviceConfig, field), resourceValue(target.resource, field), `${target.name}/${field}`);
    console.log(`Verified ACTIVE source and runtime: ${target.name} (${target.region})`);
    await writeJson(path.join(plan.directory, `${target.name}-after.json`), metadata);
  }
  process.exit(0);
}
const plans = [];
for (const target of targets) {
  const metadata = await (await readCloud(metadataUrl(target), token)).json();
  assert.equal(metadata.state, 'ACTIVE');
  const original = path.join(release, 'originals', `${target.name}--${target.region}`, String(metadata.buildConfig.source.storageSource.generation));
  await fs.mkdir(original, { recursive: true });
  const zipFile = path.join(original, 'source.zip');
  let bytes;
  try { bytes = await fs.readFile(zipFile); } catch { bytes = Buffer.from(await (await readCloud(sourceUrl(metadata.buildConfig.source.storageSource), token)).arrayBuffer()); await fs.writeFile(zipFile, bytes); }
  const entries = await zipInventory(bytes);
  await writeJson(path.join(original, 'metadata.json'), metadata);
  for (const file of target.files) {
    const entry = entries.find(item => item.path === file);
    if (!entry) { assert.equal(file, 'rhythmChallenge.js', `unexpected missing ${file}`); continue; }
    // Start was not redeployed by the weekly ranking follow-up. Its preserved
    // source matches the original ranking release; the shared authority/record
    // changes here are covered by the new challenge integration regression.
    const sourceBaseline = target.name === 'startRhythmRankingGame' ? '45fe373cc29e7de50c4ad5f04df7f9c1eb896071' : baseline;
    const base = execFileSync('git', ['show', `${sourceBaseline}:functions/${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    await fs.mkdir(path.dirname(path.join(original, file)), { recursive: true });
    await fs.writeFile(path.join(original, file), entry.body);
    await fs.writeFile(path.join(original, file + '.baseline'), base);
    assert.ok(normalize(entry.body.toString('utf8')) === normalize(transplant(file, entry.body.toString('utf8'), base)), `unreviewed production difference ${target.name}/${file}; compare saved source/baseline`);
  }
  const directory = path.join(release, 'prepared', target.name), destination = path.join(directory, 'functions');
  await fs.mkdir(destination, { recursive: true });
  const expectedHashes = {};
  for (const entry of entries) {
    let body = entry.body;
    if (target.files.includes(entry.path)) body = Buffer.from(transplant(entry.path, entry.body.toString('utf8'), await fs.readFile(path.join(root, 'functions', entry.path), 'utf8')));
    const filename = path.join(destination, entry.path); await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, body); expectedHashes[entry.path] = sha(body);
  }
  for (const file of target.files.filter(file => !entries.some(entry => entry.path === file))) {
    const body = await fs.readFile(path.join(root, 'functions', file)); await fs.writeFile(path.join(destination, file), body); expectedHashes[file] = sha(body);
  }
  await writeJson(path.join(directory, 'firebase.json'), { functions: { source: 'functions', runtime: 'nodejs22' } });
  const plan = { directory, targets: [{ name: target.name, region: target.region, resource: metadata.serviceConfig }], expectedHashes, baseline, changed: target.files };
  plans.push(plan); console.log(`Prepared preserved ${target.name}: ${entries.length} original files`);
}
// New handlers inherit the exact deployed ranking security/wallet dependencies.
const source = path.join(plans[0].directory, 'functions'), directory = path.join(release, 'prepared', 'new-handlers'), destination = path.join(directory, 'functions');
await fs.mkdir(destination, { recursive: true });
await fs.cp(source, destination, { recursive: true, filter: name => !name.split(path.sep).includes('node_modules') });
const newFiles = ['weplayWeeklyRewards.js'];
for (const file of newFiles) await fs.copyFile(path.join(root, 'functions', file), path.join(destination, file));
const entrypoint = `const { initializeApp } = require('firebase-admin/app');\nconst { getFirestore } = require('firebase-admin/firestore');\nconst { onCall } = require('firebase-functions/v2/https');\nconst { onSchedule } = require('firebase-functions/v2/scheduler');\ninitializeApp();\nconst db = getFirestore();\nconst rhythm = require('./weplayRanking').createWeplayRankingHandlers({ db });\nconst weekly = require('./weplayWeeklyRewards').createWeplayWeeklyRewardHandlers({ db });\nconst options = { region: 'asia-northeast3', maxInstances: 10, memory: '256MiB', timeoutSeconds: 60 };\nexports.getRhythmChallengeState = onCall(options, rhythm.getRhythmChallengeState);\nexports.saveRhythmChallengeSettings = onCall(options, rhythm.saveRhythmChallengeSettings);\nexports.getWeplayWeeklyRewards = onCall(options, weekly.getWeplayWeeklyRewards);\nexports.saveWeplayWeeklyRewards = onCall(options, weekly.saveWeplayWeeklyRewards);\nexports.settleWeplayWeeklyRewards = onSchedule({region:'asia-northeast3',schedule:'every 15 minutes',timeZone:'Asia/Seoul',maxInstances:1,memory:'256MiB',timeoutSeconds:540}, weekly.settleWeplayWeeklyRewards);\n`;
await fs.writeFile(path.join(destination, 'index.js'), entrypoint);
const expectedHashes = { ...plans[0].expectedHashes, 'index.js': sha(entrypoint) };
for (const file of newFiles) expectedHashes[file] = sha(await fs.readFile(path.join(destination, file)));
await writeJson(path.join(directory, 'firebase.json'), { functions: { source: 'functions', runtime: 'nodejs22' } });
plans.push({ directory, targets: additions.map(name => ({ name, region: 'asia-northeast3' })), expectedHashes, baseline, changed: [...rankingFiles, ...newFiles, 'index.js'] });
await writeJson(path.join(release, 'prepared.json'), plans);
console.log(`Prepared ${plans.length} isolated packages; no deployment performed.`);
