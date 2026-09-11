const assert = require("node:assert/strict");
const migration = require("../wisLegacyMigration");
const wis = require("../wisEconomy");

const scope = "2026-2", uid = "student-a", paths = migration.pathsFor(scope, uid);
const actor = { actorUid: "admin-a", actorRole: "admin", actorEmail: "westoria28@gmail.com" };
const projectId = "westory-staging-177587430482";
const adapter = migration.createLegacyWisMigrationAdapter({ projectId });
const clone = (value) => structuredClone(value);
class Transaction {
  constructor(seed) { this.docs = clone(seed); this.writes = []; this.queries = []; }
  async get(path) {
    assert.equal(this.writes.length, 0, "all reads precede all writes");
    return { path, exists: Object.hasOwn(this.docs, path), data: clone(this.docs[path] || null) };
  }
  async getAll(paths) { return Promise.all(paths.map((path) => this.get(path))); }
  async query(collection, options) {
    assert.equal(this.writes.length, 0, "all queries precede all writes");
    this.queries.push({ collection, options });
    return Object.entries(this.docs).filter(([path, data]) => path.startsWith(`${collection}/`) &&
      !path.slice(collection.length + 1).includes("/") && options.filters.every((filter) =>
        filter.operator === "==" && data[filter.field] === filter.value))
      .slice(0, options.limit).map(([path, data]) => ({ path, exists: true, data: clone(data) }));
  }
  create(path, data) {
    assert.equal(Object.hasOwn(this.docs, path), false, "create never overwrites");
    this.writes.push(path); this.docs[path] = clone(data);
  }
  set(path, data, options) {
    this.writes.push(path); this.docs[path] = options?.merge ? { ...this.docs[path], ...clone(data) } : clone(data);
  }
}
function fixture() {
  const totals = { balance: 130, earnedTotal: 150, spentTotal: 20, adjustedTotal: 50, rankEarnedTotal: 150 };
  const empty = Object.fromEntries(migration.TOTAL_FIELDS.map((field) => [field, 0]));
  const identity = { accountId: paths.accountId, semesterId: scope, studentUid: uid, enrollmentId: "enrollment-a", classId: "class-a" };
  const account = { ...identity, ...empty, revision: 1, status: "ACTIVE", provenance: "CURRENT", readOnly: false,
    initialGrantLedgerEntryId: null, recentLedgerEntries: [] };
  return {
    [paths.manifest]: { semesterId: scope, status: "ACTIVE", revision: 7 },
    [paths.pointer]: { semesterId: scope, revision: 7 },
    [paths.maintenance]: { enabled: true },
    [paths.control]: { semesterId: scope, enabled: true, writesBlocked: true },
    [paths.user]: { role: "student" },
    [paths.slot]: { semesterId: scope, studentUid: uid, activeEnrollmentId: "enrollment-a" },
    "semester_enrollments/enrollment-a": { ...identity, enrollmentStatus: "ACTIVE" },
    "semester_classes/class-a": { semesterId: scope, status: "ACTIVE" },
    [paths.economy]: { semesterId: scope, status: "ACTIVE_INITIALIZING", revision: 3, ledgerEntryCount: 0,
      accountCount: 1, initializedAccountCount: 0 },
    [paths.account]: account,
    [paths.balance]: { ...account, ledgerRevision: 1 },
    [paths.ranking]: { ...identity, balance: 0, rankEarnedTotal: 0, ledgerRevision: 1 },
    [paths.wallet]: { uid, ...totals, transactionCount: 3 },
    [`${paths.transactions}/quiz`]: { uid, type: "quiz", delta: 100, balanceAfter: 100, createdAt: { seconds: 1, nanoseconds: 2 } },
    [`${paths.transactions}/manual`]: { uid, type: "manual_adjust", delta: 50, balanceAfter: 150 },
    [`${paths.transactions}/purchase`]: { uid, type: "purchase_hold", delta: -20, balanceAfter: 130 },
    [`${paths.orders}/fulfilled`]: { uid, status: "fulfilled" },
    [`${paths.transactions}/foreign`]: { uid: "another-student", type: "quiz", delta: 500, balanceAfter: 500 },
  };
}
const source = (transaction) => migration.readLegacyWisMigrationSource({ transaction, semesterId: scope, studentUid: uid });
async function payloadFor(seed) {
  return { semesterId: scope, studentUid: uid, expectedSemesterRevision: 7, expectedEconomyRevision: 3,
    expectedAccountRevision: 1, expectedLegacyHash: (await source(new Transaction(seed))).legacyHash, reason: "같은 학기 원본 잔액 보존" };
}
const apply = (transaction, payload, overrides = {}) => adapter.apply({ transaction, commandType: migration.COMMAND_TYPE,
  payload, actor, commandId: "command-a", receiptId: "receipt-a", timestamp: "2026-09-11T00:00:00Z", ...overrides });
