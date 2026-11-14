export type AssetRecoveryResult =
  | "reloading"
  | "offline"
  | "save-failed"
  | "retry-limit"
  | "current-version"
  | "unavailable"
  | "unsupported";

export const normalizeAssetError = (error: unknown) =>
  String((error as { message?: string })?.message || error || "Unknown error");

export const isAssetLoadFailure = (error: unknown): boolean =>
  /Unable to preload CSS for|ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    normalizeAssetError(error),
  );

export type AssetRecoveryEnvironment = {
  online: () => boolean;
  currentEntry: () => string | null;
  latestEntry: () => Promise<string | null>;
  prepare?: () => Promise<void>;
  reserveReload: (target: string) => boolean;
  reload: () => void;
};

export type AssetRecoveryOptions = {
  /** A user retry may reload the current build; automatic recovery stays bounded. */
  manual?: boolean;
  retry?: boolean;
};

/** A preload event and its React boundary share one bounded recovery attempt. */
export function createAssetRecoveryController(env: AssetRecoveryEnvironment) {
  let attempt: Promise<AssetRecoveryResult> | undefined;
  let settled = false;
  return (
    error: unknown,
    options: AssetRecoveryOptions = {},
  ): Promise<AssetRecoveryResult> => {
    if (!isAssetLoadFailure(error)) return Promise.resolve("unsupported");
    if (attempt && (!options.retry || !settled)) return attempt;
    settled = false;
    attempt = (async (): Promise<AssetRecoveryResult> => {
      if (!env.online()) return "offline";
      const current = env.currentEntry();
      if (!current) return "unavailable";
      let latest: string | null;
      try {
        latest = await env.latestEntry();
      } catch {
        return env.online() ? "unavailable" : "offline";
      }
      if (!env.online()) return "offline";
      if (!latest) return "unavailable";
      if (latest === current && !options.manual) return "current-version";
      // Ordinary filters and saved input are not unsaved work. Only owning
      // features can provide a checkpoint, using their existing save contract.
      try {
        await env.prepare?.();
      } catch {
        return "save-failed";
      }
      if (!env.online()) return "offline";
      const reserved = env.reserveReload(latest);
      if (!reserved && !options.manual) return "retry-limit";
      try {
        env.reload();
        return "reloading";
      } catch {
        return "unavailable";
      }
    })().finally(() => {
      settled = true;
    });
    return attempt;
  };
}

const RECOVERY_KEY = "westory:asset-recovery:v1";
const RECOVERY_COOLDOWN_MS = 60_000;
let installed = false;
let bootAssetVersion: string | null | undefined;

type RecoveryPreparation = () => void | Promise<void>;
const preparations = new Set<RecoveryPreparation>();
let capturedPreparations: RecoveryPreparation[] | undefined;
const preparationTasks = new Map<RecoveryPreparation, Promise<void>>();

/** The owner retains its own scoped draft; no DOM values or identities are copied. */
export const registerAssetRecoveryPreparation = (
  prepare: RecoveryPreparation,
) => {
  preparations.add(prepare);
  return () => {
    preparations.delete(prepare);
  };
};

const prepareRecovery = async () => {
  const work = Promise.all(
    (capturedPreparations || []).map((prepare) => {
      let task = preparationTasks.get(prepare);
      if (!task) {
        task = Promise.resolve()
          .then(prepare)
          .catch((error) => {
            preparationTasks.delete(prepare);
            throw error;
          });
        preparationTasks.set(prepare, task);
      }
      return task;
    }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Recovery save timed out")),
          12_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const moduleEntry = (document: Document): string | null => {
  const source = document
    .querySelector<HTMLScriptElement>('script[type="module"][src]')
    ?.getAttribute("src");
  if (!source) return null;
  const url = new URL(source, window.location.href);
  return url.origin === window.location.origin ? url.href : null;
};

const documentAssetVersion = (source: Document): string | null => {
  const entry = moduleEntry(source);
  if (!entry) return null;
  const styles = [
    ...source.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'),
  ]
    .map((link) => new URL(link.getAttribute("href")!, window.location.href))
    .filter((url) => url.origin === window.location.origin)
    .map((url) => url.href)
    .sort();
  return JSON.stringify([entry, ...styles]);
};

const reserveReload = (target: string): boolean => {
  // Without durable tab storage we cannot promise a bounded automatic reload.
  try {
    const stored = window.sessionStorage.getItem(RECOVERY_KEY);
    const previous = stored ? JSON.parse(stored) : null;
    const now = Date.now();
    if (
      previous &&
      (previous.target === target ||
        now - Number(previous.at) < RECOVERY_COOLDOWN_MS)
    )
      return false;
    window.sessionStorage.setItem(
      RECOVERY_KEY,
      JSON.stringify({ target, at: now }),
    );
    return true;
  } catch {
    return false;
  }
};

const latestEntry = async (): Promise<string | null> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  try {
    const url = new URL(window.location.href);
    url.hash = "";
    const response = await fetch(url.href, {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: "text/html" },
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("text/html")
    )
      return null;
    return documentAssetVersion(
      new DOMParser().parseFromString(await response.text(), "text/html"),
    );
  } finally {
    window.clearTimeout(timeout);
  }
};

const recover = createAssetRecoveryController({
  online: () => navigator.onLine !== false,
  currentEntry: () => (bootAssetVersion ??= documentAssetVersion(document)),
  latestEntry,
  prepare: prepareRecovery,
  reserveReload,
  reload: () => window.location.reload(),
});

export const recoverAssetLoad = (
  error: unknown,
  options?: AssetRecoveryOptions,
) => {
  if (isAssetLoadFailure(error)) capturedPreparations ||= [...preparations];
  return recover(error, options);
};

export function installAssetRecovery() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  // Freeze only the initial document assets. Route-added styles are not a new build.
  bootAssetVersion ??= documentAssetVersion(document);
  window.addEventListener("vite:preloadError", (event) => {
    void recoverAssetLoad((event as Event & { payload?: unknown }).payload);
    // Let Vite reject normally: suppressing CSS errors can render an unstyled
    // module, and suppressing JS errors gives React.lazy an undefined module.
  });
}
