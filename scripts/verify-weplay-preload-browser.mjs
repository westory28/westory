/** Real preload helpers and Sidebar; only the imported page and public network are fixtures. */
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
const evidence = path.resolve(process.env.WEPLAY_PRELOAD_QA_EVIDENCE_DIR || path.join(root, '.superloopy/sessions/weplay-preload-20261007/evidence'));
await fs.mkdir(evidence, { recursive: true });
const source = relative => JSON.stringify(path.join(root, relative).replaceAll('\\', '/'));
const harness = `
import React,{Suspense,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {HashRouter,Routes,Route,useLocation} from 'react-router-dom';
import Sidebar from ${source('src/components/layout/TeacherSidebar.tsx')};
import {loadStudentWeplay,preloadStudentWeplay} from ${source('src/lib/weplayPreload.ts')};
import {preloadWeplayAssets} from ${source('src/lib/weplayAssets.ts')};
import {lazyWithRetry} from ${source('src/lib/lazyWithRetry.ts')};
window.preloadQa={moduleLoads:0,mounts:0,rpcCalls:[],privateReads:[],images:[],loadStudentWeplay,preloadStudentWeplay,preloadWeplayAssets};
const StudentPage=lazyWithRetry(loadStudentWeplay,'student-weplay');
const NativeImage=window.Image;
window.Image=function(...args){const image=new NativeImage(...args);window.preloadQa.images.push(image);return image;};
window.Image.prototype=NativeImage.prototype;
function Fixture(){
  const [clicks,setClicks]=useState(0);
  const location=useLocation();
  const portal=new URLSearchParams(window.location.search).get('portal')==='teacher'?'teacher':'student';
  return <><Sidebar portal={portal} groups={[
    {id:'lesson',name:'학습',icon:'lesson',children:[{name:'수업',resolvedUrl:'/'+portal+'/lesson'}]},
    {id:'weplay',name:'위플레이',icon:'game',children:[{name:'내가 충무공이라고?!',resolvedUrl:'/'+portal+'/weplay'}]}
  ]} home={'/'+portal} semesterLabel='2026학년도 2학기' showDashboard={false} showSettings={false} collapsed={false} mobileOpen={false} onToggleCollapsed={()=>{}} onCloseMobile={()=>{}} isChildActive={()=>false}/>
  <main><button onClick={()=>setClicks(value=>value+1)}>응답 확인</button><output data-clicks={clicks} data-route={location.pathname}>{clicks}</output>
  <Routes><Route path='/student/weplay' element={<Suspense fallback={<p>게임 로딩 중</p>}><StudentPage/></Suspense>}/><Route path='*' element={null}/></Routes></main></>;
}
if(!window.location.hash)window.location.hash='/student';
createRoot(document.getElementById('root')).render(<HashRouter><Fixture/></HashRouter>);`;
const bundle = await build({
  stdin: { contents: harness, loader: 'tsx', resolveDir: root, sourcefile: 'qa.tsx' },
  bundle: true, write: false, splitting: true, format: 'esm', platform: 'browser', target: 'es2022',
  outdir: path.join(evidence, 'bundle'), entryNames: 'qa', chunkNames: '[name]-[hash]',
  define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env': '{"BASE_URL":"/"}', 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'preload-page-boundary', setup(plugin) {
    plugin.onResolve({ filter: /pages\/student\/Weplay$/ }, args => {
      if (args.importer.endsWith('weplayPreload.ts')) return { path: 'student-page-boundary', namespace: 'fixture' };
    });
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
      contents: `window.preloadQa.moduleLoads++; export default function StudentPage(){window.preloadQa.mounts++;window.preloadQa.rpcCalls.push('getWeplayLobby');return null;}`,
      loader: 'js',
    }));
  } }],
});
const files = new Map(bundle.outputFiles.map(file => ['/' + path.basename(file.path), file.text]));
const pageChunk = [...files.keys()].find(name => name.startsWith('/student-page-boundary-'));
assert.ok(pageChunk, 'The fixture must preserve a real network-loaded dynamic import.');
const html = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:16px sans-serif}button,a{display:block;min-height:44px;padding:8px}svg{width:20px;height:20px}.teacher-sidebar-close,.teacher-sidebar-compact-label{display:none}main{margin-top:24px}</style><div id="root"></div><script type="module" src="/qa.js"></script></html>';
const server = http.createServer((request, response) => {
  const name = new URL(request.url, 'http://127.0.0.1').pathname;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', files.has(name) ? 'text/javascript' : 'text/html; charset=utf-8');
  response.end(files.get(name) || html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'msedge', headless: true });
const checks = [];
const errors = [];
const privateRequests = [];
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6q8AAAAASUVORK5CYII=', 'base64');
const imageFiles = ['sea-battle.webp', 'allied-ship.webp', 'enemy-ship.webp', 'reference-sprites.webp'];

async function fixture({ portal = 'student', touch = false, failChunk = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, hasTouch: touch });
  const page = await context.newPage();
  const state = { chunkRequests: 0, assetRequests: [], heldImages: [], holdImages: false, failImage: null };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { privateRequests.push(url.href); return route.abort(); }
    if (url.pathname === pageChunk) {
      state.chunkRequests++;
      if (failChunk && state.chunkRequests === 1) return route.fulfill({ status: 503, body: 'Temporary code outage', headers: { 'Cache-Control': 'no-store' } });
    }
    if (url.pathname.startsWith('/assets/')) {
      state.assetRequests.push(url.pathname);
      if (state.holdImages) { state.heldImages.push(route); return; }
      if (state.failImage === path.basename(url.pathname)) { state.failImage = null; return route.fulfill({ status: 404, body: 'Temporary image outage' }); }
      return route.fulfill({ contentType: 'image/png', body: pixel });
    }
    if (!files.has(url.pathname) && url.pathname !== '/') { privateRequests.push(url.href); return route.abort(); }
    return route.continue();
  });
  await page.goto(`${origin}/?portal=${portal}`);
  await page.getByRole('button', { name: '위플레이', exact: true }).waitFor();
  return { context, page, state };
}

