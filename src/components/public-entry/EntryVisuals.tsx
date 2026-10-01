import React from "react";

export function FinaleTitle() {
  return (
    <div className="entry-finale-art">
      <h2
        id="entry-finish-title"
        className="entry-finale-title"
        aria-label="이제 우리의 이야기로. 위스토리"
      >
        <span className="entry-finale-phrase" aria-hidden="true">
          이제 우리의 이야기로.
        </span>
        <span className="entry-finale-brand" aria-hidden="true">
          <span className="entry-finale-we">위</span>
          <span className="entry-finale-story">
            스토
            <span className="entry-finale-ri">
              리<span className="entry-finale-baseline" />
            </span>
          </span>
        </span>
      </h2>
    </div>
  );
}

export function MotionTitle({
  lines,
  id,
  effect = "gather",
}: {
  lines: string[];
  id?: string;
  effect?: "gather" | "depth" | "add";
}) {
  return (
    <h2
      className={`entry-motion-title entry-type--${effect}`}
      id={id}
      aria-label={lines.join(" ")}
    >
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
