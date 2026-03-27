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
}

export interface UserData {
  uid: string;
  email: string;
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
  | "quiz"
  | "quiz_bonus"
  | "lesson"
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
  requestedAt?: any;
  reviewedAt?: any;
  reviewedBy: string;
  memo: string;
}

export type PointRankTierCode = `tier_${number}`;

export type PointRankThemeId =
  | "korean_golpum"
  | "world_nobility";

export type PointRankBadgeStyleToken =
  | "stone"
  | "blue"
  | "emerald"
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

export type PointRankEmojiPolicyTiers = Partial<Record<PointRankTierCode, PointRankEmojiPolicyTier>>;

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

export type PointRankThemeOverrides = Partial<Record<PointRankThemeId, PointRankThemeOverride>>;

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

export interface PointPolicyQuizBonusRule {
  enabled: boolean;
  thresholdScore: number;
  amount: number;
}

export interface PointRewardPolicy {
  autoEnabled: boolean;
  attendance: PointPolicyRewardRule;
  quiz: PointPolicyRewardRule;
  lesson: PointPolicyRewardRule;
  attendanceMonthlyBonus: PointPolicyRewardRule;
  quizBonus: PointPolicyQuizBonusRule;
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
