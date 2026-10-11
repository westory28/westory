import type {
  LessonWorksheetPageImage,
  LessonWorksheetTextRegion,
} from "./lessonWorksheet";

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
  regions: LessonWorksheetTextRegion[],
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
  if (!hits.length)
    return {
      error:
        "선택한 곳에서 글자를 찾지 못했습니다. 글자 가운데를 드래그하거나 직접 도구를 사용해 주세요.",
    };
  const heights = hits.map((r) => r.height).sort((a, b) => a - b);
  const height = heights[Math.floor(heights.length / 2)];
  const center = hits[0].top + hits[0].height / 2;
  if (
    hits.some(
      (r) =>
        Math.abs(r.top + r.height / 2 - center) >
        Math.max(height, r.height) * 0.55,
    )
  ) {
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
  // Never include an unselected glyph inside the resulting rectangle.
  const selected = new Set(hits);
  const bx = bounds.leftRatio * page.width,
    by = bounds.topRatio * page.height;
  const br = bx + bounds.widthRatio * page.width,
    bb = by + bounds.heightRatio * page.height;
  if (
    regions.some(
      (r) =>
        r.page === page.page &&
        !selected.has(r) &&
        Math.min(br, r.left + r.width) - Math.max(bx, r.left) > 0.5 &&
        Math.min(bb, r.top + r.height) - Math.max(by, r.top) > 0.5,
    )
  ) {
    return {
      error:
        "주변 글자와 겹칩니다. 선택 범위를 줄이거나 직접 도구를 사용해 주세요.",
    };
  }
  return { regions: hits, rect: bounds, answer };
};
