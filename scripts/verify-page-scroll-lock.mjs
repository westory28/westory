import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const axisProperties = [
  "overflow-x",
  "overflow-y",
  "overscroll-behavior-x",
  "overscroll-behavior-y",
];

// Small CSSOM fixture: declaration values and priorities belong to each axis.
// Shorthand serialization is empty when one axis is absent or priorities differ.
// The browser fixture also checks restoration with real CSSStyleDeclaration.
class InlineStyle {
  declarations = new Map();
  axes(property) {
    return ["overflow", "overscroll-behavior"].includes(property)
      ? [`${property}-x`, `${property}-y`]
      : null;
  }
  getPropertyValue(property) {
    const axes = this.axes(property);
    if (!axes) return this.declarations.get(property)?.value || "";
    const [x, y] = axes.map((axis) => this.declarations.get(axis));
    if (!x || !y || x.priority !== y.priority) return "";
    return x.value === y.value ? x.value : `${x.value} ${y.value}`;
  }
  getPropertyPriority(property) {
    const axes = this.axes(property);
    if (!axes) return this.declarations.get(property)?.priority || "";
    const [x, y] = axes.map((axis) => this.declarations.get(axis));
    return x && y && x.priority === y.priority ? x.priority : "";
  }
  setProperty(property, value, priority = "") {
    if (!value) return this.removeProperty(property);
    const axes = this.axes(property);
    if (axes) {
      const [x, y = x] = value.split(/\s+/);
      this.setProperty(axes[0], x, priority);
      this.setProperty(axes[1], y, priority);
    } else this.declarations.set(property, { value, priority });
  }
  removeProperty(property) {
    const previous = this.getPropertyValue(property);
    for (const axis of this.axes(property) || [property])
      this.declarations.delete(axis);
    return previous;
  }
  get overflow() {
    return this.getPropertyValue("overflow");
  }
  set overflow(value) {
    this.setProperty("overflow", value);
  }
}

const makePage = () => ({
  body: { style: new InlineStyle() },
  documentElement: { style: new InlineStyle() },
});
const snapshot = (page) =>
  [page.documentElement.style, page.body.style].map((style) =>
    axisProperties.map((property) => [
      property,
      style.getPropertyValue(property),
      style.getPropertyPriority(property),
    ]),
  );
const assertLocked = (page) => {
  for (const element of [page.documentElement, page.body]) {
    for (const axis of ["overflow-x", "overflow-y"])
      assert.equal(element.style.getPropertyValue(axis), "hidden");
    for (const axis of ["overscroll-behavior-x", "overscroll-behavior-y"])
      assert.equal(element.style.getPropertyValue(axis), "contain");
  }
};
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const makeRuntime = (page = makePage()) => {
  const listeners = new Map();
  const context = vm.createContext({
    exports: {},
    document: page,
    mobileMenuOpen: true,
    previewOpen: true,
    open: true,
    onClose: () => {},
    window: {
      addEventListener: (type, handler) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(handler);
      },
      removeEventListener: (type, handler) =>
        listeners.get(type)?.delete(handler),
    },
  });
  vm.runInContext(
    compile(readFileSync("src/lib/pageScrollLock.ts", "utf8")),
    context,
  );
  context.acquirePageScrollLock = context.exports.acquirePageScrollLock;
  return { context, page, listeners, acquire: context.acquirePageScrollLock };
};
const permutations = (items) =>
  items.length === 0
    ? [[]]
    : items.flatMap((item, index) =>
        permutations(items.filter((_, other) => other !== index)).map(
          (rest) => [item, ...rest],
        ),
      );

for (const order of permutations([0, 1, 2, 3])) {
  const { page, acquire } = makeRuntime();
  const baseline = snapshot(page);
  const owners = Array.from({ length: 4 }, acquire);
  for (const [index, owner] of order.entries()) {
    owners[owner]();
    if (index < 3) assertLocked(page);
    else assert.deepEqual(snapshot(page), baseline);
  }
}
console.log(
  "PASS all 24 owner-close orders keep scrolling locked until the final release",
);

{
  const { page, acquire } = makeRuntime();
  const baseline = snapshot(page);
  const abandoned = acquire();
  abandoned();
  const current = acquire();
  abandoned();
  assertLocked(page);
  const nested = acquire();
  current();
  current();
  assertLocked(page);
  nested();
  nested();
  assert.deepEqual(snapshot(page), baseline);
  for (let index = 0; index < 5; index++) {
    const strictCleanup = acquire();
    strictCleanup();
    const remounted = acquire();
    strictCleanup();
    assertLocked(page);
    remounted();
    assert.deepEqual(snapshot(page), baseline);
  }
}
console.log(
  "PASS duplicate cleanup, StrictMode setup/cleanup/remount, and stale cleanup after reacquisition",
);

