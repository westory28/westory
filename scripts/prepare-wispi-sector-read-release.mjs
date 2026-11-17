import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { accessToken } from './prepare-wis-stock-schedule-release.mjs';
import { readCloud, sourceUrl, zipInventory, inventory, sha, normalize, resourceFields, resourceValue } from './prepare-wispi-market-release.mjs';

// Read-only cloud inspection and local packaging; never deploys or queries application data.
export { accessToken, readCloud, sourceUrl, zipInventory, inventory, sha, normalize, resourceFields, resourceValue };
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const audit = path.join(root, 'output/wispi-sector-read-optimization-20261117/release');
export const baseline = 'a603d4420cabdb5bb51e11c2b32c276734de6962';
export const project = 'history-quiz-yongsin', region = 'us-central1';
export const writers = ['transferStudentWisStock', 'placeStudentWisStockOrder', 'cancelStudentWisStockOrder',
  'settleWisStockOrderTask', 'onWisStockMarketTradingWrite', 'onWisStockEnrollmentSlotWritten', 'recoverWisStockOrders'];
export const reader = 'getWisStockInvestmentHistory', priceScheduler = 'advanceWisStockPrices';
export const allTargets = [...writers, reader, priceScheduler];
export const parser = 'wisStockInvestmentBoard.mjs';
export const priceDependencies = ['wisStockCatalog.json', 'wisStockPriceModel.js', 'wisStockMarketRules.mjs'];
export const targetsFor = phase => phase === 'bootstrap' ? [...writers, reader] : [...writers, priceScheduler];
export const filesFor = (phase, name) => phase === 'bootstrap' ? [parser] : name === priceScheduler
  ? ['wisStocks.js', 'wisStockPriceModel.mjs', 'wisStockMarketFactors.mjs'] : [parser, 'wisStockTrading.js'];
export const functionUrl = name => `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${region}/functions/${name}`;
export const baselineText = file => execFileSync('git', ['show', `${baseline}:functions/${file}`], { cwd: root, encoding: 'utf8' });
const json = async filename => JSON.parse(await fs.readFile(filename, 'utf8'));
export const expectedInventory = hashes => Object.entries(hashes).map(([file, hash]) => ({ path: file, sha256: hash })).sort((a, b) => a.path.localeCompare(b.path));
export const runtimeFields = [...resourceFields, 'environmentVariables', 'secretEnvironmentVariables', 'allTrafficOnLatestRevision'];
const eventConfiguration = trigger => trigger ? { ...trigger, eventFilters: [...(trigger.eventFilters || [])]
  .sort((a, b) => a.attribute.localeCompare(b.attribute)) } : null;
export function assertMetadata(metadata, name, before) {
  assert.equal(metadata.name, `projects/${project}/locations/${region}/functions/${name}`);
  assert.equal(metadata.state, 'ACTIVE', name);
  assert.equal(metadata.buildConfig.runtime, 'nodejs22', name);
  assert.equal(metadata.buildConfig.entryPoint, name);
  if (before) {
    for (const field of runtimeFields) assert.ok(isDeepStrictEqual(resourceValue(metadata.serviceConfig, field),
      resourceValue(before.serviceConfig, field)), `${name}: runtime field changed: ${field}`);
    assert.ok(isDeepStrictEqual(eventConfiguration(metadata.eventTrigger), eventConfiguration(before.eventTrigger)), `${name}: event trigger changed`);
    for (const field of ['runtime', 'entryPoint', 'environmentVariables', 'workerPool', 'serviceAccount'])
      assert.ok(isDeepStrictEqual(metadata.buildConfig[field] ?? null, before.buildConfig[field] ?? null), `${name}: build field changed: ${field}`);
  }
}
const schedulerConfiguration = job => Object.fromEntries(['name', 'schedule', 'timeZone', 'state', 'attemptDeadline',
  'retryConfig', 'httpTarget', 'pubsubTarget'].map(field => [field, job[field] ?? null]));
