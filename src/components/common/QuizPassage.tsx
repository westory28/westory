import React from "react";
import {
  parseQuizPassageMarkup,
  type QuizPassageSegment,
} from "../../lib/quizPassageMarkup";

interface QuizPassageProps {
  value: string | null | undefined;
  className?: string;
  size?: "compact" | "default" | "large";
  surface?: "white" | "muted";
}

const markClasses: Record<string, string> = {
  underline: "border-b-2 border-slate-900 pb-0.5 font-bold text-slate-950",
  box: "mx-0 inline-block whitespace-nowrap rounded border-2 border-slate-800 px-3 py-0.5 font-bold text-slate-950",
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

const isLineBreakTextSegment = (segment: QuizPassageSegment | undefined) =>
  segment?.type === "text" && /^\r?\n+$/.test(segment.text);

const isBulletSegment = (segment: QuizPassageSegment | undefined) =>
  segment?.type === "bullet";

const renderMarkedSegment = (segment: QuizPassageSegment, key: React.Key) => {
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
  const segments = parseQuizPassageMarkup(value);
  const surfaceClass =
    surface === "muted"
      ? "border-slate-300 bg-slate-50"
      : "border-slate-300 bg-white";

  return (
    <div
      className={`whitespace-pre-wrap break-keep rounded-xl border font-medium text-slate-900 ${paddingClasses[size]} ${sizeClasses[size]} ${surfaceClass} ${className}`}
    >
      {segments.map((segment, index) => {
        if (
          isLineBreakTextSegment(segment) &&
          (isBulletSegment(segments[index - 1]) ||
            isBulletSegment(segments[index + 1]))
        ) {
          return null;
        }

        if (segment.type === "text") {
          return <React.Fragment key={index}>{segment.text}</React.Fragment>;
        }

        if (segment.type === "bullet") {
          return (
            <div key={index} className="my-1 flex items-start gap-2">
              <span className="mt-2 h-2 w-2 shrink-0 rounded-full border-2 border-slate-900" />
              <span className="min-w-0 flex-1 whitespace-pre-wrap">
                {renderInlineSegments(segment.text, `bullet-${index}`)}
              </span>
            </div>
          );
        }

        return renderMarkedSegment(segment, index);
      })}
    </div>
  );
};

export default QuizPassage;
