import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { InlineLoading } from "../../../components/common/LoadingState";
import { useAuth } from "../../../contexts/AuthContext";
import { readStudentCurriculumTree } from "../../../lib/studentLessonReadCache";
import {
  type AssessmentConfigEntry,
  getAssessmentConfigKey,
  getGrade3ClassIdsFromSchoolConfig,
  isAssessmentVisibleToStudent,
  readAssessmentConfigMap,
} from "../../../lib/assessmentConfig";
import {
  formatMockExamRoundLabel,
  getMockExamRoundNumber,
  getMockExamRoundsFromAssessmentConfig,
  type MockExamRound,
} from "../../../lib/mockExamRounds";

interface TreeItem {
  id: string;
  title: string;
  children?: TreeItem[];
}

const QuizIndex: React.FC = () => {
  const { userData, config } = useAuth();
  const navigate = useNavigate();

  const [tree, setTree] = useState<TreeItem[]>([]);
  const [assessmentConfig, setAssessmentConfig] = useState<
    Record<string, AssessmentConfigEntry>
  >({});
  const [loading, setLoading] = useState(true);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      try {
        const [nextTree, grade3ClassIds] = await Promise.all([
          readStudentCurriculumTree(config),
          getGrade3ClassIdsFromSchoolConfig(),
        ]);
        const nextConfig = await readAssessmentConfigMap(
          config,
          grade3ClassIds,
        );
        if (cancelled) return;
        setTree(nextTree);
        setAssessmentConfig(nextConfig);
      } catch (error) {
        console.error("Error fetching quiz data:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchData();
    return () => {
      cancelled = true;
    };
  }, [config]);

  const toggleAccordion = (index: number) => {
    const newSet = new Set(expandedItems);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setExpandedItems(newSet);
  };

  const startQuiz = (
    unitId: string,
    category: string,
    title: string,
    examRound?: MockExamRound,
  ) => {
    const roundParam = examRound
      ? `&round=${encodeURIComponent(examRound)}`
      : "";
    navigate(
      `/student/quiz/run?unitId=${unitId}&category=${category}&title=${encodeURIComponent(title)}${roundParam}`,
    );
  };

  const getVisibility = (
    unitId: string,
    category: string,
    examRound?: MockExamRound,
  ) =>
    isAssessmentVisibleToStudent(
      assessmentConfig[getAssessmentConfigKey(unitId, category, examRound)],
      userData,
    );

  const mockExamRounds = useMemo(
    () => getMockExamRoundsFromAssessmentConfig(assessmentConfig),
    [assessmentConfig],
  );
  const mockExamRoundStates = useMemo(
    () =>
      mockExamRounds.map((round) => ({
        round,
        visible: getVisibility("exam_prep", "exam_prep", round),
      })),
    [assessmentConfig, mockExamRounds, userData],
  );

  if (loading) {
    return (
      <InlineLoading message="퀴즈 목록을 불러오는 중입니다." showWarning />
    );
  }

  return (
    <div className="mx-auto max-w-4xl animate-fadeIn px-4 py-8">
      <div className="mb-5 flex justify-end">
        <button
          type="button"
          onClick={() => navigate("/student/mypage?menu=wrong_note")}
          className="inline-flex items-center gap-2 rounded-xl border border-blue-100 bg-white px-4 py-2.5 text-sm font-bold text-blue-700 shadow-sm transition hover:bg-blue-50"
        >
          <i className="fas fa-book-open text-xs"></i>
          오답노트
        </button>
      </div>

      <section className="mb-10">
        <h2 className="mb-3 ml-1 flex items-center gap-2 text-lg font-bold text-gray-800">
          <i className="fas fa-flag-checkered text-blue-600"></i> 모의고사
        </h2>
        <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-800 to-blue-500 p-6 text-white shadow-lg transition-transform duration-200">
          <i className="fas fa-pen-fancy absolute -bottom-5 -right-5 text-8xl opacity-10 -rotate-15"></i>

          <div className="relative z-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <div className="mb-2 inline-block rounded bg-red-500 px-2 py-1 text-[10px] font-bold text-white shadow-sm">
                FINAL CHECK
              </div>
              <h3 className="mb-1 text-2xl font-black">모의고사 문제</h3>
              <p className="text-sm font-medium text-blue-100 opacity-90">
                실제 시험처럼 문제를 풀어보고 실력을 점검하세요.
              </p>
            </div>

            <div className="grid min-w-[min(100%,16rem)] grid-cols-3 gap-2 md:min-w-[17rem]">
              {mockExamRoundStates.map(({ round, visible }) => (
                <button
                  key={round}
                  type="button"
                  onClick={() =>
                    visible &&
                    startQuiz(
                      "exam_prep",
                      "exam_prep",
                      formatMockExamRoundLabel(round),
                      round,
                    )
                  }
                  disabled={!visible}
                  className={`inline-flex h-11 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-extrabold shadow-sm transition ${
                    visible
                      ? "bg-white text-blue-700 hover:bg-blue-50"
                      : "cursor-not-allowed bg-white/25 text-white/70 ring-1 ring-white/20"
                  }`}
                  aria-label={`${formatMockExamRoundLabel(round)} ${
                    visible ? "시작" : "잠김"
                  }`}
                >
                  {!visible && <i className="fas fa-lock text-xs"></i>}
                  {getMockExamRoundNumber(round)}회
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-4 ml-1 flex items-center gap-2 text-lg font-bold text-gray-800">
          <i className="fas fa-layer-group text-amber-500"></i> 단원별 평가
        </h2>

        <div className="space-y-4">
          {tree.length === 0 && (
            <div className="rounded-xl border border-gray-200 bg-white py-20 text-center text-gray-400">
              등록된 단원이 없습니다.
              <br />
              <span className="text-xs">
                선생님이 아직 단원을 등록하지 않았습니다.
              </span>
            </div>
          )}

          {tree.map((big, idx) => (
            <div
              key={idx}
              className="overflow-hidden rounded-xl border border-gray-200 bg-white transition-shadow hover:shadow-sm"
            >
              <div
                onClick={() => toggleAccordion(idx)}
                className="flex cursor-pointer items-center justify-between bg-white p-5 transition-colors hover:bg-gray-50"
              >
                <span className="text-lg font-extrabold text-gray-800">
                  {big.title}
                </span>
                <i
                  className={`fas fa-chevron-down text-gray-400 transition-transform duration-300 ${
                    expandedItems.has(idx) ? "rotate-180 text-blue-500" : ""
                  }`}
                ></i>
              </div>

              {expandedItems.has(idx) && (
                <div className="border-t border-gray-100 bg-gray-50">
                  {big.children?.map((mid, mIdx) => {
                    const diagActive = getVisibility(mid.id, "diagnostic");
                    const formActive = getVisibility(mid.id, "formative");

                    return (
                      <div
                        key={mIdx}
                        className="flex flex-col justify-between gap-3 border-b border-gray-200 p-4 last:border-0 md:flex-row md:items-center"
                      >
                        <div className="flex items-center font-semibold text-gray-700">
                          <i className="fas fa-folder mr-3 text-amber-400"></i>
                          {mid.title}
                        </div>
                        <div className="flex gap-2 self-end md:self-auto">
                          <button
                            onClick={() =>
                              diagActive &&
                              startQuiz(mid.id, "diagnostic", mid.title)
                            }
                            disabled={!diagActive}
                            className={`
                              flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-bold transition-all
                              ${
                                diagActive
                                  ? "border-blue-100 bg-blue-50 text-blue-600 hover:border-blue-600 hover:bg-blue-600 hover:text-white"
                                  : "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
                              }
                            `}
                          >
                            {diagActive ? (
                              <i className="fas fa-stethoscope"></i>
                            ) : (
                              <i className="fas fa-lock"></i>
                            )}
                            {diagActive ? "진단평가" : "진단"}
                          </button>

                          <button
                            onClick={() =>
                              formActive &&
                              startQuiz(mid.id, "formative", mid.title)
                            }
                            disabled={!formActive}
                            className={`
                              flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-bold transition-all
                              ${
                                formActive
                                  ? "border-emerald-100 bg-emerald-50 text-emerald-600 hover:border-emerald-600 hover:bg-emerald-600 hover:text-white"
                                  : "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
                              }
                            `}
                          >
                            {formActive ? (
                              <i className="fas fa-pencil-alt"></i>
                            ) : (
                              <i className="fas fa-lock"></i>
                            )}
                            {formActive ? "형성평가" : "형성"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default QuizIndex;
