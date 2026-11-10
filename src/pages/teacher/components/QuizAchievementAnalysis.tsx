import { useEffect, useMemo, useRef, useState } from "react";
import InfoHelp from "../../../components/common/InfoHelp";
import {
  MockExamQuestionContent,
  type MockExamPaperQuestion,
} from "../../../components/common/MockExamPaper";
import QuizPassage from "../../../components/common/QuizPassage";
import {
  ACHIEVEMENT_LEVELS,
  adaptAchievementAttempts,
  buildAchievementAnalysis,
  type AchievementAnalysis,
  type AchievementMetadata,
  type AchievementItemStatistics,
  type AchievementLevel,
} from "../../../lib/achievementAnalysis";
import {
  getHistoryAchievementStandard,
  getHistoryAchievementRubric,
  HISTORY_ACHIEVEMENT_RUBRIC_SOURCE,
  resolveQuestionAchievement,
} from "../../../lib/historyAchievement";
import {
  getQuizClassAchievement,
  quizClassAnalysisError,
  type QuizClassAchievement,
  type QuizClassScope,
} from "../../../lib/quizClassAnalysis";
import "./QuizAchievementAnalysis.css";
import "./QuizAnalysisMotion.css";
import QuizAchievementEstimates from "./QuizAchievementEstimates";
import { useQuizClassUpdates } from "./useQuizClassUpdates";
import { applyQuizClassChanges } from "../../../lib/quizClassLiveState";
import {
  AnalysisSortHeader,
  sortAnalysisRows,
  useAnalysisTableSort,
} from "./QuizAnalysisSort";

const percent = (value: number | null | undefined) =>
  value == null ? "—" : `${value.toFixed(1)}%`;
const compactPercent = (value: number | null | undefined) =>
  value == null ? "—" : `${Number(value.toFixed(1))}%`;
const number = (value: number | null | undefined, digits = 2) =>
  value == null ? "—" : value.toFixed(digits);
const difficultyLabel = (value: string | undefined) =>
  ({ easy: "쉬움", medium: "보통", hard: "어려움" })[value || ""] || "미지정";
const levelLabel = (value: string) =>
  value === "unclassified" ? "미분류" : value;
export const QUIZ_ACHIEVEMENT_VIEWS = [
  "전체 결과",
  "문항별 분석",
  "성취기준별 분석",
  "회차별 점수·수준",
  "S–P표",
  "성취수준·분할점수",
];
const labels = QUIZ_ACHIEVEMENT_VIEWS;
const ratio = (numerator: number, denominator: number) =>
  denominator ? (100 * numerator) / denominator : null;
const statisticReason = (reason: string | null) =>
  ({
    insufficient_students: "표본 3명 미만",
    insufficient_items: "문항 수 부족",
    constant_total_score: "총점 동일",
    invalid_alpha: "신뢰도가 0~1 범위 밖임",
    boundary_ties: "상·하위 경계 동점",
    constant_item: "정오가 모두 같음",
    constant_rest_score: "나머지 정답수 동일",
  })[reason || ""] || "자료 부족";

const studentLabel = (
  student: QuizClassAchievement["students"][number] | undefined,
  data: QuizClassAchievement,
) =>
  [
    data.grade || data.configuredClasses.length > 1
      ? data.configuredClasses.find((entry) => entry.id === student?.classId)
          ?.label
      : "",
    student?.number ? `${student.number}번` : "",
    student?.name || "이름 미등록",
  ]
    .filter(Boolean)
    .join(" ");

