import type { RhythmSong } from "./rhythmSongs";

export type DrumKind = "center" | "rim";
export type DrumHand = "left" | "right";
export type RhythmDifficulty = "easy" | "normal" | "hard";
export type RhythmJudgement = "perfect" | "good" | "ok" | "miss";
export interface RhythmNote {
  id: string;
  /** Seconds on the audio clock, including the count-in. */
  time: number;
  kind: DrumKind;
  hand: DrumHand;
}

export const COUNT_IN_SECONDS = 3;
export const HIT_WINDOW_SECONDS = 0.16;
export const INPUT_RECOVERY_SECONDS = 0.22;
const TIMING_EPSILON = 1e-8;

export function getJudgement(delta: number): RhythmJudgement {
  const distance = Math.abs(delta);
  if (!Number.isFinite(distance)) return "miss";
  if (distance <= 0.065 + TIMING_EPSILON) return "perfect";
  if (distance <= 0.13 + TIMING_EPSILON) return "good";
  if (distance <= HIT_WINDOW_SECONDS + TIMING_EPSILON) return "ok";
  return "miss";
}

/** Match the earliest eligible note in the ordered chart; the caller consumes it. */
export function findHit(
  notes: readonly RhythmNote[],
  judged: ReadonlySet<string>,
  kind: DrumKind,
  elapsed: number,
  hand?: DrumHand,
): RhythmNote | null {
  if (!Number.isFinite(elapsed)) return null;
  for (const note of notes) {
    if (note.time > elapsed + HIT_WINDOW_SECONDS + TIMING_EPSILON) break;
    if (
      note.kind !== kind ||
      (hand !== undefined && note.hand !== hand) ||
      judged.has(note.id)
    )
      continue;
    const delta = Math.abs(note.time - elapsed);
    // A late valid strike belongs to this note, even if the next is nearer.
    if (delta <= HIT_WINDOW_SECONDS + TIMING_EPSILON) return note;
  }
  return null;
}

export interface RhythmInputResult {
  note: RhythmNote | null;
  judgement: RhythmJudgement | "ignored";
  blockedUntil: number;
}

/** Wrong inputs extend recovery; successful fast phrases have no input cooldown. */
export function judgeInput(
  notes: readonly RhythmNote[],
  judged: ReadonlySet<string>,
  kind: DrumKind,
  hand: DrumHand,
  elapsed: number,
  blockedUntil: number,
): RhythmInputResult {
  if (
    !Number.isFinite(elapsed) ||
    notes.length === 0 ||
    elapsed < notes[0].time - HIT_WINDOW_SECONDS - TIMING_EPSILON ||
    elapsed > notes[notes.length - 1].time + HIT_WINDOW_SECONDS + TIMING_EPSILON
  )
    return { note: null, judgement: "ignored", blockedUntil };

  const note =
    elapsed + TIMING_EPSILON < blockedUntil
      ? null
      : findHit(notes, judged, kind, elapsed, hand);
  if (!note)
    return {
      note: null,
      judgement: "miss",
      blockedUntil: elapsed + INPUT_RECOVERY_SECONDS,
    };

  // The caller consumes successful notes; wrong inputs never consume future ones.
  return {
    note,
    judgement: getJudgement(elapsed - note.time),
    blockedUntil,
  };
}

/** Normalized coordinates within the square drum surface (not the page). */
export function classifyDrumHit(x: number, y: number): DrumKind | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const radius = Math.hypot(x - 0.5, y - 0.5);
  if (radius > 0.5 + TIMING_EPSILON) return null;
  return radius <= 0.36 + TIMING_EPSILON ? "center" : "rim";
}

export interface RhythmScore {
  score: number;
  combo: number;
  maxCombo: number;
  perfect: number;
  good: number;
  ok: number;
  miss: number;
}

export function createScore(): RhythmScore {
  return {
    score: 0,
    combo: 0,
    maxCombo: 0,
    perfect: 0,
    good: 0,
    ok: 0,
    miss: 0,
  };
}

export function applyJudgement(
  score: RhythmScore,
  judgement: RhythmJudgement,
): RhythmScore {
  const combo = judgement === "miss" ? 0 : score.combo + 1;
  const points = { perfect: 1000, good: 650, ok: 300, miss: 0 }[judgement];
  return {
    ...score,
    score: score.score + points,
    combo,
    maxCombo: Math.max(score.maxCombo, combo),
    [judgement]: score[judgement] + 1,
  };
}

/**
 * Each chart follows actual melody onsets. Easier charts retain accented onsets;
 * hard adds audible accompaniment beats. No randomness or frame-based timing.
 */
export function createChart(
  song: RhythmSong,
  difficulty: RhythmDifficulty,
): RhythmNote[] {
  const secondsPerBeat = 60 / song.bpm;
  const candidates = new Map<number, DrumKind>();
  let lastEasyBeat = -Infinity;
  let lastNormalBeat = -Infinity;
  for (let i = 0; i < song.melody.length; i++) {
    const event = song.melody[i];
    const accented = Math.abs(event.beat % song.beatsPerBar) < 0.001;
    const kind: DrumKind = accented || i % 3 !== 2 ? "center" : "rim";
    const minGap = difficulty === "easy" ? 1.5 : 0.5;
    const lastBeat = difficulty === "easy" ? lastEasyBeat : lastNormalBeat;
    if (difficulty === "hard" || event.beat - lastBeat >= minGap - 0.001) {
      candidates.set(Math.round(event.beat * 1000), kind);
      lastEasyBeat = event.beat;
      lastNormalBeat = event.beat;
    }
  }
  if (difficulty === "hard") {
    for (let beat = 0; beat < song.totalBeats; beat += 1) {
      const key = Math.round(beat * 1000);
      // Avoid two different targets inside one hit window at fast ornaments.
      if ([...candidates.keys()].every((k) => Math.abs(k - key) >= 320)) {
        candidates.set(key, beat % song.beatsPerBar === 0 ? "center" : "rim");
      }
    }
  }
  return [...candidates.entries()]
    .sort(([a], [b]) => a - b)
    .map(([beat, kind], i) => ({
      id: `${song.id}-${difficulty}-${i}`,
      time: COUNT_IN_SECONDS + (beat / 1000) * secondsPerBeat,
      kind,
      hand: i % 2 === 0 ? "left" : "right",
    }));
}
