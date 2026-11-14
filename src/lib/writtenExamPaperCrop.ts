import type { WrittenExamQuestionInfo } from "./writtenExamAnalysisImport";

/** All persisted rectangles use page-relative coordinates, independent of raster size. */
export interface WrittenExamPaperRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface WrittenExamPaperCrop {
  questionNumber: number;
  page: number;
  rect: WrittenExamPaperRect;
  highlights: WrittenExamPaperRect[];
  status: "ready" | "review";
  warnings: string[];
}
export interface WrittenExamPaperPage {
  page: number;
  width: number;
  height: number;
  blob: Blob;
}
export interface WrittenExamPaperText {
  text: string;
  rect: WrittenExamPaperRect;
}
export interface WrittenExamPaperTextPage {
  page: number;
  width: number;
  height: number;
  items: WrittenExamPaperText[];
}

const right = (rect: WrittenExamPaperRect) => rect.x + rect.width;
const bottom = (rect: WrittenExamPaperRect) => rect.y + rect.height;
const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));
const intersects = (a: WrittenExamPaperRect, b: WrittenExamPaperRect) =>
  a.x < right(b) && right(a) > b.x && a.y < bottom(b) && bottom(a) > b.y;
export function normalizeWrittenExamPaperRect(
  rect: WrittenExamPaperRect,
): WrittenExamPaperRect {
  if (
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0
  )
    throw new Error("문항 영역의 위치와 크기를 확인해 주세요.");
  const x = clamp(rect.x),
    y = clamp(rect.y);
  const normalized = {
    x,
    y,
    width: clamp(rect.width, 0, 1 - x),
    height: clamp(rect.height, 0, 1 - y),
  };
  if (!normalized.width || !normalized.height)
    throw new Error("문항 영역이 페이지 밖에 있습니다.");
  return normalized;
}

