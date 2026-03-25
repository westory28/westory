export interface LessonWorksheetPageImage {
  page: number;
  imageUrl: string;
  width: number;
  height: number;
}

export interface LessonWorksheetTextRegion {
  label: string;
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LessonWorksheetBlank {
  id: string;
  page: number;
  leftRatio: number;
  topRatio: number;
  widthRatio: number;
  heightRatio: number;
  answer: string;
  prompt?: string;
  source?: "ocr" | "manual";
}

export interface LessonWorksheetFootnoteAnchor {
  id: string;
  footnoteId: string;
  page: number;
  leftRatio: number;
  topRatio: number;
  widthRatio: number;
  heightRatio: number;
}

export type LessonWorksheetStageMode =
  | "teacher-edit"
  | "teacher-present"
  | "student-solve";

export interface LessonWorksheetStageCapabilities {
  showTeacherPageNavigator: boolean;
  showStudentPageNavigator: boolean;
  enableBlankDrafting: boolean;
  enableBlankSelection: boolean;
  enableBlankSolve: boolean;
  enableAnswerCheck: boolean;
  enableAnnotationTools: boolean;
  showTextRegionHints: boolean;
}

export const clampRatio = (value: number) => Math.min(1, Math.max(0, value));

export const normalizeBlankText = (value: string) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, "");

export const getLessonWorksheetStageCapabilities = (
  mode: LessonWorksheetStageMode,
): LessonWorksheetStageCapabilities => {
  switch (mode) {
    case "teacher-edit":
      return {
        showTeacherPageNavigator: true,
        showStudentPageNavigator: false,
        enableBlankDrafting: true,
        enableBlankSelection: true,
        enableBlankSolve: false,
        enableAnswerCheck: false,
        enableAnnotationTools: false,
        showTextRegionHints: true,
      };
    case "teacher-present":
      return {
        showTeacherPageNavigator: true,
        showStudentPageNavigator: false,
        enableBlankDrafting: false,
        enableBlankSelection: false,
        enableBlankSolve: false,
        enableAnswerCheck: false,
        enableAnnotationTools: true,
        showTextRegionHints: false,
      };
    case "student-solve":
    default:
      return {
        showTeacherPageNavigator: false,
        showStudentPageNavigator: true,
        enableBlankDrafting: false,
        enableBlankSelection: false,
        enableBlankSolve: true,
        enableAnswerCheck: true,
        enableAnnotationTools: true,
        showTextRegionHints: false,
      };
  }
};

export const normalizeWorksheetPageImages = (
  raw: unknown,
): LessonWorksheetPageImage[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((page) => ({
      page: Math.max(
        1,
        Number(
          page && typeof page === "object" && "page" in page
            ? (page as { page?: number }).page
            : 1,
        ) || 1,
      ),
      imageUrl: String(
        page && typeof page === "object" && "imageUrl" in page
          ? (page as { imageUrl?: string }).imageUrl
          : "",
      ).trim(),
      width:
        Number(
          page && typeof page === "object" && "width" in page
            ? (page as { width?: number }).width
            : 0,
        ) || 0,
      height:
        Number(
          page && typeof page === "object" && "height" in page
            ? (page as { height?: number }).height
            : 0,
        ) || 0,
    }))
    .filter((page) => page.imageUrl)
    .sort((a, b) => a.page - b.page);
};

export const normalizeWorksheetTextRegions = (
  raw: unknown,
): LessonWorksheetTextRegion[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((region) => ({
      label: String(
        region && typeof region === "object" && "label" in region
          ? (region as { label?: string }).label
          : "",
      ).trim(),
      page: Math.max(
        1,
        Number(
          region && typeof region === "object" && "page" in region
            ? (region as { page?: number }).page
            : 1,
        ) || 1,
      ),
      left:
        Number(
          region && typeof region === "object" && "left" in region
            ? (region as { left?: number }).left
            : 0,
        ) || 0,
      top:
        Number(
          region && typeof region === "object" && "top" in region
            ? (region as { top?: number }).top
            : 0,
        ) || 0,
      width:
        Number(
          region && typeof region === "object" && "width" in region
            ? (region as { width?: number }).width
            : 0,
        ) || 0,
      height:
        Number(
          region && typeof region === "object" && "height" in region
            ? (region as { height?: number }).height
            : 0,
        ) || 0,
    }))
    .filter((region) => region.width > 0 && region.height > 0);
};

const TOKEN_PATTERN = /\[[^\]]+\]|[\p{L}\p{N}]+/gu;

export const splitTextRegionIntoTokens = (
  region: LessonWorksheetTextRegion,
  pageImage?: LessonWorksheetPageImage | null,
): LessonWorksheetTextRegion[] => {
  const source = String(region.label || "");
  if (!source.trim()) return [];

  const matches = Array.from(source.matchAll(TOKEN_PATTERN));
  if (!matches.length) {
    return [region];
  }

  const safeWidth = Math.max(region.width, 1);
  const safeHeight = Math.max(region.height, 10);
  const totalChars = Math.max(source.length, 1);
  const avgCharWidth = safeWidth / totalChars;
  const tokenHeight = Math.max(10, safeHeight * 0.82);
  const top = region.top + Math.max(0, (safeHeight - tokenHeight) / 2);

  return matches
    .map((match, index) => {
      const text = String(match[0] || "").trim();
      const start = match.index ?? 0;
      const end = start + text.length;
      const rawLeft = region.left + avgCharWidth * start;
      const rawWidth = Math.max(
        tokenHeight * 0.9,
        avgCharWidth * Math.max(end - start, 1),
      );
      const left = Math.max(region.left, rawLeft - 1);
      const right = Math.min(
        region.left + region.width,
        rawLeft + rawWidth + 1,
      );
      const width = Math.max(8, right - left);

      return {
        label: text,
        page: region.page,
        left,
        top,
        width,
        height: tokenHeight,
      };
    })
    .filter((item) => item.width > 0 && item.height > 0 && item.label);
};

