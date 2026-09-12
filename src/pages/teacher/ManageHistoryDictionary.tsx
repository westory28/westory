import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { LoadingOverlay } from "../../components/common/LoadingState";
import StatePanel from "../../components/common/StatePanel";
import { useAppToast } from "../../components/common/AppToastProvider";
import { useAuth } from "../../contexts/AuthContext";
import {
  canReadLessonManagement,
  canWriteLessonManagement,
} from "../../lib/permissions";
import {
  approveHistoryDictionaryTermForRequests,
  deleteStudentHistoryDictionaryWordByTeacher,
  loadTeacherStudentHistoryDictionaryWords,
  loadTeacherHistoryDictionaryTerms,
  normalizeHistoryDictionaryWord,
  hasPendingHistoryDictionaryImport,
  isHistoryDictionaryImportUncertain,
  isHistoryDictionaryImportConflict,
  saveHistoryDictionaryTerm,
  saveHistoryDictionaryTermsBulk,
  subscribeTeacherHistoryDictionaryRequests,
  subscribeTeacherHistoryDictionaryTerms,
  updateStudentHistoryDictionaryWordByTeacher,
  getHistoryDictionaryWriteVersion,
  hasPendingHistoryDictionaryMutation,
  isHistoryDictionaryMutationBusy,
  subscribeHistoryDictionaryMutation,
  retryHistoryDictionaryMutation,
  historyDictionaryMutationMessage,
  getPendingHistoryDictionaryDraft,
} from "../../lib/historyDictionary";
import { getYearSemester } from "../../lib/semesterScope";
import { loadNotifications } from "../../lib/notifications";
import type {
  HistoryDictionaryRequest,
  HistoryDictionaryTerm,
  StudentHistoryDictionaryWord,
  WestoryNotification,
} from "../../types";

const OPEN_REQUEST_STATUSES = new Set(["requested", "needs_approval"]);
const DEFAULT_STUDENT_LEVEL = "중학생 수준";
const EXCEL_TEMPLATE_HEADERS = ["단어", "학생용 풀이", "관련 단원", "태그"];
const MAX_EXCEL_UPLOAD_ROWS = 200;
const ALL_INITIAL = "전체";
const NUMBER_INITIAL = "숫자";
const HANGUL_INITIALS = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
];
const BASE_INITIAL_BY_TENSE: Record<string, string> = {
  ㄲ: "ㄱ",
  ㄸ: "ㄷ",
  ㅃ: "ㅂ",
  ㅆ: "ㅅ",
  ㅉ: "ㅈ",
};
const INITIAL_FILTERS = [
  ALL_INITIAL,
  NUMBER_INITIAL,
  "ㄱ",
  "ㄴ",
  "ㄷ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅅ",
  "ㅇ",
  "ㅈ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
];

type ActiveDictionaryPanel = "terms" | "studentWords" | "requests" | "upload";

type DictionaryEditorDraft = {
  word: string;
  definition: string;
  relatedUnitId: string;
  tags: string[];
  tagInput: string;
};

type DictionaryEditorSource = {
  key: string;
  kind: "new" | "term" | "request" | "studentWord" | "upload";
  request: HistoryDictionaryRequest | null;
  term: HistoryDictionaryTerm | null;
  studentWord: StudentHistoryDictionaryWord | null;
  draft: DictionaryEditorDraft;
  signature: string;
  missing: boolean;
};

const emptyEditorDraft = (): DictionaryEditorDraft => ({
  word: "",
  definition: "",
  relatedUnitId: "",
  tags: [],
  tagInput: "",
});
const copyEditorDraft = (
  draft: DictionaryEditorDraft,
): DictionaryEditorDraft => ({
  ...draft,
  tags: [...draft.tags],
});
const equalEditorDraft = (a: DictionaryEditorDraft, b: DictionaryEditorDraft) =>
  JSON.stringify(a) === JSON.stringify(b);

const editorSourceTarget = (source: DictionaryEditorSource) => {
  const request = source.request as
    | (HistoryDictionaryRequest & { year?: unknown; semester?: unknown })
    | null;
  const studentWord = source.studentWord;
  return JSON.stringify({
    key: source.key,
    kind: source.kind,
    request: request && [
      request.id,
      request.uid,
      request.normalizedWord,
      String(request.year ?? ""),
      String(request.semester ?? ""),
    ],
    term: source.term && [source.term.id, source.term.normalizedWord],
    studentWord: studentWord && [
      studentWord.id,
      studentWord.uid,
      studentWord.termId,
      studentWord.requestId,
      studentWord.normalizedWord,
      studentWord.status,
      String(studentWord.year ?? ""),
      String(studentWord.semester ?? ""),
    ],
  });
};

const createEditorSession = () => ({
  active: true,
  saving: false,
  targetKey: "",
  signature: "",
  source: null as DictionaryEditorSource | null,
  baseline: emptyEditorDraft(),
  draft: emptyEditorDraft(),
  changed: false,
  deleted: false,
  acknowledged: null as DictionaryEditorDraft | null,
  acknowledgedTarget: null as string | null,
  optimisticStudentWord: null as StudentHistoryDictionaryWord | null,
});

interface HistoryDictionaryUploadRow {
  id: string;
  rowNumber: number;
  word: string;
  definition: string;
  relatedUnitId: string;
  tags: string[];
  normalizedWord: string;
  errors: string[];
  notices: string[];
}

const createImportSession = (context: string) => ({
  context,
  readVersion: 0,
  saving: false,
  pending: null as {
    config: ReturnType<typeof getYearSemester>;
    input: Parameters<typeof saveHistoryDictionaryTermsBulk>[1];
    ownerUid: string;
  } | null,
});

const timestampLabel = (value: unknown) => {
  const date =
    value && typeof (value as { toDate?: () => Date }).toDate === "function"
      ? (value as { toDate: () => Date }).toDate()
      : null;
  if (!date) return "";
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const statusLabel = (status: HistoryDictionaryRequest["status"]) => {
  if (status === "needs_approval") return "기존 풀이 승인 필요";
  if (status === "resolved") return "처리 완료";
  if (status === "rejected") return "보류";
  return "새 풀이 필요";
};

const getTimestampMs = (value: unknown) => {
  const date =
    value && typeof (value as { toDate?: () => Date }).toDate === "function"
      ? (value as { toDate: () => Date }).toDate()
      : null;
  return date?.getTime() || 0;
};

const dictionaryRecordSnapshot = (word: object) =>
  JSON.stringify(
    Object.entries(word)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [
        key,
        value && typeof value.toDate === "function"
          ? getTimestampMs(value)
          : value,
      ]),
  );

const getWordInitial = (value: string) => {
  const first = String(value || "")
    .trim()
    .charAt(0);
  if (!first) return "";
  if (/^\d$/.test(first)) return NUMBER_INITIAL;
  const code = first.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const initial = HANGUL_INITIALS[Math.floor((code - 0xac00) / 588)] || "";
    return BASE_INITIAL_BY_TENSE[initial] || initial;
  }
  return first.toUpperCase();
};

const normalizeTag = (value: string) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);

