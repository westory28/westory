import React from "react";

export function FinaleTitle() {
  return (
    <div className="entry-finale-art">
      <div className="entry-finale-rings" aria-hidden="true">
        <span />
        <span />
      </div>
      <h2
        id="entry-finish-title"
        className="entry-finale-title"
        aria-label="이제 우리의 이야기로. 위스토리"
      >
        <span className="entry-finale-phrase" aria-hidden="true">
          {["이제", "우리의", "이야기로."].map((word, index) => (
            <span key={word} style={{ "--word": index } as React.CSSProperties}>
              {word}
            </span>
          ))}
        </span>
        <span className="entry-finale-brand" aria-hidden="true">
          <svg viewBox="0 0 600 190" preserveAspectRatio="none">
            <path
              pathLength="1"
              d="M15 138 C75 190 100 110 155 144 S250 184 303 140 S400 110 455 144 S545 182 585 132"
            />
          </svg>
          {Array.from("위스토리").map((letter, index) => (
            <span
              key={letter}
              style={
                {
                  "--letter": index,
                  "--spread": (index - 1.5) * 30,
                } as React.CSSProperties
              }
            >
              {letter}
              <i />
            </span>
          ))}
        </span>
      </h2>
    </div>
  );
}

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
