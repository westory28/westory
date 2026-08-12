import type { SystemConfig } from "../types";
import {
  executeWestoryCommand,
  type CommandGatewayResponse,
  type TeacherBulkCommandItem,
  type TeacherDraftCommandKey,
  type TeacherOperationsCommandResult,
  type W2CommandPayloads,
  type W2CommandType,
} from "./commandGateway";
import { getHttpsCallable } from "./firebase";
import { getYearSemester } from "./semesterScope";

type JsonRecord = Record<string, unknown>;
type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;

export type TeacherOperationsSource =
  | "CURRENT"
  | "ARCHIVE"
  | "LEGACY"
  | "EXPLICIT";
export type TeacherDraftStatus =
  | "ACTIVE"
  | "CONFLICT"
  | "SAVED"
  | "DISCARDED"
  | "EXPIRED";
export type TeacherBulkStatus =
  | "READY"
  | "RUNNING"
  | "PARTIAL"
  | "SUCCEEDED"
  | "FAILED";
export type TeacherBulkPolicy = "ALL_OR_NOTHING" | "ITEMIZED_PARTIAL";
export type TeacherBulkDomain =
  | "ASSESSMENT"
  | "GRADE"
  | "WIS"
  | "LEARNING"
  | "SCHEDULE"
  | "ATTENDANCE"
  | "COMMUNICATION";

export interface TeacherDraftRecord {
  draftId: string;
  semesterId: string;
  key: TeacherDraftCommandKey;
  baseEntityRevision: number | null;
  basePayloadHash: string | null;
  intendedCommandType: W2CommandType;
  expectedCommandPayloadHash: string;
  payload: JsonRecord;
  payloadHash: string;
  draftRevision: number;
  status: TeacherDraftStatus;
  conflictReason: string;
  expiresAt: string;
  updatedAt: string;
  readOnly: boolean;
}

export interface TeacherBulkJobItem extends TeacherBulkCommandItem {
  attempt: number;
  childCommandId: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  receiptId: string;
  errorCode: string;
  errorReason: string;
}

export interface TeacherBulkJob {
  jobId: string;
  semesterId: string;
  clientBulkId: string;
  domain: TeacherBulkDomain;
  operationType: string;
  policy: TeacherBulkPolicy;
  filter: JsonRecord;
  filterHash: string;
  previewHash: string;
  jobRevision: number;
  status: TeacherBulkStatus;
  items: TeacherBulkJobItem[];
  createdAt: string;
  updatedAt: string;
  readOnly: boolean;
}

export interface TeacherOperationsState {
  semesterId: string;
  manifestRevision: number;
  provenance: "CURRENT" | "PREPARING" | "ARCHIVE" | "LEGACY" | "EXPLICIT";
  source: TeacherOperationsSource;
  readOnly: boolean;
  status: "CONTENT" | "EMPTY" | "ARCHIVED" | "LEGACY";
  drafts: TeacherDraftRecord[];
  bulkJobs: TeacherBulkJob[];
  warnings: Array<{
    code: string;
    draftId?: string;
    jobId?: string;
    limit?: number;
    draftTruncated?: boolean;
    jobTruncated?: boolean;
  }>;
  reason: string;
  writeCount: 0;
}

export class TeacherOperationsError extends Error {
  constructor(
    public readonly kind:
      | "VALIDATION"
      | "PERMISSION"
      | "SESSION_EXPIRED"
      | "CONFLICT"
      | "NETWORK"
      | "UNKNOWN",
    message: string,
    public readonly reason = "",
  ) {
    super(message);
    this.name = "TeacherOperationsError";
  }
}

const record = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
const rows = (value: unknown) =>
  Array.isArray(value) ? value.map(record) : [];
const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const boolean = (value: unknown) => value === true;
const dateTime = (value: unknown) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  const timestamp = record(value);
  const seconds = Number(timestamp.seconds ?? timestamp._seconds);
  return Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : text(value);
};
const stringEnum = <T extends string>(
  value: unknown,
  values: readonly T[],
  fallback: T,
) => (values.includes(value as T) ? (value as T) : fallback);

