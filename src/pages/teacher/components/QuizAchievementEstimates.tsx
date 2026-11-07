import { useMemo, useState } from "react";
import InfoHelp from "../../../components/common/InfoHelp";
import { ACHIEVEMENT_LEVELS } from "../../../lib/achievementAnalysis";
import {
  buildCurrentAchievementEstimates,
  buildEstimatedCutScores,
} from "../../../lib/achievementEstimates";
import {
  getHistoryAchievementRubric,
  getHistoryAchievementStandard,
  resolveQuestionAchievement,
} from "../../../lib/historyAchievement";
import type { QuizClassAchievement } from "../../../lib/quizClassAnalysis";

const pct = (value: number | null) =>
  value == null ? "—" : `${value.toFixed(1)}%`;
const difficultyLabel = {
  easy: "쉬움",
  medium: "보통",
  hard: "어려움",
  unassigned: "미지정",
};

export default function QuizAchievementEstimates({
  data,
  semesterId,
  standardCode,
}: {
  data: QuizClassAchievement;
  semesterId: string;
  standardCode: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [studentStandard, setStudentStandard] = useState("");
  const report = useMemo(
    () =>
      buildCurrentAchievementEstimates({
        semesterId,
        students: data.students,
        questions: data.questions,
        evidence: data.achievementEvidence,
        asOf: data.generatedAt,
        resolveCodes: (value) =>
          resolveQuestionAchievement(value, data.treeData),
      }),
    [data, semesterId],
  );
  const questions = useMemo(
    () =>
      data.questions.filter(
        (question) =>
          !standardCode ||
          resolveQuestionAchievement(question, data.treeData).codes.includes(
            standardCode,
          ),
      ),
    [data, standardCode],
  );
  const cutScores = useMemo(
    () => buildEstimatedCutScores(questions),
    [questions],
  );
  const dCut = cutScores.cuts.find((cut) => cut.level === "D")!;
  const standards = report.standards.filter(
    (row) => !standardCode || row.code === standardCode,
  );
  const selected =
    standards.find((row) => row.code === studentStandard) || standards[0];
  const rubric = selected ? getHistoryAchievementRubric(selected.code) : null;
  const studentName = (student: QuizClassAchievement["students"][number]) =>
    [
      data.grade || data.configuredClasses.length > 1
        ? data.configuredClasses.find((entry) => entry.id === student.classId)
            ?.label
        : "",
      student.number ? `${student.number}번` : "",
      student.name || "이름 미등록",
    ]
      .filter(Boolean)
      .join(" ");
  return (
    <div className="qaa-estimates">
      <div className="qca-section-heading">
        <h3>진단·형성평가 기반 현재 성취수준</h3>
        <InfoHelp label="현재 성취수준 추정 기준">
          조회 시점까지의 같은 학기 진단·형성평가만 사용합니다. 같은 문항계열은
          최초 풀이 한 번만 반영하고, 힌트를 본 답안·미래 기록은 제외합니다.
          서로 다른 문항계열이 3개 미만이면 자료 부족으로 표시합니다. 목표수준의
          예상 정답률 65%를 기준으로 답안 패턴을 비교한 모형 추정이며 공식
          성취도나 교사 확인값을 바꾸지 않습니다. 힌트 여부 미확인 기록은 절반의
          가중치로 반영합니다. 적은 답안으로 극단적인 수준을 추정하지 않도록
          수준값 2(C), 표준편차 1.5의 약한 사전분포를 사용합니다. 수준 범위는
          모형의 80% 구간이며 검증된 신뢰구간을 뜻하지 않습니다.
        </InfoHelp>
      </div>
      <div className="qaa-table-wrap">
        <table className="qaa-table" aria-label="성취기준별 현재 성취수준 추정">
          <thead>
            <tr>
              <th>성취기준</th>
              {ACHIEVEMENT_LEVELS.map((level) => (
                <th key={level}>{level} 추정</th>
              ))}
              <th>자료 부족</th>
            </tr>
          </thead>
          <tbody>
            {standards.map((row) => (
              <tr key={row.code}>
                <th>
                  {row.code}
                  <small>
                    {getHistoryAchievementStandard(row.code)?.description}
                  </small>
                </th>
                {ACHIEVEMENT_LEVELS.map((level) => (
                  <td key={level}>{row.counts[level]}명</td>
                ))}
                <td>{row.unknownCount}명</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!standards.length && (
        <p className="qca-muted">연결된 성취기준이 없습니다.</p>
      )}

      <div className="qca-section-heading qaa-estimate-heading">
        <h3>난도별 A–E 예상 성취율</h3>
        <span className="qca-muted">모형 추정 · 교사 검토용</span>
        <InfoHelp label="예상 성취율과 분할점수 산출식">
          경기도교육청 「고등학교 성취평가 추정분할점수 이렇게
          산출해요(실전편)」 12~17쪽의 목표수준 최소 능력자 예상 정답률 약 65%를
          참고했습니다. 아래 수치는 자료에 정해진 표가 아닌 위스토리의 계산
          초깃값입니다. A=4, B=3, C=2, D=1, E=0으로 두고
          p=1/(1+exp(−(ln(0.65/0.35)+0.8×(수준−문항 목표수준))))로 계산합니다.
          목표수준 미지정은 쉬움=D, 보통=C, 어려움=B로 보완하고 난도도
          미지정이면 C를 사용합니다. 0.8과 보완 기준은 서비스의 모형 가정입니다.
          각 난도 성취율은 문항 배점으로 가중한 예상 정답률, 분할점수는 Σ(문항
          배점×p)입니다. 배점이 하나라도 없으면 모든 문항을 동일 가중치로 두고
          100점 환산값만 제공합니다. 이 고등학교 참고자료의 경계를 중학교 공식
          성취도로 적용하거나 저장하지 않습니다.
        </InfoHelp>
      </div>
      <div className="qaa-table-wrap">
        <table className="qaa-table" aria-label="난도별 A–E 예상 성취율">
          <thead>
            <tr>
              <th>출제 난도</th>
              <th>문항 수</th>
              <th>배점 합</th>
              {ACHIEVEMENT_LEVELS.map((level) => (
                <th key={level}>{level}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cutScores.rows
              .filter(
                (row) => row.difficulty !== "unassigned" || row.questionCount,
              )
              .map((row) => (
                <tr key={row.difficulty}>
                  <th>
                    {difficultyLabel[row.difficulty]}
                    {!row.questionCount && <small>문항 없음 · 기본 모형</small>}
                  </th>
                  <td>{row.questionCount}문항</td>
                  <td>{row.points == null ? "—" : `${row.points}점`}</td>
                  {ACHIEVEMENT_LEVELS.map((level) => (
                    <td key={level}>{pct(row.rates[level])}</td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="qca-section-heading qaa-estimate-heading">
        <h3>추정 분할점수</h3>
        <span className="qca-muted">
          {cutScores.questionCount}문항 ·{" "}
          {cutScores.totalPoints == null
            ? "동일 가중치"
            : `${cutScores.totalPoints}점 만점`}
          {cutScores.assumedTargets
            ? ` · 목표수준 보완 ${cutScores.assumedTargets}문항`
            : ""}
        </span>
      </div>
      <div className="qaa-table-wrap">
        <table className="qaa-table" aria-label="성취수준별 추정 분할점수">
          <thead>
            <tr>
              <th>구분</th>
              {cutScores.cuts.map((cut) => (
                <th key={cut.level}>
                  {cut.level} {cut.level === "E" ? "범위" : "경계"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>시험지 점수</th>
              {cutScores.cuts.map((cut) => (
                <td key={cut.level}>
                  {cut.level === "E"
                    ? dCut.score == null
                      ? "—"
                      : `${dCut.score.toFixed(2)}점 미만`
                    : cut.score == null
                      ? "—"
                      : `${cut.score.toFixed(2)}점`}
                </td>
              ))}
            </tr>
            <tr>
              <th>100점 환산</th>
              {cutScores.cuts.map((cut) => (
                <td key={cut.level}>
                  {cut.level === "E"
                    ? dCut.percent == null
                      ? "—"
                      : `${dCut.percent.toFixed(1)}점 미만`
                    : cut.percent == null
                      ? "—"
                      : `${cut.percent.toFixed(1)}점`}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {selected && (
        <details
          className="qaa-estimate-details"
          open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
        >
          <summary>학생별 추정 수준과 성취수준 준거</summary>
          {expanded && (
            <>
              <label className="qaa-estimate-standard">
                성취기준
                <select
                  aria-label="추정 수준 학생 목록 성취기준"
                  value={selected.code}
                  onChange={(event) => setStudentStandard(event.target.value)}
                >
                  {standards.map((row) => (
                    <option value={row.code} key={row.code}>
                      {row.code} ·{" "}
                      {getHistoryAchievementStandard(row.code)?.description}
                    </option>
                  ))}
                </select>
              </label>
              {rubric && (
                <dl className="qaa-rubric">
                  {ACHIEVEMENT_LEVELS.map((level) => (
                    <div className="qaa-rubric-row" key={level}>
                      <dt>{level}</dt>
                      <dd>{rubric.levels[level]}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="qaa-table-wrap">
                <table
                  className="qaa-table"
                  aria-label="학생별 현재 성취수준 추정"
                >
                  <thead>
                    <tr>
                      <th>학생</th>
                      <th>추정 수준</th>
                      <th>수준 범위</th>
                      <th>진단·형성 정답률</th>
                      <th>독립 문항</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.students.map((row) => (
                      <tr key={row.student.uid}>
                        <th>{studentName(row.student)}</th>
                        <td>{row.level ? `${row.level} 추정` : "자료 부족"}</td>
                        <td>
                          {row.possibleLevels.length
                            ? row.possibleLevels.join("–")
                            : "—"}
                        </td>
                        <td>{pct(row.observedPercent)}</td>
                        <td>{row.evidenceCount}개</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </details>
      )}
    </div>
  );
}
