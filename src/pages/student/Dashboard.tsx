import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ProvenanceBadge from "../../components/common/ProvenanceBadge";
import StatePanel from "../../components/common/StatePanel";
import W8ReadOnlyState from "../../components/common/W8ReadOnlyState";
import W8StatusBadge from "../../components/common/W8StatusBadge";
import { useAuth } from "../../contexts/AuthContext";
import {
  W8DomainError,
  formatW8DateTime,
  getW8DomainState,
  toW8StatePanelState,
  type W8DomainState,
} from "../../lib/w8Domains";
import { getWisEconomyState, type WisEconomyState } from "../../lib/wisEconomy";
import "../w8Domains.css";

const Dashboard: React.FC = () => {
  const { config, configReady, currentUser, userData } = useAuth();
  const [state, setState] = useState<W8DomainState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<W8DomainError | null>(null);
  const [wis, setWis] = useState<WisEconomyState | null>(null);

  const load = useCallback(async () => {
    if (!configReady || !currentUser?.uid) return;
    setLoading(true);
    setError(null);
    try {
      const [nextState, nextWis] = await Promise.all([
        getW8DomainState({
          config,
          domain: "DASHBOARD",
          audience: "student",
          studentUid: currentUser.uid,
          source: "CURRENT",
        }),
        getWisEconomyState({
          config,
          audience: "student",
          provenance: "CURRENT",
        }).catch(() => null),
      ]);
      setState(nextState);
      setWis(nextWis);
    } catch (caught) {
      setError(
        caught instanceof W8DomainError
          ? caught
          : new W8DomainError("UNKNOWN", "오늘 자료를 불러오지 못했습니다."),
      );
    } finally {
      setLoading(false);
    }
  }, [config, configReady, currentUser?.uid]);

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
    <section className="w8-domain-page" aria-labelledby="student-today-title">
      <header className="w8-domain-page__header">
        <div>
          <h1 id="student-today-title">
            {userData?.name ? `${userData.name} 학생의 오늘` : "오늘"}
          </h1>
          <p>오늘 확인할 학습과 일정, 공지를 차례로 살펴보세요.</p>
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
            <h2>이어 할 학습</h2>
            <Link className="w8-text-link" to="/student/learning">
              전체 학습
            </Link>
          </div>
          {summary.upcomingLearning.length === 0 ? (
            <StatePanel
              state="EMPTY"
              compact
              title="오늘 이어 할 학습이 없습니다."
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
            <h2>내 위스</h2>
            <Link className="w8-text-link" to="/student/points">
              위스 화면
            </Link>
          </div>
          {wis?.account ? (
            <div className="w8-wis-summary">
              <strong>
                {wis.account.balance.toLocaleString("ko-KR")} 위스
              </strong>
              <span>
                {wis.rankings.find(
                  (row) => row.accountId === wis.account?.accountId,
                )?.rank
                  ? `이번 학기 ${wis.rankings.find((row) => row.accountId === wis.account?.accountId)?.rank}위`
                  : "순위 집계 전"}
              </span>
              <Link
                className="w8-button w8-button--secondary"
                to="/student/points?tab=ranking"
              >
                이번 학기 순위
              </Link>
            </div>
          ) : (
            <StatePanel
              state="EMPTY"
              compact
              title="이번 학기 위스가 아직 열리지 않았습니다."
            />
          )}
        </section>

        <section className="w8-panel">
          <div className="w8-panel__heading">
            <h2>오늘 일정</h2>
            <Link className="w8-text-link" to="/student/schedule">
              전체 일정
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
            <h2>출석 상태</h2>
            <Link className="w8-text-link" to="/student/attendance">
              출석 기록
            </Link>
          </div>
          <p className="w8-dashboard-status">
            출석은 교사가 수업별로 기록합니다. 학생 로그인이나 화면 방문은
            출석으로 처리되지 않습니다.
          </p>
        </section>

        <section className="w8-panel">
          <div className="w8-panel__heading">
            <h2>중요 공지</h2>
            <Link className="w8-text-link" to="/student/communication">
              모든 공지
            </Link>
          </div>
          {summary.importantNotices.length === 0 ? (
            <StatePanel
              state="EMPTY"
              compact
              title="새로운 중요 공지가 없습니다."
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
      </div>
    </section>
  );
};

export default Dashboard;
