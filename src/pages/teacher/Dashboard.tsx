import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ProvenanceBadge from "../../components/common/ProvenanceBadge";
import StatePanel from "../../components/common/StatePanel";
import W8ReadOnlyState from "../../components/common/W8ReadOnlyState";
import W8StatusBadge from "../../components/common/W8StatusBadge";
import WisRankingPanel from "../../components/common/WisRankingPanel";
import { useAuth } from "../../contexts/AuthContext";
import {
  W8DomainError,
  formatW8DateTime,
  getW8DomainState,
  toW8StatePanelState,
  type W8DomainState,
} from "../../lib/w8Domains";
import "../w8Domains.css";

const TeacherDashboard: React.FC = () => {
  const { config, configReady } = useAuth();
  const [state, setState] = useState<W8DomainState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<W8DomainError | null>(null);

  const load = useCallback(async () => {
    if (!configReady) return;
    setLoading(true);
    setError(null);
    try {
      setState(
        await getW8DomainState({
          config,
          domain: "DASHBOARD",
          audience: "teacher",
          source: "CURRENT",
        }),
      );
    } catch (caught) {
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
  return (
    <section className="w8-domain-page" aria-labelledby="teacher-home-title">
      <header className="w8-domain-page__header">
        <div>
          <h1 id="teacher-home-title">업무 홈</h1>
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
