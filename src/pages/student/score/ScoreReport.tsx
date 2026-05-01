import React, { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, orderBy, query } from "firebase/firestore";
import { PageLoading } from "../../../components/common/LoadingState";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import { getSemesterCollectionPath } from "../../../lib/semesterScope";
import {
  buildScoreRows,
  type GradingPlanLike,
  type ScoreBreakdownItem,
  type ScoreItemType,
  type ScoreRow,
  type ScoreSortMode,
} from "../../../lib/studentScores";

type Contribution = Record<ScoreItemType, number> & {
  total: number;
  enteredCount: number;
  itemCount: number;
  completionRate: number;
};

type SubjectAnalysis = {
  row: ScoreRow;
  contribution: Contribution;
  dominantType: ScoreItemType | null;
  nextOpenItem: ScoreBreakdownItem | null;
};

type ActivePoint = {
  rowId: string;
  type?: ScoreItemType;
};

const scoreTypes: ScoreItemType[] = ["exam", "performance", "other"];

const categoryMeta: Record<
  ScoreItemType,
  {
    label: string;
    shortLabel: string;
    dotClass: string;
    barClass: string;
    textClass: string;
  }
> = {
  exam: {
    label: "정기시험",
    shortLabel: "정기",
    dotClass: "bg-blue-600",
    barClass: "bg-blue-600",
    textClass: "text-blue-700",
  },
  performance: {
    label: "수행평가",
    shortLabel: "수행",
    dotClass: "bg-orange-500",
    barClass: "bg-orange-500",
    textClass: "text-orange-700",
  },
  other: {
    label: "기타",
    shortLabel: "기타",
    dotClass: "bg-slate-400",
    barClass: "bg-slate-400",
    textClass: "text-slate-600",
  },
};

