/**
 * Renders the Yut board (carved stone pads, engraved numbers, wooden rim) to
 * public/assets/weplay/yut/board.webp. The pads stand exactly where YutBoard
 * places its nodes; run this again only when that geometry or the art changes.
 *
 *   node scripts/generate-yut-board.mjs [samples=160] [outfile]
 *
 * Procedural stone and lettering plus the existing materials.webp wood. No
 * network, account or watermark is involved.
 */
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    process.env.PLAYWRIGHT_MODULE_PATH ||
      path.join(
        os.homedir(),
        ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
      ),
  );
}
const samples = Number(process.argv[2]) || 160;
const outfile = path.resolve(
  root,
  process.argv[3] || "public/assets/weplay/yut/board.webp",
);

const scene = `
import * as THREE from "three";
// YutBoard's 720 x 560 view, shown at 5:2. One world unit is one step of the
// board along x (58 view units) and along the ground (40 view units).
const VIEW = { x: -20, y: -6, width: 760, height: 566 }, SQUASH = (720 / 560) / 2.5, SCALE = 2.6;
const WIDTH = Math.round(VIEW.width * SCALE), HEIGHT = Math.round(VIEW.height * SQUASH * SCALE);
const ELEVATION = Math.asin((40 * SQUASH) / 58);
const PAD = 0.79, CORNER = 0.86;
let seed = 20261125;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const canvas = (size, height = size) => { const c = document.createElement("canvas"); c.width = size; c.height = height; return c; };
const hex = (value) => [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16));
const mix = (a, b, t) => a.map((value, index) => value + (b[index] - value) * t);

// Smooth value noise on a wrapped lattice, summed over octaves.
function noiseField(size, cells, octaves) {
  const field = new Float32Array(size * size);
  for (let octave = 0, weight = 1; octave < octaves; octave += 1, weight *= 0.55) {
    const n = cells << octave, lattice = Float32Array.from({ length: n * n }, () => random() * 2 - 1);
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const fx = (x / size) * n, fy = (y / size) * n, ix = Math.floor(fx), iy = Math.floor(fy);
      const sx = (fx - ix) ** 2 * (3 - 2 * (fx - ix)), sy = (fy - iy) ** 2 * (3 - 2 * (fy - iy));
      const at = (a, b) => lattice[((b % n) * n) + (a % n)];
      const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx, low = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
      field[y * size + x] += (top + (low - top) * sy) * weight;
    }
  }
  return field;
}
const SIZE = 512;
const coarse = noiseField(SIZE, 4, 4), fine = noiseField(SIZE, 24, 3);
/** A weathered stone face. shape(x, y) is 0 at the centre and 1 on its edge. */
function stone(base, shape, variant, wear = 1) {
  const c = canvas(SIZE), context = c.getContext("2d"), image = context.createImageData(SIZE, SIZE);
  const rgb = hex(base), pale = mix(rgb, [246, 236, 206], 0.42), deep = mix(rgb, [36, 34, 24], 0.5), moss = [86, 96, 52];
  const ox = (variant * 137) % SIZE, oy = (variant * 211) % SIZE;
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
    const at = ((y + oy) % SIZE) * SIZE + ((x + ox) % SIZE), a = coarse[at], b = fine[at];
    let color = mix(rgb, a > 0 ? pale : deep, Math.min(0.5, Math.abs(a) * 0.3));
    color = mix(color, b > 0 ? pale : deep, Math.min(0.5, Math.abs(b) * 0.44));
    const edge = shape((x + 0.5) / SIZE * 2 - 1, (y + 0.5) / SIZE * 2 - 1);
    if (edge > 0.86) color = mix(color, pale, Math.min(1, (edge - 0.86) * 5) * 0.5 * wear);
    const damp = Math.max(0, edge - 0.55) * Math.max(0, a + 0.1);
    color = mix(color, moss, Math.min(0.45, damp * 1.1) * wear);
    const grit = ((x * 7919 + y * 104729 + variant * 31) % 997) / 997;
    if (grit > 0.985) color = mix(color, pale, 0.5);
    if (grit < 0.02) color = mix(color, deep, 0.55);
    const p = (y * SIZE + x) * 4;
    image.data[p] = color[0]; image.data[p + 1] = color[1]; image.data[p + 2] = color[2]; image.data[p + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  // Hairline cracks: a dark cut with a lit lower lip.
  for (let crack = 0; crack < 2 + (variant % 3); crack += 1) {
    let x = random() * SIZE, y = random() * SIZE, angle = random() * Math.PI * 2;
    const points = [[x, y]];
    for (let step = 0; step < 7 + random() * 8; step += 1) { angle += (random() - 0.5) * 1.1; x += Math.cos(angle) * 16; y += Math.sin(angle) * 22; points.push([x, y]); }
    for (const [dy, style, width] of [[3, "rgba(255,244,212,.28)", 1.6], [0, "rgba(30,26,16,.5)", 1.8]]) {
      context.beginPath(); points.forEach(([px, py], index) => context[index ? "lineTo" : "moveTo"](px, py + dy));
      context.strokeStyle = style; context.lineWidth = width; context.stroke();
    }
  }
  return { c, context };
}
/** Cuts a figure into the stone and fills it with gold leaf, lit from upper left. */
function engrave(context, draw, { gold = "#f3bd6c", deep = "#160e06", cut = 6 } = {}) {
  const layer = (style, dx, dy, blur = 0) => {
    const c = canvas(SIZE), g = c.getContext("2d");
    g.fillStyle = g.strokeStyle = style; g.translate(dx, dy); draw(g);
    context.save(); if (blur) context.filter = "blur(" + blur + "px)"; context.drawImage(c, 0, 0); context.restore();
    return c;
  };
  layer("rgba(255,240,204,.85)", cut * 0.5, cut * 1.1, 1);
  layer(deep, -cut * 0.4, -cut * 0.8, 1.2); layer(deep, 0, 0);
  const face = canvas(SIZE), g = face.getContext("2d");
  g.fillStyle = g.strokeStyle = gold; draw(g);
  // Leaf: brighter toward the lit lower side, worn specks inside the cut.
  g.globalCompositeOperation = "source-atop";
  const leaf = g.createLinearGradient(0, SIZE * 0.2, 0, SIZE * 0.8);
  leaf.addColorStop(0, "rgba(120,66,10,.5)"); leaf.addColorStop(0.45, "rgba(255,206,96,.1)"); leaf.addColorStop(1, "rgba(255,232,150,.5)");
  g.fillStyle = leaf; g.fillRect(0, 0, SIZE, SIZE);
  for (let speck = 0; speck < 240; speck += 1) { g.fillStyle = random() < 0.5 ? "rgba(84,54,16,.3)" : "rgba(255,246,206,.34)"; g.fillRect(random() * SIZE, random() * SIZE, 2 + random() * 5, 1 + random() * 3); }
  // The lip of the cut shades the leaf along its upper left.
  const lip = canvas(SIZE), l = lip.getContext("2d");
  l.fillStyle = "#2a1605"; l.fillRect(0, 0, SIZE, SIZE); l.globalCompositeOperation = "destination-out";
  l.fillStyle = l.strokeStyle = "#000"; l.save(); l.translate(cut * 0.55, cut * 1.15); draw(l); l.restore();
  g.save(); g.filter = "blur(" + cut * 0.42 + "px)"; g.globalAlpha = 0.85; g.drawImage(lip, 0, 0); g.restore();
  context.drawImage(face, 0, 0);
}
const diamondPath = (g, half) => { const c = SIZE / 2, r = half * c; g.beginPath(); g.moveTo(c, c - r); g.lineTo(c + r, c); g.lineTo(c, c + r); g.lineTo(c - r, c); g.closePath(); };
// Lettering lies on the pad, stretched like road paint so the low camera reads it upright.
const letter = (text, size, weight = 900) => (g) => {
  g.save(); g.translate(SIZE / 2, SIZE / 2); g.scale(1, 2.28);
  g.font = weight + " " + size + "px 'Noto Serif KR'"; g.textAlign = "center"; g.textBaseline = "alphabetic";
  const box = g.measureText(text), lift = (box.actualBoundingBoxAscent - box.actualBoundingBoxDescent) / 2;
  g.fillText(text, 0, lift); g.restore();
};
const texture = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
const ZONES = [["#72957a", "#22443a"], ["#8193a6", "#283b54"], ["#b87354", "#5e261c"], ["#c99a56", "#5c3814"]];

const world = new THREE.Scene();
const solid = (color, map) => new THREE.MeshStandardMaterial({ color, map: map || null, roughness: 0.92, metalness: 0 });
function add(geometry, material, x, y, z, rotation = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z); mesh.rotation.y = rotation; mesh.castShadow = mesh.receiveShadow = true; world.add(mesh);
  return mesh;
}
const roundedDiamond = (half, radius) => {
  const shape = new THREE.Shape(), r = radius;
  const corners = [[half, 0], [0, half], [-half, 0], [0, -half]];
  corners.forEach(([x, y], index) => {
    const [px, py] = corners[(index + 3) % 4], [nx, ny] = corners[(index + 1) % 4];
    const from = [x + (px - x) / half * r, y + (py - y) / half * r], to = [x + (nx - x) / half * r, y + (ny - y) / half * r];
    if (!index) shape.moveTo(...from); else shape.lineTo(...from);
    shape.quadraticCurveTo(x, y, ...to);
  });
  shape.closePath();
  return shape;
};
/** An upright prism: the shape on the ground, its top face at height 0. */
function prism(shape, depth, bevel, segments = 3) {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: depth - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: segments, curveSegments: 40 });
  geometry.rotateX(Math.PI / 2); geometry.translate(0, -bevel, 0);
  return geometry;
}
/** A flat face laid just over a prism, textured across [-half, half]. */
function plate(shape, half, lift) {
  const geometry = new THREE.ShapeGeometry(shape, 40);
  const at = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
  for (let i = 0; i < at.count; i += 1) uv.setXY(i, at.getX(i) / half / 2 + 0.5, at.getY(i) / half / 2 + 0.5);
  geometry.rotateX(-Math.PI / 2); geometry.translate(0, lift, 0);
  return geometry;
}
const sideStone = (color) => {
  const { c } = stone(color, () => 0, Math.floor(random() * 90), 0), t = texture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(0.6, 0.6);
  return t;
};
function outerPad(number) {
  const side = Math.floor((number - 1) / 5), step = ((number - 1) % 5) + 1;
  const starts = [[0, 5], [5, 0], [0, -5], [-5, 0]], ends = [[5, 0], [0, -5], [-5, 0], [0, 5]];
  const x = starts[side][0] + (ends[side][0] - starts[side][0]) * step / 5, z = starts[side][1] + (ends[side][1] - starts[side][1]) * step / 5;
  const corner = step === 5, half = corner ? CORNER : PAD, [face, deep] = ZONES[side];
  // A darker plinth carries the dressed slab, so the pad reads as two courses.
  add(prism(roundedDiamond(half, 0.05), 0.12, 0.02), solid("#ffffff", sideStone(deep)), x, -0.075, z);
  add(prism(roundedDiamond(half - 0.03, 0.06), 0.1, 0.034, 4), solid("#ffffff", sideStone(face)), x, 0, z);
  const top = half - 0.062, shape = (px, py) => Math.abs(px) + Math.abs(py);
  const { c, context } = stone(face, shape, number);
  const well = (at, shade) => {
    context.save(); diamondPath(context, at); context.clip();
    context.drawImage(stone(deep, (px, py) => shape(px, py) / at, number + 40, 0.3).c, 0, 0);
    const light = context.createLinearGradient(0, SIZE * 0.1, 0, SIZE * 0.9);
    light.addColorStop(0, 'rgba(10,8,5,' + shade + ')'); light.addColorStop(0.45, 'rgba(10,8,5,.08)'); light.addColorStop(1, 'rgba(255,232,180,.2)');
    context.fillStyle = light; context.fillRect(0, 0, SIZE, SIZE); context.restore();
  };
  const line = (at, width) => engrave(context, (g) => { diamondPath(g, at); g.lineWidth = width; g.stroke(); }, { cut: 2.4, gold: "#dca452" });
  if (corner) {
    // Corner pads: a lacquered well inside a double gold frame.
    well(0.8, 0.6);
    line(0.9, 7); line(0.78, 5);
    engrave(context, (g) => {
      // A palmette in each point of the frame.
      for (let turn = 0; turn < 4; turn += 1) {
        g.save(); g.translate(SIZE / 2, SIZE / 2); g.rotate(turn * Math.PI / 2); g.translate(0, -SIZE * 0.325);
        for (const lean of [-0.62, 0, 0.62]) { g.save(); g.rotate(lean); g.beginPath(); g.ellipse(0, -13, 5, 15, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
        g.restore();
      }
    }, { cut: 2, gold: "#dca452" });
    engrave(context, letter(number === 20 ? "始" : String(number), number === 20 ? 118 : 138), { cut: 4 });
  } else {
    well(0.76, 0.45); line(0.78, 6);
    engrave(context, letter(String(number), 134), { cut: 4.4 });
  }
  add(plate(roundedDiamond(top, 0.05), top, 0.003), solid("#ffffff", texture(c)), x, 0, z);
}
for (let number = 1; number <= 20; number += 1) outerPad(number);

const disc = (radius) => { const s = new THREE.Shape(); s.absarc(0, 0, radius, 0, Math.PI * 2); return s; };
function innerPad(x, z, center, variant) {
  const radius = center ? 0.66 : 0.37, shape = (px, py) => Math.hypot(px, py);
  add(prism(disc(radius), 0.12, 0.02), solid("#ffffff", sideStone("#5f4a30")), x, -0.06, z);
  add(prism(disc(radius - 0.03), 0.08, 0.03, 4), solid("#ffffff", sideStone("#cbb787")), x, 0, z);
  const { c, context } = stone("#d0bd8c", shape, variant + 60);
  const ring = (at, width) => engrave(context, (g) => { g.beginPath(); g.arc(SIZE / 2, SIZE / 2, at * SIZE / 2, 0, Math.PI * 2); g.lineWidth = width; g.stroke(); }, { cut: center ? 2.4 : 3.4, gold: "#dca452" });
  ring(0.86, center ? 8 : 13);
  context.save(); context.beginPath(); context.arc(SIZE / 2, SIZE / 2, SIZE * 0.36, 0, Math.PI * 2); context.clip();
  context.drawImage(stone(center ? "#5c281b" : "#54401f", (px, py) => Math.hypot(px, py) / 0.72, variant + 90, 0.3).c, 0, 0); context.restore();
  ring(0.73, center ? 6 : 9);
  // Lotus: petals around a seed head.
  engrave(context, (g) => {
    const petals = center ? 8 : 6, reach = center ? SIZE * 0.2 : SIZE * 0.19;
    for (let petal = 0; petal < petals; petal += 1) {
      g.save(); g.translate(SIZE / 2, SIZE / 2); g.rotate(petal / petals * Math.PI * 2); g.translate(0, -reach);
      g.beginPath(); g.moveTo(0, -SIZE * 0.115); g.quadraticCurveTo(SIZE * 0.085, 0, 0, SIZE * 0.105); g.quadraticCurveTo(-SIZE * 0.085, 0, 0, -SIZE * 0.115); g.fill(); g.restore();
    }
    g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE * 0.06, 0, Math.PI * 2); g.fill();
  }, { cut: center ? 3 : 4, gold: "#f3bd6c", deep: "#160e06" });
  add(plate(disc(radius - 0.06), radius - 0.06, 0.003), solid("#ffffff", texture(c)), x, 0, z);
}
innerPad(0, 0, true, 1);
for (const [index, at] of [10 / 3, 5 / 3, -5 / 3, -10 / 3].entries()) { innerPad(at, 0, false, index); innerPad(0, at, false, index + 8); }

async function wood() {
  const atlas = new Image(); atlas.src = "/assets/weplay/yut/materials.webp"; await atlas.decode();
  const c = canvas(512), g = c.getContext("2d");
  g.drawImage(atlas, 0, 0, atlas.width / 2, atlas.height / 2, 0, 0, 512, 512);
  g.globalCompositeOperation = "saturation"; g.fillStyle = "rgba(128,128,128,.38)"; g.fillRect(0, 0, 512, 512);
  g.globalCompositeOperation = "screen"; g.fillStyle = "rgba(150,118,76,.34)"; g.fillRect(0, 0, 512, 512); g.globalCompositeOperation = "source-over";
  const t = texture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function rim(woodMap) {
  // Four mitred planks with the grain along each side.
  const outer = 6.0, inner = 3.96;
  for (let side = 0; side < 4; side += 1) {
    const shape = new THREE.Shape(), long = outer * Math.SQRT1_2, short = inner * Math.SQRT1_2;
    shape.moveTo(-long, long); shape.lineTo(long, long); shape.lineTo(short, short); shape.lineTo(-short, short); shape.closePath();
    const geometry = prism(shape, 0.3, 0.035, 3), uv = geometry.getAttribute("uv"), at = geometry.getAttribute("position");
    for (let i = 0; i < at.count; i += 1) uv.setXY(i, at.getZ(i) * 0.3 + side * 0.37 + at.getY(i) * 0.4, at.getX(i) * 0.16 + side * 0.21);
    add(geometry, solid("#ffffff", woodMap), 0, -0.16, 0, Math.PI / 4 + side * Math.PI / 2);
  }
  const band = (from, to, y) => {
    const shape = roundedDiamond(to, 0.02), hole = new THREE.Path();
    hole.moveTo(from, 0); hole.lineTo(0, from); hole.lineTo(-from, 0); hole.lineTo(0, -from); hole.closePath(); shape.holes.push(hole);
    add(prism(shape, 0.02, 0.004), solid("#c69d4e"), 0, y, 0);
  };
  band(5.8, 5.85, -0.152); band(4.1, 4.15, -0.152);
  // Crossing beams under the inner pads.
  for (const rotation of [0, Math.PI / 2]) {
    const beam = new THREE.Shape(); beam.moveTo(-4.1, -0.12); beam.lineTo(4.1, -0.12); beam.lineTo(4.1, 0.12); beam.lineTo(-4.1, 0.12); beam.closePath();
    const geometry = prism(beam, 0.16, 0.02), uv = geometry.getAttribute("uv"), at = geometry.getAttribute("position");
    for (let i = 0; i < at.count; i += 1) uv.setXY(i, at.getZ(i) * 0.5 + at.getY(i), at.getX(i) * 0.18);
    add(geometry, solid("#e2c79c", woodMap), 0, -0.16, 0, rotation);
    const line = new THREE.Shape(); line.moveTo(-4, -0.026); line.lineTo(4, -0.026); line.lineTo(4, 0.026); line.lineTo(-4, 0.026); line.closePath();
    add(prism(line, 0.02, 0.004), solid("#d8b25e"), 0, -0.15, 0, rotation);
  }
}
window.render = async (count) => {
  await document.fonts.load("900 100px 'Noto Serif KR'", "0123456789始"); await document.fonts.ready;
  rim(await wood());
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(WIDTH, HEIGHT, false); renderer.setClearColor(0, 0);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, { type: THREE.FloatType, samples: 0 });
  const unit = 58, camera = new THREE.OrthographicCamera(-(360 - VIEW.x) / unit, (VIEW.x + VIEW.width - 360) / unit, (255 - VIEW.y) * SQUASH / unit, -(VIEW.y + VIEW.height - 255) * SQUASH / unit, 0.1, 60);
  camera.position.set(0, 20 * Math.sin(ELEVATION), 20 * Math.cos(ELEVATION)); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const lamp = (color) => { const light = new THREE.DirectionalLight(color, 1); light.castShadow = true; light.shadow.mapSize.set(2048, 2048); Object.assign(light.shadow.camera, { left: -7.5, right: 7.5, top: 7.5, bottom: -7.5, near: 1, far: 50 }); light.shadow.bias = -0.0006; light.shadow.normalBias = 0.012; world.add(light); return light; };
  const sun = lamp(0xffdfae), sky = lamp(0xf0e8da);
  const sum = new Float32Array(WIDTH * HEIGHT * 4), frame = new Float32Array(WIDTH * HEIGHT * 4);
  const halton = (index, base) => { let f = 1, r = 0; for (let i = index; i > 0; i = Math.floor(i / base)) { f /= base; r += f * (i % base); } return r; };
  for (let index = 1; index <= count; index += 1) {
    const a = halton(index, 2), b = halton(index, 3), c = halton(index, 5), d = halton(index, 7);
    camera.setViewOffset(WIDTH, HEIGHT, a - 0.5, b - 0.5, WIDTH, HEIGHT);
    sun.position.set(-11 + (c - 0.5) * 2.6, 17, 9 + (d - 0.5) * 2.6); sun.intensity = 3;
    const turn = halton(index, 11) * Math.PI * 2, reach = Math.sqrt(halton(index, 13)), up = Math.sqrt(1 - reach * reach);
    sky.position.set(Math.cos(turn) * reach * 22, Math.max(1.4, up * 22), Math.sin(turn) * reach * 22); sky.intensity = 1.75 * (0.55 + 0.45 * up);
    renderer.setRenderTarget(target); renderer.clear(); renderer.render(world, camera);
    renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, frame);
    for (let i = 0; i < sum.length; i += 1) sum[i] += frame[i];
  }
  const out = canvas(WIDTH, HEIGHT), g = out.getContext("2d"), image = g.createImageData(WIDTH, HEIGHT);
  const film = (v) => { const x = v * 0.92; return Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)); };
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    const s = ((HEIGHT - 1 - y) * WIDTH + x) * 4, p = (y * WIDTH + x) * 4, alpha = sum[s + 3] / count;
    if (alpha <= 0) continue;
    const rgb = [0, 1, 2].map((k) => film(sum[s + k] / count / alpha));
    const grey = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11;
    rgb.forEach((v, k) => { const vivid = Math.max(0, grey + (v - grey) * 1.1); image.data[p + k] = 255 * (vivid <= 0.0031308 ? vivid * 12.92 : 1.055 * vivid ** (1 / 2.4) - 0.055); });
    image.data[p + 3] = 255 * Math.min(1, alpha);
  }
  g.putImageData(image, 0, 0);
  return { webp: out.toDataURL("image/webp", 0.9), png: out.toDataURL("image/png"), width: WIDTH, height: HEIGHT, view: VIEW };
};
`;
const bundle = await build({
  stdin: { contents: scene, loader: "js", resolveDir: root },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
});
const server = http.createServer(async (request, response) => {
  const { pathname } = new URL(request.url, "http://127.0.0.1");
  if (pathname.startsWith("/assets/")) {
    const file = path.resolve(root, "public", "." + pathname);
    if (file.startsWith(path.join(root, "public") + path.sep))
      return response.end(await fs.readFile(file));
  }
  if (pathname === "/main.js") {
    response.setHeader("Content-Type", "text/javascript");
    return response.end(bundle.outputFiles[0].text);
  }
  response.setHeader("Content-Type", "text/html");
  response.end(
    '<!doctype html><meta charset="utf-8"><script src="/main.js"></script>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await playwright.chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error(error));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  page.setDefaultTimeout(0);
  const result = await page.evaluate((count) => window.render(count), samples);
  const bytes = (url) => Buffer.from(url.split(",")[1], "base64");
  await fs.mkdir(path.dirname(outfile), { recursive: true });
  await fs.writeFile(
    outfile,
    bytes(outfile.endsWith(".png") ? result.png : result.webp),
  );
  console.log(
    JSON.stringify({
      outfile,
      width: result.width,
      height: result.height,
      view: result.view,
      bytes: (await fs.stat(outfile)).size,
    }),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
