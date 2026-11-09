/** Exercise the real QuizEditor filters with synthetic local services only. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const evidence = await fs.mkdtemp(path.join(os.tmpdir(), "westory-quiz-unit-filters-"));
const fixture = await fs.readFile("scripts/verify-assessment-teacher-browser.mjs", "utf8");
let service = fixture.match(/const service = `([\s\S]*?)`;/)[1];
service = service.replace("category:q.category,type:q.type,refBig:", "category:q.category,type:q.type,examRound:q.examRound,paperOrder:q.paperOrder,points:q.points,refBig:");
const longLabels = [
  "Ⅳ. 조선 사회의 성립과 통치 체제의 정비",
  "조선의 중앙 정치와 지방 통치 체제의 운영",
  "사림의 성장과 붕당 정치의 전개 과정",
];
const shortLabels = ["조선", "정치", "사림"];
const tree = [longLabels, shortLabels].map((labels, i) => ({
  id: `big-${i}`, title: labels[0], children: [{id:`mid-${i}`,title:labels[1],children:[{id:`small-${i}`,title:labels[2]}]}],
}));
service += `\ntree.splice(0,tree.length,...${JSON.stringify(tree)});questions.splice(0,questions.length,...${JSON.stringify(tree.map((unit,i)=>({
  id:9001+i,unitId:"exam_prep",category:"exam_prep",examRound:"round_1",paperOrder:i+1,points:50,type:"choice",question:i?"짧은 단원 합성 문항":"긴 단원 합성 문항",passage:i?"":"문항의 본문 자료",examplePassage:"ㄱ. 조선은 의정부와 6조를 두었다.\nㄴ. 지방에 관찰사를 파견하였다.",answer:"정답",options:["정답","오답","다른 보기","네 번째","다섯 번째"],contentRevision:1,refBig:unit.id,refMid:unit.children[0].id,refSmall:unit.children[0].children[0].id,
})))});`;
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import QuizEditor from './src/pages/teacher/components/QuizEditor.tsx';import {tree} from 'fixture:service';import './src/assets/index.css';import './src/pages/teacher/teacherSettings.css';createRoot(document.getElementById('root')).render(<main style={{padding:16,maxWidth:1536,margin:'0 auto',minWidth:0}}><QuizEditor node={{id:'exam_prep',title:'모의고사'}} type="special" treeData={tree} canEdit={true} onOpenSettings={()=>{}}/></main>);`;
const bundle = await build({
  stdin:{contents:entry,loader:"tsx",resolveDir:root},bundle:true,write:false,format:"esm",platform:"browser",outfile:"fixture.js",
  loader:{".woff2":"dataurl",".woff":"dataurl",".webp":"dataurl",".svg":"dataurl",".png":"dataurl"},define:{"process.env.NODE_ENV":'"production"'},
  plugins:[{name:"local-services",setup(plugin){
    plugin.onResolve({filter:/^fixture:service$|(?:^|\/)contexts\/AuthContext$|(?:^|\/)(?:lib\/)?(firebase|assessmentRelease|assessmentLifecycle|historyDictionarySession)$|^firebase\/firestore$/},()=>({path:"service",namespace:"fixture"}));
    plugin.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:service,loader:"ts",resolveDir:root}));
  }}],
});
const js=bundle.outputFiles.find(file=>file.path.endsWith(".js")).text;
const css=bundle.outputFiles.find(file=>file.path.endsWith(".css")).text.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/g,"");
let tailwind;
for(const candidate of [process.env.PORTAL_DESIGN_TAILWIND_PATH,path.join(os.tmpdir(),"westory-qa-tailwind.js"),path.join(os.tmpdir(),"westory-assessment-qa-tailwind.js")].filter(Boolean)){
  try{tailwind=await fs.readFile(candidate,"utf8");break;}catch{}
}
assert.ok(tailwind,"A cached official Tailwind runtime is required.");
const html='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><body style="margin:0"><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server=http.createServer((req,res)=>{
  const route=new URL(req.url,"http://localhost").pathname;
  const [type,body]={"/fixture.js":["text/javascript",js],"/fixture.css":["text/css",css],"/tailwind.js":["text/javascript",tailwind]}[route]||["text/html",html];
  res.setHeader("Content-Type",type+";charset=utf-8");res.end(body);
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||"msedge",headless:true});
const errors=[],screenshots=[],checks=[];
try{
  const page=await browser.newPage({viewport:{width:1920,height:1000}});
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/*",route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin);
  const names=["모의고사 대단원 필터","모의고사 중단원 필터","모의고사 소단원 필터"];
  const selects=names.map(name=>page.getByRole("combobox",{name,exact:true}));
  const choose=async(index)=>{
    for(let level=0;level<3;level++)await selects[level].selectOption(`${["big","mid","small"][level]}-${index}`);
  };
  const dimensions=()=>page.locator('.quiz-unit-filter-select select').evaluateAll(elements=>elements.map(select=>{
    const style=getComputedStyle(select),box=select.getBoundingClientRect();
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d');context.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const label=select.selectedOptions[0].textContent.trim();
    // Native selects reserve internal arrow space in addition to CSS padding.
    // Measure a one-option auto-width control instead of assuming a pixel allowance.
    const probe=select.cloneNode(false);probe.append(select.selectedOptions[0].cloneNode(true));
    Object.assign(probe.style,{width:'auto',minWidth:'0',maxWidth:'none',position:'absolute',inset:'auto',left:'-10000px',visibility:'hidden'});
    select.parentElement.append(probe);const requiredWidth=probe.getBoundingClientRect().width;probe.remove();
    return {label,width:box.width,requiredWidth,left:box.left,right:box.right,top:box.top,height:box.height,textWidth:context.measureText(label).width,available:select.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),ellipsis:style.textOverflow,overflow:style.overflowX,title:select.title};
  }));
  await selects[0].waitFor();await choose(0);
  await page.getByText("긴 단원 합성 문항",{exact:true}).waitFor();
  const example = page.locator('.quiz-question-example');
  assert.equal(await example.locator('legend').innerText(), '<보기>');
  assert.match(await example.innerText(), /ㄱ\. 조선은 의정부와 6조를 두었다\./);
  const passageBox = await page.getByText('문항의 본문 자료',{exact:true}).boundingBox();
  assert.ok((await example.boundingBox()).y > passageBox.y + passageBox.height, 'example appears below the passage');
  assert.equal(await page.getByText("짧은 단원 합성 문항",{exact:true}).count(),0,"selected references filter the question list");
  const wide=await dimensions();
  assert.deepEqual(wide.map(value=>value.label),longLabels);
  assert.ok(wide.every(value=>value.width>=value.requiredWidth-1),`wide screen displays all selected Korean labels: ${JSON.stringify(wide)}`);
  await choose(1);await page.getByText("짧은 단원 합성 문항",{exact:true}).waitFor();
  assert.equal(await page.locator('.quiz-question-material').count(), 1, 'example-only questions retain the material panel');
  assert.equal(await example.count(), 1);
  const short=await dimensions();
  assert.ok(short.every((value,index)=>value.width<wide[index].width-40),"each dropdown shrinks to its shorter selected label");
  await choose(0);
  const resized=await dimensions();
  assert.ok(resized.every((value,index)=>Math.abs(value.width-wide[index].width)<2),"long labels restore their full widths");
  for(const width of [1920,1440,1280,768,390,320]){
    await page.setViewportSize({width,height:1000});
    const geometry=await dimensions();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`page overflow ${width}`);
    assert.equal(await page.locator('.quiz-unit-filter-select select').count(),3);
    assert.deepEqual(geometry.map(value=>value.label),longLabels);
    assert.ok(geometry.every(value=>value.title===value.label),"full names remain available as tooltips");
    assert.ok(geometry.every(value=>value.height>=44),"filters preserve 44px control height");
    for(let index=1;index<geometry.length;index++)assert.ok(geometry[index].left>=geometry[index-1].right-1,`filter controls do not overlap ${width}`);
    assert.ok(Math.abs(geometry[0].top-geometry[2].top)<=1,`all three filters stay on one row ${width}`);
    if(width>=1280)assert.ok(geometry.every(value=>value.width>=value.requiredWidth-1),`desktop labels are complete at ${width}`);
    if(width<=390){
      assert.ok(geometry.some(value=>value.available<value.textWidth),"small-screen labels need truncation");
      assert.ok(geometry.every(value=>value.ellipsis==='ellipsis'&&['hidden','clip'].includes(value.overflow)),`small-screen labels have ellipsis: ${JSON.stringify(geometry)}`);
      assert.ok(Math.max(...geometry.map(value=>value.width))-Math.min(...geometry.map(value=>value.width))<2,"small containers use three equal columns");
    }
    for(const select of selects){await select.scrollIntoViewIfNeeded();await select.focus();assert.equal(await select.evaluate(element=>document.activeElement===element),true);}
    const filename=`unit-filters-${width}.png`;await page.screenshot({path:path.join(evidence,filename),fullPage:true});screenshots.push(filename);
    checks.push({width,labels:geometry.map(({label,width,requiredWidth,textWidth,available})=>({label,width,requiredWidth,textWidth,available}))});
  }
  await selects[0].selectOption("big-1");
  assert.equal(await selects[1].inputValue(),"");assert.equal(await selects[2].inputValue(),"");
  await selects[1].selectOption("mid-1");await selects[2].selectOption("small-1");
  await page.getByText("짧은 단원 합성 문항",{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.assessmentTeacherFixture.writes),[]);
  assert.deepEqual(errors,[]);
  console.log("PASS real QuizEditor filters and example passage: example beneath body and example-only question; dynamic selected-label widths, full Korean labels with room, bounded ellipsis, three-column mobile layout, accessible names/focus, cascading selection and filtered question list; 1920/1440/1280/768/390/320px");
}finally{
  await browser.close();server.close();
  await fs.writeFile(path.join(evidence,"result.json"),JSON.stringify({checks,errors,screenshots},null,2));
  console.log(evidence);
}
