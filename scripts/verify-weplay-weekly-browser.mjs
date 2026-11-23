import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), root = process.cwd();
const { build } = require('esbuild');
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const evidence = path.join(root, 'output/weplay-weekly-browser-20261123');
await fs.mkdir(evidence, { recursive: true });
const fixture = `
import {useSyncExternalStore} from 'react';
const listeners=new Set();
export const getWeplayRankingWeek=(time=Date.now())=>{const d=new Date(time+9*3600000);const startsAtMs=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-9*3600000-((d.getUTCDay()+6)%7)*86400000;return {startsAtMs,endsAtMs:startsAtMs+7*86400000}};
const qa=window.weeklyQA={calls:[],hold:false,pending:[],fail:false,plans:{},auth:{currentUser:{uid:'teacher-a',email:'qa@example.test'},userData:{role:'teacher'},config:{year:'2026',semester:'2'},authGeneration:1}};
qa.update=value=>{qa.auth={...qa.auth,...value};listeners.forEach(fn=>fn())};
export const useAuth=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>qa.auth);
export const canReadLessonManagement=()=>true;
export const canWriteLessonManagement=()=>qa.auth.userData.role==='teacher';
export const useAppToast=()=>({showToast:()=>{}});
export const WEPLAY_DIFFICULTY_LABELS={mild:'순한맛',medium:'보통맛',spicy:'매운맛'};
export const getHistoryDictionaryCallable=async name=>async data=>{
const key=qa.auth.currentUser.uid+'/'+data.category+'/'+data.mode;
const prior=qa.plans[key]||{tiers:[],revision:0,enabled:false,status:'disabled'};
qa.calls.push({name,data,uid:qa.auth.currentUser.uid});
let value={...prior,mode:data.mode,week:getWeplayRankingWeek(data.mode==='week'?Date.parse(data.weekId+'T12:00:00+09:00'):Date.now())};
if(name==='saveWeplayWeeklyRewards'){if(qa.fail)throw Error('합성 저장 오류');value={...value,tiers:data.tiers,enabled:data.enabled,origin:null,revision:prior.revision+1,status:data.mode==='week'?'scheduled':data.enabled?'recurring':'disabled'};qa.plans[key]=value;}
if(qa.hold)await new Promise(resolve=>qa.pending.push(resolve));
return {data:value};};
`;
const bundled = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Rewards from './src/components/common/weplay/WeplayWeeklyRewards';import './src/assets/index.css';import './assets/css/style.css';createRoot(document.getElementById('root')).render(<main><Rewards gameId="history-rain"/></main>);`, loader: 'tsx', resolveDir: root },
  bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(os.tmpdir(), 'weekly-qa.js'), metafile: true,
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl', '.webp': 'dataurl' }, define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'synthetic-boundaries', setup(plugin) {
    plugin.onResolve({ filter: /(?:AuthContext|permissions|historyDictionarySession|weplayRanking|AppToastProvider)$|\/lib\/weplay$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'tsx', resolveDir: root }));
    plugin.onResolve({ filter: /^\/assets\// }, args => ({ path: args.path, external: true }));
  } }],
});
assert(!Object.keys(bundled.metafile.inputs).some(name => /node_modules[\\/](@firebase|firebase)[\\/]/.test(name)));
const js = bundled.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundled.outputFiles.find(file => file.path.endsWith('.css')).text.replace(/^@import .*;$/gm, '');
const server = http.createServer((req, res) => {
  if (req.url === '/qa.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(js); }
  if (req.url === '/qa.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
  res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><style>body{margin:0;background:#f3f4f6}main{padding:16px;max-width:1152px;margin:auto}*{box-sizing:border-box}</style><div id="root"></div><script type="module" src="/qa.js"></script></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`, errors = [];
