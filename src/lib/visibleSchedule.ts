import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import type { CalendarEvent } from "../types";

export interface VisibleNotice {
  id: string;
  targetType: string;
  targetClass?: string;
  category: string;
  content: string;
  createdAt: any;
  targetDate?: string;
}

const normalizeClassKey = (grade?: string | null, className?: string | null) => {
  const gradeValue = String(grade || "").trim();
  const classValue = String(className || "").trim();
  return gradeValue && classValue ? `${gradeValue}-${classValue}` : "";
};

const timestampMs = (value: unknown) => {
  if (!value) return 0;
  if (typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  const seconds = Number((value as { seconds?: number }).seconds || 0);
  return seconds > 0 ? seconds * 1000 : 0;
};

const buildCalendarQueries = (
  db: Firestore,
  path: string,
  classKey?: string,
) => {
  const baseRef = collection(db, path);
  const queries: Query[] = [
    query(baseRef, where("targetType", "in", ["common", "all"])),
    query(baseRef, where("eventType", "==", "holiday")),
  ];
  if (classKey) {
    queries.push(
      query(
        baseRef,
        where("targetType", "==", "class"),
        where("targetClass", "==", classKey),
      ),
    );
  }
  return queries;
};

const buildNoticeQueries = (
  db: Firestore,
  path: string,
  classKey?: string,
) => {
  const baseRef = collection(db, path);
  const queries: Query[] = [
    query(baseRef, where("targetType", "in", ["common", "all"])),
  ];
  if (classKey) {
    queries.push(
      query(
        baseRef,
        where("targetType", "==", "class"),
        where("targetClass", "==", classKey),
      ),
    );
  }
  return queries;
};

const mergeDocs = <T>(
  docsByQuery: Array<QueryDocumentSnapshot[]>,
  mapDoc: (docSnap: QueryDocumentSnapshot) => T,
) => {
  const merged = new Map<string, T>();
  docsByQuery.forEach((docs) => {
    docs.forEach((docSnap) => merged.set(docSnap.id, mapDoc(docSnap)));
  });
  return Array.from(merged.values());
};

export const loadVisibleCalendarEvents = async (
  db: Firestore,
  path: string,
  classKey?: string,
): Promise<CalendarEvent[]> => {
  const snapshots = await Promise.all(
    buildCalendarQueries(db, path, classKey).map((item) => getDocs(item)),
  );
  return mergeDocs(
    snapshots.map((snapshot) => snapshot.docs),
    (docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as CalendarEvent,
  );
};

export const subscribeVisibleCalendarEvents = (
  db: Firestore,
  path: string,
  classKey: string | undefined,
  onChange: (events: CalendarEvent[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe => {
  const latestDocs = new Map<number, QueryDocumentSnapshot[]>();
  const emit = () => {
    onChange(
      mergeDocs(Array.from(latestDocs.values()), (docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }) as CalendarEvent),
    );
  };
  const unsubscribes = buildCalendarQueries(db, path, classKey).map(
    (item, index) =>
      onSnapshot(
        item,
        (snapshot) => {
          latestDocs.set(index, snapshot.docs);
          emit();
        },
        (error) => onError?.(error),
      ),
  );
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
};

export const loadVisibleNotices = async (
  db: Firestore,
  path: string,
  classKey?: string,
): Promise<VisibleNotice[]> => {
  const snapshots = await Promise.all(
    buildNoticeQueries(db, path, classKey).map((item) => getDocs(item)),
  );
  return mergeDocs(
    snapshots.map((snapshot) => snapshot.docs),
    (docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as VisibleNotice,
  ).sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt));
};

export const subscribeVisibleNotices = (
  db: Firestore,
  path: string,
  classKey: string | undefined,
  onChange: (notices: VisibleNotice[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe => {
  const latestDocs = new Map<number, QueryDocumentSnapshot[]>();
  const emit = () => {
    onChange(
      mergeDocs(Array.from(latestDocs.values()), (docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }) as VisibleNotice).sort(
        (a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt),
      ),
    );
  };
  const unsubscribes = buildNoticeQueries(db, path, classKey).map(
    (item, index) =>
      onSnapshot(
        item,
        (snapshot) => {
          latestDocs.set(index, snapshot.docs);
          emit();
        },
        (error) => onError?.(error),
      ),
  );
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
};

export const getStudentClassKey = (
  grade?: string | null,
  className?: string | null,
) => normalizeClassKey(grade, className);
