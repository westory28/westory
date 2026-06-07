import React, { useEffect, useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  Tooltip,
} from "chart.js";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { PageLoading } from "../../../components/common/LoadingState";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import { getYearSemester } from "../../../lib/semesterScope";
import {
  PERFORMANCE_SCORE_CONFIRMATIONS_COLLECTION,
  PERFORMANCE_SCORE_USER_COLLECTION,
  formatPerformanceScore,
  getPerformanceScorePercent,
  loadUserPerformanceScoreRecords,
  normalizeStudentName,
  type PerformanceScoreRecord,
} from "../../../lib/performanceScores";
import { getPerformanceScoreItemShortName } from "../../../lib/performanceScoreWorkbook";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

const formatDateTime = (value: unknown) => {
  if (value instanceof Date) {
    return value.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
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

const createSignatureImageDataUrl = (signatureName: string) => {
  const canvas = document.createElement("canvas");
  canvas.width = 360;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (!context) return "";

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#0f172a";
  context.font = "700 42px 'Noto Sans KR', 'Malgun Gothic', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(signatureName, canvas.width / 2, 48);

  context.fillStyle = "#64748b";
  context.font = "700 12px 'Noto Sans KR', 'Malgun Gothic', sans-serif";
  context.fillText("점수 확인", canvas.width / 2, 78);

  return canvas.toDataURL("image/png");
};

const PerformanceScoreView: React.FC = () => {
  const { currentUser, userData, config } = useAuth();
  const { year, semester } = getYearSemester(config);
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<PerformanceScoreRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [signatureName, setSignatureName] = useState("");
  const [signatureError, setSignatureError] = useState("");
  const [confirming, setConfirming] = useState(false);

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
      const loaded = await loadUserPerformanceScoreRecords(currentUser.uid, {
        year,
        semester,
      });
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

  useEffect(() => {
    if (!selectedRecord) return;
    setSignatureName(
      selectedRecord.signatureName ||
        selectedRecord.studentName ||
        userData?.name ||
        "",
    );
    setSignatureError("");
  }, [
    selectedRecord?.id,
    selectedRecord?.signatureName,
    selectedRecord?.studentName,
    userData?.name,
  ]);

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

  const expectedSignatureName =
    selectedRecord?.studentName || userData?.name || "";
  const selectedScoreId = selectedRecord?.id || selectedRecord?.rosterId || "";
  const confirmedAt = selectedRecord?.signedAt;
  const hasConfirmation = Boolean(selectedRecord?.signatureName);

  const submitSignatureConfirmation = async () => {
    if (!currentUser?.uid || !selectedRecord || !selectedScoreId) return;
    const trimmedName = signatureName.trim();
    if (!trimmedName) {
      setSignatureError("서명할 이름을 입력해 주세요.");
      return;
    }
    if (trimmedName.length > 20) {
      setSignatureError("서명 이름은 20자 이내로 입력해 주세요.");
      return;
    }
    if (
      expectedSignatureName &&
      normalizeStudentName(trimmedName) !==
        normalizeStudentName(expectedSignatureName)
    ) {
      setSignatureError(
        `점수표의 이름(${expectedSignatureName})과 같게 입력해 주세요.`,
      );
      return;
    }

    const signatureImage = createSignatureImageDataUrl(trimmedName);
    if (!signatureImage) {
      setSignatureError("서명 이미지를 만들지 못했습니다. 다시 시도해 주세요.");
      return;
    }

    setConfirming(true);
    setSignatureError("");
    try {
      const confirmationRef = doc(
        db,
        "users",
        currentUser.uid,
        PERFORMANCE_SCORE_USER_COLLECTION,
        selectedScoreId,
        PERFORMANCE_SCORE_CONFIRMATIONS_COLLECTION,
        currentUser.uid,
      );
      await setDoc(confirmationRef, {
        uid: currentUser.uid,
        rosterId: selectedRecord.rosterId,
        signatureName: trimmedName,
        signatureImage,
        confirmedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const localConfirmedAt = new Date();
      setRecords((current) =>
        current.map((record) =>
          (record.id || record.rosterId) === selectedScoreId
            ? {
                ...record,
                signatureName: trimmedName,
                signatureImage,
                signedAt: localConfirmedAt,
                confirmation: {
                  id: currentUser.uid,
                  uid: currentUser.uid,
                  rosterId: selectedRecord.rosterId,
                  signatureName: trimmedName,
                  signatureImage,
                  confirmedAt: localConfirmedAt,
                  updatedAt: localConfirmedAt,
                },
              }
            : record,
        ),
      );
      setSignatureModalOpen(false);
    } catch (error) {
      console.error("Failed to confirm performance score:", error);
      setSignatureError(
        "점수 확인 서명을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setConfirming(false);
    }
  };

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
                        획득 {formatPerformanceScore(record.totalScore)} /{" "}
                        {formatPerformanceScore(record.totalMaxScore)}
                      </span>
                      {record.signatureName && (
                        <span className="text-xs font-black text-blue-700">
                          확인 완료
                        </span>
                      )}
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
              <div className="text-left lg:text-right">
                <div className="text-sm font-black text-slate-500">
                  획득 점수 / 만점
                </div>
                <div className="mt-1 text-4xl font-black text-blue-600">
                  {formatPerformanceScore(selectedRecord.totalScore)}
                  <span className="text-xl text-slate-300">
                    {" "}
                    / {formatPerformanceScore(selectedRecord.totalMaxScore)}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 lg:justify-end">
                  {hasConfirmation ? (
                    <span className="inline-flex items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-800">
                      확인 완료
                      {confirmedAt ? ` · ${formatDateTime(confirmedAt)}` : ""}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setSignatureModalOpen(true)}
                      className="inline-flex h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-blue-700"
                    >
                      점수 확인 및 서명
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)]">
              <div className="flex flex-col justify-center rounded-xl border border-blue-100 bg-blue-50 p-5">
                <div className="text-sm font-black text-blue-800">
                  내 획득 점수
                </div>
                <div className="mt-3 text-5xl font-black text-blue-700">
                  {formatPerformanceScore(selectedRecord.totalScore)}
                  <span className="ml-1 text-2xl text-blue-300">
                    / {formatPerformanceScore(selectedRecord.totalMaxScore)}
                  </span>
                </div>
                <div className="mt-5 h-3 overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-blue-600"
                    style={{ width: `${percent}%` }}
                    aria-label={`획득 점수 ${formatPerformanceScore(
                      selectedRecord.totalScore,
                    )}점, 만점 ${formatPerformanceScore(
                      selectedRecord.totalMaxScore,
                    )}점`}
                  />
                </div>
                <p className="mt-3 text-sm font-bold leading-6 text-blue-900/70">
                  만점 기준 중 실제로 획득한 점수를 중심으로 표시합니다.
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

            <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-4">
              <h3 className="text-base font-black text-blue-900">
                감점 요인 및 평가 근거
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm font-bold leading-7 text-slate-700">
                {evidenceText ||
                  "아직 입력된 평가 근거가 없습니다. 필요한 경우 수업 시간이나 상담 시간에 교사에게 확인하세요."}
              </p>
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
                            / {formatPerformanceScore(item.maxScore)}점
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
          </section>
        </div>
      )}

      {signatureModalOpen && selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 py-6">
          <section className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  점수 확인 서명
                </h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                  점수와 평가 근거를 확인했고 이의가 없으면 본인 이름을 입력해
                  주세요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSignatureModalOpen(false)}
                disabled={confirming}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
                aria-label="서명 창 닫기"
              >
                <i className="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>

            <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-3">
              <div className="text-sm font-black text-blue-900">
                {selectedRecord.title}
              </div>
              <div className="mt-1 text-sm font-bold text-blue-700">
                {formatPerformanceScore(selectedRecord.totalScore)} /{" "}
                {formatPerformanceScore(selectedRecord.totalMaxScore)}점
              </div>
            </div>

            <label className="mt-4 block">
              <span className="text-xs font-black text-slate-600">
                서명 이름
              </span>
              <input
                type="text"
                value={signatureName}
                onChange={(event) => {
                  setSignatureName(event.target.value);
                  setSignatureError("");
                }}
                disabled={confirming}
                className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-50 disabled:bg-slate-100"
                placeholder={expectedSignatureName || "본인 이름"}
              />
            </label>

            {signatureError && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold leading-6 text-rose-700">
                {signatureError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSignatureModalOpen(false)}
                disabled={confirming}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void submitSignatureConfirmation()}
                disabled={confirming}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:bg-slate-300"
              >
                {confirming ? "저장 중..." : "이의 없음 서명"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default PerformanceScoreView;
