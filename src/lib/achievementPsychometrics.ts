/**
 * Descriptive statistics for one complete, equally weighted binary test form.
 * The caller must select one assessment/version and each student's first submission.
 * This module does not infer attainment levels, causes of errors, or official grades.
 */
export type AchievementBinaryResponse = 0 | 1;

export interface AchievementPsychometricRow {
  studentId: string;
  /** Accepted for adapters, but deliberately not mixed with binary total scores. */
  score?: number;
  responses: readonly (AchievementBinaryResponse | null)[];
}

export type AchievementStatisticUnavailableReason =
  | "insufficient_students"
  | "insufficient_items"
  | "constant_total_score"
  | "constant_item"
  | "constant_rest_score"
  | "boundary_ties"
  | "invalid_alpha"
  | "extreme_score"
  | "zero_caution_denominator";

export type AchievementPsychometricNotice =
  | "descriptive_only"
  | "invalid_item_ids"
  | "incomplete_rows_excluded"
  | "invalid_rows_excluded"
  | "duplicate_students_excluded"
  | "insufficient_students"
  | "small_sample"
  | "short_test"
  | "constant_total_score"
  | "negative_alpha"
  | "alpha_out_of_range"
  | "upper_lower_boundary_ties";

export interface AchievementPsychometricItem {
  id: string;
  sampleSize: number;
  correctCount: number;
  correctRate: number | null;
  /** Pearson correlation of the binary item with the sum of all OTHER items. */
  discrimination: number | null;
  discriminationUnavailableReason: AchievementStatisticUnavailableReason | null;
  /** Upper-group proportion correct minus lower-group proportion correct. */
  upperLower27: number | null;
  /** Actual size of each group, zero when a boundary tie prevents selection. */
  upperLowerCount: number;
  upperCorrectCount: number | null;
  lowerCorrectCount: number | null;
  upperLowerUnavailableReason: AchievementStatisticUnavailableReason | null;
  alphaIfDeleted: number | null;
  alphaIfDeletedUnavailableReason: AchievementStatisticUnavailableReason | null;
}

export interface AchievementSPRow {
  studentId: string;
  correctCount: number;
  percentCorrect: number;
  /** Columns follow spItemOrder, not the original question order. */
  responses: AchievementBinaryResponse[];
  /** Boundary after this many cells in the S-P row. */
  sCurve: number;
  /** Sato CS, unbounded above. It is not a probability or a diagnosis. */
  cautionIndex: number | null;
  cautionUnavailableReason: AchievementStatisticUnavailableReason | null;
}

export interface AchievementPsychometrics {
  scoreScale: "correct_item_count";
  varianceConvention: "sample_n_minus_one";
  inputRowCount: number;
  sampleSize: number;
  itemCount: number;
  maximumScore: number;
  excludedRows: {
    incomplete: number;
    invalid: number;
    duplicateStudent: number;
  };
  mean: number | null;
  standardDeviation: number | null;
  meanPercent: number | null;
  standardDeviationPercent: number | null;
  scoreHistogram: Array<{ score: number; count: number }>;
  alpha: number | null;
  alphaUnavailableReason: AchievementStatisticUnavailableReason | null;
  sem: number | null;
  semPercent: number | null;
  semUnavailableReason: AchievementStatisticUnavailableReason | null;
  items: AchievementPsychometricItem[];
  spRows: AchievementSPRow[];
  spItemOrder: string[];
  /** P-curve boundary: count from the top in each sorted item column. */
  spItemTotals: number[];
  upperLower: {
    fraction: 0.27;
    targetCount: number;
    actualCount: number;
    tiePolicy: "unavailable_at_boundary_ties";
    unavailableReason: AchievementStatisticUnavailableReason | null;
  };
  /** Product display policy shared with existing quizAnalysis: n < 20. */
  smallSample: boolean;
  notices: AchievementPsychometricNotice[];
}

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);

const deviationSum = (values: readonly number[]): number => {
  if (!values.length) return 0;
  const average = sum(values) / values.length;
  return values.reduce((total, value) => total + (value - average) ** 2, 0);
};

const compareIds = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

/** Same sum-of-deviations formula and n >= 3 policy as quizAnalysis.ts. */
const alphaFor = (
  sampleSize: number,
  itemCount: number,
  itemDeviationSum: number,
  totalDeviation: number,
): {
  value: number | null;
  reason: AchievementStatisticUnavailableReason | null;
} => {
  const reason =
    sampleSize < 3
      ? "insufficient_students"
      : itemCount < 2
        ? "insufficient_items"
        : totalDeviation <= 0
          ? "constant_total_score"
          : null;
  if (reason) return { value: null, reason };
  const value =
    (itemCount / (itemCount - 1)) *
    (1 - Math.max(0, itemDeviationSum) / totalDeviation);
  // Correct only floating-point spill above one; preserve negative alpha.
  return { value: value > 1 && value < 1 + 1e-12 ? 1 : value, reason: null };
};

