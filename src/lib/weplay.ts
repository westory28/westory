import { getHttpsCallable } from "./firebase";
import { getYearSemester } from "./semesterScope";
import type { SystemConfig } from "../types";

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
}
export interface WeplayLobby {
  gameEnabled?: boolean;
  policy: WeplayPolicy;
  balance: number;
  dailyUsed: number;
  dailyRemaining: number;
  lessons: { unitId: string; title: string; wordCount: number }[];
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
export const finishWeplayGame = (config: WeplayConfig, sessionId: string) =>
  call<WeplayResult>("finishWeplayGame", config, { sessionId });

export const WEPLAY_GAMES = [
  { id: "history-rain", name: "역사가 내려와" },
] as const;
export type WeplayGameId = (typeof WEPLAY_GAMES)[number]["id"];
export interface WeplayGameSettings {
  enabled: boolean;
  sourceMode: "all" | "selected";
  unitIds: string[];
  version?: number;
}
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
) =>
  call<WeplaySession>("previewWeplayGame", config, {
    gameId,
    difficulty,
    unitIds,
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
