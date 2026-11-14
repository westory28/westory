const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const gatewayDir = path.resolve(__dirname, '../productionGateway');
const manifest = require('../productionGateway/source-manifest.json');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
assert.deepEqual(manifest.rootExports, ['executeCommand', 'getCommandStatus', 'executeLessonCorePointCommand', 'executeWisCommandFast', 'getWisCommandStatusFast', 'executeThinkCloudResponseFast']);
assert.deepEqual(manifest.isolatedQueryExports, [
  { name: 'getWisEconomyState', region: 'asia-northeast3', entry: '../studentWisQuery.js', source: 'wisEconomyQuery.js' },
  { name: 'getWisEconomyState', region: 'us-central1', entry: '../studentWisQuery.js', source: 'wisEconomyQuery.js' },
  { name: 'getWisEconomyStateFast', region: 'us-central1', entry: '../studentWisQuery.js', source: 'wisEconomyQuery.js' },
]);
for (const entry of manifest.files) {
  assert.match(entry.originalSha256, /^[a-f0-9]{64}$/);
  const file = path.join(gatewayDir, entry.file);
  assert.equal(sha(fs.readFileSync(file)), entry.sha256, `${entry.file} differs from the reviewed source manifest`);
  if (entry.file.endsWith('.js')) {
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
    assert.equal(check.status, 0, check.stderr || `${entry.file} syntax failed`);
  }
}
assert.equal(fs.readFileSync(path.join(gatewayDir, 'sessionAuthority.js'), 'utf8'),
  fs.readFileSync(path.resolve(__dirname, '../sessionAuthority.js'), 'utf8').replace(/\r\n/g, '\n'),
  'Canonical command and login endpoints must share the reviewed session contract');
const source = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8');
assert.match(source, /exports\.executeCommand = require\('\.\/productionGateway\/productionSource'\)\.executeCommand/);
assert.match(source, /exports\.getCommandStatus = require\('\.\/productionGateway\/productionSource'\)\.getCommandStatus/);
assert.match(source, /exports\.getAssessmentState = require\('\.\/productionGateway\/productionSource'\)\.getAssessmentState/);
assert.match(source, /exports\.saveAssessmentProgress = require\('\.\/productionGateway\/productionSource'\)\.saveAssessmentProgress/);
assert.match(source, /exports\.getThinkCloudState = require\('\.\/thinkCloudQuery'\)\.getThinkCloudState/);
assert.doesNotMatch(source, /exports\.getW8DomainState\s*=/, 'Do not redeploy unrelated W8/archived query domains');
assert.match(source, /exports\.executeLessonCorePointCommand = require\('\.\/productionGateway\/productionSource'\)\.executeLessonCorePointCommand/);
assert.match(source, /exports\.getWisEconomyState = require\('\.\/studentWisQuery'\)\.getWisEconomyState/);
const querySource = fs.readFileSync(path.resolve(__dirname, '../studentWisQuery.js'), 'utf8');
assert.match(querySource, /region: \['asia-northeast3', 'us-central1'\]/);
assert.doesNotMatch(querySource, /createWisCallableExports/);
assert.doesNotMatch(source, /Object\.assign\(exports, require\('\.\/productionGateway/);
process.env.GCLOUD_PROJECT = 'demo-westory-session-gateway-exports';
process.env.GOOGLE_CLOUD_PROJECT = process.env.GCLOUD_PROJECT;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: process.env.GCLOUD_PROJECT });
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:18192';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:19192';
const deployedFunctions = require('../index');
const canonicalFunctions = require('../productionGateway/productionSource');
assert.equal(deployedFunctions.getThinkCloudState, require('../thinkCloudQuery').getThinkCloudState);
assert.equal(deployedFunctions.getThinkCloudStateFast, require('../thinkCloudQuery').getThinkCloudStateFast);
assert.deepEqual(deployedFunctions.getThinkCloudStateFast.__endpoint?.region, ['us-central1']);
assert.equal(deployedFunctions.getThinkCloudStateFast.__endpoint?.minInstances, 0);
assert.deepEqual(deployedFunctions.getThinkCloudState.__endpoint?.region, ['asia-northeast3']);
assert.ok(Object.hasOwn(deployedFunctions.getThinkCloudState.__endpoint, 'callableTrigger'));
for (const name of [...manifest.rootExports, 'getAssessmentState', 'saveAssessmentProgress']) {
  assert.equal(typeof deployedFunctions[name], 'function', `${name} must be a deployed callable`);
  assert.equal(deployedFunctions[name], canonicalFunctions[name], `${name} must share the canonical command closure`);
  assert.deepEqual(deployedFunctions[name].__endpoint?.region,
    [name.endsWith('WisCommandFast') || name === 'getWisCommandStatusFast' || name === 'executeThinkCloudResponseFast' ? 'us-central1' : 'asia-northeast3']);
  assert.equal(deployedFunctions[name].__endpoint?.platform, 'gcfv2');
  assert.ok(Object.hasOwn(deployedFunctions[name].__endpoint, 'callableTrigger'));
}
for (const name of ['executeCommand', 'getCommandStatus', 'getAssessmentState', 'saveAssessmentProgress']) {
  const endpoint = deployedFunctions[name].__endpoint;
  assert.equal(endpoint.availableMemoryMb, 512, `${name} must retain paper/receipt memory headroom`);
  assert.equal(endpoint.cpu, 1);
  assert.equal(endpoint.concurrency, 8, `${name} must scale before class-wide requests exhaust one instance`);
  assert.equal(endpoint.maxInstances, 20);
  assert.equal(endpoint.minInstances, 0, 'Do not introduce idle-instance cost for this recovery');
  assert.equal(endpoint.timeoutSeconds, 60, 'Do not hide contention by extending the deadline');
}
console.log(`PASS production gateway: ${manifest.files.length} source hashes, syntax, canonical and restricted fast command/status exports and isolated queries`);
