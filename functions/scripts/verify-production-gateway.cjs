const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const gatewayDir = path.resolve(__dirname, '../productionGateway');
const manifest = require('../productionGateway/source-manifest.json');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
assert.deepEqual(manifest.rootExports, ['executeCommand', 'getCommandStatus', 'executeLessonCorePointCommand']);
assert.deepEqual(manifest.isolatedQueryExports, [{ name: 'getWisEconomyState', region: 'asia-northeast3', entry: '../studentWisQuery.js', source: 'wisEconomyQuery.js' }]);
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
assert.match(source, /exports\.executeLessonCorePointCommand = require\('\.\/productionGateway\/productionSource'\)\.executeLessonCorePointCommand/);
assert.match(source, /exports\.getWisEconomyState = require\('\.\/studentWisQuery'\)\.getWisEconomyState/);
const querySource = fs.readFileSync(path.resolve(__dirname, '../studentWisQuery.js'), 'utf8');
assert.match(querySource, /region: 'asia-northeast3'/);
assert.doesNotMatch(querySource, /region:\s*\[|createWisCallableExports/);
assert.doesNotMatch(source, /Object\.assign\(exports, require\('\.\/productionGateway/);
process.env.GCLOUD_PROJECT = 'demo-westory-session-gateway-exports';
process.env.GOOGLE_CLOUD_PROJECT = process.env.GCLOUD_PROJECT;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: process.env.GCLOUD_PROJECT });
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:18192';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:19192';
const deployedFunctions = require('../index');
const canonicalFunctions = require('../productionGateway/productionSource');
for (const name of [...manifest.rootExports, 'getAssessmentState', 'saveAssessmentProgress']) {
  assert.equal(typeof deployedFunctions[name], 'function', `${name} must be a deployed callable`);
  assert.equal(deployedFunctions[name], canonicalFunctions[name], `${name} must share the canonical command closure`);
  assert.deepEqual(deployedFunctions[name].__endpoint?.region, ['asia-northeast3']);
  assert.equal(deployedFunctions[name].__endpoint?.platform, 'gcfv2');
  assert.ok(Object.hasOwn(deployedFunctions[name].__endpoint, 'callableTrigger'));
}
console.log(`PASS production gateway: ${manifest.files.length} source hashes, syntax, three canonical command/status exports and the isolated Seoul query export`);
