import type { DrumHand, DrumKind, RhythmJudgement } from "./rhythmCore";

export type CollectedNote = {
  id: number;
  kind: DrumKind;
  hand: DrumHand;
  grade: RhythmJudgement;
  x: number;
  y: number;
  dx: number;
  dy: number;
  points: number;
};

// At high load, finish the current flight before reusing its image and labels.
// Judgement and points still update immediately for every input.
export function createCompactFlight(
  element: HTMLElement,
  onArrival: () => void,
) {
  const hand = element.querySelector("b")?.firstChild;
  const points = element.querySelector("strong")?.firstChild;
  const effect = new KeyframeEffect(element, [], {
    duration: 600,
    easing: "cubic-bezier(.2,.6,.35,1)",
  });
  const motion = new Animation(effect, document.timeline);
  let busy = false;
  let frame = 0;
  motion.onfinish = () => {
    busy = false;
    onArrival();
  };
  return {
    play(note: CollectedNote) {
      if (busy) return;
      busy = true;
      frame = requestAnimationFrame(() => {
        element.dataset.kind = note.kind;
        element.dataset.grade = note.grade;
        if (hand) hand.nodeValue = note.hand === "left" ? "왼" : "오";
        if (points) points.nodeValue = `+${note.points.toLocaleString()}`;
        element.style.visibility = "visible";
        // The 48px sprite keeps a fixed layout origin; its entire flight is
        // expressed as absolute compositor transforms in stage coordinates.
        const transform = (dx: number, dy: number, scale: number) =>
          `translate3d(${note.x - 24 + dx}px,${note.y - 24 + dy}px,0) scale(${scale})`;
        effect.setKeyframes([
          { transform: transform(0, 0, 1), opacity: 1 },
          {
            transform: transform(note.dx * 0.4, note.dy * 0.7 - 32, 1.12),
            offset: 0.45,
          },
          { opacity: 1, offset: 0.86 },
          { transform: transform(note.dx, note.dy, 0.25), opacity: 0 },
        ]);
        motion.play();
      });
    },
    dispose() {
      cancelAnimationFrame(frame);
      motion.onfinish = null;
      motion.cancel();
    },
  };
}

// Every stroke lasts as long as the strike's other effects, so the browser ends
// them all in one main-thread pass. Its visible motion keeps its own length: the
// ease-out curve over that length is cut exactly at each keyframe.
const STROKE_SPAN = 600;
const EASE_OUT = { x: [0, 0, 0.58, 1], y: [0, 0, 1, 1] };
// Polar form of a cubic curve: three equal arguments give a point on it, mixed
// arguments give the control points of the piece between them.
const blossom = (c: number[], r: number, s: number, t: number) =>
  c[0] * (1 - r) * (1 - s) * (1 - t) +
  c[1] *
    (r * (1 - s) * (1 - t) + (1 - r) * s * (1 - t) + (1 - r) * (1 - s) * t) +
  c[2] * (r * s * (1 - t) + r * (1 - s) * t + (1 - r) * s * t) +
  c[3] * r * s * t;
