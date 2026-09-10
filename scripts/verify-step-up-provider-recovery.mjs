// Actual React provider and request coordinator; synthetic auth/session/network adapters.
// This is a deterministic failure-injection test, not Google or Rules acceptance.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const output = mkdtempSync(join(tmpdir(), "westory-step-up-recovery-"));
const fixture = join(output, "fixture.tsx");
writeFileSync(fixture, `
import {useSyncExternalStore} from '${root.replaceAll("\\", "/")}/node_modules/react/index.js';
const user={uid:'synthetic-a',email:'synthetic-a@example.test',providerData:[{providerId:'password'},{providerId:'google.com'}]};
export const auth={currentUser:user};export const db={};
const listeners=new Set();let snapshot={authenticationStatus:'AUTHENTICATED',currentUser:user,userData:{uid:user.uid}};
window.trace=[];window.outcomes=[];window.offline=false;window.mode='success';window.releaseReady=null;
const publish=value=>{snapshot=value;listeners.forEach(fn=>fn());};
const ready=()=>{window.trace.push('profile-ready');publish({authenticationStatus:'AUTHENTICATED',currentUser:auth.currentUser,userData:{uid:auth.currentUser.uid}});};
const prepareForReauthentication=()=>{window.trace.push('prepare');publish({...snapshot,authenticationStatus:'AUTHENTICATING',userData:null});};
export const useAuth=()=>({...useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>snapshot),prepareForReauthentication});
let pauseGate=null;
export const disableNetwork=async()=>{window.trace.push('pause');window.offline=true;if(window.mode==='unmount-pause'){pauseGate=new Promise(resolve=>{window.releasePause=resolve;});await pauseGate;}};
export const enableNetwork=async()=>{if(pauseGate)await pauseGate;window.trace.push('resume');window.offline=false;};
export const beginApplicationSessionReauthentication=async()=>{window.trace.push('begin');if(window.mode==='unmount-begin')await new Promise(resolve=>{window.releaseBegin=resolve;});};
export const synchronizeApplicationSession=async()=>{window.trace.push('session');if(window.mode==='session-error')throw Error('Synthetic session failure');if(window.mode==='switch-session')auth.currentUser={...user,uid:'synthetic-b'};return {authorityMode:'ENFORCE',generalExpiresAt:Date.now()+60000};};
export const EmailAuthProvider={credential:()=>({})};
export class GoogleAuthProvider{setCustomParameters(){}}
const reauthenticate=async()=>{window.trace.push('reauth');if(window.mode==='wrong-password')throw Object.assign(Error('Synthetic credential failure'),{code:'auth/wrong-password'});if(window.mode==='popup-cancel')throw Object.assign(Error('Synthetic cancel'),{code:'auth/popup-closed-by-user'});if(window.mode==='switch-reauth')auth.currentUser={...user,uid:'synthetic-b'};};
export const reauthenticateWithCredential=reauthenticate;export const reauthenticateWithPopup=reauthenticate;
export const getIdTokenResult=async()=>({authTime:new Date(0).toISOString()});
export const getIdToken=async()=>{window.trace.push('token');if(window.mode==='hold-ready'||window.mode==='switch-ready'){window.releaseReady=ready;}else ready();return 'synthetic-token';};
export const NORMAL_SESSION_DURATION_MS=60000;
export const writeSessionDeadline=()=>true;export const clearSessionTiming=()=>{};
window.switchIdentity=()=>{auth.currentUser={...user,uid:'synthetic-b'};};
`);
const bundle = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {StepUpReauthProvider} from './src/components/auth/StepUpReauthProvider';import {requestStepUpReauthentication} from './src/lib/stepUpReauth';
  window.startRequest=()=>{requestStepUpReauthentication('updateAccessSettings',{force:true}).then(()=>window.outcomes.push('success'),e=>window.outcomes.push(e.code));};
  const root=createRoot(document.getElementById('root'));window.unmountProvider=()=>root.unmount();root.render(<StepUpReauthProvider><button onClick={()=>window.startRequest()}>보호 작업</button></StepUpReauthProvider>);`, resolveDir: root, loader: "tsx" },
  bundle: true, write: false, platform: "browser", format: "iife", metafile: true,
  define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" },
  plugins: [{ name: "synthetic-step-up-adapters", setup(api) {
    api.onResolve({ filter: /^firebase\/(auth|firestore)$|\/lib\/(firebase|applicationSession|sessionPolicy)$|\/contexts\/AuthContext$/ }, () => ({ path: fixture }));
  } }],
});
assert.ok(!Object.keys(bundle.metafile.inputs).some(path => path.includes("node_modules/@firebase/")));
const cssName = readdirSync("dist/assets").find(name => /^main-.*\.css$/.test(name));
const css = readFileSync(join("dist/assets", cssName));
const server = createServer((req, res) => {
  res.setHeader("Content-Security-Policy", "default-src 'self';connect-src 'none';style-src 'self' 'unsafe-inline';font-src 'none';img-src 'self' data:;script-src 'self'");
  res.setHeader("Content-Type", req.url === "/app.js" ? "text/javascript" : req.url === "/app.css" ? "text/css" : "text/html");
  res.end(req.url === "/app.js" ? bundle.outputFiles[0].contents : req.url === "/app.css" ? css : '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
const results = [];
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  for (const viewport of [{width:390,height:844},{width:768,height:1024},{width:1024,height:768},{width:1280,height:800},{width:1600,height:900}]) {
    await page.setViewportSize(viewport);
    for (const method of ["password", "google"]) {
      for (const mode of ["success", "switch-reauth", "switch-session", "hold-ready", "switch-ready", "unmount-begin", "unmount-pause", method === "password" ? "wrong-password" : "popup-cancel", "session-error"]) {
        await page.goto(`http://127.0.0.1:${server.address().port}/?case=${results.length}#/teacher/lesson?retained=1`);
        await page.getByRole("button", {name:"보호 작업",exact:true}).click();
        await page.getByRole("dialog").waitFor();
        await page.evaluate(value => {window.mode=value;}, mode);
        if (method === "password") {
          await page.getByLabel("현재 비밀번호").fill("synthetic-only");
          await page.getByRole("button", {name:"비밀번호로 확인",exact:true}).click();
        } else await page.getByRole("button", {name:"Google 계정으로 다시 확인",exact:true}).click();
        if(mode.startsWith('unmount-')){
          await page.waitForFunction(mode=>mode==='unmount-begin'?!!window.releaseBegin:!!window.releasePause,mode);
          await page.evaluate(mode=>{window.unmountProvider();mode==='unmount-begin'?window.releaseBegin():window.releasePause();},mode);
          await page.waitForFunction(()=>window.outcomes.length===1&&!window.offline);
          assert.deepEqual(await page.evaluate(()=>window.outcomes),['UNAVAILABLE']);
          await page.waitForTimeout(30);
          assert.equal((await page.evaluate(()=>window.trace)).includes('reauth'),false);
          assert.equal((await page.evaluate(()=>window.trace)).includes('token'),false);
          results.push({viewport,method,mode,passed:true});continue;
        }
        if(mode==='switch-ready'){
          await page.waitForFunction(()=>!!window.releaseReady);
          await page.evaluate(()=>{window.switchIdentity();window.releaseReady();});
        }
        if (mode === "hold-ready") {
          await page.waitForFunction(() => !!window.releaseReady);
          assert.deepEqual(await page.evaluate(() => window.outcomes), []);
          assert.equal(await page.getByRole("dialog").count(), 1);
          await page.evaluate(() => window.releaseReady());
        }
        if (["success", "hold-ready"].includes(mode)) {
          await page.waitForFunction(() => window.outcomes.length === 1).catch(async error => { console.error({mode,method,trace:await page.evaluate(()=>window.trace),text:await page.locator('body').innerText()});throw error; });
          assert.deepEqual(await page.evaluate(() => window.outcomes), ["success"]);
          assert.equal(await page.evaluate(() => window.offline), false);
          assert.equal(await page.getByRole("dialog").count(), 0);
          assert.deepEqual((await page.evaluate(() => window.trace)).slice(0,6), ["begin","prepare","pause","reauth","session","token"]);
        } else if (mode.startsWith("switch-")) {
          await page.waitForFunction(() => window.outcomes.length === 1);
          assert.deepEqual(await page.evaluate(() => window.outcomes), ["IDENTITY_CHANGED"]);
          assert.equal(await page.evaluate(() => window.offline), false, `${viewport.width}/${method}/${mode}: rejected identity change must resume Firestore`);
          assert.equal((await page.evaluate(() => window.trace)).filter(item=>item==='token').length, mode==='switch-ready'?1:0, "do not refresh the old user's token after identity changes");
        } else {
          await page.getByRole("alert").waitFor();
          assert.deepEqual(await page.evaluate(() => window.outcomes), []);
          assert.equal(await page.evaluate(() => window.offline), false);
          await page.getByRole("button", {name:"취소",exact:true}).click();
          await page.waitForFunction(() => window.outcomes.length === 1);
          assert.deepEqual(await page.evaluate(() => window.outcomes), ["CANCELLED"]);
        }
        assert.ok(page.url().endsWith("#/teacher/lesson?retained=1"));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
        results.push({viewport,method,mode,passed:true});
      }
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(output,"result.json"), JSON.stringify({passed:true,scope:"actual provider with synthetic adapters; not live Google/Rules acceptance",cases:results.length,results,errors},null,2));
  console.log(JSON.stringify({passed:true,cases:results.length,output}));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
