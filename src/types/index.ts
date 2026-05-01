export interface SystemConfig {
  year: string;
  semester: string;
  showQuiz: boolean;
  showScore: boolean;
  showLesson: boolean;
}

export interface InterfaceConfig {
  mainEmoji: string;
  mainSubtitle: string;
  ddayEnabled: boolean;
  ddayTitle: string;
  ddayDate: string;
  footerText?: string;
  hallOfFame?: HallOfFameInterfaceConfig;
}

export type HallOfFamePodiumSlotKey = "first" | "second" | "third";

export interface HallOfFamePodiumSlotPosition {
  leftPercent: number;
  topPercent: number;
  widthPercent: number;
}

export interface HallOfFamePodiumPositions {
  first: HallOfFamePodiumSlotPosition;
  second: HallOfFamePodiumSlotPosition;
  third: HallOfFamePodiumSlotPosition;
}

export interface HallOfFameLeaderboardPanelPosition {
  leftPercent: number;
  topPercent: number;
  widthPercent: number;
}

export interface HallOfFameResponsiveLeaderboardPanelPosition {
  desktop?: Partial<HallOfFameLeaderboardPanelPosition>;
  mobile?: Partial<HallOfFameLeaderboardPanelPosition>;
}

export interface HallOfFamePublicRangeConfig {
  gradeRankLimit?: number;
  classRankLimit?: number;
  includeTies?: boolean;
}

export interface HallOfFameRecognitionPopupConfig {
  enabled?: boolean;
  gradeEnabled?: boolean;
  classEnabled?: boolean;
}

export interface HallOfFameInterfaceConfig {
  podiumImageUrl?: string;
  podiumStoragePath?: string;
  positionPreset?: string;
  positions?: {
    desktop?: Partial<HallOfFamePodiumPositions>;
    mobile?: Partial<HallOfFamePodiumPositions>;
  };
  leaderboardPanel?: HallOfFameResponsiveLeaderboardPanelPosition;
  publicRange?: HallOfFamePublicRangeConfig;
  recognitionPopup?: HallOfFameRecognitionPopupConfig;
}

export interface UserData {
  uid: string;
  email: string;
  photoURL?: string;
  name?: string;
  profileIcon?: string;
  profileEmojiId?: string;
  customNameConfirmed?: boolean;
  grade?: string;
  class?: string;
  number?: string;
  role: "teacher" | "student" | "staff";
  staffPermissions?: string[];
  teacherPortalEnabled?: boolean;
  privacyAgreed?: boolean;
  privacyAgreedAt?: any;
  consentAgreedItems?: string[];
  scoreWarningAcknowledged?: boolean;
  scoreWarningAcknowledgedAt?: any;
}

export interface PointStudentTarget {
  uid: string;
  studentName: string;
  grade: string;
  class: string;
  number: string;
  email?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  start: string;
  end?: string;
  eventType: string;
  targetType: "all" | "common" | "class";
  targetClass?: string;
  dDay?: number;
}

export type PointTransactionType =
  | "attendance"
  | "attendance_monthly_bonus"
  | "attendance_milestone_bonus"
  | "quiz"
  | "quiz_bonus"
  | "lesson"
  | "think_cloud"
  | "map_tag"
  | "history_classroom"
  | "history_classroom_bonus"
  | "manual_adjust"
  | "manual_reclaim"
  | "purchase_hold"
  | "purchase_confirm"
  | "purchase_cancel";

export type PointOrderStatus =
  | "requested"
  | "approved"
  | "rejected"
  | "fulfilled"
  | "cancelled";

export interface PointWallet {
  uid: string;
  studentName: string;
  grade: string;
  class: string;
  number: string;
  balance: number;
  earnedTotal: number;
  rankEarnedTotal?: number;
  spentTotal: number;
  adjustedTotal: number;
  rankSnapshot?: PointWalletRankSnapshot | null;
  lastTransactionAt?: any;
}

export interface PointTransaction {
  id: string;
  uid: string;
  type: PointTransactionType;
  activityType?: PointTransactionType;
  delta: number;
  balanceAfter: number;
  sourceId: string;
  sourceLabel: string;
  policyId: string;
  createdBy: string;
  targetMonth?: string;
  targetDate?: string;
  createdAt?: any;
}

