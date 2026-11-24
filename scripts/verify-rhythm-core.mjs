import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const load = async (entry, globals = {}) => {
  const output = await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    target: "es2022",
  });
  const module = { exports: {} };
  vm.runInNewContext(output.outputFiles[0].text, {
    module,
    exports: module.exports,
    setTimeout,
    clearTimeout,
    ...globals,
  });
  return module.exports;
};
const base = "src/components/common/weplay/rhythm/";
const core = await load(`${base}rhythmCore.ts`);
const { RHYTHM_SONGS: songs } = await load(`${base}rhythmSongs.ts`);

assert.equal(songs.length, 4);
assert.equal(new Set(songs.map((s) => s.id)).size, 4);
assert.deepEqual(
  Array.from(songs, (s) => s.title),
  ["아리랑", "얼쑤, 달려라", "풍년 마당", "우리의 강산"],
);
for (const song of songs) {
  assert(song.duration >= 40 && song.duration <= 65, song.id);
  assert(song.credit && song.bpm > 0);
  assert.equal(
    Math.round(song.totalBeats / song.beatsPerBar),
    song.totalBeats / song.beatsPerBar,
  );
  assert(
    song.melody.every(
      (e) => e.beat >= 0 && e.beat + e.length <= song.totalBeats + 1e-7,
    ),
  );
  const charts = ["easy", "normal", "hard"].map((difficulty) => {
    const chart = core.createChart(song, difficulty);
    assert.deepEqual(
      chart,
      core.createChart(song, difficulty),
      "Charts must be deterministic",
    );
    assert.equal(new Set(chart.map((n) => n.id)).size, chart.length);
    assert(
      chart.every(
        (n, i) =>
          Number.isFinite(n.time) &&
          n.time >= 3 &&
          n.time < song.duration - 1 &&
          ["center", "rim"].includes(n.kind) &&
          n.hand === (i % 2 === 0 ? "left" : "right") &&
          (i === 0 || n.time > chart[i - 1].time),
      ),
      `${song.id}/${difficulty}: sorted chart alternates left/right from the first left hand`,
    );
    assert(chart.some((n) => n.kind === "rim"));
    assert(chart.some((n) => n.kind === "center"));
    return chart;
  });
  assert(
    charts[0].length < charts[1].length && charts[1].length < charts[2].length,
    `${song.id}: density should increase`,
  );
}
// Assign hands after time sorting and merging simultaneous melody onsets.
const unorderedSong = {
  ...songs[0],
  id: "unordered-ties",
  bpm: 120,
  totalBeats: 0,
  melody: [2, 0, 1, 1, 3].map((beat) => ({ beat, length: 0.25, pitch: 60 })),
};
const orderedChart = core.createChart(unorderedSong, "hard");
assert.deepEqual(
  Array.from(orderedChart, (note) => note.time),
  [3, 3.5, 4, 4.5],
);
assert.deepEqual(
  Array.from(orderedChart, (note) => note.hand),
  ["left", "right", "left", "right"],
);
assert.deepEqual(
  orderedChart,
  core.createChart(unorderedSong, "hard"),
  "Tied onsets retain deterministic alternating hands",
);
for (const sign of [-1, 1]) {
  assert.equal(core.getJudgement(sign * 0.065), "perfect");
  assert.equal(core.getJudgement(sign * 0.0651), "good");
  assert.equal(core.getJudgement(sign * 0.13), "good");
  assert.equal(core.getJudgement(sign * 0.1301), "ok");
  assert.equal(core.getJudgement(sign * 0.16), "ok");
  assert.equal(core.getJudgement(sign * 0.1601), "miss");
}
for (const delta of [NaN, Infinity, -Infinity])
  assert.equal(core.getJudgement(delta), "miss");
