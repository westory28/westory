import type {
  LessonWorksheetPageImage,
  LessonWorksheetTextRegion,
} from "./lessonWorksheet";
import type {
  LessonPdfGlyph,
  LessonPdfGlyphInkRow,
} from "./lessonPdfGlyphTypes";
import { createLessonInkClip } from "./lessonInkClip";

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
) => {
  const x = point.x * page.width,
    y = point.y * page.height;
  let closest: LessonPdfGlyph | undefined;
  let nearest = Infinity;
  for (const r of regions) {
    const bounds = ink(r);
    if (
      r.page === page.page &&
      r.selectable !== false &&
      x >= bounds.left &&
      x <= bounds.left + bounds.width &&
      y >= bounds.top &&
      y <= bounds.top + bounds.height
    ) {
      const distance =
        (x - bounds.left - bounds.width / 2) ** 2 +
        (y - bounds.top - bounds.height / 2) ** 2;
      if (distance < nearest) {
        closest = r;
        nearest = distance;
      }
    }
  }
  return closest;
};

export interface LessonTextRect {
  leftRatio: number;
  topRatio: number;
  widthRatio: number;
  heightRatio: number;
  /** A normally rectangular blank can preserve a neighbouring curved stroke. */
  inkClip?: Array<{ x: number; y: number }>;
}

export interface LessonTextSelection {
  regions: LessonPdfGlyph[];
  rect: LessonTextRect;
  answer: string;
}

export type LessonTextSelectionResult = LessonTextSelection | { error: string };

interface TextLine {
  glyphs: LessonPdfGlyph[];
  height: number;
  top: number;
  bottom: number;
  /** Crossing a glyph's centre advances one caret index, independently of ink masks. */
  caretBoundaries: number[];
  spaces: boolean[];
  breaks: boolean[];
  runs: number[];
}

interface PageTextIndex {
  lines: TextLine[];
  locations: Map<LessonPdfGlyph, { line: TextLine; index: number }>;
}

// The reader publishes a new array after all geometry refinements finish.
// Pointer frames share this index; no paint/contour work belongs in selection.
const pageIndexes = new WeakMap<LessonPdfGlyph[], Map<string, PageTextIndex>>();
const getPageTextIndex = (
  regions: LessonPdfGlyph[],
  page: LessonWorksheetPageImage,
): PageTextIndex => {
  const key = `${page.page}:${page.width}:${page.height}`;
  const cached = pageIndexes.get(regions)?.get(key);
  if (cached) return cached;
  const verticalPosition = (glyph: LessonPdfGlyph) =>
    glyph.baseline ?? glyph.top + glyph.height / 2;
  const center = (glyph: LessonPdfGlyph) => {
    const bounds = ink(glyph);
    return bounds.left + bounds.width / 2;
  };
  const ordered = regions
    .filter((glyph) => glyph.page === page.page && glyph.selectable !== false)
    .sort(
      (a, b) =>
        verticalPosition(a) - verticalPosition(b) || center(a) - center(b),
    );
  const rows: LessonPdfGlyph[][] = [];
  for (const glyph of ordered) {
    const row = rows.find((items) => sameLine(items[0], glyph));
    if (row) row.push(glyph);
    else rows.push([glyph]);
  }
  const locations: PageTextIndex["locations"] = new Map();
  const lines = rows.map((glyphs): TextLine => {
    glyphs.sort((a, b) => center(a) - center(b) || a.left - b.left);
    const heights = glyphs.map((glyph) => glyph.height).sort((a, b) => a - b);
    const tallest = heights[heights.length - 1];
    const median = heights[Math.floor(heights.length / 2)];
    const height = median < tallest * 0.5 ? tallest : median;
    const gaps = glyphs.map((glyph, index) =>
      index ? glyph.left - glyphs[index - 1].left - glyphs[index - 1].width : 0,
    );
    let run = 0;
    const line: TextLine = {
      glyphs,
      height,
      top: Math.min(...glyphs.map((glyph) => glyph.top)),
      bottom: Math.max(...glyphs.map((glyph) => glyph.top + glyph.height)),
      caretBoundaries: glyphs.map(center),
      spaces: gaps.map((gap) => gap > height * 0.35),
      breaks: gaps.map((gap) => gap > height * 1.5),
      runs: gaps.map((gap) => (gap > height * 1.5 ? ++run : run)),
    };
    glyphs.forEach((glyph, index) => locations.set(glyph, { line, index }));
    return line;
  });
  const result = { lines, locations };
  const pages = pageIndexes.get(regions) ?? new Map<string, PageTextIndex>();
  pages.set(key, result);
  pageIndexes.set(regions, pages);
  return result;
};

