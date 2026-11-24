import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { accessToken, cloud, readCallablePolicy } from './wispi-bonus-claim-release-cloud.mjs';
import { root, inventory, normalize, resourceFields, resourceValue, sha, sourceUrl, zipInventory } from './prepare-wispi-market-release.mjs';

// Source/configuration reads and local release preparation only. This never
// deploys a function, reads a student document or changes an application record.
//
// The committed change to ONE functions file is replayed, hunk by hunk, onto
// the copy of that file that is live in the named function. The live file may
// lag the repository elsewhere; those lines are left exactly as they are.
//
//   node scripts/prepare-function-release.mjs <prepare|preflight|verify>
//     --name commandYutRoomFast --region us-central1 --file yut.js
//     --baseline 7d75f01c --out output/yut-speed-20261125
//
// Two options for a function whose live file is not the baseline:
//   --hunks 1,3,4      apply only these hunks (numbered as `git diff -U3` lists them)
//   --whole --live-sha <first 12 hex of the live file's SHA-256>
//                      release the committed file as it is, for one reviewed
//                      live version; the lines that differ are recorded.
const option = (key) => { const index = process.argv.indexOf(`--${key}`); return index > 0 ? String(process.argv[index + 1] || '') : ''; };
const name = option('name'), region = option('region'), changedFile = option('file'), baseline = option('baseline'), out = option('out');
assert.match(name, /^[A-Za-z][A-Za-z0-9]{2,62}$/, '--name');
assert.ok(['asia-northeast3', 'us-central1'].includes(region), '--region');
assert.match(changedFile, /^[A-Za-z0-9_.\/-]+\.(js|mjs|cjs|json)$/, '--file (relative to functions/)');
assert.ok(!changedFile.includes('..'), '--file');
assert.match(baseline, /^[0-9a-f]{7,40}$/, '--baseline');
assert.match(out, /^output\/[A-Za-z0-9_-]+$/, '--out output/<folder>');
const whole = process.argv.includes('--whole'), liveSha = option('live-sha');
const chosen = option('hunks') ? option('hunks').split(',').map(Number) : null;
assert.ok(!whole || /^[0-9a-f]{12}$/.test(liveSha), '--whole needs --live-sha <12 hex>');
assert.ok(!(whole && chosen), 'Use either --whole or --hunks');
assert.ok(!chosen || chosen.every((value) => Number.isInteger(value) && value >= 1), '--hunks 1,2,...');
const audit = path.join(root, out, `${name}-${region}`);
const release = path.join(audit, 'release');
const manifestPath = path.join(release, 'manifest.json');

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const before = normalize(git('show', `${baseline}:functions/${changedFile}`));
// Only a committed file is released: the working copy must equal HEAD.
assert.equal(git('status', '--porcelain', '--', `functions/${changedFile}`).trim(), '', 'Commit the file before preparing a release');
const repository = normalize(git('show', `HEAD:functions/${changedFile}`));
// Each hunk becomes an exact "old block → new block" replacement with up to
// three lines of context on each side. Where the live file differs from the
// baseline right next to a change, the context on that side is shortened
// until the old block occurs exactly once; at least one context or removed
// line always remains, so the position is never guessed.
const hunks = normalize(git('diff', '--no-color', '-U3', baseline, '--', `functions/${changedFile}`))
  .split(/^@@ .*$/m).slice(1).map((body) =>
    body.replace(/^\n/, '').replace(/\n$/, '').split('\n').filter((line) => line !== '\\ No newline at end of file'));
