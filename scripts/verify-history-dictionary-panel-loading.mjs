import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Run the production component's hooks without mounting unrelated child UI.
const slots = [];
let cursor = 0;
let dirty = false;
let effects = [];
let tree;
const equal = (a, b) =>
  a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const react = {
  useState(initial) {
    const index = cursor++;
    if (!(index in slots))
      slots[index] = {
        value: typeof initial === "function" ? initial() : initial,
      };
    return [
      slots[index].value,
      (next) => {
        const value =
          typeof next === "function" ? next(slots[index].value) : next;
        if (!Object.is(slots[index].value, value)) {
          slots[index].value = value;
          dirty = true;
        }
      },
    ];
  },
  useRef(value) {
    const index = cursor++;
    return (slots[index] ||= { current: value });
  },
  useMemo(factory, deps) {
    const index = cursor++;
    if (!equal(slots[index]?.deps, deps))
      slots[index] = { deps, value: factory() };
    return slots[index].value;
  },
  useEffect(callback, deps) {
    const index = cursor++;
    if (!equal(slots[index]?.deps, deps)) {
      const old = slots[index];
      slots[index] = { deps, cleanup: old?.cleanup };
      effects.push(() => {
        slots[index].cleanup?.();
        slots[index].cleanup = callback();
      });
    }
  },
};
const jsx = (type, props) => ({ type, props });
const auth = {
  configReady: true,
  config: { year: 2026, semester: 2 },
  currentUser: { uid: "teacher-a" },
  userData: {},
};
let params = new URLSearchParams();
const calls = {
  terms: 0,
  requests: 0,
  words: 0,
  notifications: 0,
  stopTerms: 0,
  stopRequests: 0,
};
const pendingWords = [];
const oldRequestCallbacks = [];
let failNextTerms = false;
const api = {
  normalizeHistoryDictionaryWord: (word) => word.trim().toLowerCase(),
  subscribeTeacherHistoryDictionaryTerms(callback, onError) {
    calls.terms++;
    if (failNextTerms) {
      failNextTerms = false;
      onError(new Error("test-unavailable"));
    } else callback([]);
    return () => calls.stopTerms++;
  },
  subscribeTeacherHistoryDictionaryRequests(callback) {
    calls.requests++;
    oldRequestCallbacks.push(callback);
    callback([]);
    return () => calls.stopRequests++;
  },
  loadTeacherStudentHistoryDictionaryWords() {
    calls.words++;
    return new Promise((resolve) => pendingWords.push(resolve));
  },
};
const transpile = (path) =>
  ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
const panelModule = { exports: {} };
vm.runInNewContext(transpile("src/constants/historyDictionaryPanels.ts"), {
  exports: panelModule.exports,
  module: panelModule,
});
const componentModule = { exports: {} };
vm.runInNewContext(transpile("src/pages/teacher/ManageHistoryDictionary.tsx"), {
  exports: componentModule.exports,
  module: componentModule,
  console,
  require(name) {
    if (name === "react") return react;
    if (name === "react/jsx-runtime")
      return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (name === "react-router-dom")
      return {
        useSearchParams: () => [
          params,
          (next) => {
            params = new URLSearchParams(next);
            dirty = true;
          },
        ],
      };
    if (name.endsWith("/historyDictionaryPanels")) return panelModule.exports;
    if (name.endsWith("/historyDictionary")) return api;
    if (name.endsWith("/historyDictionarySession"))
      return { getHistoryDictionaryErrorMessage: String };
    if (name.endsWith("/permissions"))
      return { canWriteLessonManagement: () => true };
    if (name.endsWith("/AuthContext")) return { useAuth: () => auth };
    if (name.endsWith("/AppToastProvider"))
      return { useAppToast: () => ({ showToast() {} }) };
    if (name.endsWith("/notifications"))
      return {
        loadNotifications: async () => {
          calls.notifications++;
          return [];
        },
      };
    if (name.endsWith("/historyDictionaryInitials"))
      return {
        getHistoryDictionaryInitialCounts: () => ({}),
        matchesHistoryDictionaryInitial: () => true,
      };
    if (
      /\/(LoadingState|HistoryDictionaryCatalogBrowser|HistoryDictionaryInitialFilter)$/.test(
        name,
      )
    )
      return { default: name, LoadingOverlay: name };
    throw new Error(`Unexpected import: ${name}`);
  },
});
const Component = componentModule.exports.default;
async function render() {
  dirty = true;
  for (let i = 0; i < 30 && dirty; i++) {
    dirty = false;
    cursor = 0;
    tree = Component();
    const queue = effects;
    effects = [];
    queue.forEach((effect) => effect());
    await Promise.resolve();
    await Promise.resolve();
  }
  assert(!dirty, "Hook render did not settle");
}
const text = (node) =>
  Array.isArray(node)
    ? node.map(text).join("")
    : typeof node === "object" && node
      ? text(node.props?.children)
      : String(node ?? "");
function findButton(node, label) {
  if (Array.isArray(node))
    return node.map((child) => findButton(child, label)).find(Boolean);
  if (!node || typeof node !== "object") return;
  if (node.type === "button" && text(node.props.children) === label)
    return node;
  return findButton(node.props?.children, label);
}
const navigate = async (query) => {
  params = new URLSearchParams(query);
  await render();
};

await render();
assert.deepEqual(
  calls,
  {
    terms: 0,
    requests: 0,
    words: 0,
    notifications: 0,
    stopTerms: 0,
    stopRequests: 0,
  },
  "Default catalog must not load private management panels",
);
findButton(tree, "교사 등록").props.onClick();
await render();
assert.equal(calls.terms, 1);
assert.equal(calls.requests + calls.words + calls.notifications, 0);
findButton(tree, "기본 사전").props.onClick();
await render();
assert.equal(calls.stopTerms, 1);
await navigate("panel=requests");
assert.equal(calls.requests, 1);
assert.equal(calls.terms, 2);
assert.equal(calls.notifications, 1);
assert.equal(calls.words, 0);
await navigate("panel=studentWords");
assert.equal(calls.stopRequests, 1);
assert.equal(calls.words, 1);
assert.equal(calls.terms, 2);
oldRequestCallbacks[0]([{ id: "stale-request", word: "오래된 요청" }]);
auth.currentUser = { uid: "teacher-b" };
await render();
assert.equal(calls.words, 2);
assert.equal(calls.terms, 3);
pendingWords[0]([{ id: "stale-word", word: "이전 계정 단어" }]);
pendingWords[1]([]);
await render();
assert(!JSON.stringify(slots).includes("stale-request"));
assert(!JSON.stringify(slots).includes("stale-word"));
await navigate("panel=upload");
assert.equal(calls.words, 2);
assert.equal(calls.requests, 1);
assert.equal(calls.notifications, 1);
await navigate("");
assert.equal(calls.stopTerms, 3);
failNextTerms = true;
findButton(tree, "교사 등록").props.onClick();
await render();
assert(text(tree).includes("test-unavailable"));
findButton(tree, "다시 불러오기").props.onClick();
await render();
assert(!text(tree).includes("test-unavailable"));
assert.equal(calls.terms, 5);
assert.equal(calls.requests, 1);
assert.equal(calls.words, 2);
console.log(
  "Dictionary panel loading: deferred tabs, required terms, unsubscribe, error/retry and stale account callbacks passed.",
);