const caretAt = (line: TextLine, x: number) => {
  let left = 0,
    right = line.caretBoundaries.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (line.caretBoundaries[middle] < x) left = middle + 1;
    else right = middle;
  }
  return left;
};

const selectLineSlice = (
  line: TextLine,
  from: number,
  to: number,
  page: LessonWorksheetPageImage,
): LessonTextSelectionResult => {
  if (from >= to) return noText();
  if (line.breaks.slice(from + 1, to).some(Boolean))
    return { error: "떨어진 글자는 각각 선택해 주세요." };
  const hits = line.glyphs.slice(from, to);
  const answer = hits
    .map(
      (glyph, index) =>
        `${index && line.spaces[from + index] ? " " : ""}${glyph.label}`,
    )
    .join("");
  return { regions: hits, rect: getLessonTextBounds(hits, page), answer };
};

const selectHits = (
  hits: LessonPdfGlyph[],
  index: PageTextIndex,
  page: LessonWorksheetPageImage,
): LessonTextSelectionResult => {
  if (!hits.length) return noText();
  const first = index.locations.get(hits[0])!;
  if (hits.some((glyph) => index.locations.get(glyph)?.line !== first.line))
    return { error: "한 줄의 이어진 글자만 선택해 주세요." };
  const positions = hits.map((glyph) => index.locations.get(glyph)!.index);
  return selectLineSlice(
    first.line,
    Math.min(...positions),
    Math.max(...positions) + 1,
    page,
  );
};

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
): LessonTextSelectionResult => {
  const left = rect.leftRatio * page.width;
  const top = rect.topRatio * page.height;
  const right = left + rect.widthRatio * page.width;
  const bottom = top + rect.heightRatio * page.height;
  // A horizontal text-selection gesture remains a line, not a distant point hit.
  const point = right - left < 1 && bottom - top < 1;
  const index = getPageTextIndex(regions, page);
  if (point) {
    const hit = findLessonTextAtPoint(regions, page, {
      x: rect.leftRatio,
      y: rect.topRatio,
    });
    return selectHits(hit ? [hit] : [], index, page);
  }
  const hits = regions.filter((r) => {
    if (r.page !== page.page || r.selectable === false) return false;
    const bounds = ink(r);
    const cx = bounds.left + bounds.width / 2;
    const cy = r.top + r.height / 2;
    const vertical =
      bottom - top < 1
        ? top >= r.top && top <= r.top + r.height
        : cy >= top && cy <= bottom;
    return cx >= left && cx <= right && vertical;
  });
  return selectHits(hits, index, page);
};

