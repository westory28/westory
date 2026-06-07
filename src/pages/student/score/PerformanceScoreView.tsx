import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bar } from "react-chartjs-2";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  Tooltip,
} from "chart.js";
import { doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
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
  normalizeSchoolValue,
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

const SIGNATURE_CANVAS_MIN_WIDTH = 420;
const SIGNATURE_CANVAS_MAX_WIDTH = 660;
const SIGNATURE_CANVAS_HEIGHT = 220;
const SIGNATURE_STROKE_WIDTH = 14;
const SIGNATURE_DOT_RADIUS = 5;
const SIGNATURE_IMAGE_MAX_LENGTH = 110000;

const getDataUrlStoredLength = (dataUrl: string) => dataUrl.length;

const getRecordScoreId = (record: PerformanceScoreRecord) =>
  record.id || record.rosterId || "";

const isRecordConfirmed = (record: PerformanceScoreRecord) =>
  Boolean(record.signatureImage || record.confirmation?.signatureImage);

const hasStoredSignatureImage = (data: unknown) =>
  typeof data === "object" &&
  data !== null &&
  "signatureImage" in data &&
  typeof (data as { signatureImage?: unknown }).signatureImage === "string" &&
  Boolean((data as { signatureImage: string }).signatureImage);

const getSignatureSaveErrorMessage = (error: unknown) => {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";
  if (code === "permission-denied") {
    return "서명 저장 권한이 거부되었습니다. 이미 제출된 서명이 있거나 담당 교사의 반려 처리가 필요한 상태일 수 있습니다.";
  }
  if (code === "unavailable" || code === "deadline-exceeded") {
    return "서명 저장 서버 연결이 불안정합니다. 잠시 후 다시 시도해 주세요.";
  }
  return "점수 확인 서명을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
};

const PerformanceScoreView: React.FC = () => {
  const { currentUser, userData, config } = useAuth();
  const { year, semester } = getYearSemester(config);
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<PerformanceScoreRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [signatureConsent, setSignatureConsent] = useState(false);
  const [signatureDrawn, setSignatureDrawn] = useState(false);
  const [signatureReviewStep, setSignatureReviewStep] = useState<
    "sign" | "review"
  >("sign");
  const [signatureImageDraft, setSignatureImageDraft] = useState("");
  const [signatureError, setSignatureError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const signatureDrawnRef = useRef(false);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

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
    userData?.name || selectedRecord?.studentName || "";
  const signatureGuideName =
    selectedRecord?.studentName || expectedSignatureName;
  const signatureGuideText = signatureGuideName.trim() || "홍길동";
  const signatureGuideLength = Math.max(
    2,
    Array.from(signatureGuideText).length,
  );
  const signatureCanvasWidth = Math.min(
    SIGNATURE_CANVAS_MAX_WIDTH,
    Math.max(SIGNATURE_CANVAS_MIN_WIDTH, signatureGuideLength * 130 + 120),
  );
  const signatureGuideFontSize = Math.min(
    140,
    Math.max(110, (signatureCanvasWidth / signatureGuideLength) * 0.78),
  );
  const signatureGuideLetterSpacing =
    signatureGuideLength <= 3
      ? "0.18em"
      : signatureGuideLength <= 4
        ? "0.12em"
        : "0.06em";
  const confirmedAt = selectedRecord?.signedAt;
  const hasConfirmation = selectedRecord
    ? isRecordConfirmed(selectedRecord)
    : false;
  const confirmedRecordCount = records.filter(isRecordConfirmed).length;
  const allScoresConfirmed =
    records.length > 0 && confirmedRecordCount === records.length;

  const getStudentIdentityError = () => {
    if (!currentUser?.uid) return "로그인한 학생 정보를 확인하지 못했습니다.";
    if (!records.length) return "확인할 수행평가 점수가 없습니다.";
    if (!expectedSignatureName.trim()) {
      return "학생 이름을 확인하지 못했습니다. 마이페이지의 이름 정보를 확인해 주세요.";
    }

    const expectedNameKey = normalizeStudentName(expectedSignatureName);
    const expectedGrade = normalizeSchoolValue(userData?.grade);
    const expectedClass = normalizeSchoolValue(userData?.class);
    const expectedNumber = normalizeSchoolValue(userData?.number);

    for (const record of records) {
      const scoreId = getRecordScoreId(record);
      if (!scoreId) {
        return `${record.title} 점수 문서의 식별자를 확인하지 못했습니다.`;
      }
      if (!record.uid || record.uid !== currentUser.uid) {
        return `${record.title} 점수 문서의 학생 정보가 현재 로그인 학생과 일치하지 않습니다.`;
      }
      if (!record.rosterId || record.rosterId !== scoreId) {
        return `${record.title} 점수 문서의 평가 식별자가 일치하지 않습니다.`;
      }
      if (
        record.studentName &&
        normalizeStudentName(record.studentName) !== expectedNameKey
      ) {
        return `${record.title} 점수표 이름(${record.studentName})이 현재 학생 이름(${expectedSignatureName})과 일치하지 않습니다.`;
      }
      if (
        expectedGrade &&
        record.grade &&
        normalizeSchoolValue(record.grade) !== expectedGrade
      ) {
        return `${record.title} 점수표 학년이 현재 학생 정보와 일치하지 않습니다.`;
      }
      if (
        expectedClass &&
        record.class &&
        normalizeSchoolValue(record.class) !== expectedClass
      ) {
        return `${record.title} 점수표 반이 현재 학생 정보와 일치하지 않습니다.`;
      }
      if (
        expectedNumber &&
        record.number &&
        normalizeSchoolValue(record.number) !== expectedNumber
      ) {
        return `${record.title} 점수표 번호가 현재 학생 정보와 일치하지 않습니다.`;
      }
    }

    return "";
  };

  const getSignatureCanvasPoint = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const drawSignaturePoint = (point: { x: number; y: number }) => {
    const canvas = signatureCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.strokeStyle = "#111827";
    context.fillStyle = "#111827";
    context.lineWidth = SIGNATURE_STROKE_WIDTH;
    context.lineCap = "round";
    context.lineJoin = "round";

    const lastPoint = lastPointRef.current;
    if (!lastPoint) {
      context.beginPath();
      context.arc(point.x, point.y, SIGNATURE_DOT_RADIUS, 0, Math.PI * 2);
      context.fill();
      lastPointRef.current = point;
      return;
    }

    context.beginPath();
    context.moveTo(lastPoint.x, lastPoint.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    lastPointRef.current = point;
  };

  const clearSignatureCanvas = () => {
    const canvas = signatureCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    drawingRef.current = false;
    signatureDrawnRef.current = false;
    lastPointRef.current = null;
    setSignatureImageDraft("");
    setSignatureDrawn(false);
    setSignatureReviewStep("sign");
    setSignatureError("");
  };

  const openSignatureModal = () => {
    if (allScoresConfirmed) {
      setSignatureError(
        "이미 점수 확인과 서명이 완료되었습니다. 재서명은 담당 교사가 반려한 경우에만 가능합니다.",
      );
      return;
    }
    setSignatureConsent(false);
    signatureDrawnRef.current = false;
    setSignatureImageDraft("");
    setSignatureDrawn(false);
    setSignatureReviewStep("sign");
    setSignatureError("");
    setSignatureModalOpen(true);
    window.setTimeout(() => clearSignatureCanvas(), 0);
  };

  const closeSignatureModal = () => {
    if (confirming) return;
    setSignatureModalOpen(false);
  };

  const getSignatureImageDataUrl = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas || (!signatureDrawnRef.current && !signatureDrawn)) return "";
    return canvas.toDataURL("image/png");
  };

  const moveToSignatureReview = () => {
    const identityError = getStudentIdentityError();
    if (identityError) {
      setSignatureError(identityError);
      return;
    }
    if (!signatureConsent) {
      setSignatureError("점수 확인과 이의 없음 안내에 동의해 주세요.");
      return;
    }
    const signatureImage = getSignatureImageDataUrl();
    if (!signatureImage) {
      setSignatureError("서명 칸에 본인 이름을 직접 써 주세요.");
      return;
    }
    if (getDataUrlStoredLength(signatureImage) > SIGNATURE_IMAGE_MAX_LENGTH) {
      setSignatureError(
        "서명 이미지 용량이 큽니다. 지우고 이름을 조금 더 간단히 다시 써 주세요.",
      );
      return;
    }
    setSignatureError("");
    setSignatureImageDraft(signatureImage);
    setSignatureReviewStep("review");
  };

  const submitSignatureConfirmation = async () => {
    if (!currentUser?.uid) return;
    if (allScoresConfirmed) {
      setSignatureError(
        "이미 점수 확인과 서명이 완료되었습니다. 담당 교사가 반려한 경우에만 다시 서명할 수 있습니다.",
      );
      return;
    }
    const identityError = getStudentIdentityError();
    if (identityError) {
      setSignatureError(identityError);
      return;
    }
    if (!signatureConsent || signatureReviewStep !== "review") {
      setSignatureError("최종 확인 내용을 다시 확인해 주세요.");
      return;
    }
    const recordsToConfirm = records.filter(
      (record) => !isRecordConfirmed(record),
    );
    if (!recordsToConfirm.length) {
      setSignatureError(
        "이미 점수 확인과 서명이 완료되었습니다. 담당 교사가 반려한 경우에만 다시 서명할 수 있습니다.",
      );
      return;
    }
    const signatureName = expectedSignatureName.trim();
    if (!signatureName || signatureName.length > 20) {
      setSignatureError(
        "학생 이름 정보를 확인하지 못했습니다. 마이페이지의 이름 정보를 확인해 주세요.",
      );
      return;
    }

    const signatureImage = signatureImageDraft || getSignatureImageDataUrl();
    if (!signatureImage) {
      setSignatureError("서명 칸에 본인 이름을 직접 써 주세요.");
      setSignatureReviewStep("sign");
      return;
    }
    if (getDataUrlStoredLength(signatureImage) > SIGNATURE_IMAGE_MAX_LENGTH) {
      setSignatureError(
        "서명 이미지 용량이 큽니다. 지우고 이름을 조금 더 간단히 다시 써 주세요.",
      );
      setSignatureReviewStep("sign");
      return;
    }

    setConfirming(true);
    setSignatureError("");
    try {
      const saveTargets = await Promise.all(
        recordsToConfirm.map(async (record) => {
          const scoreId = getRecordScoreId(record);
          const ref = doc(
            db,
            "users",
            currentUser.uid,
            PERFORMANCE_SCORE_USER_COLLECTION,
            scoreId,
            PERFORMANCE_SCORE_CONFIRMATIONS_COLLECTION,
            currentUser.uid,
          );
          const snap = await getDoc(ref);
          return {
            record,
            scoreId,
            ref,
            alreadyConfirmed:
              snap.exists() && hasStoredSignatureImage(snap.data()),
          };
        }),
      );
      const targetsToWrite = saveTargets.filter(
        (target) => !target.alreadyConfirmed,
      );

      if (targetsToWrite.length > 0) {
        const batch = writeBatch(db);
        targetsToWrite.forEach(({ record, ref }) => {
          batch.set(ref, {
            uid: currentUser.uid,
            rosterId: record.rosterId,
            signatureName,
            signatureImage,
            confirmedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }

      const writtenScoreIds = new Set(
        targetsToWrite.map((target) => target.scoreId),
      );
      const alreadyConfirmedScoreIds = new Set(
        saveTargets
          .filter((target) => target.alreadyConfirmed)
          .map((target) => target.scoreId),
      );
      const localConfirmedAt = new Date();
      setRecords((current) =>
        current.map((record) => {
          const scoreId = getRecordScoreId(record);
          if (
            alreadyConfirmedScoreIds.has(scoreId) ||
            isRecordConfirmed(record)
          ) {
            return record;
          }
          return writtenScoreIds.has(scoreId)
            ? {
                ...record,
                signatureName,
                signatureImage,
                signedAt: localConfirmedAt,
                confirmation: {
                  id: currentUser.uid,
                  uid: currentUser.uid,
                  rosterId: record.rosterId,
                  signatureName,
                  signatureImage,
                  confirmedAt: localConfirmedAt,
                  updatedAt: localConfirmedAt,
                },
              }
            : record;
        }),
      );
      setSignatureModalOpen(false);
      setSignatureImageDraft("");
      window.setTimeout(() => {
        window.alert("서명이 완료되었습니다.");
      }, 0);
    } catch (error) {
      console.error("Failed to confirm performance score:", error);
      setSignatureError(getSignatureSaveErrorMessage(error));
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
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="rounded-full bg-blue-50 px-4 py-2 text-sm font-black text-blue-700">
              {userData?.grade || "-"}학년 {userData?.class || "-"}반{" "}
              {userData?.number || "-"}번
            </div>
            {selectedRecord &&
              (allScoresConfirmed ? (
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="inline-flex h-11 cursor-not-allowed items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-4 text-sm font-black text-blue-800 opacity-80"
                >
                  점수 확인 완료 {confirmedRecordCount}/{records.length}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={openSignatureModal}
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-blue-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700"
                >
                  점수 확인 및 서명
                </button>
              ))}
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
                    <span className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-500">
                      상단에서 전체 점수 확인 필요
                    </span>
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
          <section className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  수행평가 점수 확인 및 서명
                </h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                  모든 차시의 점수를 확인한 뒤, 성을 포함한 이름을 직접 써
                  주세요.
                </p>
              </div>
              <button
                type="button"
                onClick={closeSignatureModal}
                disabled={confirming}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
                aria-label="서명 창 닫기"
              >
                <i className="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              {signatureReviewStep === "sign" ? (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    {records.map((record) => (
                      <div
                        key={getRecordScoreId(record)}
                        className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3"
                      >
                        <div className="truncate text-sm font-black text-blue-950">
                          {record.title}
                        </div>
                        <div className="mt-2 text-lg font-black text-blue-700">
                          {formatPerformanceScore(record.totalScore)}
                          <span className="ml-1 text-sm text-blue-300">
                            / {formatPerformanceScore(record.totalMaxScore)}점
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <p className="text-sm font-bold leading-7 text-slate-700">
                      위 수행평가 점수와 평가 근거를 확인했으며, 점수에 문제가
                      없고 해당 점수에 대해 이의를 제기하지 않을 것에
                      동의합니까?
                    </p>
                    <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3">
                      <input
                        type="checkbox"
                        checked={signatureConsent}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setSignatureConsent(checked);
                          setSignatureError("");
                          if (!checked) clearSignatureCanvas();
                        }}
                        disabled={confirming}
                        className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm font-black text-slate-800">
                        동의합니다
                      </span>
                    </label>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-black text-slate-800">
                          서명 그리기
                        </h4>
                        <p className="mt-1 text-xs font-bold leading-5 text-slate-500">
                          성을 포함한 이름을 직접 적어 주세요. 배경의 흐린
                          이름은 안내용이며 저장되지 않습니다.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={clearSignatureCanvas}
                        disabled={confirming || !signatureConsent}
                        className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        지우기
                      </button>
                    </div>
                    <div
                      className={`relative mx-auto overflow-hidden rounded-xl border border-blue-200 bg-blue-50 ${
                        signatureConsent ? "" : "opacity-60"
                      }`}
                      style={{ width: signatureCanvasWidth, maxWidth: "100%" }}
                    >
                      <div
                        className="pointer-events-none absolute inset-0 flex items-center justify-center px-2 text-center font-black leading-none"
                        style={{
                          color: "rgba(30, 58, 138, 0.09)",
                          fontSize: signatureGuideFontSize,
                          letterSpacing: signatureGuideLetterSpacing,
                        }}
                      >
                        {signatureGuideText}
                      </div>
                      {!signatureConsent && (
                        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-white/55 text-sm font-black text-slate-500">
                          동의합니다를 체크하면 서명 칸이 활성화됩니다.
                        </div>
                      )}
                      <canvas
                        ref={signatureCanvasRef}
                        width={signatureCanvasWidth}
                        height={SIGNATURE_CANVAS_HEIGHT}
                        className="relative z-10 h-52 w-full touch-none cursor-crosshair bg-transparent"
                        onPointerDown={(event) => {
                          if (!signatureConsent || confirming) return;
                          const point = getSignatureCanvasPoint(event);
                          if (!point) return;
                          event.currentTarget.setPointerCapture(
                            event.pointerId,
                          );
                          drawingRef.current = true;
                          signatureDrawnRef.current = true;
                          setSignatureImageDraft("");
                          lastPointRef.current = null;
                          drawSignaturePoint(point);
                          setSignatureDrawn(true);
                          setSignatureError("");
                        }}
                        onPointerMove={(event) => {
                          if (!drawingRef.current || !signatureConsent) return;
                          const point = getSignatureCanvasPoint(event);
                          if (point) drawSignaturePoint(point);
                        }}
                        onPointerUp={() => {
                          drawingRef.current = false;
                          lastPointRef.current = null;
                        }}
                        onPointerCancel={() => {
                          drawingRef.current = false;
                          lastPointRef.current = null;
                        }}
                        onPointerLeave={() => {
                          drawingRef.current = false;
                          lastPointRef.current = null;
                        }}
                        aria-label="점수 확인 서명 그리기 칸"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-4">
                    <h4 className="text-base font-black text-blue-950">
                      최종 확인
                    </h4>
                    <p className="mt-2 text-sm font-bold leading-7 text-slate-700">
                      아래 영역별 점수와 동의, 서명 작성 여부를 한 번 더 확인해
                      주세요. 제출하면 현재 점수 확인 서명이 담당 교사용
                      일람표의 본인 비고란에 반영됩니다.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-slate-200 px-4 py-3">
                      <div className="text-xs font-black text-slate-500">
                        학생 확인
                      </div>
                      <div className="mt-1 text-sm font-black text-slate-900">
                        {expectedSignatureName || "-"} ·{" "}
                        {userData?.grade || "-"}학년 {userData?.class || "-"}반{" "}
                        {userData?.number || "-"}번
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 px-4 py-3">
                      <div className="text-xs font-black text-slate-500">
                        동의 여부
                      </div>
                      <div className="mt-1 text-sm font-black text-blue-700">
                        {signatureConsent ? "동의 완료" : "동의 필요"}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 px-4 py-3">
                      <div className="text-xs font-black text-slate-500">
                        서명 여부
                      </div>
                      <div className="mt-1 text-sm font-black text-blue-700">
                        {signatureDrawn ? "서명 작성 완료" : "서명 필요"}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {records.map((record) => (
                      <div
                        key={`${getRecordScoreId(record)}-review`}
                        className="rounded-xl border border-slate-200"
                      >
                        <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="font-black text-slate-900">
                            {record.title}
                          </div>
                          <div className="text-sm font-black text-blue-700">
                            {formatPerformanceScore(record.totalScore)} /{" "}
                            {formatPerformanceScore(record.totalMaxScore)}점
                          </div>
                        </div>
                        <div className="grid gap-2 px-4 py-3 md:grid-cols-2">
                          {(record.items || []).map((item, index) => (
                            <div
                              key={`${record.rosterId}-${item.name}-${index}`}
                              className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold"
                            >
                              <span className="truncate text-slate-600">
                                {getItemLabel(item, index)}
                              </span>
                              <span className="shrink-0 text-slate-900">
                                {item.scoreEntered === false
                                  ? "-"
                                  : formatPerformanceScore(item.score)}
                                <span className="text-slate-400">
                                  {" "}
                                  / {formatPerformanceScore(item.maxScore)}
                                </span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold leading-7 text-rose-700">
                    정말로 성적을 확정짓겠습니까? 제출 후에는 담당 교사에게 점수
                    확인 및 이의 없음 서명으로 전달됩니다.
                  </div>
                </div>
              )}

              {signatureError && (
                <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold leading-6 text-rose-700">
                  {signatureError}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={closeSignatureModal}
                disabled={confirming}
                className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
              >
                취소
              </button>
              {signatureReviewStep === "review" && (
                <button
                  type="button"
                  onClick={() => {
                    setSignatureImageDraft("");
                    signatureDrawnRef.current = false;
                    setSignatureDrawn(false);
                    setSignatureReviewStep("sign");
                    setSignatureError("");
                  }}
                  disabled={confirming}
                  className="inline-flex h-11 items-center justify-center rounded-lg border border-blue-200 bg-white px-5 text-sm font-black text-blue-700 transition hover:bg-blue-50 disabled:opacity-40"
                >
                  서명 수정
                </button>
              )}
              {signatureReviewStep === "sign" ? (
                <button
                  type="button"
                  onClick={moveToSignatureReview}
                  disabled={confirming}
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-blue-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:bg-slate-300"
                >
                  확인 내용 검토
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void submitSignatureConfirmation()}
                  disabled={confirming}
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-blue-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:bg-slate-300"
                >
                  {confirming ? "제출 중..." : "제출하기"}
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default PerformanceScoreView;
