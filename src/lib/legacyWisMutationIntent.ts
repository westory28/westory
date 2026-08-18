type JsonObject = object;

export type LegacyWisMutationIntent<Payload extends JsonObject> = {
  commandId: string;
  payload: Payload;
};

type StoredLegacyWisMutationIntent<Payload extends JsonObject> =
  LegacyWisMutationIntent<Payload> & {
    schemaVersion: 1;
    intentKey: string;
    createdAt: number;
  };

type IntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STORAGE_PREFIX = "westory:w10p:wis-intent:";
const COMMAND_ID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9A-HJKMNP-TV-Z]{26})$/i;

const memoryIntents = new Map<
  string,
  StoredLegacyWisMutationIntent<JsonObject>
>();

const storageKey = (intentKey: string) =>
  `${STORAGE_PREFIX}${encodeURIComponent(intentKey)}`;

const browserStorage = (): IntentStorage | null => {
  try {
    return typeof globalThis.sessionStorage === "undefined"
      ? null
      : globalThis.sessionStorage;
  } catch {
    return null;
  }
};

const fallbackUuid = () => {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
};

export const createLegacyWisCommandId = () =>
  typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : fallbackUuid();

const canonicalizeActionValue = (value: unknown): unknown => {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(canonicalizeActionValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeActionValue(entry)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return String(value);
  }
  if (["bigint", "function", "symbol", "undefined"].includes(typeof value)) {
    return String(value);
  }
  return value;
};

const hashActionText = (value: string, seed: number) => {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0).toString(16).padStart(8, "0");
};

/**
 * Creates a privacy-preserving, reload-stable key for one logical UI action.
 * The server command id remains a random UUID; this key only finds the
 * original command payload when a response was lost and the page reloaded.
 */
export const createStableLegacyMutationActionKey = (
  namespace: string,
  action: unknown,
) => {
  const normalizedNamespace = String(namespace || "").trim();
  if (!normalizedNamespace) throw new TypeError("namespace is required.");
  const serialized = JSON.stringify(canonicalizeActionValue(action));
  const digest = [0x811c9dc5, 0x9e3779b9, 0x7f4a7c15, 0x94d049bb]
    .map((seed) => hashActionText(serialized, seed))
    .join("");
  return `${normalizedNamespace}:v1:${serialized.length.toString(36)}:${digest}`;
};

const isStoredIntent = <Payload extends JsonObject>(
  value: unknown,
  intentKey: string,
): value is StoredLegacyWisMutationIntent<Payload> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<StoredLegacyWisMutationIntent<Payload>>;
  return (
    candidate.schemaVersion === 1 &&
    candidate.intentKey === intentKey &&
    typeof candidate.commandId === "string" &&
    COMMAND_ID_PATTERN.test(candidate.commandId) &&
    Boolean(candidate.payload) &&
    typeof candidate.payload === "object" &&
    !Array.isArray(candidate.payload)
  );
};

const readStoredIntent = <Payload extends JsonObject>(
  intentKey: string,
  storage: IntentStorage | null,
) => {
  const memory = memoryIntents.get(intentKey);
  if (isStoredIntent<Payload>(memory, intentKey)) return memory;
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(intentKey));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!isStoredIntent<Payload>(parsed, intentKey)) {
      if (raw) storage.removeItem(storageKey(intentKey));
      return null;
    }
    memoryIntents.set(intentKey, parsed);
    return parsed;
  } catch {
    return null;
  }
};

export const getLegacyWisMutationIntent = <Payload extends JsonObject>(
  intentKey: string,
  storage: IntentStorage | null = browserStorage(),
): LegacyWisMutationIntent<Payload> | null => {
  const normalizedKey = String(intentKey || "").trim();
  if (!normalizedKey) return null;
  const existing = readStoredIntent<Payload>(normalizedKey, storage);
  return existing
    ? { commandId: existing.commandId, payload: existing.payload }
    : null;
};

export const getOrCreateLegacyWisMutationIntent = <Payload extends JsonObject>(
  intentKey: string,
  createPayload: (commandId: string) => Payload,
  options: {
    storage?: IntentStorage | null;
    createCommandId?: () => string;
    now?: () => number;
  } = {},
): LegacyWisMutationIntent<Payload> => {
  const normalizedKey = String(intentKey || "").trim();
  if (!normalizedKey) throw new TypeError("intentKey is required.");
  const storage =
    options.storage === undefined ? browserStorage() : options.storage;
  const existing = readStoredIntent<Payload>(normalizedKey, storage);
  if (existing) {
    return { commandId: existing.commandId, payload: existing.payload };
  }

  const commandId = (options.createCommandId || createLegacyWisCommandId)();
  if (!COMMAND_ID_PATTERN.test(commandId)) {
    throw new TypeError("createCommandId must return a UUID v4 or ULID.");
  }
  const created: StoredLegacyWisMutationIntent<Payload> = {
    schemaVersion: 1,
    intentKey: normalizedKey,
    commandId,
    payload: createPayload(commandId),
    createdAt: (options.now || Date.now)(),
  };
  memoryIntents.set(normalizedKey, created);
  if (storage) {
    try {
      storage.setItem(storageKey(normalizedKey), JSON.stringify(created));
    } catch {
      // The in-memory intent still protects retries in the current page.
    }
  }
  return { commandId: created.commandId, payload: created.payload };
};

export const forgetLegacyWisMutationIntent = (
  intentKey: string,
  storage: IntentStorage | null = browserStorage(),
) => {
  const normalizedKey = String(intentKey || "").trim();
  if (!normalizedKey) return;
  memoryIntents.delete(normalizedKey);
  if (!storage) return;
  try {
    storage.removeItem(storageKey(normalizedKey));
  } catch {
    // Storage cleanup is best-effort; command idempotency remains server-side.
  }
};

export const shouldForgetLegacyWisIntentAfterError = (error: unknown) => {
  const kind =
    error && typeof error === "object" && "kind" in error
      ? String((error as { kind?: unknown }).kind || "")
      : "";
  return ["PERMISSION", "SESSION_EXPIRED", "CONFLICT", "VALIDATION"].includes(
    kind,
  );
};
