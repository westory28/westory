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
  | "hanbok"
  | "hanbok-flower"
  | "saekdong"
  | "hanbok-ink"
  | "durumagi"
  | "dopo"
  | "royal-hanbok"
  | "dangui"
  | "scholar";
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
  "mm-hanbok-plum": {
    palette: ["#fff3ce", "#e5b2b6", "#b8748b", "#79465e"],
    cut: "hanbok-flower",
    long: true,
  },
  "mm-hanbok-saekdong": {
    palette: ["#fff4ca", "#e6c78b", "#b59664", "#765939"],
    cut: "saekdong",
    long: true,
  },
  "mm-hanbok-ink": {
    palette: ["#bcc1d0", "#505465", "#333747", "#222331"],
    cut: "hanbok-ink",
    long: true,
  },
  "mm-hanbok-mooncoat": {
    palette: ["#fffdf1", "#e8e5d9", "#b5bbbd", "#737c8d"],
    cut: "durumagi",
    long: true,
  },
  "mm-hanbok-jade-dopo": {
    palette: ["#e1f3dc", "#8eb9ad", "#5e8d89", "#3b5d67"],
    cut: "dopo",
    long: true,
  },
  "mm-hanbok-royal-red": {
    palette: ["#f5c695", "#b94f5c", "#843448", "#512739"],
    cut: "royal-hanbok",
    long: true,
  },
  "mm-hanbok-dangui": {
    palette: ["#f2edb8", "#79a793", "#50776d", "#334d50"],
    cut: "dangui",
    long: true,
  },
  "mm-hanbok-scholar": {
    palette: ["#a1afc4", "#414e66", "#2c354c", "#1e2435"],
    cut: "scholar",
    long: true,
  },
};
export const BOTTOMS: Record<
  string,
  {
    palette: PixelPalette;
    cut: "skirt" | "trousers" | "shorts" | "culottes" | "chima" | "baji";
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
  "mm-hanbok-chima-red": {
    palette: ["#ffcbad", "#d76773", "#ac405e", "#752b49"],
    cut: "chima",
    detail: "flower",
  },
  "mm-hanbok-chima-plum": {
    palette: ["#f1c7e0", "#b987b5", "#8c5a94", "#593d6d"],
    cut: "chima",
    detail: "petal",
  },
  "mm-hanbok-chima-jade": {
    palette: ["#daf1dc", "#8db6a8", "#5d8e86", "#3a6065"],
    cut: "chima",
    detail: "ribbon",
  },
  "mm-hanbok-chima-ivory": {
    palette: ["#fffef0", "#e7dfc9", "#c2b39d", "#8d7a71"],
    cut: "chima",
    detail: "gold",
  },
  "mm-hanbok-baji-ivory": {
    palette: ["#fff6dc", "#dfcfaa", "#b3a17f", "#776754"],
    cut: "baji",
    detail: "wrap",
  },
  "mm-hanbok-baji-indigo": {
    palette: ["#a5b9d6", "#687d9f", "#485b7c", "#303e5c"],
    cut: "baji",
    detail: "wrap",
  },
};
export const SHOES: Record<
  string,
  {
    palette: PixelPalette;
    cut:
      | "flat"
      | "boot"
      | "high"
      | "runner"
      | "buckle"
      | "canvas"
      | "flower"
      | "straw"
      | "traditionalBoot";
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
  "mm-hanbok-flower-red": {
    palette: ["#ffe4d0", "#c96e82", "#99445e", "#683149"],
    cut: "flower",
  },
  "mm-hanbok-flower-lilac": {
    palette: ["#f0e1ff", "#b199ce", "#8669a6", "#57466e"],
    cut: "flower",
  },
  "mm-hanbok-mokhwa": {
    palette: ["#acb0bc", "#4c5062", "#323647", "#202330"],
    cut: "traditionalBoot",
  },
  "mm-hanbok-jipsin": {
    palette: ["#fff0b4", "#c9a56f", "#987147", "#654e3a"],
    cut: "straw",
  },
};

export const HAIR_BASES: Record<string, string> = {
  "mm-royal-ash": "mm-royal-rounded",
  "mm-royal-choco-bob": "mm-royal-c-bob",
  "mm-ash-cloud": "mm-soft-cloud",
  "mm-blossom-bob": "mm-soft-bob",
  "mm-ash-bowl": "mm-bowl",
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
