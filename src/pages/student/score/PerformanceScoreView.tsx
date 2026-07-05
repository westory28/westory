import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bar } from "react-chartjs-2";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  type ChartOptions,
  LinearScale,
  Tooltip,
  type TooltipItem,
} from "chart.js";
import { doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { PageLoading } from "../../../components/common/LoadingState";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import {
  notifyPerformanceScoreAnswerSheetRequested,
  notifyPerformanceScoreObjectionRequested,
} from "../../../lib/notifications";
import { getYearSemester } from "../../../lib/semesterScope";
import {
  PERFORMANCE_SCORE_CONFIRMATIONS_COLLECTION,
  PERFORMANCE_SCORE_KIND,
  PERFORMANCE_SCORE_USER_COLLECTION,
  WRITTEN_EXAM_SCORE_KIND,
  formatPerformanceScore,
  isPerformanceScoreWarningConsentCurrent,
  loadPerformanceScoreSettings,
  loadUserPerformanceScoreAnswerSheetRequests,
  loadPerformanceScoreWarningConsent,
  loadUserPerformanceScoreObjections,
  loadUserPerformanceScoreRecords,
  normalizeSchoolValue,
  normalizeStudentName,
  normalizePerformanceScoreSettings,
  savePerformanceScoreWarningConsent,
  type PerformanceScoreAnswerSheetRequest,
  type PerformanceScoreItem,
  type PerformanceScoreKind,
  type PerformanceScoreObjection,
  type PerformanceScoreRecord,
  type PerformanceScoreSettings,
  type PerformanceScoreWarningConsent,
} from "../../../lib/performanceScores";
import { getPerformanceScoreItemShortName } from "../../../lib/performanceScoreWorkbook";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

const getTimestampMillis = (value: unknown) => {
  if (value instanceof Date) return value.getTime();
  const seconds =
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds?: unknown }).seconds === "number"
      ? (value as { seconds: number }).seconds
      : null;
  return seconds ? seconds * 1000 : 0;
};

const formatDateTime = (value: unknown) => {
  const millis = getTimestampMillis(value);
  if (!millis) return "";
  return new Date(millis).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const formatDateTimeWithTime = (value: unknown) => {
  const millis = getTimestampMillis(value);
  if (!millis) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(millis));
};

const getRecordDate = (record: PerformanceScoreRecord) =>
  formatDateTime(record.updatedAt) || formatDateTime(record.uploadedAt);

const getItemLabel = (
  item: { name: string; shortName?: string },
  index: number,
) => item.shortName || getPerformanceScoreItemShortName(item.name, index);

const getFiniteScoreValue = (value: unknown) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Number(numericValue.toFixed(2)) : 0;
};

const getEnteredItemScore = (item?: PerformanceScoreItem) => {
  if (!item || item.scoreEntered === false) return null;
  const numericValue = Number(item.score);
  return Number.isFinite(numericValue) ? Number(numericValue.toFixed(2)) : null;
};

const getItemsTotalScore = (items: PerformanceScoreItem[]) => {
  const scores = items
    .map((item) => getEnteredItemScore(item))
    .filter((score): score is number => score !== null);
  return scores.length
    ? Number(scores.reduce((sum, score) => sum + score, 0).toFixed(2))
    : 0;
};

const getItemsMaxScore = (items: PerformanceScoreItem[]) =>
  Number(
    items
      .reduce((sum, item) => sum + getFiniteScoreValue(item.maxScore), 0)
      .toFixed(2),
  );

const getWrittenExamItemMeta = (item: PerformanceScoreItem, index: number) => {
  const rawKey = String(item.itemKey || item.shortName || item.name || "");
  const match = /^(\d+)\s*-\s*[\(\[]?\s*(\d+)\s*[\)\]]?$/.exec(rawKey.trim());
  if (!match) {
    return {
      key: rawKey || `item-${index}`,
      groupKey: String(item.groupKey || "essay"),
      groupLabel: item.groupLabel || "논술형",
      label: getItemLabel(item, index),
      detailed: false,
    };
  }
  return {
    key: `${match[1]}-(${match[2]})`,
    groupKey: match[1],
    groupLabel: item.groupLabel || `${match[1]}번`,
    label: `(${match[2]})`,
    fullLabel: `${match[1]}-(${match[2]})`,
    detailed: true,
  };
};

const getWrittenExamItemGroups = (items: PerformanceScoreItem[]) => {
  const groups = new Map<
    string,
    {
      key: string;
      label: string;
      items: Array<{
        key: string;
        label: string;
        fullLabel?: string;
        item: PerformanceScoreItem;
        index: number;
      }>;
    }
  >();
  items.forEach((item, index) => {
    const meta = getWrittenExamItemMeta(item, index);
    const group = groups.get(meta.groupKey) || {
      key: meta.groupKey,
      label: meta.groupLabel,
      items: [],
    };
    group.items.push({
      key: meta.key,
      label: meta.label,
      fullLabel: meta.fullLabel,
      item,
      index,
    });
    groups.set(meta.groupKey, group);
  });
  return Array.from(groups.values()).sort(
    (left, right) =>
      Number(left.key) - Number(right.key) ||
      left.label.localeCompare(right.label, "ko"),
  );
};

const getWrittenExamGroupScore = (
  group: ReturnType<typeof getWrittenExamItemGroups>[number],
) => getItemsTotalScore(group.items.map(({ item }) => item));

const getWrittenExamGroupMaxScore = (
  group: ReturnType<typeof getWrittenExamItemGroups>[number],
) => getItemsMaxScore(group.items.map(({ item }) => item));

const getRequestItemSelectionKey = (scoreId: string, itemKey: string) =>
  `${scoreId}::${itemKey}`;

const parseRequestItemSelectionKey = (value: string) => {
  const [scoreId = "", itemKey = ""] = value.split("::");
  return { scoreId, itemKey };
};

const getWrittenExamGeneralFeedback = (
  value: string,
  hasDetailedItems: boolean,
) => {
  const text = value.trim();
  if (!text || !hasDetailedItems) return text;
  const match = /(\d+)\s*-\s*[\(\[]?\s*(\d+)\s*[\)\]]?\s*[:：]/.exec(text);
  return match ? text.slice(0, match.index).trim() : text;
};

const SIGNATURE_CANVAS_MIN_WIDTH = 420;
const SIGNATURE_CANVAS_MAX_WIDTH = 660;
const SIGNATURE_CANVAS_HEIGHT = 220;
const SIGNATURE_MOBILE_GUIDE_TARGET_WIDTH = 300;
const SIGNATURE_MOBILE_GUIDE_FONT_MIN = 36;
const SIGNATURE_MOBILE_GUIDE_FONT_MAX = 92;
const SIGNATURE_STROKE_WIDTH = 14;
const SIGNATURE_DOT_RADIUS = 5;
const SIGNATURE_ALPHA_THRESHOLD = 8;
const SIGNATURE_IMAGE_MAX_LENGTH = 110000;
const ZERO_SCORE_BAR_RATIO = 0.012;
const ZERO_SCORE_BAR_MIN_VALUE = 0.08;
const ZERO_SCORE_BAR_MAX_VALUE = 0.18;

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

const getPerformanceScoreObjectionErrorMessage = (error: unknown) => {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";
  if (code === "permission-denied") {
    return "이의 제기 요청 권한이 거부되었습니다. 로그인 학생 정보를 다시 확인해 주세요.";
  }
  if (code === "failed-precondition") {
    return "이미 확인 서명이 완료된 점수는 이의 제기 요청을 보낼 수 없습니다.";
  }
  if (code === "unavailable" || code === "deadline-exceeded") {
    return "이의 제기 알림 서버 연결이 불안정합니다. 잠시 후 다시 시도해 주세요.";
  }
  return "이의 제기 알림을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.";
};

const getObjectionStatusMeta = (
  status: PerformanceScoreObjection["status"],
) => {
  if (status === "accepted") {
    return {
      label: "수용",
      badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
      panelClass: "border-emerald-100 bg-emerald-50 text-emerald-900",
      responseLabel: "교사가 보낸 수용 사유",
      emptyResponse:
        "교사가 별도 수용 사유를 남기지 않았습니다. 변경 점수 안내를 확인해 주세요.",
    };
  }
  if (status === "rejected") {
    return {
      label: "반려",
      badgeClass: "border-rose-200 bg-rose-50 text-rose-700",
      panelClass: "border-rose-100 bg-rose-50 text-rose-900",
      responseLabel: "교사가 보낸 반려 사유",
      emptyResponse:
        "교사가 별도 반려 사유를 남기지 않았습니다. 필요하면 담당 교사에게 직접 확인해 주세요.",
    };
  }
  return {
    label: "처리 대기",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
    panelClass: "border-amber-100 bg-amber-50 text-amber-900",
    responseLabel: "처리 상태",
    emptyResponse: "담당 교사가 아직 이의 신청을 확인하는 중입니다.",
  };
};

interface ScoreConfirmationViewCopy {
  pageTitle: string;
  scoreLabel: string;
  scoreListLabel: string;
  scoreSubjectFallback: string;
  scoreItemsLabel: string;
  evidenceTitle: string;
  evidenceEmptyText: string;
  emptyTitle: string;
  emptyDescription: string;
  loadingMessage: string;
  warningTitle: string;
  warningSubtitle: string;
  pageDescription: string;
  objectionTitle: string;
  objectionDescription: string;
  objectionTargetLabel: string;
  objectionReasonLabel: string;
  objectionPlaceholder: string;
  objectionResultTitle: string;
  signatureTitle: string;
  signatureAgreementText: string;
  signatureReviewDescription: string;
}

interface ScoreConfirmationViewProps {
  scoreKind?: PerformanceScoreKind;
  copy?: Partial<ScoreConfirmationViewCopy>;
}

