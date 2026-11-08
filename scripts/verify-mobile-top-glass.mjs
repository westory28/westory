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
const expectedViewport = "width=device-width, initial-scale=1.0";
const results = [];

// These are the actual app routes and menus, with only auth/data replaced above.
// A desktop WebKit/Chromium signal cannot reproduce the native iOS status bar.
async function stableTopEdge(page, label, layer) {
  const state = await page.evaluate((layer) => {
    const host =
      layer === "dialog"
        ? document.querySelector("dialog:modal")
        : layer === "fullscreen"
          ? document.fullscreenElement
          : null;
    const glass = document.getElementById("westory-top-glass");
    const pseudo = host && getComputedStyle(host, "::after");
    const glassStyle = glass && getComputedStyle(glass);
    return {
      viewport: document.querySelector('meta[name="viewport"]')?.content,
      status: document.querySelector(
        'meta[name="apple-mobile-web-app-status-bar-style"]',
      )?.content,
      glassBoxes: glass?.getClientRects().length || 0,
      glassBlur: glassStyle?.backdropFilter || "none",
      pseudoContent: pseudo?.content || "none",
      pseudoBlur: pseudo?.backdropFilter || "none",
      pseudoWebkitBlur: pseudo?.webkitBackdropFilter || "none",
      hasLayer: !!host,
      legacyFlags: ["data-system-top-edge", "data-ios-home-screen"].filter(
        (name) => document.documentElement.hasAttribute(name),
      ),
      emptyToastOpen: !!document.querySelector(
        ".ws-toast-layer:popover-open:not(:has(.ws-toast))",
      ),
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  }, layer);
  assert.equal(state.viewport, expectedViewport, label + " changed viewport");
  assert.equal(state.status, "default", label + " changed status bar policy");
  assert.equal(state.glassBoxes, 0, label + " retains a visible top glass");
  assert.equal(state.glassBlur, "none", label + " retains backdrop blur");
  assert.equal(state.pseudoBlur, "none", label + " adds top-layer blur");
  assert.equal(state.pseudoWebkitBlur, "none", label + " adds WebKit blur");
  assert(
    ["none", "normal"].includes(state.pseudoContent),
    label + " adds a top-layer pseudo surface",
  );
  assert.equal(
    state.hasLayer,
    !!layer,
    label + " top-layer fixture did not open",
  );
  assert.deepEqual(
    state.legacyFlags,
    [],
    label + " retains route-dependent top-edge state",
  );
  assert.equal(
    state.emptyToastOpen,
    false,
    label + " retains an empty top-layer toast",
  );
  assert(
    state.documentWidth <= state.width + 1,
    label + " overflows horizontally",
  );
  return state;
}

async function beforeAppMount(page, navigate) {
  const mainBundle = /\/assets\/main-[^/]+\.js$/;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let finish;
  let routed = false;
  const handled = new Promise((resolve) => {
    finish = resolve;
  });
  const hold = async (route) => {
    routed = true;
    await gate;
    try {
      await route.continue();
    } finally {
      finish();
    }
  };
  await page.route(mainBundle, hold);
  try {
    await Promise.all([page.waitForRequest(mainBundle), navigate()]);
    await page.locator("#root").waitFor({ state: "attached" });
    assert.equal(await page.locator("#root > *").count(), 0);
    await stableTopEdge(page, "before React mount");
  } finally {
    release();
    if (routed) await handled;
    await page.unroute(mainBundle, hold);
  }
}

async function logoIsClear(page, drawer = false) {
  const state = await page.evaluate((drawer) => {
    const root = drawer
      ? document.querySelector(".teacher-sidebar.is-mobile-open")
      : document.querySelector(
          innerWidth < 1024 ? ".teacher-account-header" : ".teacher-sidebar",
        );
    const logo = root?.querySelector("img.ws-brand-logo");
    const box = logo?.getBoundingClientRect();
    const probe = document.createElement("div");
    probe.style.paddingTop = "env(safe-area-inset-top, 0px)";
    document.body.append(probe);
    const safeTop = parseFloat(getComputedStyle(probe).paddingTop);
    probe.remove();
    const filters = [];
    for (let node = logo; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (
        style.filter !== "none" ||
        (style.backdropFilter && style.backdropFilter !== "none")
      )
        filters.push(node.className);
    }
    return {
      box: box && { y: box.y, width: box.width, height: box.height },
      safeTop,
      filters,
    };
  }, drawer);
  assert(state.box?.width > 0 && state.box.height > 0, "logo must be visible");
  assert(
    state.box.y >= state.safeTop - 1,
    "logo crosses the safe inset: " + JSON.stringify(state),
  );
  assert.deepEqual(
    state.filters,
    [],
    "logo must not be blurred by its ancestors",
  );
}

async function openDrawer(page, portal) {
  await page
    .getByRole("button", { name: portal + " 메뉴 열기", exact: true })
    .click();
  const drawer = page.getByRole("dialog", {
    name: portal + " 메뉴",
    exact: true,
  });
  await drawer.waitFor();
  await stableTopEdge(page, portal + " drawer open");
  await logoIsClear(page, true);
  const bounds = await drawer.boundingBox();
  assert(Math.abs(bounds.y) <= 1, "drawer must start at the viewport edge");
  const paint = await drawer.evaluate((el) => ({
    background: getComputedStyle(el).backgroundImage,
    blur: getComputedStyle(el).backdropFilter,
  }));
  assert.equal(paint.background, "none", "drawer retains old top gradient");
  assert.equal(paint.blur, "none");
  return drawer;
}

async function closedDrawer(page, portal) {
  await page
    .locator(".teacher-sidebar-backdrop")
    .waitFor({ state: "detached" });
  assert.equal(
    await page.locator(".teacher-sidebar.is-mobile-open").count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: portal + " 메뉴 열기", exact: true })
      .getAttribute("aria-expanded"),
    "false",
  );
  await stableTopEdge(page, portal + " drawer closed");
}

