import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SKIN_TONES } from "./palettes.js";

/** Generated hair is nonmetallic; cap the ORM map's unnaturally glossy lows. */
export function normalizeHairMaterial(material) {
  material.metalness = 0;
  material.roughness = 0.78;
  material.envMapIntensity = 0.65;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      "#include <roughnessmap_fragment>\nroughnessFactor = max(roughnessFactor, 0.68);",
    );
  };
  material.customProgramCacheKey = () => `${previousKey}-hair-matte-v1`;
  material.needsUpdate = true;
}

const scalpTones = new WeakMap();

function imagePixels(image) {
  if (!image?.width || !image?.height) return null;
  if (image.data)
    return { width: image.width, height: image.height, data: image.data };
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  canvas.width = canvas.height = 0;
  return { width: image.width, height: image.height, data };
}

function pixel(image, u, v, channel) {
  const x = Math.min(image.width - 1, Math.max(0, Math.floor(u * image.width)));
  const y = Math.min(
    image.height - 1,
    Math.max(0, Math.floor(v * image.height)),
  );
  return image.data[(y * image.width + x) * 4 + channel] / 255;
}

function skinSamples(source, maskImage) {
  const sourceMaterial = Array.isArray(source?.material)
    ? source.material[0]
    : source?.material;
  const map = sourceMaterial?.map;
  const uv = source?.geometry?.attributes.uv;
  const positions = source?.geometry?.attributes.position;
  if (!map?.image || !uv || !positions || !maskImage) return [];
  const mask = imagePixels(maskImage),
    albedo = imagePixels(map.image);
  if (!mask || !albedo) return [];
  const roughness = imagePixels(sourceMaterial.roughnessMap?.image);
  const metalness =
    sourceMaterial.metalnessMap?.image === sourceMaterial.roughnessMap?.image
      ? roughness
      : imagePixels(sourceMaterial.metalnessMap?.image);
  const samples = [];
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i);
    // A scalp must inherit nearby forehead/neck skin, never the iris, lip,
    // eyebrows, hair boundary, ear shadows or a shirt's baked albedo.
    if (Math.abs(x) > 0.15 || y < 0.82 || y > 1.205 || z < 0.015) continue;
    if (y > 0.93 && y < 1.09) continue;
    const u = uv.getX(i),
      v = uv.getY(i);
    if (pixel(mask, u, v, 0) < 0.86 || pixel(mask, u, v, 1) > 0.12) continue;
    const color = new THREE.Color()
      .setRGB(
        pixel(albedo, u, map.flipY ? 1 - v : v, 0),
        pixel(albedo, u, map.flipY ? 1 - v : v, 1),
        pixel(albedo, u, map.flipY ? 1 - v : v, 2),
        map.colorSpace === THREE.SRGBColorSpace
          ? THREE.SRGBColorSpace
          : THREE.LinearSRGBColorSpace,
      )
      .multiply(sourceMaterial.color);
    const luma = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
    if (luma < 0.12) continue;
    samples.push({
      x,
      y,
      z,
      color,
      roughness: roughness
        ? pixel(roughness, u, sourceMaterial.roughnessMap.flipY ? 1 - v : v, 1)
        : 1,
      metalness: metalness
        ? pixel(metalness, u, sourceMaterial.metalnessMap.flipY ? 1 - v : v, 2)
        : 1,
    });
  }
  return samples;
}

/** Matches the source face shader: original albedo or palette * linear luma/.43. */
export function setHairScalpSkinTone(mesh, id) {
  const tone = SKIN_TONES.find((entry) => entry.id === id);
  const uniforms = scalpTones.get(mesh);
  if (!tone || !uniforms) return false;
  uniforms.color.value.set(tone.color);
  uniforms.mix.value = id === "original" ? 0 : 1;
  return true;
}

/** The fused source uses hair as its rear head surface. Close that interior
 * when replacing hair so the double-sided face cannot show through the back. */
