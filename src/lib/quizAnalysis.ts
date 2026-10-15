/** Read-only, descriptive quiz analysis. No timing or ability inference. */
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
}

export interface QuizAnalysisScope {
  /** Selected unit and its descendants. An empty array selects no units. */
  unitIds?: string[];
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
  wrongConcepts: QuizAnalysisConcept[];
  changes: QuizAnalysisChanges;
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
  scoreBasis: "latest_recorded_attempt";
  rosterAvailable: boolean;
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
    const latestScore = entireScope
      ? score(selected.value?.scorePercent)
      : null;
    const items = rows.flatMap((row) => (row.latest ? [row.latest.item] : []));
    const correctCount = items.filter((item) => item.correct === true).length;
    const wrongCount = items.filter((item) => item.correct === false).length;
    return {
      ...student,
      uid: text(student.uid),
      attemptCount: studentRecords.length,
      latestRecord: selected.value,
      latestScore,
      scoreUnavailableReason: !studentRecords.length
        ? "no_attempt"
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
      wrongConcepts: conceptsFor(rows),
      changes: changesFor(rows),
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
    scoreBasis: "latest_recorded_attempt",
    rosterAvailable,
  };
};
