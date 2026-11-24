import { useCallback, useEffect, useMemo, useState } from "react";
import type { AvatarLook } from "../../../../features/avatar/catalog";
// Read through the namespace: a service without the cast view (an earlier
// bundle, a test double) then simply fails like any other cast failure.
import * as yutService from "../../../../lib/yut";
import type { WeplayConfig } from "../../../../lib/weplay";
import type {
  YutAvatarSheet,
  YutAvatarSheets,
  YutCastLooks,
  YutPieceChoice,
} from "./yutAvatar";

type CastAnswer = { looks: YutCastLooks; piece?: YutPieceChoice };
const NOBODY: CastAnswer = { looks: {} };
const NO_SHEETS: YutAvatarSheets = {};

/** An earlier deployment has no cast view: animal pieces for this page load. */
let unsupported = false;
/** One answer per room, or per account without a room, while it covers the players shown. */
const answers = new Map<
  string,
  { covers: ReadonlySet<string>; answer: Promise<CastAnswer | null> }
>();
/** Baked frames by look, shared by every place and room that shows that look. */
type BakedSheet = {
  users: number;
  sheet: Promise<YutAvatarSheet>;
  url?: string;
};
const baked = new Map<string, BakedSheet>();
const KEPT_ANSWERS = 8;
const KEPT_SHEETS = 12;

