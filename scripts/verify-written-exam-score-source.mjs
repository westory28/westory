// Synthetic-only source/store contract checks. No Firebase or external requests.
import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";

const config = { year: "2026", semester: "2" };
const examId = "synthetic-exam";
const root = "years/2026/semesters/2";
const rosterPath = `${root}/performance_score_rosters/${examId}`;
const materialPath = `${root}/written_exam_analyses/${examId}`;
const scorePath = (uid) => `users/${uid}/performance_scores/${examId}`;
const copy = (value) =>
  value === undefined ? undefined : structuredClone(value);
const h = {
  docs: new Map(),
  reads: [],
  writes: [],
  rest: [],
  blobs: new Map(),
  serial: 0,
};
const account = {
  uid: "synthetic-teacher",
  getIdToken: async () => "synthetic-only-id-token",
};
const auth = { currentUser: account };
const db = { app: { options: { projectId: "demo-westory-score-source" } } };
const refPath = (...parts) => {
  const first = parts.shift();
  const path = [first?.path, ...parts].filter(Boolean).join("/");
  return { path, id: path.split("/").at(-1) };
};
const snapshot = (ref) => {
  const data = copy(h.docs.get(ref.path));
  return {
    id: ref.id,
    exists: () => data !== undefined,
    data: () => copy(data),
  };
};
const firestore = {
  doc: (...parts) => {
    if (parts.length === 1) parts.push(`revision-${++h.serial}`);
    return refPath(...parts);
  },
  collection: refPath,
  getDocFromServer: async (ref) => {
    h.reads.push(ref.path);
    if (h.failRead === ref.path) throw new Error("injected read failure");
    const result = snapshot(ref);
    if (h.afterServerRead) {
      const action = h.afterServerRead;
      h.afterServerRead = null;
      await action();
    }
    return result;
  },
  setDoc: async (ref, data) => {
    h.writes.push({ kind: "set", path: ref.path, data: copy(data) });
    h.docs.set(ref.path, copy(data));
    if (h.afterStageWrite) {
      const action = h.afterStageWrite;
      h.afterStageWrite = null;
      await action();
    }
  },
  deleteDoc: async (ref) => {
    h.writes.push({ kind: "delete", path: ref.path });
    h.docs.delete(ref.path);
  },
  serverTimestamp: () => "synthetic-server-time",
  writeBatch: () => ({
    set: (ref, data) => {
      h.writes.push({ kind: "batch", path: ref.path, data: copy(data) });
    },
    commit: async () => {
      h.writes.push({ kind: "batch-commit" });
    },
  }),
  runTransaction: async (_db, callback) => {
    if (h.beforeTransaction) {
      const action = h.beforeTransaction;
      h.beforeTransaction = null;
      await action();
    }
    const pending = [];
    const result = await callback({
      get: async (ref) => {
        h.reads.push(ref.path);
        return snapshot(ref);
      },
      update: (ref, data) =>
        pending.push({ kind: "update", path: ref.path, data: copy(data) }),
      set: (ref, data) =>
        pending.push({ kind: "set", path: ref.path, data: copy(data) }),
    });
    for (const entry of pending) {
      h.writes.push(entry);
      h.docs.set(
        entry.path,
        entry.kind === "update"
          ? { ...h.docs.get(entry.path), ...entry.data }
          : entry.data,
      );
    }
    return result;
  },
};
const assets = {
  uploadWrittenExamAsset: async (path, blob) => {
    if (h.failUpload) throw new Error("injected upload failure");
    h.blobs.set(path, blob);
    h.writes.push({ kind: "upload", path });
  },
  readWrittenExamAsset: async (path) => {
    const blob = h.blobs.get(path);
    if (!blob) throw new Error("injected missing asset");
    return blob;
  },
  removeWrittenExamAsset: async (path) => {
    h.blobs.delete(path);
  },
};
const encode = (value) => {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return { integerValue: String(value) };
  if (typeof value === "boolean") return { booleanValue: value };
  if (Array.isArray(value))
    return { arrayValue: { values: value.map(encode) } };
  if (value && typeof value === "object")
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, encode(item)]),
        ),
      },
    };
  return { nullValue: null };
};
const fetchMock = async (url, options) => {
  const body = JSON.parse(options.body);
  h.rest.push({ url, options, body });
  if (h.switchAccount)
    auth.currentUser = { ...account, uid: "different-teacher" };
  if (h.failFetch) return { ok: false, json: async () => ({}) };
  if (url.endsWith(":batchGet")) {
    const entries = body.documents.map((name) => {
      const path = name.split("/documents/")[1];
      h.reads.push(path);
      if (h.failRead === path) throw new Error("injected read failure");
      const value = h.docs.get(path);
      return value
        ? {
            found: {
              name,
              fields: Object.fromEntries(
                body.mask.fieldPaths
                  .filter((field) => value[field] !== undefined)
                  .map((field) => [field, encode(value[field])]),
              ),
            },
          }
        : { missing: name };
    });
    if (h.mutateBatch) h.mutateBatch(entries);
    if (h.pauseBatch) await h.pauseBatch();
    return { ok: true, json: async () => entries.reverse() };
  }
  const source = h.docs.get(rosterPath);
  return {
    ok: true,
    json: async () =>
      source
        ? [
            {
              document: {
                name: `projects/demo-westory-score-source/databases/(default)/documents/${rosterPath}`,
                fields: Object.fromEntries(
                  body.structuredQuery.select.fields
                    .filter(({ fieldPath }) => source[fieldPath] !== undefined)
                    .map(({ fieldPath }) => [
                      fieldPath,
                      encode(source[fieldPath]),
                    ]),
                ),
              },
            },
          ]
        : [{ readTime: "2026-11-14T00:00:00Z" }],
  };
};
const built = await build({
  entryPoints: ["src/lib/writtenExamScoreSource.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  define: { "import.meta.env": "{}" },
  external: ["firebase/firestore", "firebase/storage"],
  plugins: [
    {
      name: "synthetic-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /^\.\/firebase$/ }, () => ({
          path: "firebase",
          namespace: "synthetic",
        }));
        builder.onResolve({ filter: /^\.\/semesterArchive$/ }, () => ({
          path: "archive",
          namespace: "synthetic",
        }));
        builder.onResolve({ filter: /^\.\/writtenExamAssets$/ }, () => ({
          path: "assets",
          namespace: "synthetic",
        }));
        builder.onResolve({ filter: /^\.\/appCheck$/ }, () => ({
          path: "app-check",
          namespace: "synthetic",
        }));
        builder.onLoad(
          { filter: /.*/, namespace: "synthetic" },
          ({ path }) => ({
            contents:
              path === "app-check"
                ? "export const getWestoryAppCheckToken=async()=> 'synthetic-app-check-token';"
                : path === "assets"
                  ? "export const {uploadWrittenExamAsset,readWrittenExamAsset,removeWrittenExamAsset}=globalThis.fixture.assets;"
                  : path === "firebase"
                    ? "export const auth=globalThis.fixture.auth;export const db=globalThis.fixture.db;export const getFirebaseStorage=async()=>({});"
                    : "export const isSemesterArchive=false;export const archiveScope=null;export const assertArchiveWritable=()=>{};",
          }),
        );
      },
    },
  ],
});
const module = { exports: {} };
vm.runInNewContext(built.outputFiles[0].text, {
  module,
  exports: module.exports,
  console,
  fixture: { auth, db, assets },
  fetch: fetchMock,
  require: (name) => {
    if (name === "firebase/firestore") return firestore;
    throw new Error(`Unexpected dependency: ${name}`);
  },
  AbortController,
  setTimeout,
  clearTimeout,
  TextEncoder,
  Blob,
});
const api = module.exports;
const questionItems = [1, 2].map((number) => ({
  name: `${number}번`,
  itemKey: `objective-${number}`,
  examSection: "objective",
  questionNumber: number,
  correctAnswer: String(number),
  maxScore: number === 1 ? 4 : 6,
  answerChoices: ["1", "2", "3", "4", "5"],
}));
const row = (uid, room, number, entered = true) => ({
  uid,
  grade: "3",
  class: room,
  number,
  studentName: `합성 ${uid}`,
  rowNumber: Number(number),
  items: [],
  enteredScoreCount: entered ? 2 : 0,
  totalScore: entered ? 10 : 0,
  totalMaxScore: 10,
  matchStatus: "matched",
});
const initialRows = [
  row("a", "1", "1"),
  row("b", "1", "2"),
  row("absent", "1", "3", false),
  row("c", "2", "1"),
];
const score = (student, zero = false) => ({
  ...student,
  rosterId: examId,
  academicYear: "2026",
  semester: "2",
  scoreKind: "written_exam_essay",
  scoreContentKind: "objective",
  totalScore: zero ? 0 : 10,
  items: questionItems.map((item) => ({
    ...item,
    scoreEntered: true,
    score: zero ? 0 : item.maxScore,
    studentAnswer: zero ? "" : item.correctAnswer,
    answerCorrect: !zero,
    answerStatus: zero ? "blank" : "correct",
  })),
});
const reset = () => {
  h.docs = new Map();
  h.reads = [];
  h.writes = [];
  h.rest = [];
  h.blobs = new Map();
  h.failRead = null;
  h.failFetch = false;
  h.switchAccount = false;
  h.failUpload = false;
  h.beforeTransaction = null;
  h.afterServerRead = null;
  h.afterStageWrite = null;
  h.mutateBatch = null;
  h.pauseBatch = null;
  auth.currentUser = account;
  h.docs.set(rosterPath, {
    id: examId,
    scoreKind: "written_exam_essay",
    scoreContentKind: "objective",
    academicYear: "2026",
    semester: "2",
    targetGrade: "3",
    targetClass: "",
    title: "합성 점수표",
    subject: "역사",
    classes: ["1", "2"],
    rowCount: 4,
    rows: copy(initialRows),
    items: copy(questionItems),
    totalMaxScore: 10,
    updatedAt: "synthetic-time",
  });
  for (const student of initialRows.filter((item) => item.uid !== "absent"))
    h.docs.set(scorePath(student.uid), score(student, student.uid === "b"));
};
const mutateScore = (uid, change) => change(h.docs.get(scorePath(uid)));
const results = [];
const check = async (name, callback) => {
  reset();
  try {
    await callback();
    results.push({ name, pass: true });
  } catch (error) {
    results.push({ name, pass: false, error: String(error.message) });
  }
};
await check(
  "list: scoped REST select, scoreKind server filter, no limit/rows, Firebase ID token",
  async () => {
    const sources = await api.listWrittenExamScoreSources(config);
    assert.equal(sources.length, 1);
    assert.equal("rows" in sources[0], false);
    assert.equal(h.reads.length, 0);
    assert.equal(h.rest.length, 1);
    const request = h.rest[0],
      query = request.body.structuredQuery;
    assert.match(request.url, /\/years\/2026\/semesters\/2:runQuery$/);
    assert.equal(
      request.options.headers.Authorization,
      "Bearer synthetic-only-id-token",
    );
    assert.equal(request.options.cache, "no-store");
    assert.equal(
      request.options.headers["X-Firebase-AppCheck"],
      "synthetic-app-check-token",
    );
    assert.equal(query.where.fieldFilter.field.fieldPath, "scoreKind");
    assert.equal(
      query.where.fieldFilter.value.stringValue,
      "written_exam_essay",
    );
    assert.equal("limit" in query, false);
    assert.equal("offset" in query, false);
    assert.ok(query.select.fields.some((field) => field.fieldPath === "items"));
    for (const field of ["rows", "studentName", "signatureImage", "feedback"])
      assert.ok(
        !query.select.fields.some((entry) => entry.fieldPath === field),
      );
  },
);
await check(
  "list: signed-out, account switch, and server failure reject",
  async () => {
    auth.currentUser = null;
    await assert.rejects(api.listWrittenExamScoreSources(config));
    auth.currentUser = account;
    h.switchAccount = true;
    await assert.rejects(api.listWrittenExamScoreSources(config), /사용자/);
    auth.currentUser = account;
    h.switchAccount = false;
    h.failFetch = true;
    await assert.rejects(api.listWrittenExamScoreSources(config));
  },
);
await check(
  "two class refreshes: fresh selected UID docs, zero retained, absent omitted, answer changes reflected",
  async () => {
    for (let iteration = 0; iteration < 2; iteration++) {
      if (iteration)
        mutateScore("a", (value) => {
          value.items[0] = {
            ...value.items[0],
            studentAnswer: "5",
            answerCorrect: false,
            answerStatus: "incorrect",
            score: 0,
          };
          value.totalScore = 6;
          value.feedback = "최신 교사 피드백";
          value.evidence = "최신 근거";
          // The normal edit transaction updates the ledger and score record together.
          const ledgerRow = h.docs
            .get(rosterPath)
            .rows.find((row) => row.uid === "a");
          ledgerRow.feedback = value.feedback;
          ledgerRow.evidence = value.evidence;
        });
      await api.listWrittenExamScoreSources(config);
      const data = await api.loadWrittenExamScoreAnalysis(config, examId, {
        classId: "3-1",
      });
      assert.deepEqual(
        Array.from(data.students, (item) => item.uid),
        ["a", "b"],
      );
      assert.equal(data.students[1].totalScore, 0);
      assert.equal(data.students[0].responses[0].answer, iteration ? "5" : "1");
      assert.equal(data.students[0].totalScore, iteration ? 6 : 10);
      assert.equal(data.scoreRows.length, 3);
      assert.equal(data.scoreItems.length, questionItems.length);
      if (iteration) {
        assert.equal(data.scoreRows[0].feedback, "최신 교사 피드백");
        assert.equal(data.scoreRows[0].evidence, "최신 근거");
      }
    }
    assert.equal(
      h.rest.filter((entry) => entry.url.endsWith(":runQuery")).length,
      2,
    );
    assert.equal(
      h.rest.filter((entry) => entry.url.endsWith(":batchGet")).length,
      2,
    );
    assert.equal(h.reads.length, 10);
    assert.equal(h.reads.filter((path) => path === rosterPath).length, 2);
    assert.equal(h.reads.filter((path) => path === materialPath).length, 2);
    for (const uid of ["a", "b", "absent"])
      assert.equal(h.reads.filter((path) => path === scorePath(uid)).length, 2);
    assert.ok(!h.reads.includes(scorePath("c")));
    assert.equal(h.writes.length, 0);
  },
);
await check(
  "whole grade: all classes and only linked UID documents read",
  async () => {
    const data = await api.loadWrittenExamScoreAnalysis(config, examId);
    assert.deepEqual(
      Array.from(data.students, (item) => item.uid),
      ["a", "b", "c"],
    );
    assert.equal(h.reads.length, 6);
    assert.equal(data.metadata.studentCount, 3);
  },
);
await check(
  "284 students: three parallel bounded batches replace 284 individual network requests without dropping documents",
  async () => {
    const rows = Array.from({ length: 284 }, (_, index) =>
      row(
        `large-${index}`,
        String((index % 9) + 1),
        String(Math.floor(index / 9) + 1),
      ),
    );
    const roster = h.docs.get(rosterPath);
    roster.rows = rows;
    roster.classes = Array.from({ length: 9 }, (_, i) => String(i + 1));
    roster.rowCount = rows.length;
    for (const student of rows)
      h.docs.set(scorePath(student.uid), score(student));
    const releases = [];
    h.pauseBatch = () => new Promise((resolve) => releases.push(resolve));
    const pending = api.loadWrittenExamScoreAnalysis(config, examId);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      releases.length,
      3,
      "All three batches start before any batch completes",
    );
    releases.forEach((resolve) => resolve());
    const data = await pending;
    assert.equal(data.students.length, 284);
    assert.equal(
      h.reads.length,
      286,
      "Billed document count remains unchanged",
    );
    const batches = h.rest.filter((entry) => entry.url.endsWith(":batchGet"));
    assert.deepEqual(
      batches.map((entry) => entry.body.documents.length),
      [100, 100, 84],
    );
    for (const entry of batches) {
      assert.equal(entry.options.cache, "no-store");
      assert.equal(
        entry.options.headers.Authorization,
        "Bearer synthetic-only-id-token",
      );
      assert.equal(
        entry.options.headers["X-Firebase-AppCheck"],
        "synthetic-app-check-token",
      );
      assert.ok(entry.body.mask.fieldPaths.includes("items"));
      for (const field of ["signatureImage", "feedback", "evidence", "email"])
        assert.ok(!entry.body.mask.fieldPaths.includes(field));
    }
    assert.equal(h.writes.length, 0);
  },
);
for (const [name, mutate] of [
  ["partial", (entries) => entries.pop()],
  ["duplicate", (entries) => entries.push(entries[0])],
  [
    "unexpected",
    (entries) =>
      entries.push({
        missing:
          "projects/other/databases/(default)/documents/users/other/performance_scores/other",
      }),
  ],
  [
    "stream error",
    (entries) => entries.push({ error: { status: "PERMISSION_DENIED" } }),
  ],
])
  await check(
    `batch ${name} response fails closed and fresh retry succeeds`,
    async () => {
      h.mutateBatch = mutate;
      await assert.rejects(
        api.loadWrittenExamScoreAnalysis(config, examId),
        /답안/,
      );
      h.mutateBatch = null;
      const result = await api.loadWrittenExamScoreAnalysis(config, examId);
      assert.equal(result.students.length, 3);
      assert.equal(h.writes.length, 0);
    },
  );
