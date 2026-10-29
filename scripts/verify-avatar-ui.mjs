/** Local-only avatar fixture. Interact through the browser UI; no live Firebase calls. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(
  await fs.readFile(path.join(root, "functions/avatarCatalog.json"), "utf8"),
);
assert.equal(
  new Set(catalog.items.map((item) => item.id)).size,
  catalog.items.length,
  "Unique catalog IDs",
);
const slots = [...new Set(catalog.items.map((item) => item.slot))];
for (const character of ["girl", "boy"]) {
  for (const slot of slots)
    assert(
      catalog.items.some(
        (item) =>
          item.slot === slot &&
          item.price === 0 &&
          item.characters.includes(character),
      ),
      `${character}/${slot} has a free choice`,
    );
  const preview = await fs.readFile(
    path.join(root, `public/avatar/v1/${character}-preview-v2.webp`),
  );
  assert.equal(
    preview.subarray(8, 12).toString(),
    "WEBP",
    "Static preview format",
  );
  assert(preview.length < 64000, "Static preview budget");
}
console.log(
  `PASS: ${catalog.items.length} stable catalog items, free coverage for both characters and compatible saved-image fixtures.`,
);
if (!process.argv.includes("--serve")) process.exit(0);

const evidence = await fs.mkdtemp(path.join(os.tmpdir(), "westory-avatar-ui-"));
const mock = `
const authState={currentUser:{uid:'qa-student'},authGeneration:1,configReady:true};
export const useAuth=()=>authState;
export const auth={currentUser:null};
export const getHistoryDictionaryCallable=()=>{throw Error('Production calls are disabled in this fixture')};
export const getStudentWisState=()=>{throw Error('Production calls are disabled in this fixture')};
export const getStudentPointWallet=getStudentWisState;
export const getWisHallOfFameGradeLeaderboard=snapshot=>snapshot.entries;
export const getPointRankDefaultEmojiValue=()=> '😀';
export const getPointRankDisplay=()=>({enabled:true,label:'선비',themeName:'조선',description:'합성 검증 등급',badgeClass:'border-gray-200 bg-gray-50 text-gray-900'});
export const getWisRankingPreview=async()=>{window.avatarQa.rankingReads++;return{snapshot:{entries:window.avatarQa.entries},rankPolicy:{}}};
`;
const entry = `
import React,{useState,useRef,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {HashRouter} from 'react-router-dom';
import Ranking from './src/components/common/WisRankingPanel';
import {AvatarStudio} from './src/features/avatar/AvatarStudio';
import AvatarStage from './src/features/avatar/AvatarStage';
import {AppToastProvider} from './src/components/common/AppToastProvider';
import {defaultAvatarLook,AVATAR_ITEMS} from './src/features/avatar/catalog';
import './src/assets/index.css';
const qa=window.avatarQa={rankingReads:0,purchases:[],saves:[],reports:[],errors:[],entries:Array.from({length:5},(_,i)=>({uid:'qa-'+i,studentName:'검증학생'+(i+1),grade:'3',class:String(i+1),number:'1',cumulativeEarned:4420-i*500,currentBalance:500,rank:i+1,avatar:{look:defaultAvatarLook(i%2?'boy':'girl'),lookHash:'qa-'+i,revision:1,...(i<2?{thumbnailUrl:'/avatar/v1/'+(i%2?'boy':'girl')+'-preview-v2.webp'}:{})}}))};
window.addEventListener('error',e=>qa.errors.push(e.message));window.addEventListener('unhandledrejection',e=>qa.errors.push(String(e.reason)));
let saved={schemaVersion:1,catalogVersion:1,look:defaultAvatarLook(),revision:0,lookHash:'fixture',ownedItemIds:[]},balance=500;
const adapter={load:async()=>({avatar:saved,balance}),purchase:async id=>{const item=AVATAR_ITEMS.find(i=>i.id===id);if(balance<item.price)throw Error('Insufficient fixture funds');const owned=saved.ownedItemIds.includes(id);const charge=owned?0:item.price;balance-=charge;saved={...saved,ownedItemIds:[...new Set([...saved.ownedItemIds,id])]};qa.purchases.push({id,charge,balance});return{itemId:id,charged:charge,avatar:saved,wallet:{balance},alreadyOwned:owned,duplicate:false}},save:async(look,revision,thumbnailUrl)=>{if(revision!==saved.revision)throw Error('Fixture revision mismatch');saved={...saved,look,revision:revision+1,thumbnailUrl};const bitmap=await createImageBitmap(await(await fetch(thumbnailUrl)).blob());const probe=document.createElement('canvas');probe.width=bitmap.width;probe.height=bitmap.height;const context=probe.getContext('2d');context.drawImage(bitmap,0,0);const cornerAlpha=context.getImageData(0,0,1,1).data[3];bitmap.close();qa.saves.push({look,revision:saved.revision,thumbnailBytes:thumbnailUrl.length,cornerAlpha});qa.entries[0].avatar=saved;return saved}};
function measure(){const sample=document.getElementById('sample'),list=sample.querySelector('.wis-ranking-list-scroll'),right=sample.querySelector('.wis-ranking-avatar-aside');const rows=[...sample.querySelectorAll('.wis-ranking-row')];const leftWidth=list?.getBoundingClientRect().width,rightWidth=right?.getBoundingClientRect().width;const report={mode:sample.dataset.mode,viewport:innerWidth,panelWidth:sample.clientWidth,leftWidth,rightWidth,twoToOneColumns:!list||Math.abs(leftWidth-2*rightWidth)<1,rowCount:rows.length,leftFields:rows.map(r=>({name:r.querySelector('.wis-ranking-name')?.textContent,classroom:r.querySelector('.wis-ranking-classroom')?.textContent,rank:r.querySelector('.wis-ranking-rank-badge')?.textContent,amount:r.querySelector('.wis-ranking-score')?.textContent})),overflow:sample.scrollWidth>sample.clientWidth,documentOverflow:document.documentElement.scrollWidth>innerWidth,canvases:sample.querySelectorAll('canvas').length,modelRequests:performance.getEntriesByType('resource').filter(r=>r.name.includes('.glb')).length,rankingReads:qa.rankingReads,imagesValid:[...sample.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth>0),purchases:qa.purchases,saves:qa.saves,errors:qa.errors};qa.reports.push(report);fetch('/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});return report}
function PoseCheck(){const[look,setLook]=useState(defaultAvatarLook()),[active,setActive]=useState(false),[ready,setReady]=useState(false),[stats,setStats]=useState(null),[cycle,setCycle]=useState(false);const controller=useRef(null);const poses=AVATAR_ITEMS.filter(i=>i.slot==='pose');useEffect(()=>{if(!cycle)return;let index=0;const timer=setInterval(()=>{setLook(l=>({...l,pose:poses[index++%poses.length].value}))},1500);return()=>clearInterval(timer)},[cycle]);return <section><div className="qa-controls"><button onClick={()=>{setActive(v=>!v);setReady(false);controller.current=null}}>{active?'렌더러 해제':'렌더러 시작'}</button><button onClick={()=>{setLook(defaultAvatarLook(look.character==='girl'?'boy':'girl'));setReady(false)}}>남녀 전환</button><button onClick={()=>setCycle(v=>!v)}>{cycle?'포즈 순회 정지':'6포즈 순회'}</button><button onClick={()=>setStats(controller.current?.stats||null)}>렌더링 통계</button>{poses.map(p=><button key={p.id} onClick={()=>setLook(l=>({...l,pose:p.value}))}>{p.label}</button>)}</div><p>상태: {active?(ready?'준비 완료':'로딩 중'):'해제됨'} · 포즈: {look.pose}</p><div style={{height:420,position:'relative',background:'#f8fafc'}}>{active&&<AvatarStage look={look} active onReady={c=>{controller.current=c;setReady(true)}} onError={e=>qa.errors.push(e.message)}/>}</div><pre>{JSON.stringify(stats,null,2)}</pre></section>}
function App(){const[width,setWidth]=useState(768),[mode,setMode]=useState('ranking'),[audience,setAudience]=useState('student'),[report,setReport]=useState(null);return <AppToastProvider><main style={{padding:16}}><h1>아바타 출시 검증 · 합성 데이터</h1><div className="qa-controls">{[320,390,768,1280].map(w=><button key={w} onClick={()=>setWidth(w)}>폭 {w}</button>)}<button onClick={()=>setAudience(a=>a==='student'?'teacher':'student')}>{audience==='student'?'교사 문맥':'학생 문맥'}</button><button onClick={()=>setMode('ranking')}>순위 화면</button><button onClick={()=>setMode('studio')}>꾸미기 화면</button><button onClick={()=>setMode('poses')}>포즈·취소 검사</button><button onClick={()=>setReport(measure())}>현재 검사</button></div><pre id="qa-report">{JSON.stringify(report,null,2)}</pre><div id="sample" data-mode={mode} className={audience==='teacher'?'teacher-dashboard-ranking':'student-dashboard-ranking'} style={{width,maxWidth:'100%'}}>{mode==='ranking'?<Ranking config={{year:'2026',semester:'2'}} hallOfFamePath={'/'+audience+'/points'}/>:mode==='studio'?<AvatarStudio key={audience} adapter={adapter} access={audience}/>:<PoseCheck/>}</div></main></AppToastProvider>}
createRoot(document.getElementById('root')).render(<HashRouter><App/></HashRouter>);
`;
const bundle = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  splitting: true,
  write: false,
  format: "esm",
  platform: "browser",
  outdir: evidence,
  loader: { ".svg": "dataurl", ".webp": "dataurl" },
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.BASE_URL": '"/"',
  },
  plugins: [
    {
      name: "local-avatar-fixture",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /\/(AuthContext|wisRankingPreview|wisHallOfFame|pointRanks|studentWis|historyDictionarySession|firebase)$/,
          },
          (args) => ({ path: args.path, namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: mock,
          loader: "js",
        }));
      },
    },
  ],
});
for (const file of bundle.outputFiles)
  await fs.writeFile(file.path, file.contents);
let tailwind;
try {
  tailwind = await fs.readFile(
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  );
} catch {
  const response = await fetch("https://cdn.tailwindcss.com");
  assert(response.ok, "Tailwind fixture dependency");
  tailwind = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(path.join(evidence, "tailwind.js"), tailwind);
}
const files = new Map(
  bundle.outputFiles.map((file) => [
    "/" + path.basename(file.path),
    file.contents,
  ]),
);
files.set("/tailwind.js", tailwind);
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>아바타 출시 검증</title><script src="/tailwind.js"></script><link rel="stylesheet" href="/stdin.css"><style>body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}h1{font-size:20px;font-weight:700;margin-bottom:12px}.qa-controls{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}.qa-controls button{min-height:44px;padding:8px 12px;background:white;border:1px solid #cbd5e1;border-radius:8px}pre{white-space:pre-wrap;font-size:12px}#qa-report{max-height:120px;overflow:auto}#sample{min-height:360px}</style><div id="root"></div><script type="module" src="/stdin.js"></script></html>';
await fs.writeFile(path.join(evidence, "fixture.html"), html);
let resultCount = 0;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST" && url.pathname === "/result") {
      let value = "";
      for await (const chunk of req) {
        value += chunk;
        if (value.length > 32768) {
          res.writeHead(413).end();
          return;
        }
      }
      await fs.writeFile(
        path.join(evidence, `browser-result-${++resultCount}.json`),
        JSON.stringify(JSON.parse(value), null, 2),
      );
      res.end("saved");
      return;
    }
    let data = files.get(url.pathname),
      type = url.pathname.endsWith(".css") ? "text/css" : "text/javascript";
    if (/^\/avatar\/v[12]\//.test(url.pathname)) {
      const assetRoot = path.resolve(root, "public/avatar");
      const target = path.resolve(
        root,
        "public",
        "." + decodeURIComponent(url.pathname),
      );
      if (!target.startsWith(assetRoot + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      data = await fs.readFile(target);
      type = url.pathname.endsWith(".webp")
        ? "image/webp"
        : url.pathname.endsWith(".svg")
          ? "image/svg+xml"
          : url.pathname.endsWith(".png")
            ? "image/png"
            : url.pathname.endsWith(".json")
              ? "application/json"
              : "application/octet-stream";
    } else if (url.pathname === "/") {
      data = html;
      type = "text/html";
    }
    if (!data) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      type + (type.startsWith("text/") ? ";charset=utf-8" : ""),
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:",
    );
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(
    Number(process.env.AVATAR_QA_PORT || 4181),
    "127.0.0.1",
    resolve,
  );
});
console.log(`CUA_FIXTURE_URL=http://127.0.0.1:${server.address().port}/`);
console.log(`EVIDENCE=${evidence}`);
