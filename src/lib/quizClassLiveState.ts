import { buildQuizAnalysis, type QuizBehaviorCategory } from "./quizAnalysis";
import type {
  QuizClassAchievement,
  QuizClassChanges,
  QuizClassDetail,
  QuizClassScope,
  QuizClassSummary,
  QuizClassSummaryResponse,
} from "./quizClassAnalysis";

const key = (row: { source: string; id: string }) => `${row.source}:${row.id}`;
function merge<T>(
  rows: T[],
  updates: T[],
  removed: string[],
  id: (row: T) => string,
) {
  if (
    !updates.length &&
    !removed.some((value) => rows.some((row) => id(row) === value))
  )
    return rows;
  const values = new Map(rows.map((row) => [id(row), row]));
  removed.forEach((value) => values.delete(value));
  updates.forEach((row) => values.set(id(row), row));
  return [...values.values()];
}

export function applyQuizClassChanges<T extends QuizClassDetail>(
  data: T,
  changes: QuizClassChanges,
): T {
  const result = {
    ...data,
    live: changes.live,
    rawRows: merge(data.rawRows, changes.rawRows, changes.removedKeys, key),
    questions: merge(
      data.questions,
      changes.questionUpserts,
      changes.questionRemovedIds,
      (question) => String(question.id),
    ),
  };
  if ("mockExamScoreRows" in data) {
    (result as unknown as QuizClassAchievement).mockExamScoreRows = merge(
      (data as unknown as QuizClassAchievement).mockExamScoreRows,
      changes.mockExamScoreRows,
      changes.removedKeys,
      key,
    );
  }
  return result;
}

const categories: QuizBehaviorCategory[] = [
  "suspected_guessing",
  "repeated_choice",
  "unflagged",
  "insufficient",
  "no_attempt",
];
function classSummary(
  scope: QuizClassScope,
  data: NonNullable<QuizClassSummaryResponse["liveData"]>,
  target: { id: string; label: string },
  previous?: QuizClassSummary,
): QuizClassSummary {
  const students = data.students.filter(
    (student) => student.classId === target.id,
  );
  const uids = new Set(students.map((student) => student.uid));
  const analysis = buildQuizAnalysis({
    semesterId: scope.semesterId,
    students,
    questions: data.questions,
    records: data.records.filter((record) => uids.has(record.studentUid)),
    scope: scope.keyword
      ? {
          questionIds: data.questions.map((q) => String(q.id)),
          scoreBasis: "latest_current_revision_items",
          classId: target.id,
        }
      : {
          unitIds: [scope.unitId],
          category: scope.category,
          examRound: scope.examRound,
          classId: target.id,
        },
  });
  const questions = new Map(
    data.questions.map((question) => [String(question.id), question]),
  );
  const concepts = new Map<
    string,
    {
      concept: string;
      wrongCount: number;
      respondentCount: number;
      reviewLessonIds: Set<string>;
    }
  >();
  const behaviorCounts = Object.fromEntries(
    categories.map((category) => [category, 0]),
  ) as Record<QuizBehaviorCategory, number>;
  for (const student of analysis.students) {
    behaviorCounts[
      student.behavior?.category ||
        (student.attemptCount ? "insufficient" : "no_attempt")
    ]++;
    for (const concept of student.assessedConcepts) {
      const value = concepts.get(concept) || {
        concept,
        wrongCount: 0,
        respondentCount: 0,
        reviewLessonIds: new Set<string>(),
      };
      value.respondentCount++;
      concepts.set(concept, value);
    }
    for (const item of student.wrongConcepts) {
      const value = concepts.get(item.concept) || {
        concept: item.concept,
        wrongCount: 0,
        respondentCount: 0,
        reviewLessonIds: new Set<string>(),
      };
      value.wrongCount++;
      item.reviewLessonIds.forEach((id) => value.reviewLessonIds.add(id));
      concepts.set(item.concept, value);
    }
  }
  return {
    ...previous,
    classId: target.id,
    label: target.label,
    rosterCount: students.length,
    submittedCount: analysis.participantCount,
    unsubmittedCount: Math.max(0, students.length - analysis.participantCount),
    scoredCount: analysis.scoredStudentCount,
    averageScore: analysis.averageScore,
    missingScoreCount: analysis.missingScoreStudentCount,
    scoreHistogram: analysis.scoreHistogram,
    behaviorCounts,
    questions: analysis.questions.map((item) => {
      const q = questions.get(item.id);
      const original = previous?.questions.find((row) => row.id === item.id);
      return {
        ...original,
        id: item.id,
        question: (q?.question || original?.question || "")
          .replace(/<[^>]+>/g, "")
          .slice(0, 220),
        subUnitId: q?.subUnitId || "",
        concepts: q?.concepts || [],
        reviewLessonId: q?.reviewLessonId || "",
        correctCount: item.correctCount,
        wrongCount: item.wrongCount,
        respondentCount: item.assessedStudentCount,
        correctRate: item.correctRate,
        revisionExcludedCount: item.revisionExcludedCount,
        revisionUnknownCount: item.revisionUnknownCount,
      };
    }),
    concepts: [...concepts.values()]
      .map((value) => ({
        ...value,
        reviewLessonIds: [...value.reviewLessonIds],
      }))
      .sort((a, b) => b.wrongCount - a.wrongCount),
    relearning: {
      repeatedStudentCount: analysis.students.filter(
        (student) => student.changes.comparedQuestionCount > 0,
      ).length,
      wrongToCorrectCount: analysis.students.reduce(
        (sum, student) => sum + student.changes.wrongToCorrectCount,
        0,
      ),
      correctToWrongCount: analysis.students.reduce(
        (sum, student) => sum + student.changes.correctToWrongCount,
        0,
      ),
    },
    generatedAt: new Date().toISOString(),
    version: previous?.version || "live",
    smallSample: analysis.scoredStudentCount < 20,
    complete: true,
    basis: scope.keyword
      ? "latest_current_revision_keyword_items"
      : "latest_student_score_and_latest_current_revision_item",
  };
}

