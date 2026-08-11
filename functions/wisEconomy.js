const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");

const semesterCore = require("./semesterCore");
const archiveEnrollment = require("./archiveEnrollment");
const sessionAuthority = require("./sessionAuthority");
const { onCallWithStudentMaintenance: onCall } = require("./studentMaintenance");

const REGION = "asia-northeast3";
const WIS_SCHEMA_VERSION = 1;
const WIS_POLICY_VERSION = "w7-v1";

const WIS_ECONOMY_COLLECTION = "semester_wis_economies";
const WIS_ACCOUNT_COLLECTION = "semester_wis_accounts";
const WIS_LEDGER_COLLECTION = "semester_wis_ledger";
const WIS_BALANCE_COLLECTION = "semester_wis_balances";
const WIS_RANKING_COLLECTION = "semester_wis_rankings";
const WIS_PRODUCT_COLLECTION = "wis_product_catalog";
const WIS_INVENTORY_COLLECTION = "semester_wis_inventory";
const WIS_ORDER_COLLECTION = "semester_wis_orders";
const WIS_RECONCILIATION_COLLECTION = "semester_wis_reconciliation_reports";
const WIS_LEGACY_ISSUE_COLLECTION = "wis_legacy_issues";

const WIS_COMMAND_TYPES = Object.freeze({
  CREATE_SEMESTER_ECONOMY: "createSemesterEconomy",
  CREATE_WIS_ACCOUNTS: "createWisAccounts",
  GRANT_INITIAL_WIS: "grantInitialWis",
  GRANT_WIS: "grantWis",
  DEDUCT_WIS: "deductWis",
  ADJUST_WIS: "adjustWis",
  REVERSE_WIS_ENTRY: "reverseWisEntry",
  REBUILD_WIS_PROJECTION: "rebuildWisProjection",
  TRANSITION_WIS_ECONOMY: "transitionWisEconomy",
  UPSERT_WIS_PRODUCT: "upsertWisProduct",
  UPSERT_WIS_INVENTORY: "upsertWisInventory",
  PLACE_WIS_ORDER: "placeWisOrder",
  REVIEW_WIS_ORDER: "reviewWisOrder",
});

const STUDENT_COMMAND_TYPES = new Set([WIS_COMMAND_TYPES.PLACE_WIS_ORDER]);
const HIGH_RISK_COMMAND_TYPES = new Set(
  Object.values(WIS_COMMAND_TYPES).filter((type) => !STUDENT_COMMAND_TYPES.has(type)),
);

const fail = (code, message, reason, details = {}) => {
  throw new HttpsError(code, message, { reason, ...details });
};
const sha256 = (value) => createHash("sha256").update(String(value), "utf8").digest("hex");
const canonicalJson = (value) => {
  const visit = (current) => {
    if (Array.isArray(current)) return current.map(visit);
    if (current && typeof current === "object") {
      return Object.fromEntries(Object.keys(current).sort().filter((key) => current[key] !== undefined)
        .map((key) => [key, visit(current[key])]));
    }
    return current;
  };
  return JSON.stringify(visit(value));
};
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const allowed = (value, keys, label) => {
  if (!isObject(value)) fail("invalid-argument", `${label} must be an object.`, "WIS_PAYLOAD_INVALID");
  const extra = Object.keys(value).filter((key) => !keys.includes(key));
  if (extra.length) fail("invalid-argument", `${label} contains unsupported fields.`, "WIS_PAYLOAD_INVALID", { fields: extra });
};
const text = (value, label, max = 160) => {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > max || value.includes("/")) {
    fail("invalid-argument", `${label} is invalid.`, "WIS_PAYLOAD_INVALID", { field: label });
  }
  return value;
};
const optionalText = (value, label, max = 500) => value === undefined || value === null || value === "" ? "" : text(value, label, max);
const integer = (value, label, { min = 0, max = 1_000_000 } = {}) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail("invalid-argument", `${label} is invalid.`, "WIS_PAYLOAD_INVALID", { field: label });
  return value;
};
const revision = (value, label = "expectedRevision") => integer(value, label, { min: 1, max: Number.MAX_SAFE_INTEGER });
const nullableRevision = (value, label) => value === null ? null : revision(value, label);
const semesterId = (value) => semesterCore.normalizeSemesterId(value);
const hashId = (prefix, ...parts) => `${prefix}_${sha256(parts.join("\n"))}`;
const accountIdFor = (scope, uid) => hashId("wisacct", scope, uid);
const inventoryIdFor = (scope, productId) => hashId("wisinv", scope, productId);
const ledgerIdFor = (scope, accountId, type, sourceId) => hashId("wisled", scope, accountId, type, sourceId);
const orderIdFor = (scope, accountId, inventoryId, commandId) => hashId("wisord", scope, accountId, inventoryId, commandId);
const economyPath = (scope) => `${WIS_ECONOMY_COLLECTION}/${scope}`;
const accountPath = (id) => `${WIS_ACCOUNT_COLLECTION}/${id}`;
const balancePath = (id) => `${WIS_BALANCE_COLLECTION}/${id}`;
const rankingPath = (id) => `${WIS_RANKING_COLLECTION}/${id}`;
const ledgerPath = (id) => `${WIS_LEDGER_COLLECTION}/${id}`;
const inventoryPath = (id) => `${WIS_INVENTORY_COLLECTION}/${id}`;
const productPath = (id) => `${WIS_PRODUCT_COLLECTION}/${id}`;
const orderPath = (id) => `${WIS_ORDER_COLLECTION}/${id}`;
const manifestPath = (scope) => `${semesterCore.SEMESTER_MANIFEST_COLLECTION}/${scope}`;
const enrollmentPath = (id) => `${archiveEnrollment.SEMESTER_ENROLLMENT_COLLECTION}/${id}`;

