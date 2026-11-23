import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

// No write endpoint is implemented. Authorization exists only in curl stdin.
export function curlReadConfig(url, token, body) {
  assert(/^https:\/\/firestore\.googleapis\.com\/v1\/projects\/[a-z0-9-]+\/databases\/\(default\)\/documents(?:\/[A-Za-z0-9_%.-]+)*:(?:runQuery|batchGet)$/.test(url), 'Unapproved Firestore read endpoint');
  assert(typeof token === 'string' && token && !/[\r\n"]/.test(token), 'Invalid in-memory credential');
  return `url = ${JSON.stringify(url)}\nheader = ${JSON.stringify('Authorization: Bearer ' + token)}\n`
    + 'request = "POST"\nheader = "Content-Type: application/json"\n'
    + `data = ${JSON.stringify(JSON.stringify(body))}\n`;
}

export async function curlFirestoreRead(url, body, tokenProvider) {
  const input = curlReadConfig(url, await tokenProvider(), body);
  return new Promise((resolve, reject) => {
    const child = spawn('curl.exe', ['--silent', '--show-error', '--fail', '--tls-max', '1.2',
      '--connect-timeout', '10', '--max-time', '30', '--retry', '1', '--retry-delay', '1',
      '--retry-max-time', '60', '--config', '-', '--write-out', '\n%{http_code}'], { windowsHide: true });
    const chunks = []; let size = 0;
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 64 * 1024 * 1024) child.kill();
      else chunks.push(chunk);
    });
    // Raw response/error text can contain private document data; never emit it.
    child.stderr.resume();
    child.on('error', () => reject(new Error('Certificate-verified Firestore read could not start')));
    child.stdin.on('error', () => {});
    child.on('close', code => {
      if (code !== 0 || size > 64 * 1024 * 1024) return reject(new Error('Certificate-verified Firestore read failed'));
      const output = Buffer.concat(chunks), split = output.lastIndexOf(10);
      const status = Number(output.subarray(split + 1).toString('utf8'));
      if (split < 0 || status !== 200) return reject(new Error(`Read-only Firestore request failed: HTTP ${status}`));
      try { resolve(JSON.parse(output.subarray(0, split).toString('utf8'))); }
      catch { reject(new Error('Read-only Firestore response was invalid JSON')); }
    });
    child.stdin.end(input);
  });
}

const field = fieldPath => {
  assert(typeof fieldPath === 'string' && /^(?:__name__|[A-Za-z_][A-Za-z0-9_.]*)$/.test(fieldPath), 'Unsupported field path');
  return { fieldPath };
};
const encode = value => {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Number.isSafeInteger(value)) return { integerValue: String(value) };
  throw new Error('Unsupported query value');
};
const decode = value => {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) {
    const result = Number(value.integerValue);
    assert(Number.isSafeInteger(result), 'Unsafe Firestore integer');
    return result;
  }
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) {
    const millis = Date.parse(value.timestampValue);
    assert(Number.isFinite(millis), 'Invalid Firestore timestamp');
    return { seconds: Math.floor(millis / 1000), nanoseconds: (millis % 1000) * 1000000 };
  }
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decode(item)]));
  if ('referenceValue' in value) return value.referenceValue;
  throw new Error('Unsupported Firestore value');
};

export function createReadOnlyRestDb({ projectId, tokenProvider, request = (url, body) => curlFirestoreRead(url, body, tokenProvider) }) {
  assert(/^[a-z][a-z0-9-]+$/.test(projectId), 'Invalid Firestore project');
  const documentRoot = `projects/${projectId}/databases/(default)/documents`;
  const endpoint = `https://firestore.googleapis.com/v1/${documentRoot}`;
  const pathParts = (value, parity) => {
    assert(typeof value === 'string' && value && value.split('/').every(part => part && part !== '.' && part !== '..'), 'Invalid Firestore path');
    const parts = value.split('/'); assert.equal(parts.length % 2, parity, 'Unexpected Firestore path kind'); return parts;
  };
  const doc = value => { pathParts(value, 0); return { path: value }; };
  const snapshot = (name, document) => {
    assert(typeof name === 'string' && name.startsWith(documentRoot + '/'), 'Unexpected Firestore response scope');
    const ref = doc(name.slice(documentRoot.length + 1));
    const data = document && Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decode(value)]));
    return { id: ref.path.split('/').at(-1), ref, exists: Boolean(document), data: () => data };
  };
  class Query {
    constructor(value, options = {}) { this.path = value; this.options = options; pathParts(value, 1); }
    next(delta) { return new Query(this.path, { ...this.options, ...delta }); }
    where(key, operator, value) {
      assert.equal(operator, '==', 'Only equality filters are supported');
      return this.next({ filters: [...(this.options.filters || []), { fieldFilter: { field: field(key), op: 'EQUAL', value: encode(value) } }] });
    }
    select(...fields) { return this.next({ select: { fields: fields.map(field) } }); }
    orderBy(key) { assert.equal(key, '__name__', 'Only document-name ordering is supported'); return this.next({ orderBy: [{ field: field(key), direction: 'ASCENDING' }] }); }
    limit(value) { assert(Number.isSafeInteger(value) && value > 0, 'Invalid query limit'); return this.next({ limit: value }); }
    startAfter(cursor) {
      assert(this.options.orderBy && cursor?.ref?.path?.startsWith(this.path + '/'), 'Invalid document cursor');
      assert.equal(cursor.ref.path.split('/').length, this.path.split('/').length + 1, 'Cursor collection changed');
      return this.next({ startAt: { values: [{ referenceValue: documentRoot + '/' + cursor.ref.path }], before: false } });
    }
    async get() {
      const parts = this.path.split('/'), collectionId = parts.pop(), parent = parts.map(encodeURIComponent).join('/');
      const { filters, ...options } = this.options;
      const structuredQuery = { from: [{ collectionId }], ...options };
      if (filters?.length) structuredQuery.where = filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } };
      const result = await request(endpoint + (parent ? '/' + parent : '') + ':runQuery', { structuredQuery });
      assert(Array.isArray(result) && !result.some(row => row.error), 'Invalid Firestore query response');
      const docs = result.filter(row => row.document).map(row => {
        const snap = snapshot(row.document.name, row.document);
        assert(snap.ref.path.startsWith(this.path + '/') && snap.ref.path.split('/').length === this.path.split('/').length + 1, 'Unexpected query document');
        return snap;
      });
      return { docs, empty: docs.length === 0, size: docs.length };
    }
  }
  return { doc, collection: value => new Query(value), getAll: async (...refs) => {
    const fieldMask = refs.at(-1)?.fieldMask;
    if (fieldMask) refs.pop();
    if (!refs.length) return [];
    const documents = refs.map(ref => documentRoot + '/' + doc(ref.path).path);
    const body = { documents, ...(fieldMask ? { mask: { fieldPaths: fieldMask.map(value => field(value).fieldPath) } } : {}) };
    const result = await request(endpoint + ':batchGet', body);
    assert(Array.isArray(result), 'Invalid Firestore batch response');
    const found = new Map();
    for (const row of result) {
      const name = row.found?.name || row.missing;
      assert(documents.includes(name) && !found.has(name), 'Unexpected or duplicate batch document');
      found.set(name, snapshot(name, row.found));
    }
    assert.equal(found.size, new Set(documents).size, 'Incomplete Firestore batch response');
    return documents.map(name => found.get(name));
  } };
}
