import type { PixelPalette, TopCut } from "./wardrobe";
import { drawBowlHair } from "./bowlHair";
import { drawSoftHair } from "./softHair";
import { drawRoyalHair } from "./royalHair";
type Point = readonly [number, number];
export type PixelPen = {
  rect: (
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
  ) => void;
  line: (a: Point, b: Point, color: string, width?: number) => void;
  poly: (points: readonly Point[], color: string, outline?: string) => void;
};
const INK = "#262331";

/** Hair additions stay outside the fixed face boundary; rear lengths precede clothes. */
export function drawHairDetails(
  p: PixelPen,
  style: string,
  hair: PixelPalette,
  front: boolean,
  decoration = true,
) {
  const { rect, line, poly } = p;
  if (style === "mm-royal-ash" || style === "mm-royal-choco-bob") {
    drawRoyalHair(p, style, hair, front);
    return;
  }
  if (style === "mm-ash-cloud" || style === "mm-blossom-bob") {
    drawSoftHair(p, style, hair, front, decoration);
    return;
  }
  if (!front) {
    if (style === "mm-twin-ribbon" || style === "mm-braided-twin") {
      for (const flip of [-1, 1]) {
        const points = (pairs: readonly Point[]) =>
          pairs.map(([x, y]) => [40 + flip * x, y] as Point);
        if (style === "mm-twin-ribbon") {
          poly(
            points([
              [18, 21],
              [25, 19],
              [30, 25],
              [30, 34],
              [27, 42],
              [30, 51],
              [27, 61],
              [21, 64],
              [18, 59],
              [21, 52],
              [19, 43],
              [18, 31],
            ]),
            hair[2],
            INK,
          );
          line([40 + flip * 25, 27], [40 + flip * 23, 43], hair[1], 3);
          line([40 + flip * 23, 47], [40 + flip * 25, 56], hair[1], 2);
          rect(40 + flip * 23 - 2, 26, 4, 3, "#e8a6c4");
        } else {
          for (let y = 28; y <= 58; y += 7) {
            poly(
              points([
                [16, y],
                [21, y - 1],
                [25, y + 4],
                [22, y + 8],
                [17, y + 7],
                [15, y + 3],
              ]),
              hair[2],
              INK,
            );
            line([40 + flip * 18, y + 2], [40 + flip * 21, y + 5], hair[0]);
          }
          poly(
            points([
              [19, 62],
              [24, 63],
              [23, 69],
              [18, 68],
            ]),
            hair[1],
            INK,
          );
          rect(40 + flip * 21 - 2, 61, 5, 2, "#b57b93");
        }
      }
    }
    if (style === "mm-high-bun" || style === "mm-half-up") {
      poly(
        [
          [32, 12],
          [30, 7],
          [34, 3],
          [43, 2],
          [49, 6],
          [48, 12],
          [43, 16],
          [35, 15],
        ],
        hair[2],
        INK,
      );
      line([34, 7], [43, 5], hair[0], 2);
      line([45, 7], [43, 12], hair[1], 2);
      line([34, 12], [45, 13], "#d49ab4", 2);
    }
    if (style === "mm-wolf-layer") {
      poly(
        [
          [22, 25],
          [58, 25],
          [59, 44],
          [63, 50],
          [55, 48],
          [53, 54],
          [49, 49],
          [31, 49],
          [27, 54],
          [24, 48],
          [18, 50],
          [21, 43],
        ],
        hair[2],
        INK,
      );
      line([24, 36], [27, 46], hair[1], 2);
      line([56, 36], [53, 46], hair[1], 2);
    }
    if (style === "mm-long-curl") {
      for (const x of [19, 54])
        for (const y of [36, 47, 58]) {
          poly(
            [
              [x, y],
              [x + 7, y - 2],
              [x + 10, y + 3],
              [x + 8, y + 9],
              [x + 1, y + 11],
              [x - 2, y + 6],
            ],
            hair[2],
            INK,
          );
          line([x + 2, y + 2], [x + 6, y + 1], hair[0], 2);
          line([x + 7, y + 4], [x + 5, y + 7], hair[1], 2);
        }
    }
    return;
  }
  if (style === "mm-ash-bowl") {
    drawBowlHair(p, hair);
  } else if (style === "mm-cloud-crop" || style === "mm-fluffy-curl") {
    const curls =
      style === "mm-cloud-crop"
        ? [
            [25, 18],
            [32, 13],
            [41, 12],
            [50, 16],
            [54, 23],
          ]
        : [
            [24, 16],
            [31, 10],
            [40, 9],
            [49, 12],
            [55, 19],
            [26, 25],
            [37, 23],
            [48, 25],
          ];
    for (const [x, y] of curls) {
      poly(
        [
          [x - 4, y],
          [x - 3, y - 3],
          [x + 2, y - 4],
          [x + 5, y],
          [x + 4, y + 5],
          [x, y + 7],
          [x - 4, y + 4],
        ],
        hair[2],
        hair[3],
      );
      line([x - 2, y - 1], [x + 1, y - 2], hair[0]);
      line([x + 3, y + 1], [x + 1, y + 4], hair[1], 2);
    }
  } else if (style === "mm-side-sweep") {
    poly(
      [
        [27, 16],
        [35, 11],
        [47, 13],
        [54, 18],
        [50, 23],
        [42, 27],
        [32, 30],
        [28, 28],
        [35, 23],
        [40, 19],
        [31, 22],
        [25, 27],
      ],
      hair[2],
      hair[3],
    );
    line([30, 18], [39, 15], hair[0], 2);
    line([34, 25], [47, 19], hair[1], 2);
  } else if (style === "mm-soft-curtain") {
    poly(
      [
        [38, 13],
        [38, 19],
        [34, 24],
        [29, 27],
        [25, 25],
        [29, 22],
        [32, 17],
      ],
      hair[1],
      hair[3],
    );
    poly(
      [
        [42, 13],
        [44, 19],
        [49, 23],
        [55, 24],
        [55, 28],
        [49, 27],
        [43, 23],
        [40, 18],
      ],
      hair[1],
      hair[3],
    );
    line([28, 23], [34, 18], hair[0]);
    line([44, 18], [51, 24], hair[0]);
  } else if (style === "mm-wave-bob") {
    for (const x of [20, 53]) {
      poly(
        [
          [x + 2, 28],
          [x + 6, 29],
          [x + 7, 36],
          [x + 4, 40],
          [x + 8, 44],
          [x + 6, 49],
          [x, 50],
          [x - 2, 46],
          [x + 1, 42],
          [x - 1, 37],
        ],
        hair[2],
        INK,
      );
      line([x + 3, 31], [x + 4, 35], hair[0]);
      line([x + 1, 43], [x + 5, 46], hair[1], 2);
    }
  } else if (style === "mm-hime-long") {
    poly(
      [
        [26, 23],
        [30, 17],
        [48, 17],
        [54, 23],
        [53, 28],
        [27, 28],
      ],
      hair[2],
      hair[3],
    );
    for (const x of [29, 35, 42, 48]) line([x, 20], [x, 26], hair[1]);
    for (const x of [24, 53]) {
      poly(
        [
          [x, 26],
          [x + 3, 26],
          [x + 3, 44],
          [x - 1, 44],
        ],
        hair[2],
        hair[3],
      );
      line([x + 1, 28], [x + 1, 41], hair[0]);
    }
  } else if (style === "mm-wolf-layer") {
    poly(
      [
        [24, 19],
        [29, 12],
        [33, 16],
        [38, 10],
        [41, 17],
        [48, 12],
        [50, 19],
        [56, 17],
        [54, 27],
        [49, 24],
        [46, 29],
        [42, 24],
        [37, 29],
        [33, 24],
        [27, 28],
      ],
      hair[2],
      hair[3],
    );
    line([29, 19], [34, 16], hair[0]);
    line([41, 18], [46, 17], hair[1], 2);
  } else if (style === "mm-twin-ribbon" || style === "mm-high-bun") {
    poly(
      [
        [28, 21],
        [34, 16],
        [44, 16],
        [51, 21],
        [52, 27],
        [47, 27],
        [44, 24],
        [42, 28],
        [36, 28],
        [34, 24],
        [31, 28],
        [27, 28],
      ],
      hair[2],
      hair[3],
    );
    line([30, 22], [35, 19], hair[0]);
    line([43, 19], [48, 22], hair[1], 2);
  } else if (style === "mm-braided-twin" || style === "mm-half-up") {
    line([31, 18], [25, 25], hair[0], 2);
    line([47, 19], [53, 26], hair[1], 2);
    if (style === "mm-half-up") {
      poly(
        [
          [48, 18],
          [52, 15],
          [56, 16],
          [55, 20],
          [51, 22],
        ],
        "#b4cde8",
        INK,
      );
      rect(51, 17, 2, 2, "#f4f5ff");
    }
  }
}

