const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const catalog = require('./shared/historyAchievementStandards.json');
const rubrics = require('./shared/historyAchievementRubrics.json');
const { buildEnrollmentSlotId } = require('./productionGateway/archiveEnrollment');
const { historicalQuestionEvidence } = require('./quizAchievementEvidence');

const COMMAND_TYPE = 'saveAchievementProfile';
const COLLECTION = 'semester_achievement_profiles';
const codes = new Set(catalog.standards.map(item => item.code));
const safeId = value => typeof value === 'string' && value.length > 0 && value.length <= 180
  && value === value.trim() && !/[\x00-\x1f/]/.test(value) && !['.', '..'].includes(value);
const fail = (code, message, reason) => { throw new HttpsError(code, message, { reason }); };
const iso = value => typeof value === 'string' && value && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString() : '';
const profileId = value => createHash('sha256').update([value.semesterId, value.classId, value.unitId,
  value.examRound, value.studentUid, value.standardCode].join('\n')).digest('hex');

function normalizeProfilePayload(value) {
  const allowed = ['semesterId', 'classId', 'unitId', 'examRound', 'studentUid', 'standardCode', 'level',
    'expectedRevision', 'examAttemptId', 'evidenceRefs', 'mappingConfirmed', 'expectedRubricVersion'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key))
    || !/^\d{4}-[12]$/.test(value.semesterId || '')
    || !['classId', 'unitId', 'studentUid'].every(key => safeId(value[key]))
    || !/^round_[1-9]\d*$/.test(value.examRound || '') || !codes.has(value.standardCode)
    || ![null, 'A', 'B', 'C', 'D', 'E'].includes(value.level)
    || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0
    || (value.level !== null && (!safeId(value.examAttemptId) || value.mappingConfirmed !== true
      || !Array.isArray(value.evidenceRefs) || !value.evidenceRefs.length || value.evidenceRefs.length > 60
      || value.evidenceRefs.some(ref => !ref || Object.keys(ref).some(key => !['resultId', 'questionId'].includes(key))
        || !safeId(ref.resultId) || !safeId(ref.questionId))))) {
    fail('invalid-argument', '분석 성취수준과 검토한 학습 근거를 확인해 주세요.', 'ACHIEVEMENT_PROFILE_INVALID');
  }
  if (value.level !== null && value.expectedRubricVersion !== rubrics.version)
    fail('failed-precondition', '성취수준 준거가 갱신되었습니다. 다시 조회한 뒤 확인해 주세요.', 'ACHIEVEMENT_PROFILE_RUBRIC_CHANGED');
  return { semesterId: value.semesterId, classId: value.classId, unitId: value.unitId,
    examRound: value.examRound, studentUid: value.studentUid, standardCode: value.standardCode,
    level: value.level, expectedRevision: value.expectedRevision,
    examAttemptId: value.level === null ? '' : value.examAttemptId,
    evidenceRefs: value.level === null ? [] : [...new Map(value.evidenceRefs
      .map(ref => [`${ref.resultId}:${ref.questionId}`, { resultId: ref.resultId, questionId: ref.questionId }])).values()],
    mappingConfirmed: value.level !== null, expectedRubricVersion: value.level === null ? '' : rubrics.version };
}

