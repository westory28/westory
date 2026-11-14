import { doc, getDocFromServer } from "firebase/firestore";
import { auth, db } from "./firebase";
import { getSemesterCollectionPath, getYearSemester } from "./semesterScope";
import { parseObjectiveAnswerChoices } from "./writtenExamEssayScoreWorkbook";
import {
  PERFORMANCE_SCORE_ROSTERS_COLLECTION,
  PERFORMANCE_SCORE_USER_COLLECTION,
  WRITTEN_EXAM_SCORE_KIND,
  hasEnteredPerformanceScore,
  type PerformanceScoreRecord,
  type PerformanceScoreRoster,
  type PerformanceScoreItem,
} from "./performanceScores";
import {
  WRITTEN_EXAM_ANALYSES_COLLECTION,
  saveWrittenExamAnalysis,
  type WrittenExamAnalysisMetadata,
  type WrittenExamAnalysisSaveInput,
} from "./writtenExamAnalysisStore";
import type {
  WrittenExamImportedStudent,
  WrittenExamQuestionInfo,
} from "./writtenExamAnalysisImport";

type Config = Parameters<typeof getYearSemester>[0];
export type WrittenExamScoreSource = Omit<PerformanceScoreRoster, "rows">;
const segment = (value: string) => {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value))
    throw new Error("점수표 경로를 확인해 주세요.");
  return value;
};
const school = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/^0+(?=\d)/, "");
const choice = (value: unknown) => parseObjectiveAnswerChoices(value).join("");
const objective = (item: Partial<PerformanceScoreItem>) =>
  item.examSection === "objective";
// Early written-exam uploads contained essay scores before section tags existed.
// Interpret only untagged, non-objective items in this already-validated ledger;
// never rewrite stored grades or infer an objective item from its display name.
const withLegacyEssaySection = <T extends Partial<PerformanceScoreItem>>(
  item: T,
  contentKind: PerformanceScoreRecord["scoreContentKind"],
): T =>
  !item.examSection &&
  contentKind !== "objective" &&
  item.questionNumber == null &&
  !item.correctAnswer &&
  !item.answerChoices?.length
    ? { ...item, examSection: "essay" }
    : item;
const sourceFields = [
  "scoreKind",
  "scoreContentKind",
  "title",
  "subject",
  "academicYear",
  "semester",
  "targetGrade",
  "targetClass",
  "classes",
  "items",
  "totalMaxScore",
  "rowCount",
  "updatedAt",
];

type RestValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
  nullValue?: null;
  arrayValue?: { values?: RestValue[] };
  mapValue?: { fields?: Record<string, RestValue> };
};
const decode = (value: RestValue): unknown => {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if (value.arrayValue) return (value.arrayValue.values || []).map(decode);
  if (value.mapValue)
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([key, field]) => [
        key,
        decode(field),
      ]),
    );
  return null;
};

/** Server projection excludes names, answers, feedback and signatures from the picker.
 * This reduces transferred fields, not the billed document count. No result limit. */
