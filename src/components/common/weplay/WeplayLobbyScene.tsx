import { useEffect, useId, useRef } from "react";

const LOBBY_IMAGE = `${import.meta.env.BASE_URL}assets/weplay/naval/lobby-yi-sunsin.webp?v=sujagi-2`;
const SCENE_WIDTH = 1672;
const SCENE_HEIGHT = 941;
const PLUME_PATCH = { x: 440, y: 0, width: 780, height: 450 };
const PLUME_ROOT = { x: 460, y: 85 };
const PLUME_TIP = { x: 1110, y: 330 };
// These source-image coordinates isolate the red plume. Its root is pinned.
const PLUME_PATH =
  "M458 66 C481 31 513 14 542 43 C578 83 624 107 697 130 C775 154 817 155 902 169 C1000 184 1065 199 1109 237 C1153 264 1190 273 1178 301 C1146 324 1118 349 1100 391 C1087 426 1034 431 993 420 C949 423 916 405 885 381 C833 374 768 368 731 348 C660 347 594 307 551 260 C510 221 482 163 466 127 Z";
const PLUME_FIELD = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SCENE_WIDTH}" height="${SCENE_HEIGHT}" viewBox="0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}"><defs><linearGradient id="root" x1="${PLUME_ROOT.x}" y1="${PLUME_ROOT.y}" x2="${PLUME_TIP.x}" y2="${PLUME_TIP.y}" gradientUnits="userSpaceOnUse"><stop stop-color="white" stop-opacity="0"/><stop offset=".16" stop-color="white" stop-opacity=".2"/><stop offset=".5" stop-color="white"/><stop offset="1" stop-color="white"/></linearGradient><filter id="soft"><feGaussianBlur stdDeviation="10"/></filter></defs><path d="${PLUME_PATH}" fill="url(#root)" filter="url(#soft)"/></svg>`,
)}`;

export default function WeplayLobbyScene({
  paused = false,
}: {
  paused?: boolean;
}) {
  const filterId = `weplay-plume-${useId().replace(/:/g, "")}`;
  const sceneRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const turbulenceRef = useRef<SVGFETurbulenceElement>(null);
  const horizontalRef = useRef<SVGFEFuncRElement>(null);
  const verticalRef = useRef<SVGFEFuncGElement>(null);
  const displacementRef = useRef<SVGFEDisplacementMapElement>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    const overlay = overlayRef.current;
    if (!scene || !overlay) return;

    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    );
    let visible = typeof IntersectionObserver === "undefined";
    let frame: number | null = null;
    let lastTick: number | null = null;
    let lastPaint = 0;
    let elapsed = 0;

    const tick = (now: number) => {
      if (lastTick !== null) elapsed += Math.min(now - lastTick, 100);
      lastTick = now;
      // Only the bounded raster patch changes, at 24fps, without React renders.
      if (now - lastPaint >= 1000 / 24) {
        const phase = (elapsed / 3800) * Math.PI * 2;
        turbulenceRef.current?.setAttribute(
          "baseFrequency",
          `${0.009 + Math.sin(phase) * 0.0015} ${0.026 + Math.cos(phase) * 0.004}`,
        );
        horizontalRef.current?.setAttribute(
          "intercept",
          String(0.3 + Math.sin(phase + 0.6) * 0.08),
        );
        verticalRef.current?.setAttribute(
          "intercept",
          String(0.3 + Math.sin(phase) * 0.24),
        );
        displacementRef.current?.setAttribute(
          "scale",
          String(
            reducedMotion?.matches
              ? 50 + Math.sin(phase + 0.8) * 5
              : 80 + Math.sin(phase + 0.8) * 8,
          ),
        );
        lastPaint = now;
      }
      frame = window.requestAnimationFrame(tick);
    };

    const syncMotion = () => {
      // The requested plume remains animated with reduced motion, at a smaller
      // displacement. The explicit control can pause it in either preference.
      const running = visible && !document.hidden && !paused;
      overlay.dataset.motion = running ? "running" : "paused";
      overlay.dataset.motionIntensity = reducedMotion?.matches
        ? "gentle"
        : "full";
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
            syncMotion();
          });
    observer?.observe(scene);
    document.addEventListener("visibilitychange", syncMotion);
    reducedMotion?.addEventListener("change", syncMotion);
    syncMotion();

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", syncMotion);
      reducedMotion?.removeEventListener("change", syncMotion);
    };
  }, [paused]);

  return (
    <div ref={sceneRef} className="weplay-launch-art">
      <img
        src={LOBBY_IMAGE}
        alt="판옥선 갑판에서 일본군 함대를 바라보는 이순신 장군의 뒷모습"
        width={SCENE_WIDTH}
        height={SCENE_HEIGHT}
        decoding="async"
        draggable={false}
      />
      <svg
        ref={overlayRef}
        className="weplay-lobby-plume"
        viewBox={`0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`}
        preserveAspectRatio="xMinYMin slice"
        aria-hidden="true"
        focusable="false"
        data-motion="paused"
      >
        <defs>
          <filter
            id={filterId}
            {...PLUME_PATCH}
            filterUnits="userSpaceOnUse"
            primitiveUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              ref={turbulenceRef}
              type="fractalNoise"
              baseFrequency="0.009 0.03"
              numOctaves="2"
              seed="8"
              result="ripples"
            />
            <feComponentTransfer in="ripples" result="wind">
              <feFuncR
                ref={horizontalRef}
                type="linear"
                slope=".4"
                intercept=".3"
              />
              <feFuncG
                ref={verticalRef}
                type="linear"
                slope=".4"
                intercept=".3"
              />
            </feComponentTransfer>
            <feImage
              href={PLUME_FIELD}
              x="0"
              y="0"
              width={SCENE_WIDTH}
              height={SCENE_HEIGHT}
              result="plume"
            />
            <feComposite
              in="wind"
              in2="plume"
              operator="in"
              result="plumeWind"
            />
            <feFlood floodColor="rgb(50% 50% 50%)" result="still" />
            <feComposite
              in="plumeWind"
              in2="still"
              operator="over"
              result="localWind"
            />
            <feDisplacementMap
              ref={displacementRef}
              in="SourceGraphic"
              in2="localWind"
              scale="0"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
        <image
          href={LOBBY_IMAGE}
          width={SCENE_WIDTH}
          height={SCENE_HEIGHT}
          filter={`url(#${filterId})`}
        />
      </svg>
    </div>
  );
}
