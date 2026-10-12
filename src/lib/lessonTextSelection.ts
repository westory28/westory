import type {
  LessonWorksheetPageImage,
  LessonWorksheetTextRegion,
} from "./lessonWorksheet";
import type { LessonPdfGlyph } from "./lessonPdfGlyphTypes";

export interface LessonTextPoint {
  x: number;
  y: number;
}

const ink = (glyph: LessonPdfGlyph) => glyph.inkBounds || glyph;
const noText = () => ({
  error:
    "선택한 곳에서 글자를 찾지 못했습니다. 글자 가운데를 드래그하거나 직접 도구를 사용해 주세요.",
});
const sameLine = (a: LessonPdfGlyph, b: LessonPdfGlyph) =>
  a.baseline !== undefined && b.baseline !== undefined
    ? Math.abs(a.baseline - b.baseline) <= Math.max(a.height, b.height) * 0.3
    : Math.abs(a.top + a.height / 2 - b.top - b.height / 2) <=
      Math.max(a.height, b.height) * 0.55;

/** Hit only recognized ink boxes, never a nearby word or the full page. */
export const findLessonTextAtPoint = (
  regions: LessonPdfGlyph[],
  page: LessonWorksheetPageImage,
  point: LessonTextPoint,
) =>
  regions.find((r) => {
    const bounds = ink(r);
    const x = point.x * page.width,
      y = point.y * page.height;
    return (
      r.page === page.page &&
      x >= bounds.left &&
      x <= bounds.left + bounds.width &&
      y >= bounds.top &&
      y <= bounds.top + bounds.height
    );
  });

export interface LessonTextRect {
  leftRatio: number;
  topRatio: number;
  widthRatio: number;
  heightRatio: number;
}

export const getLessonTextBounds = (
  regions: LessonWorksheetTextRegion[],
  page: LessonWorksheetPageImage,
): LessonTextRect => {
  const left = Math.max(0, Math.min(...regions.map((r) => r.left)));
  const top = Math.max(0, Math.min(...regions.map((r) => r.top)));
  const right = Math.min(
    page.width,
    Math.max(...regions.map((r) => r.left + r.width)),
  );
  const bottom = Math.min(
    page.height,
    Math.max(...regions.map((r) => r.top + r.height)),
  );
  return {
    leftRatio: left / page.width,
    topRatio: top / page.height,
    widthRatio: (right - left) / page.width,
    heightRatio: (bottom - top) / page.height,
  };
};

/** Select actual painted glyphs, never a guessed word or the user's loose drag box. */
export const selectLessonText = (
  regions: LessonPdfGlyph[],
  page: LessonWorksheetPageImage,
  rect: LessonTextRect,
):
  | {
      regions: LessonWorksheetTextRegion[];
      rect: LessonTextRect;
      answer: string;
    }
  | { error: string } => {
  const left = rect.leftRatio * page.width;
  const top = rect.topRatio * page.height;
  const right = left + rect.widthRatio * page.width;
  const bottom = top + rect.heightRatio * page.height;
  // A horizontal text-selection gesture remains a line, not a distant point hit.
  const point = right - left < 1 && bottom - top < 1;
  const hits = regions
    .filter((r) => {
      if (r.page !== page.page) return false;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (point)
        return (
          left >= r.left &&
          left <= r.left + r.width &&
          top >= r.top &&
          top <= r.top + r.height
        );
      const vertical =
        bottom - top < 1
          ? top >= r.top && top <= r.top + r.height
          : cy >= top && cy <= bottom;
      return cx >= left && cx <= right && vertical;
    })
    .sort((a, b) => a.left - b.left);
  return finishSelection(hits, regions, page);
};

