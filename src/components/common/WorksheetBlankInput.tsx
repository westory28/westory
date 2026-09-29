import React, { forwardRef, useLayoutEffect, useRef, useState } from "react";

/** Fits the text inside the saved blank, without changing its page geometry. */
const WorksheetBlankInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { focusOutline?: boolean }
>(function WorksheetBlankInput(
  { style, focusOutline = true, ...props },
  forwardedRef,
) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [fontSize, setFontSize] = useState(16);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const input = inputRef.current;
    if (!host || !input) return;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    let disposed = false;
    let inputFrame = 0;
    let width = host.clientWidth;
    let height = host.clientHeight;
    const fit = () => {
      if (disposed || width <= 0 || height <= 0) return;
      const computed = getComputedStyle(input);
      const text = input.value || input.placeholder || "빈칸";
      if (context) {
        context.font = `${computed.fontWeight} 100px ${computed.fontFamily}`;
      }
      const textWidth = context?.measureText(text).width || text.length * 100;
      // Reserve proportional space for the caret and glyph ascenders/descenders.
      const availableWidth = width * 0.96;
      setFontSize(Math.min(height * 0.82, (availableWidth / textWidth) * 100));
    };
    // Let React/IME commit the new controlled value before resizing the input.
    // A synchronous native input listener can otherwise restore the old value.
    const scheduleFit = () => {
      cancelAnimationFrame(inputFrame);
      inputFrame = requestAnimationFrame(fit);
    };
    fit();
    const observer = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      fit();
    });
    observer.observe(host);
    input.addEventListener("input", scheduleFit);
    document.fonts?.ready.then(fit);
    document.fonts?.addEventListener("loadingdone", fit);
    return () => {
      disposed = true;
      cancelAnimationFrame(inputFrame);
      observer.disconnect();
      input.removeEventListener("input", scheduleFit);
      document.fonts?.removeEventListener("loadingdone", fit);
    };
  }, [props.value, props.placeholder, props.className]);

  // iPad Safari zooms focused inputs with a computed font below 16px. Keep the
  // native font at least 16px and scale only its presentation inside the blank.
  const nativeFontSize = Math.max(16, fontSize);
  const scale = fontSize / nativeFontSize;
  return (
    <span
      ref={hostRef}
      className={
        focusOutline
          ? "focus-within:outline focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-blue-500"
          : undefined
      }
      style={{
        display: "block",
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <input
        {...props}
        ref={(node) => {
          inputRef.current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        style={{
          ...style,
          position: "absolute",
          left: 0,
          top: 0,
          width: `${100 / scale}%`,
          height: `${100 / scale}%`,
          minWidth: 0,
          minHeight: 0,
          maxWidth: "none",
          fontSize: `${nativeFontSize}px`,
          lineHeight: 1,
          letterSpacing: 0,
          padding: 0,
          border: 0,
          borderRadius: 0,
          boxSizing: "border-box",
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          overflow: "hidden",
          textOverflow: "clip",
          whiteSpace: "nowrap",
        }}
      />
    </span>
  );
});

export default WorksheetBlankInput;
