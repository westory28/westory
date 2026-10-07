export type WeplaySoundCue = "word" | "cannon" | "special";

// Original, deterministic PCM sound design. These short buffers need no network
// request or decoder: wood/iron loading, a low cannon report and a naval volley.
const SAMPLE_RATE = 24000;

function noiseGenerator(seed: number) {
  let value = seed;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return ((value >>> 0) / 4294967296) * 2 - 1;
  };
}

function cannon(sampleRate: number, seed: number) {
  const output = new Float32Array(Math.ceil(sampleRate * 0.98));
  const noise = noiseGenerator(seed);
  const bodyAlpha = 1 - Math.exp((-2 * Math.PI * 280) / sampleRate);
  const airAlpha = 1 - Math.exp((-2 * Math.PI * 1700) / sampleRate);
  let low = 0;
  let air = 0;
  for (let index = 0; index < output.length; index++) {
    const time = index / sampleRate;
    const white = noise();
    low += bodyAlpha * (white - low);
    air += airAlpha * (white - air);
    const attack = Math.min(1, time / 0.002);
    const report = air * Math.exp(-time * 31) * 1.25;
    const smoke = low * Math.exp(-time * 5.6) * 1.8;
    const body =
      Math.sin(2 * Math.PI * (49 * time + 1.7 * (1 - Math.exp(-time * 17)))) *
      Math.exp(-time * 12) *
      0.38;
    output[index] = (report + smoke + body) * attack;
  }
  return output;
}

function mix(
  target: Float32Array,
  source: Float32Array,
  start: number,
  gain: number,
) {
  for (
    let index = 0;
    index < source.length && index + start < target.length;
    index++
  )
    target[start + index] += source[index] * gain;
}

export function renderWeplaySound(
  cue: WeplaySoundCue,
  sampleRate = SAMPLE_RATE,
) {
  const duration = cue === "word" ? 0.23 : cue === "cannon" ? 1.12 : 2.44;
  const samples = new Float32Array(Math.round(duration * sampleRate));
  if (cue === "word") {
    const noise = noiseGenerator(0x4a01);
    let grain = 0;
    const alpha = 1 - Math.exp((-2 * Math.PI * 1600) / sampleRate);
    for (let index = 0; index < samples.length; index++) {
      const time = index / sampleRate;
      grain += alpha * (noise() - grain);
      for (const offset of [0, 0.068]) {
        const local = time - offset;
        if (local < 0) continue;
        const attack = Math.min(1, local / 0.0015);
        const wood =
          Math.sin(2 * Math.PI * 215 * local) * Math.exp(-local * 53);
        const iron =
          (Math.sin(2 * Math.PI * 740 * local) +
            Math.sin(2 * Math.PI * 1171 * local) * 0.35) *
          Math.exp(-local * 66);
        samples[index] +=
          (wood * 0.12 + iron * 0.034 + grain * Math.exp(-local * 90) * 0.3) *
          attack *
          (offset === 0 ? 1 : 0.65);
      }
    }
  } else if (cue === "cannon") {
    const shot = cannon(sampleRate, 0x7b31);
    mix(samples, shot, 0, 0.85);
    mix(samples, shot, Math.round(0.087 * sampleRate), 0.15);
    mix(samples, shot, Math.round(0.164 * sampleRate), 0.06);
  } else {
    const noise = noiseGenerator(0x8c42);
    let wind = 0;
    for (let index = 0; index < samples.length; index++) {
      const time = index / sampleRate;
      wind += 0.04 * (noise() - wind);
      samples[index] =
        wind * Math.sin(Math.min(1, time / 1.5) * Math.PI) * 0.24;
    }
    // Match the ten projectiles in NavalSpecialAttack: fire begins at 480 ms,
    // the final impact lands at 1400 ms and the sea/air tail ends before 2.5 s.
    for (let shot = 0; shot < 10; shot++) {
      const start = 0.48 + (0.92 * shot) / 9;
      mix(
        samples,
        cannon(sampleRate, 0x9101 + shot * 731),
        Math.round(start * sampleRate),
        0.21 + shot * 0.038,
      );
    }
    mix(
      samples,
      cannon(sampleRate, 0x9f50),
      Math.round(1.4 * sampleRate),
      0.48,
    );
  }
  const ceiling = cue === "word" ? 0.27 : cue === "cannon" ? 0.7 : 0.79;
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const gain = peak > ceiling ? ceiling / peak : 1;
  const fadeLength = Math.round(sampleRate * 0.035);
  for (let index = 0; index < samples.length; index++) {
    const fade = Math.min(1, (samples.length - index - 1) / fadeLength);
    samples[index] *= gain * fade;
  }
  return { samples, sampleRate };
}
