import { useEffect, useMemo, useRef, useState } from "react";
import InfoHelp from "../../../components/common/InfoHelp";
import { useAuth } from "../../../contexts/AuthContext";
import { getAssessmentSemesterId } from "../../../lib/assessmentRelease";
import { formatMockExamRoundLabel } from "../../../lib/mockExamRounds";
import {
  getQuizClassCatalog,
  getQuizClassDetail,
  getQuizClassSummary,
  quizClassAnalysisError,
  type QuizClassCatalog,
  type QuizClassDetail,
  type QuizClassScope,
  type QuizClassSummary,
  type QuizClassSummaryResponse,
} from "../../../lib/quizClassAnalysis";
import type { QuizQuestionDraft } from "./QuizEditor";
import type { Question, TreeUnit } from "./QuizBankTab";
import QuizAnalysisView from "./QuizAnalysisView";
import { adaptQuizAnalysisRecords } from "./useQuizAnalysisData";
import "./QuizClassAnalysis.css";

const percent = (part: number, total: number) =>
  total ? Math.round((part / total) * 100) : 0;
const score = (value: number | null) =>
  value === null ? "—" : `${Math.round(value)}점`;
const categoryLabel = (value: string) =>
  ({ diagnostic: "진단평가", formative: "형성평가", exam_prep: "모의고사" })[
    value
  ] || "평가";
const assessmentLabel = (category: string, round: string) =>
  category === "exam_prep"
    ? formatMockExamRoundLabel(round)
    : categoryLabel(category);
const timeLabel = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("ko-KR", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Seoul",
      }).format(date)
    : "갱신 시각 확인 불가";
};

interface DetailState {
  classId: string;
  classLabel: string;
  scope: QuizClassScope;
  data: QuizClassDetail;
}

