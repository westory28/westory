const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { test } = require("node:test");

// Firebase predeploy supplies the production project to child processes. This
// in-memory unit suite must never inherit that project or contact real services.
const unitProjectId = "demo-westory-session-wis-wallet-unit";
process.env.GCLOUD_PROJECT = unitProjectId;
process.env.GOOGLE_CLOUD_PROJECT = unitProjectId;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: unitProjectId });
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:1";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:1";

// Keep the actual maintenance wrapper but inject its supported service seam.
// Real maintenance reads and Firestore behavior are covered by the separate
// verify-wis-wallet-integration.cjs emulator suite, not this memory-only suite.
const maintenance = require("../studentMaintenance");
const wrapCallable = maintenance.onCallWithStudentMaintenance;
const memoryMaintenance = { assertAccess: async () => {}, assertRegistrationAccess: async () => {} };
maintenance.onCallWithStudentMaintenance = (options, handler, guardOptions) =>
  wrapCallable(options, handler, { ...guardOptions, service: memoryMaintenance });
const wis = require("../wisEconomy");
const gateway = require("../commandGateway");
maintenance.onCallWithStudentMaintenance = wrapCallable;
const archiveEnrollment = require("../archiveEnrollment");

const scope = "2026-2";
const accountId = wis.accountIdFor(scope, "student");
const accountPath = `semester_wis_accounts/${accountId}`;
const economyPath = `semester_wis_economies/${scope}`;
const reason = (expected) => (error) => error.details?.reason === expected;

