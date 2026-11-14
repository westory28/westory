/** Real shared placeholder/studio/hall components; synthetic data, local assets only. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidence = path.join(root, "output/avatar-placeholder-20261114");
await fs.mkdir(evidence, { recursive: true });
const require = createRequire(import.meta.url);
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const entry = `
import React,{useEffect,useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
import AvatarPlaceholder from './src/features/avatar/AvatarPlaceholder';
import WisHallOfFameAvatar from './src/components/common/WisHallOfFameAvatar';
import {AvatarStudio} from './src/features/avatar/AvatarStudio';
import {defaultAvatarLook} from './src/features/avatar/catalog';
import {drawMinimi} from './src/features/avatar/minimi/draw';
const qa=window.placeholderQa={loads:0,saves:0,failLoad:false,failSave:false};
const avatar={schemaVersion:1,catalogVersion:2,look:defaultAvatarLook(),lookHash:'fixture',revision:0,ownedItemIds:[]};
const adapter={load:async()=>{qa.loads++;if(qa.failLoad)throw Error('검증 조회 오류');return{avatar,balance:1000}},
 purchase:async()=>{throw Error('Not used')},save:async(look,revision,thumbnailUrl)=>{qa.saves++;if(qa.failSave)throw Error('검증 저장 오류');return{...avatar,look,revision:revision+1,thumbnailUrl}}};
function Reference(){const ref=useRef(null);useEffect(()=>{drawMinimi(ref.current.getContext('2d'),defaultAvatarLook())},[]);return <canvas ref={ref} width="80" height="112" style={{width:'100%',height:'100%',imageRendering:'pixelated'}}/>}
function App(){const[studio,setStudio]=useState(false),[reset,setReset]=useState(0);return <main>
 <h1>기본 아바타 실루엣 확인</h1><div id="comparison"><figure><figcaption>현재 기본 캐릭터</figcaption><div className="frame"><Reference/></div></figure>
 <figure><figcaption>같은 캐릭터 실루엣</figcaption><div className="frame"><AvatarPlaceholder/></div></figure></div>
 <section aria-label="순위와 명예의 전당"><h2>아바타 미선택과 이미지 실패</h2><div className="hall-cases">
 <WisHallOfFameAvatar entry={{uid:'empty',displayName:'미선택 학생'}}/>
 <WisHallOfFameAvatar entry={{uid:'failed',displayName:'이미지 실패 학생',avatar:{...avatar,thumbnailUrl:'data:image/webp;base64,broken'}}}/></div></section>
 <button onClick={()=>setStudio(v=>!v)}>꾸미기 열기/닫기</button><button onClick={()=>setReset(v=>v+1)}>꾸미기 다시 열기</button>
 {studio&&<section id="studio"><AvatarStudio key={reset} adapter={adapter}/></section>}
 </main>};createRoot(document.getElementById('root')).render(<App/>);
`;
const mocks = {
  AuthContext:
    "export const useAuth=()=>({currentUser:{uid:'fixture'},config:{year:'2026',semester:'2'}});",
  AppToastProvider: "export const useAppToast=()=>({showToast:()=>{}});",
  service:
    "export const avatarErrorMessage=e=>e.message,avatarPricingFromError=()=>null,makeAvatarThumbnail=async x=>x;export const getAvatarStudioState=()=>{throw Error('No live calls')},purchaseAvatarItem=getAvatarStudioState,saveStudentAvatar=getAvatarStudioState;",
};
const bundle = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  outdir: evidence,
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.BASE_URL": '"/"',
  },
  loader: { ".svg": "dataurl", ".webp": "dataurl" },
  plugins: [
    {
      name: "local-avatar-services",
      setup(plugin) {
        plugin.onResolve(
          { filter: /\/(AuthContext|AppToastProvider|service)$/ },
          (args) => ({
            path: args.path.split("/").at(-1),
            namespace: "fixture",
          }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: mocks[args.path],
          loader: "js",
        }));
      },
    },
  ],
});
const files = new Map(
  bundle.outputFiles.map((file) => [
    "/" + path.basename(file.path),
    file.contents,
  ]),
);
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/stdin.css">
<style>*{box-sizing:border-box}body{margin:0;background:#f8fafc;color:#1f2937;font-family:Arial,sans-serif}main{max-width:1152px;margin:auto;padding:16px}h1{font-size:22px}h2{font-size:18px}figure{margin:0;min-width:0}figcaption{font-size:14px;text-align:center;margin-bottom:8px}#comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));max-width:560px;gap:16px}.frame{position:relative;aspect-ratio:80/112;max-height:336px}.hall-cases{display:flex;gap:16px}.hall-cases>.wis-hall-avatar{width:120px;height:168px}main>button{min-height:44px;margin:16px 8px 16px 0}#studio{margin-top:16px;min-width:0}button{font:inherit}</style>
<div id="root"></div><script type="module" src="/stdin.js"></script></html>`;
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (files.has(pathname))
    return response
      .writeHead(200, {
        "Content-Type": pathname.endsWith(".css")
          ? "text/css"
          : "text/javascript",
      })
      .end(files.get(pathname));
  if (
    /^\/avatar\/minimi-v2\/previews\/(girl|boy)\/[a-z0-9-]+\.webp$/.test(
      pathname,
    )
  ) {
    try {
      return response
        .writeHead(200, { "Content-Type": "image/webp" })
        .end(await fs.readFile(path.join(root, "public", pathname)));
    } catch {
      return response.writeHead(404).end();
    }
  }
  return response.writeHead(200, { "Content-Type": "text/html" }).end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  headless: true,
  channel:
    process.env.PLAYWRIGHT_BROWSER_CHANNEL ||
    (process.platform === "win32" ? "msedge" : undefined),
});
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const errors = [],
    external = [],
    imageRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.resourceType() === "image") imageRequests.push(request.url());
  });
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(origin)) return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  await page.goto(origin);
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".avatar-placeholder__silhouette").length ===
        3 &&
      [...document.querySelectorAll(".avatar-placeholder__silhouette")].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
  );
  assert.equal(
    imageRequests.length,
    0,
    "Placeholder and failed-image fallback add no image network requests",
  );
  const widths = [];
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const report = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      images: [
        ...document.querySelectorAll(".avatar-placeholder__silhouette"),
      ].map((image) => ({
        inline: image.src.startsWith("data:image/svg+xml,"),
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        rendering: getComputedStyle(image).imageRendering,
        transform: getComputedStyle(image).transform,
        animation: getComputedStyle(image).animationName,
      })),
    }));
    assert.equal(report.overflow, false);
    assert(
      report.images.every(
        (image) =>
          image.inline &&
          image.rendering === "pixelated" &&
          image.animation === "none",
      ),
    );
    widths.push({ width, ...report });
    await page.screenshot({
      path: path.join(evidence, `placeholder-${width}.png`),
      fullPage: true,
    });
  }
  await page
    .locator("#comparison")
    .screenshot({ path: path.join(evidence, "renderer-comparison.png") });
  await page.getByRole("button", { name: "꾸미기 열기/닫기" }).click();
  await page.locator("#studio .avatar-placeholder").waitFor();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: path.join(evidence, `studio-${width}.png`),
      fullPage: true,
    });
  }
  const character = page
    .locator("#studio .avatar-studio-characters button")
    .first();
  await character.focus();
  await page.keyboard.press("Enter");
  await page.locator("#studio canvas").waitFor();
  assert.equal(
    await page.locator("#studio .avatar-placeholder").count(),
    0,
    "Selection still opens the actual renderer",
  );
  await page.evaluate(() => {
    window.placeholderQa.failSave = true;
  });
  const save = page.getByRole("button", { name: "아바타 저장", exact: true });
  await save.click();
  await page.getByText("검증 저장 오류", { exact: true }).waitFor();
  assert.equal(
    await page.locator("#studio canvas").count(),
    1,
    "Failed save keeps the selected renderer",
  );
  await page.evaluate(() => {
    window.placeholderQa.failSave = false;
  });
  await save.click();
  await page.waitForFunction(() => window.placeholderQa.saves === 2);
  assert.equal(await page.locator("#studio .avatar-placeholder").count(), 0);
  await page.evaluate(() => {
    window.placeholderQa.failLoad = true;
  });
  await page
    .getByRole("button", { name: "꾸미기 다시 열기", exact: true })
    .click();
  await page.getByText("검증 조회 오류", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.placeholderQa.failLoad = false;
  });
  await page
    .getByRole("button", { name: "다시 불러오기", exact: true })
    .click();
  await page.locator("#studio .avatar-placeholder").waitFor();
  assert.equal(external.length, 0);
  assert.equal(errors.length, 0);
  assert.equal(
    imageRequests.some((url) => url.includes("neutral.svg")),
    false,
  );
  const result = {
    passed: true,
    widths,
    emptyAndBrokenImage: true,
    keyboardSelection: true,
    saveErrorAndRetry: true,
    loadErrorAndRetry: true,
    placeholderImageRequests: 0,
    externalRequests: 0,
    errors,
  };
  await fs.writeFile(
    path.join(evidence, "summary.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: true,
      widths: widths.map((item) => item.width),
      imageRequestsFromPlaceholder: 0,
      selectionAndRetries: true,
      externalRequests: 0,
      evidence,
    }),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
