import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const evidence = process.env.WIS_BONUS_ACCOUNT_QA_DIR || path.join(root, 'output/wispi-event-principal-lock-20261117/student-browser');
await fs.mkdir(evidence, { recursive: true });

// Exercise the actual account panel and InfoHelp. Synthetic service responses only;
// no user browser, screenshots, screen capture, credentials or external network.
const fixture = `
export const qa=window.qa={calls:[],historyCalls:0,uid:'synthetic-student',generation:1,status:'ready',error:'',active:true,tradingEnabled:true};
qa.state={semesterId:'2026-2',serverNowMs:Date.now(),mainCash:1000,stocks:[],account:{accountId:'synthetic-account',revision:1,stockCash:1000,reservedCash:0,outstandingPrincipal:500,lastDepositAtMs:0,eventBonusTotal:500,eventBonusRestrictionVersion:1,eventBonusRestrictedCash:500,eventBonusReservedCash:0,eventBonusLossCarryforward:0,eventBonusLegacyWithdrawn:0,positions:[],pendingOrders:[],recentOrders:[]},funding:{maximumDeposit:500,maximumWithdrawal:500,nextDepositAtMs:0}};
export const useAuth=()=>({currentUser:{uid:qa.uid},config:{year:'2026',semester:'2'},authGeneration:qa.generation});
export const getYearSemester=config=>config;
export const useStudentWisStockAccount=()=>({status:qa.status,data:qa.status==='ready'?qa.state:null,error:qa.error,retry:()=>{qa.calls.push({kind:'refresh'});qa.status='ready';qa.render()}});
export const getStudentWisStockHistory=async()=>{qa.historyCalls++;return {semesterId:'2026-2',entries:[],nextCursor:'',hasMore:false}};
export const studentWisStockNow=state=>state.serverNowMs;
export const studentWisStockError=error=>error.message;
export const transferStudentWisStock=async(scope,direction,amount)=>{
 qa.calls.push({kind:'transfer',direction,amount});
 if(qa.failTransfer){qa.failTransfer=false;throw Error('합성 출금 오류. 잔액을 새로고침해 주세요.')}
 if(qa.holdTransfer)await new Promise(resolve=>{qa.releaseTransfer=resolve});
 const receipt={principalReturned:Math.min(amount,qa.state.account.outstandingPrincipal),withdrawnProfit:Math.max(0,amount-qa.state.account.outstandingPrincipal)};
 if(direction==='WITHDRAW'){qa.state.account.stockCash-=amount;qa.state.mainCash+=amount;qa.state.account.outstandingPrincipal-=receipt.principalReturned;qa.state.funding.maximumWithdrawal-=amount;}
 qa.state.account.revision++;qa.render();return {changed:true,duplicate:false,state:qa.state,receipt};
};
`;
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{qa}from'qa-fixture';import Account from ${JSON.stringify(path.join(root, 'src/pages/student/components/wispi/StudentWisStockAccountPanel.tsx'))};const root=createRoot(document.getElementById('root'));qa.render=()=>root.render(<main><Account active={qa.active} tradingEnabled={qa.tradingEnabled}/></main>);qa.render();`;
const built = await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: root }, bundle: true, format: 'esm', write: false, outfile: path.join(evidence, 'qa.js'), plugins: [{ name: 'account-fixture', setup(p) {
  p.onResolve({ filter: /^(qa-fixture|.*\/(AuthContext|useStudentWisStocks|semesterScope|studentWisStockClient))$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
  p.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'js' }));
} }] });
const js = built.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = built.outputFiles.find(file => file.path.endsWith('.css')).text;
const html = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><style>*{box-sizing:border-box}body{margin:0;background:#f3f4f6;font:16px Arial,sans-serif}main{padding:16px;max-width:1152px;margin:auto}input{min-height:44px;max-width:100%}</style><div id="root"></div><script type="module" src="/qa.js"></script></html>';
const server = http.createServer((req, res) => {
  const asset = { '/qa.js': ['text/javascript', js], '/qa.css': ['text/css', css] }[new URL(req.url, 'http://localhost').pathname] || ['text/html', html];
  res.setHeader('Content-Type', asset[0] + ';charset=utf-8');res.end(asset[1]);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'msedge', headless: true });
const checks = [], errors = [];
const balance = (page, label) => page.locator('.student-wispi-balances > div').filter({ has: page.locator('dt', { hasText: label }) }).locator('dd');
async function open(width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin);await page.getByLabel('위스 금액', { exact: true }).waitFor();return page;
}
const patch = (page, values) => page.evaluate(values => { Object.assign(window.qa.state.account, values.account);Object.assign(window.qa.state.funding, values.funding);window.qa.state.account.revision++;window.qa.render(); }, values);
try {
  for (const width of [320, 390, 768, 1280, 1440]) {
    const page = await open(width);
    assert.match(await balance(page, '매수 가능').innerText(), /1,000/);
    assert.match(await balance(page, '출금 가능').innerText(), /500/);
    await page.getByRole('button', { name: '출금', exact: true }).click();
    await page.getByLabel('위스 금액', { exact: true }).fill('501');
    assert.equal(await page.getByRole('button', { name: '일반 위스로 출금', exact: true }).isDisabled(), true);
    assert.match(await page.locator('#wispi-transfer-limit').innerText(), /출금 가능 500 위스 · 이벤트 지원금 원금 제외/);
    assert.equal(await page.evaluate(() => window.qa.calls.length), 0);
    const help = page.getByRole('button', { name: '주식 지갑 입출금 기준', exact: true });
    await help.focus();await page.getByRole('tooltip').waitFor();
    assert.match(await page.getByRole('tooltip').innerText(), /지원금으로 얻은 수익은 손실을 만회한 뒤 출금할 수 있습니다/);
    await page.keyboard.press('Escape');await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    await patch(page, { account: { reservedCash: 300, eventBonusReservedCash: 300 }, funding: { maximumWithdrawal: 500 } });
    await page.getByText('매수 예약 300 위스', { exact: true }).waitFor();
    assert.match(await balance(page, '매수 가능').innerText(), /700/);
    assert.match(await balance(page, '출금 가능').innerText(), /500/);
    const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, columns: getComputedStyle(document.querySelector('.student-wispi-balances')).gridTemplateColumns.split(' ').length, background: getComputedStyle(document.querySelector('.student-wispi-balances')).backgroundColor, shadow: getComputedStyle(document.querySelector('.student-wispi-balances')).boxShadow, submitHeight: document.querySelector('button[type=submit]').getBoundingClientRect().height }));
    assert(layout.scroll <= width, JSON.stringify(layout));assert.equal(layout.columns, width < 768 ? 2 : 4);assert.equal(layout.background, 'rgba(0, 0, 0, 0)');assert.equal(layout.shadow, 'none');assert(layout.submitHeight >= 44);
    await page.close();checks.push(`${width}px: buy and withdrawal amounts differ; event principal over-limit blocked without command, reserved cash readable, keyboard help and responsive transparent summary pass.`);
  }
  const profit = await open();
  await patch(profit, { account: { stockCash: 600, outstandingPrincipal: 0 }, funding: { maximumWithdrawal: 100 } });
  await profit.getByRole('button', { name: '출금', exact: true }).click();
  await profit.getByLabel('위스 금액', { exact: true }).fill('100');await profit.getByRole('button', { name: '일반 위스로 출금', exact: true }).click();
  await profit.getByText('100 위스를 출금했습니다. 누적 위스에 수익 100 위스가 반영되었습니다.', { exact: true }).waitFor();
  assert.match(await balance(profit, '출금 가능').innerText(), /^0 위스$/);assert.match(await balance(profit, '매수 가능').innerText(), /500/);
  assert.deepEqual(await profit.evaluate(() => window.qa.calls), [{ kind: 'transfer', direction: 'WITHDRAW', amount: 100 }]);
  await profit.close();checks.push('Server-confirmed profit 100 can be withdrawn once, leaves 500 available to buy and 0 to withdraw, and displays the server receipt profit.');
  const owned = await open();
  await patch(owned, { account: { stockCash: 500, eventBonusRestrictedCash: 0 }, funding: { maximumWithdrawal: 500 } });
  await owned.getByRole('button', { name: '출금', exact: true }).click();await owned.getByLabel('위스 금액', { exact: true }).fill('500');
  assert.equal(await owned.getByRole('button', { name: '일반 위스로 출금', exact: true }).isDisabled(), false);
  await patch(owned, { account: { stockCash: 400, eventBonusRestrictedCash: 400, eventBonusLossCarryforward: 100 }, funding: { maximumWithdrawal: 0 } });
  await owned.waitForFunction(() => document.querySelector('button[type=submit]').disabled);
  assert.match(await balance(owned, '매수 가능').innerText(), /400/);assert.match(await balance(owned, '출금 가능').innerText(), /^0 위스$/);
  await owned.close();checks.push('Own cash remains withdrawable while grant is invested; loss scenario uses the server zero limit instead of a client fixed 500 calculation.');
  const recovery = await open();
  await recovery.getByRole('button', { name: '출금', exact: true }).click();await recovery.getByLabel('위스 금액', { exact: true }).fill('500');
  await recovery.evaluate(() => { window.qa.failTransfer = true; });await recovery.getByRole('button', { name: '일반 위스로 출금', exact: true }).click();
  await recovery.getByRole('alert').waitFor();assert.equal(await recovery.getByLabel('위스 금액', { exact: true }).inputValue(), '500');
  await recovery.getByRole('button', { name: '일반 위스로 출금', exact: true }).click();await recovery.getByText('500 위스를 출금했습니다.', { exact: true }).waitFor();
  assert.equal(await recovery.evaluate(() => window.qa.calls.filter(item => item.kind === 'transfer').length), 2);
  await recovery.evaluate(() => { window.qa.status='error';window.qa.error='합성 계좌 조회 실패';window.qa.render(); });await recovery.getByRole('alert').waitFor();assert.equal(await recovery.locator('.student-wispi-balances').count(), 0);
  await recovery.getByRole('button', { name: '다시 불러오기', exact: true }).click();await balance(recovery, '출금 가능').waitFor();
  await recovery.evaluate(() => { window.qa.active=false;window.qa.render(); });await recovery.locator('.student-wispi-account').waitFor({ state: 'detached' });
  await recovery.close();checks.push('Failed transfer preserves input for retry; account errors clear balances; refresh recovers; inactive account panel is removed.');
  assert.deepEqual(errors, []);
  const result = { passed: true, checks, errors, screenshots: 0, externalNetwork: 0, productionWrites: 0 };
  await fs.writeFile(path.join(evidence, 'summary.json'), JSON.stringify(result, null, 2));console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();await new Promise(resolve => server.close(resolve));
}
