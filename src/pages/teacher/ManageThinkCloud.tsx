import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import WordCloudView from "../../components/common/WordCloudView";
import { PageDataLoading } from "../../components/common/LoadingState";
import {
  DEFAULT_THINK_CLOUD_OPTIONS,
  formatClassLabel,
  formatGradeLabel,
  normalizeThinkCloudOptions,
  type ThinkCloudOptions,
  type ThinkCloudResponse,
} from "../../lib/thinkCloud";
import { canWriteLessonManagement } from "../../lib/permissions";
import {
  createLegacyThinkCloudSession,
  createLegacyThinkCloudActionKey,
  deleteLegacyThinkCloudSession,
  getLegacyThinkCloudState,
  transitionLegacyThinkCloudSession,
} from "../../lib/legacyThinkCloudAdapter";
import {
  W8DomainError,
  type W8ThinkCloudManagedClass,
  type W8ThinkCloudSession,
} from "../../lib/w8Domains";

type SessionWithId = W8ThinkCloudSession;
type SchoolOption = { value: string; label: string };
type StudentRosterItem = {
  uid: string;
  name: string;
  number: string;
};
type ReadLoadState = "loading" | "ready" | "permission" | "error";

const getReadFailureState = (error: unknown): ReadLoadState => {
  if (error instanceof W8DomainError) {
    return error.kind === "PERMISSION" ? "permission" : "error";
  }
  const errorCode =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
  return errorCode.includes("permission-denied") ? "permission" : "error";
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
  const [activeSessionIds, setActiveSessionIds] = useState<string[]>([]);
  const [sessions, setSessions] = useState<SessionWithId[]>([]);
  const [sessionLoadState, setSessionLoadState] = useState<
    "loading" | "ready" | "permission" | "error"
  >("loading");
  const [sessionLoadAttempt, setSessionLoadAttempt] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [responses, setResponses] = useState<
    Array<ThinkCloudResponse & { id: string }>
  >([]);
  const [responseLoadState, setResponseLoadState] =
    useState<ReadLoadState>("ready");
  const [responseLoadKey, setResponseLoadKey] = useState("");
  const [responseLoadAttempt, setResponseLoadAttempt] = useState(0);
  const [loadingAction, setLoadingAction] = useState(false);
  const [managedClasses, setManagedClasses] = useState<
    W8ThinkCloudManagedClass[]
  >([]);
  const [message, setMessage] = useState("");
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [cloudModalOpen, setCloudModalOpen] = useState(false);
  const [mobileSessionListOpen, setMobileSessionListOpen] = useState(false);
  const [classStudents, setClassStudents] = useState<StudentRosterItem[]>([]);
  const [rosterLoadState, setRosterLoadState] =
    useState<ReadLoadState>("ready");
  const [rosterLoadKey, setRosterLoadKey] = useState("");
  const [rosterLoadAttempt, setRosterLoadAttempt] = useState(0);
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
  const canEdit = canWriteLessonManagement(userData, currentUser?.email || "");
  const selectedReadKey = `${String(config?.year || "")}-${String(
    config?.semester || "",
  )}:${selectedSessionId}`;
  const selectedResponseLoadState: ReadLoadState = selectedSessionId
    ? responseLoadKey === selectedReadKey
      ? responseLoadState
      : "loading"
    : "ready";
  const selectedRosterLoadState: ReadLoadState = selectedSessionId
    ? rosterLoadKey === selectedReadKey
      ? rosterLoadState
      : "loading"
    : "ready";

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) || null,
    [sessions, selectedSessionId],
  );

  const filteredSessions = useMemo(
    () =>
      sessions.filter((session) => {
        if (filterGrade !== "all" && session.targetGrade !== filterGrade)
          return false;
        if (filterClass !== "all" && session.targetClass !== filterClass)
          return false;
        return true;
      }),
    [sessions, filterGrade, filterClass],
  );
  const targetClassOptions = useMemo(() => {
    const optionsForGrade = managedClasses
      .filter((item) => item.grade === targetGrade)
      .map((item) => ({
        value: item.classNumber,
        label: formatClassLabel(item.classNumber),
      }));
    return optionsForGrade.length > 0 ? optionsForGrade : classOptions;
  }, [classOptions, managedClasses, targetGrade]);

  useEffect(() => {
    let cancelled = false;
    const loadSessions = async () => {
      setSessionLoadState("loading");
      try {
        const state = await getLegacyThinkCloudState(config, "teacher");
        if (cancelled) return;
        const loaded: SessionWithId[] = state.thinkCloudSessions.map(
          (session) => ({
            ...session,
            options: normalizeThinkCloudOptions(session.options),
          }),
        );
        loaded.sort((a, b) => {
          const ta = Number(
            (a.createdAt as { seconds?: number } | undefined)?.seconds || 0,
          );
          const tb = Number(
            (b.createdAt as { seconds?: number } | undefined)?.seconds || 0,
          );
          return tb - ta;
        });
        setActiveSessionIds(state.thinkCloudState.activeSessionIds);
        setManagedClasses(state.thinkCloudManagedClasses);
        if (state.thinkCloudManagedClasses.length > 0) {
          const nextGrades = Array.from(
            new Map(
              state.thinkCloudManagedClasses.map((item) => [
                item.grade,
                {
                  value: item.grade,
                  label: formatGradeLabel(item.grade),
                },
              ]),
            ).values(),
          );
          const nextClasses = Array.from(
            new Map(
              state.thinkCloudManagedClasses.map((item) => [
                item.classNumber,
                {
                  value: item.classNumber,
                  label: formatClassLabel(item.classNumber),
                },
              ]),
            ).values(),
          );
          setGradeOptions(nextGrades);
          setClassOptions(nextClasses);
        }
        setSessions(loaded);
        setSelectedSessionId((current) =>
          current && loaded.some((item) => item.id === current)
            ? current
            : loaded[0]?.id || "",
        );
        setSessionLoadState("ready");
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to load think cloud sessions:", error);
          setActiveSessionIds([]);
          setManagedClasses([]);
          setSessions([]);
          setSelectedSessionId("");
          setSessionLoadState(getReadFailureState(error));
        }
      }
    };
    void loadSessions();
    return () => {
      cancelled = true;
    };
  }, [config, sessionLoadAttempt]);

  useEffect(() => {
    if (!selectedSessionId) {
      setResponses([]);
      setResponseLoadState("ready");
      setResponseLoadKey("");
      return;
    }
    let cancelled = false;
    const loadSelectedSession = async () => {
      setResponseLoadKey(selectedReadKey);
      setRosterLoadKey(selectedReadKey);
      setResponseLoadState("loading");
      setRosterLoadState("loading");
      try {
        const state = await getLegacyThinkCloudState(
          config,
          "teacher",
          selectedSessionId,
        );
        if (cancelled) return;
        const loaded = [...state.thinkCloudResponses];
        loaded.sort((a, b) => {
          const ta = Number(
            (a.createdAt as { seconds?: number } | undefined)?.seconds || 0,
          );
          const tb = Number(
            (b.createdAt as { seconds?: number } | undefined)?.seconds || 0,
          );
          return tb - ta;
        });
        const loadedRoster = [...state.thinkCloudRoster];
        loadedRoster.sort((a, b) => {
          const an = Number.parseInt(a.number, 10);
          const bn = Number.parseInt(b.number, 10);
          const aValid = Number.isFinite(an) && an > 0;
          const bValid = Number.isFinite(bn) && bn > 0;
          if (aValid && bValid) return an - bn;
          if (aValid) return -1;
          if (bValid) return 1;
          return a.name.localeCompare(b.name);
        });
        setResponses(loaded);
        setClassStudents(loadedRoster);
        setResponseLoadState("ready");
        setRosterLoadState("ready");
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to load think cloud session details:", error);
          setResponses([]);
          setClassStudents([]);
          const failureState = getReadFailureState(error);
          setResponseLoadState(failureState);
          setRosterLoadState(failureState);
        }
      }
    };
    void loadSelectedSession();
    return () => {
      cancelled = true;
    };
  }, [
    config,
    responseLoadAttempt,
    rosterLoadAttempt,
    selectedReadKey,
    selectedSessionId,
  ]);

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
    if (!gradeOptions.some((item) => item.value === targetGrade)) {
      setTargetGrade(gradeOptions[0]?.value || "1");
    }
  }, [gradeOptions, targetGrade]);

  useEffect(() => {
    if (!targetClassOptions.some((item) => item.value === targetClass)) {
      setTargetClass(targetClassOptions[0]?.value || "1");
    }
  }, [targetClass, targetClassOptions]);

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
    if (!canEdit && isCreateMode) setIsCreateMode(false);
  }, [canEdit, isCreateMode]);

  useEffect(() => {
    if (isCreateMode) return;
    if (!selectedSessionId && filteredSessions.length > 0) {
      setSelectedSessionId(filteredSessions[0].id);
      return;
    }
    if (
      selectedSessionId &&
      !filteredSessions.some((session) => session.id === selectedSessionId)
    ) {
      setSelectedSessionId(filteredSessions[0]?.id || "");
    }
  }, [filteredSessions, isCreateMode, selectedSessionId]);

  const selectSession = (id: string) => {
    setIsCreateMode(false);
    setSelectedSessionId(id);
    setMessage("");
    setMobileSessionListOpen(false);
  };

  const openCreateMode = () => {
    if (!canEdit) return;
    setIsCreateMode(true);
    setSelectedSessionId("");
    setMessage("");
    resetCreateForm();
    setMobileSessionListOpen(false);
  };

  const handleActionFailure = (error: unknown, fallback: string) => {
    console.error(fallback, error);
    setMessage(error instanceof W8DomainError ? error.message : fallback);
  };

  const handleStartSession = async () => {
    if (!canEdit) return;
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
    const targetManagedClass = managedClasses.find(
      (item) => item.grade === targetGrade && item.classNumber === targetClass,
    );
    if (!targetManagedClass) {
      setMessage("현재 학기에 배정된 학년과 반을 선택해 주세요.");
      return;
    }
    setLoadingAction(true);
    setMessage("");
    try {
      const result = await createLegacyThinkCloudSession({
        actionKey: createLegacyThinkCloudActionKey({
          actorUid: currentUser.uid,
          description: description.trim(),
          operation: "create",
          options,
          semester: String(config?.semester || ""),
          targetClass,
          targetGrade,
          title: safeTitle,
          year: String(config?.year || ""),
        }),
        config,
        expectedStateRevision: targetManagedClass.stateExists
          ? targetManagedClass.stateRevision
          : null,
        title: safeTitle,
        description: description.trim(),
        targetGrade,
        targetClass,
        targetGradeLabel: formatGradeLabel(targetGrade),
        targetClassLabel: formatClassLabel(targetClass),
        options,
      });
      setActiveSessionIds((current) => [
        ...(result.result.sessionId ? [result.result.sessionId] : []),
        ...current.filter(
          (id) =>
            id !== result.result.sessionId &&
            !sessions.some(
              (session) =>
                session.id === id &&
                session.targetGrade === targetGrade &&
                session.targetClass === targetClass,
            ),
        ),
      ]);
      setSelectedSessionId(result.result.sessionId || "");
      setIsCreateMode(false);
      setMessage("새 생각모아 주제를 시작했습니다.");
      setSessionLoadAttempt((value) => value + 1);
    } catch (error) {
      handleActionFailure(error, "세션 시작에 실패했습니다.");
      setSessionLoadAttempt((value) => value + 1);
    } finally {
      setLoadingAction(false);
    }
  };

  const handleTransitionSession = async (
    targetStatus: "active" | "paused" | "closed",
    successMessage: string,
    failureMessage: string,
  ) => {
    if (!canEdit) return;
    if (!selectedSessionId || !selectedSession) return;
    setLoadingAction(true);
    setMessage("");
    try {
      await transitionLegacyThinkCloudSession({
        actionKey: `${selectedSessionId}:${targetStatus}`,
        config,
        sessionId: selectedSessionId,
        expectedSessionRevision: selectedSession.revision || 0,
        expectedStateRevision: selectedSession.stateExists
          ? selectedSession.stateRevision
          : null,
        targetStatus,
      });
      setActiveSessionIds((current) =>
        targetStatus === "active"
          ? [
              selectedSessionId,
              ...current.filter((id) => id !== selectedSessionId),
            ]
          : current.filter((id) => id !== selectedSessionId),
      );
      setMessage(successMessage);
      setSessionLoadAttempt((value) => value + 1);
    } catch (error) {
      handleActionFailure(error, failureMessage);
      setSessionLoadAttempt((value) => value + 1);
    } finally {
      setLoadingAction(false);
    }
  };

  const handleCloseSession = () =>
    handleTransitionSession(
      "closed",
      "선택한 세션을 종료했습니다.",
      "세션 종료에 실패했습니다.",
    );

  const handlePauseSession = () =>
    handleTransitionSession(
      "paused",
      "선택한 세션을 일시 정지했습니다.",
      "일시 정지에 실패했습니다.",
    );

  const handleResumeSession = () =>
    handleTransitionSession(
      "active",
      "선택한 세션을 재개했습니다.",
      "재개에 실패했습니다.",
    );

  const handleDeleteSession = async () => {
    if (!canEdit) return;
    if (!selectedSessionId || !selectedSession) return;
    const confirmed = window.confirm(
      "선택한 주제를 삭제할까요? 해당 주제의 응답도 함께 삭제됩니다.",
    );
    if (!confirmed) return;
    setLoadingAction(true);
    setMessage("");
    try {
      await deleteLegacyThinkCloudSession({
        actionKey: selectedSessionId,
        config,
        sessionId: selectedSessionId,
        expectedSessionRevision: selectedSession.revision || 0,
        expectedStateRevision: selectedSession.stateExists
          ? selectedSession.stateRevision
          : null,
      });
      setActiveSessionIds((current) =>
        current.filter((id) => id !== selectedSessionId),
      );
      setSelectedSessionId("");
      setMessage("선택한 주제를 삭제했습니다.");
      setSessionLoadAttempt((value) => value + 1);
    } catch (error) {
      handleActionFailure(error, "주제 삭제에 실패했습니다.");
      setSessionLoadAttempt((value) => value + 1);
    } finally {
      setLoadingAction(false);
    }
  };

  const renderReadStatus = (
    kind: "response" | "roster",
    state: ReadLoadState,
  ) => {
    if (state === "ready") return null;
    const label = kind === "response" ? "응답" : "학생 명단";
    if (state === "loading") {
      return (
        <span className="text-sm font-bold text-gray-500" role="status">
          {label}을 불러오는 중입니다.
        </span>
      );
    }
    const retry = () => {
      if (kind === "response") {
        setResponseLoadAttempt((value) => value + 1);
      } else {
        setRosterLoadAttempt((value) => value + 1);
      }
    };
    return (
      <span
        className={`inline-flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold ${
          state === "permission"
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-red-200 bg-red-50 text-red-700"
        }`}
        role="alert"
      >
        <span>
          {state === "permission"
            ? `${label}을 볼 권한이 없습니다.`
            : `${label}을 불러오지 못했습니다.`}
        </span>
        <button type="button" className="underline" onClick={retry}>
          다시 시도
        </button>
      </span>
    );
  };

  const renderCreatePanel = () => (
    <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <div className="border-b border-gray-100 pb-4 mb-6">
        <h2 className="text-lg font-extrabold text-gray-900">
          새 생각모아 주제
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          주제와 옵션을 설정한 뒤 세션을 시작하세요.
        </p>
      </div>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">
            주제
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 조선 후기 사회 변화를 한 단어로 표현해 보세요"
            className="w-full border border-gray-300 rounded-lg p-3 bg-gray-50 focus:ring-2 focus:ring-blue-500 font-bold text-gray-800 outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-700 mb-2">
            설명
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="학생 안내 문구를 입력해 주세요."
            className="w-full border border-gray-300 rounded-lg p-3 bg-gray-50 focus:ring-2 focus:ring-blue-500 font-bold text-gray-800 outline-none resize-y"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <span className="font-bold text-gray-700">학년</span>
            <select
              value={targetGrade}
              onChange={(e) => setTargetGrade(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 font-bold bg-white"
            >
              {gradeOptions.map((grade) => (
                <option key={grade.value} value={grade.value}>
                  {grade.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <span className="font-bold text-gray-700">반</span>
            <select
              value={targetClass}
              onChange={(e) => setTargetClass(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 font-bold bg-white"
            >
              {targetClassOptions.map((cls) => (
                <option key={cls.value} value={cls.value}>
                  {cls.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <span className="font-bold text-gray-700">중복 단어 제출 허용</span>
            <input
              type="checkbox"
              checked={options.allowDuplicateWord}
              onChange={(e) =>
                setOptions((prev) => ({
                  ...prev,
                  allowDuplicateWord: e.target.checked,
                }))
              }
              className="w-5 h-5"
            />
          </label>

          <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <span className="font-bold text-gray-700">
              동일 학생 중복 제출 허용
            </span>
            <input
              type="checkbox"
              checked={options.allowDuplicateByStudent}
              onChange={(e) =>
                setOptions((prev) => ({
                  ...prev,
                  allowDuplicateByStudent: e.target.checked,
                }))
              }
              className="w-5 h-5"
            />
          </label>

          <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <span className="font-bold text-gray-700">익명 표시</span>
            <input
              type="checkbox"
              checked={options.anonymous}
              onChange={(e) =>
                setOptions((prev) => ({ ...prev, anonymous: e.target.checked }))
              }
              className="w-5 h-5"
            />
          </label>

          <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <span className="font-bold text-gray-700">금칙어 필터</span>
            <input
              type="checkbox"
              checked={options.profanityFilter}
              onChange={(e) =>
                setOptions((prev) => ({
                  ...prev,
                  profanityFilter: e.target.checked,
                }))
              }
              className="w-5 h-5"
            />
          </label>

          <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <span className="font-bold text-gray-700">입력 형식</span>
            <select
              value={options.inputMode}
              onChange={(e) =>
                setOptions((prev) => ({
                  ...prev,
                  inputMode: e.target.value as ThinkCloudOptions["inputMode"],
                }))
              }
              className="border border-gray-300 rounded-lg px-3 py-1.5 font-bold bg-white"
            >
              <option value="word">단어 1개</option>
              <option value="sentence">짧은 문장</option>
            </select>
          </label>

          <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 md:col-span-2">
            <span className="font-bold text-gray-700">최대 입력 길이</span>
            <input
              type="number"
              min={5}
              max={100}
              value={options.maxLength}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value, 10);
                const next = Number.isFinite(parsed)
                  ? Math.max(5, Math.min(100, parsed))
                  : 20;
                setOptions((prev) => ({ ...prev, maxLength: next }));
              }}
              className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 font-bold text-right bg-white"
            />
          </label>
        </div>

        <div className="text-right">
          <button
            onClick={() => void handleStartSession()}
            disabled={loadingAction}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl shadow-lg transition disabled:opacity-60"
          >
            {loadingAction ? "처리 중..." : "세션 시작"}
          </button>
        </div>
      </div>
    </section>
  );

  const renderDetailPanel = () => {
    if (!selectedSession) {
      return (
        <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <p className="text-gray-500 font-bold">
            목록에서 주제를 선택하거나 새 주제를 추가해 주세요.
          </p>
        </section>
      );
    }

    const isActive =
      activeSessionIds.includes(selectedSession.id) &&
      selectedSession.status === "active";
    const isPaused = selectedSession.status === "paused";

    return (
      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <div className="border-b border-gray-100 pb-4 mb-6 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-gray-900">
              {selectedSession.title}
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              {selectedSession.description || "설명 없음"}
            </p>
          </div>
          <span
            className={`text-xs font-bold px-2.5 py-1 rounded-full border ${isActive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : isPaused ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-gray-50 text-gray-600 border-gray-200"}`}
          >
            {isActive ? "진행 중" : isPaused ? "일시 정지" : "종료됨"}
          </span>
        </div>

        <div className="flex flex-wrap gap-2 mb-4 text-xs font-bold">
          <span className="px-2 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
            대상{" "}
            {formatGradeLabel(
              selectedSession.targetGrade,
              selectedSession.targetGradeLabel,
            )}{" "}
            {formatClassLabel(
              selectedSession.targetClass,
              selectedSession.targetClassLabel,
            )}
          </span>
          <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
            {selectedSession.options.inputMode === "word"
              ? "단어 1개 입력"
              : "짧은 문장 입력"}
          </span>
          <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            최대 {selectedSession.options.maxLength}자
          </span>
          <span className="px-2 py-1 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
            {selectedSession.options.allowDuplicateWord
              ? "중복 단어 제출 허용"
              : "중복 단어 제출 제한"}
          </span>
          <span className="px-2 py-1 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
            {selectedSession.options.allowDuplicateByStudent
              ? "동일 학생 중복 제출 허용"
              : "동일 학생 중복 제출 제한"}
          </span>
          <span className="px-2 py-1 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
            {selectedSession.options.anonymous ? "익명 표시" : "이름 표시"}
          </span>
        </div>

        <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <h3 className="font-bold text-gray-800">
            {"\uC2E4\uC2DC\uAC04 \uC9D1\uACC4"}
          </h3>
          <div className="flex flex-1 flex-col gap-2 lg:items-end">
            {renderReadStatus("response", selectedResponseLoadState)}
            {renderReadStatus("roster", selectedRosterLoadState)}
            {selectedResponseLoadState === "ready" && (
              <span className="text-sm font-bold text-gray-500">
                {"\uC751\uB2F5 "}
                {responses.length}
                {"\uAC1C"}
              </span>
            )}
            {selectedResponseLoadState === "ready" &&
              selectedRosterLoadState === "ready" &&
              (classStudents.length === 0 ? (
                <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-bold text-gray-600">
                  제출 대상 학생이 없습니다.
                </span>
              ) : pendingStudents.length > 0 ? (
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  {pendingStudents.map((student) => (
                    <span
                      key={student.uid}
                      className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700"
                      title={student.name}
                    >
                      {student.name}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                  {"\uC804\uC6D0 \uC81C\uCD9C \uC644\uB8CC"}
                </span>
              ))}
          </div>
        </div>

        {selectedResponseLoadState === "ready" &&
          (cloudEntries.length === 0 ? (
            <p className="text-sm text-gray-500 font-bold">
              아직 제출된 응답이 없습니다.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setCloudModalOpen(true)}
              className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-2xl"
              title="클릭해서 크게 보기"
            >
              <WordCloudView
                entries={cloudEntries}
                showSubmitters={!selectedSession.options.anonymous}
              />
            </button>
          ))}

        {canEdit && (
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button
              onClick={() => void handlePauseSession()}
              disabled={!isActive || loadingAction}
              className="bg-amber-500 hover:bg-amber-600 text-white font-bold py-2.5 px-5 rounded-lg disabled:opacity-50"
            >
              {loadingAction ? "처리 중..." : "일시 정지"}
            </button>
            <button
              onClick={() => void handleResumeSession()}
              disabled={
                isActive || selectedSession.status === "closed" || loadingAction
              }
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-5 rounded-lg disabled:opacity-50"
            >
              {loadingAction ? "처리 중..." : "재개"}
            </button>
            <button
              onClick={() => void handleCloseSession()}
              disabled={!isActive || loadingAction}
              className="bg-gray-700 hover:bg-gray-800 text-white font-bold py-2.5 px-5 rounded-lg disabled:opacity-50"
            >
              {loadingAction ? "처리 중..." : "이 세션 종료"}
            </button>
            <button
              onClick={() => void handleDeleteSession()}
              disabled={loadingAction}
              className="bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 px-5 rounded-lg disabled:opacity-50"
            >
              {loadingAction ? "처리 중..." : "주제 삭제"}
            </button>
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="flex flex-col lg:flex-row flex-1 p-6 lg:p-8 gap-6 max-w-7xl mx-auto w-full">
        {mobileSessionListOpen && (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/45 lg:hidden"
            onClick={() => setMobileSessionListOpen(false)}
            aria-label="생각모아 목록 닫기"
          />
        )}

        <aside
          className={`fixed bottom-0 right-0 top-16 z-50 w-[82%] max-w-[320px] shrink-0 transition-transform duration-300 motion-reduce:transition-none lg:static lg:z-auto lg:h-auto lg:w-72 lg:max-w-none lg:translate-x-0 ${
            mobileSessionListOpen ? "translate-x-0" : "translate-x-full"
          }`}
          aria-label="생각모아 목록"
        >
          <div className="flex h-full flex-col overflow-hidden border border-gray-200 bg-white shadow-2xl lg:rounded-xl lg:shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 p-5">
              <h2 className="text-xl font-extrabold text-gray-800 flex items-center gap-2">
                <i
                  className="fas fa-cloud text-blue-500"
                  aria-hidden="true"
                ></i>
                <span>생각모아 목록</span>
              </h2>
              <button
                type="button"
                onClick={() => setMobileSessionListOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 lg:hidden"
                aria-label="생각모아 목록 닫기"
              >
                <i className="fas fa-times text-lg" aria-hidden="true"></i>
              </button>
            </div>

            {canEdit && (
              <div className="border-b border-gray-100 p-4 lg:hidden">
                <button
                  type="button"
                  onClick={openCreateMode}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
                >
                  <i className="fas fa-plus text-sm" aria-hidden="true"></i>
                  <span>새 생각모아 만들기</span>
                </button>
              </div>
            )}

            <div className="border-b border-gray-100 p-4">
              <div className="grid grid-cols-2 gap-2">
                <select
                  aria-label="학년 필터"
                  value={filterGrade}
                  onChange={(e) => setFilterGrade(e.target.value)}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-700 outline-none"
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
                  value={filterClass}
                  onChange={(e) => setFilterClass(e.target.value)}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-700 outline-none"
                >
                  <option value="all">전체 반</option>
                  {classOptions.map((cls) => (
                    <option key={cls.value} value={cls.value}>
                      {cls.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <nav className="flex-1 overflow-y-auto lg:max-h-[60vh]">
              {sessionLoadState === "loading" && <PageDataLoading />}
              {sessionLoadState === "permission" && (
                <div
                  className="p-4 text-sm font-bold text-gray-600"
                  role="status"
                >
                  <p>담당 학급의 생각모아 자료만 확인할 수 있습니다.</p>
                  <p className="mt-1 text-xs font-medium text-gray-500">
                    담당 학년·반 정보가 없거나 접근 권한이 부족합니다.
                  </p>
                </div>
              )}
              {sessionLoadState === "error" && (
                <div
                  className="p-4 text-sm font-bold text-gray-600"
                  role="alert"
                >
                  <p>저장된 주제를 불러오지 못했습니다.</p>
                  <button
                    type="button"
                    className="mt-2 text-blue-700 underline"
                    onClick={() => setSessionLoadAttempt((value) => value + 1)}
                  >
                    다시 시도
                  </button>
                </div>
              )}
              {sessionLoadState === "ready" &&
                filteredSessions.length === 0 && (
                  <p className="p-4 text-sm font-bold text-gray-500">
                    저장된 주제가 없습니다.
                  </p>
                )}
              {filteredSessions.map((session) => {
                const isSelected =
                  !isCreateMode && selectedSessionId === session.id;
                const isActive =
                  activeSessionIds.includes(session.id) &&
                  session.status === "active";
                return (
                  <button
                    type="button"
                    key={session.id}
                    onClick={() => selectSession(session.id)}
                    className={`w-full px-4 py-3 text-left border-l-4 transition ${isSelected ? "bg-blue-50 text-blue-700 border-blue-600" : "text-gray-700 border-transparent hover:bg-gray-50"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold truncate">{session.title}</p>
                      {isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">
                          LIVE
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1 truncate">
                      {formatGradeLabel(
                        session.targetGrade,
                        session.targetGradeLabel,
                      )}{" "}
                      {formatClassLabel(
                        session.targetClass,
                        session.targetClassLabel,
                      )}{" "}
                      · {session.description || "설명 없음"}
                    </p>
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        <div className="flex-1">
          {canEdit && (
            <div className="think-cloud-desktop-create-action mb-4 justify-end">
              <button
                onClick={openCreateMode}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-5 rounded-lg shadow-sm"
              >
                + 새 주제
              </button>
            </div>
          )}
          {!canEdit && (
            <div
              className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800"
              role="status"
            >
              읽기 전용 권한으로 접속 중입니다. 저장된 생각모아 자료만 확인할 수
              있습니다.
            </div>
          )}
          {isCreateMode && canEdit ? renderCreatePanel() : renderDetailPanel()}
          {message && (
            <div className="mt-3 text-sm font-bold text-blue-700" role="status">
              <p>{message}</p>
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setMobileSessionListOpen(true)}
        className={`fixed z-30 h-14 w-14 rounded-full bg-blue-600 text-white shadow-xl transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 lg:hidden ${
          canEdit ? "teacher-floating-action-above-patch" : "bottom-6 right-6"
        }`}
        aria-label="생각모아 목록 열기"
        aria-expanded={mobileSessionListOpen}
        title="생각모아 목록"
      >
        <i className="fas fa-list text-lg" aria-hidden="true"></i>
      </button>

      {cloudModalOpen && (
        <div
          className="fixed inset-0 z-[120] bg-white"
          onClick={() => setCloudModalOpen(false)}
        >
          <div
            className="flex h-full w-full flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 md:px-8 md:py-5">
              <div className="min-w-0">
                <h3 className="text-xl font-extrabold text-gray-900 md:text-2xl">
                  생각모아 워드클라우드 대형 보기
                </h3>
                <div className="mt-2 text-sm font-bold text-gray-600 md:text-base">
                  {selectedResponseLoadState === "ready"
                    ? `TV 출력용 모드입니다. 응답 ${responses.length}개`
                    : renderReadStatus("response", selectedResponseLoadState)}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {renderReadStatus("roster", selectedRosterLoadState)}
                  {selectedResponseLoadState === "ready" &&
                    selectedRosterLoadState === "ready" &&
                    (classStudents.length === 0 ? (
                      <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-bold text-gray-600 md:text-sm">
                        제출 대상 학생이 없습니다.
                      </span>
                    ) : pendingStudents.length > 0 ? (
                      pendingStudents.map((student) => (
                        <span
                          key={student.uid}
                          className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700 md:text-sm"
                          title={student.name}
                        >
                          {student.name}
                        </span>
                      ))
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 md:text-sm">
                        전원 제출 완료
                      </span>
                    ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCloudModalOpen(false)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"
                aria-label="닫기"
              >
                <i className="fas fa-times text-lg"></i>
              </button>
            </div>
            <div className="custom-scroll flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-4 md:px-8 md:pb-8 md:pt-6">
              {selectedResponseLoadState === "ready" && (
                <div className="flex min-h-full w-full items-center justify-center">
                  <WordCloudView
                    entries={cloudEntries}
                    showSubmitters={
                      !!selectedSession && !selectedSession.options.anonymous
                    }
                    variant="default"
                    className="w-full"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageThinkCloud;
