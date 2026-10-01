import React from "react";

export function FinaleTitle() {
  return (
    <div className="entry-finale-art">
      <h2
        id="entry-finish-title"
        className="entry-finale-title"
        aria-label="이제 우리의 이야기로, 위스토리"
      >
        <span className="entry-finale-phrase" aria-hidden="true">
          이제 우리의 이야기로,
        </span>
        <span className="entry-finale-brand" aria-hidden="true">
          <span className="entry-finale-latin">
            {Array.from("Westory").map((letter, index) => (
              <span
                key={index}
                style={{ "--glyph": index } as React.CSSProperties}
              >
                {letter}
              </span>
            ))}
          </span>
          <span className="entry-finale-korean">
            {Array.from("위스토리").map((letter, index) => (
              <span
                key={letter}
                style={{ "--glyph": index } as React.CSSProperties}
              >
                {letter}
              </span>
            ))}
          </span>
          <span className="entry-finale-sparks">
            {[0, 1, 2, 3].map((index) => (
              <i
                key={index}
                style={{ "--spark": index } as React.CSSProperties}
              />
            ))}
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
          <span style={{ "--line": index } as React.CSSProperties}>
            {line.split(" ").map((word, wordIndex) => (
              <React.Fragment key={`${word}-${wordIndex}`}>
                {wordIndex > 0 && " "}
                <span
                  className="entry-title-word"
                  style={{ "--word": wordIndex } as React.CSSProperties}
                >
                  {word}
                </span>
              </React.Fragment>
            ))}
          </span>
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
    <p className="entry-eyebrow entry-menu-label">
      <span className="entry-menu-number">{number}</span>
      <span className="entry-menu-name">{label}</span>
    </p>
  );
}
