import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import ProvenanceBadge from "../../components/common/ProvenanceBadge";
import StatePanel from "../../components/common/StatePanel";
import TeacherBulkWorkflow from "../../components/common/TeacherBulkWorkflow";
import TeacherDraftRecoveryDialog from "../../components/common/TeacherDraftRecoveryDialog";
import TeacherDraftStatus from "../../components/common/TeacherDraftStatus";
import W8DomainNavigation from "../../components/common/W8DomainNavigation";
import W8ReadOnlyState from "../../components/common/W8ReadOnlyState";
import W8StatusBadge from "../../components/common/W8StatusBadge";
import { useAuth } from "../../contexts/AuthContext";
import {
  createTeacherOperationClientId,
  getTeacherOperationsState,
  hashTeacherOperationPayload,
  resumePendingTeacherBulkOperation,
  retryFailedTeacherBulkOperation,
  runTeacherBulkOperation,
  type TeacherBulkJob,
} from "../../lib/teacherOperations";
import { useTeacherDraft } from "../../lib/useTeacherDraft";
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
          <h2 id="w8-teacher-title">
            {domain === "LEARNING"
              ? "학습 운영"
              : domain === "SCHEDULE"
                ? "일정 운영"
                : domain === "ATTENDANCE"
                  ? "출석 운영"
                  : "공지 운영"}
          </h2>
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

interface LearningEditorDraft extends Record<string, unknown> {
  title: string;
  summary: string;
  body: string;
  resourceUrl: string;
  classIds: string;
  availableFrom: string;
  availableUntil: string;
}

interface ScheduleEditorDraft extends Record<string, unknown> {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  classIds: string;
  targetUserIds: string;
}

interface NoticeEditorDraft extends Record<string, unknown> {
  title: string;
  content: string;
  classIds: string;
  targetUserIds: string;
  publishAt: string;
  expireAt: string;
  priority: "NORMAL" | "HIGH";
}

