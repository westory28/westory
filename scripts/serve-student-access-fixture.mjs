// Actual settings and command adapter; isolated synthetic state, no Firebase/network.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const output = mkdtempSync(join(tmpdir(), "westory-student-access-"));
const mock = join(output, "synthetic.tsx");
writeFileSync(mock, `
const scenario = new URLSearchParams(location.search).get('scenario');
const admin = scenario !== 'teacher';
export const ADMIN_EMAIL = 'westoria28@gmail.com';
export const auth = {currentUser:{uid:'synthetic-admin',email:admin?ADMIN_EMAIL:'synthetic-teacher@example.test'}};
export const db = {};
export const useAuth = () => ({currentUser:auth.currentUser});
export const doc = (...args) => args.slice(1).join('/');
const stamp = {toMillis:()=>Date.now()};
let config = {enabled:true,blockedRoles:['student'],bypassUids:[],title:'학생 접속 안내',message:'선생님의 안내 후 접속해 주세요.',revision:7,startedAt:stamp,updatedAt:stamp,updatedBy:'synthetic-admin'};
let reads = 0, writes = 0;
export async function getDocFromServer(path){
  if(path!=='site_settings/student_maintenance')throw Error('Unexpected read');
  reads++;
  await new Promise(r=>setTimeout(r,50));
  if(scenario==='read-error')throw Error('Synthetic offline');
  return {exists:()=>scenario!=='missing',data:()=>({...config,bypassUids:[...config.bypassUids]})};
}
export async function getHttpsCallable(name,options){
  if(name!=='updateStudentMaintenanceConfig'||options.expectedUid!==auth.currentUser.uid||!admin)throw Error('Invalid command');
  return async data=>{
    writes++;
    if(Object.keys(data).sort().join(',')!=='blockedRoles,bypassUids,enabled,message,title'||data.bypassUids.length||data.blockedRoles.join()!=='student')throw Error('Invalid payload');
    await new Promise(r=>setTimeout(r,600));
    if(scenario==='write-error')throw Error('Synthetic denied');
    config={...config,...data,revision:config.revision+1,startedAt:data.enabled?stamp:null};
    if(scenario==='lost-response')throw Error('Synthetic response lost after commit');
    return {data:{...data,revision:config.revision}};
  };
}
setInterval(()=>{document.getElementById('fixture-state').textContent=JSON.stringify({synthetic:true,reads,writes,closed:config.enabled});},50);
export default function Stub(){return null;}
`);
const result = await build({
  stdin: {contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';import Settings from './src/pages/teacher/Settings';if(!location.hash)location.hash='/teacher/settings?tab=student-access';createRoot(document.getElementById('root')).render(<HashRouter><Settings/></HashRouter>);`, resolveDir:root, loader:'tsx'},
  bundle:true, write:false, platform:'browser', format:'iife', metafile:true,
  define:{'process.env.NODE_ENV':'"development"'},
  plugins:[{name:'isolated-student-access',setup(api){api.onResolve({filter:/AuthContext$|\/firebase$|firebase\/firestore$|\/permissions$|\/Settings(?:General|School|Interface|Privacy|Access|Notifications|ArchiveEnrollment|ArchiveRecords)$/},()=>({path:mock}));}}],
});
const inputs = Object.keys(result.metafile.inputs);
assert.ok(!inputs.some(p=>/node_modules\/(?:@firebase|firebase)\//u.test(p)));
for(const file of ['SettingsStudentAccess.tsx','studentAccessSettings.ts','studentMaintenance.ts','Settings.tsx'])assert.ok(inputs.some(p=>p.endsWith(file)),file);
const assets = resolve(root,'dist/assets');
const css = readFileSync(join(assets,readdirSync(assets).find(n=>/^main-.*\.css$/u.test(n))));
const server=createServer((req,res)=>{
  const pathname = new URL(req.url,'http://127.0.0.1').pathname;
  res.setHeader('Content-Security-Policy',"default-src 'self';connect-src 'none';style-src 'self' 'unsafe-inline';font-src 'none';img-src 'self' data:;script-src 'self'");
  res.setHeader('Content-Type',pathname==='/app.js'?'text/javascript':pathname==='/app.css'?'text/css':'text/html');
  res.end(pathname==='/app.js'?result.outputFiles[0].contents:pathname==='/app.css'?css:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Westory 학생 접속 합성 검증</title><link rel="stylesheet" href="/app.css"><output id="fixture-state" aria-label="합성 검증 상태"></output><div id="root"></div><script src="/app.js"></script></html>');
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`,syntheticOnly:true,firebaseIncluded:false,scenarios:['normal','teacher','read-error','missing','write-error','lost-response']}));
