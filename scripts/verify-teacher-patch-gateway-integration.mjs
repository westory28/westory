import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, orderBy, limit, getDocs, Timestamp } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";

const projectId = "demo-westory-session-patch-notes";
assert.ok(["127.0.0.1:8080", "127.0.0.1:18080"].includes(process.env.FIRESTORE_EMULATOR_HOST), "Emulator host required");
assert.equal(process.env.GCLOUD_PROJECT, projectId);
const port = Number(process.env.FIRESTORE_EMULATOR_HOST.split(":")[1]);
const testEnv = await initializeTestEnvironment({ projectId, firestore: { host: "127.0.0.1", port, rules: readFileSync("firestore.rules", "utf8") } });
const apps = [];
let checks = 0;
const adminDb = async operation => {
  let result;
  await testEnv.withSecurityRulesDisabled(async context => { result = await operation(context.firestore()); });
  return result;
};
const client = async (name, role = "teacher", email = `${name}@yongshin-ms.ms.kr`) => {
  const app = initializeApp({ projectId, apiKey: "demo-key", authDomain: `${projectId}.firebaseapp.com` }, name);
  apps.push(app);
  const auth = getAuth(app); connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app); connectFirestoreEmulator(db, "127.0.0.1", port);
  const functions = getFunctions(app, "asia-northeast3"); connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  const { user } = await createUserWithEmailAndPassword(auth, email, randomBytes(24).toString("base64url") + "Aa1!");
  await adminDb(store => setDoc(doc(store, "users", user.uid), { uid: user.uid, email, role, name: "합성 메모 검증", teacherPortalEnabled: false, staffPermissions: [] }));
  const session = (await httpsCallable(functions, "openApplicationSession")({ authorityGeneration: "w1r2-2026-08-09", protocolVersion: 2 })).data;
  assert.equal(session.status, "active");
  return { uid: user.uid, db, functions, session, proof: { authorityGeneration: session.authorityGeneration, protocolVersion: session.protocolVersion, revision: session.revision } };
};
const content = { title: "합성 메모", body: "서버 저장 검증", type: "bug", priority: "normal", sourcePath: "/teacher/lesson", targetLabel: "", targetText: "", targetSelector: "", targetRect: null };
const execute = async (owner, type, payload, id = randomUUID(), overrides = {}) =>
  (await httpsCallable(owner.functions, "executeCommand")({ commandId: id, commandType: type, payload, _session: owner.proof, ...overrides })).data;