const browser = await playwright.chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'msedge', headless: true });
try {
  for (const width of [390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    await page.goto(base); await page.locator('summary').waitFor();
    assert.equal(await page.evaluate(() => window.weeklyQA.calls.length), 0, 'Closed form must not fetch');
    await page.locator('summary').click();
    await page.getByLabel('매주 지급', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('보상 적용 방식').inputValue(), 'recurring');
    assert(await page.getByRole('button', { name: '보상 설정 저장', exact: true }).isDisabled(), 'Unchanged OFF is disabled');
    await page.getByRole('button', { name: '보상 구간 추가' }).click();
    await page.getByLabel('1구간 지급 위스').fill('100');
    await page.getByLabel('매주 지급', { exact: true }).selectOption('on');
    await page.evaluate(() => { window.weeklyQA.fail = true; });
    await page.getByRole('button', { name: '보상 설정 저장', exact: true }).click();
    await page.getByRole('alert').waitFor();
    await page.evaluate(() => { window.weeklyQA.fail = false; window.weeklyQA.hold = true; });
    await page.getByRole('button', { name: '보상 설정 저장', exact: true }).click();
    await page.evaluate(() => { for(let i=0;i<20;i++)document.querySelector('.weplay-weekly-rewards-actions .is-primary').click(); });
    assert.equal(await page.evaluate(() => window.weeklyQA.calls.filter(call => call.name === 'saveWeplayWeeklyRewards').length), 2);
    const ids = await page.evaluate(() => window.weeklyQA.calls.filter(call => call.name === 'saveWeplayWeeklyRewards').map(call => call.data.requestId));
    assert.equal(ids[0], ids[1], 'Failed save retains its request receipt ID');
    await page.evaluate(() => { window.weeklyQA.hold = false; window.weeklyQA.pending.splice(0).forEach(resolve => resolve()); });
    await page.getByText('매주 자동 지급', { exact: true }).waitFor();
    assert(await page.getByRole('button', { name: '보상 설정 저장', exact: true }).isDisabled());
    await page.evaluate(() => { window.weeklyQA.plans['teacher-a/mild/week']={tiers:[{throughRank:1,wis:100}],revision:1,origin:'recurring',status:'scheduled'}; });
    await page.getByLabel('보상 적용 방식').selectOption('week');
    const override = page.getByRole('button', { name: '이 주차만 저장', exact: true });
    await override.waitFor(); assert(await override.isEnabled()); await override.click();
    await page.waitForFunction(() => window.weeklyQA.plans['teacher-a/mild/week'].origin === null);
    await page.waitForFunction(() => document.querySelector('.weplay-weekly-rewards-actions .is-primary').disabled);
    await page.getByLabel('보상 주차').fill('2026-10-19');
    await page.getByLabel('보상 적용 방식').selectOption('recurring');
    await page.getByLabel('매주 지급', { exact: true }).waitFor();
    const lastWeek = await page.evaluate(() => window.weeklyQA.calls.at(-1).data.weekId);
    assert.notEqual(lastWeek, '2026-10-19', 'Recurring mode never submits hidden old week');
    await page.evaluate(() => { window.weeklyQA.hold = true; window.weeklyQA.plans['teacher-a/medium/recurring']={tiers:[{throughRank:1,wis:300}],revision:1,enabled:true,status:'recurring'}; window.weeklyQA.plans['teacher-a/spicy/recurring']={tiers:[{throughRank:1,wis:700}],revision:1,enabled:true,status:'recurring'}; });
    await page.getByLabel('보상 랭킹').selectOption('medium');
    await page.waitForFunction(() => window.weeklyQA.pending.length > 0);
    await page.evaluate(() => { window.weeklyQA.hold = false; });
    await page.getByLabel('보상 랭킹').selectOption('spicy');
    await page.waitForFunction(() => document.querySelector('[aria-label="1구간 지급 위스"]')?.value === '700');
    await page.evaluate(() => window.weeklyQA.pending.splice(0).forEach(resolve => resolve()));
    assert.equal(await page.getByLabel('1구간 지급 위스').inputValue(), '700');
    await page.screenshot({ path: path.join(evidence, `weekly-configured-${width}.png`), fullPage: true });
    await page.evaluate(() => { window.weeklyQA.hold=true; });
    await page.getByRole('button', { name: '새로고침' }).click();
    await page.waitForFunction(() => window.weeklyQA.pending.length > 0);
    await page.evaluate(() => { window.weeklyQA.hold=false; window.weeklyQA.update({currentUser:{uid:'teacher-b'},authGeneration:2}); });
    await page.waitForFunction(() => window.weeklyQA.calls.at(-1).uid === 'teacher-b');
    await page.evaluate(() => window.weeklyQA.pending.splice(0).forEach(resolve => resolve()));
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="1구간 지급 위스"]').length === 0);
    assert.equal(await page.getByLabel('매주 지급', { exact: true }).inputValue(), 'off');
    // A pending save from the prior account cannot lock or overwrite a new
    // account's draft, nor release its independent duplicate-request guard.
    await page.getByRole('button', { name: '보상 구간 추가' }).click();
    await page.getByLabel('1구간 지급 위스').fill('50');
    await page.getByLabel('매주 지급', { exact: true }).selectOption('on');
    await page.evaluate(() => { window.weeklyQA.hold = true; });
    await page.getByRole('button', { name: '보상 설정 저장', exact: true }).click();
    await page.waitForFunction(() => window.weeklyQA.pending.length === 1);
    await page.evaluate(() => { window.weeklyQA.hold=false; window.weeklyQA.update({currentUser:{uid:'teacher-c'},authGeneration:3}); });
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="1구간 지급 위스"]').length === 0);
    await page.getByRole('button', { name: '보상 구간 추가' }).click();
    await page.getByLabel('1구간 지급 위스').fill('80');
    await page.getByLabel('매주 지급', { exact: true }).selectOption('on');
    await page.evaluate(() => { window.weeklyQA.hold = true; });
    await page.getByRole('button', { name: '보상 설정 저장', exact: true }).click();
    await page.waitForFunction(() => window.weeklyQA.pending.length === 2);
    await page.evaluate(() => window.weeklyQA.pending.shift()());
    assert(await page.getByRole('button', { name: '저장 중…', exact: true }).isDisabled());
    assert.equal(await page.getByLabel('1구간 지급 위스').inputValue(), '80');
    await page.evaluate(() => { for(let i=0;i<20;i++)document.querySelector('.weplay-weekly-rewards-actions .is-primary').click(); });
    assert.equal(await page.evaluate(() => window.weeklyQA.calls.filter(call => call.uid === 'teacher-c' && call.name === 'saveWeplayWeeklyRewards').length), 1);
    await page.evaluate(() => { window.weeklyQA.hold=false; window.weeklyQA.pending.splice(0).forEach(resolve => resolve()); });
    await page.getByRole('button', { name: '보상 설정 저장', exact: true }).waitFor();
    assert.equal(await page.getByLabel('1구간 지급 위스').inputValue(), '80');
    const visual = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
      summary: getComputedStyle(document.querySelector('summary')).backgroundColor,
      controls: [...document.querySelectorAll('button,select,input')].filter(node => node.getClientRects().length).every(node => node.getBoundingClientRect().height >= 44) }));
    assert.equal(visual.overflow, false); assert.equal(visual.summary, 'rgba(0, 0, 0, 0)'); assert(visual.controls);
    await page.screenshot({ path: path.join(evidence, `weekly-${width}.png`), fullPage: true });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, widths: [390, 768, 1280], checks: ['closed read budget', 'recurring default and OFF no-op', 'retry receipt and click deduplication', 'old-week switch', 'same-amount manual override', 'late category and account response isolation', 'account change during pending save', 'computed styles and layout'], productionRequests: 0 }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
