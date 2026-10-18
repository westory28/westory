"""Render Westory's original naval battle score using only numpy synthesis.

24 bars of 4/4 at 128 BPM = 45 seconds. A martial reed call, plucked-string
ostinato, low bowed pulses, barrel/waisted-drum colours and a struck gong evoke
a Joseon court/military ensemble. These are original synthesized timbres and
composition, not recordings or a reconstruction of historical performance.
All note/room tails wrap into the beginning for uninterrupted native looping.
"""
from pathlib import Path
import wave
import numpy as np

RATE = 22050
BPM = 128
BEAT = 60 / BPM
BARS = 24
LENGTH = BARS * 4 * BEAT
SIZE = round(LENGTH * RATE)
rng = np.random.default_rng(20261018)
stems = {name: np.zeros(SIZE, dtype=np.float64)
         for name in ("reed", "strings", "drums", "metal")}


def add(signal, beat, gain, stem):
    indices = (round(beat * BEAT * RATE) + np.arange(len(signal))) % SIZE
    np.add.at(stems[stem], indices, signal * gain)


def timeline(duration):
    return np.arange(round(duration * RATE)) / RATE


def smooth_noise(length, width):
    return np.convolve(rng.normal(0, 1, length), np.ones(width) / width, "same")


def envelope(t, duration, attack, release):
    return np.minimum(t / attack, 1) * np.clip((duration + release - t) / release, 0, 1)


def reed(midi, beats, force=1):
    """Bright double-reed colour with breath, attack scoop and delayed vibrato."""
    duration = beats * BEAT
    t = timeline(duration + .065)
    frequency = 440 * 2 ** ((midi - 69) / 12)
    bend = -.038 * np.exp(-t * 40)
    vibrato = .0065 * np.sin(2 * np.pi * 5.3 * t) * np.minimum(t / .16, 1)
    phase = 2 * np.pi * frequency * np.cumsum(1 + bend + vibrato) / RATE
    signal = np.zeros_like(t)
    # Upper partials keep the call audible over drums; the high roll-off avoids
    # a piercing square-wave lead on classroom speakers. No sampled instrument.
    for harmonic in range(1, min(13, int(8500 / frequency))):
        partial = frequency * harmonic
        formant = 1 + .85 * np.exp(-((partial - 1450) / 800) ** 2)
        weight = formant / harmonic ** 1.38 * np.exp(-partial / 7000)
        signal += weight * np.sin(harmonic * phase + .06 * harmonic)
    signal += .025 * smooth_noise(len(t), 3)
    env = envelope(t, duration, .014, .065)
    env *= (.87 + .13 * np.sin(np.pi * np.minimum(t / max(duration, .1), 1)))
    return signal * env * force


def pluck(midi, beats=.38):
    t = timeline(beats * BEAT + .28)
    frequency = 440 * 2 ** ((midi - 69) / 12)
    phase = 2 * np.pi * frequency * (t + .0005 * (1 - np.exp(-t * 38)))
    signal = sum(
        np.sin(phase * (partial + .00010 * partial ** 2))
        * np.exp(-t * (5 + .8 * partial)) / partial ** 1.15
        for partial in range(1, 8)
    )
    return signal * envelope(t, beats * BEAT, .003, .28)


def bowed(midi, beats):
    duration = beats * BEAT
    t = timeline(duration + .09)
    frequency = 440 * 2 ** ((midi - 69) / 12)
    phase = 2 * np.pi * frequency * t + .009 * np.sin(2 * np.pi * 4.8 * t)
    signal = sum(np.sin(phase * p) / p ** 1.65 for p in range(1, 7))
    return signal * envelope(t, duration, .024, .09)


def drum(kind="buk", strength=1):
    """Damped membrane modes, pitch drop and short stick/leather attack."""
    deep = kind == "buk"
    low = kind == "janggu-low"
    duration = .85 if deep else .38
    t = timeline(duration)
    fundamental = 63 if deep else 137 if low else 246
    pitch_drop = (.045 if deep else .014) * (1 - np.exp(-t * 38))
    phase = 2 * np.pi * fundamental * (t + pitch_drop * .19)
    modes = [(1, 1, 5.8), (1.59, .38, 10), (2.14, .19, 17), (2.65, .10, 24)]
    signal = sum(gain * np.sin(phase * ratio) * np.exp(-t * decay * (1 if deep else 1.8))
                 for ratio, gain, decay in modes)
    noise = smooth_noise(len(t), 3 if deep else 2)
    signal += noise * (.38 if deep else .72) * np.exp(-t * (70 if deep else 48))
    env = np.minimum(t / .0018, 1) * np.clip((duration - t) / .04, 0, 1)
    return signal * env * strength


def gong(beats=6):
    """Inharmonic metal bloom: restrained jing-like punctuation, not a cymbal."""
    duration = beats * BEAT
    t = timeline(duration)
    signal = np.zeros_like(t)
    for hz, gain, decay in [(108, .42, 1.7), (173, .64, 1.3), (247, .46, 1.8),
                            (361, .31, 2.1), (517, .19, 2.6), (751, .12, 3.3),
                            (1087, .075, 4.1), (1597, .045, 5)]:
        shimmer = 1 + .0015 * np.sin(2 * np.pi * 6.1 * t)
        phase = 2 * np.pi * hz * np.cumsum(shimmer) / RATE
        signal += gain * np.sin(phase) * np.exp(-t * decay)
    signal += smooth_noise(len(t), 4) * .2 * np.exp(-t * 35)
    return signal * np.minimum(t / .008, 1) * np.clip((duration - t) / .15, 0, 1)


