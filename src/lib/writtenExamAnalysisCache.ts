// Tab-local, short-lived teacher analysis snapshots. Never store auth tokens or
// session proofs. A fresh catalog authorizes entry before any snapshot is read.
const PREFIX = "westory:written-analysis:v1:";
const TTL = 10 * 60 * 1000;
const MAX_ENTRIES = 6;
type Entry = {
  scope: string;
  examId: string;
  key: string;
  expires: number;
  value: unknown;
};
const memory = new Map<string, Entry>();
let revision = 0;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
export const writtenExamAnalysisCacheRevision = () => revision;

const storage = () => {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
};
const remove = (key: string) => {
  memory.delete(key);
  try {
    storage()?.removeItem(PREFIX + key);
  } catch {
    // Restricted browser storage must not block analysis.
  }
};
const entries = () => {
  const all = new Map(memory);
  try {
    const store = storage();
    if (store)
      for (let index = 0; index < store.length; index++) {
        const name = store.key(index);
        if (!name?.startsWith(PREFIX)) continue;
        const key = name.slice(PREFIX.length);
        try {
          const entry = JSON.parse(store.getItem(name) || "null");
          if (
            entry?.key === key &&
            typeof entry.scope === "string" &&
            typeof entry.examId === "string" &&
            Number.isFinite(entry.expires)
          )
            all.set(key, entry);
          else
            all.set(key, {
              scope: "",
              examId: "",
              key,
              expires: 0,
              value: null,
            });
        } catch {
          all.set(key, { scope: "", examId: "", key, expires: 0, value: null });
        }
      }
  } catch {
    // Keep the bounded memory fallback when storage is unavailable.
  }
  return all;
};
const scheduleExpiry = () => {
  clearTimeout(expiryTimer);
  let next = Infinity;
  for (const [key, entry] of entries()) {
    if (entry.expires <= Date.now()) remove(key);
    else next = Math.min(next, entry.expires);
  }
  expiryTimer = Number.isFinite(next)
    ? setTimeout(scheduleExpiry, Math.max(1, next - Date.now()))
    : undefined;
};
export function invalidateWrittenExamAnalysisCache(examId?: string) {
  revision++;
  for (const [key, entry] of entries())
    if (!examId || entry.examId === examId) remove(key);
  scheduleExpiry();
}
export function readWrittenExamAnalysisCache<T>(
  scope: string,
  key: string,
): T | null {
  const all = entries();
  for (const [id, entry] of all)
    if (entry.scope !== scope || entry.expires <= Date.now()) {
      remove(id);
      all.delete(id);
    }
  scheduleExpiry();
  return (all.get(key)?.value as T) ?? null;
}
export function writeWrittenExamAnalysisCache<T>(
  scope: string,
  examId: string,
  key: string,
  value: T,
  expectedRevision: number,
) {
  if (expectedRevision !== revision) return;
  readWrittenExamAnalysisCache(scope, key);
  const entry = { scope, examId, key, expires: Date.now() + TTL, value };
  const serialized = JSON.stringify(entry);
  // Oversized results remain usable without consuming unbounded local storage.
  if (serialized.length > 3 * 1024 * 1024) return;
  const previous = [...entries().values()]
    .filter((item) => item.key !== key)
    .sort((a, b) => a.expires - b.expires);
  while (previous.length >= MAX_ENTRIES) remove(previous.shift()!.key);
  memory.set(key, entry);
  try {
    storage()?.setItem(PREFIX + key, serialized);
  } catch {
    // A quota failure must not leave a stale persistent copy behind.
    remove(key);
    for (const item of previous) remove(item.key);
    memory.set(key, entry);
    try {
      storage()?.setItem(PREFIX + key, serialized);
    } catch {
      // The same-tab memory snapshot still avoids repeated reads.
    }
  }
  scheduleExpiry();
}

// Reloads and returning from a throttled/background tab also erase expired data.
if (typeof window !== "undefined") {
  window.addEventListener?.("focus", scheduleExpiry);
  scheduleExpiry();
}
