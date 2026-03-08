import React, { useEffect, useState } from 'react';
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
                setItems(merged);
                setSelectedId((prev) => prev || merged[0]?.id || '');
            } catch (error) {
                console.error('Failed to load map resources:', error);
                const fallback = mergeMapResources([]);
                setItems(fallback);
                setSelectedId((prev) => prev || fallback[0]?.id || '');
            } finally {
                setLoading(false);
            }
        };

        void loadMaps();
    }, [config]);

    const selectedItem = items.find((item) => item.id === selectedId) || items[0] || null;

    useEffect(() => {
        if (selectedItem?.type === 'google') {
            setGoogleSearchQuery(selectedItem.googleQuery || '');
        } else {
            setGoogleSearchQuery('');
        }
    }, [selectedItem?.id, selectedItem?.type, selectedItem?.googleQuery]);

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <main className="flex flex-col lg:flex-row flex-1 p-6 lg:p-10 gap-8 max-w-7xl mx-auto w-full">
                <MapSidebar
                    heading="지도 자료"
                    items={items}
                    selectedId={selectedItem?.id || ''}
                    onSelect={setSelectedId}
                />

                <section className="flex-1 min-w-0">
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
