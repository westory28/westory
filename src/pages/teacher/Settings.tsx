import React, { useState } from "react";
import PortalWorkspace from "../../components/common/PortalWorkspace";
import TeacherSubNavigation from "./components/TeacherSubNavigation";
import TeacherNavigationIcon, {
  type TeacherIconName,
} from "../../components/layout/TeacherNavigationIcon";
import SettingsGeneral from "./components/SettingsGeneral";
import SettingsSchool from "./components/SettingsSchool";
import SettingsInterface from "./components/SettingsInterface";
import SettingsPrivacy from "./components/SettingsPrivacy";
import SettingsAccess from "./components/SettingsAccess";
import SettingsNotifications from "./components/SettingsNotifications";
import SettingsSemesterArchive from "./components/SettingsSemesterArchive";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import "./teacherSettings.css";

const SettingsMyPage = lazyWithRetry(
  () => import("./components/SettingsMyPage"),
  "teacher-my-page",
);
const SettingsAvatarPricing = lazyWithRetry(
  () => import("./components/SettingsAvatarPricing"),
  "teacher-avatar-pricing",
);

const settingSections = [
  { id: "my-page", label: "마이페이지", icon: "students" },
  { id: "general", label: "기본 환경 설정", icon: "sliders" },
  { id: "archive", label: "이전 학기 조회", icon: "history" },
  { id: "school", label: "학교/학년/학기", icon: "school" },
  { id: "interface", label: "인터페이스 설정", icon: "palette" },
  { id: "avatar-pricing", label: "아바타 가격 관리", icon: "wis" },
  { id: "access", label: "세부 권한 관리", icon: "access" },
  { id: "notifications", label: "알림 관리", icon: "bell" },
  { id: "privacy", label: "개인정보 동의 관리", icon: "privacy" },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  icon: TeacherIconName;
}>;

type SettingSection = (typeof settingSections)[number]["id"];

const Settings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingSection>("general");
  const [menuOpen, setMenuOpen] = useState(false);
  const activeSection = settingSections.find(({ id }) => id === activeTab)!;
  const selectSection = (section: SettingSection) => {
    setActiveTab(section);
    setMenuOpen(false);
  };

  return (
    <PortalWorkspace className="teacher-sub-workspace teacher-sub-workspace--page teacher-settings-workspace">
      <TeacherSubNavigation
        title="관리자 설정"
        activeLabel={activeSection.label}
        open={menuOpen}
        onOpenChange={setMenuOpen}
      >
        {settingSections.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            className={`teacher-settings-section${activeTab === id ? " is-active" : ""}`}
            aria-current={activeTab === id ? "page" : undefined}
            aria-controls="teacher-settings-content"
            onClick={() => selectSection(id)}
          >
            <TeacherNavigationIcon name={icon} />
            <span title={label}>{label}</span>
          </button>
        ))}
      </TeacherSubNavigation>

      <section
        id="teacher-settings-content"
        className="teacher-sub-content teacher-settings-content"
        aria-label={activeSection.label}
      >
        <h1 className="sr-only">관리자 설정 · {activeSection.label}</h1>
        {(activeTab === "my-page" || activeTab === "avatar-pricing") && (
          <React.Suspense
            fallback={<div role="status">화면을 불러오는 중입니다.</div>}
          >
            {activeTab === "my-page" ? (
              <SettingsMyPage />
            ) : (
              <SettingsAvatarPricing />
            )}
          </React.Suspense>
        )}
        {activeTab === "general" && (
          <SettingsGeneral onOpenArchive={() => selectSection("archive")} />
        )}
        {activeTab === "archive" && <SettingsSemesterArchive />}
        {activeTab === "school" && <SettingsSchool />}
        {activeTab === "interface" && <SettingsInterface />}
        {activeTab === "access" && <SettingsAccess />}
        {activeTab === "notifications" && <SettingsNotifications />}
        {activeTab === "privacy" && <SettingsPrivacy />}
      </section>
    </PortalWorkspace>
  );
};

export default Settings;
