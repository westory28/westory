import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { SKIN_TONES, HAIR_TONES } from "./palettes.js";
import { createPoseController } from "./pose-controller.js";
import { createExpressionController } from "./expression-controller.js";
import {
  createFaceShapeController,
  createAccessoryController,
} from "./shape-accessories.js";
import {
  createGarmentController,
  GARMENT_TOPS,
  GARMENT_BOTTOMS,
  GARMENT_ACCESSORIES,
} from "./garments.js";

const PI = Math.PI;
function makeMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.48,
    metalness: 0,
    ...options,
  });
}
function mesh(parent, geometry, material, position = [0, 0, 0], scale) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(...position);
  if (scale) object.scale.set(...scale);
  parent.add(object);
  return object;
}
function disposeTexture(texture) {
  texture.dispose();
  texture.image?.close?.();
}
function disposeTree(root) {
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set(),
    skeletons = new Set();
  root.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    if (node.skeleton) skeletons.add(node.skeleton);
    (Array.isArray(node.material) ? node.material : [node.material])
      .filter(Boolean)
      .forEach((material) => materials.add(material));
  });
  materials.forEach((material) => {
    for (const value of Object.values(material))
      if (value?.isTexture) textures.add(value);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  const bitmaps = new Set();
  textures.forEach((texture) => {
    texture.dispose();
    if (texture.image?.close) bitmaps.add(texture.image);
  });
  bitmaps.forEach((bitmap) => bitmap.close());
  skeletons.forEach((skeleton) => skeleton.dispose());
}

const REFERENCE_LOOK = Object.freeze({
  top: "plain-top",
  bottom: "plain-bottom",
  shoes: "plain-shoes",
  accessory: "none",
});
const COLORWAYS = Object.freeze({
  top: {
    "plain-top": null,
    "jacket-sunshine": null,
    "jacket-lavender": "#b2a0d8",
    "jacket-navy": "#28446c",
    "jacket-mint": "#8ac8b2",
    "jacket-rose": "#df9baf",
    "jacket-cream": "#eee0c8",
  },
  bottom: {
    "plain-bottom": null,
    "pleated-lilac": null,
    "pleated-navy": "#3d4c6e",
    "pleated-cream": "#e9dec7",
    "pleated-mint": "#95bdab",
  },
  shoes: {
    "plain-shoes": null,
    "sneakers-pink": null,
    "sneakers-white": "#ece9e1",
    "sneakers-blue": "#8cacc8",
    "sneakers-lavender": "#b2a0d8",
  },
});

export function modelKeyForLook(look = {}) {
  return `${look.character === "boy" ? "boy" : "girl"}:base`;
}

function createHairController(root, maskImage, character, forwardAxis = "x") {
  const canvas = document.createElement("canvas");
  canvas.width = maskImage.width;
  canvas.height = maskImage.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(maskImage, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const records = [];
  root.traverse((object) => {
    if (!object.isMesh || !object.geometry.attributes.uv) return;
    const positions = object.geometry.attributes.position,
      uv = object.geometry.attributes.uv;
    object.geometry.computeBoundingBox();
    const bounds = object.geometry.boundingBox;
    const norm = 0.98 / (bounds.max.y - bounds.min.y);
    const minY = bounds.min.y;
    const centerFront = (bounds.min[forwardAxis] + bounds.max[forwardAxis]) / 2;
    const sideAxis = forwardAxis === "x" ? "z" : "x";
    const centerSide = (bounds.min[sideAxis] + bounds.max[sideAxis]) / 2;
    const original = positions.array.slice(),
      weights = new Float32Array(positions.count);
    const seams = new Map();
    for (let i = 0; i < positions.count; i++) {
      const x = Math.min(
        canvas.width - 1,
        Math.max(0, Math.round(uv.getX(i) * (canvas.width - 1))),
      );
      const y = Math.min(
        canvas.height - 1,
        Math.max(0, Math.round(uv.getY(i) * (canvas.height - 1))),
      );
      weights[i] = pixels[(y * canvas.width + x) * 4 + 1] / 255;
      const canonicalY = (positions.getY(i) - minY) * norm - 0.49;
      const canonicalFront =
        ((forwardAxis === "x" ? positions.getX(i) : positions.getZ(i)) -
          centerFront) *
        norm;
      const canonicalSide =
        ((sideAxis === "x" ? positions.getX(i) : positions.getZ(i)) -
          centerSide) *
        norm;
      // Eyebrow dye may share the hair channel, but styling must never move
      // brows, eyelids, or the central face with the actual hairstyle.
      if (
        canonicalFront > 0.055 &&
        canonicalY < 0.327 &&
        Math.abs(canonicalSide) < 0.108
      )
        weights[i] = 0;
      const browDistance =
        ((Math.abs(canonicalSide) - 0.057) / 0.058) ** 2 +
        ((canonicalY - 0.331) / 0.028) ** 2;
      if (canonicalFront > 0.065 && browDistance < 1.25) weights[i] = 0;
      // Ears and the side of the cheek can have brown shadow texels. Keep a
      // generous anatomical guard independent of the recolor-mask boundary.
      const earDistance =
        ((Math.abs(canonicalSide) - 0.132) / 0.036) ** 2 +
        ((canonicalY - 0.235) / 0.045) ** 2;
      if (canonicalFront > -0.045 && earDistance < 1.25) weights[i] = 0;
      if (
        canonicalFront > -0.03 &&
        canonicalY < 0.2 &&
        Math.abs(canonicalSide) < 0.09
      )
        weights[i] = 0;
      if (pixels[(y * canvas.width + x) * 4] > 32) weights[i] = 0;
      const key = `${Math.round(positions.getX(i) * 100000)},${Math.round(positions.getY(i) * 100000)},${Math.round(positions.getZ(i) * 100000)}`;
      if (!seams.has(key)) seams.set(key, []);
      seams.get(key).push(i);
    }
    // Duplicate UV seam vertices share the same spatial weight, preventing
    // tiny cracks when neighboring texture islands have different padding.
    for (const indices of seams.values()) {
      const max = Math.max(...indices.map((index) => weights[index]));
      for (const index of indices) weights[index] = max;
    }
    const selected = [];
    for (let i = 0; i < weights.length; i++)
      if (weights[i] > 0.05) selected.push(i);
    if (selected.length)
      records.push({
        object,
        positions,
        original,
        weights,
        selected,
        norm,
        minY,
        centerFront,
        centerSide,
      });
  });
  const base = character === "boy" ? "curtain" : "bob";
  const supported = records.length
    ? [base, "volume", "wave", character === "boy" ? "crop" : "long"]
    : [base];
  let current = base;
  function setStyle(style) {
    if (!supported.includes(style)) return false;
    if (style === current) return true;
    for (const {
      object,
      positions,
      original,
      weights,
      selected,
      norm,
      minY,
      centerFront,
      centerSide,
    } of records) {
      for (const i of selected) {
        const rawX = original[i * 3],
          rawY = original[i * 3 + 1],
          rawZ = original[i * 3 + 2];
        const x = ((forwardAxis === "x" ? rawX : rawZ) - centerFront) * norm;
        const y = (rawY - minY) * norm - 0.49;
        const z = ((forwardAxis === "x" ? rawZ : rawX) - centerSide) * norm;
        const weight = THREE.MathUtils.smoothstep(weights[i], 0.15, 0.9);
        const lower = 1 - THREE.MathUtils.smoothstep(y, 0.17, 0.36);
        let dx = 0,
          dy = 0,
          dz = 0;
        if (style === "volume") {
          dx = x * 0.08;
          dz = z * 0.09;
          dy = (y - 0.3) * 0.06;
        } else if (style === "wave") {
          const strength = 0.4 + 0.6 * lower;
          dz =
            Math.sin((y - 0.1) * 39 + (z < 0 ? 0.7 : -0.7)) * 0.008 * strength;
          dx = Math.cos(y * 32 + z * 8) * 0.006 * strength;
        } else if (style === "long") {
          const back = 1 - THREE.MathUtils.smoothstep(x, -0.05, 0.025);
          dy = -0.05 * lower * lower * back;
          dz = z * 0.02 * lower * back;
          dx = -0.01 * lower * back;
        } else if (style === "crop") {
          dx = -x * 0.05;
          dz = -z * 0.06;
          dy = (0.32 - y) * 0.14;
        }
        positions.setXYZ(
          i,
          rawX + ((forwardAxis === "x" ? dx : dz) * weight) / norm,
          rawY + (dy * weight) / norm,
          rawZ + ((forwardAxis === "x" ? dz : dx) * weight) / norm,
        );
      }
      positions.needsUpdate = true;
      // Preserve the source's artist normals across UV islands. Recomputing
      // per-island normals creates visible hard edges on the dense sculpt.
      object.geometry.computeBoundingSphere();
    }
    current = style;
    return true;
  }
  return {
    supported: Object.freeze(supported),
    setStyle,
    get current() {
      return current;
    },
    dispose() {
      records.length = 0;
    },
  };
}

function installColorwayShader(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vAvatarBindPosition;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvAvatarBindPosition = position;",
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
uniform vec3 uAvatarTopColor; uniform float uAvatarTopMix;
uniform vec3 uAvatarBottomColor; uniform float uAvatarBottomMix;
uniform vec3 uAvatarShoesColor; uniform float uAvatarShoesMix;
uniform vec3 uAvatarAccessoryColor; uniform float uAvatarAccessoryMix;
uniform float uAvatarBoy;
uniform sampler2D uAvatarColorMask;
uniform sampler2D uAvatarAppearanceMask;
uniform sampler2D uAvatarPlainMask;
uniform float uAvatarPlainTop; uniform float uAvatarPlainBottom; uniform float uAvatarPlainShoes;
uniform vec3 uAvatarPlainTopColor; uniform vec3 uAvatarPlainBottomColor; uniform vec3 uAvatarPlainShoesColor;
uniform vec3 uAvatarSkinColor; uniform float uAvatarSkinMix;
uniform vec3 uAvatarHairColor; uniform float uAvatarHairMix;
uniform float uAvatarReplaceTop; uniform float uAvatarReplaceBottom;
varying vec3 vAvatarBindPosition;
bool avatarSourceCuff(vec3 wrist, vec3 elbow) {
  vec3 delta = vAvatarBindPosition - wrist;
  float along = dot(delta, normalize(wrist - elbow));
  return along < 0.008 && along > -0.065 && length(delta) < 0.07;
}
vec3 avatarRecolor(vec3 original, vec3 color, float referenceLuma) {
  float shade = clamp(dot(original, vec3(0.2126, 0.7152, 0.0722)) / referenceLuma, 0.12, 1.80);
  return color * shade;
}
`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
vec3 avatarOriginal = diffuseColor.rgb;
vec4 avatarMasks = texture2D(uAvatarColorMask, vMapUv);
float topMask = avatarMasks.r;
float bottomMask = avatarMasks.g;
float shoesMask = avatarMasks.b;
float hatMask = 1.0 - avatarMasks.a;
diffuseColor.rgb = mix(diffuseColor.rgb, avatarRecolor(avatarOriginal, uAvatarTopColor, 0.53), topMask * uAvatarTopMix);
diffuseColor.rgb = mix(diffuseColor.rgb, avatarRecolor(avatarOriginal, uAvatarBottomColor, mix(0.20, 0.055, uAvatarBoy)), bottomMask * uAvatarBottomMix);
diffuseColor.rgb = mix(diffuseColor.rgb, avatarRecolor(avatarOriginal, uAvatarShoesColor, 0.39), shoesMask * uAvatarShoesMix);
diffuseColor.rgb = mix(diffuseColor.rgb, avatarRecolor(avatarOriginal, uAvatarAccessoryColor, 0.40), hatMask * uAvatarAccessoryMix);
vec2 appearanceMasks = texture2D(uAvatarAppearanceMask, vMapUv).rg;
vec3 plainMasks = texture2D(uAvatarPlainMask, vMapUv).rgb;
float authoredGarment = max(topMask, max(bottomMask, shoesMask));
plainMasks *= 1.0 - max(appearanceMasks.r, appearanceMasks.g) * (1.0 - authoredGarment);
// Replace only authored clothing fragments. The source head/hair/hands and
// existing footwear retain their original rig, texture and appearance controls.
if (uAvatarReplaceTop > 0.5 && max(topMask, plainMasks.r) > 0.35) discard;
// The source's inner shirt collar and wrist cuffs extend beyond its jacket
// recolor mask. Remove those non-skin/non-hair texels as well.
if (uAvatarReplaceTop > 0.5 && vAvatarBindPosition.y > 0.48 && vAvatarBindPosition.y < 0.90
  && (vAvatarBindPosition.y > 0.72 || abs(vAvatarBindPosition.x) > 0.19)
  && max(appearanceMasks.r, appearanceMasks.g) < 0.35) discard;
if (uAvatarReplaceTop > 0.5 && (
  avatarSourceCuff(mix(vec3(0.2945,0.5939,0.0265),vec3(0.2608,0.5546,0.0139),uAvatarBoy), mix(vec3(0.1963,0.7005,0.012),vec3(0.1963,0.678,-0.0177),uAvatarBoy)) ||
  avatarSourceCuff(mix(vec3(-0.3029,0.5911,0.021),vec3(-0.2692,0.549,0.0107),uAvatarBoy), mix(vec3(-0.2075,0.7005,0.0106),vec3(-0.2103,0.6752,-0.0241),uAvatarBoy))
)) discard;
if (uAvatarReplaceTop > 0.5 && vAvatarBindPosition.y > 0.82 && vAvatarBindPosition.y < 0.891
  && abs(vAvatarBindPosition.x) < 0.11 && vAvatarBindPosition.z < 0.13 && vAvatarBindPosition.z > -0.08) discard;
if (uAvatarReplaceBottom > 0.5 && max(bottomMask, plainMasks.g) > 0.35) discard;
// The base girl has exposed thighs, and the boy's legs are baked into his
// trousers. Replacement bottoms supply complete legs, while source footwear
// and hands remain intact. Use bind-space bounds so poses cannot move a hand
// into this removal region.
if (uAvatarReplaceBottom > 0.5 && vAvatarBindPosition.y < mix(0.69, 0.60, uAvatarBoy)
  && abs(vAvatarBindPosition.x) < 0.22 && max(shoesMask, plainMasks.b) < 0.25) discard;
float avatarPlainArea = max(plainMasks.r * uAvatarPlainTop, max(plainMasks.g * uAvatarPlainBottom, plainMasks.b * uAvatarPlainShoes));
// Basic clothing removes the baked print. Geometry and studio lighting retain
// the garment's form while printed normal/AO details are suppressed below.
diffuseColor.rgb = mix(diffuseColor.rgb, uAvatarPlainTopColor, plainMasks.r * uAvatarPlainTop);
diffuseColor.rgb = mix(diffuseColor.rgb, uAvatarPlainBottomColor, plainMasks.g * uAvatarPlainBottom);
diffuseColor.rgb = mix(diffuseColor.rgb, uAvatarPlainShoesColor, plainMasks.b * uAvatarPlainShoes);
// Only active basic clothing participates in the extra mask; a paid look
// restores the original appearance masks without adding atlas seam boundaries.
appearanceMasks *= 1.0 - max(authoredGarment, avatarPlainArea);
diffuseColor.rgb = mix(diffuseColor.rgb, avatarRecolor(avatarOriginal, uAvatarSkinColor, 0.43), appearanceMasks.r * uAvatarSkinMix);
diffuseColor.rgb = mix(diffuseColor.rgb, avatarRecolor(avatarOriginal, uAvatarHairColor, 0.055), appearanceMasks.g * uAvatarHairMix);
`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `
vec3 avatarUnprintedNormal = normal;
#include <normal_fragment_maps>
normal = normalize(mix(normal, avatarUnprintedNormal, avatarPlainArea));
`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      `
#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.68, avatarPlainArea);
`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <aomap_fragment>",
      `
if (avatarPlainArea < 0.5) {
#include <aomap_fragment>
}
`,
    );
  };
  material.customProgramCacheKey = () => "westory-avatar-production-v3";
  material.needsUpdate = true;
}

