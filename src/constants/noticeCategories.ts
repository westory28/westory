export const NOTICE_CATEGORIES = [
  { val: "normal", label: "공지" },
  { val: "event", label: "학교 행사" },
  { val: "special_event", label: "이벤트" },
  { val: "exam", label: "정기 시험" },
  { val: "performance", label: "수행평가" },
  { val: "prep", label: "준비" },
  { val: "dday", label: "D-Day" },
] as const;

export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number]["val"];

// Legacy and unknown stored categories keep the existing general notice label.
export const getNoticeCategoryLabel = (category?: string) =>
  NOTICE_CATEGORIES.find((option) => option.val === category)?.label || "공지";
