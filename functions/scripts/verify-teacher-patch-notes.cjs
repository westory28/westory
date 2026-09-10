const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const gateway = require("../commandGateway");
const notes = require("../teacherPatchNotes");

// Serialize races and stage all writes so a rejected command rolls back notes,
// receipts and audits together. Reads after any staged write are forbidden.
class Store {
  constructor(seed = {}) { this.docs = new Map(Object.entries(seed)); this.queue = Promise.resolve(); }
  async get(path) { return { path, exists: this.docs.has(path), data: structuredClone(this.docs.get(path) || null) }; }
  async runTransaction(callback) {
    const previous = this.queue;
    let release;
    this.queue = new Promise(resolve => { release = resolve; });
    await previous;
    const staged = new Map(this.docs);
    let written = false;
    try {
      const result = await callback({
        get: async path => { assert.equal(written, false); return { path, exists: staged.has(path), data: structuredClone(staged.get(path) || null) }; },
        create: (path, data) => { assert.equal(staged.has(path), false); written = true; staged.set(path, structuredClone(data)); },
        set: (path, data) => { written = true; staged.set(path, structuredClone(data)); },
        delete: path => { written = true; staged.delete(path); },
      });
      this.docs = staged;
      return result;
    } finally { release(); }
  }
}
const content = () => ({ title: "패치 메모", body: "본문", type: "bug", priority: "normal", sourcePath: "/teacher/lesson", targetLabel: "빈칸", targetText: "", targetSelector: "", targetRect: null });
const request = (commandType, payload, commandId = randomUUID(), uid = "teacher-a", drop = false) => ({
  auth: { uid, token: { email: `${uid}@example.test` } },
  data: { commandType, commandId, payload, ...(drop ? { _testDropResponseAfterCommit: true } : {}) },
});
const setup = seed => {
  const store = new Store(seed);
  const core = gateway.createCommandGatewayCore({
    store, projectId: "demo-westory-session-patch-notes", serverTimestamp: () => 123, concreteTimestamp: () => 123,
    assertSession: async (req, options) => {
      assert.deepEqual(options, { recentAuth: false, highRisk: false });
      return { uid: req.auth.uid, email: req.auth.token.email, sessionId: "test-session", revision: 1, schemaVersion: 2, expiresAtMs: 999999 };
    },
    authorizeCommand: async ({ request: req }) => ({ actorUid: req.auth.uid, actorEmail: req.auth.token.email, actorRole: req.auth.uid.startsWith("student") ? "student" : req.auth.uid.startsWith("staff") ? "staff" : req.auth.uid === "admin" ? "admin" : "teacher" }),
    commandAdapters: Object.fromEntries(Object.values(notes.PATCH_NOTE_COMMAND_TYPES).map(type => [type, notes.createPatchNoteCommandAdapter()])),
  });
  return { store, core };
};
let checks = 0;
const denied = async (test, req, reason) => {
  const before = structuredClone([...test.store.docs]);
  await assert.rejects(test.core.execute(req), error => error.details?.reason === reason);
  assert.deepEqual([...test.store.docs], before, "Rejected commands must not write notes, receipts or audit events");
  checks++;
};
(async () => {
  const test = setup();
  const create = request("createTeacherPatchNote", { content: content() });
  const result = await test.core.execute(create);
  const noteId = result.result.noteId;
  const path = `teacherPatchNotes/teacher-a/notes/${noteId}`;
  assert.equal(result.result.noteRevision, 1);
  assert.equal(test.store.docs.get(path).ownerUid, "teacher-a");
  assert.equal(test.store.docs.get(path).completedAt, null);
  assert.equal(test.store.docs.size, 3);
  assert.equal((await test.core.execute(create)).replayed, true);
  assert.equal(test.store.docs.size, 3); checks += 6;
  await denied(test, { ...create, data: { ...create.data, payload: { content: { ...content(), body: "다른 본문" } } } }, "COMMAND_ID_CONFLICT");
  const update = { noteId, expectedNoteRevision: 1, content: { ...content(), body: "수정" } };
  const races = await Promise.allSettled([test.core.execute(request("updateTeacherPatchNote", update)), test.core.execute(request("updateTeacherPatchNote", update))]);
  assert.equal(races.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(test.store.docs.get(path).noteRevision, 2); checks += 2;
  await denied(test, request("updateTeacherPatchNoteStatus", { noteId, expectedNoteRevision: 1, status: "done" }), "PATCH_NOTE_CONFLICT");
  const statusRequest = request("updateTeacherPatchNoteStatus", { noteId, expectedNoteRevision: 2, status: "done" });
  await test.core.execute(statusRequest);
  assert.equal(test.store.docs.get(path).completedAt, 123);
  await test.core.execute(request("updateTeacherPatchNote", { ...update, expectedNoteRevision: 3 }));
  assert.equal(test.store.docs.get(path).status, "done");
  assert.equal(test.store.docs.get(path).completedAt, 123);
  assert.equal(test.store.docs.get(path).createdAt, 123); checks += 4;
  await denied(test, request("deleteTeacherPatchNote", { noteId, expectedNoteRevision: 3 }), "PATCH_NOTE_CONFLICT");
  await denied(test, request("deleteTeacherPatchNote", { noteId, expectedNoteRevision: 4 }, randomUUID(), "teacher-b"), "PATCH_NOTE_NOT_FOUND");
  const deleteRequest = request("deleteTeacherPatchNote", { noteId, expectedNoteRevision: 4 });
  await test.core.execute(deleteRequest);
  assert.equal(test.store.docs.has(path), false);
  assert.equal((await test.core.execute(deleteRequest)).replayed, true);
  assert.equal((await test.core.execute(create)).replayed, true);
  assert.equal(test.store.docs.has(path), false); checks += 4;
  await denied(test, request("updateTeacherPatchNote", { ...update, expectedNoteRevision: 4 }), "PATCH_NOTE_NOT_FOUND");
  const lost = setup();
  const lostRequest = request("createTeacherPatchNote", { content: content() }, randomUUID(), "teacher-a", true);
  await assert.rejects(lost.core.execute(lostRequest), error => error.details?.reason === "TEST_RESPONSE_LOSS");
  assert.equal((await lost.core.execute({ ...lostRequest, data: { ...lostRequest.data, _testDropResponseAfterCommit: false } })).replayed, true);
  assert.equal(lost.store.docs.size, 3); checks += 2;
  const commandStatus = await lost.core.getStatus({ auth: lostRequest.auth, data: { commandId: lostRequest.data.commandId, commandType: "createTeacherPatchNote" } });
  assert.equal(commandStatus.status, "SUCCEEDED"); checks++;
  for (const uid of ["student-a", "staff-a"]) await denied(setup(), request("createTeacherPatchNote", { content: content() }, randomUUID(), uid), "PATCH_NOTE_TEACHER_REQUIRED");
  assert.equal((await setup().core.execute(request("createTeacherPatchNote", { content: content() }, randomUUID(), "admin"))).result.noteRevision, 1); checks++;
  const legacyPath = "teacherPatchNotes/teacher-a/notes/legacy";
  const legacy = setup({ [legacyPath]: { ...content(), ownerUid: "teacher-a", status: "open", completedAt: null, createdAt: 10 } });
  await legacy.core.execute(request("updateTeacherPatchNote", { noteId: "legacy", expectedNoteRevision: 0, content: content() }));
  assert.equal(legacy.store.docs.get(legacyPath).noteRevision, 1);
  assert.equal(legacy.store.docs.get(legacyPath).createdAt, 10); checks += 2;
  for (const bad of [null, "0", -1, 1.2, Number.MAX_SAFE_INTEGER]) {
    const broken = setup({ [legacyPath]: { ...content(), ownerUid: "teacher-a", status: "open", noteRevision: bad } });
    await denied(broken, request("deleteTeacherPatchNote", { noteId: "legacy", expectedNoteRevision: 0 }), "PATCH_NOTE_REVISION_INVALID");
  }
  await denied(setup({ [legacyPath]: { ownerUid: "teacher-b" } }), request("deleteTeacherPatchNote", { noteId: "legacy", expectedNoteRevision: 0 }), "PATCH_NOTE_OWNER_MISMATCH");
  for (const badContent of [
    { ...content(), ownerUid: "teacher-b" }, { ...content(), createdAt: 99 },
    { ...content(), status: "done" }, { ...content(), body: " " }, { ...content(), title: "x".repeat(81) },
    { ...content(), body: "x".repeat(2001) }, { ...content(), sourcePath: "/student/lesson" },
    { ...content(), type: "admin" }, { ...content(), priority: "urgent" },
    { ...content(), targetRect: { x: NaN, y: 0, width: 1, height: 1 } },
    { ...content(), targetRect: { x: 0, y: 0, width: -1, height: 1 } },
    { ...content(), targetRect: { x: 0, y: 0, width: 1, height: 1, extra: 1 } },
  ]) await denied(setup(), request("createTeacherPatchNote", { content: badContent }), "PATCH_NOTE_INVALID");
  for (const badPayload of [{ content: content(), ownerUid: "teacher-b" }, { content: content(), semesterId: "2026-2" }]) await denied(setup(), request("createTeacherPatchNote", badPayload), "PATCH_NOTE_INVALID");
  for (const badId of ["../other", "teacher-b/notes/one", ""]) await denied(setup(), request("deleteTeacherPatchNote", { noteId: badId, expectedNoteRevision: 0 }), "PATCH_NOTE_INVALID");
  await denied(setup(), request("updateTeacherPatchNoteStatus", { noteId: "one", expectedNoteRevision: 0, status: "arbitrary" }), "PATCH_NOTE_INVALID");
  await denied(setup(), request("deleteTeacherPatchNote", { noteId: "one", expectedNoteRevision: "0" }), "PATCH_NOTE_INVALID");
  console.log(JSON.stringify({ suite: "teacher-patch-notes-gateway", passed: true, checks, networkAccess: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
