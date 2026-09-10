import {
  collection,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import { executeWestoryCommand, WestoryCommandError } from "./commandGateway";

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
  noteRevision: number;
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
  title?: string;
  body: string;
  type: TeacherPatchNoteType;
  priority: TeacherPatchNotePriority;
  status?: TeacherPatchNoteStatus;
  sourcePath: string;
}

const TEACHER_PATCH_NOTES_LIMIT = 100;

export interface TeacherPatchNotesCursor {
  ownerUid: string;
  snapshot: QueryDocumentSnapshot<DocumentData>;
}

export interface TeacherPatchNotesPage {
  nextCursor: TeacherPatchNotesCursor | null;
  hasNext: boolean;
}

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
    noteRevision: Object.prototype.hasOwnProperty.call(data, "noteRevision")
      ? typeof data.noteRevision === "number"
        ? data.noteRevision
        : -1
      : 0,
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

const buildNoteContent = (input: TeacherPatchNoteInput) => {
  const body = trimMultilineLimit(input.body, 2000);
  const payload = {
    title: trimLimit(input.title || body.split("\n")[0] || "패치 메모", 80),
    body,
    type: normalizeType(input.type),
    priority: normalizePriority(input.priority),
    sourcePath: trimLimit(input.sourcePath, 240) || "/teacher",
    targetLabel: trimLimit(input.targetLabel, 120),
    targetText: trimLimit(input.targetText, 240),
    targetSelector: trimLimit(input.targetSelector, 240),
    targetRect: normalizeRect(input.targetRect),
  };
  return payload;
};

export const subscribeTeacherPatchNotes = (
  uid: string,
  onChange: (notes: TeacherPatchNote[], page: TeacherPatchNotesPage) => void,
  onError?: (error: Error) => void,
  after?: TeacherPatchNotesCursor,
): Unsubscribe => {
  if (
    after &&
    (after.ownerUid !== uid ||
      after.snapshot.ref.parent.path !== `teacherPatchNotes/${uid}/notes`)
  ) {
    onError?.(
      new Error("메모 목록의 계정이 바뀌었습니다. 최신 목록을 열어 주세요."),
    );
    return () => {};
  }
  const notesQuery = query(
    getTeacherPatchNotesCollection(uid),
    orderBy("updatedAt", "desc"),
    ...(after ? [startAfter(after.snapshot)] : []),
    limit(TEACHER_PATCH_NOTES_LIMIT),
  );
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: Unsubscribe = () => {};
  const isCurrent = () => !stopped && auth.currentUser?.uid === uid;
  const reportError = (error: Error) => {
    if (!isCurrent()) return;
    console.error("Failed to subscribe teacher patch notes:", error);
    onError?.(error);
  };
  const listen = () => {
    if (!isCurrent()) return;
    unsubscribe = onSnapshot(
      notesQuery,
      (snapshot) => {
        if (!isCurrent()) return;
        const notes = snapshot.docs.map(mapTeacherPatchNoteDoc).sort((a, b) => {
          if (a.status !== b.status) return a.status === "open" ? -1 : 1;
          return getTimestampMs(b.updatedAt) - getTimestampMs(a.updatedAt);
        });
        // Use the server order, not the UI's status grouping, as the boundary.
        const last = snapshot.docs[snapshot.docs.length - 1];
        onChange(notes, {
          nextCursor: last ? { ownerUid: uid, snapshot: last } : null,
          hasNext: snapshot.docs.length === TEACHER_PATCH_NOTES_LIMIT,
        });
      },
      reportError,
    );
  };
  // A restored listener may reuse a query target from the previous credential.
  // Confirm this exact bounded query against the server before attaching it.
  const retryDelays = [250, 1000, 2000];
  const prepare = async (attempt = 0) => {
    if (!isCurrent()) return;
    try {
      await getDocsFromServer(notesQuery);
      listen();
    } catch (error) {
      if (!isCurrent()) return;
      // Preserve Firestore's cached/offline listener and automatic reconnect.
      if ((error as { code?: string }).code === "unavailable") {
        listen();
        return;
      }
      if (
        (error as { code?: string }).code === "permission-denied" &&
        attempt < retryDelays.length
      ) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void prepare(attempt + 1);
        }, retryDelays[attempt]);
        return;
      }
      reportError(error as Error);
    }
  };
  if (!isCurrent()) {
    onError?.(
      new Error("메모 목록의 계정이 바뀌었습니다. 다시 로그인해 주세요."),
    );
    return () => {};
  }
  void prepare();
  return () => {
    stopped = true;
    if (retryTimer !== null) clearTimeout(retryTimer);
    unsubscribe();
  };
};

export const createTeacherPatchNote = async (
  uid: string,
  input: TeacherPatchNoteInput,
) => {
  assertCurrentOwner(uid);
  return (
    await executeWestoryCommand("createTeacherPatchNote", {
      content: buildNoteContent(input),
    })
  ).result;
};

export const updateTeacherPatchNote = async (
  uid: string,
  noteId: string,
  expectedNoteRevision: number,
  input: TeacherPatchNoteInput,
) => {
  assertCurrentOwner(uid);
  return (
    await executeWestoryCommand("updateTeacherPatchNote", {
      noteId,
      expectedNoteRevision,
      content: buildNoteContent(input),
    })
  ).result;
};

export const updateTeacherPatchNoteStatus = async (
  uid: string,
  note: TeacherPatchNote,
  status: TeacherPatchNoteStatus,
) => {
  assertCurrentOwner(uid);
  return (
    await executeWestoryCommand("updateTeacherPatchNoteStatus", {
      noteId: note.id,
      expectedNoteRevision: note.noteRevision,
      status,
    })
  ).result;
};

export const deleteTeacherPatchNote = async (
  uid: string,
  note: TeacherPatchNote,
) => {
  assertCurrentOwner(uid);
  return (
    await executeWestoryCommand("deleteTeacherPatchNote", {
      noteId: note.id,
      expectedNoteRevision: note.noteRevision,
    })
  ).result;
};

const assertCurrentOwner = (uid: string) => {
  if (!uid || auth.currentUser?.uid !== uid)
    throw new Error(
      "로그인 사용자가 바뀌었습니다. 메모 화면을 다시 열어 주세요.",
    );
};

export const isPatchNoteResultUncertain = (error: unknown) =>
  error instanceof WestoryCommandError && error.state === "retryable";

export const isPatchNoteResultConfirmedFailure = (error: unknown) =>
  error instanceof WestoryCommandError && error.outcomeConfirmed;
