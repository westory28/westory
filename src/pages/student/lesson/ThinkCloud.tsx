import React, { useEffect, useMemo, useRef, useState } from "react";
import { getStudentMenuLabel } from "../../../constants/menus";
import PortalWorkspace from "../../../components/common/PortalWorkspace";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { InlineLoading } from "../../../components/common/LoadingState";
import { useAuth } from "../../../contexts/AuthContext";
import WordCloudView from "../../../components/common/WordCloudView";
import { notifyPointsUpdated } from "../../../lib/appEvents";
import {
  buildThinkCloudRewardSourceId,
  claimPointActivityReward,
} from "../../../lib/points";
import {
  DEFAULT_THINK_CLOUD_OPTIONS,
  formatClassLabel,
  formatGradeLabel,
  getInputValidationError,
  normalizeResponseText,
  type ThinkCloudOptions,
  type ThinkCloudResponse,
} from "../../../lib/thinkCloud";
import {
  subscribeThinkCloudState,
  submitThinkCloudResponse,
  type CanonicalThinkCloudSession as SessionWithId,
} from "../../../lib/thinkCloudLifecycle";
import "../../../components/common/portalPage.css";
import "../../../components/common/thinkCloudWorkspace.css";
import "./thinkCloud.css";

const BANNED_WORDS = ["욕설", "비속어"];

