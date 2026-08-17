import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import StatePanel from "../../components/common/StatePanel";
import W8ReadOnlyState from "../../components/common/W8ReadOnlyState";
import W8StatusBadge from "../../components/common/W8StatusBadge";
import { useAuth } from "../../contexts/AuthContext";
import { getStudentRouteAccess } from "../../lib/studentMenuAccess";
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
  const { config, configReady, currentUser, menuConfig } = useAuth();
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
  const learningAccess = getStudentRouteAccess(
    { pathname: "/student/learning" },
    config,
    menuConfig,
  );
  const pointsRankingAccess = getStudentRouteAccess(
    { pathname: "/student/points", search: "?tab=ranking" },
    config,
    menuConfig,
  );
  const myWisRank = wis?.account
    ? wis.rankings.find((row) => row.accountId === wis.account?.accountId)?.rank
    : null;
  return (
    <section
      className="w8-domain-page w8-dashboard-page w8-student-today"
      aria-label="오늘 학습 내용"
    >
      <W8ReadOnlyState state={state} />
      {error && (
        <StatePanel
          state={toW8StatePanelState(error)}
          compact
          description={error.message}
          action={{ label: "새로고침", onClick: () => void load() }}
        />
      )}

      <div className="w8-today-grid w8-today-grid--student">
        <section className="w8-panel w8-student-today__primary">
          <div className="w8-panel__heading">
            <h2>이어 할 학습</h2>
            {learningAccess.allowed && (
              <Link className="w8-text-link" to="/student/learning">
                전체 학습
              </Link>
            )}
          </div>
          {summary.upcomingLearning.length === 0 ? (
            <StatePanel
              state="EMPTY"
              compact
              title="오늘 이어 할 학습이 없습니다."
            />
          ) : (
            <ul className="w8-list">
              {summary.upcomingLearning.slice(0, 3).map((content) => {
                const search = `?id=${encodeURIComponent(content.contentId)}`;
                const contentAccess = getStudentRouteAccess(
                  { pathname: "/student/learning", search },
                  config,
                  menuConfig,
                );
                return (
                  <li
                    key={content.contentId}
                    className="w8-list__row w8-list__row--linked"
                  >
                    {contentAccess.allowed ? (
                      <Link
                        className="w8-list__primary-link"
                        to={`/student/learning${search}`}
                      >
                        <strong>{content.title}</strong>
                        <span>
                          {content.summary || "학습 내용을 확인합니다."}
                        </span>
                        <span className="w8-list__link-label">
                          이어서 학습하기
                        </span>
                      </Link>
                    ) : (
                      <div
                        className="w8-list__primary-link"
                        aria-disabled="true"
                      >
                        <strong>{content.title}</strong>
                        <span>
                          {content.summary || "학습 내용을 확인합니다."}
                        </span>
                        <span className="w8-list__link-label">
                          현재 이용할 수 없습니다.
                        </span>
                      </div>
                    )}
                    <W8StatusBadge value={content.status} />
                  </li>
                );
              })}
            </ul>
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
                <li
                  key={notice.noticeId}
                  className="w8-list__row w8-list__row--linked"
                >
                  <Link
                    className="w8-list__primary-link"
                    to={`/student/communication?id=${encodeURIComponent(notice.noticeId)}`}
                  >
                    <strong>{notice.title}</strong>
                    <span>{formatW8DateTime(notice.publishAt)}</span>
                  </Link>
                  <W8StatusBadge value={notice.priority} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          className="w8-panel w8-panel--wide w8-student-today__support"
          aria-labelledby="student-support-title"
        >
          <div className="w8-panel__heading">
            <h2 id="student-support-title">내 상태</h2>
          </div>
          <dl className="w8-support-list">
            <div>
              <dt>내 위스</dt>
              <dd>
                {wis?.account ? (
                  <>
                    <strong>
                      {wis.account.balance.toLocaleString("ko-KR")} 위스
                    </strong>
                    <span>
                      {myWisRank ? `이번 학기 ${myWisRank}위` : "순위 집계 전"}
                    </span>
                  </>
                ) : (
                  <span>이번 학기 위스가 아직 열리지 않았습니다.</span>
                )}
              </dd>
              {pointsRankingAccess.allowed && (
                <Link className="w8-text-link" to="/student/points?tab=ranking">
                  위스와 순위 보기
                </Link>
              )}
            </div>
            <div>
              <dt>출석 기록</dt>
              <dd>
                <span>
                  출석은 교사가 수업별로 기록하며, 화면 방문만으로 처리되지
                  않습니다.
                </span>
              </dd>
              <Link className="w8-text-link" to="/student/attendance">
                기록 보기
              </Link>
            </div>
          </dl>
        </section>
      </div>
    </section>
  );
};

export default Dashboard;
