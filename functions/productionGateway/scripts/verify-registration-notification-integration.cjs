const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const projectId = process.env.GCLOUD_PROJECT || "";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || "";
assert.equal(projectId, "demo-westory-session-registration-notifications", "Only the dedicated synthetic project may be reset");
assert.match(emulatorHost, /^(127\.0\.0\.1|localhost):\d+$/);
console.log("Starting isolated registration integration.");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const app = initializeApp({ projectId });
const db = getFirestore(app);
db.settings({ host: emulatorHost, ssl: false });
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { doc, getDoc, onSnapshot, setDoc, serverTimestamp } = require("firebase/firestore");
const registration = require("../studentRegistrationApproval");
const gateway = require("../commandGateway");
const { createStudentRegistrationNotificationService, noticeId } = require("../../studentRegistrationNotifications");
const semesterId = "2026-2", root = "years/2026/semesters/2";
const authTime = Math.floor(Date.now() / 1000) - 30;
const studentEmail = uid => `${({ approved: "2630001", rejected: "2630002", cleared: "2630003" })[uid] || uid}@yongshin-ms.ms.kr`;
let rulesEnvironment, adminClient, clientFor;
const service = createStudentRegistrationNotificationService({ db, resolveAdminUid: async () => "admin" });
const store = gateway.createFirestoreStore(db);
// Auth/session policy is separately tested by the unit and session suites; this
// integration verifies real Firestore transactions, listeners and all domain stages.
const core = gateway.createCommandGatewayCore({ store, projectId,
  assertSession: async request => ({ uid: request.auth.uid }),
  authorizeCommand: async ({ request }) => ({ actorUid: request.auth.uid, actorEmail: "manager@yongshin-ms.ms.kr", actorRole: "teacher" }),
  serverTimestamp: () => FieldValue.serverTimestamp(), concreteTimestamp: () => Timestamp.now(),
  commandAdapters: { [registration.COMMAND_TYPE]: registration.createStudentRegistrationApprovalAdapter({
    getAuthUser: async uid => ({ uid, email: studentEmail(uid), emailVerified: true, disabled: false }),
  }) },
});
const read = async path => (await db.doc(path).get()).data();
const inboxPath = uid => `${root}/notification_inboxes/${uid}`;
const itemPath = (uid, recipient = "admin") => `${inboxPath(recipient)}/items/${noticeId(uid)}`;
const profile = uid => ({ uid, role: "student", name: `합성 ${uid}`, grade: "3", class: "1", number: uid === "approved" ? "1" : "2",
  email: studentEmail(uid), registrationApprovalStatus: "PENDING", createdAt: serverTimestamp() });
const writeAndNotify = async (uid, data) => {
  const ref = db.doc(`users/${uid}`), before = await ref.get();
  if (before.exists) await ref.set(data, { merge: true });
  else await assertSucceeds(setDoc(doc(clientFor(uid), `users/${uid}`), data));
  const after = await ref.get(), event = { params: { uid }, data: { before, after } };
  await service.handleUserWritten(event);
  return event;
};
const execute = async (uid, action, extra = {}) => {
  const user = await read(`users/${uid}`);
  const request = { auth: { uid: "manager" }, data: { commandType: registration.COMMAND_TYPE, commandId: randomUUID(), payload: {
    semesterId, expectedSemesterRevision: 7, studentUid: uid, expectedProfileVersion: registration.profileVersion(user), action, ...extra,
  } } };
  const before = await db.doc(`users/${uid}`).get();
  const response = await core.execute(request);
  const after = await db.doc(`users/${uid}`).get();
  await service.handleUserWritten({ params: { uid }, data: { before, after } });
  return { response, request };
};
const waitForUnread = (expected, change) => new Promise((resolve, reject) => {
  let unsubscribe = () => {}, completed = false;
  const finish = error => {
    if (completed) return;
    completed = true; clearTimeout(timeout); unsubscribe(); error ? reject(error) : resolve();
  };
  const timeout = setTimeout(() => finish(new Error(`Inbox listener did not observe ${expected}`)), 30000);
  unsubscribe = onSnapshot(doc(adminClient, inboxPath("admin")), snapshot => {
    if (snapshot.data()?.unreadCount === expected) finish();
  }, finish);
  Promise.resolve().then(change).catch(finish);
});

