export interface GlobeView {
  longitude: number;
  latitude: number;
  roll: number;
  zoom: number;
}

export const GLOBE_INITIAL_VIEW: GlobeView = {
  longitude: 105,
  latitude: 25,
  roll: 0,
  zoom: 1,
};
export const GLOBE_MAX_ZOOM = 6;
export const GLOBE_PIXEL_BUDGET = 2_000_000;

export function wrapGlobeLongitude(value: number): number {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

export function constrainGlobeView(view: GlobeView): GlobeView {
  const finite = (value: number, fallback: number) =>
    Number.isFinite(value) ? value : fallback;
  return {
    longitude: wrapGlobeLongitude(finite(view.longitude, 0)),
    latitude: Math.max(-89.5, Math.min(89.5, finite(view.latitude, 0))),
    roll: wrapGlobeLongitude(finite(view.roll, 0)),
    zoom: Math.max(1, Math.min(GLOBE_MAX_ZOOM, finite(view.zoom, 1))),
  };
}

/** Follow the shortest rotation while preserving the displayed camera at t=0. */
export function interpolateGlobeView(
  from: GlobeView,
  to: GlobeView,
  progress: number,
): GlobeView {
  const t = Math.max(0, Math.min(1, progress));
  return constrainGlobeView({
    longitude:
      from.longitude + wrapGlobeLongitude(to.longitude - from.longitude) * t,
    latitude: from.latitude + (to.latitude - from.latitude) * t,
    roll: from.roll + wrapGlobeLongitude(to.roll - from.roll) * t,
    zoom: from.zoom * (to.zoom / from.zoom) ** t,
  });
}

/** Drag distances are in CSS pixels, independent of the backing-buffer DPR. */
export function dragGlobeView(
  view: GlobeView,
  dx: number,
  dy: number,
  radius: number,
): GlobeView {
  const radians = (view.roll * Math.PI) / 180;
  const horizontal = dx * Math.cos(radians) - dy * Math.sin(radians);
  const vertical = dx * Math.sin(radians) + dy * Math.cos(radians);
  const degreesPerPixel = 180 / (Math.PI * Math.max(40, radius));
  return constrainGlobeView({
    ...view,
    longitude: view.longitude - horizontal * degreesPerPixel,
    latitude: view.latitude + vertical * degreesPerPixel,
  });
}

type GlobeScreenPoint = { x: number; y: number };

/** Screen-space clockwise finger rotation is negative d3 projection gamma. */
export function pinchGlobeView(
  view: GlobeView,
  before: [GlobeScreenPoint, GlobeScreenPoint],
  after: [GlobeScreenPoint, GlobeScreenPoint],
  radius: number,
): GlobeView {
  const distance = (points: [GlobeScreenPoint, GlobeScreenPoint]) =>
    Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  const angle = (points: [GlobeScreenPoint, GlobeScreenPoint]) =>
    Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x);
  const shifted = dragGlobeView(
    view,
    (after[0].x + after[1].x - before[0].x - before[1].x) / 2,
    (after[0].y + after[1].y - before[0].y - before[1].y) / 2,
    radius,
  );
  return constrainGlobeView({
    ...shifted,
    zoom: (view.zoom * distance(after)) / Math.max(12, distance(before)),
    roll: view.roll - ((angle(after) - angle(before)) * 180) / Math.PI,
  });
}

export function focusGlobeView(
  view: GlobeView,
  coordinates: [number, number],
): GlobeView {
  return constrainGlobeView({
    longitude: coordinates[0],
    latitude: coordinates[1],
    roll: 0,
    zoom: Math.max(1.8, view.zoom),
  });
}

/** Orthographic projection must never show the mirrored back hemisphere. */
export function isGlobePointVisible(
  coordinates: [number, number],
  view: GlobeView,
): boolean {
  const radians = Math.PI / 180;
  const lat = coordinates[1] * radians;
  const centerLat = view.latitude * radians;
  const longitudeDelta = (coordinates[0] - view.longitude) * radians;
  return (
    Math.sin(lat) * Math.sin(centerLat) +
      Math.cos(lat) * Math.cos(centerLat) * Math.cos(longitudeDelta) >
    0.001
  );
}

export function globeCanvasSize(
  width: number,
  height: number,
  devicePixelRatio: number,
) {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const dpr = Math.min(
    2,
    Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1),
    Math.sqrt(GLOBE_PIXEL_BUDGET / (safeWidth * safeHeight)),
  );
  return {
    dpr,
    pixelWidth: Math.max(1, Math.floor(safeWidth * dpr)),
    pixelHeight: Math.max(1, Math.floor(safeHeight * dpr)),
  };
}

export function nearestGlobePoint<T extends { x: number; y: number }>(
  points: T[],
  x: number,
  y: number,
  radius = 22,
): T | undefined {
  let closest: T | undefined;
  let distance = radius * radius;
  for (const point of points) {
    const squared = (point.x - x) ** 2 + (point.y - y) ** 2;
    if (squared <= distance) {
      closest = point;
      distance = squared;
    }
  }
  return closest;
}
