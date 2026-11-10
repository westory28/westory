import React, { useId, useLayoutEffect, useRef } from "react";
import wordmarkUrl from "../../assets/brand/westory-wordmark.webp";

// Follow the transparent seams in the supplied 1024×237 artwork, including
// the slanted W/e and r/y boundaries. Adjacent clips share the same seam.
const BOUNDARIES = [
  "0,0 0,237",
  "296,0 296,34 272,82 265,91 257,107 254,118 250,125 247,190 246,191 246,209 245,210 245,237",
  "402,0 402,104 403,105 403,113 402,114 402,154 400,158 400,170 402,173 402,237",
  "513,0 513,65 511,69 511,76 515,90 515,97 516,98 517,112 518,113 518,122 519,123 519,134 522,144 522,176 523,177 524,203 525,204 525,216 526,217 526,237",
  "620,0 620,79 615,86 610,96 607,105 606,116 605,117 605,146 606,151 614,158 617,165 617,174 614,180 614,202 618,222 618,237",
  "762,0 762,108 763,109 763,120 764,121 763,136 762,137 762,237",
  "872,0 872,27 871,28 871,45 870,46 870,64 868,68 867,113 866,114 866,121 864,129 860,166 857,181 853,218 851,226 851,237",
  "1024,0 1024,237",
];
const LETTERS = BOUNDARIES.slice(0, -1).map(
  (left, index) =>
    `${left} ${BOUNDARIES[index + 1].split(" ").reverse().join(" ")}`,
);
const finishers = new WeakMap<SVGSVGElement, () => void>();

export function finishLoadingIn(container: HTMLElement) {
  for (const svg of container.querySelectorAll<SVGSVGElement>(
    ".ws-loading__logo",
  ))
    finishers.get(svg)?.();
}