export async function listWrittenExamScoreSources(
  config: Config,
): Promise<WrittenExamScoreSource[]> {
  const owner = auth.currentUser;
  if (!owner) throw new Error("로그인 상태를 확인해 주세요.");
  const { year, semester } = getYearSemester(config);
  if (!/^\d{4}$/.test(year) || !/^[12]$/.test(semester))
    throw new Error("학기를 확인해 주세요.");
  const token = await owner.getIdToken();
  if (auth.currentUser !== owner)
    throw new Error("로그인 사용자가 바뀌었습니다.");
  const emulator = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST;
  const base =
    emulator || import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true"
      ? `http://${emulator || "127.0.0.1"}:${import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || "8080"}`
      : "https://firestore.googleapis.com";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(
      `${base}/v1/projects/${db.app.options.projectId}/databases/(default)/documents/years/${year}/semesters/${semester}:runQuery`,
      {
        method: "POST",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          structuredQuery: {
            select: {
              fields: sourceFields.map((fieldPath) => ({ fieldPath })),
            },
            from: [{ collectionId: PERFORMANCE_SCORE_ROSTERS_COLLECTION }],
            where: {
              fieldFilter: {
                field: { fieldPath: "scoreKind" },
                op: "EQUAL",
                value: { stringValue: WRITTEN_EXAM_SCORE_KIND },
              },
            },
          },
        }),
      },
    );
    if (!response.ok)
      throw new Error(
        "등록된 점수표 목록을 불러오지 못했습니다. 다시 시도해 주세요.",
      );
    const result: Array<{
      document?: { name: string; fields?: Record<string, RestValue> };
    }> = await response.json();
    if (!Array.isArray(result))
      throw new Error("점수표 목록 응답을 확인하지 못했습니다.");
    if (result.some((row) => !row || typeof row !== "object" || "error" in row))
      throw new Error(
        "점수표 목록을 모두 불러오지 못했습니다. 다시 시도해 주세요.",
      );
    if (auth.currentUser !== owner)
      throw new Error("로그인 사용자가 바뀌었습니다.");
    return result
      .flatMap(({ document }) =>
        document
          ? [
              {
                ...Object.fromEntries(
                  Object.entries(document.fields || {}).map(([key, value]) => [
                    key,
                    decode(value),
                  ]),
                ),
                id: document.name.split("/").at(-1)!,
              } as WrittenExamScoreSource,
            ]
          : [],
      )
      .sort((a, b) => a.title.localeCompare(b.title, "ko"));
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadWrittenExamScoreRoster(config: Config, id: string) {
  const snapshot = await getDocFromServer(
    doc(
      db,
      getSemesterCollectionPath(config, PERFORMANCE_SCORE_ROSTERS_COLLECTION),
      segment(id),
    ),
  );
  if (!snapshot.exists())
    throw new Error("점수표가 삭제되었습니다. 목록을 새로고침해 주세요.");
  const roster = {
    ...snapshot.data(),
    id: snapshot.id,
  } as PerformanceScoreRoster;
  const { year, semester } = getYearSemester(config);
  if (
    roster.scoreKind !== WRITTEN_EXAM_SCORE_KIND ||
    String(roster.academicYear) !== year ||
    String(roster.semester) !== semester
  )
    throw new Error("정기시험 점수표의 학기를 확인하지 못했습니다.");
  if (!Array.isArray(roster.rows) || !Array.isArray(roster.items))
    throw new Error("점수표 문항과 학생 자료를 확인해 주세요.");
  roster.items = roster.items.map((item) =>
    withLegacyEssaySection(item, roster.scoreContentKind),
  );
  roster.rows = roster.rows.map((row) => ({
    ...row,
    items: (row.items || []).map((item) =>
      withLegacyEssaySection(item, roster.scoreContentKind),
    ),
  }));
  const rowClasses = [
    ...new Set(roster.rows.map((row) => school(row.class))),
  ].sort();
  const declaredClasses = [
    ...new Set((roster.classes || []).map(school)),
  ].sort();
  if (
    roster.rowCount !== roster.rows.length ||
    JSON.stringify(rowClasses) !== JSON.stringify(declaredClasses)
  )
    throw new Error(
      "점수표의 학생 수 또는 학급 목록이 일치하지 않습니다. 저장 상태를 확인해 주세요.",
    );
  studentsFromScoreRoster(roster, []);
  return roster;
}

export function scoreSourceClasses(
  source: Pick<WrittenExamScoreSource, "targetGrade" | "classes">,
) {
  return [
    ...new Set(
      (source.classes || []).map(
        (room) => `${school(source.targetGrade)}-${school(room)}`,
      ),
    ),
  ].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
}

export function questionsFromScoreSource(
  source: Pick<PerformanceScoreRoster, "items">,
): WrittenExamQuestionInfo[] {
  const questions = source.items.filter(objective).map((item) => ({
    number: Number(item.questionNumber),
    answer: choice(item.correctAnswer),
    points: Number(item.maxScore),
    options: item.answerChoices?.length
      ? item.answerChoices.map(choice)
      : ["1", "2", "3", "4", "5"],
    achievementStandardCodes: [],
    targetAchievementLevel: "" as const,
    intendedDifficulty: "" as const,
    concepts: [],
  }));
  const seen = new Set<number>();
  for (const question of questions) {
    if (
      !Number.isInteger(question.number) ||
      question.number < 1 ||
      seen.has(question.number) ||
      !Number.isFinite(question.points) ||
      question.points <= 0 ||
      !/^[1-5]+$/.test(question.answer)
    )
      throw new Error("등록된 서답형 문항의 번호·정답·배점을 확인해 주세요.");
    seen.add(question.number);
  }
  return questions.sort((a, b) => a.number - b.number);
}

