import React, { useLayoutEffect, useRef } from "react";

/** Plain-text answer values stay unchanged while long Korean text wraps naturally. */
const QuizTextField: React.FC<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
> = ({ className = "", value, ...props }) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const resize = () => {
      const field = ref.current;
      if (!field) return;
      field.style.height = "auto";
      field.style.overflowY = "hidden";
      const style = window.getComputedStyle(field);
      const pixels = (value: string) => Number.parseFloat(value) || 0;
      // scrollHeight includes padding but not the border of a border-box field.
      const adjustment =
        style.boxSizing === "border-box"
          ? pixels(style.borderTopWidth) + pixels(style.borderBottomWidth)
          : -pixels(style.paddingTop) - pixels(style.paddingBottom);
      const naturalHeight = field.scrollHeight + adjustment;
      field.style.height = `${Math.min(Math.max(naturalHeight, 44), 240)}px`;
      field.style.overflowY = naturalHeight > 240 ? "auto" : "hidden";
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
