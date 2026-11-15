import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { accessToken, readCloud, sourceUrl, zipInventory } from './prepare-wispi-market-release.mjs';

const manifest = JSON.parse(await fs.readFile('output/written-exam-assets-release/manifest.json'));
const token = accessToken();
const metadata = await (await readCloud(`https://cloudfunctions.googleapis.com/v2/projects/${manifest.project}/locations/${manifest.region}/functions/${manifest.target}`, token)).json();
assert.equal(metadata.state, 'ACTIVE');
assert.equal(metadata.buildConfig.runtime, 'nodejs22');
const config = metadata.serviceConfig;
for (const [key, expected] of Object.entries({ availableMemory: '512Mi', timeoutSeconds: 120, maxInstanceCount: 5, maxInstanceRequestConcurrency: 1 }))
  assert.equal(config[key], expected, key);
assert.equal(config.minInstanceCount || 0, 0);
const bytes = Buffer.from(await (await readCloud(sourceUrl(metadata.buildConfig.source.storageSource), token)).arrayBuffer());
const actual = Object.fromEntries((await zipInventory(bytes)).map(entry => [entry.path, entry.sha256]));
assert.deepEqual(actual, manifest.hashes, 'Deployed transport source must match the reviewed isolated package');
const response = await fetch(`https://${manifest.region}-${manifest.project}.cloudfunctions.net/${manifest.target}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ data: { action: 'read', storagePath: 'unauthorized-probe', chunkIndex: 0 } }),
});
assert.equal(response.status, 401);
assert.equal((await response.json()).error.status, 'UNAUTHENTICATED');
const report = { passed: true, function: manifest.target, state: metadata.state, files: Object.keys(actual).length, anonymousRead: 'denied', productionDataWrites: 0 };
await fs.writeFile('output/written-exam-assets-release/verified.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
