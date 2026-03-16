import type { PointOrderStatus, PointPolicy, PointTransactionType } from '../types';

export const TEACHER_POINT_TAB_LABELS = {
    overview: '\uD3EC\uC778\uD2B8 \uD604\uD669',
    policy: '\uC6B4\uC601 \uC815\uCC45',
    products: '\uC0C1\uD488 \uAD00\uB9AC',
    requests: '\uAD6C\uB9E4 \uC694\uCCAD \uAD00\uB9AC',
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
    manualAdjustEnabled: '\uAD50\uC0AC\uAC00 \uC9C1\uC811 \uD3EC\uC778\uD2B8\uB97C \uC870\uC815\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4',
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
    manualAdjustEnabled: '\uB044\uBA74 \uAD50\uC0AC\uC758 \uC218\uB3D9 \uC9C0\uAE09\uACFC \uCC28\uAC10 \uAE30\uB2A5\uC774 \uC11C\uBC84\uC5D0\uC11C \uCC28\uB2E8\uB429\uB2C8\uB2E4.',
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
