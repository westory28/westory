import { getHttpsCallable } from "./firebase";

export type CutoverOperationType =
  | "SEMESTER_MANIFEST"
  | "SEMESTER_SETTINGS"
  | "SEMESTER_CLASSES"
  | "SEMESTER_ENROLLMENTS"
  | "ASSESSMENT_DEFINITIONS"
  | "GRADE_MASTER"
  | "LEARNING_CONTENT"
  | "SCHEDULE_EVENTS"
  | "NOTICE_TEMPLATES"
  | "WIS_CATALOG_REFERENCE"
  | "WIS_ECONOMY"
  | "WIS_ACCOUNTS";

export interface CutoverSnapshot {
  count: number;
  hash: string;
}

export interface CutoverOperation {
  operationKey: string;
  operationOrder: number;
  operationType: CutoverOperationType;
  strategy?: string;
  applicable: boolean;
  childCommandType: string | null;
  childCommandId: string | null;
  childPayloadHash: string | null;
  sourceSnapshot: CutoverSnapshot;
  targetBeforeSnapshot: CutoverSnapshot;
  targetAfterSnapshot: CutoverSnapshot;
}

export interface CutoverPlan {
  planId: string;
  planRevision: number;
  status: string;
  manifestVersion: string;
  manifestHash: string;
  sourceSemesterId: string;
  targetSemesterId: string;
  sourceManifestRevision: number;
  targetManifestRevision: number;
  sourceStatus?: string;
  targetStatus?: string;
  operations: CutoverOperation[];
}

export interface CutoverAttempt {
  attemptId: string;
  attemptRevision: number;
  planId: string;
  status: string;
  operationCount: number;
  succeededCount: number;
  failedCount: number;
  pendingCount: number;
  updatedAt?: unknown;
}

export interface CutoverItem extends CutoverOperation {
  itemId: string;
  itemRevision: number;
  status: string;
  errorCode?: string | null;
  errorReason?: string | null;
  receiptId?: string | null;
  dryRun?: {
    actualSource?: CutoverSnapshot;
    actualTargetBefore?: CutoverSnapshot;
    sourceMatch?: boolean;
    targetMatch?: boolean;
  };
}

export interface CutoverEvidence {
  evidenceId: string;
  status: string;
  dependencyHash: string;
  targetManifestRevision: number;
  diffs: Array<{
    operationKey: string;
    expectedSource: CutoverSnapshot;
    actualSource: CutoverSnapshot;
    expectedTarget: CutoverSnapshot;
    actualTarget: CutoverSnapshot;
    sourceStatus: "PASS" | "FAIL";
    targetStatus: "PASS" | "FAIL";
    status: "PASS" | "FAIL";
  }>;
}

export interface CutoverScanEvidence {
  bounded: boolean;
  rowLimit: number;
  byteLimit: number;
  byteCount: number;
  shards: Array<{ shardKey: string; count: number; hash: string }>;
}

export interface CutoverQueryContract {
  manifestVersion: string;
  operationTypes: CutoverOperationType[];
  copyDenylist: string[];
  maxOperations: number;
  applyBatchLimit: number;
  snapshotRowLimits: Record<string, number>;
  snapshotByteLimit: number;
  snapshotTransactionByteLimit: number;
  executionModel: string;
  suggestedPlanPolicy: string;
}

