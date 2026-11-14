import RefreshButton from "./RefreshButton";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  getDefaultProfileEmojiValue,
  getProfileEmojiValueById,
} from "../../lib/profileEmojis";
import { acquirePageScrollLock } from "../../lib/pageScrollLock";
import { useAppToast } from "./AppToastProvider";
import PortalWorkspace from "./PortalWorkspace";
import PortalSubNavigation from "./PortalSubNavigation";
import { InlineLoading } from "./LoadingState";
import {
  getGongsinmoongo,
  manageGongsinmoongo,
  newGongsinRequestId,
  useGongsinAvailability,
  parseGongsinSource,
  getGongsinSourceUrl,
  GONGSIN_SOURCE_LABELS,
  type GongsinState,
  type GongsinSettings,
  type GongsinQuestion,
  type GongsinStory,
  type GongsinPage,
  type GongsinSource,
  type GongsinRestriction,
  type GongsinMutation,
} from "../../lib/gongsinmoongo";
import "./portalPage.css";
import "./gongsinmoongo.css";

const DURATIONS = [
  [3600000, "1시간"],
  [10800000, "3시간"],
  [86400000, "1일"],
  [259200000, "3일"],
  [604800000, "7일"],
] as const;
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "불러오지 못했습니다. 다시 시도해 주세요.";
const timeText = (time: number) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(time);
const questionOrder = (items: GongsinQuestion[]) =>
  [...new Map(items.map((item) => [item.id, item])).values()].sort(
    (a, b) => a.createdAt - b.createdAt,
  );

export function GongsinBrand() {
  return (
    <>
      공부의 <span className="gsm-brand">神</span>문고
    </>
  );
}
function Chevron({
  direction = "right",
}: {
  direction?: "left" | "right" | "up";
}) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path
        d={
          direction === "left"
            ? "m14 6-6 6 6 6"
            : direction === "up"
              ? "m6 14 6-6 6 6"
              : "m10 6 6 6-6 6"
        }
      />
    </svg>
  );
}
function Dialog({
  title,
  onClose,
  children,
  error,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    const unlock = acquirePageScrollLock();
    return () => {
      unlock();
      before?.focus();
    };
  }, []);
  return (
    <dialog
      className="gsm-dialog"
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          type="button"
          className="gsm-icon"
          aria-label="닫기"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {error && (
        <p className="gsm-error" role="alert">
          {error}
        </p>
      )}
      {children}
    </dialog>
  );
}
function SourceLink({
  source,
  teacher = false,
}: {
  source: GongsinSource;
  teacher?: boolean;
}) {
  const url = getGongsinSourceUrl(source);
  const label = source.title || GONGSIN_SOURCE_LABELS[source.kind];
  // Personal result links are only opened by the learner who owns the record.
  return url && !teacher ? (
    <a className="gsm-source" href={`#${url}`}>
      {label}
      <Chevron />
    </a>
  ) : (
    <span className="gsm-source">{label}</span>
  );
}

