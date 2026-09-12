const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const { buildEnrollmentSlotId } = require("./archiveEnrollment");

const APPROVAL_COLLECTION = "wis_initial_opening_approvals";
const CONTROL_COLLECTION = "wis_initial_opening_controls";
const POLICY_VERSION = "wis-same-semester-initial-opening-v1";
const INITIAL_GRANT_AMOUNT = 500;
const PRODUCTION_PROJECT = "history-quiz-yongsin";
const MAX_TARGETS = 500;
const MAX_SCOPE_ROWS = 1000;
const TOTAL_FIELDS = ["balance", "earnedTotal", "spentTotal", "adjustedTotal", "rankEarnedTotal"];
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === "string" && value === value.trim() && value.length > 0 &&
  value.length <= 180 && !value.includes("/") && ![".", "..", "__proto__"].includes(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const fail = reason => { throw new HttpsError("failed-precondition", "승인된 위스 초기 지급 계획과 준비 상태를 확인해 주세요.", { reason }); };
const stable = value => {
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      (typeof value === "number" && Number.isSafeInteger(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  fail("WIS_INITIAL_OPENING_APPROVAL_INVALID");
};
const hashApprovalPlan = plan => {
  const { exactPlanHash, ...body } = plan || {};
  return createHash("sha256").update(stable(body)).digest("hex");
};
const resolveProjectId = supplied => {
  if (supplied) return supplied;
  if (process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT) return process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  try { return JSON.parse(process.env.FIREBASE_CONFIG || "{}").projectId; } catch { return undefined; }
};
const allowedProject = projectId => projectId === PRODUCTION_PROJECT ||
  projectId === "westory-staging-177587430482" || /^demo-[a-z0-9-]+$/.test(projectId || "");
const hasReference = data => data && (Object.hasOwn(data, "initialOpeningPlanId") || Object.hasOwn(data, "initialOpeningPlanHash"));
const bindingFor = plan => ({ initialOpeningPlanId: plan.planId, initialOpeningPlanHash: plan.exactPlanHash,
  initialOpeningBackupHash: plan.backupHash, initialOpeningPolicyVersion: POLICY_VERSION, initialOpeningTargetCount: plan.targetCount,
  initialOpeningGrantAmount: plan.initialGrantAmount, initialOpeningTotalGrantAmount: plan.totalInitialGrantAmount });

// Server-owned approval only. Commands never supply a plan, a target list or a
// opening amount. This gate performs no grants, deletions or legacy source writes.
const loadApprovalPlan = async ({ transaction, economy, manifest, semesterId, expectedSemesterRevision, actor, projectId, now = () => new Date() }) => {
  projectId = resolveProjectId(projectId);
  const control = await transaction.get(`${CONTROL_COLLECTION}/${semesterId}`);
  const references = [control.data, economy].filter(hasReference);
  if (!references.length) {
    // A normal new semester retains its existing initial-grant lifecycle.
    // Only the current legacy-backfill scope (or an explicit retained plan)
    // requires the one-time administrator-approved fresh opening boundary.
    if (projectId === PRODUCTION_PROJECT && manifest?.bootstrapMode === "LEGACY_ACTIVE_BACKFILL")
      fail("WIS_INITIAL_OPENING_APPROVAL_REQUIRED");
    return null;
  }
  const reference = references[0];
  if (!id(reference.initialOpeningPlanId) || !digest(reference.initialOpeningPlanHash) || references.some(item =>
    item.initialOpeningPlanId !== reference.initialOpeningPlanId || item.initialOpeningPlanHash !== reference.initialOpeningPlanHash))
    fail("WIS_INITIAL_OPENING_APPROVAL_REFERENCE_MISMATCH");
  const row = await transaction.get(`${APPROVAL_COLLECTION}/${reference.initialOpeningPlanId}`), plan = row.data;
  const time = now().getTime();
  if (!row.exists || !plan || Buffer.byteLength(stable(plan)) > 768 * 1024 ||
      plan.schemaVersion !== 1 || plan.planId !== reference.initialOpeningPlanId || plan.policyVersion !== POLICY_VERSION ||
      plan.openingPolicy !== "FRESH_INITIAL_GRANT" || plan.carryOverPolicy !== "NONE" ||
      plan.initialGrantAmount !== INITIAL_GRANT_AMOUNT || plan.totalInitialGrantAmount !== plan.targetCount * INITIAL_GRANT_AMOUNT ||
      plan.legacySourcePolicy !== "PRESERVE_UNCHANGED" || plan.status !== "APPROVED" ||
      !allowedProject(projectId) || plan.projectId !== projectId || !/^\d{4}-[12]$/.test(semesterId || "") || plan.semesterId !== semesterId ||
      actor?.actorRole !== "admin" || !id(plan.adminUid) || plan.adminUid !== actor.actorUid ||
      plan.adminEmail !== "westoria28@gmail.com" || String(actor.actorEmail || "").toLowerCase() !== plan.adminEmail ||
      !positive(plan.expectedSemesterRevision) || plan.expectedSemesterRevision !== expectedSemesterRevision ||
      !positive(plan.expectedEconomyRevision) || plan.expectedEconomyRevision !== economy.revision || !digest(plan.backupHash) ||
      typeof plan.expiresAtIso !== "string" || !Number.isFinite(Date.parse(plan.expiresAtIso)) || !Number.isFinite(time) || Date.parse(plan.expiresAtIso) <= time ||
      !digest(plan.exactPlanHash) || plan.exactPlanHash !== reference.initialOpeningPlanHash || hashApprovalPlan(plan) !== plan.exactPlanHash ||
      !positive(plan.targetCount) || !Array.isArray(plan.targets) || plan.targetCount !== plan.targets.length || plan.targetCount > MAX_TARGETS)
    fail("WIS_INITIAL_OPENING_APPROVAL_INVALID");
  const seenUids = new Set(), seenEnrollments = new Set(), seenAccounts = new Set(), seenGrants = new Set(), seenGrantReceipts = new Set();
  for (const target of plan.targets) {
    if (!target || !id(target.studentUid) || target.studentUid.length > 128 || seenUids.has(target.studentUid) ||
        target.identityId !== target.studentUid || !id(target.enrollmentId) || seenEnrollments.has(target.enrollmentId) ||
        !id(target.classId) || !id(target.accountId) || seenAccounts.has(target.accountId) || !id(target.creationReceiptId) ||
        !id(target.grantLedgerEntryId) || seenGrants.has(target.grantLedgerEntryId) ||
        !id(target.grantReceiptId) || seenGrantReceipts.has(target.grantReceiptId))
      fail("WIS_INITIAL_OPENING_APPROVAL_INVALID");
    seenUids.add(target.studentUid); seenEnrollments.add(target.enrollmentId); seenAccounts.add(target.accountId);
    seenGrants.add(target.grantLedgerEntryId); seenGrantReceipts.add(target.grantReceiptId);
  }
  return plan;
};
const assertReadyToOpen = async args => {
  const plan = await loadApprovalPlan(args);
  if (!plan) return null;
  const { transaction, economy, semesterId } = args, wis = require("./wisEconomy");
  const [manifest, pointer, maintenance] = await transaction.getAll([
    `semester_manifests/${semesterId}`, "site_settings/semester_active", "site_settings/student_maintenance",
  ]);
  if (!manifest.exists || manifest.data?.semesterId !== semesterId || manifest.data.status !== "ACTIVE" ||
      manifest.data.revision !== plan.expectedSemesterRevision || manifest.data.readOnly === true ||
      !pointer.exists || pointer.data?.semesterId !== semesterId || pointer.data.revision !== plan.expectedSemesterRevision ||
      !maintenance.exists || maintenance.data?.enabled !== true)
    fail("WIS_INITIAL_OPENING_ACTIVE_SCOPE_REQUIRED");
  if (economy.status !== "ACTIVE_INITIALIZING" || economy.initialGrantAmount !== INITIAL_GRANT_AMOUNT || economy.readOnly === true ||
      economy.accountCount !== plan.targetCount || economy.initializedAccountCount !== plan.targetCount || economy.ledgerEntryCount !== plan.targetCount ||
      economy.orderCount !== 0 || (economy.legacyMigrationCount ?? 0) !== 0 || (economy.unresolvedLegacyIssueCount ?? 0) !== 0)
    fail("WIS_INITIAL_OPENING_ECONOMY_INCOMPLETE");
  const scoped = async collection => {
    const rows = await transaction.query(collection, { filters: [{ field: "semesterId", operator: "==", value: semesterId }], limit: MAX_SCOPE_ROWS + 1 });
    if (rows.length > MAX_SCOPE_ROWS) fail("WIS_INITIAL_OPENING_SCOPE_LIMIT");
    return rows;
  };
  const accounts = await scoped(wis.WIS_ACCOUNT_COLLECTION);
  const balances = await scoped(wis.WIS_BALANCE_COLLECTION), rankings = await scoped(wis.WIS_RANKING_COLLECTION);
  const enrollments = (await scoped("semester_enrollments")).filter(row => row.data?.enrollmentStatus === "ACTIVE");
  const studentRows = await transaction.query("users", { filters: [{ field: "role", operator: "==", value: "student" }], limit: MAX_TARGETS + 1 });
  if (studentRows.length > MAX_TARGETS) fail("WIS_INITIAL_OPENING_SCOPE_LIMIT");
  const approvedStudents = studentRows.filter(row => !Object.hasOwn(row.data, "registrationApprovalStatus") || row.data.registrationApprovalStatus === "APPROVED");
  const expectedUids = new Set(plan.targets.map(target => target.studentUid));
  if (approvedStudents.length !== plan.targetCount || approvedStudents.some(row => !expectedUids.has(row.path.slice("users/".length)) ||
      row.path !== `users/${row.path.slice("users/".length)}` || row.path.slice("users/".length).includes("/")))
    fail("WIS_INITIAL_OPENING_TARGET_SET_MISMATCH");
  const expectedAccounts = new Set(plan.targets.map(target => target.accountId));
  const expectedEnrollments = new Set(plan.targets.map(target => target.enrollmentId));
  if (accounts.length !== plan.targetCount || enrollments.length !== plan.targetCount ||
      accounts.some(row => !expectedAccounts.has(row.data?.accountId) || row.path !== `${wis.WIS_ACCOUNT_COLLECTION}/${row.data.accountId}`) ||
      enrollments.some(row => !expectedEnrollments.has(row.data?.enrollmentId) || row.path !== `semester_enrollments/${row.data.enrollmentId}`))
    fail("WIS_INITIAL_OPENING_TARGET_SET_MISMATCH");
  for (const [rows, collection] of [[balances, wis.WIS_BALANCE_COLLECTION], [rankings, wis.WIS_RANKING_COLLECTION]]) {
    if (rows.length !== plan.targetCount || rows.some(row => !expectedAccounts.has(row.data?.accountId) || row.path !== `${collection}/${row.data.accountId}`))
      fail("WIS_INITIAL_OPENING_TARGET_SET_MISMATCH");
  }
  const ledger = await scoped(wis.WIS_LEDGER_COLLECTION), expectedLedgerIds = new Set(plan.targets.map(target => target.grantLedgerEntryId));
  if (ledger.length !== plan.targetCount || ledger.some(row => !expectedLedgerIds.has(row.data?.ledgerEntryId) || row.path !== `${wis.WIS_LEDGER_COLLECTION}/${row.data.ledgerEntryId}`))
    fail("WIS_INITIAL_OPENING_LEDGER_INVALID");
  if ((await transaction.query(wis.WIS_ORDER_COLLECTION, { filters: [{ field: "semesterId", operator: "==", value: semesterId }], limit: 1 })).length)
    fail("WIS_INITIAL_OPENING_ACTIVITY_EXISTS");
  const accountMap = new Map(accounts.map(row => [row.data.accountId, row.data]));
  const balanceMap = new Map(balances.map(row => [row.data.accountId, row.data]));
  const rankingMap = new Map(rankings.map(row => [row.data.accountId, row.data]));
  const enrollmentMap = new Map(enrollments.map(row => [row.data.enrollmentId, row.data]));
  const ledgerMap = new Map(ledger.map(row => [row.data.ledgerEntryId, row.data]));
  const receiptTargets = new Map();
  for (const target of plan.targets) {
    if (!receiptTargets.has(target.creationReceiptId)) receiptTargets.set(target.creationReceiptId, []);
    receiptTargets.get(target.creationReceiptId).push(target);
  }
  const readPaths = [...new Set(plan.targets.flatMap(target => [
    `users/${target.studentUid}`, `student_identities/${target.identityId}`,
    `semester_enrollment_slots/${buildEnrollmentSlotId(semesterId, target.studentUid)}`, `semester_classes/${target.classId}`,
    `command_receipts/${target.creationReceiptId}`,
    `command_receipts/${target.grantReceiptId}`,
  ]))];
  // Bounded chunks avoid a single very large getAll RPC; all reads remain before
  // the caller's economy/receipt/audit transaction writes.
  const documents = new Map();
  for (let offset = 0; offset < readPaths.length; offset += 100) {
    const batch = readPaths.slice(offset, offset + 100), rows = await transaction.getAll(batch);
    rows.forEach((row, index) => documents.set(batch[index], row.exists ? row.data : null));
  }
  const expectedTotals = wis.initialGrantTotalsFor(INITIAL_GRANT_AMOUNT);
  let totalBalance = 0, totalLedgerDelta = 0;
  for (const target of plan.targets) {
    const profile = documents.get(`users/${target.studentUid}`), identity = documents.get(`student_identities/${target.identityId}`);
    const slot = documents.get(`semester_enrollment_slots/${buildEnrollmentSlotId(semesterId, target.studentUid)}`);
    const enrollment = enrollmentMap.get(target.enrollmentId), semesterClass = documents.get(`semester_classes/${target.classId}`);
    if (!profile || profile.role !== "student" ||
        (Object.hasOwn(profile, "registrationApprovalStatus") && profile.registrationApprovalStatus !== "APPROVED") ||
        !identity || identity.studentUid !== target.studentUid || identity.accountStatus !== "ACTIVE" ||
        !slot || slot.studentUid !== target.studentUid || slot.semesterId !== semesterId || slot.activeEnrollmentId !== target.enrollmentId || slot.status !== "ACTIVE" ||
        !enrollment || enrollment.studentUid !== target.studentUid || enrollment.classId !== target.classId || enrollment.readOnly === true ||
        !semesterClass || semesterClass.classId !== target.classId || semesterClass.semesterId !== semesterId || semesterClass.status !== "ACTIVE" || semesterClass.readOnly === true)
      fail("WIS_INITIAL_OPENING_ENROLLMENT_INVALID");
    const account = accountMap.get(target.accountId), balance = balanceMap.get(target.accountId), ranking = rankingMap.get(target.accountId);
    if (target.accountId !== wis.accountIdFor(semesterId, target.studentUid) || [account, balance, ranking].some(row =>
      !row || row.schemaVersion !== wis.WIS_SCHEMA_VERSION || row.policyVersion !== wis.WIS_POLICY_VERSION ||
      row.accountId !== target.accountId || row.studentUid !== target.studentUid || row.semesterId !== semesterId ||
      row.enrollmentId !== target.enrollmentId || row.classId !== target.classId) ||
      [account, balance].some(row => TOTAL_FIELDS.some(field => row[field] !== expectedTotals[field]) || row.status !== "ACTIVE" ||
        row.provenance !== "CURRENT" || row.readOnly !== false || row.legacyMigrationId) ||
      account.revision !== 2 || account.initialGrantLedgerEntryId !== target.grantLedgerEntryId ||
      !Array.isArray(account.recentLedgerEntries) || account.recentLedgerEntries.length !== 1 ||
      balance.ledgerRevision !== 2 || ranking.ledgerRevision !== 2 || ranking.balance !== INITIAL_GRANT_AMOUNT || ranking.rankEarnedTotal !== expectedTotals.rankEarnedTotal || ranking.legacyMigrationId)
      fail("WIS_INITIAL_OPENING_ACCOUNT_INVALID");
    const entry = ledgerMap.get(target.grantLedgerEntryId), receipt = documents.get(`command_receipts/${target.grantReceiptId}`);
    if (!entry || entry.schemaVersion !== wis.WIS_SCHEMA_VERSION || entry.policyVersion !== wis.WIS_POLICY_VERSION ||
        entry.type !== "INITIAL_GRANT" || entry.semesterId !== semesterId || entry.studentUid !== target.studentUid || entry.accountId !== target.accountId ||
        entry.ledgerEntryId !== target.grantLedgerEntryId || entry.delta !== INITIAL_GRANT_AMOUNT || entry.balanceBefore !== 0 || entry.balanceAfter !== INITIAL_GRANT_AMOUNT ||
        typeof entry.sourceId !== "string" || !entry.sourceId.trim() || entry.sourceId.length > 180 ||
        entry.ledgerEntryId !== wis.ledgerIdFor(semesterId, target.accountId, "INITIAL_GRANT", entry.sourceId) ||
        entry.receiptId !== target.grantReceiptId || entry.actorUid !== plan.adminUid || entry.actorRole !== "admin" ||
        ["ledgerEntryId", "type", "delta", "balanceBefore", "balanceAfter", "sourceId", "receiptId", "commandId"].some(key => account.recentLedgerEntries[0]?.[key] !== entry[key]))
      fail("WIS_INITIAL_OPENING_LEDGER_INVALID");
    const refs = [`${wis.WIS_LEDGER_COLLECTION}/${entry.ledgerEntryId}`, `${wis.WIS_ACCOUNT_COLLECTION}/${target.accountId}`,
      `${wis.WIS_BALANCE_COLLECTION}/${target.accountId}`, `${wis.WIS_RANKING_COLLECTION}/${target.accountId}`];
    if (!receipt || receipt.status !== "SUCCEEDED" || receipt.checkpoint !== "COMMITTED" || receipt.commandType !== "grantInitialWis" ||
        receipt.commandId !== entry.commandId || receipt.actorUid !== plan.adminUid || receipt.actorRole !== "admin" || receipt.actorEmail !== plan.adminEmail ||
        !digest(receipt.payloadHash) || receipt.sourceHash !== createHash("sha256").update(`INITIAL_GRANT\n${entry.sourceId}`).digest("hex") ||
        receipt.target?.kind !== "wis-ledger" || receipt.target.id !== entry.ledgerEntryId ||
        receipt.result?.accountId !== target.accountId || receipt.result.ledgerEntryId !== entry.ledgerEntryId || receipt.result.balance !== INITIAL_GRANT_AMOUNT ||
        receipt.result.accountRevision !== 2 || receipt.result.type !== "INITIAL_GRANT" ||
        !Array.isArray(receipt.target.refs) || receipt.target.refs.length !== refs.length || new Set(receipt.target.refs).size !== refs.length ||
        refs.some(ref => !receipt.target.refs.includes(ref)))
      fail("WIS_INITIAL_OPENING_GRANT_RECEIPT_INVALID");
    totalBalance += account.balance; totalLedgerDelta += entry.delta;
  }
  if (totalBalance !== plan.totalInitialGrantAmount || totalLedgerDelta !== plan.totalInitialGrantAmount)
    fail("WIS_INITIAL_OPENING_TOTAL_INVALID");
  for (const [receiptId, targets] of receiptTargets) {
    const receipt = documents.get(`command_receipts/${receiptId}`);
    const refs = targets.flatMap(target => [`${wis.WIS_ACCOUNT_COLLECTION}/${target.accountId}`,
      `${wis.WIS_BALANCE_COLLECTION}/${target.accountId}`, `${wis.WIS_RANKING_COLLECTION}/${target.accountId}`]);
    if (!receipt || receipt.status !== "SUCCEEDED" || receipt.checkpoint !== "COMMITTED" || receipt.commandType !== "createWisAccounts" ||
        receipt.actorUid !== plan.adminUid || receipt.actorRole !== "admin" || receipt.actorEmail !== plan.adminEmail ||
        !digest(receipt.payloadHash) || !digest(receipt.sourceHash) || receipt.target?.kind !== "wis-accounts" || receipt.target.id !== semesterId ||
        receipt.result?.semesterId !== semesterId || receipt.result.createdCount !== targets.length || receipt.result.syncedCount !== 0 ||
        !Array.isArray(receipt.target.refs) || receipt.target.refs.length !== refs.length ||
        new Set(receipt.target.refs).size !== refs.length || refs.some(ref => !receipt.target.refs.includes(ref)))
      fail("WIS_INITIAL_OPENING_RECEIPT_INVALID");
  }
  return bindingFor(plan);
};
module.exports = { APPROVAL_COLLECTION, CONTROL_COLLECTION, POLICY_VERSION, PRODUCTION_PROJECT, MAX_TARGETS, INITIAL_GRANT_AMOUNT,
  hashApprovalPlan, bindingFor, loadApprovalPlan, assertReadyToOpen };
