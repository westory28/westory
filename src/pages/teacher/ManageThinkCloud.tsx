import { useAppToast } from "../../components/common/AppToastProvider";
import PortalWorkspace from "../../components/common/PortalWorkspace";
import { InlineLoading } from "../../components/common/LoadingState";
import NumericInput from "../../components/common/NumericInput";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { acquirePageScrollLock } from "../../lib/pageScrollLock";
import "../../components/common/portalPage.css";
import "../../components/common/thinkCloudWorkspace.css";
import "./manageThinkCloud.css";
import { doc, getDoc } from "firebase/firestore";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../lib/firebase";
import WordCloudView from "../../components/common/WordCloudView";
import {
  DEFAULT_THINK_CLOUD_OPTIONS,
  formatClassLabel,
  formatGradeLabel,
  type ThinkCloudOptions,
  type ThinkCloudResponse,
} from "../../lib/thinkCloud";
import { canWriteLessonManagement } from "../../lib/permissions";

import {
  createThinkCloudSession,
  deleteThinkCloudSession,
  transitionThinkCloudSession,
  subscribeThinkCloudState,
  type CanonicalThinkCloudSession as SessionWithId,
} from "../../lib/thinkCloudLifecycle";
type SchoolOption = { value: string; label: string };
type StudentRosterItem = {
  uid: string;
  name: string;
  number: string;
};

const defaultGradeOptions: SchoolOption[] = [
  { value: "1", label: "1학년" },
  { value: "2", label: "2학년" },
  { value: "3", label: "3학년" },
];

const defaultClassOptions: SchoolOption[] = Array.from(
  { length: 12 },
  (_, i) => ({
    value: String(i + 1),
    label: `${i + 1}반`,
  }),
);

