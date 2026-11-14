/** Real Think Cloud pages + lifecycle with synthetic transport, isolated from production. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const out =
  process.env.THINK_CLOUD_EVIDENCE ||
  path.join(root, "output/think-cloud-20261114");
await fs.mkdir(out, { recursive: true });
const serviceFile = path.join(
  root,
  "scripts/fixtures/ThinkCloudFixtureService.ts",
);
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';import Teacher from './src/pages/teacher/ManageThinkCloud';import Student from './src/pages/student/lesson/ThinkCloud';import './assets/css/style.css';import './src/assets/index.css';import './src/components/common/portalPage.css';const student=new URLSearchParams(location.search).get('role')==='student';createRoot(document.getElementById('root')).render(<HashRouter><div className="qa-shell"><aside className="qa-rail"><strong>Westory</strong><span>생각모아</span></aside><div className="qa-content">{student?<Student/>:<Teacher/>}</div></div></HashRouter>);`;
const result = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(out, "fixture.js"),
  assetNames: "assets/[name]-[hash]",
  loader: { ".woff2": "file", ".svg": "dataurl", ".webp": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "synthetic-think-transport",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /(?:^|\/)contexts\/AuthContext$|(?:^|\/)common\/AppToastProvider$|^\.\/AppToastProvider$|^firebase\/firestore$|(?:^|\/)lib\/(firebase|points|appEvents)$|^\.\/(firebase|historyDictionarySession|wisEconomyClient)$/,
          },
          () => ({ path: serviceFile }),
        );
      },
    },
  ],
});
const files = new Map(
  result.outputFiles.map((file) => [
    "/" + path.relative(out, file.path).replaceAll("\\", "/"),
    file.contents,
  ]),
);
let css = Buffer.from(files.get("/fixture.css"))
  .toString("utf8")
  .replace(/@import\s+url\([^)]+\);?/g, "");
css += `\n.qa-shell{display:flex;min-height:100vh;background:#f9fafb}.qa-rail{width:232px;flex-shrink:0;padding:32px 24px;border-right:1px solid #e5e7eb;display:flex;flex-direction:column;gap:32px;color:#172554}.qa-rail strong{font-size:26px}.qa-content{flex:1;min-width:0}.qa-content>.think-workspace{min-height:100vh}@media(max-width:1023px){.qa-rail{display:none}}`;
files.set("/fixture.css", Buffer.from(css));
let tailwind;
const twPath =
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
  path.join(os.tmpdir(), "westory-qa-tailwind.js");
try {
  tailwind = await fs.readFile(twPath);
} catch {
  const response = await fetch("https://cdn.tailwindcss.com", {
    signal: AbortSignal.timeout(30000),
  });
  assert(response.ok);
  tailwind = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(twPath, tailwind);
}
files.set("/tailwind.js", tailwind);
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
const server = http.createServer((req, res) => {
  const name = new URL(req.url, "http://localhost").pathname;
  const type = name.endsWith(".js")
    ? "text/javascript"
    : name.endsWith(".css")
      ? "text/css"
      : name.endsWith(".woff2")
        ? "font/woff2"
        : "text/html";
  res.setHeader("Content-Type", type);
  res.end(files.get(name) || html);
});
await new Promise((resolve) =>
  server.listen(
    Number(process.env.THINK_CLOUD_PORT || 0),
    "127.0.0.1",
    resolve,
  ),
);
const origin = `http://127.0.0.1:${server.address().port}`;
console.log(`Think Cloud fixture: ${origin}/?role=student`);
if (process.argv.includes("--serve")) {
  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await new Promise((resolve) => server.close(resolve));
  process.exit(0);
}
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
  headless: true,
});
const errors = [],
  checks = [];
async function pageFor(role, width = 1280, extra = "") {
  const context = await browser.newContext({
    viewport: { width, height: width === 768 ? 1024 : 900 },
    reducedMotion: "reduce",
  });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/?role=${role}${extra}`);
  await page.waitForFunction(() => window.thinkQa?.calls.length > 0);
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}
async function stats(page) {
  return page.evaluate(() => ({
    reads: window.thinkQa.calls.filter(
      (row) => row.payload.projection === "think-cloud",
    ).length,
    metadata: window.thinkQa.calls.filter(
      (row) => row.payload.projection === "think-cloud-command",
    ).length,
    deltas: window.thinkQa.calls.filter(
      (row) => row.payload.projection === "think-cloud-delta",
    ).length,
    writes: window.thinkQa.writes.length,
    rewards: window.thinkQa.rewards,
    animations: window.thinkQa.animations.length,
  }));
}
async function settle(page) {
  await page.waitForTimeout(650);
}
async function openActive(page) {
  await page
    .getByRole("button", { name: /조선 하면 떠오르는/ })
    .first()
    .click();
  await settle(page);
}
async function fit(page, label) {
  const size = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  assert(
    size.scroll <= size.client + 1,
    `${label}: horizontal overflow ${JSON.stringify(size)}`,
  );
  const headers = await page.locator(".think-header").evaluateAll((nodes) =>
    nodes.map((node) => {
      const s = getComputedStyle(node);
      return {
        background: s.backgroundColor,
        shadow: s.boxShadow,
        position: s.position,
      };
    }),
  );
  assert(
    headers.every(
      (h) =>
        h.background === "rgba(0, 0, 0, 0)" &&
        h.shadow === "none" &&
        h.position === "static",
    ),
    `${label}: transparent header contract`,
  );
}
async function radialGeometry(page, label) {
  const geometry = await page.locator('.think-word-board__words').evaluate(list => {
    const origin = list.getBoundingClientRect();
    return { width: origin.width, height: origin.height, layout: list.dataset.layout,
      boxes: [...list.querySelectorAll('.think-word')].map(node => {
        const b = node.getBoundingClientRect();
        return { text: node.dataset.word, x: b.left - origin.left, y: b.top - origin.top,
          w: b.width, h: b.height, color: getComputedStyle(node).color,
          transform: getComputedStyle(node).transform };
      }) };
  });
  assert.equal(geometry.layout, 'radial', label);
  const {boxes, width, height} = geometry;
  const first = boxes[0];
  assert(Math.abs(first.x + first.w / 2 - width / 2) < 1, `${label}: first word centered horizontally`);
  assert(Math.abs(first.y + first.h / 2 - height / 2) < 1, `${label}: first word centered vertically`);
  for (let i=0;i<boxes.length;i++) {
    const a=boxes[i];
    assert(a.x >= -1 && a.y >= -1 && a.x+a.w <= width+1 && a.y+a.h <= height+1, `${label}: bounded ${a.text}`);
    assert.equal(a.transform, 'none', `${label}: no remaining rotation/movement`);
    for (let j=i+1;j<boxes.length;j++) {
      const b=boxes[j];
      assert(a.x+a.w <= b.x+0.5 || b.x+b.w <= a.x+0.5 || a.y+a.h <= b.y+0.5 || b.y+b.h <= a.y+0.5, `${label}: overlap ${a.text}/${b.text}`);
    }
  }
  assert(new Set(boxes.map(b=>b.color)).size >= 5, `${label}: diverse blue–orange colors including single responses`);
  assert(boxes.some(b=>{const c=b.color.match(/\d+/g).map(Number);return c[0]>c[2]*1.5 && c[1]>c[2];}), `${label}: warm orange present`);
  assert(boxes.some(b=>b.y+b.h/2 < height/2-25) && boxes.some(b=>b.y+b.h/2 > height/2+25), `${label}: spread above and below the center`);
  if (width > 500) assert(boxes.some(b=>b.x+b.w/2 < width/2-50) && boxes.some(b=>b.x+b.w/2 > width/2+50), `${label}: spread to both sides`);
}
try {
  {
    const {context,page}=await pageFor('student',390);
    await openActive(page);
    await page.mouse.move(0,0);
    const before=await stats(page);
    const target=page.locator('.think-word__button').first();
    const initial=await target.evaluate(el=>({matrix:getComputedStyle(el).transform,name:getComputedStyle(el).animationName,iterations:getComputedStyle(el).animationIterationCount,state:getComputedStyle(el).animationPlayState,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches}));
    assert(initial.reduced && initial.name==='think-word-float' && initial.iterations==='infinite' && initial.state==='running','float runs continuously under reduced motion');
    await page.waitForTimeout(800);
    assert.notEqual(await target.evaluate(el=>getComputedStyle(el).transform),initial.matrix,'word actually moves over time');
    const drift=await page.evaluate(()=>{
      const nodes=[...document.querySelectorAll('.think-word__button')];
      const animations=document.getAnimations().filter(a=>a.animationName==='think-word-float');
      const durations=new Set(animations.map(a=>a.effect.getTiming().duration));
      const collisions=[];
      let maxX=0,maxY=0;
      for(let phase=0;phase<16;phase++) {
        animations.forEach((a,index)=>{a.pause();a.currentTime=phase*390+index*137;});
        const boxes=nodes.map(n=>{const m=new DOMMatrixReadOnly(getComputedStyle(n).transform);maxX=Math.max(maxX,Math.abs(m.m41));maxY=Math.max(maxY,Math.abs(m.m42));return n.getBoundingClientRect();});
        for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++) {
          const a=boxes[i],b=boxes[j];
          if(a.right>b.left+.5&&b.right>a.left+.5&&a.bottom>b.top+.5&&b.bottom>a.top+.5)collisions.push([phase,i,j]);
        }
      }
      animations.forEach(a=>a.play());
      return {maxX,maxY,collisions,durations:[...durations]};
    });
    assert.deepEqual(drift.collisions,[],'floating buttons never collide across sampled phases');
    assert(drift.maxX<=2.01 && drift.maxY<=3.01 && drift.durations.length>3,'bounded movement with independent rhythms');
    assert.equal((await stats(page)).reads,before.reads,'floating adds no whole-state reads');
    assert.equal((await stats(page)).deltas,before.deltas,'floating adds no delta reads');
    const hoverBox=await target.boundingBox();
    await page.mouse.move(hoverBox.x+hoverBox.width/2,hoverBox.y+hoverBox.height/2);
    assert.equal(await target.evaluate(el=>getComputedStyle(el).animationPlayState),'paused','pointer interaction stays still');
    await page.mouse.move(0,0);
    await target.focus();
    assert.equal(await target.evaluate(el=>getComputedStyle(el).animationPlayState),'paused','keyboard interaction stays still');
    await page.locator('h1').click();
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
    assert.equal(await target.evaluate(el=>getComputedStyle(el).animationPlayState),'paused','hidden tab pauses float');
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.think-word__button')).animationPlayState==='running');
    await page.evaluate(()=>{const spacer=document.createElement('div');spacer.id='qa-float-spacer';spacer.style.height='1500px';document.body.appendChild(spacer);window.scrollTo(0,document.body.scrollHeight);});
    await page.waitForFunction(()=>document.querySelector('.think-word-board').dataset.floating==='off');
    assert.equal(await target.evaluate(el=>getComputedStyle(el).animationPlayState),'paused','offscreen board pauses float');
    await page.evaluate(()=>{document.querySelector('#qa-float-spacer').remove();document.querySelector('.think-word-board').scrollIntoView();});
    await page.waitForFunction(()=>document.querySelector('.think-word-board').dataset.floating==='on');
    await page.getByRole('button',{name:'움직임 끄기'}).click();
    assert.equal(await target.evaluate(el=>getComputedStyle(el).animationName),'none','manual off removes loop');
    await page.getByRole('button',{name:'움직임 켜기'}).click();
    await page.emulateMedia({media:'print'});
    assert.equal(await target.evaluate(el=>getComputedStyle(el).animationName),'none','print removes loop');
    await page.emulateMedia({media:'screen'});
    checks.push({scenario:'continuous reduced-motion float, collision bounds, interaction/visibility/offscreen/manual/print pause',drift});
    await context.close();
  }
  {
    const {context, page} = await pageFor('student');
    await openActive(page);
    await page.evaluate(() => {
      window.thinkQa.responses.active.length = 0;
      window.thinkQa.classState.responseRevision = 0;
      window.dispatchEvent(new Event('focus'));
    });
    await page.waitForFunction(() => document.querySelectorAll('.think-word').length === 0);
    const before = await stats(page);
    for (const text of ['시작', '연결', '발견', '가능성', '호기심', '도전']) {
      await page.evaluate(text=>window.thinkQa.add(text), text);
      await page.locator(`.think-word[data-word="${text}"]`).waitFor();
      await settle(page);
      const center = await page.locator('.think-word[data-word="시작"]').evaluate(node => {
        const b=node.getBoundingClientRect(), stage=node.parentElement.getBoundingClientRect();
        return {x:b.left+b.width/2-stage.left-stage.width/2, y:b.top+b.height/2-stage.top-stage.height/2};
      });
      assert(Math.abs(center.x)<1 && Math.abs(center.y)<1, 'first response stays at the center as new words arrive');
    }
    const colors = await page.locator('.think-word').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.dataset.word,getComputedStyle(n).color])));
    await page.evaluate(()=>window.thinkQa.add('호기심',20));
    await page.waitForFunction(()=>document.querySelector('.think-word[data-word="호기심"]').dataset.count==='21');
    await settle(page);
    const afterColors = await page.locator('.think-word').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.dataset.word,getComputedStyle(n).color])));
    assert.deepEqual(afterColors, colors, 'word colors stay stable when their counts change');
    assert.equal(await page.locator('.think-word').first().getAttribute('data-word'), '시작', 'frequency growth does not reorder birth order');
    assert.equal((await stats(page)).reads, before.reads, 'radial arrivals do not add full reads');
    const beforeResize=await stats(page);
    for (const width of [390,768,1440]) {
      await page.setViewportSize({width,height:900});
      await settle(page);
      await fit(page, `resized ${width}`);
      await radialGeometry(page, `resized ${width}`);
    }
    assert.equal((await stats(page)).reads, beforeResize.reads, 'resizing stays local');
    checks.push({scenario:'center-first incremental arrival, stable colors, live resizing',counts:await stats(page)});
    await context.close();
  }
  {
    const {context,page}=await pageFor('student',768);
    await openActive(page);
    await page.evaluate(()=>{
      window.thinkQa.responses.active.length=0;
      window.thinkQa.classState.responseRevision=0;
      for(let n=0;n<60;n++) window.thinkQa.add(`생각${String(n).padStart(2,'0')}`);
      window.dispatchEvent(new Event('focus'));
    });
    await page.waitForFunction(()=>document.querySelectorAll('.think-word').length===60);
    await settle(page);
    const positions=()=>page.locator('.think-word').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>{
      const r=n.getBoundingClientRect(),s=n.parentElement.getBoundingClientRect();
      return [n.dataset.word,{x:r.left+r.width/2-s.left-s.width/2,y:r.top+r.height/2-s.top-s.height/2}];
    })));
    const before=await positions();
    await page.evaluate(()=>window.thinkQa.add('생각10',69));
    await page.waitForFunction(()=>document.querySelector('.think-word[data-word="생각10"]').dataset.count==='70');
    const overlaps=await page.evaluate(()=>{
      document.getAnimations().forEach(animation=>{animation.pause();animation.currentTime=150;});
      const boxes=[...document.querySelectorAll('.think-word:not([data-word="생각10"]) .think-word__text')].map(n=>({text:n.textContent,r:n.getBoundingClientRect()}));
      const hits=[];
      for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
        const a=boxes[i].r,b=boxes[j].r;
        if(a.right>b.left+.5&&b.right>a.left+.5&&a.bottom>b.top+.5&&b.bottom>a.top+.5)hits.push([boxes[i].text,boxes[j].text]);
      }
      return hits;
    });
    assert.deepEqual(overlaps,[],'unchanged words never cross at the midpoint of a growth animation');
    const after=await positions();
    for(const text of Object.keys(before).filter(t=>t!=='생각10')) {
      assert(Math.abs(before[text].x-after[text].x)<.1 && Math.abs(before[text].y-after[text].y)<.1,`${text}: preserve unaffected position during growth`);
    }
    checks.push({scenario:'60-word growth preserves 59 positions and has no mid-animation crossings'});
    await context.close();
  }
  // Selectors follow the public labels rather than implementation-only state.
  for (const role of ["student", "teacher"])
    for (const width of [320, 390, 768, 1280]) {
      const { context, page } = await pageFor(role, width);
      await settle(page);
      const initial = await stats(page);
      assert.equal(initial.reads, 1, `${role} initial read`);
      await fit(page, `${role} ${width} list`);
      await page.screenshot({
        path: path.join(out, `${role}-${width}-list.png`),
        fullPage: true,
      });
      await openActive(page);
      await fit(page, `${role} ${width} detail`);
      assert.equal(
        (await stats(page)).reads,
        1,
        "same topic open must not read again",
      );
      assert.equal(
        await page.getByText("비공개 이름", { exact: false }).count(),
        0,
        "anonymous identities absent",
      );
      await page.screenshot({
        path: path.join(out, `${role}-${width}-detail.png`),
        fullPage: true,
      });
      await radialGeometry(page, `${role} ${width}`);
      checks.push({ role, width, initial, detail: await stats(page) });
      await context.close();
    }
  {
    const { context, page } = await pageFor("student");
    await openActive(page);
    const initial = await stats(page);
    const began = Date.now();
    await page.evaluate(() => {
      for (let n = 0; n < 20; n++) window.thinkQa.add("실시간");
    });
    await page.waitForFunction(
      () =>
        document.querySelector('.think-word[data-word="실시간"]')?.dataset
          .count === "20",
    );
    const latencyMs = Date.now() - began;
    const burst = await stats(page);
    assert.equal(
      burst.reads,
      initial.reads,
      "burst never reloads all responses",
    );
    assert.equal(
      burst.deltas - initial.deltas,
      1,
      "20 response signals coalesce into one delta",
    );
    assert(
      latencyMs < 2000,
      "synthetic commit to visible response under two seconds",
    );
    await page.clock.install();
    await page.clock.runFor(30000);
    assert.equal((await stats(page)).reads, burst.reads, "idle does not poll");
    assert.equal(
      (await stats(page)).deltas,
      burst.deltas,
      "idle has no delta call",
    );
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(
      await page.evaluate(() => window.thinkQa.listeners.size),
      0,
      "hidden tab releases live listener",
    );
    await page.evaluate(() => window.thinkQa.add("복귀", 3));
    await page.clock.runFor(1000);
    assert.equal(
      (await stats(page)).deltas,
      burst.deltas,
      "hidden response does not read",
    );
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.runFor(1000);
    await page.waitForSelector('.think-word[data-word="복귀"]');
    checks.push({
      scenario: "live burst, idle and reconnect",
      latencyMs,
      counts: await stats(page),
    });
    await context.close();
  }
  {
    const { context, page } = await pageFor("student");
    await openActive(page);
    const word = page.locator(
      '.think-word[data-word="한글"] .think-word__text',
    );
    const beforeSize = await word.evaluate((el) =>
      parseFloat(getComputedStyle(el).fontSize),
    );
    assert(
      await page.evaluate(() =>
        document.fonts.check('700 24px "SUIT Variable"'),
      ),
      "local font loaded",
    );
    const before = await stats(page);
    assert(before.animations > 0, "animations work under OS reduced motion");
    await page.evaluate(() => {
      window.thinkQa.add("한글", 7);
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForFunction(
      () =>
        document.querySelector('.think-word[data-word="한글"]')?.dataset
          .count === "16",
    );
    await settle(page);
    assert(
      (await word.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) >
        beforeSize,
      "duplicates grow actual font size",
    );
    await radialGeometry(page, 'after duplicate growth');
    const grown = await stats(page);
    assert(grown.animations > before.animations, "duplicate growth animated");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await settle(page);
    assert.equal(
      (await stats(page)).animations,
      grown.animations,
      "unchanged refresh does not replay animation",
    );
    await page.getByRole("button", { name: "움직임 끄기" }).click();
    const muted = await stats(page);
    await page.evaluate(() => {
      window.thinkQa.add("새로운 응답");
      window.dispatchEvent(new Event("focus"));
    });
    await settle(page);
    assert.equal(
      (await stats(page)).animations,
      muted.animations,
      "manual motion off respected",
    );
    const geometry = await page
      .locator(".think-word__text")
      .evaluateAll((nodes) =>
        nodes.map((el) => {
          const s = getComputedStyle(el);
          return {
            mode: s.writingMode,
            transform: s.transform,
            shadow: s.textShadow,
            stroke: s.webkitTextStrokeWidth,
          };
        }),
      );
    assert(
      geometry.every(
        (row) =>
          row.mode === "horizontal-tb" &&
          row.transform === "none" &&
          row.shadow === "none" &&
          row.stroke === "0px",
      ),
      "horizontal clean typography",
    );
    const local = await stats(page);
    await page.getByRole("button", { name: "주제 목록" }).click();
    await openActive(page);
    await page.locator("#think-response-input").fill("측우기");
    assert.equal(
      (await stats(page)).reads,
      local.reads,
      "navigation and input are local",
    );
    await page.evaluate(() => {
      const input = document.querySelector("#think-response-input");
      input.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      input.form.requestSubmit();
    });
    await settle(page);
    assert.equal(
      (await stats(page)).writes,
      0,
      "IME composition cannot submit",
    );
    await page.evaluate(() => {
      const input = document.querySelector("#think-response-input");
      input.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
      window.thinkQa.delayWrite = 250;
      input.form.requestSubmit();
      input.form.requestSubmit();
    });
    await page.waitForSelector(".student-think-repeat-success");
    await settle(page);
    const submitted = await stats(page);
    assert.equal(submitted.writes, 1, "rapid submit produces one command");
    assert.equal(submitted.metadata, 1, "one command preflight");
    assert.equal(
      submitted.reads,
      local.reads,
      "server-confirmed own response needs no full reload",
    );
    assert.equal(submitted.rewards, 1, "one reward request");
    assert.equal(await page.locator("#think-response-input").inputValue(), "");
    await page.locator("#think-response-input").fill("복구");
    await page.evaluate(() => {
      window.thinkQa.failWrite = true;
    });
    await page.getByRole("button", { name: "생각 보내기" }).click();
    await page.waitForSelector("#think-submit-error");
    assert.equal(
      await page.locator("#think-response-input").inputValue(),
      "복구",
      "failed draft preserved",
    );
    assert.equal(
      (await stats(page)).writes,
      2,
      "failure reached command transport",
    );
    assert.equal(
      (await stats(page)).reads,
      submitted.reads,
      "failed command does not refetch",
    );
    await page.evaluate(() => {
      window.thinkQa.failWrite = false;
    });
    await page.getByRole("button", { name: "생각 보내기" }).click();
    await page.waitForFunction(() => window.thinkQa.rewards === 2);
    await settle(page);
    checks.push({
      scenario: "growth, motion, IME, duplicate submit and retry",
      counts: await stats(page),
    });
    await context.close();
  }
  for (const role of ["student", "teacher"]) {
    const { context, page } = await pageFor(role);
    await page.evaluate(() => {
      window.thinkQa.delayRead = 350;
    });
    await page.getByRole("button", { name: /좋은 리더의 조건/ }).click();
    assert.equal(
      await page.locator('.think-word[data-word="한글"]').count(),
      0,
      "previous topic data hidden while loading",
    );
    await page.waitForSelector('.think-word[data-word="경청"]');
    assert.equal(
      (await stats(page)).reads,
      2,
      "new topic uses exactly one read",
    );
    if (role === "student")
      assert(
        await page.locator("#think-response-input").isDisabled(),
        "paused input disabled",
      );
    checks.push({
      role,
      scenario: "topic switch isolation",
      counts: await stats(page),
    });
    await context.close();
  }
  {
    const { context, page } = await pageFor("student", 390);
    await openActive(page);
    await page.evaluate(() => {
      for (let n = 0; n < 150; n++) window.thinkQa.add(`생각${n}`);
      window.thinkQa.add("가".repeat(100), 9);
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForFunction(
      () => document.querySelectorAll(".think-word").length === 166,
    );
    await settle(page);
    await fit(page, "166 words with a 100-character phrase");
    await radialGeometry(page, "166 words and long phrase");
    assert.equal(
      await page.locator(".think-word").count(),
      166,
      "all words remain available without a display cap",
    );
    await page.screenshot({
      path: path.join(out, "student-long-dense.png"),
      fullPage: true,
    });
    checks.push({ scenario: "dense board", words: 166 });
    await context.close();
  }
  {
    const { context, page } = await pageFor("teacher");
    await page.getByRole("button", { name: "새 주제", exact: false }).click();
    await page
      .locator("#think-topic-title")
      .fill("우리 반이 함께 지킬 약속은?");
    await fit(page, "teacher create");
    await settle(page);
    await page.screenshot({
      path: path.join(out, "teacher-create.png"),
      fullPage: true,
    });
    assert.equal(
      (await stats(page)).reads,
      1,
      "create form and preview need no read",
    );
    await page.evaluate(() => {
      window.thinkQa.failWrite = true;
    });
    await page.getByRole("button", { name: "주제 열기" }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(
      await page.locator("#think-topic-title").inputValue(),
      "우리 반이 함께 지킬 약속은?",
      "create failure preserves draft",
    );
    await page.evaluate(() => {
      window.thinkQa.failWrite = false;
    });
    await page.getByRole("button", { name: "주제 열기" }).click();
    await page.getByTestId("teacher-think-detail").waitFor();
    await page.getByRole("button", { name: "잠시 멈추기" }).click();
    await page.getByRole("button", { name: "다시 열기" }).waitFor();
    await page.getByRole("button", { name: "다시 열기" }).click();
    await page.getByRole("button", { name: "잠시 멈추기" }).waitFor();
    const operating = await stats(page);
    assert.equal(
      operating.writes,
      4,
      "failure, create, pause, resume each command once",
    );
    assert.equal(operating.reads, 4, "successful operations each refresh once");
    await page.getByRole("button", { name: "크게 보기", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.equal(
      await dialog.getByText("발표에서 숨길 이름", { exact: false }).count(),
      0,
      "presentation excludes pending names",
    );
    for (let n = 0; n < 5; n++) {
      await page.keyboard.press("Tab");
      assert(
        await page.evaluate(() =>
          document.querySelector("dialog").contains(document.activeElement),
        ),
        "dialog traps focus",
      );
    }
    await settle(page);
    await page.screenshot({
      path: path.join(out, "teacher-presentation.png"),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    assert(
      await page
        .getByRole("button", { name: "크게 보기", exact: true })
        .evaluate((el) => el === document.activeElement),
      "presentation focus returns",
    );
    assert.equal(
      (await stats(page)).reads,
      operating.reads,
      "presentation is local",
    );
    await page.getByRole("button", { name: "주제 마치기" }).click();
    await page
      .getByRole("button", { name: "주제 마치기" })
      .waitFor({ state: "detached" });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "주제 삭제" }).click();
    await page.getByTestId("teacher-think-list").waitFor();
    checks.push({
      scenario: "teacher create retry, operate, present and delete",
      counts: await stats(page),
    });
    await context.close();
  }
  {
    const { context, page } = await pageFor("teacher", 390, "&readonly=1");
    assert.equal(
      await page.getByRole("button", { name: "새 주제" }).count(),
      0,
    );
    await openActive(page);
    assert.equal(
      await page.getByRole("button", { name: "주제 삭제" }).count(),
      0,
    );
    assert.equal((await stats(page)).writes, 0);
    checks.push({ scenario: "read-only teacher" });
    await context.close();
  }
  for (const role of ["student", "teacher"]) {
    const { context, page } = await pageFor(role, 390, "&error=1");
    await page.getByRole("button", { name: "다시 불러오기" }).waitFor();
    await page.evaluate(() => {
      window.thinkQa.failRead = false;
    });
    await page.getByRole("button", { name: "다시 불러오기" }).click();
    await page.getByRole("button", { name: /조선 하면 떠오르는/ }).waitFor();
    assert.equal((await stats(page)).reads, 2, "manual recovery one read");
    checks.push({ role, scenario: "read error recovery" });
    await context.close();
  }
  {
    const { context, page } = await pageFor("student", 390, "&once=1");
    await openActive(page);
    await page.locator("#think-response-input").fill("예술");
    await page.getByRole("button", { name: "생각 보내기" }).click();
    await page.waitForSelector(".student-think-sent");
    assert(
      await page
        .locator(".student-think-sent")
        .evaluate((el) => el === document.activeElement),
      "single-response completion receives focus",
    );
    checks.push({
      scenario: "single response focus",
      counts: await stats(page),
    });
    await context.close();
  }
  {
    const { context, page } = await pageFor("teacher");
    await openActive(page);
    await page.getByRole("button", { name: "크게 보기", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.evaluate(() => {
      window.thinkQa.sessions.splice(0, 1);
      window.thinkQa.classState.revision++;
      window.thinkQa.classState.activeSessionId = "";
      window.thinkQa.signal();
    });
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.notEqual(
      await page.evaluate(() => getComputedStyle(document.body).overflow),
      "hidden",
      "deleted presentation restores scroll",
    );
    checks.push({ scenario: "presentation deletion recovery" });
    await context.close();
  }
  {
    const { context, page } = await pageFor("student");
    await openActive(page);
    await page.evaluate(() => window.thinkQa.add("집중", 100));
    await page.waitForFunction(
      () =>
        document.querySelector('.think-word[data-word="집중"]')?.dataset
          .count === "100",
    );
    const label = page.locator(
      '.think-word[data-word="집중"] .think-word__text',
    );
    const first = await label.evaluate((el) =>
      parseFloat(getComputedStyle(el).fontSize),
    );
    await page.evaluate(() => window.thinkQa.add("집중"));
    await page.waitForFunction(
      () =>
        document.querySelector('.think-word[data-word="집중"]')?.dataset
          .count === "101",
    );
    assert(
      (await label.evaluate((el) =>
        parseFloat(getComputedStyle(el).fontSize),
      )) > first,
      "high-frequency words continue to grow",
    );
    checks.push({ scenario: "100 to 101 responses still grow" });
    await context.close();
  }
  assert.deepEqual(errors, [], "no browser runtime errors");
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(
    `PASS ${checks.length} responsive/reduced-motion views; evidence: ${out}`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
