import { auth } from "./firebase";
import { getHistoryDictionaryCallable } from "./historyDictionarySession";
import { getYearSemester } from "./semesterScope";
import type { SystemConfig } from "../types";

type Config = Pick<SystemConfig, "year" | "semester"> | null | undefined;
type Envelope<T> = {
  status: "SUCCEEDED";
  commandId: string;
  commandType: string;
  replayed: boolean;
  result: T;
};
type Pending = { commandId: string; payload: Record<string, unknown> };
const pending = new Map<string, Pending>();
const flights = new Map<string, Promise<Envelope<unknown>>>();
const ambiguous = (error: unknown) =>
  [
    "functions/cancelled",
    "functions/deadline-exceeded",
    "functions/internal",
    "functions/unknown",
    "functions/unavailable",
  ].includes(String((error as { code?: string })?.code || ""));

// A lost response keeps both the command ID and the exact payload. A retry
// never invents a new reward interaction or silently advances a revision.
export const executeLearningCommand = <T>(
  commandType: string,
  payload: Record<string, unknown>,
  endpoint = "executeCommand",
  logicalSource = JSON.stringify(payload),
): Promise<Envelope<T>> => {
  const owner = auth.currentUser;
  if (!owner) return Promise.reject(new Error("로그인 후 다시 시도해 주세요."));
  const key = JSON.stringify([owner.uid, endpoint, commandType, logicalSource]);
  const existing = flights.get(key);
  if (existing) return existing as Promise<Envelope<T>>;
  const flight = (async () => {
    const epoch = Number((await owner.getIdTokenResult()).claims.auth_time);
    const assertOwner = async () => {
      if (
        auth.currentUser !== owner ||
        !Number.isFinite(epoch) ||
        Number((await owner.getIdTokenResult()).claims.auth_time) !== epoch
      )
        throw new Error("로그인 상태가 바뀌었습니다. 화면을 다시 열어 주세요.");
    };
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(key),
    );
    const storageKey =
      "westory:learning-command:" +
      Array.from(new Uint8Array(digest), (v) =>
        v.toString(16).padStart(2, "0"),
      ).join("");
    let operation = pending.get(key);
    if (!operation) {
      try {
        const stored = JSON.parse(
          sessionStorage.getItem(storageKey) || "null",
        ) as Pending | null;
        if (stored?.commandId && stored.payload) operation = stored;
      } catch {
        /* Memory still protects an explicit retry in this page. */
      }
    }
    operation ||= {
      commandId: crypto.randomUUID(),
      payload: JSON.parse(JSON.stringify(payload)),
    };
    pending.set(key, operation);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(operation));
    } catch {
      /* optional persistence */
    }
    const forget = () => {
      pending.delete(key);
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* optional persistence */
      }
    };
    await assertOwner();
    const call = await getHistoryDictionaryCallable<
      Record<string, unknown>,
      Envelope<T>
    >(endpoint);
    try {
      await assertOwner();
      const response = (await call({ commandType, ...operation })).data;
      await assertOwner();
      if (
        response.status !== "SUCCEEDED" ||
        response.commandId !== operation.commandId ||
        response.commandType !== commandType
      )
        throw Object.assign(
          new Error("저장 결과를 확인하지 못했습니다. 다시 시도해 주세요."),
          { code: "functions/unknown" },
        );
      forget();
      return response;
    } catch (error) {
      if (auth.currentUser !== owner) throw error;
      if (!ambiguous(error)) forget();
      // Core-point commands have a separate receipt store; an explicit retry
      // against their endpoint is the recovery operation.
      else if (endpoint === "executeCommand") {
        try {
          await assertOwner();
          const statusCall = await getHistoryDictionaryCallable<
            Record<string, unknown>,
            { status: string; result: T }
          >("getCommandStatus");
          const status = (
            await statusCall({ commandId: operation.commandId, commandType })
          ).data;
          await assertOwner();
          if (status.status === "SUCCEEDED" && status.result) {
            forget();
            return {
              status: "SUCCEEDED" as const,
              commandId: operation.commandId,
              commandType,
              replayed: true,
              result: status.result,
            };
          }
        } catch {
          /* Retain the original request for an explicit retry. */
        }
      }
      throw error;
    }
  })();
  flights.set(key, flight);
  void flight
    .finally(() => {
      if (flights.get(key) === flight) flights.delete(key);
    })
    .catch(() => {});
  return flight;
};

export interface LearningReward {
  awarded: boolean;
  duplicate: boolean;
  amount: number;
  totalAwarded: number;
  blockedMessage?: string;
  settled?: boolean;
}
export const recordLessonCorePointFind = (
  config: Config,
  unitId: string,
  corePointId: string,
) =>
  executeLearningCommand(
    "recordLessonCorePointFind",
    { ...getYearSemester(config), unitId, corePointId },
    "executeLessonCorePointCommand",
  );
export const claimLessonCorePointReward = async (config: Config) =>
  (
    await executeLearningCommand<LearningReward>(
      "claimLessonCorePointReward",
      { ...getYearSemester(config) },
      "executeLessonCorePointCommand",
    )
  ).result;
export const claimMapTagReward = async (
  config: Config,
  mapId: string,
  tag: string,
) => {
  const scope = getYearSemester(config),
    semesterId = `${scope.year}-${scope.semester}`;
  const response = await executeLearningCommand<LearningReward>(
    "claimMapTagReward",
    { semesterId, mapId, tag: tag.trim(), interactionId: crypto.randomUUID() },
    "executeCommand",
    JSON.stringify([semesterId, mapId, tag.trim()]),
  );
  return response.replayed && response.result.awarded
    ? {
        ...response.result,
        awarded: false,
        duplicate: true,
        amount: 0,
        totalAwarded: 0,
      }
    : response.result;
};
export type LessonAnswersResult = {
  answers: Record<string, { value: string; status: "correct" | "wrong" }>;
  answerRevision: number;
  contentRevision: number;
  correctCount: number;
  totalCount: number;
};
export const saveLessonAnswers = async (
  config: Config,
  data: {
    unitId: string;
    expectedSemesterRevision: number;
    expectedContentRevision: number;
    expectedAnswerRevision: number;
    answers: Record<string, string>;
  },
) => {
  const scope = getYearSemester(config);
  return (
    await executeLearningCommand<LessonAnswersResult>("saveLessonAnswers", {
      semesterId: `${scope.year}-${scope.semester}`,
      ...data,
    })
  ).result;
};
