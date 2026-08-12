import React from "react";

const ResponsiveDataContainer: React.FC<{
  children: React.ReactNode;
  label?: string;
  description?: string;
  className?: string;
}> = ({
  children,
  label = "자료",
  description = "표가 화면보다 넓으면 좌우로 이동해 확인할 수 있습니다.",
  className = "",
}) => (
  <section className={`ws-responsive-data-shell ${className}`.trim()}>
    <p className="ws-responsive-data__hint">{description}</p>
    <div
      className="ws-responsive-data"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      {children}
    </div>
  </section>
);

export default ResponsiveDataContainer;