function stroke(frames: Keyframe[], duration: number): Keyframe[] {
  // Curve parameter at which the eased progress reaches each keyframe.
  const reached = frames.map((frame, index) => {
    const offset = frame.offset ?? index / (frames.length - 1);
    // The first and last keyframes stay exactly on the motion's own ends.
    if (offset <= 0 || offset >= 1) return offset <= 0 ? 0 : 1;
    let low = 0;
    let high = 1;
    for (let step = 0; step < 40; step++) {
      const middle = (low + high) / 2;
      if (blossom(EASE_OUT.y, middle, middle, middle) < offset) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  });
  const piece = (c: number[], from: number, to: number) => {
    const start = blossom(c, from, from, from);
    const span = blossom(c, to, to, to) - start;
    return [blossom(c, from, from, to), blossom(c, from, to, to)].map((value) =>
      Math.min(1, Math.max(0, (value - start) / span)).toFixed(5),
    );
  };
  const timed = frames.map((frame, index): Keyframe => {
    const from = reached[index];
    const to = reached[index + 1];
    return {
      ...frame,
      offset: (blossom(EASE_OUT.x, from, from, from) * duration) / STROKE_SPAN,
      ...(to !== undefined && {
        easing: `cubic-bezier(${[0, 1]
          .flatMap((point) => [
            piece(EASE_OUT.x, from, to)[point],
            piece(EASE_OUT.y, from, to)[point],
          ])
          .join(",")})`,
      }),
    };
  });
  return [...timed, { ...frames[frames.length - 1], offset: 1 }];
}

// Reuse the animated surfaces for the full run, including repeated hits by one hand.
const strokes = new WeakMap<HTMLElement, Animation>();
export function replayStroke(
  node: HTMLElement | null,
  name: string,
  frames: Keyframe[],
) {
  if (!node) return;
  const active = strokes.get(node);
  if (active) {
    if (active.id !== name) {
      (active.effect as KeyframeEffect).setKeyframes(frames);
      active.id = name;
    }
    active.currentTime = 0;
    active.play();
    return;
  }
  const animation = node.animate(frames, { duration: STROKE_SPAN });
  animation.id = name;
  strokes.set(node, animation);
}

export const DRUM_FRAMES = stroke(
  [
    { transform: "scale(1)" },
    { transform: "scale(1.035, .95)", offset: 0.25 },
    { transform: "scale(.99, 1.025)", offset: 0.62 },
    { transform: "scale(1)" },
  ],
  220,
);
export const PULSE_FRAMES = stroke(
  [
    { transform: "scale(.5)", opacity: 1 },
    { transform: "scale(1.6)", opacity: 0 },
  ],
  200,
);
export const ARRIVAL_FRAMES = stroke(
  [
    { transform: "scale(1)" },
    { transform: "scale(1.14)", offset: 0.4 },
    { transform: "scale(1)" },
  ],
  240,
);

function mascotFrames(angle: number) {
  return stroke(
    [
      { transform: "translateY(0) rotate(0)" },
      { transform: `translateY(-14px) rotate(${angle}deg)`, offset: 0.35 },
      { transform: "translateY(0) rotate(0)" },
    ],
    320,
  );
}
export const MASCOT_FRAMES = { center: mascotFrames(-8), rim: mascotFrames(8) };

function malletFrames(hand: DrumHand) {
  const turn = hand === "left" ? -12 : 12;
  const aim = hand === "left" ? -22 : 22;
  const rest = { transform: "rotate(0deg) translateY(0)" };
  return {
    center: stroke(
      [
        rest,
        { transform: `rotate(${turn}deg) translateY(-8%)`, offset: 0.22 },
        { transform: "rotate(0deg) translateY(13%)", offset: 0.48 },
        { transform: `rotate(${turn}deg) translateY(-4%)`, offset: 0.7 },
        rest,
      ],
      220,
    ),
    rim: stroke(
      [
        rest,
        { transform: `translateY(-36%) rotate(${aim}deg)`, offset: 0.22 },
        { transform: `translateY(-28%) rotate(${aim}deg)`, offset: 0.48 },
        { transform: `translateY(-32%) rotate(${aim}deg)`, offset: 0.7 },
        rest,
      ],
      220,
    ),
  };
}
export const MALLET_FRAMES = {
  left: malletFrames("left"),
  right: malletFrames("right"),
};

export const SPARK_COUNTS = { perfect: 12, good: 6, ok: 3 } as const;
// A whole burst travels on one layer, with the original number of stars per grade.
function sparkPath(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (2 * Math.PI * index) / count;
    const distance = 36 + (index % 3) * 18;
    const x = Math.round(Math.cos(angle) * distance);
    const y = Math.round(Math.sin(angle) * distance);
    return `M${x} ${y - 5}l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.5Z`;
  }).join(" ");
}
export const SPARK_PATHS = {
  perfect: sparkPath(SPARK_COUNTS.perfect),
  good: sparkPath(SPARK_COUNTS.good),
  ok: sparkPath(SPARK_COUNTS.ok),
};
