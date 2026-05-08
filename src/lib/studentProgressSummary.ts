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
import { normalizeBlankText } from "./lessonWorksheet";
import { getSemesterCollectionPath, getSemesterDocPath } from "./semesterScope";
import type { PointWallet, SystemConfig } from "../types";

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;

interface FirestoreTimestampLike {
  seconds?: number;
}

interface LessonDoc {
  id?: string;
  unitId?: string;
  title?: string;
  isVisibleToStudents?: boolean;
  contentHtml?: string;
  worksheetBlanks?: Array<{ id?: string; answer?: string }>;
}

interface LessonTreeNode {
  id?: string;
  title?: string;
  children?: LessonTreeNode[];
}

interface LessonProgressDoc {
  unitId?: string;
  answers?: Record<string, { value?: string; status?: string }>;
  updatedAt?: FirestoreTimestampLike;
}

export interface StudentQuizResultDoc {
  id: string;
  unitId?: string;
  category?: string;
  score?: number;
  timestamp?: FirestoreTimestampLike;
  timeString?: string;
  details?: Array<{ id?: string | number; correct?: boolean; u?: string }>;
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

export interface StudentLessonUnitProgressSummary {
  unitId: string;
  title: string;
  blankCount: number;
  filledCount: number;
  correctCount: number;
  submitted: boolean;
  submissionLabel: "제출" | "미제출";
  status: "completed" | "in_progress" | "not_started" | "no_blanks";
  statusLabel: string;
  latestUpdatedAtText: string;
}

export interface StudentLessonProgressSummary extends SummarySectionState {
  totalLessons: number;
  worksheetUnits: number;
  savedUnits: number;
  completedUnits: number;
  latestUnitTitle: string;
  latestUpdatedAtText: string;
  units: StudentLessonUnitProgressSummary[];
}

export interface StudentQuizResultSummary {
  id: string;
  unitTitle: string;
  category: string;
  categoryLabel: string;
  score: number;
  wrongCount: number;
  dateText: string;
}

export interface StudentQuizGroupSummary {
  unitTitle: string;
  category: string;
  categoryLabel: string;
  totalAttempts: number;
  averageScore: number;
  latestScore: number | null;
  wrongCount: number;
  latestDateText: string;
}

export interface StudentQuizProgressSummary extends SummarySectionState {
  totalAttempts: number;
  averageScore: number;
  wrongCount: number;
  latestTitle: string;
  latestScore: number | null;
  latestDateText: string;
  groups: StudentQuizGroupSummary[];
  recentResults: StudentQuizResultSummary[];
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
  worksheetUnits: 0,
  savedUnits: 0,
  completedUnits: 0,
  latestUnitTitle: "",
  latestUpdatedAtText: "",
  units: [],
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
  groups: [],
  recentResults: [],
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

const getDisplayUnitTitle = (
  unitId: string | undefined,
  titleByUnitId: Map<string, string>,
) => {
  const safeUnitId = String(unitId || "").trim();
  return safeUnitId
    ? titleByUnitId.get(safeUnitId) || "단원명 없음"
    : "단원명 없음";
};

const getHistoryStatusLabel = (result: HistoryClassroomResultDoc) => {
  if (result.status === "passed" || result.passed) return "통과";
  if (result.status === "failed") return "미통과";
  if (result.status === "cancelled") return "자동 종료";
  return "결과 없음";
};

const hasSavedProgress = (progress?: LessonProgressDoc) =>
  Boolean(
    progress &&
    (timestampMs(progress.updatedAt) > 0 ||
      Object.keys(progress.answers || {}).length > 0),
  );

const getInlineLessonBlankAnswers = (contentHtml?: string) => {
  const matches = String(contentHtml || "").matchAll(/\[(.*?)\]/g);
  const answers = new Map<string, string>();
  Array.from(matches).forEach((match) => {
    const token = String(match[1] || "").trim();
    if (!token || token.startsWith("fn:")) return;
    answers.set(String(answers.size), token);
  });
  return answers;
};

const getLessonBlankAnswers = (lesson: LessonDoc) => {
  const answers = getInlineLessonBlankAnswers(lesson.contentHtml);
  if (Array.isArray(lesson.worksheetBlanks)) {
    lesson.worksheetBlanks.forEach((blank) => {
      const key = String(blank?.id || "").trim();
      if (!key) return;
      answers.set(key, String(blank?.answer || ""));
    });
  }
  return answers;
};

const getLessonUnitStatus = (
  blankAnswers: Map<string, string>,
  progress?: LessonProgressDoc,
) => {
  const blankKeys = Array.from(blankAnswers.keys());
  const submitted = hasSavedProgress(progress);
  if (!blankKeys.length) {
    return {
      blankCount: 0,
      filledCount: 0,
      correctCount: 0,
      submitted,
      submissionLabel: submitted ? "제출" : "미제출",
      status: "no_blanks" as const,
      statusLabel: "빈칸 없음",
    };
  }

  const answers = progress?.answers || {};
  const filledCount = blankKeys.filter((key) =>
    String(answers[key]?.value || "").trim(),
  ).length;
  const correctCount = blankKeys.filter((key) => {
    const answer = answers[key];
    const studentValue = String(answer?.value || "");
    const correctAnswer = blankAnswers.get(key) || "";
    if (correctAnswer) {
      return (
        Boolean(normalizeBlankText(studentValue)) &&
        normalizeBlankText(studentValue) === normalizeBlankText(correctAnswer)
      );
    }
    return String(answer?.value || "").trim() && answer?.status === "correct";
  }).length;
  const status =
    correctCount === blankKeys.length
      ? "completed"
      : filledCount > 0
        ? "in_progress"
        : "not_started";
  return {
    blankCount: blankKeys.length,
    filledCount,
    correctCount,
    submitted,
    submissionLabel: submitted ? "제출" : "미제출",
    status,
    statusLabel:
      status === "completed"
        ? "완료"
        : status === "in_progress"
          ? "진행 중"
          : "미시작",
  };
};

const flattenLessonTreeOrder = (
  nodes: LessonTreeNode[],
  orderMap = new Map<string, number>(),
) => {
  nodes.forEach((node) => {
    const id = String(node?.id || "").trim();
    if (id && !orderMap.has(id)) {
      orderMap.set(id, orderMap.size);
    }
    if (Array.isArray(node?.children) && node.children.length) {
      flattenLessonTreeOrder(node.children, orderMap);
    }
  });
  return orderMap;
};

const readLessonTreeOrder = async (config: ConfigLike) => {
  const readTreeDoc = async (path: string) => {
    const snap = await getDoc(doc(db, path));
    const tree = snap.exists() ? snap.data().tree : null;
    return Array.isArray(tree)
      ? flattenLessonTreeOrder(tree as LessonTreeNode[])
      : new Map<string, number>();
  };

  const semesterOrder = await readTreeDoc(
    getSemesterDocPath(config, "curriculum", "tree"),
  );
  return semesterOrder.size ? semesterOrder : readTreeDoc("curriculum/tree");
};

const readLessons = async (config: ConfigLike) => {
  const treeOrder = await readLessonTreeOrder(config).catch((error) => {
    console.warn("Failed to load lesson tree order:", error);
    return new Map<string, number>();
  });
  const readCollection = async (path: string) => {
    const snap = await getDocs(collection(db, path));
    return snap.docs
      .map((item) => ({ id: item.id, ...(item.data() as LessonDoc) }))
      .map((item) => ({
        unitId: String(item.unitId || item.id || "").trim(),
        title: String(item.title || "").trim(),
        visible: item.isVisibleToStudents !== false,
        blankAnswers: getLessonBlankAnswers(item),
        orderIndex: treeOrder.get(String(item.unitId || item.id || "").trim()),
      }))
      .filter((item) => item.unitId && item.visible)
      .sort((left, right) => {
        const leftOrder = left.orderIndex ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = right.orderIndex ?? Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return (
          left.title.localeCompare(right.title, "ko") ||
          left.unitId.localeCompare(right.unitId, "ko")
        );
      });
  };

  const semesterLessons = await readCollection(
    getSemesterCollectionPath(config, "lessons"),
  );
  return semesterLessons.length ? semesterLessons : readCollection("lessons");
};

const loadLessonSummary = async (
  config: ConfigLike,
  uid: string,
  lessonsFromCatalog?: Awaited<ReturnType<typeof readLessons>> | null,
): Promise<StudentLessonProgressSummary> => {
  try {
    if (lessonsFromCatalog === null) {
      return emptyLessonSummary(
        "수업 자료 목록을 읽을 권한이 없거나 데이터를 불러오지 못했습니다.",
      );
    }
    const lessons = lessonsFromCatalog || (await readLessons(config));
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
      .map((item) => ({ id: item.id, ...(item.data() as LessonProgressDoc) }))
      .map((item) => ({
        ...item,
        unitId: String(item.unitId || item.id || "").trim(),
      }))
      .filter((item) => item.unitId);
    const progressByUnitId = new Map(
      progressItems.map((item) => [item.unitId, item]),
    );
    const units = lessons.map((lesson) => {
      const progress = progressByUnitId.get(lesson.unitId);
      const status = getLessonUnitStatus(lesson.blankAnswers, progress);
      return {
        unitId: lesson.unitId,
        title: lesson.title || lesson.unitId,
        ...status,
        latestUpdatedAtText: progress ? formatDateTime(progress.updatedAt) : "",
        updatedAtMs: progress ? timestampMs(progress.updatedAt) : 0,
      };
    });
    const savedItems = progressItems.filter((item) => hasSavedProgress(item));
    const latest =
      [...units].sort((a, b) => b.updatedAtMs - a.updatedAtMs)[0] || null;
    const displayUnits = units.map(
      ({ updatedAtMs: _updatedAtMs, ...unit }) => unit,
    );

    return {
      unavailable: false,
      totalLessons: lessons.length,
      worksheetUnits: units.filter((item) => item.blankCount > 0).length,
      savedUnits: savedItems.length,
      completedUnits: units.filter((item) => item.status === "completed")
        .length,
      latestUnitTitle: latest?.updatedAtMs
        ? titleByUnitId.get(latest.unitId) || latest.unitId
        : "",
      latestUpdatedAtText:
        latest?.updatedAtMs && latest.latestUpdatedAtText
          ? latest.latestUpdatedAtText
          : "",
      units: displayUnits,
    };
  } catch (error) {
    console.warn("Failed to load student lesson progress summary:", error);
    return emptyLessonSummary(
      "수업 자료 진행률을 읽을 권한이 없거나 데이터를 불러오지 못했습니다.",
    );
  }
};

export const loadStudentQuizResults = async (
  config: ConfigLike,
  uid: string,
): Promise<StudentQuizResultDoc[]> => {
  const safeUid = String(uid || "").trim();
  if (!safeUid) return [];

  const resultSnap = await getDocs(
    query(
      collection(db, getSemesterCollectionPath(config, "quiz_results")),
      where("uid", "==", safeUid),
    ),
  );

  return resultSnap.docs
    .map((item) => ({
      id: item.id,
      ...(item.data() as Omit<StudentQuizResultDoc, "id">),
    }))
    .sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp));
};

