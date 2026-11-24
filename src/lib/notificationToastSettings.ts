import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";

export const DEFAULT_TEACHER_TOAST_SECONDS = 5;
export const MIN_TEACHER_TOAST_SECONDS = 1;
export const MAX_TEACHER_TOAST_SECONDS = 60;

export const isValidTeacherToastSeconds = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= MIN_TEACHER_TOAST_SECONDS &&
  value <= MAX_TEACHER_TOAST_SECONDS;

export const normalizeTeacherToastSeconds = (value: unknown): number =>
  isValidTeacherToastSeconds(value) ? value : DEFAULT_TEACHER_TOAST_SECONDS;

type DurationListener = (seconds: number) => void;
interface DurationWatch {
  listeners: Set<DurationListener>;
  seconds: number;
  connect: () => void;
  dispose: () => void;
}

// Share one live document between header instances in the same account,
// semester and role. Nothing survives the final subscriber or an error.
const watches = new Map<string, DurationWatch>();

export function subscribeTeacherToastDuration(
  scopeKey: string,
  listener: DurationListener,
) {
  let watch = watches.get(scopeKey);
  if (!watch) {
    let stopped = false;
    let generation = 0;
    let unsubscribe: (() => void) | undefined;
    const listeners = new Set<DurationListener>();
    const notify = (seconds: number) => {
      watch!.seconds = seconds;
      listeners.forEach((callback) => callback(seconds));
    };
    const disconnect = () => {
      generation += 1;
      unsubscribe?.();
      unsubscribe = undefined;
    };
    const connect = () => {
      if (stopped || document.hidden || unsubscribe) return;
      const requestGeneration = ++generation;
      unsubscribe = onSnapshot(
        doc(db, "site_settings", "notification_config"),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (
            stopped ||
            generation !== requestGeneration ||
            snapshot.metadata.hasPendingWrites
          )
            return;
          notify(
            normalizeTeacherToastSeconds(
              snapshot.data()?.teacherToastDurationSeconds,
            ),
          );
        },
        () => {
          if (stopped || generation !== requestGeneration) return;
          disconnect();
          notify(DEFAULT_TEACHER_TOAST_SECONDS);
        },
      );
    };
    const onVisibility = () => {
      if (document.hidden) disconnect();
      else connect();
    };
    watch = {
      listeners,
      seconds: DEFAULT_TEACHER_TOAST_SECONDS,
      connect,
      dispose: () => {
        stopped = true;
        disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
      },
    };
    watches.set(scopeKey, watch);
    document.addEventListener("visibilitychange", onVisibility);
  }
  watch.listeners.add(listener);
  listener(watch.seconds);
  watch.connect();
  return () => {
    watch.listeners.delete(listener);
    if (!watch.listeners.size) {
      watch.dispose();
      watches.delete(scopeKey);
    }
  };
}
