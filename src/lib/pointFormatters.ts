import type { PointWallet } from '../types';

export const formatPointDateTime = (value: any) =>
    value?.seconds ? new Date(value.seconds * 1000).toLocaleString('ko-KR') : '-';

export const formatPointDateOnly = (value: any) =>
    value?.seconds ? new Date(value.seconds * 1000).toLocaleDateString('ko-KR') : '-';

export const formatPointStudentLabel = (wallet: Pick<PointWallet, 'grade' | 'class' | 'number'>) =>
    [wallet.grade && `${wallet.grade}학년`, wallet.class && `${wallet.class}반`, wallet.number && `${wallet.number}번`]
        .filter(Boolean)
        .join(' ');

