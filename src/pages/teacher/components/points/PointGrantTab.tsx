import React, { useMemo, useState } from 'react';
import PointRankBadge from '../../../../components/common/PointRankBadge';
import { getPointFeedbackToneClass } from '../../../../constants/pointLabels';
import { formatPointStudentLabel, formatWisAmount } from '../../../../lib/pointFormatters';
import { getPointRankDisplay } from '../../../../lib/pointRanks';
import type { PointRankPolicy, PointStudentTarget, PointWallet } from '../../../../types';

type GrantStudentRow = PointStudentTarget & {
    wallet?: PointWallet | null;
};

type GrantMode = 'grant' | 'reclaim';

interface PointGrantTabProps {
    students: GrantStudentRow[];
    selectedStudent: GrantStudentRow | null;
    selectedUid: string;
    rankPolicy: PointRankPolicy;
    rankManualAdjustEarnedPointsByUid: Record<string, number>;
    canManage: boolean;
    manualAdjustEnabled: boolean;
    allowNegativeBalance: boolean;
    loading: boolean;
    gradeFilter: string;
    classFilter: string;
    numberFilter: string;
    nameSearch: string;
    gradeOptions: string[];
    classOptions: string[];
    numberOptions: string[];
    amount: string;
    reason: string;
    feedback: string;
    onGradeFilterChange: (value: string) => void;
    onClassFilterChange: (value: string) => void;
    onNumberFilterChange: (value: string) => void;
    onNameSearchChange: (value: string) => void;
    onSelectStudent: (uid: string) => void;
    onAmountChange: (value: string) => void;
    onReasonChange: (value: string) => void;
    onSubmit: (event: React.FormEvent, mode: GrantMode) => void;
}

