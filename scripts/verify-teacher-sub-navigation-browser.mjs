/** Real component navigation checks; fixture content, no Firebase or application services. */
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
  path.join(os.tmpdir(), "westory-sub-navigation-"),
);
const source = (name) =>
  JSON.stringify(
    path.join(root, "src/pages/teacher/components", name).replaceAll("\\", "/"),
  );
const harness = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import TeacherSubNavigation from ${source("TeacherSubNavigation.tsx")};
import RankSettingsSidebar from ${source("points/RankSettingsSidebar.tsx")};
import TeacherMapNavigation from ${source("TeacherMapNavigation.tsx")};
import TeacherNavigationIcon from ${JSON.stringify(path.join(root, "src/components/layout/TeacherNavigationIcon.tsx").replaceAll("\\", "/"))};
function Fixture() {
 const kind = new URLSearchParams(location.search).get("kind") || "common";
 const [active, setActive] = useState(kind === "rank" ? "theme_preview" : "first");
 const [open,setOpen] = useState(false);
 const [actions,setActions] = useState(0);
 const items = [{id:"first",title:"기본 메뉴"},{id:"second",title:"아주 긴 한글 이름으로 등록한 수업 자료와 학습 활동 지도"}];
 const activeLabel = items.find(item=>item.id===active)?.title || "기본 메뉴";
 return <main className="teacher-sub-workspace">
 {kind === "rank" ? <RankSettingsSidebar activePanel={active} onSelect={setActive} items={[
 {id:"theme_preview",label:"테마 미리보기",iconClassName:"fas fa-palette",badge:"미저장"},
 {id:"rank_settings",label:"설정",iconClassName:"fas fa-medal",badge:"저장됨"},
 {id:"emoji_collection",label:"이모지 모음",iconClassName:"fas fa-smile",badge:"미저장"}
 ]}/> : kind === "map" ? <TeacherMapNavigation heading="지도" items={items} selectedId={active} onSelect={setActive}
 action={<button type="button" aria-label="지도 추가" onClick={()=>setActions(value=>value+1)}>추가</button>}
 renderItemAction={item=><button type="button" aria-label={item.title+" 삭제"} onClick={()=>setActions(value=>value+1)}>삭제</button>}/>
 : <TeacherSubNavigation title="수업 자료" activeLabel={activeLabel} open={open} onOpenChange={setOpen}
 actions={<button type="button" aria-label="자료 추가" onClick={()=>setActions(value=>value+1)}>추가</button>}>
 {items.map(item=><button key={item.id} type="button" className={"teacher-settings-section"+(active===item.id?" is-active":"")} aria-current={active===item.id?"page":undefined}
 onClick={()=>{setActive(item.id);setOpen(false)}}><TeacherNavigationIcon name="lesson"/><span>{item.title}</span></button>)}
 </TeacherSubNavigation>}
 <section className="teacher-sub-content"><h1>검증용 본문</h1><p>실제 내비게이션 컴포넌트를 사용하고 본문과 데이터만 대체했습니다.</p><output data-testid="active">{active}</output><output data-testid="actions">{actions}</output><button type="button">본문 작업</button></section>
 </main>;
}
createRoot(document.getElementById("root")).render(<Fixture/>);
`;
const result = await build({
  stdin: { contents: harness, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  loader: { ".css": "empty" },
  define: { "process.env.NODE_ENV": '"production"' },
});
await fs.writeFile(path.join(output, "fixture.js"), result.outputFiles[0].text);
const teacherCss = await fs.readFile(
  path.join(root, "src/pages/teacher/teacherSettings.css"),
  "utf8",
);
const css = (await fs.readFile(path.join(root, "src/components/common/portalSubNavigation.css"), "utf8")) + teacherCss.replace(/@import[^;]+;/g, "");
const baseline = `*{box-sizing:border-box}body{margin:0;font:14px Arial,sans-serif}button{font:inherit;cursor:pointer}h1{font-size:20px}output{display:block}p{overflow-wrap:anywhere}.flex{display:flex}.min-w-0{min-width:0}.flex-1{flex:1 1 0%}.shrink-0{flex-shrink:0}.items-center{align-items:center}.w-5{width:20px}.text-center{text-align:center}.text-xs{font-size:12px}.break-words{overflow-wrap:break-word}.pr-2{padding-right:8px}.teacher-nav-icon{width:20px;height:20px;flex:0 0 20px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}`;
const html = `<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${baseline}\n${css}</style><div id="root" class="teacher-layout"></div><script type="module" src="/fixture.js"></script></html>`;
const server = http.createServer(async (request, response) => {
  response.setHeader(
    "Content-Type",
    request.url === "/fixture.js"
      ? "text/javascript"
      : "text/html; charset=utf-8",
  );
  response.end(
    request.url === "/fixture.js"
      ? await fs.readFile(path.join(output, "fixture.js"))
      : html,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await playwright.chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  for (const kind of ["common", "rank", "map"])
    for (const width of [390, 768, 1280, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) =>
        route.request().url().startsWith(origin)
          ? route.continue()
          : route.abort(),
      );
      await page.goto(origin + "/?kind=" + kind);
      const sidebar = page.locator(".teacher-sub-navigation");
      const toggle = sidebar.locator(".teacher-settings-menu-toggle");
      const menu = sidebar.locator("nav");
      await sidebar.waitFor();
      assert.equal(
        await page.locator("button button").count(),
        0,
        "No nested buttons",
      );
      if (width < 768) {
        assert.equal(await toggle.isVisible(), true);
        assert.equal(await menu.isVisible(), false);
        await toggle.focus();
        await page.keyboard.press("Enter");
        assert.equal(await toggle.getAttribute("aria-expanded"), "true");
        await page.screenshot({
          path: path.join(output, `${kind}-${width}-expanded.png`),
        });
        const choice = menu.locator(".teacher-settings-section").nth(1);
        await choice.focus();
        await page.keyboard.press("Enter");
        assert.equal(await toggle.getAttribute("aria-expanded"), "false");
        assert.equal(await menu.isVisible(), false);
        assert.equal(
          await toggle.evaluate((el) => el === document.activeElement),
          true,
          "Selection restores focus to toggle",
        );
        await page.keyboard.press("Space");
        assert.equal(await menu.isVisible(), true);
        await menu.locator(".teacher-settings-section").first().focus();
        await page.keyboard.press("Escape");
        assert.equal(await menu.isVisible(), false);
        assert.equal(
          await toggle.evaluate((el) => el === document.activeElement),
          true,
          "Escape restores focus",
        );
      } else {
        assert.equal(await toggle.isVisible(), false);
        assert.equal(await menu.isVisible(), true);
        assert.equal(
          Math.round((await sidebar.boundingBox()).width),
          width < 1024 ? 256 : 288,
          "Settings sidebar width",
        );
        await menu.locator(".teacher-settings-section").nth(1).click();
      }
      assert.equal(
        await page.getByTestId("active").textContent(),
        kind === "rank" ? "rank_settings" : "second",
      );
      if (kind !== "rank") {
        const action = sidebar.getByRole("button", {
          name: kind === "map" ? "지도 추가" : "자료 추가",
          exact: true,
        });
        await action.focus();
        await page.keyboard.press("Enter");
        assert.equal(await page.getByTestId("actions").textContent(), "1");
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        "No page overflow with long Korean labels",
      );
      assert.deepEqual(errors, []);
      await page.screenshot({
        path: path.join(output, `${kind}-${width}.png`),
      });
      await page.close();
      console.log(
        `PASS ${kind} ${width}px: layout, selection, keyboard, focus, actions, overflow`,
      );
    }
  console.log(`Evidence: ${output}`);
  console.log(
    "Limitation: real navigation components and settings CSS, fixture data/content and minimal utility CSS; no authenticated portal or Firebase writes.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
