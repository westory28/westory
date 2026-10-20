import { auth } from "./firebase";
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

type RankingState = WisState & { rankPolicy?: Partial<PointRankPolicy> };
const flights = new WeakMap<
  NonNullable<typeof auth.currentUser>,
  Map<string, Promise<RankingState>>
>();

// Share concurrent mounts only. Every new visit checks server authorization;
// student names, rankings and policy are never persisted in browser storage.
export const getWisRankingPreview = async (
  config: WisConfig,
  audience: "student" | "teacher",
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
  const key = `${epoch}:${semesterId}:${audience}:${source}`;
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
      projection: "ranking-preview",
      limit: 5,
    });
    pending.set(key, flight);
  }
  try {
    const state = await flight;
    if (auth.currentUser !== user || state.semesterId !== semesterId)
      throw new Error("계정이나 학기가 바뀌었습니다. 다시 확인해 주세요.");
    return {
      snapshot: wisHallOfFame(state),
      rankPolicy: resolvePointRankPolicy(state.rankPolicy),
    };
  } finally {
    if (pending.get(key) === flight) pending.delete(key);
  }
};