const Arrow = ({ back = false }: { back?: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d={back ? "M19 12H5m7-7-7 7 7 7" : "M5 12h14m-7-7 7 7-7 7"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ThinkCloud: React.FC = () => {
  const { config, currentUser, menuConfig } = useAuth();
  const { showToast } = useAppToast();
  const [activeSessionId, setActiveSessionId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessions, setSessions] = useState<SessionWithId[]>([]);
  const [topicsState, setTopicsState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [responseSessionId, setResponseSessionId] = useState("");
  const [view, setView] = useState<"list" | "detail">("list");
  const subscriptionRef = useRef<ReturnType<
    typeof subscribeThinkCloudState
  > | null>(null);
  const [responses, setResponses] = useState<
    Array<ThinkCloudResponse & { id: string }>
  >([]);
  const [draftInput, setDraftInput] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitLoading, setSubmitLoading] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [lastSubmission, setLastSubmission] = useState<{
    sessionId: string;
    text: string;
    id: string;
  } | null>(null);
  const submittingRef = useRef(false);
  const compositionRef = useRef(false);
  const attemptRef = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sentRef = useRef<HTMLDivElement>(null);
  const focusedSubmissionRef = useRef("");
  const topicButtons = useRef(new Map<string, HTMLButtonElement>());
  const lastOpenedRef = useRef("");
  const scopeKey = `${currentUser?.uid || ""}:${config?.year || ""}:${config?.semester || ""}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const subscriptionScopeRef = useRef("");

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) || null,
    [sessions, selectedSessionId],
  );
  const isActiveSession =
    !!selectedSession &&
    selectedSession.id === activeSessionId &&
    selectedSession.status === "active";
  const isPausedSession = selectedSession?.status === "paused";
  const options: ThinkCloudOptions =
    selectedSession?.options || DEFAULT_THINK_CLOUD_OPTIONS;
  const responsesReady =
    topicsState === "ready" && responseSessionId === selectedSessionId;
  const ownResponses = responsesReady
    ? responses.filter((item) => item.uid === currentUser?.uid)
    : [];
  const savedHere =
    lastSubmission?.sessionId === selectedSessionId ? lastSubmission : null;
  const ownResponse = ownResponses[ownResponses.length - 1];
  const hasSubmitted = !!savedHere || ownResponses.length > 0;
  const singleResponseComplete =
    !options.allowDuplicateByStudent && hasSubmitted;
  const submittedText =
    savedHere?.text ||
    ownResponse?.textRaw ||
    ownResponse?.textNormalized ||
    "";

  useEffect(() => {
    const sameScope = subscriptionScopeRef.current === scopeKey;
    subscriptionScopeRef.current = scopeKey;
    if (!sameScope) {
      attemptRef.current += 1;
      submittingRef.current = false;
      setSubmitLoading(false);
      setDraftInput("");
      setSubmitError("");
      setLastSubmission(null);
      setSelectedSessionId("");
      setResponseSessionId("");
      setSessions([]);
      setResponses([]);
      setView("list");
      setTopicsState("loading");
    }
    if (!currentUser) return;
    const subscription = subscribeThinkCloudState(
      config,
      "student",
      sameScope ? selectedSessionId : "",
      (state) => {
        setTopicsState("ready");
        setSessions(state.thinkCloudSessions);
        setResponses(state.thinkCloudResponses);
        const activeId =
          state.thinkCloudManagedClasses[0]?.activeSessionId || "";
        const responseId =
          state.thinkCloudSelectedSessionId ??
          state.thinkCloudSessions.find((session) => session.id === activeId)
            ?.id ??
          state.thinkCloudSessions[0]?.id ??
          "";
        setResponseSessionId(responseId);
        setActiveSessionId(activeId);
        setSelectedSessionId(responseId);
      },
      () => {
        setTopicsState("error");
        setSessions([]);
        setResponses([]);
        setResponseSessionId("");
        setActiveSessionId("");
      },
    );
    subscriptionRef.current = subscription;
    return () => {
      subscription();
      if (subscriptionRef.current === subscription)
        subscriptionRef.current = null;
    };
  }, [scopeKey, refreshKey]);

  useEffect(() => {
    subscriptionRef.current?.selectSession(selectedSessionId);
  }, [selectedSessionId]);
  useEffect(() => {
    if (!lastOpenedRef.current) return;
    if (view === "detail") headingRef.current?.focus({ preventScroll: true });
    else
      topicButtons.current
        .get(lastOpenedRef.current)
        ?.focus({ preventScroll: true });
  }, [view]);
  useEffect(() => {
    if (
      view !== "detail" ||
      !singleResponseComplete ||
      !savedHere?.id ||
      focusedSubmissionRef.current === savedHere.id ||
      !sentRef.current
    )
      return;
    sentRef.current.focus({ preventScroll: true });
    focusedSubmissionRef.current = savedHere.id;
  }, [savedHere?.id, singleResponseComplete, view, topicsState]);
  useEffect(
    () => () => {
      attemptRef.current += 1;
    },
    [],
  );

  const cloudEntries = useMemo(() => {
    const buckets = new Map<
      string,
      { count: number; submitters: Set<string> }
    >();
    for (const item of responses) {
      const key = item.textNormalized || "";
      if (!key) continue;
      const current = buckets.get(key) || {
        count: 0,
        submitters: new Set<string>(),
      };
      current.count += 1;
      const name = String(item.displayName || "").trim();
      if (name) current.submitters.add(name);
      buckets.set(key, current);
    }
    return Array.from(buckets.entries())
      .map(([text, info]) => ({
        text,
        count: info.count,
        submitters: Array.from(info.submitters),
      }))
      .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  }, [responses]);

  const openSession = (sessionId: string) => {
    if (submittingRef.current) return;
    if (sessionId !== selectedSessionId) {
      setDraftInput("");
      setSubmitError("");
      setResponseSessionId("");
    }
    lastOpenedRef.current = sessionId;
    setSelectedSessionId(sessionId);
    setView("detail");
  };

  const handleSubmit = async () => {
    if (submittingRef.current || compositionRef.current) return;
    if (
      !selectedSessionId ||
      !selectedSession ||
      !currentUser ||
      !responsesReady
    )
      return;
    if (!isActiveSession) {
      setSubmitError("진행 중인 주제에서만 보낼 수 있습니다.");
      return;
    }
    const validationError = getInputValidationError(draftInput, options);
    if (validationError) {
      setSubmitError(validationError);
      return;
    }
    const rawText = draftInput.trim();
    const normalizedText = normalizeResponseText(rawText, options.inputMode);
    if (!normalizedText) {
      setSubmitError("내용을 입력해 주세요.");
      return;
    }
    if (
      options.profanityFilter &&
      BANNED_WORDS.some((word) => normalizedText.includes(word))
    ) {
      setSubmitError("사용할 수 없는 단어가 포함되어 있습니다.");
      return;
    }
    if (singleResponseComplete) {
      setSubmitError("이 주제에는 이미 생각을 보냈습니다.");
      return;
    }
    if (
      !options.allowDuplicateWord &&
      responses.some((item) => item.textNormalized === normalizedText)
    ) {
      setSubmitError("이미 모인 생각입니다. 다른 생각을 적어 주세요.");
      return;
    }

    const submittingScope = scopeKey;
    const attempt = ++attemptRef.current;
    const isCurrent = () =>
      scopeRef.current === submittingScope && attemptRef.current === attempt;
    submittingRef.current = true;
    setSubmitLoading(true);
    setSubmitError("");
    try {
      const responseRef = await submitThinkCloudResponse(
        config,
        selectedSession,
        rawText,
        normalizedText,
      );
      if (!isCurrent()) return;
      setLastSubmission({
        sessionId: selectedSessionId,
        text: rawText,
        id: responseRef.responseId,
      });
      setRefreshKey((key) => key + 1);
      setDraftInput("");
      try {
        const pointResult = await claimPointActivityReward({
          config,
          activityType: "think_cloud",
          sourceId: buildThinkCloudRewardSourceId(
            selectedSessionId,
            responseRef.responseId,
          ),
          sourceLabel: selectedSession.title || "생각모아 참여",
        });
        if (!isCurrent()) return;
        if (
          pointResult.awarded &&
          (pointResult.totalAwarded || pointResult.amount)
        )
          notifyPointsUpdated();
        if ((pointResult.totalAwarded || pointResult.amount) > 0) {
          const totalAwarded = Number(
            pointResult.totalAwarded || pointResult.amount || 0,
          );
          showToast({
            tone: "success",
            title: "생각모아 참여 완료",
            message:
              pointResult.bonusAwarded && pointResult.bonusAmount
                ? `기본 +${pointResult.amount}위스, 보너스 +${pointResult.bonusAmount}위스가 반영되었습니다.`
                : `+${totalAwarded}위스가 반영되었습니다.`,
          });
        } else if (pointResult.duplicate) {
          showToast({
            tone: "info",
            title:
              pointResult.blockedMessage ||
              "이번 생각모아 위스는 이미 반영되었습니다.",
          });
        }
      } catch (pointError) {
        if (!isCurrent()) return;
        console.error("Failed to claim think cloud point reward:", pointError);
        showToast({
          tone: "warning",
          title: "생각모아 응답은 저장되었습니다.",
          message: "위스 반영 상태를 바로 확인하지 못했습니다.",
        });
      }
    } catch (error) {
      if (!isCurrent()) return;
      console.error("Failed to submit think cloud response:", error);
      setSubmitError(
        "보내지 못했습니다. 적은 내용을 확인하고 다시 보내 주세요.",
      );
    } finally {
      if (isCurrent()) {
        submittingRef.current = false;
        setSubmitLoading(false);
      }
    }
  };

  const sessionState = (session: SessionWithId) =>
    session.id === activeSessionId && session.status === "active"
      ? "active"
      : session.status === "paused"
        ? "paused"
        : "closed";
  const stateLabel = (state: string) =>
    state === "active" ? "진행 중" : state === "paused" ? "잠시 멈춤" : "종료";
  const openSessions = sessions.filter(
    (session) => sessionState(session) !== "closed",
  );
  const pastSessions = sessions.filter(
    (session) => sessionState(session) === "closed",
  );
  const renderTopic = (session: SessionWithId) => {
    const state = sessionState(session);
    return (
      <button
        key={session.id}
        ref={(node) => {
          if (node) topicButtons.current.set(session.id, node);
          else topicButtons.current.delete(session.id);
        }}
        type="button"
        className={`think-topic-row student-think-topic${state === "active" ? " is-live" : ""}`}
        onClick={() => openSession(session.id)}
        data-session-id={session.id}
      >
        <span className="student-think-topic-copy">
          <span className="think-topic-meta">
            <span className="think-status" data-state={state}>
              {stateLabel(state)}
            </span>
            <span>
              {session.options.inputMode === "word" ? "한 단어" : "짧은 문장"}
            </span>
            <span>
              {formatGradeLabel(session.targetGrade, session.targetGradeLabel)}{" "}
              {formatClassLabel(session.targetClass, session.targetClassLabel)}
            </span>
          </span>
          <span className="think-topic-title">{session.title}</span>
          {session.description && (
            <span className="student-think-topic-description">
              {session.description}
            </span>
          )}
        </span>
        <span className="student-think-topic-action">
          <span>{state === "active" ? "참여하기" : "생각 보기"}</span>
          <Arrow />
        </span>
      </button>
    );
  };

  return (
    <PortalWorkspace
      as="main"
      className="ws-page think-workspace student-think"
      data-motion={motionEnabled ? "on" : "off"}
    >
      <div className="ws-page-header think-header">
        <h1 className="think-title">
          {getStudentMenuLabel(
            menuConfig,
            "/student/lesson/think-cloud",
            "생각모아",
          )}
        </h1>
        {view === "detail" && (
          <button
            type="button"
            className="think-back"
            disabled={submitLoading}
            onClick={() => setView("list")}
          >
            <Arrow back /> 주제 목록
          </button>
        )}
      </div>
      {topicsState === "loading" && (
        <div className="think-empty">
          <InlineLoading message="주제를 불러오는 중입니다." />
        </div>
      )}
      {topicsState === "error" && (
        <div className="think-error student-think-load-error" role="alert">
          <p>생각모아를 불러오지 못했습니다.</p>
          <button
            type="button"
            className="think-button"
            onClick={() => {
              setSelectedSessionId("");
              setResponseSessionId("");
              setView("list");
              setTopicsState("loading");
              setRefreshKey((value) => value + 1);
            }}
          >
            다시 불러오기
          </button>
        </div>
      )}
      {topicsState === "ready" && view === "list" && (
        <div className="student-think-lobby" data-testid="think-student-lobby">
          {openSessions.length > 0 && (
            <section aria-labelledby="think-open-heading">
              <div className="student-think-section-heading">
                <h2 id="think-open-heading" className="think-section-label">
                  함께 생각할 주제
                </h2>
              </div>
              <div className="think-topic-list">
                {openSessions.map(renderTopic)}
              </div>
            </section>
          )}
          {openSessions.length === 0 && (
            <div className="think-empty student-think-wait">
              <span className="student-think-wait-mark" aria-hidden="true">
                생각
              </span>
              <p>아직 열린 주제가 없습니다.</p>
            </div>
          )}
          {pastSessions.length > 0 && (
            <section aria-labelledby="think-past-heading">
              <div className="student-think-section-heading">
                <h2 id="think-past-heading" className="think-section-label">
                  지난 생각
                </h2>
                <span className="think-count">{pastSessions.length}</span>
              </div>
              <div className="think-topic-list">
                {pastSessions.map(renderTopic)}
              </div>
            </section>
          )}
        </div>
      )}
      {topicsState === "ready" && view === "detail" && !selectedSession && (
        <div className="think-empty">
          <p>이 주제는 더 이상 볼 수 없습니다.</p>
        </div>
      )}
      {topicsState === "ready" && view === "detail" && selectedSession && (
        <div
          className="student-think-detail"
          data-testid="think-student-detail"
        >
          <section
            className="student-think-question"
            aria-labelledby="think-question"
          >
            <div className="think-topic-meta">
              <span
                className="think-status"
                data-state={sessionState(selectedSession)}
              >
                {stateLabel(sessionState(selectedSession))}
              </span>
              <span>
                {options.anonymous ? "익명으로 참여" : "이름과 함께 참여"}
              </span>
              {!options.allowDuplicateByStudent && <span>한 번만 보내기</span>}
            </div>
            <h2 id="think-question" ref={headingRef} tabIndex={-1}>
              {selectedSession.title}
            </h2>
            {selectedSession.description && (
              <p>{selectedSession.description}</p>
            )}
          </section>
          <section
            className="student-think-board"
            aria-labelledby="think-board-title"
            aria-busy={!responsesReady}
          >
            <div className="student-think-board-heading">
              <div>
                <h3 id="think-board-title" className="think-section-label">
                  모인 생각
                </h3>
                {responsesReady && (
                  <span className="think-count">{responses.length}개</span>
                )}
              </div>
              <button
                type="button"
                className="student-think-motion"
                aria-pressed={motionEnabled}
                onClick={() => setMotionEnabled((enabled) => !enabled)}
              >
                {motionEnabled ? "움직임 끄기" : "움직임 켜기"}
              </button>
            </div>
            {!responsesReady ? (
              <div className="student-think-board-empty">
                <InlineLoading message="생각을 불러오는 중입니다." />
              </div>
            ) : cloudEntries.length === 0 ? (
              <div className="student-think-board-empty">
                <span aria-hidden="true" className="student-think-first-word">
                  첫 생각
                </span>
                <p>아직 모인 생각이 없습니다.</p>
              </div>
            ) : (
              <WordCloudView
                key={selectedSessionId}
                entries={cloudEntries}
                showSubmitters={!options.anonymous}
                motionEnabled={motionEnabled}
              />
            )}
          </section>
          <section
            className="student-think-compose"
            aria-labelledby="think-input-label"
            data-complete={singleResponseComplete}
          >
            <div className="student-think-compose-heading">
              <h3 id="think-input-label" className="think-section-label">
                내 생각
              </h3>
              {!singleResponseComplete && (
                <span id="think-input-limit">
                  {draftInput.length} / {options.maxLength}자
                </span>
              )}
            </div>
            {singleResponseComplete ? (
              <div
                key={savedHere?.id || ownResponse?.id}
                ref={sentRef}
                tabIndex={-1}
                className={`student-think-sent${savedHere ? " is-new" : ""}`}
                role="status"
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="m5 12 4 4L19 6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div>
                  <strong>{submittedText}</strong>
                  <span>내 생각을 보냈습니다.</span>
                </div>
              </div>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSubmit();
                }}
              >
                <div className="student-think-input-row">
                  <input
                    id="think-response-input"
                    aria-labelledby="think-input-label"
                    aria-describedby={`think-input-limit${submitError ? " think-submit-error" : ""}${!isActiveSession ? " think-session-status" : ""}`}
                    aria-invalid={Boolean(submitError)}
                    className="think-input student-think-input"
                    lang="ko"
                    inputMode="text"
                    autoComplete="off"
                    value={draftInput}
                    onChange={(event) => {
                      setDraftInput(event.target.value);
                      setSubmitError("");
                    }}
                    maxLength={options.maxLength}
                    disabled={
                      !isActiveSession || submitLoading || !responsesReady
                    }
                    placeholder={
                      options.inputMode === "word"
                        ? "떠오르는 한 단어"
                        : "떠오르는 생각을 짧게"
                    }
                    onCompositionStart={() => {
                      compositionRef.current = true;
                    }}
                    onCompositionEnd={() => {
                      compositionRef.current = false;
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        (compositionRef.current ||
                          event.nativeEvent.isComposing ||
                          event.keyCode === 229)
                      )
                        event.preventDefault();
                    }}
                  />
                  <button
                    type="submit"
                    className="think-button is-primary student-think-send"
                    disabled={
                      submitLoading ||
                      !isActiveSession ||
                      !responsesReady ||
                      !draftInput.trim()
                    }
                  >
                    {submitLoading ? "보내는 중" : "생각 보내기"}
                    <Arrow />
                  </button>
                </div>
                {!isActiveSession && (
                  <p
                    id="think-session-status"
                    className="student-think-compose-note"
                  >
                    {isPausedSession
                      ? "잠시 멈췄습니다. 다시 열리면 생각을 보낼 수 있습니다."
                      : "종료된 주제입니다."}
                  </p>
                )}
                {submitError && (
                  <p
                    id="think-submit-error"
                    className="think-error"
                    role="alert"
                  >
                    {submitError}
                  </p>
                )}
                {savedHere && (
                  <p
                    key={savedHere.id}
                    role="status"
                    className="student-think-repeat-success"
                  >
                    보낸 생각 · <strong>{savedHere.text}</strong>
                  </p>
                )}
              </form>
            )}
          </section>
        </div>
      )}
    </PortalWorkspace>
  );
};

export default ThinkCloud;
