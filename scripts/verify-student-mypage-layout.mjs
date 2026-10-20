import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "westory-mypage-layout-"));
const evidence = path.join(root, "output", "student-mypage-layout");
await fs.mkdir(evidence, { recursive: true });
let source = await fs.readFile(
  path.join(root, "scripts/preview-mypage-assessment.mjs"),
  "utf8",
);
source = source
  .replace(
    'import { build } from "esbuild";',
    `import { build } from ${JSON.stringify(pathToFileURL(require.resolve("esbuild")).href)};`,
  )
  .replace(
    'const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");',
    `const root = ${JSON.stringify(root)};`,
  )
  .replaceAll("4192", "4197")
  .replaceAll("westory-assessment-qa-tailwind.js", "westory-qa-tailwind.js")
  .replace(
    "import MyPage from './src/pages/student/MyPage';",
    "import MyPage from './src/pages/student/MyPage';import DeveloperLog from './src/pages/DeveloperLog';",
  )
  .replace(
    "<MyPage/>",
    "{location.search.includes('developer-log')?<DeveloperLog/>:<MyPage/>}",
  )
  .replace(
    "lib\\/studentProgressSummary$/",
    "lib\\/studentProgressSummary$|lib\\/developerLogImages$|common\\/QuillEditor$/",
  )
  .replace("const config={", "window.myPageQa={calls:[]};const config={")
  .replace("showLesson:false", "showLesson:true")
  .replace("const userData={name:", "const userData={role:'student',name:")
  .replace(
    "useAuth=()=>({config,user,userData})",
    "useAuth=()=>({config,user,currentUser:user,userData})",
  )
  .replace(
    "export const getDocs=async()",
    "export default function QuillEditor(){return null};export const uploadDeveloperLogImage=async()=>{throw Error('Fixture writes disabled')};export const tryDeleteDeveloperLogImage=async()=>{throw Error('Fixture writes disabled')};export const addDoc=setDoc,deleteDoc=setDoc,updateDoc=setDoc,runTransaction=setDoc;export const limit=()=>null,orderBy=()=>null;export const onSnapshot=(ref,onData)=>{onData({docs:[{id:'fixture-post',data:()=>({title:'학생 마이페이지 개선',category:'feature',summary:'화면과 필터를 정리했습니다.',bodyHtml:'<p>확인할 내용</p>',publishedAt:new Date('2026-10-20T00:00:00Z'),likeCount:2,viewCount:3})}]});return()=>{}};export const getDocs=async()",
  )
  .replace(
    "export const getDoc=async(ref)=>{const key=ref.join('/');",
    "export const getDoc=async(ref)=>{const key=ref.join('/');window.myPageQa.calls.push({kind:'doc',key,at:performance.now()});if(key.includes('curriculum'))await new Promise(resolve=>setTimeout(resolve,200));",
  )
  .replace(
    ":key==='[object Object]/users/fixture-student'?userData:null;",
    ":key.includes('academic_records')?{scores:{plan_0:100,plan_1:20,plan_2:30}}:key==='[object Object]/users/fixture-student'?userData:null;",
  )
  .replace(
    "export const getDocs=async()=>({forEach:()=>{},docs:[],empty:true});",
    "export const getDocs=async()=>({forEach:(visit)=>visit({id:'plan',data:()=>({subject:'국어',targetGrade:'3',academicYear:'2026',semester:'2',items:[{type:'exam',name:'정기시험',maxScore:100,ratio:50},{type:'performance',name:'글쓰기',maxScore:20,ratio:20},{type:'performance',name:'말하기',maxScore:30,ratio:30}]})}),docs:[],empty:false});",
  )
  .replace(
    "export const getStudentPointWallet=async()=>null;",
    "export const getStudentPointWallet=async()=>({balance:150,totalEarned:150,earnedPoints:150});",
  )
  .replace(
    "export const loadUserPerformanceScoreRecords=async()=>[];",
    "export const loadUserPerformanceScoreRecords=async()=>{window.myPageQa.calls.push({kind:'performance',at:performance.now()});return []};",
  )
  .replace(
    "export const loadStudentQuizResults=async()=>{",
    "export const loadStudentQuizResults=async()=>{window.myPageQa.calls.push({kind:'quiz',at:performance.now()});",
  )
  .replace(
    "completedUnits:0,totalLessons:0,worksheetUnits:0",
    "completedUnits:2,totalLessons:4,worksheetUnits:4",
  );
