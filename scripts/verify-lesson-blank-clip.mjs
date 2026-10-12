import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { build } from "esbuild";

const compile = (path, modules) => {
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
      require(name) {
        assert.ok(name in modules, `Unexpected dependency: ${name}`);
        return modules[name];
      },
      console,
    },
    { filename: path },
  );
  return exports;
};
const clipModule = compile("src/lib/lessonBlankClip.ts", {});
const { normalizeLessonBlankClip, getLessonBlankClipPath } = clipModule;
const worksheet = compile("src/lib/lessonWorksheet.ts", {
  "./lessonBlankClip": clipModule,
});
const plain = (value) => JSON.parse(JSON.stringify(value));
// A tiny right-edge cut-in, relative to the blank, preserves a curved neighbour.
const clip = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 0.4 },
  { x: 0.998731239742, y: 0.4 },
  { x: 0.998731239742, y: 0.6 },
  { x: 1, y: 0.6 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];
const rect = {
  leftRatio: 0.1,
  topRatio: 0.2,
  widthRatio: 0.3,
  heightRatio: 0.04,
  inkClip: clip,
};
const blank = {
  id: "clipped",
  page: 1,
  ...rect,
  answer: "이조전랑",
  source: "ocr",
};
const cssClip = getLessonBlankClipPath(clip);
assert.deepEqual(plain(normalizeLessonBlankClip(clip)), clip);
assert.match(cssClip, /^polygon\(evenodd, /);
assert.match(cssClip, /99\.8731239742% 40%/);
assert.equal(
  getLessonBlankClipPath([
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]),
  "polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%)",
  "Simple rectangular clips keep their original geometry",
);
// Same-orientation outer and inner rings joined by a zero-width return bridge.
// Repeated bridge points must survive normalization; evenodd makes the inner
// ring a hole without changing the persisted array-of-point-maps schema.
const ringClip = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: 0, y: 0 },
  { x: 0.25, y: 0.25 },
  { x: 0.75, y: 0.25 },
  { x: 0.75, y: 0.75 },
  { x: 0.25, y: 0.75 },
  { x: 0.25, y: 0.25 },
  { x: 0, y: 0 },
];
assert.deepEqual(plain(normalizeLessonBlankClip(ringClip)), ringClip);
assert.equal(
  getLessonBlankClipPath(ringClip),
  "polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, 25% 25%, 75% 25%, 75% 75%, 25% 75%, 25% 25%, 0% 0%)",
);
const [ringReloaded] = worksheet.normalizeWorksheetBlanks(
  plain([{ ...blank, inkClip: ringClip }]),
);
assert.deepEqual(plain(ringReloaded.inkClip), ringClip);
assert.notEqual(
  normalizeLessonBlankClip(clip),
  clip,
  "Persisted points must be copied",
);
const malformed = [
  undefined,
  null,
  [],
  clip.slice(0, 2),
  Array.from({ length: 2049 }, () => ({ x: 0, y: 0 })),
  [...clip, { x: NaN, y: 0 }],
  [...clip, { x: 0, y: Infinity }],
  [...clip, { x: -0.00001, y: 0 }],
  [...clip, { x: 1.00001, y: 0 }],
  [...clip, { x: "1", y: 0 }],
  [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
];
for (const invalid of malformed) {
  assert.equal(normalizeLessonBlankClip(invalid), undefined);
  assert.equal(getLessonBlankClipPath(invalid), undefined);
  const [normalized] = worksheet.normalizeWorksheetBlanks([
    { ...blank, inkClip: invalid },
  ]);
  assert.equal(
    "inkClip" in normalized,
    false,
    "Invalid optional fields must be omitted for Firestore",
  );
}
const [saved] = worksheet.normalizeWorksheetBlanks([blank]);
const [reloaded] = worksheet.normalizeWorksheetBlanks(plain([saved]));
assert.deepEqual(plain(reloaded.inkClip), clip);
assert.equal(getLessonBlankClipPath(reloaded.inkClip), cssClip);
const { inkClip: _clip, ...manual } = {
  ...blank,
  id: "manual",
  source: "manual",
};
assert.equal(
  "inkClip" in worksheet.normalizeWorksheetBlanks([manual])[0],
  false,
);
assert.deepEqual(
  plain(normalizeLessonBlankClip(clip.map((p) => ({ ...p, unused: [] })))),
  clip,
);

const walk = (node) =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : node && typeof node === "object"
      ? [node, ...walk(node.props?.children)]
      : [];
const page = { page: 1, width: 1000, height: 1000, imageUrl: "page.png" };
const selection = { rect, answer: blank.answer, regions: [] };
const makeStage = (props) => {
  const slots = [];
  let cursor = 0;
  const react = {
    Fragment: "fragment",
    createElement: (type, props, ...children) => ({
      type,
      props: { ...props, children },
    }),
    useEffect() {},
    useMemo: (factory) => factory(),
    useState(initial) {
      const i = cursor++;
      if (!(i in slots))
        slots[i] = typeof initial === "function" ? initial() : initial;
      return [
        slots[i],
        (value) => {
          slots[i] = typeof value === "function" ? value(slots[i]) : value;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
  };
  const Stage = compile("src/components/common/LessonWorksheetStage.tsx", {
    react,
    "react-dom": { createPortal: () => null },
    "./WorksheetBlankInput": "WorksheetBlankInput",
    "../../lib/lessonWorksheet": worksheet,
    "../../lib/lessonBlankClip": clipModule,
    "../../lib/lessonTextSelection": {
      findLessonTextAtPoint: () => ({}),
      selectLessonTextDrag: () => selection,
    },
    "../../lib/useLessonTextSelection": {
      useLessonTextSelection: () => ({
        regions: [],
        maskUrl: "mask.png",
        status: "ready",
        retry() {},
      }),
    },
  }).default;
  return () => {
    cursor = 0;
    return Stage({
      pageImages: [page],
      blanks: [reloaded],
      annotationEnabled: false,
      ...props,
    });
  };
};

for (const status of ["", "correct", "wrong"]) {
  const nodes = walk(
    makeStage({
      mode: "student-solve",
      studentAnswers: { clipped: { value: "답", status } },
    })(),
  );
  const outer = nodes.find((n) => n.props["data-blank-box"]);
  const mask = nodes.find((n) => n.props["data-blank-mask"]);
  assert.equal(
    outer.props.style.clipPath,
    undefined,
    "Blank outer wrapper stays outside clipping",
  );
  assert.equal(mask.props.style.clipPath, cssClip);
  assert.doesNotMatch(
    mask.props.className,
    /rounded/,
    "OCR corners must cover the original glyph",
  );
  const input = walk(mask).find((n) => n.type === "WorksheetBlankInput");
  assert.ok(input);
  assert.equal(input.props["aria-invalid"], status === "wrong" || undefined);
  assert.equal(
    input.props.title,
    status === "correct" ? "정답" : status === "wrong" ? "오답" : undefined,
  );
  assert.match(
    input.props.className,
    status === "correct"
      ? /text-blue-600/
      : status === "wrong"
        ? /text-red-600/
        : /text-slate-700/,
  );
  assert.match(mask.props.className, /bg-white/);
  assert.equal(
    walk(outer).some((n) => /-top-3/.test(n.props.className || "")),
    false,
    "The removed status badge must not replace the upstream portal brush feedback",
  );
  assert.equal(
    input.props.onBlur,
    undefined,
    "Blur remains delegated to LessonContent for the portal brush feedback",
  );
  assert.equal(outer.props.style.width, "30%");
  assert.equal(outer.props.style.height, "4%");
}
const manualMask = walk(
  makeStage({ mode: "student-solve", blanks: [manual] })(),
).find((n) => n.props["data-blank-mask"]);
assert.equal(manualMask.props.style.clipPath, undefined);
assert.match(manualMask.props.className, /rounded-md/);

let created;
const renderTeacher = makeStage({
  mode: "teacher-edit",
  teacherTool: "ocr",
  pendingBlank: reloaded,
  onCreateBlankFromSelection: (...args) => {
    created = args;
  },
});
let teacherNodes = walk(renderTeacher());
assert.equal(
  teacherNodes.find((n) => n.type === "button" && n.props["data-blank-box"])
    .props.style.clipPath,
  cssClip,
);
assert.ok(
  teacherNodes.some(
    (n) =>
      /bg-sky-400\/40/.test(n.props.className || "") &&
      n.props.style.clipPath === cssClip,
  ),
);
const pageNode = () =>
  teacherNodes.find(
    (n) =>
      n.props.onPointerDown && n.props.onPointerMove && n.props.onPointerUp,
  );
const host = {
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
  setPointerCapture() {},
  closest: () => null,
};
pageNode().props.ref(host);
const event = (x, y) => ({
  button: 0,
  pointerId: 1,
  pointerType: "mouse",
  clientX: x,
  clientY: y,
  target: host,
  currentTarget: host,
  preventDefault() {},
  stopPropagation() {},
});
pageNode().props.onPointerDown(event(100, 220));
teacherNodes = walk(renderTeacher());
pageNode().props.onPointerMove(event(400, 220));
teacherNodes = walk(renderTeacher());
const preview = teacherNodes.find(
  (n) => "data-ocr-selection-preview" in n.props,
);
assert.equal(preview.props.style.clipPath, cssClip);
assert.ok(
  walk(preview).some((n) => n.type === "img" && n.props.src === "mask.png"),
);
pageNode().props.onPointerUp(event(400, 220));
assert.deepEqual(
  plain(created[1].inkClip),
  clip,
  "Pointer-up must preserve the selected contour",
);
assert.equal(created[2][0].label, blank.answer);
assert.equal(created[3], "ocr");
console.log(
  "PASS blank clip validation, JSON round-trip, exact selection transfer, teacher/live/pending/student masks and delegated answer feedback",
);

const mapBundle = await build({
  entryPoints: ["src/lib/mapResources.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  define: { "import.meta.env": "{}" },
});
const { normalizeMapResource } = await import(
  `data:text/javascript;base64,${Buffer.from(mapBundle.outputFiles[0].text).toString("base64")}`
);
const mapBlank = {
  id: blank.id,
  page: 1,
  left: 100.123,
  top: 200.456,
  width: 300.789,
  height: 40.123,
  answer: blank.answer,
  source: "ocr",
  inkClip: clip,
};
const map = normalizeMapResource("fixture", { pdfBlanks: [mapBlank] });
assert.deepEqual(map.pdfBlanks[0].inkClip, clip);
for (const invalid of malformed) {
  assert.equal(
    "inkClip" in
      normalizeMapResource("fixture", {
        pdfBlanks: [{ ...mapBlank, inkClip: invalid }],
      }).pdfBlanks[0],
    false,
  );
}

// Execute the real teacher conversion helpers, extracted without rendering the
// unrelated classroom management screen or copying their implementations.
const path = "src/pages/teacher/ManageHistoryClassroom.tsx";
const sourceText = readFileSync(path, "utf8");
const ast = ts.createSourceFile(
  path,
  sourceText,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.TSX,
);
const helperNames = [
  "historyBlankToWorksheetBlank",
  "worksheetBlankToHistoryBlank",
  "cloneMapResourceBlanks",
];
const definitions = ast.statements.filter(
  (statement) =>
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some((declaration) =>
      helperNames.includes(declaration.name.getText(ast)),
    ),
);
assert.equal(definitions.length, helperNames.length);
const helperExports = {};
vm.runInNewContext(
  ts.transpileModule(
    definitions.map((node) => node.getText(ast)).join("\n") +
      helperNames.map((name) => `\nexports.${name} = ${name};`).join(""),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText,
  {
    exports: helperExports,
    normalizeLessonBlankClip,
    clampRatio: worksheet.clampRatio,
    inferHistoryClassroomBlankSource: (value) => value.source,
  },
);
const worksheetCopy = helperExports.historyBlankToWorksheetBlank(
  mapBlank,
  page,
);
const historyCopy = helperExports.worksheetBlankToHistoryBlank(
  worksheetCopy,
  page,
);
assert.deepEqual(plain(historyCopy.inkClip), clip);
for (const field of ["left", "top", "width", "height"]) {
  assert.ok(
    Math.abs(historyCopy[field] - mapBlank[field]) < 1e-9,
    `Clipped ${field} must not be rounded`,
  );
}
assert.deepEqual(
  plain(helperExports.cloneMapResourceBlanks(map)[0].inkClip),
  clip,
);
assert.deepEqual(
  plain(
    helperExports.cloneMapResourceBlanks({ ...map, lessonUnitId: "unit" })[0]
      .inkClip,
  ),
  clip,
);
console.log(
  "PASS map normalization and teacher PDF/worksheet conversions preserve subpixel contour geometry",
);

const history = compile("src/lib/historyClassroom.ts", {
  "./firebase": {},
  "./semesterScope": {},
  "./lessonWorksheet": worksheet,
  "./lessonBlankClip": clipModule,
});
const exactHistoryRect = history.getHistoryClassroomBlankRenderRect(
  mapBlank,
  page,
  [],
);
assert.equal(exactHistoryRect.leftRatio, mapBlank.left / page.width);
assert.equal(exactHistoryRect.widthRatio, mapBlank.width / page.width);
assert.deepEqual(plain(exactHistoryRect.inkClip), clip);
const staticReact = {
  Fragment: "fragment",
  createElement: (type, props, ...children) => ({
    type,
    props: { ...props, children },
  }),
  useEffect() {},
  useLayoutEffect() {},
  useMemo: (factory) => factory(),
  useId: () => "fixture-id",
  useRef: (value) => ({ current: value }),
  useState: (value) => [
    typeof value === "function" ? value() : value,
    () => {},
  ],
};
const HistoryView = compile(
  "src/components/common/HistoryClassroomAssignmentView.tsx",
  {
    react: staticReact,
    "./WorksheetBlankInput": "WorksheetBlankInput",
    "./HistoryBlankFeedback": "HistoryBlankFeedback",
    "../../lib/historyClassroom": history,
    "../../lib/lessonBlankClip": clipModule,
  },
).default;
for (const sourceType of ["lesson", "map"]) {
  const nodes = walk(
    HistoryView({
      assignment: {
        id: "fixture",
        sourceType,
        blanks: [mapBlank, { ...mapBlank, id: "overlap" }],
        pdfPageImages: [page],
        answerOptions: [],
        passThresholdPercent: 80,
      },
      currentPage: 1,
      answers: {},
      onCurrentPageChange() {},
      onAnswerChange() {},
      resolveBlankOverlap: true,
    }),
  );
  const boxes = nodes.filter((n) => n.props["data-blank-box"]);
  assert.equal(boxes.length, 2);
  for (const box of boxes) {
    assert.equal(box.props.style.clipPath, cssClip);
    assert.equal(box.props.style.borderRadius, 0);
    assert.ok(
      Math.abs(parseFloat(box.props.style.left) - mapBlank.left) < 1e-9,
      "Clipped blanks must not move to resolve overlap",
    );
    assert.ok(
      Math.abs(parseFloat(box.props.style.width) - mapBlank.width) < 1e-9,
    );
  }
}
console.log(
  "PASS history classroom lesson/map rendering keeps clipped backgrounds at exact saved coordinates",
);
