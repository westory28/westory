import { auth } from "./firebase";
import { ensureSensitiveOperation } from "./sensitiveOperation";
import { callWisStockService } from "./wisStocksClient";

export type ReportScope = { year: string; semester: string };
export type WeeklyReportSummary = {
  weekStart: string;
  title: string;
  revision: number;
  publishedAtMs: number;
  fileName: string;
  format: "pdf" | "md" | "txt";
  byteLength: number;
};
export type WeeklyReport = WeeklyReportSummary & { contentBase64: string };
export type ReportUpload = Pick<WeeklyReport, "contentBase64" | "fileName">;
const endpoint = "manageWisStockWeeklyReport";

export const readWeeklyReport = (scope: ReportScope, weekStart: string) =>
  callWisStockService<{ report: WeeklyReport | null }>(endpoint, {
    ...scope,
    weekStart,
    action: "read",
  });
export const listWeeklyReports = (scope: ReportScope, before?: string) =>
  callWisStockService<{
    reports: WeeklyReportSummary[];
    nextBefore: string | null;
  }>(endpoint, {
    ...scope,
    action: "list",
    ...(before ? { before } : {}),
  });

export async function publishWeeklyReport(
  scope: ReportScope,
  weekStart: string,
  title: string,
  file: ReportUpload,
  expectedRevision: number,
  signal: AbortSignal,
) {
  const owner = auth.currentUser;
  await ensureSensitiveOperation();
  signal.throwIfAborted();
  if (!owner || owner !== auth.currentUser)
    throw new Error("계정이 바뀌었습니다. 다시 열어 주세요.");
  return callWisStockService<{ report: WeeklyReportSummary }>(endpoint, {
    ...scope,
    weekStart,
    action: "publish",
    title,
    ...file,
    expectedRevision,
  });
}

export async function weeklyMarketData(
  scope: ReportScope,
  weekStart: string,
  signal: AbortSignal,
) {
  const owner = auth.currentUser;
  const seen = new Set<string>();
  let continuation: string | undefined;
  for (;;) {
    signal.throwIfAborted();
    if (!owner || owner !== auth.currentUser)
      throw new Error("계정이 바뀌었습니다. 다시 열어 주세요.");
    const data = await callWisStockService<Record<string, unknown>>(
      "exportWisStockWeeklyReportData",
      {
        ...scope,
        weekStart,
        ...(continuation ? { continuation } : {}),
      },
    );
    signal.throwIfAborted();
    if (owner !== auth.currentUser)
      throw new Error("계정이 바뀌었습니다. 다시 열어 주세요.");
    if (typeof data.continuation !== "string") {
      if (
        data.semesterId !== `${scope.year}-${scope.semester}` ||
        data.weekStart !== weekStart
      )
        throw new Error("선택한 주차의 분석 자료를 확인하지 못했습니다.");
      return data;
    }
    continuation = data.continuation;
    if (!continuation || seen.has(continuation))
      throw new Error("분석 자료를 이어받지 못했습니다. 다시 시도해 주세요.");
    seen.add(continuation);
  }
}

export function readReportUpload(file: File): Promise<ReportUpload> {
  return new Promise((resolve, reject) => {
    if (
      !/\.(pdf|md|txt)$/i.test(file.name) ||
      file.size === 0 ||
      file.size > 3 * 1024 * 1024
    ) {
      reject(
        new Error("3MB 이하의 PDF, Markdown 또는 텍스트 파일을 선택해 주세요."),
      );
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("보고서 파일을 읽지 못했습니다."));
    reader.onload = () => {
      const contentBase64 = String(reader.result).split(",")[1];
      if (!contentBase64) reject(new Error("보고서 본문을 확인해 주세요."));
      else resolve({ fileName: file.name, contentBase64 });
    };
    reader.readAsDataURL(file);
  });
}
