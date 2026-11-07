import React from "react";

// Render only: do not rewrite the saved stem or apply this to choices/answers.
// Match complete negative modifiers, not fragments in ordinary words or
// narrative endings such as "않았다" / "아닌가".
const negativeDirection =
  /(?<![\p{L}\p{N}_])(옳지\s+않은|적절하지\s+않은|잘못된|틀린|확인할\s+수\s+없는|판단할\s+수\s+없는|단정할\s+수\s+없는|수정해야\s+할|아닌|않은|않는|없는)(?![\p{L}\p{N}_])/gu;

const QuizQuestionText = ({ value }: { value: string }) => (
  <>
    {value.split(negativeDirection).map((part, index) =>
      index % 2 ? (
        <u
          key={index}
          className="quiz-question-negative"
          style={{
            textUnderlineOffset: "0.2em",
            textDecorationThickness: "1px",
          }}
        >
          {part}
        </u>
      ) : (
        <React.Fragment key={index}>{part}</React.Fragment>
      ),
    )}
  </>
);

export default QuizQuestionText;
