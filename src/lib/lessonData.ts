import {
  normalizeWorksheetBlanks,
  normalizeWorksheetPageImages,
  normalizeWorksheetTextRegions,
  type LessonWorksheetBlank,
  type LessonWorksheetPageImage,
  type LessonWorksheetTextRegion,
} from "./lessonWorksheet";
import {
  createEmptyLessonPdfProcessingMeta,
  normalizeLessonPdfProcessingMeta,
  type LessonPdfProcessingMeta,
} from "./lessonPdfExtraction";

export type LessonFootnotePlacement = "inline-bottom" | "reference-panel";
export const LESSON_FOOTNOTE_TOKEN_REGEX = /\[fn:([a-zA-Z0-9._-]+)\]/g;

export interface LessonFootnote {
  id: string;
  anchorKey: string;
  label?: string;
  title?: string;
  bodyHtml?: string;
  imageUrl?: string;
  imageStoragePath?: string;
  placement?: LessonFootnotePlacement;
  order: number;
}

export interface LessonData {
  unitId?: string;
  title: string;
  videoUrl?: string;
  contentHtml?: string;
  isVisibleToStudents?: boolean;
  pdfName?: string;
  pdfUrl?: string;
  pdfStoragePath?: string;
  worksheetPageImages?: LessonWorksheetPageImage[];
  worksheetTextRegions?: LessonWorksheetTextRegion[];
  worksheetBlanks?: LessonWorksheetBlank[];
  pdfProcessing?: LessonPdfProcessingMeta;
  footnotes?: LessonFootnote[];
  updatedAt?: unknown;
}

export interface NormalizedLessonData extends LessonData {
  title: string;
  videoUrl: string;
  contentHtml: string;
  isVisibleToStudents: boolean;
  pdfName: string;
  pdfUrl: string;
  pdfStoragePath: string;
  worksheetPageImages: LessonWorksheetPageImage[];
  worksheetTextRegions: LessonWorksheetTextRegion[];
  worksheetBlanks: LessonWorksheetBlank[];
  pdfProcessing: LessonPdfProcessingMeta;
  footnotes: LessonFootnote[];
}

export interface LessonContentSections {
  bodyHtml: string;
  footnotes: LessonFootnote[];
  worksheet: {
    pdfName: string;
    pdfUrl: string;
    pageImages: LessonWorksheetPageImage[];
    textRegions: LessonWorksheetTextRegion[];
    blanks: LessonWorksheetBlank[];
  };
}

export interface LessonFootnoteUsage {
  footnote: LessonFootnote;
  anchorKey: string;
  count: number;
  firstTokenIndex: number;
  token: string;
}

export const sanitizeLessonFootnoteAnchorKey = (value: unknown) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();

export const buildFootnoteToken = (anchorKey: string) =>
  `[fn:${sanitizeLessonFootnoteAnchorKey(anchorKey)}]`;

export const ensureUniqueAnchorKey = (
  candidate: string,
  takenAnchorKeys: Iterable<string>,
  fallback = "footnote",
) => {
  const taken = new Set(
    Array.from(takenAnchorKeys)
      .map((anchorKey) => sanitizeLessonFootnoteAnchorKey(anchorKey))
      .filter(Boolean),
  );
  const base = sanitizeLessonFootnoteAnchorKey(candidate) || fallback;
  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
};

export const createLessonFootnoteDraft = (
  partial: Partial<LessonFootnote> = {},
  existingFootnotes: LessonFootnote[] = [],
) => {
  const labelSeed = String(
    partial.label || partial.title || partial.anchorKey || "",
  );
  const anchorKey = ensureUniqueAnchorKey(
    labelSeed || "footnote",
    existingFootnotes.map((footnote) => footnote.anchorKey),
  );

  return {
    id: String(partial.id || "").trim() || `footnote-${Date.now()}`,
    anchorKey,
    label: String(partial.label || "").trim(),
    title: String(partial.title || "").trim(),
    bodyHtml: String(partial.bodyHtml || "").trim(),
    imageUrl: String(partial.imageUrl || "").trim(),
    imageStoragePath: String(partial.imageStoragePath || "").trim(),
    placement:
      partial.placement === "reference-panel"
        ? "reference-panel"
        : "inline-bottom",
    order:
      typeof partial.order === "number" && Number.isFinite(partial.order)
        ? partial.order
        : existingFootnotes.length,
  } satisfies LessonFootnote;
};

