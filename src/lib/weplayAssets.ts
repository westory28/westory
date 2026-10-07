const warmed = new Map<string, HTMLImageElement>();
const ART = `${import.meta.env?.BASE_URL || "/"}assets/weplay/naval/`;

/** Warm public artwork while the lobby request is in flight; never block play. */
export function preloadWeplayAssets(includeEffects = false) {
  if (typeof Image === "undefined") return;
  const files = [
    "sea-battle.webp",
    "allied-ship.webp",
    "enemy-ship.webp",
    "reference-sprites.webp",
  ];
  if (includeEffects)
    files.push("explosion.webp", "yi-sunsin-cutin.webp", "impact-lines.webp");
  for (const file of files) {
    if (warmed.has(file)) continue;
    const image = new Image();
    image.decoding = "async";
    image.onerror = () => warmed.delete(file);
    warmed.set(file, image);
    image.src = ART + file;
  }
}
