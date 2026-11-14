import type {
  PerformanceScoreItem,
  PerformanceScoreRoster,
  PerformanceScoreRosterRow,
} from "./performanceScores";
import { parseWrittenExamEssayFeedback } from "./writtenExamFeedback";

export interface EssayScoreSummary {
  count: number;
  mean: number | null;
  standardDeviation: number | null;
  minimum: number | null;
  maximum: number | null;
  distribution: Array<{ score: number; count: number }>;
}

export const summarizeEssayScores = (
  values: readonly number[],
): EssayScoreSummary => {
  if (!values.length)
    return {
      count: 0,
      mean: null,
      standardDeviation: null,
      minimum: null,
      maximum: null,
      distribution: [],
    };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const counts = new Map<number, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return {
    count: values.length,
    mean,
    // Describe this selected group, rather than estimate a larger population.
    standardDeviation: Math.sqrt(
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        values.length,
    ),
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    distribution: [...counts]
      .sort(([a], [b]) => a - b)
      .map(([score, count]) => ({ score, count })),
  };
};

const itemKey = (item: Partial<PerformanceScoreItem>) =>
  String(item.itemKey || item.shortName || item.name || "").trim();
const school = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/^0+(?=\d)/, "");
const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

/** A teacher's explicit marker is evidence; a zero or missing score is not. */
const markedBlank = (feedback: string) => {
  // Evaluate explicit statements separately so a later instruction does not
  // erase a preceding marker. This is a narrow text marker, not an answer diagnosis.
  return feedback
    .normalize("NFKC")
    .split(/[.!?。！？\r\n]+/)
    .some((sentence) => {
      const compact = sentence.replace(/\s/g, "");
      return (
        compact.includes("백지") &&
        !/백지(?:답안|상태)?(?:가|는|은|이)?(?:아니|아님|아닙|아닌)/.test(
          compact,
        ) &&
        !/백지(?:로|를)?(?:제출)?하지(?:않|마)/.test(compact) &&
        !/백지(?:로|를)?(?:내|두|남기)지(?:않|마)/.test(compact)
      );
    });
};

export function buildWrittenExamEssayAnalysis(
  rows: readonly PerformanceScoreRosterRow[],
  definitions: PerformanceScoreRoster["items"],
) {
  const items = definitions
    .filter((item) => item.examSection === "essay")
    .map((item) => ({
      key: itemKey(item),
      label: item.shortName || item.name,
    }));
  const keys = new Set(items.map((item) => item.key));
  if (items.some((item) => !item.key) || keys.size !== items.length)
    throw new Error(
      "논술형 문항 구분이 중복되거나 비어 있습니다. 점수표를 확인해 주세요.",
    );
  const studentKeys = new Set<string>(),
    uids = new Set<string>();
  const students = rows
    .map((row) => {
      const grade = school(row.grade),
        room = school(row.class),
        number = school(row.number);
      const key = [grade, room, number].join("-");
      if (
        !grade ||
        !room ||
        !number ||
        !text(row.studentName) ||
        studentKeys.has(key) ||
        (row.uid && uids.has(row.uid))
      )
        throw new Error("논술형 학생의 학적 또는 중복 연결을 확인해 주세요.");
      studentKeys.add(key);
      if (row.uid) uids.add(row.uid);
      const values = new Map<string, PerformanceScoreItem>();
      for (const item of row.items || []) {
        if (item.examSection !== "essay") continue;
        const id = itemKey(item);
        if (!keys.has(id) || values.has(id))
          throw new Error(
            "논술형 문항 구성이 학생 점수와 다릅니다. 새로고침한 뒤 점수표를 확인해 주세요.",
          );
        values.set(id, item);
      }
      const scores = items.map(({ key: id }) => {
        const item = values.get(id);
        if (
          !item ||
          item.scoreEntered === false ||
          item.scoreEntered === null ||
          item.score == null
        )
          return null;
        if (
          typeof item.score !== "number" ||
          !Number.isFinite(item.score) ||
          item.score < 0
        )
          throw new Error(
            "논술형 점수에 올바르지 않은 값이 있습니다. 점수표를 확인해 주세요.",
          );
        return item.score;
      });
      const enteredCount = scores.filter((value) => value !== null).length;
      const partialSum = scores.reduce<number>(
        (sum, value) => sum + (value ?? 0),
        0,
      );
      const status: "missing" | "complete" | "partial" = !enteredCount
        ? "missing"
        : enteredCount === items.length
          ? "complete"
          : "partial";
      const feedback = text(row.feedback) || text(row.evidence);
      const hasItemFeedback = [...values.values()].some((item) =>
        text(item.feedback),
      );
      // Older uploads only stored one numbered feedback string. Do not let an
      // old full string override a newer set of explicit item-level feedback.
      const legacyFeedback = hasItemFeedback
        ? null
        : parseWrittenExamEssayFeedback(feedback);
      const itemFeedback = items.flatMap(({ key: id, label }) => {
        const value =
          text(values.get(id)?.feedback) ||
          legacyFeedback?.byItemKey.get(id) ||
          (items.length === 1 ? legacyFeedback?.generalFeedback : "") ||
          "";
        return value ? [{ key: id, label, feedback: value }] : [];
      });
      const blankItems = itemFeedback.filter((item) =>
        markedBlank(item.feedback),
      );
      return {
        key,
        uid: row.uid,
        grade,
        class: room,
        number,
        name: row.studentName,
        scores,
        enteredCount,
        partialSum,
        status,
        total: status === "complete" ? partialSum : null,
        feedback,
        itemFeedback,
        blankItems,
        blankCount: blankItems.length,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key, "ko", { numeric: true }));
  const selectedSummary = (selected: typeof students) => ({
    studentCount: selected.length,
    blankCount: selected.reduce((sum, student) => sum + student.blankCount, 0),
    blankStudentCount: selected.filter((student) => student.blankCount > 0)
      .length,
    completeCount: selected.filter((student) => student.status === "complete")
      .length,
    partialCount: selected.filter((student) => student.status === "partial")
      .length,
    missingCount: selected.filter((student) => student.status === "missing")
      .length,
    totals: summarizeEssayScores(
      selected.flatMap((student) =>
        student.total === null ? [] : [student.total],
      ),
    ),
    items: items.map((item, index) => ({
      ...item,
      blankCount: selected.filter((student) =>
        student.blankItems.some((blank) => blank.key === item.key),
      ).length,
      summary: summarizeEssayScores(
        selected.flatMap((student) =>
          student.scores[index] === null ? [] : [student.scores[index]!],
        ),
      ),
      missingCount: selected.filter((student) => student.scores[index] === null)
        .length,
    })),
  });
  const classIds = [
    ...new Set(students.map((student) => `${student.grade}-${student.class}`)),
  ].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
  return {
    ...selectedSummary(students),
    students,
    classes: classIds.map((id) => ({
      id,
      label: `${id.split("-")[0]}학년 ${id.split("-")[1]}반`,
      ...selectedSummary(
        students.filter(
          (student) => `${student.grade}-${student.class}` === id,
        ),
      ),
    })),
  };
}

export type WrittenExamEssayReport = ReturnType<
  typeof buildWrittenExamEssayAnalysis
>;
