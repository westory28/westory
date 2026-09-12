import type { SemesterManifest } from "./semesterCore";

export const getHistoricalSemesters = (
  manifests: SemesterManifest[],
  activeSemesterId: string,
) =>
  manifests
    .filter(
      (item) =>
        /^\d{4}-[12]$/.test(item.semesterId) &&
        item.semesterId !== activeSemesterId &&
        (item.status === "CLOSED" || item.status === "ARCHIVED"),
    )
    .sort((left, right) => right.semesterId.localeCompare(left.semesterId));

export const assertArchiveResponse = <
  T extends {
    semesterId: string;
    provenance: string;
    readOnly: boolean;
  },
>(
  response: T,
  semesterId: string,
): T => {
  if (
    response.semesterId !== semesterId ||
    response.provenance !== "ARCHIVE" ||
    !response.readOnly
  ) {
    throw new Error(
      "조회 학기와 보관 상태가 일치하지 않습니다. 다시 불러와 주세요.",
    );
  }
  return response;
};

export const appendArchivePage = <T>(
  previous: T[],
  next: T[],
  key: (row: T) => string,
) => [
  ...new Map([...previous, ...next].map((row) => [key(row), row])).values(),
];

export const archiveDate = (value: unknown) => {
  const raw = value as { seconds?: number; _seconds?: number } | null;
  const seconds =
    raw && typeof raw === "object" ? (raw.seconds ?? raw._seconds) : undefined;
  const date =
    seconds !== undefined
      ? new Date(seconds * 1000)
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : null;
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    : "날짜 기록 없음";
};
