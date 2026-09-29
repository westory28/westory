const { HttpsError } = require('firebase-functions/v2/https');

// Attendance uses the deployed w1r2 session contract. Keep this adapter scoped
// to the new callable; do not replace the existing session lifecycle functions.
const GENERATION = 'w1r2-2026-08-09';
const MODES = ['ENFORCE', 'OBSERVE_ONLY', 'DISABLED'];
let lastAppCheckObservation = 0;
const fail = (code, reason) => {
  throw new HttpsError(code, '로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.', { reason });
};

const resolveAttendanceSessionConfig = (environment = process.env) => {
  let firebaseProject = '';
  try {
    firebaseProject = JSON.parse(environment.FIREBASE_CONFIG || '{}').projectId || '';
  } catch { /* Invalid environment fails closed below. */ }
  const projectId = String(environment.GCLOUD_PROJECT || environment.GOOGLE_CLOUD_PROJECT || firebaseProject).trim();
  const production = projectId === 'history-quiz-yongsin';
  const staging = projectId === 'westory-staging-177587430482';
  const demo = projectId.startsWith('demo-westory-session-') || projectId === 'demo-westory-session-authority';
  if (!production && !staging && !demo) fail('unavailable', 'SESSION_AUTHORITY_CONFIG_INVALID');
  const idleMode = String(environment.WESTORY_SESSION_IDLE_MODE || (production ? 'OBSERVE_ONLY' : 'ENFORCE')).trim().toUpperCase();
  const appCheckMode = String(environment.WESTORY_APP_CHECK_MODE || (production ? 'OBSERVE_ONLY' : demo ? 'DISABLED' : 'ENFORCE')).trim().toUpperCase();
  const idleModes = production ? ['OBSERVE_ONLY', 'DISABLED'] : ['ENFORCE'];
  const appModes = production ? MODES : demo ? ['DISABLED'] : ['ENFORCE'];
  if (!idleModes.includes(idleMode) || !appModes.includes(appCheckMode)) fail('unavailable', 'SESSION_AUTHORITY_CONFIG_INVALID');
  return { projectId, idleMode, appCheckMode };
};

const assertAttendanceSession = async ({ request, transaction, db, nowDate, environment = process.env }) => {
  const uid = String(request.auth?.uid || '').trim();
  const email = String(request.auth?.token?.email || '').trim().toLowerCase();
  const authTime = Number(request.auth?.token?.auth_time);
  if (!uid) fail('unauthenticated', 'SESSION_AUTH_REQUIRED');
  if (!/@yongshin-ms\.ms\.kr$/i.test(email) && email !== 'westoria28@gmail.com') fail('permission-denied', 'SESSION_ACCOUNT_NOT_ALLOWED');
  if (!Number.isInteger(authTime) || authTime <= 0) fail('unauthenticated', 'SESSION_AUTH_TIME_INVALID');
  const config = resolveAttendanceSessionConfig(environment);
  const nowMs = nowDate.getTime();
  if (!Number.isFinite(nowMs)) fail('unavailable', 'SESSION_CLOCK_INVALID');
  if (config.appCheckMode === 'ENFORCE' && !request.app?.appId) fail('unauthenticated', 'APP_CHECK_REQUIRED');
  if (config.appCheckMode === 'OBSERVE_ONLY' && !request.app?.appId && nowMs - lastAppCheckObservation >= 300000) {
    lastAppCheckObservation = nowMs;
    console.warn('Westory attendance App Check observation.', { reason: 'APP_CHECK_MISSING' });
  }

  // Read inside the reward transaction, so logout/revocation races invalidate
  // the same transaction that would otherwise write attendance and the ledger.
  const snapshot = await transaction.get(db.doc(`application_sessions/${uid}/sessions/${authTime}`));
  if (!snapshot.exists) fail('unauthenticated', 'SESSION_MISSING');
  const session = snapshot.data() || {};
  if (session.status !== 'active' || Number(session.authTime) !== authTime) fail('unauthenticated', 'SESSION_EXPIRED');
  if (Number(session.schemaVersion) !== 2 || session.authorityGeneration !== GENERATION ||
      !Number.isInteger(session.protocolVersion) || session.protocolVersion < 2 ||
      typeof session.sessionRevision !== 'string' || !/^[a-f0-9]{64}$/.test(session.sessionRevision) ||
      !MODES.includes(session.authorityModeAtOpen)) fail('unauthenticated', 'SESSION_PROTOCOL_OUTDATED');
  const proof = request.data?._session;
  const protocolVersion = Number(proof?.protocolVersion || 0);
  const revision = String(proof?.revision || '').trim();
  if (String(proof?.authorityGeneration || '').trim() !== GENERATION ||
      !Number.isInteger(protocolVersion) || protocolVersion < 2 ||
      !/^[a-f0-9]{64}$/.test(revision) || revision !== session.sessionRevision) fail('unauthenticated', 'SESSION_PROOF_INVALID');
  const effectiveMode = config.idleMode === 'ENFORCE' || session.authorityModeAtOpen === 'ENFORCE'
    ? 'ENFORCE'
    : config.idleMode === 'OBSERVE_ONLY' || session.authorityModeAtOpen === 'OBSERVE_ONLY' ? 'OBSERVE_ONLY' : 'DISABLED';
  const expiry = typeof session.generalExpiresAt?.toMillis === 'function' ? session.generalExpiresAt.toMillis() : 0;
  if (expiry <= nowMs && effectiveMode === 'ENFORCE') fail('unauthenticated', 'SESSION_EXPIRED');
  if (expiry <= nowMs && effectiveMode === 'OBSERVE_ONLY') {
    console.warn('Westory attendance session observation.', { reason: 'SESSION_IDLE_EXPIRED' });
  }
  return { uid, email, authTime };
};

module.exports = { assertAttendanceSession, resolveAttendanceSessionConfig };
