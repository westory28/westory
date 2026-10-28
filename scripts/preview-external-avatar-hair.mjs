/** Local-only GLB fitting fixture. Does not modify or deploy the avatar renderer. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { SKIN_TONES } from "../src/features/avatar/renderer/palettes.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = {},
  positional = [];
for (let i = 2; i < process.argv.length; i++) {
  const value = process.argv[i];
  if (!value.startsWith("--")) positional.push(value);
  else if (
    ["--check", "--serve", "--help", "--rear-cover", "--full-body"].includes(
      value,
    )
  )
    options[value.slice(2)] = true;
  else {
    const [name, inline] = value.slice(2).split("=");
    options[name] = inline ?? process.argv[++i];
    assert(options[name] !== undefined, `Missing --${name} value`);
  }
}
if (options.help || (!options.check && !positional[0])) {
  console.log(`Usage: node scripts/preview-external-avatar-hair.mjs "C:\\path\\hair.glb" [options]
  --check                Compile fixture only; no asset or browser required
  --serve                Open a local fitting page without automatic captures
  --character boy|girl   Default: boy
  --skin-tone original  Skin-tone palette ID for the source and inner scalp
  --rotation 0,0,0       XYZ degrees before fitting (front is +Z)
  --scale 1,1,1          XYZ fit multipliers after uniform width fitting
  --offset 0,0,0         XYZ displacement in the base mesh's bind coordinates
  --width 0.39           Optional target width; default: native hair mask bounds
  --rear-cover           Fit an inner cover from the actual textured rear hair
  --full-body            Also capture four body angles and wave/cheer poses
  --hair-zoom 1          Optional zoom-out steps for tall/wide hair captures
  --body-zoom 1          Optional zoom-out steps for full-body captures
  --compare <directory>  Compare these captures with an original-asset QA run
  --resolution 512       Square captures, 128–1024px
  --output <directory>   Default: output/external-avatar-hair/<asset name>
Produces real front/left/back/right images, native/bald references, pose check,
and report.json. Native hair is hidden with the existing shader mask only in
this isolated bundle. GLB must embed its buffers and textures.`);
  process.exit(options.help ? 0 : 1);
}
const vector = (value, fallback, label, positive = false) => {
  const values = value === undefined ? fallback : value.split(",").map(Number);
  assert(
    values.length === 3 &&
      values.every((v) => Number.isFinite(v) && (!positive || v > 0)),
    `Invalid ${label}`,
  );
  return values;
};
const character = options.character || "boy";
assert(["boy", "girl"].includes(character), "--character must be boy or girl");
const skinTone = options["skin-tone"] || "original";
assert(
  SKIN_TONES.some((item) => item.id === skinTone),
  "Unknown skin tone",
);
const resolution = Number(options.resolution || 512);
const cameraZoom = {
  hair: Number(options["hair-zoom"] || 0),
  body: Number(options["body-zoom"] || 0),
};
assert(
  Object.values(cameraZoom).every(
    (value) => Number.isInteger(value) && value >= 0 && value <= 6,
  ),
  "Zoom steps must be integers from 0 to 6",
);
assert(
  Number.isInteger(resolution) && resolution >= 128 && resolution <= 1024,
  "Invalid resolution",
);
const fit = {
  rotation: vector(options.rotation, [0, 0, 0], "rotation"),
  scale: vector(options.scale, [1, 1, 1], "scale", true),
  offset: vector(options.offset, [0, 0, 0], "offset"),
  width: options.width === undefined ? null : Number(options.width),
};
assert(
  fit.width === null || (Number.isFinite(fit.width) && fit.width > 0),
  "Invalid width",
);
let sourceBytes, sourceDoc, sourcePath;
if (positional[0]) {
  sourcePath = path.resolve(positional[0]);
  sourceBytes = await fs.readFile(sourcePath);
  assert(
    sourceBytes.readUInt32LE(0) === 0x46546c67 &&
      sourceBytes.readUInt32LE(4) === 2,
    "A valid GLB v2 is required",
  );
  assert.equal(
    sourceBytes.readUInt32LE(8),
    sourceBytes.length,
    "Incomplete GLB file",
  );
  for (let offset = 12; offset < sourceBytes.length; ) {
    const size = sourceBytes.readUInt32LE(offset),
      type = sourceBytes.readUInt32LE(offset + 4);
    assert(offset + 8 + size <= sourceBytes.length, "Invalid GLB chunk length");
    if (type === 0x4e4f534a)
      sourceDoc = JSON.parse(
        sourceBytes
          .subarray(offset + 8, offset + 8 + size)
          .toString("utf8")
          .trim(),
      );
    offset += 8 + size;
  }
  assert(sourceDoc?.meshes?.length, "GLB contains no meshes");
  for (const resource of [
    ...(sourceDoc.buffers || []),
    ...(sourceDoc.images || []),
  ])
    assert(
      !resource.uri || resource.uri.startsWith("data:"),
      "External GLB resources are not allowed; embed buffers/textures first",
    );
}
const out = path.resolve(
  options.output ||
    path.join(
      root,
      "output/external-avatar-hair",
      sourcePath
        ? path.basename(sourcePath, path.extname(sourcePath))
        : "fixture-check",
    ),
);

// Only this bundle substitutes the production hair controller. Head attachment
// and replacement shader remain exactly the engine's actual implementation.
const hairModule = String.raw`
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {createSourceHairBuilder} from './src/features/avatar/renderer/hair-source-styles.js';
import {normalizeHairMaterial,createHairScalp,setHairScalpSkinTone} from './src/features/avatar/renderer/hair-materials.js';
let asset, maskCanvas, active;
const boxJSON=b=>({min:b.min.toArray(),max:b.max.toArray(),size:b.getSize(new THREE.Vector3()).toArray()});
export async function prepareExternalHair(character){
  asset=await new GLTFLoader().loadAsync('/external/hair.glb');
  const blob=await (await fetch('/avatar/v1/models/'+character+'-base-appearance-mask.png')).blob();
  const bitmap=await createImageBitmap(blob,{premultiplyAlpha:'none',colorSpaceConversion:'none'});
  const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);
  maskCanvas=canvas;bitmap.close();
}
export const externalHairState=()=>active?.report();
export const updateExternalHairFit=fit=>active?.setFit(fit);
export function createSculptedHairController(root,character,maskImage,options={}){
  let source,head;
  root.traverse(node=>{if(!source&&node.isSkinnedMesh)source=node;if(node.isBone&&node.name.toLowerCase()==='head')head=node});
  if(!source||!head||!asset)throw Error('The actual base model Head attachment is unavailable');
  const index=source.skeleton.bones.indexOf(head);
  if(index<0)throw Error('Head is absent from the source mesh skeleton');
  // Install the same protected-face hair weights as the current engine uses.
  // No generated style is built; only its actual source mask is reused.
  const maskBuilder=createSourceHairBuilder(source,maskCanvas,options.appearanceMask,{colorMask:options.colorMask,plainMask:options.plainMask});maskBuilder.dispose();
  const nativeBounds=new THREE.Box3(),positions=source.geometry.attributes.position,weights=source.geometry.attributes.avatarHairMask;
  let nativeVertices=0;
  for(let i=0;i<positions.count;i++){
    if(weights.getX(i)>.5){nativeBounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(positions,i));nativeVertices++}
  }
  if(nativeBounds.isEmpty())throw Error('Native hair mask has no matching vertices');
  const attachment=new THREE.Group();attachment.name='ExternalHairHeadAttachment';attachment.matrixAutoUpdate=false;
  attachment.matrix.copy(source.skeleton.boneInverses[index]).multiply(source.bindMatrix);
  head.add(attachment);
  const scalp=createHairScalp(source,maskCanvas);attachment.add(scalp);
  const pivot=new THREE.Group(),orientation=new THREE.Group(),external=clone(asset.scene);
  let rearCover,rearTriangles=0;
  if(window.externalHairRearCover){
    const indices=source.geometry.index.array,selected=[];
    for(let i=0;i<indices.length;i+=3){const tri=[indices[i],indices[i+1],indices[i+2]];
      if(tri.some(n=>weights.getX(n)>.5)&&tri.every(n=>positions.getZ(n)<.035))selected.push(...tri);
    }
    const geometry=source.geometry.clone();geometry.deleteAttribute('skinIndex');geometry.deleteAttribute('skinWeight');geometry.setIndex(selected);
    const points=geometry.attributes.position;
    for(let i=0;i<points.count;i++)points.setXYZ(i,points.getX(i)*.97,1.07+(points.getY(i)-1.07)*.97,-.014+(points.getZ(i)+.014)*.97);
    points.needsUpdate=true;geometry.computeBoundingSphere();
    rearCover=new THREE.Mesh(geometry,source.material.clone());rearCover.name='ExternalHairNativeRearCover';rearTriangles=selected.length/3;attachment.add(rearCover);
  }
  let vertices=0,triangles=0,meshes=0,skinnedMeshes=0;
  external.traverse(node=>{if(!node.isMesh)return;meshes++;if(node.isSkinnedMesh)skinnedMeshes++;node.geometry=node.geometry.clone();vertices+=node.geometry.attributes.position.count;triangles+=(node.geometry.index?.count||node.geometry.attributes.position.count)/3;node.material=Array.isArray(node.material)?node.material.map(m=>m.clone()):node.material.clone();for(const material of Array.isArray(node.material)?node.material:[node.material])normalizeHairMaterial(material);node.castShadow=false;node.receiveShadow=false;});
  orientation.add(external);pivot.add(orientation);
  let fit,sourceBounds,fittedBounds,current='external-hair',disposed=false;
  function setFit(next){
    fit=structuredClone(next);pivot.removeFromParent();pivot.position.set(0,0,0);pivot.scale.set(1,1,1);
    orientation.rotation.set(...fit.rotation.map(THREE.MathUtils.degToRad));pivot.updateMatrixWorld(true);
    sourceBounds=new THREE.Box3().setFromObject(pivot);
    const width=sourceBounds.getSize(new THREE.Vector3()).x;
    if(!(width>0))throw Error('External hair has no finite width');
    const uniform=(fit.width||nativeBounds.getSize(new THREE.Vector3()).x)/width;
    pivot.scale.set(...fit.scale.map(value=>value*uniform));pivot.updateMatrixWorld(true);
    const scaled=new THREE.Box3().setFromObject(pivot),center=scaled.getCenter(new THREE.Vector3()),target=nativeBounds.getCenter(new THREE.Vector3());
    pivot.position.set(target.x-center.x+fit.offset[0],nativeBounds.max.y-scaled.max.y+fit.offset[1],target.z-center.z+fit.offset[2]);pivot.updateMatrixWorld(true);
    fittedBounds=new THREE.Box3().setFromObject(pivot);attachment.add(pivot);root.updateMatrixWorld(true);
    return report();
  }
  function rearSurface(){attachment.updateWorldMatrix(true,true);const inverse=attachment.matrixWorld.clone().invert();return[.94,1,1.06,1.12,1.18].map(y=>{const origin=new THREE.Vector3(0,y,-2).applyMatrix4(attachment.matrixWorld),direction=new THREE.Vector3(0,0,1).transformDirection(attachment.matrixWorld);const hits=new THREE.Raycaster(origin,direction,0,20).intersectObject(external,true);return{bindY:y,firstHairZ:hits.length?hits[0].point.clone().applyMatrix4(inverse).z:null,intersections:hits.length}})}
  function report(){return{character,mode:current,headBone:head.name,headBoneIndex:index,attachmentMatrix:attachment.matrix.toArray(),nativeHairVertices:nativeVertices,nativeHairBounds:boxJSON(nativeBounds),externalSourceBounds:boxJSON(sourceBounds),fittedBindBounds:boxJSON(fittedBounds),fitTransform:{position:pivot.position.toArray(),scale:pivot.scale.toArray(),rotationRadians:orientation.rotation.toArray().slice(0,3)},externalMeshes:meshes,externalSkinnedMeshes:skinnedMeshes,externalVertices:vertices,externalTriangles:triangles,rearCoverTriangles:rearTriangles,skinSampleCount:scalp.userData.skinSampleCount,rearSurface:rearSurface(),fit}}
  const controller={
    supported:['external-hair','native-hair','bald-hair','curtain','bob','toben'],
    get current(){return current},
    get replacingSource(){return current!=='native-hair'},
    setStyle(style){current=style;pivot.visible=style!=='native-hair'&&style!=='bald-hair';scalp.visible=style!=='native-hair';if(rearCover)rearCover.visible=pivot.visible;return true},
    setHeadwear(){},setTone(){return true},setSkinTone(id){setHairScalpSkinTone(scalp,id)},setFit,report,
    dispose(){if(disposed)return;disposed=true;external.traverse(node=>{if(!node.isMesh)return;node.geometry.dispose();for(const m of Array.isArray(node.material)?node.material:[node.material])m.dispose()});if(rearCover){rearCover.geometry.dispose();rearCover.material.dispose()}scalp.geometry.dispose();scalp.material.dispose();attachment.removeFromParent();if(active===controller)active=null}
  };
  active=controller;setFit(window.externalHairInitialFit);return controller;
}`;
const entry = `
import {createAvatarStage} from './src/features/avatar/renderer/engine.js';
import {defaultAvatarLook} from './src/features/avatar/catalog.ts';
import {prepareExternalHair,externalHairState,updateExternalHairFit} from 'fixture:external-hair';
window.externalHairInitialFit=${JSON.stringify(fit)};
window.externalHairRearCover=${Boolean(options["rear-cover"])};
const cameraZoom=${JSON.stringify(cameraZoom)};
const qa=window.externalHairQa={stage:null,mode:'external-hair',angle:0,fit:window.externalHairInitialFit,
async init(){await prepareExternalHair('${character}');this.stage=await createAvatarStage(document.querySelector('#stage'),{...defaultAvatarLook('${character}'),hairStyle:this.mode,skinTone:${JSON.stringify(skinTone)}},{assetBaseUrl:'/avatar/v1/',maxPixelRatio:1});this.view(0);return this.report()},
view(angle,pose='idle',framing='hairStyle'){this.angle=angle;this.pose=pose;this.framing=framing;const applied=this.stage.setLook({hairStyle:this.mode,pose});if(!applied.applied)throw Error('Unsupported preview look: '+JSON.stringify(applied));this.stage.focusItem(framing);for(let i=0;i<cameraZoom[framing==='character'?'body':'hair'];i++)this.stage.zoom('out');this.stage.rotate(angle/22.5);this.stage.stop();return this.report()},
setMode(mode){this.mode=mode;return this.view(this.angle)},
setFit(fit){this.fit=fit;updateExternalHairFit(fit);this.view(this.angle);return this.report()},
report(){return{...externalHairState(),stage:this.stage?.stats,angle:this.angle,pose:this.pose,framing:this.framing}},capture(){return this.stage.capture()}};
document.querySelectorAll('[data-angle]').forEach(el=>el.onclick=()=>qa.view(Number(el.dataset.angle)));
document.querySelectorAll('[data-mode]').forEach(el=>el.onclick=()=>qa.setMode(el.dataset.mode));
document.querySelector('#fit').onsubmit=e=>{e.preventDefault();try{const data=new FormData(e.target),next={...qa.fit};for(const key of ['rotation','scale','offset']){next[key]=String(data.get(key)).split(',').map(Number);if(next[key].length!==3||!next[key].every(Number.isFinite))throw Error(key+' needs three numbers')}next.width=data.get('width')?Number(data.get('width')):null;if(next.scale.some(v=>v<=0)||next.width!==null&&!(next.width>0))throw Error('Scale and width must be positive');qa.setFit(next);document.querySelector('#report').textContent=JSON.stringify(qa.report(),null,2)}catch(error){document.querySelector('#report').textContent=error.message}};
qa.init().then(report=>{document.querySelector('#report').textContent=JSON.stringify(report,null,2);document.documentElement.dataset.ready='true'}).catch(error=>{window.externalHairError=error.stack;document.querySelector('#report').textContent=error.stack});
`;
const rendererDirectory = path.join(root, "src/features/avatar/renderer");
const sourceHashes = Object.fromEntries(
  await Promise.all(
    (await fs.readdir(rendererDirectory))
      .filter((name) => name.endsWith(".js"))
      .sort()
      .map(async (name) => [
        name,
        createHash("sha256")
          .update(await fs.readFile(path.join(rendererDirectory, name)))
          .digest("hex"),
      ]),
  ),
);
const bundle = await build({
  stdin: { contents: entry, loader: "js", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  define: { "import.meta.env.BASE_URL": '"/"' },
  plugins: [
    {
      name: "external-hair-fixture",
      setup(plugin) {
        plugin.onResolve(
          { filter: /(?:^fixture:external-hair$|\/hair-styles\.js$)/ },
          () => ({ path: "external-hair", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: hairModule,
          loader: "js",
          resolveDir: root,
        }));
      },
    },
  ],
});
if (options.check) {
  console.log(
    "PASS external GLB fixture compiles; production renderer files untouched.",
  );
  process.exit(0);
}
await fs.mkdir(out, { recursive: true });
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>외부 헤어 GLB 접합 검증</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f7fa;color:#172033;font:15px system-ui}main{display:flex;flex-wrap:wrap;gap:24px;padding:24px}#stage{width:${resolution}px;height:${resolution}px;max-width:100vw;background:#f5f7fa}aside{width:360px}button,input{font:inherit;min-height:44px;border:1px solid #cbd5e1;border-radius:6px;padding:8px;background:white}nav{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}label{display:grid;gap:4px;margin-block:12px}pre{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}.capture-only main{padding:0}.capture-only aside{display:none}</style><main><div id="stage"></div><aside><h1>외부 헤어 접합 검증</h1><nav>${[
  [0, "정면"],
  [90, "왼쪽"],
  [180, "후면"],
  [270, "오른쪽"],
]
  .map(([angle, label]) => `<button data-angle="${angle}">${label}</button>`)
  .join(
    "",
  )}</nav><nav><button data-mode="external-hair">외부 헤어</button><button data-mode="native-hair">기본 헤어</button><button data-mode="bald-hair">헤어 마스크</button></nav><form id="fit">${["rotation", "scale", "offset"].map((key) => `<label>${key} (X,Y,Z)<input name="${key}" value="${fit[key].join(",")}"></label>`).join("")}<label>목표 너비 (빈칸: 기본 머리 너비)<input name="width" value="${fit.width || ""}" inputmode="decimal"></label><button>접합 적용</button></form><pre id="report">실제 모델과 헤어를 불러오는 중…</pre></aside></main><script type="module" src="/fixture.js"></script></html>`;
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob:; worker-src 'self' blob:",
    );
    if (pathname === "/")
      return res
        .writeHead(200, { "Content-Type": "text/html;charset=utf-8" })
        .end(html);
    if (pathname === "/fixture.js")
      return res
        .writeHead(200, { "Content-Type": "text/javascript" })
        .end(bundle.outputFiles[0].contents);
    if (pathname === "/external/hair.glb")
      return res
        .writeHead(200, { "Content-Type": "model/gltf-binary" })
        .end(sourceBytes);
    if (pathname === "/favicon.ico") return res.writeHead(204).end();
    const base = path.resolve(root, "public/avatar/v1"),
      target = path.resolve(root, "public", "." + decodeURIComponent(pathname));
    if (!target.startsWith(base + path.sep)) return res.writeHead(403).end();
    res
      .writeHead(200, {
        "Content-Type": pathname.endsWith(".png")
          ? "image/png"
          : "model/gltf-binary",
      })
      .end(await fs.readFile(target));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
console.log(`EXTERNAL_HAIR_FIXTURE=${origin}\nEVIDENCE=${out}`);
if (options.serve) await new Promise(() => {});
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
const sharp = createRequire(path.join(root, "functions/package.json"))("sharp");
let browser;
const errors = [],
  captures = [];
try {
  browser = await playwright.chromium.launch({
    headless: true,
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
    args: ["--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({
    viewport: { width: resolution, height: resolution },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("**/*", (route) =>
    route.request().url().startsWith(origin) ||
    /^(blob|data):/.test(route.request().url())
      ? route.continue()
      : route.abort(),
  );
  await page.goto(origin);
  await page.evaluate(() =>
    document.documentElement.classList.add("capture-only"),
  );
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.ready === "true" ||
      window.externalHairError,
    undefined,
    { timeout: 60000 },
  );
  assert.equal(
    await page.evaluate(() => window.externalHairError),
    undefined,
    "External GLB loads on the actual base",
  );
  const views = [
    ["external-front", 0, "external-hair"],
    ["external-left", 90, "external-hair"],
    ["external-back", 180, "external-hair"],
    ["external-right", 270, "external-hair"],
    ["native-front", 0, "native-hair"],
    ["native-back", 180, "native-hair"],
    ["mask-front", 0, "bald-hair"],
    ["mask-back", 180, "bald-hair"],
    ["mask-left", 90, "bald-hair"],
    ["mask-right", 270, "bald-hair"],
    ["external-tilt", 0, "external-hair", "tilt"],
  ];
  if (options["full-body"])
    views.push(
      ["body-front", 0, "external-hair", "idle", "character"],
      ["body-left", 90, "external-hair", "idle", "character"],
      ["body-back", 180, "external-hair", "idle", "character"],
      ["body-right", 270, "external-hair", "idle", "character"],
      ["body-wave", 0, "external-hair", "wave", "character"],
      ["body-cheer", 0, "external-hair", "cheer", "character"],
      ["body-cheer-back", 180, "external-hair", "cheer", "character"],
    );
  for (const [
    name,
    angle,
    mode,
    pose = "idle",
    framing = "hairStyle",
  ] of views) {
    const report = await page.evaluate(
      ({ angle, mode, pose, framing }) => {
        window.externalHairQa.setMode(mode);
        return window.externalHairQa.view(angle, pose, framing);
      },
      { angle, mode, pose, framing },
    );
    const png = await page.evaluate(() => window.externalHairQa.capture());
    const buffer = Buffer.from(png.split(",")[1], "base64");
    await fs.writeFile(path.join(out, name + ".png"), buffer);
    captures.push({ name, report });
  }
  assert.deepEqual(errors, [], "No renderer or asset errors");
  const summary = {
    rendererSources: sourceHashes,
    rendererBundleSha256: createHash("sha256")
      .update(bundle.outputFiles[0].contents)
      .digest("hex"),
    input: {
      path: sourcePath,
      bytes: sourceBytes.length,
      sha256: createHash("sha256").update(sourceBytes).digest("hex"),
      meshes: sourceDoc.meshes.length,
      materials: sourceDoc.materials?.length || 0,
      textures: sourceDoc.textures?.length || 0,
    },
    character,
    skinTone,
    resolution,
    cameraZoom,
    fit,
    captures,
    errors,
    visualReviewRequired: true,
  };
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  const cell = 256,
    height = 280;
  const tiles = await Promise.all(
    captures.map(async ({ name }, index) => ({
      input: await sharp(
        Buffer.from(
          `<svg width="${cell}" height="${height}"><rect width="100%" height="100%" fill="#f5f7fa"/><text x="128" y="274" text-anchor="middle" font-family="Arial" font-size="13">${name}</text></svg>`,
        ),
      )
        .composite([
          {
            input: await sharp(path.join(out, name + ".png"))
              .resize(cell, cell)
              .toBuffer(),
            left: 0,
            top: 0,
          },
        ])
        .png()
        .toBuffer(),
      left: (index % 3) * cell,
      top: Math.floor(index / 3) * height,
    })),
  );
  await sharp({
    create: {
      width: cell * 3,
      height: height * Math.ceil(captures.length / 3),
      channels: 4,
      background: "#f5f7fa",
    },
  })
    .composite(tiles)
    .png()
    .toFile(path.join(out, "contact-sheet.png"));
  await sharp({
    create: { width: cell * 3, height, channels: 4, background: "#f5f7fa" },
  })
    .composite(tiles.slice(0, 3))
    .png()
    .toFile(path.join(out, "three-views.png"));
  if (options.compare) {
    const referenceDirectory = path.resolve(options.compare);
    const reference = JSON.parse(
      await fs.readFile(path.join(referenceDirectory, "report.json"), "utf8"),
    );
    for (const field of [
      "character",
      "skinTone",
      "resolution",
      "cameraZoom",
      "fit",
      "rendererBundleSha256",
    ])
      assert.deepEqual(
        summary[field],
        reference[field],
        `Comparison must use the same ${field}`,
      );
    assert.deepEqual(
      summary.captures.map((item) => item.name),
      reference.captures.map((item) => item.name),
    );
    const comparisons = [];
    for (const capture of captures) {
      const previous = reference.captures.find(
        (item) => item.name === capture.name,
      );
      for (const field of [
        "fitTransform",
        "externalVertices",
        "externalTriangles",
        "fittedBindBounds",
      ])
        assert.deepEqual(
          capture.report[field],
          previous.report[field],
          `${capture.name} preserves ${field}`,
        );
      const before = await sharp(
        path.join(referenceDirectory, capture.name + ".png"),
      )
        .ensureAlpha()
        .raw()
        .toBuffer();
      const after = await sharp(path.join(out, capture.name + ".png"))
        .ensureAlpha()
        .raw()
        .toBuffer();
      assert.equal(before.length, after.length);
      let alphaChanged = 0,
        rgbDifference = 0,
        visible = 0;
      for (let i = 0; i < before.length; i += 4) {
        if (before[i + 3] !== after[i + 3]) alphaChanged++;
        if (Math.min(before[i + 3], after[i + 3]) > 16) {
          visible++;
          for (let c = 0; c < 3; c++)
            rgbDifference += Math.abs(before[i + c] - after[i + c]);
        }
      }
      const alphaChangedFraction = alphaChanged / (before.length / 4),
        meanAbsRgbDifference = rgbDifference / Math.max(1, visible * 3);
      assert(
        alphaChangedFraction <= 0.01,
        `${capture.name}: silhouette changed`,
      );
      assert(
        meanAbsRgbDifference <= 12,
        `${capture.name}: excessive texture difference`,
      );
      comparisons.push({
        name: capture.name,
        alphaChangedFraction,
        meanAbsRgbDifference,
      });
    }
    await fs.writeFile(
      path.join(out, "comparison.json"),
      JSON.stringify(
        {
          reference: referenceDirectory,
          originalAsset: reference.input,
          optimizedAsset: summary.input,
          fitAndGeometryEquivalent: true,
          comparisons,
          visualReviewRequired: true,
        },
        null,
        2,
      ) + "\n",
    );
    await sharp({
      create: {
        width: cell * 3,
        height: height * 2,
        channels: 4,
        background: "#f5f7fa",
      },
    })
      .composite([
        {
          input: path.join(referenceDirectory, "three-views.png"),
          left: 0,
          top: 0,
        },
        { input: path.join(out, "three-views.png"), left: 0, top: height },
      ])
      .png()
      .toFile(path.join(out, "original-optimized-comparison.png"));
    console.log(
      "PASS identical fitting geometry and silhouette; texture comparison saved for visual review.",
    );
  }
  console.log(
    `PASS external GLB loaded on Head; ${captures.length} actual renders saved. Visual fit still requires review.`,
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