export function mergeScoreSourceQuestions(
  source: WrittenExamQuestionInfo[],
  information: WrittenExamQuestionInfo[],
) {
  if (!information.length) return source;
  if (!source.length) return information;
  const byNumber = new Map(
    information.map((question) => [question.number, question]),
  );
  if (
    source.length !== information.length ||
    source.some((question) => {
      const info = byNumber.get(question.number);
      return (
        !info ||
        choice(info.answer) !== choice(question.answer) ||
        Math.abs(info.points - question.points) > 0.0001
      );
    })
  )
    throw new Error(
      "문항정보표의 문항번호·정답·배점이 등록된 점수표와 다릅니다. 점수 등록 및 확인에서 자료를 확인해 주세요.",
    );
  return source.map((question) => ({
    ...byNumber.get(question.number)!,
    answer: question.answer,
    points: question.points,
  }));
}

export function studentsFromScoreRoster(
  roster: PerformanceScoreRoster,
  questions: WrittenExamQuestionInfo[],
): WrittenExamImportedStudent[] {
  const seen = new Set<string>();
  const uids = new Set<string>();
  return roster.rows.map((row) => {
    const grade = school(row.grade),
      room = school(row.class),
      number = school(row.number);
    const key = [grade, room, number].join("-");
    if (
      grade !== school(roster.targetGrade) ||
      !/^[1-9]\d?$/.test(room) ||
      !/^[1-9]\d{0,2}$/.test(number) ||
      !row.studentName?.trim() ||
      seen.has(key) ||
      (row.uid && uids.has(row.uid))
    )
      throw new Error("점수표의 학생 학적 또는 중복 연결을 확인해 주세요.");
    seen.add(key);
    if (row.uid) uids.add(row.uid);
    const items = new Map(
      (row.items || [])
        .filter(objective)
        .map((item) => [Number(item.questionNumber), item]),
    );
    const responses = questions.map((question) => {
      const item = items.get(question.number);
      const entered =
        item && item.scoreEntered !== false && Number.isFinite(item.score);
      const correct =
        entered && typeof item.answerCorrect === "boolean"
          ? item.answerCorrect
          : null;
      return {
        questionNumber: question.number,
        answer: !entered
          ? null
          : item.answerStatus === "blank"
            ? ""
            : item.studentAnswer
              ? choice(item.studentAnswer)
              : correct === true
                ? question.answer
                : null,
        correct,
        score: entered ? item.score : null,
      };
    });
    return {
      key,
      ...(row.uid ? { uid: row.uid } : {}),
      grade,
      class: room,
      number,
      name: row.studentName,
      responses,
      totalScore:
        responses.every((response) => response.score !== null) &&
        responses.length
          ? responses.reduce((sum, response) => sum + (response.score || 0), 0)
          : null,
    };
  });
}

export async function loadWrittenExamMaterials(config: Config, id: string) {
  const snapshot = await getDocFromServer(
    doc(
      db,
      getSemesterCollectionPath(config, WRITTEN_EXAM_ANALYSES_COLLECTION),
      segment(id),
    ),
  );
  return snapshot.exists()
    ? ({ ...snapshot.data(), id: snapshot.id } as WrittenExamAnalysisMetadata)
    : null;
}

