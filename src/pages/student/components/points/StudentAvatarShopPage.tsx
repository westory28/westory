import React from "react";
import { useAuth } from "../../../../contexts/AuthContext";
import { getStudentMenuLabel } from "../../../../constants/menus";
import { getStudentRouteAccess } from "../../../../lib/studentMenuAccess";
import { lazyWithRetry } from "../../../../lib/lazyWithRetry";
import { InlineLoading } from "../../../../components/common/LoadingState";
import WisShopNavigation from "../../../../components/common/WisShopNavigation";
import StudentPointNavigation from "./StudentPointNavigation";

const StudentAvatarStudio = lazyWithRetry(
  () => import("../../../../features/avatar/AvatarStudio"),
  "student-avatar-shop",
);

export default function StudentAvatarShopPage() {
  const { config, menuConfig } = useAuth();
  const pageTitle = getStudentMenuLabel(
    menuConfig,
    "/student/points",
    "위스",
    "group",
  );
  const allowed =
    getStudentRouteAccess(
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
    <div className="flex min-h-screen flex-col bg-gray-50">
      <main className="ws-page flex-1">
        <header className="ws-page-header mb-4">
          <h1>{pageTitle}</h1>
        </header>
        <StudentPointNavigation activeTab="shop" pageTitle={pageTitle} />
        <WisShopNavigation portal="student" active="avatar" />
        {allowed ? (
          <React.Suspense fallback={<InlineLoading />}>
            <StudentAvatarStudio mode="shop" />
          </React.Suspense>
        ) : (
          <p role="alert">현재 아바타 상점을 이용할 수 없습니다.</p>
        )}
      </main>
    </div>
  );
}
