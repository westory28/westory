import { normalizeScoreWorkbookNamespaces } from "./scoreWorkbookReader";
import {
  parseWrittenExamQuestionInfo,
  parseWrittenExamResponses,
  type WrittenExamImportedStudent,
  type WrittenExamQuestionInfo,
} from "./writtenExamAnalysisImport";

type AnalysisSheet = { sheet: string; data: unknown[][] };
const readableError = (error: unknown) =>
  error instanceof Error ? error.message : "파일 형식을 확인해 주세요.";
const meaningful = (value: unknown) => String(value ?? "").trim().length > 0;

/** v9's default reader returns every worksheet. Never select only the first one. */
async function readAnalysisSheets(file: File): Promise<AnalysisSheet[]> {
  if (file.size > 20 * 1024 * 1024)
    throw new Error("점수 파일은 20MB 이하로 선택해 주세요.");
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const normalized = await normalizeScoreWorkbookNamespaces(
    await file.arrayBuffer(),
  );
  const result: unknown = await readXlsxFile(new Blob([normalized]));
  if (!Array.isArray(result)) throw new Error("엑셀 시트를 읽지 못했습니다.");
  const sheets: AnalysisSheet[] = result.map((value, index) => {
    if (!value || typeof value !== "object" || !Array.isArray(value.data))
      throw new Error(`${index + 1}번째 엑셀 시트의 내용을 읽지 못했습니다.`);
    if (value.data.some((row: unknown) => !Array.isArray(row)))
      throw new Error(
        `‘${String(value.sheet || index + 1)}’ 시트의 행 형식이 올바르지 않습니다.`,
      );
    return { sheet: String(value.sheet || `${index + 1}번`), data: value.data };
  });
  const nonEmpty = sheets.filter((sheet) =>
    sheet.data.some((row) => row.some(meaningful)),
  );
  if (!nonEmpty.length) throw new Error("내용이 있는 엑셀 시트가 없습니다.");
  return nonEmpty;
}

const questionSignature = (question: WrittenExamQuestionInfo) =>
  JSON.stringify({
    ...question,
    achievementStandardCodes: [...question.achievementStandardCodes].sort(),
    concepts: [...question.concepts].sort(),
  });

export async function readWrittenExamInfoWorkbook(file: File): Promise<{
  questions: WrittenExamQuestionInfo[];
  warnings: string[];
}> {
  const sheets = await readAnalysisSheets(file);
  const byNumber = new Map<
    number,
    { question: WrittenExamQuestionInfo; sheet: string }
  >();
  const warnings: string[] = [];
  for (const sheet of sheets) {
    try {
      const parsed = parseWrittenExamQuestionInfo(sheet.data, {
        fileName: file.name,
        allowPartialSequence: true,
      });
      for (const question of parsed.questions) {
        const previous = byNumber.get(question.number);
        if (
          previous &&
          questionSignature(previous.question) !== questionSignature(question)
        )
          throw new Error(
            `${question.number}번 문항정보가 ‘${previous.sheet}’ 시트와 다릅니다. 정답·배점·분석 정보를 확인해 주세요.`,
          );
        if (!previous)
          byNumber.set(question.number, { question, sheet: sheet.sheet });
      }
      warnings.push(
        ...parsed.warnings.map(
          (warning) => `‘${sheet.sheet}’ 시트: ${warning}`,
        ),
      );
    } catch (error) {
      throw new Error(`‘${sheet.sheet}’ 시트: ${readableError(error)}`);
    }
  }
  const questions = [...byNumber.values()]
    .map((entry) => entry.question)
    .sort((a, b) => a.number - b.number);
  const missing = Array.from(
    { length: questions.at(-1)?.number || 0 },
    (_, index) => index + 1,
  ).filter((number) => !byNumber.has(number));
  if (missing.length)
    throw new Error(
      `문항정보표의 전체 시트(‘${sheets.map((sheet) => sheet.sheet).join("’, ‘")}’)에 ${missing.join(", ")}번이 없습니다. 1번부터 끝번호까지 확인해 주세요.`,
    );
  return { questions, warnings: [...new Set(warnings)] };
}

export async function readWrittenExamResponsesWorkbook(
  file: File,
  options: { questions: WrittenExamQuestionInfo[]; targetGrade: string },
): Promise<{ students: WrittenExamImportedStudent[]; warnings: string[] }> {
  const sheets = await readAnalysisSheets(file);
  const students: WrittenExamImportedStudent[] = [];
  const keys = new Map<string, string>();
  const uids = new Map<string, string>();
  const warnings: string[] = [];
  for (const sheet of sheets) {
    try {
      const classMatch = /^(\d+)반$/.exec(sheet.sheet.trim());
      const parsed = parseWrittenExamResponses(sheet.data, {
        ...options,
        fileName: file.name,
        fallbackClass: classMatch ? String(Number(classMatch[1])) : undefined,
      });
      for (const student of parsed.students) {
        const duplicateSheet =
          keys.get(student.key) ||
          (student.uid ? uids.get(student.uid) : undefined);
        if (duplicateSheet)
          throw new Error(
            `${student.grade}학년 ${student.class}반 ${student.number}번이 ‘${duplicateSheet}’ 시트와 중복됩니다.`,
          );
        keys.set(student.key, sheet.sheet);
        if (student.uid) uids.set(student.uid, sheet.sheet);
        students.push(student);
      }
      warnings.push(
        ...parsed.warnings.map(
          (warning) => `‘${sheet.sheet}’ 시트: ${warning}`,
        ),
      );
    } catch (error) {
      throw new Error(`‘${sheet.sheet}’ 시트: ${readableError(error)}`);
    }
  }
  return { students, warnings: [...new Set(warnings)] };
}
