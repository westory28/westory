import {
  collection,
  doc,
  getDocFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import { executeTeacherPatchNoteCommand } from "./teacherPatchNoteCommands";

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

type NoteListener = {
  onChange: (notes: TeacherPatchNote[]) => void;
  onError?: (error: Error) => void;
};
type ConfirmedNote = {
  note: TeacherPatchNote | null;
  awaitingSnapshot: boolean;
  verification?: ReturnType<typeof setTimeout>;
};
type NoteSubscription = {
  notes: Map<string, TeacherPatchNote>;
  serverNotes: Map<string, TeacherPatchNote>;
  removedRevisions: Map<string, number>;
  confirmed: Map<string, ConfirmedNote>;
  listeners: Set<NoteListener>;
  unsubscribe: Unsubscribe;
};
const subscriptions = new Map<string, NoteSubscription>();
const pendingNotes = new Set<string>();
const clearConfirmationChecks = (state: NoteSubscription) =>
  state.confirmed.forEach((confirmed) => clearTimeout(confirmed.verification));

const publishNotes = (state: NoteSubscription) => {
  const notes = [...state.notes.values()]
    .sort((a, b) => getTimestampMs(b.updatedAt) - getTimestampMs(a.updatedAt))
    .slice(0, TEACHER_PATCH_NOTES_LIMIT)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return getTimestampMs(b.updatedAt) - getTimestampMs(a.updatedAt);
    });
  state.listeners.forEach(({ onChange }) => onChange(notes));
};

