import React, { useEffect, useMemo, useState } from "react";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import WisHallOfFamePositionEditor, {
  type HallOfFameEditorDeviceMode,
} from "../../../../components/common/WisHallOfFamePositionEditor";
import WisHallOfFameStudentPreview, {
  type HallOfFamePreviewView,
} from "../../../../components/common/WisHallOfFameStudentPreview";
import { useAppToast } from "../../../../components/common/AppToastProvider";
import { storage } from "../../../../lib/firebase";
import { formatPointDateShortTime } from "../../../../lib/pointFormatters";
import { invalidateSiteSettingDocCache } from "../../../../lib/siteSettings";
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
} from "../../../../lib/wisHallOfFame";
import type {
  HallOfFameInterfaceConfig,
  InterfaceConfig,
  SystemConfig,
  WisHallOfFameSnapshot,
} from "../../../../types";

interface HallOfFameManagementTabProps {
  config: SystemConfig | null;
  interfaceConfig?: InterfaceConfig | null;
  canManage: boolean;
  onInterfaceConfigRefresh?: () => Promise<void>;
}

type FeatureDraft = Pick<
  ReturnType<typeof resolveHallOfFameInterfaceConfig>,
  "publicRange" | "recognitionPopup"
>;

type ViewDraft = Pick<
  ReturnType<typeof resolveHallOfFameInterfaceConfig>,
  | "podiumImageUrl"
  | "podiumStoragePath"
  | "positionPreset"
  | "positions"
  | "leaderboardPanel"
>;

type LayoutDraft = Pick<ViewDraft, "positions" | "leaderboardPanel">;

const HALL_OF_FAME_PODIUM_STORAGE_DIR = "site-settings/interface/hall-of-fame";

const createDraft = (config?: HallOfFameInterfaceConfig | null) =>
  resolveHallOfFameInterfaceConfig(config);

