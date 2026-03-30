import React from 'react';
import type { PointRankDisplay } from '../../lib/pointRanks';

interface PointRankBadgeProps {
    rank: PointRankDisplay | null;
    size?: 'sm' | 'md';
    showTheme?: boolean;
    className?: string;
}

const PointRankBadge: React.FC<PointRankBadgeProps> = ({
    rank,
    size = 'md',
    showTheme = false,
    className = '',
}) => {
    if (!rank || !rank.enabled) return null;

    const sizeClassName = size === 'sm'
        ? 'min-h-[1.8rem] min-w-[3.35rem] px-2 py-[0.28rem] text-[10.5px] leading-[1.15]'
        : 'min-h-[2.2rem] min-w-[4.25rem] px-3 py-1.5 text-xs leading-[1.15]';
    const label = showTheme ? `${rank.themeName} ${rank.label}` : rank.label;

    return (
        <span
            title={`${rank.themeName} ${rank.description}`}
            aria-label={`현재 등급 ${label}`}
            className={[
                'inline-flex shrink-0 items-center justify-center rounded-full border font-bold whitespace-nowrap text-center',
                sizeClassName,
                rank.badgeClass,
                className,
            ].filter(Boolean).join(' ')}
        >
            {label}
        </span>
    );
};

export default PointRankBadge;
