import React from "react";
import "./quizPassage.css";

// Render only: do not rewrite the saved stem or apply this to choices/answers.
// Match complete negative modifiers, not fragments in ordinary words or
// narrative endings such as "않았다" / "아닌가".
const negativeDirection =
  /(?:적절하지\s+않은|잘못된|틀린|확인할\s+수\s+없는|판단할\s+수\s+없는|단정할\s+수\s+없는|수정해야\s+할|아닌|않은|않는|없는)(?![\p{L}\p{N}_])/gu;
const questionReference = /〈보기〉|<보기>|(?:이|그)[ \t]+[가-힣]+/gu;
const wordBefore = /[\p{L}\p{N}_]$/u;

// Older Safari cannot parse lookbehind. Check the preceding character in JS
// without consuming it: adjacent references may share that boundary.
const splitMarkedText = (
  value: string,
  pattern: RegExp,
  allowInlineReference = false,
) => {
  const parts: string[] = [];
  const matcher = new RegExp(pattern);
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(value))) {
    const text = match[0];
    const start = match.index;
    const inlineReference =
      allowInlineReference && (text === "〈보기〉" || text === "<보기>");
    if (!inlineReference && wordBefore.test(value.slice(0, start))) {
      // A rejected phrase can contain another valid match after a space.
      matcher.lastIndex = start + 1;
      continue;
    }
    parts.push(value.slice(cursor, start), text);
    cursor = start + text.length;
  }
  parts.push(value.slice(cursor));
  return parts;
};

const renderReferences = (value: string) =>
  splitMarkedText(value, questionReference, true).map((part, index) =>
    index % 2 ? (
      <span key={index} className="quiz-question-keep">
        {part}
      </span>
    ) : (
      <React.Fragment key={index}>{part}</React.Fragment>
    ),
  );

const QuizQuestionText = ({ value }: { value: string }) => (
  <span className="quiz-question-text">
    {splitMarkedText(value, negativeDirection).map((part, index) =>
      index % 2 ? (
        <u
          key={index}
          className="quiz-question-negative quiz-question-keep"
          style={{
            textUnderlineOffset: "0.2em",
            textDecorationThickness: "1px",
          }}
        >
          {part}
        </u>
      ) : (
        <React.Fragment key={index}>{renderReferences(part)}</React.Fragment>
      ),
    )}
  </span>
);

export default QuizQuestionText;
