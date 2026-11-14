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

// Share concurrent mounts only. Every new visit checks server authorization;
// student names, rankings and policy are never persisted in browser storage.
const getWisRankingState = async (
  config: WisConfig,
  audience: "student" | "teacher",
  projection: "ranking-preview" | "hall-of-fame" | "hall-view",
  selection?: { view: "grade" | "class"; gradeKey: string; classKey: string },
  ranking?: { metric: WisRankingMetric; classKey: string },
) => {
  const user = auth.currentUser;
  assertWisOwner(user?.uid || "");
  if (!user) throw new Error("로그인 상태를 확인해 주세요.");
  const epoch = Number((await user.getIdTokenResult()).claims.auth_time);
  if (auth.currentUser !== user || !Number.isFinite(epoch))
    throw new Error("로그인 상태가 바뀌었습니다.");
  const semesterId = wisSemesterId(config);
  const source =
    audience === "teacher" && isSemesterArchive ? "EXPLICIT" : "CURRENT";
  const selectionKey = selection
    ? JSON.stringify([selection.view, selection.gradeKey, selection.classKey])
    : "";
  const key = `${epoch}:${semesterId}:${audience}:${source}:${projection}:${selectionKey}:${ranking?.metric || ""}:${ranking?.classKey || ""}:${getPointsRevision()}:${getAvatarRevision()}`;
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
    return state;
  } finally {
    if (pending.get(key) === flight) pending.delete(key);
  }
};

export const getWisRankingPreview = async (
  config: WisConfig,
  audience: "student" | "teacher",
  ranking?: { metric: WisRankingMetric; classKey: string },
) => {
  const state = await getWisRankingState(
    config,
    audience,
    "ranking-preview",
    undefined,
    ranking,
  );
  return {
    snapshot: wisHallOfFame(state),
    rankPolicy: resolvePointRankPolicy(state.rankPolicy),
    classes: state.rankingClasses || [],
  };
};

// The complete hall shares the existing warm, read-only callable. Pending
// requests are isolated from the dashboard's five-entry preview.
export const getWisHallOfFameState = (
  config: WisConfig,
  audience: "student" | "teacher",
) => getWisRankingState(config, audience, "hall-of-fame");

export const getWisHallOfFameView = async (
  config: WisConfig,
  audience: "student" | "teacher",
  selection: { view: "grade" | "class"; gradeKey: string; classKey: string },
) =>
  wisHallOfFame(
    await getWisRankingState(config, audience, "hall-view", {
      view: selection.view,
      gradeKey: selection.view === "grade" ? selection.gradeKey : "",
      classKey: selection.view === "class" ? selection.classKey : "",
    }),
  );
