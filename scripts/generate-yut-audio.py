"""Render Westory's original 'Moonlit Courtyard' score with NumPy only.

No recordings, external samples, MIDI imports, or existing game melodies.
24 bars in 12/8, dotted-quarter = 84. G/A/C/D/E modal pentatonic melody.
The three eight-bar phrases have different lead/accompaniment arrangements.
32 kHz stereo PCM keeps the complete, seamless 68.57 s loop below 9 MB.
"""

from pathlib import Path
import hashlib
import json
import wave

import numpy as np


RATE = 32000
PULSE = 60 / 84 / 3  # eighth note
BARS = 24
SIZE = round(BARS * 12 * PULSE * RATE)
LENGTH = SIZE / RATE
RNG = np.random.default_rng(20261018)
MIX = np.zeros((SIZE, 2), dtype=np.float64)


def place(signal, eighth, gain=1.0, pan=0.0):
    """Equal-power pan; note releases can wrap across the loop boundary."""
    indices = (round(eighth * PULSE * RATE) + np.arange(len(signal))) % SIZE
    angle = (pan + 1) * np.pi / 4
    np.add.at(MIX[:, 0], indices, signal * gain * np.cos(angle))
    np.add.at(MIX[:, 1], indices, signal * gain * np.sin(angle))


def frequency(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def smooth_noise(size, samples=9):
    return np.convolve(RNG.normal(0, 1, size), np.ones(samples) / samples, "same")


def pluck(midi, length=3.0, low=False, bend=False):
    """Decaying, slightly inharmonic strings with pick/wood-body transients.

    This is an impression of a plucked Korean zither, not a sampled gayageum.
    Unequal partial decay and late, gentle pitch pressure avoid a sine-beep tone.
    """
    duration = length * PULSE
    t = np.arange(round((duration + 1.0) * RATE)) / RATE
    vibrato = np.sin(2 * np.pi * 4.1 * t) * (1 - np.exp(-t * 4))
    pressure = .009 * vibrato if bend else .0015 * vibrato
    pressure += .003 * np.exp(-t * 27)
    phase = 2 * np.pi * frequency(midi) * np.cumsum(1 + pressure) / RATE
    signal = np.zeros_like(t)
    for partial in range(1, 15):
        inharmonic = partial * np.sqrt(1 + .00009 * partial**2)
        pick_position = abs(np.sin(partial * np.pi * .23))
        decay = (1.0 if low else 1.6) + .33 * partial**1.3
        weight = pick_position / partial**1.05
        signal += weight * np.cos(phase * inharmonic) * np.exp(-t * decay)
    pick = smooth_noise(len(t), 7)
    signal += .055 * pick * np.exp(-t * 95)
    for body, gain in [(174, .055), (286, .025), (418, .012)]:
        signal += gain * np.sin(2 * np.pi * body * t) * np.exp(-t * 22)
    envelope = np.minimum(t / .004, 1) * np.clip((duration + 1 - t) / .22, 0, 1)
    return signal * envelope


def flute(midi, length, lean=0.0):
    """Soft bamboo-reed-like lead, breath, pitch inflection and delayed vibrato."""
    duration = length * PULSE
    t = np.arange(round((duration + .22) * RATE)) / RATE
    progress = np.minimum(t / duration, 1)
    vibrato = .0045 * np.sin(2 * np.pi * (4.4 * t + .08 * t**2))
    vibrato *= np.minimum(t / .38, 1)
    inflection = -.015 * np.exp(-t * 13) + lean * np.sin(np.pi * progress)
    phase = 2 * np.pi * frequency(midi) * np.cumsum(1 + vibrato + inflection) / RATE
    breath = smooth_noise(len(t), 8)
    breath -= np.convolve(breath, np.ones(71) / 71, "same")
    signal = (
        np.sin(phase)
        + .26 * np.sin(phase * 2 + .25)
        + .095 * np.sin(phase * 3 + .8)
        + .027 * np.sin(phase * 4)
        + .11 * breath
    )
    envelope = np.minimum(t / .065, 1) ** 1.5
    envelope *= np.clip((duration + .22 - t) / .24, 0, 1)
    envelope *= .76 + .24 * np.sin(np.pi * progress)
    envelope *= 1 + .025 * np.sin(2 * np.pi * 5.3 * t)
    return signal * envelope


def support(midi, length):
    """Quiet string resonance under the sparse plucks, not an orchestral pad."""
    duration = length * PULSE
    t = np.arange(round((duration + .4) * RATE)) / RATE
    phase = 2 * np.pi * frequency(midi) * t
    signal = sum(
        np.sin(phase * partial + .012 * np.sin(2 * np.pi * 3.7 * t))
        / partial**2.2
        for partial in range(1, 5)
    )
    envelope = np.minimum(t / .4, 1) * np.clip((duration + .4 - t) / .6, 0, 1)
    return signal * envelope


def drum(deep=True):
    """Two soft membrane voices suggest janggu without sampled percussion."""
    t = np.arange(round(.7 * RATE)) / RATE
    noise = smooth_noise(len(t), 5)
    if deep:
        phase = 2 * np.pi * (71 * t + 15 * .03 * (1 - np.exp(-t / .03)))
        signal = np.sin(phase) * np.exp(-t * 11)
        signal += .24 * np.sin(phase * 1.51) * np.exp(-t * 19)
        signal += .13 * np.sin(phase * 2.08) * np.exp(-t * 29)
        signal += .1 * noise * np.exp(-t * 80)
    else:
        signal = .55 * np.sin(2 * np.pi * 182 * t) * np.exp(-t * 26)
        signal += .24 * np.sin(2 * np.pi * 295 * t) * np.exp(-t * 33)
        signal += .48 * noise * np.exp(-t * 41)
    return signal * np.minimum(t / .002, 1)


def bell(midi):
    t = np.arange(round(3 * RATE)) / RATE
    f = frequency(midi)
    signal = sum(
        gain * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t * decay)
        for ratio, gain, decay in [
            (1, .45, 1.6), (2.01, .16, 2.3), (2.76, .07, 3), (4.08, .025, 5)
        ]
    )
    return signal * np.minimum(t / .012, 1) * np.clip((3 - t) / .2, 0, 1)


