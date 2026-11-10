const { HttpsError } = require('firebase-functions/v2/https');
const { createHash } = require('node:crypto');
const { assertScoreWorkflowSession } = require('./scoreWorkflowGuard');

// Visibility is resolved before returning a document. A newer hidden scoped
// lesson must never reveal an older public revision or the legacy fallback.
const LESSON_FIELDS = [
  'unitId', 'title', 'videoUrl', 'contentHtml', 'isVisibleToStudents', 'deletedAt',
  'pdfName', 'pdfUrl', 'pdfStoragePath', 'worksheetPageImages', 'worksheetTextRegions',
  'worksheetBlanks', 'worksheetExamHighlights', 'worksheetFootnoteAnchors',
  'pdfProcessing', 'footnotes', 'updatedAt', 'createdAt', 'contentRevision', 'assignedClassIds',
];
const CATALOG_FIELDS = [
  'unitId', 'title', 'isVisibleToStudents', 'deletedAt', 'updatedAt', 'createdAt',
  'contentRevision', 'assignedClassIds',
];
// Progress totals need blanks and core-point IDs, never PDFs, OCR regions,
// page images, processing details or footnote bodies from every lesson.
const PROGRESS_FIELDS = [...CATALOG_FIELDS, 'contentHtml', 'worksheetBlanks', 'worksheetExamHighlights'];
// Teacher list totals only need visibility/revision selection and highlight bounds.
// Return counts, not worksheet content or the highlight array itself.
const CORE_POINT_FIELDS = [
  'unitId', 'isVisibleToStudents', 'deletedAt', 'updatedAt', 'createdAt',
  'assignedClassIds', 'worksheetExamHighlights',
];
const countCorePoints = (highlights) => Array.isArray(highlights)
  ? highlights.filter((point) => point && typeof point === 'object'
    && Number(point.widthRatio) > 0 && Number(point.heightRatio) > 0).length
  : 0;
const timestampMs = (value) => {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return Date.parse(value) || 0;
  return Number(value?.seconds || 0) * 1000;
};
const latestByUnit = (rows) => {
  const latest = new Map();
  for (const row of [...rows].sort((a, b) => timestampMs(b.updatedAt || b.createdAt) - timestampMs(a.updatedAt || a.createdAt))) {
    const unitId = String(row.unitId || '').trim();
    if (unitId && !latest.has(unitId)) latest.set(unitId, row);
  }
  return latest;
};
const visible = (lesson) => lesson.isVisibleToStudents !== false && !lesson.deletedAt;
const serializeLesson = (lesson) => Object.fromEntries(
  Object.entries(lesson).filter(([key]) => LESSON_FIELDS.includes(key) && key !== 'deletedAt')
    .map(([key, value]) => [key, key === 'updatedAt' || key === 'createdAt' ? timestampMs(value) : value]),
);
const selectVisibleLessons = (scopedRows, legacyRows, classId) => {
  const scoped = latestByUnit(scopedRows), legacy = latestByUnit(legacyRows);
  const permitted = (lesson) => visible(lesson) && (!classId || !Array.isArray(lesson.assignedClassIds)
    || !lesson.assignedClassIds.length || lesson.assignedClassIds.includes(classId));
  return {
    scopedLessons: [...scoped.values()].filter(permitted).map(serializeLesson),
    legacyLessons: [...legacy.entries()].filter(([unitId, lesson]) => !scoped.has(unitId) && permitted(lesson)).map(([, lesson]) => serializeLesson(lesson)),
  };
};

