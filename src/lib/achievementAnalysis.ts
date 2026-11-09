/** Read-only mock-exam analysis; cumulative scores use frozen paper cut scores. */
import { buildEstimatedCutScores } from "./achievementEstimates";
import {
  analyzeAchievementPsychometrics,
  type AchievementPsychometrics,
} from "./achievementPsychometrics";
export const ACHIEVEMENT_LEVELS = ["A", "B", "C", "D", "E"] as const;
export type AchievementLevel = (typeof ACHIEVEMENT_LEVELS)[number];
export type AchievementDifficulty = "easy" | "medium" | "hard";

export interface AchievementMetadata {
  curriculumVersion?: string;
  achievementStandardCodes?: string[];
  achievementMappingSource?: "manual" | "unit";
  targetAchievementLevel?: AchievementLevel | "";
  intendedDifficulty?: AchievementDifficulty | "";
  unitId?: string | null;
  subUnitId?: string | null;
  refBig?: string | null;
  refMid?: string | null;
  refSmall?: string | null;
  familyId?: string;
}
export interface AchievementQuestion extends AchievementMetadata {
  id: string | number;
  sourceRevision?: string;
  contentRevision?: number;
  paperOrder?: number;
  question?: string;
  type?: string;
  options?: string[];
  answer?: string | number;
  points?: number;
}
export interface AchievementStudent {
  uid: string;
  name?: string;
  classId?: string;
  number?: string | number;
}
export interface AchievementRawRecord {
  id: string;
  source: "canonical" | "legacy";
  raw: Record<string, any>;
}
export type AchievementCutScores = Record<"A" | "B" | "C" | "D", number>;
export interface MockExamRoundScore {
  examRound: string;
  resultId: string;
  submittedAt: number;
  scorePercent: number;
  cutScores: AchievementCutScores | null;
  assumedTargets: number;
  weighted: boolean;
}
export interface CumulativeAchievementScore {
  student: AchievementStudent;
  level: AchievementLevel | null;
  scorePercent: number | null;
  cutScores: AchievementCutScores | null;
  rounds: MockExamRoundScore[];
  missingRounds: string[];
  excludedRoundCount: number;
  provisional: boolean;
}
export interface AchievementItem extends AchievementMetadata {
  id: string;
  sourceRevision: string;
  correct: boolean | null;
  answer: string | null;
  codes: string[];
  inferredMapping: boolean;
  points: number | null;
  options: string[] | null;
  answerKey: string | null;
}
export interface AchievementAttempt {
  id: string;
  attemptId: string;
  studentUid: string;
  startedAt: number | null;
  submittedAt: number | null;
  scorePercent: number | null;
  items: AchievementItem[];
  complete: boolean;
}
export interface AchievementRate {
  correct: number;
  total: number;
  percent: number | null;
}
export interface AchievementCell {
  standardCode: string;
  targetLevel: AchievementLevel | "";
  difficulty: AchievementDifficulty | "";
  actual: AchievementRate;
}
export interface AchievementStandardRow {
  code: string;
  actual: AchievementRate;
  students: number;
  inferredCount: number;
  weighted: {
    earned: number;
    maximum: number;
    percent: number | null;
    missing: number;
  };
}
export interface AchievementStudentProfile {
  student: AchievementStudent;
  attempt: AchievementAttempt | null;
  standards: AchievementStandardRow[];
  achievement: CumulativeAchievementScore;
}
export interface AchievementLevelCohort {
  level: AchievementLevel | "unclassified";
  count: number;
  percent: number | null;
  mean: number | null;
  standardDeviation: number | null;
}
export interface AchievementItemStatistics {
  id: string;
  sampleSize: number;
  correctRate: number | null;
  discrimination: number | null;
  upperLower27: number | null;
  upperLowerCount: number;
  alphaIfDeleted: number | null;
  choices: Array<{ answer: string; count: number; percent: number | null }>;
  unanswered: number;
  missingAnswer: number;
  unlistedAnswer: number;
  levelRates: Array<{
    level: AchievementLevel | "unclassified";
    correct: number;
    total: number;
    percent: number | null;
  }>;
  levelChoices: Array<{
    level: AchievementLevel | "unclassified";
    total: number;
    choices: number[];
    unanswered: number;
    missingAnswer: number;
    unlistedAnswer: number;
  }>;
  targetAchievementLevel: AchievementLevel | "";
  intendedDifficulty: AchievementDifficulty | "";
  answerKey: string | null;
}
export interface AchievementFormStatistics {
  key: string;
  sampleSize: number;
  itemCount: number;
  mean: number | null;
  standardDeviation: number | null;
  alpha: number | null;
  items: AchievementItemStatistics[];
  psychometrics: AchievementPsychometrics;
}
export interface AchievementAnalysis {
  cumulativeScores: CumulativeAchievementScore[];
  attempts: AchievementAttempt[];
  standards: AchievementStandardRow[];
  cells: AchievementCell[];
  students: AchievementStudentProfile[];
  forms: AchievementFormStatistics[];
  levelCohorts: AchievementLevelCohort[];
  histogram: Array<{ label: string; count: number }>;
  scoredCount: number;
  mean: number | null;
  standardDeviation: number | null;
  unclassifiedItemCount: number;
  excludedChronologyCount: number;
}

