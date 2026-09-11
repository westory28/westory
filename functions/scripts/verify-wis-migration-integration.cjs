// Offline only: real Gateway normalizer/receipt and exported Wis adapter; synthetic in-memory I/O.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const wis = require("../wisEconomy");
const gateway = require("../commandGateway");
const migration = require("../wisLegacyMigration");
const fence = require("../wisMigrationFence");
const enrollment = require("../archiveEnrollment");
const semesterId = "2026-2", uid = "migration-student", teacherUid = "migration-teacher";
const paths = migration.pathsFor(semesterId, uid);
const openingTotals = { balance: 150, earnedTotal: 250, rankEarnedTotal: 230, spentTotal: 100, adjustedTotal: 20 };
const common = { semesterId, expectedSemesterRevision: 7, expectedEconomyRevision: 3 };
const clone = value => structuredClone(value);
let checks = 0;
const cases = [];
const eq = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const ok = value => { assert.ok(value); checks++; };
const test = async (name, run) => { try { await run(); cases.push(name); } catch (error) { error.message = `${name}: ${error.message}`; throw error; } };

function setup() {
  const legacyHash = crypto.createHash("sha256").update("owned offline migration source").digest("hex");
  const opening = { schemaVersion: wis.WIS_SCHEMA_VERSION, policyVersion: wis.WIS_POLICY_VERSION,
    ledgerEntryId: paths.openingId, semesterId, accountId: paths.accountId, studentUid: uid,
    type: "LEGACY_OPENING", delta: 150, balanceBefore: 0, balanceAfter: 150,
    openingTotals: clone(openingTotals), legacyHash, sourceTransactionCount: 3, sourceId: paths.migrationId,
    reason: "독립 메모리 검증", actorUid: teacherUid, actorRole: "teacher",
    commandId: "migration-opening", receiptId: "migration-opening-receipt", createdAt: { seconds: 1, nanoseconds: 0 } };
  let docs = new Map(Object.entries({
    [paths.manifest]: { semesterId, revision: 7, status: "ACTIVE" },
    [paths.pointer]: { semesterId, revision: 7 },
    [paths.economy]: { schemaVersion: wis.WIS_SCHEMA_VERSION, semesterId, revision: 3, status: "ACTIVE_OPEN",
      accountCount: 1, ledgerEntryCount: 1, orderCount: 0, initialGrantAmount: 0 },
    [paths.account]: { schemaVersion: wis.WIS_SCHEMA_VERSION, policyVersion: wis.WIS_POLICY_VERSION,
      semesterId, accountId: paths.accountId, studentUid: uid, enrollmentId: "migration-enrollment",
      displayName: "합성 학생", classId: "migration-class", status: "ACTIVE", revision: 2,
      ...clone(openingTotals), legacyMigrationId: paths.migrationId, recentLedgerEntries: [opening] },
    [paths.balance]: { semesterId, accountId: paths.accountId, studentUid: uid, ...clone(openingTotals), ledgerRevision: 2 },
    [paths.ranking]: { semesterId, accountId: paths.accountId, studentUid: uid, balance: 150, rankEarnedTotal: 230, ledgerRevision: 2 },
    [paths.opening]: opening,
    [paths.marker]: { schemaVersion: 1, policyVersion: migration.POLICY_VERSION, status: "MIGRATED",
      migrationId: paths.migrationId, semesterId, studentUid: uid, accountId: paths.accountId,
      projectId: "demo-westory-session-wis-migration", legacyHash, sourceRefs: [paths.wallet, `${paths.transactions}/reward-original`],
      sourceTransactionCount: 3, sourceOrderCount: 0, sourceByteCount: 100,
      totals: clone(openingTotals), openingLedgerEntryId: paths.openingId,
      accountRevision: 2, economyRevision: 3, commandId: opening.commandId, receiptId: opening.receiptId },
    [paths.wallet]: { uid, ...clone(openingTotals) },
    [`${paths.transactions}/reward-original`]: { uid, type: "history_dictionary", delta: 30, sourceId: "dictionary-original" },
    [paths.slot]: { semesterId, studentUid: uid, activeEnrollmentId: "migration-enrollment", status: "ACTIVE" },
    [`${enrollment.SEMESTER_ENROLLMENT_COLLECTION}/migration-enrollment`]: {
      enrollmentId: "migration-enrollment", semesterId, studentUid: uid, classId: "migration-class", enrollmentStatus: "ACTIVE" },
    [`${wis.WIS_PRODUCT_COLLECTION}/migration-product`]: { productId: "migration-product", active: true, revision: 1 },
    [`${wis.WIS_INVENTORY_COLLECTION}/migration-inventory`]: { inventoryId: "migration-inventory", semesterId,
      productId: "migration-product", productName: "합성 상품", productRevision: 1, active: true, revision: 1,
      available: 10, reserved: 0, price: 40 },
  }));
  const attempts = [];
  let tick = 10;
  const snapshot = (map, path) => ({ exists: map.has(path), path, data: map.has(path) ? clone(map.get(path)) : null });
  const store = {
    get: async path => snapshot(docs, path),
    runTransaction: async callback => {
      const staged = clone(docs), record = { reads: [], writes: [], committed: false }; attempts.push(record);
      const read = path => { assert.equal(record.writes.length, 0, "Read after write"); record.reads.push(path); return snapshot(staged, path); };
      const write = (mode, path, data, options) => {
        record.writes.push({ mode, path });
        if (mode === "create") assert.equal(staged.has(path), false, `Duplicate create: ${path}`);
        if (mode === "delete") staged.delete(path);
        else staged.set(path, clone(options?.merge ? { ...staged.get(path), ...data } : data));
      };
      const tx = { get: async path => read(path), getAll: async targets => targets.map(read),
        query: async (collection, filter = {}) => {
          assert.equal(record.writes.length, 0, "Query after write"); record.reads.push(`query:${collection}`);
          const clauses = filter.filters || (filter.field ? [filter] : []);
          const rows = [...staged].filter(([path, data]) => path.startsWith(`${collection}/`) && !path.slice(collection.length + 1).includes("/") &&
            clauses.every(clause => { assert.ok(!clause.operator || clause.operator === "=="); return data[clause.field] === clause.value; }))
            .map(([path]) => snapshot(staged, path));
          if (filter.orderBy) rows.sort((a, b) => (b.data.createdAt?.seconds || 0) - (a.data.createdAt?.seconds || 0));
          return rows.slice(0, filter.limit || rows.length);
        },
        set: (path, data, options) => write("set", path, data, options),
        create: (path, data) => write("create", path, data), delete: path => write("delete", path),
      };
      const result = await callback(tx); docs = staged; record.committed = true; return result;
    },
  };
  const adapter = wis.createWisCommandAdapter();
  const core = gateway.createCommandGatewayCore({ store, projectId: "demo-westory-session-wis-migration",
    serverTimestamp: () => ({ seconds: ++tick, nanoseconds: 0 }), concreteTimestamp: () => ({ seconds: tick, nanoseconds: 0 }),
    assertSession: async request => ({ uid: request.auth.uid, email: `${request.auth.uid}@school.test`, sessionId: "offline", revision: 1, schemaVersion: 2 }),
    authorizeCommand: async ({ request }) => ({ actorUid: request.auth.uid, actorRole: request.auth.uid === teacherUid ? "teacher" : "student", actorEmail: `${request.auth.uid}@school.test` }),
    commandAdapters: Object.fromEntries(Object.values(wis.WIS_COMMAND_TYPES).map(name => [name, adapter])) });
  const execute = (commandType, payload, options = {}) => core.execute({ auth: { uid: options.student ? uid : teacherUid },
    data: { commandType, commandId: options.id || crypto.randomUUID(), payload: { ...common, ...payload } } });
  const grant = () => ({ accountId: paths.accountId, expectedAccountRevision: docs.get(paths.account).revision,
    amount: 50, sourceId: crypto.randomUUID(), reason: "합성 지급" });
  const order = () => ({ inventoryId: "migration-inventory", expectedInventoryRevision: docs.get(`${wis.WIS_INVENTORY_COLLECTION}/migration-inventory`).revision,
    expectedAccountRevision: docs.get(paths.account).revision, quantity: 1 });
  const rebuild = () => execute("rebuildWisProjection", { accountId: paths.accountId, reason: "합성 누계 재계산" });
  return { get docs() { return docs; }, attempts, execute, grant, order, rebuild };
}
async function rejectUnchanged(f, action, reason) {
  const before = clone([...f.docs]), start = f.attempts.length;
  await assert.rejects(action, error => error.details?.reason === reason); checks++;
  eq([...f.docs], before);
  ok(f.attempts.slice(start).every(attempt => !attempt.committed && attempt.writes.length === 0));
}
function assertTotals(f, expected) {
  for (const path of [paths.account, paths.balance]) {
    const value = f.docs.get(path);
    eq(Object.fromEntries(Object.keys(expected).map(key => [key, value[key]])), expected);
  }
  eq(f.docs.get(paths.ranking).balance, expected.balance);
  eq(f.docs.get(paths.ranking).rankEarnedTotal, expected.rankEarnedTotal);
}
function reclaimFor(f) {
  const sourceOriginalRewardPath = `${paths.transactions}/reward-original`;
  const sourceId = `legacy-reclaim:${gateway.sha256(`${paths.migrationId}\n${sourceOriginalRewardPath}`)}`;
  return { ledgerEntryId: `wisled_${gateway.sha256([semesterId, paths.accountId, "LEGACY_RECLAIM", sourceId].join("\n"))}`,
    semesterId, accountId: paths.accountId, studentUid: uid, type: "LEGACY_RECLAIM", delta: -30,
    balanceBefore: 150, balanceAfter: 120, legacyMigrationId: paths.migrationId, openingLedgerEntryId: paths.openingId,
    sourceOriginalRewardPath, sourceId, legacyHash: f.docs.get(paths.marker).legacyHash,
    totalsContribution: { earnedTotal: -30, rankEarnedTotal: -30, spentTotal: 0, adjustedTotal: 0 },
    createdAt: { seconds: 2, nanoseconds: 0 } };
}

