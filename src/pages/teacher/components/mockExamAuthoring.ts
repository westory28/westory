import { MOCK_EXAM_ROUNDS } from "../../../lib/mockExamRounds";

const collator = new Intl.Collator("ko");

/** Keep the option text, image and source index together; answers use the text. */
export const sortMockExamChoices = <T extends { text: string }>(
  items: T[],
): T[] =>
  [...items].sort(
    (a, b) =>
      Array.from(a.text.trim()).length - Array.from(b.text.trim()).length ||
      collator.compare(a.text.trim(), b.text.trim()),
  );

export const validateMockExamPlacement = (value: {
  examRound?: string;
  paperOrder?: number;
  points?: number;
}) => {
  if (!MOCK_EXAM_ROUNDS.includes(value.examRound || ""))
    return "초시·복시·전시 중 회차를 선택해 주세요.";
  if (
    !Number.isInteger(value.paperOrder) ||
    Number(value.paperOrder) < 1 ||
    Number(value.paperOrder) > 200
  )
    return "문항 번호는 1~200의 정수로 입력해 주세요.";
  if (
    !Number.isFinite(value.points) ||
    Number(value.points) < 0.01 ||
    Number(value.points) > 100
  )
    return "배점은 0보다 크고 100 이하인 수로 입력해 주세요.";
  if (
    Math.abs(
      Number(value.points) * 100 - Math.round(Number(value.points) * 100),
    ) > 0.00000001
  )
    return "배점은 소수 둘째 자리까지만 입력해 주세요.";
  return "";
};

export const mockExamQuestionSizeError = (question: object) =>
  new TextEncoder().encode(JSON.stringify(question)).byteLength > 92 * 1024
    ? "문항과 이미지 용량이 너무 큽니다. 이미지를 줄이거나 HTTPS 이미지 주소를 사용해 주세요."
    : "";
