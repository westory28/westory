import type { PixelPen } from "./details";
import type { PixelPalette } from "./wardrobe";

type Point = readonly [number, number];
const mix = (a: string, b: string, ratio = 0.5) =>
  "#" +
  [1, 3, 5]
    .map((i) =>
      Math.round(
        parseInt(a.slice(i, i + 2), 16) * (1 - ratio) +
          parseInt(b.slice(i, i + 2), 16) * ratio,
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

/** Signature ash/chocolate bases; the existing dye choices remain available. */
export function royalHairPalette(
  style: string,
  tone: string,
  fallback: PixelPalette,
): PixelPalette {
  if (tone !== "mm-ink") return fallback;
  if (style === "mm-royal-ash")
    return ["#efded2", "#bdabb2", "#918292", "#514958"];
  if (style === "mm-royal-choco-bob")
    return ["#bf9291", "#7e5b65", "#503946", "#2e2634"];
  return fallback;
}

/** Independently shaped rounded cuts, fitted to the invariant head/neck anchors. */
export function drawRoyalHair(
  p: PixelPen,
  style: string,
  hair: PixelPalette,
  front: boolean,
) {
  const { poly, line, rect } = p;
  const ash = style === "mm-royal-ash";
  const [shine, light, body, deep] = hair;
  const ink = "#292535",
    shade = mix(body, deep),
    middle = mix(body, light),
    glow = mix(light, shine);
  const curve = (points: readonly Point[], color: string, width = 1) => {
    for (let i = 1; i < points.length; i++)
      line(points[i - 1], points[i], color, width);
  };
  if (!front) {
    if (!ash) {
      poly(
        [
          [24, 16],
          [30, 10],
          [39, 8],
          [49, 10],
          [56, 16],
          [60, 25],
          [61, 34],
          [63, 42],
          [61, 47],
          [57, 50],
          [51, 50],
          [47, 47],
          [34, 47],
          [30, 50],
          [24, 50],
          [19, 47],
          [17, 42],
          [19, 34],
          [20, 24],
        ],
        body,
        ink,
      );
      poly(
        [
          [20, 30],
          [24, 26],
          [26, 34],
          [24, 41],
          [26, 46],
          [31, 47],
          [28, 49],
          [22, 46],
          [20, 41],
        ],
        shade,
      );
      poly(
        [
          [55, 27],
          [59, 31],
          [59, 38],
          [61, 43],
          [58, 47],
          [52, 49],
          [50, 47],
          [55, 44],
          [56, 38],
        ],
        shade,
      );
    }
    return;
  }
  if (ash) {
    poly(
      [
        [18, 31],
        [16, 26],
        [17, 20],
        [20, 14],
        [24, 10],
        [30, 7],
        [35, 6],
        [44, 6],
        [51, 8],
        [57, 12],
        [61, 18],
        [63, 24],
        [63, 30],
        [60, 36],
        [57, 38],
        [55, 33],
        [52, 30],
        [49, 31],
        [46, 28],
        [43, 31],
        [39, 33],
        [35, 32],
        [33, 29],
        [30, 32],
        [26, 32],
        [25, 37],
        [22, 36],
      ],
      body,
      ink,
    );
    poly(
      [
        [20, 21],
        [23, 15],
        [29, 11],
        [36, 8],
        [44, 8],
        [51, 10],
        [56, 14],
        [58, 19],
        [50, 17],
        [43, 14],
        [36, 13],
        [29, 16],
        [24, 23],
      ],
      middle,
    );
    poly(
      [
        [23, 15],
        [28, 11],
        [34, 9],
        [40, 9],
        [37, 12],
        [32, 15],
        [28, 20],
        [24, 22],
        [22, 20],
      ],
      light,
    );
    // Broad, curved reflections wrap across the crown and separate into locks.
    poly(
      [
        [24, 16],
        [28, 13],
        [32, 12],
        [35, 12],
        [32, 15],
        [29, 18],
        [25, 20],
        [23, 19],
      ],
      glow,
    );
    poly(
      [
        [28, 13],
        [31, 11],
        [34, 11],
        [32, 13],
        [29, 15],
        [26, 17],
        [25, 17],
      ],
      shine,
    );
    poly(
      [
        [29, 15],
        [33, 13],
        [37, 11],
        [40, 11],
        [37, 15],
        [34, 20],
        [31, 24],
        [27, 26],
        [24, 25],
        [27, 22],
      ],
      middle,
    );
    poly(
      [
        [35, 14],
        [39, 11],
        [42, 12],
        [44, 17],
        [44, 23],
        [42, 28],
        [38, 31],
        [35, 31],
        [38, 27],
        [39, 22],
        [38, 17],
      ],
      light,
    );
    poly(
      [
        [43, 12],
        [47, 13],
        [51, 17],
        [53, 23],
        [52, 28],
        [49, 30],
        [47, 27],
        [47, 22],
        [45, 18],
      ],
      middle,
    );
    poly(
      [
        [52, 15],
        [56, 17],
        [59, 22],
        [60, 28],
        [58, 33],
        [56, 34],
        [56, 29],
        [55, 24],
        [53, 20],
      ],
      middle,
    );
    poly(
      [
        [19, 23],
        [22, 22],
        [24, 25],
        [27, 27],
        [25, 31],
        [23, 34],
        [21, 31],
      ],
      middle,
    );
    curve(
      [
        [35, 12],
        [31, 16],
        [29, 20],
        [25, 23],
        [23, 23],
      ],
      shade,
    );
    curve(
      [
        [38, 13],
        [40, 18],
        [40, 24],
        [38, 28],
        [35, 30],
      ],
      shade,
    );
    curve(
      [
        [45, 14],
        [48, 19],
        [49, 24],
        [48, 28],
      ],
      shade,
    );
    curve(
      [
        [54, 19],
        [57, 24],
        [57, 29],
        [56, 32],
      ],
      shade,
    );
    curve(
      [
        [20, 25],
        [21, 29],
        [23, 32],
      ],
      shade,
    );
    // Broken horizontal bands give the shine a rounded surface, not straight stripes.
    poly(
      [
        [32, 17],
        [35, 16],
        [38, 17],
        [39, 19],
        [36, 19],
        [33, 19],
      ],
      glow,
    );
    line([34, 17], [36, 17], shine);
    poly(
      [
        [42, 17],
        [45, 17],
        [47, 19],
        [47, 21],
        [44, 20],
        [42, 19],
      ],
      glow,
    );
    line([43, 18], [45, 19], shine);
    poly(
      [
        [52, 20],
        [54, 21],
        [55, 24],
        [53, 23],
      ],
      glow,
    );
    line([26, 28], [28, 29], light);
    line([32, 25], [31, 28], light);
    rect(36, 28, 1, 2, glow);
    rect(42, 27, 1, 2, middle);
    rect(50, 28, 1, 2, light);
    line([58, 28], [58, 31], light);
    return;
  }
  // A broad rounded crown, three soft front panels and inward-turning C ends.
  poly(
    [
      [20, 31],
      [19, 24],
      [21, 17],
      [25, 12],
      [31, 9],
      [35, 8],
      [43, 8],
      [52, 11],
      [57, 16],
      [60, 23],
      [60, 30],
      [58, 35],
      [55, 32],
      [53, 27],
      [49, 24],
      [46, 21],
      [47, 29],
      [43, 29],
      [40, 26],
      [41, 30],
      [37, 30],
      [35, 27],
      [35, 30],
      [31, 29],
      [29, 25],
      [27, 28],
      [25, 34],
      [23, 36],
    ],
    body,
    ink,
  );
  poly(
    [
      [22, 21],
      [26, 15],
      [32, 11],
      [39, 9],
      [46, 10],
      [52, 13],
      [56, 18],
      [49, 15],
      [42, 13],
      [34, 14],
      [28, 18],
      [24, 25],
    ],
    middle,
  );
  poly(
    [
      [24, 17],
      [28, 13],
      [33, 11],
      [38, 10],
      [36, 13],
      [31, 16],
      [28, 20],
      [25, 22],
      [23, 21],
    ],
    light,
  );
  poly(
    [
      [27, 16],
      [30, 13],
      [33, 12],
      [35, 12],
      [32, 15],
      [29, 17],
      [26, 19],
    ],
    glow,
  );
  poly(
    [
      [31, 17],
      [35, 13],
      [39, 12],
      [39, 19],
      [39, 25],
      [41, 29],
      [37, 28],
      [35, 23],
      [34, 18],
    ],
    middle,
  );
  poly(
    [
      [40, 13],
      [44, 14],
      [46, 18],
      [46, 23],
      [47, 28],
      [43, 27],
      [41, 23],
    ],
    middle,
  );
  poly(
    [
      [46, 13],
      [51, 16],
      [55, 21],
      [56, 27],
      [55, 30],
      [51, 27],
      [48, 23],
    ],
    middle,
  );
  curve(
    [
      [30, 18],
      [30, 23],
      [32, 28],
    ],
    deep,
  );
  curve(
    [
      [35, 16],
      [36, 22],
      [38, 28],
    ],
    shade,
  );
  curve(
    [
      [40, 16],
      [42, 22],
      [44, 27],
    ],
    deep,
  );
  curve(
    [
      [47, 17],
      [50, 21],
      [53, 25],
    ],
    shade,
  );
  poly(
    [
      [22, 28],
      [26, 27],
      [25, 34],
      [24, 39],
      [25, 43],
      [28, 45],
      [31, 45],
      [30, 48],
      [26, 49],
      [22, 47],
      [19, 43],
      [19, 38],
      [20, 33],
    ],
    body,
    ink,
  );
  poly(
    [
      [55, 27],
      [59, 29],
      [60, 35],
      [61, 40],
      [60, 44],
      [57, 48],
      [53, 49],
      [49, 47],
      [50, 45],
      [54, 44],
      [56, 40],
      [56, 34],
    ],
    body,
    ink,
  );
  poly(
    [
      [22, 31],
      [24, 30],
      [23, 37],
      [23, 41],
      [25, 45],
      [28, 47],
      [24, 46],
      [21, 42],
      [21, 36],
    ],
    middle,
  );
  poly(
    [
      [57, 31],
      [59, 35],
      [59, 41],
      [57, 45],
      [53, 47],
      [51, 46],
      [55, 43],
      [57, 38],
    ],
    middle,
  );
  curve(
    [
      [22, 33],
      [22, 38],
      [23, 42],
      [26, 45],
    ],
    light,
  );
  curve(
    [
      [58, 34],
      [58, 39],
      [56, 43],
      [53, 45],
    ],
    light,
  );
  curve(
    [
      [25, 37],
      [25, 41],
      [27, 43],
      [30, 44],
    ],
    shade,
  );
  curve(
    [
      [55, 37],
      [54, 41],
      [52, 43],
      [50, 44],
    ],
    shade,
  );
  line([31, 18], [33, 17], light);
  line([36, 17], [38, 18], light);
  line([42, 18], [44, 19], light);
  line([49, 20], [51, 22], light);
  rect(32, 26, 1, 2, middle);
  rect(37, 27, 1, 2, light);
  rect(44, 26, 1, 2, middle);
}

/** Separate five-petal cherry blossom, yellow center and long silk ribbon. */
export function drawCherryRibbon(p: PixelPen) {
  const { poly, line, rect } = p;
  const edge = "#8d4269",
    rose = "#ed8db4",
    pale = "#ffd6e1",
    shine = "#fff4ec";
  poly(
    [
      [58, 25],
      [61, 25],
      [62, 33],
      [63, 42],
      [60, 41],
      [59, 35],
    ],
    rose,
    edge,
  );
  poly(
    [
      [55, 25],
      [58, 26],
      [58, 33],
      [57, 38],
      [55, 37],
      [56, 31],
    ],
    "#f8c5cb",
    edge,
  );
  line([60, 28], [61, 38], pale);
  line([56, 28], [56, 35], shine);
  poly(
    [
      [55, 25],
      [57, 23],
      [59, 25],
      [58, 29],
      [55, 28],
      [53, 26],
    ],
    "#8ab780",
    "#4f785e",
  );
  for (const [x, y] of [
    [58, 17],
    [62, 20],
    [60, 24],
    [55, 24],
    [54, 19],
  ]) {
    poly(
      [
        [x - 2, y - 1],
        [x - 1, y - 2],
        [x + 1, y - 2],
        [x + 2, y],
        [x + 2, y + 2],
        [x, y + 3],
        [x - 2, y + 1],
      ],
      rose,
      edge,
    );
    poly(
      [
        [x - 1, y - 1],
        [x + 1, y - 1],
        [x + 1, y + 1],
        [x, y + 2],
        [x - 1, y],
      ],
      pale,
    );
    rect(x - 1, y - 1, 1, 1, shine);
  }
  poly(
    [
      [57, 20],
      [59, 20],
      [60, 22],
      [59, 24],
      [57, 24],
      [56, 22],
    ],
    "#efbd53",
    "#a46c3c",
  );
  rect(57, 21, 2, 2, "#fff2a5");
  rect(58, 22, 1, 1, "#fff9da");
}
