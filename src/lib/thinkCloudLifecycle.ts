import { doc, onSnapshot } from "firebase/firestore";
import type { SystemConfig } from "../types";
import { auth, db } from "./firebase";
import { getHistoryDictionaryCallable } from "./historyDictionarySession";
import { runWisOperation } from "./wisEconomyClient";
import { getSemesterDocPath, getYearSemester } from "./semesterScope";
import {
  normalizeThinkCloudOptions,
  type ThinkCloudOptions,
  type ThinkCloudSession,
  type ThinkCloudResponse,
} from "./thinkCloud";

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;
export type CanonicalThinkCloudSession = ThinkCloudSession & {
  id: string;
  targetClassId?: string;
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
  responseRevision: number;
  responseSessionId: string;
}
export interface ThinkCloudState {
  semesterId: string;
  manifestRevision: number;
  readOnly: boolean;
  thinkCloudSessions: CanonicalThinkCloudSession[];
  thinkCloudResponses: Array<
    ThinkCloudResponse & { id: string; isOwn?: boolean; sequence?: number }
  >;
  thinkCloudRoster: Array<{ uid: string; name: string; number: string }>;
  thinkCloudManagedClasses: ThinkCloudManagedClass[];
  thinkCloudSelectedSessionId?: string;
  thinkCloudState: {
    activeSessionId: string;
    activeSessionIds: string[];
    responseRevision?: number;
    responseSessionId?: string;
  };
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
  metadataOnly = false,
  afterResponseSequence?: number,
): Promise<ThinkCloudState> => {
  const owner = auth.currentUser;
  const callable = await getHistoryDictionaryCallable<
    Record<string, unknown>,
    ThinkCloudState
  >("getThinkCloudStateFast", { reuseSessionProof: true });
  const result = (
    await callable({
      semesterId: semesterId(config),
      domain: "LEARNING",
      audience,
      source: "CURRENT",
      projection: metadataOnly
        ? "think-cloud-command"
        : afterResponseSequence === undefined
          ? "think-cloud"
          : "think-cloud-delta",
      ...(sessionId ? { sessionId } : {}),
      ...(afterResponseSequence === undefined ? {} : { afterResponseSequence }),
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

// Listen only to small class signals. Every payload still goes through the
// callable's live session, enrollment and anonymous-response authorization.
export const subscribeThinkCloudState = (
  config: ConfigLike,
  audience: "student" | "teacher",
  sessionId: string,
  onData: (state: ThinkCloudState) => void,
  onError: (error: unknown) => void,
) => {
  const owner = auth.currentUser;
  const configScope = getYearSemester(config);
  const scopeId = semesterId(configScope);
  let stopped = false,
    running = false,
    runningFull = false;
  let selectedSessionId = sessionId,
    generation = 0;
  let fullPending = true;
  let current: ThinkCloudState | undefined;
  let timer: number | undefined;
  type Signal = {
    exists: boolean;
    revision: number;
    responseRevision: number;
    responseSessionId: string;
  };
  const signals = new Map<string, Signal>();
  const subscriptions = new Map<string, { stop: () => void; token: object }>();
  const visible = () => document.visibilityState !== "hidden";
  const sameOwner = () =>
    owner !== null &&
    auth.currentUser === owner &&
    semesterId(config) === scopeId;
  const clearTimer = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };
  const disconnect = () => {
    subscriptions.forEach(({ stop }) => stop());
    subscriptions.clear();
    signals.clear();
    clearTimer();
  };
  const unsubscribe = () => {
    stopped = true;
    generation += 1;
    disconnect();
    window.removeEventListener("focus", focus);
    document.removeEventListener("visibilitychange", visibility);
  };
  const fail = (error: unknown) => {
    if (stopped) return;
    unsubscribe();
    onError(error);
  };
  const selectedClass = () => {
    const session = current?.thinkCloudSessions.find(
      (item) => item.id === selectedSessionId,
    );
    return current?.thinkCloudManagedClasses.find((item) =>
      session?.targetClassId
        ? item.classId === session.targetClassId
        : session &&
          String(item.grade) === String(session.targetGrade) &&
          String(item.classNumber) === String(session.targetClass),
    );
  };
  const statusChanged = () =>
    current?.thinkCloudManagedClasses.some((item) => {
      const signal = signals.get(item.classId);
      return (
        signal &&
        (signal.revision > item.stateRevision ||
          signal.exists !== item.stateExists)
      );
    }) === true;
  const needed = (): "full" | "delta" | undefined => {
    if (fullPending || !current || statusChanged()) return "full";
    const selected = selectedClass();
    const signal = selected && signals.get(selected.classId);
    if (
      signal &&
      signal.responseSessionId === selectedSessionId &&
      signal.responseRevision > (selected?.responseRevision || 0)
    )
      return "delta";
  };
  const schedule = () => {
    if (!stopped && visible() && !running && timer === undefined && needed())
      timer = window.setTimeout(() => void refresh(), 180);
  };
  const connect = () => {
    if (stopped || !visible() || !current) return;
    const classIds = new Set(
      current.thinkCloudManagedClasses.map((item) => item.classId),
    );
    for (const [id, subscription] of subscriptions) {
      if (!classIds.has(id)) {
        subscription.stop();
        subscriptions.delete(id);
        signals.delete(id);
      }
    }
    for (const classId of classIds) {
      if (stopped) return;
      if (subscriptions.has(classId)) continue;
      if (!classId || classId.includes("/")) {
        fail(
          new Error("생각모아 학급을 확인하지 못했습니다. 다시 불러와 주세요."),
        );
        return;
      }
      const token = {};
      // Register before attaching so even a synchronous terminal callback is safe.
      subscriptions.set(classId, { token, stop: () => {} });
      const listening = () =>
        !stopped && visible() && subscriptions.get(classId)?.token === token;
      const stop = onSnapshot(
        doc(db, getSemesterDocPath(configScope, "think_cloud_state", classId)),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (
            !listening() ||
            snapshot.metadata.fromCache ||
            snapshot.metadata.hasPendingWrites
          )
            return;
          if (!sameOwner()) {
            fail(new Error("로그인 계정이나 학기가 바뀌었습니다."));
            return;
          }
          const data = snapshot.data();
          const signal = {
            exists: snapshot.exists(),
            revision: data?.revision ?? 0,
            responseRevision: data?.responseRevision ?? 0,
            responseSessionId:
              typeof data?.responseSessionId === "string"
                ? data.responseSessionId
                : "",
          };
          if (
            ![signal.revision, signal.responseRevision].every(
              (value) => Number.isSafeInteger(value) && value >= 0,
            )
          ) {
            fail(
              new Error(
                "생각모아 변경 정보를 확인하지 못했습니다. 다시 불러와 주세요.",
              ),
            );
            return;
          }
          signals.set(classId, signal);
          schedule();
        },
        (error) => {
          if (listening()) fail(error);
        },
      );
      if (listening()) subscriptions.set(classId, { token, stop });
      else stop();
    }
  };
  const refresh = async () => {
    clearTimer();
    if (stopped || running || !visible()) return;
    if (!sameOwner()) {
      fail(new Error("로그인 계정이나 학기가 바뀌었습니다."));
      return;
    }
    const mode = needed();
    if (!mode) return;
    running = true;
    runningFull = mode === "full";
    fullPending = false;
    const requestedSessionId = selectedSessionId;
    const requestGeneration = generation;
    const accepted = () =>
      !stopped &&
      visible() &&
      sameOwner() &&
      requestGeneration === generation &&
      requestedSessionId === selectedSessionId;
    try {
      const state = await readThinkCloudState(
        configScope,
        audience,
        requestedSessionId,
        false,
        mode === "delta" ? selectedClass()?.responseRevision || 0 : undefined,
      );
      if (!accepted()) return;
      if (state.semesterId !== scopeId)
        throw new Error("생각모아 학기가 바뀌었습니다. 다시 불러와 주세요.");
      if (mode === "delta" && current) {
        const before = selectedClass();
        const after = state.thinkCloudManagedClasses.find(
          (item) => item.classId === before?.classId,
        );
        // A delta can observe a topic transition that raced its request. Do not
        // acknowledge that class revision until the complete topic list is read.
        if (
          state.thinkCloudSelectedSessionId !== requestedSessionId ||
          !before ||
          !after ||
          before.stateExists !== after.stateExists ||
          before.stateRevision !== after.stateRevision ||
          before.activeSessionId !== after.activeSessionId ||
          after.responseRevision < (before.responseRevision || 0)
        ) {
          fullPending = true;
          return;
        }
        const responses = new Map(
          current.thinkCloudResponses.map((item) => [item.id, item]),
        );
        state.thinkCloudResponses.forEach((item) =>
          responses.set(item.id, item),
        );
        const managed = current.thinkCloudManagedClasses.map(
          (item) =>
            state.thinkCloudManagedClasses.find(
              (next) => next.classId === item.classId,
            ) || item,
        );
        current = {
          ...current,
          ...state,
          thinkCloudSessions: current.thinkCloudSessions.map(
            (item) =>
              state.thinkCloudSessions.find((next) => next.id === item.id) ||
              item,
          ),
          thinkCloudResponses: [...responses.values()],
          thinkCloudRoster: current.thinkCloudRoster,
          thinkCloudManagedClasses: managed,
          thinkCloudState: {
            ...state.thinkCloudState,
            activeSessionIds: managed
              .map((item) => item.activeSessionId)
              .filter(Boolean),
          },
        };
      } else current = state;
      selectedSessionId =
        current.thinkCloudSelectedSessionId ?? requestedSessionId;
      onData(current);
      connect();
    } catch (error) {
      if (
        !stopped &&
        sameOwner() &&
        requestGeneration === generation &&
        requestedSessionId === selectedSessionId
      ) {
        const reason = (error as { details?: { reason?: string } })?.details
          ?.reason;
        if (
          requestedSessionId &&
          reason === "W8_THINK_CLOUD_TARGET_FORBIDDEN" &&
          statusChanged()
        ) {
          // A deletion signal may invalidate either kind of selected read. A
          // single unselected full read reauthorizes and picks a remaining topic.
          selectedSessionId = "";
          generation += 1;
          fullPending = true;
        } else if (mode === "delta" && statusChanged()) {
          fullPending = true;
        } else if (
          mode === "delta" &&
          reason === "W8_THINK_CLOUD_RESPONSE_CURSOR_INVALID"
        )
          fullPending = true;
        else fail(error);
      }
    } finally {
      running = false;
      runningFull = false;
      if (!stopped && !sameOwner())
        fail(new Error("로그인 계정이나 학기가 바뀌었습니다."));
      schedule();
    }
  };
  const focus = () => {
    if (stopped || !visible() || (running && runningFull)) return;
    fullPending = true;
    schedule();
  };
  const visibility = () => {
    if (!visible()) {
      generation += 1;
      fullPending = true;
      disconnect();
    } else {
      fullPending = true;
      connect();
      schedule();
    }
  };
  window.addEventListener("focus", focus);
  document.addEventListener("visibilitychange", visibility);
  void refresh();
  return Object.assign(unsubscribe, {
    selectSession: (nextSessionId: string) => {
      if (stopped || selectedSessionId === nextSessionId) return;
      selectedSessionId = nextSessionId;
      generation += 1;
      fullPending = true;
      void refresh();
    },
  });
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
        const state = await readThinkCloudState(config, "teacher", "", true);
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
        const state = await readThinkCloudState(
          config,
          "teacher",
          session.id,
          true,
        );
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
        const state = await readThinkCloudState(
          config,
          "teacher",
          session.id,
          true,
        );
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
        const state = await readThinkCloudState(
          config,
          "student",
          session.id,
          true,
        );
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
