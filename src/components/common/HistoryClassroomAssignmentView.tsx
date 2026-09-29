import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import WorksheetBlankInput from "./WorksheetBlankInput";
import HistoryBlankFeedback from "./HistoryBlankFeedback";
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
  answersLocked?: boolean;
  submitLabel?: string;
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
  hintUseCount?: number;
  onUseHint?: () => boolean;
}

const DEFAULT_HELPER_ITEMS = [
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
  chipWidth: number;
  chipHeight: number;
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
  answersLocked = false,
  submitLabel = "제출하기",
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
  hintUseCount,
  onUseHint,
}) => {
  const isModalPreview = layoutVariant === "modalPreview";
  const pages = assignment.pdfPageImages || [];
  const pageCount = pages.length;
  const currentPageIndex = pages.findIndex((page) => page.page === currentPage);
  const lessonPath =
    assignment.sourceType === "lesson"
      ? assignment.lessonUnitPath?.join(" > ") || assignment.lessonTitle
      : "";
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [modalAvailableHeight, setModalAvailableHeight] = useState(0);
  const helpButtonRef = useRef<HTMLButtonElement | null>(null);
  const helpPopoverRef = useRef<HTMLDivElement | null>(null);
  const helpId = useId();
  const [helpOpen, setHelpOpen] = useState(false);
  const showHelp = !readOnly && !completed && helperItems.length > 0;
  const hintButtonRef = useRef<HTMLButtonElement | null>(null);
  const hintPopupRef = useRef<HTMLDivElement | null>(null);
  const hintCloseRef = useRef<HTMLButtonElement | null>(null);
  const hintDeadlineRef = useRef(0);
  const localHintCountRef = useRef(0);
  const [localHintCount, setLocalHintCount] = useState(0);
  const [hintOpen, setHintOpen] = useState(false);
  const [hintRemainingMs, setHintRemainingMs] = useState(5000);
  const hintId = useId();
  const hintCount = Math.max(0, Math.min(3, hintUseCount ?? localHintCount));
  const hintAvailable = !readOnly && !completed && !answersLocked;
  const remainingOptions = assignment.answerOptions.filter((option) => {
    const matchingBlanks = assignment.blanks.filter((blank) =>
      isHistoryClassroomBlankCorrect(option, blank.answer),
    );
    return (
      !matchingBlanks.length ||
      matchingBlanks.some(
        (blank) =>
          !isHistoryClassroomBlankCorrect(
            answers[blank.id] || "",
            blank.answer,
          ),
      )
    );
  });
  const closeHint = () => {
    const restoreFocus = hintPopupRef.current?.contains(document.activeElement);
    hintDeadlineRef.current = 0;
    setHintOpen(false);
    if (restoreFocus) hintButtonRef.current?.focus();
  };
  const openHint = () => {
    if (
      !hintAvailable ||
      submitting ||
      hintDeadlineRef.current ||
      hintCount >= 3 ||
      !remainingOptions.length
    )
      return;
    if (onUseHint) {
      if (!onUseHint()) return;
    } else {
      if (localHintCountRef.current >= 3) return;
      localHintCountRef.current += 1;
      setLocalHintCount(localHintCountRef.current);
    }
    setHelpOpen(false);
    hintDeadlineRef.current = Date.now() + 5000;
    setHintRemainingMs(5000);
    setHintOpen(true);
  };
  useEffect(() => {
    localHintCountRef.current = 0;
    setLocalHintCount(0);
    closeHint();
  }, [assignment.id]);
  useEffect(() => {
    if (!hintAvailable || submitting) closeHint();
  }, [hintAvailable, submitting]);
  useEffect(() => {
    if (!hintOpen) return;
    hintCloseRef.current?.focus();
    const tick = () => {
      const remaining = Math.max(0, hintDeadlineRef.current - Date.now());
      setHintRemainingMs(remaining);
      if (!remaining) closeHint();
    };
    const outside = (event: PointerEvent) => {
      if (
        !hintPopupRef.current?.contains(event.target as Node) &&
        !hintButtonRef.current?.contains(event.target as Node)
      )
        closeHint();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeHint();
      }
    };
    const interval = window.setInterval(tick, 100);
    const timeout = window.setTimeout(closeHint, 5000);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [hintOpen]);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [toolbarHeight, setToolbarHeight] = useState(144);
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
  const [blankFeedback, setBlankFeedback] = useState<{
    blankId: string;
    correct: boolean;
    sequence: number;
  } | null>(null);
  const feedbackSequenceRef = useRef(0);
  const composingBlankIdsRef = useRef(new Set<string>());
  const deferredBlurIdsRef = useRef(new Set<string>());
  const feedbackEnabled =
    !readOnly &&
    !answersLocked &&
    !completed &&
    !submitting &&
    !!onAnswerChange;
  const showBlankFeedback = (blank: HistoryClassroomBlank, value: string) => {
    if (!feedbackEnabled || !value.trim()) return;
    setBlankFeedback({
      blankId: blank.id,
      correct: isHistoryClassroomBlankCorrect(value, blank.answer),
      sequence: ++feedbackSequenceRef.current,
    });
  };
  useEffect(() => {
    if (!blankFeedback) return;
    const timer = window.setTimeout(() => setBlankFeedback(null), 1200);
    return () => window.clearTimeout(timer);
  }, [blankFeedback]);
  useEffect(() => {
    setBlankFeedback(null);
    composingBlankIdsRef.current.clear();
    deferredBlurIdsRef.current.clear();
  }, [assignment.id, currentPage, feedbackEnabled]);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [imageRetry, setImageRetry] = useState(0);
  const [floatingViewport, setFloatingViewport] = useState({
    offsetLeft: 0,
    offsetTop: 0,
    width: typeof window === "undefined" ? 0 : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight,
    scale: 1,
  });

  const enableInteractiveViewport =
    (interactiveViewport || isModalPreview) && Boolean(pageImage);
  useLayoutEffect(() => {
    if (!isModalPreview) return;
    const container = containerRef.current?.parentElement;
    if (!container) return;
    const measure = () => {
      if (container.clientHeight > 0)
        setModalAvailableHeight(container.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [isModalPreview]);
  useEffect(() => {
    if (!showHelp) setHelpOpen(false);
  }, [showHelp]);
  useEffect(() => {
    if (!helpOpen) return;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (
        !helpButtonRef.current?.contains(target) &&
        !helpPopoverRef.current?.contains(target)
      )
        setHelpOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHelpOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [helpOpen]);
  useEffect(() => {
    // Warm subsequent pages while connected so paging can survive brief Wi-Fi loss.
    const images = (assignment.pdfPageImages || []).map((page) => {
      const image = new Image();
      image.src = page.imageUrl;
      return image;
    });
    return () =>
      images.forEach((image) => {
        image.onload = null;
        image.onerror = null;
      });
  }, [assignment.id, assignment.pdfPageImages]);

  useEffect(() => {
    setImageLoadError(false);
  }, [currentPage, pageImage?.imageUrl]);

  useEffect(() => {
    const retry = () => {
      if (imageLoadError) {
        setImageLoadError(false);
        setImageRetry((value) => value + 1);
      }
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [imageLoadError]);
  const viewportHeight = Math.min(
    1000,
    Math.max(
      160,
      (isModalPreview
        ? modalAvailableHeight || floatingViewport.height * 0.9 - 80
        : floatingViewport.height) -
        toolbarHeight -
        32,
    ),
  );
  const answeredCount = assignment.blanks.filter((blank) =>
    String(answers[blank.id] || "").trim(),
  ).length;
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const measure = () =>
      setToolbarHeight(toolbar.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);
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
      const renderRect =
        assignment.sourceType === "lesson"
          ? {
              leftRatio: blank.left / displayWidth,
              topRatio: blank.top / displayHeight,
              widthRatio: blank.width / displayWidth,
              heightRatio: blank.height / displayHeight,
            }
          : getHistoryClassroomBlankRenderRect(
              blank,
              pageImage,
              currentTextRegions,
            );
      const pixelWidth = renderRect.widthRatio * displayWidth;
      const pixelHeight = renderRect.heightRatio * displayHeight;
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
      const isFilled = Boolean(trimmedAnswerValue);
      const isInputLocked =
        readOnly || answersLocked || completed || submitting || !onAnswerChange;

      return {
        blank,
        renderRect,
        answerValue,
        trimmedAnswerValue,
        placeholder,
        chipWidth: pixelWidth,
        chipHeight: pixelHeight,
        isFilled,
        isInputLocked,
        reviewCorrect,
        reviewText,
      };
    });

    if (!resolveBlankOverlap || assignment.sourceType === "lesson") {
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
    assignment.sourceType,
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
    answersLocked,
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
    const updateFloatingViewport = () => {
      const viewport = window.visualViewport;
      setFloatingViewport({
        offsetLeft: viewport?.offsetLeft || 0,
        offsetTop: viewport?.offsetTop || 0,
        width: viewport?.width || window.innerWidth,
        height: viewport?.height || window.innerHeight,
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
  }, []);

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
          0.01,
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
      ref={containerRef}
      className={
        isModalPreview
          ? "mx-auto w-full max-w-[108rem] px-3 py-2"
          : "mx-auto w-full px-2 py-2 sm:px-3"
      }
    >
      <div
        ref={toolbarRef}
        data-history-toolbar="true"
        className="sticky top-0 z-30 mb-2 rounded-xl border border-gray-200 bg-white px-2 py-1 shadow-sm sm:px-3"
      >
        <div
          data-history-actions="true"
          className="flex min-w-0 items-center gap-2"
        >
          <div className="relative min-w-0 flex-1">
            <h1
              className={`min-w-0 flex-1 truncate text-sm font-bold text-gray-900 ${showHelp ? "pr-6" : ""}`}
              title={[
                assignment.title,
                lessonPath,
                `통과 기준 ${assignment.passThresholdPercent}%`,
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              {assignment.title}
            </h1>
            {showHelp && (
              <button
                ref={helpButtonRef}
                type="button"
                aria-label="응시 주의사항"
                aria-expanded={helpOpen}
                aria-controls={helpId}
                onClick={() => {
                  closeHint();
                  setHelpOpen((open) => !open);
                }}
                className="absolute right-0 top-0 flex h-11 w-11 items-start justify-end pt-0.5 text-gray-600"
              >
                <span
                  aria-hidden="true"
                  className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-xs font-bold"
                >
                  i
                </span>
              </button>
            )}
            <div
              data-history-answer-progress="true"
              className="break-keep text-xs font-bold leading-4 text-gray-600"
            >
              전체 {assignment.blanks.length}개 중 {answeredCount}개 작성
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {assignment.timeLimitMinutes > 0 && countdownLabel && (
              <div
                className={`flex items-center gap-1 font-bold ${getCountdownToneClass(timeProgressPercent)}`}
              >
                <svg
                  data-history-timer-ring="true"
                  aria-hidden="true"
                  viewBox="0 0 36 36"
                  className="h-8 w-8 shrink-0 -rotate-90"
                >
                  <circle
                    cx="18"
                    cy="18"
                    r="14"
                    fill="none"
                    stroke="#fee2e2"
                    strokeWidth="4"
                  />
                  <circle
                    cx="18"
                    cy="18"
                    r="14"
                    fill="none"
                    stroke="#dc2626"
                    strokeWidth="4"
                    pathLength="100"
                    strokeDasharray="100"
                    strokeDashoffset={
                      100 - Math.max(0, Math.min(100, timeProgressPercent))
                    }
                  />
                </svg>
                <span className="mr-1 hidden text-xs sm:inline">남은 시간</span>
                <span
                  role="timer"
                  aria-label="남은 시간"
                  className="font-mono text-lg tabular-nums"
                >
                  {countdownLabel}
                </span>
                {timeProgressPercent <= 10 && !completed && (
                  <span className="ml-1 hidden text-xs sm:inline">곧 종료</span>
                )}
              </div>
            )}
          </div>
          {headerAction}
          <button
            type="button"
            onClick={onSubmit}
            disabled={readOnly || submitting || completed || !onSubmit}
            className="min-h-11 shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
          >
            {readOnly
              ? "읽기 전용 미리보기"
              : submitting
                ? "제출 중..."
                : completed
                  ? "제출 완료"
                  : submitLabel}
          </button>
        </div>
        {showHelp && helpOpen && (
          <div
            ref={helpPopoverRef}
            id={helpId}
            role="tooltip"
            className="absolute right-0 top-full z-40 mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-3 text-sm leading-6 text-gray-700 shadow-lg"
          >
            {helperItems.map((item, index) => (
              <p key={`${item}-${index}`}>{item}</p>
            ))}
          </div>
        )}
        {hintAvailable && hintOpen && (
          <div
            ref={hintPopupRef}
            id={hintId}
            role="dialog"
            aria-label="남은 단어"
            aria-modal="false"
            className="absolute right-0 top-full z-40 mt-1 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-blue-200 bg-white p-3 shadow-lg"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-gray-900">남은 단어</h2>
              <div className="ml-auto flex items-center gap-1">
                <div className="relative h-8 w-8 text-red-600">
                  <svg
                    data-history-hint-timer="true"
                    aria-hidden="true"
                    viewBox="0 0 36 36"
                    className="h-8 w-8 -rotate-90"
                  >
                    <circle
                      cx="18"
                      cy="18"
                      r="14"
                      fill="none"
                      stroke="currentColor"
                      strokeOpacity="0.15"
                      strokeWidth="3"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      pathLength="100"
                      strokeDasharray="100"
                      strokeDashoffset={100 - hintRemainingMs / 50}
                    />
                  </svg>
                  <span
                    role="timer"
                    aria-label="힌트 남은 시간"
                    className="absolute inset-0 flex items-center justify-center text-xs font-bold tabular-nums"
                  >
                    {Math.ceil(hintRemainingMs / 1000)}
                  </span>
                </div>
                <button
                  ref={hintCloseRef}
                  type="button"
                  aria-label="힌트 닫기"
                  onClick={closeHint}
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-xl text-gray-600 hover:bg-gray-100"
                >
                  ×
                </button>
              </div>
            </div>
            <div
              tabIndex={0}
              role="region"
              aria-label="힌트 단어 목록"
              className="flex max-h-[40dvh] flex-wrap gap-2 overflow-y-auto overscroll-contain"
            >
              {remainingOptions.map((option) => (
                <span
                  key={option}
                  className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-700 break-all"
                >
                  {option}
                </span>
              ))}
              {!remainingOptions.length && (
                <p className="text-sm text-gray-600">남은 단어가 없습니다.</p>
              )}
            </div>
          </div>
        )}
        {resultText && (
          <div
            role="status"
            className="rounded-xl bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700"
          >
            {resultText}
          </div>
        )}
        {pointNotice && (
          <div
            role="status"
            className={`text-sm font-bold ${isPointAwardedNotice ? "text-emerald-700" : "text-amber-700"}`}
          >
            {pointNotice}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-1">
          <div className="flex shrink-0 items-center gap-1 text-xs font-bold text-gray-600">
            <span className="hidden sm:inline">페이지 </span>
            <span
              aria-label={`페이지 ${Math.max(1, currentPageIndex + 1)} / ${pageCount}`}
            >
              {Math.max(1, currentPageIndex + 1)} / {pageCount}
            </span>
            {hintAvailable && (
              <button
                ref={hintButtonRef}
                type="button"
                aria-label={`힌트, ${3 - hintCount}회 남음`}
                aria-haspopup="dialog"
                aria-expanded={hintOpen}
                aria-controls={hintId}
                aria-disabled={
                  hintOpen ||
                  hintCount >= 3 ||
                  submitting ||
                  !remainingOptions.length
                }
                onClick={openHint}
                className="min-h-11 shrink-0 rounded-lg px-2 text-xs font-bold text-blue-700 hover:bg-blue-50 aria-disabled:cursor-default aria-disabled:opacity-40"
              >
                힌트 {3 - hintCount}/3
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            {enableInteractiveViewport && (
              <>
                <div className="hidden rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-500 sm:block">
                  {displayZoomPercent}%
                </div>
                <button
                  type="button"
                  aria-label="자료 축소"
                  onClick={() => nudgeViewportZoom(-0.18)}
                  disabled={userScale <= MIN_VIEWPORT_USER_SCALE}
                  className="min-h-11 min-w-11 rounded-lg px-2 py-2 text-sm font-bold text-gray-700 disabled:opacity-40"
                >
                  -
                </button>
                <button
                  type="button"
                  aria-label="전체 보기"
                  onClick={resetViewportScale}
                  disabled={userScale <= MIN_VIEWPORT_USER_SCALE}
                  className="min-h-11 min-w-11 rounded-lg px-2 py-2 text-xs font-bold text-gray-700 disabled:opacity-40"
                >
                  <span className="sm:hidden">맞춤</span>
                  <span className="hidden sm:inline">전체 보기</span>
                </button>
                <button
                  type="button"
                  aria-label="자료 확대"
                  onClick={() => nudgeViewportZoom(0.18)}
                  disabled={userScale >= MAX_VIEWPORT_USER_SCALE}
                  className="min-h-11 min-w-11 rounded-lg px-2 py-2 text-sm font-bold text-gray-700 disabled:opacity-40"
                >
                  +
                </button>
              </>
            )}
            <button
              type="button"
              disabled={currentPageIndex <= 0}
              onClick={() =>
                onCurrentPageChange(pages[currentPageIndex - 1].page)
              }
              className="min-h-11 min-w-11 rounded-lg px-2 py-2 text-sm font-bold text-gray-700 disabled:opacity-40"
            >
              이전
            </button>
            <button
              type="button"
              disabled={
                currentPageIndex < 0 || currentPageIndex >= pageCount - 1
              }
              onClick={() =>
                onCurrentPageChange(pages[currentPageIndex + 1].page)
              }
              className="min-h-11 min-w-11 rounded-lg px-2 py-2 text-sm font-bold text-gray-700 disabled:opacity-40"
            >
              다음
            </button>
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <section className="min-w-0 rounded-xl border border-gray-200 bg-white p-1">
          {assignment.description && (
            <p className="p-2 text-sm text-gray-600">
              {assignment.description}
            </p>
          )}
          {dueStatusLabel && (
            <p
              className={`px-2 py-1 text-xs font-bold ${TONE_CLASS_NAME[dueStatusTone]}`}
            >
              {dueStatusLabel}
            </p>
          )}
          {imageLoadError && (
            <div
              role="alert"
              className="mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"
            >
              <span>
                자료를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.
              </span>
              <button
                type="button"
                className="min-h-11 rounded-xl border border-amber-200 bg-white px-3 font-bold"
                onClick={() => {
                  setImageLoadError(false);
                  setImageRetry((value) => value + 1);
                }}
              >
                자료 다시 불러오기
              </button>
            </div>
          )}
          {pageImage && (
            <div
              data-history-viewport="true"
              className="overflow-hidden rounded-lg border border-gray-200 bg-gray-100 p-1"
              style={{ height: viewportHeight }}
            >
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
                        key={`${pageImage.page}-${imageRetry}`}
                        src={pageImage.imageUrl}
                        alt={`${assignment.title} ${currentPage}`}
                        className="block h-full w-full"
                        loading="lazy"
                        decoding="async"
                        style={{ maxWidth: "none" }}
                        onLoad={() => setImageLoadError(false)}
                        onError={() => setImageLoadError(true)}
                      />
                      {orderedBlankPlacements.map((placement) => {
                        const {
                          blank,
                          answerValue,
                          trimmedAnswerValue,
                          chipWidth,
                          chipHeight,
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
                          <React.Fragment key={blank.id}>
                            <div
                              data-blank-box="true"
                              data-blank-id={blank.id}
                              className={`absolute overflow-hidden rounded-[2px] border text-left font-bold shadow-[0_6px_18px_rgba(15,23,42,0.12)] transition-colors focus-within:border-orange-400 focus-within:ring-2 focus-within:ring-orange-200 ${
                                isFocused ? "z-20" : "z-10"
                              } ${reviewToneClass}`}
                              title={
                                hasReview
                                  ? reviewCorrect
                                    ? "정답"
                                    : `오답 · 정답: ${reviewText || blank.answer}`
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
                              <WorksheetBlankInput
                                focusOutline={false}
                                type="text"
                                ref={(node) => {
                                  blankInputRefs.current[blank.id] = node;
                                }}
                                value={
                                  isInputLocked
                                    ? lockedDisplayText
                                    : answerValue
                                }
                                onChange={(event) =>
                                  onAnswerChange?.(blank.id, event.target.value)
                                }
                                onFocus={() => {
                                  setFocusedBlankId(blank.id);
                                  deferredBlurIdsRef.current.delete(blank.id);
                                  setBlankFeedback((current) =>
                                    current?.blankId === blank.id
                                      ? null
                                      : current,
                                  );
                                }}
                                onBlur={(event) => {
                                  setFocusedBlankId("");
                                  if (
                                    composingBlankIdsRef.current.has(blank.id)
                                  ) {
                                    deferredBlurIdsRef.current.add(blank.id);
                                    return;
                                  }
                                  showBlankFeedback(
                                    blank,
                                    event.currentTarget.value,
                                  );
                                }}
                                onCompositionStart={() =>
                                  composingBlankIdsRef.current.add(blank.id)
                                }
                                onCompositionEnd={(event) => {
                                  composingBlankIdsRef.current.delete(blank.id);
                                  if (
                                    deferredBlurIdsRef.current.delete(blank.id)
                                  ) {
                                    showBlankFeedback(
                                      blank,
                                      event.currentTarget.value,
                                    );
                                  }
                                }}
                                readOnly={isInputLocked}
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck={false}
                                inputMode="text"
                                lang="ko"
                                aria-label={
                                  blank.prompt ||
                                  `${assignment.blanks.findIndex((item) => item.id === blank.id) + 1}번 답안 입력`
                                }
                                placeholder={placeholder}
                                className={`relative z-[1] border-0 bg-transparent text-center font-bold outline-none ${hasReview ? (reviewCorrect ? "text-emerald-900" : "text-rose-900") : isFilled ? "text-orange-800 placeholder:text-orange-300" : "text-slate-700 placeholder:text-slate-400"}`}
                                style={{
                                  letterSpacing: 0,
                                  touchAction: "manipulation",
                                }}
                              />
                            </div>
                            {feedbackEnabled &&
                              blankFeedback?.blankId === blank.id && (
                                <HistoryBlankFeedback
                                  key={blankFeedback.sequence}
                                  correct={blankFeedback.correct}
                                  scale={totalScale}
                                  style={{
                                    left: leftPx + chipWidth / 2,
                                    top: topPx + chipHeight / 2,
                                  }}
                                />
                              )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-2">
          <div className="flex flex-wrap gap-x-3 gap-y-1 px-2 text-xs font-bold text-gray-600">
            {lessonPath && <span>{lessonPath}</span>}
            <span>통과 기준 {assignment.passThresholdPercent}% 이상</span>
          </div>
          {(readOnly || completed) && (
            <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="text-sm font-bold text-gray-700">참고 보기</div>
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
                      <span className="break-all">{option}</span>
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
          )}
        </aside>
      </div>
    </div>
  );
};

export default HistoryClassroomAssignmentView;
