import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { accessToken, cloud, readCallablePolicy } from './wispi-bonus-claim-release-cloud.mjs';
import { root, inventory, normalize, resourceFields, resourceValue, sha, sourceUrl, zipInventory } from './prepare-wispi-market-release.mjs';

// Source/configuration reads and local release preparation only. This never
// deploys a function, reads a student document or changes an application record.
const name = 'claimStudentLearningReward';
const region = 'asia-northeast3';
const baseline = '7898713b7e48df81e4d2f816d5bdabf07ff68744';
const release = path.join(root, 'output/learning-reward-20261124/release');
const manifestPath = path.join(release, 'manifest.json');
const changedFile = 'studentLearningReward.js';
const before = 'topic.deletedAt || topic.classId !== loaded.wallet.classId';
const after = 'topic.deletedAt || (topic.targetClassId ?? topic.classId) !== loaded.wallet.classId';
const patch = (text, label) => {
  assert.equal(text.split(before).length, 2, `${label}: expected one reviewed anchor`);
  assert.ok(!text.includes(after), `${label}: change already present`);
  return text.replace(before, after);
};
const configuration = value => ({
  runtime: value.buildConfig.runtime,
  resources: Object.fromEntries(resourceFields.map(field => [field, resourceValue(value.serviceConfig, field)])),
  allTrafficOnLatestRevision: value.serviceConfig.allTrafficOnLatestRevision,
  environmentHash: sha(JSON.stringify(value.serviceConfig.environmentVariables || {})),
  secretHash: sha(JSON.stringify(value.serviceConfig.secretEnvironmentVariables || [])),
  eventTrigger: value.eventTrigger || null,
});

const mode = process.argv[2];
assert.ok(['prepare', 'preflight', 'verify'].includes(mode), 'Choose prepare, preflight, or verify');
const repository = normalize(await fs.readFile(path.join(root, 'functions', changedFile), 'utf8'));
const original = normalize(execFileSync('git', ['show', `${baseline}:functions/${changedFile}`], { cwd: root, encoding: 'utf8' }));
assert.equal(patch(original, 'baseline'), repository, 'Repository handler differs from the reviewed replacement');

const token = await accessToken();
const metadata = (await cloud(`https://cloudfunctions.googleapis.com/v2/projects/history-quiz-yongsin/locations/${region}/functions/${name}`, token)).json();
assert.equal(metadata.state, 'ACTIVE');
assert.equal(metadata.buildConfig.runtime, 'nodejs22');
const source = metadata.buildConfig.source.storageSource;
const iam = await readCallablePolicy(token, metadata);
if (mode === 'prepare') {
  const bytes = (await cloud(sourceUrl(source), token)).body;
  const entries = await zipInventory(bytes);
  const deployed = entries.find(entry => entry.path === changedFile)?.body.toString('utf8');
  assert.ok(deployed, 'Deployed reward handler is missing');
  assert.equal(normalize(deployed), original, 'Deployed reward handler differs from the reviewed baseline');
  const patched = patch(normalize(deployed), name);
  await fs.mkdir(path.dirname(release), { recursive: true });
  await fs.mkdir(release); // Refuse to overwrite an older or partial preparation.
  await fs.writeFile(path.join(release, 'original.zip'), bytes);
  for (const entry of entries) {
    const destination = path.join(release, 'functions', entry.path);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, entry.path === changedFile ? patched : entry.body);
  }
  const expected = await inventory(path.join(release, 'functions'));
  const differences = expected.filter(entry => entry.sha256 !== entries.find(item => item.path === entry.path)?.sha256);
  assert.deepEqual(differences.map(entry => entry.path), [changedFile], 'Only the reward handler may change');
  await fs.writeFile(path.join(release, 'firebase.json'), JSON.stringify({ functions: {
    source: 'functions', codebase: 'default', runtime: metadata.buildConfig.runtime,
    ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'],
  } }, null, 2) + '\n');
  await fs.writeFile(manifestPath, JSON.stringify({ name, region, source, updateTime: metadata.updateTime,
    originalRevision: metadata.serviceConfig.revision, archiveSha: sha(bytes), configuration: configuration(metadata),
    iam, expected, changedFiles: [changedFile] }, null, 2) + '\n');
  console.log(JSON.stringify({ name, mode, release, files: entries.length, changedFiles: [changedFile], productionDataReads: 0, productionWrites: 0 }));
} else {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  assert.deepEqual(configuration(metadata), manifest.configuration, 'Runtime configuration changed');
  assert.deepEqual(iam, manifest.iam, 'Invocation permissions changed');
  assert.deepEqual(await inventory(path.join(release, 'functions')), manifest.expected, 'Prepared source changed');
  if (mode === 'preflight') {
    assert.deepEqual(source, manifest.source, 'Function was concurrently deployed');
    assert.equal(metadata.updateTime, manifest.updateTime);
  } else {
    const live = await zipInventory((await cloud(sourceUrl(source), token)).body);
    assert.deepEqual(live.map(({ body, ...entry }) => entry), manifest.expected, 'Deployed source mismatch');
  }
  console.log(JSON.stringify({ name, mode, matches: true, revision: metadata.serviceConfig.revision, generation: source.generation, productionDataReads: 0, productionWrites: 0 }));
}
