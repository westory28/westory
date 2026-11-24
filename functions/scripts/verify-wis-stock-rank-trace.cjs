const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');
const source = process.env.WIS_STOCK_HISTORY_SOURCE_DIR || resolve(__dirname,'..');
const sourceRequire = createRequire(resolve(source,'package.json'));
const { initializeApp, deleteApp } = sourceRequire('firebase-admin/app');
const { getFirestore } = sourceRequire('firebase-admin/firestore');
const {createRankTraceWriter, readRankTrace} = require(resolve(source,'wisStockRankTrace'));
const {buildWisStockInvestmentBoard, parseWisStockInvestmentBoardSnapshot} = require(resolve(source,'wisStockInvestmentBoard'));
assert(/^127\.0\.0\.1:/.test(process.env.FIRESTORE_EMULATOR_HOST || ''), 'Requires local emulator');
const app=initializeApp({projectId:'demo-westory-trace'}), db=getFirestore(app);
const scope={year:'2026',semester:'2'}, root='years/2026/semesters/2/wis_stock_investment_boards';
const ref=db.doc(root+'/all'), record=createRankTraceWriter(db);
const make=(rev, value)=>buildWisStockInvestmentBoard({scope,revision:rev,asOfMs:100000+rev,sourceRevision:rev,
  priceRevision:rev,classes:[{grade:'3',classNumber:'1'}],
  rows:Array.from({length:6},(_,i)=>({studentKey:'student_'+String(i+1).padStart(24,'0'),grade:'3',classNumber:'1',studentNumber:String(i+1),displayName:'학생'+i,
    stockCash:0,reservedCash:0,holdingCount:1,holdingValue:i ? 106-i : value,holdingCostBasis:100,realizedPnl:0}))});
const snap=raw=>({exists:!!raw,data:()=>raw,ref});
const event=(a,b)=>({params:{...scope,boardId:'all'},data:{before:snap(a),after:snap(b)}});
(async()=>{
  const a=make(127,199),b=make(128,80),c=make(129,201);
  await record(event(b,c)); await record(event(a,b));
  const docs=await ref.collection('rank_trace').get(); assert.equal(docs.size,2);
  await record(event(a,b));await record(event(c,make(130,201)));
  const again=await ref.collection('rank_trace').get(); assert.deepEqual(docs.docs.map(d=>d.updateTime.toMillis()),again.docs.map(d=>d.updateTime.toMillis()));
  const read=(board,through)=>db.runTransaction(tx=>readRankTrace(tx,ref,board,{through}),{readOnly:true});
  const board=parseWisStockInvestmentBoardSnapshot(c,scope);
  const seen=await read(board,129), key=c.rows[0].studentKey;
  assert.deepEqual(seen.samples.map(s=>s.leaders.some(l=>l.studentKey===key)),[true,false,true]);
  const early = await read(board,128); assert.deepEqual(early.samples.map(s=>s.revision),[127,128]);
  const delta = await db.runTransaction(tx=>readRankTrace(tx,ref,board,{through:129,sinceMs:early.readMs,fromMs:100129}),{readOnly:true});
  assert.deepEqual(delta.samples.map(s=>s.revision),[129]);
  assert((await read({...board,rows:board.rows.slice(1)},129)).samples.every(s=>s.leaders.every(l=>l.studentKey!==key)));
  console.log('PASS actual Firestore: two shards, exact membership exit/re-entry, revision cutoff, exclusion of departed students, duplicate delivery writes zero, unchanged board writes zero, out-of-order replay.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>deleteApp(app));
