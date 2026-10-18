// Reuse the displayed brand font, including the portal's CSS cascade/fallback.
// TeacherSidebar's wordmark uses weight 800 and -0.025em letter spacing.
const watermarkFont = () => {
  const logo = document.querySelector(".teacher-sidebar-wordmark, .logo-text");
  const family = getComputedStyle(logo || document.body).fontFamily;
  return `800 100px ${family || "sans-serif"}`;
};
const PARTS = [
  { text: "We", color: "#2563eb" },
  { text: "story", color: "#f59e0b" },
] as const;
const LETTER_SPACING = -2.5;

export const prepareProductWatermarkFont = async () => {
  // If the site's webfont cannot load, use the same fallback as its logo.
  await document.fonts.load(watermarkFont(), "Westory").catch(() => []);
};

export const drawProductWatermark = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) => {
  if (width <= 0 || height <= 0) return;
  context.save();
  context.font = watermarkFont();
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  const letters: { text: string; color: string; x: number }[] = [];
  let advance = 0;
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  for (const part of PARTS) {
    for (let index = 0; index < part.text.length; index++) {
      const text = part.text[index];
      const x =
        advance +
        context.measureText(part.text.slice(0, index)).width +
        index * LETTER_SPACING;
      const metrics = context.measureText(text);
      letters.push({ text, color: part.color, x });
      left = Math.min(left, x - metrics.actualBoundingBoxLeft);
      right = Math.max(right, x + metrics.actualBoundingBoxRight);
      top = Math.max(top, metrics.actualBoundingBoxAscent);
      bottom = Math.max(bottom, metrics.actualBoundingBoxDescent);
    }
    advance +=
      context.measureText(part.text).width + part.text.length * LETTER_SPACING;
  }
  const edge = Math.min(width, height);
  const scale = (edge * 0.24) / (right - left);
  const margin = edge * 0.04;
  context.translate(
    width - margin - edge * 0.24,
    height - margin - (top + bottom) * scale,
  );
  context.scale(scale, scale);
  context.translate(-left, top);
  // A fine white keyline keeps both brand colors visible on dark photographs.
  context.strokeStyle = "rgba(255, 255, 255, 0.9)";
  context.lineWidth = 2.5;
  context.lineJoin = "round";
  for (const letter of letters) {
    context.strokeText(letter.text, letter.x, 0);
    context.fillStyle = letter.color;
    context.fillText(letter.text, letter.x, 0);
  }
  context.restore();
};
