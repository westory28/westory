import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

// Execute the production handler with in-memory boundaries only: no Firebase,
// browser, emulator, or network imports. The intent/receipt contract itself is
// covered by verify-w10p-grade-intent.mjs.
const source = readFileSync(
  resolve("src/pages/teacher/components/PerformanceScoreManager.tsx"),
  "utf8",
);
const sourceFile = ts.createSourceFile(
  "PerformanceScoreManager.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let handler;
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === "saveParsedScores") {
    handler = node.initializer;
  }
  ts.forEachChild(node, visit);
};
visit(sourceFile);
assert.ok(handler && ts.isArrowFunction(handler), "saveParsedScores handler must exist");
const compiled = ts.transpileModule(
  `const run = ${handler.getText(sourceFile)};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;

const row = (index) => ({
  rowKey: `row-${index}`,
  rowNumber: index,
  uid: `student-${index}`,
  grade: "2",
  class: "1",
  number: String(index),
  studentName: `검증학생${index}`,
  enteredScoreCount: 1,
  items: [{ itemKey: "q1", score: 9, maxScore: 10, scoreEntered: true }],
  totalScore: 9,
  totalMaxScore: 10,
  feedback: "검증용 피드백",
  evidence: "검증용 근거",
  matchStatus: "matched",
});

const fixture = ({ scoreKind, loseFirstResponse = false, rowCount = 2 }) => {
  const parsed = {
    title: "검증용 평가",
    subject: "역사",
    rows: Array.from({ length: rowCount }, (_, index) => row(index + 1)),
    items: [{ itemKey: "q1", maxScore: 10 }],
    totalMaxScore: 10,
    sourceFileName: "fixture.xlsx",
  };
  const state = { parsed, rosters: [{ id: "unrelated-roster" }] };
  const cache = new Map();
  const invalidated = [];
  const toasts = [];
  const submissions = [];
  const errors = [];
  let receipt;
  let sequence = 0;
  const env = {
    parsed,
    saving: false,
    isWrittenExamMode: scoreKind === "written_exam_essay",
    activeScoreKind: scoreKind,
    managerCopy: { defaultSubject: "역사", scoreKindLabel: "검증", scoreNameLabel: "평가" },
    assessmentPreset: "auto",
    getAssessmentConfig: () => ({ title: parsed.title, subject: parsed.subject }),
    title: parsed.title,
    subject: parsed.subject,
    parsedSummary: { unmatchedCount: 0, warningCount: 0 },
    LEGACY_GRADE_ATOMIC_RECORD_LIMIT: 100,
    config: { year: "2026", semester: "2" },
    year: "2026",
    semester: "2",
    targetGrade: "2",
    fallbackClass: "1",
    db: {},
    rosterCollectionPath: "years/2026/semesters/2/performance_score_rosters",
    collection: () => ({}),
    doc: () => ({ id: `generated-roster-${++sequence}` }),
    serverTimestamp: () => "fixture-timestamp",
    currentUser: { uid: "teacher-fixture", email: "fixture@example.invalid" },
    getRosterRowItemsForStorage: (items) => items,
    assertRosterPayloadFitsFirestore: () => {},
    cloneScoreListRecords: structuredClone,
    sortStudentIdentityRows: (rows) => rows,
    sortPerformanceScoreRosters: (rosters) => rosters,
    scoreDocumentRecordsByRosterCacheRef: { current: cache },
    invalidateRosterReadCaches: (...ids) => invalidated.push(...ids),
    getFirestoreWriteErrorMessage: (error) => error.message,
    console: { error: (...args) => errors.push(args) },
    showToast: (toast) => toasts.push(toast),
    saveLegacyGradeRoster: async (input) => {
      submissions.push(structuredClone(input));
      assert.equal(input.mode, "CREATE");
      if (!receipt) {
        receipt = {
          rosterId: input.roster.id,
          revision: 1,
          records: input.records.map((record) => ({
            uid: record.uid,
            recordId: `grade-${record.uid}`,
            versionId: `version-${record.uid}`,
            revision: 1,
            gradeRevision: 1,
            projectionRevision: 1,
          })),
        };
        if (loseFirstResponse) throw new Error("Fixture: response lost after commit");
      }
      return structuredClone(receipt);
    },
  };
  for (const name of [
    "Saving", "Parsed", "ScoreListRosterId", "ScoreListLoadedRosterId",
    "ScoreListLoadError", "ScoreEditing", "ScoreEditOriginalRecords",
    "ScoreListGradeFilter", "ScoreListClassFilter", "ScoreListSearch",
    "ScoreListSummaryStudents", "ScoreListSummaryLoadedKey", "ScoreListRecords", "Rosters",
  ]) {
    const key = name[0].toLowerCase() + name.slice(1);
    env[`set${name}`] = (value) => {
      state[key] = typeof value === "function" ? value(state[key]) : value;
      if (key === "parsed" || key === "saving") env[key] = state[key];
    };
  }
  return {
    state, cache, invalidated, toasts, submissions, errors,
    run: () => new Function(...Object.keys(env), `${compiled}\nreturn run();`)(...Object.values(env)),
  };
};

const scenarios = [];
for (const scoreKind of ["performance", "written_exam_essay"]) {
  for (const loseFirstResponse of [false, true]) {
    const test = fixture({ scoreKind, loseFirstResponse });
    if (loseFirstResponse) {
      await test.run();
      assert.ok(test.state.parsed, "failed response must preserve the upload preview");
      assert.equal(test.state.saving, false);
      assert.equal(test.state.scoreListRosterId, undefined);
      assert.equal(test.cache.size, 0);
      assert.deepEqual(test.invalidated, []);
      assert.equal(test.toasts.at(-1).tone, "error");
      // A read refresh may already have discovered the committed roster.
      test.state.rosters.push({ id: "generated-roster-1", revision: 1 });
    }
    await test.run();
    const savedId = "generated-roster-1";
    assert.equal(test.submissions.at(-1).roster.id, loseFirstResponse ? "generated-roster-2" : savedId);
    assert.equal(test.state.parsed, null);
    assert.equal(test.state.saving, false);
    assert.equal(test.state.scoreListRosterId, savedId);
    assert.equal(test.state.scoreListLoadedRosterId, savedId);
    assert.deepEqual(test.invalidated, [savedId]);
    assert.deepEqual([...test.cache.keys()], [savedId]);
    assert.deepEqual(test.state.rosters.map(({ id }) => id), [savedId, "unrelated-roster"]);
    assert.equal(test.state.rosters[0].revision, 1);
    for (const record of [...test.state.scoreListRecords, ...test.cache.get(savedId)]) {
      assert.equal(record.id, savedId);
      assert.equal(record.rosterId, savedId);
      assert.equal(record.gradeRecordId, `grade-${record.uid}`);
      assert.equal(record.gradeVersionId, `version-${record.uid}`);
      assert.equal(record.gradeRecordRevision, 1);
      assert.equal(record.gradeRevision, 1);
      assert.equal(record.projectionRevision, 1);
      assert.equal(record.totalScore, 9);
      assert.equal(record.evidence, "검증용 근거");
    }
    assert.equal(test.toasts.at(-1).tone, "success");
    assert.equal(test.errors.length, loseFirstResponse ? 1 : 0);
    scenarios.push(`${scoreKind}:${loseFirstResponse ? "lost-response-retry" : "first-create"}`);
  }
}
const oversized = fixture({ scoreKind: "performance", rowCount: 101 });
await oversized.run();
assert.equal(oversized.submissions.length, 0);
assert.ok(oversized.state.parsed);
assert.equal(oversized.toasts.at(-1).tone, "warning");
scenarios.push("atomic-limit-preserved");

console.log(JSON.stringify({ suite: "grade-roster-retry-selection", status: "PASS", scenarios, productionAccess: 0 }));
