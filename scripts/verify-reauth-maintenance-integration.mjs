// Real AuthContext, session/maintenance helpers, gates and Provider; synthetic I/O.
// No Firebase credentials, external reads, or real Google login are used here.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const output = mkdtempSync(join(tmpdir(), "westory-reauth-integration-"));
const fixture = join(output, "io.tsx");
writeFileSync(fixture, `
const tokenListeners=new Set(),snapshots=new Set();let epoch=Math.floor(Date.now()/1000)-600;
const params=new URLSearchParams(location.search);window.trace=[];window.outcomes=[];window.effects=0;window.offline=false;window.mode='success';window.role=params.get('role')||'teacher';window.maintenance=params.has('maintenance');window.ioErrors=[];
const emit=()=>{window.trace.push('token-event');tokenListeners.forEach(fn=>{Promise.resolve(fn(auth.currentUser)).catch(e=>window.ioErrors.push(e.message));});};
window.refreshAuth=emit;window.userReadCount=0;
const user={uid:'synthetic-teacher',email:'synthetic@yongshin-ms.ms.kr',providerData:[{providerId:'password'},{providerId:'google.com'}],getIdToken:async()=>getIdToken()};
export const auth={currentUser:user};export const db={};export const authPersistenceReady=Promise.resolve();
export const onIdTokenChanged=(_auth,fn)=>{tokenListeners.add(fn);queueMicrotask(()=>fn(auth.currentUser));return()=>tokenListeners.delete(fn);};
export const getIdTokenResult=async()=>({authTime:new Date(epoch*1000).toISOString()});
export const getIdToken=async()=>{emit();return 'synthetic-token';};
export const signOut=async()=>{auth.currentUser=null;emit();};
window.forceSignOut=signOut;
export const EmailAuthProvider={credential:()=>({})};export class GoogleAuthProvider{setCustomParameters(){}}
const reauth=async()=>{window.trace.push('reauth');if(window.mode==='credential-error')throw Object.assign(Error('Synthetic password failure'),{code:'auth/wrong-password'});if(window.mode==='popup-cancel')throw Object.assign(Error('Synthetic cancel'),{code:'auth/popup-closed-by-user'});if(window.mode==='maintenance-changed'){window.role='student';window.maintenance=true;}epoch+=601;emit();await new Promise(r=>setTimeout(r,30));};
export const reauthenticateWithCredential=reauth;export const reauthenticateWithPopup=reauth;
export const disableNetwork=async()=>{window.trace.push('pause');window.offline=true;};
export const enableNetwork=async()=>{window.trace.push('resume');window.offline=false;};
export const getHttpsCallable=async name=>async()=>{window.trace.push('call:'+name);if(name==='beginApplicationSessionReauthentication')return{data:{expiresAt:Date.now()+60000}};if(window.mode==='session-error'&&name==='openApplicationSession')throw Error('Synthetic session failure');return {data:{status:'active',authTime:epoch,generalExpiresAt:Date.now()+1800000,highRiskExpiresAt:Date.now()+300000,authorityMode:'ENFORCE',authorityGeneration:'w1r2-2026-08-09',protocolVersion:2,revision:'a'.repeat(64)}};};
export const doc=(_db,...parts)=>({path:parts.join('/')});
const stamp={seconds:1,nanoseconds:0,toMillis:()=>1000};
const snap=ref=>({exists:()=>ref.path.startsWith('users/')||window.maintenance,data:()=>ref.path.startsWith('users/')?{uid:user.uid,email:user.email,role:window.role,name:'합성 사용자',teacherPortalEnabled:false}:{enabled:window.maintenance,blockedRoles:['student'],bypassUids:[],title:'합성 점검',message:'합성 점검 안내',startedAt:stamp,updatedAt:stamp,updatedBy:'synthetic',revision:1},metadata:{fromCache:false}});
export const getDocFromServer=async ref=>{window.trace.push('read:'+ref.path);if(ref.path.startsWith('users/'))window.userReadCount++;if(window.offline){window.trace.push('offline-read');throw Error('Synthetic offline server read');}if(window.holdProbe&&ref.path.startsWith('users/')&&window.userReadCount===2)await new Promise(resolve=>{window.releaseProbe=resolve;});if(window.failProbe&&ref.path.startsWith('users/')&&window.userReadCount>=2)throw Error('Synthetic final profile failure');await new Promise(r=>setTimeout(r,10));if(window.offline)throw Error('Synthetic late offline server read');return snap(ref);};
export const onSnapshot=(ref,...args)=>{const next=typeof args[0]==='function'?args[0]:args[1];window.trace.push('listen:'+ref.path);const record={ref,next};snapshots.add(record);queueMicrotask(()=>{if(snapshots.has(record))next(snap(ref));});return()=>{window.trace.push('unlisten:'+ref.path);snapshots.delete(record);};};
window.setMaintenance=()=>{window.maintenance=true;snapshots.forEach(({ref,next})=>{if(ref.path==='site_settings/student_maintenance')next(snap(ref));});};
window.setRole=role=>{window.role=role;};
export const readSiteSettingDoc=async()=>({year:'2026',semester:'2'});export const readFreshSiteSettingDoc=readSiteSettingDoc;export const invalidateSiteSettingDocCache=()=>{};
export const subscribeSystemConfigUpdated=()=>()=>{};export const subscribeMenuConfigUpdated=()=>()=>{};
export const markLoginPerf=()=>{};export const measureLoginPerf=()=>{};
export default ()=>null;
`);
const appSource = readFileSync("src/App.tsx", "utf8");
const providerOutside = appSource.indexOf("<StepUpReauthProvider>") < appSource.indexOf("<StudentMaintenanceGate>");
const wrapper = providerOutside ? ["StepUpReauthProvider","StudentMaintenanceGate"] : ["StudentMaintenanceGate","StepUpReauthProvider"];
const result = await build({
  stdin: {contents:`import React,{useEffect} from 'react';import{createRoot}from'react-dom/client';import{HashRouter}from'react-router-dom';import{AuthProvider,useAuth}from'./src/contexts/AuthContext';import Gate from './src/components/auth/ProtectedAccessGate';import StudentMaintenanceGate from './src/components/auth/StudentMaintenanceGate';import{StepUpReauthProvider}from'./src/components/auth/StepUpReauthProvider';import{requestStepUpReauthentication}from'./src/lib/stepUpReauth';
  function Observer(){const a=useAuth();useEffect(()=>{window.authState={status:a.authenticationStatus,maintenance:a.studentMaintenanceAccessStatus,uid:a.userData?.uid};window.trace.push('auth:'+a.authenticationStatus+':'+a.studentMaintenanceAccessStatus);},[a.authenticationStatus,a.studentMaintenanceAccessStatus,a.userData]);return null;}
  function Content(){useEffect(()=>{window.trace.push('protected-mounted');return()=>window.trace.push('protected-unmounted');},[]);return <button onClick={()=>{requestStepUpReauthentication('updateAccessSettings',{force:true}).then(()=>{window.effects++;window.outcomes.push('success');},e=>window.outcomes.push(e.code));}}>보호 작업</button>;}
  createRoot(document.getElementById('root')).render(<AuthProvider><HashRouter><Observer/><${wrapper[0]}><${wrapper[1]}><Gate><Content/></Gate></${wrapper[1]}></${wrapper[0]}></HashRouter></AuthProvider>);`,resolveDir:root,loader:"tsx"},
  bundle:true,write:false,platform:"browser",format:"iife",metafile:true,
  define:{"process.env.NODE_ENV":'"development"',"import.meta.env":"{}"},
  plugins:[{name:"synthetic-io",setup(api){api.onResolve({filter:/^\.\/firebase$|^firebase\/(auth|firestore)$|\/lib\/(firebase|siteSettings|appEvents|loginPerf)$|\/pages\/student\/Maintenance$/},()=>({path:fixture}));}}],
});
assert.ok(!Object.keys(result.metafile.inputs).some(path=>path.includes("node_modules/@firebase/")));
for(const source of ["AuthContext.tsx","applicationSession.ts","studentMaintenance.ts","StudentMaintenanceGate.tsx","StepUpReauthProvider.tsx","ProtectedAccessGate.tsx"])assert.ok(Object.keys(result.metafile.inputs).some(path=>path.endsWith(source)),source);
const css = readFileSync(join("dist/assets",readdirSync("dist/assets").find(name=>/^main-.*\.css$/.test(name))));
const server=createServer((req,res)=>{res.setHeader("Content-Security-Policy","default-src 'self';connect-src 'none';style-src 'self' 'unsafe-inline';font-src 'none';script-src 'self'");res.setHeader("Content-Type",req.url==="/app.js"?"text/javascript":req.url==="/app.css"?"text/css":"text/html");res.end(req.url==="/app.js"?result.outputFiles[0].contents:req.url==="/app.css"?css:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
let browser;const cases=[];
try{
  browser=await chromium.launch({channel:"chrome",headless:true});const page=await browser.newPage();page.setDefaultTimeout(8000);const errors=[];page.on("pageerror",e=>errors.push(e.message));
  for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1024,height:768},{width:1280,height:800},{width:1600,height:900}]){
    await page.setViewportSize(viewport);
    for(const method of ["password","google"])for(const scenario of ["success","retry","maintenance-changed"]){
      await page.goto(`http://127.0.0.1:${server.address().port}/?case=${cases.length}#/teacher/lesson?return=1`);
      await page.getByRole("button",{name:"보호 작업",exact:true}).waitFor();
      // Expire the real maintenance helper's short bootstrap dedupe cache.
      await page.waitForTimeout(2100);
      await page.evaluate(()=>{window.trace=[];});
      await page.getByRole("button",{name:"보호 작업",exact:true}).click();
      await page.evaluate(({scenario,method})=>{window.mode=scenario==='retry'?(method==='password'?'credential-error':'popup-cancel'):scenario;},{scenario,method});
      const submit=async()=>{if(method==="password"){await page.getByLabel("현재 비밀번호").fill("synthetic-only");await page.getByRole("button",{name:"비밀번호로 확인",exact:true}).click();}else await page.getByRole("button",{name:"Google 계정으로 다시 확인",exact:true}).click();};
      if(scenario==='success'&&method==='password')await page.screenshot({path:join(output,`reauth-${viewport.width}.png`)});
      await submit();
      if(scenario==='retry'){
        await page.getByRole('alert').waitFor();assert.deepEqual(await page.evaluate(()=>window.outcomes),[]);assert.equal(await page.evaluate(()=>window.offline),false);
        await page.evaluate(()=>{window.mode='success';});await submit();
      }
      await page.waitForFunction(()=>window.outcomes.length>0);
      const observed=await page.evaluate(()=>({outcomes:window.outcomes,effects:window.effects,offline:window.offline,auth:window.authState,trace:window.trace,ioErrors:window.ioErrors}));
      writeFileSync(join(output,"last-case.json"),JSON.stringify({viewport,method,observed},null,2));
      if(scenario==='maintenance-changed'){
        assert.deepEqual(observed.outcomes,['IDENTITY_CHANGED'],JSON.stringify(observed));assert.equal(observed.effects,0);assert.equal(observed.offline,false);assert.equal(observed.auth.status,'MAINTENANCE');assert.equal(observed.auth.maintenance,'blocked');assert.equal(await page.getByRole('button',{name:'보호 작업',exact:true}).count(),0);cases.push({viewport,method,scenario,passed:true});continue;
      }
      assert.deepEqual(observed.outcomes,["success"],JSON.stringify(observed));
      assert.equal(observed.effects,1);assert.equal(observed.offline,false);assert.equal(observed.auth.status,"AUTHENTICATED");assert.equal(observed.auth.maintenance,"allowed");assert.equal(observed.trace.includes("offline-read"),false);assert.deepEqual(observed.ioErrors,[]);
      assert.ok(observed.trace.indexOf("protected-unmounted")<observed.trace.indexOf("reauth"));
      assert.ok(observed.trace.lastIndexOf("read:users/synthetic-teacher")<observed.trace.lastIndexOf("protected-mounted"));
      assert.ok(page.url().endsWith("#/teacher/lesson?return=1"));
      cases.push({viewport,method,scenario,passed:true});
    }
    for(const role of ['student','malformed','teacher']){
      await page.goto(`http://127.0.0.1:${server.address().port}/?case=${cases.length}&role=${role}&maintenance=1#/teacher/lesson`);
      await page.waitForFunction(()=>['MAINTENANCE','AUTHENTICATED'].includes(window.authState?.status));
      const observed=await page.evaluate(()=>({auth:window.authState,trace:window.trace,effects:window.effects}));
      if(role==='teacher'){assert.equal(observed.auth.status,'AUTHENTICATED');assert.equal(observed.auth.maintenance,'allowed');}
      else{assert.equal(observed.auth.maintenance,'blocked');assert.equal(observed.trace.includes('call:openApplicationSession'),false);assert.equal(observed.trace.includes('protected-mounted'),false);assert.equal(observed.trace.includes('listen:users/synthetic-teacher'),false);}
      assert.equal(observed.effects,0);cases.push({viewport,role,scenario:'initial-maintenance',passed:true});
    }
    for(const probeScenario of ['delayed','sign-out','failed']){
    await page.goto(`http://127.0.0.1:${server.address().port}/?case=${cases.length}#/teacher/lesson`);
    await page.getByRole('button',{name:'보호 작업',exact:true}).waitFor();await page.waitForTimeout(2100);
    await page.evaluate(()=>{window.userReadCount=0;window.holdProbe=true;window.refreshAuth();});
    await page.waitForFunction(()=>!!window.releaseProbe);
    assert.equal(await page.evaluate(()=>window.authState.status),'AUTHENTICATING');
    assert.equal(await page.getByRole('button',{name:'보호 작업',exact:true}).count(),0);
    if(probeScenario==='sign-out')await page.evaluate(()=>window.forceSignOut());
    if(probeScenario==='failed')await page.evaluate(()=>{window.failProbe=true;});
    await page.evaluate(()=>window.releaseProbe());
    if(probeScenario==='delayed')await page.getByRole('button',{name:'보호 작업',exact:true}).waitFor();
    else {
      await page.waitForFunction(()=>['ERROR','SESSION_EXPIRED','ANONYMOUS'].includes(window.authState.status));
      await page.waitForTimeout(50);assert.equal(await page.getByRole('button',{name:'보호 작업',exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.effects),0);
    }
    cases.push({viewport,scenario:'same-uid-token-refresh-'+probeScenario,passed:true});
    }
  }
  assert.deepEqual(errors,[]);writeFileSync(join(output,"result.json"),JSON.stringify({passed:true,scope:"actual contexts/helpers/gates with synthetic I/O; not live Google/emulator",cases,errors},null,2));console.log(JSON.stringify({passed:true,cases:cases.length,output}));
}catch(error){console.error(JSON.stringify({output,cases:cases.length,message:error.message}));throw error;}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
