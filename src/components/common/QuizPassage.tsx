import React from "react";
import {
  isQuizPassageBlankLabel,
  parseQuizPassageMarkup,
  quizPassageHangulMarker,
  splitQuizPassageLeadingLabel,
  type QuizPassageSegment,
} from "../../lib/quizPassageMarkup";
import "./quizPassage.css";

interface QuizPassageProps {
  value: string | null | undefined;
  className?: string;
  size?: "compact" | "default" | "large";
  surface?: "white" | "muted";
}

const markClasses: Record<string, string> = {
  underline: "quiz-passage-underline pb-0.5 font-bold text-slate-950",
  box: "mx-0 inline-block max-w-full whitespace-pre-wrap rounded border-2 border-slate-800 px-3 py-0.5 font-bold text-slate-950",
  blank:
    "mx-1 inline-block align-baseline border-b-2 border-slate-900 px-3 pb-0.5",
};

const sizeClasses: Record<NonNullable<QuizPassageProps["size"]>, string> = {
  compact: "text-sm leading-6 md:text-[15px] md:leading-7",
  default: "text-base leading-8 md:text-[17px]",
  large: "text-[17px] leading-8 md:text-lg md:leading-9 lg:text-[19px]",
};

const paddingClasses: Record<NonNullable<QuizPassageProps["size"]>, string> = {
  compact: "px-3 py-2",
  default: "px-4 py-3",
  large: "px-4 py-3",
};

const renderMarkedSegment = (segment: QuizPassageSegment, key: React.Key) => {
  if (segment.type === "blankBox") {
    return (
      <span
        key={key}
        aria-label={`빈칸 ${segment.text}`}
        className="quiz-passage-blank-box"
        style={{
          width: `${Math.min(30, Math.max(1, segment.widthEm || 3))}em`,
        }}
      >
        {segment.text}
      </span>
    );
  }

  if (segment.type === "box" && isQuizPassageBlankLabel(segment.text)) {
    return (
      <span
        key={key}
        className="quiz-passage-label-box font-bold text-slate-950"
      >
        {segment.text}
      </span>
    );
  }
  if (segment.type === "blank") {
    const blankWidth = `${Math.min(Math.max(segment.text.length, 4), 14)}ch`;

    return (
      <span
        key={key}
        aria-label="빈칸"
        className={markClasses.blank}
        style={{ minWidth: blankWidth }}
      >
        &nbsp;
      </span>
    );
  }

  return (
    <span key={key} className={markClasses[segment.type]}>
      {segment.text}
    </span>
  );
};

const renderInlineSegments = (value: string, keyPrefix: string) =>
  parseQuizPassageMarkup(value).map((segment, index) => {
    if (segment.type === "text") {
      return (
        <React.Fragment key={`${keyPrefix}-text-${index}`}>
          {segment.text}
        </React.Fragment>
      );
    }

    if (segment.type === "bullet") {
      return (
        <React.Fragment key={`${keyPrefix}-bullet-${index}`}>
          {segment.text}
        </React.Fragment>
      );
    }

    return renderMarkedSegment(
      segment,
      `${keyPrefix}-${segment.type}-${index}`,
    );
  });

const QuizPassage: React.FC<QuizPassageProps> = ({
  value,
  className = "",
  size = "default",
  surface = "white",
}) => {
  let hangulIndex = 0;
  const sourceLines = String(value || "").split(/\r?\n/);
  const surfaceClass =
    surface === "muted"
      ? "border-slate-300 bg-slate-50"
      : "border-slate-300 bg-white";

  return (
    <div
      className={`quiz-passage whitespace-pre-wrap break-keep rounded-xl border font-medium text-slate-900 ${paddingClasses[size]} ${sizeClasses[size]} ${surfaceClass} ${className}`}
    >
      {sourceLines.map((line, index) => {
        const segment = parseQuizPassageMarkup(line)[0];
        if (segment?.type === "bullet") {
          const marker =
            segment.bulletStyle === "hangul"
              ? quizPassageHangulMarker(hangulIndex++)
              : "•";
          if (segment.bulletStyle !== "hangul") hangulIndex = 0;
          return (
            <div key={index} className="quiz-passage-list-row">
              <span className="quiz-passage-list-marker">{marker}</span>
              <span className="quiz-passage-list-text">
                {renderInlineSegments(segment.text, `bullet-${index}`)}
              </span>
            </div>
          );
        }

        hangulIndex = 0;
        const leading = splitQuizPassageLeadingLabel(line);
        if (leading)
          return (
            <div className="quiz-passage-label-row" key={index}>
              <span className="quiz-passage-leading-label">
                {renderInlineSegments(leading.label, `label-${index}`)}
                {leading.gap}
              </span>
              <span className="quiz-passage-list-text">
                {renderInlineSegments(leading.body, `body-${index}`)}
              </span>
            </div>
          );
        return (
          <div className="quiz-passage-text-line" key={index}>
            {line ? renderInlineSegments(line, `line-${index}`) : <br />}
          </div>
        );
      })}
    </div>
  );
};

export default QuizPassage;
