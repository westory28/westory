import { useCallback, useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { calendarDateKey } from "../../../lib/calendarWeek";

type AttendanceScope = { year: string; semester: string } | null;
const EMPTY_DATES: string[] = [];

export const useAttendanceDates = (
  uid: string | undefined,
  scope: AttendanceScope,
) => {
  const year = scope?.year;
  const semester = scope?.semester;
  const identity = uid && year && semester ? `${uid}/${year}_${semester}` : "";
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({
    identity: "",
    dates: [] as string[],
    confirmedDates: [] as string[],
    loading: false,
    error: false,
  });
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!uid || !year || !semester) return;
    let active = true;
    setState((previous) => ({
      identity,
      dates: previous.identity === identity ? previous.dates : EMPTY_DATES,
      confirmedDates:
        previous.identity === identity ? previous.confirmedDates : EMPTY_DATES,
      loading: true,
      error: false,
    }));
    const unsubscribe = onSnapshot(
      query(
        collection(db, "users", uid, "attendance"),
        where("scope", "==", `${year}_${semester}`),
      ),
      (snapshot) => {
        if (!active) return;
        const dates = Array.from(
          new Set(
            snapshot.docs
              .map((item) => calendarDateKey(String(item.data().date || "")))
              .filter(Boolean),
          ),
        ).sort();
        const confirmedDates = snapshot.docs
          .filter((item) => item.data().rewardProcessed === true)
          .map((item) => calendarDateKey(String(item.data().date || "")))
          .filter(Boolean);
        setState({
          identity,
          dates,
          confirmedDates,
          loading: false,
          error: false,
        });
      },
      () => {
        if (!active) return;
        setState((previous) => ({ ...previous, loading: false, error: true }));
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [uid, year, semester, identity, attempt]);

  return {
    dates: identity && state.identity === identity ? state.dates : EMPTY_DATES,
    confirmedDates:
      identity && state.identity === identity
        ? state.confirmedDates
        : EMPTY_DATES,
    loading:
      Boolean(identity) && (state.identity !== identity || state.loading),
    error: state.identity === identity && state.error,
    retry,
  };
};
