const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const wis = require("./wisEconomy");
const { buildEnrollmentSlotId } = require("./archiveEnrollment");

const COMMAND_TYPE = "migrateLegacyWisAccount";
const POLICY_VERSION = "wis-legacy-same-semester-v1";
const CONTROL_COLLECTION = "wis_legacy_migration_controls";
const MARKER_COLLECTION = "wis_legacy_account_migrations";
const OPENING_TYPE = "LEGACY_OPENING";
const MAX_SOURCE_ROWS = 1000;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const TOTAL_FIELDS = ["balance", "earnedTotal", "spentTotal", "adjustedTotal", "rankEarnedTotal"];
const LEGACY_TYPES = new Set([
  "attendance", "attendance_monthly_bonus", "attendance_milestone_bonus", "quiz", "quiz_bonus",
  "lesson", "lesson_core_points", "lesson_core_points_reclaim", "think_cloud", "map_tag",
  "history_dictionary", "history_dictionary_reclaim", "history_classroom", "history_classroom_bonus",
  "manual_adjust", "manual_reclaim", "purchase_hold", "purchase_confirm", "purchase_cancel",
]);
const fail = (reason, details = {}, code = "failed-precondition") => {
  throw new HttpsError(code, "위스 이전 사전 검증을 통과하지 못했습니다.", { reason, ...details });
};
const validUid = (value) => typeof value === "string" && value.length > 0 && value.length <= 128 &&
  value === value.trim() && !value.includes("/") && ![".", "..", "__proto__"].includes(value);
