import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const React = require("react");
const koreanText = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync("src/lib/koreanText.ts", "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText,
  { exports: koreanText },
);
const source = readFileSync(
  "src/pages/teacher/components/ExamGradingPlan.tsx",
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React,
    esModuleInterop: true,
  },
}).outputText;

function mount() {
  const states = [];
  const writes = [];
  const toasts = [];
  let cursor = 0;
  let saveError = null;
  let finishSave = null;
  let deferSave = false;
  const scope = { year: "2026", semester: "2" };
  const ReactMock = {
    ...React,
    useEffect: () => {},
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [
        states[index],
        (next) => {
          states[index] =
            typeof next === "function" ? next(states[index]) : next;
        },
      ];
    },
  };
  const firestore = {
    collection: (_db, path) => path,
    doc: (_db, path) => path,
    query: (path) => path,
    orderBy: () => null,
    serverTimestamp: () => "server-time",
    getDocs: async () => ({ forEach() {} }),
    async addDoc(path, data) {
      if (saveError) throw saveError;
      if (deferSave)
        await new Promise((resolve) => {
          finishSave = resolve;
        });
      writes.push({ path, data });
    },
  };
  const dependencies = {
    "./examGradingPlan.css": {},
    "./KoreanTextInput": { __esModule: true, default: "input" },
    "./GradingScoreHelp": { __esModule: true, default: "help" },
    react: ReactMock,
    "../../../lib/firebase": { db: {} },
    "../../../lib/koreanText": koreanText,
    "firebase/firestore": firestore,
    "../../../contexts/AuthContext": { useAuth: () => ({ userConfig: scope }) },
    "../../../lib/semesterScope": {
      getYearSemester: () => scope,
      getSemesterCollectionPath: (_config, name) =>
        `years/${scope.year}/semesters/${scope.semester}/${name}`,
    },
    "../../../lib/studentScores": {},
    "../../../components/common/AppDialogProvider": {
      useAppDialog: () => ({ confirm: async () => true }),
    },
    "../../../components/common/AppToastProvider": {
      useAppToast: () => ({ showToast: (toast) => toasts.push(toast) }),
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (id) => {
      assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
      return dependencies[id];
    },
    console: { error() {} },
  });
  const render = () => {
    cursor = 0;
    const nodes = [];
    const visit = (node) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== "object") return;
      nodes.push(node);
      visit(node.props?.children);
    };
    visit(exports.default());
    return {
      subject: nodes.find(
        (node) =>
          node.type === "input" &&
          node.props.placeholder === "예: 국어, 역사, 사회",
      ),
      names: nodes.filter(
        (node) =>
          node.type === "input" &&
          node.props.placeholder === "예: 서술형, 발표, 포트폴리오",
      ),
      maxScores: nodes.filter(
        (node) => node.type === "input" && node.props.placeholder === "만점",
      ),
      ratios: nodes.filter(
        (node) => node.type === "input" && node.props.placeholder === "%",
      ),
      save: nodes.find(
        (node) => node.type === "button" && "aria-busy" in node.props,
      ),
      form: nodes.find((node) => node.type === "fieldset"),
      add: nodes.find(
        (node) =>
          node.type === "button" &&
          String(node.props.children).includes("항목 추가"),
      ),
    };
  };
  const change = (element, value) =>
    element.props.onValueChange
      ? element.props.onValueChange(value)
      : element.props.onChange({ target: { value } });
  return {
    render,
    change,
    writes,
    toasts,
    failSave: () => {
      saveError = { code: "permission-denied" };
    },
    allowSave: () => {
      saveError = null;
    },
    deferSave: () => {
      deferSave = true;
    },
    finishSave: () => finishSave(),
  };
}

const form = mount();
// Real browser IME supplies intermediate composition values: preserve them
// exactly, alongside English/mixed names, instead of replacing Latin keystrokes.
for (const value of [
  "g",
  "gk",
  "ㅎ",
  "하",
  "한",
  "한ㄱ",
  "한그",
  "한글",
  "한글 English",
]) {
  form.change(form.render().names[0], value);
  assert.equal(form.render().names[0].props.value, value);
  form.change(form.render().subject, value);
  assert.equal(form.render().subject.props.value, value);
}
form.change(form.render().subject, " 국어 ");
form.change(form.render().names[0], " 문장 탐구 ");
form.change(form.render().maxScores[0], "20");
form.change(form.render().ratios[0], "100");
form.failSave();
await form.render().save.props.onClick();
assert.equal(form.writes.length, 0);
assert.equal(form.render().names[0].props.value, " 문장 탐구 ");
assert.equal(form.render().subject.props.value, " 국어 ");
assert.equal(form.render().form.props.disabled, false);
assert.equal(form.toasts.at(-1).tone, "error");

form.allowSave();
form.deferSave();
const pendingSave = form.render().save.props.onClick();
assert.equal(form.render().form.props.disabled, true);
assert.equal(form.render().save.props.disabled, true);
await form.render().save.props.onClick();
form.finishSave();
await pendingSave;
assert.equal(form.writes.length, 1);
assert.equal(form.writes[0].path, "years/2026/semesters/2/grading_plans");
assert.equal(form.writes[0].data.subject, "국어");
assert.equal(form.writes[0].data.items[0].name, "문장 탐구");
assert.equal(form.writes[0].data.academicYear, "2026");
assert.equal(form.writes[0].data.semester, "2");
assert.equal(form.render().subject.props.value, "");
assert.equal(form.render().form.props.disabled, false);

const incomplete = mount();
incomplete.change(incomplete.render().subject, "국어");
incomplete.change(incomplete.render().names[0], "시험");
incomplete.change(incomplete.render().maxScores[0], "100");
incomplete.change(incomplete.render().ratios[0], "100");
incomplete.render().add.props.onClick();
await incomplete.render().save.props.onClick();
assert.equal(
  incomplete.writes.length,
  0,
  "Do not silently drop incomplete criteria",
);
assert.equal(incomplete.toasts.at(-1).tone, "warning");
const detached = mount();
detached.change(detached.render().subject, " ㄱㅜㄱㅇㅓ ");
detached.change(detached.render().names[0], " ㅎㅏㄴㄱㅡㄹ English ");
detached.change(detached.render().maxScores[0], "100");
detached.change(detached.render().ratios[0], "100");
await detached.render().save.props.onClick();
assert.equal(detached.writes[0].data.subject, "국어");
assert.equal(detached.writes[0].data.items[0].name, "한글 English");
console.log(
  "Grading plan form verified: IME/mixed text preservation, failure recovery, duplicate-save guard, semester metadata, and incomplete-item validation.",
);
