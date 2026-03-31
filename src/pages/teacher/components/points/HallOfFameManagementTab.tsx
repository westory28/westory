import React, { useEffect, useMemo, useState } from 'react';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import WisHallOfFamePositionEditor, {
  type HallOfFameEditorDeviceMode,
} from '../../../../components/common/WisHallOfFamePositionEditor';
import WisHallOfFameStudentPreview, {
  type HallOfFamePreviewView,
} from '../../../../components/common/WisHallOfFameStudentPreview';
import { useAppToast } from '../../../../components/common/AppToastProvider';
import { storage } from '../../../../lib/firebase';
import { formatPointDateShortTime } from '../../../../lib/pointFormatters';
import {
  DEFAULT_WIS_HALL_OF_FAME_PODIUM_IMAGE_URL,
  WIS_HALL_OF_FAME_GRADE_KEY,
  WIS_HALL_OF_FAME_REFRESH_INTERVAL_HOURS,
  ensureWisHallOfFameSnapshot,
  getDefaultHallOfFameLeaderboardPanelPosition,
  getDefaultHallOfFamePositions,
  getWisHallOfFameSnapshot,
  isWisHallOfFameSnapshotStale,
  resolveHallOfFameInterfaceConfig,
  saveWisHallOfFameConfig,
} from '../../../../lib/wisHallOfFame';
import type {
  HallOfFameInterfaceConfig,
  InterfaceConfig,
  SystemConfig,
  WisHallOfFameSnapshot,
} from '../../../../types';
import HallOfFameSettingsSidebar, {
  type HallOfFameSettingsPanelId,
  type HallOfFameSettingsSidebarItem,
} from './HallOfFameSettingsSidebar';

interface HallOfFameManagementTabProps {
  config: SystemConfig | null;
  interfaceConfig?: InterfaceConfig | null;
  canManage: boolean;
  onInterfaceConfigRefresh?: () => Promise<void>;
}

type FeatureDraft = Pick<
  ReturnType<typeof resolveHallOfFameInterfaceConfig>,
  'publicRange' | 'recognitionPopup'
>;

type ViewDraft = Pick<
  ReturnType<typeof resolveHallOfFameInterfaceConfig>,
  | 'podiumImageUrl'
  | 'podiumStoragePath'
  | 'positionPreset'
  | 'positions'
  | 'leaderboardPanel'
>;

const createDraft = (config?: HallOfFameInterfaceConfig | null) =>
  resolveHallOfFameInterfaceConfig(config);

const parseClassKey = (value: string) => {
  const [grade = '', className = ''] = String(value || '').split('-');
  return { grade, className };
};

const pickFeatureDraft = (
  draft: ReturnType<typeof resolveHallOfFameInterfaceConfig>,
): FeatureDraft => ({
  publicRange: {
    ...draft.publicRange,
  },
  recognitionPopup: {
    ...draft.recognitionPopup,
  },
});

const pickViewDraft = (
  draft: ReturnType<typeof resolveHallOfFameInterfaceConfig>,
): ViewDraft => ({
  podiumImageUrl: draft.podiumImageUrl,
  podiumStoragePath: draft.podiumStoragePath,
  positionPreset: draft.positionPreset,
  positions: {
    desktop: {
      first: { ...draft.positions.desktop.first },
      second: { ...draft.positions.desktop.second },
      third: { ...draft.positions.desktop.third },
    },
    mobile: {
      first: { ...draft.positions.mobile.first },
      second: { ...draft.positions.mobile.second },
      third: { ...draft.positions.mobile.third },
    },
  },
  leaderboardPanel: {
    desktop: { ...draft.leaderboardPanel.desktop },
    mobile: { ...draft.leaderboardPanel.mobile },
  },
});

const serializeFeatureDraft = (draft: FeatureDraft) =>
  JSON.stringify({
    publicRange: draft.publicRange,
    recognitionPopup: draft.recognitionPopup,
  });

