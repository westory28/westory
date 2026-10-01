import React from "react";

export function MotionTitle({ lines, id }: { lines: string[]; id?: string }) {
  return (
    <h2 className="entry-motion-title" id={id} aria-label={lines.join(" ")}>
      {lines.map((line, index) => (
        <span className="entry-type-mask" key={line} aria-hidden="true">
          <span style={{ "--line": index } as React.CSSProperties}>{line}</span>
        </span>
      ))}
    </h2>
  );
}

/** CSS hardware keeps real teaching screens crisp without a 3D/video runtime. */
export function Device({
  kind = "laptop",
  children,
  className = "",
}: {
  kind?: "laptop" | "tablet" | "phone";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`entry-device entry-device--${kind} ${className}`}>
      <div className="entry-device-lid">
        <span className="entry-device-camera" aria-hidden="true" />
        <div className="entry-device-screen">{children}</div>
      </div>
      {kind === "laptop" && (
        <div className="entry-device-base" aria-hidden="true">
          <span />
        </div>
      )}
    </div>
  );
}

export function StoryLink({
  number,
  label,
}: {
  number: string;
  label: string;
}) {
  return (
    <p className="entry-eyebrow">
      <span>{number}</span>
      {label}
    </p>
  );
}
