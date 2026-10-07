/** Actual Web Audio synthesis, browser audio graph and React hook lifecycle. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import http from 'node:http';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const evidence = path.resolve(process.env.WEPLAY_SOUND_QA_EVIDENCE_DIR || path.join(root, '.superloopy/sessions/weplay-sound-20261008/evidence'));
await fs.mkdir(evidence, { recursive: true });
const source = relative => JSON.stringify(path.join(root, relative).replaceAll('\\', '/'));
const harness = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import useWeplaySoundEffects from ${source('src/components/common/weplay/useWeplaySoundEffects.ts')};
import useWeplayMusic from ${source('src/components/common/weplay/useWeplayMusic.ts')};
import {renderWeplaySound} from ${source('src/components/common/weplay/weplaySoundDesign.ts')};
import {setWeplayAudioMuted} from ${source('src/components/common/weplay/weplayAudioPreference.ts')};
window.soundQa.render=renderWeplaySound;
window.soundQa.mute=setWeplayAudioMuted;
function Battle({name}){
  const sounds=useWeplaySoundEffects();
  window.soundQa[name]=sounds;
  return <section aria-label={name}>{['word','cannon','special'].map(cue=><button key={cue} onClick={()=>{sounds.unlock();sounds.play(cue)}}>{name+' '+cue}</button>)}</section>;
}
function App(){
  const [count,setCount]=useState(1);
  const music=useWeplayMusic();
  window.soundQa.setCount=setCount;
  return <main><button onClick={music.toggle}>음악 전환</button><output data-music={music.enabled}/>{count>0&&<Battle name="battle"/>}{count>1&&<Battle name="guide"/>}</main>;
}
createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({ stdin: { contents: harness, loader: 'tsx', resolveDir: root }, bundle: true, write: false, format: 'iife', define: { 'import.meta.env.BASE_URL': '"/"' } });
const js = bundle.outputFiles[0].text;
const wav = await fs.readFile(path.join(root, 'public/assets/weplay/naval/tide-of-victory.wav'));
const requests = [];
const server = http.createServer((request, response) => {
  requests.push(request.url);
  if (request.url === '/qa.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(js);
  } else if (request.url.includes('tide-of-victory.wav')) {
    response.setHeader('Content-Type', 'audio/wav');
    response.end(wav);
  } else {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><html><meta charset="utf-8"><div id="root"></div><script src="/qa.js"></script></html>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'msedge', headless: true, args: ['--autoplay-policy=document-user-activation-required'] });
const checks = [];
const errors = [];
async function newPage(muted = false) {
  const context = await browser.newContext();
  await context.addInitScript(muted => {
    localStorage.setItem('westory.weplay.musicMuted', String(muted));
    const NativeAudioContext = window.AudioContext;
    window.soundQa = { contexts: [], sources: [] };
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        window.soundQa.contexts.push(this);
      }
      createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        const stop = source.stop.bind(source);
        const entry = { source, startedAt: null, stopped: false, ended: false };
        source.start = (...args) => { entry.startedAt = performance.now(); return start(...args); };
        source.stop = (...args) => { entry.stopped = true; return stop(...args); };
        source.addEventListener('ended', () => { entry.ended = true; });
        window.soundQa.sources.push(entry);
        return source;
      }
    };
    window.soundQa.setHidden = hidden => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    };
  }, muted);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole('button', { name: 'battle word', exact: true }).waitFor();
  return { context, page };
}
try {
  const { context, page } = await newPage();
  assert.equal(await page.evaluate(() => window.soundQa.contexts.length), 0, 'Audio is allocated only after a gesture.');
  const designs = await page.evaluate(() => ['word', 'cannon', 'special'].map(cue => {
    const startedAt = performance.now();
    const { samples, sampleRate } = window.soundQa.render(cue);
    let sum = 0, peak = 0, low = 0, bassEnergy = 0;
    const alpha = 1 - Math.exp(-2 * Math.PI * 300 / sampleRate);
    for (const sample of samples) {
      sum += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
      low += alpha * (sample - low);
      bassEnergy += low * low;
    }
    return { cue, duration: samples.length / sampleRate, milliseconds: performance.now() - startedAt, peak, rms: Math.sqrt(sum / samples.length), bassRatio: bassEnergy / sum, finite: samples.every(Number.isFinite), first: samples[0], last: samples.at(-1) };
  }));
  for (const design of designs) {
    assert.ok(design.finite);
    assert.ok(design.peak > 0.05 && design.peak < 0.8);
    assert.ok(design.rms > 0.012);
    assert.ok(design.first === 0);
    assert.ok(design.last === 0);
    assert.ok(design.milliseconds < 150, 'No expensive asset decoding/network delay on first gesture.');
  }
  assert.equal(designs[0].duration, 0.23);
  assert.equal(designs[1].duration, 1.12);
  assert.equal(designs[2].duration, 2.44);
  assert.ok(designs[1].bassRatio > 0.3, 'The cannon should have a substantial low body.');
  assert.ok(designs[2].rms > designs[0].rms * 1.5, 'The volley and word cue should remain distinguishable.');
  checks.push({ name: 'three original finite PCM designs, distinct duration/energy and restrained levels', designs });

  const previewSamples = await page.evaluate(() => {
    const sounds = ['word', 'cannon', 'special'].map(cue => window.soundQa.render(cue));
    const gap = 12000;
    const output = new Float32Array(sounds.reduce((length, sound) => length + sound.samples.length + gap, gap));
    let offset = gap;
    for (const sound of sounds) {
      output.set(sound.samples.map(sample => sample * 0.5), offset);
      offset += sound.samples.length + gap;
    }
    return Array.from(output);
  });
  const preview = Buffer.alloc(44 + previewSamples.length * 2);
  preview.write('RIFF');
  preview.writeUInt32LE(preview.length - 8, 4);
  preview.write('WAVEfmt ', 8);
  preview.writeUInt32LE(16, 16);
  preview.writeUInt16LE(1, 20);
  preview.writeUInt16LE(1, 22);
  preview.writeUInt32LE(24000, 24);
  preview.writeUInt32LE(48000, 28);
  preview.writeUInt16LE(2, 32);
  preview.writeUInt16LE(16, 34);
  preview.write('data', 36);
  preview.writeUInt32LE(previewSamples.length * 2, 40);
  previewSamples.forEach((sample, index) => preview.writeInt16LE(Math.round(sample * 32767), 44 + index * 2));
  await fs.writeFile(path.join(evidence, 'sound-effects-preview.wav'), preview);

  await page.getByRole('button', { name: 'battle word', exact: true }).click();
  await page.waitForFunction(() => window.soundQa.sources.some(entry => entry.startedAt !== null));
  assert.equal(await page.evaluate(() => window.soundQa.contexts.length), 1);
  await page.getByRole('button', { name: 'battle cannon', exact: true }).click();
  await page.getByRole('button', { name: 'battle special', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.soundQa.sources.map(entry => entry.source.buffer.duration)), [0.23, 1.12, 2.44]);
  checks.push({ name: 'real native AudioContext plays each cue exactly once after gesture', passed: true });

  await page.evaluate(() => {
    window.soundQa.setHidden(true);
    window.soundQa.battle.play('cannon');
  });
  await page.waitForFunction(() => window.soundQa.contexts[0].state === 'suspended');
  assert.ok(await page.evaluate(() => window.soundQa.sources.every(entry => entry.stopped || entry.ended)));
  assert.equal(await page.evaluate(() => window.soundQa.sources.length), 3);
  await page.evaluate(() => window.soundQa.setHidden(false));
  assert.equal(await page.evaluate(() => window.soundQa.sources.length), 3, 'Returning to the tab does not replay old sounds.');
  await page.getByRole('button', { name: 'battle word', exact: true }).click();
  await page.waitForFunction(() => window.soundQa.sources.length === 4);
  checks.push({ name: 'hidden stops/suspends, suppresses cues and never replays stale sounds', passed: true });

  await page.getByRole('button', { name: '음악 전환', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('output').dataset.music === 'true');
  await page.getByRole('button', { name: '음악 전환', exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('westory.weplay.musicMuted')), 'true');
  await page.getByRole('button', { name: 'battle special', exact: true }).click();
  assert.equal(await page.evaluate(() => window.soundQa.sources.length), 4);
  assert.ok(await page.evaluate(() => window.soundQa.sources.every(entry => entry.stopped || entry.ended)));
  await page.getByRole('button', { name: '음악 전환', exact: true }).click();
  await page.getByRole('button', { name: 'battle cannon', exact: true }).click();
  await page.waitForFunction(() => window.soundQa.sources.length === 5);
  checks.push({ name: 'existing music toggle immediately mutes/unmutes effects using one preference', passed: true });

  await page.evaluate(() => window.soundQa.setCount(2));
  await page.getByRole('button', { name: 'guide word', exact: true }).waitFor();
  await page.getByRole('button', { name: 'guide word', exact: true }).click();
  assert.equal(await page.evaluate(() => window.soundQa.contexts.length), 1, 'Guide/battle share one audio engine.');
  await page.evaluate(() => window.soundQa.setCount(1));
  await page.getByRole('button', { name: 'guide word', exact: true }).waitFor({ state: 'detached' });
  await page.evaluate(() => { for (let index = 0; index < 24; index++) window.soundQa.battle.play('cannon'); });
  assert.ok(await page.evaluate(() => window.soundQa.sources.filter(entry => !entry.stopped && !entry.ended).length <= 8));
  assert.equal(await page.evaluate(() => window.soundQa.contexts[0].state), 'running');
  checks.push({ name: 'guide lifecycle shares context; rapid input overlap capped at eight voices', passed: true });

  await page.evaluate(() => window.soundQa.setCount(0));
  await page.waitForFunction(() => window.soundQa.contexts[0].state === 'closed');
  const sourcesAtClose = await page.evaluate(() => window.soundQa.sources.length);
  await page.evaluate(() => {
    window.soundQa.mute(false);
    window.soundQa.setHidden(true);
    window.soundQa.setHidden(false);
    window.soundQa.battle.play('special');
  });
  assert.equal(await page.evaluate(() => window.soundQa.sources.length), sourcesAtClose);
  await page.evaluate(() => window.soundQa.setCount(1));
  await page.getByRole('button', { name: 'battle word', exact: true }).click();
  await page.waitForFunction(() => window.soundQa.contexts.length === 2 && window.soundQa.contexts[1].state === 'running');
  checks.push({ name: 'final unmount closes engine and stale callbacks; remount gets a fresh context', passed: true });
  await context.close();

  const muted = await newPage(true);
  await muted.page.getByRole('button', { name: 'battle special', exact: true }).click();
  assert.equal(await muted.page.evaluate(() => window.soundQa.contexts.length), 0);
  checks.push({ name: 'persisted mute prevents even allocating an AudioContext', passed: true });
  await muted.context.close();
  assert.equal(requests.filter(request => !['/', '/qa.js', '/favicon.ico'].includes(request) && !request.includes('tide-of-victory.wav')).length, 0);
  assert.deepEqual(errors, []);
  const report = { passed: true, checks, errors, boundary: 'Real Web Audio/React; document.hidden is a deterministic visibility fixture. Listening preference is subjective; no third-party samples or effect audio downloads.' };
  await fs.writeFile(path.join(evidence, 'sound-effects-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
