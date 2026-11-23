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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(root, 'output/wispi-plan-sync-20261123');
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
    assert.equal(point.atMs % 1_800_000, 0);
    assert.equal(isWisStockTradingSession(rules, point.atMs), true);
    const key = wisStockKstSession(point.atMs).dayKey;
    if (key !== day) { day = key; open = previous; }
    const bounds = wisStockDailyBounds(open, rules.dailyPriceLimitBps);
    assert(point.price >= bounds.minimum && point.price <= bounds.maximum);
    previous = point.price;
  }
}
assert(examples.some(stock => stock.history.some(point => point.atMs % 3_600_000 === 1_800_000)));
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

const fixture = await build({ stdin: { contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import Preview from './src/pages/teacher/components/points/WisStockChartPreview';
import './src/pages/teacher/components/points/TeacherWisStocks.css';
import './src/assets/index.css';
const initial=${JSON.stringify({ stocks: [real], rules, revision: 1, semesterId: '2026-2', catalogPlan: extended })};
function App(){const[value,setValue]=useState(initial);window.qa={setValue,value};return <main className="ws-page"><section className="wis-stocks"><Preview {...value}/></section></main>}createRoot(document.getElementById('root')).render(<App/>);`, loader: 'tsx', resolveDir: root }, bundle: true, write: false, format: 'esm', outfile: 'fixture.js',
  plugins: [{ name: 'local-orders', setup(plugin) {
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
    await page.getByRole('button', { name: '6주 기획안', exact: true }).press('Enter');
    await page.getByText('6주 기획안 · 등록 시세', { exact: true }).waitFor();
    assert.match(await page.locator('.wis-stock-preview__quote').innerText(), /431/);
    assert.deepEqual(await candleData(), candles);
    await page.getByText('종목 로드맵·역사 근거', { exact: true }).click();
    await page.getByText(/11월 24일/).first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('.wis-stock-preview__heading').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    await page.screenshot({ path: path.join(evidence, `registered-plan-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: /돌끝테크/ }).click();
    await page.getByText('6주 기획안 · 미상장 모의 시세', { exact: true }).waitFor();
    await page.evaluate(() => window.qa.setValue(value => ({ ...value, rules: { ...value.rules, automaticPrices: false } })));
    await page.waitForFunction(() => window.qa.value.rules.automaticPrices === false);
    await page.waitForFunction(() => document.querySelectorAll('.wispi-price-chart__candle').length === 1);
    assert.equal(await page.locator('.wispi-price-chart__candle').count(), 1);
    await page.evaluate(() => window.qa.setValue(value => ({ ...value, stocks: value.stocks.map(stock => ({ ...stock, id: 'stock_000000000000000000000999' })) })));
    await page.getByRole('button', { name: /비파메탈/ }).click();
    await page.getByText('6주 기획안 · 등록 시세', { exact: true }).waitFor();
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
const report = { status: 'PASS', calculationMs, checks: ['Registered observations are the same objects in both views, including legacy IDs; no synthetic append or mutation.', 'Unlisted examples use saved days/hours, half-hour slots, daily bounds, circuit stop/resume, automatic/market stop and 100–500 opening examples.', 'Shared session and extended exit dates remain identical across server/client; null exits and invalid dates tested.', '390/768/1280/1440 browser: actual 431 quote preserved, extended exit visible, local rule changes reflected, transparent heading, no horizontal overflow or service request (existing font stylesheet blocked).'], evidence };
await fs.writeFile(path.join(evidence, 'summary.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
