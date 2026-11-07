import { callWithApplicationSession } from "./applicationSession";
import type { QuizAnalysisStudent, QuizBehaviorCategory } from "./quizAnalysis";
import type {
  AchievementEvidence,
  AchievementReviewedProfile,
} from "./achievementAnalysis";
import type {
  Question,
  TreeUnit,
} from "../pages/teacher/components/QuizBankTab";

export interface QuizClassAssessment {
  id: string;
  unitId: string;
  unitTitle: string;
  category: string;
  examRound: string;
  title: string;
  questionCount: number;
}

export interface QuizClassCatalog {
  semesterId: string;
  classes: Array<{
    id: string;
    label: string;
    grade: string;
    classNumber: string;
  }>;
  assessments: QuizClassAssessment[];
  treeData: TreeUnit[];
  generatedAt: string;
}

export interface QuizClassSummary {
  classId: string;
  label: string;
  rosterCount: number;
  submittedCount: number;
  unsubmittedCount: number;
  scoredCount: number;
  missingScoreCount?: number;
  behaviorCounts?: Record<QuizBehaviorCategory, number>;
  averageScore: number | null;
  scoreHistogram: Array<{
    label: string;
    lower: number;
    upper: number;
    count: number;
  }>;
  questions: Array<{
    id: string;
    question: string;
    subUnitId: string;
    concepts: string[];
    correctCount: number;
    wrongCount: number;
    respondentCount: number;
    correctRate: number | null;
    reviewLessonId?: string;
  }>;
  concepts: Array<{
    concept: string;
    wrongCount: number;
    respondentCount: number;
    reviewLessonIds?: string[];
  }>;
  relearning: {
    repeatedStudentCount: number;
    wrongToCorrectCount: number;
    correctToWrongCount: number;
  };
  generatedAt: string;
  version: string;
  smallSample: boolean;
  complete?: boolean;
  basis?: string;
}

export interface QuizClassSummaryResponse {
  semesterId: string;
  grade?: string;
  unitId: string;
  category: string;
  examRound: string;
  classes: QuizClassSummary[];
  keyword?: string;
  search?: QuizClassSearch;
  gradeComparison?: QuizClassSummary & {
    grade: string;
    classCount: number;
    respondingClassCount: number;
    weighting: "scored_students";
  };
  generatedAt: string;
}

export interface QuizClassSearch {
  keyword: string;
  matchedQuestionCount: number;
  unitCount: number;
  questionIds: string[];
  generatedAt: string;
}

export interface QuizClassDetail {
  semesterId?: string;
  grade?: string;
  keyword?: string;
  search?: QuizClassSearch;
  basis?: string;
  complete?: boolean;
  students: Array<QuizAnalysisStudent & { email?: string }>;
  rawRows: Array<{
    id: string;
    source: "canonical" | "legacy";
    raw: Record<string, any>;
  }>;
  questions: Question[];
  treeData: TreeUnit[];
  configuredClasses: Array<{ id: string; label: string }>;
  generatedAt: string;
  version: string;
}

export interface QuizClassAchievement extends QuizClassDetail {
  achievementEvidence: AchievementEvidence;
  profiles?: AchievementReviewedProfile[];
  canReview?: boolean;
  rubricVersion?: string;
  historicalQuestionSnapshots?: Record<string, unknown>;
}

type AchievementEvidenceWire = Omit<AchievementEvidence, "observations"> & {
  observations?: AchievementEvidence["observations"];
  observationTable?: {
    version: 1;
    keys: string[];
    values: unknown[];
    rows: number[][];
  };
};

// Whole-grade evidence repeats the same metadata across many pupils. Restore
// every cell before analysis; malformed or incomplete tables must fail closed.
function unpackAchievementEvidence(
  wire: AchievementEvidenceWire,
): AchievementEvidence {
  const { observationTable: table, ...evidence } = wire;
  const invalid = () =>
    new Error("학습 근거를 모두 확인하지 못했습니다. 다시 조회해 주세요.");
  if (!table) {
    if (!Array.isArray(evidence.observations)) throw invalid();
    return evidence as AchievementEvidence;
  }
  if (
    table.version !== 1 ||
    evidence.observations !== undefined ||
    !Array.isArray(table.keys) ||
    !table.keys.length ||
    table.keys.length > 128 ||
    table.keys.some(
      (key) =>
        typeof key !== "string" ||
        ["__proto__", "constructor", "prototype"].includes(key),
    ) ||
    new Set(table.keys).size !== table.keys.length ||
    !Array.isArray(table.values) ||
    !Array.isArray(table.rows)
  )
    throw invalid();
  const observations = table.rows.map((row) => {
    if (
      !Array.isArray(row) ||
      row.length !== table.keys.length ||
      row.some(
        (index) =>
          !Number.isSafeInteger(index) ||
          index < -1 ||
          index >= table.values.length,
      )
    )
      throw invalid();
    const observation = Object.fromEntries(
      table.keys.flatMap((key, index) =>
        row[index] === -1 ? [] : [[key, table.values[row[index]]]],
      ),
    );
    if (
      !["id", "studentUid", "semesterId", "itemId"].every(
        (key) => typeof observation[key] === "string",
      ) ||
      typeof observation.source !== "string" ||
      !["worksheet", "diagnostic", "formative"].includes(observation.source) ||
      !["correct", "filled", "hintViewed"].every(
        (key) =>
          observation[key] === null || typeof observation[key] === "boolean",
      )
    )
      throw invalid();
    return observation as unknown as AchievementEvidence["observations"][number];
  });
  return { ...evidence, observations };
}