type ResolveCodes = (metadata: AchievementMetadata) => {
  codes: string[];
  source: string;
};
const str = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
export const achievementTimestamp = (value: unknown): number | null => {
  if (finite(value)) return value;
  if (value instanceof Date)
    return finite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "string") {
    const result = Date.parse(value);
    return finite(result) ? result : null;
  }
  if (value && typeof value === "object") {
    const stamp = value as {
      seconds?: number;
      nanoseconds?: number;
      toMillis?: () => number;
    };
    if (typeof stamp.toMillis === "function") {
      try {
        return achievementTimestamp(stamp.toMillis());
      } catch {
        return null;
      }
    }
    if (finite(stamp.seconds))
      return (
        stamp.seconds * 1000 +
        (finite(stamp.nanoseconds) ? stamp.nanoseconds / 1e6 : 0)
      );
  }
  return null;
};
const level = (value: unknown): AchievementLevel | "" =>
  ACHIEVEMENT_LEVELS.includes(value as AchievementLevel)
    ? (value as AchievementLevel)
    : "";
const difficulty = (value: unknown): AchievementDifficulty | "" =>
  ["easy", "medium", "hard"].includes(str(value))
    ? (value as AchievementDifficulty)
    : "";
const rate = (outcomes: boolean[]): AchievementRate => ({
  correct: outcomes.filter(Boolean).length,
  total: outcomes.length,
  percent: outcomes.length
    ? (100 * outcomes.filter(Boolean).length) / outcomes.length
    : null,
});
const mean = (values: number[]) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
/** Population SD describes exactly the displayed cohort, not a population estimate. */
const deviation = (values: number[]) =>
  values.length
    ? Math.sqrt(
        values.reduce((sum, value) => sum + (value - mean(values)!) ** 2, 0) /
          values.length,
      )
    : null;

const roundNumber = (value: unknown) => {
  const match = /^round_([1-9]\d*)$/.exec(str(value));
  const number = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(number) ? number : 0;
};

