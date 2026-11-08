import React from "react";

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

export function PencilStrokes({ d }: { d: string }) {
  return (
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
}

export default function MockExamPencilScore({ score }: { score: number }) {
  if (!Number.isFinite(score)) return null;
  // Preserve the two-decimal result precision, without .00 or trailing zeros.
  const label = String(Number(score.toFixed(2)));
  let advance = 4;
  const numerals = [...label].map((digit, index) => {
    const x = advance;
    advance += digit === "." ? 10 : 28;
    return (
      <g
        key={index}
        transform={`translate(${x} ${[5, 4, 6][index % 3]}) rotate(${[-3, 2, -1][index % 3]} 13 20)`}
      >
        <PencilStrokes d={DIGITS[digit]} />
      </g>
    );
  });
  const width = advance + 56;
  return (
    <strong
      className="mock-exam-score"
      role="img"
      aria-label={`점수 ${label}점, 100점 만점`}
    >
      <span className="mock-exam-sr-only">{label}/100</span>
      <svg
        className="mock-exam-score-pencil"
        viewBox={`0 0 ${width} 62`}
        width={width}
        height="62"
        aria-hidden="true"
      >
        {numerals}
        <g transform={`translate(${advance} 20) scale(0.55)`}>
          <PencilStrokes d="M12 1L2 43" />
          {["1", "0", "0"].map((digit, index) => (
            <g key={index} transform={`translate(${15 + index * 24} 1)`}>
              <PencilStrokes d={DIGITS[digit]} />
            </g>
          ))}
        </g>
        <g className="mock-exam-score-underline">
          <PencilStrokes
            d={`M3 52Q${width * 0.44} 49 ${width - 4} 48M7 57Q${width * 0.5} 54 ${width - 13} 54`}
          />
        </g>
      </svg>
    </strong>
  );
}