const normalizeWisPayload = (commandType, raw) => {
  const payload = raw || {};
  const common = ["semesterId", "expectedSemesterRevision"];
  if (commandType === WIS_COMMAND_TYPES.CREATE_SEMESTER_ECONOMY) {
    allowed(payload, [...common, "displayName", "currencyName", "initialGrantAmount"], "createSemesterEconomy payload");
    return { semesterId: semesterId(payload.semesterId), expectedSemesterRevision: revision(payload.expectedSemesterRevision, "expectedSemesterRevision"), displayName: text(payload.displayName, "displayName", 120), currencyName: text(payload.currencyName, "currencyName", 20), initialGrantAmount: integer(payload.initialGrantAmount, "initialGrantAmount") };
  }
  if (commandType === WIS_COMMAND_TYPES.CREATE_WIS_ACCOUNTS) {
    allowed(payload, [...common, "expectedEconomyRevision", "enrollmentIds", "reason"], "createWisAccounts payload");
    if (!Array.isArray(payload.enrollmentIds) || payload.enrollmentIds.length < 1 || payload.enrollmentIds.length > 100) fail("invalid-argument", "enrollmentIds is invalid.", "WIS_PAYLOAD_INVALID");
    const enrollmentIds = payload.enrollmentIds.map((id, index) => text(id, `enrollmentIds[${index}]`, 180));
    if (new Set(enrollmentIds).size !== enrollmentIds.length) fail("invalid-argument", "enrollmentIds contains duplicates.", "WIS_PAYLOAD_INVALID");
    return { semesterId: semesterId(payload.semesterId), expectedSemesterRevision: revision(payload.expectedSemesterRevision, "expectedSemesterRevision"), expectedEconomyRevision: revision(payload.expectedEconomyRevision, "expectedEconomyRevision"), enrollmentIds, reason: text(payload.reason, "reason", 500) };
  }
  if ([WIS_COMMAND_TYPES.GRANT_INITIAL_WIS, WIS_COMMAND_TYPES.GRANT_WIS, WIS_COMMAND_TYPES.DEDUCT_WIS].includes(commandType)) {
    allowed(payload, [...common, "expectedEconomyRevision", "accountId", "expectedAccountRevision", "amount", "sourceId", "reason"], `${commandType} payload`);
    return { semesterId: semesterId(payload.semesterId), expectedSemesterRevision: revision(payload.expectedSemesterRevision, "expectedSemesterRevision"), expectedEconomyRevision: revision(payload.expectedEconomyRevision, "expectedEconomyRevision"), accountId: text(payload.accountId, "accountId", 80), expectedAccountRevision: revision(payload.expectedAccountRevision, "expectedAccountRevision"), amount: integer(payload.amount, "amount", { min: 1 }), sourceId: text(payload.sourceId, "sourceId", 180), reason: text(payload.reason, "reason", 500) };
  }
  if (commandType === WIS_COMMAND_TYPES.ADJUST_WIS) {
    allowed(payload, [...common, "expectedEconomyRevision", "accountId", "expectedAccountRevision", "delta", "sourceId", "reason"], "adjustWis payload");
    const delta = integer(Math.abs(payload.delta), "delta", { min: 1 }) * Math.sign(payload.delta || 0);
    if (!delta) fail("invalid-argument", "delta is invalid.", "WIS_PAYLOAD_INVALID");
    return { semesterId: semesterId(payload.semesterId), expectedSemesterRevision: revision(payload.expectedSemesterRevision, "expectedSemesterRevision"), expectedEconomyRevision: revision(payload.expectedEconomyRevision, "expectedEconomyRevision"), accountId: text(payload.accountId, "accountId", 80), expectedAccountRevision: revision(payload.expectedAccountRevision, "expectedAccountRevision"), delta, sourceId: text(payload.sourceId, "sourceId", 180), reason: text(payload.reason, "reason", 500) };
  }
  if (commandType === WIS_COMMAND_TYPES.REVERSE_WIS_ENTRY) {
    allowed(payload, [...common, "expectedEconomyRevision", "accountId", "expectedAccountRevision", "ledgerEntryId", "reason"], "reverseWisEntry payload");
    return { semesterId: semesterId(payload.semesterId), expectedSemesterRevision: revision(payload.expectedSemesterRevision, "expectedSemesterRevision"), expectedEconomyRevision: revision(payload.expectedEconomyRevision, "expectedEconomyRevision"), accountId: text(payload.accountId, "accountId", 80), expectedAccountRevision: revision(payload.expectedAccountRevision, "expectedAccountRevision"), ledgerEntryId: text(payload.ledgerEntryId, "ledgerEntryId", 80), reason: text(payload.reason, "reason", 500) };
  }
  if (commandType === WIS_COMMAND_TYPES.REBUILD_WIS_PROJECTION) {
    allowed(payload, [...common, "expectedEconomyRevision", "accountId", "reason"], "rebuildWisProjection payload");
    return { semesterId: semesterId(payload.semesterId), expectedSemesterRevision: revision(payload.expectedSemesterRevision, "expectedSemesterRevision"), expectedEconomyRevision: revision(payload.expectedEconomyRevision, "expectedEconomyRevision"), accountId: text(payload.accountId, "accountId", 80), reason: text(payload.reason, "reason", 500) };
  }
  if (commandType === WIS_COMMAND_TYPES.TRANSITION_WIS_ECONOMY) {
    allowed(payload, [...common, "expectedEconomyRevision", "targetStatus", "reason"], "transitionWisEconomy payload");
    if (!["ACTIVE_OPEN", "CLOSED", "ARCHIVED"].includes(payload.targetStatus)) fail("invalid-argument", "targetStatus is invalid.", "WIS_PAYLOAD_INVALID");
    return { semesterId: semesterId(payload.semesterId), expectedSemesterRevision: revision(payload.expectedSemesterRevision, "expectedSemesterRevision"), expectedEconomyRevision: revision(payload.expectedEconomyRevision, "expectedEconomyRevision"), targetStatus: payload.targetStatus, reason: text(payload.reason, "reason", 500) };
  }
  if (commandType === WIS_COMMAND_TYPES.UPSERT_WIS_PRODUCT) {
    allowed(payload, [...common, "expectedEconomyRevision", "productId", "expectedProductRevision", "name", "description", "imageUrl", "active", "reason"], "upsertWisProduct payload");
    if (typeof payload.active !== "boolean") fail("invalid-argument", "active is invalid.", "WIS_PAYLOAD_INVALID");
    const name = text(payload.name, "name", 120);
    return { semesterId: semesterId(payload.semesterId), expectedSemesterRevision: revision(payload.expectedSemesterRevision, "expectedSemesterRevision"), expectedEconomyRevision: revision(payload.expectedEconomyRevision, "expectedEconomyRevision"), productId: payload.productId ? text(payload.productId, "productId", 80) : hashId("wisprod", name), expectedProductRevision: nullableRevision(payload.expectedProductRevision, "expectedProductRevision"), name, description: optionalText(payload.description, "description", 1000), imageUrl: optionalText(payload.imageUrl, "imageUrl", 1000), active: payload.active, reason: text(payload.reason, "reason", 500) };
  }
  if (commandType === WIS_COMMAND_TYPES.UPSERT_WIS_INVENTORY) {
    allowed(payload, [...common, "expectedEconomyRevision", "productId", "expectedInventoryRevision", "price", "stock", "active", "reason"], "upsertWisInventory payload");
    if (typeof payload.active !== "boolean") fail("invalid-argument", "active is invalid.", "WIS_PAYLOAD_INVALID");
    const scope = semesterId(payload.semesterId); const productId = text(payload.productId, "productId", 80);
    return { semesterId: scope, expectedSemesterRevision: revision(payload.expectedSemesterRevision, "expectedSemesterRevision"), expectedEconomyRevision: revision(payload.expectedEconomyRevision, "expectedEconomyRevision"), productId, inventoryId: inventoryIdFor(scope, productId), expectedInventoryRevision: nullableRevision(payload.expectedInventoryRevision, "expectedInventoryRevision"), price: integer(payload.price, "price", { min: 1 }), stock: integer(payload.stock, "stock"), active: payload.active, reason: text(payload.reason, "reason", 500) };
  }
  if (commandType === WIS_COMMAND_TYPES.PLACE_WIS_ORDER) {
    allowed(payload, [...common, "expectedEconomyRevision", "inventoryId", "expectedInventoryRevision", "expectedAccountRevision", "quantity"], "placeWisOrder payload");
    return { semesterId: semesterId(payload.semesterId), expectedSemesterRevision: revision(payload.expectedSemesterRevision, "expectedSemesterRevision"), expectedEconomyRevision: revision(payload.expectedEconomyRevision, "expectedEconomyRevision"), inventoryId: text(payload.inventoryId, "inventoryId", 80), expectedInventoryRevision: revision(payload.expectedInventoryRevision, "expectedInventoryRevision"), expectedAccountRevision: revision(payload.expectedAccountRevision, "expectedAccountRevision"), quantity: integer(payload.quantity, "quantity", { min: 1, max: 99 }) };
  }
  if (commandType === WIS_COMMAND_TYPES.REVIEW_WIS_ORDER) {
    allowed(payload, [...common, "expectedEconomyRevision", "orderId", "expectedOrderRevision", "action", "reason"], "reviewWisOrder payload");
    if (!["APPROVE", "REJECT", "FULFILL"].includes(payload.action)) fail("invalid-argument", "action is invalid.", "WIS_PAYLOAD_INVALID");
    return { semesterId: semesterId(payload.semesterId), expectedSemesterRevision: revision(payload.expectedSemesterRevision, "expectedSemesterRevision"), expectedEconomyRevision: revision(payload.expectedEconomyRevision, "expectedEconomyRevision"), orderId: text(payload.orderId, "orderId", 80), expectedOrderRevision: revision(payload.expectedOrderRevision, "expectedOrderRevision"), action: payload.action, reason: text(payload.reason, "reason", 500) };
  }
  fail("invalid-argument", "Unsupported Wis command.", "WIS_COMMAND_UNSUPPORTED");
};

