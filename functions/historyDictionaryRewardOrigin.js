// Pure server-side plans. Callers supply transaction-read ledger snapshots, not
// request payloads. A new award ledger must be server-built and committed with
// the returned origins in the SAME transaction. No scope is inferred from a
// word's current year/semester, request origin, or caller-selected semester.
const { HttpsError } = require("firebase-functions/v2/https");

const fail = (reason = "HISTORY_DICTIONARY_REWARD_ORIGIN_MISMATCH") => {
  throw new HttpsError(
    "failed-precondition",
    "보상 지급 기록의 연결을 확인할 수 없습니다. 원래 지급 기록을 확인해 주세요.",
    { reason },
  );
};
const unverified = () => fail("HISTORY_DICTIONARY_REWARD_ORIGIN_UNVERIFIED");
const pathId = (value, max) =>
  typeof value === "string" && value.length > 0 && value.length <= max &&
  value === value.trim() && !/[\/\\\x00-\x1f\x7f]/.test(value) &&
  value !== "." && value !== "..";
// Keep the existing activity ledger ID contract, including legacy term IDs.
const sanitizeKeyPart = value => String(value || "").trim()
  .replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120) || "empty";
const getRewardSourceId = termId => `history-dictionary:${sanitizeKeyPart(termId)}`;
const getRewardTransactionId = (uid, termId) =>
  `activity_${sanitizeKeyPart(uid)}_history_dictionary_${sanitizeKeyPart(getRewardSourceId(termId))}`;

const normalizeOrigin = (value, uid) => {
  if (!pathId(uid, 128) || !value || typeof value !== "object" || Array.isArray(value)) fail();
  const keys = ["ledgerKind", "uid", "termId", "year", "semester", "transactionId"];
  if (Object.keys(value).some(key => !keys.includes(key)) ||
      value.ledgerKind !== "legacy-point" || value.uid !== uid || !pathId(value.termId, 80) ||
      typeof value.year !== "string" || !/^\d{4}$/.test(value.year) ||
      !["1", "2"].includes(value.semester) ||
      value.transactionId !== getRewardTransactionId(uid, value.termId)) fail();
  return Object.fromEntries(keys.map(key => [key, value[key]]));
};
const rewardPath = origin =>
  `years/${origin.year}/semesters/${origin.semester}/point_transactions/${origin.transactionId}`;
const normalizeOrigins = (origins, uid) => {
  if (!Array.isArray(origins)) fail();
  const seen = new Set();
  return origins.map(value => {
    const origin = normalizeOrigin(value, uid), path = rewardPath(origin);
    // Repeated paths could double-debit a wallet; never silently deduplicate
    // persisted corruption, including sanitizer collisions between term IDs.
    if (seen.has(path)) fail();
    seen.add(path);
    return origin;
  });
};
const hasLegacyRewardEvidence = record => Boolean(
  record.rewardTransactionId || record.rewardAwardedAt || Number(record.rewardAmount || 0) > 0,
);

const planRewardOriginReads = ({ uid, wordData = {} }) => {
  if (!pathId(uid, 128) || !wordData || typeof wordData !== "object" || Array.isArray(wordData)) fail();
  if (Object.hasOwn(wordData, "uid") && wordData.uid !== uid) fail();
  const explicit = Object.hasOwn(wordData, "rewardOrigins");
  const origins = explicit ? normalizeOrigins(wordData.rewardOrigins, uid) : [];
  if (explicit && !origins.length && hasLegacyRewardEvidence(wordData)) fail();
  return {
    origins,
    // A legacy row can have lost compatibility metadata. Discover its actual
    // ledgers even when rewardAmount is zero; a brand-new absent row is {}.
    legacyNeedsDiscovery: !explicit && Boolean(wordData.termId || wordData.rewardTermId || hasLegacyRewardEvidence(wordData)),
    legacyUnverified: !explicit && hasLegacyRewardEvidence(wordData),
    reads: origins.map(origin => ({ origin, rewardPath: rewardPath(origin), reclaimPath: `${rewardPath(origin)}_reclaim` })),
  };
};

const ledgerMap = entries => {
  if (!Array.isArray(entries)) fail();
  const result = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.path !== "string" || result.has(entry.path) ||
        (entry.data !== null && (typeof entry.data !== "object" || Array.isArray(entry.data)))) fail();
    result.set(entry.path, entry.data);
  }
  return result;
};