# Each tuple is (quarter-note position, MIDI note, duration). Original D-minor
# pentatonic battle calls use short answers and octave leaps rather than pads.
CALL = [
    [(0, 74, .65), (.75, 74, .20), (1, 77, .40), (1.5, 79, .40), (2.25, 81, 1.10), (3.5, 79, .35)],
    [(0, 77, .70), (1, 74, .35), (1.5, 72, .35), (2, 74, 1.15), (3.5, 69, .35)],
    [(0, 72, .45), (.75, 74, .45), (1.5, 77, .40), (2, 79, .65), (3, 77, .35), (3.5, 74, .35)],
    [(0, 72, .70), (1, 69, .55), (2, 67, .40), (2.75, 69, .35), (3.5, 72, .35)],
    [(0, 81, .65), (.75, 79, .20), (1, 77, .40), (1.5, 79, .40), (2, 84, 1.10), (3.5, 81, .35)],
    [(0, 79, .70), (1, 77, .35), (1.5, 74, .35), (2.25, 77, .65), (3.25, 79, .50)],
    [(0, 77, .35), (.5, 79, .35), (1, 81, .60), (2, 79, .35), (2.5, 77, .35), (3.25, 74, .50)],
    [(0, 72, .60), (1, 69, .65), (2, 74, .85), (3.25, 72, .25), (3.75, 69, .18)],
]
ROOTS = [38, 38, 36, 33, 38, 41, 36, 33]

for bar in range(BARS):
    start = bar * 4
    root = ROOTS[bar % 8]
    # Six four-bar phrases: attack, answer, gathering, charge, peak, turn-around.
    phrase = bar // 4
    energy = [1, 1.10, .65, 1.13, 1.22, 1.05][phrase]
    lead_gain = [.235, .25, .16, .26, .285, .24][phrase]

    # Galloping low strings and hard plucked attacks hold the forward motion.
    for beat in [0, .75, 1.5, 2, 2.75, 3.5]:
        add(bowed(root, .32 if beat % 1 else .48), start + beat, .12 * energy, "strings")
    pattern = [12, 19, 24, 19, 15, 19, 24, 19]
    for step, interval in enumerate(pattern):
        add(pluck(root + interval), start + step * .5, .10 * energy, "strings")
        if phrase == 4 and step in (1, 3, 5, 7):
            add(pluck(root + interval + 12, .2), start + step * .5 + .25, .035, "strings")

    motif = CALL[bar % 8]
    if phrase == 2:
        # Drum-led breathing room makes the next full ensemble feel larger.
        motif = [(0, root + 24, 1.35), (2.5, root + 31, .55)]
    for beat, note, length in motif:
        add(reed(note, length), start + beat, lead_gain, "reed")
        if phrase in (3, 4) and length >= .6:
            add(reed(note - 12, length * .92, .88), start + beat + .025, .07, "reed")
        if phrase in (1, 4) and length >= .6:
            # Quick grace note belongs to the new melody, not a sampled ornament.
            add(reed(note - 2, .09), start + beat - .10, lead_gain * .6, "reed")

    # Buk anchors the beat; two janggu-like heads answer asymmetrically.
    for beat, accent in [(0, .79), (1.5, .45), (2, .66), (3.25, .44)]:
        add(drum(), start + beat, accent * energy, "drums")
    for beat, accent in [(.5, .25), (1, .40), (1.75, .22), (2.5, .30), (3, .43), (3.75, .25)]:
        add(drum("janggu-high"), start + beat, accent * energy, "drums")
    for beat in [.75, 2.75]:
        add(drum("janggu-low"), start + beat, .29 * energy, "drums")

    if bar % 4 == 3:
        # Rising sixteenth-note roll leads into the next phrase; the final roll
        # resolves directly to bar one's drum instead of fading to silence.
        for step in range(6):
            add(drum("janggu-low" if step % 2 else "janggu-high"),
                start + 2.5 + step * .25, (.12 + step * .036) * energy, "drums")
    if bar in (0, 4, 12, 16, 20):
        add(gong(7 if bar == 16 else 6), start, .23 if bar != 16 else .32, "metal")
    if bar == 11:
        for step in range(8):
            add(drum("janggu-low"), start + 2 + step * .25, .10 + step * .035, "drums")


# A short, circular room binds the ensemble while preserving drum transients.
mix = np.zeros(SIZE, dtype=np.float64)
for name, dry in stems.items():
    wet = .55 if name == "drums" else 1
    mix += dry
    for delay, gain in [(.053, .12), (.113, .10), (.193, .075), (.307, .04)]:
        mix += np.roll(dry, round(delay * RATE)) * gain * wet
mix -= mix.mean()
# Gentle saturation catches simultaneous impacts; final headroom is 2.5 dB.
mix = np.tanh(mix * 1.08)
mix *= .75 / np.max(np.abs(mix))
output = Path(__file__).resolve().parents[1] / "public/assets/weplay/naval/tide-of-victory.wav"
with wave.open(str(output), "wb") as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(RATE)
    audio.writeframes(np.round(mix * 32767).astype("<i2").tobytes())
print(f"Original battle score: {output.name}; {BPM} BPM; {LENGTH:.2f}s; "
      f"{output.stat().st_size:,} bytes; peak {np.max(np.abs(mix)):.3f}; "
      f"RMS {np.sqrt(np.mean(mix ** 2)):.3f}; loop step {abs(mix[0] - mix[-1]):.5f}")