for (const seed of [
  (page) => page.body.style.setProperty("overflow-y", "scroll", "important"),
  (page) => {
    page.body.style.setProperty("overflow-x", "clip");
    page.body.style.setProperty("overflow-y", "auto", "important");
    page.body.style.setProperty("overscroll-behavior-x", "none", "important");
    page.documentElement.style.setProperty(
      "overflow",
      "visible scroll",
      "important",
    );
    page.documentElement.style.setProperty("overscroll-behavior-y", "auto");
  },
]) {
  const { page, acquire } = makeRuntime();
  seed(page);
  const baseline = snapshot(page);
  const first = acquire();
  const second = acquire();
  page.body.style.setProperty("color", "red", "important");
  first();
  assertLocked(page);
  second();
  assert.deepEqual(snapshot(page), baseline);
  assert.equal(page.body.style.getPropertyValue("color"), "red");
  assert.equal(page.body.style.getPropertyPriority("color"), "important");
}
console.log(
  "PASS single-axis, mixed shorthand/axis, per-axis !important, absent declarations, and unrelated live styles",
);

{
  const { context, page: first, acquire } = makeRuntime();
  const second = makePage();
  const releaseFirst = acquire();
  context.document = second;
  const releaseSecond = acquire();
  releaseFirst();
  assert.equal(first.body.style.getPropertyValue("overflow-y"), "");
  assertLocked(second);
  releaseSecond();
  assert.equal(second.body.style.getPropertyValue("overflow-y"), "");
  delete context.document;
  const noDocument = acquire();
  noDocument();
  noDocument();
}
console.log("PASS isolated documents and safe server-side invocation");

const sourceEffects = new Map();
const readLockEffect = (file) => {
  if (sourceEffects.has(file)) return sourceEffects.get(file);
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const callbacks = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "useEffect" &&
      node.arguments[0]?.getText(source).includes("acquirePageScrollLock(")
    )
      callbacks.push(node.arguments[0].getText(source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(
    callbacks.length,
    1,
    `${file}: expected exactly one shared scroll-lock effect`,
  );
  sourceEffects.set(file, callbacks[0]);
  return callbacks[0];
};
const runEffect = (runtime, file, values = {}) => {
  Object.assign(runtime.context, values);
  vm.runInContext(
    compile(`globalThis.lockEffect = (${readLockEffect(file)});`),
    runtime.context,
  );
  return runtime.context.lockEffect();
};
const header = "src/components/common/Header.tsx";
const promotion = "src/components/common/StudentRankPromotionPopup.tsx";
const products = "src/pages/teacher/components/points/PointProductsTab.tsx";
const detail = "src/components/common/WisProductDetailModal.tsx";

for (const [firstFile, secondFile] of [
  [header, promotion],
  [products, detail],
]) {
  for (const closeParentFirst of [true, false]) {
    const runtime = makeRuntime();
    const baseline = snapshot(runtime.page);
    const first = runEffect(runtime, firstFile);
    const second = runEffect(runtime, secondFile);
    const order = closeParentFirst ? [first, second] : [second, first];
    order[0]();
    assertLocked(runtime.page);
    order[1]();
    assert.deepEqual(snapshot(runtime.page), baseline);
    assert.equal(
      [...runtime.listeners.values()].reduce((sum, set) => sum + set.size, 0),
      0,
    );
  }
}
// Initial mounting runs child effects first; normal user opening is parent first.
{
  const runtime = makeRuntime();
  const child = runEffect(runtime, detail);
  const parent = runEffect(runtime, products);
  parent();
  assertLocked(runtime.page);
  child();
  assert.equal(runtime.page.body.style.getPropertyValue("overflow-y"), "");
  for (const [file, values] of [
    [header, { mobileMenuOpen: false }],
    [promotion, { open: false }],
    [products, { previewOpen: false }],
    [detail, { open: false }],
  ])
    assert.equal(runEffect(runtime, file, values), undefined);
  assert.equal(runtime.page.body.style.getPropertyValue("overflow-y"), "");
}
console.log(
  "PASS real Header/rank and teacher preview/detail effects across sequential-open unmount and initial child-first mount",
);

const lockOwners = [
  header,
  promotion,
  products,
  detail,
  "src/components/common/MapViewer.tsx",
  "src/components/common/PdfMapViewer.tsx",
  "src/components/common/weplay/WeplayGuide.tsx",
  "src/components/public-entry/PublicEntry.tsx",
  "src/pages/student/weplay/WeplayRecordsDialog.tsx",
  "src/pages/teacher/components/EventModal.tsx",
  "src/pages/teacher/components/NoticeManagerModal.tsx",
];
for (const file of lockOwners) readLockEffect(file);
console.log("PASS all 11 page-lock owners use the shared lifecycle");
console.log("Page scroll lock: 6 groups passed; no browser or backend writes.");
