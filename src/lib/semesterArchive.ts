export type ArchiveScope = { year: string; semester: string };

export const parseArchiveScope = (value: unknown): ArchiveScope | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const year = String(source.year || "").trim();
  const semester = String(source.semester || "").trim();
  return /^\d{4}$/.test(year) && ["1", "2"].includes(semester)
    ? { year, semester }
    : null;
};

export const archiveSemesterOrder = (scope: ArchiveScope) =>
  Number(scope.year) * 2 + Number(scope.semester);
export const archiveSemesterLabel = (scope: ArchiveScope) =>
  `${scope.year}학년도 ${scope.semester}학기`;

const params = new URLSearchParams(
  typeof window === "undefined" ? "" : window.location.search,
);
// Capture once, outside React. Invalid or partial URLs must also stay read-only.
// HashRouter navigation cannot remove this protection or change the semester.
export const isSemesterArchive =
  params.has("archiveYear") || params.has("archiveSemester");
export const archiveScope = parseArchiveScope({
  year: params.get("archiveYear"),
  semester: params.get("archiveSemester"),
});
export const ARCHIVE_READ_ONLY_MESSAGE =
  "이전 학기 조회 창에서는 변경 사항을 저장할 수 없습니다. 현재 학기 데이터는 변경되지 않았습니다.";
export const assertArchiveWritable = () => {
  if (!isSemesterArchive) return;
  const error = new Error(ARCHIVE_READ_ONLY_MESSAGE);
  Object.assign(error, { code: "archive/read-only" });
  throw error;
};

// These old root collections are fallback sources for semester-owned data.
// In the archive they resolve to the selected semester, never live legacy data.
const legacySemesterCollections = new Set([
  "curriculum",
  "lessons",
  "map_resources",
  "history_classrooms",
  "history_classroom_results",
  "quiz_questions",
  "quiz_results",
]);
export const getArchiveReadPath = (path: string) => {
  if (!isSemesterArchive) return path;
  if (!archiveScope) throw new Error("조회할 연도와 학기를 확인해 주세요.");
  const prefix = `years/${archiveScope.year}/semesters/${archiveScope.semester}`;
  if (/^years\/[^/]+\/semesters\/[^/]+(?:\/|$)/.test(path)) {
    return path.replace(/^years\/[^/]+\/semesters\/[^/]+/, prefix);
  }
  if (legacySemesterCollections.has(path.split("/")[0])) {
    return `${prefix}/${path}`;
  }
  return path;
};

export const getPreviousArchiveSemesters = (data: unknown) => {
  const active = parseArchiveScope(data);
  if (!active) throw new Error("운영 학기를 확인하지 못했습니다.");
  const registry = new Map<string, ArchiveScope>();
  const available = (data as Record<string, unknown>).availableSemesters;
  if (Array.isArray(available)) {
    available.forEach((item) => {
      const scope = parseArchiveScope(item);
      if (scope && archiveSemesterOrder(scope) < archiveSemesterOrder(active)) {
        registry.set(`${scope.year}-${scope.semester}`, scope);
      }
    });
  }
  return {
    active,
    previous: [...registry.values()].sort(
      (a, b) => archiveSemesterOrder(b) - archiveSemesterOrder(a),
    ),
  };
};

export const buildSemesterArchiveUrl = (scope: ArchiveScope, base: string) => {
  if (!parseArchiveScope(scope))
    throw new Error("조회할 학기를 확인해 주세요.");
  const url = new URL(base);
  url.search = "";
  url.searchParams.set("archiveYear", scope.year);
  url.searchParams.set("archiveSemester", scope.semester);
  url.hash = "/teacher/dashboard";
  return url.href;
};
