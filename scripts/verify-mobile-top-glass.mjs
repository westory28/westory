/** Load the real index, App routes and CSS. Only authentication and data I/O use fixtures. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "westory-mobile-glass-"));
console.log("Mobile glass screenshots:", dir);
async function readTailwind() {
  if (process.env.PORTAL_DESIGN_TAILWIND_PATH)
    return fs.readFile(process.env.PORTAL_DESIGN_TAILWIND_PATH);
  const cache = path.join(os.tmpdir(), "westory-qa-tailwind.js");
  for (const candidate of [
    cache,
    path.join(os.tmpdir(), "westory-tailwind-fixture.js"),
  ]) {
    try {
      return await fs.readFile(candidate);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const appHtml = await fs.readFile(path.join(root, "index.html"), "utf8");
  const productionRuntime = appHtml.match(
    /<script\s+src="(https:\/\/cdn\.tailwindcss\.com(?:\/[^"]*)?)"/,
  )?.[1];
  assert(
    productionRuntime,
    "Set PORTAL_DESIGN_TAILWIND_PATH to the local production Tailwind runtime.",
  );
  // Like verify:portal-design, prepare the app's public runtime once. Fixture browsers stay offline.
  const response = await fetch(productionRuntime, {
    signal: AbortSignal.timeout(30000),
  });
  assert(
    response.ok &&
      new URL(response.url).origin === "https://cdn.tailwindcss.com" &&
      /(?:java|ecma)script/i.test(response.headers.get("content-type") || ""),
    "Cannot prepare Tailwind. For offline QA set PORTAL_DESIGN_TAILWIND_PATH.",
  );
  const runtime = Buffer.from(await response.arrayBuffer());
  assert(runtime.length > 0);
  await fs.writeFile(cache, runtime, { flag: "wx" }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  return runtime;
}
const localTailwind = await readTailwind();
const auth = `
  import { MENUS } from "/src/constants/menus.ts";
  import { currentUser } from "/src/lib/firebase.ts";
  const config = { year:"2026", semester:"2", showQuiz:true, showScore:true, showLesson:true };
  const noop = async () => {};
  export const AuthProvider = ({children}) => children;
  export const useAuth = () => ({ currentUser, user:currentUser, loading:false, authPhase:"ready",
    userData: { ...currentUser, role:location.hash.startsWith("#/teacher/") ? "teacher" : "student",
      name:"검증 사용자", grade:"3", class:"2", number:"1", staffPermissions:[] },
    authGeneration:1, config, configReady:true, menuConfig:MENUS, menuConfigReady:true,
    settingsLoadedAt:Date.now(), interfaceConfig:{}, refreshConfig:noop, refreshMenuConfig:noop, logout:noop });
`;
const firebase = `
  import { initializeApp } from "firebase/app";
  import { getFirestore } from "@firebase/firestore";
  export const app = initializeApp({ projectId:"demo-mobile-glass", apiKey:"synthetic-key" });
  export const db=getFirestore(app), analytics=null, authPersistenceReady=Promise.resolve(), configuredAuthDomain="localhost";
  const authTime=Math.floor(Date.now()/1000);
  export const currentUser={uid:"glass-fixture",email:"fixture@example.invalid",getIdTokenResult:async()=>({claims:{auth_time:authTime}})};
  const subscribe=next=>{queueMicrotask(()=>next?.(currentUser));return ()=>{}};
  export const auth={currentUser,onAuthStateChanged:subscribe,onIdTokenChanged:subscribe}, getFirebaseFunctions=async()=>({}), getFirebaseStorage=async()=>({});
  export const getHttpsCallable=async name=>async input=>({data:name==="openApplicationSession"
    ? {...input, status:"active", authTime, revision:"0".repeat(64)} : {}});
`;
const firestore = `
  export * from "@firebase/firestore";
  const time={seconds:Math.floor(Date.now()/1000)};
  const classrooms=Array.from({length:8},(_,index)=>({id:"assignment-"+index,data:()=>({
    title:"검증 과제 "+index+" 조선의 생활", isPublished:true, targetStudentUids:["glass-fixture"],
    targetStudentNames:["검증 사용자"], targetStudentUid:"glass-fixture", targetStudentName:"검증 사용자",
    createdAt:time,updatedAt:time,sourceType:"lesson",lessonUnitId:"test",passThresholdPercent:90})}));
  export const getDoc=async(ref)=>({id:ref.id,exists:()=>false,data:()=>undefined}), getDocFromServer=getDoc;
  export const getDocs=async(ref)=>{const docs=ref._query?.path?.lastSegment()==="history_classrooms"?classrooms:[];
    return {docs,size:docs.length,empty:!docs.length,forEach:callback=>docs.forEach(callback),docChanges:()=>[]}};
  export const getDocsFromServer=getDocs;
  export const onSnapshot=(ref,...args)=>{let active=true; const next=args.find(x=>typeof x==="function")??args.find(x=>x?.next)?.next;
    Promise.resolve(ref.type==="document"?getDoc(ref):getDocs(ref)).then(snap=>{if(active)next?.(snap)});return ()=>{active=false}};
  const refuse=()=>{throw Error("Synthetic glass fixture forbids database writes")};
  export const addDoc=refuse,updateDoc=refuse,deleteDoc=refuse,setDoc=refuse,writeBatch=refuse,runTransaction=refuse;
`;
const fixture = {
  name: "isolated-glass-browser",
  enforce: "pre",
  load(id) {
    if (id.endsWith("/src/contexts/AuthContext.tsx")) return auth;
    if (id.endsWith("/src/lib/firebase.ts")) return firebase;
    if (id.endsWith("/src/lib/archiveFirestore.ts")) return firestore;
  },
};
const outDir = path.join(dir, "dist");
await build({
  root,
  base: "/",
  envDir: dir,
  logLevel: "error",
  plugins: [fixture],
  build: { outDir, minify: false, reportCompressedSize: false },
});
const server = await preview({
  root,
  base: "/",
  envDir: dir,
  logLevel: "error",
  build: { outDir },
  preview: { host: "127.0.0.1", port: 0 },
});
const origin = "http://127.0.0.1:" + server.httpServer.address().port;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
});

async function surface(page, inset, layer = "document") {
  const result = await page.evaluate((layer) => {
    const glass = document.getElementById("westory-top-glass");
    const host =
      layer === "dialog"
        ? document.querySelector("dialog:modal")
        : layer === "fullscreen"
          ? document.fullscreenElement
          : glass || document.documentElement;
    const style = getComputedStyle(
      host,
      layer === "document" && glass ? "::before" : "::after",
    );
    const box = glass?.getBoundingClientRect();
    return {
      height:
        parseFloat(style.height) || (layer === "document" ? box?.height : 0),
      blur: style.backdropFilter,
      click: style.pointerEvents,
      y: box?.y,
      display: style.display,
      content: style.content,
    };
  }, layer);
  assert(
    result.height > inset && result.height >= 16,
    `${layer} edge must extend into page at inset ${inset}: ${JSON.stringify(result)}`,
  );
  assert.match(result.blur, /blur\(/);
  assert.equal(result.click, "none");
  if (layer === "document") assert.equal(result.y, 0);
}

// Compare the real frame with its glass hidden, or only its blur disabled.
// A uniform background SHOULD look the same with the glass turned off.
async function comparePixels(
  page,
  name,
  { textEdges = false, samples = [] } = {},
) {
  const visible = await page.screenshot({ animations: "disabled" });
  const control = await page.addStyleTag({
    content: textEdges
      ? "#westory-top-glass::before {backdrop-filter:none !important;-webkit-backdrop-filter:none !important}"
      : "#westory-top-glass, dialog:modal::after, :fullscreen::after {visibility:hidden !important}",
  });
  let uncovered;
  try {
    uncovered = await page.screenshot({ animations: "disabled" });
  } finally {
    await control.evaluate((node) => node.remove());
  }
  await Promise.all([
    fs.writeFile(path.join(dir, name + ".png"), visible),
    fs.writeFile(path.join(dir, name + "-control.png"), uncovered),
  ]);
  if (!samples.length && !textEdges) return;
  const result = await page.evaluate(
    async ({ frames, samples }) => {
      const height = document
        .getElementById("westory-top-glass")
        .getBoundingClientRect().height;
      async function pixels(base64) {
        const image = new Image();
        image.src = "data:image/png;base64," + base64;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = Math.ceil(height) + 10;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height);
      }
      const [on, off] = await Promise.all(frames.map(pixels));
      function patch(image, x, y) {
        const sums = [0, 0, 0];
        for (let j = y; j < y + 3; j++)
          for (let i = x - 4; i <= x + 4; i++) {
            const offset = (j * image.width + i) * 4;
            sums.forEach((_, c) => (sums[c] += image.data[offset + c]));
          }
        return sums.map((value) => Math.round(value / 27));
      }
      function edgeEnergy(image) {
        const luma = (offset) =>
          0.2126 * image.data[offset] +
          0.7152 * image.data[offset + 1] +
          0.0722 * image.data[offset + 2];
        let sum = 0;
        for (let y = 0; y < 8; y++)
          for (let x = 1; x < image.width; x++) {
            const offset = (y * image.width + x) * 4;
            const center = luma(offset);
            sum +=
              Math.abs(center - luma(offset - 4)) +
              Math.abs(center - luma(offset + image.width * 4));
          }
        return sum / (8 * (image.width - 1));
      }
      return {
        colors: samples.map((sample) => ({
          name: sample.name,
          top: patch(on, sample.x, 3),
          below: patch(on, sample.x, Math.ceil(height) + 3),
          uncovered: patch(off, sample.x, 3),
          uncoveredBelow: patch(off, sample.x, Math.ceil(height) + 3),
        })),
        sharp: edgeEnergy(off),
        blurred: edgeEnergy(on),
      };
    },
    {
      frames: [visible, uncovered].map((buffer) => buffer.toString("base64")),
      samples,
    },
  );
  const difference = (a, b) =>
    Math.max(...a.map((value, i) => Math.abs(value - b[i])));
  for (const [i, sample] of result.colors.entries()) {
    const message = name + " " + sample.name + ": " + JSON.stringify(sample);
    if (samples[i].expected)
      assert(
        difference(sample.uncovered, samples[i].expected) <= 2,
        "calibration failed: " + message,
      );
    assert(
      difference(sample.top, sample.uncovered) <= 3,
      "glass repainted a flat background: " + message,
    );
    // The real header can have a subtle gradient. The glass must not add a band of its own.
    const originalStep = difference(sample.uncovered, sample.uncoveredBelow);
    assert(
      difference(sample.top, sample.below) <= originalStep + 3,
      "visible seam added below glass: " + message,
    );
    if (samples[i].expected)
      assert(
        originalStep <= 2,
        "reference surface must be uniform: " + message,
      );
  }
  if (textEdges) {
    assert(
      result.sharp > 2,
      "test must observe actual sharp lettering: " + name,
    );
    assert(
      result.blurred < result.sharp * 0.6,
      "text outlines must soften: " + name + " " + JSON.stringify(result),
    );
  }
  console.log(name, JSON.stringify(result));
}

async function verifyContinuity(page, label) {
  // Middle of the real teacher dashboard's mobile header; the wordmark and menu occupy the sides.
  await comparePixels(page, "dashboard-" + label, {
    samples: [{ name: "dashboard", x: 195 }],
  });
  // This strip is test content behind the real production glass, never a replacement for the glass.
  const strip = await page.evaluateHandle(() => {
    const element = document.createElement("div");
    element.style.cssText =
      "position:fixed;inset:0 0 auto;height:150px;z-index:2147483646;pointer-events:none;background:linear-gradient(to right,white 0 33.333%,#2563eb 33.333% 66.667%,#059669 66.667% 100%)";
    document.body.append(element);
    return element;
  });
  try {
    await comparePixels(page, "colors-" + label, {
      samples: [
        { name: "white", x: 65, expected: [255, 255, 255] },
        { name: "blue", x: 195, expected: [37, 99, 235] },
        { name: "green", x: 325, expected: [5, 150, 105] },
      ],
    });
  } finally {
    await strip.evaluate((node) => node.remove());
    await strip.dispose();
  }
}

// The browser harness can exercise Westory's installed-app path, but cannot paint the
// native iOS status bar. Assert that no web box splits the title as it crosses that edge.
async function systemEdge(page, layer = "document") {
  const state = await page.evaluate((layer) => {
    const glass = document.getElementById("westory-top-glass");
    const topLayer =
      layer === "dialog"
        ? document.querySelector("dialog:modal")
        : layer === "fullscreen"
          ? document.fullscreenElement
          : null;
    return {
      viewport: document.querySelector('meta[name="viewport"]').content,
      forcedStatusStyle: !!document.querySelector(
        'meta[name="apple-mobile-web-app-status-bar-style"]',
      ),
      hostBoxes: glass.getClientRects().length,
      display: getComputedStyle(topLayer || glass, topLayer ? "::after" : null)
        .display,
      hasTopLayer: !!topLayer,
    };
  }, layer);
  assert.doesNotMatch(state.viewport, /viewport-fit\s*=\s*cover/);
  assert.equal(state.forcedStatusStyle, false);
  assert.equal(
    state.hostBoxes,
    0,
    "a fixed box would interfere with the native scroll edge",
  );
  assert.equal(state.display, "none");
  assert.equal(state.hasTopLayer, layer !== "document");
}

async function crossScheduleTitle(page) {
  const heading = page.getByRole("heading", { name: "이번 주 학사 일정" });
  await heading.waitFor();
  for (const y of [65, 59, 53]) {
    await heading.evaluate((el, y) => {
      window.scrollTo({
        top: scrollY + el.getBoundingClientRect().top - y,
        behavior: "instant",
      });
    }, y);
    const actual = await heading.boundingBox();
    assert(
      Math.abs(actual.y - y) <= 1,
      "the real schedule title must cross the reported position",
    );
    await systemEdge(page);
  }
  await page.screenshot({
    path: path.join(dir, "ios-home-schedule-title.png"),
    animations: "disabled",
  });
}

async function scenario(engine, inset, iosHome = false) {
  const webkit = engine.browserType().name() === "webkit";
  const label = engine.browserType().name() + "-" + inset;
  const page = await engine.newPage({
    ...(webkit ? playwright.devices["iPhone 13"] : {}),
    viewport: { width: 390, height: 780 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(15000);
  if (iosHome) {
    // Simulate the signal exposed by a Home Screen launch; keep the actual HTML and CSS.
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "standalone", { value: true }),
    );
  }
  const checkSurface = (layer) =>
    iosHome ? systemEdge(page, layer) : surface(page, inset, layer);
  if (!webkit) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", {
      insets: { top: inset, topMax: inset },
    });
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [
        { name: "display-mode", value: "standalone" },
        { name: "prefers-reduced-motion", value: "reduce" },
      ],
    });
  }
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "cdn.tailwindcss.com")
      return route.fulfill({
        contentType: "text/javascript",
        body: localTailwind,
      });
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/korean-holidays")
      return route.fulfill({ json: { holidays: [] } });
    return route.continue();
  });
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  const visit = async (hash, selector) => {
    await page.evaluate((hash) => {
      location.hash = hash;
    }, hash);
    await page.locator(selector).first().waitFor();
    await checkSurface();
  };
  try {
    let resume, started;
    const entry = new Promise((resolve) => {
      started = resolve;
    });
    const pause = new Promise((resolve) => {
      resume = resolve;
    });
    await page.route(/\/assets\/main-[^/]+\.js$/, async (route) => {
      started();
      await pause;
      await route.continue();
    });
    await page.goto(origin + "/#/teacher/dashboard", { waitUntil: "commit" });
    await entry;
    await page.locator("#root").waitFor({ state: "attached" });
    try {
      await checkSurface();
    } finally {
      resume();
    }
    const originalGlass = await page
      .locator("#westory-top-glass")
      .elementHandle();
    await page.locator('[data-patch-target="teacher-dashboard"]').waitFor();
    await checkSurface();
    // Let optional dashboard widgets mount, then dismiss any synthetic-session notices in the header.
    await page
      .locator("[data-patch-memo-root]")
      .first()
      .waitFor({ state: "attached" });
    for (const close of await page.locator(".ws-toast__close").all())
      await close.click();
    if (iosHome) {
      await crossScheduleTitle(page);
      await visit(
        "/teacher/quiz/history-classroom",
        ".history-dashboard article",
      );
      await visit("/student/lesson/maps", ".history-atlas__places-trigger");
      await page.getByRole("button", { name: "장소 목록 열기" }).click();
      await page.locator("dialog:modal").waitFor();
      await checkSurface("dialog");
      await page.keyboard.press("Escape");
      await page.locator("dialog:modal").waitFor({ state: "hidden" });
      if (await page.evaluate(() => document.fullscreenEnabled)) {
        await page
          .locator(".history-atlas-page")
          .evaluate((el) => el.requestFullscreen());
        await checkSurface("fullscreen");
        await page.evaluate(() => document.exitFullscreen());
      }
      for (const file of ["2026-10-28", "before-2026-10-28"]) {
        await page.goto(origin + "/legal/" + file + ".html");
        await checkSurface();
      }
      assert.deepEqual(failures, []);
      console.log(
        "iOS Home Screen signal: system viewport and no fixed web glass across title, menus and windows.",
      );
      return;
    }
    assert.match(
      await page.locator('meta[name="viewport"]').getAttribute("content"),
      /viewport-fit\s*=\s*cover/,
    );
    await verifyContinuity(page, label);
    console.log(
      "Browser display-mode standalone:",
      await page.evaluate(
        () => matchMedia("(display-mode: standalone)").matches,
      ),
    );
    await page.getByRole("button", { name: "교사 메뉴 열기" }).click();
    await page.locator(".teacher-sidebar-backdrop").waitFor();
    await checkSurface();
    await comparePixels(page, `teacher-menu-overlay-${label}`);
    await page.getByRole("button", { name: "메뉴 닫기" }).click();
    let releaseSchedule;
    const scheduleGate = new Promise((resolve) => {
      releaseSchedule = resolve;
    });
    await page.route(/\/assets\/ManageSchedule-[^/]+\.js$/, async (route) => {
      await scheduleGate;
      await route.continue();
    });
    await page.getByRole("link", { name: "전체 캘린더 보기" }).click();
    try {
      await page.locator(".ws-loading-inline").waitFor();
      await checkSurface();
    } finally {
      releaseSchedule();
    }
    await page.locator('[data-patch-target="teacher-schedule"]').waitFor();
    await checkSurface();
    await visit(
      "/teacher/quiz/history-classroom",
      ".history-dashboard article",
    );
    assert(
      await originalGlass.evaluate(
        (node) => node === document.getElementById("westory-top-glass"),
      ),
      "the same surface persists across SPA routes",
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".history-dashboard article").first().waitFor();
    await checkSurface();
    await page.getByRole("button", { name: "과제 검색 열기" }).click();
    const search = page.getByRole("searchbox", {
      name: "과제명, 학생 이름, 학번 검색",
    });
    await search.fill("일치하지 않는 합성 과제명");
    await page
      .getByText("현재 검색 조건에 맞는 역사교실이 없습니다.")
      .waitFor();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight + 1,
      ),
      "empty results fit without document scrolling",
    );
    await checkSurface();
    await search.press("Escape");
    const card = page.locator(".history-dashboard article").nth(2);
    await card.evaluate((el) => {
      window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top + 18);
    });
    assert(
      await page.evaluate(() => scrollY > 0),
      "long route actually scrolls",
    );
    await checkSurface();
    const textEdges = !webkit || process.platform !== "win32";
    if (!textEdges)
      console.log(
        "Windows WebKit headless cannot rasterize backdrop blur. Geometry and flat-color continuity are checked on this engine.",
      );
    await comparePixels(page, `teacher-assignment-scroll-${label}`, {
      textEdges,
    });
    await visit("/student/dashboard", ".student-portal-dashboard");
    await visit("/student/calendar", ".student-calendar-page");
    await visit("/student/lesson/maps", ".history-atlas__places-trigger");
    await page.getByRole("button", { name: "장소 목록 열기" }).click();
    await page.locator("dialog:modal").waitFor();
    await checkSurface("dialog");
    await comparePixels(page, `student-map-dialog-${label}`);
    await page.keyboard.press("Escape");
    await page.locator("dialog:modal").waitFor({ state: "hidden" });
    await checkSurface();
    // Fullscreen an actual route element, using Playwright's trusted user gesture.
    if (await page.evaluate(() => document.fullscreenEnabled)) {
      await page
        .locator(".history-atlas-page")
        .evaluate((el) => el.requestFullscreen());
      await checkSurface("fullscreen");
      await comparePixels(page, `student-map-fullscreen-${label}`);
      await page.evaluate(() => document.exitFullscreen());
      await checkSurface();
    } else console.log(label, "native fullscreen unavailable");
    assert.deepEqual(failures, []);
  } catch (error) {
    console.error(
      page.url(),
      failures,
      (await page.locator("body").innerText()).slice(0, 600),
    );
    throw error;
  } finally {
    await page.close();
  }
}
try {
  for (const inset of [0, 47]) await scenario(browser, inset);
  const webkit = await playwright.webkit.launch();
  try {
    await scenario(webkit, 0);
    await scenario(webkit, 0, true);
  } finally {
    await webkit.close();
  }
  for (const pathname of [
    "/",
    "/legal/2026-10-28.html",
    "/legal/before-2026-10-28.html",
  ]) {
    const tab = await browser.newPage();
    try {
      const response = await fetch(new URL(pathname, origin));
      assert(response.ok);
      const metadata = await tab.evaluate(
        (html) => {
          const doc = new DOMParser().parseFromString(html, "text/html");
          const metas = Array.from(doc.querySelectorAll("meta"), (element) => [
            element.name.toLowerCase(),
            element.content.toLowerCase(),
          ]);
          return Object.fromEntries(metas);
        },
        await response.text(),
      );
      assert.equal(
        metadata["apple-mobile-web-app-status-bar-style"],
        undefined,
        pathname + " still overrides the native status bar",
      );
      assert.doesNotMatch(metadata.viewport, /viewport-fit\s*=\s*cover/);
      assert.equal(metadata["theme-color"], "#f9fafb");
    } finally {
      await tab.close();
    }
  }
  console.log(
    "Mobile top glass passed across real routes, scrolling and top layers.",
  );
} finally {
  await browser.close();
  await server.close();
}
