import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { accessToken, readCloud, sourceUrl, zipInventory, sha, normalize } from './prepare-wispi-market-release.mjs';

// Prepare only the new transport export. Never redeploy unrelated live functions.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'output/written-exam-assets-release');
const destination = path.join(out, 'functions');
const project = 'history-quiz-yongsin';
const target = 'manageWrittenExamAsset';
const shared = ['sessionAuthority.js', 'studentMaintenance.js', 'studentRegistrationAccess.js', 'studentRegistrationPolicyCore.js'];
const token = accessToken();
const metadata = await (await readCloud(`https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/asia-northeast3/functions/openApplicationSession`, token)).json();
assert.equal(metadata.state, 'ACTIVE');
const bytes = Buffer.from(await (await readCloud(sourceUrl(metadata.buildConfig.source.storageSource), token)).arrayBuffer());
const entries = new Map((await zipInventory(bytes)).map(entry => [entry.path, entry]));
await fs.mkdir(destination, { recursive: true });
await fs.mkdir(path.join(out, 'live-security'), { recursive: true });
const comparisons = [];
for (const filename of shared) {
  const local = await fs.readFile(path.join(root, 'functions', filename));
  const live = entries.get(filename)?.body;
  assert.ok(live, `Missing live security dependency: ${filename}`);
  await fs.writeFile(path.join(out, 'live-security', filename), live);
  comparisons.push({ filename, repositorySha256: sha(local), deployedSha256: sha(live), liveMatches: normalize(local.toString()) === normalize(live.toString()) });
  // Preserve operating security helpers verbatim. The reviewed repository-only
  // recentAuth admin exception is irrelevant to this default-session transport.
  await fs.writeFile(path.join(destination, filename), live);
}
await fs.writeFile(path.join(out, 'security-comparison.json'), JSON.stringify(comparisons, null, 2));
for (const filename of ['writtenExamAssets.js', 'package-lock.json'])
  await fs.copyFile(path.join(root, 'functions', filename), path.join(destination, filename));
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'functions/package.json')));
delete packageJson.scripts;
await fs.writeFile(path.join(destination, 'package.json'), JSON.stringify(packageJson, null, 2));
await fs.writeFile(path.join(destination, 'index.js'), `require('firebase-admin/app').initializeApp();\nexports.${target} = require('./writtenExamAssets').${target};\n`);
await fs.writeFile(path.join(out, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', codebase: 'default', ignore: ['node_modules', '.git', '*debug.log', 'scripts'] } }, null, 2));
const hashes = Object.fromEntries(await Promise.all((await fs.readdir(destination, { withFileTypes: true })).filter(entry => entry.isFile()).map(async entry => [entry.name, sha(await fs.readFile(path.join(destination, entry.name)))])));
await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify({ project, target, region: 'asia-northeast3', source: metadata.buildConfig.source.storageSource, comparisons, hashes }, null, 2));
console.log(JSON.stringify({ directory: out, target, verifiedSecurityDependencies: comparisons.length, files: Object.keys(hashes).length }, null, 2));
