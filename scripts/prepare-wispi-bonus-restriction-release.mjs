import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { accessToken } from './prepare-wis-stock-schedule-release.mjs';
import { readCloud, sourceUrl, zipInventory, inventory, sha, normalize } from './prepare-wispi-market-release.mjs';
import { assertMetadata, readOperationalConfiguration } from './prepare-wispi-sector-read-release.mjs';

// Read-only cloud inspection and local packaging. No callable, data query,
// deployment, wallet mutation, scheduler invocation or entrypoint replacement.
export { accessToken, readCloud, sourceUrl, zipInventory, inventory, sha, assertMetadata, readOperationalConfiguration };
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const audit = path.join(root, 'output/wispi-event-principal-lock-20261117/release');
export const baseline = 'e911d76788c9b4dcb1a0147cf089227b26c23871';
export const project = 'history-quiz-yongsin', region = 'us-central1';
export const reader = 'getWisStockInvestmentHistory';
export const tradingTargets = ['getStudentWisStockState', 'getStudentWisStockHistory', 'transferStudentWisStock',
  'placeStudentWisStockOrder', 'cancelStudentWisStockOrder', 'settleWisStockOrderTask', 'onWisStockOrderCreated',
  'onWisStockMarketTradingWrite', 'onWisStockEnrollmentSlotWritten', 'recoverWisStockOrders'];
export const allTargets = [...tradingTargets, reader];
// Only these reviewed runtime files may receive the repository delta. The
// function-specific live index, runtime wrappers and every other file survive.
export const tradingFiles = ['wisStockAccount.js', 'wisStockAccount.mjs', 'wisStockOrderLifecycle.js',
  'wisStockOrderLifecycle.mjs', 'wisStockTrading.js', 'wisStockGraduation.js', 'wisStockDepositCampaign.js',
  'wisStockBonusAccounting.js', 'wisStockBonusAccounting.mjs', 'wisStockBonusMigration.js'];
