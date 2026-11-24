import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  normalizeHistoryClassroomAssignment,
  type HistoryClassroomAssignment,
} from "./historyClassroom";
import { getSemesterCollectionPath, getSemesterDocPath } from "./semesterScope";

type ConfigLike = Parameters<typeof getSemesterCollectionPath>[0];

// Students never read the teacher's assignment document, which holds the
// roster. The server keeps a roster-free copy and one document per assigned
// student with that student's own reason and reset marker.
export const HISTORY_CLASSROOM_STUDENT_VIEW_COLLECTION =
  "history_classroom_student_views";
export const HISTORY_CLASSROOM_ASSIGNEE_COLLECTION =
  "history_classroom_assignees";

export interface HistoryClassroomAssignee {
  assignmentId: string;
  uid: string;
  reason: string;
  retryResetAt: unknown;
}

const isPermissionDenied = (error: unknown) =>
  (error as { code?: string } | null)?.code === "permission-denied";

export const normalizeHistoryClassroomAssignee = (
  raw: Record<string, unknown> | undefined,
): HistoryClassroomAssignee | null => {
  const assignmentId = String(raw?.assignmentId || "").trim();
  const uid = String(raw?.uid || "").trim();
  if (!assignmentId || !uid || assignmentId.includes("/")) return null;
  return {
    assignmentId,
    uid,
    reason: typeof raw?.reason === "string" ? raw.reason : "",
    retryResetAt: raw?.retryResetAt ?? null,
  };
};

export const getHistoryClassroomAssigneeDocPath = (
  config: ConfigLike,
  assignmentId: string,
  uid: string,
) =>
  getSemesterDocPath(
    config,
    HISTORY_CLASSROOM_ASSIGNEE_COLLECTION,
    `${assignmentId}_${uid}`,
  );

// The copy has no roster. Only this student's own details are attached again,
// so the shared assignment helpers work as they do for the teacher document.
export const buildStudentHistoryClassroomAssignment = (
  view: Record<string, unknown>,
  assignee: HistoryClassroomAssignee,
): HistoryClassroomAssignment =>
  normalizeHistoryClassroomAssignment(assignee.assignmentId, {
    ...view,
    targetStudentUid: assignee.uid,
    targetStudentUids: [assignee.uid],
    targetStudentAccessMap: { [assignee.uid]: true },
    targetStudentReasons: assignee.reason
      ? { [assignee.uid]: assignee.reason }
      : {},
    retryResetByStudentUid: assignee.retryResetAt
      ? { [assignee.uid]: assignee.retryResetAt }
      : {},
  });

const ownAssigneeQuery = (config: ConfigLike, uid: string) =>
  query(
    collection(
      db,
      getSemesterCollectionPath(config, HISTORY_CLASSROOM_ASSIGNEE_COLLECTION),
    ),
    where("uid", "==", uid),
  );

// A missing permission means these documents are not available to this
// account; the caller then uses the earlier assignment documents.
export const loadOwnHistoryClassroomAssignees = async (
  config: ConfigLike,
  uid: string,
  fromServer = false,
): Promise<HistoryClassroomAssignee[]> => {
  if (!uid) return [];
  try {
    const snapshot = await (fromServer ? getDocsFromServer : getDocs)(
      ownAssigneeQuery(config, uid),
    );
    return snapshot.docs
      .map((item) => normalizeHistoryClassroomAssignee(item.data()))
      .filter(
        (item): item is HistoryClassroomAssignee => !!item && item.uid === uid,
      );
  } catch (error) {
    if (isPermissionDenied(error)) return [];
    throw error;
  }
};

export const loadOwnHistoryClassroomAssignee = async (
  config: ConfigLike,
  assignmentId: string,
  uid: string,
): Promise<HistoryClassroomAssignee | null> => {
  if (!assignmentId || !uid) return null;
  try {
    const snapshot = await getDoc(
      doc(db, getHistoryClassroomAssigneeDocPath(config, assignmentId, uid)),
    );
    const assignee = snapshot.exists()
      ? normalizeHistoryClassroomAssignee(snapshot.data())
      : null;
    return assignee?.uid === uid && assignee.assignmentId === assignmentId
      ? assignee
      : null;
  } catch (error) {
    if (isPermissionDenied(error)) return null;
    throw error;
  }
};

const viewDoc = (config: ConfigLike, assignmentId: string) =>
  doc(
    db,
    getSemesterDocPath(
      config,
      HISTORY_CLASSROOM_STUDENT_VIEW_COLLECTION,
      assignmentId,
    ),
  );

export const loadStudentHistoryClassroomAssignment = async (
  config: ConfigLike,
  assignee: HistoryClassroomAssignee,
  fromServer = false,
): Promise<HistoryClassroomAssignment | null> => {
  try {
    const snapshot = await (fromServer ? getDocFromServer : getDoc)(
      viewDoc(config, assignee.assignmentId),
    );
    return snapshot.exists()
      ? buildStudentHistoryClassroomAssignment(snapshot.data(), assignee)
      : null;
  } catch (error) {
    if (isPermissionDenied(error)) return null;
    throw error;
  }
};

// The copy alone is enough to show a past result; it carries no roster.
export const loadHistoryClassroomStudentViewData = async (
  config: ConfigLike,
  assignmentId: string,
): Promise<Record<string, unknown> | null> => {
  const snapshot = await getDoc(viewDoc(config, assignmentId)).catch(
    () => null,
  );
  return snapshot?.exists() ? snapshot.data() : null;
};

export const subscribeStudentHistoryClassroomAssignment = (
  config: ConfigLike,
  assignee: HistoryClassroomAssignee,
  onNext: (assignment: HistoryClassroomAssignment | null) => void,
  onError: (error: { code?: string }) => void,
) =>
  onSnapshot(
    viewDoc(config, assignee.assignmentId),
    (snapshot) =>
      onNext(
        snapshot.exists()
          ? buildStudentHistoryClassroomAssignment(snapshot.data(), assignee)
          : null,
      ),
    onError,
  );

// Fires for changes after the first delivery: a new assignment, a removal, a
// changed reason or a teacher's retry reset.
export const subscribeOwnHistoryClassroomAssignees = (
  config: ConfigLike,
  uid: string,
  onChange: () => void,
) => {
  let initial = true;
  return onSnapshot(
    ownAssigneeQuery(config, uid),
    () => {
      if (initial) initial = false;
      else onChange();
    },
    (error) =>
      console.warn("Failed to watch own history classroom assignments", error),
  );
};

export const subscribeOwnHistoryClassroomAssignee = (
  config: ConfigLike,
  assignmentId: string,
  uid: string,
  onNext: (assignee: HistoryClassroomAssignee | null) => void,
) =>
  onSnapshot(
    doc(db, getHistoryClassroomAssigneeDocPath(config, assignmentId, uid)),
    (snapshot) =>
      onNext(
        snapshot.exists()
          ? normalizeHistoryClassroomAssignee(snapshot.data())
          : null,
      ),
    () => {
      /* An access error never unlocks anything; the load result stands. */
    },
  );
