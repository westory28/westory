import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";
import {
  getPointPolicy,
  getPointRankManualAdjustEarnedPointsByUid,
  getPointWalletByUid,
  POINT_POLICY_FALLBACK,
} from "./points";
import {
  getPointRankDisplay,
  needsPointRankLegacyFallback,
  type PointRankDisplay,
} from "./pointRanks";
import { getSemesterCollectionPath } from "./semesterScope";
import type { PointWallet, SystemConfig } from "../types";

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;

interface FirestoreTimestampLike {
  seconds?: number;
}

interface LessonDoc {
  unitId?: string;
  title?: string;
  isVisibleToStudents?: boolean;
}

interface LessonProgressDoc {
  unitId?: string;
  answers?: Record<string, { value?: string; status?: string }>;
  updatedAt?: FirestoreTimestampLike;
}

interface QuizResultDoc {
  id: string;
  unitId?: string;
  category?: string;
  score?: number;
  timestamp?: FirestoreTimestampLike;
  timeString?: string;
  details?: Array<{ correct?: boolean }>;
}

interface HistoryClassroomResultDoc {
  id: string;
  assignmentTitle?: string;
  score?: number;
  total?: number;
  percent?: number;
  passed?: boolean;
  status?: string;
  createdAt?: FirestoreTimestampLike;
}

export interface SummarySectionState {
  unavailable: boolean;
  message?: string;
}

export interface StudentLessonProgressSummary extends SummarySectionState {
  totalLessons: number;
  savedUnits: number;
  completedUnits: number;
  latestUnitTitle: string;
  latestUpdatedAtText: string;
}

export interface StudentQuizProgressSummary extends SummarySectionState {
  totalAttempts: number;
  averageScore: number;
  wrongCount: number;
  latestTitle: string;
  latestScore: number | null;
  latestDateText: string;
}

export interface StudentHistoryClassroomSummary extends SummarySectionState {
  totalAttempts: number;
  passedCount: number;
  averagePercent: number;
  latestTitle: string;
  latestStatusLabel: string;
  latestDateText: string;
}

export interface StudentWisSummary extends SummarySectionState {
  wallet: PointWallet | null;
  currentRank: PointRankDisplay | null;
  balance: number;
  earnedTotal: number;
  spentTotal: number;
  nextRankGap: number;
}

export interface StudentProgressSummary {
  lesson: StudentLessonProgressSummary;
  quiz: StudentQuizProgressSummary;
  historyClassroom: StudentHistoryClassroomSummary;
  wis: StudentWisSummary;
}

const emptyLessonSummary = (
  message?: string,
): StudentLessonProgressSummary => ({
  unavailable: Boolean(message),
  message,
  totalLessons: 0,
  savedUnits: 0,
  completedUnits: 0,
  latestUnitTitle: "",
  latestUpdatedAtText: "",
});

const emptyQuizSummary = (message?: string): StudentQuizProgressSummary => ({
  unavailable: Boolean(message),
  message,
  totalAttempts: 0,
  averageScore: 0,
  wrongCount: 0,
  latestTitle: "",
  latestScore: null,
  latestDateText: "",
});

const emptyHistoryClassroomSummary = (
  message?: string,
): StudentHistoryClassroomSummary => ({
  unavailable: Boolean(message),
  message,
  totalAttempts: 0,
  passedCount: 0,
  averagePercent: 0,
  latestTitle: "",
  latestStatusLabel: "",
  latestDateText: "",
});

const emptyWisSummary = (message?: string): StudentWisSummary => ({
  unavailable: Boolean(message),
  message,
  wallet: null,
  currentRank: null,
  balance: 0,
  earnedTotal: 0,
  spentTotal: 0,
  nextRankGap: 0,
});

const timestampMs = (value: unknown) => {
  const seconds = Number(
    (value as FirestoreTimestampLike | undefined)?.seconds || 0,
  );
  return seconds > 0 ? seconds * 1000 : 0;
};

const formatDateTime = (value: unknown, fallback = "") => {
  const ms = timestampMs(value);
  if (!ms) return fallback;
  return new Date(ms).toLocaleString("ko-KR");
};

