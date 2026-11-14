/** Original wardrobe palettes and cuts, all fitted to the shared pixel rig. */
export type PixelPalette = readonly [string, string, string, string];
export type TopCut =
  | "sailor"
  | "varsity"
  | "cardigan"
  | "academy"
  | "cape"
  | "lace"
  | "stripe"
  | "star"
  | "royal"
  | "hanbok";
export const TOPS: Record<
  string,
  { palette: PixelPalette; cut: TopCut; long: boolean }
> = {
  "mm-sailor-mint": {
    palette: ["#e9fff5", "#b2ded4", "#73a6a0", "#3c656b"],
    cut: "sailor",
    long: false,
  },
  "mm-varsity-cherry": {
    palette: ["#ffd4c8", "#c75b65", "#963c54", "#5c2d46"],
    cut: "varsity",
    long: true,
  },
  "mm-cardigan-rose": {
    palette: ["#ffe1e7", "#d99bad", "#ad6587", "#70435f"],
    cut: "cardigan",
    long: true,
  },
  "mm-academy-navy": {
    palette: ["#a5b7d8", "#506389", "#344465", "#242e4a"],
    cut: "academy",
    long: true,
  },
  "mm-moon-cape": {
    palette: ["#d0bce9", "#8d75b5", "#66528d", "#423558"],
    cut: "cape",
    long: true,
  },
  "mm-lace-blouse": {
    palette: ["#fffdf0", "#f1e4ca", "#c9b297", "#8e746d"],
    cut: "lace",
    long: true,
  },
  "mm-stripe-tangerine": {
    palette: ["#fff3ce", "#ecb46d", "#c87c4b", "#885339"],
    cut: "stripe",
    long: false,
  },
  "mm-star-hoodie": {
    palette: ["#c5e2ff", "#7c9fd9", "#526da9", "#354974"],
    cut: "star",
    long: true,
  },
  "mm-royal-coat": {
    palette: ["#ffe1aa", "#884854", "#603043", "#3e2437"],
    cut: "royal",
    long: true,
  },
  "mm-hanbok-sky": {
    palette: ["#def7f6", "#99cbdc", "#609bb8", "#37627f"],
    cut: "hanbok",
    long: true,
  },
};
export const BOTTOMS: Record<
  string,
  {
    palette: PixelPalette;
    cut: "skirt" | "trousers" | "shorts" | "culottes";
    detail: string;
  }
> = {
  "mm-pleated-rose": {
    palette: ["#f5ccd6", "#ce8ca4", "#a55f7e", "#693e59"],
    cut: "skirt",
    detail: "pleat",
  },
  "mm-tartan-gray": {
    palette: ["#d4d1dc", "#9695aa", "#626078", "#414056"],
    cut: "skirt",
    detail: "check",
  },
  "mm-culottes-cream": {
    palette: ["#fff5d9", "#ddcbae", "#b29a7f", "#786452"],
    cut: "culottes",
    detail: "belt",
  },
  "mm-cargo-sage": {
    palette: ["#cbd8b2", "#95ac83", "#688164", "#42554a"],
    cut: "trousers",
    detail: "cargo",
  },
  "mm-shorts-denim": {
    palette: ["#abd2e7", "#6d9fbc", "#42738d", "#2c4c67"],
    cut: "shorts",
    detail: "denim",
  },
  "mm-trousers-cocoa": {
    palette: ["#c9aa8e", "#99775f", "#6e5148", "#49383b"],
    cut: "trousers",
    detail: "belt",
  },
  "mm-tulle-lilac": {
    palette: ["#f2dcff", "#c5a4e1", "#9977b9", "#634c80"],
    cut: "skirt",
    detail: "tulle",
  },
  "mm-skirt-starlight": {
    palette: ["#b6c6f4", "#637caf", "#435584", "#2c355d"],
    cut: "skirt",
    detail: "star",
  },
};
export const SHOES: Record<
  string,
  {
    palette: PixelPalette;
    cut: "flat" | "boot" | "high" | "runner" | "buckle" | "canvas";
  }
> = {
  "mm-ribbon-flats": {
    palette: ["#ffd7e5", "#cc83a4", "#925675", "#603c56"],
    cut: "flat",
  },
  "mm-ankle-boots": {
    palette: ["#bca283", "#816a52", "#574a41", "#392f32"],
    cut: "boot",
  },
  "mm-hightop-pink": {
    palette: ["#ffe0ee", "#da9abd", "#a96690", "#714965"],
    cut: "high",
  },
  "mm-running-mint": {
    palette: ["#e3fff0", "#8cccb6", "#559d93", "#366970"],
    cut: "runner",
  },
  "mm-royal-buckle": {
    palette: ["#d9adc2", "#86576f", "#603b54", "#382638"],
    cut: "buckle",
  },
  "mm-canvas-red": {
    palette: ["#ffd2c4", "#ce706a", "#a44853", "#653641"],
    cut: "canvas",
  },
};

export const HAIR_BASES: Record<string, string> = {
  "mm-cloud-crop": "mm-crop",
  "mm-side-sweep": "mm-parted",
  "mm-soft-curtain": "mm-parted",
  "mm-wolf-layer": "mm-crop",
  "mm-wave-bob": "mm-bob",
  "mm-twin-ribbon": "mm-ponytail",
  "mm-braided-twin": "mm-long",
  "mm-high-bun": "mm-ponytail",
  "mm-half-up": "mm-long",
  "mm-long-curl": "mm-wave",
  "mm-hime-long": "mm-long",
  "mm-fluffy-curl": "mm-crop",
};
