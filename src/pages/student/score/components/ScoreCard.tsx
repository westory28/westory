import React, { useState } from 'react';

interface ScoreItem {
    name: string;
    maxScore: number;
    ratio: number;
    type: string;
}

interface ScoreCardProps {
    plan: {
        id: string;
        subject: string;
        items: ScoreItem[];
    };
    userScores: { [key: string]: string };
    onScoreChange: (planId: string, idx: number, val: string) => void;
    totalScore: number;
    hasData: boolean;
}

const ScoreCard: React.FC<ScoreCardProps> = ({ plan, userScores, onScoreChange, totalScore, hasData }) => {
    const [expanded, setExpanded] = useState(false);

    const getGradeInfo = (score: number, hasData: boolean, subjectName: string) => {
        if (!hasData) return { grade: '-', colorCode: '#adb5bd', class: 'bg-none', text: '미입력' };

        const roundedScore = Math.round(score);
        const isArtsPE = ['음악', '미술', '체육'].some(key => subjectName.includes(key));

        if (isArtsPE) {
            if (roundedScore >= 80) return { grade: 'A', colorCode: '#fa5252', class: 'bg-red-500', text: `${score}점` };
            if (roundedScore >= 60) return { grade: 'B', colorCode: '#fab005', class: 'bg-yellow-500', text: `${score}점` };
            return { grade: 'C', colorCode: '#339af0', class: 'bg-blue-500', text: `${score}점` };
        } else {
            if (roundedScore >= 90) return { grade: 'A', colorCode: '#fa5252', class: 'bg-red-500', text: `${score}점` };
            if (roundedScore >= 80) return { grade: 'B', colorCode: '#fd7e14', class: 'bg-orange-500', text: `${score}점` };
            if (roundedScore >= 70) return { grade: 'C', colorCode: '#fab005', class: 'bg-yellow-500', text: `${score}점` };
            if (roundedScore >= 60) return { grade: 'D', colorCode: '#51cf66', class: 'bg-green-500', text: `${score}점` };
            return { grade: 'E', colorCode: '#339af0', class: 'bg-blue-500', text: `${score}점` };
        }
    };

    const info = getGradeInfo(totalScore, hasData, plan.subject);

    return (
        <div
            className="bg-white rounded-lg mb-4 border border-gray-200 transition-all hover:shadow-md hover:-translate-y-0.5"
            style={{ borderLeftWidth: '5px', borderLeftColor: info.colorCode }}
        >
            <div
                className="p-5 flex justify-between items-center cursor-pointer"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="text-lg font-bold text-gray-800">{plan.subject}</div>
                <div className="text-right">
                    <span className="text-xl font-bold transition-colors" style={{ color: info.colorCode }}>{info.text}</span>
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold text-white ml-2 align-middle ${info.class}`}>
                        {info.grade}
                    </span>
                    <div className="text-xs text-gray-400 mt-1">
                        {expanded ? '▲ 접기' : '▼ 점수 입력하기'}
                    </div>
                </div>
            </div>

            {expanded && (
                <div className="px-6 pb-6 bg-gray-50 border-t border-gray-100 animate-fadeIn">
                    {plan.items.map((item, idx) => {
                        const key = `${plan.id}_${idx}`;
                        const val = userScores[key] || '';

                        return (
                            <div key={idx} className="flex justify-between items-center py-3 border-b border-dashed border-gray-200 last:border-0">
                                <div>
                                    <div className="text-sm text-gray-800">
                                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 mr-2">{item.type}</span>
                                        {item.name}
                                    </div>
                                    <div className="text-xs text-gray-400 mt-0.5">{item.maxScore}점 만점 / {item.ratio}% 반영</div>
                                </div>
                                <input
                                    type="number"
                                    className="w-20 p-2 border border-gray-300 rounded text-center text-sm focus:outline-none focus:border-blue-500"
                                    value={val}
                                    placeholder="0"
                                    onChange={(e) => onScoreChange(plan.id, idx, e.target.value)}
                                    // Make sure we stop propagation to avoid closing accordion if clicked inside? Actually input handles focus.
                                    onClick={(e) => e.stopPropagation()}
                                />
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default ScoreCard;
