import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const calls = [];
const auth = { currentUser: { uid: "lesson-query-student" } };
const tree = [
  {
    id: "major",
    title: "대단원",
    children: [
      { id: "unit-a", title: "단원 A" },
      { id: "unit-b", title: "단원 B" },
    ],
  },
];
const lessons = [
  {
    unitId: "unit-a",
    title: "단원 A",
    updatedAt: 10,
    contentHtml: "본문 A",
    worksheetBlanks: [{ id: "blank-a", answer: "빈칸" }],
  },
  { unitId: "unit-b", title: "단원 B", updatedAt: 20, contentHtml: "본문 B" },
];
let readGate;
const compile = (file, modules) => {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      console,
      require(name) {
        assert.ok(name in modules, `Unexpected dependency ${name}`);
        return modules[name];
      },
    },
    { filename: file },
  );
  return exports;
};
const selection = compile("src/lib/lessonTreeSelection.ts", {});
const api = compile("src/lib/studentLessonReadCache.ts", {
  "firebase/firestore": {
    doc: (_db, ...parts) => parts.join("/"),
    getDoc: async () => ({ exists: () => true, data: () => ({ tree }) }),
  },
  "./firebase": { auth, db: {} },
  "./historyDictionarySession": {
    getHistoryDictionaryCallable: async (name) => async (request) => {
      assert.equal(name, "getStudentVisibleLessons");
      calls.push(request);
      if (readGate) await readGate;
      const rows = request.unitId
        ? lessons.filter((item) => item.unitId === request.unitId)
        : lessons;
      return {
        data: {
          scopedLessons:
            request.view === "catalog"
              ? rows.map(({ unitId, title, updatedAt }) => ({
                  unitId,
                  title,
                  updatedAt,
                }))
              : rows,
          legacyLessons: [],
        },
      };
    },
  },
  "./semesterArchive": { isSemesterArchive: false },
  "./mapResources": {},
  "./semesterScope": {
    getYearSemester: (config) => config,
    getSemesterDocPath: (config, ...parts) =>
      `${config.year}/${config.semester}/${parts.join("/")}`,
  },
  "./lessonTreeSelection": selection,
});
const scope = { year: "2026", semester: "2" };
const [visible, latest] = await Promise.all([
  api.readStudentVisibleCurriculumTree(scope),
  api.readStudentLatestLessonSelection(scope, tree),
]);
assert.equal(visible[0].children.length, 2);
assert.equal(latest.node.id, "unit-b");
assert.equal(
  calls.length,
  1,
  "Concurrent tree/latest reads share the lightweight catalog",
);
assert.equal(calls[0].view, "catalog");
const [detail, duplicate] = await Promise.all([
  api.readStudentLesson(scope, "unit-a"),
  api.readStudentLesson(scope, "unit-a"),
]);
assert.equal(detail.contentHtml, "본문 A");
assert.equal(detail.worksheetBlanks[0].answer, "빈칸");
assert.equal(detail, duplicate);
assert.equal(calls.length, 2);
assert.equal(calls[1].unitId, "unit-a");
assert.equal(
  calls.some((call) => !call.unitId && call.view !== "catalog"),
  false,
);
const full = await api.readStudentVisibleLessons(scope);
assert.equal(
  full.length,
  2,
  "Progress summaries retain their full lesson data",
);
assert.equal(
  full.find((item) => item.unitId === "unit-a").contentHtml,
  "본문 A",
);
await api.readStudentLesson({ year: "2026", semester: "1" }, "unit-a");
assert.equal(calls.at(-1).semester, "1");
let release;
readGate = new Promise((resolve) => {
  release = resolve;
});
const pending = api.readStudentLesson(scope, "unit-b");
await new Promise((resolve) => setImmediate(resolve));
auth.currentUser = { uid: "another-student" };
release();
await assert.rejects(pending, /로그인 계정/);
readGate = null;
await api.readStudentLesson(scope, "unit-a");
assert.equal(
  calls.length,
  6,
  "A new account never receives the old account's cached detail",
);
console.log(
  "PASS lightweight shared catalog, targeted detail, retained blanks, summary compatibility, semester and account isolation",
);