export function createHairScalp(source, maskImage) {
  const skull = new THREE.SphereGeometry(1, 32, 24);
  const skullPoints = skull.attributes.position;
  for (let i = 0; i < skullPoints.count; i++) {
    const z = skullPoints.getZ(i);
    skullPoints.setXYZ(
      i,
      skullPoints.getX(i) * 0.157,
      skullPoints.getY(i) * 0.176 + 1.052,
      z * (z > 0 ? 0.148 : 0.04) - 0.012,
    );
  }
  skull.computeVertexNormals();
  const neck = new THREE.CylinderGeometry(0.043, 0.045, 0.1, 24, 1);
  neck.translate(0, 0.87, 0.01);
  const geometry = mergeGeometries([skull, neck]);
  skull.dispose();
  neck.dispose();
  const samples = skinSamples(source, maskImage);
  const colors = [],
    orm = [];
  const points = geometry.attributes.position;
  const fallback = new THREE.Color(SKIN_TONES[0].color);
  for (let i = 0; i < points.count; i++) {
    const nearest = [];
    for (const sample of samples) {
      // The cut forehead extrapolates only its nearby surface, whereas the
      // lower neck uses chin/neck samples. This avoids a cheek-blush band.
      if (points.getY(i) > 0.95 ? sample.y < 1.09 : sample.y > 0.95) continue;
      const distance =
        (points.getX(i) - sample.x) ** 2 +
        (points.getY(i) - sample.y) ** 2 +
        (points.getZ(i) - sample.z) ** 2;
      let index = nearest.findIndex((entry) => entry.distance > distance);
      if (index < 0) index = nearest.length;
      if (index < 8) nearest.splice(index, 0, { sample, distance });
      if (nearest.length > 8) nearest.pop();
    }
    const color = new THREE.Color(0, 0, 0);
    let total = 0,
      roughness = 0,
      metalness = 0;
    for (const entry of nearest) {
      const weight = 1 / (entry.distance + 0.00002);
      total += weight;
      color.r += entry.sample.color.r * weight;
      color.g += entry.sample.color.g * weight;
      color.b += entry.sample.color.b * weight;
      roughness += entry.sample.roughness * weight;
      metalness += entry.sample.metalness * weight;
    }
    if (total) color.multiplyScalar(1 / total);
    else color.copy(fallback);
    colors.push(color.r, color.g, color.b);
    orm.push(total ? roughness / total : 0.8, total ? metalness / total : 0);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("scalpOrm", new THREE.Float32BufferAttribute(orm, 2));
  const sourceMaterial = Array.isArray(source?.material)
    ? source.material[0]
    : source?.material;
  const material = sourceMaterial?.clone() || new THREE.MeshStandardMaterial();
  // The source atlas UVs are unrelated to the sphere's UVs. Preserve its PBR
  // coefficients, but replace atlas maps with sampled vertex data.
  for (const key of [
    "map",
    "normalMap",
    "roughnessMap",
    "metalnessMap",
    "aoMap",
    "alphaMap",
    "emissiveMap",
    "bumpMap",
    "displacementMap",
  ])
    material[key] = null;
  material.color.set("#ffffff");
  material.vertexColors = true;
  material.transparent = false;
  material.opacity = 1;
  material.alphaTest = 0;
  const uniforms = {
    color: { value: new THREE.Color(SKIN_TONES[0].color) },
    mix: { value: 0 },
  };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uScalpSkinColor = uniforms.color;
    shader.uniforms.uScalpSkinMix = uniforms.mix;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec2 scalpOrm; varying vec2 vScalpOrm;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvScalpOrm = scalpOrm;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 vScalpOrm; uniform vec3 uScalpSkinColor; uniform float uScalpSkinMix;",
      )
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\nfloat scalpShade = clamp(dot(diffuseColor.rgb, vec3(0.2126,0.7152,0.0722)) / 0.43, 0.12, 1.8); diffuseColor.rgb = mix(diffuseColor.rgb, uScalpSkinColor * scalpShade, uScalpSkinMix);",
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor *= vScalpOrm.x;",
      )
      .replace(
        "#include <metalnessmap_fragment>",
        "#include <metalnessmap_fragment>\nmetalnessFactor *= vScalpOrm.y;",
      );
  };
  material.customProgramCacheKey = () => "westory-skin-sampled-scalp-v1";
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "AvatarHairScalp";
  mesh.userData.skinSampleCount = samples.length;
  scalpTones.set(mesh, uniforms);
  return mesh;
}
