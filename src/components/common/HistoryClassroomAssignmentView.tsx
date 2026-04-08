import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getHistoryClassroomBlankRenderRect,
  normalizeHistoryClassroomAnswer,
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
const MAX_VIEWPORT_USER_SCALE = 2.8;
const VIEWPORT_FIT_PADDING = 24;

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

const getCenteredViewportOffset = (
  viewportSize: number,
  contentSize: number,
) => Math.max(0, (viewportSize - contentSize) / 2);

const getBlankFontSize = (
  pixelWidth: number,
  pixelHeight: number,
  contentLength: number,
) => {
  const safeLength = Math.max(1, contentLength);
  const widthBased =
    Math.max(1, pixelWidth - 10) / Math.max(1.2, safeLength * 0.82);
  const heightBased = Math.max(1, pixelHeight - 6) * 0.78;
  return Math.max(12, Math.min(22, widthBased, heightBased));
};

const getAnswerChipWidth = (
  baseWidth: number,
  content: string,
  fontSize: number,
) => {
  const textLength = Math.max(1, content.length);
  const estimatedWidth = Math.ceil(textLength * fontSize * 1.04) + 24;
  return Math.max(baseWidth, estimatedWidth);
};

const getAnswerChipHeight = (baseHeight: number, fontSize: number) =>
  Math.max(baseHeight, Math.ceil(fontSize * 1.8));

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
  const isPointAwardedNotice = pointNotice.includes("+");
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const fitScaleRef = useRef(1);
  const userScaleRef = useRef(1);
  const totalScaleRef = useRef(1);
  const zoomFrameRef = useRef<number | null>(null);
  const dragStateRef = useRef<ViewportDragState | null>(null);
  const touchDragStateRef = useRef<ViewportDragState | null>(null);
  const pinchStateRef = useRef<ViewportPinchState | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const [userScale, setUserScale] = useState(MIN_VIEWPORT_USER_SCALE);

  const enableInteractiveViewport =
    interactiveViewport && !isModalPreview && Boolean(pageImage);
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
  const displayZoomPercent = Math.max(
    100,
    Math.round(userScale * 100),
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
    setUserScale(MIN_VIEWPORT_USER_SCALE);
    dragStateRef.current = null;
    touchDragStateRef.current = null;
    pinchStateRef.current = null;
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

  const handleViewportMouseDown = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
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

  const handleViewportMouseMove = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
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
    if (!enableInteractiveViewport || !viewportRef.current || !pageImage) return;
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

  const handleViewportTouchMove = (
    event: React.TouchEvent<HTMLDivElement>,
  ) => {
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

  return (
    <div
      className={
        isModalPreview
          ? "mx-auto w-full max-w-[108rem] px-5 py-5 lg:px-6"
          : "mx-auto max-w-6xl px-4 py-6 pb-44 sm:pb-40 lg:px-5"
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

        {isModalPreview && assignment.timeLimitMinutes > 0 && countdownLabel && (
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
              {!isModalPreview && (
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
                onClick={() => onCurrentPageChange(Math.max(1, currentPage - 1))}
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
                ref={!isModalPreview ? viewportRef : undefined}
                className="h-full min-h-0 overflow-auto"
                style={
                  !isModalPreview
                    ? {
                        touchAction: canPanViewport ? "none" : "manipulation",
                        overscrollBehavior: "contain",
                      }
                    : undefined
                }
                onWheel={!isModalPreview ? handleViewportWheel : undefined}
                onMouseDown={
                  !isModalPreview ? handleViewportMouseDown : undefined
                }
                onMouseMove={
                  !isModalPreview ? handleViewportMouseMove : undefined
                }
                onMouseUp={!isModalPreview ? clearViewportGestureState : undefined}
                onMouseLeave={
                  !isModalPreview ? clearViewportGestureState : undefined
                }
                onTouchStart={
                  !isModalPreview ? handleViewportTouchStart : undefined
                }
                onTouchMove={
                  !isModalPreview ? handleViewportTouchMove : undefined
                }
                onTouchEnd={
                  !isModalPreview ? clearViewportGestureState : undefined
                }
                onTouchCancel={
                  !isModalPreview ? clearViewportGestureState : undefined
                }
              >
                <div
                  className={`flex min-h-full min-w-full ${
                    !isModalPreview && !canPanViewport
                      ? "items-center justify-center"
                      : "items-start justify-start"
                  }`}
                >
                  <div
                    className={`relative shrink-0 ${
                      !isModalPreview && canPanViewport
                        ? "cursor-grab active:cursor-grabbing"
                        : ""
                    } ${isModalPreview ? "mx-auto" : ""}`}
                    style={{
                      width: `${
                        isModalPreview ? pageImage.width : scaledPageWidth
                      }px`,
                      height: `${
                        isModalPreview ? pageImage.height : scaledPageHeight
                      }px`,
                    }}
                  >
                    <img
                      src={pageImage.imageUrl}
                      alt={`${assignment.title} ${currentPage}`}
                      className="block h-full w-full"
                      style={{ maxWidth: "none" }}
                    />
                    {currentBlanks.map((blank) => {
                      const renderRect = getHistoryClassroomBlankRenderRect(
                        blank,
                        pageImage,
                        currentTextRegions,
                      );
                      const displayWidth = isModalPreview
                        ? pageImage.width
                        : scaledPageWidth;
                      const displayHeight = isModalPreview
                        ? pageImage.height
                        : scaledPageHeight;
                      const pixelWidth = renderRect.widthRatio * displayWidth;
                      const pixelHeight =
                        renderRect.heightRatio * displayHeight;
                      const answerValue = String(answers[blank.id] || "");
                      const trimmedAnswerValue = answerValue.trim();
                      const placeholder = blank.prompt || "정답 입력";
                      const displayValue = trimmedAnswerValue || placeholder;
                      const fontSize = getBlankFontSize(
                        pixelWidth,
                        pixelHeight,
                        displayValue.length,
                      );
                      const isFilled = Boolean(trimmedAnswerValue);
                      const isInputLocked =
                        readOnly || completed || submitting || !onAnswerChange;
                      const chipWidth = getAnswerChipWidth(
                        pixelWidth,
                        displayValue,
                        fontSize,
                      );
                      const chipHeight = getAnswerChipHeight(
                        pixelHeight,
                        fontSize,
                      );
                      const anchorLeft =
                        (renderRect.leftRatio + renderRect.widthRatio / 2) * 100;
                      const anchorTop =
                        (renderRect.topRatio + renderRect.heightRatio / 2) * 100;

                      return (
                        <div
                          key={blank.id}
                          className={`absolute z-10 rounded-xl border text-left font-bold shadow-[0_6px_18px_rgba(15,23,42,0.12)] transition focus-within:border-orange-400 focus-within:ring-2 focus-within:ring-orange-200 ${
                            isFilled
                              ? "border-orange-300 text-orange-800"
                              : "border-slate-300 text-slate-700"
                          }`}
                          style={{
                            left: `${anchorLeft}%`,
                            top: `${anchorTop}%`,
                            width: `${chipWidth}px`,
                            minHeight: `${chipHeight}px`,
                            transform: "translate(-50%, -50%)",
                            backgroundColor: "#ffffff",
                            opacity: 1,
                          }}
                        >
                          {isInputLocked ? (
                            <span
                              aria-hidden
                              className={`absolute inset-0 ${
                                isFilled ? "bg-orange-50" : "bg-white"
                              }`}
                            />
                          ) : null}
                          {isInputLocked ? (
                            <span
                              className="relative z-[1] flex h-full w-full items-center justify-center whitespace-nowrap px-3 text-center leading-none"
                              style={{
                                fontSize: `${fontSize}px`,
                                letterSpacing:
                                  chipWidth < 80 ? "-0.05em" : "-0.02em",
                              }}
                            >
                              {trimmedAnswerValue || placeholder}
                            </span>
                          ) : (
                            <input
                              type="text"
                              value={answerValue}
                              onChange={(event) =>
                                onAnswerChange?.(blank.id, event.target.value)
                              }
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
                              className={`relative z-[1] h-full w-full border-0 bg-transparent px-3 text-center font-bold outline-none ${
                                isFilled
                                  ? "text-orange-800 placeholder:text-orange-300"
                                  : "text-slate-700 placeholder:text-slate-400"
                              }`}
                              style={{
                                fontSize: `${Math.max(16, fontSize)}px`,
                                letterSpacing:
                                  chipWidth < 80 ? "-0.05em" : "-0.02em",
                                touchAction: "manipulation",
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
                const normalizedOption = normalizeHistoryClassroomAnswer(option);
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
        <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex justify-end sm:inset-x-auto sm:right-5 sm:bottom-5">
          <div className="pointer-events-auto w-full max-w-[22rem] rounded-3xl border border-gray-200 bg-white/95 p-4 shadow-[0_20px_45px_-24px_rgba(15,23,42,0.35)] backdrop-blur">
            {assignment.timeLimitMinutes > 0 && countdownLabel && (
              <div className="rounded-2xl bg-gray-50 px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-[11px] font-bold tracking-[0.18em] text-gray-400">
                  <span>남은 시간</span>
                  <span
                    className={`font-mono text-2xl leading-none ${getCountdownToneClass(
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
              className="mt-3 w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
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
