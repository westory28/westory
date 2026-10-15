import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  buildQuizAnalysis,
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
  semesterId,
  loading,
  errors,
  legacyLimited,
  canEdit,
  onEdit,
  onDerive,
  onReload,
}: {
  questions: Question[];
  tree: TreeUnit[];
  students: QuizAnalysisStudent[];
  records: QuizAnalysisRecord[];
  snapshots: QuizReviewSnapshots;
  semesterId: string;
  loading: boolean;
  errors: string[];
  legacyLimited: boolean;
  canEdit: boolean;
  onEdit: (question: Question) => void;
  onDerive?: (question: QuizQuestionDraft) => void;
  onReload: () => void;
}) {
  const [assessmentKey, setAssessmentKey] = useState("");
  const [classId, setClassId] = useState("");
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
    const unitOrder = [...labels.keys()];
    return [...found.values()].sort(
      (a, b) =>
        b.latestMs - a.latestMs ||
        (unitOrder.indexOf(a.unitId) < 0 ? 9999 : unitOrder.indexOf(a.unitId)) -
          (unitOrder.indexOf(b.unitId) < 0
            ? 9999
            : unitOrder.indexOf(b.unitId)) ||
        a.key.localeCompare(b.key, "ko", { numeric: true }),
    );
  }, [records, questions, labels]);
  useEffect(() => {
    if (loading) return;
    if (
      !assessmentKey ||
      !assessments.some((item) => item.key === assessmentKey)
    )
      setAssessmentKey(assessments[0]?.key || "");
  }, [assessments, assessmentKey, loading]);
  const assessment = assessments.find((item) => item.key === assessmentKey);
  const classes = [
    ...new Set(
      students
        .map((student) => student.classId)
        .filter((id): id is string => !!id),
    ),
  ].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
  useEffect(() => {
    if (!loading && classId && !classes.includes(classId)) setClassId("");
  }, [loading, classId, classes]);
  const scopedQuestions = useMemo(
    () =>
      questions.filter(
        (q) =>
          !assessment ||
          (q.unitId === assessment.unitId &&
            normalizeMockExamCategory(q.category) === assessment.category),
      ),
    [questions, assessment],
  );
  const analysis = useMemo(
    () =>
      buildQuizAnalysis({
        semesterId,
        students,
        questions: scopedQuestions,
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
      scopedQuestions,
      records,
      assessment,
      classId,
      errors,
    ],
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
  }, [assessmentKey, classId, view, search, sort]);
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
        <label className="qa-assessment-filter">
          평가
          <select
            aria-label="분석할 평가"
            value={assessmentKey}
            onChange={(e) => setAssessmentKey(e.target.value)}
            disabled={!assessments.length}
          >
            <option value="" disabled>
              평가 선택
            </option>
            {assessments.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          학급
          <select
            aria-label="분석할 학급"
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
          >
            <option value="">전체 학급</option>
            {classes.map((id) => (
              <option key={id} value={id}>
                {classLabel(id)}
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
                <h3>최근 평가 점수</h3>
                <InfoHelp label="최근 평가 점수 집계 기준">
                  선택한 평가의 학생별 최근 제출 점수입니다. 다른 평가의 점수를
                  합치지 않습니다. 점수나 제출 순서를 확인할 수 없는 기록은
                  제외합니다.
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
                <h3>문항 정답률</h3>
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
                              ? `${classLabel(student.classId)} `
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
                            : "기록 없음"}
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
                  <div className="qa-section-head">
                    <h4>응답 분포</h4>
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
}: {
  student: QuizAnalysisStudentRow;
  questions: Question[];
  snapshots: QuizReviewSnapshots;
  onOpenQuestion: (id: string) => void;
}) {
  const record = student.latestRecord;
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
            {record.items.map((item, index) => {
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
