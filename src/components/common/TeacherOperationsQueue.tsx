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

  return (
    <section
      className="w8-panel w8-panel--wide"
      aria-labelledby="teacher-ops-title"
    >
      <div className="w8-panel__heading">
        <div>
          <h2 id="teacher-ops-title">이어 할 업무</h2>
          <p className="w8-help">
            임시 저장과 일괄 작업 상태를 모아 보여 줍니다. 이 목록을 여는
            것만으로 업무가 실행되지는 않습니다.
          </p>
        </div>
        {warningCount > 0 && (
          <span className="w8-status w8-status--danger">
            확인 필요 {warningCount}건
          </span>
        )}
      </div>
      {activeDrafts.length + activeJobs.length === 0 ? (
        <p className="w8-dashboard-status">
          이어 할 임시 저장이나 일괄 작업이 없습니다.
        </p>
      ) : (
        <ul className="teacher-operation-queue">
          {activeDrafts.slice(0, 4).map((draft) => (
            <li key={draft.draftId}>
              <span className="teacher-operation-queue__copy">
                <strong>{draft.key.surfaceKey}</strong>
                <span>
                  {draft.status === "CONFLICT"
                    ? "저장 충돌 확인 필요"
                    : "작성 내용 복구 가능"}
                </span>
              </span>
              <Link to={draft.key.routeKey}>업무 열기</Link>
            </li>
          ))}
          {activeJobs.slice(0, 4).map((job) => (
            <li key={job.jobId}>
              <span className="teacher-operation-queue__copy">
                <strong>{job.operationType}</strong>
                <span>
                  {
                    job.items.filter((item) => item.status === "SUCCEEDED")
                      .length
                  }
                  /{job.items.length}건 완료 · {job.status}
                </span>
              </span>
              <Link to={DOMAIN_ROUTE[job.domain] || "/teacher/dashboard"}>
                결과 확인
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="teacher-operation-queue__section">
        <h3>처리할 업무</h3>
        <ul className="teacher-operation-queue">
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

      <div className="teacher-operation-queue__section">
        <h3>최근 완료</h3>
        {completedDrafts.length + completedJobs.length === 0 ? (
          <p className="w8-dashboard-status">
            최근 완료한 임시 저장 정리나 일괄 작업이 없습니다.
          </p>
        ) : (
          <ul className="teacher-operation-queue">
            {completedJobs.slice(0, 3).map((job) => (
              <li key={job.jobId}>
                <span className="teacher-operation-queue__copy">
                  <strong>{job.operationType}</strong>
                  <span>{job.items.length}건 처리 완료</span>
                </span>
                <Link to={DOMAIN_ROUTE[job.domain] || "/teacher/dashboard"}>
                  운영 화면
                </Link>
              </li>
            ))}
            {completedDrafts.slice(0, 3).map((draft) => (
              <li key={draft.draftId}>
                <span className="teacher-operation-queue__copy">
                  <strong>{draft.key.surfaceKey}</strong>
                  <span>공식 저장 완료 · 임시 내용 정리됨</span>
                </span>
                <Link to={draft.key.routeKey}>운영 화면</Link>
              </li>
            ))}
          </ul>
        )}
        <p className="w8-help">
          개인정보가 담긴 완료 초안은 다시 노출하지 않습니다. 상세 결과는 작업을
          실행한 운영 화면의 현재 세션 결과에서 확인해 주세요.
        </p>
      </div>
    </section>
  );
};

export default TeacherOperationsQueue;
