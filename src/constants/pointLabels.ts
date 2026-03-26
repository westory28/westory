import type {
    PointOrderStatus,
    PointPolicy,
    PointRankBadgeStyleToken,
    PointRankThemeId,
    PointTransactionType,
} from '../types';

export const TEACHER_POINT_TAB_LABELS = {
    overview: '\uD3EC\uC778\uD2B8 \uD604\uD669',
    grant: '\uD3EC\uC778\uD2B8 \uBD80\uC5EC',
    policy: '\uC6B4\uC601 \uC815\uCC45',
    ranks: '\uB4F1\uAE09 \uC124\uC815',
    products: '\uC0C1\uD488 \uAD00\uB9AC',
    requests: '\uAD6C\uB9E4 \uC694\uCCAD \uAD00\uB9AC',
} as const;

export const POINT_RANK_THEME_LABELS: Record<PointRankThemeId, string> = {
    korean_golpum: '\uD55C\uAD6D\uC0AC',
    world_nobility: '\uC138\uACC4\uC0AC',
};

export const POINT_RANK_THEME_DETAIL_LABELS: Record<PointRankThemeId, string> = {
    korean_golpum: '\uD55C\uAD6D\uC0AC \uACE8\uD488\uC81C',
    world_nobility: '\uC138\uACC4\uC0AC \uADC0\uC871\uC81C',
};

export const POINT_RANK_BADGE_STYLE_OPTIONS: Array<{ value: PointRankBadgeStyleToken | string; label: string }> = [
    { value: 'stone', label: '\uAE30\uBCF8 \uC11D\uC0C9' },
    { value: 'blue', label: '\uBE14\uB8E8' },
    { value: 'emerald', label: '\uC5D0\uBA54\uB784\uB4DC' },
    { value: 'amber', label: '\uC554\uBC84' },
    { value: 'rose', label: '\uB85C\uC988' },
];

export const POINT_RANK_CELEBRATION_EFFECT_LABELS = {
    subtle: '\uC808\uC81C\uD615',
    standard: '\uD45C\uC900',
} as const;

export const POINT_RANK_FIELD_LABELS = {
    activeThemeId: '\uD65C\uC131 \uD14C\uB9C8',
    tierThreshold: '\uB4F1\uAE09 \uAE30\uC900 \uD3EC\uC778\uD2B8',
    tierLabel: '\uB4F1\uAE09 \uC774\uB984',
    tierShortLabel: '\uC57D\uCE6D',
    tierDescription: '\uC124\uBA85',
    badgeStyleToken: '\uBC30\uC9C0 \uC2A4\uD0C0\uC77C',
    allowedEmojiIds: '\uD5C8\uC6A9 \uC774\uBAA8\uC9C0',
    addTier: '\uB4F1\uAE09 \uCD94\uAC00',
    deleteTier: '\uC0AD\uC81C',
    registryId: '\uC774\uBAA8\uC9C0 ID',
    registryEmoji: '\uC774\uBAA8\uC9C0',
    registryLabel: '\uD45C\uC2DC\uBA85',
    registryCategory: '\uBD84\uB958',
    registrySortOrder: '\uC815\uB82C\uAC12',
    registryUnlockTierCode: '\uD574\uC81C \uB4F1\uAE09',
    registryEnabled: '\uD65C\uC131',
    addRegistryItem: '\uC774\uBAA8\uC9C0 \uCD94\uAC00',
    celebrationEnabled: '\uB4F1\uAE09 \uCD95\uD558 \uD6A8\uACFC \uC0AC\uC6A9',
    celebrationEffectLevel: '\uCD95\uD558 \uAC15\uB3C4',
} as const;

