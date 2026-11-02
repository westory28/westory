const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const projectId = process.env.GCLOUD_PROJECT;
assert.equal(projectId, "demo-westory-session-registration-policy");
assert.match(process.env.FIRESTORE_EMULATOR_HOST || "", /^(127\.0\.0\.1|localhost):18302$/);
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc } = require("firebase/firestore");
const app = initializeApp({ projectId }), db = getFirestore(app);
db.settings({ host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false });
const { callableExports, SESSION_AUTHORITY_GENERATION, MIN_CLIENT_PROTOCOL_VERSION } = require("../sessionAuthority");
const { POLICY_PATH } = require("../studentRegistrationPolicyCore");
const policy = require("../studentRegistrationPolicy").createStudentRegistrationPolicyHandlers({ db });
const now = Math.floor(Date.now() / 1000);
const profiles = {
  teacher: { role: "teacher", email: "teacher@yongshin-ms.ms.kr" },
  legacy: { role: "student", email: "2530001@yongshin-ms.ms.kr" },
  approved: { role: "student", email: "2430001@yongshin-ms.ms.kr", registrationApprovalStatus: "APPROVED" },
  pending: { role: "student", email: "2630001@yongshin-ms.ms.kr", registrationApprovalStatus: "PENDING" },
  oldPending: { role: "student", email: "2530002@yongshin-ms.ms.kr", registrationApprovalStatus: "PENDING" },
};
const emails = { ...Object.fromEntries(Object.entries(profiles).map(([uid, value]) => [uid, value.email])),
  fresh: "2631234@yongshin-ms.ms.kr", future: "2721234@yongshin-ms.ms.kr", admin: "westoria28@gmail.com" };
