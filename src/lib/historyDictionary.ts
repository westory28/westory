import { getIdTokenResult } from "firebase/auth";
import {
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import {
  ensureHistoryDictionarySession,
  getHistoryDictionaryCallable,
} from "./historyDictionarySession";
import { getSemesterCollectionPath } from "./semesterScope";
import type {
  HistoryDictionaryRequest,
  HistoryDictionaryTerm,
  StudentHistoryDictionaryWord,
  SystemConfig,
} from "../types";

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;

const TERMS_COLLECTION = "history_dictionary_terms";
const REQUESTS_COLLECTION = "history_dictionary_requests";
const TEACHER_TERMS_LIMIT = 500;

export const normalizeHistoryDictionaryWord = (value: string) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const mapDoc = <T extends { id: string }>(docSnap: {
  id: string;
  data: () => Record<string, unknown>;
}) => ({ id: docSnap.id, ...docSnap.data() }) as T;

const timestampFromMs = (value: unknown) => {
  const millis = Number(value || 0);
  return millis > 0
    ? {
        toDate: () => new Date(millis),
        toMillis: () => millis,
      }
    : null;
};

const mapTeacherStudentWordData = (
  data: Record<string, unknown>,
): StudentHistoryDictionaryWord => ({
  id: String(data.id || ""),
  uid: String(data.uid || ""),
  termId: String(data.termId || ""),
  word: String(data.word || ""),
  normalizedWord: normalizeHistoryDictionaryWord(
    String(data.normalizedWord || data.word || ""),
  ),
  definition: String(data.definition || ""),
  studentLevel: String(data.studentLevel || ""),
  tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
  status: "saved",
  requestId: String(data.requestId || ""),
  studentName: String(data.studentName || "학생"),
  grade: String(data.grade || ""),
  class: String(data.class || ""),
  number: String(data.number || ""),
  definitionSource: String(data.definitionSource || ""),
  memo: String(data.memo || ""),
  year: String(data.year || ""),
  semester: String(data.semester || ""),
  reviewedBy: String(data.reviewedBy || ""),
  rewardTermId: String(data.rewardTermId || ""),
  rewardTransactionId: String(data.rewardTransactionId || ""),
  rewardAmount: Number(data.rewardAmount || 0),
  createdAt: timestampFromMs(data.createdAtMs),
  updatedAt: timestampFromMs(data.updatedAtMs),
});

const getYearSemester = (config: ConfigLike) => {
  const year = String(config?.year || "");
  const semester = String(config?.semester || "");
  if (!/^\d{4}$/.test(year) || !["1", "2"].includes(semester)) {
    throw new Error(
      "사전의 학기 정보를 확인하지 못했습니다. 화면을 새로고침해 주세요.",
    );
  }
  return { year, semester };
};
const scopedPath = (config: ConfigLike, name: string) =>
  getSemesterCollectionPath(getYearSemester(config), name);

type WriteVersion = string | null;
const versions = new Map<string, WriteVersion>();
const versionFor = (data: Record<string, unknown>): WriteVersion => {
  if (!data.updatedAt) return "legacy";
  const value = data.updatedAt as { seconds: number; nanoseconds: number };
  if (
    !Number.isSafeInteger(value.seconds) ||
    !Number.isSafeInteger(value.nanoseconds)
  ) {
    throw new Error(
      "저장 버전을 확인하지 못했습니다. 목록을 다시 불러와 주세요.",
    );
  }
  return `${value.seconds}:${value.nanoseconds}`;
};
const rememberDocument = <T extends { id: string }>(snapshot: {
  id: string;
  ref: { path: string };
  data: () => Record<string, unknown>;
}) => {
  versions.set(snapshot.ref.path, versionFor(snapshot.data()));
  return mapDoc<T>(snapshot);
};
const readVersion = async (path: string): Promise<WriteVersion> => {
  if (versions.has(path)) return versions.get(path)!;
  const snapshot = await getDocFromServer(doc(db, path));
  const version = snapshot.exists() ? versionFor(snapshot.data()) : null;
  versions.set(path, version);
  return version;
};
const sha1 = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
const termIdFor = async (word: string) =>
  `term_${await sha1(normalizeHistoryDictionaryWord(word))}`;
const pendingCommands = new Map<
  string,
  { commandId: string; commandType: string; payload: Record<string, unknown> }
>();
const conflictedIntents = new Set<string>();
const versionConflictError = () =>
  Object.assign(
    new Error(
      "자료가 변경되었습니다. 입력 내용을 보관한 뒤 화면을 새로고침해 주세요.",
    ),
    { code: "history-dictionary/version-conflict" },
  );
let versionOwner = "";
const readRequestVersion = async (path: string, studentUid: string) => {
  if (versions.has(path)) return versions.get(path)!;
  const split = path.lastIndexOf("/");
  // Missing request documents cannot satisfy resource.data.uid rules. A scoped
  // owner query can safely establish that this request has not been created.
  const constraints = [where(documentId(), "==", path.slice(split + 1))];
  if (studentUid) constraints.push(where("uid", "==", studentUid));
  const snapshot = await getDocs(
    query(collection(db, path.slice(0, split)), ...constraints, limit(1)),
  );
  const version = snapshot.empty ? null : versionFor(snapshot.docs[0].data());
  versions.set(path, version);
  return version;
};

const executeDictionaryCommand = async (
  commandType: string,
  input: Record<string, unknown>,
) => {
  const user = auth.currentUser;
  if (!user) throw new Error("다시 로그인해 주세요.");
  const uid = user.uid;
  const authTime = (await getIdTokenResult(user)).authTime;
  const assertIdentity = async () => {
    const currentTime = (await getIdTokenResult(user)).authTime;
    if (auth.currentUser !== user || currentTime !== authTime) {
      throw new Error("로그인 상태가 변경되었습니다. 다시 로그인해 주세요.");
    }
  };
  await ensureHistoryDictionarySession();
  await assertIdentity();
  if (versionOwner && versionOwner !== uid) {
    versions.clear();
    pendingCommands.clear();
    conflictedIntents.clear();
  }
  versionOwner = uid;
  const scope = getYearSemester(input as ConfigLike);
  const root = scopedPath(scope, "").replace(/\/$/, "");
  const key = JSON.stringify([uid, authTime, commandType, input]);
  if (conflictedIntents.has(key)) throw versionConflictError();
  let envelope = pendingCommands.get(key);
  const payload = { ...input };
  if (!envelope) {
    const student = [
      "requestHistoryDictionaryTerm",
      "saveStudentHistoryDictionaryWord",
      "saveStudentHistoryDictionaryEntry",
      "deleteStudentHistoryDictionaryWord",
    ].includes(commandType);
    const targetUid = student
      ? uid
      : String(input.uid || input.fallbackUid || "");
    const termId =
      String(input.termId || "") ||
      (input.word || input.normalizedWord
        ? await termIdFor(String(input.word || input.normalizedWord))
        : "");
    const requestId =
      commandType === "requestHistoryDictionaryTerm"
        ? `req_${await sha1(`${scope.year}:${scope.semester}:${uid}:${normalizeHistoryDictionaryWord(String(input.word))}`)}`
        : String(input.requestId || input.fallbackRequestId || "");
    if (
      student ||
      [
        "deleteStudentHistoryDictionaryWordByTeacher",
        "updateStudentHistoryDictionaryWordByTeacher",
      ].includes(commandType)
    ) {
      payload.expectedWordVersion = await readVersion(
        `${root}/dictionary_students/${targetUid}/history_dictionary_words/${termId}`,
      );
    }
    if (
      [
        "saveStudentHistoryDictionaryWord",
        "saveHistoryDictionaryTerm",
        "approveHistoryDictionaryTermForRequests",
      ].includes(commandType)
    ) {
      payload.expectedTermVersion = await readVersion(
        `${root}/${TERMS_COLLECTION}/${termId}`,
      );
    }
    if (requestId)
      payload.expectedRequestVersion = await readRequestVersion(
        `${root}/${REQUESTS_COLLECTION}/${requestId}`,
        student ? uid : "",
      );
    envelope = { commandId: crypto.randomUUID(), commandType, payload };
    pendingCommands.set(key, envelope);
  }
  const callable = await getHistoryDictionaryCallable("executeCommand");
  await assertIdentity();
  let response;
  try {
    response = await callable(envelope);
  } catch (error) {
    const failure = error as { code?: string; details?: { reason?: string } };
    if (failure.details?.reason === "HISTORY_DICTIONARY_VERSION_CONFLICT") {
      pendingCommands.delete(key);
      conflictedIntents.add(key);
      for (const path of versions.keys())
        if (path.startsWith(`${root}/`)) versions.delete(path);
      throw versionConflictError();
    }
    if (
      [
        "functions/invalid-argument",
        "functions/permission-denied",
        "functions/failed-precondition",
        "functions/unauthenticated",
      ].includes(failure.code || "")
    )
      pendingCommands.delete(key);
    throw error;
  }
  const data = response.data as { status: string; result: unknown };
  if (data.status !== "SUCCEEDED")
    throw new Error("저장 결과를 확인하지 못했습니다. 다시 시도해 주세요.");
  pendingCommands.delete(key);
  for (const path of versions.keys())
    if (path.startsWith(`${root}/`)) versions.delete(path);
  return { data: data.result };
};
const command = async (name: string) => (input: Record<string, unknown>) =>
  executeDictionaryCommand(name, input);

const subscribeAfterSession = (
  start: (fail: (error: Error) => void) => Unsubscribe,
  onError?: (error: Error) => void,
): Unsubscribe => {
  let cancelled = false;
  let unsubscribe: Unsubscribe | undefined;
  const fail = (error: unknown) => {
    if (cancelled) return;
    const normalized =
      error instanceof Error ? error : new Error(String(error));
    console.error("Failed to load history dictionary:", normalized);
    onError?.(normalized);
  };
  void ensureHistoryDictionarySession()
    .then(() => {
      if (!cancelled) unsubscribe = start(fail);
    })
    .catch(fail);
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
};

export const loadPublishedHistoryDictionaryTerm = async (
  word: string,
  config: ConfigLike,
) => {
  const normalizedWord = normalizeHistoryDictionaryWord(word);
  if (!normalizedWord) return null;
  const path = scopedPath(config, TERMS_COLLECTION);
  await ensureHistoryDictionarySession();
  const snapshot = await getDocs(
    query(
      collection(db, path),
      where("normalizedWord", "==", normalizedWord),
      where("status", "==", "published"),
      limit(1),
    ),
  );
  const term = snapshot.empty
    ? null
    : rememberDocument<HistoryDictionaryTerm>(snapshot.docs[0]);
  return term?.status === "published" ? term : null;
};

export const subscribeStudentHistoryDictionaryWords = (
  uid: string,
  onChange: (words: StudentHistoryDictionaryWord[]) => void,
  config: ConfigLike,
  onError?: (error: Error) => void,
): Unsubscribe =>
  subscribeAfterSession(
    (fail) =>
      onSnapshot(
        query(
          collection(
            db,
            scopedPath(
              config,
              `dictionary_students/${uid}/history_dictionary_words`,
            ),
          ),
          orderBy("updatedAt", "desc"),
          limit(20),
        ),
        (snapshot) =>
          onChange(
            snapshot.docs.map((item) =>
              rememberDocument<StudentHistoryDictionaryWord>(item),
            ),
          ),
        fail,
      ),
    onError,
  );

export const subscribeTeacherHistoryDictionaryRequests = (
  onChange: (requests: HistoryDictionaryRequest[]) => void,
  config: ConfigLike,
  onError?: (error: Error) => void,
): Unsubscribe =>
  subscribeAfterSession(
    (fail) =>
      onSnapshot(
        query(
          collection(db, scopedPath(config, REQUESTS_COLLECTION)),
          orderBy("updatedAt", "desc"),
          limit(100),
        ),
        (snapshot) =>
          onChange(
            snapshot.docs.map((item) =>
              rememberDocument<HistoryDictionaryRequest>(item),
            ),
          ),
        fail,
      ),
    onError,
  );

export const loadTeacherStudentHistoryDictionaryWords = async (
  config: ConfigLike,
) => {
  const scope = getYearSemester(config);
  const callable = await getHistoryDictionaryCallable(
    "listStudentHistoryDictionaryWordsForTeacher",
  );
  const result = await callable(scope);
  const data = result.data as { words?: Record<string, unknown>[] };
  return Array.isArray(data.words)
    ? data.words.map((item) => {
        if (typeof item.writeVersion === "string") {
          versions.set(
            scopedPath(
              scope,
              `dictionary_students/${String(item.uid)}/history_dictionary_words/${String(item.termId)}`,
            ),
            item.writeVersion,
          );
        }
        return mapTeacherStudentWordData(item);
      })
    : [];
};

export const subscribeTeacherHistoryDictionaryTerms = (
  onChange: (terms: HistoryDictionaryTerm[]) => void,
  onError: ((error: Error) => void) | undefined,
  config: ConfigLike,
): Unsubscribe =>
  subscribeAfterSession(
    (fail) =>
      onSnapshot(
        query(
          collection(db, scopedPath(config, TERMS_COLLECTION)),
          orderBy("updatedAt", "desc"),
          limit(TEACHER_TERMS_LIMIT),
        ),
        (snapshot) =>
          onChange(
            snapshot.docs.map((item) =>
              rememberDocument<HistoryDictionaryTerm>(item),
            ),
          ),
        fail,
      ),
    onError,
  );

export const loadTeacherHistoryDictionaryTerms = async (config: ConfigLike) => {
  const path = scopedPath(config, TERMS_COLLECTION);
  await ensureHistoryDictionarySession();
  const snapshot = await getDocs(
    query(
      collection(db, path),
      orderBy("updatedAt", "desc"),
      limit(TEACHER_TERMS_LIMIT),
    ),
  );
  return snapshot.docs.map((item) =>
    rememberDocument<HistoryDictionaryTerm>(item),
  );
};

export const requestHistoryDictionaryTerm = async (
  config: ConfigLike,
  input: {
    word: string;
    memo: string;
    warningAccepted: boolean;
  },
) => {
  const { year, semester } = getYearSemester(config);
  const callable = await command("requestHistoryDictionaryTerm");
  await callable({
    year,
    semester,
    word: input.word,
    memo: input.memo,
    warningAccepted: input.warningAccepted,
  });
};

export const saveStudentHistoryDictionaryWord = async (
  termId: string,
  config: ConfigLike,
) => {
  const { year, semester } = getYearSemester(config);
  const callable = await command("saveStudentHistoryDictionaryWord");
  await callable({ year, semester, termId });
};

export const saveStudentHistoryDictionaryEntry = async (input: {
  config?: ConfigLike;
  word: string;
  definition: string;
}) => {
  const { year, semester } = getYearSemester(input.config);
  const callable = await command("saveStudentHistoryDictionaryEntry");
  const result = await callable({
    year,
    semester,
    word: input.word,
    definition: input.definition,
  });
  return result.data as {
    termId: string;
    saved: boolean;
    reward?: {
      awarded?: boolean;
      amount?: number;
      blockedReason?: string;
    };
  };
};

export const deleteStudentHistoryDictionaryWord = async (
  config: ConfigLike,
  termId: string,
) => {
  const { year, semester } = getYearSemester(config);
  const callable = await command("deleteStudentHistoryDictionaryWord");
  const result = await callable({
    year,
    semester,
    termId,
  });
  return result.data as {
    termId: string;
    deleted: boolean;
    reward?: {
      reclaimed?: boolean;
      amount?: number;
      blockedReason?: string;
    };
  };
};

export const deleteStudentHistoryDictionaryWordByTeacher = async (
  config: ConfigLike,
  input: {
    uid: string;
    termId?: string;
    requestId?: string;
    word?: string;
    normalizedWord?: string;
    reason?: string;
    year?: string;
    semester?: string;
  },
) => {
  const { year, semester } = getYearSemester(config);
  const callable = await command("deleteStudentHistoryDictionaryWordByTeacher");
  const result = await callable({
    year: input.year || year,
    semester: input.semester || semester,
    uid: input.uid,
    termId: input.termId || "",
    requestId: input.requestId || "",
    word: input.word || "",
    normalizedWord: input.normalizedWord || "",
    reason: input.reason || "",
  });
  return result.data as {
    termId: string;
    requestId?: string;
    deleted: boolean;
    reward?: {
      reclaimed?: boolean;
      amount?: number;
      blockedReason?: string;
    };
  };
};

export const updateStudentHistoryDictionaryWordByTeacher = async (
  config: ConfigLike,
  input: {
    uid: string;
    termId: string;
    word: string;
    definition: string;
    year?: string;
    semester?: string;
  },
) => {
  const { year, semester } = getYearSemester(config);
  const callable = await command("updateStudentHistoryDictionaryWordByTeacher");
  const result = await callable({
    year: input.year || year,
    semester: input.semester || semester,
    uid: input.uid,
    termId: input.termId,
    word: input.word,
    definition: input.definition,
  });
  return result.data as {
    termId: string;
    previousTermId: string;
    updated: boolean;
  };
};

export const saveHistoryDictionaryTerm = async (
  config: ConfigLike,
  input: {
    word: string;
    definition: string;
    studentLevel: string;
    relatedUnitId?: string;
    tags?: string[];
    fallbackRequestId?: string;
    fallbackUid?: string;
  },
) => {
  const { year, semester } = getYearSemester(config);
  const callable = await command("saveHistoryDictionaryTerm");
  await callable({
    year,
    semester,
    word: input.word,
    definition: input.definition,
    studentLevel: input.studentLevel,
    relatedUnitId: input.relatedUnitId || "",
    tags: input.tags || [],
    fallbackRequestId: input.fallbackRequestId || "",
    fallbackUid: input.fallbackUid || "",
  });
};

export const saveHistoryDictionaryTermsBulk = async (
  config: ConfigLike,
  input: {
    terms: Array<{
      word: string;
      definition: string;
      studentLevel: string;
      relatedUnitId?: string;
      tags?: string[];
    }>;
  },
) => {
  const { year, semester } = getYearSemester(config);
  const callable = await command("saveHistoryDictionaryTermsBulk");
  const result = await callable({
    year,
    semester,
    terms: input.terms.map((term) => ({
      word: term.word,
      definition: term.definition,
      studentLevel: term.studentLevel,
      relatedUnitId: term.relatedUnitId || "",
      tags: term.tags || [],
    })),
  });
  return result.data as {
    savedCount: number;
    termIds: string[];
  };
};

export const approveHistoryDictionaryTermForRequests = async (
  config: ConfigLike,
  input: {
    termId: string;
    requestId?: string;
  },
) => {
  const { year, semester } = getYearSemester(config);
  const callable = await command("approveHistoryDictionaryTermForRequests");
  await callable({
    year,
    semester,
    termId: input.termId,
    requestId: input.requestId || "",
  });
};
