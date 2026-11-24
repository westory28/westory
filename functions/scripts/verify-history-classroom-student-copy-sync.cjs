// Run only against the isolated demo emulator:
// firebase emulators:exec --only firestore --config firebase.login-test.json --project demo-westory-session-history-copy "node functions/scripts/verify-history-classroom-student-copy-sync.cjs"
const assert = require("node:assert/strict");
const { Firestore, Timestamp } = require("@google-cloud/firestore");
const { buildPlan, summarize, pending, apply } = require("./sync-history-classroom-student-copies.cjs");

const host = process.env.FIRESTORE_EMULATOR_HOST || "";
if (!/^127\.0\.0\.1:\d+$/.test(host)) throw new Error("Local Firestore emulator required");
const projectId = "demo-westory-session-history-copy";
const db = new Firestore({ projectId });
const semesterId = "2026-2", root = "years/2026/semesters/2";
const source = (overrides = {}) => ({
  title: "합성 과제", sourceType: "lesson", blanks: [{ id: "blank-1", answer: "정답" }], answerOptions: ["정답"],
  isPublished: true, contentRevision: 3, publishedAt: "2026-08-11T00:00:00.000Z", createdAt: Timestamp.fromMillis(1_000),
  updatedAt: Timestamp.fromMillis(2_000), createdBy: "teacher-uid", updatedBy: "teacher-uid", updateReason: "합성 사유",
  targetStudentUid: "student-a", targetStudentUids: ["student-a", "student-b"],
  // "student c" is not a usable account id: the server gives it no document.
  targetStudentAccessMap: { "student-a": true, "student-b": true, "student c": true }, targetStudentNames: ["가 학생", "나 학생"],
  targetStudentName: "가 학생, 나 학생", targetStudentNumber: "1, 2",
  targetStudentReasons: { "student-a": "사유 가", "student-b": "사유 나" },
  retryResetByStudentUid: { "student-b": Timestamp.fromMillis(5_000) }, ...overrides,
});
const get = async (path) => (await db.doc(path).get()).data();
const count = async (name) => (await db.collection(`${root}/${name}`).get()).size;

(async () => {
  const reset = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  assert.equal(reset.ok, true);
  await db.doc(`${root}/history_classrooms/one`).set(source());
  await db.doc(`${root}/history_classrooms/two`).set(source({ title: "삭제된 과제", isPublished: false, deletedAt: Timestamp.fromMillis(9_000),
    targetStudentUids: ["student-a"], targetStudentAccessMap: { "student-a": true }, targetStudentReasons: {}, retryResetByStudentUid: {} }));
  // Left over from an earlier roster and from a removed assignment.
  await db.doc(`${root}/history_classroom_assignees/one_student-gone`).set({ assignmentId: "one", uid: "student-gone", reason: "예전 사유" });
  await db.doc(`${root}/history_classroom_student_views/removed`).set({ assignmentId: "removed", title: "없어진 과제" });
  await db.doc(`${root}/history_classroom_assignees/removed_student-a`).set({ assignmentId: "removed", uid: "student-a" });
  const teacherBefore = JSON.stringify([await get(`${root}/history_classrooms/one`), await get(`${root}/history_classrooms/two`)]);

  const plan = await buildPlan(db, semesterId);
  assert.deepEqual({ ...summarize(plan), fingerprint: undefined }, { teacherDocuments: 2, existingCopies: 1, existingAssigneeDocuments: 2,
    pendingCopyWrites: 2, pendingAssigneeWrites: 3, pendingAssigneeDeletes: 1, orphanDocuments: 2, rosterIdsWithoutDocument: 1, fingerprint: undefined });
  assert.equal(pending(summarize(plan)), 8);
  assert.equal((await buildPlan(db, semesterId)).fingerprint, plan.fingerprint, "The preview is deterministic and writes nothing");
  assert.equal(await count("history_classroom_student_views"), 1);

  assert.deepEqual(await apply(db, semesterId, plan), { written: 5, deleted: 3 });
  const view = await get(`${root}/history_classroom_student_views/one`);
  const serialized = JSON.stringify(view);
  for (const secret of ["가 학생", "나 학생", "사유 가", "사유 나", "student-a", "student-b", "teacher-uid", "합성 사유"])
    assert.equal(serialized.includes(secret), false, `The copy omits ${secret}`);
  assert.deepEqual(view.blanks, [{ id: "blank-1", answer: "정답" }]);
  assert.equal(view.contentRevision, 3);
  assert.equal(view.assignmentId, "one");
  const own = await get(`${root}/history_classroom_assignees/one_student-b`);
  assert.equal(own.reason, "사유 나");
  assert.equal(own.retryResetAt.toMillis(), 5_000);
  assert.deepEqual(Object.keys(own).sort(), ["assignmentId", "reason", "retryResetAt", "semesterId", "uid"], "No write time: an unchanged rewrite changes nothing");
  assert.equal((await get(`${root}/history_classroom_assignees/one_student-a`)).retryResetAt, null);
  assert.equal((await get(`${root}/history_classroom_student_views/two`)).isPublished, false);
  assert.equal((await db.doc(`${root}/history_classroom_assignees/one_student-gone`).get()).exists, false);
  assert.equal((await db.doc(`${root}/history_classroom_student_views/removed`).get()).exists, false);
  assert.equal((await db.doc(`${root}/history_classroom_assignees/removed_student-a`).get()).exists, false);
  assert.equal(JSON.stringify([await get(`${root}/history_classrooms/one`), await get(`${root}/history_classrooms/two`)]), teacherBefore,
    "Teacher documents are never written");

  const after = summarize(await buildPlan(db, semesterId));
  assert.equal(pending(after), 0, "A second run has nothing left to do");

  // A teacher save between preview and apply is left to the server's own write.
  const stale = await buildPlan(db, semesterId);
  await db.doc(`${root}/history_classrooms/one`).set(source({ title: "그 사이 저장된 과제" }));
  const changedPlan = await buildPlan(db, semesterId);
  assert.notEqual(changedPlan.fingerprint, stale.fingerprint);
  const outdated = { ...changedPlan, rows: changedPlan.rows.map((row) => ({ ...row, updateTime: stale.rows.find((item) => item.id === row.id).updateTime })) };
  assert.deepEqual(await apply(db, semesterId, outdated), { written: 0, deleted: 0 }, "An outdated row is skipped, not overwritten");
  console.log("PASS history classroom student copy sync: preview, apply, idempotence, stale and orphan cleanup, teacher documents untouched");
})().catch((error) => { console.error(error); process.exitCode = 1; });
