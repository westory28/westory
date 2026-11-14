import { auth } from "./firebase";
import { getPointsRevision } from "./appEvents";
import { getAvatarRevision } from "../features/avatar/events";
import { isSemesterArchive } from "./semesterArchive";
import { resolvePointRankPolicy } from "./pointRanks";
import {
  assertWisOwner,
  callWisService,
  wisHallOfFame,
  wisSemesterId,
  type WisConfig,
  type WisState,
} from "./wisEconomyClient";
import type { PointRankPolicy } from "../types";

export type WisRankingMetric = "cumulative" | "current";
export type WisRankingClass = {
  key: string;
  grade: string;
  classNumber: string;
};
type RankingState = WisState & {
  rankPolicy?: Partial<PointRankPolicy>;
  rankingClasses?: WisRankingClass[];
};
const flights = new WeakMap<
  NonNullable<typeof auth.currentUser>,
  Map<string, Promise<RankingState>>
>();
type PreviewCache = {
  generation: number;
  entries: Map<string, { state: RankingState; expiresAt: number }>;
};
const previews = new WeakMap<
  NonNullable<typeof auth.currentUser>,
  PreviewCache
>();
const PREVIEW_TTL_MS = 30_000;
const PREVIEW_CACHE_LIMIT = 24;

// Successful previews may paint immediately for 30 seconds, but every visit still
// makes an authorization-checked server read. No browser storage or prefetch.
const getWisRankingState = async (
  config: WisConfig,
  audience: "student" | "teacher",
  projection: "ranking-preview" | "hall-of-fame" | "hall-view",
  selection?: { view: "grade" | "class"; gradeKey: string; classKey: string },
  ranking?: { metric: WisRankingMetric; classKey: string },
  cache?: { permissionKey: string; onCached?: (state: RankingState) => void },
) => {
  const user = auth.currentUser;
  assertWisOwner(user?.uid || "");
  if (!user) throw new Error("로그인 상태를 확인해 주세요.");
  let epoch: number;
  try {
    epoch = Number((await user.getIdTokenResult()).claims.auth_time);
  } catch (error) {
    previews.delete(user);
    throw error;
  }
  if (auth.currentUser !== user || !Number.isFinite(epoch)) {
    previews.delete(user);
    throw new Error("로그인 상태가 바뀌었습니다.");
  }
  const semesterId = wisSemesterId(config);
  const source =
    audience === "teacher" && isSemesterArchive ? "EXPLICIT" : "CURRENT";
  const selectionKey = selection
    ? JSON.stringify([selection.view, selection.gradeKey, selection.classKey])
    : "";
  const key = `${epoch}:${semesterId}:${audience}:${source}:${projection}:${selectionKey}:${ranking?.metric || ""}:${ranking?.classKey || ""}:${getPointsRevision()}:${getAvatarRevision()}:${cache?.permissionKey || ""}`;
  let bucket = previews.get(user);
  if (!bucket) {
    bucket = { generation: 0, entries: new Map() };
    previews.set(user, bucket);
  }
  for (const [cachedKey, entry] of bucket.entries) {
    if (entry.expiresAt <= Date.now()) bucket.entries.delete(cachedKey);
  }
  const generation = bucket.generation;
  const cached = projection === "ranking-preview" && bucket.entries.get(key);
  if (cached) cache?.onCached?.(cached.state);
  let pending = flights.get(user);
  if (!pending) {
    pending = new Map();
    flights.set(user, pending);
  }
  let flight = pending.get(key);
  if (!flight) {
    flight = callWisService<RankingState>("getWisRankingPreview", {
      audience,
      semesterId,
      source,
      projection,
      limit: projection === "ranking-preview" ? 5 : 20,
      ...(ranking
        ? { rankingMetric: ranking.metric, rankingClassKey: ranking.classKey }
        : {}),
      ...(selection
        ? {
            hallView: selection.view,
            hallGradeKey: selection.gradeKey,
            hallClassKey: selection.classKey,
          }
        : {}),
    });
    pending.set(key, flight);
  }
  try {
    const state = await flight;
    if (auth.currentUser !== user || state.semesterId !== semesterId)
      throw new Error("계정이나 학기가 바뀌었습니다. 다시 확인해 주세요.");
    if (projection === "ranking-preview" && bucket.generation === generation) {
      bucket.entries.delete(key);
      bucket.entries.set(key, {
        state,
        expiresAt: Date.now() + PREVIEW_TTL_MS,
      });
      while (bucket.entries.size > PREVIEW_CACHE_LIMIT)
        bucket.entries.delete(bucket.entries.keys().next().value!);
    }
    return state;
  } catch (error) {
    // A failed authorization or refresh invalidates every cached selection for
    // this SDK identity, including older in-flight writes to the cache.
    bucket.entries.clear();
    bucket.generation++;
    throw error;
  } finally {
    if (pending.get(key) === flight) pending.delete(key);
  }
};

const projectPreview = (state: RankingState) => ({
  snapshot: wisHallOfFame(state),
  rankPolicy: resolvePointRankPolicy(state.rankPolicy),
  classes: state.rankingClasses || [],
});
export type WisRankingPreviewResult = ReturnType<typeof projectPreview>;

export const getWisRankingPreview = async (
  config: WisConfig,
  audience: "student" | "teacher",
  ranking?: { metric: WisRankingMetric; classKey: string },
  options?: {
    permissionKey: string;
    onCached?: (result: WisRankingPreviewResult) => void;
  },
) => {
  const state = await getWisRankingState(
    config,
    audience,
    "ranking-preview",
    undefined,
    ranking,
    options && {
      permissionKey: options.permissionKey,
      onCached: (state) => options.onCached?.(projectPreview(state)),
    },
  );
  return projectPreview(state);
};

// The complete hall shares the existing warm, read-only callable. Pending
// requests are isolated from the dashboard's five-entry preview.
export const getWisHallOfFameState = (
  config: WisConfig,
  audience: "student" | "teacher",
) =>
  getWisRankingState(config, audience, "hall-of-fame", undefined, {
    metric: "cumulative",
    classKey: "",
  });

export const getWisHallOfFameView = async (
  config: WisConfig,
  audience: "student" | "teacher",
  selection: { view: "grade" | "class"; gradeKey: string; classKey: string },
) =>
  wisHallOfFame(
    await getWisRankingState(
      config,
      audience,
      "hall-view",
      {
        view: selection.view,
        gradeKey: selection.view === "grade" ? selection.gradeKey : "",
        classKey: selection.view === "class" ? selection.classKey : "",
      },
      { metric: "cumulative", classKey: "" },
    ),
  );
