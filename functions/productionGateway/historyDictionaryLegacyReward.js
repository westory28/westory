// Past legacy rewards only. No new awards or canonical Wis mutations.
// The caller commits these mutations, canonical mutations, word CAS and the
// command receipt together, after ALL participating modules have finished reads.
const { HttpsError } = require("firebase-functions/v2/https");
const originHelper = require("./historyDictionaryRewardOrigin");
const migrationFence = require("./wisMigrationFence");
const MAX_ORIGINS = 64;
const DISCOVERY_LIMIT = MAX_ORIGINS + 1;
const fail = (reason, message = "과거 사전 보상 출처를 확인할 수 없습니다.") => {
  throw new HttpsError("failed-precondition", message, { reason: `HISTORY_DICTIONARY_LEGACY_${reason}` });
};
const isId = (value, maximum = 128) => typeof value === "string" && value.length > 0 && value.length <= maximum &&
  value === value.trim() && !/[\\/\x00-\x1f\x7f]/.test(value) && value !== "." && value !== "..";
const object = value => value && typeof value === "object" && !Array.isArray(value);
const scopeKey = scope => `${scope.year}/${scope.semester}`;
const walletPath = (scope, uid) => `years/${scope.year}/semesters/${scope.semester}/point_wallets/${uid}`;
const finiteNumber = value => typeof value === "number" && Number.isFinite(value);

// Evidence is read by this server module, never accepted from the command payload.
// Re-evaluation keeps the bridge bound to the same immutable source as the opening.
const validateMigrationEvidence = ({ semesterId, uid, source, marker, opening, account }) => {
  const migration = require("./wisLegacyMigration"), wis = require("./wisEconomy");
  const paths = migration.pathsFor(semesterId, uid);
  if (!source?.snapshot) fail("MIGRATION_SOURCE_MISSING");
  const snapshot = source.snapshot;
  const verified = migration.evaluateLegacyWisSource({ semesterId, studentUid: uid, wallet: snapshot.wallet,
    transactions: snapshot.transactions.map(row => ({ ...row, exists: true })),
    orders: snapshot.orders.map(row => ({ ...row, exists: true })) });
  const same = (left, right) => migration.canonical(left) === migration.canonical(right);
  if (verified.status !== "READY" || source.legacyHash !== verified.legacyHash || !marker || !opening || !account ||
    marker.schemaVersion !== 1 || marker.policyVersion !== migration.POLICY_VERSION || marker.status !== "MIGRATED" ||
    marker.migrationId !== paths.migrationId || marker.semesterId !== semesterId || marker.studentUid !== uid ||
    marker.accountId !== paths.accountId || marker.openingLedgerEntryId !== paths.openingId ||
    marker.legacyHash !== verified.legacyHash || !same(marker.totals, verified.totals) || !same(marker.sourceRefs, verified.sourceRefs) ||
    marker.sourceTransactionCount !== verified.transactionCount || marker.sourceOrderCount !== verified.orderCount ||
    account.schemaVersion !== wis.WIS_SCHEMA_VERSION || account.policyVersion !== wis.WIS_POLICY_VERSION ||
    account.accountId !== paths.accountId || account.semesterId !== semesterId || account.studentUid !== uid ||
    account.legacyMigrationId !== paths.migrationId ||
    opening.schemaVersion !== wis.WIS_SCHEMA_VERSION || opening.policyVersion !== wis.WIS_POLICY_VERSION ||
    opening.ledgerEntryId !== paths.openingId || opening.type !== "LEGACY_OPENING" || opening.sourceId !== paths.migrationId ||
    opening.semesterId !== semesterId || opening.studentUid !== uid || opening.accountId !== paths.accountId ||
    opening.legacyHash !== verified.legacyHash || opening.delta !== verified.totals.balance || opening.balanceBefore !== 0 ||
    opening.balanceAfter !== verified.totals.balance || !same(opening.openingTotals, verified.totals)) fail("MIGRATION_BINDING_MISMATCH");
  return { paths, source: verified };
};