const expectReason = async (operation, reason) => {
  await assert.rejects(operation, error => error.details?.reason === reason);
  checks++;
};
try {
  await testEnv.clearFirestore();
  const teacher = await client("patch-teacher");
  const other = await client("patch-other");
  const student = await client("patch-student", "student");
  const staff = await client("patch-staff", "staff");
  const admin = await client("patch-admin", "teacher", "westoria28@gmail.com");
  // A valid general session may save even when the high-risk window is expired.
  await adminDb(db => updateDoc(doc(db, "application_sessions", teacher.uid, "sessions", String(teacher.session.authTime)), { highRiskExpiresAt: Timestamp.fromMillis(0) }));
  const createId = randomUUID();
  const created = await execute(teacher, "createTeacherPatchNote", { content }, createId);
  assert.equal(created.result.noteRevision, 1); checks++;
  const noteId = created.result.noteId;
  const path = `teacherPatchNotes/${teacher.uid}/notes/${noteId}`;
  assert.equal((await getDoc(doc(teacher.db, path))).data().ownerUid, teacher.uid); checks++;
  await assertSucceeds(getDocs(query(collection(teacher.db, "teacherPatchNotes", teacher.uid, "notes"), orderBy("updatedAt", "desc"), limit(100)))); checks++;
  assert.equal((await execute(teacher, "createTeacherPatchNote", { content }, createId)).replayed, true); checks++;
  await expectReason(execute(teacher, "createTeacherPatchNote", { content: { ...content, body: "다른 생성" } }, createId), "COMMAND_ID_CONFLICT");
  await expectReason(execute(student, "createTeacherPatchNote", { content }), "PATCH_NOTE_TEACHER_REQUIRED");
  await expectReason(execute(staff, "createTeacherPatchNote", { content }), "PATCH_NOTE_TEACHER_REQUIRED");
  await expectReason(execute(other, "updateTeacherPatchNote", { noteId, expectedNoteRevision: 1, content }), "PATCH_NOTE_NOT_FOUND");
  await expectReason(execute(teacher, "createTeacherPatchNote", { ownerUid: other.uid, content }), "PATCH_NOTE_INVALID");
  await assertFails(getDoc(doc(other.db, path))); checks++;
  await assertFails(setDoc(doc(teacher.db, "teacherPatchNotes", teacher.uid, "notes", "direct-create"), { ...content, ownerUid: teacher.uid, status: "open", completedAt: null, createdAt: Timestamp.now(), updatedAt: Timestamp.now() })); checks++;
  await assertFails(updateDoc(doc(teacher.db, path), { body: "direct update", updatedAt: Timestamp.now() })); checks++;
  await assertFails(deleteDoc(doc(teacher.db, path))); checks++;
  const mutations = await Promise.allSettled([
    execute(teacher, "updateTeacherPatchNote", { noteId, expectedNoteRevision: 1, content: { ...content, body: "창 A" } }),
    execute(teacher, "updateTeacherPatchNote", { noteId, expectedNoteRevision: 1, content: { ...content, body: "창 B" } }),
  ]);
  assert.equal(mutations.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(mutations.find(item => item.status === "rejected").reason.details.reason, "PATCH_NOTE_CONFLICT"); checks += 2;
  await execute(teacher, "updateTeacherPatchNoteStatus", { noteId, expectedNoteRevision: 2, status: "done" });
  await execute(teacher, "updateTeacherPatchNote", { noteId, expectedNoteRevision: 3, content });
  const completed = (await getDoc(doc(teacher.db, path))).data();
  assert.equal(completed.status, "done"); assert.ok(completed.completedAt.toMillis() > 0); checks += 2;
  await expectReason(execute(teacher, "deleteTeacherPatchNote", { noteId, expectedNoteRevision: 3 }), "PATCH_NOTE_CONFLICT");
  const status = (await httpsCallable(teacher.functions, "getCommandStatus")({ commandId: createId, commandType: "createTeacherPatchNote", _session: teacher.proof })).data;
  assert.equal(status.status, "SUCCEEDED"); checks++;
  const hiddenStatus = (await httpsCallable(other.functions, "getCommandStatus")({ commandId: createId, commandType: "createTeacherPatchNote", _session: other.proof })).data;
  assert.equal(hiddenStatus.status, "NOT_FOUND"); checks++;
  await expectReason(execute(teacher, "createTeacherPatchNote", { content }, randomUUID(), { _session: { ...teacher.proof, revision: "0".repeat(64) } }), "SESSION_PROOF_INVALID");
  const deleteId = randomUUID();
  await execute(teacher, "deleteTeacherPatchNote", { noteId, expectedNoteRevision: 4 }, deleteId);
  assert.equal((await execute(teacher, "deleteTeacherPatchNote", { noteId, expectedNoteRevision: 4 }, deleteId)).replayed, true);
  assert.equal((await execute(teacher, "createTeacherPatchNote", { content }, createId)).replayed, true);
  assert.equal((await getDoc(doc(teacher.db, path))).exists(), false); checks += 3;
  const adminCreated = await execute(admin, "createTeacherPatchNote", { content });
  assert.ok(adminCreated.result.noteId); checks++;
  const lostId = randomUUID();
  await expectReason(execute(teacher, "createTeacherPatchNote", { content }, lostId, { _testDropResponseAfterCommit: true }), "TEST_RESPONSE_LOSS");
  assert.equal((await execute(teacher, "createTeacherPatchNote", { content }, lostId)).replayed, true); checks++;
  await adminDb(db => updateDoc(doc(db, "application_sessions", teacher.uid, "sessions", String(teacher.session.authTime)), { generalExpiresAt: Timestamp.fromMillis(0) }));
  await expectReason(execute(teacher, "createTeacherPatchNote", { content }), "SESSION_EXPIRED");
  console.log(JSON.stringify({ suite: "teacher-patch-gateway-integration", passed: true, checks, projectId, productionAccess: 0, appCheck: "DISABLED_BY_DEMO_CONTRACT; verify missing App Check separately in Staging" }));
} finally {
  await Promise.all(apps.map(app => deleteApp(app)));
  await testEnv.cleanup();
}
