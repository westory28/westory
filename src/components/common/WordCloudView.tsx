import React, { useMemo, useRef, useState } from 'react';

interface WordCloudEntry {
    text: string;
    count: number;
    submitters?: string[];
}

interface WordCloudViewProps {
    entries: WordCloudEntry[];
    className?: string;
    showSubmitters?: boolean;
    variant?: 'default' | 'modal';
}

interface PositionedWord extends WordCloudEntry {
    x: number;
    y: number;
    fontSize: number;
    width: number;
    height: number;
    color: string;
    rotate: 0 | 90;
    tooltip: string;
}

const WIDTH = 2100;
const HEIGHT = 900;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2 - 12;
const RADIUS_X = 948;
const RADIUS_Y = 346;
const MAX_WORDS = 80;
const COLORS = ['#2563eb', '#0f766e', '#7c3aed', '#ea580c', '#0891b2', '#db2777', '#65a30d', '#64748b'];
const PRIMARY_ANCHORS = [
    { x: 0, y: 0 },
    { x: -132, y: -34 },
    { x: 132, y: -28 },
    { x: -116, y: 62 },
    { x: 120, y: 60 },
    { x: 0, y: -90 },
    { x: 0, y: 96 },
    { x: -240, y: 8 },
    { x: 236, y: 10 },
];
const NEIGHBOR_DIRECTIONS = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: -1 },
];
const FILL_SCALES = [0.72, 0.88, 1, 1.14];
const SPIRAL_ANGLE = Math.PI * (3 - Math.sqrt(5));

const hashCode = (value: string) => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = (hash << 5) - hash + value.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
};

const buildTooltip = (entry: WordCloudEntry, showSubmitters: boolean) => {
    const base = `${entry.text}: ${entry.count}`;
    if (!showSubmitters) return base;

    const names = Array.from(new Set((entry.submitters || []).map((name) => String(name || '').trim()).filter(Boolean)));
    if (names.length === 0) return base;

    const preview = names.slice(0, 8).join(', ');
    const suffix = names.length > 8 ? ` +${names.length - 8}` : '';
    return `${base}\n${preview}${suffix}`;
};

const getTextUnits = (text: string) =>
    Array.from(text).reduce((sum, char) => {
        if (/[A-Z0-9]/.test(char)) return sum + 0.74;
        if (/[a-z]/.test(char)) return sum + 0.62;
        if (/[\uAC00-\uD7A3]/.test(char)) return sum + 0.96;
        return sum + 0.82;
    }, 0);

