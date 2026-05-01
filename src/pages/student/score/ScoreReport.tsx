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
} from "../../../lib/studentScores";

type Contribution = Record<ScoreItemType, number> & {
  total: number;
  enteredCount: number;
  itemCount: number;
  completionRate: number;
  openRatio: number;
};

type SubjectAnalysis = {
  row: ScoreRow;
  contribution: Contribution;
  dominantType: ScoreItemType | null;
  nextOpenItem: ScoreBreakdownItem | null;
};

const categoryMeta: Record<
  ScoreItemType,
  {
    label: string;
    shortLabel: string;
    barClass: string;
    bgClass: string;
    textClass: string;
    borderClass: string;
  }
> = {
  exam: {
    label: "정기시험",
    shortLabel: "정기",
    barClass: "bg-blue-600",
    bgClass: "bg-blue-50",
    textClass: "text-blue-700",
    borderClass: "border-blue-100",
  },
  performance: {
    label: "수행평가",
    shortLabel: "수행",
    barClass: "bg-amber-500",
    bgClass: "bg-amber-50",
    textClass: "text-amber-700",
    borderClass: "border-amber-100",
  },
  other: {
    label: "기타",
    shortLabel: "기타",
    barClass: "bg-slate-500",
    bgClass: "bg-slate-50",
    textClass: "text-slate-700",
    borderClass: "border-slate-100",
  },
};

const scoreTypes: ScoreItemType[] = ["exam", "performance", "other"];

