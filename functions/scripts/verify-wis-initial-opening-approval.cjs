// Offline synthetic data only. No credentials, network or persistent writes.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const wis = require("../wisEconomy");
const reset = require("../wisInitialOpeningApproval");
const enrollment = require("../archiveEnrollment");
const migration = require("../wisLegacyMigration");
const gateway = require("../commandGateway");
const clone = value => structuredClone(value);
const semesterId = "2026-1", economyPath = `${wis.WIS_ECONOMY_COLLECTION}/${semesterId}`;
const controlPath = `${reset.CONTROL_COLLECTION}/${semesterId}`, planPath = `${reset.APPROVAL_COLLECTION}/synthetic-opening`;
const actor = { actorUid: "synthetic-admin", actorRole: "admin", actorEmail: "westoria28@gmail.com" };
const now = () => new Date("2026-09-12T00:00:00Z");
class Transaction {
  constructor(seed) { this.docs = clone(seed); this.writes = []; this.queries = []; }
  async get(path) {
    assert.equal(this.writes.length, 0, "every read precedes writes");
    return { path, exists: Object.hasOwn(this.docs, path), data: clone(this.docs[path] || null) };
  }
  async getAll(paths) { return Promise.all(paths.map(path => this.get(path))); }
  async query(collection, options) {
    assert.equal(this.writes.length, 0); this.queries.push({ collection, options });
    return Object.entries(this.docs).filter(([path, data]) => path.startsWith(`${collection}/`) &&
      !path.slice(collection.length + 1).includes("/") && options.filters.every(filter => filter.operator === "==" && data[filter.field] === filter.value))
      .slice(0, options.limit).map(([path, data]) => ({ path, exists: true, data: clone(data) }));
  }
  set(path, data, options) { this.writes.push(path); this.docs[path] = options?.merge ? { ...this.docs[path], ...clone(data) } : clone(data); }
  create(path, data) { assert.equal(Object.hasOwn(this.docs, path), false); this.set(path, data); }
}
function fixture(count = 2) {
  const seed = {
    [`semester_manifests/${semesterId}`]: { semesterId, status: "ACTIVE", revision: 7, bootstrapMode: "LEGACY_ACTIVE_BACKFILL" },
    "site_settings/semester_active": { semesterId, revision: 7 },
    "site_settings/student_maintenance": { enabled: true },
    [economyPath]: { semesterId, status: "ACTIVE_INITIALIZING", revision: 5, initialGrantAmount: 500,
      accountCount: count, initializedAccountCount: count, ledgerEntryCount: count, orderCount: 0, readOnly: false, provenance: "CURRENT" },
    // Intentionally nonzero legacy evidence is preserved without carrying it over.
    "years/2026/semesters/1/point_wallets/student-0": { uid: "student-0", balance: 9876 },
    "years/2026/semesters/1/point_transactions/old": { uid: "student-0", delta: 9876 },
  };
  const targets = [];
  for (let index = 0; index < count; index++) {
    const uid = `student-${index}`, enrollmentId = `enrollment-${index}`, classId = "class-a";
    const accountId = wis.accountIdFor(semesterId, uid), creationReceiptId = `receipt-batch-${Math.floor(index / 100)}`;
    const sourceId = `initial-${uid}`, grantLedgerEntryId = wis.ledgerIdFor(semesterId, accountId, "INITIAL_GRANT", sourceId);
    const grantReceiptId = `grant-receipt-${index}`;
    targets.push({ studentUid: uid, identityId: uid, enrollmentId, classId, accountId, creationReceiptId, grantLedgerEntryId, grantReceiptId });
    seed[`users/${uid}`] = { role: "student" };
    seed[`student_identities/${uid}`] = { studentUid: uid, accountStatus: "ACTIVE" };
    seed[`semester_enrollment_slots/${enrollment.buildEnrollmentSlotId(semesterId, uid)}`] = {
      studentUid: uid, semesterId, activeEnrollmentId: enrollmentId, status: "ACTIVE" };
    seed[`semester_enrollments/${enrollmentId}`] = { enrollmentId, semesterId, studentUid: uid, classId, enrollmentStatus: "ACTIVE" };
    seed[`semester_classes/${classId}`] = { semesterId, classId, status: "ACTIVE" };
    const entry = { schemaVersion: wis.WIS_SCHEMA_VERSION, policyVersion: wis.WIS_POLICY_VERSION, ledgerEntryId: grantLedgerEntryId,
      semesterId, accountId, studentUid: uid, type: "INITIAL_GRANT", delta: 500, balanceBefore: 0, balanceAfter: 500, sourceId,
      actorUid: actor.actorUid, actorRole: "admin", commandId: `grant-command-${index}`, receiptId: grantReceiptId, createdAt: now().toISOString() };
    const account = { schemaVersion: wis.WIS_SCHEMA_VERSION, policyVersion: wis.WIS_POLICY_VERSION,
      semesterId, accountId, studentUid: uid, enrollmentId, classId, revision: 2,
      ...wis.initialGrantTotalsFor(500),
      status: "ACTIVE", provenance: "CURRENT", readOnly: false, initialGrantLedgerEntryId: grantLedgerEntryId, recentLedgerEntries: [entry] };
    seed[`${wis.WIS_ACCOUNT_COLLECTION}/${accountId}`] = account;
    seed[`${wis.WIS_BALANCE_COLLECTION}/${accountId}`] = { ...account, revision: 1, initialGrantLedgerEntryId: null, recentLedgerEntries: [], ledgerRevision: 2 };
    seed[`${wis.WIS_RANKING_COLLECTION}/${accountId}`] = { schemaVersion: wis.WIS_SCHEMA_VERSION, policyVersion: wis.WIS_POLICY_VERSION,
      semesterId, accountId, studentUid: uid, enrollmentId, classId, balance: 500, rankEarnedTotal: 0, ledgerRevision: 2 };
    seed[`${wis.WIS_LEDGER_COLLECTION}/${grantLedgerEntryId}`] = entry;
    seed[`command_receipts/${grantReceiptId}`] = { status: "SUCCEEDED", checkpoint: "COMMITTED", commandType: "grantInitialWis",
      commandId: entry.commandId, actorUid: actor.actorUid, actorRole: "admin", actorEmail: actor.actorEmail, payloadHash: "a".repeat(64),
      sourceHash: createHash("sha256").update(`INITIAL_GRANT\n${sourceId}`).digest("hex"),
      target: { kind: "wis-ledger", id: grantLedgerEntryId, refs: [`${wis.WIS_LEDGER_COLLECTION}/${grantLedgerEntryId}`,
        `${wis.WIS_ACCOUNT_COLLECTION}/${accountId}`, `${wis.WIS_BALANCE_COLLECTION}/${accountId}`, `${wis.WIS_RANKING_COLLECTION}/${accountId}`] },
      result: { accountId, ledgerEntryId: grantLedgerEntryId, balance: 500, accountRevision: 2, type: "INITIAL_GRANT" } };
  }
  for (const receiptId of new Set(targets.map(target => target.creationReceiptId))) {
    const batch = targets.filter(target => target.creationReceiptId === receiptId);
    seed[`command_receipts/${receiptId}`] = { status: "SUCCEEDED", checkpoint: "COMMITTED", commandType: "createWisAccounts",
      actorUid: actor.actorUid, actorRole: "admin", actorEmail: actor.actorEmail, payloadHash: "a".repeat(64), sourceHash: "c".repeat(64),
      target: { kind: "wis-accounts", id: semesterId, refs: batch.flatMap(target => [
        `${wis.WIS_ACCOUNT_COLLECTION}/${target.accountId}`, `${wis.WIS_BALANCE_COLLECTION}/${target.accountId}`, `${wis.WIS_RANKING_COLLECTION}/${target.accountId}`]) },
      result: { semesterId, createdCount: batch.length, syncedCount: 0 } };
  }
  seed[planPath] = { schemaVersion: 1, planId: "synthetic-opening", policyVersion: reset.POLICY_VERSION,
    openingPolicy: "FRESH_INITIAL_GRANT", carryOverPolicy: "NONE", initialGrantAmount: 500, totalInitialGrantAmount: count * 500,
    legacySourcePolicy: "PRESERVE_UNCHANGED", projectId: reset.PRODUCTION_PROJECT, semesterId,
    adminUid: actor.actorUid, adminEmail: actor.actorEmail, status: "APPROVED", expiresAtIso: "2026-09-13T00:00:00Z",
    expectedSemesterRevision: 7, expectedEconomyRevision: 5, backupHash: "b".repeat(64), targetCount: count, targets };
  seal(seed); return seed;
}
function seal(seed) {
  seed[planPath].exactPlanHash = reset.hashApprovalPlan(seed[planPath]);
  seed[controlPath] = { initialOpeningPlanId: seed[planPath].planId, initialOpeningPlanHash: seed[planPath].exactPlanHash };
}
const apply = (tx, options = {}) => wis.createWisCommandAdapter({ projectId: reset.PRODUCTION_PROJECT, now, ...options }).apply({
  transaction: tx, commandType: "transitionWisEconomy", commandId: "synthetic-open", receiptId: "synthetic-open-receipt", actor,
  timestamp: now().toISOString(), payload: { semesterId, expectedSemesterRevision: 7, expectedEconomyRevision: 5, targetStatus: "ACTIVE_OPEN", reason: "기존 잔액 이월 없이 모두 초기 500위스 지급" } });
