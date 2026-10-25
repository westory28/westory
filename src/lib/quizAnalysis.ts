/** Read-only quiz analysis. Response patterns never alter grades or rewards. */
export interface QuizAnalysisStudent {
  uid: string;
  name?: string;
  classId?: string;
  number?: string | number;
}

export interface QuizAnalysisQuestion {
  id: string | number;
  sourceRevision?: string;
  contentRevision?: number;
  unitId?: string | null;
  subUnitId?: string | null;
  refBig?: string | null;
  refMid?: string | null;
  refSmall?: string | null;
  category?: string;
  examRound?: string;
  concepts?: string[];
  type?: string;
  options?: string[];
  reviewLessonId?: string;
}

export interface QuizAnalysisItem {
  questionId: string | number;
  correct: boolean | null;
  /** Empty string is a recorded non-answer; absent/null is an unavailable answer. */
  answer?: string | null;
  sourceRevision?: string;
  /** Metadata from this attempt, never guessed from the current question bank. */
  concepts?: string[];
  reviewLessonId?: string;
}

export interface QuizAnalysisRecord {
  id: string;
  source: "canonical" | "legacy";
  studentUid: string;
  semesterId: string;
  unitId?: string;
  category?: string;
  examRound?: string;
  submittedAt: unknown;
  scorePercent: number | null;
  items: QuizAnalysisItem[];
  attemptId?: string;
  canonicalAttemptId?: string;
  submissionRef?: string;
  resultRef?: string;
  resultId?: string;
  legacyResultId?: string;
  /** Server-recorded item count, needed to verify a complete test form. */
  totalCount?: number;
  definitionId?: string;
  /** Optional, server-normalized telemetry. Unavailable data stays unknown. */
  analytics?: unknown;
  /** False prevents a detail-only answer join from changing summary categories. */
  behaviorAnswersAvailable?: boolean;
}

export type QuizBehaviorCategory =
  | "suspected_guessing"
  | "repeated_choice"
  | "unflagged"
  | "insufficient"
  | "no_attempt";

export const QUIZ_BEHAVIOR_LABELS: Record<QuizBehaviorCategory, string> = {
  suspected_guessing: "찍기 추정",
  repeated_choice: "반복 선택",
  unflagged: "미해당",
  insufficient: "기록 부족",
  no_attempt: "미응시",
};

export interface QuizResponseBehavior {
  category: QuizBehaviorCategory;
  eligibleQuestionCount: number;
  observedQuestionCount: number;
  coveragePercent: number | null;
  medianActiveMs: number | null;
  fastQuestionCount: number;
  fastCorrectCount: number;
  fastWrongCount: number;
  fastAccuracy: number | null;
  answerChangeCount: number | null;
  revisitCount: number | null;
  repeatedChoice: {
    label: string;
    count: number;
    total: number;
    percent: number;
  } | null;
  flags: { rapid: boolean; repeated: boolean };
  reason: string | null;
}

export interface QuizAnalysisScope {
  /** Selected unit and its descendants. An empty array selects no units. */
  unitIds?: string[];
  /** Explicit search results. An empty array selects no questions. */
  questionIds?: string[];
  /** Search-only percentage from each current question's latest known outcome. */
  scoreBasis?: "latest_current_revision_items";
  category?: string;
  examRound?: string;
  classId?: string;
}

export interface QuizAnalysisOption {
  answer: string;
  count: number;
  /** Percentage of students with a recorded non-empty answer. */
  percent: number;
  listedOption: boolean;
}

export interface QuizAnalysisConcept {
  concept: string;
  correctQuestionIds: string[];
  wrongQuestionIds: string[];
  reviewLessonIds: string[];
}

export interface QuizAnalysisChanges {
  /** Only the same question at the same explicit current revision is compared. */
  comparedQuestionCount: number;
  wrongToCorrectCount: number;
  correctToWrongCount: number;
  unchangedCorrectCount: number;
  unchangedWrongCount: number;
  chronologyUnknownQuestionCount: number;
  /** Descriptive outcomes on repeated items do not establish learning gains. */
  basis: "same_question_same_revision";
}

export interface QuizAnalysisStudentRow extends QuizAnalysisStudent {
  attemptCount: number;
  latestRecord: QuizAnalysisRecord | null;
  latestScore: number | null;
  scoreUnavailableReason:
    | "no_attempt"
    | "missing_score"
    | "chronology_unknown"
    | "partial_scope"
    | null;
  correctCount: number;
  wrongCount: number;
  unknownCount: number;
  assessedQuestionCount: number;
  currentQuestionCount: number;
  revisionExcludedCount: number;
  revisionUnknownCount: number;
  missingConceptQuestionCount: number;
  /** Concepts with a latest current-version, known outcome (including correct). */
  assessedConcepts: string[];
  wrongConcepts: QuizAnalysisConcept[];
  changes: QuizAnalysisChanges;
  behavior: QuizResponseBehavior;
}

