import { getStudentMenuLabel } from "../../../constants/menus";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  getMockExamOverview,
  type MockExamOverview,
} from "../../../lib/assessmentLifecycle";
import { getYearSemester } from "../../../lib/semesterScope";
import "./quizIndex.css";
import chosiScene from "../../../assets/mock-exam/chosi.webp";
import boksiScene from "../../../assets/mock-exam/boksi.webp";
import jeonsiScene from "../../../assets/mock-exam/jeonsi.webp";
import InfoHelp from "../../../components/common/InfoHelp";
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
  isMockExamRound,
  normalizeMockExamRound,
  type MockExamRound,
} from "../../../lib/mockExamRounds";

interface TreeItem {
  id: string;
  title: string;
  children?: TreeItem[];
}

const getAllExpandedIndexes = (items: TreeItem[]) =>
  new Set(items.map((_, index) => index));

const examScenes = [
  {
    src: chosiScene,
    alt: "고을의 시험장에서 유생들이 한지에 붓과 먹으로 답안을 쓰는 초시 장면",
  },
  {
    src: boksiScene,
    alt: "한성의 시험장에서 시험관 아래 유생들이 한지에 붓으로 답안을 쓰는 복시 장면",
  },
  {
    src: jeonsiScene,
    alt: "곤룡포와 익선관을 갖춘 국왕을 향해 앉아 붓으로 답안을 쓰는 전시의 상징 장면",
  },
];

const QuizIndex: React.FC = () => {
  const { userData, currentUser, config, menuConfig } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const linkedRound = isMockExamRound(searchParams.get("round"))
    ? normalizeMockExamRound(searchParams.get("round"))
    : "";
  const openMockFromLink =
    searchParams.get("tab") === "mock" || isMockExamRound(linkedRound);

  const [tree, setTree] = useState<TreeItem[]>([]);
  const [assessmentConfig, setAssessmentConfig] = useState<
    Record<string, AssessmentConfigEntry>
  >({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<"units" | "mock">(
    openMockFromLink ? "mock" : "units",
  );
  const [hasOpenedMockExam, setHasOpenedMockExam] = useState(openMockFromLink);
  const [selectedRound, setSelectedRound] = useState<MockExamRound>(
    isMockExamRound(linkedRound) ? linkedRound! : "round_1",
  );
  const [clockNow, setClockNow] = useState(Date.now);
  const [serverClockOffset, setServerClockOffset] = useState(0);
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
    if (!openMockFromLink) return;
    setActiveTab("mock");
    setHasOpenedMockExam(true);
    if (isMockExamRound(linkedRound)) setSelectedRound(linkedRound!);
  }, [linkedRound, openMockFromLink]);

  // One local timer at the next opening boundary. Returning from a sleeping
  // mobile tab updates the same clock without polling or starting an attempt.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      if (timer) clearTimeout(timer);
      const now = Date.now() + serverClockOffset;
      setClockNow(now);
      const next = Object.values(assessmentConfig)
        .map((entry) => Date.parse(entry.opensAt || ""))
        .filter((time) => Number.isFinite(time) && time > now)
        .sort((a, b) => a - b)[0];
      if (next)
        timer = setTimeout(update, Math.min(next - now + 20, 2147483647));
    };
    update();
    window.addEventListener("pageshow", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("pageshow", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [assessmentConfig, serverClockOffset]);

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
          if (
            data.serverNowIso &&
            Number.isFinite(Date.parse(data.serverNowIso))
          ) {
            setServerClockOffset(Date.parse(data.serverNowIso) - Date.now());
          }
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
    const opensAt =
      assessmentConfig[getAssessmentConfigKey("exam_prep", "exam_prep", round)]
        ?.opensAt;
    if (opensAt && Date.parse(opensAt) > clockNow) return "공개 예정";
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
  const scheduled =
    selected.visible && Date.parse(selectedConfig?.opensAt || "") > clockNow;
  const openingLabel = selectedConfig?.opensAt
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(new Date(selectedConfig.opensAt))
    : "";
  const canEnter =
    selected.visible &&
    !scheduled &&
    selectedState?.prerequisiteMet === true &&
    !retakeBlocked;
  const selectedStatus = roundStatus(selected.round, selected.visible);
  const selectedScene =
    examScenes[getMockExamRoundNumber(selected.round) - 1] || examScenes[0];
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
        <div className="flex items-center gap-1">
          <h1>{pageTitle === "퀴즈" ? "문제 풀이" : pageTitle}</h1>
          <InfoHelp label="풀이 기록 수집 안내">
            시작 후에는 화면을 벗어나도 제한 시간이 계속됩니다. 문항을 화면에서
            본 시간, 첫 답과 마지막 답을 고른 시점, 답 변경·재방문·힌트 사용을
            답안과 함께 저장합니다. 화면을 벗어난 시간은 풀이 시간에서
            제외합니다. 시간만으로 실력이나 찍기를 판단하지 않으며, 풀이 기록은
            점수와 위스에 영향을 주지 않습니다.
          </InfoHelp>
        </div>
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
            <figure className="student-exam-lobby__art">
              <div className="student-exam-lobby__visual">
                <div
                  className={`student-exam-lobby__scene${scheduled ? " is-scheduled" : ""}`}
                >
                  <img
                    key={selected.round}
                    src={selectedScene.src}
                    alt={selectedScene.alt}
                    width="960"
                    height="720"
                    decoding="async"
                    draggable={false}
                  />
                </div>
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
                  {scheduled
                    ? "Coming soon"
                    : retakeBlocked
                      ? "재응시 불가"
                      : "시험 입장"}{" "}
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
            </figure>
            <div className="student-exam-lobby__entry">
              {scheduled && (
                <p className="student-exam-lobby__notice" role="status">
                  {openingLabel} 공개
                </p>
              )}
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
              ) : !canEnter && !retakeBlocked && !scheduled ? (
                <p className="student-exam-lobby__notice">
                  {selected.visible && selectedState?.prerequisiteMet === false
                    ? `${formatMockExamRoundShortLabel(selectedState.requiredRound)}를 제출한 뒤 입장할 수 있습니다.`
                    : !selected.visible
                      ? "아직 응시할 수 있도록 공개되지 않았습니다."
                      : "응시 상태를 확인할 수 없습니다."}
                </p>
              ) : null}
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
