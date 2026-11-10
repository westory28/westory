import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext";
import { isDeveloperUser } from "../../../lib/permissions";
import { useAppToast } from "../../../components/common/AppToastProvider";
import PortalWorkspace from "../../../components/common/PortalWorkspace";
import PortalSubNavigation from "../../../components/common/PortalSubNavigation";
import GongsinStudentPreview from "./GongsinStudentPreview";
import GongsinAdminSettings from "./GongsinAdminSettings";
import { createDefaultGongsinmoongoSettings } from "./gongsinmoongoSettings";
import type { WestoryNotificationType } from "../../../types";
import {
  createDraftQuestions,
  createDraftStories,
  DRAFT_SOURCES,
  PREVIEW_STUDENT,
  sourceById,
  type DraftQuestion,
  type DraftSourceId,
  type DraftStory,
} from "./gongsinmoongoDraftData";
import "../../../components/common/portalPage.css";
import "./gongsinmoongoDraft.css";

type View = "inbox" | "student" | "operation";
interface DraftQuestionRestriction {
  studentId: string;
  until: number;
  reason: string;
}
const restrictionTime = (until: number) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(until);
interface DraftNotification {
  id: string;
  questionId: string;
  recipientId: string;
  type: Extract<
    WestoryNotificationType,
    "question_created" | "question_replied"
  >;
  title: string;
  read: boolean;
}
type EditorDraft = Pick<
  DraftQuestion,
  "reply" | "publicQuestion" | "publicReply" | "related"
>;
const VIEWS = [
  ["inbox", "질문함"],
  ["student", "학생 화면"],
  ["operation", "운영 설정"],
] as const;

function Icon({
  name,
}: {
  name:
    | "book"
    | "question"
    | "lock"
    | "up"
    | "left"
    | "right"
    | "close"
    | "bell";
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "book" && (
        <>
          <path d="M12 5v15M3 4h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v15h-5a5 5 0 0 0-4 1 5 5 0 0 0-4-1H3Z" />
        </>
      )}
      {name === "question" && (
        <>
          <path d="M20 15a3 3 0 0 1-3 3H9l-5 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3Z" />
          <path d="M9.5 8a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 3M12 14h.01" />
        </>
      )}
      {name === "lock" && (
        <>
          <rect x="5" y="10" width="14" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
        </>
      )}
      {name === "up" && <path d="m6 14 6-6 6 6" />}
      {name === "left" && <path d="m14 6-6 6 6 6" />}
      {name === "right" && <path d="m10 6 6 6-6 6" />}
      {name === "close" && <path d="m6 6 12 12M18 6 6 18" />}
      {name === "bell" && (
        <>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </>
      )}
    </svg>
  );
}

