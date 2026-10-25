/** Local-only image pipeline checks. Open the printed URL with CUA. */
import { build } from "esbuild";
import http from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = String.raw`
import {prepareBrandWatermark, watermarkImageBlob} from './src/lib/brandWatermark';
import {compressNoticeImage} from './src/lib/noticeImages';
import {compressDeveloperLogImage} from './src/lib/developerLogImages';
import {buildSourceArchiveUpload} from './src/lib/sourceArchiveImage';
import {optimizeProductImage} from './src/lib/pointProductImages';
import {cropProductImage} from './src/lib/pointProductCrop';
import {optimizeQuizImageFile,optimizeQuizImageDataUrl,QUIZ_QUESTION_IMAGE_OPTIONS,QUIZ_MATCHING_IMAGE_OPTIONS} from './src/lib/quizImageCompression';

const results=document.getElementById('results');
const summary=document.getElementById('summary');
let cases=[];
let checkedInitialLoad=false;
const fileInput=document.getElementById('image-files');
const compressButton=document.getElementById('compress-files');
const downloads=document.getElementById('downloads');
const compressStatus=document.getElementById('compress-status');
let downloadUrls=[];
fileInput.addEventListener('change',()=>{compressButton.disabled=!fileInput.files?.length;});
compressButton.addEventListener('click',async()=>{
 const files=Array.from(fileInput.files||[]);if(!files.length)return;
 compressButton.disabled=true;fileInput.disabled=true;downloads.replaceChildren();
 downloadUrls.forEach(url=>URL.revokeObjectURL(url));downloadUrls=[];
 checkedInitialLoad=true;
 let succeeded=0;
 for(const file of files){
  compressStatus.textContent=file.name+' 압축 중';
  const section=document.createElement('section');const heading=document.createElement('h3');heading.textContent=file.name;section.append(heading);downloads.append(section);
  try{
   const result=await compressNoticeImage(file);const url=URL.createObjectURL(result.blob);downloadUrls.push(url);
   const name=file.name.replace(/\.[^.]+$/,'')||'notice';
   const extension=result.mimeType==='image/webp'?'webp':result.mimeType==='image/jpeg'?'jpg':'png';
   const filename=name+'.'+extension;
   const exported=await fetch('/export',{method:'POST',headers:{'Content-Type':result.mimeType,'X-File-Name':encodeURIComponent(filename)},body:result.blob});
   if(!exported.ok)throw new Error('로컬 다운로드를 준비하지 못했습니다.');
   const {href}=await exported.json();
   const link=document.createElement('a');link.href=href;link.download=filename;link.textContent=filename+' 다운로드';section.append(link);
   const direct=document.createElement('a');direct.href=url;direct.download=filename;direct.textContent='브라우저 직접 저장';direct.style.marginLeft='16px';section.append(direct);
   const meta=document.createElement('p');meta.textContent=result.width+' × '+result.height+' px · '+result.blob.size.toLocaleString()+' bytes · '+result.mimeType;section.append(meta);
   const image=document.createElement('img');image.src=url;image.alt=file.name+' 워터마크 적용 결과';section.append(image);
   succeeded++;
  }catch(error){const message=document.createElement('p');message.setAttribute('role','alert');message.textContent='압축하지 못했습니다: '+String(error);section.append(message);}
 }
 compressStatus.textContent=succeeded+'/'+files.length+'개 압축 완료';
 compressButton.disabled=false;fileInput.disabled=false;
});
const add=(name,passed,details,blob)=>{
 cases.push({name,passed,details});
 const section=document.createElement('section');
 const heading=document.createElement('h2');heading.textContent=(passed?'PASS':'FAIL')+' · '+name;section.append(heading);
 if(blob){const image=document.createElement('img');image.src=URL.createObjectURL(blob);image.alt=name+' 실제 출력';section.append(image);}
 const pre=document.createElement('pre');pre.textContent=JSON.stringify(details,null,2);section.append(pre);results.append(section);
 summary.textContent=cases.filter(c=>c.passed).length+'/'+cases.length+' 통과';
};
const solid=async(width,height,background='#ffffff')=>{
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');
 if(background){ctx.fillStyle=background;ctx.fillRect(0,0,width,height);}
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
 return new File([blob],'synthetic.png',{type:'image/png'});
};
const decode=async(blob)=>{
 const url=URL.createObjectURL(blob);try{const img=new Image();img.src=url;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return {width:canvas.width,height:canvas.height,pixels:ctx.getImageData(0,0,canvas.width,canvas.height).data};}finally{URL.revokeObjectURL(url);}
};
const inspect=async(blob)=>{
 const {width,height,pixels}=await decode(blob);let blue=0,orange=0,blueX=0,orangeX=0;let left=width,top=height,right=-1,bottom=-1;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4;const [r,g,b,a]=pixels.slice(i,i+4);if(a<64)continue;
  const isBlue=b-r>60&&b-g>30&&b>100&&r<150&&g<180;const isOrange=r-g>25&&g-b>35&&r>140&&b<140;
  if(isBlue){blue++;blueX+=x;}if(isOrange){orange++;orangeX+=x;}
  if(isBlue||isOrange){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
 }
 const edge=Math.min(width,height);
 const located=left>=width-edge*.30-3&&top>=height-edge*.17-3&&right<width-edge*.015&&bottom<height-edge*.015;
 return {width,height,bytes:blob.size,mime:blob.type,blue,orange,blueBeforeOrange:blue>0&&orange>0&&blueX/blue<orangeX/orange,bounds:{left,top,right,bottom},located,mark:blue>3&&orange>3&&located};
};
const same=async(a,b)=>{const x=new Uint8Array(await a.arrayBuffer()),y=new Uint8Array(await b.arrayBuffer());return x.length===y.length&&x.every((v,i)=>v===y[i]);};
document.getElementById('run').addEventListener('click',async(event)=>{
 event.target.disabled=true;results.replaceChildren();cases=[];summary.textContent='검증 중';
 try{
  let checkRecovery=false;
  if(!checkedInitialLoad){
   const NativeImage=window.Image;
   window.Image=class extends NativeImage{set src(value){queueMicrotask(()=>this.onerror?.(new Event('error')));}};
   try{const failures=await Promise.allSettled([prepareBrandWatermark(),prepareBrandWatermark()]);add('로고 로드 실패 시 동시 업로드 모두 중단',failures.every(result=>result.status==='rejected'),{statuses:failures.map(result=>result.status)});}finally{window.Image=NativeImage;}
   checkedInitialLoad=true;
   checkRecovery=true;
  }
  await Promise.all([prepareBrandWatermark(),prepareBrandWatermark()]);
  add(checkRecovery?'로고 로드 실패 뒤 재시도 복구':'준비된 로고 재사용',true,{});
  const white=await solid(1200,675),black=await solid(1200,675,'#000000');
  for(const [name,input] of [['알림장 흰 배경',white],['알림장 검정 배경',black],['알림장 세로 원본 중앙 크롭',await solid(900,1600)]]){
   const result=await compressNoticeImage(input);const info=await inspect(result.blob);add(name,info.mark&&info.blueBeforeOrange&&info.width<=1200&&Math.abs(info.width/info.height-16/9)<.01&&info.bytes<=680*1024,info,result.blob);
  }
  const notice1=await compressNoticeImage(white),notice2=await compressNoticeImage(white);add('같은 알림장 원본 저장 재시도 동일',await same(notice1.blob,notice2.blob),{firstBytes:notice1.blob.size,retryBytes:notice2.blob.size});
  const portrait=await compressDeveloperLogImage(await solid(1400,2000));const portraitInfo=await inspect(portrait.blob);add('개발자 일지 세로 이미지',portraitInfo.mark&&portraitInfo.height<=1600&&portraitInfo.bytes<=700*1024,portraitInfo,portrait.blob);
  for(const variant of ['detail','preview']){const blob=await optimizeProductImage(black,variant);const info=await inspect(blob);add('상품 '+variant,info.mark&&info.blueBeforeOrange&&info.bytes<=(variant==='detail'?300:96)*1024,info,blob);}
  const cropped=await cropProductImage(white,{zoom:1,x:.5,y:.5});const cropInfo=await inspect(cropped);add('상품 크롭 원본에는 합성 없음',cropInfo.blue===0&&cropInfo.orange===0,cropInfo);
  const archive=await buildSourceArchiveUpload(await solid(800,600,''));const archiveInfo=await inspect(archive.blob);const archivePixels=await decode(archive.blob);add('자료 보관함 투명 원본 유지',archiveInfo.mark&&archivePixels.pixels[3]===0&&archive.byteSize===archive.blob.size,archiveInfo,archive.blob);
  for(const [name,options] of [['본문',QUIZ_QUESTION_IMAGE_OPTIONS],['짝맞추기',QUIZ_MATCHING_IMAGE_OPTIONS]]){
   const data=await optimizeQuizImageFile(white,options);const blob=await(await fetch(data)).blob();const info=await inspect(blob);const saved=await optimizeQuizImageDataUrl(data,options);add('문항 '+name+' 신규 합성·재저장 보존',info.mark&&saved===data&&new Blob([data]).size<=options.maxDataUrlBytes,info,blob);
  }
  const map=await watermarkImageBlob(await solid(800,600,''));const mapInfo=await inspect(map);const mapPixels=await decode(map);add('직접 지도 이미지 투명도·크기 보존',mapInfo.mark&&mapInfo.width===800&&mapInfo.height===600&&mapPixels.pixels[3]===0,mapInfo,map);
  let rejected=false;try{await compressNoticeImage(new File(['plain'],'text.txt',{type:'text/plain'}));}catch{rejected=true;}add('이미지가 아닌 파일 거절',rejected,{});
  summary.textContent=(cases.every(c=>c.passed)?'PASS':'FAIL')+' · '+cases.filter(c=>c.passed).length+'/'+cases.length+' 통과';
 }catch(error){add('검증 실행 오류',false,{error:String(error)});summary.textContent='FAIL';}
 event.target.disabled=false;
});
`;

