import type {
  AvatarLook,
  AvatarSlot,
} from "../../../../features/avatar/catalog";
import {
  drawMinimi,
  MINIMI_HEIGHT,
  MINIMI_VALUES,
  MINIMI_WIDTH,
  type MinimiMotion,
} from "../../../../features/avatar/minimi/draw";
import {
  YUT_PIECE_ACTIONS,
  type YutAvatarSheet,
  type YutPieceAction,
  type YutPieceFrame,
} from "./yutAvatar";

/**
 * One minimi in one frame. Everything it does comes from the avatar rig: a
 * pose, a face and whole-pixel movement of the body parts, so every garment
 * follows. `at` only says where the finished figure stands in the frame.
 */
type Figure = {
  pose?: "mm-idle" | "mm-wave" | "mm-cheer";
  /** Omitted: the face the student saved. */
  expression?: string;
  blink?: boolean;
  motion?: MinimiMotion;
  at?: readonly [number, number];
  /** The carried piece: seen above the one that carries it, body hidden behind. */
  riding?: boolean;
};
/** Figures are painted back to front. */
type Frame = readonly Figure[];

/** The first row under the shoes; every item paints rows 1 to 104. */
const FEET = 105;
/** The top of the hair. Rows above it hold only hats, buns and ribbons. */
const CROWN = 12;
/** The highest row a hat reaches. */
const HAT = 1;
/** Under the chin: a carried piece shows its whole face above the carrier. */
const CHIN = 54;
/** Rows of the action's square left under the feet, so the piece stands on its base. */
const GROUND = 3;
/** Rows a lone figure may leap. */
const LEAP = 8;
/** Columns a second figure may stand to either side of the first. */
const REACH = 28;
/** A carried piece is painted down to its chest; the rest is behind the carrier. */
const RIDER_ROWS = 66;
/** Transparent columns and rows that keep scaled neighbours out of a frame. */
const GUTTER = 4;

const slumped = (lean: -2 | -1 | 1 | 2): MinimiMotion => ({
  crouch: 3,
  body: [0, 2],
  head: [lean, 2],
});

/**
 * Three complete drawings per action, played by the same CSS frame steps as the
 * animal pieces. The rig cannot turn a body, so nobody lies down: a fall ends
 * crouched low with the head dropped. `ride` is how far the carried piece
 * stands above the one that carries it.
 */
const framesFor = (
  ride: number,
): Record<YutPieceAction, readonly [Frame, Frame, Frame]> => {
  const rider = (sink: number, extra: Figure = {}): Figure => ({
    pose: "mm-cheer",
    expression: "mm-bright",
    riding: true,
    at: [0, sink - ride],
    ...extra,
  });
  return {
    idle: [[{}], [{ motion: { crouch: 1, head: [0, 1] } }], [{ blink: true }]],
    walk: [
      [{ at: [0, -2], motion: { feet: [3, 0], body: [1, 0], head: [1, 0] } }],
      [{ motion: { crouch: 2 } }],
      [{ at: [0, -2], motion: { feet: [0, 3], body: [-1, 0], head: [-1, 0] } }],
    ],
    carry: [
      [rider(1), { motion: { crouch: 1, feet: [2, 0] } }],
      [rider(3), { motion: { crouch: 3 } }],
      [rider(1), { motion: { crouch: 1, feet: [0, 2] } }],
    ],
    boarding: [
      [
        { pose: "mm-cheer", at: [24, 0], motion: { crouch: 2 } },
        { motion: { crouch: 1 } },
      ],
      [
        { pose: "mm-cheer", at: [13, -22], motion: { feet: [3, 3] } },
        { motion: { crouch: 3 } },
      ],
      [rider(1), { motion: { crouch: 1 } }],
    ],
    win: [
      [{ pose: "mm-cheer", expression: "mm-bright", motion: { crouch: 3 } }],
      [
        {
          pose: "mm-cheer",
          expression: "mm-bright",
          at: [0, -LEAP],
          motion: { feet: [2, 2] },
        },
      ],
      [{ pose: "mm-cheer", expression: "mm-bright" }],
    ],
    lose: [
      [{ expression: "mm-surprised", motion: { head: [0, -1] } }],
      [{ expression: "mm-calm", motion: slumped(-1) }],
      [{ expression: "mm-calm", motion: slumped(1) }],
    ],
    caught: [
      [{ expression: "mm-surprised", motion: { head: [0, -1] } }],
      [
        {
          expression: "mm-surprised",
          at: [3, -6],
          motion: { feet: [2, 2], body: [1, 0], head: [2, 0] },
        },
      ],
      [{ expression: "mm-shy", motion: slumped(-2) }],
    ],
    "pair-caught": [
      [
        rider(0, { expression: "mm-surprised" }),
        { expression: "mm-surprised", motion: { head: [0, -1] } },
      ],
      [
        {
          pose: "mm-cheer",
          expression: "mm-surprised",
          at: [20, -14],
          motion: { feet: [3, 3] },
        },
        {
          expression: "mm-surprised",
          at: [-4, -3],
          motion: { feet: [2, 2], body: [-1, 0], head: [-2, 0] },
        },
      ],
      [
        { expression: "mm-shy", at: [22, 0], motion: slumped(2) },
        { expression: "mm-shy", at: [-8, 0], motion: slumped(-2) },
      ],
    ],
  };
};

/**
 * A frame's cell in the sheet and the square it is shown in. The square runs
 * from the top of the (upper) head to just under the feet, as wide as it is
 * tall; a hat or a leap rises above it, like the tall frames of the animals.
 */
