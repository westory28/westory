// Real dashboard/calendar/editor; synthetic command responses; no browser launch.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const output = mkdtempSync(join(tmpdir(), "westory-calendar-fixture-"));
const mock = join(output, "synthetic-data.tsx");
const rootImport = root.replaceAll("\\", "/");
writeFileSync(mock, `
import React from '${rootImport}/node_modules/react/index.js';
const scenario = () => new URLSearchParams(location.search).get('scenario') || 'normal';
const wait = (ms=50) => new Promise(resolve => setTimeout(resolve, ms));
export const useAuth = () => ({config:{year:'2026',semester:'2'},configReady:true,currentUser:{uid:'synthetic-admin',email:'westoria28@gmail.com'},userData:{role:'teacher',name:'합성 관리자'}});
export const db = {}; export const doc = () => ({});
export const getDoc = async () => ({exists:()=>false});
export const onSnapshot = (_ref, next) => {queueMicrotask(()=>next({exists:()=>false}));return ()=>{};};
export class W8DomainError extends Error { constructor(kind,message){super(message);this.kind=kind;} }
export const toW8LocalDateTimeInput = value => {const date=new Date(value);return new Date(date.getTime()+9*60*60*1000).toISOString().slice(0,16);};
export const toW8ServerDateTime = value => new Date(value+'+09:00').toISOString();
export const toW8StatePanelState = () => 'ERROR_RETRYABLE';
const classes = Array.from({length:10},(_,i)=>({classId:'synthetic-class-'+(i+1),semesterId:'2026-2',grade:'3',classNumber:String(i+1),displayName:'3학년 '+(i+1)+'반',status:'ACTIVE'}));
export async function getArchiveEnrollmentState(){await wait(scenario()==='slow'?1200:40);return {semesterId:'2026-2',classes};}
let events=[{eventId:'synthetic-event',semesterId:'2026-2',eventType:'ASSESSMENT',title:'합성 수행평가',description:'원본 시각과 복수 학급·개별 대상을 유지합니다.',startAt:'2026-09-15T01:20:00.000Z',endAt:'2026-09-15T02:10:00.000Z',allDay:false,period:'2',status:'ACTIVE',sourceDomain:'USER',sourceReference:'legacy-calendar:performance:synthetic-origin',classIds:['synthetic-class-1','synthetic-class-2'],targetUserIds:['synthetic-student-1'],revision:3,provenance:'CURRENT'},{eventId:'synthetic-locked',semesterId:'2026-2',eventType:'ASSESSMENT',title:'연동 평가 일정',description:'이 일정은 원본 평가에서 관리합니다.',startAt:'2026-09-18T00:00:00.000Z',endAt:'2026-09-18T00:00:00.000Z',allDay:true,period:'',status:'ACTIVE',sourceDomain:'ASSESSMENT',sourceReference:'synthetic-linked-assessment',classIds:[],targetUserIds:[],revision:1,provenance:'CURRENT'}];
export async function getW8DomainState(){await wait(scenario()==='slow'?900:40);if(scenario()==='error')throw new W8DomainError('NETWORK','합성 연결 오류입니다.');return {semesterId:'2026-2',domain:'SCHEDULE',readOnly:scenario()==='readonly',manifestRevision:9,scheduleEvents:scenario()==='empty'?[]:events};}
let commandCount=0;let failed=false;
async function command(name,payload){commandCount++;document.getElementById('fixture-log').textContent=JSON.stringify({commandCount,name,payload},null,2);await wait(700);if(scenario()==='conflict')throw new W8DomainError('CONFLICT','다른 변경이 확인되었습니다.');if(scenario()==='network'&&!failed){failed=true;throw new W8DomainError('NETWORK','합성 저장 연결 오류입니다.');}if(payload.expectedSemesterRevision!==9)throw new Error('Wrong semester revision');if(name!=='create'&&payload.expectedEventRevision!==events.find(e=>e.eventId===payload.eventId)?.revision)throw new Error('Wrong event revision');if(name==='delete')events=events.filter(e=>e.eventId!==payload.eventId);else {const item={...payload,eventId:payload.eventId||'synthetic-created-'+commandCount,classIds:payload.targetClassIds,targetUserIds:payload.targetUserIds,status:'ACTIVE',revision:(payload.expectedEventRevision||0)+1,provenance:'CURRENT'};events=name==='create'?[...events,item]:events.map(e=>e.eventId===item.eventId?item:e);}return {result:{}};}
export const createScheduleEvent = payload => command('create',payload);
export const updateScheduleEvent = payload => command('update',payload);
export const deleteScheduleEvent = payload => command('delete',payload);
export const getKoreanPublicHolidays = async () => [{title:'합성 토요일 공휴일',start:'2026-09-26',source:'generated'}];
export const mergeEventsWithKoreanPublicHolidays=(events,holidays)=>[...events,...holidays.map((h,i)=>({id:'synthetic-holiday-'+i,title:h.title,start:h.start,end:h.start,eventType:'holiday',targetType:'common'}))];
export default function Ranking(){return <section className="rounded-xl border border-gray-200 bg-white p-4"><h2 className="text-lg font-bold">화랑의 전당</h2><p className="mt-4 text-gray-600">아직 순위에 오른 학생이 없습니다.</p></section>;}
`);

