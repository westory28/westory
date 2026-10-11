import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = (path, modules, globals = {}) => {
  const exports = {};
  const source = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(
    source,
    {
      exports,
      require: (name) => {
        assert.ok(name in modules, `Unexpected dependency: ${name}`);
        return modules[name];
      },
      console,
      ...globals,
    },
    { filename: path },
  );
  return exports;
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const scopePath = "years/2026/semesters/2/lessons";
const tree = [
  {
    id: "root",
    title: "대단원",
    children: [
      {
        id: "middle",
        title: "중단원",
        children: [
          { id: "A", title: "자료 A", children: [] },
          { id: "B", title: "자료 B", children: [] },
        ],
      },
    ],
  },
];
const makeDoc = (id, data) => ({ id, data: () => data });
const lesson = (id, updatedAt, extra = {}) =>
  makeDoc(id, {
    unitId: id,
    updatedAt,
    title: `자료 ${id}`,
    contentRevision: 7,
    ...extra,
  });
const selection = compile("src/lib/lessonTreeSelection.ts", {});
const makeStore = (collections = {}) => {
  const calls = [];
  const state = {
    collections,
    beforeRead: null,
    metadata: {},
    tree,
    treeRevision: 3,
  };
  const firestore = {
    collection: (_db, path) => ({ path }),
    doc: (_db, ...paths) => ({ path: paths.join("/") }),
    query: (reference, ...constraints) => ({ ...reference, constraints }),
    where: (field, operator, value) => ({
      kind: "where",
      field,
      operator,
      value,
    }),
    orderBy: (field, direction) => ({ kind: "orderBy", field, direction }),
    limit: (count) => ({ kind: "limit", count }),
    startAfter: (snapshot) => ({ kind: "startAfter", snapshot }),
    async getDocFromServer(reference) {
      calls.push({ ...reference, type: "doc" });
      await state.beforeRead?.(reference);
      return {
        exists: () => true,
        data: () => ({ tree: state.tree, contentRevision: state.treeRevision }),
        metadata: { fromCache: false, hasPendingWrites: false },
      };
    },
    async getDocsFromServer(request) {
      calls.push(request);
      await state.beforeRead?.(request);
      let docs = [...(state.collections[request.path] || [])];
      for (const constraint of request.constraints) {
        if (constraint.kind === "where")
          docs = docs.filter(
            (item) => item.data()[constraint.field] === constraint.value,
          );
        if (constraint.kind === "orderBy") {
          assert.equal(constraint.direction, "desc");
          docs = docs
            .filter((item) => item.data()[constraint.field] !== undefined)
            .sort(
              (a, b) => b.data()[constraint.field] - a.data()[constraint.field],
            );
        }
        if (constraint.kind === "startAfter") {
          const index = docs.indexOf(constraint.snapshot);
          assert.ok(
            index >= 0,
            "Pagination must use the actual previous snapshot",
          );
          docs = docs.slice(index + 1);
        }
        if (constraint.kind === "limit") docs = docs.slice(0, constraint.count);
      }
      return {
        docs,
        size: docs.length,
        empty: docs.length === 0,
        metadata: {
          fromCache: false,
          hasPendingWrites: false,
          ...state.metadata,
        },
      };
    },
  };
  const loading = compile("src/lib/teacherLessonLoading.ts", {
    "firebase/firestore": firestore,
    "./firebase": { db: {} },
    "./lessonTreeSelection": selection,
  });
  return { state, calls, firestore, loading };
};
const current = () => true;

{
  const newest = lesson("A", 100);
  const store = makeStore({
    [scopePath]: [newest, lesson("B", 90)],
    lessons: [lesson("B", 200)],
  });
  const found = await store.loading.readLatestTeacherLesson(
    scopePath,
    tree,
    current,
  );
  assert.equal(found.selection.node.id, "A");
  assert.equal(
    found.lesson.snapshot,
    newest,
    "Reuse the server snapshot and revision",
  );
  assert.equal(found.lesson.snapshot.data().contentRevision, 7);
  assert.equal(found.lesson.legacy, false);
  assert.equal(
    store.calls.length,
    1,
    "Do not read legacy or reload selected content",
  );
  assert.equal(
    store.calls[0].constraints.find((item) => item.kind === "limit").count,
    20,
  );
}
{
  const stale = Array.from({ length: 41 }, (_, i) =>
    lesson(`removed-${i}`, 1000 - i),
  );
  const store = makeStore({ [scopePath]: [...stale, lesson("B", 10)] });
  const found = await store.loading.readLatestTeacherLesson(
    scopePath,
    tree,
    current,
  );
  assert.equal(found.selection.node.id, "B");
  assert.equal(
    store.calls.length,
    3,
    "Continue beyond two pages of deleted tree nodes",
  );
  assert.ok(
    store.calls
      .slice(1)
      .every((request) =>
        request.constraints.some((item) => item.kind === "startAfter"),
      ),
  );
}
{
  const archived = lesson("A", 20);
  const store = makeStore({ lessons: [archived] });
  const found = await store.loading.readLatestTeacherLesson(
    scopePath,
    tree,
    current,
  );
  assert.equal(found.lesson.legacy, true);
  assert.equal(found.lesson.snapshot, archived);
  assert.equal(store.calls.filter((call) => call.path === "lessons").length, 1);
  const scopedWithoutTimestamp = lesson("A", undefined, {
    contentRevision: 19,
  });
  store.state.collections[scopePath] = [scopedWithoutTimestamp];
  const scoped = await store.loading.readLatestTeacherLesson(
    scopePath,
    tree,
    current,
  );
  assert.equal(scoped.lesson.snapshot, scopedWithoutTimestamp);
  assert.equal(
    scoped.lesson.legacy,
    false,
    "Scoped data wins even when ordered query excludes it",
  );
}
{
  const store = makeStore({ [scopePath]: [lesson("A", 0)] });
  assert.equal(
    await store.loading.readLatestTeacherLesson(scopePath, tree, current),
    null,
  );
  assert.equal(
    (await store.loading.readTeacherLessonDocument(scopePath, "B", current))
      .snapshot,
    null,
  );
  for (const metadata of [{ hasPendingWrites: true }, { fromCache: true }]) {
    store.state.metadata = metadata;
    await assert.rejects(
      store.loading.readLatestTeacherLesson(scopePath, tree, current),
      /저장 상태/,
    );
    await assert.rejects(
      store.loading.readTeacherLessonDocument(scopePath, "A", current),
      /저장 상태/,
    );
  }
}
{
  const store = makeStore();
  const error = Object.assign(new Error("permission-denied"), {
    code: "permission-denied",
  });
  store.state.beforeRead = () => {
    throw error;
  };
  await assert.rejects(
    store.loading.readLatestTeacherLesson(scopePath, tree, current),
    (value) => value === error,
  );
  assert.equal(
    store.calls.length,
    1,
    "Permission errors must not fall back to legacy",
  );
}
{
  const store = makeStore({
    [scopePath]: Array.from({ length: 30 }, (_, i) =>
      lesson(`removed-${i}`, 100 - i),
    ),
  });
  let active = true;
  store.state.beforeRead = () => {
    active = false;
  };
  assert.equal(
    await store.loading.readLatestTeacherLesson(scopePath, tree, () => active),
    null,
  );
  assert.equal(
    store.calls.length,
    1,
    "Cancel before another page or legacy query",
  );
  active = true;
  assert.equal(
    await store.loading.readTeacherLessonDocument(scopePath, "A", () => active),
    null,
  );
  assert.equal(store.calls.length, 2, "Cancel before legacy fallback");
}
console.log(
  "PASS bounded pagination, snapshot reuse, scoped/legacy priority, empty/error/pending and cancellation",
);

// Execute the actual component's hooks and event handlers with server I/O stubs.
// No DOM or visual layout assertions are implied by this controller harness.
const worksheet = compile("src/lib/lessonWorksheet.ts", {});
const pdf = compile("src/lib/lessonPdfExtraction.ts", {});
const data = compile("src/lib/lessonData.ts", {
  "./lessonWorksheet": worksheet,
  "./lessonPdfExtraction": pdf,
});
const walk = (node) =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : node && typeof node === "object"
      ? [node, ...walk(node.props?.children)]
      : [];
const harness = (store, { processPdfMapFile } = {}) => {
  const slots = [],
    effects = [],
    saves = [],
    uploads = [],
    alerts = [],
    errors = [];
  let cursor = 0,
    dirty = true,
    rendered;
  let subscriptions = 0,
    activeSubscriptions = 0,
    scopeReads = 0;
  let scopeWait;
  const auth = { currentUser: { uid: "teacher" } };
  const authState = {
    currentUser: auth.currentUser,
    userData: { role: "teacher" },
    config: { year: "2026", semester: "2" },
  };
  const commandScope = { semesterId: "2026-2", expectedSemesterRevision: 9 };
  const same = (a, b) =>
    a &&
    b &&
    a.length === b.length &&
    a.every((item, index) => Object.is(item, b[index]));
  const react = {
    Fragment: "fragment",
    createElement: (type, props, ...children) => ({
      type,
      props: { ...props, children },
    }),
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
          if (!Object.is(value, slots[index].value)) {
            slots[index].value = value;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps))
        slots[index] = { value: factory(), deps };
      return slots[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps))
        effects.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { deps, cleanup: effect() };
        });
    },
  };
  react.useCallback = (callback, deps) => react.useMemo(() => callback, deps);
  const browser = {
    addEventListener() {},
    removeEventListener() {},
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    confirm: () => false,
  };
  const panels = Object.fromEntries(
    [
      "FootnoteEditorDialog",
      "LessonEditorHeader",
      "LessonPdfSection",
      "LessonPreviewLauncher",
      "LessonTreePanel",
    ].map((name) => [name, name]),
  );
  const component = compile(
    "src/pages/teacher/ManageLesson.tsx",
    {
      react,
      "../../components/common/PortalWorkspace": "PortalWorkspace",
      "../../components/common/LoadingState": {
        LoadingOverlay: "LoadingOverlay",
      },
      "../../lib/semesterArchive": { isSemesterArchive: false },
      "../../contexts/AuthContext": { useAuth: () => authState },
      "../../lib/firebase": { db: {}, auth },
      "../../lib/lessonManagement": {
        async getLessonCommandScope() {
          scopeReads += 1;
          await scopeWait;
          return { ...commandScope };
        },
        async saveLessonDocument(config, input, context) {
          saves.push({ config, input, context });
          return {
            contentRevision: input.expectedRevision + 1,
            treeRevision: 4,
          };
        },
        async uploadLessonAsset(config, input) {
          uploads.push({ config, input });
          return {
            uploadId: `upload-${uploads.length}`,
            url: `https://worksheet.example/${uploads.length}`,
            storagePath: `assets/${uploads.length}`,
          };
        },
      },
      "../../lib/pdfMapProcessor": { processPdfMapFile },
      "firebase/firestore": store.firestore,
      "firebase/storage": {},
      "../../lib/semesterScope": {
        getSemesterCollectionPath: (config, name) =>
          `years/${config.year}/semesters/${config.semester}/${name}`,
        getSemesterDocPath: (config, name, id) =>
          `years/${config.year}/semesters/${config.semester}/${name}/${id}`,
      },
      "../../lib/lessonWorksheet": worksheet,
      "../../lib/lessonData": data,
      "../../lib/teacherLessonLoading": store.loading,
      "../../lib/lessonPdfExtraction": pdf,
      "../../lib/permissions": { canWriteLessonManagement: () => true },
      "../../lib/notifications": {},
      "../../lib/sourceArchive": {
        subscribeSourceArchiveAssets(next) {
          subscriptions += 1;
          activeSubscriptions += 1;
          next([]);
          return () => {
            activeSubscriptions -= 1;
          };
        },
      },
      "../../lib/sessionActivity": { emitSessionActivity() {} },
      "./components/LessonSourceArchivePickerModal":
        "LessonSourceArchivePickerModal",
      "./components/LessonEditorPanels": panels,
    },
    {
      window: browser,
      URL,
      alert: (value) => alerts.push(value),
      console: { ...console, error: (...values) => errors.push(values) },
    },
  ).default;
  const render = () => {
    let iterations = 0;
    while (dirty) {
      assert.ok(++iterations < 30, "Hooks must stabilize");
      dirty = false;
      cursor = 0;
      rendered = component();
      effects.splice(0).forEach((effect) => effect());
    }
    return rendered;
  };
  const settle = async () => {
    for (let i = 0; i < 30; i++) {
      await Promise.resolve();
      render();
    }
  };
  const find = (type) => {
    const found = walk(render()).find((item) => item.type === type);
    assert.ok(found, `Missing ${type}`);
    return found.props;
  };
  const select = (id) => {
    const panel = find("LessonTreePanel");
    const node = tree[0].children[0].children.find((item) => item.id === id);
    const element = panel.renderTreeNode(node, 2);
    // Keep the nested TreeCard's local tooltip hooks outside the editor slots.
    cursor = slots.length;
    const card = element.type(element.props);
    walk(card)
      .find((item) => item.props?.onClick)
      .props.onClick();
    render();
  };
  return {
    render,
    settle,
    find,
    select,
    auth,
    authState,
    commandScope,
    saves,
    uploads,
    alerts,
    errors,
    setScopeWait: (promise) => {
      scopeWait = promise;
    },
    get scopeReads() {
      return scopeReads;
    },
    get subscriptions() {
      return subscriptions;
    },
    get activeSubscriptions() {
      return activeSubscriptions;
    },
    rerender() {
      dirty = true;
      render();
    },
  };
};

