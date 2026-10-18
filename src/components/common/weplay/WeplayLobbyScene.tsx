import { useEffect, useId, useRef, useState } from "react";

const ASSET_ROOT = `${import.meta.env.BASE_URL}assets/weplay/naval/`;
const LOBBY_IMAGE = `${ASSET_ROOT}lobby-yi-sunsin.webp?v=sujagi-2`;
const CLEAN_PLATE = `${ASSET_ROOT}lobby-plume-clean-plate.webp`;
const FRAMES = Array.from(
  { length: 5 },
  (_, i) => `${ASSET_ROOT}plume-frame-${i + 1}.webp`,
);
const PLUME = { x: 384, y: -10, width: 793, height: 397 };
// Only the former hair footprint is replaced. Admiral, flags and fleet retain
// their original pixels; this plate never participates in the animation.
const CLEAN_PATH =
  "M444 66 C453 47 457 27 491 15 L630 15 L1205 130 L1225 440 L1035 445 L870 415 L760 380 L650 360 L560 305 L505 230 L464 143 Z";

export default function WeplayLobbyScene({
  paused = false,
}: {
  paused?: boolean;
}) {
  const id = `weplay-plume-${useId().replace(/:/g, "")}`;
  const sceneRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const framesRef = useRef<(SVGImageElement | null)[]>([]);
  const phaseRef = useRef(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    // A slow or failed sprite request leaves the complete original still visible.
    Promise.all(
      [CLEAN_PLATE, ...FRAMES].map((src) => {
        const image = new Image();
        image.src = src;
        return image.decode();
      }),
    )
      .then(() => {
        if (alive) setReady(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const overlay = overlayRef.current;
    if (!scene || !overlay || !ready) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = typeof IntersectionObserver === "undefined";
    let frame: number | null = null;
    let lastTick: number | null = null;
    const paint = () => {
      const current = Math.floor(phaseRef.current) % FRAMES.length;
      // One complete pose at a time: no warped scenery or translucent double hair.
      framesRef.current.forEach((element, index) => {
        element?.setAttribute("opacity", String(index === current ? 1 : 0));
      });
      overlay.dataset.frame = String(current);
    };
    const tick = (now: number) => {
      if (lastTick !== null)
        phaseRef.current =
          (phaseRef.current +
            Math.min(now - lastTick, 80) / (reduced.matches ? 240 : 180)) %
          FRAMES.length;
      lastTick = now;
      paint();
      frame = window.requestAnimationFrame(tick);
    };
    const sync = () => {
      const running = visible && !document.hidden && !paused;
      overlay.dataset.motion = running ? "running" : "paused";
      overlay.dataset.motionIntensity = reduced.matches ? "gentle" : "full";
      if (running && frame === null) {
        lastTick = null;
        frame = window.requestAnimationFrame(tick);
      } else if (!running && frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
        lastTick = null;
      }
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            sync();
          });
    observer?.observe(scene);
    document.addEventListener("visibilitychange", sync);
    reduced.addEventListener("change", sync);
    paint();
    sync();
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      reduced.removeEventListener("change", sync);
    };
  }, [paused, ready]);

  return (
    <div ref={sceneRef} className="weplay-launch-art">
      <img
        src={LOBBY_IMAGE}
        alt="판옥선 갑판에서 일본군 함대를 바라보는 이순신 장군의 뒷모습"
        width={1672}
        height={941}
        decoding="async"
        draggable={false}
      />
      <svg
        ref={overlayRef}
        className="weplay-lobby-plume"
        viewBox="0 0 1672 941"
        preserveAspectRatio="xMinYMin slice"
        aria-hidden="true"
        focusable="false"
        data-motion="paused"
        data-frame="0"
        data-ready={ready}
        style={{ visibility: ready ? "visible" : "hidden" }}
      >
        <defs>
          <clipPath id={`${id}-plate`}>
            <path d={CLEAN_PATH} />
          </clipPath>
          <linearGradient
            id={`${id}-hair-fade`}
            x1="499"
            x2="574"
            y1="0"
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="black" />
            <stop offset="1" stopColor="white" />
          </linearGradient>
          <mask
            id={`${id}-root`}
            maskUnits="userSpaceOnUse"
            x="384"
            y="0"
            width="793"
            height="397"
          >
            <rect x="384" y="0" width="190" height="397" fill="white" />
          </mask>
          <mask
            id={`${id}-hair`}
            maskUnits="userSpaceOnUse"
            x="384"
            y="0"
            width="793"
            height="397"
          >
            <rect
              x="384"
              y="0"
              width="793"
              height="397"
              fill={`url(#${id}-hair-fade)`}
            />
          </mask>
        </defs>
        <image
          className="weplay-plume-clean-plate"
          href={CLEAN_PLATE}
          width="1672"
          height="941"
          clipPath={`url(#${id}-plate)`}
        />
        <image
          className="weplay-plume-root"
          href={FRAMES[0]}
          {...PLUME}
          mask={`url(#${id}-root)`}
        />
        <g mask={`url(#${id}-hair)`}>
          {FRAMES.map((src, index) => (
            <image
              key={src}
              ref={(element) => {
                framesRef.current[index] = element;
              }}
              className="weplay-plume-frame"
              href={src}
              {...PLUME}
              opacity={index === 0 ? 1 : 0}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
