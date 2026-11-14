import type { PixelPen } from "./details";
import type { PixelPalette } from "./wardrobe";

/** A rounded cut with its own crown, layered locks and a continuous full fringe. */
export function drawBowlHair(p: PixelPen, hair: PixelPalette) {
  const { poly, line, rect } = p;
  const [glint, light, base, dark] = hair;
  const blend = (a: string, b: string) =>
    "#" +
    [1, 3, 5]
      .map((i) =>
        Math.round(
          (parseInt(a.slice(i, i + 2), 16) + parseInt(b.slice(i, i + 2), 16)) /
            2,
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  const reflection = blend(glint, light);
  const softShadow = blend(base, dark);
  poly(
    [
      [21, 32],
      [19, 25],
      [20, 18],
      [23, 12],
      [28, 8],
      [35, 5],
      [44, 5],
      [52, 8],
      [57, 13],
      [60, 19],
      [61, 26],
      [59, 32],
      [57, 36],
      [55, 37],
      [54, 30],
      [51, 31],
      [49, 28],
      [47, 31],
      [44, 30],
      [42, 28],
      [40, 31],
      [37, 30],
      [35, 28],
      [33, 31],
      [30, 30],
      [28, 28],
      [26, 32],
      [25, 37],
      [23, 36],
    ],
    base,
    "#262331",
  );
  // Upper-left light follows the dome; broad bands taper into individual locks.
  poly(
    [
      [22, 21],
      [24, 14],
      [29, 10],
      [36, 7],
      [44, 7],
      [48, 9],
      [39, 10],
      [32, 13],
      [27, 18],
      [25, 25],
    ],
    light,
  );
  poly(
    [
      [23, 18],
      [26, 12],
      [32, 9],
      [38, 9],
      [39, 12],
      [34, 16],
      [28, 21],
      [24, 23],
    ],
    reflection,
  );
  poly(
    [
      [29, 20],
      [34, 15],
      [41, 11],
      [46, 9],
      [43, 14],
      [38, 18],
      [34, 23],
      [32, 27],
    ],
    light,
  );
  poly(
    [
      [26, 14],
      [30, 11],
      [34, 10],
      [37, 10],
      [35, 13],
      [30, 16],
      [26, 19],
      [24, 19],
    ],
    glint,
  );
  poly(
    [
      [38, 22],
      [42, 15],
      [47, 10],
      [50, 11],
      [47, 16],
      [45, 23],
      [43, 27],
      [41, 25],
    ],
    light,
  );
  poly(
    [
      [49, 22],
      [50, 16],
      [50, 12],
      [54, 15],
      [56, 20],
      [56, 28],
      [53, 30],
      [52, 25],
    ],
    light,
  );
  // Curving shadow seams create several small ends instead of one side part.
  for (const points of [
    [
      [28, 13],
      [24, 20],
      [24, 27],
      [26, 31],
    ],
    [
      [35, 11],
      [29, 18],
      [28, 24],
      [30, 29],
    ],
    [
      [42, 9],
      [35, 17],
      [33, 24],
      [35, 28],
    ],
    [
      [46, 10],
      [40, 18],
      [38, 25],
      [40, 30],
    ],
    [
      [50, 12],
      [46, 20],
      [45, 26],
      [47, 30],
    ],
    [
      [54, 17],
      [53, 22],
      [54, 28],
      [55, 32],
    ],
  ] as const)
    for (let i = 1; i < points.length; i++)
      line(
        points[i - 1],
        points[i],
        i === points.length - 1 ? dark : softShadow,
      );
  line([24, 17], [23, 22], glint);
  line([29, 15], [34, 12], glint);
  line([33, 20], [36, 17], reflection);
  line([40, 19], [42, 16], reflection);
  line([48, 20], [49, 17], reflection);
  line([56, 23], [57, 28], base);
  line([21, 25], [23, 31], light);
  rect(30, 9, 2, 1, light);
  rect(37, 6, 5, 1, light);
  rect(46, 7, 3, 1, dark);
  rect(28, 24, 1, 2, light);
  rect(36, 25, 1, 2, light);
  rect(42, 27, 1, 2, light);
  rect(50, 26, 1, 2, light);
  line([27, 26], [28, 28], reflection);
  line([32, 25], [33, 28], light);
  line([37, 27], [38, 29], light);
  line([44, 27], [45, 29], light);
  line([50, 28], [51, 30], light);
  rect(54, 30, 1, 2, light);
}
