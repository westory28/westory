import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Used by verify-wis-stocks-browser.mjs --reports-only. All identities, files
// and prices in this fixture are synthetic and stay on the loopback server.
export const reportServiceFixture = `
export const auth = {currentUser:{uid:'synthetic-teacher'}};
export async function ensureSensitiveOperation() { qa.authChecks++; }
qa.reportCalls = []; qa.files = {}; qa.authChecks = 0;
export async function callWisStockService(name, input) {
  qa.reportCalls.push({name, action:input.action, week:input.weekStart, before:input.before});
  if (name === 'exportWisStockWeeklyReportData') {
    if (qa.holdExport) {qa.holdExport=false; await new Promise(resolve=>qa.resumeExport=resolve);}
    if (!input.continuation) return {continuation:'second-page'};
    return {semesterId:'2026-2',weekStart:input.weekStart,stocks:[{name:'합성 종목'}]};
  }
  if (input.action === 'list') return input.before
    ? {reports:[],nextBefore:null}
    : {reports:Object.values(qa.files),nextBefore:Object.keys(qa.files)[0]||null};
  if (input.action === 'read') {
    if (qa.failReadOnce) {qa.failReadOnce=false; throw Error('합성 조회 오류');}
    return {report:qa.files[input.weekStart]||null};
  }
  if (input.action === 'publish') {
    if (qa.conflictOnce) {qa.conflictOnce=false; throw Object.assign(Error('다른 교사가 변경했습니다.'),{code:'functions/aborted'});}
    if (qa.holdPublish) {qa.holdPublish=false; await new Promise(resolve=>qa.resumePublish=resolve);}
    const report={...input, revision:(qa.files[input.weekStart]?.revision||0)+1};
    qa.files[input.weekStart]=report;
    return {report};
  }
  throw Error('예기치 않은 보고서 요청');
}
`;

export async function verifyWeeklyReports({ open, enter, evidence }) {
  const staff = await open(1280, '?staff');
  await enter(staff);
  assert.equal(await staff.getByRole('button',{name:'주식 보고서', exact:true}).count(), 0);
  assert.equal(await staff.evaluate(()=>window.stockQa.reportCalls.length), 0);
  await staff.close();
  for (const width of [390, 768, 1280]) {
    const page = await open(width);
    await enter(page);
    assert.equal(await page.evaluate(()=>window.stockQa.reportCalls.length), 0);
    const button = name => page.getByRole('button', { name, exact: true });
    await button('주식 보고서').click();
    await page.getByText('이 주차에 발행한 보고서가 없습니다.').waitFor();
    assert.equal(await page.evaluate(()=>window.stockQa.reportCalls.length), 1);
    const date = page.locator('input[type=date][aria-label="보고서 주차"]');
    await date.fill('2026-11-25');
    await page.waitForFunction(()=>document.querySelector('input[type=date]').value === '2026-11-23');
    const week = await date.inputValue();
    const download = page.waitForEvent('download');
    await button('분석 자료 다운로드').click();
    const file = await download;
    assert(file.suggestedFilename().includes(week));
    const data = JSON.parse(await readFile(await file.path(), 'utf8'));
    assert.deepEqual(data, {semesterId:'2026-2',weekStart:week,stocks:[{name:'합성 종목'}]});
    assert.equal(await page.evaluate(()=>window.stockQa.reportCalls.filter(c=>c.name==='exportWisStockWeeklyReportData').length),2);

    const input = page.locator('.wis-report input[type=file]');
    const upload = (name, body, mimeType = 'text/plain') =>
      input.setInputFiles({name,mimeType,buffer:Buffer.from(body)});
    await upload('합성.md','# 합성 주간 분석\n\n| 종목 | 종가 |\n| --- | --- |\n| 합성 | 120 |');
    await page.getByRole('columnheader',{name:'종가'}).waitFor();
    await page.getByLabel('보고서 제목').fill('11월 주주 흐름');
    await page.evaluate(()=>window.stockQa.holdPublish=true);
    await button('교사용으로 발행').evaluate(b=>{b.click();b.click()});
    await page.waitForFunction(()=>window.stockQa.resumePublish);
    await page.evaluate(()=>window.stockQa.resumePublish());
    await page.getByRole('heading',{name:'11월 주주 흐름'}).waitFor();
    assert.deepEqual(await page.evaluate(()=>[window.stockQa.authChecks,window.stockQa.reportCalls.filter(c=>c.action==='publish').length]),[1,1]);
    await button('발행한 보고서 목록').click();
    await button('이전 발행본 더 보기').click();
    await page.waitForFunction(()=>window.stockQa.reportCalls.filter(c=>c.action==='list').length===2);

    await upload('수정.txt','합성 수정본');
    await page.evaluate(()=>window.stockQa.conflictOnce=true);
    await button('발행본 교체').click();
    await button('발행본 다시 조회').waitFor();
    assert(await button('발행본 교체').isDisabled());
    await button('발행본 다시 조회').click();
    await button('발행본 교체').click();
    await page.getByRole('heading',{name:'수정',exact:true}).waitFor();
    await page.evaluate(()=>window.stockQa.holdExport=true);
    await button('분석 자료 다운로드').click();
    await page.waitForFunction(()=>window.stockQa.resumeExport);
    await page.evaluate(()=>window.stockQa.failReadOnce=true);
    await button('다음 주').click();
    await page.evaluate(()=>window.stockQa.resumeExport());
    await button('발행본 다시 조회').click();
    await page.getByText('이 주차에 발행한 보고서가 없습니다.').waitFor();
    assert.equal(await page.evaluate(()=>window.stockQa.reportCalls.filter(c=>c.name==='exportWisStockWeeklyReportData').length),3);
    await upload('형식.html','<p>내용</p>','text/html');
    await page.getByRole('alert').filter({hasText:'3MB'}).waitFor();
    // The browser's print engine produces a real PDF with text and two pages.
    const paper = await page.context().browser().newPage();
    await paper.setContent('<p style="break-after:page">First page</p><p>Second page</p>');
    const pdf = await paper.pdf();
    await paper.close();
    await upload('주간분석.pdf',pdf,'application/pdf');
    await page.locator('.wis-report__pdf canvas').waitFor();
    await button('다음 쪽').click();
    await page.getByText('2 / 2쪽').waitFor();
    assert(await button('다음 쪽').isDisabled());
    assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({path:path.join(evidence,'weekly-report-'+width+'.png'),fullPage:true});
    await page.close();
  }
}
