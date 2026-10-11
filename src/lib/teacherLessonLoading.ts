import {
  collection,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  findLatestLessonTreeSelection,
  type LessonTreeSelectionNode,
} from "./lessonTreeSelection";

export const RECENT_TEACHER_LESSON_PAGE_SIZE = 20;

export type TeacherLessonDocument = {
  snapshot: QueryDocumentSnapshot | null;
  legacy: boolean;
};

const assertSavedSnapshot = (snapshot: QuerySnapshot) => {
  if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites)
    throw new Error("자료의 저장 상태를 확인하지 못했습니다.");
};

export const readTeacherLessonDocument = async (
  scopedCollectionPath: string,
  unitId: string,
  isCurrent: () => boolean,
  legacySnapshot?: QueryDocumentSnapshot,
): Promise<TeacherLessonDocument | null> => {
  const readUnit = (collectionPath: string) =>
    getDocsFromServer(
      query(
        collection(db, collectionPath),
        where("unitId", "==", unitId),
        limit(1),
      ),
    );
  if (!isCurrent()) return null;
  const scoped = await readUnit(scopedCollectionPath);
  if (!isCurrent()) return null;
  assertSavedSnapshot(scoped);
  if (!scoped.empty) return { snapshot: scoped.docs[0], legacy: false };
  if (legacySnapshot) return { snapshot: legacySnapshot, legacy: true };
  const legacy = await readUnit("lessons");
  if (!isCurrent()) return null;
  assertSavedSnapshot(legacy);
  return { snapshot: legacy.docs[0] || null, legacy: !legacy.empty };
};

export const readLatestTeacherLesson = async (
  scopedCollectionPath: string,
  tree: LessonTreeSelectionNode[],
  isCurrent: () => boolean,
) => {
  if (tree.length === 0) return null;
  // Keep current-semester priority, even when a legacy document is newer.
  for (const collectionPath of [scopedCollectionPath, "lessons"]) {
    let cursor: QueryDocumentSnapshot | undefined;
    while (isCurrent()) {
      const page = await getDocsFromServer(
        query(
          collection(db, collectionPath),
          orderBy("updatedAt", "desc"),
          ...(cursor ? [startAfter(cursor)] : []),
          limit(RECENT_TEACHER_LESSON_PAGE_SIZE),
        ),
      );
      if (!isCurrent()) return null;
      assertSavedSnapshot(page);
      const selection = findLatestLessonTreeSelection(
        tree,
        page.docs.map((snapshot) => snapshot.data()),
      );
      if (selection) {
        const snapshot = page.docs.find(
          (item) =>
            String(item.data().unitId || "").trim() === selection.node.id,
        )!;
        // A scoped document without updatedAt is absent from the ordered query,
        // but it still takes precedence over a matching legacy document.
        const lesson =
          collectionPath === scopedCollectionPath
            ? { snapshot, legacy: false }
            : await readTeacherLessonDocument(
                scopedCollectionPath,
                selection.node.id,
                isCurrent,
                snapshot,
              );
        return lesson && isCurrent() ? { selection, lesson } : null;
      }
      if (page.size < RECENT_TEACHER_LESSON_PAGE_SIZE) break;
      cursor = page.docs[page.docs.length - 1];
    }
  }
  return null;
};
