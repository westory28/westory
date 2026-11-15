import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash, webcrypto } from "node:crypto";
import ts from "typescript";

// Execute the checked-in save closure and its pure dependencies. All documents
// below are synthetic; this script has no Firebase/network imports.
const definitions = new Map();
let previewInitializer;
for (const file of [
  "src/lib/studentRegistrationStatus.ts",
  "src/lib/studentRoster.ts",
  "src/lib/performanceScores.ts",
  "src/lib/writtenExamScoreIdentity.ts",
  "src/pages/teacher/components/PerformanceScoreManager.tsx",
]) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  for (const node of source.statements) {
    if (ts.isVariableStatement(node))
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer)
          definitions.set(declaration.name.text, {
            code: "const " + declaration.getText(source) + ";",
            node: declaration.initializer,
          });
      }
  }
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (node.name.text === "saveParsedScores")
        definitions.set(node.name.text, {
          code: "const " + node.getText(source) + ";",
          node: node.initializer,
        });
      if (node.name.text === "existingAssessment")
        previewInitializer = node.initializer.getText(source);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
const collected = new Map();
function collect(name) {
  if (collected.has(name) || !definitions.has(name)) return;
  const entry = definitions.get(name);
  collected.set(name, entry.code);
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text !== name) collect(node.text);
    ts.forEachChild(node, visit);
  };
  visit(entry.node);
}
const targets = [
  "saveParsedScores",
  "getWrittenExamScoreContentKind",
  "isSameWrittenExamScoreAssessment",
  "assertWrittenExamScoreAssessmentCompatible",
];
targets.forEach(collect);
const code = ts.transpileModule(
  [...collected.values()].join("\n") + `\nthis.api={${targets.join(",")}};`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  },
).outputText;
const base = {
  title: "2026학년도 2학기 3학년 2차 정기시험 역사과",
  subject: "역사",
  targetGrade: "3",
  academicYear: "2026",
  semester: "2",
  scoreKind: "written_exam_essay",
};
const rosterPath = "years/2026/semesters/2/performance_score_rosters";
const students = Array.from({ length: 285 }, (_, i) => ({
  uid: `synthetic-${i + 1}`,
  name: `가상학생${i + 1}`,
  grade: "3",
  class: String(Math.floor(i / 32) + 1),
  number: String((i % 32) + 1),
  email: "",
  role: "student",
  enrollmentStatus: "active",
}));
const essayItem = {
  name: "논술형 1",
  maxScore: 20,
  score: 10,
  scoreEntered: true,
};
const row = (student, items) => ({
  uid: student.uid,
  rowNumber: Number(student.uid.split("-").at(-1)),
  rowKey: student.uid,
  grade: student.grade,
  class: student.class,
  number: student.number,
  studentName: student.name,
  items,
  enteredScoreCount: items.length,
  totalScore: items.reduce((sum, item) => sum + item.score, 0),
  totalMaxScore: items.reduce((sum, item) => sum + item.maxScore, 0),
  matchStatus: "matched",
  academicStatus: "",
  matchMessage: "",
  feedback: "",
});
const legacyId = "legacy-essay-original-id";
const legacyEssay = {
  ...base,
  id: legacyId,
  items: [{ name: essayItem.name, maxScore: 20 }],
  rows: students.map((student) => row(student, [essayItem])),
  rowCount: 285,
  totalMaxScore: 20,
  sourceFileName: "synthetic-essay.xlsx",
  createdAt: { seconds: 1 },
  updatedAt: { seconds: 1 },
};
const objectiveItems = Array.from({ length: 21 }, (_, i) => ({
  name: `서답형 ${i + 1}`,
  examSection: "objective",
  questionNumber: i + 1,
  correctAnswer: "2",
  studentAnswer: "2",
  maxScore: 4,
  score: 4,
  scoreEntered: true,
}));
const uploadFor = (kind, count = 284) => ({
  ...base,
  format: "written-exam",
  scoreContentKind: kind,
  sourceFileName: "synthetic.xlsx",
  items:
    kind === "objective"
      ? objectiveItems
      : [{ ...essayItem, examSection: "essay" }],
  rows: students
    .slice(0, count)
    .map((student) =>
      row(
        student,
        kind === "objective"
          ? objectiveItems
          : [{ ...essayItem, examSection: "essay" }],
      ),
    ),
  totalMaxScore: kind === "objective" ? 84 : 20,
});
function harness(initial = [legacyEssay], isWrittenExamMode = true) {
  const docs = new Map();
  const writes = [],
    reads = [],
    toasts = [];
  for (const student of students)
    docs.set(`users/${student.uid}`, { ...student, studentName: student.name });
  for (const roster of initial) {
    docs.set(`${rosterPath}/${roster.id}`, structuredClone(roster));
    for (const entry of roster.rows) {
      docs.set(`users/${entry.uid}/performance_scores/${roster.id}`, {
        ...base,
        ...entry,
        rosterId: roster.id,
        signatureName: "합성 서명",
        signatureImage: "synthetic-signature",
        signedAt: { seconds: 1 },
      });
      docs.set(
        `users/${entry.uid}/performance_scores/${roster.id}/confirmations/${entry.uid}`,
        { confirmed: true, synthetic: true },
      );
    }
  }
  const context = {
    console,
    TextEncoder,
    crypto: webcrypto,
    Blob,
    parsed: null,
    saving: false,
    editingUploadMaximums: false,
    isWrittenExamMode,
    isSinglePerformanceUpload: false,
    year: "2026",
    semester: "2",
    activeScoreKind: isWrittenExamMode ? "written_exam_essay" : "performance",
    title: base.title,
    subject: base.subject,
    rosters: structuredClone(initial),
    rosterCollectionPath: rosterPath,
    db: {},
    currentUser: { uid: "synthetic-teacher", email: "teacher@example.test" },
    loadStudents: async () => students,
    confirm: async () => false,
    doc: (_db, ...segments) => ({
      path: segments.join("/"),
      id: segments.at(-1),
    }),
    serverTimestamp: () => ({ seconds: 20 }),
    deleteField: () => ({ deleted: true }),
    setRosters: (updater) => {
      context.rosters = updater(context.rosters);
    },
    setParsed: (value) => {
      context.parsed = value;
    },
    showToast: (toast) => toasts.push(toast),
    invalidateRosterReadCaches: () => {},
    getFirestoreWriteErrorMessage: (error) => String(error),
    runTransaction: async (_db, action) => {
      if (context.beforeTransaction) {
        const hook = context.beforeTransaction;
        context.beforeTransaction = null;
        hook(docs);
      }
      const pending = [];
      const result = await action({
        get: async (reference) => {
          reads.push(reference.path);
          return {
            id: reference.id,
            exists: () => docs.has(reference.path),
            data: () => docs.get(reference.path),
          };
        },
        set: (reference, payload, options) =>
          pending.push({
            path: reference.path,
            payload: structuredClone(payload),
            options,
          }),
      });
      for (const entry of pending) {
        docs.set(
          entry.path,
          entry.options?.merge
            ? { ...docs.get(entry.path), ...entry.payload }
            : entry.payload,
        );
        writes.push(entry);
      }
      return result;
    },
  };
  for (const name of [
    "setSaving",
    "setScoreListRosterId",
    "setScoreListLoadedRosterId",
    "setScoreListRecords",
    "setScoreListLoadError",
    "setScoreEditing",
    "setScoreEditOriginalRecords",
    "setScoreListSummaryStudents",
    "setScoreListSummaryLoadedKey",
  ])
    context[name] = () => {};
  vm.createContext(context);
  vm.runInContext(code, context);
  return {
    context,
    docs,
    writes,
    reads,
    toasts,
    async save(upload) {
      context.parsed = structuredClone(upload);
      context.title = upload.title;
      context.subject = upload.subject;
      await context.api.saveParsedScores();
    },
  };
}

