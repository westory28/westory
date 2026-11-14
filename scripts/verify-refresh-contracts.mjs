/** Execute the real refresh handlers against synthetic transports. No Firebase access. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

async function handler(file, name, dependencies) {
  const source = await fs.readFile(file, "utf8");
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name)
      initializer = node.initializer?.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(initializer, `Missing actual ${name} handler`);
  const code = ts.transpileModule(`globalThis.run = ${initializer};`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const context = vm.createContext(dependencies);
  vm.runInContext(code, context, { filename: file });
  return { run: context.run, context };
}

let reads = 0;
const roster = await handler(
  "src/pages/teacher/StudentList.tsx",
  "handleRefreshList",
  {
    loading: false,
    fetchStudents: async (options) => {
      assert.equal(options.fresh, true);
      reads++;
    },
  },
);
await roster.run();
assert.equal(reads, 1);
roster.context.loading = true;
await roster.run();
assert.equal(reads, 1, "A pending roster read cannot be duplicated");

const calls = [],
  states = [],
  errors = [];
let pending,
  fail = false,
  current = true;
const config = { year: "2026", semester: "2" };
const orders = await handler(
  "src/pages/teacher/ManagePoints.tsx",
  "refreshOrders",
  {
    canRead: true,
    scopeReady: true,
    isCurrentScope: () => current,
    loadInFlightRef: { current: null },
    requestScope: "teacher:2026:2",
    config,
    isSemesterArchive: false,
    setShopLoadError: (value) => errors.push(value),
    setOrders: (value) => states.push(value),
    listPointOrders: async (scope, options) => {
      calls.push({ kind: "orders", scope, options });
      if (pending) await pending.promise;
      if (fail) throw new Error("Synthetic order read failure");
      return [{ id: "synthetic-order", status: "requested" }];
    },
    readArchivedShopOrders: async () => {
      calls.push({ kind: "archive-orders" });
      return [{ id: "archived-order" }];
    },
  },
);
await orders.run();
assert.equal(calls.length, 1);
assert.deepEqual(calls[0].scope, config);
assert.equal(states.length, 1);
assert.equal(errors.at(-1), "");
assert.equal(orders.context.loadInFlightRef.current, null);

let release;
pending = {
  promise: new Promise((resolve) => {
    release = resolve;
  }),
};
const first = orders.run();
await orders.run();
assert.equal(calls.length, 2, "Double refresh shares the current order read");
release();
await first;
pending = null;

fail = true;
await orders.run();
assert.equal(calls.length, 3);
assert.equal(states.length, 2, "A failed refresh preserves the visible orders");
assert.match(errors.at(-1), /Synthetic/);
assert.equal(orders.context.loadInFlightRef.current, null);
fail = false;
await orders.run();
assert.equal(calls.length, 4, "An explicit retry adds exactly one order read");
assert.equal(states.length, 3);

pending = {
  promise: new Promise((resolve) => {
    release = resolve;
  }),
};
const stale = orders.run();
current = false;
release();
await stale;
assert.equal(
  states.length,
  3,
  "A late account or semester response is discarded",
);
pending = null;
current = true;
orders.context.isSemesterArchive = true;
await orders.run();
assert.equal(calls.at(-1).kind, "archive-orders");
orders.context.canRead = false;
const beforeDenied = calls.length;
await orders.run();
assert.equal(
  calls.length,
  beforeDenied,
  "Read permission and semester boundaries remain enforced",
);

console.log(
  "PASS real refresh handlers: fresh roster read, order-only read, no unrelated tab/setting resets, duplicate suppression, failure preservation, explicit retry, stale identity discard, archive and permission boundaries.",
);

const scoreFile = "src/pages/teacher/components/PerformanceScoreManager.tsx";
const scoreEvents = [];
let scoreReadCount = 0,
  scoreGate = null,
  scoreFailure = false;
const scoreOwner = "teacher:1:2026:2:written_exam";
const scoreScope = { current: scoreOwner };
const capture = (name) => (value) => scoreEvents.push([name, value]);
const scoreSetters = Object.fromEntries(
  [
    "setRostersLoading",
    "setRosters",
    "setScoreListLoadError",
    "setScoreListRosterId",
    "setScoreListLoadedRosterId",
    "setScoreListRecords",
    "setScoreListSummaryStudents",
    "setScoreListSummaryLoadedKey",
    "setScoreEditing",
    "setScoreEditOriginalRecords",
    "setScoreListLoading",
    "setScoreWarningLoading",
    "setScoreWarningSettings",
    "setScoreWarningDraft",
  ].map((name) => [name, capture(name)]),
);
const scoreDeps = {
  ...scoreSetters,
  console: { error() {} },
  showToast: capture("toast"),
  scoreReadIdentity: scoreOwner,
  scoreReadIdentityRef: scoreScope,
  rosterReadRunRef: { current: 0 },
  scoreListReadRunRef: { current: 0 },
  warningReadRunRef: { current: 0 },
  scoreDocumentSyncRunRef: { current: 0 },
  refreshVisibleScores: { current: true },
  clearPerformanceScoreReadCaches: capture("clearCaches"),
  db: {},
  rosterCollectionPath: "years/2026/semesters/2/performance_score_rosters",
  isWrittenExamMode: true,
  activeScoreKind: "written_exam",
  collection: (_db, path) => path,
  query: (...parts) => parts,
  where: (...parts) => parts,
  orderBy: () => {
    throw Error("Unexpected performance query");
  },
  normalizePerformanceScoreRoster: (id, value) => ({ id, ...value }),
  normalizePerformanceScoreKind: (value) => value,
  sortPerformanceScoreRosters: (value) => value,
  managerCopy: { scoreKindLabel: "정기시험" },
  getDocsFromServer: async (query) => {
    scoreReadCount++;
    assert.equal(query[0], "years/2026/semesters/2/performance_score_rosters");
    assert.deepEqual(Array.from(query[1]), ["scoreKind", "==", "written_exam"]);
    if (scoreGate) await scoreGate;
    if (scoreFailure) throw Error("Synthetic score read failure");
    return {
      docs: [{ id: "exam", data: () => ({ scoreKind: "written_exam" }) }],
    };
  },
};
const scoreRosters = await handler(scoreFile, "loadRosters", scoreDeps);
await scoreRosters.run({ refresh: true });
assert.equal(scoreReadCount, 1);
assert.equal(scoreEvents.filter(([name]) => name === "setRosters").length, 1);
scoreEvents.length = 0;
scoreFailure = true;
await scoreRosters.run({ refresh: true });
assert.equal(scoreReadCount, 2);
assert.equal(
  scoreEvents.some(([name]) => name === "setRosters"),
  false,
  "Failed refresh retains rosters",
);
assert.ok(scoreEvents.some(([name]) => name === "setScoreListLoadError"));
scoreFailure = false;
await scoreRosters.run({ refresh: true });
assert.equal(
  scoreReadCount,
  3,
  "Retry issues one current-semester roster read",
);
for (const failure of [false, true]) {
  scoreEvents.length = 0;
  let finish;
  scoreGate = new Promise((resolve) => {
    finish = resolve;
  });
  scoreFailure = failure;
  scoreScope.current = scoreOwner;
  const late = scoreRosters.run({ refresh: true });
  scoreEvents.length = 0;
  scoreScope.current = "other-user:2:2027:1:written_exam";
  finish();
  await late;
  assert.equal(
    scoreEvents.length,
    0,
    "Stale success/error/finally must not change the new scope",
  );
}
scoreScope.current = scoreOwner;
scoreGate = null;
scoreFailure = false;
const records = await handler(scoreFile, "loadScoreListRecords", {
  ...scoreDeps,
  selectedScoreRoster: { id: "exam" },
  scoreListAllSelected: false,
  scoreListLoading: false,
  savingScoreEdits: false,
  loadScoreRecordsForRoster: async (roster, options) => {
    scoreReadCount++;
    assert.equal(roster.id, "exam");
    assert.equal(options.fromServer, true);
    if (scoreGate) await scoreGate;
    if (scoreFailure) throw Error("Synthetic selected score failure");
    return [{ uid: "synthetic-student", totalScore: 85 }];
  },
});
scoreEvents.length = 0;
await records.run(undefined, { refresh: true });
assert.equal(
  scoreEvents.filter(([name]) => name === "setScoreListRecords").length,
  1,
);
scoreEvents.length = 0;
scoreFailure = true;
await records.run(undefined, { refresh: true });
assert.equal(
  scoreEvents.some(([name]) => name === "setScoreListRecords"),
  false,
  "Failed selected-score refresh retains the visible records",
);
assert.equal(
  scoreEvents.some(([name]) => name === "setScoreListLoadedRosterId"),
  false,
  "Failed refresh retains the loaded selection for retry",
);
for (const failure of [false, true]) {
  let finish;
  scoreGate = new Promise((resolve) => {
    finish = resolve;
  });
  scoreFailure = failure;
  scoreScope.current = scoreOwner;
  const late = records.run(undefined, { refresh: true });
  scoreEvents.length = 0;
  scoreScope.current = "other-user:2:2027:1:written_exam";
  finish();
  await late;
  assert.equal(
    scoreEvents.length,
    0,
    "Late selected-score result/error/finally is discarded",
  );
}
scoreScope.current = scoreOwner;
scoreGate = null;
scoreFailure = false;
const warning = await handler(scoreFile, "loadScoreWarningSettings", {
  ...scoreDeps,
  config,
  scoreWarningDraft: "작성 중인 문구",
  scoreWarningSettings: { warningText: "기존 저장 문구" },
  loadPerformanceScoreSettings: async (_config, options) => {
    assert.equal(options.fromServer, true);
    return { warningText: "새 서버 문구" };
  },
});
scoreEvents.length = 0;
await warning.run({ refresh: true });
assert.equal(
  scoreEvents.some(([name]) => name === "setScoreWarningSettings"),
  true,
);
assert.equal(
  scoreEvents.some(([name]) => name === "setScoreWarningDraft"),
  false,
  "Server refresh preserves unsaved warning text",
);
console.log(
  "PASS score refresh: scoped server query, preserved result/selection/draft, explicit retry, late success/error/finally guards across account and semester changes.",
);