const SINGLE = {
  width: MINIMI_WIDTH,
  height: FEET + LEAP,
  origin: [0, LEAP],
  ground: GROUND,
  size: FEET - CROWN + GROUND,
} as const;
const pairBox = (ride: number) =>
  ({
    width: MINIMI_WIDTH + REACH * 2,
    height: FEET + CHIN - HAT + 2,
    origin: [REACH, CHIN - HAT + 2],
    ground: GROUND + 1,
    size: FEET - CROWN + ride + GROUND + 1,
  }) as const;
const SHEET_WIDTH = GUTTER + (MINIMI_WIDTH + REACH * 2 + GUTTER) * 3;

const supported = (look: AvatarLook) =>
  (Object.keys(MINIMI_VALUES) as AvatarSlot[]).every((slot) =>
    (MINIMI_VALUES[slot] as readonly string[]).includes(look?.[slot]),
  );
const idle = () =>
  new Promise<void>((resolve) => {
    if (typeof window.requestIdleCallback === "function")
      window.requestIdleCallback(() => resolve(), { timeout: 200 });
    else window.setTimeout(resolve, 16);
  });

/**
 * Paints one player's 24 frames with the real minimi engine. `scale` is a whole
 * number of sheet pixels per sprite pixel, enlarged without smoothing.
 * The caller owns the returned object URL.
 */
export async function bakeYutAvatarSheet(
  look: AvatarLook,
  scale: 1 | 2,
): Promise<YutAvatarSheet> {
  if (!supported(look)) throw new Error("Unsupported avatar look");
  const sprite = document.createElement("canvas");
  sprite.width = MINIMI_WIDTH;
  sprite.height = MINIMI_HEIGHT;
  const pen = sprite.getContext("2d", {
    alpha: true,
    willReadFrequently: true,
  });
  if (!pen) throw new Error("Canvas unavailable");
  const draw = (figure: Figure) =>
    drawMinimi(
      pen,
      {
        ...look,
        pose: figure.pose || "mm-idle",
        expression: figure.expression || look.expression,
      },
      { blink: figure.blink, motion: figure.motion },
    );
  // A tall hat pushes the carried piece higher, so its face stays in view.
  draw({});
  const pixels = pen.getImageData(0, 0, MINIMI_WIDTH, CROWN + 1).data;
  let top = CROWN;
  for (let index = 3; index < pixels.length; index += 4)
    if (pixels[index]) {
      top = Math.floor(index / 4 / MINIMI_WIDTH);
      break;
    }
  const ride = CHIN - Math.max(HAT, top);
  const frames = framesFor(ride);
  const pair = pairBox(ride);
  const boxOf = (action: YutPieceAction) =>
    frames[action].some((frame) => frame.length > 1) ? pair : SINGLE;
  // Shelves: lone-figure frames first, then the wider two-figure frames.
  const ordered = [...YUT_PIECE_ACTIONS].sort(
    (a, b) => boxOf(a).width - boxOf(b).width,
  );
  const cells: {
    action: YutPieceAction;
    index: number;
    x: number;
    y: number;
  }[] = [];
  let x = GUTTER,
    y = GUTTER,
    shelf = 0;
  for (const action of ordered) {
    const box = boxOf(action);
    frames[action].forEach((_frame, index) => {
      if (
        x + box.width + GUTTER > SHEET_WIDTH ||
        (shelf && shelf !== box.height)
      ) {
        x = GUTTER;
        y += shelf + GUTTER;
      }
      shelf = box.height;
      cells.push({ action, index, x, y });
      x += box.width + GUTTER;
    });
  }
  const width = SHEET_WIDTH,
    height = y + shelf + GUTTER;
  const sheet = document.createElement("canvas");
  sheet.width = width * scale;
  sheet.height = height * scale;
  const paint = sheet.getContext("2d", { alpha: true });
  if (!paint) throw new Error("Canvas unavailable");
  paint.imageSmoothingEnabled = false;
  let painted: YutPieceAction | undefined;
  for (const cell of cells) {
    // Never hold the main thread for a whole sheet while a match is running.
    if (painted !== cell.action) await idle();
    painted = cell.action;
    const box = boxOf(cell.action);
    for (const figure of frames[cell.action][cell.index]) {
      draw(figure);
      const rows = figure.riding ? RIDER_ROWS : MINIMI_HEIGHT;
      paint.drawImage(
        sprite,
        0,
        0,
        MINIMI_WIDTH,
        rows,
        (cell.x + box.origin[0] + (figure.at?.[0] || 0)) * scale,
        (cell.y + box.origin[1] + (figure.at?.[1] || 0)) * scale,
        MINIMI_WIDTH * scale,
        rows * scale,
      );
    }
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    sheet.toBlob(resolve, "image/png"),
  );
  sheet.width = sheet.height = sprite.width = sprite.height = 1;
  if (!blob) throw new Error("Avatar sheet could not be encoded");
  const url = URL.createObjectURL(blob);
  try {
    // Decoded before any piece switches to it, so no piece blinks empty.
    const image = new Image();
    image.src = url;
    await image.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  const actions = {} as YutAvatarSheet["actions"];
  for (const action of YUT_PIECE_ACTIONS) {
    const box = boxOf(action);
    actions[action] = {
      size: box.size,
      frames: cells
        .filter((cell) => cell.action === action)
        .map(
          (cell): YutPieceFrame => [
            cell.x,
            cell.y,
            box.width,
            box.height,
            (box.size - box.width) / 2,
            box.size - box.ground - box.height,
          ],
        ),
    };
  }
  return { url, scale, width, height, actions };
}