async function exerciseClosures(page, portal) {
  for (const method of ["button", "backdrop", "escape"]) {
    const drawer = await openDrawer(page, portal);
    if (method === "button")
      await drawer
        .getByRole("button", { name: "메뉴 닫기", exact: true })
        .click();
    else if (method === "backdrop")
      await page
        .locator(".teacher-sidebar-backdrop")
        .click({ position: { x: 5, y: 150 } });
    else await page.keyboard.press("Escape");
    await closedDrawer(page, portal);
    assert(
      await page
        .getByRole("button", { name: portal + " 메뉴 열기", exact: true })
        .evaluate((el) => el === document.activeElement),
      "close must restore focus",
    );
  }
}

async function selectRoute(page, portal, route, selector, group) {
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  const mobile = page.viewportSize().width < 1024;
  const menu = mobile
    ? await openDrawer(page, portal)
    : page.locator(".teacher-sidebar");
  const link = menu.locator(`a[href="#${route}"]`).first();
  if (!(await link.isVisible())) {
    const toggle = menu.getByRole("button", { name: group, exact: true });
    if ((await toggle.getAttribute("aria-expanded")) !== "true")
      await toggle.click();
  }
  await link.click();
  await page.locator(selector).first().waitFor();
  if (mobile) await closedDrawer(page, portal);
  assert.equal(new URL(page.url()).hash, "#" + route);
  await stableTopEdge(page, route);
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await logoIsClear(page);
}

async function switchFullscreen(page, selector) {
  await page.evaluate(async (selector) => {
    const changed = new Promise((resolve) =>
      document.addEventListener("fullscreenchange", resolve, { once: true }),
    );
    await Promise.all([
      changed,
      selector
        ? document.querySelector(selector).requestFullscreen()
        : document.exitFullscreen(),
    ]);
  }, selector);
}

