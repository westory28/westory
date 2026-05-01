import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
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
const lessonCache = new Map<string, CacheEntry<Partial<LessonData> | null>>();
const mapResourcesCache = new Map<string, CacheEntry<MapResource[]>>();

const getScopeKey = (config: ConfigLike) => {
  const { year, semester } = getYearSemester(config);
  return `${year}:${semester}`;
};

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

export const readStudentLesson = (config: ConfigLike, unitId: string) =>
  readCached(lessonCache, `${getScopeKey(config)}:${unitId}`, async () => {
    const semesterQuery = query(
      collection(db, getSemesterCollectionPath(config, "lessons")),
      where("unitId", "==", unitId),
      limit(1),
    );
    let snap = await getDocs(semesterQuery);
    if (snap.empty) {
      snap = await getDocs(
        query(
          collection(db, "lessons"),
          where("unitId", "==", unitId),
          limit(1),
        ),
      );
    }

    return snap.empty ? null : (snap.docs[0].data() as Partial<LessonData>);
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
