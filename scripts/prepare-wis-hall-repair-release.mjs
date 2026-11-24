import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { accessToken, cloud, readCallablePolicy } from './wispi-bonus-claim-release-cloud.mjs';
import { root, inventory, normalize, resourceFields, resourceValue, sha, sourceUrl, zipInventory } from './prepare-wispi-market-release.mjs';

// This prepares/verifies a local package; it never deploys or changes live data.
const name = 'getWisRankingPreview';
const release = path.join(root, 'output/hall-repair-20261124/release');
const changedFile = 'productionGateway/wisEconomyQuery.js';
const oldClause = '["ranking-preview", "hall-view", "hall-of-fame"].includes(projection)';
const newClause = '["ranking-preview", "hall-view", "hall-of-fame", "hall-index"].includes(projection)';
const mode = process.argv[2];
assert.ok(['prepare', 'preflight', 'verify'].includes(mode));
const token = await accessToken();
const metadata = (await cloud(`https://cloudfunctions.googleapis.com/v2/projects/history-quiz-yongsin/locations/us-central1/functions/${name}`, token)).json();
assert.equal(metadata.state, 'ACTIVE');
assert.equal(metadata.buildConfig.runtime, 'nodejs22');
const configuration = value => ({
  runtime: value.buildConfig.runtime,
  resources: Object.fromEntries(resourceFields.map(field => [field, resourceValue(value.serviceConfig, field)])),
  environmentHash: sha(JSON.stringify(value.serviceConfig.environmentVariables || {})),
  secretHash: sha(JSON.stringify(value.serviceConfig.secretEnvironmentVariables || [])),
  eventTrigger: value.eventTrigger || null,
});
const source = metadata.buildConfig.source.storageSource;
const iam = await readCallablePolicy(token, metadata);
const manifestPath = path.join(release, 'manifest.json');
if (mode === 'prepare') {
  const bytes = (await cloud(sourceUrl(source), token)).body;
  const entries = await zipInventory(bytes);
  const original = entries.find(entry => entry.path === changedFile)?.body.toString('utf8');
  assert.ok(original, 'Missing deployed query core');
  assert.equal(original.split(oldClause).length, 2, 'Unexpected deployed validation clause');
  const patched = original.replace(oldClause, newClause);
  assert.equal(normalize(patched), normalize(await fs.readFile(path.join(root, 'functions', changedFile), 'utf8')),
    'Only the reviewed hall-index validation change may differ from production');
  await fs.mkdir(path.dirname(release), { recursive: true });
  await fs.mkdir(release); // Refuse to overwrite an older or partial preparation.
  await fs.writeFile(path.join(release, 'original.zip'), bytes);
  for (const entry of entries) {
    const destination = path.join(release, 'functions', entry.path);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, entry.path === changedFile ? patched : entry.body);
  }
  const expected = await inventory(path.join(release, 'functions'));
  const differences = expected.filter(entry => entry.sha256 !== entries.find(original => original.path === entry.path)?.sha256);
  assert.deepEqual(differences.map(entry => entry.path), [changedFile]);
  await fs.writeFile(path.join(release, 'firebase.json'), JSON.stringify({ functions: {
    source: 'functions', runtime: metadata.buildConfig.runtime,
  } }, null, 2));
  await fs.writeFile(manifestPath, JSON.stringify({ name, source, updateTime: metadata.updateTime,
    archiveSha: sha(bytes), configuration: configuration(metadata), iam, expected }, null, 2));
  console.log(JSON.stringify({ name, mode, release, files: entries.length, changedFiles: [changedFile] }));
} else {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  assert.deepEqual(configuration(metadata), manifest.configuration, 'Runtime configuration changed');
  assert.deepEqual(iam, manifest.iam, 'Invocation permissions changed');
  assert.deepEqual(await inventory(path.join(release, 'functions')), manifest.expected, 'Prepared source changed');
  assert.equal(normalize(await fs.readFile(path.join(release, 'functions', changedFile), 'utf8')),
    normalize(await fs.readFile(path.join(root, 'functions', changedFile), 'utf8')), 'Repository query core changed');
  if (mode === 'preflight') {
    assert.deepEqual(source, manifest.source, 'Function was concurrently deployed');
    assert.equal(metadata.updateTime, manifest.updateTime);
  } else {
    const live = await zipInventory((await cloud(sourceUrl(source), token)).body);
    assert.deepEqual(live.map(({ body, ...entry }) => entry), manifest.expected, 'Deployed source mismatch');
  }
  console.log(JSON.stringify({ name, mode, matches: true, revision: metadata.serviceConfig.revision }));
}