const ManageThinkCloud: React.FC = () => {
  const { config, currentUser, userData } = useAuth();
  const { showToast } = useAppToast();
  const [activeSessionIds, setActiveSessionIds] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessions, setSessions] = useState<SessionWithId[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const subscriptionRef = useRef<ReturnType<
    typeof subscribeThinkCloudState
  > | null>(null);
  const [responses, setResponses] = useState<
    Array<ThinkCloudResponse & { id: string }>
  >([]);
  const [loadingAction, setLoadingAction] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [view, setView] = useState<"list" | "create" | "detail">("list");
  const [readError, setReadError] = useState(false);
  const [readErrorMessage, setReadErrorMessage] = useState("");
  const [readOnly, setReadOnly] = useState(true);
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [loadedSessionId, setLoadedSessionId] = useState("");
  const [loadedScopeKey, setLoadedScopeKey] = useState("");
  const scopeKey = `${currentUser?.uid || ""}:${config?.year || ""}:${config?.semester || ""}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const subscriptionScopeRef = useRef("");
  const actionAttemptRef = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const presentationTrigger = useRef<HTMLButtonElement>(null);
  const presentationClose = useRef<HTMLButtonElement>(null);
  const presentationSessionRef = useRef("");
  const focusRequested = useRef(false);
  const returnSessionId = useRef("");
  const actionInFlight = useRef(false);
  const createComposing = useRef(false);
  const [cloudModalOpen, setCloudModalOpen] = useState(false);
  const [classStudents, setClassStudents] = useState<StudentRosterItem[]>([]);
  const [gradeOptions, setGradeOptions] =
    useState<SchoolOption[]>(defaultGradeOptions);
  const [classOptions, setClassOptions] =
    useState<SchoolOption[]>(defaultClassOptions);
  const [targetGrade, setTargetGrade] = useState(defaultGradeOptions[0].value);
  const [targetClass, setTargetClass] = useState(defaultClassOptions[0].value);
  const [filterGrade, setFilterGrade] = useState("all");
  const [filterClass, setFilterClass] = useState("all");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState<ThinkCloudOptions>(
    DEFAULT_THINK_CLOUD_OPTIONS,
  );
  const canEdit =
    loadedScopeKey === scopeKey &&
    !initialLoading &&
    !readError &&
    !readOnly &&
    canWriteLessonManagement(userData, currentUser?.email || "");

  const selectedSession = useMemo(
    () =>
      loadedScopeKey === scopeKey
        ? sessions.find((session) => session.id === selectedSessionId) || null
        : null,
    [sessions, selectedSessionId, loadedScopeKey, scopeKey],
  );
  const dataReady =
    !!selectedSession &&
    loadedScopeKey === scopeKey &&
    !initialLoading &&
    !readError &&
    loadedSessionId === selectedSession.id;
  const presentationReady =
    cloudModalOpen &&
    dataReady &&
    selectedSession?.id === presentationSessionRef.current;

  const filteredSessions = useMemo(
    () =>
      (loadedScopeKey === scopeKey ? sessions : []).filter((session) => {
        if (filterGrade !== "all" && session.targetGrade !== filterGrade)
          return false;
        if (filterClass !== "all" && session.targetClass !== filterClass)
          return false;
        return true;
      }),
    [sessions, filterGrade, filterClass, loadedScopeKey, scopeKey],
  );

  useEffect(() => {
    const sameScope = subscriptionScopeRef.current === scopeKey;
    subscriptionScopeRef.current = scopeKey;
    setLoadedScopeKey("");
    setLoadedSessionId("");
    setReadOnly(true);
    setResponses([]);
    setClassStudents([]);
    setActiveSessionIds([]);
    if (!sameScope) {
      actionAttemptRef.current += 1;
      actionInFlight.current = false;
      setLoadingAction(false);
      setCloudModalOpen(false);
      setSessions([]);
      setSelectedSessionId("");
      setView("list");
      setMessage("");
      setReadError(false);
      setReadErrorMessage("");
      setTitle("");
      setDescription("");
      setOptions(DEFAULT_THINK_CLOUD_OPTIONS);
      returnSessionId.current = "";
      presentationSessionRef.current = "";
    }
    if (!currentUser) {
      setInitialLoading(false);
      return;
    }
    let active = true;
    setInitialLoading(true);
    const subscription = subscribeThinkCloudState(
      config,
      "teacher",
      sameScope ? selectedSessionId : "",
      (state) => {
        if (!active || scopeRef.current !== scopeKey) return;
        setInitialLoading(false);
        setReadError(false);
        setReadErrorMessage("");
        setReadOnly(state.readOnly);
        setLoadedScopeKey(scopeKey);
        setLoadedSessionId(state.thinkCloudSelectedSessionId || "");
        setSessions(state.thinkCloudSessions);
        setResponses(state.thinkCloudResponses);
        setClassStudents(state.thinkCloudRoster);
        setActiveSessionIds(state.thinkCloudState.activeSessionIds || []);
        setSelectedSessionId((selected) =>
          state.thinkCloudSessions.some((session) => session.id === selected)
            ? selected
            : state.thinkCloudSelectedSessionId ||
              state.thinkCloudSessions[0]?.id ||
              "",
        );
      },
      (error) => {
        if (!active || scopeRef.current !== scopeKey) return;
        setInitialLoading(false);
        setReadError(true);
        setReadOnly(true);
        setLoadedScopeKey("");
        setLoadedSessionId("");
        setCloudModalOpen(false);
        setView((current) => (current === "create" ? "create" : "list"));
        setSessions([]);
        setResponses([]);
        setClassStudents([]);
        setActiveSessionIds([]);
        setSelectedSessionId("");
        setReadErrorMessage(
          error instanceof Error
            ? error.message
            : "생각모아를 불러오지 못했습니다.",
        );
      },
    );
    subscriptionRef.current = subscription;
    return () => {
      active = false;
      subscription();
      if (subscriptionRef.current === subscription)
        subscriptionRef.current = null;
    };
  }, [scopeKey, refreshKey]);

  useEffect(() => {
    if (loadedScopeKey !== scopeKey) return;
    subscriptionRef.current?.selectSession(selectedSessionId);
  }, [selectedSessionId, loadedScopeKey, scopeKey]);

  useEffect(
    () => () => {
      actionAttemptRef.current += 1;
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

  const pendingStudents = useMemo(() => {
    const submitted = new Set(
      responses
        .map((item) => String(item.uid || "").trim())
        .filter((uid) => uid.length > 0),
    );
    return classStudents.filter((student) => !submitted.has(student.uid));
  }, [classStudents, responses]);

  const resetCreateForm = () => {
    setTitle("");
    setDescription("");
    setOptions(DEFAULT_THINK_CLOUD_OPTIONS);
    setTargetGrade(gradeOptions[0]?.value || "1");
    setTargetClass(classOptions[0]?.value || "1");
  };

  useEffect(() => {
    const loadSchoolConfig = async () => {
      try {
        const schoolSnap = await getDoc(
          doc(db, "site_settings", "school_config"),
        );
        if (!schoolSnap.exists()) return;
        const data = schoolSnap.data() as {
          grades?: Array<{ value?: string; label?: string }>;
          classes?: Array<{ value?: string; label?: string }>;
        };

        if (Array.isArray(data.grades) && data.grades.length > 0) {
          const nextGrades = data.grades
            .map((item) => ({
              value: String(item.value || "").trim(),
              label: String(item.label || "").trim(),
            }))
            .filter((item) => item.value && item.label);
          if (nextGrades.length > 0) setGradeOptions(nextGrades);
        }

        if (Array.isArray(data.classes) && data.classes.length > 0) {
          const nextClasses = data.classes
            .map((item) => ({
              value: String(item.value || "").trim(),
              label: String(item.label || "").trim(),
            }))
            .filter((item) => item.value && item.label);
          if (nextClasses.length > 0) setClassOptions(nextClasses);
        }
      } catch (error) {
        console.warn("Failed to load school options for think cloud:", error);
      }
    };

    void loadSchoolConfig();
  }, []);

  useEffect(() => {
    if (!gradeOptions.some((item) => item.value === targetGrade)) {
      setTargetGrade(gradeOptions[0]?.value || "1");
    }
  }, [gradeOptions, targetGrade]);

  useEffect(() => {
    if (!classOptions.some((item) => item.value === targetClass)) {
      setTargetClass(classOptions[0]?.value || "1");
    }
  }, [classOptions, targetClass]);

  useEffect(() => {
    if (
      filterGrade !== "all" &&
      !gradeOptions.some((item) => item.value === filterGrade)
    ) {
      setFilterGrade("all");
    }
  }, [filterGrade, gradeOptions]);

  useEffect(() => {
    if (
      filterClass !== "all" &&
      !classOptions.some((item) => item.value === filterClass)
    ) {
      setFilterClass("all");
    }
  }, [filterClass, classOptions]);

  useEffect(() => {
    if (!focusRequested.current) return;
    focusRequested.current = false;
    if (view === "list" && returnSessionId.current) {
      const target = document.querySelector<HTMLButtonElement>(
        `[data-think-session="${CSS.escape(returnSessionId.current)}"]`,
      );
      if (target) {
        target.focus({ preventScroll: true });
        return;
      }
    }
    headingRef.current?.focus({ preventScroll: true });
  }, [view, selectedSessionId]);

  useEffect(() => {
    if (!cloudModalOpen) return;
    if (!presentationReady) {
      setCloudModalOpen(false);
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    dialog.showModal();
    const releaseScrollLock = acquirePageScrollLock();
    presentationClose.current?.focus({ preventScroll: true });
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey)
        return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], area[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]',
        ),
      )
        .filter((element) => {
          const style = window.getComputedStyle(element);
          return (
            element.tabIndex >= 0 &&
            !element.matches(':disabled, [aria-disabled="true"]') &&
            !element.closest("[hidden], [inert]") &&
            element.getClientRects().length > 0 &&
            style.visibility !== "hidden" &&
            style.visibility !== "collapse"
          );
        })
        .sort(
          (left, right) =>
            (left.tabIndex || Infinity) - (right.tabIndex || Infinity),
        );
      event.preventDefault();
      if (!focusable.length) {
        dialog.focus({ preventScroll: true });
        return;
      }
      const currentIndex = focusable.indexOf(
        document.activeElement as HTMLElement,
      );
      const nextIndex = event.shiftKey
        ? currentIndex <= 0
          ? focusable.length - 1
          : currentIndex - 1
        : (currentIndex + 1) % focusable.length;
      focusable[nextIndex].focus({ preventScroll: true });
    };
    document.addEventListener("keydown", trapFocus, true);
    return () => {
      document.removeEventListener("keydown", trapFocus, true);
      dialog.close();
      releaseScrollLock();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
      else headingRef.current?.focus({ preventScroll: true });
    };
  }, [cloudModalOpen, presentationReady, selectedSession?.id, scopeKey]);

  const beginAction = () => {
    const attempt = ++actionAttemptRef.current;
    const actionScope = scopeKey;
    actionInFlight.current = true;
    setLoadingAction(true);
    setMessage("");
    return () =>
      scopeRef.current === actionScope && actionAttemptRef.current === attempt;
  };

  const showList = () => {
    focusRequested.current = true;
    setView("list");
    setMessage("");
  };

  const selectSession = (id: string) => {
    returnSessionId.current = id;
    focusRequested.current = true;
    setView("detail");
    setSelectedSessionId(id);
    setMessage("");
  };

  const openCreateMode = () => {
    if (!canEdit || actionInFlight.current) return;
    focusRequested.current = true;
    setView("create");
    setMessage("");
    resetCreateForm();
  };

  const handleStartSession = async () => {
    if (!canEdit || actionInFlight.current) return;
    const safeTitle = title.trim();
    if (!safeTitle) {
      setMessage("주제를 입력해 주세요.");
      return;
    }
    if (!targetGrade || !targetClass) {
      setMessage("학년과 반을 선택해 주세요.");
      return;
    }
    if (!currentUser) return;

    const isCurrentAction = beginAction();
    try {
      const added = await createThinkCloudSession(config, {
        title: safeTitle,
        description: description.trim(),
        targetGrade,
        targetClass,
        targetGradeLabel:
          gradeOptions.find((item) => item.value === targetGrade)?.label || "",
        targetClassLabel:
          classOptions.find((item) => item.value === targetClass)?.label || "",
        options,
      });
      if (!isCurrentAction()) return;
      setRefreshKey((key) => key + 1);
      showToast({
        tone: "success",
        title: "생각모아 시작",
        message: "학생이 참여할 수 있도록 주제를 열었습니다.",
      });
      focusRequested.current = true;
      setView("detail");
      setSelectedSessionId(added.sessionId);
    } catch (error) {
      if (!isCurrentAction()) return;
      console.error("Failed to start think cloud session:", error);
      setMessage(
        "주제를 열지 못했습니다. 입력한 내용을 확인하고 다시 시도해 주세요.",
      );
      showToast({
        tone: "error",
        title: "생각모아 시작 실패",
        message: "세션 시작에 실패했습니다.",
      });
    } finally {
      if (isCurrentAction()) {
        actionInFlight.current = false;
        setLoadingAction(false);
      }
    }
  };

  const handleCloseSession = async () => {
    if (!canEdit || actionInFlight.current) return;
    if (!dataReady || !selectedSession) return;
    const isCurrentAction = beginAction();
    try {
      await transitionThinkCloudSession(config, selectedSession, "closed");
      if (!isCurrentAction()) return;
      setRefreshKey((key) => key + 1);
      showToast({
        tone: "success",
        title: "생각모아 종료",
        message: "선택한 주제를 마쳤습니다.",
      });
    } catch (error) {
      if (!isCurrentAction()) return;
      console.error("Failed to close think cloud session:", error);
      showToast({
        tone: "error",
        title: "생각모아 종료 실패",
        message: "세션 종료에 실패했습니다.",
      });
    } finally {
      if (isCurrentAction()) {
        actionInFlight.current = false;
        setLoadingAction(false);
      }
    }
  };

  const handlePauseSession = async () => {
    if (!canEdit || actionInFlight.current) return;
    if (!dataReady || !selectedSession) return;
    const isCurrentAction = beginAction();
    try {
      await transitionThinkCloudSession(config, selectedSession, "paused");
      if (!isCurrentAction()) return;
      setRefreshKey((key) => key + 1);
      showToast({
        tone: "success",
        title: "생각모아 일시 정지",
        message: "학생의 응답 입력을 잠시 멈췄습니다.",
      });
    } catch (error) {
      if (!isCurrentAction()) return;
      console.error("Failed to pause think cloud session:", error);
      showToast({
        tone: "error",
        title: "일시 정지 실패",
        message: "일시 정지에 실패했습니다.",
      });
    } finally {
      if (isCurrentAction()) {
        actionInFlight.current = false;
        setLoadingAction(false);
      }
    }
  };

  const handleResumeSession = async () => {
    if (!canEdit || actionInFlight.current) return;
    if (!dataReady || !selectedSession) return;
    const isCurrentAction = beginAction();
    try {
      await transitionThinkCloudSession(config, selectedSession, "active");
      if (!isCurrentAction()) return;
      setRefreshKey((key) => key + 1);
      showToast({
        tone: "success",
        title: "생각모아 재개",
        message: "학생이 다시 응답할 수 있습니다.",
      });
    } catch (error) {
      if (!isCurrentAction()) return;
      console.error("Failed to resume think cloud session:", error);
      showToast({
        tone: "error",
        title: "생각모아 재개 실패",
        message: "재개에 실패했습니다.",
      });
    } finally {
      if (isCurrentAction()) {
        actionInFlight.current = false;
        setLoadingAction(false);
      }
    }
  };

  const handleDeleteSession = async () => {
    if (!canEdit || actionInFlight.current) return;
    if (!dataReady || !selectedSession) return;
    const confirmed = window.confirm(
      "선택한 주제를 삭제할까요? 해당 주제의 응답도 함께 삭제됩니다.",
    );
    if (!confirmed) return;

    const isCurrentAction = beginAction();
    try {
      await deleteThinkCloudSession(config, selectedSession);
      if (!isCurrentAction()) return;
      setRefreshKey((key) => key + 1);
      setSelectedSessionId("");
      focusRequested.current = true;
      setView("list");
      showToast({
        tone: "success",
        title: "주제 삭제",
        message: "선택한 주제를 삭제했습니다.",
      });
    } catch (error) {
      if (!isCurrentAction()) return;
      console.error("Failed to delete think cloud session:", error);
      showToast({
        tone: "error",
        title: "주제 삭제 실패",
        message: "삭제에 실패했습니다.",
      });
    } finally {
      if (isCurrentAction()) {
        actionInFlight.current = false;
        setLoadingAction(false);
      }
    }
  };

  const getStatus = (session: SessionWithId) =>
    session.status === "active" && activeSessionIds.includes(session.id)
      ? "active"
      : session.status === "closed"
        ? "closed"
        : "paused";
  const statusLabel = (status: "active" | "paused" | "closed") =>
    status === "active"
      ? "진행 중"
      : status === "paused"
        ? "잠시 멈춤"
        : "종료";
  const classLabel = (session: SessionWithId) =>
    `${formatGradeLabel(session.targetGrade, session.targetGradeLabel)} ${formatClassLabel(session.targetClass, session.targetClassLabel)}`;
  const activeCount = filteredSessions.filter(
    (session) => getStatus(session) === "active",
  ).length;

  const renderCreatePanel = () => (
    <form
      className="teacher-think-create"
      onSubmit={(event) => {
        event.preventDefault();
        if (createComposing.current) return;
        void handleStartSession();
      }}
      onCompositionStart={() => {
        createComposing.current = true;
      }}
      onCompositionEnd={() => {
        createComposing.current = false;
      }}
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          (createComposing.current ||
            event.nativeEvent.isComposing ||
            event.keyCode === 229)
        )
          event.preventDefault();
      }}
      aria-label="새 생각모아 주제"
      data-testid="teacher-think-create"
    >
      <div className="teacher-think-create-grid">
        <div className="teacher-think-question-fields">
          <label className="think-field" htmlFor="think-topic-title">
            <span className="think-label">
              질문 <span aria-hidden="true">*</span>
            </span>
            <input
              id="think-topic-title"
              className="think-input teacher-think-title-input"
              lang="ko"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              required
              disabled={loadingAction}
              placeholder="오늘, 어떤 생각을 모아 볼까요?"
            />
          </label>
          <label className="think-field" htmlFor="think-topic-description">
            <span className="think-label">
              덧붙일 내용 <span className="teacher-think-optional">선택</span>
            </span>
            <textarea
              id="think-topic-description"
              className="think-input"
              lang="ko"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              rows={3}
              disabled={loadingAction}
              placeholder="질문에 필요한 맥락이나 자료"
            />
          </label>
        </div>
        <aside
          className="teacher-think-preview"
          aria-label="학생 화면 미리보기"
        >
          <span className="think-section-label">학생 화면</span>
          <div className="teacher-think-preview-question">
            {title.trim() || "우리의 생각이 만나는 질문"}
          </div>
          {description.trim() && <p>{description}</p>}
          <div className="teacher-think-preview-input" aria-hidden="true">
            <span>
              {options.inputMode === "word"
                ? "내 생각 한 단어"
                : "내 생각 한 문장"}
            </span>
            <ThinkArrow />
          </div>
          <span className="teacher-think-preview-note">
            {options.anonymous ? "익명" : "이름 표시"} · 최대{" "}
            {options.maxLength}자
          </span>
        </aside>
      </div>

      <div className="teacher-think-form-settings">
        <div className="teacher-think-settings-row">
          <fieldset className="teacher-think-class-fields">
            <legend className="think-label">참여 학급</legend>
            <div className="teacher-think-class-selects">
              <select
                aria-label="참여 학년"
                className="think-input"
                value={targetGrade}
                onChange={(event) => setTargetGrade(event.target.value)}
                disabled={loadingAction}
              >
                {gradeOptions.map((grade) => (
                  <option key={grade.value} value={grade.value}>
                    {grade.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="참여 반"
                className="think-input"
                value={targetClass}
                onChange={(event) => setTargetClass(event.target.value)}
                disabled={loadingAction}
              >
                {classOptions.map((cls) => (
                  <option key={cls.value} value={cls.value}>
                    {cls.label}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>
          <fieldset className="teacher-think-mode-fields">
            <legend className="think-label">모으는 방식</legend>
            <div className="teacher-think-mode-options">
              {(
                [
                  ["word", "한 단어"],
                  ["sentence", "한 문장"],
                ] as const
              ).map(([mode, label]) => (
                <label className="think-choice" key={mode}>
                  <input
                    type="radio"
                    name="think-input-mode"
                    value={mode}
                    checked={options.inputMode === mode}
                    onChange={() =>
                      setOptions((previous) => ({
                        ...previous,
                        inputMode: mode,
                      }))
                    }
                    disabled={loadingAction}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label
            className="think-field teacher-think-length-field"
            htmlFor="think-max-length"
          >
            <span className="think-label">최대 글자 수</span>
            <NumericInput
              id="think-max-length"
              className="think-input"
              min={5}
              max={100}
              value={options.maxLength}
              disabled={loadingAction}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                setOptions((previous) => ({
                  ...previous,
                  maxLength: Number.isFinite(parsed)
                    ? Math.max(5, Math.min(100, parsed))
                    : 20,
                }));
              }}
            />
          </label>
        </div>
        <fieldset className="teacher-think-option-fields">
          <legend className="think-label">참여 설정</legend>
          <div className="teacher-think-option-row">
            {(
              [
                ["allowDuplicateWord", "같은 응답 허용"],
                ["allowDuplicateByStudent", "여러 번 참여"],
                ["anonymous", "익명 표시"],
                ["profanityFilter", "금칙어 필터"],
              ] as const
            ).map(([key, label]) => (
              <label className="think-choice" key={key}>
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(event) =>
                    setOptions((previous) => ({
                      ...previous,
                      [key]: event.target.checked,
                    }))
                  }
                  disabled={loadingAction}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="teacher-think-create-footer">
        <p>주제를 열면 선택한 학급의 학생이 바로 참여할 수 있습니다.</p>
        <div className="think-actions">
          <button
            className="think-button"
            type="button"
            onClick={showList}
            disabled={loadingAction}
          >
            취소
          </button>
          <button
            className="think-button is-primary"
            type="submit"
            disabled={loadingAction || !canEdit}
          >
            {loadingAction ? "주제를 여는 중…" : "주제 열기"}
            <ThinkArrow />
          </button>
        </div>
      </div>
    </form>
  );

  const renderList = () => (
    <section
      className="teacher-think-list"
      aria-label="생각모아 주제 목록"
      data-testid="teacher-think-list"
    >
      <div className="ws-filter-bar teacher-think-filters">
        <select
          aria-label="학년 필터"
          className="think-input"
          value={filterGrade}
          onChange={(event) => setFilterGrade(event.target.value)}
        >
          <option value="all">전체 학년</option>
          {gradeOptions.map((grade) => (
            <option key={grade.value} value={grade.value}>
              {grade.label}
            </option>
          ))}
        </select>
        <select
          aria-label="반 필터"
          className="think-input"
          value={filterClass}
          onChange={(event) => setFilterClass(event.target.value)}
        >
          <option value="all">전체 반</option>
          {classOptions.map((cls) => (
            <option key={cls.value} value={cls.value}>
              {cls.label}
            </option>
          ))}
        </select>
        {!initialLoading && !readError && (
          <span className="teacher-think-list-count">
            {filteredSessions.length}개 주제
            {activeCount > 0 ? ` · 진행 중 ${activeCount}개` : ""}
          </span>
        )}
      </div>
      {initialLoading ? (
        <InlineLoading message="주제를 불러오는 중입니다." />
      ) : (
        !readError &&
        (filteredSessions.length ? (
          <ul className="think-topic-list">
            {filteredSessions.map((session, index) => (
              <li key={session.id}>
                <button
                  type="button"
                  className="think-topic-row teacher-think-topic"
                  data-state={getStatus(session)}
                  data-think-session={session.id}
                  onClick={() => selectSession(session.id)}
                >
                  <span
                    className="teacher-think-topic-index"
                    aria-hidden="true"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="teacher-think-topic-content">
                    <span className="think-topic-title">{session.title}</span>
                    <span className="think-topic-meta">
                      {classLabel(session)} ·{" "}
                      {session.options.inputMode === "word"
                        ? "한 단어"
                        : "한 문장"}
                    </span>
                    {session.description && (
                      <span className="teacher-think-topic-description">
                        {session.description}
                      </span>
                    )}
                  </span>
                  <span
                    className="think-status"
                    data-state={getStatus(session)}
                  >
                    {statusLabel(getStatus(session))}
                  </span>
                  <ThinkArrow />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="think-empty teacher-think-empty">
            <span className="teacher-think-empty-mark" aria-hidden="true">
              ＋
            </span>
            <p>
              {sessions.length
                ? "이 학급에 등록된 주제가 없습니다."
                : "아직 등록된 주제가 없습니다."}
            </p>
          </div>
        ))
      )}
    </section>
  );

  const renderDetailPanel = () => {
    if (!selectedSession)
      return (
        <div className="think-empty">
          <p>주제를 불러오는 중입니다.</p>
        </div>
      );
    const status = getStatus(selectedSession);
    return (
      <section
        className="teacher-think-detail"
        data-testid="teacher-think-detail"
      >
        <div className="teacher-think-detail-meta">
          <span className="think-status" data-state={status}>
            {statusLabel(status)}
          </span>
          <span>{classLabel(selectedSession)}</span>
          <span>
            {selectedSession.options.inputMode === "word"
              ? "한 단어"
              : "한 문장"}{" "}
            · 최대 {selectedSession.options.maxLength}자
          </span>
          <span>
            {selectedSession.options.anonymous ? "익명" : "이름 표시"}
          </span>
        </div>
        {selectedSession.description && (
          <p className="teacher-think-description">
            {selectedSession.description}
          </p>
        )}
        <div className="teacher-think-board-toolbar">
          <h2 className="think-section-label">
            모인 생각{" "}
            <span className="think-count">
              {dataReady ? responses.length : "—"}
            </span>
          </h2>
          <div className="think-actions">
            <button
              className="think-button teacher-think-motion-toggle"
              type="button"
              aria-label="움직임 효과"
              aria-pressed={motionEnabled}
              onClick={() => setMotionEnabled((enabled) => !enabled)}
            >
              효과 {motionEnabled ? "켜짐" : "꺼짐"}
            </button>
            <button
              ref={presentationTrigger}
              className="think-button"
              type="button"
              disabled={!dataReady}
              onClick={() => {
                presentationSessionRef.current = selectedSession.id;
                setCloudModalOpen(true);
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
              </svg>
              크게 보기
            </button>
          </div>
        </div>
        {dataReady ? (
          <WordCloudView
            key={selectedSession.id}
            entries={cloudEntries}
            showSubmitters={!selectedSession.options.anonymous}
            motionEnabled={motionEnabled}
          />
        ) : (
          <InlineLoading message="응답을 불러오는 중입니다." />
        )}
        <div className="teacher-think-management">
          {dataReady && classStudents.length > 0 && (
            <details
              className="teacher-think-participation"
              key={selectedSession.id}
            >
              <summary>
                <span>참여 현황</span>
                <span>
                  {classStudents.length - pendingStudents.length} /{" "}
                  {classStudents.length}명
                </span>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden="true"
                >
                  <path d="m7 10 5 5 5-5" />
                </svg>
              </summary>
              <div className="teacher-think-pending">
                <span className="teacher-think-pending-label">
                  {pendingStudents.length
                    ? "아직 참여하지 않은 학생"
                    : "모두 참여했습니다."}
                </span>
                {pendingStudents.map((student) => (
                  <span key={student.uid}>
                    {student.number ? `${student.number}번 ` : ""}
                    {student.name}
                  </span>
                ))}
              </div>
            </details>
          )}
          <div className="teacher-think-policy">
            <span>
              {selectedSession.options.allowDuplicateWord
                ? "같은 응답 허용"
                : "같은 응답 제한"}
            </span>
            <span>
              {selectedSession.options.allowDuplicateByStudent
                ? "여러 번 참여"
                : "한 번 참여"}
            </span>
            {selectedSession.options.profanityFilter && (
              <span>금칙어 필터</span>
            )}
          </div>
          {canEdit && (
            <div className="teacher-think-operations" aria-label="주제 운영">
              {status === "active" && (
                <button
                  className="think-button"
                  type="button"
                  disabled={loadingAction || !dataReady}
                  onClick={() => void handlePauseSession()}
                >
                  잠시 멈추기
                </button>
              )}
              {status === "paused" && (
                <button
                  className="think-button is-primary"
                  type="button"
                  disabled={loadingAction || !dataReady}
                  onClick={() => void handleResumeSession()}
                >
                  다시 열기
                </button>
              )}
              {status !== "closed" && (
                <button
                  className="think-button"
                  type="button"
                  disabled={loadingAction || !dataReady}
                  onClick={() => void handleCloseSession()}
                >
                  주제 마치기
                </button>
              )}
              <button
                className="think-button is-danger"
                type="button"
                disabled={loadingAction || !dataReady}
                onClick={() => void handleDeleteSession()}
              >
                주제 삭제
              </button>
              {loadingAction && <span role="status">처리 중…</span>}
            </div>
          )}
        </div>
      </section>
    );
  };

  return (
    <>
      <PortalWorkspace
        as="main"
        className="ws-page think-workspace teacher-think-page"
        data-view={view}
      >
        {view !== "list" && (
          <button
            className="think-back"
            type="button"
            onClick={showList}
            disabled={loadingAction}
          >
            <ThinkArrow back /> 주제 목록
          </button>
        )}
        <div className="ws-page-header think-header">
          <h1 className="think-title" ref={headingRef} tabIndex={-1}>
            {view === "create"
              ? "새 주제"
              : view === "detail"
                ? selectedSession?.title || "생각모아"
                : "생각모아"}
          </h1>
          {view === "list" && canEdit && (
            <button
              className="think-button is-primary"
              type="button"
              onClick={openCreateMode}
            >
              <span aria-hidden="true">＋</span> 새 주제
            </button>
          )}
        </div>
        {readError && (
          <div className="think-error teacher-think-read-error" role="alert">
            <p>{readErrorMessage || "생각모아를 불러오지 못했습니다."}</p>
            <button
              className="think-button"
              type="button"
              onClick={() => {
                setReadError(false);
                setReadErrorMessage("");
                setRefreshKey((key) => key + 1);
              }}
            >
              다시 불러오기
            </button>
          </div>
        )}
        {view === "list"
          ? renderList()
          : view === "create"
            ? renderCreatePanel()
            : renderDetailPanel()}
        {!readError && message && (
          <p className="think-error" role="alert">
            {message}
          </p>
        )}
      </PortalWorkspace>
      {presentationReady &&
        selectedSession &&
        createPortal(
          <dialog
            ref={dialogRef}
            tabIndex={-1}
            className="think-workspace teacher-think-presentation"
            aria-labelledby="think-presentation-title"
            onCancel={(event) => {
              event.preventDefault();
              setCloudModalOpen(false);
            }}
          >
            <div className="ws-page-header think-header teacher-think-presentation-heading">
              <div className="teacher-think-presentation-title-group">
                <span className="teacher-think-presentation-context">
                  생각모아 · {classLabel(selectedSession)}
                </span>
                <h2 id="think-presentation-title">{selectedSession.title}</h2>
              </div>
              <div className="think-actions">
                <span className="think-count">응답 {responses.length}개</span>
                <button
                  className="think-button teacher-think-motion-toggle"
                  type="button"
                  aria-label="움직임 효과"
                  aria-pressed={motionEnabled}
                  onClick={() => setMotionEnabled((enabled) => !enabled)}
                >
                  효과 {motionEnabled ? "켜짐" : "꺼짐"}
                </button>
                <button
                  ref={presentationClose}
                  className="think-button"
                  type="button"
                  onClick={() => setCloudModalOpen(false)}
                  aria-label="크게 보기 닫기"
                >
                  닫기 <span aria-hidden="true">×</span>
                </button>
              </div>
            </div>
            <div className="teacher-think-presentation-body">
              <WordCloudView
                entries={cloudEntries}
                showSubmitters={!selectedSession.options.anonymous}
                variant="modal"
                motionEnabled={motionEnabled}
              />
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
};

const ThinkArrow = ({ back = false }: { back?: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    aria-hidden="true"
  >
    <path d={back ? "M20 12H4m6-6-6 6 6 6" : "M4 12h16m-6-6 6 6-6 6"} />
  </svg>
);

export default ManageThinkCloud;
