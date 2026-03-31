import React, { useEffect, useMemo, useState } from 'react';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import WisHallOfFameLeaderboardList from '../../../../components/common/WisHallOfFameLeaderboardList';
import WisHallOfFamePodium from '../../../../components/common/WisHallOfFamePodium';
import WisHallOfFamePositionEditor, {
    type HallOfFameEditorDeviceMode,
    type WisHallOfFamePositionEditorValue,
} from '../../../../components/common/WisHallOfFamePositionEditor';
import { useAppToast } from '../../../../components/common/AppToastProvider';
import { storage } from '../../../../lib/firebase';
import { formatPointDateShortTime } from '../../../../lib/pointFormatters';
import {
    applyHallOfFameRankLimit,
    DEFAULT_WIS_HALL_OF_FAME_PODIUM_IMAGE_URL,
    ensureWisHallOfFameSnapshot,
    getDefaultHallOfFameLeaderboardPanelPosition,
    getDefaultHallOfFamePositions,
    getHallOfFameLeaderboardTailEntries,
    getWisHallOfFameClassEntries,
    getWisHallOfFameClassLeaderboardEntries,
    getWisHallOfFameGradeEntries,
    getWisHallOfFameGradeLeaderboardEntries,
    getWisHallOfFameSnapshot,
    resolveHallOfFameInterfaceConfig,
    saveWisHallOfFameConfig,
} from '../../../../lib/wisHallOfFame';
import type { HallOfFameInterfaceConfig, InterfaceConfig, SystemConfig, WisHallOfFameSnapshot } from '../../../../types';

interface HallOfFameManagementTabProps {
    config: SystemConfig | null;
    interfaceConfig?: InterfaceConfig | null;
    canManage: boolean;
    onInterfaceConfigRefresh?: () => Promise<void>;
}

type PreviewScope = 'grade' | 'class';
type DraftConfig = ReturnType<typeof resolveHallOfFameInterfaceConfig>;

const createDraft = (config?: HallOfFameInterfaceConfig | null): DraftConfig => resolveHallOfFameInterfaceConfig(config);

const parseClassKey = (value: string) => {
    const [grade = '', className = ''] = String(value || '').split('-');
    return { grade, className };
};

const buildRailStyle = (panel: { leftPercent: number; topPercent: number; widthPercent: number }) => ({
    width: `${Math.min(100, Math.max(40, Number(panel.widthPercent || 100)))}%`,
    marginLeft: `${Math.max(0, Number(panel.leftPercent || 50) - (Number(panel.widthPercent || 100) / 2))}%`,
    marginTop: `${Math.min(100, Math.max(0, Number(panel.topPercent || 0)))}%`,
}) satisfies React.CSSProperties;

const loadImageElement = (file: File) => new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
    };
    image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('화랑의 전당 배경 이미지를 읽지 못했습니다.'));
    };
    image.src = objectUrl;
});

const buildResizedImageBlob = async (file: File, maxSize: number, quality: number) => {
    const image = await loadImageElement(file);
    const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('화랑의 전당 배경 캔버스를 준비하지 못했습니다.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('화랑의 전당 배경 이미지를 압축하지 못했습니다.'));
                return;
            }
            resolve(blob);
        }, 'image/jpeg', quality);
    });
};

