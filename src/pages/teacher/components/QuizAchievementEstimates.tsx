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
}: {
  data: QuizClassAchievement;
  analysis: AchievementAnalysis;
  examRound: string;
  showPaper: boolean;
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
    [
      data.grade || data.configuredClasses.length > 1
        ? data.configuredClasses.find(
            (entry) => entry.id === row.student.classId,
          )?.label
        : "",
      row.student.number ? `${row.student.number}번` : "",
      row.student.name || "이름 미등록",
    ]
      .filter(Boolean)
      .join(" ");
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
        <InfoHelp label="모의고사 누적 수준 계산">
          1회차는 1회 결과, 2회차는 1~2회, 3회차는 1~3회 결과를 사용합니다. 각
          회차의 최초 유효 제출 점수와 당시 시험지의 A/B·B/C·C/D·D/E 분할점수를
          100점으로 환산하여 같은 비중으로 평균합니다. 반올림 전 누적 점수가 각
          경계 이상인 가장 높은 수준을 적용하며 D/E 경계 미만은 E입니다. 미응시
          회차는 0점으로 넣지 않고, 일부 회차만 있으면 부분 분석으로 표시합니다.
          당시 시험지나 배점을 확인할 수 없으면 수준을 분류하지 않습니다. 분석용
          수준이며 공식 성적을 변경하지 않습니다.
        </InfoHelp>
      </div>
      <div className="qaa-table-wrap">
        <table className="qaa-table" aria-label="학생별 모의고사 누적 성취수준">
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
            {students.map((row) => (
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
      {showPaper && (
        <>
          <div className="qca-section-heading qaa-estimate-heading">
            <h3>응시 당시 시험지별 경계</h3>
            <InfoHelp label="시험지별 추정 분할점수 산출식">
              기존 시험지 추정 모형을 사용합니다. A=4, B=3, C=2, D=1, E=0으로
              두고 p=1/(1+exp(−(ln(0.65/0.35)+0.8×(수준−문항 목표수준))))로
              계산한 문항별 예상 정답률을 배점으로 가중합니다. 목표수준 미지정은
              쉬움=D, 보통=C, 어려움=B, 난도도 없으면 C로 보완합니다. 당시 문항
              메타데이터만 사용하며 현재 문제은행의 수정은 과거 경계에 반영하지
              않습니다. 모형 계수는 위스토리의 가정이며 중학교 공식 분할점수는
              아닙니다.
            </InfoHelp>
          </div>
          <div className="qaa-table-wrap">
            <table
              className="qaa-table"
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
                {students.flatMap((row) =>
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
        </>
      )}
    </div>
  );
}
