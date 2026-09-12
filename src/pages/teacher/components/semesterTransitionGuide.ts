import type {
  SemesterManifest,
  SemesterReadinessReport,
  ServerSemesterCoreState,
} from "../../../lib/semesterCore";

export const semesterStatusLabel: Record<string, string> = {
  DRAFT: "기본 정보 등록",
  PREPARING: "준비 중",
  VALIDATING: "점검 결과 확인",
  READY: "전환 대기",
  ACTIVE: "운영 중",
  CLOSING: "마감 중",
  CLOSED: "마감됨",
  ARCHIVED: "이전 학기 기록",
  FAILED: "준비 보완 필요",
  QUARANTINED: "관리 확인 필요",
};
export const nextSemester = (
  manifest?: Pick<SemesterManifest, "schoolYear" | "term"> | null,
) => {
  const year = manifest?.schoolYear || String(new Date().getFullYear());
  return {
    schoolYear: manifest?.term === "2" ? String(Number(year) + 1) : year,
    term: manifest?.term === "1" ? ("2" as const) : ("1" as const),
  };
};

export function hasCompleteReadiness(
  manifest: SemesterManifest | undefined,
  report: SemesterReadinessReport | undefined,
  server: ServerSemesterCoreState | null,
) {
  if (
    !manifest ||
    !report ||
    !server ||
    server.error ||
    server.requested?.semesterId !== manifest.semesterId ||
    server.requested.revision !== manifest.revision ||
    server.requested.status !== manifest.status
  )
    return false;
  const required = report.checks.filter((check) => check.required);
  return (
    report.semesterId === manifest.semesterId &&
    report.status === "PASS" &&
    !report.stale &&
    report.evaluatedRevision === manifest.revision &&
    report.policyVersion === manifest.readinessPolicyVersion &&
    Boolean(report.dependencyHash) &&
    server.readiness?.current === true &&
    server.readiness.dependencyHash === report.dependencyHash &&
    report.requiredTotal > 0 &&
    required.length === report.requiredTotal &&
    report.requiredPassed === report.requiredTotal &&
    required.every((check) => check.status === "PASS")
  );
}

export function canActivateSemester(input: {
  manifest: SemesterManifest | undefined;
  report: SemesterReadinessReport | undefined;
  server: ServerSemesterCoreState | null;
  activeId: string | null;
  studentAccessClosed: boolean;
  confirmed: boolean;
}) {
  return (
    input.confirmed &&
    input.studentAccessClosed &&
    input.manifest?.status === "READY" &&
    input.manifest.semesterId !== input.activeId &&
    (input.server?.active?.semesterId ?? null) === input.activeId &&
    hasCompleteReadiness(input.manifest, input.report, input.server)
  );
}

export const readinessLabel = (id: string) =>
  (
    ({
      manifest_schema: "학기 기본 정보",
      semester_identity_unique: "학기 중복 확인",
      date_range: "시작일과 종료일",
      required_settings: "필수 운영 설정",
      status_transition: "학기 전환 가능 상태",
      schema_version: "저장 형식 호환성",
      readiness_policy_version: "점검 기준",
      active_semester_conflict: "현재 학기 연결",
      revision_freshness: "최신 정보 반영",
      blocking_issues: "미해결 문제",
      trusted_shell_complete: "학기 운영 정보",
      semester_duration_advisory: "학기 운영 기간",
      archive_readiness: "이전 학기 기록 보존",
      class_readiness: "학급 편성",
      enrollment_readiness: "학생 명부",
      semester_roster_readiness: "학급과 학생 명부",
      wis_economy_readiness: "위스 운영 준비",
      semester_cutover_readiness: "자료 이전과 전환 승인",
      assessment_readiness: "평가 준비",
      grade_evidence_readiness: "성적 운영 준비",
      learning_domain_readiness: "학습 자료 준비",
      schedule_domain_readiness: "학사 일정 준비",
      attendance_domain_readiness: "출결 운영 준비",
      communication_domain_readiness: "공지·소통 준비",
      teacher_operations_readiness: "미완료 교사 작업 확인",
      point_policy: "위스 지급 기준",
      assessment_settings: "평가 설정",
      final_exam_config: "지필평가 설정",
      grading_plans_meta: "평가 계획",
      calendar_meta: "학사 일정",
      notices_meta: "공지 설정",
    }) as Record<string, string>
  )[id] || "추가 운영 점검";

export function readinessAdvice(id: string) {
  if (/roster|class|enrollment/.test(id))
    return "학생 명부에서 학급과 학생 연결을 확인해 주세요.";
  if (/archive/.test(id))
    return "이전 학기 기록의 보존 준비가 필요합니다. 이전 기록을 확인해 주세요.";
  if (/cutover/.test(id))
    return "자료 이전 검증과 전환 승인이 필요합니다. 준비가 끝나면 다시 점검해 주세요.";
  if (/wis|point/.test(id))
    return "새 학기의 위스 운영 정보와 학생별 계정 준비가 필요합니다.";
  if (/date|duration/.test(id)) return "학기 시작일과 종료일을 확인해 주세요.";
  return "준비 상태를 다시 점검해 주세요. 계속 남아 있으면 학기 운영 설정을 확인해 주세요.";
}
