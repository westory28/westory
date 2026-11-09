import { callWithApplicationSession } from "./applicationSession";
import type { QuizAnalysisStudent, QuizBehaviorCategory } from "./quizAnalysis";
import type { AchievementRawRecord } from "./achievementAnalysis";
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
  historicalQuestionSnapshots?: Record<string, unknown>;
}

export interface QuizClassAchievement extends QuizClassDetail {
  mockExamScoreRows: AchievementRawRecord[];
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

function restoreHistoricalQuestionSnapshots<T extends QuizClassDetail>(
  result: T,
): T {
  const invalid = () =>
    new Error(
      "응시 당시 문항 자료를 모두 확인하지 못했습니다. 다시 조회해 주세요.",
    );
  if (!result || !Array.isArray(result.rawRows)) throw invalid();
  return {
    ...result,
    rawRows: result.rawRows.map((row) => {
      if (!row?.raw || typeof row.raw !== "object" || Array.isArray(row.raw))
        throw invalid();
      // Older responses contain inline snapshots. Never replace those with
      // current-bank questions or interpret an absent reference list as empty.
      if (
        !Object.prototype.hasOwnProperty.call(row.raw, "questionSnapshotRefs")
      )
        return row;
      const refs = row.raw.questionSnapshotRefs;
      const dictionary = result.historicalQuestionSnapshots;
      if (
        !Array.isArray(refs) ||
        !dictionary ||
        typeof dictionary !== "object" ||
        Array.isArray(dictionary) ||
        refs.some(
          (ref) =>
            typeof ref !== "string" ||
            !Object.prototype.hasOwnProperty.call(dictionary, ref) ||
            !dictionary[ref] ||
            typeof dictionary[ref] !== "object" ||
            Array.isArray(dictionary[ref]),
        )
      )
        throw invalid();
      return {
        ...row,
        raw: {
          ...row.raw,
          questionSnapshots: refs.map((ref) => dictionary[ref]),
        },
      };
    }),
  };
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
    { ...detailScope, mode: "detail", forceRefresh, snapshotDictionary: true },
    identityKey,
  ).then(restoreHistoricalQuestionSnapshots);
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
  return read<QuizClassAchievement>(
    {
      ...analysisScope,
      mode: "achievement",
      forceRefresh,
    },
    identityKey,
  ).then((result) => {
    if (
      !Array.isArray(result.mockExamScoreRows) ||
      !Array.isArray(result.rawRows)
    )
      throw new Error(
        "모의고사 누적 점수 자료를 확인하지 못했습니다. 다시 조회해 주세요.",
      );
    return restoreHistoricalQuestionSnapshots(result);
  });
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
  if (failure.details?.reason === "QUIZ_ANALYSIS_ROSTER_CONFLICT")
    return "학생의 소속 학급이 중복되어 있습니다. 학급 명단을 확인한 뒤 다시 조회해 주세요.";
  if (
    failure.details?.reason === "QUIZ_ANALYSIS_CHANGED" ||
    failure.code?.includes("aborted")
  )
    return "조회 중 평가 결과나 문항이 갱신되었습니다. 최신 자료로 다시 조회해 주세요.";
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