const getQuizCategoryLabel = (category?: string) => {
  if (category === "diagnostic") return "진단평가";
  if (category === "formative") return "형성평가";
  if (category === "exam_prep") return "학기 시험 대비";
  return "평가";
};

const getHistoryStatusLabel = (result: HistoryClassroomResultDoc) => {
  if (result.status === "passed" || result.passed) return "통과";
  if (result.status === "failed") return "미통과";
  if (result.status === "cancelled") return "자동 종료";
  return "결과 없음";
};

const isProgressCompleted = (progress: LessonProgressDoc) => {
  const answers = Object.values(progress.answers || {});
  return (
    answers.length > 0 &&
    answers.every((answer) => String(answer?.value || "").trim())
  );
};

const getProgressFilledCount = (progress: LessonProgressDoc) =>
  Object.values(progress.answers || {}).filter((answer) =>
    String(answer?.value || "").trim(),
  ).length;

const readLessons = async (config: ConfigLike) => {
  const readCollection = async (path: string) => {
    const snap = await getDocs(collection(db, path));
    return snap.docs
      .map((item) => item.data() as LessonDoc)
      .map((item) => ({
        unitId: String(item.unitId || "").trim(),
        title: String(item.title || "").trim(),
        visible: item.isVisibleToStudents !== false,
      }))
      .filter((item) => item.unitId && item.visible);
  };

  const semesterLessons = await readCollection(
    getSemesterCollectionPath(config, "lessons"),
  );
  return semesterLessons.length ? semesterLessons : readCollection("lessons");
};

const loadLessonSummary = async (
  config: ConfigLike,
  uid: string,
): Promise<StudentLessonProgressSummary> => {
  try {
    const lessons = await readLessons(config);
    const titleByUnitId = new Map(
      lessons.map((lesson) => [lesson.unitId, lesson.title || lesson.unitId]),
    );
    const progressSnap = await getDocs(
      collection(
        db,
        `${getSemesterCollectionPath(config, "lesson_progress")}/${uid}/units`,
      ),
    );
    const progressItems = progressSnap.docs
      .map((item) => item.data() as LessonProgressDoc)
      .map((item) => ({
        ...item,
        unitId: String(item.unitId || "").trim(),
      }))
      .filter((item) => item.unitId);
    const savedItems = progressItems.filter(
      (item) =>
        getProgressFilledCount(item) > 0 || timestampMs(item.updatedAt) > 0,
    );
    const latest =
      [...savedItems].sort(
        (a, b) => timestampMs(b.updatedAt) - timestampMs(a.updatedAt),
      )[0] || null;

    return {
      unavailable: false,
      totalLessons: lessons.length,
      savedUnits: savedItems.length,
      completedUnits: savedItems.filter(isProgressCompleted).length,
      latestUnitTitle: latest
        ? titleByUnitId.get(latest.unitId) || latest.unitId
        : "",
      latestUpdatedAtText: latest ? formatDateTime(latest.updatedAt) : "",
    };
  } catch (error) {
    console.warn("Failed to load student lesson progress summary:", error);
    return emptyLessonSummary(
      "수업 자료 진행률을 읽을 권한이 없거나 데이터를 불러오지 못했습니다.",
    );
  }
};

const loadQuizSummary = async (
  config: ConfigLike,
  uid: string,
): Promise<StudentQuizProgressSummary> => {
  try {
    const resultSnap = await getDocs(
      query(
        collection(db, getSemesterCollectionPath(config, "quiz_results")),
        where("uid", "==", uid),
      ),
    );
    const results = resultSnap.docs
      .map((item) => ({
        id: item.id,
        ...(item.data() as Omit<QuizResultDoc, "id">),
      }))
      .sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp));
    if (!results.length) return emptyQuizSummary();

    const totalScore = results.reduce(
      (sum, item) => sum + Number(item.score || 0),
      0,
    );
    const wrongCount = results.reduce(
      (sum, item) =>
        sum +
        (Array.isArray(item.details)
          ? item.details.filter((detail) => !detail.correct).length
          : 0),
      0,
    );
    const latest = results[0];
    return {
      unavailable: false,
      totalAttempts: results.length,
      averageScore: Math.round(totalScore / results.length),
      wrongCount,
      latestTitle: `${latest.unitId || "단원"} · ${getQuizCategoryLabel(latest.category)}`,
      latestScore: Number(latest.score || 0),
      latestDateText: formatDateTime(latest.timestamp, latest.timeString || ""),
    };
  } catch (error) {
    console.warn("Failed to load student quiz summary:", error);
    return emptyQuizSummary(
      "평가 응시 기록을 읽을 권한이 없거나 데이터를 불러오지 못했습니다.",
    );
  }
};

