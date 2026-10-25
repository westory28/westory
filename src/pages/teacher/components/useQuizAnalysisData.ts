import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import {
  getSemesterCollectionPath,
  getSemesterDocPath,
  getYearSemester,
} from "../../../lib/semesterScope";
import { getAssessmentSemesterId } from "../../../lib/assessmentRelease";
import {
  getResultMockExamRound,
  normalizeMockExamCategory,
} from "../../../lib/mockExamRounds";
import type {
  QuizAnalysisRecord,
  QuizAnalysisStudent,
} from "../../../lib/quizAnalysis";
import type { Question, TreeUnit } from "./QuizBankTab";

const LEGACY_LIMIT = 500;
const text = (value: unknown) => String(value ?? "").trim();
const numberLabel = (value: unknown) => text(value).match(/\d+/)?.[0] || "";
type RawRecord = {
  id: string;
  source: "canonical" | "legacy";
  raw: Record<string, any>;
};
export type QuizReviewSnapshots = Record<
  string,
  Record<string, Partial<Question>>
>;

/** Configured options include classes with no student accounts or submissions. */
export function quizAnalysisConfiguredClasses(raw: Record<string, any> | null) {
  const normalize = (values: unknown, suffix: string) => {
    const options = new Map<string, { value: string; label: string }>();
    for (const item of Array.isArray(values) ? values : []) {
      const value = text(item?.value ?? item?.label)
        .replace(/\s/g, "")
        .replace(/학년|반/g, "");
      if (!value || options.has(value)) continue;
      options.set(value, {
        value,
        label: text(item?.label) || `${value}${suffix}`,
      });
    }
    return [...options.values()];
  };
  const grades = normalize(raw?.grades, "학년");
  const classes = normalize(raw?.classes, "반");
  return grades
    .flatMap((grade) =>
      classes.map((entry) => ({
        id: `${grade.value}-${entry.value}`,
        label: `${grade.label} ${entry.label}`,
      })),
    )
    .sort((a, b) => a.id.localeCompare(b.id, "ko", { numeric: true }));
}

const legacyQuestionSnapshot = (
  item: Record<string, any>,
): Partial<Question> | null => {
  const saved =
    item.questionSnapshot && typeof item.questionSnapshot === "object"
      ? item.questionSnapshot
      : {};
  const result: Record<string, unknown> = {};
  const aliases: Record<string, unknown> = {
    question: saved.question ?? item.q ?? item.question,
    answer: saved.answer ?? item.a ?? item.correctAnswer,
    explanation: saved.explanation ?? item.exp ?? item.explanation,
  };
  for (const key of [
    "question",
    "answer",
    "explanation",
    "type",
    "passage",
    "image",
    "hint",
  ]) {
    const value = key in aliases ? aliases[key] : (saved[key] ?? item[key]);
    if (
      typeof value === "string" ||
      (key === "answer" && typeof value === "number")
    )
      result[key] = value;
  }
  const options = saved.options ?? item.options;
  if (Array.isArray(options))
    result.options = options.filter((value) => typeof value === "string");
  const images = saved.choiceOptionImages ?? item.choiceOptionImages;
  if (Array.isArray(images))
    result.choiceOptionImages = images.map((value) =>
      typeof value === "string" ? value : null,
    );
  const pairs = saved.matchingPairs ?? item.matchingPairs;
  if (Array.isArray(pairs))
    result.matchingPairs = pairs
      .filter(
        (pair) =>
          pair &&
          typeof pair.left === "string" &&
          typeof pair.right === "string",
      )
      .map((pair) => ({
        left: pair.left,
        right: pair.right,
        ...(typeof pair.rightImage === "string"
          ? { rightImage: pair.rightImage }
          : {}),
      }));
  if (typeof (saved.hintEnabled ?? item.hintEnabled) === "boolean")
    result.hintEnabled = saved.hintEnabled ?? item.hintEnabled;
  return Object.keys(result).length ? (result as Partial<Question>) : null;
};

