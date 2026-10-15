export interface MyAssessmentDetail extends Record<string, unknown> {
  id?: string | number;
  correct?: boolean;
  u?: string;
  displayU?: string;
}

export interface MyAssessmentRecord extends Record<string, unknown> {
  id: string;
  unitId?: string;
  category?: string;
  score: number | null;
  timestamp?: { seconds?: number };
  timeString?: string;
  recordedAtMs: number | null;
  details: MyAssessmentDetail[];
}

const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const has = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

export const recordedScore = (value: unknown): number | null => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  )
    return null;
  return value;
};

export const formatRecordedScore = (value: number | null | undefined) =>
  value === null || value === undefined ? "점수 없음" : `${value}점`;

const recordedTime = (row: Record<string, unknown>) => {
  const stamp = object(row.timestamp);
  if (typeof stamp.seconds === "number" && Number.isFinite(stamp.seconds))
    return stamp.seconds * 1000;
  const submitted = text(row.submittedAtIso);
  if (submitted && Number.isFinite(Date.parse(submitted)))
    return Date.parse(submitted);
  return null;
};

/** Caller reads the semester-scoped legacy collection and owner-scoped canonical collection. */
export const normalizeMyAssessmentRecords = (
  values: readonly unknown[],
  scope: { uid: string; semesterId: string },
): MyAssessmentRecord[] => {
  const candidates = values
    .map(object)
    .filter((row) => {
      const owner = text(row.studentUid) || text(row.uid);
      const semester = text(row.semesterId);
      const legacySemester =
        row.year && row.semester ? `${row.year}-${row.semester}` : "";
      return (
        !!scope.uid &&
        owner === scope.uid &&
        (!text(row.uid) || text(row.uid) === scope.uid) &&
        !!text(row.id) &&
        (!semester || semester === scope.semesterId) &&
        (!legacySemester || legacySemester === scope.semesterId) &&
        ![
          "cancelled",
          "in_progress",
          "STARTED",
          "IN_PROGRESS",
          "RECOVERABLE",
          "LOCKED",
        ].includes(text(row.status))
      );
    })
    .sort(
      (left, right) =>
        Number(!!right.studentUid && !!right.attemptId) -
        Number(!!left.studentUid && !!left.attemptId),
    );
  const parents = candidates.map((_, index) => index);
  const find = (index: number): number =>
    parents[index] === index ? index : (parents[index] = find(parents[index]));
  const owners = new Map<string, number>();
  candidates.forEach((row, index) => {
    const identifiers = [
      row.id,
      row.attemptId,
      row.canonicalAttemptId,
      row.submissionId,
      row.legacyResultId,
      row.resultId,
      text(row.resultRef).split("/").pop(),
      text(row.submissionRef).split("/").pop(),
    ]
      .map(text)
      .filter(Boolean);
    // Only explicit record references establish identity, never equal scores/dates.
    identifiers.forEach((id) => {
      const owner = owners.get(id);
      if (owner !== undefined) {
        const left = find(owner),
          right = find(index);
        parents[Math.max(left, right)] = Math.min(left, right);
      } else owners.set(id, index);
    });
  });
  const result: MyAssessmentRecord[] = [];
  candidates.forEach((row, index) => {
    if (find(index) !== index) return;
    result.push({
      ...row,
      id: text(row.id),
      unitId: text(row.unitId),
      category: text(row.category),
      score: recordedScore(row.score),
      timestamp: object(row.timestamp),
      timeString: text(row.timeString),
      recordedAtMs: recordedTime(row),
      details: Array.isArray(row.details)
        ? (row.details.map(object) as MyAssessmentDetail[])
        : [],
    });
  });
  return result.sort(
    (left, right) =>
      (right.recordedAtMs ?? -Infinity) - (left.recordedAtMs ?? -Infinity),
  );
};

export const savedReviewQuestion = (detail: MyAssessmentDetail) => {
  const snapshot = object(detail.questionSnapshot);
  const source = { ...detail, ...snapshot };
  const question =
    typeof source.q === "string"
      ? source.q
      : typeof source.question === "string"
        ? source.question
        : "";
  const answerAvailable =
    (has(source, "a") && source.a !== null && source.a !== undefined) ||
    (has(source, "answer") &&
      source.answer !== null &&
      source.answer !== undefined);
  const answer = has(source, "a") ? source.a : source.answer;
  const userAnswerAvailable =
    (has(detail, "displayU") && typeof detail.displayU === "string") ||
    (has(detail, "u") && typeof detail.u === "string");
  const saved: Record<string, unknown> & {
    question: string;
    answer: unknown;
    explanation: string;
    questionAvailable: boolean;
    answerAvailable: boolean;
    userAnswerAvailable: boolean;
    userAnswer: string;
    correctKnown: boolean;
  } = {
    ...source,
    question,
    answer,
    explanation:
      typeof source.exp === "string"
        ? source.exp
        : typeof source.explanation === "string"
          ? source.explanation
          : "",
    questionAvailable: !!question.trim(),
    answerAvailable,
    userAnswerAvailable,
    userAnswer:
      typeof detail.displayU === "string"
        ? detail.displayU
        : typeof detail.u === "string"
          ? detail.u
          : "",
    correctKnown: typeof detail.correct === "boolean",
  };
  return saved;
};

export const buildAssessmentScoreDistribution = (
  scores: readonly (number | null)[],
) => {
  const bands = [
    { label: "0–19점", lower: 0, upper: 20, count: 0 },
    { label: "20–39점", lower: 20, upper: 40, count: 0 },
    { label: "40–59점", lower: 40, upper: 60, count: 0 },
    { label: "60–79점", lower: 60, upper: 80, count: 0 },
    { label: "80–100점", lower: 80, upper: 101, count: 0 },
  ];
  scores.forEach((score) => {
    const value = recordedScore(score);
    if (value === null) return;
    const band = bands.find(
      (item) => value >= item.lower && value < item.upper,
    );
    if (band) band.count += 1;
  });
  return bands;
};
