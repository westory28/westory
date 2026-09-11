// Native-transaction mocks only: no Firebase initialization, emulator or network.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const { createHistoryDictionaryLegacyReward } = require("../historyDictionaryLegacyReward");
const originHelper = require("../historyDictionaryRewardOrigin");
const migration = require("../wisLegacyMigration");
const wis = require("../wisEconomy");
const source = readFileSync(resolve(__dirname, "../index.js"), "utf8");
const extract = (start, end) => {
  const begin = source.indexOf(start), finish = source.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, `Existing helper source: ${start}`);
  return source.slice(begin, finish);
};
// Reuse the actual read-only wallet helper, legacy rank fallback, rank flooring,
// and ledger payload contract. The policy normalizer is irrelevant to these
// tests; loadPolicy still reads the original semester's mocked policy document.
const legacyFunctions = [
  extract("const buildWalletBase =", "const getLessonCorePointTimestampMs ="),
  extract("const buildWalletRankState =", "const getAllowedEmojiIdsForTier ="),
].join("\n");
const uid = "student-a", actorUid = "teacher-a", timestamp = "SERVER_NOW";
let checks = 0;
const cases = [];
const clone = value => structuredClone(value);
const plain = value => JSON.parse(JSON.stringify(value));
const eq = (actual, expected) => { assert.deepEqual(plain(actual), plain(expected)); checks++; };
const ok = value => { assert.ok(value); checks++; };
const denied = async task => { await assert.rejects(task, error => error.code === "failed-precondition"); checks++; };
const test = async (name, task) => { try { await task(); cases.push(name); } catch (error) { error.message = `${name}: ${error.message}`; throw error; } };
const makeOrigin = (year = "2026", semester = "1", termId = "original-term") => ({ ledgerKind: "legacy-point", uid, termId, year, semester,
  transactionId: originHelper.getRewardTransactionId(uid, termId) });
const rewardPath = origin => `years/${origin.year}/semesters/${origin.semester}/point_transactions/${origin.transactionId}`;
const walletPath = origin => `years/${origin.year}/semesters/${origin.semester}/point_wallets/${uid}`;
const migrate = (f, origin, reclaimed = false) => {
  const semesterId = `${origin.year}-${origin.semester}`, paths = migration.pathsFor(semesterId, uid);
  f.seed(origin, { balanceAfter: 50, reclaimed: reclaimed === true });
  if (reclaimed) f.data.set(`${rewardPath(origin)}_reclaim`, { uid, type: "history_dictionary_reclaim",
    sourceId: originHelper.getRewardSourceId(origin.termId), delta: -50, balanceAfter: 0 });
  const amount = reclaimed ? 0 : 50;
  const earned = reclaimed === "repair" ? 50 : amount;
  f.data.set(paths.wallet, { uid, balance: amount, earnedTotal: earned, rankEarnedTotal: earned, spentTotal: 0, adjustedTotal: 0 });
  const source = migration.evaluateLegacyWisSource({ semesterId, studentUid: uid,
    wallet: { path: paths.wallet, exists: true, data: f.data.get(paths.wallet) },
    transactions: [...f.data].filter(([path]) => path.startsWith(`${paths.transactions}/`)).map(([path, data]) => ({ path, data, exists: true })), orders: [] });
  eq(source.status, "READY");
  f.data.set(paths.marker, { schemaVersion: 1, policyVersion: migration.POLICY_VERSION, status: "MIGRATED", migrationId: paths.migrationId,
    semesterId, studentUid: uid, accountId: paths.accountId, openingLedgerEntryId: paths.openingId, legacyHash: source.legacyHash,
    totals: source.totals, sourceRefs: source.sourceRefs, sourceTransactionCount: source.transactionCount, sourceOrderCount: 0 });
  f.data.set(paths.account, { schemaVersion: wis.WIS_SCHEMA_VERSION, policyVersion: wis.WIS_POLICY_VERSION,
    accountId: paths.accountId, semesterId, studentUid: uid, legacyMigrationId: paths.migrationId });
  f.data.set(paths.opening, { schemaVersion: wis.WIS_SCHEMA_VERSION, policyVersion: wis.WIS_POLICY_VERSION,
    ledgerEntryId: paths.openingId, semesterId, studentUid: uid, accountId: paths.accountId, type: "LEGACY_OPENING",
    sourceId: paths.migrationId, legacyHash: source.legacyHash, delta: amount, balanceBefore: 0, balanceAfter: amount, openingTotals: source.totals });
  return paths;
};

