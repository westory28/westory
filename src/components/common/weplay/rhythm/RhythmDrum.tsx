import { useId } from "react";

/** Original shinmungo silhouette: pavilion, suspension cords and a single drum. */
export default function RhythmDrum({ compact = false }: { compact?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 400 400" aria-hidden="true" className="rhythm-drum-art">
      <defs>
        <radialGradient id={`${id}-skin`} cx="40%" cy="32%">
          <stop offset="0" stopColor="#fff7df" />
          <stop offset="1" stopColor="#d5b77b" />
        </radialGradient>
        <linearGradient id={`${id}-wood`} x2="0" y2="1">
          <stop stopColor="#a16c39" />
          <stop offset="1" stopColor="#51331d" />
        </linearGradient>
      </defs>
      <path
        d="M52 364h296M76 355V88m248 267V88"
        fill="none"
        stroke={`url(#${id}-wood)`}
        strokeWidth="18"
        strokeLinecap="round"
      />
      <path
        d="M75 322l-24 42m274-42 24 42M76 106h248"
        stroke="#edbd68"
        strokeWidth="6"
        fill="none"
      />
      <path
        d="M30 84Q106 82 147 43h106q41 39 117 41l-23 18H53Z"
        fill="#536143"
        stroke="#edbd68"
        strokeWidth="3"
      />
      <path
        d="M47 87h306M147 43q53 15 106 0"
        stroke="#91d8cf"
        strokeWidth="4"
        fill="none"
      />
      {[90, 118, 146, 174, 202, 230, 258, 286, 314].map((x) => (
        <path key={x} d={`M${x} 78l-5 11`} stroke="#91d8cf" strokeWidth="3" />
      ))}
      <path d="M114 108l15 47m157-47-15 47" stroke="#d5b77b" strokeWidth="6" />
      <circle
        cx="200"
        cy="234"
        r="112"
        fill="#6b4023"
        stroke="#edbd68"
        strokeWidth="5"
      />
      <circle
        cx="200"
        cy="230"
        r="100"
        fill={`url(#${id}-skin)`}
        stroke="#974c34"
        strokeWidth="11"
      />
      {Array.from({ length: 20 }, (_, n) => {
        const a = (n * Math.PI) / 10;
        return (
          <circle
            key={n}
            cx={200 + Math.sin(a) * 101}
            cy={230 + Math.cos(a) * 101}
            r="3"
            fill="#f5e8c9"
          />
        );
      })}
      <circle
        cx="200"
        cy="230"
        r="66"
        fill="none"
        stroke="#6b4023"
        strokeOpacity=".3"
        strokeWidth="2"
      />
      <path
        d="M200 194c-36 0-36 36 0 36s36 36 0 36a36 36 0 0 0 0-72Z"
        fill="#974c34"
        opacity=".8"
      />
      <path
        d="M200 266c36 0 36-36 0-36s-36-36 0-36a36 36 0 0 0 0 72Z"
        fill="#245c65"
        opacity=".9"
      />
      {!compact && (
        <>
          <path d="M153 111h94v25h-94Z" fill="#102f35" stroke="#edbd68" />
          <text
            x="200"
            y="129"
            textAnchor="middle"
            fill="#f5e8c9"
            fontSize="16"
            fontWeight="700"
          >
            신문고
          </text>
        </>
      )}
    </svg>
  );
}
