import React from "react";
import "./quizPassage.css";

// Render only: do not rewrite the saved stem or apply this to choices/answers.
// Match complete negative modifiers, not fragments in ordinary words or
// narrative endings such as "않았다" / "아닌가".
const negativeDirection =
  /(?<![\p{L}\p{N}_])(적절하지\s+않은|잘못된|틀린|확인할\s+수\s+없는|판단할\s+수\s+없는|단정할\s+수\s+없는|수정해야\s+할|아닌|않은|않는|없는)(?![\p{L}\p{N}_])/gu;
const questionReference =
  /(〈보기〉|<보기>|(?<![\p{L}\p{N}_])(?:이|그)[ \t]+[가-힣]+)/gu;

const renderReferences = (value: string) =>
  value.split(questionReference).map((part, index) =>
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
    {value.split(negativeDirection).map((part, index) =>
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
