import type { MenuConfig } from "../constants/menus";

export const DEFAULT_WEPLAY_GAME_TITLE = "내가 충무공이라고?!";
export const WEPLAY_STUDENT_URL = "/student/weplay";

export const normalizeWeplayGameTitle = (
  value: string | undefined,
  customized = false,
) => {
  const title = value?.trim();
  return !title || (!customized && title === "역사가 내려와")
    ? DEFAULT_WEPLAY_GAME_TITLE
    : title;
};

export const getWeplayGameTitle = (menus: MenuConfig | null | undefined) => {
  const child = menus?.student
    .find((item) => item.url === WEPLAY_STUDENT_URL)
    ?.children?.find((item) => item.url === WEPLAY_STUDENT_URL);
  return normalizeWeplayGameTitle(child?.name, child?.gameTitleCustomized);
};

export const setWeplayGameTitle = (
  menus: MenuConfig,
  title: string,
): MenuConfig => ({
  ...menus,
  student: menus.student.map((item) =>
    item.url === WEPLAY_STUDENT_URL
      ? {
          ...item,
          children: item.children?.map((child) =>
            child.url === WEPLAY_STUDENT_URL
              ? { ...child, name: title.trim(), gameTitleCustomized: true }
              : child,
          ),
        }
      : item,
  ),
});
