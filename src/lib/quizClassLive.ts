import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";
import {
  getQuizClassChanges,
  type QuizClassChanges,
  type QuizClassLiveCursor,
  type QuizClassScope,
} from "./quizClassAnalysis";

// Only small change signals are watched. The callable authorizes each batch
// and reads the result identifiers after these cursors, never the full class.
export function watchQuizClassChanges(
  scope: QuizClassScope,
  identityKey: string,
  mode: "summary" | "detail" | "achievement",
  initial: QuizClassLiveCursor,
  onChanges: (changes: QuizClassChanges) => void,
  onError: (error: unknown) => void,
) {
  let live = initial;
  let stopped = false;
  let running = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let subscriptions: Array<() => void> = [];
  const visible = () => document.visibilityState !== "hidden";
  const disconnect = () => {
    subscriptions.forEach((unsubscribe) => unsubscribe());
    subscriptions = [];
    clearTimeout(timer);
    timer = undefined;
  };
  const fail = (error: unknown) => {
    if (stopped) return;
    stopped = true;
    disconnect();
    onError(error);
  };
  const drain = async () => {
    timer = undefined;
    if (stopped || running || !visible() || !pending) return;
    pending = false;
    running = true;
    try {
      const changes = await getQuizClassChanges(scope, identityKey, mode, live);
      if (stopped) return;
      const before = new Map(
        live.classes.map((entry) => [entry.classId, entry.cursor]),
      );
      if (
        changes.semesterId !== scope.semesterId ||
        changes.live.contextVersion !== live.contextVersion ||
        changes.live.contentCursor < live.contentCursor ||
        changes.live.classes.length !== before.size ||
        changes.live.classes.some(
          (entry) =>
            !before.has(entry.classId) ||
            entry.cursor < before.get(entry.classId)!,
        )
      )
        throw new Error("실시간 분석 범위가 바뀌었습니다. 다시 조회해 주세요.");
      onChanges(changes);
      live = changes.live;
      pending ||= changes.hasMore;
    } catch (error) {
      fail(error);
    } finally {
      running = false;
      if (pending && !stopped && visible()) schedule();
    }
  };
  const schedule = () => {
    if (!timer && !running && !stopped && visible())
      timer = setTimeout(() => void drain(), 180);
  };
  const notify = () => {
    pending = true;
    schedule();
  };
  const connect = () => {
    if (stopped || !visible() || subscriptions.length) return;
    const root = `quiz_class_analysis_state/${scope.semesterId}`;
    if (
      live.statePath !== root ||
      live.classes.some(
        (entry) =>
          !entry.statePath.startsWith(`${root}/classes/`) ||
          !/^[a-f0-9]{64}$/.test(
            entry.statePath.slice(`${root}/classes/`.length),
          ),
      )
    ) {
      fail(
        new Error(
          "실시간 분석 경로를 확인하지 못했습니다. 다시 조회해 주세요.",
        ),
      );
      return;
    }
    subscriptions.push(
      onSnapshot(
        doc(db, root),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (snapshot.metadata.fromCache) return;
          const state = snapshot.data() || {};
          if (
            Number(state.sequence || 0) > live.contentCursor ||
            (state.rosterGeneration || "") !== (live.rosterGeneration || "")
          )
            notify();
        },
        fail,
      ),
    );
    for (const entry of live.classes)
      subscriptions.push(
        onSnapshot(
          doc(db, entry.statePath),
          { includeMetadataChanges: true },
          (snapshot) => {
            if (snapshot.metadata.fromCache) return;
            const cursor =
              live.classes.find((item) => item.classId === entry.classId)
                ?.cursor || 0;
            if (Number(snapshot.data()?.sequence || 0) > cursor) notify();
          },
          fail,
        ),
      );
    if (pending) schedule();
  };
  const visibility = () => {
    if (visible()) connect();
    else disconnect();
  };
  document.addEventListener("visibilitychange", visibility);
  connect();
  return () => {
    stopped = true;
    disconnect();
    document.removeEventListener("visibilitychange", visibility);
  };
}