export interface QuizAnalysisQuestionRow {
  id: string;
  /** Students who have any record, including old or unknown revisions. */
  attemptedStudentCount: number;
  /** Students with a latest response at the explicit current revision. */
  distinctStudents: number;
  /** Denominator for correctRate; unknown correctness is excluded. */
  assessedStudentCount: number;
  correctCount: number;
  wrongCount: number;
  unknownCorrectnessCount: number;
  correctRate: number | null;
  knownAnswerStudentCount: number;
  unansweredCount: number;
  missingAnswerCount: number;
  optionDistribution: QuizAnalysisOption[];
  revisionExcludedCount: number;
  revisionUnknownCount: number;
  chronologyUnknownCount: number;
}

export interface QuizAnalysisSummary {
  students: QuizAnalysisStudentRow[];
  questions: QuizAnalysisQuestionRow[];
  scoreHistogram: Array<{
    label: string;
    lower: number;
    upper: number;
    count: number;
  }>;
  averageScore: number | null;
  scoredStudentCount: number;
  missingScoreStudentCount: number;
  participantCount: number;
  /** Authorized historical result owners absent from the current roster. */
  unlistedParticipantCount: number;
  recordCount: number;
  duplicateRecordCount: number;
  excludedRecordCount: number;
  scoreBasis: "latest_recorded_attempt" | "latest_current_revision_items";
  rosterAvailable: boolean;
}

export type QuizCorrelationUnavailableReason =
  | "insufficient_students"
  | "single_item"
  | "constant_item"
  | "constant_rest_score";

export interface QuizItemStatisticsCohort {
  /** Exact assessment + sorted question IDs and explicit revision pairs. */
  formKey: string;
  itemCount: number;
  sampleSize: number;
  /** Product caution threshold, not a minimum prescribed by UW. */
  smallSample: boolean;
  correctCount: number;
  difficultyPercent: number;
  correctedItemTotalCorrelation: number | null;
  correlationUnavailableReason: QuizCorrelationUnavailableReason | null;
  alphaReliability: number | null;
  alphaUnavailableReason:
    | "insufficient_students"
    | "single_item"
    | "constant_total_score"
    | null;
  options: Array<{
    answer: string;
    count: number;
    /** All students in this exact form, including recorded non-answers. */
    percent: number;
    /** Mean percent correct on the other items, excluding this item. */
    meanRestPercent: number | null;
    listedOption: boolean;
  }>;
  unansweredCount: number;
  missingAnswerCount: number;
}

export interface QuizItemStatisticsRow {
  id: string;
  formCount: number;
  cohorts: QuizItemStatisticsCohort[];
}

export interface QuizItemStatisticsSummary {
  basis: "first_recorded_submission_same_form";
  questions: QuizItemStatisticsRow[];
  firstSubmissionCount: number;
  eligibleSubmissionCount: number;
  excludedChronologyCount: number;
  excludedIncompleteCount: number;
  excludedRevisionCount: number;
}

const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
const has = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
const uniqueText = (values: readonly unknown[] | undefined) => [
  ...new Set((values || []).map(text).filter(Boolean)),
];
const revision = (value: unknown) => {
  const result = text(value);
  return result && result !== "legacy" ? result : "";
};
const score = (value: unknown): number | null =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 100
    ? value
    : null;

const timestamp = (value: unknown): number | null => {
  if (value instanceof Date)
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object") {
    const row = value as {
      toMillis?: () => number;
      seconds?: unknown;
      nanoseconds?: unknown;
    };
    if (typeof row.toMillis === "function") {
      try {
        return timestamp(row.toMillis());
      } catch {
        return null;
      }
    }
    if (typeof row.seconds === "number" && Number.isFinite(row.seconds)) {
      const nanos =
        typeof row.nanoseconds === "number" && Number.isFinite(row.nanoseconds)
          ? row.nanoseconds
          : 0;
      return row.seconds * 1000 + nanos / 1e6;
    }
  }
  return null;
};

const recordRefs = (row: QuizAnalysisRecord) => {
  const refs = [
    `${row.source === "canonical" ? "result" : "legacy"}:${text(row.id)}`,
  ];
  for (const value of [row.attemptId, row.canonicalAttemptId])
    if (text(value)) refs.push(`attempt:${text(value)}`);
  if (text(row.resultId))
    refs.push(
      `${row.source === "canonical" ? "result" : "legacy"}:${text(row.resultId)}`,
    );
  if (text(row.legacyResultId)) refs.push(`legacy:${text(row.legacyResultId)}`);
  for (const value of [row.resultRef, row.submissionRef]) {
    const path = text(value);
    const match = path.match(
      /(?:^|\/)(semester_assessment_results|semester_assessment_submissions|quiz_results)\/([^/]+)$/,
    );
    if (match)
      refs.push(
        `${match[1] === "semester_assessment_results" ? "result" : match[1] === "semester_assessment_submissions" ? "submission" : "legacy"}:${match[2]}`,
      );
  }
  return refs;
};

/** Explicit references only. Equal timestamps, scores, names, or answers are not identity. */
export const deduplicateQuizAnalysisRecords = (
  records: readonly QuizAnalysisRecord[],
) => {
  const ordered = [...records].sort(
    (a, b) =>
      Number(b.source === "canonical") - Number(a.source === "canonical") ||
      text(a.id).localeCompare(text(b.id)),
  );
  const parents = ordered.map((_, index) => index);
  const find = (index: number): number =>
    parents[index] === index ? index : (parents[index] = find(parents[index]));
  const owners = new Map<string, number>();
  ordered.forEach((row, index) => {
    for (const ref of recordRefs(row)) {
      const key = JSON.stringify([
        text(row.studentUid),
        text(row.semesterId),
        ref,
      ]);
      const owner = owners.get(key);
      if (owner === undefined) owners.set(key, index);
      else {
        const left = find(owner),
          right = find(index);
        parents[Math.max(left, right)] = Math.min(left, right);
      }
    }
  });
  return ordered.filter((_, index) => find(index) === index);
};

