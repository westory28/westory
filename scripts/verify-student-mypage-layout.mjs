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
    "lib\\/myQuizHistory$/",
    "lib\\/myQuizHistory$|lib\\/developerLogImages$|common\\/QuillEditor$/",
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
    await page
      .getByRole("button", { name: "응시 기록", exact: true })
      .waitFor();
    await noOverflow(page, width + "/profile");
    assert.deepEqual(await page.evaluate(() => window.myHistoryQa), {
      list: [],
      detail: [],
    });
    assert.equal(
      await page.evaluate(
        () =>
          window.myPageQa.calls.filter((call) => call.kind === "performance")
            .length,
      ),
      0,
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.myPageQa.calls.filter(
            (call) => call.kind === "quiz" || call.key?.includes("curriculum"),
          ).length,
      ),
      0,
    );
    await page
      .getByRole("button", { name: "나의 성적표", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "내 수행평가 점수", exact: true })
      .waitFor();
    await noOverflow(page, width + "/score");
    assert.equal(
      await page.evaluate(
        () =>
          window.myPageQa.calls.filter((call) => call.kind === "performance")
            .length,
      ),
      1,
    );
    await page.getByRole("button", { name: "응시 기록", exact: true }).click();
    await page.locator(".my-quiz-history__list li").first().waitFor();
    assert.equal(await page.locator(".my-quiz-history__list li").count(), 20);
    assert.equal(
      await page.evaluate(() => window.myHistoryQa.detail.length),
      0,
    );
    await noOverflow(page, width + "/history");
    await page.screenshot({
      path: path.join(evidence, "history-" + width + ".png"),
      fullPage: true,
    });
    const first = page.locator(".my-quiz-history__list li button").first();
    await first.focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("heading", { name: "1번 · 오답", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.myHistoryQa.detail.length),
      1,
    );
    await noOverflow(page, width + "/detail");
    await page.screenshot({
      path: path.join(evidence, "detail-" + width + ".png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "오답 1문제 복습하기", exact: true })
      .click();
    await page
      .getByRole("button", { name: "해설 가리고 다시 풀기", exact: true })
      .click();
    await page.getByRole("button", { name: /1\. 의정부는/ }).click();
    await page.getByRole("button", { name: "답 확인", exact: true }).click();
    await page
      .getByRole("button", { name: "복습 결과 확인", exact: true })
      .click();
    await page
      .getByRole("button", { name: "평가 결과로", exact: true })
      .click();
    assert.equal(
      await page.locator(".my-quiz-history__result-meta strong").innerText(),
      "0점",
    );
    await page
      .getByRole("button", { name: "← 응시 기록", exact: true })
      .click();
    assert(
      await first.evaluate((element) => element === document.activeElement),
    );
    await first.click();
    await page
      .getByRole("heading", { name: "1번 · 오답", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.myHistoryQa.detail.length),
      1,
      "same detail is reused from bounded component cache",
    );
    await page
      .getByRole("button", { name: "← 응시 기록", exact: true })
      .click();
    await page
      .getByRole("button", { name: "이전 기록 더 보기", exact: true })
      .click();
    await page.getByText("조선의 통치 체제 23", { exact: true }).waitFor();
    assert.equal(await page.locator(".my-quiz-history__list li").count(), 23);
    assert.equal(await page.evaluate(() => window.myHistoryQa.list.length), 2);
    await page.getByLabel("평가 종류").selectOption("formative");
    await page.getByText("총 8회 · 최신순", { exact: true }).waitFor();
    assert.equal(await page.locator(".my-quiz-history__list li").count(), 8);
    await page.getByRole("button", { name: "새로고침", exact: true }).click();
    await page.getByText("총 8회 · 최신순", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => window.myHistoryQa.list.at(-1).forceRefresh),
      true,
    );
    assert.deepEqual(errors, []);
    checks.push({
      width,
      profileNoAssessmentReads: true,
      summaryPage: 20,
      detailReads: 1,
      practiceKeepsScore: true,
      pagination: 23,
      keyboardReturn: true,
      noOverflow: true,
    });
    await page.close();
  }
  for (const width of [320, 390, 768, 1280, 1366]) {
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
  for (const scenario of [
    "empty",
    "error",
    "cursor-error",
    "detail-error",
    "word",
    "direct",
    "legacy",
  ]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    const query =
      scenario === "word"
        ? "word&attemptId=attempt-0"
        : scenario === "direct"
          ? "attemptId=attempt-0"
          : scenario === "legacy"
            ? "attemptId=old-legacy"
            : scenario === "detail-error"
              ? "detail-error&attemptId=attempt-0"
              : scenario;
    await page.goto("http://127.0.0.1:4197?" + query);
    if (["direct", "legacy", "detail-error", "word"].includes(scenario)) {
      if (scenario === "detail-error")
        await page
          .getByRole("button", { name: "다시 불러오기", exact: true })
          .click();
      await page
        .getByRole("heading", { name: "1번 · 오답", exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(() => window.myHistoryQa.list[0].forceRefresh),
        true,
      );
      if (scenario === "word") {
        await page
          .getByRole("button", { name: "오답 1문제 복습하기", exact: true })
          .click();
        await page
          .getByRole("button", { name: "해설 가리고 다시 풀기", exact: true })
          .click();
        await page.getByRole("textbox").fill("이 성 계");
        await page
          .getByRole("button", { name: "답 확인", exact: true })
          .click();
        await page.getByText("다시 맞혔어요.", { exact: true }).waitFor();
        assert.equal(
          await page
            .locator(".my-quiz-history__result-meta strong")
            .innerText(),
          "0점",
        );
      }
      if (scenario === "legacy")
        assert.deepEqual(await page.evaluate(() => window.myHistoryQa.detail), [
          "canonical:old-legacy",
          "legacy:old-legacy",
        ]);
    } else {
      await page
        .getByRole("button", { name: "응시 기록", exact: true })
        .click();
      if (scenario === "error") {
        await page
          .getByRole("button", { name: "처음부터 새로고침", exact: true })
          .click();
        await page.locator(".my-quiz-history__list li").first().waitFor();
      } else if (scenario === "cursor-error") {
        await page
          .getByRole("button", { name: "이전 기록 더 보기", exact: true })
          .click();
        await page.getByRole("alert").waitFor();
        assert.equal(
          await page.locator(".my-quiz-history__list li").count(),
          20,
        );
        await page
          .getByRole("button", { name: "처음부터 새로고침", exact: true })
          .click();
        await page.locator(".my-quiz-history__list li").first().waitFor();
      } else
        await page
          .getByText("아직 응시한 평가가 없습니다.", { exact: true })
          .waitFor();
    }
    await noOverflow(page, scenario);
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