const session = new Map();
const request = (uid, data = {}) => ({ auth: { uid, token: { email: emails[uid], auth_time: now } }, data });
const proof = uid => { const saved = session.get(uid); return { authorityGeneration: saved.authorityGeneration, protocolVersion: saved.protocolVersion, revision: saved.revision }; };
const open = async uid => {
  const result = await callableExports.openApplicationSession.run(request(uid, { authorityGeneration: SESSION_AUTHORITY_GENERATION, protocolVersion: MIN_CLIENT_PROTOCOL_VERSION }));
  session.set(uid, result); return result;
};
const rejected = expected => error => error.details?.reason === expected;
let env;
(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host: "127.0.0.1", port: 18302,
    rules: readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8") } });
  await env.clearFirestore();
  for (const [uid, value] of Object.entries(profiles)) {
    await db.doc(`users/${uid}`).set({ uid, ...value });
    await db.doc(`users/${uid}/academic_records/example`).set({ synthetic: true });
  }
  const client = (uid, email = emails[uid]) => env.authenticatedContext(uid, { email, auth_time: now }).firestore();
  const signup = (uid, email = emails[uid]) => ({ uid, email, role: "student", registrationApprovalStatus: "PENDING" });
  assert.equal((await policy.getStudentRegistrationPolicy(request("oldPending"))).emailPatternLabel, "263NNNN@yongshin-ms.ms.kr");
  for (const uid of ["teacher", "legacy", "approved", "pending", "fresh", "admin"]) await open(uid);
  await assert.rejects(() => open("oldPending"), rejected("STUDENT_REGISTRATION_EMAIL_NOT_ALLOWED"));
  assert.equal((await db.doc(`application_sessions/oldPending/sessions/${now}`).get()).exists, false);
  for (const uid of ["legacy", "approved"]) await assertSucceeds(getDoc(doc(client(uid), `users/${uid}/academic_records/example`)));
  await assertFails(getDoc(doc(client("pending"), "users/pending/academic_records/example")));
  await assertSucceeds(setDoc(doc(client("fresh"), "users/fresh"), signup("fresh")));
  for (const [index, email] of ["2431234@yongshin-ms.ms.kr", "2531234@yongshin-ms.ms.kr", "2621234@yongshin-ms.ms.kr",
    "263123@yongshin-ms.ms.kr", "26312345@yongshin-ms.ms.kr", "263abcd@yongshin-ms.ms.kr", "2631234@yongshin-ms.ms.kr.evil"].entries()) {
    const uid = `invalid-${index}`;
    await assertFails(setDoc(doc(client(uid, email), `users/${uid}`), signup(uid, email)));
  }
  await assertFails(setDoc(doc(client("forged", "2532222@yongshin-ms.ms.kr"), "users/forged"), signup("forged", "2632222@yongshin-ms.ms.kr")));
  const draft = { admissionYear: "2027", admissionGrade: "2", expectedRevision: 0, _session: proof("teacher") };
  const next = await policy.saveStudentRegistrationPolicy(request("teacher", draft));
  assert.equal(next.revision, 1); assert.equal(next.emailPatternLabel, "272NNNN@yongshin-ms.ms.kr");
  assert.deepEqual(await policy.saveStudentRegistrationPolicy(request("teacher", draft)), next);
  await assert.rejects(() => policy.saveStudentRegistrationPolicy(request("teacher", { ...draft, admissionGrade: "1" })), rejected("STUDENT_REGISTRATION_POLICY_REVISION_CONFLICT"));
  await assertFails(setDoc(doc(client("teacher"), POLICY_PATH), { schemaVersion: 1, admissionYear: "2024", admissionGrade: "1", revision: 2 }));
  await assertFails(setDoc(doc(client("admin"), POLICY_PATH), { schemaVersion: 1, admissionYear: "2024", admissionGrade: "1", revision: 2 }));
  for (const uid of ["pending", "fresh"]) {
    await assert.rejects(() => open(uid), rejected("STUDENT_REGISTRATION_EMAIL_NOT_ALLOWED"));
    await assert.rejects(() => callableExports.touchApplicationSession.run(request(uid, { _session: proof(uid) })), rejected("STUDENT_REGISTRATION_EMAIL_NOT_ALLOWED"));
    await assert.rejects(() => callableExports.beginApplicationSessionReauthentication.run(request(uid, { _session: proof(uid) })), rejected("STUDENT_REGISTRATION_EMAIL_NOT_ALLOWED"));
  }
  await assertFails(setDoc(doc(client("stale", "2633333@yongshin-ms.ms.kr"), "users/stale"), signup("stale", "2633333@yongshin-ms.ms.kr")));
  await open("future");
  await assertSucceeds(setDoc(doc(client("future"), "users/future"), signup("future")));
  for (const uid of ["teacher", "legacy", "approved"]) {
    await open(uid);
    await callableExports.touchApplicationSession.run(request(uid, { _session: proof(uid) }));
  }
  const recordBefore = (await db.doc("users/approved").get()).data();
  await db.doc(POLICY_PATH).set({ schemaVersion: 1, admissionYear: "bad", admissionGrade: "2", revision: 2 });
  await assert.rejects(() => open("future"), rejected("STUDENT_REGISTRATION_POLICY_INVALID"));
  await assertFails(setDoc(doc(client("malformed", "2723333@yongshin-ms.ms.kr"), "users/malformed"), signup("malformed", "2723333@yongshin-ms.ms.kr")));
  await db.doc(POLICY_PATH).set({ schemaVersion: 1, admissionYear: "2027", admissionGrade: "2", revision: 9007199254740992 });
  await assert.rejects(() => open("future"), rejected("STUDENT_REGISTRATION_POLICY_INVALID"));
  await assertFails(setDoc(doc(client("unsafe-revision", "2724444@yongshin-ms.ms.kr"), "users/unsafe-revision"), signup("unsafe-revision", "2724444@yongshin-ms.ms.kr")));
  await open("approved");
  assert.deepEqual((await db.doc("users/approved").get()).data(), recordBefore);
  // Signing out must remain possible even after a changed intake rejects renewal.
  await callableExports.closeApplicationSession.run(request("pending"));
  assert.equal((await db.doc(`application_sessions/pending/sessions/${now}`).get()).data().status, "closed");
  console.log("PASS registration policy integration: exact default/future signup rules, forged email and direct policy writes denied, real lifecycle grant/renew/re-auth fences, replay/CAS, teacher and established student continuity; synthetic emulator only.");
})().then(async () => { await env?.cleanup(); await deleteApp(app); }).catch(async error => {
  console.error(error); await env?.cleanup(); await deleteApp(app); process.exitCode = 1;
});
