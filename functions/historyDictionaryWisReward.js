// Native Firestore read -> pure plan -> write-only apply. The caller must keep
// word CAS, origins, business changes and its command receipt in this transaction.
const { HttpsError } = require("firebase-functions/v2/https");
const legacy = require("./historyDictionaryRewardOrigin");
const { validateMigrationEvidence } = require("./historyDictionaryLegacyReward");
const migrationFence = require("./wisMigrationFence");

const SYSTEM_ACTOR = "system:history-dictionary-reward";
const ACTIVITY_TYPE = "history_dictionary";
const RECLAIM_ACTIVITY_TYPE = "history_dictionary_reclaim";
const fail = (reason, message = "사전 보상 원장을 확인할 수 없습니다.") => {
  throw new HttpsError("failed-precondition", message, { reason: `HISTORY_DICTIONARY_WIS_${reason}` });
};
const id = value => typeof value === "string" && value.length > 0 && value.length <= 180 &&
  value === value.trim() && !/[\\/\x00-\x1f\x7f]/.test(value) && value !== "." && value !== "..";
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const object = value => value && typeof value === "object" && !Array.isArray(value);

const createHistoryDictionaryWisReward = ({ db, wisEconomy: wis, sha256, loadPolicy, getKstDateKey }) => {
  if (!db || !wis || typeof sha256 !== "function" || typeof loadPolicy !== "function" || typeof getKstDateKey !== "function")
    throw new Error("Dictionary Wis reward dependencies are incomplete.");
  const sourceIdFor = termId => `history-dictionary:${termId}`;
  const ledgerIdFor = (scope, accountId, type, sourceId) => `wisled_${sha256([scope, accountId, type, sourceId].join("\n"))}`;
  const ledgerPath = entryId => `${wis.WIS_LEDGER_COLLECTION}/${entryId}`;
  const accountPath = accountId => `${wis.WIS_ACCOUNT_COLLECTION}/${accountId}`;
  const economyPath = scope => `${wis.WIS_ECONOMY_COLLECTION}/${scope}`;
  const manifestPath = scope => `semester_manifests/${scope}`;
  const migratedIdentity = item => {
    const migration = require("./wisLegacyMigration");
    const semesterId = `${item.origin.year}-${item.origin.semester}`;
    const paths = migration.pathsFor(semesterId, item.origin.uid);
    const sourceId = `legacy-reclaim:${sha256(`${paths.migrationId}\n${item.rewardPath}`)}`;
    return { paths, sourceId, semesterId,
      entryId: ledgerIdFor(semesterId, paths.accountId, "LEGACY_RECLAIM", sourceId) };
  };
  const assertScope = scope => {
    if (!object(scope) || !/^\d{4}$/.test(scope.year) || typeof scope.year !== "string" ||
      !["1", "2"].includes(scope.semester) || scope.semesterId !== `${scope.year}-${scope.semester}`) fail("SCOPE_INVALID");
  };
  const originFor = (uid, termId, scope) => {
    assertScope(scope);
    const accountId = wis.accountIdFor(scope.semesterId, uid);
    return { ledgerKind: "canonical-wis", uid, termId, year: scope.year, semester: scope.semester,
      semesterId: scope.semesterId, accountId,
      ledgerEntryId: ledgerIdFor(scope.semesterId, accountId, "GRANT", sourceIdFor(termId)) };
  };
  const normalizeOrigins = (raw, uid) => {
    if (!Array.isArray(raw) || raw.length > 64) fail("ORIGINS_INVALID");
    const seen = new Set();
    return raw.map(value => {
      if (!object(value) || !id(value.termId) || value.termId.length > 80) fail("ORIGIN_INVALID");
      const expected = originFor(uid, value.termId, value);
      if (Object.keys(value).length !== Object.keys(expected).length ||
        Object.entries(expected).some(([key, entry]) => value[key] !== entry) || seen.has(expected.ledgerEntryId)) fail("ORIGIN_INVALID");
      seen.add(expected.ledgerEntryId);
      return expected;
    });
  };
  const validatePair = (origin, docs) => {
    const grant = docs.get(ledgerPath(origin.ledgerEntryId));
    const reversalId = ledgerIdFor(origin.semesterId, origin.accountId, "REVERSAL", origin.ledgerEntryId);
    const reversal = docs.get(ledgerPath(reversalId));
    if (!grant || grant.schemaVersion !== wis.WIS_SCHEMA_VERSION || grant.policyVersion !== wis.WIS_POLICY_VERSION ||
      grant.ledgerEntryId !== origin.ledgerEntryId || grant.semesterId !== origin.semesterId ||
      grant.accountId !== origin.accountId || grant.studentUid !== origin.uid || grant.type !== "GRANT" ||
      grant.activityType !== ACTIVITY_TYPE || grant.sourceId !== sourceIdFor(origin.termId) ||
      grant.actorUid !== SYSTEM_ACTOR || grant.actorRole !== "system" || !id(grant.commandId) || !id(grant.receiptId) ||
      !integer(grant.delta, 1) || !integer(grant.balanceBefore) || !integer(grant.balanceAfter) ||
      grant.balanceAfter !== grant.balanceBefore + grant.delta ||
      typeof grant.targetDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(grant.targetDate)) fail("GRANT_MISMATCH");
    if (!docs.has(ledgerPath(reversalId))) fail("REVERSAL_NOT_READ");
    if (reversal && (reversal.schemaVersion !== wis.WIS_SCHEMA_VERSION || reversal.policyVersion !== wis.WIS_POLICY_VERSION ||
      reversal.ledgerEntryId !== reversalId || reversal.semesterId !== origin.semesterId || reversal.accountId !== origin.accountId ||
      reversal.studentUid !== origin.uid || reversal.type !== "REVERSAL" || reversal.activityType !== RECLAIM_ACTIVITY_TYPE ||
      reversal.sourceId !== origin.ledgerEntryId || reversal.delta !== -grant.delta || reversal.reversedType !== "GRANT" ||
      reversal.reversedDelta !== grant.delta || reversal.actorUid !== SYSTEM_ACTOR || reversal.actorRole !== "system" ||
      !id(reversal.commandId) || !id(reversal.receiptId) || !integer(reversal.balanceBefore) || !integer(reversal.balanceAfter) ||
      reversal.balanceAfter !== reversal.balanceBefore + reversal.delta || reversal.targetDate !== grant.targetDate)) fail("REVERSAL_MISMATCH");
    const account = docs.get(accountPath(origin.accountId));
    if (!account || account.schemaVersion !== wis.WIS_SCHEMA_VERSION || account.policyVersion !== wis.WIS_POLICY_VERSION ||
      account.accountId !== origin.accountId || account.semesterId !== origin.semesterId || account.studentUid !== origin.uid)
      fail("ACCOUNT_MISMATCH");
    return { origin, grant, reversal, reversalId };
  };

  const read = async (transaction, rawIntent) => {
    const intent = { ...rawIntent, wordData: rawIntent.wordData || {} };
    if (!["award", "reclaim"].includes(intent.operation) || !id(intent.uid) || !id(intent.termId) || intent.termId.length > 80 ||
      !id(intent.commandId) || !id(intent.receiptId) || !id(intent.actorUid) || !object(intent.wordData) ||
      (Object.hasOwn(intent.wordData, "uid") && intent.wordData.uid !== intent.uid)) fail("INTENT_INVALID");
    const origins = normalizeOrigins(Object.hasOwn(intent.wordData, "wisRewardOrigins") ? intent.wordData.wisRewardOrigins : [], intent.uid);
    const legacyPlan = legacy.planRewardOriginReads({ uid: intent.uid, wordData: { uid: intent.uid,
      rewardOrigins: Object.hasOwn(intent, "legacyOrigins") ? intent.legacyOrigins : [] } });
    const migrated = intent.migratedLegacyReclaims ?? [];
    if (!Array.isArray(migrated) || migrated.length > 64 || (intent.operation !== "reclaim" && migrated.length)) fail("MIGRATED_ORIGINS_INVALID");
    const seenMigrated = new Set();
    for (const item of migrated) {
      const binding = legacyPlan.reads.find(entry => entry.rewardPath === item?.rewardPath);
      if (!binding || !object(item.origin) || !integer(item.amount, 1) || seenMigrated.has(item.rewardPath) ||
        Object.entries(binding.origin).some(([key, value]) => item.origin[key] !== value)) fail("MIGRATED_ORIGIN_INVALID");
      seenMigrated.add(item.rewardPath);
    }
    const candidate = intent.operation === "award" ? originFor(intent.uid, intent.termId, intent.activeScope) : null;
    const allOrigins = [...origins];
    if (candidate && !allOrigins.some(entry => entry.ledgerEntryId === candidate.ledgerEntryId)) allOrigins.push(candidate);
    const paths = new Set();
    for (const origin of allOrigins) {
      paths.add(ledgerPath(origin.ledgerEntryId));
      paths.add(ledgerPath(ledgerIdFor(origin.semesterId, origin.accountId, "REVERSAL", origin.ledgerEntryId)));
      paths.add(accountPath(origin.accountId));
      paths.add(economyPath(origin.semesterId));
      paths.add(manifestPath(origin.semesterId));
      paths.add(migrationFence.controlPath(origin.semesterId));
    }
    for (const item of migrated) {
      const identity = migratedIdentity(item);
      for (const path of [identity.paths.marker, identity.paths.opening, identity.paths.account,
        identity.paths.economy, identity.paths.manifest, identity.paths.control, ledgerPath(identity.entryId)]) paths.add(path);
    }
    for (const entry of legacyPlan.reads) { paths.add(entry.rewardPath); paths.add(entry.reclaimPath); }
    const docs = new Map(await Promise.all([...paths].map(async path => {
      const snapshot = await transaction.get(db.doc(path));
      return [path, snapshot.exists ? snapshot.data() : null];
    })));
    let policy = null, todayKey = null, dailyCount = 0;
    if (candidate) {
      policy = await loadPolicy(transaction, candidate.year, candidate.semester);
      todayKey = getKstDateKey();
      if (typeof todayKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(todayKey)) fail("DATE_INVALID");
      // Existing legacy claims cannot be represented by a newly introduced
      // counter. Transaction queries count both ledgers, including reversals'
      // original grants, and the account write fences concurrent new awards.
      const configuredCap = Math.max(1, Number(policy?.rewardPolicy?.historyDictionary?.maxDailyClaims || 4));
      const queryLimit = integer(configuredCap, 1) ? configuredCap : 1;
      const queries = [
        db.collection(`years/${candidate.year}/semesters/${candidate.semester}/point_transactions`)
          .where("uid", "==", intent.uid).where("type", "==", ACTIVITY_TYPE).where("targetDate", "==", todayKey).limit(queryLimit),
        db.collection(wis.WIS_LEDGER_COLLECTION).where("semesterId", "==", candidate.semesterId)
          .where("studentUid", "==", intent.uid).where("type", "==", "GRANT")
          .where("activityType", "==", ACTIVITY_TYPE).where("targetDate", "==", todayKey).limit(queryLimit),
      ];
      const daily = await Promise.all(queries.map(query => transaction.get(query)));
      dailyCount = daily.reduce((sum, snapshot) => sum + snapshot.size, 0);
    }
    return { intent, origins, candidate, legacyPlan, docs, policy, todayKey, dailyCount, migrated };
  };

  const plan = (readSet, { timestamp, concreteTimestamp }) => {
    if (!timestamp || !concreteTimestamp) fail("TIMESTAMP_REQUIRED");
    const { intent, docs, candidate, legacyPlan, policy, todayKey, dailyCount } = readSet;
    const origins = [...readSet.origins];
    // Validate legacy provenance without creating any legacy mutations here.
    const verifiedLegacy = legacy.planRewardReclaims({ uid: intent.uid, wordData: { uid: intent.uid, rewardOrigins: legacyPlan.origins },
      ledgerEntries: legacyPlan.reads.flatMap(entry => [entry.rewardPath, entry.reclaimPath])
        .map(path => ({ path, data: docs.get(path) })) });
    const pairs = origins.map(origin => validatePair(origin, docs));
    if (candidate && !origins.some(origin => origin.ledgerEntryId === candidate.ledgerEntryId)) {
      if (docs.get(ledgerPath(candidate.ledgerEntryId))) {
        if (origins.length >= 64) fail("ORIGINS_INVALID");
        pairs.push(validatePair(candidate, docs)); origins.push(candidate);
      } else if (docs.get(ledgerPath(ledgerIdFor(candidate.semesterId, candidate.accountId, "REVERSAL", candidate.ledgerEntryId)))) {
        fail("ORPHAN_REVERSAL");
      }
    }
    const result = { awarded: false, reclaimed: false, amount: 0, wisRewardOrigins: origins };
    let posts = [];
    if (candidate) {
      const duplicate = pairs.some(pair => pair.origin.semesterId === candidate.semesterId) ||
        legacyPlan.origins.some(origin => origin.year === candidate.year && origin.semester === candidate.semester);
      const rule = policy?.rewardPolicy?.historyDictionary || {};
      const qualityLength = String(intent.definition || "").replace(/\s+/g, "").length;
      const amount = Number(rule.amount ?? 0);
      const minLength = Math.max(1, Number(rule.minDefinitionLength || 20));
      const maxDailyClaims = Math.max(1, Number(rule.maxDailyClaims || 4));
      if (duplicate) result.blockedReason = "duplicate_source";
      else if (!policy?.autoRewardEnabled || rule.enabled !== true || amount <= 0) result.blockedReason = "policy_disabled";
      else if (qualityLength < minLength) result.blockedReason = "definition_too_short";
      else {
        if (!integer(amount, 1) || !integer(minLength, 1) || !integer(maxDailyClaims, 1)) fail("POLICY_INVALID");
        if (dailyCount >= maxDailyClaims) result.blockedReason = "daily_max_reached";
        else {
          posts = [{ origin: candidate, delta: amount, type: "GRANT", entryId: candidate.ledgerEntryId,
            sourceId: sourceIdFor(candidate.termId), targetDate: todayKey }];
          if (origins.length >= 64) fail("ORIGINS_INVALID");
          origins.push(candidate);
          Object.assign(result, { awarded: true, amount, ledgerEntryId: candidate.ledgerEntryId,
            claimCount: dailyCount + 1, maxDailyClaims });
        }
      }
    } else {
      posts = pairs.filter(pair => !pair.reversal).map(pair => ({ origin: pair.origin, delta: -pair.grant.delta,
        type: "REVERSAL", entryId: pair.reversalId, sourceId: pair.origin.ledgerEntryId,
        reversedType: "GRANT", reversedDelta: pair.grant.delta, targetDate: pair.grant.targetDate || null }));
      const validatedEvidence = new Set();
      for (const item of readSet.migrated) {
        const { paths, sourceId, semesterId, entryId } = migratedIdentity(item);
        const verified = verifiedLegacy.reclaims.find(entry => entry.rewardPath === item.rewardPath);
        if (!verified || verified.status !== "reclaim" || verified.amount !== item.amount) fail("MIGRATED_REWARD_MISMATCH");
        if (!validatedEvidence.has(item.evidence)) {
          validateMigrationEvidence({ ...item.evidence, semesterId, uid: intent.uid,
            marker: docs.get(paths.marker), opening: docs.get(paths.opening), account: docs.get(paths.account) });
          validatedEvidence.add(item.evidence);
        }
        const original = docs.get(item.rewardPath);
        const snapshotOriginal = item.evidence?.source?.snapshot?.transactions.find(row => row.path === item.rewardPath);
        const migration = require("./wisLegacyMigration");
        if (!snapshotOriginal || migration.canonical(original) !== migration.canonical(snapshotOriginal.data)) fail("MIGRATED_REWARD_MISMATCH");
        const fields = { sourceOriginalRewardPath: item.rewardPath, legacyMigrationId: paths.migrationId,
          openingLedgerEntryId: paths.openingId, legacyHash: item.evidence.source.legacyHash,
          totalsContribution: { earnedTotal: -item.amount, rankEarnedTotal: -item.amount, spentTotal: 0, adjustedTotal: 0 } };
        const existing = docs.get(ledgerPath(entryId));
        if (existing) {
          if (existing.schemaVersion !== wis.WIS_SCHEMA_VERSION || existing.policyVersion !== wis.WIS_POLICY_VERSION ||
            existing.ledgerEntryId !== entryId || existing.semesterId !== semesterId || existing.accountId !== paths.accountId ||
            existing.studentUid !== intent.uid || existing.type !== "LEGACY_RECLAIM" || existing.activityType !== RECLAIM_ACTIVITY_TYPE ||
            existing.sourceId !== sourceId || existing.delta !== -item.amount || existing.actorUid !== SYSTEM_ACTOR || existing.actorRole !== "system" ||
            !id(existing.commandId) || !id(existing.receiptId) || !integer(existing.balanceBefore) || !integer(existing.balanceAfter) ||
            existing.balanceAfter !== existing.balanceBefore + existing.delta || existing.targetDate !== String(original.targetDate || "") ||
            Object.entries(fields).some(([key, value]) => migration.canonical(existing[key]) !== migration.canonical(value))) fail("MIGRATED_RECLAIM_MISMATCH");
          continue;
        }
        posts.push({ origin: { ...item.origin, semesterId, accountId: paths.accountId }, delta: -item.amount,
          type: "LEGACY_RECLAIM", entryId, sourceId, targetDate: String(original.targetDate || ""), migrationFields: fields });
      }
      Object.assign(result, { reclaimed: posts.length > 0, amount: posts.reduce((sum, post) => sum - post.delta, 0),
        ledgerEntryIds: posts.map(post => post.entryId), blockedReason: posts.length ? "" : "already_reclaimed" });
    }
    const mutations = [], accounts = new Map(), economies = new Map();
    for (const post of posts) {
      const { origin } = post;
      migrationFence.assertControl(docs.get(migrationFence.controlPath(origin.semesterId)));
      let account = accounts.get(origin.accountId);
      if (!account) {
        const raw = docs.get(accountPath(origin.accountId));
        const economy = docs.get(economyPath(origin.semesterId));
        const manifest = docs.get(manifestPath(origin.semesterId));
        if (!manifest || manifest.semesterId !== origin.semesterId || manifest.status !== "ACTIVE" ||
          !economy || economy.semesterId !== origin.semesterId || economy.status !== "ACTIVE_OPEN" || economy.readOnly === true)
          fail("ECONOMY_CLOSED", "원래 보상 학기의 Wis가 닫혀 있어 처리하지 못했습니다.");
        if (!raw || raw.schemaVersion !== wis.WIS_SCHEMA_VERSION || raw.policyVersion !== wis.WIS_POLICY_VERSION ||
          raw.accountId !== origin.accountId || raw.semesterId !== origin.semesterId || raw.studentUid !== origin.uid ||
          raw.status !== "ACTIVE" || raw.readOnly === true || !integer(raw.revision, 1) ||
          !["balance", "earnedTotal", "rankEarnedTotal", "spentTotal"].every(key => integer(raw[key])) ||
          !Number.isSafeInteger(raw.adjustedTotal) || !integer(economy.ledgerEntryCount) ||
          (raw.recentLedgerEntries !== undefined && !Array.isArray(raw.recentLedgerEntries))) fail("ACCOUNT_INVALID");
        account = { ...raw, recentLedgerEntries: [...(raw.recentLedgerEntries || [])] };
        accounts.set(origin.accountId, account);
        if (!economies.has(origin.semesterId)) economies.set(origin.semesterId, { ...economy });
      }
      const after = account.balance + post.delta;
      if (!integer(after)) fail("INSUFFICIENT_BALANCE", "원래 보상 계좌의 Wis가 부족해 처리하지 못했습니다.");
      const ledger = { schemaVersion: wis.WIS_SCHEMA_VERSION, policyVersion: wis.WIS_POLICY_VERSION,
        ledgerEntryId: post.entryId, semesterId: origin.semesterId, accountId: origin.accountId, studentUid: intent.uid,
        type: post.type, activityType: post.type === "GRANT" ? ACTIVITY_TYPE : RECLAIM_ACTIVITY_TYPE,
        delta: post.delta, balanceBefore: account.balance, balanceAfter: after,
        sourceId: post.sourceId, targetDate: post.targetDate,
        reason: `${post.type === "GRANT" ? "역사 사전 단어 등록" : "역사 사전 보상 회수"}: ${String(intent.word || intent.termId).slice(0, 80)}`,
        actorUid: SYSTEM_ACTOR, actorRole: "system", initiatedByUid: intent.actorUid,
        commandId: intent.commandId, receiptId: intent.receiptId, createdAt: concreteTimestamp,
        ...(post.type === "REVERSAL" ? { reversedType: post.reversedType, reversedDelta: post.reversedDelta } : {}),
        ...(post.migrationFields || {}) };
      account.balance = after;
      for (const key of ["earnedTotal", "rankEarnedTotal", "adjustedTotal"]) {
        account[key] += post.type === "LEGACY_RECLAIM" ? post.migrationFields.totalsContribution[key] : post.delta;
        if (!Number.isSafeInteger(account[key]) || (key !== "adjustedTotal" && account[key] < 0)) fail("TOTALS_INVALID");
      }
      account.revision += 1;
      if (!integer(account.revision, 1)) fail("REVISION_INVALID");
      account.recentLedgerEntries = [ledger, ...account.recentLedgerEntries].slice(0, 100);
      const economy = economies.get(origin.semesterId);
      economy.ledgerEntryCount += 1;
      if (!integer(economy.ledgerEntryCount)) fail("ECONOMY_INVALID");
      mutations.push({ operation: "create", path: ledgerPath(post.entryId), data: ledger });
    }
    for (const account of accounts.values()) {
      const totals = Object.fromEntries(["balance", "earnedTotal", "rankEarnedTotal", "spentTotal", "adjustedTotal"].map(key => [key, account[key]]));
      const common = { schemaVersion: wis.WIS_SCHEMA_VERSION, policyVersion: wis.WIS_POLICY_VERSION,
        accountId: account.accountId, semesterId: account.semesterId, studentUid: account.studentUid,
        ledgerRevision: account.revision, updatedAt: timestamp };
      mutations.push({ operation: "set", path: accountPath(account.accountId), merge: true,
        data: { ...totals, revision: account.revision, recentLedgerEntries: account.recentLedgerEntries, updatedAt: timestamp, updatedBy: SYSTEM_ACTOR } },
      { operation: "set", path: `${wis.WIS_BALANCE_COLLECTION}/${account.accountId}`, merge: true, data: { ...common, ...totals } },
      { operation: "set", path: `${wis.WIS_RANKING_COLLECTION}/${account.accountId}`, merge: true, data: { ...common,
        displayName: account.displayName || "학생", classId: account.classId || "", grade: String(account.grade || ""),
        classNumber: String(account.classNumber || ""), balance: account.balance, rankEarnedTotal: account.rankEarnedTotal } });
    }
    for (const economy of economies.values()) mutations.push({ operation: "set", path: economyPath(economy.semesterId), merge: true,
      data: { ledgerEntryCount: economy.ledgerEntryCount, updatedAt: timestamp, updatedBy: SYSTEM_ACTOR } });
    if (candidate && accounts.has(candidate.accountId)) Object.assign(result, {
      balance: accounts.get(candidate.accountId).balance, accountRevision: accounts.get(candidate.accountId).revision });
    return { wisRewardOrigins: origins, result, mutations };
  };
  const apply = (transaction, planned) => {
    for (const mutation of planned.mutations) {
      const ref = db.doc(mutation.path);
      if (mutation.operation === "create") transaction.create(ref, mutation.data);
      else transaction.set(ref, mutation.data, { merge: true });
    }
    return planned.result;
  };
  return { read, plan, apply, originFor, ledgerIdFor, sourceIdFor };
};

module.exports = { createHistoryDictionaryWisReward, SYSTEM_ACTOR, ACTIVITY_TYPE, RECLAIM_ACTIVITY_TYPE };