export default function GongsinmoongoWorkspace({
  teacher = false,
}: {
  teacher?: boolean;
}) {
  const { currentUser, authGeneration } = useAuth();
  const gate = useGongsinAvailability();
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useAppToast();
  const [state, setState] = useState<GongsinState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [list, setList] = useState<GongsinPage<GongsinQuestion>>({
    items: [],
    nextCursor: null,
  });
  const [cursors, setCursors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const [listIndex, setListIndex] = useState(0);
  const [visiblePage, setVisiblePage] = useState(0);
  const [filter, setFilter] = useState("all");
  const [listOpen, setListOpen] = useState(false);
  const [view, setView] = useState<"inbox" | "settings">("inbox");
  const [selected, setSelected] = useState<GongsinQuestion | null>(null);
  const [messages, setMessages] = useState<GongsinQuestion[]>([]);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  const [warningAgreed, setWarningAgreed] = useState(false);
  const [storyEdit, setStoryEdit] = useState(false);
  const [restrictionOpen, setRestrictionOpen] = useState(false);
  const [stories, setStories] = useState<GongsinPage<GongsinStory>>({
    items: [],
    nextCursor: null,
  });
  const [storyIndex, setStoryIndex] = useState<number | null>(null);
  const [loadedStoryScope, setLoadedStoryScope] = useState("");
  const [refresh, setRefresh] = useState(0);
  const request = useRef(0);
  const stateCache = useRef<{ key: string; value: GongsinState } | null>(null);
  const loadedIdentity = useRef("");
  const conversationRequest = useRef(0);
  const conversationRef = useRef<HTMLDivElement>(null);
  const mutation = useRef<{ fingerprint: string; id: string } | null>(null);
  const source = useMemo(
    () => parseGongsinSource(location.search),
    [location.search],
  );
  const targetQuestion =
    new URLSearchParams(location.search).get("question") || "";
  const identity = `${currentUser?.uid}:${authGeneration}:${gate.semesterId}`;
  const allowed = teacher || (gate.loaded && gate.enabled && !gate.error);
  const scope = `${identity}:${allowed}:${gate.revision}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const mutationScope = `${identity}:${allowed}`;
  const mutationScopeRef = useRef(mutationScope);
  mutationScopeRef.current = mutationScope;
  const storyRevision = useRef(gate.contentRevision);
  storyRevision.current = gate.contentRevision;
  useEffect(() => {
    scopeRef.current = scope;
    mutationScopeRef.current = mutationScope;
    return () => {
      scopeRef.current = "disposed";
      mutationScopeRef.current = "disposed";
    };
  }, []);
  useEffect(() => {
    setBusy(false);
  }, [scope]);
  useEffect(() => {
    setStories({ items: [], nextCursor: null });
    setStoryIndex(null);
  }, [gate.contentRevision, gate.revision]);
  const notify = (title: string) => showToast({ title, tone: "success" });

  useEffect(() => {
    setState(null);
    setSelected(null);
    setMessages([]);
    setList({ items: [], nextCursor: null });
    setDrafts({});
    setQuestion("");
    setStories({ items: [], nextCursor: null });
    setStoryIndex(null);
    mutation.current = null;
    stateCache.current = null;
    setCursors([undefined]);
    setListIndex(0);
    setVisiblePage(0);
    setBusy(false);
    setConversationBusy(false);
    setStoryEdit(false);
    setRestrictionOpen(false);
  }, [identity]);
  const loadConversation = useCallback(
    async (item: GongsinQuestion, more = false) => {
      const id = ++conversationRequest.current;
      const operationScope = scopeRef.current;
      setConversationBusy(true);
      if (!more) {
        setSelected(item);
        setMessages([item]);
        setMessageCursor(null);
      }
      try {
        const page = await getGongsinmoongo<GongsinPage<GongsinQuestion>>(
          gate.semesterId,
          "questions",
          {
            ...(teacher ? { studentId: item.studentId } : {}),
            ...(more && messageCursor ? { cursor: messageCursor } : {}),
          },
        );
        if (
          id !== conversationRequest.current ||
          operationScope !== scopeRef.current
        )
          return;
        setMessages((previous) =>
          questionOrder([...(more ? previous : [item]), ...page.items]),
        );
        setMessageCursor(page.nextCursor);
      } catch (e) {
        if (
          id === conversationRequest.current &&
          operationScope === scopeRef.current
        )
          setError(errorText(e));
      } finally {
        if (
          id === conversationRequest.current &&
          operationScope === scopeRef.current
        )
          setConversationBusy(false);
      }
    },
    [gate.semesterId, teacher, messageCursor],
  );

  useEffect(() => {
    if (!gate.loaded) return;
    const id = ++request.current;
    let cancelled = false;
    if (!allowed) {
      setState(null);
      setMessages([]);
      setList({ items: [], nextCursor: null });
      setStories({ items: [], nextCursor: null });
      setSelected(null);
      setLoading(false);
      setWarningOpen(false);
      setStoryIndex(null);
      setBusy(false);
      setConversationBusy(false);
      return;
    }
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const cacheKey = `${identity}:${gate.revision}:${refresh}`;
        const next =
          stateCache.current?.key === cacheKey
            ? stateCache.current.value
            : await getGongsinmoongo<GongsinState>(gate.semesterId, "state");
        if (cancelled || id !== request.current) return;
        stateCache.current = { key: cacheKey, value: next };
        loadedIdentity.current = identity;
        setState(next);
        if (teacher && view === "settings") return;
        if (
          !teacher &&
          next.settings.warning.enabled &&
          next.acknowledgedWarningRevision < next.settings.warning.revision
        ) {
          setWarningAgreed(false);
          setWarningOpen(true);
        }
        const page = await getGongsinmoongo<GongsinPage<GongsinQuestion>>(
          gate.semesterId,
          "questions",
          teacher ? { filter, cursor: cursors[listIndex] } : {},
        );
        if (cancelled || id !== request.current) return;
        setList(page);
        if (teacher) {
          let chosen =
            page.items.find((item) => item.id === targetQuestion) ||
            page.items.find((item) => item.id === selected?.id) ||
            page.items[0] ||
            null;
          if (
            targetQuestion &&
            !page.items.some((item) => item.id === targetQuestion)
          )
            chosen = (
              await getGongsinmoongo<{ question: GongsinQuestion }>(
                gate.semesterId,
                "detail",
                { questionId: targetQuestion },
              )
            ).question;
          if (cancelled || id !== request.current) return;
          if (chosen) void loadConversation(chosen);
          else {
            setSelected(null);
            setMessages([]);
          }
        } else {
          let items = page.items;
          if (
            targetQuestion &&
            !items.some((item) => item.id === targetQuestion)
          ) {
            const detail = await getGongsinmoongo<{
              question: GongsinQuestion;
            }>(gate.semesterId, "detail", { questionId: targetQuestion });
            items = [...items, detail.question];
          }
          if (cancelled || id !== request.current) return;
          setMessages(questionOrder(items));
          setMessageCursor(page.nextCursor);
        }
      } catch (e) {
        if (!cancelled && id === request.current) setError(errorText(e));
      } finally {
        if (!cancelled && id === request.current) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      conversationRequest.current++;
    };
    // loadConversation intentionally reads the current page only when a fetch is requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    identity,
    gate.loaded,
    gate.enabled,
    gate.error,
    gate.revision,
    teacher,
    filter,
    listIndex,
    view,
    refresh,
    location.key,
  ]);

  useEffect(() => {
    const id = targetQuestion || selected?.id;
    if (id)
      conversationRef.current
        ?.querySelector<HTMLElement>(`[data-question="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [targetQuestion, selected?.id, messages]);
  async function command(
    action: string,
    fields: Record<string, unknown>,
  ): Promise<GongsinMutation | null> {
    if (busy) return null;
    const operationScope = mutationScopeRef.current;
    setBusy(true);
    setError("");
    const fingerprint = JSON.stringify({ identity, action, fields });
    if (mutation.current?.fingerprint !== fingerprint)
      mutation.current = { fingerprint, id: newGongsinRequestId() };
    try {
      const result = await manageGongsinmoongo(
        gate.semesterId,
        action,
        fields,
        mutation.current.id,
      );
      if (operationScope !== mutationScopeRef.current) return null;
      mutation.current = null;
      if (result.settings)
        setState((previous) =>
          previous ? { ...previous, settings: result.settings! } : previous,
        );
      if (stateCache.current) {
        stateCache.current.value = {
          ...stateCache.current.value,
          ...(result.settings ? { settings: result.settings } : {}),
          ...(result.acknowledgedWarningRevision !== undefined
            ? {
                acknowledgedWarningRevision: result.acknowledgedWarningRevision,
              }
            : {}),
        };
      }
      if (result.question) {
        const q = result.question;
        setMessages((items) =>
          questionOrder([...items.filter((item) => item.id !== q.id), q]),
        );
        setList((previous) => ({
          ...previous,
          items: previous.items
            .map((item) => (item.id === q.id ? q : item))
            .filter((item) =>
              filter === "waiting"
                ? !item.reply
                : filter === "selected"
                  ? item.selected
                  : true,
            ),
        }));
        if (teacher) setSelected(q);
      }
      return result;
    } catch (e) {
      if (operationScope === mutationScopeRef.current) setError(errorText(e));
      return null;
    } finally {
      if (operationScope === mutationScopeRef.current) setBusy(false);
    }
  }
  const submit = async () => {
    if (!question.trim() || !state) return;
    if (
      state.settings.warning.enabled &&
      state.acknowledgedWarningRevision < state.settings.warning.revision
    ) {
      setWarningOpen(true);
      return;
    }
    const result = await command("submit", {
      question: question.trim(),
      source,
    });
    if (result) {
      setQuestion("");
      notify("질문을 보냈습니다.");
    }
  };
  const reply = selected ? (drafts[selected.id] ?? selected.reply) : "";
  const answer = async () => {
    if (!selected || !reply.trim() || reply.trim() === selected.reply) return;
    const result = await command("answer", {
      questionId: selected.id,
      reply: reply.trim(),
      expectedRevision: selected.revision,
    });
    if (result) {
      setDrafts((previous) => {
        const next = { ...previous };
        delete next[selected.id];
        return next;
      });
      notify("답변을 보냈습니다.");
    }
  };
  const acknowledge = async () => {
    if (!state || !warningAgreed) return;
    const result = await command("ack", {
      warningRevision: state.settings.warning.revision,
    });
    if (result) {
      setState((previous) =>
        previous
          ? {
              ...previous,
              acknowledgedWarningRevision:
                result.acknowledgedWarningRevision ??
                previous.settings.warning.revision,
            }
          : previous,
      );
      setWarningOpen(false);
    }
  };
  const openStories = async () => {
    const operationScope = scopeRef.current;
    const contentRevision = storyRevision.current;
    setBusy(true);
    setError("");
    try {
      const page = await getGongsinmoongo<GongsinPage<GongsinStory>>(
        gate.semesterId,
        "stories",
      );
      if (
        operationScope !== scopeRef.current ||
        contentRevision !== storyRevision.current
      )
        return;
      setStories(page);
      setLoadedStoryScope(`${operationScope}:${contentRevision}`);
      setStoryIndex(0);
    } catch (e) {
      if (operationScope === scopeRef.current) setError(errorText(e));
    } finally {
      if (operationScope === scopeRef.current) setBusy(false);
    }
  };
  const moreStories = async () => {
    if (!stories.nextCursor) return;
    const operationScope = scopeRef.current;
    const contentRevision = storyRevision.current;
    setBusy(true);
    try {
      const page = await getGongsinmoongo<GongsinPage<GongsinStory>>(
        gate.semesterId,
        "stories",
        { cursor: stories.nextCursor },
      );
      if (
        operationScope !== scopeRef.current ||
        contentRevision !== storyRevision.current
      )
        return;
      setStoryIndex(stories.items.length);
      setStories({
        items: [...stories.items, ...page.items],
        nextCursor: page.nextCursor,
      });
    } catch (e) {
      if (operationScope === scopeRef.current) setError(errorText(e));
    } finally {
      if (operationScope === scopeRef.current) setBusy(false);
    }
  };
  const moreMessages = async () => {
    if (!messageCursor) return;
    const operationScope = scopeRef.current;
    if (teacher && selected) {
      await loadConversation(selected, true);
      return;
    }
    setConversationBusy(true);
    try {
      const page = await getGongsinmoongo<GongsinPage<GongsinQuestion>>(
        gate.semesterId,
        "questions",
        { cursor: messageCursor },
      );
      if (operationScope !== scopeRef.current) return;
      setMessages((items) => questionOrder([...items, ...page.items]));
      setMessageCursor(page.nextCursor);
    } catch (e) {
      if (operationScope === scopeRef.current) setError(errorText(e));
    } finally {
      if (operationScope === scopeRef.current) setConversationBusy(false);
    }
  };
  const restriction = state?.restriction;
  useEffect(() => {
    if (!restriction || restriction.until <= Date.now()) return;
    const timer = window.setTimeout(
      () =>
        setState((value) => (value ? { ...value, restriction: null } : value)),
      Math.min(restriction.until - Date.now() + 50, 2147483647),
    );
    return () => window.clearTimeout(timer);
  }, [restriction?.until]);
  const restricted = Boolean(restriction && restriction.until > Date.now());
  const sourceAllowed =
    source.kind === "general" ||
    state?.settings.allowedSources.includes(source.kind);
  const sendDisabled =
    busy ||
    !state?.settings.acceptingQuestions ||
    restricted ||
    !sourceAllowed ||
    !question.trim();
  const profile = selected?.profileEmojiId
    ? getProfileEmojiValueById(selected.profileEmojiId)
    : getDefaultProfileEmojiValue();

  return (
    <PortalWorkspace
      className={`teacher-sub-workspace teacher-sub-workspace--page gsm-workspace ${teacher ? "gsm-teacher" : "gsm-student"}`}
    >
      {teacher && (
        <PortalSubNavigation
          title="질문함"
          activeLabel={selected?.studentLabel || "질문 목록"}
          open={listOpen}
          onOpenChange={setListOpen}
          className="gsm-sidebar"
        >
          <label className="gsm-filter">
            질문
            <select
              value={filter}
              disabled={busy}
              onChange={(e) => {
                setFilter(e.target.value);
                setCursors([undefined]);
                setListIndex(0);
                setVisiblePage(0);
              }}
            >
              <option value="all">전체</option>
              <option value="waiting">답변 대기</option>
              <option value="selected">스토리 선정</option>
            </select>
          </label>
          <div className="gsm-question-list" aria-label="질문 목록">
            {(loadedIdentity.current === identity ? list.items : [])
              .slice(visiblePage * 4, visiblePage * 4 + 4)
              .map((item) => (
                <button
                  key={item.id}
                  disabled={busy}
                  type="button"
                  className={`gsm-question-row${item.id === selected?.id ? " is-active" : ""}`}
                  onClick={() => {
                    setView("inbox");
                    setListOpen(false);
                    void loadConversation(item);
                  }}
                >
                  <span className="gsm-meta">
                    <span>{GONGSIN_SOURCE_LABELS[item.source.kind]}</span>
                    <span>
                      {item.selected
                        ? "스토리 선정"
                        : item.reply
                          ? "답변 완료"
                          : "답변 대기"}
                    </span>
                  </span>
                  <strong>{item.question}</strong>
                  <span>{item.studentLabel}</span>
                </button>
              ))}
            {!loading && !list.items.length && (
              <p className="gsm-empty">아직 도착한 질문이 없습니다.</p>
            )}
          </div>
          <nav className="gsm-pagination" aria-label="질문 목록 페이지">
            <button
              className="gsm-icon"
              aria-label="이전 질문 목록"
              disabled={(listIndex === 0 && visiblePage === 0) || loading}
              onClick={() => {
                if (visiblePage > 0) setVisiblePage((i) => i - 1);
                else {
                  setVisiblePage(4);
                  setListIndex((i) => i - 1);
                }
              }}
            >
              <Chevron direction="left" />
            </button>
            <span>{listIndex * 5 + visiblePage + 1}</span>
            <button
              className="gsm-icon"
              aria-label="다음 질문 목록"
              disabled={
                (!list.nextCursor &&
                  (visiblePage + 1) * 4 >= list.items.length) ||
                loading
              }
              onClick={() => {
                if ((visiblePage + 1) * 4 < list.items.length) {
                  setVisiblePage((i) => i + 1);
                  return;
                }
                setCursors((items) => [
                  ...items.slice(0, listIndex + 1),
                  list.nextCursor!,
                ]);
                setListIndex((i) => i + 1);
                setVisiblePage(0);
              }}
            >
              <Chevron />
            </button>
          </nav>
        </PortalSubNavigation>
      )}
      <div className="teacher-sub-content gsm-content">
        <header
          className={
            teacher ? "ws-page-header gsm-page-header" : "gsm-page-header"
          }
        >
          <div className="gsm-title-line">
            <h1>
              <GongsinBrand />
            </h1>
            {teacher && state && loadedIdentity.current === identity && (
              <span
                className={`gsm-status${state.settings.enabled ? " is-active" : ""}`}
              >
                {state.settings.enabled ? "운영 중" : "학생 비공개"}
              </span>
            )}
          </div>
          <nav className="ws-page-tabs" aria-label="공부의 신문고 보기">
            <button
              aria-pressed={view === "inbox"}
              onClick={() => setView("inbox")}
            >
              질문함
            </button>
            {teacher && state?.canManageSettings && (
              <button
                aria-pressed={view === "settings"}
                onClick={() => setView("settings")}
              >
                운영 설정
              </button>
            )}
          </nav>
          <RefreshButton
            className="gsm-refresh"
            label="질문함 새로고침"
            loading={loading || !gate.loaded}
            disabled={busy || conversationBusy}
            onClick={() =>
              gate.error ? gate.retry() : setRefresh((i) => i + 1)
            }
          />
        </header>
        {error && (
          <div className="gsm-error" role="alert">
            {error}
            <button type="button" onClick={() => setRefresh((i) => i + 1)}>
              다시 불러오기
            </button>
          </div>
        )}
        {!gate.loaded ||
        (loading && !state) ||
        (allowed && loadedIdentity.current !== identity) ? (
          error ? null : (
            <InlineLoading />
          )
        ) : !allowed ? (
          <p className="gsm-empty" role="status">
            {gate.error
              ? "질문함을 확인하지 못했습니다. 새로고침해 주세요."
              : "지금은 질문함을 이용할 수 없습니다."}
          </p>
        ) : view === "settings" && teacher && state?.canManageSettings ? (
          <SettingsEditor
            settings={state.settings}
            busy={busy}
            onSave={async (next) => {
              const result = await command("settings", {
                settings: next,
                expectedRevision: state.settings.revision,
              });
              if (result) notify("운영 설정을 저장했습니다.");
            }}
            onRestriction={async (studentId, durationMs, reason) => {
              const result = await command("restrict", {
                studentId,
                durationMs,
                reason,
              });
              if (result)
                notify(
                  durationMs
                    ? "질문 제한을 적용했습니다."
                    : "질문 제한을 해제했습니다.",
                );
              return Boolean(result);
            }}
            semesterId={gate.semesterId}
          />
        ) : (
          <section className="gsm-chat" aria-label="공부의 신문고 대화">
            <header className="gsm-chat-header">
              <span className="gsm-avatar" aria-hidden="true">
                {teacher ? profile || getDefaultProfileEmojiValue() : "👩‍🏫"}
              </span>
              <h2>{teacher ? selected?.studentLabel || "질문함" : "선생님"}</h2>
              {teacher && selected ? (
                <div className="gsm-teacher-actions">
                  <button
                    className="gsm-button"
                    onClick={() => setRestrictionOpen(true)}
                  >
                    질문 제한
                  </button>
                  <button
                    className="gsm-button"
                    onClick={() => setStoryEdit(true)}
                  >
                    공개용 문구 편집
                  </button>
                  <span className="gsm-selected">
                    {selected.selected ? "스토리 선정" : ""}
                  </span>
                </div>
              ) : (
                !teacher && (
                  <>
                    <span className="gsm-private">나와 선생님만</span>
                    {state?.settings.storiesVisible && (
                      <button
                        className="gsm-story-launch"
                        onClick={() => void openStories()}
                        disabled={busy}
                      >
                        <span aria-hidden="true">✦</span> 선생님 스토리
                      </button>
                    )}
                    <button
                      className="gsm-icon"
                      aria-label="질문 이용 안내"
                      onClick={() => setWarningOpen(true)}
                    >
                      ⓘ
                    </button>
                  </>
                )
              )}
            </header>
            <div
              className="gsm-conversation"
              ref={conversationRef}
              aria-label={
                teacher ? "학생과의 개인 대화" : "나의 질문과 선생님 답변"
              }
            >
              {messageCursor && (
                <button
                  className="gsm-load-previous"
                  disabled={conversationBusy}
                  onClick={() => void moreMessages()}
                >
                  이전 질문 더 보기
                </button>
              )}
              {!messages.length && (
                <p className="gsm-empty">
                  {teacher
                    ? "질문이 도착하면 이곳에서 답변할 수 있습니다."
                    : "궁금한 내용을 선생님께 물어보세요."}
                </p>
              )}
              {messages.map((item) => (
                <article
                  key={item.id}
                  data-question={item.id}
                  className="gsm-thread"
                >
                  <div className={`gsm-message ${teacher ? "" : "is-mine"}`}>
                    <SourceLink source={item.source} teacher={teacher} />
                    {teacher ? (
                      <button
                        className={`gsm-bubble gsm-question${selected?.id === item.id ? " is-selected" : ""}`}
                        disabled={busy}
                        onClick={() => setSelected(item)}
                        aria-label={`이 질문에 답변하기: ${item.question}`}
                      >
                        {item.question}
                      </button>
                    ) : (
                      <div className="gsm-bubble gsm-question">
                        {item.question}
                      </div>
                    )}
                    <time>{timeText(item.createdAt)}</time>
                  </div>
                  {item.reply ? (
                    <div className={`gsm-message ${teacher ? "is-mine" : ""}`}>
                      <div className="gsm-bubble gsm-reply">
                        <strong>{teacher ? "내 답변" : "선생님"}</strong>
                        <p>{item.reply}</p>
                      </div>
                    </div>
                  ) : (
                    <span className="gsm-waiting">답변 대기</span>
                  )}
                </article>
              ))}
            </div>
            <div className="gsm-composer">
              {teacher ? (
                <>
                  <label htmlFor="gongsin-reply" className="gsm-compose-label">
                    {selected?.reply ? "답변 수정" : "학생에게 답변"}
                    <span>{reply.length}/2,000</span>
                  </label>
                  <div className="gsm-compose-row">
                    <textarea
                      id="gongsin-reply"
                      value={reply}
                      maxLength={2000}
                      disabled={!selected || busy}
                      onChange={(e) =>
                        selected &&
                        setDrafts((items) => ({
                          ...items,
                          [selected.id]: e.target.value,
                        }))
                      }
                      placeholder="학생에게 답변해 주세요."
                    />
                    <button
                      className="gsm-send"
                      aria-label="답변 보내기"
                      disabled={
                        busy ||
                        !selected ||
                        !reply.trim() ||
                        reply.trim() === selected.reply
                      }
                      onClick={() => void answer()}
                    >
                      <Chevron direction="up" />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {restricted && (
                    <p className="gsm-restriction" role="status">
                      {timeText(restriction!.until)}까지 질문할 수 없습니다.{" "}
                      {restriction!.reason}
                    </p>
                  )}
                  {!state?.settings.acceptingQuestions && (
                    <p className="gsm-restriction">
                      지금은 새 질문을 받지 않습니다.
                    </p>
                  )}
                  {!sourceAllowed && (
                    <p className="gsm-restriction">
                      이 자료에서는 지금 질문할 수 없습니다.
                    </p>
                  )}
                  <label
                    htmlFor="gongsin-question"
                    className="gsm-compose-label"
                  >
                    <span>
                      {source.kind === "general"
                        ? "학습 질문"
                        : GONGSIN_SOURCE_LABELS[source.kind]}
                      {source.page ? ` · ${source.page}쪽` : ""}
                    </span>
                    <span>{question.length}/2,000</span>
                  </label>
                  <div className="gsm-compose-row">
                    <textarea
                      id="gongsin-question"
                      value={question}
                      maxLength={2000}
                      disabled={
                        busy ||
                        restricted ||
                        !state?.settings.acceptingQuestions ||
                        !sourceAllowed
                      }
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="어떤 점이 궁금한가요?"
                    />
                    <button
                      className="gsm-send"
                      aria-label="질문 보내기"
                      disabled={sendDisabled}
                      onClick={() => void submit()}
                    >
                      <Chevron direction="up" />
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        )}
      </div>
      {warningOpen &&
        state &&
        !teacher &&
        loadedIdentity.current === identity && (
          <Dialog
            title={state.settings.warning.title || "질문 이용 안내"}
            error={error}
            onClose={() => setWarningOpen(false)}
          >
            <p className="gsm-warning-copy">{state.settings.warning.body}</p>
            {state.settings.warning.enabled &&
            state.acknowledgedWarningRevision <
              state.settings.warning.revision ? (
              <>
                <label className="gsm-agree">
                  <input
                    type="checkbox"
                    checked={warningAgreed}
                    onChange={(e) => setWarningAgreed(e.target.checked)}
                  />
                  학습 질문 용도와 이용 제한 안내를 확인했습니다.
                </label>
                <div className="gsm-dialog-actions">
                  <button
                    className="gsm-button"
                    onClick={() => {
                      setWarningOpen(false);
                      navigate("/student/dashboard");
                    }}
                  >
                    나가기
                  </button>
                  <button
                    className="gsm-primary"
                    disabled={!warningAgreed || busy}
                    onClick={() => void acknowledge()}
                  >
                    확인하고 시작하기
                  </button>
                </div>
              </>
            ) : (
              <button
                className="gsm-primary"
                onClick={() => setWarningOpen(false)}
              >
                확인
              </button>
            )}
          </Dialog>
        )}
      {storyEdit && selected && loadedIdentity.current === identity && (
        <StoryEditor
          question={selected}
          error={error}
          busy={busy}
          onClose={() => setStoryEdit(false)}
          onSave={async (publicQuestion, publicReply, selectedStory) => {
            const result = await command("story", {
              questionId: selected.id,
              publicQuestion,
              publicReply,
              selected: selectedStory,
              expectedRevision: selected.revision,
            });
            if (result) {
              setStoryEdit(false);
              notify(
                selectedStory
                  ? "스토리를 공개했습니다."
                  : "스토리를 비공개로 바꿨습니다.",
              );
            }
          }}
        />
      )}
      {restrictionOpen &&
        selected &&
        state &&
        loadedIdentity.current === identity && (
          <RestrictionEditor
            studentId={selected.studentId}
            studentLabel={selected.studentLabel}
            error={error}
            initialDuration={state.settings.defaultRestrictionMs}
            busy={busy}
            onClose={() => setRestrictionOpen(false)}
            onSave={async (durationMs, reason) => {
              const result = await command("restrict", {
                studentId: selected.studentId,
                durationMs,
                reason,
              });
              if (result) {
                setRestrictionOpen(false);
                notify(
                  durationMs
                    ? "질문 제한을 적용했습니다."
                    : "질문 제한을 해제했습니다.",
                );
              }
            }}
          />
        )}
      {allowed &&
        loadedStoryScope === `${scope}:${gate.contentRevision}` &&
        storyIndex !== null && (
          <Dialog
            title="선생님 스토리"
            error={error}
            onClose={() => setStoryIndex(null)}
          >
            {stories.items[storyIndex] ? (
              <div className="gsm-story">
                <div className="gsm-story-progress">
                  {stories.items.map((item, index) => (
                    <span
                      key={item.id}
                      className={index === storyIndex ? "is-active" : ""}
                    />
                  ))}
                </div>
                <div className="gsm-story-question">
                  <span>함께 알아봐요</span>
                  <h3>{stories.items[storyIndex].question}</h3>
                </div>
                <p className="gsm-story-answer">
                  {stories.items[storyIndex].answer}
                </p>
                <SourceLink source={stories.items[storyIndex].source} />
                <nav className="gsm-pagination" aria-label="스토리 이동">
                  <button
                    className="gsm-icon"
                    aria-label="이전 스토리"
                    disabled={storyIndex === 0}
                    onClick={() => setStoryIndex(storyIndex - 1)}
                  >
                    <Chevron direction="left" />
                  </button>
                  <span>
                    {storyIndex + 1} / {stories.items.length}
                    {stories.nextCursor ? "+" : ""}
                  </span>
                  <button
                    className="gsm-icon"
                    aria-label="다음 스토리"
                    disabled={
                      busy ||
                      (storyIndex === stories.items.length - 1 &&
                        !stories.nextCursor)
                    }
                    onClick={() =>
                      storyIndex < stories.items.length - 1
                        ? setStoryIndex(storyIndex + 1)
                        : void moreStories()
                    }
                  >
                    <Chevron />
                  </button>
                </nav>
              </div>
            ) : (
              <p className="gsm-empty">아직 선정된 스토리가 없습니다.</p>
            )}
          </Dialog>
        )}
    </PortalWorkspace>
  );
}

function StoryEditor({
  question,
  error,
  busy,
  onClose,
  onSave,
}: {
  question: GongsinQuestion;
  error: string;
  busy: boolean;
  onClose: () => void;
  onSave: (question: string, reply: string, selected: boolean) => void;
}) {
  const [publicQuestion, setQuestion] = useState(question.publicQuestion);
  const [reply, setReply] = useState(question.publicReply);
  const [checked, setChecked] = useState(false);
  return (
    <Dialog title="공개용 문구 편집" error={error} onClose={onClose}>
      <label className="gsm-field">
        공개 질문
        <textarea
          aria-label="공개 질문"
          rows={3}
          maxLength={500}
          value={publicQuestion}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </label>
      <label className="gsm-field">
        공개 답변
        <textarea
          aria-label="공개 답변"
          rows={5}
          maxLength={2000}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
        />
      </label>
      <label className="gsm-agree">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        이름·학급·개인 답안 등 학생을 알아볼 수 있는 내용을 지웠습니다.
      </label>
      <div className="gsm-dialog-actions">
        {question.selected && (
          <button
            className="gsm-button"
            disabled={busy}
            onClick={() => onSave(publicQuestion, reply, false)}
          >
            선정 해제
          </button>
        )}
        <button
          className="gsm-primary"
          disabled={busy || !checked || !publicQuestion.trim() || !reply.trim()}
          onClick={() => onSave(publicQuestion.trim(), reply.trim(), true)}
        >
          스토리 {question.selected ? "수정" : "선정"}
        </button>
      </div>
    </Dialog>
  );
}
function RestrictionEditor({
  studentLabel,
  error,
  initialDuration,
  busy,
  onClose,
  onSave,
}: {
  studentId: string;
  studentLabel: string;
  error: string;
  initialDuration: number;
  busy: boolean;
  onClose: () => void;
  onSave: (duration: number, reason: string) => void;
}) {
  const [duration, setDuration] = useState(initialDuration);
  const [reason, setReason] = useState("");
  return (
    <Dialog title={`${studentLabel} 질문 제한`} error={error} onClose={onClose}>
      <label className="gsm-field">
        제한 기간
        <select
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
        >
          {DURATIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="gsm-field">
        학생에게 표시할 사유
        <textarea
          aria-label="학생에게 표시할 사유"
          rows={3}
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="gsm-dialog-actions">
        <button
          className="gsm-button"
          disabled={busy}
          onClick={() => onSave(0, "")}
        >
          제한 해제
        </button>
        <button
          className="gsm-primary"
          disabled={busy || !reason.trim()}
          onClick={() => onSave(duration, reason.trim())}
        >
          제한 적용
        </button>
      </div>
    </Dialog>
  );
}

function SettingsEditor({
  settings,
  busy,
  onSave,
  onRestriction,
  semesterId,
}: {
  settings: GongsinSettings;
  busy: boolean;
  onSave: (s: GongsinSettings) => void;
  onRestriction: (
    studentId: string,
    duration: number,
    reason: string,
  ) => Promise<boolean>;
  semesterId: string;
}) {
  const [draft, setDraft] = useState(settings);
  const [restrictions, setRestrictions] = useState<
    GongsinPage<
      GongsinRestriction & { studentId: string; studentLabel: string }
    >
  >({ items: [], nextCursor: null });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const loadRequest = useRef(0);
  useEffect(() => setDraft(settings), [settings]);
  const load = async (more = false) => {
    const id = ++loadRequest.current;
    setLoading(true);
    setError("");
    try {
      const result = await getGongsinmoongo<typeof restrictions>(
        semesterId,
        "restrictions",
        more && restrictions.nextCursor
          ? { cursor: restrictions.nextCursor }
          : {},
      );
      if (id !== loadRequest.current) return;
      setRestrictions((previous) =>
        more
          ? { ...result, items: [...previous.items, ...result.items] }
          : result,
      );
    } catch (e) {
      if (id === loadRequest.current) setError(errorText(e));
    } finally {
      if (id === loadRequest.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    return () => {
      loadRequest.current++;
    };
  }, [semesterId]);
  const toggle = (
    key:
      | "enabled"
      | "acceptingQuestions"
      | "storiesVisible"
      | "teacherQuestionNotifications"
      | "studentReplyNotifications",
    label: string,
  ) => (
    <label className="gsm-toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={draft[key]}
        onChange={(e) =>
          setDraft((value) => ({ ...value, [key]: e.target.checked }))
        }
      />
    </label>
  );
  return (
    <section className="gsm-settings" aria-label="운영 설정">
      <div className="gsm-settings-body">
        <section className="gsm-settings-section" aria-label="기본 운영">
          <h2>기본</h2>
          <div className="gsm-settings-options">
            {toggle("enabled", "학생 공개")}
            {toggle("acceptingQuestions", "질문 접수")}
            {toggle("storiesVisible", "선정 스토리 공개")}
            <label className="gsm-setting-duration">
              기본 제한 기간
              <select
                value={draft.defaultRestrictionMs}
                onChange={(e) =>
                  setDraft((value) => ({
                    ...value,
                    defaultRestrictionMs: Number(e.target.value),
                  }))
                }
              >
                {DURATIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
        <section className="gsm-settings-section" aria-label="알림 설정">
          <h2>알림</h2>
          <div className="gsm-settings-options">
            {toggle(
              "teacherQuestionNotifications",
              "새 질문을 기존 교사 알림으로 받기",
            )}
            {toggle(
              "studentReplyNotifications",
              "답변을 기존 학생 알림으로 보내기",
            )}
          </div>
        </section>
        <section className="gsm-settings-section" aria-label="학습 연결 설정">
          <h2>학습 연결</h2>
          <div className="gsm-settings-options">
            {(
              Object.keys(GONGSIN_SOURCE_LABELS) as Array<GongsinSource["kind"]>
            )
              .filter((kind) => kind !== "general")
              .map((kind) => (
                <label className="gsm-toggle" key={kind}>
                  {kind === "mock" ? "모의고사" : GONGSIN_SOURCE_LABELS[kind]}
                  <input
                    type="checkbox"
                    aria-label={GONGSIN_SOURCE_LABELS[kind]}
                    checked={draft.allowedSources.includes(
                      kind as Exclude<typeof kind, "general">,
                    )}
                    onChange={(e) =>
                      setDraft((value) => ({
                        ...value,
                        allowedSources: e.target.checked
                          ? [
                              ...value.allowedSources,
                              kind as Exclude<typeof kind, "general">,
                            ]
                          : value.allowedSources.filter(
                              (item) => item !== kind,
                            ),
                      }))
                    }
                  />
                </label>
              ))}
          </div>
        </section>
        <section className="gsm-settings-section" aria-label="이용 안내 설정">
          <h2>이용 안내</h2>
          <div>
            <div className="gsm-warning-heading">
              <label className="gsm-toggle">
                첫 사용 안내
                <input
                  type="checkbox"
                  checked={draft.warning.enabled}
                  onChange={(e) =>
                    setDraft((value) => ({
                      ...value,
                      warning: { ...value.warning, enabled: e.target.checked },
                    }))
                  }
                />
              </label>
              <label className="gsm-warning-title">
                <span>제목</span>
                <input
                  aria-label="안내 제목"
                  value={draft.warning.title}
                  maxLength={60}
                  onChange={(e) =>
                    setDraft((value) => ({
                      ...value,
                      warning: { ...value.warning, title: e.target.value },
                    }))
                  }
                />
              </label>
            </div>
            <label className="gsm-warning-body">
              <span>안내 문구</span>
              <textarea
                rows={3}
                value={draft.warning.body}
                maxLength={600}
                onChange={(e) =>
                  setDraft((value) => ({
                    ...value,
                    warning: { ...value.warning, body: e.target.value },
                  }))
                }
              />
            </label>
          </div>
        </section>
        <section className="gsm-settings-section" aria-label="학생 제한 관리">
          <h2>학생 제한</h2>
          <div>
            {error && (
              <div role="alert">
                {error}{" "}
                <button
                  className="gsm-button"
                  disabled={loading}
                  onClick={() => void load()}
                >
                  다시 불러오기
                </button>
              </div>
            )}
            {loading && <InlineLoading />}
            {!loading && !error && !restrictions.items.length && (
              <p className="gsm-restriction-empty">
                현재 질문이 제한된 학생이 없습니다.
              </p>
            )}
            {restrictions.items.map((item) => (
              <div key={item.studentId} className="gsm-restriction-row">
                <strong>{item.studentLabel}</strong>
                <span>
                  {timeText(item.until)}까지 · {item.reason}
                </span>
                <button
                  className="gsm-button"
                  disabled={busy}
                  onClick={async () => {
                    if (await onRestriction(item.studentId, 0, "")) void load();
                  }}
                >
                  해제
                </button>
              </div>
            ))}
            {restrictions.nextCursor && (
              <button
                className="gsm-button"
                disabled={loading}
                onClick={() => void load(true)}
              >
                더 보기
              </button>
            )}
          </div>
        </section>
      </div>
      <div className="gsm-settings-actions">
        <button
          className="gsm-button"
          disabled={busy || JSON.stringify(draft) === JSON.stringify(settings)}
          onClick={() => setDraft(settings)}
        >
          되돌리기
        </button>
        <button
          className="gsm-primary"
          disabled={
            busy ||
            JSON.stringify(draft) === JSON.stringify(settings) ||
            (draft.warning.enabled &&
              (!draft.warning.title.trim() || !draft.warning.body.trim()))
          }
          onClick={() => onSave(draft)}
        >
          변경사항 저장
        </button>
      </div>
    </section>
  );
}
