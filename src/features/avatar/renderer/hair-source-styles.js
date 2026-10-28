import * as THREE from "three";

// Derive a continuous long-hair sculpture from Westory's own textured base.
// The source is a welded mesh, not separate strands. Keeping its UVs and artist
// normals preserves the fine sculpted folds without the seams of added bands.
export function createSourceHairBuilder(
  source,
  maskImage,
  sharedMask,
  clothing = {},
) {
  const canvas = document.createElement("canvas");
  canvas.width = maskImage.width;
  canvas.height = maskImage.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(maskImage, 0, 0);
  let pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const clothingPixels = [clothing.colorMask, clothing.plainMask]
    .filter(Boolean)
    .map((texture) => {
      const image = texture.image;
      const surface = document.createElement("canvas");
      surface.width = image.width;
      surface.height = image.height;
      const ctx = surface.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, image.width, image.height).data;
      return { width: image.width, height: image.height, data };
    });
  const hasClothing = clothingPixels.length > 0;
  const mask = sharedMask || new THREE.Texture(maskImage);
  if (!sharedMask) {
    mask.flipY = false;
    mask.needsUpdate = true;
  }
  const tone = { value: new THREE.Color("#69412b") };
  const mix = { value: 0 };
  const material = source.material.clone();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSourceHairMask = { value: mask };
    shader.uniforms.uSourceHairTone = tone;
    shader.uniforms.uSourceHairMix = mix;
    shader.uniforms.uSourceClothingMask = { value: clothing.colorMask || mask };
    shader.uniforms.uSourcePlainMask = { value: clothing.plainMask || mask };
    shader.uniforms.uSourceHasClothing = {
      value: hasClothing ? 1 : 0,
    };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float avatarHairMask;
