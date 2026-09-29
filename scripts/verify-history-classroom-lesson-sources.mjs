import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const plain = (value) => JSON.parse(JSON.stringify(value));
const reads = [];
let documents = new Map();
let collections = new Map();
const firestore = {
  collection: (_db, path) => path,
  doc: (_db, ...path) => path.join("/"),
  getDoc: async (path) => {
    reads.push(path);
    return {
      exists: () => documents.has(path),
      data: () => documents.get(path),
    };
  },
  getDocs: async (path) => {
    reads.push(path);
    return {
      docs: (collections.get(path) || []).map((data) => ({ data: () => data })),
    };
  },
};
const cache = new Map();
const load = (filename) => {
  const path = resolve(filename);
  if (cache.has(path)) return cache.get(path);
  const exports = {};
  cache.set(path, exports);
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(
    output,
    {
      exports,
      require(name) {
        if (name === "./firebase")
          return {
            db: {},
            getHttpsCallable: () => {
              throw new Error("No network calls in fixture");
            },
          };
        if (name === "firebase/firestore") return firestore;
        assert.ok(name.startsWith("."), `Unexpected dependency ${name}`);
        return load(resolve(dirname(path), `${name}.ts`));
      },
      console,
      URLSearchParams,
    },
    { filename: path },
  );
  return exports;
};

const {
  buildHistoryClassroomLessonSources,
  getHistoryClassroomLessonSelectLevels,
  readHistoryClassroomLessonSources,
  getHistoryClassroomSourceFields,
  getHistoryClassroomSourceId,
} = load("src/lib/historyClassroomLessonSources.ts");
const {
  normalizeHistoryClassroomAssignment,
  normalizeHistoryClassroomResult,
  sanitizeHistoryClassroomAssignmentForWrite,
  mergeHistoryClassroomMapSnapshot,
  summarizeHistoryClassroomAnswers,
} = load("src/lib/historyClassroom.ts");

