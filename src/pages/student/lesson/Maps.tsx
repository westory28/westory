import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import MapSidebar from '../../../components/common/MapSidebar';
import MapViewer from '../../../components/common/MapViewer';
import { useAuth } from '../../../contexts/AuthContext';
import { db } from '../../../lib/firebase';
import { mergeMapResources, normalizeMapResource, type MapResource } from '../../../lib/mapResources';
import { getSemesterCollectionPath } from '../../../lib/semesterScope';

const StudentMaps: React.FC = () => {
    const { config } = useAuth();
    const [items, setItems] = useState<MapResource[]>([]);
    const [selectedTabGroup, setSelectedTabGroup] = useState('');
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
                setSelectedTabGroup((prev) => prev || first?.tabGroup || first?.category || '');
                setSelectedId((prev) => prev || first?.id || '');
            } catch (error) {
                console.error('Failed to load map resources:', error);
                const fallback = mergeMapResources([]);
                const first = fallback[0] || null;
                setItems(fallback);
                setSelectedTabGroup((prev) => prev || first?.tabGroup || first?.category || '');
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
            const key = item.tabGroup || item.category || '기타 지도';
            const current = groups.get(key) || [];
            current.push(item);
            groups.set(key, current);
        });
        return groups;
    }, [items]);

    const tabGroupSidebarItems = useMemo<MapResource[]>(() => (
        Array.from(groupedItems.entries()).map(([tabGroup, group]) => ({
            ...group[0],
            id: `tab-group:${tabGroup}`,
            title: tabGroup,
            category: group[0]?.category || '',
            tabGroup,
        }))
    ), [groupedItems]);

    const currentTabGroup = selectedTabGroup || tabGroupSidebarItems[0]?.tabGroup || '';
    const currentTabItems = groupedItems.get(currentTabGroup) || [];
    const selectedItem = currentTabItems.find((item) => item.id === selectedId) || currentTabItems[0] || items[0] || null;

    useEffect(() => {
        if (!tabGroupSidebarItems.length) return;
        if (!currentTabGroup || !groupedItems.has(currentTabGroup)) {
            const nextGroup = tabGroupSidebarItems[0].tabGroup || '';
            setSelectedTabGroup(nextGroup);
            setSelectedId(groupedItems.get(nextGroup)?.[0]?.id || '');
        }
    }, [currentTabGroup, groupedItems, tabGroupSidebarItems]);

    useEffect(() => {
        if (!currentTabItems.length) return;
        if (!currentTabItems.some((item) => item.id === selectedId)) {
            setSelectedId(currentTabItems[0].id);
        }
    }, [currentTabItems, selectedId]);

    useEffect(() => {
        if (selectedItem?.type === 'google') {
            setGoogleSearchQuery(selectedItem.googleQuery || '');
        } else {
            setGoogleSearchQuery('');
        }
    }, [selectedItem?.googleQuery, selectedItem?.id, selectedItem?.type]);

    return (
        <div className="flex min-h-screen flex-col bg-gray-50">
            <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 p-6 lg:flex-row lg:p-10">
                <MapSidebar
                    heading="지도 탭"
                    items={tabGroupSidebarItems}
                    selectedId={`tab-group:${currentTabGroup}`}
                    onSelect={(tabGroupId) => {
                        const nextGroup = tabGroupId.replace(/^tab-group:/u, '');
                        setSelectedTabGroup(nextGroup);
                        setSelectedId(groupedItems.get(nextGroup)?.[0]?.id || '');
                    }}
                />

                <section className="min-w-0 flex-1 space-y-4">
                    {!loading && currentTabItems.length > 0 && (
                        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                            <div className="flex overflow-x-auto border-b border-gray-200">
                                {currentTabItems.map((item) => (
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
                        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-gray-400 shadow-sm">
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
