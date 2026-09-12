const READ_ONLY_QUERIES = new Set([
  "getAdminSemesterContent",
  "getWisEconomyState",
  "getArchiveEnrollmentState",
  "getStudentEnrollmentProfileState",
  "getAssessmentState",
  "getGradeEvidenceState",
  "getW8DomainState",
  "getTeacherOperationsState",
  "getAdminSemesterLegacyRecords",
  "getSemesterCoreState",
  "getSemesterCutoverState",
  "getCommandStatus",
  "getStudentRegistrationApprovalState",
  "previewEnrollmentRoster",
  "listStudentHistoryDictionaryWordsForTeacher",
]);
const REUSABLE_QUERIES = new Set([
  "getWisEconomyState",
  "getStudentEnrollmentProfileState",
  "getAdminSemesterLegacyRecords",
  "getW8DomainState",
  "getTeacherOperationsState",
]);
const FRESH_MS = 15_000;
const LIMIT = 60;
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
};

/** Volatile read results only. Never stores credentials or data on disk. */
export const createSessionQueryCache = (now = Date.now) => {
  let owner = "",
    generation = 0;
  const pending = new Map<string, Promise<unknown>>();
  const ready = new Map<string, { value: unknown; expires: number }>();
  const clear = () => {
    generation++;
    pending.clear();
    ready.clear();
  };
  const run = async <T>(
    name: string,
    data: unknown,
    uid: string,
    currentUid: () => string,
    fetch: () => Promise<T>,
  ): Promise<T> => {
    if (owner !== uid) {
      clear();
      owner = uid;
    }
    const assertOwner = () => {
      if (!uid || currentUid() !== uid) {
        clear();
        throw new Error(
          "로그인 사용자가 바뀌었습니다. 화면을 다시 열어 주세요.",
        );
      }
    };
    if (!READ_ONLY_QUERIES.has(name)) {
      clear();
      try {
        return await fetch();
      } finally {
        clear();
      }
    }
    if (!uid) return fetch();
    assertOwner();
    const request = data as Record<string, unknown> | undefined;
    const proof = request?._session;
    // CURRENT pointer-only reads are deduplicated but not cached across visits.
    // Explicit semester scope and a verified-session proof are both required.
    const reusable = Boolean(
      REUSABLE_QUERIES.has(name) &&
      proof &&
      typeof request?.semesterId === "string",
    );
    const key = `${uid}|${name}|${stable(data)}`;
    const hit = ready.get(key);
    if (hit && hit.expires > now()) return structuredClone(hit.value) as T;
    ready.delete(key);
    let flight = pending.get(key) as Promise<T> | undefined;
    if (!flight) {
      const startedGeneration = generation;
      flight = fetch()
        .then((value) => {
          assertOwner();
          if (reusable && generation === startedGeneration) {
            if (ready.size >= LIMIT) ready.delete(ready.keys().next().value!);
            ready.set(key, {
              value: structuredClone(value),
              expires: now() + FRESH_MS,
            });
          }
          return value;
        })
        .finally(() => {
          if (pending.get(key) === flight) pending.delete(key);
        });
      pending.set(key, flight);
    }
    const value = await flight;
    assertOwner();
    return structuredClone(value);
  };
  return { run, clear };
};

export const sessionQueryCache = createSessionQueryCache();
