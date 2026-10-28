import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  createSculptedHairController,
  HAIR_STYLES,
} from "../src/features/avatar/renderer/hair-styles.js";
const sharp = createRequire(import.meta.url)("../functions/node_modules/sharp");
globalThis.ProgressEvent ??= class extends Event {
  constructor(type, data) {
    super(type);
    Object.assign(this, data);
  }
};
globalThis.document = {
  createElement: () => ({
    getContext() {
      let current;
      return new Proxy(
        {
          drawImage(image) {
            current = image;
          },
          getImageData() {
            return { data: current.data };
          },
        },
        { get: (object, key) => object[key] ?? (() => {}) },
      );
    },
  }),
};
const results = [];
for (const character of ["girl", "boy"]) {
  const data = await fs.readFile(
      `public/avatar/v1/models/${character}-base.glb`,
    ),
    length = data.readUInt32LE(12),
    doc = JSON.parse(data.subarray(20, 20 + length));
  doc.buffers[0].uri = `data:application/octet-stream;base64,${data.subarray(28 + length).toString("base64")}`;
  delete doc.images;
  delete doc.textures;
  delete doc.materials;
  for (const mesh of doc.meshes)
    for (const primitive of mesh.primitives) delete primitive.material;
  const { scene } = await new GLTFLoader().parseAsync(JSON.stringify(doc), "");
  const mask = await sharp(
    `public/avatar/v1/models/${character}-base-appearance-mask.png`,
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const clothing = {};
  for (const [name, key] of [
    ["color", "colorMask"],
    ["plain", "plainMask"],
  ]) {
    const data = await sharp(
      `public/avatar/v1/models/${character}-base-${name}-mask.png`,
    )
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    clothing[key] = { image: { ...data.info, data: data.data } };
  }
  const controller = createSculptedHairController(
    scene,
    character,
    {
      width: mask.info.width,
      height: mask.info.height,
      data: mask.data,
    },
    clothing,
  );
  let source;
  scene.traverse((node) => {
    if (node.isSkinnedMesh) source = node;
  });
  const attributes = source.geometry.attributes;
  let protectedCollarVertices = 0;
  for (let i = 0; i < attributes.position.count; i++) {
    if (attributes.position.getY(i) >= 0.92) continue;
    const isClothing = Object.values(clothing).some(({ image }) => {
      const x = Math.min(
        image.width - 1,
        Math.max(0, Math.floor(attributes.uv.getX(i) * image.width)),
      );
      const y = Math.min(
        image.height - 1,
        Math.max(0, Math.floor(attributes.uv.getY(i) * image.height)),
      );
      return image.data[(y * image.width + x) * 4] > 89;
    });
    if (!isClothing) continue;
    assert.equal(
      attributes.avatarHairMask.getX(i),
      0,
      "Authored clothing must not be copied or discarded as hair",
    );
    if (attributes.position.getY(i) > 0.79) protectedCollarVertices++;
  }
  assert(protectedCollarVertices > 0);
  const resources = new Set(),
    disposed = new Set(),
    styles = [];
  for (const style of HAIR_STYLES[character].filter((style) =>
    ["bob", "curtain", "long"].includes(style),
  )) {
    assert(controller.setStyle(style));
    controller.setHeadwear("none");
    const visible = [];
    scene.traverseVisible((node) => {
      if (node.name?.startsWith("AvatarHair:")) visible.push(node);
    });
    const native = style === (character === "boy" ? "curtain" : "bob");
    assert.equal(visible.length, native ? 0 : 1);
    styles.push({
      style,
      triangles: visible.reduce(
        (sum, mesh) => sum + mesh.geometry.index.count / 3,
        0,
      ),
    });
    controller.setHeadwear("official-samo");
    controller.setHeadwear("none");
    assert(controller.setTone("rose"));
    assert(controller.setTone("original"));
  }
  scene.traverse((node) => {
    if (
      !node.name?.startsWith("AvatarHair:") &&
      node.name !== "AvatarHairScalp"
    )
      return;
    resources.add(node.geometry);
    resources.add(node.material);
    for (const value of Object.values(node.material))
      if (value?.isTexture) resources.add(value);
  });
  for (const resource of resources)
    resource.addEventListener("dispose", () => disposed.add(resource));
  controller.dispose();
  controller.dispose();
  for (const resource of resources)
    assert(
      disposed.has(resource),
      `Resource ${resource.type || resource.constructor.name} disposed`,
    );
  assert(!scene.getObjectByName("AvatarSculptedHair"));
  assert(!controller.setStyle(HAIR_STYLES[character][0]));
  results.push({
    character,
    styles,
    protectedCollarVertices,
    resources: resources.size,
    disposed: disposed.size,
  });
}
await fs.mkdir("output/avatar-hair-20261028", { recursive: true });
await fs.writeFile(
  "output/avatar-hair-20261028/lifecycle.json",
  JSON.stringify({ passed: true, results }, null, 2),
);
console.log(JSON.stringify({ passed: true, results }));