export interface SemesterCutoverState {
  schemaVersion: number;
  policyVersion: string;
  targetSemesterId: string;
  manifestRevision: number;
  manifestStatus: string | null;
  provenance: "CURRENT" | "PREPARING" | "ARCHIVE" | "LEGACY" | "EXPLICIT";
  readOnly: boolean;
  status: string;
  pointer: Record<string, unknown> | null;
  plan: CutoverPlan | null;
  attempt: CutoverAttempt | null;
  items: CutoverItem[];
  evidence: CutoverEvidence | null;
  suggestedPlan: CreateCutoverPlanPayload | null;
  suggestedPlanUnavailableReason:
    | "CANONICAL_TARGET_QUERY_ONLY"
    | "REHEARSAL_MANIFESTS_REQUIRED"
    | "REHEARSAL_LIFECYCLE_INVALID"
    | "APPROVED_CHILD_COMMAND_BLUEPRINT_REQUIRED"
    | "PLAN_ALREADY_EXISTS"
    | null;
  suggestedPlanScanEvidence: Array<{
    operationType: CutoverOperationType;
    source: CutoverScanEvidence;
    target: CutoverScanEvidence;
  }>;
  contract: CutoverQueryContract;
  activationControlsAvailable: false;
  productionControlsAvailable: false;
  writeCount: 0;
}