export const POINT_RANK_FIELD_HELPERS = {
    activeThemeId: '\uD604\uC7AC \uC800\uC7A5\uB418\uB294 \uD14C\uB9C8\uC785\uB2C8\uB2E4. \uB098\uBA38\uC9C0 \uD14C\uB9C8\uB294 \uBBF8\uB9AC\uBCF4\uAE30\uC5D0\uC11C \uBE44\uAD50\uD569\uB2C8\uB2E4.',
    tierThreshold: '\uC785\uB825 \uC911\uC5D0\uB294 \uCE74\uB4DC \uC21C\uC11C\uAC00 \uC720\uC9C0\uB418\uBA70, \uC800\uC7A5 \uC2DC \uAE30\uC900 \uD3EC\uC778\uD2B8 \uC21C\uC11C\uAC00 \uC790\uB3D9\uC73C\uB85C \uC815\uB9AC\uB429\uB2C8\uB2E4.',
    tierLabel: '\uD654\uBA74\uC5D0 \uBCF4\uC774\uB294 \uC815\uC2DD \uB4F1\uAE09 \uC774\uB984\uC785\uB2C8\uB2E4.',
    tierShortLabel: '\uB9AC\uC2A4\uD2B8, \uBC30\uC9C0, \uC2A4\uD0C0\uC77C \uD45C\uC2DC\uC5D0 \uC0AC\uC6A9\uD558\uAE30 \uC88B\uC740 \uC57D\uCE6D\uC785\uB2C8\uB2E4.',
    tierDescription: '\uD604\uC7AC \uB4F1\uAE09\uC774 \uC5B4\uB5A4 \uC758\uBBF8\uC778\uC9C0 \uC124\uBA85\uD569\uB2C8\uB2E4.',
    badgeStyleToken: '\uBC30\uC9C0 \uC0C9\uC0C1 \uD0A4\uC6CC\uB4DC\uB97C \uC120\uD0DD\uD569\uB2C8\uB2E4.',
    allowedEmojiIds: '\uC774 \uB4F1\uAE09\uB9CC \uC4F0\uC5D0 \uB3FC \uC788\uB294 \uC774\uBAA8\uC9C0\uB97C \uC120\uD0DD\uD569\uB2C8\uB2E4.',
    addTier: '\uB4F1\uAE09\uC744 \uCD94\uAC00\uD558\uBA74 \uAE30\uC900 \uD3EC\uC778\uD2B8\uAC00 \uB192\uC740 \uC21C\uC11C\uB85C \uB354\uC90D\uB2C8\uB2E4.',
    deleteTier: '\uB4F1\uAE09\uC744 \uC0AD\uC81C\uD558\uBA74 \uAD00\uB828 \uD14C\uB9C8 \uBC0F \uC774\uBAA8\uC9C0 \uB3D9\uAE30\uD654\uAC00 \uC81C\uAC70\uB429\uB2C8\uB2E4.',
    registryId: '\uC774\uBAA8\uC9C0 \uB3D9\uC77C\uC131\uC744 \uC704\uD574 \uACE0\uC720 ID\uB97C \uC0AC\uC6A9\uD569\uB2C8\uB2E4.',
    registryEmoji: '\uD574\uB2F9 \uB4F1\uAE09\uC744 \uB300\uD45C\uD558\uB294 \uC2E4\uC81C \uC774\uBAA8\uC9C0\uC785\uB2C8\uB2E4.',
    registryLabel: '\uAD00\uB9AC \uD654\uBA74\uC5D0 \uBCF4\uC77C \uC774\uB984\uC785\uB2C8\uB2E4.',
    registryCategory: '\uBE44\uC2B7\uD55C \uC774\uBAA8\uC9C0\uB97C \uADF8\uB8F9\uC73C\uB85C \uBAA8\uC558\uC744 \uB54C \uD3B8\uD558\uAC8C \uD569\uB2C8\uB2E4.',
    registrySortOrder: '\uC774\uBAA8\uC9C0 \uB9AC\uC2A4\uD2B8 \uC21C\uC11C\uB97C \uACB0\uC815\uD569\uB2C8\uB2E4.',
    registryUnlockTierCode: '\uD574\uB2F9 \uC774\uBAA8\uC9C0\uB97C \uC5B8\uC81C \uC5F4 \uC218 \uC788\uB294\uC9C0 \uC9C0\uC815\uD569\uB2C8\uB2E4.',
    registryEnabled: '\uBE44\uD65C\uC131\uD654\uD558\uBA74 \uD3B8\uC9D1\uB9CC \uB0A8\uACE0 \uB2E4\uB978 \uD654\uBA74\uC5D0\uC11C\uB294 \uBE60\uC9D1\uB2C8\uB2E4.',
    addRegistryItem: '\uC0C8 \uC774\uBAA8\uC9C0\uB97C \uCD94\uAC00\uD569\uB2C8\uB2E4.',
    celebrationEnabled: '\uB4F1\uAE09 \uC0C1\uC2B9 \uC2DC \uD654\uBA74 \uD6A8\uACFC\uB97C \uC0AC\uC6A9\uD569\uB2C8\uB2E4.',
    celebrationEffectLevel: '\uCD95\uD558 \uD654\uBA74\uC758 \uD654\uB824\uC131\uC744 \uC870\uC808\uD569\uB2C8\uB2E4.',
} as const;