const PERFORMANCE_SCORE_COPY: ScoreConfirmationViewCopy = {
  pageTitle: "내 수행평가 점수",
  scoreLabel: "수행평가",
  scoreListLabel: "수행평가 점수 목록",
  scoreSubjectFallback: "수행평가",
  scoreItemsLabel: "평가요소별 세부 점수",
  evidenceTitle: "감점 요인 및 평가 근거",
  evidenceEmptyText:
    "아직 입력된 평가 근거가 없습니다. 필요한 경우 수업 시간이나 상담 시간에 교사에게 확인하세요.",
  emptyTitle: "아직 등록된 수행평가 점수가 없습니다.",
  emptyDescription:
    "교사가 점수 명단을 저장하면 이곳에서 내 점수와 피드백을 확인할 수 있습니다.",
  loadingMessage: "내 수행평가 점수를 불러오는 중입니다.",
  warningTitle: "수행평가 점수 확인 전 안내",
  warningSubtitle: "내 수행평가 점수",
  pageDescription: "평가요소별 점수, 감점 요인과 평가 근거만 표시됩니다.",
  objectionTitle: "수행평가 이의 신청",
  objectionDescription:
    "이의가 있는 수행평가를 선택하고 사유를 입력해 주세요. 이의 신청을 보내면 서명은 저장되지 않고 담당 교사에게 알림이 전송됩니다.",
  objectionTargetLabel: "이의 신청 대상",
  objectionReasonLabel: "이의 신청 사유",
  objectionPlaceholder:
    "예: 두 번째 평가요소 점수가 제가 받은 피드백과 다른 것 같아 확인을 요청합니다.",
  objectionResultTitle: "수행평가 이의 결과",
  signatureTitle: "수행평가 점수 확인 및 서명",
  signatureAgreementText:
    "위 수행평가 점수와 평가 근거를 확인했으며, 점수에 문제가 없고 해당 점수에 대해 이의를 제기하지 않을 것에 동의합니까?",
  signatureReviewDescription:
    "아래 영역별 점수와 동의, 서명 작성 여부를 한 번 더 확인해 주세요. 제출하면 현재 점수 확인 서명이 담당 교사에게 전달됩니다.",
};

const WRITTEN_EXAM_SCORE_COPY: ScoreConfirmationViewCopy = {
  pageTitle: "내 정기시험 논술형 점수",
  scoreLabel: "정기시험 논술형",
  scoreListLabel: "정기시험 논술형 점수 목록",
  scoreSubjectFallback: "정기시험",
  scoreItemsLabel: "논술형 세부 점수",
  evidenceTitle: "피드백 사항",
  evidenceEmptyText:
    "아직 입력된 피드백이 없습니다. 필요한 경우 수업 시간이나 상담 시간에 교사에게 확인하세요.",
  emptyTitle: "아직 등록된 정기시험 논술형 점수가 없습니다.",
  emptyDescription:
    "교사가 점수 명단을 저장하면 이곳에서 내 논술형 점수와 피드백을 확인할 수 있습니다.",
  loadingMessage: "내 정기시험 논술형 점수를 불러오는 중입니다.",
  warningTitle: "정기시험 논술형 점수 확인 전 안내",
  warningSubtitle: "내 정기시험 논술형 점수",
  pageDescription: "논술형 점수와 피드백 사항만 표시됩니다.",
  objectionTitle: "정기시험 논술형 이의 신청",
  objectionDescription:
    "이의가 있는 정기시험 논술형 점수를 선택하고 사유를 입력해 주세요. 이의 신청을 보내면 서명은 저장되지 않고 담당 교사에게 알림이 전송됩니다.",
  objectionTargetLabel: "이의 신청 대상",
  objectionReasonLabel: "이의 신청 사유",
  objectionPlaceholder:
    "예: 논술형 점수가 제가 확인한 채점 결과와 다른 것 같아 확인을 요청합니다.",
  objectionResultTitle: "정기시험 논술형 이의 결과",
  signatureTitle: "정기시험 논술형 점수 확인 및 서명",
  signatureAgreementText:
    "위 정기시험 논술형 점수와 피드백을 확인했으며, 점수에 문제가 없고 해당 점수에 대해 이의를 제기하지 않을 것에 동의합니까?",
  signatureReviewDescription:
    "아래 점수와 동의, 서명 작성 여부를 한 번 더 확인해 주세요. 제출하면 현재 점수 확인 서명이 담당 교사에게 전달됩니다.",
};