const splitTargetIds = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

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
  const [newDraftId, setNewDraftId] = useState(() =>
    createTeacherOperationClientId(),
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
  const baseEditorPayload = useMemo<LearningEditorDraft>(
    () => ({
      title: selected?.title || "",
      summary: selected?.summary || "",
      body: selected?.body || "",
      resourceUrl: selected?.resourceUrl || "",
      classIds: selected?.classIds.join(", ") || "",
      availableFrom: toW8LocalDateTimeInput(selected?.availableFrom || ""),
      availableUntil: toW8LocalDateTimeInput(selected?.availableUntil || ""),
    }),
    [selected],
  );
  const editorPayload = useMemo<LearningEditorDraft>(
    () => ({
      title,
      summary,
      body,
      resourceUrl,
      classIds,
      availableFrom,
      availableUntil,
    }),
    [
      availableFrom,
      availableUntil,
      body,
      classIds,
      resourceUrl,
      summary,
      title,
    ],
  );
  const commandPayload = useMemo(
    () => ({
      semesterId: state.semesterId,
      expectedSemesterRevision: state.manifestRevision,
      title,
      summary,
      body,
      resourceUrl,
      contentType: selected?.contentType || "LESSON",
      audienceRoles: ["student"],
      targetClassIds: splitTargetIds(classIds),
      availableFrom: toW8ServerDateTime(availableFrom),
      availableUntil: toW8ServerDateTime(availableUntil),
      ...(selected
        ? {
            contentId: selected.contentId,
            expectedContentRevision: selected.revision,
          }
        : {}),
    }),
    [
      availableFrom,
      availableUntil,
      body,
      classIds,
      resourceUrl,
      selected,
      state.manifestRevision,
      state.semesterId,
      summary,
      title,
    ],
  );
  const recoverEditor = useCallback((draft: LearningEditorDraft) => {
    setTitle(String(draft.title || ""));
    setSummary(String(draft.summary || ""));
    setBody(String(draft.body || ""));
    setResourceUrl(String(draft.resourceUrl || ""));
    setClassIds(String(draft.classIds || ""));
    setAvailableFrom(String(draft.availableFrom || ""));
    setAvailableUntil(String(draft.availableUntil || ""));
  }, []);
  const draftBinding = useTeacherDraft<LearningEditorDraft>({
    semesterId: state.semesterId,
    manifestRevision: state.manifestRevision,
    source: state.source,
    enabled:
      !state.readOnly &&
      (!selected || ["DRAFT", "READY"].includes(selected.status)),
    key: {
      routeKey: "/teacher/learning",
      surfaceKey: "learning-content-editor",
      entityType: "learning-content",
      entityId: selected?.contentId || "new",
      clientDraftId: selected
        ? `${selected.contentId}-r${selected.revision}`
        : newDraftId,
    },
    baseEntityRevision: selected?.revision || null,
    basePayload: baseEditorPayload,
    payload: editorPayload,
    intendedCommandType: selected
      ? "updateLearningContent"
      : "createLearningContent",
    commandPayload,
    onRecover: recoverEditor,
  });
  const switchLearningEditor = async (id: string) => {
    try {
      await draftBinding.flush();
      if (!id) setNewDraftId(createTeacherOperationClientId());
      onSelect(id);
    } catch {
      // The hook keeps the draft and exposes the retry state. Stay on this editor.
    }
  };
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
    void onPerform("learning:save", () =>
      draftBinding
        .commit(() =>
          selected
            ? updateLearningContent(
                commandPayload as Parameters<typeof updateLearningContent>[0],
              )
            : createLearningContent(
                commandPayload as Parameters<typeof createLearningContent>[0],
              ),
        )
        .then((response) => {
          const createdId = String(response.result.contentId || "");
          if (!selected && createdId) onSelect(createdId);
          return response;
        }),
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
            onClick={() => void switchLearningEditor("")}
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
                  onClick={() => void switchLearningEditor(content.contentId)}
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
        <TeacherDraftStatus
          state={draftBinding.state}
          message={draftBinding.message}
          savedAt={draftBinding.savedAt}
          onRetry={() => void draftBinding.retry().catch(() => undefined)}
        />
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
      <TeacherDraftRecoveryDialog
        draft={draftBinding.recoveryDraft}
        onRecover={draftBinding.recover}
        onDiscard={() => void draftBinding.discard().catch(() => undefined)}
        onKeepCurrent={draftBinding.keepCurrent}
      />
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
  const [newDraftId, setNewDraftId] = useState(() =>
    createTeacherOperationClientId(),
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [classIds, setClassIds] = useState("");
  const [targetUserIds, setTargetUserIds] = useState("");
  const baseEditorPayload = useMemo<ScheduleEditorDraft>(
    () => ({
      title: selected?.title || "",
      description: selected?.description || "",
      startAt: toW8LocalDateTimeInput(selected?.startAt || ""),
      endAt: toW8LocalDateTimeInput(selected?.endAt || ""),
      classIds: selected?.classIds.join(", ") || "",
      targetUserIds: selected?.targetUserIds.join(", ") || "",
    }),
    [selected],
  );
  const editorPayload = useMemo<ScheduleEditorDraft>(
    () => ({ title, description, startAt, endAt, classIds, targetUserIds }),
    [classIds, description, endAt, startAt, targetUserIds, title],
  );
  const commandPayload = useMemo(
    () => ({
      semesterId: state.semesterId,
      expectedSemesterRevision: state.manifestRevision,
      eventType: selected?.eventType || "SCHOOL",
      title,
      description,
      startAt: toW8ServerDateTime(startAt),
      endAt: toW8ServerDateTime(endAt),
      allDay: false,
      period: selected?.period || "",
      targetClassIds: splitTargetIds(classIds),
      targetUserIds: splitTargetIds(targetUserIds),
      sourceDomain: "USER",
      sourceReference:
        selected?.sourceReference || `teacher:${title}:${startAt}`,
      ...(selected
        ? {
            eventId: selected.eventId,
            expectedEventRevision: selected.revision,
          }
        : {}),
    }),
    [
      classIds,
      description,
      endAt,
      selected,
      startAt,
      state.manifestRevision,
      state.semesterId,
      targetUserIds,
      title,
    ],
  );
  const recoverEditor = useCallback((draft: ScheduleEditorDraft) => {
    setTitle(String(draft.title || ""));
    setDescription(String(draft.description || ""));
    setStartAt(String(draft.startAt || ""));
    setEndAt(String(draft.endAt || ""));
    setClassIds(String(draft.classIds || ""));
    setTargetUserIds(String(draft.targetUserIds || ""));
  }, []);
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
  const draftBinding = useTeacherDraft<ScheduleEditorDraft>({
    semesterId: state.semesterId,
    manifestRevision: state.manifestRevision,
    source: state.source,
    enabled: !state.readOnly && !systemProjection,
    key: {
      routeKey: "/teacher/schedule",
      surfaceKey: "schedule-event-editor",
      entityType: "schedule-event",
      entityId: selected?.eventId || "new",
      clientDraftId: selected
        ? `${selected.eventId}-r${selected.revision}`
        : newDraftId,
    },
    baseEntityRevision: selected?.revision || null,
    basePayload: baseEditorPayload,
    payload: editorPayload,
    intendedCommandType: selected
      ? "updateScheduleEvent"
      : "createScheduleEvent",
    commandPayload,
    onRecover: recoverEditor,
  });
  const switchScheduleEditor = async (id: string) => {
    try {
      await draftBinding.flush();
      if (!id) setNewDraftId(createTeacherOperationClientId());
      onSelect(id);
    } catch {
      // The hook keeps the draft and exposes the retry state. Stay on this editor.
    }
  };
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    void onPerform("schedule:save", () =>
      draftBinding
        .commit(() =>
          selected
            ? updateScheduleEvent(
                commandPayload as Parameters<typeof updateScheduleEvent>[0],
              )
            : createScheduleEvent(
                commandPayload as Parameters<typeof createScheduleEvent>[0],
              ),
        )
        .then((response) => {
          const createdId = String(response.result.eventId || "");
          if (!selected && createdId) onSelect(createdId);
          return response;
        }),
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
            onClick={() => void switchScheduleEditor("")}
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
                onClick={() => void switchScheduleEditor(item.eventId)}
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
        <TeacherDraftStatus
          state={draftBinding.state}
          message={draftBinding.message}
          savedAt={draftBinding.savedAt}
          onRetry={() => void draftBinding.retry().catch(() => undefined)}
        />
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
      <TeacherDraftRecoveryDialog
        draft={draftBinding.recoveryDraft}
        onRecover={draftBinding.recover}
        onDiscard={() => void draftBinding.discard().catch(() => undefined)}
        onKeepCurrent={draftBinding.keepCurrent}
      />
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
  const { config } = useAuth();
  const selected =
    state.attendanceSessions.find(
      (session) => session.sessionId === selectedId,
    ) || state.attendanceSessions[0];
  const [classId, setClassId] = useState("");
  const [date, setDate] = useState(getW8KstDateKey);
  const [period, setPeriod] = useState("1교시");
  const [selectedBulkIds, setSelectedBulkIds] = useState<Set<string>>(
    new Set(),
  );
  const [bulkJobs, setBulkJobs] = useState<TeacherBulkJob[]>([]);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const records = state.attendanceRecords.filter(
    (record) => !selected || record.sessionId === selected.sessionId,
  );
  const unrecordedRecords = records.filter(
    (record) => record.attendanceStatus === "UNRECORDED",
  );
  const unrecordedSignature = unrecordedRecords
    .map(
      (record) =>
        `${record.studentUid}:${record.enrollmentId}:${record.revision}`,
    )
    .sort()
    .join("|");
  useEffect(() => {
    setSelectedBulkIds(
      new Set(unrecordedRecords.map((record) => record.studentUid)),
    );
  }, [selected?.sessionId, unrecordedSignature]);
  const loadBulkJobs = useCallback(async () => {
    try {
      const operations = await getTeacherOperationsState({
        config,
        semesterId: state.semesterId,
        source: state.source,
        includeTerminal: false,
      });
      setBulkJobs(
        operations.bulkJobs.filter(
          (job) =>
            job.domain === "ATTENDANCE" &&
            String(job.filter.sessionId || "") === selected?.sessionId,
        ),
      );
    } catch (error) {
      setBulkStatus(
        error instanceof Error
          ? error.message
          : "이전 일괄 작업 상태를 확인하지 못했습니다.",
      );
    }
  }, [config, selected?.sessionId, state.semesterId, state.source]);
  useEffect(() => {
    void loadBulkJobs();
  }, [loadBulkJobs]);
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
  const markSelectedPresent = async () => {
    if (!selected || selected.status !== "OPEN") return;
    const entries = unrecordedRecords
      .filter((record) => selectedBulkIds.has(record.studentUid))
      .map((record) => ({
        studentUid: record.studentUid,
        enrollmentId: record.enrollmentId,
        expectedRecordRevision: null,
        attendanceStatus: "PRESENT" as const,
        reason: "교사가 미입력 학생을 확인 후 출석으로 일괄 입력함",
      }));
    if (!entries.length) return;
    const commandPayload = {
      semesterId: state.semesterId,
      expectedSemesterRevision: state.manifestRevision,
      sessionId: selected.sessionId,
      expectedSessionRevision: selected.revision,
      entries,
      reason: "선택한 미입력 학생 출석 일괄 입력",
    };
    setBulkBusy(true);
    setBulkStatus("선택한 학생의 출석을 기록하고 있습니다.");
    try {
      const result = await runTeacherBulkOperation({
        semesterId: state.semesterId,
        expectedSemesterRevision: state.manifestRevision,
        clientBulkId: createTeacherOperationClientId(),
        domain: "ATTENDANCE",
        operationType: "미입력 학생 출석 일괄 기록",
        policy: "ALL_OR_NOTHING",
        filter: {
          sessionId: selected.sessionId,
          classId: selected.classId,
          selectedStudentUids: entries.map((entry) => entry.studentUid),
        },
        items: [
          {
            itemKey: `session:${selected.sessionId}`,
            commandType: "recordAttendanceBulk",
            commandPayload,
            commandPayloadHash:
              await hashTeacherOperationPayload(commandPayload),
          },
        ],
      });
      const counts = result.result.counts;
      setBulkStatus(
        counts
          ? `${counts.succeeded}건 완료, ${counts.failed}건 실패했습니다.`
          : "출석 일괄 기록을 마쳤습니다.",
      );
      await loadBulkJobs();
      await onPerform("attendance:bulk-refresh", () => Promise.resolve());
    } catch (error) {
      setBulkStatus(
        error instanceof Error
          ? error.message
          : "출석 일괄 기록을 마치지 못했습니다.",
      );
      await loadBulkJobs();
    } finally {
      setBulkBusy(false);
    }
  };
  const activeBulkJob =
    bulkJobs.find((job) =>
      job.items.some((item) => item.status === "PENDING"),
    ) ||
    bulkJobs.find((job) =>
      job.items.some((item) => item.status === "FAILED"),
    ) ||
    null;
  const resumeBulkJob = async (mode: "resume" | "retry") => {
    if (!activeBulkJob) return;
    setBulkBusy(true);
    setBulkStatus(
      mode === "resume"
        ? "기존 command ID로 대기 작업을 이어 실행합니다."
        : "실패한 항목만 새 command ID로 다시 실행합니다.",
    );
    try {
      const response =
        mode === "resume"
          ? await resumePendingTeacherBulkOperation({
              semesterId: state.semesterId,
              manifestRevision: state.manifestRevision,
              job: activeBulkJob,
            })
          : await retryFailedTeacherBulkOperation({
              semesterId: state.semesterId,
              manifestRevision: state.manifestRevision,
              job: activeBulkJob,
            });
      const counts = response.result.counts;
      setBulkStatus(
        counts
          ? `${counts.succeeded}건 완료, ${counts.failed}건 실패했습니다.`
          : "일괄 작업 상태를 확인했습니다.",
      );
      await loadBulkJobs();
      await onPerform("attendance:bulk-refresh", () => Promise.resolve());
    } catch (error) {
      setBulkStatus(
        error instanceof Error
          ? error.message
          : "일괄 작업을 이어 실행하지 못했습니다.",
      );
    } finally {
      setBulkBusy(false);
    }
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
            onInput={(event) => setDate(event.currentTarget.value)}
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
            <TeacherBulkWorkflow
              title="미입력 학생 출석 일괄 기록"
              description="현재 조회 목록의 미입력 학생이 기본 선택됩니다. 학급이나 출석부가 바뀌면 선택을 새로 계산하며, 선택한 학생만 하나의 원자 명령으로 기록합니다."
              rows={unrecordedRecords.map((record) => ({
                id: record.studentUid,
                label: record.studentName,
                description: record.enrollmentId,
                ...(record.enrollmentId
                  ? {}
                  : { error: "Enrollment 확인 필요" }),
              }))}
              selectedIds={selectedBulkIds}
              statusMessage={bulkStatus}
              busy={bulkBusy}
              onToggle={(studentUid) =>
                setSelectedBulkIds((current) => {
                  const next = new Set(current);
                  if (next.has(studentUid)) next.delete(studentUid);
                  else next.add(studentUid);
                  return next;
                })
              }
              onSelectAll={() =>
                setSelectedBulkIds(
                  new Set(
                    unrecordedRecords
                      .filter((record) => record.enrollmentId)
                      .map((record) => record.studentUid),
                  ),
                )
              }
              onClear={() => setSelectedBulkIds(new Set())}
              onRun={() => void markSelectedPresent()}
            />
          )}
          {activeBulkJob && (
            <div className="teacher-bulk-workflow__result" role="status">
              <strong>
                {activeBulkJob.items.some((item) => item.status === "PENDING")
                  ? "이어 실행할 일괄 작업이 있습니다."
                  : "실패한 일괄 작업이 있습니다."}
              </strong>
              <p>
                대기 작업은 기존 command ID를 사용해 결과를 복구합니다. 실패
                재실행은 실패 항목에 새 command ID를 사용합니다.
              </p>
              <button
                type="button"
                className="w8-button w8-button--secondary"
                disabled={bulkBusy}
                onClick={() =>
                  void resumeBulkJob(
                    activeBulkJob.items.some(
                      (item) => item.status === "PENDING",
                    )
                      ? "resume"
                      : "retry",
                  )
                }
              >
                {activeBulkJob.items.some((item) => item.status === "PENDING")
                  ? "대기 작업 이어 실행"
                  : "실패 항목 다시 실행"}
              </button>
            </div>
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
  const [newDraftId, setNewDraftId] = useState(() =>
    createTeacherOperationClientId(),
  );
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [classIds, setClassIds] = useState("");
  const [targetUserIds, setTargetUserIds] = useState("");
  const [publishAt, setPublishAt] = useState("");
  const [expireAt, setExpireAt] = useState("");
  const [priority, setPriority] = useState<"NORMAL" | "HIGH">("NORMAL");
  const baseEditorPayload = useMemo<NoticeEditorDraft>(
    () => ({
      title: selected?.title || "",
      content: selected?.content || "",
      classIds: selected?.classIds.join(", ") || "",
      targetUserIds: selected?.targetUserIds.join(", ") || "",
      publishAt: toW8LocalDateTimeInput(selected?.publishAt || ""),
      expireAt: toW8LocalDateTimeInput(selected?.expireAt || ""),
      priority: selected?.priority || "NORMAL",
    }),
    [selected],
  );
  const editorPayload = useMemo<NoticeEditorDraft>(
    () => ({
      title,
      content,
      classIds,
      targetUserIds,
      publishAt,
      expireAt,
      priority,
    }),
    [classIds, content, expireAt, priority, publishAt, targetUserIds, title],
  );
  const commandPayload = useMemo(
    () => ({
      semesterId: state.semesterId,
      expectedSemesterRevision: state.manifestRevision,
      title,
      content,
      targetRoles: ["student"],
      targetClassIds: splitTargetIds(classIds),
      targetUserIds: splitTargetIds(targetUserIds),
      publishAt: toW8ServerDateTime(publishAt),
      expireAt: toW8ServerDateTime(expireAt),
      priority,
      ...(selected
        ? {
            noticeId: selected.noticeId,
            expectedNoticeRevision: selected.revision,
          }
        : {}),
    }),
    [
      classIds,
      content,
      expireAt,
      priority,
      publishAt,
      selected,
      state.manifestRevision,
      state.semesterId,
      targetUserIds,
      title,
    ],
  );
  const recoverEditor = useCallback((draft: NoticeEditorDraft) => {
    setTitle(String(draft.title || ""));
    setContent(String(draft.content || ""));
    setClassIds(String(draft.classIds || ""));
    setTargetUserIds(String(draft.targetUserIds || ""));
    setPublishAt(String(draft.publishAt || ""));
    setExpireAt(String(draft.expireAt || ""));
    setPriority(draft.priority === "HIGH" ? "HIGH" : "NORMAL");
  }, []);
  useEffect(() => {
    setTitle(selected?.title || "");
    setContent(selected?.content || "");
    setClassIds(selected?.classIds.join(", ") || "");
    setTargetUserIds(selected?.targetUserIds.join(", ") || "");
    setPublishAt(toW8LocalDateTimeInput(selected?.publishAt || ""));
    setExpireAt(toW8LocalDateTimeInput(selected?.expireAt || ""));
    setPriority(selected?.priority || "NORMAL");
  }, [selected]);
  const draftBinding = useTeacherDraft<NoticeEditorDraft>({
    semesterId: state.semesterId,
    manifestRevision: state.manifestRevision,
    source: state.source,
    enabled: !state.readOnly && (!selected || selected.status === "DRAFT"),
    key: {
      routeKey: "/teacher/communication",
      surfaceKey: "notice-editor",
      entityType: "notice",
      entityId: selected?.noticeId || "new",
      clientDraftId: selected
        ? `${selected.noticeId}-r${selected.revision}`
        : newDraftId,
    },
    baseEntityRevision: selected?.revision || null,
    basePayload: baseEditorPayload,
    payload: editorPayload,
    intendedCommandType: selected ? "updateNotice" : "createNotice",
    commandPayload,
    onRecover: recoverEditor,
  });
  const switchNoticeEditor = async (id: string) => {
    try {
      await draftBinding.flush();
      if (!id) setNewDraftId(createTeacherOperationClientId());
      onSelect(id);
    } catch {
      // The hook keeps the draft and exposes the retry state. Stay on this editor.
    }
  };
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    void onPerform("notice:save", () =>
      draftBinding
        .commit(() =>
          selected
            ? updateNotice(commandPayload as Parameters<typeof updateNotice>[0])
            : createNotice(
                commandPayload as Parameters<typeof createNotice>[0],
              ),
        )
        .then((response) => {
          const createdId = String(response.result.noticeId || "");
          if (!selected && createdId) onSelect(createdId);
          return response;
        }),
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
            onClick={() => void switchNoticeEditor("")}
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
                onClick={() => void switchNoticeEditor(notice.noticeId)}
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
        <TeacherDraftStatus
          state={draftBinding.state}
          message={draftBinding.message}
          savedAt={draftBinding.savedAt}
          onRetry={() => void draftBinding.retry().catch(() => undefined)}
        />
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
      <TeacherDraftRecoveryDialog
        draft={draftBinding.recoveryDraft}
        onRecover={draftBinding.recover}
        onDiscard={() => void draftBinding.discard().catch(() => undefined)}
        onKeepCurrent={draftBinding.keepCurrent}
      />
    </div>
  );
};

export default W8TeacherHub;
