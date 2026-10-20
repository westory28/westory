import React, { useEffect, useId, useRef } from "react";
import { geoGraticule, geoOrthographic, geoPath } from "d3-geo";
import type { MultiPolygon } from "geojson";
import land from "../../data/loadingGlobeLand.json";

const CENTER = [104, 88] as [number, number];
const RADIUS = 56;
const landGeometry = land as MultiPolygon;
const gridGeometry = geoGraticule().step([30, 30])();
const initialProjection = geoOrthographic()
  .translate(CENTER)
  .scale(RADIUS)
  .rotate([-105, -12, 0])
  .precision(0.5);
const initialPath = geoPath(initialProjection).digits(1);
const initialLand = initialPath(landGeometry) || "";
const initialGrid = initialPath(gridGeometry) || "";

/** SVG-only globe: no network, canvas, map controls or React frame renders. */
export default function LoadingGlobe() {
  const id = useId().replace(/:/g, "");
  const root = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = root.current;
    if (!svg) return;
    const landPath = svg.querySelector<SVGPathElement>("[data-land]")!;
    const gridPath = svg.querySelector<SVGPathElement>("[data-grid]")!;
    const front = svg.querySelector<SVGGElement>("[data-orbit-front]")!;
    const back = svg.querySelector<SVGGElement>("[data-orbit-back]")!;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const projection = geoOrthographic()
      .translate(CENTER)
      .scale(RADIUS)
      .precision(0.5);
    const path = geoPath(projection).digits(1);
    let visible = true,
      frame = 0,
      previous = 0,
      elapsed = 0;
    const draw = () => {
      const seconds = elapsed / 1000;
      projection.rotate([-105 + seconds * 15, -12, 0]);
      landPath.setAttribute("d", path(landGeometry) || "");
      gridPath.setAttribute("d", path(gridGeometry) || "");
      // Changing orbital plane and smooth reversal. SVG paint order lets the
      // solid globe occlude the rear passage without hiding the outer arc.
      const angle = 5.2 * Math.sin(seconds / 5.2) + 0.35;
      const tilt = ((Math.sin(seconds / 10) * 30 - 15) * Math.PI) / 180;
      const x = 86 * Math.cos(angle);
      const y = 86 * Math.sin(angle) * Math.cos((55 * Math.PI) / 180);
      const depth = Math.sin(angle);
      const tx = CENTER[0] + x * Math.cos(tilt) - y * Math.sin(tilt);
      const ty = CENTER[1] + x * Math.sin(tilt) + y * Math.cos(tilt);
      const transform = `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${(0.9 + depth * 0.12).toFixed(3)})`;
      for (const layer of [front, back])
        layer.setAttribute("transform", transform);
      front.style.display = depth >= 0 ? "" : "none";
      back.style.display = depth < 0 ? "" : "none";
    };
    const tick = (now: number) => {
      if (!previous) previous = now;
      if (now - previous >= 1000 / 30) {
        elapsed += Math.min(now - previous, 100);
        previous = now;
        draw();
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
      const running = visible && !document.hidden && !motion.matches;
      svg
        .closest(".ws-loading")
        ?.classList.toggle("ws-loading--paused", !running);
      if (motion.matches) {
        elapsed = 0;
        draw();
      }
      if (running) frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(svg);
    document.addEventListener("visibilitychange", sync);
    motion.addEventListener("change", sync);
    draw();
    sync();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      motion.removeEventListener("change", sync);
    };
  }, []);

  return (
    <svg
      ref={root}
      className="ws-loading__globe"
      viewBox="0 0 208 176"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={`${id}-sphere`}>
          <circle cx="104" cy="88" r="56" />
        </clipPath>
      </defs>
      <g
        data-orbit-back=""
        className="ws-loading__satellite ws-loading__satellite--back"
        style={{ display: "none" }}
      >
        <circle r="6" />
      </g>
      <circle className="ws-loading__ocean" cx="104" cy="88" r="56" />
      <g clipPath={`url(#${id}-sphere)`}>
        <path data-grid="" className="ws-loading__grid" d={initialGrid} />
        <path data-land="" className="ws-loading__land" d={initialLand} />
      </g>
      <circle className="ws-loading__edge" cx="104" cy="88" r="56" />
      <g
        data-orbit-front=""
        className="ws-loading__satellite"
        transform="translate(186 83)"
      >
        <circle r="6" />
      </g>
    </svg>
  );
}
