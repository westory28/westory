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

const WIDTH = 1600;
const HEIGHT = 900;
const RADIUS_X = 630;
const RADIUS_Y = 350;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
const MAX_WORDS = 80;
const COLORS = ['#1d4ed8', '#059669', '#7c3aed', '#ea580c', '#0f766e', '#be123c', '#0ea5e9', '#334155'];

const hashCode = (value: string) => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = (hash << 5) - hash + value.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
};

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
        return nx * nx + ny * ny <= 1.02;
    });
};

const overlaps = (candidate: PositionedWord, placed: PositionedWord[]) =>
    placed.some((item) => {
        const xGap = Math.abs(candidate.x - item.x);
        const yGap = Math.abs(candidate.y - item.y);
        return xGap < (candidate.width + item.width) / 2 + 8 && yGap < (candidate.height + item.height) / 2 + 6;
    });

const buildTooltip = (entry: WordCloudEntry, showSubmitters: boolean) => {
    const base = `${entry.text}: ${entry.count}회`;
    if (!showSubmitters) return base;

    const names = Array.from(
        new Set((entry.submitters || []).map((name) => String(name || '').trim()).filter(Boolean)),
    );
    if (names.length === 0) return base;

    const preview = names.slice(0, 8).join(', ');
    const suffix = names.length > 8 ? ` 외 ${names.length - 8}명` : '';
    return `${base}\n제출자: ${preview}${suffix}`;
};

const WordCloudView: React.FC<WordCloudViewProps> = ({ entries, className = '', showSubmitters = false }) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [hoveredText, setHoveredText] = useState<string>('');
    const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

    const positioned = useMemo(() => {
        if (entries.length === 0) return [] as PositionedWord[];

        const source = entries.slice(0, MAX_WORDS);
        const minCount = Math.min(...source.map((item) => item.count));
        const maxCount = Math.max(...source.map((item) => item.count));
        const placed: PositionedWord[] = [];

        for (const item of source) {
            const ratio = maxCount === minCount ? 1 : (item.count - minCount) / (maxCount - minCount);
            // Start larger overall so early clouds remain readable.
            const baseSize = Math.round(42 + Math.pow(ratio, 0.84) * 56);

            let fontSize = baseSize;
            let placedWord: PositionedWord | null = null;

            for (let shrink = 0; shrink < 4 && !placedWord; shrink += 1) {
                const baseWidth = Math.max(fontSize * (item.text.length * 0.52 + 1.8), fontSize * 2.5);
                const baseHeight = fontSize * 1.06;
                // Favor horizontal layout; keep vertical words as sparse accents.
                const rotate: 0 | 90 = hashCode(item.text) % 10 === 0 ? 90 : 0;
                const width = rotate === 90 ? baseHeight : baseWidth;
                const height = rotate === 90 ? baseWidth : baseHeight;
                const angleSeed = hashCode(item.text) % 360;

                for (let step = 0; step < 1300; step += 1) {
                    const angle = ((angleSeed + step * 11) * Math.PI) / 180;
                    const radius = 5 + step * 0.57;
                    const x = CENTER_X + Math.cos(angle) * radius;
                    const y = CENTER_Y + Math.sin(angle) * radius * 0.68;

                    const candidate: PositionedWord = {
                        ...item,
                        x,
                        y,
                        fontSize,
                        width,
                        height,
                        color: COLORS[hashCode(item.text) % COLORS.length],
                        rotate,
                        tooltip: buildTooltip(item, showSubmitters),
                    };

                    if (!isInsideEllipse(x, y, width, height)) continue;
                    if (overlaps(candidate, placed)) continue;
                    placedWord = candidate;
                    break;
                }

                fontSize = Math.max(26, Math.floor(fontSize * 0.92));
            }

            if (placedWord) placed.push(placedWord);
        }

        return placed;
    }, [entries, showSubmitters]);

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
        <div className={`w-full flex justify-center ${className}`}>
            <div
                ref={containerRef}
                className="relative w-full max-w-[1600px] aspect-video rounded-2xl bg-gradient-to-br from-blue-50 via-white to-cyan-50 border border-blue-100 overflow-hidden"
            >
                <svg
                    className="absolute inset-0 w-full h-full"
                    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                    preserveAspectRatio="xMidYMid meet"
                    role="img"
                    aria-label="word cloud"
                >
                    <ellipse cx={CENTER_X} cy={CENTER_Y} rx={RADIUS_X} ry={RADIUS_Y} fill="rgba(255,255,255,0.65)" />
                    {positioned.map((item) => (
                        <text
                            key={item.text}
                            x={item.x}
                            y={item.y}
                            fontSize={item.fontSize}
                            fill={item.color}
                            stroke={hoveredText === item.text ? '#111827' : 'none'}
                            strokeWidth={hoveredText === item.text ? Math.max(1.4, item.fontSize * 0.06) : 0}
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
                        className="absolute z-20 min-w-[220px] max-w-[360px] rounded-md bg-black/75 text-white shadow-2xl p-2.5 pl-3 border-l-4 border-orange-400 pointer-events-none"
                        style={{
                            left: `${tooltipLeft}px`,
                            top: `${tooltipTop}px`,
                            transform: 'translate(0, 0)',
                        }}
                    >
                        <div
                            className="absolute -left-2 top-4 w-0 h-0"
                            style={{
                                borderTop: '8px solid transparent',
                                borderBottom: '8px solid transparent',
                                borderRight: '8px solid rgba(0, 0, 0, 0.75)',
                            }}
                        />
                        <div className="text-base font-bold leading-none mb-1.5">
                            {hoveredWord.text} ({hoveredWord.count})
                        </div>
                        <div className="text-[11px] font-bold text-orange-200 mb-1">Submitters</div>
                        <div className="space-y-1">
                            {(hoveredWord.submitters || []).map((name) => (
                                <div
                                    key={`${hoveredWord.text}-${name}`}
                                    className="flex items-center gap-1.5 text-[12px] leading-tight font-semibold"
                                >
                                    <span className="inline-block w-2 h-2 border border-orange-300 bg-transparent" />
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

