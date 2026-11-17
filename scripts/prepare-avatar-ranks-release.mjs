import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { accessToken } from './prepare-weplay-avatar-release.mjs';
import { readCloud, sourceUrl, zipInventory, sha, normalize, inventory } from './prepare-wispi-market-release.mjs';

// Read-only, generation-pinned production source audit. No cloud writes.
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const audit = path.join(root, 'output/avatar-ranks-20261117/release');
export const baseline = 'e6ef7576d785598ade627dd00deb55b1a6c4195d';
export const targets = [
  ...['getStudentAvatar', 'getAvatarStudioState', 'purchaseStudentAvatarItem', 'saveStudentAvatar', 'getTeacherMyPage', 'saveTeacherAvatar'].map(name => ({ name, region: 'us-central1', mode: 'avatar' })),
  ...['getAvatarCatalogPricing', 'updateAvatarCatalogPricing'].map(name => ({ name, region: 'us-central1', mode: 'pricing' })),
  ...['getWisRankingPreview', 'getWisEconomyState', 'getWisEconomyStateFast'].map(name => ({ name, region: 'us-central1', mode: 'projection' })),
  { name: 'getWisEconomyState', region: 'asia-northeast3', mode: 'projection' },
  { name: 'manageGongsinmoongo', region: 'asia-northeast3', mode: 'projection' },
];
export const filesFor = mode => mode === 'avatar'
  ? ['avatarCatalog.json', 'studentAvatarCatalog.js', 'avatarCatalogPricing.js', 'studentAvatar.js']
  : mode === 'pricing' ? ['avatarCatalog.json', 'studentAvatarCatalog.js', 'avatarCatalogPricing.js']
    : ['avatarCatalog.json', 'studentAvatarCatalog.js'];
const baselineFile = file => execFileSync('git', ['show', `${baseline}:functions/${file}`], { cwd: root, encoding: 'utf8' });
const thumbnailBlock = value => {
  const start = value.indexOf('async function encodeThumbnail(input) {');
  const end = value.indexOf('\nconst createStudentAvatarHandlers', start);
  assert.ok(start > 0 && end > start, 'Expected bounded thumbnail encoder');
  return { start, end, body: value.slice(start, end) };
};
const retainThumbnail = (original, patch) => {
  const before = thumbnailBlock(original), after = thumbnailBlock(patch);
  return patch.slice(0, after.start) + before.body + patch.slice(after.end);
};
export const transplant = (file, original, patch) => file === 'studentAvatar.js'
  ? retainThumbnail(original, patch) : patch;
const assertBaseline = (file, original, target) => {
  const expected = normalize(baselineFile(file));
  assert.equal(normalize(original), file === 'studentAvatar.js' ? retainThumbnail(normalize(original), expected) : expected,
    `Unreviewed production source difference: ${target}/${file}`);
};
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const probe = `const loaded = require(process.argv[1]); const names = JSON.parse(process.argv[2]);
  process.stdout.write(JSON.stringify(Object.fromEntries(names.map(name => {
    if (typeof loaded[name] !== 'function' || !loaded[name].__endpoint) throw Error('Missing callable export ' + name);
    return [name, loaded[name].__endpoint];
  }))));`;

