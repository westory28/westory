import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build, transformSync } from "esbuild";
import ts from "typescript";

const compiled = await build({
  entryPoints: ["src/lib/lessonInitialSelection.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { findInitialLessonSelection } = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputFiles[0].contents).toString("base64")
);
const tree = [
  {
    id: "root",
    title: "목차",
    children: [
      { id: "current", title: "현재 수업" },
      { id: "legacy", title: "기존 수업" },
    ],
  },
];
const lesson = (unitId, updatedAt) => ({ unitId, updatedAt });
const paths = ["years/2026/1/lessons", "lessons"];
const run = async (pages, options = {}) => {
  const calls = [];
  const result = await findInitialLessonSelection({
    tree,
    collectionPaths: paths,
    isCurrent: () => true,
    readPage: async (path, cursor, pageSize) => {
      assert.equal(pageSize, cursor === undefined ? 1 : 10);
      calls.push([path, cursor]);
      const index = cursor ?? 0;
      const rows = pages[path]?.[index] ?? [];
      return {
        lessons: rows,
        nextCursor: pages[path]?.[index + 1] ? index + 1 : undefined,
      };
    },
    ...options,
  });
  return { result, calls };
};

// Do not read older pages or legacy bodies after a current-semester match.
const first = await run({
  [paths[0]]: [[lesson("current", 100)], [lesson("legacy", 50)]],
  [paths[1]]: [[lesson("legacy", 999)]],
});
assert.equal(first.result.node.id, "current");
assert.deepEqual(first.calls, [[paths[0], undefined]]);

// Deleted tree references must not make limit(10) incorrectly return no lesson.
const later = await run({
  [paths[0]]: [
    [lesson("removed-0", 100)],
    [lesson("current", 50)],
    [lesson("legacy", 40)],
  ],
});
assert.equal(later.result.node.id, "current");
assert.deepEqual(later.calls, [
  [paths[0], undefined],
  [paths[0], 1],
]);

const legacy = await run({
  [paths[0]]: [[lesson("removed", 100)]],
  [paths[1]]: [[lesson("legacy", 50)]],
});
assert.equal(legacy.result.node.id, "legacy");
assert.deepEqual(legacy.calls, [
  [paths[0], undefined],
  [paths[1], undefined],
]);
assert.equal((await run({})).result, null);
assert.deepEqual((await run({}, { tree: [] })).calls, []);
assert.deepEqual((await run({}, { isCurrent: () => false })).calls, []);

// A scope/selection change while a page is in flight must discard the result
// and must not start another page or legacy read.
let active = true;
let cancelledReads = 0;
const cancelled = await run(
  {},
  {
    isCurrent: () => active,
    readPage: async () => {
      cancelledReads++;
      active = false;
      return { lessons: [lesson("current", 100)], nextCursor: 1 };
    },
  },
);
assert.equal(cancelled.result, null);
assert.equal(cancelledReads, 1);
await assert.rejects(
  run(
    {},
    {
      readPage: async () => {
        throw new Error("permission-denied");
      },
    },
  ),
  /permission-denied/,
);

// Execute the actual bootstrap effect body with controlled dependencies. This
// checks its wiring, including no default-semester read before config arrives.
const component = readFileSync("src/pages/teacher/ManageLesson.tsx", "utf8");
const effect = component.match(
  /useEffect\(\(\) => \{\s*(\+\+treeLoadIdRef\.current;[\s\S]*?)\}, \[teacherScope, configReady\]\);/,
);
assert.ok(effect, "lesson bootstrap effect must wait for config readiness");
const executeEffect = new Function("io", `with (io) { ${effect[1]} }`);
const io = {
  configReady: false,
  config: null,
  treeLoadIdRef: { current: 0 },
  lessonLoadIdRef: { current: 0 },
  treeLoadedRef: { current: true },
  setSelectedNodeId() {},
  setSelectedNodeTitle() {},
  clearLessonEditor() {},
  setTreeData() {},
  setScreenBusyMessage() {},
  setPdfSaveFeedback(value) {
    io.feedback = value;
  },
  loadTree(reset) {
    assert.equal(reset, true);
    io.loads++;
  },
  loads: 0,
};
executeEffect(io);
assert.equal(io.loads, 0);
assert.equal(io.treeLoadedRef.current, false);
io.configReady = true;
executeEffect(io);
assert.equal(io.loads, 0);
assert.equal(io.feedback.tone, "error");
io.config = { year: "2026", semester: "1" };
executeEffect(io);
assert.equal(io.loads, 1);
assert.equal(io.treeLoadIdRef.current, 3);
assert.equal(io.lessonLoadIdRef.current, 3);

// Execute the actual component loader, not a duplicate implementation. The
// controlled server reads show that the tree and first lesson start together,
// while recovery, stale scopes and read failures cannot expose an old draft.
const sourceFile = ts.createSourceFile(
  "ManageLesson.tsx",
  component,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let loadTreeNode;
const locateLoader = (node) => {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(sourceFile) === "loadTree"
  )
    loadTreeNode = node.initializer;
  ts.forEachChild(node, locateLoader);
};
locateLoader(sourceFile);
assert.ok(loadTreeNode, "the actual tree loader must be present");
const loaderExpression = transformSync(
  `(${loadTreeNode.getText(sourceFile)})`,
  {
    loader: "ts",
    target: "es2020",
  },
)
  .code.trim()
  .replace(/;$/, "");
const createLoader = new Function(
  "io",
  `with (io) { return ${loaderExpression}; }`,
);
const selectionModule = await build({
  entryPoints: ["src/lib/lessonTreeSelection.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { findLessonTreeSelectionByUnitId } = await import(
  "data:text/javascript;base64," +
    Buffer.from(selectionModule.outputFiles[0].contents).toString("base64")
);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const lessonSnapshot = (unitId = "current") => ({
  data: () => lesson(unitId, 100),
});
const pageSnapshot = (unitId = "current") => ({
  docs: [lessonSnapshot(unitId)],
  size: 1,
});
const treeSnapshot = {
  exists: () => true,
  data: () => ({ tree, contentRevision: 3 }),
};
const loaderFixture = ({ recovery, selectedNodeId = null, nextPage } = {}) => {
  const treeGate = deferred(),
    firstPageGate = deferred();
  const requests = [],
    loaded = [],
    renderedTrees = [],
    errors = [];
  const state = {
    teacherScope: "teacher-a/2026/2",
    teacherScopeRef: { current: "teacher-a/2026/2" },
    treeLoadIdRef: { current: 0 },
    lessonLoadIdRef: { current: 0 },
    editorMountedRef: { current: true },
    treeLoadedRef: { current: false },
    treeRevisionRef: { current: 0 },
    config: { year: "2026", semester: "2" },
    selectedNodeId,
    preloads: 0,
    markLoginPerf() {},
    preloadLessonWorksheetStage() {
      state.preloads++;
      return Promise.resolve();
    },
    lessonWriteRecovery: { peek: () => recovery, acknowledge() {} },
    isLessonDocumentUnconfirmed: (record) => record?.unconfirmed === true,
    setUnconfirmedWrite(value) {
      state.unconfirmed = value;
    },
    setScreenBusyMessage() {},
    setTreeData(value) {
      renderedTrees.push(value);
    },
    setPdfSaveFeedback(value) {
      state.feedback = value;
    },
    setExpandedIds() {},
    setSelectedNodeId() {},
    setSelectedNodeTitle() {},
    setEditorTab() {},
    getSemesterCollectionPath: () => "years/2026/semesters/2/lessons",
    getSemesterDocPath: () => "years/2026/semesters/2/curriculum/tree",
    db: {},
    doc: (_db, path) => ({ path }),
    collection: (_db, path) => ({ path }),
    query: (ref, ...filters) => ({ ...ref, filters }),
    orderBy: (field, direction) => ({ field, direction }),
    limit: (count) => ({ count }),
    startAfter: (cursor) => ({ cursor }),
    getDocFromServer: (ref) => {
      requests.push({ type: "tree", ...ref });
      return treeGate.promise;
    },
    getDocsFromServer: (ref) => {
      requests.push({ type: "page", ...ref });
      return requests.filter((request) => request.type === "page").length === 1
        ? firstPageGate.promise
        : Promise.resolve(nextPage);
    },
    loadLessonContent: async (...args) => loaded.push(args),
    findInitialLessonSelection,
    findLessonTreeSelectionByUnitId,
    lessonWriteFailureMessage: (error) => error.message,
    console: { error: (error) => errors.push(error) },
  };
  return {
    state,
    treeGate,
    firstPageGate,
    requests,
    loaded,
    renderedTrees,
    errors,
    load: createLoader(state),
  };
};

const parallel = loaderFixture();
const initialLoad = parallel.load(true);
assert.deepEqual(parallel.requests.map((request) => request.type).sort(), [
  "page",
  "tree",
]);
parallel.treeGate.resolve(treeSnapshot);
await flush();
assert.equal(
  parallel.renderedTrees.length,
  1,
  "the tree can render before the page arrives",
);
assert.equal(
  parallel.loaded.length,
  0,
  "an unconfirmed document is never displayed",
);
const initialPage = pageSnapshot();
parallel.firstPageGate.resolve(initialPage);
await initialLoad;
assert.equal(
  parallel.requests.length,
  2,
  "initial content reuses the prefetched server snapshot",
);
assert.equal(parallel.loaded[0][0], "current");
assert.equal(parallel.loaded[0][3], initialPage.docs[0]);
assert.equal(parallel.state.treeRevisionRef.current, 3);
assert.equal(
  parallel.state.preloads,
  0,
  "a document without worksheet pages does not preload the editor",
);

const pdfPrefetch = loaderFixture();
const pdfLoad = pdfPrefetch.load(true);
pdfPrefetch.firstPageGate.resolve({
  docs: [
    {
      data: () => ({
        ...lesson("current", 100),
        worksheetPageImages: [{ page: 1 }],
      }),
    },
  ],
  size: 1,
});
await flush();
assert.equal(
  pdfPrefetch.state.preloads,
  1,
  "verified worksheet metadata starts code loading before the tree response",
);
assert.equal(pdfPrefetch.renderedTrees.length, 0);
pdfPrefetch.treeGate.resolve(treeSnapshot);
await pdfLoad;

const paged = loaderFixture({ nextPage: pageSnapshot() });
const pagedLoad = paged.load(true);
paged.firstPageGate.resolve(pageSnapshot("removed"));
paged.treeGate.resolve(treeSnapshot);
await pagedLoad;
assert.deepEqual(
  paged.requests
    .filter((request) => request.type === "page")
    .map(
      (request) => request.filters.find((filter) => "count" in filter).count,
    ),
  [1, 10],
);
assert.equal(paged.loaded[0][0], "current");

const stale = loaderFixture();
const staleLoad = stale.load(true);
stale.state.teacherScopeRef.current = "teacher-b/2026/1";
stale.treeGate.resolve(treeSnapshot);
stale.firstPageGate.reject(new Error("old-scope-permission-denied"));
await staleLoad;
await flush();
assert.equal(stale.loaded.length, 0);
assert.equal(stale.renderedTrees.length, 0);
assert.equal(stale.state.feedback, undefined);

const stalePdf = loaderFixture();
const stalePdfLoad = stalePdf.load(true);
stalePdf.state.lessonLoadIdRef.current++;
stalePdf.firstPageGate.resolve({
  docs: [
    {
      data: () => ({
        ...lesson("current", 100),
        worksheetPageImages: [{ page: 1 }],
      }),
    },
  ],
  size: 1,
});
stalePdf.treeGate.resolve(treeSnapshot);
await stalePdfLoad;
assert.equal(
  stalePdf.state.preloads,
  0,
  "an abandoned selection cannot preload worksheet code",
);
assert.equal(stalePdf.loaded.length, 0);

const failedPage = loaderFixture();
const failedPageLoad = failedPage.load(true);
failedPage.firstPageGate.reject(new Error("permission-denied"));
await flush();
failedPage.treeGate.resolve(treeSnapshot);
await failedPageLoad;
assert.equal(failedPage.loaded.length, 0);
assert.equal(failedPage.state.feedback.tone, "error");
assert.equal(failedPage.errors[0].message, "permission-denied");

const recoveryGate = deferred();
const restoring = loaderFixture({
  recovery: {
    kind: "document",
    input: { unitId: "current" },
    pending: true,
    settled: recoveryGate.promise,
  },
});
const restoreLoad = restoring.load(true);
assert.equal(
  restoring.requests.length,
  0,
  "pending writes block all initial reads",
);
recoveryGate.resolve({ ok: true });
await flush();
assert.deepEqual(
  restoring.requests.map((request) => request.type),
  ["tree"],
);
restoring.treeGate.resolve(treeSnapshot);
await restoreLoad;
assert.equal(restoring.loaded[0][2].recovery.kind, "document");
assert.equal(
  restoring.loaded[0][3],
  undefined,
  "recovery requires its own committed document read",
);

const uncertain = loaderFixture({
  recovery: {
    unconfirmed: true,
    kind: "document",
    settled: Promise.resolve({ ok: false }),
  },
});
await uncertain.load(true);
assert.equal(uncertain.requests.length, 0);
assert.equal(uncertain.state.unconfirmed.unconfirmed, true);

const selected = loaderFixture({ selectedNodeId: "current" });
const selectedLoad = selected.load(false);
assert.deepEqual(
  selected.requests.map((request) => request.type),
  ["tree"],
);
selected.treeGate.resolve(treeSnapshot);
await selectedLoad;
assert.equal(
  selected.loaded.length,
  0,
  "tree refresh preserves the current editor",
);

console.log(
  "PASS: bounded latest selection, deleted references, scoped precedence, legacy/empty, cancellation, readiness, parallel tree/page server reads, snapshot reuse, worksheet-only code preloading, pagination, stale scope, read failure, pending/unconfirmed write barriers and selected editor preservation",
);