let checks = 0;
async function test(name, run) { await run(); checks++; process.stdout.write(`PASS ${name}\n`); }
async function blocked(name, mutate, expected) {
  await test(name, async () => {
    const seed = fixture(); mutate(seed); const tx = new Transaction(seed), payload = await payloadFor(seed);
    const preflight = await migration.loadLegacyWisMigrationPreflight({ transaction: tx, payload, actor });
    assert.equal(preflight.status, "BLOCKED"); assert(preflight.blockers.some((item) => item.code === expected), JSON.stringify(preflight.blockers));
    assert.equal(tx.writes.length, 0); assert.deepEqual(tx.docs, seed);
    await assert.rejects(apply(new Transaction(seed), payload), (error) => error.details?.reason === "WIS_MIGRATION_BLOCKED");
  });
}
(async () => {
  await test("pure source hash is deterministic, scoped, and nanosecond-sensitive", async () => {
    const seed = fixture(), before = clone(seed), result = await source(new Transaction(seed));
    assert.equal(result.status, "READY"); assert.equal(result.transactionCount, 3); assert.equal(result.totals.balance, 130);
    assert.equal((await source(new Transaction(Object.fromEntries(Object.entries(seed).reverse())))).legacyHash, result.legacyHash);
    seed[`${paths.transactions}/quiz`].createdAt.nanoseconds++;
    assert.notEqual((await source(new Transaction(seed))).legacyHash, result.legacyHash);
    assert.equal(before[`${paths.transactions}/quiz`].createdAt.nanoseconds, 2);
    assert.notEqual(migration.canonical({ seconds: 1, nanoseconds: 2, note: "a" }), migration.canonical({ seconds: 1, nanoseconds: 2, note: "b" }));
  });
  await test("readonly preflight uses bounded exact uid queries", async () => {
    const seed = fixture(), tx = new Transaction(seed);
    assert.equal((await migration.loadLegacyWisMigrationPreflight({ transaction: tx, payload: await payloadFor(seed), actor })).status, "READY");
    assert.deepEqual(tx.docs, seed); assert.equal(tx.writes.length, 0);
    for (const call of tx.queries.filter((row) => row.collection.startsWith(paths.scope))) {
      assert.deepEqual(call.options, { filters: [{ field: "uid", operator: "==", value: uid }], limit: 1001 });
    }
  });
  await test("atomic six-document opening preserves all totals and original data", async () => {
    const seed = fixture(), tx = new Transaction(seed), result = await apply(tx, await payloadFor(seed));
    assert.equal(result.result.migrated, true); assert.equal(tx.writes.length, 6);
    for (const field of migration.TOTAL_FIELDS) {
      assert.equal(tx.docs[paths.account][field], seed[paths.wallet][field]);
      assert.equal(tx.docs[paths.balance][field], seed[paths.wallet][field]);
      assert.equal(tx.docs[paths.opening].openingTotals[field], seed[paths.wallet][field]);
    }
    for (const [path, data] of Object.entries(seed).filter(([path]) => path.startsWith(paths.scope))) assert.deepEqual(tx.docs[path], data);
    assert.equal(tx.docs[paths.ranking].rankEarnedTotal, 150);
    assert.equal(tx.docs[paths.economy].accountCount, 1); assert.equal(tx.docs[paths.economy].ledgerEntryCount, 1);
    assert.equal(tx.docs[paths.economy].legacyMigrationCount, 1); assert.equal(tx.docs[paths.economy].revision, 4);
    assert.equal(tx.docs[paths.economy].initializedAccountCount, 1);
    assert.equal(tx.docs[paths.marker].rollback.policy, "MANUAL_RECONCILIATION_REQUIRED");
    assert.deepEqual(tx.docs[paths.marker].beforeSnapshot.account, seed[paths.account]);
    assert.equal(tx.docs[paths.account].initialGrantLedgerEntryId, null);
  });
  await test("different command id replays marker without recredit or overwriting later activity", async () => {
    const seed = fixture(), payload = await payloadFor(seed), first = new Transaction(seed);
    await apply(first, payload); first.docs[paths.account].balance = 120; first.docs[paths.account].revision++;
    const again = new Transaction(first.docs), result = await apply(again, payload, { commandId: "command-b", receiptId: "receipt-b" });
    assert.equal(result.result.alreadyMigrated, true); assert.equal(result.result.addedBalance, 0);
    assert.equal(again.writes.length, 0); assert.equal(again.docs[paths.account].balance, 120);
    assert.equal(again.docs[paths.economy].initializedAccountCount, 1);
    assert.equal(again.docs[paths.economy].revision, 4);
    assert.equal(again.docs[paths.economy].legacyMigrationCount, 1);
  });
  await test("changed source after marker fails closed even with a freshly prepared hash", async () => {
    const first = new Transaction(fixture()); await apply(first, await payloadFor(first.docs));
    first.docs[paths.wallet].note = "changed";
    const again = new Transaction(first.docs);
    await assert.rejects(apply(again, await payloadFor(first.docs)), (error) => error.details.blockers.some((item) => item.code === "MIGRATION_MARKER_CONFLICT"));
    assert.equal(again.writes.length, 0);
  });
  await test("marker opening/project integrity is checked", async () => {
    const first = new Transaction(fixture()), payload = await payloadFor(first.docs); await apply(first, payload);
    const tampered = clone(first.docs); tampered[paths.opening].delta++;
    await assert.rejects(apply(new Transaction(tampered), payload));
    first.docs[paths.marker].projectId = "production";
    await assert.rejects(apply(new Transaction(first.docs), payload), (error) => error.details.reason === "WIS_MIGRATION_MARKER_PROJECT_CONFLICT");
  });
  await test("stale expected source hash writes nothing", async () => {
    const seed = fixture(), payload = await payloadFor(seed); seed[paths.wallet].note = "changed";
    const tx = new Transaction(seed); await assert.rejects(apply(tx, payload)); assert.equal(tx.writes.length, 0);
  });
  const cases = [
    ["missing wallet", (s) => delete s[paths.wallet], "LEGACY_WALLET_MISSING"],
    ["missing wallet uid", (s) => delete s[paths.wallet].uid, "LEGACY_WALLET_UID_MISMATCH"],
    ["negative balance", (s) => s[paths.wallet].balance = -1, "LEGACY_NEGATIVE_BALANCE"],
    ["missing rank evidence", (s) => delete s[paths.wallet].rankEarnedTotal, "LEGACY_TOTAL_INVALID"],
    ["wallet ledger mismatch", (s) => s[paths.wallet].earnedTotal++, "LEGACY_TOTAL_MISMATCH"],
    ["transaction count mismatch", (s) => s[paths.wallet].transactionCount++, "LEGACY_TRANSACTION_COUNT_MISMATCH"],
    ["balanceAfter broken chain", (s) => s[`${paths.transactions}/quiz`].balanceAfter++, "LEGACY_BALANCE_CHAIN_MISMATCH"],
    ["unsafe delta", (s) => s[`${paths.transactions}/quiz`].delta = Number.MAX_SAFE_INTEGER + 1, "LEGACY_TRANSACTION_INVALID"],
    ["unknown legacy transaction type", (s) => s[`${paths.transactions}/quiz`].type = "unknown", "LEGACY_TRANSACTION_INVALID"],
    ["pending requested order", (s) => s[`${paths.orders}/fulfilled`].status = "requested", "LEGACY_PENDING_ORDER"],
    ["pending approved order", (s) => s[`${paths.orders}/fulfilled`].status = "approved", "LEGACY_PENDING_ORDER"],
    ["unknown order state", (s) => s[`${paths.orders}/fulfilled`].status = "unknown", "LEGACY_ORDER_STATE_INVALID"],
    ["maintenance missing", (s) => delete s[paths.maintenance], "MAINTENANCE_REQUIRED"],
    ["writer fence false", (s) => s[paths.control].writesBlocked = false, "WIS_WRITER_FENCE_REQUIRED"],
    ["writer fence foreign scope", (s) => s[paths.control].semesterId = "2026-1", "WIS_WRITER_FENCE_REQUIRED"],
    ["manifest PREPARING", (s) => s[paths.manifest].status = "PREPARING", "ACTIVE_SEMESTER_REVISION_REQUIRED"],
    ["manifest revision stale", (s) => s[paths.manifest].revision++, "ACTIVE_SEMESTER_REVISION_REQUIRED"],
    ["pointer mismatch", (s) => s[paths.pointer].semesterId = "2026-1", "ACTIVE_SEMESTER_POINTER_MISMATCH"],
    ["pointer revision stale", (s) => s[paths.pointer].revision++, "ACTIVE_SEMESTER_POINTER_MISMATCH"],
    ["foreign student role", (s) => s[paths.user].role = "teacher", "STUDENT_IDENTITY_REQUIRED"],
    ["inactive enrollment", (s) => s["semester_enrollments/enrollment-a"].enrollmentStatus = "INACTIVE", "ACTIVE_ENROLLMENT_REQUIRED"],
    ["foreign class", (s) => s["semester_classes/class-a"].semesterId = "2025-2", "ACTIVE_ENROLLMENT_REQUIRED"],
    ["foreign account", (s) => s[paths.account].studentUid = "foreign", "CANONICAL_ACCOUNT_SCOPE_MISMATCH"],
    ["readonly account", (s) => s[paths.account].readOnly = true, "CANONICAL_ACCOUNT_NOT_CURRENT"],
    ["nonempty account", (s) => s[paths.account].balance = 1, "CANONICAL_ACCOUNT_NOT_EMPTY"],
    ["nonempty balance projection", (s) => s[paths.balance].earnedTotal = 1, "CANONICAL_ACCOUNT_NOT_EMPTY"],
    ["stale ranking projection", (s) => s[paths.ranking].ledgerRevision++, "CANONICAL_PROJECTION_NOT_EMPTY"],
    ["initial grant exists", (s) => s[paths.account].initialGrantLedgerEntryId = "grant-a", "CANONICAL_ACTIVITY_EXISTS"],
    ["canonical ledger exists", (s) => s[`${wis.WIS_LEDGER_COLLECTION}/old`] = { accountId: paths.accountId }, "CANONICAL_ACTIVITY_EXISTS"],
    ["canonical order exists", (s) => s[`${wis.WIS_ORDER_COLLECTION}/old`] = { accountId: paths.accountId }, "CANONICAL_ACTIVITY_EXISTS"],
    ["account revision stale", (s) => s[paths.account].revision++, "CANONICAL_REVISION_CHANGED"],
    ["economy revision stale", (s) => s[paths.economy].revision++, "CANONICAL_REVISION_CHANGED"],
    ["economy count unsafe", (s) => s[paths.economy].ledgerEntryCount = Number.MAX_SAFE_INTEGER, "ECONOMY_COUNT_INVALID"],
    ["initialized count exceeds account count", (s) => s[paths.economy].initializedAccountCount = 1, "ECONOMY_INITIALIZATION_COUNT_EXCEEDED"],
    ["initialized count missing", (s) => delete s[paths.economy].initializedAccountCount, "ECONOMY_INITIALIZATION_COUNT_INVALID"],
    ["initialized count negative", (s) => s[paths.economy].initializedAccountCount = -1, "ECONOMY_INITIALIZATION_COUNT_INVALID"],
    ["initialized count unsafe", (s) => s[paths.economy].initializedAccountCount = Number.MAX_SAFE_INTEGER, "ECONOMY_INITIALIZATION_COUNT_INVALID"],
    ["account count missing", (s) => delete s[paths.economy].accountCount, "ECONOMY_INITIALIZATION_COUNT_INVALID"],
    ["account count zero", (s) => s[paths.economy].accountCount = 0, "ECONOMY_INITIALIZATION_COUNT_INVALID"],
    ["source byte bound", (s) => s[paths.wallet].note = "x".repeat(migration.MAX_SOURCE_BYTES), "LEGACY_SOURCE_BYTE_LIMIT"],
    ["target snapshot byte bound", (s) => s[paths.economy].note = "x".repeat(512 * 1024), "TARGET_SNAPSHOT_BYTE_LIMIT"],
  ];
  for (const args of cases) await blocked(...args);
  await test("1000 transactions accepted; bounded query detects 1001 overflow", async () => {
    const seed = fixture();
    for (const path of Object.keys(seed)) if (path.startsWith(`${paths.transactions}/`)) delete seed[path];
    Object.assign(seed[paths.wallet], { balance: 1000, earnedTotal: 1000, rankEarnedTotal: 1000, adjustedTotal: 0, spentTotal: 0, transactionCount: 1000 });
    for (let i = 0; i < 1000; i++) seed[`${paths.transactions}/tx-${i}`] = { uid, type: "quiz", delta: 1, balanceAfter: i + 1 };
    assert.equal((await source(new Transaction(seed))).status, "READY");
    seed[`${paths.transactions}/overflow`] = { uid, type: "quiz", delta: 1, balanceAfter: 1001 };
    assert((await source(new Transaction(seed))).blockers.some((row) => row.code === "LEGACY_SOURCE_ROW_LIMIT"));
  });
  await test("empty legacy evidence preserves zero without initial grant", async () => {
    const seed = fixture(); for (const path of Object.keys(seed)) if (path.startsWith(`${paths.transactions}/`)) delete seed[path];
    for (const field of migration.TOTAL_FIELDS) seed[paths.wallet][field] = 0;
    seed[paths.wallet].transactionCount = 0;
    const tx = new Transaction(seed); assert.equal((await apply(tx, await payloadFor(seed))).result.addedBalance, 0);
    assert.equal(tx.docs[paths.account].initialGrantLedgerEntryId, null);
  });
  await test("safe individual amounts cannot overflow cumulative totals", async () => {
    const seed = fixture();
    seed[`${paths.transactions}/quiz`].delta = Number.MAX_SAFE_INTEGER;
    seed[`${paths.transactions}/quiz`].balanceAfter = Number.MAX_SAFE_INTEGER;
    assert((await source(new Transaction(seed))).blockers.some((row) => row.code === "LEGACY_TOTAL_OVERFLOW"));
  });
  await test("disconnected zero-sum balance cycle is rejected", async () => {
    const seed = fixture();
    seed[`${paths.transactions}/detached-one`] = { uid, type: "purchase_hold", delta: -1, balanceAfter: 999 };
    seed[`${paths.transactions}/detached-two`] = { uid, type: "purchase_cancel", delta: 1, balanceAfter: 1000 };
    seed[paths.wallet].transactionCount += 2;
    assert((await source(new Transaction(seed))).blockers.some((row) => row.code === "LEGACY_BALANCE_CHAIN_MISMATCH"));
  });
  await test("cancelled purchases preserve original net spent total", async () => {
    const seed = fixture();
    seed[`${paths.transactions}/cancel`] = { uid, type: "purchase_cancel", delta: 20, balanceAfter: 150 };
    Object.assign(seed[paths.wallet], { balance: 150, spentTotal: 0, transactionCount: 4 });
    seed[`${paths.orders}/fulfilled`].status = "cancelled";
    const tx = new Transaction(seed); await apply(tx, await payloadFor(seed));
    assert.equal(tx.docs[paths.account].spentTotal, 0); assert.equal(tx.docs[paths.account].earnedTotal, 150);
  });
  await test("reclaimed activity does not become earned opening credit", async () => {
    const seed = fixture(); seed[`${paths.transactions}/quiz`].reclaimed = true;
    seed[`${paths.transactions}/reclaim`] = { uid, type: "lesson_core_points_reclaim", delta: -100, balanceAfter: 30 };
    Object.assign(seed[paths.wallet], { balance: 30, earnedTotal: 50, rankEarnedTotal: 50, transactionCount: 4 });
    const tx = new Transaction(seed); await apply(tx, await payloadFor(seed));
    assert.equal(tx.docs[paths.account].earnedTotal, 50); assert.equal(tx.docs[paths.account].balance, 30);
  });
  await test("pure snapshot rejects injected foreign/missing uid rows", async () => {
    const inspected = await source(new Transaction(fixture())), snapshot = inspected.snapshot;
    for (const badUid of [undefined, "foreign"]) {
      const rows = snapshot.transactions.map((row) => ({ ...clone(row), exists: true })); rows[0].data.uid = badUid;
      const result = migration.evaluateLegacyWisSource({ semesterId: scope, studentUid: uid, wallet: snapshot.wallet,
        transactions: rows, orders: snapshot.orders.map((row) => ({ ...row, exists: true })) });
      assert(result.blockers.some((row) => row.code === "LEGACY_SOURCE_ROW_SCOPE_INVALID"));
    }
  });
  await test("strict payload, actor and production guards", async () => {
    const seed = fixture(), payload = await payloadFor(seed);
    for (const patch of [{ extra: true }, { expectedAccountRevision: 0 }, { studentUid: "../x" }, { semesterId: "2026-3" }])
      assert.throws(() => migration.normalizeLegacyWisMigrationPayload(migration.COMMAND_TYPE, { ...payload, ...patch }));
    for (const wrong of [{ ...actor, actorRole: "teacher" }, { ...actor, actorEmail: "other@example.com" }])
      await assert.rejects(apply(new Transaction(seed), payload, { actor: wrong }), (error) => error.code === "permission-denied");
    await assert.rejects(migration.createLegacyWisMigrationAdapter({ projectId: "history-quiz-yongsin" }).apply({}), (error) => error.details.reason === "WIS_MIGRATION_PROJECT_FORBIDDEN");
  });
  await test("transaction abort after partial staged writes does not commit source or target", async () => {
    const persisted = fixture(), original = clone(persisted), tx = new Transaction(persisted), normalSet = tx.set.bind(tx);
    tx.set = (...args) => { normalSet(...args); if (tx.writes.length === 3) throw new Error("injected transaction abort"); };
    await assert.rejects(apply(tx, await payloadFor(persisted)), /injected transaction abort/);
    // Store commits only a successfully resolved transaction, as Firestore does.
    assert.deepEqual(persisted, original); assert.equal(tx.writes.length, 3);
  });
  await test("economy count and revision roll back together when marker creation fails", async () => {
    const persisted = fixture(), tx = new Transaction(persisted), normalCreate = tx.create.bind(tx);
    tx.create = (path, data) => { if (path === paths.marker) throw new Error("marker conflict"); normalCreate(path, data); };
    await assert.rejects(apply(tx, await payloadFor(persisted)), /marker conflict/);
    assert.equal(tx.docs[paths.economy].initializedAccountCount, 1);
    assert.equal(tx.docs[paths.economy].revision, 4);
    assert.equal(persisted[paths.economy].initializedAccountCount, 0);
    assert.equal(persisted[paths.economy].revision, 3);
    assert.equal(Object.hasOwn(persisted, paths.marker), false);
  });
  await test("existing initialized accounts retained and migration completes final uninitialized account", async () => {
    const seed = fixture(); Object.assign(seed[paths.economy], { accountCount: 3, initializedAccountCount: 2 });
    const tx = new Transaction(seed); await apply(tx, await payloadFor(seed));
    assert.equal(tx.docs[paths.economy].initializedAccountCount, 3);
    assert.equal(tx.docs[paths.economy].accountCount, 3);
    assert.equal(tx.docs[paths.account].initialGrantLedgerEntryId, null);
    assert.equal(tx.docs[paths.account].legacyMigrationId, paths.migrationId);
  });
  process.stdout.write(`PASS wis legacy migration: ${checks} scenarios; no network or persistent writes\n`);
})().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
