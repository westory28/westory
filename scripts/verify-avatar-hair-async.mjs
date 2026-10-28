/** Local-only production AvatarStage lifecycle QA; no auth or user records. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createRequire } from "node:module";
import { build } from "esbuild";
const root = process.cwd(),
  out = path.join(root, "output/avatar-hair-async-20261028"),
  require = createRequire(import.meta.url);
await fs.mkdir(out, { recursive: true });
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
const entry = `import React,{useRef,useState} from 'react';import{createRoot}from'react-dom/client';import AvatarStage from './src/features/avatar/AvatarStage.tsx';import{defaultAvatarLook}from './src/features/avatar/catalog.ts';
const qa=window.hairQA={events:[],saves:0,stage:null};
function App(){const[look,setLook]=useState(defaultAvatarLook('boy'));const[mounted,setMounted]=useState(true);const[ready,setReady]=useState(false);const[error,setError]=useState('');const desired=useRef(look);desired.current=look;
qa.choose=next=>setLook(old=>({...old,...next}));qa.unmount=()=>{setMounted(false);setReady(false);qa.disposedStage=qa.stage;qa.stage=null};qa.mount=(character='boy')=>{setLook(defaultAvatarLook(character));setMounted(true);setReady(false);setError('')};
qa.visible=value=>{Object.defineProperty(document,'hidden',{configurable:true,value:!value});document.dispatchEvent(new Event('visibilitychange'))};
return <><div id="stage-shell" style={{width:384,height:384}}>{mounted&&<AvatarStage look={look} active onLoadingChange={loading=>{if(loading){setReady(false);qa.stage=null}}} onError={error=>{setReady(false);setError(error.message)}} onReady={stage=>{qa.stage=stage;stage.focusItem('hairStyle');stage.stop();qa.events.push({character:stage.character,look:{...desired.current}});setReady(true);setError('')}}/>}</div><button id="save" disabled={!mounted||!ready} onClick={()=>qa.saves++}>Save</button><output id="error">{error}</output><span id="state" data-ready={ready} data-character={look.character} data-style={look.hairStyle}/></>};createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  define: {
    "import.meta.env.BASE_URL": '"/"',
    "process.env.NODE_ENV": '"production"',
  },
});
const gates = new Map(),
  failures = new Map(),
  requests = [],
  cancelled = [];
function hold(style) {
  let release, started;
  const promise = new Promise((resolve) => (release = resolve)),
    begin = new Promise((resolve) => (started = resolve));
  gates.set(style, { promise, started });
  return {
    release() {
      gates.delete(style);
      release();
    },
    begin,
  };
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === "/") {
      res.setHeader("content-type", "text/html");
      res.end(
        '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#f4f6f8}</style><div id="root"></div><script type="module" src="/qa.js"></script>',
      );
      return;
    }
    if (url.pathname === "/qa.js") {
      res.setHeader("content-type", "text/javascript");
      res.end(bundle.outputFiles[0].contents);
      return;
    }
    const target = path.resolve(root, "public", "." + url.pathname);
    assert(target.startsWith(path.join(root, "public/avatar") + path.sep));
    const style = /\/hair-v3\/([^/]+)\.glb$/.exec(url.pathname)?.[1];
    if (style) {
      requests.push(style);
      res.on("close", () => {
        if (!res.writableEnded) cancelled.push(style);
      });
      const gate = gates.get(style);
      if (gate) {
        gate.started();
        await gate.promise;
      }
      if (failures.get(style)) {
        failures.set(style, failures.get(style) - 1);
        res.writeHead(503).end();
        return;
      }
    }
    if (!res.destroyed) {
      res.setHeader("cache-control", "no-store");
      res.end(await fs.readFile(target));
    }
  } catch {
    if (!res.destroyed) res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
  args: ["--enable-webgl", "--use-angle=swiftshader"],
});
const page = await browser.newPage({
  viewport: { width: 430, height: 450 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const checks = [];
const ready = () =>
  page.waitForFunction(
    () =>
      window.hairQA?.stage &&
      document.querySelector("#state").dataset.ready === "true",
    {},
    { timeout: 60000 },
  );
const choose = (look) =>
  page.evaluate((look) => window.hairQA.choose(look), look);
async function fresh(character = "boy") {
  await page.evaluate(() => window.hairQA.unmount());
  await page.waitForFunction(
    () => document.querySelectorAll("canvas").length === 0,
  );
  await page.evaluate((character) => window.hairQA.mount(character), character);
  await ready();
}
const begin = (gate) =>
  Promise.race([
    gate.begin,
    new Promise((_, reject) =>
      setTimeout(() => reject(Error("Hair request did not begin")), 15000),
    ),
  ]);
async function capture(file) {
  const png = await page.evaluate(() => window.hairQA.stage.capture());
  await fs.writeFile(
    path.join(out, file),
    Buffer.from(png.split(",")[1], "base64"),
  );
  return png;
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await ready();
  assert.equal(requests.length, 0);
  checks.push("native selection makes no external-hair request");
  const native = await capture("native-boy.png");
  const sync = await page.evaluate(() =>
    window.hairQA.stage.setLook({ hairStyle: "toben" }),
  );
  assert.equal(sync.requiresPreparation, true);
  assert.equal(
    await page.evaluate(() => window.hairQA.stage.capture()),
    native,
  );
  checks.push("unprepared synchronous setLook is atomic");
  let gate = hold("toben");
  await choose({ hairStyle: "toben" });
  await begin(gate);
  await page.waitForFunction(() => document.querySelector("#save").disabled);
  await page.evaluate(() => document.querySelector("#save").click());
  assert.equal(await page.evaluate(() => window.hairQA.saves), 0);
  gate.release();
  await ready();
  await capture("first-load-toben.png");
  await page.click("#save");
  assert.equal(await page.evaluate(() => window.hairQA.saves), 1);
  checks.push("first external load disables save until applied");
  await choose({ hairStyle: "curtain" });
  await ready();
  await choose({ hairStyle: "toben" });
  await ready();
  assert.equal(requests.filter((style) => style === "toben").length, 1);
  checks.push("reselection reuses a decoded asset");
  await fresh();
  const freshNative = await page.evaluate(() => window.hairQA.stage.capture());
  gate = hold("toben");
  await choose({ hairStyle: "toben" });
  await begin(gate);
  await choose({ hairStyle: "curtain" });
  await ready();
  const events = await page.evaluate(() => window.hairQA.events.length);
  gate.release();
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => window.hairQA.events.length), events);
  assert.equal(
    await page.evaluate(() => window.hairQA.stage.capture()),
    freshNative,
  );
  checks.push("rapid style replacement cannot apply a stale download");
  await fresh();
  gate = hold("toben");
  await choose({ hairStyle: "toben" });
  await begin(gate);
  await choose({ hairStyle: "volume" });
  await ready();
  const competingEvents = await page.evaluate(
    () => window.hairQA.events.length,
  );
  gate.release();
  await page.waitForTimeout(180);
  assert.equal(
    await page.evaluate(() => window.hairQA.events.length),
    competingEvents,
  );
  assert.equal(
    await page.evaluate(() => window.hairQA.events.at(-1).look.hairStyle),
    "volume",
  );
  checks.push(
    "a second external style wins over an older pending external load",
  );
  await fresh();
  gate = hold("toben");
  await choose({ hairStyle: "toben", hairTone: "blue" });
  await begin(gate);
  await choose({ hairTone: "rose" });
  gate.release();
  await ready();
  assert.equal(
    await page.evaluate(() => window.hairQA.events.at(-1).look.hairTone),
    "rose",
  );
  await capture("latest-tone-rose.png");
  checks.push("a newer dye selection wins while the same asset loads");
  await fresh();
  failures.set("toben", 1);
  await choose({ hairStyle: "toben" });
  await page.waitForSelector('[role="alert"]');
  assert(await page.locator("#save").isDisabled());
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await ready();
  assert(await page.locator("#save").isEnabled());
  checks.push("failed asset load keeps saving disabled and retry recovers");
  await fresh();
  gate = hold("toben");
  await choose({ hairStyle: "toben" });
  await begin(gate);
  await choose({ character: "girl", hairStyle: "bob" });
  await ready();
  const genderEvents = await page.evaluate(() => window.hairQA.events.length);
  gate.release();
  await page.waitForTimeout(180);
  assert.equal(
    await page.evaluate(() => window.hairQA.stage.character),
    "girl",
  );
  assert.equal(
    await page.evaluate(() => window.hairQA.events.length),
    genderEvents,
  );
  assert.equal(await page.locator("canvas").count(), 1);
  await capture("gender-switch-girl.png");
  checks.push("gender replacement aborts and disposes the previous stage");
  await fresh();
  gate = hold("toben");
  await choose({ hairStyle: "toben" });
  await begin(gate);
  await page.evaluate(() => window.hairQA.visible(false));
  await page.waitForFunction(
    () => document.querySelectorAll("canvas").length === 0,
  );
  const hiddenEvents = await page.evaluate(() => window.hairQA.events.length);
  gate.release();
  await page.waitForTimeout(180);
  assert.equal(
    await page.evaluate(() => window.hairQA.events.length),
    hiddenEvents,
  );
  await page.evaluate(() => window.hairQA.visible(true));
  await ready();
  checks.push(
    "hidden stage cancels pending work, disposes, and restores safely",
  );
  await fresh();
  gate = hold("toben");
  await choose({ hairStyle: "toben" });
  await begin(gate);
  await page.evaluate(() => window.hairQA.unmount());
  await page.waitForFunction(
    () => document.querySelectorAll("canvas").length === 0,
  );
  const unmountEvents = await page.evaluate(() => window.hairQA.events.length);
  gate.release();
  await page.waitForTimeout(180);
  assert.equal(
    await page.evaluate(() => window.hairQA.events.length),
    unmountEvents,
  );
  checks.push("account-like unmount prevents late work from reconnecting");
  assert(cancelled.length >= 3, "Abandoned external downloads are cancelled");
  assert.equal(errors.length, 0, errors.join("\n"));
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(
      { passed: true, checks, requests, cancelled, errors },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ passed: true, checks: checks.length, evidence: out }),
  );
} finally {
  for (const gate of gates.values()) gate.started();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
