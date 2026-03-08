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
                <div className="flex items-center justify-between gap-3 border-b border-gray-100 p-6">
                    <div className="flex items-center gap-2">
                        <h2 className="flex items-center gap-2 text-xl font-extrabold text-gray-800">
                            <i className="fas fa-map-marked-alt text-gray-400"></i>
                            {heading}
                        </h2>
                        {headingAction}
                    </div>
                    {action}
                </div>
                <nav className="flex flex-col">
                    {items.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => onSelect(item.id)}
                            className={`flex items-center gap-3 p-4 text-left transition-colors ${
                                selectedId === item.id
                                    ? 'border-l-4 border-blue-600 bg-blue-50 text-blue-600'
                                    : 'border-l-4 border-transparent text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                            {reorderMode ? (
                                <div className="w-4 text-center text-sm font-bold text-gray-300">
                                    =
                                </div>
                            ) : (
                                <div className="w-6 text-center">
                                    <i
                                        className={`fas ${
                                            item.type === 'google'
                                                ? 'fa-globe-asia'
                                                : item.type === 'iframe'
                                                    ? 'fa-window-maximize'
                                                    : item.type === 'pdf'
                                                        ? 'fa-file-pdf'
                                                        : 'fa-map'
                                        } text-sm`}
                                    ></i>
                                </div>
                            )}
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-bold">{item.title}</div>
                                <div className="truncate text-[11px] text-gray-400">{item.category}</div>
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
