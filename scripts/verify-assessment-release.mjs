import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash, webcrypto } from "node:crypto";
import ts from "typescript";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Exercise the real browser release planner against the deployed command adapter.
// The store is synthetic and contains no credentials or production connection.
const serverPath = "functions/productionGateway/assessmentLifecycle.js";
const serverModule = { exports: {} };
const semesterCore = { SEMESTER_MANIFEST_COLLECTION: "semester_manifests", ACTIVE_SEMESTER_POINTER_PATH: "system/active", normalizeSemesterId: (value) => value };
const exemptionModule = { exports: {} };
const HttpsError = class extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } };
vm.runInNewContext(fs.readFileSync("functions/productionGateway/historyClassroomExemptions.js", "utf8"), {
  module: exemptionModule, exports: exemptionModule.exports,
  require: (name) => {
    if (name === "node:crypto") return { createHash };
    if (name === "firebase-functions/v2/https") return { HttpsError };
    throw new Error(name);
  },
});
vm.runInNewContext(fs.readFileSync(serverPath, "utf8"), {
  module: serverModule, exports: serverModule.exports, Buffer,
  require: (name) => {
    if (name === "node:crypto") return { createHash };
    if (name === "firebase-functions/v2/https") return { HttpsError: class extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } } };
    if (name === "./semesterCore") return semesterCore;
    if (name === "./historyClassroomExemptions") return exemptionModule.exports;
    if (name === "./assessmentLearning") return require("../functions/productionGateway/assessmentLearning.js");
    if (name === "./archiveEnrollment") return { SEMESTER_CLASS_COLLECTION: "semester_classes" };
    if (["./cutoverAuthorization", "./sessionAuthority", "./studentMaintenance"].includes(name)) return {};
    throw new Error(name);
  },
});
const adapter = serverModule.exports.createAssessmentCommandAdapter();
const config = { year: "2026", semester: "2" };
const root = "years/2026/semesters/2";
const settings = { active: true, questionCount: 1, questionOrder: "random", randomOrder: true, timeLimit: 60, allowRetake: true, cooldown: 5, hintLimit: 0, visibleTargetGrade: "3", visibleClassIds: ["3-1"], visibilityVersion: 2 };
function harness() {
  const docs = new Map([
    ["site_settings/config", config], ["system/active", { semesterId: "2026-2", revision: 1 }],
    ["semester_manifests/2026-2", { semesterId: "2026-2", revision: 1, status: "ACTIVE" }],
    ["semester_classes/class_a", { semesterId: "2026-2", classId: "class_a", status: "ACTIVE", grade: "3", classNumber: "1" }],
    [`${root}/quiz_questions/q1`, { id: "q1", unitId: "unit_1", category: "diagnostic", question: "Q", type: "word", answer: "A", contentRevision: 1 }],
    [`${root}/assessment_config/settings`, { unit_1_diagnostic: { ...settings } }],
    [`${root}/history_classrooms/history1`, { title: "역사교실", sourceType: "lesson", lessonUnitId: "lesson-unit", mapResourceId: "", isPublished: true, blanks: [{ id: "blank-a", answer: "A" }], targetStudentUids: ["student-a"], timeLimitMinutes: 10, cooldownMinutes: 5 }],
  ]);
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const snap = (path) => ({ path, id: path.split("/").at(-1), exists: docs.has(path), data: clone(docs.get(path)) });
  const list = (path) => [...docs.keys()].filter((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1).map(snap);
  const calls = [];
  const operations = new Map();
  let afterCommand;
  let afterRead;
  const auth = { currentUser: { uid: "teacher-a", getIdTokenResult: async () => ({ claims: { auth_time: 1234 } }) } };
  const transaction = {
    get: async (path) => snap(path), getAll: async (paths) => paths.map(snap),
    query: async (path, filter) => list(path).filter((item) => !filter || item.data[filter.field] === filter.value),
    create: (path, data) => { assert.equal(docs.has(path), false); docs.set(path, clone(data)); },
    set: (path, data, options) => docs.set(path, options?.merge ? { ...docs.get(path), ...clone(data) } : clone(data)),
    delete: (path) => docs.delete(path),
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/lib/assessmentRelease.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports: module.exports, crypto: webcrypto, TextEncoder,
    require: (name) => {
      if (name === "./firebase") return { db: {}, auth };
      if (name === "firebase/firestore") return {
        doc: (_db, ...parts) => parts.join("/"), collection: (_db, ...parts) => parts.join("/"),
        getDoc: async (path) => { const data = snap(path); afterRead?.(path); return { exists: () => data.exists, data: () => data.data }; },
        getDocs: async (path) => ({ docs: list(path).map((item) => ({ id: item.id, data: () => item.data })) }),
      };
      if (name === "./semesterScope") return { getYearSemester: (value) => value || config, getSemesterCollectionPath: (value, collection) => `years/${value.year}/semesters/${value.semester}/${collection}`, getSemesterDocPath: (value, collection, id) => `years/${value.year}/semesters/${value.semester}/${collection}/${id}` };
      if (name === "./mockExamRounds") return { DEFAULT_MOCK_EXAM_ROUND: "round_1" };
      if (name === "./wisEconomyClient") return { runWisOperation: async (intent, _sensitive, action) => {
        assert.equal(_sensitive, false, "Source saves use the existing routine classroom session policy");
        const key = JSON.stringify(intent), completed = operations.get(key) || new Map();
        operations.set(key, completed);
        const value = await action(async (name, prepare) => {
          if (completed.has(name)) return completed.get(name);
          const command = await prepare();
          calls.push({ commandType: command.commandType, payload: clone(command.payload) });
          const result = await adapter.apply({ transaction, commandId: `command-${calls.length}`, commandType: command.commandType, payload: serverModule.exports.normalizeAssessmentPayload(command.commandType, command.payload), timestamp: "2026-10-08T00:00:00.000Z", actor: { actorUid: "teacher-a", actorRole: "teacher" } });
          completed.set(name, clone(result.result));
          return clone(result.result);
        });
        operations.delete(key);
        return value;
      } };
      if (name === "./assessmentConfig") return { getGrade3ClassIdsFromSchoolConfig: async () => ["3-1"], readAssessmentConfigMap: async () => clone(docs.get(`${root}/assessment_config/settings`)) };
      if (name === "./assessmentLifecycle") return {
        buildAssessmentDefinitionId: (...args) => [args[1].toLowerCase(), args[0], ...args.slice(2)].filter(Boolean).join(":"),
        executeAssessmentManagementCommand: async (commandType, raw) => {
          calls.push({ commandType, payload: clone(raw) });
          const payload = serverModule.exports.normalizeAssessmentPayload(commandType, raw);
          const result = await adapter.apply({ transaction, commandId: `command-${calls.length}`, commandType, payload, timestamp: "2026-10-08T00:00:00.000Z", actor: { actorUid: "teacher-a", actorRole: "teacher" } });
          if (afterCommand) await afterCommand(commandType, result);
          return clone(result.result);
        },
      };
      throw new Error(name);
    },
  });
  return { api: module.exports, docs, calls, auth, hook: (callback) => { afterCommand = callback; }, readHook: (callback) => { afterRead = callback; },
    command: (commandType, raw) => adapter.apply({ transaction, commandId: "direct-test", commandType,
      payload: serverModule.exports.normalizeAssessmentPayload(commandType, raw), timestamp: "2026-10-08T00:00:00.000Z",
      actor: { actorUid: "teacher-a", actorRole: "teacher" } }) };
}
const newHistorySource = () => ({
  title: "조선의 건국", sourceType: "lesson", lessonUnitId: "lesson-unit", mapResourceId: "", isPublished: true,
  blanks: Array.from({ length: 28 }, (_, index) => ({ id: `blank-${index + 1}`, answer: `정답 ${index + 1}` })),
  targetStudentUids: ["student-a", "student-b"], targetStudentReasons: { "student-a": "지각", "student-b": "지각" },
  timeLimitMinutes: 10, cooldownMinutes: 5, passThresholdPercent: 90, dueWindowDays: 7,
  publishedAt: "2099-01-01T00:00:00.000Z", dueAt: "2099-01-08T00:00:00.000Z",
});

