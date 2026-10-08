const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const gatewayDir = path.resolve(__dirname, '../productionGateway');
const manifest = require('../productionGateway/source-manifest.json');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
assert.deepEqual(manifest.rootExports, ['executeCommand', 'executeLessonCorePointCommand']);
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
assert.match(source, /exports\.executeLessonCorePointCommand = require\('\.\/productionGateway\/productionSource'\)\.executeLessonCorePointCommand/);
assert.match(source, /exports\.getWisEconomyState = require\('\.\/studentWisQuery'\)\.getWisEconomyState/);
const querySource = fs.readFileSync(path.resolve(__dirname, '../studentWisQuery.js'), 'utf8');
assert.match(querySource, /region: 'asia-northeast3'/);
assert.doesNotMatch(querySource, /region:\s*\[|createWisCallableExports/);
assert.doesNotMatch(source, /Object\.assign\(exports, require\('\.\/productionGateway/);
console.log(`PASS production gateway: ${manifest.files.length} source hashes, syntax, two canonical command exports and the isolated Seoul query export`);
