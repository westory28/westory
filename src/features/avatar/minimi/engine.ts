import {
  defaultAvatarLook,
  type AvatarLook,
  type AvatarSlot,
} from "../catalog";
import type {
  AvatarApplyResult,
  AvatarRendererOptions,
  AvatarStageController,
} from "../renderer/types";
import { drawMinimi, MINIMI_HEIGHT, MINIMI_VALUES, MINIMI_WIDTH } from "./draw";

export {
  drawMinimi,
  MINIMI_ANCHORS,
  MINIMI_HEIGHT,
  MINIMI_VALUES,
  MINIMI_WIDTH,
} from "./draw";

const abortError = () =>
  new DOMException("Avatar preparation cancelled", "AbortError");
const unsupportedKeys = (look: Partial<AvatarLook>): string[] =>
  Object.entries(look)
    .filter(([key, value]) => {
      const values = MINIMI_VALUES[key as AvatarSlot] as
        | readonly string[]
        | undefined;
      return !values || !values.includes(value);
    })
    .map(([key]) => key);

/** A local, deterministic raster renderer. Nothing is fetched or persistently animated. */
export async function createAvatarStage(
  container: HTMLElement,
  initial: Partial<AvatarLook> = {},
  options: AvatarRendererOptions & { deferPreparation?: boolean } = {},
): Promise<AvatarStageController & { captureFrame(): string }> {
  if (options.signal?.aborted) throw abortError();
  const character = initial.character === "boy" ? "boy" : "girl";
  let look: AvatarLook = {
    ...defaultAvatarLook(character),
    ...initial,
    character,
  };
  const invalid = unsupportedKeys(look);
  if (invalid.length)
    throw new Error(`지원하지 않는 미니미 항목: ${invalid.join(", ")}`);
  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "선택한 미니미 모습");
  canvas.style.cssText =
    "display:block;width:100%;height:100%;image-rendering:pixelated;";
  container.append(canvas);
  const ctx = canvas.getContext("2d", { alpha: true });
  const sprite = document.createElement("canvas");
  sprite.width = MINIMI_WIDTH;
  sprite.height = MINIMI_HEIGHT;
  const spriteContext = sprite.getContext("2d", { alpha: true });
  if (!ctx || !spriteContext) {
    canvas.remove();
    throw new Error("미니미를 그릴 수 없습니다.");
  }
  let disposed = false,
    frames = 0,
    zoom = 1,
    face = false,
    blink = false;
  let timers: ReturnType<typeof setTimeout>[] = [];
  const render = () => {
    if (disposed) return;
    const bounds = container.getBoundingClientRect();
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      options.maxPixelRatio || 2,
    );
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    drawMinimi(spriteContext, look, { blink });
    const sourceHeight = face ? 57 : MINIMI_HEIGHT;
    const sourceWidth = face ? 64 : MINIMI_WIDTH;
    const sourceX = face ? 8 : 0;
    const available =
      Math.min(width / sourceWidth, height / sourceHeight) * zoom;
    // Whole-number physical pixel enlargement keeps every pixel uniformly sized.
    const scale =
      available >= 1 ? Math.max(1, Math.floor(available)) : available;
    const targetWidth = Math.round(sourceWidth * scale),
      targetHeight = Math.round(sourceHeight * scale);
    ctx.drawImage(
      sprite,
      sourceX,
      0,
      sourceWidth,
      sourceHeight,
      Math.floor((width - targetWidth) / 2),
      Math.floor((height - targetHeight) / 2),
      targetWidth,
      targetHeight,
    );
    frames++;
  };
  const stop = () => {
    timers.forEach(clearTimeout);
    timers = [];
    if (blink) {
      blink = false;
      render();
    }
  };
  const capture = () => {
    if (disposed) throw new Error("종료된 미니미입니다.");
    const output = document.createElement("canvas");
    output.width = 384;
    output.height = 512;
    const outputContext = output.getContext("2d", { alpha: true });
    if (!outputContext) throw new Error("미니미 이미지를 저장할 수 없습니다.");
    drawMinimi(spriteContext, look);
    outputContext.imageSmoothingEnabled = false;
    outputContext.drawImage(
      sprite,
      (384 - MINIMI_WIDTH * 4) / 2,
      (512 - MINIMI_HEIGHT * 4) / 2,
      MINIMI_WIDTH * 4,
      MINIMI_HEIGHT * 4,
    );
    return output.toDataURL("image/webp", 1);
  };
  const setLook = (candidate: Partial<AvatarLook>): AvatarApplyResult => {
    if (disposed) return { applied: false, reason: "disposed" };
    if (candidate.character && candidate.character !== character)
      return { applied: false, requiresReload: true };
    const unsupported = unsupportedKeys(candidate);
    if (unsupported.length) return { applied: false, unsupported };
    look = { ...look, ...candidate };
    stop();
    render();
    return { applied: true };
  };
  const animateOnce = (durationMs = 1200) => {
    stop();
    if (
      disposed ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const duration = Math.max(150, Math.min(5000, durationMs));
    timers.push(
      setTimeout(
        () => {
          blink = true;
          render();
        },
        Math.min(300, duration / 3),
      ),
    );
    timers.push(
      setTimeout(
        () => {
          blink = false;
          render();
          timers = [];
        },
        Math.min(460, duration),
      ),
    );
  };
  const observer = new ResizeObserver(render);
  observer.observe(container);
  const dispose = () => {
    if (disposed) return;
    stop();
    disposed = true;
    observer.disconnect();
    options.signal?.removeEventListener("abort", dispose);
    canvas.remove();
    sprite.width = sprite.height = 1;
  };
  options.signal?.addEventListener("abort", dispose, { once: true });
  render();
  return {
    modelKey: "westory-minimi-v2",
    character,
    get loaded() {
      return !disposed;
    },
    capabilities: {
      orbit: false,
      zoom: true,
      capture: true,
      wardrobe: true,
      colorways: true,
      wardrobeSlots: ["top", "bottom", "shoes", "accessory"],
      garmentShapes: true,
      appearance: true,
      skinTones: MINIMI_VALUES.skinTone,
      hairTones: MINIMI_VALUES.hairTone,
      hairStyles: MINIMI_VALUES.hairStyle,
      expressions: MINIMI_VALUES.expression,
      poses: MINIMI_VALUES.pose,
      faceShapes: MINIMI_VALUES.faceShape,
      accessories: MINIMI_VALUES.accessory,
    },
    get stats() {
      return {
        meshes: 0,
        triangles: 0,
        vertices: 0,
        drawCalls: 1,
        renderedTriangles: 0,
        geometries: 0,
        textures: 0,
        pixelRatio: 1,
        renderedFrames: frames,
      };
    },
    setLook,
    async prepareLook(candidate, preparation = {}) {
      if (disposed || options.signal?.aborted || preparation.signal?.aborted)
        throw abortError();
      const unsupported = unsupportedKeys(candidate);
      if (unsupported.length)
        throw new Error(`지원하지 않는 미니미 항목: ${unsupported.join(", ")}`);
    },
    setPose: (pose) => setLook({ pose }),
    rotate: () => {},
    zoom(direction) {
      zoom = Math.max(
        0.75,
        Math.min(
          2,
          zoom +
            (direction === "in"
              ? 0.25
              : direction === "out"
                ? -0.25
                : direction),
        ),
      );
      render();
    },
    resetView() {
      zoom = 1;
      face = false;
      render();
    },
    focusFace() {
      face = true;
      zoom = 1;
      render();
    },
    focusItem(slot) {
      face = [
        "hairStyle",
        "hairTone",
        "expression",
        "faceShape",
        "skinTone",
        "accessory",
      ].includes(slot);
      zoom = 1;
      render();
    },
    setAutoRotate() {},
    play: animateOnce,
    animateOnce,
    stop,
    capture,
    captureFrame: capture,
    dispose,
  };
}
