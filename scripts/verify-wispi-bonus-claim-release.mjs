import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { audit, baseline, project, region, allTargets, existingTarget, functionUrl, accessToken, cloud,
  sourceUrl, zipInventory, expectedInventory, loadSnapshot, loadPrepared, validatePrepared,
  assertCloudBefore, assertReleasedMetadata, readOperations, readCallablePolicy } from './prepare-wispi-bonus-claim-release.mjs';

// Source/configuration verification only. No student reads, callable requests,
// claims, deposits, backfills, deployments or settings writes.
const args = process.argv.slice(2);
assert.ok(args.length <= 1 && args.every(arg => ['--local-only', '--after'].includes(arg)), 'Choose --local-only, --after, or no argument');
const localOnly = args.includes('--local-only'), after = args.includes('--after');
const saved = await loadSnapshot(), prepared = await loadPrepared();
await validatePrepared(prepared, saved);
const revisions = [];
if (!localOnly) {
  const token = await accessToken();
  if (!after) await assertCloudBefore(token, saved);
  else {
    for (const name of allTargets) {
      const metadata = (await cloud(functionUrl(name), token)).json();
      assertReleasedMetadata(metadata, name, saved.target.metadata);
      assert.deepEqual(await readCallablePolicy(token, metadata), prepared.callableIam, `${name}: callable IAM differs`);
      if (name === existingTarget) assert.notDeepEqual(metadata.buildConfig.source.storageSource,
        saved.target.metadata.buildConfig.source.storageSource, 'Transfer source was not redeployed');
      const source = metadata.buildConfig.source.storageSource;
      assert.ok(source.bucket && source.object && /^\d+$/.test(String(source.generation)), 'Versioned deployed source is required');
      const entries = await zipInventory((await cloud(sourceUrl(source), token)).body);
      assert.deepEqual(entries.map(({ body, ...entry }) => entry), expectedInventory(prepared.expectedHashes), `${name}: deployed source mismatch`);
      revisions.push({ name, revision: metadata.serviceConfig.revision, generation: source.generation, updateTime: metadata.updateTime });
    }
    assert.deepEqual(await readOperations(token, project, region), saved.operations, 'Scheduler/task queue/IAM/settlement source changed');
  }
}
const mode = localOnly ? 'local-only' : after ? 'post-deploy' : 'pre-deploy';
const report = { schemaVersion: 1, mode, baseline, project, targets: allTargets, sourceMatches: true,
  runtimeAndOperationalConfigurationChecked: !localOnly, productionDataReads: 0, productionWrites: 0,
  verifiedAt: new Date().toISOString(), directory: prepared.directory, patchSetSha256: prepared.patchSetSha256,
  sourceFiles: Object.keys(prepared.expectedHashes).length, changes: prepared.changes.map(item => item.file), revisions };
await fs.writeFile(path.join(audit, `verification-${mode}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
