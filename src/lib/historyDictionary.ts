import {
  collection,
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { auth, db, getHttpsCallable } from "./firebase";
import {
  executeWestoryCommand,
  hasPendingWestoryCommand,
  WestoryCommandError,
  type W2CommandPayloads,
  type W2CommandResults,
} from "./commandGateway";
import { getYearSemester } from "./semesterScope";
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

export type HistoryDictionaryWriteVersion = string | null;
export const getHistoryDictionaryWriteVersion = (
  record: { updatedAt?: unknown; writeVersion?: string } | null | undefined,
): HistoryDictionaryWriteVersion => {
  if (!record) return null;
  if (record.writeVersion) return record.writeVersion;
  const timestamp = record.updatedAt as
    | { seconds?: number; nanoseconds?: number }
    | undefined;
  return Number.isSafeInteger(timestamp?.seconds) &&
    Number.isSafeInteger(timestamp?.nanoseconds)
    ? `${timestamp!.seconds}:${timestamp!.nanoseconds}`
    : "legacy";
};

type DictionaryCommand =
  | "requestHistoryDictionaryTerm"
  | "saveStudentHistoryDictionaryWord"
  | "saveStudentHistoryDictionaryEntry"
  | "deleteStudentHistoryDictionaryWord"
  | "deleteStudentHistoryDictionaryWordByTeacher"
  | "updateStudentHistoryDictionaryWordByTeacher"
  | "saveHistoryDictionaryTerm"
  | "approveHistoryDictionaryTermForRequests";
// Memory only: preserve the original owner's intent through reauthentication
// remounts without putting student drafts in browser storage.
const dictionaryPending = new Map<
  string,
  {
    commandType: DictionaryCommand;
    payload: W2CommandPayloads[DictionaryCommand];
  }
>();
const dictionaryFlights = new Map<string, Promise<unknown>>();
const dictionaryListeners = new Set<() => void>();
const emitDictionaryPending = () =>
  dictionaryListeners.forEach((listener) => listener());
export const subscribeHistoryDictionaryMutation = (listener: () => void) => {
  dictionaryListeners.add(listener);
  return () => {
    dictionaryListeners.delete(listener);
  };
};
export const hasPendingHistoryDictionaryMutation = (uid: string) =>
  dictionaryPending.has(uid);
export const getPendingHistoryDictionaryDraft = (uid: string) => {
  if (auth.currentUser?.uid !== uid) return null;
  const pending = dictionaryPending.get(uid);
  if (!pending) return null;
  const value = pending.payload as unknown as Record<string, unknown>;
  return {
    word: typeof value.word === "string" ? value.word : "",
    definition: typeof value.definition === "string" ? value.definition : "",
    memo: typeof value.memo === "string" ? value.memo : "",
    relatedUnitId:
      typeof value.relatedUnitId === "string" ? value.relatedUnitId : "",
    tags: Array.isArray(value.tags) ? ([...value.tags] as string[]) : [],
  };
};
export const isHistoryDictionaryMutationBusy = (uid: string) =>
  dictionaryFlights.has(uid);
export const historyDictionaryMutationMessage = (error: unknown) =>
  error instanceof WestoryCommandError && error.retryable
    ? "이전 요청의 결과를 확인하지 못했습니다. ‘이전 요청 결과 확인’을 눌러 주세요."
    : error instanceof Error
      ? error.message
      : "입력 내용을 확인한 뒤 다시 시도해 주세요.";

const sendDictionaryPending = async (ownerUid: string) => {
  assertHistoryDictionaryEditorOwner(ownerUid);
  const pending = dictionaryPending.get(ownerUid);
  if (!pending) throw new Error("확인할 이전 요청이 없습니다.");
  try {
    let response;
    switch (pending.commandType) {
      case "requestHistoryDictionaryTerm":
        response = await executeWestoryCommand<DictionaryCommand>(
          "requestHistoryDictionaryTerm",
          pending.payload,
          { expectedUid: ownerUid },
        );
        break;
      case "saveStudentHistoryDictionaryWord":
        response = await executeWestoryCommand<DictionaryCommand>(
          "saveStudentHistoryDictionaryWord",
          pending.payload,
          { expectedUid: ownerUid },
        );
        break;
      case "saveStudentHistoryDictionaryEntry":
        response = await executeWestoryCommand<DictionaryCommand>(
          "saveStudentHistoryDictionaryEntry",
          pending.payload,
          { expectedUid: ownerUid },
        );
        break;
      case "deleteStudentHistoryDictionaryWord":
        response = await executeWestoryCommand<DictionaryCommand>(
          "deleteStudentHistoryDictionaryWord",
          pending.payload,
          { expectedUid: ownerUid },
        );
        break;
      case "deleteStudentHistoryDictionaryWordByTeacher":
        response = await executeWestoryCommand<DictionaryCommand>(
          "deleteStudentHistoryDictionaryWordByTeacher",
          pending.payload,
          { expectedUid: ownerUid },
        );
        break;
      case "updateStudentHistoryDictionaryWordByTeacher":
        response = await executeWestoryCommand<DictionaryCommand>(
          "updateStudentHistoryDictionaryWordByTeacher",
          pending.payload,
          { expectedUid: ownerUid },
        );
        break;
      case "saveHistoryDictionaryTerm":
        response = await executeWestoryCommand<DictionaryCommand>(
          "saveHistoryDictionaryTerm",
          pending.payload,
          { expectedUid: ownerUid },
        );
        break;
      case "approveHistoryDictionaryTermForRequests":
        response = await executeWestoryCommand<DictionaryCommand>(
          "approveHistoryDictionaryTermForRequests",
          pending.payload,
          { expectedUid: ownerUid },
        );
        break;
    }
    dictionaryPending.delete(ownerUid);
    return { commandType: pending.commandType, result: response.result };
  } catch (error) {
    if (
      !(error instanceof WestoryCommandError && error.retryable) &&
      !(await hasPendingWestoryCommand(pending.commandType, pending.payload, {
        expectedUid: ownerUid,
      }).catch(() => true))
    )
      dictionaryPending.delete(ownerUid);
    throw error;
  } finally {
    emitDictionaryPending();
  }
};
export const retryHistoryDictionaryMutation = (ownerUid: string) => {
  const flight = dictionaryFlights.get(ownerUid);
  if (flight) return flight;
  const next = sendDictionaryPending(ownerUid).finally(() => {
    dictionaryFlights.delete(ownerUid);
    emitDictionaryPending();
  });
  dictionaryFlights.set(ownerUid, next);
  emitDictionaryPending();
  return next;
};
const runDictionaryMutation = <C extends DictionaryCommand>(
  commandType: C,
  prepare: () => Promise<W2CommandPayloads[C]> | W2CommandPayloads[C],
  ownerUid: string,
): Promise<W2CommandResults[C]> => {
  assertHistoryDictionaryEditorOwner(ownerUid);
  if (dictionaryPending.has(ownerUid) || dictionaryFlights.has(ownerUid))
    return Promise.reject(new Error("이전 요청 결과를 먼저 확인해 주세요."));
  const flight = Promise.resolve()
    .then(prepare)
    .then(async (payload) => {
      assertHistoryDictionaryEditorOwner(ownerUid);
      dictionaryPending.set(ownerUid, {
        commandType,
        payload: JSON.parse(JSON.stringify(payload)),
      });
      emitDictionaryPending();
      return (await sendDictionaryPending(ownerUid))
        .result as W2CommandResults[C];
    })
    .finally(() => {
      dictionaryFlights.delete(ownerUid);
      emitDictionaryPending();
    });
  dictionaryFlights.set(ownerUid, flight);
  emitDictionaryPending();
  return flight;
};

const dictionaryHash = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
const dictionaryTermId = async (word: string) =>
  `term_${await dictionaryHash(normalizeHistoryDictionaryWord(word))}`;
const readRequestVersion = async (uid: string, requestId: string) => {
  if (!requestId) return null;
  // The uid constraint proves ownership even when the queried document is absent.
  const snapshot = await getDocs(
    query(
      collection(db, REQUESTS_COLLECTION),
      where("uid", "==", uid),
      where(documentId(), "==", requestId),
      limit(1),
    ),
  );
  return snapshot.empty
    ? null
    : getHistoryDictionaryWriteVersion(snapshot.docs[0].data());
};

export const normalizeHistoryDictionaryWord = (value: string) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const mapDoc = <T extends { id: string }>(docSnap: {
  id: string;
  data: () => Record<string, unknown>;
}) =>
  ({
    id: docSnap.id,
    ...docSnap.data(),
    writeVersion: getHistoryDictionaryWriteVersion(docSnap.data()),
  }) as unknown as T;

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

const mapStudentWordRequestDoc = (docSnap: {
  id: string;
  ref: { parent: { parent: { id: string } | null } };
  data: () => Record<string, unknown>;
}): HistoryDictionaryRequest => {
  const data = docSnap.data();
  const uid = String(data.uid || docSnap.ref.parent.parent?.id || "");
  const normalizedWord = normalizeHistoryDictionaryWord(
    String(data.normalizedWord || data.word || ""),
  );
  return {
    id: String(data.requestId || docSnap.id),
    word: String(data.word || ""),
    normalizedWord,
    uid,
    studentName: String(data.studentName || data.name || "학생"),
    grade: String(data.grade || ""),
    class: String(data.class || ""),
    number: String(data.number || ""),
    memo: String(data.memo || ""),
    status: "requested",
    matchedTermId: String(data.termId || ""),
    resolvedTermId: "",
    resolvedBy: "",
    createdAt: data.createdAt || data.updatedAt || null,
    updatedAt: data.updatedAt || data.createdAt || null,
    resolvedAt: null,
    wordWriteVersion: getHistoryDictionaryWriteVersion(data) || "legacy",
  };
};

const mapTeacherStudentWordDoc = (docSnap: {
  id: string;
  ref: { parent: { parent: { id: string } | null } };
  data: () => Record<string, unknown>;
}): StudentHistoryDictionaryWord => {
  const data = docSnap.data();
  const uid = String(data.uid || docSnap.ref.parent.parent?.id || "");
  return {
    id: `${uid}:${docSnap.id}`,
    uid,
    termId: String(data.termId || docSnap.id),
    word: String(data.word || ""),
    normalizedWord: normalizeHistoryDictionaryWord(
      String(data.normalizedWord || data.word || ""),
    ),
    definition: String(data.definition || ""),
    studentLevel: String(data.studentLevel || ""),
    tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
    status: data.status === "requested" ? "requested" : "saved",
    requestId: String(data.requestId || ""),
    studentName: String(data.studentName || data.name || "학생"),
    grade: String(data.grade || ""),
    class: String(data.class || ""),
    number: String(data.number || ""),
    definitionSource: String(data.definitionSource || ""),
    memo: String(data.memo || ""),
    year: String(data.year || ""),
    semester: String(data.semester || ""),
    reviewedBy: String(data.reviewedBy || ""),
    reviewedAt: data.reviewedAt || null,
    rewardTermId: String(data.rewardTermId || ""),
    rewardTransactionId: String(data.rewardTransactionId || ""),
    rewardAmount: Number(data.rewardAmount || 0),
    rewardAwardedAt: data.rewardAwardedAt || null,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    writeVersion: getHistoryDictionaryWriteVersion(data) || "legacy",
  };
};

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
  writeVersion: String(data.writeVersion || ""),
});

