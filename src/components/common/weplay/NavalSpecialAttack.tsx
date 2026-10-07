import { useEffect, useRef, useState, type CSSProperties } from "react";
import "./naval-special-attack.css";

const ART = `${import.meta.env?.BASE_URL || "/"}assets/weplay/naval/`;

// Presentation timings only. HP, score and sinking remain the battle's responsibility.
export const NAVAL_SPECIAL_TIMING = {
  introMs: 500,
  firstImpactMs: 1040,
  finalImpactMs: 1400,
  durationMs: 2500,
} as const;

const SHOTS = [
  "M 100 455 Q 370 25 730 225",
  "M 335 495 Q 690 15 770 240",
  "M 20 330 Q 305 70 720 245",
  "M 975 405 Q 995 110 795 235",
  "M 225 445 Q 445 -25 750 210",
  "M 495 480 Q 880 55 785 250",
  "M 45 215 Q 420 90 730 235",
  "M 965 285 Q 905 95 770 220",
  "M 160 485 Q 540 45 750 250",
  "M 400 460 Q 645 60 760 235",
];

const BURSTS = [
  { x: -4, y: -1, size: 17, delay: 1040, turn: -16 },
  { x: 3, y: 2, size: 19, delay: 1130, turn: 8 },
  { x: -1, y: -3, size: 22, delay: 1220, turn: -4 },
  { x: 5, y: 0, size: 20, delay: 1310, turn: 12 },
  { x: 0, y: 2, size: 27, delay: 1400, turn: -8 },
];

export interface NavalSpecialAttackProps {
  tactic?: string;
  /** Pass the arena's explicit effects preference; standalone demos follow the OS. */
  reducedMotion?: boolean;
  paused?: boolean;
}

/** Mount once for each confirmed special. This component never invents combat results. */
export default function NavalSpecialAttack({
  tactic,
  reducedMotion,
  paused = false,
}: NavalSpecialAttackProps) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [pageHidden, setPageHidden] = useState(
    () => typeof document !== "undefined" && document.hidden,
  );
  const [systemReduced, setSystemReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setSystemReduced(media.matches);
    const updateVisibility = () => setPageHidden(document.hidden);
    media.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    const element = root.current;
    const observer =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([entry]) =>
            setVisible(entry.isIntersecting),
          )
        : null;
    if (observer && element) observer.observe(element);
    else setVisible(true);
    return () => {
      observer?.disconnect();
      media.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  const still = reducedMotion ?? systemReduced;
  const label = tactic === "last-stand" ? "생즉사 사즉생" : "학익진";
  return (
    <div
      ref={root}
      className={`naval-special-attack${still ? " is-still" : ""}${paused || pageHidden || !visible ? " is-paused" : ""}`}
      style={
        {
          "--naval-special-sprites": `url("${ART}reference-sprites.webp")`,
        } as CSSProperties
      }
      data-tactic={tactic || "crane-wing"}
      aria-hidden="true"
    >
      <div className="naval-special-intro">
        <img
          className="naval-special-eyes"
          src={`${ART}yi-sunsin-cutin.webp`}
          alt=""
          draggable={false}
        />
        <img
          className="naval-special-speedlines"
          src={`${ART}impact-lines.webp`}
          alt=""
          draggable={false}
        />
        <strong>{label}</strong>
      </div>
      <svg
        className="naval-special-barrage"
        viewBox="0 0 1000 600"
        preserveAspectRatio="none"
        focusable="false"
      >
        {SHOTS.map((path, index) => (
          <g
            key={path}
            className="naval-special-shot"
            style={
              { "--attack-delay": `${480 + index * 40}ms` } as CSSProperties
            }
          >
            {["glow", "fire", "core", "head"].map((layer) => (
              <path
                key={layer}
                className={`naval-special-trace trace-${layer}`}
                d={path}
                pathLength={100}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        ))}
      </svg>
      <div className="naval-special-impacts">
        {BURSTS.map((burst) => (
          <img
            key={burst.delay}
            className="naval-special-burst"
            src={`${ART}explosion.webp`}
            alt=""
            draggable={false}
            style={
              {
                "--burst-x": `${burst.x}%`,
                "--burst-y": `${burst.y}%`,
                "--burst-size": `${burst.size}%`,
                "--burst-turn": `${burst.turn}deg`,
                "--attack-delay": `${burst.delay}ms`,
              } as CSSProperties
            }
          />
        ))}
        <span className="naval-special-water water-left" />
        <span className="naval-special-water water-right" />
        <span className="naval-special-water water-center" />
      </div>
      <span className="naval-special-static">{label} · 일제 사격</span>
    </div>
  );
}
