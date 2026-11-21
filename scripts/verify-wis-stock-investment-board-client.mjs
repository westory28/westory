/** Actual clients and validators, synthetic Firestore transport. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { buildWisStockInvestmentBoard } from "../functions/wisStockInvestmentBoard.mjs";

const root = process.cwd();
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "wispi-display-client-"));
const output = path.join(directory, "test.mjs");
const stub = `
export const qa=globalThis.boardQa={listeners:new Map(),registrations:[],reads:[],authCallbacks:new Set(),data:null};
const owner={uid:"teacher",getIdTokenResult:async()=>({claims:{auth_time:qa.epoch||123}})};
export const auth=qa.auth={currentUser:owner};
export const onIdTokenChanged=(_,fn)=>{qa.authCallbacks.add(fn);queueMicrotask(()=>qa.authCallbacks.has(fn)&&fn(auth.currentUser));return()=>qa.authCallbacks.delete(fn)};
export const db={};
export const doc=(_,path)=>({path});
export const collection=doc;
export const where=(...args)=>["where",...args],limit=n=>["limit",n],orderBy=(...args)=>["orderBy",...args];
export const query=(source,...filters)=>({...source,filters});
export const getDocFromServer=async ref=>{qa.reads.push(ref.path);if(qa.hold){await new Promise(resolve=>qa.release=resolve);}return {data:()=>qa.data}};
export const onSnapshot=(ref,_,next,error)=>{const listener={...ref,next,error};qa.registrations.push(listener);qa.listeners.set(ref.path,listener);return()=>{if(qa.listeners.get(ref.path)===listener)qa.listeners.delete(ref.path)}};
`;
await build({
  stdin:{contents:'export * from "./src/lib/wisStockInvestmentBoardClient"; export * from "./src/lib/wisStockExchangeDisplayClient";', resolveDir:root},
  bundle:true,format:"esm",platform:"node",outfile:output,
  plugins:[{name:"synthetic transport",setup(plugin){
    plugin.onResolve({filter:/^firebase\/(auth|firestore)$|^\.\/firebase$/},()=>({namespace:"test",path:"services"}));
    plugin.onLoad({filter:/.*/,namespace:"test"},()=>({contents:stub}));
  }}],
});
const view=new EventTarget(); view.visibilityState="visible";
Object.defineProperty(view,"hidden",{get:()=>view.visibilityState==="hidden"});
globalThis.document=view; globalThis.window=new EventTarget(); Object.defineProperty(globalThis,"navigator",{value:{onLine:true},configurable:true});
const {watchWisStockInvestmentBoard,watchWisStockExchange}=await import(pathToFileURL(output));
const qa=globalThis.boardQa;
const scope={year:"2026",semester:"2"}, base="years/2026/semesters/2/";
const board=base+"wis_stock_investment_boards/all", market=base+"wis_stock_display/market", trades=base+"wis_stock_display_trades";
const session="application_sessions/teacher/sessions/123";
const meta={fromCache:false,hasPendingWrites:false};
const sessionValue=()=>({uid:"teacher",authTime:123,status:"active",schemaVersion:2,authorityGeneration:"w1r2-2026-08-09",protocolVersion:2,sessionRevision:"a".repeat(64),authorityModeAtOpen:"ENFORCE",generalExpiresAt:{toMillis:()=>Date.now()+60000}});
const snap=(data,metadata=meta)=>({metadata,exists:()=>data!=null,data:()=>data});
const emit=(ref,data,metadata)=>qa.listeners.get(ref).next(snap(data,metadata));
const serverSession=()=>emit(session,sessionValue());
const tick=async()=>{for(let i=0;i<6;i++)await Promise.resolve()};
const checks=[];
const marketValue={schemaVersion:1,semesterId:"2026-2",updatedAtMs:123,halted:false,index:{value:1100,previousClose:1000},stocks:[{id:"s1",name:"합성종목",price:150,previousClose:100}]};
const fill={semesterId:"2026-2",classKey:"3_1",displayName:"합성학생",atMs:123,stockName:"합성종목",side:"BUY",quantity:1,unitPrice:150};
function emitTrades(rows=[],metadata=meta){qa.listeners.get(trades).next({metadata,docs:rows.map((data,i)=>({id:"f"+i,data:()=>data}))})}
const initialOwner=qa.auth.currentUser;
let now=1794700800000;
const oldNow=Date.now, oldSet=setTimeout, oldClear=clearTimeout;
let timerId=0;const timers=new Map();
Date.now=()=>now;globalThis.setTimeout=(fn,ms)=>{const id=++timerId;timers.set(id,{fn,at:now+ms});return id};
globalThis.clearTimeout=id=>timers.delete(id);
const advance=ms=>{now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn()}};
let stopSummary=()=>{},stopDisplay=()=>{};
try{
  const results=[],connections=[],errors=[],screen=[];
  stopSummary=watchWisStockInvestmentBoard(scope,value=>results.push(value),value=>connections.push(value),error=>errors.push(error));
  await tick();assert.deepEqual([...qa.listeners.keys()],[session]);
  emit(session,sessionValue(),{...meta,fromCache:true});assert.deepEqual(qa.reads,[]);
  serverSession();await tick();assert.deepEqual(qa.reads,[board]);assert.equal(results.at(-1).status,"NOT_READY");
  assert.deepEqual([...qa.listeners.keys()],[session]);
  serverSession();advance(10000);assert.deepEqual(qa.reads,[board]);
  checks.push("Ordinary summary reads one selected projection once and never registers a Firestore listener on investments, market or trades.");

  stopDisplay=watchWisStockExchange("2026","2","3:1",state=>screen.push(state));await tick();
  assert.deepEqual([...qa.listeners.keys()].sort(),[session,market,trades].sort());assert.equal(qa.registrations.filter(ref=>ref.path===session).length,1);
  assert.deepEqual(qa.listeners.get(trades).filters,[["where","classKey","==","3_1"],["orderBy","atMs","desc"],["limit",20]]);
  emit(market,marketValue);assert.equal(screen.at(-1).status,"loading");emitTrades([fill]);assert.equal(screen.at(-1).trades[0].quantity,1);
  const beforeReads=qa.reads.length,beforeRegistrations=qa.registrations.length;
  emit(market,{...marketValue,index:{value:999,previousClose:1000}});emitTrades([{...fill,side:"SELL"}]);
  assert.equal(screen.at(-1).market.index.value,999);assert.equal(screen.at(-1).trades[0].side,"SELL");assert.equal(qa.reads.length,beforeReads);assert.equal(qa.registrations.length,beforeRegistrations);
  const detached=qa.listeners.get(trades);
  stopDisplay();assert.deepEqual([...qa.listeners.keys()],[session]);const count=screen.length;detached.error({code:"permission-denied"});assert.equal(screen.length,count);
  checks.push("Opening adds two bounded listeners with shared exact session, updates add zero requests, closing removes both. Class selection is applied on the server.");

  stopDisplay=watchWisStockExchange("2026","2","all",state=>screen.push(state));await tick();assert.deepEqual(qa.listeners.get(trades).filters,[["orderBy","atMs","desc"],["limit",20]]);
  emit(market,null);emitTrades();assert.equal(screen.at(-1).market,null);assert.deepEqual(screen.at(-1).trades,[]);
  view.visibilityState="hidden";view.dispatchEvent(new Event("visibilitychange"));assert.equal(qa.listeners.size,0);assert.equal(timers.size,0);assert.equal(screen.at(-1).status,"paused");
  view.visibilityState="visible";view.dispatchEvent(new Event("visibilitychange"));serverSession();await tick();
  navigator.onLine=false;window.dispatchEvent(new Event("offline"));assert.equal(qa.listeners.size,0);assert.equal(screen.at(-1).status,"offline");
  navigator.onLine=true;window.dispatchEvent(new Event("online"));serverSession();await tick();
  emit(market,marketValue);emitTrades([fill]);emitTrades([fill],{...meta,fromCache:true});assert.equal(screen.at(-1).status,"loading");
  emitTrades([fill]);assert.equal(screen.at(-1).status,"ready");emit(session,sessionValue(),{...meta,fromCache:true});assert.deepEqual([...qa.listeners.keys()],[session]);assert.equal(screen.at(-1).status,"loading");
  serverSession();emit(market,{...marketValue,semesterId:"2027-1"});assert.equal(screen.at(-1).status,"error");assert(!qa.listeners.has(trades));
  checks.push("Missing market and empty fills are distinct, cached quotes/fills or session are hidden. Hiding/offline removes all listeners. Return reauthenticates before reconnecting.");

  stopDisplay();stopDisplay=watchWisStockExchange("2026","2","3:1",state=>screen.push(state));await tick();emit(market,marketValue);emitTrades([{...fill,classKey:"3_2"}]);assert.equal(screen.at(-1).status,"error");
  stopDisplay();stopDisplay=watchWisStockExchange("2026","2","all",state=>screen.push(state));await tick();advance(15_001);assert.equal(screen.at(-1).status,"error");assert(!qa.listeners.has(trades));
  stopDisplay();stopDisplay=watchWisStockExchange("2026","2","all",state=>screen.push(state));await tick();emit(session,{...sessionValue(),status:"revoked"});assert.equal(qa.listeners.size,0);assert.equal(errors.length,1);assert.equal(screen.at(-1).status,"error");
  checks.push("Malformed scope and denied session clear data. An unconfirmed feed times out and stops, with no auto-retry loop.");

  stopSummary();stopDisplay();
  const feed=buildWisStockInvestmentBoard({scope,revision:1,sourceRevision:1,priceRevision:1,asOfMs:now,classes:[],rows:[]});
  qa.data={...feed,totals:{}};stopSummary=watchWisStockInvestmentBoard(scope,()=>assert.fail(),()=>{},e=>errors.push(e));await tick();serverSession();await tick();assert.equal(errors.length,2);assert.equal(qa.listeners.size,0);
  stopSummary();qa.data=feed;
  stopSummary=watchWisStockInvestmentBoard(scope,()=>{},()=>{},e=>errors.push(e));await tick();emit(session,{...sessionValue(),generalExpiresAt:{toMillis:()=>now+500}});await tick();advance(501);assert.equal(errors.length,3);assert.equal(qa.listeners.size,0);
  stopSummary();qa.hold=true;
  const late=[];stopSummary=watchWisStockInvestmentBoard({...scope,grade:"3",classNumber:"1"},v=>late.push(v),()=>{},e=>errors.push(e));await tick();serverSession();await tick();assert.equal(qa.reads.at(-1),base+"wis_stock_investment_boards/class_3_1");
  stopSummary();qa.hold=false;qa.release();await tick();assert.equal(late.length,0);
  for(const kind of ["epoch","owner"]){
    stopDisplay=watchWisStockExchange("2026","2","all",state=>screen.push(state));await tick();serverSession();await tick();
    if(kind==="epoch")qa.epoch=124;else qa.auth.currentUser={...initialOwner,uid:"other"};
    qa.authCallbacks.forEach(fn=>fn(qa.auth.currentUser));await tick();assert.equal(screen.at(-1).status,"error");assert.equal(qa.listeners.size,0);
    stopDisplay();qa.epoch=123;qa.auth.currentUser=initialOwner;
  }
  assert.equal(qa.authCallbacks.size,0);assert.equal(timers.size,0);
  checks.push("Malformed summary, expired or changed session and different account fail closed. Late one-shot results after unmount are ignored.");
  console.log(JSON.stringify({status:"PASS",checks,summaryDocumentReads:qa.reads.length,writes:0},null,2));
}finally{
  stopDisplay();stopSummary();Date.now=oldNow;globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;
  await fs.rm(output,{force:true});await fs.rmdir(directory);
}
