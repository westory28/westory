import { useCallback, useEffect, useId, useRef } from "react";
import {
  geoGraticule10,
  geoOrthographic,
  geoPath,
  type GeoPermissibleObjects,
} from "d3-geo";
import land from "../../../data/atlas/land-globe.json";
import BrandLogo from "../BrandLogo";
import { createWeplayIntroAudio } from "./weplayIntroAudio";
import "./weplay-studio-intro.css";

const DURATION = 3600;
const POINT_DEPARTURE = 1320;
const POINT_TRAVEL = 600;
const smooth = (value: number) => {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
};

/** A bounded opening in the game body; never opens a modal or starts a game. */
export default function WeplayStudioIntro({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const sound = useRef<ReturnType<typeof createWeplayIntroAudio> | null>(null);
  const callback = useRef(onComplete);
  callback.current = onComplete;
  const completed = useRef(false);
  const id = useId().replace(/:/g, "");
  const finish = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    sound.current?.dispose();
    // Only restore focus when the disappearing skip control actually held it.
    const main = root.current?.closest("main");
    const restoreFocus = root.current?.contains(document.activeElement);
    callback.current();
    if (restoreFocus)
      requestAnimationFrame(() => {
        if (main?.isConnected) {
          const target =
            main.querySelector<HTMLElement>("h1[tabindex]") || main;
          target.focus({ preventScroll: true });
        }
      });
  }, []);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const audio = createWeplayIntroAudio();
    sound.current = audio;
    const globe = element.querySelector<SVGGElement>("[data-intro-globe]")!;
    const grid = element.querySelector<SVGPathElement>("[data-intro-grid]")!;
    const coast = element.querySelector<SVGPathElement>("[data-intro-land]")!;
    const controller = element.querySelector<SVGGElement>(
      "[data-intro-controller]",
    )!;
    const orbit = element.querySelector<SVGGElement>("[data-intro-orbit]")!;
    const point =
      element.querySelector<SVGCircleElement>("[data-intro-point]")!;
    const secondary = element.querySelector<SVGCircleElement>(
      "[data-intro-secondary-button]",
    )!;
    const wordmark = element.querySelector<HTMLElement>(
      ".weplay-studio-intro__wordmarks",
    )!;
    const westory = element.querySelector<HTMLElement>(
      ".weplay-studio-intro__westory",
    )!;
    const weplay = element.querySelector<HTMLElement>(
      ".weplay-studio-intro__weplay",
    )!;
    const projection = geoOrthographic()
      .translate([180, 180])
      .scale(126)
      .clipAngle(90);
    const path = geoPath(projection);
    const graticule = geoGraticule10();
    let elapsed = 0;
    let last: number | null = null;
    let frame = 0;
    let visible = typeof IntersectionObserver === "undefined";
    const departureAngle = ((-70 + POINT_DEPARTURE / 12) * Math.PI) / 180;
    const startX = 180 + 148 * Math.cos(departureAngle);
    const startY = 180 + 148 * Math.sin(departureAngle);
    // Match the orbit's tangent velocity at departure, then settle to zero at
    // the button. The same circle remains visible throughout the handoff.
    const tangent = (148 * Math.PI * POINT_TRAVEL) / (2160 * 3);
    const controlX = startX - tangent * Math.sin(departureAngle);
    const controlY = startY + tangent * Math.cos(departureAngle);
    const draw = (time: number) => {
      const enter = smooth(time / 500);
      const change = smooth((time - 1500) / 600);
      const leave = 1 - smooth((time - 3300) / 300);
      element.dataset.phase = time < 1800 ? "westory" : "weplay";
      projection.rotate([-25 - time / 24, -20, 0]);
      coast.setAttribute("d", path(land as GeoPermissibleObjects) || "");
      grid.setAttribute("d", path(graticule) || "");
      globe.style.opacity = String(1 - change * 0.88);
      globe.setAttribute(
        "transform",
        `translate(180 180) scale(${0.92 + enter * 0.08 - change * 0.06}) translate(-180 -180)`,
      );
      controller.style.opacity = String(change);
      controller.style.strokeDashoffset = String(1 - change);
      orbit.setAttribute("transform", `rotate(${-70 + time / 12} 180 180)`);
      orbit.style.opacity = String(1 - smooth((time - POINT_DEPARTURE) / 500));
      const travel = Math.max(
        0,
        Math.min(1, (time - POINT_DEPARTURE) / POINT_TRAVEL),
      );
      if (time < POINT_DEPARTURE) {
        const angle = ((-70 + time / 12) * Math.PI) / 180;
        point.setAttribute("cx", String(180 + 148 * Math.cos(angle)));
        point.setAttribute("cy", String(180 + 148 * Math.sin(angle)));
      } else {
        const remaining = 1 - travel;
        const position = (start: number, control: number, end: number) =>
          remaining ** 3 * start +
          3 * remaining ** 2 * travel * control +
          (3 * remaining * travel ** 2 + travel ** 3) * end;
        point.setAttribute("cx", String(position(startX, controlX, 233)));
        point.setAttribute("cy", String(position(startY, controlY, 166)));
      }
      point.setAttribute("r", String(6 + 2 * smooth(travel)));
      secondary.setAttribute("r", String(8 * smooth((time - 1850) / 280)));
      const storyOut = smooth((time - 1350) / 350);
      const playIn = smooth((time - 1700) / 450);
      wordmark.style.opacity = String(enter * leave);
      westory.style.opacity = String(1 - storyOut);
      westory.style.transform = `translateY(${-storyOut * 0.22}em)`;
      weplay.style.opacity = String(playIn);
      weplay.style.transform = `translateY(${(1 - playIn) * 0.4}em)`;
      element.style.setProperty("--intro-art-opacity", String(enter * leave));
    };
    const tick = (now: number) => {
      if (completed.current) return;
      if (last !== null) elapsed += now - last;
      last = now;
      draw(Math.min(elapsed, DURATION));
      audio.sync(elapsed, visible);
      if (elapsed >= DURATION) finish();
      else frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      last = null;
      audio.sync(elapsed, visible && !document.hidden);
      if (!document.hidden && visible && !completed.current)
        frame = requestAnimationFrame(tick);
    };
    draw(0);
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            sync();
          });
    observer?.observe(element);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      audio.dispose();
      if (sound.current === audio) sound.current = null;
      observer?.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [finish]);

  return (
    <section
      ref={root}
      className="weplay-studio-intro"
      aria-label="Westory에서 Weplay로 이어지는 게임 인트로"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish();
        }
      }}
    >
      <div className="weplay-studio-intro__composition" aria-hidden="true">
        <svg
          className="weplay-studio-intro__art"
          viewBox="0 0 360 360"
          fill="none"
        >
          <defs>
            <clipPath id={`${id}-globe`}>
              <circle cx="180" cy="180" r="126" />
            </clipPath>
            <radialGradient id={`${id}-shade`} cx=".3" cy=".25" r=".8">
              <stop
                offset=".5"
                stopColor="var(--ws-primary, #2563eb)"
                stopOpacity="0"
              />
              <stop
                offset="1"
                stopColor="var(--ws-primary, #2563eb)"
                stopOpacity=".12"
              />
            </radialGradient>
          </defs>
          <g data-intro-globe>
            <circle
              className="weplay-studio-intro__ocean"
              cx="180"
              cy="180"
              r="126"
            />
            <g clipPath={`url(#${id}-globe)`}>
              <path data-intro-land className="weplay-studio-intro__land" />
              <path data-intro-grid className="weplay-studio-intro__grid" />
              <circle cx="180" cy="180" r="126" fill={`url(#${id}-shade)`} />
            </g>
          </g>
          <g data-intro-orbit>
            <path
              className="weplay-studio-intro__orbit"
              d="M180 32a148 148 0 0 1 148 148"
            />
          </g>
          <g data-intro-controller className="weplay-studio-intro__controller">
            <path
              pathLength="1"
              d="M126 128h108c22 0 32 16 37 36l16 66c5 24-16 38-34 22l-29-25h-88l-29 25c-18 16-39 2-34-22l16-66c5-20 15-36 37-36Z"
            />
            <path pathLength="1" d="M120 162v40m-20-20h40" />
            <circle data-intro-secondary-button cx="252" cy="192" r="0" />
          </g>
          <circle
            data-intro-point
            cx="328"
            cy="180"
            r="6"
            className="weplay-studio-intro__point"
          />
        </svg>
        <div className="weplay-studio-intro__wordmarks">
          <BrandLogo className="weplay-studio-intro__westory" decorative />
          <span className="weplay-studio-intro__weplay">
            <span className="weplay-studio-intro__prefix">We</span>
            <span className="weplay-studio-intro__suffix">play</span>
          </span>
        </div>
      </div>
      <button
        type="button"
        className="weplay-studio-intro__skip"
        onClick={finish}
      >
        건너뛰기 <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}