const compile = async () => {
  const result = await build({
    stdin: { contents: entry, loader: "ts", resolveDir: root },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    loader: { ".png": "dataurl" },
    plugins: [
      {
        name: "isolate-production-services",
        setup(plugin) {
          plugin.onResolve(
            {
              filter:
                /^(?:\.\/firebase|\.\/applicationSession|firebase\/storage)$/,
            },
            (args) => ({ path: args.path, namespace: "fake" }),
          );
          plugin.onLoad({ filter: /.*/, namespace: "fake" }, () => ({
            contents: `const denied=()=>{throw new Error('Production service use forbidden in this fixture')};export const auth={currentUser:null};export const getFirebaseStorage=denied;export const callWithApplicationSession=denied;export const deleteObject=denied;export const getDownloadURL=denied;export const ref=denied;export const uploadBytes=denied;`,
            loader: "js",
          }));
        },
      },
    ],
  });
  return result.outputFiles[0].text;
};

const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>신규 등록 이미지 워터마크 검증</title><style>body{margin:24px;font:16px/1.5 sans-serif;color:#1f2937;background:#f9fafb}button{font:inherit;min-height:44px;padding:8px 16px}#results,#downloads{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:24px}section{min-width:0}h2,h3{font-size:16px}img{max-width:100%;max-height:300px;object-fit:contain;border:1px solid #cbd5e1}pre{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}.file-tools{display:flex;gap:12px;align-items:center;flex-wrap:wrap}a{display:inline-block;padding:8px 0;color:#2563eb}#downloads{margin-bottom:32px}</style><h1>신규 등록 이미지 워터마크 검증</h1><p>이미지는 이 PC에서만 처리합니다. 운영 연결·등록 없음.</p><section aria-labelledby="compress-title"><h2 id="compress-title">알림장 이미지 준비</h2><div class="file-tools"><label for="image-files">원본 이미지 선택</label><input id="image-files" type="file" accept="image/*" multiple><button id="compress-files" disabled>선택 이미지 압축</button></div><p role="status" id="compress-status">선택한 파일마다 실제 알림장 압축과 워터마크를 적용합니다.</p><div id="downloads"></div></section><h2>합성 이미지 회귀 검사</h2><button id="run">이미지 검증 실행</button><p role="status" id="summary">대기</p><div id="results"></div><script type="module" src="/fixture.js"></script></html>`;
let compiled = await compile();
if (process.argv.includes("--check")) {
  console.log(
    "Brand watermark fixture bundle PASS; production services blocked.",
  );
  process.exit(0);
}
// Export bytes live only in this loopback process, never Firebase or disk.
const preparedDownloads = new Map();
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/export") {
      const origin = `http://127.0.0.1:${server.address().port}`;
      const mime = String(req.headers["content-type"] || "");
      if (
        req.headers.origin !== origin ||
        !["image/webp", "image/jpeg", "image/png"].includes(mime)
      ) {
        res.writeHead(403);
        res.end("Local image export only");
        return;
      }
      const filename =
        path
          .basename(
            decodeURIComponent(
              String(req.headers["x-file-name"] || "notice.webp"),
            ),
          )
          .replace(/[\x00-\x1f\x7f]/g, "")
          .slice(0, 160) || "notice.webp";
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 700 * 1024) {
          res.writeHead(413);
          res.end("Image too large");
          return;
        }
        chunks.push(chunk);
      }
      for (const [id, item] of preparedDownloads)
        if (item.expiresAt < Date.now()) preparedDownloads.delete(id);
      while (preparedDownloads.size >= 20)
        preparedDownloads.delete(preparedDownloads.keys().next().value);
      const id = randomUUID();
      preparedDownloads.set(id, {
        bytes: Buffer.concat(chunks),
        mime,
        filename,
        expiresAt: Date.now() + 30 * 60 * 1000,
      });
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ href: `/download/${id}` }));
      return;
    }
    if (req.method === "GET" && req.url.startsWith("/download/")) {
      const item = preparedDownloads.get(req.url.slice("/download/".length));
      if (!item || item.expiresAt < Date.now()) {
        res.writeHead(404);
        res.end("Export expired; compress again");
        return;
      }
      res.writeHead(200, {
        "Content-Type": item.mime,
        "Content-Length": item.bytes.length,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(item.filename)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(item.bytes);
      return;
    }
    if (req.url === "/") compiled = await compile();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self' data:; img-src 'self' data: blob:; style-src 'unsafe-inline'; script-src 'self'",
    );
    res.setHeader(
      "Content-Type",
      req.url === "/fixture.js"
        ? "text/javascript;charset=utf-8"
        : "text/html;charset=utf-8",
    );
    res.end(req.url === "/fixture.js" ? compiled : html);
  } catch (error) {
    res.writeHead(500);
    res.end(String(error));
  }
});
await new Promise((resolve) =>
  server.listen(
    Number(process.env.BRAND_WATERMARK_QA_PORT || 4339),
    "127.0.0.1",
    resolve,
  ),
);
console.log(
  `http://127.0.0.1:${server.address().port} · synthetic images only; no production services`,
);