const notes = [
  { id: "a", time: 3, kind: "center", hand: "left" },
  { id: "b", time: 3.2, kind: "rim", hand: "right" },
  { id: "c", time: 3.4, kind: "center", hand: "left" },
];
const judged = new Set();
assert.equal(
  core.findHit(notes, judged, "center", 3, "right"),
  null,
  "Correct surface with wrong hand does not consume a note",
);
assert.equal(judged.size, 0);
assert.equal(core.findHit(notes, judged, "center", 3, "left")?.id, "a");
assert.equal(core.findHit(notes, judged, "rim", 3.2, "left"), null);
assert.equal(core.findHit(notes, judged, "rim", 3.2, "right")?.id, "b");
for (const note of notes) {
  for (const sign of [-1, 1]) {
    assert.equal(
      core.findHit(
        [note],
        judged,
        note.kind,
        note.time + sign * 0.16,
        note.hand,
      )?.id,
      note.id,
      "Correct hand includes exact judgement boundary",
    );
    assert.equal(
      core.findHit(
        [note],
        judged,
        note.kind,
        note.time + sign * 0.1601,
        note.hand,
      ),
      null,
      "Correct hand cannot exceed judgement boundary",
    );
    assert.equal(
      core.findHit(
        [note],
        judged,
        note.kind,
        note.time + sign * 0.16,
        note.hand === "left" ? "right" : "left",
      ),
      null,
      "Wrong hand remains excluded at the judgement boundary",
    );
  }
}
const simultaneous = [
  { id: "sim-left", time: 3, kind: "center", hand: "left" },
  { id: "sim-right", time: 3, kind: "center", hand: "right" },
  { id: "sim-later-left", time: 3.1, kind: "center", hand: "left" },
];
assert.equal(
  core.findHit(simultaneous, judged, "center", 3, "left")?.id,
  "sim-left",
);
assert.equal(
  core.findHit(simultaneous, judged, "center", 3, "right")?.id,
  "sim-right",
  "Same-time tie still respects requested hand",
);
assert.equal(
  core.findHit(simultaneous, new Set(["sim-left"]), "center", 3, "right")?.id,
  "sim-right",
  "Consuming the left note does not consume its simultaneous right note",
);
assert.equal(
  core.findHit(simultaneous, judged, "center", 3.1, "right")?.id,
  "sim-right",
  "Earlier wrong-hand notes cannot hide an eligible matching-hand note",
);
assert.equal(
  core.findHit(simultaneous, judged, "center", 3.05, "left")?.id,
  "sim-left",
  "Equal-distance ties retain the earlier eligible note",
);
assert.equal(
  core.findHit(simultaneous, judged, "center", 3.09, "left")?.id,
  "sim-left",
  "A late valid earlier note takes priority over a nearer future note",
);
assert.equal(
  core.findHit(notes, judged, "rim", 3),
  null,
  "Wrong surface cannot hit the center",
);
assert.equal(core.findHit(notes, judged, "center", 2.84)?.id, "a");
assert.equal(core.findHit(notes, judged, "center", 2.839), null);
assert.equal(core.findHit(notes, judged, "rim", 3.36)?.id, "b");
assert.equal(core.findHit(notes, judged, "center", NaN), null);
assert.equal(core.findHit(notes, judged, "center", 3)?.id, "a");
judged.add("a");
assert.equal(
  core.findHit(notes, judged, "center", 3),
  null,
  "An already consumed note cannot score twice",
);
assert.equal(core.findHit(notes, judged, "center", 3.3)?.id, "c");

// Actual input adjudication penalizes only mistakes during the playable phrase.
assert.equal(core.INPUT_RECOVERY_SECONDS, 0.22);
const phrase = [
  { id: "phrase-first", time: 2, kind: "rim", hand: "right" },
  { id: "phrase-middle", time: 4, kind: "center", hand: "left" },
  { id: "phrase-last", time: 6, kind: "rim", hand: "right" },
];
for (const elapsed of [NaN, Infinity, -Infinity, 0, 1.8399, 6.1601, 100]) {
  const result = core.judgeInput(
    phrase,
    new Set(),
    "center",
    "left",
    elapsed,
    9,
  );
  assert.equal(
    result.judgement,
    "ignored",
    "Count-in, outro and non-finite times have no penalty",
  );
  assert.equal(result.note, null);
  assert.equal(result.blockedUntil, 9, "Ignored input cannot extend recovery");
}
assert.equal(
  core.judgeInput([], new Set(), "center", "left", 3, 0).judgement,
  "ignored",
);
for (const elapsed of [1.84, 6.16])
  assert.equal(
    core.judgeInput(phrase, new Set(), "rim", "right", elapsed, 0).judgement,
    "ok",
    "Phrase boundaries include the exact 160ms window",
  );