export default function QuizAchievementAnalysis({
  scope,
  identityKey,
  enabled = true,
  refreshVersion = 0,
  onLoadingChange,
  reportView,
}: {
  scope: QuizClassScope;
  identityKey: string;
  canEdit: boolean;
  enabled?: boolean;
  refreshVersion?: number;
  onLoadingChange?: (loading: boolean) => void;
  reportView?: number;
}) {
  const [data, setData] = useState<QuizClassAchievement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [localView, setView] = useState(0);
  const view = reportView ?? localView;
  const inlineReport = reportView !== undefined;
  const sectionClass = `quiz-achievement-analysis${inlineReport ? " qaa-inline-report" : ""}`;
  const [standardCode, setStandardCode] = useState("");
  const [formKey, setFormKey] = useState("");
  const [questionId, setQuestionId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [choiceQuestionId, setChoiceQuestionId] = useState("");
  const standardSorting = useAnalysisTableSort({
    key: "code",
    direction: "ascending",
  });
  const cellSorting = useAnalysisTableSort({
    key: "code",
    direction: "ascending",
  });
  const currentIdentity = useRef(identityKey);
  currentIdentity.current = identityKey;
  const previewRef = useRef<HTMLDivElement>(null);
  const requestKey = JSON.stringify([
    identityKey,
    scope.semesterId,
    scope.unitId,
    scope.category,
    scope.examRound,
    scope.classIds,
    scope.grade,
  ]);
  const chartEntranceKey = `${requestKey}:${reload}:${refreshVersion}`;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setData(null);
    setQuestionId("");
    setProfileId("");
    if (!enabled) {
      setLoading(false);
      onLoadingChange?.(false);
      return;
    }
    onLoadingChange?.(true);
    void getQuizClassAchievement(
      scope,
      identityKey,
      reload > 0 || refreshVersion > 1,
    )
      .then((result) => {
        if (
          result.semesterId !== scope.semesterId ||
          result.complete === false ||
          (result.grade || "") !== (scope.grade || "") ||
          (scope.grade && !result.configuredClasses.length) ||
          new Set(result.students.map((student) => student.uid)).size !==
            result.students.length ||
          result.students.some(
            (student) =>
              !result.configuredClasses.some(
                (entry) => entry.id === student.classId,
              ) ||
              (!scope.grade && student.classId !== scope.classIds[0]),
          )
        )
          throw new Error("분석 범위가 바뀌었습니다. 다시 조회해 주세요.");
        if (active && currentIdentity.current === identityKey) setData(result);
      })
      .catch((failure) => {
        if (active) setError(quizClassAnalysisError(failure));
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          onLoadingChange?.(false);
        }
      });
    return () => {
      active = false;
      onLoadingChange?.(false);
    };
  }, [requestKey, reload, enabled, refreshVersion, onLoadingChange]);
  useQuizClassUpdates({
    scope,
    identityKey,
    mode: "achievement",
    data,
    enabled,
    onChanges: (changes) =>
      setData((current) =>
        current ? applyQuizClassChanges(current, changes) : current,
      ),
    onError: (failure) => setError(quizClassAnalysisError(failure)),
  });
  const resolveCodes = useMemo(
    () => (metadata: AchievementMetadata) => {
      if (
        metadata.curriculumVersion &&
        metadata.curriculumVersion !== "2018-162"
      )
        return { codes: [] as string[], source: "none" };
      return resolveQuestionAchievement(metadata, data?.treeData || []);
    },
    [data],
  );
  const attempts = useMemo(
    () =>
      data
        ? adaptAchievementAttempts({
            semesterId: scope.semesterId,
            students: data.students,
            questions: data.questions,
            rawRows: data.rawRows,
            resolveCodes,
          })
        : [],
    [data, scope.semesterId, resolveCodes],
  );
  const full = useMemo(
    () =>
      data
        ? buildAchievementAnalysis({
            semesterId: scope.semesterId,
            students: data.students,
            questions: data.questions,
            attempts,
            examRound: scope.examRound,
            scoreRows: data.mockExamScoreRows,
            resolveCodes,
          })
        : null,
    [data, attempts, resolveCodes, scope.semesterId],
  );
  const analysis = useMemo(
    () =>
      data && full
        ? standardCode
          ? buildAchievementAnalysis({
              semesterId: scope.semesterId,
              students: data.students,
              questions: data.questions,
              attempts,
              examRound: scope.examRound,
              scoreRows: data.mockExamScoreRows,
              resolveCodes,
              standardCode,
            })
          : full
        : null,
    [data, full, standardCode, attempts, resolveCodes, scope.semesterId],
  );
  const form =
    analysis?.forms.find((value) => value.key === formKey) ||
    (analysis?.forms.length === 1 ? analysis.forms[0] : null);
  const availableStandardCodes = [
    ...new Set([
      ...(full?.standards.map((row) => row.code) || []),
      ...(data?.questions.flatMap((question) => resolveCodes(question).codes) ||
        []),
    ]),
  ].sort();
  const selectedItem =
    form?.items.find((item) => item.id === choiceQuestionId) || form?.items[0];
  const currentQuestion = data?.questions.find(
    (question) => String(question.id) === questionId,
  ) as MockExamPaperQuestion | undefined;
  const savedQuestion = useMemo(() => {
    if (!questionId || !data) return null;
    const selectedAttempt = attempts.find(
      (attempt) =>
        attempt.complete &&
        (!form ||
          JSON.stringify(
            attempt.items
              .map((item) => [item.id, item.sourceRevision])
              .sort(([a], [b]) => a.localeCompare(b)),
          ) === form.key),
    );
    const raw = data.rawRows.find((row) => row.id === selectedAttempt?.id)?.raw;
    return (
      Array.isArray(raw?.questionSnapshots) ? raw.questionSnapshots : []
    ).find((question: any) => String(question.id) === questionId) as
      | MockExamPaperQuestion
      | undefined;
  }, [questionId, data, attempts, form]);
  const displayedQuestion = savedQuestion || currentQuestion;
  useEffect(() => {
    setQuestionId("");
    setProfileId("");
  }, [view]);
  useEffect(() => {
    if (questionId) requestAnimationFrame(() => previewRef.current?.focus());
  }, [questionId]);
  const analysisHelp = (
    <InfoHelp
      label="성취 분석 집계 기준"
      sections={[
        {
          title: "수준의 의미와 활용",
          items: [
            "A–E는 선택 회차까지의 응시 결과를 모은 학습 진단용 수준입니다. 보충할 내용과 수준별 과제를 정할 때 참고하세요.",
            "최근 회차의 점수와 누적 수준을 함께 보면 이번 시험 결과와 그동안의 학습 상태를 구분할 수 있습니다. 공식 점수·성적은 바뀌지 않습니다.",
          ],
        },
        ...(view === 0
          ? [
              {
                title: "분포 읽기",
                items: [
                  "평균·표준편차는 선택 회차의 점수입니다. 표준편차가 클수록 학생 간 점수 차이가 큽니다. 평균과 분포를 함께 보고 공통 복습과 수준별 보충의 비중을 정하세요.",
                  "수준별 비율의 기준은 선택 회차의 최초 제출이 확인된 학생 전체입니다. 수준별 평균·표준편차도 해당 회차 점수이며, 성취기준을 좁혀도 학생의 종합 수준은 유지됩니다.",
                ],
              },
            ]
          : []),
        {
          title: "계산 기준",
          items: [
            "회차별 최초 유효 제출 점수와 응시 당시 시험지의 추정 분할점수를 각각 100점으로 환산한 뒤, 회차마다 같은 비중으로 평균합니다.",
            "누적 점수가 분할점수 이상인 가장 높은 A–D를 적용하고, D 경계 미만은 E로 분류합니다. 자료가 없는 회차는 0점으로 넣지 않습니다.",
          ],
        },
      ]}
    />
  );
  const toolbar = (
    <div className={`qaa-toolbar${inlineReport ? " qaa-report-heading" : ""}`}>
      {inlineReport && (
        <div className="qaa-report-title">
          <h2>{labels[view]}</h2>
          {analysisHelp}
        </div>
      )}
      <label>
        성취기준
        <select
          value={standardCode}
          disabled={!enabled || loading || !data}
          onChange={(event) => {
            setStandardCode(event.target.value);
            setProfileId("");
          }}
        >
          <option value="">모든 성취기준</option>
          {availableStandardCodes.map((code) => (
            <option key={code} value={code}>
              {code} ·{" "}
              {getHistoryAchievementStandard(code)?.description || "성취기준"}
            </option>
          ))}
        </select>
      </label>
      {!inlineReport && (
        <>
          <label>
            분석 보기
            <select
              value={view}
              onChange={(event) => setView(Number(event.target.value))}
            >
              {labels.map((label, index) => (
                <option key={label} value={index}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="qca-secondary"
            disabled={!enabled || loading}
            onClick={() => setReload((value) => value + 1)}
          >
            최신 결과 조회
          </button>
          {analysisHelp}
        </>
      )}
    </div>
  );
  if (!enabled || loading || error || !data || !analysis || !full)
    return (
      <section className={sectionClass} aria-label="성취기준 분석">
        {toolbar}
        {error ? (
          <div role="alert" className="qca-error">
            {error}
            <button
              type="button"
              onClick={() => setReload((value) => value + 1)}
            >
              다시 조회
            </button>
          </div>
        ) : (
          <p role="status" className="qca-muted">
            {!enabled
              ? "학년 또는 학급을 선택하고 결과를 조회해 주세요."
              : "모의고사 점수와 문항을 불러오는 중입니다."}
          </p>
        )}
        <PendingAchievementView view={view} showHeading={!inlineReport} />
      </section>
    );

  const inspect = (id: string) => {
    setQuestionId(id);
  };
  if (questionId && displayedQuestion)
    return (
      <div
        className="qaa-question"
        ref={previewRef}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setQuestionId("");
          }
        }}
      >
        <div className="qca-section-heading">
          <h3>{displayedQuestion.paperOrder || ""}번 문항</h3>
          <button
            type="button"
            className="qca-secondary"
            onClick={() => setQuestionId("")}
          >
            분석으로 돌아가기
          </button>
        </div>
        <span className="qca-muted">
          {savedQuestion
            ? "응시 당시 문항"
            : "현재 문제은행 문항 · 과거 원문 미보관"}
        </span>
        <MockExamQuestionContent
          question={displayedQuestion as MockExamPaperQuestion}
          index={Math.max(0, (displayedQuestion.paperOrder || 1) - 1)}
          answer={String(displayedQuestion.answer || "")}
        />
        <dl className="qaa-answer">
          <dt>정답</dt>
          <dd>{String(displayedQuestion.answer || "미보관")}</dd>
          <dt>해설</dt>
          <dd>
            {displayedQuestion.explanation ? (
              <QuizPassage value={displayedQuestion.explanation} />
            ) : (
              "해설 미등록"
            )}
          </dd>
        </dl>
      </div>
    );

  return (
    <section className={sectionClass} aria-label="성취기준 분석">
      {toolbar}
      <div className="qaa-scope">
        {data.grade && <span>{data.grade}학년 전체</span>}
        <span>첫 제출 {analysis.attempts.length}명</span>
        <span>1~{scope.examRound.replace("round_", "")}회 누적 수준</span>
        {analysis.unclassifiedItemCount > 0 && (
          <span>미연결 응답 {analysis.unclassifiedItemCount}건</span>
        )}
      </div>
      {view === 0 && (
        <>
          {!inlineReport && (
            <div className="qca-section-heading">
              <h3>전체 분포</h3>
              <InfoHelp
                label="점수 분포와 수준 분포"
                sections={[
                  {
                    items: [
                      "점수 분포·평균·표준편차는 선택한 회차의 제출 점수입니다. 평균으로 전반적인 결과를, 표준편차로 학생 간 점수 차이가 얼마나 큰지 확인하세요.",
                      "표준편차가 클수록 점수가 넓게 퍼져 있습니다. 평균이 비슷해도 분포가 다르면 공통 복습과 수준별 보충의 비중을 달리 잡을 수 있습니다.",
                      "A–E 인원은 선택 회차까지의 누적 점수와 시험지별 추정 분할점수로 분류합니다. 성취기준을 좁혀도 학생의 종합 수준은 유지됩니다.",
                      "수준별 비율의 기준은 선택 회차의 최초 제출이 확인된 학생 전체입니다. 수준별 평균·표준편차는 해당 회차 점수로 계산합니다.",
                    ],
                  },
                ]}
              />
            </div>
          )}
          <div className="qaa-metrics">
            <span>
              점수 확인 <strong>{analysis.scoredCount}명</strong>
            </span>
            <span>
              평균 <strong>{number(analysis.mean, 1)}</strong>
            </span>
            <span>
              표준편차 <strong>{number(analysis.standardDeviation, 1)}</strong>
            </span>
          </div>
          {inlineReport && !analysis.attempts.length ? (
            <p className="qca-muted" role="status">
              아직 제출한 학생이 없습니다.
            </p>
          ) : (
            <Histogram
              key={`histogram:${chartEntranceKey}`}
              analysis={analysis}
            />
          )}
          {(!inlineReport || analysis.attempts.length > 0) && (
            <div
              key={`levels:${chartEntranceKey}`}
              className="qaa-level-stack"
              role="img"
              aria-label={analysis.levelCohorts
                .map((row) => `${levelLabel(row.level)} ${row.count}명`)
                .join(", ")}
            >
              {analysis.levelCohorts
                .filter((row) => row.count)
                .map((row) => (
                  <span
                    key={row.level}
                    className={`qaa-level-${row.level} qa-chart-rise`}
                    style={{ width: `${row.percent}%` }}
                    title={`${levelLabel(row.level)} ${percent(row.percent)}`}
                  />
                ))}
            </div>
          )}
          <Table label="학생 성취수준별 분포">
            <thead>
              <tr>
                <th>학생 수준</th>
                <th>인원</th>
                <th>비율</th>
                <th>평균</th>
                <th>표준편차</th>
              </tr>
            </thead>
            <tbody>
              {analysis.levelCohorts.map((row) => (
                <tr key={row.level}>
                  <th>{levelLabel(row.level)}</th>
                  <td>{row.count}</td>
                  <td>{percent(row.percent)}</td>
                  <td>{number(row.mean, 1)}</td>
                  <td>{number(row.standardDeviation, 1)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          {(!inlineReport || analysis.attempts.length > 0) && (
            <FormChoice
              analysis={analysis}
              formKey={formKey}
              setFormKey={setFormKey}
            />
          )}
          {form && (
            <>
              <div className="qaa-metrics">
                <span>
                  같은 시험지{" "}
                  <strong>
                    {form.sampleSize}명 · {form.itemCount}문항
                  </strong>
                </span>
                <span>
                  <span className="qaa-metric-label">
                    신뢰도 α
                    <InfoHelp
                      label="신뢰도 계산"
                      sections={[
                        {
                          title: "의미와 활용",
                          items: [
                            "문항들이 얼마나 일관되게 학생들의 정답수 차이를 보여 주는지 나타냅니다. 보통 1에 가까울수록 일관성이 높습니다.",
                            "낮거나 음수라면 정답 설정, 문항 간 내용 차이, 응시 집단을 함께 점검하세요. 이 값 하나로 시험의 품질이나 학생 수준을 판정하지 않습니다.",
                          ],
                        },
                        {
                          title: "계산 기준",
                          items: [
                            "같은 문항 구성·버전의 완전한 최초 정오표만 사용하며, 모든 문항을 같은 배점의 정답·오답으로 처리합니다.",
                            "α = k/(k−1) × [1−Σ문항 분산/총 정답수 분산]. k는 문항 수이며, 이분문항에서는 KR-20과 같은 신뢰도입니다.",
                            "3명 미만, 문항 부족, 학생들의 총 정답수가 모두 같으면 계산하지 않습니다.",
                            ...(form.sampleSize < 20
                              ? [
                                  "현재 표본은 20명 미만입니다. 몇 명의 응답만 달라져도 값이 크게 바뀔 수 있습니다.",
                                ]
                              : []),
                          ],
                        },
                      ]}
                    />
                  </span>
                  <strong>{number(form.alpha, 3)}</strong>
                </span>
                <span>
                  <span className="qaa-metric-label">
                    측정 표준오차
                    <InfoHelp
                      label="측정 표준오차 계산"
                      sections={[
                        {
                          title: "의미와 활용",
                          items: [
                            "정답률에 포함될 수 있는 측정 오차의 크기입니다. 값이 클수록 작은 점수 차이를 해석할 때 더 신중해야 합니다.",
                            "예를 들어 5%p라면 정답률 5%p 정도가 오차 규모의 참고값입니다. 학생 간 작은 차이만으로 우열을 정하기보다 다른 회차와 수업 관찰을 함께 보세요.",
                            "개별 학생의 실제 점수가 반드시 ±이 값 안에 있다는 뜻은 아닙니다. 배점이 다른 원래 시험 점수의 오차로도 쓰지 않습니다.",
                          ],
                        },
                        {
                          title: "계산 기준",
                          items: [
                            "표준오차(%p) = 총 정답수의 표본 표준편차 × √(1−α) ÷ 문항 수 × 100. 모든 문항을 같은 배점으로 봅니다.",
                            "신뢰도를 계산할 수 없거나 α가 0~1 범위를 벗어나면 표시하지 않습니다.",
                            ...(form.psychometrics.semUnavailableReason
                              ? [
                                  `현재 미산출 사유: ${statisticReason(form.psychometrics.semUnavailableReason)}.`,
                                ]
                              : []),
                          ],
                        },
                      ]}
                    />
                  </span>
                  <strong>
                    {form.psychometrics.semPercent == null
                      ? "—"
                      : `${number(form.psychometrics.semPercent, 1)}%p`}
                  </strong>
                </span>
                {form.alpha != null && form.alpha < 0 && (
                  <span className="qca-muted">음의 α · 문항 구성 검토</span>
                )}
              </div>
              <DifficultySummary form={form} data={data} />
              <AdjacentLevels form={form} data={data} onInspect={inspect} />
            </>
          )}
        </>
      )}
      {view === 1 && (
        <>
          <FormChoice
            analysis={analysis}
            formKey={formKey}
            setFormKey={setFormKey}
          />
          {form ? (
            <>
              <div className="qca-section-heading">
                <h3>문항 분석</h3>
                <InfoHelp
                  label="문항 통계 계산"
                  sections={[
                    {
                      title: "문항을 점검할 때",
                      items: [
                        "변별도 = 이 문항의 정오와 나머지 문항 정답수의 상관. 양수일수록 다른 문항을 잘 푼 학생이 이 문항도 맞히는 경향이 있습니다. 음수라면 정답 설정·발문·수업 내용을 점검하세요.",
                        "D = 정답수 상위 27%의 정답률 − 하위 27%의 정답률. 양수이면 상위 집단이 더 많이 맞힌 문항입니다. 표본이 부족하거나 경계에 동점자가 있으면 계산하지 않습니다.",
                        "제거 시 α = 이 문항을 빼고 계산한 신뢰도. 전체 α보다 높으면 문항을 검토할 단서가 되지만, 꼭 평가해야 할 내용인지 확인한 뒤 수정 여부를 판단하세요.",
                      ],
                    },
                    {
                      title: "오개념과 보충 내용 찾기",
                      items: [
                        "선지 비율 = 해당 선지를 고른 인원 ÷ 무응답을 포함한 전체 표본 × 100. 많이 고른 오답을 확인해 혼동한 개념을 복습하세요. 보관되지 않은 답안은 0으로 채우지 않습니다.",
                        "A–E는 누적 점수와 시험지별 추정 분할점수로 나눈 학생 집단입니다. 수준별 정답률과 표본 수를 함께 보며, 인원이 적은 집단의 큰 차이는 신중하게 해석하세요.",
                      ],
                    },
                  ]}
                />
              </div>
              <ItemStatisticsTable
                key={`${form.key}:${chartEntranceKey}`}
                form={form}
                data={data}
                onInspect={inspect}
                profileId={profileId}
                setProfileId={setProfileId}
              />
              <div className="qca-section-heading">
                <h3>학생 수준별 선택 선지</h3>
                <label className="qaa-inline-select">
                  문항
                  <select
                    value={selectedItem?.id || ""}
                    onChange={(event) =>
                      setChoiceQuestionId(event.target.value)
                    }
                  >
                    {form.items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {(
                          data.questions.find(
                            (row) => String(row.id) === item.id,
                          ) as any
                        )?.paperOrder || item.id}
                        번
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {selectedItem && (
                <LevelChoices
                  item={selectedItem}
                  question={data.questions.find(
                    (row) => String(row.id) === selectedItem.id,
                  )}
                />
              )}
            </>
          ) : (
            <p className="qca-empty">
              같은 시험지·버전의 완전한 최초 제출을 선택해 주세요.
            </p>
          )}
        </>
      )}
      {view === 2 && (
        <>
          <div className="qca-section-heading">
            <h3>성취기준별 결과</h3>
            <InfoHelp
              label="성취기준 성취율"
              sections={[
                {
                  items: [
                    "배점 가중 성취율 = 연결 문항의 획득 배점 합계 ÷ 만점 합계 × 100. 배점이 큰 문항의 결과가 더 많이 반영됩니다.",
                    "낮은 성취율의 기준부터 문항과 오답을 살펴보고, 다음 수업의 복습·보충 내용을 정하세요. 문항 수와 응시 인원이 적은 기준은 다른 평가 결과도 함께 확인하세요.",
                    "한 문항이 여러 기준에 연결되면 각 기준에 포함됩니다. 기준별 행을 더해 전체 점수로 쓰지 않으며, 배점이 보관되지 않은 기록은 가중 성취율에서 제외합니다.",
                    "목표수준 A–E별 정답률은 그 수준을 목표로 출제한 문항의 결과입니다. 학생 자체의 등급을 뜻하지 않습니다.",
                  ],
                },
              ]}
            />
          </div>
          {standardCode && (
            <AchievementRubric key={standardCode} code={standardCode} />
          )}
          <Table label="성취기준별 배점 가중 성취율">
            <thead>
              <tr>
                <AnalysisSortHeader
                  column="code"
                  label="성취기준"
                  defaultDirection="ascending"
                  {...standardSorting}
                />
                <AnalysisSortHeader
                  column="weighted"
                  label="배점 가중 성취율"
                  {...standardSorting}
                />
                <AnalysisSortHeader
                  column="rate"
                  label="정답 / 응답"
                  {...standardSorting}
                />
                <AnalysisSortHeader
                  column="students"
                  label="학생"
                  {...standardSorting}
                />
              </tr>
            </thead>
            <tbody>
              {sortAnalysisRows(
                analysis.standards,
                standardSorting.sort,
                (row, key) =>
                  key === "code"
                    ? row.code
                    : key === "weighted"
                      ? row.weighted.percent
                      : key === "rate"
                        ? row.actual.percent
                        : row.students,
              ).map((row) => (
                <tr key={row.code}>
                  <th>
                    <button
                      type="button"
                      className="qaa-text-button"
                      onClick={() => setStandardCode(row.code)}
                    >
                      {row.code}
                    </button>
                    <InfoHelp label={`${row.code} 성취기준 원문`}>
                      {getHistoryAchievementStandard(row.code)?.description ||
                        "성취기준 원문 미확인"}
                    </InfoHelp>
                  </th>
                  <td>
                    {percent(row.weighted.percent)}
                    <small>
                      {row.weighted.earned}/{row.weighted.maximum}점
                      {row.weighted.missing
                        ? ` · 배점 누락 ${row.weighted.missing}`
                        : ""}
                    </small>
                  </td>
                  <td>
                    {row.actual.correct}/{row.actual.total}
                    <small>{percent(row.actual.percent)}</small>
                  </td>
                  <td>{row.students}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          {standardCode && (
            <StandardLevelRates
              analysis={analysis}
              data={data}
              code={standardCode}
            />
          )}
          <div className="qca-section-heading">
            <h3>문항 목표수준·난도별 정답률</h3>
          </div>
          <Table label="목표 수준과 난도별 실제 정답률">
            <thead>
              <tr>
                <AnalysisSortHeader
                  column="code"
                  label="성취기준"
                  defaultDirection="ascending"
                  {...cellSorting}
                />
                <AnalysisSortHeader
                  column="target"
                  label="문항 목표수준"
                  defaultDirection="ascending"
                  {...cellSorting}
                />
                <AnalysisSortHeader
                  column="difficulty"
                  label="출제 난도"
                  defaultDirection="ascending"
                  {...cellSorting}
                />
                <AnalysisSortHeader
                  column="rate"
                  label="정답률"
                  {...cellSorting}
                />
                <AnalysisSortHeader
                  column="correct"
                  label="정답 / 응답"
                  {...cellSorting}
                />
              </tr>
            </thead>
            <tbody>
              {sortAnalysisRows(analysis.cells, cellSorting.sort, (row, key) =>
                key === "code"
                  ? row.standardCode
                  : key === "target"
                    ? row.targetLevel || null
                    : key === "difficulty"
                      ? ({ easy: 1, medium: 2, hard: 3, "": null }[
                          row.difficulty
                        ] ?? null)
                      : key === "rate"
                        ? row.actual.percent
                        : row.actual.correct,
              ).map((row) => (
                <tr
                  key={
                    row.standardCode +
                    ":" +
                    row.targetLevel +
                    ":" +
                    row.difficulty
                  }
                >
                  <th>{row.standardCode}</th>
                  <td>{row.targetLevel || "미지정"}</td>
                  <td>{difficultyLabel(row.difficulty)}</td>
                  <td>{percent(row.actual.percent)}</td>
                  <td>
                    {row.actual.correct}/{row.actual.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
      {(view === 3 || view === 5) && (
        <QuizAchievementEstimates
          data={data}
          analysis={analysis}
          examRound={scope.examRound}
          showPaper={view === 5}
        />
      )}
      {view === 4 && (
        <>
          <FormChoice
            analysis={analysis}
            formKey={formKey}
            setFormKey={setFormKey}
          />
          <SpTable
            key={form?.key}
            analysis={analysis}
            formKey={form?.key}
            data={data}
            onInspect={inspect}
          />
        </>
      )}
    </section>
  );
}

function AchievementRubric({
  code,
  compact = false,
}: {
  code: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rubric = getHistoryAchievementRubric(code);
  if (!rubric)
    return (
      <p className="qca-muted">
        이 성취기준의 수준 준거를 확인하지 못했습니다.
      </p>
    );
  return (
    <div className={`qaa-rubric${compact ? " qaa-rubric--compact" : ""}`}>
      <div className="qca-section-heading">
        <button
          type="button"
          className="qca-secondary"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            style={{ transform: open ? "rotate(90deg)" : undefined }}
          >
            <path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.5" />
          </svg>{" "}
          수준 준거
        </button>
        <InfoHelp
          label="성취수준 준거의 출처"
          sections={[
            {
              items: [
                "각 수준에서 확인할 학습 내용을 살펴보고, 문항의 목표수준과 보충 과제가 적절한지 검토할 때 참고하세요.",
                `${HISTORY_ACHIEVEMENT_RUBRIC_SOURCE} ${rubric.sourcePages.join(", ")}쪽의 ${rubric.sourceStandards.join(", ")}를 참고해 중학교 역사② 범위로 재구성했습니다. 공식 중학교 성취수준 원문이 아닌 교사 검토용 준거입니다.`,
                rubric.mappingNote,
              ],
            },
          ]}
        />
      </div>
      {open && (
        <dl>
          {ACHIEVEMENT_LEVELS.map((level) => (
            <div className="qaa-rubric-row" key={level}>
              <dt>{level}</dt>
              <dd>{rubric.levels[level]}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Table({
  children,
  label,
  wide = false,
  className = "",
  style,
}: {
  children: React.ReactNode;
  label: string;
  wide?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="qca-table-scroll qaa-table-scroll"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table
        className={`qca-table qaa-table${wide ? " qaa-table--wide" : ""} ${className}`}
        style={style}
      >
        {children}
      </table>
    </div>
  );
}
function Histogram({ analysis }: { analysis: AchievementAnalysis }) {
  const maximum = Math.max(1, ...analysis.histogram.map((row) => row.count));
  return (
    <div
      className="qaa-histogram"
      role="img"
      aria-label={`점수 분포. ${analysis.histogram.map((row) => `${row.label}점 ${row.count}명`).join(", ")}`}
    >
      {analysis.histogram.map((row) => (
        <div key={row.label} className="qaa-histogram-column">
          <span>{row.count}</span>
          <div
            className="qa-chart-rise"
            style={{ height: `${(row.count / maximum) * 100}%` }}
          />
          <small>{row.label}</small>
        </div>
      ))}
    </div>
  );
}
function FormChoice({
  analysis,
  formKey,
  setFormKey,
}: {
  analysis: AchievementAnalysis;
  formKey: string;
  setFormKey: (value: string) => void;
}) {
  return analysis.forms.length > 1 ? (
    <label className="qaa-form-choice">
      시험지 구성
      <select
        value={formKey}
        onChange={(event) => setFormKey(event.target.value)}
      >
        <option value="">같은 시험지·버전 선택</option>
        {analysis.forms.map((form, i) => (
          <option key={form.key} value={form.key}>
            시험지 {i + 1} · {form.itemCount}문항 · {form.sampleSize}명
          </option>
        ))}
      </select>
    </label>
  ) : analysis.forms.length ? null : (
    <p className="qca-empty">완전한 최초 제출 정오표가 없습니다.</p>
  );
}
function ProfileChart({
  item,
  compact = false,
}: {
  item: AchievementItemStatistics;
  compact?: boolean;
}) {
  const width = compact ? 120 : 600,
    height = compact ? 44 : 220,
    left = compact ? 6 : 40,
    bottom = compact ? 8 : 48,
    top = compact ? 5 : 20;
  const x = (index: number) => left + (index * (width - left - 16)) / 5;
  const y = (value: number) =>
    top + ((100 - value) / 100) * (height - bottom - top);
  const paths: string[] = [];
  let path = "";
  item.levelRates.forEach((row, index) => {
    if (row.percent == null) {
      if (path) paths.push(path);
      path = "";
    } else path += `${path ? " L" : "M"}${x(index)},${y(row.percent)}`;
  });
  if (path) paths.push(path);
  return (
    <svg
      className={compact ? "qaa-sparkline" : "qaa-profile-chart"}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={item.levelRates
        .map(
          (row) =>
            `${levelLabel(row.level)} ${row.total}명 ${percent(row.percent)}`,
        )
        .join(", ")}
    >
      {!compact &&
        [0, 25, 50, 75, 100].map((value) => (
          <g key={value}>
            <line
              x1={left}
              x2={width - 16}
              y1={y(value)}
              y2={y(value)}
              className="qaa-gridline"
            />
            <text x={left - 8} y={y(value) + 4} textAnchor="end">
              {value}
            </text>
          </g>
        ))}
      <g
        className="qa-chart-rise"
        style={{ transformOrigin: `0 ${height - bottom}px` }}
      >
        {paths.map((value, i) => (
          <path key={i} d={value} className="qaa-profile-path" />
        ))}
        {item.levelRates.map((row, i) =>
          row.percent != null ? (
            <circle
              key={row.level}
              cx={x(i)}
              cy={y(row.percent)}
              r={compact ? 2 : 4}
            />
          ) : null,
        )}
      </g>
      {item.levelRates.map((row, i) => (
        <g key={row.level}>
          {!compact && (
            <>
              <text x={x(i)} y={height - 28} textAnchor="middle">
                {levelLabel(row.level)}
              </text>
              <text x={x(i)} y={height - 10} textAnchor="middle">
                n={row.total}
              </text>
              {row.percent != null && (
                <text x={x(i)} y={y(row.percent) - 8} textAnchor="middle">
                  {percent(row.percent)}
                </text>
              )}
            </>
          )}
        </g>
      ))}
    </svg>
  );
}
function ItemStatisticsTable({
  form,
  data,
  onInspect,
  profileId,
  setProfileId,
}: {
  form: AchievementAnalysis["forms"][number];
  data: QuizClassAchievement;
  onInspect: (id: string) => void;
  profileId: string;
  setProfileId: (id: string) => void;
}) {
  const sorting = useAnalysisTableSort({ key: "item", direction: "ascending" });
  const questionById = new Map(
    data.questions.map((question) => [
      String(question.id),
      question as typeof question & { paperOrder?: number },
    ]),
  );
  const rows = sortAnalysisRows(form.items, sorting.sort, (item, key) => {
    if (key === "item") return questionById.get(item.id)?.paperOrder || item.id;
    if (key === "difficulty")
      return item.intendedDifficulty
        ? { easy: 1, medium: 2, hard: 3 }[item.intendedDifficulty]
        : null;
    if (key === "target") return item.targetAchievementLevel || null;
    if (key === "correctRate") return item.correctRate;
    if (key === "discrimination") return item.discrimination;
    if (key === "upperLower27") return item.upperLower27;
    if (key === "alphaIfDeleted") return item.alphaIfDeleted;
    if (key === "unanswered")
      return item.missingAnswer
        ? null
        : ratio(item.unanswered, item.sampleSize);
    if (key.startsWith("choice:"))
      return item.choices[Number(key.slice(7))]?.percent;
    return item.levelRates.find((row) => row.level === key)?.percent;
  });
  const columns = [
    ["item", "문항", "ascending"],
    ["difficulty", "난도", "ascending"],
    ["target", "목표", "ascending"],
    ["correctRate", "정답률"],
    ["discrimination", "변별도"],
    ["upperLower27", "D (27%)"],
    ["alphaIfDeleted", "제거 시 α"],
    ...[0, 1, 2, 3, 4].map((index) => [`choice:${index}`, `${index + 1}`]),
    ["unanswered", "무응답"],
    ...[...ACHIEVEMENT_LEVELS, "unclassified"].map((level) => [
      level,
      levelLabel(level),
    ]),
  ];
  return (
    <Table
      label="문항별 통계와 학생 수준별 정답률"
      className="qaa-table--items"
    >
      <thead>
        <tr>
          {columns.map(([column, label, direction]) => (
            <AnalysisSortHeader
              key={column}
              column={column}
              label={label}
              defaultDirection={
                direction === "ascending" ? "ascending" : "descending"
              }
              {...sorting}
            />
          ))}
          <th>프로필</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((item) => (
          <FragmentRows
            key={item.id}
            item={item}
            question={questionById.get(item.id)}
            onInspect={onInspect}
            expanded={profileId === item.id}
            onToggle={() => setProfileId(profileId === item.id ? "" : item.id)}
          />
        ))}
      </tbody>
    </Table>
  );
}
function FragmentRows({
  item,
  question,
  onInspect,
  expanded,
  onToggle,
}: {
  item: AchievementItemStatistics;
  question: any;
  onInspect: (id: string) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr>
        <th>
          <button
            className="qaa-text-button"
            type="button"
            onClick={() => onInspect(item.id)}
          >
            {question?.paperOrder || item.id}번
          </button>
        </th>
        <td>{difficultyLabel(item.intendedDifficulty)}</td>
        <td>{item.targetAchievementLevel || "미지정"}</td>
        <td>
          <InfoHelp
            className="qaa-value-help"
            trigger={compactPercent(item.correctRate)}
            label={`${question?.paperOrder || item.id}번 정답률 ${compactPercent(item.correctRate)}, 표본 정보`}
          >
            정답률 {percent(item.correctRate)} · 표본 {item.sampleSize}명
          </InfoHelp>
        </td>
        <td>{number(item.discrimination, 3)}</td>
        <td>
          <InfoHelp
            className="qaa-value-help"
            trigger={number(item.upperLower27)}
            label={`${question?.paperOrder || item.id}번 상·하위 변별도 ${number(item.upperLower27)}, 표본 정보`}
          >
            {item.upperLowerCount
              ? `상·하위 각 ${item.upperLowerCount}명`
              : "표본이 부족하거나 상·하위 경계에 동점자가 있어 계산하지 않았습니다."}
          </InfoHelp>
        </td>
        <td>{number(item.alphaIfDeleted, 3)}</td>
        {[0, 1, 2, 3, 4].map((index) => (
          <td
            key={index}
            className={
              item.choices[index]?.answer === item.answerKey
                ? "qaa-correct-option"
                : ""
            }
          >
            {compactPercent(item.choices[index]?.percent)}
          </td>
        ))}
        <td>
          {item.missingAnswer
            ? "미보관 포함"
            : compactPercent(ratio(item.unanswered, item.sampleSize))}
        </td>
        {item.levelRates.map((row) => (
          <td key={row.level}>
            <InfoHelp
              className="qaa-value-help"
              trigger={compactPercent(row.percent)}
              label={`${question?.paperOrder || item.id}번 ${levelLabel(row.level)} 수준 정답률 ${compactPercent(row.percent)}, 표본 정보`}
            >
              {levelLabel(row.level)} 수준 정답률 {percent(row.percent)} · 표본{" "}
              {row.total}명
            </InfoHelp>
          </td>
        ))}
        <td>
          <button
            type="button"
            className="qaa-chart-button"
            aria-label={`${question?.paperOrder || item.id}번 수준 프로필 그래프`}
            aria-expanded={expanded}
            onClick={onToggle}
          >
            <ProfileChart item={item} compact />
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={20}>
            <ProfileChart item={item} />
          </td>
        </tr>
      )}
    </>
  );
}
function LevelChoices({
  item,
  question,
}: {
  item: AchievementItemStatistics;
  question: any;
}) {
  const rows = [
    ...item.levelChoices,
    {
      level: "전체",
      total: item.sampleSize,
      choices: item.choices.map((row) => row.count),
      unanswered: item.unanswered,
      missingAnswer: item.missingAnswer,
      unlistedAnswer: item.unlistedAnswer,
    },
  ];
  return (
    <Table label="성취수준별 선택 선지">
      <thead>
        <tr>
          <th>학생 수준</th>
          <th>인원</th>
          <th>정답률</th>
          {item.choices.map((row, i) => (
            <th
              key={i}
              className={
                row.answer === item.answerKey ? "qaa-correct-option" : ""
              }
            >
              {i + 1}
              {row.answer === item.answerKey ? " (정답)" : ""}
            </th>
          ))}
          <th>무응답</th>
          <th>선지 외 응답</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.level}>
            <th>{levelLabel(row.level)}</th>
            <td>{row.total}</td>
            <td>
              {percent(
                row.level === "전체"
                  ? item.correctRate
                  : item.levelRates.find((value) => value.level === row.level)
                      ?.percent,
              )}
            </td>
            {row.choices.map((count, i) => (
              <td
                key={i}
                className={
                  item.choices[i].answer === item.answerKey
                    ? "qaa-correct-option"
                    : ""
                }
              >
                {row.missingAnswer
                  ? "미보관 포함"
                  : percent(ratio(count, row.total))}
                <small>{count}명</small>
              </td>
            ))}
            <td>
              {row.missingAnswer
                ? `미보관 ${row.missingAnswer}명`
                : percent(ratio(row.unanswered, row.total))}
            </td>
            <td>
              {row.missingAnswer
                ? "미보관 포함"
                : percent(ratio(row.unlistedAnswer, row.total))}
              <small>{row.unlistedAnswer}명</small>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
function StandardLevelRates({
  analysis,
  data,
  code,
}: {
  analysis: AchievementAnalysis;
  data: QuizClassAchievement;
  code: string;
}) {
  return (
    <Table label="성취기준 학생 수준별 배점 가중 성취율">
      <thead>
        <tr>
          <th>기준</th>
          {[...ACHIEVEMENT_LEVELS, "unclassified"].map((value) => (
            <th key={value}>{levelLabel(value)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <th>{code}</th>
          {[...ACHIEVEMENT_LEVELS, "unclassified"].map((value) => {
            const items = analysis.attempts
              .filter(
                (attempt) =>
                  (analysis.cumulativeScores.find(
                    (row) => row.student.uid === attempt.studentUid,
                  )?.level || "unclassified") === value,
              )
              .flatMap((attempt) =>
                attempt.items.filter(
                  (item) =>
                    item.codes.includes(code) &&
                    item.points != null &&
                    typeof item.correct === "boolean",
                ),
              );
            return (
              <td key={value}>
                {percent(
                  ratio(
                    items.reduce(
                      (sum, item) => sum + (item.correct ? item.points! : 0),
                      0,
                    ),
                    items.reduce((sum, item) => sum + item.points!, 0),
                  ),
                )}
              </td>
            );
          })}
        </tr>
      </tbody>
    </Table>
  );
}
function DifficultySummary({
  form,
  data,
}: {
  form: AchievementAnalysis["forms"][number];
  data: QuizClassAchievement;
}) {
  const rows = ["easy", "medium", "hard", ""];
  return (
    <>
      <div className="qca-section-heading">
        <h3>출제·관찰 난도</h3>
        <InfoHelp
          label="관찰 난도 분류"
          sections={[
            {
              items: [
                "출제 난도는 교사가 예상해 입력한 값, 관찰 난도는 같은 문항 구성·버전의 완전한 최초 응답에서 구한 정답률입니다. 정답률이 높을수록 학생들이 쉽게 푼 문항입니다.",
                "관찰 난도: 정답률 85% 이상은 쉬움, 50% 이하는 어려움, 그 사이는 보통입니다. 학생 A–E를 나누는 분할점수와는 별개입니다.",
                "각 비율 = 해당 난도 문항 수 ÷ 분석 대상 문항 수 × 100. 출제 비율과 관찰 비율을 비교해 시험이 예상보다 쉬웠는지 어려웠는지 살펴보세요.",
                "예상보다 어려웠던 문항은 오답과 수업에서 다룬 내용을 확인해 보충 학습에 활용하세요. 다음 출제에서는 특정 난도에 문항이 몰리지 않았는지 점검할 수 있습니다.",
              ],
            },
          ]}
        />
      </div>
      <Table label="출제 난도와 관찰 난도 비율">
        <thead>
          <tr>
            <th>난도</th>
            <th>출제 문항</th>
            <th>출제 비율</th>
            <th>관찰 문항</th>
            <th>관찰 비율</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((value) => {
            const intended = form.items.filter(
              (item) => (item.intendedDifficulty || "") === value,
            ).length;
            const observed = form.items.filter(
              (item) =>
                (item.correctRate == null
                  ? ""
                  : item.correctRate >= 85
                    ? "easy"
                    : item.correctRate <= 50
                      ? "hard"
                      : "medium") === value,
            ).length;
            return (
              <tr key={value}>
                <th>{difficultyLabel(value)}</th>
                <td>{intended}</td>
                <td>{percent(ratio(intended, form.items.length))}</td>
                <td>{observed}</td>
                <td>{percent(ratio(observed, form.items.length))}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
function SpTable({
  analysis,
  formKey,
  data,
  onInspect,
}: {
  analysis: AchievementAnalysis;
  formKey?: string;
  data: QuizClassAchievement;
  onInspect: (id: string) => void;
}) {
  const studentSort = useAnalysisTableSort({
    key: "correctCount",
    direction: "descending",
  });
  const itemSort = useAnalysisTableSort({
    key: "correctRate",
    direction: "ascending",
  });
  const metrics = analysis.forms.find(
    (form) => form.key === formKey,
  )?.psychometrics;
  if (!metrics) return null;
  const studentById = new Map(
    data.students.map((student) => [student.uid, student]),
  );
  const questionById = new Map(
    data.questions.map((question) => [
      String(question.id),
      question as typeof question & { paperOrder?: number },
    ]),
  );
  const reversedItems = itemSort.sort.direction === "ascending";
  const columns = metrics.spItemOrder.map((id, index) => ({
    id,
    index,
    total: metrics.spItemTotals[index],
  }));
  // Reverse the entire canonical order, including ties, so the expected
  // staircase and every response keep the same question identities.
  if (reversedItems) columns.reverse();
  const rows = sortAnalysisRows(metrics.spRows, studentSort.sort, (row, key) =>
    key === "student"
      ? studentLabel(studentById.get(row.studentId), data)
      : key === "cautionIndex"
        ? row.cautionIndex
        : row.correctCount,
  );
  const showCurves =
    ["correctCount", "correctRate"].includes(studentSort.sort.key) &&
    studentSort.sort.direction === "descending";
  return (
    <>
      <div className="qca-section-heading">
        <h3>S–P 응답표</h3>
        <InfoHelp
          label="S–P표 읽기"
          sections={[
            {
              title: "표 읽기",
              items: [
                "파란 칸은 정답, 색 없는 칸은 오답입니다. 기본 순서는 정답수가 많은 학생부터, 정답률이 낮은 문항부터입니다. 헤더로 정렬 방향을 바꿀 수 있습니다.",
                "S선은 학생별 정답수, P선은 문항별 정답자 수의 경계입니다. 학생 정답수가 높은 순일 때 표시하며, 어려운 문항부터 볼 때 S선은 오른쪽 정답 영역의 왼쪽에 놓입니다.",
              ],
            },
            {
              title: "학습 지도에 활용",
              items: [
                "주황 테두리는 정답수·정답률 순서로 예상한 계단형 응답과 다른 칸입니다. 다른 학생들이 많이 맞힌 문항을 틀렸다면 그 개념을 먼저 확인하고, 어려운 문항의 정답은 풀이 근거를 물어보세요.",
                "Sato 주의지수는 이런 응답 불일치의 정도를 살피는 참고값이며 1보다 클 수도 있습니다. 부주의나 부정행위의 확정 근거로 쓰지 않습니다.",
                "상수·만점·0점 등 계산할 수 없는 경우는 —로 표시합니다. 실제 오답과 수업 관찰을 함께 확인하세요.",
              ],
            },
          ]}
        />
      </div>
      <Table
        label="학생과 문항별 정오 S-P표"
        className="qaa-table--sp"
        style={{ minWidth: `${288 + columns.length * 32}px` }}
      >
        <colgroup>
          <col className="qaa-sp-student-column" />
          <col span={3} className="qaa-sp-metric-column" />
          <col span={columns.length} className="qaa-sp-item-column" />
        </colgroup>
        <thead>
          <tr>
            <AnalysisSortHeader
              column="student"
              label="학생"
              defaultDirection="ascending"
              {...studentSort}
            />
            <AnalysisSortHeader
              column="correctCount"
              label="정답수"
              {...studentSort}
            />
            <AnalysisSortHeader
              column="correctRate"
              label="정답률"
              {...studentSort}
            />
            <AnalysisSortHeader
              column="cautionIndex"
              label="주의지수"
              {...studentSort}
            />
            {columns.map(({ id }) => (
              <th key={id}>
                <button
                  className="qaa-text-button"
                  type="button"
                  onClick={() => onInspect(id)}
                >
                  {questionById.get(id)?.paperOrder || id}
                </button>
              </th>
            ))}
          </tr>
          <tr>
            <AnalysisSortHeader
              column="correctRate"
              label="문항 정답률 (%)"
              colSpan={4}
              defaultDirection="ascending"
              {...itemSort}
            />
            {columns.map(({ id, total }) => (
              <th key={id} scope="col">
                {number(ratio(total, metrics.sampleSize), 1)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const student = studentById.get(row.studentId);
            return (
              <tr key={row.studentId}>
                <th>{studentLabel(student, data)}</th>
                <td>{row.correctCount}</td>
                <td>{compactPercent(row.percentCorrect)}</td>
                <td>{number(row.cautionIndex, 3)}</td>
                {columns.map(({ id, index }, displayIndex) => {
                  const correct = row.responses[index];
                  const atypical =
                    index < row.correctCount ? !correct : correct;
                  const studentBoundary =
                    showCurves &&
                    row.sCurve > 0 &&
                    row.sCurve < columns.length &&
                    (reversedItems
                      ? displayIndex === columns.length - row.sCurve
                      : displayIndex + 1 === row.sCurve);
                  return (
                    <td
                      key={id}
                      className={`qaa-sp-cell${correct ? " qaa-sp-correct" : " qaa-sp-incorrect"}${atypical ? " qaa-sp-atypical" : ""}${studentBoundary ? ` qaa-sp-s-boundary${reversedItems ? " qaa-sp-s-boundary--left" : ""}` : ""}${showCurves && rowIndex + 1 === metrics.spItemTotals[index] ? " qaa-sp-p-boundary" : ""}`}
                      aria-label={`${questionById.get(id)?.paperOrder || id}번 ${correct ? "정답" : "오답"}${atypical ? ", 계단형 기준과 다름" : ""}`}
                    >
                      {correct ? "1" : "0"}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}

function AdjacentLevels({
  form,
  data,
  onInspect,
}: {
  form: AchievementAnalysis["forms"][number];
  data: QuizClassAchievement;
  onInspect: (id: string) => void;
}) {
  return (
    <>
      <div className="qca-section-heading">
        <h3>인접 수준 간 정답률 차이</h3>
        <InfoHelp
          label="인접 수준별 문항 차이"
          sections={[
            {
              items: [
                "누적 수준이 이웃한 A/B, B/C 등의 학생 집단을 비교합니다. 차이(%p) = 상위 수준 정답률 − 하위 수준 정답률이며, 각 수준 쌍에서 차이 값이 큰 순서로 최대 3문항을 보여 줍니다.",
                "차이가 양수로 클수록 상위 수준 학생이 더 많이 맞혔다는 뜻입니다. 해당 문항의 개념과 사고 과정을 살펴 하위 수준 학생이 다음 수준으로 나아가기 위한 보충 과제를 정하세요.",
                "차이가 작거나 음수이면 두 집단이 비슷하게 반응했거나 하위 집단이 더 많이 맞힌 것입니다. 문항 내용과 오답 선택을 함께 점검하세요.",
                "두 집단 모두 응시 기록이 있을 때만 계산합니다. 인원이 적으면 몇 명의 응답으로 차이가 크게 바뀌므로 인원 열을 함께 보세요. 차이만으로 문항의 적합·부적합을 판정하지 않습니다.",
              ],
            },
          ]}
        />
      </div>
      <Table label="인접 성취수준별 문항 정답률 차이">
        <thead>
          <tr>
            <th>수준</th>
            <th>문항</th>
            <th>상위 수준</th>
            <th>하위 수준</th>
            <th>차이</th>
            <th>인원</th>
          </tr>
        </thead>
        <tbody>
          {ACHIEVEMENT_LEVELS.slice(0, 4).flatMap((upper, index) => {
            const lower = ACHIEVEMENT_LEVELS[index + 1];
            const rows = form.items
              .map((item) => ({
                item,
                upper: item.levelRates.find((row) => row.level === upper)!,
                lower: item.levelRates.find((row) => row.level === lower)!,
              }))
              .filter(
                (row) => row.upper.percent != null && row.lower.percent != null,
              )
              .sort(
                (a, b) =>
                  b.upper.percent! -
                  b.lower.percent! -
                  (a.upper.percent! - a.lower.percent!),
              )
              .slice(0, 3);
            return rows.length
              ? rows.map((row) => (
                  <tr key={`${upper}:${row.item.id}`}>
                    <th>
                      {upper}/{lower}
                    </th>
                    <td>
                      <button
                        className="qaa-text-button"
                        type="button"
                        onClick={() => onInspect(row.item.id)}
                      >
                        {(
                          data.questions.find(
                            (question) => String(question.id) === row.item.id,
                          ) as any
                        )?.paperOrder || row.item.id}
                        번
                      </button>
                    </td>
                    <td>{percent(row.upper.percent)}</td>
                    <td>{percent(row.lower.percent)}</td>
                    <td>
                      {(row.upper.percent! - row.lower.percent!).toFixed(1)}%p
                    </td>
                    <td>
                      {row.upper.total}/{row.lower.total}명
                    </td>
                  </tr>
                ))
              : [
                  <tr key={upper}>
                    <th>
                      {upper}/{lower}
                    </th>
                    <td colSpan={5}>누적 수준별 응답 부족</td>
                  </tr>,
                ];
          })}
        </tbody>
      </Table>
    </>
  );
}

function PendingAchievementView({
  view,
  showHeading = true,
}: {
  view: number;
  showHeading?: boolean;
}) {
  const columns = [
    ["학생 수준", "인원", "비율", "평균", "표준편차"],
    ["문항", "출제 난도", "목표 수준", "정답률", "변별도"],
    ["성취기준", "문항 수", "응답 학생", "정답률"],
    ["학생", "회차별 점수", "누적 점수", "분석 수준"],
    ["학생", "문항별 정오", "정답 수"],
    ["학생", "누적 점수", "분석 수준", "A/B", "B/C", "C/D", "D/E"],
  ][view];
  return (
    <>
      {showHeading && (
        <div className="qca-section-heading">
          <h3>{view === 0 ? "전체 분포" : labels[view]}</h3>
        </div>
      )}
      {view === 0 && (
        <div className="qaa-metrics">
          <span>
            점수 확인 <strong>—</strong>
          </span>
          <span>
            평균 <strong>—</strong>
          </span>
          <span>
            표준편차 <strong>—</strong>
          </span>
        </div>
      )}
      <Table label={view === 0 ? "학생 성취수준별 분포" : labels[view]}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(view === 0 ? [...ACHIEVEMENT_LEVELS, "미분류"] : ["조회 전"]).map(
            (label) => (
              <tr key={label}>
                <th>{label}</th>
                {columns.slice(1).map((column) => (
                  <td key={column}>—</td>
                ))}
              </tr>
            ),
          )}
        </tbody>
      </Table>
    </>
  );
}
