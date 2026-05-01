import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../contexts/AuthContext";
import {
  getSemesterCollectionPath,
  getSemesterDocPath,
} from "../../../lib/semesterScope";
import StudentWrongNoteModal from "./StudentWrongNoteModal";

interface QuizDetail {
  id?: string | number;
  correct?: boolean;
  u?: string;
}

interface Log {
  id: string;
  timestamp: any;
  uid?: string;
  unitId?: string;
  category?: string;
  gradeClass?: string;
  studentName: string;
  email?: string;
  score: number;
  classOnly: string;
  studentNumber: string;
  details: QuizDetail[];
}

interface UserProfile {
  uid: string;
  name: string;
  class: string;
  number: string;
  email: string;
  role?: string;
}

interface TreeUnit {
  id: string;
  title: string;
  children?: TreeUnit[];
}

interface QuestionMeta {
  docId: string;
  id: string;
  unitId: string;
  subUnitId: string;
  refBig: string;
  refMid: string;
  refSmall: string;
}

interface UnitMeta {
  id: string;
  title: string;
  bigId: string;
  bigTitle: string;
  midId: string;
  midTitle: string;
  smallId?: string;
  smallTitle?: string;
}

interface StudentSummary {
  key: string;
  uid: string;
  name: string;
  email: string;
  classOnly: string;
  number: string;
  logs: Log[];
  latestLog?: Log;
  latestScore: number | null;
  averageScore: number | null;
  attemptCount: number;
  weakUnits: string[];
  status: "stable" | "watch" | "risk" | "pending";
}

interface RecentDefaultUnitStat {
  bigId: string;
  midId: string;
  studentKeys: Set<string>;
  attemptCount: number;
  latestMs: number;
}

interface RecentClassFocus {
  classOnly: string;
  studentCount: number;
  latestMs: number;
  thresholdMs: number;
}

type SortKey =
  | "scoreAsc"
  | "scoreDesc"
  | "nameAsc"
  | "attemptDesc"
  | "averageAsc";

const SCORE_BUCKETS = [
  { label: "0-20", min: 0, max: 20 },
  { label: "21-40", min: 21, max: 40 },
  { label: "41-60", min: 41, max: 60 },
  { label: "61-80", min: 61, max: 80 },
  { label: "81-100", min: 81, max: 100 },
];

const RESULT_LIMIT = 50;
const STUDENTS_PER_PAGE = 50;
const FIRESTORE_IN_CHUNK_SIZE = 10;
const BACKFILL_BASIC_LIMIT = 50;
const BACKFILL_FILTERED_LIMIT = 150;
const BACKFILL_CLASS_LIMIT = 300;
const RECENT_CLASS_FOCUS_MIN_STUDENTS = 10;

const normalizeClass = (value: unknown): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.match(/\d+/)?.[0];
  return digits || raw.replace("반", "").trim();
};

const normalizeNumber = (value: unknown): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.match(/\d+/)?.[0];
  return digits || raw.replace("번", "").trim();
};

const toText = (value: unknown): string => String(value ?? "").trim();

const getTimestampMs = (value: any): number => {
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return date.getTime();
    }
  }
  return 0;
};

const formatTime = (value: number) => {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const average = (values: number[]) => {
  if (!values.length) return null;
  return values.reduce((acc, cur) => acc + cur, 0) / values.length;
};

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
};

const roundOne = (value: number | null) =>
  value === null ? "-" : Number(value.toFixed(1)).toString();

const chunkArray = <T,>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, index * size + size),
  );

const buildStudentKey = (params: {
  uid?: string;
  email?: string;
  classOnly?: string;
  number?: string;
  name?: string;
}) => {
  if (params.uid) return `uid:${params.uid}`;
  if (params.email) return `email:${params.email}`;
  return `fallback:${params.classOnly || "-"}:${params.number || "-"}:${params.name || "학생"}`;
};

const buildDedupKey = (log: Log): string => {
  const identity =
    toText(log.uid) ||
    toText(log.email) ||
    `${toText(log.classOnly)}-${toText(log.studentNumber)}-${toText(log.studentName)}`;
  return [
    identity,
    toText(log.unitId),
    toText(log.category),
    String(getTimestampMs(log.timestamp)),
    String(log.score),
  ].join("::");
};

const findRecentClassFocus = (logs: Log[]): RecentClassFocus | null => {
  const byClass = new Map<
    string,
    {
      studentKeys: Set<string>;
      latestMs: number;
      thresholdMs: number;
    }
  >();

  [...logs]
    .sort((a, b) => getTimestampMs(b.timestamp) - getTimestampMs(a.timestamp))
    .forEach((log) => {
      const classOnly = toText(log.classOnly);
      if (!classOnly || classOnly === "-") return;
      const studentKey = buildStudentKey({
        uid: log.uid,
        email: log.email,
        classOnly: log.classOnly,
        number: log.studentNumber,
        name: log.studentName,
      });
      const timestampMs = getTimestampMs(log.timestamp);
      const current =
        byClass.get(classOnly) ||
        {
          studentKeys: new Set<string>(),
          latestMs: 0,
          thresholdMs: 0,
        };
      const previousSize = current.studentKeys.size;
      current.studentKeys.add(studentKey);
      current.latestMs = Math.max(current.latestMs, timestampMs);
      if (
        previousSize < RECENT_CLASS_FOCUS_MIN_STUDENTS &&
        current.studentKeys.size >= RECENT_CLASS_FOCUS_MIN_STUDENTS
      ) {
        current.thresholdMs = timestampMs;
      }
      byClass.set(classOnly, current);
    });

  return (
    Array.from(byClass.entries())
      .filter(
        ([, item]) => item.studentKeys.size >= RECENT_CLASS_FOCUS_MIN_STUDENTS,
      )
      .map(([classOnly, item]) => ({
        classOnly,
        studentCount: item.studentKeys.size,
        latestMs: item.latestMs,
        thresholdMs: item.thresholdMs,
      }))
      .sort((a, b) => {
        if (a.thresholdMs !== b.thresholdMs) return b.thresholdMs - a.thresholdMs;
        if (a.latestMs !== b.latestMs) return b.latestMs - a.latestMs;
        return Number(a.classOnly) - Number(b.classOnly);
      })[0] || null
  );
};

const buildUnitMetaMap = (treeData: TreeUnit[]) => {
  const map = new Map<string, UnitMeta>();

  treeData.forEach((big) => {
    map.set(big.id, {
      id: big.id,
      title: big.title,
      bigId: big.id,
      bigTitle: big.title,
      midId: "",
      midTitle: "",
    });

    (big.children || []).forEach((mid) => {
      map.set(mid.id, {
        id: mid.id,
        title: mid.title,
        bigId: big.id,
        bigTitle: big.title,
        midId: mid.id,
        midTitle: mid.title,
      });

      (mid.children || []).forEach((small) => {
        map.set(small.id, {
          id: small.id,
          title: small.title,
          bigId: big.id,
          bigTitle: big.title,
          midId: mid.id,
          midTitle: mid.title,
          smallId: small.id,
          smallTitle: small.title,
        });
      });
    });
  });

  return map;
};

const parseLogDoc = (id: string, raw: any): Log => {
  const gradeClassRaw = toText(
    raw.gradeClass ||
      raw.classInfo ||
      raw.student?.gradeClass ||
      raw.user?.gradeClass,
  );
  const classOnly =
    toText(
      raw.class ||
        raw.classOnly ||
        raw.className ||
        raw.studentClass ||
        raw.student?.class ||
        raw.user?.class ||
        (gradeClassRaw ? gradeClassRaw.split(" ")[1] : ""),
    ) || "-";
  const studentNumber =
    toText(
      raw.number ||
        raw.studentNumber ||
        raw.studentNo ||
        raw.no ||
        raw.student?.number ||
        raw.user?.number ||
        (gradeClassRaw ? gradeClassRaw.split(" ")[2]?.replace("번", "") : ""),
    ) || "-";

  return {
    id,
    timestamp: raw.timestamp,
    uid: toText(
      raw.uid ||
        raw.studentId ||
        raw.userId ||
        raw.student?.uid ||
        raw.user?.uid,
    ),
    unitId: toText(raw.unitId),
    category: toText(raw.category),
    gradeClass: gradeClassRaw,
    studentName:
      toText(
        raw.name ||
          raw.studentName ||
          raw.userName ||
          raw.student?.name ||
          raw.user?.name,
      ) || "학생",
    email: toText(
      raw.email ||
        raw.studentEmail ||
        raw.userEmail ||
        raw.student?.email ||
        raw.user?.email,
    ),
    score: Number(raw.score || 0),
    classOnly: normalizeClass(classOnly) || "-",
    studentNumber: normalizeNumber(studentNumber) || "-",
    details: Array.isArray(raw.details) ? raw.details : [],
  };
};

