import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { accessToken } from './wispi-bonus-claim-release-cloud.mjs';

// Explicitly scoped release operations: add the one reviewed index, run the
// existing derived-ranking scheduler, or inspect non-personal readiness fields.
// Never writes student accounts, transactions, settings, or publication flags.
const mode = process.argv[2];
assert.ok(['inspect', 'index', 'refresh'].includes(mode));
const project = 'history-quiz-yongsin';
const database = `projects/${project}/databases/(default)`;
const indexUrl = `https://firestore.googleapis.com/v1/${database}/collectionGroups/entries/indexes`;
const scheduler = `projects/${project}/locations/us-central1/jobs/firebase-schedule-publishWisStockDailyRanking-us-central1`;
const token = await accessToken();
function request(url, method = 'GET', body) {
  assert.ok(url.startsWith(`https://firestore.googleapis.com/v1/${database}/`) || url === `https://cloudscheduler.googleapis.com/v1/${scheduler}:run`);
  const result = spawnSync('curl.exe', ['--silent', '--show-error', '--tls-max', '1.2', '--connect-timeout', '10', '--max-time', '45', '--config', '-', '--write-out', '\n%{http_code}'], {
    input: `url = ${JSON.stringify(url)}\nheader = ${JSON.stringify(`Authorization: Bearer ${token}`)}\nrequest = ${JSON.stringify(method)}\n`
      + (body ? `header = "Content-Type: application/json"\ndata = ${JSON.stringify(JSON.stringify(body))}\n` : ''),
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0, 'Release request transport failed');
  const split = result.stdout.lastIndexOf(10);
  const status = Number(result.stdout.subarray(split + 1).toString());
  assert.ok(status >= 200 && status < 300, `Release request returned HTTP ${status}`);
  return JSON.parse(result.stdout.subarray(0, split).toString());
}
const fields = [{ fieldPath: 'classKey', order: 'ASCENDING' }, { fieldPath: 'globalRank', order: 'ASCENDING' }];
const declared = JSON.parse(await fs.readFile(new URL('../firestore.indexes.json', import.meta.url), 'utf8'));
assert.ok(declared.indexes.some(i => i.collectionGroup === 'entries' && i.queryScope === 'COLLECTION' && JSON.stringify(i.fields) === JSON.stringify(fields)));
let indexes = [], pageToken;
do {
  const page = request(indexUrl + (pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''));
  indexes.push(...(page.indexes || []));
  pageToken = page.nextPageToken;
} while (pageToken);
const match = indexes.find(i => i.queryScope === 'COLLECTION' && JSON.stringify(i.fields.filter(f => f.fieldPath !== '__name__')) === JSON.stringify(fields));
if (mode === 'index' && !match) {
  const operation = request(indexUrl, 'POST', { queryScope: 'COLLECTION', fields });
  console.log(JSON.stringify({ indexCreated: true, operation: operation.name }));
} else if (mode === 'refresh') {
  assert.equal(match?.state, 'READY', 'Ranking index must be READY before refreshing');
  const job = request(`https://cloudscheduler.googleapis.com/v1/${scheduler}:run`, 'POST', {});
  console.log(JSON.stringify({ scheduler: job.name, lastAttemptTime: job.lastAttemptTime, refreshRequested: true }));
} else {
  const config = request(`https://firestore.googleapis.com/v1/${database}/documents/site_settings/config?mask.fieldPaths=year&mask.fieldPaths=semester`).fields;
  const value = field => field?.stringValue ?? field?.integerValue;
  const year = value(config.year), semester = value(config.semester);
  assert.match(String(year), /^20\d{2}$/); assert.match(String(semester), /^[12]$/);
  const ranking = request(`https://firestore.googleapis.com/v1/${database}/documents/years/${year}/semesters/${semester}/wis_stock_student_rankings/current?mask.fieldPaths=schemaVersion&mask.fieldPaths=dayKey&mask.fieldPaths=total`);
  console.log(JSON.stringify({ index: match?.state || 'MISSING', semester: `${year}-${semester}`, schemaVersion: Number(value(ranking.fields.schemaVersion)), dayKey: value(ranking.fields.dayKey), total: value(ranking.fields.total) === undefined ? null : Number(value(ranking.fields.total)) }));
}
