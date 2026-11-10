import { useEffect, useRef } from "react";
import { watchQuizClassChanges } from "../../../lib/quizClassLive";
import type {
  QuizClassChanges,
  QuizClassLiveCursor,
  QuizClassScope,
} from "../../../lib/quizClassAnalysis";

export function useQuizClassUpdates({
  scope,
  identityKey,
  mode,
  data,
  enabled = true,
  onChanges,
  onError,
}: {
  scope: QuizClassScope | null;
  identityKey: string;
  mode: "summary" | "detail" | "achievement";
  data: { live?: QuizClassLiveCursor; liveKey?: number } | null;
  enabled?: boolean;
  onChanges: (changes: QuizClassChanges) => void;
  onError: (error: unknown) => void;
}) {
  const callbacks = useRef({ onChanges, onError });
  callbacks.current = { onChanges, onError };
  const scopeKey = JSON.stringify(scope);
  useEffect(() => {
    if (!enabled || !scope || !data?.live) return;
    return watchQuizClassChanges(
      scope,
      identityKey,
      mode,
      data.live,
      (changes) => callbacks.current.onChanges(changes),
      (error) => callbacks.current.onError(error),
    );
    // liveKey changes on a fresh query, never on a delta. Keep the listener and
    // cursor alive while React renders new answers or switches report tables.
  }, [scopeKey, identityKey, mode, data?.liveKey, enabled]);
}
