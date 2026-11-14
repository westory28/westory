import { useRef, useState, type ButtonHTMLAttributes } from "react";
import "./refreshButton.css";

type RefreshButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "children"
> & {
  onClick: () => void | Promise<unknown>;
  loading?: boolean;
  label?: string;
};

/** Reload only the owning view's data. Selection and filters belong to the view. */
export default function RefreshButton({
  onClick,
  loading = false,
  disabled = false,
  label = "새로고침",
  className = "",
  ...props
}: RefreshButtonProps) {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const busy = loading || pending;
  return (
    <button
      {...props}
      type="button"
      className={`ws-refresh-button ${className}`}
      aria-label={label}
      title={label}
      aria-busy={busy}
      disabled={disabled || busy}
      onClick={async () => {
        if (inFlight.current || disabled || loading) return;
        inFlight.current = true;
        setPending(true);
        try {
          await onClick();
        } finally {
          inFlight.current = false;
          setPending(false);
        }
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20 7v5h-5M20 12a8 8 0 1 0-2.3 5.7" />
      </svg>
    </button>
  );
}
