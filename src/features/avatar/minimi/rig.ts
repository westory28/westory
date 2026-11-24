/**
 * One rig moves the body and everything worn on it. Painters never keep their
 * own copy of a joint: sleeves, cuffs, drapes and hands read the arm segments,
 * and every other layer is attached to the offset of the body part it covers.
 */
export type MinimiPoint = readonly [number, number];
export type MinimiArm = {
  shoulder: MinimiPoint;
  elbow: MinimiPoint;
  wrist: MinimiPoint;
  raised: boolean;
  /** -1 for the arm on the left of the sprite, 1 for the right. */
  side: -1 | 1;
};

/** One pixel grid is shared by every body, hair, garment, pose and thumbnail. */
export const MINIMI_ANCHORS = Object.freeze({
  head: [40, 31],
  neck: [40, 49],
  shoulderLeft: [31, 55],
  shoulderRight: [49, 55],
  waist: [40, 73],
  ankleLeft: [35, 97],
  ankleRight: [46, 97],
} as const);

const hanging = (side: -1 | 1): MinimiArm =>
  side < 0
    ? {
        shoulder: MINIMI_ANCHORS.shoulderLeft,
        elbow: [26, 64],
        wrist: [25, 74],
        raised: false,
        side,
      }
    : {
        shoulder: MINIMI_ANCHORS.shoulderRight,
        elbow: [54, 64],
        wrist: [55, 74],
        raised: false,
        side,
      };
const lifted = (side: -1 | 1): MinimiArm =>
  side < 0
    ? {
        shoulder: MINIMI_ANCHORS.shoulderLeft,
        elbow: [21, 50],
        wrist: [18, 41],
        raised: true,
        side,
      }
    : {
        shoulder: MINIMI_ANCHORS.shoulderRight,
        elbow: [60, 51],
        wrist: [64, 40],
        raised: true,
        side,
      };
const RESTING_ARMS = [hanging(-1), hanging(1)] as const;
/** A new pose is one row here; nothing else needs its coordinates. */
const ARM_POSES = new Map<string, readonly [MinimiArm, MinimiArm]>([
  ["mm-idle", RESTING_ARMS],
  ["mm-wave", [hanging(-1), lifted(1)]],
  ["mm-cheer", [lifted(-1), lifted(1)]],
]);

/**
 * Optional movement on top of the pose, in whole sprite pixels. Travel across
 * the screen (a hop, a path) belongs to whoever places the sprite.
 */
export type MinimiMotion = {
  /** Bend both knees: everything above them sinks, the feet stay planted. 0 to 3. */
  crouch?: number;
  /** Raise the left and right foot; that knee bends by the same rows. 0 to 3. */
  feet?: readonly [number, number];
  /** Torso, sleeves, arms, hands and head against the hips: x -1 to 1, y 0 to 2. */
  body?: MinimiPoint;
  /** Head, hair, face and headwear against the torso: x -2 to 2, y -1 to 2. */
  head?: MinimiPoint;
};
/**
 * The first row that folds away. Rows 90 to 92 hold no hem, cuff, pocket or
 * sock on any garment, so a bent knee never erases a detail.
 */
export const MINIMI_KNEE_ROW = 90;
const MAX_KNEE_BEND = 3;

export type MinimiRig = {
  arms: readonly [MinimiArm, MinimiArm];
  /** Offsets of each rigid group from its rest position. */
  hips: MinimiPoint;
  body: MinimiPoint;
  head: MinimiPoint;
  /** Rows by which the left and right foot rise. */
  lift: readonly [number, number];
  /** Rows by which everything above the knees sinks. */
  sink: number;
};

const whole = (value: unknown, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(Number(value) || 0))) + 0;

export function resolveMinimiRig(
  pose: string,
  motion?: MinimiMotion | null,
): MinimiRig {
  const sink = whole(motion?.crouch, 0, MAX_KNEE_BEND);
  const lift = [0, 1].map((index) =>
    whole(motion?.feet?.[index], 0, MAX_KNEE_BEND - sink),
  ) as [number, number];
  const body: MinimiPoint = [
    whole(motion?.body?.[0], -1, 1),
    sink + whole(motion?.body?.[1], 0, 2),
  ];
  return {
    arms: ARM_POSES.get(pose) || RESTING_ARMS,
    hips: [0, sink],
    body,
    head: [
      body[0] + whole(motion?.head?.[0], -2, 2),
      body[1] + whole(motion?.head?.[1], -1, 2),
    ],
    lift,
    sink,
  };
}

/** Where a leg row lands: thighs sink, the knee folds, the shin rises. */
export const kneeRow = (row: number, sink: number, lift: number) =>
  row < MINIMI_KNEE_ROW
    ? row + sink
    : Math.max(MINIMI_KNEE_ROW + sink, row - lift);

/**
 * The pixel-grid frame of a limb segment. `along` steps toward the far joint on
 * the segment's dominant axis and `across` is its perpendicular, so a trim that
 * is level on a hanging arm stands upright on an arm raised sideways.
 */
export function limbFrame(from: MinimiPoint, to: MinimiPoint) {
  const dx = to[0] - from[0],
    dy = to[1] - from[1];
  const upright = Math.abs(dy) >= Math.abs(dx);
  const along: MinimiPoint = upright
    ? [0, dy < 0 ? -1 : 1]
    : [dx < 0 ? -1 : 1, 0];
  const across: MinimiPoint = upright ? [1, 0] : [0, 1];
  return { along, across };
}
export const shiftPoint = (
  point: MinimiPoint,
  axis: MinimiPoint,
  distance: number,
): MinimiPoint => [
  point[0] + axis[0] * distance,
  point[1] + axis[1] * distance,
];

/**
 * A stripe down the whole sleeve, `offset` pixels from its centre line. Around
 * a bent elbow it stays on the same side of the arm instead of crossing over.
 */
export function armStripe(
  arm: MinimiArm,
  offset: number,
): readonly [MinimiPoint, MinimiPoint, MinimiPoint] {
  const upper = limbFrame(arm.shoulder, arm.elbow),
    lower = limbFrame(arm.elbow, arm.wrist);
  const start = shiftPoint(arm.shoulder, upper.across, offset);
  if (upper.across[0] === lower.across[0])
    return [
      start,
      shiftPoint(arm.elbow, upper.across, offset),
      shiftPoint(arm.wrist, lower.across, offset),
    ];
  const dot = (a: MinimiPoint, b: MinimiPoint) => a[0] * b[0] + a[1] * b[1];
  // The inside of the bend faces the forearm on the upper arm, the shoulder on the forearm.
  const turned =
    offset * dot(upper.across, lower.along) * -dot(lower.across, upper.along);
  return [
    start,
    shiftPoint(
      shiftPoint(arm.elbow, upper.across, offset),
      lower.across,
      turned,
    ),
    shiftPoint(arm.wrist, lower.across, turned),
  ];
}

/**
 * A point of a garment that rests on the upper arm: `along` is the fraction of
 * the way from shoulder to elbow, `outward` the distance from the arm's centre
 * line away from the body. It turns with the arm.
 */
export function upperArmPoint(
  arm: MinimiArm,
  along: number,
  outward: number,
): MinimiPoint {
  const dx = arm.elbow[0] - arm.shoulder[0],
    dy = arm.elbow[1] - arm.shoulder[1];
  const length = Math.hypot(dx, dy) || 1;
  return [
    Math.round(
      arm.shoulder[0] + dx * along + ((arm.side * dy) / length) * outward,
    ),
    Math.round(
      arm.shoulder[1] + dy * along - ((arm.side * dx) / length) * outward,
    ),
  ];
}
