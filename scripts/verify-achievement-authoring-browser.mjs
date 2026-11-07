/** Real teacher authoring and paper rendering with synthetic services only. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const root = process.cwd();
const playwright = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    ),
);
const evidence =
  process.env.ACHIEVEMENT_EVIDENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "westory-achievement-authoring-")));
await fs.mkdir(evidence, { recursive: true });
const fixture = await fs.readFile(
  "scripts/verify-assessment-teacher-browser.mjs",
  "utf8",
);
let service = fixture.match(/const service = `([\s\S]*?)`;/)[1];
service = service.replace(
  "category:q.category,type:q.type,refBig:",
  "category:q.category,type:q.type,examRound:q.examRound,paperOrder:q.paperOrder,points:q.points,passageSetId:q.passageSet?.id,passageSetInstruction:q.passageSet?.instruction,refBig:",
);
service = service.replace(
  "if(command==='upsertQuizQuestion'){const q=",
  "if(command==='upsertQuizQuestion'){if(fixtureState.failNextSave){fixtureState.failNextSave=false;throw new Error('합성 저장 실패')}const q=",
);
service = service.replace(
  /export const tree=.*?;\r?\n/,
  "export const tree=[{id:'big-1',title:'IV. 조선의 성립과 발전',children:[{id:'mid-1',title:'통치 체제와 대외 관계',children:[{id:'lesson-1',title:'조선 건국, 500년 역사의 시작'},{id:'lesson-2',title:'조선 전기 통치 체제'}]},{id:'mid-2',title:'사림 세력과 정치 변화',children:[{id:'lesson-3',title:'사림의 성장과 붕당의 형성'}]}]}];\n",
);
const image =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="220"><rect width="640" height="220" fill="#f8fafc"/><path d="M40 180L200 60L320 120L540 40" stroke="#334155" fill="none" stroke-width="8"/><text x="60" y="205" font-size="26">합성 문항 자료</text></svg>',
  );
const common = {
  unitId: "exam_prep",
  category: "exam_prep",
  type: "choice",
  options: [
    "가",
    "나",
    "두 글자",
    "긴 선지입니다",
    "마지막으로 가장 긴 선지입니다",
  ],
  answer: "나",
  points: 4,
  contentRevision: 1,
  explanation: "자료의 근거를 확인한다.",
  refBig: "big-1",
  refMid: "mid-1",
  refSmall: "lesson-1",
};
const seed = [
  ...Array.from({ length: 24 }, (_, index) => ({
    ...common,
    id: 7001 + index,
    examRound: "round_2",
    paperOrder: index + 1,
    question: `복시 ${index + 1}번 자료를 근거로 옳은 설명을 고르시오.`,
    passage:
      "중앙 집권 체제의 강화와 지방 제도의 정비는 국가 운영 방식에 변화를 가져왔다. 자료의 시기와 정책의 목적을 살펴보자. ".repeat(
        4,
      ),
    image: index % 4 === 0 ? image : null,
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    ...common,
    id: 8001 + index,
    examRound: "round_3",
    paperOrder: index + 1,
    question: `전시 ${index + 1}번 옳은 설명을 고르시오.`,
    paperBreakBefore: true,
  })),
];
service += `\nquestions.push(...${JSON.stringify(seed)});`;
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import QuizEditor from './src/pages/teacher/components/QuizEditor.tsx';import {tree} from 'fixture:service';import './src/assets/index.css';import './src/pages/teacher/teacherSettings.css';const params=new URLSearchParams(location.search);const normal=params.has('normal');createRoot(document.getElementById('root')).render(<QuizEditor node={normal?tree[0].children[0]:{id:'exam_prep',title:'모의고사'}} type={normal?'normal':'special'} treeData={tree} canEdit={!params.has('readonly')} onOpenSettings={()=>{}}/>);`;
const bundle = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  outfile: "fixture.js",
  loader: {
    ".woff2": "dataurl",
    ".woff": "dataurl",
    ".webp": "dataurl",
    ".svg": "dataurl",
    ".png": "dataurl",
  },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "synthetic-services",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /^fixture:service$|(?:^|\/)contexts\/AuthContext$|(?:^|\/)(?:lib\/)?(firebase|assessmentRelease|assessmentLifecycle|historyDictionarySession)$|^firebase\/firestore$/,
          },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: service,
          loader: "ts",
          resolveDir: root,
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text;
const css = bundle.outputFiles
  .find((f) => f.path.endsWith(".css"))
  .text.replace(/@import\s+(?:url\()?['"]?https?:[^;]+;/g, "");
let tailwind;
for (const candidate of [
  process.env.PORTAL_DESIGN_TAILWIND_PATH,
  path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  path.join(os.tmpdir(), "westory-assessment-qa-tailwind.js"),
].filter(Boolean)) {
  try {
    tailwind = await fs.readFile(candidate, "utf8");
    break;
  } catch {}
}
assert(
  tailwind,
  "Run an existing portal browser check once to cache the official Tailwind runtime.",
);
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"><body style="margin:0"><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = http.createServer((req, res) => {
  const p = new URL(req.url, "http://localhost").pathname;
  const [type, body] = {
    "/fixture.js": ["text/javascript", js],
    "/fixture.css": ["text/css", css],
    "/tailwind.js": ["text/javascript", tailwind],
  }[p] || ["text/html", html];
  res.setHeader("Content-Type", type + ";charset=utf-8");
  res.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [],
  external = [],
  errors = [],
  alerts = [],
  layouts = [];

try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.route("**/*", (route) => {
    if (
      route.request().url().startsWith(origin) ||
      route.request().url().startsWith("data:")
    )
      return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", async (d) => {
    alerts.push(d.message());
    await d.dismiss();
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "문제 등록", exact: true }).click();
  const compose = page.getByRole("dialog", {
    name: "새 문제 등록",
    exact: true,
  });
  const reviewLesson = compose.getByRole("combobox", {
    name: "다시 볼 수업자료",
    exact: true,
  });
  assert.equal(
    await reviewLesson.inputValue(),
    "lesson-1",
    "new form defaults to its selected lesson",
  );
  await compose.getByRole("button", { name: "취소", exact: true }).click();
  await compose.waitFor({ state: "hidden" });
  assert.deepEqual(
    alerts,
    [],
    "automatic defaults do not mark untouched form dirty",
  );
  await page.getByRole("button", { name: "문제 등록", exact: true }).click();
  const standard = compose.getByRole("combobox", {
    name: "성취기준",
    exact: true,
  });
  await compose
    .getByRole("combobox", { name: "대단원", exact: true })
    .selectOption("big-1");
  assert.equal(await standard.inputValue(), "", "broad domain needs selection");
  await compose
    .getByRole("combobox", { name: "중단원", exact: true })
    .selectOption("mid-1");
  await compose
    .getByRole("combobox", { name: "소단원", exact: true })
    .selectOption("lesson-1");
  assert.equal(await standard.inputValue(), "9역10-01");
  assert.equal(await reviewLesson.inputValue(), "lesson-1");
  await compose
    .getByRole("combobox", { name: "소단원", exact: true })
    .selectOption("lesson-2");
  assert.equal(
    await reviewLesson.inputValue(),
    "lesson-2",
    "automatic review link follows selected lesson",
  );
  await compose
    .getByRole("combobox", { name: "소단원", exact: true })
    .selectOption("lesson-1");
  await compose
    .getByRole("combobox", { name: "목표 성취수준", exact: true })
    .selectOption("C");
  await compose
    .getByRole("combobox", { name: "예상 난이도", exact: true })
    .selectOption("medium");
  await compose
    .getByRole("combobox", { name: "중단원", exact: true })
    .selectOption("mid-2");
  assert.equal(
    await standard.inputValue(),
    "9역10-02",
    "automatic mapping follows new unit",
  );
  assert.equal(
    await compose
      .getByRole("combobox", { name: "목표 성취수준", exact: true })
      .inputValue(),
    "",
    "stale target level cleared",
  );
  await standard.selectOption("9역10-03");
  await compose
    .getByRole("combobox", { name: "중단원", exact: true })
    .selectOption("mid-1");
  assert.equal(
    await standard.inputValue(),
    "9역10-03",
    "manual override persists",
  );
  await compose
    .getByRole("button", { name: "단원 기준 적용", exact: true })
    .click();
  assert.equal(await standard.inputValue(), "9역10-01");
  await compose
    .getByRole("combobox", { name: "소단원", exact: true })
    .selectOption("lesson-1");
  await reviewLesson.selectOption("lesson-3");
  await compose
    .getByRole("combobox", { name: "소단원", exact: true })
    .selectOption("lesson-2");
  assert.equal(
    await reviewLesson.inputValue(),
    "lesson-3",
    "manual review link survives a changed unit",
  );
  await reviewLesson.selectOption("");
  await compose
    .getByRole("combobox", { name: "소단원", exact: true })
    .selectOption("lesson-1");
  assert.equal(
    await reviewLesson.inputValue(),
    "",
    "intentional unlink survives a changed unit",
  );
  await reviewLesson.selectOption("lesson-2");
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await standard.scrollIntoViewIfNeeded();
    const measurement = await standard.evaluate((el) => {
      const unit = Array.from(
        document.querySelectorAll(".quiz-composer-body select"),
      ).find((s) => s.closest("label")?.textContent.startsWith("소단원"));
      const fields = el.closest(".quiz-achievement-fields");
      const rect = (n) => {
        const r = n.getBoundingClientRect();
        return {
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          width: r.width,
        };
      };
      const body = el.closest(".quiz-composer-body");
      const over = Array.from(body.querySelectorAll("*"))
        .filter(
          (n) =>
            n.getBoundingClientRect().right >
            body.getBoundingClientRect().right + 1,
        )
        .map((n) => ({
          tag: n.tagName,
          cls: n.className,
          w: n.getBoundingClientRect().width,
          text: n.textContent.slice(0, 30),
        }));
      return {
        over,
        formScrollLeft: el.closest(".quiz-composer-body").scrollLeft,
        formClientWidth: el.closest(".quiz-composer-body").clientWidth,
        formScrollWidth: el.closest(".quiz-composer-body").scrollWidth,
        standard: rect(fields),
        unit: rect(unit),
        documentWidth: document.documentElement.scrollWidth,
        window: innerWidth,
        order: fields.previousElementSibling.contains(unit),
      };
    });
    assert.equal(measurement.formScrollLeft, 0, JSON.stringify(measurement));
    assert(measurement.order, "standard row directly follows unit row");
    assert(
      measurement.standard.top >= measurement.unit.bottom,
      "standard below units",
    );
    assert(measurement.documentWidth <= width + 1, JSON.stringify(measurement));
    assert(
      measurement.standard.right <= width + 1,
      JSON.stringify(measurement),
    );
    layouts.push({ width, ...measurement });
    await page.screenshot({
      path: path.join(evidence, `achievement-authoring-${width}.png`),
    });
    const cognitive = compose.getByRole("button", {
      name: "사고 과정 선택",
      exact: true,
    });
    await cognitive.scrollIntoViewIfNeeded();
    const before = await reviewLesson.evaluate((el) => ({
      top: el.getBoundingClientRect().top,
      left: el.getBoundingClientRect().left,
      height: el.getBoundingClientRect().height,
      scrollTop: el.closest(".quiz-composer-body").scrollTop,
      scrollHeight: el.closest(".quiz-composer-body").scrollHeight,
    }));
    await cognitive.click();
    const popup = compose.getByRole("group", {
      name: "사고 과정 항목",
      exact: true,
    });
    await popup.waitFor();
    const after = await reviewLesson.evaluate((el) => ({
      top: el.getBoundingClientRect().top,
      left: el.getBoundingClientRect().left,
      height: el.getBoundingClientRect().height,
      scrollTop: el.closest(".quiz-composer-body").scrollTop,
      scrollHeight: el.closest(".quiz-composer-body").scrollHeight,
    }));
    assert.deepEqual(
      after,
      before,
      "opening process options never moves adjacent fields or scroll position",
    );
    const popupRect = await popup.boundingBox();
    assert(
      popupRect.x >= 0 &&
        popupRect.x + popupRect.width <= width + 1 &&
        popupRect.y >= 0 &&
        popupRect.y + popupRect.height <= 901,
      JSON.stringify(popupRect),
    );
    await popup
      .getByRole("checkbox", { name: "개념 이해", exact: true })
      .check();
    await popup
      .getByRole("checkbox", { name: "사료 해석", exact: true })
      .check();
    await page.screenshot({
      path: path.join(evidence, `cognitive-overlay-${width}.png`),
    });
    await page.keyboard.press("Escape");
    assert.equal(await cognitive.getAttribute("aria-expanded"), "false");
    assert(await compose.isVisible(), "Escape only closes the dropdown");
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await compose
    .getByRole("combobox", { name: "목표 성취수준", exact: true })
    .selectOption("C");
  await compose
    .getByRole("combobox", { name: "예상 난이도", exact: true })
    .selectOption("medium");
  await compose
    .getByLabel("발문", { exact: true })
    .fill("조선의 통치 체제에 대한 설명으로 옳은 것은?");
  for (let i = 0; i < 5; i++)
    await compose
      .getByLabel(`${i + 1}번 보기`, { exact: true })
      .fill(`합성 선택지 ${i + 1}`);
  await compose
    .getByRole("button", { name: "1번 보기 정답 선택", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => window.assessmentTeacherFixture.writes.length),
    0,
  );
  await compose.getByRole("button", { name: "등록", exact: true }).click();
  await compose.waitFor({ state: "hidden" });
  const saved = await page.evaluate(
    () =>
      window.assessmentTeacherFixture.writes.find(
        (w) => w.command === "upsertQuizQuestion",
      ).payload.question,
  );
  assert.equal(saved.curriculumVersion, "2018-162");
  assert.deepEqual(saved.achievementStandardCodes, ["9역10-01"]);
  assert.equal(saved.achievementMappingSource, "unit");
  assert.equal(saved.targetAchievementLevel, "C");
  assert.equal(saved.intendedDifficulty, "medium");
  assert.equal(
    saved.reviewLessonId,
    "lesson-2",
    "explicit lesson link persists",
  );
  // Existing item is reopened through the actual list; clearing must persist.
  await page
    .getByRole("button", { name: "1번 문제 수정", exact: true })
    .first()
    .click();
  const edit = page.getByRole("dialog", { name: "문제 수정", exact: true });
  await edit.waitFor();
  assert.equal(
    await edit
      .getByRole("combobox", { name: "다시 볼 수업자료", exact: true })
      .inputValue(),
    "lesson-2",
    "saved review link survives reopening",
  );
  await edit
    .getByRole("combobox", { name: "다시 볼 수업자료", exact: true })
    .selectOption("");
  assert.equal(
    await edit
      .getByRole("combobox", { name: "성취기준", exact: true })
      .inputValue(),
    "9역10-01",
  );
  await edit
    .getByRole("combobox", { name: "성취기준", exact: true })
    .selectOption("");
  await edit.getByRole("button", { name: "수정 저장", exact: true }).click();
  await edit.waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "1번 문제 수정", exact: true })
    .first()
    .click();
  await edit.waitFor();
  assert.equal(
    await edit
      .getByRole("combobox", { name: "다시 볼 수업자료", exact: true })
      .inputValue(),
    "",
    "saved intentional unlink survives reopening",
  );
  assert.equal(
    await edit
      .getByRole("combobox", { name: "성취기준", exact: true })
      .inputValue(),
    "",
  );
  assert(
    await edit
      .getByRole("combobox", { name: "목표 성취수준", exact: true })
      .isDisabled(),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(alerts, []);
  checks.push(
    "unique-unit automatic mapping",
    "ambiguous domain stays unassigned",
    "manual override and restore",
    "stale target cleared",
    "row placement and responsive layout",
    "persist metadata",
    "manual clearing survives reopen",
    "default lesson follows source unit without extra reads; explicit links and unlink preserved",
    "process overlay has zero layout shift and Escape preserves composer at 390/768/1280",
  );
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify({ checks, layouts, errors, external }, null, 2),
  );
  console.log(JSON.stringify({ passed: checks.length, evidence, checks }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