const getStatusMeta = (status: StudentSummary["status"]) => {
  if (status === "pending")
    return {
      label: "미응시",
      className: "border-gray-200 bg-gray-50 text-gray-500",
    };
  if (status === "risk")
    return {
      label: "위험",
      className: "border-red-200 bg-red-50 text-red-600",
    };
  if (status === "watch")
    return {
      label: "주의",
      className: "border-amber-200 bg-amber-50 text-amber-700",
    };
  return {
    label: "안정",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
};

const QuizLogTab: React.FC = () => {
  const { config } = useAuth();
  const [logs, setLogs] = useState<Log[]>([]);
  const [analyticsBackfillLogs, setAnalyticsBackfillLogs] = useState<Log[]>([]);
  const [students, setStudents] = useState<UserProfile[]>([]);
  const [treeData, setTreeData] = useState<TreeUnit[]>([]);
  const [questions, setQuestions] = useState<QuestionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyticsBackfillLoading, setAnalyticsBackfillLoading] =
    useState(false);
  const [supportLoading, setSupportLoading] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [rosterLimited, setRosterLimited] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [classFilter, setClassFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [bigFilter, setBigFilter] = useState("");
  const [midFilter, setMidFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("scoreAsc");
  const [showPendingOnly, setShowPendingOnly] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [studentPage, setStudentPage] = useState(1);
  const [lowScoreModalOpen, setLowScoreModalOpen] = useState(false);
  const [lowScorePage, setLowScorePage] = useState(1);
  const [scoreBucketModalOpen, setScoreBucketModalOpen] = useState(false);
  const [selectedScoreBucket, setSelectedScoreBucket] = useState<
    (typeof SCORE_BUCKETS)[number] | null
  >(null);
  const [scoreBucketPage, setScoreBucketPage] = useState(1);
  const [pendingModalOpen, setPendingModalOpen] = useState(false);
  const [pendingPage, setPendingPage] = useState(1);
  const [returnToLowScoreModal, setReturnToLowScoreModal] = useState(false);
  const [returnToScoreBucketModal, setReturnToScoreBucketModal] =
    useState(false);
  const [returnToPendingModal, setReturnToPendingModal] = useState(false);
  const [wrongNoteTarget, setWrongNoteTarget] = useState<{
    uid: string;
    name: string;
  } | null>(null);
  const lowScoreModalRef = useRef<HTMLDivElement>(null);
  const lowScoreCloseButtonRef = useRef<HTMLButtonElement>(null);
  const scoreBucketCloseButtonRef = useRef<HTMLButtonElement>(null);
  const pendingCloseButtonRef = useRef<HTMLButtonElement>(null);
  const autoUnitFilterAppliedRef = useRef(false);
  const userTouchedUnitFilterRef = useRef(false);
  const userTouchedClassFilterRef = useRef(false);

  const unitMetaById = useMemo(() => buildUnitMetaMap(treeData), [treeData]);

  const questionMetaById = useMemo(() => {
    const map = new Map<string, QuestionMeta>();
    questions.forEach((question) => {
      if (question.docId) map.set(question.docId, question);
      if (question.id) map.set(question.id, question);
    });
    return map;
  }, [questions]);

  const reload = () => {
    setRefreshKey((prev) => prev + 1);
  };

  useEffect(() => {
    if (!lowScoreModalOpen) return;

    lowScoreCloseButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLowScoreModalOpen(false);
        return;
      }

      if (event.key !== "Tab") return;

      const modal = lowScoreModalRef.current;
      if (!modal) return;

      const focusable = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("disabled"));

      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lowScoreModalOpen]);

  useEffect(() => {
    let active = true;

    const loadSupportData = async () => {
      setSupportLoading(true);
      try {
        const [treeResult, questionSnap, userSnap] = await Promise.allSettled([
          (async () => {
            const scoped = await getDoc(
              doc(db, getSemesterDocPath(config, "curriculum", "tree")),
            );
            if (scoped.exists())
              return (scoped.data().tree || []) as TreeUnit[];
            const legacy = await getDoc(doc(db, "curriculum", "tree"));
            return legacy.exists()
              ? ((legacy.data().tree || []) as TreeUnit[])
              : [];
          })(),
          getDocs(
            collection(db, getSemesterCollectionPath(config, "quiz_questions")),
          ),
          getDocs(collection(db, "users")),
        ]);

        if (!active) return;

        if (treeResult.status === "fulfilled") {
          setTreeData(treeResult.value);
        } else {
          console.error(treeResult.reason);
          setTreeData([]);
        }

        if (questionSnap.status === "fulfilled") {
          setQuestions(
            questionSnap.value.docs.map((item) => {
              const data = item.data() as any;
              return {
                docId: item.id,
                id: toText(data.id || item.id),
                unitId: toText(data.unitId),
                subUnitId: toText(data.subUnitId),
                refBig: toText(data.refBig),
                refMid: toText(data.refMid),
                refSmall: toText(data.refSmall),
              };
            }),
          );
        } else {
          console.error(questionSnap.reason);
          setQuestions([]);
        }

        if (userSnap.status === "fulfilled") {
          setRosterLimited(false);
          setStudents(
            userSnap.value.docs
              .map((item) => {
                const data = item.data() as any;
                return {
                  uid: item.id,
                  name: toText(data.name) || "학생",
                  class: normalizeClass(data.class),
                  number: normalizeNumber(data.number),
                  email: toText(data.email),
                  role: toText(data.role),
                };
              })
              .filter((student) => student.role !== "teacher" && student.class),
          );
        } else {
          console.error(userSnap.reason);
          setRosterLimited(true);
          setStudents([]);
        }
      } finally {
        if (active) setSupportLoading(false);
      }
    };

    void loadSupportData();

    return () => {
      active = false;
    };
  }, [config]);

  useEffect(() => {
    setLoading(true);
    setLoadError("");

    const unsubscribe = onSnapshot(
      query(
        collection(db, getSemesterCollectionPath(config, "quiz_results")),
        orderBy("timestamp", "desc"),
        limit(RESULT_LIMIT),
      ),
      (snap) => {
        const dedupedMap = new Map<string, Log>();
        snap.docs.forEach((item) => {
          const log = parseLogDoc(item.id, item.data());
          const key = buildDedupKey(log);
          const existing = dedupedMap.get(key);
          if (
            !existing ||
            getTimestampMs(log.timestamp) >= getTimestampMs(existing.timestamp)
          ) {
            dedupedMap.set(key, log);
          }
        });
        const list = Array.from(dedupedMap.values());
        list.sort(
          (a, b) => getTimestampMs(b.timestamp) - getTimestampMs(a.timestamp),
        );
        setLogs(list);
        setLastSyncedAt(Date.now());
        setLoading(false);
      },
      (error) => {
        console.error(error);
        setLoadError("응시 데이터를 불러오지 못했습니다.");
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [config, refreshKey]);

  const bigOptions = treeData;
  const midOptions = useMemo(() => {
    if (!bigFilter) return treeData.flatMap((big) => big.children || []);
    return treeData.find((big) => big.id === bigFilter)?.children || [];
  }, [bigFilter, treeData]);

  const selectedUnitFilterIds = useMemo(() => {
    const ids = new Set<string>();
    const addUnitWithChildren = (unit?: TreeUnit) => {
      if (!unit) return;
      ids.add(unit.id);
      (unit.children || []).forEach(addUnitWithChildren);
    };

    if (midFilter) {
      const mid = treeData
        .flatMap((big) => big.children || [])
        .find((item) => item.id === midFilter);
      addUnitWithChildren(mid);
    } else if (bigFilter) {
      addUnitWithChildren(treeData.find((big) => big.id === bigFilter));
    }

    return Array.from(ids);
  }, [bigFilter, midFilter, treeData]);

  useEffect(() => {
    const targetStudents = students.filter((student) => student.uid);

    if (!targetStudents.length) {
      setAnalyticsBackfillLogs([]);
      setAnalyticsBackfillLoading(false);
      return;
    }

    let active = true;
    setAnalyticsBackfillLoading(true);

    const loadAnalyticsBackfillLogs = async () => {
      try {
        const quizResultCollection = collection(
          db,
          getSemesterCollectionPath(config, "quiz_results"),
        );
        const hasAnalysisFilter =
          Boolean(categoryFilter) || selectedUnitFilterIds.length > 0;
        const baseQueryLimit = hasAnalysisFilter
          ? BACKFILL_FILTERED_LIMIT
          : BACKFILL_BASIC_LIMIT;
        const buildUidChunks = (items: UserProfile[]) =>
          chunkArray(
            Array.from(new Set(items.map((student) => student.uid))),
            FIRESTORE_IN_CHUNK_SIZE,
          );
        const selectedClassStudents = classFilter
          ? targetStudents.filter((student) => student.class === classFilter)
          : [];
        const queryPlans = [
          ...buildUidChunks(targetStudents).map((uidChunk) => ({
            uidChunk,
            queryLimit: baseQueryLimit,
          })),
          ...buildUidChunks(selectedClassStudents).map((uidChunk) => ({
            uidChunk,
            queryLimit: BACKFILL_CLASS_LIMIT,
          })),
        ];

        const snaps = await Promise.all(
          queryPlans.map(async ({ uidChunk, queryLimit }) => {
            const constraints = [
              where("uid", "in", uidChunk),
              ...(categoryFilter
                ? [where("category", "==", categoryFilter)]
                : []),
              orderBy("timestamp", "desc"),
              limit(queryLimit),
            ];
            try {
              return await getDocs(query(quizResultCollection, ...constraints));
            } catch (error) {
              console.warn(error);
              return getDocs(
                query(
                  quizResultCollection,
                  where("uid", "in", uidChunk),
                  ...(categoryFilter
                    ? [where("category", "==", categoryFilter)]
                    : []),
                  limit(queryLimit),
                ),
              );
            }
          }),
        );

        if (!active) return;

        const dedupedMap = new Map<string, Log>();
        snaps.forEach((snap) => {
          snap.docs.forEach((item) => {
            const log = parseLogDoc(item.id, item.data());
            const key = buildDedupKey(log);
            const existing = dedupedMap.get(key);
            if (
              !existing ||
              getTimestampMs(log.timestamp) >=
                getTimestampMs(existing.timestamp)
            ) {
              dedupedMap.set(key, log);
            }
          });
        });

        let list = Array.from(dedupedMap.values());
        if (selectedUnitFilterIds.length) {
          const unitIds = new Set(selectedUnitFilterIds);
          list = list.filter((log) => {
            if (log.unitId && unitIds.has(log.unitId)) return true;
            return getLogUnitMetas(log).some(
              (meta) =>
                unitIds.has(meta.id) ||
                unitIds.has(meta.bigId) ||
                unitIds.has(meta.midId) ||
                Boolean(meta.smallId && unitIds.has(meta.smallId)),
            );
          });
        }

        list.sort(
          (a, b) => getTimestampMs(b.timestamp) - getTimestampMs(a.timestamp),
        );
        setAnalyticsBackfillLogs(list);
      } catch (error) {
        console.error(error);
        if (active) setAnalyticsBackfillLogs([]);
      } finally {
        if (active) setAnalyticsBackfillLoading(false);
      }
    };

    void loadAnalyticsBackfillLogs();

    return () => {
      active = false;
    };
  }, [
    categoryFilter,
    classFilter,
    config,
    refreshKey,
    selectedUnitFilterIds,
    students,
    unitMetaById,
    questionMetaById,
  ]);

  const getLogUnitMetas = (log: Log) => {
    const metas: UnitMeta[] = [];
    const direct = log.unitId ? unitMetaById.get(log.unitId) : undefined;
    if (direct) metas.push(direct);

    log.details.forEach((detail) => {
      const question = questionMetaById.get(toText(detail.id));
      const ids = [
        question?.refSmall,
        question?.subUnitId,
        question?.refMid,
        question?.unitId,
        question?.refBig,
      ].filter(Boolean) as string[];
      const meta = ids.map((id) => unitMetaById.get(id)).find(Boolean);
      if (meta) metas.push(meta);
    });

    return metas;
  };

  const findUnitMeta = (ids: Array<string | undefined>) =>
    ids
      .map((id) => (id ? unitMetaById.get(id) : undefined))
      .find((meta): meta is UnitMeta => Boolean(meta));

  const profileMap = useMemo(() => {
    const map = new Map<string, UserProfile>();
    students.forEach((student) => {
      map.set(buildStudentKey({ uid: student.uid }), student);
      if (student.email)
        map.set(buildStudentKey({ email: student.email }), student);
    });
    return map;
  }, [students]);

  const mergedLogs = useMemo(() => {
    const dedupedMap = new Map<string, Log>();
    [...logs, ...analyticsBackfillLogs].forEach((log) => {
      const key = buildDedupKey(log);
      const existing = dedupedMap.get(key);
      if (
        !existing ||
        getTimestampMs(log.timestamp) >= getTimestampMs(existing.timestamp)
      ) {
        dedupedMap.set(key, log);
      }
    });
    return Array.from(dedupedMap.values()).sort(
      (a, b) => getTimestampMs(b.timestamp) - getTimestampMs(a.timestamp),
    );
  }, [analyticsBackfillLogs, logs]);

  const canonicalLogs = useMemo(
    () =>
      mergedLogs.map((log) => {
        const profile =
          (log.uid
            ? profileMap.get(buildStudentKey({ uid: log.uid }))
            : undefined) ||
          (log.email
            ? profileMap.get(buildStudentKey({ email: log.email }))
            : undefined);
        if (!profile) return log;
        return {
          ...log,
          uid: log.uid || profile.uid,
          email: log.email || profile.email,
          studentName: profile.name || log.studentName,
          classOnly: profile.class || log.classOnly,
          studentNumber: profile.number || log.studentNumber,
        };
      }),
    [mergedLogs, profileMap],
  );

  const recentClassFocus = useMemo(
    () => findRecentClassFocus(canonicalLogs),
    [canonicalLogs],
  );

  useEffect(() => {
    if (userTouchedClassFilterRef.current || !recentClassFocus) return;
    if (classFilter === recentClassFocus.classOnly) return;
    setClassFilter(recentClassFocus.classOnly);
  }, [classFilter, recentClassFocus]);

  const analysisLogs = useMemo(() => {
    return canonicalLogs.filter((log) => {
      if (categoryFilter && log.category !== categoryFilter) return false;

      if (bigFilter || midFilter) {
        const metas = getLogUnitMetas(log);
        if (!metas.length) return false;
        if (
          bigFilter &&
          !metas.some(
            (meta) => meta.bigId === bigFilter || meta.id === bigFilter,
          )
        )
          return false;
        if (
          midFilter &&
          !metas.some(
            (meta) => meta.midId === midFilter || meta.id === midFilter,
          )
        )
          return false;
      }

      return true;
    });
  }, [
    bigFilter,
    canonicalLogs,
    categoryFilter,
    midFilter,
    questionMetaById,
    unitMetaById,
  ]);

  const recentDefaultUnitSelection = useMemo(() => {
    const unitStats = new Map<string, RecentDefaultUnitStat>();

    canonicalLogs.forEach((log) => {
      const studentKey = buildStudentKey({
        uid: log.uid,
        email: log.email,
        classOnly: log.classOnly,
        number: log.studentNumber,
        name: log.studentName,
      });
      const latestMs = getTimestampMs(log.timestamp);
      const countedUnitKeys = new Set<string>();

      getLogUnitMetas(log).forEach((meta) => {
        if (!meta.bigId || !meta.midId) return;

        const key = `${meta.bigId}::${meta.midId}`;
        if (countedUnitKeys.has(key)) return;
        countedUnitKeys.add(key);

        const existing =
          unitStats.get(key) ||
          {
            bigId: meta.bigId,
            midId: meta.midId,
            studentKeys: new Set<string>(),
            attemptCount: 0,
            latestMs: 0,
          };

        existing.studentKeys.add(studentKey);
        existing.attemptCount += 1;
        existing.latestMs = Math.max(existing.latestMs, latestMs);
        unitStats.set(key, existing);
      });
    });

    return (
      Array.from(unitStats.values()).sort((a, b) => {
        const studentDiff = b.studentKeys.size - a.studentKeys.size;
        if (studentDiff !== 0) return studentDiff;
        const attemptDiff = b.attemptCount - a.attemptCount;
        if (attemptDiff !== 0) return attemptDiff;
        return b.latestMs - a.latestMs;
      })[0] || null
    );
  }, [canonicalLogs, questionMetaById, unitMetaById]);

  useEffect(() => {
    if (autoUnitFilterAppliedRef.current || userTouchedUnitFilterRef.current)
      return;
    if (bigFilter || midFilter || !recentDefaultUnitSelection) return;

    const big = treeData.find(
      (item) => item.id === recentDefaultUnitSelection.bigId,
    );
    const mid = (big?.children || []).find(
      (item) => item.id === recentDefaultUnitSelection.midId,
    );
    if (!big || !mid) return;

    autoUnitFilterAppliedRef.current = true;
    setBigFilter(recentDefaultUnitSelection.bigId);
    setMidFilter(recentDefaultUnitSelection.midId);
  }, [bigFilter, midFilter, recentDefaultUnitSelection, treeData]);

  const filteredLogs = useMemo(
    () =>
      classFilter
        ? analysisLogs.filter((log) => log.classOnly === classFilter)
        : analysisLogs,
    [analysisLogs, classFilter],
  );

  const allStudentProfiles = useMemo(() => {
    const map = new Map<string, UserProfile>();

    students.forEach((student) => {
      map.set(buildStudentKey({ uid: student.uid }), student);
    });

    canonicalLogs.forEach((log) => {
      const uidProfile = log.uid
        ? profileMap.get(buildStudentKey({ uid: log.uid }))
        : undefined;
      const emailProfile = log.email
        ? profileMap.get(buildStudentKey({ email: log.email }))
        : undefined;
      const profile = uidProfile || emailProfile;
      const key = buildStudentKey({
        uid: log.uid || profile?.uid,
        email: log.email || profile?.email,
        classOnly: log.classOnly,
        number: log.studentNumber,
        name: log.studentName,
      });

      if (!map.has(key)) {
        map.set(key, {
          uid: log.uid || profile?.uid || "",
          name: profile?.name || log.studentName,
          class: profile?.class || log.classOnly,
          number: profile?.number || log.studentNumber,
          email: profile?.email || log.email || "",
          role: "student",
        });
      }
    });

    return Array.from(map.values()).filter((student) => student.class);
  }, [canonicalLogs, profileMap, students]);

  const classOptions = useMemo(() => {
    const classes = new Set<string>();
    allStudentProfiles.forEach((student) => {
      if (student.class) classes.add(student.class);
    });
    canonicalLogs.forEach((log) => {
      if (log.classOnly && log.classOnly !== "-") classes.add(log.classOnly);
    });
    return Array.from(classes).sort(
      (a, b) => {
        if (recentClassFocus?.classOnly === a) return -1;
        if (recentClassFocus?.classOnly === b) return 1;
        return Number(a) - Number(b) || a.localeCompare(b);
      },
    );
  }, [allStudentProfiles, canonicalLogs, recentClassFocus]);

  const buildStudentSummaries = (sourceLogs: Log[], selectedClass: string) => {
    const targetProfiles = selectedClass
      ? allStudentProfiles.filter((student) => student.class === selectedClass)
      : [];
    const byStudent = new Map<string, StudentSummary>();

    targetProfiles.forEach((student) => {
      const key = buildStudentKey({
        uid: student.uid,
        email: student.email,
        classOnly: student.class,
        number: student.number,
        name: student.name,
      });
      byStudent.set(key, {
        key,
        uid: student.uid,
        name: student.name || "학생",
        email: student.email,
        classOnly: student.class,
        number: student.number,
        logs: [],
        latestScore: null,
        averageScore: null,
        attemptCount: 0,
        weakUnits: [],
        status: "pending",
      });
    });

    sourceLogs.forEach((log) => {
      if (selectedClass && log.classOnly !== selectedClass) return;
      const profile =
        (log.uid
          ? profileMap.get(buildStudentKey({ uid: log.uid }))
          : undefined) ||
        (log.email
          ? profileMap.get(buildStudentKey({ email: log.email }))
          : undefined);
      const key = buildStudentKey({
        uid: log.uid || profile?.uid,
        email: log.email || profile?.email,
        classOnly: log.classOnly,
        number: log.studentNumber,
        name: log.studentName,
      });
      const existing = byStudent.get(key);
      const summary =
        existing ||
        ({
          key,
          uid: log.uid || profile?.uid || "",
          name: profile?.name || log.studentName,
          email: profile?.email || log.email || "",
          classOnly: profile?.class || log.classOnly,
          number: profile?.number || log.studentNumber,
          logs: [],
          latestScore: null,
          averageScore: null,
          attemptCount: 0,
          weakUnits: [],
          status: "pending",
        } as StudentSummary);
      summary.logs.push(log);
      byStudent.set(key, summary);
    });

    return Array.from(byStudent.values()).map((summary) => {
      const sortedLogs = [...summary.logs].sort(
        (a, b) => getTimestampMs(b.timestamp) - getTimestampMs(a.timestamp),
      );
      const scores = sortedLogs.map((log) => log.score);
      const wrongUnits = new Map<string, { label: string; count: number }>();

      sortedLogs.forEach((log) => {
        log.details.forEach((detail) => {
          if (detail.correct) return;
          const question = questionMetaById.get(toText(detail.id));
          const meta = findUnitMeta([
            question?.refSmall,
            question?.subUnitId,
            question?.refMid,
            question?.unitId,
            log.unitId,
          ]);
          const id =
            meta?.smallId || meta?.midId || meta?.id || log.unitId || "unknown";
          const label =
            meta?.smallTitle ||
            meta?.midTitle ||
            meta?.title ||
            log.unitId ||
            "단원 미지정";
          const existing = wrongUnits.get(id) || { label, count: 0 };
          wrongUnits.set(id, { ...existing, count: existing.count + 1 });
        });
      });

      const latestScore = scores.length ? scores[0] : null;
      const averageScore = average(scores);
      const status: StudentSummary["status"] =
        latestScore === null
          ? "pending"
          : latestScore < 40 || (averageScore !== null && averageScore < 60)
            ? "risk"
            : latestScore < 70 || (averageScore !== null && averageScore < 75)
              ? "watch"
              : "stable";

      return {
        ...summary,
        logs: sortedLogs,
        latestLog: sortedLogs[0],
        latestScore,
        averageScore,
        attemptCount: sortedLogs.length,
        weakUnits: Array.from(wrongUnits.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 2)
          .map((unit) => unit.label),
        status,
      };
    });
  };

  const reportStudentSummaries = useMemo(
    () => buildStudentSummaries(filteredLogs, classFilter),
    [
      allStudentProfiles,
      classFilter,
      filteredLogs,
      profileMap,
      questionMetaById,
      unitMetaById,
    ],
  );

  const selectedStudentSummaries = useMemo(
    () => (classFilter ? reportStudentSummaries : []),
    [classFilter, reportStudentSummaries],
  );

  const attemptedSummaries = reportStudentSummaries.filter(
    (student) => student.attemptCount > 0,
  );
  const latestScores = attemptedSummaries
    .map((student) => student.latestScore)
    .filter((score): score is number => score !== null);
  const averageScore = average(latestScores);
  const medianScore = median(latestScores);
  const below50Students = attemptedSummaries
    .filter((student) => (student.latestScore ?? 100) < 50)
    .sort((a, b) => (a.latestScore ?? 101) - (b.latestScore ?? 101));
  const pendingCount = reportStudentSummaries.filter(
    (student) => student.attemptCount === 0,
  ).length;
  const pendingStudents = reportStudentSummaries
    .filter((student) => student.attemptCount === 0)
    .sort((a, b) => {
      const classCompare = a.classOnly.localeCompare(b.classOnly, "ko-KR", {
        numeric: true,
      });
      if (classCompare !== 0) return classCompare;
      const numberCompare = a.number.localeCompare(b.number, "ko-KR", {
        numeric: true,
      });
      if (numberCompare !== 0) return numberCompare;
      return a.name.localeCompare(b.name, "ko-KR");
    });

  const classSummaries = useMemo(() => {
    return classOptions.map((classOnly) => {
      const summaries = buildStudentSummaries(
        analysisLogs.filter((log) => log.classOnly === classOnly),
        classOnly,
      );
      const scores = summaries
        .map((summary) => summary.latestScore)
        .filter((score): score is number => score !== null);
      return {
        classOnly,
        average: average(scores),
        attempted: summaries.filter((summary) => summary.attemptCount > 0)
          .length,
        total: summaries.length,
      };
    });
  }, [
    analysisLogs,
    classOptions,
    allStudentProfiles,
    profileMap,
    questionMetaById,
    unitMetaById,
  ]);

  const scoreDistribution = SCORE_BUCKETS.map((bucket) => ({
    ...bucket,
    count: latestScores.filter(
      (score) => score >= bucket.min && score <= bucket.max,
    ).length,
  }));
  const maxBucketCount = Math.max(
    1,
    ...scoreDistribution.map((bucket) => bucket.count),
  );
  const scoreBucketStudents = selectedScoreBucket
    ? attemptedSummaries
        .filter(
          (student) =>
            student.latestScore !== null &&
            student.latestScore >= selectedScoreBucket.min &&
            student.latestScore <= selectedScoreBucket.max,
        )
        .sort((a, b) => (a.latestScore ?? 101) - (b.latestScore ?? 101))
    : [];

  const weakUnits = useMemo(() => {
    const unitStats = new Map<
      string,
      { label: string; attempts: number; correct: number }
    >();

    filteredLogs.forEach((log) => {
      log.details.forEach((detail) => {
        const question = questionMetaById.get(toText(detail.id));
        const meta = findUnitMeta([
          question?.refSmall,
          question?.subUnitId,
          question?.refMid,
          question?.unitId,
          log.unitId,
        ]);
        const id =
          meta?.smallId || meta?.midId || meta?.id || log.unitId || "unknown";
        const label =
          meta?.smallTitle ||
          meta?.midTitle ||
          meta?.title ||
          log.unitId ||
          "단원 미지정";
        const existing = unitStats.get(id) || {
          label,
          attempts: 0,
          correct: 0,
        };
        existing.attempts += 1;
        if (detail.correct) existing.correct += 1;
        unitStats.set(id, existing);
      });
    });

    return Array.from(unitStats.values())
      .filter((unit) => unit.attempts > 0)
      .map((unit) => ({
        ...unit,
        rate: Math.round((unit.correct / unit.attempts) * 100),
      }))
      .sort((a, b) => a.rate - b.rate || b.attempts - a.attempts)
      .slice(0, 5);
  }, [filteredLogs, questionMetaById, unitMetaById]);

  const displayedStudents = useMemo(() => {
    const keyword = studentSearch.trim().toLowerCase();
    let list = selectedStudentSummaries;

    if (showPendingOnly)
      list = list.filter((student) => student.attemptCount === 0);
    if (keyword) {
      list = list.filter((student) =>
        [student.name, student.number, student.email, student.classOnly].some(
          (value) =>
            String(value || "")
              .toLowerCase()
              .includes(keyword),
        ),
      );
    }

    return [...list].sort((a, b) => {
      if (sortKey === "scoreAsc")
        return (a.latestScore ?? 101) - (b.latestScore ?? 101);
      if (sortKey === "scoreDesc")
        return (b.latestScore ?? -1) - (a.latestScore ?? -1);
      if (sortKey === "averageAsc")
        return (a.averageScore ?? 101) - (b.averageScore ?? 101);
      if (sortKey === "attemptDesc") return b.attemptCount - a.attemptCount;
      return a.name.localeCompare(b.name, "ko-KR");
    });
  }, [selectedStudentSummaries, showPendingOnly, sortKey, studentSearch]);

  const studentTotalPages = Math.max(
    1,
    Math.ceil(displayedStudents.length / STUDENTS_PER_PAGE),
  );
  const pagedDisplayedStudents = displayedStudents.slice(
    (studentPage - 1) * STUDENTS_PER_PAGE,
    studentPage * STUDENTS_PER_PAGE,
  );
  const lowScoreTotalPages = Math.max(
    1,
    Math.ceil(below50Students.length / STUDENTS_PER_PAGE),
  );
  const pagedBelow50Students = below50Students.slice(
    (lowScorePage - 1) * STUDENTS_PER_PAGE,
    lowScorePage * STUDENTS_PER_PAGE,
  );
  const scoreBucketTotalPages = Math.max(
    1,
    Math.ceil(scoreBucketStudents.length / STUDENTS_PER_PAGE),
  );
  const pagedScoreBucketStudents = scoreBucketStudents.slice(
    (scoreBucketPage - 1) * STUDENTS_PER_PAGE,
    scoreBucketPage * STUDENTS_PER_PAGE,
  );
  const pendingTotalPages = Math.max(
    1,
    Math.ceil(pendingStudents.length / STUDENTS_PER_PAGE),
  );
  const pagedPendingStudents = pendingStudents.slice(
    (pendingPage - 1) * STUDENTS_PER_PAGE,
    pendingPage * STUDENTS_PER_PAGE,
  );

  useEffect(() => {
    setStudentPage(1);
  }, [
    bigFilter,
    categoryFilter,
    classFilter,
    midFilter,
    showPendingOnly,
    sortKey,
    studentSearch,
  ]);

  useEffect(() => {
    setLowScorePage(1);
  }, [bigFilter, categoryFilter, classFilter, lowScoreModalOpen, midFilter]);

  useEffect(() => {
    setScoreBucketPage(1);
  }, [
    bigFilter,
    categoryFilter,
    classFilter,
    midFilter,
    scoreBucketModalOpen,
    selectedScoreBucket,
  ]);

  useEffect(() => {
    setPendingPage(1);
  }, [bigFilter, categoryFilter, classFilter, midFilter, pendingModalOpen]);

  useEffect(() => {
    if (studentPage > studentTotalPages) {
      setStudentPage(studentTotalPages);
    }
  }, [studentPage, studentTotalPages]);

  useEffect(() => {
    if (lowScorePage > lowScoreTotalPages) {
      setLowScorePage(lowScoreTotalPages);
    }
  }, [lowScorePage, lowScoreTotalPages]);

  useEffect(() => {
    if (scoreBucketPage > scoreBucketTotalPages) {
      setScoreBucketPage(scoreBucketTotalPages);
    }
  }, [scoreBucketPage, scoreBucketTotalPages]);

  useEffect(() => {
    if (pendingPage > pendingTotalPages) {
      setPendingPage(pendingTotalPages);
    }
  }, [pendingPage, pendingTotalPages]);

  useEffect(() => {
    if (!scoreBucketModalOpen) return;
    scoreBucketCloseButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setScoreBucketModalOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [scoreBucketModalOpen]);

  useEffect(() => {
    if (!pendingModalOpen) return;
    pendingCloseButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPendingModalOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pendingModalOpen]);

  useEffect(() => {
    if (bigFilter && !bigOptions.some((big) => big.id === bigFilter)) {
      setBigFilter("");
      setMidFilter("");
      return;
    }
    if (midFilter && !midOptions.some((mid) => mid.id === midFilter)) {
      setMidFilter("");
    }
  }, [bigFilter, bigOptions, midFilter, midOptions]);

  return (
    <div className="h-full overflow-y-auto bg-white rounded-xl shadow-sm border border-gray-200 p-4 lg:p-6">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h2 className="text-2xl font-extrabold text-gray-900">응시 현황</h2>
          <p className="mt-1 text-sm text-gray-500">
            반별 점수 흐름과 취약 단원을 현재 필터 기준으로 분석합니다.
          </p>
        </div>

        <div className="w-full space-y-2 xl:max-w-[620px]">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:justify-end xl:grid-cols-[minmax(0,250px)_minmax(0,250px)]">
            <select
              value={bigFilter}
              onChange={(event) => {
                userTouchedUnitFilterRef.current = true;
                setBigFilter(event.target.value);
                setMidFilter("");
              }}
              className="min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700"
              aria-label="대단원 필터"
            >
              <option value="">대단원 전체</option>
              {bigOptions.map((big) => (
                <option key={big.id} value={big.id}>
                  {big.title}
                </option>
              ))}
            </select>
            <select
              value={midFilter}
              onChange={(event) => {
                userTouchedUnitFilterRef.current = true;
                setMidFilter(event.target.value);
              }}
              className="min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700"
              aria-label="중단원 필터"
            >
              <option value="">중단원 전체</option>
              {midOptions.map((mid) => (
                <option key={mid.id} value={mid.id}>
                  {mid.title}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[150px_190px_auto] sm:justify-end">
            <select
              value={classFilter}
              onChange={(event) => {
                userTouchedClassFilterRef.current = true;
                setClassFilter(event.target.value);
              }}
              className="min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700"
              aria-label="반 필터"
            >
              <option value="">반 전체</option>
              {classOptions.map((classOnly) => (
                <option key={classOnly} value={classOnly}>
                  {classOnly}반
                </option>
              ))}
            </select>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700"
              aria-label="평가유형 필터"
            >
              <option value="">평가유형 전체</option>
              <option value="diagnostic">진단</option>
              <option value="formative">형성</option>
              <option value="exam_prep">시험 대비</option>
            </select>
            <button
              type="button"
              onClick={reload}
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
            >
              <i className="fas fa-sync-alt text-xs" aria-hidden="true"></i>
              새로고침
            </button>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
          {loadError}
        </div>
      )}
      {rosterLimited && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
          학생 명단 권한이 없어 미응시 수와 현재 반 정보는 제출 기록 기준으로
          제한됩니다.
        </div>
      )}

      <section className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-4 flex items-center gap-2">
          <h3 className="text-sm font-extrabold text-gray-800">
            오늘의 학급 수준
          </h3>
          {(loading || supportLoading || analyticsBackfillLoading) && (
            <span className="text-xs font-bold text-blue-600">
              동기화 중...
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {[
            {
              label: "응시",
              value: `${attemptedSummaries.length}명`,
              icon: "fa-users",
              tone: "text-blue-500",
            },
            {
              label: "평균",
              value: `${roundOne(averageScore)}점`,
              icon: "fa-chart-simple",
              tone: "text-emerald-500",
            },
            {
              label: "중앙값",
              value: `${roundOne(medianScore)}점`,
              icon: "fa-chart-line",
              tone: "text-violet-500",
            },
            {
              label: "50점 미만",
              value: `${below50Students.length}명`,
              icon: "fa-circle-exclamation",
              tone: "text-red-500",
              onClick: () => setLowScoreModalOpen(true),
            },
            {
              label: "미응시",
              value: rosterLimited || !classFilter ? "-" : `${pendingCount}명`,
              icon: "fa-user-clock",
              tone: "text-gray-400",
              onClick:
                rosterLimited || !classFilter
                  ? undefined
                  : () => setPendingModalOpen(true),
            },
            {
              label: "마지막 동기화",
              value: formatTime(lastSyncedAt),
              icon: "fa-clock",
              tone: "text-blue-500",
            },
          ].map((item) => {
            const handleClick = "onClick" in item ? item.onClick : undefined;

            return (
              <button
                key={item.label}
                type="button"
                onClick={handleClick}
                disabled={!handleClick}
                className={`rounded-lg border border-gray-200 bg-white px-4 py-4 text-left transition ${
                  handleClick
                    ? "hover:-translate-y-0.5 hover:border-red-200 hover:bg-red-50/40 hover:shadow-sm"
                    : "cursor-default"
                }`}
              >
                <div className="flex items-center gap-3">
                  <i
                    className={`fas ${item.icon} text-3xl ${item.tone}`}
                    aria-hidden="true"
                  ></i>
                  <div>
                    <div className="text-xs font-bold text-gray-500">
                      {item.label}
                    </div>
                    <div className="mt-1 text-2xl font-extrabold text-gray-900">
                      {item.value}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-extrabold text-gray-800">
            <i className="fas fa-users text-blue-500" aria-hidden="true"></i>
            반별 비교
          </div>
          <div className="space-y-3">
            {classSummaries.length === 0 && (
              <div className="py-8 text-center text-sm text-gray-400">
                반 데이터가 없습니다.
              </div>
            )}
            {classSummaries.map((item) => {
              const value = item.average ?? 0;
              const selected = classFilter === item.classOnly;
              return (
                <button
                  key={item.classOnly}
                  type="button"
                  onClick={() => {
                    userTouchedClassFilterRef.current = true;
                    setClassFilter(selected ? "" : item.classOnly);
                  }}
                  className={`grid w-full grid-cols-[48px_minmax(0,250px)] items-center gap-2 rounded-lg px-2.5 py-2 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-200 ${
                    selected
                      ? "bg-blue-50 ring-1 ring-blue-200"
                      : "hover:bg-gray-50"
                  }`}
                >
                  <span className="text-sm font-bold text-gray-700">
                    {item.classOnly}반
                  </span>
                  <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_36px] items-center gap-2">
                    <span className="h-2.5 overflow-hidden rounded-full bg-gray-100">
                      <span
                        className="block h-full rounded-full bg-gradient-to-r from-blue-400 to-blue-600"
                        style={{ width: `${Math.min(100, value)}%` }}
                      ></span>
                    </span>
                    <span
                      className={`text-center text-xs font-extrabold ${
                        item.average === null
                          ? "text-gray-400"
                          : "text-gray-800"
                      }`}
                    >
                      {item.average === null ? "-" : Math.round(item.average)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 text-xs font-bold text-gray-500">
            선택 반: {classFilter ? `${classFilter}반` : "전체"}
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-extrabold text-gray-800">
            <i
              className="fas fa-chart-column text-blue-500"
              aria-hidden="true"
            ></i>
            점수 분포
          </div>
          <div className="space-y-4">
            {scoreDistribution.map((bucket) => (
              <button
                key={bucket.label}
                type="button"
                onClick={() => {
                  setSelectedScoreBucket(bucket);
                  setScoreBucketModalOpen(true);
                }}
                disabled={bucket.count === 0}
                className={`grid w-full grid-cols-[56px_1fr_52px] items-center gap-3 rounded-md px-2 py-1.5 text-left transition ${
                  bucket.count === 0
                    ? "cursor-default"
                    : "hover:-translate-y-0.5 hover:bg-blue-50 hover:shadow-sm"
                }`}
                aria-label={`${bucket.label}점 구간 학생 ${bucket.count}명 보기`}
              >
                <span className="text-sm font-bold text-gray-600">
                  {bucket.label}
                </span>
                <span className="h-3 overflow-hidden rounded-full bg-gray-100">
                  <span
                    className="block h-full rounded-full bg-blue-500"
                    style={{
                      width: `${Math.max(4, (bucket.count / maxBucketCount) * 100)}%`,
                    }}
                  ></span>
                </span>
                <span className="text-right text-sm font-bold text-gray-700">
                  {bucket.count}명
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-extrabold text-gray-800">
            <i className="fas fa-star text-blue-500" aria-hidden="true"></i>
            부족 단원 TOP 5{" "}
            <span className="text-xs font-bold text-gray-400">(정답률)</span>
          </div>
          <div className="space-y-3">
            {weakUnits.length === 0 && (
              <div className="py-8 text-center text-sm text-gray-400">
                분석할 오답 데이터가 없습니다.
              </div>
            )}
            {weakUnits.map((unit, index) => (
              <div
                key={`${unit.label}-${index}`}
                className="grid grid-cols-[28px_1fr_56px] items-center gap-3"
              >
                <span className="text-sm font-extrabold text-gray-600">
                  {index + 1}
                </span>
                <span
                  className="truncate text-sm font-bold text-gray-700"
                  title={unit.label}
                >
                  {unit.label}
                </span>
                <span className="text-right text-sm font-extrabold text-gray-800">
                  {unit.rate}%
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h3 className="text-lg font-extrabold text-gray-900">
            선택 학급 상세 · {classFilter ? `${classFilter}반` : "반 선택 필요"}
          </h3>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as SortKey)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700"
              aria-label="학생 정렬"
            >
              <option value="scoreAsc">점수 낮은순</option>
              <option value="scoreDesc">점수 높은순</option>
              <option value="averageAsc">평균 낮은순</option>
              <option value="attemptDesc">응시 많은순</option>
              <option value="nameAsc">이름순</option>
            </select>
            <button
              type="button"
              onClick={() => setShowPendingOnly((prev) => !prev)}
              className={`rounded-lg border px-3 py-2 text-sm font-bold transition ${
                showPendingOnly
                  ? "border-blue-300 bg-blue-50 text-blue-700"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              미응시만
            </button>
            <div className="relative">
              <input
                value={studentSearch}
                onChange={(event) => setStudentSearch(event.target.value)}
                placeholder="학생 검색"
                className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-9 text-sm font-medium outline-none transition focus:border-blue-400 sm:w-64"
              />
              <i
                className="fas fa-search absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400"
                aria-hidden="true"
              ></i>
            </div>
          </div>
        </div>

        <div className="space-y-3 md:hidden">
          {displayedStudents.length === 0 && (
            <div className="rounded-lg border border-gray-100 px-4 py-10 text-center text-sm text-gray-400">
              {classFilter
                ? "조건에 맞는 학생 데이터가 없습니다."
                : "상세 명단은 반을 선택하면 표시됩니다."}
            </div>
          )}
          {pagedDisplayedStudents.map((student) => {
            const status = getStatusMeta(student.status);
            return (
              <div
                key={`mobile-${student.key}`}
                className="rounded-lg border border-gray-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-gray-400">
                      {student.classOnly ? `${student.classOnly}반` : "-"} ·{" "}
                      {student.number && student.number !== "-"
                        ? `${student.number}번`
                        : "-"}
                    </div>
                    <div className="mt-1 truncate text-base font-extrabold text-gray-900">
                      {student.name}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-md border px-2 py-1 text-xs font-extrabold ${status.className}`}
                  >
                    {status.label}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-xs font-bold text-gray-400">최근</div>
                    <div className="font-extrabold text-gray-800">
                      {student.latestScore === null ? "-" : student.latestScore}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-gray-400">평균</div>
                    <div className="font-extrabold text-gray-800">
                      {roundOne(student.averageScore)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-gray-400">응시</div>
                    <div className="font-extrabold text-gray-800">
                      {student.attemptCount ? `${student.attemptCount}회` : "-"}
                    </div>
                  </div>
                </div>
                <div className="mt-3 text-sm font-medium text-gray-700">
                  취약 단원:{" "}
                  {student.weakUnits.length
                    ? student.weakUnits.join(", ")
                    : "-"}
                </div>
                <div className="mt-3">
                  {student.uid ? (
                    <button
                      type="button"
                      onClick={() =>
                        setWrongNoteTarget({
                          uid: student.uid,
                          name: student.name,
                        })
                      }
                      className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-extrabold text-gray-700 transition hover:border-blue-300 hover:text-blue-600"
                    >
                      오답노트 열기
                      <i
                        className="fas fa-arrow-up-right-from-square text-[10px]"
                        aria-hidden="true"
                      ></i>
                    </button>
                  ) : (
                    <span className="text-xs font-bold text-gray-400">
                      오답노트 연결 없음
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="border-y border-gray-100 bg-gray-50 text-xs font-extrabold text-gray-500">
              <tr>
                <th className="px-4 py-3">번호</th>
                <th className="px-4 py-3">학생</th>
                <th className="px-4 py-3">최근점수</th>
                <th className="px-4 py-3">평균</th>
                <th className="px-4 py-3">응시</th>
                <th className="px-4 py-3">취약 단원</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">오답노트</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayedStudents.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-gray-400"
                  >
                    {classFilter
                      ? "조건에 맞는 학생 데이터가 없습니다."
                      : "상세 명단은 반을 선택하면 표시됩니다."}
                  </td>
                </tr>
              )}
              {pagedDisplayedStudents.map((student) => {
                const status = getStatusMeta(student.status);
                return (
                  <tr key={student.key} className="transition hover:bg-gray-50">
                    <td className="px-4 py-3 font-bold text-gray-600">
                      {student.number && student.number !== "-"
                        ? student.number.padStart(2, "0")
                        : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-extrabold text-gray-800">
                        {student.name}
                      </div>
                      <div className="text-xs text-gray-400">
                        {student.classOnly ? `${student.classOnly}반` : "-"}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-bold text-gray-800">
                      {student.latestScore === null ? "-" : student.latestScore}
                    </td>
                    <td className="px-4 py-3 font-bold text-gray-700">
                      {roundOne(student.averageScore)}
                    </td>
                    <td className="px-4 py-3 font-bold text-gray-700">
                      {student.attemptCount ? `${student.attemptCount}회` : "-"}
                    </td>
                    <td className="max-w-[260px] px-4 py-3 font-medium text-gray-700">
                      {student.weakUnits.length
                        ? student.weakUnits.join(", ")
                        : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-md border px-2 py-1 text-xs font-extrabold ${status.className}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {student.uid ? (
                        <button
                          type="button"
                          onClick={() =>
                            setWrongNoteTarget({
                              uid: student.uid,
                              name: student.name,
                            })
                          }
                          className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-extrabold text-gray-700 transition hover:border-blue-300 hover:text-blue-600"
                        >
                          열기
                          <i
                            className="fas fa-arrow-up-right-from-square text-[10px]"
                            aria-hidden="true"
                          ></i>
                        </button>
                      ) : (
                        <span className="text-xs font-bold text-gray-400">
                          연결 없음
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {studentTotalPages > 1 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 text-sm font-bold text-gray-600">
            <span>
              {displayedStudents.length}명 중{" "}
              {(studentPage - 1) * STUDENTS_PER_PAGE + 1}-
              {Math.min(
                studentPage * STUDENTS_PER_PAGE,
                displayedStudents.length,
              )}
              명 표시
            </span>
            <div className="flex flex-wrap gap-1">
              {Array.from({ length: studentTotalPages }, (_, index) => {
                const page = index + 1;
                return (
                  <button
                    key={`student-page-${page}`}
                    type="button"
                    onClick={() => setStudentPage(page)}
                    className={`min-w-9 rounded-md border px-3 py-1.5 transition ${
                      studentPage === page
                        ? "border-blue-500 bg-blue-600 text-white"
                        : "border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600"
                    }`}
                    aria-current={studentPage === page ? "page" : undefined}
                  >
                    {page}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {lowScoreModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="below-50-students-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            onClick={() => setLowScoreModalOpen(false)}
            aria-label="50점 미만 학생 명단 닫기"
          />
          <div
            ref={lowScoreModalRef}
            className="relative z-10 flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
              <div>
                <h3
                  id="below-50-students-title"
                  className="text-lg font-extrabold text-gray-900"
                >
                  50점 미만 학생 명단
                </h3>
                <p className="mt-1 text-sm font-medium text-gray-500">
                  {classFilter ? `${classFilter}반` : "전체 반"} ·{" "}
                  {below50Students.length}명 · 상단 필터 기준
                </p>
              </div>
              <button
                ref={lowScoreCloseButtonRef}
                type="button"
                onClick={() => setLowScoreModalOpen(false)}
                className="rounded-md px-2 py-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                aria-label="닫기"
              >
                <i className="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              {below50Students.length === 0 ? (
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-10 text-center text-sm font-bold text-gray-400">
                  현재 조건에서 50점 미만 학생이 없습니다.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left text-sm">
                    <thead className="border-y border-gray-100 bg-gray-50 text-xs font-extrabold text-gray-500">
                      <tr>
                        <th className="px-4 py-3">반/번호</th>
                        <th className="px-4 py-3">학생</th>
                        <th className="px-4 py-3">최근점수</th>
                        <th className="px-4 py-3">평균</th>
                        <th className="px-4 py-3">취약 단원</th>
                        <th className="px-4 py-3">오답노트</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pagedBelow50Students.map((student) => (
                        <tr key={`below-50-${student.key}`}>
                          <td className="px-4 py-3 font-bold text-gray-600">
                            {student.classOnly ? `${student.classOnly}반` : "-"}{" "}
                            {student.number && student.number !== "-"
                              ? `${student.number}번`
                              : ""}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-extrabold text-gray-800">
                              {student.name}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-extrabold text-red-600">
                            {student.latestScore === null
                              ? "-"
                              : `${student.latestScore}점`}
                          </td>
                          <td className="px-4 py-3 font-bold text-gray-700">
                            {roundOne(student.averageScore)}
                          </td>
                          <td className="max-w-[220px] px-4 py-3 font-medium text-gray-700">
                            {student.weakUnits.length
                              ? student.weakUnits.join(", ")
                              : "-"}
                          </td>
                          <td className="px-4 py-3">
                            {student.uid ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setLowScoreModalOpen(false);
                                  setReturnToLowScoreModal(true);
                                  setWrongNoteTarget({
                                    uid: student.uid,
                                    name: student.name,
                                  });
                                }}
                                className="inline-flex min-w-[64px] items-center justify-center gap-2 whitespace-nowrap rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-extrabold text-gray-700 transition hover:border-blue-300 hover:text-blue-600"
                              >
                                열기
                                <i
                                  className="fas fa-arrow-up-right-from-square text-[10px]"
                                  aria-hidden="true"
                                ></i>
                              </button>
                            ) : (
                              <span className="text-xs font-bold text-gray-400">
                                연결 없음
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {lowScoreTotalPages > 1 && (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 text-sm font-bold text-gray-600">
                      <span>
                        {below50Students.length}명 중{" "}
                        {(lowScorePage - 1) * STUDENTS_PER_PAGE + 1}-
                        {Math.min(
                          lowScorePage * STUDENTS_PER_PAGE,
                          below50Students.length,
                        )}
                        명 표시
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {Array.from(
                          { length: lowScoreTotalPages },
                          (_, index) => {
                            const page = index + 1;
                            return (
                              <button
                                key={`below-50-page-${page}`}
                                type="button"
                                onClick={() => setLowScorePage(page)}
                                className={`min-w-9 rounded-md border px-3 py-1.5 transition ${
                                  lowScorePage === page
                                    ? "border-blue-500 bg-blue-600 text-white"
                                    : "border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600"
                                }`}
                                aria-current={
                                  lowScorePage === page ? "page" : undefined
                                }
                              >
                                {page}
                              </button>
                            );
                          },
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {scoreBucketModalOpen && selectedScoreBucket && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="score-bucket-students-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            onClick={() => setScoreBucketModalOpen(false)}
            aria-label="점수 구간 학생 명단 닫기"
          />
          <div className="relative z-10 flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
              <div>
                <h3
                  id="score-bucket-students-title"
                  className="text-lg font-extrabold text-gray-900"
                >
                  {selectedScoreBucket.label}점 구간 학생 명단
                </h3>
                <p className="mt-1 text-sm font-medium text-gray-500">
                  {classFilter ? `${classFilter}반` : "전체 반"} ·{" "}
                  {scoreBucketStudents.length}명 · 상단 필터 기준
                </p>
              </div>
              <button
                ref={scoreBucketCloseButtonRef}
                type="button"
                onClick={() => setScoreBucketModalOpen(false)}
                className="rounded-md px-2 py-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                aria-label="닫기"
              >
                <i className="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              {scoreBucketStudents.length === 0 ? (
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-10 text-center text-sm font-bold text-gray-400">
                  현재 조건에서 해당 점수 구간 학생이 없습니다.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left text-sm">
                    <thead className="border-y border-gray-100 bg-gray-50 text-xs font-extrabold text-gray-500">
                      <tr>
                        <th className="px-4 py-3">반/번호</th>
                        <th className="px-4 py-3">학생</th>
                        <th className="px-4 py-3">최근점수</th>
                        <th className="px-4 py-3">평균</th>
                        <th className="px-4 py-3">취약 단원</th>
                        <th className="px-4 py-3">오답노트</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pagedScoreBucketStudents.map((student) => (
                        <tr key={`score-bucket-${student.key}`}>
                          <td className="px-4 py-3 font-bold text-gray-600">
                            {student.classOnly ? `${student.classOnly}반` : "-"}{" "}
                            {student.number && student.number !== "-"
                              ? `${student.number}번`
                              : ""}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-extrabold text-gray-800">
                              {student.name}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-extrabold text-gray-800">
                            {student.latestScore === null
                              ? "-"
                              : `${student.latestScore}점`}
                          </td>
                          <td className="px-4 py-3 font-bold text-gray-700">
                            {roundOne(student.averageScore)}
                          </td>
                          <td className="max-w-[220px] px-4 py-3 font-medium text-gray-700">
                            {student.weakUnits.length
                              ? student.weakUnits.join(", ")
                              : "-"}
                          </td>
                          <td className="px-4 py-3">
                            {student.uid ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setScoreBucketModalOpen(false);
                                  setReturnToScoreBucketModal(true);
                                  setWrongNoteTarget({
                                    uid: student.uid,
                                    name: student.name,
                                  });
                                }}
                                className="inline-flex min-w-[64px] items-center justify-center gap-2 whitespace-nowrap rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-extrabold text-gray-700 transition hover:border-blue-300 hover:text-blue-600"
                              >
                                열기
                                <i
                                  className="fas fa-arrow-up-right-from-square text-[10px]"
                                  aria-hidden="true"
                                ></i>
                              </button>
                            ) : (
                              <span className="text-xs font-bold text-gray-400">
                                연결 없음
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {scoreBucketTotalPages > 1 && (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 text-sm font-bold text-gray-600">
                      <span>
                        {scoreBucketStudents.length}명 중{" "}
                        {(scoreBucketPage - 1) * STUDENTS_PER_PAGE + 1}-
                        {Math.min(
                          scoreBucketPage * STUDENTS_PER_PAGE,
                          scoreBucketStudents.length,
                        )}
                        명 표시
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {Array.from(
                          { length: scoreBucketTotalPages },
                          (_, index) => {
                            const page = index + 1;
                            return (
                              <button
                                key={`score-bucket-page-${page}`}
                                type="button"
                                onClick={() => setScoreBucketPage(page)}
                                className={`min-w-9 rounded-md border px-3 py-1.5 transition ${
                                  scoreBucketPage === page
                                    ? "border-blue-500 bg-blue-600 text-white"
                                    : "border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600"
                                }`}
                                aria-current={
                                  scoreBucketPage === page ? "page" : undefined
                                }
                              >
                                {page}
                              </button>
                            );
                          },
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {pendingModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pending-students-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            onClick={() => setPendingModalOpen(false)}
            aria-label="미응시 학생 명단 닫기"
          />
          <div className="relative z-10 flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
              <div>
                <h3
                  id="pending-students-title"
                  className="text-lg font-extrabold text-gray-900"
                >
                  미응시 학생 명단
                </h3>
                <p className="mt-1 text-sm font-medium text-gray-500">
                  {classFilter ? `${classFilter}반` : "전체 반"} ·{" "}
                  {pendingStudents.length}명 · 상단 필터 기준
                </p>
              </div>
              <button
                ref={pendingCloseButtonRef}
                type="button"
                onClick={() => setPendingModalOpen(false)}
                className="rounded-md px-2 py-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                aria-label="닫기"
              >
                <i className="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              {pendingStudents.length === 0 ? (
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-10 text-center text-sm font-bold text-gray-400">
                  현재 조건에서 미응시 학생이 없습니다.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="border-y border-gray-100 bg-gray-50 text-xs font-extrabold text-gray-500">
                      <tr>
                        <th className="px-4 py-3">반/번호</th>
                        <th className="px-4 py-3">학생</th>
                        <th className="px-4 py-3">상태</th>
                        <th className="px-4 py-3">오답노트</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pagedPendingStudents.map((student) => {
                        const statusMeta = getStatusMeta(student.status);

                        return (
                          <tr key={`pending-${student.key}`}>
                            <td className="px-4 py-3 font-bold text-gray-600">
                              {student.classOnly
                                ? `${student.classOnly}반`
                                : "-"}{" "}
                              {student.number && student.number !== "-"
                                ? `${student.number}번`
                                : ""}
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-extrabold text-gray-800">
                                {student.name}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex rounded-md border px-2 py-1 text-xs font-extrabold ${statusMeta.className}`}
                              >
                                {statusMeta.label}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {student.uid ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPendingModalOpen(false);
                                    setReturnToPendingModal(true);
                                    setWrongNoteTarget({
                                      uid: student.uid,
                                      name: student.name,
                                    });
                                  }}
                                  className="inline-flex min-w-[64px] items-center justify-center gap-2 whitespace-nowrap rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-extrabold text-gray-700 transition hover:border-blue-300 hover:text-blue-600"
                                >
                                  열기
                                  <i
                                    className="fas fa-arrow-up-right-from-square text-[10px]"
                                    aria-hidden="true"
                                  ></i>
                                </button>
                              ) : (
                                <span className="text-xs font-bold text-gray-400">
                                  연결 없음
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {pendingTotalPages > 1 && (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 text-sm font-bold text-gray-600">
                      <span>
                        {pendingStudents.length}명 중{" "}
                        {(pendingPage - 1) * STUDENTS_PER_PAGE + 1}-
                        {Math.min(
                          pendingPage * STUDENTS_PER_PAGE,
                          pendingStudents.length,
                        )}
                        명 표시
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {Array.from(
                          { length: pendingTotalPages },
                          (_, index) => {
                            const page = index + 1;
                            return (
                              <button
                                key={`pending-page-${page}`}
                                type="button"
                                onClick={() => setPendingPage(page)}
                                className={`min-w-9 rounded-md border px-3 py-1.5 transition ${
                                  pendingPage === page
                                    ? "border-blue-500 bg-blue-600 text-white"
                                    : "border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600"
                                }`}
                                aria-current={
                                  pendingPage === page ? "page" : undefined
                                }
                              >
                                {page}
                              </button>
                            );
                          },
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <StudentWrongNoteModal
        isOpen={!!wrongNoteTarget}
        onClose={() => {
          setWrongNoteTarget(null);
          if (returnToLowScoreModal) {
            setReturnToLowScoreModal(false);
            setLowScoreModalOpen(true);
          } else if (returnToScoreBucketModal && selectedScoreBucket) {
            setReturnToScoreBucketModal(false);
            setScoreBucketModalOpen(true);
          } else if (returnToPendingModal) {
            setReturnToPendingModal(false);
            setPendingModalOpen(true);
          }
        }}
        studentId={wrongNoteTarget?.uid || ""}
        studentName={wrongNoteTarget?.name || ""}
        readScope="current"
        launchContextLabel="응시 현황"
      />
    </div>
  );
};

export default QuizLogTab;