const createHistoryDictionaryLegacyReward = ({ db, loadPolicy, ensureWallet, getCurrentRankEarnedTotal,
  buildWalletBase, buildWalletRankState, createTransactionPayload }) => {
  if (!db || [loadPolicy, ensureWallet, getCurrentRankEarnedTotal, buildWalletBase, buildWalletRankState, createTransactionPayload]
    .some(dependency => typeof dependency !== "function")) throw new Error("Legacy dictionary reward dependencies are incomplete.");

  const read = async (transaction, intent) => {
    if (!object(intent) || !isId(intent.uid) || !object(intent.wordData) || !["preserve", "reclaim"].includes(intent.operation) ||
      !isId(intent.actorUid) || !object(intent.profile)) fail("INTENT_INVALID");
    const { uid, wordData } = intent;
    if (Object.hasOwn(wordData, "rewardOrigins") && Array.isArray(wordData.rewardOrigins) && wordData.rewardOrigins.length > MAX_ORIGINS)
      fail("ORIGIN_LIMIT", "보상 출처가 너무 많아 원래 기록을 별도로 확인해야 합니다.");
    const initial = originHelper.planRewardOriginReads({ uid, wordData });
    let originReads = initial.reads, discoveredOrigins;
    if (initial.legacyNeedsDiscovery) {
      // rewardTermId is a recorded reward identity, not the editable business
      // term/request origin. Never search guessed aliases or word.year.
      const termId = wordData.rewardTermId || wordData.termId;
      if (!isId(termId, 80)) fail("DISCOVERY_TERM_INVALID");
      const query = db.collectionGroup("point_transactions")
        .where("uid", "==", uid).where("type", "==", "history_dictionary")
        .where("sourceId", "==", originHelper.getRewardSourceId(termId)).limit(DISCOVERY_LIMIT);
      const snapshot = await transaction.get(query);
      if (snapshot.size >= DISCOVERY_LIMIT) fail("ORIGIN_LIMIT", "보상 출처가 너무 많아 원래 기록을 별도로 확인해야 합니다.");
      const backfill = originHelper.planLegacyRewardOriginBackfill({ uid, wordData,
        rewardLedgers: snapshot.docs.map(doc => ({ path: doc.ref.path, data: doc.data() })) });
      discoveredOrigins = backfill.rewardOrigins;
      originReads = backfill.reads;
    }
    const paths = [...new Set(originReads.flatMap(item => [item.rewardPath, item.reclaimPath]))];
    // Re-read every discovered exact path and its reclaim pair in the same
    // native transaction. A discovery row alone is never an authority to debit.
    const ledgerEntries = await Promise.all(paths.map(async path => {
      const snapshot = await transaction.get(db.doc(path));
      return { path, data: snapshot.exists ? snapshot.data() : null };
    }));
    const verified = originHelper.planRewardReclaims({ uid, wordData, ledgerEntries,
      ...(discoveredOrigins !== undefined ? { legacyRewardOrigins: discoveredOrigins } : {}) });
    if (verified.rewardOrigins.length > MAX_ORIGINS) fail("ORIGIN_LIMIT");
    const wallets = new Map(), migrations = new Map(), controls = new Map();
    const migration = require("./wisLegacyMigration");
    const snapshotAt = async path => {
      const snapshot = await transaction.get(db.doc(path));
      return { path, exists: snapshot.exists, data: snapshot.exists ? snapshot.data() : null };
    };
    for (const origin of verified.rewardOrigins) {
      const key = scopeKey(origin);
      if (controls.has(key)) continue;
      const semesterId = `${origin.year}-${origin.semester}`, paths = migration.pathsFor(semesterId, uid);
      const [control, marker, opening, account] = await Promise.all(
        [paths.control, paths.marker, paths.opening, paths.account].map(snapshotAt));
      controls.set(key, control.data);
      if (!marker.exists && !opening.exists && !account.data?.legacyMigrationId) continue;
      const source = await migration.readLegacyWisMigrationSource({ semesterId, studentUid: uid, transaction: {
        get: snapshotAt,
        query: async (path, options) => {
          let query = db.collection(path);
          for (const filter of options.filters) query = query.where(filter.field, filter.operator, filter.value);
          const snapshot = await transaction.get(query.limit(options.limit));
          return snapshot.docs.map(doc => ({ path: doc.ref.path, exists: true, data: doc.data() }));
        },
      } });
      const evidence = { semesterId, uid, source, marker: marker.data, opening: opening.data, account: account.data };
      validateMigrationEvidence(evidence);
      migrations.set(key, evidence);
    }
    if (intent.operation === "reclaim") {
      // Each dependency is the existing read-only legacy function. In
      // particular ensureWallet returns a default without creating a document.
      for (const scope of verified.scopes) {
        if (migrations.has(scopeKey(scope))) continue;
        const policy = await loadPolicy(transaction, scope.year, scope.semester);
        const { ref, wallet } = await ensureWallet(transaction, scope.year, scope.semester, uid, intent.profile);
        if (ref?.path !== walletPath(scope, uid) || !object(wallet) || wallet.uid !== uid) fail("WALLET_OWNER_MISMATCH");
        const rankEarnedTotal = await getCurrentRankEarnedTotal(transaction, scope.year, scope.semester, uid, wallet);
        wallets.set(scopeKey(scope), { scope, wallet, rankEarnedTotal, policy });
      }
    }
    return { intent, verified, ledgerEntries, wallets, migrations, controls };
  };

  const plan = (readSet, { timestamp }) => {
    if (!timestamp) fail("TIMESTAMP_REQUIRED");
    const { intent, verified, ledgerEntries, wallets, migrations, controls } = readSet;
    const { uid } = intent;
    const result = { reclaimed: false, amount: 0, transactionIds: [], scopes: [], repairedMarkerCount: 0 };
    const migratedLegacyReclaims = [];
    if (intent.operation === "preserve") return { rewardOrigins: verified.rewardOrigins, result, mutations: [], migratedLegacyReclaims };
    const ledgers = new Map(ledgerEntries.map(entry => [entry.path, entry.data]));
    const totals = new Map(), mutations = [];
    for (const item of verified.reclaims) {
      if (item.status === "already-reclaimed") continue;
      const original = ledgers.get(item.rewardPath);
      const evidence = migrations.get(scopeKey(item.origin));
      if (evidence) {
        // A pre-opening reclaim is already reflected in the opening. Never even
        // repair a legacy marker after migration: its source hash is immutable.
        if (item.status === "reclaim") migratedLegacyReclaims.push({ origin: item.origin,
          rewardPath: item.rewardPath, amount: item.amount, evidence });
        continue;
      }
      migrationFence.assertControl(controls.get(scopeKey(item.origin)));
      mutations.push({ operation: "set", path: item.rewardPath, merge: true, data: {
        reclaimed: true, reclaimedAt: item.status === "repair-marker" ? original.reclaimedAt || timestamp : timestamp,
        reclaimedBy: item.status === "repair-marker" ? original.reclaimedBy || intent.actorUid : intent.actorUid,
        reclaimReason: item.status === "repair-marker" ? original.reclaimReason || intent.reason || "history_dictionary_word_deleted" : intent.reason || "history_dictionary_word_deleted",
      } });
      if (item.status === "repair-marker") { result.repairedMarkerCount += 1; continue; }
      const key = scopeKey(item.origin), state = wallets.get(key);
      if (!state) fail("WALLET_NOT_READ");
      if (!totals.has(key)) {
        const wallet = state.wallet;
        const values = Object.fromEntries(["balance", "earnedTotal", "spentTotal", "adjustedTotal"]
          .map(field => [field, Number(wallet[field] ?? 0)]));
        if (!Object.values(values).every(finiteNumber) || !finiteNumber(state.rankEarnedTotal) || state.rankEarnedTotal < 0) fail("WALLET_TOTALS_INVALID");
        totals.set(key, { ...state, ...values, amount: 0 });
      }
      const total = totals.get(key);
      total.amount += item.amount;
      total.balance -= item.amount;
      if (!finiteNumber(total.amount) || !finiteNumber(total.balance)) fail("WALLET_TOTALS_INVALID");
      const payload = createTransactionPayload({ uid, type: "history_dictionary_reclaim", activityType: "history_dictionary_reclaim",
        delta: -item.amount, balanceAfter: total.balance, sourceId: original.sourceId,
        sourceLabel: `역사 사전 보상 회수: ${String(intent.word || item.origin.termId).slice(0, 80)}`,
        policyId: String(original.policyId || "current"), createdBy: intent.actorUid, targetDate: String(original.targetDate || "") });
      // Match the same verified original source exactly. A missing reclaim was
      // read, and create also fences any accidental same-ID duplicate apply.
      mutations.push({ operation: "create", path: item.reclaimPath, data: { ...payload, createdAt: timestamp } });
      result.transactionIds.push(item.reclaimPath.split("/").pop());
      result.amount += item.amount;
      if (!finiteNumber(result.amount)) fail("WALLET_TOTALS_INVALID");
    }
    for (const total of totals.values()) {
      const rankEarnedTotal = Math.max(0, total.rankEarnedTotal - total.amount);
      const earnedTotal = Math.max(0, total.earnedTotal - total.amount);
      const rank = buildWalletRankState(rankEarnedTotal, total.policy?.rankPolicy);
      // Preserve legacy semantics: balance may become negative even when the
      // policy disallows spending below zero; earned/rank totals floor at zero.
      mutations.push({ operation: "set", path: walletPath(total.scope, uid), merge: true, data: {
        ...buildWalletBase(uid, intent.profile), balance: total.balance, earnedTotal, ...rank,
        ...(rank.rankSnapshot ? { rankSnapshot: { ...rank.rankSnapshot, updatedAt: timestamp } } : {}),
        spentTotal: total.spentTotal, adjustedTotal: total.adjustedTotal, lastTransactionAt: timestamp,
      } });
      result.scopes.push(total.scope);
    }
    result.reclaimed = result.transactionIds.length > 0;
    result.blockedReason = result.reclaimed ? "" : result.repairedMarkerCount ? "reclaim_exists" : verified.rewardOrigins.length ? "already_reclaimed" : "reward_not_found";
    return { rewardOrigins: verified.rewardOrigins, result, mutations, migratedLegacyReclaims };
  };

  const apply = (transaction, planned) => {
    for (const mutation of planned.mutations) {
      const ref = db.doc(mutation.path);
      if (mutation.operation === "create") transaction.create(ref, mutation.data);
      else transaction.set(ref, mutation.data, { merge: true });
    }
    return planned.result;
  };
  return { read, plan, apply };
};

module.exports = { createHistoryDictionaryLegacyReward, validateMigrationEvidence, MAX_ORIGINS, DISCOVERY_LIMIT };