await check(
  "account replacement during a batched response rejects data",
  async () => {
    h.pauseBatch = async () => {
      auth.currentUser = { ...account, uid: "other" };
    };
    await assert.rejects(
      api.loadWrittenExamScoreAnalysis(config, examId),
      /사용자/,
    );
  },
);
await check(
  "NEIS multiple answers, circled choices and separators reuse the existing upload parser",
  async () => {
    const roster = h.docs.get(rosterPath);
    roster.items[0].correctAnswer = "B";
    for (const uid of ["a", "b", "c"])
      mutateScore(uid, (value) => {
        value.items[0].correctAnswer = "③,①";
        value.items[0].studentAnswer = uid === "a" ? "B" : "①";
      });
    const data = await api.loadWrittenExamScoreAnalysis(config, examId, {
      classId: "3-1",
    });
    assert.equal(data.metadata.questions[0].answer, "13");
    assert.equal(data.students[0].responses[0].answer, "13");
    const info = copy(data.metadata.questions);
    info[0].answer = "3,1";
    assert.equal(
      api.mergeScoreSourceQuestions(data.metadata.questions, info)[0].answer,
      "13",
    );
  },
);
await check(
  "legacy and tagged essay items load from the atomic roster, including actual zero, without migration",
  async () => {
    const roster = h.docs.get(rosterPath);
    delete roster.scoreContentKind;
    roster.items = [
      { name: "논술형", shortName: "논술형", maxScore: 10 },
      { name: "1-(1)", itemKey: "1-(1)", groupKey: "1", maxScore: 3 },
    ];
    for (const uid of ["a", "b", "c"])
      mutateScore(uid, (value) => {
        delete value.scoreContentKind;
        value.items = roster.items.map((item, index) => ({
          ...item,
          score: uid === "b" ? 0 : index + 1,
          scoreEntered: true,
          ...(index === 1 ? { examSection: "essay" } : {}),
        }));
      });
    roster.rows = roster.rows.map((row) => ({
      ...row,
      items: copy(h.docs.get(scorePath(row.uid))?.items || []),
    }));
    const data = await api.loadWrittenExamScoreAnalysis(config, examId, {
      classId: "3-1",
    });
    assert.equal(data.students.length, 0);
    assert.ok(data.scoreItems.every((item) => item.examSection === "essay"));
    assert.ok(
      data.scoreRows[0].items.every((item) => item.examSection === "essay"),
    );
    assert.equal(data.scoreRows[1].items[0].score, 0);
    assert.equal(data.scoreRows[1].items[0].scoreEntered, true);
    assert.equal(h.docs.get(rosterPath).items[0].examSection, undefined);
    assert.deepEqual(h.reads, [rosterPath]);
    assert.equal(h.writes.length, 0);
  },
);
const addEssayRows = () => {
  const roster = h.docs.get(rosterPath);
  const definition = {
    name: "1-(1)",
    itemKey: "1-(1)",
    examSection: "essay",
    maxScore: 4,
  };
  roster.scoreContentKind = "mixed";
  roster.items.push(definition);
  roster.rows = roster.rows.map((row) => ({
    ...row,
    items: [
      {
        ...definition,
        score: row.uid === "a" || row.uid === "c" ? 4 : 0,
        scoreEntered: row.uid !== "absent",
        feedback: `합성 항목 피드백 ${row.uid}`,
      },
    ],
    feedback: `합성 전체 피드백 ${row.uid}`,
  }));
  return roster;
};
await check(
  "objective results hydrate answers while essay rows retain the atomic roster snapshot",
  async () => {
    const roster = addEssayRows();
    mutateScore("a", (score) => {
      score.scoreContentKind = "mixed";
      score.items.push({
        ...roster.rows[0].items[0],
        score: 2,
        feedback: "다른 조회시점 학생문서 피드백",
      });
      score.feedback = "다른 조회시점 전체 피드백";
    });
    const data = await api.loadWrittenExamScoreAnalysis(config, examId, {
      analysisKind: "objective",
      classId: "3-1",
    });
    assert.equal(data.students[0].totalScore, 10);
    assert.equal(data.students[0].responses[0].answer, "1");
    assert.equal(data.scoreRows[0].items[0].score, 4);
    assert.equal(data.scoreRows[0].items[0].feedback, "합성 항목 피드백 a");
    assert.equal(data.scoreRows[0].feedback, "합성 전체 피드백 a");
    assert.equal(h.reads.length, 5);
    assert.equal(h.writes.length, 0);
  },
);
await check(
  "essay whole-grade analysis reads exactly one atomic roster and preserves every student",
  async () => {
    const roster = addEssayRows();
    h.failRead = materialPath;
    h.docs.delete(scorePath("a"));
    const data = await api.loadWrittenExamScoreAnalysis(config, examId, {
      analysisKind: "essay",
    });
    assert.deepEqual(h.reads, [rosterPath]);
    assert.equal(h.writes.length, 0);
    assert.deepEqual(
      Array.from(data.scoreRows, (row) => row.uid),
      ["a", "b", "absent", "c"],
    );
    assert.equal(data.metadata.studentCount, 4);
    assert.equal(data.students.length, 0);
    assert.equal(data.metadata.questions.length, 0);
    assert.equal(data.metadata.files.length, 0);
    assert.equal(data.scoreRows[0].feedback, roster.rows[0].feedback);
    assert.equal(data.scoreRows[1].items[0].score, 0);
    assert.equal(data.scoreRows[1].items[0].scoreEntered, true);
    assert.equal(data.scoreRows[2].items[0].scoreEntered, false);
  },
);
await check(
  "essay selected class refreshes use one server roster each and reflect current scores and feedback",
  async () => {
    const roster = addEssayRows();
    for (let iteration = 0; iteration < 2; iteration++) {
      if (iteration) {
        roster.rows[0].items[0].score = 2;
        roster.rows[0].feedback = "수정된 합성 교사 피드백";
        roster.updatedAt = "synthetic-new-version";
      }
      const data = await api.loadWrittenExamScoreAnalysis(config, examId, {
        analysisKind: "essay",
        classId: "3-1",
      });
      assert.deepEqual(
        Array.from(data.scoreRows, (row) => row.uid),
        ["a", "b", "absent"],
      );
      assert.equal(data.scoreRows[0].items[0].score, iteration ? 2 : 4);
      assert.equal(
        data.metadata.updatedAt,
        iteration ? "synthetic-new-version" : "synthetic-time",
      );
      if (iteration)
        assert.equal(data.scoreRows[0].feedback, "수정된 합성 교사 피드백");
    }
    assert.deepEqual(h.reads, [rosterPath, rosterPath]);
    assert.equal(h.writes.length, 0);
  },
);
await check(
  "objective tab without objective definitions reads neither paper nor student documents",
  async () => {
    const roster = addEssayRows();
    roster.scoreContentKind = "essay";
    roster.items = roster.items.filter((item) => item.examSection === "essay");
    const data = await api.loadWrittenExamScoreAnalysis(config, examId, {
      analysisKind: "objective",
    });
    assert.deepEqual(h.reads, [rosterPath]);
    assert.equal(h.writes.length, 0);
    assert.equal(data.hasObjectiveScores, false);
    assert.equal(data.students.length, 0);
    assert.equal(data.metadata.questions.length, 0);
    assert.equal(data.scoreRows.length, 4);
  },
);
await check(
  "essay mode retains semester, class, and complete-roster boundaries",
  async () => {
    const roster = addEssayRows();
    await assert.rejects(
      api.loadWrittenExamScoreAnalysis(config, examId, {
        analysisKind: "essay",
        classId: "3-9",
      }),
    );
    roster.semester = "1";
    await assert.rejects(
      api.loadWrittenExamScoreAnalysis(config, examId, {
        analysisKind: "essay",
      }),
    );
    roster.semester = "2";
    roster.rowCount++;
    await assert.rejects(
      api.loadWrittenExamScoreAnalysis(config, examId, {
        analysisKind: "essay",
      }),
    );
    assert.ok(h.reads.every((path) => path === rosterPath));
    assert.equal(h.writes.length, 0);
  },
);
await check(
  "foreign-semester roster is rejected before reading student score documents",
  async () => {
    h.docs.get(rosterPath).semester = "1";
    await assert.rejects(api.loadWrittenExamScoreAnalysis(config, examId));
    assert.ok(!h.reads.some((path) => path.startsWith("users/")));
  },
);
await check(
  "unlisted class is rejected before reading student score documents",
  async () => {
    await assert.rejects(
      api.loadWrittenExamScoreAnalysis(config, examId, { classId: "3-9" }),
    );
    assert.ok(!h.reads.some((path) => path.startsWith("users/")));
  },
);
await check(
  "duplicate UID outside selected class still rejects ambiguous roster",
  async () => {
    h.docs.get(rosterPath).rows[3].uid = "a";
    await assert.rejects(
      api.loadWrittenExamScoreAnalysis(config, examId, { classId: "3-1" }),
    );
  },
);
await check(
  "one student read failure rejects complete analysis instead of returning a partial class",
  async () => {
    h.failRead = scorePath("b");
    await assert.rejects(
      api.loadWrittenExamScoreAnalysis(config, examId, { classId: "3-1" }),
      /injected read failure/,
    );
  },
);
for (const [name, change] of [
  [
    "semester",
    (value) => {
      value.semester = "1";
    },
  ],
  [
    "year",
    (value) => {
      value.academicYear = "2025";
    },
  ],
  [
    "name",
    (value) => {
      value.studentName = "다른 합성 학생";
    },
  ],
  [
    "uid",
    (value) => {
      value.uid = "other";
    },
  ],
  [
    "roster",
    (value) => {
      value.rosterId = "other";
    },
  ],
  [
    "school number",
    (value) => {
      value.number = "9";
    },
  ],
  [
    "missing item",
    (value) => {
      value.items.pop();
    },
  ],
  [
    "empty scored items",
    (value) => {
      value.items = [];
    },
  ],
  [
    "duplicate question",
    (value) => {
      value.items[1] = copy(value.items[0]);
    },
  ],
  [
    "stale answer key",
    (value) => {
      value.items[0].correctAnswer = "5";
    },
  ],
  [
    "stale maximum",
    (value) => {
      value.items[0].maxScore = 5;
    },
  ],
  [
    "out of range score",
    (value) => {
      value.items[0].score = 99;
    },
  ],
  [
    "partial unentered item",
    (value) => {
      value.items[1].scoreEntered = false;
    },
  ],
])
  await check(`reject score ${name}`, async () => {
    mutateScore("a", change);
    await assert.rejects(
      api.loadWrittenExamScoreAnalysis(config, examId, { classId: "3-1" }),
    );
  });
