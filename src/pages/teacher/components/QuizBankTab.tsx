import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../contexts/AuthContext";
import {
  getSemesterCollectionPath,
  getSemesterDocPath,
} from "../../../lib/semesterScope";

interface TreeUnit {
  id: string;
  title: string;
  children?: TreeUnit[];
}

interface Question {
  docId: string;
  id: number;
  category: string;
  unitId: string;
  subUnitId?: string | null;
  type: string;
  question: string;
  answer: string | number;
  image?: string | null;
  refBig?: string;
  refMid?: string;
  refSmall?: string;
  options?: string[];
  explanation?: string;
  hintEnabled?: boolean;
  hint?: string;
}

interface QuestionStat {
  attempts: number;
  correct: number;
  wrongAnswers: Record<string, number>;
  uniqueStudents: number;
  uniqueWrongStudents: number;
}

interface QuestionAggregate extends QuestionStat {
  classStats: Record<string, QuestionStat>;
  affectedClasses: string[];
  lastAttemptAt: number;
}

interface MutableQuestionStat {
  attempts: number;
  correct: number;
  wrongAnswers: Record<string, number>;
  studentKeys: Set<string>;
  wrongStudentKeys: Set<string>;
}

interface MutableQuestionAggregate extends MutableQuestionStat {
  classStats: Record<string, MutableQuestionStat>;
  affectedClasses: Set<string>;
  lastAttemptAt: number;
}

interface BankAnalyticsResult {
  questionStats: Record<string, QuestionAggregate>;
  participationByClass: Record<string, number>;
  totalParticipants: number;
  lastAttemptAt: number;
}

interface StudentRosterItem {
  uid: string;
  email: string;
  name: string;
  classOnly: string;
  number: string;
}

interface StudentRosterResult {
  students: StudentRosterItem[];
  accessLimited: boolean;
}

type QuestionType = "choice" | "ox" | "word" | "order";
type SortKey = "none" | "code" | "rate" | "category" | "type";
type SortDirection = "asc" | "desc";
type AnalyticsScope = "all" | "class";
type StatusFilter = "" | "weak" | "no_attempt" | "data_short" | "stable";

interface BankFilterState {
  big: string;
  mid: string;
  small: string;
}

interface BankDefaultFocus {
  filters: BankFilterState;
  category: string;
}
const ORDER_DELIMITER = "||";
const DEFAULT_OPTION_COUNT = 4;
const QUESTION_PAGE_SIZE = 50;
const createDefaultOptionItems = () =>
  Array.from({ length: DEFAULT_OPTION_COUNT }, () => "");

const QUESTION_TYPE_LABEL: Record<string, string> = {
  choice: "객관식",
  ox: "O/X",
  word: "단답형",
  short: "단답형",
  order: "순서 나열형",
};

const normalizeQuestionType = (type: string): QuestionType =>
  type === "short" ? "word" : (type as QuestionType) || "choice";
const toText = (value: unknown): string => String(value ?? "").trim();
const normalizeClass = (value: unknown): string => {
  const raw = toText(value);
  if (!raw) return "";
  const digits = raw.match(/\d+/)?.[0];
  return digits || raw.replace("반", "").trim();
};
const normalizeNumber = (value: unknown): string => {
  const raw = toText(value);
  if (!raw) return "";
  const digits = raw.match(/\d+/)?.[0];
  return digits || raw.replace("번", "").trim();
};
const getTimestampMs = (value: any): number => {
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    if (date instanceof Date && !Number.isNaN(date.getTime()))
      return date.getTime();
  }
  return 0;
};
const formatPercent = (value: number | null) =>
  value === null ? "-" : `${Math.round(value)}%`;
const createEmptyStat = (): QuestionStat => ({
  attempts: 0,
  correct: 0,
  wrongAnswers: {},
  uniqueStudents: 0,
  uniqueWrongStudents: 0,
});
const createEmptyAggregate = (): QuestionAggregate => ({
  ...createEmptyStat(),
  classStats: {},
  affectedClasses: [],
  lastAttemptAt: 0,
});
const createMutableStat = (): MutableQuestionStat => ({
  attempts: 0,
  correct: 0,
  wrongAnswers: {},
  studentKeys: new Set<string>(),
  wrongStudentKeys: new Set<string>(),
});
const createMutableAggregate = (): MutableQuestionAggregate => ({
  ...createMutableStat(),
  classStats: {},
  affectedClasses: new Set<string>(),
  lastAttemptAt: 0,
});
const finalizeStat = (stat: MutableQuestionStat): QuestionStat => ({
  attempts: stat.attempts,
  correct: stat.correct,
  wrongAnswers: stat.wrongAnswers,
  uniqueStudents: stat.studentKeys.size,
  uniqueWrongStudents: stat.wrongStudentKeys.size,
});
const buildStudentKey = (raw: any, fallbackId: string) => {
  const uid = toText(
    raw.uid || raw.studentId || raw.userId || raw.student?.uid || raw.user?.uid,
  );
  if (uid) return `uid:${uid}`;
  const email = toText(
    raw.email ||
      raw.studentEmail ||
      raw.userEmail ||
      raw.student?.email ||
      raw.user?.email,
  );
  if (email) return `email:${email}`;
  const classOnly = normalizeClass(
    raw.class ||
      raw.classOnly ||
      raw.className ||
      raw.studentClass ||
      raw.student?.class ||
      raw.user?.class,
  );
  const number = normalizeNumber(
    raw.number ||
      raw.studentNumber ||
      raw.studentNo ||
      raw.no ||
      raw.student?.number ||
      raw.user?.number,
  );
  const name = toText(
    raw.name ||
      raw.studentName ||
      raw.userName ||
      raw.student?.name ||
      raw.user?.name,
  );
  return `fallback:${classOnly || "-"}:${number || "-"}:${name || fallbackId}`;
};
const getWrongAnswerLabel = (value: unknown) => {
  const text = toText(value);
  return text || "무응답";
};