const questionInScope = (
  question: QuizAnalysisQuestion,
  scope: QuizAnalysisScope,
) => {
  const units = [
    question.unitId,
    question.subUnitId,
    question.refBig,
    question.refMid,
    question.refSmall,
  ].map(text);
  return (
    (!scope.questionIds || scope.questionIds.includes(text(question.id))) &&
    (!scope.unitIds || scope.unitIds.some((id) => units.includes(text(id)))) &&
    (!scope.category || text(question.category) === scope.category) &&
    (!scope.examRound ||
      !text(question.examRound) ||
      text(question.examRound) === scope.examRound)
  );
};

const latest = <T extends { submittedAt: unknown }>(
  rows: readonly T[],
): { value: T | null; chronologyUnknown: boolean } => {
  if (!rows.length) return { value: null, chronologyUnknown: false };
  if (rows.length === 1) return { value: rows[0], chronologyUnknown: false };
  const times = rows.map((row) => timestamp(row.submittedAt));
  if (times.includes(null)) return { value: null, chronologyUnknown: true };
  const maximum = Math.max(...(times as number[]));
  const winners = rows.filter((_, index) => times[index] === maximum);
  return {
    value: winners.length === 1 ? winners[0] : null,
    chronologyUnknown: winners.length !== 1,
  };
};

interface Response {
  item: QuizAnalysisItem;
  record: QuizAnalysisRecord;
  submittedAt: unknown;
}
interface StudentQuestion {
  question: QuizAnalysisQuestion;
  rows: Response[];
  currentRows: Response[];
  latest: Response | null;
  chronologyUnknown: boolean;
  revisionExcluded: boolean;
  revisionUnknown: boolean;
}

const buildStudentQuestions = (
  records: QuizAnalysisRecord[],
  questions: QuizAnalysisQuestion[],
): StudentQuestion[] =>
  questions.map((question) => {
    const id = text(question.id);
    const rows: Response[] = records.flatMap((record) => {
      // Duplicate items within one result must not add independent observations.
      const matches = record.items.filter(
        (item) => text(item.questionId) === id,
      );
      if (!matches.length) return [];
      // A malformed duplicate outcome is unavailable, rather than arbitrarily true/false.
      const item =
        matches.length === 1
          ? matches[0]
          : {
              questionId: id,
              correct: null,
              sourceRevision: matches.every(
                (entry) =>
                  revision(entry.sourceRevision) ===
                  revision(matches[0].sourceRevision),
              )
                ? matches[0].sourceRevision
                : undefined,
            };
      return [{ item, record, submittedAt: record.submittedAt }];
    });
    const currentRevision =
      revision(question.sourceRevision) || revision(question.contentRevision);
    const currentRows = rows.filter(
      (row) =>
        !!currentRevision &&
        revision(row.item.sourceRevision) === currentRevision,
    );
    const selected = latest(currentRows);
    return {
      question,
      rows,
      currentRows,
      latest: selected.value,
      chronologyUnknown: selected.chronologyUnknown,
      revisionExcluded: rows.some(
        (row) =>
          !!currentRevision &&
          !!revision(row.item.sourceRevision) &&
          revision(row.item.sourceRevision) !== currentRevision,
      ),
      revisionUnknown: rows.some(
        (row) => !currentRevision || !revision(row.item.sourceRevision),
      ),
    };
  });

const changesFor = (rows: StudentQuestion[]): QuizAnalysisChanges => {
  const changes: QuizAnalysisChanges = {
    comparedQuestionCount: 0,
    wrongToCorrectCount: 0,
    correctToWrongCount: 0,
    unchangedCorrectCount: 0,
    unchangedWrongCount: 0,
    chronologyUnknownQuestionCount: 0,
    basis: "same_question_same_revision",
  };
  for (const row of rows) {
    if (row.currentRows.length < 2) continue;
    const times = row.currentRows.map((entry) => timestamp(entry.submittedAt));
    if (times.includes(null) || new Set(times).size !== times.length) {
      changes.chronologyUnknownQuestionCount += 1;
      continue;
    }
    const sorted = [...row.currentRows].sort(
      (a, b) => timestamp(a.submittedAt)! - timestamp(b.submittedAt)!,
    );
    const first = sorted[0].item.correct,
      last = sorted[sorted.length - 1].item.correct;
    if (typeof first !== "boolean" || typeof last !== "boolean") continue;
    changes.comparedQuestionCount += 1;
    if (!first && last) changes.wrongToCorrectCount += 1;
    else if (first && !last) changes.correctToWrongCount += 1;
    else if (last) changes.unchangedCorrectCount += 1;
    else changes.unchangedWrongCount += 1;
  }
  return changes;
};

