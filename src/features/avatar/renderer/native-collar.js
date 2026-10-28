import * as THREE from "three";

/** Close the fused female jacket's missing inner collar without changing its
 * authored outer fold, front zipper, body mesh, or replacement garments. */
export function createNativeCollar(source, character) {
  if (character !== "girl") return { setVisible() {}, dispose() {} };
  const boneIndex = source.skeleton.bones.findIndex(
    (bone) => bone.name.toLowerCase() === "spine",
  );
  if (boneIndex < 0) return { setVisible() {}, dispose() {} };
  const sourceMaterial = Array.isArray(source.material)
    ? source.material[0]
    : source.material;
  const positions = source.geometry.attributes.position;
  const sourceUv = source.geometry.attributes.uv;
  const hair = source.geometry.attributes.avatarHairMask;
  let selected = -1,
    best = Infinity;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i);
    if (
      Math.abs(x) > 0.105 ||
      y < 0.8 ||
      y > 0.87 ||
      z > -0.025 ||
      hair?.getX(i) > 0.5
    )
      continue;
    const distance = x * x + (y - 0.827) ** 2 + (z + 0.055) ** 2;
    if (distance < best) {
      best = distance;
      selected = i;
    }
  }
  if (selected < 0) return { setVisible() {}, dispose() {} };
  const u = sourceUv.getX(selected),
    v = sourceUv.getY(selected);
  const vertices = [],
    uv = [],
    indices = [];
  const profiles = [
    [0.811, 0.113, 0.068],
    [0.834, 0.094, 0.063],
    [0.86, 0.068, 0.052],
    [0.881, 0.049, 0.042],
  ];
  const segments = 48;
  for (const [row, [y, rx, rz]] of profiles.entries()) {
    for (let column = 0; column <= segments; column++) {
      const angle = Math.PI * (0.27 + (1.46 * column) / segments);
      vertices.push(Math.sin(angle) * rx, y, Math.cos(angle) * rz + 0.008);
      // One clean authored collar texel gives a continuous lining. It retains
      // the source PBR texture factors and every existing jacket colorway.
      uv.push(u, v);
      if (row < profiles.length - 1 && column < segments) {
        const a = row * (segments + 1) + column,
          b = a + segments + 1;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute(
    "avatarHairMask",
    new THREE.Float32BufferAttribute(new Float32Array(vertices.length / 3), 1),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = sourceMaterial.clone();
  material.normalMap = null;
  material.bumpMap = null;
  material.displacementMap = null;
  material.side = THREE.DoubleSide;
  material.transparent = false;
  material.opacity = 1;
  material.alphaTest = 0;
  material.onBeforeCompile = (shader, renderer) => {
    sourceMaterial.onBeforeCompile(shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "vec4 avatarMasks = texture2D(uAvatarColorMask, vMapUv);",
        "vec4 avatarMasks = vec4(1.0, 0.0, 0.0, 1.0);",
      )
      .replace(
        "vec2 appearanceMasks = texture2D(uAvatarAppearanceMask, vMapUv).rg;",
        "vec2 appearanceMasks = vec2(0.0);",
      )
      .replace(
        "vec3 plainMasks = texture2D(uAvatarPlainMask, vMapUv).rgb;",
        "vec3 plainMasks = vec3(1.0, 0.0, 0.0);",
      );
  };
  material.customProgramCacheKey = () =>
    `${sourceMaterial.customProgramCacheKey()}-native-collar-v1`;
  const group = new THREE.Group();
  group.name = "AvatarNativeCollar";
  group.matrixAutoUpdate = false;
  group.matrix
    .copy(source.skeleton.boneInverses[boneIndex])
    .multiply(source.bindMatrix);
  const mesh = new THREE.Mesh(geometry, material);
  group.add(mesh);
  source.skeleton.bones[boneIndex].add(group);
  let disposed = false;
  return {
    setVisible(visible) {
      if (!disposed) group.visible = visible;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      geometry.dispose();
      // Atlas textures are shared with the original body and remain its owner.
      material.dispose();
    },
  };
}
