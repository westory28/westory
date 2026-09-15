// A completed response can remain in the shared query cache for 15 seconds.
// Keep normal polling beyond that window without clearing other pages' caches.
export const THINK_CLOUD_REFRESH_MS = 16_000;
export const THINK_CLOUD_READ_SKIPPED = Symbol("think-cloud-read-skipped");

export const createThinkCloudReadGate = () => {
  let tail: Promise<void> | null = null;
  return {
    async run<T>(read: () => Promise<T>, isCurrent: () => boolean) {
      const previous = tail;
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      tail = current;
      if (previous) await previous;
      try {
        return isCurrent() ? await read() : THINK_CLOUD_READ_SKIPPED;
      } finally {
        release();
        if (tail === current) tail = null;
      }
    },
  };
};

export interface ThinkCloudRefreshHost {
  visible: () => boolean;
  online: () => boolean;
  schedule: (callback: () => void, delay: number) => () => void;
  subscribe: (callback: () => void) => () => void;
}

const browserHost = (): ThinkCloudRefreshHost => ({
  visible: () => document.visibilityState !== "hidden",
  online: () => navigator.onLine !== false,
  schedule: (callback, delay) => {
    const timer = window.setTimeout(callback, delay);
    return () => window.clearTimeout(timer);
  },
  subscribe: (callback) => {
    document.addEventListener("visibilitychange", callback);
    window.addEventListener("online", callback);
    window.addEventListener("offline", callback);
    return () => {
      document.removeEventListener("visibilitychange", callback);
      window.removeEventListener("online", callback);
      window.removeEventListener("offline", callback);
    };
  },
});

export const startThinkCloudRefresh = <T>({
  gate,
  read,
  isCurrent,
  onData,
  onError,
  host = browserHost(),
}: {
  gate: ReturnType<typeof createThinkCloudReadGate>;
  read: () => Promise<T>;
  isCurrent: () => boolean;
  onData: (value: T) => void;
  // Return false for a permission/session failure that needs user recovery.
  onError: (error: unknown) => boolean;
  host?: ThinkCloudRefreshHost;
}) => {
  let disposed = false;
  let running = false;
  let stopped = false;
  let failures = 0;
  let cancelTimer: (() => void) | undefined;
  const current = () => !disposed && isCurrent();
  const available = () =>
    current() && !stopped && host.visible() && host.online();
  const clearTimer = () => {
    cancelTimer?.();
    cancelTimer = undefined;
  };
  const refresh = async () => {
    if (!available() || running) return;
    clearTimer();
    running = true;
    try {
      const value = await gate.run(read, available);
      if (!current() || value === THINK_CLOUD_READ_SKIPPED) return;
      onData(value);
      failures = 0;
    } catch (error) {
      if (!current()) return;
      failures++;
      stopped = !onError(error);
    } finally {
      running = false;
      if (available()) {
        const delay = Math.min(
          60_000,
          THINK_CLOUD_REFRESH_MS * 2 ** Math.max(0, failures - 1),
        );
        cancelTimer = host.schedule(() => void refresh(), delay);
      }
    }
  };
  const unsubscribe = host.subscribe(() => {
    if (available()) void refresh();
    else clearTimer();
  });
  void refresh();
  return () => {
    disposed = true;
    clearTimer();
    unsubscribe();
  };
};