const getCurrentSemesterId = (config: ConfigLike) => {
  const resolved = getYearSemester(config);
  return `${resolved.year}-${resolved.semester}`;
};

const functionDetails = (error: unknown) =>
  record(
    (error as { details?: unknown })?.details ??
      (error as { customData?: { details?: unknown } })?.customData?.details,
  );

const mapError = (error: unknown) => {
  if (error instanceof TeacherOperationsError) return error;
  const code = text((error as { code?: unknown })?.code).toLowerCase();
  const details = functionDetails(error);
  const reason = text(details.reason || details.code);
  const message =
    text((error as { message?: unknown })?.message) ||
    "교사 업무 상태를 처리하지 못했습니다.";
  if (code.includes("unauthenticated") || reason.includes("SESSION")) {
    return new TeacherOperationsError("SESSION_EXPIRED", message, reason);
  }
  if (code.includes("permission-denied")) {
    return new TeacherOperationsError("PERMISSION", message, reason);
  }
  if (code.includes("aborted") || reason.includes("CONFLICT")) {
    return new TeacherOperationsError("CONFLICT", message, reason);
  }
  if (
    code.includes("unavailable") ||
    code.includes("deadline-exceeded") ||
    code.includes("network")
  ) {
    return new TeacherOperationsError("NETWORK", message, reason);
  }
  if (code.includes("invalid-argument")) {
    return new TeacherOperationsError("VALIDATION", message, reason);
  }
  return new TeacherOperationsError("UNKNOWN", message, reason);
};

const canonicalize = (value: unknown): string => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (!value || typeof value !== "object") {
    throw new TeacherOperationsError(
      "VALIDATION",
      "임시 저장 내용은 JSON 형식이어야 합니다.",
      "W9_PAYLOAD_INVALID",
    );
  }
  const source = value as JsonRecord;
  return `{${Object.keys(source)
    .sort()
    .map((key) => {
      if (source[key] === undefined) {
        throw new TeacherOperationsError(
          "VALIDATION",
          "임시 저장 내용에 비어 있는 필드가 있습니다.",
          "W9_PAYLOAD_INVALID",
        );
      }
      return `${JSON.stringify(key)}:${canonicalize(source[key])}`;
    })
    .join(",")}}`;
};

export const hashTeacherOperationPayload = async (value: unknown) => {
  const bytes = new TextEncoder().encode(canonicalize(value));
  if (!globalThis.crypto?.subtle) {
    throw new TeacherOperationsError(
      "VALIDATION",
      "안전한 임시 저장 해시를 만들 수 없습니다.",
      "W9_HASH_UNAVAILABLE",
    );
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (item) =>
    item.toString(16).padStart(2, "0"),
  ).join("");
};

const normalizeDraft = (value: unknown): TeacherDraftRecord => {
  const item = record(value);
  const key = record(item.key);
  return {
    draftId: text(item.draftId),
    semesterId: text(item.semesterId),
    key: {
      routeKey: text(key.routeKey),
      surfaceKey: text(key.surfaceKey),
      entityType: text(key.entityType),
      entityId: text(key.entityId),
      clientDraftId: text(key.clientDraftId),
    },
    baseEntityRevision:
      item.baseEntityRevision === null ? null : number(item.baseEntityRevision),
    basePayloadHash:
      item.basePayloadHash === null ? null : text(item.basePayloadHash),
    intendedCommandType: text(item.intendedCommandType) as W2CommandType,
    expectedCommandPayloadHash: text(item.expectedCommandPayloadHash),
    payload: record(item.payload),
    payloadHash: text(item.payloadHash),
    draftRevision: number(item.draftRevision),
    status: stringEnum(
      item.status,
      ["ACTIVE", "CONFLICT", "SAVED", "DISCARDED", "EXPIRED"] as const,
      "ACTIVE",
    ),
    conflictReason: text(item.conflictReason),
    expiresAt: dateTime(item.expiresAt),
    updatedAt: dateTime(item.updatedAt),
    readOnly: boolean(item.readOnly),
  };
};

