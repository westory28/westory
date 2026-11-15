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
  ["아리랑", "얼쑤, 달려라", "풍년 마당", "우리의 산하"],
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
          (i === 0 || n.time > chart[i - 1].time),
      ),
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
  { id: "a", time: 3, kind: "center" },
  { id: "b", time: 3.2, kind: "rim" },
  { id: "c", time: 3.4, kind: "center" },
];
const judged = new Set();
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
assert.equal(core.classifyDrumHit(0.5, 0.5), "center");
assert.equal(core.classifyDrumHit(0.81, 0.5), "center");
assert.equal(core.classifyDrumHit(0.811, 0.5), "rim");
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
console.log(
  "Rhythm checks passed: four scores, chart density/determinism, timing and touch boundaries, duplicate/wrong hits, scoring, audio scheduling, pause/resume, mute, teardown, unsupported browser and server authorization (pending/allowed/denied/error/canceled/timeout).",
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
