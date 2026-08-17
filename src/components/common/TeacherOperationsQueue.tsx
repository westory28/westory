import React from "react";
import { Link } from "react-router-dom";
import type {
  TeacherBulkJob,
  TeacherDraftRecord,
} from "../../lib/teacherOperations";

const DOMAIN_ROUTE: Record<string, string> = {
  LEARNING: "/teacher/learning",
  SCHEDULE: "/teacher/schedule",
  ATTENDANCE: "/teacher/attendance",
  COMMUNICATION: "/teacher/communication",
  GRADE: "/teacher/exam?tab=performance",
  ASSESSMENT: "/teacher/quiz",
  WIS: "/teacher/points",
};

const DRAFT_SURFACE_LABEL: Record<string, string> = {
  "content-editor": "학습 자료 작성",
  "learning-content-editor": "학습 자료 작성",
  "schedule-event-editor": "일정 작성",
  "notice-editor": "공지 작성",
};

const DRAFT_ROUTE_LABEL: Array<{ prefix: string; label: string }> = [
  { prefix: "/teacher/learning", label: "학습 자료 작성" },
  { prefix: "/teacher/schedule", label: "일정 작성" },
  { prefix: "/teacher/attendance", label: "출석 기록" },
  { prefix: "/teacher/communication", label: "공지 작성" },
  { prefix: "/teacher/exam", label: "성적 검토" },
  { prefix: "/teacher/quiz", label: "평가 준비" },
  { prefix: "/teacher/points", label: "위스 운영" },
];

const BULK_OPERATION_LABEL: Record<string, string> = {
  CREATE_CONTENTS: "학습 자료 여러 건 만들기",
  "미입력 학생 출석 일괄 기록": "미입력 학생 출석 일괄 기록",
};

const BULK_DOMAIN_LABEL: Record<string, string> = {
  LEARNING: "학습 자료 일괄 작업",
  SCHEDULE: "일정 일괄 작업",
  ATTENDANCE: "출석 일괄 작업",
  COMMUNICATION: "공지 일괄 작업",
  GRADE: "성적 일괄 작업",
  ASSESSMENT: "평가 일괄 작업",
  WIS: "위스 일괄 작업",
};

const BULK_STATUS_LABEL: Record<TeacherBulkJob["status"], string> = {
  READY: "실행 대기",
  RUNNING: "처리 중",
  PARTIAL: "일부 완료",
  SUCCEEDED: "완료",
  FAILED: "확인 필요",
};

const getDraftLabel = (draft: TeacherDraftRecord) =>
  DRAFT_SURFACE_LABEL[draft.key.surfaceKey] ||
  DRAFT_ROUTE_LABEL.find(({ prefix }) => draft.key.routeKey.startsWith(prefix))
    ?.label ||
  "저장 중인 업무";

const getBulkOperationLabel = (job: TeacherBulkJob) =>
  BULK_OPERATION_LABEL[job.operationType] ||
  BULK_DOMAIN_LABEL[job.domain] ||
  "일괄 작업";

