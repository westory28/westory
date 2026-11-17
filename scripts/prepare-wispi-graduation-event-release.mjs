import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { accessToken } from './prepare-wis-stock-schedule-release.mjs';
import { readCloud, sourceUrl, zipInventory, inventory, sha, normalize, resourceFields, resourceValue } from './prepare-wispi-market-release.mjs';

// No deploy or business-data writes. Every target keeps its own live archive,
// entrypoint, lockfile and runtime. Never use the repository's giant index.js.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audit = path.join(root, 'output/wispi-graduation-event-20261117/release');
const project = 'history-quiz-yongsin', region = 'us-central1';
const baseline = '59ccdf304d1e490891a00f191f1603929a5bbe04';
const targetNames = ['getStudentWisStockState', 'getStudentWisStockHistory', 'transferStudentWisStock',
  'placeStudentWisStockOrder', 'cancelStudentWisStockOrder', 'settleWisStockOrderTask',
  'onWisStockOrderCreated', 'onWisStockMarketTradingWrite', 'onWisStockEnrollmentSlotWritten', 'recoverWisStockOrders',
  'getWisStockManagement', 'saveWisStock', 'saveWisStockMarketRules', 'setWisStockMarketHalted',
  'advanceWisStockPrices', 'activateWisStockCatalogPlan', 'getWisStockInvestmentHistory'];
const shared = ['wisStocks.js', 'wisStockMarketRules.mjs', 'wisStockOrderLifecycle.mjs', 'wisStockTrading.js'];
const added = ['wisStockDepositCampaign.js', 'wisStockGraduation.js'];
const functionUrl = name => `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${region}/functions/${name}`;
const mode = process.argv[2] || '--snapshot-only';
assert(['--snapshot-only', '--prepare', '--verify'].includes(mode));
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
if (only) assert(targetNames.includes(only));
const names = only ? [only] : process.argv.includes('--without-history') ? targetNames.filter(name => name !== 'getWisStockInvestmentHistory') : targetNames;
const token = await accessToken();
const references = new Map(shared.map(file => [file, normalize(execFileSync('git', ['show', `${baseline}:functions/${file}`], { cwd: root, encoding: 'utf8' }))]));
references.set('wisStockInvestmentHistory.js', normalize(execFileSync('git', ['show', `${baseline}:functions/wisStockInvestmentHistory.js`], { cwd: root, encoding: 'utf8' })));
// Reviewed live variance: only the scheduled price function received the later
// daily-price-limit argument forwarding. Preserve each target's original three
// lines; graduation must not silently deploy an unrelated price model change.
const preserveEarlierPriceForwarding = source => source
  .replace("function nextPrice(stock, semesterId, slot, priceSeed = '', dailyPriceLimitBps)", "function nextPrice(stock, semesterId, slot, priceSeed = '')")
  .replace("key => Number.parseInt(hash(prefix + key).slice(0, 8), 16) / 4294967296, dailyPriceLimitBps);", "key => Number.parseInt(hash(prefix + key).slice(0, 8), 16) / 4294967296);")
  .replace('nextPrice(stock, market.semesterId, slot, market.priceSeed, rules.dailyPriceLimitBps)))', 'nextPrice(stock, market.semesterId, slot, market.priceSeed)))');