const validScope = (value) => typeof value === "string" && /^\d{4}-[12]$/.test(value);
const safe = (value) => Number.isSafeInteger(value);
const canonical = (value) => {
  const visit = (current) => {
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number" && Number.isFinite(current)) return current;
    if (current instanceof Date) return { timestamp: current.toISOString() };
    if (current && safe(current.seconds) && safe(current.nanoseconds) &&
        (typeof current.toMillis === "function" || Object.keys(current).every((key) => ["seconds", "nanoseconds"].includes(key))))
      return { timestampSeconds: current.seconds, timestampNanoseconds: current.nanoseconds };
    if (Array.isArray(current)) return current.map(visit);
    if (current && [Object.prototype, null].includes(Object.getPrototypeOf(current)))
      return Object.fromEntries(Object.keys(current).sort().filter((key) => current[key] !== undefined)
        .map((key) => [key, visit(current[key])]));
    fail("WIS_MIGRATION_SOURCE_VALUE_UNSUPPORTED");
  };
  return JSON.stringify(visit(value));
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const pathsFor = (semesterId, studentUid) => {
  if (!validScope(semesterId) || !validUid(studentUid)) fail("WIS_MIGRATION_PAYLOAD_INVALID", {}, "invalid-argument");
  const [year, semester] = semesterId.split("-");
  const scope = `years/${year}/semesters/${semester}`;
  const accountId = wis.accountIdFor(semesterId, studentUid);
  const migrationId = `legacy_${hash(`${scope}/point_wallets/${studentUid}\n${accountId}`)}`;
  const openingId = `legacy_opening_${hash(migrationId)}`;
  return {
    accountId, migrationId, openingId, scope,
    wallet: `${scope}/point_wallets/${studentUid}`,
    transactions: `${scope}/point_transactions`, orders: `${scope}/point_orders`,
    manifest: `semester_manifests/${semesterId}`, pointer: "site_settings/semester_active",
    maintenance: "site_settings/student_maintenance", control: `${CONTROL_COLLECTION}/${semesterId}`,
    user: `users/${studentUid}`, slot: `semester_enrollment_slots/${buildEnrollmentSlotId(semesterId, studentUid)}`,
    economy: `${wis.WIS_ECONOMY_COLLECTION}/${semesterId}`,
    account: `${wis.WIS_ACCOUNT_COLLECTION}/${accountId}`,
    balance: `${wis.WIS_BALANCE_COLLECTION}/${accountId}`,
    ranking: `${wis.WIS_RANKING_COLLECTION}/${accountId}`,
    marker: `${MARKER_COLLECTION}/${migrationId}`, opening: `${wis.WIS_LEDGER_COLLECTION}/${openingId}`,
  };
};
const normalizeLegacyWisMigrationPayload = (commandType, payload) => {
  const keys = ["semesterId", "studentUid", "expectedSemesterRevision", "expectedEconomyRevision",
    "expectedAccountRevision", "expectedLegacyHash", "reason"];
  if (commandType !== COMMAND_TYPE || !payload || typeof payload !== "object" || Array.isArray(payload) ||
      Object.keys(payload).some((key) => !keys.includes(key)) || !validScope(payload.semesterId) ||
      !validUid(payload.studentUid) || !/^[a-f0-9]{64}$/.test(payload.expectedLegacyHash || "") ||
      typeof payload.reason !== "string" || !payload.reason.trim() || payload.reason.trim().length > 500 ||
      keys.filter((key) => key.endsWith("Revision")).some((key) => !safe(payload[key]) || payload[key] < 1))
    fail("WIS_MIGRATION_PAYLOAD_INVALID", {}, "invalid-argument");
  return Object.fromEntries(keys.map((key) => [key, key === "reason" ? payload.reason.trim() : payload[key]]));
};
const blocker = (code, details = {}) => ({ code, ...details });

// Pure, deterministic source inspection. The caller supplies bounded snapshots.
// No source path is accepted from a client and no absent total is inferred.
const evaluateLegacyWisSource = ({ semesterId, studentUid, wallet, transactions, orders }) => {
  const paths = pathsFor(semesterId, studentUid), blockers = [];
  if (!wallet?.exists) blockers.push(blocker("LEGACY_WALLET_MISSING"));
  if (wallet?.data?.uid !== studentUid) blockers.push(blocker("LEGACY_WALLET_UID_MISMATCH"));
  if (wallet?.path !== paths.wallet) blockers.push(blocker("LEGACY_WALLET_PATH_MISMATCH"));
  if (transactions.length > MAX_SOURCE_ROWS || orders.length > MAX_SOURCE_ROWS)
    blockers.push(blocker("LEGACY_SOURCE_ROW_LIMIT", { limit: MAX_SOURCE_ROWS }));
  const canonicalRows = (rows) => rows.map((row) => ({ path: row.path, data: row.data }))
    .sort((a, b) => String(a.path).localeCompare(String(b.path)));
  const snapshot = { policyVersion: POLICY_VERSION, semesterId, studentUid,
    wallet: { path: paths.wallet, exists: Boolean(wallet?.exists), data: wallet?.data || null },
    transactions: canonicalRows(transactions), orders: canonicalRows(orders) };
  let bytes = 0, legacyHash = null;
  try { const encoded = canonical(snapshot); bytes = Buffer.byteLength(encoded); legacyHash = hash(encoded); }
  catch (error) { blockers.push(blocker("LEGACY_SOURCE_VALUE_UNSUPPORTED")); }
  if (bytes > MAX_SOURCE_BYTES) blockers.push(blocker("LEGACY_SOURCE_BYTE_LIMIT", { limit: MAX_SOURCE_BYTES }));
  const validateRows = (rows, collection) => {
    const seen = new Set();
    for (const row of rows) {
      const id = String(row.path || "").slice(collection.length + 1);
      if (!row.exists || !String(row.path).startsWith(`${collection}/`) || !id || id.includes("/") ||
          Buffer.byteLength(id) > 1500 || [".", ".."].includes(id) ||
          seen.has(row.path) || row.data?.uid !== studentUid)
        blockers.push(blocker("LEGACY_SOURCE_ROW_SCOPE_INVALID"));
      seen.add(row.path);
    }
  };
  validateRows(transactions, paths.transactions); validateRows(orders, paths.orders);
  const computed = { balance: 0, earnedTotal: 0, spentTotal: 0, adjustedTotal: 0, rankEarnedTotal: 0 };
  const balanceEdges = [];
  const add = (field, value) => {
    if (!safe(computed[field] + value)) blockers.push(blocker("LEGACY_TOTAL_OVERFLOW", { field }));
    else computed[field] += value;
  };
  for (const row of transactions) {
    const entry = row.data || {}, delta = entry.delta;
    if (!safe(delta) || !safe(entry.balanceAfter) || !LEGACY_TYPES.has(entry.type) ||
        (entry.reclaimed !== undefined && typeof entry.reclaimed !== "boolean")) {
      blockers.push(blocker("LEGACY_TRANSACTION_INVALID", { path: row.path })); continue;
    }
    if (!safe(entry.balanceAfter - delta)) blockers.push(blocker("LEGACY_TRANSACTION_INVALID", { path: row.path }));
    else balanceEdges.push({ before: entry.balanceAfter - delta, after: entry.balanceAfter });
    add("balance", delta);
    // Matches index.js calculatePointWalletTotals/shouldCountTowardsEarnedTotal.
    if (delta > 0 && entry.reclaimed !== true && entry.type !== "manual_reclaim" && !entry.type.startsWith("purchase_")) {
      add("earnedTotal", delta); add("rankEarnedTotal", delta);
    }
    if (["purchase_hold", "purchase_cancel"].includes(entry.type)) add("spentTotal", -delta);
    if (["manual_adjust", "manual_reclaim"].includes(entry.type)) add("adjustedTotal", delta);
  }
  // Timestamps can tie. Verify that every stored balanceAfter can participate in
  // one complete balance chain from zero, without inventing a chronological tie break.
  const outgoing = new Map();
  for (const edge of balanceEdges) {
    if (!outgoing.has(edge.before)) outgoing.set(edge.before, []);
    outgoing.get(edge.before).push(edge);
  }
  const stack = [{ node: 0, incoming: null }], trail = [];
  while (stack.length) {
    const next = outgoing.get(stack[stack.length - 1].node)?.pop();
    if (next) stack.push({ node: next.after, incoming: next });
    else { const done = stack.pop(); if (done.incoming) trail.push(done.incoming); }
  }
  let chainBalance = 0, chainValid = trail.length === transactions.length;
  for (const edge of trail.reverse()) {
    if (edge.before !== chainBalance) chainValid = false;
    chainBalance = edge.after;
  }
  if (!chainValid || chainBalance !== computed.balance) blockers.push(blocker("LEGACY_BALANCE_CHAIN_MISMATCH"));
  if (computed.spentTotal < 0) blockers.push(blocker("LEGACY_PURCHASE_TOTAL_INVALID"));
  const totals = Object.fromEntries(TOTAL_FIELDS.map((field) => [field, wallet?.data?.[field]]));
  for (const field of TOTAL_FIELDS) {
    if (!safe(totals[field]) || (field !== "adjustedTotal" && totals[field] < 0))
      blockers.push(blocker(field === "balance" && totals[field] < 0 ? "LEGACY_NEGATIVE_BALANCE" : "LEGACY_TOTAL_INVALID", { field }));
    else if (totals[field] !== computed[field]) blockers.push(blocker("LEGACY_TOTAL_MISMATCH", { field, stored: totals[field], computed: computed[field] }));
  }
  if (wallet?.data?.transactionCount !== undefined && wallet.data.transactionCount !== transactions.length)
    blockers.push(blocker("LEGACY_TRANSACTION_COUNT_MISMATCH"));
  for (const row of orders) {
    if (["requested", "approved"].includes(row.data?.status)) blockers.push(blocker("LEGACY_PENDING_ORDER", { path: row.path }));
    else if (!["fulfilled", "rejected", "cancelled"].includes(row.data?.status)) blockers.push(blocker("LEGACY_ORDER_STATE_INVALID", { path: row.path }));
  }
  return { status: blockers.length ? "BLOCKED" : "READY", blockers, legacyHash, totals, computed,
    transactionCount: transactions.length, orderCount: orders.length, sourceByteCount: bytes,
    sourceRefs: { wallet: paths.wallet, transactions: paths.transactions, orders: paths.orders }, snapshot };
};
const readLegacyWisMigrationSource = async ({ transaction, semesterId, studentUid }) => {
  const paths = pathsFor(semesterId, studentUid);
  const wallet = await transaction.get(paths.wallet);
  const query = { filters: [{ field: "uid", operator: "==", value: studentUid }], limit: MAX_SOURCE_ROWS + 1 };
  const transactions = await transaction.query(paths.transactions, query);
  const orders = await transaction.query(paths.orders, query);
  return evaluateLegacyWisSource({ semesterId, studentUid, wallet, transactions, orders });
};
const loadLegacyWisMigrationPreflight = async ({ transaction, payload, actor }) => {
  if (actor?.actorRole !== "admin" || !validUid(actor?.actorUid) ||
      String(actor.actorEmail || "").toLowerCase() !== "westoria28@gmail.com")
    fail("WIS_MIGRATION_ADMIN_REQUIRED", {}, "permission-denied");
  payload = normalizeLegacyWisMigrationPayload(COMMAND_TYPE, payload);
  const paths = pathsFor(payload.semesterId, payload.studentUid);
  const names = ["manifest", "pointer", "maintenance", "control", "user", "slot", "economy", "account", "balance", "ranking", "marker", "opening"];
  const rows = await transaction.getAll(names.map((name) => paths[name]));
  const state = Object.fromEntries(names.map((name, index) => [name, rows[index]]));
  const blockers = [], data = (name) => state[name]?.data || {};
  if (!state.maintenance.exists || data("maintenance").enabled !== true) blockers.push(blocker("MAINTENANCE_REQUIRED"));
  if (!state.control.exists || data("control").enabled !== true || data("control").writesBlocked !== true || data("control").semesterId !== payload.semesterId)
    blockers.push(blocker("WIS_WRITER_FENCE_REQUIRED"));
  if (!state.manifest.exists || data("manifest").status !== "ACTIVE" || data("manifest").semesterId !== payload.semesterId || data("manifest").revision !== payload.expectedSemesterRevision)
    blockers.push(blocker("ACTIVE_SEMESTER_REVISION_REQUIRED"));
  if (!state.pointer.exists || data("pointer").semesterId !== payload.semesterId || data("pointer").revision !== payload.expectedSemesterRevision)
    blockers.push(blocker("ACTIVE_SEMESTER_POINTER_MISMATCH"));
  if (!state.user.exists || data("user").role !== "student") blockers.push(blocker("STUDENT_IDENTITY_REQUIRED"));
  const enrollmentId = data("slot").activeEnrollmentId;
  const enrollment = validUid(enrollmentId) ? await transaction.get(`semester_enrollments/${enrollmentId}`) : null;
  const enrollmentData = enrollment?.data || {};
  const classRow = validUid(enrollmentData.classId) ? await transaction.get(`semester_classes/${enrollmentData.classId}`) : null;
  if (data("slot").semesterId !== payload.semesterId || data("slot").studentUid !== payload.studentUid ||
      !enrollment?.exists || enrollmentData.semesterId !== payload.semesterId || enrollmentData.studentUid !== payload.studentUid ||
      enrollmentData.enrollmentStatus !== "ACTIVE" || enrollmentData.enrollmentId !== enrollmentId ||
      !classRow?.exists || classRow.data?.semesterId !== payload.semesterId || classRow.data?.status !== "ACTIVE")
    blockers.push(blocker("ACTIVE_ENROLLMENT_REQUIRED"));
  for (const name of ["account", "balance", "ranking"]) {
    if (!state[name].exists || data(name).accountId !== paths.accountId || data(name).studentUid !== payload.studentUid || data(name).semesterId !== payload.semesterId)
      blockers.push(blocker("CANONICAL_ACCOUNT_SCOPE_MISMATCH", { projection: name }));
  }
  if (data("account").enrollmentId !== enrollmentId || data("account").classId !== enrollmentData.classId)
    blockers.push(blocker("CANONICAL_ENROLLMENT_MISMATCH"));
  if (data("account").status !== "ACTIVE" || data("account").readOnly !== false || data("account").provenance !== "CURRENT")
    blockers.push(blocker("CANONICAL_ACCOUNT_NOT_CURRENT"));
  if (!state.economy.exists || data("economy").semesterId !== payload.semesterId || !["ACTIVE_INITIALIZING", "ACTIVE_OPEN"].includes(data("economy").status))
    blockers.push(blocker("CANONICAL_ECONOMY_REQUIRED"));
  if (blockers.length) return { status: "BLOCKED", blockers, paths };
  const source = await readLegacyWisMigrationSource({ transaction, semesterId: payload.semesterId, studentUid: payload.studentUid });
  blockers.push(...source.blockers);
  if (source.legacyHash !== payload.expectedLegacyHash) blockers.push(blocker("LEGACY_SOURCE_HASH_CHANGED"));
  if (state.marker.exists) {
    const marker = data("marker"), opening = data("opening");
    if (marker.status !== "MIGRATED" || marker.policyVersion !== POLICY_VERSION || marker.legacyHash !== source.legacyHash ||
        marker.accountId !== paths.accountId || marker.studentUid !== payload.studentUid || marker.semesterId !== payload.semesterId ||
        marker.migrationId !== paths.migrationId || marker.openingLedgerEntryId !== paths.openingId ||
        canonical(marker.totals || null) !== canonical(source.totals) ||
        data("account").legacyMigrationId !== paths.migrationId ||
        !state.opening.exists || opening.type !== OPENING_TYPE || opening.sourceId !== paths.migrationId ||
        opening.legacyHash !== source.legacyHash || opening.accountId !== paths.accountId ||
        opening.studentUid !== payload.studentUid || opening.semesterId !== payload.semesterId ||
        opening.delta !== source.totals.balance || opening.balanceBefore !== 0 || opening.balanceAfter !== source.totals.balance ||
        canonical(opening.openingTotals || null) !== canonical(source.totals)) blockers.push(blocker("MIGRATION_MARKER_CONFLICT"));
    return { status: blockers.length ? "BLOCKED" : "ALREADY_MIGRATED", blockers, paths, source, state };
  }
  if (data("account").revision !== payload.expectedAccountRevision || data("economy").revision !== payload.expectedEconomyRevision)
    blockers.push(blocker("CANONICAL_REVISION_CHANGED"));
  for (const name of ["account", "balance"]) {
    if (TOTAL_FIELDS.some((field) => data(name)[field] !== 0)) blockers.push(blocker("CANONICAL_ACCOUNT_NOT_EMPTY", { projection: name }));
  }
  if (data("ranking").balance !== 0 || data("ranking").rankEarnedTotal !== 0 ||
      data("balance").ledgerRevision !== payload.expectedAccountRevision || data("ranking").ledgerRevision !== payload.expectedAccountRevision)
    blockers.push(blocker("CANONICAL_PROJECTION_NOT_EMPTY"));
  if (data("account").initialGrantLedgerEntryId || data("account").legacyMigrationId ||
      !Array.isArray(data("account").recentLedgerEntries) || data("account").recentLedgerEntries.length || state.opening.exists)
    blockers.push(blocker("CANONICAL_ACTIVITY_EXISTS"));
  const ledger = await transaction.query(wis.WIS_LEDGER_COLLECTION, { filters: [{ field: "accountId", operator: "==", value: paths.accountId }], limit: 1 });
  const canonicalOrders = await transaction.query(wis.WIS_ORDER_COLLECTION, { filters: [{ field: "accountId", operator: "==", value: paths.accountId }], limit: 1 });
  if (ledger.length || canonicalOrders.length) blockers.push(blocker("CANONICAL_ACTIVITY_EXISTS"));
  for (const field of ["ledgerEntryCount", "legacyMigrationCount"]) {
    const value = data("economy")[field] ?? 0;
    if (!safe(value) || value < 0 || !safe(value + 1)) blockers.push(blocker("ECONOMY_COUNT_INVALID", { field }));
  }
  const accountCount = data("economy").accountCount;
  const initializedAccountCount = data("economy").initializedAccountCount;
  if (!safe(accountCount) || accountCount < 1 || !safe(initializedAccountCount) ||
      initializedAccountCount < 0 || !safe(initializedAccountCount + 1))
    blockers.push(blocker("ECONOMY_INITIALIZATION_COUNT_INVALID"));
  else if (initializedAccountCount + 1 > accountCount)
    blockers.push(blocker("ECONOMY_INITIALIZATION_COUNT_EXCEEDED", { accountCount, initializedAccountCount }));
  if (!safe(payload.expectedAccountRevision + 1) || !safe(payload.expectedEconomyRevision + 1)) blockers.push(blocker("REVISION_OVERFLOW"));
  const beforeSnapshot = Object.fromEntries(["account", "balance", "ranking", "economy"].map((name) => [name, data(name)]));
  if (Buffer.byteLength(canonical(beforeSnapshot)) > 512 * 1024) blockers.push(blocker("TARGET_SNAPSHOT_BYTE_LIMIT"));
  return { status: blockers.length ? "BLOCKED" : "READY", blockers, paths, source, state, beforeSnapshot };
};
const createLegacyWisMigrationAdapter = ({ projectId } = {}) => ({
  apply: async ({ transaction, commandType, payload, actor, commandId, receiptId, timestamp, concreteTimestamp }) => {
    if (projectId !== "westory-staging-177587430482" && !/^demo-[a-z0-9-]+$/.test(projectId || ""))
      fail("WIS_MIGRATION_PROJECT_FORBIDDEN", {}, "permission-denied");
    if (commandType !== COMMAND_TYPE) fail("WIS_MIGRATION_COMMAND_UNSUPPORTED", {}, "invalid-argument");
    payload = normalizeLegacyWisMigrationPayload(commandType, payload);
    const preflight = await loadLegacyWisMigrationPreflight({ transaction, payload, actor });
    if (preflight.status === "BLOCKED") fail("WIS_MIGRATION_BLOCKED", { blockers: preflight.blockers });
    const { paths, source } = preflight;
    if (preflight.state.marker.exists && preflight.state.marker.data.projectId !== projectId)
      fail("WIS_MIGRATION_MARKER_PROJECT_CONFLICT");
    if (preflight.status === "ALREADY_MIGRATED") return {
      target: { kind: "wis-legacy-account-migration", id: paths.migrationId, refs: [paths.marker, paths.opening, paths.account] },
      sourceHash: source.legacyHash, result: { migrationId: paths.migrationId, accountId: paths.accountId, migrated: false, alreadyMigrated: true, addedBalance: 0 },
    };
    const economy = preflight.state.economy.data;
    const accountRevision = payload.expectedAccountRevision + 1, economyRevision = payload.expectedEconomyRevision + 1;
    const opening = { schemaVersion: wis.WIS_SCHEMA_VERSION, policyVersion: wis.WIS_POLICY_VERSION,
      ledgerEntryId: paths.openingId, semesterId: payload.semesterId, accountId: paths.accountId, studentUid: payload.studentUid,
      type: OPENING_TYPE, delta: source.totals.balance, balanceBefore: 0, balanceAfter: source.totals.balance,
      openingTotals: source.totals, legacyHash: source.legacyHash, sourceTransactionCount: source.transactionCount,
      sourceId: paths.migrationId, reason: payload.reason, actorUid: actor.actorUid, actorRole: actor.actorRole,
      commandId, receiptId, createdAt: concreteTimestamp || timestamp };
    const patch = { ...source.totals, legacyMigrationId: paths.migrationId, updatedAt: timestamp, updatedBy: actor.actorUid };
    transaction.create(paths.opening, opening);
    transaction.set(paths.account, { ...patch, revision: accountRevision, recentLedgerEntries: [opening] }, { merge: true });
    transaction.set(paths.balance, { ...patch, ledgerRevision: accountRevision }, { merge: true });
    transaction.set(paths.ranking, { balance: source.totals.balance, rankEarnedTotal: source.totals.rankEarnedTotal,
      legacyMigrationId: paths.migrationId, ledgerRevision: accountRevision, updatedAt: timestamp }, { merge: true });
    transaction.set(paths.economy, { revision: economyRevision, ledgerEntryCount: (economy.ledgerEntryCount || 0) + 1,
      legacyMigrationCount: (economy.legacyMigrationCount || 0) + 1,
      initializedAccountCount: economy.initializedAccountCount + 1,
      updatedAt: timestamp, updatedBy: actor.actorUid }, { merge: true });
    transaction.create(paths.marker, { schemaVersion: 1, policyVersion: POLICY_VERSION, status: "MIGRATED",
      migrationId: paths.migrationId, semesterId: payload.semesterId, studentUid: payload.studentUid, accountId: paths.accountId,
      projectId, legacyHash: source.legacyHash, sourceRefs: source.sourceRefs, sourceTransactionCount: source.transactionCount,
      sourceOrderCount: source.orderCount, sourceByteCount: source.sourceByteCount, totals: source.totals,
      openingLedgerEntryId: paths.openingId, beforeSnapshot: preflight.beforeSnapshot,
      beforeSnapshotHash: hash(canonical(preflight.beforeSnapshot)),
      rollback: { policy: "MANUAL_RECONCILIATION_REQUIRED", sourceMutationAllowed: false, automaticDeletionAllowed: false },
      accountRevision, economyRevision, commandId, receiptId, createdAt: timestamp, createdBy: actor.actorUid });
    return { target: { kind: "wis-legacy-account-migration", id: paths.migrationId,
      refs: [paths.marker, paths.opening, paths.account, paths.balance, paths.ranking, paths.economy] },
    sourceHash: source.legacyHash, result: { migrationId: paths.migrationId, accountId: paths.accountId,
      openingLedgerEntryId: paths.openingId, migrated: true, alreadyMigrated: false,
      addedBalance: source.totals.balance, totals: source.totals, sourceTransactionCount: source.transactionCount,
      accountRevision, economyRevision } };
  },
});

module.exports = { COMMAND_TYPE, POLICY_VERSION, CONTROL_COLLECTION, MARKER_COLLECTION, OPENING_TYPE,
  MAX_SOURCE_ROWS, MAX_SOURCE_BYTES, TOTAL_FIELDS, pathsFor, canonical,
  normalizeLegacyWisMigrationPayload, evaluateLegacyWisSource, readLegacyWisMigrationSource,
  loadLegacyWisMigrationPreflight, createLegacyWisMigrationAdapter };
