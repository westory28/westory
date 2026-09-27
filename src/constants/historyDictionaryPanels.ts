export const HISTORY_DICTIONARY_PATH = "/teacher/lesson/history-dictionary";

export const HISTORY_DICTIONARY_PANELS = [
  { id: "terms", name: "등록된 단어" },
  { id: "studentWords", name: "학생 등록 단어" },
  { id: "requests", name: "학생 요청 단어" },
  { id: "upload", name: "Excel 업로드" },
] as const;

export type HistoryDictionaryPanel =
  (typeof HISTORY_DICTIONARY_PANELS)[number]["id"];

export const getHistoryDictionaryPanel = (
  params: URLSearchParams,
  canWrite: boolean,
): HistoryDictionaryPanel => {
  if (params.get("requestId")) return "requests";
  const panel = params.get("panel");
  if (panel === "upload") return canWrite ? "upload" : "terms";
  if (panel === "studentWords" || panel === "requests") return panel;
  return "terms";
};