const summary = [];
for (const name of names) {
  const directory = path.join(audit, 'prepared', name);
  const metadata = await (await readCloud(functionUrl(name), token)).json();
  assert.equal(metadata.state, 'ACTIVE', name); assert.equal(metadata.buildConfig.runtime, 'nodejs22', name);
  const source = metadata.buildConfig.source.storageSource;
  if (mode === '--verify') {
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
    const expected = Object.entries(manifest.expectedHashes).map(([path, sha256]) => ({ path, sha256 })).sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(await inventory(path.join(directory, 'functions')), expected, `Local release drift: ${name}`);
    const deployed = await zipInventory(Buffer.from(await (await readCloud(sourceUrl(source), token)).arrayBuffer()));
    assert.deepEqual(deployed.map(({ body, ...entry }) => entry), expected, `Deployed source mismatch: ${name}`);
    for (const field of resourceFields) assert.equal(resourceValue(metadata.serviceConfig, field), resourceValue(manifest.sourceServiceConfig, field), `${name}/${field}`);
    if (manifest.sourceEventTrigger) {
      for (const field of ['eventType', 'eventFilters', 'retryPolicy', 'serviceAccountEmail', 'triggerRegion']) {
        const comparable = value => field === 'eventFilters' && Array.isArray(value)
          ? value.slice().sort((a, b) => a.attribute.localeCompare(b.attribute)) : value ?? null;
        assert.deepEqual(comparable(metadata.eventTrigger?.[field]), comparable(manifest.sourceEventTrigger[field]), `${name}/trigger/${field}`);
      }
    }
    summary.push({ name, state: metadata.state, runtime: metadata.buildConfig.runtime, files: expected.length, sourceGeneration: source.generation });
    console.log(`Verified ${name}: ${expected.length} files, runtime preserved`);
    continue;
  }
  const originalDir = path.join(audit, 'originals', name, String(source.generation));
  await fs.mkdir(originalDir, { recursive: true });
  let bytes;
  try { bytes = await fs.readFile(path.join(originalDir, 'source.zip')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; bytes = Buffer.from(await (await readCloud(sourceUrl(source), token)).arrayBuffer()); await fs.writeFile(path.join(originalDir, 'source.zip'), bytes); }
  const original = await zipInventory(bytes), entries = new Map(original.map(entry => [entry.path, entry.body]));
  const changed = [...shared.filter(file => entries.has(file)), ...(name === 'getWisStockInvestmentHistory' ? ['wisStockInvestmentHistory.js'] : [])];
  const comparisons = changed.map(file => {
    const live = normalize(entries.get(file)?.toString('utf8') || '');
    const baselineMatches = live === references.get(file);
    const reviewedEarlierPriceForwarding = file === 'wisStocks.js' && !baselineMatches && live === preserveEarlierPriceForwarding(references.get(file));
    return { file, baselineMatches, reviewedEarlierPriceForwarding };
  });
  await fs.writeFile(path.join(originalDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  await fs.writeFile(path.join(originalDir, 'inventory.json'), JSON.stringify(original.map(({ body, ...entry }) => entry), null, 2));
  await fs.writeFile(path.join(originalDir, 'comparison.json'), JSON.stringify(comparisons, null, 2));
  console.log(`Preserved ${name}: ${original.length} files; baseline ${comparisons.every(value => value.baselineMatches) ? 'matches' : 'DIFFERS'}`);
  summary.push({ name, originalDir, files: original.length, comparisons });
  if (mode !== '--prepare') continue;
  assert(comparisons.every(value => value.baselineMatches || value.reviewedEarlierPriceForwarding), `Unreviewed live source: ${name}; inspect comparison.json`);
  const includeAdded = entries.has('wisStockTrading.js') ? added : [];
  for (const file of includeAdded) assert(!entries.has(file), `Unexpected existing module: ${file}`);
  for (const file of [...changed, ...includeAdded]) {
    let body = await fs.readFile(path.join(root, 'functions', file));
    if (comparisons.some(value => value.file === file && value.reviewedEarlierPriceForwarding))
      body = Buffer.from(preserveEarlierPriceForwarding(body.toString('utf8')));
    entries.set(file, body);
  }
  const destination = path.join(directory, 'functions');
  for (const [file, body] of entries) {
    const filename = path.join(destination, file); await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, body);
  }
  const expected = [...entries].map(([path, body]) => ({ path, sha256: sha(body) })).sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(await inventory(destination), expected);
  for (const file of [...changed, ...includeAdded]) execFileSync(process.execPath, ['--check', path.join(destination, file)]);
  const actualChanged = original.filter(entry => sha(entries.get(entry.path)) !== entry.sha256).map(entry => entry.path).sort();
  assert.deepEqual(actualChanged, changed.slice().sort(), 'Unexpected changed source files');
  await fs.writeFile(path.join(directory, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', codebase: 'default',
    ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'] } }, null, 2));
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ project, region, baseline, targetName: name,
    directory, changed, added: includeAdded, sourceStorage: source, sourceServiceConfig: metadata.serviceConfig,
    sourceEventTrigger: metadata.eventTrigger || null, expectedHashes: Object.fromEntries(expected.map(entry => [entry.path, entry.sha256])),
    deploy: `firebase deploy --only functions:${name} --project ${project}` }, null, 2));
}
await fs.mkdir(audit, { recursive: true });
await fs.writeFile(path.join(audit, `${mode.slice(2)}${only ? `-${only}` : ''}.json`), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ mode, targets: summary.length, directory: audit }));
