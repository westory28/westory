// In-memory native-transaction contract tests. No Firebase initialization/network.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const wis = require("../wisEconomy");
const legacy = require("../historyDictionaryRewardOrigin");
const { createHistoryDictionaryWisReward } = require("../historyDictionaryWisReward");
const sha256 = value => createHash("sha256").update(value).digest("hex");
const uid = "student-a", day = "2026-09-11";
const activeScope = { year: "2026", semester: "2", semesterId: "2026-2" };
const policy = { autoRewardEnabled: true, rewardPolicy: { historyDictionary: {
  enabled: true, amount: 50, maxDailyClaims: 4, minDefinitionLength: 20,
} } };
const times = { timestamp: { serverTime: true }, concreteTimestamp: "2026-09-11T00:00:00Z" };
let checks = 0;
const cases = [];
const eq = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const ok = value => { assert.ok(value); checks++; };
const denied = async task => { await assert.rejects(task, error => error.code === "failed-precondition"); checks++; };
const test = async (name, task) => { try { await task(); cases.push(name); } catch (error) { error.message = `${name}: ${error.message}`; throw error; } };
const clone = value => structuredClone(value);
// Exercise the actual private rebuild reducer against the ledgers this writer
// produces. Only VM I/O is isolated; no duplicate accounting implementation.
const wisSource = readFileSync(resolve(__dirname, "../wisEconomy.js"), "utf8");
const totalsStart = wisSource.indexOf("const zeroAccountTotals =");
const totalsEnd = wisSource.indexOf("const assertLegacyLedgerProvenance =", totalsStart);
assert.ok(totalsStart >= 0 && totalsEnd > totalsStart);
const rebuiltTotals = runInNewContext(`${wisSource.slice(totalsStart, totalsEnd)}\ntotalsFromLedgerEntries`, {
  fail: (code, message, reason) => { throw Object.assign(new Error(message), { code, details: { reason } }); },
});
const migration = require("../wisLegacyMigration");
const { createHistoryDictionaryLegacyReward } = require("../historyDictionaryLegacyReward");
const seedMigration = (f, scope = activeScope, count = 1) => {
  const paths = migration.pathsFor(scope.semesterId, uid), origins = [];
  f.seedScope(scope);
  for (let n = 0; n < count; n++) {
    const origin = { ledgerKind: "legacy-point", uid, year: scope.year, semester: scope.semester, termId: `old-${n}`,
      transactionId: legacy.getRewardTransactionId(uid, `old-${n}`) };
    origins.push(origin);
    f.data.set(`${paths.transactions}/${origin.transactionId}`, { uid, type: "history_dictionary", sourceId: legacy.getRewardSourceId(origin.termId),
      delta: 50, balanceAfter: 50 * (n + 1), targetDate: day });
  }
  const totals = { balance: count * 50, earnedTotal: count * 50, rankEarnedTotal: count * 50, spentTotal: 0, adjustedTotal: 0 };
  f.data.set(paths.wallet, { uid, ...totals });
  const source = migration.evaluateLegacyWisSource({ semesterId: scope.semesterId, studentUid: uid,
    wallet: { path: paths.wallet, exists: true, data: f.data.get(paths.wallet) },
    transactions: [...f.data].filter(([path]) => path.startsWith(`${paths.transactions}/`)).map(([path, data]) => ({ path, data, exists: true })), orders: [] });
  eq(source.status, "READY");
  f.data.set(paths.marker, { schemaVersion: 1, policyVersion: migration.POLICY_VERSION, status: "MIGRATED", migrationId: paths.migrationId,
    semesterId: scope.semesterId, studentUid: uid, accountId: paths.accountId, openingLedgerEntryId: paths.openingId, legacyHash: source.legacyHash,
    totals: clone(totals), sourceRefs: source.sourceRefs, sourceTransactionCount: count, sourceOrderCount: 0 });
  f.data.set(paths.opening, { schemaVersion: wis.WIS_SCHEMA_VERSION, policyVersion: wis.WIS_POLICY_VERSION,
    ledgerEntryId: paths.openingId, semesterId: scope.semesterId, studentUid: uid, accountId: paths.accountId, type: "LEGACY_OPENING",
    sourceId: paths.migrationId, legacyHash: source.legacyHash, delta: totals.balance, balanceBefore: 0, balanceAfter: totals.balance, openingTotals: clone(totals) });
  Object.assign(f.data.get(paths.account), totals, { legacyMigrationId: paths.migrationId });
  return { paths, origins };
};
const prepareBridge = async (f, origins, canonicalOrigins = [], change) => {
  const forbidden = () => { throw new Error("Migrated sources must not use legacy wallet mutation dependencies"); };
  const service = createHistoryDictionaryLegacyReward({ db: f.db, loadPolicy: forbidden, ensureWallet: forbidden,
    getCurrentRankEarnedTotal: forbidden, buildWalletBase: forbidden, buildWalletRankState: forbidden, createTransactionPayload: forbidden });
  const tx = f.transaction(), wordData = { uid, termId: "latest-business-name", rewardOrigins: origins, wisRewardOrigins: canonicalOrigins };
  const legacyPlan = service.plan(await service.read(tx, { uid, wordData, profile: {}, operation: "reclaim", actorUid: "teacher" }), times);
  const input = f.intent({ operation: "reclaim", termId: wordData.termId, wordData, legacyOrigins: origins, migratedLegacyReclaims: legacyPlan.migratedLegacyReclaims });
  if (change) change(input);
  const plan = f.service.plan(await f.service.read(tx, input), times);
  eq(tx.writes, []); eq(legacyPlan.mutations, []);
  return { tx, plan, legacyPlan, input, commit: () => { service.apply(tx, legacyPlan); f.service.apply(tx, plan); tx.commit(); } };
};
const fixture = () => {
  const data = new Map(), queries = [], reads = [];
  const db = {
    doc: path => ({ path }),
    collection: path => {
      const query = { path, filters: [], maximum: Infinity,
        where(field, operator, value) { assert.equal(operator, "=="); this.filters.push([field, value]); return this; },
        limit(maximum) { this.maximum = maximum; return this; } };
      return query;
    },
  };
  const service = createHistoryDictionaryWisReward({ db, wisEconomy: wis, sha256,
    loadPolicy: async (transaction, year, semester) => (await transaction.get(db.doc(`years/${year}/semesters/${semester}/point_policies/current`))).data(),
    getKstDateKey: () => day });
  const seedScope = (scope = activeScope, owner = uid, balance = 500) => {
    const accountId = wis.accountIdFor(scope.semesterId, owner);
    data.set(`semester_manifests/${scope.semesterId}`, { ...scope, status: "ACTIVE" });
    data.set(`${wis.WIS_ECONOMY_COLLECTION}/${scope.semesterId}`, { semesterId: scope.semesterId, status: "ACTIVE_OPEN", readOnly: false, ledgerEntryCount: 10 });
    data.set(`${wis.WIS_ACCOUNT_COLLECTION}/${accountId}`, { schemaVersion: wis.WIS_SCHEMA_VERSION, policyVersion: wis.WIS_POLICY_VERSION,
      accountId, semesterId: scope.semesterId, studentUid: owner, status: "ACTIVE", readOnly: false, revision: 2,
      balance, earnedTotal: 1000, rankEarnedTotal: 1000, spentTotal: 500, adjustedTotal: 1000, recentLedgerEntries: [],
      displayName: "학생", classId: "class-one", grade: "2", classNumber: "1" });
    data.set(`years/${scope.year}/semesters/${scope.semester}/point_policies/current`, clone(policy));
    return accountId;
  };
  const transaction = () => {
    const writes = [];
    return {
      writes,
      async get(ref) {
        assert.equal(writes.length, 0, "No reads after a write"); reads.push(ref.path);
        if (ref.filters) {
          queries.push({ path: ref.path, filters: clone(ref.filters), limit: ref.maximum });
          const docs = [...data].filter(([path, value]) => path.startsWith(`${ref.path}/`) && !path.slice(ref.path.length + 1).includes("/") &&
            ref.filters.every(([field, expected]) => value[field] === expected)).slice(0, ref.maximum);
          return { size: docs.length, docs: docs.map(([path, value]) => ({ ref: { path }, data: () => clone(value) })) };
        }
        return { exists: data.has(ref.path), data: () => clone(data.get(ref.path)) };
      },
      create(ref, value) { writes.push({ operation: "create", path: ref.path, data: clone(value) }); },
      set(ref, value, options) { assert.equal(options.merge, true); writes.push({ operation: "set", path: ref.path, data: clone(value) }); },
      commit() {
        for (const write of writes) if (write.operation === "create") assert.equal(data.has(write.path), false, "create precondition");
        for (const write of writes) data.set(write.path, write.operation === "set" ? { ...data.get(write.path), ...write.data } : write.data);
      },
    };
  };
  const intent = (overrides = {}) => ({ operation: "award", uid, termId: "term-one", definition: "역사적 사건의 배경과 전개 과정을 설명하는 충분히 긴 뜻풀이입니다.",
    word: "역사 용어", commandId: "command-one", receiptId: "receipt-one", actorUid: uid, activeScope, legacyOrigins: [], wordData: {}, ...overrides });
  const prepare = async input => { const tx = transaction(); const plan = service.plan(await service.read(tx, input || intent()), times); eq(tx.writes.length, 0); return { tx, plan }; };
  const award = async (input = intent()) => { const prepared = await prepare(input); service.apply(prepared.tx, prepared.plan); prepared.tx.commit(); return prepared.plan; };
  seedScope();
  return { data, queries, reads, db, service, seedScope, transaction, intent, prepare, award };
};

