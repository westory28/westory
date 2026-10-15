import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import InfoHelp from "../../../components/common/InfoHelp";
import {
  ASSESSMENT_LEARNING_EVIDENCE_LABELS,
  buildAssessmentLearningSummary,
  type AssessmentLearningQuestion,
} from "../../../lib/assessmentLearning";
import type { QuizLearningLog } from "./QuizLogTab";

interface Props {
  logs: QuizLearningLog[];
  questions: (AssessmentLearningQuestion & { question?: string })[];
  students: { uid: string; label: string }[];
  semesterId: string;
  unitLabels: Record<string, string>;
  loading: boolean;
  onOpenQuestions?: (ids: string[]) => void;
}

const seconds = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${(value / 1000).toFixed(1)}초`
    : "—";
const timeValue = (value: unknown): number => {
  if (typeof value === "string") return Date.parse(value) || 0;
  if (typeof value === "number") return value;
  const stamp = value as { seconds?: number } | null;
  return Number(stamp?.seconds || 0) * 1000;
};

const QuizLearningEvidencePanel: React.FC<Props> = ({
  logs,
  questions,
  students,
  semesterId,
  unitLabels,
  loading,
  onOpenQuestions,
}) => {
  const [selectedUid, setSelectedUid] = useState("");
  const [dimension, setDimension] = useState<
    "units" | "concepts" | "cognitiveProcesses"
  >("units");
  const selectedStudent = students.find(
    (student) => student.uid === selectedUid,
  );
  const selectedLogs = useMemo(
    () =>
      selectedStudent
        ? logs
            .filter((log) => (log.uid || log.email) === selectedStudent.uid)
            .slice()
            .sort((a, b) => timeValue(b.timestamp) - timeValue(a.timestamp))
        : [],
    [logs, selectedStudent],
  );
  const summary = useMemo(
    () =>
      buildAssessmentLearningSummary({
        studentUid: selectedUid,
        semesterId,
        questions,
        attempts: selectedLogs.map((log) => ({
          id: log.id,
          studentUid: selectedUid,
          semesterId,
          submittedAt: log.timestamp,
          questionMetadata: log.learningSnapshot,
          items: log.details
            .filter(
              (detail) =>
                detail.id != null && typeof detail.correct === "boolean",
            )
            .map((detail) => ({
              questionId: detail.id!,
              correct: detail.correct!,
              answer: detail.u,
              observation: log.analytics?.questions?.[String(detail.id)],
              hintViewed:
                log.analytics?.questions?.[String(detail.id)]?.hintViewed,
            })),
        })),
      }),
    [selectedLogs, questions, selectedUid, semesterId],
  );
  const observedQuestions = useMemo(() => {
    const latest = new Map<
      string,
      {
        log: QuizLearningLog;
        correct: boolean;
        answer?: string;
        originalQuestion?: string;
      }
    >();
    selectedLogs.forEach((log) =>
      log.details.forEach((detail) => {
        if (
          detail.id == null ||
          typeof detail.correct !== "boolean" ||
          latest.has(String(detail.id))
        )
          return;
        latest.set(String(detail.id), {
          log,
          correct: detail.correct,
          answer: detail.u,
          originalQuestion:
            log.questionSnapshots?.find(
              (question) => String(question.id) === String(detail.id),
            )?.question || detail.q,
        });
      }),
    );
    return Array.from(latest.entries());
  }, [selectedLogs]);

  return (
    <section className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="quiz-editor-toolbar mb-4">
        <div className="flex items-center gap-1">
          <h3 className="text-lg font-extrabold text-gray-900">
            학생별 학습 근거
          </h3>
          <InfoHelp label="학습 근거의 해석 기준">
            같은 문항은 최신 응답 한 번으로 집계하며 첫 응답과 반복 횟수를
            별도로 봅니다. 서로 다른 문항이 3개 미만이면 자료 부족으로
            표시합니다. 문항이 수정된 경우 첫·최근 답은 최신 문항 버전
            기준입니다. 힌트를 본 정답은 재확인 대상으로 봅니다. 시간은 화면을
            보는 동안의 관찰값이며 속도만으로 찍기나 숙달을 판정하지 않습니다.
            첫·최종 응답 시간은 해당 문항에서 누적한 풀이 시간을 기준으로 하며,
            평균은 시간이 기록된 문항만 포함합니다. 관찰이 없는 값은 0이
            아닙니다. 이전 기록의 분류는 현재 문제 은행을 사용할 수 있습니다.
          </InfoHelp>
        </div>
        <label className="flex min-w-0 items-center gap-2 text-sm font-bold text-gray-700">
          학생
          <select
            value={selectedStudent?.uid || ""}
            onChange={(event) => setSelectedUid(event.target.value)}
            className="min-h-11 min-w-0 rounded-lg border border-gray-300 bg-white px-3 font-normal"
          >
            <option value="">학생 선택</option>
            {students.map((student) => (
              <option key={student.uid} value={student.uid}>
                {student.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading ? (
        <p className="py-4 text-sm text-gray-500" role="status">
          학습 기록을 불러오는 중입니다.
        </p>
      ) : !selectedStudent ? (
        <p className="py-4 text-sm text-gray-500">
          확인할 학생을 선택해 주세요.
        </p>
      ) : !summary.attemptCount ? (
        <p className="py-4 text-sm text-gray-500">
          선택한 범위에 제출 기록이 없습니다.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-600">
            <span>제출 {summary.attemptCount}회</span>
            <span>서로 다른 문항 {summary.assessedQuestionCount}개</span>
            <span>개념 미등록 {summary.missingConceptQuestionCount}개</span>
            <span>
              사고 과정 미등록 {summary.missingCognitiveProcessQuestionCount}개
            </span>
            {summary.currentMetadataQuestionCount > 0 && (
              <span>
                현재 분류 사용 {summary.currentMetadataQuestionCount}개
              </span>
            )}
            {summary.limitedMetadataQuestionCount > 0 && (
              <span>
                분류 정보 일부 생략 {summary.limitedMetadataQuestionCount}개
              </span>
            )}
          </div>
          <label className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-700">
            분석 기준
            <select
              value={dimension}
              onChange={(event) =>
                setDimension(event.target.value as typeof dimension)
              }
              className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 font-normal"
            >
              <option value="units">단원</option>
              <option value="concepts">핵심 개념</option>
              <option value="cognitiveProcesses">사고 과정</option>
            </select>
          </label>
          {summary[dimension].length === 0 ? (
            <p className="py-4 text-sm text-gray-500">
              이 기준으로 분류된 문항이 없습니다.
            </p>
          ) : (
            <div className="space-y-0 divide-y divide-gray-200">
              {summary[dimension].map((group) => (
                <div key={group.key} className="py-3">
                  <div className="quiz-editor-toolbar">
                    <div className="min-w-0">
                      <h4 className="break-words font-bold text-gray-800">
                        {dimension === "units"
                          ? unitLabels[group.key] || "단원 미등록"
                          : group.label}
                      </h4>
                      <div className="mt-1 text-sm text-gray-600">
                        서로 다른 문항 {group.distinctQuestions}개 · 첫 응답
                        정답 {group.firstCorrectQuestions}개 · 최근 정답{" "}
                        {group.correctQuestions}개 · 반복{" "}
                        {group.repeatedAttempts}회
                      </div>
                    </div>
                    <span
                      className={`rounded px-2 py-1 text-sm font-bold ${group.evidence === "review" ? "bg-amber-50 text-amber-800" : "bg-gray-100 text-gray-700"}`}
                    >
                      {ASSESSMENT_LEARNING_EVIDENCE_LABELS[group.evidence]}
                    </span>
                  </div>
                  {group.possibleConfusions.length > 0 && (
                    <p className="mt-2 text-sm text-gray-600">
                      선택한 오답의 확인 지점:{" "}
                      {group.possibleConfusions.join(" · ")}
                    </p>
                  )}
                  <div className="mt-2 text-sm text-gray-600">
                    {group.behavior.observedQuestionCount === 0 ? (
                      "풀이 관찰 기록 없음"
                    ) : (
                      <>
                        <p>
                          관찰 {group.behavior.observedQuestionCount}/
                          {group.distinctQuestions}문항 · 풀이 시간 합계{" "}
                          {seconds(group.behavior.activeMs)} · 답 변경{" "}
                          {group.behavior.answerChangeCount ?? "—"}회 (
                          {group.behavior.changedQuestionCount ?? "—"}문항) ·
                          재방문 {group.behavior.revisitCount ?? "—"}회
                        </p>
                        <p>
                          첫 답까지 평균{" "}
                          {seconds(group.behavior.meanFirstResponseMs)} · 마지막
                          답까지 평균{" "}
                          {seconds(group.behavior.meanFinalResponseMs)}
                          {group.behavior.partialQuestionCount > 0 &&
                            ` · 부분 수집 ${group.behavior.partialQuestionCount}문항`}
                        </p>
                      </>
                    )}
                  </div>
                  {(group.hintedQuestionCount > 0 ||
                    group.contentChangedQuestionCount > 0) && (
                    <p className="mt-1 text-sm text-gray-600">
                      힌트 참고 {group.hintedQuestionCount}개 · 문항 수정 이력{" "}
                      {group.contentChangedQuestionCount}개
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {onOpenQuestions && (
                      <button
                        type="button"
                        className="min-h-11 rounded-lg border border-gray-300 px-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
                        onClick={() =>
                          onOpenQuestions(
                            group.wrongQuestionIds.length
                              ? group.wrongQuestionIds
                              : group.questionIds,
                          )
                        }
                      >
                        {group.wrongQuestionIds.length
                          ? "오답 문항 확인"
                          : "근거 문항 확인"}
                      </button>
                    )}
                    {onOpenQuestions && group.unseenQuestionIds.length > 0 && (
                      <button
                        type="button"
                        className="min-h-11 rounded-lg border border-blue-200 px-3 text-sm font-bold text-blue-800 hover:bg-blue-50"
                        onClick={() => onOpenQuestions(group.unseenQuestionIds)}
                      >
                        다른 문항 {group.unseenQuestionIds.length}개 확인
                      </button>
                    )}
                    {group.reviewLessonIds.length > 0 && (
                      <span className="text-sm text-gray-600">
                        연결 자료:{" "}
                        {group.reviewLessonIds
                          .map((id) => unitLabels[id] || "수업자료")
                          .join(" · ")}{" "}
                        <Link
                          to="/teacher/lesson"
                          className="inline-flex min-h-11 items-center font-bold text-blue-700 underline"
                        >
                          수업자료 열기
                        </Link>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <details className="mt-4 border-t border-gray-200 pt-1">
            <summary className="min-h-11 cursor-pointer py-3 text-sm font-bold text-gray-800">
              문항별 응답·관찰 기록 {observedQuestions.length}개
            </summary>
            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="문항별 응답과 관찰 기록"
            >
              <table className="quiz-learning-evidence min-w-[960px]">
                <thead>
                  <tr>
                    <th>문항</th>
                    <th>최근 응답</th>
                    <th>풀이 시간</th>
                    <th>첫 응답</th>
                    <th>최종 응답</th>
                    <th>변경</th>
                    <th>재방문</th>
                    <th>수집 상태</th>
                  </tr>
                </thead>
                <tbody>
                  {observedQuestions.map(([id, entry]) => {
                    const observation = entry.log.analytics?.questions?.[id];
                    return (
                      <tr key={id}>
                        <td>
                          <div className="max-w-72 break-words">
                            {entry.originalQuestion || "당시 원문 미보관"}
                          </div>
                        </td>
                        <td>
                          <span
                            className={
                              entry.correct
                                ? "font-bold text-blue-700"
                                : "font-bold text-red-700"
                            }
                          >
                            {entry.correct ? "정답" : "오답"}
                          </span>
                          <div className="max-w-48 break-words">
                            {entry.answer == null
                              ? "답안 정보 없음"
                              : entry.answer || "미응답"}
                          </div>
                        </td>
                        <td>{seconds(observation?.activeMs)}</td>
                        <td>{seconds(observation?.firstResponseMs)}</td>
                        <td>{seconds(observation?.finalResponseMs)}</td>
                        <td>
                          {observation
                            ? `${observation.answerChangeCount}회`
                            : "—"}
                        </td>
                        <td>
                          {observation ? `${observation.revisitCount}회` : "—"}
                        </td>
                        <td>
                          {!observation
                            ? "관찰 정보 없음"
                            : observation.quality === "complete"
                              ? "정상 수집"
                              : "부분 수집"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
};

export default QuizLearningEvidencePanel;
