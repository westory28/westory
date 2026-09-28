import React, { useRef, useState } from "react";
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
import "./teacherSettings.css";

const settingSections = [
  { id: "general", label: "기본 환경 설정", icon: "sliders" },
  { id: "archive", label: "이전 학기 조회", icon: "history" },
  { id: "school", label: "학교/학년/학기", icon: "school" },
  { id: "interface", label: "인터페이스 설정", icon: "palette" },
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
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const activeSection = settingSections.find(({ id }) => id === activeTab)!;
  const selectSection = (section: SettingSection) => {
    setActiveTab(section);
    setMenuOpen(false);
    if (menuOpen) menuToggleRef.current?.focus();
  };

  return (
    <div className="teacher-settings-workspace">
      <aside className="teacher-settings-navigation" aria-label="관리자 설정">
        <div className="teacher-settings-navigation-inner">
          <div className="teacher-settings-heading">
            <h1>관리자 설정</h1>
            <p>설정 메뉴</p>
          </div>
          <button
            ref={menuToggleRef}
            type="button"
            className="teacher-settings-menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="teacher-settings-sections"
            onClick={() => setMenuOpen((previous) => !previous)}
          >
            <TeacherNavigationIcon name={activeSection.icon} />
            <span>{activeSection.label}</span>
            <TeacherNavigationIcon
              name="chevron"
              className={menuOpen ? "is-open" : ""}
            />
            <span className="sr-only">
              설정 메뉴 {menuOpen ? "접기" : "펼치기"}
            </span>
          </button>
          <nav
            id="teacher-settings-sections"
            className={`teacher-settings-sections${menuOpen ? " is-open" : ""}`}
            aria-label="설정 메뉴"
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
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </aside>

      <section
        id="teacher-settings-content"
        className="teacher-settings-content"
        aria-label={activeSection.label}
      >
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
    </div>
  );
};

export default Settings;