const serializeViewDraft = (draft: ViewDraft) =>
  JSON.stringify({
    podiumImageUrl: draft.podiumImageUrl,
    podiumStoragePath: draft.podiumStoragePath,
    positionPreset: draft.positionPreset,
    positions: draft.positions,
    leaderboardPanel: draft.leaderboardPanel,
  });

const buildCombinedConfig = (
  featureDraft: FeatureDraft,
  viewDraft: ViewDraft,
) =>
  resolveHallOfFameInterfaceConfig({
    ...viewDraft,
    publicRange: featureDraft.publicRange,
    recognitionPopup: featureDraft.recognitionPopup,
  });

const loadImageElement = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
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

const buildResizedImageBlob = async (
  file: File,
  maxSize: number,
  quality: number,
) => {
  const image = await loadImageElement(file);
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('화랑의 전당 배경 캔버스를 준비하지 못했습니다.');
  }
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

const formatAdminDateTime = (ms: number) =>
  new Date(ms).toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const buildStoredRangeSummary = (draft: FeatureDraft) =>
  `전교 ${draft.publicRange.gradeRankLimit}위 / 학급 ${draft.publicRange.classRankLimit}위`;

const PanelHeader: React.FC<{
  title: string;
  description: string;
  saveLabel: string;
  canManage: boolean;
  saving: boolean;
  dirty: boolean;
  onSave: () => void;
}> = ({ title, description, saveLabel, canManage, saving, dirty, onSave }) => (
  <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
    <div className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h2 className="text-lg font-extrabold text-gray-900">{title}</h2>
        <p className="mt-1 text-sm text-gray-500">{description}</p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:min-w-[320px] lg:flex-col lg:items-end">
        <button
          type="button"
          onClick={onSave}
          disabled={!canManage || !dirty || saving}
          className="inline-flex items-center justify-center whitespace-nowrap rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
        >
          {saving ? '저장 중...' : saveLabel}
        </button>
        <div
          className={[
            'rounded-xl border px-4 py-3 text-sm',
            dirty
              ? 'border-amber-200 bg-amber-50 text-amber-800'
              : 'border-gray-200 bg-gray-50 text-gray-600',
          ].join(' ')}
        >
          {dirty
            ? '변경사항이 저장 대기 중입니다.'
            : '저장된 설정과 같습니다.'}
        </div>
      </div>
    </div>
  </div>
);

