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

type StorageScope = 'semester' | 'legacy';

type StoredMapResource = MapResource & {
    storageScope?: StorageScope;
};

const createDraft = (): StoredMapResource => ({
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
    storageScope: 'semester',
});

const normalizeErrorMessage = (error: unknown) => {
    const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: string }).code || '') : '';
    const message = typeof error === 'object' && error && 'message' in error ? String((error as { message?: string }).message || '') : '';
    if (code) return `${code}${message ? `: ${message}` : ''}`;
    return message || 'unknown-error';
};

const ManageMaps: React.FC = () => {
    const { config } = useAuth();
    const [items, setItems] = useState<StoredMapResource[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [draft, setDraft] = useState<StoredMapResource>(createDraft());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const collectionPath = useMemo(() => getSemesterCollectionPath(config, 'map_resources'), [config]);
    const legacyCollectionPath = 'map_resources';

    const loadFromScope = async (scope: StorageScope): Promise<StoredMapResource[]> => {
        const path = scope === 'semester' ? collectionPath : legacyCollectionPath;
        const ref = collection(db, path);
        const snapshot = await getDocs(query(ref, orderBy('sortOrder', 'asc')));
        return snapshot.docs.map((docSnap) => ({
            ...normalizeMapResource(docSnap.id, docSnap.data()),
            storageScope: scope,
        }));
    };

    useEffect(() => {
        const loadMaps = async () => {
            setLoading(true);
            try {
                let resourceList = await loadFromScope('semester');
                if (resourceList.length === 0) {
                    resourceList = await loadFromScope('legacy');
                }

                const baseScope: StorageScope = resourceList[0]?.storageScope || 'semester';
                const merged = mergeMapResources(resourceList).map((item) => {
                    const existing = resourceList.find((resource) => resource.id === item.id);
                    return {
                        ...item,
                        storageScope: existing?.storageScope || baseScope,
                    };
                });

                setItems(merged);
                const initial = merged[0] || { ...DEFAULT_GOOGLE_MAP_RESOURCE, storageScope: baseScope };
                setSelectedId(initial.id);
                setDraft(initial);
            } catch (error) {
                console.error('Failed to load teacher map resources:', error);
                const fallback = [{ ...DEFAULT_GOOGLE_MAP_RESOURCE, storageScope: 'semester' as const }];
                setItems(fallback);
                setSelectedId(fallback[0].id);
                setDraft(fallback[0]);
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
        setSelectedId('');
        setDraft(createDraft());
    };

    const persistToScope = async (scope: StorageScope, payload: MapResource) => {
        const path = scope === 'semester' ? collectionPath : legacyCollectionPath;
        await setDoc(doc(db, `${path}/${payload.id}`), {
            ...payload,
            updatedAt: serverTimestamp(),
        }, { merge: true });
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
            const preferredScope: StorageScope = draft.storageScope || 'semester';
            const fallbackScope: StorageScope = preferredScope === 'semester' ? 'legacy' : 'semester';
            let resolvedScope = preferredScope;

            try {
                await persistToScope(preferredScope, payload);
            } catch (primaryError) {
                console.error(`Failed to save map resource to ${preferredScope}:`, primaryError);
                await persistToScope(fallbackScope, payload);
                resolvedScope = fallbackScope;
            }

            const merged = mergeMapResources([
                ...items.filter((item) => item.id !== payload.id),
                { ...payload, storageScope: resolvedScope },
            ]).map((item) => {
                const existing = items.find((resource) => resource.id === item.id);
                if (item.id === payload.id) return { ...item, storageScope: resolvedScope };
                return { ...item, storageScope: existing?.storageScope || resolvedScope };
            });

            setItems(merged);
            setSelectedId(payload.id);
            setDraft({ ...payload, storageScope: resolvedScope });
            alert(resolvedScope === preferredScope
                ? '지도 자료를 저장했습니다.'
                : '지도 자료를 저장했습니다. 학기 범위 경로 대신 기본 컬렉션에 저장되었습니다.');
        } catch (error) {
            console.error('Failed to save map resource:', error);
            alert(`지도 자료 저장에 실패했습니다.\n${normalizeErrorMessage(error)}`);
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
            const preferredScope: StorageScope = draft.storageScope || 'semester';
            const fallbackScope: StorageScope = preferredScope === 'semester' ? 'legacy' : 'semester';
            const primaryPath = preferredScope === 'semester' ? collectionPath : legacyCollectionPath;
            const fallbackPath = fallbackScope === 'semester' ? collectionPath : legacyCollectionPath;

            try {
                await deleteDoc(doc(db, `${primaryPath}/${draft.id}`));
            } catch (primaryError) {
                console.error(`Failed to delete map resource from ${primaryPath}:`, primaryError);
                await deleteDoc(doc(db, `${fallbackPath}/${draft.id}`));
            }

            const nextItems = mergeMapResources(items.filter((item) => item.id !== draft.id)).map((item) => {
                const existing = items.find((resource) => resource.id === item.id);
                return { ...item, storageScope: existing?.storageScope || 'semester' };
            });
            setItems(nextItems);
            setSelectedId(nextItems[0]?.id || '');
            setDraft(nextItems[0] || createDraft());
        } catch (error) {
            console.error('Failed to delete map resource:', error);
            alert(`지도 자료 삭제에 실패했습니다.\n${normalizeErrorMessage(error)}`);
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
                            <MapViewer
                                item={selectedPreview}
                                googleSearchQuery={draft.type === 'google' ? (draft.googleQuery || '') : undefined}
                                onGoogleSearchQueryChange={draft.type === 'google'
                                    ? (value) => handleDraftChange('googleQuery', value)
                                    : undefined}
                            />

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