(async () => {
  const [host, port] = emulatorHost.split(":");
  rulesEnvironment = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port),
    rules: readFileSync(resolve(__dirname, "../../../firestore.rules"), "utf8") } });
  await rulesEnvironment.clearFirestore();
  const client = uid => rulesEnvironment.authenticatedContext(uid, {
    email: uid === "admin" ? "westoria28@gmail.com" : studentEmail(uid), auth_time: authTime,
  }).firestore();
  clientFor = client;
  adminClient = client("admin");
  const seed = {
    "site_settings/semester_active": { semesterId, revision: 7 },
    [`semester_manifests/${semesterId}`]: { semesterId, revision: 7, status: "ACTIVE" },
    [`semester_wis_economies/${semesterId}`]: { semesterId, status: "ACTIVE_OPEN", revision: 3, accountCount: 0 },
    "semester_classes/class-a": { classId: "class-a", semesterId, status: "ACTIVE", revision: 2, grade: "3", classNumber: "1" },
    "users/manager": { role: "teacher", name: "합성 교사", email: "manager@yongshin-ms.ms.kr" },
    "users/admin": { role: "teacher", name: "합성 관리자", email: "westoria28@gmail.com" },
    "users/staff": { role: "staff", email: "staff@yongshin-ms.ms.kr" },
  };
  for (const uid of ["admin", "manager", "staff", "approved", "rejected"]) {
    seed[`application_sessions/${uid}/sessions/${authTime}`] = {
      status: "active", authTime, schemaVersion: 2, authorityGeneration: "w1r2-2026-08-09", protocolVersion: 2,
      sessionRevision: "a".repeat(64), authorityModeAtOpen: "ENFORCE", generalExpiresAt: Timestamp.fromMillis(Date.now() + 3600000),
    };
  }
  const batch = db.batch(); for (const [path, data] of Object.entries(seed)) batch.set(db.doc(path), data); await batch.commit();
  console.log("Seeded synthetic registration and session fixtures.");
  let approvedEvent;
  await waitForUnread(1, async () => { approvedEvent = await writeAndNotify("approved", profile("approved")); });
  assert.equal((await read(itemPath("approved"))).targetUrl, "/teacher/students?registration=approved");
  assert.equal((await read(inboxPath("manager"))).unreadCount, 1);
  assert.equal(await read(inboxPath("staff")), undefined);
  assert.equal(await read(inboxPath("approved")), undefined);
  await assertSucceeds(getDoc(doc(client("manager"), itemPath("approved", "manager"))));
  await assertFails(getDoc(doc(client("approved"), itemPath("approved"))));
  await assertFails(getDoc(doc(client("approved"), inboxPath("approved"))));
  await assertFails(getDoc(doc(client("staff"), itemPath("approved"))));
  await assertFails(setDoc(doc(client("approved"), itemPath("approved")), { title: "forged" }));
  await Promise.all([service.handleUserWritten(approvedEvent), service.handleUserWritten(approvedEvent)]);
  assert.equal((await read(inboxPath("admin"))).unreadCount, 1, "duplicate events must not double unread count");
  const approved = await execute("approved", "APPROVE", { classId: "class-a", expectedClassRevision: 2, studentNumber: "1", displayName: "합성 approved", rosterConfirmed: true });
  assert.equal(approved.response.result.status, "APPROVED_PENDING_ACCOUNT");
  assert.equal((await read(itemPath("approved"))).registrationStatus, "APPROVED_PENDING_ACCOUNT");
  const enrollmentId = approved.response.result.enrollmentId;
  await execute("approved", "PREPARE_ACCOUNT", { expectedEnrollmentId: enrollmentId, expectedEconomyRevision: 3 });
  await waitForUnread(0, () => execute("approved", "FINALIZE", { expectedEnrollmentId: enrollmentId, expectedAccountRevision: 1 }));
  assert.equal((await read(itemPath("approved"))).registrationStatus, "APPROVED");
  assert.ok((await read(itemPath("approved"))).readAt);
  const account = await read(registration.pathsFor(semesterId, "approved").account);
  assert.equal(account.balance, 0);
  assert.equal(account.rankEarnedTotal, 0);
  await assertSucceeds(getDoc(doc(client("approved"), inboxPath("approved"))));

  let rejectedEvent;
  await waitForUnread(1, async () => { rejectedEvent = await writeAndNotify("rejected", profile("rejected")); });
  const rejection = await execute("rejected", "REJECT");
  assert.equal(rejection.response.result.status, "REJECTED");
  assert.equal((await read(inboxPath("admin"))).unreadCount, 0);
  assert.equal((await read(itemPath("rejected"))).registrationStatus, "REJECTED");
  assert.equal(await read(registration.pathsFor(semesterId, "rejected").account), undefined);
  await assertFails(getDoc(doc(client("rejected"), inboxPath("rejected"))));
  const replay = await core.execute(rejection.request);
  assert.equal(replay.replayed, true);
  await service.handleUserWritten(rejectedEvent);
  assert.equal((await read(itemPath("rejected"))).registrationStatus, "REJECTED", "out-of-order signup must re-read current status");
  assert.equal((await read(inboxPath("admin"))).unreadCount, 0);

  await writeAndNotify("cleared", profile("cleared"));
  await db.doc(itemPath("cleared")).delete();
  await db.doc(inboxPath("admin")).set({ unreadCount: 0 }, { merge: true });
  await writeAndNotify("cleared", { name: "합성 이름 수정" });
  assert.equal(await read(itemPath("cleared")), undefined, "cleared item cannot resurrect after edits/replay");
  await db.doc("users/manager").update({ role: "student" });
  await writeAndNotify("cleared", { name: "합성 수정 재검증" });
  assert.equal(await read(itemPath("cleared", "manager")), undefined, "demoted teacher must not retain updated registration data");
  assert.equal((await read(inboxPath("manager"))).unreadCount, 0);
  assert.equal((await db.collection("semester_wis_ledger").get()).size, 0);
  console.log("PASS registration integration: signup/live client inbox and rules, duplicates, complete canonical approval, rejection, receipts, stale events, clear and recipient revocation; no ledger writes");
})().then(async () => { await rulesEnvironment?.cleanup(); await deleteApp(app); }).catch(async error => {
  console.error(error);
  await rulesEnvironment?.cleanup();
  await deleteApp(app);
  process.exitCode = 1;
});