const assertRewardLedger = (origin, reward) => {
  const sourceId = getRewardSourceId(origin.termId);
  if (!reward) unverified();
  if (reward.uid !== origin.uid || reward.type !== "history_dictionary" ||
      reward.sourceId !== sourceId || typeof reward.delta !== "number" ||
      !Number.isFinite(reward.delta) || reward.delta <= 0 ||
      (Object.hasOwn(reward, "reclaimed") && typeof reward.reclaimed !== "boolean")) fail();
};
const validateLedgerPair = (origin, ledgers) => {
  const path = rewardPath(origin), reclaimPath = `${path}_reclaim`;
  // Explicit null proves a missing reclaim was read; omitted snapshots do not.
  if (!ledgers.has(path) || !ledgers.has(reclaimPath)) unverified();
  const reward = ledgers.get(path), reclaim = ledgers.get(reclaimPath);
  const sourceId = getRewardSourceId(origin.termId);
  assertRewardLedger(origin, reward);
  if (reclaim && (reclaim.uid !== origin.uid || reclaim.type !== "history_dictionary_reclaim" ||
      reclaim.sourceId !== sourceId || typeof reclaim.delta !== "number" ||
      !Number.isFinite(reclaim.delta) || reclaim.delta !== -reward.delta)) fail();
  if (reward.reclaimed === true && !reclaim) fail();
  return {
    origin, rewardPath: path, reclaimPath, amount: reward.delta,
    status: reclaim ? reward.reclaimed === true ? "already-reclaimed" : "repair-marker" : "reclaim",
  };
};

// This only proposes reads from an ACTUALLY DISCOVERED reward document path.
// It cannot manufacture a path using legacy word.year or rewardTransactionId.
// Query discovery itself belongs to the trusted writer and must be completed
// before any transaction writes. Re-read these paths inside that transaction.
const planLegacyRewardOriginBackfill = ({ uid, wordData, rewardLedgers }) => {
  const existing = planRewardOriginReads({ uid, wordData });
  if (Object.hasOwn(wordData, "rewardOrigins") || !Array.isArray(rewardLedgers)) fail();
  const termId = wordData.rewardTermId || wordData.termId;
  if (!pathId(termId, 80)) unverified();
  const origins = rewardLedgers.map(entry => {
    const match = typeof entry?.path === "string" && entry.path.match(
      /^years\/(\d{4})\/semesters\/([12])\/point_transactions\/([^/]+)$/,
    );
    if (!match || !entry.data) unverified();
    const origin = normalizeOrigin({ ledgerKind: "legacy-point", uid, termId, year: match[1], semester: match[2], transactionId: match[3] }, uid);
    // Discovery validates the award but does not assume the reclaim is absent.
    // verifyStoredOrigins below still requires actual transaction pair reads.
    assertRewardLedger(origin, entry.data);
    return origin;
  });
  if (existing.legacyUnverified && !origins.length) unverified();
  return { rewardOrigins: normalizeOrigins(origins, uid), reads: origins.map(origin => ({
    origin, rewardPath: rewardPath(origin), reclaimPath: `${rewardPath(origin)}_reclaim`,
  })) };
};

const verifyStoredOrigins = ({ uid, wordData = {}, ledgerEntries, legacyRewardOrigins }) => {
  const plan = planRewardOriginReads({ uid, wordData });
  let origins = plan.origins;
  if (plan.legacyNeedsDiscovery && legacyRewardOrigins === undefined) unverified();
  if (legacyRewardOrigins !== undefined) {
    if (Object.hasOwn(wordData, "rewardOrigins")) fail();
    const candidates = normalizeOrigins(legacyRewardOrigins, uid);
    const termId = wordData.rewardTermId || wordData.termId;
    if (!pathId(termId, 80) || candidates.some(origin => origin.termId !== termId)) fail();
    origins = candidates;
  }
  if (plan.legacyUnverified && !origins.length) unverified();
  const ledgers = ledgerMap(ledgerEntries);
  const verified = origins.map(origin => validateLedgerPair(origin, ledgers));
  return { rewardOrigins: origins, verified };
};

const planRewardReclaims = options => {
  const { rewardOrigins, verified } = verifyStoredOrigins(options);
  return {
    rewardOrigins,
    reclaims: verified,
    // Caller must read ALL original wallets/policies before staging any write.
    scopes: [...new Map(verified.filter(item => item.status === "reclaim")
      .map(({ origin }) => [`${origin.year}/${origin.semester}`, { year: origin.year, semester: origin.semester }])).values()],
  };
};

const planAppendRewardOrigin = ({ newOrigin, newRewardLedger, ...options }) => {
  const { rewardOrigins } = verifyStoredOrigins(options);
  if (!newOrigin && !newRewardLedger) return { rewardOrigins };
  const origin = normalizeOrigin(newOrigin, options.uid), path = rewardPath(origin);
  if (!newRewardLedger || newRewardLedger.path !== path) fail();
  const existing = rewardOrigins.find(item => rewardPath(item) === path);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(origin)) fail();
    // A replay must use the already read original ledger, never a new amount.
    const read = ledgerMap(options.ledgerEntries).get(path);
    assertRewardLedger(origin, newRewardLedger.data);
    if (!read || read.delta !== newRewardLedger.data.delta || read.reclaimed !== newRewardLedger.data.reclaimed) fail();
    return { rewardOrigins };
  }
  validateLedgerPair(origin, new Map([[path, newRewardLedger.data], [`${path}_reclaim`, null]]));
  return { rewardOrigins: [...rewardOrigins, origin] };
};

module.exports = {
  getRewardSourceId,
  getRewardTransactionId,
  planRewardOriginReads,
  planLegacyRewardOriginBackfill,
  planRewardReclaims,
  planAppendRewardOrigin,
};
