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
export function playCompactFlight(
  element: HTMLElement | null,
  motion: Animation | null,
  note: CollectedNote,
) {
  if (!element || !motion || motion.playState === "running") return;
  element.style.left = `${note.x}px`;
  element.style.top = `${note.y}px`;
  element.style.setProperty("--collect-x", `${note.dx}px`);
  element.style.setProperty("--collect-y", `${note.dy}px`);
  element.dataset.kind = note.kind;
  element.dataset.grade = note.grade;
  const hand = element.querySelector("b")?.firstChild;
  const points = element.querySelector("strong")?.firstChild;
  if (hand) hand.nodeValue = note.hand === "left" ? "왼" : "오";
  if (points) points.nodeValue = `+${note.points.toLocaleString()}`;
  element.style.visibility = "visible";
  motion.currentTime = 0;
  motion.play();
}

// Reuse the animated surfaces for the full run, including repeated hits by one hand.
const strokes = new WeakMap<HTMLElement, Animation>();
export function replayStroke(
  node: HTMLElement | null,
  name: string,
  frames: Keyframe[],
  duration: number,
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
  const animation = node.animate(frames, { duration, easing: "ease-out" });
  animation.id = name;
  strokes.set(node, animation);
}

export const DRUM_FRAMES = [
  { transform: "scale(1)" },
  { transform: "scale(1.035, .95)", offset: 0.25 },
  { transform: "scale(.99, 1.025)", offset: 0.62 },
  { transform: "scale(1)" },
];
export const PULSE_FRAMES = [
  { transform: "scale(.5)", opacity: 1 },
  { transform: "scale(1.6)", opacity: 0 },
];
export const ARRIVAL_FRAMES = [
  { transform: "scale(1)" },
  { transform: "scale(1.14)", offset: 0.4 },
  { transform: "scale(1)" },
];

function mascotFrames(angle: number) {
  return [
    { transform: "translateY(0) rotate(0)" },
    { transform: `translateY(-14px) rotate(${angle}deg)`, offset: 0.35 },
    { transform: "translateY(0) rotate(0)" },
  ];
}
export const MASCOT_FRAMES = { center: mascotFrames(-8), rim: mascotFrames(8) };

function malletFrames(hand: DrumHand) {
  const turn = hand === "left" ? -12 : 12;
  const aim = hand === "left" ? -22 : 22;
  const rest = { transform: "rotate(0deg) translateY(0)" };
  return {
    center: [
      rest,
      { transform: `rotate(${turn}deg) translateY(-8%)`, offset: 0.22 },
      { transform: "rotate(0deg) translateY(13%)", offset: 0.48 },
      { transform: `rotate(${turn}deg) translateY(-4%)`, offset: 0.7 },
      rest,
    ],
    rim: [
      rest,
      { transform: `translateY(-36%) rotate(${aim}deg)`, offset: 0.22 },
      { transform: `translateY(-28%) rotate(${aim}deg)`, offset: 0.48 },
      { transform: `translateY(-32%) rotate(${aim}deg)`, offset: 0.7 },
      rest,
    ],
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