const mergeHistoryDictionaryRequests = (
  rootRequests: HistoryDictionaryRequest[],
  studentWordRequests: HistoryDictionaryRequest[],
) => {
  const byKey = new Map<string, HistoryDictionaryRequest>();

  rootRequests.forEach((request) => {
    const key = request.id || `${request.uid}:${request.normalizedWord}`;
    byKey.set(key, request);
  });

  studentWordRequests.forEach((request) => {
    const key = request.id || `${request.uid}:${request.normalizedWord}`;
    if (!byKey.has(key)) {
      byKey.set(key, request);
    }
  });

  return Array.from(byKey.values()).sort(
    (a, b) =>
      getTimestampMs(b.updatedAt || b.createdAt) -
      getTimestampMs(a.updatedAt || a.createdAt),
  );
};

export const loadPublishedHistoryDictionaryTerm = async (word: string) => {
  const normalizedWord = normalizeHistoryDictionaryWord(word);
  if (!normalizedWord) return null;

  const snapshot = await getDocs(
    query(
      collection(db, TERMS_COLLECTION),
      where("normalizedWord", "==", normalizedWord),
      limit(1),
    ),
  );
  const term = snapshot.empty
    ? null
    : mapDoc<HistoryDictionaryTerm>(snapshot.docs[0]);
  return term?.status === "published" ? term : null;
};

