import React, { useMemo } from 'react';

interface WordCloudEntry {
    text: string;
    count: number;
}

interface WordCloudViewProps {
    entries: WordCloudEntry[];
    className?: string;
}

interface PositionedWord extends WordCloudEntry {
    x: number;
    y: number;
    fontSize: number;
    width: number;
    height: number;
    color: string;
    rotate: number;
}

const WIDTH = 920;
const HEIGHT = 520;
const RADIUS_X = 360;
const RADIUS_Y = 220;
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
        return xGap < (candidate.width + item.width) / 2 + 6 && yGap < (candidate.height + item.height) / 2 + 4;
    });

const WordCloudView: React.FC<WordCloudViewProps> = ({ entries, className = '' }) => {
    const positioned = useMemo(() => {
        if (entries.length === 0) return [] as PositionedWord[];

        const source = entries.slice(0, MAX_WORDS);
        const minCount = Math.min(...source.map((item) => item.count));
        const maxCount = Math.max(...source.map((item) => item.count));
        const placed: PositionedWord[] = [];

        for (const item of source) {
            const ratio = maxCount === minCount ? 1 : (item.count - minCount) / (maxCount - minCount);
            const baseSize = Math.round(15 + Math.pow(ratio, 0.65) * 68);

            let fontSize = baseSize;
            let placedWord: PositionedWord | null = null;

            for (let shrink = 0; shrink < 4 && !placedWord; shrink += 1) {
                const width = Math.max(fontSize * (item.text.length * 0.52 + 1.7), fontSize * 2.2);
                const height = fontSize * 1.08;
                const angleSeed = hashCode(item.text) % 360;

                for (let step = 0; step < 1200; step += 1) {
                    const angle = ((angleSeed + step * 11) * Math.PI) / 180;
                    const radius = 4 + step * 0.58;
                    const x = CENTER_X + Math.cos(angle) * radius;
                    const y = CENTER_Y + Math.sin(angle) * radius * 0.67;

                    const candidate: PositionedWord = {
                        ...item,
                        x,
                        y,
                        fontSize,
                        width,
                        height,
                        color: COLORS[hashCode(item.text) % COLORS.length],
                        rotate: item.count <= minCount + 1 && hashCode(item.text) % 4 === 0 ? -18 : 0,
                    };

                    if (!isInsideEllipse(x, y, width, height)) continue;
                    if (overlaps(candidate, placed)) continue;
                    placedWord = candidate;
                    break;
                }

                fontSize = Math.max(12, Math.floor(fontSize * 0.9));
            }

            if (placedWord) placed.push(placedWord);
        }

        return placed;
    }, [entries]);

    return (
        <div className={`w-full flex justify-center ${className}`}>
            <div className="relative w-full max-w-[920px] aspect-[920/520] rounded-2xl bg-gradient-to-br from-blue-50 via-white to-cyan-50 border border-blue-100 overflow-hidden">
                <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[82%] h-[82%] rounded-full bg-white/55"></div>
                </div>
                {positioned.map((item) => (
                    <span
                        key={item.text}
                        className="absolute font-black leading-none whitespace-nowrap select-none"
                        style={{
                            left: `${(item.x / WIDTH) * 100}%`,
                            top: `${(item.y / HEIGHT) * 100}%`,
                            fontSize: `${item.fontSize}px`,
                            color: item.color,
                            transform: `translate(-50%, -50%) rotate(${item.rotate}deg)`,
                        }}
                        title={`${item.count}회`}
                    >
                        {item.text}
                    </span>
                ))}
            </div>
        </div>
    );
};

export default WordCloudView;

