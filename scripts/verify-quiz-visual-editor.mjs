import assert from "node:assert/strict";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["src/pages/teacher/components/quizVisualDocument.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const {
  parseQuizVisualDocument: parse,
  serializeQuizVisualDocument: save,
  quizVisualText: text,
  formatQuizVisualDocument: format,
  replaceQuizVisualSelection: replace,
  sliceQuizVisualDocument: slice,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const samples = [
  "",
  "왕권을 강화하고 사회를 통합하였다.",
  "{{box:(가)}}의 정책은 {{u:왕권 강화}}를 위한 것이었다.",
  "{{bullet}}삼국의 {{u:불교 수용}}\n{{bullet}}중앙 집권 체제",
  "(가)는 {{blank:소수림왕}}이다.",
  "앞줄\n\n뒷줄\n",
  "<img src=x onerror=alert(1)>는 실행되지 않는 문자열",
  "{{blank:}} {{box:}}",
  "{{bullet}}\n다음 줄",
  "{{blankbox:3.4|(가)}}의 정책",
];
let count = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  count += 1;
};
samples.forEach((sample) =>
  check(
    save(parse(sample)),
    sample,
    "Existing stored token format round trips",
  ),
);
check(
  save(parse("{{bullet:왕권 강화}}")),
  "{{bullet}}왕권 강화",
  "Legacy bullet equivalent",
);
check(save(parse("앞\r\n뒤")), "앞\n뒤", "CRLF line semantics");
const base = parse("왕권 강화와 사회 통합\n불교 수용");
check(
  save(format(base, 0, 5, "underline")),
  "{{u:왕권 강화}}와 사회 통합\n불교 수용",
  "Selected word underline",
);
check(
  save(format(parse("{{u:왕권 강화}}와 통합"), 0, 2, "box")),
  "{{box:왕권}}{{u: 강화}}와 통합",
  "No nested tokens on overlapping formatting",
);
check(
  save(format(parse("{{u:왕권 강화}}"), 0, 5, "text")),
  "왕권 강화",
  "Remove mark preserves text",
);
check(
  save(format(parse("왕권\n불교"), 0, 5, "bullet")),
  "{{bullet}}왕권\n{{bullet}}불교",
  "Bullet multiple selected lines",
);
check(
  save(format(parse("{{bullet}}왕권\n{{bullet}}불교"), 0, 5, "bullet")),
  "왕권\n불교",
  "Bullet toggle",
);
check(
  save(base),
  "왕권 강화와 사회 통합\n불교 수용",
  "Commands do not mutate existing history document",
);
check(
  save(replace(parse("왕권 강화"), 3, 5, parse("{{u:중앙 집권}}"))),
  "왕권 {{u:중앙 집권}}",
  "Inline paste replaces selection without new paragraph",
);
check(
  save(replace(parse("앞뒤"), 1, 1, parse("첫 줄\n둘째 줄"))),
  "앞첫 줄\n둘째 줄뒤",
  "Multiline paste merges surrounding content",
);
check(
  save(replace(parse("앞\n중간\n뒤"), 1, 5, parse(""))),
  "앞뒤",
  "Multirow selection deletion",
);
check(
  text(parse("{{u:왕권}}과 {{box:(가)}}")),
  "왕권과 (가)",
  "Editor has no visible markup tokens",
);
const adjacent = "{{box:(가)}}{{box:(나)}}와 {{blank:가}}{{blank:나}}";
check(
  save(parse(adjacent)),
  adjacent,
  "Adjacent boxes and blanks stay independent",
);
check(
  save(format(parse(adjacent), 6, 7, "underline")),
  "{{box:(가)}}{{box:(나)}}{{u:와}} {{blank:가}}{{blank:나}}",
  "Unrelated format preserves distinct markers",
);
check(
  save(replace(parse(adjacent), 10, 10, parse(" 추가"))),
  `${adjacent} 추가`,
  "Appending text preserves marker boundaries",
);
check(
  save(format(parse("가나다"), 0, 3, "box")),
  "{{box:가나다}}",
  "One format action creates one box",
);
check(
  save(replace(parse("{{box:(가)}}"), 3, 3, parse("{{box:(나)}}"))),
  "{{box:(가)}}{{box:(나)}}",
  "Pasted neighboring boxes stay independent",
);
check(
  save(slice(parse("앞 {{blankbox:3.4|(가)}} 뒤"), 2, 5)),
  "{{blankbox:3.4|(가)}}",
  "Selected labeled blank preserves width",
);
check(
  save(format(parse("{{blankbox:3.4|(가)}} 설명"), 4, 6, "underline")),
  "{{blankbox:3.4|(가)}} {{u:설명}}",
  "Unrelated formatting preserves labeled blank width",
);
check(
  save(replace(parse("앞뒤"), 1, 1, parse("{{blankbox:3.4|(가)}}"))),
  "앞{{blankbox:3.4|(가)}}뒤",
  "Insert labeled blank at caret",
);
check(
  text(parse("{{blankbox:3.4|(가)}}")),
  "(가)",
  "Labeled blank editor contains only public label",
);
check(
  save(slice(parse("첫 줄\n둘째 줄\n셋째 줄"), 2, 8)),
  "줄\n둘째 줄",
  "Clipboard selection keeps line breaks without unrelated text",
);
console.log(
  `PASS ${count} quiz visual editor regressions (legacy round trip, selection, overlap, paste and token-only serialization)`,
);

