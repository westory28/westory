/** Real notice renderer; synthetic images and local-only network verification. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidence =
  process.env.NOTICE_IMAGE_EVIDENCE_DIR ||
  path.join(root, "output/notice-images-20261026");
const source = await fs.readFile(
  path.join(root, "src/pages/DeveloperLog.tsx"),
  "utf8",
);
const ast = ts.createSourceFile(
  "DeveloperLog.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const names = new Set([
  "renderPostDetail",
  "hasEventArticleMarkup",
  "stripHtml",
]);
const parts = new Map();
const visit = (node) => {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    names.has(node.name.text)
  )
    parts.set(node.name.text, `const ${node.getText(ast)};`);
  ts.forEachChild(node, visit);
};
visit(ast);
assert.equal(parts.size, names.size);
const article = (theme, version = 1) =>
  `<article class="westory-event-article we-notice-images we-notice-images--${theme}"><figure class="we-notice-images__cover"><img src="/cover/${theme}.svg" width="1200" height="675" alt="${theme} 대표 배너"></figure><section class="we-notice-images__details"><figure><img src="/detail/${theme}-${version}-one.svg" srcset="/detail/${theme}-${version}-one-2x.svg 2x" width="1200" height="1600" alt="원문 검색 확인: 선택형 21문항, 논술형 1문항. 교과서 112~149쪽."></figure><figure><img src="/detail/${theme}-${version}-two.svg" width="1200" height="1600" alt="원문 검색 확인: 검정색 볼펜을 준비합니다."></figure></section></article>`;
const entries = {
  performance: article("performance"),
  exam: article("exam"),
  reopen: article("reopen"),
  edited: article("performance", 2),
  legacy:
    '<article class="westory-event-article we-event"><h2>기존 안내</h2><p>기존 실제 본문은 바로 보입니다.</p><table><tbody><tr><td>기존 표</td></tr></tbody></table><img src="/legacy/inline.svg" alt="기존 안내 그림"></article>',
  ordinary: "<p>일반 개발자 일지 본문</p>",
};
const entry = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import NoticeImageArticle,{hasNoticeImageArticleMarkup} from './src/components/common/NoticeImageArticle';
${parts.get("hasEventArticleMarkup")}
${parts.get("stripHtml")}
const activeCardImageIndex=0,liked=false,canManage=false,cardSwipeStartRef={current:null};
const renderCategoryBadge=()=>null,getDisplayTitle=p=>p.title,formatDate=()=> '2026.10.26';
const Link=({to,...props})=><a href={to} {...props}/>;
const toggleLike=()=>{},navigate=()=>{},startEdit=()=>{},deletePost=()=>{},moveCardImage=()=>{},setActiveCardImageIndex=()=>{},handleCardSwipeStart=()=>{},handleCardSwipeEnd=()=>{};
${parts.get("renderPostDetail")}
const entries=${JSON.stringify(entries)};
function App(){
 const[entry,setEntry]=useState('performance'),[preview,setPreview]=useState(false),[search,setSearch]=useState('');
 const post={id:entry==='edited'?'performance':entry,title:entry==='exam'?'시험범위 안내':'수행평가 안내',summary:'',category:entry==='ordinary'?'feature':'notice',images:entry==='ordinary'?[{imageUrl:'/ordinary/card.svg',imageStoragePath:'fixture',alt:'기존 카드뉴스'}]:[],isPinned:false,viewCount:0,likeCount:0,createdByName:'검증 교사',bodyHtml:entries[entry]};
 return <><nav>{Object.keys(entries).map(key=><button key={key} onClick={()=>setEntry(key)} data-entry={key}>{key}</button>)}<button onClick={()=>setPreview(!preview)} data-preview>미리보기 전환</button><button onClick={()=>setSearch(stripHtml(entries.performance))} data-search>본문 검색</button></nav><output data-search-result>{search}</output><main>{renderPostDetail(post,preview)}</main></>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
`;
const result = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
});
const stylesheet = await fs.readFile(
  path.join(root, "src/pages/developerEventArticles.css"),
  "utf8",
);
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}body{margin:0;font:16px/1.6 'Malgun Gothic',sans-serif;background:#f9fafb;color:#1f2937}nav{display:flex;gap:8px;flex-wrap:wrap;padding:8px}button{font:inherit}main{padding:16px;max-width:1152px;margin:auto}h1{font-size:24px;word-break:keep-all}img{max-width:100%}.p-5{padding:20px}.py-8{padding-block:32px}.bg-white{background:white}.flex{display:flex}.flex-col{flex-direction:column}.flex-wrap{flex-wrap:wrap}.gap-4{gap:16px}.gap-3{gap:12px}.gap-2{gap:8px}.border-b{border-bottom:1px solid #e5e7eb}.pb-6{padding-bottom:24px}.mt-4{margin-top:16px}.hidden{display:none}.min-w-0{min-width:0}.grid{display:grid;gap:32px}.overflow-hidden{overflow:hidden}.shrink-0{flex-shrink:0}.w-full{width:100%}.h-full{height:100%}.rounded-2xl{border-radius:16px}output{display:block}figure{margin:24px 0}.developer-log-rich-text img{border-radius:12px}.developer-log-event-layout{min-width:0}
${stylesheet}
</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  if (pathname === "/fixture.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(result.outputFiles[0].text);
  } else if (pathname.endsWith(".svg")) {
    const cover = pathname.startsWith("/cover/");
    const exam = pathname.includes("exam");
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public,max-age=86400");
    res.end(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${cover ? 675 : 1600}" viewBox="0 0 1200 ${cover ? 675 : 1600}"><rect width="1200" height="100%" fill="${exam ? "#e9fbf5" : "#fff7e6"}"/><text x="80" y="180" font-size="60" font-family="sans-serif" fill="${exam ? "#07575b" : "#781f28"}">${cover ? "대표 배너" : "선택형 21문항 · 논술형 1문항"}</text><text x="80" y="280" font-size="48" font-family="sans-serif">${cover ? "더보기 전 대표 이미지만 표시" : "교과서 112~149쪽"}</text></svg>`,
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
const report = [];
try {
  await fs.mkdir(evidence, { recursive: true });
  for (const width of [390, 768, 1280]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1,
    });
    const requests = [],
      errors = [];
    page.on("request", (request) =>
      requests.push(new URL(request.url()).pathname),
    );
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      route.request().url().startsWith(address)
        ? route.continue()
        : route.abort(),
    );
    await page.goto(address);
    const toggle = page.getByRole("button", { name: "더보기", exact: true });
    await toggle.waitFor();
    await page.locator("[data-search]").click();
    await page.waitForTimeout(200);
    assert.equal(
      await page.locator(".we-notice-images__details img").count(),
      0,
    );
    assert.equal(
      requests.filter((url) => url.startsWith("/detail/")).length,
      0,
      "No detail src/srcset requests before explicit expansion or while searching",
    );
    assert.match(
      await page.locator("[data-search-result]").textContent(),
      /선택형 21문항/,
    );
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    await page.screenshot({
      path: path.join(evidence, `collapsed-${width}.png`),
      fullPage: true,
    });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await page
      .locator(".we-notice-images__details img")
      .last()
      .scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".we-notice-images__details img")]
          .length === 2 &&
        [...document.querySelectorAll(".we-notice-images__details img")].every(
          (img) => img.complete && img.naturalWidth > 0,
        ),
    );
    assert(requests.some((url) => url.startsWith("/detail/performance-1-one")));
    assert(requests.some((url) => url.startsWith("/detail/performance-1-two")));
    const dimensions = await page.evaluate(() => {
      const article = document.querySelector(".we-notice-images");
      const outer = document.querySelector(".developer-log-image-post");
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        width: article.getBoundingClientRect().width,
        insideOuter:
          article.getBoundingClientRect().left >=
            outer.getBoundingClientRect().left &&
          article.getBoundingClientRect().right <=
            outer.getBoundingClientRect().right,
        panels: [...article.querySelectorAll("figure")].map((el) => ({
          width: el.getBoundingClientRect().width,
          margin: getComputedStyle(el).margin,
          border: getComputedStyle(el).borderWidth,
        })),
      };
    });
    assert.equal(dimensions.overflow, 0);
    assert(dimensions.width <= 720);
    assert(dimensions.insideOuter, "Panels stay inside the detail article");
    assert(
      dimensions.panels.every(
        (panel) => panel.margin === "0px" && panel.border === "0px",
      ),
    );
    assert.equal(
      await page
        .locator(".we-notice-images__details a")
        .first()
        .getAttribute("target"),
      "_blank",
    );
    assert.equal(
      await page
        .locator(".we-notice-images__details img")
        .first()
        .getAttribute("alt"),
      "원문 검색 확인: 선택형 21문항, 논술형 1문항. 교과서 112~149쪽.",
    );
    await page.screenshot({
      path: path.join(evidence, `expanded-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "접기", exact: true }).click();
    assert.equal(
      await page.locator(".we-notice-images__details img").count(),
      0,
    );
    await page.getByRole("button", { name: "더보기", exact: true }).click();
    await page.locator('[data-entry="exam"]').click();
    await page.getByRole("button", { name: "더보기", exact: true }).waitFor();
    assert.equal(
      await page.locator(".we-notice-images__details img").count(),
      0,
    );
    assert.equal(
      requests.filter((url) => url.startsWith("/detail/exam")).length,
      0,
      "Changing post ID resets",
    );
    await page.locator('[data-entry="performance"]').click();
    await page.getByRole("button", { name: "더보기", exact: true }).click();
    await page.locator('[data-entry="edited"]').click();
    await page.getByRole("button", { name: "더보기", exact: true }).waitFor();
    assert.equal(
      await page.locator(".we-notice-images__details img").count(),
      0,
    );
    assert.equal(
      requests.filter((url) => url.startsWith("/detail/performance-2")).length,
      0,
      "Changing body on same post ID resets",
    );
    await page.locator('[data-entry="reopen"]').click();
    await page.getByRole("button", { name: "더보기", exact: true }).waitFor();
    assert.equal(await page.locator(".we-notice-images--reopen").count(), 1);
    assert.equal(
      await page.locator(".we-notice-images__details img").count(),
      0,
    );
    assert.equal(
      requests.filter((url) => url.startsWith("/detail/reopen")).length,
      0,
    );
    await page.getByRole("button", { name: "더보기", exact: true }).click();
    assert.equal(
      await page.locator(".we-notice-images__details img").count(),
      2,
    );
    await page.getByRole("button", { name: "접기", exact: true }).click();
    await page.getByRole("button", { name: "더보기", exact: true }).click();
    await page.locator("[data-preview]").click();
    await page.getByRole("button", { name: "더보기", exact: true }).waitFor();
    assert.equal(
      await page.locator(".we-notice-images__details img").count(),
      0,
      "Preview resets",
    );
    await page.locator('[data-entry="legacy"]').click();
    assert.equal(await page.locator(".we-notice-images__toggle").count(), 0);
    assert.equal(
      await page.getByText("기존 실제 본문은 바로 보입니다.").count(),
      1,
    );
    assert.equal(await page.locator(".we-event table").count(), 1);
    await page.locator('[data-entry="ordinary"]').click();
    assert.equal(await page.locator(".we-notice-images__toggle").count(), 0);
    assert.equal(
      await page.locator('[aria-label="카드뉴스 이미지 슬라이드"]').count(),
      1,
    );
    assert.equal(await page.getByText("일반 개발자 일지 본문").count(), 1);
    assert.deepEqual(errors, []);
    report.push({
      width,
      dimensions,
      collapsedDetailRequests: 0,
      keyboardExpand: true,
      collapse: true,
      postReset: true,
      bodyReset: true,
      previewReset: true,
      searchAlt: true,
      legacyArticle: true,
      ordinaryCarousel: true,
      requests,
    });
    await page.close();
  }
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    `PASS 390/768/1280: inert image requests, search alt, keyboard expansion, collapse/reset, original links, ordinary articles. Evidence: ${evidence}`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