const conceptsFor = (rows: StudentQuestion[]): QuizAnalysisConcept[] => {
  const concepts = new Map<string, QuizAnalysisConcept>();
  for (const row of rows) {
    const item = row.latest?.item;
    if (!item || typeof item.correct !== "boolean") continue;
    for (const concept of uniqueText(item.concepts)) {
      const group = concepts.get(concept) || {
        concept,
        correctQuestionIds: [],
        wrongQuestionIds: [],
        reviewLessonIds: [],
      };
      (item.correct ? group.correctQuestionIds : group.wrongQuestionIds).push(
        text(row.question.id),
      );
      if (text(item.reviewLessonId))
        group.reviewLessonIds = uniqueText([
          ...group.reviewLessonIds,
          item.reviewLessonId,
        ]);
      concepts.set(concept, group);
    }
  }
  return [...concepts.values()]
    .filter((row) => row.wrongQuestionIds.length > 0)
    .sort(
      (a, b) =>
        b.wrongQuestionIds.length - a.wrongQuestionIds.length ||
        a.concept.localeCompare(b.concept),
    );
};

/**
 * Conservative review conditions, not an estimate of a student's intent.
 * Use ONE latest actual submission, never a synthetic mixture of attempts.
 * Unknown timing/answers/revisions cannot count as an observed normal response.
 */
export const classifyQuizResponseBehavior = (
  record: QuizAnalysisRecord | null,
  questions: readonly QuizAnalysisQuestion[],
  state: "submitted" | "no_attempt" | "chronology_unknown" = "submitted",
): QuizResponseBehavior => {
  const result: QuizResponseBehavior = {
    category: state === "no_attempt" ? "no_attempt" : "insufficient",
    eligibleQuestionCount: 0,
    observedQuestionCount: 0,
    coveragePercent: null,
    medianActiveMs: null,
    fastQuestionCount: 0,
    fastCorrectCount: 0,
    fastWrongCount: 0,
    fastAccuracy: null,
    answerChangeCount: null,
    revisitCount: null,
    repeatedChoice: null,
    flags: { rapid: false, repeated: false },
    reason:
      state === "no_attempt" ? null : "분류에 필요한 풀이 기록이 부족합니다.",
  };
  if (state === "chronology_unknown") {
    result.reason = "최근 제출 순서를 확인할 수 없습니다.";
    return result;
  }
  if (!record || state === "no_attempt") return result;
  if (
    record.source !== "canonical" ||
    record.behaviorAnswersAvailable === false
  ) {
    result.reason = "출제 당시 답안과 문항 버전을 확인할 수 없습니다.";
    return result;
  }
  const bank = new Map(
    questions.map((question) => [text(question.id), question]),
  );
  const entries = record.items.flatMap((item) => {
    const question = bank.get(text(item.questionId));
    return question && (question.type === "choice" || question.type === "ox")
      ? [{ item, question }]
      : [];
  });
  result.eligibleQuestionCount = entries.length;
  if (
    new Set(entries.map(({ item }) => text(item.questionId))).size !==
    entries.length
  ) {
    result.reason = "중복된 문항 기록이 있어 풀이 양상을 분류하지 않았습니다.";
    return result;
  }
  const object = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const analytics = object(record.analytics);
  const observations =
    analytics?.version === 1 && analytics.quality === "complete"
      ? object(analytics.questions)
      : null;
  const count = (value: unknown, max: number) =>
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= max;
  const times: number[] = [];
  let mappedCount = 0,
    changes = 0,
    revisits = 0;
  // Choice positions and O/X have different meanings and must not be pooled.
  const groups = new Map<
    string,
    { total: number; counts: Map<string, number> }
  >();
  for (const { item, question } of entries) {
    const group = groups.get(question.type!) || {
      total: 0,
      counts: new Map<string, number>(),
    };
    group.total += 1;
    groups.set(question.type!, group);
    const currentRevision =
      revision(question.sourceRevision) || revision(question.contentRevision);
    if (
      !currentRevision ||
      revision(item.sourceRevision) !== currentRevision ||
      typeof item.answer !== "string"
    )
      continue;
    let label: string | null = null;
    if (question.type === "ox") {
      if (item.answer === "O" || item.answer === "X") label = item.answer;
    } else if (
      Array.isArray(question.options) &&
      question.options.length >= 2
    ) {
      const matches = question.options.flatMap((option, index) =>
        typeof option === "string" && option.trim() && option === item.answer
          ? [index]
          : [],
      );
      if (matches.length === 1) label = `${matches[0] + 1}번 보기`;
    }
    if (!label) continue;
    mappedCount += 1;
    group.counts.set(label, (group.counts.get(label) || 0) + 1);
    const observation = object(observations?.[text(item.questionId)]);
    if (!observation || observation.quality !== "complete") continue;
    const {
      activeMs,
      hiddenMs,
      firstResponseMs,
      finalResponseMs,
      answerChangeCount,
      revisitCount,
      hintViewed,
    } = observation;
    if (
      !count(activeMs, 21_600_000) ||
      !count(hiddenMs, 21_600_000) ||
      !count(firstResponseMs, activeMs as number) ||
      !count(finalResponseMs, activeMs as number) ||
      (firstResponseMs as number) > (finalResponseMs as number) ||
      !count(answerChangeCount, 10_000) ||
      !count(revisitCount, 10_000) ||
      (hintViewed !== undefined && typeof hintViewed !== "boolean")
    )
      continue;
    times.push(activeMs as number);
    changes += answerChangeCount as number;
    revisits += revisitCount as number;
    if (
      (activeMs as number) <= 3_000 &&
      hiddenMs === 0 &&
      answerChangeCount === 0 &&
      revisitCount === 0 &&
      hintViewed !== true
    ) {
      result.fastQuestionCount += 1;
      if (item.correct === true) result.fastCorrectCount += 1;
      if (item.correct === false) result.fastWrongCount += 1;
    }
  }
  for (const group of groups.values()) {
    for (const [label, frequency] of group.counts) {
      if (group.total < 5) continue;
      const repeated = {
        label,
        count: frequency,
        total: group.total,
        percent: (100 * frequency) / group.total,
      };
      if (
        !result.repeatedChoice ||
        repeated.percent > result.repeatedChoice.percent ||
        (repeated.percent === result.repeatedChoice.percent &&
          frequency > result.repeatedChoice.count)
      )
        result.repeatedChoice = repeated;
      if (frequency >= 5 && frequency / group.total >= 0.8)
        result.flags.repeated = true;
    }
  }
  result.observedQuestionCount = times.length;
  result.coveragePercent = entries.length
    ? (100 * times.length) / entries.length
    : null;
  if (times.length) {
    times.sort((a, b) => a - b);
    const middle = Math.floor(times.length / 2);
    result.medianActiveMs =
      times.length % 2
        ? times[middle]
        : (times[middle - 1] + times[middle]) / 2;
    result.answerChangeCount = changes;
    result.revisitCount = revisits;
  }
  const knownFast = result.fastCorrectCount + result.fastWrongCount;
  result.fastAccuracy = knownFast
    ? (100 * result.fastCorrectCount) / knownFast
    : null;
  const sufficient =
    entries.length >= 5 &&
    times.length >= 5 &&
    times.length / entries.length >= 0.8 &&
    mappedCount / entries.length >= 0.8;
  result.flags.rapid =
    sufficient &&
    result.fastQuestionCount >= 5 &&
    result.fastQuestionCount / entries.length >= 0.6;
  if (
    result.flags.rapid &&
    (result.flags.repeated ||
      (result.fastWrongCount >= 3 && result.fastWrongCount / knownFast >= 0.5))
  ) {
    result.category = "suspected_guessing";
    result.reason =
      "빠른 응답이 반복되고 오답 또는 같은 보기 선택이 함께 나타났습니다. 학생과 풀이 과정을 확인해 주세요.";
  } else if (result.flags.repeated) {
    result.category = "repeated_choice";
    result.reason =
      "같은 유형에서 한 보기를 반복 선택했습니다. 답안 분포만으로 의도를 판단할 수는 없습니다.";
  } else if (sufficient) {
    result.category = "unflagged";
    result.reason =
      "확인 가능한 기록에서 설정한 분류 조건에 해당하지 않습니다.";
  } else {
    result.reason =
      entries.length < 5
        ? "현재 조회 범위의 선택형 문항이 5개 미만입니다."
        : "문항 버전·답안 또는 온전한 시간 기록이 부족합니다. 재접속 등으로 일부만 기록된 시간은 분류에서 제외합니다.";
  }
  return result;
};

