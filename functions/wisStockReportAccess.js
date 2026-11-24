const { HttpsError } = require('firebase-functions/v2/https');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');

function scopeFor(input) {
  if (typeof input?.year !== 'string' || typeof input?.semester !== 'string'
    || !/^20\d{2}$/.test(input.year) || !/^[12]$/.test(input.semester))
    throw new HttpsError('invalid-argument', '학년도를 확인해 주세요.');
  const year = String(input.year), semester = String(input.semester);
  return { year, semester, semesterId: `${year}-${semester}` };
}

function weekRange(weekStart) {
  const day = new Date(`${weekStart}T00:00:00Z`);
  if (typeof weekStart !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(weekStart)
    || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== weekStart || day.getUTCDay() !== 1)
    throw new HttpsError('invalid-argument', '보고서 주차의 월요일을 선택해 주세요.');
  const startMs = day.getTime() - 9 * 3_600_000;
  return { weekStart, startMs, endMs: startMs + 7 * 86_400_000 };
}

function createWisStockReportAccess({ db, assertSession = assertScoreWorkflowSession }) {
  async function actorFor(request, write = false) {
    const session = await assertSession(request, write ? { highRisk: true, recentAuth: true } : {});
    const uid = request.auth?.uid;
    if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid) || (session?.uid && session.uid !== uid))
      throw new HttpsError('unauthenticated', '다시 로그인해 주세요.');
    return uid;
  }

  async function assertAccess(tx, uid, scope) {
    const profile = (await tx.get(db.doc(`users/${uid}`))).data();
    if (profile?.role !== 'teacher' || profile.disabled || profile.isDeleted || profile.deletedAt || profile.weplayDeletionPending)
      throw new HttpsError('permission-denied', '주식 보고서는 교사만 이용할 수 있습니다.');
    const [config, pointer, manifest] = await Promise.all([
      tx.get(db.doc('site_settings/config')), tx.get(db.doc('site_settings/semester_active')),
      tx.get(db.doc(`semester_manifests/${scope.semesterId}`)),
    ]);
    const current = config.data(), active = pointer.data(), term = manifest.data();
    if (String(current?.year) !== scope.year || String(current?.semester) !== scope.semester
      || (current?.activeSemesterId !== undefined && current.activeSemesterId !== scope.semesterId)
      || active?.semesterId !== scope.semesterId || !Number.isSafeInteger(active.revision) || active.revision < 0
      || term?.semesterId !== scope.semesterId || term.revision !== active.revision || term.status !== 'ACTIVE' || term.readOnly === true)
      throw new HttpsError('failed-precondition', '현재 운영 중인 학기에서 다시 열어 주세요.');
    return current;
  }
  return { actorFor, assertAccess, scopeFor, weekRange };
}

module.exports = { createWisStockReportAccess, scopeFor, weekRange };
