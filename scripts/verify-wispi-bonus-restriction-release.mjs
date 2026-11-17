import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { audit, baseline, project, allTargets, functionUrl, accessToken, readCloud, sourceUrl, zipInventory,
  expectedInventory, loadSnapshot, loadPrepared, validatePrepared, assertCloudBefore, assertMetadata,
  readOperationalConfiguration } from './prepare-wispi-bonus-restriction-release.mjs';

// Read-only metadata, source, scheduler and IAM verification. Never invokes a
// callable or reads application data. --only supports staged rollout checks.
const args = process.argv.slice(2);
assert.ok(args.every(arg => ['--local-only', '--after'].includes(arg) || arg.startsWith('--only=')), 'Unsupported argument');
const localOnly = args.includes('--local-only'), after = args.includes('--after');
assert.ok(!(localOnly && after));
const selected = args.find(arg => arg.startsWith('--only='))?.slice(7).split(',') || allTargets;
assert.ok(selected.length && selected.every(name => allTargets.includes(name)) && new Set(selected).size === selected.length, 'Unknown/duplicate target');
const saved = await loadSnapshot(), groups = await loadPrepared();
await validatePrepared(groups, saved);
if (!localOnly) {
  const token = await accessToken();
  if (!after) await assertCloudBefore(token, saved, selected);
  else {
    const metadata = [], downloads = new Map();
    for (const name of allTargets) {
      const original = saved.targets.find(target => target.name === name);
      const current = await (await readCloud(functionUrl(name), token)).json();
      assertMetadata(current, name, original.metadata);
      if (selected.includes(name)) {
        const group = groups.find(item => item.targets.some(target => target.name === name));
        const url = sourceUrl(current.buildConfig.source.storageSource);
        if (!downloads.has(url)) downloads.set(url, readCloud(url, token).then(response => response.arrayBuffer()).then(Buffer.from).then(zipInventory));
        const entries = await downloads.get(url);
        assert.deepEqual(entries.map(({ body, ...entry }) => entry), expectedInventory(group.expectedHashes), `${name}: deployed source mismatch`);
      }
      metadata.push(current);
    }
    assert.ok(isDeepStrictEqual(await readOperationalConfiguration(token, metadata), saved.operations), 'Scheduler/task queue/IAM changed');
  }
}
const mode = localOnly ? 'local-only' : after ? 'post-deploy' : 'pre-deploy';
const report = { schemaVersion: 1, mode, baseline, project, targets: selected, sourceMatches: true,
  runtimeAndOperationalConfigurationChecked: !localOnly, productionDataReads: 0, productionWrites: 0,
  verifiedAt: new Date().toISOString(), groups: groups.map(group => ({ directory: group.directory,
    targets: group.targets.map(target => target.name), sourceFiles: Object.keys(group.expectedHashes).length,
    changes: group.changes.map(change => change.file) })) };
const suffix = selected.length === allTargets.length ? 'all' : selected.join('-');
await fs.writeFile(path.join(audit, `verification-${mode}-${suffix}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
