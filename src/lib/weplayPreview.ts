import {
  normalizeWeplayAnswer,
  type WeplayAnswerResponse,
  type WeplayResult,
  type WeplaySession,
} from "./weplay";

/** A teacher preview is local after its authorized word snapshot is received. */
export function createWeplayPreviewTransport(session: WeplaySession) {
  const accepted = new Set<string>();
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
      const valid =
        data.sessionId === session.id &&
        !!word &&
        time < session.endsAtMs &&
        elapsed >= word.spawnAtMs &&
        elapsed < word.spawnAtMs + word.fallDurationMs &&
        normalizeWeplayAnswer(data.answer) === normalizeWeplayAnswer(word.text);
      if (valid) accepted.add(data.wordId);
      return {
        accepted: valid,
        acceptedWordIds: [...accepted],
        correctCount: accepted.size,
        serverNowMs: time,
      };
    },
    async finish(): Promise<WeplayResult> {
      return {
        sessionId: session.id,
        mode: "practice",
        difficulty: session.difficulty,
        correctCount: accepted.size,
        totalWords: session.words.length,
        score: accepted.size * 100,
        reward: 0,
        cost: 0,
        netWis: 0,
        balance: 0,
        finishedAtMs: now(),
        missedWords: session.words.filter((word) => !accepted.has(word.id)),
      };
    },
  };
}
