/** Pixel composition and lifecycle checks using only synthetic looks. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output =
  process.env.AVATAR_ART_EVIDENCE_DIR ||
  path.join(root, "output/avatar-hanbok-20261114");
const exhaustive = !process.argv.includes("--details-only");
await fs.mkdir(output, { recursive: true });
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    process.env.PLAYWRIGHT_MODULE_PATH ||
      path.join(
        os.homedir(),
        ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
      ),
  );
}
const bundle = await build({
  stdin: {
    contents: `
import {drawMinimi,MINIMI_WIDTH as W,MINIMI_HEIGHT as H,MINIMI_VALUES as V,createAvatarStage} from './src/features/avatar/minimi/engine';
import {defaultAvatarLook,AVATAR_ITEMS} from './src/features/avatar/catalog';
import {hanbokHatHairLine,HANBOK_ACCESSORIES} from './src/features/avatar/minimi/hanbok';
window.run=async()=>{
const assert=(condition,message)=>{if(!condition)throw Error(message)};
const sprite=document.createElement('canvas');sprite.width=W;sprite.height=H;const ctx=sprite.getContext('2d',{willReadFrequently:true});
const pixels=look=>{drawMinimi(ctx,look);return ctx.getImageData(0,0,W,H).data};
let combinations=0,minPixels=Infinity,maxPixels=0;
if(${exhaustive})for(const character of V.character)for(const hairStyle of V.hairStyle)for(const top of V.top)for(const bottom of V.bottom.filter(value=>AVATAR_ITEMS.some(i=>i.slot==='bottom'&&i.value===value&&i.characters.includes(character))))for(const pose of V.pose)for(const accessory of ['mm-none']){
 const look={...defaultAvatarLook(character),hairStyle,top,bottom,pose,accessory},data=pixels(look);let count=0;
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const alpha=data[(y*W+x)*4+3];assert(alpha===0||alpha===255,'Antialiased sprite edge');if(alpha){count++;assert(x>0&&x<W-1&&y>0&&y<H-1,'Sprite clipping: '+JSON.stringify(look))}
 }
 assert(count>1200,'Unexpected empty sprite');minPixels=Math.min(minPixels,count);maxPixels=Math.max(maxPixels,count);
 // Clothes cover the torso for every combination, without transparent seams.
 for(let y=61;y<=70;y++)for(let x=34;x<=46;x++)assert(data[(y*W+x)*4+3]===255,'Torso gap: '+JSON.stringify(look));
 combinations++;
}
// Headwear geometry is independent of clothes; cover every hair/hat/pose/skin combination separately.
let headwearChecks=0;
for(const character of V.character)for(const hairStyle of V.hairStyle)for(const accessory of V.accessory)for(const pose of V.pose)for(const skinTone of V.skinTone){
 const look={...defaultAvatarLook(character),hairStyle,accessory,pose,skinTone};const full=pixels(look).slice();
 for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(full[(y*W+x)*4+3])assert(x>0&&x<W-1&&y>0&&y<H-1,'Headwear clipping: '+JSON.stringify(look));
 const brim=accessory==='mm-cap'?21:hanbokHatHairLine(accessory);
 if(brim){drawMinimi(ctx,look,{itemOnly:'accessory'});const hat=ctx.getImageData(0,0,W,H).data;for(let y=0;y<brim;y++)for(let x=0;x<W;x++){const n=(y*W+x)*4;assert(full.slice(n,n+4).every((v,i)=>v===hat[n+i]),'Hair protrudes above hat: '+JSON.stringify(look));}}
 headwearChecks++;
}
let isolatedChecks=0;
for (const item of AVATAR_ITEMS.filter(item=>['top','bottom','shoes','accessory'].includes(item.slot) && item.value !== 'mm-none')) for(const pose of V.pose) {
 const base={...defaultAvatarLook(),pose,[item.slot]:item.value};
 drawMinimi(ctx,base,{itemOnly:item.slot});const first=sprite.toDataURL();
 const other={...base,character:'boy',skinTone:'mm-deep',hairStyle:'mm-long-curl',hairTone:'mm-rose',accessory:item.slot==='accessory'?item.value:'mm-cap'};
 for(const slot of ['top','bottom','shoes']) if(slot!==item.slot)other[slot]=V[slot][V[slot].length-1];
 drawMinimi(ctx,other,{itemOnly:item.slot});assert(first===sprite.toDataURL(),'Unrelated body or item in thumbnail: '+item.id+'/'+pose);isolatedChecks++;
}
for(const [slot,values] of Object.entries(V)) assert(values.length===AVATAR_ITEMS.filter(i=>i.slot===slot).length,'Renderer/catalog option coverage: '+slot);
let skinChecks=0;
for(const character of V.character)for(const top of V.top)for(const pose of V.pose){
 const base={...defaultAvatarLook(character),top,pose};const light=pixels({...base,skinTone:'mm-ivory'}).slice(),dark=pixels({...base,skinTone:'mm-deep'});
 let changed=0;for(let i=0;i<light.length;i+=4)if(light[i]!==dark[i]||light[i+1]!==dark[i+1]||light[i+2]!==dark[i+2])changed++;
 assert(changed>100,'Skin selection must affect the character');
 drawMinimi(ctx,base,{itemOnly:'top'});const cloth=ctx.getImageData(0,0,W,H).data;
 for(let y=54;y<=70;y++)for(let x=0;x<W;x++){const p=(y*W+x)*4;if(cloth[p+3])assert(light.slice(p,p+4).every((v,i)=>v===dark[p+i]),'Skin recolor leaks into garment/sleeve: '+top+'/'+pose)}
 for(let y=71;y<=95;y++)for(let x=30;x<=50;x++){const p=(y*W+x)*4;if(cloth[p+3])assert(light.slice(p,p+4).every((v,i)=>v===dark[p+i]),'Skin recolor leaks into robe: '+top+'/'+pose)}skinChecks++;
}
let footwearChecks=0;
for(const character of V.character)for(const bottom of V.bottom.filter(value=>AVATAR_ITEMS.some(i=>i.slot==='bottom'&&i.value===value&&i.characters.includes(character))))for(const shoes of V.shoes)for(const pose of V.pose)for(const skinTone of V.skinTone){
 const look={...defaultAvatarLook(character),bottom,shoes,pose,skinTone};
 drawMinimi(ctx,look,{itemOnly:'shoes'});const footwear=ctx.getImageData(0,0,W,H).data;const full=pixels(look);
 for(let y=91;y<=104;y++)for(let x=26;x<=55;x++) { const i=(y*W+x)*4;if(footwear[i+3])assert(footwear.slice(i,i+4).every((v,k)=>v===full[i+k]),'Footwear fitting/occlusion: '+JSON.stringify(look)); }
 footwearChecks++;
}
// The full fringe must cover the scalp in every tint and pose without skin-color seams.
let bowlFringeChecks=0;
for(const character of V.character)for(const hairTone of V.hairTone)for(const pose of V.pose){
 const look={...defaultAvatarLook(character),hairStyle:'mm-ash-bowl',hairTone,pose};
 const light=pixels({...look,skinTone:'mm-ivory'}).slice(),dark=pixels({...look,skinTone:'mm-deep'});
 for(let y=12;y<=27;y++)for(let x=27;x<=53;x++){const p=(y*W+x)*4;assert(light[p+3]===255,'Bowl fringe gap');assert(light.slice(p,p+4).every((v,i)=>v===dark[p+i]),'Skin leaks through full bowl fringe');}
 bowlFringeChecks++;
}
let schoolUniformChecks=0;
let softHairChecks=0;
for(const hairStyle of ['mm-ash-cloud','mm-blossom-bob','mm-royal-ash','mm-royal-choco-bob'])for(const character of V.character)for(const hairTone of V.hairTone)for(const pose of V.pose){
 const look={...defaultAvatarLook(character),hairStyle,hairTone,pose};
 const light=pixels({...look,skinTone:'mm-ivory'}).slice(),dark=pixels({...look,skinTone:'mm-deep'});
 for(let y=13;y<=23;y++)for(let x=27;x<=52;x++){const p=(y*W+x)*4;assert(light[p+3]===255,'Soft hair crown gap');assert(light.slice(p,p+4).every((v,i)=>v===dark[p+i]),'Skin leaks through soft hair crown');}
 softHairChecks++;
}
let roundedCrownChecks=0;
for(const hairStyle of ['mm-ash-cloud','mm-royal-ash','mm-royal-choco-bob'])for(const character of V.character)for(const hairTone of V.hairTone)for(const pose of V.pose)for(const skinTone of V.skinTone){
 const look={...defaultAvatarLook(character),hairStyle,hairTone,pose,skinTone};
 drawMinimi(ctx,look,{itemOnly:'hairStyle'});const data=ctx.getImageData(0,0,W,H).data;
 const crownTop=hairStyle==='mm-royal-choco-bob'?8:6;
 for(let y=0;y<crownTop;y++)for(let x=0;x<W;x++)assert(data[(y*W+x)*4+3]===0,'Unexpected tuft above rounded crown: '+JSON.stringify(look));
 if(hairStyle==='mm-ash-cloud')assert(Array.from({length:8},(_,i)=>data[(6*W+36+i)*4+3]).every(alpha=>alpha===255),'Ash-cloud crown must be a continuous rounded cap');
 roundedCrownChecks++;
}
const colorAt=(data,x,y)=>Array.from(data.slice((y*W+x)*4,(y*W+x)*4+3));
for(const character of V.character)for(const pose of V.pose){
 const look={...defaultAvatarLook(character),pose};
 const white=pixels({...look,top:'mm-school-white'}).slice();
 const whiteBody=colorAt(white,40,67),navyCollar=colorAt(white,36,55);
 assert(Math.min(...whiteBody)>=240,'White school uniform is not bright white');
 assert(navyCollar[2]>navyCollar[0]&&Math.max(...navyCollar)<120,'White school uniform needs a navy collar');
 const navy=pixels({...look,top:'mm-school-navy'});
 assert(new Set([[34,52],[36,52],[36,54],[35,54],[36,56]].map(([x,y])=>colorAt(navy,x,y).join(','))).size>=3,'Navy school collar needs visible checks');
 schoolUniformChecks++;
}
// Every advertised option is accepted, with no accidental identical visual variants.
const distinct={};
for(const slot of ['hairStyle','expression','pose','top','bottom','shoes','accessory','hairTone','skinTone']){const seen=new Set();for(const value of V[slot]){drawMinimi(ctx,{...defaultAvatarLook(),[slot]:value});seen.add(sprite.toDataURL())}assert(seen.size===V[slot].length,'Duplicate visual option '+slot);distinct[slot]=seen.size}
const samples=[];for(const character of V.character)for(const top of V.top)for(const pose of V.pose)samples.push({...defaultAvatarLook(character),top,pose,hairStyle:V.hairStyle[V.top.indexOf(top)%V.hairStyle.length],hairTone:V.hairTone[V.top.indexOf(top)%V.hairTone.length],bottom:V.bottom.filter(value=>AVATAR_ITEMS.some(i=>i.slot==='bottom'&&i.value===value&&i.characters.includes(character)))[V.top.indexOf(top)% (character==='girl'?V.bottom.length:V.bottom.length-1)],shoes:V.shoes[V.top.indexOf(top)%V.shoes.length]});
const sheet=document.createElement('canvas');sheet.width=6*180;sheet.height=Math.ceil(samples.length/6)*256;const sheetCtx=sheet.getContext('2d');sheetCtx.fillStyle='#f8fafc';sheetCtx.fillRect(0,0,sheet.width,sheet.height);sheetCtx.imageSmoothingEnabled=false;
samples.forEach((look,i)=>{drawMinimi(ctx,look);const x=i%6*180,y=Math.floor(i/6)*256;sheetCtx.drawImage(sprite,x+10,y,160,224);sheetCtx.fillStyle='#334155';sheetCtx.font='10px sans-serif';sheetCtx.fillText(look.character+' / '+look.top.replace('mm-',''),x+6,y+238);sheetCtx.fillText(look.pose.replace('mm-',''),x+6,y+252)});
const poseSheet=sheet.toDataURL('image/png');
const hanbokTops=V.top.filter(v=>v.startsWith('mm-hanbok-')&&v!=='mm-hanbok-sky'),hanbokBottoms=V.bottom.filter(v=>v.startsWith('mm-hanbok-')),hanbokShoes=V.shoes.filter(v=>v.startsWith('mm-hanbok-'));
const hanbokLooks=[];for(const character of V.character)for(let i=0;i<hanbokTops.length;i++)for(const pose of V.pose)hanbokLooks.push({...defaultAvatarLook(character),top:hanbokTops[i],bottom:hanbokBottoms[i%hanbokBottoms.length],shoes:hanbokShoes[i%hanbokShoes.length],accessory:HANBOK_ACCESSORIES[i],hairStyle:V.hairStyle[(i*2+3)%V.hairStyle.length],hairTone:V.hairTone[i%V.hairTone.length],pose});
const hanbokCanvas=document.createElement('canvas');hanbokCanvas.width=6*180;hanbokCanvas.height=Math.ceil(hanbokLooks.length/6)*256;const hc=hanbokCanvas.getContext('2d');hc.fillStyle='#f8fafc';hc.fillRect(0,0,hanbokCanvas.width,hanbokCanvas.height);hc.imageSmoothingEnabled=false;
hanbokLooks.forEach((look,i)=>{drawMinimi(ctx,look);const x=i%6*180,y=Math.floor(i/6)*256;hc.drawImage(sprite,x+10,y,160,224);hc.fillStyle='#334155';hc.font='10px sans-serif';hc.fillText(look.character+' / '+look.top.replace('mm-hanbok-',''),x+6,y+238);hc.fillText(look.pose.replace('mm-','')+' / '+look.accessory.replace('mm-hanbok-',''),x+6,y+252)});
const hanbokSheet=hanbokCanvas.toDataURL('image/png');

const overviewSamples=[
 ['girl','mm-sailor-mint','mm-twin-ribbon','mm-sparkle','mm-idle','민트 세일러'],
 ['boy','mm-academy-navy','mm-side-sweep','mm-cat','mm-wave','네이비 아카데미'],
 ['girl','mm-lace-blouse','mm-high-bun','mm-shy','mm-cheer','레이스 블라우스'],
 ['boy','mm-royal-coat','mm-wolf-layer','mm-determined','mm-idle','궁정 재킷'],
 ['girl','mm-moon-cape','mm-long-curl','mm-dreamy','mm-wave','달무리 케이프'],
 ['boy','mm-star-hoodie','mm-fluffy-curl','mm-bright','mm-cheer','별사탕 후드']
];
const overviewCanvas=document.createElement('canvas');overviewCanvas.width=1152;overviewCanvas.height=320;const overviewContext=overviewCanvas.getContext('2d');overviewContext.imageSmoothingEnabled=false;overviewContext.fillStyle='#f8fafc';overviewContext.fillRect(0,0,1152,320);
overviewSamples.forEach(([character,top,hairStyle,expression,pose,label],i)=>{drawMinimi(ctx,{...defaultAvatarLook(character),top,hairStyle,expression,pose,bottom:/hoodie|halfzip/.test(top)?'mm-school-joggers':'mm-school-shorts'});overviewContext.drawImage(sprite,i*192+16,24,160,224);overviewContext.fillStyle='#334155';overviewContext.textAlign='center';overviewContext.font='bold 16px "Malgun Gothic",sans-serif';overviewContext.fillText(label,i*192+96,280)});
const overview=overviewCanvas.toDataURL('image/png');
const polishLooks=[];
for(const character of V.character)for(const top of ['mm-school-white','mm-school-navy'])for(const pose of V.pose)
 polishLooks.push({...defaultAvatarLook(character),hairStyle:'mm-ash-bowl',hairTone:top==='mm-school-white'?'mm-ink':'mm-silver',top,pose,accessory:pose==='mm-idle'?'mm-none':'mm-sunglasses'});
const polishCanvas=document.createElement('canvas');polishCanvas.width=6*240;polishCanvas.height=2*360;const pc=polishCanvas.getContext('2d');pc.fillStyle='#f0f4f8';pc.fillRect(0,0,polishCanvas.width,polishCanvas.height);pc.imageSmoothingEnabled=false;
polishLooks.forEach((look,i)=>{drawMinimi(ctx,look);const x=i%6*240,y=Math.floor(i/6)*360;pc.drawImage(sprite,x,y,240,336);pc.fillStyle='#334155';pc.font='12px sans-serif';pc.fillText(look.character+' / '+look.top.replace('mm-school-','')+' / '+look.pose.replace('mm-',''),x+12,y+352)});
const polishSheet=polishCanvas.toDataURL('image/png');
const softLooks=[];
for(const [character,hairStyle,top,bottom] of [['boy','mm-ash-cloud','mm-school-white','mm-school-shorts'],['girl','mm-blossom-bob','mm-hanbok-plum','mm-hanbok-chima-plum']])for(const hairTone of ['mm-ink','mm-brown'])for(const pose of V.pose)
 softLooks.push({...defaultAvatarLook(character),hairStyle,hairTone,top,bottom,pose});
for(const [character,hairStyle,accessories] of [['boy','mm-ash-cloud',['mm-cap','mm-hanbok-gat','mm-hanbok-baekrip']],['girl','mm-blossom-bob',['mm-cap','mm-hanbok-jokduri','mm-hanbok-satgat']]])for(const accessory of accessories)
 softLooks.push({...defaultAvatarLook(character),hairStyle,accessory,pose:'mm-wave'});
const softCanvas=document.createElement('canvas');softCanvas.width=6*240;softCanvas.height=Math.ceil(softLooks.length/6)*360;const sc=softCanvas.getContext('2d');sc.fillStyle='#f0f4f8';sc.fillRect(0,0,softCanvas.width,softCanvas.height);sc.imageSmoothingEnabled=false;
softLooks.forEach((look,i)=>{drawMinimi(ctx,look);const x=i%6*240,y=Math.floor(i/6)*360;sc.drawImage(sprite,x,y,240,336);sc.fillStyle='#334155';sc.font='11px sans-serif';sc.fillText(look.hairStyle.replace('mm-','')+' / '+(look.accessory==='mm-none'?look.hairTone.replace('mm-','')+' / '+look.pose.replace('mm-',''):look.accessory.replace('mm-','')),x+8,y+352)});
const softHairSheet=softCanvas.toDataURL('image/png');
const royalLooks=[];
for(const [character,hairStyle,accessory] of [['boy','mm-royal-ash','mm-none'],['girl','mm-royal-choco-bob','mm-none'],['girl','mm-royal-choco-bob','mm-cherry-ribbon'],['boy','mm-ash-cloud','mm-none']])for(const pose of V.pose)
 royalLooks.push({...defaultAvatarLook(character),hairStyle,accessory,pose});
for(const [character,hairStyle,accessories] of [['boy','mm-royal-ash',['mm-cap','mm-hanbok-gat','mm-hanbok-baekrip']],['girl','mm-royal-choco-bob',['mm-cap','mm-hanbok-jokduri','mm-hanbok-satgat']]])for(const accessory of accessories)
 royalLooks.push({...defaultAvatarLook(character),hairStyle,accessory,pose:'mm-wave'});
const royalCanvas=document.createElement('canvas');royalCanvas.width=6*240;royalCanvas.height=Math.ceil(royalLooks.length/6)*360;const rc=royalCanvas.getContext('2d');rc.fillStyle='#f0f4f8';rc.fillRect(0,0,royalCanvas.width,royalCanvas.height);rc.imageSmoothingEnabled=false;
royalLooks.forEach((look,i)=>{drawMinimi(ctx,look);const x=i%6*240,y=Math.floor(i/6)*360;rc.drawImage(sprite,x,y,240,336);rc.fillStyle='#334155';rc.font='10px sans-serif';rc.fillText(look.hairStyle.replace('mm-','')+' / '+look.accessory.replace('mm-','')+' / '+look.pose.replace('mm-',''),x+8,y+352)});
const royalSheet=royalCanvas.toDataURL('image/png');
const royalHeads=document.createElement('canvas');royalHeads.width=4*280;royalHeads.height=288;const rh=royalHeads.getContext('2d');rh.fillStyle='#f0f4f8';rh.fillRect(0,0,royalHeads.width,royalHeads.height);rh.imageSmoothingEnabled=false;
for(const [i,look] of [royalLooks[9],royalLooks[0],royalLooks[3],royalLooks[6]].entries()){drawMinimi(ctx,look);rh.drawImage(sprite,8,0,64,53,i*280+12,8,256,212);rh.drawImage(sprite,8,0,64,53,i*280+108,226,64,53);rh.fillStyle='#334155';rh.font='10px sans-serif';rh.fillText(look.hairStyle.replace('mm-','')+(look.accessory==='mm-none'?'':' + flower'),i*280+8,284)}
const royalHeadSheet=royalHeads.toDataURL('image/png');
const stage=await createAvatarStage(document.getElementById('stage'),defaultAvatarLook());
await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const before=stage.stats.renderedFrames;await new Promise(resolve=>setTimeout(resolve,120));assert(stage.stats.renderedFrames===before,'Renderer runs when idle');
const capture=stage.capture();stage.focusFace();assert(stage.capture()===capture,'Camera framing contaminates saved image');stage.resetView();
const bitmap=await createImageBitmap(await(await fetch(capture)).blob());assert(bitmap.width===384&&bitmap.height===512,'Capture dimensions');bitmap.close();
assert(!stage.setLook({hairStyle:'old-hair'}).applied,'Unknown values accepted');
assert(stage.setLook({pose:'mm-wave'}).applied,'Valid pose rejected');assert(stage.capture()!==capture,'Pose did not update capture');
const abort=new AbortController();abort.abort();let aborted=false;try{await stage.prepareLook(defaultAvatarLook(),{signal:abort.signal})}catch(e){aborted=e.name==='AbortError'}assert(aborted,'Cancelled preparation applied');
stage.dispose();assert(!document.querySelector('#stage canvas'),'Canvas leaked on dispose');assert(!stage.setPose('mm-cheer').applied,'Disposed stage accepts changes');
return {exhaustive:${exhaustive},combinations,headwearChecks,isolatedChecks,skinChecks,footwearChecks,bowlFringeChecks,softHairChecks,roundedCrownChecks,schoolUniformChecks,distinct,minPixels,maxPixels,poseSheet,hanbokSheet,overview,polishSheet,softHairSheet,royalSheet,royalHeadSheet,lifecycle:true};
};`,
    loader: "ts",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const server = http.createServer((req, res) => {
  if (req.url === "/test.js")
    return res
      .writeHead(200, { "Content-Type": "text/javascript" })
      .end(bundle.outputFiles[0].contents);
  res
    .writeHead(200, { "Content-Type": "text/html" })
    .end(
      '<!doctype html><div id="stage" style="width:320px;height:420px"></div><script type="module" src="/test.js"></script>',
    );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
});
try {
  const page = await browser.newPage();
  await page.route("**/*", (r) =>
    r.request().url().startsWith(origin) ||
    r.request().url().startsWith("data:")
      ? r.continue()
      : r.abort(),
  );
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.run === "function");
  const result = await page.evaluate(() => window.run());
  await fs.writeFile(
    path.join(output, "pose-review.png"),
    Buffer.from(result.poseSheet.split(",")[1], "base64"),
  );
  delete result.poseSheet;
  await fs.writeFile(
    path.join(output, "hanbok-review.png"),
    Buffer.from(result.hanbokSheet.split(",")[1], "base64"),
  );
  delete result.hanbokSheet;
  await fs.writeFile(
    path.join(output, "overview.png"),
    Buffer.from(result.overview.split(",")[1], "base64"),
  );
  delete result.overview;
  await fs.writeFile(
    path.join(output, "polish-review.png"),
    Buffer.from(result.polishSheet.split(",")[1], "base64"),
  );
  delete result.polishSheet;
  await fs.writeFile(
    path.join(output, "soft-hair-review.png"),
    Buffer.from(result.softHairSheet.split(",")[1], "base64"),
  );
  delete result.softHairSheet;
  await fs.writeFile(
    path.join(output, "royal-review.png"),
    Buffer.from(result.royalSheet.split(",")[1], "base64"),
  );
  delete result.royalSheet;
  await fs.writeFile(
    path.join(output, "royal-heads.png"),
    Buffer.from(result.royalHeadSheet.split(",")[1], "base64"),
  );
  delete result.royalHeadSheet;
  await fs.writeFile(
    path.join(
      output,
      exhaustive ? "renderer-report.json" : "renderer-details-report.json",
    ),
    JSON.stringify({ passed: true, ...result }, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: true,
      ...result,
      poseSheet: path.join(output, "pose-review.png"),
    }),
  );
} finally {
  await browser.close();
  server.close();
}
