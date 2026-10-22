import React, { memo, useEffect, useRef, type RefObject } from "react";

const PADDING = 320;
// These paths only support exact hit testing in the original SVG. Including
// their invisible geometry makes every bitmap decode the world's borders twice.
const HIT_ONLY_PATHS =
  ".history-atlas__country:not(.is-active), .history-atlas__river-hit, .history-atlas__landform:not(.is-active):not(.is-area)";
const PAINT_PROPERTIES = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "opacity",
  "vector-effect",
  "display",
  "visibility",
];

/** Prepare a bounded bitmap while idle. CSS scaling an SVG still rerasterizes
 * its non-scaling strokes/patterns in Chromium, even with will-change set.
 * Gestures use this canvas; the original SVG retains exact settled hit paths.
 */
export default memo(function AtlasGestureSurface({
  mapRef,
  width,
  height,
  isInteracting,
  projectionKey,
  selectionKey,
}: {
  mapRef: RefObject<HTMLDivElement>;
  width: number;
  height: number;
  isInteracting: () => boolean;
  projectionKey: object;
  selectionKey: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const map = mapRef.current;
    const source = map?.querySelector<SVGSVGElement>(":scope > svg");
    const canvas = canvasRef.current;
    if (!source || !canvas) return;
    delete canvas.dataset.atlasGestureReady;
    let disposed = false;
    let revision = 0;
    let timer: ReturnType<typeof setTimeout>;
    let objectUrl: string | null = null;
    let pendingImage: HTMLImageElement | null = null;
    const cancelImage = () => {
      if (pendingImage) {
        pendingImage.onload = pendingImage.onerror = null;
        pendingImage.src = "";
        pendingImage = null;
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    };
    const prepare = () => {
      if (disposed) return;
      if (isInteracting()) {
        timer = setTimeout(prepare, 120);
        return;
      }
      const version = revision;
      const clone = source.cloneNode(true) as SVGSVGElement;
      // consolidate mutates a transform list: read the detached copy so the
      // observer cannot invalidate its own pending image capture.
      const matrix = clone
        .querySelector<SVGGElement>(".history-atlas__geography")
        ?.transform.baseVal.consolidate()?.matrix;
      if (!matrix) return;
      const camera = { scale: matrix.a, x: matrix.e, y: matrix.f };
      const originalNodes = source.querySelectorAll(
        "path, g, line, circle, rect, image",
      );
      const clonedNodes = clone.querySelectorAll(
        "path, g, line, circle, rect, image",
      );
      // Inline visible paint in short, cancellable chunks. Hit-only paths stay
      // in the original SVG; labels stay in their native-resolution HTML layer.
      let index = 0;
      const copyPaint = () => {
        if (disposed || version !== revision) return;
        if (isInteracting()) {
          timer = setTimeout(prepare, 120);
          return;
        }
        const started = performance.now();
        while (index < originalNodes.length) {
          const node = originalNodes[index];
          const target = clonedNodes[index++] as SVGElement;
          if (node.matches(HIT_ONLY_PATHS)) {
            target.remove();
          } else {
            const computed = getComputedStyle(node);
            for (const property of PAINT_PROPERTIES)
              target.style.setProperty(
                property,
                computed.getPropertyValue(property),
              );
          }
          if (performance.now() - started >= 4) {
            timer = setTimeout(copyPaint, 0);
            return;
          }
        }
        capture();
      };
      const capture = () => {
        // Land fill, the land clip and the coastline share the same long path.
        // Store its geometry once in the image while preserving each use's
        // original paint and transform (the interactive SVG stays unchanged).
        const land = clone.querySelector("path.history-atlas__land");
        const landPath = land?.getAttribute("d");
        if (land && landPath) {
          const namespace = "http://www.w3.org/2000/svg";
          const definitions = document.createElementNS(namespace, "defs");
          const shared = document.createElementNS(namespace, "path");
          shared.setAttribute("id", "atlas-snapshot-land");
          shared.setAttribute("d", landPath);
          // vector-effect is not inherited through <use>'s shadow tree.
          shared.setAttribute("vector-effect", "non-scaling-stroke");
          definitions.append(shared);
          for (const node of [
            land,
            ...clone.querySelectorAll(
              "clipPath path, .history-atlas__coastline",
            ),
          ]) {
            if (node.getAttribute("d") !== landPath) continue;
            const use = document.createElementNS(namespace, "use");
            for (const attribute of Array.from(node.attributes))
              if (attribute.name !== "d")
                use.setAttribute(attribute.name, attribute.value);
            use.setAttribute("href", "#atlas-snapshot-land");
            node.replaceWith(use);
          }
          clone.prepend(definitions);
        }
        const imageWidth = width + PADDING * 2;
        const imageHeight = height + PADDING * 2;
        clone.removeAttribute("style");
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        clone.setAttribute("width", String(imageWidth));
        clone.setAttribute("height", String(imageHeight));
        clone.setAttribute(
          "viewBox",
          `${-PADDING} ${-PADDING} ${imageWidth} ${imageHeight}`,
        );
        const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
          type: "image/svg+xml",
        });
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        const url = (objectUrl = URL.createObjectURL(blob));
        const image = (pendingImage = new Image());
        image.onload = () => {
          if (pendingImage === image) pendingImage = null;
          URL.revokeObjectURL(url);
          if (objectUrl === url) objectUrl = null;
          if (disposed || version !== revision) return;
          if (isInteracting()) {
            timer = setTimeout(prepare, 120);
            return;
          }
          const ratio = Math.min(
            window.devicePixelRatio || 1,
            1.5,
            Math.sqrt(2_000_000 / (imageWidth * imageHeight)),
          );
          canvas.width = Math.floor(imageWidth * ratio);
          canvas.height = Math.floor(imageHeight * ratio);
          const context = canvas.getContext("2d");
          if (!context) return;
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          canvas.dataset.atlasGestureCamera = JSON.stringify(camera);
          canvas.dataset.atlasGestureReady = "true";
          canvas.dataset.atlasGestureCurrent = "true";
        };
        image.onerror = () => {
          if (pendingImage === image) pendingImage = null;
          URL.revokeObjectURL(url);
          if (objectUrl === url) objectUrl = null;
        };
        image.src = url;
      };
      copyPaint();
    };
    const invalidate = () => {
      revision++;
      // Keep a usable previous image with its original camera until the new
      // one is ready. A late geography response must not force a running zoom
      // back onto the expensive SVG path. Projection/selection changes reset it.
      delete canvas.dataset.atlasGestureCurrent;
      clearTimeout(timer);
      cancelImage();
      timer = setTimeout(prepare, 160);
    };
    const observer = new MutationObserver((mutations) => {
      // The root's transient camera transform/opacity is not a content change.
      if (mutations.some((mutation) => mutation.target !== source))
        invalidate();
    });
    observer.observe(source, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    invalidate();
    return () => {
      disposed = true;
      observer.disconnect();
      clearTimeout(timer);
      cancelImage();
      delete canvas.dataset.atlasGestureReady;
      delete canvas.dataset.atlasGestureCurrent;
    };
  }, [mapRef, width, height, isInteracting, projectionKey, selectionKey]);
  return (
    <canvas
      ref={canvasRef}
      data-atlas-gesture-surface=""
      aria-hidden="true"
      style={{
        position: "absolute",
        left: -PADDING,
        top: -PADDING,
        width: width + PADDING * 2,
        height: height + PADDING * 2,
        display: "none",
        pointerEvents: "none",
        zIndex: 0,
        transformOrigin: `${PADDING}px ${PADDING}px`,
      }}
    />
  );
});
