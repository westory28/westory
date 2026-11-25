import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import { RhythmNoteArt } from "./RhythmArt";
import type { RhythmAudio } from "./rhythmAudio";
import { HIT_WINDOW_SECONDS, type RhythmNote } from "./rhythmCore";

// The audio clock advances in steps: a few milliseconds on most computers, 40
// to 100ms on Bluetooth sound and some tablets. It is never ahead of the sound,
// so the earliest start seen in a short window is the real one and a single
// reading is not. Notes follow that start and stay even between the steps.
const CLOCK_SAMPLE_MS = 12;
const CLOCK_WINDOW_MS = 480;
const CLOCK_SETTLE_MS = 400;
const CLOCK_TOLERANCE_MS = 32;

// A slot keeps the same image, hand label, and compositor layer for a whole
// song. Reuse it only after the previous note's late hit window has closed.
function groupNotes(chart: RhythmNote[], travelSeconds: number) {
  const slots: RhythmNote[][] = [];
  for (const note of chart) {
    const entryTime = note.time - travelSeconds;
    const slot = slots.find(
      (notes) =>
        notes[0].kind === note.kind &&
        notes[0].hand === note.hand &&
        notes[notes.length - 1].time + HIT_WINDOW_SECONDS < entryTime,
    );
    if (slot) slot.push(note);
    else slots.push([note]);
  }
  return slots;
}

export default memo(function RhythmLaneNotes({
  chart,
  audio,
  judged,
  playing,
  offset,
  travelSeconds,
  sync,
}: {
  chart: RhythmNote[];
  audio: RefObject<RhythmAudio>;
  judged: { readonly current: ReadonlySet<string> };
  playing: boolean;
  offset: number;
  travelSeconds: number;
  /** The game calls this right after it judges a note. */
  sync: MutableRefObject<(() => void) | null>;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const groups = useMemo(
    () => groupNotes(chart, travelSeconds),
    [chart, travelSeconds],
  );
  useLayoutEffect(() => {
    const element = track.current!;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!width) return;
    const transformAt = (secondsBeforeHit: number) => {
      const x = width * (0.14 + (secondsBeforeHit / travelSeconds) * 0.78);
      return `translate3d(${x}px, -50%, 0) translateX(-50%)`;
    };
    const frames = [
      { transform: transformAt(travelSeconds) },
      { transform: transformAt(-HIT_WINDOW_SECONDS) },
    ];
    const timing: KeyframeAnimationOptions = {
      duration: (travelSeconds + HIT_WINDOW_SECONDS) * 1000,
      fill: "both",
    };
    const slots = groups.map((notes, index) => {
      const node = track.current!.children[index] as HTMLDivElement;
      const motion = new Animation(
        new KeyframeEffect(node, frames, timing),
        document.timeline,
      );
      return {
        notes,
        node,
        motion,
        index: 0,
        active: undefined as RhythmNote | undefined,
      };
    });
    // The compositor moves every note. This runs only when a note enters,
    // expires or is judged, so moving notes never ask for a main-thread frame.
    let timer = 0;
    let sampler = 0;
    let origin = NaN;
    let previousTime = -Infinity;
    let realigned = false;
    let samples: { at: number; origin: number }[] = [];
    const startedAt = performance.now();
    // Read both clocks in one task and keep the earliest start of the window.
    const sampleClock = () => {
      const at = performance.now();
      const raw = at - (audio.current?.currentTime ?? 0) * 1000 + offset;
      if (audio.current && audio.current.state !== "running") {
        // The device holds the sound: the notes wait with it.
        samples = [];
        origin = raw;
        realigned = true;
        return;
      }
      samples = samples.filter((item) => at - item.at <= CLOCK_WINDOW_MS);
      samples.push({ at, origin: raw });
      const earliest = Math.min(...samples.map((item) => item.origin));
      if (!Number.isFinite(origin)) {
        origin = earliest;
        realigned = true;
        return;
      }
      const tolerance =
        at - startedAt < CLOCK_SETTLE_MS ? 4 : CLOCK_TOLERANCE_MS;
      // Sound that held still moves the start later; only a full window of
      // readings can tell that apart from one late step of the clock.
      const held =
        samples.length >= 10 &&
        at - samples[0].at >= CLOCK_WINDOW_MS / 2 &&
        earliest - origin > CLOCK_TOLERANCE_MS;
      if (origin - earliest > tolerance || held) {
        origin = earliest;
        realigned = true;
      }
    };
    const update = () => {
      window.clearTimeout(timer);
      sampleClock();
      const time = playing
        ? (performance.now() - origin) / 1000
        : (audio.current?.currentTime ?? 0) - offset / 1000;
      const realign = realigned;
      realigned = false;
      let wake = time + 0.25;
      for (const slot of slots) {
        if (time < previousTime) slot.index = 0;
        while (
          slot.index < slot.notes.length &&
          slot.notes[slot.index].time < time - HIT_WINDOW_SECONDS
        )
          slot.index++;
        const candidate = slot.notes[slot.index];
        if (candidate)
          wake = Math.min(
            wake,
            candidate.time - travelSeconds > time
              ? candidate.time - travelSeconds
              : candidate.time + HIT_WINDOW_SECONDS,
          );
        const note =
          candidate &&
          candidate.time <= time + travelSeconds &&
          !judged.current.has(candidate.id)
            ? candidate
            : undefined;
        if (note !== slot.active) {
          slot.active = note;
          if (note) {
            slot.node.dataset.noteId = note.id;
            slot.node.style.visibility = "visible";
          } else {
            slot.node.style.visibility = "hidden";
            delete slot.node.dataset.noteId;
            slot.motion.cancel();
          }
        } else if (!realign) continue;
        if (!note) continue;
        const entersAt = (note.time - travelSeconds) * 1000;
        if (playing) slot.motion.startTime = origin + entersAt;
        else {
          slot.motion.pause();
          slot.motion.currentTime = time * 1000 - entersAt;
        }
      }
      previousTime = time;
      if (playing)
        timer = window.setTimeout(
          update,
          Math.max(4, (wake - time) * 1000 + 1),
        );
    };
    const watchClock = () => {
      sampleClock();
      if (realigned) update();
      sampler = window.setTimeout(watchClock, CLOCK_SAMPLE_MS);
    };
    update();
    if (playing) watchClock();
    sync.current = update;
    // Timers are slowed while a tab is hidden; catch up the moment it returns.
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(sampler);
      if (sync.current === update) sync.current = null;
      document.removeEventListener("visibilitychange", update);
      for (const { node, motion } of slots) {
        motion.cancel();
        node.style.visibility = "hidden";
        delete node.dataset.noteId;
      }
    };
  }, [audio, groups, judged, offset, playing, sync, travelSeconds, width]);
  return (
    <div className="rhythm-note-track" ref={track}>
      {groups.map(([note], index) => (
        <div
          key={index}
          data-kind={note.kind}
          data-hand={note.hand}
          className={`rhythm-note rhythm-note--${note.kind}`}
          style={{ visibility: "hidden" }}
        >
          <RhythmNoteArt kind={note.kind} />
          <b className="rhythm-note-hand">
            {note.hand === "left" ? "왼" : "오"}
          </b>
          <span>{note.kind === "center" ? "쿵" : "덕"}</span>
        </div>
      ))}
    </div>
  );
});
