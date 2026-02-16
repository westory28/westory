import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import LessonSidebar from './components/LessonSidebar';
import LessonContent from './components/LessonContent';

const Note: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    const unitId = searchParams.get('id');
    const title = searchParams.get('title');

    const handleSelectUnit = (newUnitId: string, newTitle: string) => {
        setSearchParams({ id: newUnitId, title: newTitle });
        setIsSidebarOpen(false);
    };

    return (
        <div className="flex h-full bg-gray-50 overflow-hidden relative">
            <LessonSidebar
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                onSelectUnit={handleSelectUnit}
                selectedUnitId={unitId}
            />

            <main className="flex-1 w-full relative flex flex-col h-[calc(100vh-64px)] overflow-hidden">
                <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scroll">
                    <LessonContent unitId={unitId} fallbackTitle={title} />
                </div>

                {/* Mobile FAB to toggle sidebar */}
                <button
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className="lg:hidden absolute bottom-6 left-6 w-12 h-12 bg-gray-800 text-white rounded-full shadow-lg flex items-center justify-center z-20 hover:bg-gray-700 transition"
                >
                    <i className="fas fa-list"></i>
                </button>
            </main>
        </div>
    );
};

export default Note;
