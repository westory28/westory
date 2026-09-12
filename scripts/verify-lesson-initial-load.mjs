import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

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
      assert.equal(pageSize, 10);
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
    Array.from({ length: 10 }, (_, i) => lesson(`removed-${i}`, 100 - i)),
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

console.log(
  "PASS: bounded latest selection, deleted references, later pages, scoped precedence, legacy/empty, cancellation, read errors, bootstrap readiness and failure",
);