export async function loadWrittenExamScoreAnalysis(
  config: Config,
  id: string,
  options: { classId?: string } = {},
) {
  const [roster, materials] = await Promise.all([
    loadWrittenExamScoreRoster(config, id),
    loadWrittenExamMaterials(config, id),
  ]);
  const questions = mergeScoreSourceQuestions(
    questionsFromScoreSource(roster),
    materials?.questions || [],
  );
  if (options.classId && !scoreSourceClasses(roster).includes(options.classId))
    throw new Error("선택한 학급의 점수표가 없습니다.");
  const rows = roster.rows.filter(
    (row) =>
      !options.classId ||
      `${school(row.grade)}-${school(row.class)}` === options.classId,
  );
  const hydrated: PerformanceScoreRoster["rows"] = [];
  // Objective items are intentionally omitted from roster rows to fit Firestore.
  // Read only this assessment's explicitly linked students in the selected class.
  for (let offset = 0; offset < rows.length; offset += 20) {
    hydrated.push(
      ...(await Promise.all(
        rows.slice(offset, offset + 20).map(async (row) => {
          if (!row.uid) {
            if (hasEnteredPerformanceScore(row))
              throw new Error(
                "등록된 점수의 학생 연결이 누락되어 분석을 중단했습니다. 점수표의 학적 연결을 확인해 주세요.",
              );
            return row;
          }
          const snapshot = await getDocFromServer(
            doc(
              db,
              "users",
              segment(row.uid),
              PERFORMANCE_SCORE_USER_COLLECTION,
              segment(id),
            ),
          );
          if (!snapshot.exists()) {
            if (hasEnteredPerformanceScore(row))
              throw new Error(
                "학생별 점수 저장이 완료되지 않았습니다. 점수 등록 및 확인에서 저장 상태를 확인해 주세요.",
              );
            return row;
          }
          const score = snapshot.data() as PerformanceScoreRecord;
          if (
            score.uid !== row.uid ||
            score.rosterId !== id ||
            score.scoreKind !== WRITTEN_EXAM_SCORE_KIND ||
            String(score.academicYear) !== String(roster.academicYear) ||
            String(score.semester) !== String(roster.semester) ||
            school(score.grade) !== school(row.grade) ||
            school(score.class) !== school(row.class) ||
            school(score.number) !== school(row.number) ||
            score.studentName?.normalize("NFC").replace(/\s/g, "") !==
              row.studentName?.normalize("NFC").replace(/\s/g, "")
          )
            throw new Error(
              "학생별 점수의 학기 또는 학적 연결이 달라 분석을 중단했습니다. 점수표를 확인해 주세요.",
            );
          score.items = (score.items || []).map((item) =>
            withLegacyEssaySection(
              item,
              score.scoreContentKind || roster.scoreContentKind,
            ),
          );
          const answers = (score.items || []).filter(objective);
          const expectedAnswers =
            answers.length > 0 ||
            ((score.scoreContentKind === "objective" ||
              score.scoreContentKind === "mixed") &&
              hasEnteredPerformanceScore(score));
          if (expectedAnswers) {
            const byNumber = new Map(
              answers.map((item) => [Number(item.questionNumber), item]),
            );
            if (
              answers.length !== questions.length ||
              byNumber.size !== answers.length ||
              questions.some((question) => {
                const item = byNumber.get(question.number);
                return (
                  !item ||
                  choice(item.correctAnswer) !== question.answer ||
                  Number(item.maxScore) !== question.points ||
                  !Number.isFinite(item.score) ||
                  item.score < 0 ||
                  item.score > item.maxScore
                );
              })
            )
              throw new Error(
                "학생별 문항 답안이 누락되었거나 점수표의 정답·배점과 다릅니다. 점수 등록 및 확인에서 저장 상태를 확인해 주세요.",
              );
            if (
              answers.some((item) => item.scoreEntered !== false) &&
              answers.some((item) => item.scoreEntered === false)
            )
              throw new Error(
                "일부 문항의 점수가 미입력 상태입니다. 점수 등록을 완료한 뒤 분석해 주세요.",
              );
          }
          return {
            ...row,
            items: score.items,
            enteredScoreCount: score.enteredScoreCount,
            totalScore: score.totalScore,
            totalMaxScore: score.totalMaxScore,
            feedback: score.feedback,
            evidence: score.evidence,
          };
        }),
      )),
    );
  }
  const participants = hydrated.filter((row) =>
    (row.items || []).some(
      (item) =>
        objective(item) &&
        item.scoreEntered !== false &&
        Number.isFinite(item.score),
    ),
  );
  const students = studentsFromScoreRoster(
    { ...roster, rows: participants },
    questions,
  );
  const { year, semester } = getYearSemester(config);
  const metadata: WrittenExamAnalysisMetadata = {
    ...materials,
    id,
    schemaVersion: 1,
    year,
    semester,
    title: roster.title,
    grade: school(roster.targetGrade),
    examDate: materials?.examDate || "",
    revision: materials?.revision || "scores",
    classIds: scoreSourceClasses(roster),
    studentCount: students.length,
    questions,
    crops: materials?.crops || [],
    files: materials?.files || [],
    updatedBy: materials?.updatedBy || "",
    updatedAt: roster.updatedAt,
  };
  return {
    metadata,
    students,
    hasObjectiveScores: roster.items.some(objective),
    scoreRows: hydrated,
    scoreItems: roster.items,
  };
}

/** Keep only paper metadata/assets. Student responses remain exclusively in the score ledger. */
export async function saveWrittenExamScoreMaterials(
  config: Config,
  input: Omit<WrittenExamAnalysisSaveInput, "students" | "title" | "grade"> & {
    examId: string;
  },
) {
  const roster = await loadWrittenExamScoreRoster(config, input.examId);
  const questions = mergeScoreSourceQuestions(
    questionsFromScoreSource(roster),
    input.questions,
  );
  return saveWrittenExamAnalysis(
    config,
    {
      ...input,
      questions,
      title: roster.title,
      grade: school(roster.targetGrade),
      students: studentsFromScoreRoster(roster, questions),
    },
    { materialsOnly: true },
  );
}
