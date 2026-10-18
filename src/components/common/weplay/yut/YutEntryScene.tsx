import React, { useEffect, useId, useRef, useState } from "react";
import "./yut-entry-scene.css";
const asset = (file: string) =>
  `${import.meta.env.BASE_URL}assets/weplay/yut/${file}`;
const LAYERS = [
  "entry-background.webp",
  "entry-characters.webp",
  "entry-sticks.webp",
];
const ACTORS = [
  {
    role: "ox",
    x: -80,
    y: 160,
    width: 560,
    height: 650,
    crop: [30, 420, 310, 330],
    period: 5600,
    delay: -2100,
  },
  {
    role: "pig",
    x: 765,
    y: 410,
    width: 470,
    height: 520,
    crop: [30, 760, 320, 315],
    period: 6400,
    delay: -3700,
  },
  {
    role: "dog",
    x: 1100,
    y: 340,
    width: 460,
    height: 620,
    crop: [40, 1080, 320, 335],
    period: 7200,
    delay: -900,
  },
  {
    role: "horse",
    x: 220,
    y: -30,
    width: 760,
    height: 950,
    crop: [40, 50, 300, 350],
    period: 4800,
    delay: -300,
  },
];
const STICKS = [
  { x: 770, y: 75, size: 400, col: 0, row: 0, delay: -1300 },
  { x: 1020, y: 210, size: 330, col: 1, row: 0, delay: -3200 },
  { x: 480, y: 570, size: 450, col: 0, row: 1, delay: -700 },
  { x: 730, y: 490, size: 290, col: 1, row: 1, delay: -2400 },
];
/** One fixed background, intact character poses and independent wooden sticks. */
export function YutEntryScene() {
  const sceneId = useId().replace(/:/g, "");
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const element = host.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.isIntersecting),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let disposed = false;
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    if (connection?.saveData) return;
    void Promise.all(
      LAYERS.map(
        (file) =>
          new Promise<void>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve();
            image.onerror = () => reject(new Error("entry-layer"));
            image.src = asset(file);
          }),
      ),
    )
      .then(() => {
        if (!disposed) setReady(true);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);
  return (
    <>
      <div
        ref={host}
        className="yut-entry-scene"
        data-scene-ready={ready}
        data-scene-visible={visible}
        data-scene-paused={paused}
        aria-hidden="true"
      >
        {!ready ? (
          <img
            className="yut-entry-scene-still"
            src={asset("catalog-toss.webp")}
            alt=""
            draggable={false}
          />
        ) : (
          <svg
            className="yut-entry-stage"
            viewBox="0 0 1448 1086"
            preserveAspectRatio="xMidYMid slice"
            focusable="false"
          >
            <defs>
              <clipPath id={`${sceneId}-foreground`}>
                <path d="M0 710 L1448 887 V1086 H0Z" />
              </clipPath>
            </defs>
            <image
              className="yut-entry-background"
              href={asset("entry-background.webp")}
              width="1448"
              height="1086"
            />
            {ACTORS.map((actor) => (
              <g
                key={actor.role}
                className="yut-entry-actor"
                data-role={actor.role}
                style={
                  {
                    "--actor-duration": `${actor.period}ms`,
                    "--actor-delay": `${actor.delay}ms`,
                  } as React.CSSProperties
                }
              >
                {[0, 1, 2].map((frame) => (
                  <svg
                    key={frame}
                    x={actor.x}
                    y={actor.y}
                    width={actor.width}
                    height={actor.height}
                    viewBox={`${actor.crop[0] + frame * 362} ${actor.crop[1]} ${actor.crop[2]} ${actor.crop[3]}`}
                    preserveAspectRatio="xMidYMax meet"
                    className={`yut-entry-actor-frame yut-entry-actor-frame--${frame}`}
                    data-frame={frame}
                  >
                    <defs>
                      <clipPath id={`${sceneId}-${actor.role}-${frame}`}>
                        <rect
                          x={actor.crop[0] + frame * 362}
                          y={actor.crop[1]}
                          width={actor.crop[2]}
                          height={actor.crop[3]}
                        />
                      </clipPath>
                    </defs>
                    <image
                      href={asset("entry-characters.webp")}
                      width="1086"
                      height="1448"
                      clipPath={`url(#${sceneId}-${actor.role}-${frame})`}
                    />
                  </svg>
                ))}
              </g>
            ))}
            <image
              className="yut-entry-foreground"
              href={asset("entry-background.webp")}
              width="1448"
              height="1086"
              clipPath={`url(#${sceneId}-foreground)`}
            />
            {STICKS.map((stick, index) => (
              <g
                key={index}
                className="yut-entry-stick"
                style={
                  { "--stick-delay": `${stick.delay}ms` } as React.CSSProperties
                }
              >
                <svg
                  x={stick.x}
                  y={stick.y}
                  width={stick.size}
                  height={stick.size}
                  viewBox={`${stick.col * 627} ${stick.row * 627} 627 627`}
                >
                  <image
                    href={asset("entry-sticks.webp")}
                    width="1254"
                    height="1254"
                  />
                </svg>
              </g>
            ))}
          </svg>
        )}
      </div>
      <div className="yut-entry-window" aria-hidden="true">
        {[0, 1, 2].map((panel) => (
          <span key={panel}>
            <i />
            <i />
            <i />
          </span>
        ))}
      </div>
      {ready && (
        <button
          type="button"
          className="yut-icon-button yut-entry-motion-toggle"
          onClick={() => setPaused((value) => !value)}
          aria-label={paused ? "대기 그림 재생" : "대기 그림 멈추기"}
          title={paused ? "대기 그림 재생" : "대기 그림 멈추기"}
          aria-pressed={paused}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            {paused ? (
              <path d="M7 4v16l14-8Z" />
            ) : (
              <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
            )}
          </svg>
        </button>
      )}
    </>
  );
}
