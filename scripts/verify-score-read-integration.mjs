import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Exercise the production query/cache/join functions with in-memory Firestore
// boundaries. Firestore authorization itself is covered by the rules emulator.
const path = "src/pages/teacher/components/PerformanceScoreManager.tsx";
const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = [
  "cloneScoreListRecords", "buildScoreListRecordFromDocument", "shouldUseScoreDocumentForRoster",
  "clonePerformanceScoreConfirmation", "clonePerformanceScoreConfirmationMap", "invalidateRosterReadCaches",
  "loadScoreDocumentRecordsForRoster", "loadPerformanceScoreConfirmationsForRoster",
  "loadScoreRecordsForRoster", "loadRosterRecordsForClass", "loadClassSheetStudentsForSelection",
];
const initializers = new Map();
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(file))) {
    initializers.set(node.name.getText(file), node.initializer.getText(file));
  }
  ts.forEachChild(node, visit);
};
visit(file);
for (const name of names) assert.ok(initializers.has(name), `${name} must exist`);
const compiled = ts.transpileModule(
  names.map((name) => `const ${name} = ${initializers.get(name)};`).join("\n"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;

const row = (uid, classValue = "1", grade = "3") => ({
  uid, grade, class: classValue,
  number: uid === "student-without-projection" ? "2" : uid ? "1" : "3",
  studentName: uid || "수기학생",
  totalScore: 10, totalMaxScore: 20, items: [{ score: 10, maxScore: 20, scoreEntered: true }],
});
const recordFromRow = (roster, value) => ({
  ...value, id: roster.id, rosterId: roster.id, scoreKind: roster.scoreKind,
  academicYear: roster.academicYear, semester: roster.semester,
});
const fixture = (scoreKind, semester) => {
  const roster = {
    id: `${scoreKind}-${semester}`, scoreKind, academicYear: "2026", semester,
    scoreContentKind: scoreKind === "written_exam_essay" ? "objective" : "performance",
    rows: [row("student-a"), row("student-without-projection"), row(""), row("other-class", "2"), row("other-grade", "1", "2")],
  };
  const records = [
    { ...recordFromRow(roster, roster.rows[0]), totalScore: 18, items: [{ score: 18, maxScore: 20, studentAnswer: "3" }] },
    recordFromRow(roster, roster.rows[3]),
    recordFromRow(roster, roster.rows[4]),
    { ...recordFromRow(roster, row("different-semester")), semester: semester === "1" ? "2" : "1" },
    { ...recordFromRow(roster, row("different-kind")), scoreKind: scoreKind === "performance" ? "written_exam_essay" : "performance" },
    { ...recordFromRow(roster, row("different-year")), academicYear: "2025" },
    { ...recordFromRow(roster, row("different-roster")), rosterId: "unrelated-roster" },
  ];
  const confirmations = [];
  const reads = [];
  let failedGroup = "";
  const cacheRefs = Object.fromEntries([
    "scoreDocumentRecordsByRosterCacheRef", "scoreDocumentRecordPromisesByRosterRef",
    "confirmationsByRosterCacheRef", "confirmationPromisesByRosterRef",
  ].map((key) => [key, { current: new Map() }]));
  const env = {
    ...cacheRefs,
    db: {}, students: [],
    PERFORMANCE_SCORE_USER_COLLECTION: "performance_scores",
    PERFORMANCE_SCORE_CONFIRMATIONS_COLLECTION: "confirmations",
    collectionGroup: (_db, group) => ({ group }),
    where: (field, op, value) => ({ field, op, value }),
    query: (collection, ...filters) => ({ ...collection, filters }),
    getDocs: async (query) => {
      reads.push(structuredClone(query));
      if (failedGroup === query.group) throw new Error("permission-denied");
      const data = query.group === "performance_scores" ? records : confirmations;
      return {
        docs: data.filter((entry) => query.filters.every(({ field, op, value }) => op === "==" && entry[field] === value))
          .map((entry) => ({ id: entry.uid, data: () => structuredClone(entry) })),
      };
    },
    normalizePerformanceScoreKind: (kind) => kind || "performance",
    normalizeSchoolValue: (value) => String(value || "").trim(),
    sortStudentIdentityRows: (rows) => rows,
    sortPerformanceScoreRecords: (rows) => rows,
    buildRecordFromRosterRow: recordFromRow,
    buildScoreListRecordFromRosterRow: recordFromRow,
    buildScoreListRecordsFromRosterRows: (roster) => roster.rows.map((value) => recordFromRow(roster, value)),
    rosterRowHasScore: (value) => Number.isFinite(value.totalScore),
    shouldShowRosterRowInScoreList: (value) => Number.isFinite(value.totalScore),
    isWrittenExamObjectiveRoster: (roster) => roster.scoreContentKind === "objective",
    applyPerformanceScoreConfirmation: (record, confirmation) => ({ ...record, confirmation, signatureImage: confirmation?.signatureImage }),
    summaryExportRosters: { firstRoster: roster },
    classSheetClassFilter: "1", classSheetGradeFilter: "3",
    addRecordToClassSheetStudentMap: (map, record, slot) => {
      const key = record.uid || record.studentName;
      map.set(key, { ...map.get(key), ...record, [slot]: record });
    },
    getClassSheetStudentsFromMap: (map) => [...map.values()],
  };
  const api = new Function(...Object.keys(env), `${compiled}\nreturn { ${names.join(", ")} };`)(...Object.values(env));
  return { ...api, roster, records, confirmations, reads, cacheRefs, failGroup: (value) => { failedGroup = value; } };
};

const scenarios = [];
for (const kind of ["performance", "written_exam_essay"]) {
  for (const semester of ["1", "2"]) {
    const test = fixture(kind, semester);
    const first = await test.loadClassSheetStudentsForSelection();
    assert.deepEqual(first.map((record) => record.uid), ["student-a", "student-without-projection", ""]);
    assert.equal(first[0].firstRecord.totalScore, 18, "student score projection must override the compact roster row");
    assert.equal(first[1].firstRecord.totalScore, 10, "a legacy roster row without a projection must remain visible");
    assert.equal(first[0].firstRecord.signatureImage, undefined);
    assert.deepEqual(test.reads.map(({ group }) => group), ["performance_scores", "confirmations"]);

    // A student signs after the teacher's first query. The next status query
    // and XLSX source load must see the newly saved signature and score.
    test.records[0].totalScore = 19;
    test.confirmations.push({ uid: "student-a", rosterId: test.roster.id, signatureImage: "data:image/png;base64,fixture" });
    const refreshed = await test.loadClassSheetStudentsForSelection();
    assert.equal(refreshed[0].firstRecord.totalScore, 19);
    assert.equal(refreshed[0].firstRecord.signatureImage, "data:image/png;base64,fixture");
    assert.equal(test.reads.length, 4, "an explicit status/export query must refresh both sources");

    // Reads used by the written-exam list and OMR statistics share the same
    // projection contract, including question-level answer information.
    const list = await test.loadScoreRecordsForRoster(test.roster, { includeStudentDocuments: true });
    assert.equal(list[0].items[0].studentAnswer, "3");
    assert.ok(list.every((record) => record.semester === semester && record.scoreKind === kind));
    const before = test.reads.length;
    const defaultList = await test.loadScoreRecordsForRoster(test.roster);
    assert.equal(defaultList[0].totalScore, kind === "written_exam_essay" ? 19 : 10);
    assert.equal(test.reads.length, before, "reads in a single query may reuse the refreshed source cache");

    // Errors remain visible and are retryable; a permission failure must not
    // turn a previously signed student into an unsigned export.
    test.failGroup("confirmations");
    await assert.rejects(test.loadClassSheetStudentsForSelection(), /permission-denied/);
    assert.equal(test.cacheRefs.confirmationPromisesByRosterRef.current.size, 0);
    test.failGroup("");
    assert.equal((await test.loadClassSheetStudentsForSelection())[0].firstRecord.signatureImage, "data:image/png;base64,fixture");
    test.failGroup("performance_scores");
    await assert.rejects(test.loadClassSheetStudentsForSelection(), /permission-denied/);
    assert.equal(test.cacheRefs.scoreDocumentRecordPromisesByRosterRef.current.size, 0);
    test.failGroup("");
    assert.equal((await test.loadClassSheetStudentsForSelection())[0].firstRecord.totalScore, 19);
    scenarios.push(`${kind}:2026-${semester}:class-sheet-list-omr-refresh-retry`);
  }
}
console.log(JSON.stringify({ suite: "score-read-integration", status: "PASS", scenarios, productionAccess: 0 }));
