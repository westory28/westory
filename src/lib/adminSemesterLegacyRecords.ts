import { getHttpsCallable } from "./firebase";

export type AdminLegacyRecordType =
  | "wis_wallets"
  | "wis_transactions"
  | "wis_orders"
  | "grades"
  | "grade_students"
  | "quiz_results"
  | "history_results";

export interface AdminLegacyRecord {
  id: string;
  studentUid: string;
  studentName: string;
  grade: string;
  className: string;
  number: string;
  title: string;
  status: string;
  amount: number | null;
  balance: number | null;
  score: number | null;
  maxScore: number | null;
  occurredAt: string | null;
  detail: string;
}

export interface AdminLegacyRecordsPage {
  semesterId: string;
  recordType: AdminLegacyRecordType;
  provenance: "LEGACY";
  readOnly: true;
  rows: AdminLegacyRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}

export const getAdminSemesterLegacyRecords = async (request: {
  semesterId: string;
  recordType: AdminLegacyRecordType;
  studentUid?: string;
  cursor?: string;
}): Promise<AdminLegacyRecordsPage> => {
  const callable = await getHttpsCallable<
    typeof request & { pageSize: number },
    AdminLegacyRecordsPage
  >("getAdminSemesterLegacyRecords");
  const { data } = await callable({ ...request, pageSize: 50 });
  if (
    data.semesterId !== request.semesterId ||
    data.recordType !== request.recordType ||
    data.provenance !== "LEGACY" ||
    data.readOnly !== true ||
    !Array.isArray(data.rows) ||
    (data.hasMore && !data.nextCursor)
  ) {
    throw new Error("지난 학기 보관 기록의 조회 범위를 확인하지 못했습니다.");
  }
  return data;
};
