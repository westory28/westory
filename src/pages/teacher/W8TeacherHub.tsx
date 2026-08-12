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
  closeAttendanceSession,
  correctAttendanceRecord,
  createAttendanceSession,
  createLearningContent,
  createNotice,
  createScheduleEvent,
  deleteScheduleEvent,
  formatW8DateTime,
  getW8KstDateKey,
  getW8DomainState,
  grantLearningExemptions,
  recordAttendance,
  recordAttendanceBulk,
  resetLearningProgress,
  reviewLearningExemptionRequest,
  revokeLearningExemptions,
  toW8ServerDateTime,
  toW8StatePanelState,
  toW8LocalDateTimeInput,
  transitionLearningContent,
  transitionNotice,
  updateLearningContent,
  updateNotice,
  updateScheduleEvent,
  type AttendanceStatus,
  type LearningContentStatus,
  type NoticeStatus,
  type W8AttendanceRecord,
  type W8Domain,
  type W8DomainState,
  type W8LearningContent,
  type W8Notice,
  type W8ScheduleEvent,
} from "../../lib/w8Domains";
import "../w8Domains.css";

const domainForPath = (pathname: string): W8Domain => {
  if (pathname.includes("/schedule")) return "SCHEDULE";
  if (pathname.includes("/attendance")) return "ATTENDANCE";
  if (pathname.includes("/communication")) return "COMMUNICATION";
  return "LEARNING";
};