const formatNumber = (value: number) => {
  const rounded = Number(value.toFixed(1));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

const formatScore = (value: number) => `${formatNumber(value)}점`;

const formatPercent = (value: number) => `${formatNumber(value)}%`;

const getContribution = (row: ScoreRow): Contribution => {
  const contribution: Contribution = {
    exam: 0,
    performance: 0,
    other: 0,
    total: Math.max(0, Number(row.total || 0)),
    enteredCount: 0,
    itemCount: row.breakdown.length,
    completionRate: 0,
    openRatio: 0,
  };

  let plannedRatio = 0;
  row.breakdown.forEach((item) => {
    plannedRatio += Math.max(0, Number(item.ratio || 0));
    if (!item.entered) return;
    contribution.enteredCount += 1;
    contribution[item.type] += Math.max(0, Number(item.weighted || 0));
  });

  contribution.completionRate =
    contribution.itemCount > 0
      ? (contribution.enteredCount / contribution.itemCount) * 100
      : 0;
  contribution.openRatio = Math.max(0, plannedRatio - contribution.total);

  return contribution;
};

const getTypeShare = (contribution: Contribution, type: ScoreItemType) => {
  if (contribution.total <= 0) return 0;
  return (contribution[type] / contribution.total) * 100;
};

const getDominantType = (contribution: Contribution): ScoreItemType | null => {
  const [topType, topValue] = scoreTypes
    .map((type) => [type, contribution[type]] as const)
    .sort((a, b) => b[1] - a[1])[0];

  return topValue > 0 ? topType : null;
};

const getNextOpenItem = (row: ScoreRow) =>
  row.breakdown
    .filter((item) => !item.entered)
    .sort((a, b) => Number(b.ratio || 0) - Number(a.ratio || 0))[0] || null;

const getActionText = (analysis: SubjectAnalysis | null) => {
  if (!analysis) {
    return "성적 계산기에서 점수를 입력하면 과목별 공략 포인트가 자동으로 정리됩니다.";
  }

  const { row, dominantType, nextOpenItem } = analysis;
  if (nextOpenItem) {
    return `${row.subject}의 ${nextOpenItem.name}은 ${formatScore(
      Number(nextOpenItem.ratio || 0),
    )} 반영 항목입니다. 아직 입력되지 않은 큰 항목부터 확인하세요.`;
  }

  if (dominantType) {
    return `${row.subject}은 현재 ${categoryMeta[dominantType].label}이 점수의 가장 큰 비중을 차지합니다. 다음 학습 시간은 이 유형에 맞춰 잡는 것이 효율적입니다.`;
  }

  return `${row.subject}은 입력된 점수가 낮습니다. 먼저 실제 점수가 모두 저장되어 있는지 확인하세요.`;
};

const ScoreReport: React.FC = () => {
  const { user, userData, config } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ScoreRow[]>([]);

  useEffect(() => {
    if (!user || !config) {
      setLoading(false);
      return;
    }
    void loadReport();
  }, [user?.uid, config?.year, config?.semester, userData?.grade]);

  const loadReport = async () => {
    if (!user || !config) return;
    setLoading(true);
    try {
      const year = config.year || "2026";
      const semester = config.semester || "1";
      const scoreDocId = `${year}_${semester}`;

      const [scoreSnap, plansSnap] = await Promise.all([
        getDoc(doc(db, "users", user.uid, "academic_records", scoreDocId)),
        getDocs(
          query(
            collection(db, getSemesterCollectionPath(config, "grading_plans")),
            orderBy("createdAt", "desc"),
          ),
        ),
      ]);

      const scoreMap = scoreSnap.exists() ? scoreSnap.data().scores || {} : {};
      const plans: GradingPlanLike[] = [];
      plansSnap.forEach((planDoc) => {
        plans.push({ id: planDoc.id, ...planDoc.data() } as GradingPlanLike);
      });

      setRows(
        buildScoreRows(plans, scoreMap, {
          year,
          semester,
          grade: userData?.grade || "",
          filterByGrade: true,
          sortMode: "importance",
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

  if (loading) return <PageLoading message="성적 리포트를 불러오는 중입니다." />;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="grid gap-4 lg:grid-cols-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
          <div className="text-sm font-extrabold text-slate-500">입력 과목</div>
          <div className="mt-2 text-4xl font-black text-blue-600">
            {enteredAnalyses.length}
            <span className="text-xl text-slate-400">/{analyses.length}</span>
          </div>
          <p className="mt-3 text-xs font-bold leading-5 text-slate-500">
            점수가 입력된 과목만 평균과 비율 분석에 반영됩니다.
          </p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
          <div className="text-sm font-extrabold text-slate-500">현재 평균</div>
          <div className="mt-2 text-4xl font-black text-blue-600">{scoreAverage}점</div>
          <p className="mt-3 text-xs font-bold leading-5 text-slate-500">
            입력된 과목의 반영 점수를 기준으로 계산했습니다.
          </p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
          <div className="text-sm font-extrabold text-slate-500">강점 과목</div>
          <div className="mt-2 truncate text-3xl font-black text-emerald-600">
            {strongestAnalysis?.row.subject || "-"}
          </div>
          <p className="mt-3 text-xs font-bold leading-5 text-slate-500">
            {strongestAnalysis
              ? `${formatScore(strongestAnalysis.row.total)}로 현재 가장 안정적입니다.`
              : "아직 비교할 점수가 없습니다."}
          </p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
          <div className="text-sm font-extrabold text-slate-500">정기/수행 비중</div>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100">
            <div className="bg-blue-600" style={{ width: `${examShare}%` }} />
            <div className="bg-amber-500" style={{ width: `${performanceShare}%` }} />
          </div>
          <p className="mt-3 text-xs font-bold leading-5 text-slate-500">
            정기 {formatPercent(examShare)} · 수행 {formatPercent(performanceShare)}
          </p>
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(15,23,42,0.05)] lg:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900">교과별 반영 비율 분석</h1>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-500">
              한 과목의 현재 점수 안에서 정기시험과 수행평가가 각각 얼마나 차지하는지 보여줍니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {scoreTypes.map((type) => (
              <span
                key={type}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-extrabold ${categoryMeta[type].borderClass} ${categoryMeta[type].bgClass} ${categoryMeta[type].textClass}`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${categoryMeta[type].barClass}`} />
                {categoryMeta[type].label}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {analyses.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm font-bold text-slate-400">
              등록된 평가 반영 비율이 없습니다. 교사가 반영 비율을 등록하면 리포트가 표시됩니다.
            </div>
          ) : (
            analyses.map((analysis) => {
              const { row, contribution, dominantType, nextOpenItem } = analysis;
              const hasScore = contribution.total > 0;

              return (
                <article
                  key={row.id}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-lg font-black text-slate-900">{row.subject}</h2>
                      <p className="mt-1 text-xs font-bold text-slate-500">
                        {row.hasData
                          ? `${contribution.enteredCount}/${contribution.itemCount}개 항목 입력 · 입력률 ${formatPercent(contribution.completionRate)}`
                          : "아직 입력된 점수가 없습니다."}
                      </p>
                    </div>
                    <div className="text-left sm:text-right">
                      <div className="text-xs font-extrabold text-slate-400">현재 반영 점수</div>
                      <div className="text-2xl font-black text-blue-600">
                        {formatScore(row.total)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="flex h-6 overflow-hidden rounded-full bg-slate-100">
                      {hasScore ? (
                        scoreTypes.map((type) => {
                          const share = getTypeShare(contribution, type);
                          if (share <= 0) return null;
                          return (
                            <div
                              key={type}
                              className={`${categoryMeta[type].barClass} border-r-2 border-white last:border-r-0`}
                              style={{ width: `${share}%` }}
                              title={`${categoryMeta[type].label} ${formatScore(
                                contribution[type],
                              )} (${formatPercent(share)})`}
                            />
                          );
                        })
                      ) : (
                        <div className="flex w-full items-center justify-center text-xs font-extrabold text-slate-400">
                          미입력
                        </div>
                      )}
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      {scoreTypes.map((type) => {
                        const share = getTypeShare(contribution, type);
                        return (
                          <div
                            key={type}
                            className={`rounded-xl border px-3 py-2 ${categoryMeta[type].borderClass} ${categoryMeta[type].bgClass}`}
                          >
                            <div className={`text-xs font-black ${categoryMeta[type].textClass}`}>
                              {categoryMeta[type].label}
                            </div>
                            <div className="mt-1 flex items-end justify-between gap-2">
                              <span className="text-lg font-black text-slate-900">
                                {formatScore(contribution[type])}
                              </span>
                              <span className="text-xs font-extrabold text-slate-500">
                                {formatPercent(share)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {row.breakdown.length === 0 ? (
                      <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-400">
                        평가 항목 없음
                      </span>
                    ) : (
                      row.breakdown.map((item) => (
                        <span
                          key={item.key}
                          className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                            item.entered
                              ? "border-slate-200 bg-white text-slate-600"
                              : "border-dashed border-slate-300 bg-slate-50 text-slate-400"
                          }`}
                        >
                          {categoryMeta[item.type].shortLabel} · {item.name} ·{" "}
                          {item.entered
                            ? `${formatScore(item.weighted)} 반영`
                            : `${formatScore(item.ratio)} 예정`}
                        </span>
                      ))
                    )}
                  </div>

                  <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm font-bold leading-6 text-slate-600">
                    {nextOpenItem
                      ? `${nextOpenItem.name}이 아직 비어 있습니다. ${formatScore(
                          nextOpenItem.ratio,
                        )} 반영 항목이라 입력 여부를 먼저 확인하세요.`
                      : dominantType
                        ? `${categoryMeta[dominantType].label} 영향이 가장 큽니다. 이 과목은 ${categoryMeta[dominantType].label} 대비가 점수 관리의 핵심입니다.`
                        : "입력된 항목이 없어 아직 분석할 수 없습니다."}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5">
          <div className="text-sm font-black text-blue-700">오늘의 1순위</div>
          <p className="mt-3 text-base font-extrabold leading-7 text-slate-800">
            {focusAnalysis ? focusAnalysis.row.subject : "점수 입력"}
          </p>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            {getActionText(focusAnalysis)}
          </p>
        </div>

        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5">
          <div className="text-sm font-black text-emerald-700">유지할 강점</div>
          <p className="mt-3 text-base font-extrabold leading-7 text-slate-800">
            {strongestAnalysis?.row.subject || "아직 없음"}
          </p>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            {strongestAnalysis
              ? `${strongestAnalysis.row.subject}은 ${formatScore(
                  strongestAnalysis.row.total,
                )}입니다. 같은 학습 루틴을 다른 과목에도 옮겨 보세요.`
              : "점수가 입력되면 가장 안정적인 과목을 찾아 줍니다."}
          </p>
        </div>

        <div className="rounded-2xl border border-amber-100 bg-amber-50 p-5">
          <div className="text-sm font-black text-amber-700">비율 해석</div>
          <p className="mt-3 text-base font-extrabold leading-7 text-slate-800">
            {examShare >= performanceShare ? "정기시험 중심" : "수행평가 중심"}
          </p>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            {totalContribution.total > 0
              ? examShare >= performanceShare
                ? "현재 입력 점수에서는 정기시험 비중이 더 큽니다. 개념 확인과 오답 정리에 우선순위를 두세요."
                : "현재 입력 점수에서는 수행평가 비중이 더 큽니다. 제출물 완성도와 누락 항목 확인이 중요합니다."
              : "점수가 입력되면 정기시험과 수행평가 중 어디에 더 집중할지 보여 줍니다."}
          </p>
        </div>
      </section>
    </div>
  );
};

export default ScoreReport;
