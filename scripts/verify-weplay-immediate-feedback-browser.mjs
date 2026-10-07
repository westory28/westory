/** Exercise the real naval component with deliberately delayed/reordered RPCs. */
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
const evidence = path.resolve(process.env.WEPLAY_QA_EVIDENCE_DIR || path.join(os.tmpdir(), 'westory-immediate-feedback-qa'));
await fs.mkdir(evidence, { recursive: true });
const source = relative => JSON.stringify(path.join(root, relative).replaceAll('\\', '/'));
const harness = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import Game from ${source('src/components/common/weplay/NavalBattleGame.tsx')};
import {simulateWeplayBattle} from ${source('src/lib/weplayBattle.ts')};
import ${source('src/components/common/weplay/weplay.css')};
const params=new URLSearchParams(location.search);
const initial=Date.now(),start=initial-500;
const texts=['거북선','이순신','명량해전','판옥선','한산도','천상열차분야지도'];
const session={id:'immediate-qa',mode:params.get('mode')||'practice',difficulty:'mild',battleVersion:1,startsAtMs:start,endsAtMs:start+90000,serverNowMs:initial,acceptedEvents:[],acceptedWordIds:[],words:texts.map((text,index)=>({id:'word-'+index,text,kind:index===5?'special':'normal',tactic:index===5?'학익진':undefined,spawnAtMs:0,fallDurationMs:60000,stage:1,unitId:'qa',lessonTitle:'빈칸',context:'빈칸 정답'})),policy:{challengeCost:2},correctCount:0,status:'active',result:null};
const qa=window.feedbackQa={session,calls:[],events:[],finishes:[],cues:[],result:null};
qa.accept=(index,release=true)=>{const call=qa.calls[index];if(!qa.events.some(event=>event.wordId===call.data.wordId))qa.events.push({wordId:call.data.wordId,elapsedMs:call.elapsedMs});call.reply={accepted:true,acceptedEvents:structuredClone(qa.events),acceptedWordIds:qa.events.map(event=>event.wordId),correctCount:qa.events.length,serverNowMs:Date.now()};if(release)call.resolve(call.reply);};
qa.release=index=>qa.calls[index].resolve(qa.calls[index].reply);
qa.reject=index=>qa.calls[index].resolve({accepted:false,acceptedEvents:structuredClone(qa.events),acceptedWordIds:qa.events.map(event=>event.wordId),correctCount:qa.events.length,serverNowMs:Date.now()});
qa.fail=index=>qa.calls[index].reject(new Error('연결이 끊겼습니다. 다시 전송해 주세요.'));
const transport={answer:data=>new Promise((resolve,reject)=>qa.calls.push({data:structuredClone(data),elapsedMs:Date.now()-start,resolve,reject})),finish:async options=>{qa.finishes.push({options,pending:qa.calls.length,at:Date.now()});const battle=simulateWeplayBattle(session,Date.now()-start,qa.events);return {sessionId:session.id,mode:session.mode,difficulty:'mild',correctCount:battle.normalCorrectCount,totalWords:5,score:battle.score,reward:0,cost:session.mode==='challenge'?2:0,netWis:session.mode==='challenge'?-2:0,balance:30,finishedAtMs:Date.now(),missedWords:[],battleVersion:1,battle};}};
createRoot(document.getElementById('root')).render(<main className='weplay-page'><Game session={session} config={{year:'2026',semester:'2'}} transport={transport} preview={params.get('preview')==='1'} onComplete={result=>{qa.result=result}}/></main>);
`;
const bundle = await build({
  stdin: { contents: harness, loader: 'tsx', resolveDir: root }, bundle: true, write: false,
  platform: 'browser', format: 'esm', target: 'es2022', outfile: path.join(os.tmpdir(), 'westory-feedback.js'),
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.BASE_URL': '"/"' },
  plugins: [{ name: 'only-boundary-fixtures', setup(plugin) {
    plugin.onResolve({ filter: /(?:^|\/)lib\/firebase$|^\.\/firebase$/ }, () => ({ path: 'firebase', namespace: 'feedback-fixture' }));
    plugin.onResolve({ filter: /^\.\/useWeplaySoundEffects$/ }, () => ({ path: 'sound', namespace: 'feedback-fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'feedback-fixture' }, args => ({ contents: args.path === 'sound' ? "export default ()=>({unlock(){},play(cue){window.feedbackQa.cues.push(cue)}});" : "export const getHttpsCallable=()=>{throw new Error('Unexpected live Firebase call')};", loader: 'ts' }));
  } }],
});
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
const html = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><div id="root"></div><script type="module" src="/qa.js"></script></html>';
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  try {
    if (pathname === '/qa.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); }
    else if (pathname === '/qa.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
    else if (pathname.startsWith('/assets/')) {
      const target = path.resolve(root, 'public', '.' + pathname);
      assert(target.startsWith(path.join(root, 'public') + path.sep));
      res.setHeader('Content-Type', pathname.endsWith('.svg') ? 'image/svg+xml' : 'image/webp');
      res.end(await fs.readFile(target));
    } else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); }
  } catch (error) { res.statusCode = 500; res.end(error.message); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await playwright.chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'msedge', headless: true });
const checks = [], errors = [];
const artworkMeasurements = [];
async function open(query = '', width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 950 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.clock.install({ time: new Date('2026-10-07T13:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-07T13:00:00Z'));
  await page.goto(origin + '/?' + query);
  await page.locator('.naval-game').waitFor();
  return page;
}
async function type(page, text) {
  await page.getByRole('textbox', { name: '단어 입력' }).fill(text);
  await page.getByRole('textbox', { name: '단어 입력' }).press('Enter');
}
async function ammo(page, amount) {
  await page.waitForFunction(value => document.querySelector('.naval-ammo').getAttribute('aria-label') === '포탄 장전 ' + value + ' / 2', amount);
}
async function calls(page, count) {
  assert.equal(await page.evaluate(() => window.feedbackQa.calls.length), count);
}
try {
  for (const width of [320, 390, 768, 1280]) {
    const page = await open('', width);
    await page.waitForFunction(() => [...document.querySelectorAll('.naval-ship')].every(image => image.complete && image.naturalWidth));
    await page.addStyleTag({ content: '.naval-ship { animation:none !important; transform:none !important; }' });
    await type(page, '거북선'); await type(page, '이순신');
    await page.locator('.naval-effect--cannon').waitFor();
    await page.locator('.naval-effect--cannon').evaluate(element => {
      for (const animation of element.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = 160; }
    });
    const measurement = await page.evaluate(() => {
      const image = document.querySelector('.naval-ship--allied');
      const imageRect = image.getBoundingClientRect();
      const scale = Math.min(image.clientWidth / image.naturalWidth, image.clientHeight / image.naturalHeight);
      const artWidth = image.naturalWidth * scale, artHeight = image.naturalHeight * scale;
      const mouth = { x: imageRect.left + (image.clientWidth - artWidth) / 2 + artWidth * .95, y: imageRect.bottom - artHeight + artHeight * .49 };
      const muzzle = document.querySelector('.naval-muzzle-flash').getBoundingClientRect();
      const title = document.querySelector('.naval-title-art').getBoundingClientRect();
      const scene = document.querySelector('.naval-scene').getBoundingClientRect();
      const ammo = document.querySelector('.naval-ammo').getBoundingClientRect();
      const ammoText = document.querySelector('.naval-ammo strong').getBoundingClientRect();
      const slots = document.querySelector('.naval-ammo-slots').getBoundingClientRect();
      const inside = (child, parent) => child.left >= parent.left - 1 && child.right <= parent.right + 1 && child.top >= parent.top - 1 && child.bottom <= parent.bottom + 1;
      return { width: innerWidth, muzzleError: Math.hypot(mouth.x - (muzzle.left + muzzle.width / 2), mouth.y - (muzzle.top + muzzle.height / 2)), overflow: document.documentElement.scrollWidth > innerWidth, titleInside: inside(title, scene), ammoInside: inside(ammo, scene), ammoTextInside: inside(ammoText, ammo), slotsInside: inside(slots, ammo), croppedCannonIcons: document.querySelectorAll('.naval-cannon-icon').length, titleAspect: getComputedStyle(document.querySelector('.naval-title-art')).aspectRatio };
    });
    assert(measurement.muzzleError <= 3, `width${width}: muzzle must sit at the ship mouth, error=${measurement.muzzleError}px`);
    assert.equal(measurement.overflow, false, `width${width}: no horizontal overflow`);
    for (const key of ['titleInside', 'ammoInside', 'ammoTextInside', 'slotsInside']) assert.equal(measurement[key], true, `width${width}: ${key}`);
    assert.equal(measurement.croppedCannonIcons, 0);
    assert.equal(measurement.titleAspect, '700 / 182');
    artworkMeasurements.push(measurement);
    await page.screenshot({ path: path.join(evidence, 'mouth-ammo-title-' + width + '.png'), fullPage: true });
    await page.close();
  }
  checks.push('320/390/768/1280px: cannon muzzle within3px of the visible ship mouth, complete title/ammo bounds and no horizontal overflow');
  for (const [query, width] of [['mode=practice', 390], ['mode=challenge', 1280], ['preview=1', 768]]) {
    const page = await open(query, width);
    await type(page, '거북선'); await ammo(page, 1); await calls(page, 1);
    assert.equal(await page.locator('.naval-effect--cannon').count(), 0);
    await page.clock.runFor(500);
    await ammo(page, 1);
    await type(page, '이순신'); await ammo(page, 0); await calls(page, 2);
    await page.locator('.naval-effect--cannon').waitFor();
    assert.deepEqual(await page.evaluate(() => window.feedbackQa.cues), ['word', 'word', 'cannon']);
    await page.clock.runFor(500);
    assert.equal(await page.locator('.naval-health--enemy').getAttribute('aria-label'), '적군 체력 88');
    await page.clock.runFor(1500);
    await page.evaluate(() => { window.feedbackQa.accept(0, false); window.feedbackQa.accept(1); });
    await ammo(page, 0);
    await page.evaluate(() => window.feedbackQa.release(0));
    await page.waitForTimeout(30);
    assert.deepEqual(await page.evaluate(() => window.feedbackQa.cues), ['word', 'word', 'cannon'], 'Reversed acknowledgements cannot replay any cue');
    assert.equal(await page.locator('.naval-effect--cannon').count(), 0, 'Old acknowledgement cannot create a new cannon after its first animation expired');
    assert.equal(await page.locator('.naval-hud-score strong').textContent(), '350');
    await page.screenshot({ path: path.join(evidence, 'delayed-' + width + '.png'), fullPage: true });
    await page.close();
  }
  checks.push('Student practice/challenge and teacher preview: immediate 1/2 gauge, immediate second-word cannon, 500–2000ms RPC delays and reversed ACKs without duplicate cues');

  const reject = await open();
  await type(reject, '거북선'); await type(reject, '이순신'); await ammo(reject, 0);
  await reject.locator('.naval-effect--cannon').waitFor();
  await reject.evaluate(() => { window.feedbackQa.accept(0); window.feedbackQa.reject(1); });
  await ammo(reject, 1);
  await reject.clock.runFor(2500);
  assert.equal(await reject.locator('.naval-health--enemy').getAttribute('aria-label'), '적군 체력 100', 'Rejected prediction cancels every old impact timer');
  assert.equal(await reject.locator('.naval-effect--cannon').count(), 0);
  assert.equal(await reject.locator('.naval-hud-score strong').textContent(), '100');
  await type(reject, '명량해전'); await ammo(reject, 0);
  await reject.locator('.naval-effect--cannon').waitFor();
  await reject.evaluate(() => window.feedbackQa.accept(2));
  await reject.clock.runFor(500);
  assert.equal(await reject.locator('.naval-health--enemy').getAttribute('aria-label'), '적군 체력 88');
  await reject.close();
  checks.push('Rejected second word removes provisional ammo/score/damage and cancels delayed hits; the next genuine pair fires normally');

  const retry = await open();
  await type(retry, '거북선'); await ammo(retry, 1);
  await retry.evaluate(() => window.feedbackQa.fail(0)); await ammo(retry, 0);
  await retry.getByRole('button', { name: '입력 다시 전송' }).click(); await ammo(retry, 1);
  assert.equal(await retry.evaluate(() => window.feedbackQa.calls[0].data.eventId === window.feedbackQa.calls[1].data.eventId), true, 'Retry keeps the idempotency key');
  await retry.evaluate(() => window.feedbackQa.accept(1)); await ammo(retry, 1);
  await type(retry, '거북선'); await calls(retry, 2);
  assert.equal(await retry.locator('.naval-effect--cannon').count(), 0);
  await retry.close();
  checks.push('Network failure rolls the unconfirmed word back; retry reuses its event ID and duplicate typing cannot count the same word twice');

  const rapid = await open();
  await type(rapid, '거북선'); await type(rapid, '이순신'); await type(rapid, '명량해전'); await type(rapid, '판옥선');
  await ammo(rapid, 0); await calls(rapid, 4);
  assert.equal(await rapid.locator('.naval-effect--cannon').count(), 2);
  assert.deepEqual(await rapid.evaluate(() => window.feedbackQa.cues.filter(cue => cue === 'cannon')), ['cannon', 'cannon']);
  await rapid.evaluate(() => { for(let i=0;i<4;i++)window.feedbackQa.accept(i,false); window.feedbackQa.release(3); });
  await rapid.evaluate(() => { window.feedbackQa.release(2); window.feedbackQa.release(0); window.feedbackQa.release(1); });
  await rapid.clock.runFor(500);
  assert.equal(await rapid.locator('.naval-health--enemy').getAttribute('aria-label'), '적군 체력 76');
  assert.equal(await rapid.evaluate(() => window.feedbackQa.cues.filter(cue => cue === 'cannon').length), 2);
  await rapid.close();
  checks.push('Four rapidly submitted words before any ACK yield exactly two cannons, with no replay from reversed cumulative replies');

  const special = await open();
  await type(special, '천상열차분야지도');
  await special.locator('.naval-special-attack').waitFor();
  await type(special, '거북선'); await type(special, '이순신');
  await special.locator('.naval-effect--cannon').waitFor();
  assert.equal(await special.evaluate(() => window.feedbackQa.cues.filter(cue => cue === 'special').length), 1);
  await special.clock.runFor(500);
  assert.equal(await special.locator('.naval-health--enemy').getAttribute('aria-label'), '적군 체력 88', 'Normal cannon lands at its own420ms arrival during the longer special');
  await special.evaluate(() => { window.feedbackQa.reject(0); window.feedbackQa.accept(1); window.feedbackQa.accept(2); });
  await special.clock.runFor(2700);
  assert.equal(await special.locator('.naval-health--enemy').getAttribute('aria-label'), '적군 체력 88');
  assert.equal(await special.locator('.naval-special-attack').count(), 0);
  await special.close();
  checks.push('Special begins instantly; a normal pair also launches immediately during it, and a rejected special cannot leave its later damage/sinking behind');

  const ended = await open('mode=challenge');
  await type(ended, '거북선');
  await ended.clock.runFor(92000);
  assert.equal(await ended.evaluate(() => window.feedbackQa.finishes.length), 0, 'A pending prediction cannot settle as a confirmed result');
  await ended.evaluate(() => window.feedbackQa.reject(0));
  await ended.clock.runFor(3000);
  await ended.waitForFunction(() => Boolean(window.feedbackQa.result));
  assert.equal(await ended.evaluate(() => window.feedbackQa.result.correctCount), 0);
  assert.equal(await ended.evaluate(() => window.feedbackQa.result.netWis), -2);
  assert.equal(await ended.evaluate(() => window.feedbackQa.finishes.length), 1);
  await ended.close();
  checks.push('Time expiry waits for pending answer resolution and settles once with server-confirmed count/Wis only');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(evidence, 'checks.json'), JSON.stringify({ checks, artworkMeasurements, errors }, null, 2));
  console.log(JSON.stringify({ status: 'passed', checks, evidence }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
