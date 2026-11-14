import { useMemo, type ReactNode } from "react";
import InfoHelp from "../../../components/common/InfoHelp";
import type {
  PerformanceScoreRoster,
  PerformanceScoreRosterRow,
} from "../../../lib/performanceScores";
import {
  buildWrittenExamEssayAnalysis,
  type EssayScoreSummary,
} from "../../../lib/writtenExamEssayAnalysis";
import "./QuizClassAnalysis.css";
import "./writtenExamEssayAnalysis.css";

const fmt = (value: number | null) =>
  value === null
    ? "—"
    : value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
const titles = ["전체 결과", "문항별 점수", "학급별 비교", "학생별 결과"];
const statusLabel = {
  complete: "입력 완료",
  partial: "일부 입력",
  missing: "미입력",
};

function Table({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className="qca-table-scroll wea-table-scroll"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table className="qca-table wea-table">
        <caption className="wea-visually-hidden">{label}</caption>
        {children}
      </table>
    </div>
  );
}

function Distribution({ summary }: { summary: EssayScoreSummary }) {
  return summary.count ? (
    <span className="wea-distribution">
      {summary.distribution.map(({ score, count }) => (
        <span key={score}>
          {fmt(score)}점 <strong>{count}명</strong>
        </span>
      ))}
    </span>
  ) : (
    <>—</>
  );
}