const fixture = () => {
  const data = new Map(), queries = [], reads = [], dependencyCalls = [];
  let onRead = null;
  const makeQuery = (path, group) => ({ path, group, filters: [], maximum: Infinity,
    where(field, operator, value) { assert.equal(operator, "=="); this.filters.push([field, value]); return this; },
    limit(maximum) { this.maximum = maximum; return this; } });
  const db = { doc: path => ({ path }), collection: path => makeQuery(path, false), collectionGroup: name => makeQuery(name, true) };
  const functions = runInNewContext(`${legacyFunctions}\n({loadPolicy,ensureWallet,getCurrentRankEarnedTotal,buildWalletBase,buildWalletRankState,createTransactionPayload})`, {
    db, FieldValue: { serverTimestamp: () => "UNREPLACED_SERVER_TIME" },
    getPointWalletPath: (year, semester, owner) => `years/${year}/semesters/${semester}/point_wallets/${owner}`,
    getPointPolicyPath: (year, semester) => `years/${year}/semesters/${semester}/point_policies/current`,
    getPointCollectionPath: (year, semester, collection) => `years/${year}/semesters/${semester}/${collection}`,
    getDefaultPointPolicy: () => ({ rankPolicy: { key: "default" }, allowNegativeBalance: false }),
    normalizePointPolicy: value => value,
    buildRankSnapshot: (amount, policy) => ({ metricValue: amount, policyKey: policy?.key || "default", updatedAt: "UNREPLACED_SERVER_TIME" }),
  });
  const dependencies = Object.fromEntries(Object.entries(functions).map(([name, fn]) => [name, (...args) => {
    dependencyCalls.push({ name, args: ["loadPolicy", "ensureWallet", "getCurrentRankEarnedTotal"].includes(name) ? args.slice(1, 4) : [] });
    return fn(...args);
  }]));
  const service = createHistoryDictionaryLegacyReward({ db, ...dependencies });
  const seed = (origin = makeOrigin(), patch = {}) => {
    data.set(rewardPath(origin), { uid, type: "history_dictionary", sourceId: originHelper.getRewardSourceId(origin.termId), delta: 50,
      balanceAfter: 100, policyId: "old-policy", targetDate: "2026-03-02", ...patch });
    if (!data.has(walletPath(origin))) data.set(walletPath(origin), { uid, balance: 20, earnedTotal: 30, rankEarnedTotal: 40, spentTotal: 17, adjustedTotal: -9 });
    data.set(`years/${origin.year}/semesters/${origin.semester}/point_policies/current`, { rankPolicy: { key: `${origin.year}-${origin.semester}` }, allowNegativeBalance: false });
    return origin;
  };
  const transaction = () => {
    const writes = [];
    return {
      writes,
      async get(ref) {
        assert.equal(writes.length, 0, "No reads after the first write");
        reads.push(ref.path);
        if (onRead) onRead(ref);
        if (ref.filters) {
          queries.push({ path: ref.path, group: ref.group, filters: clone(ref.filters), limit: ref.maximum });
          const docs = [...data].filter(([path, value]) => {
            const collection = path.split("/").at(-2);
            const matchesPath = ref.group ? collection === ref.path : path.startsWith(`${ref.path}/`) && !path.slice(ref.path.length + 1).includes("/");
            return matchesPath && ref.filters.every(([field, expected]) => value[field] === expected);
          }).slice(0, ref.maximum);
          return { size: docs.length, docs: docs.map(([path, value]) => ({ ref: { path }, data: () => clone(value) })) };
        }
        return { exists: data.has(ref.path), data: () => clone(data.get(ref.path)) };
      },
      set(ref, value, options) { assert.equal(options.merge, true); writes.push({ operation: "set", path: ref.path, data: clone(value) }); },
      create(ref, value) { writes.push({ operation: "create", path: ref.path, data: clone(value) }); },
      commit() {
        for (const write of writes) if (write.operation === "create") assert.equal(data.has(write.path), false, "create precondition");
        for (const write of writes) data.set(write.path, write.operation === "set" ? { ...data.get(write.path), ...write.data } : write.data);
      },
    };
  };
  const intent = (overrides = {}) => ({ uid, actorUid, profile: { name: "학생", grade: "2", class: "1", number: "3" },
    operation: "reclaim", word: "바꾼 단어 이름", reason: "student_deleted_history_dictionary_word", wordData: { uid, termId: "original-term" }, ...overrides });
  const prepare = async input => { const tx = transaction(), reads = await service.read(tx, input || intent()); const plan = service.plan(reads, { timestamp }); eq(tx.writes.length, 0); return { tx, plan, reads }; };
  const execute = async input => { const { tx, plan } = await prepare(input); service.apply(tx, plan); tx.commit(); return plan; };
  return { data, reads, queries, dependencyCalls, seed, transaction, service, intent, prepare, execute, onRead: callback => { onRead = callback; } };
};

