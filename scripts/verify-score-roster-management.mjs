import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import ts from "typescript";

// Evaluate the checked-in helpers and save closure with deterministic Firestore mocks.
// Fixtures contain synthetic students only; no service credentials or production writes.
const definitions = new Map();
let loadScoreRecordsClosure = "";
let loadClassRecordsClosure = "";
for (const path of [
  "src/lib/performanceScores.ts",
  "src/pages/teacher/components/PerformanceScoreManager.tsx",
]) {
  const source = ts.createSourceFile(
    path,
    fs.readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  function findSave(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "loadRosterRecordsForClass"
    ) {
      loadClassRecordsClosure = node.initializer.getText(source);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "loadScoreRecordsForRoster"
    ) {
      loadScoreRecordsClosure = node.initializer.getText(source);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "saveScoreListEdits"
    )
      definitions.set("saveScoreListEdits", {
        code: "const " + node.getText(source) + ";",
        node: node.initializer,
      });
    ts.forEachChild(node, findSave);
  }
  findSave(source);
  for (const node of source.statements) {
    if (ts.isVariableStatement(node))
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer)
          definitions.set(decl.name.text, {
            code: "const " + decl.getText(source) + ";",
            node: decl.initializer,
          });
      }
  }
}
const collected = new Map();
function collect(name) {
  if (collected.has(name) || !definitions.has(name)) return;
  const declaration = definitions.get(name);
  collected.set(name, declaration.code);
  function visit(node) {
    if (ts.isIdentifier(node) && node.text !== name) collect(node.text);
    ts.forEachChild(node, visit);
  }
  visit(declaration.node);
}
const targets = [
  "matchRowsToStudents",
  "repairRosterRowsWithStudentProfiles",
  "buildActiveStudentRoster",
  "buildScoreListRecordsFromRosterRows",
  "saveScoreListEdits",
  "applyPerformanceScoreConfirmation",
  "getAcademicStatusLabel",
  "clearLegacyScoreEnrollmentForActiveStudent",
  "sortPerformanceScoreRecords",
];
targets.forEach(collect);
const body =
  "let isSemesterArchive = false;\n" +
  Array.from(collected.values()).join("\n") +
  "\nthis.subject = {" +
  targets.join(",") +
  ",archive(value){isSemesterArchive=value;}};";
