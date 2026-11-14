import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash, webcrypto } from "node:crypto";
import ts from "typescript";

// Execute the real Firebase router with SDK calls stubbed, including emulator
// routing. This verifies selected regions without credentials or network I/O.
for (const emulator of [false, true]) {
  const exports = {}, routes = [], connected = [];
  const modules = {
    "./semesterArchive": { isSemesterArchive: false, assertArchiveWritable() {} },
    "./loginPerf": { markLoginPerf() {} },
    "firebase/app": { initializeApp: () => ({}) },
    "firebase/auth": { getAuth: () => ({}), setPersistence: async () => {} },
    "firebase/firestore": { getFirestore: () => ({}), connectFirestoreEmulator() {} },
    "firebase/functions": {
      getFunctions: (_app, region) => ({ region }),
      connectFunctionsEmulator: (functions, host, port) => connected.push({ region: functions.region, host, port }),
      httpsCallable: (functions, name, options) => async (payload) => { routes.push({ region: functions.region, name, options, payload }); return { data: { ok: true } }; },
    },
  };
  const source = fs.readFileSync("src/lib/firebase.ts", "utf8").replaceAll("import.meta.env", `(${JSON.stringify(emulator ? { DEV: true, VITE_USE_FIREBASE_EMULATORS: "true" } : {})})`);
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, console: { info() {}, warn() {} }, require: (name) => { assert.ok(name in modules, name); return modules[name]; },
  });
  for (const [name, region] of [
    ["executeThinkCloudResponseFast", "us-central1"], ["getThinkCloudStateFast", "us-central1"],
    ["executeCommand", "asia-northeast3"], ["getCommandStatus", "asia-northeast3"],
    ["getThinkCloudState", "asia-northeast3"], ["openApplicationSession", "asia-northeast3"],
    ["executeWisCommandFast", "us-central1"], ["getWisCommandStatusFast", "us-central1"], ["getWisEconomyStateFast", "us-central1"],
  ]) {
    const callable = await exports.getHttpsCallable(name, { timeout: 1234 }); await callable({ marker: name });
    assert.deepEqual(JSON.parse(JSON.stringify(routes.at(-1))), { region, name, options: { timeout: 1234 }, payload: { marker: name } });
  }
  assert.equal(connected.length, emulator ? 2 : 0, "only one Functions instance per region");
  if (emulator) assert.deepEqual(connected.map((entry) => entry.region).sort(), ["asia-northeast3", "us-central1"]);
}
console.log("PASS real Firebase region routing for ThinkCloud fast calls, unchanged commands/receipts/Wis and both emulator regions");

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
  const timers = new Map(), windowListeners = new Map(), documentListeners = new Map(), watchers = new Map(), listenerHistory = [];
  let heldRead, holdRead = false, nextReadError, nextReadHook;
  let nextTimer = 0;
  const browserWindow = {
    setTimeout: (callback, delay) => { assert.equal(delay, 180); const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: () => { throw new Error("ThinkCloud must not poll"); },
    addEventListener: (name, callback) => windowListeners.set(name, callback),
    removeEventListener: (name) => windowListeners.delete(name),
  };
  const browserDocument = {
    visibilityState: "visible",
    addEventListener: (name, callback) => documentListeners.set(name, callback),
    removeEventListener: (name) => documentListeners.delete(name),
  };
  let dropExecute = false, dropReceipt = false, changeOwner = false;
  const clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v));
  const snapshot = (path) => ({ path, exists: docs.has(path), data: clone(docs.get(path)) });
  const list = (path) => [...docs.keys()].filter((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1).map(snapshot);
  const reads = [];
  const transaction = {
    get: async (path) => { reads.push({ path }); return snapshot(path); }, getAll: async (paths) => { reads.push(...paths.map((path) => ({ path }))); return paths.map(snapshot); },
    query: async (path, filter) => {
      const clauses = filter?.filters || (filter?.field ? [filter] : []);
      const rows = list(path).filter((item) => clauses.every((clause) =>
        clause.operator === "in" ? clause.value.includes(item.data[clause.field]) : clause.operator === ">" ? item.data[clause.field] > clause.value : item.data[clause.field] === clause.value));
      reads.push({ path, filter: clone(filter), count: rows.length });
      return rows;
    },
    create: (path, data) => { assert.equal(docs.has(path), false); docs.set(path, clone(data)); },
    set: (path, data, opts) => docs.set(path, opts?.merge ? { ...docs.get(path), ...clone(data) } : clone(data)), delete: (path) => docs.delete(path),
  };
  const queryCore = serverModule.exports.createW8QueryCore({
    store: { get: transaction.get, runTransaction: async (callback) => callback(transaction) },
    assertSession: async (request) => ({ uid: request.auth.uid, email: request.auth.token.email }),
  });
  const query = (audience, payload = {}) => queryCore.getW8DomainState({
    auth: { uid: auth.currentUser.uid, token: { email: auth.currentUser.uid === "admin" ? "westoria28@gmail.com" : "" } },
    data: { semesterId: "2026-2", domain: "LEARNING", source: "CURRENT", projection: "think-cloud", audience, ...payload },
  });
  const emit = (classId, overrides = {}) => {
    const path = `${root}/think_cloud_state/${classId}`;
    const listener = watchers.get(path);
    if (listener) listener.next({ exists: () => docs.has(path), data: () => clone(docs.get(path)), metadata: { fromCache: false, hasPendingWrites: false, ...overrides } });
  };
  const unavailable = () => Object.assign(new Error("lost response"), { code: "functions/unavailable" });
  const service = async (transportName, payload) => {
    const name = { getThinkCloudStateFast: "getThinkCloudState", executeThinkCloudResponseFast: "executeCommand" }[transportName] || transportName;
    calls.push({ name, transportName, payload: clone(payload) });
    if (name === "getThinkCloudState") {
      if (nextReadError) { const error = nextReadError; nextReadError = undefined; throw error; }
      if (nextReadHook) { const hook = nextReadHook; nextReadHook = undefined; hook(); }
      const result = await query(payload.audience, payload);
      if (holdRead) { holdRead = false; await new Promise((resolve) => { heldRead = resolve; }); }
      if (changeOwner) auth.currentUser = user("other");
      return result;
    }
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
    "./semesterArchive": { isSemesterArchive: false },
    "./firebase": { auth, db: {} }, "./semesterScope": { getYearSemester: (value) => value || config, getSemesterDocPath: (value, collection, id) => `years/${value.year}/semesters/${value.semester}/${collection}/${id}` },
    "./historyDictionarySession": { getHistoryDictionaryCallable: async (name) => async (payload) => ({ data: await service(name, payload) }) },
    "./sensitiveOperation": { ensureSensitiveOperation: async () => sensitive.push(auth.currentUser.uid) },
    "./safeStorage": { readStorage: (key) => storage.get(key) || null, writeStorage: (key, value) => storage.set(key, value), removeStorage: (key) => storage.delete(key) },
    "firebase/firestore": {
      Timestamp: class {}, doc: (_db, path) => path,
      onSnapshot: (path, _options, next, error) => {
        const listener = { path, next, error }; watchers.set(path, listener); listenerHistory.push(listener);
        queueMicrotask(() => { if (watchers.get(path) === listener) emit(path.split("/").at(-1)); });
        return () => { if (watchers.get(path) === listener) watchers.delete(path); };
      },
    },
  };
  const load = (name) => {
    if (modules[name]) return modules[name];
    const module = { exports: {} }; modules[name] = module.exports;
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(`src/lib/${name}.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      module, exports: module.exports, crypto: webcrypto, TextEncoder, console, window: browserWindow, document: browserDocument,
      require: (id) => { if (deps[id]) return deps[id]; if (["./thinkCloud", "./wisEconomyClient"].includes(id)) return load(id.slice(2)); throw new Error(id); },
    });
    return module.exports;
  };
  return {
    watchers, listenerHistory, emit,
    flushTimers: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((callback) => callback()); },
    onNextRead: (callback) => { nextReadHook = callback; },
    holdNextRead: () => { holdRead = true; }, releaseRead: () => { assert.ok(heldRead); heldRead(); heldRead = undefined; },
    rejectNextRead: (error) => { nextReadError = error; },
    api: load("thinkCloudLifecycle"), docs, calls, receipts, sensitive, auth, user, query, reads, timers, browserDocument, windowListeners, documentListeners, drop: () => { dropExecute = true; dropReceipt = true; }, changeOwner: () => { changeOwner = true; } };
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
  const h = harness(); const session = await h.api.createThinkCloudSession(config, input);
  assert.equal(h.calls.find((call) => call.name === "executeCommand").transportName, "executeCommand", "teacher create keeps its original command path");
  h.auth.currentUser = h.user("student");
  const state = await h.api.readThinkCloudState(config, "student", session.sessionId);
  h.calls.length = 0; h.drop();
  await assert.rejects(h.api.submitThinkCloudResponse(config, state.thinkCloudSessions[0], "백제", "백제"));
  const retry = await h.api.submitThinkCloudResponse(config, state.thinkCloudSessions[0], "백제", "백제");
  const commands = h.calls.filter((call) => call.name === "executeCommand");
  assert.equal(commands.length, 2);
  assert.ok(commands.every((call) => call.transportName === "executeThinkCloudResponseFast"));
  assert.equal(commands[0].payload.commandId, commands[1].payload.commandId);
  assert.deepEqual(commands[0].payload.payload, commands[1].payload.payload);
  assert.ok(h.calls.filter((call) => call.name === "getThinkCloudState").every((call) => call.transportName === "getThinkCloudStateFast"));
  assert.ok(h.calls.filter((call) => call.name === "getCommandStatus").every((call) => call.transportName === "getCommandStatus"));
  assert.equal([...h.docs.keys()].filter((key) => key.startsWith(`${root}/think_cloud_sessions/${session.sessionId}/responses/`)).length, 1);
  assert.ok(retry.responseId);
  console.log("PASS submit-only fast command routing and lost-response receipt retry preserve the exact command without duplicate writes");
}
{
  const h = harness(); h.auth.currentUser = h.user("student"); h.changeOwner();
  await assert.rejects(h.api.readThinkCloudState(config, "student"), /계정이 바뀌었습니다/);
  console.log("PASS owner change discards stale query result");
}
{
  const h = harness();
  const first = await h.api.createThinkCloudSession(config, input);
  const second = await h.api.createThinkCloudSession(config, { ...input, targetClass: "2" });
  h.docs.set(`${root}/think_cloud_sessions/legacy-numeric`, {
    sessionId: "legacy-numeric", targetGrade: 3, targetClass: 1, status: "closed", createdAt: { _seconds: 1 }, options,
  });
  for (let index = 0; index < 30; index++) {
    h.docs.set(`semester_enrollments/unrelated-${index}`, {
      semesterId: "2026-2", enrollmentStatus: "ACTIVE", classId: "class-2", studentUid: `other-${index}`,
    });
    h.docs.set(`${root}/think_cloud_sessions/unrelated-${index}`, {
      sessionId: `unrelated-${index}`, targetGrade: "3", targetClass: "2", status: "closed", options,
    });
  }
  h.docs.set(`semester_enrollments/older`, { enrollmentId: "older", studentUid: "student", semesterId: "2025-2", enrollmentStatus: "ACTIVE", classId: "old-class" });
  h.docs.set(`${root}/think_cloud_sessions/${first.sessionId}/responses/own`, { uid: "student", displayName: "private", textRaw: "신라", textNormalized: "신라" });
  h.docs.set(`${root}/think_cloud_sessions/${first.sessionId}/responses/other`, { uid: "other", displayName: "private-other", textRaw: "백제", textNormalized: "백제" });
  h.auth.currentUser = h.user("student");
  h.reads.length = 0;
  const student = await h.query("student");
  assert.equal(student.thinkCloudSelectedSessionId, first.sessionId, "the first read includes the active topic's responses");
  assert.equal(student.thinkCloudSessions.length, 2, "numeric legacy class values remain visible");
  assert.equal(student.thinkCloudResponses.length, 2);
  assert.equal(student.thinkCloudResponses.find((row) => row.id === "own").isOwn, true);
  assert.ok(student.thinkCloudResponses.every((row) => row.uid === undefined && row.displayName === undefined), "anonymous responses never expose names or UIDs");
  assert.equal(h.reads.find((row) => row.path === `${root}/think_cloud_sessions`).count, 2, "other classes' topics are not read");
  assert.equal(h.reads.find((row) => row.path === "semester_enrollments").count, 1, "historical enrollments are not read");
  assert.equal(h.reads.filter((row) => row.path === "semester_classes").length, 0, "student reads only the enrolled class document");
  const unrelatedCollections = ["LEARNING_CONTENT_COLLECTION", "LEARNING_PROGRESS_COLLECTION", "LEARNING_EXEMPTION_COLLECTION", "LEARNING_EXEMPTION_REQUEST_COLLECTION"].map((key) => serverModule.exports[key]);
  assert.ok(h.reads.every((row) => !unrelatedCollections.includes(row.path)), "Think Cloud never queries unrelated learning state");
  await assert.rejects(h.query("student", { sessionId: second.sessionId }), (error) => error.details.reason === "W8_THINK_CLOUD_TARGET_FORBIDDEN");
  await assert.rejects(h.query("teacher"), (error) => error.details.reason === "W8_MANAGE_REQUIRED");
  await assert.rejects(h.query("student", { studentUid: "other" }), (error) => error.details.reason === "W8_STUDENT_SCOPE_FORBIDDEN");
  h.auth.currentUser = h.user("admin");
  h.reads.length = 0;
  const teacher = await h.query("teacher", { sessionId: first.sessionId });
  assert.equal(teacher.thinkCloudRoster.length, 1);
  assert.equal(h.reads.find((row) => row.path === "semester_enrollments").count, 1, "teacher reads the selected class roster, not the whole semester");
  assert.equal(teacher.thinkCloudResponses.find((row) => row.id === "own").uid, "student", "teacher retains authorized identity data");
  h.reads.length = 0;
  const metadata = await h.query("teacher", { sessionId: first.sessionId, projection: "think-cloud-command" });
  assert.equal(metadata.thinkCloudSessions.length, 1);
  assert.equal(metadata.thinkCloudResponses.length, 0);
  assert.equal(metadata.thinkCloudRoster.length, 0);
  assert.ok(!h.reads.some((row) => row.path === `${root}/think_cloud_sessions` || row.path.endsWith("/responses") || row.path === "semester_enrollments"), "commands read a single topic, no topic collection, response list or roster");
  h.reads.length = 0;
  await h.query("teacher", { projection: undefined });
  assert.ok(unrelatedCollections.every((path) => h.reads.some((row) => row.path === path)), "legacy full LEARNING contract still reads its required state");
  h.docs.set("users/teacher", { role: "teacher" });
  h.docs.set("semester_classes/class-2", { ...h.docs.get("semester_classes/class-2"), homeroomTeacherUid: "another-teacher" });
  h.auth.currentUser = h.user("teacher");
  const homeroom = await h.query("teacher");
  assert.equal(homeroom.thinkCloudSessions.length, 2);
  await assert.rejects(h.query("teacher", { sessionId: second.sessionId }), (error) => error.details.reason === "W8_THINK_CLOUD_TARGET_FORBIDDEN");
  h.docs.set("users/delegate", { role: "staff", teacherPortalEnabled: true, staffPermissions: ["lesson_read"] });
  h.auth.currentUser = h.user("delegate");
  const delegated = await h.query("teacher", { sessionId: second.sessionId });
  assert.equal(delegated.readOnly, true, "delegated lesson read stays read-only");
  assert.equal(delegated.thinkCloudRoster.length, 30);
  h.auth.currentUser = h.user("student");
  h.docs.set("system/active", { semesterId: "2027-1", revision: 1 });
  await assert.rejects(h.query("student"), (error) => error.details.reason === "W8_STUDENT_CURRENT_SEMESTER_REQUIRED");
  console.log("PASS bounded Think Cloud projections, initial detail read, legacy class values, anonymity, authorization and full-query compatibility");
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const counts = (h) => ({
  full: h.calls.filter((call) => call.name === "getThinkCloudState" && call.payload.projection === "think-cloud").length,
  delta: h.calls.filter((call) => call.name === "getThinkCloudState" && call.payload.projection === "think-cloud-delta").length,
});
const putResponse = (h, sessionId, sequence, text = `생각${sequence}`, classId = "class-1") => {
  h.docs.set(`${root}/think_cloud_sessions/${sessionId}/responses/response-${sequence}`, { uid: "student", textRaw: text, textNormalized: text, sequence });
  const path = `${root}/think_cloud_state/${classId}`;
  h.docs.set(path, { ...h.docs.get(path), responseRevision: sequence, responseSessionId: sessionId });
};
{
  const h = harness();
  const first = await h.api.createThinkCloudSession(config, input);
  const second = await h.api.createThinkCloudSession(config, input);
  const other = await h.api.createThinkCloudSession(config, { ...input, targetClass: "2" });
  h.docs.set(`${root}/think_cloud_sessions/${second.sessionId}/responses/legacy`, { uid: "student", textRaw: "신라", textNormalized: "신라" });
  h.calls.length = 0;
  const states = [], errors = [];
  const stop = h.api.subscribeThinkCloudState(config, "teacher", second.sessionId, (state) => {
    states.push(state); stop.selectSession(state.thinkCloudSelectedSessionId);
  }, (error) => errors.push(error));
  await settle();
  assert.deepEqual(counts(h), { full: 1, delta: 0 });
  assert.equal(h.watchers.size, 2, "watch authorized classes including class-wide status changes");
  assert.equal(h.timers.size, 0, "unchanged first signal does not schedule a fetch");
  const initial = states.at(-1), roster = initial.thinkCloudRoster;
  assert.equal(initial.thinkCloudResponses[0].sequence, 0, "legacy responses remain in the full snapshot");
  for (let index = 0; index < 20; index++) h.emit("class-1");
  h.flushTimers(); await settle();
  assert.deepEqual(counts(h), { full: 1, delta: 0 }, "unchanged signals perform zero calls");
  for (let sequence = 1; sequence <= 25; sequence++) { putResponse(h, second.sessionId, sequence); h.emit("class-1"); }
  assert.equal(h.timers.size, 1, "one 180ms batch for a response burst");
  h.flushTimers(); await settle();
  assert.deepEqual(counts(h), { full: 1, delta: 1 }, "25 submitted responses produce exactly one delta callable");
  assert.equal(states.at(-1).thinkCloudResponses.length, 26);
  assert.equal(states.at(-1).thinkCloudSessions.length, initial.thinkCloudSessions.length);
  assert.equal(states.at(-1).thinkCloudManagedClasses.length, 2);
  assert.equal(states.at(-1).thinkCloudRoster, roster, "delta preserves the existing roster without reading it again");
  assert.equal(h.calls.at(-1).payload.afterResponseSequence, 0);
  const lastDeltaRead = h.reads.filter((row) => row.path.endsWith("/responses")).at(-1);
  assert.deepEqual(lastDeltaRead.filter, { field: "sequence", operator: ">", value: 0 });
  for (let index = 0; index < 10; index++) h.emit("class-1");
  h.flushTimers(); await settle();
  assert.deepEqual(counts(h), { full: 1, delta: 1 });
  putResponse(h, other.sessionId, 1, "다른 반", "class-2"); h.emit("class-2");
  h.flushTimers(); await settle();
  assert.deepEqual(counts(h), { full: 1, delta: 1 }, "other class response signals do not read its responses");
  putResponse(h, second.sessionId, 26);
  h.emit("class-1", { fromCache: true });
  h.emit("class-1", { hasPendingWrites: true });
  assert.equal(h.timers.size, 0, "unconfirmed signals never trigger authorized reads");
  h.holdNextRead(); h.emit("class-1"); h.flushTimers(); await settle();
  putResponse(h, second.sessionId, 27); h.emit("class-1"); h.releaseRead(); await settle();
  assert.equal(h.timers.size, 1, "a later watermark received in flight is retained");
  h.flushTimers(); await settle();
  assert.deepEqual(counts(h), { full: 1, delta: 3 });
  assert.equal(states.at(-1).thinkCloudResponses.length, 28);
  assert.equal(new Set(states.at(-1).thinkCloudResponses.map((item) => item.id)).size, 28);
  assert.equal(h.calls.at(-1).payload.afterResponseSequence, 26);
  const class2 = `${root}/think_cloud_state/class-2`;
  h.docs.set(class2, { ...h.docs.get(class2), revision: h.docs.get(class2).revision + 1 }); h.emit("class-2");
  h.flushTimers(); await settle();
  assert.deepEqual(counts(h), { full: 2, delta: 3 }, "another class status change refreshes the topic list");
  stop.selectSession(first.sessionId); h.windowListeners.get("focus")(); await settle();
  assert.deepEqual(counts(h), { full: 3, delta: 3 }, "selection and focus share the same full read");
  assert.equal(states.at(-1).thinkCloudSelectedSessionId, first.sessionId);
  assert.equal(states.at(-1).thinkCloudResponses.length, 0, "selection never merges old topic responses");
  stop();
  assert.equal(errors.length, 0);
  assert.equal(h.watchers.size, 0); assert.equal(h.timers.size, 0);
  assert.equal(h.windowListeners.size, 0); assert.equal(h.documentListeners.size, 0);
  console.log("PASS no polling, no-change zero calls, 25-response burst one delta, watermark catch-up, roster/topic preservation and scoped signal reads");
}
{
  const h = harness();
  const session = await h.api.createThinkCloudSession(config, input);
  h.auth.currentUser = h.user("student"); h.calls.length = 0; h.holdNextRead();
  const states = [], errors = [];
  const stop = h.api.subscribeThinkCloudState(config, "student", "", (state) => states.push(state), (error) => errors.push(error));
  await settle(); putResponse(h, session.sessionId, 1); h.releaseRead(); await settle();
  assert.equal(h.timers.size, 1, "initial listener catches changes between full snapshot and attachment");
  h.flushTimers(); await settle();
  assert.deepEqual(counts(h), { full: 1, delta: 1 });
  assert.equal(states.at(-1).thinkCloudResponses[0].uid, "student");
  const staleListener = h.listenerHistory.at(-1);
  h.holdNextRead(); putResponse(h, session.sessionId, 2); h.emit("class-1"); h.flushTimers(); await settle();
  const beforeHidden = states.length;
  h.browserDocument.visibilityState = "hidden"; h.documentListeners.get("visibilitychange")();
  assert.equal(h.watchers.size, 0); assert.equal(h.timers.size, 0);
  h.releaseRead(); await settle();
  assert.equal(states.length, beforeHidden, "in-flight result is discarded after hiding");
  staleListener.next({ exists: () => true, data: () => ({ revision: 99, responseRevision: 99, responseSessionId: session.sessionId }), metadata: {} });
  staleListener.error(new Error("late callback"));
  assert.equal(errors.length, 0); assert.equal(h.timers.size, 0);
  putResponse(h, session.sessionId, 3);
  h.browserDocument.visibilityState = "visible"; h.documentListeners.get("visibilitychange")(); h.windowListeners.get("focus")();
  assert.equal(h.timers.size, 1); h.flushTimers(); await settle();
  assert.deepEqual(counts(h), { full: 2, delta: 2 }, "foreground does one authorized full refresh");
  assert.equal(states.at(-1).thinkCloudResponses.length, 3);
  staleListener.next({ exists: () => true, data: () => ({ revision: 99, responseRevision: 99, responseSessionId: session.sessionId }), metadata: {} });
  h.flushTimers(); await settle(); assert.deepEqual(counts(h), { full: 2, delta: 2 }, "old listener frames are ignored after reconnect");
  stop();
  console.log("PASS initial listener race, hidden-tab detach, in-flight discard, foreground coalescing and old listener rejection");
}
{
  const h = harness(); h.auth.currentUser = h.user("student");
  const states = [], errors = [];
  const stop = h.api.subscribeThinkCloudState(config, "student", "", (state) => states.push(state), (error) => errors.push(error));
  await settle(); assert.equal(h.watchers.size, 1, "an empty class still watches its missing state document");
  assert.equal(states.at(-1).thinkCloudSessions.length, 0);
  h.docs.set(`${root}/think_cloud_sessions/new-topic`, { sessionId: "new-topic", targetClassId: "class-1", targetGrade: "3", targetClass: "1", status: "active", options });
  h.docs.set(`${root}/think_cloud_state/class-1`, { revision: 1, activeSessionId: "new-topic" }); h.emit("class-1");
  h.flushTimers(); await settle();
  assert.equal(states.at(-1).thinkCloudSelectedSessionId, "new-topic");
  h.listenerHistory.at(-1).error(Object.assign(new Error("permission denied"), { code: "permission-denied" }));
  assert.equal(errors.length, 1); assert.equal(h.watchers.size, 0); assert.equal(h.timers.size, 0);
  assert.equal(h.windowListeners.size, 0);
  h.flushTimers(); await settle(); assert.deepEqual(counts(h), { full: 2, delta: 0 }, "permission failure stops all automatic recovery calls");
  stop();
  const retry = h.api.subscribeThinkCloudState(config, "student", "", (state) => states.push(state), (error) => errors.push(error));
  await settle(); assert.equal(h.watchers.size, 1); assert.deepEqual(counts(h), { full: 3, delta: 0 }); retry();
  console.log("PASS missing class document discovery, permission failure fail-closed and explicit recovery");
}
{
  const h = harness(); const session = await h.api.createThinkCloudSession(config, input);
  h.auth.currentUser = h.user("student"); h.calls.length = 0;
  const states = [], errors = [];
  const stop = h.api.subscribeThinkCloudState(config, "student", session.sessionId, (state) => states.push(state), (error) => errors.push(error));
  await settle();
  h.rejectNextRead(Object.assign(new Error("cursor invalid"), { code: "functions/aborted", details: { reason: "W8_THINK_CLOUD_RESPONSE_CURSOR_INVALID" } }));
  putResponse(h, session.sessionId, 1); h.emit("class-1"); h.flushTimers(); await settle();
  assert.equal(h.timers.size, 1); h.flushTimers(); await settle();
  assert.deepEqual(counts(h), { full: 2, delta: 1 }); assert.equal(states.at(-1).thinkCloudResponses.length, 1);
  h.rejectNextRead(Object.assign(new Error("network unavailable"), { code: "functions/unavailable" }));
  putResponse(h, session.sessionId, 2); h.emit("class-1"); h.flushTimers(); await settle();
  assert.equal(errors.length, 1); assert.equal(h.watchers.size, 0); assert.equal(h.timers.size, 0);
  assert.deepEqual(counts(h), { full: 2, delta: 2 }, "transport failure never starts silent polling"); stop();
  console.log("PASS invalid cursor full reset and transport failure manual recovery boundary");
}
{
  const h = harness(); const first = await h.api.createThinkCloudSession(config, input);
  h.auth.currentUser = h.user("student"); h.calls.length = 0;
  const states = [], errors = [];
  const stop = h.api.subscribeThinkCloudState(config, "student", first.sessionId, (state) => states.push(state), (error) => errors.push(error));
  await settle();
  putResponse(h, first.sessionId, 1); h.emit("class-1");
  h.onNextRead(() => {
    const classPath = `${root}/think_cloud_state/class-1`, topicPath = `${root}/think_cloud_sessions/${first.sessionId}`;
    h.docs.set(topicPath, { ...h.docs.get(topicPath), status: "closed" });
    h.docs.set(`${root}/think_cloud_sessions/new-during-delta`, { sessionId: "new-during-delta", targetClassId: "class-1", targetGrade: "3", targetClass: "1", status: "active", options });
    h.docs.set(classPath, { ...h.docs.get(classPath), revision: h.docs.get(classPath).revision + 1, activeSessionId: "new-during-delta" });
    h.emit("class-1");
  });
  h.flushTimers(); await settle();
  assert.equal(states.length, 1, "a delta cannot acknowledge the new class revision with an incomplete topic list");
  assert.equal(h.timers.size, 1); h.flushTimers(); await settle();
  assert.deepEqual(counts(h), { full: 2, delta: 1 });
  assert.equal(states.at(-1).thinkCloudSessions.length, 2);
  assert.equal(states.at(-1).thinkCloudSessions.find((item) => item.id === first.sessionId).status, "closed");
  h.holdNextRead(); putResponse(h, first.sessionId, 2); h.emit("class-1"); h.flushTimers(); await settle();
  const beforeSelection = states.length;
  stop.selectSession("new-during-delta"); h.releaseRead(); await settle();
  assert.equal(states.length, beforeSelection, "a late delta from the old selection is discarded");
  h.flushTimers(); await settle();
  assert.equal(states.at(-1).thinkCloudSelectedSessionId, "new-during-delta");
  assert.equal(states.at(-1).thinkCloudResponses.length, 0);
  assert.equal(errors.length, 0); stop();
  console.log("PASS concurrent topic transition forces a full list refresh and selection rejects the old delta");
}
for (const revoke of [false, true]) {
  const h = harness(); const first = await h.api.createThinkCloudSession(config, input);
  h.auth.currentUser = h.user("student"); h.calls.length = 0;
  const states = [], errors = [];
  const stop = h.api.subscribeThinkCloudState(config, "student", first.sessionId, (state) => states.push(state), (error) => errors.push(error));
  await settle(); putResponse(h, first.sessionId, 1); h.emit("class-1");
  h.onNextRead(() => {
    h.docs.delete(`${root}/think_cloud_sessions/${first.sessionId}`);
    const classPath = `${root}/think_cloud_state/class-1`;
    h.docs.set(classPath, { ...h.docs.get(classPath), revision: h.docs.get(classPath).revision + 1, activeSessionId: "" });
    h.emit("class-1");
  });
  h.flushTimers(); await settle();
  assert.equal(errors.length, 0, "a confirmed operation signal recovers the raced target-forbidden delta");
  assert.equal(h.timers.size, 1);
  if (revoke) h.docs.delete("semester_enrollments/enroll-1");
  h.flushTimers(); await settle();
  assert.deepEqual(counts(h), { full: 2, delta: 1 }, "only one authorized full recovery follows the failed delta");
  assert.equal(h.calls.at(-1).payload.sessionId, undefined, "deleted topic is not reused by the full recovery");
  if (revoke) {
    assert.equal(errors.length, 1); assert.equal(states.length, 1);
    assert.equal(h.watchers.size, 0); assert.equal(h.timers.size, 0);
  } else {
    assert.equal(errors.length, 0); assert.equal(states.at(-1).thinkCloudSessions.length, 0);
    assert.equal(states.at(-1).thinkCloudResponses.length, 0);
    assert.equal(states.at(-1).thinkCloudSelectedSessionId, "");
  }
  stop();
}
console.log("PASS concurrent deletion recovers through one authorized full read, with revoked access still failing closed");
for (const rejectRecovery of [false, true]) {
  const h = harness(); const first = await h.api.createThinkCloudSession(config, input);
  const remaining = await h.api.createThinkCloudSession(config, { ...input, targetClass: "2" });
  h.calls.length = 0;
  const states = [], errors = [];
  const stop = h.api.subscribeThinkCloudState(config, "teacher", first.sessionId, (state) => states.push(state), (error) => errors.push(error));
  await settle();
  h.docs.delete(`${root}/think_cloud_sessions/${first.sessionId}`);
  const classPath = `${root}/think_cloud_state/class-1`;
  h.docs.set(classPath, { ...h.docs.get(classPath), revision: h.docs.get(classPath).revision + 1, activeSessionId: "" }); h.emit("class-1");
  h.flushTimers(); await settle();
  assert.deepEqual(counts(h), { full: 2, delta: 0 }, "direct deletion signals request a full snapshot, not a delta");
  assert.equal(h.timers.size, 1); assert.equal(errors.length, 0);
  if (rejectRecovery) h.rejectNextRead(Object.assign(new Error("access revoked"), { code: "functions/permission-denied", details: { reason: "W8_THINK_CLOUD_TARGET_FORBIDDEN" } }));
  h.flushTimers(); await settle();
  assert.deepEqual(counts(h), { full: 3, delta: 0 }, "deleted full selection gets exactly one full recovery");
  assert.equal(h.calls.at(-1).payload.sessionId, undefined);
  if (rejectRecovery) {
    assert.equal(errors.length, 1); assert.equal(states.length, 1);
    assert.equal(h.timers.size, 0); assert.equal(h.watchers.size, 0);
    // Teacher onError clears selectedSessionId before its manual retry.
    const retry = h.api.subscribeThinkCloudState(config, "teacher", "", (state) => states.push(state), (error) => errors.push(error));
    await settle(); assert.deepEqual(counts(h), { full: 4, delta: 0 });
    assert.equal(states.at(-1).thinkCloudSelectedSessionId, remaining.sessionId); retry();
  } else {
    assert.equal(errors.length, 0); assert.equal(states.at(-1).thinkCloudSessions.length, 1);
    assert.equal(states.at(-1).thinkCloudSelectedSessionId, remaining.sessionId);
    assert.equal(states.at(-1).thinkCloudResponses.length, 0); assert.equal(h.timers.size, 0);
  }
  stop();
}
console.log("PASS direct deletion full-read recovery, bounded failure and teacher manual retry without the removed selection");
for (const boundary of ["owner", "semester", "unsubscribe"]) {
  const h = harness(); const session = await h.api.createThinkCloudSession(config, input);
  h.auth.currentUser = h.user("student"); h.calls.length = 0;
  const localConfig = { ...config }, states = [], errors = [];
  h.holdNextRead();
  const stop = h.api.subscribeThinkCloudState(localConfig, "student", session.sessionId, (state) => states.push(state), (error) => errors.push(error));
  await settle();
  if (boundary === "owner") h.auth.currentUser = h.user("other");
  if (boundary === "semester") localConfig.semester = "1";
  if (boundary === "unsubscribe") stop();
  h.releaseRead(); await settle();
  assert.equal(states.length, 0, `${boundary} prevents old data from being emitted`);
  assert.equal(h.watchers.size, 0); assert.equal(h.timers.size, 0);
  assert.equal(errors.length, boundary === "unsubscribe" ? 0 : 1);
  stop();
}
console.log("PASS account, semester and unmount boundaries reject late full results");
console.log("ThinkCloud lifecycle verification passed.");
