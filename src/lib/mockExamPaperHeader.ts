import { getMockExamRoundNumber } from "./mockExamRounds";

export const MOCK_EXAM_PAPER_TITLE_LIMIT = 60;
export const MOCK_EXAM_PAPER_HEADING_LIMIT = 80;
export interface MockExamPaperHeaderSettings {
  paperTitle?: string;
  paperHeading?: string;
}
const clean = (value: unknown, limit: number) =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, limit)
    : "";
export function normalizeMockExamPaperHeader(
  value: unknown,
): MockExamPaperHeaderSettings {
  const source =
    value && typeof value === "object"
      ? (value as MockExamPaperHeaderSettings)
      : {};
  return {
    paperTitle: clean(source.paperTitle, MOCK_EXAM_PAPER_TITLE_LIMIT),
    paperHeading: clean(source.paperHeading, MOCK_EXAM_PAPER_HEADING_LIMIT),
  };
}
export function getMockExamPaperTitle(
  round: unknown,
  settings?: MockExamPaperHeaderSettings,
) {
  const custom = normalizeMockExamPaperHeader(settings).paperTitle;
  if (custom) return custom;
  const number = getMockExamRoundNumber(round);
  const name = ["초시", "복시", "전시"][number - 1] || `${number}회`;
  return `중학교 3학년 역사과 ${name}(역사과 ${number}회 모의고사)`;
}
