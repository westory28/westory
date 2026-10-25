import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  buildQuizAnalysis,
  buildQuizItemStatistics,
  type QuizAnalysisRecord,
  type QuizAnalysisStudent,
  type QuizAnalysisStudentRow,
} from "../../../lib/quizAnalysis";
import {
  DEFAULT_MOCK_EXAM_ROUND,
  formatMockExamRoundLabel,
  normalizeMockExamCategory,
  normalizeMockExamRound,
} from "../../../lib/mockExamRounds";
import QuizPassage from "../../../components/common/QuizPassage";
import InfoHelp from "../../../components/common/InfoHelp";
import QuizItemStatistics from "./QuizItemStatistics";
import type { Question, TreeUnit } from "./QuizBankTab";
import type { QuizQuestionDraft } from "./QuizEditor";
import type { QuizReviewSnapshots } from "./useQuizAnalysisData";
import "./QuizAnalysis.css";

type Assessment = {
  key: string;
  unitId: string;
  category: string;
  examRound: string;
  label: string;
  latestMs: number;
};
const classLabel = (id: string) => {
  const [grade, room] = id.split("-");
  return room
    ? `${grade === "unknown" ? "학년 미등록" : `${grade}학년`} ${room}반`
    : `${id}반`;
};
const categoryName = (value: string) =>
  ({ diagnostic: "진단평가", formative: "형성평가", exam_prep: "모의고사" })[
    value
  ] || "평가";
const typeName = (value: string) =>
  ({
    choice: "객관식",
    ox: "O/X",
    word: "단답형",
    short: "단답형",
    order: "순서",
    matching: "연결",
  })[value] || "문항";
const answerLabel = (value: unknown, type?: string) =>
  String(value ?? "")
    .replace(/\|\|/g, type === "order" ? " → " : " · ")
    .replace(/=>/g, " ↔ ");
const scoreLabel = (value: number | null) =>
  value === null ? "—" : `${Math.round(value)}점`;
const noScore = (row: QuizAnalysisStudentRow) =>
  ({
    no_attempt: "기록 없음",
    missing_score: "점수 미보관",
    chronology_unknown: "최근 기록 확인 불가",
    partial_scope: "선택 범위 점수 없음",
  })[row.scoreUnavailableReason || "no_attempt"] || "";
const timestampMs = (value: unknown) => {
  const v = value as any;
  const result =
    typeof v?.toMillis === "function"
      ? v.toMillis()
      : typeof v?.seconds === "number"
        ? v.seconds * 1000
        : typeof v === "string"
          ? Date.parse(v)
          : typeof v === "number"
            ? v
            : NaN;
  return Number.isFinite(result) ? result : 0;
};
const dateLabel = (value: unknown) => {
  const v = value as any;
  const date = new Date(
    typeof v?.toMillis === "function"
      ? v.toMillis()
      : typeof v?.seconds === "number"
        ? v.seconds * 1000
        : typeof v === "string" || typeof v === "number"
          ? v
          : NaN,
  );
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("ko-KR", {
        month: "numeric",
        day: "numeric",
      }).format(date)
    : "날짜 미보관";
};

