// Actual semester guide and policy helpers; synthetic state only; no browser launch.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const output = mkdtempSync(join(tmpdir(), "westory-semester-transition-"));
const mock = join(output, "synthetic-state.tsx");
const rootImport = root.replaceAll("\\", "/");
writeFileSync(mock, `
import React from '${rootImport}/node_modules/react/index.js';
const scenario=()=>new URLSearchParams(location.search).get('scenario')||'normal';
const pause=()=>new Promise(resolve=>setTimeout(resolve,scenario()==='slow'?1200:60));
const readyScenario=()=>['ready','revision-conflict','action-conflict','student-open'].includes(scenario());
const maintenance={enabled:scenario()!=='student-open',bypassUids:[],revision:7};
export const useAuth=()=>({currentUser:{uid:'synthetic-admin',email:scenario()==='not-admin'?'synthetic-teacher@example.invalid':'westoria28@gmail.com'},studentMaintenanceConfig:maintenance,refreshConfig:async()=>{}});
export const useAppToast=()=>({showToast:({title})=>{document.getElementById('fixture-toast').textContent=title;}});
const manifest=(semesterId,status,startDate,endDate,revision=3)=>({semesterId,schoolYear:semesterId.split('-')[0],term:semesterId.split('-')[1],displayName:semesterId.replace('-','학년도 ')+'학기',status,startDate,endDate,schemaVersion:1,revision,readinessPolicyVersion:'synthetic-policy-v1',provenance:status==='ACTIVE'?'CURRENT':status==='ARCHIVED'?'ARCHIVE':'PREPARING'});
let manifests=[manifest('2026-2','ACTIVE','2026-09-01','2027-02-28',8),manifest('2026-1','ARCHIVED','2026-03-01','2026-08-31',12),manifest('2027-1',scenario()==='failed'?'FAILED':readyScenario()?'READY':'PREPARING','2027-03-01','2027-08-31',3)];
let activePointer={semesterId:'2026-2',revision:4};
const checks=['date_range','semester_roster_readiness','archive_readiness','wis_economy_readiness','semester_cutover_readiness'];
const successful=new Set(readyScenario()?['2027-1']:[]);
const readinessReport=(item)=>{const passed=successful.has(item.semesterId);return {semesterId:item.semesterId,status:passed?'PASS':'FAIL',stale:false,policyVersion:item.readinessPolicyVersion,evaluatedRevision:item.revision,dependencyHash:'synthetic-dependencies-'+item.semesterId,requiredPassed:passed?checks.length:1,requiredTotal:checks.length,checks:checks.map((checkId,index)=>({checkId,label:checkId,required:true,status:passed||index===0?'PASS':'FAIL'}))};};
export async function loadSemesterCoreSnapshot(){await pause();if(scenario()==='error')throw new Error('synthetic offline');return {manifests:[...manifests],activePointer:{...activePointer},readinessReports:Object.fromEntries(manifests.filter(item=>item.status!=='DRAFT').map(item=>[item.semesterId,readinessReport(item)]))};}
export function resolveSemester(snapshot){const item=snapshot.manifests.find(item=>item.semesterId===snapshot.activePointer?.semesterId&&item.status==='ACTIVE');return item?{ok:true,manifest:item,provenance:'CURRENT'}:{ok:false,reason:'NO_ACTIVE_SEMESTER'};}
export async function getServerSemesterCoreState(semesterId){await pause();const requested=manifests.find(item=>item.semesterId===semesterId);return {requested:requested?{...requested,revision:requested.revision+(scenario()==='revision-conflict'?1:0)}:null,active:manifests.find(item=>item.semesterId===activePointer.semesterId),readiness:{current:successful.has(semesterId),dependencyHash:'synthetic-dependencies-'+semesterId}};}
let count=0;
export async function executeWestoryCommand(name,payload){
 const allowed=['createSemesterManifest','updateSemesterManifest','transitionSemesterStatus','validateSemesterReadiness','activateSemester'];if(!allowed.includes(name))throw new Error('Unexpected command');
 count++;document.getElementById('fixture-log').textContent=JSON.stringify({count,name,payload,studentAccessClosed:maintenance.enabled},null,2);await new Promise(resolve=>setTimeout(resolve,500));
 if(scenario()==='action-conflict')throw {reason:'SEMESTER_REVISION_CONFLICT'};
 const item=manifests.find(item=>item.semesterId===payload.semesterId);
 if(name==='createSemesterManifest'){const id=payload.schoolYear+'-'+payload.term;if(manifests.some(item=>item.semesterId===id))throw {reason:'SEMESTER_IDENTITY_EXISTS'};manifests=[...manifests,manifest(id,'DRAFT',payload.startDate,payload.endDate,1)];}
 else {if(!item||payload.expectedRevision!==item.revision)throw {reason:'SEMESTER_REVISION_CONFLICT'};
  if(name==='updateSemesterManifest'){manifests=manifests.map(row=>row===item?{...row,startDate:payload.startDate,endDate:payload.endDate,revision:row.revision+1}:row);successful.delete(item.semesterId);}
  if(name==='transitionSemesterStatus'){manifests=manifests.map(row=>row===item?{...row,status:payload.targetStatus,revision:row.revision+1}:row);}
  if(name==='validateSemesterReadiness'){manifests=manifests.map(row=>row===item?{...row,status:'VALIDATING',revision:row.revision+1}:row);}
  if(name==='activateSemester'){if(!maintenance.enabled||!successful.has(item.semesterId)||item.status!=='READY')throw {reason:'READINESS_BLOCKED'};manifests=manifests.map(row=>row===item?{...row,status:'ACTIVE',provenance:'CURRENT',revision:row.revision+1}:row.semesterId===activePointer.semesterId?{...row,status:'ARCHIVED',provenance:'ARCHIVE',revision:row.revision+1}:row);activePointer={semesterId:item.semesterId,revision:activePointer.revision+1};}
 }
 return {result:{}};
}
`);
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {HashRouter} from 'react-router-dom';import SemesterCutoverCenter from './src/pages/teacher/SemesterCutoverCenter';if(!location.hash)location.hash='/teacher/settings/cutover?targetSemesterId=2027-1';createRoot(document.getElementById('root')).render(<HashRouter><div className="border-b border-gray-200 bg-white px-6 py-4 font-bold text-blue-600">Westory 학기 전환 합성 검증</div><SemesterCutoverCenter/><p id="fixture-toast" role="status" className="px-4 text-sm text-green-700"/><details className="m-4 rounded-lg border border-gray-200 bg-white p-4"><summary>합성 명령 기록</summary><pre id="fixture-log" className="overflow-auto text-xs">명령 없음</pre></details></HashRouter>);`;
const result = await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" }, outfile: join(output, "app.js"),
  bundle: true, write: false, platform: "browser", format: "iife", metafile: true,
  define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" },
  plugins: [{ name: "synthetic-transition-only", setup(api) {
    api.onResolve({ filter: /AuthContext$|AppToastProvider$|\/semesterCore$|\/commandGateway$/ }, () => ({ path: mock }));
  } }],
});
const inputs = Object.keys(result.metafile.inputs);
assert.ok(!inputs.some((path) => /node_modules\/(?:@firebase|firebase)\//u.test(path)), "Firebase must not enter isolated transition fixture");
for (const file of ["SemesterCutoverCenter.tsx", "semesterTransitionGuide.ts", "SemesterTransitionGuide.css", "semesterDates.ts"]) {
  assert.ok(inputs.some((path) => path.endsWith(file)), `Actual component/helper missing: ${file}`);
}
const assets = resolve(root, "dist/assets");
const cssFile = readdirSync(assets).find((name) => /^main-.*\.css$/u.test(name));
assert.ok(cssFile, "Build the app before starting this visual fixture");
const js = result.outputFiles.find((file) => file.path.endsWith(".js"));
const componentCss = result.outputFiles.find((file) => file.path.endsWith(".css"));
const css = readFileSync(join(assets, cssFile), "utf8") + "\n" + readFileSync(resolve(root, "src/assets/index.css"), "utf8") + "\n" + (componentCss?.text || "");
writeFileSync(join(output, "fixture-inputs.json"), JSON.stringify({ inputs, syntheticOnly: true, firebaseIncluded: false, operationalWrites: 0 }, null, 2));
if (!process.argv.includes("--serve-only")) {
  console.log(JSON.stringify({ compiled: true, output, message: "Add --serve-only for westoria28 Chrome; no browser is launched." }));
} else {
  const server = createServer((request, response) => {
    const path = new URL(request.url || "/", "http://127.0.0.1").pathname;
    response.setHeader("Content-Security-Policy", "default-src 'self';connect-src 'none';style-src 'self' 'unsafe-inline';font-src 'none';img-src 'self' data:;script-src 'self'");
    response.setHeader("Content-Type", path === "/app.js" ? "text/javascript" : path === "/app.css" ? "text/css" : "text/html");
    response.end(path === "/app.js" ? js.contents : path === "/app.css" ? css : '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Westory 학기 전환 합성 검증</title><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/`, output, scenarios: ["normal", "ready", "failed", "revision-conflict", "action-conflict", "student-open", "not-admin", "error", "slow"], network: "connect-src none", syntheticOnly: true, operationalWrites: 0 }));
}
