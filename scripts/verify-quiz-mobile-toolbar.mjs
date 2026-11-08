/** Mobile assessment toolbars, using only synthetic local services. */
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
  process.env.MOCK_EXAM_EVIDENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "westory-quiz-toolbar-")));
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
  hintEnabled: true,
  hint: "기존 모의고사 힌트는 노출하지 않습니다",
  explanation: "자료의 근거를 확인한다.",
  cognitiveProcess: "기존 사고 과정",
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
  .text.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/g, "");
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
const external = [],
  errors = [],
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
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole("button", { name: "문제 등록", exact: true }).waitFor();
  // Reserve the real icon width without fetching the production icon CDN.
  await page.addStyleTag({
    content:
      '.fas::before{display:inline-block;width:1em;text-align:center}.fa-cog::before{content:"⚙"}.fa-plus::before{content:"+"}.fa-sync-alt::before{content:"↻"}',
  });
  await page.locator("#root").evaluate((el) => {
    el.style.margin = "16px";
  });
  await page
    .getByRole("combobox", { name: "모의고사 대단원 필터", exact: true })
    .selectOption("big-1");
  await page
    .getByRole("combobox", { name: "모의고사 중단원 필터", exact: true })
    .selectOption("mid-1");
  await page
    .getByRole("combobox", { name: "모의고사 소단원 필터", exact: true })
    .selectOption("lesson-1");
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => {
      const box = (el) => {
        const b = el.getBoundingClientRect();
        return {
          left: b.left,
          right: b.right,
          top: b.top,
          bottom: b.bottom,
          width: b.width,
          height: b.height,
        };
      };
      const heading = document.querySelector(
        ".quiz-registration-heading--mock",
      );
      const row = document.querySelector(".quiz-unit-filter-row");
      return {
        width: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
        heading: box(heading),
        title: box(heading.querySelector("h2")),
        headingControls: [...heading.querySelectorAll("button")].map((el) => ({
          ...box(el),
          text: el.textContent.trim() || el.getAttribute("aria-label"),
          overflow: el.scrollWidth > el.clientWidth + 1,
        })),
        filters: [...row.querySelectorAll("select")].map(box),
        count: box(row.querySelector(".quiz-unit-filter-count")),
        reset: box(row.querySelector("button")),
        filterRow: box(row),
      };
    });
    assert.equal(layout.overflow, false, JSON.stringify(layout));
    assert.equal(layout.headingControls.length, 3);
    const headingTop = layout.headingControls[0].top;
    for (const control of layout.headingControls) {
      assert(Math.abs(control.top - headingTop) < 1, JSON.stringify(layout));
      assert(
        control.left >= layout.heading.left &&
          control.right <= layout.heading.right,
        JSON.stringify(layout),
      );
      assert(
        control.height >= 44 && control.width >= 44,
        JSON.stringify(layout),
      );
      assert.equal(control.overflow, false, JSON.stringify(layout));
    }
    assert(
      layout.title.right <= layout.headingControls[0].left + 1,
      JSON.stringify(layout),
    );
    assert(
      layout.headingControls[0].right <= layout.headingControls[1].left + 1,
      JSON.stringify(layout),
    );
    assert.equal(layout.filters.length, 3);
    for (const filter of layout.filters) {
      assert(
        Math.abs(filter.top - layout.filters[0].top) < 1,
        JSON.stringify(layout),
      );
      assert(filter.width >= 44 && filter.height >= 44, JSON.stringify(layout));
    }
    assert(
      layout.count.left >= layout.filters[2].right &&
        layout.count.left - layout.filters[2].right <= 9,
      JSON.stringify(layout),
    );
    assert(
      layout.count.top >= layout.filters[0].top &&
        layout.count.bottom <= layout.filters[0].bottom,
      JSON.stringify(layout),
    );
    assert(
      layout.reset.right <= layout.filterRow.right + 1 &&
        layout.reset.width >= 44 &&
        layout.reset.height >= 44,
      JSON.stringify(layout),
    );
    layouts.push(layout);
    await page.screenshot({
      path: path.join(evidence, `quiz-toolbars-${width}.png`),
    });
  }
  await page.getByRole("button", { name: "필터 초기화", exact: true }).click();
  for (const name of ["대단원", "중단원", "소단원"])
    assert.equal(
      await page
        .getByRole("combobox", { name: `모의고사 ${name} 필터`, exact: true })
        .inputValue(),
      "",
    );
  await page.getByRole("button", { name: "미리보기", exact: true }).click();
  const preview = page.getByRole("dialog", {
    name: "시험지 미리보기",
    exact: true,
  });
  await preview.waitFor();
  await preview.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "문제 등록", exact: true }).click();
  const composer = page.getByRole("dialog", {
    name: "새 문제 등록",
    exact: true,
  });
  await composer.waitFor();
  await composer
    .getByRole("button", { name: "문제 편집 닫기", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => window.assessmentTeacherFixture.writes.length),
    0,
  );
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify({ ok: true, layouts, external, errors }, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        evidence,
        widths: layouts.map((v) => v.width),
        writes: 0,
        externalRequests: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
