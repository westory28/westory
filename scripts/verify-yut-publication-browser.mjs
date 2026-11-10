/** Real hook lifecycle checks with synthetic data and no application services. */
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const entry = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import usePublication from './src/components/common/weplay/useYutPublication';
const qa=window.publicationQA={calls:[],pending:[],hidden:false,hold:false,failNext:'',
  auth:{config:{year:'2026',semester:'2'},menuConfig:{student:[],teacher:[]},currentUser:{uid:'synthetic-student-a'}}};
const intervals=new Map();let intervalId=0;
window.setInterval=callback=>{const id=++intervalId;intervals.set(id,callback);return id};
window.clearInterval=id=>intervals.delete(id);
qa.tick=()=>{for(const callback of intervals.values())callback()};
Object.defineProperty(document,'hidden',{configurable:true,get:()=>qa.hidden});
qa.visible=value=>{qa.hidden=!value;document.dispatchEvent(new Event('visibilitychange'))};
function Probe({portal,includeInitialLobby}){const access=usePublication(portal,includeInitialLobby);qa.access=access;return <p>{access.status}</p>}
function Harness(){const[props,setProps]=useState({portal:'student',includeInitialLobby:new URLSearchParams(location.search).has('entry'),shown:true});
qa.update=next=>setProps(previous=>({...previous,...next}));qa.changeAccount=uid=>{qa.auth={...qa.auth,currentUser:{uid}};setProps(previous=>({...previous}))};
return props.shown?<Probe {...props}/>:<p>unmounted</p>}
createRoot(document.getElementById('root')).render(<Harness/>);`;
const yutFixture = `
const settings={enabled:true,version:1,allowSolo:true,allowMultiplayer:true,allowPrivateRooms:true,defaultPlayerCount:4,throwSeconds:5,moveSeconds:25};
async function read(name,config){const qa=window.publicationQA;qa.calls.push({name,config:{...config},uid:qa.auth.currentUser?.uid});
if(qa.failNext){const code=qa.failNext;qa.failNext='';throw Object.assign(new Error('Synthetic failure'),{code})}
const response={enabled:true,settings:{...settings},...(name==='getYutLobby'?{room:null,classes:[],classId:'',serverNowMs:Date.now()}: {})};
return qa.hold?new Promise(resolve=>qa.pending.push(value=>resolve(value||response))):response;}
export const getYutPublication=config=>read('getYutPublication',config);
export const getYutLobby=config=>read('getYutLobby',config);`;
const built = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: process.cwd() },
  bundle: true, write: false, platform: "browser", format: "esm", metafile: true,
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "publication-fixture", setup(plugin) {
    plugin.onResolve({ filter: /(?:^|\/)contexts\/AuthContext$/ }, () => ({ path: "auth", namespace: "fixture" }));
    plugin.onResolve({ filter: /(?:^|\/)lib\/yut$/ }, () => ({ path: "yut", namespace: "fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: name }) => ({
      contents: name === "auth" ? "export const useAuth=()=>window.publicationQA.auth;" : yutFixture,
      loader: "js",
    }));
  } }],
});
assert(!Object.keys(built.metafile.inputs).some(name => /node_modules[\\/](@firebase|firebase)[\\/]/.test(name)), "Fixture must not load Firebase");
const server = http.createServer((request, response) => {
  response.setHeader("content-type", request.url === "/fixture.js" ? "text/javascript" : "text/html");
  response.end(request.url === "/fixture.js" ? built.outputFiles[0].text : '<!doctype html><div id="root"></div><script type="module" src="/fixture.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = [], external = [];
try {
  browser = await playwright.chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge", headless: true });
  const context = await browser.newContext();
  await context.route("**/*", route => {
    if (route.request().url().startsWith(origin)) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const status = value => page.waitForFunction(expected => window.publicationQA.access.status === expected, value);
  const names = () => page.evaluate(() => window.publicationQA.calls.map(call => call.name));
  const tick = () => page.evaluate(() => window.publicationQA.tick());
  await page.goto(origin);
  await status("open");
  assert.deepEqual(await names(), ["getYutPublication"], "catalog never loads a lobby");
  assert.equal(await page.evaluate(() => window.publicationQA.access.lobby), undefined);
  await tick();
  await page.waitForFunction(() => window.publicationQA.calls.length === 2);
  assert.deepEqual(await names(), ["getYutPublication", "getYutPublication"]);
  await page.evaluate(() => { window.publicationQA.visible(false); window.publicationQA.tick(); });
  assert.equal((await names()).length, 2, "hidden tabs never poll");
  await page.evaluate(() => window.publicationQA.visible(true));
  await page.waitForFunction(() => window.publicationQA.calls.length === 3);
  await page.evaluate(() => { window.publicationQA.hold = true; window.publicationQA.tick(); window.publicationQA.tick(); });
  assert.equal((await names()).length, 4, "pending requests cannot overlap");
  await page.evaluate(() => { window.publicationQA.pending.shift()({ enabled: false }); window.publicationQA.hold = false; });
  await status("closed");
  await tick(); await status("open");
  await page.evaluate(() => { window.publicationQA.failNext = "unavailable"; window.publicationQA.tick(); });
  await status("error");
  await page.evaluate(() => { window.publicationQA.failNext = "permission-denied"; window.publicationQA.tick(); });
  await status("closed");
  const beforeTeacher = (await names()).length;
  await page.evaluate(() => window.publicationQA.update({ portal: "teacher" }));
  await status("open"); await tick();
  assert.equal((await names()).length, beforeTeacher, "teacher preview does not poll student publication");

  await page.evaluate(() => {
    window.publicationQA.auth.config.studentMenuVisibility = { yut: false };
    window.publicationQA.update({ portal: "student" });
  });
  await status("closed"); await tick();
  assert.equal((await names()).length, beforeTeacher, "a hidden menu never starts publication reads");
  await page.evaluate(() => {
    window.publicationQA.auth.config.studentMenuVisibility = { yut: true };
    window.publicationQA.update({ portal: "student" });
  });
  await status("open");

  await page.goto(origin + "/?entry");
  await status("open");
  assert.deepEqual(await names(), ["getYutLobby"], "game admission fetches its initial lobby once");
  const initialLobby = await page.evaluate(() => window.publicationQA.access.lobby);
  await tick();
  await page.waitForFunction(() => window.publicationQA.calls.length === 2);
  assert.deepEqual(await names(), ["getYutLobby", "getYutPublication"]);
  assert.deepEqual(await page.evaluate(() => window.publicationQA.access.lobby), initialLobby, "initial lobby remains available for admission reuse");
  await page.evaluate(() => { window.publicationQA.hold = true; window.publicationQA.tick(); });
  await page.evaluate(() => window.publicationQA.changeAccount("synthetic-student-b"));
  await status("checking");
  await page.waitForFunction(() => window.publicationQA.pending.length === 2);
  await page.evaluate(() => window.publicationQA.pending.shift()({ enabled: false }));
  await status("checking");
  await page.evaluate(() => { window.publicationQA.pending.shift()(); window.publicationQA.hold = false; });
  await status("open");
  assert.match(await page.evaluate(() => window.publicationQA.access.lobby.scope), /^synthetic-student-b:/, "old-account response cannot replace new admission");
  await tick();
  await page.waitForFunction(() => window.publicationQA.calls.length === 5);
  assert.deepEqual(await names(), ["getYutLobby", "getYutPublication", "getYutPublication", "getYutLobby", "getYutPublication"]);
  await page.evaluate(() => window.publicationQA.update({ shown: false }));
  await page.getByText("unmounted", { exact: true }).waitFor();
  await tick();
  assert.equal((await names()).length, 5, "unmount stops publication checks");
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log("PASS Yut publication: catalog-only query, one admission lobby, narrow polling, hidden/pending suppression, close/error denial, teacher preview, account isolation and unmount");
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