assert.ok(hunks.length > 0, 'The repository holds no change to release');
const block = (lines, sign) => lines.filter((line) => line[0] !== sign).map((line) => line.slice(1)).join('\n');
const candidates = (lines) => {
  const lead = lines.findIndex((line) => line[0] !== ' ');
  const trail = lines.length - 1 - lines.findLastIndex((line) => line[0] !== ' ');
  const list = [];
  for (let dropLead = 0; dropLead <= lead; dropLead++) for (let dropTrail = 0; dropTrail <= trail; dropTrail++)
    list.push({ dropped: dropLead + dropTrail, lines: lines.slice(dropLead, lines.length - dropTrail) });
  return list.filter((item) => item.lines.some((line) => line[0] !== '+')).sort((a, b) => a.dropped - b.dropped);
};
assert.ok(!chosen || chosen.every((value) => value <= hunks.length), 'No such hunk');
const replay = (text, label, shortened = [], only = null) => hunks.reduce((current, lines, index) => {
  if (only && !only.includes(index + 1)) return current;
  const match = candidates(lines).find((item) => current.split(block(item.lines, '+')).length === 2);
  assert.ok(match, `${label}: hunk ${index + 1} must match exactly once`);
  if (match.dropped) shortened.push({ hunk: index + 1, droppedContextLines: match.dropped });
  return current.replace(block(match.lines, '+'), () => block(match.lines, '-'));
}, text);
const baselineShortened = [];
assert.equal(replay(before, 'baseline', baselineShortened), repository, 'Replaying the hunks on the baseline must give the repository file');
assert.deepEqual(baselineShortened, [], 'Every hunk matches the baseline with its full context');
// Lines present on one side only, as a multiset.
const delta = (left, right) => {
  const counts = new Map();
  for (const line of left.split('\n')) counts.set(line, (counts.get(line) || 0) + 1);
  for (const line of right.split('\n')) counts.set(line, (counts.get(line) || 0) - 1);
  return [...counts].filter(([, count]) => count !== 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
};
const configuration = (value) => ({
  runtime: value.buildConfig.runtime,
  resources: Object.fromEntries(resourceFields.map((field) => [field, resourceValue(value.serviceConfig, field)])),
  allTrafficOnLatestRevision: value.serviceConfig.allTrafficOnLatestRevision,
  environmentHash: sha(JSON.stringify(value.serviceConfig.environmentVariables || {})),
  secretHash: sha(JSON.stringify(value.serviceConfig.secretEnvironmentVariables || [])),
  eventTrigger: value.eventTrigger || null,
});

const mode = process.argv[2];
assert.ok(['prepare', 'preflight', 'verify'].includes(mode), 'Choose prepare, preflight, or verify');
const token = await accessToken();
const metadata = (await cloud(`https://cloudfunctions.googleapis.com/v2/projects/history-quiz-yongsin/locations/${region}/functions/${name}`, token)).json();
assert.equal(metadata.state, 'ACTIVE');
assert.equal(metadata.buildConfig.runtime, 'nodejs22');
const source = metadata.buildConfig.source.storageSource;
const iam = await readCallablePolicy(token, metadata);
if (mode === 'prepare') {
  const bytes = (await cloud(sourceUrl(source), token)).body;
  const entries = await zipInventory(bytes);
  const original = entries.find((entry) => entry.path === changedFile)?.body.toString('utf8');
  assert.ok(original, 'The deployed source does not contain this file');
  const shortened = [];
  const existingDifference = delta(normalize(original), before);
  if (whole) assert.ok(sha(normalize(original)).startsWith(liveSha), 'The live file is not the reviewed version');
  const patched = whole ? repository : replay(normalize(original), name, shortened, chosen);
  // What the result would be, were the live file the baseline.
  const intended = chosen ? replay(before, 'baseline', [], chosen) : repository;
  if (!whole) assert.deepEqual(delta(patched, intended), existingDifference, 'The edit must leave every other deployed line as it was');
  const liveChange = delta(patched, normalize(original));
  const linesOf = (sign) => liveChange.filter(([, count]) => Math.sign(count) === sign)
    .map(([line, count]) => `${Math.abs(count)}x ${line.trim().slice(0, 110)}`);
  await fs.mkdir(path.dirname(release), { recursive: true });
  await fs.mkdir(release); // Refuse to overwrite an older or partial preparation.
  await fs.writeFile(path.join(release, 'original.zip'), bytes);
  for (const entry of entries) {
    const destination = path.join(release, 'functions', entry.path);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, entry.path === changedFile ? patched : entry.body);
  }
  const expected = await inventory(path.join(release, 'functions'));
  const differences = expected.filter((entry) => entry.sha256 !== entries.find((item) => item.path === entry.path)?.sha256);
  assert.deepEqual(differences.map((entry) => entry.path), [changedFile], 'Only the named file may change');
  assert.equal(expected.length, entries.length);
  execFileSync(process.execPath, ['--check', path.join(release, 'functions', changedFile)]);
  await fs.writeFile(path.join(release, 'firebase.json'), JSON.stringify({ functions: {
    source: 'functions', codebase: 'default', runtime: metadata.buildConfig.runtime,
    ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'],
  } }, null, 2) + '\n');
  await fs.writeFile(manifestPath, JSON.stringify({ name, region, source, updateTime: metadata.updateTime,
    originalRevision: metadata.serviceConfig.revision, archiveSha: sha(bytes), configuration: configuration(metadata),
    iam, expected, changedFiles: [changedFile], hunks: hunks.length, appliedHunks: whole ? 'whole file' : chosen || 'all', shortened,
    deployedLinesDifferingFromBaseline: existingDifference.length, addedToLive: linesOf(1), removedFromLive: linesOf(-1) }, null, 2) + '\n');
  console.log(JSON.stringify({ name, mode, release, files: entries.length, changedFiles: [changedFile], hunks: hunks.length,
    appliedHunks: whole ? 'whole file' : chosen || 'all', shortened, deployedLinesDifferingFromBaseline: existingDifference.length,
    addedToLive: linesOf(1).length, removedFromLive: linesOf(-1).length, productionDataReads: 0, productionWrites: 0 }));
} else {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  assert.deepEqual(configuration(metadata), manifest.configuration, 'Runtime configuration changed');
  assert.deepEqual(iam, manifest.iam, 'Invocation permissions changed');
  assert.deepEqual(await inventory(path.join(release, 'functions')), manifest.expected, 'Prepared source changed');
  if (mode === 'preflight') {
    assert.deepEqual(source, manifest.source, 'Function was concurrently deployed');
    assert.equal(metadata.updateTime, manifest.updateTime);
  } else {
    const live = await zipInventory((await cloud(sourceUrl(source), token)).body);
    assert.deepEqual(live.map(({ body, ...entry }) => entry), manifest.expected, 'Deployed source mismatch');
  }
  console.log(JSON.stringify({ name, mode, matches: true, revision: metadata.serviceConfig.revision, generation: source.generation,
    productionDataReads: 0, productionWrites: 0 }));
}
