import type { AvatarLook } from "../catalog";

export type AvatarRenderLook = AvatarLook;
export interface AvatarApplyResult {
  applied: boolean;
  unsupported?: string[];
  requiresReload?: boolean;
  reason?: string;
}
export interface AvatarCapabilities {
  orbit: boolean;
  zoom: boolean;
  capture: boolean;
  wardrobe: boolean;
  colorways: boolean;
  wardrobeSlots: readonly string[];
  garmentShapes: boolean;
  appearance: boolean;
  skinTones: readonly string[];
  hairTones: readonly string[];
  hairStyles: readonly string[];
  expressions: readonly string[];
  poses: readonly string[];
  faceShapes: readonly string[];
  accessories: readonly string[];
}
export interface AvatarStageController {
  readonly modelKey: string;
  readonly character: "girl" | "boy";
  readonly loaded: boolean;
  readonly capabilities: AvatarCapabilities;
  readonly stats: {
    meshes: number;
    triangles: number;
    vertices: number;
    drawCalls: number;
    renderedTriangles: number;
    geometries: number;
    textures: number;
    pixelRatio: number;
    renderedFrames: number;
  };
  setLook(look: Partial<AvatarLook>): AvatarApplyResult;
  setPose(pose: string): AvatarApplyResult;
  rotate(direction: "left" | "right" | number): void;
  zoom(direction: "in" | "out" | number): void;
  resetView(): void;
  focusFace(): void;
  setAutoRotate(value: boolean): void;
  play(durationMs?: number): void;
  animateOnce(durationMs?: number): void;
  stop(): void;
  capture(): string;
  dispose(): void;
}
export interface AvatarRendererOptions {
  signal?: AbortSignal;
  assetBaseUrl?: string;
  maxPixelRatio?: number;
}
