import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const runtime = path.join(
  os.homedir(),
  ".cache/codex-runtimes/codex-primary-runtime/dependencies",
);
const require = createRequire(path.join(root, "package.json"));
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ||
    path.join(runtime, "node/node_modules/playwright"),
);
const out = path.resolve(
  process.env.WRITTEN_EXAM_CROP_EVIDENCE_DIR ||
    path.join(root, "..", "evidence", "written-exam-paper-crop"),
);
await fs.mkdir(out, { recursive: true });
const fixture = path.join(out, "synthetic-paper.pdf");
const python =
  process.env.PDF_QA_PYTHON || path.join(runtime, "python/python.exe");
execFileSync(
  python,
  [
    "-c",
    `
from reportlab.pdfgen.canvas import Canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import sys
pdfmetrics.registerFont(TTFont('Korean', 'C:/Windows/Fonts/malgun.ttf'))
c=Canvas(sys.argv[1],pagesize=(600,850))
for page in range(2):
  c.setFont('Korean',10)
  for col,x in enumerate([36,330]):
    for row,y in enumerate([770,420]):
      n=page*4+col*2+row+1
      c.drawString(x,y,str(n)+'. 다음 자료를 읽고 물음에 답하시오.')
      c.drawString(x+12,y-20,'가상 자료: 조선의 성립과 발전')
      c.rect(x+12,y-85,180,45)
      c.drawString(x+20,y-65,'문항별 그림 영역')
      for i,marker in enumerate('①②③④⑤'):
        c.drawString(x+10,y-110-i*24,marker+' 가상 선택지 '+str(i+1))
      if row==1:
        c.drawString(x,y-265,'서술형 1. 이 영역은 크롭에서 제외합니다.')
  c.drawCentredString(300,18,str(page+1))
  c.showPage()
c.save()
`,
    fixture,
  ],
  { stdio: "pipe" },
);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const base = process.env.WRITTEN_EXAM_QA_ORIGIN || "http://127.0.0.1:5178";
  await page.route("**/__pdf_crop_qa__", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<html><body style="margin:24px;background:#f7f8fa"><h1>가상 정기시험 문항 크롭</h1><main style="display:grid;grid-template-columns:repeat(4,1fr);gap:20px"></main></body></html>',
    }),
  );
  await page.route("**/synthetic-paper.pdf", (route) =>
    route.fulfill({ contentType: "application/pdf", path: fixture }),
  );
  // This isolated checkout shares node_modules through a junction outside Vite's
  // FS allow-list. Serve the same installed worker without weakening app config.
  await page.route("**/pdf.worker.min.mjs*", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      path: path.join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
    }),
  );
  await page.goto(`${base}/__pdf_crop_qa__`);
  const result = await page.evaluate(async () => {
    const module = await import("/src/lib/writtenExamPaperCrop.ts");
    const blob = await (await fetch("/synthetic-paper.pdf")).blob();
    const questions = Array.from({ length: 8 }, (_, index) => ({
      number: index + 1,
      answer: String((index % 5) + 1),
    }));
    const paper = await module.processWrittenExamPaper(
      new File([blob], "synthetic-paper.pdf", { type: "application/pdf" }),
      questions,
    );
    const rendered = [];
    for (const crop of paper.crops) {
      const result = await module.renderWrittenExamCrop(
        paper.pages.find((page) => page.page === crop.page).blob,
        crop,
      );
      const img = document.createElement("img");
      img.src = URL.createObjectURL(result);
      img.style.width = "100%";
      img.alt = crop.questionNumber + "번";
      const cell = document.createElement("section");
      const label = document.createElement("h2");
      label.textContent = crop.questionNumber + "번";
      cell.append(label, img);
      document.querySelector("main").append(cell);
      await img.decode();
      rendered.push({
        number: crop.questionNumber,
        width: img.naturalWidth,
        height: img.naturalHeight,
        size: result.size,
      });
    }
    return {
      pages: paper.pages.map(({ page, width, height }) => ({
        page,
        width,
        height,
      })),
      crops: paper.crops,
      warnings: paper.warnings,
      rendered,
    };
  });
  assert.equal(result.pages.length, 2);
  assert.equal(result.crops.length, 8);
  assert.ok(
    result.crops.every((crop) => crop.status === "ready"),
    JSON.stringify(result.crops),
  );
  assert.ok(result.crops.every((crop) => crop.highlights.length === 1));
  assert.ok(
    result.rendered.every(
      (image) => image.width > 600 && image.height > 500 && image.size > 1000,
    ),
  );
  assert.ok(
    result.crops
      .filter((crop) => [2, 4, 6, 8].includes(crop.questionNumber))
      .every((crop) => crop.rect.y + crop.rect.height < 0.81),
    "Essay section must not enter the final objective crop",
  );
  await page.screenshot({
    path: path.join(out, "crop-gallery.png"),
    fullPage: true,
  });
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    `PASS real PDF pipeline: 2 pages, 2 columns, 8 questions, vector figures, answer-only highlights, essay exclusion. Evidence: ${out}`,
  );
} finally {
  await browser.close();
}
