import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";

/** One tiny owner-scoped signal, only while visible. Never polls result bodies. */
export function watchQuizResultCorrections({
  resultId,
  semesterId,
  initialVersion = "",
  onChange,
  onError,
}: {
  resultId: string;
  semesterId: string;
  initialVersion?: string;
  onChange: (version: string) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const user = auth.currentUser;
  if (!user || !resultId || resultId.includes("/")) return () => {};
  let active = true;
  let unsubscribe: (() => void) | undefined;
  let seen = initialVersion;
  let pending = "";
  let busy = false;
  const refresh = async () => {
    if (
      busy ||
      !active ||
      !pending ||
      pending === seen ||
      auth.currentUser !== user
    )
      return;
    busy = true;
    const version = pending;
    try {
      await onChange(version);
      if (active) seen = version;
    } catch (error) {
      if (active) onError(error);
      // Retain the last good result; reconnect/manual reload can retry.
      pending = "";
    } finally {
      busy = false;
      if (active && pending && pending !== seen) void refresh();
    }
  };
  const connect = () => {
    unsubscribe?.();
    unsubscribe = undefined;
    if (!active || document.hidden || auth.currentUser !== user) return;
    unsubscribe = onSnapshot(
      doc(db, "quiz_result_correction_signals", resultId),
      (snapshot) => {
        const value = snapshot.data();
        if (
          !active ||
          auth.currentUser !== user ||
          !value ||
          value.studentUid !== user.uid ||
          value.semesterId !== semesterId ||
          typeof value.version !== "string"
        )
          return;
        pending = value.version;
        void refresh();
      },
      (error) => {
        if (active) onError(error);
      },
    );
  };
  connect();
  document.addEventListener("visibilitychange", connect);
  return () => {
    active = false;
    unsubscribe?.();
    document.removeEventListener("visibilitychange", connect);
  };
}
