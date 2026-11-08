import { getStudentMenuLabel } from "../../../constants/menus";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getMockExamOverview,
  type MockExamOverview,
} from "../../../lib/assessmentLifecycle";
import { getYearSemester } from "../../../lib/semesterScope";
import "./quizIndex.css";
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
  getMockExamRoundNumber,
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
  const { userData, currentUser, config, menuConfig } = useAuth();
  const navigate = useNavigate();

  const [tree, setTree] = useState<TreeItem[]>([]);
  const [assessmentConfig, setAssessmentConfig] = useState<
    Record<string, AssessmentConfigEntry>
  >({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [mockExamExpanded, setMockExamExpanded] = useState(false);
  const [mockOverview, setMockOverview] = useState<{
    scope: string;
    data: MockExamOverview;
  } | null>(null);
  const [mockOverviewError, setMockOverviewError] = useState("");
  const [mockOverviewLoading, setMockOverviewLoading] = useState(false);
  const [mockReloadKey, setMockReloadKey] = useState(0);
  const { year, semester } = getYearSemester(config);
  const semesterId = `${year}-${semester}`;
  const mockScope = `${currentUser?.uid || ""}:${semesterId}`;

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
  const hasOpenMockExam = mockExamRoundStates.some(({ visible }) => visible);
  const currentMockOverview =
    mockOverview?.scope === mockScope ? mockOverview.data : null;

  useEffect(() => {
    if (
      !mockExamExpanded ||
      !hasOpenMockExam ||
      !currentUser?.uid ||
      currentMockOverview
    )
      return;
    let cancelled = false;
    setMockOverviewLoading(true);
    setMockOverviewError("");
    void getMockExamOverview({ semesterId }).then(
      (data) => {
        if (!cancelled) {
          setMockOverview({ scope: mockScope, data });
          setMockOverviewLoading(false);
        }
      },
      () => {
        if (!cancelled) {
          setMockOverviewError(
            "응시 상태를 불러오지 못했습니다. 다시 확인해 주세요.",
          );
          setMockOverviewLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [
    mockExamExpanded,
    hasOpenMockExam,
    currentUser?.uid,
    mockScope,
    semesterId,
    currentMockOverview,
    mockReloadKey,
  ]);

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
        <h1>{getStudentMenuLabel(menuConfig, "/student/quiz", "퀴즈")}</h1>
        <button
          type="button"
          onClick={() => navigate("/student/mypage?menu=wrong_note")}
          className="inline-flex items-center gap-2 rounded-xl border border-blue-100 bg-white px-4 py-2.5 text-sm font-bold text-blue-700 shadow-sm transition hover:bg-blue-50"
        >
          <i className="fas fa-book-open text-xs"></i>
          오답노트
        </button>
      </header>

      <section className="student-mock-picker mb-6">
        <h2>
          <button
            type="button"
            className="student-mock-picker__toggle"
            aria-expanded={mockExamExpanded}
            aria-controls="student-mock-rounds"
            onClick={() => setMockExamExpanded((open) => !open)}
          >
            <span>
              <i className="fas fa-flag-checkered" aria-hidden="true"></i>{" "}
              모의고사
            </span>
            <svg
              className={mockExamExpanded ? "is-open" : ""}
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </h2>
        {mockExamExpanded && (
          <div id="student-mock-rounds" className="student-mock-picker__body">
            {mockOverviewLoading && (
              <p role="status" className="student-mock-picker__status">
                응시 상태 확인 중…
              </p>
            )}
            {mockOverviewError && (
              <div role="alert" className="student-mock-picker__error">
                <span>{mockOverviewError}</span>
                <button
                  type="button"
                  onClick={() => setMockReloadKey((key) => key + 1)}
                >
                  다시 확인
                </button>
              </div>
            )}
            <div className="student-mock-picker__rounds">
              {mockExamRoundStates.map(({ round, visible }) => {
                const state = currentMockOverview?.rounds.find(
                  (item) => item.examRound === round,
                );
                const available = visible && state?.prerequisiteMet === true;
                const status = !visible
                  ? "준비 중"
                  : state?.prerequisiteMet === false
                    ? `${getMockExamRoundNumber(state.requiredRound)}회 제출 후`
                    : state?.completed
                      ? "응시 완료"
                      : available
                        ? "응시 가능"
                        : mockOverviewError
                          ? "확인 필요"
                          : currentMockOverview
                            ? "준비 중"
                            : "확인 중";
                return (
                  <button
                    key={round}
                    type="button"
                    onClick={() =>
                      available &&
                      startQuiz(
                        "exam_prep",
                        "exam_prep",
                        formatMockExamRoundLabel(round),
                        round,
                      )
                    }
                    disabled={!available}
                    className={`student-mock-picker__round ${
                      available
                        ? "border-blue-200 bg-white text-blue-700 hover:bg-blue-50"
                        : "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-500"
                    }`}
                    aria-label={`${formatMockExamRoundShortLabel(round)} · ${status}`}
                  >
                    <span>
                      {!available && (
                        <i
                          className="fas fa-lock text-xs"
                          aria-hidden="true"
                        ></i>
                      )}{" "}
                      {formatMockExamRoundShortLabel(round)}
                    </span>
                    <small>{status}</small>
                  </button>
                );
              })}
            </div>
          </div>
        )}
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
                        className="student-quiz-unit border-b border-gray-200 last:border-0"
                      >
                        <div className="flex items-center font-semibold text-gray-700">
                          <i className="fas fa-folder mr-3 text-amber-400"></i>
                          {mid.title}
                        </div>
                        <div className="student-quiz-unit__actions">
                          <button
                            onClick={() =>
                              diagActive &&
                              startQuiz(mid.id, "diagnostic", mid.title)
                            }
                            disabled={!diagActive}
                            className={`
                              flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-bold transition-all
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
                            진단평가
                          </button>

                          <button
                            onClick={() =>
                              formActive &&
                              startQuiz(mid.id, "formative", mid.title)
                            }
                            disabled={!formActive}
                            className={`
                              flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-bold transition-all
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
                            형성평가
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
