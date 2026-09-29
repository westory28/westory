import React from "react";

type HistoryBlankFeedbackProps = {
  correct: boolean;
  /** Total scale applied to the surrounding page, including fit and user zoom. */
  scale?: number;
  /** Place at the blank's center in unscaled page coordinates, outside its mask. */
  style?: React.CSSProperties;
};

/** Mount with a new key for each answer check; the owner controls its lifetime. */
const HistoryBlankFeedback: React.FC<HistoryBlankFeedbackProps> = ({
  correct,
  scale = 1,
  style,
}) => {
  const pageScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return (
    <span
      data-blank-feedback="true"
      data-correct={correct}
      role="status"
      aria-label={correct ? "정답" : "오답"}
      aria-atomic="true"
      className="history-blank-feedback"
      style={{
        ...style,
        transform: `translate(-50%, -50%) scale(${1 / pageScale})`,
      }}
    >
      <span className="history-blank-feedback__impact" aria-hidden="true" />
      {correct && (
        <span className="history-blank-feedback__sparks" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            <span
              key={index}
              className="history-blank-feedback__ray"
              style={{ transform: `rotate(${index * 45}deg)` }}
            >
              <span className="history-blank-feedback__spark" />
            </span>
          ))}
        </span>
      )}
      <span className="history-blank-feedback__badge" aria-hidden="true">
        <svg
          data-feedback-symbol="true"
          viewBox="0 0 56 56"
          width="56"
          height="56"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {correct ? (
            <circle cx="28" cy="28" r="19" />
          ) : (
            <path d="M10 10L46 46M46 10L10 46" />
          )}
        </svg>
      </span>
    </span>
  );
};

export default HistoryBlankFeedback;
