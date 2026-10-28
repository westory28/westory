import PortalWorkspace from "../../components/common/PortalWorkspace";
import PortalSubNavigation from "../../components/common/PortalSubNavigation";
import NumericInput from "../../components/common/NumericInput";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { useAppToast } from "../../components/common/AppToastProvider";
import PointRankBadge from "../../components/common/PointRankBadge";
import { useAuth } from "../../contexts/AuthContext";
import { subscribePointsUpdated } from "../../lib/appEvents";
import { db } from "../../lib/firebase";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import { getStudentPointWallet as getPointWalletByUid } from "../../lib/studentWis";
import {
  getPointPolicy,
  POINT_POLICY_FALLBACK,
  updateStudentProfileIcon,
} from "../../lib/points";
import {
  getPointRankDefaultEmojiValue,
  getPointRankEmojiRegistry,
  getPointRankTierDisplayItems,
  getPointRankTierMeta,
  getPointRankUnlockTierCodeForEmoji,
} from "../../lib/pointRanks";
import { resolveStudentProfileEmoji } from "../../lib/studentProfileEmoji";
import { formatWisAmount } from "../../lib/pointFormatters";
import {
  formatPerformanceScore,
  getPerformanceScorePercent,
  loadUserPerformanceScoreRecords,
  type PerformanceScoreRecord,
} from "../../lib/performanceScores";
import { getDefaultProfileEmojiValue } from "../../lib/profileEmojis";
import {
  getSemesterCollectionPath,
  getYearSemester,
} from "../../lib/semesterScope";
import MyQuizHistory from "./mypage/MyQuizHistory";
import {
  loadStudentProgressSummary,
  type StudentProgressSummary,
} from "../../lib/studentProgressSummary";
import {
  buildScoreRows as buildSharedScoreRows,
  buildSubjectScoreInsights as buildSharedSubjectScoreInsights,
  getTeacherAdviceText as getSharedTeacherAdviceText,
  type GradingPlanLike,
} from "../../lib/studentScores";
import type { PointPolicy, PointWallet } from "../../types";
import "./mypage/MyPage.css";

const LazyChart = lazyWithRetry(
  () => import("../../components/common/LazyChart"),
  "student-my-page-chart",
);

const StudentAvatarStudio = lazyWithRetry(
  () => import("../../features/avatar/AvatarStudio"),
  "student-avatar-studio",
);

