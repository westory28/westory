import type { PointRankPolicy, WisHallOfFameSnapshot } from "../types";
import {
  getPointRankAllowedEmojiIds,
  getPointRankDisplay,
  getPointRankEmojiEntryById,
  getPointRankEmojiEntryByValue,
} from "./pointRanks";

// A saved profile preference never grants an unlock in a different semester.
export const resolveStudentProfileEmoji = (
  rankPolicy: PointRankPolicy,
  earnedTotal: number,
  profile: { profileEmojiId?: string; profileIcon?: string } | null,
) => {
  const rank = getPointRankDisplay({
    rankPolicy,
    wallet: {
      earnedTotal: Number.isSafeInteger(earnedTotal)
        ? Math.max(0, earnedTotal)
        : 0,
    },
  });
  const allowedEmojiIds = getPointRankAllowedEmojiIds(
    rankPolicy,
    rank?.tierCode,
  );
  const stored = profile?.profileEmojiId
    ? getPointRankEmojiEntryById(rankPolicy, profile.profileEmojiId)
    : getPointRankEmojiEntryByValue(rankPolicy, profile?.profileIcon || "");
  const selected =
    stored && allowedEmojiIds.includes(stored.id) ? stored : null;
  const fallback = getPointRankEmojiEntryById(
    rankPolicy,
    rankPolicy.emojiPolicy.defaultEmojiId,
  );
  const entry =
    selected ||
    (fallback && allowedEmojiIds.includes(fallback.id)
      ? fallback
      : getPointRankEmojiEntryById(rankPolicy, allowedEmojiIds[0] || ""));
  return { rank, allowedEmojiIds, entry };
};

export const resolveStudentHallProfileEmojis = (
  snapshot: WisHallOfFameSnapshot,
  rankPolicy: PointRankPolicy,
): WisHallOfFameSnapshot => {
  const result = { ...snapshot };
  for (const key of [
    "gradeTop3ByGrade",
    "classTop3ByClassKey",
    "gradeLeaderboardByGrade",
    "classLeaderboardByClassKey",
  ] as const) {
    result[key] = Object.fromEntries(
      Object.entries(snapshot[key]).map(([scope, entries]) => [
        scope,
        entries.map((entry) => ({
          ...entry,
          profileIcon:
            resolveStudentProfileEmoji(
              rankPolicy,
              entry.earnedTotal ?? 0,
              entry,
            ).entry?.emoji || "😀",
        })),
      ]),
    );
  }
  return result;
};
