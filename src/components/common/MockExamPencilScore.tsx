import React, { useId } from "react";

// Original single-line numerals: slightly uneven joins and an open pencil stroke,
// rather than a typeset italic font. No external font or image request is needed.
const DIGITS: Record<string, string> = {
  "0": "M20 3C12 0 6 7 4 18C1 29 4 37 11 37C19 36 23 25 24 14C25 6 23 2 18 3",
  "1": "M8 11L17 3C16 13 12 28 10 38",
  "2": "M4 11C9 0 22 0 24 9C26 18 10 28 3 37C11 36 18 37 25 35",
  "3": "M5 6C14 1 25 2 23 11C22 17 15 20 11 20C17 19 25 22 21 30C18 38 6 40 2 34",
  "4": "M21 2L4 25C10 25 19 25 27 23M23 7L15 39",
  "5": "M25 3L10 4L6 19C12 15 24 18 23 27C23 37 9 42 3 34",
  "6": "M24 4C14 1 7 14 4 25C1 34 9 41 17 35C26 29 24 18 16 18C9 17 5 23 4 26",
  "7": "M4 5C12 4 19 6 27 3C20 12 12 27 8 39",
  "8": "M14 20C5 16 5 9 11 5C18 0 26 4 23 11C21 17 9 22 5 28C-1 38 12 42 20 35C29 28 22 23 14 20",
  "9": "M22 17C15 24 4 22 6 12C8 2 23 0 25 8C27 20 18 34 8 39",
  ".": "M5 35L4 37",
  "-": "M3 22L19 21",
};

export function PencilStrokes({
  d,
  reveal,
}: {
  d: string;
  reveal?: {
    kind: "mark" | "tail" | "correction" | "score";
    duration: number;
    delay?: number;
  };
}) {
  const maskId = useId();
  const ink = (
    <>
      <path className="mock-exam-pencil-core" d={d} />
      <path
        className="mock-exam-pencil-grain"
        d={d}
        transform="translate(0.8 -0.7)"
      />
      <path
        className="mock-exam-pencil-grain is-light"
        d={d}
        transform="translate(-0.9 0.8)"
      />
      <path className="mock-exam-pencil-fiber" d={d} />
    </>
  );
  if (!reveal) return ink;
  const animation = {
    mark: "mock-exam-pencil-draw",
    tail: "mock-exam-pencil-finish",
    correction: "mock-exam-correction-draw",
    score: "mock-exam-score-write",
  }[reveal.kind];
  return (
    <g
      className={`mock-exam-pencil-stroke mock-exam-pencil-stroke--${reveal.kind}`}
      style={
        {
          "--pencil-animation": animation,
          "--pencil-duration": `${reveal.duration}ms`,
          "--pencil-delay": `${reveal.delay || 0}ms`,
        } as React.CSSProperties
      }
    >
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="-20"
          y="-20"
          width="400"
          height="160"
        >
          <path className="mock-exam-pencil-reveal" d={d} pathLength="100" />
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>{ink}</g>
    </g>
  );
}

export const formatMockExamScore = (score: number) =>
  String(Number(score.toFixed(2)));

function scoreStrokes(score: number) {
  const label = formatMockExamScore(score);
  const strokes: Array<{
    d: string;
    transform?: string;
    duration: number;
    underline?: boolean;
  }> = [];
  let advance = 4;
  [...label].forEach((digit, index) => {
    const x = advance;
    advance += digit === "." ? 10 : 28;
    // Each pen lift gets its own reveal so a later intersecting stroke cannot
    // appear before the pencil reaches it (including the crossbar in 4).
    for (const d of DIGITS[digit]?.match(/M[^M]+/g) || []) {
      strokes.push({
        d,
        duration: 90,
        transform: `translate(${x} ${[5, 4, 6][index % 3]}) rotate(${[-3, 2, -1][index % 3]} 13 20)`,
      });
    }
  });
  const width = advance + 4;
  strokes.push(
    {
      d: `M3 52Q${width * 0.44} 49 ${width - 4} 48`,
      duration: 80,
      underline: true,
    },
    {
      d: `M7 57Q${width * 0.5} 54 ${width - 8} 54`,
      duration: 80,
      underline: true,
    },
  );
  return { label, width, strokes };
}

export const getMockExamScoreDuration = (score: number) =>
  scoreStrokes(score).strokes.reduce((sum, stroke) => sum + stroke.duration, 0);

export default function MockExamPencilScore({
  score,
  animate = false,
}: {
  score: number;
  animate?: boolean;
}) {
  if (!Number.isFinite(score)) return null;
  const { label, width, strokes } = scoreStrokes(score);
  let delay = 0;
  return (
    <strong
      className="mock-exam-score"
      role="img"
      data-score-state={animate ? "drawing" : "complete"}
      aria-label={`점수 ${label}점`}
    >
      <span className="mock-exam-sr-only">{label}</span>
      <svg
        className="mock-exam-score-pencil"
        viewBox={`0 0 ${width} 62`}
        width={width}
        height="62"
        aria-hidden="true"
      >
        {strokes.map((stroke, index) => {
          const start = delay;
          delay += stroke.duration;
          return (
            <g
              key={index}
              transform={stroke.transform}
              className={
                stroke.underline ? "mock-exam-score-underline" : undefined
              }
            >
              <PencilStrokes
                d={stroke.d}
                reveal={
                  animate
                    ? { kind: "score", duration: stroke.duration, delay: start }
                    : undefined
                }
              />
            </g>
          );
        })}
      </svg>
    </strong>
  );
}