export function adaptQuizAnalysisRecords(
  rows: RawRecord[],
  students: Array<QuizAnalysisStudent & { email?: string }>,
  semesterId: string,
) {
  const snapshots: QuizReviewSnapshots = {};
  const records: QuizAnalysisRecord[] = [];
  for (const { id, source, raw } of rows) {
    if (source === "canonical" && raw.assessmentKind !== "QUIZ") continue;
    const studentUid =
      text(raw.studentUid || raw.uid || raw.studentId || raw.userId) ||
      students.find(
        (student) =>
          student.email &&
          student.email === text(raw.email || raw.studentEmail),
      )?.uid ||
      "";
    if (!studentUid) continue;
    const parts = text(raw.definitionId).split(":");
    const rawCategory = text(raw.category || parts[3]);
    const category = normalizeMockExamCategory(rawCategory);
    const metadata = new Map<string, any>(
      (Array.isArray(raw.learningSnapshot) ? raw.learningSnapshot : []).map(
        (q: any) => [String(q.id), q],
      ),
    );
    snapshots[`${source}:${id}`] = Object.fromEntries(
      (Array.isArray(raw.questionSnapshots) ? raw.questionSnapshots : []).map(
        (q: any) => [String(q.id), q],
      ),
    );
    const details = source === "canonical" ? raw.answerChecks : raw.details;
    const items = (Array.isArray(details) ? details : []).flatMap(
      (item: any) => {
        const questionId = text(item.id ?? item.qid ?? item.questionId);
        if (!questionId) return [];
        const meta = metadata.get(questionId);
        if (source === "legacy" && !snapshots[`${source}:${id}`][questionId]) {
          const saved = legacyQuestionSnapshot(item);
          if (saved) snapshots[`${source}:${id}`][questionId] = saved;
        }
        // A canonical submission stores only answered keys. A present answer
        // map proves an absent key is an intentional non-answer; an absent or
        // malformed map does not prove what the student submitted.
        const answerMap =
          raw.answers &&
          typeof raw.answers === "object" &&
          !Array.isArray(raw.answers)
            ? raw.answers
            : null;
        const answer =
          source === "canonical"
            ? answerMap
              ? Object.prototype.hasOwnProperty.call(answerMap, questionId)
                ? answerMap[questionId]
                : ""
              : undefined
            : (item.u ?? item.userAnswer ?? item.answer);
        return [
          {
            questionId,
            correct: typeof item.correct === "boolean" ? item.correct : null,
            ...(answer == null ? {} : { answer: String(answer) }),
            sourceRevision: meta?.sourceRevision || item.sourceRevision,
            concepts: Array.isArray(meta?.concepts) ? meta.concepts : [],
            reviewLessonId: meta?.reviewLessonId,
          },
        ];
      },
    );
    const score = source === "canonical" ? raw.percent : raw.score;
    records.push({
      id,
      source,
      studentUid,
      semesterId: text(raw.semesterId) || semesterId,
      unitId: text(raw.sourceId || raw.unitId || parts[2]),
      category,
      examRound:
        category === "exam_prep"
          ? getResultMockExamRound(rawCategory, raw.examRound || parts[4])
          : "",
      submittedAt: raw.submittedAtIso || raw.timestamp || raw.createdAt,
      scorePercent:
        typeof score === "number" && Number.isFinite(score) ? score : null,
      items,
      analytics: raw.analytics,
      behaviorAnswersAvailable:
        typeof raw.behaviorAnswersAvailable === "boolean"
          ? raw.behaviorAnswersAvailable
          : Boolean(
              raw.answers &&
              typeof raw.answers === "object" &&
              !Array.isArray(raw.answers),
            ),
      attemptId: raw.attemptId,
      canonicalAttemptId: raw.canonicalAttemptId,
      submissionRef: raw.submissionRef,
      resultRef: raw.resultRef,
      resultId: raw.resultId,
      legacyResultId: raw.legacyResultId,
      totalCount: typeof raw.total === "number" ? raw.total : undefined,
      definitionId: text(raw.definitionId),
    });
  }
  return { records, snapshots };
}

