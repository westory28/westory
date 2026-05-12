import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getHistoryClassroomBlankRenderRect,
  isHistoryClassroomBlankCorrect,
  normalizeHistoryClassroomAnswer,
  type HistoryClassroomAnswerCheck,
  type HistoryClassroomBlank,
  type HistoryClassroomAssignment,
} from "../../lib/historyClassroom";

interface HistoryClassroomAssignmentViewProps {
  assignment: HistoryClassroomAssignment;
  currentPage: number;
  onCurrentPageChange: (page: number) => void;
  answers: Record<string, string>;
  onAnswerChange?: (blankId: string, value: string) => void;
  onSubmit?: () => void;
  submitting?: boolean;
  completed?: boolean;
  readOnly?: boolean;
  resultText?: string;
  pointNotice?: string;
  countdownLabel?: string | null;
  timeProgressPercent?: number;
  dueStatusLabel?: string | null;
  dueStatusTone?: "slate" | "amber" | "rose";
  headerAction?: React.ReactNode;
  helperItems?: string[];
  layoutVariant?: "default" | "modalPreview";
  interactiveViewport?: boolean;
  resolveBlankOverlap?: boolean;
  answerChecks?: HistoryClassroomAnswerCheck[];
}

const DEFAULT_HELPER_ITEMS = [
  "오른쪽 참고 보기에서 단어를 확인하고, 지도 위 빈칸에 직접 입력합니다.",
  "각 빈칸은 서로 독립적으로 입력하고 제출 전까지 자유롭게 수정할 수 있습니다.",
  "다른 창 전환, 화면 이동, 멀티태스킹 시 응시는 자동 취소됩니다.",
];

const TONE_CLASS_NAME: Record<
  NonNullable<HistoryClassroomAssignmentViewProps["dueStatusTone"]>,
  string
> = {
  slate: "border-gray-200 bg-gray-100 text-gray-600",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
};

const MIN_VIEWPORT_USER_SCALE = 1;
const MAX_VIEWPORT_USER_SCALE = 4;
const VIEWPORT_FIT_PADDING = 24;
const BLANK_TEXT_HORIZONTAL_PADDING = 24;
const BLANK_TEXT_VERTICAL_PADDING = 4;
const BLANK_TEXT_MIN_FONT_SIZE = 3;
const BLANK_TEXT_MAX_FONT_SIZE = 22;
const BLANK_TEXT_LINE_HEIGHT_RATIO = 1.18;
const BLANK_TEXT_FONT_FAMILY = '"Noto Sans KR", sans-serif';
let blankTextMeasureContext: CanvasRenderingContext2D | null = null;

const getTimeProgressToneClass = (timeProgressPercent: number) =>
  timeProgressPercent <= 20
    ? "bg-red-500"
    : timeProgressPercent <= 50
      ? "bg-amber-500"
      : "bg-blue-500";

const getCountdownToneClass = (timeProgressPercent: number) =>
  timeProgressPercent <= 20
    ? "text-red-600"
    : timeProgressPercent <= 50
      ? "text-amber-700"
      : "text-gray-900";

const clampViewportUserScale = (value: number) =>
  Math.min(
    MAX_VIEWPORT_USER_SCALE,
    Math.max(MIN_VIEWPORT_USER_SCALE, Number(value.toFixed(3))),
  );

const getCenteredViewportOffset = (viewportSize: number, contentSize: number) =>
  Math.max(0, (viewportSize - contentSize) / 2);

const getBlankTextPaddingX = (pixelWidth: number) =>
  Math.max(2, Math.min(12, Math.floor(pixelWidth * 0.12)));

const getBlankTextPaddingY = (pixelHeight: number) =>
  Math.max(0, Math.min(3, Math.floor(pixelHeight * 0.08)));

const getBlankFontSize = (
  pixelWidth: number,
  pixelHeight: number,
  content: string,
) => {
  const safeContent = String(content || "").trim() || "가";
  const availableWidth = Math.max(
    1,
    pixelWidth -
      Math.min(
        BLANK_TEXT_HORIZONTAL_PADDING,
        getBlankTextPaddingX(pixelWidth) * 2,
      ),
  );
  const availableHeight = Math.max(
    1,
    pixelHeight -
      Math.min(
        BLANK_TEXT_VERTICAL_PADDING,
        getBlankTextPaddingY(pixelHeight) * 2,
      ),
  );
  const heightLimitedFontSize = Math.max(
    BLANK_TEXT_MIN_FONT_SIZE,
    Math.min(
      BLANK_TEXT_MAX_FONT_SIZE,
      Math.floor(availableHeight / BLANK_TEXT_LINE_HEIGHT_RATIO),
    ),
  );

  if (typeof document === "undefined") {
    const widthBasedEstimate =
      availableWidth / Math.max(1.1, safeContent.length * 0.9);
    return Math.max(
      BLANK_TEXT_MIN_FONT_SIZE,
      Math.min(heightLimitedFontSize, Math.floor(widthBasedEstimate)),
    );
  }

  if (!blankTextMeasureContext) {
    blankTextMeasureContext = document.createElement("canvas").getContext("2d");
  }

  const measureTextWidth = (fontSize: number) => {
    if (!blankTextMeasureContext) {
      return safeContent.length * fontSize * 0.9;
    }
    blankTextMeasureContext.font = `700 ${fontSize}px ${BLANK_TEXT_FONT_FAMILY}`;
    return blankTextMeasureContext.measureText(safeContent).width;
  };

  for (
    let fontSize = heightLimitedFontSize;
    fontSize >= BLANK_TEXT_MIN_FONT_SIZE;
    fontSize -= 1
  ) {
    if (measureTextWidth(fontSize) <= availableWidth) {
      return fontSize;
    }
  }

  return BLANK_TEXT_MIN_FONT_SIZE;
};

