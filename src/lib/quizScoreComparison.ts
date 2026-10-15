import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";
import { getSemesterCollectionPath, getYearSemester } from "./semesterScope";
import {
  getResultMockExamRound,
  normalizeMockExamCategory,
} from "./mockExamRounds";
import {
  deduplicateQuizAnalysisRecords,
  type QuizAnalysisRecord,
} from "./quizAnalysis";

type ConfigLike = Parameters<typeof getYearSemester>[0];

export interface QuizScoreComparisonSource {
  id: string;
  source: "canonical" | "legacy";
  data: Record<string, unknown>;
}

export interface QuizScoreComparisonRequest {
  studentUid: string;
  semesterId: string;
  definitionId: string;
  currentAttemptId: string;
  currentScorePercent: number;
}

export interface QuizScoreComparison {
  previousScore: number;
  currentScore: number;
  delta: number;
  direction: "up" | "down" | "same";
  previousAttemptId: string;
  previousSubmittedAtMs: number;
  /** Same source may still draw a different set of questions. No growth claim. */
  basis: "same_source" | "same_question_revisions";
}

const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const validScore = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 100;
const recordedTime = (value: unknown): number | null => {
  if (value instanceof Date)
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const stamp = object(value);
  if (typeof stamp.toMillis === "function") {
    try {
      return recordedTime(stamp.toMillis());
    } catch {
      return null;
    }
  }
  if (typeof stamp.seconds === "number" && Number.isFinite(stamp.seconds)) {
    return (
      stamp.seconds * 1000 +
      (typeof stamp.nanoseconds === "number" &&
      Number.isFinite(stamp.nanoseconds)
        ? stamp.nanoseconds / 1e6
        : 0)
    );
  }
  return null;
};

const definitionIdFor = (data: Record<string, unknown>, semesterId: string) => {
  const explicit = text(data.definitionId);
  const unitId = text(data.sourceId) || text(data.unitId);
  const category = normalizeMockExamCategory(data.category);
  if (!unitId || !category) return explicit;
  const round =
    category === "exam_prep"
      ? getResultMockExamRound(data.category, data.examRound)
      : "";
  // Same stable identity convention as buildAssessmentDefinitionId, without
  // importing the command/auth runtime into this read-only optional feature.
  const derived = ["quiz", semesterId, unitId, category, round]
    .filter(Boolean)
    .join(":")
    .replace(/[^A-Za-z0-9_.:-]/g, "-")
    .slice(0, 180);
  return explicit && explicit !== derived ? "" : explicit || derived;
};

interface ScoreRecord extends QuizAnalysisRecord {
  definitionId: string;
  sourceHash: string;
  submittedMs: number | null;
  completed: boolean;
  questionRevisions: string | null;
}

const questionRevisions = (
  data: Record<string, unknown>,
  source: QuizScoreComparisonSource["source"],
): string | null => {
  const items = source === "canonical" ? data.answerChecks : data.details;
  if (!Array.isArray(items) || !items.length) return null;
  const metadata = new Map(
    (Array.isArray(data.learningSnapshot) ? data.learningSnapshot : []).map(
      (raw) => {
        const row = object(raw);
        return [text(row.id), row] as const;
      },
    ),
  );
  const entries = items.map((raw) => {
    const row = object(raw);
    const id = text(row.id ?? row.questionId ?? row.qid);
    const revision = text(
      metadata.get(id)?.sourceRevision ?? row.sourceRevision,
    );
    return { id, revision };
  });
  if (
    entries.some(
      (entry) => !entry.id || !entry.revision || entry.revision === "legacy",
    ) ||
    new Set(entries.map((entry) => entry.id)).size !== entries.length
  )
    return null;
  return JSON.stringify(entries.sort((a, b) => a.id.localeCompare(b.id)));
};

const normalizeRecord = (
  row: QuizScoreComparisonSource,
  scope: QuizScoreComparisonRequest,
): ScoreRecord | null => {
  const data = object(row.data);
  const uid = text(data.studentUid) || text(data.uid);
  const storedSemester = text(data.semesterId);
  const legacySemester =
    data.year && data.semester ? `${data.year}-${data.semester}` : "";
  if (
    !text(row.id) ||
    uid !== scope.studentUid ||
    (text(data.uid) && text(data.uid) !== scope.studentUid) ||
    (storedSemester && storedSemester !== scope.semesterId) ||
    (legacySemester && legacySemester !== scope.semesterId)
  )
    return null;
  if (
    row.source === "canonical" &&
    (data.assessmentKind !== "QUIZ" ||
      storedSemester !== scope.semesterId ||
      text(data.attemptId) !== text(row.id))
  )
    return null;
  if (row.source !== "canonical" && row.source !== "legacy") return null;
  const status = text(data.status).toLowerCase();
  const completed =
    !status || ["submitted", "completed", "timed_out"].includes(status);
  const value = row.source === "canonical" ? data.percent : data.score;
  const submittedAt = data.submittedAtIso ?? data.timestamp;
  return {
    id: text(row.id),
    source: row.source,
    studentUid: uid,
    semesterId: scope.semesterId,
    definitionId: definitionIdFor(data, scope.semesterId),
    sourceHash: /^[a-f0-9]{64}$/i.test(text(data.sourceHash))
      ? text(data.sourceHash).toLowerCase()
      : "",
    scorePercent: validScore(value) ? value : null,
    submittedAt,
    submittedMs: recordedTime(submittedAt),
    completed,
    items: [],
    questionRevisions: questionRevisions(data, row.source),
    attemptId: text(data.attemptId),
    canonicalAttemptId: text(data.canonicalAttemptId),
    submissionRef: text(data.submissionRef),
    resultRef: text(data.resultRef),
    resultId: text(data.resultId),
    legacyResultId: text(data.legacyResultId),
  };
};

