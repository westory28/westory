import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import type { SystemConfig } from "../types";
import { db } from "./firebase";
import type { HistoryClassroomAssignment } from "./historyClassroom";
import { normalizeLessonData, type LessonData } from "./lessonData";
import type { LessonTreeSelectionNode } from "./lessonTreeSelection";
import type { MapResource } from "./mapResources";
import { getSemesterCollectionPath, getSemesterDocPath } from "./semesterScope";

export interface HistoryClassroomLessonSource extends MapResource {
  lessonUnitId: string;
  lessonTitle: string;
  lessonUnitPath: string[];
  lessonUnitPathIds: string[];
}

export const getHistoryClassroomLessonSelectLevels = (
  sources: HistoryClassroomLessonSource[],
  selectedSourceId: string,
) => {
  const selected = sources.find((source) => source.id === selectedSourceId);
  const selectedPath = selected?.lessonUnitPathIds || [];
  const levels: {
    value: string;
    options: { value: string; title: string; sourceId: string }[];
  }[] = [];
  const maxDepth = Math.max(
    0,
    ...sources.map((source) => source.lessonUnitPathIds.length),
  );
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const candidates = sources.filter((source) =>
      selectedPath
        .slice(0, depth)
        .every((id, index) => source.lessonUnitPathIds[index] === id),
    );
    const options = new Map<
      string,
      { value: string; title: string; sourceId: string }
    >();
    candidates.forEach((source) => {
      const nodeId = source.lessonUnitPathIds[depth];
      if (nodeId && !options.has(nodeId)) {
        options.set(nodeId, {
          value: nodeId,
          title: source.lessonUnitPath[depth],
          sourceId: source.id,
        });
      }
    });
    if (!options.size) break;
    // A curriculum node may have both its own worksheet and child worksheets.
    const ownSource = candidates.find(
      (source) => source.lessonUnitPathIds.length === depth,
    );
    if (ownSource)
      options.set(`source:${ownSource.id}`, {
        value: `source:${ownSource.id}`,
        title: "이 목차 자료",
        sourceId: ownSource.id,
      });
    levels.push({
      value:
        selectedPath[depth] ||
        (ownSource?.id === selectedSourceId
          ? `source:${selectedSourceId}`
          : ""),
      options: [...options.values()],
    });
    if (!selectedPath[depth]) break;
  }
  return levels;
};

export const getHistoryClassroomSourceId = (
  assignment: HistoryClassroomAssignment,
) =>
  assignment.sourceType === "lesson"
    ? `lesson:${assignment.lessonUnitId}`
    : assignment.mapResourceId;

export const getHistoryClassroomSourceFields = (resource: MapResource) => {
  if ("lessonUnitId" in resource) {
    const lesson = resource as HistoryClassroomLessonSource;
    return {
      sourceType: "lesson" as const,
      lessonUnitId: lesson.lessonUnitId,
      lessonTitle: lesson.lessonTitle,
      lessonUnitPath: lesson.lessonUnitPath,
      mapResourceId: "",
      mapTitle: "",
    };
  }
  return {
    sourceType: "map" as const,
    lessonUnitId: "",
    lessonTitle: "",
    lessonUnitPath: [],
    mapResourceId: resource.id,
    mapTitle: resource.title,
  };
};

// The curriculum owns order and grouping. Scoped lessons shadow legacy lessons
// by unit, including empty scoped documents, just as the lesson editor does.
export const buildHistoryClassroomLessonSources = (
  tree: LessonTreeSelectionNode[],
  scopedLessons: LessonData[],
  legacyLessons: LessonData[],
): HistoryClassroomLessonSource[] => {
  const lessonsByUnit = new Map<string, LessonData>();
  [...legacyLessons, ...scopedLessons].forEach((lesson) => {
    if (lesson.unitId) lessonsByUnit.set(lesson.unitId, lesson);
  });
  const sources: HistoryClassroomLessonSource[] = [];
  const visit = (
    nodes: LessonTreeSelectionNode[],
    parents: string[],
    parentIds: string[],
  ) => {
    nodes.forEach((node) => {
      const path = [...parents, node.title];
      const pathIds = [...parentIds, node.id];
      const raw = lessonsByUnit.get(node.id);
      if (raw) {
        const lesson = normalizeLessonData(raw, {
          unitId: node.id,
          title: node.title,
        });
        const pages = lesson.worksheetPageImages;
        const validPages = new Map(
          pages
            .filter((page) => page.width > 0 && page.height > 0)
            .map((page) => [page.page, page]),
        );
        const blanks = lesson.worksheetBlanks.flatMap((blank) => {
          const page = validPages.get(blank.page);
          if (!page) return [];
          return [
            {
              id: blank.id,
              page: blank.page,
              left: blank.leftRatio * page.width,
              top: blank.topRatio * page.height,
              width: blank.widthRatio * page.width,
              height: blank.heightRatio * page.height,
              answer: blank.answer,
              prompt: blank.prompt,
              source: blank.source,
            },
          ];
        });
        if (
          pages.length &&
          blanks.length &&
          blanks.length === lesson.worksheetBlanks.length
        ) {
          sources.push({
            id: `lesson:${node.id}`,
            title: node.title,
            lessonUnitId: node.id,
            lessonTitle: lesson.title,
            lessonUnitPath: path,
            lessonUnitPathIds: pathIds,
            category: "",
            description: "",
            type: "pdf",
            sortOrder: sources.length,
            pdfPageImages: pages,
            pdfRegions: lesson.worksheetTextRegions,
            pdfBlanks: blanks,
          });
        }
      }
      visit(node.children || [], path, pathIds);
    });
  };
  visit(tree, [], []);
  return sources;
};

export const readHistoryClassroomLessonSources = async (
  config: Pick<SystemConfig, "year" | "semester"> | null | undefined,
) => {
  const [scopedTree, scopedLessons, legacyLessons] = await Promise.all([
    getDoc(doc(db, getSemesterDocPath(config, "curriculum", "tree"))),
    getDocs(collection(db, getSemesterCollectionPath(config, "lessons"))),
    getDocs(collection(db, "lessons")),
  ]);
  const treeDoc =
    scopedTree.exists() && Array.isArray(scopedTree.data().tree)
      ? scopedTree
      : await getDoc(doc(db, "curriculum", "tree"));
  const tree =
    treeDoc.exists() && Array.isArray(treeDoc.data().tree)
      ? treeDoc.data().tree
      : [];
  return buildHistoryClassroomLessonSources(
    tree,
    scopedLessons.docs.map((item) => item.data() as LessonData),
    legacyLessons.docs.map((item) => item.data() as LessonData),
  );
};
