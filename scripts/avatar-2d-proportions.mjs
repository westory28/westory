/** Authored placement of the existing artwork, in the 1024 x 1280 canvas.
 * These anchors are shared by catalog previews and both avatar studios.
 * Keep the source sheets intact; never stretch a robe's sleeves to its hem.
 */
export function applyAvatarProportions(spec) {
  const cell = (id) => spec.cells.find((entry) => entry.id === id);
  const set = (id, rect) => {
    cell(id).rect = rect;
  };
  set("head-natural", [0.3425, 0.14, 0.315, 0.25]);
  set("head-round", [0.336, 0.14, 0.328, 0.25]);
  set("head-slim", [0.349, 0.14, 0.302, 0.25]);
  for (const [index, name] of ["natural", "round", "slim"].entries()) {
    const head = cell(`head-${name}`);
    head.sheet = "heads";
    head.cell = [index, 0];
    delete head.crop;
  }
  for (const id of ["head-natural", "head-round", "head-slim", "leg"]) {
    Object.assign(cell(id), {
      normalizeSkin: {
        color: "#f3c6a5",
        contrast: 0.35,
        minShade: 0.84,
        maxShade: 1.06,
      },
      tint: { slot: "skinTone", sourceColor: "#f3c6a5", mode: "color" },
      tintMask: { includeSkin: true },
    });
  }

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
    const eyeY = 140;
    const eyeH = 205;
    // Source centers differ slightly across the six individually drawn cells.
    const centerX = 256;
    const centerY = row ? 270 : 300;
    const sx = 0.27 / 512,
      sy = 0.22 / 512;
    spec.cells.push({
      id: `expression-${name}-eyes`,
      sheet: "face",
      crop: [col * 512, row * 512 + eyeY, 512, eyeH],
      rect: [
        0.5 - centerX * sx,
        0.278 - (centerY - eyeY) * sy,
        512 * sx,
        eyeH * sy,
      ],
      fit: "frame",
      z: 45,
      group: "features",
    });
    const mouthY = 345;
    spec.cells.push({
      id: `expression-${name}-mouth`,
      sheet: "face",
      crop: [col * 512 + 180, row * 512 + mouthY, 180, 100],
      rect: [0.4775, 0.345, 0.045, 0.027],
      fit: "bounds",
      z: 45,
      group: "features",
    });
  }

  const hairRects = {
    bob: [0.31, 0.085, 0.38, 0.3],
    curtain: [0.31, 0.095, 0.38, 0.235],
    volume: [0.3, 0.095, 0.4, 0.235],
    wave: [0.3, 0.085, 0.4, 0.26],
    long: [0.29, 0.09, 0.42, 0.36],
    crop: [0.315, 0.1, 0.37, 0.225],
    toben: [0.31, 0.095, 0.38, 0.235],
    "twin-tail": [0.24, 0.09, 0.52, 0.37],
    "half-up": [0.3, 0.075, 0.4, 0.36],
  };
  for (const [index, [name, rect]] of Object.entries(hairRects).entries()) {
    set(`hair-${name}`, rect);
    const hair = cell(`hair-${name}`);
    hair.crop = [(index % 3) * 512, Math.floor(index / 3) * 341, 512, 341];
    delete hair.cell;
    delete hair.sideTuck;
    hair.tint.sourceColor = "#494548";
  }
  cell("hair-crop").crop = [1024, 341, 512, 315];
  cell("hair-half-up").crop = [1024, 650, 512, 374];
  cell("hair-bob").sideTuck = [0.68, 0.96, 0.85];
  set("glasses-round", [0.38, 0.254, 0.24, 0.075]);
  set("headphones", [0.345, 0.11, 0.31, 0.22]);
  set("star-clip", [0.6, 0.2, 0.068, 0.05]);
  set("official-samo", [0.29, 0.065, 0.42, 0.16]);
  set("official-gat", [0.285, 0.06, 0.43, 0.18]);

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
  set("leg", [0.397, 0.584, 0.096, 0.27]);
  set("v3-trousers", [0.377, 0.584, 0.246, 0.252]);
  set("v3-pleated", [0.318, 0.58, 0.364, 0.177]);
  set("v3-chima", [0.227, 0.58, 0.546, 0.265]);
  set("v3-baji", [0.295, 0.58, 0.41, 0.265]);
  set("v3-shorts", [0.37, 0.58, 0.26, 0.147]);
  set("v3-winter-joggers", [0.357, 0.58, 0.286, 0.265]);
  // Keep the ankle anchors while taking excess volume out of the hips.
  for (const [name, waistScale] of [
    ["trousers", 0.86],
    ["winter-joggers", 0.82],
    ["shorts", 0.94],
    ["baji", 0.84],
  ])
    cell(`v3-${name}`).rowScale = [waistScale, 1];
  for (const entry of spec.cells.filter(
    (entry) => entry.sheet === "v3-shoes",
  )) {
    entry.rect = [0.367, 0.805, 0.266, 0.119];
    entry.fit = "bounds";
  }
  for (const art of Object.values(spec.characters)) {
    art.groups.headwear = { parent: "head", pivot: [0.5, 0.38] };
    art.groups.features = { parent: "head", pivot: [0.5, 0.38] };
    for (const [name, width] of [
      ["natural", 0.315],
      ["round", 0.328],
      ["slim", 0.302],
    ]) {
      const scale = width / 0.315;
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
