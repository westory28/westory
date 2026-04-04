import type { CSSProperties } from "react";
import type { HallOfFameLeaderboardPanelPosition } from "../types";

const DEFAULT_RAIL_CENTER = 71;

const clampNumber = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const resolveRailAlignClassName = (leftPercent: number) => {
  if (leftPercent <= 44) return "self-start";
  if (leftPercent >= 56) return "self-end";
  return "self-center";
};

const resolveDesktopRailJustifyClassName = (leftPercent: number) => {
  if (leftPercent <= 44) return "justify-self-start";
  if (leftPercent >= 56) return "justify-self-end";
  return "justify-self-center";
};

export const buildHallOfFamePreviewLayout = (
  desktopRail: HallOfFameLeaderboardPanelPosition,
  mobileRail: HallOfFameLeaderboardPanelPosition,
) => {
  const desktopRailWidthPercent = clampNumber(
    Number(desktopRail.widthPercent || 29),
    24,
    38,
  );
  const desktopRailTop = `${clampNumber(
    Number(desktopRail.topPercent || 0) / 5,
    0,
    9,
  )}rem`;
  const desktopRailNudge = `${clampNumber(
    (Number(desktopRail.leftPercent || DEFAULT_RAIL_CENTER) -
      DEFAULT_RAIL_CENTER) /
      22,
    -0.35,
    0.35,
  )}rem`;
  const mobileRailWidth = `${clampNumber(
    Number(mobileRail.widthPercent || 100),
    78,
    100,
  )}%`;
  const mobileRailTop = `${clampNumber(
    Number(mobileRail.topPercent || 0) / 8,
    0,
    6,
  )}rem`;
  const desktopTrackWidth = `clamp(18rem, ${desktopRailWidthPercent}%, 21.5rem)`;
  const mobileRailAlignClassName = resolveRailAlignClassName(
    Number(mobileRail.leftPercent || 50),
  );
  const desktopRailJustifyClassName = resolveDesktopRailJustifyClassName(
    Number(desktopRail.leftPercent || DEFAULT_RAIL_CENTER),
  );

  return {
    previewStyle: {
      ["--hall-rail-desktop-track" as string]: desktopTrackWidth,
      ["--hall-rail-desktop-top" as string]: desktopRailTop,
      ["--hall-rail-desktop-nudge" as string]: desktopRailNudge,
      ["--hall-rail-mobile-width" as string]: mobileRailWidth,
      ["--hall-rail-mobile-top" as string]: mobileRailTop,
    } as CSSProperties,
    mobileRailAlignClassName,
    desktopRailJustifyClassName,
  };
};
