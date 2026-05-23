export type LessonTreeSelectionNode = {
  id: string;
  title: string;
  children?: LessonTreeSelectionNode[];
};

export type LessonTreeSelectionMeta = {
  unitId?: string;
  title?: string;
  updatedAt?: unknown;
  createdAt?: unknown;
  isVisibleToStudents?: boolean;
};

export type LessonTreeSelectionTarget = {
  node: LessonTreeSelectionNode;
  pathIds: string[];
};

const getTimestampMs = (value: unknown) => {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  const timestamp = value as {
    toDate?: () => Date;
    seconds?: number;
    nanoseconds?: number;
  };
  if (typeof timestamp.toDate === "function") {
    const date = timestamp.toDate();
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }
  if (typeof timestamp.seconds === "number") {
    return (
      timestamp.seconds * 1000 +
      Math.floor((Number(timestamp.nanoseconds) || 0) / 1_000_000)
    );
  }

  return 0;
};

export const getLessonTreeMetaTimestampMs = (meta: LessonTreeSelectionMeta) =>
  getTimestampMs(meta.updatedAt || meta.createdAt);

export const findLessonTreeSelectionByUnitId = (
  tree: LessonTreeSelectionNode[],
  unitId: string,
): LessonTreeSelectionTarget | null => {
  const targetUnitId = String(unitId || "").trim();
  if (!targetUnitId) return null;

  const visit = (
    nodes: LessonTreeSelectionNode[],
    pathIds: string[],
  ): LessonTreeSelectionTarget | null => {
    for (const node of nodes) {
      const nextPath = [...pathIds, node.id];
      if (node.id === targetUnitId) return { node, pathIds: nextPath };
      const found = visit(node.children || [], nextPath);
      if (found) return found;
    }
    return null;
  };

  return visit(tree, []);
};

export const findLatestLessonTreeSelection = (
  tree: LessonTreeSelectionNode[],
  lessons: LessonTreeSelectionMeta[],
  options?: { visibleOnly?: boolean },
): LessonTreeSelectionTarget | null => {
  const rankedLessons = lessons
    .map((lesson, index) => ({
      lesson,
      index,
      timestampMs: getLessonTreeMetaTimestampMs(lesson),
      unitId: String(lesson.unitId || "").trim(),
    }))
    .filter((item) => {
      if (!item.unitId || item.timestampMs <= 0) return false;
      if (options?.visibleOnly && item.lesson.isVisibleToStudents === false) {
        return false;
      }
      return true;
    })
    .sort(
      (left, right) =>
        right.timestampMs - left.timestampMs || left.index - right.index,
    );

  for (const item of rankedLessons) {
    const selection = findLessonTreeSelectionByUnitId(tree, item.unitId);
    if (selection) return selection;
  }

  return null;
};
