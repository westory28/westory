import * as THREE from "three";

const smooth = (low, high, value) =>
  THREE.MathUtils.smoothstep(value, low, high);

// This stays within the lower face: eyes, forehead, hair and body retain their
// authored proportions. X/Z are recomposed after each expression's Y change.
export function createFaceShapeController(root, maskImage) {
  const canvas = document.createElement("canvas");
  canvas.width = maskImage.width;
  canvas.height = maskImage.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(maskImage, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const records = [];
  root.traverse((object) => {
    if (!object.isSkinnedMesh || !object.geometry.attributes.uv) return;
    const positions = object.geometry.attributes.position,
      uv = object.geometry.attributes.uv;
    const original = positions.array.slice(),
      weights = new Float32Array(positions.count),
      seams = new Map();
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i),
        y = positions.getY(i),
        z = positions.getZ(i);
      const tx = Math.min(
        canvas.width - 1,
        Math.max(0, Math.floor(uv.getX(i) * canvas.width)),
      );
      const ty = Math.min(
        canvas.height - 1,
        Math.max(0, Math.floor(uv.getY(i) * canvas.height)),
      );
      const skin = pixels[(ty * canvas.width + tx) * 4] / 255;
      if (
        (skin > 0.3 ||
          (Math.abs(x) < 0.075 && y > 0.89 && y < 0.945 && z > 0.1)) &&
        z > 0.025 &&
        y > 0.855 &&
        y < 0.955 &&
        Math.abs(x) < 0.155
      ) {
        const lowerFace = smooth(0.855, 0.9, y) * (1 - smooth(0.925, 0.955, y));
        const cheek = 1 - smooth(0.14, 0.155, Math.abs(x));
        weights[i] = lowerFace * cheek * smooth(0.3, 0.85, skin);
      }
      const key = `${Math.round(x * 100000)},${Math.round(y * 100000)},${Math.round(z * 100000)}`;
      if (!seams.has(key)) seams.set(key, []);
      seams.get(key).push(i);
    }
    for (const indices of seams.values()) {
      const weight = Math.max(...indices.map((index) => weights[index]));
      for (const i of indices) weights[i] = weight;
    }
    const selected = [];
    for (let i = 0; i < weights.length; i++)
      if (weights[i] > 0.001) selected.push(i);
    if (selected.length)
      records.push({ object, positions, original, weights, selected });
  });
  let current = "natural";
  const supported = records.length ? ["natural", "round", "slim"] : ["natural"];
  function setShape(shape) {
    if (!supported.includes(shape)) return false;
    const width = shape === "round" ? 0.11 : shape === "slim" ? -0.09 : 0;
    const depth = shape === "round" ? 0.006 : shape === "slim" ? -0.003 : 0;
    for (const { object, positions, original, weights, selected } of records) {
      for (const i of selected) {
        const x = original[i * 3],
          z = original[i * 3 + 2],
          weight = weights[i];
        positions.setX(i, x * (1 + width * weight));
        positions.setZ(i, z + depth * weight * (1 - Math.abs(x) / 0.16));
      }
      positions.needsUpdate = true;
      object.geometry.computeBoundingSphere();
      object.computeBoundingSphere();
    }
    current = shape;
    return true;
  }
  return {
    supported,
    setShape,
    get current() {
      return current;
    },
    dispose() {
      records.length = 0;
    },
  };
}

function material(color, roughness = 0.42, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}
function add(parent, geometry, mat, x = 0, y = 0, z = 0) {
  const object = new THREE.Mesh(geometry, mat);
  object.position.set(x, y, z);
  parent.add(object);
  return object;
}
function tube(parent, points, radius, mat) {
  return add(
    parent,
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))),
      40,
      radius,
      8,
      false,
    ),
    mat,
  );
}
function starShape() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const angle = Math.PI / 2 + (i * Math.PI) / 5,
      r = i % 2 ? 0.018 : 0.04;
    const x = Math.cos(angle) * r,
      y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

