const { HttpsError } = require("firebase-functions/v2/https");
const semester = require("./semesterCore");
const archive = require("./archiveEnrollment");
const migrationFence = require("./wisMigrationFence");
const COMMAND_TYPE = "claimMapTagReward";
const SYSTEM_ACTOR = "system:map-tag-reward";
const safe = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const key = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value) &&
  !["__proto__", "constructor", "prototype"].includes(value);
const fail = (reason, code = "failed-precondition") => {
  throw new HttpsError(code, "지도 태그 보상 정보를 확인할 수 없습니다.", { reason: "MAP_REWARD_" + reason });
};
const normalizePayload = (_type, raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      Object.keys(raw).some(name => !["semesterId", "mapId", "tag", "interactionId"].includes(name)) ||
      !key(raw.mapId) || !key(raw.interactionId) || typeof raw.tag !== "string" ||
      !raw.tag.trim() || raw.tag.length > 200 || /[\x00-\x1f\x7f]/.test(raw.tag)) fail("PAYLOAD_INVALID", "invalid-argument");
  return { semesterId: semester.normalizeSemesterId(raw.semesterId), mapId: raw.mapId, tag: raw.tag.trim(), interactionId: raw.interactionId };
};
const millis = value => typeof value?.toMillis === "function" ? value.toMillis()
  : Number(value?.seconds || 0) * 1000 + Math.floor(Number(value?.nanoseconds || 0) / 1000000);

