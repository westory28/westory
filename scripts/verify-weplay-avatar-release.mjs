import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { audit, accessToken } from './prepare-weplay-avatar-release.mjs';
import { readCloud, sourceUrl, zipInventory, sha, resourceFields, resourceValue } from './prepare-wispi-market-release.mjs';

const after = process.argv.includes('--after');
const plans = JSON.parse(await fs.readFile(path.join(audit, 'prepared.json'), 'utf8'));
const token = await accessToken(), results = [];
for (const plan of plans) for (const target of plan.targets) {
  const name = `projects/history-quiz-yongsin/locations/${target.region}/functions/${target.name}`;
  const response = await fetch(`https://cloudfunctions.googleapis.com/v2/${name}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!after && plan.newFunctions) {
    assert.equal(response.status, 404, `New function already exists: ${target.name}`);
    results.push({ name: target.name, region: target.region, newFunction: true, absentBefore: true });
    continue;
  }
  assert.ok(response.ok, `Metadata failed: ${target.name}/${response.status}`);
  const current = await response.json();
  assert.equal(current.state, 'ACTIVE', target.name);
  assert.equal(current.buildConfig.runtime, target.runtime, target.name);
  if (plan.newFunctions) {
    const config = current.serviceConfig;
    assert.equal(config.availableMemory, '256Mi');
    assert.equal(config.minInstanceCount || 0, 0);
    assert.equal(config.maxInstanceCount, 10);
    assert.equal(config.timeoutSeconds, 60);
  } else {
    for (const field of resourceFields) assert.equal(resourceValue(current.serviceConfig, field), resourceValue(target.serviceConfig, field), `${target.name}/${field}`);
    if (!after) assert.equal(String(current.buildConfig.source.storageSource.generation), String(target.sourceGeneration), `Source changed: ${target.name}`);
  }
  let files = 0;
  if (after) {
    const bytes = Buffer.from(await (await readCloud(sourceUrl(current.buildConfig.source.storageSource), token)).arrayBuffer());
    const entries = await zipInventory(bytes);
    assert.equal(entries.length, Object.keys(plan.expectedHashes).length, `${target.name}/source file count`);
    for (const entry of entries) assert.equal(sha(entry.body), plan.expectedHashes[entry.path], `${target.name}/${entry.path}`);
    files = entries.length;
    // Anonymous calls must remain blocked, including newly added game commands.
    const denied = await fetch(`https://${target.region}-history-quiz-yongsin.cloudfunctions.net/${target.name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: {} }),
    });
    assert.ok([400, 401, 403].includes(denied.status), `Anonymous callable accepted: ${target.name}`);
  }
  results.push({ name: target.name, region: target.region, state: current.state, runtimePreserved: true, sourceVerified: after, files });
}
await fs.writeFile(path.join(audit, after ? 'verification-after.json' : 'verification-before.json'), JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
console.log(JSON.stringify(results, null, 2));
