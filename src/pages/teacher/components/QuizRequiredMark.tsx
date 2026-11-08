import React from "react";

/** Keep requiredness visible without relying on the red color alone. */
export default function QuizRequiredMark() {
  return (
    <>
      <span
        aria-hidden="true"
        style={{ color: "var(--ws-danger-text, #b91c1c)" }}
      >
        *
      </span>
      <span className="sr-only"> (필수)</span>
    </>
  );
}
