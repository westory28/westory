import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { accessToken } from './prepare-wis-stock-schedule-release.mjs';
import { readCloud, sourceUrl, zipInventory, inventory, sha } from './prepare-wispi-market-release.mjs';

// Read-only snapshots, preparation and verification. Deployment is a separate
// explicit, single-function command; no existing function is changed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'output/developer-log-like-students-20261117/release');
const project = 'history-quiz-yongsin', region = 'asia-northeast3';
const baseFunction = 'uploadDeveloperLogImageContent';
const target = 'getDeveloperLogLikeStudents';
const added = 'developerLogLikeStudents.js';
const functionUrl = name => `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${region}/functions/${name}`;
const json = async (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2));
const token = await accessToken();
await fs.mkdir(directory, { recursive: true });
assert(process.argv.slice(2).every(arg => ['--snapshot-only', '--verify'].includes(arg)));

if (process.argv.includes('--verify')) {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
  const metadata = await (await readCloud(functionUrl(target), token)).json();
  assert.equal(metadata.state, 'ACTIVE');
  assert.equal(metadata.buildConfig.runtime, 'nodejs22');
  const config = metadata.serviceConfig;
  for (const [field, expected] of Object.entries({ availableMemory: '256Mi', availableCpu: '1',
    timeoutSeconds: 30, maxInstanceCount: 5, maxInstanceRequestConcurrency: 40 })) assert.equal(String(config[field]), String(expected), field);
  assert.equal(config.minInstanceCount || 0, 0);
  const deployed = await zipInventory(Buffer.from(await (await readCloud(sourceUrl(metadata.buildConfig.source.storageSource), token)).arrayBuffer()));
  assert.deepEqual(Object.fromEntries(deployed.map(item => [item.path, item.sha256])), manifest.expectedHashes);
  const source = await (await readCloud(functionUrl(baseFunction), token)).json();
  assert.deepEqual(source.buildConfig.source.storageSource, manifest.baseSource, 'Existing image function changed during release');
  const result = { target, state: metadata.state, sourceFiles: deployed.length, sourceHashesMatch: true,
    baseFunctionUnchanged: true, runtime: metadata.buildConfig.runtime, verifiedAt: new Date().toISOString() };
  await json(path.join(directory, 'verified.json'), result);
  console.log(JSON.stringify(result));
} else {
  const metadata = await (await readCloud(functionUrl(baseFunction), token)).json();
  assert.equal(metadata.state, 'ACTIVE'); assert.equal(metadata.buildConfig.runtime, 'nodejs22');
  const source = metadata.buildConfig.source.storageSource;
  const snapshot = path.join(directory, 'original', String(source.generation));
  await fs.mkdir(snapshot, { recursive: true });
  const bytes = Buffer.from(await (await readCloud(sourceUrl(source), token)).arrayBuffer());
  const entries = await zipInventory(bytes);
  await fs.writeFile(path.join(snapshot, 'source.zip'), bytes);
  await json(path.join(snapshot, 'metadata.json'), metadata);
  await json(path.join(snapshot, 'inventory.json'), entries.map(({body, ...entry}) => entry));
  const guards = ['sessionAuthority.js', 'studentMaintenance.js', 'studentRegistrationAccess.js', 'studentRegistrationPolicyCore.js'];
  const guardComparison = await Promise.all(guards.map(async file => {
    const original = entries.find(entry => entry.path === file); assert(original, file);
    return { file, preservedSha256: original.sha256, localMatches: sha(await fs.readFile(path.join(root, 'functions', file))) === original.sha256 };
  }));
  await json(path.join(directory, 'guard-comparison.json'), guardComparison);
  console.log(JSON.stringify({baseFunction,sourceGeneration:source.generation,files:entries.length,guardComparison}));
  if (!process.argv.includes('--snapshot-only')) {
    const functionsPath = path.join(directory, 'prepared/functions');
    const files = new Map(entries.map(entry => [entry.path, entry.body]));
    assert(!files.has(added), 'Unexpected existing liker module');
    files.set(added, await fs.readFile(path.join(root, 'functions', added)));
    const localIndex = await fs.readFile(path.join(root, 'functions/index.js'), 'utf8');
    const entrypoint = localIndex.match(/^exports\.getDeveloperLogLikeStudents = require\('\.\/studentMaintenance'\)\.onCallWithStudentMaintenance\([\s\S]*?^\);/m)?.[0];
    assert(entrypoint?.includes("require('./developerLogLikeStudents').createDeveloperLogLikeStudentsHandler({ db })"), 'Unexpected callable entrypoint');
    files.set('index.js', Buffer.from(`const { initializeApp, getApps } = require('firebase-admin/app');\nconst { getFirestore } = require('firebase-admin/firestore');\nif (!getApps().length) initializeApp();\nconst db = getFirestore();\n${entrypoint}\n`));
    for (const [file, body] of files) {
      const destination = path.join(functionsPath, file);
      await fs.mkdir(path.dirname(destination), {recursive:true}); await fs.writeFile(destination, body);
    }
    const expectedHashes = Object.fromEntries([...files].sort(([a],[b])=>a.localeCompare(b)).map(([file,body])=>[file,sha(body)]));
    assert.deepEqual(Object.fromEntries((await inventory(functionsPath)).map(item=>[item.path,item.sha256])), expectedHashes);
    execFileSync(process.execPath, ['--check', path.join(functionsPath, added)]);
    const firebase = {functions:{source:'functions',codebase:'default',ignore:['node_modules','.git','firebase-debug.log','firebase-debug.*.log']}};
    await json(path.join(directory, 'prepared/firebase.json'), firebase);
    await json(path.join(directory, 'manifest.json'), {project,region,target,baseFunction,baseSource:source,guardComparison,expectedHashes,
      deploymentCommand:`firebase deploy --only functions:${target} --project ${project} --config firebase.json`});
    console.log(`Prepared single-function source: ${functionsPath}`);
  }
}