export const readerFiles = ['wisStockInvestmentHistory.js'];
export const functionUrl = name => `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${region}/functions/${name}`;
export const expectedInventory = hashes => Object.entries(hashes).map(([file, hash]) => ({ path: file, sha256: hash }))
  .sort((a, b) => a.path.localeCompare(b.path));
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const baselineBody = file => {
  try { return git(['show', `${baseline}:functions/${file}`]); }
  catch (error) { if (error.status === 128) return null; throw error; }
};
function withinRelease(file) {
  assert.ok(path.resolve(file).startsWith(audit + path.sep), 'Release path escaped its output directory');
  return file;
}
async function immutable(file, value) {
  withinRelease(file);
  const body = typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2);
  try { assert.equal(sha(await fs.readFile(file)), sha(body), `Immutable release evidence changed: ${path.basename(file)}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, body); }
}
export async function snapshot(token) {
  try { const saved = await loadSnapshot(); await assertCloudBefore(token, saved); return saved; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const targets = [], downloads = new Map(); let cursor = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < allTargets.length) {
      const name = allTargets[cursor++], metadata = await (await readCloud(functionUrl(name), token)).json();
      assertMetadata(metadata, name);
      const source = metadata.buildConfig.source.storageSource;
      assert.ok(source.bucket && source.object && /^\d+$/.test(String(source.generation)), `${name}: versioned archive required`);
      const url = sourceUrl(source);
      if (!downloads.has(url)) downloads.set(url, readCloud(url, token).then(response => response.arrayBuffer()).then(Buffer.from));
      const bytes = await downloads.get(url), entries = await zipInventory(bytes);
      const originalInventory = entries.map(({ body, ...entry }) => entry);
      const directory = path.join(audit, 'originals', name, String(source.generation));
      const comparison = [];
      for (const file of name === reader ? readerFiles : tradingFiles) {
        const old = baselineBody(file), live = entries.find(entry => entry.path === file);
        comparison.push({ file, exists: !!live, baselineExists: old !== null,
          baselineMatches: old !== null && !!live && normalize(old) === normalize(live.body.toString('utf8')) });
      }
      await immutable(path.join(directory, 'source.zip'), bytes);
      await immutable(path.join(directory, 'inventory.json'), originalInventory);
      await immutable(path.join(directory, 'metadata.json'), metadata);
      await immutable(path.join(directory, 'baseline-comparison.json'), comparison);
      targets.push({ name, directory, metadata, originalInventory, comparison });
      console.log(JSON.stringify({ snapshotted: name, sourceFiles: entries.length, generation: source.generation,
        baselineDifferences: comparison.filter(item => item.baselineExists && !item.baselineMatches).map(item => item.file) }));
    }
  }));
  targets.sort((a, b) => a.name.localeCompare(b.name));
  const operations = await readOperationalConfiguration(token, targets.map(target => target.metadata));
  const result = { schemaVersion: 1, baseline, project, region, targets, operations, productionDataReads: 0, productionWrites: 0 };
  await immutable(path.join(audit, 'snapshot.json'), result);
  return result;
}
export async function loadSnapshot() {
  const saved = await json(path.join(audit, 'snapshot.json'));
  assert.equal(saved.baseline, baseline); assert.equal(saved.project, project); assert.equal(saved.region, region);
  assert.deepEqual(saved.targets.map(target => target.name).sort(), [...allTargets].sort());
  for (const target of saved.targets) {
    withinRelease(target.directory);
    assert.deepEqual(await json(path.join(target.directory, 'metadata.json')), target.metadata);
    assert.deepEqual(await json(path.join(target.directory, 'inventory.json')), target.originalInventory);
    const entries = await zipInventory(await fs.readFile(path.join(target.directory, 'source.zip')));
    assert.deepEqual(entries.map(({ body, ...entry }) => entry), target.originalInventory, `${target.name}: original archive drift`);
  }
  return saved;
}
export async function assertCloudBefore(token, saved, selected = allTargets) {
  const metadata = [];
  for (const original of saved.targets) {
    const current = await (await readCloud(functionUrl(original.name), token)).json();
    assertMetadata(current, original.name, original.metadata);
    if (selected.includes(original.name)) assert.deepEqual(current.buildConfig.source.storageSource,
      original.metadata.buildConfig.source.storageSource, `${original.name}: production changed after snapshot`);
    metadata.push(current);
  }
  assert.ok(isDeepStrictEqual(await readOperationalConfiguration(token, metadata), saved.operations), 'Scheduler/task queue/IAM changed');
  return metadata;
}
export async function collectPatches() {
  const files = [...tradingFiles, ...readerFiles], result = [];
  // A changed runtime file outside the allowlist needs a deliberate scope review.
  const changedRuntime = (git(['diff', '--name-only', baseline, '--', 'functions'])
    + git(['ls-files', '--others', '--exclude-standard', '--', 'functions'])).split(/\r?\n/)
    .filter(file => /^functions\/[^/]+\.(?:mjs|js)$/.test(file));
  for (const file of changedRuntime) assert.ok(files.includes(file.slice(10)), `Unreviewed runtime change: ${file}`);
  for (const file of files) {
    const old = baselineBody(file);
    let body; try { body = await fs.readFile(path.join(root, 'functions', file)); }
    catch (error) { if (error.code === 'ENOENT' && old === null) continue; throw error; }
    if (old !== null && normalize(old) === normalize(body.toString('utf8'))) continue;
    const patch = old === null ? null : git(['diff', '--no-ext-diff', '--no-color', '--unified=3', baseline, '--', `functions/${file}`]);
    assert.ok(old === null || patch.includes(`diff --git a/functions/${file} b/functions/${file}`), `Missing patch: ${file}`);
    const added = old === null;
    result.push({ file, added, repositorySha256: sha(body), baselineSha256: added ? null : sha(normalize(old)),
      patchSha256: added ? null : sha(patch), patch, body });
  }
  assert.ok(result.some(item => item.file === 'wisStockTrading.js'), 'Trading policy patch is not ready');
  assert.ok(result.some(item => item.file === readerFiles[0]), 'Schema reader compatibility patch is not ready');
  assert.ok(result.some(item => item.file === 'wisStockBonusAccounting.mjs'), 'Bonus accounting module is not ready');
  return result;
}
function patchMetadata(patches) { return patches.map(({ patch, body, ...item }) => item); }
async function writeSources(destination, entries) {
  withinRelease(destination);
  for (const [file, body] of entries) {
    const target = path.join(destination, file); withinRelease(target);
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, body);
  }
}
async function applyDelta(destination, patch) {
  assert.ok(!patch.added);
  const directory = path.relative(root, destination).replaceAll('\\', '/');
  assert.ok(!directory.startsWith('..') && directory.startsWith('output/'), 'git apply destination must be inside release output');
  // -p2 strips a/functions/. Exact context matching preserves each live
  // archive's unrelated changes; no fuzz, whitespace relaxation or 3-way merge.
  for (const check of [true, false]) execFileSync('git', ['apply', ...(check ? ['--check'] : []),
    '--whitespace=nowarn', '-p2', `--directory=${directory}`], { cwd: root, input: patch.patch, stdio: ['pipe', 'pipe', 'pipe'] });
}
export async function prepare(token, saved) {
  await assertCloudBefore(token, saved);
  const patches = await collectPatches(), groups = new Map();
  const patchSetSha256 = sha(JSON.stringify(patchMetadata(patches)));
  for (const target of saved.targets) {
    const selected = patches.filter(item => (target.name === reader ? readerFiles : tradingFiles).includes(item.file));
    assert.ok(selected.length, `${target.name}: no selected patch`);
    const original = await zipInventory(await fs.readFile(path.join(target.directory, 'source.zip')));
    const bodies = new Map(original.map(item => [item.path, item.body]));
    const key = sha(JSON.stringify([target.originalInventory, patchSetSha256, patchMetadata(selected)])).slice(0, 24);
    if (groups.has(key)) { groups.get(key).targets.push(target); continue; }
    const directory = path.join(audit, 'prepared', key), destination = path.join(directory, 'functions');
    await writeSources(destination, bodies);
    for (const patch of selected) {
      if (patch.added) {
        assert.ok(!bodies.has(patch.file), `${target.name}: new file already present: ${patch.file}`);
        await writeSources(destination, new Map([[patch.file, patch.body]]));
      } else {
        assert.ok(bodies.has(patch.file), `${target.name}: missing existing module: ${patch.file}`);
        try { await applyDelta(destination, patch); }
        catch (error) { throw new Error(`Exact repository delta does not apply to ${target.name}/${patch.file}; review live baseline differences before release. ${String(error.stderr || error.message)}`); }
      }
      execFileSync(process.execPath, ['--check', path.join(destination, patch.file)], { stdio: ['ignore', 'pipe', 'pipe'] });
    }
    const expected = await inventory(destination);
    assert.deepEqual(expected.map(item => item.path).sort(), [...target.originalInventory.map(item => item.path),
      ...selected.filter(item => item.added).map(item => item.file)].sort(), 'Unexpected release file');
    for (const originalFile of target.originalInventory) if (!selected.some(item => item.file === originalFile.path))
      assert.equal(expected.find(item => item.path === originalFile.path)?.sha256, originalFile.sha256, `Unrelated file changed: ${originalFile.path}`);
    groups.set(key, { directory, expected, selected, targets: [target], originalInventory: target.originalInventory });
  }
  const prepared = [];
  for (const group of groups.values()) {
    const manifest = { schemaVersion: 1, baseline, project, region, patchSetSha256,
      changes: patchMetadata(group.selected), targets: group.targets.map(({ name, directory, metadata }) => ({ name, originalDirectory: directory, metadata })),
      originalInventory: group.originalInventory, expectedHashes: Object.fromEntries(group.expected.map(item => [item.path, item.sha256])),
      productionDataReads: 0, productionWrites: 0,
      deploymentCommand: `firebase deploy --only "${group.targets.map(target => `functions:${target.name}`).join(',')}" --project ${project} --config firebase.json` };
    await fs.writeFile(path.join(group.directory, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', codebase: 'default',
      ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'] } }, null, 2));
    await immutable(path.join(group.directory, 'manifest.json'), manifest);
    prepared.push({ directory: group.directory, ...manifest });
  }
  await fs.writeFile(path.join(audit, 'prepared.json'), JSON.stringify(prepared, null, 2));
  await validatePrepared(prepared, saved);
  console.log(JSON.stringify({ patchSetSha256, groups: prepared.map(group => ({ directory: group.directory,
    targets: group.targets.map(target => target.name), changes: group.changes.map(item => item.file) })), productionWrites: 0 }, null, 2));
  return prepared;
}
export const loadPrepared = () => json(path.join(audit, 'prepared.json'));
export async function validatePrepared(groups, saved) {
  assert.deepEqual(groups.flatMap(group => group.targets.map(target => target.name)).sort(), [...allTargets].sort());
  const patches = await collectPatches(), patchSetSha256 = sha(JSON.stringify(patchMetadata(patches)));
  for (const group of groups) {
    withinRelease(group.directory);
    assert.equal(group.schemaVersion, 1);
    assert.equal(group.baseline, baseline); assert.equal(group.project, project); assert.equal(group.region, region);
    assert.equal(group.patchSetSha256, patchSetSha256, 'Repository patch changed after preparation');
    assert.deepEqual(await json(path.join(group.directory, 'manifest.json')), Object.fromEntries(Object.entries(group).filter(([key]) => key !== 'directory')));
    const expected = expectedInventory(group.expectedHashes);
    assert.deepEqual(await inventory(path.join(group.directory, 'functions')), expected, 'Prepared source drift');
    for (const target of group.targets) {
      const original = saved.targets.find(item => item.name === target.name);
      assert.equal(target.originalDirectory, original.directory);
      assert.deepEqual(target.metadata, original.metadata);
      assert.deepEqual(group.originalInventory, original.originalInventory, 'Different live archives cannot share a package');
      assert.deepEqual(group.changes, patchMetadata(patches.filter(item => (target.name === reader ? readerFiles : tradingFiles).includes(item.file))));
    }
    for (const original of group.originalInventory) if (!group.changes.some(change => change.file === original.path))
      assert.equal(group.expectedHashes[original.path], original.sha256, `Unrelated source changed: ${original.path}`);
    assert.deepEqual(expected.map(item => item.path).sort(), [...group.originalInventory.map(item => item.path),
      ...group.changes.filter(item => item.added).map(item => item.file)].sort());
  }
}
async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length === 1 && ['--snapshot-only', '--prepare'].includes(args[0]), 'Choose --snapshot-only or --prepare');
  assert.equal(path.resolve(git(['rev-parse', '--show-toplevel']).trim()).toLowerCase(), root.toLowerCase());
  const token = await accessToken();
  if (args[0] === '--snapshot-only') await snapshot(token);
  else await prepare(token, await loadSnapshot());
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
