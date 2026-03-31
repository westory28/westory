import React from 'react';

export type HallOfFameSettingsPanelId =
  | 'feature_settings'
  | 'student_view_settings';

export interface HallOfFameSettingsSidebarItem {
  id: HallOfFameSettingsPanelId;
  label: string;
  iconClassName: string;
}

interface HallOfFameSettingsSidebarProps {
  activePanel: HallOfFameSettingsPanelId;
  items: HallOfFameSettingsSidebarItem[];
  onSelect: (panelId: HallOfFameSettingsPanelId) => void;
}

const HallOfFameSettingsSidebar: React.FC<
  HallOfFameSettingsSidebarProps
> = ({ activePanel, items, onSelect }) => (
  <aside className="w-full shrink-0 lg:w-64">
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm lg:sticky lg:top-8">
      <div className="flex items-center gap-3 border-b border-gray-100 p-4 sm:p-6">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-700">
          <i className="fas fa-trophy text-sm" aria-hidden="true"></i>
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold text-gray-800">
            화랑의 전당 관리
          </h2>
        </div>
      </div>

      <nav className="flex gap-2 overflow-x-auto p-3 lg:flex-col lg:gap-1 lg:overflow-visible lg:p-3">
        {items.map((item) => {
          const selected = activePanel === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={[
                'group flex min-w-[10.5rem] items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors lg:min-w-0 lg:px-4',
                selected
                  ? 'border-blue-200 bg-blue-50 text-blue-700 shadow-sm'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
              ].join(' ')}
            >
              <div
                className={[
                  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-sm transition-colors',
                  selected
                    ? 'border-blue-100 bg-white text-blue-700'
                    : 'border-gray-200 bg-gray-50 text-gray-500 group-hover:bg-white',
                ].join(' ')}
              >
                <i className={item.iconClassName} aria-hidden="true"></i>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="block whitespace-nowrap break-keep text-sm font-bold">
                    {item.label}
                  </span>
                  <span
                    className={[
                      'inline-flex h-2.5 w-2.5 shrink-0 rounded-full transition-colors',
                      selected ? 'bg-blue-600' : 'bg-gray-200',
                    ].join(' ')}
                    aria-hidden="true"
                  />
                </div>
              </div>
            </button>
          );
        })}
      </nav>
    </div>
  </aside>
);

export default HallOfFameSettingsSidebar;
