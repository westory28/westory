/** Original sonic logo: a warm pulse, an airy lift, then an open, glassy chord.
 * Deterministic stereo PCM; no external recordings, downloads, or decoder delay. */
export const WEPLAY_INTRO_SECONDS = 3.6;

export function renderWeplayIntroSound(sampleRate = 44100) {
  const length = Math.ceil(sampleRate * WEPLAY_INTRO_SECONDS);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const tau = Math.PI * 2;
  let seed = 937431;
  let air = 0;
  const tone = (time: number, frequency: number, decay: number) =>
    time < 0
      ? 0
      : (1 - Math.exp(-time * 95)) *
        Math.exp(-time * decay) *
        (Math.sin(tau * frequency * time) +
          0.14 * Math.sin(tau * frequency * 2.003 * time));
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const noise = ((seed >>> 0) / 4294967296) * 2 - 1;
    air += 0.18 * (noise - air);
    const pulse =
      tone(t - 0.08, 73.416, 3.6) * 0.62 + tone(t - 0.08, 146.832, 5.2) * 0.2;
    const firstLight = tone(t - 0.2, 587.33, 3.8) * 0.11;
    const lift = Math.max(0, 1 - Math.abs((t - 1.57) / 0.53));
    const sweep =
      lift *
      lift *
      (air * 0.13 + Math.sin(tau * (220 * t + 90 * t * t)) * 0.035);
    let l = pulse + firstLight + sweep;
    let r = pulse + firstLight + sweep;
    for (const [frequency, start, gain, pan] of [
      [293.665, 1.73, 0.3, -0.12],
      [440, 1.76, 0.2, 0.3],
      [659.255, 1.8, 0.15, -0.4],
      [739.989, 1.83, 0.1, 0.4],
      [1174.66, 1.88, 0.055, -0.2],
    ]) {
      const note = tone(t - start, frequency, 2.5) * gain;
      l += note * (1 - pan * 0.45);
      r += note * (1 + pan * 0.45);
    }
    left[i] = l;
    right[i] = r;
  }
  // Short, cross-fed reflections give depth without a long tail over gameplay.
  const dryLeft = left.slice();
  const dryRight = right.slice();
  for (const [delay, gain] of [
    [0.061, 0.19],
    [0.113, 0.14],
    [0.181, 0.09],
    [0.277, 0.05],
  ]) {
    const offset = Math.round(delay * sampleRate);
    for (let i = offset; i < length; i++) {
      left[i] += dryRight[i - offset] * gain;
      right[i] += dryLeft[i - offset] * gain;
    }
  }
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const fade = Math.min(
      1,
      i / (sampleRate * 0.01),
      (length - 1 - i) / (sampleRate * 0.18),
    );
    left[i] *= fade;
    right[i] *= fade;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const gain = 0.7 / Math.max(peak, 0.7);
  for (let i = 0; i < length; i++) {
    left[i] *= gain;
    right[i] *= gain;
  }
  return { channels: [left, right], sampleRate };
}
