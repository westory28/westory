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
        ? 'px-2.5 py-1 text-[11px]'
        : 'px-3 py-1.5 text-xs';
    const label = showTheme ? `${rank.themeName} ${rank.label}` : rank.label;

    return (
        <span
            title={`${rank.themeName} ${rank.description}`}
            aria-label={`현재 등급 ${label}`}
            className={[
                'inline-flex items-center rounded-full border font-bold whitespace-nowrap',
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