type MainMenu = "profile" | "score" | "wrong_note" | "avatar";

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
  const { user, userData, config, authGeneration } = useAuth();
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
  const [menuOpen, setMenuOpen] = useState(false);
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
  const [loadedPointRankKey, setLoadedPointRankKey] = useState("");
  const [pointRankError, setPointRankError] = useState("");
  const pointRankRequestRef = useRef(0);
  const pointRankScopeKey = `${user?.uid}:${config?.year}:${config?.semester}`;
  const pointRankScopeRef = useRef(pointRankScopeKey);
  pointRankScopeRef.current = pointRankScopeKey;
  const pointRankReady =
    loadedPointRankKey === pointRankScopeKey && !!pointWallet;

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
  const performanceScopeRef = useRef("");
  const performanceRequestRef = useRef(0);

  const [progressSummary, setProgressSummary] =
    useState<StudentProgressSummary | null>(null);
  const [progressSummaryLoading, setProgressSummaryLoading] = useState(false);
  const [gradeLabelMap, setGradeLabelMap] = useState<Record<string, string>>(
    {},
  );
  const [classLabelMap, setClassLabelMap] = useState<Record<string, string>>(
    {},
  );

  const myPageRequestRef = useRef(0);

  useEffect(() => {
    void loadMyPage();
    return () => {
      myPageRequestRef.current += 1;
    };
  }, [
    user?.uid,
    config?.year,
    config?.semester,
    canUseLesson,
    canUseQuiz,
    canUseScore,
  ]);

  useEffect(() => {
    const scopeKey = `${user?.uid}:${config?.year}:${config?.semester}`;
    if (menu !== "score" || !canUseScore || !user || !config) return;
    if (performanceScopeRef.current === scopeKey) return;
    performanceScopeRef.current = scopeKey;
    void loadPerformanceScoreData();
  }, [menu, canUseScore, user?.uid, config?.year, config?.semester]);

  useEffect(
    () => () => {
      performanceRequestRef.current += 1;
    },
    [],
  );

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

  useEffect(() => {
    if (
      requestedMenu === "profile" ||
      requestedMenu === "avatar" ||
      requestedMenu === "score" ||
      requestedMenu === "wrong_note"
    ) {
      setMenu(isMenuAvailable(requestedMenu) ? requestedMenu : "profile");
    } else if (!isMenuAvailable(menu)) {
      setMenu("profile");
    }
  }, [requestedMenu, canUseQuiz, canUseScore, menu]);

  const loadMyPage = async () => {
    if (!user || !config) {
      setProgressSummary(null);
      return;
    }
    const requestId = ++myPageRequestRef.current;
    await Promise.all([
      loadProfileAndEmoji(requestId),
      canUseScore ? loadScoreData(requestId) : resetScoreData(),
      !canUseScore ? resetPerformanceScoreData() : Promise.resolve(),
      loadProgressSummary(requestId),
    ]);
  };

  const resetScoreData = async () => {
    setScoreRows([]);
    setScoreChartData(null);
  };

  const resetPerformanceScoreData = async () => {
    performanceRequestRef.current += 1;
    performanceScopeRef.current = "";
    setPerformanceScores([]);
    setPerformanceScoresLoading(false);
  };

  const loadProgressSummary = async (requestId = myPageRequestRef.current) => {
    if (!user || !config) return;
    setProgressSummaryLoading(true);
    try {
      const summary = await loadStudentProgressSummary(config, user.uid, {
        includeQuiz: false,
        includeHistoryClassroom: false,
      });
      if (requestId === myPageRequestRef.current) setProgressSummary(summary);
    } catch (error) {
      console.error("Failed to load my progress summary:", error);
      if (requestId === myPageRequestRef.current) setProgressSummary(null);
    } finally {
      if (requestId === myPageRequestRef.current)
        setProgressSummaryLoading(false);
    }
  };

  const loadProfileAndEmoji = async (requestId = myPageRequestRef.current) => {
    if (!user) return;

    const [userSnap, schoolSnap] = await Promise.all([
      getDoc(doc(db, "users", user.uid)),
      getDoc(doc(db, "site_settings", "school_config")),
    ]);
    if (requestId !== myPageRequestRef.current) return;

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
    const requestId = ++pointRankRequestRef.current;
    const scopeKey = pointRankScopeKey;
    setLoadedPointRankKey("");
    setPointRankError("");
    if (!user || !config) return;
    try {
      const [nextWallet, nextPolicy] = await Promise.all([
        getPointWalletByUid(config, user.uid),
        getPointPolicy(config),
      ]);
      if (
        requestId !== pointRankRequestRef.current ||
        scopeKey !== pointRankScopeRef.current
      )
        return;
      if (!nextWallet)
        throw new Error("현재 학기의 위스 계정을 확인하지 못했습니다.");
      setPointWallet(nextWallet);
      setPointPolicy(nextPolicy);
      setLoadedPointRankKey(scopeKey);
    } catch (error) {
      if (
        requestId !== pointRankRequestRef.current ||
        scopeKey !== pointRankScopeRef.current
      )
        return;
      console.error("Failed to load current semester emoji rank:", error);
      setPointWallet(null);
      setPointRankError("현재 학기 위스를 불러오지 못했습니다.");
    }
  };

  useEffect(() => {
    void loadPointRankState();
    const unsubscribe = subscribePointsUpdated(() => {
      void loadPointRankState();
    });
    return () => {
      pointRankRequestRef.current += 1;
      unsubscribe();
    };
  }, [user?.uid, config?.year, config?.semester, iconModalOpen]);

  const loadScoreData = async (requestId = myPageRequestRef.current) => {
    if (!user || !config) return;

    const year = config.year || "2026";
    const semester = config.semester || "1";
    const scoreDocId = `${year}_${semester}`;

    const [scoreSnap, plansSnap] = await Promise.all([
      getDoc(doc(db, "users", user.uid, "academic_records", scoreDocId)),
      getDocs(
        collection(db, getSemesterCollectionPath(config, "grading_plans")),
      ),
    ]);
    const scoreMap = scoreSnap.exists() ? scoreSnap.data().scores || {} : {};
    let targetGrade = normalizeClassValue(userData?.grade);
    if (!targetGrade) {
      const userSnap = await getDoc(doc(db, "users", user.uid));
      if (userSnap.exists()) {
        targetGrade = normalizeClassValue(
          (userSnap.data() as UserProfileDoc).grade,
        );
      }
    }

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

    if (requestId !== myPageRequestRef.current) return;
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
    const requestId = ++performanceRequestRef.current;
    const scopeKey = `${user.uid}:${config.year}:${config.semester}`;
    setPerformanceScoresLoading(true);
    setPerformanceScores([]);
    try {
      const year = String(config.year || "2026");
      const semester = String(config.semester || "1");
      const records = await loadUserPerformanceScoreRecords(user.uid, {
        year,
        semester,
      });
      if (
        requestId === performanceRequestRef.current &&
        scopeKey === pointRankScopeRef.current
      )
        setPerformanceScores(records);
    } catch (error) {
      console.error("Failed to load my performance scores:", error);
      if (requestId === performanceRequestRef.current) {
        performanceScopeRef.current = "";
        setPerformanceScores([]);
      }
    } finally {
      if (requestId === performanceRequestRef.current)
        setPerformanceScoresLoading(false);
    }
  };

  const orderedEmojiEntries = useMemo(
    () => getPointRankEmojiRegistry(pointPolicy.rankPolicy),
    [pointPolicy.rankPolicy],
  );
  const safePointWallet = pointWallet || DEFAULT_POINT_WALLET;
  const emojiState = useMemo(
    () =>
      resolveStudentProfileEmoji(
        pointPolicy.rankPolicy,
        pointRankReady ? Number(safePointWallet.rankEarnedTotal || 0) : 0,
        pointRankReady
          ? {
              profileEmojiId:
                profile?.profileEmojiId || userData?.profileEmojiId,
              profileIcon,
            }
          : null,
      ),
    [
      pointPolicy.rankPolicy,
      pointRankReady,
      safePointWallet.rankEarnedTotal,
      profile?.profileEmojiId,
      userData?.profileEmojiId,
      profileIcon,
    ],
  );
  const currentRank = pointRankReady ? emojiState.rank : null;
  const allowedEmojiIds = useMemo(
    () => (pointRankReady ? emojiState.allowedEmojiIds : []),
    [pointRankReady, emojiState.allowedEmojiIds],
  );
  const selectedEmojiEntry = pointRankReady ? emojiState.entry : null;
  const defaultProfileEmojiValue =
    getPointRankDefaultEmojiValue(pointPolicy.rankPolicy) ||
    getDefaultProfileEmojiValue();
  const displayProfileIcon =
    selectedEmojiEntry?.emoji || defaultProfileEmojiValue;
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
        message: "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setSavingGoal(false);
    }
  };

  const saveProfileIcon = async (nextEmojiId: string) => {
    if (
      !user ||
      !config ||
      !pointRankReady ||
      !allowedEmojiIds.includes(nextEmojiId)
    )
      return;
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
      showToast({ tone: "success", title: "프로필 아이콘을 저장했습니다." });
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

  const subjectInsights = useMemo<SubjectScoreInsight[]>(() => {
    return buildSharedSubjectScoreInsights(
      scoreRows.filter((row) =>
        row.breakdown.some((item) => item.entered),
      ) as any,
      subjectGoals,
    );
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
    { key: "avatar", title: "아바타 꾸미기", icon: "fa-shirt" },
    { key: "score", title: "나의 성적표", icon: "fa-chart-column" },
    { key: "wrong_note", title: "응시 기록", icon: "fa-book-open" },
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
  const focusScoreSubject = (subject?: SubjectScoreInsight | null) => {
    if (!canUseScore) return;
    if (subject?.subject) setSelectedSubject(subject.subject);
    selectMenu("score");
  };
  const profileMetricCards = [
    ...(canUseLesson
      ? [
          {
            icon: "fa-book-open",
            label: "학습 진행",
            value: progressSummaryLoading
              ? "불러오는 중"
              : lessonTotalCount
                ? `${lessonProgressPercent}%`
                : "학습 기록 없음",
            color: "blue",
            percent: lessonTotalCount ? lessonProgressPercent : null,
            onClick: openNextLesson,
          },
        ]
      : []),
    ...(canUseQuiz && progressSummary?.historyClassroom.totalAttempts
      ? [
          {
            icon: "fa-users",
            label: "역사교실 통과율",
            value: progressSummary?.historyClassroom.totalAttempts
              ? `${historyParticipationPercent}%`
              : "응시 기록 없음",
            color: "violet",
            percent: progressSummary?.historyClassroom.totalAttempts
              ? historyParticipationPercent
              : null,
            onClick: openHistoryClassroom,
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
            title: "응시 기록 · 오답 복습",
            subtitle: "틀린 문제 다시 보기",
            icon: "fa-pen",
            tone: "bg-violet-50 text-violet-600",
            onClick: () => selectMenu("wrong_note"),
          },
        ]
      : []),
  ];
  return (
    <div className="student-my-page min-h-screen bg-slate-50 flex flex-col">
      <PortalWorkspace
        as="main"
        className="teacher-sub-workspace teacher-sub-workspace--page teacher-sub-workspace--tabs ws-page--reading flex-1"
      >
        <PortalSubNavigation
          variant="tabs"
          title="마이페이지"
          activeLabel={
            leftMenus.find((item) => item.key === menu)?.title || "메뉴 선택"
          }
          open={menuOpen}
          onOpenChange={setMenuOpen}
        >
          {leftMenus
            .filter((item) => isMenuAvailable(item.key))
            .map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  selectMenu(item.key);
                  setMenuOpen(false);
                }}
                className={`teacher-settings-section${menu === item.key ? " is-active" : ""}`}
                aria-current={menu === item.key ? "page" : undefined}
              >
                <i className={`fas ${item.icon} shrink-0`} aria-hidden="true" />
                <span title={item.title} className="teacher-navigation-label">
                  {item.title}
                </span>
              </button>
            ))}
        </PortalSubNavigation>

        <section className="teacher-sub-content">
          <div className="space-y-8">
            {menu === "avatar" && (
              <React.Suspense
                fallback={
                  <div role="status">아바타 꾸미기를 불러오는 중입니다.</div>
                }
              >
                <StudentAvatarStudio />
              </React.Suspense>
            )}
            {menu === "profile" && (
              <div className="student-my-page__panel">
                <h2 className="sr-only">나의 기본 정보</h2>
                <div className="student-my-page__profile">
                  <div className="student-my-page__identity">
                    <div className="flex items-center gap-4">
                      <div className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-blue-50 text-4xl ring-1 ring-blue-100">
                        {displayProfileIcon}
                        <button
                          type="button"
                          onClick={() => setIconModalOpen(true)}
                          className="absolute -bottom-2 -right-2 inline-flex h-11 min-w-11 items-center justify-center whitespace-nowrap rounded-full border border-blue-100 bg-white px-2 text-[11px] font-extrabold text-blue-700 shadow-sm"
                        >
                          변경
                        </button>
                      </div>

                      <div className="min-w-0">
                        <div className="text-2xl font-bold tracking-tight text-slate-900">
                          {profile?.name || userData?.name || "학생"}
                        </div>
                        <div className="mt-2 text-base font-semibold text-slate-600">
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
                      </div>
                    </div>
                  </div>

                  {profileMetricCards.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={item.onClick}
                      className="student-my-page__progress text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
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
                        className={`mt-4 text-3xl font-bold ${
                          item.color === "emerald"
                            ? "text-emerald-600"
                            : item.color === "violet"
                              ? "text-violet-600"
                              : "text-blue-600"
                        }`}
                      >
                        {item.value}
                      </div>
                      {item.percent !== null && (
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
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
                      )}
                    </button>
                  ))}
                </div>

                {canUseScore && subjectInsights.length > 0 && (
                  <section className="ws-flat-section student-my-page__section student-my-page__score-overview">
                    <div className="flex flex-wrap items-center justify-between gap-5">
                      <div>
                        <div className="flex items-center gap-3">
                          <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                            <i className="fas fa-chart-column"></i>
                          </span>
                          <h3 className="text-xl font-black text-slate-900">
                            점수 계산 요약
                          </h3>
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-3">
                          <div className="px-1 py-2">
                            <div className="text-xs font-bold text-slate-400">
                              계산한 점수 평균
                            </div>
                            <div className="mt-1 text-2xl font-black text-blue-600">
                              {subjectInsights.length
                                ? `${scoreAverage}점`
                                : "등록 점수 없음"}
                            </div>
                          </div>
                          <div className="px-1 py-2">
                            <div className="text-xs font-bold text-slate-400">
                              목표 달성
                            </div>
                            <div className="mt-1 text-2xl font-black text-emerald-600">
                              {targetMetCount}개
                            </div>
                          </div>
                          <div className="px-1 py-2">
                            <div className="text-xs font-bold text-slate-400">
                              다음 확인
                            </div>
                            <div className="mt-1 truncate text-lg font-black text-slate-700">
                              {topNeedsCareSubject?.subject || "—"}
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
              </div>
            )}

            {menu === "score" && (
              <div className="student-my-page__panel">
                <h2 className="sr-only">나의 성적표</h2>

                <div className="student-my-page__score-metrics">
                  {[
                    {
                      icon: "fa-arrow-trend-up",
                      label: "계산한 점수 평균",
                      value: `${subjectInsights.length ? `${scoreAverage}점` : "등록 점수 없음"}`,
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
                      className="flex min-w-0 items-center gap-3"
                    >
                      <span
                        className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg ${
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
                          className={`mt-2 text-2xl font-bold ${
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
                  <section className="ws-flat-section student-my-page__section">
                    <h3 className="text-xl font-black text-slate-900">
                      나의 평가
                    </h3>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        className="min-h-11 rounded-lg bg-blue-600 px-4 text-white font-bold"
                        onClick={() => selectMenu("wrong_note")}
                      >
                        응시 기록 · 오답 복습
                      </button>
                      <button
                        type="button"
                        className="min-h-11 rounded-lg border border-slate-200 px-4 font-bold"
                        onClick={openQuiz}
                      >
                        평가 풀기
                      </button>
                      <button
                        type="button"
                        className="min-h-11 rounded-lg border border-slate-200 px-4 font-bold"
                        onClick={openHistoryClassroom}
                      >
                        역사교실 기록 보기
                      </button>
                    </div>
                  </section>
                )}

                <section className="ws-flat-section student-my-page__section">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="text-xl font-black text-slate-900">
                        내 수행평가 점수
                      </h3>
                    </div>
                    <Link
                      to="/student/score/performance"
                      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm font-extrabold text-blue-700 transition hover:bg-blue-100"
                    >
                      자세히 보기
                      <i className="fas fa-chevron-right text-xs"></i>
                    </Link>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                    {performanceScoresLoading ? (
                      <div
                        role="status"
                        className="py-4 text-sm text-slate-500 md:col-span-2"
                      >
                        수행평가 점수를 불러오는 중입니다.
                      </div>
                    ) : performanceScores.length === 0 ? (
                      <div className="py-4 text-sm text-slate-500 md:col-span-2">
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

                <div className="student-my-page__columns">
                  <section className="ws-flat-section student-my-page__section">
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
                            className="grid min-h-11 w-full grid-cols-[64px_1fr_auto] items-center gap-3 text-left"
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

                  <section className="ws-flat-section student-my-page__section">
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

                        <div className="flex flex-wrap items-center gap-2">
                          <label
                            htmlFor="my-subject-goal"
                            className="text-sm font-bold text-slate-700"
                          >
                            과목 목표
                          </label>
                          <NumericInput
                            id="my-subject-goal"
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

                <div className="student-my-page__columns">
                  <section className="ws-flat-section student-my-page__section">
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

                  <section className="ws-flat-section student-my-page__section">
                    <h3 className="text-xl font-black text-slate-900">
                      다음 목표
                    </h3>
                    <div className="mt-4 flex items-center gap-4">
                      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xl text-blue-600">
                        <i className="fas fa-bullseye"></i>
                      </span>
                      <div className="min-w-0">
                        <div className="text-base font-extrabold leading-7 text-slate-700">
                          {topNeedsCareSubject
                            ? `${topNeedsCareSubject.subject} 목표 점수 ${topNeedsCareSubject.target}점 달성하기`
                            : "현재 목표를 유지하기"}
                        </div>
                        {goalScore && (
                          <div className="mt-2 text-sm text-slate-500">
                            {goalScore}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-6 flex gap-2">
                      <input
                        aria-label="이번 학기 목표"
                        lang="ko"
                        inputMode="text"
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

            {canUseQuiz && user && config && (
              <MyQuizHistory
                key={
                  user.uid +
                  ":" +
                  authGeneration +
                  ":" +
                  getYearSemester(config).year +
                  "-" +
                  getYearSemester(config).semester
                }
                semesterId={
                  getYearSemester(config).year +
                  "-" +
                  getYearSemester(config).semester
                }
                active={menu === "wrong_note"}
                requestedAttemptId={requestedAttemptId}
                onSelect={(key) =>
                  setSearchParams({ menu: "wrong_note", attemptId: key })
                }
                onClose={() => setSearchParams({ menu: "wrong_note" })}
                onStart={openQuiz}
              />
            )}
          </div>
        </section>
      </PortalWorkspace>

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
              {!pointRankReady && (
                <div
                  className="mt-2 text-xs leading-5 text-gray-500"
                  role="status"
                >
                  {pointRankError || "현재 학기 위스를 불러오는 중입니다."}
                  {pointRankError && (
                    <button
                      type="button"
                      className="ml-2 text-blue-600 underline"
                      onClick={() => void loadPointRankState()}
                    >
                      다시 시도
                    </button>
                  )}
                </div>
              )}
            </div>

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