const formatNumber = (value: number) => {
  const rounded = Number(value.toFixed(1));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

const formatScore = (value: number) => `${formatNumber(value)}점`;

const formatPercent = (value: number) => `${formatNumber(value)}%`;

const readDraftScores = (uid: string, year: string, semester: string) => {
  try {
    const raw = localStorage.getItem(`scoreDraft:${uid}:${year}:${semester}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { scores?: Record<string, unknown> };
    return parsed?.scores && typeof parsed.scores === "object" ? parsed.scores : {};
  } catch (error) {
    console.error("Failed to load score report draft scores:", error);
    return {};
  }
};

const getContribution = (row: ScoreRow): Contribution => {
  const contribution: Contribution = {
    exam: 0,
    performance: 0,
    other: 0,
    total: Math.max(0, Number(row.total || 0)),
    enteredCount: 0,
    itemCount: row.breakdown.length,
    completionRate: 0,
  };

  row.breakdown.forEach((item) => {
    if (!item.entered) return;
    contribution.enteredCount += 1;
    contribution[item.type] += Math.max(0, Number(item.weighted || 0));
  });

  contribution.completionRate =
    contribution.itemCount > 0
      ? (contribution.enteredCount / contribution.itemCount) * 100
      : 0;

  return contribution;
};

const getTypeShare = (contribution: Contribution, type: ScoreItemType) => {
  if (contribution.total <= 0) return 0;
  return (contribution[type] / contribution.total) * 100;
};

const getDominantType = (contribution: Contribution): ScoreItemType | null => {
  const [type, value] = scoreTypes
    .map((scoreType) => [scoreType, contribution[scoreType]] as const)
    .sort((a, b) => b[1] - a[1])[0];
  return value > 0 ? type : null;
};

const getNextOpenItem = (row: ScoreRow) =>
  row.breakdown
    .filter((item) => !item.entered)
    .sort((a, b) => Number(b.ratio || 0) - Number(a.ratio || 0))[0] || null;

const getActionText = (analysis: SubjectAnalysis | null) => {
  if (!analysis) {
    return "성적 계산기에 점수를 입력하면 이번 주 집중 과목이 자동으로 정리됩니다.";
  }

  const { row, nextOpenItem, dominantType } = analysis;
  if (nextOpenItem) {
    return `${row.subject}의 ${nextOpenItem.name}은 ${formatScore(
      Number(nextOpenItem.ratio || 0),
    )} 반영 항목입니다. 먼저 입력 여부와 준비 일정을 확인하세요.`;
  }

  if (dominantType) {
    return `${row.subject}은 ${categoryMeta[dominantType].label} 영향이 큽니다. 이 유형을 기준으로 복습 시간을 배치하세요.`;
  }

  return `${row.subject}은 아직 분석할 점수가 부족합니다. 실제 입력값이 모두 저장되었는지 확인하세요.`;
};

const ContributionPopover: React.FC<{
  analysis: SubjectAnalysis;
  activeType?: ScoreItemType;
}> = ({ analysis, activeType }) => {
  const { row, contribution } = analysis;

  return (
    <div className="absolute left-1/2 top-8 z-20 w-64 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
      <div className="space-y-2">
        {scoreTypes.map((type) => {
          const share = getTypeShare(contribution, type);
          return (
            <div
              key={type}
              className={`flex items-center justify-between gap-3 rounded-lg px-2 py-1 ${
                activeType === type ? "bg-blue-50" : ""
              }`}
            >
              <span className="flex items-center gap-2 font-bold text-slate-700">
                <span className={`h-2.5 w-2.5 rounded-full ${categoryMeta[type].dotClass}`} />
                {categoryMeta[type].label}
              </span>
              <span className="font-extrabold text-slate-900">
                {formatScore(contribution[type])} ({formatPercent(share)})
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-end justify-between border-t border-slate-100 pt-3">
        <span className="font-bold text-slate-500">현재 점수</span>
        <span className="text-xl font-black text-slate-900">{formatScore(row.total)}</span>
      </div>
    </div>
  );
};

const ScoreReport: React.FC = () => {
  const { user, userData, config } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [semester, setSemester] = useState(config?.semester || "1");
  const [grade, setGrade] = useState(userData?.grade || "1");
  const [sortMode, setSortMode] = useState<ScoreSortMode>("importance");
  const [activePoint, setActivePoint] = useState<ActivePoint | null>(null);

  useEffect(() => {
    setSemester(config?.semester || "1");
  }, [config?.semester]);

  useEffect(() => {
    setGrade(userData?.grade || "1");
  }, [userData?.grade]);

  useEffect(() => {
    if (!user || !config) {
      setLoading(false);
      return;
    }
    void loadReport();
  }, [user?.uid, config?.year, semester, grade, sortMode]);

  const loadReport = async () => {
    if (!user || !config) return;
    setLoading(true);
    try {
      const year = config.year || "2026";
      const scoreDocId = `${year}_${semester}`;

      const [scoreSnap, plansSnap] = await Promise.all([
        getDoc(doc(db, "users", user.uid, "academic_records", scoreDocId)),
        getDocs(
          query(
            collection(db, getSemesterCollectionPath({ year, semester }, "grading_plans")),
            orderBy("createdAt", "desc"),
          ),
        ),
      ]);

      const savedScores = scoreSnap.exists() ? scoreSnap.data().scores || {} : {};
      const draftScores = readDraftScores(user.uid, year, semester);
      const plans: GradingPlanLike[] = [];
      plansSnap.forEach((planDoc) => {
        plans.push({ id: planDoc.id, ...planDoc.data() } as GradingPlanLike);
      });

      setRows(
        buildScoreRows(plans, { ...savedScores, ...draftScores }, {
          year,
          semester,
          grade,
          filterByGrade: true,
          sortMode,
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  const analyses = useMemo<SubjectAnalysis[]>(
    () =>
      rows.map((row) => {
        const contribution = getContribution(row);
        return {
          row,
          contribution,
          dominantType: getDominantType(contribution),
          nextOpenItem: getNextOpenItem(row),
        };
      }),
    [rows],
  );

  const enteredAnalyses = analyses.filter((analysis) => analysis.row.hasData);
  const scoreAverage =
    enteredAnalyses.length > 0
      ? Math.round(
          enteredAnalyses.reduce((sum, analysis) => sum + analysis.row.total, 0) /
            enteredAnalyses.length,
        )
      : 0;
  const strongestAnalysis =
    [...enteredAnalyses].sort((a, b) => b.row.total - a.row.total)[0] || null;
  const focusAnalysis =
    [...enteredAnalyses].sort((a, b) => a.row.total - b.row.total)[0] ||
    analyses.find((analysis) => !analysis.row.hasData) ||
    null;

  const totalContribution = enteredAnalyses.reduce(
    (acc, analysis) => {
      scoreTypes.forEach((type) => {
        acc[type] += analysis.contribution[type];
      });
      acc.total += analysis.contribution.total;
      return acc;
    },
    { exam: 0, performance: 0, other: 0, total: 0 },
  );
  const examShare = totalContribution.total > 0
    ? (totalContribution.exam / totalContribution.total) * 100
    : 0;
  const performanceShare = totalContribution.total > 0
    ? (totalContribution.performance / totalContribution.total) * 100
    : 0;
  const otherShare = totalContribution.total > 0
    ? (totalContribution.other / totalContribution.total) * 100
    : 0;
  const dominantOverallType =
    scoreTypes
      .map((type) => [type, totalContribution[type]] as const)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || "exam";

  const summaryItems = [
    `${categoryMeta[dominantOverallType].label} 비중이 가장 높습니다.`,
    strongestAnalysis
      ? `${strongestAnalysis.row.subject}가 가장 안정적입니다.`
      : "아직 강점 과목을 판단할 점수가 부족합니다.",
    focusAnalysis
      ? `${focusAnalysis.row.subject}은 우선 확인이 필요합니다.`
      : "점수를 입력하면 보완 과목이 표시됩니다.",
  ];

  const strategyItems = [
    focusAnalysis
      ? `${focusAnalysis.row.subject}의 미입력 항목과 낮은 반영 구간을 먼저 점검하세요.`
      : "성적 계산기에서 최근 평가 점수를 먼저 입력하세요.",
    examShare >= performanceShare
      ? "정기시험 비중이 높으므로 오답 정리와 개념 확인 시간을 확보하세요."
      : "수행평가 비중이 높으므로 제출물 누락과 완성도를 확인하세요.",
    strongestAnalysis
      ? `${strongestAnalysis.row.subject}의 학습 루틴을 다른 과목에도 적용해 보세요.`
      : "입력 과목을 늘리면 비교 분석이 더 정확해집니다.",
  ];

  if (loading) return <PageLoading message="성적 리포트를 불러오는 중입니다." />;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-6">
      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <label className="flex items-center gap-3 text-sm font-extrabold text-slate-600">
            학기
            <select
              value={semester}
              onChange={(event) => setSemester(event.target.value)}
              className="h-11 min-w-36 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800"
            >
              <option value="1">1학기</option>
              <option value="2">2학기</option>
            </select>
          </label>
          <label className="flex items-center gap-3 text-sm font-extrabold text-slate-600">
            학년
            <select
              value={grade}
              onChange={(event) => setGrade(event.target.value)}
              className="h-11 min-w-36 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800"
            >
              <option value="1">1학년</option>
              <option value="2">2학년</option>
              <option value="3">3학년</option>
            </select>
          </label>
          <label className="flex items-center gap-3 text-sm font-extrabold text-slate-600 lg:ml-auto">
            정렬
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as ScoreSortMode)}
              className="h-11 min-w-40 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800"
            >
              <option value="importance">중요도순</option>
              <option value="name">과목명순</option>
              <option value="latest">등록순</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-blue-300 bg-white px-4 text-sm font-extrabold text-blue-700 transition hover:bg-blue-50"
          >
            <i className="fas fa-file-arrow-down text-xs" aria-hidden="true"></i>
            리포트 저장
          </button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.06)] lg:p-6">
          <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-2xl font-black text-slate-900">교과별 성적 분석</h1>
              <p className="mt-2 text-sm font-bold leading-6 text-slate-500">
                정기시험과 수행평가의 반영 비율을 한눈에 비교하고, 과목별 현재 점수를 확인하세요.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {scoreTypes.map((type) => (
                <span key={type} className="inline-flex items-center gap-2 text-sm font-bold text-slate-600">
                  <span className={`h-3 w-3 rounded-full ${categoryMeta[type].dotClass}`} />
                  {categoryMeta[type].label}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-slate-100">
            {analyses.length === 0 ? (
              <div className="bg-slate-50 px-4 py-16 text-center text-sm font-bold text-slate-400">
                등록된 평가 반영 비율이 없습니다. 교사가 반영 비율을 등록하면 리포트가 표시됩니다.
              </div>
            ) : (
              analyses.map((analysis) => {
                const { row, contribution } = analysis;
                const isActive = activePoint?.rowId === row.id;
                const emptyWidth = Math.max(0, 100 - contribution.total);

                return (
                  <div
                    key={row.id}
                    onClick={() =>
                      setActivePoint((current) =>
                        current?.rowId === row.id ? null : { rowId: row.id },
                      )
                    }
                    onMouseLeave={() =>
                      setActivePoint((current) =>
                        current?.rowId === row.id ? null : current,
                      )
                    }
                    className={`grid w-full cursor-pointer grid-cols-[88px_minmax(0,1fr)_70px_24px] items-center gap-3 border-b border-slate-100 px-3 py-4 text-left transition last:border-b-0 sm:grid-cols-[100px_minmax(0,1fr)_76px_24px] ${
                      isActive ? "bg-blue-50/70" : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    <span className="min-w-0 truncate text-lg font-black text-slate-900">
                      {row.subject}
                    </span>

                    <span className="relative min-w-0">
                      <span className="flex h-5 w-full overflow-hidden rounded-full bg-slate-200">
                        {scoreTypes.map((type) => {
                          const value = contribution[type];
                          if (value <= 0) return null;
                          return (
                            <span
                              key={type}
                              role="button"
                              tabIndex={0}
                              aria-label={`${row.subject} ${categoryMeta[type].label} ${formatScore(value)}`}
                              onMouseEnter={() => setActivePoint({ rowId: row.id, type })}
                              onFocus={() => setActivePoint({ rowId: row.id, type })}
                              onClick={(event) => {
                                event.stopPropagation();
                                setActivePoint({ rowId: row.id, type });
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setActivePoint({ rowId: row.id, type });
                                }
                              }}
                              className={`${categoryMeta[type].barClass} min-w-[3px] border-r-2 border-white outline-none transition hover:brightness-105 focus:ring-2 focus:ring-blue-300`}
                              style={{ width: `${Math.min(100, value)}%` }}
                            />
                          );
                        })}
                        {emptyWidth > 0 && (
                          <span className="bg-slate-200" style={{ width: `${emptyWidth}%` }} />
                        )}
                      </span>
                      {isActive && (
                        <ContributionPopover
                          analysis={analysis}
                          activeType={activePoint?.type}
                        />
                      )}
                    </span>

                    <span className="text-right text-xl font-black text-blue-600">
                      {formatScore(row.total)}
                    </span>
                    <span className="text-right text-2xl text-slate-300">›</span>
                  </div>
                );
              })
            )}
          </div>

          <p className="mt-4 flex items-start gap-2 text-xs font-bold leading-5 text-slate-400">
            <i className="fas fa-circle-info mt-0.5" aria-hidden="true"></i>
            PC에서는 막대에 마우스를 올리고, 모바일과 태블릿에서는 막대를 터치하면 반영 점수와 비율을 확인할 수 있습니다.
          </p>
        </section>

        <aside className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.06)] lg:p-6">
          <h2 className="text-2xl font-black text-slate-900">분석 리포트</h2>

          <div className="grid grid-cols-2 gap-3">
            <section className="rounded-xl border border-slate-200 p-4">
              <div className="text-sm font-extrabold text-slate-500">현재 평균</div>
              <div className="mt-2 text-4xl font-black text-blue-600">{scoreAverage}점</div>
              <p className="mt-2 text-xs font-bold text-slate-500">입력 과목 평균 점수</p>
            </section>
            <section className="rounded-xl border border-slate-200 p-4">
              <div className="text-sm font-extrabold text-slate-500">강점 과목</div>
              <div className="mt-2 truncate text-2xl font-black text-emerald-600">
                {strongestAnalysis?.row.subject || "-"}
              </div>
              <p className="mt-2 text-xs font-bold leading-5 text-slate-500">
                {strongestAnalysis
                  ? "가장 안정적인 성적을 유지하고 있어요."
                  : "점수 입력 후 표시됩니다."}
              </p>
            </section>
            <section className="rounded-xl border border-slate-200 p-4">
              <div className="text-sm font-extrabold text-slate-500">보완 필요</div>
              <div className="mt-2 truncate text-2xl font-black text-orange-600">
                {focusAnalysis?.row.subject || "-"}
              </div>
              <p className="mt-2 text-xs font-bold leading-5 text-slate-500">
                {focusAnalysis
                  ? `${categoryMeta[focusAnalysis.dominantType || "exam"].label} 관리가 중요합니다.`
                  : "분석할 과목이 없습니다."}
              </p>
            </section>
            <section className="rounded-xl border border-slate-200 p-4">
              <div className="text-sm font-extrabold text-slate-500">정기/수행 비중</div>
              <div className="mt-3 flex items-center gap-4">
                <div
                  className="h-20 w-20 shrink-0 rounded-full"
                  style={{
                    background: `conic-gradient(#2563eb 0 ${examShare}%, #f97316 ${examShare}% ${
                      examShare + performanceShare
                    }%, #94a3b8 ${examShare + performanceShare}% 100%)`,
                  }}
                  aria-label={`정기 ${formatPercent(examShare)}, 수행 ${formatPercent(performanceShare)}, 기타 ${formatPercent(otherShare)}`}
                >
                  <div className="m-4 h-12 w-12 rounded-full bg-white" />
                </div>
                <div className="space-y-2 text-xs font-extrabold text-slate-600">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
                    정기 {formatPercent(examShare)}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
                    수행 {formatPercent(performanceShare)}
                  </div>
                  {otherShare > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
                      기타 {formatPercent(otherShare)}
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-base font-black text-slate-900">리포트 요약</h3>
            <ul className="mt-3 space-y-2">
              {summaryItems.map((item) => (
                <li key={item} className="flex gap-2 text-sm font-bold leading-6 text-slate-600">
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-base font-black text-slate-900">추천 학습 전략</h3>
            <ul className="mt-3 space-y-2">
              {strategyItems.map((item) => (
                <li key={item} className="flex gap-2 text-sm font-bold leading-6 text-slate-600">
                  <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] text-white">
                    <i className="fas fa-check" aria-hidden="true"></i>
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-amber-300 bg-white text-xl text-amber-500">
                <i className="fas fa-star" aria-hidden="true"></i>
              </span>
              <div>
                <h3 className="text-base font-black text-orange-700">이번 주 포인트</h3>
                <p className="mt-1 text-sm font-bold leading-6 text-slate-700">
                  {getActionText(focusAnalysis)}
                </p>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
};

export default ScoreReport;