const h = harness();
const kind = h.context.api.getWrittenExamScoreContentKind;
assert.equal(kind(legacyEssay), "essay");
assert.equal(
  kind({
    items: [{ questionNumber: null, correctAnswer: "", answerChoices: [] }],
  }),
  "essay",
);
assert.equal(kind({ items: [{ examSection: "objective" }] }), "objective");
assert.equal(
  kind({ items: [{ questionNumber: 1, correctAnswer: "2" }] }),
  "objective",
);
assert.equal(
  kind({ items: [{ examSection: "objective" }, essayItem] }),
  "mixed",
);
assert.equal(
  kind({ scoreContentKind: "objective", items: [essayItem] }),
  "objective",
);
assert.equal(
  kind({ scoreContentKind: "essay", items: [{ examSection: "objective" }] }),
  "mixed",
);
const protectedBefore = JSON.stringify(
  [...h.docs].filter(([key]) => key.includes(legacyId)),
);
await h.save(uploadFor("objective"));
assert.equal(h.toasts.at(-1).tone, "success", h.toasts.at(-1).message);
const objectiveRoster = h.context.rosters.find(
  (roster) => roster.scoreContentKind === "objective",
);
assert.ok(objectiveRoster);
assert.notEqual(objectiveRoster.id, legacyId);
assert.equal(objectiveRoster.rowCount, 284);
assert.equal(h.writes.length, 285, "One new roster and 284 score documents");
assert.equal(
  JSON.stringify([...h.docs].filter(([key]) => key.includes(legacyId))),
  protectedBefore,
  "Existing 285-person essay roster, grades and signatures stay byte-identical",
);
const firstId = objectiveRoster.id;
h.writes.length = 0;
await h.save(uploadFor("objective"));
assert.equal(h.toasts.at(-1).tone, "success", h.toasts.at(-1).message);
assert.equal(
  h.context.rosters.find((roster) => roster.scoreContentKind === "objective")
    .id,
  firstId,
);
assert.equal(
  h.writes.length,
  1,
  "Unchanged reupload writes only its roster, no duplicate score writes",
);
assert.equal(
  JSON.stringify([...h.docs].filter(([key]) => key.includes(legacyId))),
  protectedBefore,
);
Object.assign(h.context, {
  assessmentConfig: base,
  parsedUpload: uploadFor("objective"),
});
const previewCode = ts.transpileModule(
  `this.preview = ${previewInitializer};`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  },
).outputText;
vm.runInContext(previewCode, h.context);
assert.equal(
  h.context.preview.id,
  firstId,
  "Real handleUpload selects the same-kind existing assessment",
);
const oldObjective = {
  ...structuredClone(objectiveRoster),
  id: "objective-before-kind-key",
};
const old = harness([legacyEssay, oldObjective]);
await old.save(uploadFor("objective"));
assert.equal(
  old.context.rosters.find((roster) => roster.scoreContentKind === "objective")
    .id,
  oldObjective.id,
  "Existing objective IDs survive the hash-key change",
);
const essay = harness();
await essay.save(uploadFor("essay", 285));
assert.equal(essay.toasts.at(-1).tone, "success", essay.toasts.at(-1).message);
assert.equal(
  essay.context.rosters[0].id,
  legacyId,
  "Tagged essay reuploads reuse the legacy untagged essay ID",
);
const mixed = harness([{ ...legacyEssay, scoreContentKind: "mixed" }]);
await mixed.save(uploadFor("objective"));
assert.equal(mixed.writes.length, 0);
assert.match(mixed.toasts.at(-1).message, /섞인 점수표/);
const stale = harness([oldObjective]);
stale.context.beforeTransaction = (docs) =>
  docs.set(`${rosterPath}/${oldObjective.id}`, {
    ...legacyEssay,
    id: oldObjective.id,
  });
