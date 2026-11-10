import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Preserve each deployed function's own source archive. Never copy the working
// tree's index, dependency files, session policy, or runtime into these bundles.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const originals = path.join(root, 'output/security-production-sources');
const releases = path.join(root, 'output/security-release');
const targets = {
  uploadMapAssetContent: ['mapManagement.js',
    '    const checkActive = async (transaction) => {',
    '    if (ticket.kind !== "PDF") assertRasterImageBytes(bytes, ticket.contentType);\n'],
  uploadSourceArchiveAsset: ['sourceArchiveManagement.js',
    '    const assetRef = db.doc(`source_archive/${ticket.assetId}`);\n    const writeLeaseId = randomUUID();',
    '    if (ticket.mediaKind !== "pdf") assertRasterImageBytes(bytes, ticket.contentType);\n'],
  registerSchoolBanner: ['schoolBanners.js',
    '  return {\n    semesterId: data.semesterId,\n    requestId: data.requestId,',
    '  if (bytes) assertRasterImageBytes(bytes);\n'],
  processSourceArchiveIncomingUpload: ['sourceArchiveProcessor.js',
    '  const sourceImage = sharp(inputBuffer, {',
    '  assertRasterImageBytes(inputBuffer, undefined, { legacyArchive: true });\n'],
  processLessonAssetUpload: ['lessonAssetVerification.js',
    '  const info = await require("sharp")(buffer, {',
    '  assertRasterImageBytes(buffer, ticket.contentType);\n'],
  uploadLessonAssetContent: ['lessonAssetVerification.js',
    '  const info = await require("sharp")(buffer, {',
    '  assertRasterImageBytes(buffer, ticket.contentType);\n'],
};
const selected = process.argv.slice(2);
if (!selected.length) selected.push(...Object.keys(targets));
assert.equal(new Set(selected).size, selected.length, 'Duplicate deployment target');
for (const target of selected) assert.ok(Object.hasOwn(targets, target), `Unknown target: ${target}`);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const normalize = text => text.replace(/\r\n/g, '\n');
const files = async directory => {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), `Unexpected symlink: ${entry.name}`);
    if (entry.name === 'node_modules') continue;
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(name));
    else result.push(name);
  }
  return result.sort();
};
const helper = await fs.readFile(path.join(root, 'functions/rasterImageSafety.js'));
const plans = [];
for (const target of selected) {
  const source = path.join(originals, target);
  const [name, anchor, insertion] = targets[target];
  const originalBytes = await fs.readFile(path.join(source, name));
  const original = normalize(originalBytes.toString('utf8'));
  assert.equal(original.split(anchor).length, 2, `${target}: patch anchor must occur exactly once`);
  assert.ok(!original.includes('assertRasterImageBytes'), `${target}: source is already patched`);
  const newline = originalBytes.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';
  const patched = ('const { assertRasterImageBytes } = require("./rasterImageSafety");\n' +
    original.replace(anchor, insertion + anchor)).replace(/\n/g, newline);
  const sourceFiles = await files(source);
  const baseline = [];
  for (const filename of sourceFiles) baseline.push({ path: path.relative(source, filename).replaceAll('\\', '/'),
    sha256: hash(await fs.readFile(filename)) });
  const archive = await fs.readFile(path.join(originals, `${target}.zip`));
  plans.push({ target, source, name, patched, baseline, archiveSha256: hash(archive) });
}

for (const plan of plans) {
  const directory = path.join(releases, plan.target);
  const destination = path.join(directory, 'functions');
  await fs.mkdir(destination, { recursive: true });
  const allowedFiles = new Set([...plan.baseline.map(item => item.path), 'rasterImageSafety.js']);
  for (const existing of await files(destination)) {
    const relative = path.relative(destination, existing).replaceAll('\\', '/');
    assert.ok(allowedFiles.has(relative), `${plan.target}: unexpected staging file ${relative}`);
  }
  await fs.cp(plan.source, destination, { recursive: true, force: true, filter: source => path.basename(source) !== 'node_modules' });
  await fs.writeFile(path.join(destination, plan.name), plan.patched);
  await fs.writeFile(path.join(destination, 'rasterImageSafety.js'), helper);
  const changes = [];
  for (const item of plan.baseline) {
    const actual = hash(await fs.readFile(path.join(destination, item.path)));
    if (actual !== item.sha256) changes.push({ path: item.path, beforeSha256: item.sha256, afterSha256: actual });
  }
  assert.deepEqual(changes.map(item => item.path), [plan.name], 'Only the named image boundary may change');
  changes.push({ path: 'rasterImageSafety.js', beforeSha256: null, afterSha256: hash(helper) });
  for (const filename of [plan.name, 'rasterImageSafety.js']) execFileSync(process.execPath,
    ['--check', path.join(destination, filename)], { stdio: 'pipe' });
  let diff = '';
  for (const [before, after] of [[path.join(plan.source, plan.name), path.join(destination, plan.name)],
    [process.platform === 'win32' ? 'NUL' : '/dev/null', path.join(destination, 'rasterImageSafety.js')]]) {
    try { diff += execFileSync('git', ['diff', '--no-index', '--no-ext-diff', '--', before, after], { encoding: 'utf8' }); }
    catch (error) { if (error.status !== 1) throw error; diff += error.stdout; }
  }
  await fs.writeFile(path.join(directory, 'changes.patch'), diff);
  await fs.writeFile(path.join(directory, 'firebase.json'), JSON.stringify({ functions: {
    source: 'functions', codebase: 'default', ignore: ['node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log'],
  } }, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'release-manifest.json'), JSON.stringify({
    target: plan.target, project: 'history-quiz-yongsin', archiveSha256: plan.archiveSha256,
    baselineFiles: plan.baseline, changes,
    deploymentCommand: `firebase deploy --only "functions:${plan.target}" --project history-quiz-yongsin --config firebase.json`,
    preserved: ['index.js and exports', 'package.json and runtime', 'package-lock.json', 'authorization and session policy'],
  }, null, 2) + '\n');
  console.log(`Prepared ${plan.target}: ${plan.name} + rasterImageSafety.js; original exports/runtime/dependencies preserved.`);
}
