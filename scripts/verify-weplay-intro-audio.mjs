/** Offline sonic-logo checks: generated PCM and the real WebAudio controller. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const evidence = path.resolve(
  process.env.WEPLAY_QA_EVIDENCE_DIR ||
    path.join(root, "output/weplay-intro-sound-20261018"),
);
await fs.mkdir(evidence, { recursive: true });
const bundle = async (file) =>
  (
    await build({
      entryPoints: [path.join(root, file)],
      bundle: true,
      write: false,
      platform: "node",
      format: "cjs",
      target: "es2022",
    })
  ).outputFiles[0].text;
const soundCode = await bundle(
  "src/components/common/weplay/weplayIntroSound.ts",
);
const soundModule = { exports: {} };
vm.runInNewContext(soundCode, {
  module: soundModule,
  exports: soundModule.exports,
});
const { renderWeplayIntroSound, WEPLAY_INTRO_SECONDS } = soundModule.exports;
const checks = [],
  metrics = {};
const pcm = renderWeplayIntroSound(44100);
assert.equal(WEPLAY_INTRO_SECONDS, 3.6);
assert.equal(pcm.channels.length, 2);
assert.equal(pcm.channels[0].length, 158760);
let peak = 0,
  difference = 0;
for (let channel = 0; channel < 2; channel++) {
  const values = pcm.channels[channel];
  assert.equal(values[0], 0);
  assert.equal(Math.abs(values.at(-1)), 0);
  for (const value of values) {
    assert(Number.isFinite(value));
    peak = Math.max(peak, Math.abs(value));
  }
}
for (let i = 0; i < pcm.channels[0].length; i++)
  difference += Math.abs(pcm.channels[0][i] - pcm.channels[1][i]);
assert(peak > 0.25 && peak <= 0.701, "Audible PCM must retain output headroom");
assert(
  difference / pcm.channels[0].length > 0.001,
  "Sonic logo must contain stereo information",
);
const rms = (start, end) => {
  let sum = 0,
    count = 0;
  for (const channel of pcm.channels)
    for (
      let i = Math.floor(start * pcm.sampleRate);
      i < Math.floor(end * pcm.sampleRate);
      i++
    ) {
      sum += channel[i] ** 2;
      count++;
    }
  return Math.sqrt(sum / count);
};
metrics.pcm = {
  sampleRate: pcm.sampleRate,
  length: pcm.channels[0].length,
  peak,
  stereoDifference: difference / pcm.channels[0].length,
  westory: rms(0.1, 0.7),
  transition: rms(1.45, 2.2),
  tail: rms(3.5, 3.6),
};
assert(metrics.pcm.westory > 0.02 && metrics.pcm.transition > 0.02);
assert(metrics.pcm.tail < metrics.pcm.transition * 0.1);
assert.deepEqual(
  [...renderWeplayIntroSound(44100).channels[0]],
  [...pcm.channels[0]],
  "Sound generation must be deterministic",
);
for (const sampleRate of [22050, 48000]) {
  const rendered = renderWeplayIntroSound(sampleRate);
  assert.equal(rendered.channels[0].length, Math.ceil(sampleRate * 3.6));
  assert.equal(Math.abs(rendered.channels[1].at(-1)), 0);
}
const wav = Buffer.alloc(44 + pcm.channels[0].length * 4);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(pcm.sampleRate, 24);
wav.writeUInt32LE(pcm.sampleRate * 4, 28);
wav.writeUInt16LE(4, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < pcm.channels[0].length; i++)
  for (let c = 0; c < 2; c++)
    wav.writeInt16LE(
      Math.round(pcm.channels[c][i] * 32767),
      44 + i * 4 + c * 2,
    );
await fs.writeFile(path.join(evidence, "weplay-intro-preview.wav"), wav);
checks.push(
  "Deterministic 3.6-second stereo PCM at 22050/44100/48000Hz: finite values, zero endpoints, peak headroom, distinct transition energy and fading tail; WAV preview exported.",
);

const controllerCode = await bundle(
  "src/components/common/weplay/weplayIntroAudio.ts",
);
function fixture({ blocked = false, initialMuted = false } = {}) {
  const window = new EventTarget(),
    document = new EventTarget(),
    timers = new Map(),
    contexts = [],
    events = [];
  document.hidden = false;
  let nextTimer = 0;
  const values = new Map([["westory.weplay.musicMuted", String(initialMuted)]]);
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  class Context {
    state = blocked ? "suspended" : "running";
    currentTime = 0;
    sources = [];
    pending = [];
    destination = {};
    constructor() {
      contexts.push(this);
      events.push("context-created");
    }
    resume() {
      events.push("resume");
      if (this.state === "closed") return Promise.reject(new Error("closed"));
      if (!blocked) {
        this.state = "running";
        return Promise.resolve();
      }
      return new Promise((resolve) => this.pending.push(resolve));
    }
    acknowledgeResume() {
      if (this.state !== "closed") this.state = "running";
      this.pending.splice(0).forEach((resolve) => resolve());
    }
    close() {
      this.state = "closed";
      events.push("context-closed");
      return Promise.resolve();
    }
    createBuffer(channels, length, sampleRate) {
      const data = Array.from(
        { length: channels },
        () => new Float32Array(length),
      );
      return {
        duration: length / sampleRate,
        getChannelData: (index) => data[index],
      };
    }
    createGain() {
      return {
        gain: {
          cancelScheduledValues() {},
          setTargetAtTime() {},
          setValueAtTime() {},
          linearRampToValueAtTime() {},
        },
        connect() {},
        disconnect() {},
      };
    }
    createBufferSource() {
      const source = {
        starts: [],
        stops: [],
        buffer: null,
        onended: null,
        connect() {},
        disconnect() {},
        start(when, offset) {
          this.starts.push({ when, offset });
          events.push("start");
        },
        stop(when) {
          this.stops.push(when);
          events.push("stop");
        },
        end() {
          this.onended?.();
        },
      };
      this.sources.push(source);
      return source;
    }
  }
  window.AudioContext = Context;
  const sandbox = {
    module: { exports: {} },
    exports: {},
    window,
    document,
    localStorage,
    CustomEvent,
    Element: class {},
    Float32Array,
    setTimeout: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  vm.runInNewContext(controllerCode, sandbox);
  const api = sandbox.module.exports;
  const setMuted = (value) => {
    localStorage.setItem("westory.weplay.musicMuted", String(value));
    window.dispatchEvent(
      new CustomEvent("westory:weplay-audio-preference", { detail: value }),
    );
  };
  const flush = () => {
    const pending = [...timers.values()];
    timers.clear();
    pending.forEach((timer) => timer.callback());
  };
  return { api, document, window, contexts, events, setMuted, flush };
}

{
  const f = fixture();
  f.api.prepareWeplayIntroAudio();
  const controller = f.api.createWeplayIntroAudio();
  assert.equal(
    f.contexts.length,
    1,
    "Entry gesture context is reused by the opening",
  );
  controller.sync(480, true);
  const context = f.contexts[0],
    first = context.sources[0];
  assert.equal(first.starts[0].offset, 0.48);
  f.setMuted(true);
  assert.equal(first.stops.length, 1);
  controller.sync(850, true);
  assert.equal(context.sources.length, 1);
  f.setMuted(false);
  assert.equal(context.sources.at(-1).starts[0].offset, 0.85);
  controller.sync(1200, false);
  assert.equal(context.sources.at(-1).stops.length, 1);
  controller.sync(1200, true);
  assert.equal(context.sources.at(-1).starts[0].offset, 1.2);
  f.document.hidden = true;
  controller.sync(1500, true);
  assert.equal(context.sources.at(-1).stops.length, 1);
  f.document.hidden = false;
  controller.sync(1500, true);
  assert.equal(context.sources.at(-1).starts[0].offset, 1.5);
  controller.dispose();
  f.flush();
  const count = context.sources.length;
  f.document.dispatchEvent(new Event("pointerdown"));
  f.setMuted(false);
  controller.sync(1900, true);
  assert.equal(context.sources.length, count);
  assert.equal(context.state, "closed");
  assert.equal(f.api.getWeplayIntroAudioState().active, false);
  checks.push(
    "Prepared context reuse, RAF offset playback, mute/unmute, offscreen/hidden stop and current-offset resume, disposal and listener cleanup.",
  );
}
{
  const f = fixture({ blocked: true });
  const controller = f.api.createWeplayIntroAudio();
  controller.sync(1300, true);
  assert.equal(f.contexts[0].sources.length, 0);
  f.contexts[0].acknowledgeResume();
  await Promise.resolve();
  controller.sync(1450, true);
  assert.equal(f.contexts[0].sources[0].starts[0].offset, 1.45);
  controller.dispose();
  f.flush();
  const stale = f.api.createWeplayIntroAudio();
  stale.sync(300, true);
  stale.dispose();
  f.flush();
  const retired = f.contexts[1];
  retired.acknowledgeResume();
  await Promise.resolve();
  stale.sync(500, true);
  assert.equal(retired.sources.length, 0);
  assert.equal(retired.state, "closed");
  checks.push(
    "Blocked resume starts at the current visual offset when acknowledged; a late resume after skip/dispose cannot start a retired source.",
  );
}
{
  const f = fixture();
  const first = f.api.createWeplayIntroAudio();
  first.sync(10, true);
  const second = f.api.createWeplayIntroAudio();
  second.sync(20, true);
  first.dispose();
  first.sync(40, true);
  assert.equal(f.contexts[0].sources[0].stops.length, 1);
  assert.equal(f.contexts[1].sources[0].stops.length, 0);
  assert.equal(f.api.getWeplayIntroAudioState().audible, true);
  f.contexts[0].sources[0].end();
  assert.equal(
    f.api.getWeplayIntroAudioState().audible,
    true,
    "Retired source end must not overwrite the current opening",
  );
  second.dispose();
  f.flush();
  assert(f.contexts.every((context) => context.state === "closed"));
  const muted = fixture({ initialMuted: true });
  muted.api.prepareWeplayIntroAudio();
  const opening = muted.api.createWeplayIntroAudio();
  opening.sync(500, true);
  assert.equal(muted.contexts.length, 0);
  opening.dispose();
  muted.flush();
  checks.push(
    "Rapid ownership handoff and StrictMode-like setup/cleanup leave one active source; stale callbacks cannot change its state; saved mute creates no context.",
  );
}
await fs.writeFile(
  path.join(evidence, "audio-lifecycle-results.json"),
  JSON.stringify({ status: "passed", checks, metrics }, null, 2),
);
console.log(
  JSON.stringify({ status: "passed", checks, metrics, evidence }, null, 2),
);
