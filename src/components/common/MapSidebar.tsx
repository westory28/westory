import React from 'react';
import type { MapResource } from '../../lib/mapResources';

interface MapSidebarProps {
    heading: string;
    items: MapResource[];
    selectedId: string;
    onSelect: (id: string) => void;
    action?: React.ReactNode;
}

const MapSidebar: React.FC<MapSidebarProps> = ({ heading, items, selectedId, onSelect, action }) => {
    return (
        <aside className="w-full lg:w-72 shrink-0">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden lg:sticky lg:top-8">
                <div className="p-6 border-b border-gray-100 flex items-center justify-between gap-3">
                    <h2 className="text-xl font-extrabold text-gray-800 flex items-center gap-2">
                        <i className="fas fa-map-marked-alt text-gray-400"></i>
                        {heading}
                    </h2>
                    {action}
                </div>
                <nav className="flex flex-col">
                    {items.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => onSelect(item.id)}
                            className={`p-4 text-left transition-colors flex items-center gap-3 ${
                                selectedId === item.id
                                    ? 'bg-blue-50 text-blue-600 border-l-4 border-blue-600'
                                    : 'text-gray-600 hover:bg-gray-50 border-l-4 border-transparent'
                            }`}
                        >
                            <div className="w-6 text-center">
                                <i className={`fas ${item.type === 'google' ? 'fa-globe-asia' : item.type === 'iframe' ? 'fa-window-maximize' : 'fa-map'} text-sm`}></i>
                            </div>
                            <div className="min-w-0">
                                <div className="font-bold text-sm truncate">{item.title}</div>
                                <div className="text-[11px] text-gray-400 truncate">{item.category}</div>
                            </div>
                        </button>
                    ))}
                </nav>
            </div>
        </aside>
    );
};

export default MapSidebar;