for (const sign of [-1, 1]) {
  for (const [delta, expected] of [
    [0.065, "perfect"],
    [0.0651, "good"],
    [0.13, "good"],
    [0.1301, "ok"],
    [0.16, "ok"],
    [0.1601, "miss"],
  ]) {
    const result = core.judgeInput(
      phrase,
      new Set(),
      "center",
      "left",
      4 + sign * delta,
      0,
    );
    assert.equal(
      result.judgement,
      expected,
      "Input judgement retains existing timing grades",
    );
    assert.equal(
      result.note?.id || null,
      expected === "miss" ? null : "phrase-middle",
    );
  }
}
for (const [kind, hand, elapsed] of [
  ["center", "right", 4],
  ["rim", "left", 4],
  ["center", "left", 3],
]) {
  const untouched = new Set();
  const result = core.judgeInput(phrase, untouched, kind, hand, elapsed, 0);
  assert.equal(
    result.judgement,
    "miss",
    "Wrong hand, surface and empty beat all miss",
  );
  assert.equal(result.note, null);
  assert(Math.abs(result.blockedUntil - elapsed - 0.22) < 1e-8);
  assert.equal(
    untouched.size,
    0,
    "A wrong input never consumes any future note",
  );
}
const rapidConsumed = new Set();
let rapidRecovery = 0;
let rapidScore = core.createScore();
for (const note of notes) {
  const result = core.judgeInput(
    notes,
    rapidConsumed,
    note.kind,
    note.hand,
    note.time,
    rapidRecovery,
  );
  assert.equal(result.note?.id, note.id);
  assert.equal(
    result.judgement,
    "perfect",
    "Correct notes 200ms apart remain playable",
  );
  rapidRecovery = result.blockedUntil;
  rapidConsumed.add(note.id);
  rapidScore = core.applyJudgement(rapidScore, result.judgement);
}
assert.equal(rapidRecovery, 0, "Successful inputs introduce no cooldown");
assert.equal(rapidScore.score, 3000);
assert.equal(rapidScore.combo, 3);
const duplicate = core.judgeInput(
  notes,
  new Set(["a"]),
  "center",
  "left",
  3,
  0,
);
assert.equal(
  duplicate.judgement,
  "miss",
  "Repeating an already consumed note is a mistake",
);
const duplicateNext = core.judgeInput(
  notes,
  new Set(["a"]),
  "rim",
  "right",
  3.2,
  duplicate.blockedUntil,
);
assert.equal(
  duplicateNext.judgement,
  "miss",
  "Duplicate input recovery blocks the next note until the player stops",
);
assert.equal(duplicateNext.note, null);
assert(Math.abs(duplicateNext.blockedUntil - 3.42) < 1e-8);
const mistake = core.judgeInput(notes, new Set(), "center", "right", 3.18, 0);
assert.equal(mistake.judgement, "miss");
const recovery = core.judgeInput(
  notes,
  new Set(),
  "center",
  "left",
  3.4,
  mistake.blockedUntil,
);
assert.equal(recovery.note?.id, "c");
assert.equal(
  recovery.judgement,
  "perfect",
  "Exactly 220ms without a new mistake restores normal input",
);
const tooSoon = core.judgeInput(
  notes,
  new Set(),
  "center",
  "left",
  3.3999,
  mistake.blockedUntil,
);
assert.equal(
  tooSoon.judgement,
  "miss",
  "An early retry extends recovery even if a matching note exists",
);
assert(Math.abs(tooSoon.blockedUntil - 3.6199) < 1e-8);
const mash = () => {
  const consumed = new Set();
  let blockedUntil = 0;
  let score = core.createScore();
  const results = [];
  for (let index = 0; index <= 12; index++) {
    const elapsed = 2.9 + index * 0.05;
    const hand = index === 0 ? "right" : "left";
    const result = core.judgeInput(
      notes,
      consumed,
      "center",
      hand,
      elapsed,
      blockedUntil,
    );
    assert.equal(
      result.judgement,
      "miss",
      "Continuing to mash prevents scoring through following notes",
    );
    assert.equal(result.note, null);
    blockedUntil = result.blockedUntil;
    score = core.applyJudgement(score, result.judgement);
    results.push(result);
  }
  assert.equal(
    consumed.size,
    0,
    "Missed inputs leave note expiration to the normal game clock",
  );
  assert.equal(score.score, 0);
  assert.equal(score.combo, 0);
  assert.equal(score.miss, 13);
  return results;
};
assert.deepEqual(
  mash(),
  mash(),
  "The same mash timeline has deterministic outcomes",
);
for (const song of songs)
  for (const difficulty of ["easy", "normal", "hard"]) {
    const chart = core.createChart(song, difficulty);
    for (const lateness of [0, 0.159, 0.16, "jitter"]) {
      const consumed = new Set();
      let blockedUntil = 0;
      for (const [index, note] of chart.entries()) {
        const delay =
          lateness === "jitter"
            ? [0.139, 0.159, 0.15, 0.16, 0.145][index % 5]
            : lateness;
        const result = core.judgeInput(
          chart,
          consumed,
          note.kind,
          note.hand,
          note.time + delay,
          blockedUntil,
        );
        assert.equal(
          result.note?.id,
          note.id,
          `${song.id}/${difficulty}/${lateness}: late valid input must consume the current note, never a later one`,
        );
        assert.equal(result.judgement, lateness === 0 ? "perfect" : "ok");
        assert.equal(
          result.blockedUntil,
          0,
          "Valid late phrases never trigger mash blocking",
        );
        consumed.add(note.id);
        blockedUntil = result.blockedUntil;
      }
      assert.equal(consumed.size, chart.length);
    }
  }
