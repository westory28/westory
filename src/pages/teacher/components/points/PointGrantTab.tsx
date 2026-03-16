import React from 'react';
import { getPointFeedbackToneClass } from '../../../../constants/pointLabels';
import { formatPointStudentLabel } from '../../../../lib/pointFormatters';
import type { PointStudentTarget, PointWallet } from '../../../../types';

type GrantStudentRow = PointStudentTarget & {
    wallet?: PointWallet | null;
};

interface PointGrantTabProps {
    students: GrantStudentRow[];
    selectedStudent: GrantStudentRow | null;
    selectedUid: string;
    canManage: boolean;
    manualAdjustEnabled: boolean;
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
    onSubmit: (event: React.FormEvent) => void;
}

const PointGrantTab: React.FC<PointGrantTabProps> = ({
    students,
    selectedStudent,
    selectedUid,
    canManage,
    manualAdjustEnabled,
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
}) => (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.95fr]">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 bg-gray-50 p-5">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <h2 className="text-lg font-bold text-gray-800">포인트 부여 대상 선택</h2>
                        <p className="mt-1 text-sm text-gray-500">학년과 반을 먼저 선택하면 해당 학급 학생만 표시합니다. 전체 학생 명단은 한 번에 불러오지 않습니다.</p>
                    </div>
                    <div className="text-sm font-bold text-gray-500">{`검색 결과 ${students.length}명`}</div>
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
                <div className="grid grid-cols-[minmax(0,1.3fr)_140px_110px] gap-3 border-b border-gray-100 px-5 py-3 text-xs font-bold uppercase tracking-wide text-gray-500">
                    <div>학생</div>
                    <div>소속</div>
                    <div className="text-right">현재 보유</div>
                </div>
                <div className="divide-y divide-gray-100">
                    {gradeFilter === 'all' || classFilter === 'all' ? (
                        <div className="px-5 py-12 text-center text-sm text-gray-400">학년과 반을 먼저 선택해 주세요.</div>
                    ) : loading ? (
                        <div className="px-5 py-12 text-center text-sm text-gray-400">선택한 학급 학생을 불러오는 중입니다.</div>
                    ) : students.length === 0 ? (
                        <div className="px-5 py-12 text-center text-sm text-gray-400">선택한 학급에 표시할 학생이 없습니다.</div>
                    ) : null}
                    {students.map((student) => (
                        <button
                            key={student.uid}
                            type="button"
                            onClick={() => onSelectStudent(student.uid)}
                            className={`grid w-full grid-cols-[minmax(0,1.3fr)_140px_110px] gap-3 px-5 py-4 text-left transition ${student.uid === selectedUid ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                        >
                            <div className="min-w-0">
                                <div className="truncate font-bold text-gray-800">{student.studentName}</div>
                                <div className="mt-1 text-xs text-gray-500">{student.wallet ? '포인트 현황에 등록된 학생' : '첫 부여 시 포인트 현황에 추가'}</div>
                            </div>
                            <div className="truncate text-sm text-gray-600">
                                {[
                                    student.grade ? `${student.grade}학년` : '',
                                    student.class ? `${student.class}반` : '',
                                ].filter(Boolean).join(' ') || '-'}
                            </div>
                            <div className="text-right text-lg font-black text-blue-700">{student.wallet?.balance || 0}</div>
                        </button>
                    ))}
                </div>
            </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            {!selectedStudent ? (
                <div className="py-16 text-center text-gray-400">왼쪽 목록에서 학생을 선택해 주세요.</div>
            ) : (
                <>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h3 className="text-xl font-extrabold text-gray-900">{selectedStudent.studentName}</h3>
                            <div className="mt-1 text-sm text-gray-500">{formatPointStudentLabel(selectedStudent) || '소속 정보 없음'}</div>
                        </div>
                        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-right">
                            <div className="text-xs font-bold text-blue-500">현재 보유 포인트</div>
                            <div className="mt-1 text-3xl font-black text-blue-700">{selectedStudent.wallet?.balance || 0}</div>
                        </div>
                    </div>

                    <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
                        <div className="mb-1 font-bold text-gray-800">교사 포인트 부여</div>
                        <p className="mb-4 text-sm text-gray-500">선택한 학생 1명에게만 포인트를 부여합니다. 사유는 거래 내역에 그대로 남습니다.</p>
                        {!manualAdjustEnabled && (
                            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700">
                                운영 정책에서 교사 포인트 부여를 허용해야 반영할 수 있습니다.
                            </div>
                        )}
                        <form onSubmit={onSubmit}>
                            <input
                                type="number"
                                min="1"
                                value={amount}
                                onChange={(event) => onAmountChange(event.target.value)}
                                placeholder="부여할 포인트 수량"
                                className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm"
                                disabled={!canManage || !manualAdjustEnabled}
                            />
                            <textarea
                                value={reason}
                                onChange={(event) => onReasonChange(event.target.value)}
                                rows={4}
                                placeholder="예: 발표 참여 보상, 수업 태도 우수, 학급 행사 참여"
                                className="mt-3 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm"
                                disabled={!canManage || !manualAdjustEnabled}
                            />
                            {!!feedback && <div className={`mt-3 rounded-lg px-3 py-2 text-sm font-bold ${getPointFeedbackToneClass(feedback)}`}>{feedback}</div>}
                            <button
                                type="submit"
                                disabled={!canManage || !manualAdjustEnabled}
                                className="mt-3 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:bg-blue-300"
                            >
                                포인트 부여하기
                            </button>
                        </form>
                    </div>
                </>
            )}
        </div>
    </div>
);

export default PointGrantTab;