const loadHistoryClassroomSummary = async (
  config: ConfigLike,
  uid: string,
): Promise<StudentHistoryClassroomSummary> => {
  try {
    const readResults = async (path: string) => {
      const snap = await getDocs(
        query(collection(db, path), where("uid", "==", uid)),
      );
      return snap.docs.map((item) => ({
        id: item.id,
        ...(item.data() as Omit<HistoryClassroomResultDoc, "id">),
      }));
    };
    let results = await readResults(
      getSemesterCollectionPath(config, "history_classroom_results"),
    );
    if (!results.length) {
      results = await readResults("history_classroom_results");
    }
    results.sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt));
    if (!results.length) return emptyHistoryClassroomSummary();

    const latest = results[0];
    const averagePercent = Math.round(
      results.reduce((sum, item) => sum + Number(item.percent || 0), 0) /
        results.length,
    );
    return {
      unavailable: false,
      totalAttempts: results.length,
      passedCount: results.filter(
        (item) => item.status === "passed" || item.passed,
      ).length,
      averagePercent,
      latestTitle: latest.assignmentTitle || "역사교실",
      latestStatusLabel: getHistoryStatusLabel(latest),
      latestDateText: formatDateTime(latest.createdAt),
    };
  } catch (error) {
    console.warn("Failed to load student history classroom summary:", error);
    return emptyHistoryClassroomSummary(
      "역사교실 결과를 읽을 권한이 없거나 데이터를 불러오지 못했습니다.",
    );
  }
};

const loadWisSummary = async (
  config: ConfigLike,
  uid: string,
): Promise<StudentWisSummary> => {
  try {
    const [wallet, policy] = await Promise.all([
      getPointWalletByUid(config, uid),
      getPointPolicy(config).catch(() => POINT_POLICY_FALLBACK),
    ]);
    const rankManualAdjustPoints =
      wallet && needsPointRankLegacyFallback(wallet)
        ? await getPointRankManualAdjustEarnedPointsByUid(config, uid)
        : 0;
    const currentRank = getPointRankDisplay({
      rankPolicy: policy.rankPolicy,
      wallet,
      earnedPointsFromTransactions: rankManualAdjustPoints,
    });
    return {
      unavailable: false,
      wallet,
      currentRank,
      balance: Number(wallet?.balance || 0),
      earnedTotal: Number(wallet?.earnedTotal || wallet?.rankEarnedTotal || 0),
      spentTotal: Number(wallet?.spentTotal || 0),
      nextRankGap: Number(currentRank?.remainingToNext || 0),
    };
  } catch (error) {
    console.warn("Failed to load student WIS summary:", error);
    return emptyWisSummary(
      "위스 정보를 읽을 권한이 없거나 데이터를 불러오지 못했습니다.",
    );
  }
};

export const loadStudentProgressSummary = async (
  config: ConfigLike,
  uid: string,
): Promise<StudentProgressSummary> => {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    return {
      lesson: emptyLessonSummary(
        "학생 정보가 없어 수업 자료 진행률을 불러오지 못했습니다.",
      ),
      quiz: emptyQuizSummary(
        "학생 정보가 없어 평가 기록을 불러오지 못했습니다.",
      ),
      historyClassroom: emptyHistoryClassroomSummary(
        "학생 정보가 없어 역사교실 결과를 불러오지 못했습니다.",
      ),
      wis: emptyWisSummary("학생 정보가 없어 위스 정보를 불러오지 못했습니다."),
    };
  }

  const [lesson, quiz, historyClassroom, wis] = await Promise.all([
    loadLessonSummary(config, safeUid),
    loadQuizSummary(config, safeUid),
    loadHistoryClassroomSummary(config, safeUid),
    loadWisSummary(config, safeUid),
  ]);

  return {
    lesson,
    quiz,
    historyClassroom,
    wis,
  };
};
