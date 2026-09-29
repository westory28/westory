import { useEffect, useRef } from "react";
import "./teacherScheduleTitle.css";

interface Props {
  title: string;
}

// Keep one complete text node: only the visual viewport moves, never the label.
export default function TeacherScheduleTitle({ title }: Props) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const text = textRef.current;
    if (!viewport || !text) return;
    const mobile = window.matchMedia("(max-width: 767px)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animation: Animation | undefined;
    let active = true;

    const measure = () => {
      if (!active) return;
      animation?.cancel();
      animation = undefined;
      if (!mobile.matches || reducedMotion.matches) return;
      const distance = Math.ceil(text.scrollWidth - viewport.clientWidth);
      if (distance <= 0 || viewport.clientWidth === 0) return;
      const startPause = 2400;
      const endPause = 1200;
      const travel = Math.max(2000, (distance / 24) * 1000);
      const duration = startPause + travel + endPause;
      animation = text.animate(
        [
          { transform: "translateX(0)", offset: 0 },
          { transform: "translateX(0)", offset: startPause / duration },
          {
            transform: `translateX(-${distance}px)`,
            offset: (startPause + travel) / duration,
          },
          { transform: `translateX(-${distance}px)`, offset: 1 },
        ],
        { duration, iterations: Infinity, easing: "linear" },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(text);
    mobile.addEventListener("change", measure);
    reducedMotion.addEventListener("change", measure);
    void document.fonts.ready.then(measure);
    measure();
    return () => {
      active = false;
      animation?.cancel();
      observer.disconnect();
      mobile.removeEventListener("change", measure);
      reducedMotion.removeEventListener("change", measure);
    };
  }, [title]);

  return (
    <span ref={viewportRef} className="teacher-schedule-title" title={title}>
      <span ref={textRef} className="teacher-schedule-title__text">
        {title}
      </span>
    </span>
  );
}
