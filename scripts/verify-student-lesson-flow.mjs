// Actual HashRouter -> Note -> LessonSidebar/LessonContent/WorksheetStage.
// Synthetic I/O only; does not certify Firebase rules or deployed authorization.
// Run --prepare-only first to bundle without starting a browser.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const output = mkdtempSync(join(tmpdir(), "westory-student-flow-"));
const fixture = join(output, "fixture.tsx");
// Reuse ONLY the two-page data, never execute the preview server/mock runtime.
const preview = readFileSync(join(root, "scripts/lesson-release-preview.mjs"), "utf8");
const start = preview.indexOf("const image = ");
const end = preview.indexOf("const key=", start);
assert.ok(start >= 0 && end > start, "Preview lesson fixture boundaries exist");
const lessonData = preview.slice(start, end);
writeFileSync(fixture, String.raw`
import React,{useSyncExternalStore} from '${root.replaceAll("\\", "/")}/node_modules/react/index.js';
${lessonData}
const listeners=new Set();
let identity={config:{year:'2026',semester:'2'},currentUser:{uid:'student-a'},userData:{role:'student'}};
export const useAuth=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>identity);
const namespace='westory-student-flow:';
const scope=(config,uid)=>[config.year,config.semester,uid].join('/');
const currentScope=()=>scope(identity.config,identity.currentUser.uid);
const read=key=>JSON.parse(localStorage.getItem(namespace+key)||'{}');
const store=(key,value)=>localStorage.setItem(namespace+key,JSON.stringify(value));
const snapshot=data=>({exists:()=>Object.keys(data).length>0,data:()=>structuredClone(data)});
const pending=[];
window.flow={calls:[],toasts:[],events:0,hold:null,
 select(uid,year='2026',semester='2'){identity={...identity,currentUser:{uid},config:{year,semester}};listeners.forEach(fn=>fn());},
 pending:()=>pending.map(({kind,key})=>({kind,key})),
 finish(){const items=pending.splice(0);this.hold=null;items.forEach(item=>item.resolve(item.complete()));},
 read:(year,semester,uid,unit)=>read([year,semester,uid,...unit?[unit]:[]].join('/')),
 seed:(year,semester,uid,unit,data)=>store([year,semester,uid,unit].join('/'),data),
 seedReward:(year,semester,uid)=>store([year,semester,uid].join('/'),{corePointRewardClaimed:true,awards:1}),
};
window.addEventListener('westory:points-updated',()=>window.flow.events++);
const io=(kind,key,complete)=>{
 window.flow.calls.push({kind,key});
 if(window.flow.hold?.kind===kind && key.startsWith(window.flow.hold.key))return new Promise(resolve=>pending.push({kind,key,complete,resolve}));
 return Promise.resolve(complete());
};
const lessonFor=unit=>({...lesson,unitId:unit,title:unit==='unit-one'?lesson.title:'다른 단원',...unit==='unit-two'?{worksheetExamHighlights:[]}: {}});
const tree=[{id:'big',title:'역사 수업',children:[{id:'mid',title:'시대별 학습',children:[{id:'unit-one',title:lesson.title},{id:'unit-two',title:'다른 단원'}]}]}];
export const readStudentVisibleCurriculumTree=config=>io('tree',scope(config,identity.currentUser.uid),()=>structuredClone(tree));
export const readStudentLatestLessonSelection=(config)=>io('latest',scope(config,identity.currentUser.uid),()=>({node:tree[0].children[0].children[0]}));
export const readStudentLesson=(config,unit)=>io('lesson',scope(config,identity.currentUser.uid)+'/'+unit,()=>structuredClone(lessonFor(unit)));
export const readStudentVisibleLessons=async()=>[lessonFor('unit-one'),lessonFor('unit-two')];
export const db={};export const doc=(_db,...parts)=>({path:parts.join('/')});export const collection=doc;
const parse=ref=>{const match=ref.path.match(/^years\/([^/]+)\/semesters\/([^/]+)\/lesson_progress\/([^/]+)(?:\/units(?:\/([^/]+))?)?$/);if(!match)throw Error('Unexpected persistence path '+ref.path);return {key:match.slice(1,4).join('/'),unit:match[4]};};
export const getDoc=ref=>{const {key,unit}=parse(ref);const data=read(unit?key+'/'+unit:key);return io(unit?'restore':'overview',unit?key+'/'+unit:key,()=>snapshot(data));};
export const getDocFromServer=getDoc;
export const getDocs=async ref=>{const {key}=parse(ref);return {docs:['unit-one','unit-two'].map(id=>({id,data:()=>read(key+'/'+id)}))};};
export const isLessonAnswerSaveUncertain=()=>false;export const isLessonAnswerSaveConflict=error=>error?.conflict===true;
export const createLessonAnswerSave=input=>structuredClone(input);
export const executeLessonAnswerSave=input=>{
 const key=scope(input.config,input.studentUid)+'/'+input.unitId;
 return io('save',key,()=>{const before=read(key);if((before.answerRevision||0)!==input.expectedAnswerRevision)throw Object.assign(Error('Synthetic revision conflict'),{conflict:true});
 const answers=Object.fromEntries(Object.entries(input.answers).map(([id,value])=>[id,{value,status:!value?'':value===(id==='blank-two'?'조선':'고려')?'correct':'wrong'}]));
 const result={unitId:input.unitId,answerRevision:(before.answerRevision||0)+1,contentRevision:2,answers,correctCount:Object.values(answers).filter(a=>a.status==='correct').length,totalCount:3};store(key,{...before,...result});return result;});
};
export const recordLessonCorePointFind=input=>{const key=scope(input.config,identity.currentUser.uid)+'/'+input.unitId;return io('find',key,()=>{const before=read(key);store(key,{...before,corePointFinds:[...new Set([...(before.corePointFinds||[]),input.corePointId])]});return {result:{settled:true}};});};
export const claimLessonCorePointReward=config=>{const key=scope(config,identity.currentUser.uid);return io('reward',key,()=>{const before=read(key),duplicate=!!before.corePointRewardClaimed;store(key,{...before,corePointRewardClaimed:true,awards:(before.awards||0)+(duplicate?0:1)});return {result:{awarded:!duplicate,duplicate,settled:true,amount:duplicate?0:500,totalAwarded:duplicate?0:500}};});};
export const useAppToast=()=>({showToast:toast=>{window.flow.toasts.push(toast);}});
export const getFirebaseStorage=async()=>({});export const ref=(_storage,path)=>({path});export const getDownloadURL=async()=>image;
export const lazyWithRetry=load=>React.lazy(load);
`);
const bundle = await build({
  stdin: {
    contents: `import React,{Suspense,useState} from 'react';import {createRoot} from 'react-dom/client';import {HashRouter,Routes,Route} from 'react-router-dom';import Note from './src/pages/student/lesson/Note';import '${fixture.replaceAll("\\", "/")}';function App(){const [mounted,setMounted]=useState(true);window.flow.mount=setMounted;return <HashRouter><Suspense fallback="loading"><Routes><Route path="/student/lesson/note" element={mounted?<Note/>:<div>수업 화면 닫힘</div>}/></Routes></Suspense></HashRouter>};createRoot(document.getElementById('root')).render(<App/>);`,
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  metafile: true,
  define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" },
  plugins: [{name: "student-flow-isolated-io",setup(api) {
    api.onResolve({filter: /AuthContext$|AppToastProvider$|studentLessonReadCache$|lessonAnswers$|lessonCorePointReward$|lazyWithRetry$|\/lib\/firebase$|firebase\/(firestore|storage)$/},()=>({path:fixture}));
  }}],
});
const inputs = Object.keys(bundle.metafile.inputs).map(path=>path.replaceAll("\\", "/"));
assert.ok(!inputs.some(path=>/src\/lib\/firebase\.ts$|node_modules\/@firebase\//.test(path)), "No Firebase runtime bundled");
for (const name of ["Note", "LessonSidebar", "LessonContent", "LessonWorksheetStage", "LessonFootnoteDialog"]) {
  assert.ok(inputs.some(path=>path.endsWith('/'+name+'.tsx')), `Actual ${name} bundled`);
}
writeFileSync(join(output, "bundle.js"), bundle.outputFiles[0].contents);
writeFileSync(join(output, "metafile.json"), JSON.stringify(bundle.metafile,null,2));
if (process.argv.includes("--prepare-only")) {
  console.log(JSON.stringify({status:"PREPARED",output,actualComponents:5,firebaseRuntime:false,browserStarted:false},null,2));
  process.exit(0);
}
const cssName = readdirSync(join(root,"dist/assets")).find(name=>/^main-.*\.css$/.test(name));
assert.ok(cssName,"Build the application before browser verification");
const css = readFileSync(join(root,"dist/assets",cssName));
const html='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>';
const server = createServer((req,res)=>{
  const path=req.url.split('?')[0];
  res.setHeader('Content-Security-Policy',"default-src 'self' data: blob:;connect-src 'none';style-src 'self' 'unsafe-inline';font-src 'none';img-src 'self' data:;script-src 'self';frame-src 'none'");
  res.setHeader('Content-Type',path==='/app.js'?'text/javascript':path==='/app.css'?'text/css':'text/html;charset=utf-8');
  res.end(path==='/app.js'?bundle.outputFiles[0].contents:path==='/app.css'?css:html);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser,page;
const results=[],errors=[],blocked=[];
let failure=null;
const check=(label,actual,expected=true)=>{assert.deepEqual(actual,expected,label);results.push(label);};
try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const origin=`http://127.0.0.1:${server.address().port}`;
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();blocked.push(route.request().url());return route.abort();});
  page=await context.newPage();page.setDefaultTimeout(8000);
  page.on('pageerror',error=>errors.push(error.message));
  const blank=id=>page.locator(`input[data-blank-id="${id}"]`);
  const point=()=>page.locator('button.lesson-core-point');
  const reward=()=>page.getByRole('button',{name:/핵심포인트 완주 보상.*받기/});
  const waitSaved=()=>page.getByRole('dialog',{name:'답안 저장 완료'}).waitFor();
  const closeSaved=()=>page.getByRole('dialog',{name:'답안 저장 완료'}).getByRole('button',{name:'확인',exact:true}).click();
  const ready=async()=>{await blank('blank-one').waitFor();await page.waitForFunction(()=>!document.querySelector('button[aria-label="답안 확인 중"]'));};
  const remount=async()=>{await page.evaluate(()=>window.flow.mount(false));await page.getByText('수업 화면 닫힘',{exact:true}).waitFor();await page.evaluate(()=>window.flow.mount(true));await ready();};
  const save=async()=>{await page.getByRole('button',{name:'저장 가능',exact:true}).click();await waitSaved();};
  await page.goto(origin+'/#/student/lesson/note');await ready();
  check('Sidebar latest selection updates real hash route',new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('id'),'unit-one');
  check('Real tree and latest reads used',await page.evaluate(()=>['tree','latest'].every(kind=>window.flow.calls.some(call=>call.kind===kind))));
  await page.locator('input.cloze-input').fill('고려');
  await blank('blank-one').fill('고려');
  await page.getByRole('button',{name:'다음 페이지',exact:true}).click();
  await blank('blank-two').fill('오답');
  await save();
  check('Save completion reports mixed answers',await page.getByRole('dialog').innerText().then(text=>text.includes('정답 2/3')));
  await closeSaved();
  check('Page 2 wrong style',await blank('blank-two').evaluate(node=>node.classList.contains('text-rose-700')));
  check('Page 2 non-color wrong feedback',await blank('blank-two').evaluate(node=>node.parentElement.textContent.includes('오답')));
  await page.getByRole('button',{name:'이전 페이지',exact:true}).click();
  check('Page 1 correct style',await blank('blank-one').evaluate(node=>node.classList.contains('text-emerald-700')));
  check('Page 1 non-color correct feedback',await blank('blank-one').evaluate(node=>node.parentElement.textContent.includes('정답')));
  check('Body correct feedback',await page.locator('input.cloze-input').evaluate(node=>node.classList.contains('correct')));
  await page.screenshot({path:join(output,'student-answers.png'),fullPage:true});
  await remount();
  check('Answer survives actual unmount/remount',await blank('blank-one').inputValue(),'고려');
  await page.reload();await ready();
  check('Answer survives browser reload and fresh read',await blank('blank-one').inputValue(),'고려');
  await page.getByRole('button',{name:'다음 페이지',exact:true}).click();
  check('Page 2 wrong answer restored',await blank('blank-two').inputValue(),'오답');
  check('Page 2 restored wrong feedback',await blank('blank-two').evaluate(node=>node.classList.contains('text-rose-700')));
  if(process.argv.includes('--keyboard-repro')) {
    await blank('blank-two').click();
    await blank('blank-two').press('ControlOrMeta+A');
    await blank('blank-two').pressSequentially('x');
    check('First physical key after restore remains in the answer',await blank('blank-two').inputValue(),'x');
  }
  await blank('blank-two').fill('조선');
  await page.waitForFunction(()=>!document.querySelector('input[data-blank-id="blank-two"]').parentElement.textContent.includes('오답'));
  check('Editing an answer clears stale wrong feedback',await blank('blank-two').evaluate(node=>!node.parentElement.textContent.includes('오답')));
  await save();await closeSaved();
  check('Corrected page 2 feedback',await blank('blank-two').evaluate(node=>node.parentElement.textContent.includes('정답')));
  await page.getByRole('button',{name:'이전 페이지',exact:true}).click();
  await page.getByRole('button',{name:'이미지·글·링크 각주 열기',exact:true}).click();
  await page.getByText('설명 글이 보입니다.',{exact:true}).waitFor();
  check('Footnote image loaded',await page.getByRole('img',{name:'이미지·글·링크 각주',exact:true}).evaluate(image=>image.complete&&image.naturalWidth>0));
  const link=page.getByRole('link',{name:'링크 열기 · 새 창',exact:true});
  check('Footnote link destination',await link.getAttribute('href'),'https://example.com/lesson');
  check('Footnote opens a separate safe window',await link.evaluate(node=>node.target==='_blank'&&node.rel.includes('noopener')&&node.rel.includes('noreferrer')));
  await page.screenshot({path:join(output,'student-footnote.png'),fullPage:true});
  await page.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('button',{name:'참고 보기',exact:true}).click();
  await page.getByText('설명 글이 보입니다.',{exact:true}).waitFor();results.push('Body and worksheet anchors open real footnote panel');
  await page.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('button',{name:'다른 단원',exact:true}).click();await ready();
  check('Sidebar selection changes hash route',new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('id'),'unit-two');
  check('Other unit has isolated answers',await blank('blank-one').inputValue(),'');
  await page.getByRole('button',{name:'수업자료 패치 검증',exact:true}).click();await ready();
  check('Returning through sidebar restores unit answers',await blank('blank-one').inputValue(),'고려');
  await point().click();await reward().waitFor();
  check('Core point committed with scope and unit',await page.evaluate(()=>window.flow.read('2026','2','student-a','unit-one').corePointFinds),['core-one']);
  await page.evaluate(()=>{window.flow.hold={kind:'reward',key:'2026/2/student-a'};});
  await reward().click();await page.waitForFunction(()=>window.flow.pending().some(item=>item.kind==='reward'));
  check('Pending reward button prevents duplicate UI submission',await page.getByRole('button',{name:'핵심포인트 보상 반영 중',exact:true}).isDisabled());
  await page.evaluate(()=>window.flow.finish());
  await page.waitForFunction(()=>window.flow.events===1);
  check('Reward exactly 500 in real completion feedback',await page.evaluate(()=>window.flow.toasts.some(toast=>toast.message?.includes('+500'))));
  check('Reward scoped to account and semester',await page.evaluate(()=>window.flow.read('2026','2','student-a').awards),1);
  await remount();check('Settled reward hidden after remount',await reward().count(),0);
  await page.reload();await ready();check('Settled reward hidden after reload',await reward().count(),0);
  check('Reload does not issue reward command',await page.evaluate(()=>window.flow.calls.filter(call=>call.kind==='reward').length),0);
  // Stale overview may expose a claim button; the server-style duplicate result
  // must settle that UI without emitting a second points update.
  await page.evaluate(()=>{window.flow.seed('2026','2','duplicate-user','unit-one',{corePointFinds:['core-one']});window.flow.hold={kind:'overview',key:'2026/2/duplicate-user'};window.flow.select('duplicate-user');});
  await ready();await page.waitForFunction(()=>window.flow.pending().some(item=>item.kind==='overview'));
  await page.evaluate(()=>{window.flow.seedReward('2026','2','duplicate-user');window.flow.finish();});
  await reward().waitFor();await reward().click();
  await page.waitForFunction(()=>window.flow.toasts.some(toast=>toast.message?.includes('이미 반영')));
  check('Duplicate reward emits no points event',await page.evaluate(()=>window.flow.events),0);
  check('Duplicate reward ledger remains one award',await page.evaluate(()=>window.flow.read('2026','2','duplicate-user').awards),1);
  check('Duplicate reward button settles',await reward().count(),0);
  // Old restore snapshots and old saves are delivered after a real auth/scope
  // update. Both API keys and the new UI must remain in the correct context.
  for (const kind of ['account','semester']) {
    const old={uid:kind+'-old',year:'2026',semester:'2'};
    const next={uid:kind==='account'?kind+'-new':old.uid,year:'2026',semester:kind==='semester'?'1':'2'};
    await page.evaluate(({old})=>{window.flow.seed(old.year,old.semester,old.uid,'unit-one',{answerRevision:1,answers:{'blank-one':{value:'이전 답안',status:'wrong'}}});window.flow.hold={kind:'restore',key:[old.year,old.semester,old.uid].join('/')};window.flow.select(old.uid,old.year,old.semester);},{old});
    await page.waitForFunction(()=>window.flow.pending().some(item=>item.kind==='restore'));
    await page.evaluate(next=>window.flow.select(next.uid,next.year,next.semester),next);await ready();
    await blank('blank-one').fill('새 답안');
    await page.evaluate(()=>window.flow.finish());
    await page.waitForTimeout(100);
    check(kind+': late restore does not overwrite new input',await blank('blank-one').inputValue(),'새 답안');
    await save();await closeSaved();
    check(kind+': new write uses new scope',await page.evaluate(next=>window.flow.read(next.year,next.semester,next.uid,'unit-one').answers['blank-one'].value,next),'새 답안');
    await page.evaluate(old=>window.flow.select(old.uid,old.year,old.semester),old);await ready();
    await blank('blank-one').fill('이전 저장');
    await page.evaluate(old=>{window.flow.hold={kind:'save',key:[old.year,old.semester,old.uid].join('/')};},old);
    await page.getByRole('button',{name:'저장 가능',exact:true}).click();await page.waitForFunction(()=>window.flow.pending().some(item=>item.kind==='save'));
    await page.evaluate(next=>window.flow.select(next.uid,next.year,next.semester),next);await ready();
    await page.evaluate(()=>{window.flow.toasts=[];window.flow.finish();});await page.waitForTimeout(100);
    check(kind+': late save does not replace new answers',await blank('blank-one').inputValue(),'새 답안');
    check(kind+': late save shows no completion in new context',await page.getByRole('dialog',{name:'답안 저장 완료'}).count(),0);
    check(kind+': late save emits no toast in new context',await page.evaluate(()=>window.flow.toasts.length),0);
    check(kind+': late save writes original context only',await page.evaluate(old=>window.flow.read(old.year,old.semester,old.uid,'unit-one').answers['blank-one'].value,old),'이전 저장');
    check(kind+': old reward does not appear in new context',await page.evaluate(next=>!!window.flow.read(next.year,next.semester,next.uid).corePointRewardClaimed,next),false);
  }
  for(const width of [390,768]) {
    await page.setViewportSize({width,height:900});
    await page.getByRole('button',{name:'수업 목차 열기',exact:true}).click();
    await page.getByRole('button',{name:'다른 단원',exact:true}).click();await ready();
    check(width+'px: mobile sidebar selects the routed lesson',new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('id'),'unit-two');
    check(width+'px: selecting a lesson closes mobile sidebar',await page.getByRole('button',{name:'수업 목차 열기',exact:true}).isVisible());
    await page.getByRole('button',{name:'수업 목차 열기',exact:true}).click();
    await page.getByRole('button',{name:'수업자료 패치 검증',exact:true}).click();await ready();
    check(width+'px: no document horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:join(output,`student-route-${width}.png`),fullPage:true});
  }
  check('No unexpected page errors',errors,[]);
  check('No external network requests attempted',blocked,[]);
  console.log(JSON.stringify({status:'PASS',checks:results.length,output},null,2));
} catch(error) {
  failure=error.stack||String(error);
  if(page)await page.screenshot({path:join(output,'failure.png'),fullPage:true}).catch(()=>{});
  console.error(error);console.error(JSON.stringify({status:'FAIL',checks:results.length,output},null,2));process.exitCode=1;
} finally {
  writeFileSync(join(output,'results.json'),JSON.stringify({status:process.exitCode?'FAIL':'PASS',checks:results.length,results,errors,blocked,failure},null,2));
  await browser?.close();await new Promise(resolve=>server.close(resolve));
}