attribute vec3 hairBindPosition;
varying float vSourceHairMask;
varying vec3 vSourceHairBind;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vSourceHairMask = avatarHairMask;
vSourceHairBind = hairBindPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
varying float vSourceHairMask;
varying vec3 vSourceHairBind;
uniform sampler2D uSourceHairMask;
uniform vec3 uSourceHairTone;
uniform float uSourceHairMix;
uniform sampler2D uSourceClothingMask;
uniform sampler2D uSourcePlainMask;
uniform float uSourceHasClothing;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
if (vSourceHairMask <= 0.5) discard;
if (uSourceHasClothing > 0.5 && vSourceHairBind.y < 0.92 && max(texture2D(uSourceClothingMask,vMapUv).r,texture2D(uSourcePlainMask,vMapUv).r) > 0.35) discard;
if (vSourceHairBind.z > 0.05 && abs(vSourceHairBind.x) < 0.15 && vSourceHairBind.y < 1.15) {
  vec2 faceMask = texture2D(uSourceHairMask, vMapUv).rg;
  if (faceMask.g <= 0.05 || faceMask.r >= 0.25) discard;
}
float sourceHairLuma = clamp(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) / 0.16, 0.12, 1.8);
diffuseColor.rgb = mix(diffuseColor.rgb, uSourceHairTone * sourceHairLuma, uSourceHairMix);`,
    );
  };
  material.customProgramCacheKey = () => "westory-source-hair-v1";
  const uv = source.geometry.attributes.uv;
  const positions = source.geometry.attributes.position;
  const weights = new Float32Array(positions.count);
  const protectedFace = new Uint8Array(positions.count);
  const eyebrowSurface = new Uint8Array(positions.count);
  const protectedGarment = new Uint8Array(positions.count);
  const neighbors = Array.from({ length: positions.count }, () => new Set());
  const skinSurface = [];
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i);
    if (Math.abs(x) > 0.17 || y < 1.02 || y > 1.16 || z < 0.07) continue;
    const tx = Math.min(
        canvas.width - 1,
        Math.max(0, Math.floor(uv.getX(i) * canvas.width)),
      ),
      ty = Math.min(
        canvas.height - 1,
        Math.max(0, Math.floor(uv.getY(i) * canvas.height)),
      );
    const offset = (ty * canvas.width + tx) * 4;
    if (pixels[offset] > 128 && pixels[offset + 1] < 64)
      skinSurface.push({ x, y, z });
  }
  function isHair(i) {
    const px = positions.getX(i),
      py = positions.getY(i),
      pz = positions.getZ(i);
    if (
      py < 0.92 &&
      clothingPixels.some((image) => {
        const x = Math.min(
          image.width - 1,
          Math.max(0, Math.floor(uv.getX(i) * image.width)),
        );
        const y = Math.min(
          image.height - 1,
          Math.max(0, Math.floor(uv.getY(i) * image.height)),
        );
        return image.data[(y * image.width + x) * 4] > 89;
      })
    ) {
      protectedGarment[i] = 1;
      protectedFace[i] = 1;
      return false;
    }
    const face = pz > 0.08 && py < 1.08 && Math.abs(px) < 0.168;
    const brows =
      pz > 0.085 &&
      ((Math.abs(px) - 0.075) / 0.078) ** 2 + ((py - 1.09) / 0.04) ** 2 < 1.2;
    const ears =
      pz > -0.04 &&
      ((Math.abs(px) - 0.175) / 0.042) ** 2 + ((py - 0.96) / 0.06) ** 2 < 1.2;
    const neck = py < 0.89 && pz > 0 && Math.abs(px) < 0.07;
    if (
      Math.abs(px) > 0.02 &&
      Math.abs(px) < 0.15 &&
      py > 1.035 &&
      py < 1.115 &&
      pz > 0.07
    ) {
      const closest = skinSurface
        .map((point) => ({
          ...point,
          distance: (point.x - px) ** 2 + (point.y - py) ** 2,
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 6);
      const total = closest.reduce(
        (sum, p) => sum + 1 / (p.distance + 0.00001),
        0,
      );
      const depth =
        closest.reduce((sum, p) => sum + p.z / (p.distance + 0.00001), 0) /
        total;
      // Brows live on the facial surface. Fringe vertices sharing their X/Y
      // sit farther forward, so preserving by depth does not keep old bangs.
      if (closest[0]?.distance < 0.0009 && Math.abs(pz - depth) <= 0.016) {
        eyebrowSurface[i] = 1;
        protectedFace[i] = 1;
        return false;
      }
    }
    protectedFace[i] = face || brows || ears || neck ? 1 : 0;
    if (py < 0.79) return false;
    // Temple fringe is outside the brows and above the ears; the original
    // appearance mask incorrectly mixes these hair vertices with skin red.
    if (Math.abs(px) > 0.15 && py > 1.035 && pz > -0.035) return true;
    if (
      py > 1.21 ||
      (pz < -0.11 && py > 0.85) ||
      (Math.abs(px) > 0.225 && py > 0.86)
    )
      return true;
    const x = Math.max(
      0,
      Math.min(canvas.width - 1, Math.floor(uv.getX(i) * canvas.width)),
    );
    const y = Math.max(
      0,
      Math.min(canvas.height - 1, Math.floor(uv.getY(i) * canvas.height)),
    );
    const offset = (y * canvas.width + x) * 4;
    return pixels[offset + 1] > 12 && pixels[offset] < 64;
  }
  const indices = source.geometry.index.array;
  for (let i = 0; i < positions.count; i++) weights[i] = isHair(i) ? 1 : 0;
  for (let i = 0; i < indices.length; i += 3)
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++)
        if (a !== b) neighbors[indices[i + a]].add(indices[i + b]);
  for (let pass = 0; pass < 3; pass++) {
    const previous = weights.slice();
    for (let i = 0; i < weights.length; i++)
      if (!protectedFace[i] && !previous[i]) {
        const adjacent = [...neighbors[i]];
        if (
          adjacent.length &&
          adjacent.filter((index) => previous[index]).length /
            adjacent.length >=
            0.65
        )
          weights[i] = 1;
      }
  }
  // Duplicate vertices at UV seams must agree about which surface is hair.
  const seams = new Map();
  for (let i = 0; i < positions.count; i++) {
    const key = [positions.getX(i), positions.getY(i), positions.getZ(i)]
      .map((v) => Math.round(v * 1e5))
      .join(":");
    if (!seams.has(key)) seams.set(key, []);
    seams.get(key).push(i);
  }
  for (const vertices of seams.values()) {
    const value =
      vertices.some((i) => weights[i]) &&
      !vertices.some((i) => eyebrowSurface[i] || protectedGarment[i])
        ? 1
        : 0;
    for (const i of vertices) weights[i] = value;
  }
  source.geometry.setAttribute(
    "avatarHairMask",
    new THREE.BufferAttribute(weights, 1),
  );
  // Classification is complete. Do not retain three full RGBA mask copies
  // for the lifetime of a stage; shader masks reuse the existing GPU textures.
  pixels = null;
  clothingPixels.length = 0;
  canvas.width = canvas.height = 0;
  const selected = [],
    remap = new Map();
  const sourceVertices = [];
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [indices[i], indices[i + 1], indices[i + 2]];
    if (!tri.some((i) => weights[i])) continue;
    for (const vertex of tri) {
      if (!remap.has(vertex)) {
        remap.set(vertex, sourceVertices.length);
        sourceVertices.push(vertex);
      }
      selected.push(remap.get(vertex));
    }
  }
  function remodel(point) {
    const { x, y, z } = point;
    const lower = 1 - THREE.MathUtils.smoothstep(y, 0.88, 1.2);
    const fringe =
      THREE.MathUtils.smoothstep(z, 0.04, 0.16) *
      (1 - THREE.MathUtils.smoothstep(Math.abs(x), 0.12, 0.2));
    const weight = lower * (1 - fringe);
    const wave = Math.sin(lower * Math.PI * 2.4 - 0.35) * weight;
    point.set(
      x * (1 + 0.3 * wave),
      y - 0.27 * weight ** 1.12,
      z - 0.018 * weight + 0.045 * Math.sin(lower * Math.PI * 2) * weight,
    );
    return point;
  }
  return {
    build(style = "long") {
      const geometry = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(
        source.geometry.attributes,
      )) {
        if (name === "skinIndex" || name === "skinWeight") continue;
        const array = new Float32Array(
          sourceVertices.length * attribute.itemSize,
        );
        for (let i = 0; i < sourceVertices.length; i++) {
          for (let c = 0; c < attribute.itemSize; c++)
            array[i * attribute.itemSize + c] =
              attribute.array[sourceVertices[i] * attribute.itemSize + c];
        }
        geometry.setAttribute(
          name,
          new THREE.BufferAttribute(array, attribute.itemSize),
        );
      }
      geometry.setIndex(selected);
      geometry.setAttribute(
        "hairBindPosition",
        geometry.attributes.position.clone(),
      );
      const p = geometry.attributes.position,
        normals = geometry.attributes.normal;
      const point = new THREE.Vector3(),
        normal = new THREE.Vector3(),
        tangent = new THREE.Vector3(),
        bitangent = new THREE.Vector3();
      for (let i = 0; style === "long" && i < p.count; i++) {
        point.fromBufferAttribute(p, i);
        normal.fromBufferAttribute(normals, i);
        tangent
          .crossVectors(
            normal,
            Math.abs(normal.y) > 0.9
              ? new THREE.Vector3(1, 0, 0)
              : new THREE.Vector3(0, 1, 0),
          )
          .normalize();
        bitangent.crossVectors(normal, tangent).normalize();
        const mapped = remodel(point.clone());
        tangent
          .copy(remodel(point.clone().addScaledVector(tangent, 0.0001)))
          .sub(mapped);
        bitangent
          .copy(remodel(point.clone().addScaledVector(bitangent, 0.0001)))
          .sub(mapped);
        normal.crossVectors(tangent, bitangent).normalize();
        p.setXYZ(i, mapped.x, mapped.y, mapped.z);
        normals.setXYZ(i, normal.x, normal.y, normal.z);
      }
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `AvatarHair:source-${style}`;
      return mesh;
    },
    setTone(id, color) {
      tone.value.set(color);
      mix.value = id === "original" ? 0 : 1;
    },
    dispose() {
      material.dispose();
      if (!sharedMask) mask.dispose();
    },
  };
}
