import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { accessToken, cloud, readOperations, readCallablePolicy } from './wispi-bonus-claim-release-cloud.mjs';
import { sourceUrl, zipInventory, inventory, sha, normalize, resourceFields, resourceValue } from './prepare-wispi-market-release.mjs';
import { assertMetadata } from './prepare-wispi-sector-read-release.mjs';

// This script only reads cloud configuration/source and writes a local release.
// It never reads application documents, invokes callables or deploys functions.
export { accessToken, cloud, readOperations, readCallablePolicy, sourceUrl, zipInventory, inventory, sha, normalize, assertMetadata };
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const audit = path.join(root, 'output/wispi-bonus-claim-20261118/release');
export const baseline = 'f871706426aed7c787c83581317eae7f0a2c15a7';
export const project = 'history-quiz-yongsin', region = 'us-central1';
export const existingTarget = 'transferStudentWisStock';
export const newTargets = ['getStudentWisStockBonus', 'claimStudentWisStockBonus'];
export const allTargets = [existingTarget, ...newTargets];
export const runtimeFiles = ['wisStockDepositCampaign.js', 'wisStockTrading.js', 'wisStockTradingExports.js'];
export const functionUrl = name => `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${region}/functions/${name}`;
export const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const baselineBody = file => git(['show', `${baseline}:functions/${file}`]);
export const expectedInventory = hashes => Object.entries(hashes).map(([file, hash]) => ({ path: file, sha256: hash }))
  .sort((a, b) => a.path.localeCompare(b.path));
