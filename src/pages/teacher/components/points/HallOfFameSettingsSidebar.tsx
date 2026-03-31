import React from 'react';

export type HallOfFameSettingsPanelId =
  | 'feature_settings'
  | 'student_view_settings';

export interface HallOfFameSettingsSidebarItem {
  id: HallOfFameSettingsPanelId;
  label: string;
  description: string;
  iconClassName: string;
  badge: string;
  meta: string;
}

interface HallOfFameSettingsSidebarProps {
  activePanel: HallOfFameSettingsPanelId;
  items: HallOfFameSettingsSidebarItem[];
  onSelect: (panelId: HallOfFameSettingsPanelId) => void;
}

const HallOfFameSettingsSidebar: React.FC<
  HallOfFameSettingsSidebarProps
> = ({ activePanel, items, onSelect }) => (
  <aside className="w-full shrink-0 lg:w-72">
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm lg:sticky lg:top-8">
      <div className="flex items-center gap-3 border-b border-gray-100 p-4 sm:p-6">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-700">
          <i className="fas fa-trophy text-sm" aria-hidden="true"></i>
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold text-gray-800">
            화랑의 전당 관리
          </h2>
          <p className="mt-0.5 text-xs font-medium text-gray-500">
            기능 설정 · 학생 화면 설정
          </p>
        </div>
      </div>

      <nav className="flex gap-2 overflow-x-auto p-3 lg:flex-col lg:gap-0 lg:overflow-visible lg:p-0">
        {items.map((item) => {
          const selected = activePanel === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={[
                'group flex min-w-[14rem] items-start gap-3 rounded-xl border p-3 text-left transition-colors lg:min-w-0 lg:rounded-none lg:border-0 lg:border-l-4 lg:p-4',
                selected
                  ? 'border-blue-200 bg-blue-50 text-blue-700 lg:border-blue-600'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 lg:border-transparent',
              ].join(' ')}
            >
              <div
                className={[
                  'mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-sm transition-colors',
                  selected
                    ? 'border-blue-100 bg-white text-blue-700'
                    : 'border-gray-200 bg-gray-50 text-gray-500 group-hover:bg-white',
                ].join(' ')}
              >
                <i className={item.iconClassName} aria-hidden="true"></i>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-bold">{item.label}</span>
                  <span
                    className={[
                      'rounded-full px-2 py-0.5 text-[10px] font-bold leading-none',
                      item.badge === '미저장'
                        ? selected
                          ? 'border border-amber-200 bg-white text-amber-700'
                          : 'bg-amber-50 text-amber-800'
                        : selected
                          ? 'border border-blue-100 bg-white text-blue-700'
                          : 'bg-gray-100 text-gray-600',
                    ].join(' ')}
                  >
                    {item.badge}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-gray-500">
                  {item.description}
                </p>
                <div
                  className={[
                    'mt-1.5 text-[11px] font-bold',
                    selected ? 'text-blue-600' : 'text-gray-400',
                  ].join(' ')}
                >
                  {item.meta}
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
