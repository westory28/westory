import type { PointWallet } from '../types';

export const formatPointDateTime = (value: any) => (
    value?.seconds ? new Date(value.seconds * 1000).toLocaleString('ko-KR') : '-'
);

export const formatPointDateOnly = (value: any) => (
    value?.seconds ? new Date(value.seconds * 1000).toLocaleDateString('ko-KR') : '-'
);

export const formatPointStudentLabel = (wallet: Pick<PointWallet, 'grade' | 'class' | 'number'>) => (
    [
        wallet.grade ? `${wallet.grade}\uD559\uB144` : '',
        wallet.class ? `${wallet.class}\uBC18` : '',
        wallet.number ? `${wallet.number}\uBC88` : '',
    ].filter(Boolean).join(' ')
);
