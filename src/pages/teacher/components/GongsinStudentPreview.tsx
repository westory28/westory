import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  DRAFT_SOURCES,
  PREVIEW_STUDENT,
  sourceById,
  type DraftQuestion,
  type DraftSourceId,
  type DraftStory,
} from "./gongsinmoongoDraftData";
import type { GongsinmoongoSettings } from "./gongsinmoongoSettings";
import "./gongsinStudentPreview.css";

export interface GongsinStudentPreviewProps {
  active: boolean;
  restriction?: { until: number; reason: string };
  questions: DraftQuestion[];
  stories: DraftStory[];
  settings: GongsinmoongoSettings;
  onAsk: (text: string, source: DraftSourceId, origin?: "wrong-note") => void;
  onSource: (source: DraftSourceId) => void;
  notifications: Array<{
    id: string;
    questionId: string;
    title: string;
    read: boolean;
  }>;
  onReadNotification: (id: string) => void;
}

function PreviewIcon({
  name,
}: {
  name:
    | "back"
    | "next"
    | "bell"
    | "send"
    | "book"
    | "close"
    | "up"
    | "chat"
    | "lock";
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "back" && <path d="m14 6-6 6 6 6" />}
      {name === "next" && <path d="m10 6 6 6-6 6" />}
      {name === "bell" && (
        <>
          <path d="M5 16h14l-2-3V9a5 5 0 0 0-10 0v4ZM10 20h4" />
        </>
      )}
      {name === "send" && (
        <>
          <path d="m12 4 7 8M12 4l-7 8M12 4v16" />
        </>
      )}
      {name === "book" && (
        <path d="M12 5v15M3 4h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v15h-5a5 5 0 0 0-4 1 5 5 0 0 0-4-1H3Z" />
      )}
      {name === "close" && <path d="m6 6 12 12M18 6 6 18" />}
      {name === "up" && <path d="m6 14 6-6 6 6" />}
      {name === "chat" && (
        <path d="M20 15a3 3 0 0 1-3 3H9l-5 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3Z" />
      )}
      {name === "lock" && (
        <>
          <rect x="5" y="10" width="14" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
        </>
      )}
    </svg>
  );
}