await stale.save(uploadFor("objective"));
assert.equal(stale.writes.length, 0);
assert.match(stale.toasts.at(-1).message, /종류가 변경/);
const performanceUpload = {
  ...uploadFor("essay", 2),
  scoreKind: "performance",
  scoreContentKind: "performance",
};
const performance = harness([], false);
await performance.save(performanceUpload);
assert.equal(
  performance.toasts.at(-1).tone,
  "success",
  performance.toasts.at(-1).message,
);
const previousPerformanceKey = `score-${createHash("sha256").update(`2026|2|performance|3|역사|${base.title}`).digest("hex").slice(0, 40)}`;
assert.equal(
  performance.context.rosters[0].id,
  previousPerformanceKey,
  "Performance assessment key remains unchanged",
);
assert.ok(
  h.reads.every(
    (path) => path.startsWith("users/") || path.startsWith(rosterPath + "/"),
  ),
);
console.log(
  JSON.stringify(
    {
      result: "passed",
      classifierChecks: 7,
      actualSaveCases: 7,
      actualUploadSelection: true,
      firstSaveWrites: 285,
      unchangedReuploadWrites: 1,
      essayStudentsPreserved: 285,
      objectiveStudents: 284,
      objectiveItems: 21,
      productionWrites: 0,
    },
    null,
    2,
  ),
);
