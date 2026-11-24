import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url), {build}=require('esbuild');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const evidence=process.env.WIS_STUDENT_STOCK_QA_DIR||path.join(root,'output/wispi-wallet-20261124/student-browser');
await fs.mkdir(evidence,{recursive:true});
// Only SDK and callable boundaries are mocked. Actual session/public/account clients,
// hooks, menu access, student screens and chart execute together in the browser.
const fixture=`
import {DEFAULT_WIS_STOCK_MARKET_RULES} from ${JSON.stringify(path.join(root,'functions/wisStockMarketRules.mjs'))};
import {cloneDefaultMenus} from ${JSON.stringify(path.join(root,'src/constants/menus.ts'))};
export const qa=window.qa={calls:[],appChecks:0,stepUps:0,subscriptions:[],active:new Map(),authListeners:new Set(),generation:1,hidden:false,online:true,sessionMode:'OBSERVE_ONLY',sessionClosed:false,expires:Date.now()-1000,failHistory:null,screen:'market',epoch:1001,config:{year:'2026',semester:'2',studentMenuVisibility:{wispi:true}},menuConfig:cloneDefaultMenus()};
qa.user={uid:'student-a',email:'synthetic@example.invalid',getIdTokenResult:async()=>({claims:{auth_time:qa.epoch}})};
export const auth={currentUser:qa.user},db={};
qa.replaceUser=user=>{auth.currentUser=user;qa.authListeners.forEach(next=>next(user))};
export const useAuth=()=>({currentUser:qa.user,userData:{role:'student'},authGeneration:qa.generation,config:qa.config,configReady:true,menuConfig:qa.menuConfig,menuConfigReady:true});
export const getYearSemester=config=>({year:String(config.year),semester:String(config.semester)});
export const ensureSensitiveOperation=async()=>{qa.stepUps++;throw Error('Unexpected student step-up')};
export const ensureWestoryAppCheck=async()=>{qa.appChecks++};
export const useAppToast=()=>({showToast:toast=>{qa.toasts=(qa.toasts||[]).concat(toast);return 'toast-'+qa.toasts.length},dismissToast:()=>{}});
Object.defineProperty(document,'visibilityState',{get:()=>qa.hidden?'hidden':'visible',configurable:true});
Object.defineProperty(navigator,'onLine',{get:()=>qa.online,configurable:true});
qa.prefix=()=> 'years/'+qa.config.year+'/semesters/'+qa.config.semester;
qa.accountId=()=> 'wisacct_'+(qa.user.uid==='student-a'?'a':'b').repeat(64);
qa.status={schemaVersion:1,semesterId:'2026-2',studentOpen:!new URLSearchParams(location.search).has('preopen'),halted:false,tradingEpoch:1,revision:1,updatedAtMs:Date.now()};
const settings={name:'청동네트웍스',description:'학습한 역사 배경을 담은 종목입니다.',period:'고조선',issuedShares:10000,lotSize:1,tradingStatus:'ACTIVE'};
qa.market={schemaVersion:1,semesterId:'2026-2',studentOpen:true,tradingEpoch:1,revision:1,updatedAtMs:Date.now(),rules:structuredClone(DEFAULT_WIS_STOCK_MARKET_RULES),stocks:[{id:'stock_000000000000000000000001',settings,price:100,updatedAtMs:Date.now(),nextTickAtMs:0,haltedUntilMs:0,history:[{atMs:Date.now()-7200000,price:90},{atMs:Date.now()-3600000,price:95},{atMs:Date.now(),price:100}]}]};
if(new URLSearchParams(location.search).has('catalog')){
 const first=qa.market.stocks[0];first.history=[{atMs:Date.now()-86400000,price:80},{atMs:Date.now()-3600000,price:95},{atMs:Date.now(),price:100}];
 const sample=(id,name,price,previous)=>({...structuredClone(first),id:'stock_'+String(id).padStart(24,'0'),settings:{...settings,name,period:id===2?'조선 후기':'고조선'},price,history:[{atMs:Date.now()-86400000,price:previous},{atMs:Date.now()-3600000,price:price-1},{atMs:Date.now(),price}]});
 qa.market.stocks.push(sample(2,'한양 상업과 유통 산업의 발전을 연구하는 아주 긴 역사 종목',72,90),sample(3,'고려무역',150,150));
 for(let i=4;i<24;i++)qa.market.stocks.push(sample(i,'합성 기업 '+i,100+i,100));
}
qa.mainCash=10000;qa.account={accountId:qa.accountId(),revision:0,stockCash:0,reservedCash:0,outstandingPrincipal:0,lastDepositAtMs:0,positions:[],pendingOrders:[],recentOrders:[]};
if(new URLSearchParams(location.search).has('pending')){qa.account.revision=1;qa.account.stockCash=5000;qa.account.reservedCash=101;qa.account.pendingOrders=[{id:'persisted-order',stockId:qa.market.stocks[0].id,side:'BUY',quantity:1,unitPrice:100,fee:1,acceptedAtMs:1794790800000,dueAtMs:1794790860000,status:'PENDING'}];}
qa.state=()=>({semesterId:qa.config.year+'-'+qa.config.semester,serverNowMs:Date.now(),marketRevision:qa.market.revision,studentOpen:qa.status.studentOpen,halted:qa.status.halted,tradingEpoch:qa.status.tradingEpoch,rules:structuredClone(qa.market.rules),stocks:qa.market.stocks.map(({id,settings,price,updatedAtMs,haltedUntilMs})=>({id,settings,price,updatedAtMs,haltedUntilMs})),mainCash:qa.mainCash,accountPath:qa.prefix()+'/wis_stock_accounts/'+qa.accountId(),account:structuredClone(qa.account),funding:{maximumDeposit:qa.account.lastDepositAtMs&&Date.now()<qa.account.lastDepositAtMs+86400000?0:Math.floor(qa.mainCash/2),maximumWithdrawal:qa.account.stockCash-qa.account.reservedCash,nextDepositAtMs:qa.account.lastDepositAtMs?qa.account.lastDepositAtMs+86400000:0}});
qa.session=()=>({uid:qa.user.uid,authTime:qa.epoch,status:qa.sessionClosed?'closed':'active',schemaVersion:2,authorityGeneration:'w1r2-2026-08-09',protocolVersion:2,sessionRevision:'a'.repeat(64),authorityModeAtOpen:qa.sessionMode,generalExpiresAt:{toMillis:()=>qa.expires}});
qa.document=key=>key.startsWith('application_sessions/')?qa.session():key.endsWith('/current')?qa.status:key.endsWith('/market')?qa.market:key.includes('/wis_stock_accounts/')?(qa.account.revision?{revision:qa.account.revision}:null):null;
export const doc=(_db,...pieces)=>({path:pieces.join('/')});
export const onSnapshot=(ref,options,next,error)=>{const id=crypto.randomUUID(),entry={path:ref.path,next,error};qa.active.set(id,entry);qa.subscriptions.push(ref.path);queueMicrotask(()=>{if(qa.active.has(id))qa.deliver(entry)});return()=>qa.active.delete(id)};
qa.deliver=(entry,meta={})=>{const data=qa.document(entry.path);entry.next({exists:()=>data!==null,data:()=>data,metadata:{fromCache:false,hasPendingWrites:false,...meta}})};
qa.emit=(suffix,meta)=>{for(const entry of [...qa.active.values()])if(entry.path.endsWith(suffix)||entry.path.includes(suffix))qa.deliver(entry,meta)};
qa.activePaths=()=>[...qa.active.values()].map(item=>item.path);
export const onIdTokenChanged=(_auth,next)=>{qa.authListeners.add(next);queueMicrotask(()=>{if(qa.authListeners.has(next))next(auth.currentUser)});return()=>qa.authListeners.delete(next)};
qa.changeVisibility=hidden=>{qa.hidden=hidden;document.dispatchEvent(new Event('visibilitychange'))};
qa.setOffline=offline=>{qa.online=!offline;window.dispatchEvent(new Event(offline?'offline':'online'))};
qa.setHalted=halted=>{qa.status.halted=halted;qa.status.revision++;qa.status.tradingEpoch++;qa.market.tradingEpoch=qa.status.tradingEpoch;qa.market.rules.halted=halted;qa.emit('/current');qa.emit('/market')};
qa.setHiddenMenu=hidden=>{qa.config={...qa.config,studentMenuVisibility:{wispi:!hidden}};qa.render()};
qa.records=Array.from({length:43},(_,index)=>({id:'history-'+index,kind:index%2?'ORDER_FILLED':'DEPOSIT',atMs:Date.now()-index*60000,stockCashDelta:index+1,mainCashDelta:-(index+1),earnedDelta:0}));
qa.notifyAccount=()=>qa.emit('/wis_stock_accounts/');
qa.fill=()=>{const order=qa.account.pendingOrders.shift();if(!order)return;let position=qa.account.positions.find(item=>item.stockId===order.stockId);if(order.side==='BUY'){qa.account.reservedCash-=order.unitPrice*order.quantity+order.fee;qa.account.stockCash-=order.unitPrice*order.quantity+order.fee;if(!position){position={stockId:order.stockId,quantity:0,principal:0,costBasis:0,reservedSellQuantity:0};qa.account.positions.push(position)}position.quantity+=order.quantity;position.principal+=order.unitPrice*order.quantity;position.costBasis+=order.unitPrice*order.quantity+order.fee;}else{position.reservedSellQuantity-=order.quantity;position.quantity-=order.quantity;qa.account.stockCash+=order.unitPrice*order.quantity-order.fee;}qa.account.recentOrders=[{...order,status:'FILLED'},...qa.account.recentOrders];qa.account.revision++;qa.notifyAccount()};
qa.receipts=new Map();
export const getHistoryDictionaryCallable=async(name,options)=>async fields=>{options?.beforeDispatch?.();qa.calls.push({name,fields:structuredClone(fields)});let result;
if(name==='placeStudentWisStockOrder'&&qa.holdOrder){qa.holdOrder=false;await new Promise(resolve=>qa.releaseOrder=resolve)}
if(name==='placeStudentWisStockOrder'&&qa.failOrder){qa.failOrder=false;throw Object.assign(Error('시세가 바뀌었습니다. 다시 주문해 주세요.'),{code:'functions/failed-precondition',details:{reason:'WIS_STOCK_QUOTE_CHANGED'}})}
if(name==='getStudentWisStockState'){if(qa.failState){qa.failState=false;throw Error('temporary state connection')}result=qa.state();qa.lastStateServerNowMs=result.serverNowMs;if(qa.holdRead){qa.holdRead=false;await new Promise(resolve=>qa.releaseRead=resolve)}}
else if(name==='getStudentWisStockRanking'){
 const asOfMs=Math.floor((Date.now()+9*3600000)/86400000)*86400000-9*3600000-60000;
 const dayKey=new Date(asOfMs+9*3600000).toISOString().slice(0,10);
 const day={semesterId:fields.year+'-'+fields.semester,dayKey,asOfMs};
 const filter=fields.filter==='my-class'?'3_1':fields.filter||'all';
 const count=filter==='all'?50:filter==='3_1'?23:54;
 const rows=Array.from({length:count},(_,i)=>({entryId:String(filter==='all'?i+1:filter==='3_1'?(i+1)*2:i+101),rank:i+1,displayName:'연습학생'+(i+1),returnPercent:120-(i+1)*3}));
 if(qa.rankingError){qa.rankingError=false;throw Error('synthetic failure');}
 const chart=row=>({...day,entryId:row.entryId,rank:row.rank,displayName:row.displayName,
   points:[{atMs:asOfMs-5*86400000,returnPercent:-2.5},{atMs:asOfMs-4*86400000,returnPercent:1.5},{atMs:asOfMs-3*86400000,returnPercent:null},{atMs:asOfMs-2*86400000,returnPercent:3},{atMs:asOfMs-86400000,returnPercent:9},{atMs:asOfMs,returnPercent:row.returnPercent}]});
 if(fields.entryId){
   if(qa.holdRanking){qa.holdRanking=false;await new Promise(resolve=>qa.releaseRanking=resolve);}
   result=chart(rows.find(row=>row.entryId===fields.entryId));
   if(qa.futurePoint)result.points.push({atMs:asOfMs+86400000,returnPercent:1000});
 }else{
   if(qa.holdRankingPage){qa.holdRankingPage=false;await new Promise(resolve=>qa.releaseRankingPage=resolve);}
   const start=Number(fields.cursor||0),page=qa.rankingMode||(qa.emptyFirstRankingPage&&start===0)?[]:rows.slice(start,start+10),hasMore=!qa.rankingMode&&start+10<count;
   result={...day,status:qa.rankingMode==='pending'?'NOT_READY':'READY',filter,myClassKey:'3_1',classes:[{key:'3_1',label:'3학년 1반'},{key:'3_2',label:'3학년 2반'}],rows:page,charts:page.slice(0,start===0?5:Number(fields.chartCount||0)).map(chart),nextCursor:hasMore?String(start+10):null,hasMore};
 }
}
else if(name==='getStudentWisStockBonus'){result={campaignId:'wispi-deposit-500-v1',threshold:500,amount:500,status:qa.bonusClaimed?'CLAIMED':qa.bonusEnabled?(qa.depositTotal>=500?'ELIGIBLE':'INELIGIBLE'):'DISABLED',qualifyingDepositAmount:Math.min(500,qa.depositTotal||0)};}
else if(name==='getStudentWisStockHistory' && fields.view==='returns') {
  if(qa.holdReturns){qa.holdReturns=false;await new Promise(resolve=>qa.releaseReturns=resolve);}
  if(qa.failReturns){qa.failReturns=false;throw Error('그래프 조회 실패');}
  const asOfMs=Date.now();
  result={semesterId:fields.year+'-'+fields.semester,asOfMs,points:[{atMs:asOfMs-3*86400000,returnPercent:-2.5},{atMs:asOfMs-2*86400000,returnPercent:null},{atMs:asOfMs-86400000,returnPercent:1.5},{atMs:asOfMs,returnPercent:23.46}]};
}
else if(name==='getStudentWisStockHistory'){if(qa.failHistory===fields.cursor){qa.failHistory=null;throw Error('내역 조회 실패')}const start=Number(fields.cursor||0),entries=qa.records.slice(start,start+20);result={semesterId:fields.year+'-'+fields.semester,entries,nextCursor:start+20<qa.records.length?String(start+20):'',hasMore:start+20<qa.records.length};
  if(qa.holdHistory){qa.holdHistory=false;await new Promise(resolve=>qa.releaseHistory=resolve);}
}
else if(qa.receipts.has(fields.requestId)){result={...qa.receipts.get(fields.requestId),duplicate:true,changed:false,state:qa.state()}}
else if(name==='transferStudentWisStock'){const amount=fields.amount;let profit=0,principal=0;if(fields.direction==='DEPOSIT'){qa.mainCash-=amount;qa.account.stockCash+=amount;qa.account.outstandingPrincipal+=amount;qa.account.lastDepositAtMs=Date.now();qa.depositTotal=(qa.depositTotal||0)+amount}else{principal=Math.min(amount,qa.account.outstandingPrincipal);profit=amount-principal;qa.account.outstandingPrincipal-=principal;qa.account.stockCash-=amount;qa.mainCash+=amount;}qa.account.revision++;result={changed:true,duplicate:false,receipt:{withdrawnProfit:profit,principalReturned:principal},state:qa.state()};qa.receipts.set(fields.requestId,result);qa.notifyAccount();}
else if(name==='claimStudentWisStockBonus'){qa.bonusClaimed=true;qa.account.stockCash+=500;qa.account.eventBonusTotal=500;qa.account.eventBonusRestrictedCash=500;qa.account.revision++;result={changed:true,duplicate:false,state:qa.state(),depositBonus:{campaignId:'wispi-deposit-500-v1',threshold:500,amount:500,status:'CLAIMED',qualifyingDepositAmount:500}};qa.receipts.set(fields.requestId,result);qa.notifyAccount();}
else if(name==='placeStudentWisStockOrder'){const fee=Math.ceil(fields.quote.price*fields.quantity*(fields.side==='BUY'?qa.market.rules.buyFeeBps:qa.market.rules.sellFeeBps)/10000),order={id:'order-'+qa.calls.length,stockId:fields.stockId,side:fields.side,quantity:fields.quantity,unitPrice:fields.quote.price,fee,acceptedAtMs:Date.now(),dueAtMs:Date.now()+5000,status:'PENDING'};qa.account.pendingOrders.push(order);if(fields.side==='BUY')qa.account.reservedCash+=order.unitPrice*order.quantity+fee;else qa.account.positions.find(item=>item.stockId===fields.stockId).reservedSellQuantity+=fields.quantity;qa.account.revision++;result={changed:true,duplicate:false,order,state:qa.state()};qa.receipts.set(fields.requestId,result);qa.notifyAccount();}
else if(name==='cancelStudentWisStockOrder'){const order=qa.account.pendingOrders.find(item=>item.id===fields.orderId);qa.account.pendingOrders=qa.account.pendingOrders.filter(item=>item.id!==fields.orderId);if(order?.side==='BUY')qa.account.reservedCash-=order.unitPrice*order.quantity+order.fee;else if(order)qa.account.positions.find(item=>item.stockId===order.stockId).reservedSellQuantity-=order.quantity;qa.account.revision++;result={changed:!!order,duplicate:false,order:order?{...order,status:'CANCELLED'}:qa.account.recentOrders[0],state:qa.state()};qa.notifyAccount();}
else throw Error('Unexpected API '+name);
if(name==='placeStudentWisStockOrder'&&qa.loseOrderResponse){qa.loseOrderResponse=false;throw Object.assign(Error('연결이 끊겼습니다. 다시 시도해 주세요.'),{code:'functions/unavailable'})}
return {data:structuredClone(result)};};
`;
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{qa}from'qa-fixture';import Stocks from ${JSON.stringify(path.join(root,'src/pages/student/WisStocks.tsx'))};import Account from ${JSON.stringify(path.join(root,'src/pages/student/components/wispi/StudentWisStockAccountPanel.tsx'))};import{useStudentWisStockStatus}from ${JSON.stringify(path.join(root,'src/hooks/useStudentWisStocks.ts'))};import{getStudentRouteAccess}from ${JSON.stringify(path.join(root,'src/lib/studentMenuAccess.ts'))};import ${JSON.stringify(path.join(root,'src/assets/index.css'))};import ${JSON.stringify(path.join(root,'src/components/common/portalPage.css'))};function App(){const status=useStudentWisStockStatus();qa.routeAllowed=getStudentRouteAccess({pathname:'/student/wispi'},qa.config,qa.menuConfig).allowed;return <MemoryRouter><div data-qa-menu>{status.data?.studentOpen?'메뉴: 위스피':''}</div>{qa.screen==='account'?<main className="ws-page"><Account tradingEnabled={status.data?.studentOpen===true&&!status.data?.halted}/></main>:<Stocks/>}{qa.duplicateAccount&&<Account tradingEnabled={status.data?.studentOpen===true&&!status.data?.halted}/>}</MemoryRouter>}const root=createRoot(document.getElementById('root'));qa.render=()=>root.render(<App sequence={qa.sequence=(qa.sequence||0)+1}/>);qa.render();`;
const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,format:'esm',outfile:'fixture.js',loader:{'.svg':'dataurl','.webp':'dataurl'},plugins:[{name:'mock-sdk',setup(plugin){plugin.onResolve({filter:/^qa-fixture$|^firebase\/(auth|firestore)$|(?:contexts\/AuthContext|components\/common\/AppToastProvider|lib\/firebase|\.\/firebase|lib\/historyDictionarySession|\.\/historyDictionarySession|lib\/sensitiveOperation|\.\/sensitiveOperation|\.\/appCheck|lib\/semesterScope)$/},()=>({path:'fixture',namespace:'qa'}));plugin.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:fixture,loader:'tsx',resolveDir:root}));}}]});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text,css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
assert(!js.includes('createWisStockPlanStocks'),'Student bundle must not import teacher catalog');
const html='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/qa.css"><style>body{margin:0;background:#f3f4f6;font-family:Arial,sans-serif}*{box-sizing:border-box}[data-qa-menu]{height:24px}</style><div id="root"></div><script type="module" src="/qa.js"></script></html>';
const server=http.createServer((req,res)=>{const asset={'/qa.js':['text/javascript',js],'/qa.css':['text/css',css]}[new URL(req.url,'http://localhost').pathname]||['text/html',html];res.setHeader('Content-Type',asset[0]+';charset=utf-8');res.end(asset[1]);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||'msedge',headless:true});
const errors=[],checks=[];
const chooseStock=async(page,name='청동네트웍스')=>{const row=page.locator('.student-wispi-instruments li button').filter({hasText:name});await row.waitFor({state:'attached'});if(await row.isVisible())await row.click();await page.getByRole('heading',{name,exact:true}).waitFor();};
async function open(width=390,query='',listOnly=false){const page=await browser.newPage({viewport:{width,height:900}});page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());await page.clock.install({time:new Date('2026-11-16T01:00:00Z')});await page.goto(origin+query);if(query.includes('preopen')){await page.getByText('아직 위스피가 열리지 않았습니다.',{exact:true}).waitFor();return page;}await page.locator('.student-wispi-instruments li button').first().waitFor();await page.waitForFunction(()=>window.qa.calls.some(call=>call.name==='getStudentWisStockState'));if(!listOnly)await chooseStock(page);return page;}
const calls=(page,name)=>page.evaluate(name=>window.qa.calls.filter(call=>call.name===name).length,name);
const account=async page=>{await page.getByRole('button',{name:'주식 지갑',exact:true}).click();await page.getByLabel('위스 금액',{exact:true}).waitFor();};
const walletTable = '.student-wispi-wallet-investments table';
const historyCall = 'getStudentWisStockHistory';
const graphCalls = (page) => page.evaluate(() => window.qa.calls.filter(call => call.name === 'getStudentWisStockHistory' && call.fields.view === 'returns').length);
const walletFilter = (page, name) => page.getByRole('button', { name, exact: true });
const walletRows = (page) => page.locator(walletTable + ' tbody tr');

async function waitForRows(page, count) {
  await page.waitForFunction(({ table, count }) => document.querySelectorAll(table + ' tbody tr').length === count, { table: walletTable, count });
}

async function setHoldings(page, count) {
  const before = await calls(page, 'getStudentWisStockState');
  await page.evaluate(count => {
    const q = window.qa;
    q.account.positions = q.market.stocks.slice(0, count).map(stock => ({
      stockId: stock.id, quantity: 3, reservedSellQuantity: 1, principal: 240, costBasis: 243,
    }));
    q.account.revision++;
    q.notifyAccount();
  }, count);
  await page.waitForFunction(expected => window.qa.calls.filter(call => call.name === 'getStudentWisStockState').length === expected, before + 1);
}

async function checkInternalScrolling(page) {
  const more = walletFilter(page, '더보기');
  const scroll = await more.evaluate(button => {
    const region = button.closest('.student-wispi-wallet-scroll');
    if (!region || !['auto', 'scroll'].includes(getComputedStyle(region).overflowY)) return null;
    region.scrollTop = 0;
    const pageTop = window.scrollY;
    region.scrollTop = region.scrollHeight;
    return { insideTableRegion: !!region.querySelector('table'), moved: region.scrollTop > 0, pageStayed: pageTop === window.scrollY };
  });
  assert(scroll?.insideTableRegion && scroll.moved && scroll.pageStayed, JSON.stringify(scroll));
}
async function deposit(page){await account(page);await page.getByLabel('위스 금액',{exact:true}).fill('5000');await page.getByRole('button',{name:'주식 지갑에 입금',exact:true}).click();await page.getByText('5,000 위스를 주식 지갑에 입금했습니다.',{exact:true}).waitFor();}
const layout=async(page,width)=>{const result=await page.evaluate(()=>{const header=document.querySelector('.ws-page-header')||document.querySelector('main'),style=getComputedStyle(header);return{width:innerWidth,scroll:document.documentElement.scrollWidth,header:style.backgroundColor,shadow:style.boxShadow,minHeight:style.minHeight,tabs:[...document.querySelectorAll('.ws-page-tabs')].map(el=>getComputedStyle(el).backgroundColor)}});assert(result.scroll<=width,JSON.stringify(result));assert.equal(result.header,'rgba(0, 0, 0, 0)');assert.equal(result.shadow,'none');assert(result.tabs.every(color=>color==='rgba(0, 0, 0, 0)'),JSON.stringify(result));};
const orderRow=async(page)=>{const boxes=await page.locator('.student-wispi-order-action').evaluate(row=>{const input=row.querySelector('input').getBoundingClientRect(),button=row.querySelector('button').getBoundingClientRect();return{input:{x:input.x,y:input.y,width:input.width,height:input.height},button:{x:button.x,y:button.y,width:button.width,height:button.height},overflow:row.scrollWidth>row.clientWidth}});assert(Math.abs(boxes.input.y-boxes.button.y)<2,JSON.stringify(boxes));assert(boxes.input.x+boxes.input.width<boxes.button.x,JSON.stringify(boxes));assert(boxes.input.height>=44&&boxes.button.height>=44&&!boxes.overflow,JSON.stringify(boxes));};
async function verifyWalletViews() {
  for (const width of [390, 768, 1280]) {
    const wallet = await open(width, '?catalog', true);
    await setHoldings(wallet, 1);
    await account(wallet);
    await waitForRows(wallet, 1);
    assert.equal(await walletFilter(wallet, '투자 현황').getAttribute('aria-pressed'), 'true');
    assert.equal(await walletFilter(wallet, '거래 내역').getAttribute('aria-pressed'), 'false');
    const holding = await walletRows(wallet).innerText();
    assert.match(holding, /청동네트웍스/);
    assert.match(holding, /매도 예약\s*1주/);
    assert.match(holding, /100/);
    assert.match(holding, /300/);
    await wallet.getByText(/\+57\s*위스/).first().waitFor();
    await layout(wallet, width);
    const boxes = await wallet.evaluate(() => {
      const funding = document.querySelector('.student-wispi-wallet-funding').getBoundingClientRect();
      const investments = document.querySelector('.student-wispi-wallet-investments');
      const book = investments.getBoundingClientRect();
      const headings = [...document.querySelectorAll('.student-wispi-account h2')];
      const filters = investments.querySelector('button[aria-pressed]').parentElement;
      return { fundingRight: funding.right, fundingTop: funding.top, fundingBottom: funding.bottom, bookLeft: book.left, bookTop: book.top,
        clear: [...headings, filters].every(el => getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(el).boxShadow === 'none') };
    });
    assert(boxes.clear, JSON.stringify(boxes));
    if (width === 390) assert(boxes.bookTop > boxes.fundingBottom, JSON.stringify(boxes));
    else assert(boxes.bookLeft > boxes.fundingRight && Math.abs(boxes.bookTop - boxes.fundingTop) < 2, JSON.stringify(boxes));
    if (width === 1280) {
      const row = await wallet.locator('.student-wispi-transfer form').evaluate(form =>
        [...form.children].map(el => { const rect = el.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; }));
      assert(Math.max(...row.map(control => control.top)) < Math.min(...row.map(control => control.bottom)), JSON.stringify(row));
    }
    assert.equal(await calls(wallet, historyCall), 0);
    await wallet.screenshot({ path: path.join(evidence, 'wallet-' + width + '.png'), fullPage: true });

    if (width === 1280) {
      await setHoldings(wallet, 20);
      await waitForRows(wallet, 20);
      assert.equal(await walletFilter(wallet, '더보기').count(), 0);
      await setHoldings(wallet, 21);
      await walletFilter(wallet, '더보기').waitFor();
      await waitForRows(wallet, 20);
      const reads = await calls(wallet, 'getStudentWisStockState');
      await checkInternalScrolling(wallet);
      await walletFilter(wallet, '더보기').click();
      await waitForRows(wallet, 21);
      assert.equal(await walletFilter(wallet, '더보기').count(), 0);
      assert.equal(await calls(wallet, 'getStudentWisStockState'), reads);
      assert.equal(await calls(wallet, historyCall), 0);
    }

    await walletFilter(wallet, '거래 내역').click();
    await waitForRows(wallet, 20);
    assert.equal(await walletFilter(wallet, '거래 내역').getAttribute('aria-pressed'), 'true');
    assert.equal(await wallet.locator(walletTable).count(), 1);
    await checkInternalScrolling(wallet);
    assert.equal(await calls(wallet, historyCall), 1);
    await layout(wallet, width);
    await wallet.screenshot({ path: path.join(evidence, 'wallet-history-' + width + '.png'), fullPage: true });
    assert.equal(await graphCalls(wallet), 0);
    await walletFilter(wallet, '내 그래프').click();
    const graph = wallet.getByRole('img', { name: '내 최근 30일 보유 수익률 추이', exact: true });
    await graph.waitFor();
    assert.equal(await graphCalls(wallet), 1);
    await layout(wallet, width);
    await wallet.screenshot({path:path.join(evidence, 'wallet-graph-' + width + '.png'), fullPage: true});
    await walletFilter(wallet, '투자 현황').click();
    assert.equal(await graph.isVisible(), false);
    await walletFilter(wallet, '내 그래프').click();
    await graph.waitFor();
    assert.equal(await graphCalls(wallet), 1);
    if (width === 1280) {
      await wallet.evaluate(() => { window.qa.failReturns = true; });
      await walletFilter(wallet, '주식 지갑 새로고침').click();
      await walletFilter(wallet, '다시 연결').waitFor();
      assert.equal(await graphCalls(wallet), 2);
      await walletFilter(wallet, '다시 연결').click();
      await graph.waitFor();
      assert.equal(await graphCalls(wallet), 3);
      await wallet.evaluate(() => { window.qa.holdReturns = true; });
      await walletFilter(wallet, '주식 지갑 새로고침').click();
      await wallet.waitForFunction(() => typeof window.qa.releaseReturns === 'function');
      await walletFilter(wallet, '투자 현황').click();
      await wallet.evaluate(() => window.qa.releaseReturns());
      await wallet.getByRole('table', { name: '보유 종목', exact: true }).waitFor();
      assert.equal(await graph.isVisible(), false);
      assert.equal(await graphCalls(wallet), 4);
      assert.equal(await calls(wallet, historyCall), 5);
    }
    await wallet.close();
  }
  checks.push('390/768/1280px: one scrollable table, transparent headers, accurate totals and no page overflow. Exactly 20 holdings hide more; 21 show 20 then 21 locally. History and own chart start only on selection. Chart reentry adds zero reads; failed explicit refresh and successful retry each add one. A late graph response leaves the selected table visible.');
}

async function verifyWalletHistory() {
  const overlap = await open();
  await overlap.evaluate(() => { window.qa.duplicateAccount = true; window.qa.holdHistory = true; window.qa.render(); });
  await overlap.getByRole('button', { name: '주식 지갑', exact: true }).click();
  await overlap.waitForFunction(() => document.querySelectorAll('.student-wispi-account').length === 2);
  assert.equal(await calls(overlap, historyCall), 0);
  await walletFilter(overlap, '거래 내역').evaluateAll(buttons => buttons.forEach(button => button.click()));
  await overlap.waitForFunction(() => typeof window.qa.releaseHistory === 'function');
  assert.equal(await calls(overlap, historyCall), 1);
  assert.equal(await calls(overlap, 'getStudentWisStockState'), 1);
  assert.equal((await overlap.evaluate(() => window.qa.activePaths())).filter(p => p.includes('wis_stock_accounts')).length, 1);
  await overlap.evaluate(() => window.qa.releaseHistory());
  await waitForRows(overlap, 40);
  await overlap.evaluate(() => { const q = window.qa; q.failHistory = ''; q.account.revision++; q.notifyAccount(); });
  await overlap.waitForFunction(() => document.querySelectorAll('.student-wispi-read-status button').length === 2);
  assert.equal(await calls(overlap, historyCall), 2);
  await overlap.getByRole('button', { name: '다시 연결', exact: true }).evaluateAll(buttons => buttons.forEach(button => button.click()));
  await waitForRows(overlap, 40);
  assert.equal(await calls(overlap, historyCall), 3);
  await overlap.close();
  checks.push('Two open history filters share one live account request/listener and one first-page request. Account revision invalidates both, and concurrent manual recovery shares one retry.');

  const history = await open();
  await account(history);
  await walletFilter(history, '거래 내역').click();
  await waitForRows(history, 20);
  const firstRow = await walletRows(history).first().innerText();
  await history.evaluate(() => { window.qa.failHistory = '20'; });
  await walletFilter(history, '더보기').click();
  const reconnect = walletFilter(history, '다시 연결');
  await reconnect.waitFor();
  assert.equal(await walletRows(history).count(), 20);
  await reconnect.click();
  await waitForRows(history, 40);
  assert.equal(await walletRows(history).first().innerText(), firstRow);
  await walletFilter(history, '더보기').click();
  await waitForRows(history, 43);
  assert.equal(await walletFilter(history, '더보기').count(), 0);
  await walletFilter(history, '투자 현황').click();
  assert.equal(await history.getByRole('table', { name: '거래 내역', exact: true }).count(), 0);
  await walletFilter(history, '거래 내역').click();
  await waitForRows(history, 43);
  const cursors = await history.evaluate(() => window.qa.calls.filter(x => x.name === 'getStudentWisStockHistory' && x.fields.view !== 'returns').map(x => x.fields.cursor));
  assert.deepEqual(cursors, ['', '20', '20', '40']);
  await walletFilter(history, '투자 현황').click();
  const stateCalls = await calls(history, 'getStudentWisStockState');
  await history.evaluate(() => {const q = window.qa; q.records = q.records.slice(0, 20); q.account.revision++; q.notifyAccount();});
  await history.waitForFunction(expected => window.qa.calls.filter(c => c.name === 'getStudentWisStockState').length === expected, stateCalls + 1);
  assert.equal(await calls(history, historyCall), 4);
  await walletFilter(history, '거래 내역').click();
  await waitForRows(history, 20);
  assert.equal(await walletFilter(history, '더보기').count(), 0);
  assert.equal(await calls(history, historyCall), 5);
  await history.evaluate(() => {window.qa.records = [];});
  await walletFilter(history, '주식 지갑 새로고침').click();
  await history.getByText('아직 내역이 없습니다.', {exact:true}).waitFor();
  assert.equal(await calls(history, historyCall), 6);
  assert.equal(await walletFilter(history, '더보기').count(), 0);
  await history.evaluate(() => {
    const q = window.qa;
    q.records = [{id:'old', kind:'DEPOSIT', atMs:Date.now(), stockCashDelta:357, mainCashDelta:-357, earnedDelta:0}];
    q.holdHistory = true;
  });
  await walletFilter(history, '주식 지갑 새로고침').click();
  await history.waitForFunction(() => typeof window.qa.releaseHistory === 'function');
  await history.evaluate(() => {
    const q = window.qa;
    q.config = {...q.config, semester:'1'};
    q.status = {...q.status, semesterId:'2026-1'};
    q.market = {...q.market, semesterId:'2026-1'};
    q.generation++;
    q.records = [];
    q.render();
  });
  await history.locator('.student-wispi-instruments li button').first().waitFor();
  await account(history);
  await walletFilter(history, '거래 내역').click();
  await history.getByText('아직 내역이 없습니다.', {exact:true}).waitFor();
  await history.evaluate(() => window.qa.releaseHistory());
  await history.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await walletRows(history).count(), 0);
  assert.equal(await calls(history, historyCall), 8);
  await history.close();
  checks.push('43 trade records append 20/20/3 with the first row preserved. Cursor 20 retries once. Reopening the same revision adds zero calls. Exactly 20 and empty pages hide more. Inactive revisions wait for selection, explicit refresh reads once and a delayed response from the old semester cannot replace the new semester.');
}

try{
 if (process.argv.includes('--wallet-only')) {
   await verifyWalletViews();
   await verifyWalletHistory();
 } else {
 if(!process.argv.includes('--graduation-only')){
   if(!process.argv.includes('--wallet-freshness-only')){
   const name='getStudentWisStockRanking';
   for(const width of [320,390,768,1280,1440]){
     const page=await open(width,'',true);assert.equal(await calls(page,name),0);
     await page.getByRole('button',{name:'투자 랭킹',exact:true}).click();
     const rows=page.locator('.student-wispi-rank-list > .student-wispi-rank-entry > button');await rows.first().waitFor();
     await page.locator('.student-wispi-rank-chart canvas').waitFor();
     assert.equal(await rows.count(),10);assert.equal(await calls(page,name),1);
     assert.equal(await page.locator('.student-wispi-rank-legend li').count(),5);
     const moreLayout=await page.locator('.ws-wis-stock-load-more').evaluate(button=>{const list=button.closest('ol'),style=getComputedStyle(button);return{inside:!!list,width:button.getBoundingClientRect().width,parent:button.parentElement.getBoundingClientRect().width,filter:style.filter,backdrop:style.backdropFilter,height:button.getBoundingClientRect().height}});assert(moreLayout.inside&&Math.abs(moreLayout.width-moreLayout.parent)<1&&moreLayout.height>=44&&moreLayout.filter==='none'&&moreLayout.backdrop==='none',JSON.stringify(moreLayout));
     assert.equal(await page.getByText('보유 종목',{exact:true}).count(),0);
     assert.deepEqual((await page.evaluate(()=>window.qa.activePaths())).sort(),['application_sessions/student-a/sessions/1001','years/2026/semesters/2/wis_stock_public/current']);
     if(width===1280)await page.screenshot({path:path.join(evidence,'ranking-top-five-1280.png')});
     await rows.first().focus();await page.keyboard.press('Enter');assert.equal(await rows.first().getAttribute('aria-pressed'),'true');
     assert.equal(await page.locator('.student-wispi-rank-legend li').count(),1);assert.equal(await calls(page,name),1);
     await rows.nth(6).click();await page.getByRole('heading',{name:'연습학생7 보유 수익률',exact:true}).waitFor();
     await page.locator('.student-wispi-rank-chart canvas').waitFor();assert.equal(await calls(page,name),2);
     await page.getByRole('button',{name:'상위 5명',exact:true}).click();assert.equal(await page.locator('.student-wispi-rank-legend li').count(),5);
     await rows.nth(6).click();assert.equal(await calls(page,name),2);
     await layout(page,width);
     if(width>=1280){const boxes=await page.evaluate(()=>{const a=document.querySelector('.student-wispi-ranking-results').getBoundingClientRect(),b=document.querySelector('.student-wispi-rank-detail').getBoundingClientRect();return{right:a.right,left:b.left,ay:a.y,by:b.y}});assert(boxes.left>boxes.right&&Math.abs(boxes.ay-boxes.by)<1,JSON.stringify(boxes));}
     await page.screenshot({path:path.join(evidence,'ranking-'+width+'.png')});
     await page.getByRole('button',{name:'더보기',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.student-wispi-rank-list > .student-wispi-rank-entry').length===20);assert.equal(await calls(page,name),3);
     await page.clock.fastForward(60000);assert.equal(await calls(page,name),3,'no timer-driven next page reads');
     for(const expected of [30,40,50]){const more=page.getByRole('button',{name:'더보기',exact:true});await more.scrollIntoViewIfNeeded();const before=await page.locator('.student-wispi-rank-list').evaluate(el=>el.scrollTop);await more.click();await page.waitForFunction(expected=>document.querySelectorAll('.student-wispi-rank-list > .student-wispi-rank-entry').length===expected,expected);const after=await page.locator('.student-wispi-rank-list').evaluate(el=>el.scrollTop);assert(Math.abs(before-after)<=1,JSON.stringify({expected,before,after}));}
     assert.equal(await page.getByRole('button',{name:'더보기',exact:true}).count(),0);
     await page.getByRole('button',{name:'우리 학급 순위',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.student-wispi-rank-list > .student-wispi-rank-entry').length===10);assert.equal(await rows.first().locator('.student-wispi-rank-number').innerText(),'1위');
     for(const expected of [20,23]){await page.getByRole('button',{name:'더보기',exact:true}).click();await page.waitForFunction(expected=>document.querySelectorAll('.student-wispi-rank-list > .student-wispi-rank-entry').length===expected,expected)}
     assert.equal(await page.getByRole('button',{name:'더보기',exact:true}).count(),0);
     if(width===1280){await page.getByLabel('랭킹 학급 선택').selectOption('3_2');await page.waitForFunction(()=>document.querySelectorAll('.student-wispi-rank-list > .student-wispi-rank-entry').length===10);for(const expected of [20,30,40,50,54]){await page.getByRole('button',{name:'더보기',exact:true}).click();await page.waitForFunction(expected=>document.querySelectorAll('.student-wispi-rank-list > .student-wispi-rank-entry').length===expected,expected)}assert.equal(await page.getByRole('button',{name:'더보기',exact:true}).count(),0);}
     await page.close();
   }
   const page=await open(390,'',true),goRanking=()=>page.getByRole('button',{name:'투자 랭킹',exact:true}).click();
   await page.evaluate(()=>{window.qa.rankingError=true});await goRanking();await page.getByText('투자 랭킹 연결을 다시 확인해 주세요.',{exact:true}).waitFor();
   await page.evaluate(()=>{window.qa.rankingMode='pending'});await page.getByRole('button',{name:'다시 연결',exact:true}).click();await page.getByText('아직 전날 랭킹이 준비되지 않았습니다.').waitFor();
   await page.evaluate(()=>{window.qa.rankingMode='empty'});await page.getByRole('button',{name:'다시 확인',exact:true}).click();await page.getByText('전날 보유 수익률이 집계된 학생이 없습니다.').waitFor();
   await page.getByRole('button',{name:'주식 시장',exact:true}).click();await page.evaluate(()=>{window.qa.rankingMode='';window.qa.futurePoint=true});await goRanking();
   await page.locator('.student-wispi-rank-list > .student-wispi-rank-entry > button').nth(6).click();await page.getByText('수익률 그래프 연결을 다시 확인해 주세요.',{exact:true}).waitFor();
   await page.evaluate(()=>{window.qa.futurePoint=false;window.qa.holdRanking=true});await page.getByRole('button',{name:'다시 연결',exact:true}).click();await page.waitForFunction(()=>typeof window.qa.releaseRanking==='function');
   await page.clock.fastForward(1000);await page.locator('.student-wispi-rank-detail .ws-loading-surface').waitFor();await page.screenshot({path:path.join(evidence,'ranking-loading-390.png')});
   await page.clock.fastForward(14*3600000+1000);await page.waitForFunction(()=>document.querySelector('.student-wispi-ranking > div > time')?.getAttribute('datetime')==='2026-11-16T14:59:00.000Z');await page.evaluate(()=>window.qa.releaseRanking());
   assert.equal(await page.locator('.student-wispi-rank-list button[aria-pressed="true"]').count(),0);assert.equal(await page.locator('.student-wispi-rank-legend li').count(),5);
   await page.evaluate(()=>{window.qa.rankingError=true});await page.getByRole('button',{name:'더보기',exact:true}).click();await page.getByText('다음 순위 연결을 다시 확인해 주세요.',{exact:true}).waitFor();assert.equal(await page.locator('.student-wispi-rank-list > .student-wispi-rank-entry').count(),10);await page.getByRole('button',{name:'다시 연결',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.student-wispi-rank-list > .student-wispi-rank-entry').length===20);
   await page.evaluate(()=>{window.qa.holdRankingPage=true});await page.getByRole('button',{name:'더보기',exact:true}).click();await page.waitForFunction(()=>typeof window.qa.releaseRankingPage==='function');await page.getByRole('button',{name:'우리 학급 순위',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.student-wispi-rank-list > .student-wispi-rank-entry').length===10);await page.evaluate(()=>window.qa.releaseRankingPage());assert.equal(await page.locator('.student-wispi-rank-list > .student-wispi-rank-entry').count(),10);
   await page.evaluate(()=>{window.qa.emptyFirstRankingPage=true});await page.getByRole('button',{name:'전체 순위',exact:true}).click();await page.getByRole('button',{name:'더보기',exact:true}).waitFor();assert.equal(await page.locator('.student-wispi-rank-list > .student-wispi-rank-entry').count(),0);await page.getByRole('button',{name:'더보기',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.student-wispi-rank-list > .student-wispi-rank-entry').length===10);assert.equal(await page.locator('.student-wispi-rank-legend li').count(),5);assert.equal(await page.evaluate(()=>window.qa.calls.filter(call=>call.name==='getStudentWisStockRanking').at(-1).fields.chartCount),5);
   await page.evaluate(()=>window.qa.setHalted(true));await page.getByRole('alert').getByText('위스피의 거래가 중지되었습니다.').waitFor();assert.equal(await page.locator('.student-wispi-ranking').count(),0);await page.close();
   checks.push('Ranking: 320/390/768/1280/1440px; first request returns 10 rows plus top-five charts; cached top-five/selected graph, no holdings, user-only 10-row pagination capped at 50 overall, own class 23 and another class 54; scoped rank 1; keyboard, no inactive market/account reads, loading, retry with exact cursor, stale page after filter switch, KST midnight and publication halt.');
   await verifyWalletViews();
   }
   const ttl=await open(1280,'',true);
   await ttl.evaluate(()=>{const q=window.qa;q.account.positions=[{stockId:q.market.stocks[0].id,quantity:3,reservedSellQuantity:0,principal:240,costBasis:243}];q.account.revision++;q.notifyAccount()});
   await ttl.waitForFunction(()=>window.qa.calls.filter(call=>call.name==='getStudentWisStockState').length===2);
   await ttl.clock.fastForward(30001);const beforeTtl=await calls(ttl,'getStudentWisStockState');
   await ttl.evaluate(()=>{const q=window.qa;q.market.stocks[0].price=125;q.market.revision++;q.holdRead=true;q.duplicateAccount=true;q.render()});
   await ttl.waitForFunction(()=>typeof window.qa.releaseRead==='function');await ttl.getByRole('button',{name:'주식 지갑',exact:true}).click();await ttl.waitForFunction(()=>document.querySelectorAll('.student-wispi-account').length===2);
   assert.equal(await calls(ttl,'getStudentWisStockState'),beforeTtl+1,'two stale wallet mounts share one refresh');
   await ttl.evaluate(()=>window.qa.releaseRead());await ttl.waitForFunction(() => {const rows = [...document.querySelectorAll('table[aria-label="보유 종목"] tbody tr')];return rows.length === 2 && rows.every(row => row.textContent.includes('125'));});
   assert.equal(await ttl.locator('.student-wispi-account time').count(),2);assert.equal(await ttl.locator('.student-wispi-account time').first().getAttribute('datetime'),await ttl.evaluate(()=>new Date(window.qa.lastStateServerNowMs).toISOString()));
   await ttl.evaluate(()=>{window.qa.duplicateAccount=false;window.qa.render()});await ttl.getByRole('button',{name:'주식 시장',exact:true}).click();await account(ttl);assert.equal(await calls(ttl,'getStudentWisStockState'),beforeTtl+1,'fresh entry does not refresh');
   await ttl.getByRole('button',{name:'주식 시장',exact:true}).click();await ttl.clock.fastForward(120000);assert.equal(await calls(ttl,'getStudentWisStockState'),beforeTtl+1,'no timed polling');await account(ttl);await ttl.waitForFunction(expected=>window.qa.calls.filter(call=>call.name==='getStudentWisStockState').length===expected,beforeTtl+2);
   await ttl.evaluate(()=>{const q=window.qa;q.generation++;q.config={...q.config,semester:'1'};q.status={...q.status,semesterId:'2026-1'};q.market={...q.market,semesterId:'2026-1'};q.account.revision++;q.render()});await ttl.locator('.student-wispi-instruments li button').first().waitFor();await account(ttl);await waitForRows(ttl, 1);assert.equal(await calls(ttl,'getStudentWisStockState'),beforeTtl+3,'new semester reads once and never refreshes its fresh result');
   const ttlPaths=await ttl.evaluate(()=>window.qa.activePaths());assert(ttlPaths.every(p=>!p.includes('/semesters/')||p.includes('/semesters/1/')),JSON.stringify(ttlPaths));
   await ttl.getByRole('button',{name:'주식 시장',exact:true}).click();await ttl.clock.fastForward(30001);await ttl.evaluate(()=>{window.qa.failState=true});await ttl.getByRole('button',{name:'주식 지갑',exact:true}).click();await ttl.getByText('주식 지갑 연결을 다시 확인해 주세요.',{exact:true}).waitFor();assert.equal(await calls(ttl,'getStudentWisStockState'),beforeTtl+4);await ttl.getByRole('button',{name:'다시 연결',exact:true}).click();await waitForRows(ttl, 1);assert.equal(await calls(ttl,'getStudentWisStockState'),beforeTtl+5);await ttl.close();
   checks.push('Wallet freshness: >30s held-account entry refreshes exactly once, two simultaneous views share one read, fresh reentry adds none, later reentry adds one with no polling, semester change reads once in its own scope, server timestamp is displayed, failed refresh clears stale data and explicit reconnect recovers once.');

 }
 if(!process.argv.includes('--ranking-only')&&!process.argv.includes('--wallet-freshness-only')) {
 for(const width of [320,390,768,1280]) {
   const graduated=await open(width);await graduated.evaluate(()=>{const q=window.qa;q.account.stockCash=1000;q.account.positions=[{stockId:q.market.stocks[0].id,quantity:3,reservedSellQuantity:0,principal:300,costBasis:303}];q.account.revision++;q.notifyAccount();q.market.stocks[0].settings.tradingStatus='GRADUATED';q.market.revision++;q.emit('/market')});
   await graduated.locator('#student-wispi-order-problem').filter({hasText:'졸업한 종목'}).waitFor();
   const buy=graduated.getByRole('button',{name:'매수 주문 접수',exact:true});assert.equal(await buy.isDisabled(),true);await buy.evaluate(button=>button.click());
   await graduated.getByRole('button',{name:'매도',exact:true}).click();const sell=graduated.getByRole('button',{name:'매도 주문 접수',exact:true});assert.equal(await sell.isDisabled(),true);await sell.evaluate(button=>button.click());assert.equal(await calls(graduated,'placeStudentWisStockOrder'),0);await layout(graduated,width);
   await graduated.screenshot({path:path.join(evidence,'graduated-'+width+'.png'),fullPage:false});await graduated.close();
 }
 checks.push('Graduated stock at 320/390/768/1280px: actual public/account clients accept state, both buy and sell disabled, explicit final-price settlement reason, zero order commands.');
 const bonus=await open(390);assert.equal(await calls(bonus,'getStudentWisStockBonus'),0,'market tab never reads bonus eligibility');await bonus.evaluate(()=>{const q=window.qa;q.bonusEnabled=true;q.records=[{id:'event',kind:'EVENT_BONUS',atMs:Date.now(),stockCashDelta:500,mainCashDelta:0,earnedDelta:0,campaignId:'fixture'}, {id:'graduation',kind:'ORDER_FILLED',automaticSettlement:'GRADUATION',side:'SELL',stockId:q.market.stocks[0].id,quantity:3,atMs:Date.now()-1000,stockCashDelta:300,mainCashDelta:0,earnedDelta:0}];});
 await account(bonus);await walletFilter(bonus, '거래 내역').click();await bonus.getByRole('rowheader',{name:/위스피 이벤트 보상/}).waitFor();await bonus.getByRole('rowheader',{name:/종목 졸업 정산 · 매도/}).waitFor();
 await bonus.getByLabel('위스 금액',{exact:true}).fill('500');await bonus.getByRole('button',{name:'주식 지갑에 입금',exact:true}).click();await bonus.getByText('500 위스를 주식 지갑에 입금했습니다.',{exact:true}).waitFor();assert.equal(await calls(bonus,'transferStudentWisStock'),1);assert.equal(await bonus.evaluate(()=>window.qa.account.stockCash),500);assert.equal(await calls(bonus,'claimStudentWisStockBonus'),0);
 await bonus.getByRole('button',{name:'500위스 받기',exact:true}).click();await bonus.getByRole('button',{name:'받기 완료',exact:true}).waitFor();assert.equal(await calls(bonus,'claimStudentWisStockBonus'),1);assert.equal(await bonus.evaluate(()=>window.qa.account.stockCash),1000);assert.equal(await bonus.evaluate(()=>window.qa.toasts.at(-1).tone),'reward');await layout(bonus,390);await bonus.screenshot({path:path.join(evidence,'event-bonus-history-390.png'),fullPage:true});await bonus.close();
 checks.push('Market makes zero eligibility reads; a 500 deposit leaves exactly 500 stock cash until explicit claim adds 500 once and a reward toast. EVENT_BONUS and GRADUATION history labels remain readable through real clients and UI.');
 if(!process.argv.includes('--graduation-only')) {
 const blocked=await open();const problem=blocked.locator('#student-wispi-order-problem'),buy=blocked.getByRole('button',{name:'매수 주문 접수',exact:true});
 await blocked.evaluate(()=>{const q=window.qa;q.account.stockCash=5000;q.account.reservedCash=4900;q.account.revision++;q.market.rules.minimumCashReserve=100;q.market.revision++;q.emit('/market');q.notifyAccount()});
 await problem.filter({hasText:'4,900 위스가 대기 주문에 예약'}).waitFor();assert.match(await problem.innerText(),/수수료 포함 결제 101 위스.*최소 잔액 100 위스.*101 위스가 부족/);assert.equal(await buy.isDisabled(),true);assert.equal(await buy.getAttribute('aria-describedby'),'student-wispi-order-problem');await buy.evaluate(button=>button.click());assert.equal(await calls(blocked,'placeStudentWisStockOrder'),0);
 await blocked.locator('.student-wispi-order').scrollIntoViewIfNeeded();await blocked.screenshot({path:path.join(evidence,'order-reserved-cash-390.png'),fullPage:false});
 await blocked.evaluate(()=>{const q=window.qa;q.account.stockCash=100;q.account.reservedCash=0;q.account.revision++;q.market.rules.minimumCashReserve=0;q.market.revision++;q.emit('/market');q.notifyAccount()});await problem.filter({hasText:'1 위스가 부족'}).waitFor();assert.match(await problem.innerText(),/수수료 포함 결제 101 위스/);
 await blocked.evaluate(()=>{const q=window.qa;q.account.stockCash=101;q.account.revision++;q.market.rules.minimumCashReserve=1;q.market.revision++;q.emit('/market');q.notifyAccount()});await problem.filter({hasText:'최소 잔액 1 위스'}).waitFor();assert.equal(await buy.isDisabled(),true);
 await blocked.evaluate(()=>{const q=window.qa;q.account.stockCash=5000;q.account.revision++;q.notifyAccount()});await blocked.waitForFunction(()=>document.querySelector('.student-wispi-order button[type="submit"]')?.disabled===false);
 const blockedReads=await calls(blocked,'getStudentWisStockState');await blocked.getByLabel('수량',{exact:true}).fill('');await problem.filter({hasText:'1주 이상'}).waitFor();assert.equal(await buy.isDisabled(),true);
 await blocked.evaluate(()=>{const q=window.qa;q.market.stocks[0].settings.lotSize=5;q.market.rules.maxOrderQuantity=10;q.market.revision++;q.emit('/market')});
 // Let the live lot-size effect initialize its new default before testing user input.
 await blocked.waitForFunction(()=>document.querySelector('input[aria-label="수량"]')?.value==='5');
 await blocked.getByLabel('수량',{exact:true}).fill('6');await problem.filter({hasText:'5주 단위'}).waitFor();assert.equal(await buy.isDisabled(),true);await blocked.getByLabel('수량',{exact:true}).fill('15');await problem.filter({hasText:'최대 10주'}).waitFor();assert.equal(await buy.isDisabled(),true);await blocked.getByLabel('수량',{exact:true}).fill('5');await blocked.waitForFunction(()=>document.querySelector('.student-wispi-order button[type="submit"]')?.disabled===false);
 await blocked.evaluate(()=>{const q=window.qa;q.market.stocks[0].settings.tradingStatus='SELL_ONLY';q.market.revision++;q.emit('/market')});await problem.filter({hasText:'매도만 가능'}).waitFor();assert.equal(await buy.isDisabled(),true);
 await blocked.evaluate(()=>{const q=window.qa;q.market.stocks[0].settings.tradingStatus='HALTED';q.market.revision++;q.emit('/market')});await problem.filter({hasText:'종목은 거래 정지 중'}).waitFor();assert.equal(await buy.isDisabled(),true);assert.equal(await calls(blocked,'getStudentWisStockState'),blockedReads);assert.equal(await calls(blocked,'placeStudentWisStockOrder'),0);
 await blocked.evaluate(()=>{const q=window.qa;q.market.stocks[0].settings.tradingStatus='ACTIVE';q.market.revision++;q.emit('/market');q.account.positions=[{stockId:q.market.stocks[0].id,quantity:10,reservedSellQuantity:10,principal:1000,costBasis:1010}];q.account.revision++;q.notifyAccount()});await blocked.getByRole('button',{name:'매도',exact:true}).click();await problem.filter({hasText:'10주가 매도 대기 중'}).waitFor();assert.equal(await blocked.getByRole('button',{name:'매도 주문 접수',exact:true}).isDisabled(),true);await orderRow(blocked);await blocked.close();
 checks.push('Every local disabled order exposes its cause: reserved cash despite a funded wallet, fee-only shortage, minimum reserve, missing/lot/maximum quantity, sell-only/halted stock and reserved sell shares. Invalid actions send no command; quantity and market-rule checks add no account reads.');
 for(const width of [320,390,768,1280,1440]){const page=await open(width);await orderRow(page);assert.equal(await page.getByRole('button',{name:'매수 주문 접수',exact:true}).innerText(),'매수');await page.getByRole('button',{name:'매도',exact:true}).click();await orderRow(page);assert.equal(await page.getByRole('button',{name:'매도 주문 접수',exact:true}).innerText(),'매도');await layout(page,width);await page.locator('.student-wispi-order').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,'order-inline-'+width+'.png'),fullPage:false});await page.close();}
 checks.push('320/390/768/1280/1440px: quantity input and compact buy/sell submit stay on the same row with 44px controls, explicit action names and no overflow.');
 const haltResume=await open();await deposit(haltResume);await haltResume.getByRole('button',{name:'주식 시장',exact:true}).click();await chooseStock(haltResume);const readsBeforeHalt=await calls(haltResume,'getStudentWisStockState');await haltResume.evaluate(()=>{const q=window.qa;q.market.stocks[0].haltedUntilMs=Date.now()+5000;q.market.revision++;q.emit('/market')});await haltResume.waitForFunction(()=>document.querySelector('.student-wispi-order button[type="submit"]')?.disabled===true);assert.equal(await haltResume.evaluate(()=>window.qa.account.pendingOrders.length),0);await haltResume.clock.fastForward(5001);await haltResume.waitForFunction(()=>document.querySelector('.student-wispi-order button[type="submit"]')?.disabled===false);assert.equal(await calls(haltResume,'getStudentWisStockState'),readsBeforeHalt);assert.equal(await calls(haltResume,'placeStudentWisStockOrder'),0);await haltResume.close();checks.push('An ACTIVE instrument temporary halt expires after 5 seconds without a pending order: submit re-enables through one local timeout, with no extra state read or order command.');
 for(const width of [320,390,768,1280,1440]){const page=await open(width);await layout(page,width);assert.equal(await page.locator('.student-wispi-order label > span').first().evaluate(el=>getComputedStyle(el).whiteSpace),'nowrap');const paths=await page.evaluate(()=>window.qa.activePaths());assert.equal(paths.length,4,JSON.stringify(paths));assert.equal(paths.filter(p=>p.startsWith('application_sessions/')).length,1);assert.equal(await calls(page,'getStudentWisStockState'),1);assert.equal(await calls(page,'getStudentWisStockHistory'),0);await page.waitForFunction(()=>{const plot=document.querySelector('.wis-stock-chart__plot');return plot?.querySelector('.wispi-price-chart__candle')&&Number(getComputedStyle(plot).opacity)===1});await page.waitForTimeout(100);await page.screenshot({path:path.join(evidence,'market-'+width+'.png'),fullPage:false});await deposit(page);assert.equal(await calls(page,'transferStudentWisStock'),1);assert.equal(await calls(page,'getStudentWisStockState'),1,'Mutation response avoids redundant state reads');assert.equal((await page.evaluate(()=>window.qa.activePaths())).some(p=>p.endsWith('/market')),false);await layout(page,width);await page.screenshot({path:path.join(evidence,'account-'+width+'.png'),fullPage:false});await page.close();}
 checks.push('Five widths: real student UI, no overflow or white header; one status/price/session/account listener, one initial state query, no unused history query, no redundant post-transfer query.');
 for(const width of [320,390,768,1280,1440]){
  const page=await open(width,'?catalog',true);await layout(page,width);
  const rows=page.locator('.student-wispi-instruments li button');assert.equal(await rows.count(),23);
  const first=rows.filter({hasText:'청동네트웍스'}),falling=rows.filter({hasText:'한양 상업'});
  assert.match(await first.innerText(),/\+25(?:\.0+)?%/,'Daily change uses previous KST close, not the last tick');
  assert.match(await falling.innerText(),/-20(?:\.0+)?%/);
  const colors=await page.evaluate(()=>{const rows=[...document.querySelectorAll('.student-wispi-instruments li button')];return rows.slice(0,2).map(row=>{const el=row.querySelector('.is-up,.is-down');return el&&getComputedStyle(el).color})});assert(colors[0]&&colors[1]&&colors[0]!==colors[1],JSON.stringify(colors));
  for(const row of [first,falling]){const boxes=await row.evaluate(el=>{const b=el.getBoundingClientRect();return {width:b.width,height:b.height,overflow:el.scrollWidth>el.clientWidth}});assert(boxes.height>=44&&!boxes.overflow,JSON.stringify(boxes));}
  await page.screenshot({path:path.join(evidence,'market-list-'+width+'.png'),fullPage:false});
  const reads=await calls(page,'getStudentWisStockState');await page.getByRole('button',{name:'하락',exact:true}).click();assert.equal(await rows.count(),1);assert.match(await rows.first().innerText(),/한양/);
  await page.getByRole('button',{name:'상승',exact:true}).click();assert.equal(await rows.count(),21);
  await page.getByRole('button',{name:'전체',exact:true}).first().click();await page.getByLabel('종목 검색',{exact:true}).fill('고려');assert.equal(await rows.count(),1);
  await page.getByLabel('종목 검색',{exact:true}).fill('없는종목');assert.equal(await rows.count(),0);await layout(page,width);
  await page.getByLabel('종목 검색',{exact:true}).fill('');assert.equal(await rows.count(),23);assert.equal(await calls(page,'getStudentWisStockState'),reads,'Search and change filters do not read the server');
  await chooseStock(page);await layout(page,width);await page.waitForFunction(()=>{const plot=document.querySelector('.wis-stock-chart__plot');return plot?.querySelector('.wispi-price-chart__candle')&&Number(getComputedStyle(plot).opacity)===1});await page.screenshot({path:path.join(evidence,'market-detail-'+width+'.png'),fullPage:false});
  const back=page.getByRole('button',{name:'종목 목록',exact:true});if(await back.isVisible()){assert.equal(await rows.first().isVisible(),false);await back.click();assert.equal(await rows.first().isVisible(),true);await chooseStock(page,'한양 상업과 유통 산업의 발전을 연구하는 아주 긴 역사 종목');await layout(page,width);await page.screenshot({path:path.join(evidence,'market-long-name-'+width+'.png'),fullPage:false});}
  else{const listBox=await page.locator('.student-wispi-instruments').boundingBox(),detailBox=await page.locator('.student-wispi-detail').boundingBox();assert(listBox.x+listBox.width<=detailBox.x,'Desktop list and chart occupy separate columns');}
  await page.close();
 }
 checks.push('320/390/768/1280/1440px: daily red/blue returns, full-width selectable rows, long names, local search/filter and mobile list/detail return remain readable without horizontal page overflow.');
 const submitting=await open();await deposit(submitting);await submitting.getByRole('button',{name:'주식 시장',exact:true}).click();await chooseStock(submitting);await submitting.evaluate(()=>window.qa.holdOrder=true);
 await submitting.getByRole('button',{name:'매수 주문 접수',exact:true}).evaluate(button=>{button.click();button.click()});await submitting.getByText('주문 접수 중',{exact:true}).waitFor();assert.equal(await calls(submitting,'placeStudentWisStockOrder'),1);
 assert.equal(await submitting.locator('.student-wispi-order button[type="submit"]:disabled').count(),0,'Sending is a progress status instead of a disabled order button');
 await submitting.evaluate(()=>window.qa.releaseOrder());await submitting.getByRole('heading',{name:/^주식 체결 중/}).waitFor();assert.match(await submitting.locator('body').innerText(),/남은 시간\s*5초/);assert.equal(await submitting.getByRole('button',{name:'매수 주문 접수',exact:true}).isEnabled(),true,'Accepted pending order does not lock the next valid order');
 const beforeCountdown=await calls(submitting,'getStudentWisStockState');await submitting.clock.fastForward(2000);assert.match(await submitting.locator('body').innerText(),/남은 시간\s*3초/);assert.equal(await calls(submitting,'getStudentWisStockState'),beforeCountdown);await submitting.locator('.student-wispi-detail .student-wispi-pending').scrollIntoViewIfNeeded();await submitting.screenshot({path:path.join(evidence,'pending-order-390.png'),fullPage:false});await submitting.close();
 checks.push('Slow acceptance replaces disabled submit with status; same-tick double click sends one command, accepted order immediately shows server countdown while the next valid order stays enabled, and countdown performs no reads.');
 const retry=await open();await deposit(retry);await retry.getByRole('button',{name:'주식 시장',exact:true}).click();await chooseStock(retry);await retry.evaluate(()=>window.qa.failOrder=true);await retry.getByRole('button',{name:'매수 주문 접수',exact:true}).click();await retry.getByRole('alert').filter({hasText:'시세가 바뀌었습니다'}).waitFor();assert.equal(await retry.getByRole('button',{name:'매수 주문 접수',exact:true}).isEnabled(),true);await retry.getByRole('button',{name:'매수 주문 접수',exact:true}).click();await retry.getByRole('heading',{name:/^주식 체결 중/}).waitFor();const retryIds=await retry.evaluate(()=>window.qa.calls.filter(c=>c.name==='placeStudentWisStockOrder').map(c=>c.fields.requestId));assert.equal(retryIds.length,2);assert.notEqual(retryIds[0],retryIds[1]);assert.equal(await retry.evaluate(()=>window.qa.account.pendingOrders.length),1);await retry.close();
 checks.push('Deterministic quote rejection displays an actionable inline error; manual retry uses a fresh receipt and creates one pending order.');
 const uncertain=await open();await deposit(uncertain);await uncertain.getByRole('button',{name:'주식 시장',exact:true}).click();await chooseStock(uncertain);await uncertain.evaluate(()=>window.qa.loseOrderResponse=true);await uncertain.getByRole('button',{name:'매수 주문 접수',exact:true}).click();await uncertain.getByRole('alert').filter({hasText:'연결이 끊겼습니다'}).waitFor();await uncertain.getByRole('button',{name:'매수 주문 접수',exact:true}).click();await uncertain.waitForFunction(()=>window.qa.calls.filter(c=>c.name==='placeStudentWisStockOrder').length===2);const uncertainIds=await uncertain.evaluate(()=>window.qa.calls.filter(c=>c.name==='placeStudentWisStockOrder').map(c=>c.fields.requestId));assert.equal(uncertainIds[0],uncertainIds[1]);assert.equal(await uncertain.evaluate(()=>window.qa.account.pendingOrders.length),1);assert.equal(await uncertain.evaluate(()=>window.qa.account.reservedCash),101);await uncertain.close();
 checks.push('A response lost after acceptance keeps the receipt on manual retry; the browser recovers the same pending order without a second cash reservation.');
 const sale=await open();await deposit(sale);await sale.getByRole('button',{name:'주식 시장',exact:true}).click();await chooseStock(sale);await sale.getByLabel('수량',{exact:true}).fill('2');await sale.getByRole('button',{name:'매수 주문 접수',exact:true}).click();await sale.getByRole('heading',{name:/^주식 체결 중/}).waitFor();await sale.evaluate(()=>window.qa.fill());await sale.getByText('체결 완료',{exact:true}).waitFor();await sale.getByRole('button',{name:'매도',exact:true}).click();assert.equal(await sale.getByRole('button',{name:'매도 주문 접수',exact:true}).isEnabled(),true);await sale.getByLabel('수량',{exact:true}).fill('1');await sale.getByRole('button',{name:'매도 주문 접수',exact:true}).click();await sale.getByRole('heading',{name:/^주식 체결 중/}).waitFor();assert.equal(await sale.evaluate(()=>window.qa.account.positions[0].reservedSellQuantity),1);assert.equal(await sale.getByRole('button',{name:'매도 주문 접수',exact:true}).isEnabled(),true);await sale.evaluate(()=>window.qa.fill());await sale.waitForFunction(()=>window.qa.account.positions[0].quantity===1);await sale.getByLabel('수량',{exact:true}).fill('2');assert.equal(await sale.getByRole('button',{name:'매도 주문 접수',exact:true}).isDisabled(),true);assert.equal(await calls(sale,'placeStudentWisStockOrder'),2);assert.equal(await sale.evaluate(()=>window.qa.account.stockCash),4897);await sale.close();
 checks.push('Buy fill enables selling owned shares; pending sell reserves only its quantity, completed sell credits proceeds, and overselling stays blocked with no command sent.');
 const sessionPage = await open();
 await deposit(sessionPage);
 await sessionPage.getByRole('button',{name:'주식 시장',exact:true}).click();
 await chooseStock(sessionPage);
 await sessionPage.getByLabel('수량',{exact:true}).fill('3');
 // A separate refresh of the same student's session must preserve the order form.
 await sessionPage.evaluate(() => {
   const qa = window.qa;
   qa.epoch++;
   qa.generation++;
   qa.replaceUser(qa.user);
   qa.render();
   qa.holdOrder = true;
 });
 await sessionPage.getByRole('button',{name:'매수 주문 접수',exact:true}).click();
 await sessionPage.waitForFunction(() => typeof window.qa.releaseOrder === 'function');
 assert.equal(await sessionPage.getByLabel('수량',{exact:true}).inputValue(),'3');
 assert.equal(await sessionPage.getByRole('heading',{name:'청동네트웍스',exact:true}).isVisible(),true);
 await sessionPage.evaluate(() => window.qa.releaseOrder());
 await sessionPage.getByRole('heading',{name:/^주식 체결 중/}).waitFor();
 assert.equal(await sessionPage.getByLabel('수량',{exact:true}).inputValue(),'3');
 assert.equal(await calls(sessionPage,'placeStudentWisStockOrder'),1);
 assert.equal(await sessionPage.evaluate(() => window.qa.calls.find(c => c.name === 'placeStudentWisStockOrder').fields.quantity),3);
 assert.deepEqual(await sessionPage.evaluate(() => [window.qa.appChecks,window.qa.stepUps,window.qa.epoch]),[2,0,1002]);
 assert.equal(await sessionPage.getByRole('alert').count(),0);
 await sessionPage.close();
 checks.push('A deposit and buy each prepare App Check once with zero Google prompts. A separate same-student session refresh preserves the selected stock and quantity.');
 const persisted=await open(390,'?pending',true);await persisted.getByRole('heading',{name:/^주식 체결 중/}).waitFor();assert.equal(await persisted.locator('.student-wispi-list-pending').isVisible(),true);await persisted.screenshot({path:path.join(evidence,'pending-list-390.png'),fullPage:false});await chooseStock(persisted);assert.equal(await persisted.getByRole('heading',{name:/^주식 체결 중/}).count(),1);await persisted.getByRole('button',{name:'종목 목록',exact:true}).click();await persisted.getByRole('heading',{name:/^주식 체결 중/}).waitFor();await persisted.reload();await persisted.getByRole('heading',{name:/^주식 체결 중/}).waitFor();assert.equal(await calls(persisted,'getStudentWisStockState'),1);assert.equal(await calls(persisted,'placeStudentWisStockOrder'),0);await persisted.close();
 checks.push('Server pending orders remain visible on the mobile list, return from detail and reload without resubmission; only one pending section is accessible in either layout.');
 const emptyFilter=await open(390,'?catalog',true);await emptyFilter.getByRole('button',{name:'상승',exact:true}).click();await chooseStock(emptyFilter,'합성 기업 4');await emptyFilter.getByLabel('수량',{exact:true}).fill('7');await emptyFilter.evaluate(()=>{const q=window.qa,stock=q.market.stocks.find(s=>s.settings.name==='합성 기업 4');stock.price=1;stock.history[stock.history.length-1].price=1;q.market.revision++;q.emit('/market')});await emptyFilter.locator('.student-wispi-price p').filter({hasText:/^1 위스$/}).waitFor();assert.equal(await emptyFilter.getByRole('heading',{name:'합성 기업 4',exact:true}).isVisible(),true);assert.equal(await emptyFilter.getByLabel('수량',{exact:true}).inputValue(),'7');await emptyFilter.evaluate(()=>{const q=window.qa;for(const stock of q.market.stocks){stock.price=1;stock.history[stock.history.length-1].price=1;}q.market.revision++;q.emit('/market')});await emptyFilter.getByRole('button',{name:'종목 목록',exact:true}).click();await emptyFilter.locator('.student-wispi-instruments').waitFor();assert.equal(await emptyFilter.locator('.student-wispi-instruments li button').count(),0);await emptyFilter.getByRole('button',{name:'전체',exact:true}).first().click();assert.equal(await emptyFilter.locator('.student-wispi-instruments li button').count(),23);assert.equal(await calls(emptyFilter,'getStudentWisStockState'),1);await emptyFilter.close();
 checks.push('A realtime price move emptying the active filter preserves the selected order instrument and quantity; back returns to the recoverable empty list with no extra account request.');
 for(const width of [390,1280]){const removed=await open(width,'?catalog',true);await chooseStock(removed,'합성 기업 4');await removed.getByLabel('수량',{exact:true}).fill('7');await removed.evaluate(()=>{const q=window.qa;q.market.stocks=q.market.stocks.filter(stock=>stock.settings.name!=='합성 기업 4');q.market.revision++;q.emit('/market')});await removed.getByRole('status').filter({hasText:'선택한 종목을 더 이상 거래할 수 없습니다'}).waitFor();assert.equal(await removed.locator('.student-wispi-order').count(),0);assert.equal(await removed.locator('.student-wispi-instruments').isVisible(),true);assert.equal(await removed.locator('.student-wispi-instruments li button').count(),22);assert.equal(await calls(removed,'getStudentWisStockState'),1);assert.equal(await calls(removed,'placeStudentWisStockOrder'),0);await layout(removed,width);await removed.screenshot({path:path.join(evidence,'removed-stock-'+width+'.png'),fullPage:false});await chooseStock(removed);assert.equal(await removed.getByLabel('수량',{exact:true}).inputValue(),'1');await removed.close();}
 checks.push('390/1280px: removing the selected instrument clears the order form instead of substituting another stock; explicit reselection restores the form with its lot size and no unsolicited command or account read.');
 const trade=await open();await deposit(trade);await trade.getByRole('button',{name:'주식 시장',exact:true}).click();await trade.getByLabel('수량',{exact:true}).fill('2');await trade.getByRole('button',{name:'매수 주문 접수',exact:true}).click();await trade.getByRole('button',{name:'청동네트웍스 매수 주문 취소',exact:true}).waitFor();const reads=await calls(trade,'getStudentWisStockState');await trade.clock.fastForward(61000);assert.equal(await calls(trade,'getStudentWisStockState'),reads,'Countdown must not poll');assert.equal(await trade.evaluate(()=>window.qa.account.stockCash),5000);assert((await trade.locator('body').innerText()).includes('체결 확인 중'));await trade.evaluate(()=>window.qa.fill());await trade.getByText('체결 완료',{exact:true}).waitFor();assert.equal(await calls(trade,'getStudentWisStockState'),reads+1);assert.equal(await trade.evaluate(()=>window.qa.account.stockCash),4798);await trade.close();checks.push('Accepted price/reservation stays fixed; 61s countdown does not settle or poll. Only a server account revision refresh displays the fill.');
 const cancel=await open();await deposit(cancel);await cancel.getByRole('button',{name:'주식 시장',exact:true}).click();await cancel.getByRole('button',{name:'매수 주문 접수',exact:true}).click();await cancel.getByRole('button',{name:'청동네트웍스 매수 주문 취소',exact:true}).click();await cancel.waitForFunction(()=>window.qa.account.pendingOrders.length===0);assert.equal(await cancel.evaluate(()=>window.qa.account.reservedCash),0);assert.equal(await calls(cancel,'cancelStudentWisStockOrder'),1);await cancel.close();checks.push('Cancel calls the server once and releases only the confirmed reservation.');
 await verifyWalletHistory();
 const closed=await open();await closed.evaluate(()=>window.qa.setHalted(true));await closed.getByText('위스피의 거래가 중지되었습니다.',{exact:true}).waitFor();assert.equal(await closed.locator('.student-wispi-content').evaluate(el=>el.inert),true);assert.equal(await closed.locator('.student-wispi-content').evaluate(el=>getComputedStyle(el).filter),'blur(5px)');assert((await closed.locator('[data-qa-menu]').innerText()).includes('위스피'));assert.equal(await closed.getByRole('link',{name:'위스피(WsPI)',exact:true}).count(),0,'The page does not duplicate the primary Wis menu');await closed.screenshot({path:path.join(evidence,'closed-390.png'),fullPage:false});await closed.evaluate(()=>{window.qa.screen='account';window.qa.render()});await closed.getByLabel('위스 금액',{exact:true}).waitFor();assert.equal(await closed.getByLabel('위스 금액',{exact:true}).isDisabled(),true);await closed.evaluate(()=>window.qa.setHiddenMenu(true));await closed.waitForFunction(()=>window.qa.routeAllowed===false);await walletFilter(closed, '거래 내역').click();await waitForRows(closed, 20);assert.equal(await closed.locator('[data-qa-menu]').innerText(),'');assert.equal((await closed.evaluate(()=>window.qa.activePaths())).some(p=>p.includes('wis_stock_public')),false);assert.equal((await closed.evaluate(()=>window.qa.activePaths())).filter(p=>p.includes('wis_stock_accounts')).length,1);await closed.close();checks.push('Close keeps menu and blurs/inerts the market with exact stop text; settings hide blocks direct route/public subscriptions while My Page account/history remains readable and transfers disabled.');
 const refresh=await open();await account(refresh);await refresh.evaluate(()=>window.qa.mainCash=12000);await refresh.getByRole('button',{name:'주식 지갑 새로고침'}).click();await refresh.locator('.student-wispi-balances [aria-live="polite"] dd').filter({hasText:'6,000 위스'}).waitFor();assert.equal(await calls(refresh,'getStudentWisStockState'),2);await refresh.evaluate(()=>{window.qa.mainCash=14000;window.dispatchEvent(new CustomEvent('westory:points-updated'))});await refresh.locator('.student-wispi-balances [aria-live="polite"] dd').filter({hasText:'7,000 위스'}).waitFor();assert.equal(await calls(refresh,'getStudentWisStockState'),3);await refresh.close();checks.push('Explicit balance refresh and existing points-updated event refresh one scoped state, including general balance and 50% funding limit.');
 const paused=await open();await paused.evaluate(()=>{window.qa.holdRead=true;window.qa.account.revision++;window.qa.notifyAccount()});await paused.waitForFunction(()=>typeof window.qa.releaseRead==='function');await paused.evaluate(()=>window.qa.changeVisibility(true));await paused.waitForFunction(()=>window.qa.activePaths().length===0);await paused.evaluate(()=>window.qa.releaseRead());assert.equal(await paused.locator('.student-wispi-market').count(),0);await paused.evaluate(()=>window.qa.changeVisibility(false));await paused.getByRole('heading',{name:'청동네트웍스',exact:true}).waitFor();await paused.waitForFunction(()=>window.qa.activePaths().length===4);await paused.evaluate(()=>window.qa.setOffline(true));await paused.waitForFunction(()=>window.qa.activePaths().length===0);await paused.evaluate(()=>window.qa.setOffline(false));await paused.getByRole('heading',{name:'청동네트웍스',exact:true}).waitFor();await paused.close();checks.push('Hidden/offline releases all four SDK watches; late in-flight account response cannot restore data; visible/online revalidates shared session and reconnects.');
 const session=await open();await session.evaluate(()=>{window.qa.sessionClosed=true;window.qa.emit('application_sessions/')});await session.getByRole('alert').first().waitFor();assert.equal(await session.locator('.student-wispi-market').count(),0);await session.waitForFunction(()=>window.qa.activePaths().length===0);await session.close();const expire=await open();await expire.evaluate(()=>{window.qa.sessionMode='ENFORCE';window.qa.expires=Date.now()+1000;window.qa.emit('application_sessions/')});await expire.clock.fastForward(1001);await expire.getByRole('alert').first().waitFor();assert.equal(await expire.locator('.student-wispi-market').count(),0);await expire.close();checks.push('OBSERVE_ONLY accepts expired idle deadline; closed session and ENFORCE natural deadline erase private data and subscriptions.');
 const cache=await open();const beforeCacheSubscriptions=await cache.evaluate(()=>window.qa.subscriptions.length);await cache.evaluate(()=>window.qa.emit('/market',{fromCache:true}));assert.equal(await cache.locator('.student-wispi-market').count(),0);await cache.clock.fastForward(1000);await cache.locator('.student-wispi-read-status .ws-loading-surface').waitFor();await cache.screenshot({path:path.join(evidence,'market-loading-390.png')});await cache.clock.fastForward(14001);await cache.getByText('주식 시세 연결을 다시 확인해 주세요.',{exact:true}).waitFor();await cache.evaluate(()=>window.qa.emit('/market'));await cache.locator('.student-wispi-market').waitFor();assert.equal(await cache.evaluate(()=>window.qa.subscriptions.length),beforeCacheSubscriptions);await cache.close();checks.push('Cache-only feed clears tradable content, shows shared loading after 800ms and a bounded 15s reconnect prompt; the same server stream restores the market without additional subscriptions or polling.');
 const unopened=await open(390,'?preopen');assert.equal(await calls(unopened,'getStudentWisStockState'),0);assert.equal(await unopened.getByRole('link',{name:'위스피(WsPI)',exact:true}).count(),0);assert.equal((await unopened.evaluate(()=>window.qa.activePaths())).length,2);await unopened.evaluate(()=>{window.qa.status.studentOpen=true;window.qa.emit('/current')});await chooseStock(unopened);await unopened.waitForFunction(()=>window.qa.activePaths().length===4);assert.equal(await calls(unopened,'getStudentWisStockState'),1);await unopened.close();checks.push('Before first launch: no student menu, market feed or own-account query; first publication opens them with one state read.');
 const boundary=await open();await boundary.evaluate(()=>{window.qa.holdRead=true;window.qa.account.revision++;window.qa.notifyAccount()});await boundary.waitForFunction(()=>typeof window.qa.releaseRead==='function');await boundary.evaluate(()=>{const q=window.qa;q.user={uid:'student-b',getIdTokenResult:async()=>({claims:{auth_time:q.epoch}})};q.epoch++;q.generation++;q.config={...q.config,semester:'1'};q.status={...q.status,semesterId:'2026-1'};q.market={...q.market,semesterId:'2026-1'};q.account={...q.account,revision:2,stockCash:777,accountId:q.accountId()};q.replaceUser(q.user);q.render();q.releaseRead()});await boundary.getByText('사용 가능 777 위스',{exact:true}).waitFor({state:'attached'});await chooseStock(boundary);await boundary.getByText('사용 가능 777 위스',{exact:true}).waitFor();assert.equal(await boundary.getByRole('alert').count(),0);const newPaths=await boundary.evaluate(()=>window.qa.activePaths());assert(newPaths.every(p=>p.includes('/semesters/1/')||p.includes('/student-b/sessions/')),JSON.stringify(newPaths));await boundary.close();checks.push('A held previous-user account response is ignored after UID/auth_time and semester change; only the new user/scope subscriptions and balance remain.');
 const profit=await open();await deposit(profit);await profit.evaluate(()=>{window.qa.account.stockCash=6000;window.qa.account.revision++;window.qa.notifyAccount()});await profit.getByRole('button',{name:'출금',exact:true}).click();await profit.getByLabel('위스 금액',{exact:true}).fill('5000');await profit.getByRole('button',{name:'일반 위스로 출금',exact:true}).click();await profit.getByText('5,000 위스를 출금했습니다.',{exact:true}).waitFor();await profit.getByLabel('위스 금액',{exact:true}).fill('1000');await profit.getByRole('button',{name:'일반 위스로 출금',exact:true}).click();await profit.getByText('1,000 위스를 출금했습니다. 누적 위스에 수익 1,000 위스가 반영되었습니다.',{exact:true}).waitFor();assert.equal(await profit.evaluate(()=>window.qa.mainCash),11000);assert.equal(await profit.evaluate(()=>window.qa.account.stockCash),0);await profit.close();checks.push('Withdrawal feedback distinguishes returned principal from withdrawn profit, using the server receipt only.');
 }
 }
 }
 assert.deepEqual(errors,[]);await fs.writeFile(path.join(evidence,'summary.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({evidence,checks},null,2));
}catch(error){for(const [index,page] of browser.contexts().flatMap(c=>c.pages()).entries()){await page.screenshot({path:path.join(evidence,'failure-'+index+'.png'),fullPage:false}).catch(()=>{});await fs.writeFile(path.join(evidence,'failure-'+index+'.html'),await page.content()).catch(()=>{});}await fs.writeFile(path.join(evidence,'failure.json'),JSON.stringify({error:String(error),stack:error.stack,checks,errors},null,2));throw error;}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
