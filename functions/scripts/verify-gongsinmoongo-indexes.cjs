const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const config = JSON.parse(readFileSync(resolve(__dirname, '../../firestore.indexes.json'), 'utf8'));
assert(Array.isArray(config.indexes));
for (const index of config.indexes) {
  assert.equal(typeof index.collectionGroup, 'string');
  assert(['COLLECTION', 'COLLECTION_GROUP'].includes(index.queryScope));
  assert(Array.isArray(index.fields) && index.fields.length >= 2);
  for (const field of index.fields) {
    assert.equal(typeof field.fieldPath, 'string', `Malformed fields in ${index.collectionGroup}`);
    assert(!Object.hasOwn(field, 'collectionGroup'), 'Nested index definitions are invalid');
    assert(['ASCENDING', 'DESCENDING'].includes(field.order) || field.arrayConfig === 'CONTAINS');
  }
}
const expected = [
  ...[['studentId'], ['status'], ['selected'], ['studentId', 'status'], ['studentId', 'selected']].map(prefix => ({
    collectionGroup: 'gongsinmoongo_questions', queryScope: 'COLLECTION', fields: [
      ...prefix.map(fieldPath => ({ fieldPath, order: 'ASCENDING' })),
      { fieldPath: 'createdAt', order: 'DESCENDING' }, { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  })),
  { collectionGroup: 'semester_assessment_attempts', queryScope: 'COLLECTION', fields:
    ['studentUid', 'semesterId', 'assessmentKind', 'status'].map(fieldPath => ({ fieldPath, order: 'ASCENDING' })) },
];
for (const index of expected) assert.equal(config.indexes.filter(value => JSON.stringify(value) === JSON.stringify(index)).length, 1,
  `Missing or duplicated top-level index: ${index.collectionGroup} ${index.fields.map(field => field.fieldPath).join(',')}`);
console.log('PASS Gongsinmoongo index structure and all six production query definitions');
