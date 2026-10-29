import {
  defaultAvatarLook,
  type AvatarLook,
  type AvatarSlot,
} from "../catalog";
import type {
  AvatarRendererOptions,
  AvatarStageController,
  AvatarApplyResult,
} from "../renderer/types";
import {
  validateManifest,
  resolveArt,
  type ArtLayer,
  type AvatarArtManifest,
  type Rect,
} from "./manifest";

const abortError = () =>
  new DOMException("Avatar preparation cancelled", "AbortError");
const frames: Partial<Record<AvatarSlot | "face", Rect>> = {
  face: [0.23, 0.02, 0.54, 0.43],
  hairStyle: [0.18, 0.0, 0.64, 0.48],
  hairTone: [0.18, 0.0, 0.64, 0.48],
  expression: [0.23, 0.02, 0.54, 0.43],
  faceShape: [0.23, 0.02, 0.54, 0.43],
  skinTone: [0.23, 0.02, 0.54, 0.43],
  top: [0.2, 0.34, 0.6, 0.42],
  bottom: [0.28, 0.53, 0.44, 0.43],
  shoes: [0.27, 0.8, 0.46, 0.2],
  accessory: [0.16, 0.0, 0.68, 0.5],
};
const fullFrame: Rect = [0, 0, 1, 1];
type Loaded = { bitmap: ImageBitmap; used: number };

