import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { accessToken, cloud, readCallablePolicy } from './wispi-bonus-claim-release-cloud.mjs';
import { root, inventory, normalize, resourceFields, resourceValue, sha, sourceUrl, zipInventory } from './prepare-wispi-market-release.mjs';

// Source/configuration reads and local release preparation only. This never
// deploys a function, reads a student document or changes an application record.
//
// The repository change to one file is replayed, hunk by hunk, onto the file
// that is live in production. The live file may lag the repository elsewhere;
// those lines are left exactly as they are.
const audit = path.join(root, 'output/history-copy-20261125');
const baseline = '7d75f01c';
const region = 'asia-northeast3';
const name = 'executeCommand';
const changedFile = 'productionGateway/assessmentLifecycle.js';
const release = path.join(audit, 'release');
const manifestPath = path.join(release, 'manifest.json');

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const before = normalize(git('show', `${baseline}:functions/${changedFile}`));
// Only a committed file is released: the working copy must equal HEAD.
assert.equal(git('status', '--porcelain', '--', `functions/${changedFile}`).trim(), '', 'Commit the lifecycle file before preparing a release');
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
const replay = (text, label, shortened = []) => hunks.reduce((current, lines, index) => {
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
  assert.ok(original, 'Deployed lifecycle source is missing');
  const shortened = [];
  const patched = replay(normalize(original), name, shortened);
  const existingDifference = delta(normalize(original), before);
  assert.deepEqual(delta(patched, repository), existingDifference, 'The edit must leave every other deployed line as it was');
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
  assert.deepEqual(differences.map((entry) => entry.path), [changedFile], 'Only the lifecycle file may change');
  assert.equal(expected.length, entries.length);
  execFileSync(process.execPath, ['--check', path.join(release, 'functions', changedFile)]);
  await fs.writeFile(path.join(release, 'firebase.json'), JSON.stringify({ functions: {
    source: 'functions', codebase: 'default', runtime: metadata.buildConfig.runtime,
    ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'],
  } }, null, 2) + '\n');
  await fs.writeFile(manifestPath, JSON.stringify({ name, region, source, updateTime: metadata.updateTime,
    originalRevision: metadata.serviceConfig.revision, archiveSha: sha(bytes), configuration: configuration(metadata),
    iam, expected, changedFiles: [changedFile], hunks: hunks.length, shortened, deployedLinesDifferingFromBaseline: existingDifference.length }, null, 2) + '\n');
  console.log(JSON.stringify({ name, mode, release, files: entries.length, changedFiles: [changedFile], hunks: hunks.length, shortened,
    deployedLinesDifferingFromBaseline: existingDifference.length, productionDataReads: 0, productionWrites: 0 }));
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