const assertTeacher = (actor) => {
  if (!actor?.actorUid || !["teacher", "admin"].includes(actor.actorRole)) fail("permission-denied", "Wis management permission is required.", "WIS_MANAGE_REQUIRED");
};
const assertStudent = (actor) => {
  if (!actor?.actorUid || actor.actorRole !== "student") fail("permission-denied", "A student account is required.", "WIS_STUDENT_REQUIRED");
};
const assertManifest = async (transaction, payload) => {
  const snapshot = await transaction.get(manifestPath(payload.semesterId));
  const manifest = snapshot.data || {};
  if (!snapshot.exists) fail("not-found", "Semester Manifest does not exist.", "SEMESTER_NOT_FOUND");
  if (Number(manifest.revision || 0) !== payload.expectedSemesterRevision) fail("aborted", "Semester revision changed.", "SEMESTER_REVISION_CONFLICT");
  if (manifest.status !== "ACTIVE") fail("failed-precondition", "Wis writes require the active semester.", ["CLOSED", "ARCHIVED"].includes(manifest.status) ? "SEMESTER_ARCHIVED_WRITE_FORBIDDEN" : "SEMESTER_WRITE_STATE_INVALID");
  return manifest;
};
const assertEconomy = async (transaction, payload, statuses = ["ACTIVE_INITIALIZING", "ACTIVE_OPEN"]) => {
  const snapshot = await transaction.get(economyPath(payload.semesterId));
  if (!snapshot.exists) fail("not-found", "Semester Wis economy does not exist.", "WIS_ECONOMY_NOT_FOUND");
  const economy = snapshot.data || {};
  if (Number(economy.revision || 0) !== payload.expectedEconomyRevision) fail("aborted", "Wis economy revision changed.", "WIS_ECONOMY_REVISION_CONFLICT", { currentRevision: Number(economy.revision || 0) });
  if (!statuses.includes(economy.status)) fail("failed-precondition", "Wis economy state does not allow this command.", "WIS_ECONOMY_STATE_INVALID", { status: economy.status });
  return economy;
};
const writeProjection = (transaction, account, balance, timestamp, actorUid) => {
  const revisionValue = Number(account.revision || 0) + 1;
  const patch = { revision: revisionValue, balance, updatedAt: timestamp, updatedBy: actorUid };
  transaction.set(accountPath(account.accountId), patch, { merge: true });
  transaction.set(balancePath(account.accountId), { schemaVersion: WIS_SCHEMA_VERSION, policyVersion: WIS_POLICY_VERSION, accountId: account.accountId, semesterId: account.semesterId, studentUid: account.studentUid, balance, ledgerRevision: revisionValue, updatedAt: timestamp }, { merge: true });
  transaction.set(rankingPath(account.accountId), { schemaVersion: WIS_SCHEMA_VERSION, policyVersion: WIS_POLICY_VERSION, accountId: account.accountId, semesterId: account.semesterId, studentUid: account.studentUid, displayName: account.displayName, balance, ledgerRevision: revisionValue, updatedAt: timestamp }, { merge: true });
  return revisionValue;
};
const postLedger = async ({ transaction, account, delta, type, sourceId, reason, commandId, receiptId, timestamp, actor }) => {
  const entryId = ledgerIdFor(account.semesterId, account.accountId, type, sourceId);
  const existing = await transaction.get(ledgerPath(entryId));
  if (existing.exists) fail("already-exists", "A ledger entry already exists for this source.", "WIS_LEDGER_SOURCE_EXISTS", { ledgerEntryId: entryId });
  const before = Number(account.balance || 0); const after = before + delta;
  if (after < 0) fail("failed-precondition", "Wis balance is insufficient.", "WIS_INSUFFICIENT_BALANCE", { balance: before, required: Math.abs(delta) });
  const accountRevision = writeProjection(transaction, account, after, timestamp, actor.actorUid);
  transaction.create(ledgerPath(entryId), { schemaVersion: WIS_SCHEMA_VERSION, policyVersion: WIS_POLICY_VERSION, ledgerEntryId: entryId, semesterId: account.semesterId, accountId: account.accountId, studentUid: account.studentUid, type, delta, balanceBefore: before, balanceAfter: after, sourceId, reason, actorUid: actor.actorUid, actorRole: actor.actorRole, commandId, receiptId, createdAt: timestamp });
  return { ledgerEntryId: entryId, balance: after, accountRevision };
};