const compiled = ts.transpileModule(body, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.None,
    jsx: ts.JsxEmit.React,
  },
}).outputText;
const context = { console: { ...console, error: () => {}, warn: () => {} } };
vm.createContext(context);
vm.runInContext(compiled, context);
const subject = context.subject;
const active = [
  {
    uid: "active-1",
    name: "가학생",
    grade: "3",
    class: "1",
    number: "1",
    email: "",
  },
  {
    uid: "new-2",
    name: "나학생",
    grade: "3",
    class: "1",
    number: "2",
    email: "",
  },
  {
    uid: "moved-3",
    name: "다학생",
    grade: "3",
    class: "2",
    number: "3",
    email: "",
  },
];
const mkRow = (uid, number, name) => ({
  rowNumber: Number(number) + 6,
  uid,
  grade: "3",
  class: "1",
  number,
  studentName: name,
  items: [{ name: "평가", maxScore: 20, score: 15, scoreEntered: true }],
  enteredScoreCount: 1,
  totalScore: 15,
  totalMaxScore: 20,
  matchStatus: "matched",
  matchMessage: "",
  feedback: "근거",
  evidence: "근거",
});
const rows = [
  mkRow("active-1", "1", "옛이름"),
  mkRow("excluded-9", "9", "제외학생"),
  mkRow("moved-3", "3", "다학생"),
];
const roster = {
  id: "roster",
  title: "평가",
  subject: "역사",
  targetGrade: "3",
  targetClass: "1",
  classes: ["1"],
  items: [{ name: "평가", maxScore: 20 }],
  totalMaxScore: 20,
  rows,
};
const before = JSON.stringify(roster);
const view = subject.buildActiveStudentRoster(roster, active);
assert.deepEqual(
  Array.from(view.rows, (r) => r.uid),
  ["active-1", "moved-3", "new-2"],
);
assert.equal(view.rows.find((r) => r.uid === "active-1").studentName, "가학생");
assert.equal(view.rows.find((r) => r.uid === "moved-3").class, "2");
assert.equal(view.rows.find((r) => r.uid === "new-2").enteredScoreCount, 0);
assert.equal(JSON.stringify(roster), before);
assert.equal(subject.buildActiveStudentRoster(roster, []).rows.length, 0);
assert.equal(
  subject
    .buildScoreListRecordsFromRosterRows(view)
    .find((r) => r.uid === "new-2").enteredScoreCount,
  0,
);
const candidate = {
  ...mkRow("", "1", "다른이름"),
  rowKey: "r",
  enteredScoreCount: 1,
};
assert.equal(subject.matchRowsToStudents([candidate], active)[0].uid, "");
assert.equal(
  subject.matchRowsToStudents(
    [{ ...candidate, studentName: "가학생" }],
    active,
  )[0].uid,
  "active-1",
);
assert.equal(
  subject.matchRowsToStudents(
    [{ ...candidate, number: "99", studentName: "가학생" }],
    active,
  )[0].uid,
  "",
);
const repair = subject.repairRosterRowsWithStudentProfiles(rows, active);
assert.equal(repair.rows.length, 3);
assert.equal(repair.changed, false);
assert.equal(repair.removedRows.length, 0);
assert.equal(repair.rows.find((r) => r.uid === "excluded-9").totalScore, 15);
const unlinkedRows = [mkRow("", "1", "가학생"), mkRow("", "2", "이름불일치")];
const strictRepair = subject.repairRosterRowsWithStudentProfiles(
  unlinkedRows,
  active,
);
assert.equal(strictRepair.rows[0].uid, "active-1");
assert.equal(strictRepair.rows[1].uid, "");
const duplicateView = subject.buildActiveStudentRoster(
  { ...roster, rows: [mkRow("", "1", "가학생"), ...rows] },
  active,
);
assert.equal(
  duplicateView.rows.filter((row) => row.uid === "active-1").length,
  1,
);
const legacyExcludedRow = {
  ...rows[0],
  academicStatus: "전출",
  isTransferred: true,
  transferStatus: "transferred",
};
const legacyExcludedRoster = { ...roster, rows: [legacyExcludedRow] };
const legacyActiveView = subject.buildActiveStudentRoster(
  legacyExcludedRoster,
  active,
);
assert.equal(subject.getAcademicStatusLabel(legacyActiveView.rows[0]), "");
assert.equal(
  subject.buildScoreListRecordsFromRosterRows(legacyActiveView)[0].totalScore,
  15,
);
assert.equal(legacyExcludedRow.academicStatus, "전출");
assert.equal(legacyExcludedRow.isTransferred, true);
subject.archive(true);
assert.equal(
  subject.clearLegacyScoreEnrollmentForActiveStudent(legacyExcludedRow),
  legacyExcludedRow,
);
assert.equal(subject.buildActiveStudentRoster(roster, []), roster);
console.log(
  "PASS roster checks: exact identity, mismatch rejection, inactive exclusion, zero-active behavior, new blank score row, canonical identity, class move, archive preservation, original score preservation.",
);

