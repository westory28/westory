import React, { memo, useEffect, useId, useRef, useState } from "react";
import { geoPath, type GeoProjection } from "d3-geo";
import type { AtlasTransform } from "../../lib/historyAtlasGeometry";
import type {
  AtlasTerrainCollection,
  AtlasTerrainFeature,
} from "../../lib/historyAtlasTerrain";
import { getAtlasMountainTexture } from "../../lib/historyAtlasTerrainTexture";

const TILE_SIZE = 256;
const PADDING = 320;
// Replacement and old generations together never exceed two million pixels.
const GENERATION_PIXEL_BUDGET = 1_000_000;
type Tile = {
  key: string;
  url: string;
  x: number;
  y: number;
  width: number;
  pixels: number;
  coreX: number;
  coreY: number;
  coreWidth: number;
};
type Generation = {
  id: number;
  projection: GeoProjection;
  terrain: AtlasTerrainCollection;
  land: string;
  scale: number;
  pixels: number;
  tiles: Map<string, Tile>;
  complete: boolean;
};
type Frame = {
  projection: GeoProjection;
  generation: number;
  tiles: Tile[];
  previous: Tile[];
  left: number;
  top: number;
  right: number;
  bottom: number;
  ready: boolean;
};

/** Reuse projected terrain tiles on pan; only newly exposed tiles encode.
 * Decorative tiles never change the independent vector selection/hit paths.
 */
