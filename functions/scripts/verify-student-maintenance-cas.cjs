// Deterministic transactional store only; no Firebase SDK I/O or real users.
const assert = require('node:assert/strict');
const { Timestamp } = require('firebase-admin/firestore');
const maintenance = require('../studentMaintenance');
const initial = {
  enabled: true, blockedRoles: ['student'], bypassUids: ['qa-bypass'],
  title: '점검', message: '학생 접속 점검 중', revision: 6,
  startedAt: Timestamp.now(), updatedAt: Timestamp.now(), updatedBy: 'qa-admin',
};
const request = (revision, enabled = false) => ({
  auth: { uid: 'qa-admin', token: { email: maintenance.ADMIN_EMAIL } },
  data: { enabled, blockedRoles: ['student'], bypassUids: ['qa-bypass'], title: '점검', message: '학생 접속 점검 중', expectedRevision: revision, ...(enabled ? {} : { expectedSemesterId: '2026-2' }) },
});
function fixture(seed = initial) {
  const values = new Map(seed ? [[maintenance.CONFIG_DOCUMENT_PATH, { ...seed }]] : []);
  values.set('site_settings/config', { year: '2026', semester: '2' });
  values.set('site_settings/semester_active', { semesterId: '2026-2' });
  let auditId = 0, queue = Promise.resolve();
  const reference = path => ({ path, collection: child => ({ doc: () => reference(`${path}/${child}/qa-${++auditId}`) }) });
  const db = {
    doc: reference,
    runTransaction: run => {
      // Serialized commits exercise the same revision race resolution as a
      // Firestore transaction retry: each contender reads the committed state.
      const flight = queue.then(async () => {
        const writes = [];
        const result = await run({
          get: async ref => ({ exists: values.has(ref.path), data: () => values.get(ref.path) }),
          set: (ref, data) => writes.push([ref.path, data]),
        });
        for (const [path, value] of writes) values.set(path, value);
        return result;
      });
      queue = flight.catch(() => {});
      return flight;
    },
  };
  return { values, service: maintenance.createStudentMaintenanceService({ db, serverTimestamp: () => Timestamp.now() }) };
}
(async () => {
  for (const value of [undefined, null, -1, 1.5, '6', Number.MAX_SAFE_INTEGER]) {
    const input = request(6).data;
    if (value === undefined) delete input.expectedRevision; else input.expectedRevision = value;
    assert.throws(() => maintenance.normalizeUpdatePayload(input));
  }
  const f = fixture();
  await f.service.updateConfig(request(6));
  assert.equal(f.values.get(maintenance.CONFIG_DOCUMENT_PATH).revision, 7);
  assert.equal(f.values.size, 4);
  assert.deepEqual(f.values.get(maintenance.CONFIG_DOCUMENT_PATH).bypassUids, ['qa-bypass']);
  await assert.rejects(f.service.updateConfig(request(6, true)), error => error.code === 'aborted' && error.details.reason === 'MAINTENANCE_REVISION_CONFLICT');
  assert.equal(f.values.get(maintenance.CONFIG_DOCUMENT_PATH).enabled, false);
  assert.equal(f.values.size, 4, 'A rejected stale request writes no audit or config');
  const competing = await Promise.allSettled([f.service.updateConfig(request(7, true)), f.service.updateConfig({ ...request(7), data: { ...request(7).data, bypassUids: ['other-qa'] } })]);
  assert.equal(competing.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(competing.filter(row => row.status === 'rejected' && row.reason.details.reason === 'MAINTENANCE_REVISION_CONFLICT').length, 1);
  assert.equal(f.values.get(maintenance.CONFIG_DOCUMENT_PATH).revision, 8);
  assert.deepEqual(f.values.get(maintenance.CONFIG_DOCUMENT_PATH).bypassUids, ['qa-bypass']);
  assert.equal(f.values.size, 5);
  const empty = fixture(null);
  await empty.service.updateConfig(request(0));
  assert.equal(empty.values.get(maintenance.CONFIG_DOCUMENT_PATH).revision, 1);
  const corrupted = fixture({ ...initial, revision: '6' });
  await assert.rejects(corrupted.service.updateConfig(request(0)), error => error.code === 'aborted');
  for (const source of ['site_settings/config', 'site_settings/semester_active']) {
    const shifted = fixture();
    shifted.values.set(source, source.endsWith('/config') ? { year: '2027', semester: '1' } : { semesterId: '2027-1' });
    await assert.rejects(shifted.service.updateConfig(request(6)), error => error.code === 'aborted' && error.details.reason === 'MAINTENANCE_SEMESTER_CONFLICT');
    assert.equal(shifted.values.size, 3, 'Mismatched semester makes no configuration or audit write');
    await shifted.service.updateConfig(request(6, true));
    assert.equal(shifted.values.get(maintenance.CONFIG_DOCUMENT_PATH).revision, 7, 'Closing stays available even during semester mismatch');
  }
  for (const semester of [undefined, '', '2026-3', '../2026-2']) {
    const data = request(6).data;
    if (semester === undefined) delete data.expectedSemesterId; else data.expectedSemesterId = semester;
    assert.throws(() => maintenance.normalizeUpdatePayload(data));
  }
  let sessionCalls = 0;
  const protectedHandler = maintenance.createUpdateStudentMaintenanceConfigHandler({ service: f.service, assertActiveApplicationSession: async (_request, options) => {
    assert.deepEqual(options, { recentAuth: true, highRisk: true }); sessionCalls++;
  } });
  await protectedHandler({ ...request(8), data: { ...request(8).data, _session: { revision: 'qa-proof' } } });
  assert.equal(sessionCalls, 1);
  await assert.rejects(protectedHandler({ ...request(9), auth: { uid: 'student', token: { email: 'student@yongshin-ms.ms.kr' } } }), error => error.code === 'permission-denied');
  assert.equal(sessionCalls, 1, 'Non-admin never reaches privileged session validation');
  const rejectedSession = maintenance.createUpdateStudentMaintenanceConfigHandler({ service: f.service, assertActiveApplicationSession: async () => { throw Error('expired'); } });
  await assert.rejects(rejectedSession(request(9)), /expired/);
  assert.equal(f.values.get(maintenance.CONFIG_DOCUMENT_PATH).revision, 9);
  console.log('PASS student maintenance CAS: exact revision payload, stale/lost-ack rejection, concurrent writers, audit atomicity, initialization and admin/high-risk fences.');
})().catch(error => { console.error(error); process.exitCode = 1; });
