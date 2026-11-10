const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createStudentLessonAccessHandler } = require('../studentLessonAccess');

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
