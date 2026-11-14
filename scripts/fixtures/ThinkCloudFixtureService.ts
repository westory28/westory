// Synthetic transport for the real page components and thinkCloudLifecycle.
// No Firebase, school account, real response or external request is used.
import { MENUS } from "../../src/constants/menus";
import { useEffect, useState } from "react";
const params = new URLSearchParams(location.search);
const teacher = params.get("role") !== "student";
const readOnly = params.get("readonly") === "1";
export const config = { year: "2026", semester: "2" };
export const auth = {
  currentUser: {
    uid: teacher ? "qa-teacher" : "qa-student",
    email: "qa@example.invalid",
  },
};
export const useAuth = () => {
  const [, render] = useState(0);
  useEffect(() => {
    const changed = () => render((value) => value + 1);
    window.addEventListener("think-qa-scope", changed);
    return () => window.removeEventListener("think-qa-scope", changed);
  }, []);
  return {
    config,
    currentUser: auth.currentUser,
    userData: {
      uid: auth.currentUser.uid,
      role: teacher ? (readOnly ? "staff" : "teacher") : "student",
      name: teacher ? "검증 교사" : "검증 학생",
      grade: "3",
      class: "1",
      number: "1",
      teacherPortalEnabled: readOnly,
      staffPermissions: readOnly ? ["lesson_read"] : [],
    },
    menuConfig: MENUS,
    interfaceConfig: {},
  };
};
const options = {
  allowDuplicateWord: true,
  allowDuplicateByStudent: params.get("once") !== "1",
  inputMode: "word",
  anonymous: true,
  maxLength: 20,
  profanityFilter: true,
};
const topic = (id: string, title: string, status: string, time: number) => ({
  id,
  title,
  description: "조선의 변화를 떠올리며 생각을 나누어 보세요.",
  targetGrade: "3",
  targetClass: "1",
  status,
  options: { ...options },
  createdAt: { seconds: time },
  createdBy: "qa-teacher",
  createdByName: "검증 교사",
  revision: 1,
  stateExists: true,
  stateRevision: 1,
});
const sessions = params.get("empty")
  ? []
  : [
      topic("active", "조선 하면 떠오르는 한 단어는?", "active", 3),
      topic("paused", "좋은 리더의 조건은 무엇일까요?", "paused", 2),
      topic("closed", "지난 시간에 기억에 남은 장면", "closed", 1),
    ];
