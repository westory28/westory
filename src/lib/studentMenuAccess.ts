import type { MenuChild, MenuConfig, MenuItem } from "../constants/menus";
import type { SystemConfig } from "../types";

export const STUDENT_HIDDEN_MENU_REDIRECT = "/student/dashboard";

/** The rules and callable functions read this projection from the same atomic save. */
export const buildStudentMenuVisibility = (menuConfig: MenuConfig) => {
  const parentVisible = (url: string) =>
    !menuConfig.student.some(
      (item) => item.url === url && item.hidden === true,
    );
  const childVisible = (url: string) =>
    !menuConfig.student.some((item) =>
      item.children?.some(
        (child) => child.url === url && child.hidden === true,
      ),
    );
  const weplay = parentVisible("/student/weplay");
  const mypage = parentVisible("/student/mypage");
  const avatarShopTarget = (url: string) => {
    const { pathname, searchParams } = parseMenuUrl(url);
    return (
      pathname === "/student/points" &&
      searchParams.get("tab") === "shop" &&
      (!searchParams.has("shop") || searchParams.get("shop") === "avatar")
    );
  };
  const avatarShop = !menuConfig.student.some(
    (item) =>
      (item.hidden === true &&
        (parseMenuUrl(item.url).pathname === "/student/points" ||
          item.children?.some((child) => avatarShopTarget(child.url)))) ||
      item.children?.some(
        (child) => child.hidden === true && avatarShopTarget(child.url),
      ),
  );
  return {
    weplay,
    naval:
      weplay &&
      childVisible("/student/weplay") &&
      childVisible("/student/weplay?game=history-rain"),
    yut: weplay && childVisible("/student/weplay?game=joseon-yut"),
    mypage,
    profile:
      mypage &&
      childVisible("/student/mypage") &&
      childVisible("/student/mypage?menu=profile"),
    avatar: mypage && childVisible("/student/mypage?menu=avatar"),
    avatar_shop: avatarShop,
    score: mypage && childVisible("/student/mypage?menu=score"),
    wrong_note: mypage && childVisible("/student/mypage?menu=wrong_note"),
  };
};

type StudentRouteTarget = {
  pathname: string;
  search?: string;
};

type StudentSystemMenuRule = {
  configKey: keyof Pick<SystemConfig, "showLesson" | "showQuiz" | "showScore">;
  blockedPathPrefixes: string[];
};

type ParsedMenuUrl = {
  pathname: string;
  searchParams: URLSearchParams;
  hasSearch: boolean;
};

type StudentRouteAccess =
  | { allowed: true }
  | {
      allowed: false;
      redirectTo: string;
      reason: "system-config" | "menu-config" | "not-visible" | "unverified";
      label?: string;
    };

const STUDENT_SYSTEM_MENU_RULES: StudentSystemMenuRule[] = [
  {
    configKey: "showLesson",
    blockedPathPrefixes: ["/student/lesson"],
  },
  {
    configKey: "showQuiz",
    blockedPathPrefixes: ["/student/quiz", "/student/history-classroom"],
  },
  {
    configKey: "showScore",
    blockedPathPrefixes: ["/student/score", "/student/history"],
  },
];

const ALWAYS_ALLOWED_STUDENT_PREFIXES = [
  "/student/dashboard",
  "/student/calendar",
];

const MENU_CONFIG_CONTROLLED_STUDENT_PREFIXES = [
  "/student/points",
  "/student/weplay",
  "/student/mypage",
];

const HIDDEN_CHILD_DESCENDANT_PATHS: Record<string, string[]> = {
  "/student/quiz": ["/student/quiz/run"],
  "/student/history-classroom": ["/student/history-classroom/run"],
};

const VISIBLE_MENU_DESCENDANT_PATHS: Record<string, string[]> = {
  "/student/quiz": ["/student/quiz/run"],
  "/student/history-classroom": ["/student/history-classroom/run"],
};

const normalizePathname = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return "/";
  const [pathOnly] = raw.split("?");
  const withSlash = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
  return withSlash.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
};

const normalizeSearch = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.startsWith("?") ? raw.slice(1) : raw;
};