class Transaction {
  constructor(documents) { this.documents = structuredClone(documents); this.writing = false; }
  async get(path) {
    assert.equal(this.writing, false, "all reads precede writes");
    return { exists: this.documents.has(path), data: structuredClone(this.documents.get(path)), path };
  }
  getAll(paths) { return Promise.all(paths.map((path) => this.get(path))); }
  set(path, data, options) {
    this.writing = true;
    this.documents.set(path, structuredClone(options?.merge ? { ...this.documents.get(path), ...data } : data));
  }
  create(path, data) {
    assert.equal(this.documents.has(path), false, "create cannot overwrite an immutable receipt or ledger");
    this.set(path, data);
  }
}
class Store {
  constructor(seed) { this.documents = new Map(Object.entries(seed)); this.queue = Promise.resolve(); }
  get(path) { return new Transaction(this.documents).get(path); }
  runTransaction(callback) {
    const task = this.queue.then(async () => {
      const transaction = new Transaction(this.documents);
      const result = await callback(transaction);
      this.documents = transaction.documents;
      return result;
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
const fixture = () => {
  const inventoryId = wis.inventoryIdFor(scope, "pencil");
  const store = new Store({
    "site_settings/semester_active": { semesterId: scope, revision: 7 },
    [`semester_manifests/${scope}`]: { semesterId: scope, status: "ACTIVE", revision: 7 },
    [economyPath]: { semesterId: scope, status: "ACTIVE_OPEN", revision: 30, ledgerEntryCount: 10 },
    [accountPath]: { accountId, semesterId: scope, studentUid: "student", displayName: "학생", balance: 1000,
      status: "ACTIVE", schemaVersion: 1, policyVersion: "w7-v1",
      revision: 4, earnedTotal: 1000, rankEarnedTotal: 1000, spentTotal: 0, adjustedTotal: 0 },
    [`semester_enrollment_slots/${archiveEnrollment.buildEnrollmentSlotId(scope, "student")}`]: {
      semesterId: scope, studentUid: "student", activeEnrollmentId: "enrollment" },
    "semester_enrollments/enrollment": { enrollmentId: "enrollment", semesterId: scope, studentUid: "student",
      classId: "class", enrollmentStatus: "ACTIVE" },
    "wis_product_catalog/pencil": { productId: "pencil", revision: 1, active: true },
    [`semester_wis_inventory/${inventoryId}`]: { inventoryId, semesterId: scope, productId: "pencil",
      productName: "연필", productRevision: 1, revision: 1, active: true, price: 100,
      stock: 1, available: 1, reserved: 0, sold: 0 },
  });
  const sessionCalls = [];
  const adapter = wis.createWisCommandAdapter();
  const core = gateway.createCommandGatewayCore({ store,
    assertSession: async (request, options) => {
      sessionCalls.push({ uid: request.auth.uid, ...options });
      if (request.sessionRejected) throw Object.assign(new Error("expired"), { code: "unauthenticated" });
      return { uid: request.auth.uid };
    },
    authorizeCommand: async (request) => ({ actorUid: request.request.auth.uid,
      actorRole: request.request.auth.uid === "teacher" ? "teacher" : "student" }),
    commandAdapters: Object.fromEntries(Object.values(wis.WIS_COMMAND_TYPES).map((type) => [type, adapter])),
    serverTimestamp: () => "2026-10-27T00:00:00Z", concreteTimestamp: () => "2026-10-27T00:00:00Z",
    projectId: "demo-westory-session-wis-wallet",
  });
  return { store, core, sessionCalls, endpoints: gateway.createCallableExports({ core }), inventoryId };
};
const request = (payload = {}, extra = {}) => ({ auth: { uid: "teacher" }, data: {
  commandId: randomUUID(), commandType: "grantWis", payload: {
    semesterId: scope, expectedSemesterRevision: 7, expectedEconomyRevision: 1,
    accountId, expectedAccountRevision: 4, amount: 50, sourceId: randomUUID(), reason: "수업 참여",
    ...payload,
  }, ...extra,
} });
const unchanged = async (store, action, expected) => {
  const before = structuredClone(store.documents);
  await assert.rejects(action, reason(expected));
  assert.deepEqual(store.documents, before);
};

test("another student's economy revision cannot reject a valid grant; account CAS remains", async () => {
  const f = fixture();
  const result = await f.core.execute(request());
  assert.equal(result.result.balance, 1050);
  assert.equal(f.store.documents.get(accountPath).revision, 5);
  assert.equal(f.store.documents.get(economyPath).ledgerEntryCount, 11);
  assert.equal(f.store.documents.get(economyPath).revision, 30);
  assert.equal(f.store.documents.get(`semester_wis_balances/${accountId}`).balance, 1050);
  assert.equal(f.store.documents.get(`semester_wis_rankings/${accountId}`).ledgerRevision, 5);
  await unchanged(f.store, () => f.core.execute(request()), "WIS_ACCOUNT_REVISION_CONFLICT");
});

test("simultaneous account updates preserve one balance revision and one ledger", async () => {
  const f = fixture();
  const outcomes = await Promise.allSettled([f.core.execute(request()), f.core.execute(request())]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((item) => item.status === "rejected").length, 1);
  assert.equal([...f.store.documents.keys()].filter((path) => path.startsWith("semester_wis_ledger/")).length, 1);
});

test("lost responses replay exactly once across Seoul and fast endpoints in both directions", async () => {
  for (const fastFirst of [false, true]) {
    const f = fixture();
    const oldExecute = f.endpoints.executeCommand.run;
    const fastExecute = f.endpoints.executeWisCommandFast.run;
    const first = fastFirst ? fastExecute : oldExecute;
    const second = fastFirst ? oldExecute : fastExecute;
    const input = request({}, { _testDropResponseAfterCommit: true });
    await assert.rejects(() => first(input), (error) => error.code === "unavailable");
    const before = structuredClone(f.store.documents);
    const replay = await second(input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.result.balance, 1050);
    assert.deepEqual(f.store.documents, before);
    const statusRequest = { auth: input.auth, data: { commandType: input.data.commandType, commandId: input.data.commandId } };
    const oldStatus = await f.endpoints.getCommandStatus.run(statusRequest);
    const fastStatus = await f.endpoints.getWisCommandStatusFast.run(statusRequest);
    assert.deepEqual(fastStatus, oldStatus);
    assert.equal(fastStatus.status, "SUCCEEDED");
    assert.ok(f.sessionCalls.every((call) => call.recentAuth && call.highRisk));
    await unchanged(f.store, () => second({ ...input, data: { ...input.data,
      payload: { ...input.data.payload, amount: 60 } } }), "COMMAND_ID_CONFLICT");
    await unchanged(f.store, () => f.core.execute(request({ sourceId: input.data.payload.sourceId,
      expectedAccountRevision: 5 })), "WIS_LEDGER_SOURCE_EXISTS");
  }
});

test("the fast route keeps its command allowlist, session checks and teacher permissions", async () => {
  const f = fixture();
  for (const name of ["executeWisCommandFast", "getWisCommandStatusFast"]) {
    await unchanged(f.store, () => f.endpoints[name].run({ auth: { uid: "teacher" }, data: {
      commandType: "transitionSemesterStatus", commandId: randomUUID(), payload: {} } }), "WIS_FAST_COMMAND_REQUIRED");
    assert.deepEqual(f.endpoints[name].__endpoint.region, ["us-central1"]);
  }
  await unchanged(f.store, () => f.endpoints.executeWisCommandFast.run({ ...request(), auth: { uid: "student" } }), "WIS_MANAGE_REQUIRED");
  await assert.rejects(() => f.endpoints.executeWisCommandFast.run({ ...request(), sessionRejected: true }),
    (error) => error.code === "unauthenticated");
  assert.equal(f.endpoints.executeWisCommandFast.__endpoint.minInstances, 1);
  assert.equal(f.endpoints.executeWisCommandFast.__endpoint.maxInstances, 20);
  assert.equal(f.endpoints.executeWisCommandFast.__endpoint.concurrency, 80);
});

test("current closure, read-only scope, migration fence and configuration revision remain authoritative", async () => {
  for (const [path, patch, expected] of [
    [economyPath, { status: "CLOSED" }, "WIS_ECONOMY_STATE_INVALID"],
    [economyPath, { readOnly: true }, "WIS_ECONOMY_STATE_INVALID"],
    [`semester_manifests/${scope}`, { readOnly: true }, "SEMESTER_ARCHIVED_WRITE_FORBIDDEN"],
    ["site_settings/semester_active", { semesterId: "2027-1" }, "SEMESTER_ARCHIVED_WRITE_FORBIDDEN"],
    ["site_settings/semester_active", { revision: 8 }, "WIS_ACTIVE_SEMESTER_INVALID"],
    [economyPath, { semesterId: "2027-1" }, "WIS_ECONOMY_INVALID"],
    [economyPath, { revision: 0 }, "WIS_ECONOMY_INVALID"],
    [economyPath, { revision: "30" }, "WIS_ECONOMY_INVALID"],
    [`wis_legacy_migration_controls/${scope}`, { writesBlocked: true }, "WIS_MIGRATION_WRITES_BLOCKED"],
  ]) {
    const f = fixture();
    f.store.documents.set(path, { ...f.store.documents.get(path), ...patch });
    await unchanged(f.store, () => f.core.execute(request()), expected);
  }
  const f = fixture();
  f.store.documents.delete("site_settings/semester_active");
  await unchanged(f.store, () => f.core.execute(request()), "WIS_ACTIVE_SEMESTER_INVALID");
  f.store.documents.set("site_settings/semester_active", { semesterId: scope, revision: 7 });
  await unchanged(f.store, () => f.core.execute(request({}, { commandType: "transitionWisEconomy", payload: {
    semesterId: scope, expectedSemesterRevision: 7, expectedEconomyRevision: 1, targetStatus: "CLOSED", reason: "마감" } })),
    "WIS_ECONOMY_REVISION_CONFLICT");
});

test("frozen, read-only, foreign and malformed accounts cannot receive or spend Wis", async () => {
  for (const patch of [{ status: "FROZEN" }, { status: undefined }, { readOnly: true },
    { schemaVersion: 2 }, { policyVersion: "unknown" }, { accountId: wis.accountIdFor(scope, "other") },
    { studentUid: "other" }]) {
    const f = fixture();
    f.store.documents.set(accountPath, { ...f.store.documents.get(accountPath), ...patch });
    await unchanged(f.store, () => f.core.execute(request()), "WIS_ACCOUNT_INVALID");
    await unchanged(f.store, () => f.core.execute(request({}, { commandType: "deductWis" })), "WIS_ACCOUNT_INVALID");
  }
});

test("initial grant still activates a prepared account exactly once", async () => {
  const f = fixture();
  f.store.documents.set(economyPath, { ...f.store.documents.get(economyPath), status: "ACTIVE_INITIALIZING", initialGrantAmount: 50 });
  f.store.documents.set(accountPath, { ...f.store.documents.get(accountPath), status: "PREPARING", readOnly: true });
  const input = request({ expectedEconomyRevision: 30 }, { commandType: "grantInitialWis" });
  const result = await f.core.execute(input);
  assert.equal(result.result.balance, 1050);
  assert.equal(f.store.documents.get(accountPath).status, "ACTIVE");
  assert.equal(f.store.documents.get(accountPath).readOnly, false);
  assert.equal((await f.core.execute(input)).replayed, true);
});

test("negative balances and unsafe numeric aggregates abort without any ledger or projection writes", async () => {
  const f = fixture();
  await unchanged(f.store, () => f.core.execute(request({ amount: 1001 }, { commandType: "deductWis" })), "WIS_INSUFFICIENT_BALANCE");
  for (const patch of [{ balance: Number.MAX_SAFE_INTEGER }, { earnedTotal: Number.MAX_SAFE_INTEGER },
    { balance: "1000" }, { rankEarnedTotal: -1 }, { revision: Number.MAX_SAFE_INTEGER }]) {
    const current = fixture();
    current.store.documents.set(accountPath, { ...current.store.documents.get(accountPath), ...patch });
    await unchanged(current.store, () => current.core.execute(request({ expectedAccountRevision: patch.revision || 4 })), "WIS_ACCOUNT_TOTALS_INVALID");
  }
});

test("a stale aggregate revision permits one funded purchase while stock and account revisions still prevent repeats", async () => {
  const f = fixture();
  const input = { auth: { uid: "student" }, data: { commandId: randomUUID(), commandType: "placeWisOrder", payload: {
    semesterId: scope, expectedSemesterRevision: 7, expectedEconomyRevision: 1,
    expectedAccountRevision: 4, expectedInventoryRevision: 1, inventoryId: f.inventoryId, quantity: 1,
  } } };
  const result = await f.endpoints.executeWisCommandFast.run(input);
  assert.equal(result.result.balance, 900);
  assert.equal(f.store.documents.get(`semester_wis_inventory/${f.inventoryId}`).available, 0);
  assert.deepEqual(f.sessionCalls[0], { uid: "student", recentAuth: false, highRisk: false });
  await unchanged(f.store, () => f.core.execute({ ...input, data: { ...input.data, commandId: randomUUID() } }), "WIS_ACCOUNT_REVISION_CONFLICT");
  assert.equal((await f.endpoints.executeCommand.run(input)).replayed, true);
  assert.equal(f.store.documents.get(accountPath).balance, 900);
});
