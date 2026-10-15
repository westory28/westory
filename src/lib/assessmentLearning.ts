/** Descriptive learning evidence, never a mastery or ability estimate. */
export interface AssessmentLearningQuestion {
  id: string | number;
  sourceRevision?: string;
  metadataLimited?: boolean;
  unitId?: string | null;
  subUnitId?: string | null;
  refBig?: string | null;
  refMid?: string | null;
  refSmall?: string | null;
  concepts?: string[];
  cognitiveProcess?: string;
  familyId?: string;
  derivedFromQuestionId?: string;
  misconceptionTags?: Record<string, string>;
  reviewLessonId?: string;
}

export type AssessmentLearningConfidence = "sure" | "unsure" | "unknown";

export interface AssessmentLearningItem {
  questionId: string | number;
  correct: boolean;
  answer?: string;
  confidence?: AssessmentLearningConfidence | null;
  hintViewed?: boolean;
}

export interface AssessmentLearningAttempt {
  id: string;
  studentUid: string;
  semesterId: string;
  submittedAt: unknown;
  items: AssessmentLearningItem[];
  /** Use the server's metadata snapshot when available, including empty tags. */
  questionMetadata?: AssessmentLearningQuestion[];
}

export type AssessmentLearningEvidence =
  | "insufficient"
  | "review"
  | "recheck"
  | "positive";

export interface AssessmentLearningGroup {
  key: string;
  label: string;
  distinctQuestions: number;
  correctQuestions: number;
  wrongQuestions: number;
  firstCorrectQuestions: number;
  repeatedAttempts: number;
  evidence: AssessmentLearningEvidence;
  questionIds: string[];
  wrongQuestionIds: string[];
  reviewLessonIds: string[];
  /** Unseen only within the attempts supplied by the caller. */
  unseenQuestionIds: string[];
  possibleConfusions: string[];
  unsureQuestionCount: number;
  confidentWrongQuestionCount: number;
  hintedQuestionCount: number;
  contentChangedQuestionCount: number;
  limitedMetadataQuestionCount: number;
  chronologyIncomplete: boolean;
}

export interface AssessmentLearningSummary {
  units: AssessmentLearningGroup[];
  concepts: AssessmentLearningGroup[];
  cognitiveProcesses: AssessmentLearningGroup[];
  assessedQuestionCount: number;
  attemptCount: number;
  missingUnitQuestionCount: number;
  missingConceptQuestionCount: number;
  missingCognitiveProcessQuestionCount: number;
  /** Current bank metadata is an explicit fallback, not a historical snapshot. */
  currentMetadataQuestionCount: number;
  contentChangedQuestionCount: number;
  limitedMetadataQuestionCount: number;
  chronologyIncomplete: boolean;
  excludedAttemptCount: number;
}

export const ASSESSMENT_LEARNING_EVIDENCE_LABELS: Record<
  AssessmentLearningEvidence,
  string
> = {
  insufficient: "자료 부족",
  review: "복습 후 재확인",
  recheck: "다른 문제로 재확인",
  positive: "현재 문항에서 정답 확인",
};

const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";

const uniqueText = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : [];

export const getAssessmentLearningUnitId = (
  question: AssessmentLearningQuestion,
) =>
  text(question.refSmall) ||
  text(question.subUnitId) ||
  text(question.refMid) ||
  text(question.refBig) ||
  text(question.unitId);

