import {
  normalizeWeplayAnswer,
  type WeplayAcceptedEvent,
  type WeplayAnswerResponse,
  type WeplayResult,
  type WeplaySession,
} from "./weplay";
import { simulateWeplayBattle } from "./weplayBattle";

/** A teacher preview is local after its authorized word snapshot is received. */
export function createWeplayPreviewTransport(session: WeplaySession) {
  const accepted = new Set<string>(session.acceptedWordIds || []);
  const events: WeplayAcceptedEvent[] = [...(session.acceptedEvents || [])];
  let result: WeplayResult | null = null;
  const started = performance.now();
  const now = () => session.serverNowMs + performance.now() - started;
  return {
    async answer(data: {
      sessionId: string;
      wordId: string;
      answer: string;
    }): Promise<WeplayAnswerResponse> {
      const time = now();
      const word = session.words.find((item) => item.id === data.wordId);
      const elapsed = time - session.startsAtMs;
      const battle =
        session.battleVersion === 1
          ? simulateWeplayBattle(session, elapsed, events)
          : null;
      const valid =
        !result &&
        battle?.outcome !== "defeat" &&
        data.sessionId === session.id &&
        !!word &&
        !accepted.has(data.wordId) &&
        time < session.endsAtMs &&
        elapsed >= word.spawnAtMs + 100 &&
        elapsed <
          word.spawnAtMs +
            word.fallDurationMs +
            (word.kind === "special" ? 0 : 750) &&
        normalizeWeplayAnswer(data.answer) === normalizeWeplayAnswer(word.text);
      if (valid) {
        accepted.add(data.wordId);
        if (session.battleVersion === 1)
          events.push({ wordId: data.wordId, elapsedMs: elapsed });
      }
      const after = battle
        ? simulateWeplayBattle(session, elapsed, events)
        : null;
      return {
        accepted: valid,
        acceptedWordIds: [...accepted],
        correctCount: after ? after.normalCorrectCount : accepted.size,
        serverNowMs: time,
        ...(after ? { acceptedEvents: [...events], battle: after } : {}),
      };
    },
    async finish(): Promise<WeplayResult> {
      if (result) return result;
      const time = now();
      const battle =
        session.battleVersion === 1
          ? simulateWeplayBattle(session, time - session.startsAtMs, events)
          : null;
      if (battle?.outcome === "active")
        throw new Error("게임이 끝난 뒤 정산할 수 있습니다.");
      result = {
        sessionId: session.id,
        mode: "practice",
        difficulty: session.difficulty,
        correctCount: battle ? battle.normalCorrectCount : accepted.size,
        totalWords: session.words.filter((word) => word.kind !== "special")
          .length,
        score: battle ? battle.score : accepted.size * 100,
        reward: 0,
        cost: 0,
        netWis: 0,
        balance: 0,
        finishedAtMs:
          battle?.defeatAtMs != null
            ? session.startsAtMs + battle.defeatAtMs
            : time,
        missedWords: session.words.filter(
          (word) => word.kind !== "special" && !accepted.has(word.id),
        ),
        ...(battle
          ? {
              battleVersion: 1,
              battle,
              rewardCorrectCount: battle.rewardCorrectCount,
            }
          : {}),
      };
      return result;
    },
  };
}