{
  const store = makeStore({ [scopePath]: [lesson("A", 100), lesson("B", 90)] });
  const app = harness(store);
  const scopeGate = deferred();
  app.setScopeWait(scopeGate.promise);
  app.render();
  assert.equal(app.scopeReads, 1);
  assert.equal(
    store.calls[0].type,
    "doc",
    "Tree read starts before scope read completes",
  );
  scopeGate.resolve();
  await app.settle();
  assert.equal(app.find("LessonEditorHeader").lessonTitle, "자료 A");
  assert.equal(app.find("LessonEditorHeader").saveStateTone, "saved");
  assert.equal(
    store.calls.length,
    2,
    "Initial load uses one tree and one bounded lesson query",
  );
  assert.equal(app.scopeReads, 1, "Initial selection reuses its command scope");
  assert.equal(
    app.subscriptions,
    0,
    "Do not subscribe to source archive during lesson load",
  );
  app.find("LessonEditorHeader").onLessonTitleChange("수정한 제목");
  app.render();
  app.find("LessonEditorHeader").onSave();
  await app.settle();
  assert.equal(app.saves[0].input.expectedRevision, 7);
  assert.equal(app.saves[0].input.expectedTreeRevision, 3);
  assert.equal(app.saves[0].context.commandScope.expectedSemesterRevision, 9);
  assert.equal(app.find("LessonEditorHeader").saveStateTone, "saved");
  app.find("LessonPdfSection").onAddFootnote();
  app.render();
  const footnote = app.find("FootnoteEditorDialog");
  footnote.onOpenSourceArchivePicker(footnote.session.draft.id);
  app.render();
  assert.equal(app.activeSubscriptions, 1);
  app.find("LessonSourceArchivePickerModal").onClose();
  app.render();
  assert.equal(app.activeSubscriptions, 0);
  assert.equal(app.errors.length, 0);
}
console.log(
  "PASS actual editor initial parallel reads, snapshot/revision/scope reuse and on-demand archive subscription",
);

