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
  onNavigate,
}: {
  portal: "student" | "teacher";
  active: "products" | "avatar" | "stocks";
  variant?: "tabs" | "items";
  onNavigate?: () => void;
}) {
  const { currentUser, userData, config, menuConfig } = useAuth();
  const items = portal === "teacher" && variant === "items";
  const itemClass = (key: typeof active) =>
    items
      ? `teacher-settings-section${active === key ? " is-active" : ""}`
      : undefined;
  const label = (kind: "products" | "avatar" | "stocks", full: string) =>
    items ? (
      <>
        <VillageIcon kind={kind} />
        <span>{full}</span>
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
  const links = (
    <>
      <Link
        to={
          portal === "student"
            ? "/student/points?tab=shop"
            : "/teacher/points?tab=products"
        }
        aria-current={active === "products" ? "page" : undefined}
        className={itemClass("products")}
        onClick={onNavigate}
      >
        {portal === "student"
          ? getStudentMenuLabel(
              menuConfig,
              "/student/points?tab=shop",
              "위스 상점",
            )
          : label("products", "위스 상점")}
      </Link>
      {avatarAllowed && (
        <Link
          to={
            portal === "student"
              ? STUDENT_AVATAR_SHOP_URL
              : TEACHER_AVATAR_SHOP_URL
          }
          aria-current={active === "avatar" ? "page" : undefined}
          className={itemClass("avatar")}
          onClick={onNavigate}
        >
          {portal === "student"
            ? getStudentMenuLabel(
                menuConfig,
                STUDENT_AVATAR_SHOP_URL,
                "아바타 상점",
              )
            : label("avatar", "아바타 상점")}
        </Link>
      )}
      {portal === "teacher" && canReadPoints(userData, currentUser?.email) && (
        <Link
          to="/teacher/points?tab=stocks"
          aria-current={active === "stocks" ? "page" : undefined}
          className={itemClass("stocks")}
          onClick={onNavigate}
        >
          {label("stocks", "위스피(WsPI)")}
        </Link>
      )}
    </>
  );
  return items ? (
    links
  ) : (
    <nav className="ws-page-tabs mb-4" aria-label="위스 마을">
      {links}
    </nav>
  );
}
