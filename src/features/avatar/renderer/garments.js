import * as THREE from "three";
import { TessellateModifier } from "three/examples/jsm/modifiers/TessellateModifier.js";
import { SKIN_TONES } from "./palettes.js";
import { createNativeCollar } from "./native-collar.js";

export const GARMENT_TOPS = Object.freeze({
  "hanbok-ivory": { kind: "hanbok", color: "#f3e7cd", trim: "#8e3049" },
  "hanbok-sky": { kind: "hanbok", color: "#a8cddd", trim: "#294f78" },
  "hanbok-peach": { kind: "hanbok", color: "#efb0a1", trim: "#855364" },
  "official-navy": {
    kind: "robe",
    color: "#263854",
    trim: "#d3ad5b",
    badge: true,
  },
  "official-red": {
    kind: "robe",
    color: "#9c312e",
    trim: "#cbaa65",
    badge: false,
  },
  "official-black": {
    kind: "robe",
    color: "#282d39",
    trim: "#c9a95c",
    badge: true,
  },
  "summer-white": { kind: "summer", color: "#f0f1ee", trim: "#253449" },
  "summer-navy": { kind: "summer", color: "#1f2c42", trim: "#d4dce3" },
});
export const GARMENT_BOTTOMS = Object.freeze({
  "chima-rose": { kind: "skirt", color: "#b65d78" },
  "chima-navy": { kind: "skirt", color: "#29446a" },
  "chima-jade": { kind: "skirt", color: "#398a7f" },
  "baji-navy": { kind: "pants", color: "#33465f" },
  "baji-cream": { kind: "pants", color: "#e6d7bb" },
  "baji-charcoal": { kind: "pants", color: "#454750" },
  "summer-shorts": { kind: "shorts", color: "#202835" },
});
export const GARMENT_ACCESSORIES = Object.freeze([
  "official-samo",
  "official-gat",
]);

const mat = (color, options = {}) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: 0.82,
    metalness: 0,
    side: THREE.DoubleSide,
    ...options,
  });
const add = (parent, geometry, material, position = [0, 0, 0]) => {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(...position);
  parent.add(object);
  return object;
};
function lathe(parent, profile, material, depth = 0.65, segments = 48) {
  const object = add(
    parent,
    new THREE.LatheGeometry(
      profile.map(([r, y]) => new THREE.Vector2(r, y)),
      segments,
    ),
    material,
  );
  object.scale.z = depth;
  return object;
}
function tube(parent, points, radius, material) {
  return add(
    parent,
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))),
      24,
      radius,
      8,
      false,
    ),
    material,
  );
}
function panel(parent, points, material, z) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  return add(
    parent,
    new THREE.ExtrudeGeometry(shape, {
      depth: 0.003,
      bevelEnabled: true,
      bevelThickness: 0.001,
      bevelSize: 0.001,
      bevelSegments: 1,
      steps: 1,
    }),
    material,
    [0, 0, z],
  );
}
function segment(parent, a, b, radiusA, radiusB, material) {
  const start = new THREE.Vector3(...a),
    end = new THREE.Vector3(...b);
  const length = start.distanceTo(end);
  const object = add(
    parent,
    new THREE.CylinderGeometry(radiusB, radiusA, length, 24, 1, false),
    material,
  );
  object.position.copy(start).add(end).multiplyScalar(0.5);
  object.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    end.sub(start).normalize(),
  );
  return object;
}
function ring(parent, y, radius, depth, material, thickness = 0.006) {
  const object = add(
    parent,
    new THREE.TorusGeometry(radius, thickness, 8, 64),
    material,
    [0, y, 0],
  );
  object.rotation.x = Math.PI / 2;
  object.scale.y = depth;
  return object;
}