export const analyzeAchievementPsychometrics = (input: {
  rows: readonly AchievementPsychometricRow[];
  itemIds: readonly string[];
}): AchievementPsychometrics => {
  const notices: AchievementPsychometricNotice[] = ["descriptive_only"];
  const rawIds = input.itemIds.map((id) =>
    typeof id === "string" ? id.trim() : "",
  );
  const validItems =
    rawIds.length > 0 &&
    rawIds.every(Boolean) &&
    new Set(rawIds).size === rawIds.length;
  const itemIds = validItems ? rawIds : [];
  const itemCount = itemIds.length;
  if (!validItems) notices.push("invalid_item_ids");

  const excludedRows = { incomplete: 0, invalid: 0, duplicateStudent: 0 };
  const idCounts = new Map<string, number>();
  input.rows.forEach((row) => {
    const id = String(row.studentId || "").trim();
    idCounts.set(id, (idCounts.get(id) || 0) + 1);
  });
  const rows: Array<{
    studentId: string;
    responses: AchievementBinaryResponse[];
    score: number;
  }> = [];
  for (const row of input.rows) {
    const studentId = String(row.studentId || "").trim();
    if (
      !validItems ||
      !studentId ||
      !Array.isArray(row.responses) ||
      row.responses.length !== itemCount ||
      Array.from(row.responses).some(
        (value) => value !== null && value !== 0 && value !== 1,
      )
    ) {
      excludedRows.invalid += 1;
    } else if ((idCounts.get(studentId) || 0) > 1) {
      // The engine cannot select a first submission without chronology.
      excludedRows.duplicateStudent += 1;
    } else if (row.responses.includes(null)) {
      // Unknown is not an incorrect answer. Use a common complete-case cohort.
      excludedRows.incomplete += 1;
    } else {
      const responses = [...row.responses] as AchievementBinaryResponse[];
      rows.push({ studentId, responses, score: sum(responses) });
    }
  }
  rows.sort((left, right) => compareIds(left.studentId, right.studentId));
  if (excludedRows.invalid) notices.push("invalid_rows_excluded");
  if (excludedRows.incomplete) notices.push("incomplete_rows_excluded");
  if (excludedRows.duplicateStudent)
    notices.push("duplicate_students_excluded");

  const sampleSize = rows.length;
  const totals = rows.map((row) => row.score);
  const mean = sampleSize ? sum(totals) / sampleSize : null;
  const totalDeviation = deviationSum(totals);
  const standardDeviation =
    sampleSize >= 2 ? Math.sqrt(totalDeviation / (sampleSize - 1)) : null;
  const columns = itemIds.map((_, index) =>
    rows.map((row) => row.responses[index]),
  );
  const columnTotals = columns.map(sum);
  const itemDeviations = columns.map(deviationSum);
  const itemDeviationSum = sum(itemDeviations);
  const reliability = alphaFor(
    sampleSize,
    itemCount,
    itemDeviationSum,
    totalDeviation,
  );
  const alpha = reliability.value;
  const semUnavailableReason =
    reliability.reason ||
    (alpha === null || alpha < 0 || alpha > 1 ? "invalid_alpha" : null);
  const sem =
    semUnavailableReason || standardDeviation === null || alpha === null
      ? null
      : standardDeviation * Math.sqrt(1 - alpha);

  if (sampleSize < 3) notices.push("insufficient_students");
  if (sampleSize < 20) notices.push("small_sample");
  if (itemCount < 3) notices.push("short_test");
  if (sampleSize >= 2 && totalDeviation === 0)
    notices.push("constant_total_score");
  if (alpha !== null && alpha < 0) notices.push("negative_alpha");
  if (alpha !== null && alpha > 1) notices.push("alpha_out_of_range");

  const rankedRows = [...rows].sort(
    (left, right) =>
      right.score - left.score || compareIds(left.studentId, right.studentId),
  );
  const targetCount = Math.floor(sampleSize * 0.27);
  const boundaryTied =
    targetCount > 0 &&
    (rankedRows[targetCount - 1].score === rankedRows[targetCount].score ||
      rankedRows[sampleSize - targetCount - 1].score ===
        rankedRows[sampleSize - targetCount].score);
  const upperLowerUnavailableReason: AchievementStatisticUnavailableReason | null =
    targetCount < 1
      ? "insufficient_students"
      : boundaryTied
        ? "boundary_ties"
        : null;
  const actualCount = upperLowerUnavailableReason ? 0 : targetCount;
  const upperRows = actualCount ? rankedRows.slice(0, actualCount) : [];
  const lowerRows = actualCount ? rankedRows.slice(-actualCount) : [];
  if (boundaryTied) notices.push("upper_lower_boundary_ties");

  const items = itemIds.map((id, itemIndex): AchievementPsychometricItem => {
    const values = columns[itemIndex];
    const rest = totals.map((total, index) => total - values[index]);
    const restDeviation = deviationSum(rest);
    const itemDeviation = itemDeviations[itemIndex];
    const discriminationUnavailableReason =
      sampleSize < 3
        ? "insufficient_students"
        : itemCount < 2
          ? "insufficient_items"
          : itemDeviation === 0
            ? "constant_item"
            : restDeviation === 0
              ? "constant_rest_score"
              : null;
    let discrimination: number | null = null;
    if (!discriminationUnavailableReason) {
      const itemMean = columnTotals[itemIndex] / sampleSize;
      const restMean = sum(rest) / sampleSize;
      const covariance = values.reduce<number>(
        (total, value, index) =>
          total + (value - itemMean) * (rest[index] - restMean),
        0,
      );
      discrimination = Math.max(
        -1,
        Math.min(1, covariance / Math.sqrt(itemDeviation * restDeviation)),
      );
    }
    const deleted = alphaFor(
      sampleSize,
      itemCount - 1,
      itemDeviationSum - itemDeviation,
      restDeviation,
    );
    const upperCorrectCount = actualCount
      ? sum(upperRows.map((row) => row.responses[itemIndex]))
      : null;
    const lowerCorrectCount = actualCount
      ? sum(lowerRows.map((row) => row.responses[itemIndex]))
      : null;
    return {
      id,
      sampleSize,
      correctCount: columnTotals[itemIndex],
      correctRate: sampleSize
        ? (columnTotals[itemIndex] / sampleSize) * 100
        : null,
      discrimination,
      discriminationUnavailableReason,
      upperLower27:
        upperCorrectCount === null || lowerCorrectCount === null
          ? null
          : (upperCorrectCount - lowerCorrectCount) / actualCount,
      upperLowerCount: actualCount,
      upperCorrectCount,
      lowerCorrectCount,
      upperLowerUnavailableReason,
      alphaIfDeleted: deleted.value,
      alphaIfDeletedUnavailableReason: deleted.reason,
    };
  });

  const orderedColumns = itemIds
    .map((id, index) => ({ id, index, total: columnTotals[index] }))
    .sort(
      (left, right) =>
        right.total - left.total || compareIds(left.id, right.id),
    );
  const meanColumnTotal = itemCount ? sum(columnTotals) / itemCount : 0;
  const spRows = rankedRows.map((row): AchievementSPRow => {
    const responses = orderedColumns.map(
      (column) => row.responses[column.index],
    );
    const idealWeighted = sum(
      orderedColumns.slice(0, row.score).map((column) => column.total),
    );
    const observedWeighted = orderedColumns.reduce(
      (total, column, index) => total + responses[index] * column.total,
      0,
    );
    const denominator = idealWeighted - row.score * meanColumnTotal;
    const cautionUnavailableReason =
      sampleSize < 3
        ? "insufficient_students"
        : row.score === 0 || row.score === itemCount
          ? "extreme_score"
          : denominator <= 1e-12
            ? "zero_caution_denominator"
            : null;
    // Sato CS: 1 - cov(observed response, item total) / cov(ideal, item total).
    // Sheu et al. (2014), equation (2), doi:10.4304/jsw.9.7.1903-1913;
    // Lin & Kawauchi (2026), equation (1), doi:10.20965/jaciii.2026.p0486.
    // The equivalent difference form avoids cancellation near a perfect pattern.
    const cautionIndex = cautionUnavailableReason
      ? null
      : Math.max(0, (idealWeighted - observedWeighted) / denominator);
    return {
      studentId: row.studentId,
      correctCount: row.score,
      percentCorrect: (row.score / itemCount) * 100,
      responses,
      sCurve: row.score,
      cautionIndex,
      cautionUnavailableReason,
    };
  });
  const histogramCounts = new Map<number, number>();
  totals.forEach((score) =>
    histogramCounts.set(score, (histogramCounts.get(score) || 0) + 1),
  );
  const asPercent = (value: number | null) =>
    value === null || !itemCount ? null : (value / itemCount) * 100;

  return {
    scoreScale: "correct_item_count",
    varianceConvention: "sample_n_minus_one",
    inputRowCount: input.rows.length,
    sampleSize,
    itemCount,
    maximumScore: itemCount,
    excludedRows,
    mean,
    standardDeviation,
    meanPercent: asPercent(mean),
    standardDeviationPercent: asPercent(standardDeviation),
    scoreHistogram: validItems
      ? Array.from({ length: itemCount + 1 }, (_, score) => ({
          score,
          count: histogramCounts.get(score) || 0,
        }))
      : [],
    alpha,
    alphaUnavailableReason: reliability.reason,
    sem,
    semPercent: asPercent(sem),
    semUnavailableReason,
    items,
    spRows,
    spItemOrder: orderedColumns.map((column) => column.id),
    spItemTotals: orderedColumns.map((column) => column.total),
    upperLower: {
      fraction: 0.27,
      targetCount,
      actualCount,
      tiePolicy: "unavailable_at_boundary_ties",
      unavailableReason: upperLowerUnavailableReason,
    },
    smallSample: sampleSize < 20,
    notices,
  };
};