/** Each completed round contributes once; retries never raise the cumulative score. */
export function buildCumulativeAchievementScores(input: {
  semesterId: string;
  students: readonly AchievementStudent[];
  examRound: string;
  scoreRows: readonly AchievementRawRecord[];
}): CumulativeAchievementScore[] {
  const lastRound = roundNumber(input.examRound);
  const owners = new Set(input.students.map((student) => student.uid));
  const seen = new Set<string>();
  const byStudent = new Map<string, Map<number, MockExamRoundScore[]>>();
  for (const row of [...input.scoreRows].sort(
    (a, b) =>
      Number(b.source === "canonical") - Number(a.source === "canonical"),
  )) {
    const raw = row.raw;
    const uid = str(raw.studentUid || raw.uid || raw.studentId || raw.userId);
    const category = str(raw.category);
    const categoryRound = category.startsWith("exam_prep__")
      ? category.slice("exam_prep__".length)
      : "";
    const examRound = str(raw.examRound) || categoryRound || "round_1";
    const number = roundNumber(examRound);
    if (
      !owners.has(uid) ||
      raw.semesterId !== input.semesterId ||
      (category !== "exam_prep" && !roundNumber(categoryRound)) ||
      !number ||
      number > lastRound ||
      (categoryRound && categoryRound !== examRound)
    )
      continue;
    const aliases = [
      row.id,
      raw.attemptId,
      raw.canonicalAttemptId,
      raw.resultId,
      raw.legacyResultId,
      raw.submissionRef,
      raw.resultRef,
    ]
      .map(str)
      .filter(Boolean);
    const keys = aliases.flatMap((alias) => {
      const tail = alias.split("/").at(-1)!;
      return [`${uid}:${alias}`, `${uid}:${tail}`];
    });
    if (keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    const submittedAt = achievementTimestamp(
      raw.submittedAtIso || raw.timestamp || raw.createdAt,
    );
    const scorePercent = row.source === "canonical" ? raw.percent : raw.score;
    if (
      submittedAt == null ||
      !finite(scorePercent) ||
      scorePercent < 0 ||
      scorePercent > 100
    )
      continue;
    // Only immutable paper metadata supplied with this result is eligible.
    const questions: AchievementQuestion[] = Array.isArray(
      raw.cutScoreQuestions,
    )
      ? raw.cutScoreQuestions
      : [];
    const frozenComplete =
      Number.isSafeInteger(raw.total) &&
      raw.total > 0 &&
      questions.length === raw.total &&
      questions.every((question) => question && str(question.id)) &&
      new Set(questions.map((question) => str(question.id))).size ===
        questions.length;
    const estimated = frozenComplete
      ? buildEstimatedCutScores(
          raw.maxPoints == null
            ? questions.map((question) => ({ ...question, points: undefined }))
            : questions,
        )
      : null;
    // A point-weighted score must not be compared with an unweighted paper model.
    const pointsCompatible =
      raw.maxPoints == null ||
      (estimated?.weighted &&
        finite(raw.maxPoints) &&
        Math.abs(estimated.totalPoints! - raw.maxPoints) < 1e-8);
    const cutScores =
      estimated && pointsCompatible
        ? (Object.fromEntries(
            estimated.cuts
              .filter((cut) => cut.level !== "E")
              .map((cut) => [cut.level, cut.percent!]),
          ) as AchievementCutScores)
        : null;
    const rounds =
      byStudent.get(uid) || new Map<number, MockExamRoundScore[]>();
    rounds.set(number, [
      ...(rounds.get(number) || []),
      {
        examRound,
        resultId: row.id,
        submittedAt,
        scorePercent,
        cutScores,
        assumedTargets: estimated?.assumedTargets || 0,
        weighted: estimated?.weighted || false,
      },
    ]);
    byStudent.set(uid, rounds);
  }
  return input.students.map((student) => {
    const rounds: MockExamRoundScore[] = [];
    const missingRounds: string[] = [];
    let excludedRoundCount = 0;
    for (let number = 1; number <= lastRound; number++) {
      const entries = [...(byStudent.get(student.uid)?.get(number) || [])].sort(
        (a, b) =>
          a.submittedAt - b.submittedAt || a.resultId.localeCompare(b.resultId),
      );
      if (
        !entries.length ||
        (entries[1] && entries[0].submittedAt === entries[1].submittedAt)
      ) {
        missingRounds.push(`round_${number}`);
        if (entries.length) excludedRoundCount++;
        continue;
      }
      rounds.push(entries[0]);
      if (!entries[0].cutScores) excludedRoundCount++;
    }
    const scorePercent = mean(rounds.map((round) => round.scorePercent));
    const cutScores =
      rounds.length && rounds.every((round) => round.cutScores)
        ? (Object.fromEntries(
            (["A", "B", "C", "D"] as const).map((value) => [
              value,
              mean(rounds.map((round) => round.cutScores![value]))!,
            ]),
          ) as AchievementCutScores)
        : null;
    const level =
      scorePercent == null || !cutScores
        ? null
        : (["A", "B", "C", "D"] as const).find(
            (value) => scorePercent >= cutScores[value],
          ) || "E";
    return {
      student,
      level,
      scorePercent,
      cutScores,
      rounds,
      missingRounds,
      excludedRoundCount,
      provisional:
        missingRounds.length > 0 ||
        excludedRoundCount > 0 ||
        rounds.some((round) => round.assumedTargets > 0 || !round.weighted),
    };
  });
}

export function adaptAchievementAttempts(input: {
  semesterId: string;
  students: readonly AchievementStudent[];
  questions: readonly AchievementQuestion[];
  rawRows: readonly AchievementRawRecord[];
  resolveCodes: ResolveCodes;
}) {
  const students = new Set(input.students.map((row) => row.uid));
  const bank = new Map(
    input.questions.map((question) => [str(question.id), question]),
  );
  const seen = new Set<string>();
  const rows: AchievementAttempt[] = [];
  for (const row of [...input.rawRows].sort(
    (a, b) =>
      Number(b.source === "canonical") - Number(a.source === "canonical"),
  )) {
    const raw = row.raw;
    const uid = str(raw.studentUid || raw.uid || raw.studentId || raw.userId);
    if (
      !students.has(uid) ||
      (raw.semesterId && raw.semesterId !== input.semesterId)
    )
      continue;
    const refs = [
      raw.attemptId,
      raw.canonicalAttemptId,
      raw.resultId,
      raw.legacyResultId,
      raw.submissionRef,
      raw.resultRef,
    ]
      .map(str)
      .filter(Boolean);
    const keys = refs
      .map((ref) => `${uid}:${ref}`)
      .concat(`${uid}:${row.source}:${row.id}`);
    if (keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    const saved = new Map<string, any>(
      (Array.isArray(raw.learningSnapshot) ? raw.learningSnapshot : []).map(
        (item: any) => [str(item.id), item],
      ),
    );
    const presentations = new Map<string, any>(
      (Array.isArray(raw.questionSnapshots) ? raw.questionSnapshots : []).map(
        (item: any) => [str(item.id), item],
      ),
    );
    const checks = row.source === "canonical" ? raw.answerChecks : raw.details;
    const items: AchievementItem[] = (
      Array.isArray(checks) ? checks : []
    ).flatMap((check: any) => {
      const id = str(check.id ?? check.qid ?? check.questionId);
      if (!id) return [];
      const snapshot = saved.get(id);
      const current = bank.get(id);
      const revision = str(snapshot?.sourceRevision || check.sourceRevision);
      const currentRevision = str(
        current?.sourceRevision || current?.contentRevision,
      );
      // Current metadata is never silently joined to an old/unknown version.
      const metadata: AchievementMetadata =
        snapshot ||
        (revision && revision !== "legacy" && revision === currentRevision
          ? current || {}
          : {});
      const presentation =
        presentations.get(id) ||
        (revision && revision !== "legacy" && revision === currentRevision
          ? current
          : null);
      const resolved = input.resolveCodes(metadata);
      const answerMap =
        raw.answers &&
        typeof raw.answers === "object" &&
        !Array.isArray(raw.answers)
          ? raw.answers
          : null;
      const answer =
        row.source === "canonical"
          ? answerMap
            ? str(answerMap[id])
            : null
          : (check.u ?? check.userAnswer ?? check.answer);
      return [
        {
          ...metadata,
          id,
          sourceRevision: revision,
          correct: typeof check.correct === "boolean" ? check.correct : null,
          answer: answer == null ? null : String(answer),
          codes: [...new Set(resolved.codes)],
          inferredMapping: !["manual", "unit"].includes(resolved.source),
          targetAchievementLevel: level(metadata.targetAchievementLevel),
          intendedDifficulty: difficulty(metadata.intendedDifficulty),
          points:
            finite(presentations.get(id)?.points) &&
            presentations.get(id).points > 0
              ? presentations.get(id).points
              : raw.maxPoints == null
                ? 1
                : null,
          options: Array.isArray(presentation?.options)
            ? presentation.options
            : null,
          answerKey:
            presentation?.answer == null ? null : String(presentation.answer),
        },
      ];
    });
    const duplicateIds = new Set(
      items
        .filter(
          (item, i) => items.findIndex((other) => other.id === item.id) !== i,
        )
        .map((item) => item.id),
    );
    const safeItems = items
      .filter(
        (item, i) => items.findIndex((other) => other.id === item.id) === i,
      )
      .map((item) =>
        duplicateIds.has(item.id) ? { ...item, correct: null } : item,
      );
    const recordedPercent =
      row.source === "canonical" ? raw.percent : raw.score;
    rows.push({
      id: row.id,
      attemptId: str(
        raw.attemptId ||
          raw.canonicalAttemptId ||
          (row.source === "canonical" ? row.id : ""),
      ),
      studentUid: uid,
      startedAt: achievementTimestamp(raw.startedAtIso || raw.startedAt),
      submittedAt: achievementTimestamp(
        raw.submittedAtIso || raw.timestamp || raw.createdAt,
      ),
      scorePercent:
        finite(recordedPercent) &&
        recordedPercent >= 0 &&
        recordedPercent <= 100
          ? recordedPercent
          : null,
      items: safeItems,
      complete:
        Number.isSafeInteger(raw.total) &&
        raw.total === items.length &&
        items.length > 0 &&
        !duplicateIds.size &&
        items.every(
          (item) =>
            typeof item.correct === "boolean" &&
            item.sourceRevision &&
            item.sourceRevision !== "legacy",
        ),
    });
  }
  return rows;
}

export function buildAchievementAnalysis(input: {
  semesterId: string;
  students: readonly AchievementStudent[];
  questions: readonly AchievementQuestion[];
  attempts: readonly AchievementAttempt[];
  resolveCodes: ResolveCodes;
  examRound: string;
  scoreRows: readonly AchievementRawRecord[];
  standardCode?: string;
}): AchievementAnalysis {
  const cumulativeScores = buildCumulativeAchievementScores(input);
  const scoreByStudent = new Map(
    cumulativeScores.map((row) => [row.student.uid, row]),
  );
  const cumulativeLevel = (uid: string) =>
    scoreByStudent.get(uid)?.level || "unclassified";
  const selected: AchievementAttempt[] = [];
  let excludedChronologyCount = 0;
  for (const student of input.students) {
    const entries = input.attempts.filter(
      (row) => row.studentUid === student.uid,
    );
    const sorted = [...entries].sort(
      (a, b) => (a.submittedAt || 0) - (b.submittedAt || 0),
    );
    if (
      sorted.some((row) => row.submittedAt == null) ||
      (sorted[1] && sorted[0].submittedAt === sorted[1].submittedAt)
    ) {
      excludedChronologyCount++;
      continue;
    }
    if (sorted[0]) selected.push(sorted[0]);
  }
  const standardMap = new Map<
    string,
    {
      actual: boolean[];
      items: AchievementItem[];
      students: Set<string>;
      inferredCount: number;
    }
  >();
  const cells = new Map<
    string,
    {
      standardCode: string;
      targetLevel: AchievementLevel | "";
      difficulty: AchievementDifficulty | "";
      actual: boolean[];
    }
  >();
  const studentResults: AchievementStudentProfile[] = [];
  let unclassifiedItemCount = 0;
  const relevant = (codes: string[]) =>
    !input.standardCode || codes.includes(input.standardCode);
  const summarizeStandard = (
    code: string,
    actual: boolean[],
    students: number,
    inferredCount: number,
    items: AchievementItem[],
  ): AchievementStandardRow => {
    const weightedItems = items.filter(
      (item) => item.points != null && typeof item.correct === "boolean",
    );
    const maximum = weightedItems.reduce((sum, item) => sum + item.points!, 0),
      earned = weightedItems.reduce(
        (sum, item) => sum + (item.correct ? item.points! : 0),
        0,
      );
    return {
      code,
      actual: rate(actual),
      students,
      inferredCount,
      weighted: {
        maximum,
        earned,
        percent: maximum ? (earned / maximum) * 100 : null,
        missing: items.length - weightedItems.length,
      },
    };
  };
  for (const student of input.students) {
    const attempt =
      selected.find((row) => row.studentUid === student.uid) || null;
    const ownStandards = new Map<
      string,
      { actual: boolean[]; items: AchievementItem[]; inferredCount: number }
    >();
    for (const item of attempt?.items || []) {
      if (!item.codes.length) unclassifiedItemCount++;
      if (typeof item.correct !== "boolean" || !relevant(item.codes)) continue;
      for (const code of item.codes.filter(
        (code) => !input.standardCode || code === input.standardCode,
      )) {
        const ownRow = ownStandards.get(code) || {
          actual: [],
          items: [],
          inferredCount: 0,
        };
        ownRow.actual.push(item.correct);
        ownRow.items.push(item);
        ownRow.inferredCount += Number(item.inferredMapping);
        ownStandards.set(code, ownRow);
        const group = standardMap.get(code) || {
          actual: [],
          items: [],
          students: new Set<string>(),
          inferredCount: 0,
        };
        group.actual.push(item.correct);
        group.items.push(item);
        group.students.add(student.uid);
        group.inferredCount += Number(item.inferredMapping);
        standardMap.set(code, group);
        const targetLevel = level(item.targetAchievementLevel),
          intendedDifficulty = difficulty(item.intendedDifficulty);
        const key = JSON.stringify([code, targetLevel, intendedDifficulty]);
        const cell = cells.get(key) || {
          standardCode: code,
          targetLevel,
          difficulty: intendedDifficulty,
          actual: [],
        };
        cell.actual.push(item.correct);
        cells.set(key, cell);
      }
    }
    const studentStandards = [...ownStandards].map(([code, row]) => {
      return summarizeStandard(
        code,
        row.actual,
        1,
        row.inferredCount,
        row.items,
      );
    });
    studentResults.push({
      student,
      attempt,
      standards: studentStandards,
      achievement: scoreByStudent.get(student.uid)!,
    });
  }
  const forms = new Map<string, AchievementAttempt[]>();
  const firstPerForm = new Map<string, AchievementAttempt[]>();
  for (const attempt of input.attempts.filter((row) => row.complete)) {
    const signature = attempt.items
      .map((item) => [item.id, item.sourceRevision])
      .sort(([a], [b]) => a.localeCompare(b));
    const key = JSON.stringify([signature, attempt.studentUid]);
    firstPerForm.set(key, [...(firstPerForm.get(key) || []), attempt]);
  }
  for (const entries of firstPerForm.values()) {
    const ordered = [...entries].sort(
      (a, b) => (a.submittedAt || 0) - (b.submittedAt || 0),
    );
    if (
      ordered.some((row) => row.submittedAt == null) ||
      (ordered[1] && ordered[0].submittedAt === ordered[1].submittedAt)
    )
      continue;
    const attempt = ordered[0];
    const signature = attempt.items
      .map((item) => [item.id, item.sourceRevision])
      .sort(([a], [b]) => a.localeCompare(b));
    const key = JSON.stringify(signature);
    forms.set(key, [...(forms.get(key) || []), attempt]);
  }
  const questionMap = new Map(input.questions.map((row) => [str(row.id), row]));
  const formStatistics: AchievementFormStatistics[] = [...forms].map(
    ([key, attempts]) => {
      const ids = attempts[0].items
        .map((item) => item.id)
        .sort(
          (a, b) =>
            (questionMap.get(a)?.paperOrder || Number(a) || 0) -
              (questionMap.get(b)?.paperOrder || Number(b) || 0) ||
            a.localeCompare(b),
        );
      const matrix = attempts.map((attempt) =>
        ids.map((id) =>
          Number(attempt.items.find((item) => item.id === id)!.correct),
        ),
      );
      const psychometrics = analyzeAchievementPsychometrics({
        itemIds: ids,
        rows: attempts.map((attempt, i) => ({
          studentId: attempt.studentUid,
          responses: matrix[i] as (0 | 1)[],
        })),
      });
      const itemStatistics = ids.flatMap(
        (id, index): AchievementItemStatistics[] => {
          const items = attempts.map(
            (row) => row.items.find((item) => item.id === id)!,
          );
          if (!items.some((item) => relevant(item.codes))) return [];
          const values = matrix.map((row) => row[index]);
          const metrics = psychometrics.items.find((item) => item.id === id)!;
          const options = items[0]?.options || [];
          const knownAnswers = items.filter((item) => item.answer !== null);
          return [
            {
              id,
              sampleSize: attempts.length,
              correctRate: mean(values)! * 100,
              discrimination: metrics.discrimination,
              upperLower27: metrics.upperLower27,
              upperLowerCount: metrics.upperLowerCount,
              alphaIfDeleted: metrics.alphaIfDeleted,
              targetAchievementLevel: level(items[0]?.targetAchievementLevel),
              intendedDifficulty: difficulty(items[0]?.intendedDifficulty),
              answerKey: items[0]?.answerKey || null,
              choices: options.map((answer) => ({
                answer,
                count: items.filter((item) => item.answer === answer).length,
                percent:
                  knownAnswers.length === items.length
                    ? (items.filter((item) => item.answer === answer).length /
                        items.length) *
                      100
                    : null,
              })),
              unanswered: items.filter((item) => item.answer === "").length,
              missingAnswer: items.filter((item) => item.answer == null).length,
              unlistedAnswer: items.filter(
                (item) => item.answer && !options.includes(item.answer),
              ).length,
              levelRates: [...ACHIEVEMENT_LEVELS, "unclassified" as const].map(
                (value) => {
                  const eligible = items.filter(
                    (item, i) =>
                      cumulativeLevel(attempts[i].studentUid) === value,
                  );
                  return {
                    level: value,
                    ...rate(eligible.map((item) => item.correct!)),
                  };
                },
              ),
              levelChoices: [
                ...ACHIEVEMENT_LEVELS,
                "unclassified" as const,
              ].map((value) => {
                const eligible = items.filter(
                  (item, i) =>
                    cumulativeLevel(attempts[i].studentUid) === value,
                );
                return {
                  level: value,
                  total: eligible.length,
                  choices: options.map(
                    (option) =>
                      eligible.filter((item) => item.answer === option).length,
                  ),
                  unanswered: eligible.filter((item) => item.answer === "")
                    .length,
                  missingAnswer: eligible.filter((item) => item.answer === null)
                    .length,
                  unlistedAnswer: eligible.filter(
                    (item) => item.answer && !options.includes(item.answer),
                  ).length,
                };
              }),
            },
          ];
        },
      );
      const scores = attempts.map((row) => row.scorePercent).filter(finite);
      return {
        key,
        sampleSize: attempts.length,
        itemCount: ids.length,
        mean: mean(scores),
        standardDeviation: deviation(scores),
        alpha: psychometrics.alpha,
        items: itemStatistics,
        psychometrics,
      };
    },
  );
  const scored = selected.map((row) => row.scorePercent).filter(finite);
  const histogram = Array.from({ length: 10 }, (_, index) => ({
    label: `${index * 10}–${index === 9 ? 100 : (index + 1) * 10}`,
    count: scored.filter(
      (score) =>
        score >= index * 10 &&
        (index === 9 ? score <= 100 : score < (index + 1) * 10),
    ).length,
  }));
  return {
    cumulativeScores,
    attempts: selected,
    standards: [...standardMap]
      .map(([code, row]) =>
        summarizeStandard(
          code,
          row.actual,
          row.students.size,
          row.inferredCount,
          row.items,
        ),
      )
      .sort((a, b) => a.code.localeCompare(b.code)),
    cells: [...cells.values()].map((row) => ({
      standardCode: row.standardCode,
      targetLevel: row.targetLevel,
      difficulty: row.difficulty,
      actual: rate(row.actual),
    })),
    students: studentResults,
    forms: formStatistics,
    histogram,
    scoredCount: scored.length,
    mean: mean(scored),
    standardDeviation: deviation(scored),
    levelCohorts: [...ACHIEVEMENT_LEVELS, "unclassified" as const].map(
      (value) => {
        const entries = selected.filter(
          (row) => cumulativeLevel(row.studentUid) === value,
        );
        const scores = entries.map((row) => row.scorePercent).filter(finite);
        return {
          level: value,
          count: entries.length,
          percent: selected.length
            ? (entries.length / selected.length) * 100
            : null,
          mean: mean(scores),
          standardDeviation: deviation(scores),
        };
      },
    ),
    unclassifiedItemCount,
    excludedChronologyCount,
  };
}