assert.equal(core.classifyDrumHit(0.5, 0.5), "center");
assert.equal(core.classifyDrumHit(0.86, 0.5), "center");
assert.equal(core.classifyDrumHit(0.861, 0.5), "rim");
assert.equal(core.classifyDrumHit(1, 0.5), "rim");
for (const [x, y] of [
  [1.01, 0.5],
  [0, 0],
  [1, 1],
  [-1, 0.5],
  [NaN, 0.5],
  [0.5, Infinity],
])
  assert.equal(
    core.classifyDrumHit(x, y),
    null,
    "Outside the circular drum must not register",
  );
const emptyScore = core.createScore();
let score = core.applyJudgement(emptyScore, "perfect");
score = core.applyJudgement(score, "good");
score = core.applyJudgement(score, "ok");
assert.equal(score.score, 1950);
assert.equal(score.combo, 3);
score = core.applyJudgement(score, "miss");
assert.equal(score.combo, 0);
assert.equal(score.maxCombo, 3);
assert.equal(score.score, 1950);
assert.equal(score.miss, 1);
let longCombo = core.createScore();
for (let index = 0; index < 100; index++)
  longCombo = core.applyJudgement(longCombo, "perfect");
assert.equal(
  longCombo.score,
  116500,
  "Threshold strikes earn their new fever bonus",
);
assert.equal(longCombo.combo, 100);
assert.equal(longCombo.maxCombo, 100);
for (const [combo, tier, points] of [[9, 0, 1000], [10, 1, 1050], [20, 2, 1100], [50, 3, 1250], [100, 4, 1500]]) {
  assert.equal(core.getFeverTier(combo), tier);
  const prior = { ...core.createScore(), combo: combo - 1 };
  assert.equal(core.applyJudgement(prior, "perfect").score, points);
}
const broken = core.applyJudgement(longCombo, "miss");
assert.equal(core.applyJudgement({ ...core.createScore(), combo: 9 }, "good").score, 683, "Fractional fever points round to a whole displayed point");
assert.equal(core.applyJudgement({ ...core.createScore(), combo: 49 }, "good").score, 813);
assert.equal(core.applyJudgement({ ...core.createScore(), combo: 99 }, "ok").score, 450);
assert.equal(core.getFeverTier(broken.combo), 0);
assert.equal(core.applyJudgement(broken, "good").score - broken.score, 650);
const failureChart = Array.from({ length: 60 }, (_, index) => ({ id: `limit-${index}`, time: 3 + index, kind: "center", hand: "left" }));
const noInputFailure = core.replayRhythmPerformance(failureChart, [], 100, 30);
assert.equal(noInputFailure.score.miss, 30);
assert.equal(noInputFailure.terminated, true);
assert(Math.abs(noInputFailure.endedAt - 32.16) < 1e-6);
assert.equal(core.replayRhythmPerformance(failureChart, [], noInputFailure.endedAt, 30).terminated, true, "Exact server replay of client termination remains terminal");
const wrongInputs = Array.from({ length: 30 }, (_, index) => ({ time: 3 + index * 0.001, kind: "rim", hand: "right" }));
const mashFailure = core.replayRhythmPerformance(failureChart, wrongInputs, 3.029, 30);
assert.equal(mashFailure.score.miss, 30);
assert.equal(mashFailure.processedEvents, 30);
assert.equal(mashFailure.terminated, true);
const extraAfterFailure = core.replayRhythmPerformance(failureChart, [...wrongInputs, { time: 4, kind: "center", hand: "left" }], 5, 30);
assert.equal(extraAfterFailure.processedEvents, 30);
assert.equal(extraAfterFailure.score.score, 0);
const practiceNoLimit = core.replayRhythmPerformance(failureChart, [], 100);
assert.equal(practiceNoLimit.terminated, false);
assert.equal(practiceNoLimit.score.miss, 60);
const perfectChart = Array.from({ length: 100 }, (_, index) => ({ id: `perfect-${index}`, time: 3 + index * .25, kind: "center", hand: index % 2 ? "right" : "left" }));
const perfectReplay = core.replayRhythmPerformance(perfectChart, perfectChart.map(note => ({ time: note.time, kind: note.kind, hand: note.hand })), 30, 30);
assert.equal(perfectReplay.score.score, longCombo.score);
assert.equal(perfectReplay.score.miss, 0);
assert.equal(perfectReplay.processedEvents, 100);
assert.equal(
  emptyScore.score,
  0,
  "Score updates must not mutate earlier result snapshots",
);

