import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ProvenanceBadge from "../../components/common/ProvenanceBadge";
import StatePanel from "../../components/common/StatePanel";
import TeacherOperationsQueue from "../../components/common/TeacherOperationsQueue";
import W8ReadOnlyState from "../../components/common/W8ReadOnlyState";
import W8StatusBadge from "../../components/common/W8StatusBadge";
import WisRankingPanel from "../../components/common/WisRankingPanel";
import { useAuth } from "../../contexts/AuthContext";
import { getServerSemesterCoreState } from "../../lib/semesterCore";
import {
  W8DomainError,
  formatW8DateTime,
  getW8DomainState,
  toW8StatePanelState,
  type W8DomainState,
} from "../../lib/w8Domains";
import {
  getTeacherOperationsState,
  type TeacherOperationsState,
} from "../../lib/teacherOperations";
import "../w8Domains.css";

interface TeacherDomainWorkload {
  readinessCurrent: boolean | null;
}

const emptyWorkload: TeacherDomainWorkload = {
  readinessCurrent: null,
};

const TeacherDashboard: React.FC = () => {
  const { config, configReady } = useAuth();
  const [state, setState] = useState<W8DomainState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<W8DomainError | null>(null);
  const [operations, setOperations] = useState<TeacherOperationsState | null>(
    null,
  );
  const [operationsError, setOperationsError] = useState("");
  const [workload, setWorkload] =
    useState<TeacherDomainWorkload>(emptyWorkload);

  const load = useCallback(async () => {
    if (!configReady) return;
    setLoading(true);
    setError(null);
    try {
      const dashboardState = await getW8DomainState({
        config,
        domain: "DASHBOARD",
        audience: "teacher",
        source: "CURRENT",
      });
      setState(dashboardState);
      const [operationsResult, readinessResult] = await Promise.allSettled([
        getTeacherOperationsState({
          config,
          semesterId: dashboardState.semesterId,
          source: "CURRENT",
          includeTerminal: true,
          limit: 8,
        }),
        getServerSemesterCoreState(dashboardState.semesterId),
      ]);

      if (operationsResult.status === "fulfilled") {
        setOperations(operationsResult.value);
        setOperationsError("");
      } else {
        setOperations(null);
        setOperationsError(
          operationsResult.reason instanceof Error
            ? operationsResult.reason.message
            : "이어 할 업무를 불러오지 못했습니다.",
        );
      }
      setWorkload({
        readinessCurrent:
          readinessResult.status === "fulfilled"
            ? (readinessResult.value.readiness?.current ?? null)
            : null,
      });
    } catch (caught) {
      setWorkload(emptyWorkload);
      setError(
        caught instanceof W8DomainError
          ? caught
          : new W8DomainError(
              "UNKNOWN",
              "교사 업무 요약을 불러오지 못했습니다.",
            ),
      );
    } finally {
      setLoading(false);
    }
  }, [config, configReady]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <StatePanel state="LOADING" />;
  if (error && !state) {
    return (
      <StatePanel
        state={toW8StatePanelState(error)}
        description={error.message}
        action={{ label: "다시 불러오기", onClick: () => void load() }}
        retryable
      />
    );
  }
  if (!state) return null;

  const summary = state.dashboard;
  const domainWork = [
    {
      id: "attendance",
      label: "출석 미처리",
      value: `${summary.attendancePendingCount.toLocaleString("ko-KR")}건`,
      description: "교사가 아직 입력하거나 마감하지 않은 출석입니다.",
      route: "/teacher/attendance",
    },
    {
      id: "grade",
      label: "성적 검토 요청",
      value: "운영 화면에서 확인",
      description: "업무 홈에서 성적 자료 전체를 읽지 않습니다.",
      route: "/teacher/exam?tab=performance",
    },
    {
      id: "wis",
      label: "위스 주문 요청",
      value: "운영 화면에서 확인",
      description: "업무 홈에서 주문 자료 전체를 읽지 않습니다.",
      route: "/teacher/points",
    },
    {
      id: "learning",
      label: "공개 예정 학습",
      value: `${summary.upcomingLearning.length.toLocaleString("ko-KR")}건`,
      description: "공개 시각이나 상태를 확인할 학습 자료입니다.",
      route: "/teacher/learning",
    },
    {
      id: "notice",
      label: "예약 상태 공지",
      value: "운영 화면에서 확인",
      description:
        "공지 전체를 읽지 않고 운영 화면에서 공개 상태를 확인합니다.",
      route: "/teacher/communication",
    },
    {
      id: "readiness",
      label: "학기 준비도",
      value:
        workload.readinessCurrent === null
          ? "미확인"
          : workload.readinessCurrent
            ? "최신"
            : "확인 필요",
      description:
        workload.readinessCurrent === false
          ? "준비도 차단 사유를 관리자 학기 관리에서 확인해 주세요."
          : "현재 학기의 운영 준비도 상태입니다.",
      route: "/teacher/settings?tab=semester",
    },
  ];
  return (
    <section className="w8-domain-page" aria-labelledby="teacher-home-title">
      <header className="w8-domain-page__header">
        <div>
          <h2 id="teacher-home-title">업무 홈</h2>
          <p>오늘 처리할 일정과 출석, 학습 자료, 공지를 확인해 주세요.</p>
          <span className="w8-semester-label">{state.semesterId} 학기</span>
        </div>
        <ProvenanceBadge value={state.provenance} readOnly={state.readOnly} />
      </header>
      <W8ReadOnlyState state={state} />
      {error && (
        <StatePanel
          state={toW8StatePanelState(error)}
          compact
          description={error.message}
          action={{ label: "새로고침", onClick: () => void load() }}
        />
      )}

      <div className="w8-today-grid">
        {operations ? (
          <TeacherOperationsQueue
            drafts={operations.drafts}
            bulkJobs={operations.bulkJobs}
            warningCount={operations.warnings.length}
            domainWork={domainWork}
          />
        ) : operationsError ? (
          <section className="w8-panel w8-panel--wide">
            <StatePanel
              state="ERROR"
              compact
              title="이어 할 업무를 불러오지 못했습니다."
              description={operationsError}
              action={{ label: "다시 불러오기", onClick: () => void load() }}
            />
          </section>
        ) : null}
        <section className="w8-panel">
          <div className="w8-panel__heading">
            <h2>오늘 일정</h2>
            <Link className="w8-text-link" to="/teacher/schedule">
              일정 관리
            </Link>
          </div>
          {summary.todaySchedule.length === 0 ? (
            <StatePanel
              state="EMPTY"
              compact
              title="오늘 등록된 일정이 없습니다."
            />
          ) : (
            <ol className="w8-timeline">
              {summary.todaySchedule.slice(0, 4).map((event) => (
                <li key={event.eventId}>
                  <time dateTime={event.startAt}>
                    {formatW8DateTime(event.startAt)}
                  </time>
                  <div>
                    <strong>{event.title}</strong>
                    <p>{event.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="w8-panel">
          <div className="w8-panel__heading">
            <h2>출석 미처리</h2>
            <Link className="w8-text-link" to="/teacher/attendance">
              출석 운영
            </Link>
          </div>
          <div className="w8-dashboard-status">
            <strong>
              {summary.attendancePendingCount.toLocaleString("ko-KR")}건
            </strong>
            <span>
              업무 홈에서는 조회만 하며 출석 입력은 출석 운영에서 합니다.
            </span>
          </div>
        </section>

        <section className="w8-panel">
          <div className="w8-panel__heading">
            <h2>공개 예정 학습</h2>
            <Link className="w8-text-link" to="/teacher/learning">
              학습 운영
            </Link>
          </div>
          {summary.upcomingLearning.length === 0 ? (
            <StatePanel
              state="EMPTY"
              compact
              title="공개를 앞둔 학습 자료가 없습니다."
            />
          ) : (
            <ul className="w8-list">
              {summary.upcomingLearning.slice(0, 3).map((content) => (
                <li key={content.contentId} className="w8-list__row">
                  <span className="w8-list__copy">
                    <strong>{content.title}</strong>
                    <span>{content.summary}</span>
                  </span>
                  <W8StatusBadge value={content.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="w8-panel">
          <div className="w8-panel__heading">
            <h2>중요 공지</h2>
            <Link className="w8-text-link" to="/teacher/communication">
              공지 운영
            </Link>
          </div>
          {summary.importantNotices.length === 0 ? (
            <StatePanel
              state="EMPTY"
              compact
              title="확인할 중요 공지가 없습니다."
            />
          ) : (
            <ul className="w8-list">
              {summary.importantNotices.slice(0, 3).map((notice) => (
                <li key={notice.noticeId} className="w8-list__row">
                  <span className="w8-list__copy">
                    <strong>{notice.title}</strong>
                    <span>{formatW8DateTime(notice.publishAt)}</span>
                  </span>
                  <W8StatusBadge value={notice.priority} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="w8-panel w8-panel--wide">
          <div className="w8-panel__heading">
            <h2>이번 학기 위스 순위</h2>
            <Link className="w8-text-link" to="/teacher/points">
              위스 운영
            </Link>
          </div>
          <WisRankingPanel
            config={config}
            hallOfFamePath="/teacher/points?tab=hall-of-fame"
          />
        </section>
      </div>
    </section>
  );
};

export default TeacherDashboard;
