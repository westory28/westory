const ART = `${import.meta.env.BASE_URL}assets/weplay/yut/`;
// What the first screen paints, then what the waiting room and board show.
// The remaining sheets are requested by the game itself once it has mounted.
const STAGES = [
  [
    "courtyard.webp",
    "materials.webp",
    "entry-background.webp",
    "entry-characters.webp",
    "entry-sticks.webp",
  ],
  ["animation-idle.webp", "animation-walk.webp"],
];
const warmed: HTMLImageElement[] = [];
let started = false;

/** Warm public artwork while the opening plays; never blocks or fails play. */
export function preloadYutArtwork() {
  if (started || typeof Image === "undefined") return;
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  if (connection?.saveData) return;
  started = true;
  const request = (stage: number) => {
    const files = STAGES[stage];
    if (!files) return;
    let remaining = files.length;
    const settle = () => {
      remaining -= 1;
      if (remaining === 0) request(stage + 1);
    };
    for (const file of files) {
      const image = new Image();
      image.decoding = "async";
      image.onload = settle;
      image.onerror = settle;
      warmed.push(image);
      image.src = ART + file;
    }
  };
  request(0);
}
