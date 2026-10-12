import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import HistoryBlankFeedback from "./HistoryBlankFeedback";

type LessonAnswerFeedbackProps = {
  anchor: HTMLInputElement;
  correct: boolean;
  onComplete: () => void;
};

type FeedbackPosition = { x: number; y: number };

const FEEDBACK_SIZE = 48;
const FEEDBACK_GAP = 8;
const FEEDBACK_DURATION = 1200;

const getFeedbackPosition = (
  anchor: HTMLInputElement,
): FeedbackPosition | null => {
  if (!anchor.isConnected) return null;

  const rect = anchor.getBoundingClientRect();
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  const right =
    left + (viewport?.width ?? document.documentElement.clientWidth);
  const bottom = top + (viewport?.height ?? window.innerHeight);
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.right <= left ||
    rect.left >= right ||
    rect.bottom <= top ||
    rect.top >= bottom
  ) {
    return null;
  }

  const half = FEEDBACK_SIZE / 2;
  const minX = left + FEEDBACK_GAP + half;
  const maxX = right - FEEDBACK_GAP - half;
  const minY = top + FEEDBACK_GAP + half;
  const maxY = bottom - FEEDBACK_GAP - half;
  if (minX > maxX || minY > maxY) return null;

  const x = Math.min(maxX, Math.max(minX, rect.left + rect.width / 2));
  const y = Math.min(maxY, Math.max(minY, rect.top + rect.height / 2));
  if (rect.right + FEEDBACK_GAP + half <= maxX) {
    return { x: rect.right + FEEDBACK_GAP + half, y };
  }
  if (rect.left - FEEDBACK_GAP - half >= minX) {
    return { x: rect.left - FEEDBACK_GAP - half, y };
  }
  if (rect.bottom + FEEDBACK_GAP + half <= maxY) {
    return { x, y: rect.bottom + FEEDBACK_GAP + half };
  }
  if (rect.top - FEEDBACK_GAP - half >= minY) {
    return { x, y: rect.top - FEEDBACK_GAP - half };
  }
  return null;
};

/** Reuse the brush animation beside a committed lesson answer, outside its page zoom. */
const LessonAnswerFeedback: React.FC<LessonAnswerFeedbackProps> = ({
  anchor,
  correct,
  onComplete,
}) => {
  const [position, setPosition] = useState<FeedbackPosition | null>(null);
  const onCompleteRef = useRef(onComplete);

  useLayoutEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useLayoutEffect(() => {
    let completed = false;
    let frame = 0;
    const complete = () => {
      if (completed) return;
      completed = true;
      setPosition(null);
      onCompleteRef.current();
    };
    const updatePosition = () => {
      frame = 0;
      if (completed) return;
      const next = getFeedbackPosition(anchor);
      if (!next) {
        complete();
        return;
      }
      setPosition((previous) =>
        previous?.x === next.x && previous.y === next.y ? previous : next,
      );
    };
    const scheduleUpdate = () => {
      if (!frame && !completed) frame = requestAnimationFrame(updatePosition);
    };
    const viewport = window.visualViewport;
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      if (!anchor.isConnected || !entry.isIntersecting) complete();
    });

    updatePosition();
    const timeout = window.setTimeout(complete, FEEDBACK_DURATION);
    resizeObserver.observe(anchor);
    visibilityObserver.observe(anchor);
    window.addEventListener("scroll", scheduleUpdate, true);
    window.addEventListener("resize", scheduleUpdate);
    viewport?.addEventListener("scroll", scheduleUpdate);
    viewport?.addEventListener("resize", scheduleUpdate);

    return () => {
      completed = true;
      window.clearTimeout(timeout);
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
      viewport?.removeEventListener("scroll", scheduleUpdate);
      viewport?.removeEventListener("resize", scheduleUpdate);
    };
  }, [anchor]);

  if (!position) return null;
  return createPortal(
    <HistoryBlankFeedback
      correct={correct}
      scale={1.5}
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        zIndex: 90,
      }}
    />,
    document.body,
  );
};

export default LessonAnswerFeedback;