await check(
  "missing registered score document fails; missing nonparticipant document does not",
  async () => {
    h.docs.delete(scorePath("a"));
    await assert.rejects(api.loadWrittenExamScoreAnalysis(config, examId));
  },
);
await check(
  "registered but unlinked student cannot disappear silently",
  async () => {
    h.docs.get(rosterPath).rows[0].uid = "";
    await assert.rejects(api.loadWrittenExamScoreAnalysis(config, examId));
  },
);
await check(
  "whole-grade row-count mismatch rejects incomplete source",
  async () => {
    h.docs.get(rosterPath).rowCount = 5;
    await assert.rejects(api.loadWrittenExamScoreAnalysis(config, examId));
  },
);
await check(
  "whole-grade declared classes mismatch rejects incomplete source",
  async () => {
    h.docs.get(rosterPath).classes.push("3");
    await assert.rejects(api.loadWrittenExamScoreAnalysis(config, examId));
  },
);
await check(
  "essay-only record remains outside choice analysis without manufactured zeros",
  async () => {
    mutateScore("a", (value) => {
      value.scoreContentKind = "essay";
      value.items = [
        {
          name: "논술",
          examSection: "essay",
          score: 4,
          maxScore: 10,
          scoreEntered: true,
        },
      ];
      value.enteredScoreCount = 1;
    });
    const data = await api.loadWrittenExamScoreAnalysis(config, examId, {
      classId: "3-1",
    });
    assert.deepEqual(
      Array.from(data.students, (item) => item.uid),
      ["b"],
    );
  },
);
await check(
  "materials-only save publishes metadata/assets without student response copies",
  async () => {
    const questions = api.questionsFromScoreSource(h.docs.get(rosterPath));
    const saved = await api.saveWrittenExamScoreMaterials(config, {
      examId,
      expectedRevision: null,
      examDate: "2026-11-14",
      questions,
      crops: [],
      files: [
        {
          fileName: "paper.pdf",
          kind: "pdf",
          blob: new Blob(["synthetic-pdf"], { type: "application/pdf" }),
        },
      ],
    });
    assert.equal(saved.id, examId);
    assert.equal(h.blobs.size, 1);
    assert.ok(h.docs.has(materialPath));
    assert.ok(
      !h.writes.some(
        (entry) =>
          entry.path?.includes("/classes/") || entry.path?.startsWith("users/"),
      ),
    );
    assert.ok(!h.writes.some((entry) => entry.kind === "batch-commit"));
    assert.ok(
      !h.writes.some(
        (entry) =>
          entry.data && JSON.stringify(entry.data).includes('"responses"'),
      ),
    );
  },
);
await check("materials upload failure never publishes a manifest", async () => {
  h.failUpload = true;
  await assert.rejects(
    api.saveWrittenExamScoreMaterials(config, {
      examId,
      expectedRevision: null,
      examDate: "2026-11-14",
      questions: api.questionsFromScoreSource(h.docs.get(rosterPath)),
      crops: [],
      files: [
        {
          fileName: "paper.pdf",
          kind: "pdf",
          blob: new Blob(["synthetic-pdf"], { type: "application/pdf" }),
        },
      ],
    }),
  );
  assert.equal(h.docs.has(materialPath), false);
});
await check(
  "materials stale expectedRevision cannot replace the published revision",
  async () => {
    const input = {
      examId,
      expectedRevision: null,
      examDate: "2026-11-14",
      questions: api.questionsFromScoreSource(h.docs.get(rosterPath)),
      crops: [],
      files: [],
    };
    const first = await api.saveWrittenExamScoreMaterials(config, input);
    await assert.rejects(
      api.saveWrittenExamScoreMaterials(config, input),
      /변경/,
    );
    assert.equal(h.docs.get(materialPath).revision, first.revision);
    assert.equal(
      h.docs.get(`${materialPath}/revisions/${first.revision}`).state,
      "ready",
    );
  },
);

