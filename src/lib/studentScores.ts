export type ScoreItemType = "exam" | "performance" | "other";
export type ScoreBand = "A" | "B" | "C" | "D" | "E";
export type ScoreSortMode = "importance" | "name" | "latest";

export interface GradingPlanItemLike {
  type?: unknown;
  name?: unknown;
  maxScore?: unknown;
  ratio?: unknown;
}

export interface GradingPlanLike {
  id: string;
  subject?: unknown;
  items?: GradingPlanItemLike[];
  targetGrade?: unknown;
  academicYear?: unknown;
  semester?: unknown;
  createdAt?: { seconds?: number } | null;
}

export interface ScoreBreakdownItem {
  key: string;
  name: string;
  score: number;
  maxScore: number;
  ratio: number;
  weighted: number;
  entered: boolean;
  type: ScoreItemType;
}

export interface ScoreRow {
  id: string;
  subject: string;
  total: number;
  hasData: boolean;
  targetGrade?: string;
  createdAt?: { seconds?: number } | null;
  breakdown: ScoreBreakdownItem[];
}

export interface SubjectScoreInsight {
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

export const SUBJECT_PRIORITY = [
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
  "기가",
  "정보",
  "음악",
  "미술",
  "체육",
];

export const getScoreKey = (planId: string, itemIndex: number) =>
  `${planId}_${itemIndex}`;

export const getTypeLabel = (type: ScoreItemType) => {
  if (type === "exam") return "정기시험";
  if (type === "performance") return "수행평가";
  return "기타";
};

const classifyBreakdownType = (name: string): ScoreItemType => {
  const key = String(name || "").toLowerCase();
  if (/정기|지필|중간|기말|시험|서술|omr|exam|midterm|final/.test(key)) {
    return "exam";
  }
  if (
    /수행|과제|발표|실험|프로젝트|실습|performance|project|assignment/.test(key)
  ) {
    return "performance";
  }
  return "other";
};

export const normalizePlanItemType = (
  rawType: unknown,
  fallbackName: string,
): ScoreItemType => {
  const typeKey = String(rawType ?? "").toLowerCase();
  if (/정기|지필|시험|regular|exam|midterm|final|omr|뺢린/.test(typeKey)) {
    return "exam";
  }
  if (/수행|performance|project|assignment|섑뻾/.test(typeKey)) {
    return "performance";
  }
  return classifyBreakdownType(fallbackName);
};

export const isThreeLevelSubject = (subject: string) =>
  /(음악|미술|체육|music|art|pe|physical)/i.test(String(subject || ""));

export const getGradeBand = (score: number, subject: string): ScoreBand => {
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

export const getScoreBandColor = (band: ScoreBand) => {
  const palette: Record<ScoreBand, string> = {
    A: "#ef4444",
    B: "#f97316",
    C: "#eab308",
    D: "#22c55e",
    E: "#3b82f6",
  };
  return palette[band];
};

export const getAchievementColor = (score: number, subject: string) =>
  getScoreBandColor(getGradeBand(score, subject));

export const getSubjectPriorityIndex = (subject: string) => {
  const idx = SUBJECT_PRIORITY.findIndex((key) => subject.includes(key));
  return idx === -1 ? 999 : idx;
};

export const sortScoreRows = (
  rows: ScoreRow[],
  sortMode: ScoreSortMode = "importance",
) => {
  const sorted = [...rows];
  if (sortMode === "name") {
    sorted.sort((a, b) => a.subject.localeCompare(b.subject));
    return sorted;
  }
  if (sortMode === "latest") {
    sorted.sort(
      (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0),
    );
    return sorted;
  }
  sorted.sort(
    (a, b) =>
      getSubjectPriorityIndex(a.subject) - getSubjectPriorityIndex(b.subject) ||
      a.subject.localeCompare(b.subject),
  );
  return sorted;
};

export const buildScoreRows = (
  plans: GradingPlanLike[],
  scores: Record<string, unknown>,
  options: {
    year?: string;
    semester?: string;
    grade?: string;
    filterByGrade?: boolean;
    sortMode?: ScoreSortMode;
  } = {},
): ScoreRow[] => {
  const filteredPlans = plans.filter((plan) => {
    const yearMatch =
      !options.year ||
      !plan.academicYear ||
      String(plan.academicYear) === options.year;
    const semesterMatch =
      !options.semester ||
      !plan.semester ||
      String(plan.semester) === options.semester;
    const gradeMatch =
      options.filterByGrade === false ||
      !options.grade ||
      String(plan.targetGrade || "2") === String(options.grade);
    return yearMatch && semesterMatch && gradeMatch;
  });

  const rows = filteredPlans.map((plan) => {
    const items = Array.isArray(plan.items) ? plan.items : [];
    const breakdown = items.map((item, idx) => {
      const key = getScoreKey(plan.id, idx);
      const rawValue = scores?.[key];
      const entered =
        rawValue !== undefined && rawValue !== null && rawValue !== "";
      const score = Number(rawValue);
      const maxScore = Number(item.maxScore || 0);
      const ratio = Number(item.ratio || 0);
      const safeScore = Number.isFinite(score) ? score : 0;
      const weighted =
        entered && maxScore > 0
          ? Number(((safeScore / maxScore) * ratio).toFixed(1))
          : 0;
      const name = String(item.name || `${idx + 1}번 항목`);

      return {
        key,
        name,
        score: Number(safeScore.toFixed(1)),
        maxScore: Number(maxScore.toFixed(1)),
        ratio: Number(ratio.toFixed(1)),
        weighted,
        entered,
        type: normalizePlanItemType(item.type, name),
      };
    });
    const total = Number(
      breakdown.reduce((acc, item) => acc + item.weighted, 0).toFixed(1),
    );

    return {
      id: plan.id,
      subject: String(plan.subject || "과목"),
      total,
      hasData: breakdown.some((item) => item.entered),
      targetGrade:
        plan.targetGrade === undefined ? undefined : String(plan.targetGrade),
      createdAt: plan.createdAt,
      breakdown,
    };
  });

  return sortScoreRows(rows, options.sortMode);
};

export const buildSubjectScoreInsights = (
  rows: ScoreRow[],
  subjectGoals: Record<string, number>,
) =>
  rows.map((row): SubjectScoreInsight => {
    const target = Number(subjectGoals[row.subject] ?? 85);
    const current = Number(row.total || 0);
    const gap = Math.max(0, target - current);

    let examCurrent = 0;
    let performanceCurrent = 0;
    let otherCurrent = 0;
    let examRemain = 0;
    let performanceRemain = 0;
    let otherRemain = 0;
    let missingExamCount = 0;
    let missingPerformanceCount = 0;

    row.breakdown.forEach((item) => {
      const left = Math.max(
        0,
        Number(item.ratio || 0) - Number(item.weighted || 0),
      );
      if (item.type === "exam") {
        examCurrent += item.weighted;
        examRemain += left;
        if (!item.entered) missingExamCount += 1;
      } else if (item.type === "performance") {
        performanceCurrent += item.weighted;
        performanceRemain += left;
        if (!item.entered) missingPerformanceCount += 1;
      } else {
        otherCurrent += item.weighted;
        otherRemain += left;
      }
    });

    const remainingPotential = Number(
      (examRemain + performanceRemain + otherRemain).toFixed(1),
    );
    const requiredRate =
      remainingPotential > 0
        ? Math.min(100, Number(((gap / remainingPotential) * 100).toFixed(1)))
        : 100;
    const examNeed =
      gap > 0 && remainingPotential > 0
        ? Number(((gap * examRemain) / remainingPotential).toFixed(1))
        : 0;
    const performanceNeed =
      gap > 0 && remainingPotential > 0
        ? Number(((gap * performanceRemain) / remainingPotential).toFixed(1))
        : 0;

    return {
      subject: row.subject,
      current: Number(current.toFixed(1)),
      target: Number(target.toFixed(1)),
      gap: Number(gap.toFixed(1)),
      remainingPotential,
      requiredRate,
      examCurrent: Number(examCurrent.toFixed(1)),
      performanceCurrent: Number(performanceCurrent.toFixed(1)),
      otherCurrent: Number(otherCurrent.toFixed(1)),
      examNeed,
      performanceNeed,
      missingExamCount,
      missingPerformanceCount,
      mood: gap <= 0 || requiredRate <= 70 ? "good" : "care",
    };
  });

export const getTeacherAdviceText = (insight: SubjectScoreInsight | null) => {
  if (!insight) return "";
  if (insight.gap <= 0) {
    return "선생님의 조언: 목표를 이미 달성했습니다. 남은 평가에서도 현재 페이스를 유지하세요.";
  }

  const parts: string[] = [];
  if (insight.missingExamCount > 0) {
    parts.push(
      `남은 정기시험 ${insight.missingExamCount}개에서 총 ${insight.examNeed}점 이상 획득하도록 하세요.`,
    );
  }
  if (insight.missingPerformanceCount > 0) {
    parts.push(
      `남은 수행평가 ${insight.missingPerformanceCount}개에서 총 ${insight.performanceNeed}점 이상 획득하도록 하세요.`,
    );
  }

  if (!parts.length) {
    return "선생님의 조언: 남은 입력 가능한 평가가 없어 목표 달성에 필요한 점수를 반영하기 어렵습니다. 목표 점수를 조정하거나 교사와 상담하세요.";
  }

  return `선생님의 조언: ${parts.join(" ")}`;
};
