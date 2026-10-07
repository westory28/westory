/** Actual title editor; only Auth, Firestore and settings-cache boundaries are mocked. */
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
const evidence = process.env.WEPLAY_QA_EVIDENCE_DIR
  ? path.resolve(process.env.WEPLAY_QA_EVIDENCE_DIR)
  : path.join(root, '.superloopy/sessions/weplay-title-20261007/evidence');
await fs.mkdir(evidence, { recursive: true });
const modulePath = relative => JSON.stringify(path.join(root, relative).replaceAll('\\', '/'));
const service = `
const params=new URLSearchParams(location.search);
export const auth={currentUser:{uid:'title-qa',email:params.has('teacher')?'teacher@example.invalid':'westoria28@gmail.com'}};
export const useAuth=()=>({currentUser:auth.currentUser,refreshInterfaceConfig:async()=>{}});
export const db={};
export const getHttpsCallable=async()=>{throw new Error('Unexpected callable');};
export const qa=window.titleQa={calls:[],writes:[],invalidations:[],toasts:[],failNext:0,hold:false,document:null};
export const useAppToast=()=>({showToast:toast=>{qa.toasts.push(toast);qa.renderToast?.(toast);}});
export const invalidateSiteSettingDocCache=name=>qa.invalidations.push(name);
export const doc=(_db,...segments)=>({path:segments.join('/')});
export const getDoc=async reference=>reference.path.endsWith('/menu_config')?{exists:()=>true,data:()=>structuredClone(qa.document)}:{exists:()=>false,data:()=>undefined};
export const setDoc=async()=>{throw new Error('Unexpected non-transactional write');};
export const serverTimestamp=()=>({fixtureServerTimestamp:true});
export const runTransaction=async(_db,callback)=>{
  qa.calls.push('transaction');
  if(qa.hold)await new Promise(resolve=>qa.release=resolve);
  if(qa.failNext){qa.failNext--;const error=new Error('fixture unavailable');error.code='unavailable';throw error;}
  let pending;
  await callback({get:async reference=>{
    qa.calls.push({read:reference.path});
    return {data:()=>structuredClone(qa.document)};
  },set:(reference,data,options)=>{pending={path:reference.path,data:structuredClone(data),options:structuredClone(options)};}});
  if(pending){qa.writes.push(pending);qa.document={...qa.document,...pending.data};}
};
`;
const harness = `
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Editor from ${modulePath('src/pages/teacher/components/WeplayTitleEditor.tsx')};
import SettingsInterface from ${modulePath('src/pages/teacher/components/SettingsInterface.tsx')};
import {cloneDefaultMenus,sanitizeMenuConfig} from ${modulePath('src/constants/menus.ts')};
import {getWeplayGameTitle} from ${modulePath('src/lib/weplayTitle.ts')};
import {subscribeMenuConfigUpdated} from ${modulePath('src/lib/appEvents.ts')};
import ${modulePath('src/pages/teacher/ManageWeplay.css')};
import {qa} from 'fixture:service';
qa.document={...cloneDefaultMenus(),unrelated:'keep-root-metadata'};
qa.document.student[0].name='기존 학습 메뉴';
qa.document.teacher[0].name='기존 교사 메뉴';
const game=qa.document.student.find(item=>item.url==='/student/weplay');
game.children[0].name='역사가 내려와';
game.children[0].hidden=true;
game.children.push({name:'다른 게임',url:'/student/weplay?game=other',hidden:true});
qa.original=structuredClone(sanitizeMenuConfig(qa.document));
function Fixture(){
  const [menus,setMenus]=useState(()=>sanitizeMenuConfig(qa.document));
  const [toast,setToast]=useState(null);qa.renderToast=setToast;
  useEffect(()=>{const unsubscribe=subscribeMenuConfigUpdated(()=>{qa.notifications=(qa.notifications||0)+1;setMenus(sanitizeMenuConfig(qa.document));});qa.ready=true;return unsubscribe;},[]);
  const title=getWeplayGameTitle(menus);
  return <main className='teacher-weplay-content'><div className='teacher-weplay-title'><h1>{title}</h1></div><Editor title={title}/>{new URLSearchParams(location.search).has('sitemap')&&<section aria-label='사이트맵 편집'><SettingsInterface/></section>}{toast&&<p role={toast.tone==='error'?'alert':'status'}>{toast.title} {toast.message}</p>}</main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
const bundle = await build({
  stdin: { contents: harness, loader: 'tsx', resolveDir: root }, bundle: true, write: false,
  format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(os.tmpdir(), 'westory-title-qa.js'),
  loader: { '.svg': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'title-boundary-fixture', setup(plugin) {
    plugin.onResolve({ filter: /^fixture:|^firebase\/firestore$|^\.\/firebase$|(?:^|\/)contexts\/AuthContext$|(?:^|\/)lib\/(firebase|siteSettings)$|(?:^|\/)components\/common\/AppToastProvider$/ }, () => ({ path: 'service', namespace: 'fixture' }));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: service, loader: 'ts', resolveDir: root }));
  } }],
});
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
const html = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><style>body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}main{max-width:1280px;margin:auto;padding:24px;box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>';
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  response.setHeader('Content-Type', pathname === '/qa.js' ? 'text/javascript' : pathname === '/qa.css' ? 'text/css' : 'text/html');
  response.end(pathname === '/qa.js' ? js : pathname === '/qa.css' ? css : html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'msedge', headless: true });
const checks = [], screenshots = [], errors = [], externalRequests = [], layouts = [];
let failure;
async function open(width = 1280, query = '') {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (!route.request().url().startsWith(origin)) {
      externalRequests.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${origin}/?${query}`);
  await page.getByRole('textbox', { name: '게임 이름', exact: true }).waitFor();
  await page.waitForFunction(()=>window.titleQa.ready);
  return page;
}
async function capture(page, name) {
  await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true });
  screenshots.push(`${name}.png`);
}
try {
  const admin = await open();
  const field = admin.getByRole('textbox', { name: '게임 이름', exact: true });
  assert.equal(await field.inputValue(), '내가 충무공이라고?!');
  assert.equal(await field.isDisabled(), false);
  assert.equal(await admin.getByRole('button', { name: '이름 저장', exact: true }).isDisabled(), true);
  await field.fill('   선생님이 정한 해전   ');
  await admin.evaluate(() => { window.titleQa.hold = true; });
  await field.press('Enter');
  await admin.getByRole('button', { name: '저장 중…', exact: true }).waitFor();
  assert.equal(await field.isDisabled(), true);
  await admin.evaluate(() => document.querySelector('form').requestSubmit());
  assert.equal(await admin.evaluate(() => window.titleQa.calls.filter(call => call === 'transaction').length), 1);
  await capture(admin, 'admin-saving-1280');
  await admin.evaluate(() => { window.titleQa.hold = false; window.titleQa.release(); });
  await admin.getByRole('status').waitFor();
  await admin.getByRole('heading', { name: '선생님이 정한 해전', exact: true }).waitFor();
  const saved = await admin.evaluate(() => ({writes:window.titleQa.writes,document:window.titleQa.document,original:window.titleQa.original,invalidations:window.titleQa.invalidations,notifications:window.titleQa.notifications}));
  assert.equal(saved.writes.length, 1);
  assert.equal(saved.writes[0].path, 'site_settings/menu_config');
  assert.deepEqual(saved.writes[0].options, {merge:true});
  assert.deepEqual(Object.keys(saved.writes[0].data).sort(), ['student','updatedAt']);
  const updatedGame = saved.document.student.find(item => item.url === '/student/weplay');
  const originalGame = saved.original.student.find(item => item.url === '/student/weplay');
  assert.deepEqual(updatedGame.children[0], {...originalGame.children[0],name:'선생님이 정한 해전',gameTitleCustomized:true});
  assert.deepEqual(updatedGame.children.slice(1), originalGame.children.slice(1));
  assert.deepEqual(saved.document.student.filter(item => item.url !== '/student/weplay'), saved.original.student.filter(item => item.url !== '/student/weplay'));
  assert.equal(saved.document.teacher[0].name, '기존 교사 메뉴');
  assert.equal(saved.document.unrelated, 'keep-root-metadata');
  assert.deepEqual(saved.invalidations, ['menu_config']);
  assert.equal(saved.notifications, 1);
  assert.equal(await field.inputValue(), '선생님이 정한 해전');
  await capture(admin, 'admin-saved-1280');
  checks.push('Administrator keyboard save trims the title, uses the existing menu transaction with merge=true, preserves other student/teacher menus and metadata, and refreshes the displayed title; saving disables input and duplicate submits.');

  await field.fill('실패해도 입력한 이름 유지');
  await admin.evaluate(() => { window.titleQa.failNext = 1; });
  await admin.getByRole('button', { name: '이름 저장', exact: true }).click();
  await admin.getByRole('alert').waitFor();
  assert.equal(await field.inputValue(), '실패해도 입력한 이름 유지');
  assert.equal(await field.getAttribute('aria-invalid'), 'true');
  assert.equal(await admin.evaluate(() => window.titleQa.writes.length), 1);
  assert.equal(await admin.getByRole('button', { name: '이름 저장', exact: true }).isEnabled(), true);
  await capture(admin, 'admin-save-failure-draft-1280');
  await admin.getByRole('button', { name: '이름 저장', exact: true }).click();
  await admin.getByRole('heading', { name: '실패해도 입력한 이름 유지', exact: true }).waitFor();
  assert.equal(await admin.evaluate(() => window.titleQa.writes.length), 2);
  checks.push('A failed Firestore save retains the draft, exposes an associated error, commits nothing, and succeeds on retry.');

  await field.fill('덮어쓰면 안 되는 이름');
  await admin.evaluate(() => { const child=window.titleQa.document.student.find(item=>item.url==='/student/weplay').children[0];child.name='다른 화면에서 바꾼 이름';child.gameTitleCustomized=true; });
  await admin.getByRole('button', { name: '이름 저장', exact: true }).click();
  await admin.getByRole('alert').waitFor();
  assert.match(await admin.getByRole('alert').textContent(), /다른 곳에서 게임 이름이 바뀌었습니다/);
  assert.equal(await field.inputValue(), '덮어쓰면 안 되는 이름');
  assert.equal(await admin.evaluate(() => window.titleQa.writes.length), 2);
  checks.push('A concurrent title change rejects the stale edit and preserves both the newer saved title and the local draft.');
  await admin.close();

  const concurrent = await open(1280, 'sitemap=1');
  const sitemap = concurrent.getByRole('region', {name:'사이트맵 편집'});
  await sitemap.getByRole('button', {name:'사이트맵 메뉴',exact:true}).click();
  const parentIndex = await sitemap.locator('input').evaluateAll(elements=>elements.findIndex(element=>element.value==='기존 학습 메뉴'));
  assert.ok(parentIndex >= 0);
  const parentDraft = sitemap.locator('input').nth(parentIndex);
  await parentDraft.fill('사이트맵의 저장 전 수정');
  await concurrent.getByRole('textbox', {name:'게임 이름',exact:true}).fill('게임 관리에서 먼저 저장');
  await concurrent.getByRole('button', {name:'이름 저장',exact:true}).click();
  await concurrent.getByRole('heading', {name:'게임 관리에서 먼저 저장',exact:true}).waitFor();
  await sitemap.getByRole('button', {name:'사이트맵 저장',exact:true}).click();
  await concurrent.getByRole('alert').waitFor();
  assert.match(await concurrent.getByRole('alert').textContent(), /다른 곳에서 메뉴 설정이 바뀌었습니다/);
  assert.equal(await parentDraft.inputValue(), '사이트맵의 저장 전 수정');
  assert.equal(await concurrent.evaluate(()=>window.titleQa.writes.length), 1);
  assert.equal(await concurrent.evaluate(()=>window.titleQa.document.student.find(item=>item.url==='/student/weplay').children[0].name), '게임 관리에서 먼저 저장');
  assert.equal(await concurrent.evaluate(()=>window.titleQa.document.student[0].name), '기존 학습 메뉴');
  await capture(concurrent,'stale-sitemap-save-rejected-1280');
  await concurrent.close();
  checks.push('Actual SettingsInterface loaded before a title-editor save rejects its stale full-menu save, preserves its unsaved draft, and cannot overwrite the newer game title.');

  const fresh = await open(1280, 'sitemap=1');
  const freshSitemap = fresh.getByRole('region', {name:'사이트맵 편집'});
  await freshSitemap.getByRole('button', {name:'사이트맵 메뉴',exact:true}).click();
  const freshParentIndex = await freshSitemap.locator('input').evaluateAll(elements=>elements.findIndex(element=>element.value==='기존 학습 메뉴'));
  for(const name of ['사이트맵 첫 저장','사이트맵 두 번째 저장']) {
    await freshSitemap.locator('input').nth(freshParentIndex).fill(name);
    await freshSitemap.getByRole('button', {name:'사이트맵 저장',exact:true}).click();
    await fresh.waitForFunction(value=>window.titleQa.document.student[0].name===value,name);
  }
  assert.equal(await fresh.evaluate(()=>window.titleQa.writes.length), 2);
  assert.equal(await fresh.evaluate(()=>window.titleQa.toasts.every(toast=>toast.tone==='success')),true);
  await fresh.close();
  checks.push('Actual SettingsInterface still permits sequential valid saves after refreshing its comparison baseline.');

  const teacher = await open(390, 'teacher=1');
  assert.equal(await teacher.getByRole('textbox', { name: '게임 이름', exact: true }).isDisabled(), true);
  assert.equal(await teacher.getByRole('button', { name: '이름 저장', exact: true }).count(), 0);
  assert.match(await teacher.locator('#weplay-game-title-permission').textContent(), /메뉴 설정 권한이 있는 관리자 교사/);
  await teacher.evaluate(() => { document.querySelector('form').requestSubmit(); });
  assert.equal(await teacher.evaluate(() => window.titleQa.calls.length), 0);
  await capture(teacher, 'teacher-readonly-390');
  await teacher.close();
  checks.push('A teacher without menu-settings permission sees a disabled field and the permission explanation; a programmatic submit also performs no transaction.');

  for (const width of [390,768,1280]) {
    const page = await open(width);
    const input = page.getByRole('textbox', { name: '게임 이름', exact: true });
    await input.fill('학생과 함께 바다를 지키는 역사 수업의 아주 긴 해전 게임 이름');
    await input.press('Enter');
    await page.getByRole('status').waitFor();
    await page.getByRole('heading', {name:'학생과 함께 바다를 지키는 역사 수업의 아주 긴 해전 게임 이름',exact:true}).waitFor();
    const geometry = await page.evaluate(() => ({ width:innerWidth,scrollWidth:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('input,button')].map(element=>{const r=element.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right};}) }));
    assert.ok(geometry.scrollWidth <= width, JSON.stringify(geometry));
    assert.ok(geometry.controls.every(control=>control.width>=44&&control.height>=44&&control.left>=0&&control.right<=width), JSON.stringify(geometry));
    layouts.push(geometry);
    await capture(page, `long-title-${width}`);
    await page.close();
  }
  checks.push('390px, 768px and 1280px actual editor layouts keep long titles inside the viewport and all input/button controls at least 44px.');
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
} catch (error) { failure=error.stack;process.exitCode=1; }
finally {
  if(failure){const page=browser.contexts().flatMap(context=>context.pages()).at(-1);if(page)await capture(page,'failure-current');}
  await fs.writeFile(path.join(evidence,'title-browser-results.json'),JSON.stringify({status:failure?'failed':'passed',failure,checks,screenshots,layouts,errors,externalRequests},null,2));
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
if(failure)throw new Error(failure);
console.log(JSON.stringify({status:'passed',checks,screenshots,evidence},null,2));