// Exercise the real audio controller's scheduling and lifecycle with a controlled clock.
const contexts = [];
class Parameter {
  value = 0;
  events = [];
  setValueAtTime(value, at) {
    this.events.push([value, at]);
  }
  linearRampToValueAtTime(value, at) {
    this.events.push([value, at]);
  }
  exponentialRampToValueAtTime(value, at) {
    assert(value > 0);
    this.events.push([value, at]);
  }
  setTargetAtTime(value, at) {
    this.events.push([value, at]);
  }
}
class Node {
  disconnected = false;
  connect() {
    return this;
  }
  disconnect() {
    this.disconnected = true;
  }
}
class Source extends Node {
  frequency = new Parameter();
  stops = [];
  start(time) {
    assert(Number.isFinite(time));
    this.startTime = time;
  }
  stop(time) {
    this.stops.push(time);
  }
  setPeriodicWave(wave) {
    this.wave = wave;
  }
}
class Context {
  state = "suspended";
  currentTime = 10;
  sampleRate = 22050;
  destination = new Node();
  sources = [];
  gains = [];
  constructor() {
    contexts.push(this);
  }
  async resume() {
    this.state = "running";
    this.onstatechange?.();
  }
  async suspend() {
    this.state = "suspended";
    this.onstatechange?.();
  }
  async close() {
    this.state = "closed";
    this.onstatechange?.();
  }
  advance(seconds) {
    if (this.state === "running") this.currentTime += seconds;
  }
  createGain() {
    const node = new Node();
    node.gain = new Parameter();
    this.gains.push(node);
    return node;
  }
  createDynamicsCompressor() {
    const node = new Node();
    for (const name of ["threshold", "knee", "ratio", "attack", "release"])
      node[name] = new Parameter();
    return node;
  }
  createPeriodicWave(real, imaginary) {
    return { real, imaginary };
  }
  createBuffer(channels, length) {
    const values = new Float32Array(length);
    return { getChannelData: () => values };
  }
  createOscillator() {
    const source = new Source();
    this.sources.push(source);
    return source;
  }
  createBufferSource() {
    const source = new Source();
    this.sources.push(source);
    return source;
  }
  createBiquadFilter() {
    const node = new Node();
    node.frequency = new Parameter();
    return node;
  }
}
const { RhythmAudio } = await load(`${base}rhythmAudio.ts`, {
  window: { AudioContext: Context },
});
const audio = new RhythmAudio();
let stateChanges = 0;
audio.onStateChange = () => stateChanges++;
assert.equal(audio.state, "idle");
for (const song of songs) {
  await audio.start(song, 0.7);
  const context = contexts.at(-1);
  assert.equal(audio.state, "running");
  assert.equal(audio.currentTime, 0);
  assert(context.sources.length > 200 && context.sources.length < 2000);
  assert(
    context.sources.every(
      (s) => s.startTime >= 10 && s.startTime <= 10.08 + song.duration,
    ),
  );
  for (const gain of context.gains)
    for (const [value, at] of gain.gain.events) {
      assert(Number.isFinite(value) && value >= 0 && value < 1);
      assert(Number.isFinite(at) && at >= 10);
    }
  context.advance(3.08);
  assert(Math.abs(audio.currentTime - 3) < 1e-8);
  const sourceCount = context.sources.length;
  audio.hit("center");
  audio.hit("rim");
  assert.equal(context.sources.length, sourceCount + 4);
  await audio.pause();
  assert.equal(audio.state, "suspended");
  context.advance(9);
  assert(
    Math.abs(audio.currentTime - 3) < 1e-8,
    "Pause must freeze the audio clock",
  );
  audio.hit("center");
  assert.equal(
    context.sources.length,
    sourceCount + 4,
    "Paused inputs must not make sound",
  );
  await audio.resume();
  context.advance(0.5);
  assert(
    Math.abs(audio.currentTime - 3.5) < 1e-8,
    "Resume must preserve the original timeline",
  );
  audio.setVolume(-1);
  assert.equal(context.gains[0].gain.events.at(-1)[0], 0);
  audio.setVolume(5);
  assert.equal(context.gains[0].gain.events.at(-1)[0], 0.68);
  audio.stop();
  assert.equal(audio.state, "idle");
  assert.equal(context.state, "closed");
  assert(context.sources.every((s) => s.disconnected && s.stops.length >= 2));
}
assert(stateChanges > 8);
audio.dispose();
assert.equal(audio.state, "closed");
await assert.rejects(() => audio.start(songs[0]), /종료된/);
const unsupported = await load(`${base}rhythmAudio.ts`, { window: {} });
await assert.rejects(
  () => new unsupported.RhythmAudio().start(songs[0]),
  /지원하지/,
);
const guardedAudio = new RhythmAudio();
const pendingAuthorization = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
let authorizationCalls = 0;
const permission = pendingAuthorization();
const guardedStart = guardedAudio.start(songs[0], 0.7, () => {
  authorizationCalls++;
  assert.equal(
    contexts.at(-1).state,
    "running",
    "Unlock audio before awaiting server authorization",
  );
  return permission.promise;
});
await new Promise(setImmediate);
const waitingContext = contexts.at(-1);
assert.equal(authorizationCalls, 1);
assert.equal(
  waitingContext.sources.length,
  0,
  "No count-in or music before server confirmation",
);
assert.equal(
  waitingContext.gains.length,
  0,
  "Do not create a sound graph before authorization",
);
guardedAudio.hit("center");
assert.equal(
  waitingContext.sources.length,
  0,
  "Pending authorization also blocks touch sounds",
);
waitingContext.advance(2);
assert.equal(
  guardedAudio.currentTime,
  0,
  "Authorization delay is outside the song clock",
);
permission.resolve(true);
await guardedStart;
assert(waitingContext.sources.length > 200);
assert.equal(guardedAudio.currentTime, 0);
guardedAudio.stop();
for (const [initialVolume, chosenVolume] of [[0, 0.65], [0.65, 0]]) {
  const confirmation = pendingAuthorization();
  const pendingStart = guardedAudio.start(songs[0], initialVolume, () => confirmation.promise);
  await new Promise(setImmediate);
  const context = contexts.at(-1);
  guardedAudio.setVolume(chosenVolume);
  assert.equal(context.sources.length, 0, "Volume selection cannot start unauthorized music");
  confirmation.resolve(true);
  await pendingStart;
  assert.equal(context.gains[0].gain.value, chosenVolume * 0.68,
    "Latest mute/unmute while starting is applied when the authorized song begins");
  guardedAudio.stop();
}
await assert.rejects(
  () => guardedAudio.start(songs[0], 0.7, async () => false),
  /이용할 수/,
);
assert.equal(contexts.at(-1).sources.length, 0);
assert.equal(contexts.at(-1).state, "closed");
await assert.rejects(
  () =>
    guardedAudio.start(songs[0], 0.7, async () => {
      throw Error("synthetic server outage");
    }),
  /server outage/,
);
assert.equal(contexts.at(-1).sources.length, 0);
assert.equal(contexts.at(-1).state, "closed");
const stalePermission = pendingAuthorization();
const staleStart = guardedAudio.start(
  songs[0],
  0.7,
  () => stalePermission.promise,
);
await new Promise(setImmediate);
const staleContext = contexts.at(-1);
guardedAudio.stop();
await guardedAudio.start(songs[1], 0.7, async () => true);
const replacementContext = contexts.at(-1);
stalePermission.resolve(true);
await staleStart;
assert.equal(
  staleContext.sources.length,
  0,
  "A canceled authorization cannot schedule its old song",
);
assert.equal(staleContext.state, "closed");
assert.equal(
  replacementContext.state,
  "running",
  "Stale completion must not stop the replacement song",
);
guardedAudio.dispose();
const deadlineAudio = await load(`${base}rhythmAudio.ts`, {
  window: { AudioContext: Context },
  setTimeout: (callback, delay) =>
    setTimeout(callback, delay === 10000 ? 0 : delay),
});
await assert.rejects(
  () =>
    new deadlineAudio.RhythmAudio().start(
      songs[0],
      0.7,
      () => new Promise(() => {}),
    ),
  /공개 상태/,
);
assert.equal(contexts.at(-1).sources.length, 0);
assert.equal(contexts.at(-1).state, "closed");