function DraftWorkspace() {
  const { showToast } = useAppToast();
  const [view, setView] = useState<View>("inbox");
  const [questions, setQuestions] = useState(createDraftQuestions);
  const [editorDrafts, setEditorDrafts] = useState<Record<string, EditorDraft>>(
    {},
  );
  const [stories, setStories] = useState(createDraftStories);
  const [storyLinks, setStoryLinks] = useState<Record<string, string>>({
    "example-1": "story-1",
    "example-2": "story-2",
  });
  const [selectedId, setSelectedId] = useState("example-1");
  const [filter, setFilter] = useState("all");
  const [listOpen, setListOpen] = useState(false);
  const [settings, setSettings] = useState(createDefaultGongsinmoongoSettings);
  const [settingsNavigation, setSettingsNavigation] = useState({
    studentId: "",
    requestId: 0,
  });
  const [listPage, setListPage] = useState(0);
  const [pageSize, setPageSize] = useState(4);
  const [sourcePreview, setSourcePreview] = useState<DraftSourceId | null>(
    null,
  );
  const [notifications, setNotifications] = useState<DraftNotification[]>([]);
  const [restrictions, setRestrictions] = useState<
    Record<string, DraftQuestionRestriction>
  >({});
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const sourcePreviewRef = useRef<HTMLElement>(null);
  const sourceTriggerRef = useRef<HTMLElement | null>(null);
  const notificationRootRef = useRef<HTMLDivElement>(null);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [jumpTarget, setJumpTarget] = useState<string | null>(null);
  const nextId = useRef(5);
  const shownQuestions = [...questions]
    .reverse()
    .filter(
      (item) =>
        filter === "all" ||
        (filter === "waiting" ? !item.reply : Boolean(storyLinks[item.id])),
    );
  const selected =
    shownQuestions.find((item) => item.id === selectedId) ?? shownQuestions[0];
  const totalListPages = Math.max(
    1,
    Math.ceil(shownQuestions.length / pageSize),
  );
  const currentListPage = Math.min(listPage, totalListPages - 1);
  const pagedQuestions = shownQuestions.slice(
    currentListPage * pageSize,
    (currentListPage + 1) * pageSize,
  );
  const students = Array.from(
    new Map(
      questions.map((item) => [
        item.studentId,
        {
          studentId: item.studentId,
          label: item.studentLabel,
          restriction: restrictions[item.studentId],
        },
      ]),
    ).values(),
  );
  useEffect(() => {
    const resize = () =>
      setPageSize(
        window.innerWidth >= 1024
          ? Math.max(
              1,
              Math.min(6, Math.floor((window.innerHeight - 180) / 120)),
            )
          : 4,
      );
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    const index = shownQuestions.findIndex((item) => item.id === selectedId);
    setListPage(index < 0 ? 0 : Math.floor(index / pageSize));
  }, [selectedId, filter, questions.length, pageSize]);
  const manageStudent = (studentId: string) => {
    setSettingsNavigation((value) => ({
      studentId,
      requestId: value.requestId + 1,
    }));
    setSourcePreview(null);
    setView("operation");
  };
  const teacherNotifications = notifications.filter(
    (item) => item.recipientId === "preview-teacher",
  );
  const teacherUnread = teacherNotifications.filter(
    (item) => !item.read,
  ).length;
  const notify = (title: string) => showToast({ title, tone: "info" });
  const markRead = (id: string) =>
    setNotifications((items) =>
      items.map((item) => (item.id === id ? { ...item, read: true } : item)),
    );

  useEffect(() => {
    const deadlines = Object.values(restrictions).map((item) => item.until);
    if (!deadlines.length) return;
    const timer = window.setTimeout(
      () => {
        const now = Date.now();
        setRestrictions((items) => {
          const remaining = Object.entries(items).filter(
            ([, item]) => item.until > now,
          );
          return remaining.length === Object.keys(items).length
            ? items
            : Object.fromEntries(remaining);
        });
      },
      Math.min(Math.max(0, Math.min(...deadlines) - Date.now()), 2147483647),
    );
    return () => window.clearTimeout(timer);
  }, [restrictions]);

  const activeRestriction = (studentId: string) => {
    const restriction = restrictions[studentId];
    return restriction && restriction.until > Date.now()
      ? restriction
      : undefined;
  };
  const applyRestriction = (
    studentId: string,
    until: number,
    reason: string,
  ) => {
    const cleanReason = reason.trim();
    if (
      !Number.isFinite(until) ||
      until <= Date.now() ||
      !cleanReason ||
      cleanReason.length > 80 ||
      !questions.some((item) => item.studentId === studentId)
    )
      return;
    const existing = restrictions[studentId];
    if (existing?.until === until && existing.reason === cleanReason) return;
    setRestrictions((items) => ({
      ...items,
      [studentId]: { studentId, until, reason: cleanReason },
    }));
    notify("예시 학생의 새 질문을 제한했습니다.");
  };
  const releaseRestriction = (studentId: string) => {
    if (!restrictions[studentId]) return;
    setRestrictions((items) => {
      const remaining = { ...items };
      delete remaining[studentId];
      return remaining;
    });
    notify("예시 학생의 질문 제한을 해제했습니다.");
  };

  useEffect(() => {
    if (!sourcePreview) return;
    sourcePreviewRef.current?.focus({ preventScroll: true });
    sourcePreviewRef.current?.scrollIntoView({ block: "nearest" });
  }, [sourcePreview]);
  useEffect(() => {
    if (!jumpTarget || view !== "inbox") return;
    detailRef.current?.focus({ preventScroll: true });
    detailRef.current?.scrollIntoView({ block: "nearest" });
    setJumpTarget(null);
  }, [jumpTarget, view]);
  useEffect(() => {
    if (!notificationsOpen) return;
    notificationRootRef.current
      ?.querySelector<HTMLButtonElement>(".gongsin-notification-list button")
      ?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!notificationRootRef.current?.contains(event.target as Node))
        setNotificationsOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [notificationsOpen]);
  const openSourcePreview = (id: DraftSourceId) => {
    sourceTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setSourcePreview(id);
    if (sourcePreview === id) {
      sourcePreviewRef.current?.focus({ preventScroll: true });
      sourcePreviewRef.current?.scrollIntoView({ block: "nearest" });
    }
  };
  const closeSourcePreview = () => {
    setSourcePreview(null);
    if (sourceTriggerRef.current?.isConnected) sourceTriggerRef.current.focus();
  };
  const selectQuestion = (id: string) => {
    setSelectedId(id);
    setView("inbox");
    setListOpen(false);
    setSourcePreview(null);
    setNotifications((items) =>
      items.map((item) =>
        item.recipientId === "preview-teacher" && item.questionId === id
          ? { ...item, read: true }
          : item,
      ),
    );
  };
  const updateQuestion = (id: string, update: Partial<DraftQuestion>) => {
    const original = questions.find((item) => item.id === id);
    if (!original) return;
    setQuestions((items) =>
      items.map((item) => (item.id === id ? { ...item, ...update } : item)),
    );
    if (
      typeof update.reply === "string" &&
      update.reply.trim() &&
      update.reply.trim() !== original.reply &&
      settings.studentReplyNotifications
    ) {
      const notification: DraftNotification = {
        id: `reply-${nextId.current++}`,
        questionId: id,
        recipientId: original.studentId,
        type: "question_replied",
        title: "선생님의 답변이 도착했어요",
        read: false,
      };
      setNotifications((items) => [notification, ...items]);
    }
  };
  const askQuestion = (
    text: string,
    source: DraftSourceId,
    origin?: "wrong-note",
  ) => {
    const question = text.trim();
    if (
      !settings.acceptingQuestions ||
      !settings.allowedSources.includes(source) ||
      !question ||
      question.length > 1000
    )
      return;
    if (activeRestriction(PREVIEW_STUDENT)) {
      notify("질문 제한 기간에는 새 질문을 보낼 수 없습니다.");
      return;
    }
    if (source === "mock" && origin !== "wrong-note") {
      notify("모의고사 질문은 오답 노트에서 시작해 주세요.");
      return;
    }
    const id = `example-${nextId.current++}`;
    const item: DraftQuestion = {
      id,
      studentId: PREVIEW_STUDENT,
      studentLabel: "예시 학생 A",
      source,
      question,
      reply: "",
      publicQuestion: "",
      publicReply: "",
      related: [source],
      ...(source === "mock" ? { origin: "wrong-note" as const } : {}),
    };
    setQuestions((items) => [...items, item]);
    if (settings.teacherQuestionNotifications)
      setNotifications((items) => [
        {
          id: `created-${id}`,
          questionId: id,
          recipientId: "preview-teacher",
          type: "question_created",
          title: "새 질문이 도착했습니다",
          read: false,
        },
        ...items,
      ]);
    notify("미리보기 질문을 보냈습니다.");
  };
  const selectStory = (question: DraftQuestion) => {
    const id = storyLinks[question.id] || `story-local-${nextId.current++}`;
    const story: DraftStory = {
      id,
      question: question.publicQuestion.trim(),
      answer: question.publicReply.trim(),
      related: [...question.related],
    };
    setStories((items) =>
      items.some((item) => item.id === id)
        ? items.map((item) => (item.id === id ? story : item))
        : [...items, story],
    );
    setStoryLinks((links) => ({ ...links, [question.id]: id }));
    notify("미리보기 스토리에 선정했습니다.");
  };
  const unselectStory = (question: DraftQuestion) => {
    setStories((items) =>
      items.filter((item) => item.id !== storyLinks[question.id]),
    );
    setStoryLinks((links) => {
      const next = { ...links };
      delete next[question.id];
      return next;
    });
    notify("미리보기 스토리에서 제외했습니다.");
  };

  return (
    <PortalWorkspace className="teacher-sub-workspace teacher-sub-workspace--page gongsin-workspace">
      <PortalSubNavigation
        title="질문함"
        activeLabel={selected?.question ?? "질문 목록"}
        open={listOpen}
        onOpenChange={setListOpen}
        className="gongsin-question-sidebar"
      >
        <label className="gongsin-sidebar-filter">
          질문
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">전체 {questions.length}</option>
            <option value="waiting">
              답변 대기 {questions.filter((item) => !item.reply).length}
            </option>
            <option value="selected">스토리 선정 {stories.length}</option>
          </select>
        </label>
        <div className="gongsin-question-list" aria-label="예시 질문 목록">
          {shownQuestions.length === 0 && (
            <p className="gongsin-empty">해당하는 질문이 없습니다.</p>
          )}
          {pagedQuestions.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`gongsin-question-row${selected?.id === item.id ? " is-active" : ""}`}
              aria-pressed={selected?.id === item.id}
              onClick={() => selectQuestion(item.id)}
            >
              <span className="gongsin-row-meta">
                <span>{sourceById(item.source).label}</span>
                <span className={storyLinks[item.id] ? "gongsin-selected" : ""}>
                  {storyLinks[item.id]
                    ? "스토리 선정"
                    : item.reply
                      ? "답변 완료"
                      : "답변 대기"}
                </span>
              </span>
              <strong>{item.question}</strong>
              <span className="gongsin-muted">{item.studentLabel}</span>
            </button>
          ))}
        </div>
        <nav className="gongsin-list-pagination" aria-label="질문 목록 페이지">
          <button
            type="button"
            className="gongsin-icon-button"
            aria-label="질문 목록 이전 페이지"
            disabled={currentListPage === 0}
            onClick={() => setListPage(currentListPage - 1)}
          >
            <Icon name="left" />
          </button>
          <span aria-live="polite">
            {currentListPage + 1} / {totalListPages}
          </span>
          <button
            type="button"
            className="gongsin-icon-button"
            aria-label="질문 목록 다음 페이지"
            disabled={currentListPage >= totalListPages - 1}
            onClick={() => setListPage(currentListPage + 1)}
          >
            <Icon name="right" />
          </button>
        </nav>
      </PortalSubNavigation>
      <div className="teacher-sub-content gongsin-draft" data-gongsin-draft>
        <header className="ws-page-header">
          <h1>
            공<span className="gongsin-brand">神</span>문고
          </h1>
          <span className="gongsin-private">
            <Icon name="lock" />
            초안 · 학생 비공개
          </span>
        </header>
        <div className="gongsin-draft-note">
          예시 자료 · 이 화면에서만 변경됩니다
        </div>
        <div className="gongsin-toolbar">
          <nav className="ws-page-tabs" aria-label="공신문고 초안 보기">
            {VIEWS.map(([id, label]) => (
              <button
                type="button"
                key={id}
                aria-pressed={view === id}
                onClick={() => {
                  setView(id);
                  setSourcePreview(null);
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          <div
            className="gongsin-notifications"
            ref={notificationRootRef}
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              )
                setNotificationsOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setNotificationsOpen(false);
                notificationButtonRef.current?.focus();
              }
            }}
          >
            <button
              ref={notificationButtonRef}
              type="button"
              className="gongsin-icon-button"
              aria-label={`교사 알림 미리보기${teacherUnread ? `, 새 알림 ${teacherUnread}개` : ""}`}
              aria-expanded={notificationsOpen}
              onClick={() => setNotificationsOpen((value) => !value)}
            >
              <Icon name="bell" />
              {teacherUnread > 0 && (
                <span className="gongsin-notification-count">
                  {teacherUnread}
                </span>
              )}
            </button>
            {notificationsOpen && (
              <section
                className="gongsin-notification-list"
                aria-label="교사 알림 미리보기"
              >
                <h2>
                  교사 알림 <span>미리보기</span>
                </h2>
                {teacherNotifications.length === 0 ? (
                  <p>새 알림이 없습니다.</p>
                ) : (
                  teacherNotifications.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => {
                        markRead(item.id);
                        setFilter("all");
                        selectQuestion(item.questionId);
                        setNotificationsOpen(false);
                        setJumpTarget(item.questionId);
                      }}
                    >
                      <span>{item.title}</span>
                      <small>
                        {item.read ? "읽음" : "새 알림"} · 해당 질문 보기
                      </small>
                    </button>
                  ))
                )}
              </section>
            )}
          </div>
        </div>
        {view === "inbox" && (
          <div
            className="gongsin-question-detail"
            ref={detailRef}
            tabIndex={-1}
          >
            {selected ? (
              <QuestionEditor
                key={selected.id}
                question={selected}
                draft={editorDrafts[selected.id] ?? selected}
                onDraft={(update) =>
                  setEditorDrafts((drafts) => ({
                    ...drafts,
                    [selected.id]: {
                      ...(drafts[selected.id] ?? selected),
                      ...update,
                    },
                  }))
                }
                selected={Boolean(storyLinks[selected.id])}
                onUpdate={(update) => updateQuestion(selected.id, update)}
                onSelect={selectStory}
                onUnselect={() => unselectStory(selected)}
                onSource={openSourcePreview}
                notify={notify}
                restriction={activeRestriction(selected.studentId)}
                onManageRestriction={() => manageStudent(selected.studentId)}
              />
            ) : (
              <p className="gongsin-empty">선택할 질문이 없습니다.</p>
            )}
          </div>
        )}
        <section
          hidden={view !== "student"}
          className="gongsin-student-stage"
          aria-label="학생 화면 미리보기"
        >
          <GongsinStudentPreview
            active={view === "student"}
            restriction={activeRestriction(PREVIEW_STUDENT)}
            questions={questions}
            stories={stories}
            settings={settings}
            onAsk={askQuestion}
            onSource={openSourcePreview}
            notifications={notifications.filter(
              (item) => item.recipientId === PREVIEW_STUDENT,
            )}
            onReadNotification={markRead}
          />
        </section>
        <section
          hidden={view !== "operation"}
          className="gongsin-operation"
          aria-label="공신문고 운영 설정"
        >
          <GongsinAdminSettings
            settings={settings}
            onSave={(next) => {
              setSettings(next);
              notify("초안 설정을 적용했습니다.");
            }}
            students={students}
            onApplyRestriction={applyRestriction}
            onReleaseRestriction={releaseRestriction}
            initialTab={settingsNavigation.studentId ? "students" : "general"}
            initialStudentId={settingsNavigation.studentId || undefined}
            navigationRequestId={settingsNavigation.requestId}
          />
        </section>
        {sourcePreview && (
          <section
            ref={sourcePreviewRef}
            tabIndex={-1}
            className="gongsin-source-preview ws-surface"
            aria-label="학습 연결 미리보기"
            onKeyDown={(event) => {
              if (event.key === "Escape") closeSourcePreview();
            }}
          >
            <div className="gongsin-source-heading">
              <strong>{sourceById(sourcePreview).label} 연결</strong>
              <button
                className="gongsin-icon-button"
                type="button"
                aria-label="학습 연결 미리보기 닫기"
                onClick={closeSourcePreview}
              >
                <Icon name="close" />
              </button>
            </div>
            <p>{sourceById(sourcePreview).title}</p>
            <p>{sourceById(sourcePreview).restriction}</p>
            <span className="gongsin-muted">
              연결 방식의 예시이며 실제 자료·평가를 열지 않습니다.
            </span>
          </section>
        )}
      </div>
    </PortalWorkspace>
  );
}

