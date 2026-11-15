export type WrittenExamScoreContentKind = "objective" | "essay" | "mixed";

type WrittenExamScoreContent = {
  scoreContentKind?: unknown;
  items?: ReadonlyArray<{
    examSection?: unknown;
    questionNumber?: unknown;
    correctAnswer?: unknown;
    answerChoices?: unknown;
  }>;
};

type WrittenExamScoreIdentity = WrittenExamScoreContent & {
  title?: string;
  subject?: string;
  targetGrade?: string;
};

// Call only for a verified written-exam roster/upload. Older essay imports
// predate both scoreContentKind and examSection; they keep their existing ID.
export const getWrittenExamScoreContentKind = (
  value: WrittenExamScoreContent,
): WrittenExamScoreContentKind => {
  if (value.scoreContentKind === "mixed") return "mixed";
  let objective = value.scoreContentKind === "objective";
  let essay = value.scoreContentKind === "essay";
  for (const item of value.items || []) {
    if (item.examSection === "objective") objective = true;
    else if (item.examSection === "essay") essay = true;
    else if (
      item.questionNumber != null ||
      Boolean(item.correctAnswer) ||
      (Array.isArray(item.answerChoices) && item.answerChoices.length > 0)
    ) {
      objective = true;
    } else if (value.scoreContentKind !== "objective") {
      essay = true;
    }
  }
  return objective ? (essay ? "mixed" : "objective") : "essay";
};

const hasSameAssessmentName = (
  left: WrittenExamScoreIdentity,
  right: WrittenExamScoreIdentity,
) =>
  left.title === right.title &&
  left.subject === right.subject &&
  left.targetGrade === right.targetGrade;

export const isSameWrittenExamScoreAssessment = (
  left: WrittenExamScoreIdentity,
  right: WrittenExamScoreIdentity,
) =>
  hasSameAssessmentName(left, right) &&
  getWrittenExamScoreContentKind(left) ===
    getWrittenExamScoreContentKind(right);

export const assertWrittenExamScoreAssessmentCompatible = (
  rosters: ReadonlyArray<WrittenExamScoreIdentity>,
  incoming: WrittenExamScoreIdentity,
) => {
  const kind = getWrittenExamScoreContentKind(incoming);
  if (
    rosters.some((roster) => {
      if (!hasSameAssessmentName(roster, incoming)) return false;
      const storedKind = getWrittenExamScoreContentKind(roster);
      return (
        storedKind !== kind && (storedKind === "mixed" || kind === "mixed")
      );
    })
  ) {
    throw new Error(
      `${incoming.title}: 같은 평가명에 서답형·논술형이 섞인 점수표가 있습니다. 점수가 중복되지 않도록 기존 업로드 기록을 확인해 주세요.`,
    );
  }
};