/**
 * Callers must load authorized current-semester records and the current roster.
 * The model rechecks both boundaries; it performs no fetching or writes.
 * Unit-partial records may inform item analysis, but never masquerade as a
 * recorded score for a smaller assessment. Results describe the loaded sample.
 */
export const buildQuizAnalysis = (input: {
  semesterId: string;
  scope?: QuizAnalysisScope;
  students: readonly QuizAnalysisStudent[];
  questions: readonly QuizAnalysisQuestion[];
  records: readonly QuizAnalysisRecord[];
  /** Class filtering and the named student table require an available roster. */
  rosterAvailable?: boolean;
}): QuizAnalysisSummary => {
  const scope = input.scope || {};
  const semesterId = text(input.semesterId);
  const rosterAvailable = input.rosterAvailable !== false;
  const visibleRoster = rosterAvailable ? input.students : [];
  const visibleStudentIds = new Set(
    visibleRoster.map((student) => text(student.uid)),
  );
  const roster: readonly QuizAnalysisStudent[] = scope.classId
    ? visibleRoster
    : [
        ...input.records
          .filter((record) => text(record.semesterId) === semesterId)
          .map((record) => ({ uid: text(record.studentUid) })),
        ...visibleRoster,
      ];
  const students = [
    ...new Map(
      roster
        .filter(
          (student) =>
            text(student.uid) &&
            (!scope.classId ||
              text((student as QuizAnalysisStudent).classId) === scope.classId),
        )
        .map((student) => [text(student.uid), student]),
    ).values(),
  ];
  const studentIds = new Set(students.map((student) => text(student.uid)));
  const questions = [
    ...new Map(
      input.questions
        .filter(
          (question) => text(question.id) && questionInScope(question, scope),
        )
        .map((question) => [text(question.id), question]),
    ).values(),
  ];
  const questionIds = new Set(questions.map((question) => text(question.id)));
  const candidates = input.records.filter(
    (record) =>
      semesterId &&
      text(record.id) &&
      text(record.semesterId) === semesterId &&
      studentIds.has(text(record.studentUid)) &&
      (record.source === "canonical" || record.source === "legacy") &&
      Array.isArray(record.items),
  );
  // Deduplicate before filtering by assessment metadata so a stale mirror cannot
  // make a canonical record appear in a scope it does not belong to.
  const unique = deduplicateQuizAnalysisRecords(candidates);
  const records = unique.filter(
    (record) =>
      (!scope.questionIds ||
        record.items.some((item) => questionIds.has(text(item.questionId)))) &&
      (!scope.category || text(record.category) === scope.category) &&
      (!scope.examRound || text(record.examRound) === scope.examRound) &&
      (!scope.unitIds ||
        scope.unitIds.includes(text(record.unitId)) ||
        record.items.some((item) => questionIds.has(text(item.questionId)))),
  );
  const byStudent = new Map<string, StudentQuestion[]>();
  const studentRows: QuizAnalysisStudentRow[] = students.map((student) => {
    const studentRecords = records.filter(
      (record) => text(record.studentUid) === text(student.uid),
    );
    const rows = buildStudentQuestions(studentRecords, questions);
    byStudent.set(text(student.uid), rows);
    const selected = latest(studentRecords);
    const entireScope =
      !scope.unitIds ||
      (!!selected.value && scope.unitIds.includes(text(selected.value.unitId)));
    const items = rows.flatMap((row) => (row.latest ? [row.latest.item] : []));
    const correctCount = items.filter((item) => item.correct === true).length;
    const wrongCount = items.filter((item) => item.correct === false).length;
    const itemScore = scope.scoreBasis === "latest_current_revision_items";
    const latestScore = itemScore
      ? correctCount + wrongCount > 0
        ? (100 * correctCount) / (correctCount + wrongCount)
        : null
      : entireScope
        ? score(selected.value?.scorePercent)
        : null;
    return {
      ...student,
      uid: text(student.uid),
      attemptCount: studentRecords.length,
      latestRecord: selected.value,
      latestScore,
      scoreUnavailableReason: !studentRecords.length
        ? "no_attempt"
        : itemScore && latestScore !== null
          ? null
          : selected.chronologyUnknown
            ? "chronology_unknown"
            : !entireScope
              ? "partial_scope"
              : latestScore === null
                ? "missing_score"
                : null,
      correctCount,
      wrongCount,
      unknownCount:
        items.filter((item) => typeof item.correct !== "boolean").length +
        rows.filter((row) => row.chronologyUnknown).length,
      assessedQuestionCount: correctCount + wrongCount,
      currentQuestionCount: items.length,
      revisionExcludedCount: rows.filter((row) => row.revisionExcluded).length,
      revisionUnknownCount: rows.filter((row) => row.revisionUnknown).length,
      missingConceptQuestionCount: items.filter(
        (item) =>
          typeof item.correct === "boolean" &&
          !uniqueText(item.concepts).length,
      ).length,
      assessedConcepts: uniqueText(
        items
          .filter((item) => typeof item.correct === "boolean")
          .flatMap((item) => item.concepts || []),
      ),
      wrongConcepts: conceptsFor(rows),
      changes: changesFor(rows),
      behavior: classifyQuizResponseBehavior(
        selected.value,
        questions,
        !studentRecords.length
          ? "no_attempt"
          : selected.chronologyUnknown
            ? "chronology_unknown"
            : "submitted",
      ),
    };
  });
  const questionRows: QuizAnalysisQuestionRow[] = questions.map(
    (question, index) => {
      const rows = [...byStudent.values()].map((entries) => entries[index]);
      const items = rows.flatMap((row) =>
        row.latest ? [row.latest.item] : [],
      );
      const correctCount = items.filter((item) => item.correct === true).length;
      const wrongCount = items.filter((item) => item.correct === false).length;
      const answers = items.filter(
        (item) => typeof item.answer === "string" && item.answer.trim() !== "",
      );
      const counts = new Map(
        [
          ...new Set(
            (question.options || []).filter(
              (answer) => typeof answer === "string" && answer.trim(),
            ),
          ),
        ].map((answer) => [answer, 0]),
      );
      for (const item of answers)
        counts.set(item.answer!, (counts.get(item.answer!) || 0) + 1);
      return {
        id: text(question.id),
        attemptedStudentCount: rows.filter((row) => row.rows.length > 0).length,
        distinctStudents: items.length,
        assessedStudentCount: correctCount + wrongCount,
        correctCount,
        wrongCount,
        unknownCorrectnessCount: items.filter(
          (item) => typeof item.correct !== "boolean",
        ).length,
        correctRate:
          correctCount + wrongCount
            ? (100 * correctCount) / (correctCount + wrongCount)
            : null,
        knownAnswerStudentCount: answers.length,
        unansweredCount: items.filter(
          (item) =>
            typeof item.answer === "string" && item.answer.trim() === "",
        ).length,
        missingAnswerCount: items.filter(
          (item) => !has(item, "answer") || typeof item.answer !== "string",
        ).length,
        optionDistribution: [...counts].map(([answer, count]) => ({
          answer,
          count,
          percent: answers.length ? (100 * count) / answers.length : 0,
          listedOption: (question.options || []).includes(answer),
        })),
        revisionExcludedCount: rows.filter((row) => row.revisionExcluded)
          .length,
        revisionUnknownCount: rows.filter((row) => row.revisionUnknown).length,
        chronologyUnknownCount: rows.filter((row) => row.chronologyUnknown)
          .length,
      };
    },
  );
  const scores = studentRows
    .map((student) => student.latestScore)
    .filter((value): value is number => value !== null);
  const scoreHistogram = [
    { label: "0–20점 미만", lower: 0, upper: 20, count: 0 },
    { label: "20–40점 미만", lower: 20, upper: 40, count: 0 },
    { label: "40–60점 미만", lower: 40, upper: 60, count: 0 },
    { label: "60–80점 미만", lower: 60, upper: 80, count: 0 },
    { label: "80–100점", lower: 80, upper: 101, count: 0 },
  ];
  for (const value of scores)
    scoreHistogram.find(
      (band) => value >= band.lower && value < band.upper,
    )!.count += 1;
  return {
    students: studentRows.filter((student) =>
      visibleStudentIds.has(student.uid),
    ),
    questions: questionRows,
    scoreHistogram,
    averageScore: scores.length
      ? scores.reduce((sum, value) => sum + value, 0) / scores.length
      : null,
    scoredStudentCount: scores.length,
    missingScoreStudentCount: studentRows.filter(
      (student) => student.attemptCount > 0 && student.latestScore === null,
    ).length,
    participantCount: studentRows.filter((student) => student.attemptCount > 0)
      .length,
    unlistedParticipantCount: studentRows.filter(
      (student) =>
        student.attemptCount > 0 && !visibleStudentIds.has(student.uid),
    ).length,
    recordCount: records.length,
    duplicateRecordCount: candidates.length - unique.length,
    excludedRecordCount:
      input.records.length - candidates.length + unique.length - records.length,
    scoreBasis: scope.scoreBasis || "latest_recorded_attempt",
    rosterAvailable,
  };
};