// A student requests only an interaction, never an amount, owner UID or ledger path.
// All authorization, map validation and both old/new reward history reads precede writes.
const createAdapter = ({ wis, writeProjection, ledgerIdFor, loadPolicy }) => ({
  apply: async ({ transaction, payload, actor, commandId, receiptId, concreteTimestamp }) => {
    if (!actor?.actorUid || actor.actorRole !== "student") fail("STUDENT_REQUIRED", "permission-denied");
    const uid = actor.actorUid, scope = payload.semesterId, nowMs = millis(concreteTimestamp);
    if (!safe(nowMs, 1)) fail("CLOCK_INVALID");
    const accountId = wis.accountIdFor(scope, uid), accountPath = wis.WIS_ACCOUNT_COLLECTION + "/" + accountId;
    const economyPath = wis.WIS_ECONOMY_COLLECTION + "/" + scope;
    const [pointer, manifest, profile, identity, slot, accountDoc, economyDoc, fence] = await transaction.getAll([
      semester.ACTIVE_SEMESTER_POINTER_PATH, semester.SEMESTER_MANIFEST_COLLECTION + "/" + scope,
      "users/" + uid, "student_identities/" + uid,
      archive.ENROLLMENT_SLOT_COLLECTION + "/" + archive.buildEnrollmentSlotId(scope, uid),
      accountPath, economyPath, migrationFence.controlPath(scope),
    ]);
    migrationFence.assertControl(fence.data);
    if (!pointer.exists || pointer.data?.semesterId !== scope || !manifest.exists || manifest.data?.semesterId !== scope ||
        manifest.data.status !== "ACTIVE" || manifest.data.readOnly === true || !safe(manifest.data.revision, 1) ||
        pointer.data.revision !== manifest.data.revision) fail("SEMESTER_INACTIVE");
    if (!profile.exists || profile.data?.role !== "student" ||
        (Object.hasOwn(profile.data, "registrationApprovalStatus") && profile.data.registrationApprovalStatus !== "APPROVED") ||
        !identity.exists || identity.data?.studentUid !== uid ||
        (identity.data.accountStatus !== undefined && identity.data.accountStatus !== "ACTIVE")) fail("STUDENT_INACTIVE", "permission-denied");
    if (!slot.exists || slot.data?.semesterId !== scope || slot.data.studentUid !== uid ||
        (slot.data.status !== undefined && slot.data.status !== "ACTIVE") || !key(slot.data.activeEnrollmentId)) fail("ENROLLMENT_INVALID");
    const enrollment = await transaction.get(archive.SEMESTER_ENROLLMENT_COLLECTION + "/" + slot.data.activeEnrollmentId);
    const enrolled = enrollment.data || {};
    if (!enrollment.exists || enrolled.enrollmentId !== slot.data.activeEnrollmentId || enrolled.studentUid !== uid ||
        enrolled.semesterId !== scope || enrolled.enrollmentStatus !== "ACTIVE" || enrolled.readOnly === true || !key(enrolled.classId)) fail("ENROLLMENT_INVALID");
    const classDoc = await transaction.get(archive.SEMESTER_CLASS_COLLECTION + "/" + enrolled.classId);
    if (!classDoc.exists || classDoc.data?.semesterId !== scope || classDoc.data.classId !== enrolled.classId ||
        classDoc.data.status !== "ACTIVE" || classDoc.data.readOnly === true) fail("CLASS_INACTIVE");
    const account = accountDoc.data || {}, economy = economyDoc.data || {};
    if (!accountDoc.exists || account.schemaVersion !== wis.WIS_SCHEMA_VERSION || account.policyVersion !== wis.WIS_POLICY_VERSION ||
        account.accountId !== accountId || account.semesterId !== scope || account.studentUid !== uid ||
        account.status !== "ACTIVE" || account.readOnly === true || account.enrollmentId !== enrolled.enrollmentId ||
        account.classId !== enrolled.classId || !safe(account.revision, 1) ||
        !["balance", "earnedTotal", "rankEarnedTotal", "spentTotal"].every(name => safe(account[name])) ||
        !Number.isSafeInteger(account.adjustedTotal) || !Array.isArray(account.recentLedgerEntries)) fail("ACCOUNT_INVALID");
    if (!economyDoc.exists || economy.semesterId !== scope || economy.status !== "ACTIVE_OPEN" ||
        economy.readOnly === true || !safe(economy.revision, 1) || !safe(economy.ledgerEntryCount)) fail("ECONOMY_CLOSED");
    const [year, term] = scope.split("-"), root = "years/" + year + "/semesters/" + term;
    let resource = await transaction.get(root + "/map_resources/" + payload.mapId);
    if (!resource.exists) resource = await transaction.get("map_resources/" + payload.mapId);
    if (!resource.exists || resource.data?.deletedAt || resource.data?.isVisibleToStudents === false) fail("SOURCE_NOT_FOUND", "not-found");
    const tags = [...(resource.data.pdfTagSections || []), ...(resource.data.pdfRegions || [])]
      .flatMap(row => Array.isArray(row?.tags) ? row.tags : []).map(tag => String(tag || "").trim());
    if (!tags.includes(payload.tag)) fail("TAG_NOT_FOUND", "invalid-argument");

    const sourceId = "map-tag:" + encodeURIComponent(payload.mapId) + ":" + encodeURIComponent(payload.tag) + ":" + payload.interactionId;
    const ledgerId = ledgerIdFor(scope, accountId, "GRANT", sourceId), ledgerPath = wis.WIS_LEDGER_COLLECTION + "/" + ledgerId;
    const prior = await transaction.get(ledgerPath);
    const empty = (status, reason, message, extra = {}) => ({
      status, awarded: false, duplicate: status === "DUPLICATE" || status === "NOT_ELIGIBLE",
      amount: 0, totalAwarded: 0, balance: account.balance, blockedReason: reason, blockedMessage: message, ...extra,
    });
    const done = result => ({ target: { kind: "map-tag-reward", id: ledgerId, refs: [accountPath, ledgerPath] }, result });
    if (prior.exists) {
      const data = prior.data || {};
      if (data.accountId !== accountId || data.studentUid !== uid || data.semesterId !== scope || data.sourceId !== sourceId ||
          data.activityType !== "map_tag" || data.type !== "GRANT" || !safe(data.delta, 1)) fail("SOURCE_MISMATCH");
      return done(empty("DUPLICATE", "duplicate_source", "이번 지도 태그 위스는 이미 반영되었습니다."));
    }
    const policy = await loadPolicy(transaction, scope), rule = policy.rewardPolicy?.mapTag || {};
    const amount = Number(rule.amount || 0), maxClaims = Number(rule.maxClaims || 0), cooldownHours = Math.max(1, Number(rule.cooldownHours || 24));
    if (!safe(amount) || !safe(maxClaims) || !Number.isFinite(cooldownHours)) fail("POLICY_INVALID");
    if (!policy.autoRewardEnabled || rule.enabled !== true || !amount) return done(empty("DISABLED", "reward_disabled", ""));
    const limit = 1000;
    const legacyRows = await transaction.query(root + "/point_transactions", { filters: [
      { field: "uid", operator: "==", value: uid }, { field: "type", operator: "==", value: "map_tag" },
    ], limit: limit + 1 });
    const canonicalRows = await transaction.query(wis.WIS_LEDGER_COLLECTION, { filters: [
      { field: "semesterId", operator: "==", value: scope }, { field: "studentUid", operator: "==", value: uid },
      { field: "type", operator: "==", value: "GRANT" }, { field: "activityType", operator: "==", value: "map_tag" },
    ], limit: limit + 1 });
    if (legacyRows.length > limit || canonicalRows.length > limit) fail("HISTORY_LIMIT_EXCEEDED");
    const rows = [...legacyRows, ...canonicalRows], claimCount = rows.length;
    if (rows.some(row => row.data?.sourceId === sourceId))
      return done(empty("DUPLICATE", "duplicate_source", "이번 지도 태그 위스는 이미 반영되었습니다.", { claimCount, maxClaims }));
    if (maxClaims > 0 && claimCount >= maxClaims)
      return done(empty("NOT_ELIGIBLE", "max_claims_reached", "누적 최대 " + maxClaims + "회까지 적립됩니다.", { claimCount, maxClaims }));
    const times = rows.map(row => { const ms = millis(row.data?.createdAt); if (!safe(ms, 1)) fail("HISTORY_TIMESTAMP_INVALID"); return ms; });
    const nextEligibleAtMs = times.length ? Math.max(...times) + cooldownHours * 3600000 : 0;
    if (!safe(nextEligibleAtMs)) fail("POLICY_INVALID");
    if (nextEligibleAtMs > nowMs) return done(empty("NOT_ELIGIBLE", "cooldown_active", cooldownHours + "시간마다 1회만 적립됩니다.",
      { claimCount, maxClaims, nextEligibleAt: new Date(nextEligibleAtMs).toISOString() }));
    const balance = account.balance + amount, totals = { earnedTotal: account.earnedTotal + amount,
      rankEarnedTotal: account.rankEarnedTotal + amount, spentTotal: account.spentTotal, adjustedTotal: account.adjustedTotal };
    if (![balance, totals.earnedTotal, totals.rankEarnedTotal, account.revision + 1, economy.revision + 1, economy.ledgerEntryCount + 1].every(value => safe(value))) fail("AMOUNT_OVERFLOW");
    const ledger = { schemaVersion: wis.WIS_SCHEMA_VERSION, policyVersion: wis.WIS_POLICY_VERSION, ledgerEntryId: ledgerId,
      semesterId: scope, accountId, studentUid: uid, type: "GRANT", activityType: "map_tag", delta: amount,
      balanceBefore: account.balance, balanceAfter: balance, sourceId, sourceMapId: payload.mapId,
      reason: String(resource.data.title || "지도").slice(0, 200) + " · " + payload.tag + " 태그 탐색",
      actorUid: SYSTEM_ACTOR, actorRole: "system", initiatedByUid: uid, commandId, receiptId, createdAt: concreteTimestamp,
      targetDate: new Date(nowMs + 9 * 3600000).toISOString().slice(0, 10) };
    writeProjection(transaction, account, balance, concreteTimestamp, SYSTEM_ACTOR, totals, [ledger, ...account.recentLedgerEntries].slice(0, 100));
    transaction.create(ledgerPath, ledger);
    transaction.set(economyPath, { revision: economy.revision + 1, ledgerEntryCount: economy.ledgerEntryCount + 1,
      updatedAt: concreteTimestamp, updatedBy: SYSTEM_ACTOR }, { merge: true });
    const response = done({ status: "AWARDED", awarded: true, duplicate: false, amount, totalAwarded: amount,
      balance, blockedReason: "", blockedMessage: "", claimCount: claimCount + 1, maxClaims, ledgerEntryId: ledgerId });
    response.target.refs.push(wis.WIS_BALANCE_COLLECTION + "/" + accountId, wis.WIS_RANKING_COLLECTION + "/" + accountId, economyPath);
    return response;
  },
});
module.exports = { COMMAND_TYPE, normalizePayload, createAdapter };