export interface QuizClassScope {
  semesterId: string;
  unitId: string;
  category: string;
  examRound: string;
  classIds: string[];
  /** The server resolves all active classes in this grade; classIds is empty. */
  grade?: string;
  keyword?: string;
  comparisonGrade?: string;
}

// Only concurrent requests are shared. No student records, names or session
// proofs are persisted, and every later visit is authorized by the server.
const flights = new Map<string, Promise<unknown>>();
async function read<T>(
  data: Record<string, unknown>,
  identityKey: string,
): Promise<T> {
  const key = `${identityKey}:${JSON.stringify(data)}`;
  const pending = flights.get(key);
  if (pending) return pending as Promise<T>;
  const request = callWithApplicationSession<Record<string, unknown>, T>(
    "getQuizClassAnalysis",
    data,
  ).then((response) => response.data);
  flights.set(key, request);
  try {
    return await request;
  } finally {
    if (flights.get(key) === request) flights.delete(key);
  }
}

export const getQuizClassCatalog = (semesterId: string, identityKey: string) =>
  read<QuizClassCatalog>({ mode: "catalog", semesterId }, identityKey);

export const getQuizClassSummary = (
  scope: QuizClassScope,
  identityKey: string,
  forceRefresh = false,
) =>
  read<QuizClassSummaryResponse>(
    { ...scope, mode: "summary", forceRefresh },
    identityKey,
  );

export const getQuizClassDetail = (
  scope: QuizClassScope,
  identityKey: string,
  forceRefresh = false,
) => {
  // Firebase encodes undefined as null. Summary-only fields must be absent.
  const { comparisonGrade: _comparisonGrade, ...detailScope } = scope;
  return read<QuizClassDetail>(
    { ...detailScope, mode: "detail", forceRefresh },
    identityKey,
  );
};

export const getQuizClassAchievement = (
  scope: QuizClassScope,
  identityKey: string,
  forceRefresh = false,
) => {
  const {
    comparisonGrade: _comparisonGrade,
    keyword: _keyword,
    ...analysisScope
  } = scope;
  return read<
    Omit<QuizClassAchievement, "achievementEvidence"> & {
      achievementEvidence: AchievementEvidenceWire;
    }
  >(
    {
      ...analysisScope,
      mode: "achievement",
      forceRefresh,
      compactEvidence: true,
    },
    identityKey,
  ).then((result) => ({
    ...result,
    achievementEvidence: unpackAchievementEvidence(result.achievementEvidence),
    rawRows: result.rawRows.map((row) => {
      const refs = row.raw.questionSnapshotRefs;
      if (!Array.isArray(refs)) return row;
      const dictionary = result.historicalQuestionSnapshots;
      if (
        !dictionary ||
        refs.some(
          (ref) =>
            typeof ref !== "string" ||
            !Object.prototype.hasOwnProperty.call(dictionary, ref),
        )
      )
        throw new Error(
          "응시 당시 문항 자료를 모두 확인하지 못했습니다. 다시 조회해 주세요.",
        );
      return {
        ...row,
        raw: {
          ...row.raw,
          questionSnapshots: refs.map((ref) => dictionary[ref]),
        },
      };
    }),
  }));
};

export function quizClassAnalysisError(error: unknown) {
  const failure = error as {
    code?: string;
    message?: string;
    details?: { reason?: string };
  };
  if (
    failure.code?.includes("unauthenticated") ||
    failure.details?.reason?.startsWith("SESSION_")
  )
    return "로그인 세션을 확인하지 못했습니다. 다시 로그인한 뒤 조회해 주세요.";
  if (failure.code?.includes("permission-denied"))
    return "평가 조회 권한을 확인하지 못했습니다. 담당 권한과 현재 학기를 확인해 주세요.";
  if (
    failure.code?.includes("failed-precondition") ||
    failure.code?.includes("resource-exhausted")
  )
    return (
      failure.message ||
      "조회 자료를 준비하지 못했습니다. 잠시 후 다시 조회해 주세요."
    );
  return "평가 결과를 불러오지 못했습니다. 연결 상태를 확인한 뒤 다시 조회해 주세요.";
}
