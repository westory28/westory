/** Actual stock management UI, synthetic scope/watch services, no production access. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const evidence = path.join(root, 'output/wispi-filters-20261116');
await fs.mkdir(evidence, { recursive: true });
const imp = file => JSON.stringify(path.join(root, file).replaceAll('\\', '/'));
const service = `
import {DEFAULT_WIS_STOCK_MARKET_RULES} from ${imp('functions/wisStockMarketRules.mjs')};
export const qa=window.stockFiltersQa={uid:'teacher-a',generation:1,config:{year:'2026',semester:'2'},reads:0,saves:0,watches:0};
const data=[['역사 기본','조선',undefined],['역사 명시','고려','HISTORICAL'],['가치 하나','상시 가치','VALUE'],['가치 공통','조선','VALUE'],['역사 미지정','','HISTORICAL'],['역사 긴 주제','조선 후기 상업의 발달과 사회 변화를 함께 살펴보는 매우 긴 시대와 주제','HISTORICAL']];
const settings={description:'학생이 가격과 역사 배경을 함께 확인할 수 있는 합성 설명입니다.',initialPrice:100,minimumPrice:1,maximumPrice:10000,volatilityBps:300,trendBps:0,intervalHours:1,automatic:true,issuedShares:100000,lotSize:1,tradingStatus:'ACTIVE'};
qa.market={semesterId:'2026-2',revision:1,studentOpen:true,rules:{...DEFAULT_WIS_STOCK_MARKET_RULES,halted:false},maxStocks:100,historyLimit:120,updatedAtMs:1794787200000,stocks:data.map(([name,period,growthProfile],i)=>({id:'stock_'+String(i+1).padStart(24,'0'),settings:{...settings,name,period,...(growthProfile?{growthProfile}:{})},price:110,updatedAtMs:1794787200000,nextTickAtMs:1794790800000,history:[{atMs:1794783600000,price:100},{atMs:1794787200000,price:110}]}))};
export const useAuth=()=>({currentUser:{uid:qa.uid},authGeneration:qa.generation});
export const useAppToast=()=>({showToast:()=>{}});
export const getYearSemester=config=>config;
export const getWisStockManagement=async scope=>{qa.reads++;return structuredClone({...qa.market,semesterId:scope.year+'-'+scope.semester})};
export const watchWisStockListings=(scope,next)=>{qa.watches++;qa.next=next;next(qa.market.stocks.map(stock=>stock.id).sort(),qa.market.revision);return()=>{qa.next=null}};
const mutation=()=>{qa.saves++;throw Error('Unexpected mutation')};
export const saveWisStock=mutation,setWisStockMarketHalted=mutation,activateWisStockCatalogPlan=mutation;
export const wisStockErrorMessage=error=>error.message,isWisStockRevisionConflict=()=>false;
`;
const bundle = await build({
  stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import Stocks from ${imp('src/pages/teacher/components/points/TeacherWisStocks.tsx')};import{qa}from ${imp('src/lib/wisStocksClient')};import ${imp('src/assets/index.css')};import ${imp('src/components/common/portalPage.css')};function App(){const[version,setVersion]=useState(0);qa.refresh=()=>setVersion(value=>value+1);return <main className="ws-page"><Stocks config={{...qa.config}} canManage={true}/></main>}createRoot(document.getElementById('root')).render(<App/>);`, loader: 'tsx', resolveDir: root },
  bundle: true, write: false, format: 'esm', outfile: 'fixture.js', loader: { '.svg': 'dataurl' },
  plugins: [{ name: 'synthetic-stock-filters', setup(plugin) {
    plugin.onResolve({ filter: /contexts\/AuthContext$|common\/AppToastProvider$|lib\/wisStocksClient$|lib\/semesterScope$|lib\/wisStockListingSubscription$/ }, () => ({ path: 'service', namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: service, loader: 'tsx', resolveDir: root }));
    plugin.onResolve({ filter: /^\.\/WisStockChartPreview$|^\.\/WisStockMarketRules$|^\.\/WisStockInvestmentBoard$/ }, () => ({ path: 'unused-tab', namespace: 'empty' }));
    plugin.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: 'export default function Empty(){return null}', loader: 'tsx' }));
  }}],
});
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text.replace(/@import\s+(?:url\(["']?https?:[^)]*\)|["']https?:[^"']*["'])\s*;/g, '');
const html = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#f3f4f6}*{box-sizing:border-box}main{padding:16px}</style><link rel="stylesheet" href="/qa.css"><div id="root"></div><script type="module" src="/qa.js"></script></html>';
const server = http.createServer((req, res) => {
  const file = { '/qa.js': ['text/javascript', js], '/qa.css': ['text/css', css] }[new URL(req.url, 'http://localhost').pathname] || ['text/html', html];
  res.setHeader('Content-Type', file[0] + ';charset=utf-8'); res.end(file[1]);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'msedge', headless: true });
const errors = [], checks = [], layouts = [];
const rowNames = page => page.locator('.wis-stocks__row').filter({hasNotText:'전체 위스피'}).locator('.wis-stocks__row-name > strong').allTextContents();
const periods = page => page.getByRole('group', { name: '시대·주제 필터', exact: true });
const selectType = (page, value) => page.getByLabel('종목 유형', { exact: true }).selectOption(value);
async function open(width) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin); await page.getByLabel('종목 유형', { exact: true }).waitFor();
  return page;
}
let failure;
try {
  for (const width of [320, 390, 768, 1280]) {
    const page = await open(width);
    assert.equal((await rowNames(page)).length, 6);
    assert.equal(await periods(page).getByRole('button', { name: '조선', exact: true }).count(), 1);
    await selectType(page, 'HISTORICAL');
    assert.deepEqual(await rowNames(page), ['역사 기본', '역사 명시', '역사 미지정', '역사 긴 주제']);
    assert.equal(await periods(page).getByRole('button', { name: '상시 가치', exact: true }).count(), 0);
    await periods(page).getByRole('button', { name: '시대 미지정', exact: true }).press('Enter');
    assert.deepEqual(await rowNames(page), ['역사 미지정']);
    await selectType(page, 'VALUE');
    assert.equal(await periods(page).getByRole('button', { name: '전체', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await rowNames(page), ['가치 하나', '가치 공통']);
    await periods(page).getByRole('button', { name: '조선', exact: true }).click();
    await selectType(page, 'HISTORICAL');
    assert.equal(await periods(page).getByRole('button', { name: '조선', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await rowNames(page), ['역사 기본']);
    await page.getByRole('button', { name: '시장 규칙', exact: true }).click();
    await page.getByRole('button', { name: '종목 관리', exact: true }).click();
    assert.equal(await page.getByLabel('종목 유형', { exact: true }).inputValue(), 'HISTORICAL');
    assert.deepEqual(await rowNames(page), ['역사 기본']);
    assert.match(await page.locator('.wis-stocks__filter-count').innerText(), /전체 6개 중 1개/);
    await selectType(page, 'ALL');
    await periods(page).getByRole('button', { name: '전체', exact: true }).click();
    const layout = await page.locator('.wis-stocks__filters').evaluate(element => ({
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      background: getComputedStyle(element).backgroundColor, shadow: getComputedStyle(element).boxShadow,
      controls: [...element.querySelectorAll('button,select')].map(control => ({ height: control.getBoundingClientRect().height, left: control.getBoundingClientRect().left, right: control.getBoundingClientRect().right })),
    }));
    assert(layout.scrollWidth <= width, JSON.stringify(layout));
    assert.equal(layout.background, 'rgba(0, 0, 0, 0)'); assert.equal(layout.shadow, 'none');
    assert(layout.controls.every(control => control.height >= 44 && control.left >= 0 && control.right <= width + 1), JSON.stringify(layout));
    assert.equal(await page.evaluate(() => window.stockFiltersQa.reads), 1);
    assert.equal(await page.evaluate(() => window.stockFiltersQa.saves), 0);
    await page.screenshot({ path: path.join(evidence, `filters-${width}.png`), fullPage: true });
    layouts.push(layout); await page.close();
  }
  checks.push('Four widths: absent growth profile is historical; unique period buttons, blank-period option, compatible selection preserved/incompatible reset, tab persistence, transparent filters and 44px wrapping controls; zero extra reads/writes.');
  const page = await open(1280);
  await page.locator('.wis-stocks__row').filter({ hasText: '역사 기본' }).click();
  assert.equal(await page.getByLabel('종목명', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '종목 편집', exact: true }).click();
  await page.getByLabel('종목명', { exact: true }).fill('보존해야 하는 편집 초안');
  await page.getByRole('button', { name: '종목 편집', exact: true }).click();
  assert.equal(await page.getByLabel('종목명', { exact: true }).inputValue(), '보존해야 하는 편집 초안');
  await selectType(page, 'VALUE');
  await page.locator('.wis-stocks__detail').getByRole('heading', {name:'가치 하나',exact:true}).waitFor();
  assert.equal(await page.getByRole('button', { name: '종목 편집', exact: true }).isDisabled(), true);
  await periods(page).getByRole('button', { name: '조선', exact: true }).click();
  await page.locator('.wis-stocks__detail').getByRole('heading', {name:'가치 공통',exact:true}).waitFor();
  assert.equal(await page.getByLabel('종목명', { exact: true }).inputValue(), '보존해야 하는 편집 초안');
  await page.evaluate(() => { const q = window.stockFiltersQa; q.market.stocks = q.market.stocks.filter(stock => stock.settings.name !== '가치 공통'); q.market.revision++; q.next(q.market.stocks.map(stock => stock.id).sort(), q.market.revision); });
  await page.waitForFunction(() => window.stockFiltersQa.reads === 2);
  await page.getByRole('button', { name: '전체', exact: true }).waitFor();
  assert.equal(await periods(page).getByRole('button', { name: '전체', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await rowNames(page), ['가치 하나']);
  await page.locator('.wis-stocks__detail').getByRole('heading', {name:'가치 하나',exact:true}).waitFor();
  assert.equal(await page.getByLabel('종목명', { exact: true }).inputValue(), '보존해야 하는 편집 초안');
  await page.evaluate(() => { const q = window.stockFiltersQa; q.uid = 'teacher-b'; q.generation++; q.refresh(); });
  await page.waitForFunction(() => window.stockFiltersQa.reads === 3);
  assert.equal(await page.getByLabel('종목 유형', { exact: true }).inputValue(), 'ALL');
  await page.locator('.wis-stocks__detail').getByRole('heading', {name:'전체 위스피',exact:true}).waitFor();
  assert.equal(await page.getByLabel('종목명', { exact: true }).count(), 0);
  await selectType(page, 'HISTORICAL');
  await periods(page).getByRole('button', { name: '고려', exact: true }).click();
  await page.locator('.wis-stocks__row').filter({ hasText: '역사 명시' }).click();
  await page.evaluate(() => { const q = window.stockFiltersQa; q.config = { year: '2027', semester: '1' }; q.refresh(); });
  await page.waitForFunction(() => window.stockFiltersQa.reads === 4);
  assert.equal(await page.getByLabel('종목 유형', { exact: true }).inputValue(), 'ALL');
  assert.equal(await periods(page).getByRole('button', { name: '전체', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.locator('.wis-stocks__detail').getByRole('heading', {name:'전체 위스피',exact:true}).waitFor();
  await page.evaluate(() => { const q = window.stockFiltersQa; q.market.stocks = q.market.stocks.filter(stock => stock.settings.growthProfile !== 'VALUE'); q.market.revision++; q.next(q.market.stocks.map(stock => stock.id).sort(), q.market.revision); });
  await page.waitForFunction(() => window.stockFiltersQa.reads === 5);
  await page.locator('.wis-stocks__row').filter({ hasText: '역사 기본' }).click();
  await selectType(page, 'VALUE');
  await page.locator('.wis-stocks__detail').getByRole('heading', {name:'전체 위스피',exact:true}).waitFor();
  assert.match(await page.locator('.wis-stocks__list .wis-stocks__empty').innerText(), /선택한 유형의 종목이 없습니다/);
  assert.match(await page.locator('.wis-stocks__filter-count').innerText(), /전체 4개 중 0개/);
  assert.equal(await page.evaluate(() => window.stockFiltersQa.reads), 5);
  assert.equal(await page.evaluate(() => window.stockFiltersQa.saves), 0);
  await page.close();
  checks.push('Filtering and market refresh preserve hidden editor draft; unavailable period resets; account and semester changes reset filters and editor; empty type is explicit; only original load/scope/server revision reads occur.');
  assert.deepEqual(errors, []);
} catch (error) { failure = error; console.error(error); }
finally {
  await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify({ passed: !failure, checks, layouts, errors, productionReads: 0, productionWrites: 0, failure: failure?.stack }, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
if (failure) throw failure;
console.log(JSON.stringify({ passed: checks.length, evidence, productionReads: 0, productionWrites: 0 }));