/**
 * Equal-weight dichotomous item analysis of the loaded, authorized sample.
 * A student's first recorded submission is chosen BEFORE validating its items;
 * a later successful/revised submission must never replace an excluded first.
 * Call with the whole assessment bank; a display-only subunit filter must not
 * alter the rest score or split a test form. Different forms are never pooled.
 */
export const buildQuizItemStatistics = (input: {
  semesterId: string;
  scope?: QuizAnalysisScope;
  students: readonly QuizAnalysisStudent[];
  questions: readonly QuizAnalysisQuestion[];
  records: readonly QuizAnalysisRecord[];
  rosterAvailable?: boolean;
}): QuizItemStatisticsSummary => {
  const scope = input.scope || {};
  const questionMap = new Map(
    input.questions
      .filter(
        (question) => text(question.id) && questionInScope(question, scope),
      )
      .map((question) => [text(question.id), question]),
  );
  const studentIds = new Set(
    (input.rosterAvailable === false ? [] : input.students)
      .filter(
        (student) => !scope.classId || text(student.classId) === scope.classId,
      )
      .map((student) => text(student.uid)),
  );
  const records = deduplicateQuizAnalysisRecords(
    input.records.filter(
      (record) =>
        text(input.semesterId) &&
        text(record.id) &&
        text(record.studentUid) &&
        text(record.semesterId) === text(input.semesterId) &&
        (!scope.classId || studentIds.has(text(record.studentUid))) &&
        (record.source === "canonical" || record.source === "legacy") &&
        Array.isArray(record.items),
    ),
  ).filter(
    (record) =>
      (!scope.category || text(record.category) === scope.category) &&
      (!scope.examRound || text(record.examRound) === scope.examRound) &&
      (!scope.unitIds || scope.unitIds.includes(text(record.unitId))),
  );
  const assessmentKey = (record: QuizAnalysisRecord) =>
    JSON.stringify([
      text(record.unitId),
      text(record.category),
      text(record.examRound),
    ]);
  const byStudentAssessment = new Map<string, QuizAnalysisRecord[]>();
  for (const record of records) {
    const key = JSON.stringify([
      text(record.studentUid),
      assessmentKey(record),
    ]);
    const entries = byStudentAssessment.get(key) || [];
    entries.push(record);
    byStudentAssessment.set(key, entries);
  }
  const summary: QuizItemStatisticsSummary = {
    basis: "first_recorded_submission_same_form",
    questions: [],
    firstSubmissionCount: byStudentAssessment.size,
    eligibleSubmissionCount: 0,
    excludedChronologyCount: 0,
    excludedIncompleteCount: 0,
    excludedRevisionCount: 0,
  };
  const forms = new Map<string, QuizAnalysisRecord[]>();
  for (const entries of byStudentAssessment.values()) {
    const times = entries.map((record) => timestamp(record.submittedAt));
    const firstTime = Math.min(
      ...times.filter((value): value is number => value !== null),
    );
    const firstRows = entries.filter((_, index) => times[index] === firstTime);
    if (times.includes(null) || firstRows.length !== 1) {
      summary.excludedChronologyCount += 1;
      continue;
    }
    const first = firstRows[0];
    const ids = first.items.map((item) => text(item.questionId));
    if (
      !Number.isSafeInteger(first.totalCount) ||
      first.totalCount !== first.items.length ||
      first.items.length === 0 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !id) ||
      first.items.some((item) => typeof item.correct !== "boolean")
    ) {
      summary.excludedIncompleteCount += 1;
      continue;
    }
    if (
      first.items.some((item) => {
        const current = questionMap.get(text(item.questionId));
        const currentRevision =
          current &&
          (revision(current.sourceRevision) ||
            revision(current.contentRevision));
        return (
          !currentRevision || revision(item.sourceRevision) !== currentRevision
        );
      })
    ) {
      summary.excludedRevisionCount += 1;
      continue;
    }
    const signature = first.items
      .map((item) => [text(item.questionId), revision(item.sourceRevision)])
      .sort(([left], [right]) => left.localeCompare(right));
    const formKey = JSON.stringify([assessmentKey(first), signature]);
    const cohort = forms.get(formKey) || [];
    cohort.push(first);
    forms.set(formKey, cohort);
    summary.eligibleSubmissionCount += 1;
  }
  const squaredDeviation = (values: number[]) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  };
  const rows = new Map<string, QuizItemStatisticsRow>(
    [...questionMap.keys()].map((id) => [
      id,
      { id, formCount: 0, cohorts: [] },
    ]),
  );
  for (const [formKey, cohort] of [...forms].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const sampleSize = cohort.length;
    const itemCount = cohort[0].items.length;
    const maps = cohort.map(
      (record) =>
        new Map(record.items.map((item) => [text(item.questionId), item])),
    );
    const totals = cohort.map(
      (record) => record.items.filter((item) => item.correct).length,
    );
    const totalDeviation = squaredDeviation(totals);
    const alphaUnavailableReason =
      sampleSize < 3
        ? "insufficient_students"
        : itemCount < 2
          ? "single_item"
          : totalDeviation === 0
            ? "constant_total_score"
            : null;
    // Same denominator for all variances cancels; this is Cronbach alpha/KR-20
    // for complete, equally weighted 0/1 items. Do not clamp negative reliability.
    const itemDeviationSum = cohort[0].items.reduce(
      (sum, item) =>
        sum +
        squaredDeviation(
          maps.map((map) => Number(map.get(text(item.questionId))!.correct)),
        ),
      0,
    );
    const alphaReliability = alphaUnavailableReason
      ? null
      : (itemCount / (itemCount - 1)) * (1 - itemDeviationSum / totalDeviation);
    for (const sourceItem of cohort[0].items) {
      const id = text(sourceItem.questionId);
      const question = questionMap.get(id)!;
      const items = maps.map((map) => map.get(id)!);
      const values = items.map((item) => Number(item.correct));
      const rest = totals.map((total, index) => total - values[index]);
      const itemDeviation = squaredDeviation(values);
      const restDeviation = squaredDeviation(rest);
      const correlationUnavailableReason =
        sampleSize < 3
          ? "insufficient_students"
          : itemCount < 2
            ? "single_item"
            : itemDeviation === 0
              ? "constant_item"
              : restDeviation === 0
                ? "constant_rest_score"
                : null;
      const meanX = values.reduce((sum, value) => sum + value, 0) / sampleSize;
      const meanY = rest.reduce((sum, value) => sum + value, 0) / sampleSize;
      const covariance = values.reduce(
        (sum, value, index) => sum + (value - meanX) * (rest[index] - meanY),
        0,
      );
      const correlation = correlationUnavailableReason
        ? null
        : Math.max(
            -1,
            Math.min(1, covariance / Math.sqrt(itemDeviation * restDeviation)),
          );
      const answers = new Map<string, number[]>(
        [
          ...new Set(
            (question.options || []).filter(
              (answer) => typeof answer === "string" && answer.trim(),
            ),
          ),
        ].map((answer) => [answer, []]),
      );
      let unansweredCount = 0;
      let missingAnswerCount = 0;
      items.forEach((item, index) => {
        if (typeof item.answer !== "string") {
          missingAnswerCount += 1;
        } else if (!item.answer.trim()) {
          unansweredCount += 1;
        } else {
          const restScores = answers.get(item.answer) || [];
          restScores.push(rest[index]);
          answers.set(item.answer, restScores);
        }
      });
      const row = rows.get(id)!;
      row.cohorts.push({
        formKey,
        itemCount,
        sampleSize,
        smallSample: sampleSize < 20,
        correctCount: values.reduce((sum, value) => sum + value, 0),
        difficultyPercent: meanX * 100,
        correctedItemTotalCorrelation: correlation,
        correlationUnavailableReason,
        alphaReliability,
        alphaUnavailableReason,
        options: [...answers].map(([answer, restScores]) => ({
          answer,
          count: restScores.length,
          percent: (100 * restScores.length) / sampleSize,
          meanRestPercent:
            restScores.length && itemCount > 1
              ? (100 * restScores.reduce((sum, value) => sum + value, 0)) /
                (restScores.length * (itemCount - 1))
              : null,
          listedOption: (question.options || []).includes(answer),
        })),
        unansweredCount,
        missingAnswerCount,
      });
      row.formCount = row.cohorts.length;
    }
  }
  summary.questions = [...rows.values()];
  return summary;
};
