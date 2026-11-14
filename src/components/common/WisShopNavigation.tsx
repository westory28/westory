import { Link } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { getStudentMenuLabel } from "../../constants/menus";
import { canManageSettings, canReadPoints } from "../../lib/permissions";
import { getStudentRouteAccess } from "../../lib/studentMenuAccess";
import {
  STUDENT_AVATAR_SHOP_URL,
  TEACHER_AVATAR_SHOP_URL,
} from "../../lib/avatarRoutes";

function VillageIcon({ kind }: { kind: "products" | "avatar" | "stocks" }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "products" ? (
        <path d="M4 10h16v11H4ZM3 10l2-7h14l2 7M8 10v2m8-2v2M9 21v-6h6v6" />
      ) : kind === "avatar" ? (
        <path d="m8 3-6 4 3 5 3-2v11h8V10l3 2 3-5-6-4a4 4 0 0 1-8 0Z" />
      ) : (
        <path d="M3 3v18h18M7 16l4-5 4 2 6-8m-5 0h5v5" />
      )}
    </svg>
  );
}

export default function WisShopNavigation({
  portal,
  active,
  variant = "tabs",
}: {
  portal: "student" | "teacher";
  active: "products" | "avatar" | "stocks";
  variant?: "tabs" | "rail";
}) {
  const { currentUser, userData, config, menuConfig } = useAuth();
  // The compact side rail is a teacher-only village layout exception.
  const rail = portal === "teacher" && variant === "rail";
  const label = (
    kind: "products" | "avatar" | "stocks",
    full: string,
    short: string,
  ) =>
    rail ? (
      <>
        <VillageIcon kind={kind} />
        <span className="wis-village-rail__full">{full}</span>
        <span className="wis-village-rail__short" aria-hidden="true">
          {short}
        </span>
      </>
    ) : (
      full
    );
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
    <nav
      className={rail ? "wis-village-rail" : "ws-page-tabs mb-4"}
      aria-label="위스 마을"
    >
      <Link
        to={
          portal === "student"
            ? "/student/points?tab=shop"
            : "/teacher/points?tab=products"
        }
        aria-current={active === "products" ? "page" : undefined}
        aria-label={rail ? "위스 상점" : undefined}
      >
        {portal === "student"
          ? getStudentMenuLabel(
              menuConfig,
              "/student/points?tab=shop",
              "위스 상점",
            )
          : label("products", "위스 상점", "상점")}
      </Link>
      {avatarAllowed && (
        <Link
          to={
            portal === "student"
              ? STUDENT_AVATAR_SHOP_URL
              : TEACHER_AVATAR_SHOP_URL
          }
          aria-current={active === "avatar" ? "page" : undefined}
          aria-label={rail ? "아바타 상점" : undefined}
        >
          {portal === "student"
            ? getStudentMenuLabel(
                menuConfig,
                STUDENT_AVATAR_SHOP_URL,
                "아바타 상점",
              )
            : label("avatar", "아바타 상점", "아바타")}
        </Link>
      )}
      {portal === "teacher" && canReadPoints(userData, currentUser?.email) && (
        <Link
          to="/teacher/points?tab=stocks"
          aria-current={active === "stocks" ? "page" : undefined}
          aria-label={rail ? "위스피(WsPI)" : undefined}
        >
          {label("stocks", "위스피(WsPI)", "위스피")}
        </Link>
      )}
    </nav>
  );
}
