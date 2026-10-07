import type { SVGProps } from "react";

export default function WeplayLobbyIcon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & {
  name: "ranking" | "history" | "info" | "close" | "anchor";
}) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {name === "info" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6" />
          <circle cx="12" cy="7.5" r=".8" fill="currentColor" stroke="none" />
        </>
      )}
      {name === "ranking" && (
        <>
          <path d="M8 3h8v5a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4M12 12v6m-4 3h8m-6-3h4l2 3H8l2-3Z" />
        </>
      )}
      {name === "history" && (
        <>
          <path d="M4 8a9 9 0 1 1-.5 7M4 3v5h5m3-2v6l4 2" />
        </>
      )}
      {name === "close" && <path d="m6 6 12 12M6 18 18 6" />}
      {name === "anchor" && (
        <>
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v14M8 10h8M3 14c0 4 4 7 9 7s9-3 9-7m-18 0 3 2m15-2-3 2" />
        </>
      )}
    </svg>
  );
}
