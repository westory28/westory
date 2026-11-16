import { getHistoryDictionaryCallable } from "./historyDictionarySession";
import { getYearSemester } from "./semesterScope";
import type { WeplayConfig, WeplayGameId } from "./weplay";

export interface WeplayRanking {
  gameId: WeplayGameId;
  category: string;
  rows: { rank: number; studentLabel: string; score: number; isMe: boolean }[];
  updatedAtMs: number;
  scoreLabel: string;
  limit?: number;
  period?: { startsAtMs: number; endsAtMs: number };
  trackingSinceMs?: number;
}

const CACHE_MS = 60_000;
const cache = new Map<string, { value: WeplayRanking; expires: number }>();
const pending = new Map<string, Promise<WeplayRanking>>();
const invalidated = new Set<WeplayGameId>();
let activeScope = "";
let generation = 0;

async function call<T>(
  name: string,
  config: WeplayConfig,
  data: object,
): Promise<T> {
  if (!config?.year || !config?.semester)
    throw new Error("현재 학기를 확인하지 못했습니다.");
  const fn = await getHistoryDictionaryCallable<object, T>(name, {
    reuseSessionProof: true,
  });
  return (await fn({ ...getYearSemester(config), ...data })).data;
}

/** Memory only. Account, auth generation, semester, role and class form the scope.
 * Failed requests are never cached; a result write invalidates the corresponding game.
 */
export function getWeplayRanking(
  config: WeplayConfig,
  scope: string,
  gameId: WeplayGameId,
  category: string,
) {
  if (activeScope !== scope) {
    activeScope = scope;
    generation++;
    cache.clear();
    pending.clear();
  }
  const key = `${gameId}/${category}`;
  const saved = cache.get(key);
  if (saved && saved.expires > Date.now()) return Promise.resolve(saved.value);
  const existing = pending.get(key);
  if (existing) return existing;
  const startedGeneration = generation;
  const request = call<WeplayRanking>("getWeplayRanking", config, {
    gameId,
    category,
    refresh: invalidated.has(gameId),
  })
    .then((value) => {
      if (startedGeneration === generation) {
        cache.set(key, { value, expires: Date.now() + CACHE_MS });
        invalidated.delete(gameId);
      }
      return value;
    })
    .finally(() => {
      if (pending.get(key) === request) pending.delete(key);
    });
  pending.set(key, request);
  return request;
}

export function invalidateWeplayRanking(
  gameId: WeplayGameId,
  refreshServer = true,
) {
  generation++;
  if (refreshServer) invalidated.add(gameId);
  for (const key of cache.keys())
    if (key.startsWith(`${gameId}/`)) cache.delete(key);
  for (const key of pending.keys())
    if (key.startsWith(`${gameId}/`)) pending.delete(key);
}

export interface RhythmRankingEvent {
  time: number;
  kind: "center" | "rim";
  hand: "left" | "right";
}
export const startRhythmRankingGame = (
  config: WeplayConfig,
  data: { songId: string; difficulty: string; requestId: string },
) => call<{ sessionId: string }>("startRhythmRankingGame", config, data);
export const finishRhythmRankingGame = async (
  config: WeplayConfig,
  data: { sessionId: string; events: RhythmRankingEvent[] },
) => {
  const result = await call<{ score: number }>(
    "finishRhythmRankingGame",
    config,
    data,
  );
  invalidateWeplayRanking("gungdeok-rock");
  return result;
};