// The two textured bases support palettes, bounded facial/hair deformation,
// head-mounted accessories and verified rig poses.
export async function createAvatarStage(
  container,
  initialLook = REFERENCE_LOOK,
  options = {},
) {
  const signal = options.signal;
  const assertActive = () => {
    if (signal?.aborted)
      throw new DOMException("Avatar loading cancelled", "AbortError");
  };
  assertActive();
  const assetBaseUrl = new URL(
    options.assetBaseUrl || `${import.meta.env.BASE_URL}avatar/v1/`,
    window.location.href,
  );
  const assetUrl = (path) => new URL(path, assetBaseUrl).href;
  async function fetchAsset(path) {
    const response = await fetch(assetUrl(path), {
      signal,
      credentials: "same-origin",
    });
    if (!response.ok)
      throw new Error(`Avatar asset unavailable: ${response.status}`);
    return response;
  }
  async function loadMask(path) {
    const response = await fetchAsset(path);
    const blob = await response.blob();
    assertActive();
    const bitmap = await createImageBitmap(blob, {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    if (signal?.aborted) {
      bitmap.close();
      assertActive();
    }
    const texture = new THREE.Texture(bitmap);
    texture.flipY = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    return texture;
  }
  if (!container || typeof container.appendChild !== "function")
    throw new TypeError("3D 화면을 연결할 영역이 없습니다.");
  const character = initialLook?.character === "boy" ? "boy" : "girl";
  const isBoy = character === "boy";
  const modelKey = modelKeyForLook(initialLook);
  const useBase = true;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio || 1, options.maxPixelRatio || 1.5, 2),
  );
  renderer.setClearColor("#f6f4f0", 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.domElement.style.cssText =
    "display:block;width:100%;height:100%;outline:none;";
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute(
    "aria-label",
    "옷을 입은 3D 아바타. 마우스나 손가락으로 모든 방향을 돌려볼 수 있습니다.",
  );
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.72, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.11;
  controls.enablePan = false;
  controls.enableZoom = true;
  controls.minDistance = 3.2;
  controls.maxDistance = 10;
  controls.minPolarAngle = PI * 0.23;
  controls.maxPolarAngle = PI * 0.61;
  controls.rotateSpeed = 0.65;
  controls.zoomSpeed = 0.55;
  controls.autoRotateSpeed = 0.75;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
  scene.add(new THREE.HemisphereLight("#fffcf6", "#c1b8b3", 0.72));
  const key = new THREE.DirectionalLight("#fff5e8", 1.6);
  key.position.set(-3, 5, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight("#eef3ff", 0.65);
  fill.position.set(4, 3, 4);
  scene.add(fill);
  const rim = new THREE.DirectionalLight("#fff6ec", 0.85);
  rim.position.set(0, 4, -4);
  scene.add(rim);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const studio = new RoomEnvironment();
  const environment = pmrem.fromScene(studio, 0.06);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.45;
  studio.dispose();
  pmrem.dispose();
  const podium = mesh(
    scene,
    new THREE.CylinderGeometry(1.04, 1.065, 0.12, 80),
    makeMaterial("#f3f0e9", { roughness: 0.9 }),
    [0, 0.075, 0],
  );
  // A diffuse contact shadow keeps the figure grounded without a large hard
  // directional silhouette, and needs no continuously rendered shadow pass.
  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = shadowCanvas.height = 128;
  const shadowContext = shadowCanvas.getContext("2d");
  const gradient = shadowContext.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, "rgba(75,58,45,0.24)");
  gradient.addColorStop(0.45, "rgba(75,58,45,0.11)");
  gradient.addColorStop(1, "rgba(75,58,45,0)");
  shadowContext.fillStyle = gradient;
  shadowContext.fillRect(0, 0, 128, 128);
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.65, 1.25),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(shadowCanvas),
      transparent: true,
      depthWrite: false,
    }),
  );
  contactShadow.rotation.x = -PI / 2;
  contactShadow.position.set(0, 0.137, 0);
  scene.add(contactShadow);
  const avatar = new THREE.Group();
  avatar.rotation.y = -PI / 2;
  scene.add(avatar);
  let colorMask = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  colorMask.needsUpdate = true;
  let appearanceMask = new THREE.DataTexture(
    new Uint8Array([0, 0, 0, 255]),
    1,
    1,
  );
  appearanceMask.needsUpdate = true;
  let plainMask = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  plainMask.needsUpdate = true;
  let colorwayReady = false;
  let appearanceReady = false,
    hairController = null,
    poseController = null,
    expressionController = null,
    faceController = null,
    accessoryController = null,
    garmentController = null;
  let forwardAxis = "x";
  const verifiedPoses = ["idle", "wave", "cheer", "think", "heart", "tilt"];
  const supportsPose = (pose) =>
    verifiedPoses.includes(pose) &&
    (poseController
      ? poseController.supported.includes(pose)
      : pose === "idle");
  const colorUniforms = {
    uAvatarTopColor: { value: new THREE.Color("#ffffff") },
    uAvatarTopMix: { value: 0 },
    uAvatarBottomColor: { value: new THREE.Color("#ffffff") },
    uAvatarBottomMix: { value: 0 },
    uAvatarShoesColor: { value: new THREE.Color("#ffffff") },
    uAvatarShoesMix: { value: 0 },
    uAvatarAccessoryColor: { value: new THREE.Color("#ffffff") },
    uAvatarAccessoryMix: { value: 0 },
    uAvatarBoy: { value: isBoy ? 1 : 0 },
    uAvatarColorMask: { value: colorMask },
    uAvatarAppearanceMask: { value: appearanceMask },
    uAvatarPlainMask: { value: plainMask },
    uAvatarPlainTop: { value: 1 },
    uAvatarPlainBottom: { value: 1 },
    uAvatarPlainShoes: { value: 1 },
    uAvatarPlainTopColor: { value: new THREE.Color("#a8bbcf") },
    uAvatarPlainBottomColor: { value: new THREE.Color("#c4ccd7") },
    uAvatarPlainShoesColor: { value: new THREE.Color("#e5e8ed") },
    uAvatarSkinColor: { value: new THREE.Color("#e6ac86") },
    uAvatarSkinMix: { value: 0 },
    uAvatarHairColor: { value: new THREE.Color("#69412b") },
    uAvatarHairMix: { value: 0 },
    uAvatarReplaceTop: { value: 0 },
    uAvatarReplaceBottom: { value: 0 },
  };
  const selectedColors = { ...REFERENCE_LOOK };
  function applyColorway(look = {}) {
    const unsupported = [];
    for (const [slot, options] of Object.entries(COLORWAYS)) {
      if (look[slot] === undefined) continue;
      if (
        (slot === "top" && GARMENT_TOPS[look.top]) ||
        (slot === "bottom" && GARMENT_BOTTOMS[look.bottom])
      ) {
        selectedColors[slot] = look[slot];
        continue;
      }
      if (!Object.hasOwn(options, look[slot])) {
        unsupported.push(slot);
        continue;
      }
      const title = `${slot.charAt(0).toUpperCase()}${slot.slice(1)}`;
      const prefix = `uAvatar${title}`;
      colorUniforms[`uAvatarPlain${title}`].value =
        look[slot] === `plain-${slot}` ? 1 : 0;
      let color = options[look[slot]];
      if (isBoy && slot === "bottom") {
        if (look[slot] === "pleated-navy") color = null;
        if (look[slot] === "pleated-lilac") color = "#a58aba";
      }
      if (isBoy && slot === "shoes") {
        if (look[slot] === "sneakers-white") color = null;
        if (look[slot] === "sneakers-pink") color = "#efa8be";
      }
      colorUniforms[`${prefix}Mix`].value = color ? 1 : 0;
      if (color) colorUniforms[`${prefix}Color`].value.set(color);
      selectedColors[slot] = look[slot];
    }
    return {
      applied: unsupported.length === 0,
      mode: "colorways",
      unsupported,
      look: { ...selectedColors },
    };
  }
  function applyAppearance(look = {}) {
    const unsupported = [];
    for (const [slot, palette, prefix] of [
      ["skinTone", SKIN_TONES, "uAvatarSkin"],
      ["hairTone", HAIR_TONES, "uAvatarHair"],
    ]) {
      if (look[slot] === undefined) continue;
      const item = palette.find((option) => option.id === look[slot]);
      if (!item || (!appearanceReady && item.id !== "original")) {
        unsupported.push(slot);
        continue;
      }
      colorUniforms[`${prefix}Mix`].value = item.id === "original" ? 0 : 1;
      colorUniforms[`${prefix}Color`].value.set(item.color);
    }
    if (look.hairStyle !== undefined) {
      if (!hairController?.setStyle(look.hairStyle))
        unsupported.push("hairStyle");
      else
        expressionController?.setExpression(
          expressionController.currentExpression,
        );
    }
    if (look.expression !== undefined && look.expression !== "natural") {
      if (!expressionController?.setExpression(look.expression))
        unsupported.push("expression");
    } else if (look.expression === "natural")
      expressionController?.setExpression("natural");
    expressionController?.setExpression(expressionController.currentExpression);
    if (
      look.faceShape !== undefined &&
      !faceController?.setShape(look.faceShape)
    )
      unsupported.push("faceShape");
    else faceController?.setShape(faceController.current);
    if (look.accessory !== undefined) {
      if (GARMENT_ACCESSORIES.includes(look.accessory)) {
        accessoryController?.setAccessory("none");
        selectedColors.accessory = look.accessory;
      } else if (!accessoryController?.setAccessory(look.accessory))
        unsupported.push("accessory");
      else selectedColors.accessory = look.accessory;
    }
    if (look.pose !== undefined) {
      if (!supportsPose(look.pose)) unsupported.push("pose");
      else poseController?.setPose(look.pose);
    }
    return unsupported;
  }
  function applyGarments(look) {
    const replaced = garmentController?.setLook(look);
    colorUniforms.uAvatarReplaceTop.value = replaced?.top ? 1 : 0;
    colorUniforms.uAvatarReplaceBottom.value = replaced?.bottom ? 1 : 0;
  }
  if (useBase) applyColorway(initialLook);
  let disposed = false,
    frame = 0,
    motionUntil = 0,
    lastFrameTime = 0,
    playTimer = 0,
    renderedFrames = 0;
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let autoRequested = false;
  const initialCamera = new THREE.Vector3(0.6, 2.35, 6.95);
  function render() {
    if (!disposed && !document.hidden) {
      renderer.render(scene, camera);
      renderedFrames++;
    }
  }
  function fit(reset = false) {
    const width = Math.max(1, container.clientWidth),
      height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    if (reset) {
      controls.target.set(0, 1.72, 0);
      camera.position.copy(initialCamera);
      if (camera.aspect < 0.66)
        camera.position.copy(controls.target).add(
          initialCamera
            .clone()
            .sub(controls.target)
            .multiplyScalar(0.66 / camera.aspect),
        );
      camera.lookAt(controls.target);
      controls.update();
    }
    render();
  }
  function tick(now) {
    frame = 0;
    if (disposed || document.hidden) return;
    const delta = lastFrameTime
      ? Math.min((now - lastFrameTime) / 1000, 0.05)
      : 1 / 60;
    lastFrameTime = now;
    controls.update(delta);
    render();
    if (controls.autoRotate || now < motionUntil)
      frame = requestAnimationFrame(tick);
  }
  function wake(duration = 1200) {
    motionUntil = performance.now() + duration;
    if (!disposed && !document.hidden && !frame) {
      lastFrameTime = 0;
      frame = requestAnimationFrame(tick);
    }
  }
  function visibility() {
    if (document.hidden) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    } else wake();
  }
  function motionPreference() {
    controls.autoRotate = autoRequested && !reducedQuery.matches;
    wake();
  }
  function stop() {
    if (playTimer) clearTimeout(playTimer);
    playTimer = 0;
    autoRequested = false;
    controls.autoRotate = false;
    motionUntil = 0;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (!disposed) render();
  }
  function play(durationMs = 8000) {
    if (disposed || document.hidden || reducedQuery.matches) return;
    if (playTimer) clearTimeout(playTimer);
    autoRequested = true;
    motionPreference();
    playTimer = setTimeout(
      stop,
      Math.max(250, Math.min(Number(durationMs) || 8000, 30000)),
    );
  }
  function destroy() {
    if (disposed) return;
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    if (playTimer) clearTimeout(playTimer);
    signal?.removeEventListener("abort", destroy);
    resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", visibility);
    reducedQuery.removeEventListener("change", motionPreference);
    controls.dispose();
    hairController?.dispose();
    poseController?.dispose();
    expressionController?.dispose();
    faceController?.dispose();
    accessoryController?.dispose();
    garmentController?.dispose();
    disposeTree(scene);
    disposeTexture(colorMask);
    disposeTexture(appearanceMask);
    disposeTexture(plainMask);
    environment.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }
  controls.addEventListener("change", render);
  controls.addEventListener("start", () => {
    stop();
    wake();
  });
  controls.addEventListener("end", () => wake());
  const resizeObserver = new ResizeObserver(() => fit(false));
  resizeObserver.observe(container);
  document.addEventListener("visibilitychange", visibility);
  reducedQuery.addEventListener("change", motionPreference);
  signal?.addEventListener("abort", destroy, { once: true });
  fit(true);
  try {
    const response = await fetchAsset(`models/${character}-base.glb`);
    const data = await response.arrayBuffer();
    assertActive();
    const gltf = await new GLTFLoader().parseAsync(data, assetBaseUrl.href);
    if (signal?.aborted || disposed) {
      disposeTree(gltf.scene);
      throw new DOMException("Avatar loading cancelled", "AbortError");
    }
    const model = gltf.scene;
    if (useBase) {
      let firstMesh;
      model.traverse((object) => {
        if (!firstMesh && object.isMesh) firstMesh = object;
      });
      firstMesh.geometry.computeBoundingBox();
      const rawSize = firstMesh.geometry.boundingBox.getSize(
        new THREE.Vector3(),
      );
      forwardAxis = rawSize.x > rawSize.z ? "z" : "x";
      avatar.rotation.y = forwardAxis === "z" ? 0 : -PI / 2;
    }
    let bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y <= 0)
      throw new Error("아바타 모델의 크기를 확인하지 못했습니다.");
    model.scale.multiplyScalar(3.2 / size.y);
    model.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.add(
      new THREE.Vector3(-center.x, 0.14 - bounds.min.y, -center.z),
    );
    model.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = false;
      object.receiveShadow = false;
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        if (material.map)
          material.map.anisotropy = Math.min(
            8,
            renderer.capabilities.getMaxAnisotropy(),
          );
        material.envMapIntensity = 0.65;
        installColorwayShader(material, colorUniforms);
      }
    });
    avatar.add(model);
    colorMask.dispose();
    colorMask = await loadMask(`models/${character}-base-color-mask.png`);
    colorMask.anisotropy = Math.min(
      4,
      renderer.capabilities.getMaxAnisotropy(),
    );
    colorUniforms.uAvatarColorMask.value = colorMask;
    colorwayReady = true;
    appearanceMask.dispose();
    appearanceMask = await loadMask(
      `models/${character}-base-appearance-mask.png`,
    );
    colorUniforms.uAvatarAppearanceMask.value = appearanceMask;
    appearanceReady = true;
    plainMask.dispose();
    plainMask = await loadMask(`models/${character}-base-plain-mask.png`);
    colorUniforms.uAvatarPlainMask.value = plainMask;
    assertActive();
    hairController = createHairController(
      model,
      appearanceMask.image,
      character,
      forwardAxis,
    );
    faceController = createFaceShapeController(model, appearanceMask.image);
    accessoryController = createAccessoryController(model);
    if (useBase)
      poseController = createPoseController(model, {
        forwardAxis: new THREE.Vector3(
          forwardAxis === "x" ? 1 : 0,
          0,
          forwardAxis === "z" ? 1 : 0,
        ),
        armsEnabled: forwardAxis === "z",
      });
    if (useBase && forwardAxis === "z")
      expressionController = createExpressionController(model, {
        character,
        enabled: true,
        forwardAxis,
      });
    garmentController = createGarmentController(model, character);
    applyAppearance(initialLook);
    applyGarments(initialLook);
    wake();
    render();
  } catch (error) {
    destroy();
    if (signal?.aborted || error?.name === "AbortError")
      throw new DOMException("Avatar loading cancelled", "AbortError");
    throw new Error(
      "3D 아바타를 불러오지 못했습니다. 새로고침해 다시 시도해 주세요.",
      { cause: error },
    );
  }
  return {
    mode: useBase ? "customizable-model" : "reference-model",
    modelKey,
    character,
    loaded: true,
    capabilities: Object.freeze({
      orbit: true,
      zoom: true,
      capture: true,
      wardrobe: colorwayReady,
      colorways: colorwayReady,
      wardrobeSlots: colorwayReady
        ? ["top", "bottom", "shoes", "accessory"]
        : [],
      garmentShapes: Boolean(garmentController?.supported),
      appearance: appearanceReady,
      skinTones: appearanceReady
        ? SKIN_TONES.map((item) => item.id)
        : ["original"],
      hairTones: appearanceReady
        ? HAIR_TONES.map((item) => item.id)
        : ["original"],
      hairStyles: hairController?.supported || [isBoy ? "curtain" : "bob"],
      faceShapes: faceController?.supported || ["natural"],
      accessories: [
        ...(accessoryController?.supported || ["none"]),
        ...(garmentController?.supported ? GARMENT_ACCESSORIES : []),
      ],
      expressions: expressionController?.supported || ["natural"],
      poses: verifiedPoses.filter(supportsPose),
    }),
    get stats() {
      let meshes = 0,
        triangles = 0,
        vertices = 0;
      avatar.traverseVisible((object) => {
        if (!object.isMesh) return;
        meshes++;
        vertices += object.geometry.attributes.position.count;
        triangles += object.geometry.index
          ? object.geometry.index.count / 3
          : object.geometry.attributes.position.count / 3;
      });
      return {
        meshes,
        triangles,
        vertices,
        drawCalls: renderer.info.render.calls,
        renderedTriangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        pixelRatio: renderer.getPixelRatio(),
        renderedFrames,
      };
    },
    setLook(look) {
      if (disposed) return { applied: false, reason: "stage-disposed" };
      if (modelKeyForLook({ ...initialLook, ...look }) !== modelKey)
        return {
          applied: false,
          requiresReload: true,
          reason: "model-change-required",
        };
      const result = colorwayReady
        ? applyColorway(look)
        : {
            applied: true,
            unsupported: Object.keys(COLORWAYS).filter(
              (slot) =>
                look[slot] !== undefined && look[slot] !== selectedColors[slot],
            ),
          };
      result.unsupported.push(...applyAppearance(look));
      applyGarments(look);
      result.look = { ...selectedColors };
      result.applied = result.unsupported.length === 0;
      wake(250);
      render();
      return result;
    },
    setPose(pose) {
      if (disposed) return { applied: false, reason: "stage-disposed" };
      const applied =
        supportsPose(pose) &&
        (poseController ? poseController.setPose(pose) : pose === "idle");
      if (!applied) return { applied: false, reason: "pose-not-supported" };
      wake();
      render();
      return { applied: true };
    },
    rotate(direction) {
      if (disposed) return;
      const amount =
        typeof direction === "number"
          ? direction
          : direction === "left"
            ? -1
            : 1;
      const offset = camera.position.clone().sub(controls.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), (amount * PI) / 8);
      camera.position.copy(controls.target).add(offset);
      controls.update();
      wake();
    },
    resetView() {
      if (!disposed) {
        fit(true);
        wake();
      }
    },
    focusFace() {
      if (disposed) return;
      controls.target.set(0, 2.72, 0);
      const offset = new THREE.Vector3(0.12, 0.1, 3.65).multiplyScalar(
        Math.max(1, 0.8 / camera.aspect),
      );
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);
      controls.update();
      wake();
      render();
    },
    zoom(direction) {
      if (disposed) return;
      const inward =
        direction === "in" || (typeof direction === "number" && direction > 0);
      const offset = camera.position.clone().sub(controls.target);
      const distance = THREE.MathUtils.clamp(
        offset.length() * (inward ? 0.84 : 1 / 0.84),
        controls.minDistance,
        controls.maxDistance,
      );
      camera.position.copy(controls.target).add(offset.setLength(distance));
      controls.update();
      wake();
    },
    setAutoRotate(value) {
      autoRequested = Boolean(value);
      motionPreference();
    },
    play,
    stop,
    animateOnce: play,
    capture() {
      render();
      return renderer.domElement.toDataURL("image/png");
    },
    dispose: destroy,
  };
}