let checks = 0;
const test = async (name, run) => { await run(); checks++; console.log(`PASS ${name}`); };
const rejected = async (name, mutate, reason, reseal = false) => test(name, async () => {
  const seed = fixture(); mutate(seed); if (reseal) seal(seed); const tx = new Transaction(seed);
  await assert.rejects(apply(tx), error => error.details?.reason === reason);
  assert.equal(tx.writes.length, 0); assert.deepEqual(tx.docs, seed);
});
(async () => {
  await test("all 324 synthetic students open with exactly 162000 initial Wis; legacy remains unchanged", async () => {
    const seed = fixture(324), tx = new Transaction(seed); await apply(tx);
    assert.deepEqual(tx.writes, [economyPath]);
    assert.equal(tx.docs[economyPath].status, "ACTIVE_OPEN"); assert.equal(tx.docs[economyPath].revision, 6);
    assert.equal(tx.docs[economyPath].initializedAccountCount, 324);
    assert.equal(tx.docs[economyPath].initialOpeningTotalGrantAmount, 162000);
    assert.deepEqual(wis.initialGrantTotalsFor(500), { balance: 500, earnedTotal: 500, rankEarnedTotal: 0, spentTotal: 0, adjustedTotal: 0 });
    assert.deepEqual(Object.fromEntries(Object.keys(reset.bindingFor(seed[planPath])).map(key => [key, tx.docs[economyPath][key]])), reset.bindingFor(seed[planPath]));
    for (const [path, data] of Object.entries(seed).filter(([path]) => path !== economyPath)) assert.deepEqual(tx.docs[path], data);
    assert(tx.queries.every(query => query.options.limit <= 1001));
  });
  await rejected("production legacy backfill requires server approval", seed => { delete seed[controlPath]; }, "WIS_INITIAL_OPENING_APPROVAL_REQUIRED");
  await rejected("legacy backfill cannot bypass approval by changing initial grant", seed => {
    delete seed[controlPath]; seed[economyPath].initialGrantAmount = 0;
  }, "WIS_INITIAL_OPENING_APPROVAL_REQUIRED");
  await test("normal new production semester 500 initial grant retains its existing OPEN flow", async () => {
    for (const bootstrapMode of [undefined, "NEW_SEMESTER"]) {
      const seed = fixture(); delete seed[planPath]; delete seed[controlPath];
      if (bootstrapMode === undefined) delete seed[`semester_manifests/${semesterId}`].bootstrapMode;
      else seed[`semester_manifests/${semesterId}`].bootstrapMode = bootstrapMode;
      seed["site_settings/student_maintenance"].enabled = false;
      const tx = new Transaction(seed); await apply(tx);
      assert.equal(tx.docs[economyPath].status, "ACTIVE_OPEN"); assert.equal(tx.docs[economyPath].initialGrantAmount, 500);
      assert.equal(tx.docs[economyPath].initializedAccountCount, 2); assert.equal(Object.hasOwn(tx.docs[economyPath], "initialOpeningPlanId"), false);
      assert.deepEqual(tx.writes, [economyPath]);
    }
  });
  await rejected("plan edit without reapproval fails exact hash", seed => { seed[planPath].backupHash = "f".repeat(64); }, "WIS_INITIAL_OPENING_APPROVAL_INVALID");
  for (const [field, value] of [["projectId", "foreign"], ["semesterId", "2026-2"], ["adminUid", "other-admin"],
    ["adminEmail", "other@example.com"], ["status", "DRAFT"], ["expiresAtIso", now().toISOString()], ["openingPolicy", "CARRY_BALANCE"],
    ["carryOverPolicy", "ALL"], ["initialGrantAmount", 0], ["totalInitialGrantAmount", 1001],
    ["legacySourcePolicy", "DELETE"], ["policyVersion", "relaxed"], ["backupHash", ""], ["targetCount", 1],
    ["expectedSemesterRevision", 8], ["expectedEconomyRevision", 6]]) {
    await rejected(`approval binds ${field}`, seed => { seed[planPath][field] = value; }, "WIS_INITIAL_OPENING_APPROVAL_INVALID", true);
  }
  await rejected("duplicate student target rejected", seed => { seed[planPath].targets[1] = clone(seed[planPath].targets[0]); }, "WIS_INITIAL_OPENING_APPROVAL_INVALID", true);
  await rejected("economy cannot override the retained exact approval", seed => {
    seed[economyPath].initialOpeningPlanId = "other"; seed[economyPath].initialOpeningPlanHash = "f".repeat(64);
  }, "WIS_INITIAL_OPENING_APPROVAL_REFERENCE_MISMATCH");
  for (const [field, value] of [["initialGrantAmount", 0], ["accountCount", 1], ["initializedAccountCount", 1],
    ["ledgerEntryCount", 1], ["orderCount", 1], ["legacyMigrationCount", 1], ["unresolvedLegacyIssueCount", 1]]) {
    await rejected(`initial grant policy rejects economy ${field}`, seed => { seed[economyPath][field] = value; }, "WIS_INITIAL_OPENING_ECONOMY_INCOMPLETE");
  }
  for (const mutate of [seed => { seed["site_settings/semester_active"].semesterId = "2026-2"; },
    seed => { seed["site_settings/student_maintenance"].enabled = false; }])
    await rejected("active semester and maintenance required", mutate, "WIS_INITIAL_OPENING_ACTIVE_SCOPE_REQUIRED");
  for (const collection of [wis.WIS_ACCOUNT_COLLECTION, wis.WIS_BALANCE_COLLECTION, wis.WIS_RANKING_COLLECTION]) {
    await rejected(`${collection} missing target blocks OPEN`, seed => { delete seed[`${collection}/${seed[planPath].targets[0].accountId}`]; }, "WIS_INITIAL_OPENING_TARGET_SET_MISMATCH");
    await rejected(`${collection} orphan blocks OPEN`, seed => { seed[`${collection}/foreign`] = { semesterId, accountId: "foreign" }; }, "WIS_INITIAL_OPENING_TARGET_SET_MISMATCH");
  }
  await rejected("omitted active student blocks OPEN even if plan/account counters match", seed => {
    seed["semester_enrollments/unplanned"] = { semesterId, enrollmentId: "unplanned", studentUid: "unplanned", enrollmentStatus: "ACTIVE" };
  }, "WIS_INITIAL_OPENING_TARGET_SET_MISMATCH");
  await rejected("approved user omitted from both plan and enrollment still blocks OPEN", seed => {
    seed["users/unplanned"] = { role: "student", registrationApprovalStatus: "APPROVED" };
    seed["student_identities/unplanned"] = { studentUid: "unplanned", accountStatus: "ACTIVE" };
  }, "WIS_INITIAL_OPENING_TARGET_SET_MISMATCH");
  await test("pending and rejected profiles are excluded without deleting their original data", async () => {
    const seed = fixture();
    for (const status of ["PENDING", "REJECTED"]) {
      seed[`users/${status}`] = { role: "student", registrationApprovalStatus: status };
      seed[`years/2026/semesters/1/point_wallets/${status}`] = { uid: status, balance: 12345 };
    }
    const tx = new Transaction(seed); await apply(tx);
    for (const [path, data] of Object.entries(seed).filter(([path]) => path !== economyPath)) assert.deepEqual(tx.docs[path], data);
  });
  for (const mutate of [seed => { seed["users/student-0"].registrationApprovalStatus = "PENDING"; },
    seed => { seed["users/student-0"].role = "teacher"; }])
    await rejected("approved target must remain a student", mutate, "WIS_INITIAL_OPENING_TARGET_SET_MISMATCH");
  for (const mutate of [seed => { delete seed["student_identities/student-0"]; },
    seed => { seed["student_identities/student-0"].studentUid = "foreign"; },
    seed => { seed["student_identities/student-0"].accountStatus = "DISABLED"; },
    seed => { seed["semester_enrollments/enrollment-0"].classId = "foreign"; },
    seed => { seed["semester_classes/class-a"].status = "INACTIVE"; }])
    await rejected("student approval identity and enrollment must match", mutate, "WIS_INITIAL_OPENING_ENROLLMENT_INVALID");
  for (const field of ["balance", "earnedTotal", "spentTotal", "adjustedTotal", "rankEarnedTotal"]) {
    await rejected(`incorrect ${field} never gets repaired by OPEN`, seed => {
      seed[`${wis.WIS_ACCOUNT_COLLECTION}/${seed[planPath].targets[0].accountId}`][field] = 1;
    }, "WIS_INITIAL_OPENING_ACCOUNT_INVALID");
  }
  for (const [field, value] of [["revision", 3], ["initialGrantLedgerEntryId", "old-grant"], ["legacyMigrationId", "old-migration"], ["recentLedgerEntries", []]]) {
    await rejected(`existing account activity ${field} rejected`, seed => {
      seed[`${wis.WIS_ACCOUNT_COLLECTION}/${seed[planPath].targets[0].accountId}`][field] = value;
    }, "WIS_INITIAL_OPENING_ACCOUNT_INVALID");
  }
  await rejected("extra ledger blocks OPEN even with correct counters", seed => { seed[`${wis.WIS_LEDGER_COLLECTION}/old`] = { semesterId }; }, "WIS_INITIAL_OPENING_LEDGER_INVALID");
  await rejected("existing order blocks OPEN even with zero counter", seed => { seed[`${wis.WIS_ORDER_COLLECTION}/old`] = { semesterId }; }, "WIS_INITIAL_OPENING_ACTIVITY_EXISTS");
  for (const mutate of [seed => { delete seed["command_receipts/receipt-batch-0"]; },
    seed => { seed["command_receipts/receipt-batch-0"].status = "FAILED"; },
    seed => { seed["command_receipts/receipt-batch-0"].actorUid = "other-admin"; },
    seed => { seed["command_receipts/receipt-batch-0"].result.createdCount = 1; },
    seed => { seed["command_receipts/receipt-batch-0"].target.refs.pop(); }])
    await rejected("committed complete account-creation receipts required", mutate, "WIS_INITIAL_OPENING_RECEIPT_INVALID");
  for (const [field, value] of [["type", "GRANT"], ["delta", 1000], ["balanceBefore", 500], ["balanceAfter", 1000],
    ["sourceId", "different"], ["actorUid", "other"], ["receiptId", "other"], ["studentUid", "other"]]) {
    await rejected(`initial grant ledger binds ${field}`, seed => {
      seed[`${wis.WIS_LEDGER_COLLECTION}/${seed[planPath].targets[0].grantLedgerEntryId}`][field] = value;
    }, "WIS_INITIAL_OPENING_LEDGER_INVALID");
  }
  for (const mutate of [seed => { delete seed["command_receipts/grant-receipt-0"]; },
    seed => { seed["command_receipts/grant-receipt-0"].status = "FAILED"; },
    seed => { seed["command_receipts/grant-receipt-0"].commandType = "grantWis"; },
    seed => { seed["command_receipts/grant-receipt-0"].sourceHash = "f".repeat(64); },
    seed => { seed["command_receipts/grant-receipt-0"].result.balance = 1000; },
    seed => { seed["command_receipts/grant-receipt-0"].target.refs.pop(); }])
    await rejected("initial grant requires its committed complete receipt", mutate, "WIS_INITIAL_OPENING_GRANT_RECEIPT_INVALID");
  await rejected("writer fence remains the first blocking boundary", seed => {
    seed[`wis_legacy_migration_controls/${semesterId}`] = { enabled: true };
  }, "WIS_MIGRATION_WRITES_BLOCKED");
  await test("production legacy migration stays forbidden", async () => {
    await assert.rejects(migration.createLegacyWisMigrationAdapter({ projectId: reset.PRODUCTION_PROJECT }).apply({}),
      error => error.details.reason === "WIS_MIGRATION_PROJECT_FORBIDDEN");
  });
  await test("actual Gateway creates empty accounts, grants 500 exactly once, then atomically opens and replays", async () => {
    let persisted = fixture(); const records = [];
    for (const path of Object.keys(persisted).filter(path => [wis.WIS_ACCOUNT_COLLECTION, wis.WIS_BALANCE_COLLECTION,
      wis.WIS_RANKING_COLLECTION, wis.WIS_LEDGER_COLLECTION, "command_receipts"].some(collection => path.startsWith(`${collection}/`)))) delete persisted[path];
    Object.assign(persisted[economyPath], { accountCount: 0, revision: 1, initializedAccountCount: 0, ledgerEntryCount: 0 });
    const adapter = wis.createWisCommandAdapter({ projectId: reset.PRODUCTION_PROJECT, now });
    const store = { get: async path => new Transaction(persisted).get(path), runTransaction: async callback => {
      const tx = new Transaction(persisted); records.push(tx); const result = await callback(tx); persisted = tx.docs; return result;
    } };
    const core = gateway.createCommandGatewayCore({ store, projectId: reset.PRODUCTION_PROJECT,
      serverTimestamp: () => now().toISOString(), concreteTimestamp: () => now().toISOString(),
      assertSession: async () => ({ uid: actor.actorUid, email: actor.actorEmail, sessionId: "synthetic-session", revision: 1, schemaVersion: 2 }),
      authorizeCommand: async () => actor,
      commandAdapters: { createWisAccounts: adapter, grantInitialWis: adapter, transitionWisEconomy: adapter } });
    const execute = (commandType, commandId, payload) => core.execute({ auth: { uid: actor.actorUid }, data: { commandType, commandId,
      payload: { semesterId, expectedSemesterRevision: 7, ...payload } } });
    const createId = "12345678-1234-4123-8123-123456789012", openId = "12345678-1234-4123-8123-123456789013";
    await execute("createWisAccounts", createId, { expectedEconomyRevision: 1, enrollmentIds: ["enrollment-0", "enrollment-1"], reason: "합성 계좌 생성" });
    const receiptId = gateway.buildReceiptId(actor.actorUid, "createWisAccounts", createId);
    persisted[planPath].targets.forEach(target => { target.creationReceiptId = receiptId; });
    for (let index = 0; index < persisted[planPath].targets.length; index++) {
      const target = persisted[planPath].targets[index], grantId = `12345678-1234-4123-8123-12345678902${index}`;
      const grantPayload = { expectedEconomyRevision: 2, accountId: target.accountId, expectedAccountRevision: 1, amount: 500,
        sourceId: `initial-${target.studentUid}`, reason: "합성 초기 500위스 지급" };
      assert.equal(persisted[`${wis.WIS_ACCOUNT_COLLECTION}/${target.accountId}`].balance, 0);
      const granted = await execute("grantInitialWis", grantId, grantPayload), beforeReplay = clone(persisted);
      const replay = await execute("grantInitialWis", grantId, grantPayload);
      assert.equal(replay.replayed, true); assert.deepEqual(replay.result, granted.result); assert.deepEqual(persisted, beforeReplay);
      await assert.rejects(execute("grantInitialWis", `12345678-1234-4123-8123-12345678903${index}`,
        { ...grantPayload, expectedAccountRevision: 2 }), error => error.details.reason === "WIS_INITIAL_GRANT_ALREADY_APPLIED");
      assert.deepEqual(persisted, beforeReplay); assert.equal(records.at(-1).writes.length, 0);
      persisted[planPath].targets[index].grantLedgerEntryId = granted.result.ledgerEntryId;
      persisted[planPath].targets[index].grantReceiptId = gateway.buildReceiptId(actor.actorUid, "grantInitialWis", grantId);
    }
    persisted[planPath].expectedEconomyRevision = 2; seal(persisted);
    const payload = { expectedEconomyRevision: 2, targetStatus: "ACTIVE_OPEN", reason: "합성 초기 500위스 지급 완료" };
    const first = await execute("transitionWisEconomy", openId, payload);
    assert.equal(first.replayed, false); assert.equal(persisted[economyPath].status, "ACTIVE_OPEN");
    assert.equal(records.at(-1).writes.length, 3, "economy plus Gateway receipt and audit commit together");
    persisted[`wis_legacy_migration_controls/${semesterId}`] = { writesBlocked: true };
    delete persisted[planPath]; const before = clone(persisted);
    const replay = await execute("transitionWisEconomy", openId, payload);
    assert.equal(replay.replayed, true); assert.deepEqual(replay.result, first.result);
    assert.deepEqual(persisted, before); assert.equal(records.at(-1).writes.length, 0);
  });
  console.log(`PASS wis initial opening approval: ${checks} scenarios; offline synthetic checks only`);
})().catch(error => { console.error(error); process.exitCode = 1; });
