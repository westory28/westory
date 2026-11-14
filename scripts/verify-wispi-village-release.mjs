// Read-only check of the newly introduced emergency halt endpoint; existing endpoints
// are checked by verify-wis-release-runtime.mjs against captured metadata.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audit = path.join(root, 'output/wispi-village-20261114/release');
const groups = JSON.parse(await fs.readFile(path.join(audit, 'prepared.json'), 'utf8'));
assert.equal(groups.length, 1, 'Review separate source groups before verifying the new endpoint');
const token = String(execFileSync('cmd.exe', ['/d', '/s', '/c', 'gcloud.cmd auth print-access-token'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).trim();
const read = async url => {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  assert.ok(response.ok, `Read-only release verification failed: ${response.status}`);
  return response;
};
const name = 'projects/history-quiz-yongsin/locations/us-central1/functions/setWisStockMarketHalted';
const metadata = await (await read(`https://cloudfunctions.googleapis.com/v2/${name}`)).json();
assert.equal(metadata.state, 'ACTIVE');
assert.equal(metadata.buildConfig.runtime, 'nodejs22');
const resource = metadata.serviceConfig;
assert.equal(resource.availableMemory, '256Mi');
assert.equal(String(resource.availableCpu), '1');
assert.equal(resource.minInstanceCount || 0, 0);
assert.equal(resource.maxInstanceCount, 10);
assert.equal(resource.maxInstanceRequestConcurrency, 80);
assert.equal(resource.timeoutSeconds, 60);
const { bucket, object, generation } = metadata.buildConfig.source.storageSource;
const response = await read(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media&generation=${generation}`);
const zip = await JSZip.loadAsync(await response.arrayBuffer());
for (const [file, expected] of Object.entries(groups[0].expectedHashes)) {
  const entry = zip.file(file);
  assert.ok(entry, `Missing reviewed file: ${file}`);
  assert.equal(createHash('sha256').update(await entry.async('nodebuffer')).digest('hex'), expected, file);
}
const index = await zip.file('index.js').async('string');
assert.deepEqual([...index.matchAll(/exports\.(\w+)\s*=/g)].map(match => match[1]).sort(),
  ['advanceWisStockPrices', 'getWisStockManagement', 'saveWisStock', 'saveWisStockMarketRules', 'setWisStockMarketHalted']);
const report = { name, state: metadata.state, sourceMatches: true, resourcesMatch: true,
  studentTradingExports: 0, minInstances: resource.minInstanceCount || 0, maxInstances: resource.maxInstanceCount };
await fs.writeFile(path.join(audit, 'new-endpoint-after.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
