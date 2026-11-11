const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { createStudentLessonAccessHandler, selectVisibleLessons } = require('../studentLessonAccess');

const scoped = 'years/2026/semesters/2/lessons';
const fixture = (collections) => {
  const reads = [];
  const db = {
    doc: path => ({ get: async () => ({ data: () => ({ role: 'teacher' }) }) }),
    collection: path => {
      let filter, fields;
      const query = {
        where: (field, op, value) => { assert.equal(op, '=='); filter = { field, value }; return query; },
        select: (...selected) => { fields = selected; return query; },
        get: async () => {
          const rows = (collections[path] || []).filter(row => !filter || row[filter.field] === filter.value);
          reads.push({ path, filter, fields, documents: rows.length });
          return { docs: rows.map(row => ({ data: () => Object.fromEntries(Object.entries(row).filter(([key]) => fields.includes(key))) })) };
        },
      };
      return query;
    },
  };
  const handler = createStudentLessonAccessHandler({ db, assertSession: async () => undefined });
  return { reads, read: data => handler({ auth: { uid: 'synthetic-teacher' }, data: { year: '2026', semester: '2', ...data } }) };
};

test('one unit reads only scoped documents, preserving full worksheet rendering fields', async () => {
  const data = { unitId: 'a', title: 'A', updatedAt: 2, worksheetTextRegions: [{ text: 'OCR' }], worksheetPageImages: ['image'] };
  const f = fixture({ [scoped]: [data, { unitId: 'b' }], lessons: [{ unitId: 'a', updatedAt: 1 }] });
  const result = await f.read({ unitId: 'a' });
  assert.equal(f.reads.length, 1);
  assert.equal(f.reads[0].documents, 1);
  assert.deepEqual(result.scopedLessons[0].worksheetTextRegions, data.worksheetTextRegions);
  assert.deepEqual(result.scopedLessons[0].worksheetPageImages, data.worksheetPageImages);
  assert.deepEqual(result.legacyLessons, []);
});

for (const hidden of [{ isVisibleToStudents: false }, { deletedAt: 1 }]) {
  test(`a hidden/deleted scoped unit never reads or reveals older public legacy: ${Object.keys(hidden)[0]}`, async () => {
    const f = fixture({ [scoped]: [{ unitId: 'a', ...hidden }], lessons: [{ unitId: 'a', contentHtml: 'old public' }] });
    const result = await f.read({ unitId: 'a' });
    assert.equal(f.reads.length, 1);
    assert.equal(result.scopedLessons.length + result.legacyLessons.length, 0);
  });
}

test('only absent scoped unit queries its exact legacy fallback', async () => {
  const f = fixture({ [scoped]: [{ unitId: 'b' }], lessons: [{ unitId: 'a', contentHtml: 'legacy' }, { unitId: 'other' }] });
  const result = await f.read({ unitId: 'a' });
  assert.equal(f.reads.length, 2);
  assert.deepEqual(f.reads.map(r => r.filter), [{ field: 'unitId', value: 'a' }, { field: 'unitId', value: 'a' }]);
  assert.equal(result.legacyLessons[0].contentHtml, 'legacy');
});

test('progress catalogue retains all totals/legacy-only units but excludes expensive presentation fields', async () => {
  const data = { unitId: 'a', title: 'A', contentHtml: '{{inline}}', worksheetBlanks: [{ id: 'blank', answer: 'answer' }],
    worksheetExamHighlights: [{ id: 'core' }], worksheetTextRegions: ['large OCR'], worksheetPageImages: ['image'],
    pdfUrl: 'pdf', pdfStoragePath: 'storage', pdfProcessing: { large: true }, footnotes: [{ body: 'long body' }] };
  const f = fixture({ [scoped]: [data], lessons: [{ unitId: 'b', contentHtml: '{{legacy blank}}' }] });
  const result = await f.read({ view: 'progress' });
  assert.equal(f.reads.length, 2);
  assert.equal(result.scopedLessons.length + result.legacyLessons.length, 2);
  assert.deepEqual(result.scopedLessons[0].worksheetBlanks, data.worksheetBlanks);
  assert.deepEqual(result.scopedLessons[0].worksheetExamHighlights, data.worksheetExamHighlights);
  assert.equal(result.scopedLessons[0].contentHtml, data.contentHtml);
  for (const field of ['worksheetTextRegions', 'worksheetPageImages', 'pdfUrl', 'pdfStoragePath', 'pdfProcessing', 'footnotes']) {
    assert.equal(f.reads.some(read => read.fields.includes(field)), false, `must not fetch ${field}`);
    assert.equal(field in result.scopedLessons[0], false);
  }
});