async function scenario(browser, width, iosHome) {
  const engine = browser.browserType().name();
  const label = `${engine}-${width}-${iosHome ? "ios-home-signal" : "browser"}`;
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 900 },
    deviceScaleFactor: 1,
    isMobile: width < 1024,
    hasTouch: width < 1024 || iosHome,
    reducedMotion: "reduce",
    ...(iosHome
      ? { userAgent: playwright.devices["iPhone 13"].userAgent }
      : {}),
  });
  if (iosHome)
    await context.addInitScript(() =>
      Object.defineProperty(navigator, "standalone", { value: true }),
    );
  await context.route("**/*", (route) => {
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
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  if (iosHome)
    assert(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      "Home Screen fixtures must include tablet touch pointers at desktop widths",
    );
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  if (engine === "chromium") {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", {
      insets: {
        top: iosHome && width < 1024 ? 59 : 0,
        topMax: iosHome && width < 1024 ? 59 : 0,
      },
    });
    if (iosHome)
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [
          { name: "display-mode", value: "standalone" },
          { name: "prefers-reduced-motion", value: "reduce" },
        ],
      });
  }
  try {
    for (const [portal, slug, dashboard] of [
      ["교사", "teacher", '[data-patch-target="teacher-dashboard"]'],
      ["학생", "student", ".student-portal-dashboard"],
    ]) {
      if (slug === "student") await page.goto("about:blank");
      await beforeAppMount(page, () =>
        page.goto(origin + `/#/${slug}/dashboard`, { waitUntil: "commit" }),
      );
      await page.locator(dashboard).waitFor();
      if (slug === "teacher")
        await page
          .locator("[data-patch-memo-root]")
          .first()
          .waitFor({ state: "attached" });
      for (const close of await page.locator(".ws-toast__close").all())
        await close.click();
      await stableTopEdge(page, portal + " dashboard");
      await logoIsClear(page);
      // A Home Screen document can retain an older public stylesheet while the
      // new hashed portal stylesheet loads. Exercise that exact mixed state.
      await page.addStyleTag({
        content: `
        #westory-top-glass, :is(dialog:modal, :fullscreen:not(html))::after {
          position:fixed; inset:0 0 auto; z-index:2147483647; height:120px;
          display:block; -webkit-backdrop-filter:blur(12px); backdrop-filter:blur(12px);
        }
        :is(dialog:modal, :fullscreen:not(html))::after { content:""; }
      `,
      });
      await page.evaluate(() => {
        const legacyGlass = document.createElement("div");
        legacyGlass.id = "westory-top-glass";
        document.body.append(legacyGlass);
      });
      await stableTopEdge(page, portal + " cached legacy stylesheet");
      if (width < 1024) await exerciseClosures(page, portal);
      if (slug === "teacher") {
        await selectRoute(
          page,
          portal,
          "/teacher/quiz",
          ".quiz-workspace",
          "평가 관리",
        );
        await page.screenshot({
          path: path.join(dir, label + "-teacher-quiz.png"),
          animations: "disabled",
        });
        await selectRoute(
          page,
          portal,
          "/teacher/quiz/history-classroom",
          ".history-dashboard article",
          "평가 관리",
        );
      } else {
        await selectRoute(
          page,
          portal,
          "/student/lesson/note",
          ".student-lesson-page",
          "학습",
        );
        await selectRoute(
          page,
          portal,
          "/student/lesson/maps",
          ".history-atlas__zoom",
          "학습",
        );
      }
      await beforeAppMount(page, () => page.reload({ waitUntil: "commit" }));
      await page
        .locator(
          slug === "teacher"
            ? ".history-dashboard article"
            : ".history-atlas__zoom",
        )
        .first()
        .waitFor();
      await stableTopEdge(page, portal + " reload");
      if (slug === "student" && width < 1024) {
        await page.getByRole("button", { name: "장소 목록 열기" }).click();
        await page.locator("dialog:modal").waitFor();
        await stableTopEdge(page, "map dialog", "dialog");
        await page.keyboard.press("Escape");
        await page.locator("dialog:modal").waitFor({ state: "hidden" });
      }
      if (
        slug === "student" &&
        (await page.evaluate(() => document.fullscreenEnabled))
      ) {
        await switchFullscreen(page, ".history-atlas-page");
        await stableTopEdge(page, "map fullscreen", "fullscreen");
        await switchFullscreen(page);
      }
      await selectRoute(page, portal, `/${slug}/dashboard`, dashboard);
      if (width < 1024) await exerciseClosures(page, portal);
      await page.screenshot({
        path: path.join(dir, label + "-" + slug + "-returned.png"),
        animations: "disabled",
      });
    }
    for (const file of ["2026-10-28", "before-2026-10-28"]) {
      await page.goto(origin + "/legal/" + file + ".html");
      await stableTopEdge(page, file);
    }
    assert.deepEqual(failures, []);
    results.push({ label, status: "passed" });
    console.log("PASS", label);
  } catch (error) {
    await page
      .screenshot({
        path: path.join(dir, label + "-FAILED.png"),
        animations: "disabled",
      })
      .catch(() => {});
    results.push({
      label,
      status: "failed",
      url: page.url(),
      message: error.message,
      pageErrors: failures,
    });
    throw error;
  } finally {
    await context.close();
  }
}

try {
  for (const engine of ["chromium", "webkit"]) {
    let browser;
    try {
      browser = await playwright[engine].launch(
        engine === "chromium"
          ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge" }
          : {},
      );
    } catch (error) {
      if (engine !== "webkit") throw error;
      results.push({ engine, status: "unavailable", message: error.message });
      console.warn(
        "WebKit unavailable; Chromium only. Native iOS Home Screen behavior is not emulated.",
      );
      continue;
    }
    try {
      const widths = process.env.MOBILE_HEADER_QA_WIDTHS
        ? process.env.MOBILE_HEADER_QA_WIDTHS.split(",").map(Number)
        : [390, 768, 1024, 1280];
      assert(widths.every((width) => width >= 320 && width <= 2560));
      for (const width of widths)
        for (const iosHome of [false, true])
          await scenario(browser, width, iosHome);
    } finally {
      await browser.close();
    }
  }
  console.log(
    "Stable mobile header passed. Browser engines use synthetic Home Screen/safe-area signals; physical iOS system chrome is not tested.",
  );
} finally {
  await fs.writeFile(
    path.join(dir, "results.json"),
    JSON.stringify(
      {
        results,
        limitation:
          "Synthetic auth/data, browser viewport and Home Screen signals; not a physical iOS Home Screen launch.",
      },
      null,
      2,
    ),
  );
  await server.close();
}
