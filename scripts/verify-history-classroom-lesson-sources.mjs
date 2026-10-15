import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const plain = (value) => JSON.parse(JSON.stringify(value));
const reads = [];
const commands = [];
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
const serverReads = [];
firestore.getDocFromServer = async (path) => {
  serverReads.push(path);
  return firestore.getDoc(path);
};
firestore.getDocsFromServer = async (path) => {
  serverReads.push(path);
  return firestore.getDocs(path);
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
        if (name === "./assessmentLifecycle")
          return {
            executeAssessmentManagementCommand: async (
              commandType,
              payload,
            ) => {
              commands.push({
                actor: "teacher",
                commandType,
                payload: plain(payload),
              });
              return {
                createdCount: payload.recipientUids?.length,
                exemptionIds: ["token-1"],
              };
            },
            executeStudentAssessmentCommand: async (commandType, payload) => {
              commands.push({
                actor: "student",
                commandType,
                payload: plain(payload),
              });
              return { requestId: "request-1" };
            },
          };
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
  getHistoryClassroomBlankRenderRect,
  summarizeHistoryClassroomAnswers,
  grantHistoryClassroomExemptions,
  createHistoryClassroomExemptionRequest,
  reviewHistoryClassroomExemptionRequest,
  revokeHistoryClassroomExemptions,
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
const inkClip = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 0.4 },
  { x: 0.9987, y: 0.4 },
  { x: 0.9987, y: 0.6 },
  { x: 1, y: 0.6 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
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
      inkClip,
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
const duplicateSources = buildHistoryClassroomLessonSources(
  tree,
  [lesson("earlier", "첫 자료"), lesson("earlier", "중복 자료")],
  [lesson("later", "첫 구 자료"), lesson("later", "중복 구 자료")],
);
assert.equal(duplicateSources[0].pdfBlanks[0].answer, "첫 구 자료");
assert.equal(
  duplicateSources[1].pdfBlanks[0].answer,
  "첫 자료",
  "Match the lesson editor's first matching document per unit and scope",
);
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
    inkClip,
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
assert.deepEqual(
  plain(assignment.blanks[0].inkClip),
  inkClip,
  "Lesson contour survives history snapshot save and reload",
);
assert.equal(
  "inkClip" in assignment.blanks[1],
  false,
  "Manual blanks stay unchanged",
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
assert.throws(
  () => getHistoryClassroomSourceFields({ id: "map-1", title: "한반도" }),
  /수업 자료만/,
  "New assignments cannot select or clone map resources",
);
const detachedMap = normalizeHistoryClassroomAssignment("detached-map", {
  mapResourceId: "map-1",
  mapTitle: "이전 지도",
  pdfPageImages: source.pdfPageImages,
  blanks: source.pdfBlanks,
  // Three production map assignments have no stored OCR regions.
});
assert.deepEqual(plain(detachedMap.pdfRegions), []);
assert.equal(
  summarizeHistoryClassroomAnswers(detachedMap, {
    "teacher-blank-original": "고조선",
    second: "삼국",
  }).percent,
  100,
  "Legacy snapshot answers remain usable without OCR regions",
);
for (const blank of detachedMap.blanks) {
  const page = detachedMap.pdfPageImages.find(
    (item) => item.page === blank.page,
  );
  const rect = getHistoryClassroomBlankRenderRect(
    blank,
    page,
    detachedMap.pdfRegions,
  );
  assert(
    [rect.leftRatio, rect.topRatio, rect.widthRatio, rect.heightRatio].every(
      Number.isFinite,
    ),
  );
  assert(
    rect.widthRatio > 0 && rect.heightRatio > 0,
    "Stored blank coordinates render without live OCR data",
  );
}
assert.deepEqual(
  plain(sanitizeHistoryClassroomAssignmentForWrite(detachedMap).pdfPageImages),
  plain(detachedMap.pdfPageImages),
);
assert.deepEqual(
  plain(sanitizeHistoryClassroomAssignmentForWrite(detachedMap).blanks),
  plain(detachedMap.blanks),
);
for (const filename of [
  "src/pages/teacher/ManageHistoryClassroom.tsx",
  "src/pages/student/history-classroom/HistoryClassroomRunner.tsx",
]) {
  const code = readFileSync(filename, "utf8");
  assert(
    !/map_resources|mergeHistoryClassroomMapSnapshot|updateMapResourceBlanks/u.test(
      code,
    ),
    `${filename}: live map coupling remains`,
  );
}

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

await readHistoryClassroomLessonSources({ year: "2031", semester: "2" }, true);
assert.ok(
  serverReads.includes(`${scope}/lessons`) &&
    serverReads.includes("curriculum/tree"),
  "Explicit refresh reads the server, including the legacy fallback",
);

const grant = await grantHistoryClassroomExemptions(
  { year: "2031", semester: "2" },
  {
    recipientUids: ["student-b", "student-a", "student-a"],
    classId: " 3-2 ",
    targetGrade: " 3 ",
    targetClass: " 2 ",
    reason: " 학급 활동 ",
  },
);
assert.equal(grant.createdCount, 2);
assert.deepEqual(
  commands.at(-1),
  {
    actor: "teacher",
    commandType: "grantHistoryClassroomExemptions",
    payload: {
      semesterId: "2031-2",
      recipientUids: ["student-a", "student-b"],
      classId: "3-2",
      targetGrade: "3",
      targetClass: "2",
      reason: "학급 활동",
    },
  },
  "Grant exact selected students through the receipt-protected canonical gateway",
);
const firstGrantPayload = commands.at(-1).payload;
await grantHistoryClassroomExemptions(
  { year: "2031", semester: "2" },
  { ...firstGrantPayload, recipientUids: ["student-a", "student-b"] },
);
assert.deepEqual(
  commands.at(-1).payload,
  firstGrantPayload,
  "Recipient ordering must not create a different retry identity",
);
await createHistoryClassroomExemptionRequest(
  { year: "2031", semester: "2" },
  { assignmentId: "assignment", exemptionId: "token-1" },
);
assert.equal(commands.at(-1).actor, "student");
assert.equal(commands.at(-1).payload.semesterId, "2031-2");
await reviewHistoryClassroomExemptionRequest(
  { year: "2031", semester: "2" },
  { requestId: "request-1", approved: true },
);
assert.equal(commands.at(-1).actor, "teacher");
assert.equal(commands.at(-1).payload.approved, true);
await revokeHistoryClassroomExemptions({ year: "2031", semester: "2" }, [
  "token-1",
  "token-1",
]);
assert.deepEqual(commands.at(-1).payload.exemptionIds, ["token-1"]);

console.log(
  "History classroom lesson source checks passed (curriculum, scope, legacy, coordinates, snapshot roundtrip, map compatibility, scoring).",
);