function gradeSummary(
  previous: NonNullable<QuizClassSummaryResponse["gradeComparison"]>,
  classes: QuizClassSummary[],
) {
  const sum = (
    field:
      | "rosterCount"
      | "submittedCount"
      | "unsubmittedCount"
      | "scoredCount"
      | "missingScoreCount",
  ) => classes.reduce((total, row) => total + (row[field] || 0), 0);
  const scoredCount = sum("scoredCount");
  const questions = new Map<string, QuizClassSummary["questions"][number]>();
  const concepts = new Map<string, QuizClassSummary["concepts"][number]>();
  for (const row of classes) {
    for (const item of row.questions) {
      const value = questions.get(item.id) || {
        ...item,
        correctCount: 0,
        wrongCount: 0,
        respondentCount: 0,
        revisionExcludedCount: 0,
        revisionUnknownCount: 0,
      };
      value.correctCount += item.correctCount;
      value.wrongCount += item.wrongCount;
      value.respondentCount += item.respondentCount;
      value.revisionExcludedCount =
        (value.revisionExcludedCount || 0) + (item.revisionExcludedCount || 0);
      value.revisionUnknownCount =
        (value.revisionUnknownCount || 0) + (item.revisionUnknownCount || 0);
      value.correctRate = value.respondentCount
        ? (100 * value.correctCount) / value.respondentCount
        : null;
      questions.set(item.id, value);
    }
    for (const item of row.concepts) {
      const value = concepts.get(item.concept) || {
        ...item,
        wrongCount: 0,
        respondentCount: 0,
        reviewLessonIds: [],
      };
      value.wrongCount += item.wrongCount;
      value.respondentCount += item.respondentCount;
      value.reviewLessonIds = [
        ...new Set([
          ...(value.reviewLessonIds || []),
          ...(item.reviewLessonIds || []),
        ]),
      ];
      concepts.set(item.concept, value);
    }
  }
  return {
    ...previous,
    rosterCount: sum("rosterCount"),
    submittedCount: sum("submittedCount"),
    unsubmittedCount: sum("unsubmittedCount"),
    scoredCount,
    missingScoreCount: sum("missingScoreCount"),
    averageScore: scoredCount
      ? classes.reduce(
          (total, row) => total + (row.averageScore || 0) * row.scoredCount,
          0,
        ) / scoredCount
      : null,
    classCount: classes.length,
    respondingClassCount: classes.filter((row) => row.scoredCount > 0).length,
    questions: [...questions.values()],
    concepts: [...concepts.values()]
      .filter((value) => value.wrongCount > 0)
      .sort((a, b) => b.wrongCount - a.wrongCount),
    behaviorCounts: Object.fromEntries(
      categories.map((category) => [
        category,
        classes.reduce(
          (total, row) => total + (row.behaviorCounts?.[category] || 0),
          0,
        ),
      ]),
    ) as Record<QuizBehaviorCategory, number>,
    scoreHistogram: (classes[0]?.scoreHistogram || []).map((band, index) => ({
      ...band,
      count: classes.reduce(
        (total, row) => total + row.scoreHistogram[index].count,
        0,
      ),
    })),
    relearning: {
      repeatedStudentCount: classes.reduce(
        (total, row) => total + row.relearning.repeatedStudentCount,
        0,
      ),
      wrongToCorrectCount: classes.reduce(
        (total, row) => total + row.relearning.wrongToCorrectCount,
        0,
      ),
      correctToWrongCount: classes.reduce(
        (total, row) => total + row.relearning.correctToWrongCount,
        0,
      ),
    },
    smallSample: scoredCount < 20,
    generatedAt: new Date().toISOString(),
  };
}

