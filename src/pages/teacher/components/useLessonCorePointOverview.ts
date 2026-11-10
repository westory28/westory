import { useCallback, useEffect, useRef, useState } from "react";
import { auth } from "../../../lib/firebase";
import { getHistoryDictionaryCallable } from "../../../lib/historyDictionarySession";

type CorePointRow = { unitId: string; corePointCount: number };
type CorePointResponse = {
  scopedLessons: CorePointRow[];
  legacyLessons: CorePointRow[];
};

export type LessonCorePointOverview =
  | { status: "loading" | "error"; total: null }
  | { status: "ready"; total: number };

const LOADING: LessonCorePointOverview = { status: "loading", total: null };

export function readCorePointTotal(data: CorePointResponse): number {
  if (
    !Array.isArray(data?.scopedLessons) ||
    !Array.isArray(data?.legacyLessons)
  ) {
    throw new Error("핵심포인트 합계를 확인하지 못했습니다.");
  }
  const unitIds = new Set<string>();
  return [...data.scopedLessons, ...data.legacyLessons].reduce((total, row) => {
    if (
      !row ||
      typeof row.unitId !== "string" ||
      !row.unitId.trim() ||
      unitIds.has(row.unitId) ||
      !Number.isSafeInteger(row.corePointCount) ||
      row.corePointCount < 0
    ) {
      throw new Error("핵심포인트 합계를 확인하지 못했습니다.");
    }
    unitIds.add(row.unitId);
    return total + row.corePointCount;
  }, 0);
}

/** One compact server read per account/semester, with explicit save/retry refresh. */
export function useLessonCorePointOverview({
  uid,
  year,
  semester,
  enabled,
}: {
  uid?: string;
  year?: string;
  semester?: string;
  enabled: boolean;
}) {
  const scopeKey =
    enabled && uid && year && semester ? `${uid}:${year}:${semester}` : "";
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const requestIdRef = useRef(0);
  const inFlightRef = useRef<{
    scopeKey: string;
    promise: Promise<void>;
  } | null>(null);
  const [state, setState] = useState<{
    scopeKey: string;
    overview: LessonCorePointOverview;
  }>({ scopeKey: "", overview: LOADING });

  const refresh = useCallback(
    (afterSave = false) => {
      if (!scopeKey || auth.currentUser?.uid !== uid) return Promise.resolve();
      if (!afterSave && inFlightRef.current?.scopeKey === scopeKey) {
        return inFlightRef.current.promise;
      }
      const requestId = ++requestIdRef.current;
      const isCurrent = () =>
        requestId === requestIdRef.current &&
        scopeKey === scopeRef.current &&
        auth.currentUser?.uid === uid;
      setState({ scopeKey, overview: LOADING });
      const promise = (async () => {
        try {
          const read = await getHistoryDictionaryCallable<
            { year: string; semester: string; view: "core-points" },
            CorePointResponse
          >("getStudentVisibleLessons");
          if (!isCurrent()) return;
          const { data } = await read({
            year: year!,
            semester: semester!,
            view: "core-points",
          });
          const total = readCorePointTotal(data);
          if (isCurrent())
            setState({ scopeKey, overview: { status: "ready", total } });
        } catch {
          if (isCurrent())
            setState({ scopeKey, overview: { status: "error", total: null } });
        } finally {
          if (requestId === requestIdRef.current) inFlightRef.current = null;
        }
      })();
      inFlightRef.current = { scopeKey, promise };
      return promise;
    },
    [scopeKey, uid, year, semester],
  );

  useEffect(() => {
    void refresh();
    return () => {
      requestIdRef.current += 1;
      inFlightRef.current = null;
    };
  }, [refresh]);

  return {
    overview: scopeKey
      ? state.scopeKey === scopeKey
        ? state.overview
        : LOADING
      : null,
    refresh,
  };
}
