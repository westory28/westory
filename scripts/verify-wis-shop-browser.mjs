/**
 * Serves the actual shop components with disposable, synthetic state only.
 * This is a visual/interaction fixture, not a replacement for server tests.
 * Open the printed URL with CUA; no browser automation or credentials are used.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const tailwindPath =
  process.env.WIS_SHOP_QA_TAILWIND ||
  path.join(os.tmpdir(), "westory-assessment-qa-tailwind.js");
const tailwind = await fs.readFile(tailwindPath, "utf8");

const entry = String.raw`
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import StudentPointShopTab from './src/pages/student/components/points/StudentPointShopTab';
import StudentPointOrdersTab from './src/pages/student/components/points/StudentPointOrdersTab';
import PointProductsTab from './src/pages/teacher/components/points/PointProductsTab';
import PointRequestsTab from './src/pages/teacher/components/points/PointRequestsTab';
import {AppDialogProvider,useAppDialog} from './src/components/common/AppDialogProvider';
import {optimizeProductImage, PRODUCT_IMAGE_LIMITS} from './src/lib/pointProductImages';
import './src/assets/index.css';

const params=new URLSearchParams(location.search);
const scenario=params.get('scenario')||'normal';
const readOnly=scenario==='readonly'||scenario==='archive';
const at=(hours=0)=>({seconds:1792281600+hours*3600});
const image=(label,color)=>'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="960" viewBox="0 0 960 960"><rect width="960" height="960" fill="'+color+'"/><rect x="250" y="220" width="460" height="520" rx="32" fill="white" stroke="#cbd5e1" stroke-width="3"/><path d="M310 330H650M310 410H650M310 490H570" stroke="#cbd5e1" stroke-width="12"/><text x="480" y="620" text-anchor="middle" font-family="sans-serif" font-size="40" fill="#1f2937">'+label+'</text></svg>');
const initialProducts=[
 {id:'notebook',name:'매일 쓰는 노트',description:'가볍게 펼쳐 쓰는 무선 노트.\n수업에서 떠오른 생각과 질문을 기록해 보세요.',price:120,stock:8,isActive:true,sortOrder:0,imageUrl:image('NOTE','#eff6ff'),previewImageUrl:image('NOTE','#eff6ff')},
 {id:'pencil',name:'부드럽게 써지는 연필과 지우개 선물 세트 — 아주 긴 상품 이름 줄바꿈 확인',description:'연필 3자루와 지우개가 함께 들어 있어요.',price:180,stock:2,isActive:true,sortOrder:1,imageUrl:image('PENCIL','#f0fdf4'),previewImageUrl:image('PENCIL','#f0fdf4')},
 {id:'sold-out',name:'우유 한 팩',description:'재고가 없는 상품의 상태와 구매 제한을 확인합니다.',price:250,stock:0,isActive:true,sortOrder:2,imageUrl:image('MILK','#f8fafc')},
 {id:'expensive',name:'문구 꾸러미',description:'잔액이 부족할 때의 구매 제한을 확인합니다.',price:3000,stock:1,isActive:true,sortOrder:3,imageUrl:image('GIFT','#fff7ed')},
 {id:'no-image',name:'새로운 자리 선택권',description:'',price:80,stock:12,isActive:true,sortOrder:4,imageUrl:''},
 {id:'hidden',name:'준비 중인 비공개 상품',description:'교사에게만 보이는 상품입니다.',price:400,stock:6,isActive:false,sortOrder:5,imageUrl:image('READY','#f3f4f6')},
].map(p=>({...p,readOnly,availableStock:p.stock,reservedStock:p.id==='notebook'?2:p.id==='pencil'?1:0,soldStock:p.id==='notebook'?3:p.id==='pencil'?1:0,stock:p.stock+(p.id==='notebook'?5:p.id==='pencil'?2:0)}));
const statuses=['requested','approved','ready','fulfilled','rejected','cancelled'];
const initialOrders=statuses.map((status,i)=>({id:'order-'+status,uid:'synthetic-student',studentName:'가상학생',grade:'3',class:'1',number:'7',productId:i%2?'pencil':'notebook',productName:i%2?initialProducts[1].name:initialProducts[0].name,quantity:1,unitPrice:i%2?180:120,priceSnapshot:i%2?180:120,status,stockDeducted:true,requestedAt:at(-i),reviewedAt:i?at(1):null,approvedAt:['approved','ready','fulfilled'].includes(status)?at(1):null,reviewedBy:i?'synthetic-teacher':'',memo:i===1?'파란색으로 받을 수 있으면 좋겠어요.':'',studentMemo:i===1?'파란색으로 받을 수 있으면 좋겠어요.':'',reviewReason:i===2?'점심시간에 교무실에서 받아 가세요.':'',fulfilledAt:status==='fulfilled'?at(3):null,readyAt:['ready','fulfilled'].includes(status)?at(2):null,cancelledAt:status==='cancelled'?at(2):null}));
const emptyForm=()=>({id:'',name:'',description:'',price:'100',stock:'0',imageUrl:'',previewImageUrl:'',imageStoragePath:'',previewStoragePath:'',sortOrder:'0',isActive:true});
const activity=[];
window.wisShopFixture={productionServices:false,activity};
function ImageQualityProbe(){
 const [result,setResult]=useState(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const run=async()=>{
  setBusy(true);setError('');
  try{
   const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=1536;const context=canvas.getContext('2d');
   const pixels=context.createImageData(canvas.width,canvas.height);let seed=20261018;
   for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=(seed>>>24)*.22;const offset=(y*canvas.width+x)*4;
    pixels.data[offset]=50+150*x/canvas.width+noise;pixels.data[offset+1]=40+170*y/canvas.height+noise;pixels.data[offset+2]=75+65*Math.sin(x/37)+noise;pixels.data[offset+3]=255;
   }
   context.putImageData(pixels,0,0);context.fillStyle='white';context.fillRect(360,380,1328,680);context.fillStyle='#1e3a8a';context.font='bold 100px sans-serif';context.fillText('WESTORY 2026',480,700);context.font='48px sans-serif';context.fillText('선명도 · 가는 선 · 작은 글자 0123456789',470,820);
   for(let i=0;i<80;i++){context.fillStyle=i%2?'#1f2937':'white';context.fillRect(480+i*12,900,6,80);}
   const original=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const file=new File([original],'synthetic-photo.png',{type:'image/png'});
   const measure=async(blob)=>{const url=URL.createObjectURL(blob);const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url});return {width:img.naturalWidth,height:img.naturalHeight,bytes:blob.size,type:blob.type,url}};
   const detail=await measure(await optimizeProductImage(file,'detail'));const preview=await measure(await optimizeProductImage(file,'preview'));
   canvas.width=160;canvas.height=120;context.fillStyle='#2563eb';context.fillRect(0,0,160,120);const smallBlob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
   const small=await measure(await optimizeProductImage(new File([smallBlob],'small.png',{type:'image/png'}),'detail'));
   let invalidRejected=false;try{await optimizeProductImage(new File(['text'],'text.txt',{type:'text/plain'}),'detail')}catch{invalidRejected=true}
   const value={input:{width:2048,height:1536,bytes:file.size,type:file.type},detail,preview,small,invalidRejected,passed:detail.bytes<=PRODUCT_IMAGE_LIMITS.detail.maxBytes&&Math.max(detail.width,detail.height)<=1200&&preview.bytes<=PRODUCT_IMAGE_LIMITS.preview.maxBytes&&Math.max(preview.width,preview.height)<=640&&small.width===160&&small.height===120&&invalidRejected};
   setResult(value);window.wisShopFixture.imageResult=value;
  }catch(cause){setError(String(cause))}finally{setBusy(false)}
 };
 return <section><h1 className="text-xl font-bold mb-4">상품 이미지 최적화 검증</h1><button type="button" className="rounded-lg bg-blue-600 px-5 py-3 text-white" disabled={busy} onClick={run}>{busy?'이미지 변환 중…':'실제 이미지 최적화 실행'}</button>{error&&<p role="alert">{error}</p>}{result&&<><p role="status" className="my-4 font-bold">{result.passed?'PASS':'FAIL'} · 원본 {result.input.width}×{result.input.height} / {result.input.bytes.toLocaleString()} bytes</p><dl>{['detail','preview','small'].map(key=><div key={key}><dt>{key}</dt><dd>{result[key].width}×{result[key].height} · {result[key].bytes.toLocaleString()} bytes · {result[key].type}</dd></div>)}</dl><p>이미지가 아닌 파일 거절: {String(result.invalidRejected)}</p><div className="grid gap-4 md:grid-cols-2 mt-4">{['detail','preview'].map(key=><figure key={key}><img src={result[key].url} alt={key+' 최적화 결과'} className="w-full"/><figcaption>{key}</figcaption></figure>)}</div></>}</section>;
}
function App(){
 const {confirm}=useAppDialog();
 const [view,setView]=useState(params.get('view')||'student-shop');
 const [products,setProducts]=useState(scenario==='empty'?[]:initialProducts);
 const [orders,setOrders]=useState(scenario==='empty'?[]:initialOrders.map(order=>({...order,readOnly})));
 const [balance,setBalance]=useState(950);
 const [selectedProductId,setSelectedProductId]=useState('');
 const [memo,setMemo]=useState('');
 const [purchaseQuantity,setPurchaseQuantity]=useState(1);
 const [purchaseFeedback,setPurchaseFeedback]=useState('');
 const [purchaseSubmitting,setPurchaseSubmitting]=useState(false);
 const [orderFilter,setOrderFilter]=useState('all');
 const [selectedOrderId,setSelectedOrderId]=useState('');
 const [orderMemo,setOrderMemo]=useState('');
 const [orderFeedback,setOrderFeedback]=useState('');
 const [savingOrderId,setSavingOrderId]=useState('');
 const [savingStatus,setSavingStatus]=useState(null);
 const [productForm,setProductForm]=useState(emptyForm);
 const [productFeedback,setProductFeedback]=useState('');
 const [productImagePreviewUrl,setProductImagePreviewUrl]=useState('');
 const [productSaving,setProductSaving]=useState(false);
 const [errorCount,setErrorCount]=useState(0);
 const selectedProduct=products.find(p=>p.id===selectedProductId)||null;
 const selectedOrder=orders.find(o=>o.id===selectedOrderId)||null;
 const filteredOrders=orders.filter(o=>orderFilter==='all'||o.status===orderFilter);
 const wallet={uid:'synthetic-student',studentName:'가상학생',grade:'3',class:'1',number:'7',balance,earnedTotal:1900,spentTotal:950,adjustedTotal:0};
 const record=(action,detail)=>activity.push({action,detail});
 const delay=()=>new Promise(resolve=>setTimeout(resolve,scenario==='loading'?6000:650));
 const failOnce=()=>{if(scenario==='error'&&errorCount===0){setErrorCount(1);return true}return false};
 const selectProduct=id=>{setSelectedProductId(id);setMemo('');setPurchaseQuantity(1);setPurchaseFeedback('')};
 const submitPurchase=async()=>{
  if(readOnly||purchaseSubmitting||!selectedProduct)return;
  setPurchaseSubmitting(true);await delay();
  if(failOnce()){setPurchaseFeedback('주문을 저장하지 못했습니다. 입력한 메모를 확인하고 다시 시도해 주세요.');setPurchaseSubmitting(false);return;}
  record('purchase',{productId:selectedProduct.id,quantity:purchaseQuantity});
  setBalance(v=>v-selectedProduct.price*purchaseQuantity);
  setProducts(list=>list.map(p=>p.id===selectedProduct.id?{...p,availableStock:p.availableStock-purchaseQuantity,reservedStock:p.reservedStock+purchaseQuantity}:p));
  setOrders(list=>[{...initialOrders[0],id:'order-new-'+(list.length+1),productId:selectedProduct.id,productName:selectedProduct.name,quantity:purchaseQuantity,unitPrice:selectedProduct.price,priceSnapshot:selectedProduct.price*purchaseQuantity,memo,studentMemo:memo,requestedAt:at(3)},...list]);
  setSelectedProductId('');setPurchaseFeedback('주문이 접수되었습니다.');setPurchaseSubmitting(false);
 };
 const cancelOrder=async(orderOrId)=>{
  const id=typeof orderOrId==='string'?orderOrId:orderOrId.id;const order=orders.find(o=>o.id===id);
  if(readOnly||!order||savingOrderId)return;
  if(!await confirm({title:'주문을 취소할까요?',message:order.productName+' 주문을 취소하면 '+order.priceSnapshot.toLocaleString()+' 위스를 돌려받습니다.',confirmLabel:'취소하고 환불받기',tone:'warning'}))return;
  setSavingOrderId(id);setOrderFeedback('');await delay();
  if(failOnce()){setOrderFeedback('주문을 취소하지 못했습니다. 다시 시도해 주세요.');setSavingOrderId('');return;}
  record('cancel',id);
  setOrders(list=>list.map(o=>o.id===id?{...o,status:'cancelled'}:o));
  setBalance(v=>v+order.priceSnapshot);setProducts(list=>list.map(p=>p.id===order.productId?{...p,availableStock:p.availableStock+order.quantity,reservedStock:Math.max(0,p.reservedStock-order.quantity)}:p));setOrderFeedback('주문을 취소하고 위스를 돌려받았습니다.');setSavingOrderId('');
 };
 const saveOrder=async(status)=>{
  if(readOnly||!selectedOrder||savingOrderId)return;
  setSavingOrderId(selectedOrder.id);setSavingStatus(status);setOrderFeedback('');await delay();
  if(failOnce()){setOrderFeedback('처리하지 못했습니다. 입력한 메모를 확인하고 다시 시도해 주세요.');setSavingOrderId('');setSavingStatus(null);return;}
  if(status==='cancelled'||status==='rejected'){setBalance(v=>v+selectedOrder.priceSnapshot);setProducts(list=>list.map(p=>p.id===selectedOrder.productId?{...p,availableStock:p.availableStock+selectedOrder.quantity,reservedStock:Math.max(0,p.reservedStock-selectedOrder.quantity)}:p));}
  if(status==='fulfilled')setProducts(list=>list.map(p=>p.id===selectedOrder.productId?{...p,reservedStock:Math.max(0,p.reservedStock-selectedOrder.quantity),soldStock:p.soldStock+selectedOrder.quantity}:p));
  record('status',{id:selectedOrder.id,status});setOrders(list=>list.map(o=>o.id===selectedOrder.id?{...o,status,reviewReason:orderMemo,reviewedAt:at(4),[status==='approved'?'approvedAt':status==='ready'?'readyAt':status==='fulfilled'?'fulfilledAt':'cancelledAt']:at(4)}:o));setOrderFeedback('주문 처리가 저장되었습니다.');setSavingOrderId('');setSavingStatus(null);
 };
 const editProduct=p=>{setProductForm({...emptyForm(),...p,price:String(p.price),stock:String(p.stock),sortOrder:String(p.sortOrder)});setProductImagePreviewUrl(p.previewImageUrl||p.imageUrl);setProductFeedback('')};
 const saveProduct=async(event)=>{
  event.preventDefault();if(readOnly||productSaving)return;setProductSaving(true);setProductFeedback('');await delay();
  if(failOnce()){setProductFeedback('저장하지 못했습니다. 입력한 내용을 확인하고 다시 시도해 주세요.');setProductSaving(false);return;}
  const item={...productForm,id:productForm.id||'product-new-'+products.length,price:Number(productForm.price),stock:Number(productForm.stock),reservedStock:Number(productForm.reservedStock||0),soldStock:Number(productForm.soldStock||0),availableStock:Number(productForm.stock)-Number(productForm.reservedStock||0)-Number(productForm.soldStock||0),sortOrder:Number(productForm.sortOrder),imageUrl:productImagePreviewUrl||productForm.imageUrl,previewImageUrl:productImagePreviewUrl||productForm.previewImageUrl};
  record('product-save',item.id);setProducts(list=>list.some(p=>p.id===item.id)?list.map(p=>p.id===item.id?item:p):[...list,item]);setProductFeedback('상품이 저장되었습니다.');setProductForm(emptyForm());setProductImagePreviewUrl('');setProductSaving(false);
 };
 const changeView=value=>{setView(value);setSelectedProductId('');setOrderFilter('all');setSelectedOrderId('');setOrderFeedback('')};
 return <>
  <nav className="fixture-toolbar" aria-label="합성 검증 화면 선택">{[['student-shop','학생 상점'],['student-orders','학생 주문'],['teacher-products','교사 상품'],['teacher-orders','교사 주문'],['image-quality','이미지 검증']].map(([key,label])=><button key={key} type="button" aria-pressed={view===key} onClick={()=>changeView(key)}>{label}</button>)}<span>합성 데이터 · {scenario}{readOnly?' · 읽기 전용':''}</span></nav>
  <main className={view.startsWith('teacher')?'fixture-main teacher-layout':'fixture-main student-layout'}>
   {scenario==='archive'&&<div className="fixture-archive" role="status">2025학년도 2학기 · 이전 학기 조회</div>}
   {view==='image-quality'&&<ImageQualityProbe/>}
   {view==='student-shop'&&<StudentPointShopTab wallet={wallet} products={products.filter(p=>p.isActive)} selectedProduct={selectedProduct} purchaseMemo={memo} purchaseSubmitting={purchaseSubmitting} purchaseFeedback={purchaseFeedback} purchaseQuantity={purchaseQuantity} onPurchaseQuantityChange={setPurchaseQuantity} onSelectProduct={selectProduct} onPurchaseMemoChange={setMemo} onCloseRequest={()=>!purchaseSubmitting&&setSelectedProductId('')} onSubmitPurchaseRequest={submitPurchase} onOpenOrders={()=>changeView('student-orders')}/>}
   {view==='student-orders'&&<StudentPointOrdersTab orders={filteredOrders} orderFilter={orderFilter} onOrderFilterChange={setOrderFilter} onCancelOrder={readOnly?undefined:cancelOrder} cancellingOrderId={savingOrderId} feedback={orderFeedback} onOpenShop={()=>changeView('student-shop')}/>}
   {view==='teacher-products'&&<PointProductsTab products={products} productForm={productForm} productFeedback={productFeedback} canManage={!readOnly} readOnly={readOnly} productImagePreviewUrl={productImagePreviewUrl} productImageUploading={productSaving} productSaving={productSaving} productOrderDirty={false} productOrderSaving={false} productOrderFeedback="" onProductFormChange={setProductForm} onProductImageChange={file=>{if(file){setProductImagePreviewUrl(URL.createObjectURL(file));record('local-image',file.name)}}} onEditProduct={editProduct} onResetForm={()=>{setProductForm(emptyForm());setProductImagePreviewUrl('');setProductFeedback('')}} onToggleProduct={p=>{record('toggle',p.id);setProducts(list=>list.map(item=>item.id===p.id?{...item,isActive:!item.isActive}:item))}} onDeleteProduct={p=>{record('delete',p.id);setProducts(list=>list.filter(item=>item.id!==p.id))}} onReorderProducts={()=>{}} onSaveProductOrder={()=>{}} onSubmit={saveProduct}/>}
   {view==='teacher-orders'&&<PointRequestsTab orders={filteredOrders} allOrders={orders} orderFilter={orderFilter} selectedOrderId={selectedOrderId} selectedOrder={selectedOrder} orderMemo={orderMemo} orderFeedback={orderFeedback} orderSavingOrderId={savingOrderId} orderSavingStatus={savingStatus} canManage={!readOnly} onFilterChange={setOrderFilter} onSelectOrder={id=>{setSelectedOrderId(id);setOrderMemo(orders.find(o=>o.id===id)?.reviewReason||'');setOrderFeedback('')}} onOrderMemoChange={setOrderMemo} onSaveOrder={saveOrder}/>}
  </main>
  <details className="fixture-metrics"><summary>합성 검증 기록</summary><p>잔액 {balance} · 주문 {orders.length}건 · 로컬 작업 {activity.length}회</p><pre>{JSON.stringify(activity,null,2)}</pre></details>
 </>;
}
createRoot(document.getElementById('root')).render(<AppDialogProvider><App/></AppDialogProvider>);
`;

async function compileFixture() {
  const bundle = await build({
    stdin: { contents: entry, loader: "tsx", resolveDir: root },
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "browser",
    outfile: path.join(os.tmpdir(), "wis-shop-fixture.js"),
    loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "reject-production-services",
        setup(plugin) {
          plugin.onResolve(
            {
              filter:
                /(?:^|\/)contexts\/AuthContext$|(?:^|\/)lib\/firebase$|^firebase(?:\/|$)/,
            },
            (args) => {
              throw new Error(
                `Shop fixture unexpectedly imports production services: ${args.path}`,
              );
            },
          );
        },
      },
    ],
  });
  if (
    Object.keys(bundle.metafile.inputs).some((name) =>
      /node_modules[\\/](@firebase|firebase)[\\/]/.test(name),
    )
  ) {
    throw new Error("Live Firebase runtime was included in shop fixture");
  }
  return {
    js: bundle.outputFiles.find((file) => file.path.endsWith(".js")).text,
    css: bundle.outputFiles
      .find((file) => file.path.endsWith(".css"))
      .text.replace(/@import\s+url\([^;]+;/g, ""),
  };
}
let compiled = await compileFixture();
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>위스 상점 · 합성 검증</title><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:#f9fafb}#root{width:100%;min-width:0}.fixture-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px;border-bottom:1px solid #e5e7eb;background:white;font-size:12px}.fixture-toolbar button{min-height:44px;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px}.fixture-toolbar button[aria-pressed=true]{background:#eff6ff;color:#1e3a8a}.fixture-main{max-width:1280px;margin:auto;padding:24px!important;min-height:70vh}.fixture-archive{padding:12px 16px;background:#fffbeb;margin-bottom:16px;border:1px solid #fde68a}.fixture-metrics{margin:24px;font-size:12px}.fixture-metrics pre{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:639px){.fixture-main{padding:16px!important}}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    const viewport = Number(url.searchParams.get("viewport"));
    if (
      url.pathname === "/" &&
      [320, 390, 768, 1280, 1440].includes(viewport)
    ) {
      url.searchParams.delete("viewport");
      res.setHeader("Content-Type", "text/html;charset=utf-8");
      res.end(
        `<!doctype html><html lang="ko"><meta charset="utf-8"><title>위스 상점 ${viewport}px 검증</title><body style="margin:0;background:#e5e7eb"><iframe title="위스 상점 ${viewport}px" src="/${url.search}" style="display:block;width:${viewport}px;height:100vh;margin:0 auto;border:0;background:white"></iframe></body></html>`,
      );
      return;
    }
    // Rebuild before HTML so concurrently requested JS/CSS use the same version.
    if (url.pathname === "/") compiled = await compileFixture();
    const files = {
      "/fixture.js": ["text/javascript", compiled.js],
      "/fixture.css": ["text/css", compiled.css],
      "/tailwind.js": ["text/javascript", tailwind],
    };
    const [type, body] = files[url.pathname] || ["text/html", html];
    res.setHeader("Content-Type", `${type};charset=utf-8`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-eval'; font-src 'self' data:; frame-src 'self'",
    );
    res.end(body);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { "Content-Type": "text/plain;charset=utf-8" });
    res.end(String(error));
  }
});
await new Promise((resolve) =>
  server.listen(
    Number(process.env.WIS_SHOP_QA_PORT || 4327),
    "127.0.0.1",
    resolve,
  ),
);
console.log(
  JSON.stringify({
    origin: `http://127.0.0.1:${server.address().port}`,
    views: [
      "student-shop",
      "student-orders",
      "teacher-products",
      "teacher-orders",
      "image-quality",
    ],
    scenarios: ["normal", "empty", "error", "loading", "readonly", "archive"],
    viewportWidths: [320, 390, 768, 1280, 1440],
    example: "/?view=student-shop&scenario=normal&viewport=390",
    productionServices: false,
    notes:
      "State is synthetic and resets on refresh. Server transitions require separate emulator tests. Refresh recompiles current component sources.",
  }),
);
