export type YutSoundCue =
  | "yut-throw"
  | "yut-impact"
  | "yut-step"
  | "yut-applause";

/** Original short wood and cloth sounds, synthesized without borrowed samples. */
export function renderYutSound(cue: YutSoundCue, sampleRate = 24000) {
  const duration =
    cue === "yut-applause"
      ? 1.65
      : cue === "yut-throw"
        ? 0.28
        : cue === "yut-impact"
          ? 0.17
          : 0.14;
  const samples = new Float32Array(Math.round(sampleRate * duration));
  let seed = cue === "yut-throw" ? 7321 : cue === "yut-impact" ? 8467 : 9413;
  let low = 0;
  const alpha = 1 - Math.exp((-2 * Math.PI * 1350) / sampleRate);
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const noise = ((seed >>> 0) / 4294967296) * 2 - 1;
    low += alpha * (noise - low);
    if (cue === "yut-applause") {
      // Three quiet pairs of hands, staggered and slightly uneven. Short
      // band-limited noise attacks sound like palms rather than wood or shots.
      for (const offset of [
        0.04, 0.11, 0.19, 0.31, 0.39, 0.52, 0.61, 0.69, 0.82, 0.91, 1.03, 1.14,
        1.23, 1.34,
      ]) {
        const age = t - offset;
        if (age < 0 || age > 0.16) continue;
        const attack = Math.min(1, age / 0.0015);
        const tail = Math.exp(-age * 50);
        const envelope = attack * tail * (1 - offset / 2.3);
        samples[i] +=
          ((noise - low) * 0.12 +
            low * 0.2 +
            Math.sin(2 * Math.PI * 1050 * age) * 0.035) *
          envelope;
      }
    } else if (cue === "yut-throw") {
      // A sleeve/air swish plus the sticks briefly touching as they leave the hand.
      const envelope = Math.sin((Math.PI * t) / duration) ** 2;
      samples[i] = low * envelope * 0.36;
      for (const offset of [0.012, 0.038, 0.066]) {
        const local = t - offset;
        if (local < 0) continue;
        samples[i] +=
          Math.sin(2 * Math.PI * 680 * local) *
          Math.exp(-local * 110) *
          Math.min(1, local / 0.002) *
          0.08;
      }
    } else {
      const step = cue === "yut-step";
      const base = step ? 380 : 255;
      const attack = Math.min(1, t / 0.002);
      const body = Math.sin(2 * Math.PI * base * t) * Math.exp(-t * 38);
      const wood = Math.sin(2 * Math.PI * base * 2.73 * t) * Math.exp(-t * 76);
      samples[i] =
        (body * (step ? 0.2 : 0.28) +
          wood * 0.1 +
          low * Math.exp(-t * 95) * 0.32) *
        attack;
    }
    samples[i] *= Math.min(1, (samples.length - i - 1) / (sampleRate * 0.025));
  }
  return { samples, sampleRate };
}