export function drawTopDetails(p: PixelPen, cut: TopCut, fabric: PixelPalette) {
  const { rect, line, poly } = p;
  const light = "#fff3d8",
    dark = fabric[3],
    gold = "#e8c780";
  if (cut === "sailor") {
    poly(
      [
        [32, 51],
        [40, 57],
        [48, 51],
        [47, 59],
        [40, 64],
        [33, 59],
      ],
      "#496b80",
      INK,
    );
    line([33, 53], [40, 59], light);
    line([40, 59], [47, 53], light);
    poly(
      [
        [39, 59],
        [35, 63],
        [38, 66],
        [40, 63],
        [43, 66],
        [45, 62],
        [41, 59],
      ],
      "#e4a69a",
      dark,
    );
  } else if (cut === "varsity") {
    rect(39, 53, 3, 20, light);
    line([40, 54], [40, 72], dark);
    for (const y of [57, 63, 69]) rect(41, y, 1, 1, gold);
    rect(44, 59, 4, 5, light);
    rect(45, 60, 2, 3, fabric[1]);
    line([32, 68], [36, 66], dark);
    line([44, 66], [48, 68], dark);
    for (const y of [71, 74]) line([31, y], [49, y], light);
  } else if (cut === "cardigan") {
    poly(
      [
        [35, 52],
        [40, 60],
        [45, 52],
        [43, 70],
        [37, 70],
      ],
      light,
      dark,
    );
    line([39, 61], [39, 73], dark);
    line([41, 61], [41, 73], fabric[0]);
    for (const y of [64, 68, 72]) rect(40, y, 1, 1, gold);
    rect(32, 65, 4, 4, fabric[2]);
    rect(44, 65, 4, 4, fabric[2]);
  } else if (cut === "academy" || cut === "royal") {
    poly(
      [
        [35, 51],
        [40, 57],
        [45, 51],
        [43, 66],
        [37, 66],
      ],
      light,
      dark,
    );
    poly(
      [
        [39, 55],
        [41, 55],
        [42, 63],
        [40, 66],
        [38, 63],
      ],
      cut === "royal" ? gold : "#b56c74",
      dark,
    );
    poly(
      [
        [34, 53],
        [38, 62],
        [34, 64],
        [32, 56],
      ],
      fabric[0],
      dark,
    );
    poly(
      [
        [46, 53],
        [42, 62],
        [46, 64],
        [48, 56],
      ],
      fabric[0],
      dark,
    );
    for (const y of [66, 70])
      for (const x of cut === "royal" ? [37, 43] : [40]) rect(x, y, 2, 2, gold);
    if (cut === "royal") {
      line([31, 73], [49, 73], gold);
      rect(45, 58, 3, 3, gold);
    }
  } else if (cut === "cape") {
    poly(
      [
        [33, 51],
        [29, 57],
        [27, 66],
        [34, 64],
        [40, 59],
        [46, 64],
        [53, 66],
        [51, 57],
        [47, 51],
        [40, 55],
      ],
      fabric[1],
      dark,
    );
    line([29, 63], [39, 57], gold);
    line([41, 57], [51, 63], gold);
    rect(39, 55, 3, 3, gold);
    rect(42, 67, 3, 3, light);
    rect(44, 66, 2, 3, fabric[1]);
  } else if (cut === "lace") {
    poly(
      [
        [34, 51],
        [40, 56],
        [46, 51],
        [48, 56],
        [44, 60],
        [40, 58],
        [36, 60],
        [32, 56],
      ],
      light,
      dark,
    );
    for (const x of [32, 35, 38, 41, 44, 47]) rect(x, 72, 2, 3, light);
    poly(
      [
        [38, 59],
        [34, 61],
        [37, 64],
        [40, 62],
        [43, 64],
        [46, 61],
        [42, 59],
      ],
      "#aa7d98",
      dark,
    );
    for (const y of [65, 68]) rect(40, y, 1, 1, dark);
  } else if (cut === "stripe") {
    for (const y of [58, 64, 70]) rect(31, y, 18, 2, light);
    rect(43, 60, 4, 5, fabric[2]);
    line([43, 60], [46, 60], dark);
  } else if (cut === "star") {
    poly(
      [
        [34, 51],
        [31, 54],
        [35, 58],
        [39, 57],
        [40, 54],
        [41, 57],
        [45, 58],
        [49, 54],
        [46, 51],
        [40, 54],
      ],
      fabric[2],
      dark,
    );
    line([35, 57], [35, 62], light);
    line([45, 57], [45, 62], light);
    poly(
      [
        [40, 60],
        [42, 63],
        [46, 63],
        [43, 66],
        [44, 70],
        [40, 68],
        [36, 70],
        [37, 66],
        [34, 63],
        [38, 63],
      ],
      gold,
      dark,
    );
  } else if (cut === "hanbok") {
    poly(
      [
        [34, 51],
        [40, 56],
        [46, 51],
        [47, 54],
        [40, 61],
        [33, 55],
      ],
      light,
      dark,
    );
    line([35, 53], [44, 61], "#b76d8b", 2);
    poly(
      [
        [43, 58],
        [47, 57],
        [49, 60],
        [45, 62],
        [42, 60],
        [39, 62],
        [38, 59],
      ],
      "#bb7399",
      dark,
    );
    line([43, 61], [43, 71], "#bb7399", 2);
    line([46, 61], [48, 69], "#d392ad", 2);
    line([31, 74], [49, 74], light);
  }
}