const HallOfFameManagementTab: React.FC<HallOfFameManagementTabProps> = ({
    config,
    interfaceConfig,
    canManage,
    onInterfaceConfigRefresh,
}) => {
    const { showToast } = useAppToast();
    const [snapshot, setSnapshot] = useState<WisHallOfFameSnapshot | null>(null);
    const [snapshotError, setSnapshotError] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [scope, setScope] = useState<PreviewScope>('grade');
    const [deviceMode, setDeviceMode] = useState<HallOfFameEditorDeviceMode>('desktop');
    const [gradeKey, setGradeKey] = useState('');
    const [classKey, setClassKey] = useState('');
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreviewUrl, setImagePreviewUrl] = useState('');
    const [draft, setDraft] = useState<DraftConfig>(() => createDraft(interfaceConfig?.hallOfFame));

    useEffect(() => {
        setDraft(createDraft(interfaceConfig?.hallOfFame));
    }, [interfaceConfig?.hallOfFame]);

    useEffect(() => () => {
        if (imagePreviewUrl.startsWith('blob:')) URL.revokeObjectURL(imagePreviewUrl);
    }, [imagePreviewUrl]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            if (!config) {
                setLoading(false);
                return;
            }
            setLoading(true);
            setSnapshotError('');
            try {
                const nextSnapshot = await getWisHallOfFameSnapshot(config);
                if (!cancelled) setSnapshot(nextSnapshot);
            } catch (error) {
                console.warn('Failed to load hall of fame snapshot for teacher management:', error);
                if (!cancelled) {
                    setSnapshot(null);
                    setSnapshotError('공개 스냅샷을 읽지 못했습니다. 그래도 위스 관리 본체는 계속 사용할 수 있습니다.');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [config]);

    const gradeOptions = useMemo(() => Array.from(new Set([
        ...Object.keys(snapshot?.gradeLeaderboardByGrade || {}),
        ...Object.keys(snapshot?.gradeTop3ByGrade || {}),
    ])).sort((left, right) => Number(left) - Number(right)), [snapshot]);

    const classOptions = useMemo(() => Array.from(new Set([
        ...Object.keys(snapshot?.classLeaderboardByClassKey || {}),
        ...Object.keys(snapshot?.classTop3ByClassKey || {}),
    ])).filter((value) => !gradeKey || parseClassKey(value).grade === gradeKey)
        .sort((left, right) => left.localeCompare(right, 'ko-KR', { numeric: true })), [gradeKey, snapshot]);

    useEffect(() => {
        if (!gradeKey || !gradeOptions.includes(gradeKey)) setGradeKey(snapshot?.primaryGradeKey || gradeOptions[0] || '');
    }, [gradeKey, gradeOptions, snapshot?.primaryGradeKey]);

    useEffect(() => {
        if (!classOptions.length) {
            setClassKey('');
            return;
        }
        if (!classKey || !classOptions.includes(classKey)) setClassKey(classOptions[0] || '');
    }, [classKey, classOptions]);

    const previewClass = parseClassKey(classKey);
    const podiumEntries = scope === 'grade'
        ? getWisHallOfFameGradeEntries(snapshot, gradeKey)
        : getWisHallOfFameClassEntries(snapshot, previewClass.grade, previewClass.className);
    const leaderboardEntries = scope === 'grade'
        ? getWisHallOfFameGradeLeaderboardEntries(snapshot, gradeKey)
        : getWisHallOfFameClassLeaderboardEntries(snapshot, previewClass.grade, previewClass.className);
    const visibleLeaderboardEntries = applyHallOfFameRankLimit(
        leaderboardEntries,
        scope === 'grade' ? draft.publicRange.gradeRankLimit : draft.publicRange.classRankLimit,
        draft.publicRange.includeTies,
    );
    const tailEntries = getHallOfFameLeaderboardTailEntries(visibleLeaderboardEntries, 3);
    const imageUrl = imagePreviewUrl || draft.podiumImageUrl || DEFAULT_WIS_HALL_OF_FAME_PODIUM_IMAGE_URL;
    const editorValue: WisHallOfFamePositionEditorValue = { positions: draft.positions, leaderboardPanel: draft.leaderboardPanel };

    const refreshSnapshot = async () => {
        if (!config) return;
        setRefreshing(true);
        try {
            await ensureWisHallOfFameSnapshot(config, { force: true });
            setSnapshot(await getWisHallOfFameSnapshot(config));
            showToast({ tone: 'success', title: '화랑의 전당 스냅샷을 새로 반영했습니다.', message: '학생 화면 미리보기를 최신 상태로 다시 읽었습니다.' });
        } catch (error: any) {
            setSnapshotError('화랑의 전당 스냅샷 새로고침에 실패했습니다.');
            showToast({ tone: 'warning', title: '스냅샷을 새로고침하지 못했습니다.', message: error?.message || '잠시 후 다시 시도해 주세요.' });
        } finally {
            setRefreshing(false);
        }
    };

    const saveDraft = async () => {
        if (!config || !canManage) return;
        setSaving(true);
        try {
            let imagePayload = { podiumImageUrl: draft.podiumImageUrl.trim(), podiumStoragePath: draft.podiumStoragePath.trim() };
            if (imageFile) {
                const resizedBlob = await buildResizedImageBlob(imageFile, 1600, 0.84);
                const imageRef = ref(storage, `site-settings/interface/hall-of-fame/podium-${Date.now()}.jpg`);
                await uploadBytes(imageRef, resizedBlob, { contentType: 'image/jpeg', cacheControl: 'public,max-age=86400' });
                imagePayload = { podiumImageUrl: await getDownloadURL(imageRef), podiumStoragePath: imageRef.fullPath };
            }
            const hallOfFame: HallOfFameInterfaceConfig = {
                podiumImageUrl: imagePayload.podiumImageUrl,
                podiumStoragePath: imagePayload.podiumStoragePath,
                positionPreset: draft.positionPreset,
                positions: draft.positions,
                leaderboardPanel: draft.leaderboardPanel,
                publicRange: draft.publicRange,
                recognitionPopup: draft.recognitionPopup,
            };
            const result = await saveWisHallOfFameConfig(config, hallOfFame);
            if (onInterfaceConfigRefresh) {
                await onInterfaceConfigRefresh();
            }
            setDraft(createDraft(result.hallOfFame));
            setImageFile(null);
            setImagePreviewUrl((previousValue) => {
                if (previousValue.startsWith('blob:')) URL.revokeObjectURL(previousValue);
                return '';
            });
            setSnapshot(await getWisHallOfFameSnapshot(config));
            showToast({ tone: 'success', title: '화랑의 전당 설정을 저장했습니다.', message: '배경, 공개 범위, 배치 편집 결과를 저장했습니다.' });
        } catch (error: any) {
            showToast({ tone: 'error', title: '화랑의 전당 설정 저장에 실패했습니다.', message: error?.message || '잠시 후 다시 시도해 주세요.' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="rounded-[1.9rem] border border-slate-200 bg-white px-6 py-6 shadow-[0_20px_56px_rgba(15,23,42,0.08)]">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                    <div>
                        <div className="text-[11px] font-black tracking-[0.18em] text-amber-600">HALL OF FAME CONTROL</div>
                        <h2 className="mt-2 text-2xl font-black text-slate-900">화랑의 전당 관리</h2>
                        <p className="mt-2 text-sm leading-6 text-slate-500">전교/학급 미리보기, 공개 범위, 입상 팝업, 배경 이미지와 배치 편집을 위스 관리 안에서 바로 조정합니다.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => void refreshSnapshot()} disabled={!canManage || refreshing} className="inline-flex min-h-11 items-center rounded-full border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60">{refreshing ? '새로고침 중...' : '스냅샷 새로고침'}</button>
                        <button type="button" onClick={() => void saveDraft()} disabled={!canManage || saving} className="inline-flex min-h-11 items-center rounded-full bg-slate-900 px-5 text-sm font-black text-white shadow-[0_14px_30px_rgba(15,23,42,0.18)] transition hover:bg-slate-800 disabled:bg-slate-400">{saving ? '저장 중...' : '화랑의 전당 저장'}</button>
                    </div>
                </div>
            </div>

            {snapshotError && <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-900">{snapshotError}</div>}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm"><div className="text-xs font-bold text-slate-500">현재 학기</div><div className="mt-2 text-lg font-black text-slate-900">{`${snapshot?.year || config?.year || '-'}학년도 ${snapshot?.semester || config?.semester || '-'}학기`}</div></div>
                <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm"><div className="text-xs font-bold text-slate-500">최근 반영</div><div className="mt-2 text-lg font-black text-slate-900">{snapshot?.updatedAt ? formatPointDateShortTime(snapshot.updatedAt) : '아직 없음'}</div></div>
                <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm"><div className="text-xs font-bold text-slate-500">공개 범위</div><div className="mt-2 text-lg font-black text-slate-900">{`전교 ${draft.publicRange.gradeRankLimit}위 / 학급 ${draft.publicRange.classRankLimit}위`}</div></div>
                <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm"><div className="text-xs font-bold text-slate-500">기준</div><div className="mt-2 text-lg font-black text-slate-900">누적 획득 위스</div><div className="mt-1 text-xs font-semibold text-slate-500">{draft.publicRange.includeTies ? '동점자는 함께 공개' : '동점자 추가 공개 안 함'}</div></div>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.14fr)_minmax(320px,0.86fr)]">
                <div className="space-y-6">
                    <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                            <div><h3 className="text-lg font-black text-slate-900">학생 화면 미리보기</h3><p className="mt-1 text-sm text-slate-500">전교와 학급 기준으로 실제 학생 화면과 비슷한 구조를 바로 확인합니다.</p></div>
                            <div className="flex flex-wrap gap-2">
                                <div className="inline-flex rounded-full bg-slate-100 p-1"><button type="button" onClick={() => setScope('grade')} className={`min-h-10 rounded-full px-4 text-sm font-black transition ${scope === 'grade' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'}`}>전교</button><button type="button" onClick={() => setScope('class')} className={`min-h-10 rounded-full px-4 text-sm font-black transition ${scope === 'class' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>학급</button></div>
                                <div className="inline-flex rounded-full bg-slate-100 p-1"><button type="button" onClick={() => setDeviceMode('desktop')} className={`min-h-10 rounded-full px-4 text-sm font-black transition ${deviceMode === 'desktop' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'}`}>데스크톱</button><button type="button" onClick={() => setDeviceMode('mobile')} className={`min-h-10 rounded-full px-4 text-sm font-black transition ${deviceMode === 'mobile' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>모바일</button></div>
                            </div>
                        </div>
                        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                            <select value={gradeKey} onChange={(event) => setGradeKey(event.target.value)} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700">{gradeOptions.length === 0 && <option value="">학년 없음</option>}{gradeOptions.map((option) => <option key={option} value={option}>{`${option}학년`}</option>)}</select>
                            <select value={classKey} onChange={(event) => setClassKey(event.target.value)} disabled={scope !== 'class' || classOptions.length === 0} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 disabled:bg-slate-100 disabled:text-slate-400">{classOptions.length === 0 && <option value="">학급 없음</option>}{classOptions.map((option) => { const parsed = parseClassKey(option); return <option key={option} value={option}>{`${parsed.grade}학년 ${parsed.className}반`}</option>; })}</select>
                        </div>
                        <div className={`mt-5 ${deviceMode === 'mobile' ? 'mx-auto max-w-[380px]' : ''}`}>
                            <div className={`grid grid-cols-1 gap-5 ${deviceMode === 'desktop' ? 'xl:grid-cols-[minmax(0,1.7fr)_minmax(310px,0.75fr)]' : ''}`}>
                                <WisHallOfFamePodium entries={podiumEntries} hallOfFameConfig={draft} imageUrl={imageUrl} emptyMessage="공개 스냅샷이 아직 준비되지 않았습니다." showHeader={false} deviceMode={deviceMode} />
                                <div className="min-h-[280px] xl:max-h-[720px]"><WisHallOfFameLeaderboardList entries={tailEntries} hallOfFameConfig={draft} title="우측 4~10위 미리보기" subtitle={draft.publicRange.includeTies ? '동점자는 우측 리스트에 함께 표시됩니다.' : '공개 범위 안에서만 표시됩니다.'} emptyMessage="우측에 표시할 추가 랭킹이 없습니다." className="h-full" style={buildRailStyle(draft.leaderboardPanel[deviceMode])} /></div>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div><h3 className="text-lg font-black text-slate-900">시상대 배경 관리</h3><p className="mt-1 text-sm text-slate-500">배경을 바꾸고 바로 미리보기로 확인한 뒤 저장합니다.</p></div>
                            <span className="inline-flex items-center rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-700">배경과 배치를 함께 조정</span>
                        </div>
                        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
                            <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-slate-50"><div className="border-b border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700">현재 배경</div><div className="p-4"><div className="aspect-[16/10] overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white shadow-sm"><img src={imageUrl} alt="화랑의 전당 배경 미리보기" className="h-full w-full object-cover" /></div></div></div>
                            <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-4"><div className="text-sm font-black text-slate-900">배경 작업</div><p className="mt-1 text-sm text-slate-500">가로형 이미지를 권장합니다.</p><div className="mt-4 flex flex-wrap gap-2"><label className="inline-flex min-h-11 cursor-pointer items-center rounded-full bg-slate-900 px-4 text-sm font-bold text-white transition hover:bg-slate-800">이미지 업로드<input type="file" accept="image/*" className="sr-only" onChange={(event) => { const file = event.target.files?.[0] || null; if (!file) return; setImageFile(file); setImagePreviewUrl((previousValue) => { if (previousValue.startsWith('blob:')) URL.revokeObjectURL(previousValue); return URL.createObjectURL(file); }); event.target.value = ''; }} disabled={!canManage} /></label><button type="button" onClick={() => { setImageFile(null); setImagePreviewUrl((previousValue) => { if (previousValue.startsWith('blob:')) URL.revokeObjectURL(previousValue); return ''; }); setDraft((previousValue) => ({ ...previousValue, podiumImageUrl: '', podiumStoragePath: '' })); }} disabled={!canManage} className="inline-flex min-h-11 items-center rounded-full border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60">기본 이미지 복원</button></div>{imageFile && <div className="mt-3 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-700">{imageFile.name}</div>}</div>
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
                        <h3 className="text-lg font-black text-slate-900">공개 범위와 팝업</h3>
                        <p className="mt-1 text-sm text-slate-500">교사가 보고 바로 이해할 수 있게 최소 항목만 정리했습니다.</p>
                        <div className="mt-5 space-y-4">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <input type="number" min={4} max={20} value={draft.publicRange.gradeRankLimit} onChange={(event) => setDraft((previousValue) => ({ ...previousValue, publicRange: { ...previousValue.publicRange, gradeRankLimit: Math.min(20, Math.max(4, Number(event.target.value || previousValue.publicRange.gradeRankLimit))) } }))} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700" disabled={!canManage} />
                                <input type="number" min={4} max={20} value={draft.publicRange.classRankLimit} onChange={(event) => setDraft((previousValue) => ({ ...previousValue, publicRange: { ...previousValue.publicRange, classRankLimit: Math.min(20, Math.max(4, Number(event.target.value || previousValue.publicRange.classRankLimit))) } }))} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700" disabled={!canManage} />
                            </div>
                            <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"><span className="text-sm font-black text-slate-900">동점자 함께 공개</span><input type="checkbox" checked={draft.publicRange.includeTies} onChange={(event) => setDraft((previousValue) => ({ ...previousValue, publicRange: { ...previousValue.publicRange, includeTies: event.target.checked } }))} className="h-5 w-5" disabled={!canManage} /></label>
                            <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"><span className="text-sm font-black text-slate-900">입상 팝업 사용</span><input type="checkbox" checked={draft.recognitionPopup.enabled} onChange={(event) => setDraft((previousValue) => ({ ...previousValue, recognitionPopup: { ...previousValue.recognitionPopup, enabled: event.target.checked } }))} className="h-5 w-5" disabled={!canManage} /></label>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3"><span className="text-sm font-bold text-slate-700">전교 팝업</span><input type="checkbox" checked={draft.recognitionPopup.gradeEnabled} onChange={(event) => setDraft((previousValue) => ({ ...previousValue, recognitionPopup: { ...previousValue.recognitionPopup, gradeEnabled: event.target.checked } }))} className="h-5 w-5" disabled={!canManage || !draft.recognitionPopup.enabled} /></label>
                                <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3"><span className="text-sm font-bold text-slate-700">학급 팝업</span><input type="checkbox" checked={draft.recognitionPopup.classEnabled} onChange={(event) => setDraft((previousValue) => ({ ...previousValue, recognitionPopup: { ...previousValue.recognitionPopup, classEnabled: event.target.checked } }))} className="h-5 w-5" disabled={!canManage || !draft.recognitionPopup.enabled} /></label>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
                        <WisHallOfFamePositionEditor value={editorValue} imageUrl={imageUrl} deviceMode={deviceMode} onDeviceModeChange={setDeviceMode} onReset={() => setDraft((previousValue) => ({ ...previousValue, positions: getDefaultHallOfFamePositions(), leaderboardPanel: getDefaultHallOfFameLeaderboardPanelPosition() }))} onChange={(nextValue) => setDraft((previousValue) => ({ ...previousValue, positions: nextValue.positions, leaderboardPanel: nextValue.leaderboardPanel }))} disabled={!canManage} />
                    </div>
                </div>
            </div>

            {loading && <div className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center text-sm font-semibold text-slate-500">화랑의 전당 관리 데이터를 불러오는 중입니다.</div>}
        </div>
    );
};

export default HallOfFameManagementTab;
