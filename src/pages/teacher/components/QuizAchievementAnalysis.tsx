import { useEffect, useMemo, useRef, useState } from "react";
import InfoHelp from "../../../components/common/InfoHelp";
import {
  MockExamQuestionContent,
  type MockExamPaperQuestion,
} from "../../../components/common/MockExamPaper";
import QuizPassage from "../../../components/common/QuizPassage";
import { useAppToast } from "../../../components/common/AppToastProvider";
import {
  ACHIEVEMENT_LEVELS,
  achievementTimestamp,
  adaptAchievementAttempts,
  buildAchievementAnalysis,
  confirmedAchievementLevel,
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
import { executeLearningCommand } from "../../../lib/learningCommands";
import {
  getQuizClassAchievement,
  quizClassAnalysisError,
  type QuizClassAchievement,
  type QuizClassScope,
} from "../../../lib/quizClassAnalysis";
import "./QuizAchievementAnalysis.css";

const percent = (value: number | null | undefined) =>
  value == null ? "—" : `${value.toFixed(1)}%`;
const number = (value: number | null | undefined, digits = 2) =>
  value == null ? "—" : value.toFixed(digits);
const difficultyLabel = (value: string | undefined) =>
  ({ easy: "쉬움", medium: "보통", hard: "어려움" })[value || ""] || "미지정";
const levelLabel = (value: string) =>
  value === "unclassified" ? "미분류" : value;
const labels = [
  "전체 결과",
  "문항 분석",
  "성취기준",
  "사전 근거·수준 확인",
  "S–P표",
];
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

export default function QuizAchievementAnalysis({
  scope,
  identityKey,
  canEdit,
  enabled = true,
  refreshVersion = 0,
  onLoadingChange,
}: {
  scope: QuizClassScope;
  identityKey: string;
  canEdit: boolean;
  enabled?: boolean;
  refreshVersion?: number;
  onLoadingChange?: (loading: boolean) => void;
}) {
  const [data, setData] = useState<QuizClassAchievement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [view, setView] = useState(0);
  const [standardCode, setStandardCode] = useState("");
  const [formKey, setFormKey] = useState("");
  const [questionId, setQuestionId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [choiceQuestionId, setChoiceQuestionId] = useState("");
  const [evidenceUid, setEvidenceUid] = useState("");
  const [draftLevels, setDraftLevels] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState("");
  const [saveError, setSaveError] = useState("");
  const [confirmations, setConfirmations] = useState<Record<string, boolean>>(
    {},
  );
  const currentIdentity = useRef(identityKey);
  currentIdentity.current = identityKey;
  const previewRef = useRef<HTMLDivElement>(null);
  const { showToast } = useAppToast();
  const requestKey = JSON.stringify([
    identityKey,
    scope.semesterId,
    scope.unitId,
    scope.examRound,
    scope.classIds,
  ]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setData(null);
    setQuestionId("");
    setProfileId("");
    setDraftLevels({});
    setConfirmations({});
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
          result.students.some(
            (student) => student.classId !== scope.classIds[0],
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
            evidence: data.achievementEvidence,
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
            evidence: data.achievementEvidence,
            resolveCodes,
            reviewedProfiles: data.profiles,
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
              evidence: data.achievementEvidence,
              resolveCodes,
              reviewedProfiles: data.profiles,
              standardCode,
            })
          : full
        : null,
    [data, full, standardCode, attempts, resolveCodes, scope.semesterId],
  );
  const form =
    analysis?.forms.find((value) => value.key === formKey) ||
    (analysis?.forms.length === 1 ? analysis.forms[0] : null);
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
    if (questionId) requestAnimationFrame(() => previewRef.current?.focus());
  }, [questionId]);
  const toolbar = (
    <div className="qaa-toolbar">
      <label>
        성취기준
        <select
          value={standardCode}
          disabled={!enabled || loading || !data}
          onChange={(event) => {
            setStandardCode(event.target.value);
            setProfileId("");
            setDraftLevels({});
            setConfirmations({});
          }}
        >
          <option value="">전체 기준</option>
          {(full?.standards || []).map((row) => (
            <option key={row.code} value={row.code}>
              {row.code} ·{" "}
              {getHistoryAchievementStandard(row.code)?.description ||
                "성취기준"}
            </option>
          ))}
        </select>
      </label>
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
      <InfoHelp label="성취 분석 집계 기준">
        학생별 첫 제출을 사용하며 A–E는 교사가 사전 학습 근거를 검토해 확인한
        분석용 수준입니다. 점수 구간·순위·학습지 채움률로 수준을 정하지
        않습니다. 목표 A–E는 출제자가 문항에 지정한 수준입니다. 기록 부족은
        미분류로 남고 공식 점수와 성적은 바뀌지 않습니다.
      </InfoHelp>
    </div>
  );
  if (!enabled || loading || error || !data || !analysis || !full)
    return (
      <section className="quiz-achievement-analysis" aria-label="성취기준 분석">
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
              ? "학급을 선택하고 결과를 조회해 주세요."
              : "성취기준과 사전 학습 근거를 불러오는 중입니다."}
          </p>
        )}
        <PendingAchievementView view={view} />
      </section>
    );

  const inspect = (id: string) => {
    setQuestionId(id);
  };
  const saveLevel = async (uid: string) => {
    if (!standardCode || !canEdit || data.canReview !== true || saving) return;
    const attempt = analysis.attempts.find((value) => value.studentUid === uid);
    const existing = data.profiles?.find(
      (value) =>
        value.studentUid === uid && value.standardCode === standardCode,
    );
    const chosen = draftLevels[uid] ?? existing?.level ?? "";
    if (chosen && (!attempt?.startedAt || !confirmations[uid])) return;
    const refs = data.achievementEvidence.observations
      .filter(
        (row) =>
          row.studentUid === uid &&
          row.recordSource === "canonical" &&
          row.source !== "worksheet" &&
          row.resultId &&
          row.questionId &&
          achievementTimestamp(row.observedAt) != null &&
          achievementTimestamp(row.observedAt)! < (attempt?.startedAt || 0) &&
          resolveCodes(row).codes.includes(standardCode),
      )
      .map((row) => ({ resultId: row.resultId!, questionId: row.questionId! }));
    const evidenceRefs = [
      ...new Map(
        refs.map((ref) => [`${ref.resultId}:${ref.questionId}`, ref]),
      ).values(),
    ].slice(0, 60);
    if (chosen && !evidenceRefs.length) {
      setSaveError("이 성취기준에 연결된 사전 평가 근거가 없습니다.");
      return;
    }
    setSaving(uid);
    setSaveError("");
    try {
      await executeLearningCommand("saveAchievementProfile", {
        semesterId: scope.semesterId,
        classId: scope.classIds[0],
        unitId: scope.unitId,
        examRound: scope.examRound,
        studentUid: uid,
        standardCode,
        level: chosen || null,
        expectedRevision: existing?.revision || 0,
        ...(chosen
          ? {
              examAttemptId: attempt!.attemptId,
              evidenceRefs,
              mappingConfirmed: true,
              expectedRubricVersion: data.rubricVersion,
            }
          : {}),
      });
      if (currentIdentity.current !== identityKey) return;
      showToast({ title: "분석용 성취수준을 저장했습니다.", tone: "success" });
      setConfirmations({});
      setDraftLevels({});
      setReload((value) => value + 1);
    } catch (failure) {
      setSaveError(
        failure instanceof Error
          ? failure.message
          : "수준을 저장하지 못했습니다.",
      );
    } finally {
      setSaving("");
    }
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
    <section className="quiz-achievement-analysis" aria-label="성취기준 분석">
      {toolbar}
      {data.achievementEvidence.status === "partial" && (
        <p className="qca-muted" role="status">
          일부 사전 근거 제외 · 시각·버전·보관 범위를 확인해 주세요.
        </p>
      )}
      <div className="qaa-scope">
        <span>첫 제출 {analysis.attempts.length}명</span>
        {analysis.unclassifiedItemCount > 0 && (
          <span>미연결 응답 {analysis.unclassifiedItemCount}건</span>
        )}
        {analysis.missingCutoffCount > 0 && (
          <span>시작 시각 미확인 {analysis.missingCutoffCount}명</span>
        )}
        <InfoHelp label="제외된 분석 근거">
          사전 근거는 해당 학생의 모의고사 시작 전 기록만 포함합니다. 미래 기록{" "}
          {analysis.futureEvidenceCount}건, 응시 순서 미확인{" "}
          {analysis.excludedChronologyCount}명. 서버에서 시각·소유·버전 확인 후
          제외한 근거{" "}
          {Object.values(data.achievementEvidence.exclusions || {}).reduce(
            (sum, count) => sum + count,
            0,
          )}
          건.
        </InfoHelp>
      </div>
      {view === 0 && (
        <>
          <div className="qca-section-heading">
            <h3>전체 분포</h3>
            <InfoHelp label="점수 분포와 수준 분포">
              점수 분포는 원래 제출 점수이며 A–E 분류에 사용하지 않습니다.
              평균·표준편차는 표시 학생의 실제 점수로 계산합니다. 전체
              기준에서는 종합 성취수준을 추정하지 않고 미분류로 표시하며,
              성취기준을 선택하면 교사가 확인한 해당 기준의 A–E를 사용합니다.
            </InfoHelp>
          </div>
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
          <Histogram analysis={analysis} />
          <div
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
                  className={`qaa-level-${row.level}`}
                  style={{ width: `${row.percent}%` }}
                  title={`${levelLabel(row.level)} ${percent(row.percent)}`}
                />
              ))}
          </div>
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
          <FormChoice
            analysis={analysis}
            formKey={formKey}
            setFormKey={setFormKey}
          />
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
                  신뢰도 α <strong>{number(form.alpha, 3)}</strong>
                </span>
                <span>
                  측정 표준오차{" "}
                  <strong>
                    {form.psychometrics.semPercent == null
                      ? "—"
                      : `${number(form.psychometrics.semPercent, 1)}%p`}
                  </strong>
                </span>
                {form.alpha != null && form.alpha < 0 && (
                  <span className="qca-muted">음의 α · 문항 구성 검토</span>
                )}
                <InfoHelp label="신뢰도 계산">
                  같은 문항 구성·버전의 완전한 최초 정오표로 계산한 이분문항
                  α(KR-20)입니다. 문항을 동일 배점 정오로 취급하며 학생의
                  성취수준을 정하지 않습니다. 표준오차는 동일 배점 정답수의 표본
                  표준편차 × √(1−α)를 백분율로 환산한 값으로 원래 가중 점수의
                  오차와 다릅니다. 3명 미만·상수 점수·문항 부족은 계산하지
                  않습니다.{" "}
                  {form.sampleSize < 20 ? "20명 미만 소표본입니다." : ""}
                  {form.psychometrics.semUnavailableReason
                    ? ` 표준오차 미산출: ${statisticReason(form.psychometrics.semUnavailableReason)}.`
                    : ""}
                </InfoHelp>
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
                <InfoHelp label="문항 통계 계산">
                  변별도는 이 문항을 제외한 정답수와 문항 정오의 상관입니다. D는
                  정답수 상·하위 각 27%의 정답률 차이이며 경계 동점이면 계산하지
                  않습니다. 제거 시 α는 해당 문항을 제외한 신뢰도입니다. 선지
                  비율은 무응답을 포함한 전체 표본이 분모이며 답안 미보관은
                  0으로 채우지 않습니다. A–E는 해당 성취기준의 교사 확인
                  수준입니다.
                </InfoHelp>
              </div>
              <Table label="문항별 통계와 학생 수준별 정답률" wide>
                <thead>
                  <tr>
                    <th>문항</th>
                    <th>출제 난도</th>
                    <th>목표 수준</th>
                    <th>정답률</th>
                    <th>변별도</th>
                    <th>D (27%)</th>
                    <th>제거 시 α</th>
                    {[1, 2, 3, 4, 5].map((value) => (
                      <th key={value}>선지 {value}</th>
                    ))}
                    <th>무응답</th>
                    {[...ACHIEVEMENT_LEVELS, "unclassified"].map((value) => (
                      <th key={value}>{levelLabel(value)}</th>
                    ))}
                    <th>수준 프로필</th>
                  </tr>
                </thead>
                <tbody>
                  {form.items.map((item) => {
                    const question = data.questions.find(
                      (row) => String(row.id) === item.id,
                    );
                    return (
                      <FragmentRows
                        key={item.id}
                        item={item}
                        question={question}
                        onInspect={inspect}
                        expanded={profileId === item.id}
                        onToggle={() =>
                          setProfileId(profileId === item.id ? "" : item.id)
                        }
                      />
                    );
                  })}
                </tbody>
              </Table>
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
            <InfoHelp label="성취기준 성취율">
              배점 가중 성취율은 연결 문항의 획득 배점 합계 ÷ 만점 합계입니다.
              복수 기준 문항은 각 기준에 포함하므로 기준 행을 합산하지 않습니다.
              배점 미보관은 제외합니다. A–E 문항 목표수준별 정답률을 학생의
              등급으로 해석하지 않습니다.
            </InfoHelp>
          </div>
          {standardCode && (
            <AchievementRubric key={standardCode} code={standardCode} />
          )}
          <Table label="성취기준별 배점 가중 성취율">
            <thead>
              <tr>
                <th>성취기준</th>
                <th>배점 가중 성취율</th>
                <th>정답 / 응답</th>
                <th>학생</th>
                <th>진단평가</th>
                <th>형성평가</th>
                <th>학습지 채움</th>
                <th>입력 중 정답</th>
              </tr>
            </thead>
            <tbody>
              {analysis.standards.map((row) => (
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
                  <td>
                    {percent(row.diagnostic.percent)}
                    <small>
                      {row.diagnostic.correct}/{row.diagnostic.total}
                    </small>
                  </td>
                  <td>
                    {percent(row.formative.percent)}
                    <small>
                      {row.formative.correct}/{row.formative.total}
                    </small>
                  </td>
                  <td>
                    {row.worksheet.filled}/{row.worksheet.recorded}
                  </td>
                  <td>
                    {row.worksheet.correct}/{row.worksheet.gradedFilled}
                  </td>
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
            <h3>문항 목표수준·난도별 비교</h3>
            <InfoHelp label="예상 성취율 계산">
              예상치는 각 학생의 시험 시작 전 동일 기준·문항 목표수준·난도에서
              서로 다른 문항계열 3개 이상에 대한 최초 정답률입니다. 같은
              문항계열, 힌트·지원 여부 미확인, 수정 답안, 학습지 채움은
              예상치에서 제외합니다. 3개는 자료 표시 기준이며 성취수준
              분할점수가 아닙니다. 예상과 실제 비교는 예상치를 계산할 수 있는
              동일 학생·응답에 한정하며 차이가 학습 효과나 문항 적합성을
              확정하지 않습니다.
            </InfoHelp>
          </div>
          <Table label="목표 수준과 난도별 예상 실제 성취율">
            <thead>
              <tr>
                <th>성취기준</th>
                <th>문항 목표수준</th>
                <th>출제 난도</th>
                <th>전체 실제</th>
                <th>사전 근거 예상</th>
                <th>비교 대상 실제</th>
                <th>실제−예상</th>
                <th>비교 인원 / 응답</th>
                <th>사전 근거</th>
              </tr>
            </thead>
            <tbody>
              {analysis.cells.map((row) => (
                <tr
                  key={`${row.standardCode}:${row.targetLevel}:${row.difficulty}`}
                >
                  <th>{row.standardCode}</th>
                  <td>{row.targetLevel || "미지정"}</td>
                  <td>{difficultyLabel(row.difficulty)}</td>
                  <td>
                    {percent(row.actual.percent)}
                    <small>
                      {row.actual.correct}/{row.actual.total}
                    </small>
                  </td>
                  <td>{percent(row.expectedPercent)}</td>
                  <td>{percent(row.pairedActual.percent)}</td>
                  <td>
                    {row.expectedPercent == null ||
                    row.pairedActual.percent == null
                      ? "근거 부족"
                      : `${(row.pairedActual.percent - row.expectedPercent).toFixed(1)}%p`}
                  </td>
                  <td>
                    {row.pairedStudentCount}명 / {row.pairedActual.total}건
                  </td>
                  <td>
                    {row.priorEvidenceCount}건
                    <small>비교 제외 {row.missingBaselineCount}건</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
      {view === 3 && (
        <>
          <div className="qca-section-heading qaa-evidence-heading">
            <h3>사전 학습 근거와 학생 수준</h3>
            <InfoHelp label="교사 수준 확인">
              시험 시작 전 진단·형성평가와 학습지 상태를 검토한 뒤 성취기준별
              분석용 A–E를 확인합니다. 완료율은 참여 근거이고 오답·미입력·지원
              여부 미확인은 구별합니다. 정답률을 자동으로 A–E에 대응하지
              않습니다. 저장은 공식 점수에 영향을 주지 않습니다.
            </InfoHelp>
            {standardCode && (
              <AchievementRubric
                key={standardCode}
                code={standardCode}
                compact
              />
            )}
          </div>
          {!standardCode ? (
            <p className="qca-empty">
              학생 수준을 확인할 성취기준을 선택해 주세요.
            </p>
          ) : (
            <>
              {saveError && (
                <div role="alert" className="qca-error">
                  {saveError}
                </div>
              )}
              <Table label="학생별 사전 근거와 교사 수준 확인">
                <thead>
                  <tr>
                    <th>학생</th>
                    <th>진단 정답 / 응답</th>
                    <th>형성 정답 / 응답</th>
                    <th>학습지 채움</th>
                    <th>학습지 입력 중 정답</th>
                    <th>분석용 수준</th>
                    <th>근거 확인</th>
                    <th>저장</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.students.map((row) => {
                    const stats = row.standards.find(
                      (value) => value.code === standardCode,
                    );
                    const existing = data.profiles?.find(
                      (value) =>
                        value.studentUid === row.student.uid &&
                        value.standardCode === standardCode,
                    );
                    const selected =
                      draftLevels[row.student.uid] ?? existing?.level ?? "";
                    return (
                      <tr key={row.student.uid}>
                        <th>
                          {row.student.number || ""}{" "}
                          {row.student.name || "이름 미등록"}
                          <button
                            type="button"
                            className="qaa-text-button"
                            aria-expanded={evidenceUid === row.student.uid}
                            onClick={() =>
                              setEvidenceUid(
                                evidenceUid === row.student.uid
                                  ? ""
                                  : row.student.uid,
                              )
                            }
                          >
                            근거 보기
                          </button>
                        </th>
                        <td>
                          {stats
                            ? `${stats.diagnostic.correct}/${stats.diagnostic.total}`
                            : "—"}
                        </td>
                        <td>
                          {stats
                            ? `${stats.formative.correct}/${stats.formative.total}`
                            : "—"}
                        </td>
                        <td>
                          {stats
                            ? `${stats.worksheet.filled}/${stats.worksheet.recorded}`
                            : "—"}
                        </td>
                        <td>
                          {stats
                            ? `${stats.worksheet.correct}/${stats.worksheet.gradedFilled}`
                            : "—"}
                        </td>
                        <td>
                          {existing?.stale && (
                            <small>준거 변경 · 재확인 필요</small>
                          )}
                          <select
                            aria-label={`${row.student.name || row.student.number} 성취수준`}
                            value={selected}
                            disabled={!canEdit || !data.canReview || !!saving}
                            onChange={(event) =>
                              setDraftLevels((current) => ({
                                ...current,
                                [row.student.uid]: event.target.value,
                              }))
                            }
                          >
                            <option value="">미분류</option>
                            {ACHIEVEMENT_LEVELS.map((value) => (
                              <option key={value}>{value}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <label className="qaa-check">
                            <input
                              type="checkbox"
                              checked={confirmations[row.student.uid] || false}
                              disabled={
                                !canEdit ||
                                !data.canReview ||
                                !selected ||
                                !row.attempt?.startedAt
                              }
                              onChange={(event) =>
                                setConfirmations((current) => ({
                                  ...current,
                                  [row.student.uid]: event.target.checked,
                                }))
                              }
                            />
                            사전 근거 검토
                          </label>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="qca-secondary"
                            disabled={
                              !canEdit ||
                              !data.canReview ||
                              !!saving ||
                              (selected === (existing?.level || "") &&
                                !existing?.stale) ||
                              (!!selected && !confirmations[row.student.uid])
                            }
                            onClick={() => void saveLevel(row.student.uid)}
                          >
                            {saving === row.student.uid ? "저장 중…" : "저장"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              {evidenceUid && (
                <EvidenceDetails
                  data={data}
                  analysis={analysis}
                  uid={evidenceUid}
                  code={standardCode}
                  resolveCodes={resolveCodes}
                />
              )}
            </>
          )}
        </>
      )}
      {view === 4 && (
        <>
          <FormChoice
            analysis={analysis}
            formKey={formKey}
            setFormKey={setFormKey}
          />
          <SpTable
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
        <InfoHelp label="성취수준 준거의 출처">
          {HISTORY_ACHIEVEMENT_RUBRIC_SOURCE} {rubric.sourcePages.join(", ")}
          쪽의 {rubric.sourceStandards.join(", ")}를 참고해 중학교 역사② 범위에
          맞춰 재구성한 교사 검토용 준거입니다. 공식 중학교 성취수준 원문이
          아닙니다. {rubric.mappingNote}
        </InfoHelp>
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

function EvidenceDetails({
  data,
  analysis,
  uid,
  code,
  resolveCodes,
}: {
  data: QuizClassAchievement;
  analysis: AchievementAnalysis;
  uid: string;
  code: string;
  resolveCodes: (value: AchievementMetadata) => {
    codes: string[];
    source: string;
  };
}) {
  const attempt = analysis.attempts.find((row) => row.studentUid === uid);
  const student = data.students.find((row) => row.uid === uid);
  const rows =
    attempt?.startedAt == null
      ? []
      : data.achievementEvidence.observations
          .filter(
            (row) =>
              row.studentUid === uid &&
              resolveCodes(row).codes.includes(code) &&
              achievementTimestamp(row.observedAt) != null &&
              achievementTimestamp(row.observedAt)! < attempt.startedAt!,
          )
          .sort(
            (a, b) =>
              achievementTimestamp(b.observedAt)! -
              achievementTimestamp(a.observedAt)!,
          );
  return (
    <section aria-label={`${student?.name || "학생"} 사전 근거`}>
      <div className="qca-section-heading">
        <h4>
          {student?.number || ""} {student?.name || "학생"} · 사전 근거
        </h4>
        <InfoHelp label="근거 보관 범위">
          모의고사 시작 전 기록입니다. 같은 문항의 반복 응답은 각각 확인할 수
          있으나 요약에는 마지막 상태, 예상에는 독립 문항계열 최초 응답을
          사용합니다. 학습지의 정답은 입력값 검사를 뜻하고 독립 수행으로
          단정하지 않습니다. 제한된 자료는 당시 고정 문항으로 복원했거나 지원
          여부를 확인할 수 없는 근거입니다. 수준 저장에는 연결된 서버 평가
          근거를 최대 60개 기록합니다.
        </InfoHelp>
      </div>
      {rows.length ? (
        <Table label="선택 학생의 사전 학습 근거">
          <thead>
            <tr>
              <th>유형</th>
              <th>문항·빈칸</th>
              <th>정오</th>
              <th>입력</th>
              <th>지원 사용</th>
              <th>기록 시각</th>
              <th>보관 범위</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.source}:${row.id}:${i}`}>
                <td>
                  {
                    {
                      diagnostic: "진단",
                      formative: "형성",
                      worksheet: "학습지",
                    }[row.source]
                  }
                </td>
                <td>{row.itemId}</td>
                <td>
                  {row.source === "worksheet" && row.filled !== true
                    ? "미입력"
                    : row.correct === null
                      ? "미확인"
                      : row.correct
                        ? "정답"
                        : "오답"}
                </td>
                <td>
                  {row.filled === null
                    ? "미확인"
                    : row.filled
                      ? "입력"
                      : "미입력"}
                </td>
                <td>
                  {row.hintViewed === null
                    ? "미확인"
                    : row.hintViewed
                      ? "있음"
                      : "없음"}
                </td>
                <td>
                  {new Intl.DateTimeFormat("ko-KR", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Asia/Seoul",
                  }).format(new Date(achievementTimestamp(row.observedAt)!))}
                </td>
                <td>{row.quality === "limited" ? "제한된 근거" : "보관됨"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="qca-empty">
          시작 시각 이전의 연결 근거를 확인하지 못했습니다.
        </p>
      )}
    </section>
  );
}

function Table({
  children,
  label,
  wide = false,
}: {
  children: React.ReactNode;
  label: string;
  wide?: boolean;
}) {
  return (
    <div
      className="qca-table-scroll qaa-table-scroll"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table className={`qca-table qaa-table${wide ? " qaa-table--wide" : ""}`}>
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
          <div style={{ height: `${(row.count / maximum) * 100}%` }} />
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
      {paths.map((value, i) => (
        <path key={i} d={value} className="qaa-profile-path" />
      ))}
      {item.levelRates.map((row, i) => (
        <g key={row.level}>
          {row.percent != null && (
            <circle cx={x(i)} cy={y(row.percent)} r={compact ? 2 : 4} />
          )}
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
          {percent(item.correctRate)}
          <small>n={item.sampleSize}</small>
        </td>
        <td>{number(item.discrimination, 3)}</td>
        <td>
          {number(item.upperLower27)}
          <small>
            {item.upperLowerCount
              ? `각 ${item.upperLowerCount}명`
              : "표본·동점 확인"}
          </small>
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
            {percent(item.choices[index]?.percent)}
          </td>
        ))}
        <td>
          {item.missingAnswer
            ? "미보관 포함"
            : percent(ratio(item.unanswered, item.sampleSize))}
        </td>
        {item.levelRates.map((row) => (
          <td key={row.level}>
            {percent(row.percent)}
            <small>n={row.total}</small>
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
              선지 {i + 1}
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
                  confirmedAchievementLevel(
                    data.profiles || [],
                    attempt.studentUid,
                    [code],
                    attempt.startedAt,
                    attempt.attemptId,
                  ) === value,
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
        <InfoHelp label="관찰 난도 분류">
          관찰 난도는 기존 문항 분석과 같이 첫 제출 정답률 85% 이상 쉬움, 50%
          이하 어려움, 그 사이 보통으로 표시합니다. 문항 정답률의 설명용
          범주이며 학생 A–E 분할점수가 아닙니다. 출제 난도는 교사가 입력한
          값입니다.
        </InfoHelp>
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
  if (!formKey) return null;
  const metrics = analysis.forms.find(
    (form) => form.key === formKey,
  )!.psychometrics;
  const ids = metrics.spItemOrder;
  return (
    <>
      <div className="qca-section-heading">
        <h3>S–P 응답표</h3>
        <InfoHelp label="S–P표 읽기">
          학생은 정답수 순, 문항은 정답률 순입니다. 동일 정답수·정답률 내 순서는
          표시용이며 학생 수준을 뜻하지 않습니다. 파란 세로선은 학생 정답수
          경계(S), 회색 가로선은 문항 정답자수 경계(P)입니다. 각 학생의
          정답수까지 모두 맞힌 계단형 기준과 다른 응답을 표시합니다. Sato
          주의지수는 응답 불일치의 원시 지표이고 1보다 클 수도 있습니다.
          상수·만점·0점 등 계산 불가는 —로 두며 부주의·부정행위를 확정하지
          않습니다.
        </InfoHelp>
      </div>
      <Table label="학생과 문항별 정오 S-P표" wide>
        <thead>
          <tr>
            <th>학생</th>
            <th>정답수</th>
            <th>주의지수</th>
            {ids.map((id) => (
              <th key={id}>
                <button
                  className="qaa-text-button"
                  type="button"
                  onClick={() => onInspect(id)}
                >
                  {(
                    data.questions.find(
                      (question) => String(question.id) === id,
                    ) as any
                  )?.paperOrder || id}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.spRows.map((row, rowIndex) => {
            const student = data.students.find(
              (student) => student.uid === row.studentId,
            );
            return (
              <tr key={row.studentId}>
                <th>
                  {student?.number || ""} {student?.name || "학생"}
                </th>
                <td>{row.correctCount}</td>
                <td>{number(row.cautionIndex, 3)}</td>
                {ids.map((id, index) => {
                  const correct = row.responses[index];
                  const atypical =
                    index < row.correctCount ? !correct : correct;
                  return (
                    <td
                      key={id}
                      className={`qaa-sp-cell${atypical ? " qaa-sp-atypical" : ""}${index + 1 === row.sCurve ? " qaa-sp-s-boundary" : ""}${rowIndex + 1 === metrics.spItemTotals[index] ? " qaa-sp-p-boundary" : ""}`}
                      aria-label={`${id}번 ${correct ? "정답" : "오답"}${atypical ? ", 계단형 기준과 다름" : ""}`}
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
        <InfoHelp label="인접 수준별 문항 차이">
          교사가 확인한 인접 A–E 집단의 정답률 차이가 큰 문항을 보여 줍니다. 두
          집단 모두 관찰된 경우만 계산하며 차이가 특정 수치 이상이라는 이유로
          문항을 합격·부적합으로 판정하지 않습니다. 소표본에서 차이는 크게
          흔들릴 수 있습니다.
        </InfoHelp>
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
                    <td colSpan={5}>교사 확인 수준별 응답 부족</td>
                  </tr>,
                ];
          })}
        </tbody>
      </Table>
    </>
  );
}

function PendingAchievementView({ view }: { view: number }) {
  const columns = [
    ["학생 수준", "인원", "비율", "평균", "표준편차"],
    ["문항", "출제 난도", "목표 수준", "정답률", "변별도"],
    ["성취기준", "문항 수", "응답 학생", "정답률"],
    ["학생", "사전 학습 근거", "확인 수준"],
    ["학생", "문항별 정오", "정답 수"],
  ][view];
  return (
    <>
      <div className="qca-section-heading">
        <h3>{view === 0 ? "전체 분포" : labels[view]}</h3>
      </div>
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