const words = [
  "한글",
  "세종",
  "훈민정음",
  "백성",
  "경복궁",
  "과학",
  "조선",
  "장영실",
  "문화",
  "역사",
  "집현전",
  "측우기",
  "해시계",
  "새로운 생각",
  "배움",
];
const responses: Record<string, any[]> = { active: [], paused: [], closed: [] };
const classState = {
  revision: 1,
  activeSessionId: sessions[0]?.id || "",
  responseRevision: 0,
  responseSessionId: "active",
};
const listeners = new Set<(snapshot: any) => void>();
const signal = () => {
  const snapshot = {
    exists: () => true,
    data: () => ({ ...classState }),
    metadata: { fromCache: false, hasPendingWrites: false },
  };
  listeners.forEach((receive) => receive(snapshot));
};
words.forEach((text, index) => {
  const count = index === 0 ? 9 : index === 1 ? 5 : index < 5 ? 3 : 1;
  for (let n = 0; n < count; n++)
    responses.active.push({
      id: `r-${index}-${n}`,
      uid: `peer-${index}-${n}`,
      displayName: `비공개 이름 ${index}-${n}`,
      textRaw: text,
      textNormalized: text,
      createdAt: { seconds: 1 },
      sequence: ++classState.responseRevision,
    });
});
responses.paused.push({
  id: "pause-1",
  uid: "peer-1",
  displayName: "비공개 이름",
  textRaw: "경청",
  textNormalized: "경청",
});
responses.closed.push({
  id: "closed-1",
  uid: "peer-2",
  displayName: "비공개 이름",
  textRaw: "임진왜란",
  textNormalized: "임진왜란",
});
const qa = ((window as any).thinkQa = {
  calls: [] as any[],
  writes: [] as any[],
  rewards: 0,
  schoolReads: 0,
  toasts: [] as any[],
  sessions,
  responses,
  classState,
  listeners,
  signal,
  switchScope() {
    config.semester = config.semester === "2" ? "1" : "2";
    window.dispatchEvent(new Event("think-qa-scope"));
  },
  failRead: params.get("error") === "1",
  failWrite: false,
  delayWrite: 0,
  delayRead: 0,
  animations: [] as any[],
  add(text: string, count = 1) {
    for (let n = 0; n < count; n++)
      responses.active.push({
        id: `new-${responses.active.length}`,
        uid: "peer-new",
        displayName: "비공개 이름 새학생",
        textRaw: text,
        textNormalized: text,
        sequence: ++classState.responseRevision,
      });
    classState.responseSessionId = "active";
    signal();
  },
});
const nativeAnimate = Element.prototype.animate;
Element.prototype.animate = function (frames: any, settings: any) {
  qa.animations.push({
    text: this.textContent?.slice(0, 100),
    frames,
    settings,
    className: this.className,
    at: performance.now(),
  });
  return nativeAnimate.call(this, frames, settings);
};
export const useAppToast = () => ({
  showToast: (value: any) => qa.toasts.push(value),
});
export const db = {};
export const doc = (_db: any, ...parts: string[]) => ({
  path: parts.join("/"),
});
export const onSnapshot = (
  _ref: any,
  _options: any,
  receive: any,
  _error: any,
) => {
  const next = typeof _options === "function" ? _options : receive;
  listeners.add(next);
  queueMicrotask(() => {
    if (listeners.has(next)) signal();
  });
  return () => listeners.delete(next);
};
export const getDoc = async (ref: any) => {
  qa.schoolReads++;
  return {
    exists: () => ref.path === "site_settings/school_config",
    data: () => ({
      grades: [{ value: "3", label: "3학년" }],
      classes: [{ value: "1", label: "1반" }],
    }),
  };
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const getHistoryDictionaryCallable =
  async (name: string) => async (payload: any) => {
    qa.calls.push({
      name,
      payload: structuredClone(payload),
      at: performance.now(),
    });
    if (qa.delayRead) await pause(qa.delayRead);
    if (qa.failRead) throw new Error("주제를 불러오지 못했습니다.");
    const selected =
      sessions.find((item) => item.id === payload.sessionId) ||
      sessions.find((item) => item.status === "active") ||
      sessions[0];
    const delta = payload.projection === "think-cloud-delta";
    const rows = (selected ? responses[selected.id] || [] : []).filter(
      (row) => !delta || (row.sequence || 0) > payload.afterResponseSequence,
    );
    const active = sessions.find((item) => item.status === "active")?.id || "";
    const metadata = payload.projection === "think-cloud-command";
    return {
      data: {
        semesterId: `${config.year}-${config.semester}`,
        manifestRevision: 1,
        readOnly,
        thinkCloudSessions: structuredClone(delta ? [selected] : sessions),
        thinkCloudSelectedSessionId: selected?.id || "",
        thinkCloudResponses: metadata
          ? []
          : rows.map((row) =>
              teacher
                ? { ...row }
                : {
                    id: row.id,
                    textRaw: row.textRaw,
                    textNormalized: row.textNormalized,
                    isOwn: row.uid === auth.currentUser.uid,
                    sequence: row.sequence || 0,
                    ...(selected?.options.anonymous
                      ? {}
                      : { displayName: row.displayName }),
                  },
            ),
        thinkCloudRoster:
          metadata || delta
            ? []
            : [
                { uid: "qa-student", name: "검증 학생", number: "1" },
                {
                  uid: "pending-student",
                  name: "발표에서 숨길 이름",
                  number: "2",
                },
              ],
        thinkCloudManagedClasses: [
          {
            classId: "qa-class",
            grade: "3",
            classNumber: "1",
            activeSessionId: active,
            stateExists: true,
            stateRevision: classState.revision,
            responseRevision: classState.responseRevision,
            responseSessionId: classState.responseSessionId,
          },
        ],
        thinkCloudState: {
          activeSessionId: active,
          activeSessionIds: active ? [active] : [],
          responseRevision: classState.responseRevision,
          responseSessionId: classState.responseSessionId,
        },
      },
    };
  };
export const runWisOperation = async (_key: any, _sensitive: any, run: any) =>
  run(async (_step: any, build: any) => {
    const { commandType, payload } = await build();
    qa.writes.push({ commandType, payload: structuredClone(payload) });
    if (qa.delayWrite) await pause(qa.delayWrite);
    if (qa.failWrite) throw new Error("합성 저장 실패");
    if (commandType === "submitThinkCloudResponse") {
      const session = sessions.find((item) => item.id === payload.sessionId)!;
      if (session.status !== "active") throw new Error("주제가 닫혔습니다.");
      const responseId = `own-${qa.writes.length}`;
      (responses[payload.sessionId] ||= []).push({
        id: responseId,
        uid: auth.currentUser.uid,
        displayName: "검증 학생",
        textRaw: payload.textRaw,
        textNormalized: payload.textNormalized,
        sequence: ++classState.responseRevision,
      });
      classState.responseSessionId = payload.sessionId;
      signal();
      return { responseId };
    }
    if (commandType === "createThinkCloudSession") {
      const id = `created-${qa.writes.length}`;
      sessions.forEach((session) => {
        if (session.status === "active") session.status = "closed";
      });
      sessions.unshift({
        ...topic(id, payload.title, "active", 10),
        ...payload,
        id,
      });
      responses[id] = [];
      classState.revision++;
      classState.activeSessionId = id;
      signal();
      return { sessionId: id };
    }
    const session = sessions.find((item) => item.id === payload.sessionId);
    if (commandType === "transitionThinkCloudSession" && session) {
      session.status = payload.targetStatus;
      session.revision++;
    }
    if (commandType === "deleteThinkCloudSession" && session)
      sessions.splice(sessions.indexOf(session), 1);
    classState.revision++;
    classState.activeSessionId =
      sessions.find((item) => item.status === "active")?.id || "";
    signal();
    return {};
  });
export const buildThinkCloudRewardSourceId = (...args: any[]) => args.join(":");
export const claimPointActivityReward = async () => {
  qa.rewards++;
  return { awarded: false, duplicate: false, amount: 0 };
};
export const notifyPointsUpdated = () => {};
