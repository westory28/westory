import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const evidence = await fs.mkdtemp(
  path.join(os.tmpdir(), "westory-asset-recovery-"),
);
const compiled = await build({
  entryPoints: [path.join(root, "src/lib/assetRecovery.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { createAssetRecoveryController, isAssetLoadFailure } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);
const failure = Error(
  "Unable to preload CSS for /assets/GongsinmoongoWorkspace-old.css",
);
for (const message of [
  failure.message,
  "Failed to fetch dynamically imported module",
  "Importing a module script failed",
  "ChunkLoadError: Loading chunk 4 failed",
])
  assert(isAssetLoadFailure(Error(message)));
assert(!isAssetLoadFailure(Error("Permission denied")));
const unitChecks = [];
async function check(name, overrides, expected, counts) {
  let reads = 0,
    reloads = 0,
    reservations = 0;
  const env = {
    online: () => true,
    hasDraft: () => false,
    currentEntry: () => "https://fixture.invalid/assets/old.js",
    latestEntry: async () => {
      reads++;
      return "https://fixture.invalid/assets/new.js";
    },
    reserveReload: () => {
      reservations++;
      return true;
    },
    reload: () => {
      reloads++;
    },
    ...overrides,
  };
  const recover = createAssetRecoveryController(env);
  const [first, duplicate] = await Promise.all([
    recover(failure),
    recover(failure),
  ]);
  assert.equal(first, expected, name);
  assert.equal(duplicate, expected, `${name}: shared event/boundary outcome`);
  assert.deepEqual({ reads, reloads, reservations }, counts, name);
  unitChecks.push(name);
}
await check(
  "one check and reload for concurrent event/boundary",
  {},
  "reloading",
  { reads: 1, reloads: 1, reservations: 1 },
);
await check("offline performs no check", { online: () => false }, "offline", {
  reads: 0,
  reloads: 0,
  reservations: 0,
});
await check("editing performs no check", { hasDraft: () => true }, "draft", {
  reads: 0,
  reloads: 0,
  reservations: 0,
});
await check(
  "same build does not reload",
  { currentEntry: () => "https://fixture.invalid/assets/new.js" },
  "current-version",
  { reads: 1, reloads: 0, reservations: 0 },
);
await check(
  "retry reservation prevents navigation",
  { reserveReload: () => false },
  "retry-limit",
  { reads: 1, reloads: 0, reservations: 0 },
);
await check(
  "fetch rejection reaches error",
  {
    latestEntry: async () => {
      throw Error("Network failed");
    },
  },
  "unavailable",
  { reads: 0, reloads: 0, reservations: 0 },
);
let edited = false;
await check(
  "editing during version check prevents reload",
  {
    hasDraft: () => edited,
    latestEntry: async () => {
      edited = true;
      return "new";
    },
  },
  "draft",
  { reads: 0, reloads: 0, reservations: 0 },
);
let online = true;
await check(
  "disconnect during check prevents reload",
  {
    online: () => online,
    latestEntry: async () => {
      online = false;
      return "new";
    },
  },
  "offline",
  { reads: 0, reloads: 0, reservations: 0 },
);

const modulePath = (file) =>
  JSON.stringify(path.join(root, file).replaceAll("\\", "/"));
const bundle = await build({
  stdin: {
    contents: `import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import ErrorBoundary from ${modulePath("src/components/common/ErrorBoundary.tsx")};
import {LoadingProvider} from ${modulePath("src/components/common/LoadingState.tsx")};
import {installAssetRecovery,markAssetRecoveryEdited} from ${modulePath("src/lib/assetRecovery.ts")};
installAssetRecovery();
const mode=new URLSearchParams(location.search).get('case');
const current=document.querySelector('script[type="module"]').src;
function Fixture(){
 const [failed,setFailed]=useState(false);
 const fail=()=>{const error=new Error('Unable to preload CSS for /assets/GongsinmoongoWorkspace-old.css');const event=new Event('vite:preloadError',{cancelable:true});event.payload=error;window.dispatchEvent(event);setFailed(true);};
 if(failed)throw new Error('Unable to preload CSS for /assets/GongsinmoongoWorkspace-old.css');
 if(current.endsWith('/new.js')&&mode!=='repeat')return <p>새 버전 화면</p>;
 return <div><textarea aria-label="초안"/><button onClick={markAssetRecoveryEdited}>답안 선택</button><button onClick={fail}>파일 오류 발생</button></div>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><LoadingProvider><ErrorBoundary><Fixture/></ErrorBoundary></LoadingProvider></React.StrictMode>);`,
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  outfile: "fixture.js",
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".png": "dataurl", ".webp": "dataurl", ".svg": "dataurl" },
  plugins: [
    {
      name: "cancelled-navigation-fixture",
      setup(plugin) {
        plugin.onLoad({ filter: /assetRecovery\.ts$/ }, async (args) => ({
          contents: (await fs.readFile(args.path, "utf8")).replace(
            "reload: () => window.location.reload(),",
            "reload: () => { if(new URLSearchParams(location.search).get('case')!=='cancelled') window.location.reload(); },",
          ),
          loader: "ts",
          resolveDir: path.dirname(args.path),
        }));
      },
    },
  ],
});
const js = bundle.outputFiles.find((file) => file.path.endsWith(".js")).text;
const css =
  bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "";
const counts = new Map();
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://fixture.invalid");
  if (url.pathname.endsWith(".js")) {
    response.setHeader("Content-Type", "text/javascript");
    response.end(js);
    return;
  }
  if (url.pathname === "/fixture.css") {
    response.setHeader("Content-Type", "text/css");
    response.end(css);
    return;
  }
  if (url.pathname !== "/") {
    response.writeHead(404).end();
    return;
  }
  const mode = url.searchParams.get("case");
  const state = counts.get(mode) || { documents: 0, checks: 0 };
  counts.set(mode, state);
  const documentRequest = request.headers["sec-fetch-dest"] === "document";
  if (documentRequest) state.documents++;
  else state.checks++;
  if (!documentRequest && ["network", "manual"].includes(mode)) {
    response
      .writeHead(503, { "Content-Type": "text/plain" })
      .end("unavailable");
    return;
  }
  if (!documentRequest)
    await new Promise((resolve) => setTimeout(resolve, 180));
  const latest =
    mode !== "unchanged" && (!documentRequest || state.documents > 1);
  const entry =
    mode === "repeat" && !documentRequest && state.checks > 1
      ? "next"
      : latest
        ? "new"
        : "old";
  response.setHeader("Content-Type", "text/html");
  response.setHeader("Cache-Control", "no-store");
  response.end(
    `<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/assets/${entry}.js"></script></body></html>`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
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
const browser = await playwright.chromium.launch({
  channel: "msedge",
  headless: true,
});
const browserChecks = [];
try {
  for (const mode of [
    "updated",
    "unchanged",
    "offline",
    "draft",
    "choice-draft",
    "storage",
    "network",
    "repeat",
    "cancelled",
    "manual",
  ]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : route.abort(),
    );
    if (mode === "offline")
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "onLine", { get: () => false }),
      );
    if (mode === "storage")
      await page.addInitScript(() =>
        Object.defineProperty(window, "sessionStorage", {
          get: () => {
            throw Error("Storage denied");
          },
        }),
      );
    await page.goto(`${origin}/?case=${mode}#/teacher/gongsinmoongo`);
    if (mode === "draft")
      await page
        .getByRole("textbox", { name: "초안" })
        .fill("기기에만 남겨야 하는 초안");
    if (mode === "choice-draft")
      await page.getByRole("button", { name: "답안 선택" }).click();
    await page.getByRole("button", { name: "파일 오류 발생" }).click();
    if (mode === "updated") {
      await page.locator('[data-loading-scope="screen"]').waitFor();
      await page.getByText("새 버전 화면").waitFor();
      assert.equal(new URL(page.url()).hash, "#/teacher/gongsinmoongo");
      assert.deepEqual(counts.get(mode), { documents: 2, checks: 1 });
    } else {
      if (mode === "repeat")
        await page.getByRole("button", { name: "파일 오류 발생" }).click();
      await page
        .getByRole("heading", { name: "페이지를 불러오지 못했습니다." })
        .waitFor();
      await page
        .locator('[data-loading-scope="screen"]')
        .waitFor({ state: "hidden" });
      assert.equal(
        await page.locator('[data-loading-scope="screen"]').count(),
        0,
        `${mode}: no permanent loading`,
      );
      assert.equal(
        await page.locator("details").getAttribute("open"),
        null,
        `${mode}: technical error collapsed`,
      );
      const expected = ["offline", "draft", "choice-draft"].includes(mode)
        ? 0
        : mode === "repeat"
          ? 2
          : 1;
      assert.deepEqual(counts.get(mode), {
        documents: mode === "repeat" ? 2 : 1,
        checks: expected,
      });
      if (mode === "offline")
        await page.getByText(/인터넷 연결이 끊겨/).waitFor();
      if (["draft", "choice-draft"].includes(mode))
        await page.getByText(/입력 중이던 내용이 있어/).waitFor();
      if (mode === "choice-draft") {
        await page
          .getByText(/저장하지 않은 내용이 사라질 수 있습니다/)
          .waitFor();
        await page.getByRole("button", { name: "다시 불러오기" }).click();
        await page.getByText("새 버전 화면").waitFor();
        assert.deepEqual(counts.get(mode), { documents: 2, checks: 0 });
      }
      if (["storage", "cancelled", "repeat"].includes(mode))
        await page.getByText(/새 버전으로 자동 복구하지 못했습니다/).waitFor();
      if (mode === "manual") {
        await page.getByRole("button", { name: "다시 불러오기" }).click();
        await page.getByText("새 버전 화면").waitFor();
        assert.deepEqual(counts.get(mode), { documents: 2, checks: 1 });
      }
    }
    await page.screenshot({
      path: path.join(evidence, `${mode}.png`),
      fullPage: true,
    });
    browserChecks.push({ mode, ...counts.get(mode) });
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify({ unitChecks, browserChecks }, null, 2),
  );
}
console.log(
  `Asset recovery: ${unitChecks.length} isolated checks and ${browserChecks.length} browser scenarios passed. Evidence: ${evidence}`,
);
