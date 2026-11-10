import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";
import { callWithApplicationSession } from "./applicationSession";
import { useAuth } from "../contexts/AuthContext";
import { getYearSemester } from "./semesterScope";

export type GongsinSourceKind =
  | "general"
  | "lesson"
  | "dictionary"
  | "mock"
  | "formative"
  | "diagnostic";
export interface GongsinSource {
  kind: GongsinSourceKind;
  title?: string;
  unitId?: string;
  termId?: string;
  resultKey?: string;
  questionId?: string;
  origin?: "wrong-note";
  page?: number;
}
export const GONGSIN_SOURCE_LABELS: Record<GongsinSourceKind, string> = {
  general: "학습 질문",
  lesson: "수업자료",
  dictionary: "역사 사전",
  mock: "모의고사 오답 노트",
  formative: "형성평가",
  diagnostic: "진단평가",
};
export interface GongsinSettings {
  enabled: boolean;
  revision: number;
  acceptingQuestions: boolean;
  storiesVisible: boolean;
  teacherQuestionNotifications: boolean;
  studentReplyNotifications: boolean;
  warning: { enabled: boolean; title: string; body: string; revision: number };
  allowedSources: Exclude<GongsinSourceKind, "general">[];
  defaultRestrictionMs: number;
}
export interface GongsinRestriction {
  until: number;
  reason: string;
}
export interface GongsinQuestion {
  id: string;
  studentId: string;
  studentLabel: string;
  profileEmojiId?: string;
  source: GongsinSource;
  question: string;
  reply: string;
  publicQuestion: string;
  publicReply: string;
  selected: boolean;
  createdAt: number;
  updatedAt: number;
  revision: number;
}
export interface GongsinStory {
  id: string;
  question: string;
  answer: string;
  source: GongsinSource;
}
export interface GongsinState {
  settings: GongsinSettings;
  role: "teacher" | "student";
  canManageSettings: boolean;
  restriction: GongsinRestriction | null;
  acknowledgedWarningRevision: number;
}
export interface GongsinPage<T> {
  items: T[];
  nextCursor: string | null;
}
export interface GongsinMutation {
  question?: GongsinQuestion;
  settings?: GongsinSettings;
  restriction?: GongsinRestriction | null;
  acknowledgedWarningRevision?: number;
  replayed: boolean;
}
export async function getGongsinmoongo<T>(
  semesterId: string,
  mode: string,
  fields: Record<string, unknown> = {},
): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error("로그인 후 질문함을 확인해 주세요.");
  const response = await callWithApplicationSession<Record<string, unknown>, T>(
    "getGongsinmoongo",
    { semesterId, mode, ...fields },
    user,
  );
  if (auth.currentUser !== user)
    throw new Error("로그인 상태가 변경되었습니다. 다시 확인해 주세요.");
  return response.data;
}
export async function manageGongsinmoongo(
  semesterId: string,
  action: string,
  fields: Record<string, unknown>,
  requestId: string,
): Promise<GongsinMutation> {
  const user = auth.currentUser;
  if (!user) throw new Error("로그인 후 질문함을 이용해 주세요.");
  const response = await callWithApplicationSession<
    Record<string, unknown>,
    GongsinMutation
  >("manageGongsinmoongo", { semesterId, action, requestId, ...fields }, user);
  if (auth.currentUser !== user)
    throw new Error("로그인 상태가 변경되었습니다. 다시 확인해 주세요.");
  return response.data;
}
export const newGongsinRequestId = () => crypto.randomUUID().replace(/-/g, "");
export function getGongsinQuestionUrl(
  source: GongsinSource = { kind: "general" },
) {
  const params = new URLSearchParams({ source: source.kind });
  for (const key of [
    "unitId",
    "termId",
    "resultKey",
    "questionId",
    "origin",
    "page",
  ] as const) {
    if (source[key] !== undefined) params.set(key, String(source[key]));
  }
  return `/student/gongsinmoongo?${params}`;
}
export function parseGongsinSource(search: string): GongsinSource {
  const params = new URLSearchParams(search);
  const kind = params.get("source") as GongsinSourceKind;
  const source: GongsinSource = {
    kind: Object.prototype.hasOwnProperty.call(GONGSIN_SOURCE_LABELS, kind)
      ? kind
      : "general",
  };
  for (const key of ["unitId", "termId", "resultKey", "questionId"] as const) {
    const value = params.get(key);
    if (value) source[key] = value;
  }
  if (params.get("origin") === "wrong-note") source.origin = "wrong-note";
  const page = Number(params.get("page"));
  if (Number.isInteger(page) && page > 0) source.page = page;
  return source;
}
export function getGongsinSourceUrl(source: GongsinSource) {
  if (source.kind === "lesson" && source.unitId)
    return `/student/lesson/note?id=${encodeURIComponent(source.unitId)}${source.page ? `&page=${source.page}` : ""}`;
  if (source.kind === "dictionary" && source.termId)
    return `/student/lesson/history-dictionary?term=${encodeURIComponent(source.termId)}`;
  if (source.resultKey)
    return `/student/mypage?menu=wrong_note&attemptId=${encodeURIComponent(source.resultKey)}`;
  return "";
}

// One minimal public listener per account/semester, shared by the launcher and page.
// Last subscriber departure clears data; an error fails closed and has no polling retry.
interface Availability {
  enabled: boolean;
  revision: number;
  contentRevision: number;
  loaded: boolean;
  error: boolean;
}
const CLOSED: Availability = {
  enabled: false,
  revision: 0,
  contentRevision: 0,
  loaded: false,
  error: false,
};
const availability = new Map<
  string,
  {
    value: Availability;
    listeners: Set<(v: Availability) => void>;
    stop: () => void;
  }
>();
export function useGongsinAvailability(active = true) {
  const { currentUser, config } = useAuth();
  const { year, semester } = getYearSemester(config);
  const uid = currentUser?.uid;
  const key = active && uid ? `${uid}:${year}:${semester}` : "";
  const [state, setState] = useState<{ key: string; value: Availability }>({
    key: "",
    value: CLOSED,
  });
  useEffect(() => {
    if (!key) return;
    let entry = availability.get(key);
    if (!entry) {
      entry = { value: CLOSED, listeners: new Set(), stop: () => undefined };
      availability.set(key, entry);
      const current = entry;
      current.stop = onSnapshot(
        doc(
          db,
          `years/${year}/semesters/${semester}/gongsinmoongo_config/public`,
        ),
        (snapshot) => {
          current.value = {
            enabled: snapshot.data()?.enabled === true,
            revision: Number(snapshot.data()?.revision || 0),
            contentRevision: Number(snapshot.data()?.contentRevision || 0),
            loaded: true,
            error: false,
          };
          current.listeners.forEach((listener) => listener(current.value));
        },
        () => {
          current.value = { ...CLOSED, loaded: true, error: true };
          current.listeners.forEach((listener) => listener(current.value));
        },
      );
    }
    const current = entry;
    const listener = (value: Availability) => setState({ key, value });
    current.listeners.add(listener);
    listener(current.value);
    return () => {
      current.listeners.delete(listener);
      if (!current.listeners.size) {
        current.stop();
        availability.delete(key);
      }
    };
  }, [key, year, semester]);
  return {
    ...(state.key === key ? state.value : CLOSED),
    semesterId: `${year}-${semester}`,
  };
}
