import { auth } from "./firebase";
import { getHistoryDictionaryCallable } from "./historyDictionarySession";

export type SemesterReadinessStatus =
  | "ready"
  | "partial"
  | "danger"
  | "reference";

export interface SemesterReadinessItem {
  key: "semesterCore";
  label: string;
  ready: boolean;
  detail?: string;
  advisory?: boolean;
}

export interface SemesterReadinessResult {
  status: SemesterReadinessStatus;
  requiredItems: SemesterReadinessItem[];
  advisoryItems: SemesterReadinessItem[];
  missingRequiredCount: number;
}

interface SemesterCoreState {
  requested: { semesterId: string; revision: number; status: string } | null;
  error: string | null;
  readiness: { current: boolean; reason: string | null };
}

const readinessMessages: Record<string, string> = {
  CONFLICTING_ACTIVE_SEMESTER: "운영 학기 연결이 일치하지 않습니다.",
  SEMESTER_ACTIVE_CONFLICT: "운영 학기 연결이 일치하지 않습니다.",
  SEMESTER_NOT_FOUND: "등록된 학기가 아닙니다.",
  NO_ACTIVE_SEMESTER: "운영 중인 학기가 없습니다.",
  SEMESTER_READINESS_NOT_FOUND: "학기 준비도 검증 기록이 없습니다.",
  SEMESTER_READINESS_STALE: "학기 변경 후 준비도 재검증이 필요합니다.",
  SEMESTER_READINESS_DEPENDENCY_CHANGED:
    "운영 자료가 바뀌어 준비도 재검증이 필요합니다.",
  SEMESTER_POLICY_VERSION_MISMATCH:
    "현재 준비도 기준으로 다시 검증해야 합니다.",
  SEMESTER_READINESS_NOT_PASS: "필수 운영 항목의 검증을 완료해 주세요.",
};

export const loadSemesterReadiness = async (
  year: string,
  semester: string,
): Promise<SemesterReadinessResult> => {
  const semesterId = `${year}-${semester}`;
  if (!/^\d{4}-[12]$/.test(semesterId))
    throw new Error("학년도를 확인해 주세요.");
  const owner = auth.currentUser;
  if (!owner) throw new Error("로그인 후 다시 확인해 주세요.");
  const call = await getHistoryDictionaryCallable<
    { semesterId: string },
    SemesterCoreState
  >("getSemesterCoreState");
  const { data } = await call({ semesterId });
  if (auth.currentUser !== owner)
    throw new Error("로그인 계정이 바뀌었습니다.");
  if (
    !data ||
    !data.readiness ||
    typeof data.readiness.current !== "boolean" ||
    !(data.error === null || typeof data.error === "string") ||
    !(
      data.readiness.reason === null ||
      typeof data.readiness.reason === "string"
    ) ||
    (data.requested !== null && data.requested?.semesterId !== semesterId)
  )
    throw new Error("학기 준비도 응답을 확인하지 못했습니다.");
  const ready = Boolean(
    data.requested &&
    !data.error &&
    data.readiness.current &&
    !data.readiness.reason,
  );
  const reason = data.error || data.readiness.reason;
  const activeRecordChanged =
    !data.error &&
    data.requested?.status === "ACTIVE" &&
    !data.readiness.current &&
    reason === "SEMESTER_READINESS_DEPENDENCY_CHANGED";
  if (activeRecordChanged) {
    return {
      status: "reference",
      requiredItems: [],
      advisoryItems: [
        {
          key: "semesterCore",
          label: "개시 전 검증 기록",
          ready: false,
          advisory: true,
          detail:
            "이 기록 차이만으로 학생 로그인이나 학습 기능이 차단되지는 않습니다.",
        },
      ],
      missingRequiredCount: 0,
    };
  }
  return {
    status: ready
      ? "ready"
      : data.error || !data.requested
        ? "danger"
        : "partial",
    requiredItems: [
      {
        key: "semesterCore",
        label: "학기 준비도 검증",
        ready,
        detail: ready
          ? "현재 학기의 필수 운영 항목 검증이 완료되었습니다."
          : readinessMessages[reason || ""] ||
            "학기 준비도 검증을 확인해 주세요.",
      },
    ],
    advisoryItems: [],
    missingRequiredCount: ready ? 0 : 1,
  };
};