export default function QuizAnalysisView({
  questions,
  tree,
  students,
  records,
  snapshots,
  configuredClasses = [],
  semesterId,
  loading,
  errors,
  legacyLimited,
  canEdit,
  onEdit,
  onDerive,
  onReload,
  lockedScope,
}: {
  questions: Question[];
  tree: TreeUnit[];
  students: QuizAnalysisStudent[];
  records: QuizAnalysisRecord[];
  snapshots: QuizReviewSnapshots;
  configuredClasses?: Array<{ id: string; label: string }>;
  semesterId: string;
  loading: boolean;
  errors: string[];
  legacyLimited: boolean;
  canEdit: boolean;
  onEdit: (question: Question) => void;
  onDerive?: (question: QuizQuestionDraft) => void;
  onReload: () => void;
  lockedScope?: {
    unitId: string;
    category: string;
    examRound: string;
    classId: string;
  };
}) {
  const [assessmentKey, setAssessmentKey] = useState(
    lockedScope
      ? JSON.stringify([
          lockedScope.unitId,
          lockedScope.category,
          lockedScope.examRound,
        ])
      : "",
  );
  const [unitId, setUnitId] = useState(lockedScope?.unitId || "");
  const [subUnitId, setSubUnitId] = useState("");
  const [classId, setClassId] = useState(lockedScope?.classId || "");
  const [submissionFilter, setSubmissionFilter] = useState("all");
  const [view, setView] = useState<"questions" | "students">("questions");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("default");
  const [page, setPage] = useState(1);
  const [selectedQuestionId, setSelectedQuestionId] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const detailRef = useRef<HTMLElement>(null);
  const labels = useMemo(() => {
    const result = new Map<string, string>();
    const visit = (nodes: TreeUnit[]) =>
      nodes.forEach((node) => {
        result.set(node.id, node.title);
        if (node.children) visit(node.children);
      });
    visit(tree);
    return result;
  }, [tree]);
  const assessments = useMemo(() => {
    const found = new Map<string, Assessment>();
    const add = (
      unitId: string,
      category: string,
      examRound = "",
      submittedAt?: unknown,
    ) => {
      if (!unitId || !category) return;
      const normalized = normalizeMockExamCategory(category);
      const round =
        normalized === "exam_prep"
          ? normalizeMockExamRound(examRound, DEFAULT_MOCK_EXAM_ROUND)
          : "";
      const key = JSON.stringify([unitId, normalized, round]);
      if (!found.has(key))
        found.set(key, {
          key,
          latestMs: timestampMs(submittedAt),
          unitId,
          category: normalized,
          examRound: round,
          label: `${labels.get(unitId) || (normalized === "exam_prep" ? "전 범위" : "단원명 미등록")} · ${categoryName(normalized)}${round ? ` · ${formatMockExamRoundLabel(round)}` : ""}`,
        });
      else
        found.get(key)!.latestMs = Math.max(
          found.get(key)!.latestMs,
          timestampMs(submittedAt),
        );
    };
    records.forEach((record) =>
      add(
        record.unitId || "",
        record.category || "",
        record.examRound,
        record.submittedAt,
      ),
    );
    questions.forEach((question) => {
      if (
        question.category !== "exam_prep" ||
        ![...found.values()].some(
          (item) =>
            item.category === "exam_prep" && item.unitId === question.unitId,
        )
      )
        add(question.unitId, question.category);
    });
    if (lockedScope)
      add(lockedScope.unitId, lockedScope.category, lockedScope.examRound);
    const unitOrder = [...labels.keys()];
    return [...found.values()]
      .filter(
        (item) =>
          !lockedScope ||
          (item.unitId === lockedScope.unitId &&
            item.category === lockedScope.category &&
            item.examRound === lockedScope.examRound),
      )
      .sort(
        (a, b) =>
          b.latestMs - a.latestMs ||
          (unitOrder.indexOf(a.unitId) < 0
            ? 9999
            : unitOrder.indexOf(a.unitId)) -
            (unitOrder.indexOf(b.unitId) < 0
              ? 9999
              : unitOrder.indexOf(b.unitId)) ||
          a.key.localeCompare(b.key, "ko", { numeric: true }),
      );
  }, [records, questions, labels, lockedScope]);
  const unitOptions = useMemo(() => {
    const units = new Map<
      string,
      { id: string; label: string; children: TreeUnit[] }
    >();
    tree.forEach((big) =>
      big.children?.forEach((mid) =>
        units.set(mid.id, {
          id: mid.id,
          label: `${big.title} · ${mid.title}`,
          children: mid.children || [],
        }),
      ),
    );
    assessments.forEach((item) => {
      if (!units.has(item.unitId))
        units.set(item.unitId, {
          id: item.unitId,
          label:
            item.category === "exam_prep"
              ? "모의고사 · 전 범위"
              : labels.get(item.unitId) || "단원명 미등록",
          children: [],
        });
    });
    return [...units.values()];
  }, [tree, assessments, labels]);
  const availableAssessments = useMemo(
    () => assessments.filter((item) => !unitId || item.unitId === unitId),
    [assessments, unitId],
  );
  useEffect(() => {
    if (
      !loading &&
      (!unitId || !unitOptions.some((unit) => unit.id === unitId))
    )
      setUnitId(assessments[0]?.unitId || unitOptions[0]?.id || "");
  }, [loading, unitId, unitOptions, assessments]);
  useEffect(() => {
    if (loading) return;
    if (
      !assessmentKey ||
      !availableAssessments.some((item) => item.key === assessmentKey)
    )
      setAssessmentKey(availableAssessments[0]?.key || "");
  }, [availableAssessments, assessmentKey, loading]);
  const assessment = availableAssessments.find(
    (item) => item.key === assessmentKey,
  );
  const subUnits =
    unitOptions.find((unit) => unit.id === unitId)?.children || [];
  const classes = useMemo(
    () =>
      [
        ...new Set([
          ...configuredClasses.map((item) => item.id),
          ...students
            .map((student) => student.classId)
            .filter((id): id is string => !!id),
        ]),
      ].sort((a, b) => a.localeCompare(b, "ko", { numeric: true })),
    [students, configuredClasses],
  );
  useEffect(() => {
    if (!lockedScope && !loading && classId && !classes.includes(classId))
      setClassId("");
  }, [loading, classId, classes, lockedScope]);
  const assessmentQuestions = useMemo(
    () =>
      questions.filter(
        (q) =>
          !!assessment &&
          q.unitId === assessment.unitId &&
          normalizeMockExamCategory(q.category) === assessment.category,
      ),
    [questions, assessment],
  );
  const questionSubUnit = (q: Question) => q.subUnitId || q.refSmall || "";
  const hasUnassignedQuestions = assessmentQuestions.some(
    (q) => !subUnits.some((unit) => unit.id === questionSubUnit(q)),
  );
  const scopedQuestions = useMemo(
    () =>
      assessmentQuestions.filter(
        (q) =>
          !subUnitId ||
          (subUnitId === "__unassigned__"
            ? !subUnits.some((unit) => unit.id === questionSubUnit(q))
            : questionSubUnit(q) === subUnitId),
      ),
    [assessmentQuestions, subUnitId, subUnits],
  );
  useEffect(() => {
    setSubUnitId("");
  }, [unitId]);
  const fullAnalysis = useMemo(
    () =>
      buildQuizAnalysis({
        semesterId,
        students,
        questions: assessmentQuestions,
        records,
        rosterAvailable: !errors.includes("학생 명단을 불러오지 못했습니다."),
        scope: {
          unitIds: assessment ? [assessment.unitId] : [],
          category: assessment?.category,
          examRound: assessment?.examRound,
          classId: classId || undefined,
        },
      }),
    [
      semesterId,
      students,
      assessmentQuestions,
      records,
      assessment,
      classId,
      errors,
    ],
  );
  const itemStatistics = useMemo(
    () =>
      buildQuizItemStatistics({
        semesterId,
        students,
        questions: assessmentQuestions,
        records,
        rosterAvailable: !errors.includes("학생 명단을 불러오지 못했습니다."),
        scope: {
          unitIds: assessment ? [assessment.unitId] : [],
          category: assessment?.category,
          examRound: assessment?.examRound,
          classId: classId || undefined,
        },
      }),
    [
      semesterId,
      students,
      assessmentQuestions,
      records,
      errors,
      assessment,
      classId,
    ],
  );
  const itemAnalysis = useMemo(
    () =>
      !subUnitId
        ? fullAnalysis
        : buildQuizAnalysis({
            semesterId,
            students,
            questions: scopedQuestions,
            records,
            rosterAvailable:
              !errors.includes("학생 명단을 불러오지 못했습니다."),
            scope: {
              unitIds: assessment ? [assessment.unitId] : [],
              category: assessment?.category,
              examRound: assessment?.examRound,
              classId: classId || undefined,
            },
          }),
    [
      subUnitId,
      fullAnalysis,
      semesterId,
      students,
      scopedQuestions,
      records,
      errors,
      assessment,
      classId,
    ],
  );
  // A randomly drawn assessment may contain no question from this subunit.
  // Submission status and the overall score still belong to the whole assessment.
  const analysis = useMemo(
    () => ({
      ...fullAnalysis,
      questions: itemAnalysis.questions,
      students: itemAnalysis.students,
    }),
    [fullAnalysis, itemAnalysis],
  );
  const submissionDataAvailable = !errors.some((error) =>
    error.includes("평가 기록을 불러오지 못했습니다."),
  );
  const byQuestion = new Map(analysis.questions.map((row) => [row.id, row]));
  const selectedQuestion = scopedQuestions.find(
    (q) => String(q.id) === selectedQuestionId,
  );
  const questionStat = selectedQuestion
    ? byQuestion.get(String(selectedQuestion.id))
    : undefined;
  const selectedStudent = analysis.students.find(
    (student) => student.uid === selectedStudentId,
  );
  const visibleQuestions = scopedQuestions
    .filter((q) =>
      [q.question, q.passage, ...(q.concepts || [])]
        .join(" ")
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
    )
    .sort((a, b) =>
      sort === "rate"
        ? (byQuestion.get(String(a.id))?.correctRate ?? 101) -
          (byQuestion.get(String(b.id))?.correctRate ?? 101)
        : sort === "responses"
          ? (byQuestion.get(String(b.id))?.assessedStudentCount || 0) -
            (byQuestion.get(String(a.id))?.assessedStudentCount || 0)
          : 0,
    );
  const visibleStudents = analysis.students
    .filter(
      (student) =>
        submissionFilter === "all" ||
        !submissionDataAvailable ||
        (submissionFilter === "submitted"
          ? student.attemptCount > 0
          : student.attemptCount === 0),
    )
    .filter((student) =>
      `${student.classId} ${student.number} ${student.name}`.includes(search),
    )
    .sort((a, b) =>
      sort === "score"
        ? (a.latestScore ?? 101) - (b.latestScore ?? 101)
        : String(a.classId || "").localeCompare(String(b.classId || ""), "ko", {
            numeric: true,
          }) ||
          String(a.number || "").localeCompare(String(b.number || ""), "ko", {
            numeric: true,
          }),
    );
  const size = 20,
    total =
      view === "questions" ? visibleQuestions.length : visibleStudents.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  useEffect(() => {
    setPage(1);
    setSelectedQuestionId("");
    setSelectedStudentId("");
  }, [assessmentKey, subUnitId, classId, submissionFilter, view, search, sort]);
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);
  const openQuestion = (id: string) => {
    setSelectedQuestionId(id);
    setSelectedStudentId("");
    requestAnimationFrame(() => detailRef.current?.focus());
  };
  const openStudent = (id: string) => {
    setSelectedStudentId(id);
    setSelectedQuestionId("");
    requestAnimationFrame(() => detailRef.current?.focus());
  };
  const rateRows = analysis.questions
    .filter((row) => row.correctRate !== null)
    .sort((a, b) => (a.correctRate || 0) - (b.correctRate || 0))
    .slice(0, 8);
  const maxHistogram = Math.max(
    1,
    ...analysis.scoreHistogram.map((bucket) => bucket.count),
  );
  const revisionMissing = analysis.questions.reduce(
    (sum, row) => sum + row.revisionUnknownCount + row.revisionExcludedCount,
    0,
  );
  if (!loading && !assessments.length)
    return (
      <section className="quiz-analysis" aria-label="평가 분석">
        {errors.length ? (
          <div className="qa-error" role="alert">
            {errors.join(" ")}{" "}
            <button type="button" onClick={onReload}>
              다시 시도
            </button>
          </div>
        ) : (
          <div className="qa-empty">등록된 평가가 없습니다.</div>
        )}
      </section>
    );
  return (
    <section className="quiz-analysis" aria-label="평가 분석">
      <div className="qa-filterbar">
        <label className="qa-unit-filter">
          중단원
          <select
            aria-label="분석할 중단원"
            value={unitId}
            onChange={(e) => {
              setUnitId(e.target.value);
              setSubUnitId("");
            }}
            disabled={!!lockedScope || loading || !unitOptions.length}
          >
            <option value="" disabled>
              단원 선택
            </option>
            {unitOptions.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.label}
              </option>
            ))}
          </select>
        </label>
        <label className="qa-assessment-filter">
          평가
          <select
            aria-label="분석할 평가"
            value={assessmentKey}
            onChange={(e) => setAssessmentKey(e.target.value)}
            disabled={!!lockedScope || loading || !availableAssessments.length}
          >
            <option value="" disabled>
              {availableAssessments.length ? "평가 선택" : "등록된 평가 없음"}
            </option>
            {availableAssessments.map((item) => (
              <option key={item.key} value={item.key}>
                {categoryName(item.category)}
                {item.examRound
                  ? ` · ${formatMockExamRoundLabel(item.examRound)}`
                  : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="qa-subunit-filter">
          소단원
          <select
            aria-label="분석할 소단원"
            value={subUnitId}
            onChange={(e) => setSubUnitId(e.target.value)}
            disabled={loading || (!subUnits.length && !hasUnassignedQuestions)}
          >
            <option value="">전체 소단원</option>
            {subUnits.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.title}
              </option>
            ))}
            {hasUnassignedQuestions && (
              <option value="__unassigned__">소단원 미지정</option>
            )}
          </select>
        </label>
        <label>
          학급
          <select
            aria-label="분석할 학급"
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            disabled={
              !!lockedScope ||
              loading ||
              errors.includes("학생 명단을 불러오지 못했습니다.")
            }
          >
            {!lockedScope && <option value="">전체 학급</option>}
            {classes.map((id) => (
              <option key={id} value={id}>
                {configuredClasses.find((item) => item.id === id)?.label ||
                  classLabel(id)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={onReload} disabled={loading}>
          새로고침
        </button>
        {!canEdit && <span className="qa-muted">읽기 전용</span>}
      </div>
      {errors.length > 0 && (
        <div role="alert" className="qa-error">
          {errors.join(" ")}{" "}
          <button type="button" onClick={onReload}>
            다시 시도
          </button>
        </div>
      )}
      {loading ? (
        <div role="status" className="qa-empty">
          평가 자료를 불러오는 중입니다.
        </div>
      ) : !assessment ? (
        <p className="qa-empty">이 중단원에는 등록된 평가가 없습니다.</p>
      ) : (
        <>
          <div className="qa-summaryline">
            <span>
              문항 <strong>{scopedQuestions.length}</strong>개
            </span>
            <span>
              제출 기록 <strong>{analysis.participantCount}</strong>명
            </span>
            {legacyLimited && (
              <span className="qa-muted">이전 기록 최근 500개 포함</span>
            )}
            {(legacyLimited ||
              revisionMissing > 0 ||
              analysis.missingScoreStudentCount > 0 ||
              analysis.unlistedParticipantCount > 0) && (
              <InfoHelp label="분석 자료 범위">
                {legacyLimited
                  ? "이전 방식의 기록은 최근 500개까지 포함합니다. "
                  : ""}
                {analysis.unlistedParticipantCount > 0
                  ? `학생 명단에 없는 제출 ${analysis.unlistedParticipantCount}명은 전체 집계에만 포함합니다. `
                  : ""}
                현재 문항과 같은 버전의 최근 응답만 문항 정답률에 포함합니다.
                버전·점수·답안이 없는 기록은 해당 집계에서 제외합니다.
              </InfoHelp>
            )}
          </div>
          <div className="qa-charts">
            <section
              className="qa-chart"
              aria-label="학생별 최근 평가 점수 분포"
            >
              <div className="qa-section-head">
                <h3>최근 제출 점수</h3>
                <InfoHelp label="최근 평가 점수 집계 기준">
                  선택한 평가의 학생별 최근 제출 점수입니다. 다른 평가의 점수를
                  합치지 않습니다. 점수나 제출 순서를 확인할 수 없는 기록은
                  제외합니다. 소단원 필터는 문항 결과에만 적용하며, 점수와 제출
                  여부는 선택한 평가 전체를 기준으로 합니다. 학급은 현재 학생
                  명단의 반을 기준으로 구분합니다.
                </InfoHelp>
              </div>
              {analysis.scoredStudentCount > 0 ? (
                <>
                  <div className="qa-chart-summary">
                    평균 <strong>{scoreLabel(analysis.averageScore)}</strong>
                    <span>{analysis.scoredStudentCount}명</span>
                  </div>
                  <div
                    className="qa-histogram"
                    role="img"
                    aria-label={analysis.scoreHistogram
                      .map((bucket) => `${bucket.label} ${bucket.count}명`)
                      .join(", ")}
                  >
                    {analysis.scoreHistogram.map((bucket) => (
                      <div className="qa-histogram-column" key={bucket.label}>
                        <span>{bucket.count}명</span>
                        <div className="qa-histogram-track">
                          <div
                            style={{
                              height: `${(bucket.count / maxHistogram) * 100}%`,
                            }}
                          />
                        </div>
                        <span title={bucket.label}>
                          {bucket.lower}–{bucket.upper > 100 ? "" : "<"}
                          {Math.min(bucket.upper, 100)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="qa-legend">
                    <span>
                      <i className="qa-key-blue" />
                      학생 수
                    </span>
                    <span>가로축: 점수</span>
                  </div>
                </>
              ) : (
                <p className="qa-empty">표시할 점수가 없습니다.</p>
              )}
            </section>
            <section className="qa-chart" aria-label="문항별 정답률">
              <div className="qa-section-head">
                <h3>정답률이 낮은 문항 · 최대 8개</h3>
                <InfoHelp label="문항 정답률 집계 기준">
                  현재 문항과 같은 버전에 응답한 학생별 최근 결과입니다. 정답
                  학생 수를 정오답이 확인된 학생 수로 나눕니다. 낮은 정답률부터
                  최대 8문항을 표시합니다.
                </InfoHelp>
              </div>
              {rateRows.length ? (
                <>
                  <div className="qa-rate-list">
                    {rateRows.map((row) => {
                      const q = scopedQuestions.find(
                        (q) => String(q.id) === row.id,
                      );
                      return (
                        <button
                          type="button"
                          key={row.id}
                          className="qa-rate-row"
                          onClick={() => openQuestion(row.id)}
                        >
                          <span className="qa-chart-label">
                            {q?.question || "문항 원문 없음"}
                          </span>
                          <span className="qa-rate-track">
                            <span style={{ width: `${row.correctRate}%` }} />
                          </span>
                          <strong>
                            {Math.round(row.correctRate || 0)}%{" "}
                            <small>
                              {row.correctCount}/{row.assessedStudentCount}명
                            </small>
                          </strong>
                        </button>
                      );
                    })}
                  </div>
                  <div className="qa-legend">
                    <span>
                      <i className="qa-key-blue" />
                      정답
                    </span>
                    <span>
                      <i className="qa-key-gray" />
                      오답
                    </span>
                  </div>
                </>
              ) : (
                <p className="qa-empty">현재 문항 버전의 응답이 없습니다.</p>
              )}
            </section>
          </div>
          <div className="qa-listbar">
            <div role="group" aria-label="분석 대상" className="qa-switch">
              <button
                type="button"
                aria-pressed={view === "questions"}
                onClick={() => {
                  setView("questions");
                  setSort("default");
                  setSearch("");
                }}
              >
                문항
              </button>
              <button
                type="button"
                aria-pressed={view === "students"}
                onClick={() => {
                  setView("students");
                  setSort("default");
                  setSearch("");
                }}
              >
                학생
              </button>
            </div>
            {view === "students" && (
              <label className="qa-submission-filter">
                <span className="qa-filter-label">
                  응시 상태{" "}
                  <InfoHelp label="응시 상태 구분 기준">
                    선택한 평가에 제출 기록이 있으면 응시 완료로 구분합니다.
                    미응시·미제출에는 아직 시작하지 않았거나 풀이 중인 학생이
                    포함됩니다. 소단원 필터로 미응시 여부를 바꾸지 않습니다.
                  </InfoHelp>
                </span>
                <select
                  aria-label="학생 응시 상태"
                  value={submissionFilter}
                  disabled={!submissionDataAvailable}
                  onChange={(e) => setSubmissionFilter(e.target.value)}
                >
                  <option value="all">전체 학생</option>
                  <option value="submitted">응시 완료</option>
                  <option value="not_submitted">미응시·미제출</option>
                </select>
              </label>
            )}
            <label className="qa-search">
              <span className="sr-only">
                {view === "questions" ? "문항·개념 검색" : "학생 검색"}
              </span>
              <input
                type="search"
                aria-label={
                  view === "questions" ? "문항·개념 검색" : "학생 검색"
                }
                placeholder={
                  view === "questions" ? "문항·개념 검색" : "학생 검색"
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label>
              <span className="sr-only">정렬</span>
              <select
                aria-label="분석 목록 정렬"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="default">
                  {view === "questions" ? "기본순" : "반·번호순"}
                </option>
                {view === "questions" ? (
                  <>
                    <option value="rate">정답률 낮은 순</option>
                    <option value="responses">응답 학생 많은 순</option>
                  </>
                ) : (
                  <option value="score">최근 점수 낮은 순</option>
                )}
              </select>
            </label>
          </div>
          <div className="qa-list-count" role="status">
            {view === "questions" ? `문항 ${total}개` : `학생 ${total}명`}
          </div>
          <div
            className="qa-table-region"
            role="region"
            aria-label={
              view === "questions" ? "문항 분석 목록" : "학생 분석 목록"
            }
            tabIndex={0}
          >
            {view === "questions" ? (
              <table className="qa-table">
                <thead>
                  <tr>
                    <th>문항</th>
                    <th>유형</th>
                    <th>정답률</th>
                    <th>응답</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleQuestions
                    .slice((page - 1) * size, page * size)
                    .map((q) => {
                      const stat = byQuestion.get(String(q.id));
                      return (
                        <tr
                          key={q.docId}
                          className={
                            selectedQuestionId === String(q.id)
                              ? "is-selected"
                              : ""
                          }
                        >
                          <td>
                            <button
                              type="button"
                              className="qa-text-button"
                              onClick={() => openQuestion(String(q.id))}
                            >
                              {q.question || "발문 미등록"}
                            </button>
                            <span className="qa-row-meta">
                              {labels.get(questionSubUnit(q)) ||
                                "소단원 미지정"}
                            </span>
                            {!!q.concepts?.length && (
                              <span className="qa-row-meta">
                                {q.concepts.join(" · ")}
                              </span>
                            )}
                          </td>
                          <td>{typeName(q.type)}</td>
                          <td>
                            {stat?.correctRate == null ? (
                              "—"
                            ) : (
                              <>
                                <strong>{Math.round(stat.correctRate)}%</strong>
                                <span className="qa-row-meta">
                                  {stat.correctCount}/
                                  {stat.assessedStudentCount}명
                                </span>
                              </>
                            )}
                          </td>
                          <td>
                            {stat?.assessedStudentCount
                              ? `${stat.assessedStudentCount}명`
                              : stat?.attemptedStudentCount
                                ? "결과 미확인"
                                : "기록 없음"}
                            {!!stat?.revisionUnknownCount && (
                              <span className="qa-row-meta">
                                버전 미확인 {stat.revisionUnknownCount}명
                              </span>
                            )}
                            {!!stat?.revisionExcludedCount && (
                              <span className="qa-row-meta">
                                이전 버전 기록 {stat.revisionExcludedCount}명
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            ) : (
              <table className="qa-table">
                <thead>
                  <tr>
                    <th>학생</th>
                    <th>최근 점수</th>
                    <th>
                      문항 결과
                      <InfoHelp label="학생 문항 결과 기준">
                        현재 문항과 같은 버전의 학생별 최근 결과입니다. 정답
                        수/정오답이 확인된 문항 수로 표시합니다.
                      </InfoHelp>
                    </th>
                    <th>제출</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleStudents
                    .slice((page - 1) * size, page * size)
                    .map((student) => (
                      <tr
                        key={student.uid}
                        className={
                          selectedStudentId === student.uid ? "is-selected" : ""
                        }
                      >
                        <td>
                          <button
                            type="button"
                            className="qa-text-button"
                            onClick={() => openStudent(student.uid)}
                          >
                            {student.classId
                              ? `${configuredClasses.find((entry) => entry.id === student.classId)?.label || classLabel(student.classId)} `
                              : ""}
                            {student.number ? `${student.number}번 ` : ""}
                            {student.name || "이름 미등록"}
                          </button>
                        </td>
                        <td>
                          <strong>{scoreLabel(student.latestScore)}</strong>
                          {student.latestScore === null && (
                            <span className="qa-row-meta">
                              {noScore(student)}
                            </span>
                          )}
                        </td>
                        <td>
                          {student.assessedQuestionCount
                            ? `${student.correctCount}/${student.assessedQuestionCount}`
                            : "—"}
                        </td>
                        <td>
                          {student.attemptCount
                            ? `${student.attemptCount}회`
                            : submissionDataAvailable
                              ? "미응시·미제출"
                              : "확인 불가"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
            {!total && (
              <p className="qa-empty">
                {view === "students" &&
                errors.includes("학생 명단을 불러오지 못했습니다.")
                  ? "학생 명단을 확인할 수 없습니다."
                  : "조건에 맞는 자료가 없습니다."}
              </p>
            )}
          </div>
          {pageCount > 1 && (
            <nav className="qa-pagination" aria-label="분석 목록 페이지">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                이전
              </button>
              <span>
                {page} / {pageCount}
              </span>
              <button
                type="button"
                disabled={page >= pageCount}
                onClick={() => setPage((value) => value + 1)}
              >
                다음
              </button>
            </nav>
          )}
          {(selectedQuestion || selectedStudent) && (
            <section
              className="qa-detail"
              ref={detailRef}
              tabIndex={-1}
              aria-label={selectedQuestion ? "문항 상세" : "학생 상세"}
            >
              <div className="qa-section-head">
                <h3>
                  {selectedQuestion
                    ? "문항 상세"
                    : `${selectedStudent?.name || "학생"} · 최근 제출`}
                </h3>
                <button
                  type="button"
                  className="qa-close"
                  onClick={() => {
                    setSelectedQuestionId("");
                    setSelectedStudentId("");
                  }}
                >
                  닫기
                </button>
              </div>
              {selectedQuestion && (
                <>
                  <div className="qa-detail-actions">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => onEdit(selectedQuestion)}
                      >
                        수정
                      </button>
                    )}
                    {canEdit && onDerive && (
                      <button
                        type="button"
                        onClick={() =>
                          onDerive({
                            ...selectedQuestion,
                            answer: String(selectedQuestion.answer ?? ""),
                            type: (selectedQuestion.type === "short"
                              ? "word"
                              : selectedQuestion.type) as QuizQuestionDraft["type"],
                          })
                        }
                      >
                        파생 문항 만들기
                      </button>
                    )}
                  </div>
                  <QuestionContent question={selectedQuestion} />
                  <QuizItemStatistics
                    key={`${selectedQuestion.id}:${assessmentKey}:${classId}`}
                    row={itemStatistics.questions.find(
                      (row) => row.id === String(selectedQuestion.id),
                    )}
                    summary={itemStatistics}
                    answer={String(selectedQuestion.answer ?? "")}
                  />
                  <div className="qa-section-head">
                    <h4>최근 답안 분포</h4>
                    <InfoHelp label="응답 분포 기준">
                      현재 문항 버전의 학생별 최근 답안입니다. 각 선택 비율의
                      분모는 비어 있지 않은 답안이 보관된 학생 수입니다. 정답률
                      분모와 다를 수 있습니다.
                    </InfoHelp>
                  </div>
                  {questionStat?.knownAnswerStudentCount ? (
                    <div className="qa-option-list">
                      {questionStat.optionDistribution.map((option) => (
                        <div className="qa-option-row" key={option.answer}>
                          <span>
                            {answerLabel(option.answer, selectedQuestion.type)}
                            {option.answer ===
                              String(selectedQuestion.answer) && (
                              <strong className="qa-answer-key">정답</strong>
                            )}
                          </span>
                          <div className="qa-option-track">
                            <div style={{ width: `${option.percent}%` }} />
                          </div>
                          <strong>
                            {option.count}명{" "}
                            <small>{Math.round(option.percent)}%</small>
                          </strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="qa-empty">보관된 답안이 없습니다.</p>
                  )}
                  <div className="qa-legend">
                    <span>
                      답안 {questionStat?.knownAnswerStudentCount || 0}명
                    </span>
                    {!!questionStat?.unansweredCount && (
                      <span>무응답 {questionStat.unansweredCount}명</span>
                    )}
                    {!!questionStat?.missingAnswerCount && (
                      <span>
                        답안 미보관 {questionStat.missingAnswerCount}명
                      </span>
                    )}
                  </div>
                </>
              )}
              {selectedStudent && (
                <StudentDetail
                  student={selectedStudent}
                  questions={scopedQuestions}
                  snapshots={snapshots}
                  onOpenQuestion={openQuestion}
                  filterQuestions={Boolean(subUnitId)}
                />
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}

function QuestionContent({ question }: { question: Partial<Question> }) {
  return (
    <div className="qa-question-content">
      <h4>{question.question || "원문 미보관"}</h4>
      {question.passage && <QuizPassage value={question.passage} />}{" "}
      {question.image && (
        <img
          className="qa-question-image"
          src={question.image}
          alt="문항 자료"
        />
      )}
      {!!question.options?.length && !question.matchingPairs?.length && (
        <ol className="qa-authored-options">
          {question.options.map((option, index) => (
            <li key={index}>
              <span>{option}</span>
              {question.choiceOptionImages?.[index] && (
                <img
                  src={question.choiceOptionImages[index]!}
                  alt={`${index + 1}번 보기 자료`}
                />
              )}
            </li>
          ))}
        </ol>
      )}
      {!!question.matchingPairs?.length && (
        <ol className="qa-authored-options">
          {question.matchingPairs.map((pair, index) => (
            <li key={index}>
              <span>
                {pair.left} ↔ {pair.right}
              </span>
              {pair.rightImage && (
                <img src={pair.rightImage} alt={`${index + 1}번 연결 자료`} />
              )}
            </li>
          ))}
        </ol>
      )}
      {question.hintEnabled && question.hint && (
        <details>
          <summary>힌트</summary>
          <p>{question.hint}</p>
        </details>
      )}
      {question.answer != null && (
        <p>
          <strong>정답</strong> {answerLabel(question.answer, question.type)}
        </p>
      )}
      {question.explanation && (
        <p className="qa-explanation">
          <strong>해설</strong> {question.explanation}
        </p>
      )}
    </div>
  );
}
function StudentDetail({
  student,
  questions,
  snapshots,
  onOpenQuestion,
  filterQuestions = false,
}: {
  student: QuizAnalysisStudentRow;
  questions: Question[];
  snapshots: QuizReviewSnapshots;
  onOpenQuestion: (id: string) => void;
  filterQuestions?: boolean;
}) {
  const record = student.latestRecord;
  const visibleItems =
    record?.items.filter(
      (item) =>
        !filterQuestions ||
        questions.some((q) => String(q.id) === String(item.questionId)),
    ) || [];
  return (
    <>
      {record ? (
        <>
          <div className="qa-summaryline">
            <span>{dateLabel(record.submittedAt)}</span>
            <strong>{scoreLabel(student.latestScore)}</strong>
          </div>
          {!!student.wrongConcepts.length && (
            <div className="qa-concepts">
              <h4>오답 문항의 개념</h4>
              {student.wrongConcepts.map((item) => (
                <span key={item.concept}>
                  {item.concept}{" "}
                  <strong>{item.wrongQuestionIds.length}문항</strong>
                </span>
              ))}
            </div>
          )}
          {student.changes.comparedQuestionCount > 0 && (
            <div className="qa-summaryline">
              <span>같은 문항 재응답</span>
              <span>
                오답 → 정답{" "}
                <strong>{student.changes.wrongToCorrectCount}</strong>문항
              </span>
              <span>
                정답 → 오답{" "}
                <strong>{student.changes.correctToWrongCount}</strong>문항
              </span>
              <InfoHelp label="재응답 비교 기준">
                현재 버전이 같은 문항의 처음과 최근 결과만 비교합니다. 반복
                문항의 정답 변화이며 학습 능력이나 성장을 확정하지 않습니다.
              </InfoHelp>
            </div>
          )}
          <div className="qa-student-answers">
            {filterQuestions && !visibleItems.length && (
              <p className="qa-empty">
                최근 제출에는 선택한 소단원의 문항이 없습니다.
              </p>
            )}
            {visibleItems.map((item, index) => {
              const q = questions.find(
                (q) => String(q.id) === String(item.questionId),
              );
              const snapshot =
                snapshots[`${record.source}:${record.id}`]?.[
                  String(item.questionId)
                ];
              return (
                <details key={`${item.questionId}-${index}`}>
                  <summary>
                    <span>
                      {index + 1}. {snapshot?.question || "원문 미보관"}
                    </span>
                    <strong>
                      {item.correct === true
                        ? "정답"
                        : item.correct === false
                          ? "오답"
                          : "결과 미보관"}
                    </strong>
                  </summary>
                  <div className="qa-student-answer-body">
                    {snapshot && <QuestionContent question={snapshot} />}
                    <p>
                      <strong>제출한 답</strong>{" "}
                      {item.answer == null
                        ? "답안 미보관"
                        : item.answer === ""
                          ? "무응답"
                          : answerLabel(item.answer, snapshot?.type)}
                    </p>
                    {q && (
                      <button
                        type="button"
                        onClick={() => onOpenQuestion(String(q.id))}
                      >
                        현재 문항 보기
                      </button>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </>
      ) : (
        <p className="qa-empty">{noScore(student)}</p>
      )}
    </>
  );
}
