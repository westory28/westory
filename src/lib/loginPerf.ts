const PERF_QUERY_KEY = "westoryPerfLogin";
const PERF_STORAGE_KEY = "westoryPerfLogin";
const DETAIL_ENUMS: Record<string, readonly string[]> = {
  phase: [
    "resolving",
    "opening-session",
    "loading-profile",
    "ready",
    "onboarding",
    "signed-out",
    "error",
  ],
  mode: ["student", "teacher"],
  role: ["student", "staff", "teacher"],
  source: ["finish-login", "auto-resume", "shared-bootstrap"],
  exists: ["true", "false", "cached"],
  hit: ["true", "false"],
  recovered: ["true", "fallback"],
};
const safeDetail = (detail?: Record<string, unknown>) => {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(detail || {})) {
    if (
      ["hasUser", "exists", "hit", "recovered"].includes(key) &&
      typeof value === "boolean"
    )
      result[key] = value;
    else if (
      key === "attempt" &&
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    )
      result[key] = value;
    else if (typeof value === "string" && DETAIL_ENUMS[key]?.includes(value))
      result[key] = value;
  }
  return result;
};

const isPerfEnabled = () => {
  if (typeof window === "undefined") return false;

  try {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get(PERF_QUERY_KEY) === "1" ||
      window.localStorage.getItem(PERF_STORAGE_KEY) === "1"
    );
  } catch {
    return false;
  }
};

export const markLoginPerf = (
  name: string,
  detail?: Record<string, unknown>,
) => {
  if (!isPerfEnabled() || typeof performance === "undefined") return;

  try {
    performance.mark(name);
    console.info(`[Perf] ${name}`, {
      at: Math.round(performance.now()),
      ...safeDetail(detail),
    });
  } catch {
    // Ignore performance API failures.
  }
};

export const measureLoginPerf = (
  name: string,
  startMark: string,
  endMark: string,
) => {
  if (!isPerfEnabled() || typeof performance === "undefined") return;

  try {
    performance.measure(name, startMark, endMark);
    const entries = performance.getEntriesByName(name, "measure");
    const lastEntry = entries[entries.length - 1];
    if (lastEntry) {
      console.info(`[Perf] ${name}`, {
        durationMs: Math.round(lastEntry.duration),
      });
    }
  } catch {
    // Ignore missing marks or unsupported browsers.
  }
};
