import type { SystemConfig } from "../types";
import { auth } from "./firebase";
import { getHistoryDictionaryCallable } from "./historyDictionarySession";
import { runWisOperation } from "./wisEconomyClient";
import { getYearSemester } from "./semesterScope";
import {
  normalizeThinkCloudOptions,
  type ThinkCloudOptions,
  type ThinkCloudSession,
  type ThinkCloudResponse,
} from "./thinkCloud";

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;
export type CanonicalThinkCloudSession = ThinkCloudSession & {
  id: string;
  revision?: number;
  stateExists?: boolean;
  stateRevision?: number;
};
export interface ThinkCloudManagedClass {
  classId: string;
  grade: string;
  classNumber: string;
  activeSessionId: string;
  stateExists: boolean;
  stateRevision: number;
}
export interface ThinkCloudState {
  semesterId: string;
  manifestRevision: number;
  readOnly: boolean;
  thinkCloudSessions: CanonicalThinkCloudSession[];
  thinkCloudResponses: Array<
    ThinkCloudResponse & { id: string; isOwn?: boolean }
  >;
  thinkCloudRoster: Array<{ uid: string; name: string; number: string }>;
  thinkCloudManagedClasses: ThinkCloudManagedClass[];
  thinkCloudState: { activeSessionId: string; activeSessionIds: string[] };
}
const semesterId = (config: ConfigLike) => {
  const scope = getYearSemester(config);
  return `${scope.year}-${scope.semester}`;
};
const timestamp = (value: any) =>
  value && typeof value === "object"
    ? { ...value, seconds: Number(value.seconds ?? value._seconds ?? 0) }
    : value;
export const readThinkCloudState = async (
  config: ConfigLike,
  audience: "student" | "teacher",
  sessionId = "",
): Promise<ThinkCloudState> => {
  const owner = auth.currentUser;
  const callable = await getHistoryDictionaryCallable<
    Record<string, unknown>,
    ThinkCloudState
  >("getW8DomainState", { reuseSessionProof: true });
  const result = (
    await callable({
      semesterId: semesterId(config),
      domain: "LEARNING",
      audience,
      source: "CURRENT",
      ...(sessionId ? { sessionId } : {}),
    })
  ).data;
  if (!owner || auth.currentUser !== owner)
    throw new Error("로그인 계정이 바뀌었습니다.");
  return {
    ...result,
    thinkCloudSessions: (result.thinkCloudSessions || [])
      .map((session) => ({
        ...session,
        options: normalizeThinkCloudOptions(session.options),
        createdAt: timestamp(session.createdAt),
      }))
      .sort(
        (a, b) =>
          Number((b.createdAt as any)?.seconds || 0) -
          Number((a.createdAt as any)?.seconds || 0),
      ),
    thinkCloudResponses: (result.thinkCloudResponses || []).map((response) => ({
      ...response,
      createdAt: timestamp(response.createdAt),
      uid:
        audience === "student"
          ? response.isOwn
            ? owner.uid
            : ""
          : response.uid,
    })),
    thinkCloudRoster: result.thinkCloudRoster || [],
    thinkCloudManagedClasses: result.thinkCloudManagedClasses || [],
  };
};

// Guarded reads preserve anonymous responses and canonical class enrollment.
export const subscribeThinkCloudState = (
  config: ConfigLike,
  audience: "student" | "teacher",
  sessionId: string,
  onData: (state: ThinkCloudState) => void,
  onError: (error: unknown) => void,
) => {
  let stopped = false,
    running = false;
  const refresh = async () => {
    if (stopped || running || document.visibilityState === "hidden") return;
    running = true;
    try {
      const state = await readThinkCloudState(config, audience, sessionId);
      if (!stopped) onData(state);
    } catch (error) {
      if (!stopped) onError(error);
    } finally {
      running = false;
    }
  };
  void refresh();
  const timer = window.setInterval(() => void refresh(), 10000);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
};
const scope = (state: ThinkCloudState) => {
  if (
    state.readOnly ||
    !Number.isSafeInteger(state.manifestRevision) ||
    state.manifestRevision < 1
  )
    throw new Error("현재 학기의 생각모아 운영 상태를 확인해 주세요.");
  return {
    semesterId: state.semesterId,
    expectedSemesterRevision: state.manifestRevision,
  };
};
export const createThinkCloudSession = async (
  config: ConfigLike,
  input: {
    title: string;
    description: string;
    targetGrade: string;
    targetClass: string;
    targetGradeLabel: string;
    targetClassLabel: string;
    options: ThinkCloudOptions;
  },
) =>
  runWisOperation(
    ["think-cloud-create", semesterId(config), input],
    true,
    async (step) => {
      const result = await step("create", async () => {
        const state = await readThinkCloudState(config, "teacher");
        const target = state.thinkCloudManagedClasses.find(
          (item) =>
            item.grade === input.targetGrade &&
            item.classNumber === input.targetClass,
        );
        if (!target) throw new Error("운영할 수 있는 학급을 선택해 주세요.");
        return {
          commandType: "createThinkCloudSession",
          payload: {
            ...scope(state),
            expectedStateRevision: target.stateExists
              ? target.stateRevision
              : null,
            ...input,
          },
        };
      });
      return result as { sessionId: string };
    },
  );
export const transitionThinkCloudSession = async (
  config: ConfigLike,
  session: CanonicalThinkCloudSession,
  targetStatus: "active" | "paused" | "closed",
) =>
  runWisOperation(
    [
      "think-cloud-transition",
      semesterId(config),
      session.id,
      session.revision,
      targetStatus,
    ],
    true,
    async (step) =>
      step("transition", async () => {
        const state = await readThinkCloudState(config, "teacher", session.id);
        return {
          commandType: "transitionThinkCloudSession",
          payload: {
            ...scope(state),
            sessionId: session.id,
            expectedSessionRevision: Number(session.revision || 0),
            expectedStateRevision: session.stateExists
              ? Number(session.stateRevision || 0)
              : null,
            targetStatus,
          },
        };
      }),
  );
export const deleteThinkCloudSession = async (
  config: ConfigLike,
  session: CanonicalThinkCloudSession,
) =>
  runWisOperation(
    ["think-cloud-delete", semesterId(config), session.id, session.revision],
    true,
    async (step) =>
      step("delete", async () => {
        const state = await readThinkCloudState(config, "teacher", session.id);
        return {
          commandType: "deleteThinkCloudSession",
          payload: {
            ...scope(state),
            sessionId: session.id,
            expectedSessionRevision: Number(session.revision || 0),
            expectedStateRevision: session.stateExists
              ? Number(session.stateRevision || 0)
              : null,
            reason: "교사 생각모아 주제 삭제",
          },
        };
      }),
  );
export const submitThinkCloudResponse = async (
  config: ConfigLike,
  session: CanonicalThinkCloudSession,
  textRaw: string,
  textNormalized: string,
) =>
  runWisOperation(
    [
      "think-cloud-submit",
      semesterId(config),
      session.id,
      session.revision,
      textRaw,
      textNormalized,
    ],
    false,
    async (step) => {
      const result = await step("submit", async () => {
        const state = await readThinkCloudState(config, "student", session.id);
        return {
          commandType: "submitThinkCloudResponse",
          payload: {
            ...scope(state),
            sessionId: session.id,
            expectedSessionRevision: Number(session.revision || 0),
            textRaw,
            textNormalized,
          },
        };
      });
      return result as { responseId: string };
    },
  );
