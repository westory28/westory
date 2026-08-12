import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import ProvenanceBadge from "../../components/common/ProvenanceBadge";
import StatePanel from "../../components/common/StatePanel";
import W8DomainNavigation from "../../components/common/W8DomainNavigation";
import W8ReadOnlyState from "../../components/common/W8ReadOnlyState";
import W8StatusBadge from "../../components/common/W8StatusBadge";
import { useAuth } from "../../contexts/AuthContext";
import {
  W8DomainError,
  acknowledgeAllNotices,
  acknowledgeNotice,
  formatW8DateTime,
  getLearningProgressForContent,
  getW8DomainState,
  recordLearningProgress,
  requestLearningExemption,
  toW8StatePanelState,
  type LearningProgressStatus,
  type W8Domain,
  type W8DomainState,
  type W8LearningContent,
  type W8Notice,
} from "../../lib/w8Domains";
import "../w8Domains.css";

type LearningFilter = "all" | "active" | "completed" | "upcoming";

const domainForPath = (pathname: string): W8Domain => {
  if (pathname.includes("/schedule") || pathname.includes("/calendar")) {
    return "SCHEDULE";
  }
  if (pathname.includes("/attendance")) return "ATTENDANCE";
  if (pathname.includes("/communication")) return "COMMUNICATION";
  return "LEARNING";
};

const LEARNING_FILTERS: Array<{ id: LearningFilter; label: string }> = [
  { id: "all", label: "전체" },
  { id: "active", label: "진행 중" },
  { id: "completed", label: "완료" },
  { id: "upcoming", label: "예정" },
];