const createWisCommandAdapter = () => ({
  apply: async ({ transaction, commandId, commandType, payload, receiptId, timestamp, actor }) => {
    await assertManifest(transaction, payload);
    if (commandType === WIS_COMMAND_TYPES.CREATE_SEMESTER_ECONOMY) {
      assertTeacher(actor); const path = economyPath(payload.semesterId); const existing = await transaction.get(path);
      if (existing.exists) fail("already-exists", "Semester Wis economy already exists.", "WIS_ECONOMY_EXISTS");
      transaction.create(path, { schemaVersion: WIS_SCHEMA_VERSION, policyVersion: WIS_POLICY_VERSION, semesterId: payload.semesterId, revision: 1, status: "ACTIVE_INITIALIZING", displayName: payload.displayName, currencyName: payload.currencyName, initialGrantAmount: payload.initialGrantAmount, createdBy: actor.actorUid, createdAt: timestamp, updatedAt: timestamp });
      return { target: { kind: "wis-economy", id: payload.semesterId, refs: [path] }, sourceHash: sha256(canonicalJson(payload)), result: { semesterId: payload.semesterId, revision: 1, status: "ACTIVE_INITIALIZING" } };
    }
    const economy = await assertEconomy(transaction, payload, commandType === WIS_COMMAND_TYPES.TRANSITION_WIS_ECONOMY ? ["ACTIVE_INITIALIZING", "ACTIVE_OPEN", "CLOSED"] : ["ACTIVE_INITIALIZING", "ACTIVE_OPEN"]);
    if (commandType === WIS_COMMAND_TYPES.CREATE_WIS_ACCOUNTS) {
      assertTeacher(actor); const enrollments = await transaction.getAll(payload.enrollmentIds.map(enrollmentPath)); const refs = [];
      for (let index = 0; index < enrollments.length; index += 1) {
        const enrollment = enrollments[index]; const data = enrollment.data || {};
        if (!enrollment.exists || data.semesterId !== payload.semesterId || ![data.status, data.enrollmentStatus].includes("ACTIVE")) fail("failed-precondition", "Enrollment is not active in this semester.", "WIS_ENROLLMENT_INVALID", { enrollmentId: payload.enrollmentIds[index] });
        const accountId = accountIdFor(payload.semesterId, data.studentUid); const path = accountPath(accountId); const existing = await transaction.get(path);
        if (existing.exists) continue;
        const account = { schemaVersion: WIS_SCHEMA_VERSION, policyVersion: WIS_POLICY_VERSION, accountId, semesterId: payload.semesterId, studentUid: data.studentUid, enrollmentId: data.enrollmentId, classId: data.classId, displayName: data.displayName || data.studentName || data.snapshot?.displayName || "학생", status: "ACTIVE", revision: 1, balance: 0, initialGrantLedgerEntryId: null, createdAt: timestamp, updatedAt: timestamp };
        transaction.create(path, account); transaction.create(balancePath(accountId), { ...account, ledgerRevision: 1 }); transaction.create(rankingPath(accountId), { schemaVersion: WIS_SCHEMA_VERSION, policyVersion: WIS_POLICY_VERSION, accountId, semesterId: payload.semesterId, studentUid: data.studentUid, displayName: account.displayName, balance: 0, ledgerRevision: 1, updatedAt: timestamp }); refs.push(path, balancePath(accountId), rankingPath(accountId));
      }
      const nextRevision = economy.revision + 1; transaction.set(economyPath(payload.semesterId), { revision: nextRevision, updatedAt: timestamp, updatedBy: actor.actorUid }, { merge: true });
      return { target: { kind: "wis-accounts", id: payload.semesterId, refs }, sourceHash: sha256(canonicalJson(payload.enrollmentIds)), result: { semesterId: payload.semesterId, createdCount: refs.length / 3, economyRevision: nextRevision } };
    }
    if ([WIS_COMMAND_TYPES.GRANT_INITIAL_WIS, WIS_COMMAND_TYPES.GRANT_WIS, WIS_COMMAND_TYPES.DEDUCT_WIS, WIS_COMMAND_TYPES.ADJUST_WIS].includes(commandType)) {
      assertTeacher(actor); const snapshot = await transaction.get(accountPath(payload.accountId)); const account = snapshot.data || {};
      if (!snapshot.exists || account.semesterId !== payload.semesterId) fail("not-found", "Wis account was not found.", "WIS_ACCOUNT_NOT_FOUND");
      if (Number(account.revision || 0) !== payload.expectedAccountRevision) fail("aborted", "Wis account revision changed.", "WIS_ACCOUNT_REVISION_CONFLICT");
      if (commandType === WIS_COMMAND_TYPES.GRANT_INITIAL_WIS && (economy.status !== "ACTIVE_INITIALIZING" || account.initialGrantLedgerEntryId)) fail("failed-precondition", "Initial grant is allowed exactly once during initialization.", "WIS_INITIAL_GRANT_ALREADY_APPLIED");
      if (commandType === WIS_COMMAND_TYPES.GRANT_INITIAL_WIS && payload.amount !== economy.initialGrantAmount) fail("failed-precondition", "Initial grant amount must match the semester economy policy.", "WIS_INITIAL_GRANT_AMOUNT_MISMATCH");
      const delta = commandType === WIS_COMMAND_TYPES.DEDUCT_WIS ? -payload.amount : commandType === WIS_COMMAND_TYPES.ADJUST_WIS ? payload.delta : payload.amount;
      const type = commandType === WIS_COMMAND_TYPES.GRANT_INITIAL_WIS ? "INITIAL_GRANT" : commandType === WIS_COMMAND_TYPES.GRANT_WIS ? "GRANT" : commandType === WIS_COMMAND_TYPES.DEDUCT_WIS ? "DEDUCT" : "ADJUST";
      const posted = await postLedger({ transaction, account, delta, type, sourceId: payload.sourceId, reason: payload.reason, commandId, receiptId, timestamp, actor });
      if (type === "INITIAL_GRANT") transaction.set(accountPath(account.accountId), { initialGrantLedgerEntryId: posted.ledgerEntryId }, { merge: true });
      return { target: { kind: "wis-ledger", id: posted.ledgerEntryId, refs: [ledgerPath(posted.ledgerEntryId), accountPath(account.accountId), balancePath(account.accountId), rankingPath(account.accountId)] }, sourceHash: sha256(`${type}\n${payload.sourceId}`), result: { accountId: account.accountId, ...posted, type } };
    }
    if (commandType === WIS_COMMAND_TYPES.REVERSE_WIS_ENTRY) {
      assertTeacher(actor); const [accountSnapshot, original] = await transaction.getAll([accountPath(payload.accountId), ledgerPath(payload.ledgerEntryId)]); const account = accountSnapshot.data || {}; const source = original.data || {};
      if (!accountSnapshot.exists || account.semesterId !== payload.semesterId || Number(account.revision || 0) !== payload.expectedAccountRevision) fail("aborted", "Wis account revision changed.", "WIS_ACCOUNT_REVISION_CONFLICT");
      if (!original.exists || source.accountId !== account.accountId || source.type === "REVERSAL") fail("failed-precondition", "Ledger entry cannot be reversed.", "WIS_REVERSAL_INVALID");
      const posted = await postLedger({ transaction, account, delta: -Number(source.delta || 0), type: "REVERSAL", sourceId: payload.ledgerEntryId, reason: payload.reason, commandId, receiptId, timestamp, actor });
      return { target: { kind: "wis-reversal", id: posted.ledgerEntryId, refs: [ledgerPath(payload.ledgerEntryId), ledgerPath(posted.ledgerEntryId)] }, sourceHash: sha256(payload.ledgerEntryId), result: { accountId: account.accountId, ...posted, reversedLedgerEntryId: payload.ledgerEntryId } };
    }
    if (commandType === WIS_COMMAND_TYPES.REBUILD_WIS_PROJECTION) {
      assertTeacher(actor); const accountSnapshot = await transaction.get(accountPath(payload.accountId)); const account = accountSnapshot.data || {};
      if (!accountSnapshot.exists || account.semesterId !== payload.semesterId) fail("not-found", "Wis account was not found.", "WIS_ACCOUNT_NOT_FOUND");
      const entries = await transaction.query(WIS_LEDGER_COLLECTION, { field: "accountId", operator: "==", value: payload.accountId });
      const balance = entries.reduce((sum, entry) => sum + Number(entry.data?.delta || 0), 0); if (balance < 0) fail("failed-precondition", "Ledger produces a negative balance.", "WIS_LEDGER_INVALID");
      const accountRevision = writeProjection(transaction, account, balance, timestamp, actor.actorUid); const reportId = hashId("wisrec", payload.semesterId, payload.accountId, String(accountRevision), sha256(canonicalJson(entries.map((entry) => entry.data))));
      transaction.create(`${WIS_RECONCILIATION_COLLECTION}/${reportId}`, { schemaVersion: WIS_SCHEMA_VERSION, policyVersion: WIS_POLICY_VERSION, reportId, semesterId: payload.semesterId, accountId: payload.accountId, accountRevision, ledgerCount: entries.length, balance, status: "PASS", dependencyHash: sha256(canonicalJson(entries.map((entry) => entry.data))), createdBy: actor.actorUid, createdAt: timestamp });
      return { target: { kind: "wis-projection", id: payload.accountId, refs: [accountPath(payload.accountId), balancePath(payload.accountId), rankingPath(payload.accountId), `${WIS_RECONCILIATION_COLLECTION}/${reportId}`] }, sourceHash: sha256(canonicalJson(entries.map((entry) => entry.data))), result: { accountId: payload.accountId, accountRevision, balance, reportId, status: "PASS" } };
    }
    if (commandType === WIS_COMMAND_TYPES.TRANSITION_WIS_ECONOMY) {
      assertTeacher(actor); const transitions = { ACTIVE_INITIALIZING: ["ACTIVE_OPEN"], ACTIVE_OPEN: ["CLOSED"], CLOSED: ["ARCHIVED"] };
      if (!(transitions[economy.status] || []).includes(payload.targetStatus)) fail("failed-precondition", "Wis economy transition is invalid.", "WIS_ECONOMY_TRANSITION_INVALID");
      if (payload.targetStatus === "ACTIVE_OPEN") {
        const accounts = await transaction.query(WIS_ACCOUNT_COLLECTION, { field: "semesterId", operator: "==", value: payload.semesterId });
        const missing = accounts.filter((row) => economy.initialGrantAmount > 0 && !row.data?.initialGrantLedgerEntryId);
        if (accounts.length === 0 || missing.length) fail("failed-precondition", "All active accounts require their exactly-once initial grant.", "WIS_INITIALIZATION_INCOMPLETE", { accountCount: accounts.length, missingGrantCount: missing.length });
      }
      const economyRevision = economy.revision + 1; transaction.set(economyPath(payload.semesterId), { revision: economyRevision, status: payload.targetStatus, transitionReason: payload.reason, updatedAt: timestamp, updatedBy: actor.actorUid }, { merge: true });
      return { target: { kind: "wis-economy-transition", id: payload.semesterId, refs: [economyPath(payload.semesterId)] }, sourceHash: sha256(`${economy.status}\n${payload.targetStatus}`), result: { semesterId: payload.semesterId, revision: economyRevision, status: payload.targetStatus } };
    }
    if (commandType === WIS_COMMAND_TYPES.UPSERT_WIS_PRODUCT) {
      assertTeacher(actor); const path = productPath(payload.productId); const existing = await transaction.get(path); const currentRevision = Number(existing.data?.revision || 0);
      if ((existing.exists && payload.expectedProductRevision !== currentRevision) || (!existing.exists && payload.expectedProductRevision !== null)) fail("aborted", "Product revision changed.", "WIS_PRODUCT_REVISION_CONFLICT");
      const nextRevision = currentRevision + 1; transaction.set(path, { schemaVersion: WIS_SCHEMA_VERSION, policyVersion: WIS_POLICY_VERSION, productId: payload.productId, revision: nextRevision, name: payload.name, description: payload.description, imageUrl: payload.imageUrl, active: payload.active, updatedAt: timestamp, updatedBy: actor.actorUid, ...(existing.exists ? {} : { createdAt: timestamp, createdBy: actor.actorUid }) }, { merge: true });
      return { target: { kind: "wis-product", id: payload.productId, refs: [path] }, sourceHash: sha256(canonicalJson(payload)), result: { productId: payload.productId, revision: nextRevision, active: payload.active } };
    }
    if (commandType === WIS_COMMAND_TYPES.UPSERT_WIS_INVENTORY) {
      assertTeacher(actor); const [product, existing] = await transaction.getAll([productPath(payload.productId), inventoryPath(payload.inventoryId)]); if (!product.exists) fail("not-found", "Product was not found.", "WIS_PRODUCT_NOT_FOUND");
      const currentRevision = Number(existing.data?.revision || 0); if ((existing.exists && currentRevision !== payload.expectedInventoryRevision) || (!existing.exists && payload.expectedInventoryRevision !== null)) fail("aborted", "Inventory revision changed.", "WIS_INVENTORY_REVISION_CONFLICT");
      const reserved = Number(existing.data?.reserved || 0); if (payload.stock < reserved) fail("failed-precondition", "Stock cannot be below reserved quantity.", "WIS_INVENTORY_RESERVED_CONFLICT");
      const nextRevision = currentRevision + 1; transaction.set(inventoryPath(payload.inventoryId), { schemaVersion: WIS_SCHEMA_VERSION, policyVersion: WIS_POLICY_VERSION, inventoryId: payload.inventoryId, semesterId: payload.semesterId, productId: payload.productId, productRevision: product.data?.revision, productName: product.data?.name, revision: nextRevision, price: payload.price, stock: payload.stock, available: payload.stock - reserved, reserved, sold: Number(existing.data?.sold || 0), active: payload.active, updatedAt: timestamp, updatedBy: actor.actorUid, ...(existing.exists ? {} : { createdAt: timestamp }) }, { merge: true });
      return { target: { kind: "wis-inventory", id: payload.inventoryId, refs: [inventoryPath(payload.inventoryId), productPath(payload.productId)] }, sourceHash: sha256(canonicalJson(payload)), result: { inventoryId: payload.inventoryId, revision: nextRevision, available: payload.stock - reserved, reserved } };
    }
    if (commandType === WIS_COMMAND_TYPES.PLACE_WIS_ORDER) {
      assertStudent(actor); if (economy.status !== "ACTIVE_OPEN") fail("failed-precondition", "Wis shop is not open.", "WIS_ECONOMY_STATE_INVALID");
      const accountId = accountIdFor(payload.semesterId, actor.actorUid); const [accountSnapshot, inventorySnapshot] = await transaction.getAll([accountPath(accountId), inventoryPath(payload.inventoryId)]); const account = accountSnapshot.data || {}; const inventory = inventorySnapshot.data || {};
      if (!accountSnapshot.exists || account.status !== "ACTIVE") fail("not-found", "Wis account was not found.", "WIS_ACCOUNT_NOT_FOUND"); if (Number(account.revision || 0) !== payload.expectedAccountRevision) fail("aborted", "Wis account revision changed.", "WIS_ACCOUNT_REVISION_CONFLICT");
      if (!inventorySnapshot.exists || inventory.semesterId !== payload.semesterId || inventory.active !== true || Number(inventory.revision || 0) !== payload.expectedInventoryRevision) fail("aborted", "Inventory changed.", "WIS_INVENTORY_REVISION_CONFLICT");
      if (Number(inventory.available || 0) < payload.quantity) fail("failed-precondition", "Inventory is insufficient.", "WIS_INSUFFICIENT_STOCK"); const totalPrice = Number(inventory.price || 0) * payload.quantity;
      const orderId = orderIdFor(payload.semesterId, accountId, payload.inventoryId, commandId); const posted = await postLedger({ transaction, account, delta: -totalPrice, type: "ORDER_DEBIT", sourceId: orderId, reason: `상품 주문: ${inventory.productName || inventory.productId}`, commandId, receiptId, timestamp, actor });
      transaction.set(inventoryPath(payload.inventoryId), { revision: payload.expectedInventoryRevision + 1, available: inventory.available - payload.quantity, reserved: Number(inventory.reserved || 0) + payload.quantity, updatedAt: timestamp }, { merge: true });
      transaction.create(orderPath(orderId), { schemaVersion: WIS_SCHEMA_VERSION, policyVersion: WIS_POLICY_VERSION, orderId, semesterId: payload.semesterId, accountId, studentUid: actor.actorUid, enrollmentId: account.enrollmentId, classId: account.classId, inventoryId: payload.inventoryId, productId: inventory.productId, productName: inventory.productName, quantity: payload.quantity, unitPrice: inventory.price, totalPrice, debitLedgerEntryId: posted.ledgerEntryId, revision: 1, status: "REQUESTED", createdAt: timestamp, updatedAt: timestamp });
      return { target: { kind: "wis-order", id: orderId, refs: [orderPath(orderId), inventoryPath(payload.inventoryId), ledgerPath(posted.ledgerEntryId), accountPath(accountId)] }, sourceHash: sha256(canonicalJson({ inventoryId: payload.inventoryId, quantity: payload.quantity, totalPrice })), result: { orderId, status: "REQUESTED", orderRevision: 1, inventoryRevision: payload.expectedInventoryRevision + 1, accountRevision: posted.accountRevision, balance: posted.balance, ledgerEntryId: posted.ledgerEntryId } };
    }
    if (commandType === WIS_COMMAND_TYPES.REVIEW_WIS_ORDER) {
      assertTeacher(actor); const orderSnapshot = await transaction.get(orderPath(payload.orderId)); const order = orderSnapshot.data || {}; if (!orderSnapshot.exists || order.semesterId !== payload.semesterId) fail("not-found", "Order was not found.", "WIS_ORDER_NOT_FOUND"); if (Number(order.revision || 0) !== payload.expectedOrderRevision) fail("aborted", "Order revision changed.", "WIS_ORDER_REVISION_CONFLICT");
      const nextStatus = payload.action === "APPROVE" ? "APPROVED" : payload.action === "FULFILL" ? "FULFILLED" : "REJECTED"; const allowedStatus = payload.action === "APPROVE" || payload.action === "REJECT" ? "REQUESTED" : "APPROVED"; if (order.status !== allowedStatus) fail("failed-precondition", "Order state is invalid.", "WIS_ORDER_STATE_INVALID");
      const refs = [orderPath(payload.orderId)]; const result = { orderId: payload.orderId, status: nextStatus, orderRevision: payload.expectedOrderRevision + 1 };
      if (payload.action === "REJECT") {
        const [inventorySnapshot, accountSnapshot] = await transaction.getAll([inventoryPath(order.inventoryId), accountPath(order.accountId)]); const inventory = inventorySnapshot.data || {}; const account = accountSnapshot.data || {}; if (!inventorySnapshot.exists || !accountSnapshot.exists) fail("failed-precondition", "Order dependencies are missing.", "WIS_ORDER_DEPENDENCY_INVALID");
        const posted = await postLedger({ transaction, account, delta: Number(order.totalPrice || 0), type: "ORDER_REFUND", sourceId: payload.orderId, reason: payload.reason, commandId, receiptId, timestamp, actor }); transaction.set(inventoryPath(order.inventoryId), { revision: Number(inventory.revision || 0) + 1, available: Number(inventory.available || 0) + order.quantity, reserved: Number(inventory.reserved || 0) - order.quantity, updatedAt: timestamp }, { merge: true }); Object.assign(result, { refundLedgerEntryId: posted.ledgerEntryId, balance: posted.balance }); refs.push(inventoryPath(order.inventoryId), ledgerPath(posted.ledgerEntryId), accountPath(order.accountId));
      } else if (payload.action === "FULFILL") {
        const inventorySnapshot = await transaction.get(inventoryPath(order.inventoryId)); const inventory = inventorySnapshot.data || {}; if (!inventorySnapshot.exists || Number(inventory.reserved || 0) < order.quantity) fail("failed-precondition", "Reserved inventory is inconsistent.", "WIS_ORDER_DEPENDENCY_INVALID"); transaction.set(inventoryPath(order.inventoryId), { revision: Number(inventory.revision || 0) + 1, reserved: inventory.reserved - order.quantity, sold: Number(inventory.sold || 0) + order.quantity, updatedAt: timestamp }, { merge: true }); refs.push(inventoryPath(order.inventoryId));
      }
      transaction.set(orderPath(payload.orderId), { revision: payload.expectedOrderRevision + 1, status: nextStatus, reviewReason: payload.reason, reviewedBy: actor.actorUid, reviewedAt: timestamp, updatedAt: timestamp }, { merge: true });
      return { target: { kind: "wis-order-review", id: payload.orderId, refs }, sourceHash: sha256(`${payload.orderId}\n${payload.action}`), result };
    }
    fail("invalid-argument", "Unsupported Wis command.", "WIS_COMMAND_UNSUPPORTED");
  },
});

