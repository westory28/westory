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
  const browserReads = [];
  const operations = new Map();
  let afterCommand;
  let afterRead;
  const auth = { currentUser: { uid: "teacher-a", getIdTokenResult: async () => ({ claims: { auth_time: 1234 } }) } };
  const transaction = {
    get: async (path) => snap(path), getAll: async (paths) => paths.map(snap),
    query: async (path, filter) => list(path).filter((item) => !filter || (filter.filters || [filter]).every(clause => item.data[clause.field] === clause.value)),
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
        getDoc: async (path) => { browserReads.push(path); const data = snap(path); afterRead?.(path); return { exists: () => data.exists, data: () => data.data }; },
        query: (path, ...filters) => ({ path, filters }), where: (field, operator, value) => ({ field, operator, value }),
        getDocs: async (input) => { const path = input.path || input; browserReads.push(path); return { docs: list(path).filter(item => !input.filters || input.filters.every(filter => item.data[filter.field] === filter.value)).map((item) => ({ id: item.id, data: () => item.data })) }; },
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
          if (afterCommand) await afterCommand(command.commandType, result);
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
  return { api: module.exports, docs, calls, browserReads, auth, hook: (callback) => { afterCommand = callback; }, readHook: (callback) => { afterRead = callback; },
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
  assert.deepEqual(calls.map((call) => call.commandType), ["saveQuizAssessmentSettings", "createAssessmentDefinition", "transitionAssessmentDefinition"]);
  for (const item of plan.items) {
    const definition = docs.get(`semester_assessment_definitions/${item.definitionId}`);
    assert.equal(definition.revision, item.kind === "QUIZ" ? 1 : 2);
    assert.equal(definition.status, "PUBLISHED");
    assert.equal(definition.sourceHash, item.sourceHash, "browser fingerprint matches real server source hash");
  }
  const ready = await api.planCurrentAssessmentRelease(config);
  assert.equal(ready.prepareCount, 0);
  assert.equal((await api.prepareCurrentAssessmentRelease(ready)).preparedCount, 0);
  assert.equal(calls.length, 3, "ready rerun has no writes");
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
  const { api, docs, calls, readHook } = harness();
  const plan = await api.planCurrentAssessmentRelease(config);
  const quiz = plan.items.find(item => item.kind === "QUIZ");
  readHook(path => { if (path === `semester_assessment_definitions/${quiz.definitionId}`) docs.get(`${root}/quiz_questions/q1`).answer = "RACE"; });
  await assert.rejects(api.saveAssessmentDefinition(config, quiz.payload, true, quiz), /바뀌었습니다/);
  assert.equal(calls.length, 1);
  assert.equal(docs.has(`semester_assessment_definitions/${quiz.definitionId}`), false);
  console.log("PASS content mutation after preview rejects before atomic publication");
}
{
  const { api, docs, calls, browserReads } = harness();
  const save = next => api.saveQuizAssessmentSettings(config, "unit_1", "diagnostic", "", "진단평가", "unit_1_diagnostic", next);
  await save(settings);
  assert.equal(calls.length, 1);
  assert.equal(browserReads.length, 1, "Only the definition revision is read by the browser; the server reads source once");
  assert.equal(docs.get("semester_assessment_definitions/quiz:2026-2:unit_1:diagnostic").status, "PUBLISHED");
  const before = structuredClone(docs.get("semester_assessment_definitions/quiz:2026-2:unit_1:diagnostic"));
  await assert.rejects(save({ ...settings, questionCount: 2 }), /등록된 문항 수/);
  assert.deepEqual(docs.get("semester_assessment_definitions/quiz:2026-2:unit_1:diagnostic"), before);
  docs.delete(`${root}/quiz_questions/q1`);
  docs.delete("semester_classes/class_a");
  await save({ ...settings, active: false });
  assert.equal(docs.get("semester_assessment_definitions/quiz:2026-2:unit_1:diagnostic").status, "PAUSED");
  assert.equal(docs.get(`${root}/assessment_config/settings`).unit_1_diagnostic.active, false);
  console.log("PASS one-command publication and pause, no question rereads, and failed edit preserves current publication");
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
  assert.deepEqual(calls.slice(callCount).map(call => call.commandType), ["saveHistoryClassroomAssignment"], "Do not pause before source validation");
  console.log("PASS active attempt edit rejection leaves published source/definition intact");
}
{
  const { api, docs, calls, browserReads } = harness();
  const payload = newHistorySource();
  const saved = await api.saveHistoryAssessmentSource(config, "atomic-history", payload, 0);
  const source = docs.get(`${root}/history_classrooms/atomic-history`);
  const definition = docs.get("semester_assessment_definitions/history_classroom:2026-2:atomic-history");
  assert.deepEqual(calls.map(call => call.commandType), ["saveHistoryClassroomAssignment"]);
  assert.equal(browserReads.length, 0, "Saving must not make separate browser Firestore reads");
  assert.equal(source.contentRevision, 1);
  assert.equal(definition.status, "PUBLISHED");
  assert.equal(definition.sourceContentRevision, 1);
  assert.equal(definition.durationSeconds, 600);
  assert.equal(definition.cooldownMinutes, 5);
  assert.equal(definition.itemCount, 28);
  assert.deepEqual(definition.assignedStudentUids, payload.targetStudentUids);
  assert.equal(source.passThresholdPercent, 90);
  assert.equal(saved.publicationWindow.publishedAt, payload.publishedAt);
  assert.equal(saved.publicationWindow.dueAt, payload.dueAt);
  console.log("PASS atomic source+definition publication: 1 command, 0 browser reads, 28 blanks/2 students/90%/600s/5min");
}
{
  const { api, docs, calls, hook } = harness();
  const payload = newHistorySource();
  let lost = false;
  hook(type => { if (type === "saveHistoryClassroomAssignment" && !lost) { lost = true; throw new Error("Synthetic response loss after atomic commit"); } });
  await assert.rejects(api.saveHistoryAssessmentSource(config, "retry-history", payload, 0), /Synthetic response loss/);
  assert.equal(docs.get("semester_assessment_definitions/history_classroom:2026-2:retry-history").status, "PUBLISHED", "No partial source-only state exists after a committed save");
  const saved = await api.saveHistoryAssessmentSource(config, "retry-history", { ...payload,
    publishedAt: "2099-01-02T00:00:00.000Z", dueAt: "2099-01-09T00:00:00.000Z" }, 0);
  assert.equal(calls.length, 1);
  assert.equal(saved.contentRevision, 1);
  assert.equal(saved.publicationWindow.publishedAt, payload.publishedAt);
  assert.equal(saved.publicationWindow.dueAt, payload.dueAt);
  await api.saveHistoryAssessmentSource(config, "retry-history", { ...payload, timeLimitMinutes: 20 }, saved.contentRevision);
  assert.equal(docs.get("semester_assessment_definitions/history_classroom:2026-2:retry-history").durationSeconds, 1200);
  console.log("PASS lost-response retry returns the original complete save and dates, then edited input saves against its revision");
}
for (const change of [{ timeLimitMinutes: 1000 }, { blanks: [] }, { sourceType: "map", lessonUnitId: "", mapResourceId: "legacy-map" }]) {
  const { api, docs } = harness();
  const original = newHistorySource();
  await api.saveHistoryAssessmentSource(config, "reject-history", original, 0);
  const sourcePath = `${root}/history_classrooms/reject-history`;
  const definitionPath = "semester_assessment_definitions/history_classroom:2026-2:reject-history";
  const beforeSource = structuredClone(docs.get(sourcePath)), beforeDefinition = structuredClone(docs.get(definitionPath));
  await assert.rejects(api.saveHistoryAssessmentSource(config, "reject-history", { ...original, ...change }, 1));
  assert.deepEqual(docs.get(sourcePath), beforeSource);
  assert.deepEqual(docs.get(definitionPath), beforeDefinition);
  // With no partial commit, edited input retries safely with the original revision.
  await api.saveHistoryAssessmentSource(config, "reject-history", { ...original, title: "정상 수정" }, 1);
  assert.equal(docs.get(sourcePath).contentRevision, 2);
}
{
  const { api, docs, calls } = harness();
  const payload = newHistorySource();
  await api.saveHistoryAssessmentSource(config, "stale-history", payload, 0);
  await api.saveHistoryAssessmentSource(config, "stale-history", { ...payload, timeLimitMinutes: 20 }, 1);
  const before = structuredClone(docs.get("semester_assessment_definitions/history_classroom:2026-2:stale-history"));
  await assert.rejects(api.saveHistoryAssessmentSource(config, "stale-history", { ...payload, isPublished: false }, 1),
    error => error.details?.reason === "ASSESSMENT_CONTENT_REVISION_CONFLICT");
  assert.deepEqual(docs.get("semester_assessment_definitions/history_classroom:2026-2:stale-history"), before);
  assert.equal(calls.at(-1).commandType, "saveHistoryClassroomAssignment");
}
{
  const { api, auth, calls } = harness();
  auth.currentUser.getIdTokenResult = async () => {
    await Promise.resolve();
    auth.currentUser = { uid: "teacher-b", getIdTokenResult: async () => ({ claims: { auth_time: 2345 } }) };
    return { claims: { auth_time: 1234 } };
  };
  await assert.rejects(api.saveHistoryAssessmentSource(config, "owner-history", newHistorySource(), 0), error => error.code === "functions/unauthenticated");
  assert.equal(calls.length, 0);
}
console.log("PASS atomic rejection preserves both records, changed-input retry, stale competing edits and auth-owner isolation");
{
  const { api } = harness();
  const plan = await api.planCurrentAssessmentRelease(config);
  const history = plan.items.find(item => item.kind === "HISTORY_CLASSROOM").payload;
  const quiz = plan.items.find(item => item.kind === "QUIZ").payload;
  const normalize = serverModule.exports.normalizeAssessmentPayload;
  for (const value of [null, -1, 1.5, "1", true, {}]) {
    for (const commandType of ["createAssessmentDefinition", "updateAssessmentDefinition"]) {
      assert.throws(() => normalize(commandType, { ...history, expectedRevision: 1, reason: "Test", expectedSourceRevision: value }),
        error => error.details?.reason === "ASSESSMENT_PAYLOAD_INVALID");
    }
  }
  assert.throws(() => normalize("createAssessmentDefinition", { ...quiz, expectedSourceRevision: 0 }),
    error => error.details?.reason === "ASSESSMENT_PAYLOAD_INVALID");
  assert.throws(() => normalize("transitionAssessmentDefinition", { definitionId: history.definitionId, expectedRevision: 1,
    targetStatus: "PAUSED", reason: "Test", expectedSourceRevision: 0 }), error => error.details?.reason === "ASSESSMENT_PAYLOAD_INVALID");
}
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
