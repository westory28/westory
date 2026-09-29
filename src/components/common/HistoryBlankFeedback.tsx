import React, { useId } from "react";

type HistoryBlankFeedbackProps = {
  correct: boolean;
  scale?: number;
  style?: React.CSSProperties;
};

/** Screen-size brush marks anchored to the blank's page-coordinate center. */
const HistoryBlankFeedback: React.FC<HistoryBlankFeedbackProps> = ({
  correct,
  scale = 1,
  style,
}) => {
  const id = `history-brush-${useId().replace(/:/g, "")}`;
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
      <svg
        data-feedback-symbol="true"
        aria-hidden="true"
        viewBox="0 0 64 64"
        width="64"
        height="64"
        className="history-blank-feedback__brush"
      >
        <defs>
          <mask
            id={`${id}-o`}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="64"
            height="64"
          >
            <path
              className="history-blank-feedback__stroke history-blank-feedback__stroke--circle"
              d="M31 10 C46 7 56 19 55 32 C54 48 43 56 29 55 C15 54 7 43 9 29 C10 17 19 9 31 10"
              fill="none"
              stroke="white"
              strokeWidth="18"
              pathLength="100"
            />
          </mask>
          <mask
            id={`${id}-x1`}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="64"
            height="64"
          >
            <path
              className="history-blank-feedback__stroke history-blank-feedback__stroke--first"
              d="M10 9 Q30 29 54 55"
              fill="none"
              stroke="white"
              strokeWidth="19"
              pathLength="100"
            />
          </mask>
          <mask
            id={`${id}-x2`}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="64"
            height="64"
          >
            <path
              className="history-blank-feedback__stroke history-blank-feedback__stroke--second"
              d="M55 10 Q30 29 10 55"
              fill="none"
              stroke="white"
              strokeWidth="19"
              pathLength="100"
            />
          </mask>
        </defs>
        {correct ? (
          <g
            data-feedback-brush="correct"
            mask={`url(#${id}-o)`}
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M31 5 C45 3 57 14 59 28 C62 44 51 57 35 60 C20 63 7 52 5 39 C1 23 13 7 27 6 L32 8 L27 11 L21 15 C12 21 10 32 14 41 C17 50 28 54 38 50 C47 47 51 39 50 29 C49 20 41 13 32 14 L25 13 L31 10 L36 9 Z"
            />
            <path d="M8 24 Q3 38 13 49 Q5 39 7 30Z M43 54 Q52 50 57 40 Q54 52 43 57Z M17 12 L26 7 L22 11Z" />
          </g>
        ) : (
          <g data-feedback-brush="wrong" fill="currentColor">
            <path
              mask={`url(#${id}-x1)`}
              d="M7 7 L14 9 Q25 22 36 33 Q46 43 58 56 L51 54 L48 56 Q34 42 24 31 Q15 21 8 14 L10 13Z M12 18 L27 33 L23 31Z"
            />
            <path
              mask={`url(#${id}-x2)`}
              d="M58 7 L55 15 Q44 25 35 35 Q23 48 9 59 L11 52 L7 52 Q18 38 30 27 Q42 16 51 10 L53 12Z M16 49 L10 56 L14 48Z"
            />
          </g>
        )}
      </svg>
    </span>
  );
};
export default HistoryBlankFeedback;