await (async () => {
  subject.archive(false);
  const fixtureRoster = {
    ...roster,
    scoreKind: "performance",
    academicYear: "2026",
    semester: "2",
    sourceFileName: "fixture.xlsx",
    createdAt: "created",
    uploadedBy: "teacher",
    uploadedByEmail: "teacher@example.invalid",
  };
  const original = subject
    .buildScoreListRecordsFromRosterRows(fixtureRoster)
    .find((r) => r.uid === "active-1");
  const updated = {
    ...original,
    items: original.items.map((item) => ({ ...item, score: 18 })),
    totalScore: 18,
  };
  const rosterPath = "years/2026/semesters/2/performance_score_rosters/roster";
  const snapshots = new Map([
    [rosterPath, fixtureRoster],
    [
      "users/active-1",
      {
        role: "student",
        studentName: "가학생",
        studentGrade: "3",
        studentClass: "1",
        studentNumber: "1",
        enrollmentStatus: "active",
      },
    ],
    [
      "users/active-1/performance_scores/roster",
      { ...original, objectionPending: true },
    ],
    [
      "users/active-1/performance_scores/roster/confirmations/active-1",
      { signatureImage: "signature" },
    ],
  ]);
  const writes = [];
  const toasts = [];
  Object.assign(context, {
    selectedScoreRoster: fixtureRoster,
    scoreListReady: true,
    scoreEditing: true,
    savingScoreEdits: false,
    scoreEditOriginalRecords: [original],
    scoreListRecords: [updated],
    db: {},
    rosterCollectionPath: "years/2026/semesters/2/performance_score_rosters",
    currentUser: { uid: "teacher", email: "teacher@example.invalid" },
    year: "2026",
    semester: "2",
    managerCopy: { scoreKindLabel: "수행평가" },
    doc: (...parts) => ({
      path: parts
        .flatMap((part) =>
          typeof part === "string" ? [part] : part.path ? [part.path] : [],
        )
        .join("/"),
    }),
    serverTimestamp: () => "server-now",
    deleteField: () => "__delete_field__",
    isActiveRosterStudent: (data) => data.enrollmentStatus === "active",
    isStudentRosterProfile: (data) => data.role === "student",
    showToast: (toast) => toasts.push(toast),
    confirm: async () => true,
    runTransaction: async (_db, cb) =>
      cb({
        get: async (ref) => ({
          exists: () => snapshots.has(ref.path),
          data: () => snapshots.get(ref.path),
          id: ref.path.split("/").at(-1),
        }),
        update: (ref, data) =>
          writes.push({ type: "update", path: ref.path, data }),
        set: (ref, data, options) =>
          writes.push({ type: "set", path: ref.path, data, options }),
        delete: (ref) => writes.push({ type: "delete", path: ref.path }),
      }),
    invalidateRosterReadCaches: () => {},
    loadScoreRecordsForRoster: async () => [],
  });
  for (const setter of [
    "setSavingScoreEdits",
    "setScoreEditing",
    "setScoreEditOriginalRecords",
    "setRosters",
    "setScoreListRecords",
    "setScoreStatsRecords",
    "setScoreStatsLoadedRosterId",
    "setScoreListSummaryStudents",
    "setScoreListSummaryLoadedKey",
    "setClassSheetPreviewStudents",
    "setClassSheetPreviewLoadedKey",
    "setScoreListLoadedRosterId",
  ])
    context[setter] = () => {};
  await subject.saveScoreListEdits();
  assert.equal(toasts.at(-1)?.tone, "success", JSON.stringify(toasts));
  assert.equal(writes.filter((w) => w.type === "update").length, 1);
  const storedRoster = writes.find((w) => w.type === "update").data;
  assert.equal(
    storedRoster.rows.find((r) => r.uid === "excluded-9").totalScore,
    15,
  );
  assert.equal(
    storedRoster.rows.find((r) => r.uid === "active-1").totalScore,
    18,
  );
  assert.equal(writes.filter((w) => w.type === "delete").length, 1);
  assert.equal(
    writes.find((w) => w.type === "delete").path,
    "users/active-1/performance_scores/roster/confirmations/active-1",
  );
  const scoreWrite = writes.find((w) => w.type === "set");
  assert.equal(scoreWrite.options.merge, true);
  assert.equal(scoreWrite.data.signatureImage, "__delete_field__");
  assert.equal(scoreWrite.data.studentName, "가학생");
  assert.equal("objectionPending" in scoreWrite.data, false);
  toasts.length = 0;
  context.loadScoreRecordsForRoster = async () => {
    throw new Error("read failed");
  };
  await subject.saveScoreListEdits();
  assert.equal(toasts.at(-1)?.tone, "warning");
  assert.match(toasts.at(-1)?.title, /점수는 저장/);
  context.loadScoreRecordsForRoster = async () => [];
  writes.length = 0;
  toasts.length = 0;
  snapshots.set("users/active-1", {
    ...snapshots.get("users/active-1"),
    enrollmentStatus: "transferred",
  });
  await subject.saveScoreListEdits();
  assert.equal(writes.length, 0);
  assert.equal(toasts.at(-1)?.tone, "error");
  snapshots.set("users/active-1", {
    ...snapshots.get("users/active-1"),
    enrollmentStatus: "active",
  });
  snapshots.set("users/active-1/performance_scores/roster", {
    ...original,
    items: original.items.map((item) => ({ ...item, score: 19 })),
    totalScore: 19,
  });
  toasts.length = 0;
  await subject.saveScoreListEdits();
  assert.equal(writes.length, 0);
  assert.equal(toasts.at(-1)?.tone, "error");
  console.log(
    "PASS score transaction checks: untouched/excluded rows preserved, scores editable, signature cleared, pending objection preserved by merge, canonical name, inactive save rejected, concurrent score save rejected.",
  );
})();

