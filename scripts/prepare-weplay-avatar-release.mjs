import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readCloud, sourceUrl, zipInventory, inventory, sha, normalize } from './prepare-wispi-market-release.mjs';

// Preserve each deployed source bundle. No cloud writes are performed here.
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const audit = path.join(root, 'output/weplay-avatar-20261116/release');
export const baseline = 'fa749dff82326d44e9350722f7cb736b61fd9f57';
export const targets = [
  { name: 'saveStudentAvatar', region: 'us-central1', files: ['studentAvatar.js'] },
  { name: 'saveTeacherAvatar', region: 'us-central1', files: ['studentAvatar.js'] },
  { name: 'getWeplayLobby', region: 'asia-northeast3', files: ['weplay.js'] },
  { name: 'commandYutRoom', region: 'asia-northeast3', files: ['yut.js'], added: ['weplayRankingStore.js'] },
  { name: 'commandYutRoomFast', region: 'us-central1', files: ['yut.js'], added: ['weplayRankingStore.js'] },
  { name: 'getGongsinmoongo', region: 'asia-northeast3', files: [], referenceOnly: true },
  { name: 'manageGongsinmoongo', region: 'asia-northeast3', files: [], referenceOnly: true },
];
export const rankingFiles = ['weplayRanking.js', 'weplayRankingStore.js', 'rhythmRankingCore/rhythmCore.js', 'rhythmRankingCore/rhythmSongs.js'];
export const rankingNames = ['getWeplayRanking', 'startRhythmRankingGame', 'finishRhythmRankingGame'];
const gitFile = file => execFileSync('git', ['show', `${baseline}:functions/${file}`], { cwd: root, encoding: 'utf8' });
const withoutPublication = value => value.replace(/  const getYutPublication = async \(request\) => \{[\s\S]*?\n  const getYutLobby =/, '  const getYutLobby =').replace('return { getYutPublication, getYutLobby,', 'return { getYutLobby,');
const transplant = (file, original, patch) => file === 'yut.js' && !original.includes('const getYutPublication =') ? withoutPublication(patch) : patch;
const menuBase = value => value.includes('\n// /student/wispi') ? value.slice(0, value.indexOf('\n// /student/wispi')) + '\nmodule.exports = { studentMenuVisible, assertStudentMenuVisible, readStudentMenuAccess };\n' : value;
export async function accessToken() {
  const require = createRequire(import.meta.url);
  const auth = require(path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/auth.js'));
  const account = auth.getProjectDefaultAccount(root);
  assert.ok(account?.tokens?.refresh_token, 'Firebase CLI account required');
  const tokens = account.tokens.access_token && account.tokens.expires_at > Date.now() + 60_000 ? account.tokens
    : await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
  assert.ok(tokens.access_token, 'Firebase CLI token unavailable');
  return tokens.access_token;
}
async function main() {
  if (process.argv.includes('--refresh-patches')) {
    const filename = path.join(audit, 'prepared.json');
    const plans = JSON.parse(await fs.readFile(filename, 'utf8'));
    for (const plan of plans) {
      for (const file of [...plan.changes, ...plan.added]) {
        if (file === 'index.js') continue; // The new isolated entrypoint stays isolated.
        const destination = path.join(plan.directory, 'functions', file);
        const previous = await fs.readFile(destination, 'utf8');
        const body = Buffer.from(transplant(file, previous, await fs.readFile(path.join(root, 'functions', file), 'utf8')));
        await fs.writeFile(destination, body);
        plan.expectedHashes[file] = sha(body);
      }
      await fs.writeFile(path.join(plan.directory, 'manifest.json'), JSON.stringify(plan, null, 2));
    }
    await fs.writeFile(filename, JSON.stringify(plans, null, 2));
    console.log('Prepared manifests refreshed for reviewed patch files only.');
    return;
  }
  const token = await accessToken(), snapshots = [];
  await fs.mkdir(audit, { recursive: true });
  for (const target of targets.filter(target => !process.argv.includes('--references-only') || target.referenceOnly)) {
    const metadata = await (await readCloud(`https://cloudfunctions.googleapis.com/v2/projects/history-quiz-yongsin/locations/${target.region}/functions/${target.name}`, token)).json();
    assert.equal(metadata.state, 'ACTIVE');
    assert.equal(metadata.buildConfig.runtime, 'nodejs22');
    const source = metadata.buildConfig.source.storageSource;
    const directory = path.join(audit, 'originals', `${target.name}--${target.region}`, String(source.generation));
    await fs.mkdir(directory, { recursive: true });
    let bytes;
    try { bytes = await fs.readFile(path.join(directory, 'source.zip')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      bytes = Buffer.from(await (await readCloud(sourceUrl(source), token)).arrayBuffer());
      await fs.writeFile(path.join(directory, 'source.zip'), bytes);
    }
    const entries = await zipInventory(bytes);
    if (target.referenceOnly) for (const entry of entries) {
      const filename = path.join(directory, 'functions', entry.path);
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await fs.writeFile(filename, entry.body);
    }
    for (const file of target.files) {
      const live = entries.find(entry => entry.path === file);
      assert.ok(live, `Missing ${target.name}/${file}`);
      await fs.writeFile(path.join(directory, file), live.body);
      assert.ok(normalize(live.body.toString('utf8')) === normalize(transplant(file, live.body.toString('utf8'), gitFile(file))), `Unreviewed production difference: ${target.name}/${file}`);
    }
    await fs.writeFile(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2));
    await fs.writeFile(path.join(directory, 'inventory.json'), JSON.stringify(entries.map(({ body, ...entry }) => entry), null, 2));
    snapshots.push({ target, metadata, directory, entries });
    console.log(`Snapshot ${target.name} (${target.region}): ${entries.length} files, patch baseline matches`);
  }
  if (process.argv.includes('--snapshot-only') || process.argv.includes('--references-only')) return;
  const prepared = [];
  for (const { target, metadata, entries } of snapshots) {
    if (target.referenceOnly) continue;
    const directory = path.join(audit, 'prepared', `${target.name}--${target.region}`);
    const destination = path.join(directory, 'functions');
    const patches = new Map(await Promise.all([...target.files, ...(target.added || [])].map(async file => [file, await fs.readFile(path.join(root, 'functions', file))])));
    const expectedHashes = {};
    await fs.mkdir(destination, { recursive: true });
    for (const entry of entries) {
      const body = patches.has(entry.path) ? Buffer.from(transplant(entry.path, entry.body.toString('utf8'), patches.get(entry.path).toString('utf8'))) : entry.body;
      const file = path.join(destination, entry.path);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, body);
      expectedHashes[entry.path] = sha(body);
    }
    for (const file of target.added || []) {
      assert.ok(!entries.some(entry => entry.path === file), `Expected new dependency: ${file}`);
      await fs.writeFile(path.join(destination, file), patches.get(file));
      expectedHashes[file] = sha(patches.get(file));
    }
    assert.deepEqual(await inventory(destination), Object.entries(expectedHashes).map(([file, hash]) => ({ path: file, sha256: hash })).sort((a,b) => a.path.localeCompare(b.path)));
    for (const file of patches.keys()) execFileSync(process.execPath, ['--check', path.join(destination, file)]);
    await fs.writeFile(path.join(directory, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', codebase: 'default', ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'] } }, null, 2));
    const plan = { directory, baseline, targets: [{ name: target.name, region: target.region, runtime: metadata.buildConfig.runtime, serviceConfig: metadata.serviceConfig, sourceGeneration: metadata.buildConfig.source.storageSource.generation }], changes: target.files, added: target.added || [], expectedHashes };
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(plan, null, 2));
    prepared.push(plan);
  }
  const source = snapshots.find(snapshot => snapshot.target.name === 'getWeplayLobby');
  const directory = path.join(audit, 'prepared', 'new-ranking'), destination = path.join(directory, 'functions');
  const entrypoint = `const { initializeApp } = require('firebase-admin/app');\nconst { getFirestore } = require('firebase-admin/firestore');\nconst { onCall } = require('firebase-functions/v2/https');\ninitializeApp();\nconst handlers = require('./weplayRanking').createWeplayRankingHandlers({ db: getFirestore() });\nconst options = { region: 'asia-northeast3', maxInstances: 10, memory: '256MiB', timeoutSeconds: 60 };\n${rankingNames.map(name => `exports.${name} = onCall(options, handlers.${name});`).join('\n')}\n`;
  const expectedHashes = {};
  await fs.mkdir(destination, { recursive: true });
  for (const entry of source.entries) {
    const body = entry.path === 'index.js' ? Buffer.from(entrypoint) : entry.body;
    const file = path.join(destination, entry.path);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
    expectedHashes[entry.path] = sha(body);
  }
  for (const file of rankingFiles) {
    assert.ok(!source.entries.some(entry => entry.path === file), `Expected new ranking file: ${file}`);
    const body = await fs.readFile(path.join(root, 'functions', file));
    await fs.mkdir(path.dirname(path.join(destination, file)), { recursive: true });
    await fs.writeFile(path.join(destination, file), body);
    expectedHashes[file] = sha(body);
    execFileSync(process.execPath, ['--check', path.join(destination, file)]);
  }
  // New handlers inherit deployed security helpers; compare those helpers before reuse.
  for (const file of ['scoreWorkflowGuard.js', 'sessionAuthority.js', 'studentMaintenance.js', 'studentMenuVisibility.js', 'weplayCore.js']) {
    const live = source.entries.find(entry => entry.path === file);
    const expected = file === 'studentMenuVisibility.js' ? menuBase(normalize(gitFile(file))) : normalize(gitFile(file));
    assert.ok(live && normalize(live.body.toString('utf8')) === expected, `Unreviewed ranking authority dependency: ${file}`);
  }
  await fs.writeFile(path.join(directory, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', codebase: 'default', ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'] } }, null, 2));
  const newPlan = { directory, baseline, newFunctions: true, targets: rankingNames.map(name => ({ name, region: 'asia-northeast3', runtime: 'nodejs22' })), changes: ['index.js'], added: rankingFiles, expectedHashes };
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(newPlan, null, 2));
  prepared.push(newPlan);
  await fs.writeFile(path.join(audit, 'prepared.json'), JSON.stringify(prepared, null, 2));
  console.log(JSON.stringify(prepared.map(({ directory, targets, changes, added }) => ({ directory, targets: targets.map(target => target.name), changes, added })), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