export const STUDENT_POINT_TAB_LABELS = {
    overview: '\uB0B4 \uD3EC\uC778\uD2B8',
    history: '\uD3EC\uC778\uD2B8 \uB0B4\uC5ED',
    shop: '\uD3EC\uC778\uD2B8 \uC0C1\uC810',
    orders: '\uAD6C\uB9E4 \uB0B4\uC5ED',
} as const;

export const POINT_ORDER_STATUS_LABELS: Record<PointOrderStatus, string> = {
    requested: '\uC694\uCCAD \uC811\uC218',
    approved: '\uC2B9\uC778 \uC644\uB8CC',
    rejected: '\uBC18\uB824',
    fulfilled: '\uC9C0\uAE09 \uC644\uB8CC',
    cancelled: '\uCDE8\uC18C',
};

export const POINT_TRANSACTION_TYPE_LABELS: Record<PointTransactionType, string> = {
    attendance: '\uCD9C\uC11D \uCCB4\uD06C',
    attendance_monthly_bonus: '\uC6D4\uAC04 \uAC1C\uADFC \uBCF4\uB108\uC2A4',
    quiz: '\uBB38\uC81C \uD480\uC774',
    lesson: '\uC218\uC5C5 \uC790\uB8CC \uD655\uC778',
    manual_adjust: '\uAD50\uC0AC \uC9C1\uC811 \uC870\uC815',
    purchase_hold: '\uAD6C\uB9E4 \uC694\uCCAD',
    purchase_confirm: '\uAD6C\uB9E4 \uD655\uC815',
    purchase_cancel: '\uAD6C\uB9E4 \uCDE8\uC18C',
};

export const POINT_POLICY_FIELD_LABELS: Record<
    keyof Pick<PointPolicy, 'attendanceDaily' | 'attendanceMonthlyBonus' | 'quizSolve' | 'lessonView' | 'manualAdjustEnabled' | 'allowNegativeBalance'>,
    string
> = {
    attendanceDaily: '\uCD9C\uC11D \uCCB4\uD06C \uD3EC\uC778\uD2B8',
    attendanceMonthlyBonus: '\uC6D4\uAC04 \uAC1C\uADFC \uBCF4\uB108\uC2A4',
    quizSolve: '\uBB38\uC81C \uD480\uC774 \uD3EC\uC778\uD2B8',
    lessonView: '\uC218\uC5C5 \uC790\uB8CC \uD655\uC778 \uD3EC\uC778\uD2B8',
    manualAdjustEnabled: '\uAD50\uC0AC\uAC00 \uD559\uC0DD\uC5D0\uAC8C \uD3EC\uC778\uD2B8\uB97C \uBD80\uC5EC\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4',
    allowNegativeBalance: '\uD3EC\uC778\uD2B8 \uBD80\uC871 \uC0C1\uD0DC\uC5D0\uC11C\uB3C4 \uCC28\uAC10 \uD5C8\uC6A9',
};

