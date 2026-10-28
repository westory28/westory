import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  createGarmentController,
  GARMENT_TOPS,
  GARMENT_BOTTOMS,
  GARMENT_ACCESSORIES,
} from "../src/features/avatar/renderer/garments.js";
import { createPoseController } from "../src/features/avatar/renderer/pose-controller.js";
import { SKIN_TONES } from "../src/features/avatar/renderer/palettes.js";

// Geometry/rig regression uses the real bundled GLBs without GPU/image decode.
// Browser QA separately verifies the shader and original badge rendering.
globalThis.ProgressEvent ??= class extends Event {
  constructor(type, data) {
    super(type);
    Object.assign(this, data);
  }
};
globalThis.document = {
  createElement: () => ({
    getContext: () =>
      new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) }),
  }),
};
const catalog = JSON.parse(
  readFileSync(
    new URL("../functions/avatarCatalog.json", import.meta.url),
    "utf8",
  ),
);
let checked = 0;
for (const character of ["girl", "boy"]) {
  const data = readFileSync(
    new URL(
      `../public/avatar/v1/models/${character}-base.glb`,
      import.meta.url,
    ),
  );
  const length = data.readUInt32LE(12),
    doc = JSON.parse(data.subarray(20, 20 + length));
  doc.buffers[0].uri = `data:application/octet-stream;base64,${data.subarray(28 + length).toString("base64")}`;
  delete doc.images;
  delete doc.textures;
  delete doc.materials;
  for (const mesh of doc.meshes)
    for (const primitive of mesh.primitives) delete primitive.material;
  const { scene } = await new GLTFLoader().parseAsync(JSON.stringify(doc), "");
  const poses = createPoseController(scene, {
    forwardAxis: new THREE.Vector3(0, 0, 1),
    armsEnabled: true,
  });
  const garments = createGarmentController(scene, character);
  assert.equal(garments.supported, true);
  const sourceBones = [];
  scene.traverse((node) => {
    if (node.isBone) sourceBones.push(node);
  });
  const originalBoneCount = sourceBones.length;
  const choices = catalog.items.filter(
    (item) =>
      item.characters.includes(character) &&
      (GARMENT_TOPS[item.value] ||
        GARMENT_BOTTOMS[item.value] ||
        GARMENT_ACCESSORIES.includes(item.value)),
  );
  for (const item of choices) {
    const look = {
      top: "plain-top",
      bottom: "plain-bottom",
      accessory: "none",
      [item.slot]: item.value,
    };
    garments.setLook(look);
    const countNodes = () => {
      let count = 0;
      scene.traverse(() => count++);
      return count;
    };
    const builtCount = countNodes();
    garments.setLook(look);
    assert.equal(
      countNodes(),
      builtCount,
      `${character}:${item.id}: reselect reuses geometry`,
    );
    for (const skin of SKIN_TONES) garments.setLook({ skinTone: skin.id });
    for (const pose of poses.supported) {
      assert.equal(poses.setPose(pose), true);
      scene.updateMatrixWorld(true);
      let visibleGarments = 0;
      scene.traverseVisible((node) => {
        if (!node.isMesh || node.isSkinnedMesh) return;
        visibleGarments++;
        assert(
          node.matrixWorld.elements.every(Number.isFinite),
          `${item.id}:${pose}: finite attachment`,
        );
        const positions = node.geometry.attributes.position;
        assert(
          Array.from(positions.array).every(Number.isFinite),
          `${item.id}:${pose}: finite geometry`,
        );
        const bounds = new THREE.Box3().setFromObject(node);
        assert(
          bounds.min.y > -0.25 && bounds.max.y < 1.75,
          `${item.id}:${pose}: stays on source figure`,
        );
      });
      assert(visibleGarments > 0, `${item.id}: visible garment`);
      if (
        GARMENT_TOPS[item.value]?.kind === "robe" ||
        GARMENT_BOTTOMS[item.value]?.kind === "skirt"
      ) {
        for (const side of ["Left", "Right"]) {
          const lower = scene.getObjectByName(
            `AvatarGarment:${item.value}:${side}Leg`,
          );
          assert(lower?.visible, `${item.id}: hem has a lower-leg connection`);
          const ankle = scene
            .getObjectByName(side + "Foot")
            .getWorldPosition(new THREE.Vector3());
          assert(
            new THREE.Box3()
              .setFromObject(lower)
              .expandByScalar(0.002)
              .containsPoint(ankle),
            `${item.id}:${pose}: leg reaches retained shoe`,
          );
        }
      }
      checked++;
    }
    assert.equal(sourceBones.length, originalBoneCount);
  }
  garments.setLook({
    top: "official-navy",
    bottom: character === "girl" ? "chima-rose" : "baji-navy",
  });
  let visibleBottom = false;
  scene.traverseVisible((node) => {
    if (
      node.name.startsWith("AvatarGarment:chima") ||
      node.name.startsWith("AvatarGarment:baji")
    )
      visibleBottom = true;
  });
  assert.equal(visibleBottom, false, "robe covers selected bottom");
  garments.setLook({
    top: "plain-top",
    bottom: "plain-bottom",
    accessory: "none",
  });
  let active = 0;
  scene.traverseVisible((node) => {
    if (node.name.startsWith("AvatarGarment:")) active++;
  });
  assert.equal(active, 0, "legacy look restores original geometry only");
  garments.dispose();
  poses.dispose();
}
assert.equal(
  catalog.version,
  1,
  "additive catalog keeps existing saved avatar version",
);
console.log(
  `Avatar garments: ${checked} real-rig garment/pose cases, both characters, all skin palettes, lazy reuse and legacy restoration passed.`,
);
