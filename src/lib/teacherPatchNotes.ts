import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";

export type TeacherPatchNoteType = "bug" | "improvement" | "content" | "etc";
export type TeacherPatchNotePriority = "normal" | "high";
export type TeacherPatchNoteStatus = "open" | "done";

export interface TeacherPatchNoteTargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TeacherPatchNoteTarget {
  targetLabel?: string;
  targetText?: string;
  targetSelector?: string;
  targetRect?: TeacherPatchNoteTargetRect | null;
}

export interface TeacherPatchNote extends TeacherPatchNoteTarget {
  id: string;
  ownerUid: string;
  title: string;
  body: string;
  type: TeacherPatchNoteType;
  priority: TeacherPatchNotePriority;
  status: TeacherPatchNoteStatus;
  sourcePath: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  completedAt?: unknown;
}

export interface TeacherPatchNoteInput extends TeacherPatchNoteTarget {
  title: string;
  body: string;
  type: TeacherPatchNoteType;
  priority: TeacherPatchNotePriority;
  status?: TeacherPatchNoteStatus;
  sourcePath: string;
}

const TEACHER_PATCH_NOTES_LIMIT = 100;

const getTeacherPatchNotesCollection = (uid: string) =>
  collection(db, "teacherPatchNotes", uid, "notes");

const trimLimit = (value: unknown, maxLength: number) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

const trimMultilineLimit = (value: unknown, maxLength: number) =>
  String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, maxLength);

const normalizeType = (value: unknown): TeacherPatchNoteType =>
  value === "bug" ||
  value === "improvement" ||
  value === "content" ||
  value === "etc"
    ? value
    : "etc";

const normalizePriority = (value: unknown): TeacherPatchNotePriority =>
  value === "high" ? "high" : "normal";

const normalizeStatus = (value: unknown): TeacherPatchNoteStatus =>
  value === "done" ? "done" : "open";

const normalizeRect = (rect: TeacherPatchNoteTargetRect | null | undefined) => {
  if (!rect) return null;
  return {
    x: Math.round(Number(rect.x || 0)),
    y: Math.round(Number(rect.y || 0)),
    width: Math.round(Number(rect.width || 0)),
    height: Math.round(Number(rect.height || 0)),
  };
};

const getTimestampMs = (value: unknown) => {
  if (!value) return 0;
  if (typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return Number((value as { seconds?: number }).seconds || 0) * 1000;
};

const mapTeacherPatchNoteDoc = (docSnap: {
  id: string;
  data: () => Record<string, unknown>;
}): TeacherPatchNote => {
  const data = docSnap.data();
  const rawRect = data.targetRect as Partial<TeacherPatchNoteTargetRect> | null;
  const targetRect =
    rawRect && typeof rawRect === "object"
      ? {
          x: Number(rawRect.x || 0),
          y: Number(rawRect.y || 0),
          width: Number(rawRect.width || 0),
          height: Number(rawRect.height || 0),
        }
      : null;

  return {
    id: docSnap.id,
    ownerUid: String(data.ownerUid || ""),
    title: String(data.title || ""),
    body: String(data.body || ""),
    type: normalizeType(data.type),
    priority: normalizePriority(data.priority),
    status: normalizeStatus(data.status),
    sourcePath: String(data.sourcePath || ""),
    targetLabel: String(data.targetLabel || ""),
    targetText: String(data.targetText || ""),
    targetSelector: String(data.targetSelector || ""),
    targetRect,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    completedAt: data.completedAt || null,
  };
};

const buildNotePayload = (uid: string, input: TeacherPatchNoteInput) => {
  const status = normalizeStatus(input.status);
  const payload = {
    ownerUid: uid,
    title: trimLimit(input.title, 80),
    body: trimMultilineLimit(input.body, 2000),
    type: normalizeType(input.type),
    priority: normalizePriority(input.priority),
    status,
    sourcePath: trimLimit(input.sourcePath, 240) || "/teacher",
    targetLabel: trimLimit(input.targetLabel, 120),
    targetText: trimLimit(input.targetText, 240),
    targetSelector: trimLimit(input.targetSelector, 240),
    targetRect: normalizeRect(input.targetRect),
    updatedAt: serverTimestamp(),
    completedAt: status === "done" ? serverTimestamp() : null,
  };
  return payload;
};

export const subscribeTeacherPatchNotes = (
  uid: string,
  onChange: (notes: TeacherPatchNote[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe =>
  onSnapshot(
    query(
      getTeacherPatchNotesCollection(uid),
      orderBy("updatedAt", "desc"),
      limit(TEACHER_PATCH_NOTES_LIMIT),
    ),
    (snapshot) => {
      const notes = snapshot.docs.map(mapTeacherPatchNoteDoc).sort((a, b) => {
        if (a.status !== b.status) return a.status === "open" ? -1 : 1;
        return getTimestampMs(b.updatedAt) - getTimestampMs(a.updatedAt);
      });
      onChange(notes);
    },
    (error) => {
      console.error("Failed to subscribe teacher patch notes:", error);
      onError?.(error);
      onChange([]);
    },
  );

export const createTeacherPatchNote = async (
  uid: string,
  input: TeacherPatchNoteInput,
) => {
  await addDoc(getTeacherPatchNotesCollection(uid), {
    ...buildNotePayload(uid, { ...input, status: "open" }),
    createdAt: serverTimestamp(),
  });
};

export const updateTeacherPatchNote = async (
  uid: string,
  noteId: string,
  input: TeacherPatchNoteInput,
) => {
  const { completedAt, ...payload } = buildNotePayload(uid, input);
  await updateDoc(doc(db, "teacherPatchNotes", uid, "notes", noteId), {
    ...payload,
  });
};

export const updateTeacherPatchNoteStatus = async (
  uid: string,
  note: TeacherPatchNote,
  status: TeacherPatchNoteStatus,
) => {
  await updateDoc(doc(db, "teacherPatchNotes", uid, "notes", note.id), {
    status,
    updatedAt: serverTimestamp(),
    completedAt: status === "done" ? serverTimestamp() : null,
  });
};

export const deleteTeacherPatchNote = async (uid: string, noteId: string) => {
  await deleteDoc(doc(db, "teacherPatchNotes", uid, "notes", noteId));
};