const normalizeBulkItem = (value: unknown): TeacherBulkJobItem => {
  const item = record(value);
  return {
    itemKey: text(item.itemKey),
    commandType: text(item.commandType) as W2CommandType,
    commandPayload: record(item.commandPayload),
    commandPayloadHash: text(item.commandPayloadHash),
    attempt: number(item.attempt),
    childCommandId: text(item.childCommandId),
    status: stringEnum(
      item.status,
      ["PENDING", "SUCCEEDED", "FAILED"] as const,
      "PENDING",
    ),
    receiptId: text(item.receiptId),
    errorCode: text(item.errorCode),
    errorReason: text(item.errorReason),
  };
};

const normalizeBulkJob = (value: unknown): TeacherBulkJob => {
  const item = record(value);
  return {
    jobId: text(item.jobId),
    semesterId: text(item.semesterId),
    clientBulkId: text(item.clientBulkId),
    domain: stringEnum(
      item.domain,
      [
        "ASSESSMENT",
        "GRADE",
        "WIS",
        "LEARNING",
        "SCHEDULE",
        "ATTENDANCE",
        "COMMUNICATION",
      ] as const,
      "ATTENDANCE",
    ),
    operationType: text(item.operationType),
    policy: stringEnum(
      item.policy,
      ["ALL_OR_NOTHING", "ITEMIZED_PARTIAL"] as const,
      "ALL_OR_NOTHING",
    ),
    filter: record(item.filter),
    filterHash: text(item.filterHash),
    previewHash: text(item.previewHash),
    jobRevision: number(item.jobRevision),
    status: stringEnum(
      item.status,
      ["READY", "RUNNING", "PARTIAL", "SUCCEEDED", "FAILED"] as const,
      "READY",
    ),
    items: rows(item.items).map(normalizeBulkItem),
    createdAt: dateTime(item.createdAt),
    updatedAt: dateTime(item.updatedAt),
    readOnly: boolean(item.readOnly),
  };
};

export const getTeacherOperationsState = async (input: {
  config?: ConfigLike;
  semesterId?: string;
  source?: TeacherOperationsSource;
  draftId?: string;
  jobId?: string;
  includeTerminal?: boolean;
  limit?: number;
}): Promise<TeacherOperationsState> => {
  const semesterId =
    text(input.semesterId) || getCurrentSemesterId(input.config);
  if (!/^\d{4}-[12]$/u.test(semesterId)) {
    throw new TeacherOperationsError(
      "VALIDATION",
      "조회할 학기 범위가 올바르지 않습니다.",
    );
  }
  const source = input.source || "CURRENT";
  try {
    const callable = await getHttpsCallable<
      {
        semesterId: string;
        source: TeacherOperationsSource;
        draftId?: string;
        jobId?: string;
        includeTerminal?: boolean;
        limit?: number;
      },
      unknown
    >("getTeacherOperationsState");
    const response = await callable({
      semesterId,
      source,
      ...(input.draftId ? { draftId: input.draftId } : {}),
      ...(input.jobId ? { jobId: input.jobId } : {}),
      ...(typeof input.includeTerminal === "boolean"
        ? { includeTerminal: input.includeTerminal }
        : {}),
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    });
    const raw = record(response.data);
    if (
      raw.writeCount !== 0 ||
      !Array.isArray(raw.drafts) ||
      !Array.isArray(raw.bulkJobs) ||
      !Array.isArray(raw.warnings) ||
      typeof raw.readOnly !== "boolean"
    ) {
      throw new TeacherOperationsError(
        "UNKNOWN",
        "교사 업무 응답 형식이 현재 앱 계약과 일치하지 않습니다.",
        "W9_RESPONSE_INVALID",
      );
    }
    return {
      semesterId: text(raw.semesterId) || semesterId,
      manifestRevision: number(raw.manifestRevision),
      provenance: stringEnum(
        raw.provenance,
        ["CURRENT", "PREPARING", "ARCHIVE", "LEGACY", "EXPLICIT"] as const,
        "PREPARING",
      ),
      source: stringEnum(
        raw.source,
        ["CURRENT", "ARCHIVE", "LEGACY", "EXPLICIT"] as const,
        source,
      ),
      readOnly: boolean(raw.readOnly),
      status: stringEnum(
        raw.status,
        ["CONTENT", "EMPTY", "ARCHIVED", "LEGACY"] as const,
        "EMPTY",
      ),
      drafts: rows(raw.drafts).map(normalizeDraft),
      bulkJobs: rows(raw.bulkJobs).map(normalizeBulkJob),
      warnings: rows(raw.warnings).map((warning) => ({
        code: text(warning.code),
        ...(warning.draftId ? { draftId: text(warning.draftId) } : {}),
        ...(warning.jobId ? { jobId: text(warning.jobId) } : {}),
        ...(warning.limit ? { limit: number(warning.limit) } : {}),
        ...(typeof warning.draftTruncated === "boolean"
          ? { draftTruncated: boolean(warning.draftTruncated) }
          : {}),
        ...(typeof warning.jobTruncated === "boolean"
          ? { jobTruncated: boolean(warning.jobTruncated) }
          : {}),
      })),
      reason: text(raw.reason),
      writeCount: 0,
    };
  } catch (error) {
    throw mapError(error);
  }
};