export function applyQuizClassSummaryChanges(
  data: QuizClassSummaryResponse,
  scope: QuizClassScope,
  changes: QuizClassChanges,
): QuizClassSummaryResponse {
  if (!data.liveData)
    throw new Error(
      "실시간 분석 자료를 확인하지 못했습니다. 다시 조회해 주세요.",
    );
  const liveData = {
    ...data.liveData,
    records: merge(
      data.liveData.records,
      changes.records,
      changes.removedKeys,
      key,
    ),
    questions: merge(
      data.liveData.questions,
      changes.questionUpserts,
      changes.questionRemovedIds,
      (q) => String(q.id),
    ),
  };
  if (
    liveData.records === data.liveData.records &&
    liveData.questions === data.liveData.questions
  )
    return { ...data, live: changes.live };
  // Only records delivered by this delta replace entries in this view's memory.
  // No new full-class query is performed for statistics or comparison grades.
  const changedStudents = new Set(changes.records.map((row) => row.studentUid));
  const removed = new Set(changes.removedKeys);
  data.liveData.records.forEach((row) => {
    if (removed.has(key(row))) changedStudents.add(row.studentUid);
  });
  const affectedClasses = new Set(
    liveData.students
      .filter((student) => changedStudents.has(student.uid))
      .map((student) => student.classId),
  );
  const previousSummaries = new Map(
    (data.liveData.summaries || []).map((row) => [row.classId, row]),
  );
  const questionsChanged = liveData.questions !== data.liveData.questions;
  const summaries = new Map(
    liveData.classes.map((entry) => [
      entry.id,
      !questionsChanged &&
      !affectedClasses.has(entry.id) &&
      previousSummaries.has(entry.id)
        ? previousSummaries.get(entry.id)!
        : classSummary(
            scope,
            liveData,
            entry,
            previousSummaries.get(entry.id) ||
              data.classes.find((row) => row.classId === entry.id),
          ),
    ]),
  );
  liveData.summaries = [...summaries.values()];
  return {
    ...data,
    live: changes.live,
    liveData,
    classes: data.classes.map((row) => {
      const value = summaries.get(row.classId)!;
      return {
        ...value,
        concepts: value.concepts.filter((item) => item.wrongCount > 0),
      };
    }),
    ...(data.gradeComparison
      ? {
          gradeComparison: gradeSummary(
            data.gradeComparison,
            liveData.classes
              .filter((entry) => entry.grade === data.gradeComparison!.grade)
              .map((entry) => summaries.get(entry.id)!),
          ),
        }
      : {}),
  };
}
