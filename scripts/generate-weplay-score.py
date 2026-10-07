"""Render the original Weplay score. Requires numpy; no sampled music or external audio.

24 bars, 6/8, dotted-quarter = 64, D-minor pentatonic. Plucked strings,
breathy flute, low bowed tones and drums are synthesized from oscillators/noise.
Output is mono PCM WAV (22.05 kHz) for broad browser support and a small payload.
"""
from pathlib import Path
import wave
import numpy as np

RATE = 22050
PULSE = 60 / 64 / 3
BARS = 24
LENGTH = BARS * 6 * PULSE
SIZE = round(LENGTH * RATE)
rng = np.random.default_rng(20261007)
mix = np.zeros(SIZE, dtype=np.float64)


def add(signal, start, gain=1):
    indices = (round(start * RATE) + np.arange(len(signal))) % SIZE
    np.add.at(mix, indices, signal * gain)


def tone(midi, beats, instrument="plucked"):
    duration = beats * PULSE
    t = np.arange(round((duration + .35) * RATE)) / RATE
    frequency = 440 * 2 ** ((midi - 69) / 12)
    if instrument == "flute":
        breath = np.convolve(rng.normal(0, 1, len(t)), np.ones(6) / 6, "same")
        vibrato = .005 * np.sin(2 * np.pi * 4.6 * t) * np.minimum(t / .2, 1)
        phase = 2 * np.pi * frequency * np.cumsum(1 + vibrato - .015 * np.exp(-t * 18)) / RATE
        signal = np.sin(phase) + .16 * np.sin(2 * phase) + .065 * np.sin(3 * phase) + .032 * breath
        env = np.minimum(t / .09, 1) * np.clip((duration + .25 - t) / .25, 0, 1)
        env *= .86 + .14 * np.sin(np.pi * np.minimum(t / max(duration, .1), 1))
    elif instrument == "bowed":
        phase = 2 * np.pi * frequency * t
        signal = sum(np.sin(phase * partial + .006 * np.sin(2 * np.pi * 3.8 * t)) / partial ** 1.8 for partial in range(1, 6))
        env = np.minimum(t / .25, 1) * np.clip((duration + .3 - t) / .4, 0, 1)
    else:
        # Decaying harmonics and a subtle initial pitch bend evoke a plucked zither.
        phase = 2 * np.pi * frequency * (t + .00035 * (1 - np.exp(-t * 32)))
        signal = sum(np.sin(phase * (partial + .00015 * partial ** 2)) * np.exp(-t * (1.8 + .6 * partial)) / partial ** 1.2 for partial in range(1, 8))
        env = np.minimum(t / .006, 1) * np.clip((duration + .3 - t) / .15, 0, 1)
    return signal * env


def drum(deep=True):
    t = np.arange(round(.75 * RATE)) / RATE
    noise = rng.normal(0, 1, len(t))
    if deep:
        phase = 2 * np.pi * (58 * t + 22 * .045 * (1 - np.exp(-t / .045)))
        return np.sin(phase) * np.exp(-t * 7) + .13 * noise * np.exp(-t * 50)
    return .35 * noise * np.exp(-t * 28) + .42 * np.sin(2 * np.pi * 178 * t) * np.exp(-t * 18)


# Every tuple is (eighth-note position, MIDI note, eighth-note duration).
theme = [
    [(0, 74, 2), (2, 77, 1), (3, 79, 2), (5, 77, 1)],
    [(0, 74, 3), (3, 72, 1), (4, 69, 2)],
    [(0, 67, 2), (2, 69, 1), (3, 72, 2), (5, 74, 1)],
    [(0, 69, 4), (4, 67, 2)],
    [(0, 74, 1), (1, 77, 1), (2, 79, 1), (3, 81, 2), (5, 79, 1)],
    [(0, 77, 3), (3, 74, 2), (5, 72, 1)],
    [(0, 69, 2), (2, 72, 1), (3, 74, 2), (5, 77, 1)],
    [(0, 74, 5)],
]
roots = [50, 48, 43, 45, 50, 48, 45, 50]
for bar in range(BARS):
    start = bar * 6 * PULSE
    root = roots[bar % 8]
    section = bar // 8
    # A quiet drone supports the lead without filling every register.
    add(tone(root - 12, 5.7, "bowed"), start, .075)
    add(tone(root - 5, 5.7, "bowed"), start, .025)
    for beat, interval in [(0, 12), (1, 19), (2, 24), (3, 19), (4, 12), (5, 19)]:
        add(tone(root + interval, 1.7), start + beat * PULSE, .085 if beat % 3 else .11)
    for beat, note, length in theme[bar % 8]:
        # Middle response shifts down an octave and uses strings for contrast.
        instrument = "plucked" if section == 1 else "flute"
        pitch = note - 12 if section == 1 else note
        add(tone(pitch, length * .9, instrument), start + beat * PULSE, .19 if section != 1 else .25)
        if section == 2 and length >= 2:
            add(tone(note - 12, length * .8), start + (beat + .07) * PULSE, .04)
    add(drum(), start, .24)
    add(drum(), start + 3 * PULSE, .16)
    for beat in [2, 4.5, 5]:
        add(drum(False), start + beat * PULSE, .075 if beat != 5 else .11)
    if bar % 8 == 7:
        for beat in [4, 4.5, 5, 5.5]:
            add(drum(False), start + beat * PULSE, .08)

# Circular room tail makes the end meet the beginning without an audible cut.
dry = mix.copy()
for delay, gain in [(.079, .1), (.151, .09), (.281, .065), (.431, .045)]:
    mix += np.roll(dry, round(delay * RATE)) * gain
mix -= mix.mean()
mix = np.tanh(mix * 1.2)
mix *= .84 / np.max(np.abs(mix))
output = Path(__file__).resolve().parents[1] / "public/assets/weplay/naval/tide-of-victory.wav"
with wave.open(str(output), "wb") as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(RATE)
    audio.writeframes((mix * 32767).astype("<i2").tobytes())
print(f"Original score: {output.name}; {LENGTH:.2f}s; {output.stat().st_size:,} bytes; peak {np.max(np.abs(mix)):.3f}; RMS {np.sqrt(np.mean(mix ** 2)):.3f}")