/** Composes authored raster parts. No WebGL, model imports, live AI or animation loop. */
export async function createAvatarStage(
  container: HTMLElement,
  initial: Partial<AvatarLook> = {},
  options: AvatarRendererOptions & { deferPreparation?: boolean } = {},
): Promise<AvatarStageController & { captureFrame(): string }> {
  const character = initial.character === "boy" ? "boy" : "girl";
  const initialLook: AvatarLook = {
    ...defaultAvatarLook(character),
    ...initial,
    character,
  };
  const base = new URL(
    options.assetBaseUrl || `${import.meta.env.BASE_URL}avatar/v2/`,
    document.baseURI,
  );
  if (base.origin !== location.origin)
    throw new Error("아바타는 사이트 내부 원화만 사용합니다.");
  const life = new AbortController();
  const cancelLifetime = () => life.abort();
  options.signal?.addEventListener("abort", cancelLifetime, { once: true });
  if (options.signal?.aborted) life.abort();
  let canvas: HTMLCanvasElement | undefined;
  let observer: ResizeObserver | undefined;
  let disposed = false;
  let preparation = 0;
  let activeRequest: AbortController | undefined;
  let currentLook = initialLook;
  let manifest: AvatarArtManifest;
  let current: ReturnType<typeof resolveArt>;
  let frame = fullFrame;
  let zoom = 1;
  let renderedFrames = 0;
  let useCount = 0;
  let readyKey = "";
  let applied = false;
  const images = new Map<string, Loaded>();
  const tinted = new Map<string, HTMLCanvasElement>();
  const key = (look: AvatarLook) => JSON.stringify(look);
  const assertLive = () => {
    if (disposed || life.signal.aborted) throw abortError();
  };
  const imagePaths = (layers: ArtLayer[]) => [
    ...new Set(
      layers.flatMap((layer) => [
        layer.src,
        ...(layer.tint?.mask ? [layer.tint.mask] : []),
      ]),
    ),
  ];
  const clearTinted = () => {
    for (const surface of tinted.values()) {
      surface.width = 0;
      surface.height = 0;
    }
    tinted.clear();
  };
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    preparation++;
    activeRequest?.abort();
    life.abort();
    observer?.disconnect();
    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", visibility);
    options.signal?.removeEventListener("abort", cancelLifetime);
    for (const { bitmap } of images.values()) bitmap.close();
    images.clear();
    clearTinted();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
    }
  };
  async function loadImage(path: string, request: number, signal: AbortSignal) {
    const existing = images.get(path);
    if (existing) {
      existing.used = ++useCount;
      return;
    }
    const response = await fetch(new URL(path, base), {
      signal,
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("아바타 원화를 불러오지 못했습니다.");
    const blob = await response.blob();
    if (blob.size > 8 * 1024 * 1024 || !/^image\/(png|webp)$/.test(blob.type))
      throw new Error("아바타 이미지 형식이 올바르지 않습니다.");
    if (signal.aborted || request !== preparation || disposed)
      throw abortError();
    const bitmap = await createImageBitmap(blob);
    if (
      bitmap.width > 2048 ||
      bitmap.height > 2048 ||
      signal.aborted ||
      request !== preparation ||
      disposed
    ) {
      bitmap.close();
      if (signal.aborted || request !== preparation || disposed)
        throw abortError();
      throw new Error("아바타 원화 크기가 너무 큽니다.");
    }
    images.get(path)?.bitmap.close();
    images.set(path, { bitmap, used: ++useCount });
  }
  const mergeLook = (look: Partial<AvatarLook>): AvatarLook => ({
    ...currentLook,
    ...look,
  });
  async function prepareLook(
    look: Partial<AvatarLook>,
    settings: { signal?: AbortSignal } = {},
  ) {
    assertLive();
    const candidate = mergeLook(look);
    if (candidate.character !== character)
      throw new Error("아바타를 다시 불러와야 합니다.");
    const resolved = resolveArt(manifest, candidate);
    const request = ++preparation;
    activeRequest?.abort();
    const abort = new AbortController();
    activeRequest = abort;
    const cancel = () => abort.abort();
    settings.signal?.addEventListener("abort", cancel, { once: true });
    life.signal.addEventListener("abort", cancel, { once: true });
    if (settings.signal?.aborted || life.signal.aborted) abort.abort();
    const paths = imagePaths(resolved.layers);
    let next = 0;
    try {
      await Promise.all(
        Array.from({ length: Math.min(4, paths.length) }, async () => {
          while (next < paths.length) {
            if (abort.signal.aborted) throw abortError();
            await loadImage(paths[next++], request, abort.signal);
          }
        }),
      );
      assertLive();
      if (request !== preparation || abort.signal.aborted) throw abortError();
      readyKey = key(candidate);
      // Preserve the visible and prepared layers; bound old selections without
      // evicting art still used by the canvas while a later choice loads.
      const keep = new Set([...paths, ...imagePaths(current?.layers || [])]);
      for (const [path, entry] of [...images.entries()].sort(
        (a, b) => a[1].used - b[1].used,
      )) {
        if (images.size <= 64) break;
        if (!keep.has(path)) {
          entry.bitmap.close();
          images.delete(path);
        }
      }
    } catch (error) {
      abort.abort();
      throw error;
    } finally {
      settings.signal?.removeEventListener("abort", cancel);
      life.signal.removeEventListener("abort", cancel);
      if (activeRequest === abort) activeRequest = undefined;
    }
  }
  function layerImage(layer: ArtLayer): CanvasImageSource {
    const image = images.get(layer.src)!.bitmap;
    const tint = layer.tint;
    const color = tint && manifest.palettes[tint.slot][currentLook[tint.slot]];
    if (
      !tint ||
      !color ||
      color.toLowerCase() === tint.sourceColor?.toLowerCase()
    )
      return image;
    const cacheKey = JSON.stringify([layer.src, tint, color]);
    const cached = tinted.get(cacheKey);
    if (cached) return cached;
    const surface = document.createElement("canvas");
    surface.width = image.width;
    surface.height = image.height;
    const ctx = surface.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    if (tint.sourceColor || tint.mask) {
      const pixels = ctx.getImageData(0, 0, image.width, image.height);
      let mask: Uint8ClampedArray | undefined;
      if (tint.mask) {
        ctx.clearRect(0, 0, image.width, image.height);
        ctx.drawImage(
          images.get(tint.mask)!.bitmap,
          0,
          0,
          image.width,
          image.height,
        );
        mask = ctx.getImageData(0, 0, image.width, image.height).data;
      }
      const rgb = (hex: string) =>
        [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const target = rgb(color),
        source = rgb(tint.sourceColor || "#ffffff");
      const luma = (channels: number[]) =>
        channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      const reference = Math.max(1, luma(source));
      for (let i = 0; i < pixels.data.length; i += 4) {
        const weight = mask ? mask[i + 3] / 255 : 1;
        const shade =
          (pixels.data[i] * 0.2126 +
            pixels.data[i + 1] * 0.7152 +
            pixels.data[i + 2] * 0.0722) /
          reference;
        for (let c = 0; c < 3; c++)
          pixels.data[i + c] =
            pixels.data[i + c] * (1 - weight) +
            Math.min(255, target[c] * shade) * weight;
      }
      ctx.putImageData(pixels, 0, 0);
    } else {
      ctx.globalCompositeOperation = tint.mode || "multiply";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, image.width, image.height);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(image, 0, 0);
      ctx.globalCompositeOperation = "source-over";
    }
    tinted.set(cacheKey, surface);
    return surface;
  }
  function draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    view: Rect,
    magnification = 1,
  ) {
    const [artWidth, artHeight] = manifest.canvas;
    ctx.clearRect(0, 0, width, height);
    const scale =
      Math.min(width / (view[2] * artWidth), height / (view[3] * artHeight)) *
      magnification;
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(scale, scale);
    ctx.translate(
      -(view[0] + view[2] / 2) * artWidth,
      -(view[1] + view[3] / 2) * artHeight,
    );
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    for (const layer of current.layers) {
      ctx.save();
      const chain: string[] = [];
      let group = layer.group;
      while (group) {
        chain.unshift(group);
        group = current.art.groups?.[group]?.parent;
      }
      for (const groupName of chain) {
        const transform = current.pose.transforms?.[groupName];
        if (!transform) continue;
        const pivot = current.art.groups![groupName].pivot;
        ctx.translate(
          (transform.translate?.[0] || 0) * artWidth,
          (transform.translate?.[1] || 0) * artHeight,
        );
        ctx.translate(pivot[0] * artWidth, pivot[1] * artHeight);
        ctx.rotate(transform.rotation || 0);
        ctx.scale(transform.scale?.[0] ?? 1, transform.scale?.[1] ?? 1);
        ctx.translate(-pivot[0] * artWidth, -pivot[1] * artHeight);
      }
      const [x, y, w, h] = layer.rect;
      if (layer.flipX) {
        ctx.translate((2 * x + w) * artWidth, 0);
        ctx.scale(-1, 1);
      }
      if (layer.flipY) {
        ctx.translate(0, (2 * y + h) * artHeight);
        ctx.scale(1, -1);
      }
      ctx.drawImage(
        layerImage(layer),
        x * artWidth,
        y * artHeight,
        w * artWidth,
        h * artHeight,
      );
      ctx.restore();
    }
    ctx.restore();
  }
  function render() {
    if (disposed || !canvas || !current || !applied || document.hidden) return;
    draw(canvas.getContext("2d")!, canvas.width, canvas.height, frame, zoom);
    renderedFrames++;
  }
  function resize() {
    if (disposed || !canvas) return;
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      options.maxPixelRatio || 1.5,
      2,
    );
    canvas.width = Math.max(1, Math.round(container.clientWidth * ratio));
    canvas.height = Math.max(1, Math.round(container.clientHeight * ratio));
    render();
  }
  function visibility() {
    if (!document.hidden) render();
  }
  try {
    assertLive();
    const response = await fetch(new URL("manifest.json", base), {
      signal: life.signal,
      credentials: "same-origin",
    });
    if (!response.ok)
      throw new Error("아바타 원화 목록을 불러오지 못했습니다.");
    manifest = validateManifest(await response.json());
    current = resolveArt(manifest, initialLook);
    if (!options.deferPreparation) {
      await prepareLook(initialLook);
      applied = true;
    }
    assertLive();
    canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "아바타 미리보기");
    if (!canvas.getContext("2d"))
      throw new Error("아바타 미리보기를 표시할 수 없습니다.");
    container.appendChild(canvas);
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(resize);
      observer.observe(container);
    } else window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibility);
    life.signal.addEventListener("abort", destroy, { once: true });
    resize();
  } catch (error) {
    destroy();
    throw error;
  }
  const setLook = (patch: Partial<AvatarLook>): AvatarApplyResult => {
    if (disposed || life.signal.aborted)
      return { applied: false, reason: "stage-disposed" };
    const candidate = mergeLook(patch);
    if (candidate.character !== character)
      return {
        applied: false,
        requiresReload: true,
        reason: "model-change-required",
      };
    let resolved;
    try {
      resolved = resolveArt(manifest, candidate);
    } catch {
      return {
        applied: false,
        unsupported: Object.keys(patch),
        reason: "unsupported-art-selection",
      };
    }
    if (
      readyKey !== key(candidate) &&
      imagePaths(resolved.layers).some((path) => !images.has(path))
    )
      return {
        applied: false,
        requiresPreparation: true,
        reason: "art-not-prepared",
      };
    currentLook = candidate;
    current = resolved;
    applied = true;
    clearTinted();
    render();
    return { applied: true };
  };
  return {
    modelKey: `${character}:art-v2`,
    character,
    get loaded() {
      return applied && !disposed;
    },
    capabilities: Object.freeze({
      orbit: false,
      zoom: true,
      capture: true,
      wardrobe: true,
      colorways: true,
      wardrobeSlots: ["top", "bottom", "shoes", "accessory"],
      garmentShapes: true,
      appearance: true,
      skinTones: Object.keys(manifest.palettes.skinTone),
      hairTones: Object.keys(manifest.palettes.hairTone),
      hairStyles: Object.keys(current.art.slots.hairStyle),
      expressions: Object.keys(current.art.slots.expression),
      faceShapes: Object.keys(current.art.slots.faceShape),
      poses: Object.keys(current.art.poses),
      accessories: Object.keys(current.art.slots.accessory),
    }),
    get stats() {
      return {
        meshes: 0,
        triangles: 0,
        vertices: 0,
        drawCalls: current.layers.length,
        renderedTriangles: 0,
        geometries: 0,
        textures: images.size,
        pixelRatio: Math.min(
          window.devicePixelRatio || 1,
          options.maxPixelRatio || 1.5,
          2,
        ),
        renderedFrames,
      };
    },
    prepareLook,
    setLook,
    setPose: (pose) => setLook({ pose }),
    rotate() {},
    setAutoRotate() {},
    stop() {},
    play() {
      render();
    },
    animateOnce() {
      render();
    },
    zoom(direction) {
      if (!disposed) {
        zoom = Math.max(
          0.8,
          Math.min(
            2.5,
            zoom *
              (direction === "in" ||
              (typeof direction === "number" && direction > 0)
                ? 1.18
                : 1 / 1.18),
          ),
        );
        render();
      }
    },
    resetView() {
      frame = fullFrame;
      zoom = 1;
      render();
    },
    focusFace() {
      frame = frames.face!;
      zoom = 1;
      render();
    },
    focusItem(slot) {
      frame = frames[slot] || fullFrame;
      zoom = 1;
      render();
    },
    capture() {
      assertLive();
      if (!applied) throw new Error("아바타 원화를 불러오는 중입니다.");
      const output = document.createElement("canvas");
      [output.width, output.height] = manifest.canvas;
      draw(output.getContext("2d")!, output.width, output.height, fullFrame);
      const data = output.toDataURL("image/png");
      output.width = 0;
      output.height = 0;
      return data;
    },
    captureFrame() {
      assertLive();
      if (!applied || !canvas)
        throw new Error("아바타 원화를 불러오는 중입니다.");
      const output = document.createElement("canvas");
      output.width = Math.max(1, canvas.width);
      output.height = Math.max(1, canvas.height);
      draw(output.getContext("2d")!, output.width, output.height, frame, zoom);
      const data = output.toDataURL("image/png");
      output.width = 0;
      output.height = 0;
      return data;
    },
    dispose: destroy,
  };
}
