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
  export const currentUser={uid:"glass-fixture",email:"fixture@example.invalid",getIdTokenResult:async()=>({claims:{auth_time:Date.now()/1000}})};
  const subscribe=next=>{queueMicrotask(()=>next?.(currentUser));return ()=>{}};
  export const auth={currentUser,onAuthStateChanged:subscribe,onIdTokenChanged:subscribe}, getFirebaseFunctions=async()=>({}), getFirebaseStorage=async()=>({});
  export const getHttpsCallable=async()=>async()=>({data:{}});
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

// Compare the real frame with its glass hidden. No test style creates the glass or its backdrop.
async function comparePixels(page, name, { filterOnly = false } = {}) {
  const screenshot = () => page.screenshot({ animations: "disabled" });
  const visible = await screenshot();
  const control = await page.addStyleTag({
    content: filterOnly
      ? "#westory-top-glass::before {backdrop-filter:none !important;-webkit-backdrop-filter:none !important}"
      : "#westory-top-glass, dialog:modal::after, :fullscreen::after {visibility:hidden !important}",
  });
  let uncovered;
  try {
    uncovered = await screenshot();
  } finally {
    await control.evaluate((node) => node.remove());
  }
  await fs.writeFile(path.join(dir, name + ".png"), visible);
  await fs.writeFile(path.join(dir, name + "-control.png"), uncovered);
  const result = await page.evaluate(
    async ([a, b]) => {
      async function pixels(b64) {
        const image = new Image();
        image.src = "data:image/png;base64," + b64;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = 16;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      }
      const [on, off] = await Promise.all([pixels(a), pixels(b)]);
      let changed = 0,
        peak = 0;
      for (let i = 0; i < on.length; i += 4) {
        const diff = Math.max(
          ...[0, 1, 2].map((c) => Math.abs(on[i + c] - off[i + c])),
        );
        peak = Math.max(peak, diff);
        if (diff >= 3) changed++;
      }
      return { changed, peak };
    },
    [visible.toString("base64"), uncovered.toString("base64")],
  );
  assert(
    result.changed > 12 && result.peak >= 8,
    `${name}: glass did not visibly affect the actual page: ${JSON.stringify(result)}`,
  );
  console.log(name, result);
}
async function scenario(engine, inset) {
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
    await surface(page, inset);
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
      await surface(page, inset);
    } finally {
      resume();
    }
    const originalGlass = await page
      .locator("#westory-top-glass")
      .elementHandle();
    await page.locator('[data-patch-target="teacher-dashboard"]').waitFor();
    await surface(page, inset);
    console.log(
      "Browser display-mode standalone:",
      await page.evaluate(
        () => matchMedia("(display-mode: standalone)").matches,
      ),
    );
    await page.getByRole("button", { name: "교사 메뉴 열기" }).click();
    await page.locator(".teacher-sidebar-backdrop").waitFor();
    await surface(page, inset);
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
      await surface(page, inset);
    } finally {
      releaseSchedule();
    }
    await page.locator('[data-patch-target="teacher-schedule"]').waitFor();
    await surface(page, inset);
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
    await surface(page, inset);
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
    await surface(page, inset);
    await search.press("Escape");
    const card = page.locator(".history-dashboard article").nth(2);
    await card.evaluate((el) => {
      window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top + 18);
    });
    assert(
      await page.evaluate(() => scrollY > 0),
      "long route actually scrolls",
    );
    await surface(page, inset);
    const filterOnly = !webkit || process.platform !== "win32";
    if (!filterOnly)
      console.log(
        "Windows WebKit headless cannot rasterize backdrop blur; comparing the painted tint against the uncovered page.",
      );
    await comparePixels(page, `teacher-assignment-scroll-${label}`, {
      filterOnly,
    });
    await visit("/student/dashboard", ".student-portal-dashboard");
    await visit("/student/calendar", ".student-calendar-page");
    await visit("/student/lesson/maps", ".history-atlas__places-trigger");
    await page.getByRole("button", { name: "장소 목록 열기" }).click();
    await page.locator("dialog:modal").waitFor();
    await surface(page, inset, "dialog");
    await comparePixels(page, `student-map-dialog-${label}`);
    await page.keyboard.press("Escape");
    await page.locator("dialog:modal").waitFor({ state: "hidden" });
    await surface(page, inset);
    // Fullscreen an actual route element, using Playwright's trusted user gesture.
    if (await page.evaluate(() => document.fullscreenEnabled)) {
      await page
        .locator(".history-atlas-page")
        .evaluate((el) => el.requestFullscreen());
      await surface(page, inset, "fullscreen");
      await comparePixels(page, `student-map-fullscreen-${label}`);
      await page.evaluate(() => document.exitFullscreen());
      await surface(page, inset);
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
  } finally {
    await webkit.close();
  }
  console.log(
    "Mobile top glass passed across real routes, scrolling and top layers.",
  );
} finally {
  await browser.close();
  await server.close();
}
