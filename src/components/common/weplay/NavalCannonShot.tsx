import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

// The transparent artwork uses object-fit: contain and center/bottom alignment.
// Apply the ship's live bob/recoil matrix to its mouth instead of guessing a
// percentage of the entire battlefield (which changes in portrait layouts).
function artworkPoint(image: HTMLImageElement, x: number, y: number) {
  const width = image.clientWidth;
  const height = image.clientHeight;
  const ratio = (image.naturalWidth || 1024) / (image.naturalHeight || 680);
  const artWidth = Math.min(width, height * ratio);
  const artHeight = artWidth / ratio;
  const style = getComputedStyle(image);
  const [originX, originY] = style.transformOrigin
    .split(" ")
    .map(Number.parseFloat);
  const matrix = new DOMMatrixReadOnly(
    style.transform === "none" ? undefined : style.transform,
  );
  const point = new DOMPoint(
    (width - artWidth) / 2 + artWidth * x - originX,
    height - artHeight + artHeight * y - originY,
  ).matrixTransform(matrix);
  return {
    x: image.offsetLeft + originX + point.x,
    y: image.offsetTop + originY + point.y,
  };
}

export default function NavalCannonShot({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [coordinates, setCoordinates] = useState<CSSProperties>();
  useLayoutEffect(() => {
    const scene = root.current?.closest(".naval-scene");
    const allied = scene?.querySelector<HTMLImageElement>(
      ".naval-ship--allied",
    );
    const enemy = scene?.querySelector<HTMLImageElement>(".naval-ship--enemy");
    if (!allied || !enemy) return;
    const from = artworkPoint(allied, 0.95, 0.49);
    const to = artworkPoint(enemy, 0.5, 0.62);
    setCoordinates({
      "--shot-x": `${from.x}px`,
      "--shot-y": `${from.y}px`,
      "--shot-dx": `${to.x - from.x}px`,
      "--shot-dy": `${to.y - from.y}px`,
      "--shot-target-x": `${to.x}px`,
      "--shot-target-y": `${to.y}px`,
    } as CSSProperties);
  }, []);
  return (
    <div
      ref={root}
      className="naval-shot-origin"
      style={{ ...coordinates, visibility: coordinates ? undefined : "hidden" }}
    >
      {children}
    </div>
  );
}
