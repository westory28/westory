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
    customNameConfirmed?: boolean;
    grade?: string;
    class?: string;
    number?: string;
    role: 'teacher' | 'student' | 'staff';
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
    targetType: 'all' | 'common' | 'class';
    targetClass?: string;
    dDay?: number;
}

export type PointTransactionType =
    | 'attendance'
    | 'attendance_monthly_bonus'
    | 'quiz'
    | 'lesson'
    | 'manual_adjust'
    | 'purchase_hold'
    | 'purchase_confirm'
    | 'purchase_cancel';

export type PointOrderStatus =
    | 'requested'
    | 'approved'
    | 'rejected'
    | 'fulfilled'
    | 'cancelled';

export interface PointWallet {
    uid: string;
    studentName: string;
    grade: string;
    class: string;
    number: string;
    balance: number;
    earnedTotal: number;
    spentTotal: number;
    adjustedTotal: number;
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

export interface PointPolicy {
    attendanceDaily: number;
    attendanceMonthlyBonus: number;
    lessonView: number;
    quizSolve: number;
    manualAdjustEnabled: boolean;
    allowNegativeBalance: boolean;
    updatedAt?: any;
    updatedBy: string;
}

export type SourceArchiveAssetType =
    | 'photo'
    | 'map'
    | 'document'
    | 'poster'
    | 'artifact'
    | 'other';

export type SourceArchiveProcessingStatus = 'processing' | 'ready' | 'failed';

export interface SourceArchiveImageMeta {
    storagePath: string;
    thumbPath: string;
    displayPath: string;
    mime: string;
    width: number;
    height: number;
    byteSize: number;
    thumbWidth: number;
    thumbHeight: number;
    thumbByteSize: number;
    displayWidth: number;
    displayHeight: number;
    displayByteSize: number;
    originalName?: string;
    pendingUploadToken?: string;
    pendingUploadPath?: string;
}

export interface SourceArchiveAsset {
    id: string;
    title: string;
    description: string;
    era: string;
    subject: string;
    unit: string;
    type: SourceArchiveAssetType;
    tags: string[];
    source: string;
    searchText: string;
    processingStatus: SourceArchiveProcessingStatus;
    processingError: string;
    image: SourceArchiveImageMeta;
    createdAt?: any;
    updatedAt?: any;
    createdBy?: string;
    updatedBy?: string;
}

export interface SourceArchiveDraft {
    id?: string;
    title: string;
    description: string;
    era: string;
    subject: string;
    unit: string;
    type: SourceArchiveAssetType;
    tags: string[];
    source: string;
    searchText?: string;
    processingStatus?: SourceArchiveProcessingStatus;
    processingError?: string;
    image?: Partial<SourceArchiveImageMeta>;
    createdAt?: any;
    updatedAt?: any;
    createdBy?: string;
    updatedBy?: string;
}