(async () => {
  await test("Canonical award updates one ledger/account/projections/economy with W7 IDs and totals", async () => {
    const f = fixture(), plan = await f.award();
    eq(plan.result.awarded, true); eq(plan.result.amount, 50); eq(plan.mutations.length, 5);
    const origin = plan.wisRewardOrigins[0], account = f.data.get(`${wis.WIS_ACCOUNT_COLLECTION}/${origin.accountId}`);
    eq(origin.accountId, wis.accountIdFor("2026-2", uid));
    eq(origin.ledgerEntryId, `wisled_${sha256(["2026-2", origin.accountId, "GRANT", "history-dictionary:term-one"].join("\n"))}`);
    eq([account.balance, account.earnedTotal, account.rankEarnedTotal, account.spentTotal, account.adjustedTotal, account.revision], [550, 1050, 1050, 500, 1050, 3]);
    eq(account.recentLedgerEntries[0].createdAt, times.concreteTimestamp);
    eq(f.data.get(`${wis.WIS_BALANCE_COLLECTION}/${origin.accountId}`).ledgerRevision, 3);
    eq(f.data.get(`${wis.WIS_RANKING_COLLECTION}/${origin.accountId}`).rankEarnedTotal, 1050);
    eq(f.data.get(`${wis.WIS_ECONOMY_COLLECTION}/2026-2`).ledgerEntryCount, 11);
    ok(plan.mutations.every(write => !write.path.includes("point_wallets") && !write.path.includes("point_transactions")));
    eq(f.queries.length, 2); eq(f.queries.map(query => query.limit), [4, 4]);
    const again = await f.prepare(f.intent({ wordData: { wisRewardOrigins: plan.wisRewardOrigins } }));
    eq(again.plan.result.blockedReason, "duplicate_source"); eq(again.plan.mutations.length, 0);
    const missingWord = await f.prepare(f.intent({ commandId: "another-command", receiptId: "another-receipt" }));
    eq(missingWord.plan.wisRewardOrigins, plan.wisRewardOrigins); eq(missingWord.plan.mutations.length, 0);
  });
  await test("Legacy verified same-semester origins fence reaward even after reclaim; other semester does not", async () => {
    for (const reclaimed of [false, true]) {
      const f = fixture(), origin = { ledgerKind: "legacy-point", uid, termId: "old-name", year: "2026", semester: "2",
        transactionId: legacy.getRewardTransactionId(uid, "old-name") };
      const path = `years/2026/semesters/2/point_transactions/${origin.transactionId}`;
      f.data.set(path, { uid, type: "history_dictionary", sourceId: legacy.getRewardSourceId(origin.termId), delta: 50, reclaimed });
      if (reclaimed) f.data.set(`${path}_reclaim`, { uid, type: "history_dictionary_reclaim", sourceId: legacy.getRewardSourceId(origin.termId), delta: -50 });
      const { plan } = await f.prepare(f.intent({ legacyOrigins: [origin] }));
      eq(plan.result.blockedReason, "duplicate_source"); eq(plan.mutations, []);
      await denied(() => f.prepare(f.intent({ legacyOrigins: [{ ...origin, uid: "another" }] })));
      const old = { ...origin, semester: "1" }, oldPath = path.replace("semesters/2", "semesters/1");
      f.data.set(oldPath, { ...f.data.get(path), reclaimed: false });
      eq((await f.prepare(f.intent({ legacyOrigins: [old] }))).plan.result.awarded, true);
    }
  });
  await test("Daily cap counts legacy and canonical grants, including reclaimed claims, scoped to owner and day", async () => {
    const f = fixture();
    for (let n = 0; n < 3; n++) f.data.set(`years/2026/semesters/2/point_transactions/old-${n}`, { uid, type: "history_dictionary", targetDate: day, reclaimed: true });
    const first = await f.award(); eq(first.result.claimCount, 4);
    const second = await f.prepare(f.intent({ termId: "term-two" })); eq(second.plan.result.blockedReason, "daily_max_reached"); eq(second.plan.mutations.length, 0);
    const other = fixture();
    other.data.set("years/2026/semesters/1/point_transactions/old", { uid, type: "history_dictionary", targetDate: day });
    other.data.set("years/2026/semesters/2/point_transactions/other", { uid: "other", type: "history_dictionary", targetDate: day });
    other.data.set("years/2026/semesters/2/point_transactions/yesterday", { uid, type: "history_dictionary", targetDate: "2026-09-10" });
    eq((await other.award()).result.claimCount, 1);
  });
  await test("Existing reward policy flags, definition quality and integer safety", async () => {
    for (const [patch, definition, reason] of [
      [{ autoRewardEnabled: false }, null, "policy_disabled"],
      [{ rewardPolicy: { historyDictionary: { ...policy.rewardPolicy.historyDictionary, enabled: false } } }, null, "policy_disabled"],
      [{}, "한 글 씩", "definition_too_short"],
      [{ rewardPolicy: { historyDictionary: { ...policy.rewardPolicy.historyDictionary, amount: 0 } } }, null, "policy_disabled"],
    ]) {
      const f = fixture(); f.data.set("years/2026/semesters/2/point_policies/current", { ...clone(policy), ...patch });
      eq((await f.prepare(f.intent(definition ? { definition } : {}))).plan.result.blockedReason, reason);
    }
    for (const amount of [NaN, Infinity, 1.5]) {
      const f = fixture(); f.data.get("years/2026/semesters/2/point_policies/current").rewardPolicy.historyDictionary.amount = amount;
      await denied(() => f.prepare());
    }
  });
  await test("Original account reversal is deterministic and exactly once; source and business rename independent", async () => {
    const f = fixture(), original = await f.award();
    const request = f.intent({ operation: "reclaim", termId: "renamed", activeScope: { year: "2099", semester: "1", semesterId: "2099-1" },
      wordData: { uid, termId: "renamed", year: "2099", semester: "1", requestOriginTermId: "unrelated", wisRewardOrigins: original.wisRewardOrigins } });
    const { tx, plan } = await f.prepare(request); f.service.apply(tx, plan); tx.commit();
    eq(plan.result.reclaimed, true); eq(plan.result.amount, 50); eq(plan.wisRewardOrigins, original.wisRewardOrigins);
    const entry = plan.mutations.find(write => write.operation === "create").data;
    eq(entry.type, "REVERSAL"); eq(entry.activityType, "history_dictionary_reclaim"); eq(entry.sourceId, original.wisRewardOrigins[0].ledgerEntryId);
    eq(entry.targetDate, day); eq([entry.delta, entry.reversedDelta], [-50, 50]);
    const account = f.data.get(`${wis.WIS_ACCOUNT_COLLECTION}/${original.wisRewardOrigins[0].accountId}`);
    eq([account.balance, account.earnedTotal, account.rankEarnedTotal, account.spentTotal, account.adjustedTotal], [500, 1000, 1000, 500, 1000]);
    eq((await f.prepare(request)).plan.mutations.length, 0);
    eq((await f.prepare(f.intent())).plan.result.blockedReason, "duplicate_source");
    f.data.get(`${wis.WIS_LEDGER_COLLECTION}/${entry.ledgerEntryId}`).delta = -49;
    await denied(() => f.prepare(request));
  });
  await test("Multiple origins aggregate per account and semester, preserving every grant", async () => {
    const f = fixture(), first = await f.award(), second = await f.award(f.intent({ termId: "second-source" }));
    const previousScope = { year: "2025", semester: "2", semesterId: "2025-2" }; f.seedScope(previousScope);
    const third = await f.award(f.intent({ activeScope: previousScope, termId: "third-source" }));
    const origins = [...first.wisRewardOrigins, ...second.wisRewardOrigins, ...third.wisRewardOrigins];
    const request = f.intent({ operation: "reclaim", wordData: { wisRewardOrigins: origins } });
    const { tx, plan } = await f.prepare(request);
    eq(plan.result.amount, 150); eq(plan.mutations.filter(write => write.operation === "create").length, 3);
    eq(plan.mutations.filter(write => write.path.startsWith(`${wis.WIS_ACCOUNT_COLLECTION}/`)).length, 2);
    f.service.apply(tx, plan); tx.commit();
    const currentAccount = f.data.get(`${wis.WIS_ACCOUNT_COLLECTION}/${origins[0].accountId}`);
    eq(currentAccount.balance, 500); eq(currentAccount.revision, 6); eq(currentAccount.recentLedgerEntries.length, 4);
    eq(f.data.get(`${wis.WIS_BALANCE_COLLECTION}/${origins[0].accountId}`).ledgerRevision, 6);
    eq(f.data.get(`${wis.WIS_ECONOMY_COLLECTION}/2026-2`).ledgerEntryCount, 14);
    eq((await f.prepare(request)).plan.mutations.length, 0);
  });
  await test("Malformed origins, cross-owner ledger and source corruption fail closed without writes", async () => {
    const f = fixture(), initial = await f.award(), origin = initial.wisRewardOrigins[0];
    for (const raw of [null, {}, [origin, origin], [{ ...origin, uid: "other" }], [{ ...origin, ledgerKind: "legacy-point" }],
      [{ ...origin, year: "2099" }], [{ ...origin, accountId: "other" }], [{ ...origin, ledgerEntryId: "other" }], [{ ...origin, unknown: true }]])
      await denied(() => f.prepare(f.intent({ operation: "reclaim", wordData: { wisRewardOrigins: raw } })));
    const path = `${wis.WIS_LEDGER_COLLECTION}/${origin.ledgerEntryId}`, clean = clone(f.data.get(path));
    for (const [key, value] of Object.entries({ studentUid: "other", accountId: "other", semesterId: "2026-1", ledgerEntryId: "other",
      type: "ADJUST", sourceId: "other", activityType: "manual_adjust", actorUid: uid, actorRole: "teacher",
      delta: 49, balanceBefore: -1, balanceAfter: 1, commandId: "", receiptId: "", targetDate: "", schemaVersion: 999, policyVersion: "unknown" })) {
      f.data.set(path, { ...clean, [key]: value });
      await denied(() => f.prepare(f.intent({ operation: "reclaim", wordData: { wisRewardOrigins: [origin] } })));
    }
    f.data.delete(path);
    await denied(() => f.prepare(f.intent({ operation: "reclaim", wordData: { wisRewardOrigins: [origin] } })));
  });
  await test("Closed original scope and insufficient balance cancel all plans; account and totals fail closed", async () => {
    for (const mode of ["closed-economy", "closed-manifest", "readonly", "insufficient", "owner", "negative-total", "revision"]) {
      const f = fixture(), initial = await f.award(), origin = initial.wisRewardOrigins[0], account = f.data.get(`${wis.WIS_ACCOUNT_COLLECTION}/${origin.accountId}`);
      if (mode === "closed-economy") f.data.get("semester_wis_economies/2026-2").status = "CLOSED";
      if (mode === "closed-manifest") f.data.get("semester_manifests/2026-2").status = "CLOSED";
      if (mode === "readonly") account.readOnly = true;
      if (mode === "insufficient") account.balance = 49;
      if (mode === "owner") account.studentUid = "other";
      if (mode === "negative-total") account.rankEarnedTotal = 0;
      if (mode === "revision") account.revision = Number.MAX_SAFE_INTEGER;
      const before = clone([...f.data]), tx = f.transaction();
      const reads = await f.service.read(tx, f.intent({ operation: "reclaim", wordData: { wisRewardOrigins: initial.wisRewardOrigins } }));
      await denied(async () => f.service.plan(reads, times)); eq(tx.writes, []); eq([...f.data], before);
    }
    const f = fixture(); f.data.get("semester_wis_economies/2026-2").status = "CLOSED";
    await denied(() => f.prepare());
  });
  await test("Every persisted reversal binding is checked; orphan reversals do not permit a new award", async () => {
    const f = fixture(), award = await f.award();
    const request = f.intent({ operation: "reclaim", wordData: { wisRewardOrigins: award.wisRewardOrigins } });
    const { tx, plan } = await f.prepare(request); f.service.apply(tx, plan); tx.commit();
    const reversalPath = plan.mutations.find(write => write.operation === "create").path;
    const original = clone(f.data.get(reversalPath));
    for (const [key, value] of Object.entries({ schemaVersion: 999, policyVersion: "unknown", ledgerEntryId: "other", semesterId: "2025-2",
      accountId: "other", studentUid: "other", type: "DEDUCT", activityType: "history_dictionary", sourceId: "other", delta: -49,
      reversedType: "ADJUST", reversedDelta: 49, actorUid: uid, actorRole: "teacher", commandId: "", receiptId: "",
      balanceBefore: 1, balanceAfter: -1, targetDate: "2026-09-10" })) {
      f.data.set(reversalPath, { ...original, [key]: value }); await denied(() => f.prepare(request));
    }
    f.data.set(reversalPath, original); f.data.delete(`${wis.WIS_LEDGER_COLLECTION}/${award.wisRewardOrigins[0].ledgerEntryId}`);
    await denied(() => f.prepare(f.intent()));
  });
  await test("Later failures in multi-origin plans never apply an earlier valid debit", async () => {
    for (const sameAccount of [true, false]) {
      const f = fixture(), first = await f.award();
      const oldScope = { semesterId: "2025-2", year: "2025", semester: "2" };
      if (!sameAccount) f.seedScope(oldScope);
      const second = await f.award(f.intent({ termId: "second", activeScope: sameAccount ? activeScope : oldScope }));
      if (sameAccount) f.data.get(`${wis.WIS_ACCOUNT_COLLECTION}/${first.wisRewardOrigins[0].accountId}`).balance = 75;
      else f.data.get("semester_wis_economies/2025-2").status = "CLOSED";
      const before = clone([...f.data]), tx = f.transaction();
      const reads = await f.service.read(tx, f.intent({ operation: "reclaim", wordData: { wisRewardOrigins: [...first.wisRewardOrigins, ...second.wisRewardOrigins] } }));
      await denied(async () => f.service.plan(reads, times)); eq(tx.writes, []); eq([...f.data], before);
    }
  });
  await test("Canonical constraints never inherit legacy negative-wallet policy, and malformed account/origin input is rejected", async () => {
    for (const [key, value] of Object.entries({ schemaVersion: 999, policyVersion: "unknown", recentLedgerEntries: {}, balance: -1,
      earnedTotal: NaN, rankEarnedTotal: Infinity, spentTotal: -1, adjustedTotal: NaN })) {
      const f = fixture(), accountId = wis.accountIdFor(activeScope.semesterId, uid);
      f.data.get(`${wis.WIS_ACCOUNT_COLLECTION}/${accountId}`)[key] = value;
      await denied(() => f.prepare());
    }
    const f = fixture();
    await denied(() => f.prepare(f.intent({ legacyOrigins: null })));
    await denied(() => f.prepare(f.intent({ activeScope: { ...activeScope, year: "2099" } })));
    await denied(() => f.prepare(f.intent({ wordData: { uid: "other" } })));
    await denied(() => f.prepare(f.intent({ operation: "reclaim", wordData: { wisRewardOrigins: Array(65).fill({}) } })));
  });
  await test("Receipt and business remain caller-owned; apply performs no reads", async () => {
    const f = fixture(), { tx, plan } = await f.prepare();
    const count = f.reads.length;
    f.service.apply(tx, plan); tx.set(f.db.doc("users/student-a/history_dictionary_words/term-one"), { wisRewardOrigins: plan.wisRewardOrigins }, { merge: true });
    tx.create(f.db.doc("command_receipts/receipt-one"), { status: "SUCCEEDED", result: plan.result });
    eq(f.reads.length, count); tx.commit(); eq(f.data.get("command_receipts/receipt-one").result.amount, 50);
    eq(f.data.get("users/student-a/history_dictionary_words/term-one").wisRewardOrigins, plan.wisRewardOrigins);
  });
  await test("Migrated legacy dictionary rewards debit original canonical account once and preserve every legacy byte", async () => {
    const f = fixture(), oldScope = { year: "2025", semester: "1", semesterId: "2025-1" };
    const { paths, origins } = seedMigration(f, oldScope, 2);
    const before = clone([...f.data].filter(([path]) => path.startsWith(paths.scope)));
    const currentBefore = clone(f.data.get(`semester_wis_accounts/${wis.accountIdFor(activeScope.semesterId, uid)}`));
    const prepared = await prepareBridge(f, origins); eq(prepared.plan.result.amount, 100); prepared.commit();
    eq([...f.data].filter(([path]) => path.startsWith(paths.scope)), before);
    eq(f.data.get(`semester_wis_accounts/${wis.accountIdFor(activeScope.semesterId, uid)}`), currentBefore);
    const account = f.data.get(paths.account);
    eq([account.balance, account.earnedTotal, account.rankEarnedTotal, account.spentTotal, account.adjustedTotal], [0, 0, 0, 0, 0]);
    eq(f.data.get(paths.balance).balance, 0); eq(f.data.get(paths.ranking).rankEarnedTotal, 0);
    const posts = prepared.plan.mutations.filter(write => write.operation === "create"); eq(posts.length, 2);
    eq(prepared.plan.mutations.filter(write => write.path === paths.account).length, 1);
    for (const post of posts) {
      eq(post.data.type, "LEGACY_RECLAIM"); eq(post.data.activityType, "history_dictionary_reclaim");
      eq(post.data.totalsContribution, { earnedTotal: -50, rankEarnedTotal: -50, spentTotal: 0, adjustedTotal: 0 });
      eq(post.data.legacyMigrationId, paths.migrationId); eq(post.data.openingLedgerEntryId, paths.openingId);
      eq(post.data.sourceId, `legacy-reclaim:${sha256(`${paths.migrationId}\n${post.data.sourceOriginalRewardPath}`)}`);
      eq(post.data.ledgerEntryId, f.service.ledgerIdFor(oldScope.semesterId, paths.accountId, "LEGACY_RECLAIM", post.data.sourceId));
    }
    const retry = await prepareBridge(f, origins); eq(retry.plan.result.amount, 0); eq(retry.plan.mutations, []);
  });
  await test("Canonical GRANT reversal and migrated reclaims share a single account plan with separate totals contributions", async () => {
    const f = fixture(), { paths, origins } = seedMigration(f, activeScope, 2);
    const award = await f.award();
    const prepared = await prepareBridge(f, origins, award.wisRewardOrigins); eq(prepared.plan.result.amount, 150);
    eq(prepared.plan.mutations.filter(write => write.path === paths.account).length, 1);
    eq(prepared.plan.mutations.filter(write => write.operation === "create").map(write => write.data.type), ["REVERSAL", "LEGACY_RECLAIM", "LEGACY_RECLAIM"]);
    prepared.commit(); const account = f.data.get(paths.account);
    eq([account.balance, account.earnedTotal, account.rankEarnedTotal, account.adjustedTotal], [0, 0, 0, 0]);
    eq(account.revision, 6); eq(f.data.get(paths.balance).ledgerRevision, 6);
    const allLedger = [...f.data].filter(([path, data]) => path.startsWith("semester_wis_ledger/") && data.accountId === paths.accountId).map(([, data]) => data);
    eq(JSON.parse(JSON.stringify(rebuiltTotals(allLedger))), { earnedTotal: account.earnedTotal, rankEarnedTotal: account.rankEarnedTotal,
      spentTotal: account.spentTotal, adjustedTotal: account.adjustedTotal });
    eq(allLedger.reduce((sum, entry) => sum + entry.delta, 0), account.balance);
  });
  await test("Migrated reclaim failures cancel all scopes and never consume current-semester money", async () => {
    for (const corrupt of [
      (f, p) => { f.data.get(p.account).balance = 49; },
      (f, p) => { f.data.get(p.account).earnedTotal = 49; },
      (f, p) => { f.data.get(p.economy).status = "CLOSED"; },
      (f, p) => { f.data.get(p.account).readOnly = true; },
      (f, p) => { f.data.set(p.control, { enabled: true }); },
      (f, p) => { f.data.set(p.control, { writesBlocked: true }); },
    ]) {
      const f = fixture(), first = seedMigration(f), second = seedMigration(f, { year: "2025", semester: "2", semesterId: "2025-2" });
      corrupt(f, second.paths); const before = clone([...f.data]);
      await denied(() => prepareBridge(f, [...first.origins, ...second.origins])); eq([...f.data], before);
    }
  });
  await test("Migrated deterministic receipt binding and server evidence cannot be altered or replayed twice", async () => {
    for (const corrupt of [
      ledger => { ledger.delta = -49; }, ledger => { ledger.sourceOriginalRewardPath += "wrong"; },
      ledger => { ledger.legacyMigrationId = "another"; }, ledger => { ledger.openingLedgerEntryId = "another"; },
      ledger => { ledger.totalsContribution.adjustedTotal = -50; }, ledger => { ledger.studentUid = "another"; },
      ledger => { ledger.legacyHash = "0".repeat(64); }, ledger => { ledger.type = "REVERSAL"; },
    ]) {
      const f = fixture(), { origins } = seedMigration(f), initial = await prepareBridge(f, origins); initial.commit();
      const post = initial.plan.mutations.find(write => write.operation === "create"); corrupt(f.data.get(post.path));
      await denied(() => prepareBridge(f, origins));
    }
    const f = fixture(), { origins } = seedMigration(f);
    await denied(() => prepareBridge(f, origins, [], input => input.migratedLegacyReclaims.push(input.migratedLegacyReclaims[0])));
    await denied(() => prepareBridge(f, origins, [], input => { input.migratedLegacyReclaims[0].amount = 49; }));
    await denied(() => prepareBridge(f, origins, [], input => { input.migratedLegacyReclaims[0].evidence.source.legacyHash = "0".repeat(64); }));
  });
  await test("Canonical new awards and ordinary reversals read and honor both migration control flags", async () => {
    for (const key of ["enabled", "writesBlocked"]) {
      const f = fixture(), award = await f.award();
      f.data.set("wis_legacy_migration_controls/2026-2", { [key]: true });
      for (const input of [f.intent({ termId: "another-term" }), f.intent({ operation: "reclaim", wordData: { wisRewardOrigins: award.wisRewardOrigins } })]) {
        await assert.rejects(() => f.prepare(input), error => error.details?.reason === "WIS_MIGRATION_WRITES_BLOCKED"); checks++;
      }
      eq((await f.prepare(f.intent({ wordData: { wisRewardOrigins: award.wisRewardOrigins } }))).plan.mutations, []);
    }
  });
  console.log(JSON.stringify({ passed: true, checks, cases }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
