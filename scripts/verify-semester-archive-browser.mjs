/**
 * Real-browser component integration check. AuthContext and Firestore reads use
 * synthetic fixtures; launcher, boundary, banner, scope and SDK write guards
 * are the repository's actual modules. No Firebase network request is allowed.
 * Requires npm run build for the existing application CSS and Playwright Edge.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
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
const output = await fs.mkdtemp(
  path.join(os.tmpdir(), "westory-archive-browser-"),
);
const assetDir = path.join(root, "dist/assets");
const cssName = (await fs.readdir(assetDir)).find((name) =>
  /^main-.*\.css$/.test(name),
);
assert(cssName, "Run npm run build before the browser check");
const css = await fs.readFile(path.join(assetDir, cssName), "utf8");
const modulePath = (relative) =>
  JSON.stringify(path.join(root, relative).replaceAll("\\", "/"));
const config = {
  year: "2026",
  semester: "2",
  showLesson: true,
  showQuiz: true,
  showScore: true,
  availableSemesters: [
    { year: "2026", semester: "2" },
    { year: "2026", semester: "1" },
    { year: "2025", semester: "2" },
    { year: "2025", semester: "1" },
  ],
};
const fixtureModules = {
  auth: `
    import { archiveScope, isSemesterArchive } from ${modulePath("src/lib/semesterArchive.ts")};
    const mode = new URLSearchParams(location.search).get("qaAuth");
    const currentUser = mode === "none" ? null : { uid: "qa-admin", email: "qa@example.invalid" };
    const config = ${JSON.stringify(config)};
    export const useAuth = () => ({ currentUser, user: currentUser,
      userData: currentUser ? { uid: currentUser.uid, role: mode === "student" ? "student" : "teacher" } : null,
      config: isSemesterArchive && archiveScope ? { ...config, ...archiveScope } : config,
      loading: false, configReady: true });
  `,
  firebase: `
    import { initializeApp } from "firebase/app";
    import { getFirestore } from "@firebase/firestore";
    export const db = getFirestore(initializeApp({ projectId: "demo-westory-archive-qa", apiKey: "synthetic" }));
  `,
  firestore: `
    export * from ${modulePath("src/lib/archiveFirestore.ts")};
    const config = ${JSON.stringify(config)};
    const read = async (ref) => {
      window.__fixtureReads = [...(window.__fixtureReads || []), ref.path];
      if (ref.path !== "site_settings/config") throw new Error("Unexpected fixture read: " + ref.path);
      return { exists: () => true, data: () => config };
    };
    export const getDoc = read;
    export const getDocFromServer = read;
  `,
};
const harness = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import { HashRouter, Link, useLocation } from "react-router-dom";
  import Launcher from ${modulePath("src/pages/teacher/components/SettingsSemesterArchive.tsx")};
  import { SemesterArchiveBoundary, SemesterArchiveBanner, SemesterArchiveUnavailable, isArchiveUnavailableRoute } from ${modulePath("src/components/common/SemesterArchiveBoundary.tsx")};
  import { archiveScope, isSemesterArchive, getArchiveReadPath } from ${modulePath("src/lib/semesterArchive.ts")};
  import { getYearSemester } from ${modulePath("src/lib/semesterScope.ts")};
  import { readStorage, writeStorage, removeStorage } from ${modulePath("src/lib/safeStorage.ts")};
  import * as firestore from ${modulePath("src/lib/archiveFirestore.ts")};
  import * as storage from ${modulePath("src/lib/archiveStorage.ts")};
  import * as auth from ${modulePath("src/lib/archiveAuth.ts")};
  import { db } from "fixture:firebase";
  window.archiveQa = {
    scope: () => getYearSemester({ year: "2026", semester: "2" }),
    path: (p) => getArchiveReadPath(p),
    mutations: async () => {
      const outcomes = {};
      for (const [name, fn] of Object.entries({
        setDoc: () => firestore.setDoc(firestore.doc(db, "site_settings/config"), {}),
        updateDoc: () => firestore.updateDoc(firestore.doc(db, "site_settings/config"), {}),
        deleteDoc: () => firestore.deleteDoc(firestore.doc(db, "site_settings/config")),
        addDoc: () => firestore.addDoc(firestore.collection(db, "users"), {}),
        writeBatch: () => firestore.writeBatch(db),
        transaction: () => firestore.runTransaction(db, async () => null),
        upload: () => storage.uploadBytes(null, new Uint8Array()),
        deleteObject: () => storage.deleteObject(null),
        signOut: () => auth.signOut(null),
        signIn: () => auth.signInWithCustomToken(null, "synthetic"),
      })) { try { await fn(); outcomes[name] = "UNGUARDED"; } catch (e) { outcomes[name] = e.code || e.message; } }
      return outcomes;
    },
    storage: () => {
      writeStorage("sessionExpiry", "archive-only");
      const result = readStorage("sessionExpiry");
      removeStorage("westoryPortalRole");
      return result;
    },
  };
  function Content() {
    const location = useLocation();
    return <>
      <header className="border-b border-gray-200 bg-white px-6 py-4 font-bold text-blue-600">Westory</header>
      <SemesterArchiveBanner />
      <nav aria-label="검증용 교사 메뉴" className="flex flex-wrap gap-4 p-4">
        <Link to="/teacher/dashboard">첫 화면</Link>
        <Link to="/teacher/lesson?archiveYear=2099&archiveSemester=2">수업 자료</Link>
        <Link to="/teacher/settings">관리자 설정</Link>
      </nav>
      {isArchiveUnavailableRoute(location.pathname) ? <SemesterArchiveUnavailable /> :
        <main className="p-6"><h1 className="text-xl font-bold">선택 학기 화면 검증</h1>
          <p data-testid="scope">{getYearSemester(null).year}학년도 {getYearSemester(null).semester}학기</p>
          <p data-testid="route">{location.pathname}</p>
        </main>}
    </>;
  }
  createRoot(document.getElementById("root")).render(<HashRouter>
    {isSemesterArchive ? <SemesterArchiveBoundary><Content /></SemesterArchiveBoundary> :
      <div className="min-h-screen bg-gray-50 p-4 sm:p-8"><Launcher /></div>}
  </HashRouter>);
`;
const result = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "controlled-read-fixtures",
      setup(plugin) {
        plugin.onResolve({ filter: /^fixture:/ }, (args) => ({
          path: args.path.slice(8),
          namespace: "fixture",
        }));
        plugin.onResolve({ filter: /(?:^|\/)contexts\/AuthContext$/ }, () => ({
          path: "auth",
          namespace: "fixture",
        }));
        plugin.onResolve(
          { filter: /(?:^|\/)lib\/firebase$|^\.\/firebase$/ },
          () => ({ path: "firebase", namespace: "fixture" }),
        );
        plugin.onResolve({ filter: /^firebase\/firestore$/ }, () => ({
          path: "firestore",
          namespace: "fixture",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: fixtureModules[args.path],
          loader: "ts",
          resolveDir: root,
        }));
      },
    },
  ],
});
const bundle = result.outputFiles[0].text;
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>위스토리 검증</title><script src="https://cdn.tailwindcss.com"></script><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>`;
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  response.setHeader(
    "Content-Type",
    pathname === "/qa.js"
      ? "text/javascript"
      : pathname === "/style.css"
        ? "text/css"
        : "text/html; charset=utf-8",
  );
  response.end(
    pathname === "/qa.js" ? bundle : pathname === "/style.css" ? css : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await playwright.chromium.launch({
  channel: "msedge",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 960 },
});
const unexpectedNetwork = [];
const pageErrors = [];
const screenshots = [];
context.on("page", (page) =>
  page.on("pageerror", (error) => pageErrors.push(error.message)),
);
await context.route("**/*", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin === new URL(base).origin) return route.continue();
  if (
    request.method() === "GET" &&
    [
      "cdn.tailwindcss.com",
      "fonts.googleapis.com",
      "fonts.gstatic.com",
    ].includes(url.hostname)
  )
    return route.continue();
  unexpectedNetwork.push(`${request.method()} ${url.origin}${url.pathname}`);
  return route.abort();
});
const expectVisible = async (locator) => {
  await locator.waitFor({ state: "visible", timeout: 15000 });
};
const screenshot = async (page, label, width) => {
  await page.setViewportSize({ width, height: 960 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".bg-blue-600") || document.body)
        .backgroundColor !== "rgba(0, 0, 0, 0)",
  );
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    `${label} overflows at ${width}`,
  );
  const filename = path.join(output, `${label}-${width}.png`);
  await page.screenshot({ path: filename, fullPage: true });
  screenshots.push(filename);
};
try {
  const parent = await context.newPage();
  await parent.goto(base);
  await expectVisible(parent.getByRole("button", { name: "조회하기 (새 창)" }));
  assert.equal(await parent.getByText("조회 자료", { exact: true }).count(), 0);
  assert.equal(await parent.locator("#archive-year option").count(), 2);
  assert.equal(await parent.locator("#archive-semester option").count(), 1);
  await parent.getByLabel("학년도", { exact: true }).selectOption("2025");
  assert.equal(await parent.locator("#archive-semester option").count(), 2);
  await parent.getByLabel("학기", { exact: true }).selectOption("2025-1");
  for (const width of [390, 768, 1280])
    await screenshot(parent, "launcher", width);
  assert.equal(
    await parent
      .getByRole("button", { name: "조회하기 (새 창)" })
      .evaluate((element) => getComputedStyle(element).backgroundColor),
    "rgb(37, 99, 235)",
  );
  await parent.evaluate(() => {
    localStorage.setItem("sessionExpiry", "operating-session");
    localStorage.setItem("westoryPortalRole", "teacher");
  });
  const popupPromise = context.waitForEvent("page");
  await parent.getByRole("button", { name: "조회하기 (새 창)" }).click();
  const archive = await popupPromise;
  await expectVisible(archive.getByTestId("scope"));
  assert.equal(new URL(archive.url()).searchParams.get("archiveYear"), "2025");
  assert.equal(new URL(archive.url()).searchParams.get("archiveSemester"), "1");
  assert.equal(await archive.evaluate(() => window.opener), null);
  assert.equal(
    await archive.getByTestId("scope").textContent(),
    "2025학년도 1학기",
  );
  for (const width of [390, 768, 1280])
    await screenshot(archive, "archive", width);
  await archive.getByRole("link", { name: "수업 자료", exact: true }).click();
  await expectVisible(
    archive.getByTestId("route").filter({ hasText: "/teacher/lesson" }),
  );
  assert.deepEqual(await archive.evaluate(() => window.archiveQa.scope()), {
    year: "2025",
    semester: "1",
  });
  assert.equal(
    await archive.evaluate(() =>
      window.archiveQa.path("years/2026/semesters/2/lessons"),
    ),
    "years/2025/semesters/1/lessons",
  );
  assert.equal(
    await archive.evaluate(() => window.archiveQa.path("lessons")),
    "years/2025/semesters/1/lessons",
  );
  await archive.reload();
  await expectVisible(archive.getByTestId("scope"));
  assert.equal(
    await archive.getByTestId("scope").textContent(),
    "2025학년도 1학기",
  );
  const writes = await archive.evaluate(() => window.archiveQa.mutations());
  assert(
    Object.values(writes).every((value) => value === "archive/read-only"),
    JSON.stringify(writes),
  );
  assert.equal(
    await archive.evaluate(() => window.archiveQa.storage()),
    "archive-only",
  );
  assert.deepEqual(
    await parent.evaluate(() => [
      localStorage.getItem("sessionExpiry"),
      localStorage.getItem("westoryPortalRole"),
    ]),
    ["operating-session", "teacher"],
  );
  assert.deepEqual(await parent.evaluate(() => window.archiveQa.scope()), {
    year: "2026",
    semester: "2",
  });
  assert.equal(new URL(parent.url()).search, "");
  await archive.getByRole("link", { name: "관리자 설정", exact: true }).click();
  await expectVisible(
    archive.getByText("학기별 보관 자료가 없는 메뉴입니다.", { exact: true }),
  );
  await archive.goto(
    `${base}?archiveYear=2025&archiveSemester=1#/student/score`,
  );
  await expectVisible(
    archive.getByTestId("route").filter({ hasText: "/teacher/dashboard" }),
  );
  const denied = await context.newPage();
  for (const [query, message] of [
    [
      "archiveYear=wrong&archiveSemester=1",
      "조회할 연도와 학기를 확인해 주세요.",
    ],
    ["archiveYear=2025", "조회할 연도와 학기를 확인해 주세요."],
    ["archiveYear=2026&archiveSemester=2", "등록된 이전 학기가 아닙니다."],
    ["archiveYear=2024&archiveSemester=1", "등록된 이전 학기가 아닙니다."],
    [
      "archiveYear=2025&archiveSemester=1&qaAuth=none",
      "운영 창에서 관리자 계정으로 로그인한 뒤",
    ],
    [
      "archiveYear=2025&archiveSemester=1&qaAuth=student",
      "운영 창에서 관리자 계정으로 로그인한 뒤",
    ],
  ]) {
    await denied.goto(`${base}?${query}#/teacher/dashboard`);
    await expectVisible(denied.getByRole("alert").filter({ hasText: message }));
    assert.equal(await denied.getByTestId("scope").count(), 0);
    const result = await denied.evaluate(() => window.archiveQa.mutations());
    assert(
      Object.values(result).every(
        (value) =>
          value === "archive/read-only" ||
          value === "조회할 연도와 학기를 확인해 주세요.",
      ),
      JSON.stringify(result),
    );
  }
  assert.deepEqual(pageErrors, [], "Unhandled browser exceptions");
  assert.deepEqual(
    unexpectedNetwork,
    [],
    "Unexpected network, including any Firebase calls",
  );
  const report = {
    passed: true,
    scope:
      "actual component integration with synthetic auth and config reads; real SDK write guards",
    writes,
    screenshots,
    pageErrors,
    unexpectedNetwork,
  };
  await fs.writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
