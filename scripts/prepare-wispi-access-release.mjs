import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { accessToken, readCloud, sourceUrl, zipInventory, inventory, sha, normalize } from './prepare-wispi-market-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audit = path.join(root, 'output/wispi-access-20261115/release');
const baseline = 'befc0096';
const project = 'history-quiz-yongsin';
const targets = [
  ...['getWisStockManagement', 'saveWisStock', 'saveWisStockMarketRules', 'setWisStockMarketHalted', 'advanceWisStockPrices'].map(name => ({ name, region: 'us-central1', kind: 'stocks' })),
  { name: 'executeCommand', region: 'asia-northeast3', kind: 'wallet' },
  { name: 'executeWisCommandFast', region: 'us-central1', kind: 'inspect' },
];
const url = t => `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${t.region}/functions/${t.name}`;
const baselineText = file => execFileSync('git', ['show', `${baseline}:functions/${file}`], { cwd: root, encoding: 'utf8' });
const snapshotOnly = process.argv.includes('--snapshot-only');
assert.ok(process.argv.slice(2).every(a => a === '--snapshot-only'));
const token = accessToken();
await fs.mkdir(audit, { recursive: true });
const snapshots = await Promise.all(targets.map(async target => {
  const metadata = await (await readCloud(url(target), token)).json();
  assert.equal(metadata.state, 'ACTIVE');
  assert.equal(metadata.buildConfig.runtime, 'nodejs22');
  const source = metadata.buildConfig.source.storageSource;
  const directory = path.join(audit, 'originals', `${target.name}--${target.region}`, String(source.generation));
  await fs.mkdir(directory, { recursive: true });
  let bytes;
  try { bytes = await fs.readFile(path.join(directory, 'source.zip')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; bytes = Buffer.from(await (await readCloud(sourceUrl(source), token)).arrayBuffer()); }
  const entries = await zipInventory(bytes);
  const byName = new Map(entries.map(e => [e.path, e]));
  const checkedFiles = target.kind === 'stocks' ? ['wisStocks.js'] : target.kind === 'wallet' ? ['productionGateway/wisEconomy.js', 'wisLedgerIntegrity.js'] : [];
  for (const file of checkedFiles) {
    assert.ok(byName.has(file), `Missing live dependency ${target.name}/${file}`);
    assert.ok(normalize(byName.get(file).body.toString('utf8')) === normalize(baselineText(file)), `Unreviewed live difference: ${target.name}/${file}`);
  }
  if (target.kind === 'inspect') {
    const gateway = byName.get('productionGateway/commandGateway.js').body.toString('utf8');
    assert.ok(gateway.includes('wisEconomy.WIS_TRANSACTION_COMMAND_TYPES.has') && gateway.includes('assertWisTransactionCommand(request);'));
    const economy = byName.get('productionGateway/wisEconomy.js').body.toString('utf8');
    const fastTypes = economy.match(/const WIS_TRANSACTION_COMMAND_TYPES = new Set\(\[([\s\S]*?)\]\);/)?.[1];
    assert.ok(fastTypes && !fastTypes.includes('REBUILD'), 'Fast endpoint must not execute ledger rebuild');
  }
  await fs.writeFile(path.join(directory, 'source.zip'), bytes);
  await fs.writeFile(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2));
  await fs.writeFile(path.join(directory, 'inventory.json'), JSON.stringify(entries.map(({ body, ...e }) => e), null, 2));
  console.log(`Preserved ${target.name}/${target.region}: ${entries.length} files; reviewed baseline matches`);
  return { ...target, directory, metadata, entries };
}));
await fs.writeFile(path.join(audit, 'snapshots.json'), JSON.stringify(snapshots.map(({entries,...s})=>s), null, 2));
if (snapshotOnly) process.exit(0);

// Finalize only when the runtime entrypoint and all its reviewed dependencies exist.
const stockPatches = ['wisStocks.js', 'wisStockTrading.js', 'wisStockTradingExports.js', 'studentMenuVisibility.js',
  'wisStockInvestmentBoard.js', 'wisStockInvestmentBoard.mjs'];
const walletPatches = ['productionGateway/wisEconomy.js', 'wisLedgerIntegrity.js'];
const newTargets = ['getStudentWisStockState', 'getStudentWisStockHistory', 'transferStudentWisStock',
  'placeStudentWisStockOrder', 'cancelStudentWisStockOrder', 'settleWisStockOrderTask',
  'onWisStockOrderCreated', 'onWisStockMarketTradingWrite', 'onWisStockEnrollmentSlotWritten', 'recoverWisStockOrders'];
const groups = new Map();
for (const s of snapshots) {
  if (s.kind === 'inspect') continue;
  const key = sha(JSON.stringify([s.kind, s.entries.map(({body,...e})=>e)])).slice(0,20);
  if (!groups.has(key)) groups.set(key, {key, kind:s.kind, entries:s.entries, targets:[]});
  groups.get(key).targets.push(s);
}
const prepared = [];
for (const group of groups.values()) {
  const directory = path.join(audit,'prepared',group.key), destination=path.join(directory,'functions');
  await fs.mkdir(destination,{recursive:true});
  const patches = new Map(await Promise.all((group.kind==='stocks'?stockPatches:walletPatches).map(async f=>[f,await fs.readFile(path.join(root,'functions',f))])));
  const entries = new Map(group.entries.map(e=>[e.path,e.body]));
  for (const [name,body] of patches) entries.set(name,body);
  if(group.kind==='stocks') {
    const original=entries.get('index.js').toString('utf8');
    assert.ok(original.includes("require('./wisStocks').createWisStockHandlers"));
    entries.set('index.js',Buffer.from(original+"\nObject.assign(exports, require('./wisStockTradingExports').createWisStockTradingExports({ db: getFirestore() }));\n"));
  }
  for(const [name,body] of entries) { const filename=path.join(destination,name); await fs.mkdir(path.dirname(filename),{recursive:true}); await fs.writeFile(filename,body); }
  const expected=[...entries].map(([name,body])=>({path:name,sha256:sha(body)})).sort((a,b)=>a.path.localeCompare(b.path));
  assert.deepEqual(await inventory(destination),expected,'Prepared source must preserve every original file');
  await fs.writeFile(path.join(directory,'firebase.json'),JSON.stringify({functions:{source:'functions',codebase:'default',ignore:['node_modules','.git','firebase-debug.log','firebase-debug.*.log']}},null,2));
  const manifest={schemaVersion:1,project,baseline,kind:group.kind,directory,targets:group.targets.map(({name,region,metadata,directory:snapshotDirectory})=>({name,region,serviceConfig:metadata.serviceConfig,sourceGeneration:metadata.buildConfig.source.storageSource.generation,snapshotDirectory})),newTargets:group.kind==='stocks'?newTargets:[],expectedHashes:Object.fromEntries(expected.map(e=>[e.path,e.sha256])),patched:[...patches.keys()],productionWrites:0};
  await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2));
  prepared.push(manifest);
}
await fs.writeFile(path.join(audit,'prepared.json'),JSON.stringify(prepared,null,2));
console.log(JSON.stringify(prepared.map(p=>({directory:p.directory,kind:p.kind,targets:p.targets.map(t=>t.name)})),null,2));
