import {
  doc,
  getDocFromServer,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type DocumentData,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import { assertArchiveWritable } from "./semesterArchive";
import { getSemesterDocPath } from "./semesterScope";
import type { SystemConfig } from "../types";

type Scope = Pick<SystemConfig, "year" | "semester">;
export type RhythmPublicationStatus = "checking" | "open" | "closed" | "error";
export interface RhythmPublication {
  enabled: boolean;
  revision: number;
}
export interface RhythmPublicationSnapshot extends RhythmPublication {
  status: RhythmPublicationStatus;
}
const validScope = (config: Scope) => {
  if (!/^\d{4}$/.test(config.year) || !/^[12]$/.test(config.semester))
    throw new Error("운영 학기를 확인하지 못했습니다.");
};
const reference = (config: Scope, collection = "rhythm_publication") => {
  validScope(config);
  return doc(db, getSemesterDocPath(config, collection, "gungdeok-rock"));
};

/** Missing is the default closed state; malformed existing data is an error. */
export function parseRhythmPublication(data?: DocumentData): RhythmPublication {
  if (!data) return { enabled: false, revision: 0 };
  if (
    data.schemaVersion !== 1 ||
    typeof data.enabled !== "boolean" ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 1 ||
    typeof data.updatedAt?.toMillis !== "function"
  )
    throw new Error("게임 공개 설정을 확인하지 못했습니다.");
  return { enabled: data.enabled, revision: data.revision };
}

/** One exact document; no collection reads, polling or persistent cache. */
export function subscribeRhythmPublication(
  config: Scope,
  onState: (state: RhythmPublicationSnapshot) => void,
) {
  return onSnapshot(
    reference(config),
    { includeMetadataChanges: true },
    (snapshot) => {
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
        onState({ status: "checking", enabled: false, revision: 0 });
        return;
      }
      try {
        const data = parseRhythmPublication(snapshot.data());
        onState({ ...data, status: data.enabled ? "open" : "closed" });
      } catch {
        onState({ status: "error", enabled: false, revision: 0 });
      }
    },
    (error) => {
      onState({
        status: error.code === "permission-denied" ? "closed" : "error",
        enabled: false,
        revision: 0,
      });
    },
  );
}

/** A fresh read rechecks time-based session expiry on each start/resume. */
export async function confirmRhythmPublication(
  config: Scope,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const snapshot = await Promise.race([
      getDocFromServer(reference(config)),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                "공개 상태를 확인하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
              ),
            ),
          8000,
        );
      }),
    ]);
    if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites)
      return false;
    return parseRhythmPublication(snapshot.data()).enabled;
  } finally {
    clearTimeout(timeout);
  }
}

/** Revision conflicts never overwrite another teacher's settings. */
export async function saveRhythmPublication(
  config: Scope,
  enabled: boolean,
  expectedRevision: number,
): Promise<RhythmPublication> {
  assertArchiveWritable();
  validScope(config);
  const user = auth.currentUser;
  if (!user) throw new Error("다시 로그인한 뒤 저장해 주세요.");
  if (
    typeof enabled !== "boolean" ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0
  )
    throw new Error("게임 공개 설정을 다시 확인해 주세요.");
  const publication = reference(config);
  const audit = reference(config, "rhythm_publication_audit");
  return runTransaction(db, async (transaction) => {
    if (auth.currentUser !== user)
      throw new Error("계정이 변경되었습니다. 다시 확인해 주세요.");
    const snapshot = await transaction.get(publication);
    if (auth.currentUser !== user)
      throw new Error("계정이 변경되었습니다. 다시 확인해 주세요.");
    const current = parseRhythmPublication(snapshot.data());
    // This also makes an explicit retry after a lost response a no-op.
    if (current.enabled === enabled) return current;
    if (current.revision !== expectedRevision)
      throw new Error(
        "다른 곳에서 공개 설정이 바뀌었습니다. 다시 확인한 뒤 저장해 주세요.",
      );
    const next = { enabled, revision: current.revision + 1 };
    const data = { ...next, schemaVersion: 1, updatedAt: serverTimestamp() };
    transaction.set(publication, data);
    transaction.set(audit, { ...data, updatedBy: user.uid });
    return next;
  });
}