const HallOfFameManagementTab: React.FC<HallOfFameManagementTabProps> = ({
  config,
  interfaceConfig,
  canManage,
  onInterfaceConfigRefresh,
}) => {
  const { showToast } = useAppToast();
  const initialDraft = useMemo(
    () => createDraft(interfaceConfig?.hallOfFame),
    [interfaceConfig?.hallOfFame],
  );
  const [snapshot, setSnapshot] = useState<WisHallOfFameSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [featureSaving, setFeatureSaving] = useState(false);
  const [viewSaving, setViewSaving] = useState(false);
  const [activePanel, setActivePanel] =
    useState<HallOfFameSettingsPanelId>('feature_settings');
  const [previewScope, setPreviewScope] =
    useState<HallOfFamePreviewView>('grade');
  const [deviceMode, setDeviceMode] =
    useState<HallOfFameEditorDeviceMode>('desktop');
  const [gradeKey, setGradeKey] = useState('');
  const [classKey, setClassKey] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [savedFeatureDraft, setSavedFeatureDraft] = useState<FeatureDraft>(() =>
    pickFeatureDraft(initialDraft),
  );
  const [featureDraft, setFeatureDraft] = useState<FeatureDraft>(() =>
    pickFeatureDraft(initialDraft),
  );
  const [savedViewDraft, setSavedViewDraft] = useState<ViewDraft>(() =>
    pickViewDraft(initialDraft),
  );
  const [viewDraft, setViewDraft] = useState<ViewDraft>(() =>
    pickViewDraft(initialDraft),
  );

  useEffect(() => {
    const nextDraft = createDraft(interfaceConfig?.hallOfFame);
    const nextFeatureDraft = pickFeatureDraft(nextDraft);
    const nextViewDraft = pickViewDraft(nextDraft);
    const featureWasClean =
      serializeFeatureDraft(featureDraft) ===
      serializeFeatureDraft(savedFeatureDraft);
    const viewWasClean =
      !imageFile &&
      serializeViewDraft(viewDraft) === serializeViewDraft(savedViewDraft);

    setSavedFeatureDraft(nextFeatureDraft);
    setSavedViewDraft(nextViewDraft);

    if (featureWasClean) {
      setFeatureDraft(nextFeatureDraft);
    }
    if (viewWasClean) {
      setViewDraft(nextViewDraft);
    }
  }, [interfaceConfig?.hallOfFame]);

  useEffect(
    () => () => {
      if (imagePreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    },
    [imagePreviewUrl],
  );

  useEffect(() => {
    let cancelled = false;

    const loadSnapshot = async () => {
      if (!config) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setSnapshotError('');

      try {
        const nextSnapshot = await getWisHallOfFameSnapshot(config);
        if (!cancelled) {
          setSnapshot(nextSnapshot);
        }
      } catch (error) {
        console.warn(
          'Failed to load hall of fame snapshot for teacher management:',
          error,
        );
        if (!cancelled) {
          setSnapshot(null);
          setSnapshotError(
            '공개 스냅샷을 읽지 못했습니다. 그래도 위스 관리 전체는 계속 사용할 수 있습니다.',
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, [config]);

  const featureDirty =
    serializeFeatureDraft(featureDraft) !==
    serializeFeatureDraft(savedFeatureDraft);
  const viewDirty =
    Boolean(imageFile) ||
    serializeViewDraft(viewDraft) !== serializeViewDraft(savedViewDraft);
  const combinedDraft = useMemo(
    () => buildCombinedConfig(savedFeatureDraft, viewDraft),
    [savedFeatureDraft, viewDraft],
  );
  const previewConfig = useMemo(
    () =>
      resolveHallOfFameInterfaceConfig({
        ...combinedDraft,
        podiumImageUrl: imagePreviewUrl || combinedDraft.podiumImageUrl,
      }),
    [combinedDraft, imagePreviewUrl],
  );
  const imageUrl =
    imagePreviewUrl ||
    previewConfig.podiumImageUrl ||
    DEFAULT_WIS_HALL_OF_FAME_PODIUM_IMAGE_URL;

  const gradeOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...Object.keys(snapshot?.gradeLeaderboardByGrade || {}),
          ...Object.keys(snapshot?.gradeTop3ByGrade || {}),
        ]),
      ).sort((left, right) =>
        left.localeCompare(right, 'ko-KR', { numeric: true }),
      ),
    [snapshot],
  );

  const classOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...Object.keys(snapshot?.classLeaderboardByClassKey || {}),
          ...Object.keys(snapshot?.classTop3ByClassKey || {}),
        ]),
      )
        .filter((value) => !gradeKey || parseClassKey(value).grade === gradeKey)
        .sort((left, right) =>
          left.localeCompare(right, 'ko-KR', { numeric: true }),
        ),
    [gradeKey, snapshot],
  );

  useEffect(() => {
    if (!gradeKey || !gradeOptions.includes(gradeKey)) {
      setGradeKey(
        snapshot?.primaryGradeKey || gradeOptions[0] || WIS_HALL_OF_FAME_GRADE_KEY,
      );
    }
  }, [gradeKey, gradeOptions, snapshot?.primaryGradeKey]);

  useEffect(() => {
    if (!classOptions.length) {
      setClassKey('');
      return;
    }
    if (!classKey || !classOptions.includes(classKey)) {
      setClassKey(classOptions[0] || '');
    }
  }, [classKey, classOptions]);

  useEffect(() => {
    if (previewScope === 'class' && !classKey) {
      setPreviewScope('grade');
    }
  }, [classKey, previewScope]);

  const previewClass = parseClassKey(classKey);
  const snapshotUpdatedAtLabel = snapshot?.updatedAt
    ? formatPointDateShortTime(snapshot.updatedAt)
    : '아직 없음';
  const nextAutomaticRefreshLabel = snapshot?.updatedAtMs
    ? formatAdminDateTime(
        Number(snapshot.updatedAtMs) +
          WIS_HALL_OF_FAME_REFRESH_INTERVAL_HOURS * 60 * 60 * 1000,
      )
    : '첫 스냅샷 생성 후 계산됩니다.';
  const snapshotStatusLabel = snapshot
    ? isWisHallOfFameSnapshotStale(snapshot)
      ? '4시간 기준이 지나 다음 갱신 대기 상태입니다.'
      : `마지막 반영 후 ${WIS_HALL_OF_FAME_REFRESH_INTERVAL_HOURS}시간 이내입니다.`
    : '공개 스냅샷을 아직 만들지 않았습니다.';
  const sidebarItems: HallOfFameSettingsSidebarItem[] = [
    {
      id: 'feature_settings',
      label: '기능 설정',
      description: '공개 범위, 팝업, 공개 시간 정책을 관리합니다.',
      iconClassName: 'fas fa-sliders-h',
      badge: featureDirty ? '미저장' : '저장됨',
      meta: `${buildStoredRangeSummary(featureDraft)} · ${WIS_HALL_OF_FAME_REFRESH_INTERVAL_HOURS}시간`,
    },
    {
      id: 'student_view_settings',
      label: '학생 화면 설정',
      description: '배경 이미지와 시상대/랭킹 배치를 조정합니다.',
      iconClassName: 'fas fa-images',
      badge: viewDirty ? '미저장' : '저장됨',
      meta: `${deviceMode === 'desktop' ? '데스크톱' : '모바일'} 배치 편집 가능`,
    },
  ];

  const refreshSnapshot = async () => {
    if (!config) return;

    setRefreshing(true);
    try {
      await ensureWisHallOfFameSnapshot(config, { force: true });
      const nextSnapshot = await getWisHallOfFameSnapshot(config);
      setSnapshot(nextSnapshot);
      setSnapshotError('');
      showToast({
        tone: 'success',
        title: '화랑의 전당 스냅샷을 새로 반영했습니다.',
        message: '학생 화면 미리보기를 최신 공개 데이터로 다시 읽었습니다.',
      });
    } catch (error: any) {
      setSnapshotError('화랑의 전당 스냅샷 새로고침에 실패했습니다.');
      showToast({
        tone: 'warning',
        title: '스냅샷을 새로고침하지 못했습니다.',
        message: error?.message || '잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setRefreshing(false);
    }
  };

  const handleSaveFeatureSettings = async () => {
    if (!config || !canManage || !featureDirty) return;

    setFeatureSaving(true);
    try {
      const fullDraft = buildCombinedConfig(featureDraft, savedViewDraft);
      const result = await saveWisHallOfFameConfig(
        config,
        fullDraft,
        { refreshSnapshot: false },
      );
      const nextDraft = createDraft(result.hallOfFame);
      const nextFeatureDraft = pickFeatureDraft(nextDraft);

      setSavedFeatureDraft(nextFeatureDraft);
      setFeatureDraft(nextFeatureDraft);

      if (onInterfaceConfigRefresh) {
        await onInterfaceConfigRefresh().catch((error) => {
          console.warn(
            'Failed to refresh interface config after hall of fame feature save:',
            error,
          );
        });
      }

      showToast({
        tone: 'success',
        title: '기능 설정이 저장되었습니다.',
        message: '공개 범위, 팝업, 공개 시간 정책 변경을 반영했습니다.',
      });
    } catch (error: any) {
      showToast({
        tone: 'error',
        title: '기능 설정 저장에 실패했습니다.',
        message: error?.message || '잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setFeatureSaving(false);
    }
  };

  const handleSaveStudentViewSettings = async () => {
    if (!config || !canManage || !viewDirty) return;

    setViewSaving(true);
    try {
      let imagePayload = {
        podiumImageUrl: viewDraft.podiumImageUrl.trim(),
        podiumStoragePath: viewDraft.podiumStoragePath.trim(),
      };

      if (imageFile) {
        const resizedBlob = await buildResizedImageBlob(imageFile, 1600, 0.84);
        const imageRef = ref(
          storage,
          `site-settings/interface/hall-of-fame/podium-${Date.now()}.jpg`,
        );

        await uploadBytes(imageRef, resizedBlob, {
          contentType: 'image/jpeg',
          cacheControl: 'public,max-age=86400',
        });

        imagePayload = {
          podiumImageUrl: await getDownloadURL(imageRef),
          podiumStoragePath: imageRef.fullPath,
        };
      }

      const result = await saveWisHallOfFameConfig(
        config,
        buildCombinedConfig(savedFeatureDraft, {
          ...viewDraft,
          podiumImageUrl: imagePayload.podiumImageUrl,
          podiumStoragePath: imagePayload.podiumStoragePath,
        }),
        { refreshSnapshot: false },
      );
      const nextDraft = createDraft(result.hallOfFame);
      const nextViewDraft = pickViewDraft(nextDraft);

      setSavedViewDraft(nextViewDraft);
      setViewDraft(nextViewDraft);
      setImageFile(null);
      setImagePreviewUrl((previousValue) => {
        if (previousValue.startsWith('blob:')) {
          URL.revokeObjectURL(previousValue);
        }
        return '';
      });

      if (onInterfaceConfigRefresh) {
        await onInterfaceConfigRefresh().catch((error) => {
          console.warn(
            'Failed to refresh interface config after hall of fame student view save:',
            error,
          );
        });
      }

      showToast({
        tone: 'success',
        title: '학생 화면 설정이 저장되었습니다.',
        message: '배경 이미지와 배치 편집 결과를 저장했습니다.',
      });
    } catch (error: any) {
      showToast({
        tone: 'error',
        title: '학생 화면 설정 저장에 실패했습니다.',
        message: error?.message || '잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setViewSaving(false);
    }
  };

  const featureSettingsPanel = (
    <div className="space-y-6">
      <PanelHeader
        title="기능 설정"
        description="공개 범위, 팝업, 4시간 반영 정책만 따로 관리합니다."
        saveLabel="기능 설정 저장"
        canManage={canManage}
        saving={featureSaving}
        dirty={featureDirty}
        onSave={() => void handleSaveFeatureSettings()}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="text-xs font-bold text-slate-500">현재 학기</div>
          <div className="mt-2 text-lg font-black text-slate-900">
            {`${snapshot?.year || config?.year || '-'}학년도 ${
              snapshot?.semester || config?.semester || '-'
            }학기`}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="text-xs font-bold text-slate-500">최근 반영 시각</div>
          <div className="mt-2 text-lg font-black text-slate-900">
            {snapshotUpdatedAtLabel}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="text-xs font-bold text-slate-500">공개 범위 요약</div>
          <div className="mt-2 text-lg font-black text-slate-900">
            {buildStoredRangeSummary(featureDraft)}
          </div>
          <div className="mt-1 text-xs font-semibold text-slate-500">
            {featureDraft.publicRange.includeTies
              ? '동점자는 함께 공개'
              : '동점자는 추가 공개하지 않음'}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="text-xs font-bold text-slate-500">반영 주기</div>
          <div className="mt-2 text-lg font-black text-slate-900">
            {WIS_HALL_OF_FAME_REFRESH_INTERVAL_HOURS}시간마다 자동 반영
          </div>
          <div className="mt-1 text-xs font-semibold text-slate-500">
            실시간 갱신 대신 주기 반영
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-6">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
              <h3 className="text-lg font-black text-slate-900">공개 범위</h3>
              <p className="mt-1 text-sm text-slate-500">
                저장값을 한눈에 확인하면서 전교/학급 공개 기준을 정리합니다.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white">
                  저장값 {buildStoredRangeSummary(savedFeatureDraft)}
                </span>
                <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                  {savedFeatureDraft.publicRange.includeTies
                    ? '동점자 함께 공개'
                    : '동점자 추가 공개 안 함'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 sm:p-6">
              <label className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-sm font-black text-slate-900">
                  전교 공개 범위
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  전교 화랑의 전당에서 몇 위까지 공개할지 정합니다.
                </p>
                <input
                  type="number"
                  min={4}
                  max={20}
                  value={featureDraft.publicRange.gradeRankLimit}
                  onChange={(event) =>
                    setFeatureDraft((previousValue) => ({
                      ...previousValue,
                      publicRange: {
                        ...previousValue.publicRange,
                        gradeRankLimit: Math.min(
                          20,
                          Math.max(
                            4,
                            Number(
                              event.target.value ||
                                previousValue.publicRange.gradeRankLimit,
                            ),
                          ),
                        ),
                      },
                    }))
                  }
                  className="mt-4 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700"
                  disabled={!canManage}
                />
              </label>

              <label className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-sm font-black text-slate-900">
                  학급 공개 범위
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  학급 화랑의 전당에서 몇 위까지 공개할지 정합니다.
                </p>
                <input
                  type="number"
                  min={4}
                  max={20}
                  value={featureDraft.publicRange.classRankLimit}
                  onChange={(event) =>
                    setFeatureDraft((previousValue) => ({
                      ...previousValue,
                      publicRange: {
                        ...previousValue.publicRange,
                        classRankLimit: Math.min(
                          20,
                          Math.max(
                            4,
                            Number(
                              event.target.value ||
                                previousValue.publicRange.classRankLimit,
                            ),
                          ),
                        ),
                      },
                    }))
                  }
                  className="mt-4 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700"
                  disabled={!canManage}
                />
              </label>

              <label className="sm:col-span-2 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div>
                  <div className="text-sm font-black text-slate-900">
                    동점자 함께 공개 여부
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    컷오프 점수가 같으면 같은 순위를 함께 보여줍니다.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={featureDraft.publicRange.includeTies}
                  onChange={(event) =>
                    setFeatureDraft((previousValue) => ({
                      ...previousValue,
                      publicRange: {
                        ...previousValue.publicRange,
                        includeTies: event.target.checked,
                      },
                    }))
                  }
                  className="h-5 w-5"
                  disabled={!canManage}
                />
              </label>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
              <h3 className="text-lg font-black text-slate-900">팝업 설정</h3>
              <p className="mt-1 text-sm text-slate-500">
                입상 팝업 사용 여부만 단정하게 관리합니다.
              </p>
            </div>

            <div className="space-y-3 p-5 sm:p-6">
              <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div>
                  <div className="text-sm font-black text-slate-900">
                    입상 팝업 사용
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    학생이 입상했을 때 축하 팝업을 전체적으로 사용할지 정합니다.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={featureDraft.recognitionPopup.enabled}
                  onChange={(event) =>
                    setFeatureDraft((previousValue) => ({
                      ...previousValue,
                      recognitionPopup: {
                        ...previousValue.recognitionPopup,
                        enabled: event.target.checked,
                      },
                    }))
                  }
                  className="h-5 w-5"
                  disabled={!canManage}
                />
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  <div>
                    <div className="text-sm font-black text-slate-900">
                      전교 팝업 사용
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      전교 화랑의 전당 입상 팝업입니다.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={featureDraft.recognitionPopup.gradeEnabled}
                    onChange={(event) =>
                      setFeatureDraft((previousValue) => ({
                        ...previousValue,
                        recognitionPopup: {
                          ...previousValue.recognitionPopup,
                          gradeEnabled: event.target.checked,
                        },
                      }))
                    }
                    className="h-5 w-5"
                    disabled={!canManage || !featureDraft.recognitionPopup.enabled}
                  />
                </label>

                <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  <div>
                    <div className="text-sm font-black text-slate-900">
                      학급 팝업 사용
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      학급 화랑의 전당 입상 팝업입니다.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={featureDraft.recognitionPopup.classEnabled}
                    onChange={(event) =>
                      setFeatureDraft((previousValue) => ({
                        ...previousValue,
                        recognitionPopup: {
                          ...previousValue.recognitionPopup,
                          classEnabled: event.target.checked,
                        },
                      }))
                    }
                    className="h-5 w-5"
                    disabled={!canManage || !featureDraft.recognitionPopup.enabled}
                  />
                </label>
              </div>

              <div className="rounded-2xl border border-dashed border-sky-200 bg-sky-50 px-4 py-4 text-sm text-sky-900">
                팝업은 on/off만 관리합니다. 학생 문구 편집은 넣지 않았습니다.
              </div>
            </div>
          </section>
        </div>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
            <h3 className="text-lg font-black text-slate-900">공개 시간</h3>
            <p className="mt-1 text-sm text-slate-500">
              화랑의 전당 공개 데이터는 실시간이 아니라 4시간 단위로 반영됩니다.
            </p>
          </div>

          <div className="space-y-4 p-5 sm:p-6">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-slate-900">
                    4시간마다 자동 반영
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    point 변경이 있을 때마다 즉시 재계산하지 않고, 4시간 기준이 지난 뒤에만 다시 계산합니다.
                  </p>
                </div>
                <span className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white">
                  자동 정책
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div className="text-xs font-bold text-slate-500">최근 반영 시각</div>
                <div className="mt-2 text-base font-black text-slate-900">
                  {snapshotUpdatedAtLabel}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div className="text-xs font-bold text-slate-500">
                  다음 자동 갱신 기준
                </div>
                <div className="mt-2 text-base font-black text-slate-900">
                  {nextAutomaticRefreshLabel}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div className="text-xs font-bold text-slate-500">현재 상태</div>
                <div className="mt-2 text-base font-black text-slate-900">
                  {snapshotStatusLabel}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
              학생 화면은 여전히 공개 snapshot만 읽고, wallet을 직접 스캔하지 않습니다.
            </div>

            <button
              type="button"
              onClick={() => void refreshSnapshot()}
              disabled={!canManage || refreshing}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? '스냅샷 새로고침 중...' : '스냅샷 새로고침'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
  const studentViewSettingsPanel = (
    <div className="space-y-6">
      <PanelHeader
        title="학생 화면 설정"
        description="실제 학생 화랑의 전당 구조를 보면서 배경 이미지와 배치를 조정합니다."
        saveLabel="학생 화면 설정 저장"
        canManage={canManage}
        saving={viewSaving}
        dirty={viewDirty}
        onSave={() => void handleSaveStudentViewSettings()}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.42fr)_360px]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  학생 화면 미리보기
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  좌측 시상대와 우측 4~10위 랭킹까지 포함한 실제 학생 화면 구조를 바로 확인합니다.
                </p>
              </div>
              <div className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                {deviceMode === 'desktop' ? '데스크톱 미리보기' : '모바일 미리보기'}
              </div>
            </div>
          </div>

          <WisHallOfFameStudentPreview
            snapshot={snapshot}
            hallOfFameConfig={previewConfig}
            activeView={previewScope}
            onActiveViewChange={setPreviewScope}
            gradeKey={gradeKey}
            currentGrade={previewClass.grade}
            currentClass={previewClass.className}
            deviceMode={deviceMode}
            showSnapshotAlert={!snapshotError}
          />
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-black text-slate-900">미리보기 기준</h3>
            <p className="mt-1 text-sm text-slate-500">
              학생 화면처럼 전교/학급 보기 전환을 확인하되, 어떤 학년/학급 데이터를 보여줄지는 여기서 고릅니다.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3">
              <label className="block">
                <div className="mb-2 text-xs font-bold text-slate-500">
                  전교 미리보기 학년
                </div>
                <select
                  value={gradeKey}
                  onChange={(event) => setGradeKey(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700"
                >
                  {gradeOptions.length === 0 && (
                    <option value={WIS_HALL_OF_FAME_GRADE_KEY}>
                      학년 없음
                    </option>
                  )}
                  {gradeOptions.map((option) => (
                    <option key={option} value={option}>
                      {`${option}학년`}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <div className="mb-2 text-xs font-bold text-slate-500">
                  학급 미리보기 대상
                </div>
                <select
                  value={classKey}
                  onChange={(event) => setClassKey(event.target.value)}
                  disabled={classOptions.length === 0}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  {classOptions.length === 0 && <option value="">학급 없음</option>}
                  {classOptions.map((option) => {
                    const parsed = parseClassKey(option);
                    return (
                      <option key={option} value={option}>
                        {`${parsed.grade}학년 ${parsed.className}반`}
                      </option>
                    );
                  })}
                </select>
              </label>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-black text-slate-900">
              시상대 배경 이미지
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              배경 이미지를 바꾸면 왼쪽 미리보기에 즉시 반영됩니다.
            </p>

            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
              <div className="aspect-[16/10] overflow-hidden">
                <img
                  src={imageUrl}
                  alt="화랑의 전당 배경 미리보기"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg bg-slate-900 px-4 text-sm font-bold text-white transition hover:bg-slate-800">
                이미지 업로드
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    if (!file) return;
                    setImageFile(file);
                    setImagePreviewUrl((previousValue) => {
                      if (previousValue.startsWith('blob:')) {
                        URL.revokeObjectURL(previousValue);
                      }
                      return URL.createObjectURL(file);
                    });
                    event.target.value = '';
                  }}
                  disabled={!canManage}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setImageFile(null);
                  setImagePreviewUrl((previousValue) => {
                    if (previousValue.startsWith('blob:')) {
                      URL.revokeObjectURL(previousValue);
                    }
                    return '';
                  });
                  setViewDraft((previousValue) => ({
                    ...previousValue,
                    podiumImageUrl: '',
                    podiumStoragePath: '',
                  }));
                }}
                disabled={!canManage}
                className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                기본 이미지 복원
              </button>
            </div>

            {imageFile && (
              <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                {imageFile.name}
              </div>
            )}
          </div>

          <WisHallOfFamePositionEditor
            value={{
              positions: viewDraft.positions,
              leaderboardPanel: viewDraft.leaderboardPanel,
            }}
            imageUrl={imageUrl}
            deviceMode={deviceMode}
            onDeviceModeChange={setDeviceMode}
            onReset={() =>
              setViewDraft((previousValue) => ({
                ...previousValue,
                positions: getDefaultHallOfFamePositions(),
                leaderboardPanel: getDefaultHallOfFameLeaderboardPanelPosition(),
              }))
            }
            onChange={(nextValue) =>
              setViewDraft((previousValue) => ({
                ...previousValue,
                positions: nextValue.positions,
                leaderboardPanel: nextValue.leaderboardPanel,
              }))
            }
            disabled={!canManage}
            showPreviewStage={false}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {snapshotError && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-900">
          {snapshotError}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-gray-400 shadow-sm">
          <div className="mb-2 text-2xl">
            <i className="fas fa-spinner fa-spin"></i>
          </div>
          <p className="font-bold">화랑의 전당 관리 데이터를 불러오는 중입니다.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
          <HallOfFameSettingsSidebar
            activePanel={activePanel}
            items={sidebarItems}
            onSelect={setActivePanel}
          />

          <div className="min-w-0 flex-1 space-y-5">
            {activePanel === 'feature_settings'
              ? featureSettingsPanel
              : studentViewSettingsPanel}
          </div>
        </div>
      )}
    </div>
  );
};

export default HallOfFameManagementTab;
