import React from "react";

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
}) => (
  <aside className="w-full shrink-0 lg:w-72">
    <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm lg:sticky lg:top-6">
      <div className="border-b border-gray-100 px-4 py-4 sm:px-5">
        <div className="flex items-center gap-2">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-700">
            <i className="fas fa-sliders-h text-sm" aria-hidden="true"></i>
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">
              등급 설정 패널
            </h2>
          </div>
        </div>
      </div>

      <nav className="flex gap-2 overflow-x-auto p-3 lg:flex-col lg:gap-1 lg:overflow-visible lg:p-2">
        {items.map((item) => {
          const selected = activePanel === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={[
                "min-w-[11rem] rounded-2xl border px-4 py-3 text-left transition lg:min-w-0",
                selected
                  ? "border-blue-200 bg-blue-50 text-blue-700 shadow-sm"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
              ].join(" ")}
            >
              <div className="flex items-start gap-3">
                <div
                  className={[
                    "mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-sm",
                    selected
                      ? "border-blue-200 bg-white text-blue-700"
                      : "border-gray-200 bg-gray-50 text-gray-500",
                  ].join(" ")}
                >
                  <i className={item.iconClassName} aria-hidden="true"></i>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold">{item.label}</span>
                    {item.badge && (
                      <span
                        className={[
                          "rounded-full px-2 py-0.5 text-[10px] font-bold leading-none",
                          selected
                            ? "bg-white text-blue-700"
                            : "bg-gray-100 text-gray-600",
                        ].join(" ")}
                      >
                        {item.badge}
                      </span>
                    )}
                  </div>
                  {item.description && (
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      {item.description}
                    </p>
                  )}
                  {item.meta && (
                    <div className="mt-1.5 text-[11px] font-bold text-gray-400">
                      {item.meta}
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </nav>
    </div>
  </aside>
);

export default RankSettingsSidebar;