{
  const { api, docs, calls } = harness();
  const plan = await api.planCurrentAssessmentRelease(config);
  assert.equal(calls.length, 0, "preview is read only");
  assert.equal(plan.prepareCount, 2);
  assert.equal(plan.blockedCount, 0);
  const result = await api.prepareCurrentAssessmentRelease(plan);
  assert.equal(result.preparedCount, 2);
  assert.deepEqual(calls.map((call) => call.commandType), ["createAssessmentDefinition", "transitionAssessmentDefinition", "createAssessmentDefinition", "transitionAssessmentDefinition"]);
  for (const item of plan.items) {
    const definition = docs.get(`semester_assessment_definitions/${item.definitionId}`);
    assert.equal(definition.revision, 2);
    assert.equal(definition.status, "PUBLISHED");
    assert.equal(definition.sourceHash, item.sourceHash, "browser fingerprint matches real server source hash");
  }
  const ready = await api.planCurrentAssessmentRelease(config);
  assert.equal(ready.prepareCount, 0);
  assert.equal((await api.prepareCurrentAssessmentRelease(ready)).preparedCount, 0);
  assert.equal(calls.length, 4, "ready rerun has no writes");
  console.log("PASS read-only preview, real server validation/hash, DRAFT publication and zero-write ready rerun");
}
{
  const { api, docs, calls } = harness();
  const plan = await api.planCurrentAssessmentRelease(config);
  docs.get(`${root}/quiz_questions/q1`).answer = "CHANGED";
  await assert.rejects(api.prepareCurrentAssessmentRelease(plan), /바뀌었습니다/);
  assert.equal(calls.length, 0);
  const fresh = await api.planCurrentAssessmentRelease(config);
  docs.set("site_settings/config", { year: "2027", semester: "1" });
  await assert.rejects(api.prepareCurrentAssessmentRelease(fresh), /학기가 바뀌었습니다/);
  assert.equal(calls.length, 0);
  console.log("PASS stale source/settings preview and semester switch block before all writes");
}
{
  const { api, docs, calls, hook } = harness();
  const plan = await api.planCurrentAssessmentRelease(config);
  hook((commandType) => { if (commandType === "createAssessmentDefinition") docs.get(`${root}/quiz_questions/q1`).answer = "RACE"; });
  await assert.rejects(api.prepareCurrentAssessmentRelease(plan), /공개하지 않았습니다/);
  assert.equal(calls.length, 1);
  assert.equal(docs.get(`semester_assessment_definitions/${plan.items[0].definitionId}`).status, "DRAFT");
  console.log("PASS content mutation between create and publish stays DRAFT");
}
{
  const { api, docs, calls } = harness();
  docs.get(`${root}/assessment_config/settings`).unit_1_diagnostic.questionCount = 2;
  const blocked = await api.planCurrentAssessmentRelease(config);
  assert.equal(blocked.blockedCount, 1);
  await assert.rejects(api.prepareCurrentAssessmentRelease(blocked), /먼저 수정/);
  assert.equal(calls.length, 0);
  console.log("PASS missing questions block the whole preparation batch");
}
{
  const { api, docs, calls } = harness();
  await api.prepareCurrentAssessmentRelease(await api.planCurrentAssessmentRelease(config));
  const payload = { ...docs.get(`${root}/history_classrooms/history1`), title: "변경 제목", isPublished: false, sourceType: "lesson", lessonUnitId: "lesson-unit", lessonTitle: "수업자료", lessonUnitPath: ["unit", "lesson-unit"] };
  await api.saveHistoryAssessmentSource(config, "history1", payload, 0);
  assert.equal(docs.get("semester_assessment_definitions/history_classroom:2026-2:history1").status, "PAUSED");
  assert.equal(docs.get(`${root}/history_classrooms/history1`).isPublished, false);
  assert.equal(docs.get(`${root}/history_classrooms/history1`).lessonUnitId, "lesson-unit");
  payload.isPublished = true;
  await api.saveHistoryAssessmentSource(config, "history1", payload, 1);
  assert.equal(docs.get("semester_assessment_definitions/history_classroom:2026-2:history1").status, "PUBLISHED");
  assert.equal(docs.get("semester_assessment_definitions/history_classroom:2026-2:history1").title, "변경 제목");
  await assert.rejects(api.saveHistoryAssessmentSource(config, "history1", payload, 1), /revision changed/);
  assert.equal(docs.get(`${root}/history_classrooms/history1`).contentRevision, 2);
  assert.equal(docs.get("semester_assessment_definitions/history_classroom:2026-2:history1").status, "PUBLISHED", "A stale edit must not pause the published assignment");
  assert.ok(calls.length > 4);
  console.log("PASS published source pause/update/republish, drafts, and stale source revision rejection");
}
{
  const { api, docs, calls } = harness();
  await api.prepareCurrentAssessmentRelease(await api.planCurrentAssessmentRelease(config));
  const sourcePath = `${root}/history_classrooms/history1`;
  const definitionPath = "semester_assessment_definitions/history_classroom:2026-2:history1";
  const originalDefinition = JSON.parse(JSON.stringify(docs.get(definitionPath)));
  const originalSource = JSON.parse(JSON.stringify(docs.get(sourcePath)));
  docs.set("semester_assessment_attempts/active-student", { definitionId: "history_classroom:2026-2:history1", studentUid: "student-a", status: "IN_PROGRESS" });
  const callCount = calls.length;
  await assert.rejects(api.saveHistoryAssessmentSource(config, "history1", { ...originalSource, blanks: [{ id: "blank-a", answer: "CHANGED" }] }, 0), /응시 중인 학습지/);
  assert.deepEqual(docs.get(definitionPath), originalDefinition, "Refused worksheet changes preserve the live definition and its revision");
  assert.deepEqual(docs.get(sourcePath), originalSource, "Refused worksheet changes preserve the source");
  assert.deepEqual(calls.slice(callCount).map(call => call.commandType), ["upsertHistoryClassroomSource"], "Do not pause before source validation");
  console.log("PASS active attempt edit rejection leaves published source/definition intact");
}
{
  const { api, docs, calls, hook } = harness();
  const payload = newHistorySource();
  let failed = false;
  hook((type) => { if (type === "createAssessmentDefinition" && !failed) { failed = true; throw new Error("Synthetic response loss after definition creation"); } });
  await assert.rejects(api.saveHistoryAssessmentSource(config, "new-history", payload, 0), /Synthetic response loss/);
  const saved = await api.saveHistoryAssessmentSource(config, "new-history", { ...payload,
    publishedAt: "2099-01-02T00:00:00.000Z", dueAt: "2099-01-09T00:00:00.000Z" }, 0);
  const source = docs.get(`${root}/history_classrooms/new-history`);
  const definition = docs.get("semester_assessment_definitions/history_classroom:2026-2:new-history");
  assert.equal(calls.filter((call) => call.commandType === "upsertHistoryClassroomSource").length, 1);
  assert.equal(source.contentRevision, 1);
  assert.equal(source.passThresholdPercent, 90);
  assert.equal(definition.status, "PUBLISHED");
  assert.equal(definition.durationSeconds, 600);
  assert.equal(definition.cooldownMinutes, 5);
  assert.equal(definition.itemCount, 28);
  assert.deepEqual(definition.assignedStudentUids, payload.targetStudentUids);
  assert.equal(definition.closesAt, payload.dueAt);
  assert.equal(saved.publicationWindow.publishedAt, payload.publishedAt);
  assert.equal(saved.publicationWindow.dueAt, payload.dueAt);
  assert.equal(definition.sourceContentRevision, 1);
  assert.equal("expectedSourceRevision" in definition, false, "Client compare-and-set values are transient");
  console.log("PASS 28-blank/2-student source save, partial-publication retry, one source write and original publication window");
}
{
  const { api, docs, calls, hook } = harness();
  const payload = newHistorySource();
  hook((type) => { if (type === "createAssessmentDefinition") throw new Error("Synthetic partial save"); });
  await assert.rejects(api.saveHistoryAssessmentSource(config, "changed-history", payload, 0), /Synthetic partial save/);
  docs.get(`${root}/history_classrooms/changed-history`).contentRevision = 2;
  const count = calls.length;
  await assert.rejects(api.saveHistoryAssessmentSource(config, "changed-history", payload, 0), /다른 변경이 먼저/);
  assert.equal(calls.length, count, "A source edited after partial save must not be republished by its stale retry");
}
{
  const { api, docs, readHook } = harness();
  const sourcePath = `${root}/history_classrooms/raced-history`;
  let changed = false;
  readHook((path) => {
    if (path === sourcePath && !changed) {
      changed = true;
      Object.assign(docs.get(path), { contentRevision: 2, timeLimitMinutes: 20 });
    }
  });
  await assert.rejects(api.saveHistoryAssessmentSource(config, "raced-history", newHistorySource(), 0),
    (error) => error.details?.reason === "ASSESSMENT_SOURCE_REVISION_CONFLICT");
  assert.equal(docs.has("semester_assessment_definitions/history_classroom:2026-2:raced-history"), false,
    "A source edit between verification and definition creation must not publish stale settings");
}
{
  const { api, docs, readHook, calls } = harness();
  const sourcePath = `${root}/history_classrooms/raced-update`;
  const payload = newHistorySource();
  await api.saveHistoryAssessmentSource(config, "raced-update", payload, 0);
  let changed = false;
  readHook((path) => {
    if (path === sourcePath && !changed) {
      changed = true;
      Object.assign(docs.get(path), { contentRevision: 3, timeLimitMinutes: 20 });
    }
  });
  await assert.rejects(api.saveHistoryAssessmentSource(config, "raced-update", { ...payload, title: "수정" }, 1),
    (error) => error.details?.reason === "ASSESSMENT_SOURCE_REVISION_CONFLICT");
  const definition = docs.get("semester_assessment_definitions/history_classroom:2026-2:raced-update");
  assert.equal(definition.status, "PAUSED");
  assert.equal(definition.sourceContentRevision, 1);
  assert.equal(calls.at(-1).commandType, "updateAssessmentDefinition");
}
{
  const { api, docs, hook, command } = harness();
  const sourcePath = `${root}/history_classrooms/raced-publish`;
  const definitionId = "history_classroom:2026-2:raced-publish";
  hook((type) => { if (type === "createAssessmentDefinition") Object.assign(docs.get(sourcePath), { contentRevision: 2, timeLimitMinutes: 20 }); });
  await assert.rejects(api.saveHistoryAssessmentSource(config, "raced-publish", newHistorySource(), 0),
    (error) => error.details?.reason === "ASSESSMENT_SOURCE_REVISION_CONFLICT");
  const original = structuredClone(docs.get(`semester_assessment_definitions/${definitionId}`));
  assert.equal(original.status, "DRAFT");
  await assert.rejects(command("transitionAssessmentDefinition", { definitionId, expectedRevision: original.revision,
    expectedSourceRevision: 2, targetStatus: "PUBLISHED", reason: "Forged newer source revision" }),
    (error) => error.details?.reason === "ASSESSMENT_SOURCE_REVISION_CONFLICT");
  assert.deepEqual(docs.get(`semester_assessment_definitions/${definitionId}`), original);
}
for (const change of [{ dueWindowDays: 14 }, { isPublished: false }, { timeLimitMinutes: 20 }, { targetStudentReasons: { "student-a": "다른 사유", "student-b": "지각" } }]) {
  const { api, docs, hook } = harness();
  const payload = newHistorySource();
  hook((type) => { if (type === "createAssessmentDefinition") throw new Error("Partial source save"); });
  await assert.rejects(api.saveHistoryAssessmentSource(config, "intent-history", payload, 0), /Partial source save/);
  await api.saveHistoryAssessmentSource(config, "intent-history", { ...payload, ...change }, 0);
  const source = docs.get(`${root}/history_classrooms/intent-history`);
  assert.equal(source.contentRevision, 2);
  for (const [key, value] of Object.entries(change)) assert.deepEqual(source[key], value);
  assert.equal(docs.get("semester_assessment_definitions/history_classroom:2026-2:intent-history").status,
    change.isPublished === false ? "DRAFT" : "PUBLISHED");
}
for (const mutation of [(source) => { source.contentRevision = 2; }, (source) => { source.timeLimitMinutes = 20; }]) {
  const { api, docs, hook, calls } = harness();
  const payload = newHistorySource();
  hook((type) => { if (type === "createAssessmentDefinition") throw new Error("Partial source save"); });
  await assert.rejects(api.saveHistoryAssessmentSource(config, "external-intent", payload, 0), /Partial source save/);
  mutation(docs.get(`${root}/history_classrooms/external-intent`));
  const count = calls.length;
  await assert.rejects(api.saveHistoryAssessmentSource(config, "external-intent", { ...payload, title: "수정" }, 0),
    (error) => error.code === "functions/aborted" && error.details?.reason === "ASSESSMENT_SOURCE_REVISION_CONFLICT");
  assert.equal(calls.length, count, "Changed input cannot advance a source modified outside this confirmed save");
}
{
  const { api, docs, readHook } = harness();
  const payload = newHistorySource();
  let lost = false;
  readHook((path) => { if (path.endsWith("/read-loss") && !lost) { lost = true; throw new Error("Synthetic canonical read failure"); } });
  await assert.rejects(api.saveHistoryAssessmentSource(config, "read-loss", payload, 0), /Synthetic canonical read failure/);
  const saved = await api.saveHistoryAssessmentSource(config, "read-loss", { ...payload, timeLimitMinutes: 20 }, 0);
  assert.equal(saved.contentRevision, 2);
  assert.equal(docs.get("semester_assessment_definitions/history_classroom:2026-2:read-loss").durationSeconds, 1200);
  assert.equal(docs.get(`${root}/history_classrooms/read-loss`).timeLimitMinutes, 20);
}
for (const isPublished of [true, false]) {
  const { api, docs, readHook } = harness();
  const payload = newHistorySource();
  await api.saveHistoryAssessmentSource(config, "published-race", payload, 0);
  const sourcePath = `${root}/history_classrooms/published-race`;
  const definitionPath = "semester_assessment_definitions/history_classroom:2026-2:published-race";
  let otherDefinition;
  readHook((path) => {
    if (path === sourcePath && !otherDefinition) {
      Object.assign(docs.get(sourcePath), { contentRevision: 3, timeLimitMinutes: 20 });
      Object.assign(docs.get(definitionPath), { status: "PUBLISHED", revision: 5, sourceContentRevision: 3, durationSeconds: 1200 });
      otherDefinition = structuredClone(docs.get(definitionPath));
    }
  });
  await assert.rejects(api.saveHistoryAssessmentSource(config, "published-race", { ...payload, title: "A 편집", isPublished }, 1),
    (error) => error.details?.reason === "ASSESSMENT_SOURCE_REVISION_CONFLICT");
  assert.deepEqual(docs.get(definitionPath), otherDefinition, "A stale editor must not pause another editor's newer publication");
}
{
  const { api, hook, auth, docs } = harness();
  const payload = newHistorySource();
  hook((type) => { if (type === "createAssessmentDefinition") throw new Error("Partial source save"); });
  await assert.rejects(api.saveHistoryAssessmentSource(config, "owner-retry", payload, 0), /Partial source save/);
  auth.currentUser = { uid: "teacher-a", getIdTokenResult: async () => ({ claims: { auth_time: 2345 } }) };
  await assert.rejects(api.saveHistoryAssessmentSource(config, "owner-retry", { ...payload, title: "다시 로그인한 계정" }, 0), /revision changed/);
  assert.equal(docs.get(`${root}/history_classrooms/owner-retry`).contentRevision, 1);
}
{
  const { api, readHook, auth, calls, docs } = harness();
  readHook((path) => {
    if (path.startsWith("semester_assessment_definitions/")) {
      auth.currentUser = { uid: "teacher-b", getIdTokenResult: async () => ({ claims: { auth_time: 2345 } }) };
    }
  });
  await assert.rejects(api.saveHistoryAssessmentSource(config, "in-flight-owner", newHistorySource(), 0),
    (error) => error.code === "functions/unauthenticated");
  assert.deepEqual(calls.map(({ commandType }) => commandType), ["upsertHistoryClassroomSource"]);
  assert.equal(docs.has("semester_assessment_definitions/history_classroom:2026-2:in-flight-owner"), false);
}
{
  const { api, readHook, auth, calls } = harness();
  readHook((path) => {
    if (path.startsWith("semester_assessment_definitions/")) {
      auth.currentUser.getIdTokenResult = async () => {
        await Promise.resolve();
        auth.currentUser = { uid: "teacher-b", getIdTokenResult: async () => ({ claims: { auth_time: 2345 } }) };
        return { claims: { auth_time: 1234 } };
      };
    }
  });
  await assert.rejects(api.saveHistoryAssessmentSource(config, "token-owner", newHistorySource(), 0),
    (error) => error.code === "functions/unauthenticated");
  assert.deepEqual(calls.map(({ commandType }) => commandType), ["upsertHistoryClassroomSource"]);
}
{
  const { api, command, docs } = harness();
  const plan = await api.planCurrentAssessmentRelease(config);
  const history = plan.items.find((item) => item.kind === "HISTORY_CLASSROOM").payload;
  const quiz = plan.items.find((item) => item.kind === "QUIZ").payload;
  const normalize = serverModule.exports.normalizeAssessmentPayload;
  for (const value of [null, -1, 1.5, "1", true, {}]) {
    for (const type of ["createAssessmentDefinition", "updateAssessmentDefinition"]) {
      assert.throws(() => normalize(type, { ...history, expectedRevision: 1, reason: "Test", expectedSourceRevision: value }),
        (error) => error.details?.reason === "ASSESSMENT_PAYLOAD_INVALID");
    }
    assert.throws(() => normalize("transitionAssessmentDefinition", { definitionId: history.definitionId, expectedRevision: 1,
      targetStatus: "PUBLISHED", reason: "Test", expectedSourceRevision: value }),
      (error) => error.details?.reason === "ASSESSMENT_PAYLOAD_INVALID");
  }
  assert.throws(() => normalize("createAssessmentDefinition", { ...quiz, expectedSourceRevision: 0 }),
    (error) => error.details?.reason === "ASSESSMENT_PAYLOAD_INVALID");
  assert.throws(() => normalize("transitionAssessmentDefinition", { definitionId: history.definitionId, expectedRevision: 1,
    targetStatus: "PAUSED", reason: "Test", expectedSourceRevision: 0 }),
    (error) => error.details?.reason === "ASSESSMENT_PAYLOAD_INVALID");
  await command("createAssessmentDefinition", quiz);
  await assert.rejects(command("transitionAssessmentDefinition", { definitionId: quiz.definitionId, expectedRevision: 1,
    targetStatus: "PUBLISHED", reason: "Test", expectedSourceRevision: 0 }),
    (error) => error.details?.reason === "ASSESSMENT_PAYLOAD_INVALID");
  assert.equal(docs.get(`semester_assessment_definitions/${quiz.definitionId}`).status, "DRAFT");
}
console.log("PASS source revision races at create/update/publish, forged revision rejection, semantic retry intent and optional-contract validation");
for (const operation of ["delete", "prepare"]) {
  const { api, docs } = harness();
  const sourcePath = `${root}/history_classrooms/legacy-published`;
  const definitionPath = "semester_assessment_definitions/history_classroom:2026-2:legacy-published";
  await api.saveHistoryAssessmentSource(config, "legacy-published", newHistorySource(), 0);
  delete docs.get(definitionPath).sourceContentRevision;
  const source = structuredClone(docs.get(sourcePath));
  if (operation === "delete") {
    await api.deleteHistoryAssessmentSource(config, "legacy-published", source, 1);
    assert.ok(docs.get(sourcePath).deletedAt);
    assert.equal(docs.get(definitionPath).status, "PAUSED");
  } else {
    docs.get(definitionPath).durationSeconds = 1200;
    await api.prepareCurrentAssessmentRelease(await api.planCurrentAssessmentRelease(config));
    assert.equal(docs.get(definitionPath).status, "PUBLISHED");
    assert.equal(docs.get(definitionPath).durationSeconds, 600);
    assert.equal(docs.get(definitionPath).sourceContentRevision, 1);
  }
}
{
  const { api, docs, readHook, calls } = harness();
  const sourcePath = `${root}/history_classrooms/legacy-race`;
  const definitionPath = "semester_assessment_definitions/history_classroom:2026-2:legacy-race";
  await api.saveHistoryAssessmentSource(config, "legacy-race", newHistorySource(), 0);
  delete docs.get(definitionPath).sourceContentRevision;
  const source = structuredClone(docs.get(sourcePath));
  let otherDefinition;
  readHook((path) => {
    if (path === sourcePath && !otherDefinition) {
      Object.assign(docs.get(sourcePath), { contentRevision: 2, timeLimitMinutes: 20 });
      Object.assign(docs.get(definitionPath), { status: "PUBLISHED", revision: 5, sourceContentRevision: 2, durationSeconds: 1200 });
      otherDefinition = structuredClone(docs.get(definitionPath));
    }
  });
  await assert.rejects(api.deleteHistoryAssessmentSource(config, "legacy-race", source, 1),
    (error) => error.details?.reason === "ASSESSMENT_REVISION_CONFLICT");
  assert.deepEqual(docs.get(definitionPath), otherDefinition);
  assert.equal(calls.at(-1).commandType, "transitionAssessmentDefinition");
  assert.equal(docs.get(sourcePath).deletedAt, null);
}
console.log("PASS legacy published definitions still delete/re-prepare, with concurrent publication preserved by the definition CAS");
console.log("Assessment release verification passed.");
