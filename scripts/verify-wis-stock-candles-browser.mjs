import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url), { build } = require('esbuild');
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const evidence = process.env.WIS_CANDLES_QA_DIR || path.join(os.tmpdir(), 'westory-wis-candles-qa');
await fs.mkdir(evidence, { recursive: true });
const fixture = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import Chart from ${JSON.stringify(path.join(root, 'src/components/common/WisStockPriceChart.tsx'))};
import Overview from ${JSON.stringify(path.join(root, 'src/pages/teacher/components/points/WisStockMarketOverview.tsx'))};
import Preview from ${JSON.stringify(path.join(root, 'src/pages/teacher/components/points/WisStockChartPreview.tsx'))};
import {DEFAULT_WIS_STOCK_MARKET_RULES as rules} from ${JSON.stringify(path.join(root, 'functions/wisStockMarketRules.mjs'))};
import ${JSON.stringify(path.join(root, 'src/assets/index.css'))};
import ${JSON.stringify(path.join(root, 'src/components/common/portalPage.css'))};
import ${JSON.stringify(path.join(root, 'src/pages/teacher/components/points/TeacherWisStocks.css'))};
const start=Date.parse('2026-11-16T09:00:00.123+09:00');
window.chartQa={history:[{atMs:start,price:100},{atMs:start+600000,price:140},{atMs:start+1200000,price:80},{atMs:start+1800000,price:120},{atMs:start+7200000,price:90},{atMs:start+86400000,price:95}],days:Infinity};
function App(){const[,rerender]=useState(0);window.renderChart=()=>rerender(v=>v+1);const q=window.chartQa,mode=new URLSearchParams(location.search).get('mode')||'overview';const stock={id:'synthetic',settings:{name:'합성 관측 종목',description:'합성 설명',period:'조선',initialPrice:100,minimumPrice:1,maximumPrice:10000,volatilityBps:300,trendBps:0,intervalHours:24,automatic:false,issuedShares:100000,lotSize:1,tradingStatus:'ACTIVE'},history:q.history,price:q.history.at(-1)?.price||100,updatedAtMs:q.history.at(-1)?.atMs||start,nextTickAtMs:start+86400000};const index={baseValue:1000,baseAtMs:start,value:1001.456,previousClose:1000,updatedAtMs:start+1800000,history:[{atMs:start,value:1000.125},{atMs:start+600000,value:999.999},{atMs:start+1200000,value:1002.567},{atMs:start+1800000,value:1001.456}]};return <main className="ws-page wis-stocks"><h1 className="ws-page-title">봉차트 검증</h1>{mode==='preview'?<Preview stocks={[stock]} rules={rules} revision={1} semesterId="2026-2"/>:mode==='index'?<Overview index={index} asOfMs={stock.updatedAtMs}/>:mode==='line'?<Chart stock={stock} days={q.days}/>:mode==='direct'?<Chart stock={stock} days={q.days} variant="candlestick"/>:<Overview stock={stock} asOfMs={stock.updatedAtMs}/>}</main>};createRoot(document.getElementById('root')).render(<App/>);
`;
const bundle = await build({ loader: { '.svg': 'dataurl' }, stdin: { contents: fixture, loader: 'tsx', resolveDir: root }, bundle: true, write: false, format: 'esm', outfile: 'fixture.js' });
const js = bundle.outputFiles.find(f => f.path.endsWith('.js')).text, css = bundle.outputFiles.find(f => f.path.endsWith('.css')).text.replace(/@import[^;]*https:\/\/fonts\.googleapis\.com[^;]*;/g, '');
const html = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}*{box-sizing:border-box}</style><link rel="stylesheet" href="/qa.css"><div id="root"></div><script type="module" src="/qa.js"></script></html>';
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (/^\/wispi\/catalog\/[a-zA-Z0-9_-]+\.svg$/.test(pathname)) { try { res.setHeader('Content-Type', 'image/svg+xml'); res.end(await fs.readFile(path.join(root, 'public', pathname))); } catch { res.writeHead(404); res.end(); } return; }
  const file = { '/qa.js': ['text/javascript', js], '/qa.css': ['text/css', css] }[pathname] || ['text/html', html];
  res.setHeader('Content-Type', file[0] + ';charset=utf-8'); res.end(file[1]);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'msedge', headless: true });
const errors = [], requests = [], checks = [];
async function open(width, mode = 'overview', reduced = true) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { const url = route.request().url(); if (url.startsWith(origin)) return route.continue(); requests.push(url); return route.abort(); });
  await page.goto(origin + '/?mode=' + mode); await page.locator('.wispi-price-chart__canvas').waitFor(); return page;
}
const values = page => page.locator('.wispi-price-chart__candle').evaluateAll(nodes => nodes.map(n => ['open','high','low','close'].map(key => Number(n.dataset[key]))));
const finite = async page => assert.equal(await page.locator('.wispi-price-chart svg').evaluate(svg => /NaN|Infinity/.test(svg.innerHTML)), false);
const unclipped = async page => assert.equal(await page.getByRole('tooltip').evaluate(tip => { const t = tip.getBoundingClientRect(), c = tip.closest('.wispi-price-chart__canvas').getBoundingClientRect(); return t.left < c.left || t.right > c.right || t.top < c.top || t.bottom > c.bottom; }), false);
const layout = async (page, width) => {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}: page overflow`);
  assert.equal(await page.locator('.wispi-price-chart__controls').evaluate(e => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)');
  for (const b of await page.getByRole('group', { name: '봉차트 단위', exact: true }).getByRole('button').all()) { assert((await b.boundingBox()).height >= 44); assert.equal(await b.evaluate(e => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)'); }
  assert.equal(await page.locator('.wispi-price-chart').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(255, 255, 255)');
  await finite(page);
};
try {
  for (const width of [320, 390, 768, 1280, 1440]) {
    for (const mode of ['overview', 'preview']) {
      const page = await open(width, mode), canvas = page.locator('.wispi-price-chart__canvas');
      if (mode === 'preview') await page.getByRole('heading', { name: '주식 차트 미리보기', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '일봉', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.deepEqual(await values(page), [[100, 140, 80, 90], [95, 95, 95, 95]]);
      await page.screenshot({ path: path.join(evidence, `${mode}-candles-${width}.png`), fullPage: true });
      await canvas.focus(); await canvas.press('Home');
      const tip = page.getByRole('tooltip');
      assert.match(await tip.innerText(), /2026\. 11\. 16\. 09:00:00\.123/);
      assert.match(await tip.innerText(), /11:00:00\.123/);
      assert.match(await tip.innerText(), /시가\s+100 위스/); assert.match(await tip.innerText(), /고가\s+140 위스/);
      assert.match(await tip.innerText(), /저가\s+80 위스/); assert.match(await tip.innerText(), /종가\s+90 위스/);
      assert.match(await tip.innerText(), /관측 5회/); await unclipped(page);
      assert.equal(await tip.locator('dt').first().evaluate(e => getComputedStyle(e).color), 'rgb(226, 232, 240)');
      await canvas.press('ArrowRight'); assert.equal(await tip.getAttribute('data-price'), '95');
      await canvas.press('Home'); await canvas.press('End'); assert.equal(await tip.getAttribute('data-price'), '95');
      const bounds = await canvas.boundingBox(); await canvas.press('Escape'); assert.equal(await tip.count(), 0); assert.deepEqual(await canvas.boundingBox(), bounds);
      await canvas.evaluate(e => e.blur()); await page.mouse.move(bounds.x + 76, bounds.y + 100); await tip.waitFor(); assert.equal(await tip.getAttribute('data-price'), '90');
      await canvas.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: bounds.x + bounds.width - 16, clientY: bounds.y + 120 }); assert.equal(await tip.getAttribute('data-price'), '95');
      await page.getByRole('button', { name: '시간봉', exact: true }).click();
      assert.deepEqual(await values(page), [[100, 140, 80, 120], [90, 90, 90, 90], [95, 95, 95, 95]]);
      const xs = await page.locator('.wispi-price-chart__candle > line:first-child').evaluateAll(lines => lines.map(l => Number(l.getAttribute('x1'))));
      assert(Math.abs((xs[1] - xs[0]) / (xs[2] - xs[0]) - 2 / 24) < 0.000001);
      await page.getByRole('button', { name: '주봉', exact: true }).press('Enter'); assert.deepEqual(await values(page), [[100, 140, 80, 95]]);
      await page.getByRole('button', { name: '일봉', exact: true }).click(); await canvas.focus(); await canvas.press('Home');
      await layout(page, width); assert.equal(await page.locator('.wis-stock-chart__plot').getAttribute('style'), null);
      await page.screenshot({ path: path.join(evidence, `${mode}-${width}.png`), fullPage: true }); await page.close();
    }
  }
  checks.push('Teacher overview and chart-management: observed OHLC, default daily/hourly/weekly switching, 44px controls, KST exact times, hover/touch/keyboard, no clipping/overflow, transparent controls, reduced motion at all five widths.');
  const index = await open(390, 'index'); assert.deepEqual(await values(index), [[1000.125, 1002.567, 999.999, 1001.456]]); await index.locator('.wispi-price-chart__canvas').focus(); assert.match(await index.getByRole('tooltip').innerText(), /1,001\.46 pt/); await unclipped(index); await finite(index); await index.close();
  const cases = [[{ atMs: 0, price: 1 }], [{ atMs: 1000, price: 100 }, { atMs: 1000, price: 200 }], [{ atMs: 0, price: 1 }, { atMs: 8_640_000_000_000_000, price: Number.MAX_SAFE_INTEGER }], [{ atMs: 1794787200000, price: 100 }, { atMs: 1794787200100, price: 100 }], [null, { atMs: NaN, price: 1 }, { atMs: 1000, price: -1 }], []];
  for (const history of cases) {
    const page = await open(320, 'direct'); await page.evaluate(history => { window.chartQa.history = history; window.renderChart(); }, history); await finite(page);
    if (history.length && history[0]) { const canvas = page.locator('.wispi-price-chart__canvas'); await canvas.focus(); await canvas.press('End'); assert.equal(Number(await page.getByRole('tooltip').getAttribute('data-price')), history.at(-1).price); await unclipped(page); }
    else { assert.equal(await page.locator('.wispi-price-chart__candle').count(), 0); await page.getByText('아직 가격 기록이 없습니다.').waitFor(); }
    await page.close();
  }
  checks.push('Fractional market index, duplicate/flat/single/empty/malformed and extreme observations preserve real values and finite geometry.');
  const partial = await open(390, 'direct'); await partial.evaluate(() => { window.chartQa.history = [{ atMs: Date.parse('2026-11-15T09:00:00+09:00'), price: 900 }, { atMs: Date.parse('2026-11-15T13:00:00+09:00'), price: 110 }, { atMs: Date.parse('2026-11-16T12:00:00+09:00'), price: 120 }]; window.chartQa.days = 1; window.renderChart(); }); assert.deepEqual(await values(partial), [[110,110,110,110],[120,120,120,120]]); await partial.close();
  const preview = await open(390, 'preview'); await preview.getByRole('button', { name: '6주 기획안', exact: true }).click(); await preview.getByText('6주 기획안 · 가상 시세', { exact: true }).waitFor(); assert.notDeepEqual(await values(preview), [[100,140,80,90],[95,95,95,95]]); await preview.getByRole('button', { name: '등록 종목', exact: true }).click(); assert.deepEqual(await values(preview), [[100,140,80,90],[95,95,95,95]]); await preview.close();
  checks.push('Rolling period filters observations before OHLC aggregation; simulated six-week plan stays separate from registered real observations.');
  for (const width of [320,390,768,1280,1440]) {
    const line = await open(width, 'line'); assert.equal(await line.locator('.wispi-price-chart__controls').count(), 0); assert.equal(await line.locator('.wispi-price-chart__candle').count(), 0); const points = (await line.locator('.wis-stock-chart__plot polyline').getAttribute('points')).split(' ').map(p => p.split(',').map(Number)); assert.equal(points.length, 6); assert(Math.abs((points[1][0]-points[0][0])/(points.at(-1)[0]-points[0][0])-600000/86400000)<0.000001); const canvas = line.locator('.wispi-price-chart__canvas'); await canvas.focus(); await canvas.press('Home'); assert.equal(await line.getByRole('tooltip').getAttribute('data-price'), '100'); await canvas.press('ArrowRight'); assert.equal(await line.getByRole('tooltip').getAttribute('data-price'), '140'); await finite(line); await unclipped(line); await line.close();
  }
  const animated = await open(390, 'overview', false); await animated.getByRole('button', { name: '주봉', exact: true }).click(); assert.notEqual(await animated.locator('.wis-stock-chart__plot').getAttribute('style'), null); await animated.close();
  checks.push('Default student-style line chart retains proportional timestamps, per-observation keyboard tooltip and no candle controls; normal-motion candles use the existing scoped plot animation.');
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  await fs.writeFile(path.join(evidence, 'results.json'), JSON.stringify({ passed: true, checks, errors, externalRequests: requests }, null, 2)); console.log(JSON.stringify({ passed: true, evidence, checks }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