export const saveTeacherDraft = async (
  payload: W2CommandPayloads["saveTeacherDraft"],
) => {
  try {
    return await executeWestoryCommand("saveTeacherDraft", payload);
  } catch (error) {
    throw mapError(error);
  }
};
export const discardTeacherDraft = async (
  payload: W2CommandPayloads["discardTeacherDraft"],
) => {
  try {
    return await executeWestoryCommand("discardTeacherDraft", payload);
  } catch (error) {
    throw mapError(error);
  }
};
export const resolveTeacherDraft = async (
  payload: W2CommandPayloads["resolveTeacherDraft"],
) => {
  try {
    return await executeWestoryCommand("resolveTeacherDraft", payload);
  } catch (error) {
    throw mapError(error);
  }
};
export const cleanupExpiredTeacherDrafts = async (
  payload: W2CommandPayloads["cleanupExpiredTeacherDrafts"],
) => {
  try {
    return await executeWestoryCommand("cleanupExpiredTeacherDrafts", payload);
  } catch (error) {
    throw mapError(error);
  }
};
export const createTeacherBulkJob = async (
  payload: W2CommandPayloads["createTeacherBulkJob"],
) => {
  try {
    return await executeWestoryCommand("createTeacherBulkJob", payload);
  } catch (error) {
    throw mapError(error);
  }
};
export const reconcileTeacherBulkJob = async (
  payload: W2CommandPayloads["reconcileTeacherBulkJob"],
) => {
  try {
    return await executeWestoryCommand("reconcileTeacherBulkJob", payload);
  } catch (error) {
    throw mapError(error);
  }
};
export const retryTeacherBulkJob = async (
  payload: W2CommandPayloads["retryTeacherBulkJob"],
) => {
  try {
    return await executeWestoryCommand("retryTeacherBulkJob", payload);
  } catch (error) {
    throw mapError(error);
  }
};

const executeBulkChild = async (item: {
  commandType?: W2CommandType;
  commandPayload?: JsonRecord;
  childCommandId: string;
}) => {
  if (!item.commandType || !item.commandPayload) {
    throw new TeacherOperationsError(
      "VALIDATION",
      "일괄 작업 항목의 명령 정보가 없습니다.",
      "W9_BULK_ITEM_INVALID",
    );
  }
  const run = executeWestoryCommand as (
    commandType: W2CommandType,
    payload: JsonRecord,
    options: { commandId: string },
  ) => Promise<CommandGatewayResponse<unknown>>;
  const response = await run(item.commandType, item.commandPayload, {
    commandId: item.childCommandId,
  });
  if (response.status !== "SUCCEEDED") {
    throw new TeacherOperationsError(
      "UNKNOWN",
      "일괄 작업 항목의 완료 receipt를 확인하지 못했습니다.",
      "W9_BULK_CHILD_NOT_SUCCEEDED",
    );
  }
  return response;
};

