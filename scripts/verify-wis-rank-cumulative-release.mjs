import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, audit } from './prepare-wis-rank-cumulative-release.mjs';
import { zipInventory, normalize, inventory } from './prepare-wispi-market-release.mjs';

// Execute isolated checks against the exact prepared runtime, with no cloud calls.
const plans = JSON.parse(await fs.readFile(path.join(audit, 'prepared.json'), 'utf8'));
const env = { ...process.env, NODE_PATH: path.join(root, 'functions/node_modules'),
  GCLOUD_PROJECT: 'demo-westory-rank', GOOGLE_CLOUD_PROJECT: 'demo-westory-rank',
  FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-westory-rank', storageBucket: 'demo-westory-rank.appspot.com' }) };
const probe = `const loaded=require(process.argv[1]); const names=JSON.parse(process.argv[2]);
  process.stdout.write(JSON.stringify(Object.fromEntries(names.map(name=>{
    if(typeof loaded[name]!=='function'||!loaded[name].__endpoint)throw Error('Missing export '+name);
    return [name,loaded[name].__endpoint];}))));`;
const testRunner = `const fs=require('fs'),path=require('path'),Module=require('module');
  const source=process.argv[1], virtual=process.argv[2], test=new Module(virtual);
  if(source.endsWith('verify-avatar-catalog-pricing.cjs')) {
    const helperPath=path.join(path.dirname(virtual),'verify-student-avatar.cjs');
    const helper=new Module(helperPath); helper.filename=helperPath;
    helper.paths=Module._nodeModulePaths(path.dirname(helperPath));
    require.cache[helperPath]=helper;
    helper._compile(fs.readFileSync(path.join(path.dirname(source),'verify-student-avatar.cjs'),'utf8'),helperPath);
  }
  test.filename=virtual; test.paths=Module._nodeModulePaths(path.dirname(virtual));
  test._compile(fs.readFileSync(source,'utf8'),virtual);`;
const reports = [];
for (const plan of plans) {
  const destination = path.join(plan.directory, 'functions');
  assert.deepEqual(await inventory(destination), Object.entries(plan.expectedHashes).map(([path,sha256])=>({path,sha256})).sort((a,b)=>a.path.localeCompare(b.path)));
  const snapshot = plan.targets[0], originalDirectory = path.join(plan.directory, 'original-functions');
  const entries = await zipInventory(await fs.readFile(path.join(snapshot.directory, 'source.zip')));
  for (const entry of entries) { const file = path.join(originalDirectory, entry.path); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, entry.body); }
  const names = [...new Set(plan.targets.map(saved => saved.target.name))];
  const declarations = directory => JSON.parse(execFileSync(process.execPath, ['-e', probe, path.join(directory, 'index.js'), JSON.stringify(names)], { env, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }));
  assert.deepEqual(declarations(destination), declarations(originalDirectory), 'Selected endpoint declarations changed');
  for (const file of plan.files) execFileSync(process.execPath, ['--check', path.join(destination, file)]);
  // All prepared policy implementations must be the tested repository module.
  assert.equal(normalize(await fs.readFile(path.join(destination, 'studentProfileEmojiPolicy.js'), 'utf8')),
    normalize(await fs.readFile(path.join(root, 'functions/studentProfileEmojiPolicy.js'), 'utf8')));
  const tests = plan.files.includes('productionGateway/wisEconomyQuery.js')
    ? ['scripts/verify-wis-ranking-preview.cjs', 'scripts/verify-wis-ranking-modes.cjs', 'productionGateway/scripts/verify-wis-query.cjs']
    : plan.files.includes('studentAvatar.js') ? ['scripts/verify-avatar-catalog-pricing.cjs']
    : plan.files.includes('studentProfileEmoji.js') ? ['scripts/verify-student-profile-emoji.cjs']
    : plan.files.includes('gongsinmoongo.js') ? ['scripts/verify-gongsinmoongo-rank.cjs']
    : names.includes('reconcileStudentProfileEmojiOnAccountWrite') ? ['scripts/verify-student-profile-emoji-reconciliation.cjs'] : [];
  if (plan.files.includes('studentProfileEmojiReconciliation.js')) {
    const body = await fs.readFile(path.join(destination, 'studentProfileEmojiReconciliation.js'), 'utf8');
    const local = await fs.readFile(path.join(root, 'functions/studentProfileEmojiReconciliation.js'), 'utf8');
    const activeService = text => normalize(text.slice(text.indexOf('  const reconcileStudent ='), text.indexOf('  const handleAccountWritten =')));
    assert.equal(activeService(body), activeService(local), 'Active reconciliation service differs');
  }
  for (const file of tests) {
    const output = execFileSync(process.execPath, ['-e', testRunner, path.join(root, 'functions', file), path.join(destination, file)], { env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    await fs.writeFile(path.join(plan.directory, 'qa-' + path.basename(file) + '.log'), output);
  }
  reports.push({ targets: names, tests, syntax: true, endpointDeclarationsPreserved: true, fileCount: Object.keys(plan.expectedHashes).length });
  console.log(JSON.stringify(reports.at(-1)));
}
await fs.writeFile(path.join(audit, 'verified-prepared-tests.json'), JSON.stringify({ checkedAt: new Date().toISOString(), productionReads: 0, productionWrites: 0, reports }, null, 2));
