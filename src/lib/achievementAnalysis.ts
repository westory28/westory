/** Read-only achievement evidence. Scores and participation never assign A–E. */
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
export interface AchievementObservation extends AchievementMetadata {
  id: string;
  studentUid: string;
  semesterId: string;
  source: "diagnostic" | "formative" | "worksheet";
  itemId: string;
  sourceRevision?: string;
  observedAt: unknown;
  correct: boolean | null;
  filled: boolean | null;
  hintViewed: boolean | null;
  metadataSource?: "snapshot" | "current" | "lesson";
  quality?: "complete" | "limited";
  recordSource?: "canonical" | "legacy";
  resultId?: string;
  questionId?: string;
}
export interface AchievementEvidence {
  version: 1;
  status: "ready" | "partial";
  observations: AchievementObservation[];
  examCutoffs?: Array<{
    attemptId: string;
    resultId: string;
    studentUid: string;
    startedAt: unknown;
    source?: "result" | "attempt";
  }>;
  exclusions?: Record<string, number>;
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
export interface AchievementReviewedProfile {
  studentUid: string;
  standardCode: string;
  curriculumVersion: string;
  level: AchievementLevel | null;
  asOf: unknown;
  reviewedAt: unknown;
  revision?: number;
  examAttemptId?: string;
  evidenceRefs?: Array<{ resultId: string; questionId: string }>;
  rubricVersion?: string;
  stale?: boolean;
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
  expectedPercent: number | null;
  pairedActual: AchievementRate;
  priorEvidenceCount: number;
  pairedStudentCount: number;
  missingBaselineCount: number;
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
  diagnostic: AchievementRate;
  formative: AchievementRate;
  worksheet: {
    recorded: number;
    filled: number;
    gradedFilled: number;
    correct: number;
  };
}
export interface AchievementStudentProfile {
  student: AchievementStudent;
  attempt: AchievementAttempt | null;
  standards: AchievementStandardRow[];
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
  missingCutoffCount: number;
  excludedChronologyCount: number;
  futureEvidenceCount: number;
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

export function adaptAchievementAttempts(input: {
  semesterId: string;
  students: readonly AchievementStudent[];
  questions: readonly AchievementQuestion[];
  rawRows: readonly AchievementRawRecord[];
  evidence: AchievementEvidence;
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
    const cutoff = input.evidence.examCutoffs?.find(
      (value) =>
        value.studentUid === uid &&
        (value.resultId === row.id || value.attemptId === raw.attemptId),
    );
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
      startedAt: achievementTimestamp(cutoff?.startedAt),
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

export function confirmedAchievementLevel(
  profiles: readonly AchievementReviewedProfile[],
  uid: string,
  codes: string[],
  cutoff: number | null,
  attemptId?: string,
): AchievementLevel | "unclassified" {
  if (!codes.length || cutoff == null) return "unclassified";
  const values = codes.map((code) => {
    const eligible = profiles.filter(
      (profile) =>
        !profile.stale &&
        profile.studentUid === uid &&
        profile.standardCode === code &&
        profile.curriculumVersion === "2018-162" &&
        level(profile.level) &&
        (!profile.examAttemptId || profile.examAttemptId === attemptId) &&
        achievementTimestamp(profile.asOf) != null &&
        achievementTimestamp(profile.asOf)! <= cutoff &&
        achievementTimestamp(profile.reviewedAt) != null,
    );
    eligible.sort(
      (a, b) =>
        achievementTimestamp(b.reviewedAt)! -
        achievementTimestamp(a.reviewedAt)!,
    );
    if (
      !eligible.length ||
      (eligible[1] &&
        achievementTimestamp(eligible[0].reviewedAt) ===
          achievementTimestamp(eligible[1].reviewedAt))
    )
      return "";
    return eligible[0].level;
  });
  return values.every((value) => value && value === values[0])
    ? (values[0] as AchievementLevel)
    : "unclassified";
}

export function buildAchievementAnalysis(input: {
  semesterId: string;
  students: readonly AchievementStudent[];
  questions: readonly AchievementQuestion[];
  attempts: readonly AchievementAttempt[];
  evidence: AchievementEvidence;
  resolveCodes: ResolveCodes;
  reviewedProfiles?: readonly AchievementReviewedProfile[];
  standardCode?: string;
}): AchievementAnalysis {
  const profiles = input.reviewedProfiles || [];
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
  const observations = new Map<
    string,
    AchievementObservation & { codes: string[]; at: number }
  >();
  for (const value of input.evidence.observations || []) {
    const at = achievementTimestamp(value.observedAt);
    if (
      value.semesterId !== input.semesterId ||
      at == null ||
      !value.studentUid ||
      !value.itemId
    )
      continue;
    const key = `${value.studentUid}:${value.source}:${value.id}`;
    if (!observations.has(key))
      observations.set(key, {
        ...value,
        codes: input.resolveCodes(value).codes,
        at,
      });
  }
  const standardMap = new Map<
    string,
    {
      actual: boolean[];
      items: AchievementItem[];
      students: Set<string>;
      inferredCount: number;
      prior: typeof observations extends Map<string, infer V> ? V[] : never;
    }
  >();
  const cells = new Map<
    string,
    {
      standardCode: string;
      targetLevel: AchievementLevel | "";
      difficulty: AchievementDifficulty | "";
      actual: boolean[];
      expected: number[];
      paired: boolean[];
      priorKeys: Set<string>;
      pairedStudents: Set<string>;
      missing: number;
    }
  >();
  const studentResults: AchievementStudentProfile[] = [];
  let futureEvidenceCount = 0;
  let unclassifiedItemCount = 0;
  const relevant = (codes: string[]) =>
    !input.standardCode || codes.includes(input.standardCode);
  const summarizeStandard = (
    code: string,
    actual: boolean[],
    priors: Array<AchievementObservation>,
    students: number,
    inferredCount: number,
    items: AchievementItem[],
  ): AchievementStandardRow => {
    const worksheet = priors.filter((row) => row.source === "worksheet");
    const filled = worksheet.filter((row) => row.filled === true);
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
      diagnostic: rate(
        priors
          .filter(
            (row) =>
              row.source === "diagnostic" && typeof row.correct === "boolean",
          )
          .map((row) => row.correct!),
      ),
      formative: rate(
        priors
          .filter(
            (row) =>
              row.source === "formative" && typeof row.correct === "boolean",
          )
          .map((row) => row.correct!),
      ),
      worksheet: {
        recorded: worksheet.length,
        filled: filled.length,
        gradedFilled: filled.filter((row) => typeof row.correct === "boolean")
          .length,
        correct: filled.filter((row) => row.correct === true).length,
      },
    };
  };
  for (const student of input.students) {
    const attempt =
      selected.find((row) => row.studentUid === student.uid) || null;
    const own = [...observations.values()].filter(
      (row) => row.studentUid === student.uid,
    );
    const before =
      attempt?.startedAt != null
        ? own.filter((row) => row.at < attempt.startedAt!)
        : [];
    futureEvidenceCount +=
      attempt?.startedAt != null ? own.length - before.length : 0;
    // Latest distinct recorded item for descriptive evidence; repeated attempts do not inflate denominators.
    const latest = new Map<string, (typeof before)[number]>();
    const ambiguous = new Set<string>();
    for (const row of before) {
      const key = `${row.source}:${row.itemId}:${row.sourceRevision || ""}`;
      const previous = latest.get(key);
      if (!previous || row.at > previous.at) {
        latest.set(key, row);
        ambiguous.delete(key);
      } else if (
        row.at === previous.at &&
        (row.correct !== previous.correct || row.filled !== previous.filled)
      )
        ambiguous.add(key);
    }
    const descriptive = [...latest]
      .filter(([key]) => !ambiguous.has(key))
      .map(([, value]) => value);
    // First exposure in each item family is the independent baseline. Later corrections cannot replace it.
    const firstFamilies = new Map<string, (typeof before)[number]>();
    const tiedFamilies = new Set<string>();
    const firstItems = new Map<string, (typeof before)[number]>();
    const tiedItems = new Set<string>();
    for (const row of before.filter((value) => value.source !== "worksheet")) {
      const previous = firstItems.get(row.itemId);
      if (!previous || row.at < previous.at) {
        firstItems.set(row.itemId, row);
        tiedItems.delete(row.itemId);
      } else if (
        row.at === previous.at &&
        (row.correct !== previous.correct ||
          row.hintViewed !== previous.hintViewed ||
          row.familyId !== previous.familyId)
      )
        tiedItems.add(row.itemId);
    }
    for (const row of [...firstItems.values()].filter(
      (value) => !tiedItems.has(value.itemId),
    )) {
      const key = row.familyId || `question:${row.itemId}`;
      const previous = firstFamilies.get(key);
      if (!previous || row.at < previous.at) {
        firstFamilies.set(key, row);
        tiedFamilies.delete(key);
      } else if (
        row.at === previous.at &&
        (row.itemId !== previous.itemId ||
          row.correct !== previous.correct ||
          row.hintViewed !== previous.hintViewed)
      )
        tiedFamilies.add(key);
    }
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
          prior: [],
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
          expected: [],
          paired: [],
          priorKeys: new Set<string>(),
          pairedStudents: new Set<string>(),
          missing: 0,
        };
        cell.actual.push(item.correct);
        const family = item.familyId || `question:${item.id}`;
        const baseline = [...firstFamilies]
          .filter(
            ([key, row]) =>
              key !== family &&
              row.itemId !== item.id &&
              !tiedFamilies.has(key) &&
              row.codes.includes(code) &&
              targetLevel &&
              intendedDifficulty &&
              row.targetAchievementLevel === targetLevel &&
              row.intendedDifficulty === intendedDifficulty &&
              row.hintViewed === false &&
              typeof row.correct === "boolean" &&
              row.quality !== "limited",
          )
          .map(([, value]) => value);
        // This is a data sufficiency policy, never an achievement-level cut score.
        if (baseline.length >= 3) {
          cell.expected.push(
            (baseline.filter((row) => row.correct).length / baseline.length) *
              100,
          );
          cell.paired.push(item.correct);
          baseline.forEach((row) =>
            cell.priorKeys.add(`${row.studentUid}:${row.source}:${row.id}`),
          );
          cell.pairedStudents.add(student.uid);
        } else cell.missing++;
        cells.set(key, cell);
      }
    }
    const studentStandards = [...ownStandards].map(([code, row]) => {
      const priors = descriptive.filter((value) => value.codes.includes(code));
      standardMap.get(code)!.prior.push(...priors);
      return summarizeStandard(
        code,
        row.actual,
        priors,
        1,
        row.inferredCount,
        row.items,
      );
    });
    studentResults.push({ student, attempt, standards: studentStandards });
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
                      confirmedAchievementLevel(
                        profiles,
                        attempts[i].studentUid,
                        input.standardCode ? [input.standardCode] : item.codes,
                        attempts[i].startedAt,
                        attempts[i].attemptId,
                      ) === value,
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
                    confirmedAchievementLevel(
                      profiles,
                      attempts[i].studentUid,
                      input.standardCode ? [input.standardCode] : item.codes,
                      attempts[i].startedAt,
                      attempts[i].attemptId,
                    ) === value,
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
    attempts: selected,
    standards: [...standardMap]
      .map(([code, row]) =>
        summarizeStandard(
          code,
          row.actual,
          row.prior,
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
      expectedPercent: mean(row.expected),
      pairedActual: rate(row.paired),
      priorEvidenceCount: row.priorKeys.size,
      pairedStudentCount: row.pairedStudents.size,
      missingBaselineCount: row.missing,
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
          (row) =>
            confirmedAchievementLevel(
              profiles,
              row.studentUid,
              input.standardCode ? [input.standardCode] : [],
              row.startedAt,
              row.attemptId,
            ) === value,
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
    missingCutoffCount: selected.filter((row) => row.startedAt == null).length,
    excludedChronologyCount,
    futureEvidenceCount,
  };
}
