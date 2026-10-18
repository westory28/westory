export const ATLAS_MOUNTAIN_TEXTURE_SIZE = 64;

type AtlasMountainTexture = {
  canvas: HTMLCanvasElement;
  dataUrl: string;
};

const textures = new Map<string, AtlasMountainTexture>();

/** One quiet, deterministic grain tile shared by SVG maps and the globe.
 * It describes the surface texture only, never a surveyed ridge or contour.
 */
export function getAtlasMountainTexture(
  color = "#6b826d",
): AtlasMountainTexture | null {
  const cached = textures.get(color);
  if (cached) return cached;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ATLAS_MOUNTAIN_TEXTURE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  const pixels = context.createImageData(canvas.width, canvas.height);
  let seed = 0x6d2b79f5;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x100000000;
  };
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const grain = random();
    pixels.data[offset] = red;
    pixels.data[offset + 1] = green;
    pixels.data[offset + 2] = blue;
    pixels.data[offset + 3] = grain < 0.5 ? 0 : Math.round(18 + random() * 64);
  }
  context.putImageData(pixels, 0, 0);
  const texture = { canvas, dataUrl: canvas.toDataURL("image/png") };
  textures.set(color, texture);
  return texture;
}