const TeacherOperationsQueue: React.FC<{
  drafts: TeacherDraftRecord[];
  bulkJobs: TeacherBulkJob[];
  warningCount: number;
  domainWork: Array<{
    id: string;
    label: string;
    value: string;
    description: string;
    route: string;
  }>;
}> = ({ drafts, bulkJobs, warningCount, domainWork }) => {
  const activeDrafts = drafts.filter((draft) =>
    ["ACTIVE", "CONFLICT"].includes(draft.status),
  );
  const activeJobs = bulkJobs.filter((job) => job.status !== "SUCCEEDED");
  const completedDrafts = drafts.filter((draft) => draft.status === "SAVED");
  const completedJobs = bulkJobs.filter((job) => job.status === "SUCCEEDED");
  const activeCount = activeDrafts.length + activeJobs.length;
  const completedCount = completedDrafts.length + completedJobs.length;

  return (
    <section
      className="w8-panel w8-panel--wide"
      aria-labelledby="teacher-ops-title"
    >
      <div className="w8-panel__heading">
        <div>
          <h2 id="teacher-ops-title">오늘의 우선 업무</h2>
          <p className="w8-help">
            중단된 작성과 진행 중인 일괄 작업을 먼저 확인해 주세요.
          </p>
        </div>
        {warningCount > 0 && (
          <span className="w8-status w8-status--danger">
            확인 필요 {warningCount}건
          </span>
        )}
      </div>
      {activeCount === 0 ? (
        <p className="w8-dashboard-status">
          <strong>중단된 업무가 없습니다.</strong>
          <span>아래 운영 항목에서 오늘 확인할 내용을 살펴보세요.</span>
        </p>
      ) : (
        <ul
          className="teacher-operation-queue teacher-operation-queue--priority"
          aria-label={`이어 할 업무 ${activeCount}건`}
        >
          {activeDrafts.slice(0, 4).map((draft) => (
            <li key={draft.draftId}>
              <span className="teacher-operation-queue__copy">
                <strong>{getDraftLabel(draft)}</strong>
                <span>
                  {draft.status === "CONFLICT"
                    ? "저장 충돌 확인 필요"
                    : "작성 내용 복구 가능"}
                </span>
              </span>
              <Link to={draft.key.routeKey}>이어서 열기</Link>
            </li>
          ))}
          {activeJobs.slice(0, 4).map((job) => (
            <li key={job.jobId}>
              <span className="teacher-operation-queue__copy">
                <strong>{getBulkOperationLabel(job)}</strong>
                <span>
                  {
                    job.items.filter((item) => item.status === "SUCCEEDED")
                      .length
                  }
                  /{job.items.length}건 완료 · {BULK_STATUS_LABEL[job.status]}
                </span>
              </span>
              <Link to={DOMAIN_ROUTE[job.domain] || "/teacher/dashboard"}>
                결과 보기
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="teacher-operation-queue__section">
        <h3>오늘 확인</h3>
        <ul className="teacher-operation-queue teacher-operation-queue--work">
          {domainWork.map((item) => (
            <li key={item.id}>
              <span className="teacher-operation-queue__copy">
                <strong>
                  {item.label} · {item.value}
                </strong>
                <span>{item.description}</span>
              </span>
              <Link to={item.route}>업무 열기</Link>
            </li>
          ))}
        </ul>
      </div>

      <details className="teacher-operation-history">
        <summary>최근 완료 {completedCount.toLocaleString("ko-KR")}건</summary>
        <div className="teacher-operation-history__body">
          {completedCount === 0 ? (
            <p className="w8-dashboard-status">
              최근 완료한 임시 저장 정리나 일괄 작업이 없습니다.
            </p>
          ) : (
            <ul className="teacher-operation-queue">
              {completedJobs.slice(0, 3).map((job) => (
                <li key={job.jobId}>
                  <span className="teacher-operation-queue__copy">
                    <strong>{getBulkOperationLabel(job)}</strong>
                    <span>{job.items.length}건 처리 완료</span>
                  </span>
                  <Link to={DOMAIN_ROUTE[job.domain] || "/teacher/dashboard"}>
                    운영 화면 열기
                  </Link>
                </li>
              ))}
              {completedDrafts.slice(0, 3).map((draft) => (
                <li key={draft.draftId}>
                  <span className="teacher-operation-queue__copy">
                    <strong>{getDraftLabel(draft)}</strong>
                    <span>저장 완료 · 임시 내용 정리됨</span>
                  </span>
                  <Link to={draft.key.routeKey}>운영 화면 열기</Link>
                </li>
              ))}
            </ul>
          )}
          <p className="w8-help">
            개인정보가 담긴 완료 초안은 다시 표시하지 않습니다. 상세 결과는
            작업을 실행한 운영 화면에서 확인해 주세요.
          </p>
        </div>
      </details>
    </section>
  );
};

export default TeacherOperationsQueue;
