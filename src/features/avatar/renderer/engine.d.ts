import type { AvatarLook } from "../catalog";
import type { AvatarRendererOptions, AvatarStageController } from "./types";

export function modelKeyForLook(look?: Partial<AvatarLook>): string;
export function createAvatarStage(
  container: HTMLElement,
  initialLook: AvatarLook,
  options?: AvatarRendererOptions,
): Promise<AvatarStageController>;
