/** Authored placement of the existing artwork, in the 1024 x 1280 canvas.
 * These anchors are shared by catalog previews and both avatar studios.
 * Keep the source sheets intact; never stretch a robe's sleeves to its hem.
 */
export function applyAvatarProportions(spec) {
  const cell = (id) => spec.cells.find((entry) => entry.id === id);
  const set = (id, rect) => {
    cell(id).rect = rect;
  };
  set("head-natural", [0.295, 0.07, 0.41, 0.35]);
  set("head-round", [0.287, 0.066, 0.426, 0.35]);
  set("head-slim", [0.307, 0.075, 0.386, 0.35]);

  // Eye artwork and mouths have different source baselines. Separate them so
  // smaller eyes do not pull the mouth up toward the nose.
  const expressions = [
    "natural",
    "calm",
    "smile",
    "curious",
    "bright",
    "determined",
  ];
  spec.cells = spec.cells.filter(
    (entry) => !entry.id.startsWith("expression-"),
  );
  for (const [index, name] of expressions.entries()) {
    const col = index % 3,
      row = Math.floor(index / 3);
    const eyeY = row ? 90 : 170;
    const eyeH = row ? 240 : 215;
    // Source centers differ slightly across the six individually drawn cells.
    const centerX = [274, 260, 255, 277, 262, 257][index];
    const centerY = [322, 328, 325, 269, 269, 269][index];
    const sx = (0.475 * 0.7) / 512,
      sy = (0.38 * 0.7) / 512;
    spec.cells.push({
      id: `expression-${name}-eyes`,
      sheet: "face",
      crop: [col * 512, row * 512 + eyeY, 512, eyeH],
      rect: [
        0.5 - centerX * sx,
        0.264 - (centerY - eyeY) * sy,
        512 * sx,
        eyeH * sy,
      ],
      fit: "frame",
      z: 45,
      group: "features",
    });
    const mouthY = row ? 330 : 390;
    spec.cells.push({
      id: `expression-${name}-mouth`,
      sheet: "face",
      crop: [col * 512 + 180, row * 512 + mouthY, 180, 100],
      rect: [0.466, 0.323, 0.068, 0.044],
      fit: "bounds",
      z: 45,
      group: "features",
    });
  }

  const hairRects = {
    bob: [0.26, 0.04, 0.48, 0.33],
    curtain: [0.26, 0.04, 0.48, 0.3],
    volume: [0.25, 0.035, 0.5, 0.3],
    wave: [0.25, 0.035, 0.5, 0.35],
    long: [0.235, 0.035, 0.53, 0.43],
    crop: [0.274, 0.04, 0.452, 0.29],
    toben: [0.274, 0.035, 0.452, 0.3],
    "twin-tail": [0.18, 0.035, 0.64, 0.44],
    "half-up": [0.25, 0.025, 0.5, 0.41],
  };
  for (const [name, rect] of Object.entries(hairRects))
    set(`hair-${name}`, rect);
  set("glasses-round", [0.345, 0.238, 0.31, 0.09]);
  set("headphones", [0.245, 0.055, 0.51, 0.32]);
  set("star-clip", [0.62, 0.155, 0.085, 0.06]);

  // A compact silhouette: broader shoulders, relaxed short arms, and a common
  // waist/ankle line. Pose artwork stays whole, including its skin mask.
  for (const entry of spec.cells) {
    if (
      /^v3-(jacket|plain|polo|winter-hoodie|winter-halfzip)-(idle|wave|cheer|think|heart)$/.test(
        entry.id,
      )
    )
      entry.rect = [0.18, 0.296, 0.64, 0.4];
    if (/^v3-jeogori-(idle|wave|cheer|think|heart)$/.test(entry.id))
      entry.rect = [0.18, 0.285, 0.64, 0.445];
    if (/^v3-robe-(idle|wave|cheer|think|heart)$/.test(entry.id))
      entry.rect = [0.18, 0.27, 0.64, 0.512];
  }
  set("leg", [0.413, 0.584, 0.077, 0.26]);
  set("v3-trousers", [0.377, 0.584, 0.246, 0.252]);
  set("v3-pleated", [0.318, 0.58, 0.364, 0.177]);
  set("v3-chima", [0.227, 0.58, 0.546, 0.265]);
  set("v3-baji", [0.295, 0.58, 0.41, 0.265]);
  set("v3-shorts", [0.37, 0.58, 0.26, 0.147]);
  set("v3-winter-joggers", [0.357, 0.58, 0.286, 0.265]);
  for (const entry of spec.cells.filter((entry) => entry.sheet === "v3-shoes"))
    entry.rect = [0.367, 0.811, 0.266, 0.082];
  for (const art of Object.values(spec.characters)) {
    art.groups.headwear = { parent: "head", pivot: [0.5, 0.38] };
    art.groups.features = { parent: "head", pivot: [0.5, 0.38] };
    for (const [name, width] of [
      ["natural", 0.41],
      ["round", 0.426],
      ["slim", 0.386],
    ]) {
      const scale = width / 0.41;
      art.slots.faceShape[name] = {
        layers: [`head-${name}`],
        transforms: {
          hair: { scale: [scale, 1] },
          headwear: { scale: [scale, 1] },
          features: { scale: [scale, 1] },
        },
      };
    }
    for (const name of expressions)
      art.slots.expression[name] = [
        `expression-${name}-eyes`,
        `expression-${name}-mouth`,
      ];
    // The shorter robe is worn over trousers; a bare calf must not replace the
    // lower garment just because its selection is hidden by the robe.
    for (const [name, choice] of Object.entries(art.slots.top)) {
      if (!name.startsWith("official-")) continue;
      const trousers = { ref: "v3-plain-bottom", id: "robe-trousers", z: 18 };
      choice.layers.unshift(trousers);
      choice.hideIds = ["leg", "right-leg"];
      for (const pose of Object.values(choice.poses))
        pose.layers.unshift(trousers);
    }
  }
  for (const entry of spec.cells.filter((entry) =>
    ["accessories", "headphones-worn"].includes(entry.sheet),
  ))
    entry.group = "headwear";
}