{
  const store = makeStore({
    [scopePath]: [lesson("A", 100), lesson("B", 90, { pdfName: "B.pdf" })],
  });
  const app = harness(store);
  app.render();
  await app.settle();
  const scopeGate = deferred();
  app.setScopeWait(scopeGate.promise);
  const readGate = deferred();
  store.state.beforeRead = (request) =>
    request.constraints?.some((item) => item.value === "B")
      ? readGate.promise
      : undefined;
  const before = store.calls.length;
  app.select("B");
  assert.equal(app.scopeReads, 2);
  assert.equal(
    store.calls.length,
    before + 1,
    "Selected document read starts without waiting for scope",
  );
  readGate.resolve();
  await app.settle();
  assert.equal(
    app.find("LessonPdfSection").lessonPdfName,
    "",
    "Wait for both responses before applying edit context",
  );
  scopeGate.resolve();
  await app.settle();
  assert.equal(app.find("LessonPdfSection").lessonPdfName, "B.pdf");
  assert.equal(app.find("LessonEditorHeader").saveStateTone, "saved");
  app.find("LessonEditorHeader").onLessonTitleChange("미저장 자료 B");
  app.render();
  const callsBeforeCancel = store.calls.length;
  app.select("A");
  await app.settle();
  assert.equal(
    store.calls.length,
    callsBeforeCancel,
    "Declining discard keeps edits without issuing reads",
  );
  assert.equal(app.find("LessonEditorHeader").lessonTitle, "미저장 자료 B");
  assert.equal(app.find("LessonEditorHeader").saveStateTone, "dirty");
  assert.equal(app.errors.length, 0);
}
{
  const store = makeStore({
    [scopePath]: [lesson("A", 100), lesson("B", 90, { pdfName: "stale.pdf" })],
  });
  const app = harness(store);
  app.render();
  await app.settle();
  const gate = deferred();
  store.state.beforeRead = (request) =>
    request.constraints?.some((item) => item.value === "B")
      ? gate.promise
      : undefined;
  app.select("B");
  app.auth.currentUser = { uid: "another-teacher" };
  gate.resolve();
  await app.settle();
  assert.equal(
    app.find("LessonPdfSection").lessonPdfName,
    "",
    "Never apply a previous user's in-flight lesson",
  );
  assert.equal(app.errors.length, 0);
}
{
  const nextPath = "years/2027/semesters/1/lessons";
  const store = makeStore({
    [scopePath]: [
      lesson("A", 100),
      lesson("B", 90, { pdfName: "old-semester.pdf" }),
    ],
    [nextPath]: [lesson("B", 200, { pdfName: "current-semester.pdf" })],
  });
  const app = harness(store);
  app.render();
  await app.settle();
  const gate = deferred();
  store.state.beforeRead = (request) =>
    request.path === scopePath &&
    request.constraints?.some((item) => item.value === "B")
      ? gate.promise
      : undefined;
  app.select("B");
  app.authState.config = { year: "2027", semester: "1" };
  app.commandScope.semesterId = "2027-1";
  app.commandScope.expectedSemesterRevision = 10;
  app.rerender();
  await app.settle();
  assert.equal(
    app.find("LessonPdfSection").lessonPdfName,
    "current-semester.pdf",
  );
  gate.resolve();
  await app.settle();
  assert.equal(
    app.find("LessonPdfSection").lessonPdfName,
    "current-semester.pdf",
    "Late old-semester response must not replace the current lesson",
  );
  assert.equal(app.find("LessonEditorHeader").saveStateTone, "saved");
  assert.equal(app.errors.length, 0);
}
console.log(
  "PASS selected-document parallel reads, dirty-state protection and stale user/semester response rejection",
);