export function withinRelease(file) {
  assert.ok(path.resolve(file).startsWith(audit + path.sep), 'Release path escaped its output directory');
  return file;
}
async function immutable(file, value) {
  withinRelease(file);
  const body = typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2);
  try { assert.equal(sha(await fs.readFile(file)), sha(body), `Immutable release evidence changed: ${path.basename(file)}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, body); }
}
function assertTradingRuntime(metadata) {
  assertMetadata(metadata, existingTarget);
  for (const [field, expected] of Object.entries({ availableMemory: '256Mi', availableCpu: '1', timeoutSeconds: 60,
    minInstanceCount: 0, maxInstanceCount: 10, maxInstanceRequestConcurrency: 40 })) {
    const actual = field === 'availableCpu' ? String(metadata.serviceConfig[field]) : resourceValue(metadata.serviceConfig, field);
    assert.equal(actual, expected, `Unexpected trading runtime: ${field}`);
  }
  assert.equal(metadata.eventTrigger, undefined, 'Expected callable source');
}
export async function snapshot(token) {
  try { const saved = await loadSnapshot(); await assertCloudBefore(token, saved); return saved; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const metadata = (await cloud(functionUrl(existingTarget), token)).json();
  assertTradingRuntime(metadata);
  const source = metadata.buildConfig.source.storageSource;
  assert.ok(source.bucket && source.object && /^\d+$/.test(String(source.generation)), 'Versioned archive is required');
  const bytes = (await cloud(sourceUrl(source), token)).body, entries = await zipInventory(bytes);
  const originalInventory = entries.map(({ body, ...entry }) => entry);
  const directory = path.join(audit, 'originals', existingTarget, String(source.generation));
  const comparison = runtimeFiles.map(file => ({ file, baselineMatches:
    normalize(baselineBody(file)) === normalize(entries.find(item => item.path === file)?.body.toString('utf8') || '') }));
  await immutable(path.join(directory, 'source.zip'), bytes);
  await immutable(path.join(directory, 'inventory.json'), originalInventory);
  await immutable(path.join(directory, 'metadata.json'), metadata);
  await immutable(path.join(directory, 'baseline-comparison.json'), comparison);
  const absent = [];
  for (const name of newTargets) {
    const response = await cloud(functionUrl(name), token, { allowMissing: true });
    assert.equal(response.status, 404, `New callable already exists: ${name}`);
    absent.push({ name, status: response.status });
  }
  const operations = await readOperations(token, project, region);
  const campaign = entries.find(item => item.path === 'wisStockDepositCampaign.js')?.body.toString('utf8');
  assert.ok(/THRESHOLD\s*=\s*500\b/.test(campaign || ''), 'Production threshold is not the retained 500 Wis policy');
  const result = { schemaVersion: 1, baseline, project, region, target: { name: existingTarget, directory, metadata, originalInventory, comparison },
    absent, operations, campaignThreshold: 500, productionDataReads: 0, productionWrites: 0 };
  await immutable(path.join(audit, 'snapshot.json'), result);
  console.log(JSON.stringify({ snapshotted: existingTarget, sourceFiles: entries.length, generation: source.generation,
    newCallablesAbsent: absent.map(item => item.name), campaignThreshold: 500,
    baselineDifferences: comparison.filter(item => !item.baselineMatches).map(item => item.file), productionDataReads: 0, productionWrites: 0 }, null, 2));
  return result;
}
export async function loadSnapshot() {
  const saved = await json(path.join(audit, 'snapshot.json'));
  assert.equal(saved.baseline, baseline); assert.equal(saved.project, project); assert.equal(saved.region, region);
  assert.equal(saved.target.name, existingTarget); withinRelease(saved.target.directory);
  assert.deepEqual(saved.absent, newTargets.map(name => ({ name, status: 404 })));
  assert.deepEqual(await json(path.join(saved.target.directory, 'metadata.json')), saved.target.metadata);
  assert.deepEqual(await json(path.join(saved.target.directory, 'inventory.json')), saved.target.originalInventory);
  const entries = await zipInventory(await fs.readFile(path.join(saved.target.directory, 'source.zip')));
  assert.deepEqual(entries.map(({ body, ...entry }) => entry), saved.target.originalInventory, 'Original archive drift');
  return saved;
}
export async function assertCloudBefore(token, saved) {
  const metadata = (await cloud(functionUrl(existingTarget), token)).json();
  assertMetadata(metadata, existingTarget, saved.target.metadata);
  assert.deepEqual(metadata.buildConfig.source.storageSource, saved.target.metadata.buildConfig.source.storageSource,
    'Production source changed after snapshot');
  for (const name of newTargets) assert.equal((await cloud(functionUrl(name), token, { allowMissing: true })).status, 404, `${name}: no longer absent`);
  assert.deepEqual(await readOperations(token, project, region), saved.operations, 'Scheduler/task queue/IAM/settlement source changed');
  try { assert.deepEqual(await readCallablePolicy(token, metadata), await json(path.join(audit, 'callable-iam.json')), 'Existing callable IAM changed'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return metadata;
}

const repositoryOnlyExport = "  result.getWisStockInvestmentHistory = onCall(runtime,\n"
  + "    require('./wisStockInvestmentHistory').createWisStockInvestmentHistory({ db }));\n";
function preserveLiveExportScope(body) {
  assert.equal(normalize(body).split(repositoryOnlyExport).length, 2, 'Repository-only history export changed');
  return normalize(body).replace(repositoryOnlyExport, '');
}
function inspectExports(body) {
  const module = { exports: {} };
  const handlers = new Proxy({}, { get: (_target, name) => functionMarker(String(name)) });
  function functionMarker(name) { return { handler: name }; }
  const wrapper = type => (options, handler) => ({ type, options, ...handler });
  const require = name => {
    if (name === 'firebase-functions/v2/https') return { onCall: wrapper('callable') };
    if (name === 'firebase-functions/v2/tasks') return { onTaskDispatched: wrapper('task') };
    if (name === 'firebase-functions/v2/firestore') return { onDocumentCreated: wrapper('created'), onDocumentWritten: wrapper('written') };
    if (name === 'firebase-functions/v2/scheduler') return { onSchedule: wrapper('schedule') };
    if (name === './wisStockTrading') return { createWisStockTrading: () => handlers };
    throw new Error(`Unexpected release wrapper dependency: ${name}`);
  };
  new vm.Script(body, { filename: 'wisStockTradingExports.js' }).runInNewContext({ module, require }, { timeout: 1000 });
  return JSON.parse(JSON.stringify(module.exports.createWisStockTradingExports({ db: {} })));
}
async function assertPreparedContracts(directory, originals) {
  const live = new Map(originals.map(entry => [entry.path, entry.body.toString('utf8')]));
  const before = inspectExports(live.get('wisStockTradingExports.js'));
  const after = inspectExports(await fs.readFile(path.join(directory, 'wisStockTradingExports.js'), 'utf8'));
  assert.deepEqual(Object.keys(after).sort(), [...Object.keys(before), ...newTargets].sort(), 'Unexpected export scope');
  for (const name of Object.keys(before)) assert.deepEqual(after[name], before[name], `Existing wrapper changed: ${name}`);
  for (const name of newTargets) {
    assert.equal(after[name].type, 'callable'); assert.equal(after[name].handler, name);
    assert.deepEqual(after[name].options, before[existingTarget].options, `${name}: runtime differs from trading callable`);
  }
  const index = await fs.readFile(path.join(directory, 'index.js'), 'utf8');
  assert.equal(index, live.get('index.js'), 'Live entrypoint must be preserved byte for byte');
  const connection = "Object.assign(exports, require('./wisStockTradingExports').createWisStockTradingExports({ db: getFirestore() }));";
  assert.equal(index.split(connection).length, 2, 'Unexpected live trading factory connection');
  const packageJson = await json(path.join(directory, 'package.json'));
  assert.equal(String(packageJson.engines.node), '22');
  for (const file of ['index.js', ...runtimeFiles]) execFileSync(process.execPath, ['--check', path.join(directory, file)], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const file of runtimeFiles) {
    const repository = await fs.readFile(path.join(root, 'functions', file), 'utf8');
    const expected = file === 'wisStockTradingExports.js' ? preserveLiveExportScope(repository) : normalize(repository);
    assert.equal(normalize(await fs.readFile(path.join(directory, file), 'utf8')), expected, `Prepared behavior differs from reviewed delta: ${file}`);
  }
  return { existingExports: Object.keys(before).sort(), addedExports: newTargets,
    entrypointPreserved: true, packageAndLockfilePreserved: true, runtime: after[existingTarget].options };
}
export async function collectPatches() {
  const changedRuntime = (git(['diff', '--name-only', baseline, '--', 'functions'])
    + git(['ls-files', '--others', '--exclude-standard', '--', 'functions'])).split(/\r?\n/)
    .filter(file => /^functions\/[^/]+\.(?:mjs|js)$/.test(file));
  for (const file of changedRuntime) assert.ok(runtimeFiles.includes(file.slice(10)), `Unreviewed runtime change: ${file}`);
  const patches = [];
  for (const file of runtimeFiles) {
    const old = baselineBody(file), body = await fs.readFile(path.join(root, 'functions', file));
    assert.notEqual(normalize(old), normalize(body.toString('utf8')), `Expected backend delta is missing: ${file}`);
    // One exact context line avoids importing the unrelated repository-only
    // investment-history export absent from this callable's live archive.
    const patch = git(['diff', '--no-ext-diff', '--no-color', '--unified=1', baseline, '--', `functions/${file}`]);
    assert.ok(patch.startsWith(`diff --git a/functions/${file} b/functions/${file}`));
    patches.push({ file, baselineSha256: sha(normalize(old)), repositorySha256: sha(body), patchSha256: sha(patch), patch });
  }
  return patches;
}
const patchMetadata = patches => patches.map(({ patch, ...value }) => value);
const deploymentCommand = `firebase deploy --only "${allTargets.map(name => `functions:${name}`).join(',')}" --project ${project} --config firebase.json`;
const firebaseConfig = { functions: { source: 'functions', codebase: 'default',
  ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'] } };
async function applyDelta(destination, patch) {
  const relative = path.relative(root, destination).replaceAll('\\', '/');
  assert.ok(relative.startsWith('output/') && !relative.startsWith('..'));
  for (const check of [true, false]) execFileSync('git', ['apply', ...(check ? ['--check'] : []),
    '--whitespace=nowarn', '-p2', `--directory=${relative}`], { cwd: root, input: patch.patch, stdio: ['pipe', 'pipe', 'pipe'] });
}
export async function prepare(token, saved) {
  await assertCloudBefore(token, saved);
  const callableIam = await readCallablePolicy(token, saved.target.metadata);
  assert.ok(callableIam.bindings.some(binding => binding.role === 'roles/run.invoker' && binding.members.includes('allUsers')),
    'Review callable transport IAM: expected public transport with application auth/session checks');
  await immutable(path.join(audit, 'callable-iam.json'), callableIam);
  const patches = await collectPatches(), patchSetSha256 = sha(JSON.stringify(patchMetadata(patches)));
  const originals = await zipInventory(await fs.readFile(path.join(saved.target.directory, 'source.zip')));
  for (const file of runtimeFiles) {
    const before = originals.find(entry => entry.path === file)?.body.toString('utf8');
    assert.equal(normalize(before || ''), file === 'wisStockTradingExports.js'
      ? preserveLiveExportScope(baselineBody(file)) : normalize(baselineBody(file)), `${file}: unreviewed live baseline difference`);
  }
  const key = sha(JSON.stringify([saved.target.originalInventory, patchSetSha256])).slice(0, 24);
  const directory = path.join(audit, 'prepared', key), destination = path.join(directory, 'functions');
  // Reusing a completed package is read-only; never overwrite a prepared source
  // tree that may already be the basis for a deploy or an audit.
  try {
    const manifest = await json(path.join(directory, 'manifest.json'));
    const prepared = { directory, ...manifest };
    await validatePrepared(prepared, saved);
    await fs.writeFile(path.join(audit, 'prepared.json'), JSON.stringify(prepared, null, 2));
    return prepared;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const entry of originals) {
    const file = withinRelease(path.join(destination, entry.path));
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, entry.body);
  }
  for (const patch of patches) {
    try { await applyDelta(destination, patch); }
    catch (error) { throw new Error(`Exact repository delta cannot be applied to ${patch.file}: ${String(error.stderr || error.message)}`); }
  }
  const contracts = await assertPreparedContracts(destination, originals), expected = await inventory(destination);
  assert.deepEqual(expected.map(entry => entry.path), saved.target.originalInventory.map(entry => entry.path), 'Unexpected release file');
  for (const original of saved.target.originalInventory) if (!runtimeFiles.includes(original.path))
    assert.equal(expected.find(entry => entry.path === original.path)?.sha256, original.sha256, `Unrelated source changed: ${original.path}`);
  const manifest = { schemaVersion: 1, baseline, project, region, patchSetSha256, changes: patchMetadata(patches),
    targets: allTargets, existingTarget, newTargets, originalDirectory: saved.target.directory,
    originalMetadata: saved.target.metadata, originalInventory: saved.target.originalInventory,
    expectedHashes: Object.fromEntries(expected.map(entry => [entry.path, entry.sha256])), contracts, callableIam,
    deploymentCommand, productionDataReads: 0, productionWrites: 0 };
  await immutable(path.join(directory, 'firebase.json'), firebaseConfig);
  await immutable(path.join(directory, 'manifest.json'), manifest);
  const prepared = { directory, ...manifest };
  await fs.writeFile(path.join(audit, 'prepared.json'), JSON.stringify(prepared, null, 2));
  await validatePrepared(prepared, saved);
  console.log(JSON.stringify({ directory, targets: allTargets, patchSetSha256, sourceFiles: expected.length,
    changes: patches.map(item => item.file), preservedFiles: expected.length - patches.length, contracts, productionWrites: 0 }, null, 2));
  return prepared;
}
export const loadPrepared = () => json(path.join(audit, 'prepared.json'));
export async function validatePrepared(prepared, saved) {
  withinRelease(prepared.directory);
  assert.equal(prepared.schemaVersion, 1); assert.equal(prepared.baseline, baseline);
  assert.equal(prepared.project, project); assert.equal(prepared.region, region);
  assert.deepEqual(prepared.targets, allTargets); assert.deepEqual(prepared.newTargets, newTargets);
  assert.equal(prepared.existingTarget, existingTarget); assert.equal(prepared.deploymentCommand, deploymentCommand);
  const changes = patchMetadata(await collectPatches());
  assert.deepEqual(prepared.changes, changes, 'Repository delta changed after release preparation');
  assert.equal(prepared.patchSetSha256, sha(JSON.stringify(changes)));
  assert.equal(prepared.originalDirectory, saved.target.directory);
  assert.deepEqual(prepared.originalMetadata, saved.target.metadata);
  assert.deepEqual(prepared.originalInventory, saved.target.originalInventory);
  assert.deepEqual(prepared.callableIam, await json(path.join(audit, 'callable-iam.json')));
  const { directory, ...manifest } = prepared;
  assert.deepEqual(await json(path.join(directory, 'manifest.json')), manifest);
  assert.deepEqual(await json(path.join(directory, 'firebase.json')), firebaseConfig);
  assert.deepEqual(await inventory(path.join(directory, 'functions')), expectedInventory(prepared.expectedHashes), 'Prepared source drift');
  assert.deepEqual(Object.keys(prepared.expectedHashes).sort(), saved.target.originalInventory.map(entry => entry.path).sort());
  for (const original of saved.target.originalInventory) if (!runtimeFiles.includes(original.path))
    assert.equal(prepared.expectedHashes[original.path], original.sha256, `Unrelated source changed: ${original.path}`);
  const originals = await zipInventory(await fs.readFile(path.join(saved.target.directory, 'source.zip')));
  assert.deepEqual(await assertPreparedContracts(path.join(directory, 'functions'), originals), prepared.contracts);
}
export function assertReleasedMetadata(metadata, name, before) {
  if (name === existingTarget) { assertMetadata(metadata, name, before); return; }
  assert.ok(newTargets.includes(name)); assertMetadata(metadata, name);
  for (const field of [...resourceFields, 'secretEnvironmentVariables', 'allTrafficOnLatestRevision'])
    assert.deepEqual(resourceValue(metadata.serviceConfig, field), resourceValue(before.serviceConfig, field), `${name}: runtime differs: ${field}`);
  const expectedEnvironment = { ...before.serviceConfig.environmentVariables, FUNCTION_TARGET: name,
    EVENTARC_CLOUD_EVENT_SOURCE: `projects/${project}/locations/${region}/services/${name}` };
  const actualEnvironment = { ...metadata.serviceConfig.environmentVariables };
  // Functions Framework defaults this optional platform marker to HTTP.
  // Normalize absence only for new HTTP callables; reject any other value.
  // https://github.com/GoogleCloudPlatform/functions-framework#specification-summary
  if (!Object.hasOwn(actualEnvironment, 'FUNCTION_SIGNATURE_TYPE')) {
    assert.equal(expectedEnvironment.FUNCTION_SIGNATURE_TYPE, 'http');
    actualEnvironment.FUNCTION_SIGNATURE_TYPE = 'http';
  }
  assert.deepEqual(actualEnvironment, expectedEnvironment, `${name}: unexpected environment`);
  assert.equal(metadata.eventTrigger, undefined);
  for (const field of ['runtime', 'environmentVariables', 'workerPool', 'serviceAccount'])
    assert.deepEqual(metadata.buildConfig[field] ?? null, before.buildConfig[field] ?? null, `${name}: build field differs: ${field}`);
  assert.equal(metadata.labels?.['deployment-callable'], 'true');
}

async function main() {
  assert.equal(path.resolve(git(['rev-parse', '--show-toplevel']).trim()).toLowerCase(), root.toLowerCase());
  assert.ok(process.argv.length === 3 && ['--snapshot-only', '--prepare'].includes(process.argv[2]), 'Choose --snapshot-only or --prepare');
  const token = await accessToken();
  if (process.argv[2] === '--snapshot-only') await snapshot(token);
  else await prepare(token, await loadSnapshot());
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