export const getTightTextRegionBounds = (
  region: LessonWorksheetTextRegion,
  pageImage?: LessonWorksheetPageImage | null,
) => {
  if (!pageImage || pageImage.width <= 0 || pageImage.height <= 0) {
    return null;
  }

  const label = String(region.label || "").trim();
  const charCount = Math.max(label.replace(/\s+/g, "").length, 1);
  const targetHeight = Math.max(12, region.height * 0.76);
  const estimatedCharWidth = targetHeight * 0.9;
  const targetWidth = Math.min(
    region.width,
    Math.max(
      targetHeight * 1.2,
      estimatedCharWidth * charCount + targetHeight * 0.35,
    ),
  );
  const insetX = Math.max(0, (region.width - targetWidth) / 2);
  const insetY = Math.max(0, (region.height - targetHeight) / 2);

  const left = region.left + insetX;
  const top = region.top + insetY;
  const width = Math.max(targetWidth, targetHeight * 1.15);
  const height = Math.max(targetHeight, 10);

  return {
    left,
    top,
    width,
    height,
    leftRatio: clampRatio(left / pageImage.width),
    topRatio: clampRatio(top / pageImage.height),
    widthRatio: clampRatio(width / pageImage.width),
    heightRatio: clampRatio(height / pageImage.height),
  };
};

export const createBlankFromRegion = (
  region: LessonWorksheetTextRegion,
  pageImage?: LessonWorksheetPageImage | null,
): LessonWorksheetBlank | null => {
  const bounds = getTightTextRegionBounds(region, pageImage);
  if (!bounds) {
    return null;
  }

  return {
    id: `blank-${region.page}-${Math.round(region.left)}-${Math.round(region.top)}-${Date.now()}`,
    page: region.page,
    leftRatio: bounds.leftRatio,
    topRatio: bounds.topRatio,
    widthRatio: bounds.widthRatio,
    heightRatio: bounds.heightRatio,
    answer: String(region.label || "").trim(),
    prompt: "",
    source: "ocr",
  };
};

export const normalizeWorksheetBlanks = (
  raw: unknown,
): LessonWorksheetBlank[] => {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item, index) => ({
      id:
        String(
          item && typeof item === "object" && "id" in item
            ? (item as { id?: string }).id
            : "",
        ).trim() || `blank-${index + 1}`,
      page: Math.max(
        1,
        Number(
          item && typeof item === "object" && "page" in item
            ? (item as { page?: number }).page
            : 1,
        ) || 1,
      ),
      leftRatio: clampRatio(
        Number(
          item && typeof item === "object" && "leftRatio" in item
            ? (item as { leftRatio?: number }).leftRatio
            : 0,
        ) || 0,
      ),
      topRatio: clampRatio(
        Number(
          item && typeof item === "object" && "topRatio" in item
            ? (item as { topRatio?: number }).topRatio
            : 0,
        ) || 0,
      ),
      widthRatio: clampRatio(
        Number(
          item && typeof item === "object" && "widthRatio" in item
            ? (item as { widthRatio?: number }).widthRatio
            : 0,
        ) || 0,
      ),
      heightRatio: clampRatio(
        Number(
          item && typeof item === "object" && "heightRatio" in item
            ? (item as { heightRatio?: number }).heightRatio
            : 0,
        ) || 0,
      ),
      answer: String(
        item && typeof item === "object" && "answer" in item
          ? (item as { answer?: string }).answer
          : "",
      ).trim(),
      prompt: String(
        item && typeof item === "object" && "prompt" in item
          ? (item as { prompt?: string }).prompt
          : "",
      ).trim(),
      source: (item &&
      typeof item === "object" &&
      "source" in item &&
      (item as { source?: string }).source === "manual"
        ? "manual"
        : "ocr") as "ocr" | "manual",
    }))
    .filter((item) => item.widthRatio > 0 && item.heightRatio > 0);
};

export const normalizeWorksheetFootnoteAnchors = (
  raw: unknown,
): LessonWorksheetFootnoteAnchor[] => {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item, index) => ({
      id:
        String(
          item && typeof item === "object" && "id" in item
            ? (item as { id?: string }).id
            : "",
        ).trim() || `footnote-anchor-${index + 1}`,
      footnoteId: String(
        item && typeof item === "object" && "footnoteId" in item
          ? (item as { footnoteId?: string }).footnoteId
          : "",
      ).trim(),
      page: Math.max(
        1,
        Number(
          item && typeof item === "object" && "page" in item
            ? (item as { page?: number }).page
            : 1,
        ) || 1,
      ),
      leftRatio: clampRatio(
        Number(
          item && typeof item === "object" && "leftRatio" in item
            ? (item as { leftRatio?: number }).leftRatio
            : 0,
        ) || 0,
      ),
      topRatio: clampRatio(
        Number(
          item && typeof item === "object" && "topRatio" in item
            ? (item as { topRatio?: number }).topRatio
            : 0,
        ) || 0,
      ),
      widthRatio: clampRatio(
        Number(
          item && typeof item === "object" && "widthRatio" in item
            ? (item as { widthRatio?: number }).widthRatio
            : 0,
        ) || 0,
      ),
      heightRatio: clampRatio(
        Number(
          item && typeof item === "object" && "heightRatio" in item
            ? (item as { heightRatio?: number }).heightRatio
            : 0,
        ) || 0,
      ),
    }))
    .filter(
      (item) =>
        item.footnoteId &&
        item.widthRatio > 0 &&
        item.heightRatio > 0,
    );
};
