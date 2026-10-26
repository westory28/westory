/** Actual worksheet component, synthetic data only; no Firebase reads or writes. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
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
const evidence = path.join(root, "output/lesson-footnotes-browser");
await fs.mkdir(evidence, { recursive: true });
const tailwindCache = path.join(os.tmpdir(), "westory-tailwind-fixture.js");
let tailwind;
try {
  tailwind = await fs.readFile(tailwindCache, "utf8");
} catch {
  const response = await fetch("https://cdn.tailwindcss.com/3.4.17");
  assert(response.ok, "Tailwind runtime download failed");
  tailwind = await response.text();
  await fs.writeFile(tailwindCache, tailwind);
}
const stagePath = JSON.stringify(
  path
    .join(root, "src/components/common/LessonWorksheetStage.tsx")
    .replaceAll("\\", "/"),
);
const source = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import Stage from ${stagePath};
const initial={id:'anchor-1',footnoteId:'note-1',page:1,leftRatio:.46,topRatio:.26,widthRatio:.08,heightRatio:.08};
const pages=[{page:1,imageUrl:'/worksheet.svg',width:1000,height:1400}];
const mode=new URLSearchParams(location.search).get('mode')||'teacher-edit';
function Fixture(){const[anchors,setAnchors]=useState(()=>JSON.parse(sessionStorage.getItem('anchors')||'null')||[initial]);const[selected,setSelected]=useState(null);const[opens,setOpens]=useState(0);const[moves,setMoves]=useState(0);const[revision,setRevision]=useState(0);
return <main style={{padding:12,maxWidth:1280,margin:'auto'}}><div className="flex gap-4 mb-4"><button onClick={()=>{sessionStorage.removeItem('anchors');setAnchors([initial]);setMoves(0);setOpens(0);setSelected(null);setRevision(r=>r+1)}}>초기화</button><button onClick={()=>setRevision(r=>r+1)}>다시 열기</button></div><output data-testid="state" className="sr-only">{JSON.stringify({anchors,opens,moves})}</output><Stage key={revision} pageImages={pages} blanks={[]} mode={mode} teacherRightButtonPan={true} teacherTool={new URLSearchParams(location.search).get("tool")||"footnote"} annotationEnabled={false} showPageLabel={false} footnoteAnchors={anchors} footnoteTitles={{'note-1':'탕평 정치'}} selectedFootnoteAnchorId={selected} onSelectFootnoteAnchor={setSelected} onActivateFootnoteAnchor={()=>setOpens(n=>n+1)} onMoveFootnoteAnchor={(id,position)=>{setAnchors(previous=>{const next=previous.map(a=>a.id===id?{...a,...position}:a);sessionStorage.setItem('anchors',JSON.stringify(next));return next});setMoves(n=>n+1)}}/></main>}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
const bundle = await build({
  stdin: { contents: source, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "offline-firebase",
      setup(build) {
        build.onResolve(
          { filter: /lib\/firebase$|^\.\/firebase$/ },
          (args) => ({ path: args.path, namespace: "offline" }),
        );
        build.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
          contents:
            "export const getHttpsCallable=()=>{throw new Error('Firebase disabled in fixture')};",
          loader: "js",
        }));
      },
    },
  ],
});
const css = (
  await Promise.all(
    ["assets/css/style.css", "src/assets/index.css"].map((file) =>
      fs.readFile(path.join(root, file), "utf8"),
    ),
  )
)
  .join("\n")
  .replaceAll(/@import[^;]+;/g, "")
  .replaceAll(/@tailwind[^;]+;/g, "");
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><style>${css}body{margin:0}#root{min-width:0}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400"><rect width="1000" height="1400" fill="white"/><path d="M0 420H1000M500 0V1400" stroke="#94a3b8"/><text x="100" y="150" font-size="40">각주 위치 검증</text></svg>`;
const server = http.createServer((req, res) => {
  const route = req.url.split("?")[0];
  res.setHeader(
    "Content-Type",
    route.endsWith(".js")
      ? "text/javascript"
      : route.endsWith(".svg")
        ? "image/svg+xml"
        : "text/html;charset=utf-8",
  );
  res.end(
    route === "/fixture.js"
      ? bundle.outputFiles[0].text
      : route === "/tailwind.js"
        ? tailwind
        : route === "/worksheet.svg"
          ? svg
          : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const reports = [];
const markerSelector = '[data-footnote-anchor-id="anchor-1"]';
const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
const state = async (page) =>
  JSON.parse(await page.getByTestId("state").textContent());
const near = (actual, expected, label, tolerance = 0.002) =>
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} versus ${expected}`,
  );
async function metrics(page) {
  return page.evaluate((selector) => {
    const marker = document.querySelector(selector),
      image = document.querySelector('img[alt^="학습지"]');
    const m = marker.getBoundingClientRect(),
      i = image.getBoundingClientRect();
    return {
      x: (m.x + m.width / 2 - i.x) / i.width,
      y: (m.y + m.height / 2 - i.y) / i.height,
      width: m.width,
      zoom:
        image.parentElement.getBoundingClientRect().width /
        image.parentElement.parentElement.clientWidth,
      image: { x: i.x, y: i.y, width: i.width, height: i.height },
      marker: { x: m.x, y: m.y, width: m.width, height: m.height },
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  }, markerSelector);
}
async function assertCenter(page, label, markerWidth = 40) {
  const saved = (await state(page)).anchors[0],
    m = await metrics(page);
  near(m.x, saved.leftRatio + saved.widthRatio / 2, `${label} x`);
  near(m.y, saved.topRatio + saved.heightRatio / 2, `${label} y`);
  near(m.width, markerWidth, `${label} marker width`, 0.1);
  assert(!m.overflow, `${label}: document overflow`);
  return m;
}
async function setZoom(page, target) {
  for (let i = 0; i < 20; i++) {
    const m = await metrics(page),
      diff = target - m.zoom;
    if (Math.abs(diff) < 0.003) return;
    await page.locator('img[alt^="학습지"]').dispatchEvent("wheel", {
      deltaY: -diff / 0.0012,
      deltaMode: 0,
      ctrlKey: true,
      clientX: 100,
      clientY: 150,
    });
    await settle(page);
  }
  near((await metrics(page)).zoom, target, "target zoom", 0.003);
}
async function drag(page, dx, dy, cancel = false) {
  await page.locator(markerSelector).scrollIntoViewIfNeeded();
  const box = await page.locator(markerSelector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + dx,
    box.y + box.height / 2 + dy,
    { steps: 8 },
  );
  if (cancel === true)
    await page.locator(markerSelector).dispatchEvent("pointercancel", {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: 0,
    });
  if (cancel === "escape") await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.mouse.move(0, 0);
  await settle(page);
}
try {
  for (const width of [390, 768, 1280])
    for (const mode of ["teacher-edit", "student-solve", "teacher-present"]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        hasTouch: true,
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) =>
        route.request().url().startsWith(origin)
          ? route.continue()
          : route.abort(),
      );
      await page.goto(
        `${origin}/?mode=${mode}&tool=${width === 1280 ? "pan" : "footnote"}`,
      );
      await page.locator(markerSelector).waitFor();
      await page.waitForFunction(
        (selector) =>
          getComputedStyle(document.querySelector(selector)).position ===
          "absolute",
        markerSelector,
      );
      await settle(page);
      const label = `${mode}-${width}`;
      const initial = await assertCenter(page, `${label} initial`);
      await page.locator(markerSelector).hover();
      await page.waitForTimeout(250);
      await assertCenter(page, `${label} hover`);
      await page.mouse.move(0, 0);
      await page.locator(markerSelector).click();
      assert.equal((await state(page)).opens, 1, `${label}: click opens`);
      await page.getByRole("button", { name: "초기화", exact: true }).click();
      await settle(page);
      if (mode === "teacher-edit") {
        const before = await metrics(page);
        await drag(page, 45, 35);
        let saved = await state(page);
        assert(saved.moves > 0, `${label}: drag commits position`);
        assert.equal(saved.opens, 0, `${label}: drag does not open`);
        near(
          saved.anchors[0].leftRatio,
          0.46 + 45 / before.image.width,
          `${label} drag x`,
        );
        near(
          saved.anchors[0].topRatio,
          0.26 + 35 / before.image.height,
          `${label} drag y`,
        );
        await assertCenter(page, `${label} after drag`);
        const committed = JSON.stringify(saved.anchors);
        await page
          .getByRole("button", { name: "다시 열기", exact: true })
          .click();
        await settle(page);
        assert.equal(
          JSON.stringify((await state(page)).anchors),
          committed,
          `${label}: remount keeps position`,
        );
        await assertCenter(page, `${label} remount`);
        await page.reload();
        await page.locator(markerSelector).waitFor();
        await settle(page);
        assert.equal(
          JSON.stringify((await state(page)).anchors),
          committed,
          `${label}: saved fixture reload`,
        );
        await assertCenter(page, `${label} reload`);
        const beforeKey = (await state(page)).anchors[0].leftRatio;
        await page.locator(markerSelector).focus();
        await page.keyboard.press("ArrowRight");
        await settle(page);
        const afterKey = (await state(page)).anchors[0].leftRatio;
        assert(afterKey > beforeKey, `${label}: arrow moves`);
        await page.keyboard.press("Shift+ArrowRight");
        await settle(page);
        const afterShift = (await state(page)).anchors[0].leftRatio;
        assert(
          afterShift - afterKey > afterKey - beforeKey,
          `${label}: Shift moves farther`,
        );
        const beforeCancel = await state(page);
        await drag(page, -30, 20, true);
        const canceled = await state(page);
        assert.deepEqual(
          canceled.anchors,
          beforeCancel.anchors,
          `${label}: canceled drag restores position`,
        );
        assert.equal(
          canceled.opens,
          beforeCancel.opens,
          `${label}: canceled drag does not open`,
        );
        await assertCenter(page, `${label} cancel`);
        await drag(page, 30, -20, "escape");
        assert.deepEqual(
          (await state(page)).anchors,
          beforeCancel.anchors,
          `${label}: Escape restores position`,
        );
        assert.equal(
          (await state(page)).opens,
          beforeCancel.opens,
          `${label}: Escape does not open`,
        );
        await page.getByRole("button", { name: "초기화", exact: true }).click();
        await settle(page);
        const corner = await metrics(page);
        await drag(page, corner.image.width, corner.image.height);
        saved = await state(page);
        near(saved.anchors[0].leftRatio, 0.92, `${label}: right clamp`);
        near(saved.anchors[0].topRatio, 0.92, `${label}: bottom clamp`);
        await page.getByRole("button", { name: "초기화", exact: true }).click();
        await settle(page);
        await setZoom(page, 1.5);
        const enlarged = await metrics(page);
        await drag(page, 40, 25);
        saved = await state(page);
        near(
          saved.anchors[0].leftRatio,
          0.46 + 40 / enlarged.image.width,
          `${label}: enlarged drag x`,
        );
        near(
          saved.anchors[0].topRatio,
          0.26 + 25 / enlarged.image.height,
          `${label}: enlarged drag y`,
        );
        await assertCenter(page, `${label} enlarged drag`);
        await page.getByRole("button", { name: "초기화", exact: true }).click();
        await settle(page);
        if (width === 768) {
          const touchBefore = await metrics(page);
          const client = await page.context().newCDPSession(page);
          const start = {
            x: touchBefore.marker.x + 20,
            y: touchBefore.marker.y + 20,
          };
          await client.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ ...start, id: 1 }],
          });
          await client.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: start.x + 40, y: start.y + 30, id: 1 }],
          });
          await client.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          await settle(page);
          saved = await state(page);
          assert.equal(saved.moves, 1, `${label}: touch commits once`);
          assert.equal(saved.opens, 0, `${label}: touch drag does not open`);
          near(
            saved.anchors[0].leftRatio,
            0.46 + 40 / touchBefore.image.width,
            `${label}: touch drag x`,
          );
          near(
            saved.anchors[0].topRatio,
            0.26 + 30 / touchBefore.image.height,
            `${label}: touch drag y`,
          );
          await client.detach();
          await assertCenter(page, `${label} touch drag`);
        }
        await drag(page, -corner.image.width, -corner.image.height);
        saved = await state(page);
        near(saved.anchors[0].leftRatio, 0, `${label}: left clamp`);
        near(saved.anchors[0].topRatio, 0, `${label}: top clamp`);
        await page.getByRole("button", { name: "초기화", exact: true }).click();
        await settle(page);
      } else {
        await drag(page, 40, 30);
        assert.equal((await state(page)).moves, 0, `${label}: read-only drag`);
        await page.locator(markerSelector).focus();
        await page.keyboard.press("ArrowRight");
        assert.equal((await state(page)).moves, 0, `${label}: read-only key`);
      }
      const zooms = [];
      for (const zoom of [0.7, 1, 1.5, 2]) {
        await setZoom(page, zoom);
        zooms.push(await assertCenter(page, `${label} ${zoom * 100}%`));
      }
      await setZoom(page, 1);
      await page.evaluate(() => {
        document.documentElement.style.zoom = "0.5";
      });
      await settle(page);
      await assertCenter(page, `${label} CSS 50% zoom`, 20);
      await page.evaluate(() => {
        document.documentElement.style.zoom = "";
      });
      await settle(page);
      await page.locator(markerSelector).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(evidence, `${label}.png`),
        fullPage: true,
      });
      assert.deepEqual(errors, [], `${label}: browser errors`);
      reports.push({ label, initial, zooms });
      await page.close();
    }
  console.log(
    `PASS: ${reports.length} worksheet footnote cases; drag, saved reload, keyboard, cancellation, clamps, read-only, hover, app 70–200% and CSS 50% zoom. Evidence: ${evidence}`,
  );
} finally {
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(
      {
        coverage:
          "Real React component with synthetic data; Edge desktop and emulated touch, not physical Safari; fixture storage checks do not exercise Firebase persistence.",
        reports,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
