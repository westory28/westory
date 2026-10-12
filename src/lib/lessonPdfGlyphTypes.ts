import type { LessonWorksheetTextRegion } from "./lessonWorksheet";

export interface LessonPdfGlyphInkRow {
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** 64x refinements retain every occupied run, excluding interior whitespace. */
  spans?: Array<{ left: number; right: number }>;
}

/** Transient PDF paint geometry; never persisted with worksheet blank answers. */
export interface LessonPdfGlyph extends LessonWorksheetTextRegion {
  /** Visible decoration or unsupported writing still protects neighbouring ink. */
  selectable?: false;
  inkBounds?: { left: number; top: number; width: number; height: number };
  /** Logical page coordinates. Overlapping rows from fill/stroke form a union. */
  inkRows?: LessonPdfGlyphInkRow[];
  baseline?: number;
}

export interface LessonPdfGlyphPage {
  regions: LessonPdfGlyph[];
  /** White original glyphs on a transparent, page-sized bitmap. */
  maskUrl: string;
}
