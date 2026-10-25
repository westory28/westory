import { auth } from "./firebase";
import { callWithApplicationSession } from "./applicationSession";
import type { MyAssessmentRecord } from "../pages/student/mypage/assessmentRecords";

export interface MyQuizHistoryRow {
  key: string;
  source: "canonical" | "legacy";
  id: string;
  unitId: string;
  category: string;
  examRound: string;
  title: string;
  score: number | null;
  submittedAtMs: number | null;
  totalCount: number | null;
  wrongCount: number | null;
}
export interface MyQuizHistoryPage {
  semesterId: string;
  rows: MyQuizHistoryRow[];
  totalCount: number;
  nextCursor: string | null;
  generatedAt: number;
  version: string;
}
export interface MyQuizHistoryDetail {
  semesterId: string;
  key: string;
  record: MyAssessmentRecord;
}

// Private results stay in component memory. The server caches only the compact
// list; every request verifies the current session and result owner.
export async function loadMyQuizHistory(input: {
  semesterId: string;
  category?: string;
  cursor?: string;
  forceRefresh?: boolean;
}): Promise<MyQuizHistoryPage> {
  const user = auth.currentUser;
  if (!user) throw new Error("로그인 후 응시 기록을 확인해 주세요.");
  const response = await callWithApplicationSession<
    Record<string, unknown>,
    MyQuizHistoryPage
  >("getMyQuizHistory", { ...input, mode: "list" }, user);
  if (
    auth.currentUser !== user ||
    response.data.semesterId !== input.semesterId
  )
    throw new Error("계정이나 학기가 변경되었습니다. 다시 조회해 주세요.");
  return response.data;
}

export async function loadMyQuizHistoryDetail(
  semesterId: string,
  key: string,
): Promise<MyQuizHistoryDetail> {
  const user = auth.currentUser;
  if (!user) throw new Error("로그인 후 응시 기록을 확인해 주세요.");
  const response = await callWithApplicationSession<
    Record<string, unknown>,
    MyQuizHistoryDetail
  >("getMyQuizHistory", { semesterId, key, mode: "detail" }, user);
  if (
    auth.currentUser !== user ||
    response.data.semesterId !== semesterId ||
    response.data.key !== key
  )
    throw new Error("계정이나 학기가 변경되었습니다. 다시 조회해 주세요.");
  return response.data;
}