export default function QuizClassAnalysis({
  canEdit,
  onEdit,
  onDerive,
  onDetailData,
  editedQuestions,
  refreshVersion,
}: {
  canEdit: boolean;
  onEdit: (question: Question) => void;
  onDerive?: (question: QuizQuestionDraft) => void;
  onDetailData: (questions: Question[], tree: TreeUnit[]) => void;
  editedQuestions: Question[];
  refreshVersion: number;
}) {
  const { config, currentUser, authGeneration } = useAuth();
  const semesterId = getAssessmentSemesterId(config);
  const identityKey = `${currentUser?.uid || ""}:${authGeneration}:${semesterId}`;
  const identityRef = useRef(identityKey);
  identityRef.current = identityKey;
  const requestId = useRef(0);
  const detailRequestId = useRef(0);
  const [catalog, setCatalog] = useState<QuizClassCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [unitId, setUnitId] = useState("");
  const [assessmentId, setAssessmentId] = useState("");
  const [classId, setClassId] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [summary, setSummary] = useState<QuizClassSummaryResponse | null>(null);
  const [loadedScope, setLoadedScope] = useState<QuizClassScope | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [detailLoading, setDetailLoading] = useState("");
  const [detailError, setDetailError] = useState("");
  const detailRef = useRef<HTMLElement>(null);
  const detailOpeners = useRef(new Map<string, HTMLButtonElement>());
  const reloadVersion = useRef(refreshVersion);

  useEffect(() => {
    let active = true;
    ++requestId.current;
    ++detailRequestId.current;
    setCatalog(null);
    setCatalogLoading(true);
    setCatalogError("");
    setUnitId("");
    setAssessmentId("");
    setClassId("");
    setCompareIds([]);
    setComparisonOpen(false);
    setSummary(null);
    setLoadedScope(null);
    setDetail(null);
    setLoading(false);
    setDetailLoading("");
    setError("");
    setDetailError("");
    if (!currentUser) {
      setCatalogLoading(false);
      return () => {
        active = false;
      };
    }
    void getQuizClassCatalog(semesterId, identityKey)
      .then((data) => {
        if (!active || identityRef.current !== identityKey) return;
        if (data.semesterId !== semesterId)
          throw new Error("Semester mismatch");
        setCatalog(data);
      })
      .catch((failure) => {
        if (active && identityRef.current === identityKey)
          setCatalogError(quizClassAnalysisError(failure));
      })
      .finally(() => {
        if (active && identityRef.current === identityKey)
          setCatalogLoading(false);
      });
    return () => {
      active = false;
      ++requestId.current;
      ++detailRequestId.current;
    };
  }, [identityKey, semesterId, catalogVersion, currentUser]);

  const units = useMemo(() => {
    const found = new Map<string, string>();
    catalog?.assessments.forEach((entry) =>
      found.set(entry.unitId, entry.unitTitle || entry.title),
    );
    return [...found].map(([id, label]) => ({ id, label }));
  }, [catalog]);
  const assessments =
    catalog?.assessments.filter((entry) => entry.unitId === unitId) || [];
  const assessment = assessments.find((entry) => entry.id === assessmentId);
  const classIds = [classId, ...compareIds].filter(Boolean);
  const canQuery = !!assessment && !!classId && !catalogLoading && !loading;

  const clearResult = () => {
    ++requestId.current;
    ++detailRequestId.current;
    setSummary(null);
    setLoadedScope(null);
    setDetail(null);
    setLoading(false);
    setDetailLoading("");
    setError("");
    setDetailError("");
  };
  const loadSummary = async (forceRefresh = false) => {
    if (!assessment || !classId) return;
    const scope: QuizClassScope = {
      semesterId,
      unitId: assessment.unitId,
      category: assessment.category,
      examRound: assessment.examRound || "",
      classIds,
    };
    const run = ++requestId.current;
    ++detailRequestId.current;
    setLoading(true);
    setError("");
    setSummary(null);
    setDetail(null);
    setDetailError("");
    setDetailLoading("");
    try {
      const data = await getQuizClassSummary(scope, identityKey, forceRefresh);
      if (run !== requestId.current || identityRef.current !== identityKey)
        return;
      if (
        data.semesterId !== scope.semesterId ||
        data.unitId !== scope.unitId ||
        data.category !== scope.category ||
        (data.examRound || "") !== scope.examRound ||
        data.classes.length !== scope.classIds.length ||
        new Set(data.classes.map((row) => row.classId)).size !==
          scope.classIds.length ||
        data.classes.some(
          (row) =>
            !scope.classIds.includes(row.classId) || row.complete === false,
        )
      )
        throw new Error("Analysis scope mismatch");
      setLoadedScope(scope);
      setSummary(data);
    } catch (failure) {
      if (run === requestId.current && identityRef.current === identityKey)
        setError(quizClassAnalysisError(failure));
    } finally {
      if (run === requestId.current && identityRef.current === identityKey)
        setLoading(false);
    }
  };
  const loadDetail = async (row: QuizClassSummary, forceRefresh = false) => {
    if (!loadedScope) return;
    const run = ++detailRequestId.current;
    const scope = { ...loadedScope, classIds: [row.classId] };
    setDetailLoading(row.classId);
    setDetailError("");
    setDetail(null);
    try {
      const data = await getQuizClassDetail(scope, identityKey, forceRefresh);
      if (
        run !== detailRequestId.current ||
        identityRef.current !== identityKey
      )
        return;
      if (
        data.complete === false ||
        data.students.some((student) => student.classId !== row.classId)
      )
        throw new Error("Detail class mismatch");
      onDetailData(data.questions, data.treeData);
      setDetail({ classId: row.classId, classLabel: row.label, scope, data });
      requestAnimationFrame(() => detailRef.current?.focus());
    } catch (failure) {
      if (
        run === detailRequestId.current &&
        identityRef.current === identityKey
      )
        setDetailError(quizClassAnalysisError(failure));
    } finally {
      if (
        run === detailRequestId.current &&
        identityRef.current === identityKey
      )
        setDetailLoading("");
    }
  };
  useEffect(() => {
    if (reloadVersion.current === refreshVersion) return;
    reloadVersion.current = refreshVersion;
    if (summary) void loadSummary(true);
  }, [refreshVersion]);
  const detailRecords = useMemo(
    () =>
      detail
        ? adaptQuizAnalysisRecords(
            detail.data.rawRows,
            detail.data.students,
            semesterId,
          )
        : null,
    [detail, semesterId],
  );

  return (
    <section className="quiz-class-analysis" aria-label="학급별 평가 분석">
      <form
        className="ws-filter-bar qca-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void loadSummary();
        }}
      >
        <label className="qca-unit">
          중단원
          <select
            aria-label="분석할 중단원"
            value={unitId}
            disabled={catalogLoading || !units.length}
            onChange={(event) => {
              clearResult();
              setUnitId(event.target.value);
              const next =
                catalog?.assessments.filter(
                  (entry) => entry.unitId === event.target.value,
                ) || [];
              setAssessmentId(next[0]?.id || "");
            }}
          >
            <option value="">단원 선택</option>
            {units.map((unit) => (
              <option value={unit.id} key={unit.id}>
                {unit.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          평가
          <select
            aria-label="분석할 평가"
            value={assessmentId}
            disabled={catalogLoading || !assessments.length}
            onChange={(event) => {
              clearResult();
              setAssessmentId(event.target.value);
            }}
          >
            <option value="">평가 선택</option>
            {assessments.map((entry) => (
              <option value={entry.id} key={entry.id}>
                {assessmentLabel(entry.category, entry.examRound)}
              </option>
            ))}
          </select>
        </label>
        <label>
          학급
          <select
            aria-label="분석할 학급"
            value={classId}
            disabled={catalogLoading || !catalog?.classes.length}
            onChange={(event) => {
              clearResult();
              setClassId(event.target.value);
              setCompareIds((ids) =>
                ids.filter((id) => id !== event.target.value),
              );
            }}
          >
            <option value="">학급 선택</option>
            {catalog?.classes.map((entry) => (
              <option value={entry.id} key={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="qca-primary" disabled={!canQuery}>
          {loading ? "조회 중…" : "결과 조회"}
        </button>
        <button
          type="button"
          className="qca-secondary"
          aria-expanded={comparisonOpen}
          onClick={() => {
            if (comparisonOpen && compareIds.length) {
              clearResult();
              setCompareIds([]);
            }
            setComparisonOpen(!comparisonOpen);
          }}
          disabled={!classId || catalogLoading}
        >
          학급 비교{compareIds.length ? ` ${compareIds.length + 1}` : ""}
        </button>
      </form>
      {comparisonOpen && (
        <fieldset className="qca-compare-select">
          <legend>
            비교할 학급 <span className="qca-muted">최대 4개 학급</span>
          </legend>
          <div>
            {catalog?.classes
              .filter((entry) => entry.id !== classId)
              .map((entry) => (
                <label key={entry.id}>
                  <input
                    type="checkbox"
                    checked={compareIds.includes(entry.id)}
                    disabled={
                      !compareIds.includes(entry.id) && compareIds.length >= 3
                    }
                    onChange={(event) => {
                      clearResult();
                      setCompareIds((ids) =>
                        event.target.checked
                          ? [...ids, entry.id]
                          : ids.filter((id) => id !== entry.id),
                      );
                    }}
                  />
                  {entry.label}
                </label>
              ))}
          </div>
        </fieldset>
      )}
      {catalogLoading ? (
        <p role="status" className="qca-empty">
          평가와 학급 목록을 불러오는 중입니다.
        </p>
      ) : catalogError ? (
        <div role="alert" className="qca-error">
          {catalogError}
          <button
            type="button"
            onClick={() => setCatalogVersion((value) => value + 1)}
          >
            다시 시도
          </button>
        </div>
      ) : !catalog?.assessments.length ? (
        <p className="qca-empty">등록된 평가가 없습니다.</p>
      ) : !catalog.classes.length ? (
        <p className="qca-empty">조회할 학급이 없습니다.</p>
      ) : !summary && !error && !loading ? (
        <p className="qca-empty">
          평가와 학급을 선택한 뒤 결과를 조회해 주세요.
        </p>
      ) : null}
      {error && (
        <div role="alert" className="qca-error">
          {error}
          <button
            type="button"
            onClick={() => void loadSummary()}
            disabled={loading}
          >
            다시 조회
          </button>
        </div>
      )}
      {loading && (
        <p className="qca-empty" role="status">
          선택한 학급의 결과를 불러오는 중입니다.
        </p>
      )}
      {summary && assessment && (
        <>
          <div className="qca-result-heading">
            <h2>
              {assessment.unitTitle || assessment.title} ·{" "}
              {assessmentLabel(assessment.category, assessment.examRound)}
            </h2>
            <span className="qca-muted">
              조회 {timeLabel(summary.generatedAt)}
            </span>
            <button
              type="button"
              className="qca-secondary"
              onClick={() => void loadSummary(true)}
              disabled={loading}
            >
              최신 결과 조회
            </button>
          </div>
          <section className="qca-section" aria-label="학급별 제출과 최근 점수">
            <div className="qca-section-heading">
              <h3>
                {summary.classes.length > 1 ? "학급별 결과 비교" : "학급 결과"}
              </h3>
              <InfoHelp label="학급 결과 집계 기준">
                현재 학급 명단을 기준으로 집계합니다. 제출은 한 번 이상 제출한
                학생 수, 평균과 점수 분포는 학생별 마지막 공식 제출 점수입니다.
                무작위 출제와 재응시 횟수가 달라 학급 순위로 해석하지 않습니다.
              </InfoHelp>
            </div>
            <div
              className="qca-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="학급별 결과 표"
            >
              <table className="qca-table">
                <thead>
                  <tr>
                    <th scope="col">학급</th>
                    <th scope="col">제출 / 학급 인원</th>
                    <th scope="col">미제출</th>
                    <th scope="col">최근 평균</th>
                    <th scope="col">결과 확인</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.classes.map((row) => (
                    <tr key={row.classId}>
                      <th scope="row">
                        {row.label}
                        <span className="qca-row-time qca-muted">
                          {timeLabel(row.generatedAt)} 집계
                        </span>
                      </th>
                      <td>
                        <strong>
                          {row.submittedCount} / {row.rosterCount}명
                        </strong>
                        <span className="qca-muted">
                          {row.rosterCount
                            ? `제출 ${percent(row.submittedCount, row.rosterCount)}%`
                            : "등록 학생 없음"}
                        </span>
                      </td>
                      <td>{row.unsubmittedCount}명</td>
                      <td>
                        <strong>{score(row.averageScore)}</strong>
                        <span className="qca-muted">
                          점수 확인 {row.scoredCount}명
                          {row.smallSample && row.scoredCount > 0
                            ? " · 소표본"
                            : ""}
                          {!!row.missingScoreCount && (
                            <span className="qca-row-time">
                              점수 미확인 {row.missingScoreCount}명 제외
                            </span>
                          )}
                        </span>
                      </td>
                      <td>
                        <button
                          ref={(button) => {
                            if (button)
                              detailOpeners.current.set(row.classId, button);
                            else detailOpeners.current.delete(row.classId);
                          }}
                          type="button"
                          aria-label={`문항·학생 상세 ${row.label}`}
                          className="qca-secondary"
                          onClick={() => void loadDetail(row)}
                          disabled={!!detailLoading}
                        >
                          {detailLoading === row.classId
                            ? "불러오는 중…"
                            : "문항·학생 상세"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {summary.classes.some(
              (row) => row.smallSample && row.scoredCount > 0,
            ) && (
              <p className="qca-caution">
                제출 학생이 20명 미만인 학급이 있습니다. 평균만으로 학급 수준을
                판단하지 마세요.
              </p>
            )}
          </section>
          <section className="qca-section" aria-label="학급별 점수 분포">
            <div className="qca-section-heading">
              <h3>최근 점수 분포</h3>
              <InfoHelp label="점수 분포 읽는 방법">
                각 구간의 막대 길이는 점수가 확인된 학생 중 해당 구간 학생의
                비율입니다. 학급 인원이 달라도 같은 0~100% 척도로 비교합니다.
                미제출 학생은 포함하지 않습니다.
              </InfoHelp>
            </div>
            <div className="qca-distributions">
              {summary.classes.map((row) => (
                <div className="qca-distribution" key={row.classId}>
                  <h4>
                    {row.label}
                    <span>{row.scoredCount}명</span>
                  </h4>
                  {row.scoreHistogram.map((bucket, index) => (
                    <div
                      className="qca-bin"
                      key={`${bucket.lower}:${bucket.upper}`}
                    >
                      <span>
                        {bucket.lower}–{Math.min(100, bucket.upper)}점
                        {index < row.scoreHistogram.length - 1 ? " 미만" : ""}
                      </span>
                      <div className="qca-bar-track" aria-hidden="true">
                        <div
                          style={{
                            width: `${percent(bucket.count, row.scoredCount)}%`,
                          }}
                        />
                      </div>
                      <strong>
                        {bucket.count}명{" "}
                        <small>{percent(bucket.count, row.scoredCount)}%</small>
                      </strong>
                    </div>
                  ))}
                  {!row.scoredCount && (
                    <p className="qca-muted">
                      아직 점수가 확인된 제출이 없습니다.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
          <section className="qca-section" aria-label="다시 살펴볼 개념과 문항">
            <div className="qca-section-heading">
              <h3>다시 살펴볼 내용</h3>
              <InfoHelp label="보충지도 내용 집계 기준">
                현재 버전의 문항별 마지막 응답에서 오답이 있는 개념과 정답률이
                낮은 문항을 표시합니다. 개념별 인원은 해당 개념에 응답한 학생 중
                오답이 남아 있는 학생 수입니다. 같은 학생이 여러 문항을 틀려도
                한 명으로 셉니다. 응답이 적은 문항은 개별 확인에 사용하세요.
              </InfoHelp>
            </div>
            <div className="qca-learning-grid">
              {summary.classes.map((row) => (
                <LearningSummary
                  key={row.classId}
                  row={row}
                  onDetail={() => void loadDetail(row)}
                  disabled={!!detailLoading}
                />
              ))}
            </div>
          </section>
          <section className="qca-section" aria-label="공식 재응시 후 변화">
            <div className="qca-section-heading">
              <h3>다시 푼 뒤의 변화</h3>
              <InfoHelp label="재응답 변화 집계 기준">
                같은 문항·같은 버전의 공식 제출을 두 번 이상 남긴 학생의 최초
                응답과 최근 응답을 비교합니다. 오답 연습 화면의 임시 결과는
                포함하지 않습니다. 반복 문항의 변화이며 학습 향상을 확정하는
                지표는 아닙니다.
              </InfoHelp>
            </div>
            <div
              className="qca-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="학급별 재응답 변화 표"
            >
              <table className="qca-table">
                <thead>
                  <tr>
                    <th scope="col">학급</th>
                    <th scope="col">같은 문항 재응답</th>
                    <th scope="col">오답 → 정답</th>
                    <th scope="col">정답 → 오답</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.classes.map((row) => (
                    <tr key={row.classId}>
                      <th scope="row">{row.label}</th>
                      <td>{row.relearning.repeatedStudentCount}명</td>
                      <td>{row.relearning.wrongToCorrectCount}건</td>
                      <td>{row.relearning.correctToWrongCount}건</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {detailError && (
        <div className="qca-error" role="alert">
          {detailError}
        </div>
      )}
      {detail && detailRecords && (
        <section
          className="qca-detail"
          ref={detailRef}
          tabIndex={-1}
          aria-label={`${detail.classLabel} 문항·학생 상세`}
        >
          <div className="qca-section-heading">
            <h2>{detail.classLabel} · 문항·학생 상세</h2>
            <button
              type="button"
              className="qca-secondary"
              onClick={() => {
                ++detailRequestId.current;
                setDetail(null);
                detailOpeners.current.get(detail.classId)?.focus();
              }}
            >
              상세 닫기
            </button>
          </div>
          <QuizAnalysisView
            key={`${identityKey}:${detail.scope.unitId}:${detail.scope.category}:${detail.scope.examRound}:${detail.classId}:${detail.data.version}`}
            questions={editedQuestions}
            tree={detail.data.treeData}
            students={detail.data.students}
            records={detailRecords.records}
            snapshots={detailRecords.snapshots}
            configuredClasses={detail.data.configuredClasses}
            semesterId={semesterId}
            loading={false}
            errors={[]}
            legacyLimited={false}
            canEdit={canEdit}
            onEdit={onEdit}
            onDerive={onDerive}
            onReload={() => {
              const row = summary?.classes.find(
                (entry) => entry.classId === detail.classId,
              );
              if (row) void loadDetail(row, true);
            }}
            lockedScope={{
              unitId: detail.scope.unitId,
              category: detail.scope.category,
              examRound: detail.scope.examRound,
              classId: detail.classId,
            }}
          />
        </section>
      )}
    </section>
  );
}

function LearningSummary({
  row,
  onDetail,
  disabled,
}: {
  row: QuizClassSummary;
  onDetail: () => void;
  disabled: boolean;
}) {
  const concepts = [...row.concepts]
    .filter((entry) => entry.wrongCount > 0)
    .sort((a, b) => b.wrongCount - a.wrongCount)
    .slice(0, 5);
  const questions = [...row.questions]
    .filter((entry) => entry.wrongCount > 0 && entry.respondentCount > 0)
    .sort(
      (a, b) =>
        (a.correctRate ?? 101) - (b.correctRate ?? 101) ||
        b.respondentCount - a.respondentCount,
    )
    .slice(0, 5);
  return (
    <div className="qca-learning-class">
      <h4>{row.label}</h4>
      <h5>오답이 많은 개념</h5>
      {concepts.length ? (
        <ul className="qca-concept-list">
          {concepts.map((entry) => (
            <li key={entry.concept}>
              <span>{entry.concept}</span>
              <strong>
                오답 {entry.wrongCount} / {entry.respondentCount}명
              </strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="qca-muted">집계된 오답 개념이 없습니다.</p>
      )}
      <h5>정답률이 낮은 문항 · 최대 5개</h5>
      {questions.length ? (
        <ul className="qca-question-list">
          {questions.map((entry) => (
            <li key={entry.id}>
              <span>{entry.question || `문항 ${entry.id}`}</span>
              <strong>
                {entry.correctRate === null
                  ? "—"
                  : `${Math.round(entry.correctRate)}%`}
                <small>
                  {entry.correctCount} / {entry.respondentCount}명
                </small>
              </strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="qca-muted">현재 문항에서 확인된 오답이 없습니다.</p>
      )}
      <button
        type="button"
        aria-label={`문항·오답 확인 ${row.label}`}
        className="qca-secondary"
        onClick={onDetail}
        disabled={disabled}
      >
        문항·오답 확인
      </button>
    </div>
  );
}
