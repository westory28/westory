import * as THREE from "three";

// Measured on the two rigged A-pose assets. Coordinates refer to their source
// position attributes, before skinning (the GLB armature uses a 0.01 scale).
const LANDMARKS = Object.freeze({
  boy: {
    eyes: [
      [0.13048, 1.0022, 0.0693],
      [0.13237, 1.00395, -0.0666],
    ],
    mouth: [0.15553, 0.92516, 0],
    mouthHalfWidth: 0.041,
    eyeRadius: [0.052, 0.056],
  },
  girl: {
    eyes: [
      [0.14034, 1.0023, 0.07736],
      [0.14318, 1.00319, -0.07205],
    ],
    mouth: [0.17065, 0.92205, 0],
    mouthHalfWidth: 0.041,
    eyeRadius: [0.054, 0.061],
  },
});
const PRESETS = Object.freeze({
  natural: { label: "기본", eyes: [1, 1], corners: 0, tilt: 0 },
  smile: { label: "방긋", eyes: [0.88, 0.88], corners: 0.01, tilt: 0.025 },
  calm: { label: "차분", eyes: [0.82, 0.82], corners: -0.004, tilt: 0 },
  bright: { label: "초롱초롱", eyes: [1.16, 1.16], corners: 0.004, tilt: 0 },
  curious: { label: "궁금", eyes: [1.12, 0.9], corners: 0.002, tilt: 0.01 },
  determined: {
    label: "새침",
    eyes: [0.83, 0.83],
    corners: -0.006,
    tilt: -0.1,
  },
});
const soft = (inner, outer, value) =>
  1 - THREE.MathUtils.smoothstep(value, inner, outer);

/** Small texture-preserving face deformations, calibrated to our two base GLBs.
 * Only selected facial vertices are touched, so hair edits and bone poses compose.
 * Unsupported assets expose neutral only rather than pretending to change a face.
 */
export function createExpressionController(
  root,
  { character = "girl", enabled = true, forwardAxis = "z" } = {},
) {
  const config = enabled ? LANDMARKS[character] : null;
  const targets = [];
  if (config)
    root.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
      const position = mesh.geometry.attributes.position,
        selected = [];
      if (position.count !== (character === "boy" ? 29258 : 28814)) return;
      for (let i = 0; i < position.count; i++) {
        const x = forwardAxis === "z" ? position.getZ(i) : position.getX(i),
          y = position.getY(i),
          z = forwardAxis === "z" ? -position.getX(i) : position.getZ(i);
        // The front face is +X. This prevents mirrored edits on hair/back of head.
        if (
          x < 0.075 ||
          x > 0.235 ||
          y < 0.865 ||
          y > 1.073 ||
          Math.abs(z) > 0.151
        )
          continue;
        const eyes = config.eyes.map((center) => {
          const dx = (z - center[2]) / config.eyeRadius[0],
            dy = (y - center[1]) / config.eyeRadius[1];
          const ellipse = Math.sqrt(dx * dx + dy * dy);
          return (
            soft(0.62, 1.2, ellipse) *
            soft(0.045, 0.08, Math.abs(x - center[0]))
          );
        });
        const mx = z / (config.mouthHalfWidth * 1.55),
          my = (y - config.mouth[1]) / 0.033;
        const mouth =
          soft(0.4, 1.2, Math.sqrt(mx * mx + my * my)) *
          soft(0.05, 0.09, Math.abs(x - config.mouth[0]));
        if (eyes[0] > 0 || eyes[1] > 0 || mouth > 0)
          selected.push({ i, x, y, z, eyes, mouth });
      }
      if (selected.length) targets.push({ mesh, position, selected });
    });
  const supported = Object.freeze(
    targets.length ? Object.keys(PRESETS) : ["natural"],
  );
  const labels = Object.freeze(
    Object.fromEntries(supported.map((id) => [id, PRESETS[id].label])),
  );
  let currentExpression = "natural",
    disposed = false;
  function setExpression(id) {
    if (disposed || !supported.includes(id)) return false;
    const preset = PRESETS[id];
    for (const { mesh, position, selected } of targets) {
      for (const v of selected) {
        let dy = 0;
        for (let eye = 0; eye < 2; eye++) {
          const center = config.eyes[eye],
            outward = eye === 0 ? 1 : -1;
          dy +=
            ((v.y - center[1]) * (preset.eyes[eye] - 1) +
              (v.z - center[2]) * outward * preset.tilt) *
            v.eyes[eye];
        }
        const corner = Math.min(
          1,
          Math.pow(Math.abs(v.z) / config.mouthHalfWidth, 1.7),
        );
        dy += preset.corners * corner * v.mouth;
        if (forwardAxis === "z") position.setXYZ(v.i, -v.z, v.y + dy, v.x);
        else position.setXYZ(v.i, v.x, v.y + dy, v.z);
      }
      position.needsUpdate = true;
      // Retain the authored smooth normals/tangents. Recomputing the whole mesh
      // would create hard shading seams in unrelated hair UV islands.
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
      if (mesh.isSkinnedMesh) {
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
      }
    }
    currentExpression = id;
    return true;
  }
  return {
    supported,
    labels,
    get currentExpression() {
      return currentExpression;
    },
    get affectedVertices() {
      return targets.reduce((n, t) => n + t.selected.length, 0);
    },
    setExpression,
    reset() {
      return setExpression("natural");
    },
    dispose() {
      if (!disposed) {
        setExpression("natural");
        disposed = true;
      }
    },
  };
}
