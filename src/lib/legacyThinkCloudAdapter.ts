import type { SystemConfig } from "../types";
import type { W2CommandPayloads } from "./commandGateway";
import {
  createStableLegacyMutationActionKey,
  forgetLegacyWisMutationIntent,
  getLegacyWisMutationIntent,
  getOrCreateLegacyWisMutationIntent,
  shouldForgetLegacyWisIntentAfterError,
} from "./legacyWisMutationIntent";
import type { ThinkCloudOptions } from "./thinkCloud";
import {
  createThinkCloudSession,
  deleteThinkCloudSession,
  getCurrentSemesterId,
  getW8DomainState,
  submitThinkCloudResponse,
  transitionThinkCloudSession,
  W8DomainError,
} from "./w8Domains";

type ConfigLike = SystemConfig | null | undefined;
type ThinkCloudCommandType =
  | "createThinkCloudSession"
  | "transitionThinkCloudSession"
  | "deleteThinkCloudSession"
  | "submitThinkCloudResponse";

const intentKey = (commandType: ThinkCloudCommandType, actionKey: string) =>
  `think-cloud:${commandType}:${String(actionKey || "").trim()}`;

export const createLegacyThinkCloudActionKey = (action: unknown) =>
  createStableLegacyMutationActionKey("think-cloud", action);

const runIntent = async <
  CommandType extends ThinkCloudCommandType,
  Result,
>(input: {
  commandType: CommandType;
  actionKey: string;
  createPayload: () => Promise<W2CommandPayloads[CommandType]>;
  execute: (
    payload: W2CommandPayloads[CommandType],
    options: { commandId: string },
  ) => Promise<Result>;
}) => {
  const key = intentKey(input.commandType, input.actionKey);
  let intent = getLegacyWisMutationIntent<W2CommandPayloads[CommandType]>(key);
  if (!intent) {
    const payload = await input.createPayload();
    intent = getOrCreateLegacyWisMutationIntent(key, () => payload);
  }
  try {
    const result = await input.execute(intent.payload, {
      commandId: intent.commandId,
    });
    forgetLegacyWisMutationIntent(key);
    return result;
  } catch (error) {
    if (shouldForgetLegacyWisIntentAfterError(error)) {
      forgetLegacyWisMutationIntent(key);
    }
    throw error;
  }
};

export const getLegacyThinkCloudState = (
  config: ConfigLike,
  audience: "student" | "teacher",
  sessionId = "",
) =>
  getW8DomainState({
    config,
    domain: "LEARNING",
    audience,
    source: "CURRENT",
    ...(sessionId ? { sessionId } : {}),
  });

const getCommandScope = async (
  config: ConfigLike,
  audience: "student" | "teacher",
) => {
  const state = await getLegacyThinkCloudState(config, audience);
  if (
    !Number.isSafeInteger(state.manifestRevision) ||
    state.manifestRevision < 1
  ) {
    throw new W8DomainError(
      "VALIDATION",
      "현재 학기의 학습 운영 준비 상태를 확인해 주세요.",
    );
  }
  return {
    semesterId: getCurrentSemesterId(config),
    expectedSemesterRevision: state.manifestRevision,
  };
};

export const createLegacyThinkCloudSession = async (input: {
  actionKey: string;
  config: ConfigLike;
  expectedStateRevision: number | null;
  title: string;
  description: string;
  targetGrade: string;
  targetClass: string;
  targetGradeLabel: string;
  targetClassLabel: string;
  options: ThinkCloudOptions;
}) =>
  runIntent({
    commandType: "createThinkCloudSession",
    actionKey: input.actionKey,
    createPayload: async () => ({
      ...(await getCommandScope(input.config, "teacher")),
      expectedStateRevision: input.expectedStateRevision,
      title: input.title,
      description: input.description,
      targetGrade: input.targetGrade,
      targetClass: input.targetClass,
      targetGradeLabel: input.targetGradeLabel,
      targetClassLabel: input.targetClassLabel,
      options: input.options,
    }),
    execute: createThinkCloudSession,
  });

export const transitionLegacyThinkCloudSession = async (input: {
  actionKey: string;
  config: ConfigLike;
  sessionId: string;
  expectedSessionRevision: number;
  expectedStateRevision: number | null;
  targetStatus: "active" | "paused" | "closed";
}) =>
  runIntent({
    commandType: "transitionThinkCloudSession",
    actionKey: input.actionKey,
    createPayload: async () => ({
      ...(await getCommandScope(input.config, "teacher")),
      sessionId: input.sessionId,
      expectedSessionRevision: input.expectedSessionRevision,
      expectedStateRevision: input.expectedStateRevision,
      targetStatus: input.targetStatus,
    }),
    execute: transitionThinkCloudSession,
  });

export const deleteLegacyThinkCloudSession = async (input: {
  actionKey: string;
  config: ConfigLike;
  sessionId: string;
  expectedSessionRevision: number;
  expectedStateRevision: number | null;
}) =>
  runIntent({
    commandType: "deleteThinkCloudSession",
    actionKey: input.actionKey,
    createPayload: async () => ({
      ...(await getCommandScope(input.config, "teacher")),
      sessionId: input.sessionId,
      expectedSessionRevision: input.expectedSessionRevision,
      expectedStateRevision: input.expectedStateRevision,
      reason: "교사가 기존 생각모아 화면에서 주제를 삭제했습니다.",
    }),
    execute: deleteThinkCloudSession,
  });

export const submitLegacyThinkCloudResponse = async (input: {
  actionKey: string;
  config: ConfigLike;
  sessionId: string;
  expectedSessionRevision: number;
  textRaw: string;
  textNormalized: string;
}) =>
  runIntent({
    commandType: "submitThinkCloudResponse",
    actionKey: input.actionKey,
    createPayload: async () => ({
      ...(await getCommandScope(input.config, "student")),
      sessionId: input.sessionId,
      expectedSessionRevision: input.expectedSessionRevision,
      textRaw: input.textRaw,
      textNormalized: input.textNormalized,
    }),
    execute: submitThinkCloudResponse,
  });
