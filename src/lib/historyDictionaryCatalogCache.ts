import type { HistoryDictionaryCatalogTerm } from "./historyDictionaryCatalog";

type Row = Record<string, unknown>;
interface Snapshot {
  version: string;
  items: Row[];
}
export interface HistoryDictionaryCatalogResponse {
  items?: Row[];
  nextCursor?: string;
  version?: string;
  notModified?: boolean;
}
const DATABASE = "westory-history-dictionary";
const STORE = "catalog";
let memory: Snapshot | undefined;

// Only the shared reference dictionary is persisted. Student notebooks, account
// data and session proofs must never enter this database. Cached content is not
// displayed until the callable has authorized this visit and checked its version.
const storage = <T>(write?: Snapshot): Promise<T | undefined> =>
  new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(undefined);
    let database: IDBDatabase | undefined;
    let settled = false;
    const finish = (value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      database?.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(), 1000);
    try {
      const open = indexedDB.open(DATABASE, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onerror = open.onblocked = () => finish();
      open.onsuccess = () => {
        database = open.result;
        if (settled) return database.close();
        try {
          const transaction = database.transaction(
            STORE,
            write ? "readwrite" : "readonly",
          );
          const request = write
            ? transaction.objectStore(STORE).put(write, "current")
            : transaction.objectStore(STORE).get("current");
          transaction.oncomplete = () => finish(request.result as T);
          transaction.onerror = transaction.onabort = () => finish();
        } catch {
          finish();
        }
      };
    } catch {
      finish();
    }
  });

const validItems = (items: unknown): items is Row[] =>
  Array.isArray(items) &&
  items.length > 0 &&
  items.length <= 20_000 &&
  new Set(items.map((item) => item?.id)).size === items.length &&
  items.every(
    (item) =>
      item &&
      typeof item.id === "string" &&
      typeof item.word === "string" &&
      typeof item.definition === "string" &&
      Array.isArray(item.attributions) &&
      ["history", "place"].includes(item.kind),
  );

const matchesVersion = async (snapshot: Snapshot) => {
  if (!/^[a-f0-9]{64}$/.test(snapshot.version) || !validItems(snapshot.items))
    return false;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(snapshot.items)),
  );
  return (
    Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("") === snapshot.version
  );
};

export async function loadHistoryDictionaryCatalogSnapshot(
  request: (
    input: Record<string, unknown>,
  ) => Promise<HistoryDictionaryCatalogResponse>,
  assertCurrent: () => Promise<void>,
): Promise<HistoryDictionaryCatalogTerm[]> {
  const saved = memory || (await storage<Snapshot>());
  let cached: Snapshot | undefined;
  try {
    if (saved && (await matchesVersion(saved))) cached = saved;
  } catch {
    // IndexedDB supports values that JSON does not (including cycles). A damaged
    // local copy must be replaced from the server rather than trapping retries.
  }
  const items: Row[] = [];
  const cursors = new Set<string>();
  let after = "";
  let version: string | undefined;
  do {
    await assertCurrent();
    const data = await request({
      catalogMode: "batch",
      ...(after ? { after } : {}),
      ...(!after && cached ? { catalogVersion: cached.version } : {}),
    });
    await assertCurrent();
    if (!Array.isArray(data?.items))
      throw new Error("사전 자료를 확인하지 못했습니다. 다시 불러와 주세요.");
    if (data.notModified) {
      if (
        !cached ||
        after ||
        data.items.length ||
        data.nextCursor ||
        data.version !== cached.version
      )
        throw new Error("사전 자료의 버전을 확인하지 못했습니다.");
      items.push(...cached.items);
      version = cached.version;
    } else {
      if (after && version !== data.version)
        throw new Error("사전 자료가 변경되었습니다. 다시 불러와 주세요.");
      items.push(...data.items);
      if (!after) version = data.version;
    }
    after = typeof data.nextCursor === "string" ? data.nextCursor : "";
    if (items.length > 20_000 || (after && cursors.has(after)))
      throw new Error("사전 목록 조회가 중단되었습니다. 다시 불러와 주세요.");
    if (after) cursors.add(after);
  } while (after);
  if (!validItems(items))
    throw new Error(
      "사전 자료의 형식을 확인하지 못했습니다. 다시 불러와 주세요.",
    );
  if (version) {
    const snapshot = { version, items };
    if (!(await matchesVersion(snapshot)))
      throw new Error("사전 자료의 버전을 확인하지 못했습니다.");
    await assertCurrent();
    memory = snapshot;
    // A denied/quota-limited browser cache must not prevent reading the dictionary.
    if (version !== cached?.version) void storage(snapshot);
  }
  await assertCurrent();
  return items.map((item) => ({
    ...item,
    aliases: Array.isArray(item.aliases) ? item.aliases : [],
    tags: Array.isArray(item.tags) ? item.tags : [],
    facetIds: Array.isArray(item.facetIds) ? item.facetIds : [],
  })) as unknown as HistoryDictionaryCatalogTerm[];
}
