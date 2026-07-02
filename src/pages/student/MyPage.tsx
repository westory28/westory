import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { useAppToast } from "../../components/common/AppToastProvider";
import PointRankBadge from "../../components/common/PointRankBadge";
import QuizPassage from "../../components/common/QuizPassage";
import { useAuth } from "../../contexts/AuthContext";
import { subscribePointsUpdated } from "../../lib/appEvents";
import { db } from "../../lib/firebase";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import {
  getPointPolicy,
  getPointRankManualAdjustEarnedPointsByUid,
  getPointWalletByUid,
  POINT_POLICY_FALLBACK,
  updateStudentProfileIcon,
} from "../../lib/points";
import {
  getPointRankAllowedEmojiIds,
  getPointRankDefaultEmojiValue,
  getPointRankDisplay,
  getPointRankEmojiEntryById,
  getPointRankEmojiEntryByValue,
  getPointRankEmojiRegistry,
  getPointRankTierDisplayItems,
  getPointRankTierMeta,
  getPointRankUnlockTierCodeForEmoji,
  needsPointRankLegacyFallback,
} from "../../lib/pointRanks";
import { formatWisAmount } from "../../lib/pointFormatters";
import {
  formatPerformanceScore,
  getPerformanceScorePercent,
  loadUserPerformanceScoreRecords,
  type PerformanceScoreRecord,
} from "../../lib/performanceScores";
import { getDefaultProfileEmojiValue } from "../../lib/profileEmojis";
import {
  formatMockExamRoundLabel,
  getResultMockExamRound,
  isMockExamCategory,
  normalizeMockExamCategory,
} from "../../lib/mockExamRounds";
import { getSemesterCollectionPath } from "../../lib/semesterScope";
import {
  loadStudentQuizResults,
  loadStudentProgressSummary,
  type StudentProgressSummary,
  type StudentQuizResultDoc,
} from "../../lib/studentProgressSummary";
import {
  buildScoreRows as buildSharedScoreRows,
  buildSubjectScoreInsights as buildSharedSubjectScoreInsights,
  getTeacherAdviceText as getSharedTeacherAdviceText,
  type GradingPlanLike,
} from "../../lib/studentScores";
import type { PointPolicy, PointWallet } from "../../types";

const LazyChart = lazyWithRetry(
  () => import("../../components/common/LazyChart"),
  "student-my-page-chart",
);

type MainMenu = "profile" | "score" | "wrong_note";
type CategoryTab = "all" | "diagnostic" | "formative" | "exam_prep";

interface UserProfileDoc {
  name?: string;
  grade?: string;
  class?: string;
  number?: string;
  profileIcon?: string;
  profileEmojiId?: string;
  myPageGoalScore?: string;
  myPageSubjectGoals?: Record<string, number>;
}

interface GradingPlanItem {
  type?: string;
  name?: string;
  maxScore: number;
  ratio: number;
}

interface GradingPlanDoc {
  id: string;
  subject?: string;
  items?: GradingPlanItem[];
}

interface ScoreBreakdownItem {
  name: string;
  score: number;
  maxScore: number;
  ratio: number;
  weighted: number;
  entered: boolean;
  type: "exam" | "performance" | "other";
}

interface ScoreRow {
  subject: string;
  total: number;
  breakdown: ScoreBreakdownItem[];
}

interface SubjectScoreInsight {
  subject: string;
  current: number;
  target: number;
  gap: number;
  remainingPotential: number;
  requiredRate: number;
  examCurrent: number;
  performanceCurrent: number;
  otherCurrent: number;
  examNeed: number;
  performanceNeed: number;
  missingExamCount: number;
  missingPerformanceCount: number;
  mood: "good" | "care";
}

type QuizResultDoc = StudentQuizResultDoc;
type QuizResultSource = QuizResultDoc[] | Promise<QuizResultDoc[]>;

interface UnitParentMeta {
  bigId: string;
  bigTitle: string;
  midId: string;
  midTitle: string;
  smallId?: string;
  smallTitle?: string;
}

interface ReviewChoiceOption {
  text: string;
  image: string;
}

interface WrongNoteItem {
  key: string;
  questionNumber: number;
  type: string;
  question: string;
  passage: string;
  image: string;
  options: ReviewChoiceOption[];
  answer: string;
  explanation: string;
  userAnswer: string;
  correct: boolean;
  unitId: string;
  unitTitle: string;
  bigUnitId: string;
  bigUnitTitle: string;
  midUnitId: string;
  midUnitTitle: string;
  smallUnitId: string;
  smallUnitTitle: string;
  hierarchyLabel: string;
  category: CategoryTab | "other";
  categoryLabel: string;
  dateText: string;
}

interface TrendPoint {
  label: string;
  unitId: string;
  category: CategoryTab | "other";
  score: number;
  wrongCount?: number;
  dateText?: string;
}

interface QuizAttemptReview {
  key: string;
  roundLabel: string;
  title: string;
  unitId: string;
  unitTitle: string;
  bigUnitId: string;
  bigUnitTitle: string;
  midUnitId: string;
  midUnitTitle: string;
  smallUnitId: string;
  smallUnitTitle: string;
  category: CategoryTab | "other";
  categoryLabel: string;
  groupLabel: string;
  score: number;
  wrongCount: number;
  dateText: string;
  allItems: WrongNoteItem[];
  wrongItems: WrongNoteItem[];
}

interface ReviewProgressMidGroup {
  key: string;
  label: string;
  smalls: ReviewProgressSmallGroup[];
}

interface ReviewProgressSmallGroup {
  key: string;
  label: string;
  items: Array<{ item: WrongNoteItem; index: number }>;
}

interface ReviewProgressBigGroup {
  key: string;
  label: string;
  mids: ReviewProgressMidGroup[];
}

const DEFAULT_POINT_WALLET: PointWallet = {
  uid: "",
  studentName: "",
  grade: "",
  class: "",
  number: "",
  balance: 0,
  earnedTotal: 0,
  rankEarnedTotal: 0,
  spentTotal: 0,
  adjustedTotal: 0,
  rankSnapshot: null,
  lastTransactionAt: null,
};
const SUBJECT_PRIORITY = [
  "국어",
  "영어",
  "수학",
  "사회",
  "역사",
  "도덕",
  "과학",
  "기술",
  "가정",
  "기술가정",
  "체육",
  "미술",
  "음악",
  "정보",
];
const CATEGORY_LABELS: Array<{ key: CategoryTab; label: string }> = [
  { key: "diagnostic", label: "진단평가" },
  { key: "formative", label: "형성평가" },
  { key: "exam_prep", label: "모의고사" },
];
const MOCK_ROUND_SCOPE_PREFIX = "mock_round:";

const getMockRoundScopeId = (roundLabel: string) =>
  `${MOCK_ROUND_SCOPE_PREFIX}${roundLabel}`;

const getMockRoundLabelFromScope = (scopeId: string) =>
  scopeId.startsWith(MOCK_ROUND_SCOPE_PREFIX)
    ? scopeId.slice(MOCK_ROUND_SCOPE_PREFIX.length)
    : "";

const getInitialReviewIndex = (attempt: QuizAttemptReview | null) => {
  if (!attempt?.allItems.length) return 0;
  const firstWrongIndex = attempt.allItems.findIndex((item) => !item.correct);
  return firstWrongIndex >= 0 ? firstWrongIndex : 0;
};

const isSmallUnitAssessmentCategory = (category?: string) => {
  const normalizedCategory = normalizeMockExamCategory(category);
  return (
    normalizedCategory === "diagnostic" || normalizedCategory === "formative"
  );
};

const buildHierarchyLabel = (...labels: string[]) => {
  const parts = labels
    .map((label) => String(label || "").trim())
    .filter(Boolean)
    .filter((label, index, arr) => index === 0 || label !== arr[index - 1]);
  return parts.join(" > ") || "목차 미지정";
};

const getWrongNoteItemScopeId = (item: WrongNoteItem) =>
  isSmallUnitAssessmentCategory(item.category)
    ? item.smallUnitId || item.midUnitId || item.unitId
    : item.unitId || item.smallUnitId || item.midUnitId;

const getWrongNoteItemScopeTitle = (item: WrongNoteItem) =>
  isSmallUnitAssessmentCategory(item.category)
    ? item.smallUnitTitle ||
      item.midUnitTitle ||
      item.unitTitle ||
      "소단원 미지정"
    : item.unitTitle || item.smallUnitTitle || item.midUnitTitle;

const getAttemptSmallUnitScopeItem = (attempt: QuizAttemptReview | null) =>
  attempt?.wrongItems[0] || attempt?.allItems[0] || null;

const wrongNoteItemMatchesSelectedUnit = (
  item: WrongNoteItem,
  selectedUnitId: string,
) => {
  if (selectedUnitId === "all") return true;
  if (selectedUnitId === "exam_prep") return item.category === "exam_prep";
  if (isSmallUnitAssessmentCategory(item.category)) {
    return (
      getWrongNoteItemScopeId(item) === selectedUnitId ||
      (!item.smallUnitId &&
        (item.midUnitId === selectedUnitId || item.unitId === selectedUnitId))
    );
  }
  return [
    item.unitId,
    item.bigUnitId,
    item.midUnitId,
    item.smallUnitId,
  ].includes(selectedUnitId);
};

const quizAttemptMatchesSelectedUnit = (
  attempt: QuizAttemptReview,
  selectedUnitId: string,
) => {
  if (selectedUnitId === "all") return true;
  const selectedRoundLabel = getMockRoundLabelFromScope(selectedUnitId);
  if (selectedRoundLabel) {
    return (
      attempt.category === "exam_prep" &&
      attempt.roundLabel === selectedRoundLabel
    );
  }
  if (selectedUnitId === "exam_prep") {
    return attempt.category === "exam_prep";
  }
  return (
    [
      attempt.unitId,
      attempt.bigUnitId,
      attempt.midUnitId,
      attempt.smallUnitId,
    ].includes(selectedUnitId) ||
    attempt.allItems.some((item) =>
      wrongNoteItemMatchesSelectedUnit(item, selectedUnitId),
    )
  );
};

const getWrongNoteScopeFromAttempt = (
  attempt: QuizAttemptReview | null,
): { category: CategoryTab | "all"; unitId: string } => {
  if (!attempt) return { category: "all", unitId: "all" };
  if (attempt.category === "exam_prep") {
    return {
      category: "exam_prep",
      unitId: getMockRoundScopeId(attempt.roundLabel || "모의고사"),
    };
  }
  if (attempt.category === "diagnostic" || attempt.category === "formative") {
    const scopeItem = getAttemptSmallUnitScopeItem(attempt);
    return {
      category: attempt.category,
      unitId: scopeItem ? getWrongNoteItemScopeId(scopeItem) || "all" : "all",
    };
  }
  return {
    category: "all",
    unitId: attempt.bigUnitId || attempt.unitId || "all",
  };
};

const getReviewProgressGroups = (
  items: WrongNoteItem[],
): ReviewProgressBigGroup[] => {
  const grouped = new Map<string, ReviewProgressBigGroup>();
  items.forEach((item, index) => {
    const bigKey = item.bigUnitId || item.bigUnitTitle || "unknown-big";
    const bigLabel = item.bigUnitTitle || "대단원 미지정";
    const midKey = item.midUnitId || item.midUnitTitle || "unknown-mid";
    const midLabel = item.midUnitTitle || item.unitTitle || "중단원 미지정";
    const smallKey =
      item.smallUnitId ||
      item.smallUnitTitle ||
      item.midUnitId ||
      item.unitId ||
      "unknown-small";
    const smallLabel =
      item.smallUnitTitle ||
      item.unitTitle ||
      item.midUnitTitle ||
      "소단원 미지정";
    const bigGroup = grouped.get(bigKey) || {
      key: bigKey,
      label: bigLabel,
      mids: [],
    };
    const existingMid = bigGroup.mids.find((mid) => mid.key === midKey);
    if (existingMid) {
      const existingSmall = existingMid.smalls.find(
        (small) => small.key === smallKey,
      );
      if (existingSmall) {
        existingSmall.items.push({ item, index });
      } else {
        existingMid.smalls.push({
          key: smallKey,
          label: smallLabel,
          items: [{ item, index }],
        });
      }
    } else {
      bigGroup.mids.push({
        key: midKey,
        label: midLabel,
        smalls: [
          {
            key: smallKey,
            label: smallLabel,
            items: [{ item, index }],
          },
        ],
      });
    }
    grouped.set(bigKey, bigGroup);
  });
  return Array.from(grouped.values());
};

const getCategoryLabel = (category?: string) => {
  const normalizedCategory = normalizeMockExamCategory(category);
  if (normalizedCategory === "diagnostic") return "진단평가";
  if (normalizedCategory === "formative") return "형성평가";
  if (normalizedCategory === "exam_prep") return "모의고사";
  return "기타";
};

const getCategoryShort = (category?: string) => {
  const normalizedCategory = normalizeMockExamCategory(category);
  if (normalizedCategory === "diagnostic") return "진단";
  if (normalizedCategory === "formative") return "형성";
  if (normalizedCategory === "exam_prep") return "모의";
  return "기타";
};

const chunk = <T,>(arr: T[], size: number) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size),
  );

const formatResultDate = (result: QuizResultDoc) => {
  if (result.timestamp?.seconds) {
    return new Date(result.timestamp.seconds * 1000).toLocaleString("ko-KR");
  }
  return result.timeString || "-";
};

const ORDER_DELIMITER = "||";
const MATCHING_PAIR_DELIMITER = "=>";

const normalizeAnswerText = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .trim();

const isGeneratedImageChoiceLabel = (value: string, index: number) => {
  const match = value.trim().match(/^(\d+)\s*번\s*보기$/);
  return Boolean(match && Number(match[1]) === index + 1);
};

const formatQuizAnswerText = (value: unknown) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.includes(MATCHING_PAIR_DELIMITER)) {
    return text
      .split(ORDER_DELIMITER)
      .filter(Boolean)
      .map((item) => item.split(MATCHING_PAIR_DELIMITER).join(" → "))
      .join(", ");
  }
  if (text.includes(ORDER_DELIMITER)) {
    return text.split(ORDER_DELIMITER).filter(Boolean).join(" → ");
  }
  return text;
};

const getReviewChoiceOptions = (question: any): ReviewChoiceOption[] => {
  const questionType = String(question?.type || "").trim();
  const rawOptions =
    Array.isArray(question?.options) && question.options.length > 0
      ? question.options
      : questionType === "ox"
        ? ["O", "X"]
        : [];
  const rawImages = Array.isArray(question?.choiceOptionImages)
    ? question.choiceOptionImages
    : [];
  const optionCount = Math.max(rawOptions.length, rawImages.length);

  return Array.from({ length: optionCount }, (_, index) => {
    const image = String(rawImages[index] || "").trim();
    const text =
      String(rawOptions[index] ?? "").trim() ||
      (image ? `${index + 1}번 보기` : "");
    return { text, image };
  }).filter((option) => option.text || option.image);
};

const CIRCLED_NUMBER_LABELS = [
  "①",
  "②",
  "③",
  "④",
  "⑤",
  "⑥",
  "⑦",
  "⑧",
  "⑨",
  "⑩",
];

const isReviewOptionAnswerMatch = (
  value: string,
  option: ReviewChoiceOption,
  index: number,
) => {
  const normalizedValue = normalizeAnswerText(value);
  if (!normalizedValue) return false;

  const optionNumber = String(index + 1);
  const candidates = [
    option.text,
    optionNumber,
    `${optionNumber}번`,
    `(${optionNumber})`,
    CIRCLED_NUMBER_LABELS[index] || "",
  ];

  return candidates.some(
    (candidate) => normalizeAnswerText(candidate) === normalizedValue,
  );
};

const getQuestionAnswerCandidates = (question: any) =>
  [
    question?.answer,
    ...(Array.isArray(question?.options) ? question.options : []),
  ].filter((item) => item !== undefined && item !== null);

const restoreAnswerSpacing = (value: unknown, question: any) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const normalizedRaw = normalizeAnswerText(raw);
  const matched = getQuestionAnswerCandidates(question).find(
    (candidate) => normalizeAnswerText(candidate) === normalizedRaw,
  );
  return formatQuizAnswerText(matched ?? raw);
};

const normalizeClassValue = (value: unknown): string => {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const digits = normalized.match(/\d+/)?.[0] || "";
  if (!digits) return normalized;
  const parsed = Number(digits);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return String(parsed);
};

const withSuffix = (label: string, suffix: string) => {
  if (!label) return "";
  return label.endsWith(suffix) ? label : `${label}${suffix}`;
};

const classifyBreakdownType = (
  name: string,
): "exam" | "performance" | "other" => {
  const key = String(name || "").toLowerCase();
  if (/정기|지필|중간|기말|시험|omr|서술|exam|midterm|final/.test(key))
    return "exam";
  if (
    /수행|과제|발표|실험|프로젝트|실습|performance|project|assignment/.test(key)
  )
    return "performance";
  return "other";
};

const normalizePlanItemType = (
  rawType: unknown,
  fallbackName: string,
): "exam" | "performance" | "other" => {
  const typeKey = String(rawType ?? "").toLowerCase();
  if (/정기|regular|exam|midterm|final|omr/.test(typeKey)) return "exam";
  if (/수행|performance|project|assignment/.test(typeKey)) return "performance";
  return classifyBreakdownType(fallbackName);
};

