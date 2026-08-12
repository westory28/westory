import React from "react";

interface WestoryBrandProps {
  as?: "div" | "h1";
  className?: string;
  subtitle?: string;
}

const WestoryBrand: React.FC<WestoryBrandProps> = ({
  as: Element = "div",
  className = "",
  subtitle,
}) => (
  <Element className={`ws-wordmark ${className}`.trim()} aria-label="위스토리">
    <span className="ws-wordmark__name" aria-hidden="true">
      <span>We</span>
      <span>story</span>
    </span>
    {subtitle && <span className="ws-wordmark__subtitle">{subtitle}</span>}
  </Element>
);

export default WestoryBrand;
