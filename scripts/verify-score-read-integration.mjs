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
const statisticsNames = [
  "getFiniteNumber", "getItemLabel", "getWrittenExamItemMeta", "getWrittenExamStudentMergeKey",
  "getEnteredItemScore", "getEnteredItemScoreCount", "getEnteredItemsTotalScore", "getEnteredTotalScore",
  "mergeWrittenExamScoreRecordsByStudent", "getRecordTotalMaxScore", "getSummaryMaxScore", "buildScoreSummary",
  "getRecordTotalScores", "buildNormalCurveSummary", "SCORE_STATS_SCORE_EPSILON",
  "getScoreStatsPerfectLabel", "getScoreStatsNinetiesLabel",
];
const expressionNames = ["combinedScoreListSummaryMaxScore", "scoreStatsTotalMaxScore"];
const allNames = [...names, ...statisticsNames, ...expressionNames];
const initializers = new Map();
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && allNames.includes(node.name.getText(file))) {
    initializers.set(node.name.getText(file), node.initializer.getText(file));
  }
  ts.forEachChild(node, visit);
};
visit(file);
for (const name of allNames) assert.ok(initializers.has(name), `${name} must exist`);
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

// Reproduce the real statistics pipeline: merge an 80-point answer sheet and a
// 20-point essay for each student, then use the UI's selected maximum for its
// average percentage, perfect-score labels and distribution curve range.
const statisticsBindings = {
  roundScore: (value) => Math.round(value * 100) / 100,
  formatPerformanceScore: (value) => String(value),
  toText: (value) => String(value || "").trim(),
  normalizeSchoolValue: (value) => String(value || "").trim(),
  normalizeStudentName: (value) => String(value || "").trim(),
  sortStudentIdentityRows: (rows) => rows,
  WRITTEN_EXAM_SECTION_OBJECTIVE: "objective",
};
const statisticsCode = ts.transpileModule(
  statisticsNames.map((name) => `const ${name} = ${initializers.get(name)};`).join("\n"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;
const statistics = new Function(...Object.keys(statisticsBindings), `${statisticsCode}\nreturn { ${statisticsNames.join(", ")} };`)(...Object.values(statisticsBindings));
const evaluate = (name, bindings) => {
  const code = ts.transpileModule(`return ${initializers.get(name)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(bindings), code)(...Object.values(bindings));
};
const selectedMaximum = ({ firstMax = 80, secondMax = 20, mode = "all", written = true, combined = false, olderMax = null } = {}) => {
  const combinedMax = evaluate("combinedScoreListSummaryMaxScore", {
    firstScoreListSummaryMaxScore: firstMax, secondScoreListSummaryMaxScore: secondMax,
    roundScore: statisticsBindings.roundScore,
  });
  return evaluate("scoreStatsTotalMaxScore", {
    isWrittenExamMode: written, scoreStatsMode: mode, usesCombinedPerformanceSummary: combined,
    writtenExamObjectiveGroupMaxScore: firstMax, writtenExamEssayGroupMaxScore: secondMax,
    combinedScoreListSummaryMaxScore: combinedMax,
    // An older uploaded roster must not change the maximum of the selected pair.
    rosters: [{ totalMaxScore: firstMax }, { totalMaxScore: secondMax }, ...(olderMax === null ? [] : [{ totalMaxScore: olderMax }])],
    scoreStatsSelectedRoster: { totalMaxScore: mode === "first" ? firstMax : secondMax },
    getFiniteNumber: statistics.getFiniteNumber,
  });
};
const examRecords = [
  ["student-perfect", 80, 20], ["student-eighty", 64, 16], ["student-sixty", 48, 12],
].flatMap(([uid, objective, essay]) => [
  { uid, totalScore: objective, totalMaxScore: 80, items: [{ name: "서답형", itemKey: "objective-1", examSection: "objective", questionNumber: 1, score: objective, maxScore: 80 }] },
  { uid, totalScore: essay, totalMaxScore: 20, items: [{ name: "논술형", itemKey: "essay-1", groupKey: "essay", score: essay, maxScore: 20 }] },
]);
const merged = statistics.mergeWrittenExamScoreRecordsByStudent(examRecords);
assert.equal(merged.length, 3, "each student's two sections must remain one combined score");
assert.deepEqual(merged.map((record) => record.totalScore), [100, 80, 60]);
const totalMaxScore = statistics.getSummaryMaxScore(merged, selectedMaximum());
assert.equal(totalMaxScore, 100, "written-exam overall statistics must use the selected 80 + 20 maximum");
assert.equal(selectedMaximum({ olderMax: 120 }), 100, "an older upload must not change the selected pair's maximum");
const summary = statistics.buildScoreSummary(merged, totalMaxScore);
assert.equal(summary.average, 80);
assert.equal(summary.percent, 80);
assert.equal(summary.maxScore, 100);
assert.equal(statistics.getScoreStatsPerfectLabel(totalMaxScore), "100점");
assert.equal(statistics.getScoreStatsNinetiesLabel(totalMaxScore), "90점대");
assert.equal(statistics.buildNormalCurveSummary(merged, totalMaxScore).points.at(-1).x, 100);
assert.equal(selectedMaximum({ mode: "objective" }), 80);
assert.equal(selectedMaximum({ mode: "essay" }), 20);
assert.equal(selectedMaximum({ secondMax: null }), 80, "objective-only overall view must remain valid");
assert.equal(selectedMaximum({ firstMax: null }), 20, "essay-only overall view must remain valid");
assert.equal(selectedMaximum({ written: false, combined: true, firstMax: 20, secondMax: 30 }), 50);
assert.equal(selectedMaximum({ written: false, combined: true, firstMax: 20, secondMax: 30, mode: "first" }), 20);
assert.equal(selectedMaximum({ written: false, combined: true, firstMax: 20, secondMax: 30, mode: "second" }), 30);
scenarios.push("written-exam:80-plus-20-statistics-and-single-section-regressions", "performance:combined-and-individual-maximum-regressions");
console.log(JSON.stringify({ suite: "score-read-integration", status: "PASS", scenarios, productionAccess: 0 }));
