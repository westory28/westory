import React from "react";
import { parseQuizPassageMarkup } from "../../lib/quizPassageMarkup";

interface QuizPassageProps {
  value: string | null | undefined;
  className?: string;
  surface?: "white" | "muted";
}

const markClasses: Record<string, string> = {
  underline: "border-b-2 border-slate-900 pb-0.5 font-bold text-slate-950",
  box: "mx-0.5 inline rounded border-2 border-slate-800 px-1 py-0.5 font-bold text-slate-950",
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

    return (
      <span
        key={`${keyPrefix}-${segment.type}-${index}`}
        className={markClasses[segment.type]}
      >
        {segment.text}
      </span>
    );
  });

const QuizPassage: React.FC<QuizPassageProps> = ({
  value,
  className = "",
  surface = "white",
}) => {
  const segments = parseQuizPassageMarkup(value);
  const surfaceClass =
    surface === "muted"
      ? "border-slate-300 bg-slate-50"
      : "border-slate-300 bg-white";

  return (
    <div
      className={`whitespace-pre-wrap break-keep rounded-xl border px-4 py-3 text-base font-medium leading-8 text-slate-900 md:text-[17px] ${surfaceClass} ${className}`}
    >
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return <React.Fragment key={index}>{segment.text}</React.Fragment>;
        }

        if (segment.type === "bullet") {
          return (
            <div key={index} className="my-2 flex items-start gap-2">
              <span className="mt-2 h-2 w-2 shrink-0 rounded-full border-2 border-slate-900" />
              <span className="min-w-0 flex-1 whitespace-pre-wrap">
                {renderInlineSegments(segment.text, `bullet-${index}`)}
              </span>
            </div>
          );
        }

        return (
          <span key={index} className={markClasses[segment.type]}>
            {segment.text}
          </span>
        );
      })}
    </div>
  );
};

export default QuizPassage;