// Cloth is a single smooth surface with its own rig weights. The old rigid
// cylinders/sphere elbows separated as soon as a pose bent the arm.
function loftGeometry(
  profiles,
  { rings = 32, segments = 48, pleats = 0 } = {},
) {
  const curve = new THREE.CatmullRomCurve3(
    profiles.map(([y, x, z]) => new THREE.Vector3(x, y, z)),
    false,
    "centripetal",
  );
  const points = curve.getPoints(rings);
  const positions = [],
    uv = [],
    indices = [];
  for (let row = 0; row <= rings; row++) {
    const p = points[row];
    for (let col = 0; col <= segments; col++) {
      const angle = (col / segments) * Math.PI * 2;
      const fold =
        1 +
        pleats * Math.cos(angle * 18) * Math.sin((row / rings) * Math.PI * 0.8);
      positions.push(
        Math.sin(angle) * p.x * fold,
        p.y,
        Math.cos(angle) * p.z * fold,
      );
      uv.push(col / segments, row / rings);
      if (row < rings && col < segments) {
        const a = row * (segments + 1) + col,
          b = a + segments + 1;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Original, stylized crane/cloud embroidery. No student photos or third-party
// image textures are processed, downloaded or sent to an image service.
function rankBadgeTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const c = canvas.getContext("2d");
  c.fillStyle = "#283c58";
  c.fillRect(0, 0, 256, 256);
  c.strokeStyle = "#d4b76e";
  c.lineWidth = 8;
  c.strokeRect(7, 7, 242, 242);
  c.lineWidth = 3;
  c.strokeRect(17, 17, 222, 222);
  c.strokeStyle = "#bfa363";
  c.lineWidth = 3;
  for (const [x, y] of [
    [42, 55],
    [173, 39],
    [49, 177],
    [171, 183],
  ]) {
    c.beginPath();
    c.moveTo(x - 15, y + 10);
    c.bezierCurveTo(x - 25, y, x, y - 17, x + 6, y);
    c.bezierCurveTo(x + 28, y - 17, x + 41, y + 9, x + 14, y + 12);
    c.stroke();
  }
  c.fillStyle = "#eee5ce";
  c.beginPath();
  c.ellipse(125, 130, 35, 18, -0.25, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.moveTo(119, 125);
  c.bezierCurveTo(98, 91, 65, 61, 51, 80);
  c.bezierCurveTo(59, 99, 79, 127, 116, 142);
  c.fill();
  c.beginPath();
  c.moveTo(134, 122);
  c.bezierCurveTo(151, 88, 176, 65, 201, 70);
  c.bezierCurveTo(187, 108, 163, 133, 134, 142);
  c.fill();
  c.strokeStyle = "#eee5ce";
  c.lineWidth = 11;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(145, 129);
  c.bezierCurveTo(172, 137, 163, 99, 179, 103);
  c.stroke();
  c.fillStyle = "#b04737";
  c.beginPath();
  c.arc(180, 99, 6, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#d4b76e";
  c.beginPath();
  c.moveTo(184, 104);
  c.lineTo(205, 111);
  c.lineTo(183, 111);
  c.fill();
  c.strokeStyle = "#d4b76e";
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(116, 145);
  c.lineTo(97, 181);
  c.lineTo(83, 181);
  c.moveTo(129, 145);
  c.lineTo(122, 187);
  c.lineTo(140, 187);
  c.stroke();
  c.strokeStyle = "#314255";
  c.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    c.beginPath();
    c.moveTo(116, 133);
    c.quadraticCurveTo(76 + i * 3, 110 - i * 5, 61 + i * 6, 83);
    c.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Smooth rigged clothing, built once per choice and released with the stage. */
export function createGarmentController(root, character) {
  let source;
  root.traverse((o) => {
    if (!source && o.isSkinnedMesh) source = o;
  });
  if (!source)
    return {
      setLook: () => ({ top: false, bottom: false, accessory: false }),
      supported: false,
      dispose() {},
    };
  const bones = new Map(
    source.skeleton.bones.map((bone, index) => [
      bone.name.toLowerCase(),
      { bone, index },
    ]),
  );
  const points = new Map(
    [...bones].map(([name, { index }]) => [
      name,
      new THREE.Vector3().setFromMatrixPosition(
        source.skeleton.boneInverses[index].clone().invert(),
      ),
    ]),
  );
  const point = (name) => points.get(name.toLowerCase()).clone();
  const index = (name) => bones.get(name.toLowerCase()).index;
  const hipY = point("Hips").y;
  const waist = hipY + 0.019;
  const groups = new Map();
  const materials = new Map();
  const material = (color, options = {}) => {
    if (Object.keys(options).length) return mat(color, options);
    if (!materials.has(color)) materials.set(color, mat(color));
    return materials.get(color);
  };
  const skinMaterial = material("#e6ac86");
  const nativeCollar = createNativeCollar(source, character);
  let look = {
    top: "plain-top",
    bottom: "plain-bottom",
    accessory: "none",
    skinTone: "original",
  };
  let disposed = false;
  function collection(id) {
    const parts = [];
    groups.set(id, parts);
    const part = (boneName) => {
      const { bone, index: boneIndex } = bones.get(boneName.toLowerCase());
      const group = new THREE.Group();
      group.name = `AvatarGarment:${id}:${boneName}`;
      group.matrixAutoUpdate = false;
      group.matrix
        .copy(source.skeleton.boneInverses[boneIndex])
        .multiply(source.bindMatrix);
      bone.add(group);
      parts.push(group);
      return group;
    };
    part.skinned = (name, geometry, cloth, weights) => {
      const skinIndices = [],
        skinWeights = [];
      const position = geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        const pairs = weights(
          new THREE.Vector3().fromBufferAttribute(position, i),
          i,
        );
        const sum = pairs.reduce((n, pair) => n + pair[1], 0);
        for (let j = 0; j < 4; j++) {
          skinIndices.push(pairs[j]?.[0] ?? 0);
          skinWeights.push((pairs[j]?.[1] ?? 0) / sum);
        }
      }
      geometry.setAttribute(
        "skinIndex",
        new THREE.Uint16BufferAttribute(skinIndices, 4),
      );
      geometry.setAttribute(
        "skinWeight",
        new THREE.Float32BufferAttribute(skinWeights, 4),
      );
      const mesh = new THREE.SkinnedMesh(geometry, cloth);
      mesh.name = `AvatarGarment:${id}:${name}`;
      mesh.frustumCulled = false;
      source.parent.add(mesh);
      mesh.bind(source.skeleton, source.bindMatrix);
      parts.push(mesh);
      return mesh;
    };
    return part;
  }
  const mixWeights = (nameA, nameB, t) => [
    [index(nameA), 1 - t],
    [index(nameB), t],
  ];
  function bodyWeights(p) {
    const chain = ["Hips", "Spine02", "Spine01", "Spine"];
    for (let i = 0; i < chain.length - 1; i++) {
      const a = point(chain[i]).y,
        b = point(chain[i + 1]).y;
      if (p.y <= b)
        return mixWeights(
          chain[i],
          chain[i + 1],
          THREE.MathUtils.clamp((p.y - a) / (b - a), 0, 1),
        );
    }
    return [[index("Spine"), 1]];
  }
  function skinTube(
    part,
    name,
    joints,
    radii,
    cloth,
    {
      start = 0,
      end = 1,
      drape = 0,
      folds = 0,
      shoulder = false,
      waistFit = false,
    } = {},
  ) {
    const [a, b, c] = joints;
    const lengths = [a.distanceTo(b), b.distanceTo(c)];
    const jointT = lengths[0] / (lengths[0] + lengths[1]);
    const route = new THREE.CatmullRomCurve3([a, b, c], false, "centripetal");
    const rows = 32,
      cols = 28,
      positions = [],
      uv = [],
      indices = [],
      weights = [];
    const curveT = (t) =>
      t < jointT
        ? (t / jointT) * 0.5
        : 0.5 + ((t - jointT) / (1 - jointT)) * 0.5;
    const center = (t) =>
      t < 0
        ? a.clone().lerp(b, t / jointT)
        : t > 1
          ? b.clone().lerp(c, (t - jointT) / (1 - jointT))
          : route.getPoint(curveT(t));
    for (let row = 0; row <= rows; row++) {
      const t = start + ((end - start) * row) / rows;
      const p = center(t);
      const tangent = route
        .getTangent(THREE.MathUtils.clamp(curveT(t), 0, 1))
        .normalize();
      const front = new THREE.Vector3(0, 0, 1)
        .addScaledVector(tangent, -tangent.z)
        .normalize();
      const across = new THREE.Vector3()
        .crossVectors(tangent, front)
        .normalize();
      const q = t / jointT;
      let r =
        t < jointT
          ? THREE.MathUtils.lerp(radii[0], radii[1], q)
          : THREE.MathUtils.lerp(
              radii[1],
              radii[2],
              (t - jointT) / (1 - jointT),
            );
      if (shoulder) r *= Math.sqrt(THREE.MathUtils.smoothstep(t, start, 0.08));
      const blend = THREE.MathUtils.smoothstep(t, jointT - 0.15, jointT + 0.15);
      for (let col = 0; col <= cols; col++) {
        const angle = (col / cols) * Math.PI * 2;
        const pleat =
          1 +
          folds *
            Math.sin(angle * 5 + 0.6) *
            Math.sin((Math.PI * (t - start)) / (end - start));
        const v = p
          .clone()
          .addScaledVector(front, Math.cos(angle) * r * pleat * 0.88)
          .addScaledVector(across, Math.sin(angle) * r * pleat);
        if (waistFit) {
          // Merge the paired leg shells inside the shared waistband. Without
          // this taper, their rear corners can pierce the shirt at the hip.
          const blend = THREE.MathUtils.smoothstep(
            v.y,
            hipY - 0.11,
            hipY - 0.055,
          );
          const distance = Math.hypot(v.x / 0.108, v.z / 0.068);
          const scale = THREE.MathUtils.lerp(
            1,
            Math.min(1, 1 / distance),
            blend,
          );
          v.x *= scale;
          v.z *= scale;
        }
        v.y -= drape * Math.max(0, -Math.sin(angle)) * Math.sin(Math.PI * t);
        positions.push(v.x, v.y, v.z);
        uv.push(col / cols, row / rows);
        weights.push([
          blend,
          shoulder ? 1 - THREE.MathUtils.smoothstep(t, -0.08, 0.17) : 0,
        ]);
        if (row < rows && col < cols) {
          const k = row * (cols + 1) + col,
            l = k + cols + 1;
          indices.push(k, k + 1, l, l, k + 1, l + 1);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return part.skinned(name, geo, cloth, (_p, i) => {
      const [bend, chest] = weights[i];
      const upper = name.includes("Left")
        ? joints.upperLeft
        : joints.upperRight;
      const lower = name.includes("Left")
        ? joints.lowerLeft
        : joints.lowerRight;
      return [
        [index(upper), (1 - bend) * (1 - chest)],
        [index(lower), bend * (1 - chest)],
        [index("Spine"), chest],
      ];
    });
  }
  function limb(
    part,
    side,
    upperName,
    lowerName,
    endName,
    radii,
    cloth,
    opts = {},
  ) {
    const joints = [
      point(side + upperName),
      point(side + lowerName),
      point(side + endName),
    ];
    joints.upperLeft = "Left" + upperName;
    joints.upperRight = "Right" + upperName;
    joints.lowerLeft = "Left" + lowerName;
    joints.lowerRight = "Right" + lowerName;
    return skinTube(
      part,
      side + upperName + ":" + (opts.name || "cloth"),
      joints,
      radii,
      cloth,
      opts,
    );
  }
  function makeArms(part, cloth, trim, kind) {
    const short = kind === "summer";
    for (const side of ["Left", "Right"]) {
      const anchor = point(side + "Arm");
      const shoulder = new THREE.SphereGeometry(1, 24, 16);
      shoulder.scale(0.048, 0.037, 0.05);
      shoulder.translate(anchor.x, anchor.y, anchor.z + 0.006);
      part.skinned(side + "ShoulderBridge", shoulder, cloth, (p) => {
        const outward = side === "Left" ? p.x - anchor.x : anchor.x - p.x;
        const arm = THREE.MathUtils.smoothstep(outward, -0.045, 0.03);
        return mixWeights("Spine", side + "Arm", arm);
      });
      // The hand remains the authored textured mesh. A soft continuous wrist
      // reaches into it; no spherical elbow or disconnected cylinder caps.
      limb(
        part,
        side,
        "Arm",
        "ForeArm",
        "Hand",
        [0.036, 0.032, 0.026],
        skinMaterial,
        { start: 0.01, end: 1.1, name: "skin" },
      );
      const radii = short
        ? [0.048, 0.043, 0.037]
        : kind === "robe"
          ? [0.051, 0.057, 0.043]
          : [0.05, 0.054, 0.041];
      limb(part, side, "Arm", "ForeArm", "Hand", radii, cloth, {
        start: -0.08,
        end: short ? 0.3 : 0.94,
        drape: short ? 0 : 0.011,
        folds: 0.028,
        shoulder: true,
      });
      limb(
        part,
        side,
        "Arm",
        "ForeArm",
        "Hand",
        radii.map((r) => r + 0.0015),
        trim,
        { start: short ? 0.28 : 0.9, end: short ? 0.32 : 0.965, name: "cuff" },
      );
    }
  }
  function skirtLegs(part, cloth) {
    for (const side of ["Left", "Right"]) {
      const lower = part(side + "Leg"),
        ankle = point(side + "Foot"),
        knee = point(side + "Leg");
      const start = knee
        .clone()
        .lerp(
          ankle,
          THREE.MathUtils.clamp((knee.y - 0.17) / (knee.y - ankle.y), 0, 1),
        );
      const connection = segment(
        lower,
        start.toArray(),
        ankle
          .clone()
          .add(new THREE.Vector3(0, -0.08, 0))
          .toArray(),
        0.034,
        0.029,
        cloth,
      );
      connection.name = `AvatarAnkleConnection:${side}`;
    }
  }
  function buildTop(id) {
    const spec = GARMENT_TOPS[id],
      part = collection(id),
      cloth = material(spec.color),
      trim = material(spec.trim),
      ivory = material("#f6efdf");
    const torso = part("Spine");
    const neck = part("neck");
    segment(
      neck,
      point("neck")
        .clone()
        .add(new THREE.Vector3(0, -0.018, 0))
        .toArray(),
      point("Head").toArray(),
      0.043,
      0.038,
      skinMaterial,
    );
    const hem =
      spec.kind === "robe"
        ? 0.145
        : hipY - (spec.kind === "summer" ? 0.05 : 0.025);
    const profile =
      spec.kind === "robe"
        ? [
            [hem, 0.222, 0.158],
            [0.18, 0.222, 0.158],
            [0.3, 0.207, 0.125],
            [waist - 0.07, 0.157, 0.093],
            [waist, 0.124, 0.077],
            [0.75, 0.13, 0.083],
            [0.804, 0.145, 0.082],
            [0.825, 0.116, 0.071],
            [0.851, 0.048, 0.043],
          ]
        : [
            [
              hem,
              spec.kind === "summer" ? 0.143 : 0.127,
              spec.kind === "summer" ? 0.093 : 0.083,
            ],
            [
              hem + 0.015,
              spec.kind === "summer" ? 0.143 : 0.127,
              spec.kind === "summer" ? 0.092 : 0.082,
            ],
            [
              waist + 0.035,
              spec.kind === "summer" ? 0.135 : 0.117,
              spec.kind === "summer" ? 0.089 : 0.075,
            ],
            [0.754, 0.128, 0.08],
            [0.804, 0.145, 0.081],
            [0.825, 0.115, 0.07],
            [0.851, 0.048, 0.042],
          ];
    const body = loftGeometry(profile, {
      pleats: spec.kind === "robe" ? 0.036 : 0.007,
      rings: 40,
    });
    part.skinned("Body", body, cloth, bodyWeights);
    const chestCurve = new THREE.CatmullRomCurve3(
      profile.map(([y, x, z]) => new THREE.Vector3(x, y, z)),
      false,
      "centripetal",
    ).getPoints(80);
    const chestFront = (x, y) => {
      const right = chestCurve.findIndex((p) => p.y >= y);
      const b = chestCurve[right < 0 ? chestCurve.length - 1 : right],
        a = chestCurve[Math.max(0, right - 1)];
      const t =
        b.y === a.y ? 0 : THREE.MathUtils.clamp((y - a.y) / (b.y - a.y), 0, 1);
      const radius = THREE.MathUtils.lerp(a.x, b.x, t),
        depth = THREE.MathUtils.lerp(a.z, b.z, t);
      return depth * Math.sqrt(Math.max(0.04, 1 - (x / radius) ** 2));
    };
    const drapePanel = (parent, outline, cloth, z) => {
      const mesh = panel(parent, outline, cloth, 0);
      const flat = mesh.geometry;
      mesh.geometry = new TessellateModifier(0.012, 5).modify(flat);
      flat.dispose();
      const vertices = mesh.geometry.attributes.position;
      for (let i = 0; i < vertices.count; i++)
        vertices.setZ(
          i,
          vertices.getZ(i) +
            chestFront(vertices.getX(i), vertices.getY(i)) +
            Math.max(0.002, z - 0.08),
        );
      vertices.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      return mesh;
    };
    if (spec.kind === "robe") {
      skirtLegs(part, material("#e9dfce"));
      const beltY = waist + 0.025;
      const belt = part("Spine02");
      lathe(
        belt,
        [
          [0.121, beltY - 0.014],
          [0.128, beltY - 0.012],
          [0.128, beltY + 0.014],
          [0.121, beltY + 0.015],
        ],
        material("#423a30"),
        0.64,
      );
      for (const x of [-0.086, -0.044, 0, 0.044, 0.086]) {
        const z = Math.sqrt(Math.max(0, 0.129 ** 2 - x * x)) * 0.64 + 0.003;
        const plaque = add(
          belt,
          new THREE.BoxGeometry(0.025, 0.019, 0.004),
          trim,
          [x, beltY, z],
        );
        add(
          plaque,
          new THREE.BoxGeometry(0.016, 0.01, 0.002),
          material("#7c633d"),
          [0, 0, 0.003],
        );
      }
      // Ivory cross-collar is fitted over the chest, not a floating neck ring.
      drapePanel(
        torso,
        [
          [-0.044, 0.849],
          [-0.055, 0.836],
          [0.035, 0.755],
          [0.047, 0.767],
        ],
        ivory,
        0.081,
      );
      drapePanel(
        torso,
        [
          [0.044, 0.849],
          [0.055, 0.836],
          [-0.012, 0.777],
          [-0.025, 0.789],
        ],
        ivory,
        0.08,
      );
      if (spec.badge) {
        const badge = add(
          torso,
          new THREE.PlaneGeometry(0.096, 0.087),
          material("#ffffff", { map: rankBadgeTexture() }),
          [0, 0.731, 0.086],
        );
        badge.name = "AvatarRobeEmbroidery";
      }
    } else if (spec.kind === "hanbok") {
      drapePanel(
        torso,
        [
          [-0.044, 0.848],
          [-0.058, 0.835],
          [0.052, 0.718],
          [0.066, 0.73],
        ],
        ivory,
        0.082,
      );
      drapePanel(
        torso,
        [
          [0.044, 0.848],
          [0.058, 0.835],
          [-0.018, 0.751],
          [-0.032, 0.763],
        ],
        ivory,
        0.081,
      );
      const ribbonY = 0.735;
      drapePanel(
        torso,
        [
          [0.025, ribbonY],
          [0.078, ribbonY + 0.014],
          [0.071, ribbonY - 0.013],
          [0.024, ribbonY - 0.008],
        ],
        trim,
        0.088,
      );
      drapePanel(
        torso,
        [
          [0.025, ribbonY],
          [-0.009, ribbonY + 0.012],
          [-0.025, ribbonY - 0.002],
          [0.024, ribbonY - 0.009],
        ],
        trim,
        0.089,
      );
      drapePanel(
        torso,
        [
          [0.021, ribbonY],
          [0.037, ribbonY - 0.004],
          [0.057, hem + 0.018],
          [0.039, hem + 0.014],
        ],
        trim,
        0.089,
      );
      drapePanel(
        torso,
        [
          [0.012, ribbonY - 0.004],
          [0.026, ribbonY - 0.004],
          [0.018, hem + 0.013],
          [0.003, hem + 0.02],
        ],
        trim,
        0.09,
      );
    } else {
      // Small folded polo collars and a recessed placket retain the school
      // uniform shape without raised wire outlines or giant geometric lapels.
      drapePanel(
        torso,
        [
          [-0.004, 0.847],
          [-0.049, 0.841],
          [-0.067, 0.812],
          [-0.022, 0.792],
        ],
        trim,
        0.08,
      );
      drapePanel(
        torso,
        [
          [0.004, 0.847],
          [0.049, 0.841],
          [0.067, 0.812],
          [0.022, 0.792],
        ],
        trim,
        0.08,
      );
      drapePanel(
        torso,
        [
          [-0.006, 0.822],
          [0.006, 0.822],
          [0.006, 0.756],
          [-0.006, 0.756],
        ],
        trim,
        0.083,
      );
      for (const y of [0.792, 0.77])
        add(torso, new THREE.SphereGeometry(0.0026, 8, 5), ivory, [
          0,
          y,
          0.087,
        ]);
      tube(
        torso,
        [
          [0.049, 0.741, 0.081],
          [0.084, 0.741, 0.075],
        ],
        0.0015,
        trim,
      );
    }
    makeArms(
      part,
      cloth,
      spec.kind === "hanbok" ? ivory : spec.kind === "robe" ? ivory : trim,
      spec.kind,
    );
  }
  function buildBottom(id) {
    const spec = GARMENT_BOTTOMS[id],
      part = collection(id),
      cloth = material(spec.color);
    const hips = part("Hips");
    if (spec.kind === "skirt") {
      skirtLegs(part, skinMaterial);
      const geometry = loftGeometry(
        [
          [0.141, 0.235, 0.158],
          [0.166, 0.238, 0.16],
          [0.27, 0.222, 0.147],
          [0.45, 0.185, 0.121],
          [waist - 0.09, 0.138, 0.09],
          [waist - 0.035, 0.111, 0.071],
          [waist + 0.015, 0.108, 0.069],
        ],
        { rings: 36, segments: 64, pleats: 0.048 },
      );
      const skirt = add(hips, geometry, cloth);
      skirt.name = "AvatarChimaPleatedSurface";
      lathe(
        hips,
        [
          [0.11, waist - 0.004],
          [0.115, waist - 0.004],
          [0.115, waist + 0.018],
          [0.11, waist + 0.018],
        ],
        cloth,
        0.66,
      );
      return;
    }
    // A shallow, rounded waistband overlaps two tapered cloth leg shells.
    // The earlier long capped hip cylinder created a visible horizontal block.
    if (spec.kind === "pants") skirtLegs(part, material("#e9dfce"));
    lathe(
      hips,
      [
        [0.103, waist - 0.048],
        [0.111, waist - 0.035],
        [0.111, waist - 0.008],
        [0.105, waist + 0.015],
      ],
      cloth,
      0.66,
    );
    for (const side of ["Left", "Right"]) {
      if (spec.kind === "shorts") {
        limb(
          part,
          side,
          "UpLeg",
          "Leg",
          "Foot",
          [0.045, 0.035, 0.028],
          skinMaterial,
          { start: 0.28, end: 1.035, name: "skin" },
        );
        limb(part, side, "UpLeg", "Leg", "Foot", [0.069, 0.06, 0.037], cloth, {
          start: -0.18,
          end: 0.33,
          folds: 0.018,
          waistFit: true,
        });
        limb(
          part,
          side,
          "UpLeg",
          "Leg",
          "Foot",
          [0.07, 0.061, 0.038],
          material("#34404d"),
          { start: 0.31, end: 0.335, name: "hem" },
        );
      } else {
        limb(part, side, "UpLeg", "Leg", "Foot", [0.073, 0.067, 0.037], cloth, {
          start: -0.18,
          end: 0.96,
          folds: 0.035,
          waistFit: true,
        });
        limb(
          part,
          side,
          "UpLeg",
          "Leg",
          "Foot",
          [0.074, 0.067, 0.036],
          material(new THREE.Color(spec.color).multiplyScalar(0.88).getStyle()),
          { start: 0.9, end: 0.98, name: "cuff" },
        );
      }
    }
  }
  function buildHat(id) {
    const part = collection(id),
      head = part("Head"),
      black = material("#252934", { roughness: 0.94 });
    if (id === "official-samo") {
      lathe(
        head,
        [
          [0, 1.198],
          [0.176, 1.198],
          [0.18, 1.25],
          [0.169, 1.32],
          [0.137, 1.37],
          [0, 1.377],
        ],
        black,
        0.85,
      );
      for (const side of [-1, 1]) {
        const wing = add(head, new THREE.SphereGeometry(1, 24, 12), black, [
          side * 0.249,
          1.272,
          -0.055,
        ]);
        wing.scale.set(0.126, 0.038, 0.014);
        wing.rotation.z = side * 0.12;
      }
      const seam = add(
        head,
        new THREE.TorusGeometry(0.17, 0.003, 6, 48),
        material("#444952"),
        [0, 1.21, 0],
      );
      seam.rotation.x = Math.PI / 2;
      seam.scale.y = 0.85;
    } else {
      const brim = add(
        head,
        new THREE.CylinderGeometry(0.3, 0.3, 0.006, 64),
        black,
        [0, 1.231, -0.01],
      );
      brim.scale.z = 0.91;
      lathe(
        head,
        [
          [0.148, 1.232],
          [0.143, 1.245],
          [0.122, 1.365],
          [0.12, 1.378],
          [0, 1.378],
        ],
        black,
        0.98,
      );
      ring(head, 1.231, 0.299, 0.91, material("#4b4d54"), 0.0025);
      for (const side of [-1, 1])
        tube(
          head,
          [
            [side * 0.155, 1.228, 0.015],
            [side * 0.176, 1.041, 0.09],
            [side * 0.105, 0.918, 0.105],
          ],
          0.0018,
          black,
        );
    }
    // The cap overlaps the fitted hair crown instead of balancing on its tip.
    for (const child of head.children)
      child.position.y -= id === "official-samo" ? 0.023 : 0.026;
  }
  function setLook(next) {
    if (disposed) return { top: false, bottom: false, accessory: false };
    look = { ...look, ...next };
    nativeCollar.setVisible(!GARMENT_TOPS[look.top]);
    const selected = [look.top, look.bottom, look.accessory],
      robe = GARMENT_TOPS[look.top]?.kind === "robe";
    for (const id of selected)
      if (!groups.has(id)) {
        if (GARMENT_TOPS[id]) buildTop(id);
        else if (GARMENT_BOTTOMS[id]) buildBottom(id);
        else if (GARMENT_ACCESSORIES.includes(id)) buildHat(id);
      }
    for (const [id, parts] of groups)
      for (const part of parts)
        part.visible = selected.includes(id) && !(robe && GARMENT_BOTTOMS[id]);
    skinMaterial.color.set(
      (SKIN_TONES.find((s) => s.id === look.skinTone) || SKIN_TONES[0]).color,
    );
    return {
      top: Boolean(GARMENT_TOPS[look.top]),
      bottom: robe || Boolean(GARMENT_BOTTOMS[look.bottom]),
      accessory: GARMENT_ACCESSORIES.includes(look.accessory),
    };
  }
  return {
    supported: true,
    setLook,
    dispose() {
      if (disposed) return;
      disposed = true;
      nativeCollar.dispose();
      const geometries = new Set(),
        mats = new Set(),
        textures = new Set();
      for (const parts of groups.values())
        for (const part of parts) {
          part.traverse((node) => {
            if (node.geometry) geometries.add(node.geometry);
            for (const m of node.material
              ? Array.isArray(node.material)
                ? node.material
                : [node.material]
              : []) {
              mats.add(m);
              if (m.map) textures.add(m.map);
            }
          });
          part.removeFromParent();
        }
      for (const g of geometries) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of textures) t.dispose();
      groups.clear();
      materials.clear();
    },
  };
}
