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
const evidence = process.env.WIS_STOCKS_QA_DIR || path.join(os.tmpdir(), 'westory-wis-stocks-qa');
await fs.mkdir(evidence, { recursive: true });
const service = `
export const qa=window.stockQa={reads:0,saves:0,toasts:[],failRead:false,failSave:false,holdRead:false,config:{year:'2026',semester:'2'}};
const params=new URLSearchParams(location.search);
qa.hidden=params.has('hidden');Object.defineProperty(document,'hidden',{get:()=>qa.hidden,configurable:true});
const settings={name:params.has('long')?'조선 후기 상업 발전과 신분제의 변화에 관한 긴 종목 이름':'합성 역사 종목',description:'합성 역사 배경',period:'조선 후기',initialPrice:100,minimumPrice:1,maximumPrice:10000,volatilityBps:300,trendBps:0,intervalHours:24,automatic:false};
qa.market={semesterId:'2026-2',revision:1,studentOpen:false,maxStocks:40,historyLimit:120,updatedAtMs:1794643200000,stocks:params.has('empty')?[]:[{id:'stock_000000000000000000000001',settings,price:130,updatedAtMs:1794643200000,nextTickAtMs:1794729600000,history:[{atMs:1794556800000,price:100},{atMs:1794600000000,price:120},{atMs:1794643200000,price:130}]}]};
export const useAuth=()=>({currentUser:{uid:'teacher'},authGeneration:1});
export const useAppToast=()=>({showToast:value=>qa.toasts.push(value)});
export const getYearSemester=config=>config;
export const getWisStockManagement=async scope=>{qa.reads++;const state=structuredClone({...qa.market,semesterId:scope.year+'-'+scope.semester});if(qa.holdRead){qa.holdRead=false;await new Promise(resolve=>qa.release=resolve)}if(qa.failRead)throw Error('조회 오류');return state};
export const saveWisStock=async(scope,expectedRevision,stockId,settings)=>{qa.saves++;if(qa.failSave)throw Error('저장 오류');const id=stockId||'stock_000000000000000000000002';const stock=qa.market.stocks.find(s=>s.id===id)||{id,price:settings.initialPrice,updatedAtMs:1794643200000,nextTickAtMs:1794729600000,history:[{atMs:1794643200000,price:settings.initialPrice}]};stock.settings=structuredClone(settings);qa.market.stocks=qa.market.stocks.filter(s=>s.id!==id).concat(stock);qa.market.revision++;return {...structuredClone(qa.market),savedStockId:id,changed:true,duplicate:false}};
export const wisStockErrorMessage=error=>error.message;
`;
const bundle = await build({ loader: { '.svg': 'dataurl' }, stdin: { contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import Stocks from ${JSON.stringify(path.join(root,'src/pages/teacher/components/points/TeacherWisStocks.tsx'))};import ${JSON.stringify(path.join(root,'src/assets/index.css'))};import ${JSON.stringify(path.join(root,'src/components/common/portalPage.css'))};function App(){const[active,setActive]=useState(false);window.renderStocks=()=>setActive(value=>value);return <main className="ws-page"><button id="open" onClick={()=>setActive(!active)}>{active?'주식 닫기':'주식 열기'}</button>{active&&<Stocks config={window.stockQa.config} canManage={!new URLSearchParams(location.search).has('readonly')}/>}</main>}window.renderFixture=()=>root.render(<App key={window.stockQa.config.semester}/>);const root=createRoot(document.getElementById('root'));window.renderFixture();`, loader: 'tsx', resolveDir: root }, bundle: true, write: false, format: 'esm', outfile: 'fixture.js', plugins: [{name:'fixture',setup(plugin){plugin.onResolve({filter:/contexts\/AuthContext$|common\/AppToastProvider$|lib\/wisStocksClient$|lib\/semesterScope$/},()=>({path:'service',namespace:'fixture'}));plugin.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:service,loader:'tsx',resolveDir:root}));}}] });
const js = bundle.outputFiles.find(file=>file.path.endsWith('.js')).text, css = bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const html = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#f3f4f6;font-family:Arial,sans-serif}*{box-sizing:border-box}</style><link rel="stylesheet" href="/qa.css"><div id="root"></div><script type="module" src="/qa.js"></script></html>';
const server = http.createServer((req,res)=>{const file={'/qa.js':['text/javascript',js],'/qa.css':['text/css',css]}[new URL(req.url,'http://localhost').pathname]||['text/html',html];res.setHeader('Content-Type',file[0]+';charset=utf-8');res.end(file[1]);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`, browser=await playwright.chromium.launch({channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||'msedge',headless:true});
const errors=[],checks=[];
async function open(width=1280,query='') {const page=await browser.newPage({viewport:{width,height:1000}});page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());await page.goto(origin+query);return page;}
try {
  for(const width of [320,390,768,1280,1440]) {
    const page=await open(width,'?long');await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.stockQa.reads),0);
    await page.getByRole('button',{name:'주식 열기',exact:true}).click();await page.getByRole('button',{name:/조선 후기 상업 발전/}).waitFor();
    assert.equal(await page.evaluate(()=>window.stockQa.reads),1);
    await page.getByRole('button',{name:/조선 후기 상업 발전/}).press('Enter');await page.getByLabel('종목명',{exact:true}).waitFor();
    const layout=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,titleBackground:getComputedStyle(document.querySelector('.wis-stocks__toolbar')).backgroundColor,headers:document.querySelectorAll('.wis-stocks header').length}));
    assert(layout.scroll<=width,JSON.stringify(layout));assert.equal(layout.titleBackground,'rgba(0, 0, 0, 0)');assert.equal(layout.headers,0);
    await page.getByLabel('종목명',{exact:true}).fill('수정한 합성 종목');await page.getByRole('button',{name:'변경 저장',exact:true}).press('Enter');
    await page.getByRole('heading',{name:'수정한 합성 종목',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.stockQa.saves),1);
    assert.equal(await page.evaluate(()=>window.stockQa.reads),1);
    await page.screenshot({path:path.join(evidence,`stocks-${width}.png`),fullPage:true});await page.close();
  }
  checks.push('320/390/768/1280/1440: keyboard edit/save, long Korean labels, no horizontal overflow, transparent toolbar, one read and one explicit save.');
  const hidden=await open(1280,'?hidden');await hidden.getByRole('button',{name:'주식 열기',exact:true}).click();assert.equal(await hidden.evaluate(()=>window.stockQa.reads),0);await hidden.evaluate(()=>{window.stockQa.hidden=false;document.dispatchEvent(new Event('visibilitychange'))});await hidden.getByRole('button',{name:/합성 역사 종목/}).waitFor();assert.equal(await hidden.evaluate(()=>window.stockQa.reads),1);await hidden.waitForTimeout(600);assert.equal(await hidden.evaluate(()=>window.stockQa.reads),1);await hidden.close();checks.push('Hidden document and inactive tab perform zero reads; visible mount reads once without polling.');
  const empty=await open(390,'?empty');await empty.getByRole('button',{name:'주식 열기',exact:true}).click();await empty.getByText('등록된 종목이 없습니다.').waitFor();await empty.getByRole('button',{name:'종목 등록',exact:true}).click();await empty.getByLabel('종목명',{exact:true}).fill('새 합성 종목');assert.equal(await empty.getByLabel('자동 가격 변동',{exact:true}).isChecked(),false);await empty.getByRole('button',{name:'종목 등록',exact:true}).last().click();await empty.getByRole('heading',{name:'새 합성 종목',exact:true}).waitFor();assert.equal(await empty.getByText('학생 비공개',{exact:true}).count(),1);await empty.close();checks.push('Empty market creation stays private and defaults to stopped automatic prices.');
  const failure=await open();await failure.evaluate(()=>window.stockQa.failRead=true);await failure.getByRole('button',{name:'주식 열기',exact:true}).click();await failure.getByRole('alert').waitFor();await failure.evaluate(()=>window.stockQa.failRead=false);await failure.getByRole('button',{name:'새로고침',exact:true}).click();await failure.getByRole('button',{name:/합성 역사 종목/}).click();await failure.getByLabel('종목명',{exact:true}).fill('보존할 수정');await failure.evaluate(()=>window.stockQa.failSave=true);await failure.getByRole('button',{name:'변경 저장',exact:true}).click();await failure.getByRole('alert').waitFor();assert.equal(await failure.getByLabel('종목명',{exact:true}).inputValue(),'보존할 수정');await failure.evaluate(()=>window.stockQa.failSave=false);await failure.getByRole('button',{name:'변경 저장',exact:true}).click();await failure.getByRole('heading',{name:'보존할 수정'}).waitFor();await failure.close();checks.push('Read retry and failed-save retry retain the draft and resolve successfully.');
  for (const times of [[0,3600000,86400000],[0,0],[0]]) {
    const chart=await open(768);
    await chart.evaluate(times=>{window.stockQa.market.stocks[0].history=times.map((offset,index)=>({atMs:1794556800000+offset,price:100+index*10}))},times);
    await chart.getByRole('button',{name:'주식 열기',exact:true}).click();await chart.getByRole('button',{name:/합성 역사 종목/}).click();
    const points=(await chart.locator('.wis-stock-chart__plot polyline').getAttribute('points')).split(' ').map(point=>point.split(',').map(Number));
    assert(points.every(point=>point.every(Number.isFinite)));
    const span=Math.max(...times)-Math.min(...times);
    points.forEach((point,index)=>assert(Math.abs(point[0]-(16+(span?times[index]/span:0)*568))<0.00001));
    if (times.length===1) assert.equal(await chart.locator('.wis-stock-chart__plot circle').count(),1);
    await chart.close();
  }
  checks.push('Irregular observations use elapsed-time x positions; coincident timestamps and a single point have finite coordinates.');
  const reduced=await open(768,'?readonly');await reduced.emulateMedia({reducedMotion:'reduce'});await reduced.getByRole('button',{name:'주식 열기',exact:true}).click();await reduced.getByRole('button',{name:/합성 역사 종목/}).click();assert.equal(await reduced.getByLabel('종목명',{exact:true}).isDisabled(),true);assert.equal(await reduced.getByRole('button',{name:'변경 저장',exact:true}).count(),0);assert.equal(await reduced.evaluate(()=>document.querySelector('.wis-stock-chart__plot').getAttribute('style')),null);await reduced.close();checks.push('Read-only permission disables editing; reduced motion leaves the chart static.');
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(evidence,'summary.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({evidence,checks},null,2));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