const estimateWordWidth = (text: string, fontSize: number) => {
    const units = getTextUnits(text);
    return Math.max(fontSize * 2.4, fontSize * (units + 1.2));
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getLengthAdjustedMaxFontSize = (text: string, baseMax: number, variant: 'default' | 'modal') => {
    const units = getTextUnits(text);
    const maxWidth = WIDTH * (variant === 'modal' ? 0.7 : 0.46);
    const widthLimitedSize = maxWidth / Math.max(units + 1.2, 2.4);
    const lengthScale = clamp(1 - Math.max(0, units - 5.2) * 0.052, 0.62, 1);

    return Math.max(18, Math.min(baseMax, widthLimitedSize, baseMax * lengthScale));
};

const getDensityFontScale = (wordCount: number, variant: 'default' | 'modal') => {
    const base = variant === 'modal' ? 1.22 : 1.12;
    const crowding = Math.max(0, wordCount - 14) * (variant === 'modal' ? 0.012 : 0.01);
    const sparseBoost = Math.max(0, 14 - wordCount) * 0.018;

    return clamp(base + sparseBoost - crowding, variant === 'modal' ? 0.62 : 0.68, variant === 'modal' ? 1.38 : 1.24);
};

const getCloudFillScale = (placed: PositionedWord[], wordCount: number, variant: 'default' | 'modal') => {
    if (placed.length === 0) return 1;

    const extentX = placed.reduce((max, item) => Math.max(max, Math.abs(item.x - CENTER_X) + item.width / 2), 1);
    const extentY = placed.reduce((max, item) => Math.max(max, Math.abs(item.y - CENTER_Y) + item.height / 2), 1);
    const targetX = RADIUS_X * (variant === 'modal' ? 0.93 : 0.9);
    const targetY = RADIUS_Y * (variant === 'modal' ? 0.88 : 0.84);
    const desiredScale = Math.min(targetX / extentX, targetY / extentY);
    const sparseCap = variant === 'modal'
        ? clamp(2.16 - wordCount * 0.025, 1.02, 1.9)
        : clamp(1.62 - wordCount * 0.014, 1.01, 1.38);

    return clamp(desiredScale, 1, sparseCap);
};

const scalePositionedWords = (placed: PositionedWord[], scale: number) => {
    if (scale <= 1.01) return placed;

    return placed.map((item) => ({
        ...item,
        x: CENTER_X + (item.x - CENTER_X) * scale,
        y: CENTER_Y + (item.y - CENTER_Y) * scale,
        fontSize: item.fontSize * scale,
        width: item.width * scale,
        height: item.height * scale,
    }));
};

const getPadding = (fontSize: number, variant: 'default' | 'modal') => ({
    x: Math.max(2, fontSize * (variant === 'modal' ? 0.026 : 0.046)),
    y: Math.max(2, fontSize * (variant === 'modal' ? 0.02 : 0.032)),
});

const isInsideEllipse = (x: number, y: number, width: number, height: number) => {
    const corners = [
        { x: x - width / 2, y: y - height / 2 },
        { x: x + width / 2, y: y - height / 2 },
        { x: x - width / 2, y: y + height / 2 },
        { x: x + width / 2, y: y + height / 2 },
    ];

    return corners.every((corner) => {
        const nx = (corner.x - CENTER_X) / RADIUS_X;
        const ny = (corner.y - CENTER_Y) / RADIUS_Y;
        return nx * nx + ny * ny <= 1;
    });
};

const overlaps = (candidate: PositionedWord, placed: PositionedWord[], variant: 'default' | 'modal') => {
    const candidatePadding = getPadding(candidate.fontSize, variant);

    return placed.some((item) => {
        const itemPadding = getPadding(item.fontSize, variant);
        const xGap = Math.abs(candidate.x - item.x);
        const yGap = Math.abs(candidate.y - item.y);

        return (
            xGap < (candidate.width + item.width) / 2 + candidatePadding.x + itemPadding.x &&
            yGap < (candidate.height + item.height) / 2 + candidatePadding.y + itemPadding.y
        );
    });
};

const getNeighborGapScore = (candidate: PositionedWord, placed: PositionedWord[], variant: 'default' | 'modal') => {
    if (placed.length === 0) return 0;

    let nearest = Number.POSITIVE_INFINITY;
    const candidatePadding = getPadding(candidate.fontSize, variant);

    placed.forEach((item) => {
        const itemPadding = getPadding(item.fontSize, variant);
        const dx =
            Math.abs(candidate.x - item.x) - ((candidate.width + item.width) / 2 + candidatePadding.x + itemPadding.x);
        const dy =
            Math.abs(candidate.y - item.y) -
            ((candidate.height + item.height) / 2 + candidatePadding.y + itemPadding.y);
        const gap = Math.max(dx, dy, 0);
        nearest = Math.min(nearest, gap);
    });

    return nearest;
};

const buildNeighborCandidates = (
    item: WordCloudEntry,
    fontSize: number,
    width: number,
    height: number,
    rotate: 0 | 90,
    placed: PositionedWord[],
    variant: 'default' | 'modal',
    showSubmitters: boolean,
) => {
    const candidates: PositionedWord[] = [];
    const color = COLORS[hashCode(item.text) % COLORS.length];
    const tooltip = buildTooltip(item, showSubmitters);

    placed.forEach((anchorWord) => {
        const candidatePadding = getPadding(fontSize, variant);
        const anchorPadding = getPadding(anchorWord.fontSize, variant);
        const baseOffsetX = (width + anchorWord.width) / 2 + candidatePadding.x + anchorPadding.x;
        const baseOffsetY = (height + anchorWord.height) / 2 + candidatePadding.y + anchorPadding.y;

        FILL_SCALES.forEach((scale) => {
            NEIGHBOR_DIRECTIONS.forEach((direction, index) => {
                const offsetX = direction.x === 0 ? 0 : baseOffsetX * direction.x * scale;
                const offsetY = direction.y === 0 ? 0 : baseOffsetY * direction.y * scale;
                const jitter = index >= 4 ? 0.92 : 1;
                const x = clamp(anchorWord.x + offsetX * jitter, width / 2 + 12, WIDTH - width / 2 - 12);
                const y = clamp(anchorWord.y + offsetY * jitter, height / 2 + 12, HEIGHT - height / 2 - 12);

                candidates.push({
                    ...item,
                    x,
                    y,
                    fontSize,
                    width,
                    height,
                    color,
                    rotate,
                    tooltip,
                });
            });
        });
    });

    return candidates;
};

const buildSpiralCandidate = (
    item: WordCloudEntry,
    fontSize: number,
    width: number,
    height: number,
    rotate: 0 | 90,
    step: number,
    index: number,
    variant: 'default' | 'modal',
    showSubmitters: boolean,
) => {
    const seed = hashCode(item.text);
    const angle = seed * 0.017 + step * SPIRAL_ANGLE;
    const stepRatio = Math.sqrt(step + 0.5);
    const radius = index === 0 ? 0 : stepRatio * (variant === 'modal' ? 13 : 16);
    const wobble = 1 + ((hashCode(`${item.text}-${step}`) % 9) - 4) * 0.006;
    const horizontalBias = index < 12 ? 1.04 : 0.98;
    const verticalBias = index < 12 ? 0.72 : 0.82;
    const x = CENTER_X + Math.cos(angle) * radius * horizontalBias * wobble;
    const y = CENTER_Y + Math.sin(angle) * radius * verticalBias * wobble;

    return {
        ...item,
        x,
        y,
        fontSize,
        width,
        height,
        color: COLORS[seed % COLORS.length],
        rotate,
        tooltip: buildTooltip(item, showSubmitters),
    };
};

const getPlacementScore = (candidate: PositionedWord, placed: PositionedWord[], variant: 'default' | 'modal') => {
    const dx = candidate.x - CENTER_X;
    const dy = candidate.y - CENTER_Y;
    const centerDistance = Math.hypot(dx * 0.7, dy * 1.05);
    const neighborGap = getNeighborGapScore(candidate, placed, variant);
    const preferredGap = variant === 'modal' ? 2.8 : 4.4;
    const gapPenalty = Math.abs(neighborGap - preferredGap) * (variant === 'modal' ? 7.8 : 5.2);
    const verticalPenalty = candidate.rotate === 90 ? 11 : 0;
    const bandPenalty = Math.abs(dy) * (variant === 'modal' ? 0.018 : 0.032);
    const edgePenalty = Math.max(0, Math.abs(dx) - RADIUS_X * 0.78) * 0.07;
    const balancePenalty = placed.reduce((penalty, item) => {
        const sameBand = Math.abs(item.y - candidate.y) < (candidate.height + item.height) * 0.55;
        if (!sameBand) return penalty;
        return penalty + Math.max(0, RADIUS_X * 0.34 - Math.abs(item.x - candidate.x)) * 0.012;
    }, 0);

    return centerDistance + gapPenalty + verticalPenalty + bandPenalty + edgePenalty + balancePenalty;
};

const WordCloudView: React.FC<WordCloudViewProps> = ({
    entries,
    className = '',
    showSubmitters = false,
    variant = 'default',
}) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [hoveredText, setHoveredText] = useState('');
    const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

    const positioned = useMemo(() => {
        if (entries.length === 0) return [] as PositionedWord[];

        const source = entries.slice(0, MAX_WORDS);
        const minCount = Math.min(...source.map((item) => item.count));
        const maxCount = Math.max(...source.map((item) => item.count));
        const fontRange = variant === 'modal'
            ? { min: 30, max: 220, fallback: 18 }
            : { min: 26, max: 138, fallback: 20 };
        const secondCount = source[1]?.count ?? maxCount;
        const densityFontScale = getDensityFontScale(source.length, variant);

        const placed: PositionedWord[] = [];

        source.forEach((item, index) => {
            const uniformRatio = source.length > 18 ? 0.16 : source.length > 8 ? 0.24 : 0.34;
            const ratio = maxCount === minCount ? uniformRatio : (item.count - minCount) / Math.max(maxCount, 1);
            const easedRatio = Math.pow(ratio, 0.45);
            const dominance = maxCount > 0 ? item.count / maxCount : 0;
            const rankFalloff = Math.max(0, 1 - index / Math.max(source.length - 1, 1));
            const itemMaxFontSize = getLengthAdjustedMaxFontSize(item.text, fontRange.max, variant);
            const leaderBoost =
                index === 0 && maxCount > secondCount
                    ? Math.min(1.14, 1 + ((maxCount - secondCount) / Math.max(maxCount, 1)) * 0.18)
                    : 1;
            const emphasisBoost = 1 + dominance * 0.14 + rankFalloff * 0.06;
            const baseSize = Math.round(
                Math.min(
                    itemMaxFontSize,
                    (fontRange.min + easedRatio * (fontRange.max - fontRange.min)) *
                        emphasisBoost *
                        leaderBoost *
                        densityFontScale,
                ),
            );

            let fontSize = baseSize;
            let bestCandidate: PositionedWord | null = null;

            for (let shrink = 0; shrink < 8 && !bestCandidate; shrink += 1) {
                const textUnits = getTextUnits(item.text);
                const rotate: 0 | 90 =
                    index > 16 && textUnits <= 4.4 && fontSize < 54 && hashCode(item.text) % 7 === 0 ? 90 : 0;
                const baseWidth = estimateWordWidth(item.text, fontSize);
                const baseHeight = Math.max(28, fontSize * 0.94);
                const width = rotate === 90 ? baseHeight : baseWidth;
                const height = rotate === 90 ? baseWidth : baseHeight;
                let bestScore = Number.POSITIVE_INFINITY;

                if (index < PRIMARY_ANCHORS.length) {
                    const anchor = PRIMARY_ANCHORS[index];
                    const anchorX = clamp(CENTER_X + anchor.x, width / 2 + 14, WIDTH - width / 2 - 14);
                    const anchorY = clamp(CENTER_Y + anchor.y, height / 2 + 14, HEIGHT - height / 2 - 14);
                    const anchoredCandidate: PositionedWord = {
                        ...item,
                        x: anchorX,
                        y: anchorY,
                        fontSize,
                        width,
                        height,
                        color: COLORS[hashCode(item.text) % COLORS.length],
                        rotate,
                        tooltip: buildTooltip(item, showSubmitters),
                    };

                    if (
                        isInsideEllipse(anchorX, anchorY, width, height) &&
                        !overlaps(anchoredCandidate, placed, variant)
                    ) {
                        bestCandidate = anchoredCandidate;
                    }
                }

                if (bestCandidate) break;

                const neighborCandidates = buildNeighborCandidates(
                    item,
                    fontSize,
                    width,
                    height,
                    rotate,
                    placed,
                    variant,
                    showSubmitters,
                );
                neighborCandidates.forEach((candidate) => {
                    if (!isInsideEllipse(candidate.x, candidate.y, width, height)) return;
                    if (overlaps(candidate, placed, variant)) return;

                    const score = getPlacementScore(candidate, placed, variant);
                    if (score < bestScore) {
                        bestScore = score;
                        bestCandidate = candidate;
                    }
                });

                if (bestCandidate && bestScore < 14) break;

                for (let step = 0; step < 6200; step += 1) {
                    const candidate = buildSpiralCandidate(
                        item,
                        fontSize,
                        width,
                        height,
                        rotate,
                        step,
                        index,
                        variant,
                        showSubmitters,
                    );

                    if (!isInsideEllipse(candidate.x, candidate.y, width, height)) continue;
                    if (overlaps(candidate, placed, variant)) continue;

                    const score = getPlacementScore(candidate, placed, variant);
                    if (score < bestScore) {
                        bestScore = score;
                        bestCandidate = candidate;
                    }

                    if (bestScore < 7) break;
                }

                fontSize = Math.max(fontRange.fallback, Math.floor(fontSize * 0.94));
            }

            if (bestCandidate) {
                placed.push(bestCandidate);
            }
        });

        return scalePositionedWords(placed, getCloudFillScale(placed, source.length, variant));
    }, [entries, showSubmitters, variant]);

    const hoveredWord = hoveredText
        ? positioned.find((item) => item.text === hoveredText) || null
        : null;

    const containerWidth = containerRef.current?.clientWidth || 0;
    const containerHeight = containerRef.current?.clientHeight || 0;
    const tooltipLeft = Math.max(8, Math.min(Math.max(8, containerWidth - 336), tooltipPos.x + 16));
    const tooltipTop = Math.max(8, Math.min(Math.max(8, containerHeight - 220), tooltipPos.y + 16));

    const updateTooltipPosition = (clientX: number, clientY: number) => {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        setTooltipPos({
            x: Math.max(8, Math.min(rect.width - 8, clientX - rect.left)),
            y: Math.max(8, Math.min(rect.height - 8, clientY - rect.top)),
        });
    };

    return (
        <div className={`flex h-full w-full justify-center ${className}`}>
            <div
                ref={containerRef}
                className={`relative w-full overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-cyan-50 ${
                    variant === 'modal'
                        ? 'h-full min-h-0 rounded-[28px] border-blue-200 shadow-inner'
                        : 'max-w-[2100px] min-h-[320px] aspect-[21/9]'
                }`}
            >
                <svg
                    className="absolute inset-0 h-full w-full"
                    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                    preserveAspectRatio="xMidYMid meet"
                    role="img"
                    aria-label="word cloud"
                >
                    <defs>
                        <radialGradient id={`cloudGlow-${variant}`} cx="50%" cy="50%" r="65%">
                            <stop offset="0%" stopColor="rgba(255,255,255,0.96)" />
                            <stop offset="68%" stopColor="rgba(255,255,255,0.82)" />
                            <stop offset="100%" stopColor="rgba(255,255,255,0.38)" />
                        </radialGradient>
                    </defs>
                    <ellipse cx={CENTER_X} cy={CENTER_Y} rx={RADIUS_X} ry={RADIUS_Y} fill={`url(#cloudGlow-${variant})`} />
                    {positioned.map((item) => (
                        <text
                            key={item.text}
                            x={item.x}
                            y={item.y}
                            fontSize={item.fontSize}
                            fill={item.color}
                            stroke={hoveredText === item.text ? '#111827' : 'none'}
                            strokeWidth={hoveredText === item.text ? Math.max(1.2, item.fontSize * 0.03) : 0}
                            paintOrder="stroke fill"
                            strokeLinejoin="round"
                            fontWeight={900}
                            textAnchor="middle"
                            dominantBaseline="central"
                            transform={`rotate(${item.rotate} ${item.x} ${item.y})`}
                            style={{ userSelect: 'none' }}
                            onMouseEnter={(event) => {
                                setHoveredText(item.text);
                                updateTooltipPosition(event.clientX, event.clientY);
                            }}
                            onMouseMove={(event) => {
                                updateTooltipPosition(event.clientX, event.clientY);
                            }}
                            onMouseLeave={() => {
                                setHoveredText('');
                            }}
                        >
                            <title>{item.tooltip}</title>
                            {item.text}
                        </text>
                    ))}
                </svg>

                {showSubmitters && hoveredWord && (
                    <div
                        className="pointer-events-none absolute z-20 min-w-[220px] max-w-[360px] rounded-md border-l-4 border-orange-400 bg-black/75 p-2.5 pl-3 text-white shadow-2xl"
                        style={{
                            left: `${tooltipLeft}px`,
                            top: `${tooltipTop}px`,
                            transform: 'translate(0, 0)',
                        }}
                    >
                        <div
                            className="absolute -left-2 top-4 h-0 w-0"
                            style={{
                                borderTop: '8px solid transparent',
                                borderBottom: '8px solid transparent',
                                borderRight: '8px solid rgba(0, 0, 0, 0.75)',
                            }}
                        />
                        <div className="mb-1.5 text-base font-bold leading-none">
                            {hoveredWord.text} ({hoveredWord.count})
                        </div>
                        <div className="mb-1 text-[11px] font-bold text-orange-200">Submitters</div>
                        <div className="space-y-1">
                            {(hoveredWord.submitters || []).map((name) => (
                                <div
                                    key={`${hoveredWord.text}-${name}`}
                                    className="flex items-center gap-1.5 text-[12px] font-semibold leading-tight"
                                >
                                    <span className="inline-block h-2 w-2 border border-orange-300 bg-transparent" />
                                    <span>{name}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default WordCloudView;
