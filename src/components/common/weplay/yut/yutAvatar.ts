import type { AvatarLook } from "../../../../features/avatar/catalog";

/** The eight actions every Yut piece plays, animal or avatar. */
export const YUT_PIECE_ACTIONS = [
  "idle",
  "walk",
  "carry",
  "boarding",
  "win",
  "lose",
  "caught",
  "pair-caught",
] as const;
export type YutPieceAction = (typeof YUT_PIECE_ACTIONS)[number];
/** Source rectangle in the sheet, then its place in the action's square. */
export type YutPieceFrame = readonly [
  x: number,
  y: number,
  width: number,
  height: number,
  dx: number,
  dy: number,
];
/**
 * One player's baked frames, in the same shape as a row of
 * yutCharacterFrames.json: three complete drawings per action.
 */
export type YutAvatarSheet = {
  url: string;
  /** Sheet pixels per sprite pixel. */
  scale: 1 | 2;
  /** Sheet size in sprite pixels, the unit of every frame record. */
  width: number;
  height: number;
  actions: Record<
    YutPieceAction,
    { size: number; frames: readonly YutPieceFrame[] }
  >;
};
export type YutAvatarSheets = Readonly<Record<string, YutAvatarSheet>>;
export type YutCastLooks = Readonly<Record<string, AvatarLook>>;
export type YutPieceChoice = "avatar" | "classic";