for (const [label, mutate] of [
  ["deleted", () => h.docs.delete(rosterPath)],
  [
    "answer key changed",
    () => {
      h.docs.get(rosterPath).items[0].correctAnswer = "5";
    },
  ],
  [
    "grade changed",
    () => {
      h.docs.get(rosterPath).targetGrade = "2";
    },
  ],
  [
    "score changed",
    () => {
      h.docs.get(rosterPath).rows[0].totalScore = 2;
    },
  ],
  [
    "timestamp changed",
    () => {
      h.docs.get(rosterPath).updatedAt = "new-time";
    },
  ],
])
  await check(
    `materials reject a roster ${label} during asset upload and clean only new staging`,
    async () => {
      const roster = copy(h.docs.get(rosterPath));
      const base = {
        examId,
        expectedRevision: null,
        examDate: "2026-11-14",
        questions: api.questionsFromScoreSource(roster),
        crops: [],
        files: [
          {
            fileName: "paper.pdf",
            kind: "pdf",
            blob: new Blob(["synthetic-pdf"], { type: "application/pdf" }),
          },
        ],
      };
      const previous = await api.saveWrittenExamScoreMaterials(config, base);
      const initialBlobs = [...h.blobs.keys()];
      h.beforeTransaction = mutate;
      await assert.rejects(
        api.saveWrittenExamScoreMaterials(config, {
          ...base,
          expectedRevision: previous.revision,
        }),
      );
      assert.equal(h.docs.get(materialPath).revision, previous.revision);
      assert.deepEqual([...h.blobs.keys()], initialBlobs);
      assert.equal(
        [...h.docs.entries()].some(
          ([path, data]) =>
            path.startsWith(materialPath + "/revisions/") &&
            data.state === "staging",
        ),
        false,
      );
      h.docs.set(rosterPath, roster);
      const retried = await api.saveWrittenExamScoreMaterials(config, {
        ...base,
        expectedRevision: previous.revision,
      });
      assert.notEqual(retried.revision, previous.revision);
      assert.equal(h.docs.get(materialPath).revision, retried.revision);
      assert.ok(
        !h.writes.some(
          (entry) =>
            entry.path?.startsWith("users/") || entry.path === rosterPath,
        ),
      );
    },
  );
