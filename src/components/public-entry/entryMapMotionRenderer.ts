import {
  geoDistance,
  geoGraticule10,
  geoOrthographic,
  geoPath,
  type GeoPermissibleObjects,
} from "d3-geo";
import landUrl from "../../data/atlas/land-globe.json?url";
import geographyUrl from "../../data/atlas/globe-geography.json?url";
import nileUrl from "../../assets/public-entry/map-nile.json?url";

type Geometry = GeoPermissibleObjects;
type Label = {
  name: string;
  coordinates: [number, number];
  minZoom: number;
  kind?: string;
};
type Geography = {
  borders: Geometry;
  disputedBorders: Geometry;
  rivers: Geometry;
  deserts: Geometry;
  labels: Label[];
};
type MotionData = Geography & { land: Geometry; nile: Geometry };
export type EntryMapMotionController = {
  setEnabled: (enabled: boolean) => void;
  dispose: () => void;
};
let pending: Promise<MotionData> | undefined;
async function readAsset<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Map asset unavailable");
  return response.json();
}
export function loadEntryMapMotion(): Promise<MotionData> {
  return (pending ??= Promise.all([
    readAsset<Geometry>(landUrl),
    readAsset<Geography>(geographyUrl),
    readAsset<Geometry>(nileUrl),
  ])
    .then(([land, geography, nile]) => ({ land, ...geography, nile }))
    .catch((error) => {
      pending = undefined;
      throw error;
    }));
}

const DURATION = 10;
const STORY_SPEED = 26 / DURATION;
const STILL_TIME = 9.5 / STORY_SPEED;
const stops = [
  [0, 20, 22, 1, 0],
  [5, 105, 25, 1, 0],
  [8, 126.98, 37.57, 5, 1],
  [12, 126.98, 37.57, 5, 1],
  [14, 75, 20, 1.05, 0],
  [16, 31, 18, 1.05, 0],
  [18, 31, 18, 3.2, 1],
  [22, 31, 18, 3.2, 1],
  [26, 20, 22, 1, 0],
];
const hanyang = {
  name: "한양",
  location: "오늘날 서울",
  coordinates: [126.98, 37.57] as [number, number],
  definition: "오늘날 서울에 해당하는 조선의 수도다.",
  era: "1394~1395년",
  story: "태조는 1394년 한양으로 수도를 옮겼다.",
};
const nile = {
  name: "나일강",
  location: "아프리카 동북부",
  coordinates: [30.85326, 18.13691] as [number, number],
  definition: "수단과 이집트를 지나 지중해로 흐르는 강이다.",
  era: "고대",
  story: "이집트인은 범람으로 비옥해진 땅을 농경에 이용했다.",
};
const places: Label[] = [
  { name: "한양", coordinates: hanyang.coordinates, minZoom: 1.6 },
  { name: "금성", coordinates: [129.22, 35.84], minZoom: 1.6 },
  { name: "기자", coordinates: [31.13, 29.98], minZoom: 1.6 },
  { name: "아테네", coordinates: [23.73, 37.98], minZoom: 1.6 },
  { name: "로마", coordinates: [12.5, 41.9], minZoom: 1.6 },
  { name: "베이징", coordinates: [116.4, 39.9], minZoom: 1.6 },
];
const smooth = (value: number) => {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, progress: number) => a + (b - a) * progress;
const reveal = (time: number, start: number, end: number) =>
  smooth((time - start) / (0.3 * STORY_SPEED)) *
  (1 - smooth((time - end) / (0.3 * STORY_SPEED)));
function cameraAt(time: number) {
  const index = Math.max(
    0,
    stops.findIndex(
      (stop, i) =>
        i < stops.length - 1 && time >= stop[0] && time <= stops[i + 1][0],
    ),
  );
  const a = stops[index],
    b = stops[index + 1];
  const p = smooth((time - a[0]) / (b[0] - a[0]));
  return {
    longitude: lerp(a[1], b[1], p),
    latitude: lerp(a[2], b[2], p),
    zoom: lerp(a[3], b[3], p),
    offset: lerp(a[4], b[4], p),
  };
}

