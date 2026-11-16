import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { root, audit, accessToken } from './prepare-weplay-avatar-release.mjs';

// Add only this query's index; never delete or redeploy unrelated rules/indexes.
const definitions = JSON.parse(await fs.readFile(path.join(root, 'firestore.indexes.json'), 'utf8'));
const fields = ['classKey', 'difficulty', 'score', 'achievedAtMs', 'uid'];
const candidates = definitions.indexes.filter(index => index.collectionGroup === 'entries' && index.queryScope === 'COLLECTION'
  && JSON.stringify(index.fields.map(field => field.fieldPath)) === JSON.stringify(fields));
assert.equal(candidates.length, 1);
const desired = candidates[0], token = await accessToken();
const endpoint = 'https://firestore.googleapis.com/v1/projects/history-quiz-yongsin/databases/(default)/collectionGroups/entries/indexes';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
let pageToken, existing;
do {
  const response = await fetch(endpoint + (pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''), { headers });
  assert.ok(response.ok, `Index listing failed: ${response.status}`);
  const page = await response.json();
  existing = (page.indexes || []).find(index => index.queryScope === desired.queryScope
    && JSON.stringify(index.fields.filter(field => field.fieldPath !== '__name__')) === JSON.stringify(desired.fields)) || existing;
  pageToken = page.nextPageToken;
} while (pageToken);
let result = existing ? { name: existing.name, state: existing.state, created: false } : { state: 'MISSING', created: false };
if (!existing && process.argv.includes('--apply')) {
  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ fields: desired.fields, queryScope: desired.queryScope }) });
  assert.ok(response.ok, `Index creation failed: ${response.status}`);
  const operation = await response.json();
  result = { state: 'CREATING', created: true, operation: operation.name };
}
await fs.mkdir(audit, { recursive: true });
await fs.writeFile(path.join(audit, 'ranking-index.json'), JSON.stringify({ checkedAt: new Date().toISOString(), ...result, index: desired }, null, 2));
console.log(JSON.stringify(result));
if (process.argv.includes('--verify')) assert.equal(result.state, 'READY', 'Ranking index is not ready');
