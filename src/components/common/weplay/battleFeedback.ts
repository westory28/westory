import type { WeplayAcceptedEvent } from "../../../lib/weplay";

/** Display-only predictions. The server still owns acceptance and settlement. */
export function createBattleFeedback(initial: WeplayAcceptedEvent[] = []) {
  const confirmed = new Map(initial.map((event) => [event.wordId, event]));
  const predicted = new Map<string, WeplayAcceptedEvent>();
  return {
    hasConfirmed: (wordId: string) => confirmed.has(wordId),
    predict(wordId: string, elapsedMs: number) {
      if (confirmed.has(wordId) || predicted.has(wordId)) return false;
      predicted.set(wordId, { wordId, elapsedMs });
      return true;
    },
    acknowledge(events: WeplayAcceptedEvent[]) {
      // A later reply may contain earlier inputs whose own reply is still in
      // flight. Merge rather than replacing so reversed replies cannot undo it.
      for (const event of events) {
        if (!confirmed.has(event.wordId)) confirmed.set(event.wordId, event);
        predicted.delete(event.wordId);
      }
    },
    reject(wordId: string) {
      return !confirmed.has(wordId) && predicted.delete(wordId);
    },
    snapshot() {
      return [...confirmed.values(), ...predicted.values()].sort(
        (a, b) => a.elapsedMs - b.elapsedMs || a.wordId.localeCompare(b.wordId),
      );
    },
  };
}