test('core-point totals count only valid bounds from latest public effective units with a minimal projection', async () => {
  const point = { widthRatio: 0.2, heightRatio: 0.1 };
  const f = fixture({
    [scoped]: [
      { unitId: 'a', updatedAt: 1, worksheetExamHighlights: [point, point, point] },
      { unitId: 'a', updatedAt: 2, worksheetExamHighlights: [point, { widthRatio: '0.3', heightRatio: '0.2' },
        null, {}, { widthRatio: 0, heightRatio: 1 }, { widthRatio: 1, heightRatio: -1 }, { widthRatio: 'bad', heightRatio: 1 }],
        worksheetBlanks: [{ id: 'blank' }], footnotes: [{ id: 'footnote' }], contentHtml: 'body', pdfUrl: 'pdf' },
      { unitId: 'hidden', updatedAt: 1, worksheetExamHighlights: [point] },
      { unitId: 'hidden', updatedAt: 2, isVisibleToStudents: false, worksheetExamHighlights: [point] },
      { unitId: 'deleted', deletedAt: 1, worksheetExamHighlights: [point] },
      { unitId: 'empty' },
    ],
    lessons: [{ unitId: 'a', worksheetExamHighlights: [point] },
      { unitId: 'hidden', worksheetExamHighlights: [point] },
      { unitId: 'deleted', worksheetExamHighlights: [point] },
      { unitId: 'legacy', worksheetExamHighlights: [point] }],
  });
  const result = await f.read({ view: 'core-points' });
  assert.deepEqual(result, {
    scopedLessons: [{ unitId: 'a', corePointCount: 2 }, { unitId: 'empty', corePointCount: 0 }],
    legacyLessons: [{ unitId: 'legacy', corePointCount: 1 }],
  });
  assert.equal(f.reads.length, 2);
  assert.equal(f.reads.reduce((sum, read) => sum + read.documents, 0), 10, 'projection saves bytes, not document reads');
  for (const read of f.reads) {
    assert.deepEqual(read.fields, ['unitId', 'isVisibleToStudents', 'deletedAt', 'updatedAt', 'createdAt',
      'assignedClassIds', 'worksheetExamHighlights']);
  }
});

test('core-point catalogue does not truncate totals or cache errors between explicit retries', async () => {
  const lessons = Array.from({ length: 501 }, (_, index) => ({ unitId: `unit-${index}`,
    worksheetExamHighlights: [{ widthRatio: 1, heightRatio: 1 }] }));
  const f = fixture({ [scoped]: lessons });
  const result = await f.read({ view: 'core-points' });
  assert.equal(result.scopedLessons.reduce((sum, lesson) => sum + lesson.corePointCount, 0), 501);
  assert.equal(f.reads.length, 2);
  let attempts = 0;
  const handler = createStudentLessonAccessHandler({
    assertSession: async () => undefined,
    db: { doc: () => ({ get: async () => ({ data: () => ({ role: 'teacher' }) }) }),
      collection: () => ({ select: () => ({ get: async () => {
        attempts++;
        if (attempts <= 2) throw new Error('offline');
        return { docs: [] };
      } }) }) },
  });
  const request = { auth: { uid: 'teacher' }, data: { year: '2026', semester: '2', view: 'core-points' } };
  await assert.rejects(handler(request), /offline/);
  assert.deepEqual(await handler(request), { scopedLessons: [], legacyLessons: [] });
  assert.equal(attempts, 4);
});

test('core-point mode preserves the session gate and the shared class visibility boundary', async () => {
  let reads = 0;
  const handler = createStudentLessonAccessHandler({
    assertSession: async () => { throw new Error('session-denied'); },
    db: { doc: () => { reads++; throw new Error('unexpected read'); } },
  });
  await assert.rejects(handler({ auth: { uid: 'student' }, data: { view: 'core-points' } }), /session-denied/);
  assert.equal(reads, 0);
  const rows = [{ unitId: 'a', assignedClassIds: ['class-a'], updatedAt: 2 },
    { unitId: 'a', assignedClassIds: ['class-b'], updatedAt: 1 }, { unitId: 'all' }];
  assert.deepEqual(selectVisibleLessons(rows, [{ unitId: 'a' }], 'class-b').scopedLessons.map(row => row.unitId), ['all']);
  assert.equal(selectVisibleLessons(rows, [{ unitId: 'a' }], 'class-b').legacyLessons.length, 0);
  assert.deepEqual(selectVisibleLessons(rows, [], '').scopedLessons.map(row => row.unitId), ['a', 'all']);
});

