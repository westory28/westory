const PERF_QUERY_KEY = 'westoryPerfLogin';
const PERF_STORAGE_KEY = 'westoryPerfLogin';

const isPerfEnabled = () => {
    if (typeof window === 'undefined') return false;

    try {
        const params = new URLSearchParams(window.location.search);
        return params.get(PERF_QUERY_KEY) === '1' || window.localStorage.getItem(PERF_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
};

export const markLoginPerf = (name: string, detail?: Record<string, unknown>) => {
    if (!isPerfEnabled() || typeof performance === 'undefined') return;

    try {
        performance.mark(name);
        console.info(`[Perf] ${name}`, {
            at: Math.round(performance.now()),
            ...(detail || {}),
        });
    } catch {
        // Ignore performance API failures.
    }
};

export const measureLoginPerf = (name: string, startMark: string, endMark: string) => {
    if (!isPerfEnabled() || typeof performance === 'undefined') return;

    try {
        performance.measure(name, startMark, endMark);
        const entries = performance.getEntriesByName(name, 'measure');
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