export interface PointProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  isActive: boolean;
  sortOrder: number;
  imageUrl: string;
  previewImageUrl?: string;
  imageStoragePath?: string;
  previewStoragePath?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface PointOrder {
  id: string;
  uid: string;
  studentName: string;
  productId: string;
  productName: string;
  priceSnapshot: number;
  status: PointOrderStatus;
  stockDeducted?: boolean;
  requestedAt?: any;
  reviewedAt?: any;
  reviewedBy: string;
  memo: string;
}

export type WestoryNotificationType =
  | "history_classroom_assigned"
  | "history_classroom_submitted"
  | "point_order_requested"
  | "point_order_reviewed"
  | "lesson_worksheet_published"
  | "question_created"
  | "question_replied"
  | "system_notice";

export type WestoryNotificationPriority = "normal" | "high";

export interface WestoryNotification {
  id: string;
  type: WestoryNotificationType;
  title: string;
  body: string;
  targetUrl: string;
  entityType: string;
  entityId: string;
  actorUid: string;
  recipientUid: string;
  priority: WestoryNotificationPriority;
  dedupeKey: string;
  broadcast?: boolean;
  readAt?: any;
  createdAt?: any;
  expiresAt?: any;
}

export interface WestoryNotificationInbox {
  uid: string;
  unreadCount: number;
  updatedAt?: any;
  lastReadAt?: any;
  lastBroadcastReadAt?: any;
  broadcastClearedAt?: any;
}

export type PointRankTierCode = `tier_${number}`;

export type PointRankThemeId = "korean_golpum" | "world_nobility";

export type PointRankBadgeStyleToken =
  | "stone"
  | "blue"
  | "sky"
  | "emerald"
  | "mint"
  | "yellow"
  | "orange"
  | "red"
  | "pink"
  | "violet"
  | "amber"
  | "rose";

export type PointRankBasedOn =
  | "earnedTotal"
  | "earnedTotal_plus_positive_manual_adjust";

export interface PointRankPolicyTier {
  code: PointRankTierCode;
  minPoints: number;
  label?: string;
  shortLabel?: string;
  description?: string;
  badgeStyleToken?: PointRankBadgeStyleToken | string;
  allowedEmojiIds?: string[];
}

export interface PointRankEmojiPolicyTier {
  allowedEmojiIds: string[];
}

export type PointRankEmojiPolicyTiers = Partial<
  Record<PointRankTierCode, PointRankEmojiPolicyTier>
>;

export interface PointRankEmojiRegistryEntry {
  id: string;
  emoji: string;
  value?: string;
  label: string;
  category: string;
  sortOrder: number;
  enabled: boolean;
  unlockTierCode?: PointRankTierCode;
  legacyValues?: string[];
}

export interface PointRankEmojiPolicy {
  enabled: boolean;
  defaultEmojiId: string;
  legacyMode?: "keep_selected" | "strict";
  tiers: PointRankEmojiPolicyTiers;
}

export interface PointRankThemeTierOverride {
  label?: string;
  shortLabel?: string;
  description?: string;
  badgeStyleToken?: PointRankBadgeStyleToken | string;
}

export interface PointRankThemeOverride {
  themeName?: string;
  tiers?: Partial<Record<PointRankTierCode, PointRankThemeTierOverride>>;
}

export type PointRankThemeOverrides = Partial<
  Record<PointRankThemeId, PointRankThemeOverride>
>;

export interface PointRankCelebrationPolicy {
  enabled: boolean;
  effectLevel: "subtle" | "standard";
}

export interface PointRankPolicy {
  enabled: boolean;
  activeThemeId: PointRankThemeId;
  themeId?: PointRankThemeId;
  basedOn: PointRankBasedOn;
  tiers: PointRankPolicyTier[];
  themes?: PointRankThemeOverrides;
  emojiRegistry: PointRankEmojiRegistryEntry[];
  emojiPolicy: PointRankEmojiPolicy;
  celebrationPolicy: PointRankCelebrationPolicy;
}

