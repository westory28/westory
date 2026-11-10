/** Synthetic rich-text security/compatibility QA. No production services. */
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import ts from "typescript";

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
const evidence = await mkdtemp(path.join(os.tmpdir(), "westory-rich-html-"));
const source = await readFile("src/pages/DeveloperLog.tsx", "utf8");
const ast = ts.createSourceFile(
  "DeveloperLog.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let editor;
function visit(node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(ast) === "EventArticleEditor"
  )
    editor = `const ${node.getText(ast)};`;
  ts.forEachChild(node, visit);
}
visit(ast);
assert(editor, "Exercise the actual event article editor");

const entry = `import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {sanitizeRichHtml} from './src/lib/sanitizeRichHtml';
import NoticeImageArticle from './src/components/common/NoticeImageArticle';
import LessonFootnoteDialog from './src/components/common/LessonFootnoteDialog';
import TeacherLessonPresentation from './src/pages/teacher/components/TeacherLessonPresentation';
${editor}
const root=createRoot(document.getElementById('root'));
window.securityQa={sanitize:sanitizeRichHtml,mount(mode,html){
 const content=mode==='editor'?<EventArticleEditor value={html} onChange={value=>window.securityQa.edited=value}/>:
 mode==='notice'?<NoticeImageArticle bodyHtml={html} title="합성 안내"/>:
 mode==='footnote'?<LessonFootnoteDialog open footnote={{id:'note',anchorKey:'note',title:'합성 각주',type:'text',bodyHtml:html}} onClose={()=>{}}/>:
 mode==='presentation'?<TeacherLessonPresentation lesson={{unitId:'fixture',title:'합성 수업',contentHtml:html,footnotes:[]}}/>:
 <div className="policy-rich-text" dangerouslySetInnerHTML={{__html:sanitizeRichHtml(html)}}/>;
 root.render(content);
}};`;
const built = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: process.cwd() },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "offline-components",
      setup(build) {
        build.onResolve(
          { filter: /(?:LessonWorksheetStage|StorageImage)$/ },
          (args) => ({ path: args.path, namespace: "offline" }),
        );
        build.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
          contents: "export default function Fixture(){return null}",
          loader: "js",
        }));
      },
    },
  ],
});
const server = http.createServer((req, res) => {
  if (req.url === "/fixture.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(built.outputFiles[0].text);
  }
  if (req.url.startsWith("/broken")) {
    res.writeHead(404);
    return res.end();
  }
  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.end(
    '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;font:16px sans-serif}table{border-collapse:collapse;max-width:100%}td,th{padding:6px;border:1px solid}img{max-width:100%}#root{max-width:900px;margin:auto}</style><div id="root"></div><script src="/fixture.js"></script></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
  headless: true,
});
const page = await browser.newPage();
const errors = [],
  external = [],
  dialogs = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("dialog", async (dialog) => {
  dialogs.push(dialog.message());
  await dialog.dismiss();
});
await page.route("**/*", (route) => {
  if (
    route.request().url().startsWith(origin) ||
    route.request().url().startsWith("data:")
  )
    return route.continue();
  external.push(route.request().url());
  return route.abort();
});
const attacks = [
  '<img src="/broken" onerror="window.__executed++"><script>window.__executed++</script>',
  '<svg onload="window.__executed++"><a xlink:href="javascript:window.__executed++">실행</a></svg>',
  '<a href="java&#x09;script:window.__executed++">위험 링크</a><img src="data:image/svg+xml;base64,PHN2Zy8+">',
  '<iframe srcdoc="<script>parent.__executed++</script>"></iframe><object data="javascript:window.__executed++"></object>',
  '<form><input autofocus onfocus="window.__executed++"><button formaction="javascript:window.__executed++">전송</button></form>',
  '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=/broken onerror=window.__executed++>">',
  '<p style="background-image:url(https://invalid.example/track)">문자</p><base href="https://invalid.example/"><meta http-equiv="refresh" content="0;url=https://invalid.example/">',
];
const normal =
  '<article class="westory-event-article"><h2>합성 안내</h2><p class="ql-align-center" style="color:rgb(30, 64, 175);font-size:18px;text-align:center">2026년 11월 10일 <strong>한글 서식</strong> [세종] [fn:note]</p><ol start="3"><li data-list="ordered" data-start="3" style="counter-reset:list-0 2">목록</li></ol><table><tbody><tr><th scope="col">평가명</th><td colspan="2">자료 1</td></tr></tbody></table><a href="https://example.invalid/lesson" target="_blank">안전한 링크</a></article>';
try {
  await page.goto(origin);
  await page.waitForFunction(() => window.securityQa);
  await page.evaluate(() => (window.__executed = 0));
  for (const mode of ["policy", "editor", "footnote", "presentation"]) {
    for (const attack of attacks) {
      await page.evaluate(
        ({ mode, html }) => window.securityQa.mount(mode, html),
        { mode, html: attack },
      );
      await page.waitForTimeout(25);
      assert.equal(
        await page
          .locator(
            "#root script,#root iframe,#root object,#root form,#root input,#root button[formaction],#root base,#root meta",
          )
          .count(),
        0,
        `${mode}: active document/form removed`,
      );
      assert.equal(
        await page.evaluate(() =>
          [...document.querySelectorAll("#root *")].some((node) =>
            [...node.attributes].some(
              (attr) =>
                /^on/i.test(attr.name) ||
                /^(?:java|vb)script:/i.test(attr.value.replace(/\s/g, "")),
            ),
          ),
        ),
        false,
        `${mode}: events/active URLs removed`,
      );
    }
  }
  assert.equal(await page.evaluate(() => window.__executed), 0);
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(
      (html) => window.securityQa.mount("policy", html),
      normal,
    );
    await page.getByText("평가명", { exact: true }).waitFor();
    assert.equal(
      await page
        .locator("article.westory-event-article table td")
        .getAttribute("colspan"),
      "2",
    );
    assert.equal(await page.locator("li").getAttribute("data-start"), "3");
    assert.equal(await page.locator("ol").getAttribute("start"), "3");
    assert.equal(
      await page
        .locator("p")
        .evaluate((node) => getComputedStyle(node).textAlign),
      "center",
    );
    assert.equal(
      await page.locator("p").evaluate((node) => getComputedStyle(node).color),
      "rgb(30, 64, 175)",
    );
    assert.match(await page.locator("p").textContent(), /\[세종\] \[fn:note\]/);
    assert.match(await page.locator("a").getAttribute("rel"), /noopener/);
    assert.match(await page.locator("a").getAttribute("rel"), /noreferrer/);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: path.join(evidence, `rich-text-${width}.png`),
    });
  }
  await page.evaluate(
    (html) => window.securityQa.mount("editor", html),
    normal,
  );
  const editorBox = page.getByRole("textbox", { name: "본문", exact: true });
  await editorBox.waitFor();
  assert.equal(await editorBox.locator("table").count(), 1);
  await editorBox.press("Control+End");
  await editorBox.pressSequentially(" 편집 유지");
  assert.match(
    await page.evaluate(() => window.securityQa.edited),
    /편집 유지/,
  );
  await page.evaluate(() =>
    window.securityQa.mount(
      "notice",
      '<article class="we-notice-images"><figure class="we-notice-images__cover"><img src="/broken-cover" alt="대표 안내" onerror="window.__executed++"></figure><section class="we-notice-images__details"><img src="/broken-detail" srcset="/broken-detail-2x 2x" alt="상세 안내"></section></article>',
    ),
  );
  await page.getByRole("button", { name: "더보기" }).click();
  assert.equal(
    await page.getByAltText("상세 안내").getAttribute("srcset"),
    "/broken-detail-2x 2x",
  );
  assert.equal(await page.evaluate(() => window.__executed), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  assert.deepEqual(dialogs, []);
  const result = {
    pass: true,
    evidence,
    attackCases: attacks.length,
    modes: 4,
    widths: [390, 768, 1280],
    checks:
      "Stored-XSS/mutation/URI/form/CSS blocking; Korean text, tables, Quill styles, lists, lesson tokens, editing, notice srcset and link isolation preserved; no service calls",
  };
  await writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