const normalizeQuery = (raw) => {
  const value = raw || {}; allowed(value, ["audience", "semesterId", "source", "provenance", "accountId", "orderStatus", "_session"], "getWisEconomyState payload"); const source = value.provenance || value.source;
  if (!["CURRENT", "ARCHIVE", "LEGACY", "EXPLICIT"].includes(source)) fail("invalid-argument", "source is invalid.", "WIS_QUERY_INVALID");
  return { audience: value.audience === "teacher" ? "teacher" : "student", semesterId: semesterId(value.semesterId), source, accountId: value.accountId ? text(value.accountId, "accountId", 80) : "", orderStatus: value.orderStatus ? text(value.orderStatus, "orderStatus", 40) : "" };
};
const createWisQueryCore = ({ store, assertSession = sessionAuthority.assertActiveApplicationSession } = {}) => {
  if (!store) throw new TypeError("store is required.");
  const getWisEconomyState = async (request) => {
    const identity = await assertSession(request, { recentAuth: false, highRisk: false }); const uid = String(identity?.uid || request.auth?.uid || "").trim(); if (!uid || uid !== String(request.auth?.uid || "").trim()) fail("permission-denied", "Authenticated actor mismatch.", "COMMAND_ACTOR_MISMATCH");
    const query = normalizeQuery(request.data || {}); const profile = await store.get(`users/${uid}`); const permissions = Array.isArray(profile.data?.staffPermissions) ? profile.data.staffPermissions : []; const isAdmin = String(identity?.email || request.auth?.token?.email || "").toLowerCase() === "westoria28@gmail.com"; const canManage = isAdmin || (profile.data?.teacherPortalEnabled === true && permissions.includes("point_manage"));
    if (query.audience === "teacher" && !canManage) fail("permission-denied", "Wis management permission is required.", "WIS_MANAGE_REQUIRED");
    if (query.source === "LEGACY") return { audience: query.audience, semesterId: query.semesterId, provenance: "LEGACY", readOnly: true, status: "LEGACY", economy: null, account: null, accounts: [], ledger: [], products: [], inventory: [], orders: [], rankings: [], reason: "LEGACY_SOURCE_REQUIRES_EXPLICIT_READ_ONLY_ADAPTER", writeCount: 0 };
    return store.runTransaction(async (transaction) => {
      const [manifest, economySnapshot] = await transaction.getAll([manifestPath(query.semesterId), economyPath(query.semesterId)]); const manifestStatus = String(manifest.data?.status || ""); const provenance = ["CLOSED", "ARCHIVED"].includes(manifestStatus) ? "ARCHIVE" : manifestStatus === "ACTIVE" ? "CURRENT" : "PREPARING"; const readOnly = manifestStatus !== "ACTIVE" || (query.audience === "student" && economySnapshot.data?.status !== "ACTIVE_OPEN");
      if (!manifest.exists || !economySnapshot.exists) return { audience: query.audience, semesterId: query.semesterId, provenance, readOnly: true, status: "EMPTY", economy: economySnapshot.data || null, account: null, accounts: [], ledger: [], products: [], inventory: [], orders: [], rankings: [], reason: manifest.exists ? "WIS_ECONOMY_NOT_CREATED" : "SEMESTER_NOT_FOUND", writeCount: 0 };
      const accountId = query.audience === "student" ? accountIdFor(query.semesterId, uid) : query.accountId; let account = null; let ledger = []; let accounts = []; let orders = [];
      if (query.audience === "student" || accountId) { const snapshot = await transaction.get(accountPath(accountId)); if (snapshot.exists && (canManage || snapshot.data?.studentUid === uid)) { account = snapshot.data; ledger = (await transaction.query(WIS_LEDGER_COLLECTION, { field: "accountId", operator: "==", value: accountId })).map((row) => row.data); orders = (await transaction.query(WIS_ORDER_COLLECTION, { field: "accountId", operator: "==", value: accountId })).map((row) => row.data); } }
      if (query.audience === "teacher") { accounts = (await transaction.query(WIS_ACCOUNT_COLLECTION, { field: "semesterId", operator: "==", value: query.semesterId })).map((row) => row.data); if (!accountId) { ledger = (await transaction.query(WIS_LEDGER_COLLECTION, { field: "semesterId", operator: "==", value: query.semesterId })).map((row) => row.data); orders = (await transaction.query(WIS_ORDER_COLLECTION, { field: "semesterId", operator: "==", value: query.semesterId })).map((row) => row.data); } }
      if (query.orderStatus) orders = orders.filter((order) => order.status === query.orderStatus);
      const inventory = (await transaction.query(WIS_INVENTORY_COLLECTION, { field: "semesterId", operator: "==", value: query.semesterId })).map((row) => row.data); const productDocs = await transaction.query(WIS_PRODUCT_COLLECTION); const products = productDocs.map((row) => row.data).filter((product) => query.audience === "teacher" || product.active === true); const sortedRankings = (await transaction.query(WIS_RANKING_COLLECTION, { field: "semesterId", operator: "==", value: query.semesterId })).map((row) => row.data).sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0) || String(a.studentUid).localeCompare(String(b.studentUid))); let previousBalance = null; let previousRank = 0; const rankingRows = sortedRankings.map((row, index) => { const balance = Number(row.balance || 0); const rank = previousBalance === balance ? previousRank : index + 1; previousBalance = balance; previousRank = rank; return { ...row, rank }; });
      return { audience: query.audience, semesterId: query.semesterId, manifestRevision: Number(manifest.data?.revision || 0), provenance, readOnly, status: account || accounts.length || inventory.length ? "CONTENT" : "EMPTY", economy: economySnapshot.data, account, accounts, ledger: ledger.sort((a, b) => String(b.ledgerEntryId).localeCompare(String(a.ledgerEntryId))), products, inventory, orders, rankings: rankingRows, reason: "", writeCount: 0 };
    });
  };
  return { getWisEconomyState };
};
const createWisCallableExports = ({ core }) => ({ getWisEconomyState: onCall({ region: REGION }, (request) => core.getWisEconomyState(request)) });

