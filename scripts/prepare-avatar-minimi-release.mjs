import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Inputs are fresh gcloud source snapshots. This command prepares local bundles;
// it never deploys, changes a runtime option, or substitutes a repository index.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audit = path.resolve(root, process.argv[2] || 'output/avatar-minimi-20261111/release-audit');
const baselineCommit = process.argv[3] || 'a22c1cd93fd312c703785d6e5644e790cbf1be18';
assert.match(baselineCommit, /^[a-f0-9]{40}$/, 'Explicit source baseline commit required');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async name => JSON.parse((await fs.readFile(name, 'utf8')).replace(/^\uFEFF/, ''));
const rows = await readJson(path.join(audit, 'source-map.json'));
const walk = async directory => {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), 'Source snapshots cannot contain links');
    if (entry.name === 'node_modules') continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(filename)); else result.push(filename);
  }
  return result.sort();
};
const allowedTargets = new Set(['getStudentAvatar', 'getAvatarStudioState', 'purchaseStudentAvatarItem',
  'saveStudentAvatar', 'getTeacherMyPage', 'saveTeacherAvatar', 'getAvatarCatalogPricing',
  'updateAvatarCatalogPricing', 'cleanupStudentAvatarOnUserDelete', 'cleanupTeacherAvatarOnUserDelete',
  'getWisRankingPreview', 'getWisEconomyState', 'getWisEconomyStateFast']);
const groups = new Map();
for (const row of rows) {
  const [name, region] = row.target.split('--');
  assert.ok(allowedTargets.has(name) && ['us-central1', 'asia-northeast3'].includes(region));
  const source = path.join(audit, 'originals', row.source);
  const metadata = await readJson(path.join(audit, 'metadata', row.metadata));
  assert.ok(metadata.name.endsWith(`/locations/${region}/functions/${name}`));
  const baseline = [];
  for (const filename of await walk(source)) baseline.push({ path: path.relative(source, filename).replaceAll('\\', '/'), sha256: sha(await fs.readFile(filename)) });
  const mode = name.startsWith('cleanup') ? 'cleanup' : name.includes('CatalogPricing') ? 'pricing' : 'avatar';
  const groupKey = `${mode}-${sha(JSON.stringify(baseline)).slice(0, 12)}`;
  if (!groups.has(groupKey)) groups.set(groupKey, { name: groupKey, mode, source, baseline, targets: [] });
  groups.get(groupKey).targets.push({ name, region, metadata: row.metadata,
    sourceArchiveSha256: sha(await fs.readFile(`${source}.zip`)) });
}
const report = [];
for (const group of groups.values()) {
  const directory = path.join(audit, 'releases', group.name), destination = path.join(directory, 'functions');
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(group.source, destination, { recursive: true, force: true, filter: filename => path.basename(filename) !== 'node_modules' });
  const allowed = group.mode === 'cleanup' ? ['studentAvatar.js']
    : group.mode === 'pricing' ? ['avatarCatalog.json', 'studentAvatarCatalog.js', 'avatarCatalogPricing.js']
      : ['avatarCatalog.json', 'studentAvatarCatalog.js', 'avatarCatalogPricing.js', 'studentAvatar.js'];
  if (group.mode === 'cleanup') {
    const filename = path.join(destination, 'studentAvatar.js');
    const original = await fs.readFile(filename, 'utf8');
    const anchor = "  await storageBucket.deleteFiles({ prefix: `${thumbnails}/v1/${hash(uid)}/`, force: true });";
    assert.equal(original.split(anchor).length, 2, 'Cleanup patch must match exactly once');
    await fs.writeFile(filename, original.replace(anchor,
      "  for (const version of ['v1', 'v2']) {\n    await storageBucket.deleteFiles({ prefix: `${thumbnails}/${version}/${hash(uid)}/`, force: true });\n  }"));
  } else {
    for (const file of allowed) {
      if (group.mode === 'avatar') {
        const baseline = execFileSync('git', ['show', `${baselineCommit}:functions/${file}`], { cwd: root, encoding: 'utf8' });
        const live = await fs.readFile(path.join(group.source, file), 'utf8');
        assert.equal(live.replace(/\r\n/g, '\n'), baseline.replace(/\r\n/g, '\n'), `Unreviewed deployed source difference: ${file}`);
      }
      await fs.copyFile(path.join(root, 'functions', file), path.join(destination, file));
    }
  }
  const changes = [];
  for (const before of group.baseline) {
    const after = sha(await fs.readFile(path.join(destination, before.path)));
    if (after !== before.sha256) changes.push({ path: before.path, before: before.sha256, after });
  }
  assert.deepEqual(changes.map(item => item.path).sort(), allowed.sort());
  assert.deepEqual((await walk(destination)).map(name => path.relative(destination, name).replaceAll('\\', '/')).sort(), group.baseline.map(row => row.path).sort());
  for (const filename of allowed.filter(file => file.endsWith('.js'))) execFileSync(process.execPath, ['--check', path.join(destination, filename)]);
  await fs.writeFile(path.join(directory, 'firebase.json'), JSON.stringify({ functions: {
    source: 'functions', codebase: 'default', ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'],
  } }, null, 2) + '\n');
  const command = `firebase deploy --only "${[...new Set(group.targets.map(row => `functions:${row.name}`))].join(',')}" --project history-quiz-yongsin --config firebase.json`;
  const manifest = { name: group.name, targets: group.targets, changes, baselineFiles: group.baseline,
    preserved: ['index.js and callable exports', 'package.json and lockfile', 'runtime and dependencies', 'session and role authorization'], deploymentCommand: command };
  await fs.writeFile(path.join(directory, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  report.push({ group: group.name, directory, targets: group.targets.map(row => `${row.name}--${row.region}`),
    changedFiles: changes.map(row => row.path), preservedFiles: group.baseline.length - changes.length, deploymentCommand: command });
}
await fs.writeFile(path.join(audit, 'prepared-release.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