const getTouchDistance = (touches: React.TouchList) =>
  Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY,
  );

const getTouchCenter = (touches: React.TouchList) => ({
  x: (touches[0].clientX + touches[1].clientX) / 2,
  y: (touches[0].clientY + touches[1].clientY) / 2,
});

const isInteractiveFieldTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(target.closest("input, textarea, select, button, label"));

interface ViewportDragState {
  x: number;
  y: number;
  left: number;
  top: number;
}

interface ViewportPinchState {
  distance: number;
  userScale: number;
  contentAnchorX: number;
  contentAnchorY: number;
}

interface BlankRenderMetrics {
  blank: HistoryClassroomBlank;
  renderRect: ReturnType<typeof getHistoryClassroomBlankRenderRect>;
  answerValue: string;
  trimmedAnswerValue: string;
  placeholder: string;
  fontSize: number;
  chipWidth: number;
  chipHeight: number;
  textPaddingX: number;
  textPaddingY: number;
  isFilled: boolean;
  isInputLocked: boolean;
  reviewCorrect: boolean | null;
  reviewText: string;
}

interface BlankRenderPlacement extends BlankRenderMetrics {
  leftPx: number;
  topPx: number;
}

const BLANK_CYCLE_BUCKET_PX = 18;
const BLANK_CYCLE_WINDOW_MS = 1500;

const clampPixel = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getRectOverlapArea = (
  left: number,
  top: number,
  width: number,
  height: number,
  other: Pick<
    BlankRenderPlacement,
    "leftPx" | "topPx" | "chipWidth" | "chipHeight"
  >,
) => {
  const overlapWidth =
    Math.min(left + width, other.leftPx + other.chipWidth) -
    Math.max(left, other.leftPx);
  const overlapHeight =
    Math.min(top + height, other.topPx + other.chipHeight) -
    Math.max(top, other.topPx);

  if (overlapWidth <= 0 || overlapHeight <= 0) return 0;
  return overlapWidth * overlapHeight;
};

const sortPlacementsForFocus = (
  placements: BlankRenderPlacement[],
): BlankRenderPlacement[] =>
  [...placements].sort(
    (left, right) =>
      left.topPx - right.topPx ||
      left.leftPx - right.leftPx ||
      left.blank.id.localeCompare(right.blank.id, "ko"),
  );

const resolveBlankPlacements = ({
  metrics,
  displayWidth,
  displayHeight,
}: {
  metrics: BlankRenderMetrics[];
  displayWidth: number;
  displayHeight: number;
}) => {
  const placed: BlankRenderPlacement[] = [];

  [...metrics]
    .sort(
      (left, right) =>
        left.renderRect.topRatio - right.renderRect.topRatio ||
        left.renderRect.leftRatio - right.renderRect.leftRatio ||
        left.blank.id.localeCompare(right.blank.id, "ko"),
    )
    .forEach((entry) => {
      const baseCenterX =
        (entry.renderRect.leftRatio + entry.renderRect.widthRatio / 2) *
        displayWidth;
      const baseCenterY =
        (entry.renderRect.topRatio + entry.renderRect.heightRatio / 2) *
        displayHeight;
      const baseLeft = clampPixel(
        baseCenterX - entry.chipWidth / 2,
        0,
        Math.max(0, displayWidth - entry.chipWidth),
      );
      const baseTop = clampPixel(
        baseCenterY - entry.chipHeight / 2,
        0,
        Math.max(0, displayHeight - entry.chipHeight),
      );
      const stepX = Math.max(
        10,
        Math.min(26, Math.round(entry.chipWidth * 0.26)),
      );
      const stepY = Math.max(
        8,
        Math.min(22, Math.round(entry.chipHeight * 0.72)),
      );
      const candidateOffsets = [{ x: 0, y: 0 }];

      for (let radius = 1; radius <= 4; radius += 1) {
        const offsetX = stepX * radius;
        const offsetY = stepY * radius;
        candidateOffsets.push(
          { x: 0, y: offsetY },
          { x: 0, y: -offsetY },
          { x: offsetX, y: 0 },
          { x: -offsetX, y: 0 },
          { x: offsetX, y: offsetY },
          { x: -offsetX, y: offsetY },
          { x: offsetX, y: -offsetY },
          { x: -offsetX, y: -offsetY },
        );
      }

      let bestPlacement: BlankRenderPlacement | null = null;
      let bestScore = Number.POSITIVE_INFINITY;

      candidateOffsets.forEach((offset) => {
        const leftPx = clampPixel(
          baseLeft + offset.x,
          0,
          Math.max(0, displayWidth - entry.chipWidth),
        );
        const topPx = clampPixel(
          baseTop + offset.y,
          0,
          Math.max(0, displayHeight - entry.chipHeight),
        );
        const overlapArea = placed.reduce(
          (sum, other) =>
            sum +
            getRectOverlapArea(
              leftPx,
              topPx,
              entry.chipWidth,
              entry.chipHeight,
              other,
            ),
          0,
        );
        const distancePenalty =
          Math.abs(leftPx - baseLeft) * 0.35 + Math.abs(topPx - baseTop) * 0.55;
        const score = overlapArea * 10 + distancePenalty;

        if (score < bestScore) {
          bestScore = score;
          bestPlacement = {
            ...entry,
            leftPx,
            topPx,
          };
        }
      });

      placed.push(
        bestPlacement || {
          ...entry,
          leftPx: baseLeft,
          topPx: baseTop,
        },
      );
    });

  return placed;
};

