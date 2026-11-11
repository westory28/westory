export type AssetRecoveryResult =
  | "reloading"
  | "offline"
  | "draft"
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
  hasDraft: () => boolean;
  currentEntry: () => string | null;
  latestEntry: () => Promise<string | null>;
  reserveReload: (target: string) => boolean;
  reload: () => void;
};

/** A preload event and its React boundary share one bounded recovery attempt. */
export function createAssetRecoveryController(env: AssetRecoveryEnvironment) {
  let attempt: Promise<AssetRecoveryResult> | undefined;
  return (error: unknown): Promise<AssetRecoveryResult> => {
    if (!isAssetLoadFailure(error)) return Promise.resolve("unsupported");
    if (attempt) return attempt;
    attempt = (async () => {
      if (!env.online()) return "offline";
      if (env.hasDraft()) return "draft";
      const current = env.currentEntry();
      if (!current) return "unavailable";
      let latest: string | null;
      try {
        latest = await env.latestEntry();
      } catch {
        return env.online() ? "unavailable" : "offline";
      }
      // A user can start editing or lose their connection during the check.
      if (!env.online()) return "offline";
      if (env.hasDraft()) return "draft";
      if (!latest) return "unavailable";
      if (latest === current) return "current-version";
      if (!env.reserveReload(latest)) return "retry-limit";
      try {
        env.reload();
        return "reloading";
      } catch {
        return "unavailable";
      }
    })();
    return attempt;
  };
}

const RECOVERY_KEY = "westory:asset-recovery:v1";
const RECOVERY_COOLDOWN_MS = 60_000;
let editedInDocument = false;
let installed = false;

// Buttons and keyboard-driven answer controls may not emit input/change.
// Retain the same conservative flag without storing any answer or form value.
export const markAssetRecoveryEdited = () => {
  editedInDocument = true;
};

const moduleEntry = (document: Document): string | null => {
  const source = document
    .querySelector<HTMLScriptElement>('script[type="module"][src]')
    ?.getAttribute("src");
  if (!source) return null;
  const url = new URL(source, window.location.href);
  return url.origin === window.location.origin ? url.href : null;
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
    return moduleEntry(
      new DOMParser().parseFromString(await response.text(), "text/html"),
    );
  } finally {
    window.clearTimeout(timeout);
  }
};

export const recoverAssetLoad = createAssetRecoveryController({
  online: () => navigator.onLine !== false,
  hasDraft: () => editedInDocument,
  currentEntry: () => moduleEntry(document),
  latestEntry,
  reserveReload,
  reload: () => window.location.reload(),
});

export function installAssetRecovery() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const markEdited = (event: Event) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("input, textarea, select, [contenteditable='true']")
    )
      markAssetRecoveryEdited();
  };
  // Keep only a conservative flag, never input values or student information.
  document.addEventListener("input", markEdited, true);
  document.addEventListener("change", markEdited, true);
  window.addEventListener("vite:preloadError", (event) => {
    void recoverAssetLoad((event as Event & { payload?: unknown }).payload);
    // Let Vite reject normally: suppressing CSS errors can render an unstyled
    // module, and suppressing JS errors gives React.lazy an undefined module.
  });
}
