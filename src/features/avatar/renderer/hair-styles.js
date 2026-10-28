import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HAIR_TONES, SKIN_TONES } from "./palettes.js";
import { createSourceHairBuilder } from "./hair-source-styles.js";
import {
  createHairScalp,
  normalizeHairMaterial,
  setHairScalpSkinTone,
} from "./hair-materials.js";

export const HAIR_STYLES = Object.freeze({
  girl: Object.freeze([
    "bob",
    "volume",
    "wave",
    "long",
    "twin-tail",
    "half-up",
  ]),
  boy: Object.freeze(["curtain", "volume", "wave", "crop", "toben"]),
});
const EXTERNAL_STYLES = new Set([
  "volume",
  "wave",
  "crop",
  "toben",
  "twin-tail",
  "half-up",
]);
// Applied after each GLB's authored node transforms, in the base's bind space.
const HAIR_FITS = {
  crop: {
    rotation: [0, -Math.PI / 2, 0],
    offset: [0, -0.025, -0.015],
    scale: [1, 0.8, 0.97],
  },
  wave: {
    rotation: [0, -Math.PI / 2, 0],
    offset: [0, 0.005, -0.015],
    scale: [1, 0.82, 0.97],
  },
  "twin-tail": {
    rotation: [0, -Math.PI / 2, 0],
    width: 0.9,
    offset: [0, 0.025, -0.02],
    scale: [1, 1, 1],
  },
  "half-up": {
    rotation: [0, -Math.PI / 2, 0],
    width: 0.65,
    offset: [0, 0.12, -0.06],
    scale: [1, 1, 1],
  },
  volume: {
    rotation: [0, -Math.PI / 2, 0],
    width: 0.49,
    offset: [0, 0.005, -0.015],
    scale: [1, 0.82, 0.97],
  },
  toben: {
    rotation: [0, -Math.PI / 2, 0],
    offset: [0, -0.035, -0.015],
    scale: [1, 1, 0.97],
  },
};
const defaultFit = {
  rotation: [0, -Math.PI / 2, 0],
  offset: [0, -0.035, -0.015],
  scale: [1, 1, 0.97],
};
const aborted = () =>
  new DOMException("Hair preparation cancelled", "AbortError");

function disposeAsset(root) {
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set(),
    bitmaps = new Set();
  root.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material])
      if (material) materials.add(material);
  });
  for (const material of materials) {
    for (const texture of Object.values(material))
      if (texture?.isTexture) textures.add(texture);
    material.dispose();
  }
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) {
    texture.dispose();
    if (texture.image?.close) bitmaps.add(texture.image);
  }
  for (const bitmap of bitmaps) bitmap.close();
  root.removeFromParent();
}

function withSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const cancel = () => reject(aborted());
    signal.addEventListener("abort", cancel, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", cancel));
  });
}

