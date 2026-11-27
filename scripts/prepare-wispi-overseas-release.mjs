import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { accessToken, readCloud, functionUrl, sourceUrl, zipInventory, inventory, normalize, sha, root,
  resourceFields, resourceValue } from './prepare-wispi-market-release.mjs';

// Source/configuration reads and a local release package only. This never
// deploys a function and never reads an application document.
//
// The seven WsPI market functions share one live source archive. The overseas
// release replaces only the market modules in that archive with the committed
// files and adds the venue/exchange-rate modules they require. Every other file,
// including the slim production index.js and the older trading modules this
// archive carries, stays exactly as deployed.
//
//   node scripts/prepare-wispi-overseas-release.mjs prepare    (writes output/wispi-overseas-20261126/release)
//   node scripts/prepare-wispi-overseas-release.mjs preflight  (live archive unchanged since prepare)
//   node scripts/prepare-wispi-overseas-release.mjs verify     (deployed archive equals the package)
// A later market-package release adds `--release <id>` (see RELEASES); each
// replaces only its listed files, checking the live copy against the reviewed
// version first.
const mode = process.argv[2];
assert.ok(['prepare', 'preflight', 'verify'].includes(mode), 'prepare | preflight | verify');
const releaseIndex = process.argv.indexOf('--release');
const releaseId = releaseIndex > 0 ? process.argv[releaseIndex + 1] : 'overseas-20261126';
const RELEASES = {
  'overseas-20261126': {
    baseline: 'd13c9cd13b2fe93b59a30be984a2b0c2d035b168',
    out: 'output/wispi-overseas-20261126/release',
    replaced: ['wisStocks.js', 'wisStockCatalogSchedule.js', 'wisStockCatalogTimeline.mjs'],
    added: ['wisStockVenues.js', 'wisStockFx.js', 'wisStockFx.mjs', 'wisStockOverseasCatalog.json'],
    // The only reviewed difference between the live market files and the baseline:
    // the live wisStocks.js predates the advanceScheduledSlot export used by the
    // weekly report functions (which carry their own copy).
    liveFromBaseline: {
      'wisStocks.js': text => text.replace('nextPrice, advanceMarket, advanceScheduledSlot, blankMarket',
        'nextPrice, advanceMarket, blankMarket'),
    },
  },
  // Weeks 1-5 "survive" catalog stocks merge at the end of the following week.
  'catalog-exits-20261127': {
    baseline: 'd13c9cd13b2fe93b59a30be984a2b0c2d035b168',
    out: 'output/wispi-catalog-exits-20261127/release',
    replaced: ['wisStockCatalog.json'],
    added: [],
    liveFromBaseline: {},
  },
};
const release = RELEASES[releaseId];
assert.ok(release, `Unknown --release ${releaseId}`);
const { baseline, replaced, added, liveFromBaseline } = release;
const out = path.join(root, release.out);
const packageRoot = path.join(out, 'market');
const manifestPath = path.join(out, 'market-manifest.json');
const marketFunctions = ['activateWisStockCatalogExits', 'activateWisStockCatalogPlan', 'advanceWisStockPrices',
  'getWisStockManagement', 'saveWisStock', 'saveWisStockMarketRules', 'setWisStockMarketHalted'];
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const token = accessToken();

async function liveSources() {
  const result = [];
  for (const name of marketFunctions) {
    const metadata = await (await readCloud(functionUrl(name), token)).json();
    assert.equal(metadata.state, 'ACTIVE', name);
    assert.equal(metadata.buildConfig.runtime, 'nodejs22', name);
    const source = metadata.buildConfig.source.storageSource;
    const bytes = Buffer.from(await (await readCloud(sourceUrl(source), token)).arrayBuffer());
    const entries = await zipInventory(bytes);
    result.push({ name, metadata, source, archiveSha256: sha(bytes), entries,
      resources: Object.fromEntries(resourceFields.map(field => [field, resourceValue(metadata.serviceConfig, field)])),
      revision: metadata.serviceConfig.revision });
  }
  return result;
}
const fileMap = entries => Object.fromEntries(entries.map(({ path: file, sha256 }) => [file, sha256]));

if (mode === 'prepare') {
  for (const file of [...replaced, ...added]) assert.equal(git('status', '--porcelain', '--', `functions/${file}`).trim(), '',
    `Commit functions/${file} before preparing`);
  const live = await liveSources();
  const reference = fileMap(live[0].entries);
  for (const item of live) assert.deepEqual(fileMap(item.entries), reference, `${item.name} no longer shares the market archive`);
  const byName = new Map(live[0].entries.map(entry => [entry.path, entry]));
  const reviewed = [];
  for (const file of replaced) {
    const liveText = normalize(byName.get(file)?.body.toString('utf8') ?? '');
    const baseText = normalize(git('show', `${baseline}:functions/${file}`));
    assert.equal(liveText, (liveFromBaseline[file] || (text => text))(baseText), `Unreviewed live difference: ${file}`);
    reviewed.push({ file, liveSha256: sha(liveText), matchesBaseline: liveText === baseText });
  }
  for (const file of added) assert.ok(!byName.has(file), `Already deployed: ${file}`);
  await fs.rm(packageRoot, { recursive: true, force: true });
  for (const entry of live[0].entries) {
    const target = path.join(packageRoot, 'functions', entry.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entry.body);
  }
  const head = git('rev-parse', 'HEAD').trim();
  for (const file of [...replaced, ...added]) {
    const body = execFileSync('git', ['show', `HEAD:functions/${file}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    await fs.writeFile(path.join(packageRoot, 'functions', file), body);
  }
  await fs.writeFile(path.join(packageRoot, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', codebase: 'default',
    ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'] } }, null, 2));
  const prepared = await inventory(path.join(packageRoot, 'functions'));
  const manifest = { preparedFromCommit: head, baseline, functions: live.map(({ name, source, archiveSha256, resources, revision }) =>
    ({ name, revision, generation: String(source.generation), archiveSha256, resources })),
    replaced: reviewed, added, preservedFiles: live[0].entries.length - replaced.length, prepared };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ packageRoot, head, revision: manifest.functions.map(item => `${item.name}:${item.revision}`),
    replaced: reviewed, added, files: prepared.length }, null, 2));
} else {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const live = await liveSources();
  if (mode === 'preflight') {
    for (const item of live) {
      const expected = manifest.functions.find(entry => entry.name === item.name);
      assert.equal(String(item.source.generation), expected.generation, `${item.name} changed since prepare`);
      assert.equal(item.archiveSha256, expected.archiveSha256, `${item.name} archive changed since prepare`);
    }
    assert.deepEqual(await inventory(path.join(packageRoot, 'functions')), manifest.prepared, 'Package changed since prepare');
    console.log('PREFLIGHT OK: live market archives unchanged, package unchanged');
  } else {
    const expected = fileMap(manifest.prepared);
    for (const item of live) {
      assert.deepEqual(fileMap(item.entries), expected, `${item.name} deployed archive differs from the package`);
      const before = manifest.functions.find(entry => entry.name === item.name);
      assert.deepEqual(item.resources, before.resources, `${item.name} resources changed`);
      console.log(`VERIFIED ${item.name} ${item.revision} (was ${before.revision}) files=${item.entries.length}`);
    }
  }
}