export const subscribeStudentHistoryDictionaryWords = (
  uid: string,
  onChange: (words: StudentHistoryDictionaryWord[]) => void,
): Unsubscribe =>
  onSnapshot(
    query(
      collection(db, `users/${uid}/history_dictionary_words`),
      orderBy("updatedAt", "desc"),
      limit(20),
    ),
    (snapshot) => {
      onChange(
        snapshot.docs.map((item) => mapDoc<StudentHistoryDictionaryWord>(item)),
      );
    },
    (error) => {
      console.error(
        "Failed to subscribe student history dictionary words:",
        error,
      );
      onChange([]);
    },
  );

export const loadStudentHistoryDictionaryWord = async (
  uid: string,
  termId: string,
) => {
  assertHistoryDictionaryEditorOwner(uid);
  const snapshot = await getDoc(
    doc(db, `users/${uid}/history_dictionary_words/${termId}`),
  );
  assertHistoryDictionaryEditorOwner(uid);
  return snapshot.exists()
    ? mapDoc<StudentHistoryDictionaryWord>(snapshot)
    : null;
};

export const subscribeTeacherHistoryDictionaryRequests = (
  onChange: (requests: HistoryDictionaryRequest[]) => void,
): Unsubscribe => {
  let rootRequests: HistoryDictionaryRequest[] = [];
  let studentWordRequests: HistoryDictionaryRequest[] = [];

  const emit = () => {
    onChange(mergeHistoryDictionaryRequests(rootRequests, studentWordRequests));
  };

  const unsubscribeRootRequests = onSnapshot(
    query(
      collection(db, REQUESTS_COLLECTION),
      orderBy("updatedAt", "desc"),
      limit(100),
    ),
    (snapshot) => {
      rootRequests = snapshot.docs.map((item) =>
        mapDoc<HistoryDictionaryRequest>(item),
      );
      emit();
    },
    (error) => {
      console.error("Failed to subscribe history dictionary requests:", error);
      rootRequests = [];
      emit();
    },
  );

  const unsubscribeStudentWordRequests = onSnapshot(
    query(
      collectionGroup(db, "history_dictionary_words"),
      where("status", "==", "requested"),
      limit(100),
    ),
    (snapshot) => {
      studentWordRequests = snapshot.docs.map((item) =>
        mapStudentWordRequestDoc(item),
      );
      emit();
    },
    (error) => {
      console.error(
        "Failed to subscribe student history dictionary word requests:",
        error,
      );
      studentWordRequests = [];
      emit();
    },
  );

  return () => {
    unsubscribeRootRequests();
    unsubscribeStudentWordRequests();
  };
};

