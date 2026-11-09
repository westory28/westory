const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const gateway = require("../commandGateway");
const assessment = require("../assessmentLifecycle");

const projectId = "demo-westory-set-edit";
if (!process.env.FIRESTORE_EMULATOR_HOST || !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
  throw new Error("This synthetic test requires a local Firestore emulator.");
}
const app = initializeApp({ projectId }, `set-edit-${randomUUID()}`);
const db = getFirestore(app);
const store = gateway.createFirestoreStore(db);
const adapter = assessment.createAssessmentCommandAdapter();
const semesterId = "2026-2";
const root = "years/2026/semesters/2/quiz_questions";
const material = { id: "shared", instruction: "자료를 읽고 답하시오.", passage: "처음 지문", image: null };
const question = (id, order, round = "round_1") => ({ id, unitId: "exam_prep", category: "exam_prep", examRound: round,
  paperOrder: order, type: "word", question: `합성 문항 ${id}`, answer: "고려", options: [], points: 20, passageSet: material });
const save = (value, revision = 0, options = {}) => store.runTransaction(transaction => {
  let writes = 0;
  const checked = { ...transaction, set: (...args) => {
    writes += 1;
    if (options.failAfterFirstWrite && writes === 2) throw new Error("Synthetic rollback after first staged member");
    return transaction.set(...args);
  } };
  return adapter.apply({ transaction: checked, commandId: randomUUID(), receiptId: "synthetic-set-edit",
    timestamp: FieldValue.serverTimestamp(), actor: { actorUid: "synthetic-teacher", actorRole: options.role || "teacher" },
    commandType: "upsertQuizQuestion", payload: assessment.normalizeAssessmentPayload("upsertQuizQuestion", {
      semesterId, questionId: String(value.id), question: value, expectedRevision: revision, reason: "Synthetic set edit test",
    }) });
});
const read = async id => (await db.doc(`${root}/${id}`).get()).data();

(async () => {
  await db.doc("site_settings/semester_active").set({ semesterId, revision: 1 });
  await db.doc(`semester_manifests/${semesterId}`).set({ semesterId, revision: 1, status: "ACTIVE" });
  await save(question(1, 1));
  await save(question(2, 2));
  await save(question(3, 3));
  await save(question(4, 1, "round_2"));
  await save({ ...question(2, 2), question: "수정한 개별 발문" }, 1);
  assert.equal((await read(2)).question, "수정한 개별 발문");
  const before = await Promise.all([1, 2, 3, 4].map(read));
  const edit = { ...question(2, 2), question: "수정한 개별 발문", passageSet: { ...material, passage: "함께 수정할 지문" } };
  await assert.rejects(save(edit, 2, { failAfterFirstWrite: true }), /Synthetic rollback/);
  assert.deepEqual(await Promise.all([1, 2, 3, 4].map(read)), before, "A failed transaction leaves every member untouched");
  await save(edit, 2);
  for (const id of [1, 2, 3]) assert.deepEqual((await read(id)).passageSet, edit.passageSet);
  assert.deepEqual(await read(4), before[3], "Another round stays unchanged");
  await assert.rejects(save(question(1, 1), 1), error => error.details?.reason === "ASSESSMENT_CONTENT_REVISION_CONFLICT");
  const concurrent = await Promise.allSettled([
    save({ ...question(1, 1), passageSet: { ...material, passage: "동시 수정 A" } }, 2),
    save({ ...question(3, 3), passageSet: { ...material, passage: "동시 수정 B" } }, 2),
  ]);
  assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 1, "Only one concurrent shared edit can win");
  const rejected = concurrent.find(result => result.status === "rejected");
  assert.equal(rejected.reason.details?.reason, "ASSESSMENT_CONTENT_REVISION_CONFLICT");
  const current = await Promise.all([1, 2, 3].map(read));
  assert.equal(new Set(current.map(item => JSON.stringify(item.passageSet))).size, 1, "The set remains consistent after transaction retries");
  assert.equal(current[1].question, "수정한 개별 발문");
  console.log(JSON.stringify({ suite: "mock-set-edit-firestore", passed: true,
    cases: ["register-edit", "atomic-shared-update", "rollback", "stale-member-conflict", "concurrent-shared-conflict", "round-isolation", "individual-field-preservation"], productionAccess: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => deleteApp(app));