(async () => {
  await test("Teacher and student writes are fenced before business reads, with either control flag", async () => {
    for (const control of [{ enabled: true }, { writesBlocked: true }, { enabled: false, writesBlocked: true }]) {
      for (const student of [false, true]) {
        const f = setup(); f.docs.set(fence.controlPath(semesterId), control);
        await rejectUnchanged(f, () => f.execute(student ? "placeWisOrder" : "grantWis", student ? f.order() : f.grant(), { student }), "WIS_MIGRATION_WRITES_BLOCKED");
        const reads = f.attempts.at(-1).reads;
        ok(reads[0].startsWith(`${gateway.RECEIPT_COLLECTION}/`));
        eq(reads.slice(1), [fence.controlPath(semesterId)]);
      }
    }
  });
  await test("Existing teacher and student receipts replay without writes while migration is blocked", async () => {
    for (const student of [false, true]) {
      const f = setup(), id = crypto.randomUUID(), command = student ? "placeWisOrder" : "grantWis", payload = student ? f.order() : f.grant();
      const first = await f.execute(command, payload, { id, student });
      f.docs.set(fence.controlPath(semesterId), { enabled: true, writesBlocked: true });
      const before = clone([...f.docs]);
      const replay = await f.execute(command, payload, { id, student });
      eq(replay.replayed, true); eq(replay.result, first.result); eq([...f.docs], before);
      eq(f.attempts.at(-1).writes, []); eq(f.attempts.at(-1).reads.length, 1);
    }
  });
  await test("Opening totals survive actual grant, reversal, order and repeated projection rebuild", async () => {
    const f = setup();
    await f.rebuild(); assertTotals(f, openingTotals);
    const granted = await f.execute("grantWis", f.grant());
    await f.rebuild(); assertTotals(f, { balance: 200, earnedTotal: 300, rankEarnedTotal: 280, spentTotal: 100, adjustedTotal: 70 });
    await f.execute("reverseWisEntry", { accountId: paths.accountId, expectedAccountRevision: f.docs.get(paths.account).revision,
      ledgerEntryId: granted.result.ledgerEntryId, reason: "합성 지급 취소" });
    await f.rebuild(); assertTotals(f, openingTotals);
    await f.execute("placeWisOrder", f.order(), { student: true });
    await f.rebuild(); assertTotals(f, { ...openingTotals, balance: 110, spentTotal: 140 });
    await f.rebuild(); assertTotals(f, { ...openingTotals, balance: 110, spentTotal: 140 });
  });
  await test("Duplicate opening and malformed opening totals fail before any projection or receipt write", async () => {
    const mutations = [
      f => f.docs.set(`${wis.WIS_LEDGER_COLLECTION}/duplicate-opening`, { ...clone(f.docs.get(paths.opening)), ledgerEntryId: "duplicate-opening" }),
      f => { f.docs.get(paths.opening).openingTotals.balance = 151; },
      f => { f.docs.get(paths.opening).openingTotals.earnedTotal = 2.5; },
      f => { f.docs.get(paths.opening).openingTotals.rankEarnedTotal = -1; },
      f => { delete f.docs.get(paths.opening).openingTotals.spentTotal; },
    ];
    for (const mutate of mutations) {
      const f = setup(); mutate(f);
      // Matching marker totals isolate arithmetic validation from marker mismatch rejection.
      f.docs.get(paths.marker).totals = clone(f.docs.get(paths.opening).openingTotals);
      await rejectUnchanged(f, f.rebuild, "WIS_LEGACY_LEDGER_INVALID");
    }
  });
  await test("Malformed legacy reclaim cannot write repaired projections or a success receipt", async () => {
    for (const mutate of [row => { row.delta = 30; }, row => { row.totalsContribution.earnedTotal = -20; },
      row => { row.totalsContribution.rankEarnedTotal = 0; }, row => { row.totalsContribution.spentTotal = 30; },
      row => { row.totalsContribution.adjustedTotal = -30; }, row => { delete row.sourceOriginalRewardPath; },
      row => { delete row.legacyMigrationId; }, row => { delete row.openingLedgerEntryId; }]) {
      const f = setup(), row = reclaimFor(f); mutate(row);
      f.docs.set(`${wis.WIS_LEDGER_COLLECTION}/${row.ledgerEntryId}`, row);
      await rejectUnchanged(f, f.rebuild, "WIS_LEGACY_LEDGER_INVALID");
    }
  });
  await test("Valid migrated original reclaim preserves opening cumulative totals on rebuild", async () => {
    const f = setup(), row = reclaimFor(f);
    f.docs.set(`${wis.WIS_LEDGER_COLLECTION}/${row.ledgerEntryId}`, row);
    await f.rebuild(); assertTotals(f, { ...openingTotals, balance: 120, earnedTotal: 220, rankEarnedTotal: 200 });
    await f.rebuild(); assertTotals(f, { ...openingTotals, balance: 120, earnedTotal: 220, rankEarnedTotal: 200 });
  });
  await test("Missing or mismatched migration markers and opening provenance fail with zero writes", async () => {
    for (const mutate of [f => f.docs.delete(paths.marker), f => { f.docs.get(paths.marker).status = "PREPARING"; },
      f => { f.docs.get(paths.marker).policyVersion = "forged"; }, f => { f.docs.get(paths.marker).studentUid = "other-student"; },
      f => { f.docs.get(paths.marker).totals.balance++; }, f => { delete f.docs.get(paths.account).legacyMigrationId; },
      f => { f.docs.get(paths.opening).legacyHash = "f".repeat(64); }, f => { f.docs.get(paths.opening).balanceBefore = 1; },
      f => { f.docs.get(paths.opening).balanceAfter = 151; }, f => { f.docs.get(paths.opening).sourceId = "forged"; }]) {
      const f = setup(); mutate(f); await rejectUnchanged(f, f.rebuild, "WIS_LEGACY_LEDGER_INVALID");
    }
  });
  await test("Reclaim source identity, scope, amount, prior reclaim and deterministic IDs are checked before writes", async () => {
    for (const mutate of [
      (f, row) => f.docs.delete(row.sourceOriginalRewardPath),
      (f, row) => { f.docs.get(row.sourceOriginalRewardPath).uid = "other-student"; },
      (f, row) => { f.docs.get(row.sourceOriginalRewardPath).type = "manual_adjust"; },
      (f, row) => { f.docs.get(row.sourceOriginalRewardPath).delta = 20; },
      (f, row) => { f.docs.get(row.sourceOriginalRewardPath).reclaimed = true; },
      (_, row) => { row.sourceOriginalRewardPath = "years/2025/semesters/2/point_transactions/reward-original"; },
      (_, row) => { row.sourceOriginalRewardPath += "/nested/forged"; },
      (_, row) => { row.sourceId = "forged"; }, (_, row) => { row.legacyHash = "f".repeat(64); },
      (_, row) => { row.ledgerEntryId = "forged"; },
      (f, row) => { f.docs.set(`${wis.WIS_LEDGER_COLLECTION}/duplicate-source`, clone(row)); },
    ]) {
      const f = setup(), row = reclaimFor(f); mutate(f, row);
      f.docs.set(`${wis.WIS_LEDGER_COLLECTION}/${row.ledgerEntryId}`, row);
      await rejectUnchanged(f, f.rebuild, "WIS_LEGACY_LEDGER_INVALID");
    }
  });
  console.log(JSON.stringify({ passed: true, checks, cases,
    coverage: "Actual exported Wis adapter, Gateway payload normalization and receipt replay; atomic in-memory store asserts zero-write failures and reads before writes",
    limitations: "No network, Auth/AppCheck, deployed Firestore rules/indexes or transaction contention exercised" }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
