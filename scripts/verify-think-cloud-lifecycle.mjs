import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash, webcrypto } from "node:crypto";
import ts from "typescript";

const serverModule = { exports: {} };
const serverPath = "functions/productionGateway/w8Domains.js";
const semesterCore = { SEMESTER_MANIFEST_COLLECTION: "semester_manifests", ACTIVE_SEMESTER_POINTER_PATH: "system/active", normalizeSemesterId: (value) => value };
vm.runInNewContext(fs.readFileSync(serverPath, "utf8"), {
  module: serverModule, exports: serverModule.exports, Buffer,
  require: (name) => {
    if (name === "node:crypto") return { createHash };
    if (name === "firebase-functions/v2/https") return { HttpsError: class extends Error { constructor(code, message, details) { super(message); this.code = `functions/${code}`; this.details = details; } } };
    if (name === "./semesterCore") return semesterCore;
    if (name === "./archiveEnrollment") return { SEMESTER_CLASS_COLLECTION: "semester_classes", SEMESTER_ENROLLMENT_COLLECTION: "semester_enrollments", ENROLLMENT_SLOT_COLLECTION: "semester_enrollment_slots", buildEnrollmentSlotId: (semester, uid) => `${semester}:${uid}` };
    if (name === "./routineContentWrites.json") return { commands: [] };
    if (["./cutoverAuthorization", "./sessionAuthority", "./studentMaintenance"].includes(name)) return {};
    throw new Error(name);
  },
});
const adapter = serverModule.exports.createW8CommandAdapter();
const config = { year: "2026", semester: "2" }, root = "years/2026/semesters/2";
const options = { allowDuplicateWord: false, allowDuplicateByStudent: false, inputMode: "word", anonymous: true, maxLength: 20, profanityFilter: true };
const input = { title: "생각모아", description: "", targetGrade: "3", targetClass: "1", targetGradeLabel: "3학년", targetClassLabel: "1반", options };
function harness() {
  const user = (uid) => ({ uid, getIdTokenResult: async () => ({ claims: { auth_time: 1 } }) });
  const auth = { currentUser: user("admin") }, docs = new Map([
    ["system/active", { semesterId: "2026-2", revision: 1 }],
    ["semester_manifests/2026-2", { semesterId: "2026-2", revision: 1, status: "ACTIVE" }],
    ["users/admin", { name: "교사" }], ["users/student", { name: "학생", grade: "3", class: "1" }],
    ["semester_classes/class-1", { classId: "class-1", semesterId: "2026-2", status: "ACTIVE", grade: "3", classNumber: "1", homeroomTeacherUid: "teacher" }],
    ["semester_classes/class-2", { classId: "class-2", semesterId: "2026-2", status: "ACTIVE", grade: "3", classNumber: "2", homeroomTeacherUid: "teacher" }],
    ["semester_enrollment_slots/2026-2:student", { studentUid: "student", semesterId: "2026-2", status: "ACTIVE", activeEnrollmentId: "enroll-1" }],
    ["semester_enrollments/enroll-1", { enrollmentId: "enroll-1", studentUid: "student", semesterId: "2026-2", enrollmentStatus: "ACTIVE", classId: "class-1" }],
  ]), receipts = new Map(), storage = new Map(), modules = {}, calls = [], sensitive = [];
  let dropExecute = false, dropReceipt = false, changeOwner = false;
  const clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v));
  const snapshot = (path) => ({ path, exists: docs.has(path), data: clone(docs.get(path)) });
  const list = (path) => [...docs.keys()].filter((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1).map(snapshot);
  const transaction = {
    get: async (path) => snapshot(path), getAll: async (paths) => paths.map(snapshot),
    query: async (path, filter) => list(path).filter((item) => !filter || item.data[filter.field] === filter.value),
    create: (path, data) => { assert.equal(docs.has(path), false); docs.set(path, clone(data)); },
    set: (path, data, opts) => docs.set(path, opts?.merge ? { ...docs.get(path), ...clone(data) } : clone(data)), delete: (path) => docs.delete(path),
  };
  const state = (payload) => {
    const managed = list("semester_classes").filter((row) => payload.audience !== "student" || row.data.classId === "class-1").map((row) => {
      const current = docs.get(`${root}/think_cloud_state/${row.data.classId}`);
      return { classId: row.data.classId, grade: row.data.grade, classNumber: row.data.classNumber, stateExists: Boolean(current), stateRevision: current?.revision || 0, activeSessionId: current?.activeSessionId || "" };
    });
    const sessions = list(`${root}/think_cloud_sessions`).filter((row) => managed.some((item) => item.classId === row.data.targetClassId)).map((row) => {
      const group = managed.find((item) => item.classId === row.data.targetClassId);
      return { ...row.data, id: row.data.sessionId, stateExists: group.stateExists, stateRevision: group.stateRevision };
    });
    return { semesterId: "2026-2", manifestRevision: 1, readOnly: false, thinkCloudSessions: sessions,
      thinkCloudManagedClasses: managed, thinkCloudState: { activeSessionId: managed[0]?.activeSessionId || "", activeSessionIds: managed.map((item) => item.activeSessionId).filter(Boolean) }, thinkCloudRoster: [],
      thinkCloudResponses: payload.sessionId ? list(`${root}/think_cloud_sessions/${payload.sessionId}/responses`).map((row) => payload.audience === "student" ? { id: row.path.split("/").at(-1), textRaw: row.data.textRaw, textNormalized: row.data.textNormalized, isOwn: row.data.uid === auth.currentUser.uid } : { ...row.data, id: row.path.split("/").at(-1) }) : [],
    };
  };
  const unavailable = () => Object.assign(new Error("lost response"), { code: "functions/unavailable" });
  const service = async (name, payload) => {
    calls.push({ name, payload: clone(payload) });
    if (name === "getW8DomainState") { const result = state(payload); if (changeOwner) auth.currentUser = user("other"); return result; }
    if (name === "getCommandStatus") { if (dropReceipt) { dropReceipt = false; throw unavailable(); } return receipts.get(payload.commandId) || { status: "NOT_FOUND" }; }
    if (name === "executeCommand") {
      if (receipts.has(payload.commandId)) return receipts.get(payload.commandId);
      const result = await adapter.apply({ transaction, commandId: payload.commandId, commandType: payload.commandType, payload: serverModule.exports.normalizeW8Payload(payload.commandType, payload.payload), timestamp: { _seconds: 100 }, actor: { actorUid: auth.currentUser.uid, actorRole: auth.currentUser.uid === "admin" ? "admin" : "student" } });
      const receipt = { status: "SUCCEEDED", result: clone(result.result) };
      receipts.set(payload.commandId, receipt);
      if (dropExecute) { dropExecute = false; throw unavailable(); }
      return receipt;
    }
    throw new Error(name);
  };
  const deps = {
    "./firebase": { auth }, "./semesterScope": { getYearSemester: (value) => value || config },
    "./historyDictionarySession": { getHistoryDictionaryCallable: async (name) => async (payload) => ({ data: await service(name, payload) }) },
    "./sensitiveOperation": { ensureSensitiveOperation: async () => sensitive.push(auth.currentUser.uid) },
    "./safeStorage": { readStorage: (key) => storage.get(key) || null, writeStorage: (key, value) => storage.set(key, value), removeStorage: (key) => storage.delete(key) },
    "firebase/firestore": { Timestamp: class {} },
  };
  const load = (name) => {
    if (modules[name]) return modules[name];
    const module = { exports: {} }; modules[name] = module.exports;
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(`src/lib/${name}.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      module, exports: module.exports, crypto: webcrypto, TextEncoder, console,
      require: (id) => { if (deps[id]) return deps[id]; if (["./thinkCloud", "./wisEconomyClient"].includes(id)) return load(id.slice(2)); throw new Error(id); },
    });
    return module.exports;
  };
  return { api: load("thinkCloudLifecycle"), docs, calls, receipts, sensitive, auth, user, drop: () => { dropExecute = true; dropReceipt = true; }, changeOwner: () => { changeOwner = true; } };
}
{
  const h = harness();
  const first = await h.api.createThinkCloudSession(config, input);
  const second = await h.api.createThinkCloudSession(config, { ...input, targetClass: "2" });
  assert.notEqual(first.sessionId, second.sessionId);
  assert.equal(h.docs.get(`${root}/think_cloud_sessions/${first.sessionId}`).status, "active");
  assert.equal(h.docs.get(`${root}/think_cloud_sessions/${second.sessionId}`).status, "active");
  h.auth.currentUser = h.user("student");
  const state = await h.api.readThinkCloudState(config, "student", first.sessionId);
  assert.equal(state.thinkCloudSessions.length, 1);
  const response = await h.api.submitThinkCloudResponse(config, state.thinkCloudSessions[0], "고조선", "고조선");
  assert.ok(response.responseId);
  assert.equal(h.sensitive.length, 2, "student submission requires no teacher reauthentication");
  await assert.rejects(h.api.submitThinkCloudResponse(config, state.thinkCloudSessions[0], "신라", "신라"), (error) => error.details.reason === "W8_THINK_CLOUD_STUDENT_DUPLICATE");
  const own = await h.api.readThinkCloudState(config, "student", first.sessionId);
  assert.equal(own.thinkCloudResponses[0].uid, "student");
  assert.equal(own.thinkCloudResponses[0].displayName, undefined);
  h.auth.currentUser = h.user("admin");
  const teacher = await h.api.readThinkCloudState(config, "teacher", first.sessionId);
  await h.api.transitionThinkCloudSession(config, teacher.thinkCloudSessions[0], "paused");
  await assert.rejects(h.api.transitionThinkCloudSession(config, teacher.thinkCloudSessions[0], "closed"), (error) => error.details.reason === "W8_THINK_CLOUD_SESSION_REVISION_CONFLICT");
  const updated = await h.api.readThinkCloudState(config, "teacher", first.sessionId);
  await h.api.deleteThinkCloudSession(config, updated.thinkCloudSessions.find((item) => item.id === first.sessionId));
  assert.equal(h.docs.has(`${root}/think_cloud_sessions/${first.sessionId}`), false);
  console.log("PASS actual W8 command validation, class-isolated active sessions, duplicate response prevention, anonymity, revision CAS and delete");
}
{
  const h = harness(); h.drop();
  await assert.rejects(h.api.createThinkCloudSession(config, input));
  assert.equal(h.receipts.size, 1, "lost response already committed once");
  const retry = await h.api.createThinkCloudSession(config, input);
  assert.ok(retry.sessionId);
  assert.equal(h.receipts.size, 1);
  const calls = h.calls.filter((call) => call.name === "executeCommand");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].payload.commandId, calls[1].payload.commandId);
  assert.deepEqual(calls[0].payload.payload, calls[1].payload.payload);
  console.log("PASS lost create response plus failed receipt lookup retries identical intent/revisions without duplicate session");
}
{
  const h = harness(); h.changeOwner();
  await assert.rejects(h.api.readThinkCloudState(config, "student"), /계정이 바뀌었습니다/);
  console.log("PASS owner change discards stale query result");
}
console.log("ThinkCloud lifecycle verification passed.");
