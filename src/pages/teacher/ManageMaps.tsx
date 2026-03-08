import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import MapSidebar from '../../components/common/MapSidebar';
import MapViewer from '../../components/common/MapViewer';
import { db } from '../../lib/firebase';
import { getSemesterCollectionPath } from '../../lib/semesterScope';
import {
    DEFAULT_GOOGLE_MAP_RESOURCE,
    GOOGLE_MAP_RESOURCE_ID,
    mergeMapResources,
    normalizeMapResource,
    type MapResource,
    type MapResourceType,
} from '../../lib/mapResources';
import { useAuth } from '../../contexts/AuthContext';

const createDraft = (): MapResource => ({
    id: '',
    title: '',
    category: '',
    description: '',
    type: 'image',
    imageUrl: '',
    embedUrl: '',
    googleQuery: '',
    externalUrl: '',
    sortOrder: 99,
});

const ManageMaps: React.FC = () => {
    const { config } = useAuth();
    const [items, setItems] = useState<MapResource[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [draft, setDraft] = useState<MapResource>(createDraft());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const collectionPath = useMemo(() => getSemesterCollectionPath(config, 'map_resources'), [config]);

    useEffect(() => {
        const loadMaps = async () => {
            setLoading(true);
            try {
                const scopedRef = collection(db, collectionPath);
                const scopedQuery = query(scopedRef, orderBy('sortOrder', 'asc'));
                const snap = await getDocs(scopedQuery);
                const resourceList = snap.docs.map((docSnap) => normalizeMapResource(docSnap.id, docSnap.data()));

                if (!resourceList.some((item) => item.id === GOOGLE_MAP_RESOURCE_ID)) {
                    await setDoc(doc(db, `${collectionPath}/${GOOGLE_MAP_RESOURCE_ID}`), {
                        ...DEFAULT_GOOGLE_MAP_RESOURCE,
                        updatedAt: serverTimestamp(),
                    }, { merge: true });
                    resourceList.unshift(DEFAULT_GOOGLE_MAP_RESOURCE);
                }

                const merged = mergeMapResources(resourceList);
                setItems(merged);
                const initial = merged[0] || DEFAULT_GOOGLE_MAP_RESOURCE;
                setSelectedId(initial.id);
                setDraft(initial);
            } catch (error) {
                console.error('Failed to load teacher map resources:', error);
                const fallback = mergeMapResources([DEFAULT_GOOGLE_MAP_RESOURCE]);
                setItems(fallback);
                setSelectedId(fallback[0]?.id || '');
                setDraft(fallback[0] || createDraft());
            } finally {
                setLoading(false);
            }
        };

        void loadMaps();
    }, [collectionPath]);

    useEffect(() => {
        const next = items.find((item) => item.id === selectedId);
        if (next) {
            setDraft(next);
        }
    }, [items, selectedId]);

    const handleDraftChange = (field: keyof MapResource, value: string | number) => {
        setDraft((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const handleCreateNew = () => {
        const next = createDraft();
        setSelectedId('');
        setDraft(next);
    };

    const handleSave = async () => {
        const payload = normalizeMapResource(draft.id || `map-${Date.now()}`, draft);
        if (!payload.title || !payload.category) {
            alert('지도 제목과 분류를 입력해 주세요.');
            return;
        }
        if (payload.type === 'image' && !payload.imageUrl) {
            alert('이미지 지도는 이미지 URL이 필요합니다.');
            return;
        }
        if (payload.type === 'iframe' && !payload.embedUrl) {
            alert('임베드 지도는 iframe URL이 필요합니다.');
            return;
        }
        if (payload.type === 'google' && !payload.googleQuery) {
            alert('Google 지도는 검색어를 입력해 주세요.');
            return;
        }

        setSaving(true);
        try {
            await setDoc(doc(db, `${collectionPath}/${payload.id}`), {
                ...payload,
                updatedAt: serverTimestamp(),
            }, { merge: true });

            const merged = mergeMapResources([
                ...items.filter((item) => item.id !== payload.id),
                payload,
            ]);
            setItems(merged);
            setSelectedId(payload.id);
            setDraft(payload);
            alert('지도 자료를 저장했습니다.');
        } catch (error) {
            console.error('Failed to save map resource:', error);
            alert('지도 자료 저장에 실패했습니다.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!draft.id) return;
        if (draft.id === GOOGLE_MAP_RESOURCE_ID) {
            alert('구글 지도 기본 항목은 삭제할 수 없습니다.');
            return;
        }
        if (!window.confirm(`'${draft.title}' 지도를 삭제하시겠습니까?`)) return;

        try {
            await deleteDoc(doc(db, `${collectionPath}/${draft.id}`));
            const nextItems = mergeMapResources(items.filter((item) => item.id !== draft.id));
            setItems(nextItems);
            setSelectedId(nextItems[0]?.id || '');
            setDraft(nextItems[0] || createDraft());
        } catch (error) {
            console.error('Failed to delete map resource:', error);
            alert('지도 자료 삭제에 실패했습니다.');
        }
    };

    const selectedPreview = draft.id ? draft : null;

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <main className="flex flex-col lg:flex-row flex-1 p-6 lg:p-10 gap-8 max-w-7xl mx-auto w-full">
                <MapSidebar
                    heading="지도 관리"
                    items={items}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    action={(
                        <button
                            type="button"
                            onClick={handleCreateNew}
                            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
                        >
                            <i className="fas fa-plus"></i>
                            추가
                        </button>
                    )}
                />

                <section className="flex-1 min-w-0 space-y-6">
                    {loading ? (
                        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center text-gray-400">
                            <i className="fas fa-spinner fa-spin text-2xl"></i>
                            <p className="mt-3">지도를 불러오는 중입니다.</p>
                        </div>
                    ) : (
                        <>
                            <MapViewer item={selectedPreview} />

                            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 md:p-8">
                                <div className="flex items-center justify-between gap-3 mb-6">
                                    <h2 className="text-xl font-extrabold text-gray-900">지도 편집</h2>
                                    <div className="flex gap-2">
                                        {draft.id && (
                                            <button
                                                type="button"
                                                onClick={handleDelete}
                                                className="rounded-lg border border-red-200 px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50"
                                            >
                                                삭제
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => void handleSave()}
                                            disabled={saving}
                                            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                                        >
                                            {saving ? '저장 중...' : '저장'}
                                        </button>
                                    </div>
                                </div>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">지도 제목</label>
                                        <input
                                            type="text"
                                            value={draft.title}
                                            onChange={(e) => handleDraftChange('title', e.target.value)}
                                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                            placeholder="예: 동북아시아 지도"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">분류</label>
                                        <input
                                            type="text"
                                            value={draft.category}
                                            onChange={(e) => handleDraftChange('category', e.target.value)}
                                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                            placeholder="예: 세계 지도"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">지도 유형</label>
                                        <select
                                            value={draft.type}
                                            onChange={(e) => handleDraftChange('type', e.target.value as MapResourceType)}
                                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                                        >
                                            <option value="image">이미지</option>
                                            <option value="iframe">임베드 iframe</option>
                                            <option value="google">Google 지도</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">정렬 순서</label>
                                        <input
                                            type="number"
                                            value={draft.sortOrder}
                                            onChange={(e) => handleDraftChange('sortOrder', Number(e.target.value) || 0)}
                                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                        />
                                    </div>
                                </div>

                                <div className="mt-4">
                                    <label className="block text-xs font-bold text-gray-500 mb-1">설명</label>
                                    <textarea
                                        value={draft.description}
                                        onChange={(e) => handleDraftChange('description', e.target.value)}
                                        rows={4}
                                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                        placeholder="학생이 지도를 볼 때 함께 표시할 설명을 입력하세요."
                                    />
                                </div>

                                {draft.type === 'image' && (
                                    <div className="mt-4">
                                        <label className="block text-xs font-bold text-gray-500 mb-1">이미지 URL</label>
                                        <input
                                            type="text"
                                            value={draft.imageUrl || ''}
                                            onChange={(e) => handleDraftChange('imageUrl', e.target.value)}
                                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                            placeholder="https://..."
                                        />
                                    </div>
                                )}

                                {draft.type === 'iframe' && (
                                    <div className="mt-4">
                                        <label className="block text-xs font-bold text-gray-500 mb-1">iframe URL</label>
                                        <input
                                            type="text"
                                            value={draft.embedUrl || ''}
                                            onChange={(e) => handleDraftChange('embedUrl', e.target.value)}
                                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                            placeholder="https://..."
                                        />
                                    </div>
                                )}

                                {draft.type === 'google' && (
                                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-1">Google 지도 검색어</label>
                                            <input
                                                type="text"
                                                value={draft.googleQuery || ''}
                                                onChange={(e) => handleDraftChange('googleQuery', e.target.value)}
                                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                                placeholder="예: 대한민국 서울 경복궁"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-1">외부 링크</label>
                                            <input
                                                type="text"
                                                value={draft.externalUrl || ''}
                                                onChange={(e) => handleDraftChange('externalUrl', e.target.value)}
                                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                                placeholder="https://www.google.com/maps"
                                            />
                                        </div>
                                        <p className="md:col-span-2 text-xs leading-6 text-gray-500">
                                            Google 지도 iframe은 `VITE_GOOGLE_MAPS_EMBED_API_KEY`가 설정된 경우에만 화면에 표시됩니다.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </section>
            </main>
        </div>
    );
};

export default ManageMaps;
