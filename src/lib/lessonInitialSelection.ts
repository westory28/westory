import {
  findLatestLessonTreeSelection,
  type LessonTreeSelectionMeta,
  type LessonTreeSelectionNode,
  type LessonTreeSelectionTarget,
} from "./lessonTreeSelection";

export const INITIAL_LESSON_PAGE_SIZE = 10;

// Pages must retain descending updatedAt order. Continue past removed tree
// entries, but never download the remaining lesson bodies after a match.
export const findInitialLessonSelection = async <Cursor>(options: {
  tree: LessonTreeSelectionNode[];
  collectionPaths: string[];
  isCurrent: () => boolean;
  readPage: (
    path: string,
    cursor: Cursor | undefined,
    pageSize: number,
  ) => Promise<{
    lessons: LessonTreeSelectionMeta[];
    nextCursor?: Cursor;
  }>;
}): Promise<LessonTreeSelectionTarget | null> => {
  if (options.tree.length === 0) return null;
  for (const path of options.collectionPaths) {
    let cursor: Cursor | undefined;
    while (options.isCurrent()) {
      const page = await options.readPage(
        path,
        cursor,
        INITIAL_LESSON_PAGE_SIZE,
      );
      if (!options.isCurrent()) return null;
      const selection = findLatestLessonTreeSelection(
        options.tree,
        page.lessons,
      );
      if (selection) return selection;
      if (page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }
    if (!options.isCurrent()) return null;
  }
  return null;
};