const HistoryClassroomAssignmentView: React.FC<
  HistoryClassroomAssignmentViewProps
> = ({
  assignment,
  currentPage,
  onCurrentPageChange,
  answers,
  onAnswerChange,
  onSubmit,
  submitting = false,
  completed = false,
  readOnly = false,
  resultText = "",
  pointNotice = "",
  countdownLabel = null,
  timeProgressPercent = 100,
  dueStatusLabel = null,
  dueStatusTone = "slate",
  headerAction = null,
  helperItems = DEFAULT_HELPER_ITEMS,
  layoutVariant = "default",
  interactiveViewport = false,
  resolveBlankOverlap = false,
  answerChecks = [],
}) => {
  const isModalPreview = layoutVariant === "modalPreview";
  const showFloatingActions = !isModalPreview;
  const pageCount = assignment.pdfPageImages?.length || 1;
  const pageImage =
    assignment.pdfPageImages?.find((page) => page.page === currentPage) || null;
  const currentBlanks = assignment.blanks.filter(
    (blank) => blank.page === currentPage,
  );
  const currentTextRegions = (assignment.pdfRegions || []).filter(
    (region) => region.page === currentPage,
  );
  const normalizedAnsweredOptions = useMemo(() => {
    const answered = new Set<string>();

    Object.values(answers).forEach((value) => {
      const normalized = normalizeHistoryClassroomAnswer(value);
      if (normalized) {
        answered.add(normalized);
      }
    });

    return answered;
  }, [answers]);
  const answerCheckByBlankId = useMemo(
    () =>
      new Map(
        answerChecks.map((check) => [String(check.blankId || ""), check]),
      ),
    [answerChecks],
  );
  const isPointAwardedNotice = pointNotice.includes("+");
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const fitScaleRef = useRef(1);
  const userScaleRef = useRef(1);
  const totalScaleRef = useRef(1);
  const zoomFrameRef = useRef<number | null>(null);
  const dragStateRef = useRef<ViewportDragState | null>(null);
  const touchDragStateRef = useRef<ViewportDragState | null>(null);
  const pinchStateRef = useRef<ViewportPinchState | null>(null);
  const blankInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const overlapCycleRef = useRef<{
    idsKey: string;
    bucketKey: string;
    nextIndex: number;
    timestamp: number;
  } | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const [userScale, setUserScale] = useState(MIN_VIEWPORT_USER_SCALE);
  const [focusedBlankId, setFocusedBlankId] = useState("");
  const [floatingViewport, setFloatingViewport] = useState({
    offsetLeft: 0,
    offsetTop: 0,
    scale: 1,
  });

  const enableInteractiveViewport = interactiveViewport && Boolean(pageImage);
  const viewportHeight = useMemo(() => {
    if (isModalPreview) return null;
    if (!pageImage) return "clamp(18rem, 56vh, 34rem)";
    return pageImage.height > pageImage.width
      ? "clamp(20rem, 62vh, 38rem)"
      : "clamp(18rem, 54vh, 32rem)";
  }, [isModalPreview, pageImage]);
  const totalScale = enableInteractiveViewport ? fitScale * userScale : 1;
  const scaledPageWidth = pageImage ? pageImage.width * totalScale : 0;
  const scaledPageHeight = pageImage ? pageImage.height * totalScale : 0;
  const canPanViewport = enableInteractiveViewport && userScale > 1.01;
  const displayZoomPercent = Math.max(100, Math.round(userScale * 100));
  const displayWidth = pageImage?.width || 0;
  const displayHeight = pageImage?.height || 0;
  const blankPlacements = useMemo(() => {
    if (!pageImage || !displayWidth || !displayHeight) {
      return [];
    }

    const metrics = currentBlanks.map((blank) => {
      const renderRect = getHistoryClassroomBlankRenderRect(
        blank,
        pageImage,
        currentTextRegions,
      );
      const pixelWidth = renderRect.widthRatio * displayWidth;
      const pixelHeight = renderRect.heightRatio * displayHeight;
      const textPixelWidth = pixelWidth;
      const textPixelHeight = pixelHeight;
      const answerValue = String(answers[blank.id] || "");
      const trimmedAnswerValue = answerValue.trim();
      const placeholder = blank.prompt || "정답 입력";
      const answerCheck = answerCheckByBlankId.get(blank.id);
      const reviewCorrect =
        answerCheck?.correct ??
        (answerChecks.length
          ? isHistoryClassroomBlankCorrect(answerValue, blank.answer)
          : null);
      const reviewText =
        answerCheck && !answerCheck.correct
          ? String(answerCheck.correctAnswer || blank.answer || "")
          : "";
      const displayValue = reviewText || trimmedAnswerValue || placeholder;
      const fontSize = getBlankFontSize(
        textPixelWidth,
        textPixelHeight,
        displayValue,
      );
      const textPaddingX = getBlankTextPaddingX(textPixelWidth);
      const textPaddingY = getBlankTextPaddingY(textPixelHeight);
      const isFilled = Boolean(trimmedAnswerValue);
      const isInputLocked =
        readOnly || completed || submitting || !onAnswerChange;

      return {
        blank,
        renderRect,
        answerValue,
        trimmedAnswerValue,
        placeholder,
        fontSize,
        chipWidth: pixelWidth,
        chipHeight: pixelHeight,
        textPaddingX,
        textPaddingY,
        isFilled,
        isInputLocked,
        reviewCorrect,
        reviewText,
      };
    });

    if (!resolveBlankOverlap) {
      return metrics.map((entry) => {
        return {
          ...entry,
          leftPx: entry.renderRect.leftRatio * displayWidth,
          topPx: entry.renderRect.topRatio * displayHeight,
        };
      });
    }

    return resolveBlankPlacements({
      metrics,
      displayWidth,
      displayHeight,
    });
  }, [
    answers,
    answerCheckByBlankId,
    answerChecks.length,
    completed,
    currentBlanks,
    currentTextRegions,
    displayHeight,
    displayWidth,
    onAnswerChange,
    pageImage,
    readOnly,
    resolveBlankOverlap,
    submitting,
  ]);
  const orderedBlankPlacements = useMemo(
    () => sortPlacementsForFocus(blankPlacements),
    [blankPlacements],
  );

  useEffect(() => {
    fitScaleRef.current = fitScale;
  }, [fitScale]);

  useEffect(() => {
    userScaleRef.current = userScale;
  }, [userScale]);

  useEffect(() => {
    totalScaleRef.current = totalScale;
  }, [totalScale]);

  useEffect(
    () => () => {
      if (zoomFrameRef.current !== null) {
        window.cancelAnimationFrame(zoomFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!showFloatingActions) return undefined;

    const updateFloatingViewport = () => {
      const viewport = window.visualViewport;
      setFloatingViewport({
        offsetLeft: viewport?.offsetLeft || 0,
        offsetTop: viewport?.offsetTop || 0,
        scale: Math.max(1, viewport?.scale || 1),
      });
    };

    updateFloatingViewport();
    window.visualViewport?.addEventListener("resize", updateFloatingViewport);
    window.visualViewport?.addEventListener("scroll", updateFloatingViewport);
    window.addEventListener("resize", updateFloatingViewport);

    return () => {
      window.visualViewport?.removeEventListener(
        "resize",
        updateFloatingViewport,
      );
      window.visualViewport?.removeEventListener(
        "scroll",
        updateFloatingViewport,
      );
      window.removeEventListener("resize", updateFloatingViewport);
    };
  }, [showFloatingActions]);

  useEffect(() => {
    setUserScale(MIN_VIEWPORT_USER_SCALE);
    dragStateRef.current = null;
    touchDragStateRef.current = null;
    pinchStateRef.current = null;
    overlapCycleRef.current = null;
    setFocusedBlankId("");
    viewportRef.current?.scrollTo({ left: 0, top: 0 });
  }, [assignment.id, currentPage]);

  useLayoutEffect(() => {
    if (!enableInteractiveViewport || !viewportRef.current || !pageImage) {
      setFitScale(1);
      return undefined;
    }

    const viewport = viewportRef.current;
    const updateFitScale = () => {
      const availableWidth = Math.max(
        0,
        viewport.clientWidth - VIEWPORT_FIT_PADDING,
      );
      const availableHeight = Math.max(
        0,
        viewport.clientHeight - VIEWPORT_FIT_PADDING,
      );
      if (!availableWidth || !availableHeight) return;

      const nextFitScale = Math.min(
        1,
        Math.max(
          0.22,
          Math.min(
            availableWidth / Math.max(pageImage.width, 1),
            availableHeight / Math.max(pageImage.height, 1),
          ),
        ),
      );

      setFitScale(nextFitScale);
      if (userScaleRef.current <= 1.01) {
        viewport.scrollTo({ left: 0, top: 0 });
      }
    };

    updateFitScale();
    const frameId = window.requestAnimationFrame(updateFitScale);
    const observer = new ResizeObserver(updateFitScale);
    observer.observe(viewport);
    window.addEventListener("resize", updateFitScale);

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener("resize", updateFitScale);
    };
  }, [enableInteractiveViewport, pageImage]);

  const clearViewportGestureState = () => {
    dragStateRef.current = null;
    touchDragStateRef.current = null;
    pinchStateRef.current = null;
  };

  const applyViewportScale = (
    nextUserScale: number,
    options?: {
      anchorClientX?: number;
      anchorClientY?: number;
      contentAnchorX?: number;
      contentAnchorY?: number;
    },
  ) => {
    const clampedUserScale = clampViewportUserScale(nextUserScale);
    const viewport = viewportRef.current;
    if (!viewport || !pageImage) {
      setUserScale(clampedUserScale);
      return;
    }

    const rect = viewport.getBoundingClientRect();
    const anchorClientX = options?.anchorClientX ?? rect.left + rect.width / 2;
    const anchorClientY = options?.anchorClientY ?? rect.top + rect.height / 2;
    const localX = anchorClientX - rect.left;
    const localY = anchorClientY - rect.top;
    const currentScale = Math.max(totalScaleRef.current, 0.001);
    const currentContentWidth = pageImage.width * currentScale;
    const currentContentHeight = pageImage.height * currentScale;
    const currentOffsetX = getCenteredViewportOffset(
      viewport.clientWidth,
      currentContentWidth,
    );
    const currentOffsetY = getCenteredViewportOffset(
      viewport.clientHeight,
      currentContentHeight,
    );
    const contentAnchorX =
      options?.contentAnchorX ??
      (viewport.scrollLeft + localX - currentOffsetX) / currentScale;
    const contentAnchorY =
      options?.contentAnchorY ??
      (viewport.scrollTop + localY - currentOffsetY) / currentScale;

    setUserScale(clampedUserScale);

    if (zoomFrameRef.current !== null) {
      window.cancelAnimationFrame(zoomFrameRef.current);
    }

    zoomFrameRef.current = window.requestAnimationFrame(() => {
      zoomFrameRef.current = null;
      const nextViewport = viewportRef.current;
      if (!nextViewport) return;
      const nextTotalScale = fitScaleRef.current * clampedUserScale;
      const nextContentWidth = pageImage.width * nextTotalScale;
      const nextContentHeight = pageImage.height * nextTotalScale;
      const nextOffsetX = getCenteredViewportOffset(
        nextViewport.clientWidth,
        nextContentWidth,
      );
      const nextOffsetY = getCenteredViewportOffset(
        nextViewport.clientHeight,
        nextContentHeight,
      );
      nextViewport.scrollLeft = Math.max(
        0,
        contentAnchorX * nextTotalScale - localX + nextOffsetX,
      );
      nextViewport.scrollTop = Math.max(
        0,
        contentAnchorY * nextTotalScale - localY + nextOffsetY,
      );
    });
  };

  const nudgeViewportZoom = (
    delta: number,
    options?: {
      anchorClientX?: number;
      anchorClientY?: number;
    },
  ) => {
    applyViewportScale(userScaleRef.current + delta, options);
  };

  const resetViewportScale = () => {
    clearViewportGestureState();
    if (zoomFrameRef.current !== null) {
      window.cancelAnimationFrame(zoomFrameRef.current);
      zoomFrameRef.current = null;
    }
    setUserScale(MIN_VIEWPORT_USER_SCALE);
    window.requestAnimationFrame(() => {
      viewportRef.current?.scrollTo({ left: 0, top: 0, behavior: "smooth" });
    });
  };

  const handleViewportWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!enableInteractiveViewport || isInteractiveFieldTarget(event.target)) {
      return;
    }
    event.preventDefault();
    nudgeViewportZoom(event.deltaY < 0 ? 0.16 : -0.16, {
      anchorClientX: event.clientX,
      anchorClientY: event.clientY,
    });
  };

  const handleViewportMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (
      !canPanViewport ||
      event.button !== 0 ||
      !viewportRef.current ||
      isInteractiveFieldTarget(event.target)
    ) {
      return;
    }
    event.preventDefault();
    dragStateRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: viewportRef.current.scrollLeft,
      top: viewportRef.current.scrollTop,
    };
  };

  const handleViewportMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!viewportRef.current || !dragStateRef.current) return;
    event.preventDefault();
    viewportRef.current.scrollLeft =
      dragStateRef.current.left - (event.clientX - dragStateRef.current.x);
    viewportRef.current.scrollTop =
      dragStateRef.current.top - (event.clientY - dragStateRef.current.y);
  };

  const handleViewportTouchStart = (
    event: React.TouchEvent<HTMLDivElement>,
  ) => {
    if (!enableInteractiveViewport || !viewportRef.current || !pageImage)
      return;
    if (event.touches.length === 2) {
      const distance = getTouchDistance(event.touches);
      const center = getTouchCenter(event.touches);
      const viewportRect = viewportRef.current.getBoundingClientRect();
      const currentScale = Math.max(totalScaleRef.current, 0.001);
      const currentContentWidth = pageImage.width * currentScale;
      const currentContentHeight = pageImage.height * currentScale;
      const currentOffsetX = getCenteredViewportOffset(
        viewportRef.current.clientWidth,
        currentContentWidth,
      );
      const currentOffsetY = getCenteredViewportOffset(
        viewportRef.current.clientHeight,
        currentContentHeight,
      );
      event.preventDefault();
      pinchStateRef.current = {
        distance,
        userScale: userScaleRef.current,
        contentAnchorX:
          (viewportRef.current.scrollLeft +
            (center.x - viewportRect.left) -
            currentOffsetX) /
          currentScale,
        contentAnchorY:
          (viewportRef.current.scrollTop +
            (center.y - viewportRect.top) -
            currentOffsetY) /
          currentScale,
      };
      touchDragStateRef.current = null;
      return;
    }

    if (
      event.touches.length === 1 &&
      canPanViewport &&
      !isInteractiveFieldTarget(event.target)
    ) {
      const touch = event.touches[0];
      touchDragStateRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        left: viewportRef.current.scrollLeft,
        top: viewportRef.current.scrollTop,
      };
    }
  };

  const handleViewportTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!viewportRef.current || !pageImage) return;
    if (event.touches.length === 2 && pinchStateRef.current) {
      const nextDistance = getTouchDistance(event.touches);
      const center = getTouchCenter(event.touches);
      event.preventDefault();
      applyViewportScale(
        pinchStateRef.current.userScale *
          (nextDistance / pinchStateRef.current.distance),
        {
          anchorClientX: center.x,
          anchorClientY: center.y,
          contentAnchorX: pinchStateRef.current.contentAnchorX,
          contentAnchorY: pinchStateRef.current.contentAnchorY,
        },
      );
      return;
    }

    if (event.touches.length === 1 && touchDragStateRef.current) {
      const touch = event.touches[0];
      event.preventDefault();
      viewportRef.current.scrollLeft =
        touchDragStateRef.current.left -
        (touch.clientX - touchDragStateRef.current.x);
      viewportRef.current.scrollTop =
        touchDragStateRef.current.top -
        (touch.clientY - touchDragStateRef.current.y);
    }
  };

  const handleBlankStackPointerDownCapture = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (
      completed ||
      submitting ||
      readOnly ||
      !onAnswerChange ||
      orderedBlankPlacements.length < 2
    ) {
      return;
    }

    const containerRect = event.currentTarget.getBoundingClientRect();
    const pointerScale = Math.max(0.001, totalScaleRef.current);
    const localX = (event.clientX - containerRect.left) / pointerScale;
    const localY = (event.clientY - containerRect.top) / pointerScale;
    const hitPlacements = sortPlacementsForFocus(
      orderedBlankPlacements.filter(
        (placement) =>
          localX >= placement.leftPx &&
          localX <= placement.leftPx + placement.chipWidth &&
          localY >= placement.topPx &&
          localY <= placement.topPx + placement.chipHeight,
      ),
    );

    if (hitPlacements.length < 2) return;

    const ids = hitPlacements.map((placement) => placement.blank.id);
    const idsKey = ids.join("|");
    const bucketKey = `${Math.round(localX / BLANK_CYCLE_BUCKET_PX)}:${Math.round(localY / BLANK_CYCLE_BUCKET_PX)}`;
    const previousCycle = overlapCycleRef.current;
    const isRepeatedOverlapClick =
      previousCycle?.idsKey === idsKey &&
      previousCycle.bucketKey === bucketKey &&
      Date.now() - previousCycle.timestamp < BLANK_CYCLE_WINDOW_MS;

    if (!isRepeatedOverlapClick) {
      overlapCycleRef.current = {
        idsKey,
        bucketKey,
        nextIndex: 1 % ids.length,
        timestamp: Date.now(),
      };
      return;
    }

    const currentIndex = focusedBlankId ? ids.indexOf(focusedBlankId) : -1;
    const nextIndex =
      currentIndex >= 0
        ? (currentIndex + 1) % ids.length
        : previousCycle.nextIndex % ids.length;

    overlapCycleRef.current = {
      idsKey,
      bucketKey,
      nextIndex: (nextIndex + 1) % ids.length,
      timestamp: Date.now(),
    };

    const nextBlankId = ids[nextIndex];
    event.preventDefault();
    event.stopPropagation();
    setFocusedBlankId(nextBlankId);
    window.requestAnimationFrame(() => {
      const input = blankInputRefs.current[nextBlankId];
      input?.focus({ preventScroll: true });
      input?.select();
    });
  };

  return (
    <div
      className={
        isModalPreview
          ? "mx-auto w-full max-w-[108rem] px-5 py-5 lg:px-6"
          : "mx-auto max-w-6xl px-4 pt-32 pb-12 sm:pt-28 sm:pb-14 lg:px-5"
      }
    >
      <div
        className={`rounded-3xl border border-gray-200 bg-white shadow-sm ${
          isModalPreview ? "mb-4 p-5" : "mb-5 p-6"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-bold text-orange-500">역사교실</div>
            <h1 className="mt-1 break-words text-3xl font-black text-gray-900">
              {assignment.title}
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              {assignment.description || "설명이 없습니다."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600">
                통과 기준 {assignment.passThresholdPercent}% 이상
              </span>
              {dueStatusLabel && (
                <span
                  className={`rounded-full border px-3 py-1 text-[11px] font-bold ${
                    TONE_CLASS_NAME[dueStatusTone]
                  }`}
                >
                  {dueStatusLabel}
                </span>
              )}
            </div>
          </div>
          {headerAction && <div className="min-w-[11rem]">{headerAction}</div>}
        </div>

        {isModalPreview &&
          assignment.timeLimitMinutes > 0 &&
          countdownLabel && (
            <div className="mt-4 max-w-md">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs font-bold text-gray-500">
                <span>제한 시간</span>
                <span>{countdownLabel}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-gray-200">
                <div
                  className={`h-full rounded-full transition-[width] duration-1000 ${getTimeProgressToneClass(
                    timeProgressPercent,
                  )}`}
                  style={{ width: `${timeProgressPercent}%` }}
                />
              </div>
            </div>
          )}
      </div>

      <div
        className={
          isModalPreview
            ? "grid gap-4 lg:grid-cols-[minmax(0,1.46fr)_18rem] xl:grid-cols-[minmax(0,1.7fr)_19.5rem]"
            : "grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]"
        }
      >
        <section
          className={`rounded-3xl border border-gray-200 bg-white shadow-sm ${
            isModalPreview ? "flex min-h-[42rem] flex-col p-4 lg:p-5" : "p-4"
          }`}
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-bold text-gray-600">
              페이지 {currentPage} / {pageCount}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {enableInteractiveViewport && (
                <>
                  <div className="hidden rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-500 sm:block">
                    {displayZoomPercent}%
                  </div>
                  <button
                    type="button"
                    onClick={() => nudgeViewportZoom(-0.18)}
                    disabled={userScale <= MIN_VIEWPORT_USER_SCALE}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-40"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    onClick={resetViewportScale}
                    disabled={userScale <= MIN_VIEWPORT_USER_SCALE}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-40"
                  >
                    전체 보기
                  </button>
                  <button
                    type="button"
                    onClick={() => nudgeViewportZoom(0.18)}
                    disabled={userScale >= MAX_VIEWPORT_USER_SCALE}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-40"
                  >
                    +
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() =>
                  onCurrentPageChange(Math.max(1, currentPage - 1))
                }
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-40"
              >
                이전
              </button>
              <button
                type="button"
                disabled={currentPage >= pageCount}
                onClick={() =>
                  onCurrentPageChange(Math.min(pageCount, currentPage + 1))
                }
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-40"
              >
                다음
              </button>
            </div>
          </div>

          {pageImage && (
            <div
              className={`rounded-3xl border border-gray-200 bg-gray-100 ${
                isModalPreview
                  ? "flex-1 min-h-[38rem] overflow-auto p-4 lg:min-h-[46rem]"
                  : "overflow-hidden p-3 sm:p-4"
              }`}
              style={
                !isModalPreview && viewportHeight
                  ? { height: viewportHeight }
                  : undefined
              }
            >
              {!isModalPreview && (
                <div className="mb-3 text-xs font-medium text-gray-500">
                  첫 화면에서는 전체 지도와 빈칸 분포를 먼저 확인하고, 확대가
                  필요하면 휠 또는 핀치로 조절하세요.
                </div>
              )}
              <div
                ref={enableInteractiveViewport ? viewportRef : undefined}
                className="h-full min-h-0 overflow-auto"
                style={
                  enableInteractiveViewport
                    ? {
                        touchAction: enableInteractiveViewport
                          ? "none"
                          : "auto",
                        overscrollBehavior: "contain",
                      }
                    : undefined
                }
                onWheel={
                  enableInteractiveViewport ? handleViewportWheel : undefined
                }
                onMouseDown={
                  enableInteractiveViewport
                    ? handleViewportMouseDown
                    : undefined
                }
                onMouseMove={
                  enableInteractiveViewport
                    ? handleViewportMouseMove
                    : undefined
                }
                onMouseUp={
                  enableInteractiveViewport
                    ? clearViewportGestureState
                    : undefined
                }
                onMouseLeave={
                  enableInteractiveViewport
                    ? clearViewportGestureState
                    : undefined
                }
                onTouchStart={
                  enableInteractiveViewport
                    ? handleViewportTouchStart
                    : undefined
                }
                onTouchMove={
                  enableInteractiveViewport
                    ? handleViewportTouchMove
                    : undefined
                }
                onTouchEnd={
                  enableInteractiveViewport
                    ? clearViewportGestureState
                    : undefined
                }
                onTouchCancel={
                  enableInteractiveViewport
                    ? clearViewportGestureState
                    : undefined
                }
              >
                <div
                  className={`flex min-h-full min-w-full ${
                    enableInteractiveViewport && !canPanViewport
                      ? "items-center justify-center"
                      : "items-start justify-start"
                  }`}
                >
                  <div
                    className={`relative shrink-0 overflow-hidden ${
                      enableInteractiveViewport && canPanViewport
                        ? "cursor-grab active:cursor-grabbing"
                        : ""
                    } ${isModalPreview ? "mx-auto" : ""}`}
                    style={{
                      width: `${
                        enableInteractiveViewport || !isModalPreview
                          ? scaledPageWidth
                          : pageImage.width
                      }px`,
                      height: `${
                        enableInteractiveViewport || !isModalPreview
                          ? scaledPageHeight
                          : pageImage.height
                      }px`,
                    }}
                  >
                    <div
                      className="relative"
                      onPointerDownCapture={handleBlankStackPointerDownCapture}
                      style={{
                        width: `${pageImage.width}px`,
                        height: `${pageImage.height}px`,
                        transform: `scale(${totalScale})`,
                        transformOrigin: "top left",
                      }}
                    >
                      <img
                        src={pageImage.imageUrl}
                        alt={`${assignment.title} ${currentPage}`}
                        className="block h-full w-full"
                        loading="lazy"
                        decoding="async"
                        style={{ maxWidth: "none" }}
                      />
                      {orderedBlankPlacements.map((placement) => {
                        const {
                          blank,
                          answerValue,
                          trimmedAnswerValue,
                          fontSize,
                          chipWidth,
                          chipHeight,
                          textPaddingX,
                          textPaddingY,
                          isFilled,
                          isInputLocked,
                          reviewCorrect,
                          reviewText,
                          leftPx,
                          topPx,
                        } = placement;
                        const isFocused = focusedBlankId === blank.id;
                        const hasReview = reviewCorrect !== null;
                        const reviewToneClass = hasReview
                          ? reviewCorrect
                            ? "border-emerald-500 text-emerald-900 ring-2 ring-emerald-200"
                            : "border-rose-500 text-rose-900 ring-2 ring-rose-200"
                          : isFilled
                            ? "border-orange-300 text-orange-800"
                            : "border-slate-300 text-slate-700";
                        const placeholder = blank.prompt || "정답 입력";
                        const lockedDisplayText =
                          reviewText || trimmedAnswerValue || placeholder;
                        return (
                          <div
                            key={blank.id}
                            className={`absolute overflow-hidden rounded-xl border text-left font-bold shadow-[0_6px_18px_rgba(15,23,42,0.12)] transition-colors focus-within:border-orange-400 focus-within:ring-2 focus-within:ring-orange-200 ${
                              isFocused ? "z-20" : "z-10"
                            } ${reviewToneClass}`}
                            title={
                              hasReview
                                ? reviewCorrect
                                  ? "Correct"
                                  : `Wrong. Correct answer: ${reviewText || blank.answer}`
                                : undefined
                            }
                            style={{
                              left: `${leftPx}px`,
                              top: `${topPx}px`,
                              width: `${chipWidth}px`,
                              height: `${chipHeight}px`,
                              backgroundColor: "#ffffff",
                              opacity: 1,
                            }}
                          >
                            {isInputLocked ? (
                              <span
                                aria-hidden
                                className={`absolute inset-0 ${
                                  hasReview
                                    ? reviewCorrect
                                      ? "bg-emerald-50"
                                      : "bg-rose-50"
                                    : isFilled
                                      ? "bg-orange-50"
                                      : "bg-white"
                                }`}
                              />
                            ) : null}
                            {isInputLocked ? (
                              <span
                                className="relative z-[1] flex h-full w-full items-center justify-center overflow-hidden whitespace-nowrap text-center"
                                style={{
                                  fontSize: `${fontSize}px`,
                                  letterSpacing: 0,
                                  lineHeight: BLANK_TEXT_LINE_HEIGHT_RATIO,
                                  padding: `${textPaddingY}px ${textPaddingX}px`,
                                }}
                              >
                                {lockedDisplayText}
                              </span>
                            ) : (
                              <input
                                type="text"
                                ref={(node) => {
                                  blankInputRefs.current[blank.id] = node;
                                }}
                                value={answerValue}
                                onChange={(event) =>
                                  onAnswerChange?.(blank.id, event.target.value)
                                }
                                onFocus={() => setFocusedBlankId(blank.id)}
                                readOnly={isInputLocked}
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck={false}
                                inputMode="text"
                                lang="ko"
                                aria-label={
                                  blank.prompt || `${blank.id} 답안 입력`
                                }
                                placeholder={placeholder}
                                className={`relative z-[1] h-full w-full border-0 bg-transparent text-center font-bold outline-none ${
                                  isFilled
                                    ? "text-orange-800 placeholder:text-orange-300"
                                    : "text-slate-700 placeholder:text-slate-400"
                                }`}
                                style={{
                                  fontSize: `${fontSize}px`,
                                  letterSpacing: 0,
                                  lineHeight: "normal",
                                  padding: `${textPaddingY}px ${textPaddingX}px`,
                                  touchAction: "none",
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        <aside
          className={
            isModalPreview
              ? "self-start space-y-3 lg:sticky lg:top-5"
              : "space-y-4"
          }
        >
          <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-bold text-gray-700">참고 보기</div>
            <div className="mt-2 text-xs font-bold text-gray-500">
              보기는 참고만 하고, 정답은 지도 위 빈칸에 직접 입력하세요.
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {assignment.answerOptions.map((option) => {
                const normalizedOption =
                  normalizeHistoryClassroomAnswer(option);
                const isAnswered =
                  Boolean(normalizedOption) &&
                  normalizedAnsweredOptions.has(normalizedOption);

                return (
                  <span
                    key={option}
                    className={`inline-flex max-w-full items-center rounded-full px-3 py-2 text-sm font-bold transition-colors ${
                      isAnswered
                        ? "border border-orange-300 bg-orange-50 text-orange-800 shadow-sm"
                        : "border border-gray-200 bg-gray-100 text-gray-700"
                    }`}
                  >
                    <span className="whitespace-nowrap">{option}</span>
                  </span>
                );
              })}
            </div>
            {!assignment.answerOptions.length && (
              <div className="mt-3 rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                등록된 참고 보기가 없습니다.
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-bold text-gray-700">안내</div>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-gray-600">
              {helperItems.map((item, index) => (
                <li key={`${item}-${index}`}>
                  {index + 1}. {item}
                </li>
              ))}
            </ul>
            {isModalPreview && (
              <button
                type="button"
                onClick={onSubmit}
                disabled={readOnly || submitting || completed || !onSubmit}
                className="mt-5 w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {readOnly
                  ? "읽기 전용 미리보기"
                  : submitting
                    ? "제출 중..."
                    : completed
                      ? "제출 완료"
                      : "제출하기"}
              </button>
            )}
            {resultText && (
              <div className="mt-3 text-sm font-bold text-blue-700">
                {resultText}
              </div>
            )}
            {pointNotice && (
              <div
                className={`mt-3 text-sm font-bold ${
                  isPointAwardedNotice ? "text-emerald-700" : "text-amber-700"
                }`}
              >
                {pointNotice}
              </div>
            )}
          </div>
        </aside>
      </div>

      {showFloatingActions && (
        <div
          className="pointer-events-none fixed z-[140] flex max-w-[calc(100vw-2rem)] justify-start sm:max-w-[22rem]"
          style={{
            top: `calc(env(safe-area-inset-top, 0px) + ${floatingViewport.offsetTop + 12}px)`,
            left: `calc(env(safe-area-inset-left, 0px) + ${floatingViewport.offsetLeft + 12}px)`,
            transform: `scale(${1 / floatingViewport.scale})`,
            transformOrigin: "top left",
          }}
        >
          <div className="pointer-events-auto w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-[0_20px_45px_-24px_rgba(15,23,42,0.35)] backdrop-blur">
            {assignment.timeLimitMinutes > 0 && countdownLabel && (
              <div className="rounded-xl bg-gray-50 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3 text-[11px] font-bold tracking-[0.18em] text-gray-400">
                  <span>남은 시간</span>
                  <span
                    className={`font-mono text-xl leading-none ${getCountdownToneClass(
                      timeProgressPercent,
                    )}`}
                  >
                    {countdownLabel}
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200">
                  <div
                    className={`h-full rounded-full transition-[width] duration-1000 ${getTimeProgressToneClass(
                      timeProgressPercent,
                    )}`}
                    style={{ width: `${timeProgressPercent}%` }}
                  />
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={onSubmit}
              disabled={readOnly || submitting || completed || !onSubmit}
              className="mt-2 min-h-10 w-full rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {readOnly
                ? "읽기 전용 미리보기"
                : submitting
                  ? "제출 중..."
                  : completed
                    ? "제출 완료"
                    : "제출하기"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default HistoryClassroomAssignmentView;