// Drive the real resume deadline without waiting four seconds. This fake models
// a browser resume that can settle late even after its old context was closed.
const resumeDeadlines = new Map();
class DelayedResumeContext extends Context {
  holdResume = false;
  resumeCompletion = null;
  resume() {
    if (!this.holdResume) return super.resume();
    return new Promise((resolve, reject) => {
      this.resumeCompletion = {
        resolve: () => {
          this.state = "running";
          this.onstatechange?.();
          resolve();
        },
        reject,
      };
    });
  }
}
const delayedAudio = await load(`${base}rhythmAudio.ts`, {
  window: { AudioContext: DelayedResumeContext },
  setTimeout: (callback, delay) => {
    if (delay !== 4000) return setTimeout(callback, delay);
    const token = {};
    resumeDeadlines.set(token, callback);
    return token;
  },
  clearTimeout: (token) => {
    if (!resumeDeadlines.delete(token)) clearTimeout(token);
  },
});
const expireResume = () => {
  assert.equal(
    resumeDeadlines.size,
    1,
    "Only the pending resume owns a deadline",
  );
  [...resumeDeadlines.values()][0]();
};
const timedResume = new delayedAudio.RhythmAudio();
await timedResume.start(songs[0]);
await timedResume.pause();
const timedContext = contexts.at(-1);
timedContext.holdResume = true;
const timedOperation = timedResume.resume();
const timedRejection = assert.rejects(timedOperation, /지연/);
expireResume();
await timedRejection;
assert.equal(
  timedResume.state,
  "idle",
  "Resume timeout detaches the active player",
);
assert.equal(timedContext.state, "closed");
assert(
  timedContext.sources.every(
    (source) => source.disconnected && source.stops.length >= 2,
  ),
  "Resume timeout stops and disconnects the scheduled music",
);
assert(
  timedContext.gains[0].disconnected,
  "Resume timeout disconnects master gain",
);
timedContext.resumeCompletion.resolve();
await new Promise(setImmediate);
assert.equal(
  timedContext.state,
  "closed",
  "Late resume fulfillment cannot restart hidden audio",
);
assert.equal(timedResume.state, "idle");
assert.equal(resumeDeadlines.size, 0);
timedResume.dispose();