/** A non-interactive visual exit; never holds up content, errors or navigation. */
function finishLogo(svg: SVGSVGElement, mountedAt: number) {
  const box = svg.getBoundingClientRect();
  if (
    performance.now() - mountedAt < 100 ||
    document.hidden ||
    box.width === 0 ||
    box.bottom <= 0 ||
    box.top >= innerHeight ||
    typeof svg.animate !== "function"
  )
    return;
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const surface = svg.closest<HTMLElement>(".ws-loading-surface");
  const local = surface?.dataset.loadingScope === "container";
  const localHost = local
    ? surface?.closest(".ws-loading-slot")?.parentElement ||
      surface?.parentElement
    : null;
  const hostBox = localHost?.getBoundingClientRect();
  const surfaceBox = surface?.getBoundingClientRect();
  const surfaceStyle = surface ? getComputedStyle(surface) : null;
  const background = surfaceStyle?.backgroundColor || "rgb(255 255 255 / 60%)";
  const backdrop = surfaceStyle?.backdropFilter || "blur(4px)";
  const fill = svg.querySelector<SVGRectElement>("[data-loading-fill]")!;
  const initialFill = getComputedStyle(fill).transform;
  const letters = svg.querySelectorAll<SVGGElement>("[data-loading-letter]");
  copy
    .querySelectorAll<SVGGElement>("[data-loading-letter]")
    .forEach((letter, i) => {
      letter.style.animation = "none";
      letter.style.transform = getComputedStyle(letters[i]).transform;
    });
  // Layout-effect cleanup runs before DOM removal. StrictMode's probe cleanup
  // and consecutive loading stages must not be mistaken for a completed wait.
  queueMicrotask(() => {
    if (svg.isConnected || document.hidden) return;
    if (
      local &&
      (!localHost?.isConnected || document.querySelector(".ws-loading-screen"))
    )
      return;
    const replacement = [
      ...document.querySelectorAll(".ws-loading__logo"),
    ].some((node) => {
      const next = node.getBoundingClientRect();
      return Math.abs(next.x - box.x) < 4 && Math.abs(next.y - box.y) < 4;
    });
    if (replacement) return;
    copy.classList.add("ws-loading__logo--exit");
    Object.assign(copy.style, {
      position: "fixed",
      left: `${box.x}px`,
      top: `${box.y}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      maxWidth: "none",
      margin: "0",
      pointerEvents: "none",
      zIndex: "20000",
    });
    const copyFill = copy.querySelector<SVGRectElement>("[data-loading-fill]")!;
    copyFill.style.animation = "none";
    copyFill.style.transform = "scaleX(1)";
    // Fade the same loading surface with the logo so it never floats over the
    // newly revealed content without its blur. This layer does not block input.
    const exitLayer = document.createElement("div");
    exitLayer.className = "ws-loading-exit-surface";
    exitLayer.setAttribute("aria-hidden", "true");
    exitLayer.dataset.loadingScope = local ? "container" : "screen";
    const restorePosition =
      localHost && getComputedStyle(localHost).position === "static";
    if (restorePosition) localHost.classList.add("ws-loading-exit-container");
    Object.assign(exitLayer.style, {
      position: local ? "absolute" : "fixed",
      left: `${(surfaceBox?.x ?? box.x) - (local ? (hostBox?.x ?? 0) + (localHost?.clientLeft ?? 0) - (localHost?.scrollLeft ?? 0) : 0)}px`,
      top: `${(surfaceBox?.y ?? box.y) - (local ? (hostBox?.y ?? 0) + (localHost?.clientTop ?? 0) - (localHost?.scrollTop ?? 0) : 0)}px`,
      width: `${surfaceBox?.width ?? box.width}px`,
      height: `${surfaceBox?.height ?? box.height}px`,
      maxWidth: "none",
      maxHeight: "none",
      margin: "0",
      padding: "0",
      border: "0",
      background,
      backdropFilter: backdrop,
      webkitBackdropFilter: backdrop,
      borderRadius: surfaceStyle?.borderRadius || "0",
      overflow: "clip",
      pointerEvents: "none",
      zIndex: local ? "50" : "20000",
    });
    const topLayer =
      !local && typeof HTMLElement.prototype.showPopover === "function";
    if (topLayer) exitLayer.setAttribute("popover", "manual");
    (localHost || document.body).append(exitLayer);
    exitLayer.append(copy);
    Object.assign(copy.style, {
      position: "absolute",
      left: `${box.x - (surfaceBox?.x ?? box.x)}px`,
      top: `${box.y - (surfaceBox?.y ?? box.y)}px`,
    });
    if (topLayer) exitLayer.showPopover();
    const color = copyFill.animate(
      [{ transform: initialFill }, { transform: "scaleX(1)" }],
      { duration: 180, easing: "ease-out" },
    );
    const fade = copy.animate(
      [{ opacity: 1 }, { opacity: 1, offset: 0.65 }, { opacity: 0 }],
      {
        duration: 240,
        fill: "forwards",
      },
    );
    const surfaceFade = exitLayer.animate(
      [{ opacity: 1 }, { opacity: 1, offset: 0.65 }, { opacity: 0 }],
      { duration: 240, fill: "forwards" },
    );
    const remove = () => {
      copy.remove();
      exitLayer.remove();
      color.cancel();
      fade.cancel();
      surfaceFade.cancel();
      if (
        restorePosition &&
        !localHost?.querySelector(":scope > .ws-loading-exit-surface")
      )
        localHost?.classList.remove("ws-loading-exit-container");
      document.removeEventListener("visibilitychange", remove);
      window.removeEventListener("pagehide", remove);
      document.removeEventListener("scroll", remove, true);
      window.removeEventListener("resize", remove);
    };
    document.addEventListener("visibilitychange", remove);
    window.addEventListener("pagehide", remove);
    if (local) {
      document.addEventListener("scroll", remove, true);
      window.addEventListener("resize", remove);
    }
    void fade.finished.then(remove, remove);
  });
}

export default function LoadingLogo() {
  const id = `loading-logo-${useId().replace(/:/g, "")}`;
  const root = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const svg = root.current;
    if (!svg) return;
    const container = svg.closest(".ws-loading")!;
    const mountedAt = performance.now();
    let visible = true;
    let pageActive = true;
    let disposed = false;
    const sync = () => {
      if (!disposed)
        container.classList.toggle(
          "ws-loading--paused",
          !visible || !pageActive || document.hidden,
        );
    };
    const hide = () => {
      pageActive = false;
      sync();
    };
    const show = () => {
      pageActive = true;
      sync();
    };
    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(([entry]) => {
            if (!entry || disposed) return;
            visible = entry.isIntersecting;
            sync();
          })
        : null;
    observer?.observe(container);
    finishers.set(svg, () => {
      if (visible && pageActive) finishLogo(svg, mountedAt);
    });
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    sync();
    return () => {
      disposed = true;
      finishers.delete(svg);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      if (visible && pageActive) finishLogo(svg, mountedAt);
    };
  }, []);

  return (
    <svg
      ref={root}
      className="ws-loading__logo"
      viewBox="0 -40 1024 293"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={`${id}-fill`}>
          <rect
            data-loading-fill=""
            className="ws-loading__fill"
            x="0"
            y="0"
            width="1024"
            height="237"
          />
        </clipPath>
        {LETTERS.map((points, index) => (
          <clipPath key={index} id={`${id}-${index}`}>
            <polygon points={points} />
          </clipPath>
        ))}
      </defs>
      {LETTERS.map((_, index) => (
        <g
          key={index}
          data-loading-letter={index}
          className="ws-loading__letter"
          style={{ animationDelay: `${index * 110}ms` }}
        >
          <g clipPath={`url(#${id}-${index})`}>
            <image
              className="ws-loading__ghost"
              href={wordmarkUrl}
              width="1024"
              height="237"
            />
            <g clipPath={`url(#${id}-fill)`}>
              <image href={wordmarkUrl} width="1024" height="237" />
            </g>
          </g>
        </g>
      ))}
    </svg>
  );
}
