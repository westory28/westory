import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent,
  PointerEvent,
  SyntheticEvent,
} from "react";

interface Options {
  activeIndex: number;
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  count: number;
  paused: boolean;
  busy?: boolean;
  move: (direction: -1 | 1) => void;
}

interface Gesture {
  id: number;
  x: number;
  y: number;
  touch: boolean;
  moved: boolean;
  cancelled: boolean;
  axis: "horizontal" | "vertical" | null;
}

export default function useNoticeCarouselInteraction({
  activeIndex,
  imageUrl,
  imageWidth,
  imageHeight,
  count,
  paused,
  busy = false,
  move,
}: Options) {
  const [readyImage, setReadyImage] = useState<{
    url?: string;
    ratio?: number;
  }>();
  const [pressed, setPressed] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);

  const cancelGesture = useCallback(() => {
    if (gesture.current) suppressClick.current = true;
    gesture.current = null;
    setPressed(false);
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      setVisible(!document.hidden);
      cancelGesture();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [cancelGesture]);

  // Cached teacher images may have loaded before becoming the active image.
  const markReady = useCallback(
    (image: HTMLImageElement) => {
      if (image.getAttribute("src") !== imageUrl) return;
      setReadyImage({
        url: imageUrl,
        ratio: image.naturalHeight
          ? image.naturalWidth / image.naturalHeight
          : undefined,
      });
    },
    [imageUrl],
  );
  const imageRef = useCallback(
    (image: HTMLImageElement | null) => {
      if (image?.complete) markReady(image);
    },
    [markReady],
  );
  const onImageReady = (event: SyntheticEvent<HTMLImageElement>) =>
    markReady(event.currentTarget);
  const readyUrl = readyImage?.url;
  const storedRatio = imageWidth && imageHeight ? imageWidth / imageHeight : 0;
  const imageRatio =
    (readyUrl === imageUrl && readyImage?.ratio) || storedRatio;

  useEffect(() => {
    if (
      count < 2 ||
      paused ||
      busy ||
      pressed ||
      !visible ||
      !imageUrl ||
      readyUrl !== imageUrl
    )
      return;
    const timer = window.setTimeout(
      () => {
        if (!gesture.current && !document.hidden) move(1);
      },
      activeIndex === 0 ? 12000 : 5000,
    );
    return () => window.clearTimeout(timer);
  }, [
    activeIndex,
    count,
    paused,
    busy,
    pressed,
    visible,
    imageUrl,
    readyUrl,
    move,
  ]);

  const measure = (
    event: PointerEvent<HTMLButtonElement>,
    current: Gesture,
  ) => {
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 10) {
      current.moved = true;
      if (!current.axis) {
        if (Math.abs(dy) > Math.abs(dx) * 1.3) current.axis = "vertical";
        else if (Math.abs(dx) > Math.abs(dy) * 1.3) current.axis = "horizontal";
      }
    }
    return { dx, dy };
  };

  return {
    imageRef,
    onImageReady,
    frameStyle: {
      "--notice-image-ratio":
        Number.isFinite(imageRatio) && imageRatio > 0 ? imageRatio : undefined,
    } as CSSProperties,
    pointerHandlers: {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (!event.isPrimary) {
          if (gesture.current) gesture.current.cancelled = true;
          suppressClick.current = true;
          return;
        }
        if (event.button !== 0) return;
        suppressClick.current = busy;
        gesture.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          touch: event.pointerType === "touch" || event.pointerType === "pen",
          moved: false,
          cancelled: busy,
          axis: null,
        };
        setPressed(true);
        if (event.pointerType !== "mouse") {
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            /* A cancelled pointer may no longer be capturable. */
          }
        }
      },
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
        const current = gesture.current;
        if (current?.id === event.pointerId) measure(event, current);
      },
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        const { dx, dy } = measure(event, current);
        gesture.current = null;
        setPressed(false);
        suppressClick.current = current.moved || current.cancelled;
        if (
          count > 1 &&
          current.touch &&
          !current.cancelled &&
          !busy &&
          current.axis !== "vertical" &&
          Math.abs(dx) >= 48 &&
          Math.abs(dx) > Math.abs(dy) * 1.3
        ) {
          suppressClick.current = true;
          move(dx < 0 ? 1 : -1);
        }
      },
      onPointerCancel: cancelGesture,
      onLostPointerCapture: cancelGesture,
      onPointerLeave: (event: PointerEvent<HTMLButtonElement>) => {
        if (event.pointerType === "mouse") cancelGesture();
      },
      onClickCapture: (event: MouseEvent<HTMLButtonElement>) => {
        if (busy || (suppressClick.current && event.detail !== 0)) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      },
    },
  };
}
