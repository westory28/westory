const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { collection, doc, getDocFromServer, getDocsFromServer, setDoc, updateDoc, deleteDoc, Timestamp, setLogLevel } = require("firebase/firestore");

const projectId = "demo-westory-session-think-cloud";
assert.equal(process.env.GCLOUD_PROJECT, projectId, "Only the disposable synthetic project is allowed");
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:18431");
setLogLevel("silent");
const rules = readFileSync("firestore.rules", "utf8");
const root = "years/2026/semesters/2";
const topic = `${root}/think_cloud_sessions/synthetic-private-topic`;
const state = `${root}/think_cloud_state/synthetic-class`;
const index = `${topic}/private/index`;
const authTime = Math.floor(Date.now() / 1000) - 60;
let environment;
let checks = 0;
const check = async (allowed, action) => {
  await (allowed ? assertSucceeds(action()) : assertFails(action()));
  checks++;
};

(async () => {
  environment = await initializeTestEnvironment({ projectId, firestore: { host: "127.0.0.1", port: 18431, rules } });
  await environment.clearFirestore();
  const seed = (path, data) => environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));
  await seed(topic, { targetGrade: "3", targetClass: "1", status: "active", options: { anonymous: true } });
  await seed(state, { activeSessionId: "synthetic-private-topic", revision: 1, responseRevision: 1, responseSessionId: "synthetic-private-topic" });
  await seed(`${topic}/responses/synthetic-response`, { uid: "student", displayName: "합성 이름", textRaw: "조선", textNormalized: "조선", sequence: 1 });
  await seed(index, { responseCount: 1, studentHashes: [createHash("sha256").update("student").digest("hex")], wordHashes: [createHash("sha256").update("조선").digest("hex")] });
  for (const uid of ["student", "teacher", "admin"]) {
    const email = uid === "admin" ? "westoria28@gmail.com" : `${uid}@yongshin-ms.ms.kr`;
    await seed(`users/${uid}`, {
      uid, email, role: uid === "student" ? "student" : "teacher", registrationApprovalStatus: "APPROVED",
      grade: "3", class: "1", teacherPortalEnabled: uid !== "student", staffPermissions: [],
    });
    await seed(`application_sessions/${uid}/sessions/${authTime}`, {
      schemaVersion: 2, status: "active", authTime, authorityGeneration: "w1r2-2026-08-09", protocolVersion: 2,
      sessionRevision: "a".repeat(64), authorityModeAtOpen: "ENFORCE", generalExpiresAt: Timestamp.fromMillis(Date.now() + 3600000),
    });
    const client = environment.authenticatedContext(uid, { email, auth_time: authTime }).firestore();
    // Positive controls prove these are live, authorized identities rather
    // than failures caused by incomplete login/registration fixtures.
    await check(true, () => getDocFromServer(doc(client, state)));
    await check(true, () => getDocFromServer(doc(client, topic)));
    await check(uid !== "student", () => getDocFromServer(doc(client, `${topic}/responses/synthetic-response`)));
    await check(false, () => getDocFromServer(doc(client, index)));
    await check(false, () => getDocsFromServer(collection(client, `${topic}/private`)));
    await check(false, () => setDoc(doc(client, `${topic}/private/forged`), { responseCount: 0 }));
    await check(false, () => updateDoc(doc(client, index), { responseCount: 0 }));
    await check(false, () => deleteDoc(doc(client, index)));
    await check(false, () => updateDoc(doc(client, state), { responseRevision: 999 }));
    await check(false, () => setDoc(doc(client, `${topic}/responses/forged`), { uid, textNormalized: "조선" }));
  }
  const anonymous = environment.unauthenticatedContext().firestore();
  await check(false, () => getDocFromServer(doc(anonymous, index)));
  console.log(JSON.stringify({ suite: "think-cloud-private-rules", passed: true, assertions: checks,
    rulesSha256: createHash("sha256").update(rules).digest("hex"), productionDataAccess: 0,
    contract: "Authenticated student/teacher/admin can read the existing signal/topic where authorized; private index get/list/create/update/delete is denied for all clients; direct response writes remain denied." }));
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (environment) await environment.cleanup();
});
