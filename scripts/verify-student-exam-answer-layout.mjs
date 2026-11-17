/** Actual student answer page, synthetic semester response, no external requests. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

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
const evidence = path.join(root, "output/student-exam-answer-layout");
await fs.mkdir(evidence, { recursive: true });
const modulePath = (value) =>
  JSON.stringify(path.join(root, value).replaceAll("\\", "/"));
const config = { year: "2026", semester: "2" };
const fixture = `
import React from 'react';
const scenario=new URLSearchParams(location.search).get('case');
const auth={config:${JSON.stringify(config)},menuConfig:null};
const answers={objective:[{score:4,answer:2}],subjective:[{subItems:[{score:6,answer:'백성의 부담을 줄이기 위해 공납을 쌀 등으로 납부하게 하였습니다.'}]}]};
window.examAnswerQA={reads:[]};
export const useAuth=()=>auth;
export const db={};
export const doc=(_db,path)=>({path});
export const getDoc=async ref=>{window.examAnswerQA.reads.push(ref.path);return {exists:()=>scenario!=='empty',data:()=>answers};};
export const PageLoading=({message})=><p role="status">{message}</p>;
`;
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import Page from ${modulePath("src/pages/student/History.tsx")};
import ${modulePath("src/assets/index.css")};
createRoot(document.getElementById('root')).render(<Page/>);`;
const bundle = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: path.join(os.tmpdir(), "exam-answer-layout.js"),
  loader: { ".svg": "dataurl", ".woff2": "dataurl", ".webp": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "synthetic-services",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /^(firebase\/firestore)$|(?:^|\/)(?:contexts\/AuthContext|lib\/firebase|components\/common\/LoadingState)$/,
          },
          () => ({ path: "fixture", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: fixture,
          loader: "tsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css = bundle.outputFiles
  .find((file) => file.path.endsWith(".css"))
  .text.replace(/@import\s+[^;]+;/g, "");
const tailwind = await fs.readFile(
  process.env.PORTAL_DESIGN_TAILWIND_PATH ||
    path.join(os.tmpdir(), "westory-qa-tailwind.js"),
  "utf8",
);
const server = http.createServer((request, response) => {
  const assets = {
    "/fixture.js": ["text/javascript", js],
    "/fixture.css": ["text/css", css],
    "/tailwind.js": ["text/javascript", tailwind],
  };
  const asset = assets[request.url];
  response.setHeader("Content-Type", asset?.[0] || "text/html");
  response.end(
    asset?.[1] ||
      '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  reducedMotion: "reduce",
});
const errors = [],
  checks = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", (route) =>
  new URL(route.request().url()).origin === base
    ? route.continue()
    : route.abort(),
);
try {
  for (const scenario of ["empty", "normal"]) {
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/?case=${scenario}`);
      await page.locator(".ws-page-header h1").waitFor();
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector(".ws-page")).paddingLeft !==
          "0px",
      );
      assert.deepEqual(await page.evaluate(() => window.examAnswerQA.reads), [
        "years/2026/semesters/2/exam_config/final_exam",
      ]);
      const style = await page
        .locator(".ws-page-header")
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            background: style.backgroundColor,
            shadow: style.boxShadow,
            position: style.position,
          };
        });
      assert.deepEqual(style, {
        background: "rgba(0, 0, 0, 0)",
        shadow: "none",
        position: "static",
      });
      if (scenario === "empty") {
        await page
          .getByText("아직 등록된 답안이 없습니다.", { exact: true })
          .waitFor();
        assert.equal(await page.locator("main > .bg-white").count(), 0);
      } else {
        assert.equal(await page.getByText(/정답을 확인한 후/).count(), 0);
        const objective = page.locator("main > section").first();
        await objective.getByRole("button", { name: "2", exact: true }).focus();
        await page.keyboard.press("Enter");
        await objective.getByText("O", { exact: true }).waitFor();
        await page
          .getByRole("button", { name: "정답 보기", exact: true })
          .focus();
        await page.keyboard.press("Enter");
        await page
          .getByText(
            "백성의 부담을 줄이기 위해 공납을 쌀 등으로 납부하게 하였습니다.",
            { exact: true },
          )
          .waitFor();
        await page
          .getByRole("button", { name: "정답 인정", exact: true })
          .focus();
        await page.keyboard.press("Enter");
        await page.waitForFunction(() =>
          document
            .querySelector(".ws-page-header .text-right")
            ?.textContent.includes("10/ 10점"),
        );
        await page.getByRole("button", { name: "오답", exact: true }).click();
        await page.waitForFunction(() =>
          document
            .querySelector(".ws-page-header .text-right")
            ?.textContent.includes("4/ 10점"),
        );
      }
      await page.screenshot({
        path: path.join(evidence, `${scenario}-${width}.png`),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
        `${scenario}/${width}: no page horizontal overflow`,
      );
      checks.push(
        `${scenario}/${width}: transparent header, semester read once, no overflow${scenario === "normal" ? ", keyboard answers and score changes preserved" : ""}`,
      );
    }
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(checks.join("\n"));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
