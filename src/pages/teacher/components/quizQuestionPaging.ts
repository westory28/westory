export const QUIZ_QUESTION_PAGE_SIZE = 20;

export interface QuizQuestionCatalogEntry {
  documentId: string;
  id: number;
  unitId: string;
  subUnitId?: string | null;
  category: string;
  type?: string;
  refBig?: string;
  refMid?: string;
  refSmall?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  contentRevision?: number;
  searchText: string;
}

export const quizQuestionCatalogEntry = (
  question: {
    id: number;
    unitId: string;
    category: string;
    subUnitId?: string | null;
    refBig?: string;
    refMid?: string;
    refSmall?: string;
    createdAt?: unknown;
    updatedAt?: unknown;
    contentRevision?: number;
    type?: string;
    question?: string;
    explanation?: string;
    passage?: string | null;
    concepts?: string[];
  },
  documentId = String(question.id),
): QuizQuestionCatalogEntry => ({
  documentId,
  id: question.id,
  unitId: question.unitId,
  category: question.category,
  subUnitId: question.subUnitId,
  refBig: question.refBig,
  refMid: question.refMid,
  refSmall: question.refSmall,
  createdAt: question.createdAt,
  updatedAt: question.updatedAt,
  contentRevision: question.contentRevision,
  type: question.type,
  searchText: [
    question.question,
    question.explanation,
    question.passage,
    ...(question.concepts || []),
  ]
    .join(" ")
    .toLowerCase(),
});

export const quizPageNumbers = (
  page: number,
  count: number,
): Array<number | "gap"> => {
  const pages = new Set([1, count, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((value) => pages.add(value));
  if (page >= count - 2)
    [count - 3, count - 2, count - 1].forEach((value) => pages.add(value));
  const result: Array<number | "gap"> = [];
  [...pages]
    .filter((value) => value >= 1 && value <= count)
    .sort((a, b) => a - b)
    .forEach((value) => {
      const previous = result[result.length - 1];
      if (typeof previous === "number" && value - previous > 1)
        result.push("gap");
      result.push(value);
    });
  return result;
};

/** One editor scope, one catalog; full documents are read only for requested pages. */
export function createQuizQuestionPager<
  T extends { id: number; contentRevision?: number },
>(
  readCatalog: () => Promise<QuizQuestionCatalogEntry[]>,
  readBodies: (
    entries: QuizQuestionCatalogEntry[],
  ) => Promise<Array<{ documentId: string; question: T }>>,
) {
  let catalogPromise: Promise<QuizQuestionCatalogEntry[]> | undefined;
  let catalog: QuizQuestionCatalogEntry[] = [];
  const changes = new Map<string, QuizQuestionCatalogEntry | null>();
  const bodies = new Map<string, T>();
  const pending = new Map<string, Promise<T>>();
  const cacheKey = (entry: QuizQuestionCatalogEntry) =>
    `${entry.documentId}:${entry.contentRevision || 0}`;
  const overlay = (entries: QuizQuestionCatalogEntry[]) => {
    const merged = new Map(entries.map((entry) => [entry.documentId, entry]));
    changes.forEach((entry, id) =>
      entry ? merged.set(id, entry) : merged.delete(id),
    );
    return [...merged.values()].sort(
      (a, b) => a.id - b.id || a.documentId.localeCompare(b.documentId),
    );
  };
  return {
    catalog() {
      if (!catalogPromise) {
        catalogPromise = readCatalog()
          .then((entries) => {
            catalog = overlay(entries);
            return catalog;
          })
          .catch((error) => {
            catalogPromise = undefined;
            throw error;
          });
      }
      return catalogPromise.then(() => catalog);
    },
    async page(entries: QuizQuestionCatalogEntry[]) {
      if (entries.length > QUIZ_QUESTION_PAGE_SIZE)
        throw new Error("문항 페이지 크기를 초과했습니다.");
      const missing = entries.filter(
        (entry) =>
          !bodies.has(cacheKey(entry)) && !pending.has(cacheKey(entry)),
      );
      if (missing.length) {
        const batch = readBodies(missing).then(
          (rows) => new Map(rows.map((row) => [row.documentId, row.question])),
        );
        missing.forEach((entry) => {
          const key = cacheKey(entry);
          const request = batch
            .then((rows) => {
              const question = rows.get(entry.documentId);
              if (
                !question ||
                question.id !== entry.id ||
                Number(question.contentRevision || 0) !==
                  Number(entry.contentRevision || 0)
              )
                throw new Error(
                  "문항 목록이 변경되었습니다. 목록을 새로고침해 주세요.",
                );
              bodies.set(key, question);
              return question;
            })
            .finally(() => {
              pending.delete(key);
            });
          pending.set(key, request);
        });
      }
      return Promise.all(
        entries.map(
          (entry) =>
            bodies.get(cacheKey(entry)) || pending.get(cacheKey(entry))!,
        ),
      );
    },
    upsert(entry: QuizQuestionCatalogEntry, question: T) {
      changes.set(entry.documentId, entry);
      bodies.set(cacheKey(entry), question);
      catalog = overlay(catalog);
      return catalog;
    },
    remove(documentId: string) {
      changes.set(documentId, null);
      catalog = overlay(catalog);
      return catalog;
    },
  };
}
