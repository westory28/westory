import {
  collection,
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
  String(value || "").trim().replace(/\s+/g, " ").toLowerCase();

const mapDoc = <T extends { id: string }>(docSnap: {
  id: string;
  data: () => Record<string, unknown>;
}) => ({ id: docSnap.id, ...docSnap.data() }) as T;

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
      onChange(snapshot.docs.map((item) => mapDoc<StudentHistoryDictionaryWord>(item)));
    },
  );

export const subscribeTeacherHistoryDictionaryRequests = (
  onChange: (requests: HistoryDictionaryRequest[]) => void,
): Unsubscribe =>
  onSnapshot(
    query(collection(db, REQUESTS_COLLECTION), orderBy("updatedAt", "desc"), limit(100)),
    (snapshot) => {
      onChange(snapshot.docs.map((item) => mapDoc<HistoryDictionaryRequest>(item)));
    },
  );

export const subscribeTeacherHistoryDictionaryTerms = (
  onChange: (terms: HistoryDictionaryTerm[]) => void,
): Unsubscribe =>
  onSnapshot(
    query(collection(db, TERMS_COLLECTION), orderBy("updatedAt", "desc"), limit(100)),
    (snapshot) => {
      onChange(snapshot.docs.map((item) => mapDoc<HistoryDictionaryTerm>(item)));
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
  word: string;
  definition: string;
}) => {
  const callable = httpsCallable(functions, "saveStudentHistoryDictionaryEntry");
  await callable({
    word: input.word,
    definition: input.definition,
  });
};

export const saveHistoryDictionaryTerm = async (
  config: ConfigLike,
  input: {
    word: string;
    definition: string;
    studentLevel: string;
    relatedUnitId?: string;
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
  const callable = httpsCallable(functions, "approveHistoryDictionaryTermForRequests");
  await callable({
    year,
    semester,
    termId: input.termId,
    requestId: input.requestId || "",
  });
};
