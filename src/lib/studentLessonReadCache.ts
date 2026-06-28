import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import type { LessonData } from "./lessonData";
import {
  mergeMapResources,
  normalizeMapResource,
  type MapResource,
} from "./mapResources";
import {
  getSemesterCollectionPath,
  getSemesterDocPath,
  getYearSemester,
} from "./semesterScope";
import type { SystemConfig } from "../types";
import {
  findLatestLessonTreeSelection,
  getLessonTreeMetaTimestampMs,
  type LessonTreeSelectionTarget,
} from "./lessonTreeSelection";

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;

export interface StudentCurriculumTreeItem {
  id: string;
  title: string;
  children?: StudentCurriculumTreeItem[];
}

interface CacheEntry<T> {
  promise?: Promise<T>;
  value?: T;
  expiresAt?: number;
}

const STUDENT_READ_CACHE_TTL_MS = 60_000;

const curriculumTreeCache = new Map<
  string,
  CacheEntry<StudentCurriculumTreeItem[]>
>();
const visibleCurriculumTreeCache = new Map<
  string,
  CacheEntry<StudentCurriculumTreeItem[]>
>();
const effectiveLessonsCache = new Map<
  string,
  CacheEntry<{
    scopedLatestLessons: Partial<LessonData>[];
    legacyLatestLessons: Partial<LessonData>[];
    visibleLessons: Partial<LessonData>[];
    visibleUnitIds: Set<string>;
  }>
>();
const latestLessonSelectionCache = new Map<
  string,
  CacheEntry<LessonTreeSelectionTarget | null>
>();
const lessonCache = new Map<string, CacheEntry<Partial<LessonData> | null>>();
const mapResourcesCache = new Map<string, CacheEntry<MapResource[]>>();

const getScopeKey = (config: ConfigLike) => {
  const { year, semester } = getYearSemester(config);
  return `${year}:${semester}`;
};

const getTreeCacheKey = (tree: StudentCurriculumTreeItem[]) =>
  JSON.stringify(tree);

const sortLessonsByRecency = (lessons: Partial<LessonData>[]) =>
  [...lessons].sort(
    (left, right) =>
      getLessonTreeMetaTimestampMs(right) - getLessonTreeMetaTimestampMs(left),
  );

const getLatestLessonsByUnitId = (lessons: Partial<LessonData>[]) => {
  const latestByUnitId = new Map<string, Partial<LessonData>>();
  for (const lesson of sortLessonsByRecency(lessons)) {
    const unitId = String(lesson.unitId || "").trim();
    if (!unitId || latestByUnitId.has(unitId)) continue;
    latestByUnitId.set(unitId, lesson);
  }
  return Array.from(latestByUnitId.values());
};

const getLessonUnitIds = (lessons: Partial<LessonData>[]) =>
  new Set(
    lessons.map((lesson) => String(lesson.unitId || "").trim()).filter(Boolean),
  );

const isStudentVisibleLesson = (lesson: Partial<LessonData>) =>
  lesson.isVisibleToStudents !== false;

const pickStudentLesson = (lessons: Partial<LessonData>[]) =>
  sortLessonsByRecency(lessons)[0] || null;

const readLessonCollection = async (collectionPath: string) => {
  const snap = await getDocs(collection(db, collectionPath));
  return snap.docs.map((docSnap) => docSnap.data() as Partial<LessonData>);
};

const filterTreeByVisibleLessons = (
  tree: StudentCurriculumTreeItem[],
  visibleUnitIds: Set<string>,
): StudentCurriculumTreeItem[] =>
  tree
    .map((item) => {
      const children = filterTreeByVisibleLessons(
        item.children || [],
        visibleUnitIds,
      );
      if (children.length > 0) return { ...item, children };

      const unitId = String(item.id || "").trim();
      if (!(item.children || []).length && visibleUnitIds.has(unitId)) {
        return item;
      }

      return null;
    })
    .filter((item): item is StudentCurriculumTreeItem => Boolean(item));

const readCached = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  loader: () => Promise<T>,
) => {
  const cached = cache.get(key);
  if (cached?.value !== undefined && (cached.expiresAt || 0) > Date.now()) {
    return Promise.resolve(cached.value);
  }
  if (cached?.promise) return cached.promise;

  const entry: CacheEntry<T> = {};
  entry.promise = loader()
    .then((value) => {
      entry.value = value;
      entry.expiresAt = Date.now() + STUDENT_READ_CACHE_TTL_MS;
      entry.promise = undefined;
      return value;
    })
    .catch((error) => {
      cache.delete(key);
      throw error;
    });
  cache.set(key, entry);
  return entry.promise;
};

