import React from 'react';
import type { MapResource } from '../../lib/mapResources';

interface MapSidebarProps {
    heading: string;
    items: MapResource[];
    selectedId: string;
    onSelect: (id: string) => void;
    action?: React.ReactNode;
    headingAction?: React.ReactNode;
    renderItemAction?: (item: MapResource) => React.ReactNode;
    reorderMode?: boolean;
}

const getMapSidebarIcon = (item: MapResource) => {
    const normalizedTitle = String(item.title || '').trim();
    const normalizedGroup = String(item.tabGroup || '').trim();
    const normalizedCategory = String(item.category || '').trim();
    const source = `${normalizedTitle} ${normalizedGroup} ${normalizedCategory}`;

    if (source.includes('한국사')) {
        return <span className="text-base leading-none" aria-hidden="true">🇰🇷</span>;
    }
    if (source.includes('세계사')) {
        return <span className="text-base leading-none" aria-hidden="true">🌐</span>;
    }
    if (item.type === 'google' || source.includes('구글')) {
        return <span className="text-sm font-extrabold leading-none text-blue-600" aria-hidden="true">🅖</span>;
    }
    if (item.type === 'iframe') {
        return <i className="fas fa-window-maximize text-sm"></i>;
    }
    if (item.type === 'pdf') {
        return <i className="fas fa-file-pdf text-sm"></i>;
    }
    return <i className="fas fa-map text-sm"></i>;
};

const MapSidebar: React.FC<MapSidebarProps> = ({
    heading,
    items,
    selectedId,
    onSelect,
    action,
    headingAction,
    renderItemAction,
    reorderMode = false,
}) => {
    return (
        <aside className="w-full shrink-0 lg:w-72">
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm lg:sticky lg:top-8">
                <div className="flex items-center justify-between gap-3 border-b border-gray-100 p-4 sm:p-6">
                    <div className="flex items-center gap-2">
                        <h2 className="flex items-center gap-2 text-lg font-extrabold text-gray-800 sm:text-xl">
                            <i className="fas fa-map-marked-alt text-gray-400"></i>
                            {heading}
                        </h2>
                        {headingAction}
                    </div>
                    {action}
                </div>
                <nav className="flex gap-2 overflow-x-auto p-3 lg:flex-col lg:gap-0 lg:overflow-visible lg:p-0">
                    {items.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => onSelect(item.id)}
                            className={`flex min-w-[11rem] items-center gap-3 rounded-xl border p-3 text-left transition-colors lg:min-w-0 lg:rounded-none lg:border-0 lg:p-4 ${
                                selectedId === item.id
                                    ? 'border-blue-200 bg-blue-50 text-blue-600 lg:border-l-4 lg:border-blue-600'
                                    : 'border-gray-200 text-gray-600 hover:bg-gray-50 lg:border-l-4 lg:border-transparent'
                            }`}
                        >
                            {reorderMode ? (
                                <div className="w-4 text-center text-sm font-bold text-gray-300">
                                    =
                                </div>
                            ) : (
                                <div className="w-6 text-center">
                                    {getMapSidebarIcon(item)}
                                </div>
                            )}
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-bold">{item.title}</div>
                            </div>
                            {renderItemAction && (
                                <div className="ml-auto shrink-0">
                                    {renderItemAction(item)}
                                </div>
                            )}
                        </button>
                    ))}
                </nav>
            </div>
        </aside>
    );
};

export default MapSidebar;
