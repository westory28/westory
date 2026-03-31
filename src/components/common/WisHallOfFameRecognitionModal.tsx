import React from 'react';
import type { HallOfFameRecognition } from '../../lib/wisHallOfFameRecognition';

interface WisHallOfFameRecognitionModalProps {
    recognition: HallOfFameRecognition | null;
    onClose: () => void;
    onOpenHallOfFame?: () => void;
}

const WisHallOfFameRecognitionModal: React.FC<WisHallOfFameRecognitionModalProps> = ({
    recognition,
    onClose,
    onOpenHallOfFame,
}) => {
    if (!recognition) return null;

    const scopeLabel = recognition.scope === 'grade'
        ? `3학년 전교 ${recognition.rank}위`
        : `${recognition.grade}학년 ${recognition.className}반 ${recognition.rank}위`;

    return (
        <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
            onClick={onClose}
            role="presentation"
        >
            <div
                className="w-full max-w-md overflow-hidden rounded-[1.75rem] border border-white/20 bg-white shadow-[0_32px_90px_rgba(15,23,42,0.35)]"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="wis-hall-of-fame-title"
            >
                <div className="bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.30),_transparent_52%),linear-gradient(135deg,_#0f172a,_#1e293b)] px-6 pb-7 pt-6 text-white">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="text-xs font-bold uppercase tracking-[0.22em] text-amber-200/90">Hall Of Fame</div>
                            <h2 id="wis-hall-of-fame-title" className="mt-2 text-2xl font-black leading-tight">
                                {recognition.headline}
                            </h2>
                            <p className="mt-2 text-sm leading-6 text-slate-200">{recognition.message}</p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition hover:bg-white/20"
                            aria-label="화랑의 전당 팝업 닫기"
                        >
                            <i className="fas fa-times" aria-hidden="true"></i>
                        </button>
                    </div>

                    <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-white/8 p-5 backdrop-blur">
                        <div className="flex items-center gap-4">
                            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-[1.35rem] bg-white/95 text-[3.4rem] shadow-inner">
                                <span role="img" aria-label={`${recognition.studentName} 이모지`}>
                                    {recognition.profileIcon || '😀'}
                                </span>
                            </div>
                            <div className="min-w-0">
                                <div className="inline-flex rounded-full bg-amber-300 px-3 py-1 text-xs font-black text-amber-950">
                                    {scopeLabel}
                                </div>
                                <div className="mt-3 whitespace-pre-line break-keep text-lg font-black leading-snug text-white">
                                    {`${recognition.grade}학년 ${recognition.className}반\n${recognition.studentName}`}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-2 px-6 py-5 sm:flex-row sm:justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex items-center justify-center rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 transition hover:bg-gray-50"
                    >
                        나중에 보기
                    </button>
                    {onOpenHallOfFame && (
                        <button
                            type="button"
                            onClick={onOpenHallOfFame}
                            className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-700"
                        >
                            화랑의 전당 보기
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default WisHallOfFameRecognitionModal;