const parseClassKey = (value: string) => {
  const [grade = "", className = ""] = String(value || "").split("-");
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

const pickLayoutDraft = (
  draft: ViewDraft | ReturnType<typeof resolveHallOfFameInterfaceConfig>,
): LayoutDraft => ({
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
      reject(new Error("화랑의 전당 배경 이미지를 읽지 못했습니다."));
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
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("화랑의 전당 배경 캔버스를 준비하지 못했습니다.");
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("화랑의 전당 배경 이미지를 압축하지 못했습니다."));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
};

const formatAdminDateTime = (ms: number) =>
  new Date(ms).toLocaleString("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const getNextHallOfFameAutoSyncMs = (fromMs = Date.now()) => {
  const next = new Date(fromMs);
  const currentHour = next.getHours();
  const currentBlock = Math.floor(
    currentHour / WIS_HALL_OF_FAME_REFRESH_INTERVAL_HOURS,
  );
  const nextHour = (currentBlock + 1) * WIS_HALL_OF_FAME_REFRESH_INTERVAL_HOURS;

  next.setMinutes(0, 0, 0);
  if (nextHour >= 24) {
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
  } else {
    next.setHours(nextHour, 0, 0, 0);
  }
  return next.getTime();
};

const isStorageUnauthorizedError = (error: any) =>
  String(error?.code || "").trim() === "storage/unauthorized";

const getHallOfFameImageUploadFailureText = (error: any) => {
  if (isStorageUnauthorizedError(error)) {
    return {
      title: "시상대 이미지 업로드 권한이 없어 저장하지 못했습니다.",
      message: "이미지 저장 권한을 확인한 뒤 다시 시도해 주세요.",
    };
  }

  return {
    title: "시상대 이미지 업로드에 실패했습니다.",
    message:
      "이미지 업로드 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  };
};

const getHallOfFameRefreshStageMessage = (stage: string, detail: string) => {
  if (stage === "current_semester") {
    return {
      title: "현재 학기 정보를 확인하지 못했습니다.",
      message:
        "학기 설정에 학년도와 학기가 지정되어 있는지 확인한 뒤 다시 시도해 주세요.",
    };
  }
  if (stage === "policy_load") {
    return {
      title: "공개 랭킹 기준을 읽지 못했습니다.",
      message:
        "화랑의 전당 공개 범위 설정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  if (stage === "wallet_read") {
    return {
      title: "현재 학기 위스 현황을 읽지 못했습니다.",
      message: "학기 설정과 학생 위스 현황을 확인한 뒤 다시 시도해 주세요.",
    };
  }

  if (stage === "profile_read") {
    return {
      title: "학생 정보를 불러오는 중 문제가 생겼습니다.",
      message:
        "위스 현황은 확인했지만 학생 이름, 학년, 반 정보를 함께 불러오지 못했습니다. 학생 명단을 확인해 주세요.",
    };
  }

  if (stage === "snapshot_write") {
    return {
      title: "새 공개 랭킹을 저장하지 못했습니다.",
      message: "공개 랭킹을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  return {
    title: "최신 위스 현황을 반영하지 못했습니다.",
    message:
      "공개 랭킹을 새로 반영하는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  };
};

const getHallOfFameConfigSaveFailureText = (error: any) => {
  const stage = String(error?.details?.stage || "").trim();
  const errorStage = String(
    error?.details?.refreshStage || error?.details?.stage || "",
  ).trim();
  const errorDetail = String(
    error?.details?.refreshDetail || error?.details?.detail || "",
  ).trim();
  const errorCode = String(error?.code || "").trim();
  const normalizedMessage = String(error?.message || "").trim();
  if (stage === "config_save") {
    return {
      title: "배치 설정 저장에 실패했습니다.",
      message:
        "학생 화면 설정을 저장하는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  if (stage === "snapshot_refresh") {
    if (errorStage) {
      return getHallOfFameRefreshStageMessage(errorStage, errorDetail);
    }
    return {
      title: "학생 화면 설정은 저장됐지만 최신 랭킹 반영에 실패했습니다.",
      message:
        "저장은 완료됐지만 최신 랭킹을 반영하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  if (
    errorCode === "functions/not-found" ||
    normalizedMessage.toLowerCase().includes("savewishalloffameconfig")
  ) {
    return {
      title: "학생 화면 설정 저장 중 문제가 발생했습니다.",
      message: "저장 기능을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  if (
    errorCode === "functions/permission-denied" ||
    normalizedMessage.toLowerCase().includes("permission is required") ||
    normalizedMessage
      .toLowerCase()
      .includes("cannot use westory point functions")
  ) {
    return {
      title: "학생 화면 설정을 저장할 권한이 없습니다.",
      message: "화랑의 전당 관리 권한을 확인한 뒤 다시 시도해 주세요.",
    };
  }

  if (
    errorCode === "functions/invalid-argument" ||
    normalizedMessage.toLowerCase().includes("year and semester are required")
  ) {
    return {
      title: "현재 학기 정보를 확인하지 못했습니다.",
      message: "학기 설정을 다시 불러온 뒤 다시 시도해 주세요.",
    };
  }

  if (errorStage === "snapshot_write") {
    return {
      title: "공개 랭킹 반영 중 문제가 발생했습니다.",
      message:
        "학생 위스 현황은 확인했지만 공개 랭킹에 반영하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  if (
    errorCode === "functions/internal" ||
    errorCode === "internal" ||
    normalizedMessage.toLowerCase() === "internal"
  ) {
    return {
      title: "학생 화면 설정 저장 중 문제가 발생했습니다.",
      message: "저장하는 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  if (
    errorCode === "functions/unavailable" ||
    errorCode === "functions/deadline-exceeded"
  ) {
    return {
      title: "학생 화면 설정 저장 응답이 지연되고 있습니다.",
      message: "네트워크 상태를 확인한 뒤 잠시 후 다시 시도해 주세요.",
    };
  }

  return {
    title: "학생 화면 설정 저장 중 문제가 발생했습니다.",
    message: "잠시 후 다시 시도해 주세요.",
  };
};

const getHallOfFameSnapshotRefreshFailureText = (error: any) => {
  const stage = String(error?.details?.stage || "").trim();
  const detail = String(error?.details?.detail || "").trim();
  const errorCode = String(error?.code || "").trim();
  const normalizedMessage = String(error?.message || "").trim();
  const lowerMessage = normalizedMessage.toLowerCase();

  if (stage) {
    return getHallOfFameRefreshStageMessage(stage, detail);
  }

  if (
    errorCode === "functions/not-found" ||
    lowerMessage.includes("ensurewishalloffame")
  ) {
    return {
      title: "최신 위스 현황을 반영하지 못했습니다.",
      message: "반영 기능을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  if (
    errorCode === "functions/permission-denied" ||
    lowerMessage.includes("permission is required") ||
    lowerMessage.includes("cannot use westory point functions")
  ) {
    return {
      title: "최신 위스 현황을 반영할 권한이 없습니다.",
      message: "화랑의 전당 관리 권한을 확인한 뒤 다시 시도해 주세요.",
    };
  }

  if (
    errorCode === "functions/invalid-argument" ||
    lowerMessage.includes("year and semester are required")
  ) {
    return {
      title: "현재 학기 정보를 확인하지 못했습니다.",
      message: "학기 설정을 다시 불러온 뒤 다시 시도해 주세요.",
    };
  }

  if (errorCode === "functions/failed-precondition") {
    return {
      title: "공개 랭킹을 새로 반영할 준비가 아직 끝나지 않았습니다.",
      message:
        "위스 현황 또는 학생 기본 정보가 아직 정리되지 않았습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  if (
    errorCode === "functions/internal" ||
    errorCode === "internal" ||
    lowerMessage === "internal"
  ) {
    return {
      title: "최신 위스 현황 반영 중 문제가 발생했습니다.",
      message:
        "공개 랭킹을 새로 반영하는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  if (
    errorCode === "functions/unavailable" ||
    errorCode === "functions/deadline-exceeded"
  ) {
    return {
      title: "최신 위스 현황 반영이 지연되고 있습니다.",
      message: "네트워크 상태를 확인한 뒤 잠시 후 다시 시도해 주세요.",
    };
  }

  return {
    title: "최신 위스 현황을 반영하지 못했습니다.",
    message: "잠시 후 다시 시도해 주세요.",
  };
};

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
  const [snapshotError, setSnapshotError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [featureSaving, setFeatureSaving] = useState(false);
  const [viewSaving, setViewSaving] = useState(false);
  const [previewScope, setPreviewScope] =
    useState<HallOfFamePreviewView>("grade");
  const [editorDeviceMode, setEditorDeviceMode] =
    useState<HallOfFameEditorDeviceMode>("desktop");
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(false);
  const [gradeKey, setGradeKey] = useState("");
  const [classKey, setClassKey] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
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
  const [layoutDraft, setLayoutDraft] = useState<LayoutDraft>(() =>
    pickLayoutDraft(pickViewDraft(initialDraft)),
  );

  const applySnapshotState = (nextSnapshot: WisHallOfFameSnapshot | null) => {
    setSnapshot(nextSnapshot);
    if (!nextSnapshot) {
      setSnapshotError(
        "현재 학기 공개 랭킹을 아직 불러오지 못했습니다. 지금 반영하거나 다음 자동 갱신 이후 다시 확인해 주세요.",
      );
      return;
    }
    if (isWisHallOfFameSnapshotStale(nextSnapshot)) {
      setSnapshotError(
        "공개 랭킹이 최신 위스 현황보다 오래되었습니다. 지금 반영하거나 다음 자동 갱신 이후 다시 확인해 주세요.",
      );
      return;
    }
    setSnapshotError("");
  };

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
    if (!layoutEditorOpen) {
      setLayoutDraft(pickLayoutDraft(nextViewDraft));
    }
  }, [interfaceConfig?.hallOfFame, layoutEditorOpen]);

  useEffect(
    () => () => {
      if (imagePreviewUrl.startsWith("blob:")) {
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
      setSnapshotError("");

      try {
        const nextSnapshot = await getWisHallOfFameSnapshot(config);
        if (!cancelled) {
          applySnapshotState(nextSnapshot);
        }
      } catch (error) {
        console.warn(
          "Failed to load hall of fame snapshot for teacher management:",
          error,
        );
        if (!cancelled) {
          setSnapshot(null);
          setSnapshotError(
            "공개 랭킹을 불러오지 못했습니다. 그래도 위스 관리 화면은 계속 사용할 수 있습니다.",
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
    () => buildCombinedConfig(featureDraft, viewDraft),
    [featureDraft, viewDraft],
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
        left.localeCompare(right, "ko-KR", { numeric: true }),
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
          left.localeCompare(right, "ko-KR", { numeric: true }),
        ),
    [gradeKey, snapshot],
  );

  useEffect(() => {
    if (!gradeKey || !gradeOptions.includes(gradeKey)) {
      setGradeKey(
        snapshot?.primaryGradeKey ||
          gradeOptions[0] ||
          WIS_HALL_OF_FAME_GRADE_KEY,
      );
    }
  }, [gradeKey, gradeOptions, snapshot?.primaryGradeKey]);

  useEffect(() => {
    if (!classOptions.length) {
      setClassKey("");
      return;
    }
    if (!classKey || !classOptions.includes(classKey)) {
      setClassKey(classOptions[0] || "");
    }
  }, [classKey, classOptions]);

  useEffect(() => {
    if (previewScope === "class" && !classKey) {
      setPreviewScope("grade");
    }
  }, [classKey, previewScope]);

  const previewClass = parseClassKey(classKey);
  const snapshotUpdatedAtLabel = snapshot?.updatedAt
    ? formatPointDateShortTime(snapshot.updatedAt)
    : "아직 없음";
  const nextAutomaticRefreshLabel = formatAdminDateTime(
    getNextHallOfFameAutoSyncMs(),
  );
  const clearImageSelection = () => {
    setImageFile(null);
    setImagePreviewUrl((previousValue) => {
      if (previousValue.startsWith("blob:")) {
        URL.revokeObjectURL(previousValue);
      }
      return "";
    });
  };

  const applySavedStudentViewDraft = (
    nextDraft: ReturnType<typeof createDraft>,
    options?: { preserveImageSelection?: boolean },
  ) => {
    const nextViewDraft = pickViewDraft(nextDraft);
    setSavedViewDraft(nextViewDraft);
    setViewDraft(nextViewDraft);
    if (!options?.preserveImageSelection) {
      clearImageSelection();
    }
    return nextViewDraft;
  };

  const refreshSavedInterfaceConfig = async () => {
    if (!onInterfaceConfigRefresh) return;

    invalidateSiteSettingDocCache("interface_config");
    await onInterfaceConfigRefresh().catch((error) => {
      console.warn(
        "Failed to refresh interface config after hall of fame student view save:",
        error,
      );
    });
  };

  const refreshSnapshot = async () => {
    if (!config) return;

    setRefreshing(true);
    try {
      await ensureWisHallOfFameSnapshot(config, { force: true });
      const nextSnapshot = await getWisHallOfFameSnapshot(config);
      applySnapshotState(nextSnapshot);
      showToast({
        tone: "success",
        title: "최신 위스 현황을 화랑의 전당에 반영했습니다.",
        message: "현재 학기 학생 위스 현황이 공개 랭킹에 반영됐습니다.",
      });
    } catch (error: any) {
      const failure = getHallOfFameSnapshotRefreshFailureText(error);
      setSnapshotError(failure.message);
      showToast({
        tone: "warning",
        title: failure.title,
        message: failure.message,
      });
    } finally {
      setRefreshing(false);
    }
  };

  const openLayoutEditor = () => {
    setLayoutDraft(
      pickLayoutDraft({
        ...viewDraft,
        positions: viewDraft.positions,
        leaderboardPanel: viewDraft.leaderboardPanel,
      }),
    );
    setLayoutEditorOpen(true);
  };

  const closeLayoutEditor = () => {
    setLayoutDraft(
      pickLayoutDraft({
        ...viewDraft,
        positions: viewDraft.positions,
        leaderboardPanel: viewDraft.leaderboardPanel,
      }),
    );
    setLayoutEditorOpen(false);
  };

  const saveLayoutEditor = () => {
    setViewDraft((previousValue) => ({
      ...previousValue,
      positions: layoutDraft.positions,
      leaderboardPanel: layoutDraft.leaderboardPanel,
    }));
    setLayoutEditorOpen(false);
  };

  const handleSaveAllChanges = async () => {
    if (!config || !canManage || (!featureDirty && !viewDirty)) return;

    const nextFeatureDraft = featureDirty ? featureDraft : savedFeatureDraft;
    let nextViewDraft: ViewDraft = viewDirty
      ? {
          ...viewDraft,
          podiumImageUrl: viewDraft.podiumImageUrl.trim(),
          podiumStoragePath: viewDraft.podiumStoragePath.trim(),
        }
      : savedViewDraft;

    setFeatureSaving(featureDirty);
    setViewSaving(viewDirty);

    try {
      if (imageFile) {
        const layoutOnlyDraft: ViewDraft = {
          ...nextViewDraft,
          podiumImageUrl: savedViewDraft.podiumImageUrl,
          podiumStoragePath: savedViewDraft.podiumStoragePath,
        };
        const hasNonImageChanges =
          featureDirty ||
          serializeViewDraft(layoutOnlyDraft) !==
            serializeViewDraft(savedViewDraft);

        try {
          const resizedBlob = await buildResizedImageBlob(
            imageFile,
            1600,
            0.84,
          );
          const imageRef = ref(
            storage,
            `${HALL_OF_FAME_PODIUM_STORAGE_DIR}/podium-${Date.now()}.jpg`,
          );

          await uploadBytes(imageRef, resizedBlob, {
            contentType: "image/jpeg",
            cacheControl: "public,max-age=86400",
          });

          nextViewDraft = {
            ...nextViewDraft,
            podiumImageUrl: await getDownloadURL(imageRef),
            podiumStoragePath: imageRef.fullPath,
          };
        } catch (imageError: any) {
          const uploadFailure = getHallOfFameImageUploadFailureText(imageError);

          if (hasNonImageChanges) {
            const result = await saveWisHallOfFameConfig(
              config,
              buildCombinedConfig(nextFeatureDraft, layoutOnlyDraft),
            );
            const nextDraft = createDraft(result.hallOfFame);
            const savedNextFeatureDraft = pickFeatureDraft(nextDraft);

            setSavedFeatureDraft(savedNextFeatureDraft);
            setFeatureDraft(savedNextFeatureDraft);
            applySavedStudentViewDraft(nextDraft, {
              preserveImageSelection: true,
            });
            await refreshSavedInterfaceConfig();
            applySnapshotState(await getWisHallOfFameSnapshot(config));

            showToast({
              tone: "warning",
              title: uploadFailure.title,
              message:
                "이미지를 제외한 변경사항은 저장했습니다. 이미지 권한을 확인한 뒤 다시 업로드해 주세요.",
            });
            return;
          }

          showToast({
            tone: "error",
            title: uploadFailure.title,
            message: uploadFailure.message,
          });
          return;
        }
      }

      const result = await saveWisHallOfFameConfig(
        config,
        buildCombinedConfig(nextFeatureDraft, nextViewDraft),
      );
      const nextDraft = createDraft(result.hallOfFame);
      const savedNextFeatureDraft = pickFeatureDraft(nextDraft);

      setSavedFeatureDraft(savedNextFeatureDraft);
      setFeatureDraft(savedNextFeatureDraft);
      applySavedStudentViewDraft(nextDraft);
      await refreshSavedInterfaceConfig();
      applySnapshotState(await getWisHallOfFameSnapshot(config));

      showToast({
        tone: "success",
        title: "화랑의 전당 변경사항을 저장했습니다.",
        message:
          "공개 범위, 팝업, 배경, 배치 설정을 현재 설정값으로 반영했습니다.",
      });
    } catch (error: any) {
      const failure = getHallOfFameConfigSaveFailureText(error);
      showToast({
        tone: "error",
        title: failure.title || "화랑의 전당 설정 저장에 실패했습니다.",
        message: failure.message || "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setFeatureSaving(false);
      setViewSaving(false);
    }
  };

  const hasUnsavedChanges = featureDirty || viewDirty;
  const savingChanges = featureSaving || viewSaving;
  const semesterLabel = `${snapshot?.year || config?.year || "-"}학년도 ${
    snapshot?.semester || config?.semester || "-"
  }학기`;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-950">
            화랑의 전당 관리
          </h2>
          <p className="mt-1 text-sm font-semibold text-slate-500 break-keep">
            학생에게 공개되는 시상대, 공개 랭킹, 팝업과 반영 상태를 한 화면에서
            관리합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleSaveAllChanges()}
          disabled={!canManage || !hasUnsavedChanges || savingChanges}
          className="inline-flex min-h-12 items-center justify-center whitespace-nowrap rounded-lg bg-slate-950 px-6 text-sm font-black text-white shadow-[0_12px_26px_rgba(15,23,42,0.18)] transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
        >
          {savingChanges ? "저장 중..." : "변경사항 저장"}
        </button>
      </div>

      {snapshotError && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-950 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <i
              className="fas fa-exclamation-circle mt-0.5 text-amber-500"
              aria-hidden="true"
            ></i>
            <p className="break-keep">{snapshotError}</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshSnapshot()}
            disabled={!canManage || refreshing}
            className="inline-flex min-h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-amber-300 bg-white px-4 text-sm font-black text-slate-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? "반영 중..." : "지금 반영"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-gray-400 shadow-sm">
          <div className="mb-2 text-2xl">
            <i className="fas fa-spinner fa-spin"></i>
          </div>
          <p className="font-bold">
            화랑의 전당 관리 데이터를 불러오는 중입니다.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,22rem)] 2xl:grid-cols-[minmax(0,1fr)_minmax(21rem,23rem)]">
          <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-black text-slate-950">
                    학생 화면 미리보기
                  </h3>
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                    최근 반영 {snapshotUpdatedAtLabel}
                  </span>
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-500 break-keep">
                  실제 학생 화면과 같은 컴포넌트로 전교/학급 공개 모습을
                  확인합니다.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setEditorDeviceMode("desktop")}
                    className={`inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-black transition ${
                      editorDeviceMode === "desktop"
                        ? "bg-slate-950 text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <i
                      className="fas fa-desktop text-xs"
                      aria-hidden="true"
                    ></i>
                    데스크톱
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditorDeviceMode("mobile")}
                    className={`inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-black transition ${
                      editorDeviceMode === "mobile"
                        ? "bg-slate-950 text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <i
                      className="fas fa-mobile-alt text-xs"
                      aria-hidden="true"
                    ></i>
                    모바일
                  </button>
                </div>

                <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setPreviewScope("grade")}
                    className={`min-h-9 rounded-md px-3 text-sm font-black transition ${
                      previewScope === "grade"
                        ? "bg-slate-950 text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    전교
                  </button>
                  <button
                    type="button"
                    onClick={() => classKey && setPreviewScope("class")}
                    disabled={!classKey}
                    className={`min-h-9 rounded-md px-3 text-sm font-black transition ${
                      previewScope === "class"
                        ? "bg-slate-950 text-white"
                        : "text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
                    }`}
                  >
                    학급
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor="hall-preview-grade">
                    전교 미리보기 학년
                  </label>
                  <select
                    id="hall-preview-grade"
                    value={gradeKey}
                    onChange={(event) => setGradeKey(event.target.value)}
                    className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm"
                  >
                    {gradeOptions.length === 0 && (
                      <option value={WIS_HALL_OF_FAME_GRADE_KEY}>
                        학년 없음
                      </option>
                    )}
                    {gradeOptions.map((option) => (
                      <option key={option} value={option}>
                        {`${option}학년 전교`}
                      </option>
                    ))}
                  </select>

                  <label className="sr-only" htmlFor="hall-preview-class">
                    학급 미리보기 대상
                  </label>
                  <select
                    id="hall-preview-class"
                    value={classKey}
                    onChange={(event) => setClassKey(event.target.value)}
                    disabled={classOptions.length === 0}
                    className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    {classOptions.length === 0 && (
                      <option value="">학급 없음</option>
                    )}
                    {classOptions.map((option) => {
                      const parsed = parseClassKey(option);
                      return (
                        <option key={option} value={option}>
                          {`${parsed.grade}학년 ${parsed.className}반`}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>
            </div>

            <div className="bg-slate-50/70 p-3 sm:p-4">
              <WisHallOfFameStudentPreview
                snapshot={snapshot}
                hallOfFameConfig={previewConfig}
                activeView={previewScope}
                onActiveViewChange={setPreviewScope}
                gradeKey={gradeKey}
                currentGrade={previewClass.grade}
                currentClass={previewClass.className}
                deviceMode={editorDeviceMode}
                showSnapshotAlert={!snapshotError}
              />
            </div>
          </section>

          <aside className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-black text-slate-950">관리 옵션</h3>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                {semesterLabel}
              </p>
            </div>

            <div className="divide-y divide-slate-100">
              <section className="space-y-4 px-4 py-5 2xl:px-5">
                <div className="flex items-center gap-2">
                  <i
                    className="fas fa-eye text-sm text-slate-500"
                    aria-hidden="true"
                  ></i>
                  <h4 className="text-sm font-black text-slate-950">
                    공개 범위
                  </h4>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs font-bold text-slate-600">
                      전교 공개 인원
                    </span>
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
                      disabled={!canManage}
                      className="mt-2 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-black text-slate-800 disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold text-slate-600">
                      학급 공개 인원
                    </span>
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
                      disabled={!canManage}
                      className="mt-2 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-black text-slate-800 disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </label>
                </div>
                <label className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3">
                  <span className="text-sm font-bold text-slate-700">
                    동점자 함께 공개
                  </span>
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
                    className="h-5 w-5 accent-blue-600"
                    disabled={!canManage}
                  />
                </label>
              </section>

              <section className="space-y-4 px-4 py-5 2xl:px-5">
                <div className="flex items-center gap-2">
                  <i
                    className="fas fa-sync-alt text-sm text-slate-500"
                    aria-hidden="true"
                  ></i>
                  <h4 className="text-sm font-black text-slate-950">
                    랭킹 반영
                  </h4>
                </div>
                <div className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-xl bg-slate-50 px-4 py-4">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-500">
                      최근 반영 시각
                    </p>
                    <p className="mt-1 text-sm font-black text-slate-950">
                      {snapshotUpdatedAtLabel}
                    </p>
                    <p className="mt-2 text-xs font-semibold text-slate-500 break-keep">
                      다음 자동 갱신 {nextAutomaticRefreshLabel}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshSnapshot()}
                    disabled={!canManage || refreshing}
                    className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg bg-slate-950 px-4 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {refreshing ? "반영 중..." : "지금 반영"}
                  </button>
                </div>
              </section>

              <section className="space-y-4 px-4 py-5 2xl:px-5">
                <div className="flex items-center gap-2">
                  <i
                    className="far fa-bell text-sm text-slate-500"
                    aria-hidden="true"
                  ></i>
                  <h4 className="text-sm font-black text-slate-950">
                    입상 팝업
                  </h4>
                </div>
                {[
                  {
                    label: "전체 팝업",
                    checked: featureDraft.recognitionPopup.enabled,
                    disabled: !canManage,
                    onChange: (checked: boolean) =>
                      setFeatureDraft((previousValue) => ({
                        ...previousValue,
                        recognitionPopup: {
                          ...previousValue.recognitionPopup,
                          enabled: checked,
                        },
                      })),
                  },
                  {
                    label: "전교 팝업",
                    checked: featureDraft.recognitionPopup.gradeEnabled,
                    disabled:
                      !canManage || !featureDraft.recognitionPopup.enabled,
                    onChange: (checked: boolean) =>
                      setFeatureDraft((previousValue) => ({
                        ...previousValue,
                        recognitionPopup: {
                          ...previousValue.recognitionPopup,
                          gradeEnabled: checked,
                        },
                      })),
                  },
                  {
                    label: "학급 팝업",
                    checked: featureDraft.recognitionPopup.classEnabled,
                    disabled:
                      !canManage || !featureDraft.recognitionPopup.enabled,
                    onChange: (checked: boolean) =>
                      setFeatureDraft((previousValue) => ({
                        ...previousValue,
                        recognitionPopup: {
                          ...previousValue.recognitionPopup,
                          classEnabled: checked,
                        },
                      })),
                  },
                ].map((item) => (
                  <label
                    key={item.label}
                    className="flex items-center justify-between gap-4"
                  >
                    <span className="text-sm font-bold text-slate-700">
                      {item.label}
                    </span>
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={(event) => item.onChange(event.target.checked)}
                      disabled={item.disabled}
                      className="h-5 w-5 accent-blue-600 disabled:opacity-40"
                    />
                  </label>
                ))}
              </section>

              <section className="space-y-4 px-4 py-5 2xl:px-5">
                <div className="flex items-center gap-2">
                  <i
                    className="far fa-image text-sm text-slate-500"
                    aria-hidden="true"
                  ></i>
                  <h4 className="text-sm font-black text-slate-950">
                    배경 / 배치
                  </h4>
                </div>
                <div className="grid grid-cols-[7.5rem_1fr] gap-4">
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    <img
                      src={imageUrl}
                      alt="화랑의 전당 배경"
                      className="h-full min-h-[4.5rem] w-full object-cover"
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <label className="inline-flex min-h-10 cursor-pointer items-center justify-center whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 text-sm font-black text-slate-700 transition hover:bg-slate-100">
                      배경 변경
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          if (!file) return;
                          setImageFile(file);
                          setImagePreviewUrl((previousValue) => {
                            if (previousValue.startsWith("blob:")) {
                              URL.revokeObjectURL(previousValue);
                            }
                            return URL.createObjectURL(file);
                          });
                          event.target.value = "";
                        }}
                        disabled={!canManage}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={openLayoutEditor}
                      disabled={!canManage}
                      className="inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-lg bg-slate-950 px-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      배치 편집 열기
                    </button>
                  </div>
                </div>
                {imageFile && (
                  <div className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 break-all">
                    새 배경 선택됨: {imageFile.name}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    clearImageSelection();
                    setViewDraft((previousValue) => ({
                      ...previousValue,
                      podiumImageUrl: "",
                      podiumStoragePath: "",
                    }));
                  }}
                  disabled={!canManage}
                  className="inline-flex min-h-10 w-full items-center justify-center whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  기본 배치 이미지 복원
                </button>
              </section>

              <section className="space-y-3 px-4 py-5 2xl:px-5">
                <div className="flex items-center gap-2">
                  <i
                    className="fas fa-cog text-sm text-slate-500"
                    aria-hidden="true"
                  ></i>
                  <h4 className="text-sm font-black text-slate-950">
                    화면 유지 설정
                  </h4>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3">
                  <span className="text-sm font-bold text-slate-700">
                    랭킹을 못 불러와도 화면 계속 열기
                  </span>
                  <span className="inline-flex rounded-full bg-blue-600 px-3 py-1 text-xs font-black text-white">
                    켜짐
                  </span>
                </div>
                <p className="text-xs font-semibold text-slate-500 break-keep">
                  공개 랭킹을 잠시 불러오지 못해도 이 관리 화면은 닫히지
                  않습니다.
                </p>
              </section>
            </div>
          </aside>
        </div>
      )}

      {layoutEditorOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
          onClick={closeLayoutEditor}
        >
          <div
            className="flex max-h-[min(96vh,78rem)] w-full max-w-[min(96vw,118rem)] flex-col overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.32)]"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="화랑의 전당 배치 편집"
          >
            <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[11px] font-black tracking-[0.18em] text-amber-600">
                    배치 편집
                  </div>
                  <h3 className="mt-2 text-xl font-black text-slate-900">
                    화랑의 전당 배치 편집
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500 break-keep">
                    1위, 2위, 3위 시상대와 우측 공개 랭킹 패널을 충분히 큰
                    캔버스에서 직접 움직여 배치합니다. 저장 전까지는 학생 화면
                    설정에 반영되지 않습니다.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeLayoutEditor}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                  aria-label="배치 편집 닫기"
                >
                  <i className="fas fa-times" aria-hidden="true"></i>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                <span className="inline-flex items-center whitespace-nowrap rounded-full bg-slate-900 px-3 py-1 text-white">
                  {editorDeviceMode === "desktop"
                    ? "데스크톱 편집 중"
                    : "모바일 편집 중"}
                </span>
                <span className="inline-flex items-center whitespace-nowrap rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                  드래그 후 저장
                </span>
                <span className="inline-flex items-center whitespace-nowrap rounded-full bg-sky-50 px-3 py-1 text-sky-700">
                  저장 전까지 미리보기는 유지
                </span>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 p-5 sm:p-6 lg:p-7">
              <WisHallOfFamePositionEditor
                value={layoutDraft}
                imageUrl={imageUrl}
                hallOfFameConfig={previewConfig}
                snapshot={snapshot}
                previewView={previewScope}
                gradeKey={gradeKey}
                currentGrade={previewClass.grade}
                currentClass={previewClass.className}
                deviceMode={editorDeviceMode}
                onDeviceModeChange={setEditorDeviceMode}
                onReset={() =>
                  setLayoutDraft({
                    positions: getDefaultHallOfFamePositions(),
                    leaderboardPanel:
                      getDefaultHallOfFameLeaderboardPanelPosition(),
                  })
                }
                onChange={setLayoutDraft}
                disabled={!canManage}
                showPreviewStage
              />
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="text-sm text-slate-500 break-keep">
                취소하면 이번 모달에서 조정한 배치는 버리고, 저장하면 학생 화면
                설정에 반영됩니다.
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeLayoutEditor}
                  className="inline-flex min-h-11 items-center whitespace-nowrap break-keep rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-100"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={saveLayoutEditor}
                  disabled={!canManage}
                  className="inline-flex min-h-11 items-center whitespace-nowrap break-keep rounded-lg bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  배치 편집 저장
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HallOfFameManagementTab;
