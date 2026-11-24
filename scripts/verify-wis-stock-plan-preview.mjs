// Local synthetic inputs only. No production connection or data mutation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { DEFAULT_WIS_STOCK_MARKET_RULES, isWisStockTradingSession, wisStockKstSession, wisStockDailyBounds } from '../functions/wisStockMarketRules.mjs';
import { catalogSessionAtMs, catalogExitAtMs } from '../functions/wisStockCatalogTimeline.mjs';
import { blankMarket, marketPath, createWisStockHandlers, advanceMarket } from '../functions/wisStocks.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(root, 'output/wispi-special-sessions-20261124');
await fs.mkdir(evidence, { recursive: true });
const bundled = await build({ entryPoints: [path.join(root, 'src/lib/wisStockPlanPreview.ts')], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('module', 'exports', bundled.outputFiles[0].text)(module, module.exports);
const { createWisStockRulePlanStocks: simulate, matchWisStockPlanStocks: match } = module.exports;
const rules = { ...DEFAULT_WIS_STOCK_MARKET_RULES, dailyPriceLimitBps: 6000, circuitBreakerBps: 6000 };
const startsAtMs = Date.parse('2026-11-16T09:00:00+09:00');
const plan = { version: 1, startsAtMs };
const began = performance.now();
const examples = simulate(rules, '2026-2', plan);
const calculationMs = Math.round(performance.now() - began);
assert.equal(examples.length, 80);
assert(examples.every(stock => stock.settings.initialPrice >= 100 && stock.settings.initialPrice <= 500));
for (const stock of examples) {
  let day = '', open = stock.settings.initialPrice, previous = open;
  for (const point of stock.history) {
    assert.equal(point.atMs % 600_000, 0);
    assert.equal(isWisStockTradingSession(rules, point.atMs), true);
    const key = wisStockKstSession(point.atMs).dayKey;
    if (key !== day) { day = key; open = previous; }
    const bounds = wisStockDailyBounds(open, rules.dailyPriceLimitBps);
    assert(point.price >= bounds.minimum && point.price <= bounds.maximum);
    previous = point.price;
  }
}
assert(examples.some(stock => stock.history.some(point => point.atMs % 3_600_000 === 600_000)));
const bipa = examples.find(stock => stock.settings.name === '비파메탈');
const real = { ...structuredClone(bipa), price: 431, updatedAtMs: startsAtMs + 7 * 86_400_000,
  history: [{ atMs: startsAtMs, price: 100 }, { atMs: startsAtMs + 7 * 86_400_000, price: 431 }] };
const before = JSON.stringify(real);
assert.equal(match(examples, [real]).find(stock => stock.id === real.id), real);
assert.equal(JSON.stringify(real), before);
const legacy = { ...real, id: 'stock_000000000000000000000999' };
assert.equal(match(examples, [legacy]).find(stock => stock.settings.name === '비파메탈'), legacy);
assert.equal(match(examples, [legacy, { ...legacy, id: 'stock_000000000000000000000998' }]).find(stock => stock.settings.name === '비파메탈'), bipa);
const narrower = simulate({ ...rules, dailyPriceLimitBps: 1000, circuitBreakerBps: 1000 }, '2026-2', plan);
assert(examples.some((stock, i) => JSON.stringify(stock.history) !== JSON.stringify(narrower[i].history)));
assert.equal(match(narrower, [real]).find(stock => stock.id === real.id), real, 'Rule changes never rewrite observed history');
for (const stop of [{ halted: true }, { automaticPrices: false }])
  assert(simulate({ ...rules, ...stop }, '2026-2', plan).every(stock => stock.history.length <= 1));
const restricted = { ...rules, tradingDays: [2, 4], openMinuteKst: 600, closeMinuteKst: 660 };
assert(simulate(restricted, '2026-2', plan).every(stock => stock.history.every(point => isWisStockTradingSession(restricted, point.atMs))));
assert.notDeepEqual(simulate({ ...rules, circuitBreakerBps: 1, circuitBreakerMinutes: 180 }, '2026-2', plan), examples);
assert.deepEqual(simulate(rules, '2026-2', plan), examples, 'Stable rules produce stable examples');
assert.throws(() => simulate({ ...rules, dailyPriceLimitBps: 6001 }, '2026-2', plan));
const exitEntry = { id: bipa.id, exitSession: 34 };
const extendedAt = Date.parse('2026-11-24T14:00:00+09:00');
const extended = { ...plan, exitsEnabledAtMs: startsAtMs, exitOverrides: { [bipa.id]: extendedAt } };
assert.equal(catalogSessionAtMs(34, startsAtMs), Date.parse('2026-11-20T14:00:00+09:00'));
assert.equal(catalogExitAtMs(exitEntry, extended), extendedAt);
assert.equal(catalogExitAtMs({ ...exitEntry, exitSession: null }, extended), null);
assert.throws(() => catalogSessionAtMs(211, startsAtMs));
assert.throws(() => catalogExitAtMs(exitEntry, { ...plan, exitOverrides: { [bipa.id]: NaN } }));

const scope = {year:'2026', semester:'2', semesterId:'2026-2'};
const asOfMs = real.updatedAtMs;
const manual = {...structuredClone(real), id: examples.find(stock => stock.settings.name === '움집홈즈').id,
  settings:{...real.settings, name:'움집홈즈', automatic:false, tradingStatus:'ACTIVE'}, price:1000,
  history:[{atMs:asOfMs,price:1000}]};
const future = examples.find(stock => stock.settings.name === '서인발전');
const saved = {...blankMarket(scope), revision:1, stocks:[real, manual], studentOpen:true, catalogPlan:extended,
  rules, priceSeed:'a'.repeat(64), updatedAtMs:asOfMs};
const documents = new Map([['users/teacher',{role:'teacher'}],['site_settings/config',scope],
  ['site_settings/semester_active',{semesterId:scope.semesterId}],['semester_manifests/2026-2',{status:'ACTIVE'}],
  [marketPath(scope),saved]]);
let dbReads = 0;
const service = createWisStockHandlers({ now:() => asOfMs, assertSession:async () => ({uid:'teacher'}),
  db:{doc: path => path, runTransaction: async (fn, options) => {
    assert.equal(options.readOnly,true);
    return fn({get:async path => {dbReads++;return {exists:documents.has(path),data:() => structuredClone(documents.get(path))};}});
  }}});
const load = async stockId => service.getWisStockManagement({auth:{uid:'teacher'},
  data:{year:'2026',semester:'2',...(stockId ? {forecastStockId:stockId} : {})}});
const management = await load();
const previews = {};
const expectedCloses = [];
for (const stock of [manual, future, real]) {
  const beforeReads = dbReads;
  const projection = await load(stock.id);
  assert.equal(dbReads - beforeReads,5);
  assert.equal(projection.stockId, stock.id);
  assert(!Object.hasOwn(projection, 'priceSeed'));
  if (stock === future) {
    assert(projection.history[0].atMs >= catalogSessionAtMs(176, startsAtMs));
  }
  if (stock === manual) {
    let simulation = structuredClone(saved);
    for (const point of projection.history) {
      simulation = advanceMarket(simulation, point.atMs);
      assert.equal(point.price, simulation.stocks.find(item => item.id === stock.id).price);
    }
    for (const {dayKey} of projection.specialSessions) {
      expectedCloses.push(projection.history.filter(point => new Date(point.atMs + 9*3600000).toISOString().slice(0,10) === dayKey).at(-1)?.price);
    }
    assert.deepEqual(expectedCloses, [800,880,968]);
  }
  previews[stock.id] = projection;
}
const fixture = await build({ stdin: { contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import Preview from './src/pages/teacher/components/points/WisStockChartPreview';
import './src/pages/teacher/components/points/TeacherWisStocks.css';
import './src/assets/index.css';
const initial=${JSON.stringify({ stocks: [real,manual], rules, revision: 1, semesterId: '2026-2', catalogPlan: extended, specialSessions:management.specialSessions })};
const results=${JSON.stringify(previews)};
window.forecastQa={calls:[],examples:[]};
async function readForecast(id){const q=window.forecastQa;q.calls.push(id);if(q.fail){q.fail=false;throw Error('합성 조회 오류')}if(q.hold){q.hold=false;await new Promise(resolve=>q.release=resolve)}return structuredClone(results[id]);}
function App(){const[value,setValue]=useState(initial);window.qa={setValue,value};return <main className="ws-page"><section className="wis-stocks"><Preview {...value} readForecast={readForecast}/></section></main>}createRoot(document.getElementById('root')).render(<App/>);`, loader: 'tsx', resolveDir: root }, bundle: true, write: false, format: 'esm', outfile: 'fixture.js',
  plugins: [{ name: 'local-orders', setup(plugin) {
    plugin.onResolve({filter:/\/lib\/wisStockPlanPreview$/},()=>({path:'plan',namespace:'probe'}));
    plugin.onLoad({filter:/.*/,namespace:'probe'},()=>({contents:`
      import {createWisStockRulePlanStocks as simulate} from './src/lib/wisStockPlanPreview.ts';
      export * from './src/lib/wisStockPlanPreview.ts';
      export function createWisStockRulePlanStocks(...args){const start=performance.now();const items=simulate(...args);window.forecastQa.examples.push({id:args[3],count:items.length,ms:performance.now()-start});return items;}
    `,resolveDir:root,loader:'js'}));
    plugin.onResolve({ filter: /WisStockOrderPreview$/ }, () => ({ path: 'orders', namespace: 'qa' }));
    plugin.onLoad({ filter: /.*/, namespace: 'qa' }, () => ({ contents: 'export default function Orders(){return null}', loader: 'js' }));
  } }], loader: { '.svg': 'dataurl', '.webp': 'dataurl' } });
const js = fixture.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = fixture.outputFiles.find(file => file.path.endsWith('.css')).text;
const html = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#f3f4f6}*{box-sizing:border-box}</style><link rel="stylesheet" href="/qa.css"><div id="root"></div><script type="module" src="/qa.js"></script></html>';
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost').pathname;
  if (/^\/wispi\/catalog\/[a-zA-Z0-9_-]+\.svg$/.test(url)) { res.setHeader('Content-Type', 'image/svg+xml'); res.end(await fs.readFile(path.join(root, 'public', url))); return; }
  const [type, body] = url === '/qa.js' ? ['text/javascript', js] : url === '/qa.css' ? ['text/css', css] : ['text/html', html];
  res.setHeader('Content-Type', `${type};charset=utf-8`); res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const browser = await playwright.chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'msedge', headless: true });
const errors = [];
const entryTimes = [];
try {
  for (const width of [390, 768, 1280, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    const external = [];
    await page.route('**/*', route => { if (route.request().url().startsWith(origin)) return route.continue(); external.push(route.request().url()); return route.abort(); });
    await page.goto(origin);
    await page.getByRole('heading', { name: '비파메탈', exact: true }).waitFor();
    assert.match(await page.locator('.wis-stock-preview__quote').innerText(), /431/);
    const candleData = () => page.locator('.wispi-price-chart__candle').evaluateAll(nodes => nodes.map(node => ['data-start-at-ms', 'data-open', 'data-high', 'data-low', 'data-close'].map(key => node.getAttribute(key))));
    const candles = await candleData();
    assert.equal(candles.length, 2);
    const begin = await page.evaluate(()=>performance.now());
    await page.getByRole('button', { name: '6주 기획안', exact: true }).press('Enter');
    await page.getByText('6주 기획안 · 등록 종목', { exact: true }).waitFor();
    const dates = page.getByRole('region', { name:'특별장 일정', exact:true });
    await dates.getByRole('row', {name:/12월 16일.*수.*검은 화요일.*-20%/}).waitFor();
    await dates.getByRole('row', {name:/12월 23일.*수.*크리스마스 랠리.*\+10% 이상/}).waitFor();
    await dates.getByRole('row', {name:/12월 24일.*목.*크리스마스 랠리.*\+10% 이상/}).waitFor();
    entryTimes.push({width, ms:Math.round(await page.evaluate(()=>performance.now())-begin)});
    assert.deepEqual(await page.evaluate(()=>window.forecastQa.examples),[],'No local simulation to enter an observed stock or show the calendar');
    assert.equal(await dates.locator('h3').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
    assert.deepEqual(await page.evaluate(()=>window.forecastQa.calls),[]);
    assert.match(await page.locator('.wis-stock-preview__quote').innerText(), /431/);
    assert.deepEqual(await candleData(), candles);
    await page.getByText('종목 로드맵·역사 근거', { exact: true }).click();
    await page.getByText(/11월 24일/).first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('.wis-stock-preview__heading').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    await page.screenshot({ path: path.join(evidence, `registered-plan-${width}.png`), fullPage: true });
    await page.getByRole('button', {name:/움집홈즈/}).click();
    const forecastButton = page.getByRole('button', {name:'운영 예정 시세',exact:true});
    const chart = page.getByRole('region', {name:'운영 예정 시세',exact:true});
    await page.evaluate(()=>window.forecastQa.fail=true);
    await forecastButton.press('Enter');
    await chart.getByText('합성 조회 오류', {exact:true}).waitFor();
    await chart.getByRole('button',{name:'다시 조회',exact:true}).click();
    const closings = chart.locator('.wis-stock-catalog__event-prices');
    for (const price of expectedCloses) await closings.getByText(price+' 위스',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.forecastQa.calls),[manual.id, manual.id]);
    await page.getByRole('button', {name:'등록 시세',exact:true}).click();
    await page.getByRole('heading', {name:'움집홈즈',exact:true}).waitFor();
    await forecastButton.click();
    await closings.getByText('968 위스',{exact:true}).waitFor();
    const picker = chart.getByRole('combobox',{name:'10분 예정가 거래일',exact:true});
    await picker.selectOption('2026-12-24');
    const slots = chart.getByRole('table',{name:'10분 예정가',exact:true});
    const expected = previews[manual.id].history.filter(point=>new Date(point.atMs+9*3600000).toISOString().slice(0,10)==='2026-12-24');
    assert.equal(await slots.locator('tbody tr').count(),42);
    assert.deepEqual(await slots.locator('tbody td').allInnerTexts(), expected.map(point=>point.price.toLocaleString('ko-KR')+' 위스'));
    await slots.getByRole('row',{name:'15:50 968 위스',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.forecastQa.calls.length),2);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(evidence,`forecast-${width}.png`), fullPage:true});
    await page.getByLabel('공개 차수', {exact:true}).selectOption('6');
    await page.getByRole('button', {name:/서인발전/}).click();
    assert.deepEqual(await page.evaluate(()=>window.forecastQa.examples.map(({id,count})=>[id,count])),[[future.id,1]]);
    entryTimes.at(-1).selectedExampleMs = Math.round(await page.evaluate(()=>window.forecastQa.examples[0].ms));
    await page.evaluate(()=>window.forecastQa.hold=true);
    await forecastButton.click();
    await chart.getByRole('status').waitFor();
    await page.evaluate(()=>window.forecastQa.release());
    await chart.getByRole('heading',{name:'서인발전 예정 시세',exact:true}).waitFor();
    await chart.locator('.wispi-price-chart__candle').first().waitFor();
    assert.deepEqual(await page.evaluate(()=>window.forecastQa.calls),[manual.id,manual.id,future.id]);
    assert.equal(await chart.locator('.wis-stock-catalog__event-prices > div').count(),2,'No quotes before the planned listing date');
    await page.getByLabel('공개 차수',{exact:true}).selectOption('1');
    await page.getByRole('button', { name: /돌끝테크/ }).click();
    await page.getByText('6주 기획안 · 상장 예정 종목', { exact: true }).waitFor();
    await page.evaluate(() => window.qa.setValue(value => ({ ...value, rules: { ...value.rules, automaticPrices: false } })));
    await page.waitForFunction(() => window.qa.value.rules.automaticPrices === false);
    await page.waitForFunction(() => document.querySelectorAll('.wispi-price-chart__candle').length === 1);
    assert.equal(await page.locator('.wispi-price-chart__candle').count(), 1);
    await page.evaluate(() => window.qa.setValue(value => ({ ...value, stocks: value.stocks.map(stock => stock.settings.name === '비파메탈' ? { ...stock, id: 'stock_000000000000000000000999' } : stock) })));
    await page.getByRole('button', { name: /비파메탈/ }).click();
    await page.getByText('6주 기획안 · 등록 종목', { exact: true }).waitFor();
    await page.getByText('종목 로드맵·역사 근거', { exact: true }).click();
    await page.getByText('기획 종료', { exact: true }).waitFor();
    assert.equal(await page.getByText('예정 종료 시각', { exact: true }).count(), 0);
    const explanation=page.getByText('이름이 같은 개별 등록 종목은 자동 종료 대상에서 제외됩니다.', { exact: true });
    assert.equal(await explanation.count(), 0);
    await page.getByRole('button', { name: '미리보기 자료', exact: true }).focus();
    await explanation.waitFor();
    assert(external.every(url => new URL(url).hostname === 'fonts.googleapis.com'), 'No external service request beyond the blocked existing font stylesheet');
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
const report = { status: 'PASS', calculationMs, checks: ['Registered observations are the same objects in both views, including legacy IDs; no synthetic append or mutation.', 'Unlisted examples use saved days/hours, ten-minute slots, daily bounds, circuit stop/resume, automatic/market stop and 100–500 opening examples.', 'Shared session and extended exit dates remain identical across server/client; null exits and invalid dates tested.', '390/768/1280/1440 browser: three dated events are visible before any forecast read. Registered and upcoming quotes use actual handler projections. A 1,000-Wis manual instrument closes at 800/880/968 and every displayed 10-minute slot agrees with the response. Upcoming prices begin at listing. One scoped forecast request uses 5 reads and zero writes in the synthetic database.', 'No fetch on selection, one per explicit attempt, local toggle restores the result. Past 431-Wis observations survive, no external service request (existing font stylesheet blocked).'], evidence };
report.browserTimings = entryTimes;
await fs.writeFile(path.join(evidence, 'summary.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
