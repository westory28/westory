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
const copy = (value) => value === undefined ? undefined : structuredClone(value);
const h = { docs: new Map(), reads: [], writes: [], rest: [], blobs: new Map(), serial: 0 };
const account = { uid: "synthetic-teacher", getIdToken: async () => "synthetic-only-id-token" };
const auth = { currentUser: account };
const db = { app: { options: { projectId: "demo-westory-score-source" } } };
const refPath = (...parts) => {
  const first = parts.shift();
  const path = [first?.path, ...parts].filter(Boolean).join("/");
  return { path, id: path.split("/").at(-1) };
};
const snapshot = (ref) => {
  const data = copy(h.docs.get(ref.path));
  return { id: ref.id, exists: () => data !== undefined, data: () => copy(data) };
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
    return snapshot(ref);
  },
  setDoc: async (ref, data) => {
    h.writes.push({ kind: "set", path: ref.path, data: copy(data) });
    h.docs.set(ref.path, copy(data));
  },
  deleteDoc: async (ref) => {
    h.writes.push({ kind: "delete", path: ref.path });
    h.docs.delete(ref.path);
  },
  serverTimestamp: () => "synthetic-server-time",
  writeBatch: () => ({
    set: (ref, data) => { h.writes.push({ kind: "batch", path: ref.path, data: copy(data) }); },
    commit: async () => { h.writes.push({ kind: "batch-commit" }); },
  }),
  runTransaction: async (_db, callback) => {
    const pending = [];
    const result = await callback({
      get: async (ref) => { h.reads.push(ref.path); return snapshot(ref); },
      update: (ref, data) => pending.push({ kind: "update", path: ref.path, data: copy(data) }),
      set: (ref, data) => pending.push({ kind: "set", path: ref.path, data: copy(data) }),
    });
    for (const entry of pending) {
      h.writes.push(entry);
      h.docs.set(entry.path, entry.kind === "update" ? { ...h.docs.get(entry.path), ...entry.data } : entry.data);
    }
    return result;
  },
};
const storage = {
  ref: (_storage, path) => ({ path }),
  uploadBytes: async (ref, blob) => {
    if (h.failUpload) throw new Error("injected upload failure");
    h.blobs.set(ref.path, blob);
    h.writes.push({ kind: "upload", path: ref.path });
  },
  deleteObject: async (ref) => { h.blobs.delete(ref.path); },
};
const encode = (value) => {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return { integerValue: String(value) };
  if (typeof value === "boolean") return { booleanValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (value && typeof value === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
  return { nullValue: null };
};
const fetchMock = async (url, options) => {
  const body = JSON.parse(options.body);
  h.rest.push({ url, options, body });
  if (h.switchAccount) auth.currentUser = { ...account, uid: "different-teacher" };
  if (h.failFetch) return { ok: false, json: async () => ({}) };
  const source = h.docs.get(rosterPath);
  return { ok: true, json: async () => source ? [{ document: {
    name: `projects/demo-westory-score-source/databases/(default)/documents/${rosterPath}`,
    fields: Object.fromEntries(body.structuredQuery.select.fields.filter(({ fieldPath }) => source[fieldPath] !== undefined).map(({ fieldPath }) => [fieldPath, encode(source[fieldPath])])),
  } }] : [{ readTime: "2026-11-14T00:00:00Z" }] };
};
const built = await build({
  entryPoints: ["src/lib/writtenExamScoreSource.ts"], bundle: true, write: false,
  platform: "node", format: "cjs", define: { "import.meta.env": "{}" },
  external: ["firebase/firestore", "firebase/storage"],
  plugins: [{ name: "synthetic-boundaries", setup(builder) {
    builder.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: "firebase", namespace: "synthetic" }));
    builder.onResolve({ filter: /^\.\/semesterArchive$/ }, () => ({ path: "archive", namespace: "synthetic" }));
    builder.onLoad({ filter: /.*/, namespace: "synthetic" }, ({ path }) => ({ contents: path === "firebase"
      ? "export const auth=globalThis.fixture.auth;export const db=globalThis.fixture.db;export const getFirebaseStorage=async()=>({});"
      : "export const isSemesterArchive=false;export const archiveScope=null;export const assertArchiveWritable=()=>{};" }));
  } }],
});
const module = { exports: {} };
vm.runInNewContext(built.outputFiles[0].text, {
  module, exports: module.exports, console, fixture: { auth, db }, fetch: fetchMock,
  require: (name) => {
    if (name === "firebase/firestore") return firestore;
    if (name === "firebase/storage") return storage;
    throw new Error(`Unexpected dependency: ${name}`);
  }, AbortController, setTimeout, clearTimeout, TextEncoder, Blob,
});
const api = module.exports;
const questionItems = [1, 2].map((number) => ({
  name: `${number}번`, itemKey: `objective-${number}`, examSection: "objective",
  questionNumber: number, correctAnswer: String(number), maxScore: number === 1 ? 4 : 6,
  answerChoices: ["1", "2", "3", "4", "5"],
}));
const row = (uid, room, number, entered = true) => ({
  uid, grade: "3", class: room, number, studentName: `합성 ${uid}`,
  rowNumber: Number(number), items: [], enteredScoreCount: entered ? 2 : 0,
  totalScore: entered ? 10 : 0, totalMaxScore: 10, matchStatus: "matched",
});
const initialRows = [row("a", "1", "1"), row("b", "1", "2"), row("absent", "1", "3", false), row("c", "2", "1")];
const score = (student, zero = false) => ({
  ...student, rosterId: examId, academicYear: "2026", semester: "2",
  scoreKind: "written_exam_essay", scoreContentKind: "objective", totalScore: zero ? 0 : 10,
  items: questionItems.map((item) => ({ ...item, scoreEntered: true, score: zero ? 0 : item.maxScore,
    studentAnswer: zero ? "" : item.correctAnswer, answerCorrect: !zero, answerStatus: zero ? "blank" : "correct" })),
});
const reset = () => {
  h.docs = new Map(); h.reads = []; h.writes = []; h.rest = []; h.blobs = new Map();
  h.failRead = null; h.failFetch = false; h.switchAccount = false; h.failUpload = false;
  auth.currentUser = account;
  h.docs.set(rosterPath, {
    id: examId, scoreKind: "written_exam_essay", scoreContentKind: "objective",
    academicYear: "2026", semester: "2", targetGrade: "3", targetClass: "",
    title: "합성 점수표", subject: "역사", classes: ["1", "2"], rowCount: 4,
    rows: copy(initialRows), items: copy(questionItems), totalMaxScore: 10, updatedAt: "synthetic-time",
  });
  for (const student of initialRows.filter((item) => item.uid !== "absent"))
    h.docs.set(scorePath(student.uid), score(student, student.uid === "b"));
};
const mutateScore = (uid, change) => change(h.docs.get(scorePath(uid)));
const results = [];
const check = async (name, callback) => {
  reset();
  try { await callback(); results.push({ name, pass: true }); }
  catch (error) { results.push({ name, pass: false, error: String(error.message) }); }
};
await check("list: scoped REST select, scoreKind server filter, no limit/rows, Firebase ID token", async () => {
  const sources = await api.listWrittenExamScoreSources(config);
  assert.equal(sources.length, 1); assert.equal("rows" in sources[0], false);
  assert.equal(h.reads.length, 0); assert.equal(h.rest.length, 1);
  const request = h.rest[0], query = request.body.structuredQuery;
  assert.match(request.url, /\/years\/2026\/semesters\/2:runQuery$/);
  assert.equal(request.options.headers.Authorization, "Bearer synthetic-only-id-token");
  assert.equal(request.options.cache, "no-store");
  assert.equal(query.where.fieldFilter.field.fieldPath, "scoreKind");
  assert.equal(query.where.fieldFilter.value.stringValue, "written_exam_essay");
  assert.equal("limit" in query, false); assert.equal("offset" in query, false);
  assert.ok(query.select.fields.some((field) => field.fieldPath === "items"));
  for (const field of ["rows", "studentName", "signatureImage", "feedback"])
    assert.ok(!query.select.fields.some((entry) => entry.fieldPath === field));
});
await check("list: signed-out, account switch, and server failure reject", async () => {
  auth.currentUser = null; await assert.rejects(api.listWrittenExamScoreSources(config));
  auth.currentUser = account; h.switchAccount = true;
  await assert.rejects(api.listWrittenExamScoreSources(config), /사용자/);
  auth.currentUser = account; h.switchAccount = false; h.failFetch = true;
  await assert.rejects(api.listWrittenExamScoreSources(config));
});
await check("two class refreshes: fresh selected UID docs, zero retained, absent omitted, answer changes reflected", async () => {
  for (let iteration = 0; iteration < 2; iteration++) {
    if (iteration) mutateScore("a", (value) => {
      value.items[0] = { ...value.items[0], studentAnswer: "5", answerCorrect: false, answerStatus: "incorrect", score: 0 };
      value.totalScore = 6;
      value.feedback = "최신 교사 피드백";
      value.evidence = "최신 근거";
    });
    await api.listWrittenExamScoreSources(config);
    const data = await api.loadWrittenExamScoreAnalysis(config, examId, { classId: "3-1" });
    assert.deepEqual(Array.from(data.students, (item) => item.uid), ["a", "b"]);
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
  assert.equal(h.rest.length, 2); assert.equal(h.reads.length, 10);
  assert.equal(h.reads.filter((path) => path === rosterPath).length, 2);
  assert.equal(h.reads.filter((path) => path === materialPath).length, 2);
  for (const uid of ["a", "b", "absent"]) assert.equal(h.reads.filter((path) => path === scorePath(uid)).length, 2);
  assert.ok(!h.reads.includes(scorePath("c"))); assert.equal(h.writes.length, 0);
});
await check("whole grade: all classes and only linked UID documents read", async () => {
  const data = await api.loadWrittenExamScoreAnalysis(config, examId);
  assert.deepEqual(Array.from(data.students, (item) => item.uid), ["a", "b", "c"]);
  assert.equal(h.reads.length, 6); assert.equal(data.metadata.studentCount, 3);
});
await check("NEIS multiple answers, circled choices and separators reuse the existing upload parser", async () => {
  const roster = h.docs.get(rosterPath);
  roster.items[0].correctAnswer = "B";
  for (const uid of ["a", "b", "c"]) mutateScore(uid, value => {
    value.items[0].correctAnswer = "③,①";
    value.items[0].studentAnswer = uid === "a" ? "B" : "①";
  });
  const data = await api.loadWrittenExamScoreAnalysis(config, examId, { classId: "3-1" });
  assert.equal(data.metadata.questions[0].answer, "13");
  assert.equal(data.students[0].responses[0].answer, "13");
  const info = copy(data.metadata.questions); info[0].answer = "3,1";
  assert.equal(api.mergeScoreSourceQuestions(data.metadata.questions, info)[0].answer, "13");
});
await check("legacy and tagged essay items hydrate together, including actual zero, without migration", async () => {
  const roster = h.docs.get(rosterPath);
  delete roster.scoreContentKind;
  roster.items = [{ name: "논술형", shortName: "논술형", maxScore: 10 }, { name: "1-(1)", itemKey: "1-(1)", groupKey: "1", maxScore: 3 }];
  for (const uid of ["a", "b", "c"]) mutateScore(uid, value => {
    delete value.scoreContentKind;
    value.items = roster.items.map((item, index) => ({ ...item, score: uid === "b" ? 0 : index + 1, scoreEntered: true,
      ...(index === 1 ? { examSection: "essay" } : {}) }));
  });
  const data = await api.loadWrittenExamScoreAnalysis(config, examId, { classId: "3-1" });
  assert.equal(data.students.length, 0);
  assert.ok(data.scoreItems.every(item => item.examSection === "essay"));
  assert.ok(data.scoreRows[0].items.every(item => item.examSection === "essay"));
  assert.equal(data.scoreRows[1].items[0].score, 0);
  assert.equal(data.scoreRows[1].items[0].scoreEntered, true);
  assert.equal(h.docs.get(rosterPath).items[0].examSection, undefined);
  assert.equal(h.writes.length, 0);
});
await check("foreign-semester roster is rejected before reading student score documents", async () => {
  h.docs.get(rosterPath).semester = "1";
  await assert.rejects(api.loadWrittenExamScoreAnalysis(config, examId));
  assert.ok(!h.reads.some((path) => path.startsWith("users/")));
});
await check("unlisted class is rejected before reading student score documents", async () => {
  await assert.rejects(api.loadWrittenExamScoreAnalysis(config, examId, { classId: "3-9" }));
  assert.ok(!h.reads.some((path) => path.startsWith("users/")));
});
await check("duplicate UID outside selected class still rejects ambiguous roster", async () => {
  h.docs.get(rosterPath).rows[3].uid = "a";
  await assert.rejects(api.loadWrittenExamScoreAnalysis(config, examId, { classId: "3-1" }));
});
await check("one student read failure rejects complete analysis instead of returning a partial class", async () => {
  h.failRead = scorePath("b");
  await assert.rejects(api.loadWrittenExamScoreAnalysis(config, examId, { classId: "3-1" }), /injected read failure/);
});
for (const [name, change] of [
  ["semester", (value) => { value.semester = "1"; }],
  ["year", (value) => { value.academicYear = "2025"; }],
  ["name", (value) => { value.studentName = "다른 합성 학생"; }],
  ["uid", (value) => { value.uid = "other"; }],
  ["roster", (value) => { value.rosterId = "other"; }],
  ["school number", (value) => { value.number = "9"; }],
  ["missing item", (value) => { value.items.pop(); }],
  ["empty scored items", (value) => { value.items = []; }],
  ["duplicate question", (value) => { value.items[1] = copy(value.items[0]); }],
  ["stale answer key", (value) => { value.items[0].correctAnswer = "5"; }],
  ["stale maximum", (value) => { value.items[0].maxScore = 5; }],
  ["out of range score", (value) => { value.items[0].score = 99; }],
  ["partial unentered item", (value) => { value.items[1].scoreEntered = false; }],
]) await check(`reject score ${name}`, async () => {
  mutateScore("a", change);
  await assert.rejects(api.loadWrittenExamScoreAnalysis(config, examId, { classId: "3-1" }));
});
await check("missing registered score document fails; missing nonparticipant document does not", async () => {
  h.docs.delete(scorePath("a"));
  await assert.rejects(api.loadWrittenExamScoreAnalysis(config, examId));
});
await check("registered but unlinked student cannot disappear silently", async () => {
  h.docs.get(rosterPath).rows[0].uid = "";
  await assert.rejects(api.loadWrittenExamScoreAnalysis(config, examId));
});
await check("whole-grade row-count mismatch rejects incomplete source", async () => {
  h.docs.get(rosterPath).rowCount = 5;
  await assert.rejects(api.loadWrittenExamScoreAnalysis(config, examId));
});
await check("whole-grade declared classes mismatch rejects incomplete source", async () => {
  h.docs.get(rosterPath).classes.push("3");
  await assert.rejects(api.loadWrittenExamScoreAnalysis(config, examId));
});
await check("essay-only record remains outside choice analysis without manufactured zeros", async () => {
  mutateScore("a", (value) => { value.scoreContentKind = "essay"; value.items = [{ name: "논술", examSection: "essay", score: 4, maxScore: 10, scoreEntered: true }]; value.enteredScoreCount = 1; });
  const data = await api.loadWrittenExamScoreAnalysis(config, examId, { classId: "3-1" });
  assert.deepEqual(Array.from(data.students, (item) => item.uid), ["b"]);
});
await check("materials-only save publishes metadata/assets without student response copies", async () => {
  const questions = api.questionsFromScoreSource(h.docs.get(rosterPath));
  const saved = await api.saveWrittenExamScoreMaterials(config, {
    examId, expectedRevision: null, examDate: "2026-11-14", questions, crops: [],
    files: [{ fileName: "paper.pdf", kind: "pdf", blob: new Blob(["synthetic-pdf"], { type: "application/pdf" }) }],
  });
  assert.equal(saved.id, examId); assert.equal(h.blobs.size, 1);
  assert.ok(h.docs.has(materialPath));
  assert.ok(!h.writes.some((entry) => entry.path?.includes("/classes/") || entry.path?.startsWith("users/")));
  assert.ok(!h.writes.some((entry) => entry.kind === "batch-commit"));
  assert.ok(!h.writes.some((entry) => entry.data && JSON.stringify(entry.data).includes('"responses"')));
});
await check("materials upload failure never publishes a manifest", async () => {
  h.failUpload = true;
  await assert.rejects(api.saveWrittenExamScoreMaterials(config, {
    examId, expectedRevision: null, examDate: "2026-11-14",
    questions: api.questionsFromScoreSource(h.docs.get(rosterPath)), crops: [],
    files: [{ fileName: "paper.pdf", kind: "pdf", blob: new Blob(["synthetic-pdf"], { type: "application/pdf" }) }],
  }));
  assert.equal(h.docs.has(materialPath), false);
});
await check("materials stale expectedRevision cannot replace the published revision", async () => {
  const input = { examId, expectedRevision: null, examDate: "2026-11-14",
    questions: api.questionsFromScoreSource(h.docs.get(rosterPath)), crops: [], files: [] };
  const first = await api.saveWrittenExamScoreMaterials(config, input);
  await assert.rejects(api.saveWrittenExamScoreMaterials(config, input), /변경/);
  assert.equal(h.docs.get(materialPath).revision, first.revision);
  assert.equal(h.docs.get(`${materialPath}/revisions/${first.revision}`).state, "ready");
});

const failures = results.filter((result) => !result.pass);
console.log(JSON.stringify({ checks: results.length, passed: results.length - failures.length, failed: failures,
  readContract: { selectedClassPerRefresh: "1 metadata REST query + 1 roster get + 1 materials get + 3 selected UID gets", twoRefreshes: "2 REST queries + 10 fresh SDK get calls", wholeGrade: "1 roster get + 1 materials get + 4 linked UID gets" },
  limitation: "Mock transport verifies source/store logic and read calls, not Firebase rules or live billing." }, null, 2));
if (failures.length) process.exitCode = 1;