await check(
  "285-student essay ledger accepts 20-item materials without answer hydration or response copies",
  async () => {
    const roster = h.docs.get(rosterPath);
    roster.scoreContentKind = "essay";
    roster.items = [
      {
        name: "논술형",
        itemKey: "essay-total",
        examSection: "essay",
        maxScore: 10,
      },
    ];
    roster.classes = Array.from({ length: 10 }, (_, index) =>
      String(index + 1),
    );
    roster.rows = Array.from({ length: 285 }, (_, index) => ({
      ...row(
        `synthetic-${index}`,
        String(Math.floor(index / 29) + 1),
        String((index % 29) + 1),
      ),
      items: [{ ...roster.items[0], score: 0, scoreEntered: true }],
    }));
    roster.rowCount = roster.rows.length;
    const before = JSON.stringify(roster);
    const questions = Array.from({ length: 20 }, (_, index) => ({
      number: index + 1,
      answer: "1",
      points: 4,
      options: ["1", "2", "3", "4", "5"],
      achievementStandardCodes: [],
      targetAchievementLevel: "",
      intendedDifficulty: "",
      concepts: [],
    }));
    const saved = await api.saveWrittenExamScoreMaterials(config, {
      examId,
      expectedRevision: null,
      examDate: "2026-11-14",
      questions,
      crops: [],
      files: [],
    });
    assert.equal(saved.studentCount, 285);
    assert.equal(saved.questions.length, 20);
    assert.equal(JSON.stringify(h.docs.get(rosterPath)), before);
    assert.ok(!h.reads.some((path) => path.startsWith("users/")));
    assert.ok(
      !h.writes.some(
        (entry) =>
          entry.path?.startsWith("users/") || entry.path?.includes("/classes/"),
      ),
    );
  },
);

