import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const engines = [
  ...new Set(
    (
      process.env.LOADING_BROWSER_ENGINES ||
      process.env.PLAYWRIGHT_BROWSER_CHANNEL ||
      "msedge"
    )
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  ),
];
for (const engine of engines)
  assert.ok(
    ["chromium", "firefox", "webkit", "msedge", "chrome"].includes(engine),
    "Unknown browser: " + engine,
  );
const evidence =
  process.env.LOADING_EVIDENCE_DIR ||
  path.join(root, ".superloopy/sessions/logo-loading/evidence");
await fs.mkdir(evidence, { recursive: true });

const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {PageLoading, InlineLoading, LoadingOverlay, LoadingProvider} from './src/components/common/LoadingState';
const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'page';
const scope = params.get('scope') || undefined;
const root = createRoot(document.getElementById('root'));
let key = 0;
const component = mode === 'inline' ? InlineLoading : mode === 'overlay' ? LoadingOverlay : PageLoading;
const render = (node) => flushSync(() => {
 const content = React.createElement(LoadingProvider, null,
   React.createElement('section', {id:'source-container', style:params.has('nested') ? {transform:'translateZ(0)', filter:'opacity(1)', overflow:'hidden', width:240, height:120} : {width:'calc(100% - 32px)',margin:'32px auto',position:'relative',minHeight:mode === 'overlay' ? 240 : undefined}}, node));
 root.render(params.has('strict') ? React.createElement(React.StrictMode, null, content) : content);
});
const loading = () => mode === 'multiple' ? React.createElement(React.Fragment, null, React.createElement(InlineLoading, {scope,key:'a'+key}), React.createElement(InlineLoading, {scope,key:'b'+key})) : React.createElement(component, {scope,key, message:'OLD MESSAGE', detail:'OLD DETAIL', warning:'OLD WARNING'});
window.startLoading = () => render(loading());
window.replaceLoading = () => { key++; render(loading()); };
window.finishFirstLoading = () => render(React.createElement(InlineLoading, {scope,key:'b'+key}));
window.showHiddenLoading = () => render(React.createElement('div', {id:'hidden-panel', hidden:true}, React.createElement(InlineLoading,{scope})));
window.nativeLoading = (pending=true) => render(React.createElement('dialog',{id:'native-dialog'}, React.createElement('input',{id:'native-draft',defaultValue:'보존할 초안'}), pending ? React.createElement(InlineLoading,{scope}) : null));
window.finishLoading = (error=false) => render(React.createElement('main', null, React.createElement('h1', null, error ? '연결 오류' : '준비 완료'), React.createElement('button', {onClick: error ? window.startLoading : () => { window.clicked = true; }}, error ? '다시 시도' : '계속')));
window.instantLoading = () => { window.startLoading(); window.finishLoading(); };
window.unmountLoading = () => root.unmount();
if(mode === 'scoped') {
 const pending={a:true,b:true,dialog:true,offscreen:false};
 const click = id => window.scopedClicks[id]=(window.scopedClicks[id]||0)+1;
 window.scopedClicks={};
 const area = (id) => <section id={'scope-'+id} className="scoped-area"><article><label>{id} 입력<input id={id+'-input'} defaultValue={'보존 '+id}/></label><button id={id+'-button'} onClick={()=>click(id)}>{id} 작업</button><button id={id+'-preinert'} inert="">기존 비활성</button></article>{pending[id] && <LoadingOverlay key="primary"/>}{id==='b' && pending.duplicate && <LoadingOverlay key="duplicate"/>}</section>;
 const renderScoped = () => flushSync(()=>root.render(<React.StrictMode><LoadingProvider><nav><button id="outside-nav" onClick={()=>click('nav')}>다른 메뉴</button></nav><main className="scoped-main"><label>외부 입력<input id="outside-input" defaultValue="외부 초안"/></label><button id="outside-button" onClick={()=>click('outside')}>다른 영역 작업</button><div id="outside-scroll"><div>독립 스크롤</div></div><div className="scoped-grid">{area('a')}{area('b')}</div><button id="open-dialog" onClick={()=>document.getElementById('scoped-modal').showModal()}>상세 열기</button><dialog id="scoped-modal"><header><button id="close-dialog" onClick={()=>document.getElementById('scoped-modal').close()}>상세 닫기</button><input id="dialog-outside" defaultValue="상세 초안"/></header>{area('dialog')}</dialog><div className="long-space"/><div id="offscreen-wrapper">{area('offscreen')}</div><button id="bottom-button" onClick={()=>click('bottom')}>아래 영역 작업</button></main></LoadingProvider></React.StrictMode>));
 window.localSet=(id,value)=>{pending[id]=value;renderScoped();};
 window.localHide=(id,hidden)=>{document.getElementById('scope-'+id).hidden=hidden;};
 window.localRemove=id=>document.getElementById('scope-'+id).remove();
 renderScoped();
} else window.startLoading();
`;
const files = new Map();
let css = "";
for (const env of ["production", "development"]) {
  const bundle = await build({
    stdin: { contents: fixture, resolveDir: root, loader: "tsx" },
    bundle: true,
    write: false,
    format: "esm",
    outfile: env === "production" ? "fixture.js" : "fixture-dev.js",
    loader: { ".webp": "file" },
    publicPath: "/",
    define: { "process.env.NODE_ENV": JSON.stringify(env) },
  });
  for (const file of bundle.outputFiles) {
    files.set("/" + path.basename(file.path), file.contents);
    if (file.path.endsWith(".css")) css = file.text;
  }
}
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (files.has(pathname)) {
    res.setHeader(
      "Content-Type",
      pathname.endsWith(".webp")
        ? "image/webp"
        : pathname.endsWith(".css")
          ? "text/css"
          : "text/javascript",
    );
    res.end(files.get(pathname));
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font-family:Noto Sans KR,sans-serif;background:#f9fafb}.z-\\[90\\]{z-index:90}nav{padding:16px;background:#dbeafe}.scoped-main{padding:16px}input{max-width:100%;min-width:0}button,input{min-height:44px}.scoped-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin:20px 0}.scoped-area{min-height:240px;background:#fef3c7}.scoped-area article{padding:16px}.scoped-area label{display:block}.scoped-area input{display:block}#outside-scroll{height:64px;overflow:auto;background:#e2e8f0;margin-top:12px}#outside-scroll>div{height:500px}#scoped-modal{width:min(600px,calc(100vw - 32px));padding:16px}#scoped-modal header{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}.long-space{height:1500px}@media(max-width:699px){.scoped-grid{grid-template-columns:1fr;gap:16px}}</style><style>' +
      css +
      '</style><div id="root"></div><script type="module" src="' +
      (req.url.includes("strict") ? "/fixture-dev.js" : "/fixture.js") +
      '"></script></html>',
  );
});
await new Promise((resolve) =>
  server.listen(
    Number(process.env.LOADING_PREVIEW_PORT || 0),
    "127.0.0.1",
    resolve,
  ),
);
const url = "http://127.0.0.1:" + server.address().port;
if (process.env.LOADING_PREVIEW_ONLY === "1") {
  console.log("Loading preview: " + url);
  await new Promise(() => {});
}

async function makePage(browser, scenario = "normal", options = {}) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "no-preference",
    ...options,
  });
  page.setDefaultTimeout(5000);
  const errors = [],
    requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      type: request.resourceType(),
    }),
  );
  await page.route("**/*", (route) =>
    route.request().url().startsWith(url) ? route.continue() : route.abort(),
  );
  await page.addInitScript((scenario) => {
    const listeners = new Map(),
      targets = [],
      observers = [],
      exits = [],
      exitNodes = new WeakSet();
    let frameCalls = 0,
      timerCalls = 0,
      disconnects = 0;
    const raf = window.requestAnimationFrame?.bind(window);
    if (raf)
      window.requestAnimationFrame = (...args) => {
        frameCalls++;
        return raf(...args);
      };
    const timeout = window.setTimeout.bind(window),
      interval = window.setInterval.bind(window);
    window.setTimeout = (...args) => {
      timerCalls++;
      return timeout(...args);
    };
    window.setInterval = (...args) => {
      timerCalls++;
      return interval(...args);
    };
    for (const [target, types] of [
      [document, ["visibilitychange"]],
      [window, ["pagehide", "pageshow"]],
    ]) {
      const add = target.addEventListener.bind(target),
        remove = target.removeEventListener.bind(target);
      target.addEventListener = (type, listener, options) => {
        if (types.includes(type)) {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type).add(listener);
        }
        return add(type, listener, options);
      };
      target.removeEventListener = (type, listener, options) => {
        listeners.get(type)?.delete(listener);
        return remove(type, listener, options);
      };
    }
    const NativeObserver = window.IntersectionObserver;
    if (NativeObserver)
      window.IntersectionObserver = class extends NativeObserver {
        constructor(callback, options) {
          super(callback, options);
          observers.push(() => callback([{ isIntersecting: true }], this));
        }
        observe(target) {
          targets.push(target.tagName);
          super.observe(target);
        }
        disconnect() {
          disconnects++;
          super.disconnect();
        }
      };
    new MutationObserver((records) => {
      for (const record of records)
        for (const added of record.addedNodes) {
          if (!(added instanceof Element)) continue;
          for (const node of [
            added,
            ...added.querySelectorAll(".ws-loading__logo--exit"),
          ]) {
            if (!node.matches(".ws-loading__logo--exit") || exitNodes.has(node))
              continue;
            exitNodes.add(node);
            const animations = node.getAnimations({ subtree: true });
            const surface = node.closest(".ws-loading-exit-surface");
            const surfaceStyle = surface && getComputedStyle(surface);
            const surfaceBox = surface?.getBoundingClientRect();
            exits.push({
              ariaHidden: node.getAttribute("aria-hidden"),
              pointerEvents: getComputedStyle(node).pointerEvents,
              surface: surface && {
                scope: surface.dataset.loadingScope,
                box: {
                  x: surfaceBox.x,
                  y: surfaceBox.y,
                  width: surfaceBox.width,
                  height: surfaceBox.height,
                },
                body: surface.parentElement === document.body,
                hostId: surface.parentElement.id,
                blur: surfaceStyle.backdropFilter,
                background: surfaceStyle.backgroundColor,
                pointerEvents: surfaceStyle.pointerEvents,
                coversViewport:
                  surfaceBox.x === 0 &&
                  surfaceBox.y === 0 &&
                  surfaceBox.width === innerWidth &&
                  surfaceBox.height === innerHeight,
                durations: surface
                  .getAnimations()
                  .map((animation) => animation.effect.getTiming().duration),
              },
              animations: animations.map((animation) => ({
                duration: animation.effect.getTiming().duration,
                frames: animation.effect
                  .getKeyframes()
                  .map(({ transform, opacity }) => ({ transform, opacity })),
              })),
            });
            if (window.pauseLoadingExits) {
              for (const animation of [
                ...animations,
                ...(surface?.getAnimations() || []),
              ])
                animation.pause();
            }
          }
        }
    }).observe(document, { subtree: true, childList: true });
    if (scenario === "missing-matchMedia") window.matchMedia = undefined;
    if (scenario === "legacy-matchMedia") {
      const match = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        const result = match(query);
        return {
          get matches() {
            return result.matches;
          },
          media: result.media,
          addListener: result.addListener.bind(result),
          removeListener: result.removeListener.bind(result),
        };
      };
    }
    if (scenario === "missing-IntersectionObserver")
      window.IntersectionObserver = undefined;
    if (scenario === "missing-requestAnimationFrame")
      window.requestAnimationFrame = undefined;
    if (scenario === "missing-cancelAnimationFrame")
      window.cancelAnimationFrame = undefined;
    if (scenario === "missing-animate")
      SVGElement.prototype.animate = undefined;
    window.loadingQA = {
      state: () => ({
        frameCalls,
        timerCalls,
        disconnects,
        targets,
        exits,
        listeners: Object.fromEntries(
          [...listeners].map(([type, set]) => [type, set.size]),
        ),
      }),
      setHidden: (hidden) => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => hidden,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      },
      staleIntersection: () => observers.forEach((callback) => callback()),
    };
  }, scenario);
  return { page, errors, requests };
}
const snapshot = (page) =>
  page.evaluate(() => ({
    letters: [...document.querySelectorAll("[data-loading-letter]")].map(
      (node) => getComputedStyle(node).transform,
    ),
    fill: getComputedStyle(document.querySelector("[data-loading-fill]"))
      .transform,
  }));
async function waitRunning(page) {
  await page.locator(".ws-loading:not(.ws-loading--paused)").first().waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector(".ws-loading__letter")?.getAnimations().length > 0,
    null,
    { polling: 50 },
  );
}
async function assertMotion(page, label) {
  const samples = [];
  for (let i = 0; i < 7; i++) {
    samples.push(await snapshot(page));
    await page.waitForTimeout(180);
  }
  for (let i = 0; i < 7; i++)
    assert.ok(
      new Set(samples.map((sample) => sample.letters[i])).size > 1,
      label + ": letter " + i + " animates",
    );
  assert.ok(
    new Set(samples.map((sample) => sample.fill)).size > 1,
    label + ": color progresses",
  );
  assert.ok(
    samples.some((sample) => new Set(sample.letters).size > 1),
    label + ": independent staggered glyphs",
  );
  return label;
}
async function assertPaused(page, label) {
  await page.locator(".ws-loading--paused").waitFor();
  // CSS pause resolves on the next animation timeline tick in Chromium/WebKit.
  await page.waitForTimeout(60);
  const before = await snapshot(page);
  await page.waitForTimeout(220);
  assert.deepEqual(
    await snapshot(page),
    before,
    label + ": all visual motion pauses",
  );
  assert.ok(
    (
      await page
        .locator("[data-loading-letter], [data-loading-fill]")
        .evaluateAll((nodes) =>
          nodes.map((node) => getComputedStyle(node).animationPlayState),
        )
    ).every((state) => state === "paused"),
  );
}
async function assertCleanup(page, observerExpected = true) {
  await page.evaluate(() => window.unmountLoading());
  await page.waitForFunction(
    () => document.querySelectorAll(".ws-loading__logo").length === 0,
    null,
    { polling: 25 },
  );
  await page.evaluate(() => {
    window.loadingQA.setHidden(false);
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pageshow"));
    window.loadingQA.staleIntersection();
  });
  const state = await page.evaluate(() => window.loadingQA.state());
  assert.equal(await page.locator(".ws-loading").count(), 0);
  assert.ok(
    Object.values(state.listeners).every((count) => count === 0),
    "all lifecycle and exit listeners removed",
  );
  if (observerExpected)
    assert.ok(state.disconnects > 0, "intersection disconnected");
}
async function checkLayout(page, width, label, directory) {
  await page.setViewportSize({ width, height: 900 });
  await page.locator("[data-loading-letter]").first().waitFor();
  assert.equal(await page.getByRole("status", { name: "처리 중" }).count(), 1);
  assert.equal(
    (await page.locator("#root").textContent()).replace(/\s+/g, ""),
    "",
  );
  assert.equal(await page.locator("[data-loading-letter]").count(), 7);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    label + ": no horizontal overflow",
  );
  const scope = new URL(page.url()).searchParams.get("scope") || "container";
  const mode = new URL(page.url()).searchParams.get("mode") || "page";
  if (scope === "container" && mode === "overlay") {
    await page.waitForFunction(() => {
      const parent = document.getElementById("source-container"),
        surface = parent?.querySelector(".ws-loading-surface"),
        logo = surface?.querySelector(".ws-loading__logo");
      if (!surface || !logo) return false;
      const box = surface.getBoundingClientRect(),
        mark = logo.getBoundingClientRect();
      return (
        Math.abs(box.width - parent.clientWidth) < 1 &&
        Math.abs(mark.x + mark.width / 2 - box.x - box.width / 2) < 1
      );
    });
  }
  const box = await page.locator(".ws-loading__logo").boundingBox();
  const surface = page.locator(".ws-loading-surface");
  const surfaceBox = await surface.boundingBox();
  assert.ok(
    Math.abs(box.x + box.width / 2 - (surfaceBox.x + surfaceBox.width / 2)) < 1,
    label + ": centered",
  );
  assert.ok(
    box.width <= (scope === "container" && mode === "inline" ? 192 : 288) + 1,
    label + ": responsive logo maximum",
  );
  const screen = await surface.evaluate((node) => {
    const box = node.getBoundingClientRect(),
      css = getComputedStyle(node);
    return {
      body: node.parentElement === document.body,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      blur: css.backdropFilter || css.webkitBackdropFilter,
      background: css.backgroundColor,
      scope: node.dataset.loadingScope,
    };
  });
  assert.equal(screen.blur, "blur(4px)");
  assert.equal(screen.background, "rgba(255, 255, 255, 0.6)");
  assert.equal(screen.scope, scope);
  if (scope === "screen")
    assert.deepEqual(
      screen,
      {
        body: true,
        x: 0,
        y: 0,
        width,
        height: 900,
        blur: "blur(4px)",
        background: "rgba(255, 255, 255, 0.6)",
        scope: "screen",
      },
      label + ": one consistent full viewport backdrop",
    );
  else {
    assert.equal(
      screen.body,
      false,
      label + ": local surface stays in its container",
    );
    const parent = await page.locator("#source-container").boundingBox();
    assert.ok(
      Math.abs(screen.x - parent.x) < 1 &&
        Math.abs(screen.width - parent.width) < 1,
      label + ": width follows its parent",
    );
    assert.ok(
      screen.height >= (mode === "inline" ? 112 : 240),
      label + ": reserved local height",
    );
    const position = await surface.evaluate(
      (node) => getComputedStyle(node).position,
    );
    assert.ok(
      mode === "overlay"
        ? position === "absolute"
        : ["static", "relative"].includes(position),
      label + ": local layout mode",
    );
    assert.equal(await page.locator(".ws-loading-screen").count(), 0);
  }
  assert.equal(
    await page.locator("#root").evaluate((node) => node.inert),
    scope === "screen",
  );
  await page.screenshot({ path: path.join(directory, label + ".png") });
}
async function seekFill(page, ms) {
  return page.evaluate((ms) => {
    const node = document.querySelector("[data-loading-fill]");
    const animation = node.getAnimations()[0];
    animation.pause();
    animation.currentTime = ms;
    return new DOMMatrixReadOnly(getComputedStyle(node).transform).a;
  }, ms);
}
async function checkExit(page, error = false) {
  await page.waitForTimeout(150);
  const oldExits = await page.evaluate(
    () => window.loadingQA.state().exits.length,
  );
  const expectedBox = await page.locator(".ws-loading-surface").boundingBox();
  const expectedScope =
    new URL(page.url()).searchParams.get("scope") || "container";
  await page.evaluate((error) => window.finishLoading(error), error);
  await page
    .getByRole("heading", { name: error ? "연결 오류" : "준비 완료" })
    .waitFor();
  await page.waitForFunction(
    (old) => window.loadingQA.state().exits.length > old,
    oldExits,
    { polling: 10 },
  );
  const exit = await page.evaluate(() => window.loadingQA.state().exits.at(-1));
  assert.equal(exit.ariaHidden, "true");
  assert.equal(exit.pointerEvents, "none");
  assert.equal(exit.surface.blur, "blur(4px)");
  assert.equal(exit.surface.background, "rgba(255, 255, 255, 0.6)");
  assert.equal(exit.surface.pointerEvents, "none");
  assert.equal(exit.surface.scope, expectedScope);
  assert.equal(exit.surface.body, expectedScope === "screen");
  for (const key of ["x", "y", "width", "height"])
    assert.ok(
      Math.abs(exit.surface.box[key] - expectedBox[key]) < 1,
      "exit retains its own surface bounds: " + key,
    );
  assert.equal(exit.surface.coversViewport, expectedScope === "screen");
  assert.deepEqual(exit.surface.durations, [240]);
  assert.deepEqual(
    exit.animations
      .map((animation) => animation.duration)
      .sort((a, b) => a - b),
    [180, 240],
  );
  const fill = exit.animations.find((animation) => animation.duration === 180);
  assert.equal(fill.frames.at(-1).transform, "scaleX(1)");
  if (!error) {
    await page.getByRole("button", { name: "계속" }).click();
    assert.equal(await page.evaluate(() => window.clicked), true);
  }
  await page.waitForFunction(
    () => document.querySelectorAll(".ws-loading__logo--exit").length === 0,
    null,
    { polling: 25 },
  );
  assert.equal(await page.locator(".ws-loading-exit-surface").count(), 0);
  return exit;
}

async function checkScopedContainers(browser, directory, result) {
  const fixture = await makePage(browser),
    { page } = fixture;
  const localSurface = (id) => page.locator(`#scope-${id} .ws-loading-surface`);
  const assertArea = async (id) => {
    await localSurface(id).waitFor();
    const area = await page.locator(`#scope-${id}`).boundingBox();
    const surface = await localSurface(id).boundingBox();
    for (const key of ["x", "y", "width", "height"])
      assert.ok(
        Math.abs(area[key] - surface[key]) < 1,
        `${id}: local overlay matches parent ${key}`,
      );
    const state = await localSurface(id).evaluate((node) => ({
      scope: node.dataset.loadingScope,
      position: getComputedStyle(node).position,
      blur:
        getComputedStyle(node).backdropFilter ||
        getComputedStyle(node).webkitBackdropFilter,
      background: getComputedStyle(node).backgroundColor,
      parentInert: node.parentElement.inert,
      parent: node.parentElement.id,
    }));
    assert.deepEqual(state, {
      scope: "container",
      position: "absolute",
      blur: "blur(4px)",
      background: "rgba(255, 255, 255, 0.6)",
      parentInert: false,
      parent: `scope-${id}`,
    });
    assert.equal(
      await page.locator(`#${id}-input`).evaluate((node) => {
        node.focus();
        return node === document.activeElement;
      }),
      false,
      `${id}: only pending content rejects focus`,
    );
    assert.equal(
      await page.locator(`#scope-${id} article`).evaluate((node) => node.inert),
      true,
    );
  };
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url + "?mode=scoped&strict=1");
    await assertArea("a");
    await assertArea("b");
    assert.equal(await page.locator(".ws-loading-screen").count(), 0);
    assert.equal(
      await page.locator("#root").evaluate((node) => node.inert),
      false,
    );
    assert.equal(await page.evaluate(() => document.body.style.overflowY), "");
    assert.equal(
      await page.getByRole("status", { name: "처리 중" }).count(),
      2,
      "independent containers keep independent surfaces",
    );
    const ids = await page
      .locator("clipPath[id]")
      .evaluateAll((nodes) => nodes.map((node) => node.id));
    assert.equal(
      new Set(ids).size,
      ids.length,
      "independent logos have unique clip IDs",
    );
    await assert.rejects(
      page.locator("#a-button").click({ timeout: 300 }),
      /Timeout/,
      "pending local content rejects pointer input",
    );
    await page.locator("#outside-nav").click();
    await page.locator("#outside-button").click();
    await page.locator("#outside-input").fill(`외부 입력 ${width}`);
    assert.equal(
      await page.locator("#outside-input").inputValue(),
      `외부 입력 ${width}`,
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "outside-input",
    );
    assert.deepEqual(await page.evaluate(() => window.scopedClicks), {
      nav: 1,
      outside: 1,
    });
    await page.locator("#outside-scroll").hover();
    await page.mouse.wheel(0, 180);
    await page.waitForFunction(
      () => document.getElementById("outside-scroll").scrollTop > 0,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "scoped loading adds no horizontal overflow",
    );
    await page.screenshot({
      path: path.join(directory, `scoped-${width}.png`),
    });
    await page.locator("#bottom-button").click();
    assert.ok(
      await page.evaluate(() => scrollY > 0),
      "long page remains scrollable during local loading",
    );
    assert.equal(await page.evaluate(() => window.scopedClicks.bottom), 1);
    await page.waitForFunction(() =>
      document
        .querySelector("#scope-a .ws-loading")
        ?.classList.contains("ws-loading--paused"),
    );
  }
  await page.evaluate(() => scrollTo(0, 0));
  await waitRunning(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  result.motion.push(await assertMotion(page, "container reduced motion"));
  const retainedClip = await page
    .locator("#scope-b clipPath")
    .first()
    .getAttribute("id");
  await page.evaluate(() => window.localSet("duplicate", true));
  assert.equal(
    await localSurface("b").count(),
    1,
    "same-parent requests share one local surface",
  );
  await page.evaluate(() => window.localSet("b", false));
  await assertArea("b");
  assert.equal(
    await page.locator("#scope-b clipPath").first().getAttribute("id"),
    retainedClip,
    "same-parent partial completion keeps its animation",
  );
  await page.evaluate(() => {
    window.localSet("b", true);
    window.localSet("duplicate", false);
  });
  const oldExits = await page.evaluate(
    () => window.loadingQA.state().exits.length,
  );
  await page.evaluate(() => {
    window.pauseLoadingExits = true;
    window.localSet("a", false);
  });
  await page.waitForFunction(
    (old) => window.loadingQA.state().exits.length > old,
    oldExits,
  );
  const exit = await page.evaluate(() => window.loadingQA.state().exits.at(-1));
  assert.equal(exit.surface.scope, "container");
  assert.equal(exit.surface.body, false);
  assert.equal(
    exit.surface.hostId,
    "scope-a",
    "completion fade remains in the completed parent",
  );
  assert.equal(exit.surface.coversViewport, false);
  assert.equal(exit.surface.pointerEvents, "none");
  assert.equal(await localSurface("a").count(), 0);
  await assertArea("b");
  assert.equal(
    await page.locator("#scope-b clipPath").first().getAttribute("id"),
    retainedClip,
    "one completion preserves the other animation",
  );
  await page.locator("#a-button").click();
  await page.locator("#outside-input").fill("완료 중에도 입력");
  assert.equal(
    await page.locator("#a-preinert").evaluate((node) => node.inert),
    true,
    "pre-existing inert remains intact",
  );
  const beforeScroll = await page
    .locator("#scope-a .ws-loading-exit-surface")
    .boundingBox();
  assert.ok(
    beforeScroll,
    "local completion exists only inside its completed parent",
  );
  await page.evaluate(() => scrollBy(0, 100));
  await page.waitForFunction(
    () => !document.querySelector(".ws-loading-exit-surface"),
  );
  assert.equal(
    await page.locator(".ws-loading__logo--exit").count(),
    0,
    "scroll removes local completion before it can drift across other content",
  );
  await page.evaluate(() => {
    window.pauseLoadingExits = false;
    document
      .querySelectorAll(".ws-loading-exit-surface")
      .forEach((node) =>
        node
          .getAnimations({ subtree: true })
          .forEach((animation) => animation.play()),
      );
  });
  await page.waitForFunction(
    () => !document.querySelector(".ws-loading-exit-surface"),
  );
  await page.evaluate(() => {
    scrollTo(0, 0);
    window.localHide("b", true);
  });
  await localSurface("b").waitFor({ state: "hidden" });
  await page.locator("#outside-nav").click();
  await page.evaluate(() => window.localHide("b", false));
  await assertArea("b");
  await page.evaluate(() => window.localSet("a", true));
  await assertArea("a");
  await page.locator("#bottom-button").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#scope-a .ws-loading")
      ?.classList.contains("ws-loading--paused"),
  );
  const beforeOffscreen = await page.evaluate(
    () => window.loadingQA.state().exits.length,
  );
  await page.evaluate(() => window.localSet("a", false));
  await page.waitForTimeout(80);
  assert.equal(
    await page.evaluate(() => window.loadingQA.state().exits.length),
    beforeOffscreen,
    "offscreen completion leaves no fade elsewhere",
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator("#open-dialog").click();
  await assertArea("dialog");
  assert.equal(
    await page.locator("#scoped-modal").evaluate((node) => node.inert),
    false,
    "local work does not inert the whole native dialog",
  );
  assert.equal(
    await page.locator(".ws-loading-screen").count(),
    0,
    "local work does not create another native modal",
  );
  await page.locator("#dialog-outside").fill("수정한 상세 초안");
  await page.locator("#close-dialog").click();
  await page.locator("#scoped-modal").waitFor({ state: "hidden" });
  await page.locator("#outside-button").click();
  await page.locator("#open-dialog").click();
  await assertArea("dialog");
  assert.equal(
    await page.locator("#dialog-outside").inputValue(),
    "수정한 상세 초안",
  );
  await page.evaluate(() => window.localSet("dialog", false));
  await page.locator("#dialog-button").click();
  await page.locator("#close-dialog").click();
  await page.waitForFunction(
    () => !document.querySelector(".ws-loading-exit-surface"),
  );
  await assertCleanup(page);
  assert.deepEqual(fixture.errors, []);
  assert.ok(
    fixture.requests.every(
      (request) =>
        request.url.startsWith(url) &&
        request.method === "GET" &&
        !["xhr", "fetch", "websocket"].includes(request.type),
    ),
    "container interactions never request backend data",
  );
  result.checks.push(
    "Container boundaries at 320/390/768/1440px: independent pending work, local inert only, outside navigation/input/scroll, retained sibling animation, local completion/scroll/cleanup, hidden panel, native dialog close/draft and offscreen completion",
  );
  await page.close();
}