(async () => {
  await test("Discovery trusts exact ledger paths, not word year or request identity; all pairs are reread", async () => {
    const f = fixture(), first = f.seed(), second = f.seed(makeOrigin("2025", "2"));
    f.seed(makeOrigin("2024", "1", "request-alias"));
    const request = f.intent({ operation: "preserve", wordData: { uid, termId: "renamed-term", rewardTermId: "original-term", rewardAmount: 50,
      year: "2099", semester: "2", requestOriginTermId: "request-alias", rewardTransactionId: "untrusted-compatibility-id" } });
    const { plan } = await f.prepare(request);
    eq(plan.rewardOrigins, [first, second]); eq(plan.mutations, []);
    eq(f.queries, [{ path: "point_transactions", group: true, filters: [["uid", uid], ["type", "history_dictionary"],
      ["sourceId", "history-dictionary:original-term"]], limit: 65 }]);
    for (const origin of [first, second]) { ok(f.reads.includes(rewardPath(origin))); ok(f.reads.includes(`${rewardPath(origin)}_reclaim`)); }
    eq(f.dependencyCalls.length, 0);
    await denied(() => f.prepare(f.intent({ operation: "preserve", wordData: {
      uid, termId: "renamed-without-reward-binding", requestOriginTermId: "original-term", rewardAmount: 50,
    } })));
    await denied(() => f.prepare(f.intent({ operation: "preserve", wordData: {
      uid, termId: "original-term", rewardTermId: "invalid/path", rewardAmount: 50,
    } })));
  });
  await test("Explicit origins preserve multiple historic term identities and never trigger discovery", async () => {
    const f = fixture(), first = f.seed(), second = f.seed(makeOrigin("2026", "2", "second-term"));
    const { plan } = await f.prepare(f.intent({ operation: "preserve", wordData: { uid, termId: "latest-name", rewardOrigins: [first, second] } }));
    eq(plan.rewardOrigins, [first, second]); eq(plan.mutations, []); eq(f.queries.length, 0);
  });
  await test("Canonical-only and brand-new words have no invented legacy origin; evidence without ledger fails", async () => {
    const f = fixture();
    const { plan } = await f.prepare(f.intent({ operation: "preserve", wordData: { uid, termId: "canonical-only", rewardOrigins: [], rewardAmount: 0, rewardTransactionId: "", wisRewardOrigins: [{ example: true }] } }));
    eq(plan.rewardOrigins, []); eq(f.queries.length, 0);
    eq((await f.prepare(f.intent({ wordData: {} }))).plan.rewardOrigins, []); eq(f.queries.length, 0);
    eq((await f.prepare(f.intent({ wordData: { termId: "old-no-reward" } }))).plan.rewardOrigins, []);
    eq(f.queries.length, 1);
    for (const evidence of [{ rewardAmount: 50 }, { rewardAwardedAt: "old-time" }, { rewardTransactionId: "claimed" }])
      await denied(() => f.prepare(f.intent({ wordData: { uid, termId: "missing", ...evidence } })));
    await denied(() => f.prepare(f.intent({ wordData: { uid, termId: "canonical-only", rewardOrigins: [], rewardAmount: 50 } })));
  });
  await test("Reclaim preserves legacy negative balance and floor-zero rank/earned policy", async () => {
    const f = fixture(), origin = f.seed();
    const plan = await f.execute(f.intent({ wordData: { uid, termId: "changed", rewardOrigins: [origin] } }));
    eq(plan.result.reclaimed, true); eq(plan.result.amount, 50); eq(plan.mutations.length, 3);
    const wallet = f.data.get(walletPath(origin));
    eq([wallet.balance, wallet.earnedTotal, wallet.rankEarnedTotal, wallet.spentTotal, wallet.adjustedTotal], [-30, 0, 0, 17, -9]);
    eq(wallet.rankSnapshot, { metricValue: 0, policyKey: "2026-1", updatedAt: timestamp });
    eq(wallet.lastTransactionAt, timestamp);
    const reward = f.data.get(rewardPath(origin)), reclaim = f.data.get(`${rewardPath(origin)}_reclaim`);
    eq([reward.reclaimed, reward.reclaimedBy, reward.reclaimedAt], [true, actorUid, timestamp]);
    eq([reclaim.uid, reclaim.type, reclaim.activityType, reclaim.delta, reclaim.balanceAfter], [uid, "history_dictionary_reclaim", "history_dictionary_reclaim", -50, -30]);
    eq([reclaim.sourceId, reclaim.policyId, reclaim.targetDate, reclaim.createdBy, reclaim.createdAt], [originHelper.getRewardSourceId(origin.termId), "old-policy", "2026-03-02", actorUid, timestamp]);
    eq((await f.prepare(f.intent({ wordData: { rewardOrigins: [origin] } }))).plan.mutations, []);
    ok(plan.mutations.every(write => !write.path.includes("semester_wis_")));
  });
  await test("All wallet/policy/rank reads precede scope-aggregated writes for multiple rewards", async () => {
    const f = fixture(), a = f.seed(), b = f.seed(makeOrigin("2026", "1", "another-source"), { delta: 25 }), c = f.seed(makeOrigin("2025", "2"));
    f.data.get(walletPath(a)).balance = 100;
    f.data.get(walletPath(a)).earnedTotal = 100;
    delete f.data.get(walletPath(a)).rankEarnedTotal;
    f.data.set("years/2026/semesters/1/point_transactions/manual-positive", { uid, type: "manual_adjust", delta: 20 });
    f.data.set("years/2026/semesters/1/point_transactions/manual-negative", { uid, type: "manual_adjust", delta: -30 });
    const { tx, plan } = await f.prepare(f.intent({ wordData: { uid, termId: "latest", rewardOrigins: [a, b, c] } }));
    eq(plan.result.amount, 125); eq(plan.result.scopes, [{ year: "2026", semester: "1" }, { year: "2025", semester: "2" }]);
    eq(plan.mutations.filter(write => write.path.includes("/point_wallets/")).length, 2);
    for (const name of ["loadPolicy", "ensureWallet", "getCurrentRankEarnedTotal"]) eq(f.dependencyCalls.filter(call => call.name === name).length, 2);
    const readCount = f.reads.length; f.service.apply(tx, plan); eq(f.reads.length, readCount); tx.commit();
    const wallet = f.data.get(walletPath(a));
    eq([wallet.balance, wallet.earnedTotal, wallet.rankEarnedTotal, wallet.spentTotal, wallet.adjustedTotal], [25, 25, 45, 17, -9]);
    eq(f.data.get(`${rewardPath(a)}_reclaim`).balanceAfter, 50);
    eq(f.data.get(`${rewardPath(b)}_reclaim`).balanceAfter, 25);
  });
  await test("Existing reclaim repairs only the original marker and keeps previous provenance", async () => {
    const f = fixture(), origin = f.seed(undefined, { reclaimedBy: "previous-manager", reclaimedAt: "previous-time", reclaimReason: "previous-reason" });
    f.data.set(`${rewardPath(origin)}_reclaim`, { uid, type: "history_dictionary_reclaim", delta: -50, sourceId: originHelper.getRewardSourceId(origin.termId) });
    const plan = await f.execute(f.intent({ wordData: { rewardOrigins: [origin] } }));
    eq(plan.result.amount, 0); eq(plan.result.repairedMarkerCount, 1); eq(plan.mutations.length, 1); eq(f.dependencyCalls.length, 0);
    eq([f.data.get(rewardPath(origin)).reclaimedBy, f.data.get(rewardPath(origin)).reclaimedAt], ["previous-manager", "previous-time"]);
    eq(f.data.get(walletPath(origin)).balance, 20);
    eq((await f.prepare(f.intent({ wordData: { rewardOrigins: [origin] } }))).plan.mutations, []);
  });
  await test("Discovery reread mismatches and unsupported paths fail closed", async () => {
    for (const mode of ["changed-owner", "deleted-after-query", "changed-source", "top-level-path", "nested-path"]) {
      const f = fixture(), origin = f.seed();
      if (mode.endsWith("path")) {
        const invalidPath = mode === "top-level-path" ? `point_transactions/${origin.transactionId}` : `other/root/point_transactions/${origin.transactionId}`;
        f.data.set(invalidPath, f.data.get(rewardPath(origin))); f.data.delete(rewardPath(origin));
      } else f.onRead(ref => {
        if (ref.path === rewardPath(origin) && !ref.filters) {
          if (mode === "deleted-after-query") f.data.delete(ref.path);
          if (mode === "changed-owner") f.data.get(ref.path).uid = "other";
          if (mode === "changed-source") f.data.get(ref.path).sourceId = "different";
        }
      });
      await denied(() => f.prepare(f.intent({ wordData: { termId: origin.termId, rewardAmount: 50 } })));
    }
  });
  await test("Malformed origin/grant/reclaim pairs never stage wallet changes", async () => {
    const f = fixture(), origin = f.seed(), request = f.intent({ wordData: { rewardOrigins: [origin] } });
    for (const raw of [null, {}, [origin, origin], [{ ...origin, uid: "other" }], [{ ...origin, year: "2099" }], [{ ...origin, ledgerKind: "canonical-wis" }]])
      await denied(() => f.prepare(f.intent({ wordData: { rewardOrigins: raw } })));
    const original = clone(f.data.get(rewardPath(origin)));
    for (const [key, value] of Object.entries({ uid: "other", type: "manual_adjust", sourceId: "other", delta: -50, reclaimed: "yes" })) {
      f.data.set(rewardPath(origin), { ...original, [key]: value }); await denied(() => f.prepare(request));
    }
    f.data.set(rewardPath(origin), { ...original, reclaimed: true }); await denied(() => f.prepare(request));
    f.data.set(rewardPath(origin), original);
    const reclaim = { uid, type: "history_dictionary_reclaim", delta: -50, sourceId: original.sourceId };
    for (const [key, value] of Object.entries({ uid: "other", type: "manual_reclaim", sourceId: "other", delta: -49 })) {
      f.data.set(`${rewardPath(origin)}_reclaim`, { ...reclaim, [key]: value }); await denied(() => f.prepare(request));
    }
  });
  await test("Wrong wallet owner, malformed money and later-origin failures prevent every write", async () => {
    for (const [field, value] of [["uid", "other"], ["balance", Infinity], ["balance", NaN], ["earnedTotal", NaN], ["adjustedTotal", Infinity]]) {
      const f = fixture(), a = f.seed(), b = f.seed(makeOrigin("2025", "2"));
      f.data.get(walletPath(b))[field] = value;
      const tx = f.transaction(), before = clone([...f.data]);
      await denied(async () => f.service.plan(await f.service.read(tx, f.intent({ wordData: { rewardOrigins: [a, b] } })), { timestamp }));
      eq(tx.writes, []); assert.deepEqual([...f.data], before); checks++;
    }
    const f = fixture(), origin = f.seed(); f.data.delete(walletPath(origin));
    const plan = await f.execute(f.intent({ wordData: { rewardOrigins: [origin] } }));
    eq(plan.result.amount, 50); eq(f.data.get(walletPath(origin)).balance, -50);
  });
  await test("Discovery and explicit-origin limits are bounded at 64 and never silently truncate", async () => {
    for (const count of [64, 65]) {
      const f = fixture(), origins = Array.from({ length: count }, (_, index) => f.seed(makeOrigin(String(2000 + index), "1")));
      if (count === 64) {
        const { plan } = await f.prepare(f.intent({ operation: "preserve" })); eq(plan.rewardOrigins.length, 64); eq(plan.mutations, []);
      } else {
        await denied(() => f.prepare(f.intent({ operation: "preserve" })));
        await denied(() => f.prepare(f.intent({ operation: "preserve", wordData: { rewardOrigins: origins } })));
      }
    }
  });
  await test("Apply has no reads and caller can atomically add word and receipt writes", async () => {
    const f = fixture(), origin = f.seed(), { tx, plan } = await f.prepare(f.intent({ wordData: { rewardOrigins: [origin] } }));
    const readCount = f.reads.length; f.service.apply(tx, plan);
    tx.set({ path: "users/student-a/history_dictionary_words/current" }, { rewardOrigins: plan.rewardOrigins }, { merge: true });
    tx.create({ path: "command_receipts/one" }, { result: plan.result }); eq(f.reads.length, readCount); tx.commit();
    eq(f.data.get("command_receipts/one").result.amount, 50);
  });
  await test("Migrated source stays immutable and verified original origin is forwarded to canonical planning", async () => {
    const f = fixture(), origin = makeOrigin("2025", "2"), paths = migrate(f, origin), before = clone([...f.data]);
    const input = f.intent({ wordData: { rewardOrigins: [origin], year: "2099", semester: "1" } });
    const { plan } = await f.prepare(input);
    eq(plan.mutations, []); eq(plan.result.amount, 0); eq(plan.rewardOrigins, [origin]);
    eq(plan.migratedLegacyReclaims.map(item => [item.rewardPath, item.amount, item.evidence.semesterId]), [[rewardPath(origin), 50, "2025-2"]]);
    eq(f.dependencyCalls, []); eq([...f.data], before);
    ok(f.reads.includes(paths.control)); ok(f.reads.includes(paths.marker)); ok(f.reads.includes(paths.opening));
    eq(f.queries.map(query => [query.path, query.limit]), [[paths.transactions, 1001], [paths.orders, 1001]]);
    eq((await f.prepare({ ...input, operation: "preserve" })).plan.migratedLegacyReclaims, []);
  });
  await test("Pre-opening legacy reclaim is not debited again or mutated after migration", async () => {
    for (const reclaimed of [true, "repair"]) {
      const f = fixture(), origin = makeOrigin(), paths = migrate(f, origin, reclaimed);
      const { plan } = await f.prepare(f.intent({ wordData: { rewardOrigins: [origin] } }));
      eq(plan.mutations, []); eq(plan.migratedLegacyReclaims, []); eq(f.data.get(paths.wallet).balance, 0);
      eq(f.data.get(rewardPath(origin)).reclaimed, reclaimed === true);
    }
  });
  await test("Mixed migrated and unmigrated scopes only mutate the verified original unmigrated wallet", async () => {
    const f = fixture(), migrated = makeOrigin("2025", "2"), paths = migrate(f, migrated), old = f.seed();
    const { plan } = await f.prepare(f.intent({ wordData: { rewardOrigins: [migrated, old] } }));
    eq(plan.result.amount, 50); eq(plan.result.scopes.map(scope => `${scope.year}-${scope.semester}`), ["2026-1"]);
    eq(plan.migratedLegacyReclaims.length, 1); ok(plan.mutations.every(mutation => !mutation.path.startsWith(paths.scope)));
  });
  await test("Migration source, owner, scope, opening totals and hash contradictions fail before writes", async () => {
    for (const corrupt of [
      (f, p) => f.data.delete(p.marker), (f, p) => f.data.delete(p.opening),
      (f, p) => { f.data.get(p.marker).legacyHash = "0".repeat(64); },
      (f, p) => { f.data.get(p.marker).studentUid = "another"; },
      (f, p) => { f.data.get(p.marker).semesterId = "2026-2"; },
      (f, p) => { f.data.get(p.marker).sourceTransactionCount = 2; },
      (f, p) => { f.data.get(p.opening).openingTotals.earnedTotal = 49; },
      (f, p) => { f.data.get(p.account).legacyMigrationId = "another"; },
      (f, p) => { f.data.get(p.wallet).name = "source changed"; },
      (f, p, o) => { f.data.get(rewardPath(o)).sourceLabel = "changed"; },
    ]) {
      const f = fixture(), origin = makeOrigin(), paths = migrate(f, origin); corrupt(f, paths, origin);
      await denied(() => f.prepare(f.intent({ wordData: { rewardOrigins: [origin] } })));
    }
  });
  await test("Unmigrated legacy writes honor either migration fence flag including repair-only writes", async () => {
    for (const key of ["enabled", "writesBlocked"]) for (const repair of [false, true]) {
      const f = fixture(), origin = f.seed();
      if (repair) f.data.set(`${rewardPath(origin)}_reclaim`, { uid, type: "history_dictionary_reclaim", sourceId: originHelper.getRewardSourceId(origin.termId), delta: -50 });
      f.data.set("wis_legacy_migration_controls/2026-1", { [key]: true });
      await assert.rejects(() => f.prepare(f.intent({ wordData: { rewardOrigins: [origin] } })),
        error => error.details?.reason === "WIS_MIGRATION_WRITES_BLOCKED"); checks++;
      eq((await f.prepare(f.intent({ operation: "preserve", wordData: { rewardOrigins: [origin] } }))).plan.mutations, []);
    }
  });
  console.log(JSON.stringify({ passed: true, checks, cases }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
