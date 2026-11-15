import {
  buildWrittenExamAnalysisDataset,
  type WrittenExamImportedStudent,
  type WrittenExamQuestionInfo,
} from "./writtenExamAnalysisImport";
import type { QuizClassAchievement } from "./quizClassAnalysis";
import {
  achievementTimestamp,
  buildCumulativeAchievementScores,
} from "./achievementAnalysis";

const digits = (value: unknown) =>
  String(value ?? "")
    .match(/\d+/)?.[0]
    ?.replace(/^0+(?=\d)/, "") || "";

const name = (value: unknown) =>
  String(value ?? "")
    .normalize("NFC")
    .replace(/\s/g, "");

/** Keep only roster matching and cumulative score evidence in the local cache. */
export function compactWrittenExamMock(mock: QuizClassAchievement | null) {
  if (!mock) return null;
  const fields = [
    "studentUid",
    "uid",
    "studentId",
    "userId",
    "semesterId",
    "category",
    "examRound",
    "attemptId",
    "canonicalAttemptId",
    "resultId",
    "legacyResultId",
    "submissionRef",
    "resultRef",
    "submittedAtIso",
    "timestamp",
    "createdAt",
    "percent",
    "score",
    "total",
    "maxPoints",
    "cutScoreQuestions",
  ];
  return {
    semesterId: mock.semesterId,
    complete: mock.complete,
    students: mock.students.map(
      ({ uid, name, classId, grade, classNumber, number }) => ({
        uid,
        name,
        classId,
        grade,
        classNumber,
        number,
      }),
    ),
    mockExamScoreRows: mock.mockExamScoreRows.map(({ id, source, raw }) => ({
      id,
      source,
      raw: {
        ...Object.fromEntries(
          fields
            .filter((field) => field in raw)
            .map((field) => [field, raw[field]]),
        ),
        ...(Array.isArray(raw.cutScoreQuestions)
          ? {
              cutScoreQuestions: raw.cutScoreQuestions.map((question) =>
                question && typeof question === "object"
                  ? Object.fromEntries(
                      [
                        "id",
                        "points",
                        "targetAchievementLevel",
                        "intendedDifficulty",
                      ]
                        .filter((field) => field in question)
                        .map((field) => [field, question[field]]),
                    )
                  : question,
              ),
            }
          : {}),
      },
    })),
    generatedAt: mock.generatedAt,
    version: mock.version,
    rawRows: [],
    questions: [],
    treeData: [],
    configuredClasses: [],
  } satisfies QuizClassAchievement;
}

/** Require a unique school identity plus the name; an explicit UID must agree. */
export function projectWrittenExamAnalysis(input: {
  id: string;
  title: string;
  grade: string;
  revision: string;
  examDate: string;
  questions: WrittenExamQuestionInfo[];
  students: WrittenExamImportedStudent[];
  semesterId: string;
  mock: QuizClassAchievement | null;
}) {
  const roster = new Map<string, Array<{ uid: string; name: string }>>();
  for (const student of input.mock?.students || []) {
    const parts = student.classId?.split("-") || [];
    const grade = digits(student.grade || (parts.length === 2 ? parts[0] : ""));
    const room = digits(
      student.classNumber || (parts.length === 2 ? parts[1] : ""),
    );
    const key = [grade, room, digits(student.number)].join("-");
    if (grade && room && digits(student.number))
      roster.set(key, [
        ...(roster.get(key) || []),
        { uid: student.uid, name: name(student.name) },
      ]);
  }
  const linkedStudents = input.students.map((student) => {
    const matches =
      roster.get(
        [student.grade, student.class, student.number].map(digits).join("-"),
      ) || [];
    const candidate = matches.length === 1 ? matches[0] : null;
    return {
      ...student,
      uid:
        candidate &&
        candidate.name &&
        candidate.name === name(student.name) &&
        (!student.uid || student.uid === candidate.uid)
          ? candidate.uid
          : undefined,
    };
  });
  const parsedCutoff = Date.parse(`${input.examDate}T23:59:59+09:00`);
  // A missing exam date must not silently include later mock assessments.
  const cutoff = Number.isFinite(parsedCutoff) ? parsedCutoff : 0;
  const dataset = buildWrittenExamAnalysisDataset({
    examId: input.id,
    title: input.title,
    semesterId: input.semesterId,
    questions: input.questions,
    students: linkedStudents,
    importedAt: cutoff,
    examRound: "round_4",
  });
  const owners = new Set(dataset.students.map((student) => student.uid));
  const availableMockRows = (input.mock?.mockExamScoreRows || []).filter(
    ({ raw }) => {
      const at = achievementTimestamp(
        raw.submittedAtIso || raw.timestamp || raw.createdAt,
      );
      return (
        owners.has(
          String(raw.studentUid || raw.uid || raw.studentId || raw.userId),
        ) &&
        raw.semesterId === input.semesterId &&
        at !== null &&
        at <= cutoff &&
        /^round_[123]$/.test(String(raw.examRound || "round_1"))
      );
    },
  );
  // Missing frozen paper metadata must not make an otherwise valid regular
  // examination unclassifiable. Retain only the first eligible historical form.
  const validMockIds = new Set(
    buildCumulativeAchievementScores({
      semesterId: input.semesterId,
      students: dataset.students,
      examRound: "round_3",
      scoreRows: availableMockRows,
    }).flatMap((student) =>
      student.rounds
        .filter((round) => round.cutScores)
        .map((round) => `${student.student.uid}:${round.resultId}`),
    ),
  );
  const mockRows = availableMockRows.filter((row) =>
    validMockIds.has(
      `${String(row.raw.studentUid || row.raw.uid || row.raw.studentId || row.raw.userId)}:${row.id}`,
    ),
  );
  const configuredClasses = [
    ...new Set(dataset.students.map((student) => student.classId!)),
  ]
    .sort((a, b) => a.localeCompare(b, "ko", { numeric: true }))
    .map((id) => ({
      id,
      label: `${id.split("-")[0]}학년 ${id.split("-")[1]}반`,
    }));
  const data: QuizClassAchievement = {
    semesterId: input.semesterId,
    grade: input.grade,
    complete: true,
    students: dataset.students,
    questions: dataset.questions,
    rawRows: dataset.achievementRecords,
    treeData: dataset.tree,
    configuredClasses,
    generatedAt: new Date(cutoff).toISOString(),
    version: input.revision,
    mockExamScoreRows: [...mockRows, ...dataset.achievementRecords],
  };
  return {
    data,
    dataset,
    matchedStudentCount: linkedStudents.filter((student) => student.uid).length,
  };
}
