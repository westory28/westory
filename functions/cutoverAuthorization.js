const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");

const sha256 = (value) => createHash("sha256").update(String(value), "utf8").digest("hex");
const attemptIdFor = (planId) => `cutattempt_${sha256(planId)}`;
const itemIdFor = (attemptId, operationKey) => `cutitem_${sha256(`${attemptId}\n${operationKey}`)}`;

const fail = (reason, details = {}) => {
  throw new HttpsError("failed-precondition", "A verified W11 Cutover Plan item is required.", {
    reason,
    ...details,
  });
};

const assertPreparingCutoverCreate = async ({
  transaction,
  semesterId,
  actor,
  commandType,
  commandId,
  payloadHash,
  cutoverPlanId,
  cutoverOperationKey,
  operationType,
}) => {
  if (
    actor?.actorRole !== "admin"
    || String(actor?.actorEmail || "").trim().toLowerCase() !== "westoria28@gmail.com"
  ) {
    fail("W11_PREPARING_ADMIN_REQUIRED");
  }
  if (!cutoverPlanId || !cutoverOperationKey) fail("W11_CUTOVER_CONTEXT_REQUIRED");
  const attemptId = attemptIdFor(cutoverPlanId);
  const planPath = `semester_cutover_plans/${cutoverPlanId}`;
  const attemptPath = `semester_cutover_attempts/${attemptId}`;
  const itemPath = `semester_cutover_attempts/${attemptId}/items/${itemIdFor(attemptId, cutoverOperationKey)}`;
  const targetPath = `semester_cutover_targets/${semesterId}`;
  const [target, plan, attempt, item] = await transaction.getAll([targetPath, planPath, attemptPath, itemPath]);
  if (
    !target.exists
    || target.data?.targetSemesterId !== semesterId
    || target.data?.latestPlanId !== cutoverPlanId
    || target.data?.latestAttemptId !== attemptId
    || !plan.exists
    || plan.data?.targetSemesterId !== semesterId
    || plan.data?.latestAttemptId !== attemptId
    || !["DRY_RUN_PASSED", "APPLYING", "PARTIAL"].includes(plan.data?.status)
    || !attempt.exists
    || attempt.data?.planId !== cutoverPlanId
    || !["DRY_RUN_PASSED", "APPLYING", "PARTIAL"].includes(attempt.data?.status)
    || !item.exists
    || item.data?.operationKey !== cutoverOperationKey
    || item.data?.operationType !== operationType
    || item.data?.status !== "PENDING"
    || item.data?.childCommandType !== commandType
    || item.data?.childCommandId !== commandId
    || item.data?.childPayloadHash !== payloadHash
  ) {
    fail("W11_CUTOVER_ITEM_MISMATCH", {
      cutoverPlanId,
      cutoverOperationKey,
      commandType,
    });
  }
  return { planId: cutoverPlanId, attemptId, itemPath };
};

const getCutoverTargetMarker = (transaction, semesterId) =>
  transaction.get(`semester_cutover_targets/${semesterId}`);

const assertPreparingCutoverCreateIfTargeted = async (options) => {
  const marker = await getCutoverTargetMarker(options.transaction, options.semesterId);
  if (!marker.exists || !marker.data?.latestPlanId) {
    if (options.allowWithoutMarker) return { required: false, marker: null };
    fail("W11_CUTOVER_TARGET_REQUIRED", { semesterId: options.semesterId });
  }
  if (marker.data?.targetSemesterId !== options.semesterId) {
    fail("W11_CUTOVER_TARGET_SCOPE_MISMATCH", { semesterId: options.semesterId, markerSemesterId: marker.data?.targetSemesterId || null });
  }
  if (options.cutoverPlanId && options.cutoverPlanId !== marker.data.latestPlanId) {
    fail("W11_CUTOVER_TARGET_PLAN_MISMATCH", { cutoverPlanId: options.cutoverPlanId, latestPlanId: marker.data.latestPlanId });
  }
  const context = await assertPreparingCutoverCreate({ ...options, cutoverPlanId: options.cutoverPlanId || marker.data.latestPlanId });
  return { required: true, marker: marker.data, ...context };
};

module.exports = {
  assertPreparingCutoverCreate,
  assertPreparingCutoverCreateIfTargeted,
  attemptIdFor,
  itemIdFor,
};
