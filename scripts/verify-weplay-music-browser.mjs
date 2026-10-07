/** Actual music hook/button and WAV; only page lifecycle/visibility are fixtures. */
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
const evidence = path.resolve(process.env.WEPLAY_MUSIC_QA_EVIDENCE_DIR || path.join(root, '.superloopy/sessions/weplay-music-20261007/evidence'));
await fs.mkdir(evidence, { recursive: true });
const source = relative => JSON.stringify(path.join(root, relative).replaceAll('\\', '/'));
const musicUrl = '/assets/weplay/naval/tide-of-victory.wav';
const wav = await fs.readFile(path.join(root, 'public', musicUrl));
const harness = `
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import useWeplayMusic from ${source('src/components/common/weplay/useWeplayMusic.ts')};
import WeplayMusicButton from ${source('src/components/common/weplay/WeplayMusicButton.tsx')};
function Player(){
  const music=useWeplayMusic();
  useEffect(()=>{if(new URLSearchParams(location.search).has('autostart'))music.start()},[music.start]);
  return <section><WeplayMusicButton {...music}/><button onClick={music.start}>게임 시작</button><output data-enabled={music.enabled} data-failed={music.failed}/></section>;
}
function App(){
  const [mounted,setMounted]=useState(true);
  window.musicQa.setMounted=setMounted;
  return <main><h1>위플레이 음악 검증</h1>{mounted?<Player/>:<p>플레이어 해제됨</p>}</main>;
}
createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({ stdin: { contents: harness, loader: 'tsx', resolveDir: root }, bundle: true, write: false, outdir: 'out', format: 'iife', define: { 'import.meta.env.BASE_URL': '"/"' } });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const html = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/qa.css"><style>body{margin:0;padding:24px;font-family:sans-serif;background:#f9fafb;color:#1f2937}section{display:flex;gap:12px;align-items:center}button{min-height:44px}output{display:none}</style><div id="root"></div><script src="/qa.js"></script></html>';
const servedAudio = [];
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname === '/qa.js' || pathname === '/qa.css') {
    response.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : 'text/css');
    response.end(pathname.endsWith('.js') ? js : css);
    return;
  }
  if (pathname === musicUrl) {
    response.setHeader('Content-Type', 'audio/wav');
    response.setHeader('Accept-Ranges', 'bytes');
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
    const start = range ? Number(range[1]) : 0;
    const end = Math.min(range?.[2] ? Number(range[2]) : wav.length - 1, wav.length - 1);
    if (start > end || start >= wav.length) {
      response.writeHead(416, { 'Content-Range': `bytes */${wav.length}` });
      response.end();
      return;
    }
    response.statusCode = range ? 206 : 200;
    if (range) response.setHeader('Content-Range', `bytes ${start}-${end}/${wav.length}`);
    response.setHeader('Content-Length', end - start + 1);
    servedAudio.push({ status: response.statusCode, bytes: end - start + 1 });
    response.end(request.method === 'HEAD' ? undefined : wav.subarray(start, end + 1));
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'msedge', headless: true, args: ['--autoplay-policy=document-user-activation-required'] });
const checks = [];
const errors = [];
const externalRequests = [];
const button = page => page.locator('.weplay-music-button');
async function contextPage(query = '') {
  const context = await browser.newContext({ viewport: { width: 390, height: 600 } });
  await context.addInitScript(() => {
    const NativeAudio = window.Audio;
    window.musicQa = { players: [] };
    function TrackedAudio(...args) {
      const player = new NativeAudio(...args);
      window.musicQa.players.push(player);
      return player;
    }
    TrackedAudio.prototype = NativeAudio.prototype;
    window.Audio = TrackedAudio;
    window.musicQa.setHidden = hidden => {
      // Headless Chromium does not reliably expose OS tab activation. Exercise the actual listener.
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (route.request().url().startsWith(origin)) return route.continue();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto(origin + '/' + query);
  await button(page).waitFor();
  return { context, page };
}
async function waitPlaying(page) {
  await page.waitForFunction(() => {
    const player = window.musicQa.players.at(-1);
    return player && !player.paused && player.readyState >= 2 && player.currentTime > 0.04;
  });
}
async function waitPaused(page) {
  await page.waitForFunction(() => window.musicQa.players.at(-1)?.paused === true);
}
try {
  const { context, page } = await contextPage();
  assert.equal(await button(page).getAttribute('aria-label'), '소리 켜기');
  assert.equal(await page.evaluate(() => window.musicQa.players.length), 0, 'No media player is allocated before an explicit start.');
  const decoded = await page.evaluate(async url => {
    const buffer = await fetch(url).then(response => response.arrayBuffer());
    const decoder = new AudioContext();
    try {
      const clip = await decoder.decodeAudioData(buffer);
      return { duration: clip.duration, sampleRate: clip.sampleRate, channels: clip.numberOfChannels };
    } finally { await decoder.close(); }
  }, musicUrl);
  assert.ok(Math.abs(decoded.duration - 45) < 0.02, `Expected the actual 45-second music clip, received ${decoded.duration}s.`);
  checks.push({ name: 'actual WAV decoded', ...decoded });

  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  await waitPlaying(page);
  assert.equal(await button(page).getAttribute('aria-label'), '소리 끄기');
  assert.equal(await button(page).getAttribute('aria-pressed'), 'true');
  const active = await page.evaluate(() => { const a = window.musicQa.players.at(-1); return { duration: a.duration, volume: a.volume, loop: a.loop, error: a.error?.message || null }; });
  assert.ok(Math.abs(active.duration - 45) < 0.02);
  assert.equal(active.loop, true);
  assert.ok(Math.abs(active.volume - 0.28) < 0.001);
  assert.equal(active.error, null);
  checks.push({ name: 'native HTMLAudioElement plays after gesture', ...active });
  await page.evaluate(() => { window.musicQa.players.at(-1).currentTime = 44.85; });
  await page.waitForFunction(() => {
    const player = window.musicQa.players.at(-1);
    return !player.paused && !player.seeking && player.currentTime < 1;
  });
  checks.push({ name: 'native playback loops across the 45-second boundary', passed: true });

  await page.evaluate(() => window.musicQa.setHidden(true));
  await waitPaused(page);
  const stoppedAt = await page.evaluate(() => window.musicQa.players.at(-1).currentTime);
  await page.evaluate(() => window.musicQa.setHidden(false));
  await waitPlaying(page);
  await page.waitForFunction(at => window.musicQa.players.at(-1).currentTime > at, stoppedAt);
  assert.equal(await page.evaluate(() => window.musicQa.players.length), 1, 'Visibility changes must reuse the same player.');
  checks.push({ name: 'hidden pause and visible resume', boundary: 'document.hidden + visibilitychange fixture, actual media pause/play' });

  await button(page).click();
  await waitPaused(page);
  assert.equal(await button(page).getAttribute('aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => localStorage.getItem('westory.weplay.musicMuted')), 'true');
  await page.evaluate(() => { window.musicQa.setHidden(true); window.musicQa.setHidden(false); });
  assert.equal(await page.evaluate(() => window.musicQa.players.at(-1).paused), true, 'Muted music must not resume after visibility changes.');
  await page.reload();
  await page.getByRole('button', { name: '게임 시작', exact: true }).click();
  assert.equal(await page.evaluate(() => window.musicQa.players.length), 0, 'Saved mute preference must prevent playback/allocation after reload.');
  assert.equal(await button(page).getAttribute('aria-pressed'), 'false');
  await button(page).click();
  await waitPlaying(page);
  assert.equal(await page.evaluate(() => localStorage.getItem('westory.weplay.musicMuted')), 'false');
  checks.push({ name: 'mute persists across reload and can be enabled again', passed: true });

  await page.evaluate(() => window.musicQa.setMounted(false));
  await page.getByText('플레이어 해제됨').waitFor();
  const disposed = await page.evaluate(() => { const a = window.musicQa.players.at(-1); return { paused: a.paused, src: a.getAttribute('src'), readyState: a.readyState }; });
  assert.equal(disposed.paused, true);
  assert.equal(disposed.src, null);
  assert.equal(disposed.readyState, 0);
  await page.evaluate(() => { window.musicQa.setHidden(true); window.musicQa.setHidden(false); });
  assert.equal(await page.evaluate(() => window.musicQa.players.at(-1).paused), true);
  checks.push({ name: 'unmount releases media and visibility listener', ...disposed });
  await context.close();

  const denied = await contextPage('?autostart=1');
  await denied.page.waitForSelector('output[data-failed="true"]', { state: 'attached' });
  assert.equal(await button(denied.page).getAttribute('aria-label'), '배경음악 재시도');
  assert.equal(await button(denied.page).getAttribute('aria-pressed'), 'false');
  await denied.page.screenshot({ path: path.join(evidence, 'autoplay-blocked.png') });
  await button(denied.page).click();
  await waitPlaying(denied.page);
  await denied.page.waitForSelector('output[data-failed="false"][data-enabled="true"]', { state: 'attached' });
  assert.equal(await denied.page.evaluate(() => window.musicQa.players.length), 1);
  await denied.page.screenshot({ path: path.join(evidence, 'gesture-retry-playing.png') });
  checks.push({ name: 'real Chromium autoplay rejection and gesture retry', passed: true });
  await denied.context.close();

  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  assert.ok(servedAudio.length > 0);
  const report = { checks, errors, externalRequests, servedAudio, visibilityLimit: 'OS tab activation is represented by document.hidden/visibilitychange; media playback and WAV decoding are native.' };
  await fs.writeFile(path.join(evidence, 'music-browser-qa.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ evidence, ...report }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