# Written for this game. Each tuple: eighth-note offset, MIDI pitch, duration.
# Breathing room and an answering plucked phrase are intentional.
PHRASES = [
    [(1, 67, 2), (3, 69, 1), (4, 72, 3), (8, 74, 2), (10, 72, 1)],
    [(0, 69, 4), (5, 67, 2), (8, 64, 2)],
    [(1, 67, 2), (3, 72, 2), (6, 76, 3), (10, 74, 1)],
    [(0, 72, 5), (7, 69, 2), (10, 67, 1)],
    [(0, 74, 3), (4, 76, 2), (7, 79, 3)],
    [(0, 76, 2), (3, 74, 3), (7, 72, 2), (10, 69, 1)],
    [(1, 72, 3), (5, 69, 2), (8, 67, 3)],
    [(0, 69, 2), (3, 67, 6)],
    [(1, 64, 2), (4, 67, 3), (8, 69, 2)],
    [(0, 72, 2), (3, 69, 3), (7, 64, 3)],
    [(0, 62, 3), (4, 64, 2), (7, 67, 3)],
    [(1, 69, 2), (4, 72, 2), (7, 74, 4)],
    [(0, 76, 3), (4, 74, 2), (7, 72, 3)],
    [(0, 69, 2), (3, 67, 3), (7, 64, 3)],
    [(1, 67, 2), (4, 69, 2), (7, 72, 2), (10, 74, 1)],
    [(0, 72, 4), (6, 67, 4)],
    [(0, 67, 2), (3, 69, 1), (4, 72, 3), (8, 74, 2), (10, 76, 1)],
    [(0, 74, 2), (3, 72, 3), (7, 69, 3)],
    [(1, 72, 2), (4, 76, 2), (7, 79, 3)],
    [(0, 76, 2), (3, 74, 3), (7, 72, 3)],
    [(0, 74, 2), (3, 76, 2), (6, 79, 3), (10, 76, 1)],
    [(0, 74, 3), (4, 72, 3), (8, 69, 2)],
    [(0, 72, 2), (3, 69, 2), (6, 67, 3)],
    [(0, 64, 2), (3, 67, 5)],
]

VOICINGS = [
    (43, [55, 62, 67, 69]), (48, [55, 60, 64, 67]),
    (45, [57, 64, 67, 72]), (43, [55, 62, 67, 69]),
    (48, [55, 60, 64, 67]), (50, [57, 62, 67, 69]),
    (45, [57, 64, 67, 72]), (43, [55, 62, 67, 69]),
]

