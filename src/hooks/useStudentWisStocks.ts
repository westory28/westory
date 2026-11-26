import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { getStudentRouteAccess } from "../lib/studentMenuAccess";
import { getYearSemester } from "../lib/semesterScope";
import {
  STUDENT_WISPI_URL,
  STUDENT_WISPI_VIEWS,
  studentWispiViewSearch,
  type StudentWisStockMarket,
  type StudentWisStockStatus,
  type WisStockLoad,
  type WisStockScope,
} from "../lib/studentWisStockTypes";
import {
  watchStudentWisStockMarket,
  watchStudentWisStockOverseasMarket,
  watchStudentWisStockOverseasStatus,
  watchStudentWisStockStatus,
} from "../lib/studentWisStockPublic";
import {
  DOMESTIC_STOCK_VENUE,
  type StudentWisStockVenue,
} from "../lib/studentWisStockVenue";
import {
  watchWisStockFxRate,
  type WisStockFxRate,
} from "../lib/wisStockFxClient";
import { wisStockFxDayKey } from "../../functions/wisStockFx.mjs";
import {
  refreshStudentWisStockState,
  watchStudentWisStockState,
} from "../lib/studentWisStockClient";
import type { StudentWisStockState } from "../lib/studentWisStockTypes";

function usePublic<T>(
  enabled: boolean,
  watch: (
    scope: WisStockScope,
    next: (state: WisStockLoad<T>) => void,
  ) => () => void,
  venueId = "DOMESTIC",
) {
  const {
    currentUser,
    userData,
    authGeneration,
    config,
    configReady,
    menuConfig,
    menuConfigReady,
  } = useAuth();
  const allowed =
    enabled &&
    userData?.role === "student" &&
    !!currentUser &&
    configReady &&
    !!config?.year &&
    !!config?.semester &&
    menuConfigReady &&
    // Any reachable WsPI tab keeps the shared status readable, so hiding one
    // tab (including 국내 주식) in the sitemap does not blank the others.
    STUDENT_WISPI_VIEWS.some(
      (view) =>
        getStudentRouteAccess(
          {
            pathname: STUDENT_WISPI_URL,
            search: studentWispiViewSearch(view.id),
          },
          config,
          menuConfig,
        ).allowed,
    );
  const scope = getYearSemester(config);
  const [retryCount, setRetryCount] = useState(0);
  const key = allowed
    ? `${currentUser?.uid}:${authGeneration}:${scope.year}:${scope.semester}:${venueId}:${retryCount}`
    : "";
  const [state, setState] = useState<{ key: string; value: WisStockLoad<T> }>({
    key: "",
    value: { status: "idle", data: null, error: "" },
  });
  useEffect(() => {
    if (!key) return;
    let live = true;
    const stop = watch(scope, (value) => {
      if (live) setState({ key, value });
    });
    return () => {
      live = false;
      stop();
    };
  }, [key, watch]);
  const retry = useCallback(() => setRetryCount((value) => value + 1), []);
  const value: WisStockLoad<T> = !key
    ? { status: "idle", data: null, error: "" }
    : state.key === key
      ? state.value
      : { status: "loading", data: null, error: "" };
  return { ...value, retry };
}
export const useStudentWisStockStatus = (
  enabled = true,
  venue: StudentWisStockVenue = DOMESTIC_STOCK_VENUE,
) =>
  usePublic<StudentWisStockStatus>(
    enabled,
    venue.id === "OVERSEAS"
      ? watchStudentWisStockOverseasStatus
      : watchStudentWisStockStatus,
    venue.id,
  );
export const useStudentWisStockMarket = (
  enabled = true,
  venue: StudentWisStockVenue = DOMESTIC_STOCK_VENUE,
) =>
  usePublic<StudentWisStockMarket>(
    enabled,
    venue.id === "OVERSEAS"
      ? watchStudentWisStockOverseasMarket
      : watchStudentWisStockMarket,
    venue.id,
  );

/** Today's single public rate. `current` is re-evaluated on every render so a
 * screen left open past midnight stops quoting the previous day's rate. */
export function useWisStockFxRate(enabled = true) {
  const { currentUser, authGeneration } = useAuth();
  const key =
    enabled && currentUser ? `${currentUser.uid}:${authGeneration}` : "";
  const [state, setState] = useState<{
    key: string;
    value: WisStockLoad<WisStockFxRate | null>;
  }>({ key: "", value: { status: "idle", data: null, error: "" } });
  useEffect(() => {
    if (!key) return;
    let live = true;
    const stop = watchWisStockFxRate((value) => {
      if (live) setState({ key, value });
    });
    return () => {
      live = false;
      stop();
    };
  }, [key]);
  const value: WisStockLoad<WisStockFxRate | null> = !key
    ? { status: "idle", data: null, error: "" }
    : state.key === key
      ? state.value
      : { status: "loading", data: null, error: "" };
  if (value.status !== "ready" || !value.data) return value;
  return {
    ...value,
    data: {
      ...value.data,
      current: value.data.dayKey === wisStockFxDayKey(Date.now()),
    },
  };
}

/** My Page remains readable when the market is paused or its menu is hidden. */
export function useStudentWisStockAccount(
  enabled = true,
  venue: StudentWisStockVenue = DOMESTIC_STOCK_VENUE,
) {
  const { currentUser, userData, authGeneration, config, configReady } =
    useAuth();
  const scope = getYearSemester(config);
  const allowed =
    enabled &&
    userData?.role === "student" &&
    !!currentUser &&
    configReady &&
    !!config?.year &&
    !!config?.semester;
  const [retryCount, setRetryCount] = useState(0);
  const key = allowed
    ? `${currentUser?.uid}:${authGeneration}:${scope.year}:${scope.semester}:${venue.id}:${retryCount}`
    : "";
  const [state, setState] = useState<{
    key: string;
    value: WisStockLoad<StudentWisStockState>;
  }>({ key: "", value: { status: "idle", data: null, error: "" } });
  useEffect(() => {
    if (!key) return;
    let live = true;
    const stop = watchStudentWisStockState(
      scope,
      (value) => {
        if (live) setState({ key, value });
      },
      venue,
    );
    return () => {
      live = false;
      stop();
    };
  }, [key, venue]);
  const retry = useCallback(() => {
    void refreshStudentWisStockState(scope, venue)
      .then((refreshed) => {
        if (!refreshed) setRetryCount((value) => value + 1);
      })
      .catch(() => setRetryCount((value) => value + 1));
  }, [scope.year, scope.semester, venue]);
  const value: WisStockLoad<StudentWisStockState> = !key
    ? { status: "idle", data: null, error: "" }
    : state.key === key
      ? state.value
      : { status: "loading", data: null, error: "" };
  return { ...value, retry };
}