export default function GongsinStudentPreview({
  active,
  restriction,
  questions,
  stories,
  settings,
  onAsk,
  onSource,
  notifications,
  onReadNotification,
}: GongsinStudentPreviewProps) {
  const [view, setView] = useState<"conversation" | "stories">("conversation");
  const [wrongNoteOpen, setWrongNoteOpen] = useState(false);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [text, setText] = useState("");
  const [source, setSource] = useState<DraftSourceId>("lesson");
  const [mockAttached, setMockAttached] = useState(false);
  const [storyIndex, setStoryIndex] = useState(0);
  const [popup, setPopup] = useState<"notifications" | "tools" | null>(null);
  const [focusQuestionId, setFocusQuestionId] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState("");
  const [acknowledgedRevision, setAcknowledgedRevision] = useState<
    number | null
  >(null);
  const guidelinesAcknowledged =
    !settings.warning.enabled ||
    acknowledgedRevision === settings.warning.revision;
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);
  const guidelinesRef = useRef<HTMLDivElement>(null);
  const guidelinesTriggerRef = useRef<HTMLButtonElement>(null);
  const guidelinesOpenerRef = useRef<HTMLElement | null>(null);
  const suppressComposerNoticeRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const bellRef = useRef<HTMLButtonElement>(null);
  const toolsRef = useRef<HTMLButtonElement>(null);
  const notificationsRootRef = useRef<HTMLDivElement>(null);
  const toolsRootRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pendingComposerFocusRef = useRef(false);
  const wrongNoteRef = useRef<HTMLElement>(null);
  const wrongNoteTriggerRef = useRef<HTMLButtonElement>(null);
  const previousMineCount = useRef<number | null>(null);
  const mine = questions.filter(
    (question) => question.studentId === PREVIEW_STUDENT,
  );
  const ownQuestionIds = new Set(mine.map((question) => question.id));
  const ownNotifications = notifications.filter((item) =>
    ownQuestionIds.has(item.questionId),
  );
  const unreadCount = ownNotifications.filter((item) => !item.read).length;
  const { acceptingQuestions, storiesVisible } = settings;
  const visibleStories = storiesVisible ? stories : [];
  const activeStoryIndex = Math.min(
    storyIndex,
    Math.max(0, visibleStories.length - 1),
  );
  const activeStory = visibleStories[activeStoryIndex];
  const regularSources = DRAFT_SOURCES.filter(
    (item) => item.id !== "mock" && settings.allowedSources.includes(item.id),
  );
  const sourceAllowed = settings.allowedSources.includes(source);
  const mockAllowed = settings.allowedSources.includes("mock");
  const isRestricted = Boolean(restriction && restriction.until > Date.now());
  const canCompose = acceptingQuestions && !isRestricted;
  useLayoutEffect(() => {
    if (
      !active ||
      guidelinesOpen ||
      wrongNoteOpen ||
      dictionaryOpen ||
      view !== "conversation" ||
      !pendingComposerFocusRef.current
    )
      return;
    pendingComposerFocusRef.current = false;
    composerRef.current?.focus();
  }, [
    active,
    guidelinesOpen,
    wrongNoteOpen,
    dictionaryOpen,
    view,
    mockAttached,
  ]);
  const restrictionEnd =
    isRestricted && restriction
      ? new Intl.DateTimeFormat("ko-KR", {
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "Asia/Seoul",
        }).format(new Date(restriction.until))
      : "";

  const openGuidelines = () => {
    if (!active || !settings.warning.enabled) return;
    guidelinesOpenerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setPopup(null);
    setGuidelinesOpen(true);
  };
  const closeGuidelines = (confirmed = false) => {
    if (confirmed) setAcknowledgedRevision(settings.warning.revision);
    setGuidelinesOpen(false);
    requestAnimationFrame(() => {
      if (!activeRef.current) return;
      const requestedTarget = confirmed
        ? composerRef.current
        : guidelinesOpenerRef.current;
      const target =
        requestedTarget?.isConnected &&
        requestedTarget.getClientRects().length &&
        !requestedTarget.matches(":disabled")
          ? requestedTarget
          : (guidelinesTriggerRef.current ?? bellRef.current);
      suppressComposerNoticeRef.current = target === composerRef.current;
      if (target?.isConnected && target.getClientRects().length) target.focus();
    });
  };
  useEffect(() => {
    if (!active) {
      setGuidelinesOpen(false);
      setPopup(null);
      return;
    }
    if (!guidelinesAcknowledged) {
      guidelinesOpenerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setGuidelinesOpen(true);
    } else if (!settings.warning.enabled) setGuidelinesOpen(false);
  }, [
    active,
    guidelinesAcknowledged,
    settings.warning.enabled,
    settings.warning.revision,
  ]);
  useEffect(() => {
    if (!active || !guidelinesOpen) return;
    const dialog = guidelinesRef.current;
    const first = dialog?.querySelector<HTMLButtonElement>("button");
    dialog?.scrollIntoView({ block: "nearest" });
    first?.focus({ preventScroll: true });
    const containFocus = (event: FocusEvent) => {
      if (!dialog?.contains(event.target as Node))
        first?.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", containFocus);
    return () => document.removeEventListener("focusin", containFocus);
  }, [active, guidelinesOpen]);

  useEffect(() => {
    if (!active || !popup) return;
    const root =
      popup === "notifications"
        ? notificationsRootRef.current
        : toolsRootRef.current;
    root
      ?.querySelector<HTMLButtonElement>("[data-gongsin-popover] button")
      ?.focus();
    const onOutside = (event: PointerEvent) => {
      if (!root?.contains(event.target as Node)) setPopup(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPopup(null);
      (popup === "notifications" ? bellRef : toolsRef).current?.focus();
    };
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [active, popup]);

  useEffect(() => {
    if (
      !active ||
      guidelinesOpen ||
      !focusQuestionId ||
      view !== "conversation" ||
      wrongNoteOpen ||
      dictionaryOpen
    )
      return;
    const question = Array.from(
      conversationRef.current?.querySelectorAll<HTMLElement>(
        "[data-question-id]",
      ) ?? [],
    ).find((element) => element.dataset.questionId === focusQuestionId);
    question?.focus({ preventScroll: true });
    question?.scrollIntoView({ block: "nearest" });
    setFocusQuestionId(null);
  }, [
    active,
    guidelinesOpen,
    focusQuestionId,
    view,
    wrongNoteOpen,
    dictionaryOpen,
    mine.length,
  ]);

  useEffect(() => {
    if (
      active &&
      !guidelinesOpen &&
      previousMineCount.current !== null &&
      mine.length > previousMineCount.current &&
      view === "conversation" &&
      !wrongNoteOpen
    ) {
      composerRef.current?.focus({ preventScroll: true });
      const stream = conversationRef.current;
      if (stream) stream.scrollTop = stream.scrollHeight;
    }
    previousMineCount.current = mine.length;
  }, [active, guidelinesOpen, mine.length, view, wrongNoteOpen]);

  useEffect(() => {
    if (active && !guidelinesOpen && wrongNoteOpen)
      wrongNoteRef.current?.focus({ preventScroll: true });
  }, [active, guidelinesOpen, wrongNoteOpen]);

  const showConversation = () => {
    setView("conversation");
    setWrongNoteOpen(false);
    setDictionaryOpen(false);
    setPopup(null);
  };
  const showStories = () => {
    setView("stories");
    setWrongNoteOpen(false);
    setDictionaryOpen(false);
    setPopup(null);
  };
  const closeWrongNote = () => {
    setWrongNoteOpen(false);
    requestAnimationFrame(() => {
      if (activeRef.current) wrongNoteTriggerRef.current?.focus();
    });
  };
  const openNotification = (id: string, questionId: string) => {
    if (!ownQuestionIds.has(questionId)) return;
    onReadNotification(id);
    showConversation();
    setFocusQuestionId(questionId);
  };

  return (
    <section
      className="gongsin-student-preview"
      aria-label="학생 공신문고 미리보기"
    >
      <div className="gsp-chat-pane">
        <header className="gsp-header">
          <button
            className="gsp-teacher-story"
            type="button"
            onClick={showStories}
            aria-label={`선생님의 선정 스토리 ${visibleStories.length}개`}
          >
            <span
              className={`gsp-teacher-ring${visibleStories.length ? " has-story" : ""}`}
            >
              <span>선</span>
            </span>
          </button>
          <div className="gsp-heading">
            <h3>선생님</h3>
            {view === "conversation" && (
              <span className="gsp-private">
                <PreviewIcon name="lock" />
                선생님과 나만
              </span>
            )}
          </div>
          <div
            className="gsp-notification-root"
            ref={notificationsRootRef}
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                ) &&
                popup === "notifications"
              )
                setPopup(null);
            }}
          >
            <button
              ref={bellRef}
              className="gsp-icon-button gsp-bell"
              type="button"
              aria-label={`알림, 읽지 않은 답변 ${unreadCount}개`}
              aria-expanded={popup === "notifications"}
              aria-controls="gsp-notifications"
              onClick={() =>
                setPopup((value) =>
                  value === "notifications" ? null : "notifications",
                )
              }
            >
              <PreviewIcon name="bell" />
              {unreadCount > 0 && (
                <span className="gsp-badge" aria-hidden="true">
                  {unreadCount}
                </span>
              )}
            </button>
            {popup === "notifications" && (
              <div
                id="gsp-notifications"
                className="gsp-notifications"
                data-gongsin-popover
                aria-label="내 답변 알림"
              >
                <strong>답변 알림</strong>
                {ownNotifications.length ? (
                  ownNotifications.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openNotification(item.id, item.questionId)}
                    >
                      <span>{item.title}</span>
                      <small>{item.read ? "읽음" : "새 답변"}</small>
                    </button>
                  ))
                ) : (
                  <p>새 답변이 없습니다.</p>
                )}
              </div>
            )}
          </div>
        </header>

        <div className="gsp-navigation">
          <nav
            className="ws-page-tabs gsp-view-tabs"
            aria-label="공신문고 학생 보기"
          >
            <button
              type="button"
              aria-pressed={
                view === "conversation" && !wrongNoteOpen && !dictionaryOpen
              }
              onClick={showConversation}
            >
              내 질문
            </button>
            <button
              type="button"
              aria-pressed={
                view === "stories" && !wrongNoteOpen && !dictionaryOpen
              }
              onClick={showStories}
            >
              선정 스토리
            </button>
          </nav>
          <button
            ref={wrongNoteTriggerRef}
            className="gsp-wrong-note-link"
            type="button"
            onClick={() => {
              setWrongNoteOpen(true);
              setDictionaryOpen(false);
              setPopup(null);
            }}
          >
            <PreviewIcon name="book" />
            <span>오답 노트</span>
          </button>
        </div>

        {isRestricted && restriction && (
          <div
            className="gsp-restriction"
            role="status"
            aria-label="질문 이용 제한"
          >
            <strong>질문 제한 · {restrictionEnd} 해제</strong>
            <span>{restriction.reason}</span>
          </div>
        )}

        {dictionaryOpen ? (
          <section className="gsp-empty">
            <PreviewIcon name="book" />
            <h4>역사 사전</h4>
            <p>기존 역사 사전을 여는 위치입니다.</p>
            <button
              className="gsp-secondary"
              type="button"
              onClick={showConversation}
            >
              대화로 돌아가기
            </button>
          </section>
        ) : wrongNoteOpen ? (
          <section
            className="gsp-wrong-note"
            ref={wrongNoteRef}
            tabIndex={-1}
            aria-label="모의고사 오답 노트 미리보기"
          >
            <div className="gsp-review-heading">
              <button
                className="gsp-icon-button"
                type="button"
                aria-label="오답 노트 닫기"
                onClick={closeWrongNote}
              >
                <PreviewIcon name="back" />
              </button>
              <div>
                <h4>오답 노트</h4>
                <span>모의고사 1회 · 7번</span>
              </div>
              <span className="gsp-review-status">제출 완료</span>
            </div>
            <article className="gsp-review-content">
              <span>조선 전기의 대외 관계</span>
              <h4>자료 속 교류 상대와 교류 방식 찾기</h4>
              <p>
                교류 상대와 교류 방식을 나타내는 말을 찾아보고, 교린의 뜻과
                연결해 보세요.
              </p>
              <div className="gsp-review-answer">
                <strong>해설 공개</strong>
                <p>
                  역사 사전의 ‘교린’을 확인한 뒤 수업자료의 대외 관계와 비교해
                  보세요.
                </p>
              </div>
            </article>
            <div className="gsp-review-actions">
              <button
                className="gsp-secondary"
                type="button"
                onClick={() => onSource("lesson")}
              >
                관련 수업자료
              </button>
              <button
                className="gsp-primary"
                type="button"
                disabled={!canCompose || !mockAllowed}
                onClick={() => {
                  if (!canCompose || !mockAllowed) return;
                  if (!guidelinesAcknowledged) {
                    openGuidelines();
                    return;
                  }
                  setSource("mock");
                  setMockAttached(true);
                  pendingComposerFocusRef.current = true;
                  showConversation();
                }}
              >
                이 문항 질문하기
              </button>
            </div>
            {!acceptingQuestions && (
              <p className="gsp-status">지금은 질문을 받지 않고 있어요.</p>
            )}
            {!mockAllowed && (
              <p className="gsp-status">
                지금은 모의고사 질문을 받지 않고 있어요.
              </p>
            )}
            <p className="gsp-demo-note">
              제출·해설 공개를 가정한 예시 문항입니다.
            </p>
          </section>
        ) : view === "stories" ? (
          <div className="gsp-stories">
            {activeStory ? (
              <article className="gsp-story" aria-label="선정 스토리">
                <div
                  className="gsp-story-progress"
                  aria-label={`${activeStoryIndex + 1} / ${visibleStories.length}번째 스토리`}
                >
                  {visibleStories.map((story, index) => (
                    <span
                      key={story.id}
                      className={index === activeStoryIndex ? "is-active" : ""}
                    />
                  ))}
                </div>
                <div className="gsp-story-meta">
                  <span>선생님이 골랐어요</span>
                  <span>공神문고</span>
                </div>
                <div className="gsp-question-sticker">
                  <span>이런 질문이 왔어요</span>
                  <h4>{activeStory.question}</h4>
                </div>
                <div className="gsp-story-answer">
                  <strong>선생님의 답변</strong>
                  <p>{activeStory.answer}</p>
                </div>
                {activeStory.related.length > 0 && (
                  <div className="gsp-story-links">
                    <span>이어서 공부하기</span>
                    <div>
                      {activeStory.related.map((id) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => onSource(id)}
                        >
                          <PreviewIcon name="book" />
                          {sourceById(id).label}
                          <PreviewIcon name="next" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="gsp-story-controls">
                  <button
                    className="gsp-icon-button"
                    type="button"
                    aria-label="이전 스토리"
                    disabled={activeStoryIndex === 0}
                    onClick={() => setStoryIndex(activeStoryIndex - 1)}
                  >
                    <PreviewIcon name="back" />
                  </button>
                  <span aria-live="polite">
                    {activeStoryIndex + 1} / {visibleStories.length}
                  </span>
                  <button
                    className="gsp-icon-button"
                    type="button"
                    aria-label="다음 스토리"
                    disabled={activeStoryIndex >= visibleStories.length - 1}
                    onClick={() => setStoryIndex(activeStoryIndex + 1)}
                  >
                    <PreviewIcon name="next" />
                  </button>
                </div>
              </article>
            ) : (
              <div className="gsp-empty">
                <PreviewIcon name="chat" />
                <p>아직 공개된 스토리가 없어요.</p>
                <button
                  className="gsp-secondary"
                  type="button"
                  onClick={showConversation}
                >
                  내 질문으로 돌아가기
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="gsp-dm">
            <div
              className="gsp-conversation"
              ref={conversationRef}
              aria-label="선생님과의 개인 대화"
              tabIndex={0}
            >
              {mine.length === 0 ? (
                <div className="gsp-empty">
                  <PreviewIcon name="chat" />
                  <p>궁금한 내용을 선생님께 물어보세요.</p>
                </div>
              ) : (
                mine.map((question) => (
                  <article
                    className="gsp-message-pair"
                    key={question.id}
                    data-question-id={question.id}
                    tabIndex={-1}
                    aria-label={`내 질문: ${question.question}`}
                  >
                    <div className="gsp-message gsp-message-mine">
                      <button
                        className="gsp-message-source"
                        type="button"
                        onClick={() => onSource(question.source)}
                      >
                        <PreviewIcon name="book" />
                        {sourceById(question.source).label}
                        <span>
                          {question.source === "mock"
                            ? "1회 · 7번"
                            : sourceById(question.source).title}
                        </span>
                      </button>
                      <p>{question.question}</p>
                    </div>
                    {question.reply ? (
                      <div className="gsp-teacher-reply">
                        <span className="gsp-teacher-avatar" aria-hidden="true">
                          선
                        </span>
                        <div className="gsp-message gsp-message-teacher">
                          <strong>선생님</strong>
                          <p>{question.reply}</p>
                          {question.related.length > 0 && (
                            <div className="gsp-reply-links">
                              {question.related.map((id) => (
                                <button
                                  key={id}
                                  type="button"
                                  onClick={() => onSource(id)}
                                >
                                  {sourceById(id).label}
                                  <PreviewIcon name="next" />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className="gsp-pending">답변 기다리는 중</span>
                    )}
                  </article>
                ))
              )}
            </div>
            <form
              className="gsp-composer"
              onSubmit={(event) => {
                event.preventDefault();
                if (
                  !text.trim() ||
                  !active ||
                  !canCompose ||
                  !guidelinesAcknowledged ||
                  !sourceAllowed ||
                  (source === "mock" && !mockAttached)
                )
                  return;
                onAsk(
                  text.trim(),
                  source,
                  source === "mock" ? "wrong-note" : undefined,
                );
                setText("");
                setSendStatus("미리보기 질문을 보냈습니다.");
              }}
            >
              <div className="gsp-source-row">
                {mockAttached ? (
                  <span className="gsp-mock-attachment">
                    <PreviewIcon name="lock" />
                    <span>오답 노트 · 모의고사 1회 · 7번</span>
                    <button
                      className="gsp-icon-button"
                      type="button"
                      aria-label="모의고사 문항 연결 해제"
                      disabled={!canCompose}
                      onClick={() => {
                        setMockAttached(false);
                        setSource("lesson");
                      }}
                    >
                      <PreviewIcon name="close" />
                    </button>
                  </span>
                ) : (
                  <label className="gsp-source-picker">
                    <PreviewIcon name="book" />
                    <span className="sr-only">질문할 자료</span>
                    <select
                      aria-label="질문할 자료"
                      value={source}
                      disabled={!canCompose || regularSources.length === 0}
                      onChange={(event) =>
                        setSource(event.target.value as DraftSourceId)
                      }
                    >
                      {!sourceAllowed && (
                        <option value={source} disabled>
                          {sourceById(source).label} · 질문 접수 중지
                        </option>
                      )}
                      {regularSources.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.label} · {item.title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="gsp-composer-meta">
                  {settings.warning.enabled && (
                    <button
                      ref={guidelinesTriggerRef}
                      className="gsp-guidelines-trigger"
                      type="button"
                      onClick={openGuidelines}
                    >
                      {guidelinesAcknowledged ? "질문 안내" : "질문 안내 확인"}
                    </button>
                  )}
                  <span>{text.length}/1,000</span>
                </div>
              </div>
              {!sourceAllowed && (
                <p className="gsp-source-unavailable" role="status">
                  {settings.allowedSources.length === 0
                    ? "지금은 질문할 수 있는 자료가 없어요."
                    : regularSources.length === 0 && mockAllowed
                      ? "모의고사 질문은 오답 노트에서 시작해 주세요."
                      : mockAttached
                        ? "모의고사 질문 접수가 중지되었습니다. 연결을 해제하고 다른 자료를 선택해 주세요."
                        : "이 자료의 질문 접수가 중지되었습니다. 다른 자료를 선택해 주세요."}
                </p>
              )}
              <div className="gsp-compose-row">
                <label className="gsp-compose-label">
                  <span className="sr-only">선생님께 질문</span>
                  <textarea
                    ref={composerRef}
                    aria-label="선생님께 질문"
                    rows={1}
                    maxLength={1000}
                    value={text}
                    onFocus={() => {
                      if (suppressComposerNoticeRef.current) {
                        suppressComposerNoticeRef.current = false;
                        return;
                      }
                      if (!guidelinesAcknowledged) openGuidelines();
                    }}
                    onChange={(event) => {
                      setText(event.target.value);
                      setSendStatus("");
                    }}
                    placeholder={
                      canCompose
                        ? "궁금한 내용을 입력하세요"
                        : isRestricted
                          ? "질문 제한이 끝나면 보낼 수 있어요"
                          : "지금은 질문을 받지 않고 있어요"
                    }
                    disabled={!canCompose}
                  />
                </label>
                <button
                  className="gsp-send"
                  type="submit"
                  aria-label="질문 보내기 (미리보기)"
                  disabled={
                    !active ||
                    !canCompose ||
                    !guidelinesAcknowledged ||
                    !sourceAllowed ||
                    !text.trim()
                  }
                >
                  <PreviewIcon name="send" />
                </button>
              </div>
              <span className="sr-only" role="status">
                {sendStatus}
              </span>
            </form>
          </div>
        )}
      </div>

      {active && guidelinesOpen && (
        <div
          className="gsp-guidelines-layer"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeGuidelines();
          }}
        >
          <div
            className="gsp-guidelines-dialog"
            ref={guidelinesRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="gsp-guidelines-title"
            aria-describedby="gsp-guidelines-description"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeGuidelines();
                return;
              }
              if (event.key !== "Tab") return;
              const controls = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              );
              const first = controls[0];
              const last = controls[controls.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <div className="gsp-guidelines-heading">
              <h4 id="gsp-guidelines-title">{settings.warning.title}</h4>
              <button
                className="gsp-icon-button"
                type="button"
                aria-label="질문 안내 닫기"
                onClick={() => closeGuidelines()}
              >
                <PreviewIcon name="close" />
              </button>
            </div>
            <ul id="gsp-guidelines-description">
              {settings.warning.body
                .split("\n")
                .filter((line) => line.trim())
                .map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
            </ul>
            <button
              className="gsp-primary"
              type="button"
              onClick={() => closeGuidelines(true)}
            >
              확인했어요
            </button>
          </div>
        </div>
      )}
      {popup === "tools" && (
        <div className="gsp-tools-scrim" aria-hidden="true" />
      )}
      <aside className="gsp-tools-rail" aria-label="학습 도구 영역">
        <div
          className="gsp-tools-root"
          ref={toolsRootRef}
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(
                event.relatedTarget as Node | null,
              ) &&
              popup === "tools"
            )
              setPopup(null);
          }}
          onKeyDown={(event) => {
            if (
              popup !== "tools" ||
              !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
            )
              return;
            event.preventDefault();
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "[data-gongsin-popover] button",
              ),
            );
            const current = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const index =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (current +
                      (event.key === "ArrowUp" ? -1 : 1) +
                      buttons.length) %
                    buttons.length;
            buttons[index]?.focus();
          }}
        >
          {popup === "tools" && (
            <div
              className="gsp-tools-menu"
              id="gsp-learning-tools"
              data-gongsin-popover
              aria-label="학습 도구"
            >
              <button
                type="button"
                onClick={() => {
                  setDictionaryOpen(true);
                  setWrongNoteOpen(false);
                  setPopup(null);
                  toolsRef.current?.focus();
                }}
              >
                <span className="gsp-tools-label">역사 사전</span>
                <span className="gsp-tools-icon">
                  <PreviewIcon name="book" />
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  showConversation();
                  toolsRef.current?.focus();
                }}
              >
                <span className="gsp-tools-label">공神문고</span>
                <span className="gsp-tools-icon">
                  <PreviewIcon name="chat" />
                </span>
              </button>
            </div>
          )}
          <button
            ref={toolsRef}
            className="gsp-tools-launcher"
            type="button"
            aria-label="학습 도구 미리보기"
            aria-controls="gsp-learning-tools"
            aria-expanded={popup === "tools"}
            onClick={() =>
              setPopup((value) => (value === "tools" ? null : "tools"))
            }
          >
            <PreviewIcon name={popup === "tools" ? "close" : "up"} />
          </button>
        </div>
      </aside>
    </section>
  );
}