const rejectedResume = new delayedAudio.RhythmAudio();
await rejectedResume.start(songs[0]);
await rejectedResume.pause();
const rejectedContext = contexts.at(-1);
rejectedContext.resume = async () => {
  throw Error("active resume rejected");
};
await assert.rejects(rejectedResume.resume(), /active resume rejected/);
assert.equal(rejectedResume.state, "idle");
assert.equal(
  rejectedContext.state,
  "closed",
  "Active resume rejection closes its music context",
);
rejectedResume.dispose();

for (const staleOutcome of ["resolve", "timeout", "reject"]) {
  const player = new delayedAudio.RhythmAudio();
  await player.start(songs[0]);
  await player.pause();
  const oldContext = contexts.at(-1);
  oldContext.holdResume = true;
  const oldResume = player.resume();
  const outcome =
    staleOutcome === "resolve"
      ? oldResume
      : assert.rejects(
          oldResume,
          staleOutcome === "timeout" ? /지연/ : /stale resume/,
        );
  await player.start(songs[1]);
  const replacement = contexts.at(-1);
  assert.notEqual(oldContext, replacement);
  assert.equal(oldContext.state, "closed");
  if (staleOutcome === "timeout") expireResume();
  else if (staleOutcome === "reject")
    oldContext.resumeCompletion.reject(Error("stale resume"));
  else oldContext.resumeCompletion.resolve();
  await outcome;
  if (staleOutcome === "timeout") {
    oldContext.resumeCompletion.resolve();
    await new Promise(setImmediate);
  }
  assert.equal(
    oldContext.state,
    "closed",
    `${staleOutcome}: only old context is cleaned up`,
  );
  assert.equal(
    replacement.state,
    "running",
    `${staleOutcome}: stale resume never stops replacement music`,
  );
  assert.equal(player.state, "running");
  assert(replacement.sources.every((source) => !source.disconnected));
  assert.equal(resumeDeadlines.size, 0);
  player.dispose();
}
const disposedResume = new delayedAudio.RhythmAudio();
await disposedResume.start(songs[0]);
await disposedResume.pause();
const disposedContext = contexts.at(-1);
disposedContext.holdResume = true;
const pendingDisposedResume = disposedResume.resume();
disposedResume.dispose();
disposedContext.resumeCompletion.resolve();
await pendingDisposedResume;
assert.equal(disposedContext.state, "closed");
assert.equal(
  disposedResume.state,
  "closed",
  "Late resume cannot resurrect a disposed player",
);
assert.equal(resumeDeadlines.size, 0);
console.log(
  "Rhythm checks passed: four scores, chart density/determinism, alternating hands, earliest eligible note matching, all-chart 159/160ms late and jittered phrases, 220ms mistake recovery and extended mash blocking, count-in/outro exclusions, touch boundaries, fever scoring/reset and exact challenge limit replay, audio scheduling/pause/mute/teardown, resume timeout/rejection/late fulfillment/disposal/replacement races, unsupported browser and server authorization (pending/allowed/denied/error/canceled/timeout).",
);