const savesData = () =>
  Boolean(
    (navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection?.saveData,
  );
const lookKey = (look: AvatarLook) =>
  JSON.stringify(
    Object.keys(look)
      .sort()
      .map((slot) => [slot, look[slot as keyof AvatarLook]]),
  );

/** Any failure answers null; the caller keeps the animal pieces. */
async function ask(
  config: WeplayConfig,
  roomId: string | undefined,
): Promise<CastAnswer | null> {
  if (unsupported) return null;
  try {
    const response = await yutService.getYutCast(config, roomId);
    const looks: Record<string, AvatarLook> = {};
    for (const [uid, entry] of Object.entries(response?.cast || {}))
      if (entry?.look && typeof entry.look === "object")
        looks[uid] = entry.look;
    return {
      looks,
      ...(response?.piece === "avatar" || response?.piece === "classic"
        ? { piece: response.piece }
        : {}),
    };
  } catch (error) {
    if (
      String((error as { code?: string })?.code || "").replace(
        /^functions\//,
        "",
      ) === "invalid-argument"
    )
      unsupported = true;
    return null;
  }
}

function retainSheet(look: AvatarLook) {
  const key = lookKey(look);
  let entry = baked.get(key);
  if (!entry) {
    const created: BakedSheet = {
      users: 0,
      // The drawing code is its own chunk: only a match that shows an avatar loads it.
      sheet: import("./yutAvatarSheet").then((module) =>
        // Dense screens enlarge sprite pixels as they are; others get a doubled
        // sheet so large portraits scale down smoothly.
        module.bakeYutAvatarSheet(look, window.devicePixelRatio >= 2 ? 1 : 2),
      ),
    };
    created.sheet.then(
      (sheet) => {
        created.url = sheet.url;
      },
      () => {
        if (baked.get(key) === created) baked.delete(key);
      },
    );
    baked.set(key, created);
    entry = created;
    // Frames nobody shows any more give their memory back, oldest first.
    for (const [other, unused] of baked) {
      if (baked.size <= KEPT_SHEETS) break;
      if (unused.users || !unused.url) continue;
      URL.revokeObjectURL(unused.url);
      baked.delete(other);
    }
  }
  entry.users += 1;
  return { key, sheet: entry.sheet };
}
function releaseSheet(key: string) {
  const entry = baked.get(key);
  if (entry) entry.users -= 1;
}

/**
 * Who is drawn as their avatar, asked once whenever the players of a room
 * change (never per command, never polled) and baked off the critical path.
 * Whatever is missing, refused, unsupported, still baking or switched off by
 * data saving stays an animal piece; nothing here can hold up play.
 */
export function useYutCast({
  config,
  scope,
  uid,
  room,
  self = false,
}: {
  config: WeplayConfig | null | undefined;
  /** The signed-in account and semester. */
  scope: string;
  uid: string;
  /** The room whose players are shown, if any. */
  room: { id: string; players: { uid: string; active: boolean }[] } | null;
  /** Without a room, ask for the caller's own piece (a student's own match). */
  self?: boolean;
}) {
  const roomId = room?.id;
  const players = room
    ? room.players
        .filter((player) => player.active)
        .map((player) => player.uid)
        .sort()
        .join(",")
    : "";
  const key = roomId || self ? `${scope}|${roomId || ""}` : "";
  const [refresh, setRefresh] = useState(0);
  const [answered, setAnswered] = useState<{
    key: string;
    answer: CastAnswer;
  } | null>(null);
  const [ready, setReady] = useState<
    Record<string, { look: string; sheet: YutAvatarSheet }>
  >({});
  const year = config?.year,
    semester = config?.semester;

  useEffect(() => {
    if (!key || !year || !semester || !uid || savesData()) return;
    let active = true;
    let timer: number | undefined;
    const shown = players ? players.split(",") : [];
    const known = answers.get(key);
    const read = () => {
      let entry = answers.get(key);
      if (!entry || shown.some((player) => !entry!.covers.has(player))) {
        const created = {
          covers: new Set(shown),
          answer: ask({ year, semester }, roomId),
        };
        // A failure is not remembered: the next change of players asks again.
        void created.answer.then((answer) => {
          if (!answer && answers.get(key) === created) answers.delete(key);
        });
        answers.delete(key);
        answers.set(key, created);
        for (const other of answers.keys()) {
          if (answers.size <= KEPT_ANSWERS) break;
          answers.delete(other);
        }
        entry = created;
      }
      void entry.answer.then((answer) => {
        if (active) setAnswered({ key, answer: answer || NOBODY });
      });
    };
    // Players arriving one after another are asked about together.
    if (known && shown.some((player) => !known.covers.has(player)))
      timer = window.setTimeout(read, 600);
    else read();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [key, players, roomId, year, semester, uid, refresh]);

  const answer = answered?.key === key ? answered.answer : NOBODY;
  useEffect(() => {
    const looks = Object.entries(answer.looks);
    if (!looks.length) return;
    let active = true;
    const held: string[] = [];
    for (const [player, look] of looks) {
      const { key: look_, sheet } = retainSheet(look);
      held.push(look_);
      sheet.then(
        (value) => {
          if (active)
            setReady((previous) =>
              previous[player]?.sheet === value
                ? previous
                : { ...previous, [player]: { look: look_, sheet: value } },
            );
        },
        () => {
          /* This player keeps the animal piece. */
        },
      );
    }
    return () => {
      active = false;
      held.forEach(releaseSheet);
    };
  }, [answer]);

  const sheets = useMemo(() => {
    const result: Record<string, YutAvatarSheet> = {};
    for (const [player, look] of Object.entries(answer.looks)) {
      const entry = ready[player];
      if (entry && entry.look === lookKey(look)) result[player] = entry.sheet;
    }
    return Object.keys(result).length ? result : NO_SHEETS;
  }, [answer, ready]);

  /** Saves the caller's own choice, then asks again. Rejects with the server's reason. */
  const choose = useCallback(
    async (piece: YutPieceChoice) => {
      if (!year || !semester) return;
      await yutService.setYutPiece({ year, semester }, piece);
      for (const other of [...answers.keys()])
        if (other.startsWith(`${scope}|`)) answers.delete(other);
      // Shown at once; the look itself arrives with the next answer.
      setAnswered((previous) => {
        if (!previous) return previous;
        const looks = { ...previous.answer.looks };
        if (piece === "classic") delete looks[uid];
        return { key: previous.key, answer: { looks, piece } };
      });
      setRefresh((value) => value + 1);
    },
    [scope, uid, year, semester],
  );
  return { sheets, piece: answer.piece, choose };
}
