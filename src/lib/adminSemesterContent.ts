import { getHttpsCallable } from "./firebase";

export type AdminSemesterContentType =
  | "lessons"
  | "think_cloud_sessions"
  | "think_cloud_responses"
  | "history_dictionary_terms"
  | "history_dictionary_requests"
  | "dictionary_words"
  | "quiz_questions"
  | "history_classrooms"
  | "assessment_config"
  | "exam_config"
  | "grading_plans";

export interface AdminSemesterContentRow {
  id: string;
  title: string;
  subtitle: string;
  status: string;
}

export interface AdminSemesterContentPage {
  semesterId: string;
  contentType: AdminSemesterContentType;
  provenance: "ARCHIVE";
  readOnly: true;
  rows: AdminSemesterContentRow[];
  nextCursor: string | null;
  detail?: Record<string, unknown> | null;
}

export const getAdminSemesterContent = async (request: {
  semesterId: string;
  contentType: AdminSemesterContentType;
  cursor?: string;
  itemId?: string;
  parentId?: string;
}): Promise<AdminSemesterContentPage> => {
  const callable = await getHttpsCallable<
    typeof request & { pageSize: number },
    AdminSemesterContentPage
  >("getAdminSemesterContent");
  const { data } = await callable({ ...request, pageSize: 20 });
  if (
    data.semesterId !== request.semesterId ||
    data.contentType !== request.contentType ||
    data.provenance !== "ARCHIVE" ||
    data.readOnly !== true ||
    !Array.isArray(data.rows) ||
    !data.rows.every(
      (row) => typeof row.id === "string" && typeof row.title === "string",
    ) ||
    (data.nextCursor !== null && typeof data.nextCursor !== "string") ||
    (data.detail != null &&
      (typeof data.detail !== "object" || Array.isArray(data.detail)))
  ) {
    throw new Error("지난 학기 자료의 조회 범위를 확인하지 못했습니다.");
  }
  return data;
};