const policyConfiguration = policy => ({ version: policy.version || 1, bindings: [...(policy.bindings || [])]
  .map(binding => ({ ...binding, members: [...binding.members].sort() })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });
export async function readOperationalConfiguration(token, metadata) {
  const schedulers = await Promise.all([priceScheduler, 'recoverWisStockOrders'].map(async name => {
    const job = await (await readCloud(`https://cloudscheduler.googleapis.com/v1/projects/${project}/locations/${region}/jobs/firebase-schedule-${name}-${region}`, token)).json();
    assert.equal(job.timeZone, 'Asia/Seoul'); assert.equal(job.state, 'ENABLED');
    assert.equal(job.schedule, name === priceScheduler ? '0 * * * *' : 'every 5 minutes');
    return { name, configuration: schedulerConfiguration(job) };
  }));
  const queueUrl = `https://cloudtasks.googleapis.com/v2/projects/${project}/locations/${region}/queues/settleWisStockOrderTask`;
  const queue = await (await readCloud(queueUrl, token)).json();
  const queuePolicyResponse = await fetch(queueUrl + ':getIamPolicy', { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(60000) });
  assert.ok(queuePolicyResponse.ok, `Read-only task IAM inspection failed: HTTP ${queuePolicyResponse.status}`);
  const task = metadata.find(item => item.buildConfig.entryPoint === 'settleWisStockOrderTask');
  assert.ok(task?.serviceConfig.service, 'Missing settlement Cloud Run service');
  const runPolicy = await (await readCloud(`https://run.googleapis.com/v2/${task.serviceConfig.service}:getIamPolicy`, token)).json();
  return { schedulers, queue: Object.fromEntries(['name', 'state', 'rateLimits', 'retryConfig', 'stackdriverLoggingConfig',
    'httpTarget', 'appEngineHttpQueue'].map(field => [field, queue[field] ?? null])),
    queuePolicy: policyConfiguration(await queuePolicyResponse.json()), runPolicy: policyConfiguration(runPolicy) };
}
async function writeImmutable(filename, value) {
  const body = typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2);
  try { const existing = await fs.readFile(filename); assert.equal(sha(existing), sha(body), `Immutable snapshot changed: ${path.basename(filename)}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, body); }
}
async function snapshot(token) {
  const targets = [], downloads = new Map();
  let cursor = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < allTargets.length) {
      const name = allTargets[cursor++], metadata = await (await readCloud(functionUrl(name), token)).json();
      assertMetadata(metadata, name);
      const source = metadata.buildConfig.source.storageSource;
      assert.ok(source.bucket && source.object && /^\d+$/.test(String(source.generation)), `${name}: versioned source required`);
      const url = sourceUrl(source);
      if (!downloads.has(url)) downloads.set(url, readCloud(url, token).then(response => response.arrayBuffer()).then(Buffer.from));
      const bytes = await downloads.get(url), entries = await zipInventory(bytes);
      const directory = path.join(audit, 'originals', name, String(source.generation));
      const originalInventory = entries.map(({ body, ...entry }) => entry), files = new Map(entries.map(entry => [entry.path, entry]));
      const compared = name === priceScheduler ? ['wisStocks.js', 'wisStockPriceModel.mjs'] : [parser, 'wisStockTrading.js', 'wisStockInvestmentHistory.js'];
      const comparisons = compared.map(file => ({ file, baselineMatches: normalize(files.get(file)?.body.toString('utf8') || '') === normalize(baselineText(file)) }));
      await writeImmutable(path.join(directory, 'source.zip'), bytes);
      await writeImmutable(path.join(directory, 'inventory.json'), originalInventory);
      // Metadata is captured once with the initial generation; live conditions are verified separately.
      try { await fs.access(path.join(directory, 'metadata.json')); } catch { await writeImmutable(path.join(directory, 'metadata.json'), metadata); }
      targets.push({ name, directory, metadata, originalInventory, comparisons });
      console.log(JSON.stringify({ snapshotted: name, files: entries.length, generation: source.generation, comparisons }));
    }
  }));
  targets.sort((a, b) => a.name.localeCompare(b.name));
  const operations = await readOperationalConfiguration(token, targets.map(target => target.metadata));
  const result = { schemaVersion: 1, baseline, project, region, targets, operations, productionDataReads: 0, productionWrites: 0 };
  await writeImmutable(path.join(audit, 'snapshot.json'), result);
  return result;
}
export async function loadSnapshot() {
  const saved = await json(path.join(audit, 'snapshot.json'));
  assert.equal(saved.baseline, baseline); assert.equal(saved.project, project); assert.equal(saved.region, region);
  assert.deepEqual(saved.targets.map(target => target.name).sort(), [...allTargets].sort());
  for (const target of saved.targets) {
    assert.ok(path.resolve(target.directory).startsWith(path.join(audit, 'originals') + path.sep));
    const entries = await zipInventory(await fs.readFile(path.join(target.directory, 'source.zip')));
    assert.deepEqual(entries.map(({ body, ...entry }) => entry), target.originalInventory, `${target.name}: original archive changed`);
    if (target.name === priceScheduler) for (const file of priceDependencies) {
      const deployed = entries.find(entry => entry.path === file);
      assert.ok(deployed, `Missing scheduler dependency: ${file}`);
      assert.ok(normalize(deployed.body.toString('utf8')) === normalize(baselineText(file)), `Unreviewed scheduler dependency: ${file}`);
      assert.ok(normalize(await fs.readFile(path.join(root, 'functions', file), 'utf8')) === normalize(baselineText(file)), `Out-of-scope scheduler dependency changed: ${file}`);
    }
  }
  return saved;
}
export async function assertCloudBefore(token, saved, phase, bootstrap) {
  const current = [];
  for (const target of saved.targets) {
    const metadata = await (await readCloud(functionUrl(target.name), token)).json(); assertMetadata(metadata, target.name, target.metadata);
    if (phase === 'final' && target.name !== priceScheduler) {
      const group = bootstrap.find(group => group.targets.some(item => item.name === target.name)); assert.ok(group, `Missing parser bootstrap: ${target.name}`);
      const entries = await zipInventory(Buffer.from(await (await readCloud(sourceUrl(metadata.buildConfig.source.storageSource), token)).arrayBuffer()));
      assert.ok(isDeepStrictEqual(entries.map(({ body, ...entry }) => entry), expectedInventory(group.expectedHashes)), `${target.name}: bootstrap source not deployed or changed`);
    } else assert.ok(isDeepStrictEqual(metadata.buildConfig.source.storageSource, target.metadata.buildConfig.source.storageSource), `${target.name}: initial source changed`);
    current.push(metadata);
  }
  assert.ok(isDeepStrictEqual(await readOperationalConfiguration(token, current), saved.operations), 'Scheduler/task queue/IAM configuration changed');
  return current;
}
export async function loadPrepared(phase) { return json(path.join(audit, `prepared-${phase}.json`)); }
export async function validatePrepared(phase, groups, saved) {
  assert.deepEqual(groups.flatMap(group => group.targets.map(target => target.name)).sort(), targetsFor(phase).sort(), 'Unexpected or duplicate deployment target');
  for (const group of groups) {
    assert.equal(group.schemaVersion, 1); assert.equal(group.phase, phase); assert.equal(group.baseline, baseline);
    assert.equal(group.project, project); assert.equal(group.region, region);
    assert.ok(path.resolve(group.directory).startsWith(path.join(audit, 'prepared', phase) + path.sep), 'Package outside release scope');
    assert.deepEqual(await json(path.join(group.directory, 'manifest.json')), Object.fromEntries(Object.entries(group).filter(([key]) => key !== 'directory')), 'Manifest mismatch');
    const expected = expectedInventory(group.expectedHashes);
    assert.deepEqual(await inventory(path.join(group.directory, 'functions')), expected, 'Prepared source changed');
    for (const target of group.targets) {
      const original = saved.targets.find(item => item.name === target.name);
      assert.deepEqual(group.changes, filesFor(phase, target.name));
      assert.equal(target.originalDirectory, original.directory);
      assert.deepEqual(group.originalInventory, original.originalInventory, 'Only byte-identical original archives may share a package');
      assertMetadata(target.metadata, target.name, original.metadata);
    }
    assert.deepEqual(group.added, group.changes.filter(file => !group.originalInventory.some(entry => entry.path === file)));
    assert.deepEqual(expected.map(entry => entry.path).sort(), [...group.originalInventory.map(entry => entry.path), ...group.added].sort());
    for (const original of group.originalInventory) if (!group.changes.includes(original.path))
      assert.equal(group.expectedHashes[original.path], original.sha256, `Out-of-scope source change: ${original.path}`);
    for (const file of group.changes) assert.equal(sha(await fs.readFile(path.join(root, 'functions', file))), group.expectedHashes[file], `Repository patch changed: ${file}`);
  }
}
async function main() {
  const args = process.argv.slice(2); assert.ok(args.every(arg => ['--snapshot-only', '--phase=bootstrap', '--phase=final'].includes(arg)), 'Unsupported argument');
  assert.ok(!(args.includes('--phase=bootstrap') && args.includes('--phase=final')), 'Choose one phase');
  assert.equal(path.resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim()).toLowerCase(), root.toLowerCase());
  const token = await accessToken();
  if (args.includes('--snapshot-only')) { await snapshot(token); return; }
  const phase = args.includes('--phase=final') ? 'final' : 'bootstrap', saved = await loadSnapshot();
  for (const target of saved.targets) for (const comparison of target.comparisons) {
    // Unused modules in function-specific archives have intentionally different release histories.
    // Only the selected runtime modules are replaced; every other byte remains from that archive.
    const relevant = target.name === reader ? [parser, 'wisStockInvestmentHistory.js'] : target.name === priceScheduler
      ? ['wisStocks.js', 'wisStockPriceModel.mjs'] : [parser, 'wisStockTrading.js'];
    if (relevant.includes(comparison.file)) assert.ok(comparison.baselineMatches, `Unreviewed baseline difference: ${target.name}/${comparison.file}`);
  }
  const bootstrap = phase === 'final' ? await loadPrepared('bootstrap') : [];
  if (phase === 'final') await validatePrepared('bootstrap', bootstrap, saved);
  const current = await assertCloudBefore(token, saved, phase, bootstrap), groups = new Map();
  for (const name of targetsFor(phase)) {
    const source = saved.targets.find(target => target.name === name), files = filesFor(phase, name);
    const entries = await zipInventory(await fs.readFile(path.join(source.directory, 'source.zip'))), bodies = new Map(entries.map(entry => [entry.path, entry.body]));
    const patches = new Map(await Promise.all(files.map(async file => [file, await fs.readFile(path.join(root, 'functions', file))])));
    if (phase === 'final' && name !== priceScheduler) {
      const prepared = bootstrap.find(group => group.targets.some(target => target.name === name));
      assert.equal(sha(patches.get(parser)), prepared.expectedHashes[parser], 'Parser changed after bootstrap review');
    }
    for (const [file, body] of patches) {
      if (file === 'wisStockMarketFactors.mjs') assert.ok(!bodies.has(file), `${name}: new factor module already exists`);
      else assert.ok(bodies.has(file), `${name}: missing original ${file}`);
      assert.notEqual(normalize(body.toString('utf8')), normalize(bodies.get(file)?.toString('utf8') || ''), `${name}: missing patch ${file}`);
      bodies.set(file, body);
    }
    const expected = [...bodies].map(([file, body]) => ({ path: file, sha256: sha(body) })).sort((a, b) => a.path.localeCompare(b.path));
    const key = sha(JSON.stringify([phase, source.originalInventory, expected])).slice(0, 20);
    if (!groups.has(key)) groups.set(key, { key, bodies, expected, originalInventory: source.originalInventory, changes: files, targets: [] });
    const metadata = current.find(item => item.buildConfig.entryPoint === name);
    groups.get(key).targets.push({ name, metadata, originalDirectory: source.directory });
  }
  const prepared = [];
  for (const group of groups.values()) {
    const directory = path.join(audit, 'prepared', phase, group.key), destination = path.join(directory, 'functions');
    for (const [file, body] of group.bodies) { await fs.mkdir(path.dirname(path.join(destination, file)), { recursive: true }); await fs.writeFile(path.join(destination, file), body); }
    assert.deepEqual(await inventory(destination), group.expected, 'Unexpected file or lost production source');
    for (const file of group.changes) execFileSync(process.execPath, ['--check', path.join(destination, file)]);
    const manifest = { schemaVersion: 1, phase, baseline, project, region, changes: group.changes,
      added: group.changes.filter(file => !group.originalInventory.some(entry => entry.path === file)), targets: group.targets,
      originalInventory: group.originalInventory, expectedHashes: Object.fromEntries(group.expected.map(entry => [entry.path, entry.sha256])),
      productionDataReads: 0, productionWrites: 0,
      deploymentCommand: `firebase deploy --only "${group.targets.map(target => 'functions:' + target.name).join(',')}" --project ${project} --config firebase.json` };
    await fs.writeFile(path.join(directory, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', codebase: 'default',
      ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'] } }, null, 2));
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
    for (const file of group.changes) assert.equal(sha(await fs.readFile(path.join(root, 'functions', file))), manifest.expectedHashes[file], `Repository changed during preparation: ${file}`);
    prepared.push({ directory, ...manifest });
  }
  await fs.writeFile(path.join(audit, `prepared-${phase}.json`), JSON.stringify(prepared, null, 2));
  await validatePrepared(phase, prepared, saved);
  console.log(JSON.stringify({ phase, groups: prepared.map(group => ({ directory: group.directory, targets: group.targets.map(target => target.name), changes: group.changes })) }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