export default function WrittenExamEssayAnalysis({
  rows,
  items,
  view,
}: {
  rows: PerformanceScoreRosterRow[];
  items: PerformanceScoreRoster["items"];
  view: number;
}) {
  const result = useMemo(() => {
    try {
      return { data: buildWrittenExamEssayAnalysis(rows, items), error: "" };
    } catch (error) {
      return {
        data: null,
        error:
          error instanceof Error
            ? error.message
            : "논술형 점수표를 확인해 주세요.",
      };
    }
  }, [rows, items]);
  if (result.error)
    return (
      <p role="alert" className="qca-error">
        {result.error}
      </p>
    );
  const data = result.data!;
  if (!data.items.length)
    return <p className="written-exam-empty">등록된 논술형 문항이 없습니다.</p>;
  if (!data.studentCount)
    return (
      <p className="written-exam-empty">
        선택한 학급에 등록된 학생이 없습니다.
      </p>
    );
  const selectedView = view >= 0 && view < titles.length ? view : 0;
  return (
    <section
      className="wea-analysis quiz-class-analysis"
      aria-label="논술형 분석"
    >
      <div className="qca-section-heading wea-heading">
        <h3>논술형 {titles[selectedView]}</h3>
        <InfoHelp label="논술형 통계 기준">
          <p>
            문항 평균은 해당 문항의 입력된 점수만, 총점 평균은 모든 논술형
            문항을 입력한 학생만 계산합니다. 실제 0점은 포함하고 미입력은
            제외합니다.
          </p>
          <p>
            표준편차는 현재 선택한 학생 집단을 기준으로 계산합니다. 배점의 확인
            상태가 달라 원점수만 표시하며, 성취수준이나 오류 원인을 자동으로
            판단하지 않습니다.
          </p>
        </InfoHelp>
      </div>
      <dl className="wea-counts">
        <div>
          <dt>대상</dt>
          <dd>{data.studentCount}명</dd>
        </div>
        <div>
          <dt>입력 완료</dt>
          <dd>{data.completeCount}명</dd>
        </div>
        <div>
          <dt>일부 입력</dt>
          <dd>{data.partialCount}명</dd>
        </div>
        <div>
          <dt>미입력</dt>
          <dd>{data.missingCount}명</dd>
        </div>
      </dl>
      {selectedView === 0 && (
        <>
          <Table label="논술형 전체 원점수 결과">
            <thead>
              <tr>
                <th scope="col">총점 집계 인원</th>
                <th scope="col">평균</th>
                <th scope="col">표준편차</th>
                <th scope="col">최저점</th>
                <th scope="col">최고점</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{data.totals.count}명</td>
                <td>{fmt(data.totals.mean)}</td>
                <td>{fmt(data.totals.standardDeviation)}</td>
                <td>{fmt(data.totals.minimum)}</td>
                <td>{fmt(data.totals.maximum)}</td>
              </tr>
            </tbody>
          </Table>
          <div className="qca-section-heading wea-heading">
            <h3>입력 완료 학생의 총점 분포</h3>
          </div>
          <Table label="논술형 총점별 인원">
            <thead>
              <tr>
                <th scope="col">총점</th>
                <th scope="col">인원</th>
              </tr>
            </thead>
            <tbody>
              {data.totals.distribution.length ? (
                data.totals.distribution.map(({ score, count }) => (
                  <tr key={score}>
                    <th scope="row">{fmt(score)}점</th>
                    <td>{count}명</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2}>
                    모든 논술형 문항의 입력을 완료한 학생이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </>
      )}
      {selectedView === 1 && (
        <Table label="논술형 문항별 원점수">
          <thead>
            <tr>
              <th scope="col">문항</th>
              <th scope="col">입력</th>
              <th scope="col">미입력</th>
              <th scope="col">평균</th>
              <th scope="col">표준편차</th>
              <th scope="col">점수별 인원</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.key}>
                <th scope="row">{item.label}</th>
                <td>{item.summary.count}명</td>
                <td>{item.missingCount}명</td>
                <td>{fmt(item.summary.mean)}</td>
                <td>{fmt(item.summary.standardDeviation)}</td>
                <td>
                  <Distribution summary={item.summary} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {selectedView === 2 && (
        <Table label="논술형 학급별 원점수 비교">
          <thead>
            <tr>
              <th scope="col">학급</th>
              <th scope="col">입력 완료</th>
              <th scope="col">일부 입력</th>
              <th scope="col">미입력</th>
              <th scope="col">총점 평균</th>
              <th scope="col">총점 표준편차</th>
              {data.items.map((item) => (
                <th scope="col" key={item.key}>
                  {item.label} 평균
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.classes.map((room) => (
              <tr key={room.id}>
                <th scope="row">{room.label}</th>
                <td>{room.completeCount}명</td>
                <td>{room.partialCount}명</td>
                <td>{room.missingCount}명</td>
                <td>{fmt(room.totals.mean)}</td>
                <td>{fmt(room.totals.standardDeviation)}</td>
                {room.items.map((item) => (
                  <td key={item.key}>
                    {fmt(item.summary.mean)}{" "}
                    <span className="wea-count-note">
                      ({item.summary.count}명)
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {selectedView === 3 && (
        <Table label="논술형 학생별 점수와 교사 피드백">
          <thead>
            <tr>
              <th scope="col">학생</th>
              <th scope="col">입력 상태</th>
              <th scope="col">총점·부분합</th>
              {data.items.map((item) => (
                <th scope="col" key={item.key}>
                  {item.label}
                </th>
              ))}
              <th scope="col">교사 피드백</th>
            </tr>
          </thead>
          <tbody>
            {data.students.map((student) => (
              <tr key={student.key}>
                <th scope="row">
                  <span className="wea-student-name">{student.name}</span>
                  <span className="wea-school">
                    {student.grade}학년 {student.class}반 {student.number}번
                  </span>
                </th>
                <td>
                  {statusLabel[student.status]}{" "}
                  <span className="wea-count-note">
                    {student.enteredCount}/{data.items.length}
                  </span>
                </td>
                <td>
                  {student.total !== null ? (
                    fmt(student.total)
                  ) : student.status === "partial" ? (
                    <>부분합 {fmt(student.partialSum)}</>
                  ) : (
                    "—"
                  )}
                </td>
                {student.scores.map((score, index) => (
                  <td key={data.items[index].key}>
                    {score === null ? "미입력" : fmt(score)}
                  </td>
                ))}
                <td className="wea-feedback">
                  {student.feedback || student.itemFeedback.length ? (
                    <>
                      {student.feedback && <p>{student.feedback}</p>}
                      {student.itemFeedback
                        .filter(
                          (entry) => !student.feedback.includes(entry.feedback),
                        )
                        .map((entry) => (
                          <p key={entry.key}>
                            <strong>{entry.label}</strong> {entry.feedback}
                          </p>
                        ))}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}
