import { getIdTokenResult } from "firebase/auth";
import {
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocs,
  limit,
  onSnapshot,
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
import type { HistoryDictionaryCatalogTerm } from "./historyDictionaryCatalog";
import type {
  HistoryDictionaryRequest,
  HistoryDictionaryTerm,
  HistoryDictionarySource,
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

const dictionaryTimestamp = (value: unknown): number => {
  const timestamp = value as {
    toMillis?: () => number;
    seconds?: number;
  } | null;
  return typeof timestamp?.toMillis === "function"
    ? timestamp.toMillis()
    : Number(timestamp?.seconds || 0) * 1000;
};
const newestDictionaryFirst = (
  left: { updatedAt?: unknown; createdAt?: unknown },
  right: { updatedAt?: unknown; createdAt?: unknown },
) =>
  dictionaryTimestamp(right.updatedAt || right.createdAt) -
  dictionaryTimestamp(left.updatedAt || left.createdAt);

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
  ...data,
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
  status: data.status === "requested" ? "requested" : "saved",
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

const sourceMetadata = (
  data: Record<string, unknown>,
  config: ConfigLike,
): HistoryDictionarySource => {
  const scope = getYearSemester(config);
  const sourcePath = String(data.sourcePath || "");
  const match =
    /^years\/(\d{4})\/semesters\/([12])\/(?:history_dictionary_terms\/[^/]+|dictionary_students\/[^/]+\/history_dictionary_words\/[^/]+)$/.exec(
      sourcePath,
    );
  const legacy =
    /^(?:history_dictionary_terms\/[^/]+|users\/[^/]+\/history_dictionary_words\/[^/]+)$/.test(
      sourcePath,
    );
  if (!match && !legacy)
    throw new Error(
      "사전 자료의 저장 위치를 확인하지 못했습니다. 다시 불러와 주세요.",
    );
  const sourceScope = match
    ? { year: match[1], semester: match[2] }
    : getYearSemester({
        year: String(data.sourceYear || ""),
        semester: String(data.sourceSemester || ""),
      });
  return {
    sourcePath,
    sourceYear: sourceScope.year,
    sourceSemester: sourceScope.semester,
    readOnly:
      legacy ||
      data.readOnly === true ||
      sourceScope.year !== scope.year ||
      sourceScope.semester !== scope.semester,
    writeVersion:
      typeof data.writeVersion === "string" ? data.writeVersion : undefined,
    createdAtMs: Number(data.createdAtMs || 0),
    updatedAtMs: Number(data.updatedAtMs || 0),
  };
};

export const mergeHistoryDictionaryContinuity = <
  T extends HistoryDictionarySource & {
    word: string;
    normalizedWord?: string;
    uid?: string;
    updatedAt?: unknown;
    createdAt?: unknown;
  },
>(
  items: T[],
  config: ConfigLike,
  studentWords = false,
): T[] => {
  const scope = getYearSemester(config);
  const rank = (item: T) =>
    !item.readOnly &&
    item.sourceYear === scope.year &&
    item.sourceSemester === scope.semester
      ? 1
      : 0;
  const sorted = [...items].sort(
    (a, b) =>
      rank(b) - rank(a) ||
      Number(b.sourceYear || 0) - Number(a.sourceYear || 0) ||
      Number(b.sourceSemester || 0) - Number(a.sourceSemester || 0) ||
      (b.updatedAtMs || dictionaryTimestamp(b.updatedAt || b.createdAt)) -
        (a.updatedAtMs || dictionaryTimestamp(a.updatedAt || a.createdAt)),
  );
  const unique = new Map<string, T>();
  for (const item of sorted) {
    const normalized = normalizeHistoryDictionaryWord(
      item.normalizedWord || item.word,
    );
    const key = studentWords ? `${item.uid || ""}:${normalized}` : normalized;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].sort(newestDictionaryFirst);
};

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
const loadContinuityItems = async (
  kind: "catalog" | "terms" | "words" | "studentWords",
  config: ConfigLike,
  isActive: () => boolean = () => true,
) => {
  const scope = getYearSemester(config);
  const user = auth.currentUser;
  if (!user) throw new Error("다시 로그인해 주세요.");
  const uid = user.uid;
  const authTime = (await getIdTokenResult(user)).authTime;
  const assertIdentity = async () => {
    const currentAuthTime = (await getIdTokenResult(user)).authTime;
    if (
      !isActive() ||
      auth.currentUser !== user ||
      auth.currentUser?.uid !== uid ||
      currentAuthTime !== authTime
    )
      throw new Error(
        "로그인 또는 학기 정보가 변경되었습니다. 다시 불러와 주세요.",
      );
  };
  await assertIdentity();
  const callable = await getHistoryDictionaryCallable(
    "getHistoryDictionaryContinuity",
  );
  const items: Record<string, unknown>[] = [];
  const cursors = new Set<string>();
  let after = "";
  do {
    await assertIdentity();
    const response = await callable({
      kind,
      ...scope,
      ...(after ? { after } : {}),
    });
    await assertIdentity();
    const data = response.data as {
      items?: Record<string, unknown>[];
      nextCursor?: string | null;
    };
    if (!Array.isArray(data?.items))
      throw new Error("사전 자료를 확인하지 못했습니다. 다시 불러와 주세요.");
    items.push(...data.items);
    after = typeof data.nextCursor === "string" ? data.nextCursor : "";
    if (after && cursors.has(after))
      throw new Error("사전 목록 조회가 중단되었습니다. 다시 불러와 주세요.");
    if (after) cursors.add(after);
  } while (after);
  await assertIdentity();
  const owner = `${uid}:${authTime}`;
  if (versionOwner && versionOwner !== owner) {
    versions.clear();
    pendingCommands.clear();
    conflictedIntents.clear();
  }
  versionOwner = owner;
  return items;
};

const rememberContinuitySource = (
  data: Record<string, unknown>,
  config: ConfigLike,
) => {
  const source = sourceMetadata(data, config);
  if (source.sourcePath && source.writeVersion)
    versions.set(source.sourcePath, source.writeVersion);
  return source;
};
const continuityTerms = async (
  config: ConfigLike,
  isActive?: () => boolean,
  previousOnly = false,
) => {
  const items = await loadContinuityItems("terms", config, isActive);
  const scope = getYearSemester(config);
  const terms = items.map(
    (item) =>
      ({
        ...item,
        ...rememberContinuitySource(item, config),
        normalizedWord: normalizeHistoryDictionaryWord(
          String(item.normalizedWord || item.word || ""),
        ),
        createdAt: timestampFromMs(item.createdAtMs),
        updatedAt: timestampFromMs(item.updatedAtMs),
      }) as unknown as HistoryDictionaryTerm,
  );
  return mergeHistoryDictionaryContinuity(
    previousOnly
      ? terms.filter(
          (item) =>
            item.readOnly ||
            item.sourceYear !== scope.year ||
            item.sourceSemester !== scope.semester,
        )
      : terms,
    config,
  );
};
const continuityWords = async (
  kind: "words" | "studentWords",
  config: ConfigLike,
  isActive?: () => boolean,
  previousOnly = false,
) => {
  const items = await loadContinuityItems(kind, config, isActive);
  const scope = getYearSemester(config);
  const words = items.map((item) => ({
    ...mapTeacherStudentWordData(item),
    ...rememberContinuitySource(item, config),
    id:
      kind === "studentWords"
        ? `${String(item.uid)}:${String(item.termId || item.id)}`
        : String(item.id || item.termId),
  }));
  return mergeHistoryDictionaryContinuity(
    previousOnly
      ? words.filter(
          (item) =>
            item.readOnly ||
            item.sourceYear !== scope.year ||
            item.sourceSemester !== scope.semester,
        )
      : words,
    config,
    true,
  );
};
export const loadHistoryDictionaryCatalog = async (
  config: ConfigLike,
): Promise<HistoryDictionaryCatalogTerm[]> => {
  const items = await loadContinuityItems("catalog", config);
  return items.map((item) => {
    if (
      typeof item.id !== "string" ||
      typeof item.word !== "string" ||
      typeof item.definition !== "string" ||
      !Array.isArray(item.attributions) ||
      !["history", "place"].includes(String(item.kind))
    )
      throw new Error(
        "사전 자료의 형식을 확인하지 못했습니다. 다시 불러와 주세요.",
      );
    return {
      ...item,
      aliases: Array.isArray(item.aliases) ? item.aliases : [],
      tags: Array.isArray(item.tags) ? item.tags : [],
      facetIds: Array.isArray(item.facetIds) ? item.facetIds : [],
    } as unknown as HistoryDictionaryCatalogTerm;
  });
};
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
  const owner = `${uid}:${authTime}`;
  if (versionOwner && versionOwner !== owner) {
    versions.clear();
    pendingCommands.clear();
    conflictedIntents.clear();
  }
  versionOwner = owner;
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
      const sourceScope =
        commandType === "saveStudentHistoryDictionaryWord" &&
        input.sourceYear &&
        input.sourceSemester
          ? getYearSemester({
              year: String(input.sourceYear),
              semester: String(input.sourceSemester),
            })
          : scope;
      payload.expectedTermVersion = await readVersion(
        scopedPath(sourceScope, `${TERMS_COLLECTION}/${termId}`),
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
  start: (fail: (error: Error) => void, isActive: () => boolean) => Unsubscribe,
  onError?: (error: Error) => void,
): Unsubscribe => {
  let cancelled = false;
  const user = auth.currentUser;
  const uid = user?.uid;
  const isActive = () =>
    !cancelled && auth.currentUser === user && auth.currentUser?.uid === uid;
  let unsubscribe: Unsubscribe | undefined;
  const fail = (error: unknown) => {
    if (!isActive()) return;
    const normalized =
      error instanceof Error ? error : new Error(String(error));
    console.error("Failed to load history dictionary:", normalized);
    onError?.(normalized);
  };
  void ensureHistoryDictionarySession()
    .then(() => {
      if (isActive()) unsubscribe = start(fail, isActive);
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
  const terms = await continuityTerms(config);
  return (
    terms.find(
      (term) =>
        term.normalizedWord === normalizedWord && term.status === "published",
    ) || null
  );
};

const subscribeContinuity = <
  T extends HistoryDictionaryTerm | StudentHistoryDictionaryWord,
>(
  kind: "terms" | "words",
  config: ConfigLike,
  path: string,
  onChange: (items: T[]) => void,
  onError?: (error: Error) => void,
  uid?: string,
): Unsubscribe =>
  subscribeAfterSession((fail, isActive) => {
    let live: T[] | null = null;
    let previous: T[] | null = null;
    let closed = false;
    const active = () => !closed && isActive();
    const emit = () => {
      if (active() && live !== null && previous !== null)
        onChange(
          mergeHistoryDictionaryContinuity(
            [...live, ...previous],
            config,
            kind === "words",
          ),
        );
    };
    const scope = getYearSemester(config);
    const unsubscribe = onSnapshot(
      query(collection(db, path)),
      (snapshot) => {
        if (!active()) return;
        live = snapshot.docs.map((item) => ({
          ...rememberDocument<T>(item),
          ...(uid ? { uid } : {}),
          sourcePath: item.ref.path,
          sourceYear: scope.year,
          sourceSemester: scope.semester,
          readOnly: false,
          writeVersion: versionFor(item.data()) || undefined,
        }));
        emit();
      },
      (error) => {
        if (active()) fail(error);
      },
    );
    const history =
      kind === "terms"
        ? continuityTerms(config, active, true)
        : continuityWords("words", config, active, true);
    void history
      .then((items) => {
        if (!active()) return;
        previous = items as T[];
        for (const item of live || [])
          if (item.sourcePath && item.writeVersion)
            versions.set(item.sourcePath, item.writeVersion);
        emit();
      })
      .catch((error) => {
        if (active()) fail(error);
      });
    return () => {
      closed = true;
      unsubscribe();
    };
  }, onError);

export const subscribeStudentHistoryDictionaryWords = (
  uid: string,
  onChange: (words: StudentHistoryDictionaryWord[]) => void,
  config: ConfigLike,
  onError?: (error: Error) => void,
): Unsubscribe =>
  subscribeContinuity(
    "words",
    config,
    scopedPath(config, `dictionary_students/${uid}/history_dictionary_words`),
    onChange,
    onError,
    uid,
  );

export const subscribeTeacherHistoryDictionaryRequests = (
  onChange: (requests: HistoryDictionaryRequest[]) => void,
  config: ConfigLike,
  onError?: (error: Error) => void,
): Unsubscribe =>
  subscribeAfterSession(
    (fail, isActive) =>
      onSnapshot(
        query(collection(db, scopedPath(config, REQUESTS_COLLECTION))),
        (snapshot) => {
          if (!isActive()) return;
          onChange(
            snapshot.docs
              .map((item) => rememberDocument<HistoryDictionaryRequest>(item))
              .sort(newestDictionaryFirst),
          );
        },
        fail,
      ),
    onError,
  );

export const loadTeacherStudentHistoryDictionaryWords = async (
  config: ConfigLike,
) => continuityWords("studentWords", config);

export const subscribeTeacherHistoryDictionaryTerms = (
  onChange: (terms: HistoryDictionaryTerm[]) => void,
  onError: ((error: Error) => void) | undefined,
  config: ConfigLike,
): Unsubscribe =>
  subscribeContinuity(
    "terms",
    config,
    scopedPath(config, TERMS_COLLECTION),
    onChange,
    onError,
  );

export const loadTeacherHistoryDictionaryTerms = async (config: ConfigLike) =>
  continuityTerms(config);
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

export const canSaveHistoryDictionaryTermToNotebook = (
  source: HistoryDictionarySource,
) =>
  /^years\/\d{4}\/semesters\/[12]\/history_dictionary_terms\/[^/]+$/.test(
    source.sourcePath || "",
  );

export const saveStudentHistoryDictionaryWord = async (
  termId: string,
  config: ConfigLike,
  source?: Pick<
    HistoryDictionarySource,
    "sourceYear" | "sourceSemester" | "sourcePath"
  >,
) => {
  if (source?.sourcePath && !canSaveHistoryDictionaryTermToNotebook(source))
    throw new Error(
      "이전 저장 방식의 풀이는 현재 단어장에 저장할 수 없습니다.",
    );
  const { year, semester } = getYearSemester(config);
  const callable = await command("saveStudentHistoryDictionaryWord");
  await callable({
    year,
    semester,
    termId,
    ...(source?.sourceYear && source?.sourceSemester
      ? { sourceYear: source.sourceYear, sourceSemester: source.sourceSemester }
      : {}),
  });
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
