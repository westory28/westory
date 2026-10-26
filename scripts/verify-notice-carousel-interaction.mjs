/** Actual student/teacher notices; synthetic local data and images only. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidence =
  process.env.NOTICE_CAROUSEL_EVIDENCE_DIR ||
  path.join(root, "output/notice-carousel-interaction");
const mocks = {
  state: `const params=new URLSearchParams(location.search);const count=params.get('mode')==='single'?1:params.get('mode')==='empty'?0:3;export const config={year:2026,semester:2};export const userData={grade:3,class:1};export const getNotices=()=>Array.from({length:count},(_,index)=>({id:'notice-'+index,category:['performance','exam','notice'][index],content:'알림 안내',imageUrl:'/notice-'+index+'.svg',developerLogPostId:params.get('mode')==='unlinked'?'':'notice-'+index+'-post',createdAt:null,noticeOrder:index}));`,
  auth: `import {config,userData} from 'fixture:state';export const useAuth=()=>({config,userData});`,
  firebase: `export const db={};`,
  firestore: `import {getNotices} from 'fixture:state';export const collection=()=>({}),limit=()=>({}),orderBy=()=>({}),query=()=>({});export const onSnapshot=(_,next)=>{next({docs:getNotices().map(n=>({id:n.id,data:()=>n}))});return()=>{}};`,
  semester: `export const getYearSemester=config=>config;`,
  visible: `import {getNotices} from 'fixture:state';export const getStudentClassKey=()=> '3-1';export const subscribeVisibleNotices=(_db,_path,_class,next)=>{next(getNotices());return()=>{}};`,
  images: `export const NOTICE_IMAGE_RECOMMENDED_WIDTH=1600;`,
  loading: `import React from 'react';export const InlineLoading=({message})=><p>{message}</p>;`,
  modal: `import React from 'react';export default function Modal({onClose}){return <div role="dialog" aria-label="알림 수정"><button onClick={onClose}>닫기</button></div>}`,
};
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter,useLocation} from 'react-router-dom';import Student from './src/pages/student/components/NoticeBoard';import Teacher from './src/pages/teacher/components/TeacherNoticeBoard';function App(){const location=useLocation();return <><output data-route>{location.pathname}</output><main>{new URLSearchParams(window.location.search).get('portal')==='student'?<Student/>:<Teacher/>}</main><div className="scroll-space">세로 스크롤 확인</div></>};createRoot(document.getElementById('root')).render(<MemoryRouter><App/></MemoryRouter>);`,
    loader: "tsx",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "notice-local-data",
      setup(builder) {
        builder.onResolve({ filter: /^fixture:/ }, (args) => ({
          path: args.path.slice(8),
          namespace: "fixture",
        }));
        builder.onResolve(
          {
            filter:
              /firebase\/firestore$|lib\/firebase$|contexts\/AuthContext$|lib\/semesterScope$|lib\/visibleSchedule$|lib\/noticeImages$|common\/LoadingState$|\.\/NoticeManagerModal$/,
          },
          (args) => ({
            path:
              args.path === "firebase/firestore"
                ? "firestore"
                : args.path.endsWith("/firebase")
                  ? "firebase"
                  : args.path.endsWith("/AuthContext")
                    ? "auth"
                    : args.path.endsWith("/semesterScope")
                      ? "semester"
                      : args.path.endsWith("/visibleSchedule")
                        ? "visible"
                        : args.path.endsWith("/noticeImages")
                          ? "images"
                          : args.path.endsWith("/LoadingState")
                            ? "loading"
                            : "modal",
            namespace: "fixture",
          }),
        );
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: mocks[args.path],
          loader: "tsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
const styles = await Promise.all(
  [
    "src/components/common/portalPage.css",
    "src/pages/student/studentDashboard.css",
    "src/pages/teacher/teacherDashboard.css",
  ].map((file) => fs.readFile(path.join(root, file), "utf8")),
);
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles.join("\n")}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 sans-serif;background:#f8fafc}main{margin:16px;max-width:720px}button{font:inherit;cursor:pointer}output{display:block;padding:8px}.student-notice-board,.teacher-notice-board{padding:16px;background:white}.student-notice-board__viewport,.teacher-notice-board__viewport{position:relative;display:block;width:100%;aspect-ratio:16/9;overflow:hidden;padding:0;border:0}.student-notice-board__image{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover}.teacher-notice-board__viewport>button{display:block;width:100%;height:100%;padding:0;border:0}.teacher-notice-board__image-track{display:flex;height:100%;width:100%;transition:transform 500ms ease-out}.teacher-notice-board__image{display:block;flex-shrink:0;width:100%;height:100%;object-fit:cover}.translate-x-0{transform:translateX(0)}.translate-x-full{transform:translateX(100%)}.-translate-x-full{transform:translateX(-100%)}.student-notice-board__controls,.teacher-notice-board__controls{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.student-notice-board__playback>button,.teacher-notice-board__controls button{min-width:32px;min-height:36px}.scroll-space{height:1400px;padding:32px}.hidden{display:none}
</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  res.setHeader("Cache-Control", "no-store");
  if (pathname === "/fixture.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(bundle.outputFiles[0].text);
  } else if (/^\/notice-\d\.svg$/.test(pathname)) {
    const index = Number(pathname.match(/\d/)[0]);
    res.setHeader("Content-Type", "image/svg+xml");
    res.end(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="${["#fff7e6", "#e9fbf5", "#eff6ff"][index]}"/><text x="120" y="450" font-size="120">알림 ${index + 1}</text></svg>`,
    );
  } else {
    res.setHeader("Content-Type", "text/html;charset=utf-8");
    res.end(html);
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes("--serve")) {
  console.log(address);
  await new Promise(() => {});
}
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
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const reports = [];
const errors = [];
const requests = [];
const compatibilityClickFallbacks = [];

async function fixture(
  portal,
  mode = "linked",
  gateImage = false,
  realTime = false,
) {
  // Chromium's native gesture recognizer can retain timing state across contexts.
  // Keep wall-clock input isolated from contexts that install a virtual clock.
  const isolatedBrowser = realTime
    ? await playwright.chromium.launch({
        channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
        headless: true,
      })
    : null;
  const context = await (isolatedBrowser || browser).newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.fixtureEvents = [];
    for (const type of [
      "pointerdown",
      "pointerup",
      "pointercancel",
      "lostpointercapture",
      "click",
    ])
      document.addEventListener(
        type,
        (event) => {
          const entry = {
            type,
            pointerType: event.pointerType,
            pointerId: event.pointerId,
            isPrimary: event.isPrimary,
            button: event.button,
            detail: event.detail,
            target: event.target.tagName,
          };
          window.fixtureEvents.push(entry);
          queueMicrotask(() => {
            entry.defaultPrevented = event.defaultPrevented;
          });
        },
        true,
      );
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    requests.push(route.request().url());
    return route.request().url().startsWith(address)
      ? route.continue()
      : route.abort();
  });
  let release;
  if (gateImage) {
    let failImage = false;
    const gate = new Promise((resolve) => {
      release = (fail = false) => {
        failImage = fail;
        resolve();
      };
    });
    await page.route("**/notice-0.svg", async (route) => {
      await gate;
      if (failImage) await route.abort();
      else await route.continue();
    });
  }
  if (!realTime) {
    await page.clock.install({ time: new Date("2026-10-26T00:00:00Z") });
    await page.clock.pauseAt(new Date("2026-10-26T00:00:01Z"));
  }
  await page.goto(`${address}/?portal=${portal}&mode=${mode}`, {
    waitUntil: gateImage ? "domcontentloaded" : "load",
  });
  const viewport = page.locator(
    portal === "student"
      ? ".student-notice-board__viewport"
      : ".teacher-notice-board__viewport > button",
  );
  const advance = async (ms) => {
    if (realTime) await new Promise((resolve) => setTimeout(resolve, ms));
    else await page.clock.runFor(ms);
    await page.evaluate(() => Promise.resolve());
  };
  if (mode !== "empty") {
    await viewport.waitFor({ state: "visible" });
    if (!gateImage)
      await page
        .locator("img")
        .first()
        .evaluate((img) => img.decode());
  }
  await advance(50);
  const index = () =>
    page.evaluate((portal) => {
      if (portal === "student") {
        const dot = document.querySelector(
          '.student-notice-board__pagination [aria-current="true"]',
        );
        if (dot)
          return Number(dot.getAttribute("aria-label").match(/\d+/)[0]) - 1;
        const src = document
          .querySelector(".student-notice-board__image")
          ?.getAttribute("src");
        return src ? Number(src.match(/\d/)[0]) : -1;
      }
      const track = document.querySelector(
        ".teacher-notice-board__image-track",
      );
      return track
        ? Math.round(
            -parseFloat(track.style.transform.match(/-?[\d.]+/)[0]) / 100,
          ) || 0
        : -1;
    }, portal);
  const cdp = await context.newCDPSession(page);
  const point = async () => {
    const box = await viewport.boundingBox();
    assert(box);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
  };
  const touch = async (type, points) => {
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    await page.evaluate(() => Promise.resolve());
  };
  const swipe = async (dx, dy = 0) => {
    const p = await point();
    await touch("touchStart", [p]);
    await touch("touchMove", [{ ...p, x: p.x + dx, y: p.y + dy }]);
    await touch("touchEnd", []);
    // Let React commit both animation-frame updates before the 900ms fallback.
    // A single clock jump can defer that commit until after the jump finishes.
    for (let step = 0; step < 12; step += 1) await advance(100);
    if (portal === "student")
      assert.equal(await viewport.locator("img").count(), 1);
  };
  const tap = async () => {
    // Chromium's compositor gesture recognition uses wall time, not page.clock.
    // Separate the next user gesture from the preceding swipe/double-tap window.
    await new Promise((resolve) => setTimeout(resolve, 350));
    const clickCount = await page.evaluate(
      () =>
        window.fixtureEvents.filter((event) => event.type === "click").length,
    );
    const p = await point();
    await touch("touchStart", [p]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await touch("touchEnd", []);
    await advance(400);
    // Some headless Chromium runs omit the compatibility click entirely after
    // native touch input. Only supply an absent click; never retry an emitted
    // click that the application rejected. Report this fixture limitation.
    const emittedClick = await page.evaluate(
      (before) =>
        window.fixtureEvents.filter((event) => event.type === "click").length >
        before,
      clickCount,
    );
    if (!emittedClick) {
      compatibilityClickFallbacks.push({ portal, mode });
      await viewport.dispatchEvent("click", { detail: 1 });
    }
  };
  const route = () => page.locator("[data-route]").textContent();
  return {
    page,
    context,
    viewport,
    advance,
    index,
    point,
    touch,
    swipe,
    tap,
    route,
    release,
    close: async () => {
      await context.close();
      if (isolatedBrowser) await isolatedBrowser.close();
    },
  };
}

