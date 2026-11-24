import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { RhythmNoteArt } from "./RhythmArt";
import type { RhythmAudio } from "./rhythmAudio";
import { HIT_WINDOW_SECONDS, type RhythmNote } from "./rhythmCore";

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
}: {
  chart: RhythmNote[];
  audio: RefObject<RhythmAudio>;
  judged: { readonly current: ReadonlySet<string> };
  playing: boolean;
  offset: number;
  travelSeconds: number;
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
    let frame = 0;
    let origin = NaN;
    let previousTime = -Infinity;
    const update = () => {
      const time = (audio.current?.currentTime ?? 0) - offset / 1000;
      // Sample both clocks together. The rAF timestamp can already be stale
      // when a touch or another task runs before this callback.
      const nextOrigin = performance.now() - time * 1000;
      const realign =
        !Number.isFinite(origin) || Math.abs(nextOrigin - origin) > 32;
      if (realign) origin = nextOrigin;
      for (const slot of slots) {
        if (time < previousTime) slot.index = 0;
        while (
          slot.index < slot.notes.length &&
          slot.notes[slot.index].time < time - HIT_WINDOW_SECONDS
        )
          slot.index++;
        const candidate = slot.notes[slot.index];
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
      if (playing) frame = requestAnimationFrame(update);
    };
    update();
    return () => {
      cancelAnimationFrame(frame);
      for (const { node, motion } of slots) {
        motion.cancel();
        node.style.visibility = "hidden";
        delete node.dataset.noteId;
      }
    };
  }, [audio, groups, judged, offset, playing, travelSeconds, width]);
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
