const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");

const PRODUCTION_PROJECT_ID = "history-quiz-yongsin";
const APPROVAL_COLLECTION = "production_semester_cutover_approvals";
const POLICY_VERSION = "production-semester-cutover-v1";
const ADMIN_EMAIL = "westoria28@gmail.com";
const MAX_APPROVAL_AGE_MS = 24 * 60 * 60 * 1000;
const FIELDS = ["schemaVersion", "policyVersion", "status", "projectId", "planId", "manifestHash", "sourceSemesterId", "targetSemesterId", "sourceManifestRevision", "targetManifestRevision", "actorUid", "actorEmail", "serverMaintenanceRunId", "backupHash", "approvedAtIso", "expiresAtIso", "approvalHash"];
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,180}$/.test(value);
const revision = value => Number.isSafeInteger(value) && value > 0;
const fail = reason => { throw new HttpsError("failed-precondition", "승인된 운영 학기 전환 계획을 확인해 주세요.", { reason }); };
const stable = value => {
  if (value === null || ["string", "boolean"].includes(typeof value) || (typeof value === "number" && Number.isSafeInteger(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  fail("PRODUCTION_CUTOVER_APPROVAL_INVALID");
};
const hashApproval = value => {
  const { approvalHash, ...body } = value || {};
  return createHash("sha256").update(stable(body)).digest("hex");
};
const resolveProjectId = supplied => {
  if (supplied) return String(supplied).trim();
  const direct = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
  if (direct) return String(direct).trim();
  try { return String(JSON.parse(process.env.FIREBASE_CONFIG || "{}").projectId || "").trim(); } catch { return ""; }
};
const semesterOrdinal = value => {
  const match = /^(20\d{2}|2100)-([12])$/.exec(String(value || ""));
  return match ? Number(match[1]) * 2 + Number(match[2]) : null;
};
const bindingFor = approval => ({ productionApprovalHash: approval.approvalHash, productionProjectId: PRODUCTION_PROJECT_ID });

// This document is server-owned: no callable accepts approval contents or writes it.
// Approval hashes are retained on plans so replacing/renewing a document cannot
// silently authorize an already running attempt under a different approval.
const assertProductionCutoverApproval = async ({ transaction, plan, actor = null, projectId, now = () => new Date(), creating = false }) => {
  const resolvedProject = resolveProjectId(projectId);
  const bound = plan && (Object.hasOwn(plan, "productionApprovalHash") || Object.hasOwn(plan, "productionProjectId"));
  if (resolvedProject !== PRODUCTION_PROJECT_ID && !bound) return null;
  if (resolvedProject && resolvedProject !== PRODUCTION_PROJECT_ID) fail("PRODUCTION_CUTOVER_PROJECT_MISMATCH");
  if (!plan || !id(plan.planId)) fail("PRODUCTION_CUTOVER_PLAN_INVALID");
  const row = await transaction.get(`${APPROVAL_COLLECTION}/${plan.planId}`);
  if (!row.exists) fail("PRODUCTION_CUTOVER_APPROVAL_REQUIRED");
  const approval = row.data;
  const approvedAt = Date.parse(approval?.approvedAtIso), expiresAt = Date.parse(approval?.expiresAtIso);
  const current = new Date(now()).getTime();
  const sourceOrdinal = semesterOrdinal(approval?.sourceSemesterId), targetOrdinal = semesterOrdinal(approval?.targetSemesterId);
  if (!approval || Object.keys(approval).length !== FIELDS.length || FIELDS.some(key => !Object.hasOwn(approval, key)) ||
      approval.schemaVersion !== 1 || approval.policyVersion !== POLICY_VERSION || approval.status !== "APPROVED" ||
      approval.projectId !== PRODUCTION_PROJECT_ID || !id(approval.actorUid) || approval.actorEmail !== ADMIN_EMAIL || !id(approval.serverMaintenanceRunId) ||
      !digest(approval.backupHash) || !digest(approval.manifestHash) || !digest(approval.approvalHash) ||
      !revision(approval.sourceManifestRevision) || !revision(approval.targetManifestRevision) ||
      sourceOrdinal === null || targetOrdinal === null || targetOrdinal <= sourceOrdinal ||
      !Number.isFinite(current) || !Number.isFinite(approvedAt) || !Number.isFinite(expiresAt) ||
      typeof approval.approvedAtIso !== "string" || typeof approval.expiresAtIso !== "string" ||
      new Date(approvedAt).toISOString() !== approval.approvedAtIso || new Date(expiresAt).toISOString() !== approval.expiresAtIso ||
      approvedAt > current || expiresAt <= current || expiresAt <= approvedAt || expiresAt - approvedAt > MAX_APPROVAL_AGE_MS ||
      hashApproval(approval) !== approval.approvalHash) fail("PRODUCTION_CUTOVER_APPROVAL_INVALID");
  const exactFields = ["planId", "manifestHash", "sourceSemesterId", "targetSemesterId", "sourceManifestRevision", "targetManifestRevision"];
  if (exactFields.some(key => plan[key] !== approval[key])) fail("PRODUCTION_CUTOVER_APPROVAL_SCOPE_MISMATCH");
  if (!Array.isArray(plan.operations) || !plan.operations.length) fail("PRODUCTION_CUTOVER_APPROVAL_PLAN_MISMATCH");
  const cutover = require("./semesterCutover");
  if (cutover.computeManifestHash(plan) !== approval.manifestHash || cutover.planIdFor(plan.manifestVersion, plan.sourceSemesterId, plan.targetSemesterId) !== plan.planId)
    fail("PRODUCTION_CUTOVER_APPROVAL_PLAN_MISMATCH");
  if (!creating && (plan.productionApprovalHash !== approval.approvalHash || plan.productionProjectId !== PRODUCTION_PROJECT_ID || plan.createdBy !== approval.actorUid))
    fail("PRODUCTION_CUTOVER_APPROVAL_BINDING_MISMATCH");
  if (actor && (actor.actorRole !== "admin" || actor.actorUid !== approval.actorUid || String(actor.actorEmail || "").trim().toLowerCase() !== approval.actorEmail))
    fail("PRODUCTION_CUTOVER_APPROVAL_ACTOR_MISMATCH");
  return approval;
};

module.exports = { PRODUCTION_PROJECT_ID, APPROVAL_COLLECTION, POLICY_VERSION, MAX_APPROVAL_AGE_MS, hashApproval, resolveProjectId, bindingFor, assertProductionCutoverApproval };
