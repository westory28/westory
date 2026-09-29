/** Actual teacher components + production CSS; only Auth/Firebase use fixtures. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
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
const evidence = path.join(
  root,
  ".superloopy/sessions/weplay-settings-20260929/evidence",
);
await fs.mkdir(evidence, { recursive: true });
const baselineOnly = process.argv.includes("--baseline-only");
const headersOnly = process.argv.includes("--headers-only");
const baseline = "cd1d1683a66594e5ea4c2137d229e35ee73b4672";
const m = (relative) =>
  JSON.stringify(path.join(root, relative).replaceAll("\\", "/"));
const core = require(path.join(root, "functions/weplayCore.js"));
const sourceLessons = [
  {
    unitId: "public-1",
    title: "조선의 문화",
    isVisibleToStudents: true,
    wordCount: 3,
    words: ["훈민정음", "집현전", "경국대전"],
  },
  {
    unitId: "public-2",
    title: "삼국의 발전과 통일",
    isVisibleToStudents: true,
    wordCount: 3,
    words: ["고구려", "백제", "신라"],
  },
  {
    unitId: "private-1",
    title: "다음 수업 준비 자료",
    isVisibleToStudents: false,
    wordCount: 3,
    words: ["비공개정답", "고려", "발해"],
  },
];
const previewWords = Object.fromEntries(
  ["mild", "medium", "spicy"].map((difficulty) => [
    difficulty,
    Object.fromEntries(
      Array.from({ length: 7 }, (_, index) => index + 1).map((mask) => {
        const selected = sourceLessons.filter(
          (_, index) => mask & (1 << index),
        );
        return [
          selected.map((lesson) => lesson.unitId).join(","),
          core.buildWords(
            selected.flatMap((lesson) =>
              lesson.words.map((text) => ({
                text,
                unitId: lesson.unitId,
                lessonTitle: lesson.title,
                context: "교사가 준비한 수업 문장",
              })),
            ),
            "teacher-qa",
            difficulty,
          ),
        ];
      }),
    ),
  ]),
);
const service = `
const params=new URLSearchParams(location.search);
export const view=params.get("view")||"management";
export const config={year:"2026",semester:"2"};
const readonly=view.includes("readonly");
const denied=view==="denied";
const headerRole=view.startsWith("header-")?view.slice(7):null;
export const userData={uid:"qa-teacher",role:readonly||denied||(headerRole&&headerRole!=="teacher")?"student":"teacher",teacherPortalEnabled:!denied&&headerRole!=="student",staffPermissions:headerRole==="lesson"?["lesson_read"]:headerRole==="points"?["point_read"]:readonly?["point_read","lesson_read"]:[],email:"qa@example.invalid",name:"검증 교사"};
const currentUser={uid:"qa-teacher",email:"qa@example.invalid"};
export const useAuth=()=>({config,currentUser,userData,interfaceConfig:{},refreshInterfaceConfig:async()=>{},logout:async()=>{},menuConfig:null,menuConfigReady:true,loading:false,configReady:true});
const policy=${JSON.stringify(core.DEFAULT_POLICY)};
const originalLessons=${JSON.stringify(sourceLessons)};
const previewWords=${JSON.stringify(previewWords)};
export const qa=window.weplayTeacherQa={calls:[],writes:[],fail:{},hold:{},settings:${JSON.stringify(core.DEFAULT_GAME_SETTINGS)},lessons:structuredClone(originalLessons),policy};
if(view==="empty")qa.lessons=[];
if(view==="load-error")qa.fail.getWeplayManagement=1;
if(view==="loading")qa.hold.getWeplayManagement=true;
if(view==="removed-source")qa.settings={enabled:true,sourceMode:"selected",unitIds:["public-1","deleted-unit"],version:3};
const management=()=>({settings:structuredClone(qa.settings),lessons:structuredClone(qa.lessons),availableWordCount:qa.lessons.filter(lesson=>lesson.isVisibleToStudents&&(qa.settings.sourceMode==="all"||qa.settings.unitIds.includes(lesson.unitId))).reduce((sum,lesson)=>sum+lesson.wordCount,0),previewWordCount:qa.lessons.reduce((sum,lesson)=>sum+lesson.wordCount,0)});
export const getHttpsCallable=async name=>async data=>{
  qa.calls.push({name,data:structuredClone(data)});
  if(qa.hold[name])await new Promise(resolve=>{qa.release=resolve});
  if(qa.fail[name]){qa.fail[name]--;const error=new Error(qa.errorCode==="functions/aborted"?"다른 교사가 설정을 변경했습니다.":"QA 연결 오류");error.code=qa.errorCode||"functions/unavailable";throw error;}
  if(name==="getWeplayManagement")return {data:management()};
  if(name==="saveWeplayGameSettings"){qa.settings={...data.settings,version:qa.settings.version+1};qa.writes.push({name,data:structuredClone(data)});return {data:management()};}
  if(name==="previewWeplayGame"){
    qa.preview=structuredClone(data);
    const response=await fetch('/preview',{method:'POST',body:JSON.stringify({...data,now:Date.now()})});
    qa.session=await response.json();
    return {data:structuredClone(qa.session)};
  }
  if(name==="getWeplayPolicy")return {data:{policy:structuredClone(qa.policy),currentRankingPeriod:null}};
  if(name==="saveWeplayPolicy"){qa.policy=structuredClone(data.policy);qa.writes.push({name,data:structuredClone(data)});return {data:{policy:structuredClone(qa.policy),currentRankingPeriod:null}};}
  throw new Error("Unexpected callable in teacher QA: "+name);
};
export const db={};
export const getFirebaseStorage=async()=>({});
`;
const firestore = `
export * from "fixture:real-firestore";
import {qa} from "fixture:service";
export const doc=(_db,...parts)=>({path:parts.join("/")});
export const collection=(_db,...parts)=>({path:parts.join("/")});
export const query=(ref,...clauses)=>({...ref,clauses});
export const where=(...args)=>args;
export const orderBy=(...args)=>args;
export const limit=(...args)=>args;
const snapshot=()=>({exists:()=>false,data:()=>undefined,docs:[],size:0,empty:true,forEach:()=>{}});
export const getDoc=async()=>snapshot();
export const getDocs=async()=>snapshot();
export const onSnapshot=(_ref,fn)=>{fn(snapshot());return ()=>{};};
export const serverTimestamp=()=>({seconds:0});
export const setDoc=async(ref,data)=>{qa.writes.push({name:"setDoc",path:ref.path,data})};
export const deleteDoc=async()=>{throw new Error("Unexpected deletion")};
`;
const priorPoints = execFileSync(
  "git",
  ["show", `${baseline}:src/pages/teacher/ManagePoints.tsx`],
  { cwd: root, encoding: "utf8" },
);
const priorPolicy = execFileSync(
  "git",
  [
    "show",
    `${baseline}:src/pages/teacher/components/points/PointPolicyTab.tsx`,
  ],
  { cwd: root, encoding: "utf8" },
);
let hasManagement = true;
try {
  await fs.access(path.join(root, "src/pages/teacher/ManageWeplay.tsx"));
} catch {
  hasManagement = false;
}
if (!baselineOnly)
  assert(hasManagement, "ManageWeplay.tsx must exist before full QA");
const harness = `
import React from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter} from "react-router-dom";
import Header from ${m("src/components/common/Header.tsx")};
import {canAccessTeacherPath} from ${m("src/lib/permissions.ts")};
import CurrentPoints from ${m("src/pages/teacher/ManagePoints.tsx")};
import PriorPoints from "fixture:prior-points";
${hasManagement ? `import ManageWeplay from ${m("src/pages/teacher/ManageWeplay.tsx")};` : "const ManageWeplay=()=>null;"}
import {AppToastProvider} from ${m("src/components/common/AppToastProvider.tsx")};
import {AppDialogProvider} from ${m("src/components/common/AppDialogProvider.tsx")};
import ${m("src/assets/index.css")};
import ${m("src/components/layout/teacherLayout.css")};
import ${m("src/pages/teacher/teacherSettings.css")};
import {view,qa,userData} from "fixture:service";
qa.routeAllowed=canAccessTeacherPath("/teacher/weplay",userData,"qa@example.invalid");
const policyView=view.startsWith("policy");
const initialRoute=policyView?"/teacher/points?tab=policy"+(view.includes("deep")?"&section=policy-weplay":""):"/teacher/weplay";
function Fixture(){return <MemoryRouter initialEntries={[initialRoute]}><AppToastProvider><AppDialogProvider><div className="teacher-layout flex min-h-screen flex-col bg-gray-50">{view.startsWith("header-")?<Header teacherLayout/>:<><aside className="teacher-sidebar" aria-label="QA 전체 메뉴"><strong>Westory</strong><span>전체 메뉴 위치 검증</span></aside><div className="qa-account" aria-label="QA 계정 영역">검증 교사</div><main className="min-h-0 w-full flex-1">{view==="policy-before"?<PriorPoints/>:policyView?<CurrentPoints/>:<ManageWeplay/>}</main></>}</div></AppDialogProvider></AppToastProvider></MemoryRouter>}
createRoot(document.getElementById("root")).render(<Fixture/>);
`;
const bundled = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(os.tmpdir(), "weplay-teacher-fixture.js"),
  loader: { ".svg": "dataurl" },
  external: ["/assets/*"],
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "teacher-qa-boundary",
      setup(plugin) {
        plugin.onResolve({ filter: /^fixture:real-firestore$/ }, () => ({
          path: require.resolve("firebase/firestore"),
        }));
        plugin.onResolve({ filter: /^fixture:/ }, (args) => ({
          path: args.path.slice(8),
          namespace: "fixture",
        }));
        plugin.onResolve(
          { filter: /components\/points\/PointPolicyTab$/ },
          (args) =>
            args.importer === "prior-points"
              ? { path: "prior-policy", namespace: "fixture" }
              : undefined,
        );
        plugin.onResolve({ filter: /(?:^|\/)contexts\/AuthContext$/ }, () => ({
          path: "service",
          namespace: "fixture",
        }));
        plugin.onResolve(
          { filter: /(?:^|\/)lib\/firebase$|^\.\/firebase$/ },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onResolve({ filter: /^firebase\/firestore$/ }, () => ({
          path: "firestore",
          namespace: "fixture",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents:
            args.path === "service"
              ? service
              : args.path === "firestore"
                ? firestore
                : args.path === "prior-points"
                  ? priorPoints
                  : priorPolicy,
          loader: "tsx",
          resolveDir:
            args.path === "prior-points"
              ? path.join(root, "src/pages/teacher")
              : args.path === "prior-policy"
                ? path.join(root, "src/pages/teacher/components/points")
                : root,
        }));
      },
    },
  ],
});
const js = bundled.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundled.outputFiles
  .find((file) => file.path.endsWith(".css"))
  .text.replace(/@import\s+[^;]+;/g, "");
const tailwind = await fs
  .readFile(path.join(os.tmpdir(), "westory-qa-tailwind.js"), "utf8")
  .catch(async () => {
    const response = await fetch("https://cdn.tailwindcss.com");
    assert(response.ok);
    return response.text();
  });
const html =
  '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/qa.css"><style>.qa-account{height:var(--teacher-account-height,48px);flex-shrink:0;display:flex;align-items:center;justify-content:flex-end;padding:0 24px}.teacher-sidebar{gap:16px}@media(max-width:1023px){.qa-account{height:88px}}</style></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>';
const server = http.createServer(async (request, response) => {
  if (request.url === "/preview") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks).toString());
    const settings = core.validateGameSettings(data.settings);
    const lessons = sourceLessons.map((lesson) => ({
      ...lesson,
      contentHtml: lesson.words.map((word) => `[${word}]`).join(" "),
    }));
    const config = settings.difficulties[data.difficulty];
    const words = core.buildWords(
      core.gameCatalog(lessons, settings),
      "settings-qa",
      data.difficulty,
      config,
    );
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        id: "teacher-preview-" + data.now,
        mode: "practice",
        difficulty: data.difficulty,
        difficultySettings: config,
        status: "active",
        battleVersion: 1,
        acceptedEvents: [],
        startsAtMs: data.now + 3000,
        endsAtMs: data.now + 3000 + config.durationSeconds * 1000,
        serverNowMs: data.now,
        words,
        acceptedWordIds: [],
        correctCount: 0,
        policy: core.DEFAULT_POLICY,
        result: null,
      }),
    );
    return;
  }
  const name = new URL(request.url, "http://127.0.0.1").pathname;
  if (name.startsWith('/assets/')) {
    const target = path.resolve(root, 'public', '.' + name);
    if (!target.startsWith(path.join(root, 'public') + path.sep)) { response.writeHead(400); response.end(); return; }
    response.setHeader('Content-Type', 'image/webp');
    response.end(await fs.readFile(target)); return;
  }
  response.setHeader(
    "Content-Type",
    name.endsWith(".js")
      ? "text/javascript"
      : name.endsWith(".css")
        ? "text/css"
        : "text/html; charset=utf-8",
  );
  response.end(
    name === "/qa.js"
      ? js
      : name === "/qa.css"
        ? css
        : name === "/tailwind.js"
          ? tailwind
          : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [],
  screenshots = [],
  errors = [],
  network = [],
  geometry = [];
let status = "failed",
  failure = null;
async function pageFor(view, width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(origin)) return route.continue();
    network.push(route.request().url());
    return route.abort();
  });
  await page.clock.install({ time: new Date("2026-09-29T02:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-29T02:00:10Z"));
  await page.goto(`${origin}/?view=${view}`);
  return page;
}
async function capture(page, name) {
  await page.screenshot({
    path: path.join(evidence, `${name}.png`),
    fullPage: true,
  });
  screenshots.push(`${name}.png`);
}
async function measure(page, view, width) {
  const result = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    return {
      nav: rect(".teacher-sub-navigation"),
      content: rect(".teacher-sub-content"),
      workspace: rect(".teacher-sub-workspace"),
      account: rect(".qa-account"),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  geometry.push({ view, width, ...result });
  return result;
}
try {
  for (const width of [390, 768, 1280, 1440]) {
    const page = await pageFor("management", width);
    await page
      .getByRole("heading", { name: "게임 운영", exact: true })
      .waitFor();
    assert.equal(
      await page.locator("details.teacher-weplay-pool").getAttribute("open"),
      null,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "게임 설정 저장", exact: true })
        .isDisabled(),
      true,
    );
    const table = page.getByRole("table", {
      name: "난이도별 시간과 단어 길이 설정",
    });
    assert.equal(await table.locator("tbody tr").count(), 3);
    assert.equal(await table.getByRole("spinbutton").count(), 18);
    for (const label of ["착한맛", "중간맛", "매운맛"])
      assert.equal(
        await table.getByRole("rowheader", { name: label }).isVisible(),
        true,
      );
    assert.equal(
      await table.getByRole("columnheader", { name: "입력 시간 (초)" }).count(),
      1,
    );
    const scroll = page.getByRole("region", { name: "난이도별 설정 표" });
    if (width === 390)
      assert.equal(
        await scroll.evaluate((el) => el.scrollWidth > el.clientWidth),
        true,
      );
    const first = page.getByRole("spinbutton", {
      name: "착한맛 전체 제한시간",
      exact: true,
    });
    await first.focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await page
        .getByRole("spinbutton", { name: "착한맛 초반 입력 시간", exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await first.blur();
    await capture(page, `settings-collapsed-${width}`);
    await page.locator("details.teacher-weplay-pool > summary").click();
    await page.getByLabel("단어·자료 검색", { exact: true }).fill("고려");
    assert.equal(await page.locator(".teacher-weplay-words li").count(), 1);
    await capture(page, `settings-pool-${width}`);
    assert.equal((await measure(page, "management", width)).overflow, false);
    await page.close();
  }
  checks.push(
    "390/768/1280/1440: three difficulty rows with shared headers, 18 accessible inputs, keyboard order, local table scrolling, single word accordion and no page overflow",
  );
  const page = await pageFor("management", 390);
  await page.getByRole("heading", { name: "게임 운영", exact: true }).waitFor();
  const save = page.getByRole("button", {
    name: "게임 설정 저장",
    exact: true,
  });
  const preview = page.getByRole("button", { name: "체험 시작", exact: true });
  await page.locator("details.teacher-weplay-pool > summary").click();
  const word = page.getByRole("checkbox", {
    name: "훈민정음 출제 포함",
    exact: true,
  });
  await word.uncheck();
  assert.equal(await word.isChecked(), false);
  await word.check();
  await word.uncheck();
  await page.getByLabel("단어 직접 추가", { exact: true }).fill("Ａ＜Ｂ");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  assert.equal(
    await page
      .getByRole("checkbox", { name: "A<B 출제 포함", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("status")
    .filter({ hasText: "단어는 글자나 숫자를 포함해" })
    .waitFor();
  await page.getByLabel("단어 직접 추가", { exact: true }).fill("직접단어");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  assert.equal(
    await page
      .getByRole("checkbox", { name: "직접단어 출제 포함", exact: true })
      .isChecked(),
    true,
  );
  await page.getByLabel("단어 직접 추가", { exact: true }).fill("직접 단어");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  assert.equal(
    await page
      .getByRole("checkbox", { name: "직접단어 출제 포함", exact: true })
      .count(),
    1,
  );
  await page
    .getByRole("button", { name: "직접단어 직접 추가 삭제", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("checkbox", { name: "직접단어 출제 포함", exact: true })
      .count(),
    0,
  );
  for (const word of ["직접단어", "추가단어", "연습단어"]) {
    await page.getByLabel("단어 직접 추가", { exact: true }).fill(word);
    await page.getByRole("button", { name: "추가", exact: true }).click();
  }
  await page
    .getByRole("radio", { name: "선택한 수업 자료", exact: true })
    .check();
  for (const title of [
    "조선의 문화",
    "삼국의 발전과 통일",
    "다음 수업 준비 자료",
  ])
    await page
      .getByRole("checkbox", { name: `${title} 출제 포함`, exact: true })
      .uncheck();
  assert.equal(
    await preview.isEnabled(),
    true,
    "Manual-only pool should be playable",
  );
  const input = (name) =>
    page.getByRole("spinbutton", { name: `착한맛 ${name}`, exact: true });
  await input("전체 제한시간").fill("");
  assert.equal(await input("전체 제한시간").inputValue(), "");
  assert.equal(await save.isDisabled(), true);
  assert.equal(await preview.isDisabled(), true);
  await input("전체 제한시간").fill("120");
  for (const [label, value] of [
    ["초반 입력 시간", "20"],
    ["중반 입력 시간", "15"],
    ["후반 입력 시간", "10"],
  ])
    await input(label).fill(value);
  await input("최소 단어 길이").fill("4");
  await input("최대 단어 길이").fill("4");
  assert.equal(await preview.isEnabled(), true);
  assert.equal(
    await page
      .getByRole("spinbutton", { name: "중간맛 전체 제한시간", exact: true })
      .inputValue(),
    "90",
  );
  assert.equal(await input("전체 제한시간").inputValue(), "120");
  await capture(page, "settings-edited-390");
  await page.evaluate(
    () => (window.weplayTeacherQa.fail.saveWeplayGameSettings = 1),
  );
  await save.click();
  await page
    .getByRole("alert")
    .filter({ hasText: "연결이 원활하지 않습니다" })
    .waitFor();
  assert.equal(await input("전체 제한시간").inputValue(), "120");
  assert.equal(
    await page.evaluate(() => window.weplayTeacherQa.writes.length),
    0,
  );
  await preview.click();
  await page.getByLabel("단어 입력", { exact: true }).waitFor();
  const session = await page.evaluate(() => window.weplayTeacherQa.session);
  assert.equal(session.endsAtMs - session.startsAtMs, 120000);
  assert.deepEqual(
    [...new Set(session.words.filter((word) => word.kind !== "special").map((word) => word.text))].sort(),
    ["연습단어", "직접단어", "추가단어"].sort(),
  );
  assert.deepEqual(
    [1, 2, 3].map(
      (stage) =>
        session.words.find((word) => word.stage === stage).fallDurationMs,
    ),
    [20000, 15000, 10000],
  );
  await page.clock.runFor(3050);
  assert.equal(
    await page.getByLabel("단어 입력", { exact: true }).isEnabled(),
    true,
  );
  await page.clock.runFor(40000);
  assert.equal(
    await page
      .locator('.naval-battle-status span').last()
      .textContent(),
    "중반 · 격침 0척",
  );
  await page.clock.runFor(40000);
  assert.equal(
    await page
      .locator('.naval-battle-status span').last()
      .textContent(),
    "후반 · 격침 0척",
  );
  await page.clock.runFor(41100);
  await page
    .getByRole("heading", { name: "체험 결과 · 착한맛", exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.weplayTeacherQa.writes.length),
    0,
  );
  assert.equal(
    await page.evaluate(() =>
      window.weplayTeacherQa.calls.some((call) =>
        ["startWeplayGame", "submitWeplayAnswer", "finishWeplayGame"].includes(
          call.name,
        ),
      ),
    ),
    false,
  );
  await capture(page, "settings-preview-result-390");
  await page
    .getByRole("button", { name: "관리로 돌아가기", exact: true })
    .click();
  await save.click();
  await page
    .getByRole("status")
    .filter({ hasText: "게임 설정을 저장했습니다" })
    .waitFor();
  const settings = await page.evaluate(
    () => window.weplayTeacherQa.writes[0].data.settings,
  );
  assert.deepEqual(settings.customWords, ["직접단어", "추가단어", "연습단어"]);
  assert.deepEqual(settings.excludedWords, ["훈민정음"]);
  assert.equal(settings.difficulties.mild.durationSeconds, 120);
  assert.equal(settings.difficulties.mild.minWordLength, 4);
  assert.equal(await save.isDisabled(), true);
  await page.close();
  checks.push(
    "Individual exclusion/reinclusion, duplicate normalization, custom add/remove, custom-only play, raw numeric blank, per-difficulty values, failed-save preservation/retry; exact draft sent and persisted",
  );
  checks.push(
    "Unsaved 120-second custom-only preview: 20/15/10 seconds, 40/80/120 stage/end boundaries, no student API calls or database writes",
  );
  for (const view of ["readonly", "denied", "empty", "load-error"]) {
    const p = await pageFor(view, 390);
    if (view === "denied") {
      await p
        .getByRole("alert")
        .filter({ hasText: "볼 권한이 없습니다" })
        .waitFor();
      assert.equal(
        await p.evaluate(() => window.weplayTeacherQa.calls.length),
        0,
      );
    } else if (view === "load-error") {
      await p
        .getByRole("button", { name: "다시 불러오기", exact: true })
        .click();
      await p
        .getByRole("heading", { name: "게임 운영", exact: true })
        .waitFor();
    } else {
      await p
        .getByRole("heading", { name: "게임 운영", exact: true })
        .waitFor();
      if (view === "readonly")
        assert.equal(
          await p
            .getByRole("spinbutton", {
              name: "착한맛 전체 제한시간",
              exact: true,
            })
            .isDisabled(),
          true,
        );
      if (view === "empty")
        assert.equal(
          await p
            .getByRole("button", { name: "체험 시작", exact: true })
            .isDisabled(),
          true,
        );
    }
    await p.close();
  }
  checks.push(
    "Read-only settings, denied read/no requests, empty pool, load-error recovery",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  status = "passed";
} catch (error) {
  failure = String(error.stack || error);
  throw error;
} finally {
  await fs.writeFile(
    path.join(evidence, "settings-browser-results.json"),
    JSON.stringify(
      { status, failure, checks, geometry, screenshots, errors, network },
      null,
      2,
    ),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
console.log(`PASS Weplay settings browser QA. Evidence: ${evidence}`);