const W8StudentHub: React.FC = () => {
  const location = useLocation();
  const { config, configReady, currentUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const domain = domainForPath(location.pathname);
  const semesterId = String(params.get("semesterId") || "").trim();
  const requestedSource = String(params.get("source") || "").toUpperCase();
  const selectedId = String(params.get("id") || "").trim();
  const filter = (
    LEARNING_FILTERS.some((item) => item.id === params.get("view"))
      ? params.get("view")
      : "all"
  ) as LearningFilter;
  const [state, setState] = useState<W8DomainState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<W8DomainError | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    if (!configReady || !currentUser?.uid) return;
    setLoading(true);
    setError(null);
    try {
      setState(
        await getW8DomainState({
          config,
          domain,
          audience: "student",
          ...(semesterId ? { semesterId } : {}),
          source:
            requestedSource === "LEGACY"
              ? "LEGACY"
              : requestedSource === "EXPLICIT"
                ? "EXPLICIT"
                : requestedSource === "ARCHIVE"
                  ? "ARCHIVE"
                  : "CURRENT",
          ...(selectedId && domain === "LEARNING"
            ? { contentId: selectedId }
            : {}),
          ...(selectedId && domain === "SCHEDULE"
            ? { eventId: selectedId }
            : {}),
          ...(selectedId && domain === "ATTENDANCE"
            ? { sessionId: selectedId }
            : {}),
          ...(selectedId && domain === "COMMUNICATION"
            ? { noticeId: selectedId }
            : {}),
          studentUid: currentUser.uid,
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof W8DomainError
          ? caught
          : new W8DomainError("UNKNOWN", "자료를 불러오지 못했습니다."),
      );
    } finally {
      setLoading(false);
    }
  }, [
    config,
    configReady,
    currentUser?.uid,
    domain,
    requestedSource,
    selectedId,
    semesterId,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const setParam = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  const perform = async (key: string, operation: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await operation();
      await load();
    } catch (caught) {
      setError(
        caught instanceof W8DomainError
          ? caught
          : new W8DomainError("UNKNOWN", "요청을 처리하지 못했습니다."),
      );
    } finally {
      setBusy("");
    }
  };

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
  return (
    <section className="w8-domain-page" aria-labelledby="w8-student-title">
      <header className="w8-domain-page__header">
        <div>
          <h1 id="w8-student-title">
            {domain === "LEARNING"
              ? "나의 학습"
              : domain === "SCHEDULE"
                ? "일정"
                : domain === "ATTENDANCE"
                  ? "나의 출석"
                  : "공지와 알림"}
          </h1>
          <p>
            {domain === "LEARNING"
              ? "배운 내용을 확인하고 완료한 학습을 정리합니다."
              : domain === "SCHEDULE"
                ? "수업과 학교 일정, 학습 마감을 한곳에서 확인합니다."
                : domain === "ATTENDANCE"
                  ? "교사가 기록한 이번 학기 출석을 확인합니다."
                  : "받은 공지를 확인하고 읽음 상태를 직접 관리합니다."}
          </p>
          <span className="w8-semester-label">{state.semesterId} 학기</span>
        </div>
        <ProvenanceBadge value={state.provenance} readOnly={state.readOnly} />
      </header>

      <W8DomainNavigation audience="student" />
      {error && (
        <StatePanel
          state={toW8StatePanelState(error)}
          compact
          description={error.message}
          action={{ label: "새로고침", onClick: () => void load() }}
        />
      )}
      <W8ReadOnlyState state={state} />

      {state.status === "EMPTY" && (
        <StatePanel
          state="EMPTY"
          title="이 학기에 확인할 자료가 없습니다."
          description="자료가 공개되면 이 화면에서 확인할 수 있습니다."
        />
      )}

      {state.status !== "EMPTY" && domain === "LEARNING" && (
        <StudentLearning
          state={state}
          selectedId={selectedId}
          filter={filter}
          busy={busy}
          onSelect={(id) => setParam("id", id)}
          onFilter={(next) => setParam("view", next)}
          onProgress={(content, targetStatus) =>
            perform(`progress:${content.contentId}`, () => {
              const progress = getLearningProgressForContent(
                state,
                content.contentId,
              );
              return recordLearningProgress({
                semesterId: state.semesterId,
                expectedSemesterRevision: state.manifestRevision,
                contentId: content.contentId,
                expectedContentRevision: content.revision,
                enrollmentId: progress?.enrollmentId || state.enrollmentId,
                expectedProgressRevision: progress?.revision ?? null,
                event: targetStatus === "COMPLETED" ? "COMPLETE" : "START",
              });
            })
          }
          onRequestExemption={(content, reason) =>
            perform(`exemption:${content.contentId}`, () =>
              requestLearningExemption({
                semesterId: state.semesterId,
                expectedSemesterRevision: state.manifestRevision,
                contentId: content.contentId,
                expectedContentRevision: content.revision,
                enrollmentId: state.enrollmentId,
                reason,
              }),
            )
          }
        />
      )}
      {state.status !== "EMPTY" && domain === "SCHEDULE" && (
        <StudentSchedule state={state} />
      )}
      {state.status !== "EMPTY" && domain === "ATTENDANCE" && (
        <StudentAttendance state={state} />
      )}
      {state.status !== "EMPTY" && domain === "COMMUNICATION" && (
        <StudentCommunication
          state={state}
          selectedId={selectedId}
          busy={busy}
          onSelect={(id) => setParam("id", id)}
          onAcknowledge={(notice) =>
            perform(`notice:${notice.noticeId}`, () =>
              acknowledgeNotice({
                semesterId: state.semesterId,
                expectedSemesterRevision: state.manifestRevision,
                noticeId: notice.noticeId,
                expectedNoticeRevision: notice.revision,
              }),
            )
          }
          onAcknowledgeAll={() =>
            perform("notice:all", () =>
              acknowledgeAllNotices({
                semesterId: state.semesterId,
                expectedSemesterRevision: state.manifestRevision,
                notices: state.notices
                  .filter((notice) => !notice.acknowledged)
                  .map((notice) => ({
                    noticeId: notice.noticeId,
                    expectedNoticeRevision: notice.revision,
                  })),
              }),
            )
          }
        />
      )}
    </section>
  );
};

const StudentLearning: React.FC<{
  state: W8DomainState;
  selectedId: string;
  filter: LearningFilter;
  busy: string;
  onSelect: (id: string) => void;
  onFilter: (filter: LearningFilter) => void;
  onProgress: (
    content: W8LearningContent,
    status: Extract<LearningProgressStatus, "IN_PROGRESS" | "COMPLETED">,
  ) => void;
  onRequestExemption: (content: W8LearningContent, reason: string) => void;
}> = ({
  state,
  selectedId,
  filter,
  busy,
  onSelect,
  onFilter,
  onProgress,
  onRequestExemption,
}) => {
  const [exemptionReason, setExemptionReason] = useState("");
  const selected =
    state.learningContents.find((item) => item.contentId === selectedId) ||
    null;
  const visible = state.learningContents.filter((content) => {
    const progress = getLearningProgressForContent(state, content.contentId);
    if (filter === "active") return progress?.status === "IN_PROGRESS";
    if (filter === "completed") return progress?.status === "COMPLETED";
    if (filter === "upcoming") return content.status === "SCHEDULED";
    return true;
  });

  if (selected) {
    const progress = getLearningProgressForContent(state, selected.contentId);
    const enrollmentId = progress?.enrollmentId || state.enrollmentId;
    const exemptionRequest = state.exemptionRequests.find(
      (request) => request.contentId === selected.contentId,
    );
    return (
      <article className="w8-detail" aria-labelledby="w8-learning-detail">
        <button
          type="button"
          className="w8-button w8-button--secondary w8-detail__back"
          onClick={() => onSelect("")}
        >
          학습 목록으로
        </button>
        <div className="w8-detail__heading">
          <div>
            <h2 id="w8-learning-detail">{selected.title}</h2>
            <p>{selected.summary || "학습 내용을 확인해 보세요."}</p>
          </div>
          <W8StatusBadge value={progress?.status || "NOT_STARTED"} />
        </div>
        <div className="w8-reading-content">{selected.body}</div>
        {selected.resourceUrl && (
          <a
            className="w8-button w8-button--secondary"
            href={selected.resourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            참고 자료 새 창에서 열기
          </a>
        )}
        {!state.readOnly &&
          selected.status === "PUBLISHED" &&
          !enrollmentId && (
            <StatePanel
              state="PERMISSION"
              compact
              title="현재 학적을 확인할 수 없습니다"
              description="학적이 연결된 뒤 학습 진행 상태를 기록할 수 있습니다."
            />
          )}
        {!state.readOnly && selected.status === "PUBLISHED" && enrollmentId && (
          <div className="w8-actions">
            {!progress || progress.status === "NOT_STARTED" ? (
              <button
                type="button"
                className="w8-button"
                disabled={busy === `progress:${selected.contentId}`}
                onClick={() => onProgress(selected, "IN_PROGRESS")}
              >
                {busy === `progress:${selected.contentId}`
                  ? "처리 중"
                  : "학습 시작"}
              </button>
            ) : null}
            {progress?.status !== "COMPLETED" && (
              <button
                type="button"
                className="w8-button"
                disabled={busy === `progress:${selected.contentId}`}
                onClick={() => onProgress(selected, "COMPLETED")}
              >
                학습 완료
              </button>
            )}
          </div>
        )}
        {exemptionRequest && (
          <div className="w8-summary-strip" role="status">
            <strong>면제 요청</strong>
            <span>
              {exemptionRequest.status === "PENDING"
                ? "선생님 확인을 기다리고 있습니다."
                : exemptionRequest.status === "APPROVED"
                  ? "면제 요청이 승인되었습니다."
                  : "면제 요청이 반려되었습니다."}
            </span>
            <W8StatusBadge value={exemptionRequest.status} />
          </div>
        )}
        {!state.readOnly &&
          selected.status === "PUBLISHED" &&
          enrollmentId &&
          !exemptionRequest && (
            <form
              className="w8-form w8-stack"
              onSubmit={(event) => {
                event.preventDefault();
                onRequestExemption(selected, exemptionReason.trim());
              }}
            >
              <label>
                학습 면제 요청 사유
                <textarea
                  value={exemptionReason}
                  onChange={(event) => setExemptionReason(event.target.value)}
                  required
                />
              </label>
              <button
                className="w8-button w8-button--secondary"
                disabled={
                  busy === `exemption:${selected.contentId}` ||
                  !exemptionReason.trim()
                }
              >
                {busy === `exemption:${selected.contentId}`
                  ? "요청 중"
                  : "면제 요청 보내기"}
              </button>
            </form>
          )}
      </article>
    );
  }

  return (
    <div className="w8-stack">
      <div className="w8-segment" role="group" aria-label="학습 상태 필터">
        {LEARNING_FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={filter === item.id}
            onClick={() => onFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <StatePanel state="EMPTY" compact title="해당하는 학습이 없습니다." />
      ) : (
        <ul className="w8-list">
          {visible.map((content) => {
            const progress = getLearningProgressForContent(
              state,
              content.contentId,
            );
            return (
              <li key={content.contentId}>
                <button
                  type="button"
                  className="w8-list__button"
                  onClick={() => onSelect(content.contentId)}
                >
                  <span className="w8-list__copy">
                    <strong>{content.title}</strong>
                    <span>{content.summary || "학습 내용을 확인합니다."}</span>
                    <span>
                      {content.availableUntil
                        ? `${formatW8DateTime(content.availableUntil, { dateOnly: true })}까지`
                        : "종료일 없음"}
                    </span>
                  </span>
                  <W8StatusBadge value={progress?.status || content.status} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

const StudentSchedule: React.FC<{ state: W8DomainState }> = ({ state }) => {
  const events = useMemo(
    () =>
      [...state.scheduleEvents].sort((left, right) =>
        left.startAt.localeCompare(right.startAt),
      ),
    [state.scheduleEvents],
  );
  return (
    <div className="w8-stack">
      <section className="w8-summary-strip" aria-label="일정 안내">
        <strong>{events.length}개의 일정</strong>
        <span>일정은 이 화면에서 조회만 할 수 있습니다.</span>
      </section>
      <ol className="w8-timeline">
        {events.map((event) => (
          <li key={event.eventId}>
            <time dateTime={event.startAt}>
              {formatW8DateTime(event.startAt)}
            </time>
            <div>
              <strong>{event.title}</strong>
              <p>{event.description || event.eventType}</p>
              <span>{event.sourceDomain} 출처</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
};

const StudentAttendance: React.FC<{ state: W8DomainState }> = ({ state }) => {
  const counts = state.attendanceRecords.reduce<Record<string, number>>(
    (accumulator, record) => ({
      ...accumulator,
      [record.attendanceStatus]:
        (accumulator[record.attendanceStatus] || 0) + 1,
    }),
    {},
  );
  return (
    <div className="w8-stack">
      <section className="w8-summary-strip" aria-label="출석 요약">
        <strong>출석 {counts.PRESENT || 0}회</strong>
        <span>
          지각 {counts.LATE || 0}회, 결석 {counts.ABSENT || 0}회, 조퇴{" "}
          {counts.EARLY_LEAVE || 0}회
        </span>
      </section>
      <ul className="w8-list">
        {state.attendanceRecords.map((record) => {
          const session = state.attendanceSessions.find(
            (item) => item.sessionId === record.sessionId,
          );
          return (
            <li key={record.recordId} className="w8-list__row">
              <span className="w8-list__copy">
                <strong>
                  {session?.date || "날짜 미정"} {session?.period || ""}
                </strong>
                <span>{record.reason || "등록된 사유가 없습니다."}</span>
                {record.corrected && <span>정정된 기록</span>}
              </span>
              <W8StatusBadge value={record.attendanceStatus} />
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const StudentCommunication: React.FC<{
  state: W8DomainState;
  selectedId: string;
  busy: string;
  onSelect: (id: string) => void;
  onAcknowledge: (notice: W8Notice) => void;
  onAcknowledgeAll: () => void;
}> = ({
  state,
  selectedId,
  busy,
  onSelect,
  onAcknowledge,
  onAcknowledgeAll,
}) => {
  const selected =
    state.notices.find((notice) => notice.noticeId === selectedId) || null;
  const unreadCount = state.notices.filter(
    (notice) => !notice.acknowledged,
  ).length;
  if (selected) {
    return (
      <article className="w8-detail" aria-labelledby="w8-notice-detail">
        <button
          type="button"
          className="w8-button w8-button--secondary w8-detail__back"
          onClick={() => onSelect("")}
        >
          공지 목록으로
        </button>
        <div className="w8-detail__heading">
          <div>
            <h2 id="w8-notice-detail">{selected.title}</h2>
            <p>{formatW8DateTime(selected.publishAt)}</p>
          </div>
          <W8StatusBadge value={selected.priority} />
        </div>
        <div className="w8-reading-content">{selected.content}</div>
        {!state.readOnly && !selected.acknowledged && (
          <button
            type="button"
            className="w8-button"
            disabled={busy === `notice:${selected.noticeId}`}
            onClick={() => onAcknowledge(selected)}
          >
            {busy === `notice:${selected.noticeId}` ? "처리 중" : "확인"}
          </button>
        )}
      </article>
    );
  }
  return (
    <div className="w8-stack">
      <section className="w8-summary-strip" aria-label="공지 확인 상태">
        <strong>확인하지 않은 공지 {unreadCount}개</strong>
        {!state.readOnly && unreadCount > 0 && (
          <button
            type="button"
            className="w8-button w8-button--secondary"
            disabled={busy === "notice:all"}
            onClick={onAcknowledgeAll}
          >
            {busy === "notice:all" ? "처리 중" : "모두 확인"}
          </button>
        )}
      </section>
      <ul className="w8-list">
        {state.notices.map((notice) => (
          <li key={notice.noticeId}>
            <button
              type="button"
              className="w8-list__button"
              onClick={() => onSelect(notice.noticeId)}
            >
              <span className="w8-list__copy">
                <strong>{notice.title}</strong>
                <span>{formatW8DateTime(notice.publishAt)}</span>
                <span>{notice.acknowledged ? "확인함" : "확인 필요"}</span>
              </span>
              <W8StatusBadge value={notice.priority} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default W8StudentHub;
