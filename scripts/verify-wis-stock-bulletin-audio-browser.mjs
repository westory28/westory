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
const output = path.join(root, 'output/wispi-bulletins-20261123');
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
 qa.tick=()=>{market={...market,updatedAtMs:Date.now(),stocks:[{...market.stocks[0],price:64,previousPrice:40,priceAtMs:Date.now()}]};qa.emit();};
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
  for (const width of [320, 390, 768, 1280, 1440, 1920]) {
    const page = await browser.newPage({ viewport: { width, height: width < 600 ? 740 : 1000 } });
    page.on('pageerror', error => failures.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.addInitScript(() => {
      window.qa = { starts: 0, stops: 0, spoken: [], canceled: 0, tones: 0, closed: 0 };
      Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: undefined });
      class AudioContextMock {
        state = 'suspended'; currentTime = 0; destination = {};
        resume() { this.state = 'running';return Promise.resolve(); }
        close() { this.state = 'closed';window.qa.closed++;return Promise.resolve(); }
        createOscillator() { return { frequency: {}, connect(){}, disconnect(){}, start(){window.qa.tones++;}, stop(){} }; }
        createGain() { return { gain: { setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){}, disconnect(){} }; }
      }
      Object.defineProperty(window, 'AudioContext', { configurable: true, value: AudioContextMock });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; } } });
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        getVoices: () => window.qa.voices ?? [{ name: 'English Natural', lang: 'en-US', localService: true }, { name: '한국어 원격 Natural', lang: 'ko-KR', localService: false }, { name: '한국어 Natural', lang: 'ko-KR', localService: true }],
        speak: utterance => window.qa.spoken.push({ text: utterance.text, voice: utterance.voice?.name, lang: utterance.lang }),
        cancel: () => window.qa.canceled++,
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
    await page.getByRole('button', { name: '전광판 열기', exact: true }).click();
    const display = page.getByRole('dialog', { name: '위스피 전광판' });
    const popup = display.locator('.wis-exchange__surge');
    await popup.waitFor();
    assert((await popup.innerText()).includes('-60.00%'));
    assert(!(await popup.innerText()).includes('지난시간종목'));
    const sound = display.getByRole('button', { name: '속보 알림음', exact: true });
    const speech = display.getByRole('button', { name: '속보 음성', exact: true });
    const close = display.getByRole('button', { name: '전광판 닫기', exact: true });
    assert.equal(await sound.getAttribute('aria-pressed'), 'false');
    assert.equal(await speech.getAttribute('aria-pressed'), 'false');
    await sound.click();await speech.focus();await speech.press('Space');
    await page.clock.fastForward(500);
    const audible = await page.evaluate(() => window.qa);
    assert.equal(audible.tones, 2);
    assert.deepEqual(audible.spoken, [{ text: '비파메탈 주가가 60 퍼센트 급락했습니다.', voice: width === 320 ? '한국어 원격 Neural' : width === 390 ? 'Google 한국의' : '한국어 Natural', lang: 'ko-KR' }], 'high-quality Korean voices outrank a basic local default; local Natural wins over remote Natural');
    const geometry = await display.locator('.wis-exchange__actions').evaluate(node => {
      const buttons = [...node.querySelectorAll('button')].map(button => { const r = button.getBoundingClientRect();return { left: r.left, right: r.right, width: r.width, height: r.height }; });
      return { buttons, viewport: innerWidth, scroll: document.querySelector('.wis-exchange').scrollWidth };
    });
    assert(geometry.buttons.every(rect => rect.left >= 0 && rect.right <= width && rect.width >= 44 && rect.height >= 44), JSON.stringify(geometry));
    assert(geometry.buttons[0].right <= geometry.buttons[1].left && geometry.buttons[1].right <= geometry.buttons[2].left);
    assert(geometry.scroll <= width, JSON.stringify(geometry));
    await page.screenshot({ path: path.join(output, `display-audio-${width}.png`) });
    await speech.click();
    assert.equal(await speech.getAttribute('aria-pressed'), 'false');
    const canceled = await page.evaluate(() => window.qa.canceled);
    await page.clock.fastForward(7_500);
    assert.equal(await popup.isVisible(), false);
    await page.clock.fastForward(592_000);
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
    await close.click();
    assert.equal(await page.evaluate(() => window.qa.stops), 1);
    assert.equal(await page.evaluate(() => window.qa.closed), 1);
    assert(await page.evaluate(previous => window.qa.canceled > previous, canceled));
    assert(await page.getByRole('button', { name: '전광판 열기' }).evaluate(node => document.activeElement === node));
    await page.close();
  }
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ passed: true, widths: [320,390,768,1280,1440,1920], checks: ['half-hour expiry', 'ten-minute cadence', 'zero new subscriptions', 'independent sound and speech', 'high-quality Korean voice selection with local tie-break', 'keyboard toggles', '44px non-overlapping controls', 'audio and subscription cleanup'], output }));
} finally { await browser.close();await new Promise(resolve => server.close(resolve)); }
