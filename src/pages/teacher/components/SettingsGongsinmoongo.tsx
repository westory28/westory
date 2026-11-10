import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext";
import { isDeveloperUser } from "../../../lib/permissions";
import { useAppToast } from "../../../components/common/AppToastProvider";
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
type StudentView = "stories" | "mine" | "ask";
type EditorDraft = Pick<
  DraftQuestion,
  "reply" | "publicQuestion" | "publicReply"
>;
const VIEWS = [
  ["inbox", "질문함"],
  ["student", "학생 화면"],
  ["operation", "운영·연결"],
] as const;

function Icon({
  name,
}: {
  name: "book" | "question" | "lock" | "up" | "left" | "right" | "close";
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
  const [studentView, setStudentView] = useState<StudentView>("stories");
  const [storyIndex, setStoryIndex] = useState(0);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [previewTool, setPreviewTool] = useState<"qna" | "dictionary">("qna");
  const [previewReception, setPreviewReception] = useState(true);
  const [previewStories, setPreviewStories] = useState(true);
  const [sourcePreview, setSourcePreview] = useState<DraftSourceId | null>(
    null,
  );
  const [newQuestion, setNewQuestion] = useState("");
  const [newSource, setNewSource] = useState<DraftSourceId>("lesson");
  const launcherRef = useRef<HTMLButtonElement>(null);
  const launcherRootRef = useRef<HTMLDivElement>(null);
  const sourcePreviewRef = useRef<HTMLElement>(null);
  const sourceTriggerRef = useRef<HTMLElement | null>(null);
  const nextId = useRef(5);
  const shownQuestions = questions.filter(
    (item) =>
      filter === "all" ||
      (filter === "waiting" ? !item.reply : Boolean(storyLinks[item.id])),
  );
  const selected =
    shownQuestions.find((item) => item.id === selectedId) ?? shownQuestions[0];
  useEffect(() => {
    if (!launcherOpen) return;
    launcherRootRef.current
      ?.querySelector<HTMLButtonElement>(".gongsin-launcher-menu button")
      ?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!launcherRootRef.current?.contains(event.target as Node))
        setLauncherOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [launcherOpen]);
  useEffect(() => {
    if (!sourcePreview) return;
    sourcePreviewRef.current?.focus({ preventScroll: true });
    sourcePreviewRef.current?.scrollIntoView({ block: "nearest" });
  }, [sourcePreview]);
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
  const mine = questions.filter((item) => item.studentId === PREVIEW_STUDENT);
  const activeStory = stories[Math.min(storyIndex, stories.length - 1)];
  const notify = (title: string) => showToast({ title, tone: "info" });
  const updateQuestion = (id: string, update: Partial<DraftQuestion>) =>
    setQuestions((items) =>
      items.map((item) => (item.id === id ? { ...item, ...update } : item)),
    );
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
    setStoryIndex(0);
    notify("미리보기 스토리에서 제외했습니다.");
  };
  const relatedLinks = (ids: readonly DraftSourceId[]) => (
    <div className="gongsin-related">
      {ids.map((id) => (
        <button
          className="gongsin-link"
          type="button"
          key={id}
          onClick={() => openSourcePreview(id)}
        >
          <Icon name="book" />
          {sourceById(id).label}
          <Icon name="right" />
        </button>
      ))}
    </div>
  );

  return (
    <div className="gongsin-draft" data-gongsin-draft>
      <header className="ws-page-header">
        <h2>
          공<span className="gongsin-brand">神</span>문고
        </h2>
        <span className="gongsin-private">
          <Icon name="lock" />
          초안 · 학생 비공개
        </span>
      </header>
      <div className="gongsin-draft-note">
        예시 자료 · 이 화면에서만 변경됩니다
      </div>
      <nav className="ws-page-tabs" aria-label="공신문고 초안 보기">
        {VIEWS.map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={view === id ? "is-active" : ""}
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

      {view === "inbox" && (
        <>
          <div className="ws-filter-bar gongsin-filter">
            <label className="gongsin-inline-label">
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
            <span className="gongsin-muted">
              개별 질문은 본인과 담당 교사만
            </span>
          </div>
          <div className="gongsin-inbox ws-surface">
            <div className="gongsin-question-list" aria-label="예시 질문 목록">
              {shownQuestions.length === 0 && (
                <p className="gongsin-empty">해당하는 질문이 없습니다.</p>
              )}
              {shownQuestions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`gongsin-question-row${selected?.id === item.id ? " is-active" : ""}`}
                  aria-pressed={selected?.id === item.id}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span className="gongsin-row-meta">
                    <span>{sourceById(item.source).label}</span>
                    <span
                      className={storyLinks[item.id] ? "gongsin-selected" : ""}
                    >
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
              />
            ) : (
              <p className="gongsin-empty">선택할 질문이 없습니다.</p>
            )}
          </div>
        </>
      )}

      {view === "student" && (
        <div className="gongsin-student-stage ws-surface">
          <div className="gongsin-student-heading">
            <strong>학생 화면 미리보기</strong>
            <span className="gongsin-muted">예시 학생 A</span>
          </div>
          <div className="gongsin-student-workspace">
            {previewTool === "dictionary" ? (
              <section className="gongsin-dictionary-preview">
                <Icon name="book" />
                <h3>역사 사전</h3>
                <p>기존 역사 사전을 이 자리에서 엽니다.</p>
                <button
                  className="gongsin-button"
                  type="button"
                  onClick={() => setPreviewTool("qna")}
                >
                  공神문고로 돌아가기
                </button>
              </section>
            ) : (
              <>
                <div className="gongsin-student-title">
                  <h3>
                    공<span className="gongsin-brand">神</span>문고
                  </h3>
                </div>
                <nav
                  className="ws-page-tabs gongsin-student-tabs"
                  aria-label="학생 공신문고 보기"
                >
                  {(
                    [
                      ["stories", "선정 스토리"],
                      ["mine", "내 질문"],
                      ["ask", "질문하기"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={studentView === id}
                      onClick={() => {
                        setStudentView(id);
                        setSourcePreview(null);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                {studentView === "stories" && (
                  <>
                    {!previewStories ? (
                      <p className="gongsin-empty">
                        아직 공개된 스토리가 없습니다.
                      </p>
                    ) : activeStory ? (
                      <article
                        className="gongsin-story"
                        aria-label="선정 스토리"
                      >
                        <div
                          className="gongsin-story-progress"
                          aria-label={`${Math.min(storyIndex + 1, stories.length)} / ${stories.length}번째 스토리`}
                        >
                          {stories.map((story, index) => (
                            <span
                              key={story.id}
                              className={
                                index ===
                                Math.min(storyIndex, stories.length - 1)
                                  ? "is-active"
                                  : ""
                              }
                            />
                          ))}
                        </div>
                        <div className="gongsin-story-top">
                          <span>선생님이 골랐어요</span>
                          <span>공神문고</span>
                        </div>
                        <div className="gongsin-question-sticker">
                          <div>이런 질문이 왔어요</div>
                          <h4>{activeStory.question}</h4>
                        </div>
                        <div className="gongsin-story-answer">
                          <span>선생님의 답변</span>
                          <p>{activeStory.answer}</p>
                        </div>
                        <div className="gongsin-story-related">
                          <span>이어서 공부하기</span>
                          {relatedLinks(activeStory.related)}
                        </div>
                        <div className="gongsin-story-nav">
                          <button
                            className="gongsin-icon-button"
                            type="button"
                            aria-label="이전 스토리"
                            disabled={storyIndex <= 0}
                            onClick={() => setStoryIndex((index) => index - 1)}
                          >
                            <Icon name="left" />
                          </button>
                          <span aria-live="polite">
                            {Math.min(storyIndex + 1, stories.length)} /{" "}
                            {stories.length}
                          </span>
                          <button
                            className="gongsin-icon-button"
                            type="button"
                            aria-label="다음 스토리"
                            disabled={storyIndex >= stories.length - 1}
                            onClick={() => setStoryIndex((index) => index + 1)}
                          >
                            <Icon name="right" />
                          </button>
                        </div>
                      </article>
                    ) : (
                      <p className="gongsin-empty">
                        아직 선정된 스토리가 없습니다.
                      </p>
                    )}
                  </>
                )}
                {studentView === "mine" && (
                  <div className="gongsin-my-questions">
                    <p className="gongsin-privacy-line">
                      <Icon name="lock" />내 질문과 답변은 나와 선생님만 볼 수
                      있어요.
                    </p>
                    {mine.map((item) => (
                      <article key={item.id}>
                        <div className="gongsin-row-meta">
                          <span>{sourceById(item.source).label}</span>
                          <span>
                            {item.reply ? "답변 완료" : "답변 기다리는 중"}
                          </span>
                        </div>
                        <h4>{item.question}</h4>
                        {item.reply && <p>{item.reply}</p>}
                      </article>
                    ))}
                  </div>
                )}
                {studentView === "ask" && (
                  <form
                    className="gongsin-ask"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!previewReception || !newQuestion.trim()) return;
                      const id = `example-${nextId.current++}`;
                      setQuestions((items) => [
                        {
                          id,
                          studentId: PREVIEW_STUDENT,
                          studentLabel: "예시 학생 A",
                          source: newSource,
                          question: newQuestion.trim(),
                          reply: "",
                          publicQuestion: "",
                          publicReply: "",
                          related: [newSource],
                        },
                        ...items,
                      ]);
                      setNewQuestion("");
                      setStudentView("mine");
                      notify(
                        "예시 질문을 추가했습니다. 실제로 전송되지는 않습니다.",
                      );
                    }}
                  >
                    <label>
                      궁금한 자료
                      <select
                        value={newSource}
                        onChange={(event) =>
                          setNewSource(event.target.value as DraftSourceId)
                        }
                      >
                        {DRAFT_SOURCES.map((source) => (
                          <option key={source.id} value={source.id}>
                            {source.label} · {source.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      질문
                      <textarea
                        value={newQuestion}
                        onChange={(event) => setNewQuestion(event.target.value)}
                        maxLength={1000}
                        rows={5}
                        placeholder="어느 부분이 궁금한가요?"
                        disabled={!previewReception}
                        required
                      />
                    </label>
                    <div className="gongsin-row-meta">
                      <span className="gongsin-muted">
                        나와 선생님만 볼 수 있어요
                      </span>
                      <span>{newQuestion.length}/1,000</span>
                    </div>
                    {!previewReception && (
                      <p className="gongsin-form-error">
                        지금은 질문을 받지 않고 있어요.
                      </p>
                    )}
                    <button
                      className="gongsin-button gongsin-primary"
                      type="submit"
                      disabled={!previewReception || !newQuestion.trim()}
                    >
                      질문 보내기 (미리보기)
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
          <div
            ref={launcherRootRef}
            className="gongsin-launcher-demo"
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              )
                setLauncherOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setLauncherOpen(false);
                launcherRef.current?.focus();
              }
              if (
                launcherOpen &&
                ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const buttons = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    ".gongsin-launcher-menu button",
                  ),
                );
                const current = buttons.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? buttons.length - 1
                      : (current +
                          (event.key === "ArrowUp" ? -1 : 1) +
                          buttons.length) %
                        buttons.length;
                buttons[next]?.focus();
              }
            }}
          >
            {launcherOpen && (
              <div
                id="gongsin-preview-tools"
                className="gongsin-launcher-menu"
                aria-label="학습 도구"
              >
                <button
                  type="button"
                  onClick={() => {
                    setPreviewTool("dictionary");
                    setLauncherOpen(false);
                    launcherRef.current?.focus();
                  }}
                >
                  <Icon name="book" />
                  역사 사전
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewTool("qna");
                    setLauncherOpen(false);
                    launcherRef.current?.focus();
                  }}
                >
                  <Icon name="question" />
                  공神문고
                </button>
              </div>
            )}
            <button
              ref={launcherRef}
              className="gongsin-launcher-button"
              type="button"
              aria-label="학습 도구 미리보기"
              aria-controls="gongsin-preview-tools"
              aria-expanded={launcherOpen}
              onClick={() => setLauncherOpen((value) => !value)}
            >
              <Icon name={launcherOpen ? "close" : "up"} />
            </button>
          </div>
        </div>
      )}

      {view === "operation" && (
        <div className="gongsin-operation">
          <section className="gongsin-operation-status ws-surface">
            <div>
              <h3>
                <Icon name="lock" />
                실제 운영
              </h3>
              <p>중지 · 학생 비공개</p>
            </div>
            <span className="gongsin-muted">관리자가 운영을 결정합니다</span>
          </section>
          <section className="gongsin-preview-settings">
            <h3>공개 후 화면 가정</h3>
            <div className="gongsin-switches">
              <label>
                <input
                  type="checkbox"
                  checked={previewReception}
                  onChange={(event) =>
                    setPreviewReception(event.target.checked)
                  }
                />
                <span>질문 접수 미리보기</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={previewStories}
                  onChange={(event) => setPreviewStories(event.target.checked)}
                />
                <span>선정 스토리 미리보기</span>
              </label>
              <button
                className="gongsin-button"
                type="button"
                onClick={() => setView("student")}
              >
                학생 화면 확인
              </button>
            </div>
            <p className="gongsin-muted">실제 운영 설정은 바뀌지 않습니다.</p>
          </section>
          <section className="gongsin-connections">
            <h3>학습 연결</h3>
            <div className="gongsin-connection-list">
              {DRAFT_SOURCES.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => openSourcePreview(source.id)}
                >
                  <strong>{source.label}</strong>
                  <span>{source.flow}</span>
                  <Icon name="right" />
                </button>
              ))}
            </div>
          </section>
          <section className="gongsin-permissions">
            <h3>공개 경계</h3>
            <dl>
              <div>
                <dt>원본 질문·개별 답변</dt>
                <dd>학생 본인 · 담당 교사</dd>
              </div>
              <div>
                <dt>선정 스토리</dt>
                <dd>교사가 편집한 익명 질문·답변만</dd>
              </div>
              <div>
                <dt>운영 중지</dt>
                <dd>메뉴·직접 링크·열린 화면에서 함께 차단</dd>
              </div>
            </dl>
          </section>
        </div>
      )}

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
}) {
  const { reply, publicQuestion, publicReply } = draft;
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
      <h3>{question.question}</h3>
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
        <button
          className="gongsin-button"
          type="button"
          disabled={!question.reply}
          aria-expanded={editingStory}
          aria-controls="gongsin-public-editor"
          onClick={() => setEditingStory((value) => !value)}
        >
          {editingStory ? "공개용 편집 접기" : "공개용 문구 편집"}
        </button>
      </div>
      {editingStory && (
        <div className="gongsin-public-editor" id="gongsin-public-editor">
          <h4>스토리로 선정하기</h4>
          <p className="gongsin-muted">
            원본과 따로 편집합니다. 이름·학급·답안·점수는 제외하세요.
          </p>
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
          <fieldset className="gongsin-related-picker">
            <legend>이어서 공부할 자료</legend>
            {DRAFT_SOURCES.map((source) => (
              <label key={source.id}>
                <input
                  type="checkbox"
                  checked={question.related.includes(source.id)}
                  onChange={(event) => {
                    onUpdate({
                      related: event.target.checked
                        ? [...question.related, source.id]
                        : question.related.filter((id) => id !== source.id),
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
                onSelect({ ...question, ...update });
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
