import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditArgument = process.argv.slice(2).find(value => !value.startsWith('--'));
const groupName = process.argv.find(value => value.startsWith('--group='))?.slice('--group='.length);
const audit = path.resolve(root, auditArgument || 'output/avatar-minimi-20261111/release-audit');
const readJson = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const plans = await readJson(path.join(audit, 'prepared-release.json'));
const groups = groupName ? plans.filter(group => group.group === groupName) : plans;
assert.ok(groups.length > 0, 'Unknown release group');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const settings = value => ({
  runtime: value.buildConfig.runtime, entryPoint: value.buildConfig.entryPoint,
  buildServiceAccount: value.buildConfig.serviceAccount,
  service: Object.fromEntries(['availableMemory', 'availableCpu', 'timeoutSeconds', 'minInstanceCount',
    'maxInstanceCount', 'maxInstanceRequestConcurrency', 'ingressSettings', 'serviceAccountEmail',
    'vpcConnector', 'vpcConnectorEgressSettings', 'securityLevel'].map(key => [key, value.serviceConfig?.[key] ?? null])),
  event: value.eventTrigger ? Object.fromEntries(['eventType', 'eventFilters', 'retryPolicy',
    'triggerRegion', 'serviceAccountEmail'].map(key => [key, key === 'eventFilters'
      ? [...(value.eventTrigger.eventFilters || [])].sort((a, b) => a.attribute.localeCompare(b.attribute))
      : value.eventTrigger[key] ?? null])) : null,
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
await fs.writeFile(path.join(audit, groupName ? `post-deploy-${groupName}-verification.json` : 'post-deploy-verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, metadataOnly: process.argv.includes('--metadata-only'), targets: result.length,
  sourceFiles: result.reduce((count, row) => count + row.verifiedSourceFiles, 0) }));
