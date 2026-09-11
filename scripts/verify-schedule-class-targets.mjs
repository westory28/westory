import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";

// Production helpers and UI handlers, with in-memory boundaries only.
// The exported server query uses simulated session authorization; no SDK I/O.
const require = createRequire(import.meta.url);
const source = (path) => readFileSync(resolve(path), "utf8");
const compile = (text, name = "fixture.tsx") => {
  const result = ts.transpileModule(text, {
    fileName: name,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  assert.equal(
    (result.diagnostics || []).filter(
      (d) => d.category === ts.DiagnosticCategory.Error,
    ).length,
    0,
    name,
  );
  return result.outputText;
};
const helpers = {};
new Function("exports", compile(source("src/lib/scheduleClassTargets.ts")))(
  helpers,
);
const {
  buildScheduleClassOptions,
  projectScheduleTargets,
  resolveScheduleTargets,
  formatScheduleTargetLabel,
  PRESERVE_SCHEDULE_TARGETS,
} = helpers;
const extract = (path, name, bindings) => {
  const text = source(path);
  const file = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let initializer;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name)
      initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(initializer, `${path}:${name}`);
  return new Function(
    ...Object.keys(bindings),
    `${compile(`const run = ${initializer.getText(file)};`)}; return run;`,
  )(...Object.values(bindings));
};

const semesterId = "2026-2";
const classId = "b3ui-mtx02ete-99704cb61a761291-class";
const otherId = "canonical-second-class";
const record = (id, number, extra = {}) => ({
  classId: id,
  semesterId,
  grade: "3",
  classNumber: number,
  displayName: `합성 ${number}반`,
  status: "ACTIVE",
  ...extra,
});
const classes = buildScheduleClassOptions(semesterId, [
  record(classId, "98"),
  record(otherId, "99"),
  record("inactive", "97", { status: "INACTIVE" }),
]);
assert.equal(
  classes.find((item) => item.value === classId).label,
  "3학년 98반",
);
assert.throws(() =>
  buildScheduleClassOptions("2027-1", [record(classId, "98")]),
);
assert.throws(() =>
  buildScheduleClassOptions(semesterId, [
    record(classId, "98"),
    record(classId, "99"),
  ]),
);
assert.ok(
  buildScheduleClassOptions(semesterId, [
    record("a", "98"),
    record("b", "98"),
  ]).every((item) => !item.selectable),
);
const original = Object.freeze({
  targetClassIds: Object.freeze([otherId, classId]),
  targetUserIds: Object.freeze(["student-b", "student-a"]),
});
const base = {
  original,
  selectionChanged: false,
  targetType: "class",
  targetClass: PRESERVE_SCHEDULE_TARGETS,
  classes,
};
assert.deepEqual(resolveScheduleTargets(base), original);
assert.deepEqual(
  resolveScheduleTargets({ ...base, targetType: "common" }),
  original,
  "unmodified target form cannot broadcast",
);
assert.deepEqual(
  resolveScheduleTargets({
    ...base,
    selectionChanged: true,
    targetClass: classId,
  }),
  { targetClassIds: [classId], targetUserIds: [...original.targetUserIds] },
);
assert.deepEqual(
  resolveScheduleTargets({
    ...base,
    selectionChanged: true,
    targetType: "common",
  }),
  { targetClassIds: [], targetUserIds: [] },
);
for (const targetClass of [
  "",
  "unknown",
  "inactive",
  PRESERVE_SCHEDULE_TARGETS,
]) {
  assert.throws(() =>
    resolveScheduleTargets({
      ...base,
      original: null,
      selectionChanged: true,
      targetClass,
    }),
  );
}
assert.deepEqual(
  resolveScheduleTargets({ ...base, original: null, targetClass: classId }),
  { targetClassIds: [classId], targetUserIds: [] },
);
const projected = projectScheduleTargets(
  original.targetClassIds,
  original.targetUserIds,
  classes,
);
assert.equal(projected.targetClass, otherId);
assert.deepEqual(projected.targetClassIds, original.targetClassIds);
assert.deepEqual(projected.targetUserIds, original.targetUserIds);
assert.equal(
  projected.targetClassLabel,
  "3학년 99반, 3학년 98반 · 개별 대상 포함",
);
assert.notEqual(projected.targetClassIds, original.targetClassIds);
const individual = projectScheduleTargets([], ["student-a"], classes);
assert.equal(individual.targetType, "class");
assert.equal(formatScheduleTargetLabel(individual), "개별 지정");
assert.equal(
  formatScheduleTargetLabel(projectScheduleTargets([classId], [], classes)),
  "3학년 98반",
);
assert.equal(
  formatScheduleTargetLabel({ targetType: "class", targetClass: classId }),
  "학급 정보 확인 필요",
);
assert.equal(
  formatScheduleTargetLabel({ targetType: "class", targetClass: "2-12" }),
  "2학년 12반",
);
assert.equal(
  formatScheduleTargetLabel(
    { targetType: "class", targetClass: "2-12" },
    {
      gradeOptions: [{ value: "2", label: "중등 2학년" }],
      classOptions: [{ value: "12", label: "열두 반" }],
    },
  ),
  "중등 2학년 열두 반",
);
assert.equal(formatScheduleTargetLabel({ targetType: "common" }), "전체 공통");

const dashboard = "src/pages/teacher/Dashboard.tsx";
const visible = extract(dashboard, "getVisibleCalendarEvents", {});
const project = extract(dashboard, "projectScheduleEvent", {
  projectScheduleTargets,
  toLegacyDate: (value) => value.split("T")[0],
  legacyEventTypeFromW8: () => "event",
});
const event = project(
  {
    eventId: "event",
    title: "합성 일정",
    startAt: "2026-09-11T00:00:00Z",
    endAt: "2026-09-11T00:00:00Z",
    classIds: original.targetClassIds,
    targetUserIds: original.targetUserIds,
  },
  classes,
);
const common = { id: "common", ...projectScheduleTargets([], [], classes) };
assert.deepEqual(
  visible([event, common, individual], classId),
  [event, common],
  "second class is filterable; individual-only event is not common",
);
assert.deepEqual(visible([event, common, individual], "common"), [common]);

const manage = "src/pages/teacher/ManageSchedule.tsx";
const rawTimedSchedule = {
  startAt: "2026-09-11T13:38:17.677Z",
  endAt: "2026-09-11T14:38:17.677Z",
  allDay: false,
  period: "1",
  eventType: "CLASS",
  description: "  원래 상세 설명  ",
};
let fetchedEvents, fetchedClasses;
await extract(manage, "fetchEvents", {
  configReady: true,
  config: { year: "2026", semester: "2" },
  getW8DomainState: async () => ({
    semesterId,
    readOnly: false,
    scheduleEvents: [
      {
        eventId: "multi",
        title: "합성 일정",
        ...rawTimedSchedule,
        classIds: original.targetClassIds,
        targetUserIds: original.targetUserIds,
        status: "ACTIVE",
        sourceDomain: "USER",
        revision: 7,
      },
    ],
  }),
  getArchiveEnrollmentState: async (query) => {
    assert.equal(query.source, "CURRENT");
    assert.equal(query.studentUid, undefined);
    return {
      semesterId,
      classes: [record(classId, "98"), record(otherId, "99")],
    };
  },
  buildScheduleClassOptions,
  projectScheduleTargets,
  setScheduleClasses: (value) => {
    fetchedClasses = value;
  },
  setDomainState: () => {},
  setCurrentConfig: () => {},
  legacyEventTypeFromW8: () => "event",
  toW8LocalDateTimeInput: (value) => value,
  toDateKey: (value) => value.split("T")[0],
  filter: classId,
  getKoreanPublicHolidays: async () => [],
  mergeEventsWithKoreanPublicHolidays: (events) => events,
  setEvents: (value) => {
    fetchedEvents = value;
  },
  toExclusiveEnd: (_start, end) => end,
  colorMap: {},
  showToast: (value) => {
    assert.fail(JSON.stringify(value));
  },
})();
assert.equal(
  fetchedClasses.find((item) => item.value === classId).label,
  "3학년 98반",
);
assert.equal(
  fetchedEvents.length,
  1,
  "actual management filter matches second class",
);
assert.deepEqual(
  fetchedEvents[0].extendedProps.targetClassIds,
  original.targetClassIds,
);
assert.deepEqual(
  fetchedEvents[0].extendedProps.targetUserIds,
  original.targetUserIds,
);
assert.deepEqual(
  fetchedEvents[0].extendedProps.originalSchedule,
  rawTimedSchedule,
);
const calendarOptions = extract(
  "src/pages/teacher/components/TeacherCalendarSection.tsx",
  "classTargets",
  {
    useMemo: (callback) => callback(),
    availableClassTargets: [classId],
    classTargetLabels: { [classId]: "3학년 98반" },
    gradeOptions: [],
    classOptions: [],
    formatScheduleTargetLabel,
  },
);
assert.deepEqual(calendarOptions, [{ value: classId, label: "3학년 98반" }]);
const identity = {
  ...original,
  semesterId,
  revision: 7,
  sourceDomain: "USER",
  sourceReference: "fixture",
  readOnly: false,
  originalSchedule: rawTimedSchedule,
  formSnapshot: {
    start: "2026-09-11",
    end: "2026-09-11",
    endEnabled: false,
    eventType: "event",
    description: rawTimedSchedule.description,
  },
};
const manageFile = ts.createSourceFile(
  manage,
  source(manage),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let examEffect;
const findExamEffect = (node) => {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(manageFile) === "useEffect" &&
    node.arguments[0]
      ?.getText(manageFile)
      .includes('formData.eventType !== "exam"')
  )
    examEffect = node.arguments[0];
  ts.forEachChild(node, findExamEffect);
};
findExamEffect(manageFile);
assert.ok(examEffect);
let automaticEndChanges = 0;
new Function(
  "modalOpen",
  "formData",
  "endEnabled",
  "selectedEventIdentity",
  "setEndEnabled",
  "setFormData",
  `${compile(`const run = ${examEffect.getText(manageFile)};`)}; run();`,
)(
  true,
  { eventType: "exam" },
  false,
  {
    ...identity,
    formSnapshot: { ...identity.formSnapshot, eventType: "exam" },
  },
  () => {
    automaticEndChanges++;
  },
  () => {
    automaticEndChanges++;
  },
);
assert.equal(
  automaticEndChanges,
  0,
  "opening an existing single-day exam cannot toggle its end-date form automatically",
);
const save = async (overrides = {}) => {
  const writes = [],
    alerts = [],
    confirmations = [];
  const env = {
    formData: {
      title: "제목만 수정",
      start: "2026-09-11",
      end: "2026-09-11",
      description: rawTimedSchedule.description,
      eventType: "event",
      targetType: "class",
      targetClass: PRESERVE_SCHEDULE_TARGETS,
    },
    domainState: { semesterId, manifestRevision: 1, readOnly: false },
    isEditMode: true,
    selectedEventId: "event",
    selectedEventIdentity: identity,
    endEnabled: false,
    sourceReferenceForEventType: (value) => value,
    createSourceKey: "fixture",
    targetSelectionChanged: false,
    dateSelectionChanged: false,
    scheduleClasses: classes,
    resolveScheduleTargets,
    w8EventTypeFromLegacy: extract(manage, "w8EventTypeFromLegacy", {}),
    toW8ServerDateTime: (value) => value,
    alert: (message) => alerts.push(message),
    confirm: (message) => {
      confirmations.push(message);
      return true;
    },
    updateScheduleEvent: async (payload) => {
      writes.push(payload);
    },
    createScheduleEvent: async (payload) => {
      writes.push(payload);
    },
    closeModal: () => {},
    fetchEvents: async () => {},
    W8DomainError: class extends Error {},
    ...overrides,
  };
  await extract(manage, "handleSave", env)();
  return { writes, alerts, confirmations };
};
let result = await save();
assert.equal(result.writes.length, 1);
assert.deepEqual(result.writes[0].targetClassIds, original.targetClassIds);
assert.deepEqual(result.writes[0].targetUserIds, original.targetUserIds);
assert.equal(result.writes[0].expectedEventRevision, 7);
for (const key of Object.keys(rawTimedSchedule))
  assert.equal(
    result.writes[0][key],
    rawTimedSchedule[key],
    `title-only keeps exact ${key}`,
  );
result = await save({ dateSelectionChanged: true });
assert.equal(result.writes[0].startAt, "2026-09-11T00:00");
assert.equal(result.writes[0].endAt, "2026-09-11T00:00");
assert.equal(
  result.writes[0].allDay,
  true,
  "explicit date/end selection retains existing all-day flow",
);
assert.equal(
  result.writes[0].period,
  "1",
  "no period editor means existing period is retained",
);
result = await save({
  dateSelectionChanged: true,
  endEnabled: true,
  formData: {
    title: "날짜 수정",
    start: "2026-09-12",
    end: "2026-09-13",
    eventType: "event",
    targetType: "class",
    targetClass: PRESERVE_SCHEDULE_TARGETS,
    description: rawTimedSchedule.description,
  },
});
assert.equal(result.writes[0].startAt, "2026-09-12T00:00");
assert.equal(result.writes[0].endAt, "2026-09-13T00:00");
result = await save({
  formData: {
    title: "종류 수정",
    start: "2026-09-11",
    end: "2026-09-11",
    eventType: "performance",
    targetType: "class",
    targetClass: PRESERVE_SCHEDULE_TARGETS,
    description: rawTimedSchedule.description,
  },
});
assert.equal(
  result.writes[0].eventType,
  "ASSESSMENT",
  "explicit category uses the production mapper",
);
assert.equal(result.writes[0].startAt, rawTimedSchedule.startAt);
result = await save({
  targetSelectionChanged: true,
  formData: {
    title: "학급 수정",
    start: "2026-09-11",
    eventType: "event",
    targetType: "class",
    targetClass: classId,
  },
});
assert.deepEqual(result.writes[0].targetClassIds, [classId]);
assert.deepEqual(result.writes[0].targetUserIds, original.targetUserIds);
const broadcastForm = {
  title: "대상 수정",
  start: "2026-09-11",
  eventType: "event",
  targetType: "common",
};
result = await save({
  targetSelectionChanged: true,
  formData: broadcastForm,
  confirm: () => false,
});
assert.equal(result.writes.length, 0, "cancelled broadcast makes no write");
result = await save({ targetSelectionChanged: true, formData: broadcastForm });
assert.equal(result.confirmations.length, 1);
assert.deepEqual(result.writes[0].targetClassIds, []);
assert.deepEqual(result.writes[0].targetUserIds, []);
result = await save({
  selectedEventIdentity: { ...identity, semesterId: "2027-1" },
});
assert.equal(result.writes.length, 0, "semester change blocks old editor");
assert.equal(result.alerts.length, 1);
result = await save({
  targetSelectionChanged: true,
  formData: { ...broadcastForm, targetType: "class", targetClass: "unknown" },
});
assert.equal(result.writes.length, 0);

let openedIdentity, openedForm, changed;
extract(manage, "openModal", {
  domainState: { semesterId, readOnly: false },
  setIsEditMode: () => {},
  setSelectedEventId: () => {},
  setSelectedEventIdentity: (value) => {
    openedIdentity = value;
  },
  setFormData: (value) => {
    openedForm = value;
  },
  setEndEnabled: () => {},
  setTargetSelectionChanged: (value) => {
    changed = value;
  },
  setModalOpen: () => {},
  setDateSelectionChanged: (value) => assert.equal(value, false),
  PRESERVE_SCHEDULE_TARGETS,
})({ ...event, ...identity });
assert.deepEqual(openedIdentity.targetClassIds, original.targetClassIds);
assert.deepEqual(openedIdentity.targetUserIds, original.targetUserIds);
assert.equal(openedForm.targetClass, PRESERVE_SCHEDULE_TARGETS);
assert.equal(changed, false);
assert.deepEqual(openedIdentity.originalSchedule, rawTimedSchedule);
assert.equal(openedIdentity.formSnapshot.start, openedForm.start);
assert.equal(openedIdentity.formSnapshot.end, openedForm.end);
result = await save({
  selectedEventIdentity: openedIdentity,
  formData: {
    ...openedForm,
    description: rawTimedSchedule.description,
    title: "연결된 편집 제목",
  },
});
for (const key of Object.keys(rawTimedSchedule))
  assert.equal(
    result.writes[0][key],
    rawTimedSchedule[key],
    `actual open→save preserves ${key}`,
  );

const {
  createArchiveEnrollmentQueryCore,
} = require("../functions/archiveEnrollment.js");
const documents = new Map([
  [
    "users/schedule-teacher",
    { role: "teacher", teacherPortalEnabled: true, staffPermissions: [] },
  ],
  ["site_settings/semester_active", { semesterId, revision: 1 }],
  [
    `semester_manifests/${semesterId}`,
    { semesterId, revision: 1, status: "ACTIVE", provenance: "CANONICAL" },
  ],
  [`semester_classes/${classId}`, record(classId, "98")],
  [
    "semester_enrollments/student",
    { semesterId, studentUid: "other-student", classId },
  ],
]);
let writes = 0,
  sessionChecks = 0;
const store = {
  get: async (path) => ({
    path,
    exists: documents.has(path),
    data: documents.get(path),
  }),
  query: async (collection, filter) =>
    [...documents]
      .filter(
        ([path, data]) =>
          path.startsWith(`${collection}/`) &&
          (!filter || data[filter.field] === filter.value),
      )
      .map(([path, data]) => ({ path, data, exists: true })),
  runTransaction: async (callback) => callback(store),
  set: () => {
    writes++;
    throw new Error("Read-only query wrote data");
  },
  create: () => {
    writes++;
    throw new Error("Read-only query wrote data");
  },
  delete: () => {
    writes++;
    throw new Error("Read-only query wrote data");
  },
};
const core = createArchiveEnrollmentQueryCore({
  store,
  projectId: "demo-westory-session-schedule",
  assertSession: async () => {
    sessionChecks++;
    return { uid: "schedule-teacher", email: "synthetic@example.invalid" };
  },
});
const request = {
  auth: { uid: "schedule-teacher" },
  data: { source: "CURRENT", callSite: "ManageSchedule.scheduleClasses" },
};
const state = await core.getArchiveEnrollmentState(request);
assert.equal(state.classes[0].classId, classId);
assert.deepEqual(
  state.enrollments,
  [],
  "teacher without student_list_read cannot receive other enrollments",
);
await assert.rejects(
  async () =>
    await core.getArchiveEnrollmentState({
      ...request,
      data: { ...request.data, studentUid: "other-student" },
    }),
  (error) => error.details?.reason === "ENROLLMENT_READ_FORBIDDEN",
);
assert.equal(sessionChecks, 2);
assert.equal(writes, 0);

for (const path of [
  "src/lib/scheduleClassTargets.ts",
  dashboard,
  manage,
  "src/pages/teacher/components/TeacherCalendarSection.tsx",
  "src/components/common/ScheduleEventDetailModal.tsx",
  "src/components/common/ScheduleMorePopover.tsx",
  "src/types/index.ts",
])
  compile(source(path), path);
console.log(
  "PASS schedule target identity/labels, multi-target preservation, actual editor/filter handlers, limited-teacher query, 7-file syntax (no network)",
);
