import React, { useLayoutEffect, useRef } from "react";

/** Plain-text answer values stay unchanged while long Korean text wraps naturally. */
const QuizTextField: React.FC<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
> = ({ className = "", value, ...props }) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const resize = () => {
      if (!ref.current) return;
      ref.current.style.height = "auto";
      ref.current.style.height = `${Math.min(Math.max(ref.current.scrollHeight, 44), 240)}px`;
    };
    resize();
    let width = ref.current.clientWidth;
    const observer = new ResizeObserver(() => {
      if (ref.current && width !== ref.current.clientWidth) {
        width = ref.current.clientWidth;
        resize();
      }
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [value]);
  return (
    <textarea
      {...props}
      aria-label={props["aria-label"] || props.placeholder}
      ref={ref}
      rows={1}
      value={value}
      className={`quiz-text-field ${className}`}
    />
  );
};
export default QuizTextField;
