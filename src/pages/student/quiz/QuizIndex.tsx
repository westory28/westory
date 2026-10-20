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
  formatMockExamRoundShortLabel,
  getMockExamRoundsFromAssessmentConfig,
  type MockExamRound,
} from "../../../lib/mockExamRounds";

interface TreeItem {
  id: string;
  title: string;
  children?: TreeItem[];
}

const getAllExpandedIndexes = (items: TreeItem[]) =>
  new Set(items.map((_, index) => index));

const QuizIndex: React.FC = () => {
  const { userData, config } = useAuth();
  const navigate = useNavigate();

  const [tree, setTree] = useState<TreeItem[]>([]);
  const [assessmentConfig, setAssessmentConfig] = useState<
    Record<string, AssessmentConfigEntry>
  >({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const [nextTree, nextConfig] = await Promise.all([
          readStudentCurriculumTree(config),
          readAssessmentConfigMap(config, getGrade3ClassIdsFromSchoolConfig()),
        ]);
        if (cancelled) return;
        setTree(nextTree);
        setExpandedItems(getAllExpandedIndexes(nextTree));
        setAssessmentConfig(nextConfig);
      } catch (error) {
        console.error("Error fetching quiz data:", error);
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchData();
    return () => {
      cancelled = true;
    };
  }, [config?.year, config?.semester, reloadKey]);

  const toggleAccordion = (index: number) => {
    setExpandedItems((current) => {
      const newSet = new Set(current);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
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
    <div className="ws-page ws-page--reading animate-fadeIn">
      {loadError && (
        <div
          role="alert"
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          <span>평가 목록을 불러오지 못했습니다. 연결을 확인해 주세요.</span>
          <button
            type="button"
            className="min-h-11 rounded-lg border border-red-200 bg-white px-4 font-bold"
            onClick={() => setReloadKey((value) => value + 1)}
          >
            다시 불러오기
          </button>
        </div>
      )}
      <header className="ws-page-header mb-5">
        <h1>퀴즈</h1>
        <button
          type="button"
          onClick={() => navigate("/student/mypage?menu=wrong_note")}
          className="inline-flex items-center gap-2 rounded-xl border border-blue-100 bg-white px-4 py-2.5 text-sm font-bold text-blue-700 shadow-sm transition hover:bg-blue-50"
        >
          <i className="fas fa-book-open text-xs"></i>
          오답노트
        </button>
      </header>

      <section className="mb-6">
        <h2 className="mb-3 ml-1 flex items-center gap-2 text-lg font-bold text-gray-800">
          <i className="fas fa-flag-checkered text-blue-600"></i> 모의고사
        </h2>
        <div className="ws-flat-section">
          <div className="flex flex-wrap gap-3">
            <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
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
                  className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-bold transition ${
                    visible
                      ? "border-blue-200 bg-white text-blue-700 hover:bg-blue-50"
                      : "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-500"
                  }`}
                  aria-label={`${formatMockExamRoundLabel(round)} ${
                    visible ? "시작" : "잠김"
                  }`}
                >
                  {!visible && <i className="fas fa-lock text-xs"></i>}
                  {formatMockExamRoundShortLabel(round)}
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
          {!loadError && tree.length === 0 && (
            <div className="rounded-xl border border-gray-200 bg-white py-20 text-center text-gray-400">
              등록된 단원이 없습니다.
            </div>
          )}

          {tree.map((big, idx) => (
            <div
              key={idx}
              className="overflow-hidden rounded-xl border border-gray-200 bg-white transition-shadow hover:shadow-sm"
            >
              <button
                type="button"
                onClick={() => toggleAccordion(idx)}
                aria-expanded={expandedItems.has(idx)}
                aria-controls={`quiz-unit-${idx}`}
                className="flex w-full cursor-pointer items-center justify-between gap-3 bg-white p-5 text-left transition-colors hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <span className="text-lg font-extrabold text-gray-800">
                  {big.title}
                </span>
                <i
                  className={`fas fa-chevron-down text-gray-400 transition-transform duration-300 ${
                    expandedItems.has(idx) ? "rotate-180 text-blue-500" : ""
                  }`}
                ></i>
              </button>

              {expandedItems.has(idx) && (
                <div
                  id={`quiz-unit-${idx}`}
                  className="border-t border-gray-100 bg-gray-50"
                >
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
                              flex min-h-11 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-bold transition-all
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
                              flex min-h-11 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-bold transition-all
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