export const ScoreConfirmationView: React.FC<ScoreConfirmationViewProps> = ({
  scoreKind = PERFORMANCE_SCORE_KIND,
  copy,
}) => {
  const { currentUser, userData, config } = useAuth();
  const { showToast } = useAppToast();
  const { year, semester } = getYearSemester(config);
  const resolvedCopy = {
    ...(scoreKind === WRITTEN_EXAM_SCORE_KIND
      ? WRITTEN_EXAM_SCORE_COPY
      : PERFORMANCE_SCORE_COPY),
    ...copy,
  };
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<PerformanceScoreRecord[]>([]);
  const [scoreSettings, setScoreSettings] = useState<PerformanceScoreSettings>(
    () => normalizePerformanceScoreSettings(),
  );
  const [warningConsent, setWarningConsent] =
    useState<PerformanceScoreWarningConsent | null>(null);
  const [warningConsentChecked, setWarningConsentChecked] = useState(false);
  const [warningConsentSaving, setWarningConsentSaving] = useState(false);
  const [objections, setObjections] = useState<PerformanceScoreObjection[]>([]);
  const [answerSheetRequests, setAnswerSheetRequests] = useState<
    PerformanceScoreAnswerSheetRequest[]
  >([]);
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
  const [objectionModalOpen, setObjectionModalOpen] = useState(false);
  const [objectionResultModalOpen, setObjectionResultModalOpen] =
    useState(false);
  const [objecting, setObjecting] = useState(false);
  const [objectionError, setObjectionError] = useState("");
  const [objectionSelectedIds, setObjectionSelectedIds] = useState<string[]>(
    [],
  );
  const [objectionSelectedItemKeys, setObjectionSelectedItemKeys] = useState<
    string[]
  >([]);
  const [objectionReason, setObjectionReason] = useState("");
  const [answerSheetRequestModalOpen, setAnswerSheetRequestModalOpen] =
    useState(false);
  const [answerSheetRequesting, setAnswerSheetRequesting] = useState(false);
  const [answerSheetRequestError, setAnswerSheetRequestError] = useState("");
  const [answerSheetRequestSelectedIds, setAnswerSheetRequestSelectedIds] =
    useState<string[]>([]);
  const [
    answerSheetRequestSelectedItemKeys,
    setAnswerSheetRequestSelectedItemKeys,
  ] = useState<string[]>([]);
  const [answerSheetRequestReason, setAnswerSheetRequestReason] = useState("");
  const [selectedWrittenExamGroupKey, setSelectedWrittenExamGroupKey] =
    useState("");
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scoreChartRef = useRef<ChartJS<"bar"> | null>(null);
  const scoreChartContainerRef = useRef<HTMLDivElement | null>(null);
  const signatureDrawnRef = useRef(false);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!currentUser?.uid) {
      setLoading(false);
      return;
    }
    void loadScores();
  }, [currentUser?.uid, scoreKind, year, semester]);

  const loadScores = async () => {
    if (!currentUser?.uid) return;
    setLoading(true);
    try {
      const [
        loaded,
        settings,
        consent,
        loadedObjections,
        loadedAnswerSheetRequests,
      ] = await Promise.all([
        loadUserPerformanceScoreRecords(currentUser.uid, {
          year,
          semester,
          scoreKind,
        }),
        loadPerformanceScoreSettings(config),
        loadPerformanceScoreWarningConsent(currentUser.uid),
        loadUserPerformanceScoreObjections(config, currentUser.uid, {
          scoreKind,
        }),
        loadUserPerformanceScoreAnswerSheetRequests(config, currentUser.uid, {
          scoreKind,
        }),
      ]);
      setRecords(loaded);
      setScoreSettings(settings);
      setWarningConsent(consent);
      setObjections(loadedObjections);
      setAnswerSheetRequests(loadedAnswerSheetRequests);
      setWarningConsentChecked(false);
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

  const selectedItems = Array.isArray(selectedRecord?.items)
    ? selectedRecord.items
    : [];
  const evidenceText =
    selectedRecord?.evidence || selectedRecord?.feedback || "";
  const writtenExamItemGroups =
    scoreKind === WRITTEN_EXAM_SCORE_KIND
      ? getWrittenExamItemGroups(selectedItems)
      : [];
  const activeWrittenExamGroup =
    writtenExamItemGroups.find(
      (group) => group.key === selectedWrittenExamGroupKey,
    ) ||
    writtenExamItemGroups[0] ||
    null;
  const hasDetailedWrittenExamItems =
    scoreKind === WRITTEN_EXAM_SCORE_KIND &&
    selectedItems.some(
      (item, index) => getWrittenExamItemMeta(item, index).detailed,
    );
  const hasWrittenExamSidebarGroups =
    scoreKind === WRITTEN_EXAM_SCORE_KIND &&
    records.some((record) =>
      (record.items || []).some(
        (item, index) => getWrittenExamItemMeta(item, index).detailed,
      ),
    );
  const visibleChartEntries =
    hasDetailedWrittenExamItems && activeWrittenExamGroup
      ? activeWrittenExamGroup.items.map(({ label, item }) => ({ label, item }))
      : selectedItems.map((item, index) => ({
          label: getItemLabel(item, index),
          item,
        }));
  const visibleChartItems = visibleChartEntries
    .map(({ item, label }) => ({ item, label }))
    .filter(({ item }) => item.scoreEntered !== false);
  const visibleTotalScore =
    hasDetailedWrittenExamItems && activeWrittenExamGroup
      ? getWrittenExamGroupScore(activeWrittenExamGroup)
      : (selectedRecord?.totalScore ?? 0);
  const visibleTotalMaxScore =
    hasDetailedWrittenExamItems && activeWrittenExamGroup
      ? getWrittenExamGroupMaxScore(activeWrittenExamGroup)
      : (selectedRecord?.totalMaxScore ?? 0);
  const writtenExamGeneralFeedback = getWrittenExamGeneralFeedback(
    evidenceText,
    hasDetailedWrittenExamItems,
  );
  const evidenceBlockText = hasDetailedWrittenExamItems
    ? writtenExamGeneralFeedback
    : evidenceText;
  const chartMaxScore = selectedRecord
    ? Math.max(
        hasDetailedWrittenExamItems ? visibleTotalMaxScore : 10,
        ...visibleChartItems.map(({ item }) => item.maxScore || 0),
      )
    : 50;
  const zeroScoreBarValue = Math.min(
    ZERO_SCORE_BAR_MAX_VALUE,
    Math.max(ZERO_SCORE_BAR_MIN_VALUE, chartMaxScore * ZERO_SCORE_BAR_RATIO),
  );
  const getChartDisplayScore = (item: PerformanceScoreItem) => {
    const score = getFiniteScoreValue(item.score);
    return score === 0 ? zeroScoreBarValue : score;
  };

  const chartData = selectedRecord
    ? {
        labels: visibleChartItems.map(({ label }) => label),
        datasets: [
          {
            label: "획득 점수",
            data: visibleChartItems.map(({ item }) =>
              getChartDisplayScore(item),
            ),
            backgroundColor: "#2563eb",
            borderRadius: 6,
            barPercentage: 0.55,
          },
          {
            label: "만점 기준",
            data: visibleChartItems.map(({ item }) => item.maxScore),
            backgroundColor: "#cbd5e1",
            borderRadius: 6,
            barPercentage: 0.55,
          },
        ],
      }
    : { labels: [], datasets: [] };

  useEffect(() => {
    if (!visibleChartItems.length) return;

    const container = scoreChartContainerRef.current;
    const chart = scoreChartRef.current;
    if (!container || !chart) return;

    let frameId: number | null = null;
    const resizeChart = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        const nextWidth = Math.floor(container.clientWidth);
        const nextHeight = Math.floor(container.clientHeight);
        if (nextWidth <= 0 || nextHeight <= 0) return;

        chart.canvas.style.maxWidth = "100%";
        chart.canvas.style.width = "100%";
        chart.resize(nextWidth, nextHeight);
      });
    };

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(resizeChart);
      resizeObserver.observe(container);
    }

    const visualViewport = window.visualViewport;
    window.addEventListener("resize", resizeChart);
    window.addEventListener("orientationchange", resizeChart);
    visualViewport?.addEventListener("resize", resizeChart);
    visualViewport?.addEventListener("scroll", resizeChart);
    resizeChart();

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resizeChart);
      window.removeEventListener("orientationchange", resizeChart);
      visualViewport?.removeEventListener("resize", resizeChart);
      visualViewport?.removeEventListener("scroll", resizeChart);
    };
  }, [
    visibleChartItems.length,
    selectedRecord?.id,
    selectedWrittenExamGroupKey,
  ]);

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
  const signatureMobileGuideFontSize = Math.min(
    SIGNATURE_MOBILE_GUIDE_FONT_MAX,
    Math.max(
      SIGNATURE_MOBILE_GUIDE_FONT_MIN,
      ((SIGNATURE_MOBILE_GUIDE_TARGET_WIDTH - 28) / signatureGuideLength) * 0.9,
    ),
  );
  const signatureGuideLetterSpacing =
    signatureGuideLength <= 3
      ? "0.18em"
      : signatureGuideLength <= 4
        ? "0.12em"
        : "0.06em";
  const signatureMobileGuideLetterSpacing =
    signatureGuideLength <= 3
      ? "0.08em"
      : signatureGuideLength <= 4
        ? "0.04em"
        : "0.01em";
  const confirmedAt = selectedRecord?.signedAt;
  const hasConfirmation = selectedRecord
    ? isRecordConfirmed(selectedRecord)
    : false;
  const confirmedRecordCount = records.filter(isRecordConfirmed).length;
  const allScoresConfirmed =
    records.length > 0 && confirmedRecordCount === records.length;
  const pendingRecords = records.filter((record) => !isRecordConfirmed(record));
  const signatureActionPending =
    confirming || objecting || answerSheetRequesting;
  const warningConsentCurrent = currentUser?.uid
    ? isPerformanceScoreWarningConsentCurrent(
        warningConsent,
        currentUser.uid,
        config,
        scoreSettings,
      )
    : false;
  const pendingObjections = useMemo(
    () => objections.filter((item) => item.status === "pending"),
    [objections],
  );
  const pendingAnswerSheetRequests = useMemo(
    () => answerSheetRequests.filter((item) => item.status === "pending"),
    [answerSheetRequests],
  );
  const sortedObjections = useMemo(
    () =>
      [...objections].sort(
        (a, b) =>
          Math.max(
            getTimestampMillis(b.reviewedAt),
            getTimestampMillis(b.requestedAt),
          ) -
            Math.max(
              getTimestampMillis(a.reviewedAt),
              getTimestampMillis(a.requestedAt),
            ) ||
          String(b.scoreTitle || "").localeCompare(
            String(a.scoreTitle || ""),
            "ko",
          ),
      ),
    [objections],
  );
  const recordByScoreId = useMemo(() => {
    const map = new Map<string, PerformanceScoreRecord>();
    records.forEach((record) => {
      const scoreId = getRecordScoreId(record);
      if (scoreId) map.set(scoreId, record);
      if (record.rosterId) map.set(record.rosterId, record);
      if (record.id) map.set(record.id, record);
    });
    return map;
  }, [records]);
  const pendingObjectionScoreIds = useMemo(() => {
    const scoreIds = new Set<string>();
    pendingObjections.forEach((item) => {
      if (item.scoreId) scoreIds.add(item.scoreId);
      if (item.rosterId) scoreIds.add(item.rosterId);
    });
    return scoreIds;
  }, [pendingObjections]);
  const pendingAnswerSheetRequestScoreIds = useMemo(() => {
    const scoreIds = new Set<string>();
    pendingAnswerSheetRequests.forEach((item) => {
      if (item.scoreId) scoreIds.add(item.scoreId);
      if (item.rosterId) scoreIds.add(item.rosterId);
    });
    return scoreIds;
  }, [pendingAnswerSheetRequests]);
  const hasPendingObjection = pendingObjectionScoreIds.size > 0;
  const hasPendingAnswerSheetRequest =
    pendingAnswerSheetRequestScoreIds.size > 0;
  const selectedRecordHasPendingObjection = selectedRecord
    ? pendingObjectionScoreIds.has(getRecordScoreId(selectedRecord))
    : false;
  const selectedRecordHasPendingAnswerSheetRequest = selectedRecord
    ? pendingAnswerSheetRequestScoreIds.has(getRecordScoreId(selectedRecord))
    : false;
  const hasObjectionHistory = sortedObjections.length > 0;
  const canRequestObjection =
    warningConsentCurrent && !allScoresConfirmed && pendingRecords.length > 0;
  const signatureBlockedByPendingObjection =
    hasPendingObjection && !allScoresConfirmed;
  const pendingObjectionTitles = records
    .filter((record) => pendingObjectionScoreIds.has(getRecordScoreId(record)))
    .map((record) => record.title)
    .filter(Boolean);
  const signatureButtonDisabled =
    !warningConsentCurrent ||
    signatureBlockedByPendingObjection ||
    signatureActionPending;
  const signatureBlockedMessage = signatureBlockedByPendingObjection
    ? `이의 제기 처리 대기 중인 ${resolvedCopy.scoreLabel} 점수가 있습니다${
        pendingObjectionTitles.length
          ? `: ${pendingObjectionTitles.join(", ")}`
          : ""
      }. 담당 교사가 수용 또는 반려 처리한 뒤 서명할 수 있습니다.`
    : "";

  useEffect(() => {
    if (!hasDetailedWrittenExamItems || !writtenExamItemGroups.length) {
      if (selectedWrittenExamGroupKey) setSelectedWrittenExamGroupKey("");
      return;
    }
    if (
      selectedWrittenExamGroupKey &&
      writtenExamItemGroups.some(
        (group) => group.key === selectedWrittenExamGroupKey,
      )
    ) {
      return;
    }
    setSelectedWrittenExamGroupKey(writtenExamItemGroups[0].key);
  }, [
    hasDetailedWrittenExamItems,
    selectedRecord?.id,
    selectedWrittenExamGroupKey,
    writtenExamItemGroups,
  ]);

  const getStudentIdentityError = (targetRecords = records) => {
    if (!currentUser?.uid) return "로그인한 학생 정보를 확인하지 못했습니다.";
    if (!targetRecords.length)
      return `확인할 ${resolvedCopy.scoreLabel} 점수가 없습니다.`;
    if (!expectedSignatureName.trim()) {
      return "학생 이름을 확인하지 못했습니다. 마이페이지의 이름 정보를 확인해 주세요.";
    }

    const expectedNameKey = normalizeStudentName(expectedSignatureName);
    const expectedGrade = normalizeSchoolValue(userData?.grade);
    const expectedClass = normalizeSchoolValue(userData?.class);
    const expectedNumber = normalizeSchoolValue(userData?.number);

    for (const record of targetRecords) {
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

  const toggleSignatureConsent = () => {
    if (signatureActionPending) return;
    const nextConsent = !signatureConsent;
    setSignatureConsent(nextConsent);
    if (!nextConsent) {
      clearSignatureCanvas();
    } else {
      setSignatureError("");
    }
  };

  const openSignatureModal = () => {
    if (!warningConsentCurrent) {
      showToast({
        title: "안내 동의가 필요합니다.",
        message: "경고 문구를 확인하고 동의를 저장한 뒤 서명할 수 있습니다.",
        tone: "warning",
      });
      return;
    }
    if (signatureBlockedByPendingObjection) {
      showToast({
        title: "서명 대기 중",
        message: signatureBlockedMessage,
        tone: "warning",
        durationMs: 5200,
      });
      return;
    }
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
    if (signatureActionPending) return;
    setSignatureModalOpen(false);
  };

  const getWrittenExamItemSelectionKeysForRecord = (
    record: PerformanceScoreRecord,
    groupKey?: string,
  ) => {
    const scoreId = getRecordScoreId(record);
    if (!scoreId) return [];
    return getWrittenExamItemGroups(record.items || [])
      .filter((group) => !groupKey || group.key === groupKey)
      .flatMap((group) =>
        group.items.map(({ key }) => getRequestItemSelectionKey(scoreId, key)),
      );
  };

  const getDefaultObjectionScoreIds = () => {
    const selectedScoreId = selectedRecord
      ? getRecordScoreId(selectedRecord)
      : "";
    if (
      selectedScoreId &&
      selectedRecord &&
      !isRecordConfirmed(selectedRecord)
    ) {
      return [selectedScoreId];
    }
    const firstPendingId = pendingRecords[0]
      ? getRecordScoreId(pendingRecords[0])
      : "";
    return firstPendingId ? [firstPendingId] : [];
  };

  const getDefaultObjectionItemKeys = () => {
    if (!hasDetailedWrittenExamItems) return [];
    if (
      selectedRecord &&
      !isRecordConfirmed(selectedRecord) &&
      activeWrittenExamGroup
    ) {
      return getWrittenExamItemSelectionKeysForRecord(
        selectedRecord,
        activeWrittenExamGroup.key,
      );
    }
    const firstPendingRecord = pendingRecords.find(
      (record) => getWrittenExamItemGroups(record.items || []).length > 0,
    );
    return firstPendingRecord
      ? getWrittenExamItemSelectionKeysForRecord(
          firstPendingRecord,
          getWrittenExamItemGroups(firstPendingRecord.items || [])[0]?.key,
        )
      : [];
  };

  const openObjectionModal = () => {
    if (!warningConsentCurrent) {
      showToast({
        title: "안내 동의가 필요합니다.",
        message:
          "경고 문구를 확인하고 동의를 저장한 뒤 이의 제기할 수 있습니다.",
        tone: "warning",
      });
      return;
    }
    if (!canRequestObjection) {
      showToast({
        title: "이의 제기 불가",
        message: allScoresConfirmed
          ? "이미 점수 확인과 서명이 완료되었습니다. 제출 후에는 담당 교사의 반려 없이 이의를 제기할 수 없습니다."
          : `이의 제기할 ${resolvedCopy.scoreLabel} 점수가 없습니다.`,
        tone: "warning",
      });
      return;
    }

    setObjectionReason("");
    setObjectionError("");
    setObjectionSelectedIds(getDefaultObjectionScoreIds());
    setObjectionSelectedItemKeys(getDefaultObjectionItemKeys());
    setObjectionModalOpen(true);
  };

  const openObjectionResultModal = () => {
    if (!hasObjectionHistory) {
      showToast({
        title: "이의 결과 없음",
        message: `아직 제출한 ${resolvedCopy.scoreLabel} 이의 제기가 없습니다.`,
        tone: "info",
      });
      return;
    }

    setObjectionResultModalOpen(true);
  };

  const closeObjectionModal = () => {
    if (objecting) return;
    setObjectionModalOpen(false);
  };

  const closeObjectionResultModal = () => {
    setObjectionResultModalOpen(false);
  };

  const getDefaultAnswerSheetRequestScoreIds = () => {
    const selectedScoreId = selectedRecord
      ? getRecordScoreId(selectedRecord)
      : "";
    if (
      selectedScoreId &&
      !pendingAnswerSheetRequestScoreIds.has(selectedScoreId)
    ) {
      return [selectedScoreId];
    }
    const firstAvailableRecord = records.find(
      (record) =>
        !pendingAnswerSheetRequestScoreIds.has(getRecordScoreId(record)),
    );
    const firstRecordId = firstAvailableRecord
      ? getRecordScoreId(firstAvailableRecord)
      : "";
    return firstRecordId ? [firstRecordId] : [];
  };

  const getDefaultAnswerSheetRequestItemKeys = () => {
    if (!hasDetailedWrittenExamItems) return [];
    if (
      selectedRecord &&
      !pendingAnswerSheetRequestScoreIds.has(
        getRecordScoreId(selectedRecord),
      ) &&
      activeWrittenExamGroup
    ) {
      return getWrittenExamItemSelectionKeysForRecord(
        selectedRecord,
        activeWrittenExamGroup.key,
      );
    }
    const firstAvailableRecord = records.find(
      (record) =>
        !pendingAnswerSheetRequestScoreIds.has(getRecordScoreId(record)) &&
        getWrittenExamItemGroups(record.items || []).length > 0,
    );
    return firstAvailableRecord
      ? getWrittenExamItemSelectionKeysForRecord(
          firstAvailableRecord,
          getWrittenExamItemGroups(firstAvailableRecord.items || [])[0]?.key,
        )
      : [];
  };

  const openAnswerSheetRequestModal = () => {
    if (!warningConsentCurrent) {
      showToast({
        title: "안내 동의가 필요합니다.",
        message:
          "경고 문구를 확인하고 동의를 저장한 뒤 답안지 확인을 요청할 수 있습니다.",
        tone: "warning",
      });
      return;
    }
    if (!records.length) {
      showToast({
        title: "요청할 점수가 없습니다.",
        message: `등록된 ${resolvedCopy.scoreLabel} 점수가 있을 때 답안지 확인을 요청할 수 있습니다.`,
        tone: "warning",
      });
      return;
    }
    if (
      records.every((record) =>
        pendingAnswerSheetRequestScoreIds.has(getRecordScoreId(record)),
      )
    ) {
      showToast({
        title: "이미 확인 요청 중입니다.",
        message:
          "담당 교사가 요청을 확인한 뒤 필요하면 다시 요청할 수 있습니다.",
        tone: "info",
      });
      return;
    }

    setAnswerSheetRequestReason("");
    setAnswerSheetRequestError("");
    setAnswerSheetRequestSelectedIds(getDefaultAnswerSheetRequestScoreIds());
    setAnswerSheetRequestSelectedItemKeys(
      getDefaultAnswerSheetRequestItemKeys(),
    );
    setAnswerSheetRequestModalOpen(true);
  };

  const closeAnswerSheetRequestModal = () => {
    if (answerSheetRequesting) return;
    setAnswerSheetRequestModalOpen(false);
  };

  const toggleAnswerSheetRequestScore = (scoreId: string, checked: boolean) => {
    if (!scoreId) return;
    setAnswerSheetRequestError("");
    setAnswerSheetRequestSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(scoreId);
      } else {
        next.delete(scoreId);
      }
      return Array.from(next);
    });
  };

  const toggleRequestItemSelection = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    itemKeys: string[],
    checked: boolean,
  ) => {
    setter((current) => {
      const next = new Set(current);
      itemKeys.forEach((key) => {
        if (!key) return;
        if (checked) {
          next.add(key);
        } else {
          next.delete(key);
        }
      });
      return Array.from(next);
    });
  };

  const getSelectedWrittenExamScoreIds = (
    selectedItemKeys: string[],
    targetRecords: PerformanceScoreRecord[],
  ) => {
    const validScoreIds = new Set(targetRecords.map(getRecordScoreId));
    return Array.from(
      new Set(
        selectedItemKeys
          .map((key) => parseRequestItemSelectionKey(key).scoreId)
          .filter((scoreId) => scoreId && validScoreIds.has(scoreId)),
      ),
    );
  };

  const buildWrittenExamTargetDetails = (
    selectedItemKeys: string[],
    targetRecords: PerformanceScoreRecord[],
  ) => {
    if (scoreKind !== WRITTEN_EXAM_SCORE_KIND) return "";
    const selected = new Set(selectedItemKeys);
    const details = targetRecords
      .map((record) => {
        const scoreId = getRecordScoreId(record);
        const groupDetails = getWrittenExamItemGroups(record.items || [])
          .map((group) => {
            const itemLabels = group.items
              .filter(({ key }) =>
                selected.has(getRequestItemSelectionKey(scoreId, key)),
              )
              .map(({ label }) => label);
            return itemLabels.length
              ? `${group.label} ${itemLabels.join(", ")}`
              : "";
          })
          .filter(Boolean);
        return groupDetails.length
          ? `${record.title}: ${groupDetails.join(" / ")}`
          : "";
      })
      .filter(Boolean);
    return details.join(" | ");
  };

  const submitAnswerSheetRequest = async () => {
    if (!currentUser?.uid || answerSheetRequesting) return;
    if (!warningConsentCurrent) {
      setAnswerSheetRequestError("안내 문구 동의를 먼저 저장해 주세요.");
      return;
    }
    const selectedScoreIds = hasDetailedWrittenExamItems
      ? getSelectedWrittenExamScoreIds(
          answerSheetRequestSelectedItemKeys,
          records,
        )
      : Array.from(new Set(answerSheetRequestSelectedIds)).filter(Boolean);
    if (!selectedScoreIds.length) {
      setAnswerSheetRequestError(
        hasDetailedWrittenExamItems
          ? "답안지 확인을 요청할 논술형 문제와 하위 문항을 선택해 주세요."
          : "답안지 확인을 요청할 점수를 선택해 주세요.",
      );
      return;
    }
    if (
      selectedScoreIds.some((scoreId) =>
        pendingAnswerSheetRequestScoreIds.has(scoreId),
      )
    ) {
      setAnswerSheetRequestError(
        "이미 확인 요청 중인 점수는 다시 요청할 수 없습니다.",
      );
      return;
    }
    const reason = answerSheetRequestReason.replace(/\s+/g, " ").trim();
    if (reason.length < 10) {
      setAnswerSheetRequestError(
        "교사가 확인할 수 있도록 사유를 10자 이상 자세히 입력해 주세요.",
      );
      return;
    }
    if (reason.length > 300) {
      setAnswerSheetRequestError("사유는 300자 이내로 입력해 주세요.");
      return;
    }

    setAnswerSheetRequesting(true);
    setAnswerSheetRequestError("");
    try {
      const targetDetails = buildWrittenExamTargetDetails(
        answerSheetRequestSelectedItemKeys,
        records.filter((record) =>
          selectedScoreIds.includes(getRecordScoreId(record)),
        ),
      );
      const result = await notifyPerformanceScoreAnswerSheetRequested(config, {
        scoreIds: selectedScoreIds,
        reason,
        scoreKind,
        targetDetails,
      });
      const latestRequests = await loadUserPerformanceScoreAnswerSheetRequests(
        config,
        currentUser.uid,
        { scoreKind },
      );
      setAnswerSheetRequests(latestRequests);
      setAnswerSheetRequestModalOpen(false);
      setAnswerSheetRequestSelectedIds([]);
      setAnswerSheetRequestSelectedItemKeys([]);
      if (result.requestSavedCount <= 0) {
        showToast({
          title: "이미 확인 요청 중입니다.",
          message:
            "기존 요청이 처리되기 전에는 같은 점수로 다시 요청할 수 없습니다.",
          tone: "info",
        });
        return;
      }
      showToast({
        title: "답안지 확인 요청을 보냈습니다.",
        message:
          result.createdCount > 0
            ? "담당 교사에게 알림이 전송되었습니다."
            : "요청은 저장했지만 알림 설정 때문에 새 알림은 만들지 않았습니다.",
        tone: "success",
      });
    } catch (error) {
      console.error("Failed to request answer sheet check:", error);
      setAnswerSheetRequestError(
        "답안지 확인 요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setAnswerSheetRequesting(false);
    }
  };

  const saveWarningConsent = async () => {
    if (!currentUser?.uid || warningConsentSaving) return;
    if (!warningConsentChecked) {
      showToast({
        title: "동의가 필요합니다.",
        message: "안내 문구를 확인한 뒤 동의합니다를 체크해 주세요.",
        tone: "warning",
      });
      return;
    }
    setWarningConsentSaving(true);
    try {
      const saved = await savePerformanceScoreWarningConsent(
        currentUser.uid,
        config,
        scoreSettings,
      );
      setWarningConsent(saved);
      setWarningConsentChecked(false);
      showToast({
        title: "동의 내용을 저장했습니다.",
        message: `이제 ${resolvedCopy.warningSubtitle}를 확인할 수 있습니다.`,
        tone: "success",
      });
    } catch (error) {
      console.error("Failed to save performance score warning consent:", error);
      showToast({
        title: "동의 저장에 실패했습니다.",
        message:
          "네트워크와 로그인 상태를 확인한 뒤 다시 시도해 주세요. 저장 전에는 점수를 확인할 수 없습니다.",
        tone: "error",
      });
    } finally {
      setWarningConsentSaving(false);
    }
  };

  const getSignatureImageDataUrl = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas || (!signatureDrawnRef.current && !signatureDrawn)) return "";
    const context = canvas.getContext("2d");
    if (!context) return "";

    const { width, height } = canvas;
    const pixels = context.getImageData(0, 0, width, height).data;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = pixels[(y * width + x) * 4 + 3];
        if (alpha <= SIGNATURE_ALPHA_THRESHOLD) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (maxX < 0 || maxY < 0) return "";

    const croppedWidth = maxX - minX + 1;
    const croppedHeight = maxY - minY + 1;
    const croppedCanvas = document.createElement("canvas");
    croppedCanvas.width = croppedWidth;
    croppedCanvas.height = croppedHeight;
    const croppedContext = croppedCanvas.getContext("2d");
    if (!croppedContext) return canvas.toDataURL("image/png");

    croppedContext.drawImage(
      canvas,
      minX,
      minY,
      croppedWidth,
      croppedHeight,
      0,
      0,
      croppedWidth,
      croppedHeight,
    );

    return croppedCanvas.toDataURL("image/png");
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

  const toggleObjectionScore = (scoreId: string, checked: boolean) => {
    if (!scoreId) return;
    setObjectionError("");
    setObjectionSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(scoreId);
      } else {
        next.delete(scoreId);
      }
      return Array.from(next);
    });
  };

  const toggleObjectionItemSelection = (
    itemKeys: string[],
    checked: boolean,
  ) => {
    setObjectionError("");
    toggleRequestItemSelection(setObjectionSelectedItemKeys, itemKeys, checked);
  };

  const toggleAnswerSheetRequestItemSelection = (
    itemKeys: string[],
    checked: boolean,
  ) => {
    setAnswerSheetRequestError("");
    toggleRequestItemSelection(
      setAnswerSheetRequestSelectedItemKeys,
      itemKeys,
      checked,
    );
  };

  const submitPerformanceScoreObjection = async () => {
    if (!currentUser?.uid || signatureActionPending) return;
    if (!warningConsentCurrent) {
      setObjectionError("안내 문구 동의를 저장한 뒤 이의 제기할 수 있습니다.");
      return;
    }
    const validScoreIds = new Set(pendingRecords.map(getRecordScoreId));
    const selectedScoreIds = hasDetailedWrittenExamItems
      ? getSelectedWrittenExamScoreIds(
          objectionSelectedItemKeys,
          pendingRecords,
        )
      : Array.from(new Set(objectionSelectedIds)).filter(
          (scoreId) => scoreId && validScoreIds.has(scoreId),
        );
    if (selectedScoreIds.length === 0) {
      setObjectionError(
        hasDetailedWrittenExamItems
          ? "이의 제기할 논술형 문제와 하위 문항을 선택해 주세요."
          : `이의 제기할 ${resolvedCopy.scoreLabel} 점수를 선택해 주세요.`,
      );
      return;
    }
    const selectedRecords = pendingRecords.filter((record) =>
      selectedScoreIds.includes(getRecordScoreId(record)),
    );
    const identityError = getStudentIdentityError(selectedRecords);
    if (identityError) {
      setObjectionError(identityError);
      return;
    }
    const reason = objectionReason.replace(/\s+/g, " ").trim();
    if (!reason) {
      setObjectionError("이의 제기 사유를 입력해 주세요.");
      return;
    }
    if (reason.length > 300) {
      setObjectionError("이의 제기 사유는 300자 이내로 입력해 주세요.");
      return;
    }

    setObjecting(true);
    setObjectionError("");
    try {
      const targetDetails = buildWrittenExamTargetDetails(
        objectionSelectedItemKeys,
        selectedRecords,
      );
      const result = await notifyPerformanceScoreObjectionRequested(config, {
        scoreIds: selectedScoreIds,
        reason,
        scoreKind,
        targetDetails,
      });
      if (result.objectionSavedCount > 0) {
        const latestObjections = await loadUserPerformanceScoreObjections(
          config,
          currentUser.uid,
          { scoreKind },
        );
        setObjections(latestObjections);
      }
      if (
        result.objectionSavedCount <= 0 &&
        result.objectionSkippedProcessedCount > 0
      ) {
        setObjectionError(
          "이미 처리된 이의 제기입니다. 최신 점수를 확인한 뒤 추가 확인이 필요하면 담당 교사에게 직접 문의해 주세요.",
        );
        return;
      }
      if (
        result.recipientCount <= 0 ||
        (result.skippedCount || 0) >= result.recipientCount
      ) {
        if (result.objectionSavedCount > 0) {
          setObjectionModalOpen(false);
          setObjectionResultModalOpen(true);
          setSignatureModalOpen(false);
          setObjectionReason("");
          setObjectionSelectedIds([]);
          setObjectionSelectedItemKeys([]);
          showToast({
            title: "이의 목록에 접수했습니다.",
            message:
              "교사 알림 설정 때문에 새 알림은 생성되지 않았습니다. 필요하면 담당 교사에게 직접 알려 주세요.",
            tone: "warning",
            durationMs: 5200,
          });
        } else {
          setObjectionError(
            "교사 알림 설정 때문에 이의 제기를 전달하지 못했습니다. 담당 교사에게 직접 알려 주세요.",
          );
        }
        return;
      }
      setObjectionModalOpen(false);
      setObjectionResultModalOpen(result.objectionSavedCount > 0);
      setSignatureModalOpen(false);
      setObjectionReason("");
      setObjectionSelectedIds([]);
      setObjectionSelectedItemKeys([]);
      if (result.createdCount > 0) {
        showToast({
          title: "이의 제기를 전달했습니다.",
          message: `선택한 ${resolvedCopy.scoreLabel} 점수와 사유가 담당 교사에게 알림으로 전송되었습니다.`,
          tone: "warning",
          durationMs: 4800,
        });
      } else {
        showToast({
          title: "이미 이의 제기가 전달되어 있습니다.",
          message: `같은 ${resolvedCopy.scoreLabel} 점수에 대한 기존 알림이 있어 새 알림은 만들지 않았습니다.`,
          tone: "info",
          durationMs: 4600,
        });
      }
    } catch (error) {
      console.error("Failed to request performance score objection:", error);
      setObjectionError(getPerformanceScoreObjectionErrorMessage(error));
    } finally {
      setObjecting(false);
    }
  };

  const submitSignatureConfirmation = async () => {
    if (!currentUser?.uid || objecting) return;
    if (!warningConsentCurrent) {
      setSignatureError("안내 문구 동의를 저장한 뒤 서명할 수 있습니다.");
      return;
    }
    if (signatureBlockedByPendingObjection) {
      setSignatureError(signatureBlockedMessage);
      return;
    }
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

  const chartOptions: ChartOptions<"bar"> = {
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
          label: (context: TooltipItem<"bar">) => {
            const item = visibleChartItems[context.dataIndex]?.item;
            const score =
              context.datasetIndex === 0 && item
                ? getFiniteScoreValue(item.score)
                : (context.parsed.y ?? 0);
            return `${context.dataset.label || "점수"}: ${formatPerformanceScore(
              score,
            )}점`;
          },
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
          maxRotation: 0,
          minRotation: 0,
        },
      },
    },
  };

  const renderWrittenExamRequestTargets = (params: {
    records: PerformanceScoreRecord[];
    selectedItemKeys: string[];
    disabled: boolean;
    pendingScoreIds?: Set<string>;
    tone: "blue" | "rose";
    onToggle: (itemKeys: string[], checked: boolean) => void;
  }) => {
    const selectedItemKeySet = new Set(params.selectedItemKeys);
    return (
      <div className="mt-3 grid gap-3">
        {params.records.map((record) => {
          const scoreId = getRecordScoreId(record);
          const alreadyPending = params.pendingScoreIds?.has(scoreId) || false;
          const groups = getWrittenExamItemGroups(record.items || []);
          return (
            <div
              key={`written-request-${params.tone}-${scoreId}`}
              className={`rounded-xl border px-3 py-3 ${
                alreadyPending
                  ? "border-slate-200 bg-slate-50 opacity-75"
                  : "border-slate-200 bg-white"
              }`}
            >
              <div className="whitespace-normal break-keep text-sm font-black leading-5 text-slate-900">
                {record.title}
              </div>
              <div className="mt-1 text-xs font-bold text-slate-500">
                전체 획득 {formatPerformanceScore(record.totalScore)} /{" "}
                {formatPerformanceScore(record.totalMaxScore)}점
              </div>
              {alreadyPending && (
                <div className="mt-2 text-xs font-black text-blue-700">
                  이미 확인 요청 중입니다.
                </div>
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {groups.map((group) => {
                  const itemKeys = group.items.map(({ key }) =>
                    getRequestItemSelectionKey(scoreId, key),
                  );
                  const checkedCount = itemKeys.filter((key) =>
                    selectedItemKeySet.has(key),
                  ).length;
                  const checked =
                    itemKeys.length > 0 && checkedCount === itemKeys.length;
                  const indeterminate =
                    checkedCount > 0 && checkedCount < itemKeys.length;
                  const checkboxTone =
                    params.tone === "rose"
                      ? "text-rose-600 focus:ring-rose-500"
                      : "text-blue-600 focus:ring-blue-500";
                  return (
                    <div
                      key={`written-request-group-${scoreId}-${group.key}`}
                      className={`rounded-lg border px-3 py-3 ${
                        checkedCount > 0
                          ? params.tone === "rose"
                            ? "border-rose-200 bg-rose-50"
                            : "border-blue-200 bg-blue-50"
                          : "border-slate-100 bg-slate-50"
                      }`}
                    >
                      <label className="flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          ref={(node) => {
                            if (node) node.indeterminate = indeterminate;
                          }}
                          onChange={(event) =>
                            params.onToggle(itemKeys, event.target.checked)
                          }
                          disabled={
                            params.disabled ||
                            alreadyPending ||
                            itemKeys.length === 0
                          }
                          className={`mt-0.5 h-4 w-4 rounded border-slate-300 ${checkboxTone}`}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-black text-slate-900">
                            {group.label} 논술형 문제
                          </span>
                          <span className="mt-1 block text-xs font-bold text-slate-500">
                            획득{" "}
                            {formatPerformanceScore(
                              getWrittenExamGroupScore(group),
                            )}{" "}
                            /{" "}
                            {formatPerformanceScore(
                              getWrittenExamGroupMaxScore(group),
                            )}
                            점
                          </span>
                        </span>
                      </label>
                      <div className="mt-3 grid gap-2">
                        {group.items.map(({ key, label, item }) => {
                          const itemSelectionKey = getRequestItemSelectionKey(
                            scoreId,
                            key,
                          );
                          const itemChecked =
                            selectedItemKeySet.has(itemSelectionKey);
                          return (
                            <label
                              key={`written-request-item-${scoreId}-${key}`}
                              className="flex cursor-pointer items-center justify-between gap-3 rounded-md bg-white px-3 py-2 text-xs font-bold"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={itemChecked}
                                  onChange={(event) =>
                                    params.onToggle(
                                      [itemSelectionKey],
                                      event.target.checked,
                                    )
                                  }
                                  disabled={params.disabled || alreadyPending}
                                  className={`h-4 w-4 rounded border-slate-300 ${checkboxTone}`}
                                />
                                <span className="text-slate-700">{label}</span>
                              </span>
                              <span className="shrink-0 text-slate-500">
                                {item.scoreEntered === false
                                  ? "-"
                                  : formatPerformanceScore(item.score)}{" "}
                                / {formatPerformanceScore(item.maxScore)}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  if (loading) {
    return <PageLoading message={resolvedCopy.loadingMessage} />;
  }

  if (!warningConsentCurrent) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-10">
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <div className="break-keep">
            <p className="text-sm font-black text-blue-700">
              {resolvedCopy.warningTitle}
            </p>
            <h1 className="mt-1 text-2xl font-black text-slate-900">
              {resolvedCopy.warningSubtitle}
            </h1>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-500">
              안내 문구에 동의한 학생만 점수 확인, 서명, 이의 제기를 진행할 수
              있습니다.
            </p>
          </div>

          <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-4">
            <h2 className="text-base font-black text-rose-800">
              반드시 본인 점수만 확인하세요.
            </h2>
            <p className="mt-2 whitespace-pre-wrap break-keep text-sm font-bold leading-7 text-rose-700">
              {scoreSettings.warningText}
            </p>
          </div>

          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
            <input
              type="checkbox"
              checked={warningConsentChecked}
              onChange={(event) =>
                setWarningConsentChecked(event.target.checked)
              }
              disabled={warningConsentSaving}
              className="mt-1 h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="break-keep text-sm font-black leading-6 text-slate-800">
              위 안내를 확인했으며, 본인 점수만 확인하고 본인이 직접 서명할 것에
              동의합니다.
            </span>
          </label>

          <button
            type="button"
            onClick={() => void saveWarningConsent()}
            disabled={!warningConsentChecked || warningConsentSaving}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-blue-600 px-5 py-2 text-sm font-black leading-5 text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
          >
            {warningConsentSaving ? "저장 중..." : "동의 저장하고 점수 확인"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-10">
      <div className="mb-5 rounded-xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 break-keep">
            <h1 className="text-2xl font-black text-slate-900">
              {resolvedCopy.pageTitle}
            </h1>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-500">
              {year}학년도 {semester}학기 기준으로 교사가 입력한 내 총점과{" "}
              {resolvedCopy.pageDescription}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
            {selectedRecord &&
              (allScoresConfirmed ? (
                <>
                  {hasObjectionHistory && (
                    <button
                      type="button"
                      onClick={openObjectionResultModal}
                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 py-2 text-sm font-black leading-5 text-slate-700 transition hover:bg-slate-50"
                    >
                      이의 결과
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={openAnswerSheetRequestModal}
                    disabled={signatureActionPending}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-blue-200 bg-white px-5 py-2 text-sm font-black leading-5 text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    답안지 확인 요청
                  </button>
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="inline-flex min-h-11 cursor-not-allowed items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-black leading-5 text-blue-800 opacity-80"
                  >
                    점수 확인 완료 {confirmedRecordCount}/{records.length}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={openObjectionModal}
                    disabled={signatureActionPending}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-rose-200 bg-white px-5 py-2 text-sm font-black leading-5 text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    이의 신청
                  </button>
                  <button
                    type="button"
                    onClick={openAnswerSheetRequestModal}
                    disabled={signatureActionPending}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-blue-200 bg-white px-5 py-2 text-sm font-black leading-5 text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    답안지 확인 요청
                  </button>
                  {hasObjectionHistory && (
                    <button
                      type="button"
                      onClick={openObjectionResultModal}
                      disabled={signatureActionPending}
                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 py-2 text-sm font-black leading-5 text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      이의 결과
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={openSignatureModal}
                    disabled={signatureButtonDisabled}
                    title={signatureBlockedMessage || undefined}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-600 px-5 py-2 text-sm font-black leading-5 text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    점수 확인 및 서명하기
                  </button>
                </>
              ))}
          </div>
        </div>
        {signatureBlockedByPendingObjection && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-800">
            {signatureBlockedMessage}
          </div>
        )}
      </div>

      {!selectedRecord ? (
        <div className="break-keep rounded-xl border border-dashed border-slate-200 bg-white px-4 py-16 text-center shadow-sm">
          <div className="text-lg font-black text-slate-700">
            {resolvedCopy.emptyTitle}
          </div>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-400">
            {resolvedCopy.emptyDescription}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
          <aside className="w-full shrink-0 lg:w-72">
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm lg:sticky lg:top-8">
              <div className="border-b border-gray-100 p-4 sm:p-6">
                <h2 className="flex items-center gap-2 text-lg font-extrabold text-gray-800 sm:text-xl">
                  <i
                    className="fas fa-clipboard-list text-gray-400"
                    aria-hidden="true"
                  ></i>
                  점수 목록
                </h2>
              </div>
              <nav
                className="flex gap-2 overflow-x-auto p-3 lg:flex-col lg:gap-0 lg:overflow-visible lg:p-0"
                aria-label={resolvedCopy.scoreListLabel}
              >
                {hasWrittenExamSidebarGroups
                  ? records.flatMap((record) => {
                      const scoreId = getRecordScoreId(record);
                      const recordActive =
                        record.id === selectedRecord.id ||
                        (!selectedRecord.id && record.id === records[0]?.id);
                      return getWrittenExamItemGroups(record.items || []).map(
                        (group) => {
                          const groupActive =
                            recordActive &&
                            activeWrittenExamGroup?.key === group.key;
                          return (
                            <button
                              key={`${scoreId || record.rosterId}-${group.key}`}
                              type="button"
                              onClick={() => {
                                setSelectedId(record.id || "");
                                setSelectedWrittenExamGroupKey(group.key);
                              }}
                              aria-current={groupActive ? "true" : undefined}
                              className={`flex min-w-[15rem] items-start gap-3 rounded-xl border p-3 text-left transition-colors lg:min-w-0 lg:rounded-none lg:border-0 lg:border-l-4 lg:p-4 ${
                                groupActive
                                  ? "border-blue-200 bg-blue-50 text-blue-600 lg:border-blue-600"
                                  : "border-gray-200 text-slate-600 hover:bg-gray-50 lg:border-transparent"
                              }`}
                            >
                              <div className="w-6 shrink-0 text-center">
                                <i
                                  className="fas fa-clipboard-check text-sm"
                                  aria-hidden="true"
                                ></i>
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="whitespace-normal break-keep text-sm font-bold leading-5">
                                  {group.label} 논술형 문제
                                </div>
                                <div
                                  className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold ${
                                    groupActive
                                      ? "text-blue-500"
                                      : "text-slate-500"
                                  }`}
                                >
                                  <span>
                                    획득{" "}
                                    {formatPerformanceScore(
                                      getWrittenExamGroupScore(group),
                                    )}{" "}
                                    /{" "}
                                    {formatPerformanceScore(
                                      getWrittenExamGroupMaxScore(group),
                                    )}
                                  </span>
                                  {record.signatureName && (
                                    <span className="text-blue-700">
                                      확인 완료
                                    </span>
                                  )}
                                  {pendingObjectionScoreIds.has(scoreId) && (
                                    <span className="text-amber-700">
                                      이의 처리 대기
                                    </span>
                                  )}
                                  {pendingAnswerSheetRequestScoreIds.has(
                                    scoreId,
                                  ) && (
                                    <span className="text-blue-700">
                                      답안지 확인 요청 중
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>
                          );
                        },
                      );
                    })
                  : records.map((record) => {
                      const active =
                        record.id === selectedRecord.id ||
                        (!selectedRecord.id && record.id === records[0]?.id);
                      return (
                        <button
                          key={record.id || record.rosterId}
                          type="button"
                          onClick={() => setSelectedId(record.id || "")}
                          aria-current={active ? "true" : undefined}
                          className={`flex min-w-[15rem] items-start gap-3 rounded-xl border p-3 text-left transition-colors lg:min-w-0 lg:rounded-none lg:border-0 lg:border-l-4 lg:p-4 ${
                            active
                              ? "border-blue-200 bg-blue-50 text-blue-600 lg:border-blue-600"
                              : "border-gray-200 text-slate-600 hover:bg-gray-50 lg:border-transparent"
                          }`}
                        >
                          <div className="w-6 shrink-0 text-center">
                            <i
                              className="fas fa-clipboard-check text-sm"
                              aria-hidden="true"
                            ></i>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="whitespace-normal break-keep text-sm font-bold leading-5">
                              {record.title}
                            </div>
                            <div
                              className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold ${
                                active ? "text-blue-500" : "text-slate-500"
                              }`}
                            >
                              <span>
                                획득 {formatPerformanceScore(record.totalScore)}{" "}
                                / {formatPerformanceScore(record.totalMaxScore)}
                              </span>
                              {record.signatureName && (
                                <span className="text-blue-700">확인 완료</span>
                              )}
                              {pendingObjectionScoreIds.has(
                                getRecordScoreId(record),
                              ) && (
                                <span className="text-amber-700">
                                  이의 처리 대기
                                </span>
                              )}
                              {pendingAnswerSheetRequestScoreIds.has(
                                getRecordScoreId(record),
                              ) && (
                                <span className="text-blue-700">
                                  답안지 확인 요청 중
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
              </nav>
            </div>
          </aside>

          <section className="min-w-0 flex-1 break-keep rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-black text-blue-700">
                  {selectedRecord.subject || resolvedCopy.scoreSubjectFallback}
                </div>
                <h2 className="mt-1 whitespace-normal break-keep text-2xl font-black leading-tight text-slate-900">
                  {selectedRecord.title}
                </h2>
                {activeWrittenExamGroup && (
                  <div className="mt-3 inline-flex rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-black text-blue-800">
                    {activeWrittenExamGroup.label} 논술형 문제
                  </div>
                )}
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
                  {formatPerformanceScore(visibleTotalScore)}
                  <span className="text-xl text-slate-300">
                    {" "}
                    / {formatPerformanceScore(visibleTotalMaxScore)}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 lg:justify-end">
                  {selectedRecordHasPendingObjection ? (
                    <span className="inline-flex items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-800">
                      이의 제기 처리 대기
                    </span>
                  ) : hasConfirmation ? (
                    <span className="inline-flex items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-800">
                      확인 완료
                      {confirmedAt ? ` · ${formatDateTime(confirmedAt)}` : ""}
                    </span>
                  ) : (
                    <span className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-500">
                      상단에서 전체 점수 확인 필요
                    </span>
                  )}
                  {selectedRecordHasPendingAnswerSheetRequest && (
                    <span className="inline-flex items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-800">
                      답안지 확인 요청 중
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[minmax(240px,280px)_minmax(0,1fr)]">
              <div className="flex flex-col justify-center rounded-xl border border-blue-100 bg-blue-50 p-5">
                <div className="text-sm font-black text-blue-800">
                  내 획득 점수
                </div>
                <div className="mt-3 text-5xl font-black text-blue-700">
                  {formatPerformanceScore(visibleTotalScore)}
                  <span className="ml-1 text-2xl text-blue-300">
                    / {formatPerformanceScore(visibleTotalMaxScore)}
                  </span>
                </div>
                <p className="mt-5 whitespace-normal break-keep text-sm font-bold leading-6 text-blue-900/70">
                  점수와 {resolvedCopy.evidenceTitle}을 함께 확인해 주세요.
                </p>
              </div>

              <div className="relative h-72 min-w-0 overflow-hidden rounded-xl border border-slate-200 p-4">
                {visibleChartItems.length > 0 ? (
                  <div
                    ref={scoreChartContainerRef}
                    className="relative h-full min-h-0 w-full min-w-0 overflow-hidden"
                  >
                    <Bar
                      ref={scoreChartRef}
                      data={chartData}
                      options={chartOptions}
                      style={{ maxWidth: "100%" }}
                    />
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center px-4 text-center text-sm font-bold leading-6 text-slate-400">
                    {resolvedCopy.scoreItemsLabel}는 제공되지 않았습니다. 점수와{" "}
                    {resolvedCopy.evidenceTitle}을 확인해 주세요.
                  </div>
                )}
              </div>
            </div>

            {hasDetailedWrittenExamItems && (
              <div className="mt-5 rounded-xl border border-slate-200 bg-white px-4 py-4">
                <h3 className="text-base font-black text-slate-900">
                  {activeWrittenExamGroup
                    ? `${activeWrittenExamGroup.label} 문항별 점수와 피드백`
                    : "문항별 점수와 피드백"}
                </h3>
                <div className="mt-4 grid gap-4">
                  {[activeWrittenExamGroup].filter(Boolean).map((group) => (
                    <div
                      key={group?.key}
                      className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-4"
                    >
                      <div className="text-sm font-black text-blue-900">
                        {group?.label}
                      </div>
                      <div className="mt-3 space-y-2">
                        {group?.items.map(({ key, label, item, index }) => (
                          <div
                            key={`${key}-${index}`}
                            className="rounded-lg border border-white bg-white px-3 py-3 shadow-sm"
                          >
                            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
                              <span className="text-sm font-black text-slate-800">
                                {label}
                              </span>
                              <div className="min-w-0">
                                {item.feedback && (
                                  <p className="whitespace-pre-wrap break-keep text-sm font-bold leading-6 text-slate-600">
                                    {item.feedback}
                                  </p>
                                )}
                              </div>
                              <span className="shrink-0 text-sm font-black text-blue-700">
                                {item.scoreEntered === false
                                  ? "-"
                                  : formatPerformanceScore(item.score)}
                                <span className="text-slate-400">
                                  {" "}
                                  / {formatPerformanceScore(item.maxScore)}점
                                </span>
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(!hasDetailedWrittenExamItems || evidenceBlockText) && (
              <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-4">
                <h3 className="text-base font-black text-blue-900">
                  {hasDetailedWrittenExamItems
                    ? "전체 피드백"
                    : resolvedCopy.evidenceTitle}
                </h3>
                <p className="mt-2 whitespace-pre-wrap break-keep text-sm font-bold leading-7 text-slate-700">
                  {evidenceBlockText || resolvedCopy.evidenceEmptyText}
                </p>
              </div>
            )}
          </section>
        </div>
      )}

      {objectionModalOpen && selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 py-6">
          <section className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0 break-keep">
                <h3 className="text-lg font-black text-slate-900">
                  {resolvedCopy.objectionTitle}
                </h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                  {resolvedCopy.objectionDescription}
                </p>
              </div>
              <button
                type="button"
                onClick={closeObjectionModal}
                disabled={objecting}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
                aria-label="이의 신청 창 닫기"
              >
                <i className="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              <fieldset>
                <legend className="text-sm font-black text-slate-800">
                  {resolvedCopy.objectionTargetLabel}
                </legend>
                {hasDetailedWrittenExamItems ? (
                  renderWrittenExamRequestTargets({
                    records: pendingRecords,
                    selectedItemKeys: objectionSelectedItemKeys,
                    disabled: objecting,
                    tone: "rose",
                    onToggle: toggleObjectionItemSelection,
                  })
                ) : (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {pendingRecords.map((record) => {
                      const scoreId = getRecordScoreId(record);
                      const checked = objectionSelectedIds.includes(scoreId);
                      return (
                        <label
                          key={`objection-${scoreId}`}
                          className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition ${
                            checked
                              ? "border-rose-200 bg-rose-50"
                              : "border-slate-200 bg-white hover:bg-slate-50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              toggleObjectionScore(
                                scoreId,
                                event.target.checked,
                              )
                            }
                            disabled={objecting}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                          />
                          <span className="min-w-0">
                            <span className="block whitespace-normal break-keep text-sm font-black leading-5 text-slate-900">
                              {record.title}
                            </span>
                            <span className="mt-1 block text-xs font-bold text-slate-500">
                              획득 {formatPerformanceScore(record.totalScore)} /{" "}
                              {formatPerformanceScore(record.totalMaxScore)}점
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </fieldset>

              <div className="mt-5">
                <label
                  htmlFor="performance-score-objection-reason"
                  className="text-sm font-black text-slate-800"
                >
                  {resolvedCopy.objectionReasonLabel}
                </label>
                <textarea
                  id="performance-score-objection-reason"
                  value={objectionReason}
                  onChange={(event) => {
                    setObjectionReason(event.target.value);
                    setObjectionError("");
                  }}
                  disabled={objecting}
                  maxLength={300}
                  rows={5}
                  className="mt-2 w-full resize-none rounded-lg border border-slate-200 px-3 py-3 text-sm font-semibold leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-rose-300 focus:ring-2 focus:ring-rose-100 disabled:bg-slate-50"
                  placeholder={resolvedCopy.objectionPlaceholder}
                />
                <div className="mt-1 text-right text-xs font-bold text-slate-400">
                  {objectionReason.length}/300
                </div>
              </div>

              {objectionError && (
                <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold leading-6 text-rose-700">
                  {objectionError}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={closeObjectionModal}
                disabled={objecting}
                className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void submitPerformanceScoreObjection()}
                disabled={objecting}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-rose-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-rose-700 disabled:bg-slate-300"
              >
                {objecting ? "전송 중..." : "이의 신청 보내기"}
              </button>
            </div>
          </section>
        </div>
      )}

      {answerSheetRequestModalOpen && selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 py-6">
          <section className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0 break-keep">
                <h3 className="text-lg font-black text-slate-900">
                  답안지 확인 요청
                </h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                  확인하고 싶은 {resolvedCopy.scoreLabel} 점수를 선택하고,
                  답안지를 확인하려는 이유를 자세히 적어 주세요.
                </p>
              </div>
              <button
                type="button"
                onClick={closeAnswerSheetRequestModal}
                disabled={answerSheetRequesting}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
                aria-label="답안지 확인 요청 창 닫기"
              >
                <i className="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              <fieldset>
                <legend className="text-sm font-black text-slate-800">
                  확인 요청 대상
                </legend>
                {hasDetailedWrittenExamItems ? (
                  renderWrittenExamRequestTargets({
                    records,
                    selectedItemKeys: answerSheetRequestSelectedItemKeys,
                    disabled: answerSheetRequesting,
                    pendingScoreIds: pendingAnswerSheetRequestScoreIds,
                    tone: "blue",
                    onToggle: toggleAnswerSheetRequestItemSelection,
                  })
                ) : (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {records.map((record) => {
                      const scoreId = getRecordScoreId(record);
                      const alreadyPending =
                        pendingAnswerSheetRequestScoreIds.has(scoreId);
                      const checked =
                        !alreadyPending &&
                        answerSheetRequestSelectedIds.includes(scoreId);
                      return (
                        <label
                          key={`answer-sheet-${scoreId}`}
                          className={`flex items-start gap-3 rounded-lg border px-3 py-3 transition ${
                            alreadyPending
                              ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-75"
                              : checked
                                ? "border-blue-200 bg-blue-50"
                                : "border-slate-200 bg-white hover:bg-slate-50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              toggleAnswerSheetRequestScore(
                                scoreId,
                                event.target.checked,
                              )
                            }
                            disabled={answerSheetRequesting || alreadyPending}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="min-w-0">
                            <span className="block whitespace-normal break-keep text-sm font-black leading-5 text-slate-900">
                              {record.title}
                            </span>
                            <span className="mt-1 block text-xs font-bold text-slate-500">
                              획득 {formatPerformanceScore(record.totalScore)} /{" "}
                              {formatPerformanceScore(record.totalMaxScore)}점
                            </span>
                            {alreadyPending && (
                              <span className="mt-1 block text-xs font-black text-blue-700">
                                이미 확인 요청 중입니다.
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </fieldset>

              <div className="mt-5">
                <label
                  htmlFor="performance-score-answer-sheet-reason"
                  className="text-sm font-black text-slate-800"
                >
                  확인 요청 사유
                </label>
                <textarea
                  id="performance-score-answer-sheet-reason"
                  value={answerSheetRequestReason}
                  onChange={(event) => {
                    setAnswerSheetRequestReason(event.target.value);
                    setAnswerSheetRequestError("");
                  }}
                  disabled={answerSheetRequesting}
                  maxLength={300}
                  rows={5}
                  className="mt-2 w-full resize-none rounded-lg border border-slate-200 px-3 py-3 text-sm font-semibold leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50"
                  placeholder="예: 논술형 채점 근거를 다시 확인하고 싶어 답안지 확인을 요청합니다."
                />
                <div className="mt-1 text-right text-xs font-bold text-slate-400">
                  {answerSheetRequestReason.length}/300
                </div>
              </div>

              {answerSheetRequestError && (
                <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold leading-6 text-rose-700">
                  {answerSheetRequestError}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={closeAnswerSheetRequestModal}
                disabled={answerSheetRequesting}
                className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void submitAnswerSheetRequest()}
                disabled={answerSheetRequesting}
                className="inline-flex h-11 items-center justify-center rounded-lg bg-blue-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:bg-slate-300"
              >
                {answerSheetRequesting ? "전송 중..." : "요청 보내기"}
              </button>
            </div>
          </section>
        </div>
      )}

      {objectionResultModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 py-6">
          <section className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0 break-keep">
                <h3 className="text-lg font-black text-slate-900">
                  {resolvedCopy.objectionResultTitle}
                </h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                  내가 보낸 이의 신청과 담당 교사의 처리 결과를 확인합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={closeObjectionResultModal}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
                aria-label="이의 결과 창 닫기"
              >
                <i className="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              {sortedObjections.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center">
                  <div className="text-sm font-black text-slate-700">
                    아직 이의 신청 내역이 없습니다.
                  </div>
                  <p className="mt-2 text-xs font-bold leading-5 text-slate-500">
                    이의 신청을 보내면 이곳에서 처리 상태를 확인할 수 있습니다.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedObjections.map((objection) => {
                    const meta = getObjectionStatusMeta(objection.status);
                    const record =
                      recordByScoreId.get(objection.scoreId) ||
                      recordByScoreId.get(objection.rosterId || "");
                    const scoreTitle =
                      objection.scoreTitle ||
                      record?.title ||
                      resolvedCopy.scoreLabel;
                    const teacherResponse = objection.reviewMemo?.trim() || "";
                    const requestedAtLabel =
                      formatDateTimeWithTime(objection.requestedAt) ||
                      "신청 시간 없음";
                    const reviewedAtLabel = formatDateTimeWithTime(
                      objection.reviewedAt,
                    );

                    return (
                      <article
                        key={objection.id}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="whitespace-normal break-keep text-base font-black leading-6 text-slate-900">
                              {scoreTitle}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-slate-500">
                              <span>신청 {requestedAtLabel}</span>
                              {reviewedAtLabel && (
                                <span>처리 {reviewedAtLabel}</span>
                              )}
                            </div>
                          </div>
                          <span
                            className={`inline-flex w-fit shrink-0 rounded-full border px-3 py-1 text-xs font-black ${meta.badgeClass}`}
                          >
                            {meta.label}
                          </span>
                        </div>

                        <div className="mt-4 grid gap-3">
                          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
                            <div className="text-xs font-black text-slate-500">
                              내가 보낸 이의 내용
                            </div>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-slate-800">
                              {objection.reason || "이의 신청 사유 없음"}
                            </p>
                          </div>

                          {objection.status === "accepted" &&
                            objection.changedScoreLabel && (
                              <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-800">
                                변경 후 점수: {objection.changedScoreLabel}
                              </div>
                            )}

                          {objection.targetDetails && (
                            <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-bold leading-6 text-blue-800">
                              대상: {objection.targetDetails}
                            </div>
                          )}

                          <div
                            className={`rounded-lg border px-3 py-3 ${meta.panelClass}`}
                          >
                            <div className="text-xs font-black opacity-80">
                              {meta.responseLabel}
                            </div>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold leading-6">
                              {teacherResponse || meta.emptyResponse}
                            </p>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={closeObjectionResultModal}
                className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-black text-slate-700 transition hover:bg-slate-50"
              >
                닫기
              </button>
            </div>
          </section>
        </div>
      )}

      {signatureModalOpen && selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-3 py-3 sm:px-4 sm:py-6">
          <section className="flex max-h-[96dvh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl sm:max-h-[92vh]">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-5 sm:py-4">
              <div className="min-w-0 break-keep">
                <h3 className="text-lg font-black text-slate-900">
                  {resolvedCopy.signatureTitle}
                </h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                  {scoreKind === WRITTEN_EXAM_SCORE_KIND
                    ? "모든 논술형 문제의 점수를 확인한 뒤, 성을 포함한 이름을 직접 써 주세요."
                    : "모든 차시의 점수를 확인한 뒤, 성을 포함한 이름을 직접 써 주세요."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeSignatureModal}
                disabled={signatureActionPending}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:opacity-40"
                aria-label="서명 창 닫기"
              >
                <i className="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>

            <div className="overflow-y-auto px-4 py-4 sm:px-5">
              {signatureReviewStep === "sign" ? (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    {records.flatMap((record) => {
                      const groups =
                        scoreKind === WRITTEN_EXAM_SCORE_KIND
                          ? getWrittenExamItemGroups(record.items || [])
                          : [];
                      if (groups.length > 0) {
                        return groups.map((group) => (
                          <div
                            key={`${getRecordScoreId(record)}-${group.key}`}
                            className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3"
                          >
                            <div className="whitespace-normal break-keep text-sm font-black leading-5 text-blue-950">
                              {group.label} 논술형 문제
                            </div>
                            <div className="mt-1 text-xs font-bold text-blue-900/70">
                              {record.title}
                            </div>
                            <div className="mt-2 text-lg font-black text-blue-700">
                              {formatPerformanceScore(
                                getWrittenExamGroupScore(group),
                              )}
                              <span className="ml-1 text-sm text-blue-300">
                                /{" "}
                                {formatPerformanceScore(
                                  getWrittenExamGroupMaxScore(group),
                                )}
                                점
                              </span>
                            </div>
                          </div>
                        ));
                      }
                      return [
                        <div
                          key={getRecordScoreId(record)}
                          className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3"
                        >
                          <div className="whitespace-normal break-keep text-sm font-black leading-5 text-blue-950">
                            {record.title}
                          </div>
                          <div className="mt-2 text-lg font-black text-blue-700">
                            {formatPerformanceScore(record.totalScore)}
                            <span className="ml-1 text-sm text-blue-300">
                              / {formatPerformanceScore(record.totalMaxScore)}점
                            </span>
                          </div>
                        </div>,
                      ];
                    })}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <p className="break-keep text-sm font-bold leading-7 text-slate-700">
                      {resolvedCopy.signatureAgreementText}
                    </p>
                    <div className="mt-4 flex justify-center">
                      <button
                        type="button"
                        onClick={toggleSignatureConsent}
                        disabled={signatureActionPending}
                        aria-pressed={signatureConsent}
                        aria-controls="performance-signature-drawing-panel"
                        className={`inline-flex h-12 min-w-[13rem] items-center justify-center gap-2 rounded-full border px-6 text-sm font-black shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                          signatureConsent
                            ? "border-blue-600 bg-blue-600 text-white shadow-blue-100 hover:bg-blue-700"
                            : "border-blue-200 bg-white text-blue-700 hover:border-blue-300 hover:bg-blue-50"
                        }`}
                      >
                        <span
                          className={`inline-flex h-5 w-5 items-center justify-center rounded-full border ${
                            signatureConsent
                              ? "border-white bg-white text-blue-600"
                              : "border-blue-300 bg-blue-50 text-blue-600"
                          }`}
                          aria-hidden="true"
                        >
                          <i className="fas fa-check text-[10px]"></i>
                        </span>
                        {signatureConsent ? "동의 완료" : "동의합니다"}
                      </button>
                    </div>
                  </div>

                  {signatureConsent && (
                    <div
                      id="performance-signature-drawing-panel"
                      className="rounded-xl border border-blue-100 bg-white px-4 py-4 shadow-sm"
                    >
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
                          disabled={signatureActionPending}
                          className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          지우기
                        </button>
                      </div>
                      <div
                        className="relative mx-auto overflow-hidden rounded-xl border border-blue-200 bg-blue-50"
                        style={{
                          width: signatureCanvasWidth,
                          maxWidth: "100%",
                        }}
                      >
                        <div
                          className="pointer-events-none absolute inset-0 flex items-center justify-center px-2 text-center font-black leading-none"
                          style={{
                            color: "rgba(30, 58, 138, 0.09)",
                            fontSize: signatureMobileGuideFontSize,
                            letterSpacing: signatureMobileGuideLetterSpacing,
                          }}
                        >
                          <span className="whitespace-nowrap sm:hidden">
                            {signatureGuideText}
                          </span>
                        </div>
                        <div
                          className="pointer-events-none absolute inset-0 hidden items-center justify-center px-2 text-center font-black leading-none sm:flex"
                          style={{
                            color: "rgba(30, 58, 138, 0.09)",
                            fontSize: signatureGuideFontSize,
                            letterSpacing: signatureGuideLetterSpacing,
                          }}
                        >
                          <span className="whitespace-nowrap">
                            {signatureGuideText}
                          </span>
                        </div>
                        <canvas
                          ref={signatureCanvasRef}
                          width={signatureCanvasWidth}
                          height={SIGNATURE_CANVAS_HEIGHT}
                          className="relative z-10 h-40 w-full touch-none cursor-crosshair bg-transparent sm:h-52"
                          onPointerDown={(event) => {
                            if (!signatureConsent || signatureActionPending)
                              return;
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
                            if (!drawingRef.current || !signatureConsent)
                              return;
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
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-4">
                    <h4 className="text-base font-black text-blue-950">
                      최종 확인
                    </h4>
                    <p className="mt-2 text-sm font-bold leading-7 text-slate-700">
                      {resolvedCopy.signatureReviewDescription}
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

                  <div className="grid gap-3 lg:grid-cols-2">
                    {records.flatMap((record) => {
                      const groups =
                        scoreKind === WRITTEN_EXAM_SCORE_KIND
                          ? getWrittenExamItemGroups(record.items || [])
                          : [];
                      if (groups.length > 0) {
                        return groups.map((group) => (
                          <div
                            key={`${getRecordScoreId(record)}-${group.key}-review`}
                            className="flex min-w-0 flex-col rounded-xl border border-slate-200"
                          >
                            <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="whitespace-normal break-keep font-black text-slate-900">
                                {group.label} 논술형 문제
                              </div>
                              <div className="text-sm font-black text-blue-700">
                                {formatPerformanceScore(
                                  getWrittenExamGroupScore(group),
                                )}{" "}
                                /{" "}
                                {formatPerformanceScore(
                                  getWrittenExamGroupMaxScore(group),
                                )}
                                점
                              </div>
                            </div>
                            <div className="grid gap-2 px-4 py-3 md:grid-cols-2">
                              {group.items.map(({ key, label, item }) => (
                                <div
                                  key={`${record.rosterId}-${key}-review`}
                                  className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold"
                                >
                                  <span className="whitespace-normal break-keep text-slate-600">
                                    {label}
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
                        ));
                      }
                      return [
                        <div
                          key={`${getRecordScoreId(record)}-review`}
                          className="flex min-w-0 flex-col rounded-xl border border-slate-200"
                        >
                          <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="whitespace-normal break-keep font-black text-slate-900">
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
                                <span className="whitespace-normal break-keep text-slate-600">
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
                        </div>,
                      ];
                    })}
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

            <div className="flex flex-col gap-2 border-t border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-5 sm:py-4">
              <button
                type="button"
                onClick={closeSignatureModal}
                disabled={signatureActionPending}
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
                  disabled={signatureActionPending}
                  className="inline-flex h-11 items-center justify-center rounded-lg border border-blue-200 bg-white px-5 text-sm font-black text-blue-700 transition hover:bg-blue-50 disabled:opacity-40"
                >
                  서명 수정
                </button>
              )}
              {signatureReviewStep === "sign" ? (
                <button
                  type="button"
                  onClick={moveToSignatureReview}
                  disabled={signatureActionPending}
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-blue-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:bg-slate-300"
                >
                  확인 내용 검토
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void submitSignatureConfirmation()}
                  disabled={signatureActionPending}
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

const PerformanceScoreView: React.FC = () => <ScoreConfirmationView />;

export default PerformanceScoreView;