const serverFile = path.join(temp, "fixture.mjs");
await fs.writeFile(serverFile, source);
const server = spawn(process.execPath, [serverFile], {
  cwd: root,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Fixture startup timed out")),
      20000,
    );
    server.stdout.on("data", (chunk) => {
      if (String(chunk).includes("MyPage fixture:")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on("data", (chunk) => process.stderr.write(chunk));
    server.on("exit", (code) => reject(new Error(`Fixture exited ${code}`)));
  });
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
  browser = await playwright.chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const checks = [];
  const noOverflow = async (page, name) => {
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert(
      dimensions.scroll <= dimensions.width + 1,
      `${name}: document overflow`,
    );
  };
  for (const width of [320, 390, 768, 1280, 1366]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1"
        ? route.continue()
        : route.abort(),
    );
    await page.goto("http://127.0.0.1:4197");
    await page.getByText("점수 계산 요약", { exact: true }).waitFor();
    await noOverflow(page, `${width}/profile`);
    assert.equal(await page.locator(".my-assessment-summary").count(), 0);
    const initialCalls = await page.evaluate(() => window.myPageQa.calls);
    assert.equal(
      initialCalls.filter((call) => call.kind === "performance").length,
      0,
    );
    const treeCall = initialCalls.find((call) =>
      call.key?.includes("curriculum"),
    );
    const quizCall = initialCalls.find((call) => call.kind === "quiz");
    assert(
      quizCall.at - treeCall.at < 150,
      "Quiz loading must not wait for curriculum",
    );
    await page.screenshot({
      path: path.join(evidence, `profile-${width}.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "나의 성적표", exact: true })
      .click();
    await page.locator(".my-assessment-summary__records li").first().waitFor();
    await noOverflow(page, `${width}/score`);
    const performanceCount = await page.evaluate(
      () =>
        window.myPageQa.calls.filter((call) => call.kind === "performance")
          .length,
    );
    assert.equal(performanceCount, 1);
    await page.screenshot({
      path: path.join(evidence, `score-${width}.png`),
      fullPage: true,
    });
    assert.equal(
      await page.locator(".my-assessment-summary__records li").count(),
      3,
    );
    await page
      .getByRole("button", { name: "전체 7회 보기", exact: true })
      .click();
    assert.equal(
      await page.locator(".my-assessment-summary__records li").count(),
      7,
    );
    await page
      .getByRole("button", { name: "최근 3회만 보기", exact: true })
      .click();
    await page
      .locator(".my-assessment-summary__records li > button")
      .first()
      .click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page.getByRole("button", { name: "오답 노트", exact: true }).click();
    await page.getByRole("button", { name: "진단평가", exact: true }).click();
    const selects = page.locator(".student-my-page__unit-filters select");
    assert.equal(await selects.count(), 3);
    const boxes = await selects.evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return { top: box.top, height: box.height, width: box.width };
      }),
    );
    assert(
      boxes.every((box) => box.top === boxes[0].top),
      "All unit dropdowns stay in one row",
    );
    assert(boxes.every((box) => box.height >= 44 && box.width >= 44));
    await page.getByLabel("대단원", { exact: true }).selectOption("big");
    await page.getByLabel("중단원", { exact: true }).selectOption("mid");
    await page.getByLabel("소단원", { exact: true }).selectOption("leaf");
    assert(
      (await page.locator(".student-my-page__attempt-list button").count()) > 0,
    );
    await page.screenshot({
      path: path.join(evidence, `wrong-note-${width}.png`),
      fullPage: true,
    });
    await page.getByLabel("대단원", { exact: true }).selectOption("all");
    assert.equal(
      await page.getByLabel("중단원", { exact: true }).inputValue(),
      "all",
    );
    assert.equal(
      await page.getByLabel("소단원", { exact: true }).inputValue(),
      "all",
    );
    assert(await page.getByLabel("중단원", { exact: true }).isDisabled());
    await page.getByLabel("대단원", { exact: true }).focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.equal(
      await page.getByLabel("대단원", { exact: true }).inputValue(),
      "big",
    );
    await noOverflow(page, `${width}/wrong-note`);
    await page.getByRole("button", { name: "전체", exact: true }).click();
    assert.equal(await selects.count(), 3);
    await page.getByRole("button", { name: "모의고사", exact: true }).click();
    assert.equal(await page.getByLabel("회차", { exact: true }).count(), 1);
    await page
      .getByRole("button", { name: "나의 성적표", exact: true })
      .click();
    assert.equal(
      await page.evaluate(
        () =>
          window.myPageQa.calls.filter((call) => call.kind === "performance")
            .length,
      ),
      1,
    );
    assert.deepEqual(errors, []);
    checks.push({
      width,
      profile: "pass",
      score: "pass",
      unitSelects: boxes,
      keyboard: "pass",
      noOverflow: "pass",
      deferredPerformanceReads: performanceCount,
    });
    await page.close();
  }
  for (const width of [390, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:4197?developer-log");
    await page
      .getByRole("heading", { name: "개발자 일지", exact: true })
      .waitFor();
    await page.getByText("학생 마이페이지 개선", { exact: true }).waitFor();
    assert.equal(await page.locator(".ws-page.ws-page--reading").count(), 1);
    assert.equal(await page.locator(".ws-page-tabs").count(), 1);
    assert.equal(
      await page.getByText("학생은 좋아요만 가능", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("button", { name: "글쓰기", exact: true }).count(),
      0,
    );
    await noOverflow(page, `${width}/developer-log`);
    await page.screenshot({
      path: path.join(evidence, `developer-log-${width}.png`),
      fullPage: true,
    });
    await page.getByLabel("개발자 일지 검색", { exact: true }).fill("없는 글");
    await page
      .getByText("등록된 개발자 일지가 없습니다.", { exact: true })
      .waitFor();
    await page.getByLabel("개발자 일지 검색", { exact: true }).fill("");
    await page.getByText("학생 마이페이지 개선", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    checks.push({
      width,
      developerLog: "pass",
      search: "pass",
      studentControls: "pass",
    });
    await page.close();
  }
  for (const scenario of ["empty", "error"]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.goto(`http://127.0.0.1:4197?${scenario}`);
    await page.getByRole("button", { name: "오답 노트", exact: true }).click();
    if (scenario === "error") {
      await page
        .getByRole("button", { name: "다시 불러오기", exact: true })
        .click();
      await page
        .locator(".student-my-page__attempt-list button")
        .first()
        .waitFor();
    } else {
      await page
        .getByText("조건에 맞는 응시 기록이 없습니다.", { exact: true })
        .waitFor();
    }
    await noOverflow(page, scenario);
    await page.screenshot({
      path: path.join(evidence, `${scenario}-390.png`),
      fullPage: true,
    });
    checks.push({ scenario, result: "pass" });
    await page.close();
  }
  await fs.writeFile(
    path.join(evidence, "checks.json"),
    JSON.stringify(checks, null, 2),
  );
  console.log(
    `Student MyPage layout: ${checks.length} responsive/state scenarios passed. Evidence: ${evidence}`,
  );
} finally {
  await browser?.close();
  server.kill();
}
