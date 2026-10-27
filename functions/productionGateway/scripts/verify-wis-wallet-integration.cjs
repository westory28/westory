const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

// Only this disposable emulator may receive fixtures or the reset request.
const projectId = "demo-westory-session-wis-wallet";
const host = process.env.FIRESTORE_EMULATOR_HOST || "";
if (!/^127\.0\.0\.1:\d+$/.test(host) || process.env.GCLOUD_PROJECT !== projectId ||
    (process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT !== projectId))
  throw new Error("Dedicated local demo-westory-session-wis-wallet emulator required.");
process.env.GOOGLE_CLOUD_PROJECT = projectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });

const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { HttpsError } = require("firebase-functions/v2/https");
const app = initializeApp({ projectId });
const db = getFirestore(app);
const wis = require("../wisEconomy");
const gateway = require("../commandGateway");
const archive = require("../archiveEnrollment");
const { createWisQueryCore } = require("../wisEconomyQuery");
const scope = "2026-2";
const accountId = (uid) => wis.accountIdFor(scope, uid);
const accountPath = (uid) => `semester_wis_accounts/${accountId(uid)}`;
const economyPath = `semester_wis_economies/${scope}`;
const inventoryId = wis.inventoryIdFor(scope, "pencil");
const inventoryPath = `semester_wis_inventory/${inventoryId}`;
const reason = (expected) => (error) => error.details?.reason === expected;
const get = async (path) => (await db.doc(path).get()).data();
const patch = (path, data) => db.doc(path).set(data, { merge: true });
const documents = async (collection) => (await db.collection(collection).get()).docs.map((doc) => ({ path: doc.ref.path, ...doc.data() }));
const adapter = wis.createWisCommandAdapter();
const sessionChecks = [];

// The real Firestore transaction adapter and callable wrappers are exercised.
// Authentication is a fixture seam, not a claim to verify Firebase ID tokens.
const core = gateway.createCommandGatewayCore({
  store: gateway.createFirestoreStore(db), projectId,
  assertSession: async (request, options) => {
    sessionChecks.push({ uid: request.auth?.uid, ...options });
    if (!request.auth?.uid || request.sessionRejected) throw new HttpsError("unauthenticated", "Fixture session rejected.");
    return { uid: request.auth.uid };
  },
  authorizeCommand: async ({ request }) => ({ actorUid: request.auth.uid, actorEmail: "fixture@example.test",
    actorRole: request.auth.uid === "teacher" ? "teacher" : "student" }),
  commandAdapters: Object.fromEntries(Object.values(wis.WIS_COMMAND_TYPES).map((type) => [type, adapter])),
});
const endpoints = gateway.createCallableExports({ core });
const queryCore = createWisQueryCore({ store: gateway.createFirestoreStore(db, { readOnly: true }),
  assertSession: async (request) => ({ uid: request.auth.uid }) });
const request = (commandType, payload, uid = "teacher", extra = {}) => ({
  auth: { uid, token: { email: `${uid}@example.test` } },
  data: { commandId: randomUUID(), commandType, payload: {
    semesterId: scope, expectedSemesterRevision: 7, expectedEconomyRevision: 1, ...payload,
  }, ...extra },
});
const grant = (uid, amount = 50, expectedAccountRevision = 1, extra = {}) => request("grantWis", {
  accountId: accountId(uid), expectedAccountRevision, amount, sourceId: randomUUID(), reason: "합성 지급 검사",
}, "teacher", extra);
const call = (input, fast = true) => endpoints[fast ? "executeWisCommandFast" : "executeCommand"].run(input);

