import type { User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";
import { parseWisStockInvestmentBoardSession } from "../../functions/wisStockInvestmentBoard.mjs";

type Listener = {
  allowed: () => void;
  denied: (error: Error) => void;
  paused: () => void;
};
type Entry = {
  owner: User;
  listeners: Set<Listener>;
  ready: boolean;
  error: Error | null;
  dispose: () => void;
};
const entries = new Map<string, Entry>();
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
    const listeners = new Set<Listener>();
    const disconnect = () => {
      generation++;
      stopSnapshot?.();
      stopSnapshot = undefined;
      clearTimeout(deadline);
    };
    const pause = () => {
      current.ready = false;
      current.error = null;
      listeners.forEach((next) => next.paused());
    };
    const fail = () => {
      if (stopped) return;
      const error = new Error("로그인 상태를 확인한 뒤 다시 로그인해 주세요.");
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
      deadline = setTimeout(fail, 15_000);
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
            deadline = setTimeout(fail, 15_000);
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
            current.ready = true;
            listeners.forEach((next) => next.allowed());
          } catch {
            fail();
          }
        },
        fail,
      );
    };
    const reconnect = () => {
      disconnect();
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
  const chosen = entry;
  return () => {
    chosen.listeners.delete(listener);
    if (!chosen.listeners.size) chosen.dispose();
  };
}