const W8TeacherHub: React.FC = () => {
  const location = useLocation();
  const { config, configReady } = useAuth();
  const [params, setParams] = useSearchParams();
  const domain = domainForPath(location.pathname);
  const selectedId = String(params.get("id") || "").trim();
  const semesterId = String(params.get("semesterId") || "").trim();
  const requestedSource = String(params.get("source") || "").toUpperCase();
  const classId = String(params.get("classId") || "").trim();
  const [state, setState] = useState<W8DomainState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<W8DomainError | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    if (!configReady) return;
    setLoading(true);
    setError(null);
    try {
      setState(
        await getW8DomainState({
          config,
          domain,
          audience: "teacher",
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
          ...(classId ? { classId } : {}),
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof W8DomainError
          ? caught
          : new W8DomainError("UNKNOWN", "운영 자료를 불러오지 못했습니다."),
      );
    } finally {
      setLoading(false);
    }
  }, [
    classId,
    config,
    configReady,
    domain,
    requestedSource,
    selectedId,
    semesterId,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const select = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set("id", id);
    else next.delete("id");
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
    <section
      className="w8-domain-page w8-domain-page--teacher"
      aria-labelledby="w8-teacher-title"
    >
      <header className="w8-domain-page__header">
        <div>
          <h1 id="w8-teacher-title">
            {domain === "LEARNING"
              ? "학습 운영"
              : domain === "SCHEDULE"
                ? "일정 운영"
                : domain === "ATTENDANCE"
                  ? "출석 운영"
                  : "공지 운영"}
          </h1>
          <p>
            {domain === "LEARNING"
              ? "학습 자료를 준비하고 공개 상태와 진행 현황을 확인합니다."
              : domain === "SCHEDULE"
                ? "일정 편집은 이 화면에서만 처리하고 업무 홈에는 요약만 제공합니다."
                : domain === "ATTENDANCE"
                  ? "수업별 출석을 입력하고 정정 이력을 보존합니다."
                  : "대상을 지정해 공지를 공개하고 전달 상태를 확인합니다."}
          </p>
          <span className="w8-semester-label">{state.semesterId} 학기</span>
        </div>
        <ProvenanceBadge value={state.provenance} readOnly={state.readOnly} />
      </header>
      <W8DomainNavigation audience="teacher" />
      {error && (
        <StatePanel
          state={toW8StatePanelState(error)}
          compact
          description={error.message}
          action={{ label: "새로고침", onClick: () => void load() }}
        />
      )}
      <W8ReadOnlyState state={state} />
      {domain === "LEARNING" ? (
        <TeacherLearning
          state={state}
          selectedId={selectedId}
          busy={busy}
          onSelect={select}
          onPerform={perform}
        />
      ) : domain === "SCHEDULE" ? (
        <TeacherSchedule
          state={state}
          selectedId={selectedId}
          busy={busy}
          onSelect={select}
          onPerform={perform}
        />
      ) : domain === "ATTENDANCE" ? (
        <TeacherAttendance
          state={state}
          selectedId={selectedId}
          busy={busy}
          onSelect={select}
          onPerform={perform}
        />
      ) : (
        <TeacherCommunication
          state={state}
          selectedId={selectedId}
          busy={busy}
          onSelect={select}
          onPerform={perform}
        />
      )}
    </section>
  );
};

type Perform = (
  key: string,
  operation: () => Promise<unknown>,
) => Promise<void>;

const TeacherLearning: React.FC<{
  state: W8DomainState;
  selectedId: string;
  busy: string;
  onSelect: (id: string) => void;
  onPerform: Perform;
}> = ({ state, selectedId, busy, onSelect, onPerform }) => {
  const selected = state.learningContents.find(
    (content) => content.contentId === selectedId,
  );
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [resourceUrl, setResourceUrl] = useState("");
  const [classIds, setClassIds] = useState("");
  const [availableFrom, setAvailableFrom] = useState("");
  const [availableUntil, setAvailableUntil] = useState("");
  const [studentUid, setStudentUid] = useState("");
  const [enrollmentId, setEnrollmentId] = useState("");
  const [operationReason, setOperationReason] = useState("");
  useEffect(() => {
    setTitle(selected?.title || "");
    setSummary(selected?.summary || "");
    setBody(selected?.body || "");
    setResourceUrl(selected?.resourceUrl || "");
    setClassIds(selected?.classIds.join(", ") || "");
    setAvailableFrom(toW8LocalDateTimeInput(selected?.availableFrom || ""));
    setAvailableUntil(toW8LocalDateTimeInput(selected?.availableUntil || ""));
  }, [selected]);

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const input = {
      semesterId: state.semesterId,
      expectedSemesterRevision: state.manifestRevision,
      title,
      summary,
      body,
      resourceUrl,
      contentType: selected?.contentType || "LESSON",
      audienceRoles: ["student"],
      targetClassIds: classIds
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      availableFrom: toW8ServerDateTime(availableFrom),
      availableUntil: toW8ServerDateTime(availableUntil),
    };
    void onPerform("learning:save", () =>
      selected
        ? updateLearningContent({
            ...input,
            contentId: selected.contentId,
            expectedContentRevision: selected.revision,
          })
        : createLearningContent(input),
    );
  };

  const transition = (
    content: W8LearningContent,
    targetStatus: Extract<
      LearningContentStatus,
      "READY" | "PUBLISHED" | "CLOSED" | "ARCHIVED"
    >,
  ) =>
    onPerform(`learning:${targetStatus}`, () =>
      transitionLearningContent({
        semesterId: state.semesterId,
        expectedSemesterRevision: state.manifestRevision,
        contentId: content.contentId,
        expectedContentRevision: content.revision,
        targetStatus,
        reason: `학습 콘텐츠를 ${targetStatus} 상태로 전환`,
      }),
    );
  const editable =
    !state.readOnly &&
    (!selected || ["DRAFT", "READY"].includes(selected.status));
  const selectedProgress = state.learningProgress.find(
    (progress) =>
      progress.contentId === selected?.contentId &&
      progress.studentUid === studentUid.trim(),
  );
  const activeExemptions = state.exemptions.filter(
    (exemption) =>
      exemption.contentId === selected?.contentId &&
      exemption.status === "ACTIVE",
  );
  const pendingRequests = state.exemptionRequests.filter(
    (request) => request.status === "PENDING",
  );

  return (
    <div className="w8-workspace">
      <section className="w8-panel" aria-labelledby="learning-list-title">
        <div className="w8-panel__heading">
          <h2 id="learning-list-title">학습 콘텐츠</h2>
          <button
            type="button"
            className="w8-button w8-button--secondary"
            onClick={() => onSelect("")}
          >
            새 콘텐츠
          </button>
        </div>
        {state.learningContents.length === 0 ? (
          <StatePanel state="EMPTY" compact />
        ) : (
          <ul className="w8-list">
            {state.learningContents.map((content) => (
              <li key={content.contentId}>
                <button
                  type="button"
                  className="w8-list__button"
                  aria-current={selected?.contentId === content.contentId}
                  onClick={() => onSelect(content.contentId)}
                >
                  <span className="w8-list__copy">
                    <strong>{content.title}</strong>
                    <span>수정 {content.revision}</span>
                  </span>
                  <W8StatusBadge value={content.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <form className="w8-panel w8-form" onSubmit={save}>
        <div className="w8-panel__heading">
          <h2>{selected ? "학습 수정" : "학습 생성"}</h2>
          {selected && <W8StatusBadge value={selected.status} />}
        </div>
        <label>
          제목
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            disabled={!editable}
          />
        </label>
        <label>
          카드 요약
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            required
            disabled={!editable}
          />
        </label>
        <label>
          학습 본문
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            required
            disabled={!editable}
          />
        </label>
        <label>
          참고 자료 주소
          <input
            type="url"
            value={resourceUrl}
            onChange={(event) => setResourceUrl(event.target.value)}
            placeholder="https://"
            disabled={!editable}
          />
        </label>
        <label>
          대상 학급 ID
          <input
            value={classIds}
            onChange={(event) => setClassIds(event.target.value)}
            aria-describedby="learning-class-help"
            disabled={!editable}
          />
        </label>
        <p id="learning-class-help" className="w8-help">
          여러 학급은 쉼표로 구분합니다.
        </p>
        <div className="w8-form__row">
          <label>
            공개 시작
            <input
              type="datetime-local"
              value={availableFrom}
              onChange={(event) => setAvailableFrom(event.target.value)}
              disabled={!editable}
            />
          </label>
          <label>
            공개 종료
            <input
              type="datetime-local"
              value={availableUntil}
              onChange={(event) => setAvailableUntil(event.target.value)}
              disabled={!editable}
            />
          </label>
        </div>
        {editable && (
          <div className="w8-actions">
            <button className="w8-button" disabled={busy === "learning:save"}>
              {busy === "learning:save"
                ? "저장 중"
                : selected
                  ? "변경 저장"
                  : "작성 시작"}
            </button>
          </div>
        )}
        {!state.readOnly && selected && (
          <div className="w8-actions w8-actions--bordered">
            {selected.status === "DRAFT" && (
              <button
                type="button"
                className="w8-button w8-button--secondary"
                onClick={() => void transition(selected, "READY")}
              >
                공개 준비
              </button>
            )}
            {selected.status === "READY" && (
              <button
                type="button"
                className="w8-button"
                onClick={() => void transition(selected, "PUBLISHED")}
              >
                학생에게 공개
              </button>
            )}
            {selected.status === "READY" && (
              <button
                type="button"
                className="w8-button w8-button--danger"
                onClick={() => void transition(selected, "ARCHIVED")}
              >
                보관
              </button>
            )}
            {selected.status === "PUBLISHED" && (
              <button
                type="button"
                className="w8-button w8-button--secondary"
                onClick={() => void transition(selected, "CLOSED")}
              >
                공개 종료
              </button>
            )}
            {selected.status === "CLOSED" && (
              <button
                type="button"
                className="w8-button w8-button--danger"
                onClick={() => void transition(selected, "ARCHIVED")}
              >
                보관
              </button>
            )}
          </div>
        )}
        {selected && !state.readOnly && (
          <section className="w8-stack" aria-labelledby="learning-student-ops">
            <div className="w8-panel__heading">
              <h3 id="learning-student-ops">학생별 학습 운영</h3>
            </div>
            <label>
              학생 UID
              <input
                value={studentUid}
                onChange={(event) => setStudentUid(event.target.value)}
              />
            </label>
            <label>
              Enrollment ID
              <input
                value={enrollmentId}
                onChange={(event) => setEnrollmentId(event.target.value)}
              />
            </label>
            <label>
              처리 사유
              <textarea
                value={operationReason}
                onChange={(event) => setOperationReason(event.target.value)}
                required
              />
            </label>
            <div className="w8-actions">
              <button
                type="button"
                className="w8-button w8-button--secondary"
                disabled={!enrollmentId.trim() || !operationReason.trim()}
                onClick={() =>
                  void onPerform("learning:grant-exemption", () =>
                    grantLearningExemptions({
                      semesterId: state.semesterId,
                      expectedSemesterRevision: state.manifestRevision,
                      contentId: selected.contentId,
                      expectedContentRevision: selected.revision,
                      enrollmentIds: [enrollmentId.trim()],
                      reason: operationReason.trim(),
                    }),
                  )
                }
              >
                면제 부여
              </button>
              <button
                type="button"
                className="w8-button w8-button--secondary"
                disabled={!selectedProgress || !operationReason.trim()}
                onClick={() =>
                  selectedProgress &&
                  void onPerform("learning:reset-progress", () =>
                    resetLearningProgress({
                      semesterId: state.semesterId,
                      expectedSemesterRevision: state.manifestRevision,
                      studentUid: selectedProgress.studentUid,
                      enrollmentId: selectedProgress.enrollmentId,
                      entries: [
                        {
                          contentId: selected.contentId,
                          expectedProgressRevision: selectedProgress.revision,
                        },
                      ],
                      reason: operationReason.trim(),
                    }),
                  )
                }
              >
                진행 상태 초기화
              </button>
            </div>
            {activeExemptions.length > 0 && (
              <ul className="w8-list" aria-label="활성 학습 면제">
                {activeExemptions.map((exemption) => (
                  <li key={exemption.exemptionId} className="w8-list__row">
                    <span className="w8-list__copy">
                      <strong>{exemption.studentUid}</strong>
                      <span>{exemption.reason}</span>
                    </span>
                    <button
                      type="button"
                      className="w8-button w8-button--secondary"
                      disabled={!operationReason.trim()}
                      onClick={() =>
                        void onPerform("learning:revoke-exemption", () =>
                          revokeLearningExemptions({
                            semesterId: state.semesterId,
                            expectedSemesterRevision: state.manifestRevision,
                            items: [
                              {
                                exemptionId: exemption.exemptionId,
                                expectedExemptionRevision: exemption.revision,
                              },
                            ],
                            reason: operationReason.trim(),
                          }),
                        )
                      }
                    >
                      면제 회수
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {pendingRequests.length > 0 && (
              <ul className="w8-list" aria-label="면제 요청 대기 목록">
                {pendingRequests.map((request) => (
                  <li key={request.requestId} className="w8-list__row">
                    <span className="w8-list__copy">
                      <strong>{request.studentUid}</strong>
                      <span>{request.reason}</span>
                    </span>
                    <div className="w8-actions">
                      {(["APPROVE", "REJECT"] as const).map((action) => (
                        <button
                          key={action}
                          type="button"
                          className="w8-button w8-button--secondary"
                          disabled={!operationReason.trim()}
                          onClick={() =>
                            void onPerform(
                              `learning:review:${request.requestId}`,
                              () =>
                                reviewLearningExemptionRequest({
                                  semesterId: state.semesterId,
                                  expectedSemesterRevision:
                                    state.manifestRevision,
                                  requestId: request.requestId,
                                  expectedRequestRevision: request.revision,
                                  action,
                                  reason: operationReason.trim(),
                                }),
                            )
                          }
                        >
                          {action === "APPROVE" ? "승인" : "반려"}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </form>
    </div>
  );
};

const TeacherSchedule: React.FC<{
  state: W8DomainState;
  selectedId: string;
  busy: string;
  onSelect: (id: string) => void;
  onPerform: Perform;
}> = ({ state, selectedId, busy, onSelect, onPerform }) => {
  const selected = state.scheduleEvents.find(
    (event) => event.eventId === selectedId,
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [classIds, setClassIds] = useState("");
  const [targetUserIds, setTargetUserIds] = useState("");
  useEffect(() => {
    setTitle(selected?.title || "");
    setDescription(selected?.description || "");
    setStartAt(toW8LocalDateTimeInput(selected?.startAt || ""));
    setEndAt(toW8LocalDateTimeInput(selected?.endAt || ""));
    setClassIds(selected?.classIds.join(", ") || "");
    setTargetUserIds(selected?.targetUserIds.join(", ") || "");
  }, [selected]);
  const systemProjection = Boolean(
    selected && selected.sourceDomain !== "USER",
  );
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const input = {
      semesterId: state.semesterId,
      expectedSemesterRevision: state.manifestRevision,
      eventType: selected?.eventType || "SCHOOL",
      title,
      description,
      startAt: toW8ServerDateTime(startAt),
      endAt: toW8ServerDateTime(endAt),
      allDay: false,
      period: selected?.period || "",
      targetClassIds: classIds
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      targetUserIds: targetUserIds
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      sourceDomain: "USER",
      sourceReference:
        selected?.sourceReference || `teacher:${title}:${startAt}`,
    };
    void onPerform("schedule:save", () =>
      selected
        ? updateScheduleEvent({
            ...input,
            eventId: selected.eventId,
            expectedEventRevision: selected.revision,
          })
        : createScheduleEvent(input),
    );
  };
  const remove = (item: W8ScheduleEvent) =>
    onPerform("schedule:delete", () =>
      deleteScheduleEvent({
        semesterId: state.semesterId,
        expectedSemesterRevision: state.manifestRevision,
        eventId: item.eventId,
        expectedEventRevision: item.revision,
        reason: "교사가 일정 보관을 명시적으로 선택함",
      }),
    );
  return (
    <div className="w8-workspace">
      <section className="w8-panel">
        <div className="w8-panel__heading">
          <h2>일정 목록</h2>
          <button
            type="button"
            className="w8-button w8-button--secondary"
            onClick={() => onSelect("")}
          >
            새 일정
          </button>
        </div>
        <ul className="w8-list">
          {state.scheduleEvents.map((item) => (
            <li key={item.eventId}>
              <button
                type="button"
                className="w8-list__button"
                aria-current={selected?.eventId === item.eventId}
                onClick={() => onSelect(item.eventId)}
              >
                <span className="w8-list__copy">
                  <strong>{item.title}</strong>
                  <span>{formatW8DateTime(item.startAt)}</span>
                  <span>{item.sourceDomain} 출처</span>
                </span>
                <W8StatusBadge value={item.status} />
              </button>
            </li>
          ))}
        </ul>
      </section>
      <form className="w8-panel w8-form" onSubmit={save}>
        <div className="w8-panel__heading">
          <h2>{selected ? "일정 수정" : "일정 생성"}</h2>
        </div>
        <label>
          제목
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            disabled={state.readOnly || systemProjection}
          />
        </label>
        <label>
          설명
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={state.readOnly || systemProjection}
          />
        </label>
        <div className="w8-form__row">
          <label>
            시작
            <input
              type="datetime-local"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
              required
              disabled={state.readOnly || systemProjection}
            />
          </label>
          <label>
            종료
            <input
              type="datetime-local"
              value={endAt}
              onChange={(event) => setEndAt(event.target.value)}
              required
              disabled={state.readOnly || systemProjection}
            />
          </label>
        </div>
        <label>
          대상 학급 ID
          <input
            value={classIds}
            onChange={(event) => setClassIds(event.target.value)}
            disabled={state.readOnly || systemProjection}
          />
        </label>
        <label>
          대상 학생 UID
          <input
            value={targetUserIds}
            onChange={(event) => setTargetUserIds(event.target.value)}
            aria-describedby="schedule-user-help"
            disabled={state.readOnly || systemProjection}
          />
        </label>
        <p id="schedule-user-help" className="w8-help">
          개별 학생 대상은 쉼표로 구분합니다.
        </p>
        {systemProjection && (
          <p className="w8-help" role="status">
            다른 영역에서 만든 일정은 출처 영역에서 수정해 주세요.
          </p>
        )}
        {!state.readOnly && !systemProjection && (
          <div className="w8-actions">
            <button className="w8-button" disabled={busy === "schedule:save"}>
              {busy === "schedule:save" ? "저장 중" : "일정 저장"}
            </button>
            {selected && (
              <button
                type="button"
                className="w8-button w8-button--danger"
                onClick={() => void remove(selected)}
              >
                일정 보관
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  );
};

const ATTENDANCE_OPTIONS: Array<{
  value: Exclude<AttendanceStatus, "UNRECORDED">;
  label: string;
}> = [
  { value: "PRESENT", label: "출석" },
  { value: "LATE", label: "지각" },
  { value: "ABSENT", label: "결석" },
  { value: "EARLY_LEAVE", label: "조퇴" },
  { value: "EXCUSED", label: "인정" },
];

const TeacherAttendance: React.FC<{
  state: W8DomainState;
  selectedId: string;
  busy: string;
  onSelect: (id: string) => void;
  onPerform: Perform;
}> = ({ state, selectedId, busy, onSelect, onPerform }) => {
  const selected =
    state.attendanceSessions.find(
      (session) => session.sessionId === selectedId,
    ) || state.attendanceSessions[0];
  const [classId, setClassId] = useState("");
  const [date, setDate] = useState(getW8KstDateKey);
  const [period, setPeriod] = useState("1교시");
  const records = state.attendanceRecords.filter(
    (record) => !selected || record.sessionId === selected.sessionId,
  );
  const create = (event: React.FormEvent) => {
    event.preventDefault();
    void onPerform("attendance:create", () =>
      createAttendanceSession({
        semesterId: state.semesterId,
        expectedSemesterRevision: state.manifestRevision,
        classId,
        date,
        period,
        sourceEventId: "",
        expectedSourceEventRevision: null,
      }),
    );
  };
  const saveRecord = (
    record: W8AttendanceRecord,
    attendanceStatus: Exclude<AttendanceStatus, "UNRECORDED">,
  ) => {
    if (!selected) return Promise.resolve();
    return onPerform(`attendance:${record.studentUid}`, () =>
      record.recordId
        ? correctAttendanceRecord({
            semesterId: state.semesterId,
            expectedSemesterRevision: state.manifestRevision,
            recordId: record.recordId,
            expectedRecordRevision: record.revision,
            attendanceStatus,
            reason: "교사가 출석 상태를 확인하고 정정함",
          })
        : recordAttendance({
            semesterId: state.semesterId,
            expectedSemesterRevision: state.manifestRevision,
            sessionId: selected.sessionId,
            expectedSessionRevision: selected.revision,
            studentUid: record.studentUid,
            enrollmentId: record.enrollmentId,
            expectedRecordRevision: null,
            attendanceStatus,
            reason: "교사가 출석 상태를 입력함",
          }),
    );
  };
  const markUnrecordedPresent = () => {
    if (!selected) return Promise.resolve();
    const entries = records
      .filter((record) => record.attendanceStatus === "UNRECORDED")
      .map((record) => ({
        studentUid: record.studentUid,
        enrollmentId: record.enrollmentId,
        expectedRecordRevision: null,
        attendanceStatus: "PRESENT" as const,
        reason: "교사가 미입력 학생을 확인 후 출석으로 일괄 입력함",
      }));
    return onPerform("attendance:bulk", () =>
      recordAttendanceBulk({
        semesterId: state.semesterId,
        expectedSemesterRevision: state.manifestRevision,
        sessionId: selected.sessionId,
        expectedSessionRevision: selected.revision,
        entries,
        reason: "미입력 학생 출석 일괄 입력",
      }),
    );
  };
  return (
    <div className="w8-stack">
      <form className="w8-panel w8-form w8-form--inline" onSubmit={create}>
        <label>
          학급 ID
          <input
            value={classId}
            onChange={(event) => setClassId(event.target.value)}
            required
            disabled={state.readOnly}
          />
        </label>
        <label>
          날짜
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
            disabled={state.readOnly}
          />
        </label>
        <label>
          교시
          <input
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            required
            disabled={state.readOnly}
          />
        </label>
        {!state.readOnly && (
          <button className="w8-button" disabled={busy === "attendance:create"}>
            출석부 열기
          </button>
        )}
      </form>
      <div className="w8-attendance-layout">
        <nav className="w8-panel w8-session-list" aria-label="출석부 목록">
          {state.attendanceSessions.map((session) => (
            <button
              key={session.sessionId}
              type="button"
              aria-current={selected?.sessionId === session.sessionId}
              onClick={() => onSelect(session.sessionId)}
            >
              <span>
                <strong>
                  {session.date} {session.period}
                </strong>
                <span>{session.className || session.classId}</span>
              </span>
              <W8StatusBadge value={session.status} />
            </button>
          ))}
        </nav>
        <section className="w8-panel">
          <div className="w8-panel__heading">
            <h2>
              {selected
                ? `${selected.date} ${selected.period}`
                : "출석부를 선택해 주세요"}
            </h2>
            {selected && !state.readOnly && selected.status === "OPEN" && (
              <div className="w8-actions">
                <button
                  type="button"
                  className="w8-button w8-button--secondary"
                  onClick={() => void markUnrecordedPresent()}
                >
                  미입력 학생을 출석으로 일괄 기록
                </button>
                <button
                  type="button"
                  className="w8-button"
                  onClick={() =>
                    void onPerform("attendance:close", () =>
                      closeAttendanceSession({
                        semesterId: state.semesterId,
                        expectedSemesterRevision: state.manifestRevision,
                        sessionId: selected.sessionId,
                        expectedSessionRevision: selected.revision,
                      }),
                    )
                  }
                >
                  출석부 마감
                </button>
              </div>
            )}
          </div>
          {selected && !state.readOnly && selected.status === "OPEN" && (
            <p className="w8-help">
              버튼을 누르기 전에는 미입력 학생의 출석 기록이 생성되지 않습니다.
            </p>
          )}
          <ul className="w8-attendance-list">
            {records.map((record) => (
              <li key={record.studentUid}>
                <div>
                  <strong>{record.studentName}</strong>
                  <span>
                    {record.corrected
                      ? "정정 기록 있음"
                      : record.reason || "미입력"}
                  </span>
                </div>
                <label>
                  <span className="w8-visually-hidden">
                    {record.studentName} 출석 상태
                  </span>
                  <select
                    value={
                      record.attendanceStatus === "UNRECORDED"
                        ? ""
                        : record.attendanceStatus
                    }
                    disabled={
                      state.readOnly ||
                      (!record.recordId && selected?.status !== "OPEN") ||
                      busy === `attendance:${record.studentUid}`
                    }
                    onChange={(event) =>
                      void saveRecord(
                        record,
                        event.target.value as Exclude<
                          AttendanceStatus,
                          "UNRECORDED"
                        >,
                      )
                    }
                  >
                    <option value="">미입력</option>
                    {ATTENDANCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
};

const TeacherCommunication: React.FC<{
  state: W8DomainState;
  selectedId: string;
  busy: string;
  onSelect: (id: string) => void;
  onPerform: Perform;
}> = ({ state, selectedId, busy, onSelect, onPerform }) => {
  const selected = state.notices.find(
    (notice) => notice.noticeId === selectedId,
  );
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [classIds, setClassIds] = useState("");
  const [targetUserIds, setTargetUserIds] = useState("");
  const [publishAt, setPublishAt] = useState("");
  const [expireAt, setExpireAt] = useState("");
  const [priority, setPriority] = useState<"NORMAL" | "HIGH">("NORMAL");
  useEffect(() => {
    setTitle(selected?.title || "");
    setContent(selected?.content || "");
    setClassIds(selected?.classIds.join(", ") || "");
    setTargetUserIds(selected?.targetUserIds.join(", ") || "");
    setPublishAt(toW8LocalDateTimeInput(selected?.publishAt || ""));
    setExpireAt(toW8LocalDateTimeInput(selected?.expireAt || ""));
    setPriority(selected?.priority || "NORMAL");
  }, [selected]);
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const input = {
      semesterId: state.semesterId,
      expectedSemesterRevision: state.manifestRevision,
      title,
      content,
      targetRoles: ["student"],
      targetClassIds: classIds
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      targetUserIds: targetUserIds
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      publishAt: toW8ServerDateTime(publishAt),
      expireAt: toW8ServerDateTime(expireAt),
      priority,
    };
    void onPerform("notice:save", () =>
      selected
        ? updateNotice({
            ...input,
            noticeId: selected.noticeId,
            expectedNoticeRevision: selected.revision,
          })
        : createNotice(input),
    );
  };
  const transition = (
    notice: W8Notice,
    targetStatus: Extract<
      NoticeStatus,
      "SCHEDULED" | "PUBLISHED" | "EXPIRED" | "ARCHIVED"
    >,
  ) =>
    onPerform(`notice:${targetStatus}`, () =>
      transitionNotice({
        semesterId: state.semesterId,
        expectedSemesterRevision: state.manifestRevision,
        noticeId: notice.noticeId,
        expectedNoticeRevision: notice.revision,
        targetStatus,
      }),
    );
  const editable =
    !state.readOnly && (!selected || selected.status === "DRAFT");
  return (
    <div className="w8-workspace">
      <section className="w8-panel">
        <div className="w8-panel__heading">
          <h2>공지 목록</h2>
          <button
            type="button"
            className="w8-button w8-button--secondary"
            onClick={() => onSelect("")}
          >
            새 공지
          </button>
        </div>
        <ul className="w8-list">
          {state.notices.map((notice) => (
            <li key={notice.noticeId}>
              <button
                type="button"
                className="w8-list__button"
                aria-current={selected?.noticeId === notice.noticeId}
                onClick={() => onSelect(notice.noticeId)}
              >
                <span className="w8-list__copy">
                  <strong>{notice.title}</strong>
                  <span>{formatW8DateTime(notice.publishAt)}</span>
                </span>
                <W8StatusBadge value={notice.status} />
              </button>
            </li>
          ))}
        </ul>
      </section>
      <form className="w8-panel w8-form" onSubmit={save}>
        <div className="w8-panel__heading">
          <h2>{selected ? "공지 수정" : "공지 생성"}</h2>
          {selected && <W8StatusBadge value={selected.status} />}
        </div>
        <label>
          제목
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            disabled={!editable}
          />
        </label>
        <label>
          내용
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            required
            disabled={!editable}
          />
        </label>
        <label>
          대상 학급 ID
          <input
            value={classIds}
            onChange={(event) => setClassIds(event.target.value)}
            disabled={!editable}
          />
        </label>
        <label>
          대상 학생 UID
          <input
            value={targetUserIds}
            onChange={(event) => setTargetUserIds(event.target.value)}
            aria-describedby="notice-user-help"
            disabled={!editable}
          />
        </label>
        <p id="notice-user-help" className="w8-help">
          개별 학생 대상은 쉼표로 구분합니다. 학급과 학생을 함께 입력하면 두
          조건을 모두 충족하는 학생에게만 전달됩니다. 둘 다 비우면 현재 학기
          전체 학생이 대상입니다.
        </p>
        <div className="w8-form__row">
          <label>
            공개 시각
            <input
              type="datetime-local"
              value={publishAt}
              onChange={(event) => setPublishAt(event.target.value)}
              disabled={!editable}
            />
          </label>
          <label>
            종료 시각
            <input
              type="datetime-local"
              value={expireAt}
              onChange={(event) => setExpireAt(event.target.value)}
              disabled={!editable}
            />
          </label>
        </div>
        <label>
          우선순위
          <select
            value={priority}
            onChange={(event) =>
              setPriority(event.target.value as "NORMAL" | "HIGH")
            }
            disabled={!editable}
          >
            <option value="NORMAL">일반</option>
            <option value="HIGH">중요</option>
          </select>
        </label>
        {editable && (
          <div className="w8-actions">
            <button className="w8-button" disabled={busy === "notice:save"}>
              공지 저장
            </button>
          </div>
        )}
        {!state.readOnly && selected && (
          <div className="w8-actions w8-actions--bordered">
            {selected.status === "DRAFT" && (
              <button
                type="button"
                className="w8-button w8-button--secondary"
                onClick={() => void transition(selected, "SCHEDULED")}
              >
                예약 상태로 저장
              </button>
            )}
            {["DRAFT", "SCHEDULED"].includes(selected.status) && (
              <button
                type="button"
                className="w8-button"
                onClick={() => void transition(selected, "PUBLISHED")}
              >
                지금 공개
              </button>
            )}
            {selected?.status === "PUBLISHED" && (
              <button
                type="button"
                className="w8-button w8-button--secondary"
                onClick={() => void transition(selected, "EXPIRED")}
              >
                공개 종료
              </button>
            )}
            {selected.status === "SCHEDULED" && (
              <button
                type="button"
                className="w8-button w8-button--secondary"
                onClick={() => void transition(selected, "EXPIRED")}
              >
                예약 종료
              </button>
            )}
            {["DRAFT", "SCHEDULED", "PUBLISHED", "EXPIRED"].includes(
              selected.status,
            ) && (
              <button
                type="button"
                className="w8-button w8-button--danger"
                onClick={() => void transition(selected, "ARCHIVED")}
              >
                보관
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  );
};

export default W8TeacherHub;
