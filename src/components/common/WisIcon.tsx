import React from "react";

const WisIcon: React.FC<{ className?: string }> = ({ className = "" }) => (
  <svg
    viewBox="0 0 24 24"
    width="24"
    height="24"
    fill="none"
    aria-hidden="true"
    focusable="false"
    className={`wis-icon ${className}`}
  >
    <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.5" />
    <text
      x="12"
      y="15.6"
      textAnchor="middle"
      fill="currentColor"
      fontFamily="Arial, Helvetica, sans-serif"
      fontSize="11"
      fontWeight="700"
      letterSpacing="-0.6"
    >
      Ws
    </text>
  </svg>
);

export default WisIcon;
