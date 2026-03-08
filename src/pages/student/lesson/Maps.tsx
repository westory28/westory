import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import MapSidebar from '../../../components/common/MapSidebar';
import MapViewer from '../../../components/common/MapViewer';
import { useAuth } from '../../../contexts/AuthContext';
import { db } from '../../../lib/firebase';
import {
    groupMapResourcesForDisplay,
    getGoogleMapsExternalUrl,
    mergeMapResources,
    normalizeMapResource,
    type MapResource,
} from '../../../lib/mapResources';
import { getSemesterCollectionPath } from '../../../lib/semesterScope';

const StudentMaps: React.FC = () => {
    const { config } = useAuth();
    const [items, setItems] = useState<MapResource[]>([]);
    const [selectedGroupKey, setSelectedGroupKey] = useState('');
    const [selectedId, setSelectedId] = useState('');
    const [loading, setLoading] = useState(true);
    const [googleSearchQuery, setGoogleSearchQuery] = useState('');

    const displayGroups = useMemo(() => groupMapResourcesForDisplay(items), [items]);
    const groupMap = useMemo(
        () => new Map(displayGroups.map((group) => [group.key, group])),
        [displayGroups],
    );

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
                const firstGroup = groupMapResourcesForDisplay(merged)[0] || null;

                setItems(merged);
                setSelectedGroupKey((prev) => prev || firstGroup?.key || '');
                setSelectedId((prev) => prev || firstGroup?.items[0]?.id || '');
            } catch (error) {
                console.error('Failed to load map resources:', error);
                const fallback = mergeMapResources([]);
                const firstGroup = groupMapResourcesForDisplay(fallback)[0] || null;
                setItems(fallback);
                setSelectedGroupKey((prev) => prev || firstGroup?.key || '');
                setSelectedId((prev) => prev || firstGroup?.items[0]?.id || '');
            } finally {
                setLoading(false);
            }
        };

        void loadMaps();
    }, [config]);

    const sidebarItems = useMemo<MapResource[]>(() => (
        displayGroups.map((group) => ({
            ...group.representative,
            id: `map-group:${group.key}`,
            title: group.title,
        }))
    ), [displayGroups]);

    const currentGroup = groupMap.get(selectedGroupKey) || displayGroups[0] || null;
    const currentTabItems = currentGroup?.items || [];
    const selectedItem = currentTabItems.find((item) => item.id === selectedId) || currentTabItems[0] || items[0] || null;

    useEffect(() => {
        if (!displayGroups.length) return;
        if (!currentGroup) {
            const nextGroup = displayGroups[0];
            setSelectedGroupKey(nextGroup.key);
            setSelectedId(nextGroup.items[0]?.id || '');
        }
    }, [currentGroup, displayGroups]);

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

    const externalUrl = selectedItem?.type === 'google'
        ? (selectedItem.externalUrl || getGoogleMapsExternalUrl(googleSearchQuery || selectedItem.googleQuery || ''))
        : (selectedItem?.externalUrl || selectedItem?.fileUrl || '');

    return (
        <div className="flex min-h-screen flex-col bg-gray-50">
            <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 p-6 lg:flex-row lg:p-10">
                <MapSidebar
                    heading="지도"
                    items={sidebarItems}
                    selectedId={`map-group:${currentGroup?.key || ''}`}
                    onSelect={(groupId) => {
                        const nextGroupKey = groupId.replace(/^map-group:/u, '');
                        const nextGroup = groupMap.get(nextGroupKey);
                        setSelectedGroupKey(nextGroupKey);
                        setSelectedId(nextGroup?.items[0]?.id || '');
                    }}
                />

                <section className="min-w-0 flex-1">
                    {loading ? (
                        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-gray-400 shadow-sm">
                            <i className="fas fa-spinner fa-spin text-2xl"></i>
                            <p className="mt-3">지도를 불러오는 중입니다.</p>
                        </div>
                    ) : selectedItem ? (
                        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                            <div className="border-b border-gray-100 p-8 pb-4">
                                <div className="flex flex-wrap items-start justify-between gap-4">
                                    <div>
                                        <div className="mb-3 inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                                            {selectedItem.category}
                                        </div>
                                        <h1 className="text-2xl font-extrabold text-gray-900">
                                            {currentGroup?.title || selectedItem.title}
                                        </h1>
                                    </div>
                                    {externalUrl && (
                                        <a
                                            href={externalUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
                                        >
                                            <i className="fas fa-up-right-from-square"></i>
                                            새 창에서 열기
                                        </a>
                                    )}
                                </div>
                            </div>

                            {currentTabItems.length > 0 && (
                                <div className="border-b border-gray-100 px-6">
                                    <div className="flex overflow-x-auto">
                                        {currentTabItems.map((item) => (
                                            <button
                                                key={item.id}
                                                type="button"
                                                onClick={() => setSelectedId(item.id)}
                                                className={`shrink-0 border-b-2 px-4 py-4 text-sm font-bold transition ${
                                                    selectedItem.id === item.id
                                                        ? 'border-blue-600 text-blue-600'
                                                        : 'border-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                                }`}
                                            >
                                                {item.title}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="bg-gray-50 p-4 md:p-6">
                                <MapViewer
                                    item={selectedItem}
                                    googleSearchQuery={selectedItem.type === 'google' ? googleSearchQuery : undefined}
                                    onGoogleSearchQueryChange={selectedItem.type === 'google' ? setGoogleSearchQuery : undefined}
                                    showShell={false}
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-gray-500 shadow-sm">
                            지도를 선택해 주세요.
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
};

export default StudentMaps;
