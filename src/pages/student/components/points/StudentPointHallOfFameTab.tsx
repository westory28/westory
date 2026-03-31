import React, { useMemo, useState } from 'react';
import WisHallOfFamePodium from '../../../../components/common/WisHallOfFamePodium';
import { formatPointDateShortTime } from '../../../../lib/pointFormatters';
import { buildWisHallOfFameClassKey } from '../../../../lib/wisHallOfFame';
import type {
    HallOfFameInterfaceConfig,
    WisHallOfFameSnapshot,
} from '../../../../types';

interface StudentPointHallOfFameTabProps {
    snapshot: WisHallOfFameSnapshot | null;
    hallOfFameConfig?: HallOfFameInterfaceConfig | null;
    currentGrade?: string;
    currentClass?: string;
}

type HallView = 'grade' | 'class';

const PRIMARY_GRADE_KEY = '3';

const normalizeNumberText = (value: unknown) => {
    const raw = String(value || '').trim();
    const digits = raw.match(/\d+/)?.[0] || '';
    if (!digits) return raw;
    const parsed = Number(digits);
    return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : raw;
};

const StudentPointHallOfFameTab: React.FC<StudentPointHallOfFameTabProps> = ({
    snapshot,
    hallOfFameConfig,
    currentGrade,
    currentClass,
}) => {
    const [activeView, setActiveView] = useState<HallView>('grade');
    const normalizedGrade = normalizeNumberText(currentGrade);
    const normalizedClass = normalizeNumberText(currentClass);
    const classKey = buildWisHallOfFameClassKey(normalizedGrade, normalizedClass);
    const canOpenClassView = Boolean(classKey);

    const gradeEntries = snapshot?.gradeTop3ByGrade[PRIMARY_GRADE_KEY] || [];
    const classEntries = classKey ? (snapshot?.classTop3ByClassKey[classKey] || []) : [];
    const activeEntries = activeView === 'grade' ? gradeEntries : classEntries;
    const classTitle = normalizedGrade && normalizedClass
        ? `${normalizedGrade}학년 ${normalizedClass}반 랭킹`
        : '우리 학급 랭킹';

    const statusText = useMemo(() => {
        if (!snapshot?.updatedAt) return '화랑의 전당을 준비 중이에요.';
        return `최근 반영 ${formatPointDateShortTime(snapshot.updatedAt)}`;
    }, [snapshot]);

    return (
        <div className="space-y-4">
            <WisHallOfFamePodium
                title={activeView === 'grade' ? '3학년 전교 랭킹' : classTitle}
                subtitle="누적 획득 위스 기준으로 반영돼요."
                entries={activeEntries}
                hallOfFameConfig={hallOfFameConfig}
                action={(
                    <button
                        type="button"
                        onClick={() => setActiveView((prev) => (prev === 'grade' ? 'class' : 'grade'))}
                        disabled={activeView === 'grade' && !canOpenClassView}
                        className={`inline-flex w-full items-center justify-center rounded-full px-4 py-2 text-sm font-bold transition sm:w-auto ${
                            activeView === 'grade' && !canOpenClassView
                                ? 'cursor-not-allowed border border-white/12 bg-white/5 text-white/45'
                                : 'border border-white/18 bg-white/10 text-white hover:bg-white/16'
                        }`}
                    >
                        {activeView === 'grade' ? '우리 학급 보기' : '전교 랭킹 보기'}
                    </button>
                )}
                emptyMessage={activeView === 'grade'
                    ? '3학년 전교 랭킹을 집계 중이에요.'
                    : '아직 우리 학급 랭킹이 없어요.'}
            />

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-4 text-sm">
                <div className="min-w-0">
                    <div className="font-bold text-gray-800">학생 이모지와 이름으로 바로 확인할 수 있어요.</div>
                    <div className="mt-1 text-gray-500">{statusText}</div>
                </div>
                <div className="inline-flex items-center rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-700">
                    {activeView === 'grade' ? '전교 1~3위 공개' : '우리 학급 1~3위 공개'}
                </div>
            </div>
        </div>
    );
};

export default StudentPointHallOfFameTab;