export interface CreateCutoverPlanPayload {
  manifestVersion: string;
  manifestHash: string;
  sourceSemesterId: string;
  targetSemesterId: string;
  sourceManifestRevision: number;
  targetManifestRevision: number;
  copyDenylist: string[];
  operations: Array<Omit<CutoverOperation, "strategy">>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const asRecord = (value: unknown) => (isObject(value) ? value : {});
const asString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
const asNumber = (value: unknown) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;
const asSnapshot = (value: unknown): CutoverSnapshot => {
  const row = asRecord(value);
  return { count: asNumber(row.count), hash: asString(row.hash) };
};

const asScanEvidence = (value: unknown): CutoverScanEvidence => {
  const row = asRecord(value);
  return {
    bounded: row.bounded === true,
    rowLimit: asNumber(row.rowLimit),
    byteLimit: asNumber(row.byteLimit),
    byteCount: asNumber(row.byteCount),
    shards: Array.isArray(row.shards)
      ? row.shards.map((value) => {
          const shard = asRecord(value);
          return {
            shardKey: asString(shard.shardKey),
            count: asNumber(shard.count),
            hash: asString(shard.hash),
          };
        })
      : [],
  };
};

const asStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const asNumberRecord = (value: unknown) =>
  Object.fromEntries(
    Object.entries(asRecord(value)).map(([key, item]) => [key, asNumber(item)]),
  );

const PROVENANCE_VALUES = new Set<SemesterCutoverState["provenance"]>([
  "CURRENT",
  "PREPARING",
  "ARCHIVE",
  "LEGACY",
  "EXPLICIT",
]);

const asProvenance = (value: unknown): SemesterCutoverState["provenance"] => {
  const provenance = asString(value) as SemesterCutoverState["provenance"];
  return PROVENANCE_VALUES.has(provenance) ? provenance : "EXPLICIT";
};

const asOperation = (value: unknown): CutoverOperation => {
  const row = asRecord(value);
  return {
    operationKey: asString(row.operationKey),
    operationOrder: asNumber(row.operationOrder),
    operationType: asString(row.operationType) as CutoverOperationType,
    strategy: asString(row.strategy),
    applicable: row.applicable !== false,
    childCommandType: asString(row.childCommandType) || null,
    childCommandId: asString(row.childCommandId) || null,
    childPayloadHash: asString(row.childPayloadHash) || null,
    sourceSnapshot: asSnapshot(row.sourceSnapshot),
    targetBeforeSnapshot: asSnapshot(row.targetBeforeSnapshot),
    targetAfterSnapshot: asSnapshot(row.targetAfterSnapshot),
  };
};

const isSuggestedPlan = (value: unknown): value is CreateCutoverPlanPayload => {
  if (!isObject(value)) return false;
  const allowedKeys = new Set([
    "manifestVersion",
    "manifestHash",
    "sourceSemesterId",
    "targetSemesterId",
    "sourceManifestRevision",
    "targetManifestRevision",
    "copyDenylist",
    "operations",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
  if (
    !asString(value.manifestVersion) ||
    !asString(value.manifestHash) ||
    !asString(value.sourceSemesterId) ||
    !asString(value.targetSemesterId) ||
    asNumber(value.sourceManifestRevision) < 1 ||
    asNumber(value.targetManifestRevision) < 1 ||
    !Array.isArray(value.copyDenylist) ||
    !value.copyDenylist.every((item) => typeof item === "string") ||
    !Array.isArray(value.operations) ||
    value.operations.length === 0
  ) {
    return false;
  }
  return value.operations.every((operation) => {
    if (!isObject(operation)) return false;
    const normalized = asOperation(operation);
    return (
      normalized.operationKey.length > 0 &&
      normalized.operationOrder > 0 &&
      normalized.operationType.length > 0
    );
  });
};

const SUGGESTED_PLAN_REASONS = new Set<
  NonNullable<SemesterCutoverState["suggestedPlanUnavailableReason"]>
>([
  "CANONICAL_TARGET_QUERY_ONLY",
  "REHEARSAL_MANIFESTS_REQUIRED",
  "REHEARSAL_LIFECYCLE_INVALID",
  "APPROVED_CHILD_COMMAND_BLUEPRINT_REQUIRED",
  "PLAN_ALREADY_EXISTS",
]);

export const getSemesterCutoverState = async (input: {
  targetSemesterId: string;
  planId?: string;
  attemptId?: string;
}): Promise<SemesterCutoverState> => {
  const callable = await getHttpsCallable<
    typeof input,
    Record<string, unknown>
  >("getSemesterCutoverState");
  const response = await callable(input);
  const raw = asRecord(response.data);
  if (
    raw.writeCount !== 0 ||
    raw.activationControlsAvailable !== false ||
    raw.productionControlsAvailable !== false
  ) {
    throw new Error("W11_CUTOVER_QUERY_CONTRACT_INVALID");
  }
  const planRaw = asRecord(raw.plan);
  const attemptRaw = asRecord(raw.attempt);
  const evidenceRaw = asRecord(raw.evidence);
  const plan = asString(planRaw.planId)
    ? ({
        ...planRaw,
        planId: asString(planRaw.planId),
        planRevision: asNumber(planRaw.planRevision),
        status: asString(planRaw.status),
        manifestVersion: asString(planRaw.manifestVersion),
        manifestHash: asString(planRaw.manifestHash),
        sourceSemesterId: asString(planRaw.sourceSemesterId),
        targetSemesterId: asString(planRaw.targetSemesterId),
        sourceManifestRevision: asNumber(planRaw.sourceManifestRevision),
        targetManifestRevision: asNumber(planRaw.targetManifestRevision),
        operations: Array.isArray(planRaw.operations)
          ? planRaw.operations.map(asOperation)
          : [],
      } as CutoverPlan)
    : null;
  const attempt = asString(attemptRaw.attemptId)
    ? ({
        ...attemptRaw,
        attemptId: asString(attemptRaw.attemptId),
        attemptRevision: asNumber(attemptRaw.attemptRevision),
        planId: asString(attemptRaw.planId),
        status: asString(attemptRaw.status),
        operationCount: asNumber(attemptRaw.operationCount),
        succeededCount: asNumber(attemptRaw.succeededCount),
        failedCount: asNumber(attemptRaw.failedCount),
        pendingCount: asNumber(attemptRaw.pendingCount),
      } as CutoverAttempt)
    : null;
  const evidence = asString(evidenceRaw.evidenceId)
    ? ({
        ...evidenceRaw,
        evidenceId: asString(evidenceRaw.evidenceId),
        status: asString(evidenceRaw.status),
        dependencyHash: asString(evidenceRaw.dependencyHash),
        targetManifestRevision: asNumber(evidenceRaw.targetManifestRevision),
        diffs: Array.isArray(evidenceRaw.diffs)
          ? evidenceRaw.diffs.map((value) => {
              const diff = asRecord(value);
              const sourceStatus =
                asString(diff.sourceStatus) === "PASS" ? "PASS" : "FAIL";
              const targetStatus =
                asString(diff.targetStatus) === "PASS" ? "PASS" : "FAIL";
              return {
                operationKey: asString(diff.operationKey),
                expectedSource: asSnapshot(diff.expectedSource),
                actualSource: asSnapshot(diff.actualSource),
                expectedTarget: asSnapshot(diff.expectedTarget),
                actualTarget: asSnapshot(diff.actualTarget),
                sourceStatus,
                targetStatus,
                status:
                  asString(diff.status) === "PASS" &&
                  sourceStatus === "PASS" &&
                  targetStatus === "PASS"
                    ? "PASS"
                    : "FAIL",
              };
            })
          : [],
      } as CutoverEvidence)
    : null;
  const suggestedPlan = isSuggestedPlan(raw.suggestedPlan)
    ? raw.suggestedPlan
    : null;
  const suggestedReason = asString(
    raw.suggestedPlanUnavailableReason,
  ) as NonNullable<SemesterCutoverState["suggestedPlanUnavailableReason"]>;
  const contractRaw = asRecord(raw.contract);
  return {
    schemaVersion: asNumber(raw.schemaVersion),
    policyVersion: asString(raw.policyVersion),
    targetSemesterId: asString(raw.targetSemesterId),
    manifestRevision: asNumber(raw.manifestRevision),
    manifestStatus: asString(raw.manifestStatus) || null,
    provenance: asProvenance(raw.provenance),
    readOnly: raw.readOnly !== false,
    status: asString(raw.status) || "EMPTY",
    pointer: isObject(raw.pointer) ? raw.pointer : null,
    plan,
    attempt,
    items: Array.isArray(raw.items)
      ? raw.items.map((value) => {
          const item = asRecord(value);
          return {
            ...asOperation(item),
            itemId: asString(item.itemId),
            itemRevision: asNumber(item.itemRevision),
            status: asString(item.status),
            errorCode: asString(item.errorCode) || null,
            errorReason: asString(item.errorReason) || null,
            receiptId: asString(item.receiptId) || null,
            dryRun: isObject(item.dryRun)
              ? {
                  actualSource: asSnapshot(item.dryRun.actualSource),
                  actualTargetBefore: asSnapshot(
                    item.dryRun.actualTargetBefore,
                  ),
                  sourceMatch: item.dryRun.sourceMatch === true,
                  targetMatch: item.dryRun.targetMatch === true,
                }
              : undefined,
          };
        })
      : [],
    evidence,
    suggestedPlan,
    suggestedPlanUnavailableReason: SUGGESTED_PLAN_REASONS.has(suggestedReason)
      ? suggestedReason
      : null,
    suggestedPlanScanEvidence: Array.isArray(raw.suggestedPlanScanEvidence)
      ? raw.suggestedPlanScanEvidence.map((value) => {
          const row = asRecord(value);
          return {
            operationType: asString(row.operationType) as CutoverOperationType,
            source: asScanEvidence(row.source),
            target: asScanEvidence(row.target),
          };
        })
      : [],
    contract: {
      manifestVersion: asString(contractRaw.manifestVersion),
      operationTypes: asStringArray(
        contractRaw.operationTypes,
      ) as CutoverOperationType[],
      copyDenylist: asStringArray(contractRaw.copyDenylist),
      maxOperations: asNumber(contractRaw.maxOperations),
      applyBatchLimit: asNumber(contractRaw.applyBatchLimit),
      snapshotRowLimits: asNumberRecord(contractRaw.snapshotRowLimits),
      snapshotByteLimit: asNumber(contractRaw.snapshotByteLimit),
      snapshotTransactionByteLimit: asNumber(
        contractRaw.snapshotTransactionByteLimit,
      ),
      executionModel: asString(contractRaw.executionModel),
      suggestedPlanPolicy: asString(contractRaw.suggestedPlanPolicy),
    },
    activationControlsAvailable: false,
    productionControlsAvailable: false,
    writeCount: 0,
  };
};
