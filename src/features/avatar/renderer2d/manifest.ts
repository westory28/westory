import type { AvatarLook } from "../catalog";

export type Pair = [number, number];
export type Rect = [number, number, number, number];
export interface ArtLayer {
  id: string;
  src: string;
  rect: Rect;
  z: number;
  group?: string;
  flipX?: boolean;
  flipY?: boolean;
  tint?: {
    slot: "skinTone" | "hairTone";
    mask?: string;
    mode?: "multiply" | "color";
    sourceColor?: string;
  };
}
export interface ArtSelection {
  layers: ArtLayer[];
  hideIds?: string[];
  hideSlots?: string[];
}
export interface ArtTransform {
  rotation?: number;
  translate?: Pair;
  scale?: Pair;
}
export interface ArtPose {
  layers?: ArtLayer[];
  hideIds?: string[];
  transforms?: Record<string, ArtTransform>;
}
export interface CharacterArt {
  base: ArtLayer[];
  groups?: Record<string, { parent?: string; pivot: Pair }>;
  slots: Record<string, Record<string, ArtLayer[] | ArtSelection>>;
  poses: Record<string, ArtPose>;
}
export interface AvatarArtManifest {
  version: 2;
  canvas: Pair;
  characters: Record<"boy" | "girl", CharacterArt>;
  palettes: Record<"skinTone" | "hairTone", Record<string, string | null>>;
}
export const DRAWN_SLOTS = [
  "top",
  "bottom",
  "shoes",
  "accessory",
  "hairStyle",
  "faceShape",
  "expression",
] as const;
const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
const dictionary = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const pair = (value: unknown): value is Pair =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((n) => typeof n === "number" && Number.isFinite(n));

