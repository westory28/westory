import {
  analysisStudentLabel,
  AnalysisStudentsMore,
  useAnalysisStudentWindow,
} from "./QuizAnalysisStudents";
import InfoHelp from "../../../components/common/InfoHelp";
import type {
  AchievementAnalysis,
  CumulativeAchievementScore,
} from "../../../lib/achievementAnalysis";
import type { QuizClassAchievement } from "../../../lib/quizClassAnalysis";
import {
  AnalysisSortHeader,
  sortAnalysisRows,
  useAnalysisTableSort,
} from "./QuizAnalysisSort";

const boundaries = ["A", "B", "C", "D"] as const;
const boundaryLabel = { A: "A/B", B: "B/C", C: "C/D", D: "D/E" };
const score = (value: number | null | undefined) =>
  value == null ? "—" : value.toFixed(2);

export default function QuizAchievementEstimates({
  data,
  analysis,
  examRound,
  showPaper,
  resetKey,
}: {
  data: QuizClassAchievement;
  analysis: AchievementAnalysis;
  examRound: string;
  showPaper: boolean;
  resetKey: string;
}) {
  const sorting = useAnalysisTableSort({
    key: "student",
    direction: "ascending",
  });
  const roundCount = Number(examRound.replace("round_", ""));
  const rounds = Array.from(
    { length: roundCount },
    (_, index) => `round_${index + 1}`,
  );
  const studentName = (row: CumulativeAchievementScore) =>
    analysisStudentLabel(row.student, data.configuredClasses);
  const windowKey = JSON.stringify([
    resetKey,
    examRound,
    showPaper,
    sorting.sort,
  ]);
  const cumulativeWindow = useAnalysisStudentWindow(windowKey);
  const paperWindow = useAnalysisStudentWindow(windowKey);
  const students = sortAnalysisRows(
    analysis.cumulativeScores,
    sorting.sort,
    (row, key) => {
      if (key === "student") return studentName(row);
      if (key === "score") return row.scorePercent;
      if (key === "level") return row.level;
      if (key.startsWith("round_"))
        return row.rounds.find((entry) => entry.examRound === key)
          ?.scorePercent;
      return row.cutScores?.[key as (typeof boundaries)[number]];
    },
  );
  return (
    <div className="qaa-estimates">
      <div className="qca-section-heading">
        <h3>
          {showPaper
            ? "시험지별 분할점수와 누적 수준"
            : "회차별 점수와 누적 수준"}
        </h3>
        <InfoHelp
          label="모의고사 누적 수준 계산"
          sections={[
            {
              title: "의미",
              items: [
                "선택 회차까지의 결과를 모아 추정한 학습 진단용 A–E 수준입니다. 공식 성적을 바꾸지 않습니다.",
              ],
            },
            {
              title: "수업에 활용",
              items: [
                "누적 수준과 최근 점수를 함께 보며 보충할 내용과 과제를 정하세요. 일부 회차만 있는 부분 분석은 수업 관찰도 함께 확인하세요.",
              ],
            },
            {
              title: "계산 기준",
              items: [
                "1회차는 1회, 2회차는 1~2회, 3회차는 1~3회의 최초 유효 제출을 사용합니다. 미응시 회차는 0점으로 넣지 않습니다.",
                "회차별 점수와 시험지의 A/B·B/C·C/D·D/E 분할점수를 각각 100점으로 환산한 뒤, 회차마다 같은 비중으로 평균합니다.",
                "반올림 전 누적 점수가 경계 이상인 가장 높은 수준을 적용하며, D/E 경계 미만은 E입니다.",
                "정답수로 저장된 결과는 문항마다 같은 비중으로 계산합니다. 시험지를 확인할 수 없거나 배점 기반 점수의 배점이 맞지 않으면 수준을 분류하지 않습니다.",
              ],
            },
          ]}
        />
      </div>
      <div
        className="qca-table-scroll qaa-table-scroll qaa-table-wrap"
        role="region"
        aria-label="학생별 모의고사 누적 성취수준 표"
        tabIndex={0}
      >
        <table
          className="qca-table qaa-table"
          aria-label="학생별 모의고사 누적 성취수준"
        >
          <thead>
            <tr>
              <AnalysisSortHeader
                column="student"
                label="학생"
                defaultDirection="ascending"
                {...sorting}
              />
              {!showPaper &&
                rounds.map((round, index) => (
                  <AnalysisSortHeader
                    key={round}
                    column={round}
                    label={`${index + 1}회 점수`}
                    {...sorting}
                  />
                ))}
              <AnalysisSortHeader
                column="score"
                label="누적 점수"
                {...sorting}
              />
              <AnalysisSortHeader
                column="level"
                label="분석 수준"
                defaultDirection="ascending"
                {...sorting}
              />
              {showPaper &&
                boundaries.map((boundary) => (
                  <AnalysisSortHeader
                    key={boundary}
                    column={boundary}
                    label={boundaryLabel[boundary]}
                    {...sorting}
                  />
                ))}
              <th scope="col">분석 자료</th>
            </tr>
          </thead>
          <tbody>
            {students.slice(0, cumulativeWindow.count).map((row) => (
              <tr key={row.student.uid}>
                <th scope="row">{studentName(row)}</th>
                {!showPaper &&
                  rounds.map((round) => (
                    <td key={round}>
                      {score(
                        row.rounds.find((entry) => entry.examRound === round)
                          ?.scorePercent,
                      )}
                    </td>
                  ))}
                <td>{score(row.scorePercent)}</td>
                <td>{row.level || "미분류"}</td>
                {showPaper &&
                  boundaries.map((boundary) => (
                    <td key={boundary}>{score(row.cutScores?.[boundary])}</td>
                  ))}
                <td>
                  {row.rounds.length}/{roundCount}회
                  {row.missingRounds.length > 0 && (
                    <small>
                      부분 분석 ·{" "}
                      {row.missingRounds
                        .map((round) => round.replace("round_", "") + "회")
                        .join(", ")}{" "}
                      자료 없음
                    </small>
                  )}
                  {row.excludedRoundCount > 0 && (
                    <small>
                      시험지·응시 순서 확인 필요 {row.excludedRoundCount}회
                    </small>
                  )}
                  {row.rounds.some((round) => round.assumedTargets > 0) && (
                    <small>목표수준 보완 포함</small>
                  )}
                  {row.rounds.some((round) => !round.weighted) && (
                    <small>동일 문항 가중치 포함</small>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AnalysisStudentsMore {...cumulativeWindow} total={students.length} />
      {showPaper && (
        <>
          <div className="qca-section-heading qaa-estimate-heading">
            <h3>응시 당시 시험지별 경계</h3>
            <InfoHelp
              label="시험지별 추정 분할점수 산출식"
              sections={[
                {
                  title: "의미와 활용",
                  items: [
                    "문항의 목표수준과 배점으로 예상한 수준별 점수 경계입니다. 시험지별 문항 구성을 고려해 누적 수준을 해석할 때 참고하세요.",
                    "실제 학생 정답률로 구한 경계가 아닙니다. 모형 계수는 위스토리의 가정이며, 중학교 공식 분할점수로 사용하지 않습니다.",
                  ],
                },
                {
                  title: "계산 기준",
                  items: [
                    "A=4, B=3, C=2, D=1, E=0으로 두고 p=1/(1+exp(−(ln(0.65/0.35)+0.8×(수준−문항 목표수준))))로 문항별 예상 정답률을 계산합니다.",
                    "예상 정답률을 배점으로 가중해 100점으로 환산합니다. 정답수 기반의 과거 기록은 문항마다 같은 비중을 둡니다.",
                    "목표수준이 없으면 출제 난도의 쉬움=D, 보통=C, 어려움=B로 보완하고, 난도도 없으면 C를 적용합니다.",
                    "저장된 응시 시험지가 기준입니다. 같은 원문으로 확인된 문항의 정답·목표수준·난도 정정은 과거 분석에도 반영하며, 원래 답안과 응시 기록은 보존합니다.",
                  ],
                },
              ]}
            />
          </div>
          <div
            className="qca-table-scroll qaa-table-scroll qaa-table-wrap"
            role="region"
            aria-label="응시 당시 시험지별 추정 분할점수 표"
            tabIndex={0}
          >
            <table
              className="qca-table qaa-table"
              aria-label="응시 당시 시험지별 추정 분할점수"
            >
              <thead>
                <tr>
                  <th>학생</th>
                  <th>회차</th>
                  <th>점수</th>
                  {boundaries.map((boundary) => (
                    <th key={boundary}>{boundaryLabel[boundary]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.slice(0, paperWindow.count).flatMap((row) =>
                  row.rounds.map((round) => (
                    <tr key={`${row.student.uid}:${round.examRound}`}>
                      <th scope="row">{studentName(row)}</th>
                      <td>{round.examRound.replace("round_", "")}회</td>
                      <td>{score(round.scorePercent)}</td>
                      {boundaries.map((boundary) => (
                        <td key={boundary}>
                          {score(round.cutScores?.[boundary])}
                        </td>
                      ))}
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          <AnalysisStudentsMore {...paperWindow} total={students.length} />
        </>
      )}
    </div>
  );
}
