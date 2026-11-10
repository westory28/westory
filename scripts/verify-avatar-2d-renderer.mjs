import assert from "node:assert/strict";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
const require = createRequire(import.meta.url);
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
const sharp = require("../functions/node_modules/sharp");
const images = {};
for (const color of ["red", "green", "blue"])
  images[color] = await sharp({
    create: { width: 32, height: 32, channels: 4, background: color },
  })
    .png()
    .toBuffer();
const orientationPixels = Buffer.alloc(32 * 32 * 4);
for (let y = 0; y < 32; y++)
  for (let x = 0; x < 32; x++)
    orientationPixels.set(
      [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [255, 255, 0, 255],
      ][(y >= 16 ? 2 : 0) + (x >= 16 ? 1 : 0)],
      (y * 32 + x) * 4,
    );
images.orientation = await sharp(orientationPixels, {
  raw: { width: 32, height: 32, channels: 4 },
})
  .png()
  .toBuffer();
const slots = Object.fromEntries(
  Object.entries({
    top: ["plain-top"],
    bottom: ["plain-bottom"],
    shoes: ["plain-shoes"],
    accessory: ["none", "hat"],
    hairStyle: ["bob", "curtain", "crop", "toben", "failure", "clipped"],
    faceShape: ["natural"],
    expression: ["natural"],
  }).map(([slot, values]) => [
    slot,
    Object.fromEntries(
      values.map((value) => [
        value,
        slot === "hairStyle"
          ? [
              {
                id: "hair",
                src: `${value === "crop" ? "green" : value === "toben" ? "blue" : value === "failure" ? "failure" : "red"}.png`,
                rect: [0.35, 0.1, 0.3, 0.25],
                z: 2,
                group: "hair",
                ...(value === "clipped" ? { clip: [0.38, 0, 0.24, 1] } : {}),
              },
            ]
          : [],
      ]),
    ),
  ]),
);
slots.accessory.hat = {
  layers: [],
  clipGroups: { hair: [0, 0.2, 1, 0.8] },
};
slots.top["plain-top"] = {
  layers: [
    { id: "default-top", src: "red.png", rect: [0.4, 0.4, 0.2, 0.45], z: 2 },
  ],
  hideIds: ["body"],
  hideSlots: ["bottom"],
  poses: {
    wave: {
      layers: [
        { id: "posed-top", src: "blue.png", rect: [0.3, 0.4, 0.4, 0.3], z: 2 },
      ],
      hideIds: ["body", "pose-hand"],
    },
    cheer: {
      layers: [
        { id: "posed-top", src: "blue.png", rect: [0.3, 0.4, 0.4, 0.3], z: 2 },
      ],
      hideIds: [],
      hideSlots: [],
    },
    think: {
      layers: [
        {
          id: "posed-top",
          src: "failure.png",
          rect: [0.3, 0.4, 0.4, 0.3],
          z: 2,
        },
      ],
    },
  },
};
slots.bottom["plain-bottom"] = [
  { id: "bottom", src: "blue.png", rect: [0.4, 0.75, 0.2, 0.05], z: 3 },
];
const art = {
  base: [
    { id: "body", src: "red.png", rect: [0.4, 0.4, 0.2, 0.45], z: 1 },
    {
      id: "orientation",
      src: "orientation.png",
      rect: [0.1, 0.1, 0.1, 0.1],
      z: 1,
      flipX: true,
      flipY: true,
    },
  ],
  groups: {
    head: { pivot: [0.5, 0.35] },
    hair: { parent: "head", pivot: [0.5, 0.35] },
  },
  slots,
  poses: {
    idle: {},
    wave: {
      transforms: { head: { rotation: 0.15 } },
      layers: [
        {
          id: "pose-hand",
          src: "red.png",
          rect: [0.75, 0.4, 0.05, 0.05],
          z: 3,
        },
      ],
    },
    cheer: {},
    think: {},
    heart: {},
    tilt: { transforms: { head: { rotation: -0.15 } } },
  },
};
const manifest = {
  version: 2,
  canvas: [512, 640],
  characters: { boy: art, girl: art },
  palettes: { skinTone: { original: null }, hairTone: { original: null } },
};
const server = await createServer({
  root: process.cwd(),
  server: { host: "127.0.0.1", port: 5191 },
  logLevel: "error",
});
await server.listen();
const origin = server.resolvedUrls.local[0];
let browser;
try {
  browser = await playwright.chromium.launch({
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "msedge",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 500, height: 700 } });
  const errors = [],
    requests = [];
  let delayGreen = false;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    if (url.origin !== new URL(origin).origin) return route.abort();
    if (url.pathname === "/__2d-test")
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><div id="stage" style="width:400px;height:500px"></div>',
      });
    if (url.pathname === "/art/manifest.json")
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(manifest),
      });
    if (url.pathname.startsWith("/art/")) {
      const color = url.pathname.slice(5, -4);
      if (color === "failure")
        return route.fulfill({ status: 503, body: "unavailable" });
      if (color === "green" && delayGreen)
        await new Promise((resolve) => setTimeout(resolve, 150));
      try {
        return await route.fulfill({
          contentType: "image/png",
          body: images[color],
        });
      } catch {
        return;
      }
    }
    return route.continue();
  });
  await page.goto(new URL("__2d-test", origin).href);
  assert.deepEqual(
    await page.evaluate(async (manifest) => {
      const { validateManifest, resolveArt } =
        await import("/src/features/avatar/renderer2d/manifest.ts");
      const { defaultAvatarLook } =
        await import("/src/features/avatar/catalog.ts");
      const valid = validateManifest(manifest);
      const look = defaultAvatarLook("boy");
      const ids = (pose) =>
        resolveArt(valid, { ...look, pose }).layers.map((layer) => layer.id);
      const robe = structuredClone(valid);
      robe.characters.boy.slots.top["plain-top"].hideIds = [];
      robe.characters.boy.slots.bottom["plain-bottom"] = {
        layers: [],
        hideIds: ["body"],
      };
      const robeKeepsAnkles = resolveArt(robe, look).layers.some(
        (layer) => layer.id === "body",
      );
      const rejects = [];
      for (const mutation of [
        (choice) => {
          choice.poses.unknown = { layers: [] };
        },
        (choice) => {
          choice.poses.wave.poses = {};
        },
        (choice) => {
          choice.poses.wave.layers[0].src = "../outside.png";
        },
        (choice) => {
          choice.poses.wave.hideIds = [42];
        },
        (choice) => {
          choice.poses.wave.layers = undefined;
        },
        (choice) => {
          choice.clipGroups = { missing: [0, 0, 1, 1] };
        },
        (choice) => {
          choice.poses.wave.clipGroups = { hair: [0, 0.8, 1, 0.8] };
        },
        (choice) => {
          choice.poses.wave.layers[0].clip = [-0.1, 0, 1, 1];
        },
        (choice) => {
          choice.poses.wave.layers[0].clip = [0, 0, 0, 1];
        },
      ]) {
        const invalid = structuredClone(manifest);
        mutation(invalid.characters.boy.slots.top["plain-top"]);
        try {
          validateManifest(invalid);
          rejects.push(false);
        } catch {
          rejects.push(true);
        }
      }
      return {
        idle: ids("idle"),
        wave: ids("wave"),
        cheer: ids("cheer"),
        robeKeepsAnkles,
        rejects,
      };
    }, manifest),
    {
      idle: ["orientation", "default-top", "hair"],
      wave: ["orientation", "posed-top", "hair"],
      cheer: ["body", "orientation", "posed-top", "hair", "bottom"],
      robeKeepsAnkles: true,
      rejects: [true, true, true, true, true, true, true, true, true],
    },
    "pose artwork replaces default layers, inherits or replaces hide rules, and rejects malformed variants",
  );
  await page.evaluate(async () => {
    window.webglRequests = 0;
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (String(type).startsWith("webgl")) window.webglRequests++;
      return original.call(this, type, ...args);
    };
    window.engine2d = await import("/src/features/avatar/renderer2d/engine.ts");
    window.stage2d = await window.engine2d.createAvatarStage(
      document.querySelector("#stage"),
      { character: "boy" },
      { assetBaseUrl: "/art/", deferPreparation: true },
    );
  });
  assert.deepEqual(
    await page.evaluate(() => ({
      loaded: window.stage2d.loaded,
      textures: window.stage2d.stats.textures,
    })),
    { loaded: false, textures: 0 },
    "deferred UI stage loads no stale outfit",
  );
  await page.evaluate(async () => {
    await window.stage2d.prepareLook({});
    window.stage2d.setLook({});
    window.saved = window.stage2d.capture();
    window.stage2d.focusFace();
  });
  assert(
    await page.evaluate(() => window.saved === window.stage2d.capture()),
    "zoom never changes saved full-body framing",
  );
  assert(
    await page.evaluate(() => window.saved !== window.stage2d.captureFrame()),
    "item preview retains requested face frame",
  );
  const alpha = await page.evaluate(async () => {
    const image = await createImageBitmap(
      await (await fetch(window.saved)).blob(),
    );
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const pixel = Array.from(ctx.getImageData(0, 0, 1, 1).data);
    image.close();
    return pixel;
  });
  assert.equal(alpha[3], 0, "capture background transparent");
  assert.deepEqual(
    await page.evaluate(async () => {
      const image = await createImageBitmap(
        await (await fetch(window.saved)).blob(),
      );
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const pixels = [
        [0.125, 0.125],
        [0.175, 0.125],
        [0.125, 0.175],
        [0.175, 0.175],
      ].map(([x, y]) =>
        Array.from(
          ctx.getImageData(
            Math.round(x * image.width),
            Math.round(y * image.height),
            1,
            1,
          ).data,
        ),
      );
      image.close();
      return pixels;
    }),
    [
      [255, 255, 0, 255],
      [0, 0, 255, 255],
      [0, 255, 0, 255],
      [255, 0, 0, 255],
    ],
    "hand source orientation flips within its authored rectangle",
  );
  assert(
    !requests.includes("/art/blue.png"),
    "idle does not fetch unused pose artwork or hidden bottoms",
  );
  assert.equal(
    await page.evaluate(
      () => window.stage2d.setPose("wave").requiresPreparation,
    ),
    true,
    "new pose cannot display until its complete artwork is ready",
  );
  assert.deepEqual(
    await page.evaluate(async () => {
      await window.stage2d.prepareLook({ pose: "wave" });
      const applied = window.stage2d.setPose("wave").applied;
      const image = await createImageBitmap(
        await (await fetch(window.stage2d.capture())).blob(),
      );
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const pixels = [
        [0.5, 0.5],
        [0.5, 0.8],
        [0.775, 0.425],
      ].map(([x, y]) =>
        Array.from(
          ctx.getImageData(
            Math.round(x * image.width),
            Math.round(y * image.height),
            1,
            1,
          ).data,
        ),
      );
      image.close();
      window.posedCapture = window.stage2d.capture();
      let failure;
      try {
        await window.stage2d.prepareLook({ pose: "think" });
        failure = false;
      } catch {
        failure = true;
      }
      return {
        applied,
        pixels,
        failure,
        unchanged: window.stage2d.capture() === window.posedCapture,
        unavailable: window.stage2d.setPose("think").requiresPreparation,
      };
    }),
    {
      applied: true,
      pixels: [
        [0, 0, 255, 255],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      failure: true,
      unchanged: true,
      unavailable: true,
    },
    "pose-specific garment is drawn without idle body, bottom or generic hands; failed pose art preserves the last ready frame",
  );
  assert.equal(
    await page.evaluate(() => {
      window.stage2d.setPose("idle");
      return window.stage2d.capture() === window.saved;
    }),
    true,
    "returning to idle restores the original complete composition",
  );
  assert.deepEqual(
    await page.evaluate(async () => {
      const sample = async (points) => {
        const image = await createImageBitmap(
          await (await fetch(window.stage2d.capture())).blob(),
        );
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        const values = points.map(([x, y]) =>
          Array.from(
            ctx.getImageData(
              Math.round(x * image.width),
              Math.round(y * image.height),
              1,
              1,
            ).data,
          ),
        );
        image.close();
        return values;
      };
      window.stage2d.setLook({ accessory: "hat" });
      const idle = await sample([
        [0.5, 0.15],
        [0.5, 0.25],
        [0.5, 0.5],
      ]);
      window.stage2d.setLook({ pose: "tilt" });
      const rotateWithHead = ([x, y]) => {
        const dx = (x - 0.5) * 512,
          dy = (y - 0.35) * 640;
        const cosine = Math.cos(-0.15),
          sine = Math.sin(-0.15);
        return [
          0.5 + (dx * cosine - dy * sine) / 512,
          0.35 + (dx * sine + dy * cosine) / 640,
        ];
      };
      const tilted = await sample(
        [
          [0.6, 0.205],
          [0.4, 0.195],
        ].map(rotateWithHead),
      );
      window.stage2d.setLook({ pose: "idle", hairStyle: "clipped" });
      const intersected = await sample([
        [0.36, 0.25],
        [0.5, 0.15],
        [0.5, 0.25],
      ]);
      window.stage2d.setLook({ accessory: "none", hairStyle: "curtain" });
      return {
        idle,
        tilted,
        intersected,
        restored: window.stage2d.capture() === window.saved,
      };
    }),
    {
      idle: [
        [0, 0, 0, 0],
        [255, 0, 0, 255],
        [255, 0, 0, 255],
      ],
      tilted: [
        [255, 0, 0, 255],
        [0, 0, 0, 0],
      ],
      intersected: [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [255, 0, 0, 255],
      ],
      restored: true,
    },
    "hat clipping follows head tilt, intersects the hair's own clip, leaves clothes intact, and clears on removal",
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.stage2d.setLook({ hairStyle: "failure" }).requiresPreparation,
    ),
    true,
    "missing selected image cannot be saved",
  );
  assert.equal(
    await page.evaluate(async () => {
      try {
        await window.stage2d.prepareLook({ hairStyle: "failure" });
        return false;
      } catch {
        return true;
      }
    }),
    true,
    "asset failure rejects visibly",
  );
  delayGreen = true;
  assert.deepEqual(
    await page.evaluate(async () => {
      const first = window.stage2d.prepareLook({ hairStyle: "crop" }).then(
        () => "unexpected",
        (e) => e.name,
      );
      const second = window.stage2d.prepareLook({ hairStyle: "toben" });
      await second;
      const applied = window.stage2d.setLook({ hairStyle: "toben" });
      return { first: await first, applied: applied.applied };
    }),
    { first: "AbortError", applied: true },
    "new selection cancels old art without clobbering new state",
  );
  const disposal = await page.evaluate(async () => {
    const pending = window.stage2d.prepareLook({ hairStyle: "crop" }).then(
      () => "unexpected",
      (e) => e.name,
    );
    window.stage2d.dispose();
    return {
      result: await pending,
      canvas: document.querySelectorAll("canvas").length,
      textures: window.stage2d.stats.textures,
      loaded: window.stage2d.loaded,
    };
  });
  assert.deepEqual(
    disposal,
    { result: "AbortError", canvas: 0, textures: 0, loaded: false },
    "dispose cancels and frees images/canvas",
  );
  assert.equal(
    await page.evaluate(() => window.webglRequests),
    0,
    "no WebGL context",
  );
  assert(
    !requests.some((url) => /\.glb|three\.module/.test(url)),
    "no model or Three.js request",
  );
  assert.deepEqual(errors, [], "no uncaught render errors");
  console.log(
    "PASS 2D avatar: pose-specific garments and hide rules, headwear clipping through tilt/removal, malformed pose/clip rejection, unused-art requests, failed-pose recovery, deferred outfit, transparent capture, framed previews, rapid-selection cancellation, disposal and zero WebGL/models.",
  );
} finally {
  await browser?.close();
  await server.close();
}
