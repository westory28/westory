import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const ExcelJS = require("exceljs");
const JSZip = require("jszip");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const out = path.resolve(
  process.env.SCORE_ARCHIVE_QA_EVIDENCE_DIR ||
    path.join(root, "..", "evidence", "score-archive-download"),
);
await fs.mkdir(out, { recursive: true });
const source = (name) => path.join(root, "src", name).replaceAll("\\", "/");
const mocks = {
  "qa-state": `
export const docs = new Map(), reads = [], writes = [], calls = [], toasts = [];
export const ref = path => ({path, id:path.split('/').at(-1), firestore:{}});
export const snap = reference => ({...reference, ref:reference, exists:()=>docs.has(reference.path), data:()=>structuredClone(docs.get(reference.path))});
const image = color => {
  const canvas=document.createElement('canvas'); canvas.width=120; canvas.height=60;
  const ctx=canvas.getContext('2d'); ctx.strokeStyle=color; ctx.lineWidth=5;
  ctx.beginPath(); ctx.moveTo(10,20); ctx.lineTo(30,45); ctx.lineTo(100,10); ctx.stroke();
  return canvas.toDataURL('image/png');
};
const images = {red:image('red'), blue:image('blue'), green:image('green')};
for(let index=1;index<=32;index++) docs.set('users/qa-'+index,{role:'student',grade:'3',class:'12',number:String(33-index),studentName:'현재학기이름'+index,enrollmentStatus:'transferred'});
for(let order=1;order<=2;order++) {
  const id='archive-assessment-'+order;
  const item={name:order===1?'가상 사료 해석':'가상 역사 논술',itemKey:'assessment-'+order,maxScore:order===1?15:35,scoreEntered:true};
  const roster={id,title:item.name,scoreKind:'performance',subject:'역사',academicYear:'2025',semester:'1',assessmentOrder:order,targetGrade:'2',targetClass:'1',classes:['1'],items:[item],totalMaxScore:item.maxScore,rowCount:32,matchedCount:32,unmatchedCount:0,sourceFileName:'synthetic.xlsx',uploadedBy:'qa-teacher',uploadedByEmail:'qa-teacher@example.test',rows:[]};
  for(let index=1;index<=32;index++) {
    const row={rowNumber:index,uid:'qa-'+index,grade:'2',class:'1',number:String(index),studentName:'이전학생'+String(index).padStart(2,'0'),matchStatus:'matched',items:[{...item,score:1}],enteredScoreCount:1,totalScore:1,totalMaxScore:item.maxScore,feedback:''};
    roster.rows.push(row);
    const points=index===32?0:order===1?12:30;
    const record={...row,rosterId:id,title:roster.title,scoreKind:'performance',subject:'역사',assessmentOrder:order,academicYear:'2025',semester:'1',items:[{...item,score:points}],totalScore:points,updatedAt:{seconds:1750000000,nanoseconds:0}};
    const scorePath='users/'+row.uid+'/performance_scores/'+id;
    docs.set(scorePath,record);
    docs.set(scorePath+'/confirmations/'+row.uid,{uid:row.uid,rosterId:id,signatureName:row.studentName,signatureImage:images[order===1?'red':'blue'],scoreUpdatedAt:record.updatedAt,confirmedAt:{seconds:1750000000+order,nanoseconds:0}});
  }
  docs.set('years/2025/semesters/1/performance_score_rosters/'+id,roster);
  docs.set('years/2026/semesters/2/performance_score_rosters/current-'+order,{...roster,id:'current-'+order,title:'현재학기 평가',academicYear:'2026',semester:'2'});
}
window.scoreArchiveQa={docs,reads,writes,calls,toasts,images};`,
  "qa-auth": `export const useAuth=()=>({userData:{role:'teacher'},currentUser:{uid:'qa-teacher',displayName:'가상교사',email:'qa-teacher@example.test'},config:{year:'2026',semester:'2'}});`,
  "qa-sdk": `
import {docs,ref,snap,reads,writes} from 'qa-state';
export const collection=(db,...parts)=>ref(parts.join('/'));
export const doc=(db,...parts)=>ref(parts.join('/'));
export const collectionGroup=(db,group)=>({group});
export const query=(base,...filters)=>({...base,filters});
export const where=(field,op,value)=>({field,op,value});
export const orderBy=(...order)=>({order});
export const getDoc=async(reference)=>{reads.push({op:'getDoc',path:reference.path});if(window.scoreArchiveQa.rejectConfirmationReads && reference.path.includes('/confirmations/'))throw new Error('synthetic confirmation read denied');return snap(reference);};
export const getDocFromServer=getDoc;
export const getDocs=async(reference)=>{
  reads.push({op:'getDocs',path:reference.path,group:reference.group});
  let found=[...docs].filter(([key])=>reference.group?key.split('/').at(-2)===reference.group:key.startsWith(reference.path+'/')&&!key.slice(reference.path.length+1).includes('/'));
  for(const filter of reference.filters||[]) if(filter.field) found=found.filter(([,data])=>filter.op==='=='?data[filter.field]===filter.value:true);
  const items=found.map(([key])=>snap(ref(key)));
  return {docs:items,empty:!items.length,size:items.length,forEach:fn=>items.forEach(fn)};
};
export const getDocsFromServer=getDocs;
const write=(...args)=>{writes.push(args);throw new Error('Unexpected SDK write');};
export const addDoc=write,setDoc=write,updateDoc=write,deleteDoc=write,writeBatch=write,runTransaction=write,executeWrite=write;
export class WriteBatch {constructor(){write();}}
export class Transaction {constructor(){write();}}
export const serverTimestamp=()=>({seconds:1800000000});
export const deleteField=()=>({__delete:true});`,
  "qa-firebase": `import {calls} from 'qa-state';import {assertArchiveWritable} from '${source("lib/semesterArchive")}';export const db={};export const getHttpsCallable=async(name)=>{calls.push(name);assertArchiveWritable();throw new Error('Unexpected callable');};`,
  "qa-student-commands": `import {calls} from 'qa-state';import {assertArchiveWritable} from '${source("lib/semesterArchive")}';export const callStudentDataService=async(name)=>{calls.push(name);assertArchiveWritable();throw new Error('Unexpected student command');};`,
  "qa-notifications": `export const createManagedNotifications=async()=>{throw new Error('Unexpected notification');};export const reviewPerformanceScoreObjection=createManagedNotifications;`,
  "qa-toast": `import{toasts}from'qa-state';export const useAppToast=()=>({showToast:payload=>{toasts.push(payload);document.getElementById('qa-toast').textContent=payload.title+' '+(payload.message||'');}});`,
};
const bundle = await build({
  stdin: {
    contents: `import React from'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import Manager from'${source("pages/teacher/components/PerformanceScoreManager")}';import{AppDialogProvider}from'${source("components/common/AppDialogProvider")}';import'qa-state';createRoot(document.getElementById('root')).render(<BrowserRouter><AppDialogProvider><Manager/></AppDialogProvider></BrowserRouter>);`,
    loader: "tsx",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  metafile: true,
  format: "esm",
  platform: "browser",
  loader: { ".css": "empty" },
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.BASE_URL": '"/"',
  },
  plugins: [
    {
      name: "isolated-archive-fixture",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path: request }) => {
          const value = request.replaceAll("\\", "/");
          if (value === "firebase/firestore")
            return { path: source("lib/archiveFirestore.ts") };
          const id =
            value in mocks
              ? value
              : value === "@firebase/firestore"
                ? "qa-sdk"
                : /contexts\/AuthContext$/.test(value)
                  ? "qa-auth"
                  : /lib\/firebase$/.test(value) || value === "./firebase"
                    ? "qa-firebase"
                    : /studentProfileCommands$/.test(value)
                      ? "qa-student-commands"
                      : /lib\/notifications$/.test(value)
                        ? "qa-notifications"
                        : /AppToastProvider$/.test(value)
                          ? "qa-toast"
                          : null;
          return id ? { path: id, namespace: "qa" } : undefined;
        });
        builder.onLoad({ filter: /.*/, namespace: "qa" }, ({ path: id }) => ({
          contents: mocks[id],
          loader: "tsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
assert.equal(
  Object.keys(bundle.metafile.inputs).filter((file) =>
    /node_modules[\\/](?:firebase|@firebase)[\\/]/.test(file),
  ).length,
  0,
  "No real Firebase SDK may reach this fixture",
);
for (const name of ["semesterArchive", "semesterScope", "archiveFirestore"])
  assert.ok(
    Object.keys(bundle.metafile.inputs).some((file) =>
      file.endsWith(`/lib/${name}.ts`),
    ),
    `Use real ${name}`,
  );

const template = await fs.readFile(
  path.join(
    root,
    "public/templates/performance-score-class-sheet-template.xlsx",
  ),
);
const css = (
  await Promise.all(
    [
      "assets/css/style.css",
      "src/assets/index.css",
      "src/pages/teacher/components/performance-score-list.css",
    ].map((file) => fs.readFile(path.join(root, file), "utf8")),
  )
)
  .join("\n")
  .replace(/@import[^;]+;/g, "")
  .replace(/@tailwind[^;]+;/g, "");
const html = `<!doctype html><html lang="ko"><meta charset="UTF-8"><style>${css}</style><div id="root"></div><div id="qa-toast" role="status"></div><script type="module" src="/fixture.js"></script></html>`;
const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/templates/")) {
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.end(template);
    return;
  }
  res.setHeader(
    "Content-Type",
    req.url === "/fixture.js" ? "text/javascript" : "text/html; charset=utf-8",
  );
  res.end(req.url === "/fixture.js" ? bundle.outputFiles[0].text : html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = {
  kind: "archive-performance-download",
  checks: [],
  pageErrors: [],
  blockedRequests: [],
  limitations: [
    "Synthetic in-memory Firestore and auth; actual production data/persistence are not asserted.",
    "Real archive routing, read-only facade, score/signature loading, and XLSX builder run in a browser. No Firebase SDK or external network is available.",
  ],
};
let browser;
let page;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SCORE_QA_BROWSER_CHANNEL
      ? { channel: process.env.SCORE_QA_BROWSER_CHANNEL }
      : process.platform === "win32"
        ? { channel: "msedge" }
        : {}),
  });
  page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(origin)) return route.continue();
    report.blockedRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto(`${origin}/?archiveYear=2025&archiveSemester=1`);
  await page.getByRole("button", { name: "일람표", exact: true }).click();
  const panel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "일람표 다운로드", exact: true }),
  });
  await panel
    .getByRole("combobox", { name: "학년", exact: true })
    .selectOption("2");
  await page.getByRole("button", { name: "현황 조회", exact: true }).click();
  const student = page.getByRole("row").filter({ hasText: "이전학생01" });
  await student.getByText("확인 완료", { exact: true }).waitFor();
  assert.equal(
    await student
      .getByRole("img", { name: "이전학생01 서명", exact: true })
      .getAttribute("src"),
    await page.evaluate(() => window.scoreArchiveQa.images.blue),
  );
  assert.equal(
    await page.getByText("현재학기이름1", { exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("row")
      .filter({ hasText: /이전학생\d{2}/ })
      .count(),
    32,
  );
  report.checks.push(
    "Archive URL overrides current 2026/2 config to 2025/1; 32 historical grade 2/class 1 identities survive current grade 3/class 12 and transferred profiles.",
  );
  const before = await page.evaluate(() => ({
    docs: JSON.stringify([...window.scoreArchiveQa.docs]),
    reads: window.scoreArchiveQa.reads,
  }));
  assert.ok(
    before.reads.some(
      (read) =>
        read.path === "years/2025/semesters/1/performance_score_rosters",
    ),
  );
  assert.equal(
    before.reads.some(
      (read) =>
        read.path?.startsWith("years/2026/") ||
        read.path === "users" ||
        read.group,
    ),
    false,
  );
  for (let order = 1; order <= 2; order++)
    for (let index = 1; index <= 32; index++) {
      const scorePath = `users/qa-${index}/performance_scores/archive-assessment-${order}`;
      assert.ok(
        before.reads.some((read) => read.path === scorePath),
        scorePath,
      );
      assert.ok(
        before.reads.some(
          (read) => read.path === `${scorePath}/confirmations/qa-${index}`,
        ),
        `${scorePath} confirmation`,
      );
    }
  // Simulate a later student signature after the preview. Download must reread it.
  await page.evaluate(() => {
    const qa = window.scoreArchiveQa;
    for (let index = 1; index <= 32; index++) {
      const key = `users/qa-${index}/performance_scores/archive-assessment-1/confirmations/qa-${index}`;
      qa.docs.set(key, {
        ...qa.docs.get(key),
        signatureImage: qa.images.green,
        confirmedAt: { seconds: 1750000100, nanoseconds: 0 },
      });
    }
  });
  const afterFixtureUpdate = await page.evaluate(() =>
    JSON.stringify([...window.scoreArchiveQa.docs]),
  );
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "일람표 다운로드", exact: true })
    .click();
  const download = await downloaded;
  assert.equal(
    download.suggestedFilename(),
    "2025학년도 1학기 2학년 역사과 수행평가 일람표 1반.xlsx",
  );
  const saved = path.join(out, "synthetic-archive-class-sheet.xlsx");
  await download.saveAs(saved);
  await page
    .getByRole("status")
    .filter({ hasText: "일람표를 다운로드했습니다." })
    .waitFor();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(saved);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell("D7").value, "이전학생01");
  assert.equal(sheet.getCell("D38").value, "이전학생32");
  assert.equal(
    sheet.getCell("E7").value,
    12,
    "UID score document overrides stale roster score 1",
  );
  assert.equal(sheet.getCell("G7").value, 30);
  assert.equal(sheet.getCell("H7").value, 42);
  for (const cell of ["E38", "G38", "H38"])
    assert.equal(
      sheet.getCell(cell).value,
      0,
      `Preserve entered zero at ${cell}`,
    );
  const allText = [];
  sheet.eachRow((row) =>
    row.eachCell((cell) => {
      if (cell.value !== null) allText.push(cell.text);
    }),
  );
  assert.ok(
    allText.some((text) => text.includes("/확인 불가/")),
    "Archive print footer must disclose unavailable IP",
  );
  assert.equal(
    allText.some((text) => text.includes("현재학기")),
    false,
  );
  const images = sheet.getImages();
  assert.equal(images.length, 32);
  const firstImage = images.find((image) => image.range.tl.nativeRow === 6);
  assert.ok(firstImage);
  const encoded =
    "data:image/png;base64," +
    Buffer.from(workbook.getImage(firstImage.imageId).buffer).toString(
      "base64",
    );
  const color = await page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const sums = [0, 0, 0];
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i + 3] > 20)
        for (let channel = 0; channel < 3; channel++)
          sums[channel] += pixels[i + channel];
    return ["red", "green", "blue"][sums.indexOf(Math.max(...sums))];
  }, encoded);
  assert.equal(
    color,
    "green",
    "Download must include freshly reread latest first-assessment signature",
  );
  report.checks.push(
    "Actual XLSX has historical filename, all 32 names, UID document scores 12/30 (not stale roster 1/1), real zeros, 32 valid signatures, newest signature PNG pixels, and unavailable-IP footer.",
  );
  const zip = await JSZip.loadAsync(await fs.readFile(saved));
  const styles = await zip.file("xl/styles.xml").async("string");
  const xml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  const borders = [
    ...styles.matchAll(/<border\b[^>]*(?:\/>|>[\s\S]*?<\/border>)/g),
  ].map((match) => match[0]);
  const xfs = [
    ...styles
      .match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)[1]
      .matchAll(/<xf\b[^>]*>/g),
  ].map((match) => Number(match[0].match(/\bborderId="(\d+)"/)?.[1] || 0));
  const cells = new Map(
    [...xml.matchAll(/<c\b[^>]*>/g)].map((match) => [
      match[0].match(/\br="([A-Z]+\d+)"/)?.[1],
      Number(match[0].match(/\bs="(\d+)"/)?.[1] || 0),
    ]),
  );
  const edge = (address, side, expected) =>
    assert.equal(
      borders[xfs[cells.get(address)]]?.match(
        new RegExp(`<${side}\\b[^>]*\\bstyle="([^"]+)"`),
      )?.[1],
      expected,
      `${address}.${side}`,
    );
  for (let row = 7; row < 38; row++)
    for (const column of "BCDEFGHIJKLM") {
      edge(`${column}${row}`, "bottom", "hair");
      edge(`${column}${row + 1}`, "top", "hair");
    }
  for (let row = 6; row <= 41; row++) {
    edge(`F${row}`, "right", "hair");
    edge(`G${row}`, "left", "hair");
    edge(`B${row}`, "left", "thin");
    edge(`M${row}`, "right", "thin");
  }
  report.checks.push(
    "Final XLSX OOXML preserves F/G internal hair separators, every B:M student-row hair separator, and thin outer borders.",
  );
  assert.equal(
    await page.evaluate(() => JSON.stringify([...window.scoreArchiveQa.docs])),
    afterFixtureUpdate,
    "Application must not mutate any fixture document",
  );
  assert.deepEqual(
    await page.evaluate(() => window.scoreArchiveQa.calls),
    [],
    "Archive download must skip all callables, including getPrintClientInfo",
  );
  assert.deepEqual(await page.evaluate(() => window.scoreArchiveQa.writes), []);
  let unexpectedDownloads = 0;
  page.on("download", () => unexpectedDownloads++);
  await page.evaluate(
    () => (window.scoreArchiveQa.rejectConfirmationReads = true),
  );
  await page
    .getByRole("button", { name: "일람표 다운로드", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "일람표 다운로드에 실패했습니다." })
    .waitFor();
  assert.equal(
    unexpectedDownloads,
    0,
    "Unreadable confirmations must never silently produce an unsigned workbook",
  );
  assert.deepEqual(await page.evaluate(() => window.scoreArchiveQa.calls), []);
  assert.deepEqual(await page.evaluate(() => window.scoreArchiveQa.writes), []);
  assert.equal(
    await page.evaluate(() => JSON.stringify([...window.scoreArchiveQa.docs])),
    afterFixtureUpdate,
  );
  report.checks.push(
    "Zero callable/SDK-write attempts and unchanged fixture documents. Denied direct confirmation reads stop export with an explicit error and no download.",
  );
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.blockedRequests, []);
  report.download = download.suggestedFilename();
  report.status = "passed";
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    `PASS archive score download: ${report.checks.length} checks; ${path.join(out, "report.json")}`,
  );
} catch (error) {
  report.status = "failed";
  report.failure = error.message;
  report.fixtureState = await page
    ?.evaluate(() => ({
      body: document.body.innerText,
      reads: window.scoreArchiveQa?.reads,
      toasts: window.scoreArchiveQa?.toasts,
    }))
    .catch(() => null);
  await fs.writeFile(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
