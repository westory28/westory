import type { LessonWorksheetTextRegion } from "./lessonWorksheet";

/** Transient PDF paint geometry; never persisted with worksheet blank answers. */
export interface LessonPdfGlyph extends LessonWorksheetTextRegion {
  inkBounds?: { left: number; top: number; width: number; height: number };
  baseline?: number;
}

export interface LessonPdfGlyphPage {
  regions: LessonPdfGlyph[];
  /** White original glyphs on a transparent, page-sized bitmap. */
  maskUrl: string;
}