// A roster timestamp can advance when another student's score changes. Reading the
// unchanged student's score document must keep that student's valid confirmation.
Object.assign(context, {
  loadStudents: async () => active,
  isWrittenExamObjectiveRoster: () => false,
  loadScoreDocumentRecordsForRoster: async () => [
    {
      ...subject.buildScoreListRecordsFromRosterRows(roster)[0],
      academicStatus: "전출",
      isTransferred: true,
      transferStatus: "transferred",
      updatedAt: { seconds: 100, nanoseconds: 0 },
      scoreDocumentExists: true,
    },
  ],
  loadPerformanceScoreConfirmationsForRoster: async () =>
    new Map([
      [
        "active-1",
        {
          uid: "active-1",
          rosterId: "roster",
          signatureImage: "signature",
          scoreUpdatedAt: { seconds: 100, nanoseconds: 0 },
          confirmedAt: { seconds: 110, nanoseconds: 0 },
        },
      ],
    ]),
});
vm.runInContext(
  ts.transpileModule(
    `this.loadScoreRecordsActual = ${loadScoreRecordsClosure};`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.None,
      },
    },
  ).outputText,
  context,
);
const loadedWithSignature = await context.loadScoreRecordsActual(
  { ...roster, updatedAt: { seconds: 200, nanoseconds: 0 } },
  { includeStudentDocuments: true },
);
assert.equal(
  loadedWithSignature.find((record) => record.uid === "active-1")
    .signatureImage,
  "signature",
);
assert.equal(
  loadedWithSignature.some((record) => record.uid === "excluded-9"),
  false,
);
assert.equal(
  subject.getAcademicStatusLabel(
    loadedWithSignature.find((record) => record.uid === "active-1"),
  ),
  "",
);
assert.equal(
  loadedWithSignature.find((record) => record.uid === "active-1").totalScore,
  15,
);
console.log(
  "PASS live-read confirmation check: score document version survives unrelated roster updates.",
);

const storedMovedRecord = subject
  .buildScoreListRecordsFromRosterRows(roster)
  .find((record) => record.uid === "moved-3");
context.loadScoreDocumentRecordsForRoster = async () => [
  { ...storedMovedRecord, updatedAt: { seconds: 100, nanoseconds: 0 } },
];
context.loadPerformanceScoreConfirmationsForRoster = async () =>
  new Map([
    [
      "moved-3",
      {
        uid: "moved-3",
        rosterId: "roster",
        signatureImage: "moved-student-signature",
        scoreUpdatedAt: { seconds: 100, nanoseconds: 0 },
        confirmedAt: { seconds: 110, nanoseconds: 0 },
      },
    ],
  ]);
vm.runInContext(
  ts.transpileModule(
    `this.loadClassRecordsActual = ${loadClassRecordsClosure};`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.None,
      },
    },
  ).outputText,
  context,
);
const oldClass = await context.loadClassRecordsActual(roster, "1", "3");
const movedClass = await context.loadClassRecordsActual(roster, "2", "3");
assert.equal(
  oldClass.some((record) => record.uid === "moved-3"),
  false,
);
const movedStudent = movedClass.find((record) => record.uid === "moved-3");
assert.equal(movedStudent.class, "2");
assert.equal(movedStudent.studentName, "다학생");
assert.equal(movedStudent.totalScore, 15);
assert.equal(movedStudent.signatureImage, "moved-student-signature");
assert.equal(JSON.stringify(roster), before);
console.log(
  "PASS class export read: current roster identity/class overrides old score snapshots without rewriting score or signature history.",
);
context.loadPerformanceScoreConfirmationsForRoster = async () => {
  throw new Error("confirmation query denied");
};
context.loadPerformanceScoreConfirmation = async (_uid, _rosterId, options) => {
  assert.equal(options?.throwOnError, true);
  throw new Error("confirmation read denied");
};
await assert.rejects(
  () => context.loadClassRecordsActual(roster, "2", "3"),
  /confirmation read denied/,
);
console.log(
  "PASS confirmation read failure: class export requires successful signature reads and never treats read errors as unsigned.",
);
