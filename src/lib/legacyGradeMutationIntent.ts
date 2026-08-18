import { createStableLegacyMutationActionKey } from "./legacyWisMutationIntent";

export type LegacyGradeMutationCommandType =
  | "upsertLegacyGradeRoster"
  | "deleteLegacyGradeRoster"
  | "saveLegacyGradeConfig"
  | "acknowledgeLegacyGradeWarning"
  | "submitLegacyGradeRequest"
  | "reviewLegacyGradeRequest"
  | "signLegacyGradeRecords"
  | "rejectLegacyGradeSignatures";

const withoutCasFields = (
  value: unknown,
  commandType: LegacyGradeMutationCommandType,
  rootPayload: Record<string, unknown>,
  isRoot = false,
): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      withoutCasFields(entry, commandType, rootPayload),
    );
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/^expected[A-Z]/u.test(key))
      .filter(([key]) => {
        if (!isRoot) return true;
        if (
          commandType === "upsertLegacyGradeRoster" &&
          rootPayload.mode === "CREATE" &&
          key === "rosterId"
        ) {
          return false;
        }
        if (
          commandType === "saveLegacyGradeConfig" &&
          rootPayload.configKind === "GRADING_PLAN" &&
          Number(rootPayload.expectedRevision || 0) === 0 &&
          key === "configId"
        ) {
          return false;
        }
        return true;
      })
      .map(([key, entry]) => [
        key,
        withoutCasFields(entry, commandType, rootPayload),
      ]),
  );
};

/**
 * Identifies the user's logical grade action independently from CAS revisions.
 * The first full payload is persisted separately and is replayed unchanged.
 */
export const createLegacyGradeMutationActionKey = (
  commandType: LegacyGradeMutationCommandType,
  payload: Record<string, unknown>,
) =>
  createStableLegacyMutationActionKey(
    `grade:${commandType}`,
    withoutCasFields(payload, commandType, payload, true),
  );