const mapNotificationToHistoryDictionaryRequest = (
  notification: WestoryNotification,
): HistoryDictionaryRequest | null => {
  if (notification.type !== "history_dictionary_requested") return null;

  const requestId = String(notification.entityId || notification.id || "");
  const uid = String(notification.actorUid || "");
  const body = String(notification.body || "")
    .replace(/"/g, "")
    .trim();
  const match = body.match(
    /^(.+?)\s+학생이\s+(.+?)\s+뜻풀이를 요청했습니다\.$/,
  );
  const studentName = String(match?.[1] || "학생").trim();
  const word = String(match?.[2] || "").trim();
  const normalizedWord = normalizeHistoryDictionaryWord(word);
  if (!requestId || !uid || !word || !normalizedWord) return null;

  return {
    id: requestId,
    word,
    normalizedWord,
    uid,
    studentName,
    grade: "",
    class: "",
    number: "",
    memo: "알림 기록에서 확인한 요청입니다.",
    status: "requested",
    matchedTermId: "",
    resolvedTermId: "",
    resolvedBy: "",
    createdAt: notification.createdAt || null,
    updatedAt: notification.createdAt || null,
    resolvedAt: null,
  };
};

const mergeRequestSources = (
  primaryRequests: HistoryDictionaryRequest[],
  fallbackRequests: HistoryDictionaryRequest[],
) => {
  const byKey = new Map<string, HistoryDictionaryRequest>();

  primaryRequests.forEach((request) => {
    const key = request.id || `${request.uid}:${request.normalizedWord}`;
    byKey.set(key, request);
    if (request.uid && request.normalizedWord) {
      byKey.set(`${request.uid}:${request.normalizedWord}`, request);
    }
  });

  fallbackRequests.forEach((request) => {
    const requestKey = request.id || `${request.uid}:${request.normalizedWord}`;
    const wordKey = `${request.uid}:${request.normalizedWord}`;
    if (byKey.has(requestKey) || byKey.has(wordKey)) return;
    byKey.set(requestKey, request);
    if (request.uid && request.normalizedWord) {
      byKey.set(wordKey, request);
    }
  });

  return Array.from(new Set(byKey.values()));
};

const ManageHistoryDictionaryContent: React.FC = () => {
  const { config, currentUser, userData } = useAuth();
  const canRead = canReadLessonManagement(userData, currentUser?.email || "");
  const canWrite = canWriteLessonManagement(userData, currentUser?.email || "");
  const { showToast } = useAppToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const termListRef = useRef<HTMLDivElement>(null);
  const termSectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const studentWordListRef = useRef<HTMLDivElement>(null);
  const studentWordSectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const [requests, setRequests] = useState<HistoryDictionaryRequest[]>([]);
  const requestsRef = useRef(requests);
  const [notificationRequests, setNotificationRequests] = useState<
    HistoryDictionaryRequest[]
  >([]);
  const notificationRequestsRef = useRef(notificationRequests);
  const [terms, setTerms] = useState<HistoryDictionaryTerm[]>([]);
  const [studentWords, setStudentWordsState] = useState<
    StudentHistoryDictionaryWord[]
  >([]);
  const studentWordsRef = useRef(studentWords);
  const setStudentWords = useCallback(
    (next: React.SetStateAction<StudentHistoryDictionaryWord[]>) => {
      const updated =
        typeof next === "function" ? next(studentWordsRef.current) : next;
      studentWordsRef.current = updated;
      setStudentWordsState(updated);
    },
    [],
  );
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [selectedTermId, setSelectedTermId] = useState("");
  const [selectedStudentWordId, setSelectedStudentWordId] = useState("");
  const [word, setWord] = useState("");
  const [definition, setDefinition] = useState("");
  const [relatedUnitId, setRelatedUnitId] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const editorSessionRef = useRef(createEditorSession());
  const [editorSource, setEditorSource] =
    useState<DictionaryEditorSource | null>(null);
  const [editorSourceChanged, setEditorSourceChanged] = useState(false);
  const [editorRefresh, setEditorRefresh] = useState(0);
  const [, refreshMutation] = useState(0);
  useEffect(
    () =>
      subscribeHistoryDictionaryMutation(() =>
        refreshMutation((value) => value + 1),
      ),
    [],
  );
  const mutationPending = hasPendingHistoryDictionaryMutation(
    currentUser?.uid || "",
  );
  const mutationBusy = isHistoryDictionaryMutationBusy(currentUser?.uid || "");
  useEffect(() => {
    const pending = getPendingHistoryDictionaryDraft(
      currentUser?.uid || "",
      config,
    );
    if (!pending) return;
    setWord(pending.word);
    setDefinition(pending.definition);
    setRelatedUnitId(pending.relatedUnitId);
    setTags(pending.tags);
  }, [currentUser?.uid]);
  editorSessionRef.current.draft = {
    word,
    definition,
    relatedUnitId,
    tags,
    tagInput,
  };
  useLayoutEffect(() => {
    const session = editorSessionRef.current;
    session.active = true;
    if (importSessionRef.current.context !== importContext)
      importSessionRef.current = createImportSession(importContext);
    return () => {
      session.active = false;
      importSessionRef.current = createImportSession("");
    };
  }, []);
  const [uploadRows, setUploadRows] = useState<HistoryDictionaryUploadRow[]>(
    [],
  );
  const [uploadFileName, setUploadFileName] = useState("");
  const [busyMessage, setBusyMessage] = useState("");
  const [uploadReading, setUploadReading] = useState(false);
  const scope = getYearSemester(config);
  const importContext = `${currentUser?.uid || ""}/${scope.year}/${scope.semester}/${canWrite}`;
  const importSessionRef = useRef(createImportSession(importContext));
  if (importSessionRef.current.context !== importContext) {
    importSessionRef.current = createImportSession(importContext);
  }
  useEffect(() => {
    setUploadRows([]);
    setUploadFileName("");
    setUploadReading(false);
    setBusyMessage("");
  }, [importContext]);
  useEffect(() => {
    if (importSessionRef.current.context !== importContext)
      importSessionRef.current = createImportSession(importContext);
    return () => {
      importSessionRef.current = createImportSession("");
    };
  }, []);
  const [requestSearch, setRequestSearch] = useState("");
  const [termSearch, setTermSearch] = useState("");
  const [studentWordSearch, setStudentWordSearch] = useState("");
  const [activePanel, setActivePanel] =
    useState<ActiveDictionaryPanel>("terms");
  const [activeInitial, setActiveInitial] = useState(ALL_INITIAL);
  const [scrollActiveInitial, setScrollActiveInitial] = useState(ALL_INITIAL);
  const [activeStudentWordInitial, setActiveStudentWordInitial] =
    useState(ALL_INITIAL);
  const [scrollStudentWordInitial, setScrollStudentWordInitial] =
    useState(ALL_INITIAL);

  useEffect(() => {
    if (!canRead || !config?.year || !config?.semester) return undefined;
    let active = true;
    const unsubscribeRequests = subscribeTeacherHistoryDictionaryRequests(
      config,
      (items) => {
        if (active && editorSessionRef.current.active) {
          requestsRef.current = items;
          setRequests(items);
        }
      },
    );
    const unsubscribeTerms = subscribeTeacherHistoryDictionaryTerms(
      config,
      (items) => {
        if (active && editorSessionRef.current.active) setTerms(items);
      },
      () => {
        if (!active || !editorSessionRef.current.active) return;
        showToast({
          tone: "error",
          title: "등록된 단어 목록을 불러오지 못했습니다.",
          message:
            "새로고침 후에도 계속 비어 있으면 Firestore 읽기 권한을 확인해야 합니다.",
        });
      },
    );
    return () => {
      active = false;
      unsubscribeRequests();
      unsubscribeTerms();
    };
  }, [canRead, showToast, config?.year, config?.semester]);

  useEffect(() => {
    if (!canRead || !config?.year || !config?.semester) {
      setStudentWords([]);
      return undefined;
    }
    let cancelled = false;

    const loadStudentWords = async () => {
      try {
        const words = await loadTeacherStudentHistoryDictionaryWords(config);
        if (!cancelled && editorSessionRef.current.active)
          setStudentWords(words);
      } catch (error) {
        console.error(
          "Failed to load student history dictionary words:",
          error,
        );
        if (!cancelled && editorSessionRef.current.active) {
          setStudentWords([]);
          showToast({
            tone: "error",
            title: "학생 등록 단어를 불러오지 못했습니다.",
            message:
              "교사 권한 확인 후에도 계속 비어 있으면 Functions 배포 상태를 확인해야 합니다.",
          });
        }
      }
    };

    void loadStudentWords();
    return () => {
      cancelled = true;
    };
  }, [canRead, config?.semester, config?.year, showToast]);

  useEffect(() => {
    if (!canRead || !config || !currentUser?.uid) {
      notificationRequestsRef.current = [];
      setNotificationRequests([]);
      return;
    }
    let cancelled = false;

    const loadFallbackRequests = async () => {
      try {
        const notifications = await loadNotifications(config, currentUser.uid);
        if (cancelled || !editorSessionRef.current.active) return;
        const fallbackRequests = notifications
          .map(mapNotificationToHistoryDictionaryRequest)
          .filter((item): item is HistoryDictionaryRequest => Boolean(item));
        notificationRequestsRef.current = fallbackRequests;
        setNotificationRequests(fallbackRequests);
      } catch (error) {
        console.error(
          "Failed to load history dictionary request notifications:",
          error,
        );
        if (!cancelled && editorSessionRef.current.active) {
          notificationRequestsRef.current = [];
          setNotificationRequests([]);
        }
      }
    };

    void loadFallbackRequests();
    return () => {
      cancelled = true;
    };
  }, [canRead, config?.semester, config?.year, currentUser?.uid]);

  const mergedRequests = useMemo(
    () => mergeRequestSources(requests, notificationRequests),
    [notificationRequests, requests],
  );

  const openRequests = useMemo(
    () =>
      mergedRequests.filter((item) =>
        OPEN_REQUEST_STATUSES.has(String(item.status || "")),
      ),
    [mergedRequests],
  );

  const visibleRequests = useMemo(() => {
    const keyword = requestSearch.trim().toLowerCase();
    return openRequests
      .filter((item) => {
        if (!keyword) return true;
        return (
          item.word.toLowerCase().includes(keyword) ||
          (item.studentName || "").toLowerCase().includes(keyword) ||
          (item.memo || "").toLowerCase().includes(keyword)
        );
      })
      .sort(
        (a, b) =>
          getTimestampMs(b.updatedAt || b.createdAt) -
          getTimestampMs(a.updatedAt || a.createdAt),
      );
  }, [openRequests, requestSearch]);

  const visibleTerms = useMemo(() => {
    const keyword = termSearch.trim().toLowerCase();
    return [...terms]
      .filter((item) => {
        const matchesInitial =
          activeInitial === ALL_INITIAL ||
          getWordInitial(item.word) === activeInitial;
        const matchesSearch =
          !keyword ||
          item.word.toLowerCase().includes(keyword) ||
          (item.definition || "").toLowerCase().includes(keyword) ||
          (item.tags || []).some((tag) => tag.toLowerCase().includes(keyword));
        return matchesInitial && matchesSearch;
      })
      .sort((a, b) => a.word.localeCompare(b.word, "ko-KR"));
  }, [activeInitial, termSearch, terms]);

  const visibleStudentWords = useMemo(() => {
    const keyword = studentWordSearch.trim().toLowerCase();
    return studentWords
      .filter((item) => {
        const matchesInitial =
          activeStudentWordInitial === ALL_INITIAL ||
          getWordInitial(item.word) === activeStudentWordInitial;
        const matchesSearch =
          !keyword ||
          item.word.toLowerCase().includes(keyword) ||
          (item.definition || "").toLowerCase().includes(keyword) ||
          (item.studentName || "").toLowerCase().includes(keyword) ||
          (item.grade || "").toLowerCase().includes(keyword) ||
          (item.class || "").toLowerCase().includes(keyword) ||
          (item.number || "").toLowerCase().includes(keyword);
        return matchesInitial && matchesSearch;
      })
      .sort((a, b) => a.word.localeCompare(b.word, "ko-KR"));
  }, [activeStudentWordInitial, studentWordSearch, studentWords]);

  const initialCounts = useMemo(() => {
    const counts = new Map<string, number>();
    terms.forEach((item) => {
      const initial = getWordInitial(item.word);
      counts.set(initial, (counts.get(initial) || 0) + 1);
    });
    return counts;
  }, [terms]);

  const groupedVisibleTerms = useMemo(() => {
    const groups = new Map<string, HistoryDictionaryTerm[]>();
    visibleTerms.forEach((item) => {
      const initial = getWordInitial(item.word) || "기타";
      groups.set(initial, [...(groups.get(initial) || []), item]);
    });
    return Array.from(groups.entries());
  }, [visibleTerms]);
  const studentWordInitialCounts = useMemo(() => {
    const counts = new Map<string, number>();
    studentWords.forEach((item) => {
      const initial = getWordInitial(item.word);
      counts.set(initial, (counts.get(initial) || 0) + 1);
    });
    return counts;
  }, [studentWords]);
  const groupedVisibleStudentWords = useMemo(() => {
    const groups = new Map<string, StudentHistoryDictionaryWord[]>();
    visibleStudentWords.forEach((item) => {
      const initial = getWordInitial(item.word) || "기타";
      groups.set(initial, [...(groups.get(initial) || []), item]);
    });
    return Array.from(groups.entries());
  }, [visibleStudentWords]);
  const highlightedInitial =
    activeInitial === ALL_INITIAL && scrollActiveInitial !== ALL_INITIAL
      ? scrollActiveInitial
      : activeInitial;
  const highlightedStudentWordInitial =
    activeStudentWordInitial === ALL_INITIAL &&
    scrollStudentWordInitial !== ALL_INITIAL
      ? scrollStudentWordInitial
      : activeStudentWordInitial;

  useEffect(() => {
    if (activeInitial !== ALL_INITIAL) return;
    setScrollActiveInitial(groupedVisibleTerms[0]?.[0] || ALL_INITIAL);
  }, [activeInitial, groupedVisibleTerms]);

  useEffect(() => {
    if (activeStudentWordInitial !== ALL_INITIAL) return;
    setScrollStudentWordInitial(
      groupedVisibleStudentWords[0]?.[0] || ALL_INITIAL,
    );
  }, [activeStudentWordInitial, groupedVisibleStudentWords]);

  const handleInitialFilterClick = (initial: string) => {
    setActiveInitial(initial);
    setScrollActiveInitial(initial);
    termListRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleStudentWordInitialFilterClick = (initial: string) => {
    setActiveStudentWordInitial(initial);
    setScrollStudentWordInitial(initial);
    studentWordListRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleTermListScroll = useCallback(() => {
    if (activeInitial !== ALL_INITIAL) return;
    const container = termListRef.current;
    if (!container) return;

    const containerTop = container.getBoundingClientRect().top;
    const sections = groupedVisibleTerms
      .map(([initial]) => ({
        initial,
        element: termSectionRefs.current[initial],
      }))
      .filter((item): item is { initial: string; element: HTMLElement } =>
        Boolean(item.element),
      );
    if (!sections.length) {
      setScrollActiveInitial(ALL_INITIAL);
      return;
    }

    let nextInitial = sections[0].initial;
    for (const section of sections) {
      const offset = section.element.getBoundingClientRect().top - containerTop;
      if (offset <= 16) {
        nextInitial = section.initial;
      } else {
        break;
      }
    }
    setScrollActiveInitial((prev) =>
      prev === nextInitial ? prev : nextInitial,
    );
  }, [activeInitial, groupedVisibleTerms]);

  const handleStudentWordListScroll = useCallback(() => {
    if (activeStudentWordInitial !== ALL_INITIAL) return;
    const container = studentWordListRef.current;
    if (!container) return;

    const containerTop = container.getBoundingClientRect().top;
    const sections = groupedVisibleStudentWords
      .map(([initial]) => ({
        initial,
        element: studentWordSectionRefs.current[initial],
      }))
      .filter((item): item is { initial: string; element: HTMLElement } =>
        Boolean(item.element),
      );
    if (!sections.length) {
      setScrollStudentWordInitial(ALL_INITIAL);
      return;
    }

    let nextInitial = sections[0].initial;
    for (const section of sections) {
      const offset = section.element.getBoundingClientRect().top - containerTop;
      if (offset <= 16) {
        nextInitial = section.initial;
      } else {
        break;
      }
    }
    setScrollStudentWordInitial((prev) =>
      prev === nextInitial ? prev : nextInitial,
    );
  }, [activeStudentWordInitial, groupedVisibleStudentWords]);

  const liveEditorSource = useMemo<DictionaryEditorSource>(() => {
    const request =
      activePanel === "requests"
        ? selectedRequestId
          ? mergedRequests.find((item) => item.id === selectedRequestId) || null
          : openRequests[0] || null
        : null;
    const studentWord =
      activePanel === "studentWords"
        ? selectedStudentWordId
          ? studentWords.find((item) => item.id === selectedStudentWordId) ||
            null
          : visibleStudentWords[0] || null
        : null;
    const term =
      activePanel === "terms"
        ? terms.find((item) => item.id === selectedTermId) || null
        : null;
    const requestTerm = request
      ? terms.find(
          (item) =>
            item.normalizedWord === request.normalizedWord &&
            item.status === "published",
        ) || null
      : null;
    const kind =
      activePanel === "requests"
        ? "request"
        : activePanel === "studentWords"
          ? "studentWord"
          : activePanel === "upload"
            ? "upload"
            : selectedTermId && selectedTermId !== "__new__"
              ? "term"
              : "new";
    const key =
      kind === "request"
        ? `request:${selectedRequestId || request?.id || ""}`
        : kind === "studentWord"
          ? `studentWord:${selectedStudentWordId || studentWord?.id || ""}`
          : kind === "term"
            ? `term:${selectedTermId}`
            : kind;
    const content = studentWord || term || requestTerm;
    const draft: DictionaryEditorDraft = {
      word: request?.word || studentWord?.word || term?.word || "",
      definition: content?.definition || "",
      relatedUnitId: studentWord
        ? ""
        : (term || requestTerm)?.relatedUnitId || "",
      tags: [...(content?.tags || [])],
      tagInput: "",
    };
    const missing =
      kind === "request"
        ? !request
        : kind === "studentWord"
          ? !studentWord
          : kind === "term"
            ? !term
            : false;
    const requestScope = request as
      | (HistoryDictionaryRequest & { year?: unknown; semester?: unknown })
      | null;
    const signature = JSON.stringify({
      draft,
      request: request && [
        request.id,
        request.uid,
        request.normalizedWord,
        request.status,
        request.matchedTermId,
        request.resolvedTermId,
        requestScope?.year,
        requestScope?.semester,
        request.writeVersion,
        request.wordWriteVersion,
      ],
      term: (term || requestTerm) && [
        (term || requestTerm)?.id,
        (term || requestTerm)?.normalizedWord,
        (term || requestTerm)?.status,
        getHistoryDictionaryWriteVersion(term || requestTerm),
      ],
      studentWord: studentWord && [
        studentWord.id,
        studentWord.uid,
        studentWord.termId,
        studentWord.requestId,
        studentWord.year,
        studentWord.semester,
        studentWord.normalizedWord,
        studentWord.status,
        getHistoryDictionaryWriteVersion(studentWord),
      ],
      missing,
    });
    return {
      key,
      kind,
      request,
      term: term || requestTerm,
      studentWord,
      draft,
      signature,
      missing,
    };
  }, [
    activePanel,
    selectedRequestId,
    selectedTermId,
    selectedStudentWordId,
    mergedRequests,
    openRequests,
    terms,
    studentWords,
    visibleStudentWords,
  ]);
  const liveEditorSourceRef = useRef(liveEditorSource);
  liveEditorSourceRef.current = liveEditorSource;
  const selectedRequest = editorSource?.request || null;
  const selectedTerm = editorSource?.term || null;
  const selectedStudentWord = editorSource?.studentWord || null;
  const normalizedEditorWord = normalizeHistoryDictionaryWord(word);
  const matchingTerm = useMemo(() => {
    const target = selectedRequest?.normalizedWord || normalizedEditorWord;
    if (!target) return null;
    return (
      terms.find(
        (item) =>
          item.normalizedWord === target &&
          item.status === "published" &&
          item.definition,
      ) || null
    );
  }, [normalizedEditorWord, selectedRequest?.normalizedWord, terms]);
  const sameWordOpenCount = selectedRequest
    ? openRequests.filter(
        (item) => item.normalizedWord === selectedRequest.normalizedWord,
      ).length
    : 0;
  const uploadStats = useMemo(() => {
    const errorCount = uploadRows.filter((item) => item.errors.length).length;
    const noticeCount = uploadRows.filter(
      (item) => !item.errors.length && item.notices.length,
    ).length;
    return {
      total: uploadRows.length,
      ready: uploadRows.length - errorCount,
      errorCount,
      noticeCount,
    };
  }, [uploadRows]);
  const uploadReadyRows = useMemo(
    () => uploadRows.filter((item) => !item.errors.length),
    [uploadRows],
  );

  const applyEditorSource = (source: DictionaryEditorSource) => {
    const session = editorSessionRef.current;
    if (session.targetKey !== source.key) session.deleted = false;
    session.targetKey = source.key;
    session.signature = source.signature;
    session.source = source;
    session.baseline = copyEditorDraft(source.draft);
    session.draft = copyEditorDraft(source.draft);
    session.changed = false;
    session.acknowledged = null;
    session.acknowledgedTarget = null;
    session.optimisticStudentWord = null;
    setEditorSource(source);
    setEditorSourceChanged(false);
    setWord(source.draft.word);
    setDefinition(source.draft.definition);
    setRelatedUnitId(source.draft.relatedUnitId);
    setTags([...source.draft.tags]);
    setTagInput(source.draft.tagInput);
  };

  useEffect(() => {
    const session = editorSessionRef.current;
    if (!session.active || mutationPending || mutationBusy) return;
    if (session.targetKey !== liveEditorSource.key) {
      applyEditorSource(liveEditorSource);
    } else if (session.deleted) {
      return;
    } else if (liveEditorSource.missing) {
      if (!session.source?.missing) {
        session.changed = true;
        setEditorSourceChanged(true);
      }
    } else if (
      session.signature !== liveEditorSource.signature ||
      (session.acknowledged &&
        session.optimisticStudentWord &&
        liveEditorSource.studentWord !== session.optimisticStudentWord)
    ) {
      const acknowledged = session.acknowledged;
      const matchesAcknowledged =
        acknowledged &&
        session.source &&
        (session.acknowledgedTarget || editorSourceTarget(session.source)) ===
          editorSourceTarget(liveEditorSource) &&
        equalEditorDraft(
          { ...liveEditorSource.draft, tagInput: "" },
          { ...acknowledged, tagInput: "" },
        );
      if (!session.saving && matchesAcknowledged) {
        session.signature = liveEditorSource.signature;
        session.source = liveEditorSource;
        session.baseline = copyEditorDraft(liveEditorSource.draft);
        if (
          !session.optimisticStudentWord ||
          liveEditorSource.studentWord !== session.optimisticStudentWord
        ) {
          session.acknowledged = null;
          session.acknowledgedTarget = null;
          session.optimisticStudentWord = null;
        }
        session.changed = false;
        setEditorSource(liveEditorSource);
        setEditorSourceChanged(false);
      } else if (session.changed) {
        return;
      } else if (
        session.saving ||
        !equalEditorDraft(session.draft, session.baseline) ||
        (session.source &&
          !session.source.missing &&
          editorSourceTarget(session.source) !==
            editorSourceTarget(liveEditorSource)) ||
        (session.source?.studentWord &&
          liveEditorSource.studentWord &&
          session.source.studentWord.status !==
            liveEditorSource.studentWord.status)
      ) {
        session.changed = true;
        setEditorSourceChanged(true);
      } else {
        applyEditorSource(liveEditorSource);
      }
    }
    if (liveEditorSource.request && !selectedRequestId)
      setSelectedRequestId(liveEditorSource.request.id);
    if (liveEditorSource.studentWord && !selectedStudentWordId)
      setSelectedStudentWordId(liveEditorSource.studentWord.id);
  }, [liveEditorSource, editorRefresh, mutationPending, mutationBusy]);

  const editorMutationBlocked =
    mutationPending ||
    mutationBusy ||
    editorSourceChanged ||
    !editorSource ||
    editorSource.missing ||
    (selectedRequest && !OPEN_REQUEST_STATUSES.has(selectedRequest.status));
  const confirmEditorTransition = (nextKey?: string) => {
    const session = editorSessionRef.current;
    if (
      session.saving ||
      importSessionRef.current.saving ||
      busyMessage ||
      mutationPending ||
      mutationBusy
    )
      return false;
    if (nextKey === session.targetKey) return true;
    return (
      equalEditorDraft(session.draft, session.baseline) ||
      window.confirm("저장하지 않은 입력을 버리고 이동할까요?")
    );
  };
  const handleReloadEditor = () => {
    const session = editorSessionRef.current;
    if (
      session.saving ||
      mutationPending ||
      mutationBusy ||
      busyMessage ||
      liveEditorSource.missing ||
      session.deleted
    )
      return;
    if (
      !equalEditorDraft(session.draft, session.baseline) &&
      !window.confirm("작성 중인 입력을 버리고 최신 내용을 다시 불러올까요?")
    )
      return;
    applyEditorSource(liveEditorSource);
  };

  const acceptedSearchRef = useRef<string | null>(null);
  useEffect(() => {
    const nextSearch = searchParams.toString();
    if (acceptedSearchRef.current === nextSearch) return;
    const panel = searchParams.get("panel");
    const requestId = searchParams.get("requestId");
    const nextPanel: ActiveDictionaryPanel =
      requestId || panel === "requests"
        ? "requests"
        : panel === "studentWords"
          ? "studentWords"
          : panel === "upload" && canWrite
            ? "upload"
            : "terms";
    const nextKey = requestId
      ? `request:${requestId}`
      : nextPanel === activePanel
        ? editorSessionRef.current.targetKey
        : undefined;
    if (
      acceptedSearchRef.current !== null &&
      !confirmEditorTransition(nextKey)
    ) {
      setSearchParams(new URLSearchParams(acceptedSearchRef.current), {
        replace: true,
      });
      return;
    }
    acceptedSearchRef.current = nextSearch;
    setActivePanel(nextPanel);
    if (nextPanel !== "requests") setSelectedRequestId("");
    if (nextPanel !== "terms") setSelectedTermId("");
    if (nextPanel !== "studentWords") setSelectedStudentWordId("");
    if (requestId) setSelectedRequestId(requestId);
  }, [searchParams, canWrite]);

  const handleSelectRequest = (requestId: string) => {
    if (!confirmEditorTransition(`request:${requestId}`)) return;
    setActivePanel("requests");
    setSelectedRequestId(requestId);
    setSelectedTermId("");
    setSelectedStudentWordId("");
    setSearchParams({ panel: "requests", requestId });
  };

  const handleSelectTerm = (term: HistoryDictionaryTerm) => {
    if (!confirmEditorTransition(`term:${term.id}`)) return;
    setActivePanel("terms");
    setSelectedTermId(term.id);
    setSelectedRequestId("");
    setSelectedStudentWordId("");
    setSearchParams({});
  };

  const handleSelectStudentWord = (item: StudentHistoryDictionaryWord) => {
    if (!confirmEditorTransition(`studentWord:${item.id}`)) return;
    setActivePanel("studentWords");
    setSelectedStudentWordId(item.id);
    setSelectedRequestId("");
    setSelectedTermId("");
    setSearchParams({ panel: "studentWords" });
  };

  const handleNewTerm = () => {
    if (!canWrite || !confirmEditorTransition()) return;
    setActivePanel("terms");
    setSelectedRequestId("");
    setSelectedTermId("__new__");
    setSelectedStudentWordId("");
    setSearchParams({});
    setWord("");
    setDefinition("");
    setRelatedUnitId("");
    setTags([]);
    setTagInput("");
    const draft = emptyEditorDraft();
    applyEditorSource({
      key: "new",
      kind: "new",
      request: null,
      term: null,
      studentWord: null,
      draft,
      signature: "new",
      missing: false,
    });
  };

  const handleAddTag = () => {
    const nextTag = normalizeTag(tagInput);
    if (!nextTag) return;
    setTags((prev) => {
      if (prev.some((item) => item.toLowerCase() === nextTag.toLowerCase())) {
        return prev;
      }
      return [...prev, nextTag].slice(0, 12);
    });
    setTagInput("");
  };

  const handleRemoveTag = (target: string) => {
    setTags((prev) => prev.filter((item) => item !== target));
  };

  const handleDownloadExcelTemplate = async () => {
    const { default: writeXlsxFile } = await import("write-excel-file/browser");
    await writeXlsxFile(
      [
        EXCEL_TEMPLATE_HEADERS.map((value) => ({
          value,
          fontWeight: "bold",
        })),
        [
          "임진왜란",
          "조선 선조 때 일본이 조선을 침략하며 시작된 전쟁입니다.",
          "조선 전기 / 임진왜란",
          "전쟁, 조선, 일본",
        ].map((value) => ({ value })),
        [
          "실학",
          "조선 후기 현실 문제를 해결하기 위해 등장한 학문 경향입니다.",
          "조선 후기 사회 변화",
          "조선 후기, 개혁",
        ].map((value) => ({ value })),
      ],
      {
        columns: [{ width: 18 }, { width: 54 }, { width: 26 }, { width: 32 }],
        sheet: "역사 사전 업로드",
      },
    ).toFile("westory_history_dictionary_template.xlsx");
  };

  const parseUploadTags = (value: unknown) =>
    String(value || "")
      .split(/[,\n;]/)
      .map(normalizeTag)
      .filter(Boolean)
      .filter((tag, index, list) => {
        const key = tag.toLowerCase();
        return list.findIndex((item) => item.toLowerCase() === key) === index;
      })
      .slice(0, 12);

  const handleExcelUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    const session = importSessionRef.current;
    if (!file || !canWrite || session.saving || session.pending) return;
    const readVersion = ++session.readVersion;
    setUploadReading(true);

    setActivePanel("upload");
    setSelectedRequestId("");
    setSelectedTermId("");
    setSearchParams({ panel: "upload" });

    try {
      const { default: readXlsxFile } = await import("read-excel-file/browser");
      const workbookRows = (await readXlsxFile(file)) as unknown;
      if (
        importSessionRef.current !== session ||
        session.readVersion !== readVersion
      )
        return;
      const rows =
        Array.isArray(workbookRows) &&
        workbookRows.length === 1 &&
        typeof workbookRows[0] === "object" &&
        workbookRows[0] !== null &&
        Array.isArray((workbookRows[0] as { data?: unknown }).data)
          ? ((workbookRows[0] as { data: unknown[][] }).data as unknown[][])
          : (workbookRows as unknown[][]);
      if (!rows.length) {
        throw new Error("첫 번째 시트를 찾을 수 없습니다.");
      }

      const headerIndex = new Map<string, number>();
      (rows[0] || []).forEach((cell, index) => {
        const header = String(cell || "").trim();
        if (header) headerIndex.set(header, index);
      });
      const missingHeaders = EXCEL_TEMPLATE_HEADERS.filter(
        (header) => !headerIndex.has(header),
      );
      if (missingHeaders.length) {
        throw new Error(`필수 컬럼이 없습니다: ${missingHeaders.join(", ")}`);
      }

      const getCell = (row: unknown[], header: string, maxLength: number) =>
        String(row[headerIndex.get(header) ?? -1] || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, maxLength);

      const parsedRows = rows
        .slice(1, MAX_EXCEL_UPLOAD_ROWS + 1)
        .map((row, index) => {
          const word = getCell(row, "단어", 40);
          const definition = getCell(row, "학생용 풀이", 1200);
          const relatedUnitId = getCell(row, "관련 단원", 120);
          const tags = parseUploadTags(row[headerIndex.get("태그") ?? -1]);
          const normalizedWord = normalizeHistoryDictionaryWord(word);
          return {
            id: `upload-${index + 2}-${normalizedWord || index}`,
            rowNumber: index + 2,
            word,
            definition,
            relatedUnitId,
            tags,
            normalizedWord,
            errors: [],
            notices: [],
          } satisfies HistoryDictionaryUploadRow;
        })
        .filter(
          (row) =>
            row.word || row.definition || row.relatedUnitId || row.tags.length,
        );

      if (!parsedRows.length) {
        throw new Error("등록할 행이 없습니다.");
      }

      const normalizedCounts = new Map<string, number>();
      parsedRows.forEach((row) => {
        if (!row.normalizedWord) return;
        normalizedCounts.set(
          row.normalizedWord,
          (normalizedCounts.get(row.normalizedWord) || 0) + 1,
        );
      });
      const existingWords = new Set(
        terms
          .map((term) =>
            normalizeHistoryDictionaryWord(term.normalizedWord || term.word),
          )
          .filter(Boolean),
      );

      const attempt = {
        config: { ...scope },
        ownerUid: currentUser?.uid || "",
        input: {
          terms: parsedRows.map((row) => ({
            word: row.word,
            definition: row.definition,
            studentLevel: DEFAULT_STUDENT_LEVEL,
            relatedUnitId: row.relatedUnitId,
            tags: [...row.tags],
          })),
        },
      };
      const recoverPending = await hasPendingHistoryDictionaryImport(
        attempt.config,
        attempt.input,
        attempt.ownerUid,
      );
      if (
        importSessionRef.current !== session ||
        session.readVersion !== readVersion
      )
        return;
      const inspectedRows = parsedRows.map((row) => {
        const errors: string[] = [];
        const notices: string[] = [];
        if (!row.word) errors.push("단어 빈칸");
        if (!row.definition) errors.push("학생용 풀이 빈칸");
        if (row.definition && row.definition.length < 5) {
          errors.push("풀이 5자 미만");
        }
        if ((normalizedCounts.get(row.normalizedWord) ?? 0) > 1) {
          errors.push("파일 내 중복 단어");
        }
        if (
          !recoverPending &&
          row.normalizedWord &&
          existingWords.has(row.normalizedWord)
        ) {
          errors.push("이미 등록된 단어");
        }
        if (!row.relatedUnitId) notices.push("관련 단원 빈칸");
        if (!row.tags.length) notices.push("태그 빈칸");
        return { ...row, errors, notices };
      });

      if (recoverPending && !inspectedRows.some((row) => row.errors.length))
        session.pending = attempt;
      setUploadFileName(file.name);
      setUploadRows(inspectedRows);
      showToast({
        tone: "success",
        title: "Excel 파일을 불러왔습니다.",
        message: session.pending
          ? "이전 등록 요청을 찾았습니다. ‘등록 결과 다시 확인’을 눌러 결과를 확인해 주세요."
          : "미리보기에서 오류와 중복 단어를 확인한 뒤 등록해 주세요.",
      });
    } catch (error) {
      if (
        importSessionRef.current !== session ||
        session.readVersion !== readVersion
      )
        return;
      console.error("Failed to parse history dictionary Excel:", error);
      setUploadFileName(file.name);
      setUploadRows([]);
      showToast({
        tone: "error",
        title: "Excel 파일을 읽지 못했습니다.",
        message:
          error instanceof Error
            ? error.message
            : "양식 파일인지 확인한 뒤 다시 업로드해 주세요.",
      });
    } finally {
      if (
        importSessionRef.current === session &&
        session.readVersion === readVersion
      )
        setUploadReading(false);
    }
  };

  const handleClearUploadPreview = () => {
    if (importSessionRef.current.pending || importSessionRef.current.saving)
      return;
    importSessionRef.current.readVersion += 1;
    setUploadReading(false);
    setUploadRows([]);
    setUploadFileName("");
  };

  const handleRegisterUploadRows = async () => {
    const session = importSessionRef.current;
    if (
      !canWrite ||
      !currentUser?.uid ||
      session.saving ||
      uploadReading ||
      busyMessage ||
      (!session.pending && (!uploadReadyRows.length || uploadStats.errorCount))
    ) {
      return;
    }
    const existingWords = new Set(
      terms
        .map((term) =>
          normalizeHistoryDictionaryWord(term.normalizedWord || term.word),
        )
        .filter(Boolean),
    );
    const conflictedWords = new Set(
      uploadReadyRows
        .filter((row) => existingWords.has(row.normalizedWord))
        .map((row) => row.normalizedWord),
    );
    if (!session.pending && conflictedWords.size) {
      setUploadRows((prev) =>
        prev.map((row) =>
          conflictedWords.has(row.normalizedWord)
            ? {
                ...row,
                errors: Array.from(
                  new Set([...row.errors, "이미 등록된 단어"]),
                ),
              }
            : row,
        ),
      );
      showToast({
        tone: "error",
        title: "중복 단어가 확인되었습니다.",
        message: "최신 등록 단어 목록과 겹치는 항목을 확인해 주세요.",
      });
      return;
    }
    session.saving = true;
    setBusyMessage(
      session.pending
        ? "이전 일괄 등록 결과를 확인하고 있습니다."
        : `역사 사전 용어 ${uploadReadyRows.length}개를 등록하는 중입니다.`,
    );
    try {
      if (!session.pending)
        session.pending = {
          config: { ...scope },
          ownerUid: currentUser.uid,
          input: {
            terms: uploadReadyRows.map((row) => ({
              word: row.word,
              definition: row.definition,
              studentLevel: DEFAULT_STUDENT_LEVEL,
              relatedUnitId: row.relatedUnitId,
              tags: [...row.tags],
            })),
          },
        };
      const attempt = session.pending;
      const result = await saveHistoryDictionaryTermsBulk(
        attempt.config,
        attempt.input,
        attempt.ownerUid,
      );
      if (importSessionRef.current !== session) return;
      session.pending = null;
      showToast({
        tone: "success",
        title: "역사 사전 용어를 등록했습니다.",
        message: `${result.savedCount}개 항목을 학생용 풀이로 저장했습니다.`,
      });
      try {
        const latestTerms = await loadTeacherHistoryDictionaryTerms(config);
        if (importSessionRef.current !== session) return;
        setTerms(latestTerms);
        setTermSearch("");
        setActiveInitial(ALL_INITIAL);
      } catch (refreshError) {
        if (importSessionRef.current !== session) return;
        console.error(
          "Failed to refresh history dictionary terms after Excel upload:",
          refreshError,
        );
        showToast({
          tone: "warning",
          title: "등록은 완료됐지만 목록 새로고침에 실패했습니다.",
          message: "페이지를 새로고침해 등록된 단어 목록을 다시 불러와 주세요.",
        });
      }
      setUploadRows([]);
      setUploadFileName("");
      setActivePanel("terms");
      setSearchParams({});
    } catch (error) {
      if (importSessionRef.current !== session) return;
      console.error("Failed to register history dictionary Excel rows:", error);
      const uncertain = isHistoryDictionaryImportUncertain(error);
      if (!uncertain) session.pending = null;
      showToast({
        tone: "error",
        title: uncertain
          ? "일괄 등록 결과를 확인해 주세요."
          : isHistoryDictionaryImportConflict(error)
            ? "중복 단어로 등록하지 않았습니다."
            : "일괄 등록을 완료하지 못했습니다.",
        message: uncertain
          ? "미리보기는 유지됩니다. ‘등록 결과 다시 확인’을 눌러 이전 요청을 확인해 주세요."
          : error instanceof Error
            ? error.message
            : "미리보기 내용을 확인한 뒤 다시 시도해 주세요.",
      });
    } finally {
      session.saving = false;
      if (importSessionRef.current === session) setBusyMessage("");
    }
  };

  const beginEditorMutation = () => {
    const session = editorSessionRef.current;
    if (
      !canWrite ||
      !currentUser?.uid ||
      !session.active ||
      session.saving ||
      importSessionRef.current.saving ||
      busyMessage ||
      session.changed ||
      session.deleted ||
      editorMutationBlocked ||
      session.targetKey !== liveEditorSource.key ||
      session.signature !== liveEditorSource.signature ||
      !session.source
    )
      return null;
    session.saving = true;
    return {
      session,
      key: session.targetKey,
      source: session.source,
      draft: copyEditorDraft(session.draft),
      scope: { ...scope },
      ownerUid: currentUser.uid,
    };
  };
  type EditorMutation = NonNullable<ReturnType<typeof beginEditorMutation>>;
  const isCurrentEditorMutation = (operation: EditorMutation) =>
    editorSessionRef.current === operation.session &&
    operation.session.active &&
    operation.session.targetKey === operation.key;
  const finishEditorMutation = (operation: EditorMutation) => {
    operation.session.saving = false;
    if (isCurrentEditorMutation(operation)) {
      setBusyMessage("");
      setEditorRefresh((value) => value + 1);
    }
  };
  const acknowledgeEditorSave = (
    operation: EditorMutation,
    studentOnly = false,
    expectedSource = operation.source,
  ) => {
    const baseline = operation.session.baseline;
    const saved = studentOnly
      ? {
          ...baseline,
          word: operation.draft.word.trim(),
          definition: operation.draft.definition.trim(),
        }
      : {
          ...operation.draft,
          word: operation.draft.word.trim(),
          definition: operation.draft.definition.trim(),
          tagInput: baseline.tagInput,
        };
    operation.session.baseline = copyEditorDraft(saved);
    operation.session.acknowledged = copyEditorDraft(saved);
    operation.session.acknowledgedTarget = editorSourceTarget(expectedSource);
  };
  const isOriginalStudentSourceCurrent = (operation: EditorMutation) => {
    const currentSource = liveEditorSourceRef.current;
    const targetWord = operation.source.studentWord;
    const currentWord = studentWordsRef.current.find(
      (item) => item.id === targetWord?.id,
    );
    return Boolean(
      !operation.session.changed &&
      !currentSource.missing &&
      currentSource.signature === operation.source.signature &&
      editorSourceTarget(currentSource) ===
        editorSourceTarget(operation.source) &&
      currentWord &&
      targetWord &&
      dictionaryRecordSnapshot(currentWord) ===
        dictionaryRecordSnapshot(targetWord),
    );
  };
  const isOriginalRequestSourceCurrent = (operation: EditorMutation) => {
    const currentSource = liveEditorSourceRef.current;
    const originalRequest = operation.source.request;
    const currentRequest = mergeRequestSources(
      requestsRef.current,
      notificationRequestsRef.current,
    ).find((item) => item.id === originalRequest?.id);
    return Boolean(
      !operation.session.changed &&
      !currentSource.missing &&
      currentSource.signature === operation.source.signature &&
      editorSourceTarget(currentSource) ===
        editorSourceTarget(operation.source) &&
      originalRequest &&
      currentRequest &&
      dictionaryRecordSnapshot(originalRequest) ===
        dictionaryRecordSnapshot(currentRequest),
    );
  };
  const markEditorDeleted = (
    operation: EditorMutation,
    originalSourceUnchanged: boolean,
  ) => {
    operation.session.deleted = originalSourceUnchanged;
    operation.session.changed = true;
    operation.session.acknowledged = null;
    operation.session.acknowledgedTarget = null;
    operation.session.optimisticStudentWord = null;
    setEditorSourceChanged(true);
  };

  const handleSaveTerm = async () => {
    if (!word.trim() || definition.trim().length < 5) return;
    const operation = beginEditorMutation();
    if (!operation) return;
    const targetRequest = operation.source.request;
    setBusyMessage(
      "역사 사전 풀이를 저장하고 요청 학생에게 배포하는 중입니다.",
    );
    try {
      await saveHistoryDictionaryTerm(
        operation.scope,
        {
          word: operation.draft.word,
          definition: operation.draft.definition,
          studentLevel: DEFAULT_STUDENT_LEVEL,
          relatedUnitId: operation.draft.relatedUnitId,
          tags: operation.draft.tags,
          expectedTermVersion:
            operation.source.term?.normalizedWord ===
            normalizeHistoryDictionaryWord(operation.draft.word)
              ? getHistoryDictionaryWriteVersion(operation.source.term)
              : null,
          expectedRequestVersion: targetRequest?.writeVersion,
          fallbackRequestId: targetRequest?.id,
          fallbackUid: targetRequest?.uid,
        },
        operation.ownerUid,
      );
      if (!isCurrentEditorMutation(operation)) return;
      acknowledgeEditorSave(operation);
      showToast({
        tone: "success",
        title: "역사 사전에 등록했습니다.",
        message: "같은 단어를 요청한 학생 단어장에 반영했습니다.",
      });
    } catch (error) {
      if (!isCurrentEditorMutation(operation)) return;
      console.error("Failed to save history dictionary term:", error);
      showToast({
        tone: "error",
        title: "역사 사전 저장에 실패했습니다.",
        message: historyDictionaryMutationMessage(error),
      });
    } finally {
      finishEditorMutation(operation);
    }
  };

  const handleSaveStudentWord = async () => {
    if (
      !selectedStudentWord?.uid ||
      !selectedStudentWord.termId ||
      !word.trim() ||
      definition.trim().length < 2 ||
      busyMessage
    ) {
      return;
    }
    const operation = beginEditorMutation();
    if (!operation || !operation.source.studentWord) return;
    const targetWord = operation.source.studentWord;
    if (!targetWord.uid) {
      finishEditorMutation(operation);
      return;
    }
    setBusyMessage("학생 등록 단어를 수정해 학생 단어장에 반영하는 중입니다.");
    try {
      const result = await updateStudentHistoryDictionaryWordByTeacher(
        operation.scope,
        {
          uid: targetWord.uid,
          termId: targetWord.termId,
          word: operation.draft.word,
          definition: operation.draft.definition,
          year: targetWord.year,
          semester: targetWord.semester,
          expectedWordVersion: getHistoryDictionaryWriteVersion(targetWord),
        },
        operation.ownerUid,
      );
      if (!isCurrentEditorMutation(operation)) return;
      const nextId = `${targetWord.uid}:${result.termId}`;
      const savedSource: DictionaryEditorSource = {
        ...operation.source,
        key: `studentWord:${nextId}`,
        studentWord: {
          ...targetWord,
          id: nextId,
          termId: result.termId,
          normalizedWord: normalizeHistoryDictionaryWord(operation.draft.word),
          status: "saved",
        },
      };
      const currentWord = studentWordsRef.current.find(
        (item) => item.id === targetWord.id,
      );
      const canMergeSavedWord =
        isOriginalStudentSourceCurrent(operation) &&
        currentWord &&
        (nextId === targetWord.id ||
          !studentWordsRef.current.some((item) => item.id === nextId));
      acknowledgeEditorSave(operation, true, savedSource);
      if (!canMergeSavedWord) {
        operation.session.changed = true;
        setEditorSourceChanged(true);
        showToast({
          tone: "success",
          title: "학생 등록 단어 수정 요청을 완료했습니다.",
          message:
            "목록이 변경되어 입력을 유지했습니다. 최신 내용을 다시 확인해 주세요.",
        });
        return;
      }
      const savedAt = Date.now();
      const now = {
        toDate: () => new Date(savedAt),
        toMillis: () => savedAt,
      };
      const updatedWord: StudentHistoryDictionaryWord = {
        ...currentWord,
        id: nextId,
        termId: result.termId,
        word: operation.draft.word.trim(),
        normalizedWord: normalizeHistoryDictionaryWord(operation.draft.word),
        definition: operation.draft.definition.trim(),
        definitionSource: "teacher_reviewed",
        status: "saved",
        updatedAt: now,
      };
      operation.session.optimisticStudentWord = updatedWord;
      if (nextId !== targetWord.id) {
        operation.key = `studentWord:${nextId}`;
        operation.session.targetKey = operation.key;
        const nextSource = {
          ...operation.source,
          key: operation.key,
          studentWord: updatedWord,
        };
        operation.session.source = nextSource;
        setEditorSource(nextSource);
      }
      setStudentWords((prev) =>
        prev
          .filter((item) => item.id !== targetWord.id)
          .concat(updatedWord)
          .sort(
            (a, b) =>
              getTimestampMs(b.updatedAt || b.createdAt) -
              getTimestampMs(a.updatedAt || a.createdAt),
          ),
      );
      setSelectedStudentWordId(nextId);
      // A successful write establishes a new baseline; never manufacture a
      // timestamp token from the optimistic client clock.
      void loadTeacherStudentHistoryDictionaryWords(operation.scope)
        .then((items) => {
          if (isCurrentEditorMutation(operation)) setStudentWords(items);
        })
        .catch(() => {
          /* The current draft remains until a later reload. */
        });
      showToast({
        tone: "success",
        title: "학생 등록 단어를 수정했습니다.",
        message: "학생 단어장에 교사 확인 내용이 반영되었습니다.",
      });
    } catch (error) {
      if (!isCurrentEditorMutation(operation)) return;
      console.error("Failed to update student history dictionary word:", error);
      showToast({
        tone: "error",
        title: "학생 등록 단어 수정에 실패했습니다.",
        message: historyDictionaryMutationMessage(error),
      });
    } finally {
      finishEditorMutation(operation);
    }
  };

  const handleApproveExisting = async (requestId?: string) => {
    if (!matchingTerm || busyMessage) return;
    const operation = beginEditorMutation();
    if (!operation) return;
    const targetTerm = operation.source.term || matchingTerm;
    const targetTermId = targetTerm.id;
    setBusyMessage("기존 뜻풀이를 승인하고 학생 단어장에 반영하는 중입니다.");
    try {
      await approveHistoryDictionaryTermForRequests(
        operation.scope,
        {
          termId: targetTermId,
          requestId,
          requestUid: operation.source.request?.uid,
          expectedTermVersion: getHistoryDictionaryWriteVersion(targetTerm),
          expectedRequestVersion: requestId
            ? operation.source.request?.writeVersion
            : null,
        },
        operation.ownerUid,
      );
      if (!isCurrentEditorMutation(operation)) return;
      showToast({
        tone: "success",
        title: "뜻풀이를 승인했습니다.",
        message: requestId
          ? "선택한 요청 학생에게 단어장을 배포했습니다."
          : "같은 단어의 대기 요청을 함께 처리했습니다.",
      });
    } catch (error) {
      if (!isCurrentEditorMutation(operation)) return;
      console.error("Failed to approve history dictionary term:", error);
      showToast({
        tone: "error",
        title: "뜻풀이 승인에 실패했습니다.",
        message: historyDictionaryMutationMessage(error),
      });
    } finally {
      finishEditorMutation(operation);
    }
  };

  const handleRejectRequestWord = async () => {
    if (!selectedRequest || busyMessage) return;
    const confirmed = window.confirm(
      `"${selectedRequest.word}" 요청 단어를 삭제할까요?\n부적절하거나 내용이 부족한 단어라면 학생 단어장에서 삭제되고, 지급된 역사 사전 위스가 있으면 함께 회수됩니다.`,
    );
    if (!confirmed) return;
    const operation = beginEditorMutation();
    if (!operation || !operation.source.request) return;
    const targetRequest = operation.source.request;
    setBusyMessage("요청 단어를 삭제하고 지급된 위스를 확인하는 중입니다.");
    try {
      const result = await deleteStudentHistoryDictionaryWordByTeacher(
        operation.scope,
        {
          uid: targetRequest.uid,
          requestId: targetRequest.id,
          termId: targetRequest.matchedTermId || targetRequest.resolvedTermId,
          word: targetRequest.word,
          normalizedWord: targetRequest.normalizedWord,
          reason: "teacher_rejected_history_dictionary_word",
          expectedWordVersion: targetRequest.wordWriteVersion,
          expectedRequestVersion: targetRequest.writeVersion,
        },
        operation.ownerUid,
      );
      if (!isCurrentEditorMutation(operation)) return;
      const originalSourceUnchanged = isOriginalRequestSourceCurrent(operation);
      markEditorDeleted(operation, originalSourceUnchanged);
      showToast({
        tone: "success",
        title: "요청 단어를 삭제했습니다.",
        message: !originalSourceUnchanged
          ? "삭제 요청은 완료했습니다. 목록이 변경되어 입력을 유지했습니다. 최신 내용을 확인해 주세요."
          : result.reward?.reclaimed
            ? `지급된 ${Number(result.reward.amount || 0)}위스를 회수했습니다.`
            : "요청을 반려하고 학생 단어장 항목을 정리했습니다.",
      });
    } catch (error) {
      if (!isCurrentEditorMutation(operation)) return;
      console.error("Failed to reject history dictionary request:", error);
      showToast({
        tone: "error",
        title: "요청 단어 삭제에 실패했습니다.",
        message: historyDictionaryMutationMessage(error),
      });
    } finally {
      finishEditorMutation(operation);
    }
  };

  const handleDeleteStudentWord = async () => {
    if (
      !selectedStudentWord?.uid ||
      !selectedStudentWord.termId ||
      busyMessage
    ) {
      return;
    }
    const confirmed = window.confirm(
      `"${selectedStudentWord.word}" 학생 등록 단어를 삭제할까요?\n내용이 부족하거나 부적절한 단어라면 학생 단어장에서 삭제되고, 지급된 역사 사전 위스가 있으면 함께 회수됩니다.`,
    );
    if (!confirmed) return;
    const operation = beginEditorMutation();
    if (!operation || !operation.source.studentWord) return;
    const targetWord = operation.source.studentWord;
    if (!targetWord.uid) {
      finishEditorMutation(operation);
      return;
    }
    setBusyMessage(
      "학생 등록 단어를 삭제하고 지급된 위스를 확인하는 중입니다.",
    );
    try {
      const result = await deleteStudentHistoryDictionaryWordByTeacher(
        operation.scope,
        {
          uid: targetWord.uid,
          requestId: targetWord.requestId,
          termId: targetWord.termId,
          word: targetWord.word,
          normalizedWord: targetWord.normalizedWord,
          reason: "teacher_deleted_insufficient_history_dictionary_word",
          expectedWordVersion: getHistoryDictionaryWriteVersion(targetWord),
          year: targetWord.year,
          semester: targetWord.semester,
        },
        operation.ownerUid,
      );
      if (!isCurrentEditorMutation(operation)) return;
      const originalSourceUnchanged = isOriginalStudentSourceCurrent(operation);
      markEditorDeleted(operation, originalSourceUnchanged);
      if (originalSourceUnchanged) {
        setStudentWords((prev) =>
          prev.filter((item) => item.id !== targetWord.id),
        );
      }
      showToast({
        tone: "success",
        title: "학생 등록 단어를 삭제했습니다.",
        message: !originalSourceUnchanged
          ? "삭제 요청은 완료했습니다. 목록이 변경되어 입력을 유지했습니다. 최신 내용을 확인해 주세요."
          : result.reward?.reclaimed
            ? `지급된 ${Number(result.reward.amount || 0)}위스를 회수했습니다.`
            : "학생 단어장에서 항목을 삭제했습니다.",
      });
    } catch (error) {
      if (!isCurrentEditorMutation(operation)) return;
      console.error("Failed to delete student history dictionary word:", error);
      showToast({
        tone: "error",
        title: "학생 등록 단어 삭제에 실패했습니다.",
        message: historyDictionaryMutationMessage(error),
      });
    } finally {
      finishEditorMutation(operation);
    }
  };

  const handleRetryMutation = async () => {
    if (mutationBusy || busyMessage || !currentUser?.uid) return;
    const ownerUid = currentUser.uid;
    setBusyMessage("이전 요청 결과를 확인하는 중입니다.");
    try {
      await retryHistoryDictionaryMutation(ownerUid);
      if (!editorSessionRef.current.active) return;
      editorSessionRef.current.changed = true;
      setEditorSourceChanged(true);
      const items = await loadTeacherStudentHistoryDictionaryWords(scope);
      if (!editorSessionRef.current.active) return;
      setStudentWords(items);
      showToast({
        tone: "success",
        title: "이전 요청을 완료했습니다.",
        message:
          "작성한 입력은 유지됩니다. 최신 내용을 다시 불러와 확인해 주세요.",
      });
    } catch (error) {
      if (editorSessionRef.current.active)
        showToast({
          tone: "error",
          title: "이전 요청 결과를 확인해 주세요.",
          message: historyDictionaryMutationMessage(error),
        });
    } finally {
      if (editorSessionRef.current.active) setBusyMessage("");
    }
  };

  if (!canRead) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <StatePanel
          state="PERMISSION"
          title="역사 사전 관리 권한이 없습니다."
          description="수업 자료를 읽을 수 있는 교사 권한을 확인해 주세요."
          contactAdmin
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 lg:px-6 xl:px-8">
      <div className="mx-auto max-w-7xl">
        {mutationPending && (
          <StatePanel
            state="ERROR"
            title="이전 요청 결과를 확인해 주세요."
            description="작성한 입력은 유지됩니다. 같은 요청의 결과를 확인한 뒤 계속할 수 있습니다."
            compact
            className="mb-4"
            action={
              mutationBusy || busyMessage
                ? undefined
                : {
                    label: "이전 요청 결과 확인",
                    onClick: () => void handleRetryMutation(),
                  }
            }
          />
        )}
        {!canWrite && (
          <StatePanel
            state="PERMISSION"
            title="역사 사전을 읽기 전용으로 확인하고 있습니다."
            description="단어 목록과 요청은 확인할 수 있습니다. 등록·수정·승인·삭제와 Excel 업로드에는 교사 쓰기 권한이 필요합니다."
            readOnly
            compact
            className="mb-4"
          />
        )}
        <div className="grid gap-4 2xl:grid-cols-[13rem_minmax(30rem,1.25fr)_minmax(24rem,0.95fr)]">
          <aside className="self-start overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <nav
              className="divide-y divide-slate-200"
              aria-label="역사 사전 관리 메뉴"
            >
              {[
                {
                  id: "terms" as const,
                  label: "등록된 단어",
                  description: "등록 풀이 수정",
                },
                {
                  id: "studentWords" as const,
                  label: "학생 등록 단어",
                  description: "직접 저장 확인",
                },
                {
                  id: "requests" as const,
                  label: "학생 요청 단어",
                  description: "요청 풀이 작성",
                },
                {
                  id: "upload" as const,
                  label: "Excel 업로드",
                  description: "양식 일괄 등록",
                },
              ]
                .filter((item) => canWrite || item.id !== "upload")
                .map((item) => {
                  const active = activePanel === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={Boolean(busyMessage)}
                      onClick={() => {
                        if (
                          activePanel === item.id ||
                          !confirmEditorTransition()
                        )
                          return;
                        setActivePanel(item.id);
                        if (item.id === "terms") {
                          setSelectedRequestId("");
                          setSelectedStudentWordId("");
                          setSearchParams({});
                        } else if (item.id === "studentWords") {
                          setSelectedRequestId("");
                          setSelectedTermId("");
                          setSearchParams({ panel: "studentWords" });
                        } else if (item.id === "requests") {
                          setSelectedTermId("");
                          setSelectedStudentWordId("");
                          setSearchParams({ panel: "requests" });
                        } else {
                          setSelectedRequestId("");
                          setSelectedTermId("");
                          setSelectedStudentWordId("");
                          setSearchParams({ panel: "upload" });
                        }
                      }}
                      className={`relative block min-h-[3.75rem] w-full px-4 py-3 text-left transition ${
                        active
                          ? "bg-blue-50 text-blue-700"
                          : "bg-white text-slate-800 hover:bg-slate-50"
                      }`}
                    >
                      {active && (
                        <span
                          className="absolute inset-y-0 left-0 w-1 bg-blue-600"
                          aria-hidden="true"
                        />
                      )}
                      <span className="block text-sm font-extrabold">
                        {item.label}
                      </span>
                      <span
                        className={`mt-1 block text-xs font-bold ${
                          active ? "text-blue-600" : "text-slate-500"
                        }`}
                      >
                        {item.description}
                      </span>
                    </button>
                  );
                })}
            </nav>
          </aside>

          {activePanel === "terms" ? (
            <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-extrabold text-slate-950">
                  등록된 단어
                </h2>
                <button
                  type="button"
                  onClick={handleNewTerm}
                  disabled={!canWrite || Boolean(busyMessage)}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 text-xs font-extrabold text-blue-700 transition hover:bg-blue-100"
                >
                  <i className="fas fa-plus text-[11px]" aria-hidden="true"></i>
                  새 풀이
                </button>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-[4.75rem_minmax(0,1fr)]">
                <div className="grid grid-cols-5 gap-2 lg:grid-cols-1">
                  {INITIAL_FILTERS.map((initial) => {
                    const active = highlightedInitial === initial;
                    const count =
                      initial === ALL_INITIAL
                        ? terms.length
                        : initialCounts.get(initial) || 0;
                    return (
                      <button
                        key={initial}
                        type="button"
                        onClick={() => handleInitialFilterClick(initial)}
                        className={`flex h-11 items-center justify-center rounded-lg border text-sm font-extrabold transition ${
                          active
                            ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                            : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50"
                        }`}
                        title={`${initial} ${count}개`}
                      >
                        {initial}
                      </button>
                    );
                  })}
                </div>

                <div className="min-w-0">
                  <label className="relative block">
                    <span className="sr-only">등록 풀이 검색</span>
                    <i
                      className="fas fa-magnifying-glass pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-400"
                      aria-hidden="true"
                    ></i>
                    <input
                      type="search"
                      value={termSearch}
                      onChange={(event) => setTermSearch(event.target.value)}
                      className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                      placeholder="단어, 뜻풀이 검색"
                    />
                  </label>

                  <div className="mt-4 text-xs font-bold text-slate-500">
                    등록된 단어 {terms.length}개
                  </div>

                  <div
                    ref={termListRef}
                    onScroll={handleTermListScroll}
                    className="mt-4 max-h-[calc(100vh-22rem)] min-h-[26rem] overflow-y-auto pr-1"
                  >
                    {!visibleTerms.length && (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-semibold text-slate-500">
                        표시할 단어가 없습니다.
                      </div>
                    )}
                    <div className="space-y-3">
                      {groupedVisibleTerms.map(([initial, items]) => (
                        <section
                          key={initial}
                          ref={(node) => {
                            if (node) {
                              termSectionRefs.current[initial] = node;
                            } else {
                              delete termSectionRefs.current[initial];
                            }
                          }}
                        >
                          <div className="mb-2 px-2 text-sm font-extrabold text-slate-900">
                            {initial}
                          </div>
                          <div className="space-y-2">
                            {items.map((item) => {
                              const active = selectedTerm?.id === item.id;
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => handleSelectTerm(item)}
                                  disabled={Boolean(busyMessage)}
                                  className={`block w-full rounded-lg border px-3 py-3 text-left transition ${
                                    active
                                      ? "border-blue-500 bg-blue-50 shadow-[0_0_0_3px_rgba(37,99,235,0.08)]"
                                      : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/60"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <span
                                      className={`min-w-0 truncate text-sm font-extrabold ${
                                        active
                                          ? "text-blue-700"
                                          : "text-slate-900"
                                      }`}
                                    >
                                      {item.word}
                                    </span>
                                    <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">
                                      학생용
                                    </span>
                                  </div>
                                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
                                    {item.definition}
                                  </p>
                                  {!!item.tags?.length && (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {item.tags.slice(0, 4).map((tag) => (
                                        <span
                                          key={`${item.id}-${tag}`}
                                          className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500"
                                        >
                                          {tag}
                                        </span>
                                      ))}
                                      {item.tags.length > 4 && (
                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-400">
                                          +{item.tags.length - 4}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  <div className="mt-2 text-[11px] font-bold text-slate-400">
                                    {timestampLabel(
                                      item.updatedAt ||
                                        item.publishedAt ||
                                        item.createdAt,
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          ) : activePanel === "studentWords" ? (
            <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <h2 className="text-lg font-extrabold text-slate-950">
                  학생 등록 단어
                </h2>
                <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                  학생이 직접 저장한 단어와 뜻풀이를 확인하고 필요한 항목만
                  수정합니다.
                </p>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-[4.75rem_minmax(0,1fr)]">
                <div className="grid grid-cols-5 gap-2 lg:grid-cols-1">
                  {INITIAL_FILTERS.map((initial) => {
                    const active = highlightedStudentWordInitial === initial;
                    const count =
                      initial === ALL_INITIAL
                        ? studentWords.length
                        : studentWordInitialCounts.get(initial) || 0;
                    return (
                      <button
                        key={`student-word-${initial}`}
                        type="button"
                        onClick={() =>
                          handleStudentWordInitialFilterClick(initial)
                        }
                        className={`flex h-11 items-center justify-center rounded-lg border text-sm font-extrabold transition ${
                          active
                            ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                            : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50"
                        }`}
                        title={`${initial} ${count}개`}
                      >
                        {initial}
                      </button>
                    );
                  })}
                </div>

                <div className="min-w-0">
                  <label className="relative block">
                    <span className="sr-only">학생 등록 단어 검색</span>
                    <i
                      className="fas fa-magnifying-glass pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-400"
                      aria-hidden="true"
                    ></i>
                    <input
                      type="search"
                      value={studentWordSearch}
                      onChange={(event) =>
                        setStudentWordSearch(event.target.value)
                      }
                      className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                      placeholder="단어, 뜻풀이, 학생 검색"
                    />
                  </label>

                  <div className="mt-4 text-xs font-bold text-slate-500">
                    학생 등록 단어 {studentWords.length}개
                  </div>

                  <div
                    ref={studentWordListRef}
                    onScroll={handleStudentWordListScroll}
                    className="mt-4 max-h-[calc(100vh-22rem)] min-h-[26rem] overflow-y-auto pr-1"
                  >
                    {!visibleStudentWords.length && (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-semibold text-slate-500">
                        표시할 학생 등록 단어가 없습니다.
                      </div>
                    )}
                    <div className="space-y-3">
                      {groupedVisibleStudentWords.map(([initial, items]) => (
                        <section
                          key={`student-word-section-${initial}`}
                          ref={(node) => {
                            if (node) {
                              studentWordSectionRefs.current[initial] = node;
                            } else {
                              delete studentWordSectionRefs.current[initial];
                            }
                          }}
                        >
                          <div className="mb-2 px-2 text-sm font-extrabold text-slate-900">
                            {initial}
                          </div>
                          <div className="space-y-2">
                            {items.map((item) => {
                              const active =
                                selectedStudentWord?.id === item.id;
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => handleSelectStudentWord(item)}
                                  disabled={Boolean(busyMessage)}
                                  className={`block w-full rounded-lg border px-3 py-3 text-left transition ${
                                    active
                                      ? "border-blue-500 bg-blue-50 shadow-[0_0_0_3px_rgba(37,99,235,0.08)]"
                                      : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/60"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <span
                                      className={`min-w-0 truncate text-sm font-extrabold ${
                                        active
                                          ? "text-blue-700"
                                          : "text-slate-900"
                                      }`}
                                    >
                                      {item.word}
                                    </span>
                                    <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
                                      직접 등록
                                    </span>
                                  </div>
                                  <div className="mt-2 text-xs font-semibold text-slate-500">
                                    {item.grade ? `${item.grade}학년 ` : ""}
                                    {item.class ? `${item.class}반 ` : ""}
                                    {item.number ? `${item.number}번 · ` : ""}
                                    {item.studentName || "학생"}
                                  </div>
                                  {item.definition && (
                                    <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">
                                      {item.definition}
                                    </div>
                                  )}
                                  <div className="mt-2 text-[11px] font-bold text-slate-400">
                                    {timestampLabel(
                                      item.updatedAt || item.createdAt,
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          ) : activePanel === "requests" ? (
            <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold text-slate-950">
                    학생 요청 단어
                  </h2>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    요청 맥락을 확인한 뒤 풀이를 작성해 배포합니다.
                  </p>
                </div>
              </div>

              <label className="relative mt-5 block">
                <span className="sr-only">요청 검색</span>
                <i
                  className="fas fa-magnifying-glass pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-400"
                  aria-hidden="true"
                ></i>
                <input
                  type="search"
                  value={requestSearch}
                  onChange={(event) => setRequestSearch(event.target.value)}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  placeholder="요청 단어, 학생, 메모 검색"
                />
              </label>

              <div className="mt-4 max-h-[calc(100vh-18rem)] min-h-[26rem] overflow-y-auto pr-1">
                {!visibleRequests.length && (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-semibold text-slate-500">
                    대기 중인 요청이 없습니다.
                  </div>
                )}
                <div className="space-y-2">
                  {visibleRequests.map((item) => {
                    const active = selectedRequest?.id === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectRequest(item.id)}
                        disabled={Boolean(busyMessage)}
                        className={`block w-full rounded-lg border px-3 py-3 text-left transition ${
                          active
                            ? "border-blue-500 bg-blue-50 shadow-[0_0_0_3px_rgba(37,99,235,0.08)]"
                            : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/60"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span
                            className={`min-w-0 truncate text-sm font-extrabold ${
                              active ? "text-blue-700" : "text-slate-900"
                            }`}
                          >
                            {item.word}
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${
                              item.status === "needs_approval"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {statusLabel(item.status)}
                          </span>
                        </div>
                        <div className="mt-2 text-xs font-semibold text-slate-500">
                          {item.grade}학년 {item.class}반 {item.number}번 ·{" "}
                          {item.studentName || "학생"}
                        </div>
                        {item.memo && (
                          <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">
                            {item.memo}
                          </div>
                        )}
                        <div className="mt-2 text-[11px] font-bold text-slate-400">
                          {timestampLabel(item.updatedAt || item.createdAt)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </aside>
          ) : (
            <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div>
                <h2 className="text-lg font-extrabold text-slate-950">
                  Excel 일괄 등록
                </h2>
                <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">
                  양식을 내려받아 작성한 뒤 업로드하면 저장 전 미리보기에서
                  오류와 중복을 확인합니다.
                </p>
              </div>

              <div className="mt-5 space-y-2">
                <button
                  type="button"
                  onClick={() => void handleDownloadExcelTemplate()}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 text-sm font-extrabold text-blue-700 transition hover:bg-blue-100"
                >
                  <i
                    className="fas fa-file-arrow-down text-xs"
                    aria-hidden="true"
                  ></i>
                  업로드 양식 다운로드
                </button>
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={
                    Boolean(busyMessage) ||
                    Boolean(importSessionRef.current.pending) ||
                    uploadReading
                  }
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <i
                    className="fas fa-file-arrow-up text-xs"
                    aria-hidden="true"
                  ></i>
                  Excel 파일 선택
                </button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) => void handleExcelUpload(event)}
                  disabled={
                    Boolean(busyMessage) ||
                    Boolean(importSessionRef.current.pending) ||
                    uploadReading
                  }
                  className="sr-only"
                  aria-label="역사 사전 용어 Excel 파일 업로드"
                />
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-2 text-center">
                <div className="rounded-lg bg-slate-50 px-3 py-3">
                  <dt className="text-[11px] font-bold text-slate-500">
                    불러온 행
                  </dt>
                  <dd className="mt-1 text-lg font-extrabold text-slate-900">
                    {uploadStats.total}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-3">
                  <dt className="text-[11px] font-bold text-slate-500">
                    등록 가능
                  </dt>
                  <dd className="mt-1 text-lg font-extrabold text-blue-700">
                    {uploadStats.ready}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-3">
                  <dt className="text-[11px] font-bold text-slate-500">오류</dt>
                  <dd className="mt-1 text-lg font-extrabold text-rose-600">
                    {uploadStats.errorCount}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-3">
                  <dt className="text-[11px] font-bold text-slate-500">확인</dt>
                  <dd className="mt-1 text-lg font-extrabold text-amber-600">
                    {uploadStats.noticeCount}
                  </dd>
                </div>
              </dl>

              {uploadFileName && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-semibold text-slate-600">
                  <div className="font-extrabold text-slate-800">
                    선택한 파일
                  </div>
                  <div className="mt-1 break-all">{uploadFileName}</div>
                </div>
              )}
            </aside>
          )}

          <fieldset
            disabled={
              !canWrite ||
              Boolean(busyMessage) ||
              (activePanel !== "upload" &&
                (!editorSource || editorSource.missing))
            }
            className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm disabled:opacity-75 lg:p-7"
          >
            {activePanel === "upload" ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-2xl font-extrabold tracking-tight text-slate-950">
                      역사 사전 용어 Excel 업로드
                    </h2>
                    <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                      업로드 직후에는 DB에 저장하지 않습니다. 오류와 중복 단어를
                      확인한 뒤 등록하기를 눌러야 Firebase DB에 저장됩니다.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleDownloadExcelTemplate()}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50"
                    >
                      <i
                        className="fas fa-file-arrow-down text-xs"
                        aria-hidden="true"
                      ></i>
                      양식 다운로드
                    </button>
                    <button
                      type="button"
                      onClick={() => uploadInputRef.current?.click()}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-extrabold text-white transition hover:bg-blue-700"
                    >
                      <i
                        className="fas fa-file-arrow-up text-xs"
                        aria-hidden="true"
                      ></i>
                      파일 업로드
                    </button>
                  </div>
                </div>

                <section className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div>
                      <div className="text-xs font-bold text-slate-500">
                        전체 행
                      </div>
                      <div className="mt-1 text-xl font-extrabold text-slate-950">
                        {uploadStats.total}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-500">
                        등록 가능
                      </div>
                      <div className="mt-1 text-xl font-extrabold text-blue-700">
                        {uploadStats.ready}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-500">
                        오류
                      </div>
                      <div className="mt-1 text-xl font-extrabold text-rose-600">
                        {uploadStats.errorCount}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-500">
                        빈칸 확인
                      </div>
                      <div className="mt-1 text-xl font-extrabold text-amber-600">
                        {uploadStats.noticeCount}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="mt-5">
                  {!uploadRows.length ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-14 text-center">
                      <div className="text-sm font-extrabold text-slate-700">
                        업로드한 Excel 파일이 없습니다.
                      </div>
                      <p className="mt-2 text-sm font-semibold text-slate-500">
                        양식의 컬럼은 단어, 학생용 풀이, 관련 단원, 태그입니다.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-slate-200">
                      <div className="max-h-[calc(100vh-22rem)] overflow-auto">
                        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                          <thead className="sticky top-0 bg-slate-50">
                            <tr>
                              {[
                                "행",
                                "단어",
                                "학생용 풀이",
                                "관련 단원",
                                "태그",
                                "검사 결과",
                              ].map((header) => (
                                <th
                                  key={header}
                                  scope="col"
                                  className="whitespace-nowrap px-3 py-3 text-xs font-extrabold text-slate-600"
                                >
                                  {header}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {uploadRows.map((row) => (
                              <tr
                                key={row.id}
                                className={
                                  row.errors.length
                                    ? "bg-rose-50/50"
                                    : row.notices.length
                                      ? "bg-amber-50/40"
                                      : "bg-white"
                                }
                              >
                                <td className="whitespace-nowrap px-3 py-3 text-xs font-bold text-slate-500">
                                  {row.rowNumber}
                                </td>
                                <td className="max-w-[10rem] px-3 py-3 font-extrabold text-slate-900">
                                  <span className="line-clamp-2">
                                    {row.word || "-"}
                                  </span>
                                </td>
                                <td className="min-w-[18rem] px-3 py-3 text-slate-700">
                                  <span className="line-clamp-3 leading-6">
                                    {row.definition || "-"}
                                  </span>
                                </td>
                                <td className="max-w-[12rem] px-3 py-3 text-slate-600">
                                  <span className="line-clamp-2">
                                    {row.relatedUnitId || "-"}
                                  </span>
                                </td>
                                <td className="min-w-[12rem] px-3 py-3">
                                  <div className="flex flex-wrap gap-1.5">
                                    {row.tags.length ? (
                                      row.tags.map((tag) => (
                                        <span
                                          key={`${row.id}-${tag}`}
                                          className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600"
                                        >
                                          {tag}
                                        </span>
                                      ))
                                    ) : (
                                      <span className="text-xs font-semibold text-slate-400">
                                        -
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="min-w-[12rem] px-3 py-3">
                                  <div className="flex flex-wrap gap-1.5">
                                    {row.errors.length ? (
                                      row.errors.map((error) => (
                                        <span
                                          key={`${row.id}-${error}`}
                                          className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-extrabold text-rose-700"
                                        >
                                          {error}
                                        </span>
                                      ))
                                    ) : (
                                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-extrabold text-blue-700">
                                        등록 가능
                                      </span>
                                    )}
                                    {row.notices.map((notice) => (
                                      <span
                                        key={`${row.id}-${notice}`}
                                        className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-extrabold text-amber-700"
                                      >
                                        {notice}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </section>

                <div className="mt-7 flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-5">
                  <button
                    type="button"
                    onClick={handleClearUploadPreview}
                    disabled={
                      !uploadRows.length ||
                      Boolean(busyMessage) ||
                      Boolean(importSessionRef.current.pending) ||
                      uploadReading
                    }
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-extrabold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    미리보기 비우기
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRegisterUploadRows()}
                    disabled={
                      Boolean(busyMessage) ||
                      uploadReading ||
                      (!importSessionRef.current.pending &&
                        (!uploadReadyRows.length || uploadStats.errorCount > 0))
                    }
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                  >
                    <i
                      className="fas fa-database text-xs"
                      aria-hidden="true"
                    ></i>
                    {importSessionRef.current.pending
                      ? "등록 결과 다시 확인"
                      : "등록하기"}
                  </button>
                </div>
              </>
            ) : (
              <>
                {(editorSourceChanged ||
                  editorSource?.missing ||
                  (selectedRequest &&
                    !OPEN_REQUEST_STATUSES.has(selectedRequest.status))) && (
                  <StatePanel
                    state="STALE"
                    title={
                      liveEditorSource.missing ||
                      editorSessionRef.current.deleted
                        ? "선택한 항목을 목록에서 확인할 수 없습니다."
                        : selectedRequest &&
                            !OPEN_REQUEST_STATUSES.has(selectedRequest.status)
                          ? "이미 처리된 요청입니다."
                          : "목록의 내용이 변경되었습니다."
                    }
                    description="입력은 유지했습니다. 현재 항목에 저장·승인·삭제할 수 없습니다."
                    action={
                      !liveEditorSource.missing &&
                      !editorSessionRef.current.deleted
                        ? {
                            label: "최신 내용 다시 불러오기",
                            onClick: handleReloadEditor,
                          }
                        : undefined
                    }
                    compact
                    className="mb-4"
                  />
                )}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-2xl font-extrabold tracking-tight text-slate-950">
                        {word.trim() || "새 풀이"}
                      </h2>
                      {selectedRequest && (
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-extrabold text-amber-700">
                          요청 처리
                        </span>
                      )}
                      {selectedTerm && (
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-extrabold text-blue-700">
                          등록됨
                        </span>
                      )}
                      {selectedStudentWord && (
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-extrabold text-emerald-700">
                          학생 등록
                        </span>
                      )}
                    </div>
                  </div>
                  {(selectedTerm || selectedStudentWord) && (
                    <div className="text-xs font-semibold text-slate-400">
                      마지막 수정{" "}
                      {timestampLabel(
                        selectedStudentWord
                          ? selectedStudentWord.updatedAt ||
                              selectedStudentWord.createdAt
                          : selectedTerm?.updatedAt ||
                              selectedTerm?.publishedAt ||
                              selectedTerm?.createdAt,
                      )}
                    </div>
                  )}
                </div>

                {selectedStudentWord && (
                  <section className="mt-5 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
                          학생 직접 등록
                        </div>
                        <div className="mt-1 text-sm font-extrabold text-slate-900">
                          {selectedStudentWord.grade
                            ? `${selectedStudentWord.grade}학년 `
                            : ""}
                          {selectedStudentWord.class
                            ? `${selectedStudentWord.class}반 `
                            : ""}
                          {selectedStudentWord.number
                            ? `${selectedStudentWord.number}번 · `
                            : ""}
                          {selectedStudentWord.studentName || "학생"}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-white px-3 py-1.5 text-xs font-extrabold text-emerald-700 shadow-sm">
                          {selectedStudentWord.definitionSource ===
                          "teacher_reviewed"
                            ? "교사 확인 완료"
                            : "확인 전"}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleDeleteStudentWord()}
                          disabled={
                            Boolean(busyMessage) ||
                            Boolean(editorMutationBlocked)
                          }
                          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-rose-100 bg-white px-3 text-xs font-extrabold text-rose-600 shadow-sm transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <i
                            className="fas fa-trash-can text-[11px]"
                            aria-hidden="true"
                          ></i>
                          단어 삭제
                        </button>
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-emerald-900">
                      단어와 풀이만 학생 단어장에 반영됩니다. 공식 역사 사전은
                      바뀌지 않습니다.
                    </p>
                  </section>
                )}

                {selectedRequest && (
                  <section className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                          학생 요청
                        </div>
                        <div className="mt-1 text-sm font-extrabold text-slate-900">
                          {selectedRequest.grade}학년 {selectedRequest.class}반{" "}
                          {selectedRequest.number}번 ·{" "}
                          {selectedRequest.studentName || "학생"}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="rounded-full bg-white px-3 py-1.5 text-xs font-extrabold text-slate-600 shadow-sm">
                          같은 단어 대기 {sameWordOpenCount}건
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleRejectRequestWord()}
                          disabled={
                            Boolean(busyMessage) ||
                            Boolean(editorMutationBlocked)
                          }
                          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-rose-100 bg-white px-3 text-xs font-extrabold text-rose-600 shadow-sm transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <i
                            className="fas fa-trash-can text-[11px]"
                            aria-hidden="true"
                          ></i>
                          요청 삭제
                        </button>
                      </div>
                    </div>
                    {selectedRequest.memo && (
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                        {selectedRequest.memo}
                      </p>
                    )}
                  </section>
                )}

                {selectedRequest && matchingTerm && (
                  <section className="mt-5 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-blue-600">
                        <i
                          className="fas fa-circle-info text-xs"
                          aria-hidden="true"
                        ></i>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-extrabold text-blue-900">
                          이미 등록된 뜻풀이가 있습니다.
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-blue-900">
                          {matchingTerm.definition}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              void handleApproveExisting(selectedRequest.id)
                            }
                            disabled={
                              Boolean(busyMessage) ||
                              Boolean(editorMutationBlocked)
                            }
                            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <i className="fas fa-check text-[11px]"></i>이
                            요청만 승인
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleApproveExisting()}
                            disabled={
                              Boolean(busyMessage) ||
                              Boolean(editorMutationBlocked)
                            }
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-100 bg-white px-3 py-2 text-xs font-extrabold text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            같은 단어 모두 승인
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                <section className="mt-6 space-y-5">
                  <label className="block">
                    <span className="text-sm font-extrabold text-slate-800">
                      단어
                    </span>
                    <input
                      type="text"
                      value={word}
                      onChange={(event) => setWord(event.target.value)}
                      maxLength={40}
                      className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-base font-semibold text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-extrabold text-slate-800">
                      학생용 역사 풀이
                    </span>
                    <textarea
                      value={definition}
                      onChange={(event) => setDefinition(event.target.value)}
                      maxLength={1200}
                      className="mt-2 min-h-[14rem] w-full resize-y rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                      placeholder="학생 수준과 현재 수업 맥락에 맞게 풀이를 적어 주세요."
                    />
                    <span className="mt-2 block text-right text-xs font-semibold text-slate-400">
                      {definition.length} / 1200
                    </span>
                  </label>

                  <section>
                    <div className="mb-2 text-sm font-extrabold text-slate-800">
                      관련 단원 / 태그
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {relatedUnitId && (
                        <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
                          {relatedUnitId}
                          <button
                            type="button"
                            onClick={() => setRelatedUnitId("")}
                            className="text-slate-400 transition hover:text-slate-700"
                            aria-label={`${relatedUnitId} 태그 제거`}
                          >
                            <i className="fas fa-times text-[10px]"></i>
                          </button>
                        </span>
                      )}
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600"
                        >
                          {tag}
                          <button
                            type="button"
                            onClick={() => handleRemoveTag(tag)}
                            className="text-slate-400 transition hover:text-slate-700"
                            aria-label={`${tag} 태그 제거`}
                          >
                            <i className="fas fa-times text-[10px]"></i>
                          </button>
                        </span>
                      ))}
                      {!relatedUnitId && !tags.length && (
                        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-400">
                          태그 없음
                        </span>
                      )}
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_8.25rem]">
                      <input
                        type="text"
                        value={tagInput}
                        onChange={(event) => setTagInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          handleAddTag();
                        }}
                        maxLength={24}
                        className="h-11 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                        placeholder="태그 입력 후 Enter"
                      />
                      <button
                        type="button"
                        onClick={handleAddTag}
                        disabled={!normalizeTag(tagInput) || tags.length >= 12}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 text-sm font-extrabold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        <i
                          className="fas fa-plus text-xs"
                          aria-hidden="true"
                        ></i>
                        태그 추가
                      </button>
                    </div>
                    <input
                      type="text"
                      value={relatedUnitId}
                      onChange={(event) => setRelatedUnitId(event.target.value)}
                      maxLength={120}
                      className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                      placeholder="관련 단원 ID 또는 단원명"
                    />
                  </section>

                  <section>
                    <div className="mb-2 text-sm font-extrabold text-slate-800">
                      처리 범위
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
                        학생용 풀이
                      </span>
                      {selectedRequest && (
                        <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">
                          요청 {sameWordOpenCount}건 연결
                        </span>
                      )}
                      {selectedStudentWord && (
                        <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
                          학생 단어장만 수정
                        </span>
                      )}
                      {selectedTerm?.status && (
                        <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">
                          {selectedTerm.status === "published"
                            ? "공개됨"
                            : selectedTerm.status}
                        </span>
                      )}
                      {tags.map((tag) => (
                        <span
                          key={`scope-${tag}`}
                          className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </section>
                </section>

                <div className="mt-7 flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-5">
                  <button
                    type="button"
                    onClick={handleNewTerm}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-extrabold text-slate-600 transition hover:bg-slate-50"
                  >
                    취소
                  </button>
                  {selectedRequest && matchingTerm && (
                    <button
                      type="button"
                      onClick={() => void handleApproveExisting()}
                      disabled={
                        Boolean(busyMessage) || Boolean(editorMutationBlocked)
                      }
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-5 text-sm font-extrabold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <i
                        className="fas fa-check text-xs"
                        aria-hidden="true"
                      ></i>
                      기존 풀이 승인
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      selectedStudentWord
                        ? void handleSaveStudentWord()
                        : void handleSaveTerm()
                    }
                    disabled={
                      Boolean(busyMessage) ||
                      Boolean(editorMutationBlocked) ||
                      !word.trim() ||
                      definition.trim().length < (selectedStudentWord ? 2 : 5)
                    }
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                  >
                    <i
                      className="fas fa-floppy-disk text-xs"
                      aria-hidden="true"
                    ></i>
                    {selectedStudentWord
                      ? "학생 단어 수정 저장"
                      : "풀이 저장 및 배포"}
                  </button>
                </div>
              </>
            )}
          </fieldset>
        </div>
      </div>

      {busyMessage && <LoadingOverlay message={busyMessage} />}
    </div>
  );
};

const ManageHistoryDictionary: React.FC = () => {
  const { config, currentUser, userData } = useAuth();
  const scope = getYearSemester(config);
  const canRead = canReadLessonManagement(userData, currentUser?.email || "");
  const canWrite = canWriteLessonManagement(userData, currentUser?.email || "");
  const context = `${currentUser?.uid || ""}/${scope.year}/${scope.semester}/${canRead}/${canWrite}`;
  return <ManageHistoryDictionaryContent key={context} />;
};

export default ManageHistoryDictionary;
