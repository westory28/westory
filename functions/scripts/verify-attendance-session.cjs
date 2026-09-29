const assert = require('node:assert/strict');
const { test } = require('node:test');
const { assertAttendanceSession } = require('../attendanceSession');

const generation = 'w1r2-2026-08-09';
const nowDate = new Date('2026-09-29T13:00:00Z');
const revision = 'a'.repeat(64);
const fresh = () => ({
  request: {
    auth: { uid: 'student-1', token: { email: 'student@yongshin-ms.ms.kr', auth_time: 1790685000 } },
    data: { _session: { authorityGeneration: generation, protocolVersion: 2, revision } },
  },
  session: {
    schemaVersion: 2, status: 'active', authTime: 1790685000,
    authorityGeneration: generation, protocolVersion: 2, sessionRevision: revision,
    authorityModeAtOpen: 'OBSERVE_ONLY', generalExpiresAt: { toMillis: () => nowDate.getTime() + 60000 },
  },
  exists: true,
  environment: { GCLOUD_PROJECT: 'history-quiz-yongsin', WESTORY_APP_CHECK_MODE: 'DISABLED' },
});

const invoke = (fixture) => assertAttendanceSession({
  request: fixture.request, nowDate, environment: fixture.environment,
  db: { doc: (path) => {
    assert.equal(path, 'application_sessions/student-1/sessions/1790685000');
    return { path };
  } },
  transaction: { get: async () => ({ exists: fixture.exists, data: () => fixture.session }) },
});

test('valid deployed protocol reads the auth-epoch session in the transaction', async () => {
  assert.equal((await invoke(fresh())).uid, 'student-1');
});

for (const [name, edit, reason] of [
  ['missing authentication', f => { f.request.auth = null; }, 'SESSION_AUTH_REQUIRED'],
  ['outside school', f => { f.request.auth.token.email = 'someone@example.com'; }, 'SESSION_ACCOUNT_NOT_ALLOWED'],
  ['invalid auth epoch', f => { f.request.auth.token.auth_time = 0; }, 'SESSION_AUTH_TIME_INVALID'],
  ['missing session in observation mode', f => { f.exists = false; }, 'SESSION_MISSING'],
  ['closed session in observation mode', f => { f.session.status = 'closed'; }, 'SESSION_EXPIRED'],
  ['session from another auth epoch', f => { f.session.authTime -= 1; }, 'SESSION_EXPIRED'],
  ['old protocol', f => { f.session.protocolVersion = 1; }, 'SESSION_PROTOCOL_OUTDATED'],
  ['old generation', f => { f.session.authorityGeneration = 'old'; }, 'SESSION_PROTOCOL_OUTDATED'],
  ['missing proof in observation mode', f => { f.request.data = {}; }, 'SESSION_PROOF_INVALID'],
  ['rotated proof', f => { f.request.data._session.revision = 'b'.repeat(64); }, 'SESSION_PROOF_INVALID'],
  ['invalid environment', f => { f.environment.GCLOUD_PROJECT = 'unexpected-project'; }, 'SESSION_AUTHORITY_CONFIG_INVALID'],
  ['invalid mode', f => { f.environment.WESTORY_SESSION_IDLE_MODE = 'allow'; }, 'SESSION_AUTHORITY_CONFIG_INVALID'],
  ['required App Check', f => { f.environment.WESTORY_APP_CHECK_MODE = 'ENFORCE'; }, 'APP_CHECK_REQUIRED'],
]) {
  test(`rejects ${name}`, async () => {
    const fixture = fresh(); edit(fixture);
    await assert.rejects(invoke(fixture), error => error.details?.reason === reason);
  });
}

test('observation mode permits idle expiry without relaxing proof or revocation', async () => {
  const fixture = fresh();
  fixture.session.generalExpiresAt = { toMillis: () => nowDate.getTime() - 1 };
  assert.equal((await invoke(fixture)).uid, 'student-1');
});

test('an enforced session remains enforced after runtime mode changes', async () => {
  const fixture = fresh();
  fixture.session.authorityModeAtOpen = 'ENFORCE';
  fixture.session.generalExpiresAt = { toMillis: () => nowDate.getTime() - 1 };
  await assert.rejects(invoke(fixture), error => error.details?.reason === 'SESSION_EXPIRED');
});

test('staging requires App Check and enforces idle expiry', async () => {
  const fixture = fresh();
  fixture.environment = { GCLOUD_PROJECT: 'westory-staging-177587430482' };
  await assert.rejects(invoke(fixture), error => error.details?.reason === 'APP_CHECK_REQUIRED');
  fixture.request.app = { appId: 'fixture-app' };
  assert.equal((await invoke(fixture)).uid, 'student-1');
  fixture.session.generalExpiresAt = { toMillis: () => 0 };
  await assert.rejects(invoke(fixture), error => error.details?.reason === 'SESSION_EXPIRED');
});