export const readStudentCurriculumTree = (config: ConfigLike) =>
  readCached(curriculumTreeCache, getScopeKey(config), async () => {
    const semesterTree = await getDoc(
      doc(db, getSemesterDocPath(config, "curriculum", "tree")),
    );
    if (semesterTree.exists() && semesterTree.data().tree) {
      return semesterTree.data().tree as StudentCurriculumTreeItem[];
    }

    const globalTree = await getDoc(doc(db, "curriculum", "tree"));
    if (globalTree.exists() && globalTree.data().tree) {
      return globalTree.data().tree as StudentCurriculumTreeItem[];
    }

    return [];
  });

const readEffectiveStudentLessons = (config: ConfigLike) =>
  readCached(effectiveLessonsCache, getScopeKey(config), async () => {
    const scopedLatestLessons = getLatestLessonsByUnitId(
      await readLessonCollection(getSemesterCollectionPath(config, "lessons")),
    );
    const scopedUnitIds = getLessonUnitIds(scopedLatestLessons);
    const legacyLatestLessons = getLatestLessonsByUnitId(
      await readLessonCollection("lessons"),
    ).filter(
      (lesson) => !scopedUnitIds.has(String(lesson.unitId || "").trim()),
    );
    const effectiveLessons = [...scopedLatestLessons, ...legacyLatestLessons];
    const visibleLessons = effectiveLessons.filter(isStudentVisibleLesson);

    return {
      scopedLatestLessons,
      legacyLatestLessons,
      visibleLessons,
      visibleUnitIds: getLessonUnitIds(visibleLessons),
    };
  });

export const readStudentVisibleLessons = (config: ConfigLike) =>
  readEffectiveStudentLessons(config).then(
    ({ visibleLessons }) => visibleLessons,
  );

export const readStudentVisibleCurriculumTree = (config: ConfigLike) =>
  readCached(visibleCurriculumTreeCache, getScopeKey(config), async () => {
    const [tree, { visibleUnitIds }] = await Promise.all([
      readStudentCurriculumTree(config),
      readEffectiveStudentLessons(config),
    ]);
    return filterTreeByVisibleLessons(tree, visibleUnitIds);
  });

export const readStudentLatestLessonSelection = (
  config: ConfigLike,
  tree: StudentCurriculumTreeItem[],
) =>
  readCached(
    latestLessonSelectionCache,
    `${getScopeKey(config)}:${getTreeCacheKey(tree)}`,
    async () => {
      const { scopedLatestLessons, legacyLatestLessons } =
        await readEffectiveStudentLessons(config);
      let latestSelection = findLatestLessonTreeSelection(
        tree,
        scopedLatestLessons,
        {
          visibleOnly: true,
        },
      );

      if (!latestSelection) {
        latestSelection = findLatestLessonTreeSelection(
          tree,
          [...scopedLatestLessons, ...legacyLatestLessons],
          {
            visibleOnly: true,
          },
        );
      }

      return latestSelection;
    },
  );

export const readStudentLesson = (config: ConfigLike, unitId: string) =>
  readCached(lessonCache, `${getScopeKey(config)}:${unitId}`, async () => {
    const semesterQuery = query(
      collection(db, getSemesterCollectionPath(config, "lessons")),
      where("unitId", "==", unitId),
    );
    let snap = await getDocs(semesterQuery);
    if (snap.empty) {
      snap = await getDocs(
        query(collection(db, "lessons"), where("unitId", "==", unitId)),
      );
    }

    return snap.empty
      ? null
      : pickStudentLesson(
          snap.docs.map((docSnap) => docSnap.data() as Partial<LessonData>),
        );
  });

export const readStudentMapResources = (config: ConfigLike) =>
  readCached(mapResourcesCache, getScopeKey(config), async () => {
    const scopedQuery = query(
      collection(db, getSemesterCollectionPath(config, "map_resources")),
      orderBy("sortOrder", "asc"),
    );
    let snap = await getDocs(scopedQuery);

    if (snap.empty) {
      const legacyQuery = query(
        collection(db, "map_resources"),
        orderBy("sortOrder", "asc"),
      );
      snap = await getDocs(legacyQuery);
    }

    const resources = snap.docs.map((docSnap) =>
      normalizeMapResource(docSnap.id, docSnap.data()),
    );
    return mergeMapResources(resources);
  });