export function useQuizAnalysisData(config: any) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [treeData, setTreeData] = useState<TreeUnit[]>([]);
  const [students, setStudents] = useState<
    Array<QuizAnalysisStudent & { email?: string }>
  >([]);
  const [rawRows, setRawRows] = useState<RawRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [legacyLimited, setLegacyLimited] = useState(false);
  const [configuredClasses, setConfiguredClasses] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [version, setVersion] = useState(0);
  const activeVersion = useRef(0);
  const semesterId = getAssessmentSemesterId(config);
  const { year, semester } = getYearSemester(config);
  useEffect(() => {
    const semesterConfig = { year, semester };
    const run = ++activeVersion.current;
    let active = true;
    const loaded = new Set<string>();
    const failures = new Map<string, string>();
    const sources: Record<string, RawRecord[]> = { legacy: [], canonical: [] };
    setLoading(true);
    setErrors([]);
    setQuestions([]);
    setStudents([]);
    setRawRows([]);
    setTreeData([]);
    setLegacyLimited(false);
    setConfiguredClasses([]);
    const finish = (key: string, error?: string) => {
      if (!active || activeVersion.current !== run) return;
      loaded.add(key);
      error ? failures.set(key, error) : failures.delete(key);
      setErrors([...failures.values()]);
      setLoading(loaded.size < 6);
    };
    void getDocs(
      collection(
        db,
        getSemesterCollectionPath(semesterConfig, "quiz_questions"),
      ),
    )
      .then((snapshot) => {
        if (!active) return;
        setQuestions(
          snapshot.docs.map(
            (item) =>
              ({
                ...item.data(),
                id: item.data().id ?? Number(item.id),
                docId: item.id,
                sourceRevision: String(
                  item.data().contentRevision ||
                    item.data().revision ||
                    "legacy",
                ),
              }) as Question,
          ),
        );
        finish("questions");
      })
      .catch(() => finish("questions", "문항을 불러오지 못했습니다."));
    void (async () => {
      try {
        const scoped = await getDoc(
          doc(db, getSemesterDocPath(semesterConfig, "curriculum", "tree")),
        );
        const source = scoped.exists()
          ? scoped
          : await getDoc(doc(db, "curriculum", "tree"));
        if (active)
          setTreeData(source.exists() ? source.data().tree || [] : []);
        finish("tree");
      } catch {
        finish("tree", "단원 목록을 불러오지 못했습니다.");
      }
    })();
    void getDoc(doc(db, "site_settings", "school_config"))
      .then((snapshot) => {
        if (!active) return;
        setConfiguredClasses(
          quizAnalysisConfiguredClasses(
            snapshot.exists() ? snapshot.data() : null,
          ),
        );
        finish("classes");
      })
      .catch(() => finish("classes", "학교 학급 설정을 불러오지 못했습니다."));
    void getDocs(collection(db, "users"))
      .then((snapshot) => {
        if (!active) return;
        setStudents(
          snapshot.docs.flatMap((item) => {
            const raw = item.data();
            if (raw.role && raw.role !== "student") return [];
            const classOnly = numberLabel(
              raw.studentClass || raw.class || raw.classOnly,
            );
            if (!classOnly) return [];
            const grade = numberLabel(raw.studentGrade || raw.grade);
            const classId = `${grade || "unknown"}-${classOnly}`;
            return [
              {
                uid: item.id,
                name:
                  text(raw.studentName || raw.name || raw.displayName) ||
                  "이름 미등록",
                classId,
                number: numberLabel(raw.studentNumber || raw.number),
                email: text(raw.email),
              },
            ];
          }),
        );
        finish("students");
      })
      .catch(() => finish("students", "학생 명단을 불러오지 못했습니다."));
    const listen = (source: "legacy" | "canonical") =>
      onSnapshot(
        source === "legacy"
          ? query(
              collection(
                db,
                getSemesterCollectionPath(semesterConfig, "quiz_results"),
              ),
              orderBy("timestamp", "desc"),
              limit(LEGACY_LIMIT),
            )
          : query(
              collection(db, "semester_assessment_results"),
              where("semesterId", "==", semesterId),
            ),
        (snapshot) => {
          if (!active) return;
          sources[source] = snapshot.docs.map((item) => ({
            id: item.id,
            source,
            raw: item.data(),
          }));
          if (source === "legacy")
            setLegacyLimited(snapshot.size >= LEGACY_LIMIT);
          setRawRows([...sources.canonical, ...sources.legacy]);
          finish(source);
        },
        () =>
          finish(
            source,
            source === "canonical"
              ? "새 평가 기록을 불러오지 못했습니다."
              : "이전 평가 기록을 불러오지 못했습니다.",
          ),
      );
    const unsubscribe = [listen("canonical"), listen("legacy")];
    return () => {
      active = false;
      unsubscribe.forEach((stop) => stop());
    };
  }, [year, semester, semesterId, version]);
  const { records, snapshots } = useMemo(
    () => adaptQuizAnalysisRecords(rawRows, students, semesterId),
    [rawRows, students, semesterId],
  );
  return {
    questions,
    setQuestions,
    treeData,
    students,
    records,
    snapshots,
    loading,
    errors,
    legacyLimited,
    configuredClasses,
    reload: () => setVersion((value) => value + 1),
  };
}