async function assertCodeOnly(page, state, expectedLoads = 1) {
  await page.waitForFunction(count => window.preloadQa.moduleLoads === count, expectedLoads);
  const data = await page.evaluate(() => ({
    loads: window.preloadQa.moduleLoads, mounts: window.preloadQa.mounts,
    rpcCalls: window.preloadQa.rpcCalls, privateReads: window.preloadQa.privateReads,
    images: window.preloadQa.images.length, route: document.querySelector('output').dataset.route,
  }));
  assert.deepEqual(data, { loads: expectedLoads, mounts: 0, rpcCalls: [], privateReads: [], images: 0, route: '/student' });
  assert.equal(state.assetRequests.length, 0);
}

try {
  for (const interaction of ['pointer', 'keyboard', 'touch']) {
    const { context, page, state } = await fixture({ touch: interaction === 'touch' });
    assert.equal(state.chunkRequests, 0, 'Rendering the navigation must not eagerly load the game page.');
    const target = page.getByRole('button', { name: '위플레이', exact: true });
    if (interaction === 'pointer') await target.hover();
    if (interaction === 'keyboard') {
      for (let tries = 0; tries < 12 && !(await target.evaluate(element => element === document.activeElement)); tries++) await page.keyboard.press('Tab');
      assert.equal(await target.evaluate(element => element === document.activeElement), true);
    }
    if (interaction === 'touch') await target.tap();
    await assertCodeOnly(page, state);
    await target.dispatchEvent('pointerdown', { pointerType: 'touch' });
    await target.focus();
    assert.equal(await page.evaluate(() => {
      const first = window.preloadQa.loadStudentWeplay();
      return first === window.preloadQa.loadStudentWeplay();
    }), true, 'The later route load must reuse the intent preload promise.');
    assert.equal(state.chunkRequests, 1);
    checks.push({ name: `${interaction} student intent loads code once, without mounting, RPC, private reads, assets or navigation`, passed: true });
    await context.close();
  }

  const teacher = await fixture({ portal: 'teacher', touch: true });
  const teacherTarget = teacher.page.getByRole('button', { name: '위플레이', exact: true });
  await teacherTarget.hover();
  await teacherTarget.focus();
  await teacherTarget.tap();
  await assertCodeOnly(teacher.page, teacher.state, 0);
  assert.equal(teacher.state.chunkRequests, 0);
  checks.push({ name: 'teacher menu intent never preloads the student page', passed: true });
  await teacher.context.close();

  const failed = await fixture({ failChunk: true });
  assert.match(await failed.page.evaluate(async () => {
    try { await window.preloadQa.loadStudentWeplay(); return 'unexpected success'; }
    catch (error) { return error.message; }
  }), /Failed to fetch dynamically imported module|Importing a module script failed/);
  assert.equal(failed.state.chunkRequests, 1);
  await failed.page.getByRole('button', { name: '위플레이', exact: true }).hover();
  await failed.page.getByRole('button', { name: '위플레이', exact: true }).click();
  await failed.page.getByRole('link', { name: '내가 충무공이라고?!', exact: true }).click();
  await failed.page.waitForFunction(() => window.preloadQa?.moduleLoads === 1 && window.preloadQa.mounts === 1);
  assert.equal(await failed.page.evaluate(() => window.sessionStorage.getItem('westory-lazy-retry:student-weplay')), null);
  assert.equal(await failed.page.locator('output').getAttribute('data-route'), '/student/weplay');
  assert.deepEqual(await failed.page.evaluate(() => window.preloadQa.rpcCalls), ['getWeplayLobby']);
  assert.equal(failed.state.chunkRequests, 2);
  checks.push({ name: 'native import failure stays quiet on intent; actual lazyWithRetry route reloads once and recovers the game', passed: true });
  await failed.context.close();

  const assets = await fixture();
  assets.state.holdImages = true;
  const immediate = await assets.page.evaluate(() => {
    const result = window.preloadQa.preloadWeplayAssets();
    window.preloadQa.preloadWeplayAssets();
    return { returnedImmediately: result === undefined, allocated: window.preloadQa.images.length, decoding: window.preloadQa.images.map(image => image.decoding) };
  });
  assert.deepEqual(immediate, { returnedImmediately: true, allocated: 4, decoding: ['async', 'async', 'async', 'async'] });
  await assets.page.waitForFunction(() => window.preloadQa.images.length === 4);
  await assets.page.getByRole('button', { name: '응답 확인', exact: true }).click();
  assert.equal(await assets.page.locator('output').getAttribute('data-clicks'), '1', 'A pending image download must not block UI interaction.');
  assert.deepEqual(assets.state.assetRequests.map(name => path.basename(name)).sort(), imageFiles.toSorted());
  assets.state.holdImages = false;
  await Promise.all(assets.state.heldImages.map(route => route.fulfill({ contentType: 'image/png', body: pixel })));
  await assets.page.waitForFunction(() => window.preloadQa.images.every(image => image.complete && image.naturalWidth > 0));
  assets.state.failImage = 'explosion.webp';
  await assets.page.evaluate(() => window.preloadQa.preloadWeplayAssets(true));
  await assets.page.waitForFunction(() => window.preloadQa.images.length === 7 && window.preloadQa.images.every(image => image.complete));
  await assets.page.evaluate(() => window.preloadQa.preloadWeplayAssets(true));
  await assets.page.waitForFunction(() => window.preloadQa.images.length === 8 && window.preloadQa.images.at(-1).naturalWidth > 0);
  await assets.page.evaluate(() => { window.preloadQa.preloadWeplayAssets(); window.preloadQa.preloadWeplayAssets(true); });
  assert.equal(await assets.page.evaluate(() => window.preloadQa.images.length), 8);
  const counts = Object.fromEntries([...new Set(assets.state.assetRequests)].map(name => [path.basename(name), assets.state.assetRequests.filter(value => value === name).length]));
  assert.deepEqual(counts, Object.fromEntries([...imageFiles, 'explosion.webp', 'yi-sunsin-cutin.webp', 'impact-lines.webp'].map(name => [name, name === 'explosion.webp' ? 2 : 1])));
  checks.push({ name: 'four lobby images and three effects warm once without blocking; only the failed image retries', passed: true, counts });
  await assets.context.close();

  assert.deepEqual(errors, []);
  assert.deepEqual(privateRequests, []);
  const report = { checks, errors, privateRequests, boundary: 'Real Sidebar/preload/asset helpers; the deferred page module is an import boundary fixture, public image responses are controlled. No Firebase request is made.' };
  await fs.writeFile(path.join(evidence, 'preload-browser-qa.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ evidence, ...report }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