await check(
  "account switch while loading the linked roster prevents every materials write",
  async () => {
    h.afterServerRead = () => {
      auth.currentUser = { ...account, uid: "other-teacher" };
    };
    await assert.rejects(
      api.saveWrittenExamScoreMaterials(config, {
        examId,
        expectedRevision: null,
        examDate: "2026-11-14",
        questions: api.questionsFromScoreSource(h.docs.get(rosterPath)),
        crops: [],
        files: [],
      }),
      /로그인 사용자/,
    );
    assert.equal(h.writes.length, 0);
    assert.equal(h.docs.has(materialPath), false);
  },
);
await check(
  "account switch after staging never uploads or publishes under the new identity",
  async () => {
    h.afterStageWrite = () => {
      auth.currentUser = { ...account, uid: "other-teacher" };
    };
    await assert.rejects(
      api.saveWrittenExamScoreMaterials(config, {
        examId,
        expectedRevision: null,
        examDate: "2026-11-14",
        questions: api.questionsFromScoreSource(h.docs.get(rosterPath)),
        crops: [],
        files: [
          {
            fileName: "paper.pdf",
            kind: "pdf",
            blob: new Blob(["synthetic"], { type: "application/pdf" }),
          },
        ],
      }),
      /로그인 사용자/,
    );
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].data.uploadedBy, "synthetic-teacher");
    assert.equal(h.blobs.size, 0);
    assert.equal(h.docs.has(materialPath), false);
    assert.equal(
      h.reads.length,
      1,
      "A different account does not read or clean the old staging marker",
    );
  },
);
await check(
  "account switch immediately before final transaction blocks manifest publication",
  async () => {
    h.beforeTransaction = () => {
      auth.currentUser = { ...account, uid: "other-teacher" };
    };
    await assert.rejects(
      api.saveWrittenExamScoreMaterials(config, {
        examId,
        expectedRevision: null,
        examDate: "2026-11-14",
        questions: api.questionsFromScoreSource(h.docs.get(rosterPath)),
        crops: [],
        files: [],
      }),
      /로그인 사용자/,
    );
    assert.equal(h.writes.length, 1);
    assert.equal(h.docs.has(materialPath), false);
  },
);

