import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import { buildAssessmentDefinitionId } from "./assessmentLifecycle";
import { getSemesterDocPath, getYearSemester } from "./semesterScope";
import { getMockExamResultCategory } from "./mockExamRounds";
import {
  normalizeHistoryClassroomAssignment,
  normalizeHistoryClassroomResult,
  summarizeHistoryClassroomAnswers,
  type HistoryClassroomAssignment,
} from "./historyClassroom";

type ConfigLike = Parameters<typeof getYearSemester>[0];
type Result = {
  id: string;
  attemptId: string;
  definitionId: string;
  semesterId: string;
  studentUid: string;
  assessmentKind: "QUIZ" | "HISTORY_CLASSROOM";
  score: number;
  total: number;
  percent: number;
  answerChecks: Array<{ id: string; correct: boolean }>;
  submittedAtIso: string;
  submissionRef: string;
  answers: Record<string, string>;
};

// Read immutable, owner-scoped results and submitted answers. Attempts contain
// the private grading snapshot and are available only through the callable.
export const readStudentAssessmentResults = async (
  config: ConfigLike,
  uid: string,
) => {
  const { year, semester } = getYearSemester(config);
  const scope = `${year}-${semester}`;
  if (!uid) return [];
  const snap = await getDocs(
    query(
      collection(db, "semester_assessment_results"),
      where("studentUid", "==", uid),
      where("semesterId", "==", scope),
    ),
  );
  return Promise.all(
    snap.docs.map(async (item) => {
      const result = { ...item.data(), id: item.id } as Result;
      if (
        result.studentUid !== uid ||
        result.semesterId !== scope ||
        result.attemptId !== item.id ||
        result.submissionRef !== `semester_assessment_submissions/${item.id}` ||
        !Number.isFinite(result.percent) ||
        result.percent < 0 ||
        result.percent > 100
      ) {
        throw new Error("평가 결과를 확인할 수 없습니다.");
      }
      const submitted = await getDoc(doc(db, result.submissionRef));
      const data = submitted.data();
      if (
        !data ||
        data.studentUid !== uid ||
        data.semesterId !== scope ||
        data.attemptId !== item.id
      )
        throw new Error("제출 답안을 확인할 수 없습니다.");
      return { ...result, answers: data.answers || {} };
    }),
  );
};

export const readCanonicalQuizResults = async (
  config: ConfigLike,
  uid: string,
) => {
  const results = await readStudentAssessmentResults(config, uid);
  return results
    .filter((item) => item.assessmentKind === "QUIZ")
    .map((item) => {
      const prefix = `quiz:${item.semesterId}:`;
      const parts = item.definitionId.startsWith(prefix)
        ? item.definitionId.slice(prefix.length).split(":")
        : [];
      const examRound = parts[parts.length - 1]?.startsWith("round_")
        ? parts.pop()!
        : "";
      const category = parts.pop() || "";
      const unitId = parts.join(":");
      return {
        id: item.id,
        unitId,
        category: getMockExamResultCategory(category, examRound),
        examRound,
        score: item.percent,
        timestamp: Timestamp.fromDate(new Date(item.submittedAtIso)),
        timeString: new Date(item.submittedAtIso).toLocaleString("ko-KR"),
        details: item.answerChecks.map((check) => ({
          id: check.id,
          correct: check.correct,
          u: item.answers[check.id] || "",
          displayU: item.answers[check.id] || "",
        })),
      };
    });
};

export const readCanonicalHistoryResults = async (
  config: ConfigLike,
  uid: string,
  assignments?: HistoryClassroomAssignment[],
) => {
  const results = (await readStudentAssessmentResults(config, uid)).filter(
    (item) => item.assessmentKind === "HISTORY_CLASSROOM",
  );
  const { year, semester } = getYearSemester(config);
  const sources = new Map(
    (assignments || []).map((item) => [
      buildAssessmentDefinitionId(
        `${year}-${semester}`,
        "HISTORY_CLASSROOM",
        item.id,
      ),
      item,
    ]),
  );
  return Promise.all(
    results.map(async (result) => {
      const prefix = `history_classroom:${result.semesterId}:`;
      const sourceId = result.definitionId.startsWith(prefix)
        ? result.definitionId.slice(prefix.length)
        : "";
      let source = sources.get(result.definitionId);
      if (!source && !assignments && sourceId && !sourceId.includes("/")) {
        const snap = await getDoc(
          doc(db, getSemesterDocPath(config, "history_classrooms", sourceId)),
        ).catch(() => null);
        if (snap?.exists())
          source = normalizeHistoryClassroomAssignment(snap.id, snap.data());
      }
      const passed = !!source && result.percent >= source.passThresholdPercent;
      const checks = source
        ? summarizeHistoryClassroomAnswers(source, result.answers).checks.map(
            (check) => ({
              ...check,
              correct:
                result.answerChecks.find((item) => item.id === check.blankId)
                  ?.correct === true,
            }),
          )
        : [];
      return {
        ...normalizeHistoryClassroomResult(result.id, {
          assignmentId: source?.id || sourceId,
          assignmentTitle: source?.title || "역사교실",
          uid,
          answers: result.answers,
          score: result.score,
          total: result.total,
          percent: result.percent,
          passed,
          passThresholdPercent: source?.passThresholdPercent,
          status: passed ? "passed" : "failed",
          answerChecks: checks,
          createdAt: Timestamp.fromDate(new Date(result.submittedAtIso)),
        }),
        sourceAvailable: !!source,
        createdAt: Timestamp.fromDate(new Date(result.submittedAtIso)),
      };
    }),
  );
};
