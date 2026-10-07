import { getHttpsCallable } from "./firebase";
import { getYearSemester } from "./semesterScope";
import type { SystemConfig } from "../types";
import { DEFAULT_WEPLAY_GAME_TITLE } from "./weplayTitle";

export type WeplayConfig =
  | Pick<SystemConfig, "year" | "semester">
  | null
  | undefined;
export type WeplayDifficulty = "mild" | "medium" | "spicy";
export const WEPLAY_DIFFICULTY_LABELS: Record<WeplayDifficulty, string> = {
  mild: "착한맛",
  medium: "중간맛",
  spicy: "매운맛",
};
export interface WeplayRankRewards {
  first: number;
  second: number;
  third: number;
}
export interface WeplayPolicy {
  enabled: boolean;
  challengeCost: number;
  dailyChallengeLimit: number;
  resultRewards: { minCorrect: number; amount: number }[];
  rankingPeriod: "weekly" | "monthly";
  rankingRewards: Record<WeplayDifficulty, WeplayRankRewards>;
  version?: number;
}
export interface WeplayPeriod {
  id: string;
  startsAtMs: number;
  endsAtMs: number;
  rankingPeriod: "weekly" | "monthly";
  rankingRewards: WeplayPolicy["rankingRewards"];
  status: "open" | "closed";
}
export interface WeplayWord {
  id: string;
  text: string;
  unitId: string;
  lessonTitle: string;
  context: string;
  stage: 1 | 2 | 3;
  spawnAtMs: number;
  fallDurationMs: number;
  kind?: "normal" | "special";
  tactic?: "crane-wing" | "last-stand";
}
export interface WeplayAcceptedEvent {
  wordId: string;
  elapsedMs: number;
}
export interface WeplayBattleState {
  playerHp: number;
  enemyHp: number;
  ammo: number;
  cannonShots: number;
  specialCount: number;
  sunkShips: number;
  damageDealt: number;
  enemyShots: number;
  nextEnemyAttackAtMs: number;
  defeatAtMs: number | null;
  outcome: "active" | "victory" | "defeat";
  score: number;
  normalCorrectCount: number;
  rewardCorrectCount: number;
}
export interface WeplayResult {
  sessionId: string;
  difficulty: WeplayDifficulty;
  mode: "practice" | "challenge";
  correctCount: number;
  totalWords: number;
  score: number;
  reward: number;
  cost: number;
  netWis: number;
  balance: number;
  finishedAtMs: number;
  missedWords: WeplayWord[];
  battleVersion?: 1;
  battle?: WeplayBattleState;
  rewardCorrectCount?: number;
  endedEarly?: boolean;
}
export interface WeplaySession {
  id: string;
  difficulty: WeplayDifficulty;
  mode: "practice" | "challenge";
  status: "active" | "finished";
  startsAtMs: number;
  endsAtMs: number;
  words: WeplayWord[];
  acceptedWordIds: string[];
  correctCount: number;
  policy: WeplayPolicy;
  result: WeplayResult | null;
  serverNowMs: number;
  difficultySettings?: WeplayDifficultySettings;
  battleVersion?: 1;
  acceptedEvents?: WeplayAcceptedEvent[];
  battle?: WeplayBattleState;
}
export interface WeplayLobby {
  gameEnabled?: boolean;
  difficulties?: Record<WeplayDifficulty, WeplayDifficultySettings>;
  challengeDifficulties?: Record<WeplayDifficulty, WeplayDifficultySettings>;
  wordCountsByDifficulty?: Record<WeplayDifficulty, number>;
  challengeWordCountsByDifficulty?: Record<WeplayDifficulty, number>;
  policy: WeplayPolicy;
  balance: number;
  dailyUsed: number;
  dailyRemaining: number;
  lessons: {
    unitId: string;
    title: string;
    wordCount: number;
    wordCountsByDifficulty?: Record<WeplayDifficulty, number>;
  }[];
  wordCount: number;
  activeSession: WeplaySession | null;
  records: WeplayResult[];
  period: WeplayPeriod | null;
  rankingByDifficulty: Record<
    WeplayDifficulty,
    {
      rank: number;
      studentLabel: string;
      score: number;
      correctCount: number;
      isMe: boolean;
    }[]
  >;
  serverNowMs: number;
}
export interface WeplayPolicyResponse {
  policy: WeplayPolicy;
  currentRankingPeriod: WeplayPeriod | null;
}
export interface WeplayAnswerResponse {
  accepted: boolean;
  reason?: string;
  correctCount: number;
  acceptedWordIds: string[];
  serverNowMs: number;
  acceptedEvents?: WeplayAcceptedEvent[];
  battle?: WeplayBattleState;
}
async function call<T>(
  name: string,
  config: WeplayConfig,
  data: object = {},
): Promise<T> {
  if (!config?.year || !config?.semester)
    throw new Error("현재 학기를 확인하지 못했습니다. 새로고침해 주세요.");
  const fn = await getHttpsCallable<object, T>(name);
  return (await fn({ ...getYearSemester(config), ...data })).data;
}
export const getWeplayLobby = (config: WeplayConfig) =>
  call<WeplayLobby>("getWeplayLobby", config);
