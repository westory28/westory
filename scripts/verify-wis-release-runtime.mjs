import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseArgument = process.argv.find(value => value.startsWith('--release-dir='));
const audit = path.resolve(root, releaseArgument?.slice('--release-dir='.length) || 'output/wis-system-20261114/release');
const groups = JSON.parse(await fs.readFile(path.join(audit, 'prepared.json'), 'utf8'));
const after = process.argv.includes('--after');
const restore = process.argv.includes('--restore-runtime');
assert.ok(!restore || after, 'Runtime preservation is only available after deployment');
const token = String(execFileSync('cmd.exe', ['/d', '/s', '/c', 'gcloud.cmd auth print-access-token'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).trim();
const call = async (name, options = {}) => {
  const response = await fetch(`https://cloudfunctions.googleapis.com/v2/${name}`, {
    ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  assert.ok(response.ok, `Function metadata request failed: ${response.status}`);
  return response.json();
};
const resourceFields = ['availableMemory', 'availableCpu', 'timeoutSeconds', 'minInstanceCount',
  'maxInstanceCount', 'maxInstanceRequestConcurrency', 'serviceAccountEmail', 'ingressSettings',
  'vpcConnector', 'vpcConnectorEgressSettings'];
const normalize = (value, field) => ['minInstanceCount'].includes(field) ? value || 0 : value ?? null;
const results = [];
for (const group of groups) for (const target of group.targets) {
  const name = `projects/history-quiz-yongsin/locations/${target.region}/functions/${target.name}`;
  const current = await call(name);
  const differences = resourceFields.filter(field => normalize(current.serviceConfig[field], field) !== normalize(target.serviceConfig[field], field));
  const row = { name: target.name, region: target.region, state: current.state,
    runtimeMatches: current.buildConfig.runtime === target.runtime, runtimeDifferences: differences };
  if (!after) row.sourceMatches = String(current.buildConfig.source.storageSource.generation) === String(target.sourceGeneration);
  if (after) {
    const { bucket, object, generation } = current.buildConfig.source.storageSource;
    const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media&generation=${generation}`,
      { headers: { Authorization: `Bearer ${token}` } });
    assert.ok(response.ok, `Deployed source verification failed: ${response.status}`);
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    row.sourceMatches = true;
    for (const [file, expected] of Object.entries(group.expectedHashes)) {
      const item = zip.file(file);
      if (!item || createHash('sha256').update(await item.async('nodebuffer')).digest('hex') !== expected) row.sourceMatches = false;
    }
  }
  if (restore && differences.length) {
    const serviceConfig = Object.fromEntries(differences.map(field => [field, target.serviceConfig[field] ?? null]));
    const operation = await call(`${name}?updateMask=${differences.map(field => `serviceConfig.${field}`).join(',')}`,
      { method: 'PATCH', body: JSON.stringify({ name, serviceConfig }) });
    row.restoreOperation = operation.name;
  }
  results.push(row);
}
const report = { mode: after ? 'post-deploy' : 'pre-deploy', results };
await fs.writeFile(path.join(audit, after ? 'runtime-after.json' : 'runtime-before.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (results.some(row => row.state !== 'ACTIVE' || !row.runtimeMatches || row.runtimeDifferences.length || row.sourceMatches === false)) process.exitCode = 2;