export const subscribeTeacherPatchNotes = (
  uid: string,
  onChange: (notes: TeacherPatchNote[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe => {
  const listener = { onChange, onError };
  let state = subscriptions.get(uid);
  if (!state) {
    state = {
      notes: new Map(),
      serverNotes: new Map(),
      removedRevisions: new Map(),
      confirmed: new Map(),
      listeners: new Set([listener]),
      unsubscribe: () => {},
    };
    subscriptions.set(uid, state);
    const active = state;
    active.unsubscribe = onSnapshot(
      query(
        getTeacherPatchNotesCollection(uid),
        orderBy("updatedAt", "desc"),
        limit(TEACHER_PATCH_NOTES_LIMIT),
      ),
      (snapshot) => {
        if (subscriptions.get(uid) !== active) return;
        const notes = new Map(
          snapshot.docs.map((item) => {
            const note = mapTeacherPatchNoteDoc(item);
            return [note.id, note];
          }),
        );
        if (!snapshot.metadata?.fromCache) {
          active.serverNotes.forEach((note, id) => {
            if (!notes.has(id))
              active.removedRevisions.set(
                id,
                Math.max(
                  active.removedRevisions.get(id) ?? -1,
                  note.noteRevision,
                ),
              );
          });
          active.serverNotes = new Map(notes);
        }
        // Gateway acknowledgements and Firestore snapshots arrive independently.
        // Never let a delayed snapshot undo a write already confirmed by the server.
        active.confirmed.forEach((confirmed, id) => {
          const incoming = notes.get(id);
          if (!confirmed.note) {
            notes.delete(id);
          } else if (
            incoming &&
            incoming.noteRevision >= confirmed.note.noteRevision
          ) {
            confirmed.note = incoming;
            confirmed.awaitingSnapshot = false;
            clearTimeout(confirmed.verification);
            confirmed.verification = undefined;
          } else if (
            incoming ||
            confirmed.awaitingSnapshot ||
            snapshot.metadata?.fromCache
          ) {
            notes.set(id, confirmed.note);
            if (!incoming && !snapshot.metadata?.fromCache)
              verifyUnobservedNote(uid, active, id, confirmed);
          } else {
            // Once the stream has caught up, absence may reflect another tab's
            // deletion or eviction from the latest-100 query. Do not resurrect it.
            active.confirmed.delete(id);
            clearTimeout(confirmed.verification);
          }
        });
        active.notes = notes;
        publishNotes(active);
      },
      (error) => {
        if (subscriptions.get(uid) !== active) return;
        console.error("Failed to subscribe teacher patch notes:", error);
        subscriptions.delete(uid);
        clearConfirmationChecks(active);
        if (/(?:permission-denied|unauthenticated)$/.test(error.code)) {
          active.notes.clear();
          active.confirmed.clear();
          publishNotes(active);
        }
        active.listeners.forEach((item) => item.onError?.(error));
      },
    );
  } else {
    state.listeners.add(listener);
    publishNotes(state);
  }
  const active = state;
  return () => {
    active.listeners.delete(listener);
    if (!active.listeners.size && subscriptions.get(uid) === active) {
      subscriptions.delete(uid);
      clearConfirmationChecks(active);
      active.unsubscribe();
    }
  };
};

type NoteCommandResult = Awaited<
  ReturnType<typeof executeTeacherPatchNoteCommand>
>;

// Normally the stream catches up before this timer runs. A note changed and
// deleted by another tab can skip that revision entirely; confirm that rare
// case with one document read instead of keeping the acknowledgement forever.
const verifyUnobservedNote = (
  uid: string,
  state: NoteSubscription,
  noteId: string,
  confirmed: ConfirmedNote,
) => {
  if (!confirmed.awaitingSnapshot || confirmed.verification !== undefined)
    return;
  confirmed.verification = setTimeout(async () => {
    try {
      if (
        subscriptions.get(uid) !== state ||
        state.confirmed.get(noteId) !== confirmed ||
        !confirmed.awaitingSnapshot
      )
        return;
      const latest = await getDocFromServer(
        doc(getTeacherPatchNotesCollection(uid), noteId),
      );
      if (
        subscriptions.get(uid) !== state ||
        state.confirmed.get(noteId) !== confirmed ||
        !confirmed.awaitingSnapshot
      )
        return;
      const note = latest.exists() ? mapTeacherPatchNoteDoc(latest) : null;
      if (note && note.noteRevision < (confirmed.note?.noteRevision ?? 0))
        return;
      confirmed.note = note;
      confirmed.awaitingSnapshot = !!note;
      if (note) state.notes.set(noteId, note);
      else state.notes.delete(noteId);
      publishNotes(state);
    } catch {
      // Keep the confirmed write if offline. A later snapshot can reconcile it.
    } finally {
      confirmed.verification = undefined;
    }
  }, 2000);
};

const applyConfirmedNote = (
  uid: string,
  state: NoteSubscription | undefined,
  result: NoteCommandResult,
  content?: ReturnType<typeof buildNoteContent>,
  fallback?: TeacherPatchNote,
) => {
  if (!state || subscriptions.get(uid) !== state) return;
  const current = state.notes.get(result.noteId);
  const previous = state.confirmed.get(result.noteId);
  if (previous && !previous.note) return;
  if (
    !current &&
    (state.removedRevisions.get(result.noteId) ?? -1) >= result.noteRevision
  )
    return;
  if (current && current.noteRevision >= result.noteRevision) {
    const confirmed = {
      note: current,
      awaitingSnapshot:
        previous?.note?.noteRevision === current.noteRevision
          ? previous.awaitingSnapshot
          : false,
    };
    clearTimeout(previous?.verification);
    state.confirmed.set(result.noteId, confirmed);
    verifyUnobservedNote(uid, state, result.noteId, confirmed);
    return;
  }
  const timestamp = { seconds: Date.now() / 1000 };
  const note = result.deleted
    ? null
    : mapTeacherPatchNoteDoc({
        id: result.noteId,
        data: () => ({
          ...fallback,
          ...current,
          ...content,
          ownerUid: uid,
          noteRevision: result.noteRevision,
          status: result.status,
          createdAt: current?.createdAt || fallback?.createdAt || timestamp,
          updatedAt: timestamp,
          completedAt:
            result.status === "done"
              ? current?.completedAt || fallback?.completedAt || timestamp
              : null,
        }),
      });
  clearTimeout(previous?.verification);
  const confirmed = { note, awaitingSnapshot: !!note };
  state.confirmed.set(result.noteId, confirmed);
  if (note) state.notes.set(result.noteId, note);
  else state.notes.delete(result.noteId);
  publishNotes(state);
  verifyUnobservedNote(uid, state, result.noteId, confirmed);
};

const runNoteMutation = async (
  uid: string,
  noteId: string,
  operation: (
    state: NoteSubscription | undefined,
  ) => Promise<NoteCommandResult>,
) => {
  const key = JSON.stringify([uid, noteId]);
  if (pendingNotes.has(key))
    throw new Error("이 메모를 저장하고 있습니다. 잠시 후 다시 시도해 주세요.");
  pendingNotes.add(key);
  const state = subscriptions.get(uid);
  try {
    return await operation(state);
  } catch (error) {
    const code = String((error as { code?: string })?.code || "");
    if (state && /(?:^|\/)(?:aborted|not-found)$/.test(code)) {
      // Refresh only the conflicting memo. Keep the editor's input and original
      // error; never silently retry using another tab's newer revision.
      try {
        const latest = await getDocFromServer(
          doc(getTeacherPatchNotesCollection(uid), noteId),
        );
        if (subscriptions.get(uid) === state) {
          const note = latest.exists() ? mapTeacherPatchNoteDoc(latest) : null;
          const current = state.notes.get(noteId);
          const confirmed = state.confirmed.get(noteId);
          const alreadyRemoved =
            note &&
            ((confirmed && !confirmed.note) ||
              (!current &&
                (state.removedRevisions.get(noteId) ?? -1) >=
                  note.noteRevision));
          if (
            !alreadyRemoved &&
            (!note || !current || note.noteRevision >= current.noteRevision)
          ) {
            clearTimeout(state.confirmed.get(noteId)?.verification);
            const confirmed = { note, awaitingSnapshot: !!note };
            state.confirmed.set(noteId, confirmed);
            if (note) state.notes.set(noteId, note);
            else state.notes.delete(noteId);
            publishNotes(state);
            verifyUnobservedNote(uid, state, noteId, confirmed);
          }
        }
      } catch {
        // A refresh failure must not conceal the original command failure.
      }
    }
    throw error;
  } finally {
    pendingNotes.delete(key);
  }
};

export const createTeacherPatchNote = async (
  uid: string,
  input: TeacherPatchNoteInput,
) => {
  const state = subscriptions.get(uid);
  const content = buildNoteContent(input);
  const result = await executeTeacherPatchNoteCommand(
    "createTeacherPatchNote",
    { content },
    uid,
  );
  applyConfirmedNote(uid, state, result, content);
  return result;
};

export const updateTeacherPatchNote = async (
  uid: string,
  noteId: string,
  expectedNoteRevision: number,
  input: TeacherPatchNoteInput,
) =>
  runNoteMutation(uid, noteId, async (state) => {
    const content = buildNoteContent(input);
    const result = await executeTeacherPatchNoteCommand(
      "updateTeacherPatchNote",
      { noteId, expectedNoteRevision, content },
      uid,
    );
    applyConfirmedNote(uid, state, result, content);
    return result;
  });

export const updateTeacherPatchNoteStatus = async (
  uid: string,
  note: TeacherPatchNote,
  status: TeacherPatchNoteStatus,
) =>
  runNoteMutation(uid, note.id, async (state) => {
    const result = await executeTeacherPatchNoteCommand(
      "updateTeacherPatchNoteStatus",
      { noteId: note.id, expectedNoteRevision: note.noteRevision, status },
      uid,
    );
    applyConfirmedNote(uid, state, result, undefined, note);
    return result;
  });

export const deleteTeacherPatchNote = async (
  uid: string,
  note: TeacherPatchNote,
) =>
  runNoteMutation(uid, note.id, async (state) => {
    const result = await executeTeacherPatchNoteCommand(
      "deleteTeacherPatchNote",
      { noteId: note.id, expectedNoteRevision: note.noteRevision },
      uid,
    );
    applyConfirmedNote(uid, state, result);
    return result;
  });
