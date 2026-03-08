import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import MapSidebar from '../../../components/common/MapSidebar';
import MapViewer from '../../../components/common/MapViewer';
import { db } from '../../../lib/firebase';
import { getSemesterCollectionPath } from '../../../lib/semesterScope';
import { mergeMapResources, normalizeMapResource, type MapResource } from '../../../lib/mapResources';
import { useAuth } from '../../../contexts/AuthContext';

const StudentMaps: React.FC = () => {
    const { config } = useAuth();
    const [items, setItems] = useState<MapResource[]>([]);
    const [selectedCategory, setSelectedCategory] = useState('');
    const [selectedId, setSelectedId] = useState('');
    const [loading, setLoading] = useState(true);
    const [googleSearchQuery, setGoogleSearchQuery] = useState('');

    useEffect(() => {
        const loadMaps = async () => {
            setLoading(true);
            try {
                const scopedQuery = query(
                    collection(db, getSemesterCollectionPath(config, 'map_resources')),
                    orderBy('sortOrder', 'asc'),
                );
                let snap = await getDocs(scopedQuery);

                if (snap.empty) {
                    const legacyQuery = query(collection(db, 'map_resources'), orderBy('sortOrder', 'asc'));
                    snap = await getDocs(legacyQuery);
                }

                const resources = snap.docs.map((docSnap) => normalizeMapResource(docSnap.id, docSnap.data()));
                const merged = mergeMapResources(resources);
                const first = merged[0] || null;

                setItems(merged);
                setSelectedCategory((prev) => prev || first?.category || '');
                setSelectedId((prev) => prev || first?.id || '');
            } catch (error) {
                console.error('Failed to load map resources:', error);
                const fallback = mergeMapResources([]);
                const first = fallback[0] || null;
                setItems(fallback);
                setSelectedCategory((prev) => prev || first?.category || '');
                setSelectedId((prev) => prev || first?.id || '');
            } finally {
                setLoading(false);
            }
        };

        void loadMaps();
    }, [config]);

    const groupedItems = useMemo(() => {
        const groups = new Map<string, MapResource[]>();
        items.forEach((item) => {
            const current = groups.get(item.category) || [];
            current.push(item);
            groups.set(item.category, current);
        });
        return groups;
    }, [items]);

    const categorySidebarItems = useMemo<MapResource[]>(() => (
        Array.from(groupedItems.entries()).map(([category, group]) => ({
            ...group[0],
            id: `category:${category}`,
            title: category,
            category: group.length > 1 ? `${group.length}개 지도` : '지도 1개',
        }))
    ), [groupedItems]);

    const currentCategory = selectedCategory || categorySidebarItems[0]?.title || '';
    const currentCategoryItems = groupedItems.get(currentCategory) || [];
    const selectedItem = currentCategoryItems.find((item) => item.id === selectedId) || currentCategoryItems[0] || items[0] || null;

    useEffect(() => {
        if (!categorySidebarItems.length) return;
        if (!currentCategory || !groupedItems.has(currentCategory)) {
            const nextCategory = categorySidebarItems[0].title;
            setSelectedCategory(nextCategory);
            setSelectedId(groupedItems.get(nextCategory)?.[0]?.id || '');
        }
    }, [categorySidebarItems, currentCategory, groupedItems]);

    useEffect(() => {
        if (!selectedItem) return;
        if (selectedItem.category !== currentCategory) {
            setSelectedCategory(selectedItem.category);
        }
    }, [currentCategory, selectedItem]);

    useEffect(() => {
        if (!currentCategoryItems.length) return;
        if (!currentCategoryItems.some((item) => item.id === selectedId)) {
            setSelectedId(currentCategoryItems[0].id);
        }
    }, [currentCategoryItems, selectedId]);

    useEffect(() => {
        if (selectedItem?.type === 'google') {
            setGoogleSearchQuery(selectedItem.googleQuery || '');
        } else {
            setGoogleSearchQuery('');
        }
    }, [selectedItem?.googleQuery, selectedItem?.id, selectedItem?.type]);

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <main className="flex flex-col lg:flex-row flex-1 p-6 lg:p-10 gap-8 max-w-7xl mx-auto w-full">
                <MapSidebar
                    heading="지도"
                    items={categorySidebarItems}
                    selectedId={`category:${currentCategory}`}
                    onSelect={(categoryId) => {
                        const nextCategory = categoryId.replace(/^category:/u, '');
                        setSelectedCategory(nextCategory);
                        setSelectedId(groupedItems.get(nextCategory)?.[0]?.id || '');
                    }}
                />

                <section className="flex-1 min-w-0 space-y-4">
                    {!loading && currentCategoryItems.length > 0 && (
                        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                            <div className="flex overflow-x-auto border-b border-gray-200">
                                {currentCategoryItems.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => setSelectedId(item.id)}
                                        className={`shrink-0 border-b-2 px-5 py-4 text-sm font-bold transition ${
                                            selectedItem?.id === item.id
                                                ? 'border-blue-600 text-blue-600'
                                                : 'border-transparent text-gray-700 hover:bg-gray-50'
                                        }`}
                                    >
                                        {item.title}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {loading ? (
                        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center text-gray-400">
                            <i className="fas fa-spinner fa-spin text-2xl"></i>
                            <p className="mt-3">지도를 불러오는 중입니다.</p>
                        </div>
                    ) : (
                        <MapViewer
                            item={selectedItem}
                            googleSearchQuery={selectedItem?.type === 'google' ? googleSearchQuery : undefined}
                            onGoogleSearchQueryChange={selectedItem?.type === 'google' ? setGoogleSearchQuery : undefined}
                        />
                    )}
                </section>
            </main>
        </div>
    );
};

export default StudentMaps;
