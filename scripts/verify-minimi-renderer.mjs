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
const output = path.join(root, "output/minimi-rebuild-20261111");
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
window.run=async()=>{
const assert=(condition,message)=>{if(!condition)throw Error(message)};
const sprite=document.createElement('canvas');sprite.width=W;sprite.height=H;const ctx=sprite.getContext('2d',{willReadFrequently:true});
const pixels=look=>{drawMinimi(ctx,look);return ctx.getImageData(0,0,W,H).data};
let combinations=0,minPixels=Infinity,maxPixels=0;
for(const character of V.character)for(const hairStyle of V.hairStyle)for(const top of V.top)for(const bottom of V.bottom.filter(value=>AVATAR_ITEMS.some(i=>i.slot==='bottom'&&i.value===value&&i.characters.includes(character))))for(const pose of V.pose)for(const accessory of V.accessory){
 const look={...defaultAvatarLook(character),hairStyle,top,bottom,pose,accessory},data=pixels(look);let count=0;
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const alpha=data[(y*W+x)*4+3];assert(alpha===0||alpha===255,'Antialiased sprite edge');if(alpha){count++;assert(x>0&&x<W-1&&y>0&&y<H-1,'Sprite clipping: '+JSON.stringify(look))}
 }
 assert(count>1200,'Unexpected empty sprite');minPixels=Math.min(minPixels,count);maxPixels=Math.max(maxPixels,count);
 // Clothes cover the torso for every combination, without transparent seams.
 for(let y=61;y<=70;y++)for(let x=34;x<=46;x++)assert(data[(y*W+x)*4+3]===255,'Torso gap: '+JSON.stringify(look));
 combinations++;
}
let skinChecks=0;
for(const top of V.top)for(const pose of V.pose){
 const base={...defaultAvatarLook(),top,pose};const light=pixels({...base,skinTone:'mm-ivory'}).slice(),dark=pixels({...base,skinTone:'mm-deep'});
 let changed=0;for(let i=0;i<light.length;i+=4)if(light[i]!==dark[i]||light[i+1]!==dark[i+1]||light[i+2]!==dark[i+2])changed++;
 assert(changed>100,'Skin selection must affect the character');
 for(let y=61;y<=70;y++)for(let x=34;x<=46;x++){const p=(y*W+x)*4;assert(light.slice(p,p+4).every((v,i)=>v===dark[p+i]),'Skin recolor leaks into garment: '+top+'/'+pose)}skinChecks++;
}
// Every advertised option is accepted, with no accidental identical visual variants.
const distinct={};
for(const slot of ['hairStyle','expression','pose','top','bottom','shoes','accessory','hairTone','skinTone']){const seen=new Set();for(const value of V[slot]){drawMinimi(ctx,{...defaultAvatarLook(),[slot]:value});seen.add(sprite.toDataURL())}assert(seen.size===V[slot].length,'Duplicate visual option '+slot);distinct[slot]=seen.size}
const samples=[];for(const character of V.character)for(const top of V.top)for(const pose of V.pose)samples.push({...defaultAvatarLook(character),top,pose,bottom:/hoodie|halfzip/.test(top)?'mm-school-joggers':'mm-school-shorts'});
const sheet=document.createElement('canvas');sheet.width=6*180;sheet.height=Math.ceil(samples.length/6)*256;const sheetCtx=sheet.getContext('2d');sheetCtx.fillStyle='#f8fafc';sheetCtx.fillRect(0,0,sheet.width,sheet.height);sheetCtx.imageSmoothingEnabled=false;
samples.forEach((look,i)=>{drawMinimi(ctx,look);const x=i%6*180,y=Math.floor(i/6)*256;sheetCtx.drawImage(sprite,x+10,y,160,224);sheetCtx.fillStyle='#334155';sheetCtx.font='10px sans-serif';sheetCtx.fillText(look.character+' / '+look.top.replace('mm-',''),x+6,y+238);sheetCtx.fillText(look.pose.replace('mm-',''),x+6,y+252)});
const poseSheet=sheet.toDataURL('image/png');
const overviewSamples=[
 ['girl','mm-school-white','mm-bob','mm-smile','mm-idle','하복 · 흰색'],
 ['boy','mm-school-navy','mm-parted','mm-bright','mm-wave','하복 · 남색'],
 ['girl','mm-school-hoodie','mm-ponytail','mm-wink','mm-cheer','동복 · 후드 집업'],
 ['boy','mm-school-hoodie','mm-crop','mm-smile','mm-idle','동복 · 후드 집업'],
 ['girl','mm-school-halfzip','mm-wave','mm-calm','mm-wave','동복 · 반집업'],
 ['boy','mm-school-halfzip','mm-long','mm-bright','mm-cheer','동복 · 반집업']
];
const overviewCanvas=document.createElement('canvas');overviewCanvas.width=1152;overviewCanvas.height=320;const overviewContext=overviewCanvas.getContext('2d');overviewContext.imageSmoothingEnabled=false;overviewContext.fillStyle='#f8fafc';overviewContext.fillRect(0,0,1152,320);
overviewSamples.forEach(([character,top,hairStyle,expression,pose,label],i)=>{drawMinimi(ctx,{...defaultAvatarLook(character),top,hairStyle,expression,pose,bottom:/hoodie|halfzip/.test(top)?'mm-school-joggers':'mm-school-shorts'});overviewContext.drawImage(sprite,i*192+16,24,160,224);overviewContext.fillStyle='#334155';overviewContext.textAlign='center';overviewContext.font='bold 16px "Malgun Gothic",sans-serif';overviewContext.fillText(label,i*192+96,280)});
const overview=overviewCanvas.toDataURL('image/png');
const stage=await createAvatarStage(document.getElementById('stage'),defaultAvatarLook());
await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const before=stage.stats.renderedFrames;await new Promise(resolve=>setTimeout(resolve,120));assert(stage.stats.renderedFrames===before,'Renderer runs when idle');
const capture=stage.capture();stage.focusFace();assert(stage.capture()===capture,'Camera framing contaminates saved image');stage.resetView();
const bitmap=await createImageBitmap(await(await fetch(capture)).blob());assert(bitmap.width===384&&bitmap.height===512,'Capture dimensions');bitmap.close();
assert(!stage.setLook({hairStyle:'old-hair'}).applied,'Unknown values accepted');
assert(stage.setLook({pose:'mm-wave'}).applied,'Valid pose rejected');assert(stage.capture()!==capture,'Pose did not update capture');
const abort=new AbortController();abort.abort();let aborted=false;try{await stage.prepareLook(defaultAvatarLook(),{signal:abort.signal})}catch(e){aborted=e.name==='AbortError'}assert(aborted,'Cancelled preparation applied');
stage.dispose();assert(!document.querySelector('#stage canvas'),'Canvas leaked on dispose');assert(!stage.setPose('mm-cheer').applied,'Disposed stage accepts changes');
return {combinations,skinChecks,distinct,minPixels,maxPixels,poseSheet,overview,lifecycle:true};
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
    path.join(output, "overview.png"),
    Buffer.from(result.overview.split(",")[1], "base64"),
  );
  delete result.overview;
  await fs.writeFile(
    path.join(output, "renderer-report.json"),
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