export const POINT_POLICY_FIELD_HELPERS: Record<
    keyof Pick<PointPolicy, 'attendanceDaily' | 'attendanceMonthlyBonus' | 'quizSolve' | 'lessonView' | 'manualAdjustEnabled' | 'allowNegativeBalance'>,
    string
> = {
    attendanceDaily: '\uD559\uC0DD\uC774 \uD558\uB8E8 \uD55C \uBC88 \uCD9C\uC11D \uCCB4\uD06C\uB97C \uC644\uB8CC\uD588\uC744 \uB54C \uC9C0\uAE09\uB418\uB294 \uAE30\uBCF8 \uD3EC\uC778\uD2B8\uC785\uB2C8\uB2E4.',
    attendanceMonthlyBonus: '\uD574\uB2F9 \uC6D4\uC758 \uBAA8\uB4E0 \uB0A0\uC9DC\uC5D0 \uCD9C\uC11D\uD55C \uD559\uC0DD\uC5D0\uAC8C \uB9C8\uC9C0\uB9C9 \uCD9C\uC11D \uC2DC\uC810\uC5D0 \uD55C \uBC88\uB9CC \uCD94\uAC00 \uC9C0\uAE09\uB429\uB2C8\uB2E4.',
    quizSolve: '\uBB38\uC81C \uD480\uC774\uB97C \uC815\uC0C1 \uC81C\uCD9C\uD588\uC744 \uB54C \uC790\uB3D9\uC73C\uB85C \uC801\uB9BD\uB418\uB294 \uD3EC\uC778\uD2B8\uC785\uB2C8\uB2E4.',
    lessonView: '\uC218\uC5C5 \uC790\uB8CC\uB97C \uCDA9\uBD84\uD788 \uD655\uC778\uD558\uACE0 \uC800\uC7A5\uAE4C\uC9C0 \uB9C8\uCCE4\uC744 \uB54C \uC9C0\uAE09\uB429\uB2C8\uB2E4.',
    manualAdjustEnabled: '\uB044\uBA74 \uAD50\uC0AC\uC758 \uD3EC\uC778\uD2B8 \uBD80\uC5EC \uAE30\uB2A5\uC774 \uC11C\uBC84\uC5D0\uC11C \uCC28\uB2E8\uB429\uB2C8\uB2E4.',
    allowNegativeBalance: '\uCF1C\uBA74 \uBCF4\uC720 \uD3EC\uC778\uD2B8\uBCF4\uB2E4 \uB9CE\uC774 \uCC28\uAC10\uD558\uB294 \uC6B4\uC601\uB3C4 \uD5C8\uC6A9\uD569\uB2C8\uB2E4.',
};

export const POINT_HISTORY_FILTER_LABELS = {
    all: '\uC804\uCCB4',
    earned: '\uC801\uB9BD',
    spent: '\uC0AC\uC6A9',
    attendance: '\uCD9C\uC11D',
    attendance_monthly_bonus: '\uC6D4\uAC04 \uAC1C\uADFC \uBCF4\uB108\uC2A4',
    quiz: '\uBB38\uC81C \uD480\uC774',
    lesson: '\uC218\uC5C5 \uC790\uB8CC',
    manual_adjust: '\uAD50\uC0AC \uC870\uC815',
    purchase: '\uAD6C\uB9E4 \uAD00\uB828',
} as const;

export const getPointDeltaToneClass = (delta: number) => (
    delta >= 0 ? 'text-emerald-600' : 'text-rose-500'
);

export const getPointFeedbackToneClass = (message: string) => (
    message.includes('\uC2E4\uD328')
    || message.includes('\uC624\uB958')
    || message.includes('\uBD80\uC871')
    || message.includes('\uC5C6\uC2B5\uB2C8\uB2E4')
    || message.includes('\uC785\uB825')
        ? 'border border-red-200 bg-red-50 text-red-700'
        : 'border border-emerald-200 bg-emerald-50 text-emerald-700'
);
