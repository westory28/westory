import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { accessToken, cloud, readCallablePolicy } from './wispi-bonus-claim-release-cloud.mjs';
import { sourceUrl, zipInventory, inventory, sha, normalize, resourceFields, resourceValue } from './prepare-wispi-market-release.mjs';

// Only cloud source/configuration reads and local release preparation. No app data or deployments.
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const audit = path.join(root, 'output/rank-link-20261121/release');
export const baseline = 'c0cfda16e403e520d06d91b846528fa86c566353';
const project = 'history-quiz-yongsin';
const policy = 'studentProfileEmojiPolicy.js';
export const targets = [
  ...['getWisRankingPreview', 'getWisEconomyState', 'getWisEconomyStateFast'].map(name => ({ name, region: 'us-central1', files: [policy, 'productionGateway/wisEconomyQuery.js'] })),
  { name: 'getWisEconomyState', region: 'asia-northeast3', files: [policy, 'productionGateway/wisEconomyQuery.js'] },
  ...['getAvatarStudioState', 'purchaseStudentAvatarItem'].map(name => ({ name, region: 'us-central1', files: [policy, 'studentAvatar.js'] })),
  { name: 'updateStudentProfileIcon', region: 'asia-northeast3', files: [policy, 'studentProfileEmoji.js'] },
  ...['User', 'Account', 'Policy', 'Semester'].map(kind => ({ name: `reconcileStudentProfileEmojiOn${kind}Write`, region: 'asia-northeast3', files: [policy, 'studentProfileEmojiReconciliation.js'] })),
  { name: 'manageGongsinmoongo', region: 'asia-northeast3', files: [policy, 'gongsinmoongo.js'] },
];
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const url = target => `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/${target.region}/functions/${target.name}`;
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const eventConfiguration = value => value ? { ...value,
  eventFilters: [...(value.eventFilters || [])].sort((a, b) => a.attribute.localeCompare(b.attribute)),
} : value;
export function transplant(original, diff) {
  let result = normalize(original);
  const lines = normalize(diff).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('@@ ')) continue;
    let before = '', after = '';
    for (i++; i < lines.length && !lines[i].startsWith('@@ '); i++) {
      const line = lines[i];
      if (line.startsWith(' ')) { before += line.slice(1) + '\n'; after += line.slice(1) + '\n'; }
      else if (line.startsWith('-')) before += line.slice(1) + '\n';
      else if (line.startsWith('+')) after += line.slice(1) + '\n';
      else if (line.startsWith('\\ No newline')) throw new Error('Explicit newline review required');
      else break;
    }
    i--;
    assert.ok(before && result.includes(before), 'Production source differs at a patch hunk');
    assert.equal(result.indexOf(before), result.lastIndexOf(before), 'Patch hunk must be unambiguous');
    result = result.replace(before, after);
  }
  assert.notEqual(result, normalize(original), 'Patch must change its selected runtime file');
  return result;
}
async function snapshot() {
  const token = await accessToken(), snapshots = [];
  for (const target of targets) {
    const metadata = (await cloud(url(target), token)).json();
    assert.equal(metadata.state, 'ACTIVE'); assert.equal(metadata.buildConfig.runtime, 'nodejs22');
    const source = metadata.buildConfig.source.storageSource;
    assert.ok(source.bucket && source.object && /^\d+$/.test(String(source.generation)));
    const directory = path.join(audit, 'originals', `${target.name}--${target.region}`, String(source.generation));
    await fs.mkdir(directory, { recursive: true });
    let bytes;
    try { bytes = await fs.readFile(path.join(directory, 'source.zip')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; bytes = (await cloud(sourceUrl(source), token)).body; await fs.writeFile(path.join(directory, 'source.zip'), bytes); }
    const entries = await zipInventory(bytes), originalInventory = entries.map(({ body, ...entry }) => entry);
    const comparisons = target.files.map(file => {
      const deployed = entries.find(entry => entry.path === file); assert.ok(deployed, `Missing runtime ${file}`);
      return { file, baselineMatches: normalize(deployed.body.toString()) === normalize(git(['show', `${baseline}:functions/${file}`])) };
    });
    const callableIam = metadata.eventTrigger ? null : await readCallablePolicy(token, metadata);
    await fs.writeFile(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2));
    await fs.writeFile(path.join(directory, 'inventory.json'), JSON.stringify(originalInventory, null, 2));
    snapshots.push({ target, directory, archiveSha256: sha(bytes), sourceGeneration: source.generation, comparisons, callableIam });
    await fs.writeFile(path.join(audit, 'snapshots.json'), JSON.stringify(snapshots, null, 2));
    console.log(JSON.stringify({ snapshot: `${target.name}--${target.region}`, comparisons }));
  }
}
async function prepare() {
  const snapshots = await json(path.join(audit, 'snapshots.json'));
  assert.equal(snapshots.length, targets.length);
  const groups = new Map();
  for (const saved of snapshots) {
    const bytes = await fs.readFile(path.join(saved.directory, 'source.zip')); assert.equal(sha(bytes), saved.archiveSha256);
    const entries = await zipInventory(bytes), originalInventory = entries.map(({body,...entry}) => entry);
    const key = sha(JSON.stringify([originalInventory, saved.target.files])).slice(0, 16);
    if (!groups.has(key)) groups.set(key, { key, entries, originalInventory, files: saved.target.files, targets: [] });
    groups.get(key).targets.push(saved);
  }
  const plans = [];
  for (const group of groups.values()) {
    const directory = path.join(audit, 'prepared', group.key), destination = path.join(directory, 'functions'), expectedHashes = {};
    for (const entry of group.entries) {
      // The three non-account triggers retain their older, unrelated revision
      // guard. Apply only unique changed lines in that reviewed module.
      const context = entry.path === 'studentProfileEmojiReconciliation.js' ? '--unified=0' : '--unified=4';
      let patch;
      if (group.files.includes(entry.path)) {
        patch = git(['diff', context, baseline, '--', `functions/${entry.path}`]);
        if (entry.path === 'studentProfileEmojiReconciliation.js' && entry.body.toString().includes('if (!fieldsChanged(before, after, ACCOUNT_EVENT_FIELDS)) return null;')) {
          assert.ok(group.targets.every(saved => saved.target.name !== 'reconcileStudentProfileEmojiOnAccountWrite'));
          const pieces = patch.split(/(?=^@@ )/m);
          const ignored = pieces.filter(part => part.startsWith('@@ ') && part.includes('safeInteger(before?.revision'));
          assert.equal(ignored.length, 1, 'Expected only the inactive account-callback compatibility hunk');
          patch = pieces.filter(part => !ignored.includes(part)).join('');
        }
      }
      const body = patch ? Buffer.from(transplant(entry.body.toString(), patch)) : entry.body;
      const file = path.join(destination, entry.path); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, body);
      expectedHashes[entry.path] = sha(body);
    }
    const plan = { directory, baseline, targets: group.targets, files: group.files, expectedHashes, originalInventory: group.originalInventory };
    await fs.writeFile(path.join(directory, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', codebase: 'default', ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'] } }, null, 2));
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(plan, null, 2));
    plans.push(plan);
    console.log(JSON.stringify({ prepared: group.key, targets: group.targets.map(saved => saved.target.name), files: group.files }));
  }
  await fs.writeFile(path.join(audit, 'prepared.json'), JSON.stringify(plans, null, 2));
}
async function verify(after) {
  const token = await accessToken(), plans = await json(path.join(audit, 'prepared.json')), revisions = [];
  for (const plan of plans) {
    assert.deepEqual(await inventory(path.join(plan.directory, 'functions')), Object.entries(plan.expectedHashes).map(([path, sha256]) => ({ path, sha256 })).sort((a,b) => a.path.localeCompare(b.path)));
    for (const saved of plan.targets) {
      const before = await json(path.join(saved.directory, 'metadata.json')), now = (await cloud(url(saved.target), token)).json();
      assert.equal(now.state, 'ACTIVE'); assert.equal(now.buildConfig.runtime, before.buildConfig.runtime);
      for (const field of [...resourceFields, 'environmentVariables', 'secretEnvironmentVariables', 'allTrafficOnLatestRevision'])
        assert.deepEqual(resourceValue(now.serviceConfig, field), resourceValue(before.serviceConfig, field), `${saved.target.name}: ${field}`);
      assert.deepEqual(eventConfiguration(now.eventTrigger), eventConfiguration(before.eventTrigger), `${saved.target.name}: event trigger`);
      if (saved.callableIam) assert.deepEqual(await readCallablePolicy(token, now), saved.callableIam);
      if (!after) assert.deepEqual(now.buildConfig.source.storageSource, before.buildConfig.source.storageSource, 'Concurrent deployment detected');
      else {
        const source = now.buildConfig.source.storageSource, entries = await zipInventory((await cloud(sourceUrl(source), token)).body);
        assert.deepEqual(entries.map(({body,...entry}) => entry), Object.entries(plan.expectedHashes).map(([path,sha256])=>({path,sha256})).sort((a,b)=>a.path.localeCompare(b.path)), `${saved.target.name}: deployed source`);
      }
      revisions.push({ target: saved.target, revision: now.serviceConfig.revision, generation: now.buildConfig.source.storageSource.generation });
    }
  }
  const report = { after, checkedAt: new Date().toISOString(), sourceAndRuntimeMatch: true, productionDataReads: 0, productionWrites: 0, revisions };
  await fs.writeFile(path.join(audit, after ? 'verified-after.json' : 'verified-before.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2]; assert.equal(process.argv.length, 3);
  if (mode === '--snapshot') await snapshot(); else if (mode === '--prepare') await prepare();
  else if (mode === '--verify-before') await verify(false); else if (mode === '--verify-after') await verify(true);
  else throw new Error('Choose --snapshot, --prepare, --verify-before or --verify-after');
}