const tree = [
  {
    id: "root",
    title: "I. 고대 국가",
    children: [
      { id: "later", title: "2. 삼국의 형성", children: [] },
      { id: "earlier", title: "1. 고조선", children: [] },
      { id: "empty", title: "3. 빈 자료", children: [] },
    ],
  },
];
const lesson = (unitId, answer = "고조선") => ({
  unitId,
  title: `${unitId}의 자료 제목`,
  worksheetPageImages: [
    {
      page: 3,
      imageUrl: "https://example.invalid/page3.png",
      width: 1800,
      height: 2400,
    },
    {
      page: 1,
      imageUrl: "https://example.invalid/page1.png",
      width: 1200,
      height: 1600,
    },
  ],
  worksheetBlanks: [
    {
      id: "teacher-blank-original",
      page: 3,
      leftRatio: 0.125,
      topRatio: 0.2,
      widthRatio: 0.15,
      heightRatio: 0.025,
      answer,
      prompt: "나라 이름",
      source: "ocr",
    },
    {
      id: "second",
      page: 1,
      leftRatio: 0.5,
      topRatio: 0.25,
      widthRatio: 0.2,
      heightRatio: 0.05,
      answer: "삼국",
      source: "manual",
    },
  ],
  worksheetTextRegions: [
    { page: 3, left: 100, top: 200, width: 400, height: 40, label: "고조선" },
  ],
});
const scoped = [
  lesson("earlier", "조선"),
  { unitId: "empty", title: "새 학기 빈 자료" },
];
const legacy = [
  lesson("later"),
  lesson("earlier", "기존 정답"),
  lesson("empty"),
  lesson("removed"),
];
const sources = buildHistoryClassroomLessonSources(tree, scoped, legacy);
assert.deepEqual(
  plain(sources.map((source) => source.lessonUnitId)),
  ["later", "earlier"],
  "Preserve teacher curriculum order, omit removed nodes, and keep empty scoped lessons from reviving legacy blanks",
);
assert.deepEqual(plain(sources[0].lessonUnitPath), [
  "I. 고대 국가",
  "2. 삼국의 형성",
]);
assert.equal(
  sources[0].title,
  "2. 삼국의 형성",
  "Use the curriculum label rather than a divergent lesson title",
);
assert.equal(
  sources[1].pdfBlanks[0].answer,
  "조선",
  "Scoped unit wins over legacy",
);
assert.deepEqual(
  plain(sources[0].pdfBlanks[0]),
  {
    id: "teacher-blank-original",
    page: 3,
    left: 225,
    top: 480,
    width: 270,
    height: 60,
    answer: "고조선",
    prompt: "나라 이름",
    source: "ocr",
  },
  "Convert against the corresponding page dimensions without OCR resizing or renumbering",
);
assert.deepEqual(
  plain(sources[0].pdfPageImages.map((page) => page.page)),
  [1, 3],
);
assert.equal(sources[0].pdfBlanks[1].width, 240);
const nestedSources = buildHistoryClassroomLessonSources(
  [
    {
      id: "r1",
      title: "같은 대목차",
      children: [
        {
          id: "m2",
          title: "같은 중목차",
          children: [
            { id: "z", title: "같은 소목차" },
            { id: "x", title: "다음 소목차" },
          ],
        },
        {
          id: "m1",
          title: "다른 중목차",
          children: [{ id: "y", title: "같은 소목차" }],
        },
      ],
    },
    {
      id: "r2",
      title: "같은 대목차",
      children: [
        {
          id: "m3",
          title: "같은 중목차",
          children: [{ id: "v", title: "같은 소목차" }],
        },
      ],
    },
  ],
  [lesson("z"), lesson("x"), lesson("y"), lesson("v"), lesson("r1")],
  [],
);
let levels = getHistoryClassroomLessonSelectLevels(nestedSources, "lesson:x");
assert.deepEqual(plain(levels.map((level) => level.value)), ["r1", "m2", "x"]);
assert.deepEqual(
  plain(levels[0].options.map((option) => option.value)),
  ["r1", "r2"],
  "Duplicate titles must remain distinct by node ID",
);
assert.deepEqual(plain(levels[1].options.map((option) => option.value)), [
  "m2",
  "m1",
  "source:lesson:r1",
]);
assert.deepEqual(
  plain(levels[2].options.map((option) => option.value)),
  ["z", "x"],
  "Only selected ancestors' descendants appear, in teacher order",
);
levels = getHistoryClassroomLessonSelectLevels(nestedSources, "lesson:v");
assert.deepEqual(plain(levels.map((level) => level.value)), ["r2", "m3", "v"]);
assert.equal(levels[2].options.length, 1);
levels = getHistoryClassroomLessonSelectLevels(nestedSources, "lesson:r1");
assert.equal(
  levels[1].value,
  "source:lesson:r1",
  "Parent-node worksheets remain selectable beside their child chapters",
);
levels = getHistoryClassroomLessonSelectLevels(nestedSources, "lesson:deleted");
assert.equal(levels.length, 1);
assert.equal(
  levels[0].value,
  "",
  "Missing snapshots keep a placeholder and allow choosing a new root without guessing by title",
);

const missingPage = lesson("earlier");
missingPage.worksheetPageImages = missingPage.worksheetPageImages.filter(
  (page) => page.page !== 3,
);
assert.equal(
  buildHistoryClassroomLessonSources(tree, [missingPage], []).length,
  0,
  "Reject incomplete page/blank snapshots rather than silently dropping teacher blanks",
);
const badDimensions = lesson("earlier");
badDimensions.worksheetPageImages[0].width = 0;
assert.equal(
  buildHistoryClassroomLessonSources(tree, [badDimensions], []).length,
  0,
);
const unanswered = lesson("earlier", "");
assert.equal(
  buildHistoryClassroomLessonSources(tree, [unanswered], [])[0].pdfBlanks
    .length,
  2,
  "Keep empty answers for save validation, never silently remove blanks",
);