const parseMenuUrl = (url: unknown): ParsedMenuUrl => {
  const raw = String(url || "").trim();
  const [pathPart, queryPart = ""] = raw.split("?");
  const pathname = normalizePathname(pathPart);
  return {
    pathname,
    searchParams: new URLSearchParams(queryPart),
    hasSearch: queryPart.trim().length > 0,
  };
};

const isPathUnderPrefix = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

const isAlwaysAllowedStudentPath = (pathname: string) =>
  ALWAYS_ALLOWED_STUDENT_PREFIXES.some((prefix) =>
    isPathUnderPrefix(pathname, prefix),
  );

export const isStudentPathBlockedBySystemConfig = (
  pathname: string,
  config: SystemConfig,
) => {
  const normalizedPathname = normalizePathname(pathname);
  return STUDENT_SYSTEM_MENU_RULES.some((rule) => {
    if (config[rule.configKey] !== false) return false;
    return rule.blockedPathPrefixes.some((prefix) =>
      isPathUnderPrefix(normalizedPathname, prefix),
    );
  });
};

export const isStudentVisibilityControlledPath = (pathname: string) => {
  const normalizedPathname = normalizePathname(pathname);
  if (!normalizedPathname.startsWith("/student")) return false;
  if (isAlwaysAllowedStudentPath(normalizedPathname)) return false;

  return (
    STUDENT_SYSTEM_MENU_RULES.some((rule) =>
      rule.blockedPathPrefixes.some((prefix) =>
        isPathUnderPrefix(normalizedPathname, prefix),
      ),
    ) ||
    MENU_CONFIG_CONTROLLED_STUDENT_PREFIXES.some((prefix) =>
      isPathUnderPrefix(normalizedPathname, prefix),
    )
  );
};

const isMenuUrlBlockedBySystemConfig = (
  menuUrl: string,
  config: SystemConfig,
) => isStudentPathBlockedBySystemConfig(parseMenuUrl(menuUrl).pathname, config);

const menuTargetsEqual = (leftUrl: string, rightUrl: string) => {
  const left = parseMenuUrl(leftUrl);
  const right = parseMenuUrl(rightUrl);
  if (left.pathname !== right.pathname) return false;

  const leftEntries = Array.from(left.searchParams.entries());
  const rightEntries = Array.from(right.searchParams.entries());
  if (leftEntries.length !== rightEntries.length) return false;

  return leftEntries.every(
    ([key, value]) => right.searchParams.get(key) === value,
  );
};

const childUrlHasQuerySiblingOnSamePath = (
  child: MenuChild,
  siblings: MenuChild[],
) => {
  const parsedChild = parseMenuUrl(child.url);
  return siblings.some((sibling) => {
    if (sibling === child) return false;
    const parsedSibling = parseMenuUrl(sibling.url);
    return (
      parsedSibling.pathname === parsedChild.pathname && parsedSibling.hasSearch
    );
  });
};

const targetHasSearchParams = (search: unknown) =>
  Array.from(new URLSearchParams(normalizeSearch(search)).keys()).length > 0;

const menuTargetMatchesRoute = (
  menuUrl: string,
  target: StudentRouteTarget,
  siblings: Array<{ url: string }> = [],
) => {
  const parsedMenuUrl = parseMenuUrl(menuUrl);
  const targetPathname = normalizePathname(target.pathname);
  const targetSearchParams = new URLSearchParams(
    normalizeSearch(target.search),
  );

  if (parsedMenuUrl.pathname === targetPathname) {
    for (const [key, value] of parsedMenuUrl.searchParams.entries()) {
      if (targetSearchParams.get(key) !== value) return false;
    }

    if (parsedMenuUrl.hasSearch) return true;
    if (!targetHasSearchParams(target.search)) return true;

    return !siblings.some((sibling) => {
      const parsedSibling = parseMenuUrl(sibling.url);
      return (
        parsedSibling.pathname === parsedMenuUrl.pathname &&
        parsedSibling.hasSearch
      );
    });
  }

  if (parsedMenuUrl.hasSearch) return false;

  return (VISIBLE_MENU_DESCENDANT_PATHS[parsedMenuUrl.pathname] || []).some(
    (descendantPath) => isPathUnderPrefix(targetPathname, descendantPath),
  );
};

