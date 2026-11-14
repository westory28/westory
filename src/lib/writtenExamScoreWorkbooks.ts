import { normalizeScoreWorkbookNamespaces } from "./scoreWorkbookReader";
import {
  parseWrittenExamEssayScoreWorkbook,
  type ParsedWrittenExamEssayScoreUpload,
} from "./writtenExamEssayScoreWorkbook";

type ParseOptions = Parameters<typeof parseWrittenExamEssayScoreWorkbook>[1];
type Source = { fileName: string; sheetName: string; rows: unknown[][] };
const text = (value: unknown) => String(value ?? "").trim();
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const sourceLabel = (source: Source) =>
  `‘${source.fileName}’의 ‘${source.sheetName}’ 시트`;
const inferredClass = (value: string) => {
  const match = /^(\d+)반(?:\.xlsx)?$/i.exec(value.trim());
  return match ? String(Number(match[1])) : "";
};
const itemSignature = (upload: ParsedWrittenExamEssayScoreUpload) =>
  JSON.stringify({
    kind: upload.scoreContentKind,
    totalMaxScore: upload.totalMaxScore,
    items: upload.items.map(
      ({
        itemKey,
        name,
        maxScore,
        examSection,
        questionNumber,
        correctAnswer,
        answerChoices,
      }) => ({
        itemKey,
        name,
        maxScore,
        examSection,
        questionNumber,
        correctAnswer,
        answerChoices,
      }),
    ),
  });

/** All files and all nonempty sheets form one reviewable upload, or none do. */
export function mergeWrittenExamScoreSheets(
  sources: Source[],
  options: Omit<ParseOptions, "fileName" | "rowLimit">,
): ParsedWrittenExamEssayScoreUpload {
  if (!sources.length) throw new Error("내용이 있는 점수표 시트가 없습니다.");
  let merged: ParsedWrittenExamEssayScoreUpload | null = null;
  let signature = "";
  let explicitTitle = "";
  const identities = new Map<string, string>();
  const sourceNames: string[] = [];
  for (const source of sources) {
    const label = sourceLabel(source);
    try {
      const parsed = parseWrittenExamEssayScoreWorkbook(source.rows, {
        ...options,
        fileName: source.fileName,
        fallbackClass:
          inferredClass(source.sheetName) ||
          inferredClass(source.fileName) ||
          options.fallbackClass,
        rowLimit: Number.MAX_SAFE_INTEGER,
      });
      if (merged && signature !== itemSignature(parsed))
        throw new Error(
          "다른 파일·시트와 문항번호·정답·배점 또는 논술형 평가 항목이 다릅니다.",
        );
      if (merged && clean(merged.subject) !== clean(parsed.subject))
        throw new Error("다른 파일·시트와 과목이 다릅니다.");
      // Filenames differ between classes. Only explicit workbook exam headings
      // can establish that two sheets describe different assessments.
      const heading = source.rows
        .slice(0, parsed.headerRowNumber - 1)
        .flatMap((row) =>
          row.map((cell, index) => {
            const value = text(cell);
            return (
              /^(?:평가|평가명)\s*[:：]\s*(.+)$/.exec(value)?.[1] ||
              (/^(?:평가|평가명)$/.test(value) ? text(row[index + 1]) : "")
            );
          }),
        )
        .find(Boolean);
      const ownTitle = clean(heading || "");
      if (ownTitle && explicitTitle && ownTitle !== explicitTitle)
        throw new Error(
          "다른 파일·시트와 평가명이 다릅니다. 같은 시험의 학급별 파일을 선택해 주세요.",
        );
      if (ownTitle) explicitTitle = ownTitle;
      const rows = parsed.rows.map((row) => {
        if (
          !/^\d+$/.test(row.grade) ||
          !/^\d+$/.test(row.class) ||
          !/^\d+$/.test(row.number) ||
          Number(row.grade) < 1 ||
          Number(row.class) < 1 ||
          Number(row.number) < 1
        )
          throw new Error(`${row.rowNumber}행의 학년·반·번호를 확인해 주세요.`);
        if (row.grade !== String(Number(options.targetGrade)))
          throw new Error(
            `${row.rowNumber}행의 학년이 선택한 대상 학년과 다릅니다.`,
          );
        const identity = `${Number(row.grade)}-${Number(row.class)}-${Number(row.number)}`;
        if (identities.has(identity))
          throw new Error(
            `${row.grade}학년 ${row.class}반 ${row.number}번이 ${identities.get(identity)}와 중복됩니다.`,
          );
        identities.set(identity, label);
        return { ...row, rowKey: `written-${identity}` };
      });
      if (!merged) {
        merged = { ...parsed, rows: [] };
        signature = itemSignature(parsed);
      }
      merged.rows.push(...rows);
      if (!sourceNames.includes(source.fileName))
        sourceNames.push(source.fileName);
    } catch (error) {
      throw new Error(
        `${label}: ${error instanceof Error ? error.message : "파일 형식을 확인해 주세요."}`,
      );
    }
  }
  if (!merged) throw new Error("분석할 점수표를 찾지 못했습니다.");
  merged.sourceFileName = sourceNames.join(", ");
  merged.detectedClasses = [
    ...new Set(merged.rows.map((row) => row.class)),
  ].sort((a, b) => Number(a) - Number(b));
  return merged;
}

export async function readWrittenExamScoreWorkbooks(
  files: File[],
  options: Omit<ParseOptions, "fileName" | "rowLimit">,
) {
  if (!files.length) throw new Error("점수표 파일을 선택해 주세요.");
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sources: Source[] = [];
  for (const file of files) {
    try {
      if (file.size > 20 * 1024 * 1024)
        throw new Error("점수 파일은 20MB 이하로 선택해 주세요.");
      const data = await normalizeScoreWorkbookNamespaces(
        await file.arrayBuffer(),
      );
      const sheets = await readXlsxFile(new Blob([data]));
      let nonempty = 0;
      for (const sheet of sheets) {
        if (!sheet.data.some((row) => row.some((value) => text(value))))
          continue;
        nonempty++;
        sources.push({
          fileName: file.name,
          sheetName: sheet.sheet,
          rows: sheet.data,
        });
      }
      if (!nonempty) throw new Error("내용이 있는 점수표 시트가 없습니다.");
    } catch (error) {
      throw new Error(
        `‘${file.name}’: ${error instanceof Error ? error.message : "엑셀 파일을 읽지 못했습니다."}`,
      );
    }
  }
  return mergeWrittenExamScoreSheets(sources, options);
}