export const getWeplayPolicy = (config: WeplayConfig) =>
  call<WeplayPolicyResponse>("getWeplayPolicy", config);
export const saveWeplayPolicy = (config: WeplayConfig, policy: WeplayPolicy) =>
  call<WeplayPolicyResponse>("saveWeplayPolicy", config, { policy });
export const startWeplayGame = (
  config: WeplayConfig,
  data: {
    mode: WeplaySession["mode"];
    difficulty: WeplayDifficulty;
    requestKey: string;
    unitIds?: string[];
  },
) => call<WeplaySession>("startWeplayGame", config, data);
export const submitWeplayAnswer = (
  config: WeplayConfig,
  data: { sessionId: string; eventId: string; wordId: string; answer: string },
) => call<WeplayAnswerResponse>("submitWeplayAnswer", config, data);
export interface WeplayFinishOptions {
  exitEarly?: boolean;
}
export const finishWeplayGame = (
  config: WeplayConfig,
  sessionId: string,
  options?: WeplayFinishOptions,
) => call<WeplayResult>("finishWeplayGame", config, { sessionId, ...options });

export const WEPLAY_GAMES = [
  { id: "history-rain", name: DEFAULT_WEPLAY_GAME_TITLE },
] as const;
export const getWeplayNormalWordCount = (durationSeconds: number) =>
  Math.round((durationSeconds * 2) / 3);
export type WeplayGameId = (typeof WEPLAY_GAMES)[number]["id"];
export interface WeplayDifficultySettings {
  durationSeconds: number;
  fallSeconds: [number, number, number];
  minWordLength: number;
  maxWordLength: number;
}
export const DEFAULT_WEPLAY_DIFFICULTIES: Record<
  WeplayDifficulty,
  WeplayDifficultySettings
> = {
  mild: {
    durationSeconds: 90,
    fallSeconds: [12, 10, 8],
    minWordLength: 1,
    maxWordLength: 12,
  },
  medium: {
    durationSeconds: 90,
    fallSeconds: [10, 8, 6],
    minWordLength: 1,
    maxWordLength: 12,
  },
  spicy: {
    durationSeconds: 90,
    fallSeconds: [8, 6, 4],
    minWordLength: 1,
    maxWordLength: 12,
  },
};
export interface WeplayGameSettings {
  enabled: boolean;
  sourceMode: "all" | "selected";
  unitIds: string[];
  excludedWords: string[];
  customWords: string[];
  difficulties: Record<WeplayDifficulty, WeplayDifficultySettings>;
  version?: number;
}
export const normalizeWeplayGameSettings = (
  settings: WeplayGameSettings,
): WeplayGameSettings => ({
  ...settings,
  excludedWords: settings.excludedWords || [],
  customWords: settings.customWords || [],
  difficulties: Object.fromEntries(
    (Object.keys(DEFAULT_WEPLAY_DIFFICULTIES) as WeplayDifficulty[]).map(
      (difficulty) => [
        difficulty,
        {
          ...DEFAULT_WEPLAY_DIFFICULTIES[difficulty],
          ...settings.difficulties?.[difficulty],
          durationSeconds: Math.max(
            90,
            settings.difficulties?.[difficulty]?.durationSeconds || 90,
          ),
          fallSeconds: [
            ...(settings.difficulties?.[difficulty]?.fallSeconds ||
              DEFAULT_WEPLAY_DIFFICULTIES[difficulty].fallSeconds),
          ],
        },
      ],
    ),
  ) as WeplayGameSettings["difficulties"],
});
export interface WeplayManagement {
  settings: WeplayGameSettings;
  lessons: {
    unitId: string;
    title: string;
    isVisibleToStudents: boolean;
    wordCount: number;
    words: string[];
  }[];
  availableWordCount: number;
  previewWordCount: number;
}
export const getWeplayManagement = (
  config: WeplayConfig,
  gameId: WeplayGameId,
) => call<WeplayManagement>("getWeplayManagement", config, { gameId });
export const saveWeplayGameSettings = (
  config: WeplayConfig,
  gameId: WeplayGameId,
  settings: WeplayGameSettings,
) =>
  call<WeplayManagement>("saveWeplayGameSettings", config, {
    gameId,
    settings,
  });
export const previewWeplayGame = (
  config: WeplayConfig,
  gameId: WeplayGameId,
  difficulty: WeplayDifficulty,
  unitIds: string[],
  settings?: WeplayGameSettings,
) =>
  call<WeplaySession>("previewWeplayGame", config, {
    gameId,
    difficulty,
    unitIds,
    ...(settings ? { settings } : {}),
  });

export const normalizeWeplayAnswer = (text: string) =>
  text.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase();
export const weplayErrorMessage = (error: unknown, fallback: string) => {
  const code = String((error as { code?: string })?.code || "");
  if (/unavailable|deadline-exceeded|network/.test(code))
    return "연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.";
  if (/unauthenticated/.test(code))
    return "로그인 상태를 확인한 뒤 다시 시도해 주세요.";
  if (error instanceof Error && error.message && error.message !== "internal")
    return error.message;
  return fallback;
};
