import React, { useState } from "react";
import TeacherSubNavigation from "../TeacherSubNavigation";

export type RankSettingsPanelId =
  | "theme_preview"
  | "rank_settings"
  | "emoji_collection";

export interface RankSettingsSidebarItem {
  id: RankSettingsPanelId;
  label: string;
  description?: string;
  iconClassName: string;
  badge?: string;
  meta?: string;
}

interface RankSettingsSidebarProps {
  activePanel: RankSettingsPanelId;
  items: RankSettingsSidebarItem[];
  onSelect: (panelId: RankSettingsPanelId) => void;
}

const RankSettingsSidebar: React.FC<RankSettingsSidebarProps> = ({
  activePanel,
  items,
  onSelect,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const activeItem = items.find((item) => item.id === activePanel);

  return (
    <TeacherSubNavigation
      title="등급 관리"
      activeLabel={activeItem?.label || "등급 관리"}
      open={menuOpen}
      onOpenChange={setMenuOpen}
    >
      {items.map((item) => {
        const selected = activePanel === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              onSelect(item.id);
              setMenuOpen(false);
            }}
            className={`teacher-settings-section${selected ? " is-active" : ""}`}
            aria-current={selected ? "page" : undefined}
          >
            <i
              className={`${item.iconClassName} w-5 shrink-0 text-center`}
              aria-hidden="true"
            ></i>
            <span className="min-w-0 flex-1" title={item.label}>
              {item.label}
            </span>
            {item.badge === "미저장" && (
              <span className="shrink-0 text-xs font-semibold text-amber-800">
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </TeacherSubNavigation>
  );
};

export default RankSettingsSidebar;