/** Follow the anchor line like text selection; a slight vertical wobble is harmless. */
export const selectLessonTextDrag = (
  regions: LessonPdfGlyph[],
  page: LessonWorksheetPageImage,
  start: LessonTextPoint,
  end: LessonTextPoint,
): LessonTextSelectionResult => {
  const sx = start.x * page.width,
    sy = start.y * page.height;
  const ex = end.x * page.width,
    ey = end.y * page.height;
  const index = getPageTextIndex(regions, page);
  if (Math.abs(ex - sx) < 1 && Math.abs(ey - sy) < 1) {
    const hit = findLessonTextAtPoint(regions, page, start);
    return selectHits(hit ? [hit] : [], index, page);
  }
  const distance = (r: LessonPdfGlyph) =>
    Math.max(r.left - sx, sx - r.left - r.width, 0);
  const anchor = [...index.locations.keys()]
    .filter(
      (r) =>
        sy >= r.top &&
        sy <= r.top + r.height &&
        distance(r) <= index.locations.get(r)!.line.height * 0.5,
    )
    .sort((a, b) => distance(a) - distance(b))[0];
  if (!anchor) return noText();
  const line = index.locations.get(anchor)!.line;
  // Endpoints on another line must not silently create a partial blank.
  if (
    ey < line.top - line.height * 0.5 ||
    ey > line.bottom + line.height * 0.5 ||
    [...index.locations.keys()].some(
      (r) =>
        index.locations.get(r)!.line !== line &&
        ex >= r.left &&
        ex <= r.left + r.width &&
        ey >= r.top &&
        ey <= r.top + r.height,
    )
  ) {
    return { error: "한 줄의 이어진 글자만 선택해 주세요." };
  }
  // At an exact centre, caret affinity can leave the endpoint glyph outside
  // the slice. Landing in a different cell must still reject the cross-cell drag.
  const endHit = findLessonTextAtPoint(regions, page, end);
  const endLocation = endHit ? index.locations.get(endHit) : undefined;
  if (
    endLocation?.line === line &&
    line.runs[endLocation.index] !==
      line.runs[index.locations.get(anchor)!.index]
  )
    return { error: "떨어진 글자는 각각 선택해 주세요." };
  const startCaret = caretAt(line, sx),
    endCaret = caretAt(line, ex);
  return selectLineSlice(
    line,
    Math.min(startCaret, endCaret),
    Math.max(startCaret, endCaret),
    page,
  );
};