const studentFixture = () => {
  const uid = 'synthetic-lesson-student', scope = '2026-2';
  const slot = `semester_enrollment_slots/slot_${createHash('sha256').update(`${scope}\n${uid}`).digest('hex').slice(0, 40)}`;
  const documents = new Map([
    [`users/${uid}`, { role: 'student' }],
    ['site_settings/config', { year: '2026', semester: '2' }],
    ['site_settings/semester_active', { semesterId: scope, revision: 4 }],
    [`semester_manifests/${scope}`, { status: 'ACTIVE', revision: 4 }],
    [slot, { studentUid: uid, semesterId: scope, activeEnrollmentId: 'synthetic-enrollment', status: 'ACTIVE' }],
    ['semester_enrollments/synthetic-enrollment', { studentUid: uid, semesterId: scope, enrollmentStatus: 'ACTIVE', classId: 'class-a' }],
    ['semester_classes/class-a', { semesterId: scope, status: 'ACTIVE' }],
  ]);
  const collections = {
    [scoped]: [{ unitId: 'allowed', assignedClassIds: ['class-a'], updatedAt: 2 },
      { unitId: 'other-class', assignedClassIds: ['class-b'], updatedAt: 2 },
      { unitId: 'other-class', assignedClassIds: ['class-a'], updatedAt: 1 }],
    lessons: [{ unitId: 'other-class', contentHtml: 'must stay hidden' }, { unitId: 'legacy-only', contentHtml: 'visible legacy' }],
  };
  const reads = [];
  const readDoc = path => { reads.push({ kind: 'doc', path }); return { exists: documents.has(path), data: () => documents.get(path) }; };
  const db = {
    doc: path => ({ path, get: async () => readDoc(path) }),
    getAll: async (...refs) => refs.map(ref => readDoc(ref.path)),
    collection: path => {
      let filter, fields;
      const query = {
        where: (field, operator, value) => { assert.equal(operator, '=='); filter = { field, value }; return query; },
        select: (...selected) => { fields = selected; return query; },
        get: async () => {
          const rows = (collections[path] || []).filter(row => !filter || row[filter.field] === filter.value);
          reads.push({ kind: 'query', path, filter, documents: rows.length, fields });
          return { docs: rows.map(row => ({ data: () => Object.fromEntries(Object.entries(row).filter(([field]) => fields.includes(field))) })) };
        },
      };
      return query;
    },
  };
  const handler = createStudentLessonAccessHandler({ db, assertSession: async () => undefined });
  return { documents, collections, reads, slot, read: input => handler({ auth: { uid }, data: { year: '2026', semester: '2', ...input } }) };
};

test('student catalogue uses canonical class, preserves complete legacy-only units, and strips assignment metadata', async () => {
  const f = studentFixture();
  f.collections[scoped].push(...Array.from({ length: 501 }, (_, index) => ({ unitId: `complete-${index}`, assignedClassIds: ['class-a'] })));
  const result = await f.read({ view: 'catalog' });
  assert.equal(result.scopedLessons.length, 502);
  assert.deepEqual(result.legacyLessons.map(row => row.unitId), ['legacy-only']);
  assert.equal(result.scopedLessons.some(row => row.unitId === 'other-class'), false);
  assert.ok(result.scopedLessons.every(row => row.semesterRevision === 4 && !Object.hasOwn(row, 'assignedClassIds')));
  assert.equal(f.reads.filter(row => row.kind === 'doc').length, 7, 'all seven authority/scope reads remain; session checks are separate');
  assert.equal(f.reads.filter(row => row.kind === 'query').length, 2);
  assert.equal(f.reads.filter(row => row.kind === 'query').reduce((sum, row) => sum + row.documents, 0), 506);
});

test('student cannot retrieve an older matching-class or legacy revision when the newest scoped unit targets another class', async () => {
  const f = studentFixture();
  assert.deepEqual(await f.read({ unitId: 'other-class' }), { scopedLessons: [], legacyLessons: [] });
  assert.deepEqual(f.reads.filter(row => row.kind === 'query').map(row => row.path), [scoped]);
});

test('semester, slot, enrollment, and classroom failures stop before any lesson source read', async () => {
  const cases = [
    ['site_settings/config', { year: '2025' }],
    ['site_settings/semester_active', { semesterId: '2026-1' }],
    ['semester_manifests/2026-2', { revision: 5 }],
    ['semester_manifests/2026-2', { status: 'ARCHIVED' }],
    ['semester_manifests/2026-2', { readOnly: true }],
    ['slot', { studentUid: 'other-student' }],
    ['slot', { status: 'INACTIVE' }],
    ['slot', { activeEnrollmentId: '' }],
    ['semester_enrollments/synthetic-enrollment', { studentUid: 'other-student' }],
    ['semester_enrollments/synthetic-enrollment', { semesterId: '2026-1' }],
    ['semester_enrollments/synthetic-enrollment', { enrollmentStatus: 'INACTIVE' }],
    ['semester_enrollments/synthetic-enrollment', { readOnly: true }],
    ['semester_classes/class-a', { semesterId: '2026-1' }],
    ['semester_classes/class-a', { status: 'ARCHIVED' }],
    ['semester_classes/class-a', { readOnly: true }],
  ];
  for (const [target, patch] of cases) {
    const f = studentFixture(), path = target === 'slot' ? f.slot : target;
    f.documents.set(path, { ...f.documents.get(path), ...patch });
    await assert.rejects(f.read({ unitId: 'allowed' }), error => ['permission-denied', 'failed-precondition'].includes(error.code));
    assert.equal(f.reads.filter(row => row.kind === 'query').length, 0, `${target} failure must not read lessons`);
  }
});
