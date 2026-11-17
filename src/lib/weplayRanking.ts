import { getHistoryDictionaryCallable } from "./historyDictionarySession";
import { getYearSemester } from "./semesterScope";
import type { WeplayConfig, WeplayGameId } from "./weplay";

export interface WeplayRanking {
  gameId: WeplayGameId;
  category: string;
  rows: {
    rank: number;
    classLabel?: string;
    studentLabel: string;
    studentName?: string;
    studentNumber?: string;
    studentId?: string;
    score: number;
    isMe: boolean;
  }[];
  updatedAtMs: number;
  scoreLabel: string;
  limit?: number;
  period?: { startsAtMs: number; endsAtMs: number };
  trackingSinceMs?: number;
  classes?: { id: string; label: string }[];
  selectedClassId?: string;
  view?: "all" | "class";
  week?: { id: string; startsAtMs: number; endsAtMs: number };
}

export function getWeplayRankingWeek(now = Date.now()) {
  const kst = new Date(now + 9 * 60 * 60 * 1000);
  const mondayOffset = (kst.getUTCDay() + 6) % 7;
  const startsAtMs =
    Date.UTC(
      kst.getUTCFullYear(),
      kst.getUTCMonth(),
      kst.getUTCDate() - mondayOffset,
    ) -
    9 * 60 * 60 * 1000;
  return { startsAtMs, endsAtMs: startsAtMs + 7 * 24 * 60 * 60 * 1000 };
}

export interface WeplayRankingSelection {
  view: "all" | "class";
  classId?: string;
  includeClasses?: boolean;
}

const CACHE_MS = 60_000;
const MAX_CACHED_RANKINGS = 48;
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
  selection: WeplayRankingSelection = { view: "all" },
) {
  if (activeScope !== scope) {
    activeScope = scope;
    generation++;
    cache.clear();
    pending.clear();
  }
  const week = getWeplayRankingWeek();
  const key = `${gameId}/${category}/${week.startsAtMs}/${selection.view}/${selection.classId || "default"}`;
  const saved = cache.get(key);
  if (
    saved &&
    saved.expires > Date.now() &&
    (!selection.includeClasses || saved.value.classes)
  )
    return Promise.resolve(saved.value);
  const existing = pending.get(key);
  if (existing) return existing;
  const startedGeneration = generation;
  const request = call<WeplayRanking>("getWeplayRanking", config, {
    gameId,
    category,
    ...selection,
    refresh: invalidated.has(gameId),
  })
    .then((value) => {
      if (startedGeneration === generation) {
        cache.set(key, {
          value,
          expires: Math.min(
            Date.now() + CACHE_MS,
            week.endsAtMs,
            value.period?.endsAtMs ?? week.endsAtMs,
          ),
        });
        while (cache.size > MAX_CACHED_RANKINGS)
          cache.delete(cache.keys().next().value!);
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
export interface RhythmChallengeState {
  weekId: string;
  week: { id: string; startsAtMs: number; endsAtMs: number };
  songId: string;
  automaticSongId: string;
  selection: "automatic" | "manual";
  allowedDifficulties: ("normal" | "hard")[];
  missLimit: number;
  revision: number;
  dailyFreeLimit: number;
  paidCost: number;
  freeRemaining: number;
  dailyUsed: number;
  dayId: string;
  preview: boolean;
}
export const getRhythmChallengeState = (config: WeplayConfig) =>
  call<RhythmChallengeState>("getRhythmChallengeState", config, {});
export const saveRhythmChallengeSettings = (
  config: WeplayConfig,
  data: {
    weekId: string;
    selection: "automatic" | "manual";
    songId: string;
    missLimit: number;
    expectedRevision: number;
    requestId: string;
  },
) =>
  call<
    Omit<
      RhythmChallengeState,
      "freeRemaining" | "dailyUsed" | "dayId" | "preview"
    >
  >("saveRhythmChallengeSettings", config, data);
export const startRhythmRankingGame = (
  config: WeplayConfig,
  data: {
    songId: string;
    difficulty: string;
    requestId: string;
    paid: boolean;
  },
) =>
  call<{
    sessionId: string;
    songId: string;
    difficulty: "normal" | "hard";
    missLimit: number;
    weekId: string;
    freeRemaining: number;
    chargedCost: number;
  }>("startRhythmRankingGame", config, { ...data, challengeVersion: 1 });
export const finishRhythmRankingGame = async (
  config: WeplayConfig,
  data: { sessionId: string; events: RhythmRankingEvent[]; endTime: number },
) => {
  const result = await call<{ score: number; rankingSkipped?: boolean }>(
    "finishRhythmRankingGame",
    config,
    data,
  );
  invalidateWeplayRanking("gungdeok-rock");
  return result;
};