/** Build a safe mask for the exact chosen characters; never change the selection. */
export const createLessonTextBlank = (
  selection: LessonTextSelection,
  regions: LessonPdfGlyph[],
  page: LessonWorksheetPageImage,
): LessonTextSelectionResult => {
  const { regions: hits, answer } = selection;
  if (!hits.length) return noText();
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
  const cuts: Array<{
    top: number;
    bottom: number;
    edge: number;
    side: "left" | "right";
  }> = [];
  const collision = () => ({
    error:
      "글자는 선택됐지만, 이웃 글자를 가리지 않고 빈칸을 만들 수 없습니다.",
  });
  const selectedRows: LessonPdfGlyphInkRow[] = hits.flatMap(
    (r) =>
      r.inkRows || [
        {
          ...ink(r),
          right: ink(r).left + ink(r).width,
          bottom: ink(r).top + ink(r).height,
        },
      ],
  );
  const firstCenter = ink(hits[0]).left + ink(hits[0]).width / 2;
  const lastCenter =
    ink(hits[hits.length - 1]).left + ink(hits[hits.length - 1]).width / 2;
  const neighbours = regions.filter((r) => {
    const bounds = ink(r);
    return (
      r.page === page.page &&
      !selected.has(r) &&
      bounds.left < br &&
      bounds.left + bounds.width > bx &&
      bounds.top < bb &&
      bounds.top + bounds.height > by
    );
  });
  // Shared source pixels belong to both letters. Preserve the neighbour there,
  // but prove that no independent selected stroke is exposed by an edge notch.
  // Outer row envelopes cannot prove this: their interior can contain holes.
  const isSharedInk = (
    left: number,
    right: number,
    top: number,
    bottom: number,
  ) => {
    const rows = neighbours.flatMap((r) =>
      (r.inkRows || []).filter(
        (row) => row.spans?.length && row.top < bottom && row.bottom > top,
      ),
    );
    const ys = [
      ...new Set([
        top,
        bottom,
        ...rows.flatMap((row) => [
          Math.max(top, row.top),
          Math.min(bottom, row.bottom),
        ]),
      ]),
    ].sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) {
      const y = (ys[i - 1] + ys[i]) / 2;
      const spans = rows
        .filter((row) => row.top < y && row.bottom > y)
        .flatMap((row) => row.spans || [])
        .sort((a, b) => a.left - b.left);
      let covered = left;
      for (const span of spans) {
        if (span.left > covered + 1e-7) break;
        covered = Math.max(covered, span.right);
        if (covered >= right - 1e-7) break;
      }
      if (covered < right - 1e-7) return false;
    }
    return true;
  };
  for (const r of neighbours) {
    const coarse = ink(r);
    if (
      coarse.left >= br ||
      coarse.left + coarse.width <= bx ||
      coarse.top >= bb ||
      coarse.top + coarse.height <= by
    )
      continue;
    const occupied = r.inkRows?.length
      ? r.inkRows
      : [
          {
            ...ink(r),
            right: ink(r).left + ink(r).width,
            bottom: ink(r).top + ink(r).height,
          },
        ];
    for (const other of occupied) {
      const { right, bottom } = other;
      const epsilon = r.inkRows ? 1e-7 : r.inkBounds ? 0.01 : 0.5;
      if (
        Math.min(br, right) - Math.max(bx, other.left) <= epsilon ||
        Math.min(bb, bottom) - Math.max(by, other.top) <= epsilon
      )
        continue;
      if (right <= coreLeft + epsilon) bx = Math.max(bx, right);
      else if (other.left >= coreRight - epsilon) br = Math.min(br, other.left);
      else if (bottom <= coreTop + epsilon) by = Math.max(by, bottom);
      else if (other.top >= coreBottom - epsilon) bb = Math.min(bb, other.top);
      else {
        // Preserve neighbouring curves with an edge notch. Shared edge pixels
        // are checked against exact occupied spans below, never a tolerance.
        if (
          !r.inkRows?.length ||
          hits.some((hit) => !hit.inkRows?.length) ||
          !sameLine(hits[0], r)
        )
          return collision();
        const center = coarse.left + coarse.width / 2;
        const side =
          center < firstCenter ? "left" : center > lastCenter ? "right" : null;
        if (!side) return collision();
        const crossing = selectedRows.filter(
          (row) =>
            Math.min(row.bottom, bottom) - Math.max(row.top, other.top) >
            epsilon,
        );
        if (side === "left") {
          const selectedLeft = crossing.length
            ? Math.min(...crossing.map((row) => row.left))
            : br;
          if (right >= firstCenter) return collision();
          cuts.push({
            top: other.top,
            bottom,
            side,
            edge:
              right + Math.min(0.05, Math.max(0, (selectedLeft - right) / 2)),
          });
        } else {
          const selectedRight = crossing.length
            ? Math.max(...crossing.map((row) => row.right))
            : bx;
          if (other.left <= lastCenter) return collision();
          cuts.push({
            top: other.top,
            bottom,
            side,
            edge:
              other.left -
              Math.min(0.05, Math.max(0, (other.left - selectedRight) / 2)),
          });
        }
      }
    }
  }
  let inkClip: LessonTextRect["inkClip"];
  if (cuts.length) {
    const ys = [
      ...new Set([
        by,
        bb,
        ...cuts.flatMap((cut) => [
          Math.max(by, cut.top),
          Math.min(bb, cut.bottom),
        ]),
      ]),
    ]
      .filter((y) => y >= by && y <= bb)
      .sort((a, b) => a - b);
    const bands: Array<{
      top: number;
      bottom: number;
      left: number;
      right: number;
    }> = [];
    for (let i = 1; i < ys.length; i++) {
      const top = ys[i - 1],
        bottom = ys[i],
        middle = (top + bottom) / 2;
      let left = bx,
        right = br;
      for (const cut of cuts)
        if (cut.top < middle && cut.bottom > middle) {
          if (cut.side === "left") left = Math.max(left, cut.edge);
          else right = Math.min(right, cut.edge);
        }
      if (right <= left) return collision();
      const previous = bands[bands.length - 1];
      if (previous && previous.left === left && previous.right === right)
        previous.bottom = bottom;
      else bands.push({ top, bottom, left, right });
    }
    let coverageBands = bands.map(({ top, bottom, left, right }) => ({
      top,
      bottom,
      spans: [{ left, right }],
    }));
    const coversIndependentInk = (candidate: typeof coverageBands) =>
      selectedRows.every((row) =>
        candidate.every((band) => {
          const top = Math.max(row.top, band.top),
            bottom = Math.min(row.bottom, band.bottom);
          if (bottom - top <= 1e-7) return true;
          const shared = (from: number, to: number) =>
            to - from <= 1e-7 ||
            (!!row.spans?.length && isSharedInk(from, to, top, bottom));
          return (row.spans || [row]).every((span) => {
            let cursor = span.left;
            for (const mask of band.spans) {
              if (mask.right <= cursor || mask.left >= span.right) continue;
              if (!shared(cursor, Math.min(mask.left, span.right)))
                return false;
              cursor = Math.max(cursor, Math.min(mask.right, span.right));
            }
            return shared(cursor, span.right);
          });
        }),
      );
    if (!coversIndependentInk(coverageBands)) {
      // Interlocking letters (e.g. 추 beside 관) can put a selected stroke inside
      // a neighbour's hollow. A one-span edge notch cannot cover that stroke.
      // Subtract exact occupied runs and keep the resulting holes and islands.
      const complex = createLessonInkClip(
        { left: bx, top: by, right: br, bottom: bb },
        neighbours.flatMap(
          (r) =>
            r.inkRows || [
              {
                ...ink(r),
                right: ink(r).left + ink(r).width,
                bottom: ink(r).top + ink(r).height,
              },
            ],
        ),
      );
      if (!complex || !coversIndependentInk(complex.bands)) return collision();
      coverageBands = complex.bands;
      inkClip = complex.polygon;
    }
    // A blank must hide some independent paint from every selected glyph.
    // Two neighbours can otherwise leave a hollow centre mask while exposing
    // all strokes of a fully shared glyph on either side.
    if (
      hits.some(
        (hit) =>
          !hit.inkRows?.some((row) =>
            coverageBands.some(
              (band) =>
                Math.min(row.bottom, band.bottom) -
                  Math.max(row.top, band.top) >
                  1e-7 &&
                (row.spans || [row]).some((span) =>
                  band.spans.some(
                    (mask) =>
                      Math.min(span.right, mask.right) -
                        Math.max(span.left, mask.left) >
                      1e-7,
                  ),
                ),
            ),
          ),
      )
    )
      return collision();
    if (!inkClip) {
      const points = [
        ...bands.flatMap((band) => [
          { x: band.left, y: band.top },
          { x: band.left, y: band.bottom },
        ]),
        ...bands
          .slice()
          .reverse()
          .flatMap((band) => [
            { x: band.right, y: band.bottom },
            { x: band.right, y: band.top },
          ]),
      ];
      const reduced = points.filter((point, i) => {
        const before = points[(i + points.length - 1) % points.length],
          after = points[(i + 1) % points.length];
        return (
          !(point.x === before.x && point.x === after.x) &&
          !(point.y === before.y && point.y === after.y)
        );
      });
      if (reduced.length > 2048) return collision();
      inkClip = reduced.map((point) => ({
        x: (point.x - bx) / (br - bx),
        y: (point.y - by) / (bb - by),
      }));
    }
  }
  return {
    regions: hits,
    rect: {
      leftRatio: bx / page.width,
      topRatio: by / page.height,
      widthRatio: (br - bx) / page.width,
      heightRatio: (bb - by) / page.height,
      ...(inkClip ? { inkClip } : {}),
    },
    answer,
  };
};
