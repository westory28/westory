/** Actual shared ranking UI; synthetic service responses, no external requests. */
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
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH ||
  path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const evidence = process.env.WIS_RANKING_QA_EVIDENCE_DIR || path.join(os.tmpdir(), 'westory-wis-ranking-modes-qa');
await fs.mkdir(evidence, { recursive: true });
const imp = file => JSON.stringify(path.join(root, file).replaceAll('\\', '/'));
const service = `
export const qa=window.wisRankingQa={calls:[],pending:[],hold:false,fail:false,empty:false,config:{year:'2026',semester:'2'},
 user:{uid:'teacher'},generation:1,audience:'teacher'};
export const useAuth=()=>({currentUser:qa.user,authGeneration:qa.generation,configReady:true});
export const getWisHallOfFameGradeLeaderboard=snapshot=>snapshot?.gradeLeaderboardByGrade?.[snapshot.primaryGradeKey]||[];
export const getPointRankDefaultEmojiValue=()=> '😀';
export const getPointRankDisplay=()=>null;
export const getWisRankingPreview=async(config,audience,selection)=>{
 const call={config:{...config},audience,...selection,uid:qa.user?.uid};qa.calls.push(call);
 const current=selection.metric==='current',classroom=selection.classKey==='3-2';
 const entries=Array.from({length:5},(_,i)=>({uid:'student-'+(current?5-i:i),rank:i<2?1:i+1,
   grade:'3',class:classroom?'2':'1',number:String(i+1),studentName:(current?'현재':'누적')+(classroom?'2반':'전체')+'학생'+(i+1),
   displayName:(current?'현재':'누적')+(classroom?'2반':'전체')+'학생'+(i+1),currentBalance:500-i*10,cumulativeEarned:1000-i*10}));
 const result={snapshot:{primaryGradeKey:'3',rankingMetric:current?'currentBalance':'cumulativeEarned',
   gradeLeaderboardByGrade:{'3':qa.empty?[]:entries}},rankPolicy:{enabled:false},
   classes:[{key:'3-1',grade:'3',classNumber:'1'},{key:'3-2',grade:'3',classNumber:'2'}]};
 if(qa.hold)await new Promise((resolve,reject)=>qa.pending.push({call,resolve,reject}));
 if(qa.fail)throw Error('synthetic ranking failure');return result;
};
`;
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';
import WisRankingPanel from ${imp('src/components/common/WisRankingPanel.tsx')};
import ${imp('src/assets/index.css')};import {qa} from 'fixture:service';
const root=createRoot(document.getElementById('root'));
qa.render=()=>root.render(<HashRouter><main style={{padding:16,maxWidth:760}}><WisRankingPanel config={qa.config} hallOfFamePath={'/'+qa.audience+'/hall-of-fame'}/></main></HashRouter>);
qa.render();
`;
const bundle = await build({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,
  format:'esm',platform:'browser',target:'es2022',outfile:path.join(evidence,'qa.js'),
  loader:{'.svg':'dataurl','.webp':'dataurl'},define:{'process.env.NODE_ENV':'"production"','import.meta.env.BASE_URL':'"/"'},plugins:[{
    name:'synthetic-ranking-services',setup(plugin){
      plugin.onResolve({filter:/^fixture:|(?:^|\/)contexts\/AuthContext$|(?:^|\/)lib\/(wisRankingPreview|wisHallOfFame|pointRanks)$/},
        ()=>({path:'service',namespace:'fixture'}));
      plugin.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:service,loader:'tsx',resolveDir:root}));
    }
  }]});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const tailwind=await fs.readFile(path.join(os.tmpdir(),'westory-qa-tailwind.js'),'utf8');
const neutral=await fs.readFile(path.join(root,'public/avatar/minimi-v2/neutral.svg'),'utf8');
const html='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/qa.css"><div id="root"></div><script type="module" src="/qa.js"></script></html>';
const server=http.createServer((req,res)=>{const files={'/qa.js':['text/javascript',js],'/qa.css':['text/css',css],'/tailwind.js':['text/javascript',tailwind],'/avatar/minimi-v2/neutral.svg':['image/svg+xml',neutral]};
  const[type,data]=files[new URL(req.url,'http://localhost').pathname]||['text/html',html];res.setHeader('Content-Type',type+';charset=utf-8');res.end(data)});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await playwright.chromium.launch({channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||'msedge',headless:true});
const checks=[],layouts=[],errors=[];let failure;
const name = page => page.locator('.wis-ranking-name').first().textContent();
const waitName = (page, text) => page.waitForFunction(text=>document.querySelector('.wis-ranking-name')?.textContent?.startsWith(text),text);
try {
  for(const width of [320,390,768,1440]) {
    const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
    await page.goto(origin);await waitName(page,'누적전체');
    assert.equal(await page.evaluate(()=>wisRankingQa.calls.length),1);
    assert.deepEqual(await page.locator('.wis-ranking-rank-medal').allTextContents(),['1','1','3','4','5']);
    const cumulative=page.getByRole('radio',{name:'누적',exact:true});
    await cumulative.focus();await page.keyboard.press('ArrowRight');await waitName(page,'현재전체');
    assert.equal(await page.getByRole('radio',{name:'현재',exact:true}).getAttribute('aria-checked'),'true');
    assert.equal(await page.locator('.wis-ranking-score').first().getAttribute('aria-label'),'현재 500 위스');
    await page.getByRole('combobox',{name:'위스 순위 학급'}).selectOption('3-2');await waitName(page,'현재2반');
    assert.equal(await page.evaluate(()=>wisRankingQa.calls.at(-1).classKey),'3-2');
    const layout=await page.evaluate(()=>{
      const header=document.querySelector('.wis-ranking-heading'),style=getComputedStyle(header);
      const controls=Array.from(header.querySelectorAll('.wis-ranking-metric,.wis-ranking-class-select')).map(el=>{
        const r=el.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right};});
      const badgeHeight=header.querySelector('.wis-ranking-metric span').getBoundingClientRect().height;
      const selectHeight=header.querySelector('.wis-ranking-class-select').getBoundingClientRect().height;
      return{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,background:style.backgroundColor,
        shadow:style.boxShadow,position:style.position,controls,badgeHeight,selectHeight};
    });
    assert(layout.scrollWidth<=width,`Horizontal overflow at ${width}`);
    assert.equal(layout.background,'rgba(0, 0, 0, 0)');assert.equal(layout.shadow,'none');assert.notEqual(layout.position,'sticky');
    assert(layout.controls.slice(0,2).every(item=>item.height>=44));
    // Explicit user exception: the select must match the compact visible badges.
    assert.equal(layout.selectHeight,28);
    assert.equal(layout.selectHeight,layout.badgeHeight);
    assert(layout.controls.every(item=>item.left>=0&&item.right<=width));
    layouts.push(layout);
    await page.screenshot({path:path.join(evidence,`ranking-${width}.png`),fullPage:true});
    checks.push(`${width}px: transparent heading, no overflow, 28px select matching badges, keyboard metric/class controls, tied rank`);
    await page.close();
  }
  const page=await browser.newPage({viewport:{width:768,height:900},reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin);await waitName(page,'누적전체');
  await page.evaluate(()=>wisRankingQa.hold=true);
  await page.getByRole('radio',{name:'현재',exact:true}).click();
  await page.waitForFunction(()=>wisRankingQa.pending.length===1);
  await page.getByRole('combobox',{name:'위스 순위 학급'}).selectOption('3-2');
  await page.waitForFunction(()=>wisRankingQa.pending.length===2);
  await page.evaluate(()=>wisRankingQa.pending[1].resolve());await waitName(page,'현재2반');
  await page.evaluate(()=>{wisRankingQa.pending[0].resolve();wisRankingQa.hold=false});
  await page.waitForTimeout(50);assert((await name(page)).startsWith('현재2반'));
  checks.push('Late previous-mode/class responses cannot overwrite the current selection');
  await page.evaluate(()=>wisRankingQa.fail=true);
  await page.getByRole('radio',{name:'누적',exact:true}).click();
  await page.getByText('순위를 불러오지 못했습니다.',{exact:true}).waitFor();
  assert.equal(await page.locator('.wis-ranking-row').count(),0);
  const failedCalls=await page.evaluate(()=>wisRankingQa.calls.length);
  await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>wisRankingQa.calls.length),failedCalls);
  await page.evaluate(()=>wisRankingQa.fail=false);
  await page.getByRole('button',{name:'다시 시도',exact:true}).click();await waitName(page,'누적2반');
  checks.push('Failure hides stale rows, makes no polling calls, and explicit retry recovers');
  await page.evaluate(()=>{wisRankingQa.config={year:'2026',semester:'1'};wisRankingQa.render()});
  await waitName(page,'누적전체');
  assert.equal(await page.getByRole('combobox',{name:'위스 순위 학급'}).inputValue(),'');
  assert.equal(await page.evaluate(()=>wisRankingQa.calls.at(-1).config.semester),'1');
  checks.push('Semester change resets the selected class and requests only the new semester');
  await page.evaluate(()=>{wisRankingQa.hold=true});
  await page.getByRole('radio',{name:'현재',exact:true}).click();
  await page.waitForFunction(()=>wisRankingQa.pending.length===3);
  await page.evaluate(()=>{wisRankingQa.user=null;wisRankingQa.generation++;wisRankingQa.render()});
  await page.evaluate(()=>wisRankingQa.pending[2].resolve());await page.waitForTimeout(80);
  assert.equal(await page.locator('.wis-ranking-row').count(),0);
  assert.equal(await page.getByRole('combobox',{name:'위스 순위 학급'}).locator('option').count(),1);
  checks.push('Logout rejects late rows and clears the previous account class choices');
  await page.evaluate(()=>{wisRankingQa.empty=true;wisRankingQa.hold=false;wisRankingQa.user={uid:'student-new'};wisRankingQa.generation++;wisRankingQa.audience='student';wisRankingQa.render()});
  await page.getByText('표시할 위스 순위가 없습니다.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>wisRankingQa.calls.at(-1).audience),'student');
  checks.push('Student audience uses its own request and empty state');
  await page.close();assert.deepEqual(errors,[]);
} catch(error){failure=error} finally {
  await browser.close();await new Promise(resolve=>server.close(resolve));
  await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({status:failure?'FAIL':'PASS',checks,layouts,errors,
    ...(failure?{failure:failure.stack}:{})},null,2));
}
if(failure)throw failure;
console.log(JSON.stringify({status:'PASS',checks,evidence,externalNetworkRequests:0},null,2));
