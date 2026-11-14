export const STUDENT_AVATAR_SHOP_URL = "/student/points?tab=shop&shop=avatar";
// Preserve the existing visibility key and bookmarks for the owned-item wardrobe.
export const STUDENT_AVATAR_WARDROBE_URL = "/student/mypage?menu=avatar";
export const TEACHER_AVATAR_SHOP_URL =
  "/teacher/points?tab=products&shop=avatar";

export const isStudentAvatarShop = (params: URLSearchParams) =>
  params.get("tab") === "shop" && params.get("shop") === "avatar";
export const isTeacherAvatarShop = (params: URLSearchParams) =>
  params.get("tab") === "products" && params.get("shop") === "avatar";

export const getWisShopMenuKey = (
  url: string,
  portal: "student" | "teacher",
): "products" | "avatar" | "orders" | "requests" | "stocks" | "" => {
  const [pathname, query = ""] = url.split("?");
  if (pathname !== `/${portal}/points`) return "";
  const params = new URLSearchParams(query);
  if (portal === "student") {
    if (isStudentAvatarShop(params)) return "avatar";
    if (params.get("tab") === "shop") return "products";
    return params.get("tab") === "orders" ? "orders" : "";
  }
  if (isTeacherAvatarShop(params)) return "avatar";
  if (params.get("tab") === "products") return "products";
  if (params.get("tab") === "stocks") return "stocks";
  return params.get("tab") === "requests" ? "requests" : "";
};