async function applyProfile({ transaction, payload, actor, timestamp }) {
  // Never inherit the broad historical assessment staff capability for a
  // teacher's interpretation. Read-only staff cannot confirm a student level.
  if (!actor?.actorUid || !['teacher', 'admin'].includes(actor.actorRole))
    fail('permission-denied', '교사가 분석 성취수준을 확인해야 합니다.', 'ACHIEVEMENT_PROFILE_TEACHER_REQUIRED');
  if (payload.level !== null && payload.expectedRubricVersion !== rubrics.version)
    fail('failed-precondition', '성취수준 준거가 갱신되었습니다. 다시 조회한 뒤 확인해 주세요.', 'ACHIEVEMENT_PROFILE_RUBRIC_CHANGED');
  const id = profileId(payload), path = `${COLLECTION}/${id}`;
  const [pointer, manifest, classDoc, slot, current] = await transaction.getAll([
    'site_settings/semester_active', `semester_manifests/${payload.semesterId}`,
    `semester_classes/${payload.classId}`,
    `semester_enrollment_slots/${buildEnrollmentSlotId(payload.semesterId, payload.studentUid)}`, path]);
  if (pointer.data?.semesterId !== payload.semesterId || manifest.data?.semesterId !== payload.semesterId
    || manifest.data?.status !== 'ACTIVE' || manifest.data?.readOnly === true
    || !Number.isSafeInteger(manifest.data?.revision) || manifest.data.revision < 1
    || pointer.data?.revision !== manifest.data.revision)
    fail('failed-precondition', '현재 학기에서 다시 조회해 주세요.', 'ACHIEVEMENT_PROFILE_SEMESTER_INVALID');
  if (classDoc.data?.semesterId !== payload.semesterId || classDoc.data?.status !== 'ACTIVE'
    || slot.data?.studentUid !== payload.studentUid || slot.data?.semesterId !== payload.semesterId
    || !safeId(slot.data?.activeEnrollmentId) || (slot.data?.status && slot.data.status !== 'ACTIVE'))
    fail('failed-precondition', '학생의 현재 학급을 다시 확인해 주세요.', 'ACHIEVEMENT_PROFILE_ROSTER_INVALID');
  const enrollment = await transaction.get(`semester_enrollments/${slot.data.activeEnrollmentId}`);
  if (enrollment.data?.semesterId !== payload.semesterId || enrollment.data?.studentUid !== payload.studentUid
    || enrollment.data?.classId !== payload.classId || enrollment.data?.enrollmentStatus !== 'ACTIVE'
    || !['', 'active'].includes(String(enrollment.data?.rosterExclusionStatus || '')))
    fail('failed-precondition', '학생의 현재 학급을 다시 확인해 주세요.', 'ACHIEVEMENT_PROFILE_ROSTER_INVALID');
  const currentRevision = current.data?.revision ?? 0;
  if (currentRevision !== payload.expectedRevision)
    fail('aborted', '다른 화면에서 분석 성취수준을 변경했습니다. 다시 조회해 주세요.', 'ACHIEVEMENT_PROFILE_REVISION_CONFLICT');
  let cutoff = '', evidence = [];
  if (payload.level !== null) {
    const exam = await transaction.get(`semester_assessment_attempts/${payload.examAttemptId}`);
    const e = exam.data || {};
    const definitionParts = String(e.definitionId || '').split(':');
    const examCategory = String(e.category || definitionParts[3] || '');
    const examRound = e.examRound || definitionParts[4] || examCategory.split('__')[1] || 'round_1';
    const examResult = safeId(String(e.resultRef || '').split('/')[1]) && /^semester_assessment_results\/[^/]+$/.test(e.resultRef || '')
      ? await transaction.get(e.resultRef) : { exists: false };
    const r = examResult.data || {};
    cutoff = iso(e.startedAtIso);
    if (!exam.exists || e.attemptId !== payload.examAttemptId || e.semesterId !== payload.semesterId
      || e.studentUid !== payload.studentUid || e.assessmentKind !== 'QUIZ'
      || (e.sourceId || definitionParts[2]) !== payload.unitId
      || !['exam_prep', `exam_prep__${examRound}`].includes(examCategory) || examRound !== payload.examRound
      || !cutoff || !iso(e.submittedAtIso) || cutoff > iso(e.submittedAtIso)
      || !examResult.exists || r.assessmentKind !== 'QUIZ' || r.attemptId !== e.attemptId || r.studentUid !== payload.studentUid
      || r.semesterId !== payload.semesterId || r.definitionId !== e.definitionId
      || iso(r.submittedAtIso) !== iso(e.submittedAtIso))
      fail('failed-precondition', '확정된 모의고사의 시작 시각을 확인할 수 없습니다.', 'ACHIEVEMENT_PROFILE_EXAM_INVALID');
    const priorExams = await transaction.query('semester_assessment_results', {
      field: 'studentUid', operator: '==', value: payload.studentUid, limit: 1001,
      fieldMask: ['semesterId', 'assessmentKind', 'sourceId', 'category', 'examRound', 'definitionId', 'submittedAtIso', 'attemptId'] });
    if (priorExams.length > 1000) fail('resource-exhausted', '학생 평가 기록의 조회 한도를 초과했습니다.', 'ACHIEVEMENT_PROFILE_RESULT_LIMIT');
    if (priorExams.some(doc => { const p = doc.data || {}, parts = String(p.definitionId || '').split(':');
      const category = String(p.category || parts[3] || '');
      return p.semesterId === payload.semesterId && p.assessmentKind === 'QUIZ'
        && (p.sourceId || parts[2]) === payload.unitId && category.split('__')[0] === 'exam_prep'
        && (p.examRound || parts[4] || category.split('__')[1] || 'round_1') === payload.examRound && p.attemptId !== e.attemptId
        && iso(p.submittedAtIso) && iso(p.submittedAtIso) <= iso(e.submittedAtIso); }))
      fail('failed-precondition', '첫 모의고사 응시를 기준으로 분석 수준을 확인해 주세요.', 'ACHIEVEMENT_PROFILE_FIRST_EXAM_REQUIRED');
    const resultIds = [...new Set(payload.evidenceRefs.map(ref => ref.resultId))];
    const results = await transaction.getAll(resultIds.map(resultId => `semester_assessment_results/${resultId}`));
    const resultMap = new Map(results.map((doc, index) => [resultIds[index], doc]));
    for (const ref of payload.evidenceRefs) {
      const doc = resultMap.get(ref.resultId), raw = doc?.data || {};
      const category = raw.category || String(raw.definitionId || '').split(':')[3];
      const observedAt = iso(raw.submittedAtIso);
      const item = (raw.answerChecks || []).find(item => String(item.id) === ref.questionId);
      const historical = historicalQuestionEvidence(raw, ref.questionId);
      const meta = historical?.metadata;
      if (!doc?.exists || raw.semesterId !== payload.semesterId || raw.studentUid !== payload.studentUid
        || raw.assessmentKind !== 'QUIZ' || !['diagnostic', 'formative'].includes(category)
        || !observedAt || observedAt >= cutoff || typeof item?.correct !== 'boolean'
        || !historical)
        fail('failed-precondition', '모의고사 이전의 확정 학습 근거를 다시 선택해 주세요.', 'ACHIEVEMENT_PROFILE_EVIDENCE_INVALID');
      const mapped = Array.isArray(meta.achievementStandardCodes) ? meta.achievementStandardCodes : [];
      if (mapped.length && (!mapped.includes(payload.standardCode) || meta.curriculumVersion !== catalog.curriculumVersion))
        fail('failed-precondition', '선택한 근거의 성취기준이 일치하지 않습니다.', 'ACHIEVEMENT_PROFILE_STANDARD_MISMATCH');
      const hint = raw.analytics?.questions?.[ref.questionId];
      evidence.push({ ...ref, sourceRevision: historical.sourceRevision, revisionBasis: historical.revisionBasis, observedAt, correct: item.correct,
        hintViewed: hint?.hintViewed === true ? true : hint?.quality === 'complete' && hint?.hintViewed === false ? false : null,
        mappingBasis: mapped.length ? 'snapshot' : 'teacher-confirmed',
        unitId: String(meta.unitId || raw.sourceId || ''), subUnitId: String(meta.subUnitId || ''),
        familyId: String(meta.familyId || '') });
    }
  }
  const result = { id, semesterId: payload.semesterId, classId: payload.classId, unitId: payload.unitId,
    examRound: payload.examRound, studentUid: payload.studentUid, standardCode: payload.standardCode,
    curriculumVersion: catalog.curriculumVersion, rubricVersion: rubrics.version, level: payload.level, revision: currentRevision + 1,
    examAttemptId: payload.examAttemptId, cutoff, asOf: cutoff, evidence,
    evidenceRefs: payload.evidenceRefs, mappingConfirmed: payload.mappingConfirmed,
    basis: 'teacher-confirmed-learning-evidence', confirmedBy: actor.actorUid, confirmedAt: timestamp, reviewedAt: timestamp };
  transaction.set(path, result);
  return { target: { kind: 'achievement-profile', id, refs: [path] },
    sourceHash: createHash('sha256').update(JSON.stringify({ cutoff, evidence })).digest('hex'), result };
}

module.exports = { COMMAND_TYPE, COLLECTION, profileId, normalizeProfilePayload, applyProfile };
