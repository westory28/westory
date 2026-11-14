const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const sharp = require('sharp');
const { Timestamp } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const { createDeveloperLogImageHandlers, uploadDeveloperLogImageContent, deleteDeveloperLogImageContent } = require('../developerLogImages');
const { ADMIN_EMAIL, createStudentMaintenanceService, withStudentMaintenanceGuard } = require('../studentMaintenance');
const checks = [];
const proof = { authorityGeneration: 'w1r2-2026-08-09', protocolVersion: 2, revision: 'a'.repeat(64) };
const legacyPath = 'developer_log_images/reservedPost/card-1794661157019.webp';
const requestFor = (uid, data) => ({ auth: { uid, token: { email: uid === 'developer' ? ADMIN_EMAIL : `${uid}@example.invalid`, auth_time: 100 } }, data: { ...data, _session: proof } });
const maintenance = () => ({ enabled: true, blockedRoles: ['student'], bypassUids: [], title: '점검', message: '점검 중입니다.', startedAt: Timestamp.now(), updatedAt: Timestamp.now(), updatedBy: 'developer', revision: 1 });
const fixture = () => {
  const documents = new Map(['teacher', 'staff', 'student'].map(uid => [`users/${uid}`, { role: uid, registrationApprovalStatus: 'APPROVED', teacherPortalEnabled: true, staffPermissions: ['notice_manage'] }]));
  const reads = [], saves = [], deletions = [], sessions = [];
  let counter = 0, expired = false, saveFailure = false, deleteFailure = false, sessionUid;
  const db = { doc: path => ({ get: async () => { reads.push(path); return { exists: documents.has(path), data: () => documents.get(path) }; } }) };
  const bucket = { file: path => ({ save: async (buffer, options) => { if (saveFailure) throw new Error('synthetic storage save failed'); saves.push({ path, buffer, options }); }, delete: async options => { if (deleteFailure) throw new Error('synthetic storage delete failed'); deletions.push({ path, options }); } }) };
  const handlers = createDeveloperLogImageHandlers({ bucket, createId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`, assertSession: async request => {
    sessions.push(request);
    if (!request.auth?.uid || expired || JSON.stringify(request.data?._session) !== JSON.stringify(proof)) throw new HttpsError('unauthenticated', 'Synthetic invalid session');
    return { uid: sessionUid || request.auth.uid };
  } });
  const service = createStudentMaintenanceService({ db });
  return { documents, reads, saves, deletions, sessions, upload: withStudentMaintenanceGuard(handlers.upload, { service }), remove: withStudentMaintenanceGuard(handlers.remove, { service }), expire: () => { expired = true; }, mismatchedIdentity: () => { sessionUid = 'other'; }, failSave: value => { saveFailure = value; }, failDelete: value => { deleteFailure = value; } };
};
let valid;
const rejected = async (label, change = () => {}, setup = () => {}, method = 'upload', code) => {
  const f = fixture(), request = requestFor('developer', method === 'upload' ? valid : { storagePath: legacyPath });
  change(request); setup(f);
  await assert.rejects(f[method](request), code ? error => error.code === code : undefined);
  assert.equal(f.saves.length, 0); assert.equal(f.deletions.length, 0);
  checks.push(label);
};
async function main() {
  const source = sharp({ create: { width: 112, height: 63, channels: 3, background: '#356bd7' } });
  const webp = await source.clone().webp().toBuffer();
  valid = { postId: 'reservedPost', imageBase64: webp.toString('base64'), contentType: 'image/webp' };
  for (const [format, contentType, extension] of [['webp', 'image/webp', 'webp'], ['png', 'image/png', 'png'], ['jpeg', 'image/jpeg', 'jpg']]) {
    const f = fixture(), buffer = await source.clone()[format]().toBuffer();
    f.documents.set('site_settings/student_maintenance', maintenance());
    const request = requestFor('developer', { ...valid, imageBase64: buffer.toString('base64'), contentType });
    request.auth.token.email = ` ${ADMIN_EMAIL.toUpperCase()} `;
    const result = await f.upload(request);
    assert.equal(result.imageWidth, 112); assert.equal(result.imageHeight, 63); assert.equal(result.imageByteSize, buffer.length); assert.equal(result.imageMimeType, contentType);
    assert.match(result.imageStoragePath, new RegExp(`^developer_log_images/reservedPost/card-[a-f0-9-]{36}\\.${extension}$`));
    assert.equal(f.sessions[0], request); assert.equal(f.saves.length, 1); assert.deepEqual(f.saves[0].buffer, buffer);
    assert.deepEqual(f.saves[0].options.preconditionOpts, { ifGenerationMatch: 0 });
    assert.ok(result.imageUrl.includes(encodeURIComponent(result.imageStoragePath)));
    assert.ok(result.imageUrl.endsWith(f.saves[0].options.metadata.metadata.firebaseStorageDownloadTokens));
    assert.deepEqual(f.reads, ['site_settings/student_maintenance']);
    await f.remove(requestFor('developer', { storagePath: result.imageStoragePath }));
    assert.equal(f.deletions.length, 1); assert.deepEqual(f.deletions[0].options, { ignoreNotFound: true });
    checks.push(`${format}: exact developer upload before post exists, one storage write, one maintenance read, zero post reads/writes`);
  }
  for (const method of ['upload', 'remove']) {
    for (const uid of ['teacher', 'staff', 'student', 'external']) await rejected(`${method} denies ${uid}`, request => { request.auth = requestFor(uid, {}).auth; }, () => {}, method, 'permission-denied');
    await rejected(`${method} denies anonymous`, request => { delete request.auth; }, () => {}, method, 'unauthenticated');
    await rejected(`${method} denies missing proof`, request => { delete request.data._session; }, () => {}, method, 'unauthenticated');
    await rejected(`${method} denies expired proof`, () => {}, f => f.expire(), method, 'unauthenticated');
    await rejected(`${method} denies mismatched identity`, () => {}, f => f.mismatchedIdentity(), method, 'unauthenticated');
    await rejected(`${method} denies malformed maintenance`, () => {}, f => f.documents.set('site_settings/student_maintenance', { enabled: false }), method);
    await rejected(`${method} preserves registration check`, request => { request.auth = requestFor('teacher', {}).auth; }, f => f.documents.set('users/teacher', { role: 'teacher', registrationApprovalStatus: 'PENDING' }), method, 'permission-denied');
  }
  for (const [field, value] of [['postId', '../post'], ['postId', 'a'.repeat(81)], ['postId', ''], ['postId', 1], ['imageBase64', 'data:image/webp;base64,AAAA'], ['imageBase64', 'not-base64'], ['imageBase64', ''], ['imageBase64', 'AAAA='], ['contentType', 'image/svg+xml'], ['contentType', 'application/octet-stream'], ['contentType', 'image/png']]) await rejected(`reject malformed ${field} ${String(value).slice(0, 16)}`, r => { r.data[field] = value; }, () => {}, 'upload', 'invalid-argument');
  for (const field of ['storagePath', 'imageUrl', 'downloadToken', 'bucket']) await rejected(`caller cannot choose ${field}`, r => { r.data[field] = 'forged'; });
  await rejected('720KiB strict bound', r => { r.data.imageBase64 = Buffer.alloc(720 * 1024).toString('base64'); });
  await rejected('SVG body blocked before native decoding', r => { r.data.imageBase64 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>').toString('base64'); });
  await rejected('forged WebP magic cannot pass full decoding', r => { r.data.imageBase64 = Buffer.from('RIFFxxxxWEBPnot-an-image').toString('base64'); });
  const png = await source.clone().png().toBuffer();
  await rejected('truncated real PNG blocked', r => { r.data.contentType = 'image/png'; r.data.imageBase64 = png.subarray(0, 45).toString('base64'); });
  const wide = await sharp({ create: { width: 4097, height: 1, channels: 3, background: 'white' } }).png().toBuffer();
  await rejected('4097px blocked', r => { r.data.contentType = 'image/png'; r.data.imageBase64 = wide.toString('base64'); });
  const pixels = Buffer.concat([Buffer.alloc(16 * 16 * 3, 0), Buffer.alloc(16 * 16 * 3, 255)]);
  const frames = await sharp(pixels, { raw: { width: 16, height: 32, channels: 3, pageHeight: 16 } }).webp().toBuffer();
  assert.equal((await sharp(frames, { animated: true }).metadata()).pages, 2);
  await rejected('animated WebP blocked', r => { r.data.imageBase64 = frames.toString('base64'); });
  for (const path of ['', '../card-1.webp', 'notice_images/post/card-1.webp', 'developer_log_images/../card-1.webp', 'developer_log_images/post/arbitrary.webp', legacyPath + '/other', legacyPath + '?token=x', legacyPath.replace('.webp', '.svg'), `gs://other/${legacyPath}`, `https://example.invalid/${legacyPath}`, legacyPath.replace('reservedPost', '%2Fpost')]) await rejected(`out of scope deletion ${path.slice(0, 36)}`, r => { r.data.storagePath = path; }, () => {}, 'remove', 'invalid-argument');
  {
    const f = fixture();
    await f.remove(requestFor('developer', { storagePath: legacyPath }));
    await f.remove(requestFor('developer', { storagePath: legacyPath }));
    assert.equal(f.deletions.length, 2); assert.ok(f.deletions.every(entry => entry.options.ignoreNotFound));
    checks.push('legacy timestamp deletion and retry idempotently ignore missing object');
  }
  {
    const f = fixture(); f.failSave(true);
    await assert.rejects(f.upload(requestFor('developer', valid))); assert.equal(f.saves.length, 0);
    f.failSave(false); await f.upload(requestFor('developer', valid)); assert.equal(f.saves.length, 1);
    f.failDelete(true); await assert.rejects(f.remove(requestFor('developer', { storagePath: legacyPath }))); assert.equal(f.deletions.length, 0);
    f.failDelete(false); await f.remove(requestFor('developer', { storagePath: legacyPath })); assert.equal(f.deletions.length, 1);
    checks.push('storage failures surface; explicit retries succeed without Firestore writes');
  }
  const index = readFileSync(resolve(__dirname, '../index.js'), 'utf8');
  for (const [name, callable] of Object.entries({ uploadDeveloperLogImageContent, deleteDeveloperLogImageContent })) {
    assert.deepEqual(callable.__endpoint.region, ['asia-northeast3']); assert.ok(callable.__endpoint.callableTrigger);
    assert.equal(callable.__endpoint.minInstances, 0); assert.equal(callable.__endpoint.maxInstances, 5); assert.equal(callable.__endpoint.concurrency, 4); assert.equal(callable.__endpoint.timeoutSeconds, 60);
    assert.ok(index.includes(`exports.${name} = require('./developerLogImages').${name}`));
  }
  checks.push('two guarded callable exports, min0/max5/concurrency4/timeout60');
  console.log(JSON.stringify({ passed: true, count: checks.length, network: 0, checks }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