async function check(portal, name, fn, mode = "linked", gate = false) {
  if (
    process.env.NOTICE_CAROUSEL_TEST_FILTER &&
    !`${portal}: ${name}`.includes(process.env.NOTICE_CAROUSEL_TEST_FILTER)
  )
    return;
  const realTime =
    /native horizontal|right swipe|unlinked image|vertical scrolling/.test(
      name,
    );
  const f = await fixture(portal, mode, gate, realTime);
  try {
    await fn(f);
    reports.push({ portal, name, passed: true });
    console.log(`PASS ${portal}: ${name}`);
  } catch (error) {
    console.error(await f.page.evaluate(() => window.fixtureEvents));
    await f.page.screenshot({
      path: path.join(
        evidence,
        `${portal}-${name.replaceAll(" ", "-")}-failure.png`,
      ),
      fullPage: true,
    });
    throw error;
  } finally {
    f.release?.();
    await f.close();
  }
}

try {
  await fs.mkdir(evidence, { recursive: true });
  for (const portal of ["student", "teacher"]) {
    await check(
      portal,
      "first image gets 12 seconds after loading",
      async (f) => {
        await f.advance(30000);
        assert.equal(
          await f.index(),
          0,
          "Unloaded first image must not advance",
        );
        f.release();
        await f.page
          .locator("img")
          .first()
          .evaluate((img) => img.decode());
        await f.advance(50);
        await f.advance(11900);
        assert.equal(
          await f.index(),
          0,
          "First loaded image retains the full 12-second interval",
        );
        await f.advance(200);
        assert.equal(
          await f.index(),
          1,
          "First image advances after 12 seconds",
        );
      },
      "linked",
      true,
    );
    await check(
      portal,
      "failed image releases autoplay after its full dwell",
      async (f) => {
        f.release(true);
        await f.page
          .locator("img")
          .first()
          .evaluate((img) =>
            img.complete
              ? undefined
              : new Promise((resolve) =>
                  img.addEventListener("error", resolve, { once: true }),
                ),
          );
        await f.advance(50);
        await f.advance(11900);
        assert.equal(await f.index(), 0);
        await f.advance(200);
        assert.equal(await f.index(), 1);
      },
      "linked",
      true,
    );
    await check(
      portal,
      "other images retain five seconds and manual navigation resets",
      async (f) => {
        await f.advance(11000);
        await f.page
          .getByRole("button", { name: "다음 알림", exact: true })
          .click();
        await f.advance(1000);
        assert.equal(await f.index(), 1);
        await f.advance(3500);
        assert.equal(
          await f.index(),
          1,
          "Previous first-slide deadline must not advance a manually selected image",
        );
        await f.advance(1600);
        assert.equal(
          await f.index(),
          2,
          "Other images resume their five-second dwell",
        );
      },
    );
    await check(
      portal,
      "native horizontal swipe blocks accidental navigation but next tap works",
      async (f) => {
        await f.swipe(-100);
        assert.equal(await f.index(), 1);
        assert.equal(await f.route(), "/");
        assert.equal(await f.page.getByRole("dialog").count(), 0);
        await f.viewport.dispatchEvent("click", { detail: 1 });
        assert.equal(
          await f.route(),
          "/",
          "Compatibility click must not open a post",
        );
        await f.tap();
        // CDP dispatch completion precedes React's router render commit.
        await f.page.waitForFunction(
          () =>
            document.querySelector("[data-route]").textContent ===
            "/developer-log/notice-1-post",
          null,
          { polling: 10, timeout: 2000 },
        );
        assert.equal(
          await f.route(),
          "/developer-log/notice-1-post",
          "Next genuine tap opens the visible notice",
        );
      },
    );
    await check(
      portal,
      "right swipe wraps and left swipe returns",
      async (f) => {
        await f.swipe(100);
        assert.equal(await f.index(), 2);
        await f.swipe(-100);
        assert.equal(await f.index(), 0);
        assert.equal(await f.route(), "/");
      },
    );
    await check(
      portal,
      "unlinked image remains swipable",
      async (f) => {
        await f.swipe(-100);
        assert.equal(await f.index(), 1);
        assert.equal(await f.route(), "/");
        assert.equal(await f.page.getByRole("dialog").count(), 0);
      },
      "unlinked",
    );
    await check(
      portal,
      "vertical scrolling and short movement do not change slides",
      async (f) => {
        assert.match(
          await f.viewport.evaluate((el) => getComputedStyle(el).touchAction),
          /pan-y/,
        );
        assert.match(
          await f.viewport.evaluate((el) => getComputedStyle(el).touchAction),
          /pinch-zoom/,
        );
        await f.swipe(12, -100);
        assert.equal(await f.index(), 0);
        assert.equal(await f.route(), "/");
        assert(
          await f.page.evaluate(() => window.scrollY > 0),
          "Vertical gesture scrolls the page",
        );
        await f.page.evaluate(() => window.scrollTo(0, 0));
        await f.swipe(-20);
        assert.equal(await f.index(), 0);
        assert.equal(await f.route(), "/");
      },
    );
    await check(
      portal,
      "touch cancellation releases timer without navigation",
      async (f) => {
        await f.advance(11000);
        const p = await f.point();
        await f.touch("touchStart", [p]);
        await f.advance(3000);
        assert.equal(await f.index(), 0, "Pressed image must not advance");
        await f.touch("touchMove", [{ ...p, x: p.x - 80 }]);
        await f.touch("touchCancel", []);
        await f.advance(50);
        assert.equal(await f.index(), 0);
        assert.equal(await f.route(), "/");
        await f.advance(11000);
        assert.equal(await f.index(), 0);
        await f.advance(1500);
        assert.equal(
          await f.index(),
          1,
          "Cancellation restarts rather than stalls autoplay",
        );
      },
    );
    await check(portal, "multitouch does not trigger a swipe", async (f) => {
      const p = await f.point();
      const second = { ...p, x: p.x + 35, id: 2 };
      await f.touch("touchStart", [p]);
      await f.touch("touchStart", [p, second]);
      await f.touch("touchMove", [
        { ...p, x: p.x - 80 },
        { ...second, x: second.x - 80 },
      ]);
      await f.touch("touchEnd", []);
      await f.advance(1000);
      assert.equal(await f.index(), 0);
      assert.equal(await f.route(), "/");
      await f.advance(12000);
      assert.equal(
        await f.index(),
        1,
        "Multitouch cleanup must release autoplay",
      );
    });
    await check(
      portal,
      "pause survives manual swipe and play restarts dwell",
      async (f) => {
        await f.page
          .getByRole("button", { name: "알림 자동 넘김 일시정지", exact: true })
          .click();
        await f.advance(20000);
        assert.equal(await f.index(), 0);
        await f.swipe(-100);
        assert.equal(await f.index(), 1);
        await f.advance(20000);
        assert.equal(await f.index(), 1);
        await f.page
          .getByRole("button", { name: "알림 자동 넘김 재생", exact: true })
          .click();
        await f.advance(4500);
        assert.equal(await f.index(), 1);
        await f.advance(600);
        assert.equal(await f.index(), 2);
      },
    );
    await check(portal, "hidden page resumes with a fresh dwell", async (f) => {
      await f.advance(11000);
      await f.page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await f.advance(30000);
      assert.equal(await f.index(), 0);
      await f.page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: false,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await f.advance(11000);
      assert.equal(await f.index(), 0);
      await f.advance(1500);
      assert.equal(await f.index(), 1);
    });
    await check(
      portal,
      "single image stays still",
      async (f) => {
        await f.advance(30000);
        assert.equal(await f.index(), 0);
        assert.equal(
          await f.page
            .getByRole("button", { name: "다음 알림", exact: true })
            .count(),
          0,
        );
      },
      "single",
    );
    await check(
      portal,
      "empty notices remain usable",
      async (f) => {
        await f.advance(30000);
        assert.equal(await f.index(), -1);
        assert.equal(await f.page.locator("img").count(), 0);
      },
      "empty",
    );
    await check(
      portal,
      "responsive widths preserve image bounds",
      async (f) => {
        for (const width of [390, 768, 1280]) {
          await f.page.setViewportSize({ width, height: 844 });
          await f.advance(50);
          const bounds = await f.page.evaluate((portal) => {
            const board = document
              .querySelector(`.${portal}-notice-board`)
              .getBoundingClientRect();
            const viewport = document
              .querySelector(`.${portal}-notice-board__viewport`)
              .getBoundingClientRect();
            return {
              viewportWidth: window.innerWidth,
              documentWidth: document.documentElement.scrollWidth,
              left: board.left,
              right: board.right,
              imageWidth: viewport.width,
            };
          }, portal);
          assert(
            bounds.documentWidth <= width,
            `${portal} has no horizontal page overflow at ${width}px`,
          );
          assert(bounds.left >= 0 && bounds.right <= width);
          assert(bounds.imageWidth > 0);
          await f.page.screenshot({
            path: path.join(evidence, `${portal}-${width}.png`),
          });
        }
      },
    );
  }
  assert.deepEqual(errors, []);
  assert(
    requests.every((url) => url.startsWith(address)),
    "No backend or external assets are requested",
  );
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(
      { reports, errors, externalRequests: 0, compatibilityClickFallbacks },
      null,
      2,
    ),
  );
  console.log(
    `PASS ${reports.length} notice carousel regressions; evidence: ${evidence}`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
