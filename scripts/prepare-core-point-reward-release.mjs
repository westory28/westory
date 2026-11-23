import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { accessToken, cloud, readCallablePolicy } from './wispi-bonus-claim-release-cloud.mjs';
import { inventory, normalize, resourceFields, resourceValue, sha, sourceUrl, zipInventory } from './prepare-wispi-market-release.mjs';

// Source/configuration reads and local release preparation only. This never
// reads student documents, deploys a function, or changes an application record.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audit = path.join(root, 'output/core-point-reward-20261123');
const release = path.join(audit, 'release');
const functionName = 'executeLessonCorePointCommand';
const region = 'asia-northeast3';
const functionUrl = `https://cloudfunctions.googleapis.com/v2/projects/history-quiz-yongsin/locations/${region}/functions/${functionName}`;
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const mode = process.argv[2];
assert.ok(['prepare', 'before', 'after'].includes(mode), 'Choose prepare, before, or after');
const token = await accessToken();
const metadata = (await cloud(functionUrl, token)).json();
assert.equal(metadata.state, 'ACTIVE');
assert.equal(metadata.buildConfig.runtime, 'nodejs22');
const currentSource = metadata.buildConfig.source.storageSource;
const iam = await readCallablePolicy(token, metadata);

const configuration = value => ({
  runtime: value.buildConfig.runtime,
  resources: Object.fromEntries(resourceFields.map(field => [field, resourceValue(value.serviceConfig, field)])),
  allTrafficOnLatestRevision: value.serviceConfig.allTrafficOnLatestRevision,
  environmentHash: sha(JSON.stringify(value.serviceConfig.environmentVariables || {})),
  secretEnvironmentHash: sha(JSON.stringify(value.serviceConfig.secretEnvironmentVariables || [])),
  eventTrigger: value.eventTrigger || null,
});
const safeOriginalConfiguration = saved => ({
  runtime: saved.buildConfig.runtime,
  resources: Object.fromEntries(resourceFields.map(field => [field, resourceValue(saved.serviceConfig, field)])),
  allTrafficOnLatestRevision: saved.serviceConfig.allTrafficOnLatestRevision,
  environmentHash: saved.environmentHash,
  secretEnvironmentHash: saved.secretEnvironmentHash,
  eventTrigger: saved.eventTrigger || null,
});

if (mode === 'prepare') {
  const comparison = await json(path.join(audit, 'source-comparison.json'));
  const original = path.join(audit, `original-${comparison.generation}`);
  const saved = await json(path.join(original, 'metadata.json'));
  assert.deepEqual(currentSource, saved.buildConfig.source.storageSource, 'A newer deployment exists; review it first');
  assert.equal(metadata.updateTime, saved.updateTime);
  assert.deepEqual(configuration(metadata), safeOriginalConfiguration(saved));
  assert.deepEqual(iam, await json(path.join(original, 'iam.json')));
  const bytes = await fs.readFile(path.join(original, 'source.zip'));
  assert.equal(sha(bytes), comparison.archiveSha);
  const entries = await zipInventory(bytes);
  const file = comparison.sourcePath;
  const entry = entries.find(item => item.path === file);
  assert.ok(entry && file === 'productionGateway/productionSource.js');
  const before = normalize(entry.body.toString('utf8'));
  const timestampBefore = 'const getLessonCorePointTimestampMs = (value) => {\n  if (!value) return 0;\n';
  const timestampAfter = timestampBefore + '  if (typeof value === "number") return Number.isFinite(value) ? value : 0;\n';
  assert.equal(before.split(timestampBefore).length, 2);
  assert.ok(!before.includes(timestampAfter), 'The timestamp fix is already deployed');
  assert.ok(normalize(await fs.readFile(path.join(root, 'functions', file), 'utf8')).includes(timestampAfter));
  const endpointBefore = 'exports.executeLessonCorePointCommand = onCall(\n  { region: REGION },';
  assert.equal(before.split(endpointBefore).length, 2);
  // The live max=20 was not declared in its old source. Declare only this
  // callable's actual limits so a selective deploy cannot drop that setting.
  assert.equal(metadata.serviceConfig.availableMemory, '256Mi');
  assert.equal(String(metadata.serviceConfig.availableCpu), '1');
  assert.equal(metadata.serviceConfig.timeoutSeconds, 60);
  assert.equal(metadata.serviceConfig.maxInstanceRequestConcurrency, 80);
  assert.equal(resourceValue(metadata.serviceConfig, 'minInstanceCount'), 0);
  assert.equal(metadata.serviceConfig.maxInstanceCount, 20);
  const endpointAfter = 'exports.executeLessonCorePointCommand = onCall(\n  { region: REGION, memory: "256MiB", cpu: 1, timeoutSeconds: 60, concurrency: 80, minInstances: 0, maxInstances: 20 },';
  const after = before.replace(timestampBefore, timestampAfter).replace(endpointBefore, endpointAfter);
  await fs.mkdir(release); // Refuse to combine this preparation with stale files.
  const expected = [];
  for (const item of entries) {
    const body = item.path === file ? Buffer.from(after) : item.body;
    const destination = path.join(release, 'functions', item.path);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, body);
    expected.push({ path: item.path, sha256: sha(body) });
  }
  await fs.writeFile(path.join(release, 'firebase.json'), JSON.stringify({
    functions: { source: 'functions', codebase: 'default', runtime: 'nodejs22',
      ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'] },
  }, null, 2) + '\n');
  await fs.writeFile(path.join(release, 'manifest.json'), JSON.stringify({
    functionName, region, originalSource: currentSource, originalUpdateTime: metadata.updateTime,
    configuration: configuration(metadata), iam, expected, changedFiles: [file],
    changes: ['Accept finite numeric core-point revision timestamps', 'Declare the existing callable runtime limits'],
  }, null, 2) + '\n');
  assert.deepEqual(await inventory(path.join(release, 'functions')), expected);
  console.log(JSON.stringify({ prepared: release, functionName, changedFiles: [file], fileCount: expected.length, productionDataReads: 0, productionWrites: 0 }));
} else {
  const manifest = await json(path.join(release, 'manifest.json'));
  assert.equal(manifest.functionName, functionName);
  assert.equal(manifest.region, region);
  assert.deepEqual(await inventory(path.join(release, 'functions')), manifest.expected);
  assert.deepEqual(configuration(metadata), manifest.configuration, 'Runtime/configuration changed');
  assert.deepEqual(iam, manifest.iam, 'Callable IAM changed');
  if (mode === 'before') {
    assert.deepEqual(currentSource, manifest.originalSource, 'Concurrent deployment detected');
    assert.equal(metadata.updateTime, manifest.originalUpdateTime);
  } else {
    const entries = await zipInventory((await cloud(sourceUrl(currentSource), token)).body);
    assert.deepEqual(entries.map(({ body, ...item }) => item), manifest.expected, 'Deployed source differs');
  }
  const report = { checkedAt: new Date().toISOString(), mode, functionName, state: metadata.state,
    revision: metadata.serviceConfig.revision, generation: currentSource.generation,
    sourceAndConfigurationMatch: true, productionDataReads: 0, productionWrites: 0 };
  await fs.writeFile(path.join(audit, `verified-${mode}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
