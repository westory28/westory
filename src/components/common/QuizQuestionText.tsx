import React from "react";

// Exam stems keep their stored plain text; emphasize the negative direction
// consistently in the teacher preview and student question without HTML input.
const negativeDirection =
  /(옳지 않은|적절하지 않은|잘못된|틀린|확인할 수 없는|판단할 수 없는|단정할 수 없는|수정해야 할)/g;

const QuizQuestionText = ({ value }: { value: string }) => (
  <>
    {value.split(negativeDirection).map((part, index) =>
      index % 2 ? (
        <u key={index} style={{ textUnderlineOffset: "0.2em" }}>
          {part}
        </u>
      ) : (
        <React.Fragment key={index}>{part}</React.Fragment>
      ),
    )}
  </>
);

export default QuizQuestionText;