async function runEngine(engine) {
  const type = ["msedge", "chrome"].includes(engine) ? "chromium" : engine;
  const browser = await playwright[type].launch({
    headless: true,
    ...(type !== engine ? { channel: engine } : {}),
  });
  const directory = path.join(evidence, engine);
  await fs.mkdir(directory, { recursive: true });
  const result = {
    engine,
    version: browser.version(),
    checks: [],
    motion: [],
    compatibility: [],
  };
  try {
    await checkScopedContainers(browser, directory, result);
    const main = await makePage(browser),
      { page } = main;
    await page.goto(url);
    await waitRunning(page);
    for (const mode of ["page", "inline", "overlay"]) {
      await page.goto(url + "?mode=" + mode);
      await waitRunning(page);
      for (const width of [320, 390, 768, 1280, 1440])
        await checkLayout(page, width, mode + "-" + width, directory);
    }
    result.checks.push(
      "Page/inline/overlay at 320/390/768/1280/1440px: seven glyphs, accessible status, centered, no horizontal overflow",
    );
    await page.goto(url);
    await waitRunning(page);
    result.motion.push(await assertMotion(page, "no-preference"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    result.motion.push(await assertMotion(page, "runtime reduce"));
    await page.emulateMedia({ reducedMotion: "no-preference" });
    result.motion.push(await assertMotion(page, "runtime no-preference"));
    const activityBefore = await page.evaluate(() => window.loadingQA.state());
    await page.waitForTimeout(500);
    const activityAfter = await page.evaluate(() => window.loadingQA.state());
    assert.equal(
      activityAfter.frameCalls,
      activityBefore.frameCalls,
      "no animation frame loop",
    );
    assert.equal(
      activityAfter.timerCalls,
      activityBefore.timerCalls,
      "no animation timer loop",
    );
    const times = [0, 1500, 4500, 10500, 19500, 30000, 60000],
      fills = [];
    for (const time of times) fills.push(await seekFill(page, time));
    assert.deepEqual(
      fills.map((value) => +value.toFixed(2)),
      [0, 0.32, 0.58, 0.78, 0.89, 0.94, 0.94],
    );
    const rates = fills
      .slice(1, -1)
      .map((value, i) => (value - fills[i]) / (times[i + 1] - times[i]));
    assert.ok(
      rates.every((rate, i) => i === 0 || rate < rates[i - 1]),
      "pending color slows and never completes early",
    );
    result.fill = { times, fills };
    await seekFill(page, 4500);
    await page.screenshot({ path: path.join(directory, "partial-color.png") });
    await page.goto(url);
    await waitRunning(page);
    assert.deepEqual(
      await page.evaluate(() => window.loadingQA.state().targets),
      ["DIV"],
    );
    await page.evaluate(() => window.loadingQA.setHidden(true));
    await assertPaused(page, "hidden");
    await page.evaluate(() => window.loadingQA.setHidden(false));
    await waitRunning(page);
    result.motion.push(await assertMotion(page, "visible resumes"));
    await page.evaluate(() => {
      document.querySelector(".ws-loading").style.transform =
        "translateY(2000px)";
    });
    await assertPaused(page, "offscreen");
    await page.evaluate(() => {
      document.querySelector(".ws-loading").style.transform = "";
      window.scrollTo(0, 0);
    });
    await waitRunning(page);
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await assertPaused(page, "pagehide");
    await page.evaluate(() => {
      for (let i = 0; i < 3; i++) window.dispatchEvent(new Event("pageshow"));
    });
    await waitRunning(page);
    result.motion.push(await assertMotion(page, "pageshow resumes"));
    assert.equal(
      await page.evaluate(() => window.loadingQA.state().listeners.pageshow),
      1,
    );
    await assertCleanup(page);
    assert.deepEqual(main.errors, []);
    result.checks.push(
      "CSS-only motion: no requestAnimationFrame/timer loop; slow 94% plateau; hidden/offscreen/pagehide pause and clean resume/unmount",
    );
    await page.close();

    const mobile = await makePage(browser, "normal", {
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      ...(type !== "firefox" ? { isMobile: true } : {}),
      reducedMotion: "reduce",
    });
    await mobile.page.goto(url);
    await waitRunning(mobile.page);
    result.motion.push(await assertMotion(mobile.page, "initial reduce touch"));
    await checkLayout(mobile.page, 390, "touch-reduce-390", directory);
    await checkLayout(mobile.page, 320, "touch-reduce-320", directory);
    await assertCleanup(mobile.page);
    assert.deepEqual(mobile.errors, []);
    await mobile.page.close();

    for (const scenario of [
      "missing-matchMedia",
      "legacy-matchMedia",
      "missing-IntersectionObserver",
      "missing-requestAnimationFrame",
      "missing-cancelAnimationFrame",
      "missing-animate",
    ]) {
      const c = await makePage(browser, scenario, { reducedMotion: "reduce" });
      await c.page.goto(url);
      await waitRunning(c.page);
      await assertMotion(c.page, scenario);
      await assertCleanup(c.page, scenario !== "missing-IntersectionObserver");
      assert.deepEqual(c.errors, []);
      result.compatibility.push(scenario);
      await c.page.close();
    }
    const life = await makePage(browser),
      lp = life.page;
    await lp.goto(url);
    await waitRunning(lp);
    result.fastExit = await checkExit(lp);
    await lp.evaluate(() => window.startLoading());
    await waitRunning(lp);
    await seekFill(lp, 30000);
    result.slowExit = await checkExit(lp, true);
    await lp.getByRole("button", { name: "다시 시도" }).click();
    await waitRunning(lp);
    await assertMotion(lp, "error retry restarts");
    const before = await lp.evaluate(
      () => window.loadingQA.state().exits.length,
    );
    await lp.evaluate(() => window.replaceLoading());
    await waitRunning(lp);
    await lp.waitForTimeout(300);
    assert.equal(
      await lp.evaluate(() => window.loadingQA.state().exits.length),
      before,
      "continuous same-place loading must not finish visually",
    );
    await lp.evaluate(() => window.finishLoading());
    await lp.waitForTimeout(300);
    const instantBefore = await lp.evaluate(
      () => window.loadingQA.state().exits.length,
    );
    await lp.evaluate(() => window.instantLoading());
    await lp.waitForTimeout(300);
    assert.equal(
      await lp.evaluate(() => window.loadingQA.state().exits.length),
      instantBefore,
      "sub-100ms waits do not flash an exit",
    );
    await lp.evaluate(() => window.startLoading());
    await waitRunning(lp);
    await lp.waitForTimeout(150);
    await lp.evaluate(() => {
      window.finishLoading();
      queueMicrotask(() => window.loadingQA.setHidden(true));
    });
    await lp.waitForTimeout(100);
    assert.equal(
      await lp.locator(".ws-loading__logo--exit").count(),
      0,
      "hidden exit cleans up",
    );
    await assertCleanup(lp);
    assert.deepEqual(life.errors, []);
    await lp.close();
    result.checks.push(
      "Fast and slow exits fully fill in 180ms/fade in 240ms without blocking content; errors remain actionable, retry resets; rapid and consecutive loading have no false exit",
    );
    const screenLife = await makePage(browser);
    await screenLife.page.goto(url + "?scope=screen");
    await waitRunning(screenLife.page);
    result.screenExit = await checkExit(screenLife.page);
    await assertCleanup(screenLife.page);
    assert.deepEqual(screenLife.errors, []);
    await screenLife.page.close();

    for (const mode of ["page", "multiple"]) {
      const strict = await makePage(browser),
        sp = strict.page;
      await sp.goto(url + "?strict=1&scope=screen&mode=" + mode);
      await waitRunning(sp);
      await sp.waitForTimeout(180);
      assert.equal(
        await sp.locator(".ws-loading__logo--exit").count(),
        0,
        "StrictMode leaves no ghost",
      );
      const ids = await sp
        .locator("clipPath[id]")
        .evaluateAll((nodes) => nodes.map((n) => n.id));
      assert.equal(
        new Set(ids).size,
        ids.length,
        "multiple instances have unique clips",
      );
      const expected = 1;
      assert.equal(
        await sp.evaluate(
          () => window.loadingQA.state().listeners.visibilitychange,
        ),
        expected,
        "StrictMode keeps one listener per loader",
      );
      assert.equal(
        await sp.locator(".ws-loading-screen").count(),
        1,
        "concurrent requests share one screen",
      );
      if (mode === "multiple") {
        const clip = await sp.locator("clipPath").first().getAttribute("id");
        await sp.evaluate(() => window.finishFirstLoading());
        assert.equal(
          await sp.locator(".ws-loading-screen").count(),
          1,
          "partial completion keeps overlay",
        );
        assert.equal(
          await sp.locator("clipPath").first().getAttribute("id"),
          clip,
          "partial completion keeps original animation",
        );
      }
      await assertCleanup(sp);
      assert.deepEqual(strict.errors, []);
      await sp.close();
    }
    result.checks.push(
      "Development StrictMode cleanup and multiple-instance unique IDs/lifecycle listeners",
    );
    const nested = await makePage(browser);
    await nested.page.goto(url + "?mode=inline&nested=1&scope=screen");
    await waitRunning(nested.page);
    await checkLayout(nested.page, 1280, "nested-container-1280", directory);
    await nested.page.evaluate(() => {
      const button = document.createElement("button");
      button.id = "late-modal";
      button.textContent = "추가 모달";
      document.body.append(button);
    });
    await nested.page.waitForFunction(
      () => document.querySelector("#late-modal").inert,
    );
    await nested.page.evaluate(() => window.finishLoading());
    await nested.page.getByRole("button", { name: "계속" }).waitFor();
    assert.equal(
      await nested.page.locator("#root").evaluate((n) => n.inert),
      false,
    );
    assert.equal(
      await nested.page.locator("#late-modal").evaluate((n) => n.inert),
      false,
    );
    assert.equal(
      await nested.page.evaluate(() => document.body.style.overflowY),
      "",
    );
    assert.deepEqual(nested.errors, []);
    await nested.page.close();
    result.checks.push(
      "Shared body portal escapes transformed/clipped parents and existing/new modal backgrounds; restores inert and scroll after last request",
    );
    const hiddenPanel = await makePage(browser);
    await hiddenPanel.page.goto(url + "?scope=screen");
    await hiddenPanel.page.evaluate(() => window.showHiddenLoading());
    await hiddenPanel.page.waitForFunction(
      () => !document.querySelector(".ws-loading-screen"),
    );
    assert.equal(
      await hiddenPanel.page.locator("#root").evaluate((n) => n.inert),
      false,
      "hidden panel never blocks current screen",
    );
    await hiddenPanel.page.evaluate(
      () => (document.querySelector("#hidden-panel").hidden = false),
    );
    await waitRunning(hiddenPanel.page);
    await hiddenPanel.page.evaluate(
      () => (document.querySelector("#hidden-panel").style.display = "none"),
    );
    await hiddenPanel.page.waitForFunction(
      () => !document.querySelector(".ws-loading-screen"),
    );
    await hiddenPanel.page.evaluate(
      () => (document.querySelector("#hidden-panel").style.display = ""),
    );
    await waitRunning(hiddenPanel.page);
    await assertCleanup(hiddenPanel.page);
    assert.deepEqual(hiddenPanel.errors, []);
    await hiddenPanel.page.close();
    result.checks.push(
      "Hidden mounted tabs stay nonblocking; hidden/style changes register only the visible pending request and clean up",
    );
    const native = await makePage(browser),
      nd = native.page;
    await nd.goto(url + "?scope=screen");
    await nd.evaluate(() => window.nativeLoading());
    await nd.waitForFunction(
      () => !document.querySelector(".ws-loading-screen"),
    );
    await nd.evaluate(() =>
      document.querySelector("#native-dialog").showModal(),
    );
    await waitRunning(nd);
    assert.equal(
      await nd
        .locator(".ws-loading-screen")
        .evaluate((n) => n.matches(":modal")),
      true,
      "loading enters the native top layer",
    );
    await nd.evaluate(() => document.querySelector("#native-draft").focus());
    assert.notEqual(
      await nd.evaluate(() => document.activeElement?.id),
      "native-draft",
      "underlying native modal remains blocked",
    );
    await nd.keyboard.press("Escape");
    assert.equal(
      await nd.locator(".ws-loading-screen").evaluate((n) => n.open),
      true,
      "Escape cannot hide a pending loader",
    );
    await nd.evaluate(() => document.querySelector("#native-dialog").close());
    await nd.waitForFunction(
      () => !document.querySelector(".ws-loading-screen"),
    );
    await nd.evaluate(() =>
      document.querySelector("#native-dialog").showModal(),
    );
    await waitRunning(nd);
    await nd.waitForTimeout(160);
    await nd.evaluate(() => window.nativeLoading(false));
    await nd.waitForFunction(
      () => !document.querySelector(".ws-loading-screen"),
    );
    assert.equal(await nd.locator("#native-draft").inputValue(), "보존할 초안");
    assert.equal(
      await nd.evaluate(() => document.activeElement?.id),
      "native-draft",
      "native dialog draft focus restored",
    );
    await nd.waitForFunction(
      () => !document.querySelector(".ws-loading-exit-surface"),
    );
    assert.deepEqual(native.errors, []);
    await nd.close();
    result.checks.push(
      "Native modal requests open/close with their source, cover the browser top layer, block background keys and restore the draft/focus",
    );
    const network = await makePage(browser),
      np = network.page;
    await np.goto(url + "?mode=multiple");
    await waitRunning(np);
    await np.waitForTimeout(1200);
    assert.equal(
      network.requests.filter((r) => r.type === "image").length,
      1,
      "one shared optimized logo fetch for multiple loaders",
    );
    assert.ok(
      network.requests.every(
        (r) =>
          r.url.startsWith(url) &&
          r.method === "GET" &&
          !["fetch", "xhr", "websocket"].includes(r.type),
      ),
      "no backend calls, writes or external media requests",
    );
    result.network = network.requests;
    await assertCleanup(np);
    assert.deepEqual(network.errors, []);
    await np.close();
    result.checks.push(
      "Exactly one shared WebP fetch; no fetch/XHR/WebSocket, writes, polling or external requests",
    );
    result.passed = true;
  } catch (error) {
    result.passed = false;
    result.error = error.stack || String(error);
    for (const [i, page] of browser
      .contexts()
      .flatMap((c) => c.pages())
      .entries())
      await page
        .screenshot({ path: path.join(directory, `failure-${i}.png`) })
        .catch(() => {});
  } finally {
    await browser.close();
    await fs.writeFile(
      path.join(directory, "loading-checks.json"),
      JSON.stringify(result, null, 2),
    );
  }
  return result;
}
const results = [];
try {
  for (const engine of engines) {
    try {
      results.push(await runEngine(engine));
    } catch (error) {
      results.push({
        engine,
        passed: false,
        error: error.stack || String(error),
      });
    }
    const latest = results.at(-1);
    console.log(
      `${engine}: ${latest.passed ? "PASS" : "FAIL"}${latest.error ? "\n" + latest.error : ""}`,
    );
  }
  await fs.writeFile(
    path.join(evidence, "loading-checks.json"),
    JSON.stringify(
      {
        engines,
        results,
        limitations:
          "Automated desktop engines and emulated touch viewports; no physical iOS/Android device verification.",
      },
      null,
      2,
    ),
  );
  assert.ok(
    results.length > 0 && results.every((result) => result.passed),
    "One or more loading browser checks failed",
  );
  console.log("Evidence: " + evidence);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