const executeAndReconcileBulkItems = async (input: {
  semesterId: string;
  manifestRevision: number;
  jobId: string;
  jobRevision: number;
  items: NonNullable<TeacherOperationsCommandResult["items"]>;
}) => {
  const failures: W2CommandPayloads["reconcileTeacherBulkJob"]["reportedFailures"] =
    [];
  for (const item of input.items) {
    try {
      await executeBulkChild(item);
    } catch (error) {
      const mapped = mapError(error);
      failures.push({
        itemKey: item.itemKey,
        childCommandId: item.childCommandId,
        errorCode: mapped.kind,
        errorReason: mapped.reason || mapped.message,
      });
    }
  }
  return reconcileTeacherBulkJob({
    semesterId: input.semesterId,
    expectedSemesterRevision: input.manifestRevision,
    jobId: input.jobId,
    expectedJobRevision: input.jobRevision,
    reportedFailures: failures,
  });
};

export const runTeacherBulkOperation = async (
  payload: W2CommandPayloads["createTeacherBulkJob"],
) => {
  const created = await createTeacherBulkJob(payload);
  const result = created.result;
  if (!result.jobId || !result.jobRevision || !result.items?.length) {
    throw new TeacherOperationsError(
      "UNKNOWN",
      "일괄 작업 실행 정보를 확인하지 못했습니다.",
      "W9_BULK_RESULT_INVALID",
    );
  }
  return executeAndReconcileBulkItems({
    semesterId: payload.semesterId,
    manifestRevision: payload.expectedSemesterRevision,
    jobId: result.jobId,
    jobRevision: result.jobRevision,
    items: result.items,
  });
};

export const resumePendingTeacherBulkOperation = async (input: {
  semesterId: string;
  manifestRevision: number;
  job: TeacherBulkJob;
}) => {
  const pendingItems = input.job.items.filter(
    (item) => item.status === "PENDING",
  );
  if (!pendingItems.length) {
    throw new TeacherOperationsError(
      "VALIDATION",
      "이어 실행할 대기 항목이 없습니다.",
    );
  }
  return executeAndReconcileBulkItems({
    semesterId: input.semesterId,
    manifestRevision: input.manifestRevision,
    jobId: input.job.jobId,
    jobRevision: input.job.jobRevision,
    items: pendingItems,
  });
};

export const retryFailedTeacherBulkOperation = async (input: {
  semesterId: string;
  manifestRevision: number;
  job: TeacherBulkJob;
}) => {
  const failedItems = input.job.items.filter(
    (item) => item.status === "FAILED",
  );
  if (!failedItems.length) {
    throw new TeacherOperationsError(
      "VALIDATION",
      "다시 실행할 실패 항목이 없습니다.",
    );
  }
  const retried = await retryTeacherBulkJob({
    semesterId: input.semesterId,
    expectedSemesterRevision: input.manifestRevision,
    jobId: input.job.jobId,
    expectedJobRevision: input.job.jobRevision,
    items: failedItems.map(
      ({ itemKey, commandType, commandPayload, commandPayloadHash }) => ({
        itemKey,
        commandType,
        commandPayload,
        commandPayloadHash,
      }),
    ),
  });
  if (
    !retried.result.jobId ||
    !retried.result.jobRevision ||
    !retried.result.items?.length
  ) {
    throw new TeacherOperationsError(
      "UNKNOWN",
      "재실행할 일괄 작업 정보를 확인하지 못했습니다.",
      "W9_BULK_RESULT_INVALID",
    );
  }
  return executeAndReconcileBulkItems({
    semesterId: input.semesterId,
    manifestRevision: input.manifestRevision,
    jobId: retried.result.jobId,
    jobRevision: retried.result.jobRevision,
    items: retried.result.items,
  });
};

export const createTeacherOperationClientId = () => {
  if (!globalThis.crypto?.randomUUID) {
    throw new TeacherOperationsError(
      "VALIDATION",
      "안전한 작업 ID를 만들 수 없습니다.",
      "W9_CLIENT_ID_UNAVAILABLE",
    );
  }
  return globalThis.crypto.randomUUID();
};