/** Geometry follows the actual Head bone, including tilt and cheering poses. */
export function createAccessoryController(root) {
  let mesh, head;
  root.traverse((object) => {
    if (!mesh && object.isSkinnedMesh) mesh = object;
    if (object.isBone && object.name.toLowerCase() === "head") head = object;
  });
  if (!mesh || !head)
    return {
      supported: ["none"],
      setAccessory: (id) => id === "none",
      dispose() {},
    };
  const group = new THREE.Group();
  group.name = "AvatarHeadAccessories";
  const headIndex = mesh.skeleton.bones.indexOf(head);
  group.matrixAutoUpdate = false;
  group.matrix
    .copy(mesh.skeleton.boneInverses[headIndex])
    .multiply(mesh.bindMatrix);
  head.add(group);
  const choices = new Map();

  const glasses = new THREE.Group();
  glasses.name = "RoundGlasses";
  const rim = material("#364052", 0.35, 0.2);
  for (const side of [-1, 1]) {
    add(
      glasses,
      new THREE.TorusGeometry(0.061, 0.0036, 10, 48),
      rim,
      side * 0.075,
      1.003,
      0.175,
    );
    tube(
      glasses,
      [
        [side * 0.133, 1.015, 0.175],
        [side * 0.155, 1.025, 0.12],
        [side * 0.164, 1.014, 0.025],
      ],
      0.0035,
      rim,
    );
  }
  tube(
    glasses,
    [
      [-0.014, 1.006, 0.175],
      [0, 1.014, 0.185],
      [0.014, 1.006, 0.175],
    ],
    0.0033,
    rim,
  );
  choices.set("glasses-round", glasses);

  const clip = new THREE.Group();
  clip.name = "StarHairClip";
  const gold = material("#ffd36b", 0.3, 0.18),
    ivory = material("#fff4cf", 0.4);
  const clasp = add(
    clip,
    new THREE.CapsuleGeometry(0.006, 0.08, 5, 12),
    gold,
    0.145,
    1.143,
    0.137,
  );
  clasp.rotation.z = -0.6;
  const star = add(
    clip,
    new THREE.ExtrudeGeometry(starShape(), {
      depth: 0.01,
      bevelEnabled: true,
      bevelThickness: 0.0035,
      bevelSize: 0.003,
      bevelSegments: 2,
      steps: 1,
    }),
    gold,
    0.14,
    1.15,
    0.146,
  );
  star.rotation.z = -0.15;
  add(clip, new THREE.SphereGeometry(0.008, 12, 8), ivory, 0.14, 1.153, 0.161);
  choices.set("star-clip", clip);

  const headphones = new THREE.Group();
  headphones.name = "StudioHeadphones";
  const shell = material("#8fb6bf", 0.37, 0.05),
    cushion = material("#344755", 0.7),
    trim = material("#e8edf1", 0.4);
  const band = [];
  for (let i = 0; i <= 20; i++) {
    const angle = (i / 20) * Math.PI;
    band.push([
      0.222 * Math.cos(angle),
      1.015 + 0.315 * Math.sin(angle),
      -0.018,
    ]);
  }
  tube(headphones, band, 0.012, cushion);
  tube(
    headphones,
    band.map(([x, y, z]) => [x, y + 0.007, z]),
    0.008,
    shell,
  );
  for (const side of [-1, 1]) {
    tube(
      headphones,
      [
        [side * 0.222, 1.015, -0.018],
        [side * 0.229, 1.005, 0.035],
        [side * 0.229, 0.995, 0.065],
      ],
      0.01,
      shell,
    );
    const pad = add(
      headphones,
      new THREE.CylinderGeometry(0.057, 0.057, 0.024, 28),
      cushion,
      side * 0.208,
      0.995,
      0.065,
    );
    pad.rotation.z = Math.PI / 2;
    const cup = add(
      headphones,
      new THREE.CylinderGeometry(0.058, 0.061, 0.032, 28),
      shell,
      side * 0.229,
      0.995,
      0.065,
    );
    cup.rotation.z = Math.PI / 2;
    const disk = add(
      headphones,
      new THREE.CylinderGeometry(0.036, 0.036, 0.003, 24),
      trim,
      side * 0.247,
      0.995,
      0.065,
    );
    disk.rotation.z = Math.PI / 2;
  }
  choices.set("headphones", headphones);
  for (const object of choices.values()) {
    object.visible = false;
    group.add(object);
  }
  let current = "none";
  function setAccessory(id) {
    if (id !== "none" && !choices.has(id)) return false;
    for (const [key, object] of choices) object.visible = key === id;
    current = id;
    return true;
  }
  return {
    supported: ["none", ...choices.keys()],
    setAccessory,
    get current() {
      return current;
    },
    dispose() {},
  };
}
