import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const evaluate = (path, dependencies, append = "") => {
  const code = ts.transpileModule(readFileSync(path, "utf8") + append, {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  new Function("require", "exports", code)((name) => {
    assert(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
};
let cases = 0;
const request = { semesterId: "2026-1", contentType: "lessons" };
const good = {
  ...request,
  provenance: "ARCHIVE",
  readOnly: true,
  rows: [],
  nextCursor: null,
  detail: null,
};
let response = good;
let sent;
const adapter = evaluate("src/lib/adminSemesterContent.ts", {
  "./firebase": {
    getHttpsCallable: async (name) => {
      assert.equal(name, "getAdminSemesterContent");
      return async (payload) => {
        sent = payload;
        return { data: response };
      };
    },
  },
});
await adapter.getAdminSemesterContent(request);
assert.deepEqual(sent, { ...request, pageSize: 20 });
cases++;
for (const invalid of [
  { semesterId: "2026-2" },
  { contentType: "quiz_questions" },
  { readOnly: false },
  { provenance: "CURRENT" },
  { rows: [{ id: 1, title: "bad" }] },
  { detail: [] },
]) {
  response = { ...good, ...invalid };
  await assert.rejects(adapter.getAdminSemesterContent(request));
  cases++;
}
const uiPath = "src/pages/teacher/components/SettingsArchiveContent.tsx";
const ui = evaluate(
  uiPath,
  {
    react: React,
    "../../../contexts/AuthContext": {
      useAuth: () => ({ currentUser: { uid: "synthetic-admin" } }),
    },
    "../../../lib/adminSemesterContent": {},
    "../../../lib/semesterArchiveView": {
      archiveDate: (value) => value,
      appendArchivePage: (a, b) => [...a, ...b],
    },
    "../../../components/common/LoadingState": { PageDataLoading: () => null },
    "./ArchivedLessonPreview": {
      default: ({ semesterId }) =>
        React.createElement("p", null, `Lesson archive ${semesterId}`),
    },
    "../../../components/common/QuizPassage": {
      default: ({ value }) => React.createElement("p", null, value),
    },
  },
  "\nexport { ContentDetails };\n",
);
for (const [type, detail, expected] of [
  [
    "quiz_questions",
    {
      question: "합성 문항",
      options: ["보기 하나"],
      answer: "1",
      explanation: "근거 설명",
    },
    ["합성 문항", "보기 하나", "근거 설명"],
  ],
  [
    "history_dictionary_terms",
    { word: "합성 단어", definition: "단어 뜻" },
    ["합성 단어", "단어 뜻"],
  ],
  [
    "history_dictionary_requests",
    { word: "신청 단어", memo: "확인 부탁" },
    ["확인 부탁"],
  ],
  [
    "dictionary_words",
    { word: "저장 단어", definition: "보관된 뜻" },
    ["보관된 뜻"],
  ],
  ["think_cloud_sessions", { description: "활동 설명" }, ["활동 설명"]],
  ["think_cloud_responses", { textRaw: "학생의 생각" }, ["학생의 생각"]],
  [
    "history_classrooms",
    { description: "보관 과제", blanks: [{ answer: "고려" }] },
    ["보관 과제", "고려"],
  ],
  [
    "exam_config",
    {
      objective: [{ answer: 2, score: 3 }],
      subjective: [{ subItems: [{ answer: "서술 정답", score: 5 }] }],
    },
    ["서술 정답", "객관식"],
  ],
  [
    "grading_plans",
    { subject: "역사", items: [{ name: "수행평가", maxScore: 20, ratio: 30 }] },
    ["역사", "수행평가", "30"],
  ],
  [
    "assessment_config",
    { private_key: { questionCount: 10, active: false, cooldown: 0 } },
    ["문항 수", "비공개", "재응시 대기"],
  ],
]) {
  const markup = renderToStaticMarkup(
    React.createElement(ui.ContentDetails, {
      contentType: type,
      detail,
      semesterId: "2026-1",
    }),
  );
  expected.forEach((value) =>
    assert(markup.includes(value), `${type}: ${value}`),
  );
  assert(!markup.includes("[object Object]"));
  assert(!markup.includes("private_key"));
  cases++;
}
const file = ts.createSourceFile(
  uiPath,
  readFileSync(uiPath, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let loadNode;
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === "load")
    loadNode = node.initializer.arguments[0];
  ts.forEachChild(node, visit);
};
visit(file);
let resolvePage;
let updates = 0;
const epoch = { current: 0 };
const bindings = {
  uid: "synthetic-admin",
  epoch,
  semesterId: "2026-1",
  contentType: "lessons",
  parentId: undefined,
  setBusy() {},
  setError() {},
  setRows() {
    updates++;
  },
  setCursor() {
    updates++;
  },
  setLoaded() {
    updates++;
  },
  getAdminSemesterContent: () =>
    new Promise((resolve) => {
      resolvePage = resolve;
    }),
};
const body = ts.transpileModule(`return ${loadNode.getText(file)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const load = new Function(...Object.keys(bindings), body)(
  ...Object.values(bindings),
);
const pending = load();
epoch.current++;
resolvePage(good);
await pending;
assert.equal(
  updates,
  0,
  "A superseded semester/UID response must not restore old rows",
);
cases++;
console.log(
  JSON.stringify({
    suite: "admin-semester-content-ui",
    cases,
    status: "PASS",
    networkCalls: 0,
    browserRuns: 0,
  }),
);