const timestampMs = (value: unknown): number | null => {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object") {
    const source = value as {
      toMillis?: () => number;
      seconds?: number;
      nanoseconds?: number;
    };
    if (typeof source.toMillis === "function") {
      try {
        const parsed = source.toMillis();
        return Number.isFinite(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    if (typeof source.seconds === "number") {
      const parsed =
        source.seconds * 1000 + Number(source.nanoseconds || 0) / 1_000_000;
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
};

interface Observation {
  attemptId: string;
  submittedMs: number | null;
  item: AssessmentLearningItem;
  metadata: AssessmentLearningQuestion;
  fromSnapshot: boolean;
}

interface QuestionEvidence {
  id: string;
  first: Observation;
  latest: Observation;
  repeats: number;
  chronologyIncomplete: boolean;
  contentChanged: boolean;
}

type Dimension = "unit" | "concept" | "cognitiveProcess";

const groupKeys = (
  question: AssessmentLearningQuestion,
  dimension: Dimension,
): string[] => {
  if (dimension === "concept") return uniqueText(question.concepts);
  if (dimension === "cognitiveProcess") {
    const process = text(question.cognitiveProcess);
    return process ? [process] : [];
  }
  const unit = getAssessmentLearningUnitId(question);
  return unit ? [unit] : [];
};

const buildGroups = (
  evidence: QuestionEvidence[],
  questions: AssessmentLearningQuestion[],
  dimension: Dimension,
) => {
  const groups = new Map<string, QuestionEvidence[]>();
  const seenQuestionIds = new Set(evidence.map((row) => row.id));
  for (const row of evidence) {
    for (const key of groupKeys(row.latest.metadata, dimension)) {
      groups.set(key, [...(groups.get(key) || []), row]);
    }
  }
  return [...groups].map(([key, rows]): AssessmentLearningGroup => {
    const wrong = rows.filter((row) => !row.latest.item.correct);
    const unsure = rows.filter(
      (row) =>
        row.latest.item.confidence === "unsure" ||
        row.latest.item.confidence === "unknown",
    );
    const chronologyIncomplete = rows.some((row) => row.chronologyIncomplete);
    const hinted = rows.filter((row) => row.latest.item.hintViewed === true);
    const recoveredOnSameQuestion = rows.some(
      (row) => !row.first.item.correct && row.latest.item.correct,
    );
    // Three different questions is only a display threshold for a descriptive
    // summary. It must never be presented as a validated mastery cut-off.
    const status: AssessmentLearningEvidence =
      rows.length < 3 || chronologyIncomplete
        ? "insufficient"
        : wrong.length > 0
          ? "review"
          : recoveredOnSameQuestion || unsure.length > 0 || hinted.length > 0
            ? "recheck"
            : "positive";
    const possibleConfusions = wrong
      .map((row) => {
        const tags = row.latest.metadata.misconceptionTags;
        const answer = text(row.latest.item.answer);
        return tags &&
          answer &&
          Object.prototype.hasOwnProperty.call(tags, answer)
          ? text(tags[answer])
          : "";
      })
      .filter(Boolean);
    return {
      key,
      label: key,
      distinctQuestions: rows.length,
      correctQuestions: rows.length - wrong.length,
      wrongQuestions: wrong.length,
      firstCorrectQuestions: rows.filter((row) => row.first.item.correct)
        .length,
      repeatedAttempts: rows.reduce((sum, row) => sum + row.repeats, 0),
      evidence: status,
      questionIds: rows.map((row) => row.id),
      wrongQuestionIds: wrong.map((row) => row.id),
      reviewLessonIds: uniqueText(
        rows.map((row) => row.latest.metadata.reviewLessonId),
      ),
      unseenQuestionIds: uniqueText(
        questions
          .filter(
            (question) =>
              !seenQuestionIds.has(text(question.id)) &&
              groupKeys(question, dimension).includes(key),
          )
          .map((question) => question.id),
      ),
      possibleConfusions: uniqueText(possibleConfusions),
      unsureQuestionCount: unsure.length,
      confidentWrongQuestionCount: wrong.filter(
        (row) => row.latest.item.confidence === "sure",
      ).length,
      hintedQuestionCount: hinted.length,
      contentChangedQuestionCount: rows.filter((row) => row.contentChanged)
        .length,
      limitedMetadataQuestionCount: rows.filter(
        (row) => row.latest.metadata.metadataLimited === true,
      ).length,
      chronologyIncomplete,
    };
  });
};

/**
 * Pure and read-only. Callers must query the authorized current-semester scope;
 * identity and semester are checked again here to avoid accidental mixing.
 * Never supply drafts, client-estimated correctness, or unfinished attempts.
 */
export const buildAssessmentLearningSummary = (input: {
  studentUid: string;
  semesterId: string;
  questions: AssessmentLearningQuestion[];
  attempts: AssessmentLearningAttempt[];
}): AssessmentLearningSummary => {
  const studentUid = text(input.studentUid);
  const semesterId = text(input.semesterId);
  const questions = input.questions.filter((question) => text(question.id));
  const metadataById = new Map(
    questions.map((question) => [text(question.id), question]),
  );
  const attemptsById = new Map<string, AssessmentLearningAttempt>();
  let excludedAttemptCount = 0;
  for (const attempt of input.attempts) {
    if (
      !studentUid ||
      !semesterId ||
      !text(attempt.id) ||
      text(attempt.studentUid) !== studentUid ||
      text(attempt.semesterId) !== semesterId
    ) {
      excludedAttemptCount += 1;
      continue;
    }
    const existing = attemptsById.get(text(attempt.id));
    // A repeated immutable result is one attempt, regardless of how often it
    // was fetched. Prefer the latest timestamp if a legacy adapter duplicated it.
    if (
      !existing ||
      (timestampMs(attempt.submittedAt) ?? -Infinity) >
        (timestampMs(existing.submittedAt) ?? -Infinity)
    ) {
      attemptsById.set(text(attempt.id), attempt);
    }
  }
  const byQuestion = new Map<string, Observation[]>();
  for (const attempt of attemptsById.values()) {
    const snapshots = new Map(
      (attempt.questionMetadata || []).map((question) => [
        text(question.id),
        question,
      ]),
    );
    const seenInAttempt = new Set<string>();
    for (const item of attempt.items) {
      const id = text(item.questionId);
      if (!id || typeof item.correct !== "boolean" || seenInAttempt.has(id)) {
        continue;
      }
      seenInAttempt.add(id);
      const snapshot = snapshots.get(id);
      const observation: Observation = {
        attemptId: text(attempt.id),
        submittedMs: timestampMs(attempt.submittedAt),
        item,
        metadata: snapshot || metadataById.get(id) || { id },
        fromSnapshot: Boolean(snapshot),
      };
      byQuestion.set(id, [...(byQuestion.get(id) || []), observation]);
    }
  }
  const evidence = [...byQuestion].map(
    ([id, observations]): QuestionEvidence => {
      observations.sort(
        (left, right) =>
          (left.submittedMs ?? -Infinity) - (right.submittedMs ?? -Infinity) ||
          left.attemptId.localeCompare(right.attemptId),
      );
      const latest = observations[observations.length - 1];
      const latestRevision = text(latest.metadata.sourceRevision);
      const comparableObservations = latestRevision
        ? observations.filter(
            (row) => text(row.metadata.sourceRevision) === latestRevision,
          )
        : observations;
      const contentChanged = observations.some(
        (row) => text(row.metadata.sourceRevision) !== latestRevision,
      );
      const chronologicalTimes = observations.map((row) => row.submittedMs);
      return {
        id,
        // Editing the same question does not create another independent item.
        // First/latest comparison is limited to the latest explicit revision.
        first: comparableObservations[0],
        latest,
        repeats: observations.length - 1,
        contentChanged,
        chronologyIncomplete:
          observations.length > 1 &&
          ((contentChanged && !latestRevision) ||
            chronologicalTimes.includes(null) ||
            new Set(chronologicalTimes).size !== observations.length),
      };
    },
  );
  return {
    units: buildGroups(evidence, questions, "unit"),
    concepts: buildGroups(evidence, questions, "concept"),
    cognitiveProcesses: buildGroups(evidence, questions, "cognitiveProcess"),
    assessedQuestionCount: evidence.length,
    attemptCount: attemptsById.size,
    missingUnitQuestionCount: evidence.filter(
      (row) => !getAssessmentLearningUnitId(row.latest.metadata),
    ).length,
    missingConceptQuestionCount: evidence.filter(
      (row) => !uniqueText(row.latest.metadata.concepts).length,
    ).length,
    missingCognitiveProcessQuestionCount: evidence.filter(
      (row) => !text(row.latest.metadata.cognitiveProcess),
    ).length,
    currentMetadataQuestionCount: evidence.filter(
      (row) => !row.latest.fromSnapshot && metadataById.has(row.id),
    ).length,
    contentChangedQuestionCount: evidence.filter((row) => row.contentChanged)
      .length,
    limitedMetadataQuestionCount: evidence.filter(
      (row) => row.latest.metadata.metadataLimited === true,
    ).length,
    chronologyIncomplete: evidence.some((row) => row.chronologyIncomplete),
    excludedAttemptCount,
  };
};