export function assertAssetPath(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9_/-]+\.(?:png|webp)$/.test(value) ||
    value.startsWith("/") ||
    value.includes("..")
  )
    throw new Error("아바타 이미지 경로가 올바르지 않습니다.");
}
export function validateManifest(raw: unknown): AvatarArtManifest {
  const fail = () => {
    throw new Error("아바타 원화 정보가 올바르지 않습니다.");
  };
  if (
    !dictionary(raw) ||
    raw.version !== 2 ||
    !pair(raw.canvas) ||
    raw.canvas.some((n) => n < 128 || n > 2048) ||
    !dictionary(raw.characters) ||
    !dictionary(raw.palettes)
  )
    return fail();
  for (const paletteName of ["skinTone", "hairTone"]) {
    const palette = raw.palettes[paletteName];
    if (!dictionary(palette) || !own(palette, "original")) return fail();
    for (const color of Object.values(palette))
      if (
        color !== null &&
        (typeof color !== "string" || !/^#[a-fA-F0-9]{6}$/.test(color))
      )
        return fail();
  }
  for (const name of ["girl", "boy"]) {
    const art = raw.characters[name];
    if (
      !dictionary(art) ||
      !Array.isArray(art.base) ||
      !art.base.length ||
      !dictionary(art.slots) ||
      !dictionary(art.poses) ||
      !own(art.poses, "idle")
    )
      return fail();
    const groups = art.groups ?? {};
    if (!dictionary(groups)) return fail();
    for (const [groupName, group] of Object.entries(groups)) {
      if (
        !dictionary(group) ||
        !pair(group.pivot) ||
        group.pivot.some((n) => n < -1 || n > 2)
      )
        return fail();
      const seen = new Set([groupName]);
      let parent = group.parent;
      while (parent !== undefined) {
        if (
          typeof parent !== "string" ||
          !own(groups, parent) ||
          seen.has(parent) ||
          seen.size > 8
        )
          return fail();
        seen.add(parent);
        parent = (groups[parent] as { parent?: string }).parent;
      }
    }
    const layers = (items: unknown) => {
      if (!Array.isArray(items) || items.length > 64) return fail();
      for (const item of items) {
        if (
          !dictionary(item) ||
          typeof item.id !== "string" ||
          !item.id ||
          !Array.isArray(item.rect) ||
          item.rect.length !== 4 ||
          item.rect.some(
            (n) =>
              typeof n !== "number" || !Number.isFinite(n) || n < -1 || n > 2,
          ) ||
          item.rect[2] <= 0 ||
          item.rect[3] <= 0 ||
          typeof item.z !== "number" ||
          !Number.isFinite(item.z)
        )
          return fail();
        assertAssetPath(item.src);
        if (item.flipX !== undefined && typeof item.flipX !== "boolean")
          return fail();
        if (item.flipY !== undefined && typeof item.flipY !== "boolean")
          return fail();
        if (
          item.group !== undefined &&
          (typeof item.group !== "string" || !own(groups, item.group))
        )
          return fail();
        if (item.tint !== undefined) {
          if (
            !dictionary(item.tint) ||
            !["skinTone", "hairTone"].includes(String(item.tint.slot)) ||
            (item.tint.mode !== undefined &&
              !["multiply", "color"].includes(String(item.tint.mode)))
          )
            return fail();
          if (item.tint.mask !== undefined) assertAssetPath(item.tint.mask);
          if (
            item.tint.sourceColor !== undefined &&
            (typeof item.tint.sourceColor !== "string" ||
              !/^#[a-fA-F0-9]{6}$/.test(item.tint.sourceColor))
          )
            return fail();
        }
      }
    };
    const hides = (selection: Record<string, unknown>) => {
      for (const key of ["hideIds", "hideSlots"])
        if (
          selection[key] !== undefined &&
          (!Array.isArray(selection[key]) ||
            (selection[key] as unknown[]).some((id) => typeof id !== "string"))
        )
          return fail();
    };
    layers(art.base);
    for (const slot of DRAWN_SLOTS) {
      const values = art.slots[slot];
      if (!dictionary(values) || !Object.keys(values).length) return fail();
      for (const choice of Object.values(values)) {
        if (Array.isArray(choice)) layers(choice);
        else {
          if (!dictionary(choice)) return fail();
          layers(choice.layers);
          hides(choice);
        }
      }
    }
    for (const pose of Object.values(art.poses)) {
      if (!dictionary(pose)) return fail();
      if (pose.layers !== undefined) layers(pose.layers);
      hides(pose);
      if (pose.transforms !== undefined) {
        if (!dictionary(pose.transforms)) return fail();
        for (const [group, transform] of Object.entries(pose.transforms)) {
          if (!own(groups, group) || !dictionary(transform)) return fail();
          if (
            transform.rotation !== undefined &&
            (typeof transform.rotation !== "number" ||
              !Number.isFinite(transform.rotation) ||
              Math.abs(transform.rotation) > Math.PI * 2)
          )
            return fail();
          if (
            transform.translate !== undefined &&
            (!pair(transform.translate) ||
              transform.translate.some((n) => Math.abs(n) > 1))
          )
            return fail();
          if (
            transform.scale !== undefined &&
            (!pair(transform.scale) ||
              transform.scale.some((n) => n < 0.5 || n > 2))
          )
            return fail();
        }
      }
    }
  }
  return raw as unknown as AvatarArtManifest;
}

export function resolveArt(manifest: AvatarArtManifest, look: AvatarLook) {
  const art = manifest.characters[look.character];
  if (!art || !own(art.poses, look.pose))
    throw new Error("지원하지 않는 아바타 포즈입니다.");
  for (const slot of ["skinTone", "hairTone"] as const)
    if (!own(manifest.palettes[slot], look[slot]))
      throw new Error("지원하지 않는 아바타 색상입니다.");
  const selections = DRAWN_SLOTS.map((slot) => {
    const values = art.slots[slot];
    if (!own(values, look[slot]))
      throw new Error("지원하지 않는 아바타 아이템입니다.");
    const value = values[look[slot]];
    return { slot, choice: Array.isArray(value) ? { layers: value } : value };
  });
  const pose = art.poses[look.pose];
  const hiddenSlots = new Set(
    selections.flatMap(({ choice }) => choice.hideSlots || []),
  );
  const hiddenIds = new Set([
    ...selections.flatMap(({ choice }) => choice.hideIds || []),
    ...(pose.hideIds || []),
  ]);
  const byId = new Map<string, ArtLayer>();
  for (const layer of [
    ...art.base,
    ...selections
      .filter(({ slot }) => !hiddenSlots.has(slot))
      .flatMap(({ choice }) => choice.layers),
    ...(pose.layers || []),
  ])
    if (!hiddenIds.has(layer.id)) byId.set(layer.id, layer);
  const layers = [...byId.values()].sort((a, b) => a.z - b.z);
  if (layers.length > 64) throw new Error("아바타 이미지 수가 너무 많습니다.");
  return { art, pose, layers };
}
