import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { audit, baseline, project, reader, priceScheduler, allTargets, targetsFor, functionUrl,
  accessToken, readCloud, sourceUrl, zipInventory, expectedInventory, loadSnapshot, loadPrepared,
  validatePrepared, assertCloudBefore, assertMetadata, readOperationalConfiguration } from './prepare-wispi-sector-read-release.mjs';

// Reads deployment metadata/source/IAM only; does not invoke a callable or scheduler.
const args = process.argv.slice(2);
assert.ok(args.every(arg => ['--phase=bootstrap', '--phase=final', '--local-only', '--after'].includes(arg)), 'Unsupported argument');
assert.ok(!(args.includes('--phase=bootstrap') && args.includes('--phase=final')), 'Choose one phase');
const phase = args.includes('--phase=final') ? 'final' : 'bootstrap', localOnly = args.includes('--local-only'), after = args.includes('--after');
assert.ok(!(localOnly && after), '--after requires cloud inspection');
const saved = await loadSnapshot(), groups = await loadPrepared(phase);
await validatePrepared(phase, groups, saved);
const bootstrap = phase === 'final' ? await loadPrepared('bootstrap') : groups;
if (phase === 'final') await validatePrepared('bootstrap', bootstrap, saved);
const results = groups.map(group => ({ targets: group.targets.map(target => target.name), sourceFiles: Object.keys(group.expectedHashes).length,
  changes: group.changes, added: group.added, preservedFiles: group.originalInventory.length - group.changes.filter(file => !group.added.includes(file)).length }));
if (!localOnly) {
  const token = await accessToken();
  if (!after) await assertCloudBefore(token, saved, phase, bootstrap);
  else {
    const metadata = [];
    for (const name of allTargets) {
      const original = saved.targets.find(target => target.name === name), current = await (await readCloud(functionUrl(name), token)).json();
      assertMetadata(current, name, original.metadata);
      const group = groups.find(item => item.targets.some(target => target.name === name))
        || (phase === 'final' && name === reader ? bootstrap.find(item => item.targets.some(target => target.name === name)) : null);
      if (group) {
        const entries = await zipInventory(Buffer.from(await (await readCloud(sourceUrl(current.buildConfig.source.storageSource), token)).arrayBuffer()));
        assert.ok(isDeepStrictEqual(entries.map(({ body, ...entry }) => entry), expectedInventory(group.expectedHashes)), `${name}: deployed source differs from reviewed package`);
      } else {
        assert.equal(name, priceScheduler, 'Only the price scheduler is unchanged during bootstrap');
        assert.ok(isDeepStrictEqual(current.buildConfig.source.storageSource, original.metadata.buildConfig.source.storageSource), `${name}: unselected source changed`);
      }
      metadata.push(current);
    }
    assert.ok(isDeepStrictEqual(await readOperationalConfiguration(token, metadata), saved.operations), 'Scheduler/task queue/IAM configuration changed');
  }
}
const mode = localOnly ? 'local-only' : after ? 'post-deploy' : 'pre-deploy';
const report = { phase, mode, baseline, project, targets: targetsFor(phase), results,
  sourceMatches: true, runtimeAndOperationalConfigurationChecked: !localOnly, productionDataReads: 0, productionWrites: 0 };
await fs.writeFile(path.join(audit, `verification-${phase}-${mode}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