await check(
  "cleanup tombstone arriving before publication cannot become a visible revision",
  async () => {
    h.beforeTransaction = () => {
      const entry = [...h.docs.entries()].find(
        ([path, data]) =>
          path.startsWith(`${materialPath}/revisions/`) &&
          data.state === "staging",
      );
      assert.ok(entry);
      h.docs.set(entry[0], { ...entry[1], state: "cleanup" });
    };
    await assert.rejects(
      api.saveWrittenExamScoreMaterials(config, {
        examId,
        expectedRevision: null,
        examDate: "2026-11-14",
        questions: api.questionsFromScoreSource(h.docs.get(rosterPath)),
        crops: [],
        files: [],
      }),
      /중단된 자료/,
    );
    assert.equal(h.docs.has(materialPath), false);
    assert.equal(
      h.writes.some(
        (write) => write.kind === "update" && write.data?.state === "ready",
      ),
      false,
    );
  },
);

const failures = results.filter((result) => !result.pass);
console.log(
  JSON.stringify(
    {
      checks: results.length,
      passed: results.length - failures.length,
      failed: failures,
      readContract: {
        selectedClassPerRefresh:
          "1 metadata REST query + 1 roster get + 1 materials get + 1 batchGet for 3 selected UID documents",
        twoRefreshes:
          "2 catalog queries + 4 SDK gets + 2 batchGet requests, 10 analysis documents total",
        wholeGrade:
          "1 roster get + 1 materials get + 1 batchGet for 4 linked UID documents",
        wholeGrade284:
          "2 SDK gets + 3 parallel batchGet requests; 286 documents total, no document-count reduction claimed",
        essayPerRefresh: "1 roster get, 0 materials/student gets, 0 writes",
        objectiveWithoutItems: "1 roster get, 0 materials/student gets",
      },
      limitation:
        "Mock transport verifies source/store logic and read calls, not Firebase rules or live billing.",
    },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