function groupLines(items: WrittenExamPaperText[]) {
  const lines: WrittenExamPaperText[][] = [];
  for (const item of [...items].sort(
    (a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x,
  )) {
    const line = lines.find(
      (candidate) =>
        Math.abs(candidate[0].rect.y - item.rect.y) <=
        Math.max(
          0.003,
          Math.min(candidate[0].rect.height, item.rect.height) * 0.45,
        ),
    );
    if (line) line.push(item);
    else lines.push([item]);
  }
  return lines.map((line) => line.sort((a, b) => a.rect.x - b.rect.x));
}

function optionSegments(items: WrittenExamPaperText[]) {
  const segments: Array<WrittenExamPaperText & { option?: string }> = [];
  for (const line of groupLines(items)) {
    for (const item of line) {
      const markers = [...item.text.matchAll(/[①②③④⑤]/g)];
      if (!markers.length) {
        segments.push(item);
        continue;
      }
      for (let i = 0; i < markers.length; i++) {
        const marker = markers[i];
        const start = marker.index!;
        const end = markers[i + 1]?.index ?? item.text.length;
        // PDF text items provide no glyph positions. The option's full text item
        // is exact only when a marker begins its own item; combined markers need review.
        const exact = markers.length === 1 && start === 0;
        segments.push({
          text: item.text.slice(start, end),
          option: String("①②③④⑤".indexOf(marker[0]) + 1),
          rect: exact
            ? item.rect
            : {
                x: item.rect.x + (item.rect.width * start) / item.text.length,
                y: item.rect.y,
                width: (item.rect.width * (end - start)) / item.text.length,
                height: item.rect.height,
              },
          ...(exact ? {} : { approximate: true }),
        });
      }
    }
  }
  return segments as Array<
    WrittenExamPaperText & { option?: string; approximate?: boolean }
  >;
}

/** Conservative automatic segmentation; uncertainty stays visible for teacher correction. */
export function detectWrittenExamPaperCrops(
  pages: WrittenExamPaperTextPage[],
  questions: Pick<WrittenExamQuestionInfo, "number" | "answer">[],
): { crops: WrittenExamPaperCrop[]; warnings: string[] } {
  const expected = new Set(questions.map((question) => question.number));
  const candidates: Array<{
    number: number;
    page: WrittenExamPaperTextPage;
    rect: WrittenExamPaperRect;
    column: number;
    split: boolean;
  }> = [];
  for (const page of pages) {
    const anchors = page.items.flatMap((item) => {
      const match = /^\s*(\d{1,3})\s*[.．)](?:\s|[^\d]|$)/.exec(item.text);
      return match &&
        expected.has(Number(match[1])) &&
        item.rect.y > 0.025 &&
        item.rect.y < 0.95
        ? [{ number: Number(match[1]), rect: item.rect }]
        : [];
    });
    const left = anchors.filter((a) => a.rect.x < 0.45),
      rightSide = anchors.filter((a) => a.rect.x >= 0.45);
    const split =
      left.length > 0 &&
      rightSide.length > 0 &&
      Math.min(...rightSide.map((a) => a.rect.x)) -
        Math.min(...left.map((a) => a.rect.x)) >
        0.3;
    const rails = split
      ? [
          Math.min(...left.map((a) => a.rect.x)),
          Math.min(...rightSide.map((a) => a.rect.x)),
        ]
      : [Math.min(...anchors.map((a) => a.rect.x))];
    for (const anchor of anchors) {
      const column = split && anchor.rect.x >= 0.45 ? 1 : 0;
      if (Math.abs(anchor.rect.x - rails[column]) > 0.035) continue;
      candidates.push({ ...anchor, page, column, split });
    }
  }
  const warnings: string[] = [];
  if (pages.some((page) => !page.items.some((item) => item.text.trim())))
    warnings.push(
      "글자 정보가 없는 PDF 페이지가 있습니다. 해당 페이지는 문항 영역과 정답 표시를 직접 지정해 주세요.",
    );
  const crops = questions.map((question): WrittenExamPaperCrop => {
    const matches = candidates.filter(
      (candidate) => candidate.number === question.number,
    );
    if (matches.length !== 1)
      return {
        questionNumber: question.number,
        page: matches[0]?.page.page || pages[0]?.page || 1,
        rect: { x: 0.03, y: 0.03, width: 0.94, height: 0.94 },
        highlights: [],
        status: "review",
        warnings: [
          matches.length
            ? "같은 문항번호가 여러 곳에 있습니다. 문항 영역을 지정해 주세요."
            : "문항번호를 찾지 못했습니다. 문항 영역을 지정해 주세요.",
        ],
      };
    const anchor = matches[0];
    const sameColumn = candidates
      .filter(
        (candidate) =>
          candidate.page.page === anchor.page.page &&
          candidate.column === anchor.column,
      )
      .sort((a, b) => a.rect.y - b.rect.y);
    const next = sameColumn.find(
      (candidate) => candidate.rect.y > anchor.rect.y + 0.005,
    );
    const x = Math.max(0.015, anchor.rect.x - 0.008);
    const edge = anchor.split && anchor.column === 0 ? 0.49 : 0.98;
    const top = Math.max(0, anchor.rect.y - 0.006);
    const sectionBoundary = anchor.page.items
      .filter(
        (item) =>
          item.rect.y > anchor.rect.y + 0.01 &&
          item.rect.x >= x - 0.004 &&
          item.rect.x < edge &&
          /^\s*[[【(（]?\s*(?:서술형|논술형|서답형|주관식)(?:\s|\d|[\]】)）.:：]|$)/.test(
            item.text,
          ),
      )
      .sort((a, b) => a.rect.y - b.rect.y)[0];
    const end = Math.min(
      next ? next.rect.y - 0.007 : 0.96,
      sectionBoundary ? sectionBoundary.rect.y - 0.007 : 0.96,
    );
    const rect = {
      x,
      y: top,
      width: edge - x,
      height: Math.max(0.01, end - top),
    };
    const items = anchor.page.items.filter(
      (item) =>
        intersects(item.rect, rect) &&
        item.rect.x >= x - 0.004 &&
        item.rect.x < edge,
    );
    const segments = optionSegments(items);
    const markers = segments.filter((segment) => segment.option);
    const issues: string[] = [];
    if (
      new Set(markers.map((marker) => marker.option)).size !== 5 ||
      markers.length !== 5
    )
      issues.push(
        "선지 ①~⑤의 경계를 모두 확인하지 못했습니다. 크롭 범위를 확인해 주세요.",
      );
    if (markers.some((marker) => marker.approximate))
      issues.push(
        "한 글자 묶음에 여러 선지가 있어 정답 표시 위치를 직접 확인해 주세요.",
      );
    const highlights: WrittenExamPaperRect[] = [];
    for (const answer of question.answer) {
      const markerIndex = segments.findIndex(
        (segment) => segment.option === answer,
      );
      if (markerIndex < 0) {
        issues.push(`정답 ${answer}번의 표시 영역을 찾지 못했습니다.`);
        continue;
      }
      const marker = segments[markerIndex];
      if (marker.approximate) continue;
      const nextMarkerIndex = segments.findIndex(
        (segment, index) => index > markerIndex && Boolean(segment.option),
      );
      const optionItems = segments.slice(
        markerIndex,
        nextMarkerIndex < 0 ? undefined : nextMarkerIndex,
      );
      for (const line of groupLines(optionItems)) {
        const lineX = Math.min(...line.map((item) => item.rect.x));
        const lineY = Math.min(...line.map((item) => item.rect.y));
        const lineRight = Math.min(
          edge,
          Math.max(...line.map((item) => right(item.rect))),
        );
        const lineBottom = Math.min(
          end,
          Math.max(...line.map((item) => bottom(item.rect))),
        );
        // Exclude a possible following page footer after the final option.
        if (lineY - marker.rect.y > 0.07 && nextMarkerIndex < 0) {
          issues.push("마지막 선지의 끝부분을 확인해 주세요.");
          break;
        }
        highlights.push(
          normalizeWrittenExamPaperRect({
            x: lineX,
            y: lineY,
            width: lineRight - lineX,
            height: lineBottom - lineY,
          }),
        );
      }
    }
    const finalContent = items.filter((item) => item.rect.y < 0.94);
    if (!next && finalContent.length)
      rect.height = Math.min(
        rect.height,
        Math.max(...finalContent.map((item) => bottom(item.rect))) +
          0.008 -
          top,
      );
    return {
      questionNumber: question.number,
      page: anchor.page.page,
      rect,
      highlights,
      status: issues.length ? "review" : "ready",
      warnings: [...new Set(issues)],
    };
  });
  return { crops, warnings };
}

const toBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("문항 이미지를 만들지 못했습니다.")),
      "image/webp",
      0.94,
    ),
  );

export async function processWrittenExamPaper(
  file: File,
  questions: Pick<WrittenExamQuestionInfo, "number" | "answer">[],
  options: {
    onProgress?: (page: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<{
  pages: WrittenExamPaperPage[];
  crops: WrittenExamPaperCrop[];
  warnings: string[];
}> {
  if (!questions.length) throw new Error("문항정보표를 먼저 등록해 주세요.");
  if (file.size > 40 * 1024 * 1024)
    throw new Error("PDF는 40MB 이하로 올려 주세요.");
  const { pdfjs } = await import("react-pdf");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
  }).promise;
  const pages: WrittenExamPaperPage[] = [],
    textPages: WrittenExamPaperTextPage[] = [];
  try {
    if (pdf.numPages > 60)
      throw new Error("원안지는 60페이지 이하로 올려 주세요.");
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      options.signal?.throwIfAborted();
      const page = await pdf.getPage(pageNumber);
      const canvas = document.createElement("canvas");
      try {
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(
          3,
          2600 / Math.max(base.width, base.height),
          Math.sqrt(5_000_000 / (base.width * base.height)),
        );
        const viewport = page.getViewport({ scale });
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("PDF 이미지 처리 환경을 확인해 주세요.");
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        options.signal?.throwIfAborted();
        const content = await page.getTextContent();
        const items: WrittenExamPaperText[] = content.items.flatMap((item) => {
          if (!("str" in item) || !item.str.trim()) return [];
          const transform = pdfjs.Util.transform(
            base.transform,
            item.transform,
          );
          const height = Math.hypot(transform[2], transform[3]);
          return [
            {
              text: item.str,
              rect: {
                x: clamp(transform[4] / base.width),
                y: clamp((transform[5] - height) / base.height),
                width: clamp(item.width / base.width),
                height: clamp(height / base.height),
              },
            },
          ];
        });
        pages.push({
          page: pageNumber,
          width: canvas.width,
          height: canvas.height,
          blob: await toBlob(canvas),
        });
        textPages.push({
          page: pageNumber,
          width: base.width,
          height: base.height,
          items,
        });
        options.onProgress?.(pageNumber, pdf.numPages);
      } finally {
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    }
  } finally {
    await pdf.destroy();
  }
  const detected = detectWrittenExamPaperCrops(textPages, questions);
  // Preserve drawings without text, but trim the blank gap before the next item.
  // Only one page raster is decoded at a time within the existing pixel budget.
  for (const page of pages) {
    const pageCrops = detected.crops.filter(
      (crop) => crop.page === page.page && crop.status === "ready",
    );
    if (!pageCrops.length) continue;
    options.signal?.throwIfAborted();
    const bitmap = await createImageBitmap(page.blob);
    const canvas = document.createElement("canvas");
    try {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) continue;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      for (const crop of pageCrops) {
        const left = Math.max(0, Math.floor(crop.rect.x * canvas.width));
        const rightEdge = Math.min(
          canvas.width,
          Math.ceil(right(crop.rect) * canvas.width),
        );
        const firstRow = Math.max(0, Math.floor(crop.rect.y * canvas.height));
        const lastRow = Math.min(
          canvas.height - 1,
          Math.floor(bottom(crop.rect) * canvas.height),
        );
        for (let y = lastRow; y >= firstRow; y--) {
          let darkPixels = 0;
          for (let x = left; x < rightEdge; x++) {
            const offset = (y * canvas.width + x) * 4;
            if (
              pixels[offset + 3] > 10 &&
              Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]) <
                220
            )
              darkPixels++;
            if (darkPixels >= 3) break;
          }
          if (darkPixels >= 3) {
            crop.rect.height = Math.min(
              crop.rect.height,
              (y + 8) / canvas.height - crop.rect.y,
            );
            break;
          }
        }
      }
    } finally {
      bitmap.close();
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  return { pages, ...detected };
}