async function prepare() {
  const snapshots = await readJson(path.join(audit, 'snapshots.json'));
  assert.equal(snapshots.length, targets.length);
  const patches = new Map(await Promise.all(filesFor('avatar').map(async file => [file, await fs.readFile(path.join(root, 'functions', file), 'utf8')])));
  const groups = new Map();
  for (const snapshot of snapshots) {
    const metadata = await readJson(path.join(snapshot.directory, 'metadata.json'));
    const bytes = await fs.readFile(path.join(snapshot.directory, 'source.zip'));
    assert.equal(sha(bytes), snapshot.archiveSha256);
    const entries = await zipInventory(bytes), originalInventory = entries.map(({body, ...entry}) => entry);
    assert.deepEqual(originalInventory, await readJson(path.join(snapshot.directory, 'inventory.json')));
    for (const file of filesFor(snapshot.target.mode)) assertBaseline(file, entries.find(entry => entry.path === file).body.toString('utf8'), snapshot.target.name);
    const key = `${snapshot.target.mode}-${sha(JSON.stringify(originalInventory)).slice(0, 16)}`;
    if (!groups.has(key)) groups.set(key, { key, entries, originalInventory, mode: snapshot.target.mode, targets: [] });
    groups.get(key).targets.push({ ...snapshot.target, snapshotDirectory: snapshot.directory,
      runtime: metadata.buildConfig.runtime, serviceConfig: metadata.serviceConfig, sourceGeneration: snapshot.sourceGeneration });
  }
  const plans = [];
  for (const group of groups.values()) {
    const directory = path.join(audit, 'prepared', group.key), destination = path.join(directory, 'functions');
    const allowed = filesFor(group.mode), expectedHashes = {}, changes = [];
    await fs.mkdir(destination, { recursive: true });
    for (const entry of group.entries) {
      const body = allowed.includes(entry.path)
        ? Buffer.from(transplant(entry.path, entry.body.toString('utf8'), patches.get(entry.path))) : entry.body;
      const file = path.join(destination, entry.path);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, body);
      expectedHashes[entry.path] = sha(body);
      if (sha(body) !== entry.sha256) changes.push(entry.path);
    }
    assert.deepEqual(changes.slice().sort(), allowed.slice().sort(), 'All and only reviewed patch files must change');
    assert.deepEqual(await inventory(destination), Object.entries(expectedHashes).map(([path, sha256]) => ({path, sha256})).sort((a,b) => a.path.localeCompare(b.path)));
    for (const file of changes.filter(file => file.endsWith('.js'))) execFileSync(process.execPath, ['--check', path.join(destination, file)]);
    const names = [...new Set(group.targets.map(target => target.name))];
    const env = { ...process.env, GCLOUD_PROJECT: 'demo-westory-avatar-release', GOOGLE_CLOUD_PROJECT: 'demo-westory-avatar-release', NODE_PATH: path.join(root, 'functions/node_modules') };
    const declarations = base => JSON.parse(execFileSync(process.execPath, ['-e', probe, path.join(base, 'index.js'), JSON.stringify(names)], { env, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }));
    const callableDeclarations = declarations(destination);
    assert.deepEqual(callableDeclarations, declarations(path.join(group.targets[0].snapshotDirectory, 'functions')), 'Preserve every selected callable declaration');
    for (const target of group.targets) {
      assert.ok(callableDeclarations[target.name].region.includes(target.region));
      if (target.name === 'getWisEconomyState') assert.deepEqual([...callableDeclarations[target.name].region].sort(), ['asia-northeast3', 'us-central1']);
    }
    const plan = { directory, baseline, mode: group.mode, targets: group.targets, changes, added: [], expectedHashes, originalInventory: group.originalInventory,
      callableDeclarations, partialTransplants: group.mode === 'avatar' ? ['Preserved original encodeThumbnail exactly'] : [],
      deploymentCommand: `firebase deploy --only "${names.map(name => `functions:${name}`).join(',')}" --project history-quiz-yongsin --config firebase.json` };
    await fs.writeFile(path.join(directory, 'firebase.json'), JSON.stringify({ functions: { source: 'functions', codebase: 'default', ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'] } }, null, 2));
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(plan, null, 2));
    plans.push(plan);
    console.log(JSON.stringify({ group: group.key, targets: group.targets.map(target => `${target.name}--${target.region}`), changes, preserved: group.entries.length - changes.length }));
  }
  for (const [file, patch] of patches) assert.equal(await fs.readFile(path.join(root, 'functions', file), 'utf8'), patch, `Patch changed while preparing: ${file}`);
  await fs.writeFile(path.join(audit, 'prepared.json'), JSON.stringify(plans, null, 2));
}

async function main() {
  assert.ok(process.argv.slice(2).every(arg => ['--snapshot-only', '--prepare-only'].includes(arg)), 'Unsupported option');
  if (process.argv.includes('--prepare-only')) return prepare();
  const token = await accessToken(), snapshots = [];
  await fs.mkdir(audit, { recursive: true });
  let cursor = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < targets.length) {
      const target = targets[cursor++];
      const metadata = await (await readCloud(`https://cloudfunctions.googleapis.com/v2/projects/history-quiz-yongsin/locations/${target.region}/functions/${target.name}`, token)).json();
      assert.equal(metadata.state, 'ACTIVE', target.name);
      assert.equal(metadata.buildConfig.runtime, 'nodejs22', target.name);
      const source = metadata.buildConfig.source.storageSource;
      assert.ok(source.bucket && source.object && /^\d+$/.test(String(source.generation)));
      const directory = path.join(audit, 'originals', `${target.name}--${target.region}`, String(source.generation));
      await fs.mkdir(directory, { recursive: true });
      let bytes;
      try { bytes = await fs.readFile(path.join(directory, 'source.zip')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        bytes = Buffer.from(await (await readCloud(sourceUrl(source), token)).arrayBuffer());
        await fs.writeFile(path.join(directory, 'source.zip'), bytes);
      }
      const entries = await zipInventory(bytes), comparisons = [];
      for (const entry of entries) {
        const file = path.join(directory, 'functions', entry.path);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, entry.body);
      }
      for (const file of filesFor(target.mode)) {
        const entry = entries.find(entry => entry.path === file);
        assert.ok(entry, `${target.name}: missing ${file}`);
        const matches = normalize(entry.body.toString('utf8')) === normalize(baselineFile(file));
        comparisons.push({ file, baselineMatches: matches, sourceSha256: entry.sha256 });
        assertBaseline(file, entry.body.toString('utf8'), target.name);
      }
      // Newly used policy APIs must be present in every bundle that executes rank checks.
      if (target.mode === 'avatar') {
        const policy = entries.find(entry => entry.path === 'studentProfileEmojiPolicy.js');
        assert.ok(policy && policy.body.toString('utf8').includes('getCurrentTierCodeForRankTotal'), `${target.name}: missing rank policy helper`);
      }
      const manifest = { target, directory, sourceGeneration: source.generation, archiveSha256: sha(bytes), comparisons, fileCount: entries.length };
      await fs.writeFile(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2));
      await fs.writeFile(path.join(directory, 'inventory.json'), JSON.stringify(entries.map(({ body, ...entry }) => entry), null, 2));
      snapshots.push(manifest);
      console.log(JSON.stringify({ target: `${target.name}--${target.region}`, fileCount: entries.length, baselineDifferences: comparisons.filter(entry => !entry.baselineMatches).map(entry => entry.file) }));
    }
  }));
  snapshots.sort((a,b) => `${a.target.name}--${a.target.region}`.localeCompare(`${b.target.name}--${b.target.region}`));
  await fs.writeFile(path.join(audit, 'snapshots.json'), JSON.stringify(snapshots, null, 2));
  if (!process.argv.includes('--snapshot-only')) await prepare();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