const source = sources[0];
const payload = sanitizeHistoryClassroomAssignmentForWrite({
  ...getHistoryClassroomSourceFields(source),
  title: source.title,
  pdfPageImages: source.pdfPageImages,
  pdfRegions: source.pdfRegions,
  blanks: source.pdfBlanks,
});
const assignment = normalizeHistoryClassroomAssignment(
  "lesson-assignment",
  payload,
);
assert.equal(assignment.sourceType, "lesson");
assert.equal(assignment.mapResourceId, "");
assert.equal(getHistoryClassroomSourceId(assignment), source.id);
assert.deepEqual(
  plain(assignment.lessonUnitPath),
  plain(source.lessonUnitPath),
);
assert.deepEqual(
  plain(assignment.blanks),
  plain(source.pdfBlanks).map((blank) => ({
    ...blank,
    prompt: blank.prompt || "",
  })),
);
assert.equal(
  summarizeHistoryClassroomAnswers(assignment, {
    "teacher-blank-original": "고조선",
    second: "삼국",
  }).percent,
  100,
  "Existing answer checking contract remains usable",
);
const oldMap = normalizeHistoryClassroomAssignment("old-map", {
  mapResourceId: "map-1",
  mapTitle: "한반도",
});
for (const [input, expected] of [
  [0, 0],
  [90, 90],
  [null, 80],
  [undefined, 80],
  ["", 80],
]) {
  const raw = { passThresholdPercent: input };
  assert.equal(
    normalizeHistoryClassroomAssignment("threshold", raw).passThresholdPercent,
    expected,
  );
  assert.equal(
    normalizeHistoryClassroomResult("threshold", raw).passThresholdPercent,
    expected,
  );
  assert.equal(
    sanitizeHistoryClassroomAssignmentForWrite(raw).passThresholdPercent,
    expected,
  );
}
assert.equal(oldMap.sourceType, "map");
assert.equal(getHistoryClassroomSourceId(oldMap), "map-1");
assert.equal(
  mergeHistoryClassroomMapSnapshot(oldMap, {
    pdfPageImages: source.pdfPageImages,
  }).pdfPageImages.length,
  2,
  "Legacy map snapshots still use map fallback",
);
const emptyLesson = { ...assignment, pdfPageImages: [] };
assert.equal(
  mergeHistoryClassroomMapSnapshot(emptyLesson, {
    pdfPageImages: source.pdfPageImages,
  }).pdfPageImages.length,
  0,
  "Lesson snapshots must never borrow map pages",
);

const scope = "years/2031/semesters/2";
documents = new Map([
  [`${scope}/curriculum/tree`, { tree }],
  ["curriculum/tree", { tree: [] }],
]);
collections = new Map([
  [`${scope}/lessons`, scoped],
  ["lessons", legacy],
]);
assert.deepEqual(
  plain(
    await readHistoryClassroomLessonSources({ year: "2031", semester: "2" }),
  ),
  plain(sources),
);
assert.ok(
  reads.includes(`${scope}/lessons`) && !reads.includes("curriculum/tree"),
  "Read selected semester; do not fall back when scoped curriculum exists",
);
documents.set(`${scope}/curriculum/tree`, { tree: [] });
documents.set("curriculum/tree", { tree });
assert.equal(
  (await readHistoryClassroomLessonSources({ year: "2031", semester: "2" }))
    .length,
  0,
  "An intentionally empty scoped tree stays empty",
);
documents.delete(`${scope}/curriculum/tree`);
assert.deepEqual(
  plain(
    await readHistoryClassroomLessonSources({ year: "2031", semester: "2" }),
  ),
  plain(sources),
  "Missing scoped curriculum falls back to legacy",
);

console.log(
  "History classroom lesson source checks passed (curriculum, scope, legacy, coordinates, snapshot roundtrip, map compatibility, scoring).",
);
