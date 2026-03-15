import type { PointOrderStatus, PointPolicy, PointTransactionType } from '../types';

export const TEACHER_POINT_TAB_LABELS = {
    overview: '포인트 현황',
    policy: '포인트 정책',
    products: '상품 관리',
    requests: '구매 요청 관리',
} as const;

export const STUDENT_POINT_TAB_LABELS = {
    overview: '내 포인트',
    history: '포인트 내역',
    shop: '포인트 상점',
    orders: '구매 내역',
} as const;

export const POINT_ORDER_STATUS_LABELS: Record<PointOrderStatus, string> = {
    requested: '승인 대기중',
    approved: '승인됨',
    rejected: '거절됨',
    fulfilled: '지급 완료',
    cancelled: '취소됨',
};

export const POINT_TRANSACTION_TYPE_LABELS: Record<PointTransactionType, string> = {
    attendance: '출석 체크',
    quiz: '문제 풀이',
    lesson: '수업 자료 확인',
    manual_adjust: '수동 조정',
    purchase_hold: '구매 요청',
    purchase_confirm: '구매 확정',
    purchase_cancel: '구매 취소',
};

export const POINT_POLICY_FIELD_LABELS: Record<keyof Pick<PointPolicy, 'attendanceDaily' | 'quizSolve' | 'lessonView' | 'manualAdjustEnabled' | 'allowNegativeBalance'>, string> = {
    attendanceDaily: '출석 체크 포인트',
    quizSolve: '문제 풀이 포인트',
    lessonView: '수업 자료 확인 포인트',
    manualAdjustEnabled: '수동 조정 허용',
    allowNegativeBalance: '음수 잔액 허용',
};

export const POINT_HISTORY_FILTER_LABELS = {
    all: '전체',
    earned: '적립',
    spent: '사용',
    attendance: '출석',
    quiz: '문제풀이',
    lesson: '수업자료',
    manual_adjust: '수동조정',
    purchase: '구매 관련',
} as const;

export const getPointDeltaToneClass = (delta: number) =>
    delta >= 0 ? 'text-emerald-600' : 'text-rose-500';

export const getPointFeedbackToneClass = (message: string) => (
    message.includes('실패') || message.includes('오류') || message.includes('부족') || message.includes('없습니다') || message.includes('입력')
        ? 'border border-red-200 bg-red-50 text-red-700'
        : 'border border-emerald-200 bg-emerald-50 text-emerald-700'
);