const QuizBankTab: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const { config } = useAuth();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionStats, setQuestionStats] = useState<
    Record<string, QuestionAggregate>
  >({});
  const [participationByClass, setParticipationByClass] = useState<
    Record<string, number>
  >({});
  const [totalParticipants, setTotalParticipants] = useState(0);
  const [studentRoster, setStudentRoster] = useState<StudentRosterItem[]>([]);
  const [rosterAccessLimited, setRosterAccessLimited] = useState(false);
  const [lastAttemptAt, setLastAttemptAt] = useState(0);
  const [treeData, setTreeData] = useState<TreeUnit[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<BankFilterState>({
    big: "",
    mid: "",
    small: "",
  });
  const [defaultFocus, setDefaultFocus] = useState<BankDefaultFocus | null>(
    null,
  );
  const [analyticsScope, setAnalyticsScope] = useState<AnalyticsScope>("all");
  const [classFilter, setClassFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [questionPage, setQuestionPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("none");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const toRoman = (value: number) => {
    const romans = [
      "",
      "Ⅰ",
      "Ⅱ",
      "Ⅲ",
      "Ⅳ",
      "Ⅴ",
      "Ⅵ",
      "Ⅶ",
      "Ⅷ",
      "Ⅸ",
      "Ⅹ",
      "Ⅺ",
      "Ⅻ",
    ];
    return romans[value] || String(value);
  };

  const [editCategory, setEditCategory] = useState("diagnostic");
  const [editType, setEditType] = useState<QuestionType>("choice");
  const [editQuestionText, setEditQuestionText] = useState("");
  const [editExplanationText, setEditExplanationText] = useState("");
  const [editImage, setEditImage] = useState<string | null>(null);
  const [editChoiceOptions, setEditChoiceOptions] = useState<string[]>(
    createDefaultOptionItems(),
  );
  const [editChoiceAnswerIndex, setEditChoiceAnswerIndex] = useState<
    number | null
  >(null);
  const [editOxAnswer, setEditOxAnswer] = useState<"O" | "X" | "">("");
  const [editWordAnswer, setEditWordAnswer] = useState("");
  const [editOrderItems, setEditOrderItems] = useState<string[]>(
    createDefaultOptionItems(),
  );
  const [editHintEnabled, setEditHintEnabled] = useState(false);
  const [editHintText, setEditHintText] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewChoiceAnswer, setPreviewChoiceAnswer] = useState("");
  const [previewOxAnswer, setPreviewOxAnswer] = useState("");
  const [previewWordAnswer, setPreviewWordAnswer] = useState("");
  const [previewOrderPool, setPreviewOrderPool] = useState<string[]>([]);
  const [previewOrderAnswer, setPreviewOrderAnswer] = useState<string[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const toggleSort = (key: Exclude<SortKey, "none">) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDirection("desc");
      return;
    }
    if (sortDirection === "desc") {
      setSortDirection("asc");
      return;
    }
    setSortKey("none");
    setSortDirection("desc");
  };

  const sortIndicator = (key: Exclude<SortKey, "none">) => {
    if (sortKey !== key) return "fa-sort text-gray-300";
    return sortDirection === "desc"
      ? "fa-sort-down text-blue-600"
      : "fa-sort-up text-blue-600";
  };

  const trimList = (values: string[]) =>
    values.map((v) => v.trim()).filter(Boolean);
  const shuffle = <T,>(input: T[]): T[] => {
    const list = [...input];
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      try {
        const [questionsResult, treeResult, statsResult, rosterResult] =
          await Promise.all([
            loadQuestions(),
            loadTreeData(),
            loadQuestionAnalytics(),
            loadStudentRoster(),
          ]);
        setQuestions(questionsResult);
        setTreeData(treeResult);
        setQuestionStats(statsResult.questionStats);
        setParticipationByClass(statsResult.participationByClass);
        setTotalParticipants(statsResult.totalParticipants);
        setLastAttemptAt(statsResult.lastAttemptAt);
        setStudentRoster(rosterResult.students);
        setRosterAccessLimited(rosterResult.accessLimited);
        const nextDefaultFocus = buildDefaultFocus(
          questionsResult,
          treeResult,
          statsResult.questionStats,
        );
        setDefaultFocus(nextDefaultFocus);
        if (nextDefaultFocus) {
          setFilters(nextDefaultFocus.filters);
          setCategoryFilter(nextDefaultFocus.category);
        }
      } finally {
        setLoading(false);
      }
    };
    void loadAll();
  }, [config]);

  const loadQuestions = async () => {
    try {
      const snap = await getDocs(
        collection(db, getSemesterCollectionPath(config, "quiz_questions")),
      );

      const list: Question[] = [];
      snap.forEach((d) => {
        const parsed = parseInt(d.id, 10);
        list.push({
          docId: d.id,
          id: Number.isNaN(parsed) ? 0 : parsed,
          ...(d.data() as Omit<Question, "id" | "docId">),
        });
      });
      return list;
    } catch (error) {
      console.error(error);
      return [];
    }
  };

  const buildDefaultFocus = (
    questionList: Question[],
    treeList: TreeUnit[],
    statsMap: Record<string, QuestionAggregate>,
  ): BankDefaultFocus | null => {
    if (!questionList.length) return null;
    const midToBig: Record<string, string> = {};
    treeList.forEach((big) => {
      (big.children || []).forEach((mid) => {
        midToBig[mid.id] = big.id;
      });
    });
    const groups = new Map<
      string,
      {
        category: string;
        filters: BankFilterState;
        attempts: number;
        latest: number;
        questions: number;
      }
    >();

    questionList.forEach((question) => {
      const stat =
        statsMap[String(question.docId)] || statsMap[String(question.id)];
      const filtersForQuestion =
        question.category === "exam_prep"
          ? {
              big: question.refBig || "",
              mid: question.refMid || "",
              small: "",
            }
          : {
              big: midToBig[question.unitId || ""] || question.refBig || "",
              mid: question.unitId || "",
              small: "",
            };
      const category = question.category || "";
      const key = [
        category,
        filtersForQuestion.big,
        filtersForQuestion.mid,
        filtersForQuestion.small,
      ].join("|");
      const current = groups.get(key) || {
        category,
        filters: filtersForQuestion,
        attempts: 0,
        latest: 0,
        questions: 0,
      };
      current.attempts += stat?.attempts || 0;
      current.latest = Math.max(current.latest, stat?.lastAttemptAt || 0);
      current.questions += 1;
      groups.set(key, current);
    });

    const target =
      Array.from(groups.values())
        .filter((group) => group.attempts > 0)
        .sort((a, b) => {
          if (a.latest !== b.latest) return b.latest - a.latest;
          if (a.attempts !== b.attempts) return b.attempts - a.attempts;
          return b.questions - a.questions;
        })[0] || Array.from(groups.values())[0];

    if (!target) return null;
    return {
      category: target.category,
      filters: target.filters,
    };
  };

  const applyDefaultFocus = (focus = defaultFocus) => {
    if (!focus) {
      setFilters({ big: "", mid: "", small: "" });
      setCategoryFilter("");
      return;
    }
    setFilters(focus.filters);
    setCategoryFilter(focus.category);
  };

  const loadTreeData = async () => {
    try {
      const scoped = await getDoc(
        doc(db, getSemesterDocPath(config, "curriculum", "tree")),
      );
      if (scoped.exists()) return (scoped.data().tree || []) as TreeUnit[];

      const legacy = await getDoc(doc(db, "curriculum", "tree"));
      if (legacy.exists()) return (legacy.data().tree || []) as TreeUnit[];
    } catch (error) {
      console.error(error);
    }
    return [];
  };

  const applyDetailToStat = (
    stat: MutableQuestionStat,
    detail: any,
    studentKey: string,
  ) => {
    stat.attempts += 1;
    stat.studentKeys.add(studentKey);
    if (detail.correct) {
      stat.correct += 1;
      return;
    }
    stat.wrongStudentKeys.add(studentKey);
    const wrongAnswer = getWrongAnswerLabel(
      detail.u ?? detail.userAnswer ?? detail.answer,
    );
    stat.wrongAnswers[wrongAnswer] = (stat.wrongAnswers[wrongAnswer] || 0) + 1;
  };

  const loadQuestionAnalytics = async (): Promise<BankAnalyticsResult> => {
    try {
      const snap = await getDocs(
        collection(db, getSemesterCollectionPath(config, "quiz_results")),
      );

      const mutableStats: Record<string, MutableQuestionAggregate> = {};
      const participants = new Set<string>();
      const classParticipants: Record<string, Set<string>> = {};
      let latestAttemptAt = 0;

      snap.forEach((d) => {
        const raw = d.data() as any;
        const details = Array.isArray(raw.details) ? raw.details : [];
        const gradeClass = toText(
          raw.gradeClass ||
            raw.classInfo ||
            raw.student?.gradeClass ||
            raw.user?.gradeClass,
        );
        const classOnly = normalizeClass(
          raw.class ||
            raw.classOnly ||
            raw.className ||
            raw.studentClass ||
            raw.student?.class ||
            raw.user?.class ||
            (gradeClass ? gradeClass.split(" ")[1] : ""),
        );
        const studentKey = buildStudentKey(raw, d.id);
        const attemptedAt = getTimestampMs(raw.timestamp);
        participants.add(studentKey);
        if (classOnly) {
          classParticipants[classOnly] =
            classParticipants[classOnly] || new Set<string>();
          classParticipants[classOnly].add(studentKey);
        }
        latestAttemptAt = Math.max(latestAttemptAt, attemptedAt);

        details.forEach((item: any) => {
          const qid = toText(item.id ?? item.qid);
          if (!qid) return;
          if (!mutableStats[qid]) mutableStats[qid] = createMutableAggregate();
          applyDetailToStat(mutableStats[qid], item, studentKey);
          mutableStats[qid].lastAttemptAt = Math.max(
            mutableStats[qid].lastAttemptAt,
            attemptedAt,
          );
          if (classOnly) {
            mutableStats[qid].affectedClasses.add(classOnly);
            mutableStats[qid].classStats[classOnly] =
              mutableStats[qid].classStats[classOnly] || createMutableStat();
            applyDetailToStat(
              mutableStats[qid].classStats[classOnly],
              item,
              studentKey,
            );
          }
        });
      });

      const questionStatsResult: Record<string, QuestionAggregate> = {};
      Object.entries(mutableStats).forEach(([qid, stat]) => {
        questionStatsResult[qid] = {
          ...finalizeStat(stat),
          classStats: Object.fromEntries(
            Object.entries(stat.classStats).map(([classOnly, classStat]) => [
              classOnly,
              finalizeStat(classStat),
            ]),
          ),
          affectedClasses: Array.from(stat.affectedClasses).sort(
            (a, b) => Number(a) - Number(b) || a.localeCompare(b),
          ),
          lastAttemptAt: stat.lastAttemptAt,
        };
      });

      return {
        questionStats: questionStatsResult,
        participationByClass: Object.fromEntries(
          Object.entries(classParticipants).map(([classOnly, classSet]) => [
            classOnly,
            classSet.size,
          ]),
        ),
        totalParticipants: participants.size,
        lastAttemptAt: latestAttemptAt,
      };
    } catch (error) {
      console.error(error);
      return {
        questionStats: {},
        participationByClass: {},
        totalParticipants: 0,
        lastAttemptAt: 0,
      };
    }
  };

  const loadStudentRoster = async (): Promise<StudentRosterResult> => {
    try {
      const snap = await getDocs(collection(db, "users"));
      const students: StudentRosterItem[] = [];
      snap.forEach((item) => {
        const raw = item.data() as any;
        const role = toText(raw.role);
        if (role === "teacher") return;
        const classOnly = normalizeClass(
          raw.class || raw.studentClass || raw.classOnly,
        );
        if (!classOnly) return;
        students.push({
          uid: item.id,
          email: toText(raw.email),
          name:
            toText(
              raw.name ||
                raw.studentName ||
                raw.displayName ||
                raw.nickname ||
                raw.customName,
            ) || "학생",
          classOnly,
          number: normalizeNumber(raw.number || raw.studentNumber),
        });
      });
      return { students, accessLimited: false };
    } catch (error) {
      console.error(error);
      return { students: [], accessLimited: true };
    }
  };

  const selectedBig = useMemo(
    () => treeData.find((big) => big.id === filters.big),
    [filters.big, treeData],
  );

  const midOptions = selectedBig?.children || [];

  const selectedMid = useMemo(
    () => midOptions.find((mid) => mid.id === filters.mid),
    [filters.mid, midOptions],
  );

  const smallOptions = selectedMid?.children || [];

  const treeIndexes = useMemo(() => {
    const bigOrder: Record<string, number> = {};
    const midOrder: Record<string, number> = {};
    const midToBig: Record<string, string> = {};

    treeData.forEach((big, bigIdx) => {
      bigOrder[big.id] = bigIdx + 1;
      (big.children || []).forEach((mid, midIdx) => {
        midOrder[mid.id] = midIdx + 1;
        midToBig[mid.id] = big.id;
      });
    });

    return { bigOrder, midOrder, midToBig };
  }, [treeData]);

  const questionDisplayCodes = useMemo(() => {
    const grouped: Record<string, Question[]> = {};

    const resolveBigMid = (q: Question) => {
      if (q.category === "exam_prep") {
        return { bigId: q.refBig || "", midId: q.refMid || "" };
      }
      const midId = q.unitId || "";
      const bigId = treeIndexes.midToBig[midId] || q.refBig || "";
      return { bigId, midId };
    };

    questions.forEach((q) => {
      const { bigId, midId } = resolveBigMid(q);
      const key = `${bigId || "x"}__${midId || "x"}`;
      grouped[key] = grouped[key] || [];
      grouped[key].push(q);
    });

    const codeMap: Record<string, string> = {};
    Object.entries(grouped).forEach(([key, list]) => {
      const [bigId, midId] = key.split("__");
      const bigIndex = treeIndexes.bigOrder[bigId] || 0;
      const midIndex = treeIndexes.midOrder[midId] || 0;

      list
        .sort(
          (a, b) =>
            a.id - b.id || String(a.docId).localeCompare(String(b.docId)),
        )
        .forEach((q, idx) => {
          const bigPart = bigIndex > 0 ? toRoman(bigIndex) : "?";
          const midPart = midIndex > 0 ? String(midIndex) : "?";
          codeMap[q.docId] = `${bigPart}-${midPart}-${idx + 1}`;
        });
    });

    return codeMap;
  }, [questions, treeIndexes]);

  const questionDisplayMeta = useMemo(() => {
    const map: Record<string, { big: number; mid: number; seq: number }> = {};
    const grouped: Record<string, Question[]> = {};

    questions.forEach((q) => {
      const bigId =
        q.category === "exam_prep"
          ? q.refBig || ""
          : treeIndexes.midToBig[q.unitId || ""] || q.refBig || "";
      const midId =
        q.category === "exam_prep" ? q.refMid || "" : q.unitId || "";
      const key = `${bigId || "x"}__${midId || "x"}`;
      grouped[key] = grouped[key] || [];
      grouped[key].push(q);
    });

    Object.entries(grouped).forEach(([key, list]) => {
      const [bigId, midId] = key.split("__");
      const bigIndex = treeIndexes.bigOrder[bigId] || 0;
      const midIndex = treeIndexes.midOrder[midId] || 0;
      list
        .sort(
          (a, b) =>
            a.id - b.id || String(a.docId).localeCompare(String(b.docId)),
        )
        .forEach((q, idx) => {
          map[q.docId] = { big: bigIndex, mid: midIndex, seq: idx + 1 };
        });
    });

    return map;
  }, [questions, treeIndexes]);

  const activeClassFilter = analyticsScope === "class" ? classFilter : "";

  const classOptions = useMemo(() => {
    const values = new Set<string>();
    studentRoster.forEach((student) => {
      if (student.classOnly) values.add(student.classOnly);
    });
    Object.keys(participationByClass).forEach((classOnly) => {
      if (classOnly) values.add(classOnly);
    });
    Object.values(questionStats).forEach((stat) => {
      stat.affectedClasses.forEach((classOnly) => values.add(classOnly));
    });
    return Array.from(values).sort(
      (a, b) => Number(a) - Number(b) || a.localeCompare(b),
    );
  }, [participationByClass, questionStats, studentRoster]);

  const rosterCountByClass = useMemo(() => {
    const counts: Record<string, number> = {};
    studentRoster.forEach((student) => {
      if (!student.classOnly) return;
      counts[student.classOnly] = (counts[student.classOnly] || 0) + 1;
    });
    return counts;
  }, [studentRoster]);

  useEffect(() => {
    if (analyticsScope !== "class") return;
    if (classFilter && classOptions.includes(classFilter)) return;
    setClassFilter(classOptions[0] || "");
  }, [analyticsScope, classFilter, classOptions]);

  const getRawQuestionStat = (q: Question) =>
    questionStats[String(q.docId)] || questionStats[String(q.id)];

  const getScopedQuestionStat = (q: Question): QuestionAggregate => {
    const rawStat = getRawQuestionStat(q);
    if (!rawStat) return createEmptyAggregate();
    if (!activeClassFilter) return rawStat;
    const classStat =
      rawStat.classStats[activeClassFilter] || createEmptyStat();
    return {
      ...classStat,
      classStats: {},
      affectedClasses: rawStat.affectedClasses,
      lastAttemptAt: rawStat.lastAttemptAt,
    };
  };

  function getRateInfo(q: Question) {
    const stat = getScopedQuestionStat(q);
    if (!stat.attempts) {
      return { rate: 0, attempts: 0, text: "응시 없음" };
    }
    const rate = Math.round((stat.correct / stat.attempts) * 100);
    return {
      rate,
      attempts: stat.attempts,
      correct: stat.correct,
      text: `${rate}% (${stat.correct}/${stat.attempts})`,
    };
  }

  function getCategoryLabel(category: string) {
    if (category === "diagnostic") return "진단";
    if (category === "formative") return "형성";
    if (category === "exam_prep") return "시험 대비";
    return "기타";
  }

  const getQuestionStatus = (q: Question) => {
    const stat = getScopedQuestionStat(q);
    const rate = stat.attempts
      ? Math.round((stat.correct / stat.attempts) * 100)
      : 0;
    if (!stat.attempts)
      return {
        key: "no_attempt" as StatusFilter,
        label: "응시 없음",
        tone: "bg-gray-100 text-gray-600 border-gray-200",
      };
    if (stat.attempts < 3)
      return {
        key: "data_short" as StatusFilter,
        label: "데이터 부족",
        tone: "bg-slate-100 text-slate-600 border-slate-200",
      };
    if (rate < 60)
      return {
        key: "weak" as StatusFilter,
        label: "우선 확인",
        tone: "bg-red-50 text-red-600 border-red-200",
      };
    return {
      key: "stable" as StatusFilter,
      label: "안정",
      tone: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  };

  const getTopWrongAnswer = (stat: QuestionStat) => {
    const [answer, count] =
      Object.entries(stat.wrongAnswers).sort((a, b) => b[1] - a[1])[0] || [];
    if (!answer) return { answer: "-", count: 0 };
    return { answer, count };
  };

  const getRecommendation = (q: Question, stat: QuestionStat) => {
    if (!stat.attempts) return "응시 안내 확인";
    const rate = Math.round((stat.correct / stat.attempts) * 100);
    if (rate < 50) return q.type === "order" ? "흐름도 재정리" : "보충 설명";
    if (rate < 65) return "유사 문항 재출제";
    if (stat.uniqueWrongStudents >= 5) return "오답노트 연결";
    if (stat.attempts < 3) return "응시 표본 확보";
    return "유지";
  };

  const filteredQuestions = useMemo(() => {
    let list = [...questions];

    list = list.filter((q) => {
      if (categoryFilter && q.category !== categoryFilter) return false;
      if (typeFilter && normalizeQuestionType(q.type) !== typeFilter)
        return false;

      if (filters.big) {
        const selectedBigNode = treeData.find((big) => big.id === filters.big);
        if (!selectedBigNode) return false;
        const midIds = (selectedBigNode.children || []).map((mid) => mid.id);

        if (q.category === "exam_prep") {
          if (q.refBig !== filters.big) return false;
        } else if (!midIds.includes(q.unitId)) {
          return false;
        }
      }

      if (filters.mid) {
        if (q.category === "exam_prep") {
          if (q.refMid !== filters.mid) return false;
        } else if (q.unitId !== filters.mid) {
          return false;
        }
      }

      if (filters.small) {
        if (q.category === "exam_prep") {
          if (q.refSmall !== filters.small) return false;
        } else if ((q.subUnitId || "") !== filters.small) {
          return false;
        }
      }

      if (statusFilter && getQuestionStatus(q).key !== statusFilter)
        return false;

      const search = searchTerm.trim().toLowerCase();
      if (search) {
        const haystack = [
          questionDisplayCodes[q.docId],
          q.unitId,
          q.subUnitId,
          q.refBig,
          q.refMid,
          q.refSmall,
          q.question,
          q.answer,
          q.explanation,
          getCategoryLabel(q.category),
          QUESTION_TYPE_LABEL[q.type] || q.type,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }

      return true;
    });

    list.sort((a, b) => {
      if (sortKey === "code") {
        const am = questionDisplayMeta[a.docId] || { big: 0, mid: 0, seq: 0 };
        const bm = questionDisplayMeta[b.docId] || { big: 0, mid: 0, seq: 0 };
        if (am.big !== bm.big)
          return sortDirection === "asc" ? am.big - bm.big : bm.big - am.big;
        if (am.mid !== bm.mid)
          return sortDirection === "asc" ? am.mid - bm.mid : bm.mid - am.mid;
        if (am.seq !== bm.seq)
          return sortDirection === "asc" ? am.seq - bm.seq : bm.seq - am.seq;
      }
      if (sortKey === "rate") {
        const aRate = getRateInfo(a).rate;
        const bRate = getRateInfo(b).rate;
        if (aRate !== bRate)
          return sortDirection === "asc" ? aRate - bRate : bRate - aRate;
      }
      if (sortKey === "category") {
        const aLabel = getCategoryLabel(a.category);
        const bLabel = getCategoryLabel(b.category);
        if (aLabel !== bLabel) {
          return sortDirection === "asc"
            ? aLabel.localeCompare(bLabel)
            : bLabel.localeCompare(aLabel);
        }
      }
      if (sortKey === "type") {
        const aLabel = QUESTION_TYPE_LABEL[a.type] || a.type;
        const bLabel = QUESTION_TYPE_LABEL[b.type] || b.type;
        if (aLabel !== bLabel) {
          return sortDirection === "asc"
            ? aLabel.localeCompare(bLabel)
            : bLabel.localeCompare(aLabel);
        }
      }
      return a.id - b.id;
    });
    return list;
  }, [
    activeClassFilter,
    categoryFilter,
    filters,
    questionDisplayCodes,
    questionDisplayMeta,
    questionStats,
    questions,
    searchTerm,
    sortDirection,
    sortKey,
    statusFilter,
    treeData,
    typeFilter,
  ]);

  const getCategoryPillLabel = (category: string) => {
    if (category === "diagnostic") return "진단평가";
    if (category === "formative") return "형성평가";
    if (category === "exam_prep") return "학기 시험 대비";
    return "기타";
  };

  const getNodeTitle = (id?: string) => {
    if (!id) return "";
    for (const big of treeData) {
      if (big.id === id) return big.title;
      for (const mid of big.children || []) {
        if (mid.id === id) return mid.title;
        for (const small of mid.children || []) {
          if (small.id === id) return small.title;
        }
      }
    }
    return id;
  };

  const getQuestionUnitMeta = (q: Question) => {
    let bigId = "";
    let midId = "";
    let smallId = "";
    if (q.category === "exam_prep") {
      bigId = q.refBig || "";
      midId = q.refMid || "";
      smallId = q.refSmall || "";
    } else {
      midId = q.unitId || "";
      smallId = q.subUnitId || "";
      bigId = treeIndexes.midToBig[midId] || q.refBig || "";
    }
    const bigTitle = getNodeTitle(bigId) || "대단원 미지정";
    const midTitle = getNodeTitle(midId) || "중단원 미지정";
    const smallTitle = getNodeTitle(smallId) || "소단원 전체";
    return {
      bigId,
      midId,
      smallId,
      bigTitle,
      midTitle,
      smallTitle,
      focusKey: smallId || midId || bigId || "unknown",
      focusTitle: smallId ? smallTitle : midId ? midTitle : bigTitle,
      pathText: `${bigTitle} > ${midTitle} > ${smallTitle}`,
    };
  };

  const getQuestionPathText = (q: Question) => getQuestionUnitMeta(q).pathText;

  const visibleSummary = useMemo(() => {
    const totals = filteredQuestions.reduce(
      (acc, q) => {
        const stat = getScopedQuestionStat(q);
        const rate = stat.attempts
          ? Math.round((stat.correct / stat.attempts) * 100)
          : 0;
        acc.attempts += stat.attempts;
        acc.correct += stat.correct;
        if (stat.attempts) acc.attemptedQuestions += 1;
        else acc.noAttemptQuestions += 1;
        if (stat.attempts >= 3 && rate < 60) acc.weakQuestions += 1;
        if (stat.attempts > 0 && stat.attempts < 3) acc.dataShortQuestions += 1;
        acc.wrongStudentEvents += stat.uniqueWrongStudents;
        return acc;
      },
      {
        attempts: 0,
        correct: 0,
        attemptedQuestions: 0,
        noAttemptQuestions: 0,
        weakQuestions: 0,
        dataShortQuestions: 0,
        wrongStudentEvents: 0,
      },
    );
    const selectedRosterCount = activeClassFilter
      ? rosterCountByClass[activeClassFilter] || 0
      : studentRoster.length;
    const selectedParticipants = activeClassFilter
      ? participationByClass[activeClassFilter] || 0
      : totalParticipants;
    return {
      ...totals,
      totalQuestions: filteredQuestions.length,
      averageRate: totals.attempts
        ? (totals.correct / totals.attempts) * 100
        : null,
      selectedRosterCount,
      selectedParticipants,
      coverageRate: selectedRosterCount
        ? (selectedParticipants / selectedRosterCount) * 100
        : null,
    };
  }, [
    activeClassFilter,
    filteredQuestions,
    participationByClass,
    rosterCountByClass,
    studentRoster.length,
    totalParticipants,
  ]);

  const classComparisons = useMemo(() => {
    return classOptions.map((classOnly) => {
      const totals = filteredQuestions.reduce(
        (acc, q) => {
          const rawStat = getRawQuestionStat(q);
          const stat = rawStat?.classStats[classOnly] || createEmptyStat();
          const rate = stat.attempts
            ? Math.round((stat.correct / stat.attempts) * 100)
            : 0;
          acc.attempts += stat.attempts;
          acc.correct += stat.correct;
          acc.uniqueWrongStudents += stat.uniqueWrongStudents;
          if (stat.attempts >= 3 && rate < 60) acc.weakQuestions += 1;
          return acc;
        },
        {
          attempts: 0,
          correct: 0,
          uniqueWrongStudents: 0,
          weakQuestions: 0,
        },
      );
      const rosterCount = rosterCountByClass[classOnly] || 0;
      const participants = participationByClass[classOnly] || 0;
      return {
        classOnly,
        ...totals,
        participants,
        rosterCount,
        rate: totals.attempts
          ? Math.round((totals.correct / totals.attempts) * 100)
          : null,
        coverageRate: rosterCount
          ? Math.round((participants / rosterCount) * 100)
          : null,
      };
    });
  }, [
    classOptions,
    filteredQuestions,
    participationByClass,
    questionStats,
    rosterCountByClass,
  ]);

  const classGapSummary = useMemo(() => {
    const withRate = classComparisons.filter((item) => item.rate !== null);
    if (withRate.length < 2) return null;
    const sorted = [...withRate].sort((a, b) => (a.rate || 0) - (b.rate || 0));
    const lowest = sorted[0];
    const highest = sorted[sorted.length - 1];
    return {
      lowest,
      highest,
      gap: (highest.rate || 0) - (lowest.rate || 0),
    };
  }, [classComparisons]);

  const weakestMidUnit = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        title: string;
        path: string;
        questions: number;
        attempts: number;
        correct: number;
      }
    >();

    filteredQuestions.forEach((q) => {
      const meta = getQuestionUnitMeta(q);
      const stat = getScopedQuestionStat(q);
      const key = meta.midId || meta.bigId || "unknown";
      const current = map.get(key) || {
        key,
        title: meta.midTitle || meta.bigTitle,
        path: meta.bigTitle,
        questions: 0,
        attempts: 0,
        correct: 0,
      };
      current.questions += 1;
      current.attempts += stat.attempts;
      current.correct += stat.correct;
      map.set(key, current);
    });

    return (
      Array.from(map.values())
        .map((item) => ({
          ...item,
          rate: item.attempts
            ? Math.round((item.correct / item.attempts) * 100)
            : null,
        }))
        .filter((item) => item.attempts >= 3)
        .sort((a, b) => {
          const ar = a.rate ?? 101;
          const br = b.rate ?? 101;
          if (ar !== br) return ar - br;
          return b.attempts - a.attempts;
        })[0] || null
    );
  }, [activeClassFilter, filteredQuestions, questionStats, treeData]);

  const totalQuestionPages = Math.max(
    1,
    Math.ceil(filteredQuestions.length / QUESTION_PAGE_SIZE),
  );
  const paginatedQuestions = useMemo(() => {
    const start = (questionPage - 1) * QUESTION_PAGE_SIZE;
    return filteredQuestions.slice(start, start + QUESTION_PAGE_SIZE);
  }, [filteredQuestions, questionPage]);

  useEffect(() => {
    setQuestionPage(1);
  }, [
    activeClassFilter,
    categoryFilter,
    filters.big,
    filters.mid,
    filters.small,
    searchTerm,
    sortDirection,
    sortKey,
    statusFilter,
    typeFilter,
  ]);

  useEffect(() => {
    if (questionPage <= totalQuestionPages) return;
    setQuestionPage(totalQuestionPages);
  }, [questionPage, totalQuestionPages]);

  const unitInsights = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        title: string;
        path: string;
        questions: number;
        attempts: number;
        correct: number;
        weakQuestions: number;
      }
    >();

    filteredQuestions.forEach((q) => {
      const meta = getQuestionUnitMeta(q);
      const stat = getScopedQuestionStat(q);
      const rate = stat.attempts
        ? Math.round((stat.correct / stat.attempts) * 100)
        : 0;
      const current = map.get(meta.focusKey) || {
        key: meta.focusKey,
        title: meta.focusTitle,
        path: `${meta.bigTitle} > ${meta.midTitle}`,
        questions: 0,
        attempts: 0,
        correct: 0,
        weakQuestions: 0,
      };
      current.questions += 1;
      current.attempts += stat.attempts;
      current.correct += stat.correct;
      if (stat.attempts >= 3 && rate < 60) current.weakQuestions += 1;
      map.set(meta.focusKey, current);
    });

    return Array.from(map.values())
      .map((item) => ({
        ...item,
        rate: item.attempts
          ? Math.round((item.correct / item.attempts) * 100)
          : null,
      }))
      .sort((a, b) => {
        const ar = a.rate ?? 101;
        const br = b.rate ?? 101;
        if (ar !== br) return ar - br;
        return b.attempts - a.attempts;
      })
      .slice(0, 5);
  }, [activeClassFilter, filteredQuestions, questionStats, treeData]);

  const unitInsightPreview = useMemo(
    () => unitInsights.slice(0, 6),
    [unitInsights],
  );

  const typePerformance = useMemo(() => {
    const colors = ["#2563eb", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6"];
    const map = new Map<
      string,
      {
        key: string;
        label: string;
        questions: number;
        attempts: number;
        correct: number;
      }
    >();

    filteredQuestions.forEach((q) => {
      const key = normalizeQuestionType(q.type || "choice");
      const stat = getScopedQuestionStat(q);
      const current = map.get(key) || {
        key,
        label: QUESTION_TYPE_LABEL[key] || q.type || "기타",
        questions: 0,
        attempts: 0,
        correct: 0,
      };
      current.questions += 1;
      current.attempts += stat.attempts;
      current.correct += stat.correct;
      map.set(key, current);
    });

    return Array.from(map.values())
      .map((item, index) => ({
        ...item,
        color: colors[index % colors.length],
        rate: item.attempts
          ? Math.round((item.correct / item.attempts) * 100)
          : null,
      }))
      .sort((a, b) => {
        const ar = a.rate ?? -1;
        const br = b.rate ?? -1;
        if (ar !== br) return br - ar;
        return b.attempts - a.attempts;
      });
  }, [activeClassFilter, filteredQuestions, questionStats]);

  const typePerformanceGradient = useMemo(() => {
    const attempted = typePerformance.filter((item) => item.attempts > 0);
    const total = attempted.reduce((sum, item) => sum + item.attempts, 0);
    if (!total) return "#e2e8f0";
    let cursor = 0;
    return `conic-gradient(${attempted
      .map((item) => {
        const start = cursor;
        cursor += (item.attempts / total) * 100;
        return `${item.color} ${start}% ${cursor}%`;
      })
      .join(", ")})`;
  }, [typePerformance]);

  const reissueCandidates = useMemo(() => {
    return filteredQuestions
      .map((q) => {
        const stat = getScopedQuestionStat(q);
        const rate = stat.attempts
          ? Math.round((stat.correct / stat.attempts) * 100)
          : null;
        return { question: q, stat, rate };
      })
      .filter((item) => item.stat.attempts >= 3 && (item.rate ?? 100) < 60)
      .sort((a, b) => {
        if ((a.rate ?? 100) !== (b.rate ?? 100)) {
          return (a.rate ?? 100) - (b.rate ?? 100);
        }
        return b.stat.uniqueWrongStudents - a.stat.uniqueWrongStudents;
      })
      .slice(0, 3);
  }, [activeClassFilter, filteredQuestions, questionStats]);

  const scopeTitle = useMemo(() => {
    if (filters.mid) return getNodeTitle(filters.mid);
    if (weakestMidUnit) return weakestMidUnit.title;
    if (filters.big) return getNodeTitle(filters.big);
    return "최근 응시 평가";
  }, [filters.big, filters.mid, treeData, weakestMidUnit]);

  const actionSuggestions = useMemo(() => {
    const weak = filteredQuestions
      .map((q) => ({ question: q, stat: getScopedQuestionStat(q) }))
      .filter(
        ({ stat }) =>
          stat.attempts >= 3 &&
          Math.round((stat.correct / stat.attempts) * 100) < 60,
      )
      .sort((a, b) => {
        const ar = a.stat.correct / a.stat.attempts;
        const br = b.stat.correct / b.stat.attempts;
        if (ar !== br) return ar - br;
        return b.stat.uniqueWrongStudents - a.stat.uniqueWrongStudents;
      });

    const noAttempt = filteredQuestions.filter(
      (q) => getScopedQuestionStat(q).attempts === 0,
    );
    const topWrong = filteredQuestions
      .map((q) => ({ question: q, stat: getScopedQuestionStat(q) }))
      .filter(({ stat }) => stat.uniqueWrongStudents > 0)
      .sort(
        (a, b) => b.stat.uniqueWrongStudents - a.stat.uniqueWrongStudents,
      )[0];

    const suggestions: Array<{
      icon: string;
      title: string;
      description: string;
      tone: string;
    }> = [];
    if (weak[0]) {
      suggestions.push({
        icon: "fa-chalkboard-teacher",
        title: `${questionDisplayCodes[weak[0].question.docId] || "문항"} 보충 설명`,
        description: `${getQuestionUnitMeta(weak[0].question).focusTitle} 정답률 ${Math.round((weak[0].stat.correct / weak[0].stat.attempts) * 100)}%`,
        tone: "text-red-600 bg-red-50",
      });
    }
    if (topWrong) {
      const wrong = getTopWrongAnswer(topWrong.stat);
      suggestions.push({
        icon: "fa-clipboard-list",
        title: "오답노트 연결",
        description: `${wrong.answer} 오답이 ${wrong.count}회 반복되었습니다.`,
        tone: "text-violet-600 bg-violet-50",
      });
    }
    if (noAttempt.length) {
      suggestions.push({
        icon: "fa-bell",
        title: "응시 표본 확보",
        description: `${noAttempt.length}문항은 아직 응시 기록이 없습니다.`,
        tone: "text-slate-600 bg-slate-100",
      });
    }
    if (!suggestions.length) {
      suggestions.push({
        icon: "fa-check",
        title: "현재 필터 안정",
        description: "우선 조치가 필요한 문항이 뚜렷하지 않습니다.",
        tone: "text-emerald-700 bg-emerald-50",
      });
    }
    return suggestions.slice(0, 4);
  }, [
    activeClassFilter,
    filteredQuestions,
    questionDisplayCodes,
    questionStats,
    treeData,
  ]);

  const addChoiceOption = () => setEditChoiceOptions((prev) => [...prev, ""]);
  const removeChoiceOption = (index: number) => {
    if (editChoiceOptions.length <= 2) return;
    setEditChoiceOptions((prev) => prev.filter((_, i) => i !== index));
    if (editChoiceAnswerIndex === index) setEditChoiceAnswerIndex(null);
    if (editChoiceAnswerIndex !== null && editChoiceAnswerIndex > index)
      setEditChoiceAnswerIndex(editChoiceAnswerIndex - 1);
  };

  const moveOrderItem = (index: number, direction: "up" | "down") => {
    setEditOrderItems((prev) => {
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const openPreview = () => {
    const opening = !previewOpen;
    setPreviewOpen(opening);
    setPreviewChoiceAnswer("");
    setPreviewOxAnswer("");
    setPreviewWordAnswer("");
    setPreviewOrderAnswer([]);
    if (opening && editType === "order") {
      setPreviewOrderPool(shuffle(trimList(editOrderItems)));
    }
  };

  const handleEditTypeChange = (nextType: QuestionType) => {
    setEditType(nextType);
    setPreviewOpen(false);
    setPreviewChoiceAnswer("");
    setPreviewOxAnswer("");
    setPreviewWordAnswer("");
    setPreviewOrderAnswer([]);
    if (nextType === "choice" && trimList(editChoiceOptions).length === 0) {
      setEditChoiceOptions(createDefaultOptionItems());
    }
    if (nextType === "order" && trimList(editOrderItems).length === 0) {
      setEditOrderItems(createDefaultOptionItems());
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) setEditImage(ev.target.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleBigChange = (value: string) => {
    setFilters((prev) => ({
      ...prev,
      big: value,
      mid: "",
      small: "",
    }));
  };

  const handleMidChange = (value: string) => {
    setFilters((prev) => ({
      ...prev,
      mid: value,
      small: "",
    }));
  };

  const openEditModal = (question: Question) => {
    if (!canEdit) return;
    const normalizedType = normalizeQuestionType(question.type);
    setEditingQuestion(question);
    setEditCategory(question.category || "diagnostic");
    setEditType(normalizedType);
    setEditQuestionText(question.question || "");
    setEditExplanationText(question.explanation || "");
    setEditImage(question.image || null);
    setEditHintEnabled(!!(question.hintEnabled && question.hint));
    setEditHintText(question.hint || "");
    setPreviewOpen(false);
    setPreviewChoiceAnswer("");
    setPreviewOxAnswer("");
    setPreviewWordAnswer("");
    setPreviewOrderPool([]);
    setPreviewOrderAnswer([]);

    if (normalizedType === "choice") {
      const options = (question.options || []).filter(Boolean);
      const normalizedOptions =
        options.length >= 2 ? options : createDefaultOptionItems();
      setEditChoiceOptions(normalizedOptions);
      const answerIndex = normalizedOptions.findIndex(
        (opt) => opt.trim() === String(question.answer).trim(),
      );
      setEditChoiceAnswerIndex(answerIndex >= 0 ? answerIndex : null);
      setEditOxAnswer("");
      setEditWordAnswer("");
      setEditOrderItems(createDefaultOptionItems());
      return;
    }

    if (normalizedType === "ox") {
      setEditChoiceOptions(createDefaultOptionItems());
      setEditChoiceAnswerIndex(null);
      setEditOxAnswer(
        question.answer === "O" || question.answer === "X"
          ? question.answer
          : "",
      );
      setEditWordAnswer("");
      setEditOrderItems(createDefaultOptionItems());
      return;
    }

    if (normalizedType === "word") {
      setEditChoiceOptions(createDefaultOptionItems());
      setEditChoiceAnswerIndex(null);
      setEditOxAnswer("");
      setEditWordAnswer(String(question.answer || ""));
      setEditOrderItems(createDefaultOptionItems());
      return;
    }

    const orderOptions =
      question.options && question.options.length > 0
        ? question.options
        : String(question.answer || "")
            .split(ORDER_DELIMITER)
            .filter(Boolean);
    setEditChoiceOptions(createDefaultOptionItems());
    setEditChoiceAnswerIndex(null);
    setEditOxAnswer("");
    setEditWordAnswer("");
    setEditOrderItems(
      orderOptions.length >= 2 ? orderOptions : createDefaultOptionItems(),
    );
  };

  const buildCurrentEditSnapshot = () => {
    const choiceOptions = trimList(editChoiceOptions);
    const orderOptions = trimList(editOrderItems);
    let answer = "";
    let options: string[] = [];

    if (editType === "choice") {
      answer =
        editChoiceAnswerIndex !== null
          ? editChoiceOptions[editChoiceAnswerIndex]?.trim() || ""
          : "";
      options = choiceOptions;
    } else if (editType === "ox") {
      answer = editOxAnswer;
      options = ["O", "X"];
    } else if (editType === "word") {
      answer = editWordAnswer.trim();
      options = [];
    } else {
      answer = orderOptions.join(ORDER_DELIMITER);
      options = orderOptions;
    }

    return {
      category: editCategory || "diagnostic",
      type: editType,
      question: editQuestionText.trim(),
      explanation: editExplanationText.trim(),
      image: editImage || "",
      options,
      answer,
      hintEnabled: editHintEnabled,
      hint: editHintEnabled ? editHintText.trim() : "",
    };
  };

  const buildOriginalEditSnapshot = (question: Question) => {
    const normalizedType = normalizeQuestionType(question.type);
    let options: string[] = [];
    let answer = "";

    if (normalizedType === "choice") {
      options = trimList(question.options || []);
      answer = String(question.answer || "").trim();
    } else if (normalizedType === "ox") {
      options = ["O", "X"];
      answer =
        question.answer === "O" || question.answer === "X"
          ? question.answer
          : "";
    } else if (normalizedType === "word") {
      options = [];
      answer = String(question.answer || "").trim();
    } else {
      options = trimList(
        question.options && question.options.length > 0
          ? question.options
          : String(question.answer || "").split(ORDER_DELIMITER),
      );
      answer = options.join(ORDER_DELIMITER);
    }

    return {
      category: question.category || "diagnostic",
      type: normalizedType,
      question: (question.question || "").trim(),
      explanation: (question.explanation || "").trim(),
      image: question.image || "",
      options,
      answer,
      hintEnabled: !!(question.hintEnabled && question.hint),
      hint:
        question.hintEnabled && question.hint
          ? String(question.hint).trim()
          : "",
    };
  };

  const hasUnsavedEditChanges = useMemo(() => {
    if (!editingQuestion) return false;
    const current = buildCurrentEditSnapshot();
    const original = buildOriginalEditSnapshot(editingQuestion);
    return JSON.stringify(current) !== JSON.stringify(original);
  }, [
    editingQuestion,
    editCategory,
    editType,
    editQuestionText,
    editExplanationText,
    editImage,
    editChoiceOptions,
    editChoiceAnswerIndex,
    editOxAnswer,
    editWordAnswer,
    editOrderItems,
    editHintEnabled,
    editHintText,
  ]);

  const closeEditModal = (force = false) => {
    if (savingEdit) return;
    if (!force && hasUnsavedEditChanges) {
      const confirmed = window.confirm(
        "수정 중인 내용이 있습니다. 정말로 닫으시겠습니까?",
      );
      if (!confirmed) return;
    }
    setEditingQuestion(null);
    setEditCategory("diagnostic");
    setEditType("choice");
    setEditQuestionText("");
    setEditExplanationText("");
    setEditImage(null);
    setEditChoiceOptions(createDefaultOptionItems());
    setEditChoiceAnswerIndex(null);
    setEditOxAnswer("");
    setEditWordAnswer("");
    setEditOrderItems(createDefaultOptionItems());
    setEditHintEnabled(false);
    setEditHintText("");
    setPreviewOpen(false);
    setPreviewChoiceAnswer("");
    setPreviewOxAnswer("");
    setPreviewWordAnswer("");
    setPreviewOrderPool([]);
    setPreviewOrderAnswer([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const saveEditedQuestion = async () => {
    if (!canEdit) return;
    if (!editingQuestion) return;
    if (!editQuestionText.trim()) {
      alert("문제 내용을 입력하세요.");
      return;
    }

    const choiceOptions = trimList(editChoiceOptions);
    const orderOptions = trimList(editOrderItems);
    let answer = "";
    let options: string[] = [];

    if (editType === "choice") {
      if (choiceOptions.length < 2) {
        alert("객관식 보기는 최소 2개 이상 필요합니다.");
        return;
      }
      if (editChoiceAnswerIndex === null) {
        alert("객관식 정답 보기를 선택하세요.");
        return;
      }
      answer = editChoiceOptions[editChoiceAnswerIndex]?.trim() || "";
      if (!answer) {
        alert("정답으로 선택한 보기에 내용을 입력하세요.");
        return;
      }
      options = choiceOptions;
    } else if (editType === "ox") {
      if (!editOxAnswer) {
        alert("O/X 정답을 선택하세요.");
        return;
      }
      answer = editOxAnswer;
      options = ["O", "X"];
    } else if (editType === "word") {
      if (!editWordAnswer.trim()) {
        alert("단답형 정답을 입력하세요.");
        return;
      }
      answer = editWordAnswer.trim();
      options = [];
    } else {
      if (orderOptions.length < 2) {
        alert("순서 나열형 항목은 최소 2개 이상 필요합니다.");
        return;
      }
      answer = orderOptions.join(ORDER_DELIMITER);
      options = orderOptions;
    }

    if (editHintEnabled && !editHintText.trim()) {
      alert("힌트 제공을 선택한 경우 힌트 내용을 입력하세요.");
      return;
    }

    const payload: Question = {
      ...editingQuestion,
      category: editCategory || editingQuestion.category,
      type: editType || (editingQuestion.type as QuestionType),
      question: editQuestionText.trim(),
      answer,
      explanation: editExplanationText.trim(),
      // Firestore rejects undefined values (invalid-argument),
      // so we store null when the editor has no image.
      image: editImage || null,
      options,
      hintEnabled: editHintEnabled,
      hint: editHintEnabled ? editHintText.trim() : "",
    };

    setSavingEdit(true);
    try {
      const { docId: _docId, id: _localId, ...persistedPayload } = payload;
      await setDoc(
        doc(
          db,
          getSemesterDocPath(
            config,
            "quiz_questions",
            String(editingQuestion.docId),
          ),
        ),
        { ...persistedPayload, updatedAt: serverTimestamp() },
        { merge: true },
      );
      setQuestions((prev) =>
        prev.map((q) => (q.docId === editingQuestion.docId ? payload : q)),
      );
      closeEditModal(true);
    } catch (error: any) {
      console.error(error);
      alert(
        `문제 수정에 실패했습니다${error?.code ? ` (${error.code})` : ""}.`,
      );
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
      {!canEdit && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
          읽기 전용 권한입니다. 문제 수정은 관리자만 가능합니다.
        </div>
      )}
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-900">문제 은행</h2>
              <p className="mt-1 text-sm text-slate-500">
                {activeClassFilter
                  ? `${activeClassFilter}반 기준`
                  : "전체 응시 기록 기준"}
                으로 문항, 단원, 오답 흐름을 함께 봅니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
              <span className="rounded-full bg-slate-100 px-3 py-1.5">
                총 {questions.length}문항
              </span>
              <span className="rounded-full bg-blue-50 px-3 py-1.5 text-blue-700">
                분석 {filteredQuestions.length}문항
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1.5">
                마지막 응시{" "}
                {lastAttemptAt
                  ? new Date(lastAttemptAt).toLocaleString("ko-KR")
                  : "-"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 lg:grid-cols-12">
            <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-1 lg:col-span-2">
              {(["all", "class"] as AnalyticsScope[]).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  onClick={() => setAnalyticsScope(scope)}
                  className={`flex-1 rounded-md px-3 py-2 text-xs font-black transition ${
                    analyticsScope === scope
                      ? "bg-white text-blue-700 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {scope === "all" ? "전체" : "학급별"}
                </button>
              ))}
            </div>
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              disabled={analyticsScope !== "class" || classOptions.length === 0}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 disabled:bg-slate-100 disabled:text-slate-400 lg:col-span-2"
              aria-label="학급 선택"
            >
              {classOptions.length === 0 && <option value="">학급 없음</option>}
              {classOptions.map((classOnly) => (
                <option key={classOnly} value={classOnly}>
                  {classOnly}반
                </option>
              ))}
            </select>
            <select
              value={filters.big}
              onChange={(e) => handleBigChange(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 lg:col-span-2"
            >
              <option value="">대단원 전체</option>
              {treeData.map((big) => (
                <option key={big.id} value={big.id}>
                  {big.title}
                </option>
              ))}
            </select>
            <select
              value={filters.mid}
              onChange={(e) => handleMidChange(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 lg:col-span-2"
            >
              <option value="">중단원 전체</option>
              {midOptions.map((mid) => (
                <option key={mid.id} value={mid.id}>
                  {mid.title}
                </option>
              ))}
            </select>
            <select
              value={filters.small}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, small: e.target.value }))
              }
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 lg:col-span-2"
            >
              <option value="">소단원 전체</option>
              {smallOptions.map((small) => (
                <option key={small.id} value={small.id}>
                  {small.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                applyDefaultFocus();
                setTypeFilter("");
                setStatusFilter("");
                setSearchTerm("");
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-600 transition hover:border-blue-300 hover:text-blue-700 lg:col-span-2"
            >
              <i className="fas fa-sync-alt mr-2"></i>
              초기화
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2 lg:grid-cols-12">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 lg:col-span-2"
            >
              <option value="">평가 유형 전체</option>
              <option value="diagnostic">진단평가</option>
              <option value="formative">형성평가</option>
              <option value="exam_prep">학기 시험 대비</option>
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 lg:col-span-2"
            >
              <option value="">문항 유형 전체</option>
              <option value="choice">객관식</option>
              <option value="ox">O/X</option>
              <option value="word">단답형</option>
              <option value="order">순서 나열형</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 lg:col-span-2"
            >
              <option value="">상태 전체</option>
              <option value="weak">우선 확인</option>
              <option value="no_attempt">응시 없음</option>
              <option value="data_short">데이터 부족</option>
              <option value="stable">안정</option>
            </select>
            <div className="relative lg:col-span-6">
              <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400"></i>
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="문항번호, 문제, 정답, 해설 검색"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm font-bold text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-400"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="font-black text-slate-900">{scopeTitle}</h3>
              <p className="mt-1 text-xs font-bold text-slate-500">
                현재 필터 기준으로 단원, 유형, 학급 격차와 재출제 후보를 함께
                봅니다.
              </p>
            </div>
            <div className="text-xs font-black text-slate-400">
              마지막 응시{" "}
              {lastAttemptAt
                ? new Date(lastAttemptAt).toLocaleString("ko-KR")
                : "-"}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: "취약 중단원",
                value: weakestMidUnit
                  ? formatPercent(weakestMidUnit.rate)
                  : "-",
                sub: weakestMidUnit
                  ? `${weakestMidUnit.title} · ${weakestMidUnit.attempts}응시`
                  : "분석할 중단원 없음",
                icon: "fa-layer-group",
                tone: "text-orange-700 bg-orange-50",
              },
              {
                label: "학급 간 격차",
                value: classGapSummary ? `${classGapSummary.gap}%p` : "-",
                sub: classGapSummary
                  ? `${classGapSummary.lowest.classOnly}반 ${classGapSummary.lowest.rate}% / ${classGapSummary.highest.classOnly}반 ${classGapSummary.highest.rate}%`
                  : "비교할 학급 데이터 부족",
                icon: "fa-users",
                tone: "text-emerald-700 bg-emerald-50",
              },
              {
                label: "재출제 후보",
                value: `${reissueCandidates.length}문항`,
                sub:
                  reissueCandidates[0]?.rate !== null &&
                  reissueCandidates[0]?.rate !== undefined
                    ? `최저 정답률 ${reissueCandidates[0].rate}%`
                    : "정답률 60% 미만 문항",
                icon: "fa-redo-alt",
                tone: "text-blue-700 bg-blue-50",
              },
              {
                label: "응시 없음",
                value: `${visibleSummary.noAttemptQuestions}문항`,
                sub: "배포/응시 확인 필요",
                icon: "fa-inbox",
                tone: "text-slate-600 bg-slate-100",
              },
            ].map((item) => (
              <div key={item.label} className="rounded-lg bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-black text-slate-400">
                      {item.label}
                    </div>
                    <div className="mt-1 text-2xl font-black text-slate-900">
                      {item.value}
                    </div>
                  </div>
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${item.tone}`}
                  >
                    <i className={`fas ${item.icon}`}></i>
                  </div>
                </div>
                <div className="mt-2 truncate text-xs font-bold text-slate-500">
                  {item.sub}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-slate-100 p-4 xl:grid-cols-[minmax(0,1.15fr)_280px_minmax(260px,0.85fr)]">
            <section className="min-w-0">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-black text-slate-900">
                  단원별 평균 정답률
                </h4>
                <span className="text-xs font-black text-slate-400">
                  낮은 순
                </span>
              </div>
              <div className="mt-3 space-y-3">
                {unitInsightPreview.length === 0 && (
                  <div className="rounded-lg bg-slate-50 p-4 text-center text-xs font-bold text-slate-400">
                    단원별 응시 데이터가 없습니다.
                  </div>
                )}
                {unitInsightPreview.map((unit, index) => {
                  const rate = unit.rate ?? 0;
                  const tone =
                    unit.rate !== null && unit.rate < 50
                      ? "bg-red-500"
                      : unit.rate !== null && unit.rate < 65
                        ? "bg-orange-400"
                        : "bg-blue-500";
                  return (
                    <div
                      key={unit.key}
                      className="grid grid-cols-[24px_minmax(0,1fr)_48px] items-center gap-3"
                    >
                      <div className="text-xs font-black text-slate-400">
                        {toRoman(index + 1)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center justify-between gap-3">
                          <div className="truncate text-xs font-black text-slate-700">
                            {unit.title}
                          </div>
                          <div className="shrink-0 text-[11px] font-bold text-slate-400">
                            {unit.questions}문항
                          </div>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${tone}`}
                            style={{ width: `${rate}%` }}
                          ></div>
                        </div>
                      </div>
                      <div className="text-right text-xs font-black text-slate-700">
                        {formatPercent(unit.rate)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="min-w-0">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-black text-slate-900">
                  문항 유형별 정답률
                </h4>
                <span className="text-xs font-black text-slate-400">
                  {typePerformance.length}유형
                </span>
              </div>
              <div className="mt-4 flex items-center gap-4">
                <div
                  className="relative h-28 w-28 shrink-0 rounded-full"
                  style={{ background: typePerformanceGradient }}
                >
                  <div className="absolute inset-5 rounded-full bg-white"></div>
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  {typePerformance.length === 0 && (
                    <div className="rounded-lg bg-slate-50 p-4 text-xs font-bold text-slate-400">
                      유형별 데이터 없음
                    </div>
                  )}
                  {typePerformance.map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: item.color }}
                        ></span>
                        <span className="truncate font-bold text-slate-600">
                          {item.label}
                        </span>
                      </div>
                      <span className="shrink-0 font-black text-slate-800">
                        {formatPercent(item.rate)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="min-w-0">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-black text-slate-900">
                  학습 활용 제안 Top 3
                </h4>
                <span className="text-xs font-black text-slate-400">
                  수업 연결
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {actionSuggestions.slice(0, 3).map((item, index) => (
                  <div
                    key={`${item.title}-${item.description}`}
                    className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 rounded-lg bg-slate-50 p-3"
                  >
                    <div
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${item.tone}`}
                    >
                      {index + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-black text-slate-800">
                        {item.title}
                      </div>
                      <div className="mt-1 line-clamp-2 text-[11px] font-bold leading-4 text-slate-500">
                        {item.description}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>

        <div className="mt-4 grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="font-black text-slate-900">문항별 분석</h3>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  행을 선택하면 문제를 수정할 수 있습니다. 학급별 선택 시 해당
                  반 응시 결과만 반영합니다.
                </p>
              </div>
              <div className="text-xs font-black text-slate-500">
                {activeClassFilter
                  ? `${activeClassFilter}반 기준`
                  : "전체 응시 기록"}{" "}
                · {visibleSummary.attemptedQuestions}문항 응시 /{" "}
                {visibleSummary.totalQuestions}문항
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1220px] table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[84px]" />
                  <col className="w-[250px]" />
                  <col className="w-[88px]" />
                  <col className="w-[96px]" />
                  <col />
                  <col className="w-[172px]" />
                  <col className="w-[160px]" />
                  <col className="w-[132px]" />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-black text-slate-500 shadow-sm">
                  <tr>
                    <th className="px-4 py-3.5 text-center">
                      <button
                        type="button"
                        onClick={() => toggleSort("code")}
                        className="inline-flex items-center gap-1 hover:text-blue-600"
                      >
                        번호{" "}
                        <i
                          className={`fas ${sortIndicator("code")} text-xs`}
                        ></i>
                      </button>
                    </th>
                    <th className="px-4 py-3.5">단원</th>
                    <th className="px-4 py-3.5">
                      <button
                        type="button"
                        onClick={() => toggleSort("category")}
                        className="inline-flex items-center gap-1 hover:text-blue-600"
                      >
                        평가{" "}
                        <i
                          className={`fas ${sortIndicator("category")} text-xs`}
                        ></i>
                      </button>
                    </th>
                    <th className="px-4 py-3.5">
                      <button
                        type="button"
                        onClick={() => toggleSort("type")}
                        className="inline-flex items-center gap-1 hover:text-blue-600"
                      >
                        유형{" "}
                        <i
                          className={`fas ${sortIndicator("type")} text-xs`}
                        ></i>
                      </button>
                    </th>
                    <th className="px-4 py-3.5">문제</th>
                    <th className="px-4 py-3.5">
                      <button
                        type="button"
                        onClick={() => toggleSort("rate")}
                        className="inline-flex items-center gap-1 hover:text-blue-600"
                      >
                        정답률{" "}
                        <i
                          className={`fas ${sortIndicator("rate")} text-xs`}
                        ></i>
                      </button>
                    </th>
                    <th className="px-4 py-3.5">주요 오답</th>
                    <th className="px-4 py-3.5">활용</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {loading && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-12 text-center text-sm font-bold text-slate-400"
                      >
                        문제와 응시 데이터를 불러오는 중...
                      </td>
                    </tr>
                  )}

                  {!loading && filteredQuestions.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center">
                        <div className="font-black text-slate-500">
                          조건에 맞는 문제가 없습니다.
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            applyDefaultFocus();
                            setTypeFilter("");
                            setStatusFilter("");
                            setSearchTerm("");
                          }}
                          className="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-blue-700 hover:border-blue-300"
                        >
                          필터 초기화
                        </button>
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    paginatedQuestions.map((q) => {
                      const stat = getScopedQuestionStat(q);
                      const rateInfo = getRateInfo(q);
                      const status = getQuestionStatus(q);
                      const wrong = getTopWrongAnswer(stat);
                      const unitMeta = getQuestionUnitMeta(q);
                      return (
                        <tr
                          key={`${q.docId}-${q.question.slice(0, 10)}`}
                          className={`transition ${canEdit ? "cursor-pointer hover:bg-blue-50/70" : ""}`}
                          onClick={() => openEditModal(q)}
                        >
                          <td
                            className="px-4 py-5 text-center text-xs font-black text-slate-500"
                            title={`문항 ID: ${q.docId}`}
                          >
                            {questionDisplayCodes[q.docId] || "-"}
                          </td>
                          <td className="overflow-hidden px-4 py-5 align-top">
                            <div className="min-w-0 truncate text-sm font-black text-slate-800">
                              {unitMeta.focusTitle}
                            </div>
                            <div className="mt-2 min-w-0 truncate text-[11px] font-bold text-slate-400">
                              {unitMeta.bigTitle} &gt; {unitMeta.midTitle}
                            </div>
                          </td>
                          <td className="overflow-hidden px-4 py-5 align-top">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${
                                q.category === "diagnostic"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : q.category === "formative"
                                    ? "bg-amber-50 text-amber-700"
                                    : "bg-violet-50 text-violet-700"
                              }`}
                            >
                              {getCategoryLabel(q.category)}
                            </span>
                          </td>
                          <td className="overflow-hidden px-4 py-5 align-top text-xs font-black text-slate-600">
                            {QUESTION_TYPE_LABEL[q.type] || q.type}
                          </td>
                          <td className="overflow-hidden px-4 py-5 align-top">
                            <div className="min-w-0">
                              <div className="flex items-start gap-3">
                                {q.image && (
                                  <i
                                    className="fas fa-image mt-1 text-blue-500"
                                    title="이미지 문항"
                                  ></i>
                                )}
                                {q.hintEnabled && (
                                  <i
                                    className="fas fa-lightbulb mt-1 text-amber-500"
                                    title="힌트 제공"
                                  ></i>
                                )}
                                <div className="min-w-0 break-words font-black leading-6 text-slate-800">
                                  {q.question}
                                </div>
                              </div>
                              <div className="mt-2 min-w-0 truncate text-xs font-bold text-blue-700">
                                정답:{" "}
                                {String(q.answer || "-")
                                  .split(ORDER_DELIMITER)
                                  .join(" > ")}
                              </div>
                            </div>
                          </td>
                          <td className="overflow-hidden px-4 py-5 align-top">
                            <div className="text-xs font-black text-slate-700">
                              {rateInfo.text}
                            </div>
                            <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                              <div
                                className={`h-full rounded-full ${rateInfo.attempts && rateInfo.rate < 60 ? "bg-red-500" : "bg-blue-500"}`}
                                style={{
                                  width: `${rateInfo.attempts ? rateInfo.rate : 0}%`,
                                }}
                              ></div>
                            </div>
                          </td>
                          <td className="overflow-hidden px-4 py-5 align-top">
                            <div className="text-xs font-black text-slate-700">
                              {stat.uniqueWrongStudents}명 오답
                            </div>
                            <div className="mt-2 min-w-0 truncate text-[11px] font-bold text-slate-400">
                              {wrong.count
                                ? `${wrong.answer} ${wrong.count}회`
                                : "반복 오답 없음"}
                            </div>
                          </td>
                          <td className="overflow-hidden px-4 py-5 align-top">
                            <span
                              className={`mb-2 inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-black ${status.tone}`}
                            >
                              {status.label}
                            </span>
                            <div className="text-[11px] font-black text-slate-600">
                              {getRecommendation(q, stat)}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            {!loading && filteredQuestions.length > 0 && (
              <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs font-bold text-slate-500">
                  {Math.min(
                    (questionPage - 1) * QUESTION_PAGE_SIZE + 1,
                    filteredQuestions.length,
                  )}
                  -
                  {Math.min(
                    questionPage * QUESTION_PAGE_SIZE,
                    filteredQuestions.length,
                  )}
                  번 / 총 {filteredQuestions.length}문항
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setQuestionPage((prev) => Math.max(1, prev - 1))
                    }
                    disabled={questionPage <= 1}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-600 transition hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300"
                  >
                    이전
                  </button>
                  {Array.from(
                    { length: totalQuestionPages },
                    (_, index) => index + 1,
                  )
                    .filter(
                      (page) =>
                        page === 1 ||
                        page === totalQuestionPages ||
                        Math.abs(page - questionPage) <= 2,
                    )
                    .map((page, index, pages) => {
                      const prevPage = pages[index - 1];
                      const showGap = prevPage && page - prevPage > 1;
                      return (
                        <React.Fragment key={page}>
                          {showGap && (
                            <span className="px-1 text-xs font-black text-slate-300">
                              ...
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setQuestionPage(page)}
                            className={`h-8 min-w-8 rounded-md border px-2 text-xs font-black transition ${
                              questionPage === page
                                ? "border-blue-500 bg-blue-600 text-white"
                                : "border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-700"
                            }`}
                          >
                            {page}
                          </button>
                        </React.Fragment>
                      );
                    })}
                  <button
                    type="button"
                    onClick={() =>
                      setQuestionPage((prev) =>
                        Math.min(totalQuestionPages, prev + 1),
                      )
                    }
                    disabled={questionPage >= totalQuestionPages}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-600 transition hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300"
                  >
                    다음
                  </button>
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-black text-slate-900">학급 간 비교</h3>
                <span className="text-xs font-black text-slate-400">
                  {classComparisons.length}개 반
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {classComparisons.length === 0 && (
                  <div className="rounded-lg bg-slate-50 p-4 text-center text-xs font-bold text-slate-400">
                    비교할 학급 데이터가 없습니다.
                  </div>
                )}
                {classComparisons
                  .slice()
                  .sort((a, b) => {
                    const ar = a.rate ?? 101;
                    const br = b.rate ?? 101;
                    if (ar !== br) return ar - br;
                    return Number(a.classOnly) - Number(b.classOnly);
                  })
                  .map((item) => {
                    const isSelected = activeClassFilter === item.classOnly;
                    const rate = item.rate ?? 0;
                    return (
                      <button
                        key={item.classOnly}
                        type="button"
                        onClick={() => {
                          setAnalyticsScope("class");
                          setClassFilter(item.classOnly);
                        }}
                        className={`w-full rounded-lg border p-3 text-left transition ${
                          isSelected
                            ? "border-blue-300 bg-blue-50"
                            : "border-slate-100 hover:border-blue-200 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-black text-slate-800">
                            {item.classOnly}반
                          </div>
                          <div
                            className={`font-black ${item.rate !== null && item.rate < 60 ? "text-red-600" : "text-blue-700"}`}
                          >
                            {formatPercent(item.rate)}
                          </div>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${item.rate !== null && item.rate < 60 ? "bg-red-500" : "bg-blue-500"}`}
                            style={{ width: `${rate}%` }}
                          ></div>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[11px] font-bold text-slate-500">
                          <span>{item.attempts}응시</span>
                          <span>우선 확인 {item.weakQuestions}문항</span>
                          <span>
                            {item.coverageRate === null
                              ? `${item.participants}명`
                              : `참여 ${item.coverageRate}%`}
                          </span>
                        </div>
                      </button>
                    );
                  })}
              </div>
              {classGapSummary && (
                <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold leading-5 text-emerald-700">
                  {classGapSummary.lowest.classOnly}반과{" "}
                  {classGapSummary.highest.classOnly}반의 정답률 격차가{" "}
                  {classGapSummary.gap}%p입니다.
                </div>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="font-black text-slate-900">수업 활용 제안</h3>
              <div className="mt-4 space-y-2">
                {actionSuggestions.map((item) => (
                  <div
                    key={`${item.title}-${item.description}`}
                    className="flex gap-3 rounded-lg border border-slate-100 p-3"
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.tone}`}
                    >
                      <i className={`fas ${item.icon} text-xs`}></i>
                    </div>
                    <div className="min-w-0">
                      <div className="font-black text-slate-800">
                        {item.title}
                      </div>
                      <div className="mt-1 text-xs font-bold leading-5 text-slate-500">
                        {item.description}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {rosterAccessLimited && (
                <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-700">
                  학생 명단 권한이 없어 참여율은 응시 기록 기준으로 표시합니다.
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>

      {editingQuestion && (
        <div className="fixed inset-0 z-50" onClick={() => closeEditModal()}>
          <div className="absolute inset-0 bg-black/45" />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div
              className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-gray-200 p-5"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-bold text-gray-800 text-lg flex items-center">
                    <i className="fas fa-pen text-blue-500 mr-2"></i>
                    문제 수정
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="px-2 py-1 rounded bg-gray-100 text-gray-700 font-bold">
                      {getQuestionPathText(editingQuestion)}
                    </span>
                    <span className="px-2 py-1 rounded bg-blue-100 text-blue-700 font-bold">
                      {getCategoryPillLabel(editCategory)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => closeEditModal()}
                  className="text-gray-400 hover:text-gray-700"
                >
                  <i className="fas fa-times text-lg"></i>
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <select
                    value={editType}
                    onChange={(e) =>
                      handleEditTypeChange(e.target.value as QuestionType)
                    }
                    className="border p-2 rounded text-sm bg-gray-50"
                  >
                    <option value="choice">객관식</option>
                    <option value="ox">O/X</option>
                    <option value="word">단답형</option>
                    <option value="order">순서 나열형</option>
                  </select>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="border p-2 rounded text-sm bg-gray-50"
                  >
                    <option value="diagnostic">진단평가</option>
                    <option value="formative">형성평가</option>
                    <option value="exam_prep">학기 시험 대비</option>
                  </select>
                </div>

                <input
                  type="text"
                  value={editQuestionText}
                  onChange={(e) => setEditQuestionText(e.target.value)}
                  placeholder="문제 내용"
                  className="w-full border p-2 rounded text-sm"
                />

                <label className="inline-flex items-center gap-2 text-xs font-bold text-gray-500 cursor-pointer hover:text-blue-600 bg-gray-100 px-3 py-1 rounded transition w-fit">
                  <i className="fas fa-image"></i> 이미지 첨부
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*"
                    ref={fileInputRef}
                    onChange={handleImageSelect}
                  />
                </label>
                {editImage && (
                  <div className="relative border rounded p-2 bg-gray-50">
                    <img
                      src={editImage}
                      alt="문항 첨부 이미지"
                      className="max-h-44 mx-auto rounded"
                    />
                    <button
                      type="button"
                      onClick={() => setEditImage(null)}
                      className="absolute top-2 right-2 text-xs px-2 py-1 rounded bg-white border text-gray-500 hover:text-red-500"
                    >
                      제거
                    </button>
                  </div>
                )}

                {editType === "choice" && (
                  <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-gray-600">
                        객관식 보기
                      </p>
                      <button
                        type="button"
                        onClick={addChoiceOption}
                        className="text-xs font-bold text-blue-600 hover:text-blue-700"
                      >
                        <i className="fas fa-plus mr-1"></i>보기 추가
                      </button>
                    </div>
                    {editChoiceOptions.map((option, index) => (
                      <div
                        key={`choice-option-${index}`}
                        className="flex items-center gap-2"
                      >
                        <span className="w-7 h-7 rounded-full bg-gray-200 text-gray-700 text-xs font-bold flex items-center justify-center">
                          {index + 1}
                        </span>
                        <input
                          type="text"
                          value={option}
                          onChange={(e) =>
                            setEditChoiceOptions((prev) =>
                              prev.map((opt, i) =>
                                i === index ? e.target.value : opt,
                              ),
                            )
                          }
                          placeholder={`${index + 1}번 보기`}
                          className="flex-1 border rounded p-2 text-sm bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => setEditChoiceAnswerIndex(index)}
                          className={`text-xs px-2 py-1 rounded border ${editChoiceAnswerIndex === index ? "border-blue-500 bg-blue-100 text-blue-700 font-bold" : "border-gray-300 text-gray-500"}`}
                        >
                          정답
                        </button>
                        <button
                          type="button"
                          onClick={() => removeChoiceOption(index)}
                          className="text-gray-400 hover:text-red-500 px-1"
                        >
                          <i className="fas fa-times"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {editType === "ox" && (
                  <div className="grid grid-cols-2 gap-2">
                    {(["O", "X"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setEditOxAnswer(value)}
                        className={`py-3 rounded-lg border-2 font-bold transition ${editOxAnswer === value ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-500 hover:border-blue-300"}`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                )}

                {editType === "word" && (
                  <input
                    type="text"
                    value={editWordAnswer}
                    onChange={(e) => setEditWordAnswer(e.target.value)}
                    placeholder="단답형 정답 입력"
                    className="w-full border rounded p-2 text-sm bg-white"
                  />
                )}

                {editType === "order" && (
                  <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-gray-600">
                        순서 항목 (위에서 아래 순서가 정답)
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setEditOrderItems((prev) => [...prev, ""])
                        }
                        className="text-xs font-bold text-blue-600 hover:text-blue-700"
                      >
                        <i className="fas fa-plus mr-1"></i>항목 추가
                      </button>
                    </div>
                    {editOrderItems.map((item, index) => (
                      <div
                        key={`order-item-${index}`}
                        className="flex items-center gap-2"
                      >
                        <span className="w-7 h-7 rounded-full bg-gray-200 text-gray-700 text-xs font-bold flex items-center justify-center">
                          {index + 1}
                        </span>
                        <input
                          type="text"
                          value={item}
                          onChange={(e) =>
                            setEditOrderItems((prev) =>
                              prev.map((v, i) =>
                                i === index ? e.target.value : v,
                              ),
                            )
                          }
                          className="flex-1 border rounded p-2 text-sm bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => moveOrderItem(index, "up")}
                          className="text-gray-400 hover:text-blue-600 px-1"
                        >
                          <i className="fas fa-arrow-up"></i>
                        </button>
                        <button
                          type="button"
                          onClick={() => moveOrderItem(index, "down")}
                          className="text-gray-400 hover:text-blue-600 px-1"
                        >
                          <i className="fas fa-arrow-down"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <textarea
                  value={editExplanationText}
                  onChange={(e) => setEditExplanationText(e.target.value)}
                  placeholder="해설 (선택)"
                  className="w-full border p-2 rounded text-sm min-h-[80px]"
                />

                <div className="border border-gray-200 rounded-lg p-3 bg-amber-50">
                  <label className="inline-flex items-center gap-2 text-sm font-bold text-amber-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editHintEnabled}
                      onChange={(e) => setEditHintEnabled(e.target.checked)}
                    />
                    힌트 제공
                  </label>
                  {editHintEnabled && (
                    <textarea
                      placeholder="학생에게 보여줄 힌트를 입력하세요"
                      value={editHintText}
                      onChange={(e) => setEditHintText(e.target.value)}
                      className="mt-2 w-full border p-2 rounded text-sm h-16 resize-none bg-white"
                    />
                  )}
                </div>

                {previewOpen && (
                  <div className="border border-blue-200 rounded-xl p-4 bg-blue-50 space-y-3">
                    <div className="text-sm font-bold text-blue-800">
                      학생 화면 미리보기
                    </div>
                    <div className="bg-white rounded-lg border border-blue-100 p-4">
                      <h4 className="font-bold text-gray-800 mb-4">
                        {editQuestionText ||
                          "문제 문구를 입력하면 여기 표시됩니다."}
                      </h4>
                      {editType === "choice" &&
                        trimList(editChoiceOptions).map((opt, index) => (
                          <button
                            key={`preview-choice-${index}`}
                            type="button"
                            onClick={() => setPreviewChoiceAnswer(opt)}
                            className={`w-full border-2 rounded-lg p-3 text-left transition flex items-center gap-2 mb-2 ${previewChoiceAnswer === opt ? "border-blue-500 bg-blue-50 text-blue-800 font-bold" : "border-gray-200 hover:border-blue-300"}`}
                          >
                            <span
                              className={`w-6 h-6 rounded-full text-xs flex items-center justify-center ${previewChoiceAnswer === opt ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-500"}`}
                            >
                              {index + 1}
                            </span>
                            <span>{opt}</span>
                          </button>
                        ))}
                      {editType === "ox" && (
                        <div className="grid grid-cols-2 gap-2">
                          {(["O", "X"] as const).map((opt) => (
                            <button
                              key={`preview-ox-${opt}`}
                              type="button"
                              onClick={() => setPreviewOxAnswer(opt)}
                              className={`border-2 rounded-lg py-3 font-bold transition ${previewOxAnswer === opt ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 hover:border-blue-300"}`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      )}
                      {editType === "word" && (
                        <input
                          type="text"
                          value={previewWordAnswer}
                          onChange={(e) => setPreviewWordAnswer(e.target.value)}
                          placeholder="정답 입력 칸 미리보기"
                          className="w-full border-b-2 border-gray-300 p-2 text-center text-sm focus:border-blue-500 outline-none"
                        />
                      )}
                      {editType === "order" && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2">
                            {previewOrderPool.map((item) => (
                              <button
                                key={`preview-order-pool-${item}`}
                                type="button"
                                onClick={() =>
                                  !previewOrderAnswer.includes(item) &&
                                  setPreviewOrderAnswer((prev) => [
                                    ...prev,
                                    item,
                                  ])
                                }
                                className={`px-3 py-2 rounded border-2 text-sm transition ${previewOrderAnswer.includes(item) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 hover:border-blue-300"}`}
                              >
                                {item}
                              </button>
                            ))}
                          </div>
                          <div className="rounded border border-dashed border-blue-300 bg-white p-3 min-h-[60px]">
                            {previewOrderAnswer.map((item, index) => (
                              <button
                                key={`preview-order-selected-${index}-${item}`}
                                type="button"
                                onClick={() =>
                                  setPreviewOrderAnswer((prev) =>
                                    prev.filter((_, i) => i !== index),
                                  )
                                }
                                className="px-2 py-1 rounded bg-blue-100 text-blue-700 text-xs font-bold mr-2 mb-2"
                              >
                                {index + 1}. {item}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={openPreview}
                    className={`font-bold py-2 rounded transition border ${previewOpen ? "bg-white text-blue-700 border-blue-500" : "bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-700"}`}
                  >
                    {previewOpen ? "미리보기 닫기" : "미리보기"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveEditedQuestion()}
                    disabled={savingEdit}
                    className="bg-blue-600 text-white font-bold py-2 rounded hover:bg-blue-700 transition disabled:bg-blue-300"
                  >
                    {savingEdit ? "저장 중..." : "수정 저장"}
                  </button>
                  <button
                    type="button"
                    onClick={() => closeEditModal()}
                    className="bg-gray-100 text-gray-700 font-bold py-2 rounded hover:bg-gray-200 transition"
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuizBankTab;
