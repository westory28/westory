import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash, webcrypto } from "node:crypto";
import ts from "typescript";

// Exercise the real browser release planner against the deployed command adapter.
// The store is synthetic and contains no credentials or production connection.
const serverPath = "functions/productionGateway/assessmentLifecycle.js";
const serverModule = { exports: {} };
const semesterCore = { SEMESTER_MANIFEST_COLLECTION: "semester_manifests", ACTIVE_SEMESTER_POINTER_PATH: "system/active", normalizeSemesterId: (value) => value };
vm.runInNewContext(fs.readFileSync(serverPath, "utf8"), {
  module: serverModule, exports: serverModule.exports, Buffer,
  require: (name) => {
    if (name === "node:crypto") return { createHash };
    if (name === "firebase-functions/v2/https") return { HttpsError: class extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } } };
    if (name === "./semesterCore") return semesterCore;
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
    [`${root}/history_classrooms/history1`, { title: "역사교실", isPublished: true, blanks: [{ id: "blank-a", answer: "A" }], targetStudentUids: ["student-a"], timeLimitMinutes: 10, cooldownMinutes: 5 }],
  ]);
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const snap = (path) => ({ path, id: path.split("/").at(-1), exists: docs.has(path), data: clone(docs.get(path)) });
  const list = (path) => [...docs.keys()].filter((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1).map(snap);
  const calls = [];
  const operations = new Map();
  let afterCommand;
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
      if (name === "./firebase") return { db: {} };
      if (name === "firebase/firestore") return {
        doc: (_db, ...parts) => parts.join("/"), collection: (_db, ...parts) => parts.join("/"),
        getDoc: async (path) => { const data = snap(path); return { exists: () => data.exists, data: () => data.data }; },
        getDocs: async (path) => ({ docs: list(path).map((item) => ({ id: item.id, data: () => item.data })) }),
      };
      if (name === "./semesterScope") return { getYearSemester: (value) => value || config, getSemesterCollectionPath: (value, collection) => `years/${value.year}/semesters/${value.semester}/${collection}`, getSemesterDocPath: (value, collection, id) => `years/${value.year}/semesters/${value.semester}/${collection}/${id}` };
      if (name === "./mockExamRounds") return { DEFAULT_MOCK_EXAM_ROUND: "round_1" };
      if (name === "./wisEconomyClient") return { runWisOperation: async (intent, _sensitive, action) => {
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
  return { api: module.exports, docs, calls, hook: (callback) => { afterCommand = callback; } };
}

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
  assert.ok(calls.length > 4);
  console.log("PASS published source pause/update/republish, drafts, and stale source revision rejection");
}
console.log("Assessment release verification passed.");
