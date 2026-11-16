import assert from "node:assert/strict";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_WIS_STOCK_MARKET_RULES } from "../functions/wisStockMarketRules.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = await build({
  entryPoints: [path.join(root, "src/lib/wisStocksClient.ts")], bundle: true, format: "esm", write: false,
  plugins: [{ name: "synthetic-session", setup(plugin) {
    plugin.onResolve({ filter: /^\.\/(firebase|historyDictionarySession|semesterScope|sensitiveOperation)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
      const qa=globalThis.__wisStockClient;
      export const auth={get currentUser(){return qa.owner}};
      export const getYearSemester=config=>({year:String(config.year),semester:String(config.semester)});
      export const ensureSensitiveOperation=async()=>{qa.sensitive++;await qa.reauth()};
      export const getHistoryDictionaryCallable=async name=>async payload=>{qa.calls.push({name,payload:structuredClone(payload)});return {data:await qa.handler(name,payload)}};
    `, loader: "js" }));
  } }],
});
let sequence = 0;
const owner = uid => ({ uid, epoch: 100, async getIdTokenResult() { return { claims: { auth_time: this.epoch } }; } });
const setup = async () => {
  const storage = new Map();
  globalThis.sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const qa = globalThis.__wisStockClient = { owner: owner("teacher-a"), calls: [], sensitive: 0, reauth: async () => {}, handler: async () => ({ revision: 1 }) };
  const client = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + `\n// fixture ${sequence++}`).toString("base64")}`);
  return { qa, client, storage };
};
const scope = { year: "2026", semester: "2" };
const settings = { name: "합성 종목", description: "", period: "", initialPrice: 100, minimumPrice: 1,
  maximumPrice: 10000, volatilityBps: 300, trendBps: 0, intervalHours: 24, automatic: false,
  issuedShares: 100000, lotSize: 1, tradingStatus: "ACTIVE" };
const checks = [];
const check = async (name, run) => { await run(); checks.push(name); };
await check("same owner/session/semester reads coalesce; completed reads and other scopes are fresh", async () => {
  const { qa, client } = await setup(); let release;
  qa.handler = () => new Promise(resolve => { release = resolve; });
  const a = client.getWisStockManagement(scope), b = client.getWisStockManagement(scope);
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(qa.calls.length, 1); release({ revision: 1 }); await Promise.all([a, b]);
  qa.handler = async () => ({ revision: 2 });
  await Promise.all([client.getWisStockManagement(scope), client.getWisStockManagement({ year: "2026", semester: "1" })]);
  assert.equal(qa.calls.length, 3);
});
await check("read failures retry, unauthenticated callers do not request", async () => {
  const { qa, client } = await setup(); qa.handler = async () => { throw Error("synthetic failure"); };
  await assert.rejects(client.getWisStockManagement(scope)); qa.handler = async () => ({ revision: 2 });
  assert.equal((await client.getWisStockManagement(scope)).revision, 2); assert.equal(qa.calls.length, 2);
  qa.owner = null; await assert.rejects(client.getWisStockManagement(scope)); assert.equal(qa.calls.length, 2);
});
await check("in-flight owner or auth epoch change rejects stale responses", async () => {
  for (const change of [qa => { qa.owner = owner("teacher-b"); }, qa => { qa.owner.epoch++; }]) {
    const { qa, client } = await setup(); let release;
    qa.handler = () => new Promise(resolve => { release = resolve; });
    const response = client.getWisStockManagement(scope);
    while (!release) await new Promise(resolve => setTimeout(resolve, 0));
    change(qa); release({ private: true }); await assert.rejects(response, /로그인 계정/);
    qa.handler = async () => ({ revision: 2 }); await client.getWisStockManagement(scope); assert.equal(qa.calls.length, 2);
  }
});
await check("lost stock/rules/emergency responses reuse one request ID; success clears pending receipt key", async () => {
  for (const kind of ["stock", "rules", "emergency", "catalog"]) {
    const { qa, client, storage } = await setup(); let lost = true;
    qa.handler = async () => { if (lost) { lost = false; throw Error("response lost after server commit"); } return { revision: 2 }; };
    const save = () => kind === "stock" ? client.saveWisStock(scope, 1, "", settings) : kind === "rules" ? client.saveWisStockMarketRules(scope, 1, DEFAULT_WIS_STOCK_MARKET_RULES) : kind === "catalog" ? client.activateWisStockCatalogPlan(scope, 1, Date.parse('2026-11-16T09:00:00+09:00')) : client.setWisStockMarketHalted(scope, 1, true);
    await assert.rejects(save()); assert.equal(storage.size, 1);
    assert.equal([...storage.keys()].some(key => key.includes(settings.name) || key.includes("teacher-a")), false);
    await save(); assert.equal(qa.calls[0].payload.requestId, qa.calls[1].payload.requestId); assert.equal(storage.size, 0);
    assert.equal(qa.sensitive, 2);
  }
});
await check("emergency stop has a separate minimal payload and cannot submit a rule draft", async () => {
  const { qa, client } = await setup();
  await client.setWisStockMarketHalted(scope, 3, true);
  assert.equal(qa.calls[0].name, "setWisStockMarketHalted");
  assert.deepEqual(Object.keys(qa.calls[0].payload).sort(), ["year", "semester", "expectedRevision", "halted", "requestId"].sort());
  assert.equal(qa.calls[0].payload.halted, true);
  await client.setWisStockMarketHalted(scope, 4, false);
  assert.notEqual(qa.calls[0].payload.requestId, qa.calls[1].payload.requestId);
  assert.equal(qa.calls[1].payload.halted, false);
});
await check("catalog activation uses the authorized minimal command and current semester/revision", async () => {
  const { qa, client } = await setup();
  const startsAtMs = Date.parse('2026-11-16T09:00:00+09:00');
  await client.activateWisStockCatalogPlan(scope, 4, startsAtMs);
  assert.equal(qa.calls[0].name, 'activateWisStockCatalogPlan');
  assert.deepEqual(Object.keys(qa.calls[0].payload).sort(), ['year','semester','expectedRevision','startsAtMs','requestId'].sort());
  assert.equal(qa.calls[0].payload.startsAtMs, startsAtMs);
  assert.equal(qa.sensitive, 1);
});
await check("changing the revision or draft creates an independent idempotent request", async () => {
  const { qa, client } = await setup(); qa.handler = async () => { throw Error("synthetic retry"); };
  await assert.rejects(client.saveWisStock(scope, 1, "", settings));
  await assert.rejects(client.saveWisStock(scope, 2, "", settings));
  await assert.rejects(client.saveWisStock(scope, 2, "", { ...settings, name: "수정 종목" }));
  assert.equal(new Set(qa.calls.map(call => call.payload.requestId)).size, 3);
});
await check("switching accounts during reauthentication stops mutations before any call", async () => {
  const { qa, client } = await setup(); qa.reauth = async () => { qa.owner = owner("teacher-b"); };
  await assert.rejects(client.saveWisStockMarketRules(scope, 1, DEFAULT_WIS_STOCK_MARKET_RULES), /로그인 계정/);
  assert.equal(qa.calls.length, 0);
});
await check("listing watch uses one safe document, reports new revisions once, ignores duplicate/cache snapshots, and disconnects on session/auth changes", async () => {
  const built = await build({ entryPoints: [path.join(root, 'src/lib/wisStockListingSubscription.ts')], bundle: true, format: 'esm', write: false,
    plugins: [{name:'listing-fixture',setup(plugin) {
      plugin.onResolve({filter:/^firebase\/(auth|firestore)$|^\.\/(firebase|semesterScope|studentWisStockSession)$/},()=>({path:'fixture',namespace:'listing'}));
      plugin.onLoad({filter:/.*/,namespace:'listing'},()=>({contents:`
        const q=globalThis.__listingQa;
        export const auth={get currentUser(){return q.owner}}; export const db={};
        export const getYearSemester=x=>x;
        export const doc=(_,path)=>path;
        export const onIdTokenChanged=(_,next)=>{q.authNext=next;return()=>q.authStops++};
        export const onSnapshot=(path,options,next,error)=>{q.paths.push(path);q.next=next;q.error=error;q.subscriptions++;return()=>q.marketStops++};
        export const watchStudentWisStockSession=(owner,epoch,listener)=>{q.session=listener;q.epoch=epoch;listener.allowed();return()=>q.sessionStops++};
      `,loader:'js'}));
    }}] });
  const make = async () => {
    const q=globalThis.__listingQa={owner:owner('teacher-a'),paths:[],subscriptions:0,marketStops:0,sessionStops:0,authStops:0,values:[],errors:[]};
    const module=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text+`\n// ${sequence++}`).toString('base64')}`);
    const stop=module.watchWisStockListings(scope,ids=>q.values.push(ids),error=>q.errors.push(error));
    while(!q.next) await new Promise(resolve=>setTimeout(resolve,0));
    const emit=(ids,fromCache=false,revision)=>q.next({exists:()=>true,metadata:{fromCache,hasPendingWrites:false},data:()=>({semesterId:'2026-2',stocks:ids.map(id=>({id})),revision})});
    return {q,stop,emit};
  };
  const {q,stop,emit}=await make(), id='stock_000000000000000000000001';
  assert.deepEqual(q.paths,['years/2026/semesters/2/wis_stock_public/market']);
  emit([id],true);assert.equal(q.values.length,0);emit([id]);emit([id]);assert.equal(q.values.length,1);
  emit([id,'stock_000000000000000000000002']);assert.equal(q.values.length,2);
  emit([id,'stock_000000000000000000000002'],false,2);assert.equal(q.values.length,3);
  emit([id,'stock_000000000000000000000002'],false,2);assert.equal(q.values.length,3);
  emit([id,'stock_000000000000000000000002'],true,3);assert.equal(q.values.length,3);
  emit([id,'stock_000000000000000000000002'],false,3);assert.equal(q.values.length,4);
  q.session.paused();assert.equal(q.marketStops,1);q.session.allowed();assert.equal(q.subscriptions,2);
  q.session.denied(Error('expired'));assert.equal(q.errors.length,1);assert.equal(q.marketStops,2);assert.equal(q.sessionStops,1);assert.equal(q.authStops,1);
  stop();assert.equal(q.marketStops,2);
  const changed=await make();changed.q.owner=owner('teacher-b');changed.q.authNext(changed.q.owner);
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(changed.q.errors.length,1);assert.equal(changed.q.marketStops,1);changed.stop();
});
console.log(JSON.stringify({ passed: true, checks, network: 0, writes: 0 }));
