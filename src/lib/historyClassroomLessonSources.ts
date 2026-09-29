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
}

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
  const visit = (nodes: LessonTreeSelectionNode[], parents: string[]) => {
    nodes.forEach((node) => {
      const path = [...parents, node.title];
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
      visit(node.children || [], path);
    });
  };
  visit(tree, []);
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