/**
 * Compare the immediately preceding valid completed score, never the best or
 * a convenient older score. Missing chronology or changed content hides the
 * comparison. Callers supply the complete owner/current-semester query result.
 */
export const compareQuizScores = (
  input: QuizScoreComparisonRequest & {
    records: readonly QuizScoreComparisonSource[];
  },
): QuizScoreComparison | null => {
  if (
    !text(input.studentUid) ||
    !text(input.semesterId) ||
    !text(input.currentAttemptId) ||
    !input.definitionId.startsWith(`quiz:${input.semesterId}:`) ||
    !validScore(input.currentScorePercent)
  )
    return null;
  const normalized = input.records
    .map((row) => normalizeRecord(row, input))
    .filter((row): row is ScoreRecord => !!row);
  // Canonical records win over linked legacy mirrors before scope selection.
  const records = (
    deduplicateQuizAnalysisRecords(normalized) as ScoreRecord[]
  ).filter((row) => row.definitionId === input.definitionId);
  const current = records.find(
    (row) => row.source === "canonical" && row.id === input.currentAttemptId,
  );
  if (
    !current ||
    !current.completed ||
    current.submittedMs === null ||
    current.scorePercent !== input.currentScorePercent
  )
    return null;
  const candidates = records.filter(
    (row) =>
      row.id !== input.currentAttemptId &&
      row.attemptId !== input.currentAttemptId &&
      row.canonicalAttemptId !== input.currentAttemptId &&
      row.completed &&
      validScore(row.scorePercent),
  );
  // A dated earlier record cannot be called the previous record when another
  // completed result in the same assessment has an unknown submission time.
  if (
    candidates.some(
      (row) =>
        row.submittedMs === null || row.submittedMs === current.submittedMs,
    )
  )
    return null;
  const previous = candidates
    .filter((row) => row.submittedMs! < current.submittedMs!)
    .sort((a, b) => b.submittedMs! - a.submittedMs!);
  if (
    !previous.length ||
    (previous.length > 1 && previous[0].submittedMs === previous[1].submittedMs)
  )
    return null;
  const selected = previous[0];
  let basis: QuizScoreComparison["basis"];
  if (current.sourceHash && selected.sourceHash) {
    if (current.sourceHash !== selected.sourceHash) return null;
    basis = "same_source";
  } else {
    if (
      !current.questionRevisions ||
      current.questionRevisions !== selected.questionRevisions
    )
      return null;
    basis = "same_question_revisions";
  }
  const delta = Number(
    (current.scorePercent! - selected.scorePercent!).toPrecision(12),
  );
  return {
    previousScore: selected.scorePercent!,
    currentScore: current.scorePercent!,
    delta,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "same",
    previousAttemptId: selected.attemptId || selected.id,
    previousSubmittedAtMs: selected.submittedMs!,
    basis,
  };
};

export const formatQuizScoreComparison = (comparison: QuizScoreComparison) =>
  comparison.direction === "same"
    ? "이전 점수와 같아요"
    : `이전보다 ${Math.abs(comparison.delta)}점 ${comparison.direction === "up" ? "올랐어요" : "내려갔어요"}`;

/** Optional post-submit read. Failure never propagates into scoring or navigation. */
export const loadQuizScoreComparison = async (
  input: QuizScoreComparisonRequest & { config: ConfigLike },
): Promise<QuizScoreComparison | null> => {
  const { year, semester } = getYearSemester(input.config);
  if (`${year}-${semester}` !== input.semesterId || !input.studentUid)
    return null;
  try {
    const [canonical, legacy] = await Promise.all([
      getDocs(
        query(
          collection(db, "semester_assessment_results"),
          where("studentUid", "==", input.studentUid),
          where("semesterId", "==", input.semesterId),
        ),
      ),
      getDocs(
        query(
          collection(
            db,
            getSemesterCollectionPath(input.config, "quiz_results"),
          ),
          where("uid", "==", input.studentUid),
        ),
      ),
    ]);
    return compareQuizScores({
      ...input,
      records: [
        ...canonical.docs.map((doc) => ({
          id: doc.id,
          source: "canonical" as const,
          data: doc.data(),
        })),
        ...legacy.docs.map((doc) => ({
          id: doc.id,
          source: "legacy" as const,
          data: doc.data(),
        })),
      ],
    });
  } catch {
    return null;
  }
};
