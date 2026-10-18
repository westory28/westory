/** Real Web Audio, Yut hooks and fallback throw callbacks. Synthetic localhost only. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url),
  { build } = require("esbuild");
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
  );
}
const evidence = path.join(root, "output/yut-sound-20261018");
await fs.mkdir(evidence, { recursive: true });
const source = (p) => JSON.stringify(path.join(root, p).replaceAll("\\", "/"));
const harness = `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import useSounds from ${source("src/components/common/weplay/useYutSoundEffects.ts")};
import useMusic from ${source("src/components/common/weplay/useWeplayMusic.ts")};
import Throw from ${source("src/components/common/weplay/yut/YutThrow3D.tsx")};
import {renderYutSound} from ${source("src/components/common/weplay/yutSoundDesign.ts")};
import {setWeplayAudioMuted} from ${source("src/components/common/weplay/weplayAudioPreference.ts")};
const qa=window.soundQa;qa.render=renderYutSound;qa.mute=setWeplayAudioMuted;qa.releases=[];qa.impacts=[];qa.completions=[];
function Owner({name}){const sound=useSounds();qa[name]=sound;return <section>{['throw','impact','step'].map(cue=><button key={cue} onClick={()=>{sound.unlock();sound[cue]();}}>{name+' '+cue}</button>)}</section>}
function Toss({data}){const sound=useSounds();return <div style={{position:'relative',width:600,height:400}}><Throw {...data} onRelease={()=>{qa.releases.push(data.throwKey);sound.throw(data.power);}} onImpact={index=>{qa.impacts.push({key:data.throwKey,index});sound.impact(index);}} onComplete={()=>qa.completions.push(data.throwKey)}/></div>}
function App(){const[count,setCount]=useState(1),[toss,setToss]=useState(null),[revision,setRevision]=useState(0);const music=useMusic();qa.setCount=setCount;qa.setToss=setToss;qa.bump=()=>setRevision(value=>value+1);return <main data-revision={revision}><button onClick={music.toggle}>음악 전환</button><output data-music={music.enabled}/><button onClick={()=>setToss({throwKey:'toss-a',sticks:[true,false,true,false],rolling:false,power:.65})}>투척 시작</button>{count>0&&<Owner name="yut"/>}{count>1&&<Owner name="guide"/>}{toss&&<Toss data={toss}/>}</main>}
createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "iife",
  outfile: path.join(os.tmpdir(), "yut-sound.js"),
  define: {
    "import.meta.env.BASE_URL": '"/"',
    "process.env.NODE_ENV": '"production"',
  },
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css =
  bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "";
const wav = await fs.readFile(
  path.join(root, "public/assets/weplay/naval/tide-of-victory.wav"),
);
const server = http.createServer((req, res) => {
  if (req.url === "/qa.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(js);
  } else if (req.url === "/qa.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(css);
  } else if (req.url.includes("tide-of-victory.wav")) {
    res.setHeader("Content-Type", "audio/wav");
    res.end(wav);
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="/qa.css"><div id="root"></div><script src="/qa.js"></script></html>',
    );
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--autoplay-policy=document-user-activation-required"],
});
const report = {
  passed: false,
  checks: [],
  designs: [],
  errors: [],
  boundary:
    "Real native AudioContext PCM and hook lifecycle; deterministic document.hidden and unavailable WebGL fixtures. The real WebGL geometry has separate coverage.",
};
async function open(muted = false) {
  const context = await browser.newContext();
  await context.addInitScript((muted) => {
    localStorage.setItem("westory.weplay.musicMuted", String(muted));
    const qa = (window.soundQa = { contexts: [], sources: [], buffers: [] }),
      NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        qa.contexts.push(this);
      }
      createBuffer(...args) {
        const buffer = super.createBuffer(...args);
        qa.buffers.push(buffer);
        return buffer;
      }
      createBufferSource() {
        const source = super.createBufferSource(),
          start = source.start.bind(source),
          stop = source.stop.bind(source),
          disconnect = source.disconnect.bind(source);
        const entry = {
          source,
          started: false,
          stopped: false,
          ended: false,
          disconnected: false,
        };
        source.start = (...args) => {
          entry.started = true;
          entry.rate = source.playbackRate.value;
          entry.duration = source.buffer.duration;
          return start(...args);
        };
        source.stop = (...args) => {
          entry.stopped = true;
          return stop(...args);
        };
        source.disconnect = (...args) => {
          entry.disconnected = true;
          return disconnect(...args);
        };
        source.addEventListener("ended", () => (entry.ended = true));
        qa.sources.push(entry);
        return source;
      }
    };
    qa.setHidden = (hidden) => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => hidden,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    const nativeGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (String(type).includes("webgl")) return null;
      return nativeGetContext.call(this, type, ...args);
    };
  }, muted);
  const page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(base) ? route.continue() : route.abort(),
  );
  await page.goto(base);
  await page.getByRole("button", { name: "yut throw", exact: true }).waitFor();
  return { context, page };
}
const sourceCount = (page) =>
  page.evaluate(() => window.soundQa.sources.length);
try {
  const { context, page } = await open();
  assert.equal(await page.evaluate(() => window.soundQa.contexts.length), 0);
  report.designs = await page.evaluate(() =>
    ["yut-throw", "yut-impact", "yut-step"].map((cue) => {
      const { samples, sampleRate } = window.soundQa.render(cue);
      let peak = 0,
        sum = 0;
      for (const sample of samples) {
        peak = Math.max(peak, Math.abs(sample));
        sum += sample * sample;
      }
      return {
        cue,
        duration: samples.length / sampleRate,
        peak,
        rms: Math.sqrt(sum / samples.length),
        finite: samples.every(Number.isFinite),
        first: samples[0],
        last: samples.at(-1),
      };
    }),
  );
  assert.deepEqual(
    report.designs.map((item) => item.duration),
    [0.28, 0.17, 0.14],
  );
  for (const item of report.designs) {
    assert.ok(
      item.finite && item.peak > 0.05 && item.peak < 0.8 && item.rms > 0.005,
      JSON.stringify(item),
    );
    assert.ok(item.first === 0 && item.last === 0);
  }
  const previewSamples = await page.evaluate(() => {
    const cues = ["yut-throw", "yut-impact", "yut-step"].map(
      (cue) => window.soundQa.render(cue).samples,
    );
    const result = new Float32Array(
      cues.reduce((count, cue) => count + cue.length + 6000, 6000),
    );
    let offset = 6000;
    for (const cue of cues) {
      result.set(
        cue.map((value) => value * 0.5),
        offset,
      );
      offset += cue.length + 6000;
    }
    return Array.from(result);
  });
  const preview = Buffer.alloc(44 + previewSamples.length * 2);
  preview.write("RIFF");
  preview.writeUInt32LE(preview.length - 8, 4);
  preview.write("WAVEfmt ", 8);
  preview.writeUInt32LE(16, 16);
  preview.writeUInt16LE(1, 20);
  preview.writeUInt16LE(1, 22);
  preview.writeUInt32LE(24000, 24);
  preview.writeUInt32LE(48000, 28);
  preview.writeUInt16LE(2, 32);
  preview.writeUInt16LE(16, 34);
  preview.write("data", 36);
  preview.writeUInt32LE(previewSamples.length * 2, 40);
  previewSamples.forEach((sample, index) =>
    preview.writeInt16LE(Math.round(sample * 32767), 44 + index * 2),
  );
  await fs.writeFile(path.join(evidence, "yut-sound-preview.wav"), preview);
  await page.getByRole("button", { name: "yut throw", exact: true }).click();
  await page.waitForFunction(() => window.soundQa.sources.length === 1);
  assert.equal(
    await page.evaluate(() => window.soundQa.buffers.length),
    4,
    "Three legacy buffers plus only the requested Yut cue",
  );
  for (const cue of ["impact", "step"])
    await page.getByRole("button", { name: "yut " + cue, exact: true }).click();
  assert.deepEqual(
    await page.evaluate(() =>
      window.soundQa.sources.map((item) => item.duration),
    ),
    [0.28, 0.17, 0.14],
  );
  assert.equal(await page.evaluate(() => window.soundQa.buffers.length), 6);
  await page.evaluate(() => window.soundQa.yut.step(4));
  assert.equal(
    await page.evaluate(() => window.soundQa.buffers.length),
    6,
    "Repeated cue reuses its buffer",
  );
  const rates = await page.evaluate(() =>
    window.soundQa.sources.map((item) => Math.round(item.rate * 100) / 100),
  );
  assert.deepEqual(rates, [0.97, 0.94, 1, 1.16]);
  report.checks.push(
    "Three original finite nonzero PCM cues have silent boundaries and no clipping; native AudioContext lazily caches Yut buffers and uses per-action pitch variation.",
  );
  await page.evaluate(() => {
    window.soundQa.setHidden(true);
    window.soundQa.yut.impact();
  });
  await page.waitForFunction(
    () => window.soundQa.contexts[0].state === "suspended",
  );
  assert.equal(await sourceCount(page), 4);
  assert.ok(
    await page.evaluate(() =>
      window.soundQa.sources.every(
        (item) => (item.stopped || item.ended) && item.disconnected,
      ),
    ),
  );
  await page.evaluate(() => window.soundQa.setHidden(false));
  assert.equal(await sourceCount(page), 4);
  await page.getByRole("button", { name: "yut step", exact: true }).click();
  await page.waitForFunction(() => window.soundQa.sources.length === 5);
  await page.getByRole("button", { name: "음악 전환", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("output").dataset.music === "true",
  );
  await page.getByRole("button", { name: "음악 전환", exact: true }).click();
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("westory.weplay.musicMuted"),
    ),
    "true",
  );
  await page.getByRole("button", { name: "yut throw", exact: true }).click();
  assert.equal(await sourceCount(page), 5);
  await page.getByRole("button", { name: "음악 전환", exact: true }).click();
  await page.getByRole("button", { name: "yut impact", exact: true }).click();
  await page.waitForFunction(() => window.soundQa.sources.length === 6);
  report.checks.push(
    "The existing music preference immediately mutes Yut effects; hidden stops/disconnects/suspends playback and returning never replays stale cues.",
  );
  const beforeToss = await sourceCount(page);
  await page.getByRole("button", { name: "투척 시작", exact: true }).click();
  await page.locator('[data-renderer="fallback"]').waitFor();
  await page.waitForFunction(() => window.soundQa.releases.length === 1);
  await page.evaluate(() => {
    window.soundQa.bump();
    window.soundQa.setHidden(true);
  });
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    window.soundQa.setHidden(false);
    window.soundQa.bump();
  });
  await page.waitForFunction(() => window.soundQa.completions.length === 1);
  assert.deepEqual(await page.evaluate(() => window.soundQa.releases), [
    "toss-a",
  ]);
  assert.deepEqual(
    await page.evaluate(() =>
      window.soundQa.impacts.map((item) => item.index).sort(),
    ),
    [0, 1, 2, 3],
  );
  assert.equal(
    (await sourceCount(page)) - beforeToss,
    5,
    "Release and four contacts play once across hidden/resume and rerenders",
  );
  await page.evaluate(() => {
    window.soundQa.setToss({
      throwKey: "toss-a",
      sticks: [true, false, true, false],
      rolling: false,
      power: 0.8,
    });
    window.soundQa.bump();
  });
  await page.waitForTimeout(120);
  assert.equal((await sourceCount(page)) - beforeToss, 5);
  assert.equal(await page.evaluate(() => window.soundQa.completions.length), 1);
  report.checks.push(
    "Actual fallback throw releases once and sounds four first contacts once; hidden/resume, callback identity changes and duplicate snapshots do not repeat throw/impact callbacks.",
  );
  await page.evaluate(() => {
    window.soundQa.setToss(null);
    window.soundQa.setCount(2);
  });
  await page.getByRole("button", { name: "guide step", exact: true }).click();
  assert.equal(await page.evaluate(() => window.soundQa.contexts.length), 1);
  await page.evaluate(() => {
    for (let i = 0; i < 24; i++) window.soundQa.yut.impact(i);
  });
  assert.ok(
    await page.evaluate(
      () =>
        window.soundQa.sources.filter((item) => !item.ended && !item.stopped)
          .length <= 8,
    ),
  );
  await page.evaluate(() => window.soundQa.setCount(0));
  await page.waitForFunction(
    () => window.soundQa.contexts[0].state === "closed",
  );
  const atClose = await sourceCount(page);
  await page.evaluate(() => {
    window.soundQa.setHidden(true);
    window.soundQa.setHidden(false);
    window.soundQa.mute(false);
    window.soundQa.yut.step();
  });
  assert.equal(await sourceCount(page), atClose);
  await page.evaluate(() => window.soundQa.setCount(1));
  await page.getByRole("button", { name: "yut step", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.soundQa.contexts.length === 2 &&
      window.soundQa.contexts[1].state === "running",
  );
  report.checks.push(
    "Multiple owners share one context, overlap is capped at eight voices, final unmount closes and disconnects, stale callbacks remain silent, and remount creates a fresh engine.",
  );
  await context.close();
  const muted = await open(true);
  await muted.page
    .getByRole("button", { name: "yut throw", exact: true })
    .click();
  assert.equal(
    await muted.page.evaluate(() => window.soundQa.contexts.length),
    0,
  );
  await muted.context.close();
  report.checks.push(
    "Persisted mute prevents audio allocation before or after a gesture.",
  );
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack;
  throw error;
} finally {
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(JSON.stringify(report, null, 2));