{
  const store = makeStore({ [scopePath]: [lesson("A", 100)] });
  const fileA = { name: "prepared-A.pdf", type: "application/pdf" };
  const fileB = { name: "replacement-B.pdf", type: "application/pdf" };
  const blobA = new Blob(["page A"], { type: "image/png" });
  const blobB = new Blob(["page B"], { type: "image/png" });
  const gate = deferred();
  let failB = true;
  const app = harness(store, {
    async processPdfMapFile(file) {
      if (file === fileB && failB) {
        await gate.promise;
        throw new Error("PDF B later-page rendering failed");
      }
      return {
        pageImages: [
          {
            page: 1,
            width: file === fileA ? 800 : 900,
            height: file === fileA ? 1000 : 1200,
            blob: file === fileA ? blobA : blobB,
          },
        ],
        regions: [],
      };
    },
  });
  app.render();
  await app.settle();
  app.find("LessonPdfSection").onPdfFileChange(fileA);
  await app.settle();
  const pagesA = app.find("LessonPdfSection").worksheetPageImages;
  assert.equal(app.find("LessonPdfSection").teacherPdfSource, fileA);
  assert.equal(pagesA[0].width, 800);

  app.find("LessonPdfSection").onPdfFileChange(fileB);
  await app.settle();
  assert.equal(app.find("LessonPdfSection").pdfBusy, true);
  assert.equal(app.find("LessonPdfSection").teacherPdfSource, undefined);
  assert.equal(app.find("LessonPdfSection").worksheetPageImages, pagesA);
  app.find("LessonPdfSection").onSavePdf();
  await app.settle();
  assert.equal(
    app.uploads.length,
    0,
    "Do not upload B with A pages during preparation",
  );
  assert.equal(app.saves.length, 0);
  assert.match(app.alerts.at(-1), /PDF 페이지 추출/);

  gate.resolve();
  await app.settle();
  assert.equal(app.find("LessonPdfSection").pdfBusy, false);
  assert.equal(app.find("LessonPdfSection").selectedPdfFile, fileB);
  assert.equal(app.find("LessonPdfSection").teacherPdfSource, undefined);
  assert.equal(app.find("LessonPdfSection").worksheetPageImages, pagesA);
  assert.equal(
    app.errors.length,
    1,
    "Only the simulated rendering failure is logged",
  );
  assert.match(app.errors[0][0].message, /PDF B later-page rendering failed/);
  app.find("LessonPdfSection").onSavePdf();
  await app.settle();
  assert.equal(
    app.uploads.length,
    0,
    "Failed preparation must not upload a mismatched PDF/page pair",
  );
  assert.equal(
    app.saves.length,
    0,
    "The mismatched pair must not persist across reload",
  );
  assert.match(app.alerts.at(-1), /PDF 페이지 추출/);

  failB = false;
  app.find("LessonPdfSection").onPreparePdf();
  await app.settle();
  assert.equal(app.find("LessonPdfSection").teacherPdfSource, fileB);
  assert.equal(app.find("LessonPdfSection").worksheetPageImages[0].width, 900);
  app.find("LessonPdfSection").onSavePdf();
  await app.settle();
  assert.equal(app.uploads.length, 2);
  assert.equal(app.uploads[0].input.file, fileB);
  assert.equal(
    app.uploads[1].input.file,
    blobB,
    "Retry must upload B's own rendered page",
  );
  assert.equal(app.saves.length, 1);
  const saved = app.saves[0].input.document;
  assert.equal(saved.pdfUrl, "https://worksheet.example/1");
  assert.equal(
    saved.worksheetPageImages[0].imageUrl,
    "https://worksheet.example/2",
  );
  assert.equal(saved.worksheetPageImages[0].width, 900);
  assert.equal(app.find("LessonPdfSection").teacherPdfSource, saved.pdfUrl);
  const reloaded = harness(
    makeStore({ [scopePath]: [lesson("A", 200, saved)] }),
  );
  reloaded.render();
  await reloaded.settle();
  assert.equal(
    reloaded.find("LessonPdfSection").teacherPdfSource,
    saved.pdfUrl,
  );
  assert.equal(
    reloaded.find("LessonPdfSection").worksheetPageImages[0].width,
    900,
  );
  assert.equal(reloaded.errors.length, 0);
}
console.log(
  "PASS replacement PDF preparation blocks mismatched OCR/upload/save and recovers with a matched retry and reload",
);
