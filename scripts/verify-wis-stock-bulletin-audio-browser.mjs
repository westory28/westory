/** Real display, local fixture snapshots and mocked device audio; no live services. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root = process.cwd();
const output = path.join(root, 'output/wispi-bulletins-20261124');
await fs.mkdir(output, { recursive: true });
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import Display from './src/pages/teacher/components/points/WisStockExchangeDisplay';
import './src/assets/index.css';
const initial={updatedAtMs:0,studentOpen:true,rules:{halted:false},stocks:[],historyLimit:200};
function App(){const[open,setOpen]=useState(false);return <><button onClick={()=>setOpen(true)}>전광판 열기</button>{open&&<Display year="2026" semester="2" classKey="all" initialMarket={initial} onClose={()=>setOpen(false)}/>}</>};createRoot(document.getElementById('root')).render(<App/>);`;
const watcher = `export function watchWisStockExchange(year,semester,classKey,send){
 const qa=window.qa;qa.starts++;qa.stopped=false;
 let market={updatedAtMs:Date.now(),halted:false,index:null,stocks:[
 {id:'move',name:'비파메탈',price:40,previousPrice:100,previousClose:100,priceAtMs:Date.now()},
 {id:'old',name:'지난시간종목',price:160,previousPrice:100,previousClose:100,priceAtMs:Date.now()-1800000}
 ]};
 qa.emit=()=>send({status:'ready',market,trades:[]});
 qa.tick=()=>{market={...market,updatedAtMs:Date.now(),stocks:[{...market.stocks[0],price:market.stocks[0].price===40?64:40,previousPrice:market.stocks[0].price,priceAtMs:Date.now()}]};qa.emit();};
 qa.fail=()=>send({status:'error',message:'연결 실패'});
 qa.emit();return()=>{qa.stops++;qa.stopped=true;};
}`;
const bundle = await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: root }, bundle: true, write: false, outdir: 'fixture', loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.webp': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl' }, plugins: [{ name: 'local-watcher', setup(plugin) {
  plugin.onResolve({ filter: /lib\/wisStockExchangeDisplayClient$/ }, () => ({ path: 'watcher', namespace: 'fixture' }));
  plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: watcher, loader: 'ts' }));
} }] });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text.replace(/@import\s+(?:url\(["']?https?:[^)]*\)|["']https?:[^"']*["'])\s*;/g, '');
const tailwind = await fs.readFile(process.env.WIS_WALLET_QA_TAILWIND || path.join(os.tmpdir(), 'westory-qa-tailwind.js'), 'utf8');
const server = http.createServer((req, res) => {
  const content = { '/fixture.js': ['text/javascript', js], '/fixture.css': ['text/css', css], '/tailwind.js': ['text/javascript', tailwind] }[req.url] || ['text/html', '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>'];
  res.setHeader('Content-Type', content[0] + ';charset=utf-8');res.end(content[1]);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'msedge', headless: true });
const failures = [];
try {
  for (const width of [320, 390, 768, 1280, 1366, 1440, 1920]) {
    const page = await browser.newPage({ viewport: { width, height: width === 1366 ? 768 : width < 600 ? 740 : 1000 } });
    page.on('pageerror', error => failures.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.addInitScript(() => {
      window.qa = { starts: 0, stops: 0, spoken: [], canceled: 0, tones: 0, closed: 0, voiceListeners: [] };
      Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: undefined });
      class AudioContextMock {
        state = 'suspended'; currentTime = 0; destination = {};
        resume() { if(window.qa.audioBlocked) {this.state = 'suspended';return Promise.reject(new Error('Blocked'));} this.state = 'running';return Promise.resolve(); }
        close() { this.state = 'closed';window.qa.closed++;return Promise.resolve(); }
        createOscillator() { return { frequency: {}, connect(){}, disconnect(){}, start(){window.qa.tones++;}, stop(){} }; }
        createGain() { return { gain: { setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){}, disconnect(){} }; }
      }
      Object.defineProperty(window, 'AudioContext', { configurable: true, value: AudioContextMock });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; } } });
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        getVoices: () => window.qa.voices ?? [{ name: 'English Natural', lang: 'en-US', localService: true }, { name: '한국어 원격 Natural', lang: 'ko-KR', localService: false }, { name: '한국어 Natural', lang: 'ko-KR', localService: true }],
        speak: utterance => { if(window.qa.speechBlocked) utterance.onerror?.({error:'not-allowed'});else window.qa.spoken.push({ text: utterance.text, voice: utterance.voice?.name, lang: utterance.lang }); },
        resume: () => {},
        cancel: () => window.qa.canceled++,
        addEventListener: (event, listener) => { if(event === 'voiceschanged') window.qa.voiceListeners.push(listener); },
        removeEventListener: (event, listener) => { window.qa.voiceListeners = window.qa.voiceListeners.filter(item => item !== listener); },
      } });
    });
    await page.clock.install({ time: new Date('2026-11-23T16:30:00+09:00') });
    await page.clock.pauseAt(new Date('2026-11-23T16:30:00+09:00'));
    await page.goto(origin);
    if (width === 320 || width === 390) await page.evaluate(width => {
      window.qa.voices = [
        { name: 'English Natural', lang: 'en-US', localService: true, default: true },
        { name: '한국어 기본', lang: 'ko-KR', localService: true, default: true },
        { name: 'Google 한국의', lang: 'ko-KR', localService: false },
        ...(width === 320 ? [{ name: '한국어 원격 Neural', lang: 'ko-KR', localService: false }] : []),
      ];
    }, width);
    if (width === 768) await page.evaluate(() => { window.qa.voices = []; });
    await page.getByRole('button', { name: '전광판 열기', exact: true }).click();
    const display = page.getByRole('dialog', { name: '위스피 전광판' });
    const popup = display.locator('.wis-exchange__surge');
    await popup.waitFor();
    assert((await popup.innerText()).includes('-60.00%'));
    assert(!(await popup.innerText()).includes('지난시간종목'));
    const sound = display.getByRole('button', { name: '속보 알림음', exact: true });
    const speech = display.getByRole('button', { name: '속보 음성', exact: true });
    const close = display.getByRole('button', { name: '전광판 닫기', exact: true });
    assert.equal(await sound.getAttribute('aria-pressed'), 'true');
    assert.equal(await speech.getAttribute('aria-pressed'), 'true');
    if (width === 768) {
      await page.clock.fastForward(200);
      assert.equal(await page.evaluate(() => window.qa.spoken.length), 0, 'wait for asynchronously loaded Korean voices');
      await page.evaluate(() => {
        window.qa.voices = [{ name: '한국어 Natural', lang: 'ko-KR', localService: true }];
        window.qa.voiceListeners.forEach(listener => listener());
      });
    }
    await page.clock.fastForward(500);
    const audible = await page.evaluate(() => window.qa);
    assert.equal(audible.tones, 2);
    assert.deepEqual(audible.spoken, [{ text: '비파메탈, 급락.', voice: width === 320 ? '한국어 원격 Neural' : width === 390 ? 'Google 한국의' : '한국어 Natural', lang: 'ko-KR' }], 'opening the display plays sound and the best available Korean voice without another toggle');
    const geometry = await display.locator('.wis-exchange__actions').evaluate(node => {
      const buttons = [...node.querySelectorAll('button')].map(button => { const r = button.getBoundingClientRect();return { left: r.left, right: r.right, width: r.width, height: r.height }; });
      return { buttons, viewport: innerWidth, scroll: document.querySelector('.wis-exchange').scrollWidth };
    });
    assert(geometry.buttons.every(rect => rect.left >= 0 && rect.right <= width && rect.width >= 44 && rect.height >= 44), JSON.stringify(geometry));
    assert(geometry.buttons[0].right <= geometry.buttons[1].left && geometry.buttons[1].right <= geometry.buttons[2].left);
    assert(geometry.scroll <= width, JSON.stringify(geometry));
    const popupGeometry = await popup.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const button = node.querySelector('button').getBoundingClientRect();
      return { width: rect.width, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, closeWidth: button.width, closeHeight: button.height };
    });
    assert(Math.abs(popupGeometry.width - .8 * (width <= 959 ? width - 32 : Math.min(.8 * width, 1440))) < 1, JSON.stringify(popupGeometry));
    assert(popupGeometry.closeWidth >= 43.9 && popupGeometry.closeHeight >= 43.9, 'scaled close button retains a 44px target');
    assert(popupGeometry.left >= 0 && popupGeometry.right <= width && popupGeometry.top >= 0, JSON.stringify(popupGeometry));
    await page.screenshot({ path: path.join(output, `display-audio-${width}.png`) });
    await speech.focus();await speech.press('Space');
    assert.equal(await speech.getAttribute('aria-pressed'), 'false');
    const canceled = await page.evaluate(() => window.qa.canceled);
    await page.clock.fastForward(width === 768 ? 2_299 : 2_499);
    assert.equal(await popup.isVisible(), true, 'visible until 2,999ms');
    await page.clock.fastForward(1);
    assert.equal(await popup.isVisible(), false);
    await page.clock.fastForward(597_000);
    await popup.waitFor();
    assert.equal(await page.evaluate(() => window.qa.tones), 4);
    assert.equal(await page.evaluate(() => window.qa.spoken.length), 1, 'speech stays independently muted');
    assert.equal(await page.evaluate(() => window.qa.starts), 1, 'local repeats add no subscriptions');
    await sound.click();
    await page.clock.fastForward(600_000);
    assert.equal(await page.evaluate(() => window.qa.tones), 4, 'sound stays muted');
    await page.clock.fastForward(600_000);
    assert.equal(await popup.isVisible(), false, 'expired at 17:00');
    await page.evaluate(() => window.qa.emit());
    assert.equal(await popup.isVisible(), false, 'snapshot replay does not revive old event');
    await page.evaluate(() => window.qa.tick());
    await popup.waitFor();
    assert((await popup.innerText()).includes('+60.00%'));
    await sound.click();await speech.click();
    await page.clock.fastForward(500);
    if (width === 1366) {
      await sound.click();await page.evaluate(() => { window.qa.audioBlocked = true; });await sound.click();
      assert.equal(await sound.getAttribute('aria-pressed'), 'false', 'blocked sound reports off');
      await page.evaluate(() => { window.qa.audioBlocked = false; });await sound.click();
      assert.equal(await sound.getAttribute('aria-pressed'), 'true', 'one explicit click recovers sound');
      await speech.click();await page.evaluate(() => { window.qa.speechBlocked = true; });await speech.click();
      await page.clock.fastForward(350);
      assert.equal(await speech.getAttribute('aria-pressed'), 'false', 'blocked TTS reports off');
      await page.evaluate(() => { window.qa.speechBlocked = false; });await speech.click();
      await page.clock.fastForward(350);
      assert.equal(await speech.getAttribute('aria-pressed'), 'true', 'one explicit click recovers TTS');
    }
    const beforeDismiss = await page.evaluate(() => window.qa.canceled);
    await popup.locator('.wis-exchange__surge-heading').click();
    assert(await popup.isVisible(), 'clicking the bulletin body keeps it open');
    const dismiss = popup.getByRole('button', { name: '속보 닫기', exact: true });
    await dismiss.focus();await dismiss.press('Enter');
    assert.equal(await popup.isVisible(), false);
    assert(await display.isVisible(), 'popup close leaves the full exchange open');
    assert(await close.evaluate(node => document.activeElement === node), 'popup dismissal restores keyboard focus');
    assert(await page.evaluate(before => window.qa.canceled > before, beforeDismiss), 'manual dismissal cancels speech');
    await page.evaluate(() => window.qa.emit());
    assert.equal(await popup.isVisible(), false, 'same snapshot does not reopen a dismissed popup');
    await page.clock.fastForward(1_000);await page.evaluate(() => window.qa.tick());
    await popup.waitFor();
    await display.locator('.wis-exchange__index h3').click();
    assert.equal(await popup.isVisible(), false, 'outside click dismisses the popup');
    assert(await display.isVisible());
    await page.clock.fastForward(1_000);await page.evaluate(() => window.qa.tick());
    await popup.waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await popup.isVisible(), false, 'Escape first dismisses only the popup');
    assert(await display.isVisible());
    assert.equal(await page.evaluate(() => window.qa.starts), 1, 'dismissal and timers add no subscriptions');
    if (width === 1366) {
      await page.clock.fastForward(1000);await page.evaluate(() => window.qa.tick());
      await popup.waitFor();await page.clock.fastForward(500);
      const beforeTail = await page.evaluate(() => window.qa.canceled);
      await page.clock.fastForward(2500);
      assert.equal(await popup.isVisible(), false, 'visual duration stays three seconds while speech finishes');
      assert.equal(await page.evaluate(() => window.qa.canceled), beforeTail, 'automatic hiding allows the final spoken headline to finish');
      await page.clock.fastForward(5000);
      assert(await page.evaluate(before => window.qa.canceled > before, beforeTail), 'a stuck speech engine is stopped after eight seconds');
      const untilBoundary = await page.evaluate(() => Date.parse('2026-11-23T17:29:59+09:00') - Date.now());
      await page.clock.fastForward(untilBoundary);await page.evaluate(() => window.qa.tick());
      await popup.waitFor();await page.clock.fastForward(500);
      const beforeExpiry = await page.evaluate(() => window.qa.canceled);
      await page.clock.fastForward(500);
      assert.equal(await popup.isVisible(), false);
      assert(await page.evaluate(before => window.qa.canceled > before, beforeExpiry), 'speech stops at the original half-hour boundary');
      await page.clock.fastForward(1000);await page.evaluate(() => window.qa.tick());
      await popup.waitFor();await page.clock.fastForward(500);
      const beforeDisconnect = await page.evaluate(() => window.qa.canceled);
      await page.evaluate(() => window.qa.fail());
      assert.equal(await popup.isVisible(), false);
      assert(await page.evaluate(before => window.qa.canceled > before, beforeDisconnect), 'connection failure immediately stops speech');
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.qa.stops), 1);
    assert.equal(await page.evaluate(() => window.qa.closed), 1);
    assert(await page.evaluate(previous => window.qa.canceled > previous, canceled));
    assert(await page.getByRole('button', { name: '전광판 열기' }).evaluate(node => document.activeElement === node));
    await page.close();
  }
  // Use the installed browser audio engine as well as the deterministic mocks.
  // Measure its generated waveform; physical speaker volume is outside this check.
  const nativePage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  nativePage.on('pageerror', error => failures.push(error.message));
  await nativePage.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await nativePage.addInitScript(() => {
    window.qa = { starts: 0, stops: 0, states: [], peak: 0, speechStarts: 0, speechEnds: [], speechErrors: [], speechRequests: 0, meters: [] };
    Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: undefined });
    const NativeAudio = window.AudioContext;
    window.AudioContext = class extends NativeAudio {
      constructor(...args) {
        super(...args);
        this.addEventListener('statechange', () => window.qa.states.push(this.state));
      }
      createGain() {
        const gain = super.createGain();
        const analyser = super.createAnalyser();
        gain.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const meter = setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          window.qa.peak = Math.max(window.qa.peak, ...samples.map(Math.abs));
        }, 15);
        window.qa.meters.push(meter);
        return gain;
      }
    };
    if (window.speechSynthesis) {
      const speak = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = utterance => {
        window.qa.speechRequests++;
        let startedAt;
        utterance.addEventListener('start', () => { window.qa.speechStarts++;startedAt=Date.now(); });
        utterance.addEventListener('end', () => window.qa.speechEnds.push({ durationMs: Date.now() - startedAt }));
        utterance.addEventListener('error', event => window.qa.speechErrors.push(event.error));
        speak(utterance);
      };
    }
  });
  await nativePage.goto(origin);
  await nativePage.getByRole('button', { name: '전광판 열기', exact: true }).click();
  await nativePage.waitForFunction(() => window.qa.peak > .001);
  await nativePage.waitForFunction(() => window.qa.speechRequests > 0);
  await nativePage.locator('.wis-exchange__surge').waitFor({ state: 'hidden', timeout: 5000 });
  await nativePage.waitForFunction(() => window.qa.speechEnds.length > 0 || window.qa.speechErrors.length > 0, { timeout: 8000 });
  const nativeAudio = await nativePage.evaluate(() => {
    window.qa.meters.forEach(clearInterval);
    return { states: window.qa.states, peak: window.qa.peak, speechRequests: window.qa.speechRequests, speechStarts: window.qa.speechStarts, speechEnds: window.qa.speechEnds, speechErrors: window.qa.speechErrors, koreanVoices: window.speechSynthesis.getVoices().filter(voice => /^ko(?:[-_]|$)/i.test(voice.lang)).map(voice => voice.name) };
  });
  assert(nativeAudio.states.includes('running'), JSON.stringify(nativeAudio));
  assert(nativeAudio.peak > .001, 'native audio output has a non-silent waveform');
  assert.equal(nativeAudio.speechRequests, 1, 'native speech is requested automatically once');
  if (nativeAudio.koreanVoices.length) {
    assert(nativeAudio.speechStarts > 0, JSON.stringify(nativeAudio));
    assert.equal(nativeAudio.speechEnds.length, 1, 'the last spoken headline finishes after the visual popup closes: ' + JSON.stringify(nativeAudio));
  }
  await fs.writeFile(path.join(output, 'native-audio.json'), JSON.stringify(nativeAudio, null, 2) + '\n');
  await nativePage.close();
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ passed: true, nativeAudio, widths: [320,390,768,1280,1366,1440,1920], checks: ['80% popup size', 'three-second expiry', 'button/outside/Escape dismissal', 'half-hour expiry', 'ten-minute cadence', 'zero new subscriptions', 'sound and speech on opening', 'delayed voice availability', 'independent sound and speech', 'high-quality Korean voice selection with local tie-break', 'keyboard toggles', '44px non-overlapping controls', 'audio and subscription cleanup'], output }));
} finally { await browser.close();await new Promise(resolve => server.close(resolve)); }
