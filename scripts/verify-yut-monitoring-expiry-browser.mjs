/** Teacher monitor: a waiting room lives ten minutes after its host last acted.
 * Real useYutMonitoring hook with a synthetic management callable; no services.
 */
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
// Another checkout's sources can be measured with this checkout's packages.
const sourceRoot = path.resolve(process.env.WESTORY_QA_SOURCE_ROOT || process.cwd());
const entry = `
import React from 'react';import{createRoot}from'react-dom/client';
import useYutMonitoring from './src/pages/teacher/components/useYutMonitoring';
function Probe(){const monitor=useYutMonitoring({year:'2026',semester:'2'},'synthetic-teacher',true);window.monitorQA.view=monitor;
return <ul>{(monitor.data?.rooms||[]).map(room=><li key={room.id}>{room.id}</li>)}</ul>}
createRoot(document.getElementById('root')).render(<Probe/>);`;
const fixture = `
const MINUTE=60000,now=Date.now();
const room=(id,values)=>({id,code:id.toUpperCase(),status:'waiting',revision:1,hostUid:'student-a',turnUid:null,players:[],...values});
const qa=window.monitorQA={reads:0,serverAheadMs:0,rooms:[
  // Created 25 minutes ago; its host acted a minute ago.
  room('kept-alive',{createdAtMs:now-25*MINUTE,hostActivityAtMs:now-MINUTE,expiresAtMs:now+9*MINUTE}),
  // The host has been idle for ten minutes minus 0.4 s.
  room('host-idle',{createdAtMs:now-30*MINUTE,hostActivityAtMs:now-10*MINUTE+400,expiresAtMs:now+400}),
  // Written before host activity was recorded: creation time decides.
  room('legacy',{createdAtMs:now-10*MINUTE+800,expiresAtMs:now+24*60*MINUTE}),
  room('playing',{status:'playing',createdAtMs:now-90*MINUTE,expiresAtMs:now+60*MINUTE}),
]};
export async function getYutManagement(){qa.reads++;
  return {settings:{enabled:true,version:1},rooms:structuredClone(qa.rooms),truncated:false,serverNowMs:Date.now()};}
export function subscribeYutManagement(_config,onChange,_onError,onConnectionChange){
  queueMicrotask(()=>{onConnectionChange?.(true);onChange();});return()=>{};}
export const yutErrorMessage=error=>error?.message||'error';`;
const built = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: sourceRoot },
  nodePaths: [path.join(process.cwd(), "node_modules")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  metafile: true,
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "management-fixture",
      setup(plugin) {
        plugin.onResolve({ filter: /(?:^|\/)lib\/yut$/ }, () => ({
          path: "yut",
          namespace: "fixture",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: fixture,
          loader: "js",
        }));
      },
    },
  ],
});
assert(
  !Object.keys(built.metafile.inputs).some((name) =>
    /node_modules[\\/](@firebase|firebase)[\\/]/.test(name),
  ),
  "Fixture must not load Firebase",
);
const server = http.createServer((request, response) => {
  response.setHeader(
    "content-type",
    request.url === "/fixture.js" ? "text/javascript" : "text/html",
  );
  response.end(
    request.url === "/fixture.js"
      ? built.outputFiles[0].text
      : '<!doctype html><div id="root"></div><script type="module" src="/fixture.js"></script>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = [];
try {
  browser = await playwright.chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const listed = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("li")].map((node) => node.textContent),
    );
  await page.goto(origin);
  await page.waitForFunction(() => window.monitorQA.view?.status === "live");
  assert.deepEqual(
    await listed(),
    ["kept-alive", "host-idle", "legacy", "playing"],
    "a waiting room older than ten minutes stays listed while its host is active",
  );
  await page.waitForFunction(
    () => !document.body.textContent.includes("host-idle"),
  );
  assert.deepEqual(await listed(), ["kept-alive", "legacy", "playing"]);
  await page.waitForFunction(
    () => !document.body.textContent.includes("legacy"),
  );
  assert.deepEqual(
    await listed(),
    ["kept-alive", "playing"],
    "a legacy waiting room still closes ten minutes after it was created",
  );
  await page.waitForTimeout(300);
  assert.deepEqual(await listed(), ["kept-alive", "playing"]);
  const reads = await page.evaluate(() => window.monitorQA.reads);
  assert.ok(
    reads >= 2 && reads <= 4,
    `each local expiry asks the server once more, without polling (${reads} reads)`,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS Yut monitor expiry: host activity keeps an old waiting room listed; ten idle minutes and legacy creation time remove one; playing rooms stay; no polling.",
  );
} finally {
  await browser?.close();
  server.close();
}