export interface PointWalletRankSnapshot {
  tierCode: PointRankTierCode;
  metricValue: number;
  basedOn: PointRankBasedOn;
  updatedAt?: any;
}

export interface PointPolicyRewardRule {
  enabled: boolean;
  amount: number;
}

export interface PointPolicyActivityRewardRule extends PointPolicyRewardRule {
  cooldownHours?: number;
  maxClaims?: number;
}

export interface PointPolicyQuizBonusRule {
  enabled: boolean;
  thresholdScore: number;
  amount: number;
}

export interface PointPolicyAttendanceMilestoneBonusRule {
  enabled: boolean;
  amounts: {
    "50": number;
    "100": number;
    "200": number;
    "300": number;
  };
}

export interface PointRewardPolicy {
  autoEnabled: boolean;
  attendance: PointPolicyRewardRule;
  quiz: PointPolicyRewardRule;
  lesson: PointPolicyRewardRule;
  thinkCloud: PointPolicyActivityRewardRule;
  mapTag: PointPolicyActivityRewardRule;
  historyClassroom: PointPolicyActivityRewardRule;
  attendanceMonthlyBonus: PointPolicyRewardRule;
  quizBonus: PointPolicyQuizBonusRule;
  historyClassroomBonus: PointPolicyQuizBonusRule;
  attendanceMilestoneBonus: PointPolicyAttendanceMilestoneBonusRule;
}

export interface PointControlPolicy {
  manualAdjustEnabled: boolean;
  allowNegativeBalance: boolean;
}

export interface PointPolicy {
  attendanceDaily: number;
  attendanceMonthlyBonus: number;
  lessonView: number;
  quizSolve: number;
  thinkCloudEnabled: boolean;
  thinkCloudAmount: number;
  thinkCloudMaxClaims: number;
  mapTagEnabled: boolean;
  mapTagAmount: number;
  mapTagMaxClaims: number;
  historyClassroomEnabled: boolean;
  historyClassroomAmount: number;
  historyClassroomBonusEnabled: boolean;
  historyClassroomBonusThreshold: number;
  historyClassroomBonusAmount: number;
  attendanceMilestoneBonusEnabled: boolean;
  attendanceMilestone50: number;
  attendanceMilestone100: number;
  attendanceMilestone200: number;
  attendanceMilestone300: number;
  autoRewardEnabled: boolean;
  quizBonusEnabled: boolean;
  quizBonusThreshold: number;
  quizBonusAmount: number;
  manualAdjustEnabled: boolean;
  allowNegativeBalance: boolean;
  rewardPolicy: PointRewardPolicy;
  controlPolicy: PointControlPolicy;
  rankPolicy: PointRankPolicy;
  updatedAt?: any;
  updatedBy: string;
}

export interface WisHallOfFameEntry {
  uid: string;
  rank: number;
  podiumSlot?: 1 | 2 | 3;
  grade: string;
  class: string;
  classKey: string;
  studentName: string;
  displayName: string;
  currentBalance: number;
  cumulativeEarned: number;
  profileIcon: string;
  profileEmojiId?: string;
}

export interface WisHallOfFameLeaderboardPolicy {
  gradeRankLimit: number;
  classRankLimit: number;
  includeTies: boolean;
  storedRankLimit?: number;
}

export interface WisHallOfFameLeaderboardMeta {
  storedRankLimit: number;
  visibleCount: number;
  totalCandidates: number;
  cutoffOrdinal: number;
  cutoffRank: number;
  cutoffCumulativeEarned: number;
  includeTies: boolean;
}

export interface WisHallOfFameSnapshot {
  year?: string;
  semester?: string;
  snapshotVersion: number;
  snapshotKey: string;
  rankingMetric: "cumulativeEarned";
  primaryGradeKey?: string;
  gradeTop3ByGrade: Record<string, WisHallOfFameEntry[]>;
  classTop3ByClassKey: Record<string, WisHallOfFameEntry[]>;
  gradeLeaderboardByGrade: Record<string, WisHallOfFameEntry[]>;
  classLeaderboardByClassKey: Record<string, WisHallOfFameEntry[]>;
  gradeLeaderboardMetaByGrade?: Record<string, WisHallOfFameLeaderboardMeta>;
  classLeaderboardMetaByClassKey?: Record<string, WisHallOfFameLeaderboardMeta>;
  leaderboardPolicy?: WisHallOfFameLeaderboardPolicy;
  updatedAt?: any;
  updatedAtMs?: number;
  sourceUpdatedAtMs?: number;
}

