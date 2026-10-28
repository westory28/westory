/** Texture-only GLB optimization. Geometry, UVs and material links stay intact. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const sharp = require("../functions/node_modules/sharp");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(
  process.argv.find((arg) => arg.endsWith(".glb")) ||
    path.join(root, "output/avatar-hair-rebuild-20261028/toben-generated.glb"),
);
const target = source.replace(/(?:-generated)?\.glb$/i, "-optimized.glb");
assert.notEqual(source, target, "never overwrite the source asset");
const folder = path.dirname(target);
const stem = path.basename(target, ".glb");
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
const align = (length) => Math.ceil(length / 4) * 4;

function parseGLB(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, "GLB magic");
  assert.equal(bytes.readUInt32LE(4), 2, "GLB version");
  assert.equal(bytes.readUInt32LE(8), bytes.length, "declared GLB length");
  const chunks = [];
  for (let offset = 12; offset < bytes.length; ) {
    const length = bytes.readUInt32LE(offset);
    assert.equal(length % 4, 0, "aligned chunk");
    assert(offset + 8 + length <= bytes.length, "chunk bounds");
    chunks.push({
      type: bytes.readUInt32LE(offset + 4),
      bytes: bytes.subarray(offset + 8, offset + 8 + length),
    });
    offset += 8 + length;
  }
  assert.deepEqual(
    chunks.map((c) => c.type),
    [0x4e4f534a, 0x004e4942],
  );
  const json = JSON.parse(chunks[0].bytes.toString("utf8"));
  const bin = chunks[1].bytes;
  assert.equal(json.buffers.length, 1, "one embedded buffer required");
  assert(!json.buffers[0].uri, "embedded data only");
  assert(json.buffers[0].byteLength <= bin.length);
  for (const view of json.bufferViews) {
    assert.equal(view.buffer, 0);
    assert((view.byteOffset || 0) + view.byteLength <= bin.length);
  }
  return { json, bin };
}

const viewBytes = (asset, index) => {
  const view = asset.json.bufferViews[index];
  return asset.bin.subarray(
    view.byteOffset || 0,
    (view.byteOffset || 0) + view.byteLength,
  );
};

function encodeGLB(json, bin) {
  const raw = Buffer.from(JSON.stringify(json));
  const j = Buffer.alloc(align(raw.length), 0x20);
  raw.copy(j);
  const b = Buffer.alloc(align(bin.length));
  bin.copy(b);
  const result = Buffer.alloc(12 + 8 + j.length + 8 + b.length);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(j.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  j.copy(result, 20);
  result.writeUInt32LE(b.length, 20 + j.length);
  result.writeUInt32LE(0x004e4942, 24 + j.length);
  b.copy(result, 28 + j.length);
  return result;
}

const originalBytes = await readFile(source);
const original = parseGLB(originalBytes);
const json = structuredClone(original.json);
const imageViews = new Set(json.images.map((image) => image.bufferView));
assert.equal(
  imageViews.size,
  json.images.length,
  "independent embedded images",
);
const roles = json.images.map(() => new Set());
for (const material of json.materials || []) {
  const mark = (reference, role) => {
    if (reference) roles[json.textures[reference.index].source].add(role);
  };
  mark(material.pbrMetallicRoughness?.baseColorTexture, "baseColor");
  mark(material.pbrMetallicRoughness?.metallicRoughnessTexture, "ORM");
  mark(material.normalTexture, "normal");
  mark(material.occlusionTexture, "ORM");
  mark(material.emissiveTexture, "baseColor");
}
const replacements = new Map();
const textures = [];
await mkdir(folder, { recursive: true });
for (const [index, image] of json.images.entries()) {
  assert.equal(typeof image.bufferView, "number", "embedded images only");
  const input = viewBytes(original, image.bufferView);
  const metadata = await sharp(input).metadata();
  assert.equal(roles[index].size, 1, "one texture role per image");
  const role = [...roles[index]][0];
  const size = role === "ORM" ? 512 : 1024;
  const resize = (edge) =>
    sharp(input).resize(edge, edge, {
      fit: "inside",
      withoutEnlargement: true,
      kernel: "lanczos3",
    });
  // No gamma conversion for data textures and no palette quantization: normal
  // and packed roughness/metalness channels remain independent RGB values.
  const compress = (pipeline) =>
    role === "baseColor" && !metadata.hasAlpha
      ? pipeline.jpeg({
          quality: 92,
          chromaSubsampling: "4:4:4",
          mozjpeg: true,
        })
      : pipeline.png({
          compressionLevel: 9,
          adaptiveFiltering: true,
          palette: false,
        });
  const output = await compress(resize(size)).toBuffer();
  const resultMetadata = await sharp(output).metadata();
  image.mimeType =
    resultMetadata.format === "jpeg" ? "image/jpeg" : "image/png";
  replacements.set(image.bufferView, output);
  const alternative =
    role === "ORM"
      ? (await compress(resize(1024)).toBuffer()).length
      : output.length;
  textures.push({
    index,
    role,
    original: {
      bytes: input.length,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
    },
    optimized: {
      bytes: output.length,
      width: resultMetadata.width,
      height: resultMetadata.height,
      format: resultMetadata.format,
    },
    all1024Bytes: alternative,
  });
  // A representative, equal-scale detail comparison. Left is original detail;
  // right is the optimized texture upsampled only for inspection.
  const x = Math.floor(metadata.width * 0.375);
  const y = Math.floor(metadata.height * 0.375);
  const width = Math.min(1024, metadata.width - x);
  const height = Math.min(1024, metadata.height - y);
  const left = await sharp(input)
    .extract({ left: x, top: y, width, height })
    .resize(512, 512)
    .png()
    .toBuffer();
  const enlarged = await sharp(output)
    .resize(metadata.width, metadata.height)
    .png()
    .toBuffer();
  const right = await sharp(enlarged)
    .extract({ left: x, top: y, width, height })
    .resize(512, 512)
    .png()
    .toBuffer();
  await sharp({
    create: { width: 1024, height: 512, channels: 3, background: "#fff" },
  })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: right, left: 512, top: 0 },
    ])
    .png()
    .toFile(path.join(folder, `${stem}-${role}-comparison.png`));
}

const chunks = [];
let offset = 0;
for (const [index, view] of json.bufferViews.entries()) {
  const data = replacements.get(index) || viewBytes(original, index);
  const padding = Buffer.alloc(align(data.length) - data.length);
  view.byteOffset = offset;
  view.byteLength = data.length;
  chunks.push(data, padding);
  offset += data.length + padding.length;
}
json.buffers[0].byteLength = offset;
const optimizedBytes = encodeGLB(json, Buffer.concat(chunks));
const optimized = parseGLB(optimizedBytes);
for (const key of [
  "accessors",
  "meshes",
  "materials",
  "textures",
  "samplers",
  "nodes",
  "scenes",
  "skins",
  "animations",
])
  assert.deepEqual(optimized.json[key], original.json[key], `${key} unchanged`);
for (const [index] of original.json.bufferViews.entries())
  if (!imageViews.has(index))
    assert(
      viewBytes(original, index).equals(viewBytes(optimized, index)),
      `geometry bufferView ${index} byte-identical`,
    );
assert.equal(optimized.json.images.length, original.json.images.length);
await writeFile(target, optimizedBytes);
assert.equal(
  sha(await readFile(source)),
  sha(originalBytes),
  "original file untouched",
);
let triangles = 0;
for (const mesh of json.meshes)
  for (const primitive of mesh.primitives) {
    assert.equal(primitive.mode ?? 4, 4, "triangle primitive");
    triangles +=
      json.accessors[primitive.indices ?? primitive.attributes.POSITION].count /
      3;
  }
const report = {
  source,
  target,
  originalBytes: originalBytes.length,
  optimizedBytes: optimizedBytes.length,
  reductionPercent: Number(
    (100 * (1 - optimizedBytes.length / originalBytes.length)).toFixed(2),
  ),
  originalSha256: sha(originalBytes),
  optimizedSha256: sha(optimizedBytes),
  triangles,
  vertices: json.meshes.reduce(
    (n, mesh) =>
      n +
      mesh.primitives.reduce(
        (sum, primitive) =>
          sum + json.accessors[primitive.attributes.POSITION].count,
        0,
      ),
    0,
  ),
  meshCount: json.meshes.length,
  materialCount: json.materials.length,
  textureCount: json.textures.length,
  textures,
  geometryByteIdentical: true,
  uvAndMaterialStructureUnchanged: true,
};

if (process.argv.includes("--verify-browser")) {
  let playwright;
  try {
    playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
  } catch (error) {
    if (process.env.PLAYWRIGHT_MODULE_PATH || error.code !== "MODULE_NOT_FOUND")
      throw error;
    playwright = require(
      path.join(
        os.homedir(),
        ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
      ),
    );
  }
  const server = await createServer({
    root,
    logLevel: "error",
    server: { host: "127.0.0.1", port: 5193 },
  });
  await server.listen();
  let browser;
  try {
    browser = await playwright.chromium.launch({
      channel: "msedge",
      headless: true,
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({
      viewport: { width: 800, height: 450 },
    });
    const origin = server.resolvedUrls.local[0];
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(origin).origin) return route.abort();
      if (url.pathname === "/__hair-optimization")
        return route.fulfill({
          contentType: "text/html",
          body: '<html><body style="margin:0"><canvas id="view"></canvas></body></html>',
        });
      return route.continue();
    });
    await page.goto(`${origin}__hair-optimization`);
    const urls = [source, target].map(
      (filename) => `/${path.relative(root, filename).replaceAll("\\", "/")}`,
    );
    report.browser = await page.evaluate(async (urls) => {
      const THREE = await import("/node_modules/three/build/three.module.js");
      const { GLTFLoader } =
        await import("/node_modules/three/examples/jsm/loaders/GLTFLoader.js");
      const renderer = new THREE.WebGLRenderer({
        canvas: document.querySelector("#view"),
        antialias: true,
        preserveDrawingBuffer: true,
      });
      renderer.setSize(800, 450);
      renderer.setScissorTest(true);
      const loader = new GLTFLoader();
      const assets = await Promise.all(
        urls.map((url) => loader.loadAsync(url)),
      );
      const results = [];
      for (const [index, gltf] of assets.entries()) {
        const scene = new THREE.Scene();
        scene.background = new THREE.Color("#e9edf1");
        scene.add(new THREE.HemisphereLight(0xffffff, 0x687183, 2.4));
        const light = new THREE.DirectionalLight(0xffffff, 3);
        light.position.set(3, 5, 4);
        scene.add(light);
        scene.add(gltf.scene);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const camera = new THREE.PerspectiveCamera(32, 400 / 450, 0.01, 100);
        camera.position
          .copy(center)
          .add(
            new THREE.Vector3(0.1, 0.1, Math.max(size.x, size.y, size.z) * 2.6),
          );
        camera.lookAt(center);
        renderer.setViewport(index * 400, 0, 400, 450);
        renderer.setScissor(index * 400, 0, 400, 450);
        renderer.render(scene, camera);
        const meshes = [];
        gltf.scene.traverse((mesh) => {
          if (!mesh.isMesh) return;
          meshes.push({
            vertices: mesh.geometry.attributes.position.count,
            triangles:
              (mesh.geometry.index?.count ||
                mesh.geometry.attributes.position.count) / 3,
            textures: [
              mesh.material.map,
              mesh.material.roughnessMap,
              mesh.material.normalMap,
            ].map((texture) => ({
              width: texture.image.width,
              height: texture.image.height,
            })),
          });
        });
        results.push({
          meshes,
          bounds: { min: box.min.toArray(), max: box.max.toArray() },
        });
      }
      return { results, errors: [] };
    }, urls);
    assert.deepEqual(errors, [], "no browser GLTFLoader errors");
    assert.deepEqual(
      report.browser.results[0].bounds,
      report.browser.results[1].bounds,
    );
    assert.deepEqual(
      report.browser.results.map((r) => r.meshes.map((m) => m.triangles)),
      [[triangles], [triangles]],
    );
    await page.screenshot({
      path: path.join(folder, `${stem}-render-comparison.png`),
    });
  } finally {
    await browser?.close();
    await server.close();
  }
}
await writeFile(
  path.join(folder, `${stem}-report.json`),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