const hiddenChildMatchesRoute = (
  child: MenuChild,
  siblings: MenuChild[],
  target: StudentRouteTarget,
) => {
  const parsedChild = parseMenuUrl(child.url);
  const targetPathname = normalizePathname(target.pathname);
  const targetSearchParams = new URLSearchParams(
    normalizeSearch(target.search),
  );
  const targetHasSearchParams =
    Array.from(targetSearchParams.keys()).length > 0;

  if (parsedChild.pathname === targetPathname) {
    for (const [key, value] of parsedChild.searchParams.entries()) {
      if (targetSearchParams.get(key) !== value) return false;
    }

    if (parsedChild.hasSearch) return true;
    if (!targetHasSearchParams) return true;
    return !childUrlHasQuerySiblingOnSamePath(child, siblings);
  }

  if (parsedChild.hasSearch) return false;

  return (HIDDEN_CHILD_DESCENDANT_PATHS[parsedChild.pathname] || []).some(
    (descendantPath) => isPathUnderPrefix(targetPathname, descendantPath),
  );
};

const findHiddenStudentMenuChild = (
  menuConfig: MenuConfig,
  target: StudentRouteTarget,
) => {
  for (const item of menuConfig.student || []) {
    const children = item.children || [];
    for (const child of children) {
      if (child.hidden !== true) continue;
      if (hiddenChildMatchesRoute(child, children, target)) {
        return child;
      }
    }
  }
  return null;
};

const isParentUrlHiddenByChild = (item: MenuItem) => {
  const children = item.children || [];
  return children.some(
    (child) => child.hidden === true && menuTargetsEqual(child.url, item.url),
  );
};

export const getStudentVisibleMenuItems = (
  menuItems: MenuItem[],
  config: SystemConfig | null,
): MenuItem[] => {
  if (!config) return [];

  return menuItems.flatMap((item) => {
    if (item.hidden === true) return [];
    const visibility = config.studentMenuVisibility;
    if (item.url === "/student/mypage" && visibility?.mypage === false)
      return [];
    if (item.url === "/student/weplay" && visibility?.weplay === false)
      return [];
    if (isMenuUrlBlockedBySystemConfig(item.url, config)) return [];

    const originalChildren = item.children || [];
    const visibleChildren = originalChildren.filter(
      (child) =>
        child.hidden !== true &&
        !(child.url === "/student/weplay" && visibility?.naval === false) &&
        !(
          child.url === "/student/weplay?game=joseon-yut" &&
          visibility?.yut === false
        ) &&
        !(child.url === "/student/mypage" && visibility?.profile === false) &&
        !(
          child.url === "/student/mypage?menu=avatar" &&
          visibility?.avatar === false
        ) &&
        !(
          child.url === "/student/mypage?menu=score" &&
          visibility?.score === false
        ) &&
        !(
          child.url === "/student/mypage?menu=wrong_note" &&
          visibility?.wrong_note === false
        ) &&
        !(
          child.url === "/student/mypage?menu=score" &&
          config.showScore === false
        ) &&
        !(
          child.url === "/student/mypage?menu=wrong_note" &&
          config.showQuiz === false
        ) &&
        !isMenuUrlBlockedBySystemConfig(child.url, config),
    );

    if (originalChildren.length > 0 && visibleChildren.length === 0) {
      return [];
    }

    const shouldMoveParentTarget =
      item.url !== "/student/weplay" &&
      originalChildren.length > 0 &&
      isParentUrlHiddenByChild(item);
    const nextUrl = shouldMoveParentTarget
      ? visibleChildren[0]?.url || item.url
      : item.url;

    return [
      {
        ...item,
        url: nextUrl,
        children: originalChildren.length > 0 ? visibleChildren : item.children,
      },
    ];
  });
};