export const sanitizeLessonFootnote = (
  footnote: Partial<LessonFootnote>,
  existingFootnotes: LessonFootnote[] = [],
) => {
  const nextId =
    String(footnote.id || "").trim() ||
    `footnote-${Math.max(existingFootnotes.length + 1, 1)}`;
  const nextAnchorKey = ensureUniqueAnchorKey(
    String(footnote.anchorKey || footnote.label || footnote.title || ""),
    existingFootnotes
      .filter((item) => item.id !== nextId)
      .map((item) => item.anchorKey),
  );

  return {
    id: nextId,
    anchorKey: nextAnchorKey,
    label: String(footnote.label || "").trim(),
    title: String(footnote.title || "").trim(),
    bodyHtml: String(footnote.bodyHtml || "").trim(),
    imageUrl: String(footnote.imageUrl || "").trim(),
    imageStoragePath: String(footnote.imageStoragePath || "").trim(),
    placement:
      footnote.placement === "reference-panel"
        ? "reference-panel"
        : "inline-bottom",
    order:
      typeof footnote.order === "number" && Number.isFinite(footnote.order)
        ? footnote.order
        : existingFootnotes.length,
  } satisfies LessonFootnote;
};

export const sortLessonFootnotes = (footnotes: LessonFootnote[]) =>
  [...footnotes].sort((a, b) => {
    const orderDiff = a.order - b.order;
    if (orderDiff !== 0) return orderDiff;
    return a.anchorKey.localeCompare(b.anchorKey);
  });

const normalizeLessonFootnotes = (raw: unknown): LessonFootnote[] => {
  if (!Array.isArray(raw)) return [];
  const normalized: LessonFootnote[] = [];
  raw.forEach((item, index) => {
    const source =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const footnote = sanitizeLessonFootnote(
      {
        id: String(source.id || "").trim() || `footnote-${index + 1}`,
        anchorKey: source.anchorKey as string,
        label: source.label as string,
        title: source.title as string,
        bodyHtml: source.bodyHtml as string,
        imageUrl: source.imageUrl as string,
        imageStoragePath: source.imageStoragePath as string,
        placement: source.placement as LessonFootnotePlacement,
        order: Number(source.order) || index,
      },
      normalized,
    );
    if (footnote.anchorKey) {
      normalized.push(footnote);
    }
  });
  return sortLessonFootnotes(normalized);
};

export const extractFootnoteAnchorKeys = (contentHtml: string) => {
  const matches = Array.from(
    String(contentHtml || "").matchAll(LESSON_FOOTNOTE_TOKEN_REGEX),
  );

  return matches
    .map((match) => sanitizeLessonFootnoteAnchorKey(match[1]))
    .filter(Boolean);
};

export const replaceOrInsertFootnoteToken = (
  contentHtml: string,
  token: string,
  options: {
    selectionStart?: number | null;
    selectionEnd?: number | null;
    insertMode?: "cursor" | "end";
  } = {},
) => {
  const normalizedToken = buildFootnoteToken(token.replace(/^\[fn:|\]$/g, ""));
  const source = String(contentHtml || "");
  const insertMode = options.insertMode || "cursor";
  const selectionStart = options.selectionStart ?? source.length;
  const selectionEnd = options.selectionEnd ?? selectionStart;

  if (insertMode === "cursor") {
    const start = Math.max(0, Math.min(selectionStart, source.length));
    const end = Math.max(start, Math.min(selectionEnd, source.length));
    return `${source.slice(0, start)}${normalizedToken}${source.slice(end)}`;
  }

  if (!source.trim()) return normalizedToken;
  return `${source}${source.endsWith("\n") ? "" : "\n"}${normalizedToken}`;
};

