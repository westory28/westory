import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audit = path.resolve(root, process.argv[2] || 'output/avatar-minimi-20261111/release-audit');
const readJson = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const groups = await readJson(path.join(audit, 'prepared-release.json'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const settings = value => ({
  runtime: value.buildConfig.runtime, entryPoint: value.buildConfig.entryPoint,
  buildServiceAccount: value.buildConfig.serviceAccount,
  service: Object.fromEntries(['availableMemory', 'availableCpu', 'timeoutSeconds', 'minInstanceCount',
    'maxInstanceCount', 'maxInstanceRequestConcurrency', 'ingressSettings', 'serviceAccountEmail',
    'vpcConnector', 'vpcConnectorEgressSettings', 'securityLevel'].map(key => [key, value.serviceConfig?.[key] ?? null])),
  event: value.eventTrigger ? Object.fromEntries(['eventType', 'eventFilters', 'retryPolicy',
    'triggerRegion', 'serviceAccountEmail'].map(key => [key, value.eventTrigger[key] ?? null])) : null,
});
const result = [];
for (const group of groups) {
  const manifest = await readJson(path.join(group.directory, 'release-manifest.json'));
  const changes = new Map(manifest.changes.map(row => [row.path, row.after]));
  for (const target of group.targets) {
    const before = await readJson(path.join(audit, 'metadata', `${target}.json`));
    const after = await readJson(path.join(audit, 'post-deploy/metadata', `${target}.json`));
    assert.equal(after.state, 'ACTIVE', target);
    assert.deepEqual(settings(after), settings(before), `Runtime/resource/authorization configuration changed: ${target}`);
    if (!process.argv.includes('--metadata-only')) {
      const source = path.join(audit, 'post-deploy/sources', target);
      for (const file of manifest.baselineFiles) {
        const expected = changes.get(file.path) || file.sha256;
        assert.equal(sha(await fs.readFile(path.join(source, file.path))), expected, `${target}: ${file.path}`);
      }
    }
    result.push({ target, active: true, settingsPreserved: true,
      verifiedSourceFiles: process.argv.includes('--metadata-only') ? 0 : manifest.baselineFiles.length });
  }
}
await fs.writeFile(path.join(audit, 'post-deploy-verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, metadataOnly: process.argv.includes('--metadata-only'), targets: result.length,
  sourceFiles: result.reduce((count, row) => count + row.verifiedSourceFiles, 0) }));