export function createSculptedHairController(
  root,
  character,
  maskImage,
  options = {},
) {
  let source, head;
  root.traverse((node) => {
    if (!source && node.isSkinnedMesh) source = node;
    if (node.isBone && node.name.toLowerCase() === "head") head = node;
  });
  const supported = HAIR_STYLES[character] || HAIR_STYLES.girl;
  if (!source || !head) throw new Error("아바타 머리 연결을 찾지 못했습니다.");
  const nativeStyle = character === "boy" ? "curtain" : "bob";
  const sourceHair = createSourceHairBuilder(
    source,
    maskImage,
    options.appearanceMask,
    { colorMask: options.colorMask, plainMask: options.plainMask },
  );
  const sourceBounds = new THREE.Box3(),
    positions = source.geometry.attributes.position,
    weights = source.geometry.attributes.avatarHairMask;
  for (let i = 0; i < positions.count; i++)
    if (weights.getX(i) > 0.5)
      sourceBounds.expandByPoint(
        new THREE.Vector3().fromBufferAttribute(positions, i),
      );
  const group = new THREE.Group();
  group.name = "AvatarSculptedHair";
  group.matrixAutoUpdate = false;
  group.matrix
    .copy(source.skeleton.boneInverses[source.skeleton.bones.indexOf(head)])
    .multiply(source.bindMatrix);
  head.add(group);
  const scalp = createHairScalp(source, maskImage);
  scalp.visible = false;
  group.add(scalp);
  const cache = new Map(),
    pending = new Map();
  const tone = { value: new THREE.Color(HAIR_TONES[0].color) },
    toneMix = { value: 0 };
  let current = "",
    headwear = false,
    disposed = false;
  function check() {
    if (disposed || options.signal?.aborted) throw aborted();
  }
  function recolor(material, style) {
    material.envMapIntensity = 0.65;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uExternalHairTone = tone;
      shader.uniforms.uExternalHairMix = toneMix;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
uniform vec3 uExternalHairTone;
uniform float uExternalHairMix;`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
${
  style === "wave"
    ? `
// The generated inner cap has neutral unpainted texels. Match the brown
// strand color so the inside does not appear as an unrelated grey plate.
float innerHairChroma = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
float innerHairShade = clamp(dot(diffuseColor.rgb, vec3(0.2126,0.7152,0.0722)) / 0.12, 0.2, 1.8);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12,0.052,0.026) * innerHairShade, 1.0 - smoothstep(0.01, 0.045, innerHairChroma));`
    : ""
}
float hairShade = clamp(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) / 0.055, 0.12, 1.8);
diffuseColor.rgb = mix(diffuseColor.rgb, uExternalHairTone * hairShade, uExternalHairMix);`,
      );
    };
    material.customProgramCacheKey = () =>
      `westory-external-hair-v2-${style === "wave" ? "wave" : "plain"}`;
    normalizeHairMaterial(material);
  }
  function remember(mesh) {
    mesh.userData.hairBindPositions =
      mesh.geometry.attributes.position.array.slice();
    mesh.userData.hairBindNormals =
      mesh.geometry.attributes.normal.array.slice();
  }
  function fitHeadwear(asset) {
    asset.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const position = mesh.geometry.attributes.position,
        original = mesh.userData.hairBindPositions;
      for (let i = 0; i < position.count; i++) {
        const x = original[i * 3],
          y = original[i * 3 + 1],
          z = original[i * 3 + 2];
        const squeeze = headwear
          ? 1 - 0.16 * THREE.MathUtils.smoothstep(y, 1.12, 1.2)
          : 1;
        position.setXYZ(
          i,
          x * squeeze,
          headwear ? y - Math.max(0, y - 1.16) * 0.88 : y,
          (z + 0.014) * squeeze - 0.014,
        );
      }
      position.needsUpdate = true;
      if (headwear) mesh.geometry.computeVertexNormals();
      else
        mesh.geometry.attributes.normal.array.set(
          mesh.userData.hairBindNormals,
        );
      mesh.geometry.attributes.normal.needsUpdate = true;
      mesh.geometry.computeBoundingSphere();
    });
  }
  function refresh() {
    const replacing = current !== nativeStyle || headwear;
    scalp.visible = !!current && replacing;
    if (
      replacing &&
      current &&
      !EXTERNAL_STYLES.has(current) &&
      !cache.has(current)
    ) {
      const mesh = sourceHair.build(current === "long" ? "long" : "native");
      remember(mesh);
      fitHeadwear(mesh);
      group.add(mesh);
      cache.set(current, mesh);
    }
    for (const [id, asset] of cache)
      asset.visible = replacing && id === current;
  }
  async function loadStyle(style, abort) {
    let gltf;
    try {
      if (!options.loadAsset)
        throw new Error("헤어 자산 로더를 사용할 수 없습니다.");
      const data = await options.loadAsset(
        `models/hair-v3/${style}.glb`,
        abort.signal,
      );
      check();
      if (abort.signal.aborted) throw aborted();
      gltf = await new GLTFLoader().parseAsync(data, "");
      check();
      if (abort.signal.aborted) throw aborted();
      const fit = HAIR_FITS[style] || defaultFit;
      const pivot = new THREE.Group(),
        orientation = new THREE.Group();
      orientation.rotation.set(...fit.rotation);
      orientation.add(gltf.scene);
      pivot.add(orientation);
      pivot.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(pivot),
        width = bounds.getSize(new THREE.Vector3()).x;
      if (!(width > 0))
        throw new Error("헤어 모델의 크기를 확인할 수 없습니다.");
      const uniform =
        (fit.width || sourceBounds.getSize(new THREE.Vector3()).x) / width;
      pivot.scale.set(...fit.scale.map((value) => value * uniform));
      pivot.updateMatrixWorld(true);
      const scaled = new THREE.Box3().setFromObject(pivot),
        center = scaled.getCenter(new THREE.Vector3()),
        target = sourceBounds.getCenter(new THREE.Vector3());
      pivot.position.set(
        target.x - center.x + fit.offset[0],
        sourceBounds.max.y - scaled.max.y + fit.offset[1],
        target.z - center.z + fit.offset[2],
      );
      pivot.updateMatrixWorld(true);
      const result = new THREE.Group();
      result.name = `AvatarHair:external-${style}`;
      const oldGeometry = new Set(),
        materialSet = new Set();
      gltf.scene.traverse((node) => {
        if (!node.isMesh) return;
        if (node.isSkinnedMesh)
          throw new Error("헤어 모델 형식을 지원하지 않습니다.");
        const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
        const mesh = new THREE.Mesh(geometry, node.material);
        mesh.name = `AvatarHair:${style}`;
        remember(mesh);
        result.add(mesh);
        oldGeometry.add(node.geometry);
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material])
          materialSet.add(material);
      });
      if (!result.children.length)
        throw new Error("헤어 모델에 표시할 표면이 없습니다.");
      for (const geometry of oldGeometry) geometry.dispose();
      for (const material of materialSet) recolor(material, style);
      fitHeadwear(result);
      result.visible = false;
      group.add(result);
      cache.set(style, result);
      return true;
    } catch (error) {
      if (gltf) disposeAsset(gltf.scene);
      throw error;
    }
  }
  function cancelExcept(style) {
    for (const [id, task] of pending)
      if (id !== style) {
        task.abort.abort();
        pending.delete(id);
      }
  }
  return {
    supported,
    get current() {
      return current;
    },
    get replacingSource() {
      return !!current && (current !== nativeStyle || headwear);
    },
    getBounds() {
      group.updateWorldMatrix(true, true);
      const asset = cache.get(current);
      return asset?.visible
        ? new THREE.Box3().setFromObject(asset)
        : sourceBounds.clone().applyMatrix4(group.matrixWorld);
    },
    isReady(style) {
      return (
        supported.includes(style) &&
        (!EXTERNAL_STYLES.has(style) || cache.has(style))
      );
    },
    async prepareStyle(style, signal) {
      check();
      if (!supported.includes(style))
        throw new Error("지원하지 않는 헤어입니다.");
      cancelExcept(style);
      if (!EXTERNAL_STYLES.has(style) || cache.has(style)) return;
      let task = pending.get(style);
      if (!task) {
        const abort = new AbortController();
        task = { abort, promise: null };
        task.promise = loadStyle(style, abort).finally(() => {
          if (pending.get(style) === task) pending.delete(style);
        });
        pending.set(style, task);
      }
      await withSignal(task.promise, signal);
      check();
      if (signal?.aborted) throw aborted();
    },
    setStyle(style) {
      if (disposed || !this.isReady(style)) return false;
      current = style;
      refresh();
      return true;
    },
    setTone(id) {
      const entry = HAIR_TONES.find((item) => item.id === id);
      if (disposed || !entry) return false;
      tone.value.set(entry.color);
      toneMix.value = id === "original" ? 0 : 1;
      sourceHair.setTone(id, entry.color);
      return true;
    },
    setSkinTone(id) {
      const entry = SKIN_TONES.find((item) => item.id === id);
      if (entry && !disposed) setHairScalpSkinTone(scalp, id);
    },
    setHeadwear(id) {
      if (disposed) return;
      const next = id === "official-samo" || id === "official-gat";
      if (next === headwear) return;
      headwear = next;
      for (const asset of cache.values()) fitHeadwear(asset);
      refresh();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelExcept(null);
      for (const [id, asset] of cache) {
        if (EXTERNAL_STYLES.has(id)) disposeAsset(asset);
        else asset.geometry.dispose();
      }
      sourceHair.dispose();
      scalp.geometry.dispose();
      scalp.material.dispose();
      group.removeFromParent();
      cache.clear();
    },
  };
}
