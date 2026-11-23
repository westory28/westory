import type { User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";
import { isStudentWisStockTransient } from "./studentWisStockReadRetry";
import { parseWisStockInvestmentBoardSession } from "../../functions/wisStockInvestmentBoard.mjs";

type Listener = {
  allowed: () => void;
  denied: (error: Error) => void;
  paused: (error?: Error) => void;
};
type Entry = {
  owner: User;
  listeners: Set<Listener>;
  ready: boolean;
  error: Error | null;
  pendingError: Error | null;
  retry: () => void;
  dispose: () => void;
};
const entries = new Map<string, Entry>();
export function retryStudentWisStockSession(owner: User, epoch: number) {
  entries.get(`${owner.uid}:${epoch}`)?.retry();
}
/** Shared, exact-own-session watch; no cached session may authorize a live display. */
export function watchStudentWisStockSession(
  owner: User,
  epoch: number,
  listener: Listener,
) {
  const key = `${owner.uid}:${epoch}`;
  let entry = entries.get(key);
  if (entry && entry.owner !== owner) {
    entry.dispose();
    entry = undefined;
  }
  if (!entry) {
    let stopped = false,
      stopSnapshot: (() => void) | undefined;
    let generation = 0;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    const listeners = new Set<Listener>();
    const disconnect = () => {
      generation++;
      stopSnapshot?.();
      stopSnapshot = undefined;
      clearTimeout(deadline);
      clearTimeout(retryTimer);
    };
    const pause = (error?: Error) => {
      current.ready = false;
      current.error = null;
      current.pendingError = error || null;
      listeners.forEach((next) => next.paused(error));
    };
    const delayed = () => pause(new Error("연결을 다시 확인해 주세요."));
    const fail = () => {
      if (stopped) return;
      const error = Object.assign(
        new Error("로그인 상태를 확인한 뒤 다시 로그인해 주세요."),
        { code: "unauthenticated" },
      );
      current.ready = false;
      current.error = error;
      listeners.forEach((next) => next.denied(error));
      disconnect();
    };
    const dispose = () => {
      if (stopped) return;
      stopped = true;
      disconnect();
      document.removeEventListener("visibilitychange", reconnect);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", reconnect);
      if (entries.get(key) === current) entries.delete(key);
    };
    const current: Entry = {
      owner,
      listeners,
      ready: false,
      error: null,
      pendingError: null,
      retry: () => reconnect(),
      dispose,
    };
    entry = current;
    entries.set(key, current);
    const connect = () => {
      if (stopped || stopSnapshot || current.error) return;
      if (document.visibilityState === "hidden" || navigator.onLine === false) {
        pause();
        return;
      }
      const turn = ++generation;
      // A slow connection is not an expired or revoked session. Keep the exact
      // server listener alive and keep protected content paused until it confirms.
      deadline = setTimeout(delayed, 15_000);
      stopSnapshot = onSnapshot(
        doc(db, `application_sessions/${owner.uid}/sessions/${epoch}`),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (stopped || turn !== generation) return;
          if (auth.currentUser !== owner) {
            fail();
            return;
          }
          if (
            snapshot.metadata.fromCache ||
            snapshot.metadata.hasPendingWrites
          ) {
            pause();
            clearTimeout(deadline);
            deadline = setTimeout(delayed, 15_000);
            return;
          }
          try {
            const session = parseWisStockInvestmentBoardSession(
              snapshot.exists() ? snapshot.data() : null,
              { uid: owner.uid, authTime: epoch },
              Date.now(),
            );
            clearTimeout(deadline);
            if (session.deadlineAtMs !== null)
              deadline = setTimeout(
                fail,
                Math.max(
                  0,
                  Math.min(2_147_483_647, session.deadlineAtMs - Date.now()),
                ),
              );
            current.error = null;
            current.pendingError = null;
            retries = 0;
            current.ready = true;
            listeners.forEach((next) => next.allowed());
          } catch {
            fail();
          }
        },
        (error) => {
          if (!isStudentWisStockTransient(error)) {
            fail();
            return;
          }
          disconnect();
          pause();
          if (retries < 2)
            retryTimer = setTimeout(connect, 750 * 2 ** retries++);
          else delayed();
        },
      );
    };
    const reconnect = () => {
      disconnect();
      retries = 0;
      pause();
      connect();
    };
    document.addEventListener("visibilitychange", reconnect);
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", reconnect);
    connect();
  }
  entry.listeners.add(listener);
  if (entry.error) listener.denied(entry.error);
  else if (entry.ready) listener.allowed();
  else if (entry.pendingError) entry.retry();
  const chosen = entry;
  return () => {
    chosen.listeners.delete(listener);
    if (!chosen.listeners.size) chosen.dispose();
  };
}
