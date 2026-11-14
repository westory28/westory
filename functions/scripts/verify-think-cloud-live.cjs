const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { test } = require("node:test");

// This suite runs the real gateway and W8 adapter against an atomic memory
// store. It cannot contact production; Firestore contention needs the separate
// emulator suite. In particular, Promise.all below is not a latency benchmark.
const projectId = "demo-westory-session-think-cloud-unit";
process.env.GCLOUD_PROJECT = projectId;
process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:1";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:1";
const gateway = require("../productionGateway/commandGateway");
const w8 = require("../productionGateway/w8Domains");
const enrollment = require("../productionGateway/archiveEnrollment");

const semesterId = "2026-2";
const root = "years/2026/semesters/2";
const sessionId = "topic-one";
const sessionPath = `${root}/think_cloud_sessions/${sessionId}`;
const responsesPath = `${sessionPath}/responses`;
const statePath = `${root}/think_cloud_state/class-one`;
const indexPath = `${sessionPath}/private/index`;
const reason = (expected) => (error) => error.details?.reason === expected;
const clone = (value) => value === undefined ? undefined : structuredClone(value);

class Transaction {
  constructor(documents, reads, writes) {
    this.documents = clone(documents);
    this.reads = reads;
    this.writes = writes;
    this.writing = false;
  }
  snapshot(path) { return { path, exists: this.documents.has(path), data: clone(this.documents.get(path)) }; }
  async get(path) {
    assert.equal(this.writing, false, "all reads must precede writes");
    this.reads.push({ path, count: Number(this.documents.has(path)) });
    return this.snapshot(path);
  }
  getAll(paths) { return Promise.all(paths.map((path) => this.get(path))); }
  async query(path, filter) {
    assert.equal(this.writing, false, "all reads must precede writes");
    const clauses = filter?.filters || (filter?.field ? [filter] : []);
    const matches = (data, clause) => clause.operator === "in"
      ? clause.value.includes(data[clause.field])
      : clause.operator === ">" ? data[clause.field] > clause.value
      : data[clause.field] === clause.value;
    const matching = [...this.documents.keys()]
      .filter((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1)
      .map((key) => this.snapshot(key))
      .filter((row) => clauses.every((clause) => matches(row.data, clause)));
    const rows = Number.isSafeInteger(filter?.limit) ? matching.slice(0, filter.limit) : matching;
    this.reads.push({ path, filter: clone(filter), count: rows.length });
    return rows;
  }
  set(path, data, options) {
    this.writing = true;
    this.writes.push({ path, fields: Object.keys(data) });
    this.documents.set(path, clone(options?.merge ? { ...this.documents.get(path), ...data } : data));
  }
  create(path, data) {
    assert.equal(this.documents.has(path), false, "immutable documents cannot be overwritten");
    this.set(path, data);
  }
  delete(path) { this.writing = true; this.writes.push({ path, deleted: true }); this.documents.delete(path); }
}
class Store {
  constructor(seed) {
    this.documents = new Map(Object.entries(seed));
    this.reads = [];
    this.writes = [];
    this.queue = Promise.resolve();
  }
  get(path) { return new Transaction(this.documents, this.reads, this.writes).get(path); }
  runTransaction(callback) {
    const task = this.queue.then(async () => {
      const tx = new Transaction(this.documents, this.reads, this.writes);
      const result = await callback(tx);
      this.documents = tx.documents;
      return result;
    });
    this.queue = task.catch(() => {});
    return task;
  }
  resetCounts() { this.reads.length = 0; this.writes.length = 0; }
}
const request = (uid, commandType, payload, extra = {}) => ({
  auth: { uid, token: { email: `${uid}@synthetic.invalid` } },
  data: { commandId: randomUUID(), commandType, payload: { semesterId, expectedSemesterRevision: 1, ...payload }, ...extra },
});
const submit = (uid, text = "조선", extra = {}) => request(uid, "submitThinkCloudResponse", {
  sessionId, expectedSessionRevision: 7, textRaw: text, textNormalized: text,
}, extra);
const fixture = (count = 2) => {
  const seed = {
    "site_settings/config": { year: "2026", semester: "2", activeSemesterId: semesterId },
    "site_settings/semester_active": { semesterId, revision: 1 },
    [`semester_manifests/${semesterId}`]: { semesterId, status: "ACTIVE", revision: 1 },
    "users/teacher": { role: "teacher", name: "합성 교사" },
    "users/foreign-teacher": { role: "teacher" },
    "users/delegate": { role: "staff", teacherPortalEnabled: true, staffPermissions: ["lesson_read"] },
    "semester_classes/class-one": { semesterId, classId: "class-one", status: "ACTIVE", grade: "3", classNumber: "1", homeroomTeacherUid: "teacher" },
    "semester_classes/class-two": { semesterId, classId: "class-two", status: "ACTIVE", grade: "3", classNumber: "2", homeroomTeacherUid: "foreign-teacher" },
    [sessionPath]: {
      semesterId, sessionId, targetClassId: "class-one", targetGrade: "3", targetClass: "1",
      title: "합성 주제", status: "active", revision: 7,
      options: { allowDuplicateWord: true, allowDuplicateByStudent: false, anonymous: true, maxLength: 100, inputMode: "word", profanityFilter: true },
    },
    [statePath]: { semesterId, classId: "class-one", activeSessionId: sessionId, revision: 4 },
    [indexPath]: { responseCount: 0, studentHashes: [], wordHashes: [] },
    [`${root}/think_cloud_sessions/other-topic`]: {
      sessionId: "other-topic", targetClassId: "class-two", targetGrade: "3", targetClass: "2", status: "active", revision: 1,
    },
    [`${root}/think_cloud_state/class-two`]: { activeSessionId: "other-topic", revision: 1, responseRevision: 900 },
  };
  for (let index = 0; index < count; index++) {
    const uid = `student-${index}`;
    seed[`users/${uid}`] = { role: "student", name: `합성 학생 ${index}`, grade: "3", class: "1" };
    seed[`semester_enrollment_slots/${enrollment.buildEnrollmentSlotId(semesterId, uid)}`] = {
      semesterId, studentUid: uid, status: "ACTIVE", activeEnrollmentId: `enrollment-${index}`,
    };
    seed[`semester_enrollments/enrollment-${index}`] = {
      semesterId, enrollmentId: `enrollment-${index}`, studentUid: uid, classId: "class-one", enrollmentStatus: "ACTIVE",
    };
  }
  const store = new Store(seed);
  const assertSession = async (request) => {
    if (request.sessionRejected) throw Object.assign(new Error("Session expired"), { code: "unauthenticated" });
    return { uid: request.auth.uid, email: request.auth.token.email };
  };
  const adapter = w8.createW8CommandAdapter();
  const commands = gateway.createCommandGatewayCore({
    store, assertSession,
    authorizeCommand: async ({ request }) => ({ actorUid: request.auth.uid, actorEmail: request.auth.token.email, actorRole: request.auth.uid.startsWith("student-") ? "student" : "teacher" }),
    commandAdapters: Object.fromEntries(Object.values(w8.W8_COMMAND_TYPES).map((type) => [type, adapter])),
    serverTimestamp: () => ({ seconds: 100 }), concreteTimestamp: () => ({ seconds: 100 }), projectId,
  });
  const queryCore = w8.createW8QueryCore({ store, assertSession });
  const query = (uid, projection = "think-cloud", data = {}, extra = {}) => queryCore.getW8DomainState({
    auth: { uid, token: { email: `${uid}@synthetic.invalid` } },
    data: { semesterId, domain: "LEARNING", source: "CURRENT", audience: uid.startsWith("student-") ? "student" : "teacher", projection, sessionId, ...data },
    ...extra,
  });
  return { store, commands, query };
};

test("30 submissions preserve all responses, stable CAS and zero response queries after initialization", async () => {
  const f = fixture(30);
  const results = await Promise.all(Array.from({ length: 30 }, (_, index) => f.commands.execute(submit(`student-${index}`))));
  assert.ok(results.every((result) => result.replayed === false));
  const responses = [...f.store.documents].filter(([path]) => path.startsWith(`${responsesPath}/`)).map(([, data]) => data);
  assert.equal(responses.length, 30);
  assert.deepEqual(responses.map((row) => row.sequence).sort((a, b) => a - b), Array.from({ length: 30 }, (_, index) => index + 1));
  assert.equal(f.store.documents.get(sessionPath).revision, 7);
  assert.equal(f.store.documents.get(indexPath).responseCount, 30);
  assert.equal(f.store.documents.get(statePath).revision, 4);
  assert.deepEqual(Object.keys(f.store.documents.get(statePath)).sort(), ["activeSessionId", "classId", "responseRevision", "responseSessionId", "revision", "semesterId"].sort());
  assert.equal(f.store.documents.get(statePath).responseRevision, 30);
  assert.equal(f.store.documents.get(statePath).responseSessionId, sessionId);
  assert.equal(f.store.writes.filter((write) => write.path === statePath).length, 30);
  assert.ok(f.store.writes.filter((write) => write.path === statePath).every((write) => write.fields.join(",") === "responseRevision,responseSessionId"));
  assert.equal(f.store.writes.length, 30 * 5, "response + private index + signal + existing receipt/audit per submission");
  assert.equal(f.store.reads.filter((read) => read.path === responsesPath).length, 0);
  const index = f.store.documents.get(indexPath);
  assert.deepEqual(Object.keys(index).sort(), ["responseCount", "studentHashes", "wordHashes"]);
  assert.ok([...index.studentHashes, ...index.wordHashes].every((hash) => /^[a-f0-9]{64}$/.test(hash)));
});

test("lost response and repeated command receipt never advance the signal twice", async () => {
  const f = fixture();
  const input = submit("student-0", "백제", { _testDropResponseAfterCommit: true });
  await assert.rejects(f.commands.execute(input), reason("TEST_RESPONSE_LOSS"));
  const before = clone(f.store.documents);
  f.store.resetCounts();
  const retry = await f.commands.execute(input);
  assert.equal(retry.replayed, true);
  assert.equal(retry.result.responseSequence, 1);
  assert.deepEqual(f.store.documents, before);
  assert.equal(f.store.writes.length, 0);
  await assert.rejects(f.commands.execute(submit("student-0", "신라")), reason("W8_THINK_CLOUD_STUDENT_DUPLICATE"));
  assert.deepEqual(f.store.documents, before);
});

test("full snapshot includes legacy rows; delta reads only newer selected-session responses", async () => {
  const f = fixture();
  f.store.documents.set(`${responsesPath}/legacy`, { uid: "former-student", displayName: "비공개 이름", textRaw: "고구려", textNormalized: "고구려" });
  f.store.documents.delete(indexPath);
  const full = await f.query("student-0");
  assert.equal(full.thinkCloudState.responseRevision, 0);
  assert.equal(full.thinkCloudResponses[0].sequence, 0);
  await f.commands.execute(submit("student-0", "백제"));
  await f.commands.execute(submit("student-1", "신라"));
  f.store.resetCounts();
  const delta = await f.query("student-0", "think-cloud-delta", { afterResponseSequence: 1 });
  assert.equal(delta.thinkCloudSelectedSessionId, sessionId);
  assert.equal(delta.thinkCloudSessions.length, 1);
  assert.equal(delta.thinkCloudResponses.length, 1);
  assert.equal(delta.thinkCloudResponses[0].textNormalized, "신라");
  assert.equal(delta.thinkCloudResponses[0].sequence, 2);
  assert.equal(delta.thinkCloudResponses[0].isOwn, false);
  assert.equal(delta.thinkCloudState.responseRevision, 2);
  assert.equal(delta.thinkCloudManagedClasses[0].responseRevision, 2);
  assert.equal(delta.thinkCloudManagedClasses[0].responseSessionId, sessionId);
  assert.equal(delta.thinkCloudRoster.length, 0);
  assert.ok(delta.thinkCloudResponses.every((row) => row.uid === undefined && row.displayName === undefined));
  assert.deepEqual(f.store.reads.find((read) => read.path === responsesPath).filter, { field: "sequence", operator: ">", value: 1 });
  assert.equal(f.store.reads.find((read) => read.path === responsesPath).count, 1);
  assert.ok(!f.store.reads.some((read) => read.path === `${root}/think_cloud_sessions` || read.path === "semester_classes" || read.path.includes("other-topic") || read.path.includes("semester_learning")));
  assert.equal(f.store.writes.length, 0);
  f.store.resetCounts();
  const teacher = await f.query("teacher", "think-cloud-delta", { afterResponseSequence: 0 });
  assert.equal(teacher.thinkCloudResponses.length, 2);
  assert.equal(teacher.thinkCloudResponses[0].uid, "student-0");
  assert.equal(teacher.thinkCloudManagedClasses.length, 1);
  assert.equal(teacher.thinkCloudRoster.length, 0);
  assert.ok(!f.store.reads.some((read) => read.path === "semester_enrollments" || read.path === "semester_classes"));
  const empty = await f.query("student-0", "think-cloud-delta", { afterResponseSequence: 2 });
  assert.equal(empty.thinkCloudResponses.length, 0);
  await assert.rejects(f.query("student-0", "think-cloud-delta", { afterResponseSequence: 3 }), reason("W8_THINK_CLOUD_RESPONSE_CURSOR_INVALID"));
});

test("delta retains identity, assignment, current semester and anonymous/nonanonymous projections", async () => {
  const f = fixture();
  await f.commands.execute(submit("student-0"));
  const delta = { afterResponseSequence: 0 };
  await assert.rejects(f.query("foreign-teacher", "think-cloud-delta", delta), reason("W8_THINK_CLOUD_TARGET_FORBIDDEN"));
  await assert.rejects(f.query("student-0", "think-cloud-delta", { ...delta, sessionId: "other-topic" }), reason("W8_THINK_CLOUD_TARGET_FORBIDDEN"));
  await assert.rejects(f.query("student-0", "think-cloud-delta", { ...delta, audience: "teacher" }), reason("W8_MANAGE_REQUIRED"));
  await assert.rejects(f.query("student-0", "think-cloud-delta", { ...delta, studentUid: "student-1" }), reason("W8_STUDENT_SCOPE_FORBIDDEN"));
  await assert.rejects(f.query("student-0", "think-cloud-delta", delta, { sessionRejected: true }), (error) => error.code === "unauthenticated");
  const delegated = await f.query("delegate", "think-cloud-delta", delta);
  assert.equal(delegated.readOnly, true);
  assert.equal(delegated.thinkCloudResponses[0].uid, "student-0");
  const current = f.store.documents.get(sessionPath);
  f.store.documents.set(sessionPath, { ...current, options: { ...current.options, anonymous: false } });
  const named = await f.query("student-0", "think-cloud-delta", delta);
  assert.equal(named.thinkCloudResponses[0].displayName, "합성 학생 0");
  assert.equal(named.thinkCloudResponses[0].isOwn, true);
  assert.equal(named.thinkCloudResponses[0].uid, undefined);
  f.store.documents.set("site_settings/semester_active", { semesterId: "2027-1", revision: 1 });
  await assert.rejects(f.query("student-0", "think-cloud-delta", delta), reason("W8_STUDENT_CURRENT_SEMESTER_REQUIRED"));
});

test("legacy missing class state initializes a valid signal without preventing the next submit", async () => {
  const f = fixture();
  f.store.documents.delete(statePath);
  await f.commands.execute(submit("student-0"));
  assert.equal(f.store.documents.get(statePath).activeSessionId, sessionId);
  assert.equal(f.store.documents.get(statePath).revision, 0);
  await f.commands.execute(submit("student-1", "백제"));
  assert.equal(f.store.documents.get(statePath).responseRevision, 2);
  assert.equal(f.store.documents.get(sessionPath).revision, 7);
});

test("teacher transitions, topic creation and deletion retain the class response watermark", async () => {
  const f = fixture();
  await f.commands.execute(submit("student-0"));
  await f.commands.execute(request("teacher", "transitionThinkCloudSession", {
    sessionId, expectedSessionRevision: 7, expectedStateRevision: 4, targetStatus: "paused",
  }));
  assert.equal(f.store.documents.get(statePath).responseRevision, 1);
  assert.equal(f.store.documents.get(sessionPath).revision, 8);
  await assert.rejects(f.commands.execute(submit("student-1")), reason("W8_THINK_CLOUD_SESSION_REVISION_CONFLICT"));
  const created = await f.commands.execute(request("teacher", "createThinkCloudSession", {
    expectedStateRevision: 5, title: "새 합성 주제", description: "", targetGrade: "3", targetClass: "1",
    targetGradeLabel: "3학년", targetClassLabel: "1반", options: f.store.documents.get(sessionPath).options,
  }));
  const newIndexPath = `${root}/think_cloud_sessions/${created.result.sessionId}/private/index`;
  assert.deepEqual(f.store.documents.get(newIndexPath), { responseCount: 0, studentHashes: [], wordHashes: [] });
  assert.equal(f.store.documents.get(statePath).responseRevision, 1);
  await f.commands.execute(request("teacher", "deleteThinkCloudSession", {
    sessionId: created.result.sessionId, expectedSessionRevision: 1, expectedStateRevision: 6, reason: "합성 주제 삭제",
  }));
  assert.equal(f.store.documents.get(statePath).responseRevision, 1);
  assert.equal(f.store.documents.get(statePath).responseSessionId, sessionId);
  assert.equal(f.store.documents.has(newIndexPath), false);
});

test("the 200-response cap and both duplicate policies remain atomic", async () => {
  const f = fixture();
  f.store.documents.get(indexPath).responseCount = 199;
  const capped = await Promise.allSettled([f.commands.execute(submit("student-0")), f.commands.execute(submit("student-1"))]);
  assert.equal(capped.filter((result) => result.status === "fulfilled").length, 1);
  assert.ok(capped.filter((result) => result.status === "rejected").every((result) => reason("W8_THINK_CLOUD_RESPONSE_LIMIT")(result.reason)));
  assert.equal(f.store.documents.get(indexPath).responseCount, 200);
  assert.equal(f.store.documents.get(statePath).responseRevision, 1);
  const unique = fixture();
  unique.store.documents.get(sessionPath).options.allowDuplicateWord = false;
  const sameWord = await Promise.allSettled([unique.commands.execute(submit("student-0")), unique.commands.execute(submit("student-1"))]);
  assert.equal(sameWord.filter((result) => result.status === "fulfilled").length, 1);
  assert.ok(sameWord.filter((result) => result.status === "rejected").every((result) => reason("W8_THINK_CLOUD_WORD_DUPLICATE")(result.reason)));
  assert.equal(unique.store.documents.get(indexPath).responseCount, 1);
  assert.equal(unique.store.reads.filter((read) => read.path === responsesPath).length, 0);
  const legacy = fixture();
  legacy.store.documents.delete(indexPath);
  legacy.store.documents.get(sessionPath).options.allowDuplicateWord = false;
  legacy.store.documents.set(`${responsesPath}/old`, { uid: "student-0", textNormalized: "백제" });
  await assert.rejects(legacy.commands.execute(submit("student-0")), reason("W8_THINK_CLOUD_STUDENT_DUPLICATE"));
  await assert.rejects(legacy.commands.execute(submit("student-1", "백제")), reason("W8_THINK_CLOUD_WORD_DUPLICATE"));
  assert.equal(legacy.store.writes.length, 0);
  await legacy.commands.execute(submit("student-1", "신라"));
  assert.equal(legacy.store.documents.get(indexPath).responseCount, 2);
  assert.equal(legacy.store.documents.get(statePath).responseRevision, 1);
});

test("teacher resume prepares the full legacy index before submissions without resetting the class cursor", async () => {
  const f = fixture(3);
  f.store.documents.get(sessionPath).status = "paused";
  f.store.documents.set(statePath, {
    semesterId, classId: "class-one", activeSessionId: "", revision: 4,
    responseRevision: 12, responseSessionId: "previous-topic",
  });
  f.store.documents.delete(indexPath);
  for (let index = 0; index < 198; index++) f.store.documents.set(`${responsesPath}/legacy-${index}`, {
    uid: `legacy-${index}`, textRaw: `역사${index}`, textNormalized: `역사${index}`,
  });
  await f.commands.execute(request("teacher", "transitionThinkCloudSession", {
    sessionId, expectedSessionRevision: 7, expectedStateRevision: 4, targetStatus: "active",
  }));
  assert.equal(f.store.documents.get(indexPath).responseCount, 198);
  assert.equal(f.store.documents.get(indexPath).studentHashes.length, 198);
  assert.equal(f.store.documents.get(statePath).responseRevision, 12);
  f.store.resetCounts();
  const outcomes = await Promise.allSettled(Array.from({ length: 3 }, (_, index) => f.commands.execute(request(`student-${index}`, "submitThinkCloudResponse", {
    sessionId, expectedSessionRevision: 8, textRaw: "조선", textNormalized: "조선",
  }))));
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 2);
  assert.ok(outcomes.filter((result) => result.status === "rejected").every((result) => reason("W8_THINK_CLOUD_RESPONSE_LIMIT")(result.reason)));
  assert.equal(f.store.documents.get(indexPath).responseCount, 200);
  assert.equal(f.store.documents.get(statePath).responseRevision, 14);
  assert.equal(f.store.reads.filter((read) => read.path === responsesPath).length, 0);
});

test("deleting a full topic removes all 200 responses and its one private index within one transaction", async () => {
  const f = fixture();
  for (let index = 0; index < 200; index++) f.store.documents.set(`${responsesPath}/row-${index}`, { uid: `synthetic-${index}`, textNormalized: "조선" });
  f.store.documents.get(indexPath).responseCount = 200;
  await f.commands.execute(request("teacher", "deleteThinkCloudSession", {
    sessionId, expectedSessionRevision: 7, expectedStateRevision: 4, reason: "합성 삭제 검사",
  }));
  assert.equal(f.store.documents.has(sessionPath), false);
  assert.equal(f.store.documents.has(indexPath), false);
  assert.equal([...f.store.documents.keys()].filter((path) => path.startsWith(`${sessionPath}/`)).length, 0);
  assert.equal(f.store.writes.length, 205, "200 responses, private index, topic, class state, receipt and audit");
});