const createWisReadinessAdapter = () => ({
  evaluate: async ({ transaction, manifest }) => {
    const scope = String(manifest?.semesterId || ""); const economy = await transaction.get(economyPath(scope)); const accounts = await transaction.query(WIS_ACCOUNT_COLLECTION, { field: "semesterId", operator: "==", value: scope }); const ledger = await transaction.query(WIS_LEDGER_COLLECTION, { field: "semesterId", operator: "==", value: scope }); const balances = await transaction.query(WIS_BALANCE_COLLECTION, { field: "semesterId", operator: "==", value: scope }); const rankings = await transaction.query(WIS_RANKING_COLLECTION, { field: "semesterId", operator: "==", value: scope }); const inventory = await transaction.query(WIS_INVENTORY_COLLECTION, { field: "semesterId", operator: "==", value: scope }); const orders = await transaction.query(WIS_ORDER_COLLECTION, { field: "semesterId", operator: "==", value: scope }); const issues = await transaction.query(WIS_LEGACY_ISSUE_COLLECTION, { field: "semesterId", operator: "==", value: scope });
    if (!economy.exists && accounts.length === 0 && ledger.length === 0 && inventory.length === 0 && orders.length === 0) return [{ checkId: "wis_economy_readiness", label: "Wis economy readiness", category: "WIS_ECONOMY", required: true, status: "PASS", evidence: "applicability=NOT_APPLICABLE; dependency=none", failureReason: null, ownerWave: "W7" }];
    const sums = new Map(); const sources = new Set(); let invalid = 0; for (const row of ledger) { const entry = row.data || {}; sums.set(entry.accountId, (sums.get(entry.accountId) || 0) + Number(entry.delta || 0)); const key = `${entry.accountId}:${entry.type}:${entry.sourceId}`; if (sources.has(key)) invalid += 1; sources.add(key); }
    const balanceById = new Map(balances.map((row) => [row.data?.accountId, row.data])); const rankingById = new Map(rankings.map((row) => [row.data?.accountId, row.data])); for (const row of accounts) { const account = row.data || {}; if (Number(account.balance || 0) !== (sums.get(account.accountId) || 0) || Number(balanceById.get(account.accountId)?.balance) !== Number(account.balance || 0) || Number(rankingById.get(account.accountId)?.balance) !== Number(account.balance || 0)) invalid += 1; if (Number(economy.data?.initialGrantAmount || 0) > 0 && !account.initialGrantLedgerEntryId) invalid += 1; }
    invalid += inventory.filter((row) => Number(row.data?.available || 0) + Number(row.data?.reserved || 0) + Number(row.data?.sold || 0) !== Number(row.data?.stock || 0)).length; invalid += orders.filter((row) => !["REQUESTED", "APPROVED", "REJECTED", "FULFILLED"].includes(row.data?.status)).length; invalid += issues.filter((row) => !["RESOLVED", "DISMISSED"].includes(row.data?.status)).length;
    const dependencyHash = sha256(canonicalJson({ economy: economy.data, accounts: accounts.map((row) => row.data), ledger: ledger.map((row) => row.data), inventory: inventory.map((row) => row.data), orders: orders.map((row) => row.data) }));
    return [{ checkId: "wis_economy_readiness", label: "Wis economy readiness", category: "WIS_ECONOMY", required: true, status: invalid === 0 ? "PASS" : "FAIL", evidence: `applicability=APPLICABLE; accounts=${accounts.length}; ledger=${ledger.length}; inventory=${inventory.length}; orders=${orders.length}; invalid=${invalid}; dependency=${dependencyHash}`, failureReason: invalid === 0 ? null : "WIS_ECONOMY_READINESS_NOT_PASS", ownerWave: "W7" }];
  },
});

const getWisCommandSessionOptions = (commandType) => ({ recentAuth: HIGH_RISK_COMMAND_TYPES.has(commandType), highRisk: HIGH_RISK_COMMAND_TYPES.has(commandType) });

module.exports = { HIGH_RISK_COMMAND_TYPES, STUDENT_COMMAND_TYPES, WIS_ACCOUNT_COLLECTION, WIS_BALANCE_COLLECTION, WIS_COMMAND_TYPES, WIS_ECONOMY_COLLECTION, WIS_INVENTORY_COLLECTION, WIS_LEDGER_COLLECTION, WIS_LEGACY_ISSUE_COLLECTION, WIS_ORDER_COLLECTION, WIS_POLICY_VERSION, WIS_PRODUCT_COLLECTION, WIS_RANKING_COLLECTION, WIS_RECONCILIATION_COLLECTION, WIS_SCHEMA_VERSION, accountIdFor, createWisCallableExports, createWisCommandAdapter, createWisQueryCore, createWisReadinessAdapter, getWisCommandSessionOptions, inventoryIdFor, normalizeWisPayload };
