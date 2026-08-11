import React from "react";

const NavigationIcon: React.FC<{ path: string }> = ({ path }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
    <path
      d={path}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
  </svg>
);

export default NavigationIcon;