/** Rasterize only the selected question. Highlights are translucent rectangles, never check marks. */
export async function renderWrittenExamCrop(
  pageBlob: Blob,
  crop: WrittenExamPaperCrop,
  options: { highlight?: boolean } = {},
): Promise<Blob> {
  const rect = normalizeWrittenExamPaperRect(crop.rect);
  if (!rect.width || !rect.height)
    throw new Error("문항 영역이 페이지 밖에 있습니다.");
  const bitmap = await createImageBitmap(pageBlob);
  const canvas = document.createElement("canvas");
  try {
    const sx = rect.x * bitmap.width,
      sy = rect.y * bitmap.height;
    canvas.width = Math.max(1, Math.round(rect.width * bitmap.width));
    canvas.height = Math.max(1, Math.round(rect.height * bitmap.height));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("문항 이미지를 표시할 수 없습니다.");
    context.drawImage(
      bitmap,
      sx,
      sy,
      rect.width * bitmap.width,
      rect.height * bitmap.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    if (options.highlight !== false) {
      context.fillStyle = "rgba(255, 224, 64, 0.35)";
      for (const highlight of crop.highlights) {
        const safe = normalizeWrittenExamPaperRect(highlight);
        context.fillRect(
          (safe.x - rect.x) * bitmap.width,
          (safe.y - rect.y) * bitmap.height,
          safe.width * bitmap.width,
          safe.height * bitmap.height,
        );
      }
    }
    return await toBlob(canvas);
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