const getTypeLabel = (type: "exam" | "performance" | "other") => {
  if (type === "exam") return "정기시험";
  if (type === "performance") return "수행평가";
  return "기타";
};

const isThreeLevelSubject = (subject: string) =>
  /(음악|미술|체육|music|art|pe|physical)/i.test(String(subject || ""));

const getGradeBand = (
  score: number,
  subject: string,
): "A" | "B" | "C" | "D" | "E" => {
  const roundedScore = Math.round(score);

  if (isThreeLevelSubject(subject)) {
    if (roundedScore >= 80) return "A";
    if (roundedScore >= 60) return "B";
    return "C";
  }

  if (roundedScore >= 90) return "A";
  if (roundedScore >= 80) return "B";
  if (roundedScore >= 70) return "C";
  if (roundedScore >= 60) return "D";
  return "E";
};

const getBandTypeColor = (
  band: "A" | "B" | "C" | "D" | "E",
  type: "exam" | "performance" | "other",
) => {
  const palette: Record<
    "A" | "B" | "C" | "D" | "E",
    { exam: string; performance: string; other: string }
  > = {
    A: { exam: "#dc2626", performance: "#f87171", other: "#ef4444" },
    B: { exam: "#ea580c", performance: "#fb923c", other: "#f97316" },
    C: { exam: "#ca8a04", performance: "#facc15", other: "#eab308" },
    D: { exam: "#16a34a", performance: "#4ade80", other: "#22c55e" },
    E: { exam: "#2563eb", performance: "#60a5fa", other: "#3b82f6" },
  };
  return palette[band][type];
};