export interface WisHallOfFameRecognition {
  scope: "grade" | "class";
  scopeKey: string;
  entry: WisHallOfFameEntry;
  snapshotKey: string;
}

export interface WisHallOfFameEnsureResult {
  ensured: boolean;
  snapshotKey: string;
  snapshotVersion: number;
}

export type SourceArchiveAssetType =
  | "photo"
  | "map"
  | "document"
  | "poster"
  | "artifact"
  | "other";

export type SourceArchiveLifecycleStatus =
  | "uploading"
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "archived";

export type SourceArchiveProcessingStatus = SourceArchiveLifecycleStatus;

export type SourceArchiveExtractionStatus =
  | "not-applicable"
  | "queued"
  | "processing"
  | "ready"
  | "failed";

export type SourceArchiveMediaKind = "image" | "pdf";

export type SourceArchiveSearchStatus =
  | "metadata-only"
  | "pending"
  | "ready"
  | "failed";

export interface SourceArchiveFileMeta {
  storagePath: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  revision: string;
  originalAvailable: boolean;
  legacyPreviewOnly: boolean;
  pendingUploadToken?: string;
  pendingUploadPath?: string;
}

export interface SourceArchiveSearchMeta {
  status: SourceArchiveSearchStatus;
  artifactPath: string;
  previewText: string;
  updatedAt?: any;
}

export interface SourceArchiveImageMeta {
  storagePath: string;
  originalPath: string;
  thumbPath: string;
  displayPath: string;
  mime: string;
  originalMime: string;
  width: number;
  height: number;
  byteSize: number;
  originalWidth: number;
  originalHeight: number;
  originalByteSize: number;
  thumbWidth: number;
  thumbHeight: number;
  thumbByteSize: number;
  displayWidth: number;
  displayHeight: number;
  displayByteSize: number;
  revision?: string;
  originalName?: string;
  pendingUploadToken?: string;
  pendingUploadPath?: string;
}

export interface SourceArchiveAsset {
  id: string;
  schemaVersion: number;
  mediaKind: SourceArchiveMediaKind;
  status: SourceArchiveLifecycleStatus;
  currentRevision: string;
  title: string;
  description: string;
  era: string;
  subject: string;
  unit: string;
  type: SourceArchiveAssetType;
  tags: string[];
  source: string;
  searchText: string;
  previewText: string;
  pageCount: number;
  file: SourceArchiveFileMeta;
  search: SourceArchiveSearchMeta;
  processingStatus: SourceArchiveProcessingStatus;
  extractionStatus: SourceArchiveExtractionStatus;
  extractionVersion: string;
  extractedContentPath: string;
  extractedManifestPath: string;
  parserKind: string;
  parseErrorMessage: string;
  processingError: string;
  processedAt?: any;
  extractedAt?: any;
  image: SourceArchiveImageMeta;
  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
  updatedBy?: string;
}

export interface SourceArchiveDraft {
  id?: string;
  schemaVersion?: number;
  mediaKind?: SourceArchiveMediaKind;
  status?: SourceArchiveLifecycleStatus;
  currentRevision?: string;
  title: string;
  description: string;
  era: string;
  subject: string;
  unit: string;
  type: SourceArchiveAssetType;
  tags: string[];
  source: string;
  searchText?: string;
  previewText?: string;
  pageCount?: number;
  file?: Partial<SourceArchiveFileMeta>;
  search?: Partial<SourceArchiveSearchMeta>;
  processingStatus?: SourceArchiveProcessingStatus;
  extractionStatus?: SourceArchiveExtractionStatus;
  extractionVersion?: string;
  extractedContentPath?: string;
  extractedManifestPath?: string;
  parserKind?: string;
  parseErrorMessage?: string;
  processingError?: string;
  processedAt?: any;
  extractedAt?: any;
  image?: Partial<SourceArchiveImageMeta>;
  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
  updatedBy?: string;
}