const createStudentLessonAccessHandler = ({ db, assertSession = assertScoreWorkflowSession }) => async (request) => {
  await assertSession(request);
  const year = String(request.data?.year || ''), semester = String(request.data?.semester || '');
  if (!/^\d{4}$/.test(year) || !/^[12]$/.test(semester)) {
    throw new HttpsError('invalid-argument', '학기 정보를 확인해 주세요.');
  }
  const corePointsOnly = request.data?.view === 'core-points';
  const fields = corePointsOnly ? CORE_POINT_FIELDS : request.data?.view === 'catalog' ? CATALOG_FIELDS
    : request.data?.view === 'progress' ? PROGRESS_FIELDS : LESSON_FIELDS;
  const unitId = String(request.data?.unitId || '').trim();
  if (unitId.length > 200 || unitId.includes('/')) {
    throw new HttpsError('invalid-argument', '단원 정보를 확인해 주세요.');
  }
  const profile = (await db.doc(`users/${request.auth.uid}`).get()).data() || {};
  let classId = '', semesterRevision = 0;
  if (profile.role === 'student') {
    const config = (await db.doc('site_settings/config').get()).data() || {};
    if (String(config.year) !== year || String(config.semester) !== semester) {
      throw new HttpsError('failed-precondition', '현재 학기에서 수업 자료를 열어 주세요.');
    }
    const scope = `${year}-${semester}`;
    const slotId = 'slot_' + createHash('sha256').update(scope + '\n' + request.auth.uid).digest('hex').slice(0, 40);
    const [pointerSnap, manifestSnap, slotSnap] = await db.getAll(db.doc('site_settings/semester_active'), db.doc(`semester_manifests/${scope}`), db.doc(`semester_enrollment_slots/${slotId}`));
    const pointer = pointerSnap.data() || {}, manifest = manifestSnap.data() || {}, slot = slotSnap.data() || {};
    if (pointer.semesterId !== scope || manifest.status !== 'ACTIVE' || manifest.readOnly === true
      || !Number.isSafeInteger(manifest.revision) || pointer.revision !== manifest.revision
      || slot.studentUid !== request.auth.uid || slot.semesterId !== scope || !slot.activeEnrollmentId
      || (slot.status !== undefined && slot.status !== 'ACTIVE')) {
      throw new HttpsError('permission-denied', '현재 학기의 수강 정보를 확인해 주세요.');
    }
    const enrollment = (await db.doc(`semester_enrollments/${slot.activeEnrollmentId}`).get()).data() || {};
    if (enrollment.studentUid !== request.auth.uid || enrollment.semesterId !== scope
      || enrollment.enrollmentStatus !== 'ACTIVE' || enrollment.readOnly === true || !enrollment.classId) {
      throw new HttpsError('permission-denied', '현재 학기의 수강 정보를 확인해 주세요.');
    }
    const classroom = (await db.doc(`semester_classes/${enrollment.classId}`).get()).data() || {};
    if (classroom.semesterId !== scope || classroom.status !== 'ACTIVE' || classroom.readOnly === true) {
      throw new HttpsError('permission-denied', '현재 학급 정보를 확인해 주세요.');
    }
    classId = enrollment.classId;
    semesterRevision = manifest.revision;
  }
  const readLessons = (path) => {
    let source = db.collection(path);
    if (unitId) source = source.where('unitId', '==', unitId);
    return source.select(...fields).get();
  };
  const scopedPath = `years/${year}/semesters/${semester}/lessons`;
  let scoped, legacy;
  if (unitId) {
    scoped = await readLessons(scopedPath);
    // Any scoped revision, even hidden/deleted/unassigned, supersedes legacy.
    // Read fallback only when this exact unit has no semester document.
    legacy = scoped.docs.length ? { docs: [] } : await readLessons('lessons');
  } else {
    // A catalogue must still include legacy-only units; do not truncate totals.
    [scoped, legacy] = await Promise.all([readLessons(scopedPath), readLessons('lessons')]);
  }
  const result = selectVisibleLessons(scoped.docs.map((doc) => doc.data()), legacy.docs.map((doc) => doc.data()), classId);
  if (corePointsOnly) {
    return Object.fromEntries(Object.entries(result).map(([key, lessons]) => [key,
      lessons.map((lesson) => ({ unitId: lesson.unitId, corePointCount: countCorePoints(lesson.worksheetExamHighlights) }))]));
  }
  return Object.fromEntries(Object.entries(result).map(([key, lessons]) => [key,
    lessons.map(({ assignedClassIds, ...lesson }) => ({ ...lesson, semesterRevision }))]));
};

module.exports = { createStudentLessonAccessHandler, selectVisibleLessons };