const MyPage: React.FC = () => {
  const { user, userData, config } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useAppToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedMenu = searchParams.get("menu");
  const requestedAttemptId =
    searchParams.get("attemptId") || searchParams.get("resultId") || "";
  const canUseLesson = config?.showLesson !== false;
  const canUseQuiz = config?.showQuiz !== false;
  const canUseScore = config?.showScore !== false;

  const [menu, setMenu] = useState<MainMenu>("profile");
  const [categoryTab, setCategoryTab] = useState<CategoryTab | "all">("all");
  const [selectedUnitId, setSelectedUnitId] = useState<string>("all");

  const [profile, setProfile] = useState<UserProfileDoc | null>(null);
  const [profileIcon, setProfileIcon] = useState("😀");
  const [iconModalOpen, setIconModalOpen] = useState(false);
  const [rankModalOpen, setRankModalOpen] = useState(false);
  const [savingIcon, setSavingIcon] = useState(false);
  const [openEmojiTierCodes, setOpenEmojiTierCodes] = useState<string[]>([]);
  const [pointPolicy, setPointPolicy] = useState<PointPolicy>(
    POINT_POLICY_FALLBACK,
  );
  const [pointWallet, setPointWallet] = useState<PointWallet | null>(null);
  const [rankManualAdjustPoints, setRankManualAdjustPoints] = useState(0);

  const [goalScore, setGoalScore] = useState("");
  const [subjectGoals, setSubjectGoals] = useState<Record<string, number>>({});
  const [selectedSubject, setSelectedSubject] = useState("");
  const [savingGoal, setSavingGoal] = useState(false);

  const [scoreRows, setScoreRows] = useState<ScoreRow[]>([]);
  const [scoreChartData, setScoreChartData] = useState<any>(null);
  const [performanceScores, setPerformanceScores] = useState<
    PerformanceScoreRecord[]
  >([]);
  const [performanceScoresLoading, setPerformanceScoresLoading] =
    useState(false);

  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>([]);
  const [mockExamPoints, setMockExamPoints] = useState<TrendPoint[]>([]);
  const [quizAttempts, setQuizAttempts] = useState<QuizAttemptReview[]>([]);
  const [selectedQuizAttempt, setSelectedQuizAttempt] =
    useState<QuizAttemptReview | null>(null);
  const [selectedReviewQuestionIndex, setSelectedReviewQuestionIndex] =
    useState(0);
  const [reviewSidebarOpen, setReviewSidebarOpen] = useState(false);
  const [quizLineData, setQuizLineData] = useState<any>(null);
  const [wrongItems, setWrongItems] = useState<WrongNoteItem[]>([]);
  const [expandedWrongKey, setExpandedWrongKey] = useState<string | null>(null);
  const [reviewGoalChecks, setReviewGoalChecks] = useState<
    Record<string, boolean>
  >({});
  const [loadingWrong, setLoadingWrong] = useState(false);
  const [progressSummary, setProgressSummary] =
    useState<StudentProgressSummary | null>(null);
  const [progressSummaryLoading, setProgressSummaryLoading] = useState(false);
  const [gradeLabelMap, setGradeLabelMap] = useState<Record<string, string>>(
    {},
  );
  const [classLabelMap, setClassLabelMap] = useState<Record<string, string>>(
    {},
  );

  const [unitTitleMap, setUnitTitleMap] = useState<Record<string, string>>({
    exam_prep: "모의고사",
  });
  const wrongNoteDefaultAppliedRef = useRef(false);

  useEffect(() => {
    if (!user || !config) return;
    wrongNoteDefaultAppliedRef.current = false;
    void loadMyPage();
  }, [user, config]);

  const isMenuAvailable = (nextMenu: MainMenu) => {
    if (nextMenu === "score") return canUseScore;
    if (nextMenu === "wrong_note") return canUseQuiz;
    return true;
  };

  const selectMenu = (nextMenu: MainMenu) => {
    const safeMenu = isMenuAvailable(nextMenu) ? nextMenu : "profile";
    setMenu(safeMenu);
    setSearchParams(safeMenu === "profile" ? {} : { menu: safeMenu });
  };

  const selectWrongNoteCategory = (nextCategory: CategoryTab | "all") => {
    setCategoryTab(nextCategory);
    setSelectedUnitId("all");
  };

  const closeQuizAttemptModal = () => {
    setSelectedQuizAttempt(null);
    setSelectedReviewQuestionIndex(0);
    setReviewSidebarOpen(false);
    if (!requestedAttemptId) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("attemptId");
    nextParams.delete("resultId");
    if (!nextParams.get("menu")) nextParams.set("menu", "wrong_note");
    setSearchParams(nextParams);
  };

  const openQuizAttemptReview = (attempt: QuizAttemptReview) => {
    setSelectedQuizAttempt(attempt);
    setSelectedReviewQuestionIndex(getInitialReviewIndex(attempt));
    setReviewSidebarOpen(false);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("menu", "wrong_note");
    nextParams.set("attemptId", attempt.key);
    nextParams.delete("resultId");
    setSearchParams(nextParams);
  };

  const applyDefaultWrongNoteScope = (attempts: QuizAttemptReview[]) => {
    if (wrongNoteDefaultAppliedRef.current || attempts.length === 0) return;
    const targetAttempt =
      (requestedAttemptId &&
        attempts.find((attempt) => attempt.key === requestedAttemptId)) ||
      attempts[0];
    const nextScope = getWrongNoteScopeFromAttempt(targetAttempt);
    setCategoryTab(nextScope.category);
    setSelectedUnitId(nextScope.unitId);
    wrongNoteDefaultAppliedRef.current = true;
  };

  useEffect(() => {
    if (
      requestedMenu === "profile" ||
      requestedMenu === "score" ||
      requestedMenu === "wrong_note"
    ) {
      setMenu(isMenuAvailable(requestedMenu) ? requestedMenu : "profile");
    } else if (!isMenuAvailable(menu)) {
      setMenu("profile");
    }
  }, [requestedMenu, canUseQuiz, canUseScore, menu]);

  useEffect(() => {
    if (!requestedAttemptId || menu !== "wrong_note") return;
    const attempt = quizAttempts.find(
      (item) => item.key === requestedAttemptId,
    );
    if (attempt) {
      setSelectedQuizAttempt(attempt);
      setSelectedReviewQuestionIndex(getInitialReviewIndex(attempt));
      setReviewSidebarOpen(false);
    }
  }, [requestedAttemptId, menu, quizAttempts]);

  const loadMyPage = async () => {
    if (!user || !config) return;
    const { titles, parents } = await loadUnitTitles();
    const quizResults: QuizResultSource = canUseQuiz
      ? loadStudentQuizResults(config, user.uid)
      : [];
    await Promise.all([
      loadProfileAndEmoji(),
      loadPointRankState(),
      canUseScore ? loadScoreData() : resetScoreData(),
      canUseScore ? loadPerformanceScoreData() : resetPerformanceScoreData(),
      canUseQuiz ? loadQuizData(titles, parents, quizResults) : resetQuizData(),
      loadProgressSummary(quizResults),
    ]);
  };

  const resetScoreData = async () => {
    setScoreRows([]);
    setScoreChartData(null);
  };

  const resetPerformanceScoreData = async () => {
    setPerformanceScores([]);
    setPerformanceScoresLoading(false);
  };

  const resetQuizData = async () => {
    setTrendPoints([]);
    setMockExamPoints([]);
    setQuizAttempts([]);
    setSelectedQuizAttempt(null);
    setSelectedReviewQuestionIndex(0);
    setReviewSidebarOpen(false);
    setQuizLineData(null);
    setWrongItems([]);
    setExpandedWrongKey(null);
    setLoadingWrong(false);
  };

  const loadProgressSummary = async (quizResults?: QuizResultSource) => {
    if (!user || !config) return;
    setProgressSummaryLoading(true);
    try {
      const preloadedQuizResults = quizResults ? await quizResults : undefined;
      setProgressSummary(
        await loadStudentProgressSummary(config, user.uid, {
          preloadedQuizResults,
        }),
      );
    } finally {
      setProgressSummaryLoading(false);
    }
  };

  const loadProfileAndEmoji = async () => {
    if (!user) return;

    const [userSnap, schoolSnap] = await Promise.all([
      getDoc(doc(db, "users", user.uid)),
      getDoc(doc(db, "site_settings", "school_config")),
    ]);

    if (userSnap.exists()) {
      const data = userSnap.data() as UserProfileDoc;
      setProfile(data);
      setProfileIcon(data.profileIcon || getDefaultProfileEmojiValue());
      setGoalScore(data.myPageGoalScore || "");
      setSubjectGoals(data.myPageSubjectGoals || {});
    } else {
      setProfile(null);
      setProfileIcon(getDefaultProfileEmojiValue());
      setGoalScore("");
      setSubjectGoals({});
    }

    if (schoolSnap.exists()) {
      const data = schoolSnap.data() as {
        grades?: Array<{ value?: string; label?: string }>;
        classes?: Array<{ value?: string; label?: string }>;
      };
      const nextGradeMap: Record<string, string> = {};
      const nextClassMap: Record<string, string> = {};
      (data.grades || []).forEach((item) => {
        const value = String(item?.value ?? "").trim();
        const label = String(item?.label ?? "").trim();
        if (value && label) nextGradeMap[value] = label;
      });
      (data.classes || []).forEach((item) => {
        const value = String(item?.value ?? "").trim();
        const label = String(item?.label ?? "").trim();
        if (value && label) nextClassMap[value] = label;
      });
      setGradeLabelMap(nextGradeMap);
      setClassLabelMap(nextClassMap);
    } else {
      setGradeLabelMap({});
      setClassLabelMap({});
    }
  };

  const loadPointRankState = async () => {
    if (!user || !config) return;

    const [nextWallet, nextPolicy] = await Promise.all([
      getPointWalletByUid(config, user.uid),
      getPointPolicy(config),
    ]);
    const nextRankManualAdjustPoints =
      nextWallet && needsPointRankLegacyFallback(nextWallet)
        ? await getPointRankManualAdjustEarnedPointsByUid(config, user.uid)
        : 0;

    setPointWallet(nextWallet);
    setPointPolicy(nextPolicy);
    setRankManualAdjustPoints(nextRankManualAdjustPoints);
  };

  useEffect(() => {
    if (!user || !config) return undefined;
    return subscribePointsUpdated(() => {
      void loadPointRankState();
    });
  }, [user?.uid, config?.year, config?.semester]);

  const loadUnitTitles = async () => {
    if (!config) {
      return {
        titles: { exam_prep: "모의고사" },
        parents: {} as Record<string, UnitParentMeta>,
      };
    }

    let treeSnap = await getDoc(
      doc(db, getSemesterCollectionPath(config, "curriculum"), "tree"),
    );
    if (!treeSnap.exists()) {
      treeSnap = await getDoc(doc(db, "curriculum", "tree"));
    }

    const map: Record<string, string> = { exam_prep: "모의고사" };
    const parentMap: Record<string, UnitParentMeta> = {};
    const rememberTitle = (id: unknown, title: unknown) => {
      const titleText = String(title || "").trim();
      if (!titleText) return;
      const idText = String(id || "").trim();
      if (idText) {
        map[idText] = titleText;
      }
      map[titleText] = titleText;
    };
    const rememberParent = (
      id: unknown,
      title: unknown,
      meta: UnitParentMeta,
    ) => {
      const idText = String(id || "").trim();
      if (idText) {
        parentMap[idText] = meta;
      }
      const titleText = String(title || "").trim();
      if (titleText) {
        parentMap[titleText] = meta;
      }
    };
    if (treeSnap.exists()) {
      const tree = treeSnap.data().tree || [];
      tree.forEach((big: any) => {
        rememberTitle(big?.id, big?.title);
        (big.children || []).forEach((mid: any) => {
          const midMeta = {
            bigId: String(big.id || ""),
            bigTitle: String(big.title || ""),
            midId: String(mid.id || ""),
            midTitle: String(mid.title || ""),
          };
          rememberTitle(mid?.id, mid?.title);
          rememberParent(mid?.id, mid?.title, midMeta);
          (mid.children || []).forEach((small: any) => {
            const smallMeta = {
              ...midMeta,
              smallId: String(small.id || ""),
              smallTitle: String(small.title || ""),
            };
            rememberTitle(small?.id, small?.title);
            rememberParent(small?.id, small?.title, smallMeta);
          });
        });
      });
    }

    setUnitTitleMap(map);
    return { titles: map, parents: parentMap };
  };

  const loadScoreData = async () => {
    if (!user || !config) return;

    const year = config.year || "2026";
    const semester = config.semester || "1";
    const scoreDocId = `${year}_${semester}`;

    const scoreSnap = await getDoc(
      doc(db, "users", user.uid, "academic_records", scoreDocId),
    );
    const scoreMap = scoreSnap.exists() ? scoreSnap.data().scores || {} : {};
    let targetGrade = normalizeClassValue(userData?.grade ?? profile?.grade);
    if (!targetGrade) {
      const userSnap = await getDoc(doc(db, "users", user.uid));
      if (userSnap.exists()) {
        targetGrade = normalizeClassValue(
          (userSnap.data() as UserProfileDoc).grade,
        );
      }
    }

    const plansSnap = await getDocs(
      collection(db, getSemesterCollectionPath(config, "grading_plans")),
    );

    const plans: GradingPlanLike[] = [];
    plansSnap.forEach((planDoc) => {
      plans.push({
        id: planDoc.id,
        ...planDoc.data(),
      });
    });

    const rows = buildSharedScoreRows(plans, scoreMap, {
      year: String(year),
      semester: String(semester),
      grade: targetGrade,
      filterByGrade: true,
      sortMode: "importance",
    });

    setScoreRows(rows);
    setScoreChartData(
      rows.length
        ? {
            labels: rows.map((row) => row.subject),
            datasets: [
              {
                label: "환산 점수",
                data: rows.map((row) => row.total),
                backgroundColor: "rgba(37, 99, 235, 0.65)",
                borderColor: "rgba(29, 78, 216, 1)",
                borderWidth: 1,
                borderRadius: 6,
              },
            ],
          }
        : null,
    );
  };

  const loadPerformanceScoreData = async () => {
    if (!user || !config) return;
    setPerformanceScoresLoading(true);
    try {
      const year = String(config.year || "2026");
      const semester = String(config.semester || "1");
      setPerformanceScores(
        await loadUserPerformanceScoreRecords(user.uid, { year, semester }),
      );
    } catch (error) {
      console.error("Failed to load my performance scores:", error);
      setPerformanceScores([]);
    } finally {
      setPerformanceScoresLoading(false);
    }
  };

  const loadQuizData = async (
    titleMap: Record<string, string>,
    parentMap: Record<string, UnitParentMeta>,
    preloadedQuizResults?: QuizResultSource,
  ) => {
    if (!user || !config) return;
    setLoadingWrong(true);

    try {
      const results = (
        preloadedQuizResults === undefined
          ? await loadStudentQuizResults(config, user.uid)
          : await preloadedQuizResults
      ).slice();
      results.sort(
        (a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0),
      );

      const latest = results.slice(0, 12).reverse();
      const points: TrendPoint[] = latest.map((result, idx) => {
        const unitId = result.unitId || "unknown";
        const category = normalizeMockExamCategory(
          result.category || "other",
        ) as CategoryTab | "other";
        const unitTitle =
          unitId === "exam_prep"
            ? "모의고사"
            : titleMap[unitId] || "단원명 없음";
        return {
          label: `${idx + 1}회 · ${unitTitle} · ${getCategoryShort(category)}`,
          unitId,
          category,
          score: Number(result.score || 0),
          wrongCount: (result.details || []).filter((detail) => !detail.correct)
            .length,
          dateText: formatResultDate(result),
        };
      });
      setTrendPoints(points);

      setQuizLineData(
        points.length
          ? {
              labels: points.map((point) => point.label),
              datasets: [
                {
                  label: "점수",
                  data: points.map((point) => point.score),
                  borderColor: "#059669",
                  backgroundColor: "rgba(16, 185, 129, 0.15)",
                  fill: true,
                  tension: 0.3,
                  pointRadius: 4,
                },
              ],
            }
          : null,
      );

      const wrongLogs: Array<{
        qid: string;
        userAnswer: string;
        unitId: string;
        category: CategoryTab | "other";
        dateText: string;
        correct?: boolean;
        questionNumber?: number;
      }> = [];

      results.forEach((result) => {
        (result.details || []).forEach((detail) => {
          if (detail.correct) return;
          wrongLogs.push({
            qid: String(detail.id),
            userAnswer: detail.displayU || detail.u || "",
            unitId: result.unitId || "unknown",
            category: normalizeMockExamCategory(result.category || "other") as
              | CategoryTab
              | "other",
            dateText: formatResultDate(result),
            correct: false,
          });
        });
      });

      const quizDetailLogs = results.flatMap((result) => {
        const dateText = formatResultDate(result);
        const category = normalizeMockExamCategory(
          result.category || "other",
        ) as CategoryTab | "other";
        return (result.details || []).map((detail, detailIndex) => ({
          resultId: result.id,
          qid: String(detail.id),
          userAnswer: detail.displayU || detail.u || "",
          unitId: result.unitId || "unknown",
          category,
          dateText,
          correct: detail.correct === true,
          questionNumber: detailIndex + 1,
        }));
      });

      const questionMap: Record<string, any> = {};
      const questionIds = Array.from(
        new Set([
          ...wrongLogs.map((log) => log.qid),
          ...quizDetailLogs.map((log) => log.qid),
        ]),
      );

      if (questionIds.length > 0) {
        await Promise.all(
          chunk(questionIds, 10).map(async (ids) => {
            const scopedSnap = await getDocs(
              query(
                collection(
                  db,
                  getSemesterCollectionPath(config, "quiz_questions"),
                ),
                where(documentId(), "in", ids),
              ),
            );
            scopedSnap.forEach((questionDoc) => {
              questionMap[questionDoc.id] = questionDoc.data();
            });
          }),
        );
      }

      const buildWrongNoteItem = (
        log: {
          qid: string;
          userAnswer: string;
          unitId: string;
          category: CategoryTab | "other";
          dateText: string;
          correct?: boolean;
          questionNumber?: number;
        },
        key: string,
      ): WrongNoteItem => {
        const question = questionMap[log.qid] || {};
        const smallUnitId = String(
          question.refSmall || question.subUnitId || "",
        ).trim();
        const sourceUnitId = String(
          question.refMid || question.unitId || log.unitId || "",
        ).trim();
        const smallUnitMeta = smallUnitId ? parentMap[smallUnitId] : null;
        const parentMeta =
          smallUnitMeta ||
          (sourceUnitId && parentMap[sourceUnitId]) ||
          (log.unitId && parentMap[log.unitId]) ||
          null;
        const bigUnitId = String(
          question.refBig || parentMeta?.bigId || "",
        ).trim();
        const midUnitId = String(
          question.refMid ||
            parentMeta?.midId ||
            question.unitId ||
            log.unitId ||
            "",
        ).trim();
        const bigUnitTitle = bigUnitId
          ? titleMap[bigUnitId] || parentMeta?.bigTitle || bigUnitId
          : parentMeta?.bigTitle || "";
        const midUnitTitle = midUnitId
          ? titleMap[midUnitId] ||
            parentMeta?.midTitle ||
            (midUnitId === "exam_prep" ? "모의고사" : midUnitId)
          : parentMeta?.midTitle || "";
        const smallUnitTitle = smallUnitId
          ? titleMap[smallUnitId] || parentMeta?.smallTitle || smallUnitId
          : parentMeta?.smallTitle || "";
        const hierarchyLabel = buildHierarchyLabel(
          bigUnitTitle,
          midUnitTitle,
          smallUnitTitle,
        );
        const questionType = String(
          question.type ||
            (Array.isArray(question.options) && question.options.length > 0
              ? "choice"
              : ""),
        ).trim();

        return {
          key,
          questionNumber: log.questionNumber || 0,
          type: questionType,
          question: String(question.question || "문항 텍스트 없음"),
          passage: String(question.passage || ""),
          image: String(question.image || ""),
          options: getReviewChoiceOptions({ ...question, type: questionType }),
          answer:
            question.answer !== undefined && question.answer !== null
              ? restoreAnswerSpacing(question.answer, question)
              : "-",
          explanation: String(
            question.explanation || "해설이 등록되지 않았습니다.",
          ),
          userAnswer: restoreAnswerSpacing(log.userAnswer, question),
          correct: log.correct === true,
          unitId: log.unitId,
          unitTitle:
            log.unitId === "exam_prep"
              ? "모의고사"
              : titleMap[log.unitId] || "단원명 없음",
          bigUnitId,
          bigUnitTitle,
          midUnitId,
          midUnitTitle,
          smallUnitId,
          smallUnitTitle,
          hierarchyLabel,
          category: log.category,
          categoryLabel: getCategoryLabel(log.category),
          dateText: log.dateText,
        };
      };

      const seen = new Set<string>();
      const nextWrongItems: WrongNoteItem[] = [];

      wrongLogs.forEach((log) => {
        const key = `${log.qid}_${log.unitId}_${log.category}`;
        if (seen.has(key)) return;
        seen.add(key);

        nextWrongItems.push(buildWrongNoteItem(log, key));
      });

      const nextQuizAttempts: QuizAttemptReview[] = results.map(
        (result, resultIndex) => {
          const dateText = formatResultDate(result);
          const category = normalizeMockExamCategory(
            result.category || "other",
          ) as CategoryTab | "other";
          const isMockAttempt =
            isMockExamCategory(result.category) ||
            result.unitId === "exam_prep";
          const unitId = result.unitId || (isMockAttempt ? "exam_prep" : "");
          const unitTitle = isMockAttempt
            ? "모의고사"
            : titleMap[unitId] || "단원명 없음";
          const round = getResultMockExamRound(
            result.category || "exam_prep",
            (result as QuizResultDoc & { examRound?: string }).examRound,
          );
          const roundLabel = isMockAttempt
            ? formatMockExamRoundLabel(round || "round_1")
            : `${unitTitle} ${getCategoryShort(category)}`;
          const categoryLabel = getCategoryLabel(category);
          const allItemsForAttempt = quizDetailLogs
            .filter((log) => log.resultId === result.id)
            .map((log, detailIndex) =>
              buildWrongNoteItem(log, `${result.id}_${log.qid}_${detailIndex}`),
            );
          const wrongItemsForAttempt = allItemsForAttempt.filter(
            (item) => !item.correct,
          );
          const firstAttemptItem = allItemsForAttempt[0] || null;
          const primaryAttemptItem =
            wrongItemsForAttempt[0] || firstAttemptItem;
          const attemptParentMeta = unitId ? parentMap[unitId] : null;
          const bigUnitId = isMockAttempt
            ? "exam_prep"
            : firstAttemptItem?.bigUnitId || attemptParentMeta?.bigId || "";
          const bigUnitTitle = isMockAttempt
            ? "모의고사"
            : firstAttemptItem?.bigUnitTitle ||
              attemptParentMeta?.bigTitle ||
              (bigUnitId ? titleMap[bigUnitId] || bigUnitId : "대단원 미지정");
          const midUnitId = isMockAttempt
            ? roundLabel
            : firstAttemptItem?.midUnitId || attemptParentMeta?.midId || unitId;
          const midUnitTitle = isMockAttempt
            ? roundLabel
            : firstAttemptItem?.midUnitTitle ||
              attemptParentMeta?.midTitle ||
              unitTitle;
          const smallUnitId = isMockAttempt
            ? ""
            : primaryAttemptItem?.smallUnitId || "";
          const smallUnitTitle = isMockAttempt
            ? ""
            : primaryAttemptItem?.smallUnitTitle || "";

          return {
            key: result.id || `${roundLabel}_${dateText}_${resultIndex}`,
            roundLabel,
            title: isMockAttempt ? `${roundLabel} 응시 내역` : unitTitle,
            unitId,
            unitTitle,
            bigUnitId,
            bigUnitTitle,
            midUnitId,
            midUnitTitle,
            smallUnitId,
            smallUnitTitle,
            category,
            categoryLabel,
            groupLabel: isMockAttempt ? roundLabel : unitTitle,
            score: Number(result.score || 0),
            wrongCount: wrongItemsForAttempt.length,
            dateText,
            allItems: allItemsForAttempt,
            wrongItems: wrongItemsForAttempt,
          };
        },
      );

      setQuizAttempts(nextQuizAttempts);
      applyDefaultWrongNoteScope(nextQuizAttempts);
      setMockExamPoints(
        nextQuizAttempts
          .filter((attempt) => attempt.category === "exam_prep")
          .map((attempt) => ({
            label: attempt.roundLabel,
            unitId: "exam_prep",
            category: "exam_prep",
            score: attempt.score,
            wrongCount: attempt.wrongCount,
            dateText: attempt.dateText,
          })),
      );
      setWrongItems(nextWrongItems);
      setLoadingWrong(false);
    } catch (error) {
      console.error("Failed to load my quiz and wrong note data:", error);
      setTrendPoints([]);
      setMockExamPoints([]);
      setQuizAttempts([]);
      setSelectedQuizAttempt(null);
      setSelectedReviewQuestionIndex(0);
      setReviewSidebarOpen(false);
      setQuizLineData(null);
      setWrongItems([]);
    } finally {
      setLoadingWrong(false);
    }
  };

  const orderedEmojiEntries = useMemo(
    () => getPointRankEmojiRegistry(pointPolicy.rankPolicy),
    [pointPolicy.rankPolicy],
  );
  const safePointWallet = pointWallet || DEFAULT_POINT_WALLET;
  const currentRank = getPointRankDisplay({
    rankPolicy: pointPolicy.rankPolicy,
    wallet: safePointWallet,
    earnedPointsFromTransactions: rankManualAdjustPoints,
  });
  const allowedEmojiIds = useMemo(
    () =>
      getPointRankAllowedEmojiIds(
        pointPolicy.rankPolicy,
        currentRank?.tierCode || null,
      ),
    [currentRank?.tierCode, pointPolicy.rankPolicy],
  );
  const storedProfileEmojiId = String(
    profile?.profileEmojiId || userData?.profileEmojiId || "",
  ).trim();
  const selectedEmojiEntry = storedProfileEmojiId
    ? getPointRankEmojiEntryById(pointPolicy.rankPolicy, storedProfileEmojiId)
    : getPointRankEmojiEntryByValue(pointPolicy.rankPolicy, profileIcon);
  const selectedEmojiAllowed = selectedEmojiEntry
    ? selectedEmojiEntry.enabled !== false &&
      allowedEmojiIds.includes(selectedEmojiEntry.id)
    : false;
  const hasLegacySelectedEmoji = Boolean(profileIcon) && !selectedEmojiEntry;
  const defaultProfileEmojiValue =
    getPointRankDefaultEmojiValue(pointPolicy.rankPolicy) ||
    getDefaultProfileEmojiValue();
  const displayProfileIcon =
    selectedEmojiEntry?.emoji || profileIcon || defaultProfileEmojiValue;
  const emojiCards = useMemo(
    () =>
      orderedEmojiEntries.map((entry) => {
        const unlockTierCode =
          getPointRankUnlockTierCodeForEmoji(
            pointPolicy.rankPolicy,
            entry.id,
          ) ||
          pointPolicy.rankPolicy.tiers[0]?.code ||
          "tier_1";
        return {
          entry,
          unlockTierCode,
          unlockTierLabel: getPointRankTierMeta(
            pointPolicy.rankPolicy,
            pointPolicy.rankPolicy.activeThemeId,
            unlockTierCode,
          ).label,
          unlocked: allowedEmojiIds.includes(entry.id),
          selected: selectedEmojiEntry?.id === entry.id,
        };
      }),
    [
      allowedEmojiIds,
      orderedEmojiEntries,
      pointPolicy.rankPolicy,
      selectedEmojiEntry?.id,
    ],
  );
  const rankGuideItems = useMemo(
    () =>
      getPointRankTierDisplayItems(pointPolicy.rankPolicy, {
        descending: true,
      }).map((item) => ({
        ...item,
        isCurrent: currentRank?.tierCode === item.code,
      })),
    [currentRank?.tierCode, pointPolicy.rankPolicy],
  );
  const ascendingRankGuideItems = useMemo(
    () => [...rankGuideItems].reverse(),
    [rankGuideItems],
  );
  const currentRankIndex = ascendingRankGuideItems.findIndex(
    (item) => item.code === currentRank?.tierCode,
  );
  const nextRankGuideItem =
    currentRankIndex >= 0
      ? ascendingRankGuideItems[currentRankIndex + 1] || null
      : ascendingRankGuideItems[0] || null;
  const nextRankGap = nextRankGuideItem
    ? Math.max(
        0,
        Number(nextRankGuideItem.minPoints || 0) -
          Number(currentRank?.metricValue || 0),
      )
    : 0;
  const emojiGroups = useMemo(
    () =>
      rankGuideItems.map((item) => ({
        ...item,
        entries: emojiCards.filter((card) => card.unlockTierCode === item.code),
      })),
    [emojiCards, rankGuideItems],
  );

  useEffect(() => {
    const storedProfileIcon = String(
      profile?.profileIcon || userData?.profileIcon || "",
    ).trim();
    if (storedProfileIcon) {
      setProfileIcon(storedProfileIcon);
      return;
    }
    if (selectedEmojiEntry?.emoji) {
      setProfileIcon(selectedEmojiEntry.emoji);
      return;
    }
    setProfileIcon(defaultProfileEmojiValue);
  }, [
    defaultProfileEmojiValue,
    profile?.profileIcon,
    selectedEmojiEntry?.emoji,
    userData?.profileIcon,
  ]);

  useEffect(() => {
    if (!iconModalOpen) return;
    const defaultTierCode = currentRank?.tierCode || emojiGroups[0]?.code || "";
    setOpenEmojiTierCodes(defaultTierCode ? [defaultTierCode] : []);
  }, [currentRank?.tierCode, emojiGroups, iconModalOpen]);

  const saveGoal = async () => {
    if (!user) return;
    setSavingGoal(true);
    try {
      const nextGoalScore = goalScore.trim();
      await setDoc(
        doc(db, "users", user.uid),
        {
          myPageGoalScore: nextGoalScore,
          myPageSubjectGoals: subjectGoals,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setProfile((prev) => ({
        ...(prev || {}),
        myPageGoalScore: nextGoalScore,
        myPageSubjectGoals: subjectGoals,
      }));
      showToast({
        tone: "success",
        title: "목표를 저장했습니다.",
      });
    } catch (error) {
      console.error("Failed to save my page goal:", error);
      showToast({
        tone: "error",
        title: "목표 저장에 실패했습니다.",
        description: "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setSavingGoal(false);
    }
  };

  const saveProfileIcon = async (nextEmojiId: string) => {
    if (!user || !config) return;
    setSavingIcon(true);
    try {
      const result = await updateStudentProfileIcon({
        config,
        emojiId: nextEmojiId,
      });
      setProfileIcon(result.profileIcon);
      setProfile((prev) => ({
        ...(prev || {}),
        profileEmojiId: result.emojiId || nextEmojiId,
        profileIcon: result.profileIcon,
      }));
      setIconModalOpen(false);
    } catch (error) {
      console.error("Failed to update profile icon:", error);
      alert("현재 등급에서 선택할 수 없는 아이콘입니다.");
    } finally {
      setSavingIcon(false);
    }
  };

  const toggleEmojiTierGroup = (tierCode: string) => {
    setOpenEmojiTierCodes((prev) =>
      prev.includes(tierCode)
        ? prev.filter((code) => code !== tierCode)
        : [...prev, tierCode],
    );
  };

  const filteredWrongItems = useMemo(
    () =>
      wrongItems.filter(
        (item) =>
          (categoryTab === "all" || item.category === categoryTab) &&
          wrongNoteItemMatchesSelectedUnit(item, selectedUnitId),
      ),
    [wrongItems, categoryTab, selectedUnitId],
  );

  const wrongGroupEntries = useMemo(() => {
    const grouped: Record<string, WrongNoteItem[]> = {};
    filteredWrongItems.forEach((item) => {
      const key = `${getWrongNoteItemScopeId(item)}_${item.category}`;
      grouped[key] = grouped[key] || [];
      grouped[key].push(item);
    });
    return Object.entries(grouped);
  }, [filteredWrongItems]);

  const scoreSummaryByUnit = useMemo(() => {
    const grouped: Record<
      string,
      { unitId: string; unitTitle: string; category: string; scores: number[] }
    > = {};
    trendPoints.forEach((point) => {
      const key = `${point.unitId}_${point.category}`;
      if (!grouped[key]) {
        grouped[key] = {
          unitId: point.unitId,
          unitTitle:
            point.unitId === "exam_prep"
              ? "모의고사"
              : unitTitleMap[point.unitId] || "단원명 없음",
          category: point.category,
          scores: [],
        };
      }
      grouped[key].scores.push(point.score);
    });

    return Object.values(grouped).map((group) => ({
      ...group,
      average: Number(
        (
          group.scores.reduce((acc, cur) => acc + cur, 0) /
          Math.max(group.scores.length, 1)
        ).toFixed(1),
      ),
      count: group.scores.length,
    }));
  }, [trendPoints, unitTitleMap]);

  const availableUnitTabs = useMemo(() => {
    if (categoryTab === "exam_prep") {
      const rounds = new Map<string, string>();
      quizAttempts
        .filter((attempt) => attempt.category === "exam_prep")
        .forEach((attempt) => {
          const label = attempt.roundLabel || "모의고사";
          rounds.set(label, getMockRoundScopeId(label));
        });
      return Array.from(rounds.entries()).map(([title, id]) => ({
        id,
        title,
      }));
    }

    if (isSmallUnitAssessmentCategory(categoryTab)) {
      const source = new Map<string, string>();
      const addItem = (item: WrongNoteItem) => {
        if (item.category !== categoryTab) return;
        const id = getWrongNoteItemScopeId(item);
        if (!id) return;
        source.set(
          id,
          getWrongNoteItemScopeTitle(item) || unitTitleMap[id] || id,
        );
      };
      const addAttemptFallback = (attempt: QuizAttemptReview) => {
        if (attempt.category !== categoryTab || attempt.allItems.length) return;
        const id = attempt.smallUnitId || attempt.midUnitId || attempt.unitId;
        if (!id) return;
        source.set(
          id,
          attempt.smallUnitTitle ||
            attempt.midUnitTitle ||
            attempt.unitTitle ||
            unitTitleMap[id] ||
            id,
        );
      };

      quizAttempts.forEach((attempt) => {
        if (attempt.category !== categoryTab) return;
        attempt.allItems.forEach(addItem);
        addAttemptFallback(attempt);
      });
      wrongItems.forEach(addItem);

      return Array.from(source.entries()).map(([id, title]) => ({
        id,
        title: title || unitTitleMap[id] || "소단원 미지정",
      }));
    }

    const source = new Map<string, string>();
    quizAttempts.forEach((attempt) => {
      if (categoryTab !== "all" && attempt.category !== categoryTab) return;
      if (attempt.category === "exam_prep") {
        if (categoryTab === "all") source.set("exam_prep", "모의고사");
        return;
      }
      const bigId = attempt.bigUnitId || attempt.unitId;
      const bigTitle =
        attempt.bigUnitTitle ||
        attempt.unitTitle ||
        unitTitleMap[bigId] ||
        bigId;
      if (bigId) {
        source.set(bigId, bigTitle);
      }
    });
    wrongItems.forEach((item) => {
      if (categoryTab !== "all" && item.category !== categoryTab) return;
      if (item.category === "exam_prep") {
        if (categoryTab === "all") source.set("exam_prep", "모의고사");
        return;
      }
      const bigId = item.bigUnitId || item.unitId;
      const bigTitle =
        item.bigUnitTitle || item.unitTitle || unitTitleMap[bigId] || bigId;
      if (bigId) {
        source.set(bigId, bigTitle);
      }
    });

    return Array.from(source.entries()).map(([unitId, title]) => ({
      id: unitId,
      title:
        unitId === "exam_prep"
          ? "모의고사"
          : title || unitTitleMap[unitId] || "단원명 없음",
    }));
  }, [wrongItems, quizAttempts, unitTitleMap, categoryTab]);

  const filteredQuizAttempts = useMemo(
    () =>
      quizAttempts.filter((attempt) => {
        if (categoryTab !== "all" && attempt.category !== categoryTab) {
          return false;
        }
        if (selectedUnitId === "all") return true;
        const selectedRoundLabel = getMockRoundLabelFromScope(selectedUnitId);
        if (selectedRoundLabel) {
          return (
            attempt.category === "exam_prep" &&
            attempt.roundLabel === selectedRoundLabel
          );
        }
        if (selectedUnitId === "exam_prep") {
          return attempt.category === "exam_prep";
        }
        return quizAttemptMatchesSelectedUnit(attempt, selectedUnitId);
      }),
    [quizAttempts, categoryTab, selectedUnitId],
  );

  const quizAttemptHierarchy = useMemo(() => {
    const sections: Array<{
      key: string;
      label: string;
      count: number;
      wrongCount: number;
      groups: Array<{
        key: string;
        label: string;
        subLabel: string;
        attempts: QuizAttemptReview[];
        wrongCount: number;
        totalCount: number;
      }>;
    }> = [];
    const selectedRoundLabel = getMockRoundLabelFromScope(selectedUnitId);
    const shouldGroupByMidUnit =
      categoryTab !== "exam_prep" &&
      selectedUnitId !== "all" &&
      selectedUnitId !== "exam_prep" &&
      !selectedRoundLabel;
    const categoryOrder: Array<CategoryTab | "other"> = [
      ...CATEGORY_LABELS.map((tab) => tab.key),
      "other",
    ];

    if (categoryTab !== "exam_prep" && selectedUnitId === "all") {
      const groupedByBig = new Map<string, QuizAttemptReview[]>();

      filteredQuizAttempts.forEach((attempt) => {
        const bigKey =
          attempt.category === "exam_prep"
            ? "exam_prep"
            : attempt.bigUnitId ||
              attempt.bigUnitTitle ||
              attempt.unitId ||
              "unknown-big";
        groupedByBig.set(bigKey, [
          ...(groupedByBig.get(bigKey) || []),
          attempt,
        ]);
      });

      return Array.from(groupedByBig.entries()).map(([bigKey, attempts]) => {
        const firstAttempt = attempts[0];
        const grouped = new Map<
          string,
          { label: string; attempts: QuizAttemptReview[] }
        >();

        attempts.forEach((attempt) => {
          const midLabel =
            attempt.category === "exam_prep"
              ? attempt.roundLabel || "모의고사"
              : attempt.midUnitTitle || attempt.unitTitle || attempt.groupLabel;
          const groupKey =
            categoryTab === "all"
              ? `${attempt.category}_${midLabel}`
              : midLabel;
          const groupLabel =
            categoryTab === "all" && attempt.category !== "exam_prep"
              ? `${getCategoryLabel(attempt.category)} · ${midLabel}`
              : midLabel;
          const existing = grouped.get(groupKey) || {
            label: groupLabel,
            attempts: [],
          };
          existing.attempts.push(attempt);
          grouped.set(groupKey, existing);
        });

        return {
          key: `big_${bigKey}`,
          label:
            firstAttempt?.category === "exam_prep"
              ? "모의고사"
              : firstAttempt?.bigUnitTitle ||
                firstAttempt?.unitTitle ||
                "대단원 미지정",
          count: attempts.length,
          wrongCount: attempts.reduce(
            (sum, attempt) => sum + attempt.wrongCount,
            0,
          ),
          groups: Array.from(grouped.entries()).map(([groupKey, group]) => ({
            key: `${bigKey}_${groupKey}`,
            label: group.label,
            subLabel: "",
            attempts: group.attempts,
            wrongCount: group.attempts.reduce(
              (sum, attempt) => sum + attempt.wrongCount,
              0,
            ),
            totalCount: group.attempts.reduce(
              (sum, attempt) => sum + attempt.allItems.length,
              0,
            ),
          })),
        };
      });
    }

    if (shouldGroupByMidUnit) {
      const groupedByMid = new Map<string, QuizAttemptReview[]>();

      filteredQuizAttempts.forEach((attempt) => {
        if (attempt.category === "exam_prep") return;
        const midKey =
          attempt.midUnitId ||
          attempt.unitId ||
          attempt.groupLabel ||
          attempt.unitTitle;
        groupedByMid.set(midKey, [
          ...(groupedByMid.get(midKey) || []),
          attempt,
        ]);
      });

      return Array.from(groupedByMid.entries()).map(([midKey, attempts]) => {
        const firstAttempt = attempts[0];
        const groupedByCategory = new Map<
          CategoryTab | "other",
          QuizAttemptReview[]
        >();

        attempts.forEach((attempt) => {
          groupedByCategory.set(attempt.category, [
            ...(groupedByCategory.get(attempt.category) || []),
            attempt,
          ]);
        });

        return {
          key: `mid_${midKey}`,
          label:
            firstAttempt?.midUnitTitle || firstAttempt?.unitTitle || midKey,
          count: attempts.length,
          wrongCount: attempts.reduce(
            (sum, attempt) => sum + attempt.wrongCount,
            0,
          ),
          groups: categoryOrder
            .filter((category) => groupedByCategory.has(category))
            .map((category) => {
              const categoryAttempts = groupedByCategory.get(category) || [];
              return {
                key: `${midKey}_${category}`,
                label: getCategoryLabel(category),
                subLabel: `${categoryAttempts.length}회 응시 기록`,
                attempts: categoryAttempts,
                wrongCount: categoryAttempts.reduce(
                  (sum, attempt) => sum + attempt.wrongCount,
                  0,
                ),
                totalCount: categoryAttempts.reduce(
                  (sum, attempt) => sum + attempt.allItems.length,
                  0,
                ),
              };
            }),
        };
      });
    }

    categoryOrder.forEach((category) => {
      const categoryAttempts = filteredQuizAttempts.filter(
        (attempt) => attempt.category === category,
      );
      if (categoryAttempts.length === 0) return;

      const grouped = new Map<string, QuizAttemptReview[]>();
      categoryAttempts.forEach((attempt) => {
        const groupKey =
          category === "exam_prep"
            ? attempt.roundLabel || "모의고사"
            : attempt.midUnitId ||
              attempt.unitId ||
              attempt.groupLabel ||
              attempt.unitTitle;
        grouped.set(groupKey, [...(grouped.get(groupKey) || []), attempt]);
      });

      sections.push({
        key: category,
        label: getCategoryLabel(category),
        count: categoryAttempts.length,
        wrongCount: categoryAttempts.reduce(
          (sum, attempt) => sum + attempt.wrongCount,
          0,
        ),
        groups: Array.from(grouped.entries()).map(([groupKey, attempts]) => {
          const firstAttempt = attempts[0];
          return {
            key: `${category}_${groupKey}`,
            label:
              category === "exam_prep"
                ? groupKey
                : firstAttempt?.midUnitTitle ||
                  firstAttempt?.unitTitle ||
                  groupKey,
            subLabel:
              category === "exam_prep"
                ? "같은 회차의 응시 기록"
                : `${firstAttempt?.categoryLabel || getCategoryLabel(category)} 응시 기록`,
            attempts,
            wrongCount: attempts.reduce(
              (sum, attempt) => sum + attempt.wrongCount,
              0,
            ),
            totalCount: attempts.reduce(
              (sum, attempt) => sum + attempt.allItems.length,
              0,
            ),
          };
        }),
      });
    });

    return sections;
  }, [filteredQuizAttempts, categoryTab, selectedUnitId]);

  const subjectInsights = useMemo<SubjectScoreInsight[]>(() => {
    return buildSharedSubjectScoreInsights(scoreRows as any, subjectGoals);
  }, [scoreRows, subjectGoals]);

  useEffect(() => {
    if (!subjectInsights.length) {
      setSelectedSubject("");
      return;
    }
    if (
      !selectedSubject ||
      !subjectInsights.some((item) => item.subject === selectedSubject)
    ) {
      setSelectedSubject(subjectInsights[0].subject);
    }
  }, [subjectInsights, selectedSubject]);

  const selectedInsight = useMemo(
    () =>
      subjectInsights.find((item) => item.subject === selectedSubject) || null,
    [subjectInsights, selectedSubject],
  );

  const teacherAdviceText = useMemo(
    () => getSharedTeacherAdviceText(selectedInsight),
    [selectedInsight],
  );

  const totalStackChartData = useMemo(() => {
    const labels = scoreRows.map((row) => row.subject);
    const itemNames = Array.from(
      new Set(
        scoreRows.flatMap((row) => row.breakdown.map((item) => item.name)),
      ),
    );

    const datasets = itemNames.map((itemName) => {
      const rowsByItem = scoreRows.map(
        (row) => row.breakdown.find((item) => item.name === itemName) || null,
      );
      const firstFound = rowsByItem.find(Boolean);
      const itemType = firstFound?.type || "other";
      return {
        label: itemName,
        data: rowsByItem.map((found) =>
          Number((found?.weighted || 0).toFixed(1)),
        ),
        rawScores: rowsByItem.map((found) =>
          Number((found?.score || 0).toFixed(1)),
        ),
        maxScores: rowsByItem.map((found) =>
          Number((found?.maxScore || 0).toFixed(1)),
        ),
        itemTypes: rowsByItem.map((found) => found?.type || itemType),
        backgroundColor: rowsByItem.map((found, rowIdx) => {
          const subjectTotal = Number(scoreRows[rowIdx]?.total || 0);
          const subjectName = String(scoreRows[rowIdx]?.subject || "");
          const band = getGradeBand(subjectTotal, subjectName);
          const type = (found?.type || itemType) as
            | "exam"
            | "performance"
            | "other";
          return getBandTypeColor(band, type);
        }),
        borderColor: rowsByItem.map((found, rowIdx) => {
          const subjectTotal = Number(scoreRows[rowIdx]?.total || 0);
          const subjectName = String(scoreRows[rowIdx]?.subject || "");
          const band = getGradeBand(subjectTotal, subjectName);
          const type = (found?.type || itemType) as
            | "exam"
            | "performance"
            | "other";
          return getBandTypeColor(band, type);
        }),
        borderWidth: 1,
        borderRadius: 0,
        stack: "total",
      } as any;
    });

    return { labels, datasets };
  }, [scoreRows]);

  const stackHoverGuidePlugin = useMemo(
    () => ({
      id: "stackHoverGuide",
      afterDraw: (chart: any) => {
        const active = chart?.tooltip?.getActiveElements?.() || [];
        if (!active.length) return;
        const y = active[0]?.element?.y;
        if (typeof y !== "number") return;

        const { ctx, chartArea } = chart;
        if (!ctx || !chartArea) return;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(chartArea.left, y);
        ctx.lineTo(chartArea.right, y);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "#64748b";
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.restore();
      },
    }),
    [],
  );

  const gapBarData = useMemo(() => {
    if (!selectedInsight) return null;
    return {
      labels: ["현재 반영", "목표까지 필요", "남은 최대 반영"],
      datasets: [
        {
          label: selectedInsight.subject,
          data: [
            selectedInsight.current,
            selectedInsight.gap,
            selectedInsight.remainingPotential,
          ],
          backgroundColor: ["#3b82f6", "#f59e0b", "#10b981"],
          borderRadius: 8,
        },
      ],
    };
  }, [selectedInsight]);

  const leftMenus: Array<{ key: MainMenu; title: string; icon: string }> = [
    { key: "profile", title: "나의 기본 정보", icon: "fa-id-card" },
    { key: "score", title: "나의 성적표", icon: "fa-chart-column" },
    { key: "wrong_note", title: "오답 노트", icon: "fa-book-open" },
  ];
  const profileGradeValue = normalizeClassValue(
    profile?.grade ?? userData?.grade,
  );
  const profileClassValue = normalizeClassValue(
    profile?.class ?? userData?.class,
  );
  const profileNumberValue =
    String(profile?.number ?? userData?.number ?? "--").trim() || "--";
  const profileGradeLabel =
    gradeLabelMap[profileGradeValue] || profileGradeValue || "--";
  const profileClassLabel =
    classLabelMap[profileClassValue] || profileClassValue || "--";
  const lessonDoneCount = progressSummary?.lesson.unavailable
    ? 0
    : progressSummary?.lesson.completedUnits || 0;
  const lessonTotalCount = progressSummary?.lesson.unavailable
    ? 0
    : progressSummary?.lesson.worksheetUnits ||
      progressSummary?.lesson.totalLessons ||
      0;
  const lessonProgressPercent =
    lessonTotalCount > 0
      ? Math.min(100, Math.round((lessonDoneCount / lessonTotalCount) * 100))
      : 0;
  const recentQuizScore =
    progressSummary?.quiz.latestScore ??
    progressSummary?.quiz.averageScore ??
    0;
  const historyParticipationPercent =
    progressSummary?.historyClassroom.totalAttempts &&
    !progressSummary.historyClassroom.unavailable
      ? Math.round(
          (progressSummary.historyClassroom.passedCount /
            progressSummary.historyClassroom.totalAttempts) *
            100,
        )
      : progressSummary?.historyClassroom.averagePercent || 0;
  const remainingLessonCount = Math.max(0, lessonTotalCount - lessonDoneCount);
  const scoreAverage =
    subjectInsights.length > 0
      ? Math.round(
          subjectInsights.reduce((sum, item) => sum + item.current, 0) /
            subjectInsights.length,
        )
      : 0;
  const targetMetCount = subjectInsights.filter((item) => item.gap <= 0).length;
  const needsCareCount = subjectInsights.filter((item) => item.gap > 0).length;
  const sortedWrongGroups = [...wrongGroupEntries].sort(
    (a, b) => b[1].length - a[1].length,
  );
  const weakWrongGroup = sortedWrongGroups[0]?.[1]?.[0] || null;
  const reviewCompletionRate =
    scoreSummaryByUnit.length > 0
      ? Math.round(
          (scoreSummaryByUnit.filter((item) => item.average >= 80).length /
            scoreSummaryByUnit.length) *
            100,
        )
      : 0;
  const topNeedsCareSubject =
    subjectInsights
      .filter((item) => item.gap > 0)
      .sort((a, b) => b.gap - a.gap)[0] || selectedInsight;
  const nextLessonTitle =
    progressSummary?.lesson.latestUnitTitle || "수업 자료 이어 보기";
  const nextLessonUnit =
    progressSummary?.lesson.units.find((unit) => unit.status !== "completed") ||
    progressSummary?.lesson.units[0] ||
    null;
  const openNextLesson = () => {
    if (!canUseLesson) return;
    const params = new URLSearchParams();
    if (nextLessonUnit?.unitId) params.set("id", nextLessonUnit.unitId);
    if (nextLessonUnit?.title) params.set("title", nextLessonUnit.title);
    const suffix = params.toString();
    navigate(`/student/lesson/note${suffix ? `?${suffix}` : ""}`);
  };
  const openQuiz = () => {
    if (canUseQuiz) navigate("/student/quiz");
  };
  const openHistoryClassroom = () => {
    if (canUseQuiz) navigate("/student/history-classroom");
  };
  const focusWrongItem = (item?: WrongNoteItem | null) => {
    if (!canUseQuiz) return;
    if (item) {
      if (
        item.category === "diagnostic" ||
        item.category === "formative" ||
        item.category === "exam_prep"
      ) {
        setCategoryTab(item.category);
      }
      setSelectedUnitId(getWrongNoteItemScopeId(item) || item.unitId);
      setExpandedWrongKey(item.key);
    }
    selectMenu("wrong_note");
  };
  const startReview = () => {
    if (weakWrongGroup) {
      focusWrongItem(weakWrongGroup);
      return;
    }
    openQuiz();
  };
  const focusScoreSubject = (subject?: SubjectScoreInsight | null) => {
    if (!canUseScore) return;
    if (subject?.subject) setSelectedSubject(subject.subject);
    selectMenu("score");
  };
  const toggleReviewGoal = (key: string) => {
    setReviewGoalChecks((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const mockExamLatest = mockExamPoints[0] || null;
  const mockExamAverage =
    mockExamPoints.length > 0
      ? Math.round(
          mockExamPoints.reduce((sum, item) => sum + item.score, 0) /
            mockExamPoints.length,
        )
      : 0;
  const mockExamWrongCount = mockExamPoints.reduce(
    (sum, item) => sum + Number(item.wrongCount || 0),
    0,
  );
  const selectedReviewItems = selectedQuizAttempt?.allItems || [];
  const safeReviewQuestionIndex =
    selectedReviewItems.length > 0
      ? Math.min(
          Math.max(selectedReviewQuestionIndex, 0),
          selectedReviewItems.length - 1,
        )
      : 0;
  const selectedReviewItem =
    selectedReviewItems[safeReviewQuestionIndex] || null;
  const selectedReviewProgressGroups = useMemo(
    () => getReviewProgressGroups(selectedReviewItems),
    [selectedReviewItems],
  );
  const goToReviewQuestion = (nextIndex: number, closeSidebar = false) => {
    if (!selectedReviewItems.length) return;
    setSelectedReviewQuestionIndex(
      Math.min(Math.max(nextIndex, 0), selectedReviewItems.length - 1),
    );
    if (closeSidebar) setReviewSidebarOpen(false);
  };
  const renderReviewNavigation = (closeAfterSelect = false) => (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-slate-900">단원별 문항</div>
          <div className="mt-1 text-xs font-bold text-slate-400">
            중단원 안의 소단원별로 이동합니다.
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] font-bold text-slate-400">
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500"></span>
            오답
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-500"></span>
            정답
          </span>
        </div>
      </div>

      <div className="space-y-5">
        {selectedReviewProgressGroups.map((bigGroup) => (
          <section key={bigGroup.key} className="space-y-3">
            <div className="break-keep text-sm font-black leading-5 text-slate-900">
              {bigGroup.label}
            </div>
            <div className="space-y-3 border-l border-slate-200 pl-3">
              {bigGroup.mids.map((midGroup) => (
                <div key={midGroup.key} className="space-y-2">
                  <div className="break-keep text-xs font-extrabold leading-5 text-slate-500">
                    {midGroup.label}
                  </div>
                  <div className="space-y-2 border-l border-slate-100 pl-3">
                    {midGroup.smalls.map((smallGroup) => (
                      <div key={smallGroup.key} className="space-y-1.5">
                        <div className="break-keep text-[11px] font-extrabold leading-5 text-slate-400">
                          {smallGroup.label}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {smallGroup.items.map(({ item, index }) => {
                            const displayNumber =
                              item.questionNumber || index + 1;
                            const active = index === safeReviewQuestionIndex;
                            return (
                              <button
                                key={item.key}
                                type="button"
                                onClick={() =>
                                  goToReviewQuestion(index, closeAfterSelect)
                                }
                                className={`h-7 min-w-7 rounded-lg px-2 text-[11px] font-black leading-none transition focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                                  item.correct
                                    ? "bg-blue-500 text-white hover:bg-blue-600 focus:ring-blue-300"
                                    : "bg-red-500 text-white hover:bg-red-600 focus:ring-red-300"
                                } ${active ? "ring-2 ring-slate-900 ring-offset-1" : ""}`}
                                aria-current={active ? "step" : undefined}
                                aria-label={`${displayNumber}번 ${item.correct ? "정답" : "오답"} 문항으로 이동`}
                              >
                                {displayNumber}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
  const renderReviewAnswerSummary = (item: WrongNoteItem) => (
    <div className="grid gap-2 text-xs font-bold leading-5 text-slate-700 sm:grid-cols-2">
      <div className="rounded-lg bg-white px-2.5 py-2">
        <span className="block text-xs font-black text-slate-500">
          {item.correct ? "나의 답" : "나의 오답"}
        </span>
        <span
          className={`mt-0.5 block whitespace-pre-wrap break-keep text-sm font-black ${
            item.correct ? "text-blue-600" : "text-red-500"
          }`}
        >
          {item.userAnswer || "(미입력)"}
        </span>
      </div>
      <div className="rounded-lg bg-white px-2.5 py-2">
        <span className="block text-xs font-black text-slate-500">정답</span>
        <span className="mt-0.5 block whitespace-pre-wrap break-keep text-sm font-black text-blue-600">
          {item.answer}
        </span>
      </div>
    </div>
  );
  const renderReviewQuestionBody = (item: WrongNoteItem) => {
    const hasChoiceReview =
      (item.type === "choice" || item.type === "ox") && item.options.length > 0;
    const hasSupportPanel = Boolean(item.image || item.passage);
    const hasChoiceOptionImages = item.options.some((option) => option.image);

    if (!hasChoiceReview) {
      return (
        <>
          {item.image && (
            <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 p-2 text-center">
              <img
                src={item.image}
                alt="문항 첨부 이미지"
                className="mx-auto max-h-52 max-w-full object-contain"
              />
            </div>
          )}
          {item.passage && (
            <div className="mt-2">
              <QuizPassage
                value={item.passage}
                surface="muted"
                size="compact"
              />
            </div>
          )}
          <div className="mt-2">{renderReviewAnswerSummary(item)}</div>
        </>
      );
    }

    return (
      <div
        className={`mt-2 min-h-0 ${
          hasSupportPanel
            ? "grid gap-2 md:grid-cols-[minmax(0,0.95fr)_minmax(250px,0.95fr)]"
            : "space-y-1.5"
        }`}
      >
        {hasSupportPanel && (
          <div className="flex min-h-0 flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-center">
            {item.image && (
              <div
                className={`flex min-h-0 items-center justify-center ${
                  item.passage ? "shrink-0" : "flex-1"
                }`}
              >
                <img
                  src={item.image}
                  alt="문항 첨부 이미지"
                  className={`mx-auto max-w-full rounded-lg border border-slate-100 bg-white object-contain ${
                    item.passage
                      ? "max-h-[min(22vh,210px)]"
                      : "max-h-[min(26vh,230px)]"
                  }`}
                />
              </div>
            )}
            {item.passage && (
              <QuizPassage
                value={item.passage}
                surface="white"
                size="compact"
                className="shrink-0 text-left text-xs leading-5 md:text-sm md:leading-6"
              />
            )}
          </div>
        )}

        <div
          className={
            hasChoiceOptionImages
              ? "grid min-h-0 grid-cols-2 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-3"
              : "min-h-0 space-y-1.5 overflow-y-auto pr-1"
          }
        >
          {item.options.map((option, index) => {
            const optionIsCorrect = isReviewOptionAnswerMatch(
              item.answer,
              option,
              index,
            );
            const optionIsSelected = isReviewOptionAnswerMatch(
              item.userAnswer,
              option,
              index,
            );
            const optionIsSelectedWrong = optionIsSelected && !optionIsCorrect;
            const visibleOptionText =
              option.image && isGeneratedImageChoiceLabel(option.text, index)
                ? ""
                : option.text;

            const optionTone = optionIsCorrect
              ? "border-blue-500 bg-blue-50 text-blue-800 shadow-sm"
              : optionIsSelectedWrong
                ? "border-red-500 bg-red-50 text-red-700 shadow-sm"
                : "border-slate-200 bg-white text-slate-700";
            const numberTone = optionIsCorrect
              ? "bg-blue-600 text-white"
              : optionIsSelectedWrong
                ? "bg-red-500 text-white"
                : "bg-slate-200 text-slate-500";

            return (
              <div
                key={`${item.key}-choice-${index}`}
                className={
                  hasChoiceOptionImages
                    ? `flex min-h-[7.5rem] flex-col rounded-lg border-2 p-1.5 text-left ${optionTone}`
                    : `flex min-h-10 items-center rounded-lg border-2 px-2.5 py-1.5 text-left ${optionTone}`
                }
              >
                {hasChoiceOptionImages ? (
                  <>
                    <div
                      className={`relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden rounded-lg border ${
                        option.image
                          ? "border-slate-100 bg-white"
                          : "border-dashed border-slate-200 bg-slate-50 px-2"
                      }`}
                    >
                      <span
                        className={`absolute left-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full text-xs font-black shadow-sm ${numberTone}`}
                      >
                        {index + 1}
                      </span>
                      {(optionIsCorrect || optionIsSelectedWrong) && (
                        <div className="absolute right-1 top-1 z-10 flex flex-wrap justify-end gap-0.5">
                          {optionIsCorrect && (
                            <span className="rounded-full bg-blue-600 px-1 py-0.5 text-[9px] font-black leading-none text-white shadow-sm">
                              정답
                            </span>
                          )}
                          {optionIsSelectedWrong && (
                            <span className="rounded-full bg-red-500 px-1 py-0.5 text-[9px] font-black leading-none text-white shadow-sm">
                              내 답
                            </span>
                          )}
                        </div>
                      )}
                      {option.image ? (
                        <img
                          src={option.image}
                          alt={`${index + 1}번 보기`}
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span className="break-keep text-center text-xs font-bold leading-5 text-slate-700">
                          {visibleOptionText}
                        </span>
                      )}
                    </div>
                    {visibleOptionText && option.image && (
                      <div className="mt-1.5 line-clamp-2 min-h-[2rem] w-full break-keep text-center text-xs font-bold leading-4">
                        {visibleOptionText}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div
                      className={`mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${numberTone}`}
                    >
                      {index + 1}
                    </div>
                    {option.image && (
                      <img
                        src={option.image}
                        alt={`${index + 1}번 보기 이미지`}
                        className="mr-2 h-16 w-20 shrink-0 rounded-lg border border-slate-100 bg-white object-contain"
                      />
                    )}
                    <div className="flex min-h-6 min-w-0 flex-1 items-center break-words text-sm font-bold leading-5">
                      <div>{visibleOptionText}</div>
                    </div>
                    {(optionIsCorrect || optionIsSelectedWrong) && (
                      <div className="ml-2 flex shrink-0 items-center gap-1 self-center">
                        {optionIsCorrect && (
                          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-black leading-none text-blue-700">
                            정답
                          </span>
                        )}
                        {optionIsSelectedWrong && (
                          <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-black leading-none text-red-700">
                            내 답
                          </span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };
  const weeklySnapshotItems = [
    ...(canUseLesson
      ? [
          {
            icon: "fa-circle-check",
            label: "완료한 학습 자료",
            value: `${lessonDoneCount}개`,
            tone: "text-blue-600 bg-blue-50",
          },
          {
            icon: "fa-flag",
            label: "남은 목표",
            value: `${remainingLessonCount}개`,
            tone: "text-indigo-600 bg-indigo-50",
          },
        ]
      : []),
    ...(canUseQuiz
      ? [
          {
            icon: "fa-clock",
            label: "평가 응시",
            value: `${progressSummary?.quiz.totalAttempts || trendPoints.length}회`,
            tone: "text-emerald-600 bg-emerald-50",
          },
        ]
      : []),
  ];
  const feedbackItems = [
    ...(canUseLesson
      ? [
          lessonProgressPercent >= 70
            ? "학습 자료 진행이 안정적이에요."
            : "아직 보지 않은 수업 자료를 먼저 확인해 보세요.",
        ]
      : []),
    ...(canUseQuiz
      ? [
          recentQuizScore >= 80
            ? "최근 평가 흐름이 좋아요. 같은 리듬을 유지해요."
            : "최근 평가에서 틀린 문항을 다시 보면 점수가 빨리 올라요.",
          historyParticipationPercent >= 70
            ? "역사교실 참여도 꾸준히 이어지고 있어요."
            : "역사교실 활동을 한 번 더 참여해 보는 것이 좋아요.",
        ]
      : []),
  ];
  const profileMetricCards = [
    ...(canUseLesson
      ? [
          {
            icon: "fa-book-open",
            label: "학습 진행",
            value: `${lessonProgressPercent}%`,
            color: "blue",
            percent: lessonProgressPercent,
            onClick: openNextLesson,
          },
        ]
      : []),
    ...(canUseQuiz
      ? [
          {
            icon: "fa-arrow-trend-up",
            label: "최근 평가",
            value: `${recentQuizScore || 0}점`,
            color: "emerald",
            percent: recentQuizScore || 0,
            onClick: () => selectMenu("wrong_note"),
          },
          {
            icon: "fa-users",
            label: "역사교실 참여",
            value: `${historyParticipationPercent || 0}%`,
            color: "violet",
            percent: historyParticipationPercent || 0,
            onClick: openHistoryClassroom,
          },
        ]
      : []),
  ];
  const actionableTodoItems = [
    ...(canUseLesson
      ? [
          {
            label: `수업 자료 ${remainingLessonCount || 1}개 학습하기`,
            onClick: openNextLesson,
          },
        ]
      : []),
    ...(canUseQuiz
      ? [
          {
            label:
              wrongItems.length > 0
                ? "오답 문항 다시 풀기"
                : "최근 평가 기록 확인하기",
            onClick: wrongItems.length > 0 ? startReview : openQuiz,
          },
        ]
      : []),
    ...(canUseScore
      ? [
          {
            label: topNeedsCareSubject
              ? `${topNeedsCareSubject.subject} 목표 점수 확인하기`
              : "나의 목표 점수 정하기",
            onClick: () => focusScoreSubject(topNeedsCareSubject),
          },
        ]
      : []),
  ];
  const recommendationItems = [
    ...(canUseLesson
      ? [
          {
            title: nextLessonTitle,
            subtitle: "수업 자료 확인",
            icon: "fa-book-open",
            tone: "bg-blue-50 text-blue-600",
            onClick: openNextLesson,
          },
        ]
      : []),
    ...(canUseQuiz
      ? [
          {
            title: weakWrongGroup?.unitTitle || "오답 노트 복습",
            subtitle: "틀린 문제 다시 보기",
            icon: "fa-pen",
            tone: "bg-violet-50 text-violet-600",
            onClick: startReview,
          },
        ]
      : []),
  ];
  const reviewRouteItems = [
    { key: "concept", label: "개념 복습", onClick: openNextLesson },
    { key: "wrong", label: "문제 풀이", onClick: startReview },
    { key: "retry", label: "다시 도전", onClick: openQuiz },
  ];
  const wrongNoteUnitFilterLabel =
    categoryTab === "exam_prep"
      ? "회차"
      : isSmallUnitAssessmentCategory(categoryTab)
        ? "소단원"
        : "목차";
  const wrongNoteAllUnitFilterLabel =
    categoryTab === "exam_prep"
      ? "전체 회차"
      : isSmallUnitAssessmentCategory(categoryTab)
        ? "전체 소단원"
        : "전체 목차";

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <main className="flex w-full max-w-[1480px] flex-1 flex-col gap-8 px-5 py-7 sm:px-8 lg:mx-auto lg:flex-row lg:px-10 lg:py-10">
        <aside className="w-full lg:w-64 shrink-0">
          <div className="sticky top-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_14px_35px_rgba(15,23,42,0.06)]">
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-xl font-extrabold text-gray-800 flex items-center gap-2">
                <i className="fas fa-user-circle text-gray-400"></i>
                마이페이지
              </h2>
            </div>
            <nav className="flex flex-col">
              {leftMenus
                .filter((item) => isMenuAvailable(item.key))
                .map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => selectMenu(item.key)}
                    className={`p-4 text-left font-bold text-sm transition-colors flex items-center gap-3 ${
                      menu === item.key
                        ? "bg-blue-50/80 text-blue-600 border-l-4 border-blue-600"
                        : "text-slate-600 hover:bg-slate-50 border-l-4 border-transparent"
                    }`}
                  >
                    <div className="w-6 text-center">
                      <i className={`fas ${item.icon}`}></i>
                    </div>
                    {item.title}
                  </button>
                ))}
            </nav>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <div className="space-y-8">
            {menu === "profile" && (
              <div className="space-y-7">
                <h2 className="text-3xl font-black tracking-tight text-slate-900">
                  나의 기본 정보
                </h2>
                <div className="grid gap-5 xl:grid-cols-[minmax(360px,1.65fr)_repeat(3,minmax(170px,0.7fr))]">
                  <div className="rounded-2xl border border-blue-200 bg-white p-6 shadow-[0_14px_32px_rgba(37,99,235,0.10)] md:p-7">
                    <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                      <div className="relative flex h-28 w-28 shrink-0 items-center justify-center rounded-full bg-blue-50 text-5xl ring-1 ring-blue-100">
                        {displayProfileIcon}
                        <button
                          type="button"
                          onClick={() => setIconModalOpen(true)}
                          className="absolute -bottom-1 -right-1 inline-flex h-8 min-w-8 items-center justify-center whitespace-nowrap rounded-full border border-blue-100 bg-white px-2 text-[11px] font-extrabold text-blue-700 shadow-sm"
                        >
                          변경
                        </button>
                      </div>

                      <div className="min-w-0">
                        <div className="text-3xl font-black tracking-tight text-slate-900">
                          {profile?.name || userData?.name || "학생"}
                        </div>
                        <div className="mt-2 text-xl font-bold tracking-tight text-slate-600">
                          <span>{withSuffix(profileGradeLabel, "학년")}</span>
                          <span className="mx-2 text-slate-300">·</span>
                          <span>{withSuffix(profileClassLabel, "반")}</span>
                          <span className="mx-2 text-slate-300">·</span>
                          <span>{profileNumberValue}번</span>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {currentRank ? (
                            <PointRankBadge
                              rank={currentRank}
                              size="md"
                              className="border-blue-100 bg-blue-50 text-blue-700"
                            />
                          ) : (
                            <span className="inline-flex whitespace-nowrap rounded-full bg-blue-50 px-3 py-1 text-sm font-extrabold text-blue-700">
                              등급 계산 중
                            </span>
                          )}
                          <span className="inline-flex whitespace-nowrap rounded-full bg-slate-100 px-3 py-1 text-sm font-extrabold text-blue-700">
                            누적{" "}
                            {formatWisAmount(currentRank?.metricValue || 0)}
                          </span>
                        </div>
                        <div className="mt-5 flex items-start gap-2 text-sm font-semibold leading-6 text-slate-600">
                          <i className="fas fa-wand-magic-sparkles mt-1 text-blue-500"></i>
                          <span>
                            꾸준히 노력하고 있어요. 지금처럼만 해봐요!
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {profileMetricCards.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={item.onClick}
                      className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-[0_14px_30px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(15,23,42,0.10)]"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`inline-flex h-12 w-12 items-center justify-center rounded-full ${
                            item.color === "emerald"
                              ? "bg-emerald-50 text-emerald-500"
                              : item.color === "violet"
                                ? "bg-violet-50 text-violet-500"
                                : "bg-blue-50 text-blue-600"
                          }`}
                        >
                          <i className={`fas ${item.icon}`}></i>
                        </span>
                        <span className="text-sm font-extrabold text-slate-700">
                          {item.label}
                        </span>
                      </div>
                      <div
                        className={`mt-8 text-4xl font-black ${
                          item.color === "emerald"
                            ? "text-emerald-600"
                            : item.color === "violet"
                              ? "text-violet-600"
                              : "text-blue-600"
                        }`}
                      >
                        {item.value}
                      </div>
                      <div className="mt-6 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${
                            item.color === "emerald"
                              ? "bg-emerald-500"
                              : item.color === "violet"
                                ? "bg-violet-500"
                                : "bg-blue-600"
                          }`}
                          style={{ width: `${Math.min(100, item.percent)}%` }}
                        />
                      </div>
                    </button>
                  ))}
                </div>

                {canUseScore && (
                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
                    <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="flex items-center gap-3">
                          <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                            <i className="fas fa-chart-column"></i>
                          </span>
                          <h3 className="text-xl font-black text-slate-900">
                            성적 요약
                          </h3>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <div className="rounded-xl border border-slate-200 px-4 py-3">
                            <div className="text-xs font-bold text-slate-400">
                              전체 평균
                            </div>
                            <div className="mt-1 text-2xl font-black text-blue-600">
                              {scoreAverage}점
                            </div>
                          </div>
                          <div className="rounded-xl border border-slate-200 px-4 py-3">
                            <div className="text-xs font-bold text-slate-400">
                              목표 달성
                            </div>
                            <div className="mt-1 text-2xl font-black text-emerald-600">
                              {targetMetCount}개
                            </div>
                          </div>
                          <div className="rounded-xl border border-slate-200 px-4 py-3">
                            <div className="text-xs font-bold text-slate-400">
                              다음 확인
                            </div>
                            <div className="mt-1 truncate text-lg font-black text-slate-700">
                              {topNeedsCareSubject?.subject || "목표 유지"}
                            </div>
                          </div>
                        </div>
                      </div>
                      <Link
                        to="/student/score/report"
                        className="inline-flex shrink-0 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-extrabold text-blue-700 transition hover:bg-blue-100"
                      >
                        성적 리포트 보기
                        <i className="fas fa-chevron-right ml-2 text-xs"></i>
                      </Link>
                    </div>
                  </section>
                )}

                <div className="grid gap-5 lg:grid-cols-[1fr_1fr_1.1fr]">
                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
                    <div className="mb-5 flex items-center gap-3">
                      <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                        <i className="fas fa-calendar-check"></i>
                      </span>
                      <h3 className="text-xl font-black text-slate-900">
                        이번 주 한눈에 보기
                      </h3>
                    </div>
                    <div className="space-y-3">
                      {weeklySnapshotItems.map((item) => (
                        <div
                          key={item.label}
                          className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3"
                        >
                          <div className="flex items-center gap-3 text-sm font-bold text-slate-600">
                            <span
                              className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${item.tone}`}
                            >
                              <i className={`fas ${item.icon}`}></i>
                            </span>
                            {item.label}
                          </div>
                          <span className="text-lg font-black text-blue-600">
                            {item.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
                    <div className="mb-6 flex items-center gap-3">
                      <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                        <i className="fas fa-lightbulb"></i>
                      </span>
                      <h3 className="text-xl font-black text-slate-900">
                        맞춤 피드백
                      </h3>
                    </div>
                    <div className="space-y-5">
                      {feedbackItems.map((item) => (
                        <div
                          key={item}
                          className="flex gap-3 text-sm font-semibold leading-7 text-slate-700"
                        >
                          <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-blue-600"></span>
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
                    <div className="mb-5 flex items-center gap-3">
                      <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                        <i className="fas fa-clipboard-list"></i>
                      </span>
                      <h3 className="text-xl font-black text-slate-900">
                        다음에 할 일
                      </h3>
                    </div>
                    <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                      {actionableTodoItems.map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={item.onClick}
                          className="flex items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-slate-600"
                        >
                          <span className="inline-flex h-5 w-5 shrink-0 rounded-full border border-slate-300"></span>
                          <span className="min-w-0 flex-1 text-left">
                            {item.label}
                          </span>
                          <i className="fas fa-chevron-right text-slate-400"></i>
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setRankModalOpen(true)}
                      className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-extrabold text-blue-700 transition hover:bg-blue-100"
                    >
                      등급 설명 보기
                      <i className="fas fa-chevron-right text-xs"></i>
                    </button>
                  </section>
                </div>
              </div>
            )}

            {menu === "score" && (
              <div className="space-y-7">
                <h2 className="text-3xl font-black tracking-tight text-slate-900">
                  나의 성적표
                </h2>

                <div className="grid gap-5 lg:grid-cols-3">
                  {[
                    {
                      icon: "fa-arrow-trend-up",
                      label: "전체 평균",
                      value: `${scoreAverage}점`,
                      tone: "blue",
                    },
                    {
                      icon: "fa-bullseye",
                      label: "목표 달성 과목",
                      value: `${targetMetCount}개`,
                      tone: "emerald",
                    },
                    {
                      icon: "fa-triangle-exclamation",
                      label: "보완 필요 과목",
                      value: `${needsCareCount}개`,
                      tone: "orange",
                    },
                  ].map((item) => (
                    <section
                      key={item.label}
                      className="flex items-center gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.05)]"
                    >
                      <span
                        className={`inline-flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-3xl ${
                          item.tone === "emerald"
                            ? "bg-emerald-50 text-emerald-500"
                            : item.tone === "orange"
                              ? "bg-orange-50 text-orange-500"
                              : "bg-blue-50 text-blue-600"
                        }`}
                      >
                        <i className={`fas ${item.icon}`}></i>
                      </span>
                      <div>
                        <div className="text-sm font-extrabold text-slate-600">
                          {item.label}
                        </div>
                        <div
                          className={`mt-3 text-4xl font-black ${
                            item.tone === "emerald"
                              ? "text-emerald-600"
                              : item.tone === "orange"
                                ? "text-orange-500"
                                : "text-blue-600"
                          }`}
                        >
                          {item.value}
                        </div>
                      </div>
                    </section>
                  ))}
                </div>

                {canUseQuiz && (
                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-xl font-black text-slate-900">
                          모의고사 점수
                        </h3>
                        <p className="mt-1 text-sm font-bold text-slate-500">
                          최근 모의고사 응시 기록을 성적표에서 바로 확인합니다.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={openQuiz}
                        className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm font-extrabold text-blue-700 transition hover:bg-blue-100"
                      >
                        모의고사 풀기
                        <i className="fas fa-chevron-right text-xs"></i>
                      </button>
                    </div>
                    <div className="mt-5 grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl border border-slate-200 px-4 py-4">
                        <div className="text-xs font-bold text-slate-400">
                          최근 점수
                        </div>
                        <div className="mt-2 text-3xl font-black text-blue-600">
                          {mockExamLatest ? `${mockExamLatest.score}점` : "-"}
                        </div>
                        <div className="mt-1 text-xs font-bold text-slate-400">
                          {mockExamLatest?.dateText || "응시 기록 없음"}
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 px-4 py-4">
                        <div className="text-xs font-bold text-slate-400">
                          평균 점수
                        </div>
                        <div className="mt-2 text-3xl font-black text-emerald-600">
                          {mockExamPoints.length ? `${mockExamAverage}점` : "-"}
                        </div>
                        <div className="mt-1 text-xs font-bold text-slate-400">
                          총 {mockExamPoints.length}회 응시
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 px-4 py-4">
                        <div className="text-xs font-bold text-slate-400">
                          누적 오답
                        </div>
                        <div className="mt-2 text-3xl font-black text-orange-500">
                          {mockExamWrongCount}개
                        </div>
                        <div className="mt-1 text-xs font-bold text-slate-400">
                          오답 노트와 함께 복습
                        </div>
                      </div>
                    </div>
                    <div className="mt-5 space-y-3">
                      {mockExamPoints.slice(0, 3).map((item) => (
                        <button
                          key={`${item.dateText}-${item.score}`}
                          type="button"
                          onClick={() => selectMenu("wrong_note")}
                          className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left transition hover:bg-slate-50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-extrabold text-slate-700">
                              {item.label}
                            </span>
                            <span className="text-xs font-bold text-slate-400">
                              {item.dateText || "-"} · 오답{" "}
                              {item.wrongCount || 0}개
                            </span>
                          </span>
                          <span className="text-lg font-black text-blue-600">
                            {item.score}점
                          </span>
                        </button>
                      ))}
                      {mockExamPoints.length === 0 && (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-400">
                          아직 모의고사 응시 기록이 없습니다.
                        </div>
                      )}
                    </div>
                  </section>
                )}

                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-xl font-black text-slate-900">
                        내 수행평가 점수
                      </h3>
                      <p className="mt-1 text-sm font-bold text-slate-500">
                        교사가 확정해 업로드한 수행평가 점수와 피드백입니다.
                      </p>
                    </div>
                    <Link
                      to="/student/score/performance"
                      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm font-extrabold text-blue-700 transition hover:bg-blue-100"
                    >
                      자세히 보기
                      <i className="fas fa-chevron-right text-xs"></i>
                    </Link>
                  </div>
                  <div className="mt-5 grid gap-3 lg:grid-cols-2">
                    {performanceScoresLoading ? (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-400 lg:col-span-2">
                        수행평가 점수를 불러오는 중입니다.
                      </div>
                    ) : performanceScores.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-400 lg:col-span-2">
                        아직 확인할 수행평가 점수가 없습니다.
                      </div>
                    ) : (
                      performanceScores.slice(0, 4).map((record) => {
                        const percent = getPerformanceScorePercent(
                          record.totalScore,
                          record.totalMaxScore,
                        );
                        return (
                          <article
                            key={record.id || record.rosterId}
                            className="rounded-xl border border-slate-200 px-4 py-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h4 className="truncate text-base font-black text-slate-900">
                                  {record.title}
                                </h4>
                                <p className="mt-1 text-xs font-bold text-slate-400">
                                  {record.subject || "과목"} · {record.class}반{" "}
                                  {record.number}번
                                </p>
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-lg font-black text-blue-600">
                                  {formatPerformanceScore(record.totalScore)}
                                  <span className="text-sm text-slate-400">
                                    {" "}
                                    /{" "}
                                    {formatPerformanceScore(
                                      record.totalMaxScore,
                                    )}
                                  </span>
                                </div>
                                <div className="text-xs font-black text-blue-500">
                                  {formatPerformanceScore(percent)}%
                                </div>
                              </div>
                            </div>
                            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full bg-blue-600"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                            <p className="mt-3 line-clamp-2 text-xs font-semibold leading-5 text-slate-500">
                              {record.evidence ||
                                record.feedback ||
                                "등록된 피드백이 없습니다."}
                            </p>
                          </article>
                        );
                      })
                    )}
                  </div>
                </section>

                <div className="grid gap-5 xl:grid-cols-[1.25fr_0.9fr]">
                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
                    <h3 className="text-xl font-black text-slate-900">
                      과목별 성취 현황
                    </h3>
                    <div className="mt-6 space-y-4">
                      {subjectInsights.length > 0 ? (
                        subjectInsights.map((item) => (
                          <button
                            key={item.subject}
                            type="button"
                            onClick={() => setSelectedSubject(item.subject)}
                            className="grid w-full grid-cols-[76px_1fr_auto] items-center gap-4 text-left"
                          >
                            <span className="text-sm font-extrabold text-slate-700">
                              {item.subject}
                            </span>
                            <span className="h-2.5 overflow-hidden rounded-full bg-blue-50">
                              <span
                                className="block h-full rounded-full bg-blue-600"
                                style={{
                                  width: `${Math.min(100, item.current)}%`,
                                }}
                              />
                            </span>
                            <span className="whitespace-nowrap text-sm font-bold text-slate-500">
                              <strong className="text-blue-600">
                                {item.current}점
                              </strong>{" "}
                              / {item.target}점
                            </span>
                          </button>
                        ))
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-bold text-slate-400">
                          아직 성적 데이터가 없습니다.
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
                    <h3 className="text-xl font-black text-slate-900">
                      선택 과목 분석
                    </h3>
                    {selectedInsight ? (
                      <div className="mt-6 space-y-6">
                        <div className="inline-flex rounded-full bg-blue-50 px-4 py-2 text-sm font-extrabold text-blue-600">
                          {selectedInsight.subject}
                        </div>
                        <div className="grid grid-cols-2 gap-5">
                          <div>
                            <div className="text-sm font-bold text-slate-500">
                              현재 점수
                            </div>
                            <div className="mt-2 text-4xl font-black text-blue-600">
                              {selectedInsight.current}점
                            </div>
                          </div>
                          <div className="border-l border-slate-200 pl-5">
                            <div className="text-sm font-bold text-slate-500">
                              목표 점수
                            </div>
                            <div className="mt-2 text-4xl font-black text-violet-600">
                              {selectedInsight.target}점
                            </div>
                          </div>
                        </div>
                        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold leading-6 text-slate-700">
                          <i className="fas fa-lightbulb mr-2 text-blue-600"></i>
                          {teacherAdviceText}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="text-sm font-bold text-slate-700">
                            과목 목표
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={subjectGoals[selectedInsight.subject] ?? 85}
                            onChange={(event) =>
                              setSubjectGoals((prev) => ({
                                ...prev,
                                [selectedInsight.subject]: Number(
                                  event.target.value || 0,
                                ),
                              }))
                            }
                            className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold"
                          />
                          <button
                            type="button"
                            onClick={() => void saveGoal()}
                            disabled={savingGoal}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:bg-blue-300"
                          >
                            {savingGoal ? "저장 중.." : "저장"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="py-12 text-center text-sm font-bold text-slate-400">
                        과목을 선택해 주세요.
                      </div>
                    )}
                  </section>
                </div>

                <div className="grid gap-5 xl:grid-cols-3">
                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
                    <h3 className="text-xl font-black text-slate-900">
                      최근 평가
                    </h3>
                    <div className="mt-5 space-y-3">
                      {trendPoints
                        .slice(-3)
                        .reverse()
                        .map((item, index) => (
                          <div
                            key={`${item.label}-${index}`}
                            className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-extrabold text-slate-700">
                                {item.label}
                              </div>
                              <div className="text-xs font-bold text-slate-400">
                                {getCategoryLabel(item.category)}
                              </div>
                            </div>
                            <span className="text-lg font-black text-blue-600">
                              {item.score}점
                            </span>
                          </div>
                        ))}
                      {trendPoints.length === 0 && (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-400">
                          최근 평가 기록이 없습니다.
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
                    <h3 className="text-xl font-black text-slate-900">
                      추천 학습
                    </h3>
                    <div className="mt-5 space-y-3">
                      {recommendationItems.map((item, index) => (
                        <button
                          key={`${item.title}-${index}`}
                          type="button"
                          onClick={item.onClick}
                          className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left transition hover:bg-slate-50"
                        >
                          <span
                            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${item.tone}`}
                          >
                            <i className={`fas ${item.icon}`}></i>
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-extrabold text-slate-700">
                              {item.title}
                            </div>
                            <div className="text-xs font-bold text-slate-400">
                              {item.subtitle}
                            </div>
                          </div>
                          <i className="fas fa-chevron-right text-slate-400"></i>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
                    <h3 className="text-xl font-black text-slate-900">
                      다음 목표
                    </h3>
                    <div className="mt-10 flex items-center gap-5">
                      <span className="inline-flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-blue-50 text-3xl text-blue-600">
                        <i className="fas fa-bullseye"></i>
                      </span>
                      <div className="min-w-0">
                        <div className="text-base font-extrabold leading-7 text-slate-700">
                          {topNeedsCareSubject
                            ? `${topNeedsCareSubject.subject} 목표 점수 ${topNeedsCareSubject.target}점 달성하기`
                            : "현재 목표를 유지하기"}
                        </div>
                        <div className="mt-2 text-sm font-bold text-slate-400">
                          {goalScore ||
                            "나의 목표를 정하고 학습 흐름을 이어가요."}
                        </div>
                      </div>
                    </div>
                    <div className="mt-6 flex gap-2">
                      <input
                        value={goalScore}
                        onChange={(event) => setGoalScore(event.target.value)}
                        placeholder="이번 학기 평균 85점 이상"
                        className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                      />
                      <button
                        type="button"
                        onClick={() => void saveGoal()}
                        disabled={savingGoal}
                        className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:bg-blue-300"
                      >
                        {savingGoal ? "저장 중" : "저장"}
                      </button>
                    </div>
                  </section>
                </div>
              </div>
            )}

            {menu === "score" && false && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-gray-800">
                  나의 성적표
                </h2>

                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <h3 className="font-bold text-gray-800 whitespace-normal break-keep">
                      종합 성적 그래프 (정기시험/수행평가 반영)
                    </h3>
                    <div className="flex flex-col items-start gap-1 md:items-end">
                      <span className="text-xs text-gray-500">
                        마우스를 올리면 영역별 점수가 표시됩니다.
                      </span>
                      <div className="flex flex-col items-end gap-1">
                        <div className="overflow-hidden rounded-lg shadow-sm border border-gray-200">
                          <div className="flex text-[10px] font-bold text-gray-600 bg-gray-50 border-b border-gray-200 leading-none">
                            <span className="px-3 py-1.5">100~90</span>
                            <span className="px-3 py-1.5">89~80</span>
                            <span className="px-3 py-1.5">79~70</span>
                            <span className="px-3 py-1.5">69~60</span>
                            <span className="px-3 py-1.5">59~0</span>
                          </div>
                          <div className="flex text-[12px] font-black text-white leading-none">
                            <span className="px-6 py-2 bg-red-500">A</span>
                            <span className="px-6 py-2 bg-orange-500">B</span>
                            <span className="px-6 py-2 bg-yellow-500">C</span>
                            <span className="px-6 py-2 bg-green-500">D</span>
                            <span className="px-6 py-2 bg-blue-500">E</span>
                          </div>
                        </div>
                        <span className="text-[10px] text-gray-400">
                          * 음악, 미술, 체육은 A/B/C 3단계 평가
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="h-72">
                    {subjectInsights.length > 0 ? (
                      <React.Suspense
                        fallback={
                          <div className="flex h-full items-center justify-center text-sm font-semibold text-gray-400">
                            그래프를 준비하는 중입니다.
                          </div>
                        }
                      >
                        <LazyChart
                          type="bar"
                          data={totalStackChartData}
                          plugins={[stackHoverGuidePlugin]}
                          options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            interaction: { mode: "index", intersect: false },
                            scales: {
                              y: { beginAtZero: true, max: 100, stacked: true },
                              x: { stacked: true },
                            },
                            plugins: {
                              legend: { display: false },
                              tooltip: {
                                enabled: true,
                                filter: (ctx: any) =>
                                  Number(ctx?.parsed?.y || 0) > 0,
                                callbacks: {
                                  label: (ctx: any) => {
                                    const dataIndex = ctx.dataIndex || 0;
                                    const ds = ctx.dataset || {};
                                    const itemType = getTypeLabel(
                                      (ds.itemTypes?.[dataIndex] ||
                                        "other") as any,
                                    );
                                    const raw = Number(
                                      ds.rawScores?.[dataIndex] || 0,
                                    ).toFixed(1);
                                    const max = Number(
                                      ds.maxScores?.[dataIndex] || 0,
                                    ).toFixed(1);
                                    return `[${itemType}] ${ctx.dataset.label}: ${raw} / ${max}점`;
                                  },
                                },
                              },
                            },
                          }}
                        />
                      </React.Suspense>
                    ) : (
                      <div className="text-gray-400 py-8 text-center">
                        아직 성적 데이터가 없습니다.
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[110px_1fr] gap-4 min-h-[560px]">
                  <div className="border border-gray-200 rounded-2xl bg-gray-50 p-2 overflow-auto">
                    <div className="flex lg:flex-col gap-2">
                      {subjectInsights.map((item) => (
                        <button
                          key={item.subject}
                          type="button"
                          onClick={() => setSelectedSubject(item.subject)}
                          className={`px-2 py-3 rounded-xl text-xs font-extrabold whitespace-nowrap transition ${
                            selectedSubject === item.subject
                              ? "bg-blue-600 text-white shadow"
                              : "bg-white text-gray-700 border border-gray-200 hover:bg-blue-50"
                          }`}
                        >
                          {item.subject}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="border border-gray-200 rounded-2xl bg-white p-4">
                    {selectedInsight ? (
                      <div className="space-y-5">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="rounded-xl bg-blue-50 border border-blue-100 p-3">
                            <div className="text-xs font-bold text-blue-700">
                              현재 점수
                            </div>
                            <div className="text-3xl font-black text-blue-700">
                              {selectedInsight.current}점
                            </div>
                          </div>
                          <div className="rounded-xl bg-violet-50 border border-violet-100 p-3">
                            <div className="text-xs font-bold text-violet-700">
                              목표 점수
                            </div>
                            <div className="text-3xl font-black text-violet-700">
                              {selectedInsight.target}점
                            </div>
                          </div>
                          <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                            <div className="text-xs font-bold text-amber-700">
                              목표까지 차이
                            </div>
                            <div className="text-3xl font-black text-amber-700">
                              {selectedInsight.gap}점
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <label className="text-sm font-bold text-gray-700">
                            과목 목표 점수
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={subjectGoals[selectedInsight.subject] ?? 85}
                            onChange={(event) =>
                              setSubjectGoals((prev) => ({
                                ...prev,
                                [selectedInsight.subject]: Number(
                                  event.target.value || 0,
                                ),
                              }))
                            }
                            className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm font-bold"
                          />
                          <button
                            type="button"
                            onClick={() => void saveGoal()}
                            disabled={savingGoal}
                            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:bg-blue-300"
                          >
                            {savingGoal ? "저장 중..." : "저장"}
                          </button>
                        </div>

                        <div className="rounded-2xl border border-gray-200 p-4 bg-gray-50">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="text-sm font-bold text-gray-700">
                              목표 달성 현황
                            </div>
                            <div
                              className={`self-start rounded-xl px-4 py-2 text-sm font-extrabold shadow whitespace-nowrap ${
                                selectedInsight.gap <= 0
                                  ? "bg-blue-600 text-white"
                                  : selectedInsight.mood === "good"
                                    ? "bg-emerald-500 text-white"
                                    : "bg-orange-500 text-white"
                              }`}
                            >
                              {selectedInsight.gap <= 0
                                ? "목표 달성!"
                                : selectedInsight.mood === "good"
                                  ? "목표 달성 유력"
                                  : "끝까지 힘내요"}
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-3 items-start">
                            <div className="h-56">
                              {gapBarData && (
                                <React.Suspense
                                  fallback={
                                    <div className="flex h-full items-center justify-center text-sm font-semibold text-gray-400">
                                      그래프를 준비하는 중입니다.
                                    </div>
                                  }
                                >
                                  <LazyChart
                                    type="bar"
                                    data={gapBarData}
                                    options={{
                                      indexAxis: "y" as const,
                                      responsive: true,
                                      maintainAspectRatio: false,
                                      scales: {
                                        x: { beginAtZero: true, max: 100 },
                                      },
                                      plugins: {
                                        legend: { display: false },
                                        tooltip: { enabled: true },
                                      },
                                    }}
                                  />
                                </React.Suspense>
                              )}
                            </div>
                          </div>
                          <div className="mt-3 text-sm font-bold text-gray-700">
                            남은 평가에서 필요한 점수: 정기시험{" "}
                            {selectedInsight.examNeed}점 / 수행평가{" "}
                            {selectedInsight.performanceNeed}점
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            남은 최대 반영점수{" "}
                            {selectedInsight.remainingPotential}점, 필요 달성률{" "}
                            {selectedInsight.requiredRate}%
                          </div>
                          <div className="mt-2 text-sm font-bold text-gray-700">
                            {teacherAdviceText}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-gray-400 py-12 text-center">
                        과목을 선택해 주세요.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {menu === "score" && false && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-gray-800">
                  나의 성적표
                </h2>
                <div className="h-72">
                  {scoreChartData ? (
                    <React.Suspense
                      fallback={
                        <div className="flex h-full items-center justify-center text-sm font-semibold text-gray-400">
                          그래프를 준비하는 중입니다.
                        </div>
                      }
                    >
                      <LazyChart
                        type="bar"
                        data={scoreChartData}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          scales: { y: { beginAtZero: true, max: 100 } },
                          plugins: { legend: { display: false } },
                        }}
                      />
                    </React.Suspense>
                  ) : (
                    <div className="text-gray-400 py-8 text-center">
                      아직 성적 데이터가 없습니다.
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {scoreRows.map((row) => (
                    <div
                      key={row.subject}
                      className="relative group border border-gray-200 rounded-xl p-4 bg-gray-50"
                    >
                      <div className="font-bold text-gray-800">
                        {row.subject}
                      </div>
                      <div className="text-2xl font-extrabold text-blue-700 mt-1">
                        {row.total}점
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        마우스를 올리면 구성 점수를 볼 수 있어요.
                      </div>

                      <div className="hidden group-hover:block absolute z-10 left-0 top-full mt-2 w-full bg-white border border-gray-200 rounded-lg shadow-xl p-3 text-xs text-gray-700">
                        {row.breakdown.map((item, idx) => (
                          <div
                            key={`${row.subject}-${idx}`}
                            className="flex justify-between py-1 border-b last:border-0"
                          >
                            <span>{item.name}</span>
                            <span>
                              {item.score}/{item.maxScore} (비중 {item.ratio}%,
                              환산 {item.weighted})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t pt-4">
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    하단 목표 성적
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={goalScore}
                      onChange={(event) => setGoalScore(event.target.value)}
                      placeholder="예: 이번 학기 평균 85점 이상"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2"
                    />
                    <button
                      type="button"
                      onClick={() => void saveGoal()}
                      disabled={savingGoal}
                      className="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:bg-blue-300"
                    >
                      {savingGoal ? "저장 중..." : "목표 저장"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {menu === "wrong_note" && (
              <div className="space-y-7">
                <h2 className="text-3xl font-black tracking-tight text-slate-900">
                  오답 노트
                </h2>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
                  <div className="grid gap-4">
                    <div className="grid gap-3 lg:grid-cols-[6.25rem_minmax(0,1fr)] lg:items-center">
                      <div className="flex items-center gap-2 text-sm font-black text-slate-500">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-xs text-blue-600">
                          1
                        </span>
                        평가 유형
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => selectWrongNoteCategory("all")}
                          className={`rounded-full px-4 py-2 text-sm font-extrabold transition ${
                            categoryTab === "all"
                              ? "bg-blue-600 text-white"
                              : "bg-slate-100 text-slate-600 hover:bg-blue-50"
                          }`}
                        >
                          전체
                        </button>
                        {CATEGORY_LABELS.map((tab) => (
                          <button
                            key={tab.key}
                            type="button"
                            onClick={() => selectWrongNoteCategory(tab.key)}
                            className={`rounded-full px-4 py-2 text-sm font-extrabold transition ${
                              categoryTab === tab.key
                                ? "bg-blue-600 text-white"
                                : "bg-slate-100 text-slate-600 hover:bg-blue-50"
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-3 border-t border-slate-100 pt-4 lg:grid-cols-[6.25rem_minmax(0,1fr)] lg:items-center">
                      <div className="flex items-center gap-2 text-sm font-black text-slate-500">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-600">
                          2
                        </span>
                        {wrongNoteUnitFilterLabel}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedUnitId("all")}
                          className={`rounded-full px-4 py-2 text-sm font-extrabold transition ${
                            selectedUnitId === "all"
                              ? "bg-slate-900 text-white"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                          }`}
                        >
                          {wrongNoteAllUnitFilterLabel}
                        </button>
                        {availableUnitTabs.map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setSelectedUnitId(tab.id)}
                            className={`rounded-full px-4 py-2 text-sm font-extrabold transition ${
                              selectedUnitId === tab.id
                                ? "bg-slate-900 text-white"
                                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            }`}
                          >
                            {tab.title}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
                  {loadingWrong ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm font-bold text-slate-400">
                      응시 기록을 불러오는 중입니다.
                    </div>
                  ) : quizAttemptHierarchy.length > 0 ? (
                    <div className="space-y-5">
                      {quizAttemptHierarchy.map((section) => {
                        const showSectionHeader =
                          categoryTab === "all" ||
                          !["diagnostic", "formative", "exam_prep"].includes(
                            section.key,
                          );

                        return (
                          <div key={section.key} className="space-y-3">
                            {showSectionHeader && (
                              <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
                                <span
                                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${
                                    section.key === "exam_prep"
                                      ? "bg-blue-600 text-white"
                                      : "bg-blue-50 text-blue-600"
                                  }`}
                                >
                                  <i
                                    className={`fas ${
                                      section.key === "diagnostic"
                                        ? "fa-stethoscope"
                                        : section.key === "formative"
                                          ? "fa-pen-to-square"
                                          : section.key === "exam_prep"
                                            ? "fa-flag-checkered"
                                            : "fa-list-check"
                                    } text-sm`}
                                  ></i>
                                </span>
                                <h4 className="text-lg font-black text-slate-900">
                                  {section.label}
                                </h4>
                              </div>
                            )}

                            <div className="space-y-3">
                              {section.groups.map((group) => {
                                const showGroupHeader =
                                  categoryTab === "all" ||
                                  selectedUnitId === "all" ||
                                  selectedUnitId === "exam_prep";

                                return (
                                  <div key={group.key} className="space-y-2">
                                    {showGroupHeader && (
                                      <div className="min-w-0">
                                        <div className="flex min-h-7 items-center">
                                          <h5 className="truncate text-base font-black text-slate-900">
                                            {group.label}
                                          </h5>
                                        </div>
                                      </div>
                                    )}

                                    <div
                                      className={`grid gap-2 md:grid-cols-2 xl:grid-cols-3 ${
                                        showGroupHeader ? "mt-3" : ""
                                      }`}
                                    >
                                      {group.attempts.map(
                                        (attempt, attemptIndex) => (
                                          <button
                                            key={attempt.key}
                                            type="button"
                                            onClick={() =>
                                              openQuizAttemptReview(attempt)
                                            }
                                            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm"
                                          >
                                            <div className="flex items-start justify-between gap-3">
                                              <div className="min-w-0">
                                                <div className="text-sm font-black text-slate-900">
                                                  {group.attempts.length > 1
                                                    ? `기록 ${attemptIndex + 1}`
                                                    : "응시 기록"}
                                                </div>
                                                <div className="mt-1 break-keep text-xs font-bold leading-5 text-slate-400">
                                                  {attempt.dateText}
                                                </div>
                                              </div>
                                              <span
                                                className={`shrink-0 rounded-full px-3 py-1 text-sm font-black ${
                                                  attempt.wrongCount > 0
                                                    ? "bg-red-50 text-red-600"
                                                    : "bg-blue-50 text-blue-600"
                                                }`}
                                              >
                                                {attempt.score}점
                                              </span>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between text-sm font-bold text-slate-500">
                                              <span>
                                                오답 {attempt.wrongCount} / 전체{" "}
                                                {attempt.allItems.length}
                                              </span>
                                              <span className="inline-flex items-center gap-1 text-blue-600">
                                                확인
                                                <i className="fas fa-chevron-right text-xs"></i>
                                              </span>
                                            </div>
                                          </button>
                                        ),
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm font-bold text-slate-400">
                      조건에 맞는 응시 기록이 없습니다.
                    </div>
                  )}
                </section>
              </div>
            )}

            {menu === "wrong_note" && false && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-gray-800">오답 노트</h2>
                <div>
                  <h3 className="font-bold text-gray-800 mb-2">
                    퀴즈 성장 그래프
                  </h3>
                  <div className="h-64">
                    {quizLineData ? (
                      <React.Suspense
                        fallback={
                          <div className="flex h-full items-center justify-center text-sm font-semibold text-gray-400">
                            그래프를 준비하는 중입니다.
                          </div>
                        }
                      >
                        <LazyChart
                          type="line"
                          data={quizLineData}
                          options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            scales: { y: { beginAtZero: true, max: 100 } },
                            plugins: { legend: { display: false } },
                          }}
                        />
                      </React.Suspense>
                    ) : (
                      <div className="text-gray-400 py-8 text-center">
                        응시 기록이 아직 없습니다.
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="border-b border-gray-100 p-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => selectWrongNoteCategory("all")}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition ${
                          categoryTab === "all"
                            ? "bg-blue-600 text-white shadow"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                      >
                        전체
                      </button>
                      {CATEGORY_LABELS.map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => selectWrongNoteCategory(tab.key)}
                          className={`px-4 py-2 rounded-lg text-sm font-bold transition ${
                            categoryTab === tab.key
                              ? "bg-blue-600 text-white shadow"
                              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="p-3 border-b border-gray-100">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedUnitId("all")}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition ${
                          selectedUnitId === "all"
                            ? "bg-blue-600 text-white shadow"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                      >
                        전체 목차
                      </button>
                      {availableUnitTabs.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setSelectedUnitId(tab.id)}
                          className={`px-4 py-2 rounded-lg text-sm font-bold transition ${
                            selectedUnitId === tab.id
                              ? "bg-blue-600 text-white shadow"
                              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                          }`}
                        >
                          {tab.title}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-gray-800 mb-2">
                    목차별 진단/형성/모의고사 점수
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {scoreSummaryByUnit
                      .filter(
                        (item) =>
                          (categoryTab === "all" ||
                            item.category === categoryTab) &&
                          (selectedUnitId === "all" ||
                            item.unitId === selectedUnitId),
                      )
                      .map((item) => (
                        <div
                          key={`${item.unitId}_${item.category}`}
                          className="border border-gray-200 rounded-lg p-3 bg-gray-50"
                        >
                          <div className="font-bold text-gray-800">
                            {item.unitTitle}
                          </div>
                          <div className="text-xs text-gray-500">
                            {getCategoryLabel(item.category)}
                          </div>
                          <div className="text-sm text-blue-700 font-bold mt-1">
                            평균 {item.average}점 · 응시 {item.count}회
                          </div>
                        </div>
                      ))}
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-gray-800 mb-2">
                    오답 노트 분류
                  </h3>
                  {loadingWrong ? (
                    <div className="text-gray-400 py-6">
                      오답 데이터를 불러오는 중입니다...
                    </div>
                  ) : wrongGroupEntries.length === 0 ? (
                    <div className="text-gray-400 py-6">
                      조건에 맞는 오답이 없습니다.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {wrongGroupEntries.map(([groupKey, items]) => (
                        <div
                          key={groupKey}
                          className="border border-gray-200 rounded-lg overflow-hidden"
                        >
                          <div className="px-4 py-3 bg-gray-50 font-bold text-sm text-gray-700">
                            {items[0].unitTitle} · {items[0].categoryLabel}
                          </div>
                          <div className="divide-y">
                            {items.map((item) => (
                              <div key={item.key}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedWrongKey((prev) =>
                                      prev === item.key ? null : item.key,
                                    )
                                  }
                                  className="w-full p-3 text-left hover:bg-gray-50 flex justify-between items-center"
                                >
                                  <span className="font-bold text-gray-800">
                                    {item.question}
                                  </span>
                                  <i
                                    className={`fas fa-chevron-down text-gray-400 transition ${expandedWrongKey === item.key ? "rotate-180" : ""}`}
                                  ></i>
                                </button>
                                {expandedWrongKey === item.key && (
                                  <div className="px-4 pb-4 text-sm text-gray-700 bg-red-50">
                                    <div className="mb-1 text-xs text-gray-500">
                                      최근 오답 일시: {item.dateText}
                                    </div>
                                    <div>
                                      나의 오답:{" "}
                                      <span className="font-bold text-red-500">
                                        {item.userAnswer || "(미입력)"}
                                      </span>
                                    </div>
                                    <div>
                                      정답:{" "}
                                      <span className="font-bold text-green-600">
                                        {item.answer}
                                      </span>
                                    </div>
                                    <div>해설: {item.explanation}</div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      {selectedQuizAttempt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeQuizAttemptModal}
        >
          <div
            className="flex max-h-[min(92vh,900px)] w-full max-w-6xl flex-col overflow-hidden rounded-[1.75rem] bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
              <div className="min-w-0">
                <div className="text-xs font-black uppercase text-blue-600">
                  {selectedQuizAttempt.categoryLabel} 응시 리뷰
                </div>
                <h3 className="mt-1 text-xl font-black text-slate-900">
                  {selectedQuizAttempt.roundLabel}
                </h3>
                <p className="mt-1 text-sm font-bold text-slate-500">
                  {selectedQuizAttempt.dateText} · {selectedQuizAttempt.score}점
                  · 오답 {selectedQuizAttempt.wrongCount} / 전체{" "}
                  {selectedQuizAttempt.allItems.length}문항
                </p>
              </div>
              <button
                type="button"
                onClick={closeQuizAttemptModal}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50"
                aria-label="응시 리뷰 닫기"
              >
                <i className="fas fa-times text-sm" aria-hidden="true"></i>
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-white px-5 py-3 lg:hidden">
              <button
                type="button"
                onClick={() => setReviewSidebarOpen(true)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50"
              >
                <i className="fas fa-bars text-xs"></i>
                단원별 문항
              </button>
              <div className="rounded-full bg-slate-100 px-3 py-1 text-sm font-black text-slate-600">
                {selectedReviewItems.length > 0
                  ? `${safeReviewQuestionIndex + 1} / ${selectedReviewItems.length}`
                  : "0 / 0"}
              </div>
            </div>

            <div className="relative flex min-h-0 flex-1">
              <aside className="hidden w-80 shrink-0 overflow-y-auto border-r border-slate-100 bg-slate-50/70 px-5 py-5 lg:block">
                {renderReviewNavigation(false)}
              </aside>

              {reviewSidebarOpen && (
                <div className="absolute inset-0 z-20 flex bg-slate-950/35 lg:hidden">
                  <div className="h-full w-[min(22rem,86vw)] overflow-y-auto bg-white px-5 py-5 shadow-2xl">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="text-base font-black text-slate-900">
                        문항 이동
                      </div>
                      <button
                        type="button"
                        onClick={() => setReviewSidebarOpen(false)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50"
                        aria-label="단원별 문항 닫기"
                      >
                        <i className="fas fa-times text-xs"></i>
                      </button>
                    </div>
                    {renderReviewNavigation(true)}
                  </div>
                  <button
                    type="button"
                    className="min-w-0 flex-1"
                    onClick={() => setReviewSidebarOpen(false)}
                    aria-label="단원별 문항 닫기"
                  />
                </div>
              )}

              <div className="min-w-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                {selectedReviewItem ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          goToReviewQuestion(safeReviewQuestionIndex - 1)
                        }
                        disabled={safeReviewQuestionIndex === 0}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <i className="fas fa-chevron-left text-xs"></i>
                        이전
                      </button>
                      <div className="hidden rounded-full bg-slate-100 px-3 py-1 text-sm font-black text-slate-600 lg:block">
                        {selectedReviewItems.length > 0
                          ? `${safeReviewQuestionIndex + 1} / ${selectedReviewItems.length}`
                          : "0 / 0"}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          goToReviewQuestion(safeReviewQuestionIndex + 1)
                        }
                        disabled={
                          safeReviewQuestionIndex >=
                          selectedReviewItems.length - 1
                        }
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        다음
                        <i className="fas fa-chevron-right text-xs"></i>
                      </button>
                    </div>

                    <article
                      key={selectedReviewItem.key}
                      className={`rounded-xl border p-3 ${
                        selectedReviewItem.correct
                          ? "border-blue-100 bg-blue-50/45"
                          : "border-red-100 bg-red-50/70 ring-1 ring-red-100"
                      }`}
                    >
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-black text-white ${
                              selectedReviewItem.correct
                                ? "bg-blue-500"
                                : "bg-red-500"
                            }`}
                          >
                            {selectedReviewItem.questionNumber ||
                              safeReviewQuestionIndex + 1}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-black ${
                              selectedReviewItem.correct
                                ? "bg-blue-50 text-blue-600"
                                : "bg-red-50 text-red-600"
                            }`}
                          >
                            {selectedReviewItem.correct ? "정답" : "오답"}
                          </span>
                          <span className="whitespace-normal break-keep rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-black leading-5 text-slate-500">
                            {selectedReviewItem.hierarchyLabel}
                          </span>
                        </div>
                        <div className="whitespace-pre-wrap break-keep text-sm font-black leading-6 text-slate-900">
                          {selectedReviewItem.question}
                        </div>
                      </div>
                      {renderReviewQuestionBody(selectedReviewItem)}
                      <div className="mt-3 rounded-lg bg-white px-3 py-2.5 text-[15px] font-bold leading-7 text-slate-700">
                        해설: {selectedReviewItem.explanation}
                      </div>
                    </article>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-16 text-center">
                    <div className="text-lg font-black text-slate-700">
                      표시할 문항이 없습니다.
                    </div>
                    <p className="mt-2 text-sm font-bold text-slate-400">
                      응시 기록을 다시 불러온 뒤 확인해 주세요.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {rankModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setRankModalOpen(false)}
        >
          <div
            className="flex max-h-[min(88vh,820px)] w-full max-w-3xl flex-col overflow-hidden rounded-[1.9rem] bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  위스 등급 안내
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  현재 등급, 다음 등급까지 필요한 누적 위스, 전체 등급 위계를 한
                  번에 확인할 수 있습니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRankModalOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 text-gray-500 transition hover:bg-gray-50"
                aria-label="등급 설명 닫기"
              >
                <i className="fas fa-times text-sm" aria-hidden="true"></i>
              </button>
            </div>

            <div className="overflow-y-auto px-5 pb-5 pt-5 sm:px-6 sm:pb-6">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">
                    현재 등급
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {currentRank ? (
                      <PointRankBadge rank={currentRank} size="md" />
                    ) : (
                      <span className="text-sm font-bold text-gray-500">
                        계산 중
                      </span>
                    )}
                  </div>
                  <div className="mt-3 text-sm font-bold text-gray-700">
                    누적 {formatWisAmount(currentRank?.metricValue || 0)}
                  </div>
                  <div className="mt-2 text-xs leading-5 text-gray-600">
                    등급은 누적 획득 위스를 기준으로 계산되며, 사용하거나
                    차감돼도 바로 내려가지 않습니다.
                  </div>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">
                    다음 등급
                  </div>
                  <div className="mt-3 text-lg font-black text-gray-900">
                    {nextRankGuideItem
                      ? nextRankGuideItem.label
                      : "최고 등급 유지 중"}
                  </div>
                  <div className="mt-2 text-sm font-bold text-gray-700">
                    {nextRankGuideItem
                      ? nextRankGap > 0
                        ? `${formatWisAmount(nextRankGap)} 더 모으면 도달`
                        : "승급 기준을 충족했습니다."
                      : "추가 승급 단계가 없습니다."}
                  </div>
                  <div className="mt-2 text-xs leading-5 text-gray-600">
                    {nextRankGuideItem
                      ? `기준 누적 ${formatWisAmount(nextRankGuideItem.minPoints)}`
                      : "현재 테마 기준 최상위 등급입니다."}
                  </div>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-gray-500">
                    등급 기준
                  </div>
                  <div className="mt-3 text-sm font-bold text-gray-800">
                    높은 등급일수록 더 많은 누적 위스를 뜻합니다.
                  </div>
                  <div className="mt-2 text-xs leading-5 text-gray-600">
                    아래 카드에서 높은 등급부터 현재 위치까지 순서대로 바로
                    확인할 수 있습니다.
                  </div>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {rankGuideItems.map((item) => (
                  <article
                    key={item.code}
                    className={`rounded-2xl border px-4 py-4 ${
                      item.isCurrent
                        ? "border-blue-200 bg-blue-50/60 ring-1 ring-blue-100"
                        : "border-gray-200 bg-gray-50/60"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-sm font-bold ${item.badgeClass}`}
                        >
                          {item.label}
                        </span>
                        {item.isCurrent && (
                          <span className="inline-flex whitespace-nowrap rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-bold text-blue-700">
                            내 현재 등급
                          </span>
                        )}
                      </div>
                      <span className="inline-flex whitespace-nowrap rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-bold text-gray-600">
                        기준 누적 {formatWisAmount(item.minPoints)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-gray-600">
                      {item.description}
                    </p>
                    {item.isCurrent && (
                      <div className="mt-3 rounded-xl border border-blue-200 bg-white px-3 py-3 text-sm font-semibold text-blue-700">
                        현재 누적 위스{" "}
                        {formatWisAmount(currentRank?.metricValue || 0)}{" "}
                        기준으로 여기에 도달했습니다.
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {iconModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setIconModalOpen(false)}
        >
          <div
            className="w-full max-w-4xl rounded-[1.9rem] bg-white p-5 shadow-2xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  프로필 아이콘 선택
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  등급별로 해금되는 이모지를 확인하고 현재 프로필 아이콘을
                  선택할 수 있습니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIconModalOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 text-gray-500 transition hover:bg-gray-50"
                aria-label="프로필 아이콘 선택 닫기"
              >
                <i className="fas fa-times text-sm" aria-hidden="true"></i>
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-gray-700">
                  현재 등급
                </span>
                {currentRank && <PointRankBadge rank={currentRank} size="sm" />}
                <span className="text-xs text-gray-500">{`선택 가능 ${allowedEmojiIds.length}개 / 전체 ${emojiCards.length}개`}</span>
              </div>
              <div className="mt-2 text-xs leading-5 text-gray-500">
                잠금 이모지는 더 높은 등급에서 열립니다. 이미 쓰고 있는 잠금
                이모지는 바로 깨지지 않지만, 다른 아이콘으로 바꾸면 다시 선택할
                수 없습니다.
              </div>
            </div>

            {(hasLegacySelectedEmoji ||
              (selectedEmojiEntry && !selectedEmojiAllowed)) && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <span className="mr-2 text-lg leading-none">
                  {displayProfileIcon}
                </span>
                현재 사용 중인 아이콘은 지금 정책으로는 다시 선택할 수 없습니다.
                다른 아이콘으로 바꾸면 이전 아이콘으로 되돌릴 수 없어요.
              </div>
            )}

            <div className="mt-4 space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              {emojiGroups.map((group, groupIndex) => {
                const isOpen =
                  openEmojiTierCodes.includes(group.code) ||
                  (groupIndex === 0 && openEmojiTierCodes.length === 0);
                return (
                  <article
                    key={group.code}
                    className="overflow-hidden rounded-2xl border border-gray-200"
                  >
                    <button
                      type="button"
                      onClick={() => toggleEmojiTierGroup(group.code)}
                      className="flex w-full flex-wrap items-center justify-between gap-3 bg-gray-50/80 px-4 py-3 text-left transition hover:bg-gray-100/80"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-sm font-bold ${group.badgeClass}`}
                        >
                          {group.label}
                        </span>
                        {currentRank?.tierCode === group.code && (
                          <span className="inline-flex whitespace-nowrap rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-bold text-blue-700">
                            현재 등급
                          </span>
                        )}
                        <span className="inline-flex whitespace-nowrap rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-bold text-gray-600">
                          해금{" "}
                          {
                            group.entries.filter((entry) => entry.unlocked)
                              .length
                          }
                          개 / 전체 {group.entries.length}개
                        </span>
                      </div>
                      <div className="inline-flex items-center gap-2 text-xs font-bold text-gray-500 whitespace-nowrap">
                        <span>{isOpen ? "접기" : "펼치기"}</span>
                        <i
                          className={`fas ${isOpen ? "fa-chevron-up" : "fa-chevron-down"} text-[10px]`}
                          aria-hidden="true"
                        ></i>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="p-4">
                        {group.entries.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
                            이 등급에서 해금되는 이모지가 아직 없습니다.
                          </div>
                        ) : (
                          <div className="grid grid-cols-4 gap-3 sm:grid-cols-5 lg:grid-cols-6">
                            {group.entries.map(
                              ({
                                entry,
                                unlockTierLabel,
                                unlocked,
                                selected,
                              }) => (
                                <button
                                  key={entry.id}
                                  type="button"
                                  disabled={savingIcon || !unlocked}
                                  onClick={() => void saveProfileIcon(entry.id)}
                                  title={
                                    unlocked
                                      ? entry.label
                                      : `${unlockTierLabel}에서 해금`
                                  }
                                  className={`relative flex h-16 flex-col items-center justify-center rounded-2xl border text-2xl transition ${
                                    selected
                                      ? "border-blue-500 bg-blue-50 ring-1 ring-blue-200"
                                      : unlocked
                                        ? "border-gray-200 hover:bg-gray-50"
                                        : "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-300"
                                  }`}
                                  aria-label={
                                    unlocked
                                      ? `${entry.label} 아이콘 선택`
                                      : `${unlockTierLabel} 등급에서 열리는 잠금 아이콘`
                                  }
                                >
                                  <span className="leading-none">
                                    {entry.value}
                                  </span>
                                  {selected && (
                                    <span className="mt-1 text-[10px] font-bold text-blue-700 whitespace-nowrap">
                                      선택됨
                                    </span>
                                  )}
                                  {!unlocked && (
                                    <span className="absolute right-2 top-2 text-[10px] text-gray-500">
                                      <i className="fas fa-lock"></i>
                                    </span>
                                  )}
                                </button>
                              ),
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyPage;
