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
export const qa=window.qa={calls:[],historyCalls:0,bonusCalls:0,claimCalls:0,toasts:[],uid:'synthetic-student',generation:1,status:'ready',error:'',active:true,tradingEnabled:true,semester:'2'};
export const useAppToast=()=>({showToast:toast=>qa.toasts.push(toast)});
qa.bonus={campaignId:'wispi-deposit-500-v1',threshold:500,amount:500,status:'CLAIMED',qualifyingDepositAmount:500};
qa.state={semesterId:'2026-2',serverNowMs:Date.now(),mainCash:1000,stocks:[],account:{accountId:'synthetic-account',revision:1,stockCash:1000,reservedCash:0,outstandingPrincipal:500,lastDepositAtMs:0,eventBonusTotal:500,eventBonusRestrictionVersion:1,eventBonusRestrictedCash:500,eventBonusReservedCash:0,eventBonusLossCarryforward:0,eventBonusLegacyWithdrawn:0,positions:[],pendingOrders:[],recentOrders:[]},funding:{maximumDeposit:500,maximumWithdrawal:500,nextDepositAtMs:0}};
export const useAuth=()=>({currentUser:{uid:qa.uid},config:{year:'2026',semester:qa.semester},authGeneration:qa.generation});
export const getYearSemester=config=>config;
export const useStudentWisStockAccount=()=>({status:qa.status,data:qa.status==='ready'?qa.state:null,error:qa.error,retry:()=>{qa.calls.push({kind:'refresh'});qa.status='ready';qa.render()}});
export const useStudentWisStockMarket=enabled=>{if(enabled)throw Error('Funding controls opened a price subscription');return {status:'idle',data:null,error:'',retry(){}}};
export const placeStudentWisStockOrder=async()=>{throw Error('Funding controls submitted an order')};
export const cancelStudentWisStockOrder=async()=>{throw Error('Funding controls cancelled an order')};
export const getStudentWisStockHistory=async()=>{qa.historyCalls++;return {semesterId:'2026-2',entries:[],nextCursor:'',hasMore:false}};
export const getStudentWisStockReturns=async()=>{throw Error('Funding controls must not request the wallet chart')};
export const getStudentWisStockBonus=async()=>{
 qa.bonusCalls++;const result=structuredClone(qa.bonus);
 if(qa.holdBonus){qa.holdBonus=false;await new Promise(resolve=>qa.releaseBonus=resolve)}
 if(qa.failBonus){qa.failBonus=false;throw Error('합성 지원금 조회 오류')}
 return result;
};
export const claimStudentWisStockBonus=async()=>{
 qa.claimCalls++;
 if(qa.holdClaim){qa.holdClaim=false;await new Promise(resolve=>qa.releaseClaim=resolve)}
 if(qa.failClaim){qa.failClaim=false;throw Error('합성 지원금 받기 오류')}
 qa.bonus.status='CLAIMED';qa.state.account.stockCash+=500;qa.state.account.eventBonusRestrictedCash+=500;
 qa.state.account.revision++;qa.render();return {changed:true,duplicate:false,state:qa.state,depositBonus:structuredClone(qa.bonus)};
};
export const studentWisStockNow=state=>state.serverNowMs;
export const studentWisStockError=error=>error.message;
export const transferStudentWisStock=async(scope,direction,amount)=>{
 qa.calls.push({kind:'transfer',direction,amount});
 if(qa.failTransfer){qa.failTransfer=false;throw Error('합성 출금 오류. 잔액을 새로고침해 주세요.')}
 if(qa.holdTransfer)await new Promise(resolve=>{qa.releaseTransfer=resolve});
 const receipt={principalReturned:Math.min(amount,qa.state.account.outstandingPrincipal),withdrawnProfit:Math.max(0,amount-qa.state.account.outstandingPrincipal)};
 if(direction==='WITHDRAW'){qa.state.account.stockCash-=amount;qa.state.mainCash+=amount;qa.state.account.outstandingPrincipal-=receipt.principalReturned;qa.state.funding.maximumWithdrawal-=amount;}
 if(direction==='DEPOSIT'){qa.state.account.stockCash+=amount;qa.state.mainCash-=amount;qa.state.account.outstandingPrincipal+=amount;qa.bonus.qualifyingDepositAmount=Math.min(500,qa.bonus.qualifyingDepositAmount+amount);if(qa.bonus.status!=='CLAIMED')qa.bonus.status=qa.bonus.qualifyingDepositAmount>=500?'ELIGIBLE':'INELIGIBLE'}
 qa.state.account.revision++;qa.render();return {changed:true,duplicate:false,state:qa.state,receipt};
};
`;
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{qa}from'qa-fixture';import Account from ${JSON.stringify(path.join(root, 'src/pages/student/components/wispi/StudentWisStockAccountPanel.tsx'))};const root=createRoot(document.getElementById('root'));qa.render=()=>root.render(<main><Account active={qa.active} tradingEnabled={qa.tradingEnabled}/></main>);qa.render();`;
const built = await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: root }, bundle: true, format: 'esm', write: false, loader:{'.svg':'dataurl','.webp':'dataurl'}, outfile: path.join(evidence, 'qa.js'), plugins: [{ name: 'account-fixture', setup(p) {
  p.onResolve({ filter: /^(qa-fixture|.*\/(AuthContext|useStudentWisStocks|semesterScope|studentWisStockClient|AppToastProvider))$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
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
    await patch(page, { funding: { maximumDeposit: 200 } });
    assert.match(await balance(page, '매수 가능').innerText(), /1,000/);
    assert.match(await balance(page, '입금 가능').innerText(), /200/);
    await page.getByRole('button', { name: '출금', exact: true }).click();
    await page.getByLabel('위스 금액', { exact: true }).fill('501');
    assert.equal(await page.getByRole('button', { name: '일반 위스로 출금', exact: true }).isDisabled(), true);
    assert.match(await balance(page, '출금 가능').innerText(), /500/);
    assert.equal(await page.getByText('이벤트 지원금 원금 제외',{exact:true}).count(),1);
    assert.equal(await page.locator('.student-wispi-balances [aria-live="polite"]').count(),1);
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
    assert(layout.scroll <= width, JSON.stringify(layout));assert.equal(layout.columns, 2);assert.equal(layout.background, 'rgba(0, 0, 0, 0)');assert.equal(layout.shadow, 'none');assert(layout.submitHeight >= 44);
    const controlsFit = await page.locator('.student-wispi-wallet-funding').evaluate(panel => {
      const bounds = panel.getBoundingClientRect();
      return [...panel.querySelectorAll('form input, form button')].every(el => {
        const rect = el.getBoundingClientRect();
        return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
      });
    });
    assert(controlsFit, 'all funding controls fit inside their column');
    assert.equal(await page.evaluate(() => window.qa.historyCalls), 0);
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
  await recovery.evaluate(() => { window.qa.status='error';window.qa.error='합성 계좌 조회 실패';window.qa.render(); });await recovery.getByText('주식 지갑 연결을 다시 확인해 주세요.', { exact: true }).waitFor();assert.equal(await recovery.locator('.student-wispi-balances').count(), 0);
  await recovery.getByRole('button', { name: '다시 연결', exact: true }).click();await balance(recovery, '출금 가능').waitFor();
  await recovery.evaluate(() => { window.qa.active=false;window.qa.render(); });await recovery.locator('.student-wispi-account').waitFor({ state: 'detached' });
  await recovery.close();checks.push('Failed transfer preserves input for retry; account errors clear balances; refresh recovers; inactive account panel is removed.');

  const qualify = await open();
  await qualify.getByRole('button',{name:'받기 완료',exact:true}).waitFor();
  await qualify.evaluate(()=>{window.qa.bonus.status='INELIGIBLE';window.qa.bonus.qualifyingDepositAmount=100;window.qa.state.account.revision++;window.qa.render()});
  await qualify.getByText('누적 입금 100 / 500 위스',{exact:true}).waitFor();
  assert.equal(await qualify.getByRole('button',{name:'500위스 받기',exact:true}).isDisabled(),true);
  assert.equal(await qualify.evaluate(()=>window.qa.claimCalls),0);
  await qualify.getByLabel('위스 금액',{exact:true}).fill('400');await qualify.getByRole('button',{name:'주식 지갑에 입금',exact:true}).click();
  await qualify.getByText('400 위스를 주식 지갑에 입금했습니다.',{exact:true}).waitFor();
  await qualify.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='500위스 받기'&&!button.disabled));
  assert.equal(await qualify.evaluate(()=>window.qa.claimCalls),0,'deposit never claims automatically');
  const readsBeforeClaim=await qualify.evaluate(()=>window.qa.bonusCalls);
  const claimButton=qualify.getByRole('button',{name:'500위스 받기',exact:true});
  await claimButton.focus();await qualify.evaluate(()=>{window.qa.holdClaim=true});await qualify.keyboard.press('Enter');
  await qualify.getByRole('button',{name:'받는 중',exact:true}).waitFor();
  assert.equal(await qualify.getByRole('button',{name:'주식 지갑에 입금',exact:true}).isDisabled(),true);
  await qualify.getByRole('button',{name:'받는 중',exact:true}).evaluate(button=>{button.click();button.click()});
  assert.equal(await qualify.evaluate(()=>window.qa.claimCalls),1);
  await qualify.evaluate(()=>window.qa.releaseClaim());await qualify.getByRole('button',{name:'받기 완료',exact:true}).waitFor();
  assert.deepEqual(await qualify.evaluate(()=>window.qa.toasts),[{tone:'reward',title:'500위스를 주식 지갑에 받았습니다.'}]);
  assert.equal(await qualify.evaluate(()=>window.qa.bonusCalls),readsBeforeClaim,'claim result avoids a redundant eligibility read');
  assert.equal(await qualify.getByRole('button',{name:'받기 완료',exact:true}).isDisabled(),true);
  await qualify.close();checks.push('100/500 is ineligible; a further 400 deposit only enables the explicit button; keyboard claim and duplicate clicks issue one request; success updates once without a follow-up eligibility read.');

  for(const width of [390,768,1280]){
    const page=await open(width);await page.getByRole('button',{name:'받기 완료',exact:true}).waitFor();
    await page.evaluate(()=>{window.qa.bonus.status='ELIGIBLE';window.qa.state.account.revision++;window.qa.render()});
    const button=page.getByRole('button',{name:'500위스 받기',exact:true});await button.waitFor();
    const actual=await page.locator('.student-wispi-bonus').evaluate(element=>({background:getComputedStyle(element).backgroundColor,shadow:getComputedStyle(element).boxShadow,width:document.documentElement.scrollWidth,buttonHeight:element.querySelector('button:not(.ws-info-help__button)').getBoundingClientRect().height}));
    assert.equal(actual.background,'rgba(0, 0, 0, 0)');assert.equal(actual.shadow,'none');assert(actual.width<=width);assert(actual.buttonHeight>=44);
    const help=page.getByRole('button',{name:'위스피 지원금 기준',exact:true});await help.focus();await page.getByRole('tooltip').waitFor();assert.match(await page.getByRole('tooltip').innerText(),/누적 500위스/);await page.keyboard.press('Escape');await page.getByRole('tooltip').waitFor({state:'hidden'});
    await page.close();
  }
  checks.push('390/768/1280px claim section stays transparent with no overflow, 44px actions and keyboard-accessible optional rules.');

  const retries=await open();await retries.getByRole('button',{name:'받기 완료',exact:true}).waitFor();
  await retries.evaluate(()=>{window.qa.bonus.status='ELIGIBLE';window.qa.failBonus=true;window.qa.state.account.revision++;window.qa.render()});
  await retries.getByText('합성 지원금 조회 오류',{exact:true}).waitFor();
  const failedReads=await retries.evaluate(()=>window.qa.bonusCalls);await retries.getByRole('button',{name:'지원금 다시 확인',exact:true}).click();
  await retries.getByRole('button',{name:'500위스 받기',exact:true}).waitFor();assert.equal(await retries.evaluate(()=>window.qa.bonusCalls),failedReads+1);
  await retries.evaluate(()=>{window.qa.failClaim=true});await retries.getByRole('button',{name:'500위스 받기',exact:true}).click();await retries.getByText('합성 지원금 받기 오류',{exact:true}).waitFor();
  await retries.getByRole('button',{name:'500위스 받기',exact:true}).click();await retries.getByRole('button',{name:'받기 완료',exact:true}).waitFor();assert.equal(await retries.evaluate(()=>window.qa.claimCalls),2);
  await retries.close();checks.push('Eligibility failure supports one explicit retry; failed claim remains retryable and succeeds without automatic claim retries.');

  for(const boundary of ['uid','generation','semester','hidden','inactive']){
    const page=await open();await page.getByRole('button',{name:'받기 완료',exact:true}).waitFor();
    await page.evaluate(()=>{window.qa.bonus.status='ELIGIBLE';window.qa.holdBonus=true;window.qa.state.account.revision++;window.qa.render()});await page.waitForFunction(()=>typeof window.qa.releaseBonus==='function');
    await page.evaluate(boundary=>{const q=window.qa;q.bonus.status='INELIGIBLE';q.bonus.qualifyingDepositAmount=0;if(boundary==='uid')q.uid='second-synthetic';if(boundary==='generation')q.generation++;if(boundary==='semester')q.semester='1';if(boundary==='inactive')q.active=false;if(boundary==='hidden'){Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'))}q.render()},boundary);
    if(['uid','generation','semester'].includes(boundary))await page.getByText('누적 입금 0 / 500 위스',{exact:true}).waitFor();
    const afterBoundary=await page.evaluate(()=>window.qa.bonusCalls);await page.evaluate(()=>window.qa.releaseBonus());
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,40)));
    const staleButton=page.getByRole('button',{name:'500위스 받기',exact:true});assert.equal(await staleButton.count()?await staleButton.isEnabled():false,false);
    assert.equal(await page.evaluate(()=>window.qa.bonusCalls),afterBoundary,'no background refresh/poll');
    if(boundary==='hidden'||boundary==='inactive'){
      await page.evaluate(boundary=>{if(boundary==='hidden'){Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});document.dispatchEvent(new Event('visibilitychange'))}else{window.qa.active=true;window.qa.render()}},boundary);
      await page.getByText('누적 입금 0 / 500 위스',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.qa.bonusCalls),afterBoundary+1);
    }
    await page.close();
  }
  checks.push('Old eligibility responses cannot enable claim after account, auth generation, semester, hidden-document or inactive-panel transitions; resume fetches once and no background polling occurs.');
  assert.deepEqual(errors, []);
  const result = { passed: true, checks, errors, screenshots: 0, externalNetwork: 0, productionWrites: 0 };
  await fs.writeFile(path.join(evidence, 'summary.json'), JSON.stringify(result, null, 2));console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();await new Promise(resolve => server.close(resolve));
}