for bar, melody in enumerate(PHRASES):
    at = bar * 12
    phrase = bar // 8
    root, strings = VOICINGS[bar % 8]
    dynamic = [.85, .7, .94][phrase]
    # A quieter final bar releases into the returning downbeat.
    if bar == 23:
        dynamic *= .76
    place(pluck(root, 8, low=True), at, .17 * dynamic, -.18)
    place(support(root + 12, 10), at + .1, .025 * dynamic, .15)
    pattern = [(0, 0), (2, 2), (4.5, 1), (6, 3), (8, 2), (10, 1)]
    if phrase == 1:
        pattern = [(0, 0), (3, 2), (6, 1), (9, 3)]
    for beat, index in pattern:
        jitter = RNG.uniform(-.025, .025)
        place(
            pluck(strings[index], 3), at + beat + jitter,
            (.09 if beat else .12) * dynamic, -.48,
        )
    for beat, pitch, length in melody:
        if phrase == 1:
            place(pluck(pitch, length, bend=length >= 3), at + beat, .27, .22)
            # The flute answers only the longer phrase endings.
            if length >= 4:
                place(flute(pitch + 12, length - 1), at + beat + .8, .055, -.1)
        else:
            place(flute(pitch, length * .88, .004 if length > 2 else 0),
                  at + beat, .14 * dynamic, .08)
            if phrase == 2 and length >= 3:
                place(pluck(pitch - 12, 2.5, bend=True),
                      at + beat + 1.5, .075, .5)
    # Sparse 12/8 membrane pattern, with a light final pickup every four bars.
    for beat, gain in [(0, .15), (6, .11)]:
        place(drum(True), at + beat, gain * dynamic, -.12)
    if phrase != 1 or bar % 2 == 0:
        for beat, gain in [(3, .055), (8, .035), (9, .065), (11, .03)]:
            place(drum(False), at + beat, gain * dynamic, .25)
    if bar % 4 == 3 and bar != 23:
        place(drum(False), at + 10.5, .035, .28)
        place(drum(False), at + 11.5, .045, .28)
    if bar in (0, 8, 16):
        place(bell(79 if bar != 8 else 76), at, .075, .32)

# Circular stereo room: releases/taps at the end become the start's room tail.
# No fade-to-silence or duplicated intro interrupts repeat playback.
dry = MIX.copy()
for delay, gain, cross in [
    (.061, .075, False), (.097, .065, True), (.173, .055, True),
    (.257, .045, False), (.389, .03, True), (.557, .02, False),
]:
    source = dry[:, ::-1] if cross else dry
    MIX += np.roll(source, round(delay * RATE), axis=0) * gain
MIX -= MIX.mean(axis=0)
MIX *= .77 / np.max(np.abs(MIX))
pcm = np.round(MIX * 32767).astype("<i2")
output = Path(__file__).resolve().parents[1] / "public/assets/weplay/yut"
output.mkdir(parents=True, exist_ok=True)
score = output / "moonlit-courtyard.wav"
with wave.open(str(score), "wb") as audio:
    audio.setnchannels(2)
    audio.setsampwidth(2)
    audio.setframerate(RATE)
    audio.writeframes(pcm.tobytes())

report = {
    "title": "Moonlit Courtyard / 달빛 뜰",
    "composer": "Original procedural composition created for Westory Weplay",
    "generator": "scripts/generate-yut-audio.py",
    "seed": 20261018,
    "sampleRate": RATE,
    "channels": 2,
    "sampleBits": 16,
    "durationSeconds": LENGTH,
    "bytes": score.stat().st_size,
    "peak": round(float(np.max(np.abs(pcm))) / 32767, 6),
    "rms": round(float(np.sqrt(np.mean(MIX**2))), 6),
    "clippedSamples": int(np.count_nonzero(np.abs(pcm.astype(np.int32)) >= 32767)),
    "seamDelta": [round(float(v), 6) for v in MIX[0] - MIX[-1]],
    "sha256": hashlib.sha256(score.read_bytes()).hexdigest(),
}
(output / "audio-manifest.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print(json.dumps(report, ensure_ascii=True, indent=2))
