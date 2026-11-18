import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Read-only, certificate-verified transport. Credentials stay in memory and
// curl stdin, never command arguments, output, evidence files or URLs.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function accessToken() {
  const require = createRequire(import.meta.url);
  const auth = require(path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/auth.js'));
  const account = auth.getProjectDefaultAccount(root);
  assert.ok(account?.tokens?.refresh_token, 'Firebase CLI account is unavailable');
  let tokens = account.tokens;
  if (!tokens.access_token || Number(tokens.expires_at) - Date.now() <= 60000) {
    try { tokens = await auth.getAccessToken(tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']); }
    catch { throw new Error('Firebase CLI credential refresh failed; no credentials were recorded'); }
  }
  assert.ok(tokens.access_token && !/[\r\n"]/.test(tokens.access_token), 'Invalid Firebase CLI access token');
  return tokens.access_token;
}
export async function cloud(url, token, { allowMissing = false, method = 'GET' } = {}) {
  assert.ok(/^https:\/\/(?:cloudfunctions|storage|cloudscheduler|cloudtasks|run)\.googleapis\.com\//.test(url), 'Unapproved cloud endpoint');
  assert.ok(!/[\r\n"]/.test(url) && !/[\r\n"]/.test(token));
  assert.ok(method === 'GET' || (method === 'POST' && url.endsWith(':getIamPolicy')), 'Only read-only cloud requests are allowed');
  const result = spawnSync('curl.exe', ['--silent', '--show-error', '--tls-max', '1.2', '--retry', '2',
    '--retry-all-errors', '--retry-delay', '1', '--retry-max-time', '45', '--connect-timeout', '10', '--max-time', '20',
    '--config', '-', '--write-out', '\n%{http_code}'], {
    input: `url = "${url}"\nheader = "Authorization: Bearer ${token}"\n`
      + (method === 'POST' ? 'request = "POST"\nheader = "Content-Type: application/json"\ndata = "{}"\n' : ''),
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0, 'Certificate-verified cloud read failed');
  const separator = result.stdout.lastIndexOf(10), status = Number(result.stdout.subarray(separator + 1).toString('utf8'));
  assert.ok(status === 200 || (allowMissing && status === 404), `Read-only cloud request failed: HTTP ${status}`);
  const body = result.stdout.subarray(0, separator);
  return { status, body, json: () => JSON.parse(body.toString('utf8')) };
}

const fields = (value, names) => Object.fromEntries(names.map(name => [name, value[name] ?? null]));
const policy = value => ({ version: value.version || 1, bindings: [...(value.bindings || [])]
  .map(binding => ({ ...binding, members: [...binding.members].sort() }))
  .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });
export async function readCallablePolicy(token, metadata) {
  assert.ok(metadata.serviceConfig?.service, 'Callable Cloud Run service is missing');
  return policy((await cloud(`https://run.googleapis.com/v2/${metadata.serviceConfig.service}:getIamPolicy`, token)).json());
}
export async function readOperations(token, project, region) {
  const schedulers = [];
  for (const name of ['advanceWisStockPrices', 'recoverWisStockOrders']) {
    const job = (await cloud(`https://cloudscheduler.googleapis.com/v1/projects/${project}/locations/${region}/jobs/firebase-schedule-${name}-${region}`, token)).json();
    assert.equal(job.timeZone, 'Asia/Seoul'); assert.equal(job.state, 'ENABLED');
    assert.equal(job.schedule, name === 'advanceWisStockPrices' ? '0 * * * *' : 'every 5 minutes');
    schedulers.push({ name, configuration: fields(job, ['name', 'schedule', 'timeZone', 'state', 'attemptDeadline', 'retryConfig', 'httpTarget', 'pubsubTarget']) });
  }
  const base = `projects/${project}/locations/${region}`;
  const task = (await cloud(`https://cloudfunctions.googleapis.com/v2/${base}/functions/settleWisStockOrderTask`, token)).json();
  assert.ok(task.serviceConfig?.service, 'Settlement Cloud Run service is missing');
  const queueUrl = `https://cloudtasks.googleapis.com/v2/${base}/queues/settleWisStockOrderTask`;
  const queue = (await cloud(queueUrl, token)).json();
  const queuePolicy = (await cloud(queueUrl + ':getIamPolicy', token, { method: 'POST' })).json();
  const runPolicy = (await cloud(`https://run.googleapis.com/v2/${task.serviceConfig.service}:getIamPolicy`, token)).json();
  return { schedulers,
    queue: fields(queue, ['name', 'state', 'rateLimits', 'retryConfig', 'stackdriverLoggingConfig', 'httpTarget', 'appEngineHttpQueue']),
    queuePolicy: policy(queuePolicy), runPolicy: policy(runPolicy),
    settlementSource: task.buildConfig.source.storageSource, settlementUpdateTime: task.updateTime };
}