async function seed() {
  assert.equal((await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" })).ok, true);
  sessionChecks.length = 0;
  const rows = {
    "users/teacher": { role: "teacher", staffPermissions: ["point_read", "point_manage"] },
    "site_settings/semester_active": { semesterId: scope, revision: 7 },
    "site_settings/config": { year: "2026", semester: "2", activeSemesterId: scope },
    [`semester_manifests/${scope}`]: { semesterId: scope, status: "ACTIVE", revision: 7 },
    [economyPath]: { semesterId: scope, status: "ACTIVE_OPEN", revision: 30, ledgerEntryCount: 0, orderCount: 0 },
    "semester_classes/class-one": { classId: "class-one", semesterId: scope, status: "ACTIVE", grade: "2", classNumber: "1" },
    "wis_product_catalog/pencil": { productId: "pencil", revision: 1, active: true },
    [inventoryPath]: { inventoryId, semesterId: scope, productId: "pencil", productName: "연필", productRevision: 1,
      revision: 1, active: true, price: 100, stock: 2, available: 2, reserved: 0, sold: 0 },
  };
  for (const uid of ["a", "b"]) {
    rows[`users/${uid}`] = { role: "student", name: "합성 학생", registrationApprovalStatus: "APPROVED" };
    rows[`student_identities/${uid}`] = { studentUid: uid, accountStatus: "ACTIVE" };
    rows[`semester_enrollment_slots/${archive.buildEnrollmentSlotId(scope, uid)}`] = {
      semesterId: scope, studentUid: uid, activeEnrollmentId: `enrollment-${uid}`, status: "ACTIVE" };
    rows[`semester_enrollments/enrollment-${uid}`] = { enrollmentId: `enrollment-${uid}`, studentUid: uid,
      semesterId: scope, classId: "class-one", enrollmentStatus: "ACTIVE", displayName: "합성 학생" };
    const account = { schemaVersion: 1, policyVersion: "w7-v1", accountId: accountId(uid), studentUid: uid,
      semesterId: scope, enrollmentId: `enrollment-${uid}`, classId: "class-one", status: "ACTIVE", displayName: "합성 학생",
      revision: 1, balance: 0, earnedTotal: 0, rankEarnedTotal: 0, spentTotal: 0, adjustedTotal: 0, recentLedgerEntries: [] };
    rows[accountPath(uid)] = account;
    rows[`semester_wis_balances/${accountId(uid)}`] = { ...account, ledgerRevision: 1 };
    rows[`semester_wis_rankings/${accountId(uid)}`] = { ...account, ledgerRevision: 1 };
    rows[`years/2026/semesters/2/point_wallets/${uid}`] = { uid, balance: 9000 };
  }
  const batch = db.batch();
  for (const [path, value] of Object.entries(rows)) batch.set(db.doc(path), value);
  await batch.commit();
}

async function accounting(uid, expectedDeltas) {
  const [account, entries] = await Promise.all([get(accountPath(uid)),
    db.collection("semester_wis_ledger").where("accountId", "==", accountId(uid)).get()]);
  const rows = entries.docs.map((doc) => doc.data()).sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  assert.deepEqual(rows.map((row) => row.delta), expectedDeltas);
  let balance = 0;
  for (const row of rows) {
    assert.equal(row.balanceBefore, balance);
    balance += row.delta;
    assert.equal(row.balanceAfter, balance);
    assert.ok(balance >= 0);
    assert.equal(row.studentUid, uid);
    const receipt = await get(`${gateway.RECEIPT_COLLECTION}/${row.receiptId}`);
    assert.equal(receipt.status, "SUCCEEDED");
    assert.equal(receipt.result.balance, row.balanceAfter);
    assert.ok(receipt.target.refs.includes(`semester_wis_ledger/${row.ledgerEntryId}`));
  }
  assert.equal(account.balance, balance);
  assert.equal(account.revision, rows.length + 1);
  assert.deepEqual(account.recentLedgerEntries.map((row) => row.ledgerEntryId), rows.map((row) => row.ledgerEntryId).reverse());
  for (const collection of ["semester_wis_balances", "semester_wis_rankings"]) {
    const projection = await get(`${collection}/${accountId(uid)}`);
    assert.equal(projection.balance, balance);
    assert.equal(projection.ledgerRevision, account.revision);
  }
  assert.equal((await get(`years/2026/semesters/2/point_wallets/${uid}`)).balance, 9000);
  return account;
}
const snapshot = async () => Promise.all(["semester_wis_ledger", "semester_wis_accounts", "semester_wis_balances",
  "semester_wis_rankings", "semester_wis_economies", "semester_wis_orders", "semester_wis_inventory",
  gateway.RECEIPT_COLLECTION, gateway.AUDIT_COLLECTION].map(documents));
async function unchanged(action, expected) {
  const before = await snapshot();
  await assert.rejects(action, reason(expected));
  assert.deepEqual(await snapshot(), before);
}
let groups = 0;
async function test(name, run) {
  await seed(); await run(); groups += 1;
  console.log(`PASS ${name}`);
}

(async () => { try {
  await test("two students concurrently grant against one economy without losing balances or ledger count", async () => {
    const outcomes = await Promise.all([call(grant("a", 30)), call(grant("b", 70), false)]);
    assert.deepEqual(outcomes.map((row) => row.result.balance), [30, 70]);
    await accounting("a", [30]); await accounting("b", [70]);
    assert.equal((await get(economyPath)).ledgerEntryCount, 2);
    assert.equal((await get(economyPath)).revision, 30);
  });
  await test("simultaneous distinct commands on the same account keep strict account CAS", async () => {
    const outcomes = await Promise.allSettled([call(grant("a")), call(grant("a"), false)]);
    assert.equal(outcomes.filter((row) => row.status === "fulfilled").length, 1);
    const failed = outcomes.find((row) => row.status === "rejected");
    assert.equal(failed.reason.details.reason, "WIS_ACCOUNT_REVISION_CONFLICT");
    await accounting("a", [50]);
    assert.equal((await get(economyPath)).ledgerEntryCount, 1);
  });
  await test("simultaneous duplicate commands and lost responses share receipts across old and fast routes", async () => {
    const input = grant("a", 50, 1, { _testDropResponseAfterCommit: true });
    await assert.rejects(() => call(input, false), (error) => error.code === "unavailable");
    const before = await snapshot();
    const outcomes = await Promise.all([call(input), call(input, false), call(input)]);
    outcomes.forEach((result) => assert.equal(result.replayed, true));
    assert.deepEqual(await snapshot(), before);
    const statusRequest = { auth: input.auth, data: { commandId: input.data.commandId, commandType: input.data.commandType } };
    assert.deepEqual(await endpoints.getWisCommandStatusFast.run(statusRequest), await endpoints.getCommandStatus.run(statusRequest));
    await accounting("a", [50]);
    const reverseRoute = grant("b", 80, 1, { _testDropResponseAfterCommit: true });
    await assert.rejects(() => call(reverseRoute), (error) => error.code === "unavailable");
    assert.equal((await call(reverseRoute, false)).replayed, true);
    await accounting("b", [80]);
    await unchanged(() => call({ ...input, data: { ...input.data, payload: { ...input.data.payload, amount: 60 } } }), "COMMAND_ID_CONFLICT");
    const duplicateSource = grant("a", 50, 2);
    duplicateSource.data.payload.sourceId = input.data.payload.sourceId;
    await unchanged(() => call(duplicateSource), "WIS_LEDGER_SOURCE_EXISTS");
    assert.ok(sessionChecks.every((entry) => entry.recentAuth && entry.highRisk));
  });
  await test("purchase and repeated cancellation preserve full ledger totals, held stock and projections", async () => {
    await call(grant("a", 1000));
    const purchase = request("placeWisOrder", { expectedAccountRevision: 2, expectedInventoryRevision: 1, inventoryId, quantity: 2 }, "a");
    const result = await call(purchase);
    assert.equal(result.result.balance, 800);
    assert.equal((await get(inventoryPath)).reserved, 2);
    const cancel = request("cancelWisOrder", { orderId: result.result.orderId, expectedOrderRevision: 1, reason: "합성 취소 검사" }, "a");
    const cancellations = await Promise.all([call(cancel), call(cancel, false), call(cancel)]);
    assert.equal(cancellations.filter((row) => !row.replayed).length, 1);
    const account = await accounting("a", [1000, -200, 200]);
    assert.equal(account.spentTotal, 0);
    assert.equal((await get(inventoryPath)).available, 2);
    assert.equal((await get(inventoryPath)).reserved, 0);
    assert.equal((await get(`semester_wis_orders/${result.result.orderId}`)).status, "CANCELLED");
    assert.equal((await get(economyPath)).ledgerEntryCount, 3);
    assert.equal((await get(economyPath)).orderCount, 1);
    await unchanged(() => call(request("cancelWisOrder", { ...cancel.data.payload, expectedOrderRevision: 2 }, "a")), "WIS_ORDER_STATE_INVALID");
  });
  await test("read-only, malformed, archived and migration-blocked dependencies abort all writes", async () => {
    for (const [path, blocked, expected] of [
      [accountPath("a"), { readOnly: true }, "WIS_ACCOUNT_INVALID"],
      [accountPath("a"), { status: "FROZEN" }, "WIS_ACCOUNT_INVALID"],
      [economyPath, { revision: "30" }, "WIS_ECONOMY_INVALID"],
      [economyPath, { status: "CLOSED" }, "WIS_ECONOMY_STATE_INVALID"],
      [`semester_manifests/${scope}`, { readOnly: true }, "SEMESTER_ARCHIVED_WRITE_FORBIDDEN"],
      ["site_settings/semester_active", { semesterId: "2027-1" }, "SEMESTER_ARCHIVED_WRITE_FORBIDDEN"],
      ["site_settings/semester_active", { revision: 8 }, "WIS_ACTIVE_SEMESTER_INVALID"],
      [`wis_legacy_migration_controls/${scope}`, { writesBlocked: true }, "WIS_MIGRATION_WRITES_BLOCKED"],
    ]) {
      const previous = await get(path);
      await patch(path, blocked);
      await unchanged(() => call(grant("a")), expected);
      if (previous) await db.doc(path).set(previous); else await db.doc(path).delete();
    }
    await db.doc("site_settings/semester_active").delete();
    await unchanged(() => call(grant("a")), "WIS_ACTIVE_SEMESTER_INVALID");
    await accounting("a", []);
  });
  await test("read-only query transactions return a coherent account and ledger during concurrent grants", async () => {
    const read = () => queryCore.getWisEconomyState({ auth: { uid: "a" }, data: {
      audience: "student", semesterId: scope, projection: "student-core", source: "CURRENT", limit: 20 } });
    const outcomes = await Promise.all([read(), call(grant("a", 35)), read()]);
    for (const state of [outcomes[0], outcomes[2], await read()]) {
      assert.equal(state.account.balance, state.ledger.reduce((sum, row) => sum + row.delta, 0));
      assert.equal(state.rankings[0].balance, state.account.balance);
    }
    assert.equal((await read()).account.balance, 35);
    await accounting("a", [35]);
  });
  await test("fast-route permissions and rejected sessions leave no receipts or money changes", async () => {
    await unchanged(() => call({ ...grant("a"), auth: { uid: "a", token: { email: "a@example.test" } } }), "WIS_MANAGE_REQUIRED");
    await unchanged(() => call(request("transitionWisEconomy", { targetStatus: "CLOSED", reason: "fixture" })), "WIS_FAST_COMMAND_REQUIRED");
    const before = await snapshot();
    await assert.rejects(() => call({ ...grant("a"), sessionRejected: true }), (error) => error.code === "unauthenticated");
    assert.deepEqual(await snapshot(), before);
    await accounting("a", []);
  });
  console.log(`PASS Wis gateway Firestore integration: ${groups} groups; production reads/writes 0`);
} finally {
  await db.terminate(); await deleteApp(app);
} })().catch((error) => { console.error(error); process.exitCode = 1; });