if (process.argv.includes("--audio-render")) {
  let playwright;
  try {
    playwright = require("playwright");
  } catch {
    playwright = require(
      process.env.PLAYWRIGHT_MODULE_PATH ||
        path.join(
          os.homedir(),
          ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
        ),
    );
  }
  const browser = await playwright.chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  });
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) => route.abort());
    const bundle = await build({
      stdin: {
        contents: `import {RhythmAudio} from './${base}rhythmAudio'; import {RHYTHM_SONGS} from './${base}rhythmSongs'; window.rhythmRenderQA={RhythmAudio,RHYTHM_SONGS};`,
        resolveDir: root,
        loader: "ts",
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const metrics = await page.evaluate(async () => {
      const results = [];
      const { RhythmAudio, RHYTHM_SONGS } = window.rhythmRenderQA;
      for (const song of RHYTHM_SONGS) {
        const offline = new OfflineAudioContext(
          1,
          Math.ceil((song.duration + 0.25) * 22050),
          22050,
        );
        window.AudioContext = class {
          state = "running";
          currentTime = 0;
          sampleRate = offline.sampleRate;
          destination = offline.destination;
          resume() {
            return Promise.resolve();
          }
          suspend() {
            this.state = "suspended";
            return Promise.resolve();
          }
          close() {
            this.state = "closed";
            return Promise.resolve();
          }
          createGain() {
            return offline.createGain();
          }
          createDynamicsCompressor() {
            return offline.createDynamicsCompressor();
          }
          createPeriodicWave(...args) {
            return offline.createPeriodicWave(...args);
          }
          createBuffer(...args) {
            return offline.createBuffer(...args);
          }
          createOscillator() {
            return offline.createOscillator();
          }
          createBufferSource() {
            return offline.createBufferSource();
          }
          createBiquadFilter() {
            return offline.createBiquadFilter();
          }
        };
        const controller = new RhythmAudio();
        await controller.start(song, 1);
        const rendered = await offline.startRendering();
        const samples = rendered.getChannelData(0);
        let peak = 0,
          sum = 0,
          tail = 0,
          finite = true;
        for (let i = 0; i < samples.length; i++) {
          const sample = samples[i];
          finite &&= Number.isFinite(sample);
          peak = Math.max(peak, Math.abs(sample));
          sum += sample * sample;
          if (i >= samples.length - 2205) tail += sample * sample;
        }
        results.push({
          id: song.id,
          finite,
          peak,
          rms: Math.sqrt(sum / samples.length),
          tailRms: Math.sqrt(tail / 2205),
        });
        controller.dispose();
      }
      return results;
    });
    for (const metric of metrics) {
      assert(metric.finite, metric.id);
      assert(
        metric.peak > 0.05 && metric.peak < 0.9,
        `${metric.id}: keep audible output with headroom`,
      );
      assert(metric.rms > 0.01, `${metric.id}: track must be audible`);
      assert(
        metric.tailRms < 0.0001,
        `${metric.id}: release must end in silence`,
      );
    }
    console.log(
      "Actual OfflineAudioContext render passed (no network or audible playback).",
    );
    console.log(JSON.stringify(metrics, null, 2));
  } finally {
    await browser.close();
  }
}
console.log(
  JSON.stringify(
    songs.map((song) => ({
      id: song.id,
      seconds: Number(song.duration.toFixed(2)),
      bpm: song.bpm,
      notes: Object.fromEntries(
        ["easy", "normal", "hard"].map((d) => [
          d,
          core.createChart(song, d).length,
        ]),
      ),
    })),
    null,
    2,
  ),
);