/** Follow the anchor line like text selection; a slight vertical wobble is harmless. */
export const selectLessonTextDrag = (
  regions: LessonPdfGlyph[],
  page: LessonWorksheetPageImage,
  start: LessonTextPoint,
  end: LessonTextPoint,
) => {
  const sx = start.x * page.width,
    sy = start.y * page.height;
  const ex = end.x * page.width,
    ey = end.y * page.height;
  if (Math.abs(ex - sx) < 1 && Math.abs(ey - sy) < 1) {
    const hit = findLessonTextAtPoint(regions, page, start);
    return finishSelection(hit ? [hit] : [], regions, page);
  }
  const distance = (r: LessonPdfGlyph) =>
    Math.max(r.left - sx, sx - r.left - r.width, 0);
  const anchor = regions
    .filter(
      (r) =>
        r.page === page.page &&
        sy >= r.top &&
        sy <= r.top + r.height &&
        distance(r) <= r.height * 0.5,
    )
    .sort((a, b) => distance(a) - distance(b))[0];
  if (!anchor) return noText();
  const row = regions.filter(
    (r) => r.page === page.page && sameLine(anchor, r),
  );
  // Endpoints on another line must not silently create a partial blank.
  if (
    ey < anchor.top - anchor.height * 0.5 ||
    ey > anchor.top + anchor.height * 1.5 ||
    regions.some(
      (r) =>
        r.page === page.page &&
        !sameLine(anchor, r) &&
        ex >= r.left &&
        ex <= r.left + r.width &&
        ey >= r.top &&
        ey <= r.top + r.height,
    )
  ) {
    return { error: "한 줄의 이어진 글자만 선택해 주세요." };
  }
  return finishSelection(
    row
      .filter((r) => {
        const bounds = ink(r);
        const center = bounds.left + bounds.width / 2;
        return center >= Math.min(sx, ex) && center <= Math.max(sx, ex);
      })
      .sort((a, b) => a.left - b.left),
    regions,
    page,
  );
};

const finishSelection = (
  hits: LessonPdfGlyph[],
  regions: LessonPdfGlyph[],
  page: LessonWorksheetPageImage,
) => {
  if (!hits.length) return noText();
  const heights = hits.map((r) => r.height).sort((a, b) => a - b);
  const height = heights[Math.floor(heights.length / 2)];
  if (hits.some((r) => !sameLine(hits[0], r))) {
    return { error: "한 줄의 이어진 글자만 선택해 주세요." };
  }
  let answer = "";
  for (let i = 0; i < hits.length; i++) {
    const r = hits[i],
      previous = hits[i - 1];
    const gap = previous ? r.left - previous.left - previous.width : 0;
    if (gap > height * 1.5)
      return { error: "떨어진 글자는 각각 선택해 주세요." };
    if (previous && gap > height * 0.35) answer += " ";
    answer += r.label;
  }
  const bounds = getLessonTextBounds(hits, page);
  const core = getLessonTextBounds(
    hits.map((r) => ({ ...r, ...ink(r) })),
    page,
  );
  const coreLeft = core.leftRatio * page.width,
    coreTop = core.topRatio * page.height;
  const coreRight = coreLeft + core.widthRatio * page.width;
  const coreBottom = coreTop + core.heightRatio * page.height;
  // Keep actual selected ink; trim only antialias padding against neighbouring ink.
  const selected = new Set(hits);
  let bx = bounds.leftRatio * page.width,
    by = bounds.topRatio * page.height;
  let br = bx + bounds.widthRatio * page.width,
    bb = by + bounds.heightRatio * page.height;
  for (const r of regions) {
    if (r.page !== page.page || selected.has(r)) continue;
    const other = ink(r),
      right = other.left + other.width,
      bottom = other.top + other.height;
    const epsilon = r.inkBounds ? 0.01 : 0.5;
    if (
      Math.min(br, right) - Math.max(bx, other.left) <= epsilon ||
      Math.min(bb, bottom) - Math.max(by, other.top) <= epsilon
    )
      continue;
    if (right <= coreLeft + epsilon) bx = Math.max(bx, right);
    else if (other.left >= coreRight - epsilon) br = Math.min(br, other.left);
    else if (bottom <= coreTop + epsilon) by = Math.max(by, bottom);
    else if (other.top >= coreBottom - epsilon) bb = Math.min(bb, other.top);
    else
      return {
        error:
          "주변 글자와 겹칩니다. 선택 범위를 줄이거나 직접 도구를 사용해 주세요.",
      };
  }
  return {
    regions: hits,
    rect: {
      leftRatio: bx / page.width,
      topRatio: by / page.height,
      widthRatio: (br - bx) / page.width,
      heightRatio: (bb - by) / page.height,
    },
    answer,
  };
};