export const getLessonFootnoteUsageMap = (
  contentHtml: string,
  footnotes: LessonFootnote[],
) => {
  const byAnchorKey = new Map(
    sortLessonFootnotes(footnotes).map((footnote) => [
      footnote.anchorKey,
      footnote,
    ]),
  );
  const usageMap = new Map<string, LessonFootnoteUsage>();

  Array.from(
    String(contentHtml || "").matchAll(LESSON_FOOTNOTE_TOKEN_REGEX),
  ).forEach((match, index) => {
    const anchorKey = sanitizeLessonFootnoteAnchorKey(match[1]);
    if (!anchorKey) return;
    const footnote = byAnchorKey.get(anchorKey);
    if (!footnote) return;

    const existing = usageMap.get(anchorKey);
    if (existing) {
      usageMap.set(anchorKey, {
        ...existing,
        count: existing.count + 1,
      });
      return;
    }

    usageMap.set(anchorKey, {
      footnote,
      anchorKey,
      count: 1,
      firstTokenIndex: index,
      token: buildFootnoteToken(anchorKey),
    });
  });

  return usageMap;
};

export const getLessonFootnoteUsageEntries = (
  contentHtml: string,
  footnotes: LessonFootnote[],
) =>
  Array.from(getLessonFootnoteUsageMap(contentHtml, footnotes).values()).sort(
    (left, right) => {
      const indexDiff = left.firstTokenIndex - right.firstTokenIndex;
      if (indexDiff !== 0) return indexDiff;
      return left.footnote.order - right.footnote.order;
    },
  );

export const getUsedLessonFootnotes = (
  contentHtml: string,
  footnotes: LessonFootnote[],
) => getLessonFootnoteUsageEntries(contentHtml, footnotes);

export const normalizeLessonData = (
  raw: unknown,
  fallback: Partial<LessonData> = {},
): NormalizedLessonData => {
  const source =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  return {
    unitId: String(source.unitId || fallback.unitId || "").trim() || undefined,
    title: String(source.title || fallback.title || "").trim(),
    videoUrl: String(source.videoUrl || fallback.videoUrl || "").trim(),
    contentHtml: String(source.contentHtml || fallback.contentHtml || ""),
    isVisibleToStudents:
      source.isVisibleToStudents !== false &&
      fallback.isVisibleToStudents !== false,
    pdfName: String(source.pdfName || fallback.pdfName || "").trim(),
    pdfUrl: String(source.pdfUrl || fallback.pdfUrl || "").trim(),
    pdfStoragePath: String(
      source.pdfStoragePath || fallback.pdfStoragePath || "",
    ).trim(),
    worksheetPageImages: normalizeWorksheetPageImages(
      source.worksheetPageImages ?? fallback.worksheetPageImages,
    ),
    worksheetTextRegions: normalizeWorksheetTextRegions(
      source.worksheetTextRegions ?? fallback.worksheetTextRegions,
    ),
    worksheetBlanks: normalizeWorksheetBlanks(
      source.worksheetBlanks ?? fallback.worksheetBlanks,
    ),
    pdfProcessing: normalizeLessonPdfProcessingMeta(source.pdfProcessing, {
      ...(fallback.pdfProcessing || createEmptyLessonPdfProcessingMeta()),
      pdfName: String(source.pdfName || fallback.pdfName || "").trim(),
      pdfStoragePath: String(
        source.pdfStoragePath || fallback.pdfStoragePath || "",
      ).trim(),
    }),
    footnotes: normalizeLessonFootnotes(source.footnotes ?? fallback.footnotes),
    updatedAt: source.updatedAt ?? fallback.updatedAt,
  };
};

export const getLessonContentSections = (
  lesson: LessonData | NormalizedLessonData,
): LessonContentSections => {
  const normalized = normalizeLessonData(lesson);
  return {
    bodyHtml: normalized.contentHtml,
    footnotes: normalized.footnotes,
    worksheet: {
      pdfName: normalized.pdfName,
      pdfUrl: normalized.pdfUrl,
      pageImages: normalized.worksheetPageImages,
      textRegions: normalized.worksheetTextRegions,
      blanks: normalized.worksheetBlanks,
    },
  };
};