if (process.argv.includes("--browser")) {
  const { default: fs } = await import("node:fs/promises");
  const { default: path } = await import("node:path");
  const { default: os } = await import("node:os");
  const { default: http } = await import("node:http");
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const { chromium } = require(
    process.env.PLAYWRIGHT_MODULE_PATH ||
      path.join(
        os.homedir(),
        ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
      ),
  );
  const artifactDir =
    process.env.QUIZ_VISUAL_EVIDENCE_DIR ||
    (await fs.mkdtemp(path.join(os.tmpdir(), "westory-visual-editor-")));
  await fs.mkdir(artifactDir, { recursive: true });
  const built = await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Fixture from './scripts/fixtures/QuizVisualEditorFixture';createRoot(document.getElementById('root')).render(<Fixture/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    outfile: "fixture.js",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const js = built.outputFiles.find((file) => file.path.endsWith(".js")).text;
  const css =
    built.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "";
  assert(
    !/firestore\.googleapis|firebase\/auth/.test(js),
    "Fixture must not load a live service",
  );
  const server = http.createServer((request, response) => {
    if (request.url === "/fixture.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(js);
    } else if (request.url === "/fixture.css") {
      response.setHeader("Content-Type", "text/css");
      response.end(css);
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end(
        '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}main{max-width:960px;margin:auto;padding:16px}button{font:inherit;border:0;cursor:pointer}textarea{display:block;width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>',
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  let browserChecks = 0;
  const checkBrowser = (actual, expected, message) => {
    assert.deepEqual(actual, expected, message);
    browserChecks++;
  };
  try {
    const context = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });
    await context.route("**/*", (route) =>
      route.request().url().startsWith(origin)
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const viewport of [390, 768, 1280]) {
      await page.setViewportSize({ width: viewport, height: 900 });
      await page.goto(origin);
      await page.waitForFunction(() => window.quizVisualFixture);
      checkBrowser(
        await page
          .getByRole("status")
          .first()
          .textContent()
          .then((text) => text.startsWith("PASS")),
        true,
        `${viewport}: DOM sanitization checks`,
      );
      checkBrowser(
        await page
          .locator('[contenteditable="true"]')
          .textContent()
          .then((text) => /\{\{|<<|>>/.test(text)),
        false,
        `${viewport}: no source markers in editor`,
      );
      await page
        .getByRole("textbox", { name: "높이 자동 조절", exact: true })
        .fill(
          Array.from({ length: 30 }, (_, i) => `한글 어절 유지 ${i}`).join(
            "\n",
          ),
        );
      const heights = await page.evaluate(() =>
        ["높이 자동 조절", "기존 높이 제한"].map((name) => {
          const field = document.querySelector(`[aria-label="${name}"]`);
          return {
            height: field.clientHeight,
            scroll: field.scrollHeight,
            overflow: getComputedStyle(field).overflowY,
          };
        }),
      );
      checkBrowser(
        heights[0].height >= heights[0].scroll - 2 &&
          heights[0].overflow === "hidden",
        true,
        `${viewport}: opt-in grows with no inner scroll`,
      );
      checkBrowser(
        heights[1].height <= 240 && heights[1].overflow === "auto",
        true,
        `${viewport}: existing default keeps height limit`,
      );
      checkBrowser(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
        `${viewport}: no page overflow`,
      );
      await page.evaluate(() =>
        window.quizVisualFixture.reset("{{blankbox:30|(가)}}"),
      );
      await page.waitForFunction(
        () => window.quizVisualFixture.value === "{{blankbox:30|(가)}}",
      );
      checkBrowser(
        await page
          .locator('[contenteditable="true"]')
          .evaluate((root) => root.scrollWidth <= root.clientWidth + 1),
        true,
        `${viewport}: largest blank fits editor width`,
      );
      await page.screenshot({
        path: path.join(artifactDir, `editor-${viewport}.png`),
        fullPage: true,
      });
    }
    const reset = async (value) => {
      await page.evaluate(
        (text) => window.quizVisualFixture.reset(text),
        value,
      );
      await page.waitForFunction(
        (text) => window.quizVisualFixture.value === text,
        value,
      );
    };
    const select = async (start, end = start) =>
      page.evaluate(
        ({ start, end }) => window.quizVisualFixture.select(start, end),
        { start, end },
      );
    await reset("태종의 정책");
    await select(0, 2);
    await page
      .getByRole("button", { name: "검증 지문 밑줄", exact: true })
      .click();
    checkBrowser(
      await page.evaluate(() => window.quizVisualFixture.value),
      "{{u:태종}}의 정책",
      "Underline toolbar preserves selection",
    );
    await page
      .getByRole("button", { name: "검증 지문 복사", exact: true })
      .click();
    await page.waitForFunction(
      async () => (await navigator.clipboard.readText()) === "태종",
    );
    checkBrowser(
      await page.evaluate(() => navigator.clipboard.readText()),
      "태종",
      "Copy toolbar writes normal visible text",
    );
    await page
      .getByRole("button", { name: "검증 지문 잘라내기", exact: true })
      .click();
    await page.waitForFunction(
      () => window.quizVisualFixture.value === "의 정책",
    );
    await page
      .getByRole("button", { name: "검증 지문 실행 취소", exact: true })
      .click();
    checkBrowser(
      await page.evaluate(() => window.quizVisualFixture.value),
      "{{u:태종}}의 정책",
      "Cut is one undoable operation",
    );
    await page
      .getByRole("button", { name: "검증 지문 다시 실행", exact: true })
      .click();
    checkBrowser(
      await page.evaluate(() => window.quizVisualFixture.value),
      "의 정책",
      "Cut redo",
    );
    await reset("이 사건은 위화도 회군이다.");
    await select(6, 12);
    await page
      .getByRole("button", { name: "검증 지문 빈칸 네모", exact: true })
      .click();
    await page
      .getByRole("textbox", {
        name: "검증 지문 빈칸 너비 기준 글자",
        exact: true,
      })
      .fill("위화도 회군");
    await page.getByRole("button", { name: "빈칸 넣기", exact: true }).click();
    const blank = await page.evaluate(() => ({
      value: window.quizVisualFixture.value,
      label: document.querySelector(
        '[contenteditable] [data-quiz-mark="blankBox"]',
      )?.textContent,
      width: document.querySelector(
        '[contenteditable] [data-quiz-mark="blankBox"]',
      )?.dataset.quizWidth,
    }));
    checkBrowser(blank.label, "(가)", "Public blank label visible");
    checkBrowser(
      blank.value.includes("위화도 회군"),
      false,
      "Reference answer text never enters saved value",
    );
    checkBrowser(
      Number(blank.width) > 3,
      true,
      "Width measured from reference text",
    );
    await select(0, 0);
    await page
      .getByRole("button", { name: "검증 지문 빈칸 네모", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "검증 지문 빈칸 기호", exact: true })
      .fill("(나)");
    await page.getByRole("button", { name: "빈칸 넣기", exact: true }).click();
    checkBrowser(
      await page
        .locator('[contenteditable] [data-quiz-mark="blankBox"]')
        .count(),
      2,
      "Insert blank at collapsed caret",
    );
    await reset("앞뒤");
    await select(1);
    const pasteMarkup = async (html, text = "") =>
      page.locator('[contenteditable="true"]').evaluate(
        (root, { html, text }) => {
          const data = new DataTransfer();
          data.setData("text/html", html);
          data.setData("text/plain", text);
          root.dispatchEvent(
            new ClipboardEvent("paste", {
              clipboardData: data,
              bubbles: true,
              cancelable: true,
            }),
          );
        },
        { html, text },
      );
    await pasteMarkup(
      '<p onclick="window.injected=true"><u>중간</u><img src="https://example.invalid/x" onerror="window.injected=true"></p><script>window.injected=true</script>',
    );
    checkBrowser(
      await page.evaluate(() => window.quizVisualFixture.value),
      "앞{{u:중간}}뒤",
      "HTML paste keeps inline text and underline",
    );
    checkBrowser(
      await page
        .locator(
          "[contenteditable] script,[contenteditable] img,[contenteditable] [onclick]",
        )
        .count(),
      0,
      "HTML paste creates no executable elements",
    );
    await select(1, 3);
    const copied = await page
      .locator('[contenteditable="true"]')
      .evaluate((root) => {
        const data = new DataTransfer();
        root.dispatchEvent(
          new ClipboardEvent("copy", {
            clipboardData: data,
            bubbles: true,
            cancelable: true,
          }),
        );
        return {
          text: data.getData("text/plain"),
          html: data.getData("text/html"),
        };
      });
    checkBrowser(copied.text, "중간", "Native copy visible text");
    checkBrowser(
      copied.html.includes("{{"),
      false,
      "Native copy has no storage markup",
    );
    await page.locator('[contenteditable="true"]').evaluate((root) => {
      const data = new DataTransfer();
      data.items.add(
        new File([new Uint8Array([137, 80, 78, 71])], "pasted.png", {
          type: "image/png",
        }),
      );
      root.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    checkBrowser(
      await page.getByLabel("붙여넣은 이미지").textContent(),
      "pasted.png:image/png",
      "Image paste delegates to local callback",
    );
    await reset("앞");
    await select(1);
    await page.locator('[contenteditable="true"]').evaluate((root) => {
      root.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
      );
      root.firstElementChild.textContent = "앞한";
      root.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertCompositionText",
          data: "한",
          isComposing: true,
        }),
      );
    });
    checkBrowser(
      await page.evaluate(() => window.quizVisualFixture.value),
      "앞",
      "IME intermediate input is not committed",
    );
    await page.locator('[contenteditable="true"]').evaluate((root) => {
      root.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "한" }),
      );
    });
    checkBrowser(
      await page.evaluate(() => window.quizVisualFixture.value),
      "앞한",
      "IME final composition commits once",
    );
    await page
      .getByRole("button", { name: "검증 지문 실행 취소", exact: true })
      .click();
    checkBrowser(
      await page.evaluate(() => window.quizVisualFixture.value),
      "앞",
      "IME composition undoes as one edit",
    );
    checkBrowser(errors, [], "No browser errors");
    console.log(
      `PASS ${browserChecks} visual editor browser checks; evidence: ${artifactDir}`,
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