const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import Dashboard from './src/pages/teacher/Dashboard';createRoot(document.getElementById('root')).render(<><div className="border-b border-gray-200 bg-white px-6 py-4 font-bold text-blue-600">Westory 학사 일정 합성 검증</div><Dashboard/><details className="m-4 rounded-lg border border-gray-200 bg-white p-4"><summary>합성 명령 기록</summary><pre id="fixture-log" className="overflow-auto text-xs">명령 없음</pre></details></>);`;
const result = await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" }, bundle: true,
  write: false, platform: "browser", format: "iife", metafile: true,
  define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" },
  plugins: [{ name: "synthetic-calendar-only", setup(api) {
    api.onResolve({ filter: /AuthContext$|\/firebase$|firebase\/firestore$|\/archiveEnrollment$|\/w8Domains$|\/koreanPublicHolidays$|\/WisRankingPanel$/ }, () => ({ path: mock }));
  } }],
});
const inputs = Object.keys(result.metafile.inputs);
assert.ok(!inputs.some((path) => /node_modules\/(?:@firebase|firebase)\//u.test(path)), "Firebase must not enter this isolated fixture");
for (const component of ["teacher/Dashboard.tsx", "TeacherCalendarSection.tsx", "TeacherCalendarEventModal.tsx", "ModalSurface.tsx", "scheduleClassTargets.ts"]) {
  assert.ok(inputs.some((path) => path.endsWith(component)), `Actual source missing: ${component}`);
}
const assets = resolve(root, "dist/assets");
const cssFile = readdirSync(assets).find((name) => /^main-.*\.css$/u.test(name));
assert.ok(cssFile, "Build the app before starting this visual fixture");
const css = readFileSync(join(assets, cssFile), "utf8") + "\n" + readFileSync(resolve(root, "src/assets/index.css"), "utf8");
writeFileSync(join(output, "fixture-inputs.json"), JSON.stringify({ inputs, syntheticOnly: true, firebaseIncluded: false }, null, 2));
if (!process.argv.includes("--serve-only")) {
  console.log(JSON.stringify({ compiled: true, output, message: "Add --serve-only for the user's westoria28 Chrome; no browser is launched." }));
} else {
  const server = createServer((request, response) => {
    const path = new URL(request.url || "/", "http://127.0.0.1").pathname;
    response.setHeader("Content-Security-Policy", "default-src 'self';connect-src 'none';style-src 'self' 'unsafe-inline';font-src 'none';img-src 'self' data:;script-src 'self'");
    response.setHeader("Content-Type", path === "/app.js" ? "text/javascript" : path === "/app.css" ? "text/css" : "text/html");
    response.end(path === "/app.js" ? result.outputFiles[0].contents : path === "/app.css" ? css : '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Westory 학사 일정 합성 검증</title><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/`, output, scenarios: ["normal", "slow", "empty", "error", "readonly", "conflict", "network"], network: "connect-src none", syntheticOnly: true }));
}
