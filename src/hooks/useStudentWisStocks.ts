import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { getStudentRouteAccess } from "../lib/studentMenuAccess";
import { getYearSemester } from "../lib/semesterScope";
import {
  STUDENT_WISPI_URL,
  type StudentWisStockMarket,
  type StudentWisStockStatus,
  type WisStockLoad,
  type WisStockScope,
} from "../lib/studentWisStockTypes";
import {
  watchStudentWisStockMarket,
  watchStudentWisStockStatus,
} from "../lib/studentWisStockPublic";
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
    getStudentRouteAccess({ pathname: STUDENT_WISPI_URL }, config, menuConfig)
      .allowed;
  const scope = getYearSemester(config);
  const [retryCount, setRetryCount] = useState(0);
  const key = allowed
    ? `${currentUser?.uid}:${authGeneration}:${scope.year}:${scope.semester}:${retryCount}`
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
export const useStudentWisStockStatus = (enabled = true) =>
  usePublic<StudentWisStockStatus>(enabled, watchStudentWisStockStatus);
export const useStudentWisStockMarket = (enabled = true) =>
  usePublic<StudentWisStockMarket>(enabled, watchStudentWisStockMarket);

/** My Page remains readable when the market is paused or its menu is hidden. */
export function useStudentWisStockAccount(enabled = true) {
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
    ? `${currentUser?.uid}:${authGeneration}:${scope.year}:${scope.semester}:${retryCount}`
    : "";
  const [state, setState] = useState<{
    key: string;
    value: WisStockLoad<StudentWisStockState>;
  }>({ key: "", value: { status: "idle", data: null, error: "" } });
  useEffect(() => {
    if (!key) return;
    let live = true;
    const stop = watchStudentWisStockState(scope, (value) => {
      if (live) setState({ key, value });
    });
    return () => {
      live = false;
      stop();
    };
  }, [key]);
  const retry = useCallback(() => {
    void refreshStudentWisStockState(scope)
      .then((refreshed) => {
        if (!refreshed) setRetryCount((value) => value + 1);
      })
      .catch(() => setRetryCount((value) => value + 1));
  }, [scope.year, scope.semester]);
  const value: WisStockLoad<StudentWisStockState> = !key
    ? { status: "idle", data: null, error: "" }
    : state.key === key
      ? state.value
      : { status: "loading", data: null, error: "" };
  return { ...value, retry };
}
