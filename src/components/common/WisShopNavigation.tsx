import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { getStudentMenuLabel } from "../../constants/menus";
import { canManageSettings, canReadPoints } from "../../lib/permissions";
import { getStudentRouteAccess } from "../../lib/studentMenuAccess";
import {
  STUDENT_AVATAR_SHOP_URL,
  TEACHER_AVATAR_SHOP_URL,
} from "../../lib/avatarRoutes";

export default function WisShopNavigation({
  portal,
  active,
}: {
  portal: "student" | "teacher";
  active: "products" | "avatar" | "stocks";
}) {
  const { currentUser, userData, config, menuConfig } = useAuth();
  const avatarAllowed =
    portal === "teacher"
      ? canManageSettings(userData, currentUser?.email)
      : getStudentRouteAccess(
          { pathname: "/student/mypage", search: "?menu=avatar" },
          config,
          menuConfig,
        ).allowed &&
        getStudentRouteAccess(
          { pathname: "/student/points", search: "?tab=shop&shop=avatar" },
          config,
          menuConfig,
        ).allowed;
  return (
    <nav className="ws-page-tabs mb-4" aria-label="위스 마을">
      <Link
        to={
          portal === "student"
            ? "/student/points?tab=shop"
            : "/teacher/points?tab=products"
        }
        aria-current={active === "products" ? "page" : undefined}
      >
        {portal === "student"
          ? getStudentMenuLabel(
              menuConfig,
              "/student/points?tab=shop",
              "위스 상점",
            )
          : "위스 상점"}
      </Link>
      {avatarAllowed && (
        <Link
          to={
            portal === "student"
              ? STUDENT_AVATAR_SHOP_URL
              : TEACHER_AVATAR_SHOP_URL
          }
          aria-current={active === "avatar" ? "page" : undefined}
        >
          {portal === "student"
            ? getStudentMenuLabel(
                menuConfig,
                STUDENT_AVATAR_SHOP_URL,
                "아바타 상점",
              )
            : "아바타 상점"}
        </Link>
      )}
      {portal === "teacher" && canReadPoints(userData, currentUser?.email) && (
        <Link
          to="/teacher/points?tab=stocks"
          aria-current={active === "stocks" ? "page" : undefined}
        >
          위스피(WsPI)
        </Link>
      )}
    </nav>
  );
}