const PointGrantTab: React.FC<PointGrantTabProps> = ({
    students,
    selectedStudent,
    selectedUid,
    rankPolicy,
    rankManualAdjustEarnedPointsByUid,
    canManage,
    manualAdjustEnabled,
    allowNegativeBalance,
    loading,
    gradeFilter,
    classFilter,
    numberFilter,
    nameSearch,
    gradeOptions,
    classOptions,
    numberOptions,
    amount,
    reason,
    feedback,
    onGradeFilterChange,
    onClassFilterChange,
    onNumberFilterChange,
    onNameSearchChange,
    onSelectStudent,
    onAmountChange,
    onReasonChange,
    onSubmit,
}) => {
    const [mode, setMode] = useState<GrantMode>('grant');
    const numericAmount = Number(amount || 0);
    const currentBalance = Number(selectedStudent?.wallet?.balance || 0);
    const projectedBalance = useMemo(() => {
        if (!numericAmount || Number.isNaN(numericAmount)) return currentBalance;
        return mode === 'grant'
            ? currentBalance + numericAmount
            : currentBalance - numericAmount;
    }, [currentBalance, mode, numericAmount]);

    return (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.95fr]">
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-100 bg-gray-50 p-5">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <h2 className="text-lg font-bold text-gray-800">지급 및 환수 대상 선택</h2>
                            <p className="mt-1 text-sm text-gray-500">
                                학년, 반, 번호, 이름으로 빠르게 찾은 뒤 오른쪽에서 위스를 지급하거나 환수할 수 있습니다.
                            </p>
                        </div>
                        <div className="text-sm font-bold text-gray-500 whitespace-nowrap">{`검색 결과 ${students.length}명`}</div>
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                        <select value={gradeFilter} onChange={(event) => onGradeFilterChange(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700">
                            <option value="all">전체 학년</option>
                            {gradeOptions.map((option) => <option key={option} value={option}>{`${option}학년`}</option>)}
                        </select>
                        <select value={classFilter} onChange={(event) => onClassFilterChange(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700">
                            <option value="all">전체 반</option>
                            {classOptions.map((option) => <option key={option} value={option}>{`${option}반`}</option>)}
                        </select>
                        <select value={numberFilter} onChange={(event) => onNumberFilterChange(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700">
                            <option value="all">전체 번호</option>
                            {numberOptions.map((option) => <option key={option} value={option}>{`${option}번`}</option>)}
                        </select>
                        <input value={nameSearch} onChange={(event) => onNameSearchChange(event.target.value)} placeholder="이름 또는 일부 검색" className="rounded-lg border border-gray-300 px-4 py-2 text-sm" />
                    </div>
                </div>

                <div className="hidden md:block">
                    <div className="grid grid-cols-[minmax(0,1.3fr)_140px_120px] gap-3 border-b border-gray-100 px-5 py-3 text-xs font-bold uppercase tracking-wide text-gray-500">
                        <div>학생</div>
                        <div>소속</div>
                        <div className="text-right">보유 위스</div>
                    </div>
                    <div className="divide-y divide-gray-100">
                        {gradeFilter === 'all' || classFilter === 'all' ? (
                            <div className="px-5 py-12 text-center text-sm text-gray-400">학년과 반을 먼저 선택해 주세요.</div>
                        ) : loading ? (
                            <div className="px-5 py-12 text-center text-sm text-gray-400">선택한 학급 학생을 불러오는 중입니다.</div>
                        ) : students.length === 0 ? (
                            <div className="px-5 py-12 text-center text-sm text-gray-400">선택한 조건에 맞는 학생이 없습니다.</div>
                        ) : null}
                        {students.map((student) => {
                            const rank = getPointRankDisplay({
                                rankPolicy,
                                wallet: student.wallet || null,
                                earnedPointsFromTransactions: rankManualAdjustEarnedPointsByUid[student.uid] || 0,
                            });

                            return (
                                <button
                                    key={student.uid}
                                    type="button"
                                    onClick={() => onSelectStudent(student.uid)}
                                    className={`grid w-full grid-cols-[minmax(0,1.3fr)_140px_120px] gap-3 px-5 py-4 text-left transition ${student.uid === selectedUid ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <div className="truncate font-bold text-gray-800">{student.studentName}</div>
                                            <PointRankBadge rank={rank} size="sm" />
                                        </div>
                                        <div className="mt-1 text-xs text-gray-500">{student.wallet ? '위스 현황이 있는 학생' : '첫 거래 전 학생'}</div>
                                    </div>
                                    <div className="truncate text-sm text-gray-600">
                                        {[
                                            student.grade ? `${student.grade}학년` : '',
                                            student.class ? `${student.class}반` : '',
                                        ].filter(Boolean).join(' ') || '-'}
                                    </div>
                                    <div className="text-right text-lg font-black text-blue-700 whitespace-nowrap">
                                        {formatWisAmount(student.wallet?.balance || 0)}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                {!selectedStudent ? (
                    <div className="py-16 text-center text-gray-400">왼쪽 목록에서 학생을 선택해 주세요.</div>
                ) : (
                    <>
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="truncate text-xl font-extrabold text-gray-900">{selectedStudent.studentName}</h3>
                                    <PointRankBadge
                                        rank={getPointRankDisplay({
                                            rankPolicy,
                                            wallet: selectedStudent.wallet || null,
                                            earnedPointsFromTransactions: rankManualAdjustEarnedPointsByUid[selectedStudent.uid] || 0,
                                        })}
                                    />
                                </div>
                                <div className="mt-1 text-sm text-gray-500">{formatPointStudentLabel(selectedStudent) || '소속 정보 없음'}</div>
                            </div>
                            <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-right">
                                <div className="text-xs font-bold text-blue-500">현재 보유 위스</div>
                                <div className="mt-1 whitespace-nowrap text-2xl font-black text-blue-700">{formatWisAmount(currentBalance)}</div>
                            </div>
                        </div>

                        <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50/80 p-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-bold text-gray-700">작업 모드</span>
                                <div className="inline-flex rounded-full border border-gray-200 bg-white p-1">
                                    {([
                                        { key: 'grant', label: '위스 지급', tone: 'bg-blue-600 text-white' },
                                        { key: 'reclaim', label: '위스 환수', tone: 'bg-rose-500 text-white' },
                                    ] as Array<{ key: GrantMode; label: string; tone: string }>).map((item) => (
                                        <button
                                            key={item.key}
                                            type="button"
                                            onClick={() => setMode(item.key)}
                                            className={`rounded-full px-4 py-2 text-sm font-bold whitespace-nowrap transition ${
                                                mode === item.key
                                                    ? item.tone
                                                    : 'text-gray-600 hover:bg-gray-100'
                                            }`}
                                        >
                                            {item.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                                    <div className="text-xs font-bold text-gray-500">작업 후 예상 잔액</div>
                                    <div className={`mt-1 whitespace-nowrap text-xl font-black ${projectedBalance < 0 ? 'text-rose-500' : 'text-gray-900'}`}>
                                        {formatWisAmount(projectedBalance)}
                                    </div>
                                </div>
                                <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                                    <div className="text-xs font-bold text-gray-500">정책 상태</div>
                                    <div className="mt-1 text-sm font-bold text-gray-900">
                                        {manualAdjustEnabled ? '교사 직접 조정 허용' : '교사 직접 조정 차단'}
                                    </div>
                                    <div className="mt-1 text-xs text-gray-500">
                                        {allowNegativeBalance ? '잔액 부족 상태에서도 환수 가능' : '잔액보다 많이 환수하면 차단'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-4">
                            <div className="mb-1 font-bold text-gray-900">{mode === 'grant' ? '위스 지급' : '위스 환수'}</div>
                            <p className="mb-4 text-sm text-gray-500">
                                {mode === 'grant'
                                    ? '지급 사유는 거래 내역에 그대로 남습니다. 활동 보상과 별도인 교사 직접 지급으로 기록됩니다.'
                                    : '환수는 자동 적립 내역을 되돌리지 않고, 교사 직접 환수 거래로 별도 기록됩니다.'}
                            </p>

                            {!manualAdjustEnabled && (
                                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700">
                                    운영 정책에서 교사 직접 지급 및 환수를 허용해야 반영할 수 있습니다.
                                </div>
                            )}

                            {mode === 'reclaim' && !allowNegativeBalance && (
                                <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                                    현재 정책에서는 잔액보다 큰 환수를 허용하지 않습니다. 학생 잔액을 넘는 금액은 서버에서 차단됩니다.
                                </div>
                            )}

                            <form onSubmit={(event) => onSubmit(event, mode)}>
                                <div className="grid grid-cols-1 gap-3">
                                    <label className="block">
                                        <div className="mb-2 text-sm font-bold text-gray-700">수량</div>
                                        <input
                                            type="number"
                                            min="1"
                                            value={amount}
                                            onChange={(event) => onAmountChange(event.target.value)}
                                            placeholder={mode === 'grant' ? '지급할 위스 수량' : '환수할 위스 수량'}
                                            className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm"
                                            disabled={!canManage || !manualAdjustEnabled}
                                        />
                                    </label>
                                    <label className="block">
                                        <div className="mb-2 text-sm font-bold text-gray-700">사유</div>
                                        <textarea
                                            value={reason}
                                            onChange={(event) => onReasonChange(event.target.value)}
                                            rows={4}
                                            placeholder={mode === 'grant'
                                                ? '예: 발표 참여 보상, 추가 과제 수행, 행사 참여'
                                                : '예: 오지급 정정, 미반납 물품, 정책 위반에 따른 환수'}
                                            className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm"
                                            disabled={!canManage || !manualAdjustEnabled}
                                        />
                                    </label>
                                </div>

                                {!!feedback && <div className={`mt-3 rounded-lg px-3 py-2 text-sm font-bold ${getPointFeedbackToneClass(feedback)}`}>{feedback}</div>}

                                <button
                                    type="submit"
                                    disabled={!canManage || !manualAdjustEnabled}
                                    className={`mt-4 w-full rounded-xl px-4 py-3 text-sm font-bold text-white transition disabled:bg-gray-300 ${
                                        mode === 'grant'
                                            ? 'bg-blue-600 hover:bg-blue-700'
                                            : 'bg-rose-500 hover:bg-rose-600'
                                    }`}
                                >
                                    {mode === 'grant' ? '위스 지급 실행' : '위스 환수 실행'}
                                </button>
                            </form>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default PointGrantTab;