export const subscribeTeacherStudentHistoryDictionaryWords = (
  onChange: (words: StudentHistoryDictionaryWord[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe =>
  onSnapshot(
    query(
      collectionGroup(db, "history_dictionary_words"),
      where("status", "==", "saved"),
      limit(500),
    ),
    (snapshot) => {
      onChange(
        snapshot.docs
          .map((item) => mapTeacherStudentWordDoc(item))
          .filter((item) =>
            ["student", "teacher_reviewed"].includes(
              item.definitionSource || "",
            ),
          )
          .sort(
            (a, b) =>
              getTimestampMs(b.updatedAt || b.createdAt) -
              getTimestampMs(a.updatedAt || a.createdAt),
          ),
      );
    },
    (error) => {
      console.error(
        "Failed to subscribe student history dictionary words:",
        error,
      );
      onError?.(error);
      onChange([]);
    },
  );

export const loadTeacherStudentHistoryDictionaryWords = async (
  config?: ConfigLike,
) => {
  const { year, semester } = getYearSemester(config);
  const callable = await getHttpsCallable(
    "listStudentHistoryDictionaryWordsForTeacher",
  );
  const result = await callable({ year, semester });
  const data = result.data as { words?: Record<string, unknown>[] };
  return Array.isArray(data.words)
    ? data.words.map(mapTeacherStudentWordData)
    : [];
};

export const subscribeTeacherHistoryDictionaryTerms = (
  onChange: (terms: HistoryDictionaryTerm[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe =>
  onSnapshot(
    query(
      collection(db, TERMS_COLLECTION),
      orderBy("updatedAt", "desc"),
      limit(TEACHER_TERMS_LIMIT),
    ),
    (snapshot) => {
      onChange(
        snapshot.docs.map((item) => mapDoc<HistoryDictionaryTerm>(item)),
      );
    },
    (error) => {
      console.error("Failed to subscribe history dictionary terms:", error);
      onError?.(error);
      onChange([]);
    },
  );

export const loadTeacherHistoryDictionaryTerms = async () => {
  const snapshot = await getDocs(
    query(
      collection(db, TERMS_COLLECTION),
      orderBy("updatedAt", "desc"),
      limit(TEACHER_TERMS_LIMIT),
    ),
  );
  return snapshot.docs.map((item) => mapDoc<HistoryDictionaryTerm>(item));
};

export const requestHistoryDictionaryTerm = async (
  config: ConfigLike,
  input: {
    word: string;
    memo: string;
    warningAccepted: boolean;
    expectedWordVersion: HistoryDictionaryWriteVersion;
    expectedRequestVersion?: HistoryDictionaryWriteVersion;
  },
  expectedUid = auth.currentUser?.uid || "",
) => {
  const { year, semester } = getYearSemester(config);
  return runDictionaryMutation(
    "requestHistoryDictionaryTerm",
    async () => ({
      year,
      semester,
      word: input.word,
      memo: input.memo.replace(/\s+/g, " ").trim().slice(0, 240),
      warningAccepted: input.warningAccepted,
      expectedWordVersion: input.expectedWordVersion,
      expectedRequestVersion:
        input.expectedRequestVersion !== undefined
          ? input.expectedRequestVersion
          : await readRequestVersion(
              expectedUid,
              `req_${await dictionaryHash(`${year}:${semester}:${expectedUid}:${normalizeHistoryDictionaryWord(input.word)}`)}`,
            ),
    }),
    expectedUid,
  );
};

export const saveStudentHistoryDictionaryWord = async (
  config: ConfigLike,
  input: {
    termId: string;
    expectedWordVersion: HistoryDictionaryWriteVersion;
    expectedTermVersion: HistoryDictionaryWriteVersion;
  },
  expectedUid = auth.currentUser?.uid || "",
) => {
  const { year, semester } = getYearSemester(config);
  return runDictionaryMutation(
    "saveStudentHistoryDictionaryWord",
    () => ({ year, semester, ...input }),
    expectedUid,
  );
};

export const saveStudentHistoryDictionaryEntry = async (
  input: {
    config?: ConfigLike;
    word: string;
    definition: string;
    expectedWordVersion: HistoryDictionaryWriteVersion;
  },
  expectedUid = auth.currentUser?.uid || "",
) => {
  const { year, semester } = getYearSemester(input.config);
  return runDictionaryMutation(
    "saveStudentHistoryDictionaryEntry",
    () => ({
      year,
      semester,
      word: input.word,
      definition: input.definition,
      expectedWordVersion: input.expectedWordVersion,
    }),
    expectedUid,
  );
};

export const deleteStudentHistoryDictionaryWord = async (
  config: ConfigLike,
  termId: string,
  expectedWordVersion: HistoryDictionaryWriteVersion,
  expectedUid = auth.currentUser?.uid || "",
) => {
  const { year, semester } = getYearSemester(config);
  return runDictionaryMutation(
    "deleteStudentHistoryDictionaryWord",
    () => ({
      year,
      semester,
      termId,
      expectedWordVersion,
    }),
    expectedUid,
  );
};

const assertHistoryDictionaryEditorOwner = (expectedUid: string) => {
  if (!expectedUid || auth.currentUser?.uid !== expectedUid)
    throw new Error("로그인 사용자가 바뀌었습니다. 화면을 다시 열어 주세요.");
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
    expectedWordVersion?: HistoryDictionaryWriteVersion;
    expectedRequestVersion?: HistoryDictionaryWriteVersion;
  },
  expectedUid = auth.currentUser?.uid || "",
) => {
  assertHistoryDictionaryEditorOwner(expectedUid);
  const { year, semester } = getYearSemester(config);
  return runDictionaryMutation(
    "deleteStudentHistoryDictionaryWordByTeacher",
    async () => {
      const termId =
        input.termId ||
        (await dictionaryTermId(input.normalizedWord || input.word || ""));
      const wordSnapshot =
        input.expectedWordVersion === undefined
          ? await getDoc(
              doc(db, `users/${input.uid}/history_dictionary_words/${termId}`),
            )
          : null;
      return {
        year: input.year || year,
        semester: input.semester || semester,
        uid: input.uid,
        termId,
        requestId: input.requestId || "",
        word: input.word || "",
        normalizedWord: input.normalizedWord || "",
        reason: input.reason || "",
        expectedWordVersion:
          input.expectedWordVersion !== undefined
            ? input.expectedWordVersion
            : getHistoryDictionaryWriteVersion(
                wordSnapshot?.exists() ? wordSnapshot.data() : null,
              ),
        expectedRequestVersion:
          input.expectedRequestVersion !== undefined
            ? input.expectedRequestVersion
            : await readRequestVersion(input.uid, input.requestId || ""),
      };
    },
    expectedUid,
  );
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
    expectedWordVersion: HistoryDictionaryWriteVersion;
  },
  expectedUid = auth.currentUser?.uid || "",
) => {
  assertHistoryDictionaryEditorOwner(expectedUid);
  const { year, semester } = getYearSemester(config);
  const payload = {
    year: input.year || year,
    semester: input.semester || semester,
    uid: input.uid,
    termId: input.termId,
    word: input.word,
    definition: input.definition,
    expectedWordVersion: input.expectedWordVersion,
  };
  return runDictionaryMutation(
    "updateStudentHistoryDictionaryWordByTeacher",
    () => payload,
    expectedUid,
  );
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
    expectedTermVersion: HistoryDictionaryWriteVersion;
    expectedRequestVersion?: HistoryDictionaryWriteVersion;
  },
  expectedUid = auth.currentUser?.uid || "",
) => {
  assertHistoryDictionaryEditorOwner(expectedUid);
  const { year, semester } = getYearSemester(config);
  return runDictionaryMutation(
    "saveHistoryDictionaryTerm",
    async () => ({
      year,
      semester,
      word: input.word,
      definition: input.definition,
      studentLevel: input.studentLevel,
      relatedUnitId: input.relatedUnitId || "",
      tags: [...(input.tags || [])],
      fallbackRequestId: input.fallbackRequestId || "",
      fallbackUid: input.fallbackUid || "",
      expectedTermVersion: input.expectedTermVersion,
      expectedRequestVersion:
        input.expectedRequestVersion !== undefined
          ? input.expectedRequestVersion
          : await readRequestVersion(
              input.fallbackUid || "",
              input.fallbackRequestId || "",
            ),
    }),
    expectedUid,
  );
};

type HistoryDictionaryImportInput = {
  terms: Array<{
    word: string;
    definition: string;
    studentLevel: string;
    relatedUnitId?: string;
    tags?: string[];
  }>;
};

const buildHistoryDictionaryImportPayload = (
  config: ConfigLike,
  input: HistoryDictionaryImportInput,
  expectedUid: string,
) => {
  if (!expectedUid || auth.currentUser?.uid !== expectedUid)
    throw new Error("로그인 사용자가 바뀌었습니다. 화면을 다시 열어 주세요.");
  const { year, semester } = getYearSemester(config);
  const payload = {
    year,
    semester,
    terms: input.terms.map((term) => ({
      word: term.word,
      definition: term.definition,
      studentLevel: term.studentLevel,
      relatedUnitId: term.relatedUnitId || "",
      tags: [...(term.tags || [])],
    })),
  };
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 750_000)
    throw new Error(
      "일괄 등록 데이터가 너무 큽니다. 행 수나 풀이 길이를 줄여 다시 확인해 주세요.",
    );
  return payload;
};

export const hasPendingHistoryDictionaryImport = async (
  config: ConfigLike,
  input: HistoryDictionaryImportInput,
  expectedUid = auth.currentUser?.uid || "",
) =>
  hasPendingWestoryCommand(
    "saveHistoryDictionaryTermsBulk",
    buildHistoryDictionaryImportPayload(config, input, expectedUid),
    { expectedUid },
  );

export const saveHistoryDictionaryTermsBulk = async (
  config: ConfigLike,
  input: HistoryDictionaryImportInput,
  expectedUid = auth.currentUser?.uid || "",
) => {
  const payload = buildHistoryDictionaryImportPayload(
    config,
    input,
    expectedUid,
  );
  const response = await executeWestoryCommand(
    "saveHistoryDictionaryTermsBulk",
    payload,
    { expectedUid },
  );
  return response.result;
};

export const isHistoryDictionaryImportUncertain = (error: unknown) =>
  error instanceof WestoryCommandError && error.retryable;

export const isHistoryDictionaryImportConflict = (error: unknown) =>
  error instanceof WestoryCommandError &&
  error.outcomeConfirmed &&
  error.reason === "HISTORY_DICTIONARY_BULK_CONFLICT";

export const approveHistoryDictionaryTermForRequests = async (
  config: ConfigLike,
  input: {
    termId: string;
    requestId?: string;
    expectedTermVersion: HistoryDictionaryWriteVersion;
    expectedRequestVersion?: HistoryDictionaryWriteVersion;
    requestUid?: string;
  },
  expectedUid = auth.currentUser?.uid || "",
) => {
  assertHistoryDictionaryEditorOwner(expectedUid);
  const { year, semester } = getYearSemester(config);
  return runDictionaryMutation(
    "approveHistoryDictionaryTermForRequests",
    async () => ({
      year,
      semester,
      termId: input.termId,
      requestId: input.requestId || "",
      expectedTermVersion: input.expectedTermVersion,
      expectedRequestVersion:
        input.expectedRequestVersion !== undefined
          ? input.expectedRequestVersion
          : await readRequestVersion(
              input.requestUid || "",
              input.requestId || "",
            ),
    }),
    expectedUid,
  );
};
