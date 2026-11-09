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
  isAssessmentVisibleToStudent,
  readAssessmentConfigMap,
} from "../../../lib/assessmentConfig";
import {
  formatMockExamRoundLabel,
  formatMockExamRoundShortLabel,
  getMockExamRoundsFromAssessmentConfig,
  getMockExamRoundNumber,
  getMockExamRoundName,
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
  const [activeTab, setActiveTab] = useState<"units" | "mock">("units");
  const [hasOpenedMockExam, setHasOpenedMockExam] = useState(false);
  const [selectedRound, setSelectedRound] = useState<MockExamRound>("round_1");
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
      setAssessmentConfig({});
      setTree([]);
      try {
        const [nextTree, nextConfig] = await Promise.all([
          readStudentCurriculumTree(config),
          readAssessmentConfigMap(config),
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
  }, [config?.year, config?.semester, currentUser?.uid, reloadKey]);

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
      { state: { startAssessment: true } },
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
      !hasOpenedMockExam ||
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
    hasOpenedMockExam,
    hasOpenMockExam,
    currentUser?.uid,
    mockScope,
    semesterId,
    currentMockOverview,
    mockReloadKey,
  ]);

  const selectTab = (tab: "units" | "mock") => {
    setActiveTab(tab);
    if (tab === "mock") setHasOpenedMockExam(true);
  };
  const roundStatus = (round: MockExamRound, visible: boolean) => {
    const state = currentMockOverview?.rounds.find(
      (item) => item.examRound === round,
    );
    if (!visible) return "준비 중";
    if (state?.prerequisiteMet === false)
      return `${getMockExamRoundNumber(state.requiredRound)}회 제출 후`;
    if (state?.completed) return "응시 완료";
    if (state?.prerequisiteMet) return "응시 가능";
    return mockOverviewError
      ? "확인 필요"
      : currentMockOverview
        ? "확인 필요"
        : "확인 중";
  };
  const selected =
    mockExamRoundStates.find((item) => item.round === selectedRound) ||
    mockExamRoundStates[0];
  const selectedState = currentMockOverview?.rounds.find(
    (item) => item.examRound === selected.round,
  );
  const selectedConfig =
    assessmentConfig[
      getAssessmentConfigKey("exam_prep", "exam_prep", selected.round)
    ];
  const retakeBlocked = selectedState?.retakeBlocked === true;
  const canEnter =
    selected.visible &&
    selectedState?.prerequisiteMet === true &&
    !retakeBlocked;
  const selectedStatus = roundStatus(selected.round, selected.visible);
  const pageTitle = getStudentMenuLabel(
    menuConfig,
    "/student/quiz",
    "문제 풀이",
  );

  if (loading) {
    return (
      <InlineLoading
        message="문제 풀이 목록을 불러오는 중입니다."
        showWarning
      />
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
        <h1>{pageTitle === "퀴즈" ? "문제 풀이" : pageTitle}</h1>
        <button
          type="button"
          onClick={() => navigate("/student/mypage?menu=wrong_note")}
          className="inline-flex items-center gap-2 rounded-xl border border-blue-100 bg-white px-4 py-2.5 text-sm font-bold text-blue-700 shadow-sm transition hover:bg-blue-50"
        >
          <i className="fas fa-book-open text-xs"></i>
          오답 노트
        </button>
      </header>

      <div className="ws-page-tabs" role="tablist" aria-label="평가 종류">
        {(
          [
            { id: "units", label: "단원별 평가" },
            { id: "mock", label: "모의고사" },
          ] as const
        ).map(({ id, label }) => (
          <button
            key={id}
            id={`quiz-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`quiz-panel-${id}`}
            tabIndex={activeTab === id ? 0 : -1}
            onClick={() => selectTab(id)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "units"
                  : event.key === "End"
                    ? "mock"
                    : id === "units"
                      ? "mock"
                      : "units";
              selectTab(next);
              document.getElementById(`quiz-tab-${next}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "mock" ? (
        <section
          id="quiz-panel-mock"
          role="tabpanel"
          aria-labelledby="quiz-tab-mock"
          className="student-exam-lobby"
        >
          <div
            className="student-exam-lobby__rounds"
            aria-label="모의고사 회차"
          >
            {mockExamRoundStates.map(({ round, visible }) => (
              <button
                key={round}
                type="button"
                className="student-exam-lobby__round"
                aria-pressed={selected.round === round}
                aria-controls="student-exam-detail"
                aria-label={`${formatMockExamRoundShortLabel(round)} · ${roundStatus(round, visible)}`}
                onClick={() => setSelectedRound(round)}
              >
                <span className="student-exam-lobby__round-number">
                  {getMockExamRoundNumber(round)}회
                </span>
                <strong>{getMockExamRoundName(round)}</strong>
                <small>{roundStatus(round, visible)}</small>
                <svg
                  className="student-exam-lobby__round-arrow"
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="m9 5 7 7-7 7" />
                </svg>
              </button>
            ))}
          </div>
          <div
            id="student-exam-detail"
            className="student-exam-lobby__detail"
            aria-labelledby="student-exam-heading"
          >
            <div className="student-exam-lobby__heading">
              <p className="student-exam-lobby__eyebrow">
                역사과 모의고사 · {getMockExamRoundNumber(selected.round)}회
              </p>
              <h2 id="student-exam-heading">
                {getMockExamRoundName(selected.round)}
              </h2>
              <span
                className={`student-exam-lobby__status${canEnter ? " is-ready" : ""}`}
              >
                <span aria-hidden="true" />
                {selectedStatus}
              </span>
            </div>
            <div className="student-exam-lobby__paper" aria-hidden="true">
              <svg viewBox="0 0 200 240" fill="none">
                <path d="M14 7H173L187 22V229H14Z" fill="white" />
                <path d="M173 7V22H187" stroke="#cbd5e1" />
                <path d="M27 58H174M100 73V206" stroke="#cbd5e1" />
                <text
                  x="100"
                  y="35"
                  textAnchor="middle"
                  fill="#1e3a8a"
                  fontSize="12"
                  fontWeight="700"
                >
                  역사과 모의고사
                </text>
                <text
                  x="100"
                  y="49"
                  textAnchor="middle"
                  fill="#64748b"
                  fontSize="8"
                >
                  {getMockExamRoundNumber(selected.round)}회 ·{" "}
                  {getMockExamRoundName(selected.round)}
                </text>
                {[80, 125, 170].map((y) => (
                  <g key={y} stroke="#cbd5e1">
                    <circle cx="31" cy={y} r="3" />
                    <path
                      d={`M40 ${y}H87M28 ${y + 10}H87M28 ${y + 20}H75M113 ${y}H172M113 ${y + 10}H172M113 ${y + 20}H160`}
                    />
                  </g>
                ))}
                <g transform="translate(132 170) rotate(-8)">
                  <rect
                    x="0"
                    y="0"
                    width="40"
                    height="40"
                    rx="2"
                    stroke="var(--ws-danger, #dc2626)"
                    strokeWidth="2"
                  />
                  <rect
                    x="4"
                    y="4"
                    width="32"
                    height="32"
                    stroke="var(--ws-danger, #dc2626)"
                  />
                  <text
                    x="20"
                    y="25"
                    textAnchor="middle"
                    fill="var(--ws-danger, #dc2626)"
                    fontSize="13"
                    fontWeight="800"
                  >
                    {getMockExamRoundName(selected.round).slice(0, 2)}
                  </text>
                </g>
              </svg>
            </div>
            <dl className="student-exam-lobby__facts">
              {selected.visible && selectedConfig?.hasExplicitQuestionCount && (
                <div>
                  <dt>출제 문항</dt>
                  <dd>
                    {selectedConfig.questionCount}
                    <span>문항</span>
                  </dd>
                </div>
              )}
              {selected.visible && selectedConfig?.hasExplicitTimeLimit && (
                <div>
                  <dt>제한 시간</dt>
                  <dd>
                    {Math.floor(selectedConfig.timeLimit / 60) > 0 && (
                      <>
                        {Math.floor(selectedConfig.timeLimit / 60)}
                        <span>분</span>
                      </>
                    )}
                    {selectedConfig.timeLimit % 60 > 0 && (
                      <>
                        {selectedConfig.timeLimit % 60}
                        <span>초</span>
                      </>
                    )}
                  </dd>
                </div>
              )}
            </dl>
            <div className="student-exam-lobby__entry">
              {mockOverviewError && selected.visible ? (
                <div className="student-exam-lobby__error" role="alert">
                  <span>{mockOverviewError}</span>
                  <button
                    type="button"
                    onClick={() => setMockReloadKey((key) => key + 1)}
                  >
                    다시 확인
                  </button>
                </div>
              ) : mockOverviewLoading && selected.visible ? (
                <p className="student-exam-lobby__notice" role="status">
                  응시 상태 확인 중…
                </p>
              ) : !canEnter && !retakeBlocked ? (
                <p className="student-exam-lobby__notice">
                  {selected.visible && selectedState?.prerequisiteMet === false
                    ? `${formatMockExamRoundShortLabel(selectedState.requiredRound)}를 제출한 뒤 입장할 수 있습니다.`
                    : !selected.visible
                      ? "아직 응시할 수 있도록 공개되지 않았습니다."
                      : "응시 상태를 확인할 수 없습니다."}
                </p>
              ) : null}
              <button
                type="button"
                className="student-exam-lobby__enter"
                disabled={!canEnter}
                onClick={() =>
                  canEnter &&
                  startQuiz(
                    "exam_prep",
                    "exam_prep",
                    formatMockExamRoundLabel(selected.round),
                    selected.round,
                  )
                }
              >
                {retakeBlocked ? "재응시 불가" : "시험 입장"}{" "}
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M4 12h15m-6-6 6 6-6 6" />
                </svg>
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section
          id="quiz-panel-units"
          role="tabpanel"
          aria-labelledby="quiz-tab-units"
        >
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
      )}
    </div>
  );
};

export default QuizIndex;