const loadQuizSummary = async (
  config: ConfigLike,
  uid: string,
  lessonsFromCatalog?: Awaited<ReturnType<typeof readLessons>> | null,
  preloadedQuizResults?: StudentQuizResultDoc[],
): Promise<StudentQuizProgressSummary> => {
  try {
    const titleByUnitId = new Map(
      (lessonsFromCatalog || []).map((lesson) => [
        lesson.unitId,
        lesson.title || lesson.unitId,
      ]),
    );
    const results = (
      preloadedQuizResults ?? (await loadStudentQuizResults(config, uid))
    )
      .slice()
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
    const groupsByKey = new Map<
      string,
      {
        unitTitle: string;
        category: string;
        categoryLabel: string;
        scores: number[];
        wrongCount: number;
        latestScore: number | null;
        latestDateText: string;
        latestMs: number;
      }
    >();
    results.forEach((result) => {
      const unitTitle = getDisplayUnitTitle(result.unitId, titleByUnitId);
      const category = String(result.category || "other");
      const categoryLabel = getQuizCategoryLabel(category);
      const key = `${unitTitle}__${category}`;
      const itemWrongCount = Array.isArray(result.details)
        ? result.details.filter((detail) => !detail.correct).length
        : 0;
      const ms = timestampMs(result.timestamp);
      const existing = groupsByKey.get(key);
      if (existing) {
        existing.scores.push(Number(result.score || 0));
        existing.wrongCount += itemWrongCount;
        if (ms >= existing.latestMs) {
          existing.latestMs = ms;
          existing.latestScore = Number(result.score || 0);
          existing.latestDateText = formatDateTime(
            result.timestamp,
            result.timeString || "",
          );
        }
      } else {
        groupsByKey.set(key, {
          unitTitle,
          category,
          categoryLabel,
          scores: [Number(result.score || 0)],
          wrongCount: itemWrongCount,
          latestScore: Number(result.score || 0),
          latestDateText: formatDateTime(
            result.timestamp,
            result.timeString || "",
          ),
          latestMs: ms,
        });
      }
    });
    const groups = Array.from(groupsByKey.values())
      .map((item) => ({
        unitTitle: item.unitTitle,
        category: item.category,
        categoryLabel: item.categoryLabel,
        totalAttempts: item.scores.length,
        averageScore: Math.round(
          item.scores.reduce((sum, score) => sum + score, 0) /
            Math.max(item.scores.length, 1),
        ),
        latestScore: item.latestScore,
        wrongCount: item.wrongCount,
        latestDateText: item.latestDateText,
      }))
      .sort(
        (a, b) =>
          a.unitTitle.localeCompare(b.unitTitle, "ko") ||
          a.categoryLabel.localeCompare(b.categoryLabel, "ko"),
      );
    const recentResults = results.slice(0, 8).map((result) => {
      const itemWrongCount = Array.isArray(result.details)
        ? result.details.filter((detail) => !detail.correct).length
        : 0;
      const category = String(result.category || "other");
      return {
        id: result.id,
        unitTitle: getDisplayUnitTitle(result.unitId, titleByUnitId),
        category,
        categoryLabel: getQuizCategoryLabel(category),
        score: Number(result.score || 0),
        wrongCount: itemWrongCount,
        dateText: formatDateTime(result.timestamp, result.timeString || ""),
      };
    });
    return {
      unavailable: false,
      totalAttempts: results.length,
      averageScore: Math.round(totalScore / results.length),
      wrongCount,
      latestTitle: `${getDisplayUnitTitle(latest.unitId, titleByUnitId)} · ${getQuizCategoryLabel(latest.category)}`,
      latestScore: Number(latest.score || 0),
      latestDateText: formatDateTime(latest.timestamp, latest.timeString || ""),
      groups,
      recentResults,
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
  options: { preloadedQuizResults?: StudentQuizResultDoc[] } = {},
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

  const lessonCatalog = await readLessons(config).catch((error) => {
    console.warn("Failed to load lesson catalog for student summary:", error);
    return null;
  });

  const [lesson, quiz, historyClassroom, wis] = await Promise.all([
    loadLessonSummary(config, safeUid, lessonCatalog),
    loadQuizSummary(
      config,
      safeUid,
      lessonCatalog,
      options.preloadedQuizResults,
    ),
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