const isStudentRouteVisibleInMenu = (
  target: StudentRouteTarget,
  visibleMenuItems: MenuItem[],
) => {
  for (const item of visibleMenuItems) {
    const children = item.children || [];
    if (menuTargetMatchesRoute(item.url, target, children)) {
      return true;
    }

    if (
      children.some((child) =>
        menuTargetMatchesRoute(child.url, target, children),
      )
    ) {
      return true;
    }
  }

  return false;
};

export const getStudentRouteAccess = (
  target: StudentRouteTarget,
  config: SystemConfig | null,
  menuConfig: MenuConfig | null,
): StudentRouteAccess => {
  const pathname = normalizePathname(target.pathname);
  if (!pathname.startsWith("/student")) return { allowed: true };
  if (isAlwaysAllowedStudentPath(pathname)) return { allowed: true };

  if (!config || !menuConfig) {
    return {
      allowed: false,
      redirectTo: STUDENT_HIDDEN_MENU_REDIRECT,
      reason: "unverified",
    };
  }

  if (isStudentPathBlockedBySystemConfig(pathname, config)) {
    return {
      allowed: false,
      redirectTo: STUDENT_HIDDEN_MENU_REDIRECT,
      reason: "system-config",
    };
  }

  const routeParams = new URLSearchParams(normalizeSearch(target.search));
  if (
    pathname === "/student/points" &&
    routeParams.get("tab") === "shop" &&
    routeParams.get("shop") === "avatar" &&
    (config.studentMenuVisibility?.avatar_shop === false ||
      !buildStudentMenuVisibility(menuConfig).avatar_shop)
  ) {
    return {
      allowed: false,
      redirectTo: STUDENT_HIDDEN_MENU_REDIRECT,
      reason: "menu-config",
    };
  }

  if (pathname === "/student/mypage" || pathname === "/student/weplay") {
    const visibility = buildStudentMenuVisibility(menuConfig);
    const visible = (key: keyof typeof visibility) =>
      visibility[key] && config.studentMenuVisibility?.[key] !== false;
    const params = new URLSearchParams(normalizeSearch(target.search));
    let allowed = false;
    if (pathname === "/student/mypage") {
      const menu = params.get("menu") || "profile";
      const requested = menu === "wardrobe" ? "avatar" : menu;
      const key = ["profile", "avatar", "score", "wrong_note"].includes(
        requested,
      )
        ? (requested as "profile" | "avatar" | "score" | "wrong_note")
        : "profile";
      allowed =
        visible("mypage") &&
        visible(key) &&
        (key !== "score" || config.showScore !== false) &&
        (key !== "wrong_note" || config.showQuiz !== false);
    } else {
      const game = params.get("game");
      allowed =
        visible("weplay") &&
        (!game
          ? visible("naval") || visible("yut")
          : game === "history-rain"
            ? visible("naval")
            : game === "joseon-yut" && visible("yut"));
    }
    return allowed
      ? { allowed: true }
      : {
          allowed: false,
          redirectTo: STUDENT_HIDDEN_MENU_REDIRECT,
          reason: "menu-config",
        };
  }

  if (
    menuConfig.student.some(
      (item) =>
        item.hidden === true &&
        (isPathUnderPrefix(pathname, parseMenuUrl(item.url).pathname) ||
          item.children?.some((child) =>
            menuTargetMatchesRoute(child.url, target, item.children),
          )),
    )
  ) {
    return {
      allowed: false,
      redirectTo: STUDENT_HIDDEN_MENU_REDIRECT,
      reason: "menu-config",
    };
  }

  const hiddenChild = findHiddenStudentMenuChild(menuConfig, {
    pathname,
    search: target.search,
  });
  if (hiddenChild) {
    return {
      allowed: false,
      redirectTo: STUDENT_HIDDEN_MENU_REDIRECT,
      reason: "menu-config",
      label: hiddenChild.name,
    };
  }

  const visibleMenuItems = getStudentVisibleMenuItems(
    menuConfig.student || [],
    config,
  );
  if (
    !isStudentRouteVisibleInMenu(
      { pathname, search: target.search },
      visibleMenuItems,
    )
  ) {
    return {
      allowed: false,
      redirectTo: STUDENT_HIDDEN_MENU_REDIRECT,
      reason: "not-visible",
    };
  }

  return { allowed: true };
};
