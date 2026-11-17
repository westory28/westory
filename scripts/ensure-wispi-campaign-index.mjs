import fs from 'node:fs/promises';
import { accessToken } from './prepare-weplay-avatar-release.mjs';

// Add only the campaign's required index; preserve all unrelated live indexes.
const base = 'https://firestore.googleapis.com/v1/projects/history-quiz-yongsin/databases/(default)/collectionGroups/wis_stock_history/indexes';
const expected = [
  { fieldPath: 'studentUid', order: 'ASCENDING' },
  { fieldPath: 'kind', order: 'ASCENDING' },
];
const token = await accessToken();
async function call(url, method = 'GET', body) {
  const response = await fetch(url, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Index request failed: ${response.status} ${(await response.json()).error?.message || ''}`);
  return response.json();
}
const indexes = [];
let pageToken;
do {
  const page = await call(`${base}${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''}`);
  indexes.push(...(page.indexes || []));
  pageToken = page.nextPageToken;
} while (pageToken);
const existing = indexes.find(index => index.queryScope === 'COLLECTION_GROUP'
  && JSON.stringify(index.fields.filter(field => field.fieldPath !== '__name__')) === JSON.stringify(expected));
let result = existing ? { state: existing.state, name: existing.name, created: false } : { state: 'MISSING', created: false };
if (!existing && process.argv.includes('--apply')) {
  const operation = await call(base, 'POST', { queryScope: 'COLLECTION_GROUP', fields: expected });
  result = { state: 'CREATING', created: true, operation: operation.name };
}
await fs.mkdir('output/wispi-graduation-event-20261117', { recursive: true });
await fs.writeFile('output/wispi-graduation-event-20261117/campaign-index.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
