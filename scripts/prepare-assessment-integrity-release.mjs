import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { accessToken, cloud, readCallablePolicy } from './wispi-bonus-claim-release-cloud.mjs';
import { root, inventory, normalize, resourceFields, resourceValue, sha, sourceUrl, zipInventory } from './prepare-wispi-market-release.mjs';

// Source/configuration reads and local release preparation only. This never
// deploys a function, reads a student document or changes an application record.
const audit = path.join(root, 'output/assessment-integrity-20261124');
const baseline = '7898713b7e48df81e4d2f816d5bdabf07ff68744';
const region = 'asia-northeast3';
const names = ['executeCommand', 'getAssessmentState'];
const changedFile = 'productionGateway/assessmentLifecycle.js';
const replacements = [
  ['const MOCK_ATTEMPT_STATE_FIELDS = ["studentUid", "resetAt", "attemptNumber", "status", "submittedAtIso"];\n',
    'const MOCK_ATTEMPT_STATE_FIELDS = ["studentUid", "resetAt", "attemptNumber", "status", "submittedAtIso"];\n'
    + 'const QUIZ_TIMEOUT_SUBMIT_GRACE_MS = 300_000;\n'],
  ['      await assertAttemptAnswers(transaction, attempt, payload.answers);\n'
    + '      const effectiveAnswers = payload.answers;\n',
    '      await assertAttemptAnswers(transaction, attempt, payload.answers);\n'
    + '      // A timed-out quiz normally arrives moments after its deadline. Beyond the\n'
    + '      // delivery allowance, grade only what was saved before the deadline.\n'
    + '      const lateQuizTimeout = attempt.assessmentKind === "QUIZ" && payload.submitReason === "TIMEOUT"\n'
    + '        && nowDate.getTime() > Date.parse(attempt.deadlineAtIso) + QUIZ_TIMEOUT_SUBMIT_GRACE_MS;\n'
    + '      const effectiveAnswers = lateQuizTimeout ? (attempt.answers || {}) : payload.answers;\n'],
  ['const serializeAttempt = (attempt, resumed) => ({\n',
    '// Option-level misconception labels mark which choices are distractors, so an\n'
    + '// unsubmitted attempt never carries them to the student.\n'
    + 'const visibleLearningSnapshot = attempt => attempt.status === "SUBMITTED" ? (attempt.learningSnapshot || [])\n'
    + '  : (attempt.learningSnapshot || []).map(({ misconceptionTags, ...item }) => item);\n\n'
    + 'const serializeAttempt = (attempt, resumed) => ({\n'],
  ['{ analytics: attempt.analytics || null, learningSnapshot: attempt.learningSnapshot || [],\n',
    '{ analytics: attempt.analytics || null, learningSnapshot: visibleLearningSnapshot(attempt),\n'],
];
const patch = (text, label) => replacements.reduce((current, [before, after]) => {
  assert.equal(current.split(before).length, 2, `${label}: expected one reviewed anchor`);
  assert.ok(!current.includes(after), `${label}: change already present`);
  return current.replace(before, () => after);
}, text);
// Lines present on one side only, as a multiset. The deployed file may lag the
// repository elsewhere; the reviewed edit must neither add nor remove such lines.
const delta = (left, right) => {
  const counts = new Map();
  for (const line of left.split('\n')) counts.set(line, (counts.get(line) || 0) + 1);
  for (const line of right.split('\n')) counts.set(line, (counts.get(line) || 0) - 1);
  return [...counts].filter(([, count]) => count !== 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
};
const configuration = value => ({
  runtime: value.buildConfig.runtime,
  resources: Object.fromEntries(resourceFields.map(field => [field, resourceValue(value.serviceConfig, field)])),
  allTrafficOnLatestRevision: value.serviceConfig.allTrafficOnLatestRevision,
  environmentHash: sha(JSON.stringify(value.serviceConfig.environmentVariables || {})),
  secretHash: sha(JSON.stringify(value.serviceConfig.secretEnvironmentVariables || [])),
  eventTrigger: value.eventTrigger || null,
});

const mode = process.argv[2];
assert.ok(['prepare', 'preflight', 'verify'].includes(mode), 'Choose prepare, preflight, or verify');
const selected = process.argv[3] ? [process.argv[3]] : names;
assert.ok(selected.every(name => names.includes(name)), 'Unknown function');

// The repository change must be exactly the reviewed replacements.
const repository = normalize(await fs.readFile(path.join(root, 'functions', changedFile), 'utf8'));
const before = normalize(execFileSync('git', ['show', `${baseline}:functions/${changedFile}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
assert.equal(patch(before, 'baseline'), repository, 'Repository lifecycle differs from the reviewed replacements');

const token = await accessToken();
const reports = [];
for (const name of selected) {
  const release = path.join(audit, name, 'release');
  const manifestPath = path.join(release, 'manifest.json');
  const metadata = (await cloud(`https://cloudfunctions.googleapis.com/v2/projects/history-quiz-yongsin/locations/${region}/functions/${name}`, token)).json();
  assert.equal(metadata.state, 'ACTIVE', name);
  assert.equal(metadata.buildConfig.runtime, 'nodejs22', name);
  const source = metadata.buildConfig.source.storageSource;
  const iam = await readCallablePolicy(token, metadata);
  if (mode === 'prepare') {
    const bytes = (await cloud(sourceUrl(source), token)).body;
    const entries = await zipInventory(bytes);
    const original = entries.find(entry => entry.path === changedFile)?.body.toString('utf8');
    assert.ok(original, `${name}: deployed lifecycle source is missing`);
    const patched = patch(normalize(original), name);
    const existingDifference = delta(normalize(original), before);
    assert.deepEqual(delta(patched, repository), existingDifference,
      `${name}: the edit must leave every other deployed line as it was`);
    await fs.mkdir(path.dirname(release), { recursive: true });
    await fs.mkdir(release); // Refuse to overwrite an older or partial preparation.
    await fs.writeFile(path.join(release, 'original.zip'), bytes);
    for (const entry of entries) {
      const destination = path.join(release, 'functions', entry.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, entry.path === changedFile ? patched : entry.body);
    }
    const expected = await inventory(path.join(release, 'functions'));
    const differences = expected.filter(entry => entry.sha256 !== entries.find(item => item.path === entry.path)?.sha256);
    assert.deepEqual(differences.map(entry => entry.path), [changedFile], `${name}: only the lifecycle file may change`);
    assert.equal(expected.length, entries.length);
    execFileSync(process.execPath, ['--check', path.join(release, 'functions', changedFile)]);
    await fs.writeFile(path.join(release, 'firebase.json'), JSON.stringify({ functions: {
      source: 'functions', codebase: 'default', runtime: metadata.buildConfig.runtime,
      ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'],
    } }, null, 2) + '\n');
    await fs.writeFile(manifestPath, JSON.stringify({ name, region, source, updateTime: metadata.updateTime,
      originalRevision: metadata.serviceConfig.revision, archiveSha: sha(bytes), configuration: configuration(metadata),
      iam, expected, changedFiles: [changedFile], deployedLinesDifferingFromBaseline: existingDifference.length }, null, 2) + '\n');
    reports.push({ name, mode, release, files: entries.length, changedFiles: [changedFile],
      deployedLinesDifferingFromBaseline: existingDifference.length });
  } else {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.deepEqual(configuration(metadata), manifest.configuration, `${name}: runtime configuration changed`);
    assert.deepEqual(iam, manifest.iam, `${name}: invocation permissions changed`);
    assert.deepEqual(await inventory(path.join(release, 'functions')), manifest.expected, `${name}: prepared source changed`);
    if (mode === 'preflight') {
      assert.deepEqual(source, manifest.source, `${name}: function was concurrently deployed`);
      assert.equal(metadata.updateTime, manifest.updateTime);
    } else {
      const live = await zipInventory((await cloud(sourceUrl(source), token)).body);
      assert.deepEqual(live.map(({ body, ...entry }) => entry), manifest.expected, `${name}: deployed source mismatch`);
    }
    reports.push({ name, mode, matches: true, revision: metadata.serviceConfig.revision, generation: source.generation });
  }
}
console.log(JSON.stringify({ reports, productionDataReads: 0, productionWrites: 0 }));
