export const DEVELOPER_LOG_COLLECTION = "developer_logs";

export const DEVELOPER_LOG_CATEGORIES = [
  {
    value: "feature",
    label: "기능 추가",
    badgeClassName: "bg-blue-50 text-blue-700 border-blue-200",
  },
  {
    value: "fix",
    label: "버그 수정",
    badgeClassName: "bg-orange-50 text-orange-700 border-orange-200",
  },
  {
    value: "improvement",
    label: "개선",
    badgeClassName: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  {
    value: "notice",
    label: "공지",
    badgeClassName: "bg-slate-50 text-slate-700 border-slate-200",
  },
] as const;

export type DeveloperLogCategory =
  (typeof DEVELOPER_LOG_CATEGORIES)[number]["value"];

export interface DeveloperLogImage {
  imageUrl: string;
  imageStoragePath: string;
  imageByteSize: number;
  imageWidth: number;
  imageHeight: number;
  imageMimeType: string;
  alt?: string;
  order: number;
}

export interface DeveloperLogPost {
  id: string;
  title: string;
  version: string;
  category: DeveloperLogCategory;
  summary: string;
  bodyHtml: string;
  images: DeveloperLogImage[];
  isPinned: boolean;
  viewCount: number;
  likeCount: number;
  createdBy: string;
  createdByName: string;
  createdAt?: any;
  updatedAt?: any;
  publishedAt?: any;
}

export const getDeveloperLogCategoryMeta = (category: string) =>
  DEVELOPER_LOG_CATEGORIES.find((item) => item.value === category) ||
  DEVELOPER_LOG_CATEGORIES[0];

export const normalizeDeveloperLogPost = (
  id: string,
  raw: any,
): DeveloperLogPost => ({
  id,
  title: String(raw?.title || "").trim(),
  version: String(raw?.version || "").trim(),
  category: getDeveloperLogCategoryMeta(raw?.category).value,
  summary: String(raw?.summary || "").trim(),
  bodyHtml: String(raw?.bodyHtml || "").trim(),
  images: Array.isArray(raw?.images)
    ? raw.images
        .map((image: any, index: number) => ({
          imageUrl: String(image?.imageUrl || "").trim(),
          imageStoragePath: String(image?.imageStoragePath || "").trim(),
          imageByteSize: Number(image?.imageByteSize || 0),
          imageWidth: Number(image?.imageWidth || 0),
          imageHeight: Number(image?.imageHeight || 0),
          imageMimeType: String(image?.imageMimeType || "image/webp").trim(),
          alt: String(image?.alt || "").trim(),
          order: Number.isFinite(Number(image?.order))
            ? Number(image.order)
            : index,
        }))
        .filter((image: DeveloperLogImage) => image.imageUrl)
        .sort(
          (left: DeveloperLogImage, right: DeveloperLogImage) =>
            left.order - right.order,
        )
    : [],
  isPinned: raw?.isPinned === true,
  viewCount: Math.max(0, Number(raw?.viewCount || 0)),
  likeCount: Math.max(0, Number(raw?.likeCount || 0)),
  createdBy: String(raw?.createdBy || "").trim(),
  createdByName: String(raw?.createdByName || "개발자").trim(),
  createdAt: raw?.createdAt,
  updatedAt: raw?.updatedAt,
  publishedAt: raw?.publishedAt,
});
