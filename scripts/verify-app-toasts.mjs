import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";

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
const evidence =
  process.env.TOAST_EVIDENCE_DIR ||
  (await fs.mkdtemp(path.join(os.tmpdir(), "westory-toasts-")));
await fs.mkdir(evidence, { recursive: true });
const bundle = await build({
  stdin: {
    contents: `
    import React from "react";
    import {createRoot} from "react-dom/client";
    import {AppToastProvider,useAppToast,inferToastFromAlertMessage} from "./src/components/common/AppToastProvider";
    function Fixture(){
      const toast=useAppToast();
      React.useEffect(()=>{window.toastQA={...toast,infer:inferToastFromAlertMessage};},[toast]);
      return <main>
        <h1>위스토리 설정</h1><label>설정 이름 <input id="setting" defaultValue="수업 자료"/></label>
        <button id="save" onClick={()=>toast.showToast({tone:"success",title:"설정을 저장했습니다.",message:"변경한 설정이 반영되었습니다."})}>저장</button>
        <button id="modal" onClick={()=>document.querySelector("dialog").showModal()}>상세 설정</button>
        <button id="fullscreen" onClick={()=>document.querySelector("main").requestFullscreen()}>전체 화면</button>
        <dialog><h2>상세 설정</h2><button onClick={()=>toast.showToast({tone:"success",title:"상세 설정을 저장했습니다."})}>상세 저장</button><button id="close-dialog" onClick={()=>document.querySelector("dialog").close()}>닫기</button></dialog>
      </main>;
    }
    createRoot(document.getElementById("root")).render(<React.StrictMode><AppToastProvider><Fixture/></AppToastProvider></React.StrictMode>);
  `,
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  outfile: path.join(evidence, "fixture.js"),
  define: { "process.env.NODE_ENV": '"development"' },
});
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text;
const css = bundle.outputFiles.find((f) => f.path.endsWith(".css")).text;
const html =
  '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#f9fafb;color:#1f2937;font-family:"Noto Sans KR",sans-serif}main{padding:24px}button,input{padding:12px;font:inherit;margin:4px}dialog{border:1px solid #e5e7eb;border-radius:12px}dialog::backdrop{background:#0f172a66}</style><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>';
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost").pathname;
  res.setHeader(
    "Content-Type",
    url.endsWith(".js")
      ? "text/javascript"
      : url.endsWith(".css")
        ? "text/css"
        : "text/html",
  );
  res.end(url.endsWith(".js") ? js : url.endsWith(".css") ? css : html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
if (process.argv.includes("--serve")) {
  console.log(JSON.stringify({ origin, evidence }));
  await new Promise(() => {});
}
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const checks = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  const reset = async () => {
    await page.goto(origin);
    await page.waitForFunction(() => !!window.toastQA);
    await page.mouse.move(0, 0);
  };
  const notify = async (input) =>
    page.evaluate((input) => window.toastQA.showToast(input), input);
  const count = () => page.locator(".ws-toast").count();
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await reset();
    await notify({
      tone: "success",
      title: "설정을 저장했습니다.",
      message: "변경한 수업자료 공개 설정이 반영되었습니다.",
      persistent: true,
    });
    await notify({
      tone: "error",
      title: "파일을 다운로드하지 못했습니다.",
      message:
        "네트워크 연결을 확인한 뒤 다시 다운로드해 주세요. 입력한 내용은 그대로 유지됩니다.",
      persistent: true,
    });
    await page.locator(".ws-toast").first().waitFor();
    await page
      .locator(".ws-toast")
      .evaluateAll((nodes) =>
        Promise.all(
          nodes.flatMap((node) =>
            node.getAnimations().map((animation) => animation.finished),
          ),
        ),
      );
    const boxes = await page.locator(".ws-toast").evaluateAll((nodes) =>
      nodes.map((n) => {
        const b = n.getBoundingClientRect();
        return {
          x: b.x,
          y: b.y,
          w: b.width,
          h: b.height,
          right: b.right,
          bottom: b.bottom,
          font: getComputedStyle(n.querySelector(".ws-toast__title")).fontSize,
          icon: n.querySelector(".ws-toast__icon").getBoundingClientRect()
            .width,
          close: n.querySelector("button").getBoundingClientRect().width,
        };
      }),
    );
    assert.equal(boxes.length, 2);
    for (const b of boxes) {
      assert.ok(b.x >= 0 && b.right <= width && b.y >= 0 && b.bottom <= 800);
      assert.ok(b.h >= (width < 768 ? 72 : 96));
      assert.equal(b.font, width < 768 ? "14px" : "16px");
      assert.equal(b.icon, width < 768 ? 32 : 40);
      if (width < 768) assert.ok(b.w <= 360);
      assert.ok(b.close >= 44);
    }
    if (width < 768)
      assert.ok(Math.abs(boxes[0].y - 12) < 2, JSON.stringify(boxes));
    else assert.ok(Math.abs(boxes.at(-1).bottom - 776) < 2);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: path.join(evidence, "toasts-" + width + ".png"),
      fullPage: true,
    });
    checks.push("layout " + width);
  }
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await reset();
    await page.evaluate(() => {
      const memo = document.createElement("button");
      memo.setAttribute("data-patch-memo-root", "true");
      document.body.append(memo);
    });
    await notify({ title: "저장 완료", persistent: true });
    await page.locator(".ws-toast").waitFor();
    await page
      .locator(".ws-toast")
      .evaluate((node) =>
        Promise.all(
          node.getAnimations().map((animation) => animation.finished),
        ),
      );
    const box = await page.locator(".ws-toast").boundingBox();
    if (width < 768) {
      assert.ok(box.height >= 72 && box.height < 96);
      assert.ok(Math.abs(box.y - 12) < 2);
    } else assert.ok(Math.abs(box.y + box.height - 696) < 2);
    checks.push("memo launcher clearance " + width);
  }
  const phone = await browser.newPage({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });
  await phone.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  await phone.goto(origin);
  await phone.waitForFunction(() => !!window.toastQA);
  await phone.evaluate(() =>
    window.toastQA.showToast({ title: "가로 화면 알림", persistent: true }),
  );
  await phone.locator(".ws-toast").waitFor();
  await phone
    .locator(".ws-toast")
    .evaluate((node) =>
      Promise.all(node.getAnimations().map((animation) => animation.finished)),
    );
  const phoneBox = await phone.locator(".ws-toast").boundingBox();
  assert.ok(Math.abs(phoneBox.y - 12) < 2 && phoneBox.width <= 360);
  assert.equal(
    await phone
      .locator(".ws-toast__title")
      .evaluate((node) => getComputedStyle(node).fontSize),
    "14px",
  );
  await phone.screenshot({
    path: path.join(evidence, "toasts-phone-landscape.png"),
  });
  await phone.close();
  checks.push("touch phone landscape stays compact at the top");
  await page.setViewportSize({ width: 1280, height: 800 });
  await reset();
  await page.clock.install();
  await notify({ title: "먼저 저장", tone: "success" });
  await page.clock.runFor(3000);
  await notify({ title: "다음 저장", tone: "success" });
  await page.clock.runFor(3100);
  assert.equal(await count(), 1);
  assert.equal(
    await page.locator(".ws-toast__title").textContent(),
    "다음 저장",
  );
  await page.clock.runFor(3100);
  assert.equal(await count(), 0);
  checks.push("independent expiry");

  for (let i = 1; i <= 5; i++)
    await notify({ title: "대기 " + i, tone: "success" });
  assert.equal(await count(), 3);
  assert.match(await page.locator(".ws-toast-pending").textContent(), /2/);
  await page.clock.runFor(6100);
  assert.equal(await count(), 2);
  assert.deepEqual(await page.locator(".ws-toast__title").allTextContents(), [
    "대기 4",
    "대기 5",
  ]);
  await page.clock.runFor(6100);
  assert.equal(await count(), 0);
  checks.push("queue without dropping messages");

  const persistentIds = [];
  for (let i = 1; i <= 3; i++)
    persistentIds.push(
      await notify({ title: "계속 표시 " + i, persistent: true }),
    );
  const actionId = await notify({ title: "설정 저장 결과", tone: "success" });
  assert.equal(
    await page
      .locator(".ws-toast__title")
      .filter({ hasText: "설정 저장 결과" })
      .count(),
    1,
  );
  for (const id of [...persistentIds, actionId])
    await page.evaluate((id) => window.toastQA.dismissToast(id), id);
  checks.push("persistent notifications reserve an action slot");

  await notify({ title: "첫 키보드 알림" });
  await notify({ title: "다음 키보드 알림" });
  await page.locator(".ws-toast__close").first().focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.activeElement?.className !== "ws-toast__close",
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve)),
  );
  await page.clock.runFor(6100);
  assert.equal(
    await count(),
    0,
    await page.evaluate(() =>
      JSON.stringify({
        active: document.activeElement.tagName,
        cls: document.activeElement.className,
        hover: document.querySelector(".ws-toast-stack").matches(":hover"),
        focus: document
          .querySelector(".ws-toast-stack")
          .matches(":focus-within"),
      }),
    ),
  );
  checks.push("focused dismissal does not freeze queue");

  await notify({ title: "읽는 중", tone: "success" });
  await page.clock.runFor(1000);
  await page.locator(".ws-toast").hover();
  await page.clock.runFor(12000);
  assert.equal(await count(), 1);
  await page.mouse.move(0, 0);
  await page.clock.runFor(5100);
  assert.equal(await count(), 0);
  checks.push("hover pause");

  await notify({ title: "키보드 읽기", tone: "success" });
  await page.clock.runFor(1000);
  await page.locator(".ws-toast__close").focus();
  await page.clock.runFor(12000);
  assert.equal(await count(), 1);
  await page.locator("#setting").focus();
  await page.clock.runFor(5100);
  assert.equal(await count(), 0);
  checks.push("focus pause");

  await notify({ title: "탭 읽기", tone: "success" });
  await page.clock.runFor(1000);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(12000);
  assert.equal(await count(), 1);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(5100);
  assert.equal(await count(), 0);
  checks.push("hidden tab pause");

  await notify({ title: "오류", tone: "error" });
  await page.clock.runFor(6100);
  assert.equal(await count(), 1);
  assert.match(await page.locator('[role="alert"]').textContent(), /오류/);
  await page.clock.runFor(4100);
  assert.equal(await count(), 0);
  checks.push("error duration and assertive announcement");

  await page.locator("#setting").focus();
  await page.evaluate(() => alert("선택한 설정을 저장했습니다."));
  assert.equal(await page.locator(".ws-toast--success").count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement.id), "setting");
  await page.locator(".ws-toast__close").click();
  assert.equal(await count(), 0);
  checks.push("legacy alert and no focus theft");
  assert.equal(
    await page.evaluate(
      () => window.toastQA.infer("학생 정보 입력이 완료되지 않았습니다.").tone,
    ),
    "warning",
  );

  await page.locator("#modal").click();
  await page.getByRole("button", { name: "상세 저장", exact: true }).click();
  assert.equal(await page.locator("dialog .ws-toast-layer").count(), 1);
  await page.locator(".ws-toast__close").click();
  assert.equal(await count(), 0);
  await page.locator("#close-dialog").click();
  assert.equal(await page.locator("body > .ws-toast-layer").count(), 1);
  checks.push("native modal and return to body");

  await page.evaluate(() => {
    for (const id of ["early", "late"]) {
      const dialog = document.createElement("dialog");
      dialog.id = id;
      dialog.innerHTML = "<button>설정</button>";
      document.body.append(dialog);
    }
    document.getElementById("late").showModal();
    document.getElementById("early").showModal();
  });
  await notify({ title: "가장 위 모달 저장", persistent: true });
  assert.equal(await page.locator("#early > .ws-toast-layer").count(), 1);
  await page.locator(".ws-toast__close").click();
  await page.evaluate(() => {
    document.getElementById("early").close();
    document.getElementById("late").close();
    document.getElementById("early").remove();
    document.getElementById("late").remove();
  });
  checks.push("modal opening order independent of DOM order");

  await page.locator("#fullscreen").click();
  await page.waitForFunction(() => document.fullscreenElement);
  await page.clock.runFor(32);
  await page.waitForFunction(
    () =>
      document.querySelector(".ws-toast-layer").parentElement ===
      document.fullscreenElement,
  );
  await notify({ title: "전체 화면 저장", tone: "success", persistent: true });
  assert.equal(await page.locator("main > .ws-toast-layer").count(), 1);
  await page.locator(".ws-toast__close").click();
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.clock.runFor(32);
  await page.waitForFunction(
    () =>
      document.querySelector(".ws-toast-layer").parentElement === document.body,
  );
  checks.push("fullscreen visibility and dismissal");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await notify({ title: "모션 감소", persistent: true });
  assert.equal(
    await page
      .locator(".ws-toast")
      .evaluate((n) => getComputedStyle(n).animationName),
    "none",
  );
  await page.locator(".ws-toast__close").focus();
  await page.keyboard.press("Enter");
  assert.equal(await count(), 0);
  checks.push("reduced motion and keyboard dismissal");
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(evidence, "results.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ ok: true, checks, evidence }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
