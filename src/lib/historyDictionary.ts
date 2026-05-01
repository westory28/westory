import {
  collection,
  collectionGroup,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";
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

export const normalizeHistoryDictionaryWord = (value: string) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const mapDoc = <T extends { id: string }>(docSnap: {
  id: string;
  data: () => Record<string, unknown>;
}) => ({ id: docSnap.id, ...docSnap.data() }) as T;

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
  };
};

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
  );

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

export const subscribeTeacherHistoryDictionaryTerms = (
  onChange: (terms: HistoryDictionaryTerm[]) => void,
): Unsubscribe =>
  onSnapshot(
    query(
      collection(db, TERMS_COLLECTION),
      orderBy("updatedAt", "desc"),
      limit(100),
    ),
    (snapshot) => {
      onChange(
        snapshot.docs.map((item) => mapDoc<HistoryDictionaryTerm>(item)),
      );
    },
  );

export const requestHistoryDictionaryTerm = async (
  config: ConfigLike,
  input: {
    word: string;
    memo: string;
    warningAccepted: boolean;
  },
) => {
  const { year, semester } = getYearSemester(config);
  const callable = httpsCallable(functions, "requestHistoryDictionaryTerm");
  await callable({
    year,
    semester,
    word: input.word,
    memo: input.memo,
    warningAccepted: input.warningAccepted,
  });
};

export const saveStudentHistoryDictionaryWord = async (termId: string) => {
  const callable = httpsCallable(functions, "saveStudentHistoryDictionaryWord");
  await callable({ termId });
};

export const saveStudentHistoryDictionaryEntry = async (input: {
  config?: ConfigLike;
  word: string;
  definition: string;
}) => {
  const { year, semester } = getYearSemester(input.config);
  const callable = httpsCallable(
    functions,
    "saveStudentHistoryDictionaryEntry",
  );
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
  const callable = httpsCallable(
    functions,
    "deleteStudentHistoryDictionaryWord",
  );
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
  },
) => {
  const { year, semester } = getYearSemester(config);
  const callable = httpsCallable(
    functions,
    "deleteStudentHistoryDictionaryWordByTeacher",
  );
  const result = await callable({
    year,
    semester,
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
  const callable = httpsCallable(functions, "saveHistoryDictionaryTerm");
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

export const approveHistoryDictionaryTermForRequests = async (
  config: ConfigLike,
  input: {
    termId: string;
    requestId?: string;
  },
) => {
  const { year, semester } = getYearSemester(config);
  const callable = httpsCallable(
    functions,
    "approveHistoryDictionaryTermForRequests",
  );
  await callable({
    year,
    semester,
    termId: input.termId,
    requestId: input.requestId || "",
  });
};
