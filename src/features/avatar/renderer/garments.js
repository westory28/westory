import * as THREE from "three";
import { SKIN_TONES } from "./palettes.js";

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
function roundedJoint(parent, point, radius, material) {
  return add(parent, new THREE.SphereGeometry(radius, 20, 12), material, point);
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

/** Real garment geometry bound to the source rig, with no extra model requests. */
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
    source.skeleton.bones.map((b, i) => [
      b.name.toLowerCase(),
      { bone: b, index: i },
    ]),
  );
  const bindPoints = new Map(
    [...bones].map(([name, { index }]) => [
      name,
      new THREE.Vector3()
        .setFromMatrixPosition(
          source.skeleton.boneInverses[index].clone().invert(),
        )
        .toArray(),
    ]),
  );
  const groups = new Map();
  const skinMaterial = mat("#e6ac86", { roughness: 0.7 });
  const isBoy = character === "boy";
  let look = {
    top: "plain-top",
    bottom: "plain-bottom",
    accessory: "none",
    skinTone: "original",
  };
  function attach(key, boneName) {
    const { bone, index } = bones.get(boneName.toLowerCase());
    const object = new THREE.Group();
    object.name = key;
    object.matrixAutoUpdate = false;
    object.matrix
      .copy(source.skeleton.boneInverses[index])
      .multiply(source.bindMatrix);
    bone.add(object);
    return object;
  }
  function collection(id) {
    const parts = [];
    groups.set(id, parts);
    return (bone) => {
      const g = attach(`AvatarGarment:${id}:${bone}`, bone);
      parts.push(g);
      return g;
    };
  }
  const point = (name) => bindPoints.get(name.toLowerCase());
  const interpolate = (a, b, t) =>
    new THREE.Vector3(...a).lerp(new THREE.Vector3(...b), t).toArray();

  function makeArms(part, cloth, trim, short) {
    for (const side of ["Left", "Right"]) {
      const shoulder = point(side + "Arm"),
        elbow = point(side + "ForeArm"),
        wrist = point(side + "Hand");
      const upper = part(side + "Arm"),
        lower = part(side + "ForeArm");
      // Bridge the source cuff removal plane to the retained hand.
      segment(
        lower,
        interpolate(elbow, wrist, 0.86),
        interpolate(elbow, wrist, 1.14),
        0.033,
        0.03,
        skinMaterial,
      );
      if (short) {
        segment(upper, shoulder, elbow, 0.035, 0.032, skinMaterial);
        roundedJoint(lower, elbow, 0.033, skinMaterial);
        segment(lower, elbow, wrist, 0.032, 0.026, skinMaterial);
        const end = interpolate(shoulder, elbow, 0.58);
        segment(upper, shoulder, end, 0.051, 0.047, cloth);
        segment(
          upper,
          interpolate(shoulder, elbow, 0.54),
          interpolate(shoulder, elbow, 0.6),
          0.048,
          0.048,
          trim,
        );
      } else {
        segment(upper, shoulder, elbow, 0.054, 0.069, cloth);
        roundedJoint(lower, elbow, 0.068, cloth);
        segment(
          lower,
          elbow,
          interpolate(elbow, wrist, 0.96),
          0.069,
          0.047,
          cloth,
        );
        segment(
          lower,
          interpolate(elbow, wrist, 0.88),
          interpolate(elbow, wrist, 0.98),
          0.049,
          0.048,
          trim,
        );
      }
      roundedJoint(upper, shoulder, short ? 0.05 : 0.055, cloth);
    }
  }

  function buildTop(id) {
    const spec = GARMENT_TOPS[id],
      part = collection(id),
      torso = part("Spine02");
    const cloth = mat(spec.color),
      trim = mat(spec.trim),
      ivory = mat("#f6efdf");
    // Close the small neck area formerly occupied by the authored shirt collar.
    segment(
      part("neck"),
      point("neck"),
      point("Head"),
      0.043,
      0.038,
      skinMaterial,
    );
    const hem = spec.kind === "robe" ? 0.18 : isBoy ? 0.55 : 0.63;
    if (spec.kind === "robe") {
      // The robe covers the selected bottom, so it owns the two trouser legs
      // down to the retained shoes as well; the hem must never float above them.
      for (const side of ["Left", "Right"]) {
        const lower = part(side + "Leg"),
          ankle = point(side + "Foot"),
          knee = point(side + "Leg");
        const start = interpolate(
          knee,
          ankle,
          (knee[1] - 0.186) / (knee[1] - ankle[1]),
        );
        segment(lower, start, ankle, 0.033, 0.03, cloth);
        roundedJoint(lower, ankle, 0.03, cloth);
      }
      lathe(
        torso,
        [
          [0, hem],
          [0.18, hem],
          [0.19, hem + 0.015],
          [0.17, 0.43],
          [0.125, 0.64],
          [0.115, 0.76],
          [0.12, 0.8],
          [0.057, 0.841],
          [0, 0.841],
        ],
        cloth,
      );
      const beltY = isBoy ? 0.62 : 0.67;
      ring(torso, beltY, 0.132, 0.67, trim, 0.014);
      for (const x of [-0.09, -0.045, 0, 0.045, 0.09]) {
        const buckle = add(
          torso,
          new THREE.BoxGeometry(0.027, 0.022, 0.006),
          mat("#70522e"),
          [
            x,
            beltY,
            Math.sqrt(Math.max(0, 0.132 ** 2 - x ** 2)) * 0.67 + 0.008,
          ],
        );
        add(
          buckle,
          new THREE.BoxGeometry(0.018, 0.014, 0.003),
          trim,
          [0, 0, 0.004],
        );
      }
      ring(torso, 0.833, 0.055, 0.75, ivory, 0.005);
      if (spec.badge)
        add(
          torso,
          new THREE.PlaneGeometry(0.105, 0.095),
          mat("#ffffff", { map: rankBadgeTexture() }),
          [0, 0.738, 0.08],
        );
      tube(
        torso,
        [
          [0.022, 0.815, 0.065],
          [0.064, 0.78, 0.075],
          [0.08, beltY + 0.018, 0.083],
        ],
        0.0025,
        trim,
      );
    } else {
      lathe(
        torso,
        [
          [0, hem],
          [0.115, hem],
          [0.117, hem + 0.012],
          [0.11, 0.73],
          [0.122, 0.8],
          [0.056, 0.841],
          [0, 0.841],
        ],
        cloth,
      );
      if (spec.kind === "hanbok") {
        panel(
          torso,
          [
            [-0.046, 0.837],
            [-0.064, 0.821],
            [0.058, 0.69],
            [0.072, 0.705],
          ],
          ivory,
          0.078,
        );
        panel(
          torso,
          [
            [0.046, 0.837],
            [0.063, 0.82],
            [-0.025, 0.724],
            [-0.039, 0.739],
          ],
          ivory,
          0.079,
        );
        const ribbonY = 0.715;
        panel(
          torso,
          [
            [0.02, ribbonY],
            [0.075, ribbonY + 0.014],
            [0.066, ribbonY - 0.022],
            [0.02, ribbonY - 0.009],
          ],
          trim,
          0.087,
        );
        panel(
          torso,
          [
            [0.02, ribbonY],
            [-0.015, ribbonY + 0.014],
            [-0.032, ribbonY - 0.006],
            [0.02, ribbonY - 0.011],
          ],
          trim,
          0.089,
        );
        panel(
          torso,
          [
            [0.015, ribbonY - 0.006],
            [0.034, ribbonY - 0.006],
            [0.055, hem + 0.025],
            [0.036, hem + 0.015],
          ],
          trim,
          0.09,
        );
        panel(
          torso,
          [
            [0.01, ribbonY - 0.006],
            [0.025, ribbonY - 0.006],
            [0.018, hem + 0.008],
            [0.001, hem + 0.014],
          ],
          trim,
          0.091,
        );
      } else {
        panel(
          torso,
          [
            [-0.006, 0.836],
            [-0.052, 0.837],
            [-0.085, 0.796],
            [-0.036, 0.765],
          ],
          cloth,
          0.08,
        );
        panel(
          torso,
          [
            [0.006, 0.836],
            [0.052, 0.837],
            [0.085, 0.796],
            [0.036, 0.765],
          ],
          cloth,
          0.08,
        );
        tube(
          torso,
          [
            [-0.051, 0.834, 0.085],
            [-0.08, 0.796, 0.085],
            [-0.036, 0.77, 0.085],
          ],
          0.0024,
          trim,
        );
        tube(
          torso,
          [
            [0.051, 0.834, 0.085],
            [0.08, 0.796, 0.085],
            [0.036, 0.77, 0.085],
          ],
          0.0024,
          trim,
        );
        add(
          torso,
          new THREE.BoxGeometry(0.012, 0.072, 0.004),
          trim,
          [0, 0.769, 0.081],
        );
        for (const y of [0.786, 0.763])
          add(torso, new THREE.SphereGeometry(0.003, 10, 6), ivory, [
            0,
            y,
            0.086,
          ]);
        tube(
          torso,
          [
            [0.052, 0.734, 0.08],
            [0.088, 0.734, 0.074],
          ],
          0.0023,
          trim,
        );
      }
    }
    makeArms(
      part,
      cloth,
      spec.kind === "hanbok" ? ivory : trim,
      spec.kind === "summer",
    );
  }

  function buildBottom(id) {
    const spec = GARMENT_BOTTOMS[id],
      part = collection(id),
      cloth = mat(spec.color);
    const waist = isBoy ? 0.59 : 0.67;
    if (spec.kind === "skirt") {
      const hips = part("Hips");
      for (const side of ["Left", "Right"]) {
        const lower = part(side + "Leg"),
          ankle = point(side + "Foot"),
          knee = point(side + "Leg");
        const start = interpolate(
          knee,
          ankle,
          (knee[1] - 0.18) / (knee[1] - ankle[1]),
        );
        segment(lower, start, ankle, 0.03, 0.027, skinMaterial);
        roundedJoint(lower, ankle, 0.028, skinMaterial);
      }
      const skirt = lathe(
        hips,
        [
          [0, 0.17],
          [0.215, 0.17],
          [0.222, 0.185],
          [0.2, 0.3],
          [0.155, 0.54],
          [0.111, waist],
          [0, waist],
        ],
        cloth,
        0.69,
        96,
      );
      ring(hips, waist - 0.005, 0.111, 0.69, mat(spec.color), 0.012);
      // Pleats belong to the cloth surface itself; separate overlay lines
      // would intersect the curved skirt and flicker during orbit/poses.
      const positions = skirt.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i),
          z = positions.getZ(i);
        const radius = Math.hypot(x, z);
        if (radius < 0.01) continue;
        const spread = THREE.MathUtils.clamp(
          (waist - positions.getY(i)) / (waist - 0.17),
          0,
          1,
        );
        const pleat = 1 + Math.cos(Math.atan2(x, z) * 16) * 0.016 * spread;
        positions.setXYZ(i, x * pleat, positions.getY(i), z * pleat);
      }
      positions.needsUpdate = true;
      skirt.geometry.computeVertexNormals();
      return;
    }
    const hips = part("Hips");
    lathe(
      hips,
      [
        [0, waist - 0.09],
        [0.122, waist - 0.09],
        [0.12, waist],
        [0, waist],
      ],
      cloth,
      0.72,
    );
    for (const side of ["Left", "Right"]) {
      const hip = point(side + "UpLeg"),
        knee = point(side + "Leg"),
        ankle = point(side + "Foot");
      const upper = part(side + "UpLeg"),
        lower = part(side + "Leg");
      if (spec.kind === "shorts") {
        segment(upper, hip, knee, 0.044, 0.033, skinMaterial);
        roundedJoint(lower, knee, 0.034, skinMaterial);
        segment(lower, knee, ankle, 0.034, 0.027, skinMaterial);
        segment(
          upper,
          interpolate(hip, knee, -0.1),
          interpolate(hip, knee, 0.62),
          0.067,
          0.062,
          cloth,
        );
      } else {
        segment(upper, interpolate(hip, knee, -0.1), knee, 0.068, 0.061, cloth);
        roundedJoint(lower, knee, 0.062, cloth);
        segment(
          lower,
          knee,
          interpolate(knee, ankle, 0.94),
          0.061,
          0.037,
          cloth,
        );
        segment(
          lower,
          interpolate(knee, ankle, 0.84),
          interpolate(knee, ankle, 0.97),
          0.039,
          0.036,
          mat(new THREE.Color(spec.color).multiplyScalar(0.85)),
        );
      }
    }
  }

  function buildHat(id) {
    const part = collection(id),
      head = part("Head"),
      black = mat("#20232a", { roughness: 0.9 });
    if (id === "official-samo") {
      lathe(
        head,
        [
          [0, 1.2],
          [0.174, 1.2],
          [0.174, 1.29],
          [0.154, 1.35],
          [0.136, 1.38],
          [0, 1.39],
        ],
        black,
        0.83,
      );
      const crown = add(
        head,
        new THREE.SphereGeometry(0.145, 32, 20),
        black,
        [0, 1.34, -0.055],
      );
      crown.scale.set(0.88, 0.72, 0.85);
      for (const side of [-1, 1]) {
        const wing = add(
          head,
          new THREE.CapsuleGeometry(0.043, 0.17, 6, 16),
          black,
          [side * 0.245, 1.26, -0.045],
        );
        wing.rotation.z = Math.PI / 2 + side * 0.08;
        wing.scale.z = 0.42;
      }
    } else {
      const brim = add(
        head,
        new THREE.CylinderGeometry(0.3, 0.3, 0.009, 64),
        black,
        [0, 1.225, -0.01],
      );
      brim.scale.z = 0.9;
      add(
        head,
        new THREE.CylinderGeometry(0.123, 0.15, 0.155, 48),
        black,
        [0, 1.303, -0.01],
      );
      ring(head, 1.225, 0.3, 0.9, mat("#353943"), 0.003);
      for (const side of [-1, 1])
        tube(
          head,
          [
            [side * 0.16, 1.22, 0.01],
            [side * 0.18, 1.02, 0.07],
            [side * 0.1, 0.895, 0.09],
          ],
          0.0024,
          black,
        );
    }
  }

  function setLook(next) {
    look = { ...look, ...next };
    const selected = [look.top, look.bottom, look.accessory];
    const robe = GARMENT_TOPS[look.top]?.kind === "robe";
    for (const id of selected) {
      if (groups.has(id)) continue;
      if (GARMENT_TOPS[id]) buildTop(id);
      else if (GARMENT_BOTTOMS[id]) buildBottom(id);
      else if (GARMENT_ACCESSORIES.includes(id)) buildHat(id);
    }
    for (const [id, parts] of groups) {
      const visible = selected.includes(id) && !(robe && GARMENT_BOTTOMS[id]);
      for (const part of parts) part.visible = visible;
    }
    const skin =
      SKIN_TONES.find((s) => s.id === look.skinTone) || SKIN_TONES[0];
    skinMaterial.color.set(skin.color);
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
      groups.clear();
    },
  };
}