/** Local presentation only; the SVG owns its frames without rerendering the public page. */
export function mountEntryMapMotion(
  root: HTMLDivElement,
  data: MotionData,
  initiallyEnabled: boolean,
): EntryMapMotionController {
  const element = <T extends Element>(selector: string) => {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`Missing map element: ${selector}`);
    return found;
  };
  const layer = <T extends SVGElement>(name: string) =>
    element<T>(`[data-map-layer="${name}"]`);
  const stage = element<HTMLDivElement>(".entry-map-motion__stage");
  const heading = root
    .closest(".entry-map-section")
    ?.querySelector(".entry-heading");
  const svg = element<SVGSVGElement>(".entry-map-motion__map");
  const detail = element<HTMLElement>(".entry-map-motion__detail");
  const toggle = element<HTMLButtonElement>("[data-map-toggle]");
  const buttons = [
    ...root.querySelectorAll<HTMLButtonElement>("[data-map-scene]"),
  ];
  const announcement = element<HTMLElement>(".entry-map-motion__announcement");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let enabled = initiallyEnabled,
    playing = true,
    visible = false,
    disposed = false;
  let elapsed = enabled && !reduced.matches ? 0 : STILL_TIME;
  let width = stage.clientWidth,
    height = stage.clientHeight;
  let frame = 0,
    lastTime = 0,
    geometryKey = "",
    previousScene = "",
    previousDetail = "";
  const projection = geoOrthographic().clipAngle(90).precision(0.5);
  const path = geoPath(projection).digits(1);
  const grid = geoGraticule10();
  const shade = layer<SVGCircleElement>("shade");
  const viewport = layer<SVGCircleElement>("viewport");
  const selection = layer<SVGGElement>("selection");
  const badge = layer<SVGGElement>("badge");
  const badgeText = badge.querySelector("text")!;
  const badgeRect = badge.querySelector("rect")!;
  const rings = [
    ...selection.querySelectorAll<SVGCircleElement>(
      ".entry-map-motion__ripple",
    ),
  ];
  const river = layer<SVGPathElement>("river-selected"),
    riverHalo = layer<SVGPathElement>("river-halo");
  const shapes: [SVGPathElement, Geometry][] = [
    [layer("ocean"), { type: "Sphere" }],
    [layer("grid"), grid],
    [layer("land"), data.land],
    [layer("desert"), data.deserts],
    [layer("borders"), data.borders],
    [layer("disputed"), data.disputedBorders],
    [layer("rivers"), data.rivers],
    [river, data.nile],
    [riverHalo, data.nile],
  ];
  const labelsRoot = layer<SVGGElement>("labels");
  const labels = [
    ...places,
    ...data.labels.filter((item) =>
      [
        "북대서양",
        "북태평양",
        "인도양",
        "지중해",
        "사하라 사막",
        "고비 사막",
      ].includes(item.name),
    ),
  ].map((item) => {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    if (!item.kind) {
      const dot = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      dot.setAttribute("class", "entry-map-motion__dot");
      dot.setAttribute("r", "3");
      group.append(dot);
    }
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("class", "entry-map-motion__place-label");
    text.setAttribute("x", "8");
    text.setAttribute("y", "-8");
    text.textContent = item.name;
    group.append(text);
    labelsRoot.append(group);
    return { ...item, group };
  });
  const canMove = () => enabled && !reduced.matches;
  const canPlay = () => canMove() && playing && visible && !document.hidden;
  const setText = (selector: string, value: string) => {
    element<HTMLElement>(selector).textContent = value;
  };
  function render() {
    if (disposed || !width || !height) return;
    const time = elapsed * STORY_SPEED,
      camera = cameraAt(time),
      compact = width < 800;
    const hOpacity = reveal(time, 7.8, 11.7),
      nOpacity = reveal(time, 17.8, 21.7),
      opacity = Math.max(hOpacity, nOpacity);
    const selected =
      time >= 6.8 && time < 12.8
        ? hanyang
        : time >= 17 && time < 22.8
          ? nile
          : null;
    const pointOpacity = selected
      ? reveal(
          time,
          selected === hanyang ? 6.8 : 17,
          selected === hanyang ? 12 : 22,
        )
      : 0;
    const currentDetail = nOpacity > hOpacity ? nile : hanyang;
    if (previousDetail !== currentDetail.name) {
      previousDetail = currentDetail.name;
      setText("[data-map-name]", currentDetail.name);
      setText("[data-map-location]", currentDetail.location);
      setText("[data-map-definition]", currentDetail.definition);
      setText("[data-map-era]", currentDetail.era);
      setText("[data-map-story]", currentDetail.story);
    }
    const x = lerp(
      width / 2,
      compact ? width * 0.52 : width * 0.44,
      camera.offset,
    );
    const y = lerp(
      height * (compact ? 0.36 : 0.5),
      height * (compact ? 0.3 : 0.52),
      camera.offset,
    );
    const radius =
      (compact
        ? Math.min(width * 0.46, height * 0.34)
        : Math.min(width, height) * 0.36) * camera.zoom;
    projection
      .translate([x, y])
      .rotate([-camera.longitude, -camera.latitude, 0])
      .scale(radius)
      .clipExtent([
        [-width * 0.15, -height * 0.2],
        [width * 1.15, height * 1.2],
      ]);
    const key = [
      camera.longitude,
      camera.latitude,
      camera.zoom,
      camera.offset,
      width,
      height,
    ]
      .map((value) => value.toFixed(3))
      .join(",");
    if (key !== geometryKey) {
      geometryKey = key;
      viewport.setAttribute("cx", String(width / 2));
      viewport.setAttribute("cy", String(height * (compact ? 0.36 : 0.5)));
      viewport.setAttribute(
        "r",
        String(
          Math.min(
            width * 0.49,
            height * (compact ? 0.36 : lerp(0.38, 0.48, camera.offset)),
          ),
        ),
      );
      shapes.forEach(([shape, geometry]) =>
        shape.setAttribute("d", path(geometry) || ""),
      );
      shade.setAttribute("cx", String(x));
      shade.setAttribute("cy", String(y));
      shade.setAttribute("r", String(radius));
    }
    const occupied: number[][] = [];
    if (heading) {
      const copy = heading.getBoundingClientRect();
      const bounds = stage.getBoundingClientRect();
      occupied.push([
        copy.left - bounds.left - 8,
        copy.top - bounds.top - 8,
        copy.right - bounds.left + 8,
        copy.bottom - bounds.top + 8,
      ]);
    }
    if (opacity > 0.05)
      occupied.push([
        detail.offsetLeft - 8,
        detail.offsetTop - 8,
        detail.offsetLeft + detail.offsetWidth + 8,
        detail.offsetTop + detail.offsetHeight + 8,
      ]);
    if (selected) {
      const point = projection(selected.coordinates)!;
      occupied.push([
        point[0] - 20,
        point[1] - 24,
        point[0] + 100,
        point[1] + 24,
      ]);
      selection.setAttribute("transform", `translate(${point[0]} ${point[1]})`);
      badge.setAttribute(
        "transform",
        `translate(${Math.min(width - 100, point[0] + 12)} ${point[1] - 15})`,
      );
      badgeText.textContent = selected.name;
      badgeRect.setAttribute("width", String(selected.name.length * 14 + 24));
    }
    labels.forEach((item) => {
      const point = projection(item.coordinates)!;
      const box = [
        point[0] + 4,
        point[1] - 24,
        point[0] + item.name.length * 14 + 20,
        point[1] - 3,
      ];
      const collision = occupied.some(
        (other) =>
          box[0] < other[2] &&
          box[2] > other[0] &&
          box[1] < other[3] &&
          box[3] > other[1],
      );
      const show =
        camera.zoom >= item.minZoom &&
        geoDistance(item.coordinates, [camera.longitude, camera.latitude]) <
          Math.PI * 0.47 &&
        box[0] > 8 &&
        box[2] < width - 8 &&
        box[1] > 48 &&
        box[3] < height - 32 &&
        !collision &&
        item.name !== selected?.name;
      item.group.style.display = show ? "" : "none";
      if (show) {
        item.group.setAttribute(
          "transform",
          `translate(${point[0].toFixed(1)} ${point[1].toFixed(1)})`,
        );
        occupied.push(box);
      }
    });
    selection.style.opacity = String(selected === hanyang ? pointOpacity : 0);
    river.style.opacity = String(selected === nile ? pointOpacity : 0);
    riverHalo.style.opacity = String(
      selected === nile
        ? pointOpacity *
            (0.12 + 0.08 * (0.5 + 0.5 * Math.sin((elapsed * Math.PI) / 1.2)))
        : 0,
    );
    badge.style.opacity = String(pointOpacity);
    rings.forEach((ring, index) => {
      const phase = canMove() ? (elapsed / 2.4 + index * 0.5) % 1 : 0.3;
      ring.setAttribute("r", String(8 + 20 * phase));
      ring.style.opacity = String(0.65 * (1 - phase));
    });
    detail.style.opacity = String(opacity);
    detail.style.transform = `translateY(${(1 - opacity) * 12}px)`;
    detail.setAttribute("aria-hidden", String(opacity < 0.5));
    const scene =
      time >= 5 && time < 13
        ? "hanyang"
        : time >= 16 && time < 23
          ? "nile"
          : "globe";
    if (scene !== previousScene) {
      previousScene = scene;
      buttons.forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.mapScene === scene),
        ),
      );
    }
    toggle.textContent = !canMove()
      ? "모션 OFF"
      : playing
        ? "일시정지"
        : "재생";
    toggle.disabled = !canMove();
    toggle.setAttribute(
      "aria-label",
      !canMove()
        ? "지도 모션 꺼짐"
        : playing
          ? "지도 모션 일시정지"
          : "지도 모션 재생",
    );
    root.dataset.scene = scene;
    root.dataset.playing = String(canPlay());
    root.dataset.time = elapsed.toFixed(2);
  }
  function tick(now: number) {
    frame = 0;
    if (!canPlay() || disposed) {
      lastTime = 0;
      return;
    }
    if (!lastTime) lastTime = now;
    if (now - lastTime >= 1000 / 30) {
      elapsed = (elapsed + Math.min((now - lastTime) / 1000, 0.1)) % DURATION;
      lastTime = now;
      render();
    }
    frame = requestAnimationFrame(tick);
  }
  function updatePlayback() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
    render();
    if (canPlay() && !disposed) frame = requestAnimationFrame(tick);
  }
  const clickScene = (event: Event) => {
    const button = event.currentTarget as HTMLButtonElement;
    elapsed =
      { globe: 2.5, hanyang: 9.5, nile: 19.5 }[
        button.dataset.mapScene as "globe" | "hanyang" | "nile"
      ] / STORY_SPEED;
    playing = false;
    announcement.textContent = `${button.textContent} 장면. 재생이 일시정지되었습니다.`;
    updatePlayback();
  };
  const clickToggle = () => {
    playing = !playing;
    announcement.textContent = playing
      ? "지도 모션을 재생합니다."
      : "지도 모션이 일시정지되었습니다.";
    updatePlayback();
  };
  const motionChange = () => {
    updatePlayback();
  };
  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      updatePlayback();
    },
    { threshold: 0.1 },
  );
  observer.observe(root);
  const resize = new ResizeObserver(() => {
    width = stage.clientWidth;
    height = stage.clientHeight;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    geometryKey = "";
    render();
  });
  resize.observe(stage);
  buttons.forEach((button) => button.addEventListener("click", clickScene));
  toggle.addEventListener("click", clickToggle);
  document.addEventListener("visibilitychange", updatePlayback);
  reduced.addEventListener("change", motionChange);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  render();
  return {
    setEnabled(value) {
      enabled = value;
      motionChange();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      labelsRoot.replaceChildren();
      buttons.forEach((button) =>
        button.removeEventListener("click", clickScene),
      );
      toggle.removeEventListener("click", clickToggle);
      document.removeEventListener("visibilitychange", updatePlayback);
      reduced.removeEventListener("change", motionChange);
    },
  };
}
