import React from "react";

const ResponsiveDataContainer: React.FC<{
  children: React.ReactNode;
  label?: string;
  className?: string;
}> = ({ children, label = "자료", className = "" }) => (
  <div
    className={`ws-responsive-data ${className}`}
    role="region"
    aria-label={label}
    tabIndex={0}
  >
    {children}
  </div>
);

export default ResponsiveDataContainer;