export default memo(function AtlasTerrainRaster({
  terrain,
  projection,
  land,
  transform,
  width,
  height,
  isInteracting,
}: {
  terrain: AtlasTerrainCollection;
  projection: GeoProjection;
  land: string;
  transform: AtlasTransform;
  width: number;
  height: number;
  isInteracting: () => boolean;
}) {
  const id = useId();
  const rootRef = useRef<SVGGElement>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const caches = useRef<{
    generation: number;
    current: Generation | null;
    previous: Generation | null;
  }>({ generation: 0, current: null, previous: null });
  const geometryCache = useRef<{
    projection: GeoProjection;
    terrain: AtlasTerrainCollection;
    features: Map<
      AtlasTerrainFeature,
      { bounds: [[number, number], [number, number]]; shape?: Path2D }
    >;
  } | null>(null);
  const landCache = useRef<{ source: string; shape: Path2D } | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !land) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let reader: FileReader | null = null;
    const { scale, x, y } = transform;
    const left = (-PADDING - x) / scale;
    const top = (-PADDING - y) / scale;
    const right = (width + PADDING - x) / scale;
    const bottom = (height + PADDING - y) / scale;
    // Budget the extra cell at a viewport edge independently of pan alignment.
    // Pixel density and tile identity therefore remain stable during a pan.
    const maxColumns = Math.ceil((width + PADDING * 2) / TILE_SIZE) + 1;
    const maxRows = Math.ceil((height + PADDING * 2) / TILE_SIZE) + 1;
    const corePixels = Math.max(
      1,
      Math.floor(
        Math.min(
          TILE_SIZE * Math.min(window.devicePixelRatio || 1, 1.5),
          Math.sqrt(GENERATION_PIXEL_BUDGET / (maxColumns * maxRows)) - 2,
        ),
      ),
    );
    const pixels = corePixels + 2;
    const ratio = corePixels / TILE_SIZE;
    const coreWidth = TILE_SIZE / scale;
    const bleed = 1 / (ratio * scale);
    const store = caches.current;
    let generation = store.current;
    if (
      !generation ||
      generation.projection !== projection ||
      generation.terrain !== terrain ||
      generation.land !== land ||
      generation.scale !== scale ||
      generation.pixels !== pixels
    ) {
      // A rapid second zoom must not accumulate partially built generations.
      const previous = generation?.complete
        ? generation
        : store.previous || generation;
      store.previous =
        previous?.projection === projection &&
        previous.terrain === terrain &&
        previous.land === land
          ? previous
          : null;
      generation = {
        id: ++store.generation,
        projection,
        terrain,
        land,
        scale,
        pixels,
        tiles: new Map(),
        complete: false,
      };
      store.current = generation;
    }
    const current = generation;
    const required = new Map<string, { column: number; row: number }>();
    for (
      let row = Math.floor((-PADDING - y) / TILE_SIZE);
      row < Math.ceil((height + PADDING - y) / TILE_SIZE);
      row += 1
    )
      for (
        let column = Math.floor((-PADDING - x) / TILE_SIZE);
        column < Math.ceil((width + PADDING - x) / TILE_SIZE);
        column += 1
      )
        required.set(`${current.id}:${column}:${row}`, { column, row });
    // Outside-overscan tiles cannot contribute. Evict before allocating more.
    for (const key of current.tiles.keys())
      if (!required.has(key)) current.tiles.delete(key);
    if (store.previous)
      for (const [key, tile] of store.previous.tiles)
        if (
          tile.x + tile.width < left ||
          tile.x > right ||
          tile.y + tile.width < top ||
          tile.y > bottom
        )
          store.previous.tiles.delete(key);
    const publish = () => {
      if (disposed || store.current !== current) return;
      current.complete = [...required.keys()].every((key) =>
        current.tiles.has(key),
      );
      if (current.complete) store.previous = null;
      setFrame({
        projection,
        generation: current.id,
        tiles: [...current.tiles.values()],
        previous: store.previous ? [...store.previous.tiles.values()] : [],
        left,
        top,
        right,
        bottom,
        ready: current.complete,
      });
    };
    publish();
    const centerX = (width / 2 - x) / scale;
    const centerY = (height / 2 - y) / scale;
    const pending = [...required]
      .filter(([key]) => !current.tiles.has(key))
      .sort(
        ([, a], [, b]) =>
          ((a.column + 0.5) * coreWidth - centerX) ** 2 +
          ((a.row + 0.5) * coreWidth - centerY) ** 2 -
          (((b.column + 0.5) * coreWidth - centerX) ** 2 +
            ((b.row + 0.5) * coreWidth - centerY) ** 2),
      );
    if (!pending.length) return;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = pixels;
    const context = canvas.getContext("2d");
    if (!context) return;
    const colors = getComputedStyle(root);
    const color = (token: string, fallback: string) =>
      colors.getPropertyValue(`--atlas-terrain-${token}`).trim() || fallback;
    const fills = {
      mountain: color("mountain", "#cbd8ca"),
      plateau: color("plateau", "#ded7c8"),
      basin: color("plateau", "#ded7c8"),
      desert: color("desert", "#edd5a5"),
      plain: color("plain", "#e6eddf"),
    };
    const surface = colors.getPropertyValue("--ws-surface").trim() || "#ffffff";
    const grain = getAtlasMountainTexture(color("ridge", "#6b826d"));
    const ridge = grain && context.createPattern(grain.canvas, "repeat");
    const sandCanvas = document.createElement("canvas");
    sandCanvas.width = sandCanvas.height = 8;
    const sandContext = sandCanvas.getContext("2d");
    if (sandContext) {
      sandContext.fillStyle = color("sand", "#b58a50");
      sandContext.globalAlpha = 0.5;
      for (const position of [2, 6]) {
        sandContext.beginPath();
        sandContext.arc(position, position, 0.7, 0, Math.PI * 2);
        sandContext.fill();
      }
    }
    const sand = context.createPattern(sandCanvas, "repeat");
    const patternMatrix = new DOMMatrix().scale(1 / scale);
    ridge?.setTransform(patternMatrix);
    sand?.setTransform(patternMatrix);
    const path = geoPath(projection).digits(2);
    if (
      geometryCache.current?.projection !== projection ||
      geometryCache.current?.terrain !== terrain
    )
      geometryCache.current = { projection, terrain, features: new Map() };
    const features = geometryCache.current.features;
    if (landCache.current?.source !== land)
      landCache.current = { source: land, shape: new Path2D(land) };
    const landShape = landCache.current.shape;
    let tileIndex = 0;
    let featureIndex = 0;
    const draw = () => {
      if (disposed || store.current !== current) return;
      const [key, { column, row }] = pending[tileIndex];
      const coreX = column * coreWidth,
        coreY = row * coreWidth;
      const tileX = coreX - bleed,
        tileY = coreY - bleed;
      const tileWidth = coreWidth + bleed * 2;
      const started = performance.now();
      if (featureIndex === 0) {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, pixels, pixels);
        context.save();
        context.setTransform(
          ratio * scale,
          0,
          0,
          ratio * scale,
          -tileX * ratio * scale,
          -tileY * ratio * scale,
        );
        context.clip(landShape);
        // One-pixel bleed prevents image-edge seams. Composite onto the same
        // land color first so overlaps cannot double terrain's alpha. Sea
        // pixels remain transparent and the original coastline stays on top.
        context.fillStyle = surface;
        context.globalAlpha = 1;
        context.fillRect(tileX, tileY, tileWidth, tileWidth);
      }
      const interacting = isInteracting();
      while (featureIndex < terrain.features.length) {
        const feature = terrain.features[featureIndex++];
        let cached = features.get(feature);
        if (!cached) {
          cached = { bounds: path.bounds(feature) };
          features.set(feature, cached);
        }
        const [[x0, y0], [x1, y1]] = cached.bounds;
        if (
          x1 >= tileX &&
          x0 <= tileX + tileWidth &&
          y1 >= tileY &&
          y0 <= tileY + tileWidth
        ) {
          const shape = (cached.shape ||= new Path2D(path(feature) || ""));
          const kind = feature.properties.kind;
          context.fillStyle = fills[kind];
          context.globalAlpha = kind === "desert" ? 0.85 : 0.75;
          context.fill(shape);
          const pattern =
            kind === "mountain" ? ridge : kind === "desert" ? sand : null;
          if (pattern) {
            context.fillStyle = pattern;
            context.globalAlpha = kind === "mountain" ? 0.45 : 1;
            context.fill(shape);
          }
        }
        if (performance.now() - started >= (interacting ? 2 : 5)) {
          timer = setTimeout(draw, interacting ? 16 : 0);
          return;
        }
      }
      context.restore();
      canvas.toBlob((blob) => {
        if (disposed || store.current !== current || !blob) return;
        reader = new FileReader();
        reader.onload = () => {
          if (disposed || store.current !== current) return;
          current.tiles.set(key, {
            key,
            url: String(reader!.result),
            x: tileX,
            y: tileY,
            width: tileWidth,
            pixels,
            coreX,
            coreY,
            coreWidth,
          });
          reader = null;
          publish();
          tileIndex += 1;
          featureIndex = 0;
          if (tileIndex < pending.length)
            timer = setTimeout(draw, isInteracting() ? 16 : 0);
          else canvas.width = canvas.height = 1;
        };
        reader.readAsDataURL(blob);
      });
    };
    timer = setTimeout(draw, 0);
    return () => {
      disposed = true;
      clearTimeout(timer);
      if (reader?.readyState === FileReader.LOADING) reader.abort();
      reader = null;
      canvas.width = canvas.height = 1;
    };
  }, [terrain, projection, land, transform, width, height, isInteracting]);

  const active = frame?.projection === projection ? frame : null;
  const tileImage = (tile: Tile) => (
    <image
      key={tile.key}
      data-atlas-terrain-raster=""
      data-atlas-terrain-tile={tile.key}
      data-atlas-terrain-pixels={tile.pixels * tile.pixels}
      href={tile.url}
      x={tile.x}
      y={tile.y}
      width={tile.width}
      height={tile.width}
      preserveAspectRatio="none"
    />
  );
  return (
    <g
      ref={rootRef}
      className="history-atlas__terrain"
      aria-hidden="true"
      data-atlas-terrain-ready={active?.ready || false}
      data-atlas-terrain-generation={active?.generation}
    >
      {!!active?.previous.length && (
        <>
          <defs>
            <mask
              id={`${id}-replace`}
              maskUnits="userSpaceOnUse"
              x={active.left}
              y={active.top}
              width={active.right - active.left}
              height={active.bottom - active.top}
            >
              <rect
                x={active.left}
                y={active.top}
                width={active.right - active.left}
                height={active.bottom - active.top}
                fill="white"
              />
              {active.tiles.map((tile) => (
                <rect
                  key={tile.key}
                  x={tile.coreX}
                  y={tile.coreY}
                  width={tile.coreWidth}
                  height={tile.coreWidth}
                  fill="black"
                />
              ))}
            </mask>
          </defs>
          <g mask={`url(#${id}-replace)`}>{active.previous.map(tileImage)}</g>
        </>
      )}
      {active?.tiles.map(tileImage)}
    </g>
  );
});
