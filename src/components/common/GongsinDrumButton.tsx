import { forwardRef, type ButtonHTMLAttributes } from "react";
import "./gongsinDrumButton.css";

export type GongsinDrumButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  caption?: string;
  size?: "compact" | "large";
};

const RIM_COLORS = ["#d6473b", "#e7b937", "#315b9a"];
const STUDS = Array.from({ length: 16 }, (_, index) => {
  const angle = ((index * 360) / 16 - 90) * (Math.PI / 180);
  return { x: 50 + Math.cos(angle) * 43, y: 49 + Math.sin(angle) * 43 };
});

/** A front-facing sinmungo drum; native button behavior belongs to the caller. */
const GongsinDrumButton = forwardRef<HTMLButtonElement, GongsinDrumButtonProps>(
  function GongsinDrumButton(
    {
      loading = false,
      caption,
      size = "compact",
      className = "",
      disabled,
      type = "button",
      children,
      "aria-label": ariaLabel,
      "aria-busy": ariaBusy,
      ...buttonProps
    },
    ref,
  ) {
    const visibleCaption = caption ?? children;
    return (
      <button
        {...buttonProps}
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || ariaBusy}
        aria-label={
          loading
            ? "보내는 중"
            : ariaLabel || (visibleCaption ? undefined : "보내기")
        }
        className={`gongsin-drum-button gongsin-drum-button--${size}${loading ? " is-loading" : ""} ${className}`}
      >
        <span className="gongsin-drum-button__disc">
          <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
            <circle cx="50" cy="52" r="47" fill="#1d2530" />
            <circle cx="50" cy="49" r="47" fill="#293443" />
            <circle
              cx="50"
              cy="49"
              r="45.5"
              fill="none"
              stroke="#69717b"
              strokeWidth="1"
            />
            <circle cx="50" cy="49" r="40" fill="#d6473b" />
            {Array.from({ length: 12 }, (_, index) => (
              <circle
                key={index}
                cx="50"
                cy="49"
                r="37"
                fill="none"
                stroke={RIM_COLORS[index % RIM_COLORS.length]}
                strokeWidth="7"
                strokeDasharray="8.333333 91.666667"
                pathLength="100"
                transform={`rotate(${index * 30 - 105} 50 49)`}
              />
            ))}
            <circle
              cx="50"
              cy="49"
              r="33.5"
              fill="#f3e7c7"
              stroke="#b59d74"
              strokeWidth="0.9"
            />
            <path
              d="M21 42a30 30 0 0 1 47-18"
              fill="none"
              stroke="#fff8e5"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <path
              d="M79 56a30 30 0 0 1-45 18"
              fill="none"
              stroke="#d9c7a1"
              strokeWidth="1"
              strokeLinecap="round"
            />
            <g transform="translate(50 49)">
              {/* Three curved sectors share their boundaries around one center. */}
              {RIM_COLORS.map((color, index) => (
                <path
                  key={color}
                  d="M0 0C-5-1-9-6-6-11C-4-14-1-15 0-15A15 15 0 0 1 12.99 7.5C13.49 6.63 14.12 3.54 12.53.3C9.7-4.79 3.37-3.83 0 0Z"
                  fill={color}
                  transform={`rotate(${index * 120})`}
                />
              ))}
            </g>
            {STUDS.map(({ x, y }, index) => (
              <g key={index}>
                <circle cx={x} cy={y + 0.5} r="2" fill="#141c26" />
                <circle cx={x} cy={y} r="1.55" fill="#9da6b1" />
                <circle cx={x - 0.35} cy={y - 0.4} r="0.65" fill="#e8e8df" />
              </g>
            ))}
          </svg>
          {loading && (
            <span className="gongsin-drum-button__progress" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          )}
        </span>
        {visibleCaption && (
          <span className="gongsin-drum-button__caption">
            {loading ? "보내는 중" : visibleCaption}
          </span>
        )}
      </button>
    );
  },
);

export default GongsinDrumButton;
