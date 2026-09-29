// Reuse the existing application-session handshake without changing other callers.
import { getHistoryDictionaryCallable as getSessionCallable } from "../../lib/historyDictionarySession";
import type { PointActivityRewardResult } from "../../lib/points";

type AttendanceResult = Pick<
  PointActivityRewardResult,
  | "awarded"
  | "duplicate"
  | "amount"
  | "bonusAwarded"
  | "bonusAmount"
  | "monthlyBonusAwarded"
  | "monthlyBonusAmount"
  | "totalAwarded"
  | "balance"
> & {
  attendanceRecorded: boolean;
  attendanceDate: string;
};

export const checkStudentAttendance = async (
  year: string,
  semester: string,
) => {
  const callable = await getSessionCallable<
    { year: string; semester: string },
    AttendanceResult
  >("checkStudentAttendance");
  return (await callable({ year, semester })).data;
};

export const attendanceErrorMessage = (error: unknown) => {
  const failure = error as { code?: string; details?: { reason?: string } };
  const code = String(failure?.code || "");
  const reason = failure?.details?.reason || "";
  if (
    /ATTENDANCE_(WIS_ACCOUNT_INVALID|STUDENT_INACTIVE|ENROLLMENT_INVALID|CLASS_INACTIVE)/.test(
      reason,
    )
  ) {
    return "출석 보상 계정을 확인하지 못했습니다. 선생님께 문의해 주세요.";
  }
  if (reason === "ATTENDANCE_SEMESTER_CHANGED") {
    return "학기 정보가 변경되었습니다. 새로고침한 뒤 출석을 체크해 주세요.";
  }
  if (
    /ATTENDANCE_(WIS_ECONOMY_CLOSED|MIGRATION_BLOCKED|MAINTENANCE)/.test(reason)
  ) {
    return "현재 출석 보상 처리가 중지되어 있습니다. 잠시 후 다시 시도하거나 선생님께 문의해 주세요.";
  }
  if (/unauthenticated|permission-denied/.test(code)) {
    return "출석을 확인할 수 없습니다. 다시 로그인한 뒤 시도해 주세요.";
  }
  if (/unavailable|deadline-exceeded|network/.test(code)) {
    return "출석 처리 결과를 확인하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.";
  }
  return "출석을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
};
