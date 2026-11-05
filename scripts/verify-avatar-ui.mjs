/** Local-only avatar fixture. Interact through the browser UI; no live Firebase calls. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
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
const checkRankingLayout = process.argv.includes("--check-ranking-layout");
if (!process.argv.includes("--serve") && !checkRankingLayout) process.exit(0);

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
import './src/pages/student/studentDashboard.css';
import './src/pages/teacher/teacherDashboard.css';
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
    Number(process.env.AVATAR_QA_PORT || (checkRankingLayout ? 0 : 4181)),
    "127.0.0.1",
    resolve,
  );
});
console.log(`CUA_FIXTURE_URL=http://127.0.0.1:${server.address().port}/`);
console.log(`EVIDENCE=${evidence}`);

if (checkRankingLayout) {
  const require = createRequire(import.meta.url);
  let playwright;
  try {
    playwright = require("playwright");
  } catch {
    playwright = require(
      process.env.PLAYWRIGHT_MODULE_PATH ||
        path.join(
          os.homedir(),
          ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
        ),
    );
  }
  const browser = await playwright.chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  });
  try {
    const page = await browser.newPage();
    const emulation = await page.context().newCDPSession(page);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator(".wis-ranking-row").first().waitFor();
    // Use the application's crown glyph while keeping browser traffic local.
    const iconCache = path.join(os.tmpdir(), "westory-qa-fa-solid-6.4.0.woff2");
    const iconFont = await fs.readFile(iconCache).catch(async () => {
      const response = await fetch(
        "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2",
      );
      assert(response.ok, "Font Awesome fixture dependency");
      const bytes = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(iconCache, bytes);
      return bytes;
    });
    await page.addStyleTag({
      content: `
      @font-face {font-family: QaSolid; font-weight: 900; src: url(data:font/woff2;base64,${iconFont.toString("base64")}) format("woff2")}
      .fas.fa-crown {font: normal 900 12px/1 QaSolid}
      .fa-crown::before {content: "\\f521"}
    `,
    });
    assert(
      await page.evaluate(
        async () => (await document.fonts.load("900 12px QaSolid")).length > 0,
      ),
    );
    await page.evaluate(() => {
      window.avatarQa.entries[0].studentName = "가나다";
    });
    let minimumRankClearance = Infinity;
    const typographySamples = [];
    for (const role of ["teacher", "student"]) {
      await page
        .getByRole("button", {
          name: role === "teacher" ? "교사 문맥" : "학생 문맥",
        })
        .click();
      await page
        .locator(".wis-ranking-name")
        .filter({ hasText: "가나다" })
        .waitFor();
      for (const [viewport, cardWidth, touch = false] of [
        [320, 320, true],
        [390, 390, true],
        [768, 768, true],
        [1024, 650, true],
        [1024, 650],
        [1024, 480, true],
        [1280, 480, true],
        [1280, 480],
        [1366, 500],
        [1440, 499],
        [1440, 533],
        [1440, 640],
        [1440, 1000],
        [1890, 660],
        [1890, 694],
      ]) {
        const mobile = viewport <= 1023 || (touch && viewport <= 1280);
        await page.setViewportSize({ width: viewport, height: 768 });
        await emulation.send("Emulation.setTouchEmulationEnabled", {
          enabled: touch,
        });
        assert.equal(
          await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
          touch,
        );
        await page.evaluate((mobile) => {
          const entries = window.avatarQa.entries;
          ["가나다", "라마바", "사아자", "차카타", "파하가"].forEach(
            (name, i) => {
              entries[i].studentName = name;
            },
          );
          entries[1].studentName = "아주긴이름으로등록된합성학생";
          entries[1].class = "12";
          entries[1].cumulativeEarned = 987654321098;
          entries[2].cumulativeEarned = 12345;
          document.querySelectorAll(".wis-ranking-row")[mobile ? 1 : 0].click();
        }, mobile);
        await page.locator("#sample").evaluate(
          (sample, { cardWidth, role }) => {
            sample.classList.toggle(
              "teacher-weekly-dashboard",
              role === "teacher",
            );
            sample.classList.toggle(
              "student-portal-dashboard",
              role === "student",
            );
            sample.style.width = cardWidth + "px";
            sample.style.paddingInline = "0";
          },
          { cardWidth, role },
        );
        if (viewport === 390) {
          const first = page.locator(".wis-ranking-row").first();
          await first.focus();
          await first.evaluate((row) =>
            Promise.all(
              row.getAnimations({ subtree: true }).map((a) => a.finished),
            ),
          );
        }
        const geometry = await page
          .locator(".wis-ranking-row")
          .evaluateAll((rows) =>
            rows.map((row) => {
              const rect = (s) =>
                row.querySelector(".wis-ranking-" + s).getBoundingClientRect();
              const center = (r) => (r.top + r.bottom) / 2;
              const medal = rect("rank-medal"),
                name = rect("name"),
                badge = rect("rank-badge"),
                score = rect("score");
              const crown = row
                .querySelector(".wis-ranking-crown")
                ?.getBoundingClientRect();
              const list = row.closest(".wis-ranking-list-scroll");
              const textRect = (element) => {
                const range = document.createRange();
                range.selectNodeContents(element);
                return range.getBoundingClientRect();
              };
              const classroom = row.querySelector(".wis-ranking-classroom");
              const amount = row.querySelector(".wis-ranking-score > span");
              const amountText = document.createRange();
              amountText.selectNodeContents(amount);
              const amountBounds = textRect(amount);
              const amountLines = new Set(
                Array.from(amountText.getClientRects())
                  .filter((r) => r.width > 0)
                  .map((r) => Math.round(r.top)),
              );
              return {
                rowHeight: row.offsetHeight,
                namePx: parseFloat(
                  getComputedStyle(row.querySelector(".wis-ranking-name"))
                    .fontSize,
                ),
                classPx: parseFloat(getComputedStyle(classroom).fontSize),
                classVisible: classroom.offsetWidth > 0,
                amountPx: parseFloat(getComputedStyle(amount).fontSize),
                amountWeight: getComputedStyle(amount).fontWeight,
                amountLines: amountLines.size,
                fullAmount: amount.textContent,
                spokenAmount: row
                  .querySelector(".wis-ranking-score")
                  .getAttribute("aria-label"),
                titleAmount: row.querySelector(".wis-ranking-score").title,
                scoreLeft: score.left,
                amountFits:
                  amountBounds.left >=
                    amount.getBoundingClientRect().left - 1 &&
                  amountBounds.right <=
                    amount.getBoundingClientRect().right + 1 &&
                  amountBounds.right <= rect("score").right + 1 &&
                  amount.scrollWidth <= amount.clientWidth + 1,
                fullName: row.querySelector(".wis-ranking-name").title,
                tracks: getComputedStyle(row)
                  .gridTemplateColumns.split(" ")
                  .map(parseFloat),
                classroomToScore:
                  Math.max(
                    amountBounds.left,
                    amount.getBoundingClientRect().left,
                  ) - textRect(classroom).right,
                classroomCentered:
                  Math.abs(
                    rect("classroom").left +
                      rect("classroom").right -
                      (textRect(classroom).left + textRect(classroom).right),
                  ) < 1,
                scoreVisible: score.right <= list.getBoundingClientRect().right,
                rankClearance:
                  rect("profile").left -
                  Math.max(medal.right, crown?.right ?? 0),
                crownWidth: crown?.width,
                oneLine: [name, badge, score].every(
                  (r) => Math.abs(center(r) - center(medal)) < 2,
                ),
                separated:
                  medal.right <= name.left &&
                  name.right <= badge.left + 1 &&
                  badge.right <= score.left + 1,
                overflow: list.scrollWidth > list.clientWidth + 1,
                visibleName: name.width,
                regularTextFits: ["name", "score > span"].every((s) => {
                  const element = row.querySelector(".wis-ranking-" + s);
                  return (
                    textRect(element).width <=
                    element.getBoundingClientRect().width
                  );
                }),
              };
            }),
          );
        if (
          [320, 390, 768].includes(viewport) ||
          cardWidth === 533 ||
          cardWidth === 694
        ) {
          await page.locator(".wis-ranking-panel").screenshot({
            path: path.join(evidence, `${role}-${viewport}-${cardWidth}.png`),
          });
        }
        assert.equal(geometry.length, 5);
        if (viewport >= 768) {
          const large = geometry[1];
          assert(
            geometry.every(
              (row) =>
                row.namePx >= 16 &&
                row.classPx >= 13 &&
                row.classVisible &&
                row.amountPx >= 19 &&
                row.amountWeight === "900" &&
                row.classroomToScore >= 8 &&
                row.amountLines === 1 &&
                Math.abs(row.scoreLeft - geometry[0].scoreLeft) < 1,
            ),
            `${role} ${viewport}px tablet/desktop typography`,
          );
          assert.equal(large.fullName, "아주긴이름으로등록된합성학생");
          assert.equal(large.fullAmount, "987,654,321,098");
          assert(
            geometry[0].amountFits && geometry[2].amountFits,
            `${role} ${viewport}/${cardWidth}px ordinary amounts: ${JSON.stringify(geometry[2])}`,
          );
          assert(
            large.titleAmount === large.fullAmount + " 위스" &&
              large.spokenAmount === large.titleAmount &&
              large.scoreVisible &&
              !large.overflow,
            `${role} ${viewport}/${cardWidth}px long amount: ${JSON.stringify(large)}`,
          );
          typographySamples.push({
            role,
            viewport,
            cardWidth,
            touch,
            name: large.namePx,
            classroom: large.classPx,
            amount: large.amountPx,
            amountLeft: large.scoreLeft,
            minimumGap: Math.min(
              ...geometry.map((row) => row.classroomToScore),
            ),
          });
        } else {
          assert(
            geometry.every(
              (row) =>
                row.rowHeight === 44 &&
                row.amountLines === 1 &&
                !row.classVisible,
            ),
            "Narrow phone rows keep their single-line compact layout",
          );
        }
        assert(geometry.slice(0, 3).every((r) => r.crownWidth > 0));
        if (mobile) {
          minimumRankClearance = Math.min(
            minimumRankClearance,
            ...geometry.map((r) => r.rankClearance),
          );
          assert(
            geometry.every((r) => r.rankClearance >= 8),
            `${role} ${viewport}px rank clearance: ${geometry.map((r) => r.rankClearance)}`,
          );
          assert(geometry.every((r) => !r.overflow));
        } else {
          assert(
            geometry.every(
              (r) =>
                r.rowHeight === 52 &&
                r.tracks.length === 4 &&
                r.tracks[0] === 24 &&
                r.classroomCentered &&
                r.classroomToScore >= 8 &&
                r.scoreVisible &&
                !r.overflow,
            ),
            `${role} ${viewport}/${cardWidth}px desktop columns: ${JSON.stringify(geometry[0])}`,
          );
          if (cardWidth >= 694) {
            assert(
              geometry.every(
                (r) =>
                  Math.abs(r.tracks[1] - r.tracks[2]) < 1 &&
                  Math.abs(r.tracks[2] - r.tracks[3]) < 1,
              ),
              "Roomy desktop cards preserve three equal columns",
            );
          }
        }
        assert(
          geometry.every((r) => r.oneLine && r.separated && r.visibleName > 0),
          `${role} ${viewport}px: ${JSON.stringify(geometry)}`,
        );
        assert(
          geometry[0].regularTextFits,
          `Ordinary name and four-digit amount fit at ${viewport}px ${JSON.stringify(geometry[0])}`,
        );
      }
      await page.locator(".wis-ranking-row").last().focus();
      await page.keyboard.press("Enter");
      assert.equal(
        await page
          .locator(".wis-ranking-row")
          .last()
          .getAttribute("aria-pressed"),
        "true",
      );
    }
    console.log(
      `PASS: student and teacher rankings at 320–1890px. Mobile and tablet rank/emoji clearance ≥${minimumRankClearance.toFixed(1)}px. Tablet/desktop amounts share one right-aligned column; five-digit amounts fit and full 12-digit values remain accessible. Keyboard selection works.`,
    );
    await fs.writeFile(
      path.join(evidence, "ranking-typography.json"),
      JSON.stringify(typographySamples, null, 2),
    );
  } finally {
    await browser.close();
    server.close();
  }
}