function QuestionEditor({
  question,
  draft,
  onDraft,
  selected,
  onUpdate,
  onSelect,
  onUnselect,
  onSource,
  notify,
  restriction,
  onManageRestriction,
}: {
  question: DraftQuestion;
  draft: EditorDraft;
  onDraft: (update: Partial<EditorDraft>) => void;
  selected: boolean;
  onUpdate: (update: Partial<DraftQuestion>) => void;
  onSelect: (question: DraftQuestion) => void;
  onUnselect: () => void;
  onSource: (id: DraftSourceId) => void;
  notify: (title: string) => void;
  restriction?: DraftQuestionRestriction;
  onManageRestriction: () => void;
}) {
  const { reply, publicQuestion, publicReply, related } = draft;
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [editingStory, setEditingStory] = useState(false);
  const saveReply = () => {
    if (!reply.trim()) return;
    onUpdate({ reply: reply.trim() });
    notify("미리보기 답변을 저장했습니다.");
  };
  return (
    <section className="gongsin-editor" aria-label="질문 답변 편집">
      <div className="gongsin-row-meta">
        <span>{question.studentLabel} · 나와 학생만</span>
        <button
          className="gongsin-text-button"
          type="button"
          onClick={() => onSource(question.source)}
        >
          {sourceById(question.source).detail}
          <Icon name="right" />
        </button>
      </div>
      <div className="gongsin-editor-mode">
        <button
          className="gongsin-text-button"
          type="button"
          onClick={onManageRestriction}
        >
          질문 제한
          {restriction ? ` · ${restrictionTime(restriction.until)}까지` : ""}
        </button>
        <button
          className="gongsin-text-button"
          type="button"
          disabled={!question.reply}
          aria-expanded={editingStory}
          aria-controls="gongsin-public-editor"
          onClick={() => setEditingStory((value) => !value)}
        >
          {editingStory ? "개별 답변으로" : "공개용 문구 편집"}
        </button>
      </div>
      {!editingStory && (
        <div className="gongsin-private-answer">
          <h3 className="gongsin-original-question" tabIndex={0}>
            {question.question}
          </h3>
          <label className="gongsin-field">
            개별 답변
            <textarea
              rows={4}
              maxLength={2000}
              value={reply}
              onChange={(event) => onDraft({ reply: event.target.value })}
              placeholder="학생에게 보낼 답변을 작성하세요."
            />
          </label>
          <div className="gongsin-editor-actions">
            <button
              className="gongsin-button gongsin-primary"
              type="button"
              disabled={!reply.trim() || reply.trim() === question.reply}
              onClick={saveReply}
            >
              답변 저장 (미리보기)
            </button>
          </div>
        </div>
      )}
      {editingStory && (
        <div className="gongsin-public-editor" id="gongsin-public-editor">
          <h4>스토리로 선정하기</h4>
          <div className="gongsin-public-fields">
            <label className="gongsin-field">
              공개 질문
              <textarea
                rows={2}
                maxLength={240}
                value={publicQuestion}
                onChange={(event) => {
                  onDraft({ publicQuestion: event.target.value });
                  setPrivacyChecked(false);
                }}
              />
            </label>
            <label className="gongsin-field">
              공개 답변
              <textarea
                rows={3}
                maxLength={1000}
                value={publicReply}
                onChange={(event) => {
                  onDraft({ publicReply: event.target.value });
                  setPrivacyChecked(false);
                }}
              />
            </label>
          </div>
          <fieldset className="gongsin-related-picker">
            <legend>이어서 공부할 자료</legend>
            {DRAFT_SOURCES.map((source) => (
              <label key={source.id}>
                <input
                  type="checkbox"
                  checked={related.includes(source.id)}
                  onChange={(event) => {
                    onDraft({
                      related: event.target.checked
                        ? [...related, source.id]
                        : related.filter((id) => id !== source.id),
                    });
                    setPrivacyChecked(false);
                  }}
                />
                {source.label}
              </label>
            ))}
          </fieldset>
          <label className="gongsin-privacy-check">
            <input
              type="checkbox"
              checked={privacyChecked}
              onChange={(event) => setPrivacyChecked(event.target.checked)}
            />
            공개 문구와 연결 자료에 개인정보·비공개 내용이 없는지 확인했습니다.
          </label>
          <div className="gongsin-editor-actions">
            <button
              className="gongsin-button gongsin-primary"
              type="button"
              disabled={
                !privacyChecked || !publicQuestion.trim() || !publicReply.trim()
              }
              onClick={() => {
                const update = {
                  publicQuestion: publicQuestion.trim(),
                  publicReply: publicReply.trim(),
                };
                onUpdate(update);
                onSelect({ ...question, ...update, related: [...related] });
                setPrivacyChecked(false);
              }}
            >
              {selected
                ? "선정 스토리 갱신 (미리보기)"
                : "스토리 선정 (미리보기)"}
            </button>
            {selected && (
              <button
                className="gongsin-button"
                type="button"
                onClick={onUnselect}
              >
                선정 해제
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default function SettingsGongsinmoongo() {
  const { currentUser, config } = useAuth();
  if (!isDeveloperUser(currentUser?.email))
    return <p role="status">관리자만 공神문고 초안을 확인할 수 있습니다.</p>;
  return (
    <DraftWorkspace
      key={`${currentUser?.uid}:${config?.year}:${config?.semester}`}
    />
  );
}
