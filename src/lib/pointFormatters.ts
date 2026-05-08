import type { PointWallet } from '../types';

const toSafeNumber = (value: unknown) => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

export const formatPointDateTime = (value: any) => (
    value?.seconds ? new Date(value.seconds * 1000).toLocaleString('ko-KR') : '-'
);

export const formatPointDateShortTime = (value: any) => (
    value?.seconds
        ? new Date(value.seconds * 1000).toLocaleString('ko-KR', {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        })
        : '-'
);

export const formatPointTimeOnly = (value: any) => (
    value?.seconds
        ? new Date(value.seconds * 1000).toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        })
        : '-'
);

export const formatPointDateOnly = (value: any) => (
    value?.seconds ? new Date(value.seconds * 1000).toLocaleDateString('ko-KR') : '-'
);

export const formatWisAmount = (value: unknown) => (
    `${toSafeNumber(value).toLocaleString('ko-KR')} ₩s`
);

export const formatWisDelta = (value: unknown) => {
    const numericValue = toSafeNumber(value);
    return `${numericValue >= 0 ? '+' : ''}${numericValue.toLocaleString('ko-KR')} ₩s`;
};

export const formatPointStudentLabel = (wallet: Pick<PointWallet, 'grade' | 'class' | 'number'>) => (
    [
        wallet.grade ? `${wallet.grade}\uD559\uB144` : '',
        wallet.class ? `${wallet.class}\uBC18` : '',
        wallet.number ? `${wallet.number}\uBC88` : '',
    ].filter(Boolean).join(' ')
);
