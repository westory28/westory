import React, { useEffect, useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  Tooltip,
} from "chart.js";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { PageLoading } from "../../../components/common/LoadingState";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import { getYearSemester } from "../../../lib/semesterScope";
import {
  PERFORMANCE_SCORE_USER_COLLECTION,
  formatPerformanceScore,
  getPerformanceScorePercent,
  type PerformanceScoreRecord,
} from "../../../lib/performanceScores";
import { getPerformanceScoreItemShortName } from "../../../lib/performanceScoreWorkbook";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

const formatDateTime = (value: unknown) => {
  const seconds =
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds?: unknown }).seconds === "number"
      ? (value as { seconds: number }).seconds
      : null;
  if (!seconds) return "";
  return new Date(seconds * 1000).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const getRecordDate = (record: PerformanceScoreRecord) =>
  formatDateTime(record.updatedAt) || formatDateTime(record.uploadedAt);

const getItemLabel = (
  item: { name: string; shortName?: string },
  index: number,
) => item.shortName || getPerformanceScoreItemShortName(item.name, index);

const PerformanceScoreView: React.FC = () => {
  const { currentUser, userData, config } = useAuth();
  const { year, semester } = getYearSemester(config);
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<PerformanceScoreRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    if (!currentUser?.uid) {
      setLoading(false);
      return;
    }
    void loadScores();
  }, [currentUser?.uid, year, semester]);

  const loadScores = async () => {
    if (!currentUser?.uid) return;
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(
            db,
            "users",
            currentUser.uid,
            PERFORMANCE_SCORE_USER_COLLECTION,
          ),
          orderBy("updatedAt", "desc"),
        ),
      );
      const loaded = snap.docs
        .map(
          (item) =>
            ({
              id: item.id,
              ...item.data(),
            }) as PerformanceScoreRecord,
        )
        .filter(
          (record) =>
            String(record.academicYear || "") === year &&
            String(record.semester || "") === semester,
        )
        .sort(
          (a, b) =>
            (a.assessmentOrder ?? 999) - (b.assessmentOrder ?? 999) ||
            String(a.title || "").localeCompare(String(b.title || ""), "ko"),
        );
      setRecords(loaded);
      setSelectedId((current) =>
        loaded.some((record) => record.id === current)
          ? current
          : loaded[0]?.id || "",
      );
    } catch (error) {
      console.error("Failed to load performance scores:", error);
    } finally {
      setLoading(false);
    }
  };

  const selectedRecord = useMemo(
    () =>
      records.find((record) => record.id === selectedId) || records[0] || null,
    [records, selectedId],
  );

  const percent = selectedRecord
    ? getPerformanceScorePercent(
        selectedRecord.totalScore,
        selectedRecord.totalMaxScore,
      )
    : 0;
  const selectedItems = Array.isArray(selectedRecord?.items)
    ? selectedRecord.items
    : [];
  const chartItems = selectedItems.filter(
    (item) => item.scoreEntered !== false,
  );
  const evidenceText =
    selectedRecord?.evidence || selectedRecord?.feedback || "";
  const chartMaxScore = selectedRecord
    ? Math.max(10, ...chartItems.map((item) => item.maxScore || 0))
    : 50;

  const chartData = selectedRecord
    ? {
        labels: chartItems.map((item, index) => getItemLabel(item, index)),
        datasets: [
          {
            label: "획득 점수",
            data: chartItems.map((item) => item.score),
            backgroundColor: "#2563eb",
            borderRadius: 6,
            barPercentage: 0.55,
          },
          {
            label: "만점 기준",
            data: chartItems.map((item) => item.maxScore),
            backgroundColor: "#cbd5e1",
            borderRadius: 6,
            barPercentage: 0.55,
          },
        ],
      }
    : { labels: [], datasets: [] };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        labels: {
          boxWidth: 10,
          boxHeight: 10,
          font: {
            weight: "bold" as const,
          },
        },
      },
      tooltip: {
        callbacks: {
          label: (context: {
            dataset: { label?: string };
            parsed: { y: number };
          }) =>
            `${context.dataset.label || "점수"}: ${formatPerformanceScore(
              context.parsed.y,
            )}점`,
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        suggestedMax: chartMaxScore,
        ticks: {
          callback: (value: string | number) => `${value}점`,
        },
      },
      x: {
        ticks: {
          font: {
            size: 11,
            weight: "bold" as const,
          },
        },
      },
    },
  };

  if (loading) {
    return <PageLoading message="내 수행평가 점수를 불러오는 중입니다." />;
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-6">
      <div className="mb-5 rounded-xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900">
              내 수행평가 점수
            </h1>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-500">
              {year}학년도 {semester}학기 기준으로 교사가 입력한 내 총점,
              평가요소별 점수, 감점 요인과 평가 근거만 표시됩니다.
            </p>
          </div>
          <div className="rounded-full bg-blue-50 px-4 py-2 text-sm font-black text-blue-700">
            {userData?.grade || "-"}학년 {userData?.class || "-"}반{" "}
            {userData?.number || "-"}번
          </div>
        </div>
      </div>

      {!selectedRecord ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-16 text-center shadow-sm">
          <div className="text-lg font-black text-slate-700">
            아직 등록된 수행평가 점수가 없습니다.
          </div>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-400">
            교사가 점수 명단을 저장하면 이곳에서 내 점수와 피드백을 확인할 수
            있습니다.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-black text-slate-500">점수 목록</h2>
            <div className="mt-3 space-y-2">
              {records.map((record) => {
                const recordPercent = getPerformanceScorePercent(
                  record.totalScore,
                  record.totalMaxScore,
                );
                const active =
                  record.id === selectedRecord.id ||
                  (!selectedRecord.id && record.id === records[0]?.id);
                return (
                  <button
                    key={record.id || record.rosterId}
                    type="button"
                    onClick={() => setSelectedId(record.id || "")}
                    className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                      active
                        ? "border-blue-300 bg-blue-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="truncate text-sm font-black text-slate-900">
                      {record.title}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="text-xs font-bold text-slate-500">
                        {formatPerformanceScore(record.totalScore)} /{" "}
                        {formatPerformanceScore(record.totalMaxScore)}
                      </span>
                      <span className="text-xs font-black text-blue-700">
                        {formatPerformanceScore(recordPercent)}%
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-sm font-black text-blue-700">
                  {selectedRecord.subject || "수행평가"}
                </div>
                <h2 className="mt-1 text-2xl font-black text-slate-900">
                  {selectedRecord.title}
                </h2>
                {getRecordDate(selectedRecord) && (
                  <p className="mt-2 text-xs font-bold text-slate-400">
                    최종 반영일: {getRecordDate(selectedRecord)}
                  </p>
                )}
              </div>
              <div className="text-right">
                <div className="text-sm font-black text-slate-500">
                  총점 / 만점
                </div>
                <div className="mt-1 text-4xl font-black text-blue-600">
                  {formatPerformanceScore(selectedRecord.totalScore)}
                  <span className="text-xl text-slate-300">
                    {" "}
                    / {formatPerformanceScore(selectedRecord.totalMaxScore)}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)]">
              <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-5">
                <div
                  className="flex h-36 w-36 items-center justify-center rounded-full"
                  style={{
                    background: `conic-gradient(#2563eb 0 ${percent}%, #e2e8f0 ${percent}% 100%)`,
                  }}
                  aria-label={`총점 비율 ${formatPerformanceScore(percent)}퍼센트`}
                >
                  <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-white">
                    <span className="text-3xl font-black text-slate-900">
                      {formatPerformanceScore(percent)}
                    </span>
                    <span className="text-xs font-black text-slate-400">%</span>
                  </div>
                </div>
                <p className="mt-4 text-center text-sm font-bold leading-6 text-slate-500">
                  만점 {formatPerformanceScore(selectedRecord.totalMaxScore)}점
                  기준
                </p>
              </div>

              <div className="h-72 rounded-xl border border-slate-200 p-4">
                {chartItems.length > 0 ? (
                  <Bar data={chartData} options={chartOptions} />
                ) : (
                  <div className="flex h-full items-center justify-center text-center text-sm font-bold leading-6 text-slate-400">
                    평가요소별 세부 점수는 제공되지 않았습니다.
                    <br />
                    총점과 평가 근거를 확인해 주세요.
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
              {selectedItems.map((item, index) => {
                const scoreEntered = item.scoreEntered !== false;
                const itemPercent = getPerformanceScorePercent(
                  item.score,
                  item.maxScore,
                );
                const itemLabel = getItemLabel(item, index);
                return (
                  <div
                    key={`${item.name}-${item.maxScore}-${index}`}
                    className="grid gap-3 border-b border-slate-100 px-4 py-4 last:border-b-0 sm:grid-cols-[160px_minmax(0,1fr)_120px]"
                  >
                    <div className="min-w-0">
                      <div
                        className="truncate text-sm font-black text-slate-900"
                        title={item.name}
                      >
                        {itemLabel}
                      </div>
                      <div className="mt-1 text-xs font-bold text-slate-400">
                        {formatPerformanceScore(item.maxScore)}점 만점
                      </div>
                    </div>
                    <div className="flex items-center">
                      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${
                            scoreEntered ? "bg-blue-500" : "bg-slate-300"
                          }`}
                          style={{
                            width: scoreEntered ? `${itemPercent}%` : "0%",
                          }}
                        />
                      </div>
                    </div>
                    <div className="text-right text-sm font-black text-slate-800">
                      {scoreEntered ? (
                        <>
                          {formatPerformanceScore(item.score)}점
                          <span className="ml-1 text-xs text-slate-400">
                            ({formatPerformanceScore(itemPercent)}%)
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">미입력</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
              <h3 className="text-base font-black text-amber-900">
                감점 요인 및 평가 근거
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm font-bold leading-7 text-slate-700">
                {evidenceText ||
                  "아직 입력된 평가 근거가 없습니다. 필요한 경우 수업 시간이나 상담 시간에 교사에게 확인하세요."}
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default PerformanceScoreView;
