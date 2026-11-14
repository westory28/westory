import React from "react";
import { useAuth } from "../../../../contexts/AuthContext";
import { canManageSettings } from "../../../../lib/permissions";
import { lazyWithRetry } from "../../../../lib/lazyWithRetry";
import { InlineLoading } from "../../../../components/common/LoadingState";
import TeacherWisVillage from "./TeacherWisVillage";

const SettingsAvatarPricing = lazyWithRetry(
  () => import("../SettingsAvatarPricing"),
  "teacher-avatar-shop-management",
);

export default function TeacherAvatarShopPage() {
  const { userData, currentUser } = useAuth();
  const allowed = canManageSettings(userData, currentUser?.email);
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <main className="ws-page flex-1">
        <TeacherWisVillage active="avatar">
          {allowed ? (
            <React.Suspense fallback={<InlineLoading />}>
              <SettingsAvatarPricing />
            </React.Suspense>
          ) : (
            <p role="alert">관리자 계정에서 사용할 수 있습니다.</p>
          )}
        </TeacherWisVillage>
      </main>
    </div>
  );
}
