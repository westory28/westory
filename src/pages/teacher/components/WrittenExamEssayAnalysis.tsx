import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { acquirePageScrollLock } from "../../../lib/pageScrollLock";
import { buildStudentPagination } from "./studentPagination";
import WrittenExamEssayCharts from "./WrittenExamEssayCharts";
import "./teacher-list-controls.css";
import "./writtenExamAnalysis.css";
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
const studentLabel = (student: {
  name: string;
  grade: string;
  class: string;
  number: string;
}) =>
  `${student.name}(${student.grade}${student.class.padStart(2, "0")}${student.number.padStart(2, "0")})`;

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
  const [pageClass, setPageClass] = useState("");
  const [feedbackKey, setFeedbackKey] = useState<string | null>(null);
  useEffect(() => {
    setFeedbackKey(null);
  }, [rows, items, view]);
  const groups = result.data?.classes || [];
  const pageIndex = Math.max(
    0,
    groups.findIndex((room) => room.id === pageClass),
  );
  const pageGroup = groups[pageIndex];
  const pageStudents =
    result.data?.students.filter(
      (student) => `${student.grade}-${student.class}` === pageGroup?.id,
    ) || [];
  const feedbackStudent = result.data?.students.find(
    (student) => student.key === feedbackKey,
  );
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
            백지는 문항별 교사 피드백의 ‘백지’·‘미작성’ 표시를 집계합니다.
            0점이나 미입력만으로는 백지로 판단하지 않습니다.
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
          <dt>백지 문항</dt>
          <dd>{data.blankCount}개</dd>
        </div>
        <div>
          <dt>백지가 있는 학생</dt>
          <dd>{data.blankStudentCount}명</dd>
        </div>
      </dl>
      <WrittenExamEssayCharts data={data} view={selectedView} />
      {selectedView === 0 && (
        <>
          <Table label="논술형 전체 원점수 결과">
            <thead>
              <tr>
                <th scope="col">총점 분석 인원</th>
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
            <h3>총점 분포</h3>
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
                  <td colSpan={2}>총점을 집계할 수 있는 학생이 없습니다.</td>
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
              <th scope="col">분석 인원</th>
              <th scope="col">백지</th>
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
                <td>{item.blankCount}명</td>
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
              <th scope="col">학생 수</th>
              <th scope="col">백지 문항</th>
              <th scope="col">백지가 있는 학생</th>
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
                <td>{room.studentCount}명</td>
                <td>{room.blankCount}개</td>
                <td>{room.blankStudentCount}명</td>
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
        <>
          <Table label="논술형 학생별 점수와 교사 피드백">
            <thead>
              <tr>
                <th scope="col">학생</th>
                <th scope="col">백지 문항</th>
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
              {pageStudents.map((student) => (
                <tr key={student.key}>
                  <th scope="row">
                    <span className="wea-student-name">
                      {studentLabel(student)}
                    </span>
                  </th>
                  <td>
                    {student.blankCount}개
                    {student.blankItems.length > 0 && (
                      <span className="wea-blank-items">
                        {" "}
                        (
                        {student.blankItems
                          .map((item) => item.label)
                          .join(", ")}
                        )
                      </span>
                    )}
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
                      <button
                        type="button"
                        className="wea-feedback-button"
                        aria-label={`${studentLabel(student)} 교사 피드백 보기`}
                        onClick={() => setFeedbackKey(student.key)}
                      >
                        피드백 보기
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {groups.length > 0 && (
            <nav
              className="student-list-pagination wea-pagination"
              aria-label="논술형 학생 결과 페이지"
            >
              <span className="student-list-pagination__class">
                현재 {pageGroup.label}
              </span>
              <div className="student-list-pagination__pages">
                {buildStudentPagination(pageIndex + 1, groups.length).map(
                  (page, index) =>
                    page === "ellipsis" ? (
                      <span key={`gap-${index}`} aria-hidden="true">
                        …
                      </span>
                    ) : (
                      <button
                        key={groups[page - 1].id}
                        type="button"
                        className={`wea-page-button ${pageIndex + 1 === page ? "is-active" : ""}`}
                        aria-current={
                          pageIndex + 1 === page ? "page" : undefined
                        }
                        aria-label={`${page}페이지, ${groups[page - 1].label}`}
                        title={`${page}페이지: ${groups[page - 1].label}`}
                        onClick={() => {
                          setPageClass(groups[page - 1].id);
                          setFeedbackKey(null);
                        }}
                      >
                        {page}
                      </button>
                    ),
                )}
              </div>
            </nav>
          )}
        </>
      )}
      {feedbackStudent && (
        <EssayFeedbackDialog
          student={feedbackStudent}
          onClose={() => setFeedbackKey(null)}
        />
      )}
    </section>
  );
}

function EssayFeedbackDialog({
  student,
  onClose,
}: {
  student: ReturnType<typeof buildWrittenExamEssayAnalysis>["students"][number];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const release = acquirePageScrollLock();
    dialogRef.current?.showModal();
    closeRef.current?.focus();
    return () => {
      release();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const feedback = [
    student.feedback,
    ...student.itemFeedback
      .filter((entry) => !student.feedback.includes(entry.feedback))
      .map((entry) => `${entry.label}: ${entry.feedback}`),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s*\r?\n\s*/g, " ");
  return createPortal(
    <dialog
      ref={dialogRef}
      className="written-exam-dialog wea-feedback-dialog"
      aria-labelledby="wea-feedback-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="written-exam-dialog-heading">
        <h2 id="wea-feedback-title">{studentLabel(student)} 교사 피드백</h2>
        <button
          ref={closeRef}
          type="button"
          className="wea-feedback-button"
          aria-label="교사 피드백 닫기"
          onClick={onClose}
        >
          닫기
        </button>
      </div>
      {student.blankCount > 0 && (
        <p className="wea-blank-summary">
          <strong>
            백지 문항 {student.blankCount}개 ·{" "}
            {student.blankItems.map((item) => item.label).join(", ")}
          </strong>
          <span>
            표시된 문항에서 요구하는 내용과 근거를 확인하고 답안을 다시 작성해
            보세요.
          </span>
        </p>
      )}
      <p className="wea-feedback-text">{feedback}</p>
    </dialog>,
    document.body,
  );
}
