import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  geoCentroid,
  geoGraticule10,
  geoOrthographic,
  geoPath,
  type GeoPermissibleObjects,
} from "d3-geo";
import {
  ATLAS_SUBJECT_LABELS,
  normalizeAtlasSearch,
  type AtlasDataset,
  type AtlasEntry,
  type AtlasPlace,
  type AtlasSubject,
} from "../../lib/historyAtlas";
import {
  GLOBE_FRAME_INTERVAL,
  GLOBE_INITIAL_VIEW,
  GLOBE_MAX_ZOOM,
  constrainGlobeView,
  dragGlobeView,
  focusGlobeView,
  globeCanvasSize,
  isGlobePointVisible,
  nearestGlobePoint,
  pinchGlobeView,
  type GlobeView,
} from "../../lib/historyGlobeMath";
import {
  atlasProjectedNorthBearing,
  atlasShapeLabelAnchor,
  fitGlobeRegionCamera,
  loadAtlasDokdoGeometry,
  loadAtlasRiverGeometry,
  withAtlasDokdoLand,
} from "../../lib/historyAtlasGeometry";
import {
  findAtlasRiver,
  type AtlasRiverCollection,
} from "../../lib/historyAtlasRivers";
import { findAtlasLandform } from "../../lib/historyAtlasLandforms";
import {
  findAtlasArea,
  findAtlasRegionArea,
  isAtlasAreaPlace,
  loadAtlasAreaGeometry,
  matchesAtlasCurrentRegion,
  type AtlasAreaCollection,
} from "../../lib/historyAtlasAreas";
import type { MultiPolygon } from "geojson";
import { acquirePageScrollLock } from "../../lib/pageScrollLock";
import AtlasPlaceDetails from "./AtlasPlaceDetails";
import AtlasAreaDetails from "./AtlasAreaDetails";
import AtlasRegionFilters from "./AtlasRegionFilters";
import AtlasCompass from "./AtlasCompass";
import {
  ATLAS_KOREA_PROVINCES,
  ATLAS_WORLD_REGION_GROUPS,
} from "../../lib/historyAtlasRegions";
import InfoHelp from "./InfoHelp";
import {
  atlasRiverCreditItems,
  atlasDokdoCreditItems,
} from "./AtlasRiverCredits";
import landUrl from "../../data/atlas/land-globe.json?url";
import geographyUrl from "../../data/atlas/globe-geography.json?url";
import {
  ATLAS_DOKDO_COORDINATES,
  ATLAS_DOKDO_ID,
} from "../../data/historyAtlasDokdo";
import "./historyGlobe.css";

type Item = {
  entry: AtlasEntry;
  place: AtlasPlace;
  subject: AtlasSubject;
  names: string[];
  aliases: string[];
  search: string;
};
type Point = { item: Item; x: number; y: number };
type GlobeSubject = "all" | AtlasSubject;
type GlobeGeography = {
  borders: GeoPermissibleObjects;
  disputedBorders: GeoPermissibleObjects;
  rivers: GeoPermissibleObjects;
  deserts: MultiPolygon;
  labels: {
    name: string;
    kind: "ocean" | "desert" | "terrain" | "river" | "country";
    coordinates: [number, number];
    minZoom: number;
  }[];
};
type Pointer = { x: number; y: number };
type Gesture = {
  points: Pointer[];
  view: GlobeView;
  moved: boolean;
  multiple: boolean;
};
const PAGE_SIZE = 40;
function selectionViewport(
  width: number,
  height: number,
  popup: HTMLElement | null,
) {
  const frame = { left: 32, top: 64, right: width - 32, bottom: height - 64 };
  if (!popup) return frame;
  if (width >= 650) frame.left = popup.offsetLeft + popup.offsetWidth + 24;
  else frame.top = popup.offsetTop + popup.offsetHeight + 24;
  return frame;
}
// Both portal layouts use the same DESIGN contract, even without inherited tokens.
const GLOBE_COLORS = {
  "--ws-surface-subtle": "#f8fafc",
  "--ws-primary-soft": "#eff6ff",
  "--ws-border-blue": "#dbeafe",
  "--ws-surface": "#ffffff",
  "--ws-text-soft": "#9ca3af",
  "--ws-primary": "#2563eb",
  "--ws-primary-text": "#1e3a8a",
  "--ws-text": "#1f2937",
  "--ws-text-muted": "#6b7280",
  "--ws-accent-soft": "#fffbeb",
  "--ws-accent-text": "#92400e",
} as const;
const grid = geoGraticule10();
let landPromise: Promise<GeoPermissibleObjects> | undefined;
function loadLand() {
  if (!landPromise)
    landPromise = Promise.all([
      fetch(landUrl).then((response) => {
        if (!response.ok) throw new Error("지형을 불러오지 못했다.");
        return response.json() as Promise<GeoPermissibleObjects>;
      }),
      loadAtlasDokdoGeometry(),
    ])
      .then(([land, dokdo]) => withAtlasDokdoLand(land, dokdo))
      .catch((error) => {
        landPromise = undefined;
        throw error;
      });
  return landPromise;
}
// The common place name remains searchable and visible across historical eras.
// Period-specific names belong in the selected story, not the browse list.
const nameOf = (item: Item) => item.place.name;
const koreanNames = new Intl.Collator("ko-KR", { numeric: true });
function matchesGlobeRegion(
  item: Item,
  subject: GlobeSubject,
  groupId: string,
  subregionId = "",
  areas: AtlasAreaCollection | null = null,
) {
  if (!groupId) return true;
  if (subject !== "all")
    return matchesAtlasCurrentRegion(
      item.place,
      subject,
      groupId,
      subregionId,
      areas,
    );
  const [regionSubject, regionGroup] = groupId.split(":");
  return (
    item.subject === regionSubject &&
    matchesAtlasCurrentRegion(
      item.place,
      item.subject,
      regionGroup,
      subregionId,
      areas,
    )
  );
}
let geographyPromise: Promise<GlobeGeography> | undefined;
function loadGeography() {
  if (!geographyPromise)
    geographyPromise = fetch(geographyUrl)
      .then((response) => {
        if (!response.ok) throw new Error("지리 정보를 불러오지 못했다.");
        return response.json() as Promise<GlobeGeography>;
      })
      .catch((error) => {
        geographyPromise = undefined;
        throw error;
      });
  return geographyPromise;
}

interface HistoryGlobeProps {
  dataset: AtlasDataset;
  initialSubject?: GlobeSubject;
  navigation?: ReactNode;
}

export default function HistoryGlobe({
  dataset,
  initialSubject = "all",
  navigation,
}: HistoryGlobeProps) {
  const id = useId();
  const rootRef = useRef<HTMLElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef<HTMLOutputElement>(null);
  const compassRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<SVGSVGElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);
  const riverHaloRef = useRef<SVGPathElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const pendingPanelFocus = useRef<"detail" | "list" | null>(null);
  const [wide, setWide] = useState(false);
  const [size, setSize] = useState({ width: 600, height: 400 });
  const [popupSize, setPopupSize] = useState({ width: 0, height: 0 });
  const [subject, setSubject] = useState<GlobeSubject>(initialSubject);
  const [unitId, setUnitId] = useState("");
  const [eraId, setEraId] = useState("");
  const [regionId, setRegionId] = useState("");
  const [subregionId, setSubregionId] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [page, setPage] = useState(0);
  const [panel, setPanel] = useState<"list" | "detail">("list");
  const [panelOpen, setPanelOpen] = useState(false);
  const [provinceDetailOpen, setProvinceDetailOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [land, setLand] = useState<GeoPermissibleObjects | null>(null);
  const [geography, setGeography] = useState<GlobeGeography | null>(null);
  const [landError, setLandError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [rivers, setRivers] = useState<AtlasRiverCollection | null>(null);
  const [riverError, setRiverError] = useState(false);
  const [riverAttempt, setRiverAttempt] = useState(0);
  const [areas, setAreas] = useState<AtlasAreaCollection | null>(null);
  const [areaError, setAreaError] = useState(false);
  const [areaAttempt, setAreaAttempt] = useState(0);
  const [view, setView] = useState<GlobeView>(GLOBE_INITIAL_VIEW);
  const [motionPaused, setMotionPaused] = useState(false);
  const viewRef = useRef(view);
  const pointers = useRef(new Map<number, Pointer>());
  const gesture = useRef<Gesture | null>(null);
  const drawnPoints = useRef<Point[]>([]);
  const hitGeography = useRef<(x: number, y: number) => Item | undefined>(
    () => undefined,
  );
  const drawRef = useRef<() => void>(() => {});
  const raf = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDraw = useRef(0);
  const dirty = useRef(true);
  const inView = useRef(true);

  const units = useMemo(
    () => new Map(dataset.units.map((unit) => [unit.id, unit])),
    [dataset.units],
  );
  const items = useMemo(() => {
    const places = new Map(dataset.places.map((place) => [place.id, place]));
    return dataset.entries.flatMap((entry) => {
      const place = places.get(entry.placeId),
        unit = units.get(entry.unitId);
      if (!place || !unit) return [];
      const names = [entry.displayName || place.name, place.name].map(
        normalizeAtlasSearch,
      );
      const aliases = [place.modernName || "", ...(place.aliases || [])].map(
        normalizeAtlasSearch,
      );
      return [
        {
          entry,
          place,
          subject: unit.subject,
          names,
          aliases,
          search: [
            ...names,
            ...aliases,
            entry.title,
            entry.period,
            entry.nameNote || "",
          ]
            .map(normalizeAtlasSearch)
            .join("\0"),
        },
      ];
    });
  }, [dataset.entries, dataset.places, units]);
  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.entry.id, item])),
    [items],
  );
  const selected = selectedId ? itemsById.get(selectedId) : undefined;
  const dokdoItem = useMemo(
    () =>
      items.find(
        (item) => item.subject === "korea" && item.place.id === ATLAS_DOKDO_ID,
      ),
    [items],
  );
  const filtered = useMemo(() => {
    const normalized = normalizeAtlasSearch(query);
    const result = items.filter(
      (item) =>
        (subject === "all" || item.subject === subject) &&
        (!unitId || item.entry.unitId === unitId) &&
        (!eraId || item.entry.eraIds?.includes(eraId)) &&
        matchesGlobeRegion(item, subject, regionId, subregionId, areas) &&
        (!normalized || item.search.includes(normalized)),
    );
    if (normalized) {
      const rank = (item: Item) =>
        item.names.includes(normalized)
          ? 0
          : item.aliases.includes(normalized)
            ? 1
            : item.names.some((name) => name.startsWith(normalized))
              ? 2
              : 3;
      result.sort((a, b) => rank(a) - rank(b));
    }
    // One selectable row and marker per place, preserving the best matching era.
    const unique = new Map<string, Item>();
    for (const item of result) {
      if (!unique.has(item.place.id)) unique.set(item.place.id, item);
    }
    return [...unique.values()].sort((a, b) =>
      koreanNames.compare(nameOf(a), nameOf(b)),
    );
  }, [items, subject, unitId, eraId, regionId, subregionId, query, areas]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const mapItems = useMemo(() => {
    const result = filtered.filter((item) => item.place.coordinates);
    if (dokdoItem && !result.some((item) => item.place.id === ATLAS_DOKDO_ID))
      result.push(dokdoItem);
    if (selected?.place.coordinates) {
      const index = result.findIndex(
        (item) => item.place.id === selected.place.id,
      );
      if (index < 0) result.push(selected);
      else result[index] = selected;
    }
    return result;
  }, [filtered, selected, dokdoItem]);
  const selectedRiver = useMemo(
    () => (selected && rivers ? findAtlasRiver(selected.place, rivers) : null),
    [selected, rivers],
  );
  const selectedLandform = useMemo(
    () =>
      selected && geography
        ? findAtlasLandform(selected.place, geography)
        : null,
    [selected, geography],
  );
  const selectedArea = useMemo(
    () => (selected && areas ? findAtlasArea(selected.place, areas) : null),
    [selected, areas],
  );
  const provinceArea = useMemo(() => {
    if (!areas || selected) return null;
    const region = (subregionId || regionId).replace(/^(korea|world):/, "");
    return region ? findAtlasRegionArea(region, areas) : null;
  }, [areas, selected, regionId, subregionId]);
  const selectedShape = selectedRiver || selectedLandform || selectedArea;
  const highlightedShape = selectedShape || provinceArea;
  const highlightedArea = selectedLandform || selectedArea || provinceArea;
  const detailOpen =
    (selected && panel === "detail") || (provinceArea && provinceDetailOpen);
  const selectableGeography = useMemo(
    () =>
      filtered.flatMap((item) => {
        const river = rivers ? findAtlasRiver(item.place, rivers) : null;
        const area =
          (areas ? findAtlasArea(item.place, areas) : null) ||
          (geography ? findAtlasLandform(item.place, geography) : null);
        return river || area
          ? [{ item, shape: (river || area)!, area: !!area }]
          : [];
      }),
    [filtered, rivers, geography, areas],
  );
  const displayedPlace = useMemo(
    () =>
      selected && selectedRiver
        ? {
            ...selected.place,
            coordinates: geoCentroid(selectedRiver) as [number, number],
            locationNote:
              "확인된 현대 수계의 물줄기를 선으로 표시한다. 지도 축척에 맞춰 작은 굴곡은 단순화했다.",
          }
        : selected && selectedArea
          ? {
              ...selected.place,
              locationNote: selectedArea.properties.locationNote,
            }
          : selected?.place,
    [selected?.place, selectedRiver, selectedArea],
  );

  const cancelDraw = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    if (timer.current !== null) clearTimeout(timer.current);
    raf.current = null;
    timer.current = null;
  }, []);
  const requestDraw = useCallback(() => {
    dirty.current = true;
    if (
      document.hidden ||
      !inView.current ||
      raf.current !== null ||
      timer.current !== null
    )
      return;
    const queue = () => {
      timer.current = null;
      if (document.hidden || !inView.current) return;
      raf.current = requestAnimationFrame(() => {
        raf.current = null;
        if (document.hidden || !inView.current || !dirty.current) return;
        dirty.current = false;
        drawRef.current();
        lastDraw.current = performance.now();
      });
    };
    const delay = GLOBE_FRAME_INTERVAL - (performance.now() - lastDraw.current);
    if (delay > 0) timer.current = setTimeout(queue, delay);
    else queue();
  }, []);
  const updateView = useCallback(
    (next: GlobeView) => {
      viewRef.current = constrainGlobeView(next);
      requestDraw();
    },
    [requestDraw],
  );
  const commitView = useCallback(() => setView({ ...viewRef.current }), []);
  const setCamera = useCallback(
    (next: GlobeView) => {
      updateView(next);
      setView({ ...viewRef.current });
    },
    [updateView],
  );

  useEffect(() => {
    let active = true;
    setLandError(false);
    Promise.all([loadLand(), loadGeography()])
      .then(([value, detail]) => {
        if (active) {
          setLand(value);
          setGeography(detail);
        }
      })
      .catch(() => {
        if (active) setLandError(true);
      });
    return () => {
      active = false;
    };
  }, [loadAttempt]);
  useEffect(() => {
    let active = true;
    setRiverError(false);
    loadAtlasRiverGeometry("world")
      .then((value) => {
        if (active) setRivers(value);
      })
      .catch(() => {
        if (active) setRiverError(true);
      });
    return () => {
      active = false;
    };
  }, [riverAttempt]);
  useEffect(() => {
    let active = true;
    setAreaError(false);
    loadAtlasAreaGeometry("all")
      .then((value) => {
        if (active) setAreas(value);
      })
      .catch(() => {
        if (active) setAreaError(true);
      });
    return () => {
      active = false;
    };
  }, [areaAttempt]);
  useEffect(() => {
    if (!highlightedShape || !mapRef.current) return;
    const center = geoCentroid(highlightedShape);
    if (!center.every(Number.isFinite)) return;
    const width = mapRef.current.clientWidth,
      height = mapRef.current.clientHeight;
    if (!width || !height) return;
    const projection = geoOrthographic()
      .translate([0, 0])
      .scale(1)
      .rotate([-center[0], -center[1], 0])
      .clipAngle(90);
    const [[left, top], [right, bottom]] =
      geoPath(projection).bounds(highlightedShape);
    const viewport = selectionViewport(
      width,
      height,
      detailOpen ? detailRef.current?.parentElement || null : null,
    );
    const scale = Math.min(
      ((viewport.right - viewport.left) * 0.85) /
        Math.max(0.01, 2 * Math.max(Math.abs(left), Math.abs(right))),
      ((viewport.bottom - viewport.top) * 0.85) /
        Math.max(0.01, 2 * Math.max(Math.abs(top), Math.abs(bottom))),
    );
    setCamera({
      longitude: center[0],
      latitude: center[1],
      roll: 0,
      zoom: Math.min(GLOBE_MAX_ZOOM, scale / (Math.min(width, height) * 0.44)),
    });
  }, [
    highlightedShape,
    selectionRevision,
    setCamera,
    size,
    detailOpen,
    popupSize,
  ]);
  useEffect(() => {
    const root = rootRef.current,
      map = mapRef.current;
    if (!root || !map) return;
    const observer = new ResizeObserver(() => {
      if (root.clientWidth > 0) setWide(root.clientWidth >= 900);
      if (map.clientWidth > 0 && map.clientHeight > 0)
        setSize((previous) =>
          previous.width === map.clientWidth &&
          previous.height === map.clientHeight
            ? previous
            : { width: map.clientWidth, height: map.clientHeight },
        );
    });
    observer.observe(root);
    observer.observe(map);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const popup = detailOpen ? detailRef.current?.parentElement : null;
    if (!popup) return;
    const observer = new ResizeObserver(() => {
      const width = popup.offsetWidth,
        height = popup.offsetHeight;
      setPopupSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    });
    observer.observe(popup);
    return () => observer.disconnect();
  }, [detailOpen]);
  useEffect(() => {
    const visibility = () => {
      const paused = document.hidden || !inView.current;
      setMotionPaused(paused);
      if (paused) {
        cancelDraw();
        pointers.current.clear();
        gesture.current = null;
      } else requestDraw();
    };
    document.addEventListener("visibilitychange", visibility);
    visibility();
    const observer = new IntersectionObserver(([entry]) => {
      inView.current = entry.isIntersecting;
      visibility();
    });
    if (mapRef.current) observer.observe(mapRef.current);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      observer.disconnect();
      cancelDraw();
    };
  }, [cancelDraw, requestDraw]);

  useEffect(() => {
    drawRef.current = () => {
      const canvas = canvasRef.current,
        root = rootRef.current;
      if (!canvas || !root) return;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      const { width, height } = size;
      const backing = globeCanvasSize(
        width,
        height,
        window.devicePixelRatio || 1,
      );
      if (
        canvas.width !== backing.pixelWidth ||
        canvas.height !== backing.pixelHeight
      ) {
        canvas.width = backing.pixelWidth;
        canvas.height = backing.pixelHeight;
      }
      context.setTransform(backing.dpr, 0, 0, backing.dpr, 0, 0);
      const tokens = getComputedStyle(root);
      const color = (token: keyof typeof GLOBE_COLORS) =>
        tokens.getPropertyValue(token).trim() || GLOBE_COLORS[token];
      const camera = viewRef.current;
      const zoomLabel = `${Math.round(camera.zoom * 100)}%`;
      if (zoomRef.current && zoomRef.current.textContent !== zoomLabel)
        zoomRef.current.textContent = zoomLabel;
      const popup = detailOpen
        ? detailRef.current?.parentElement || null
        : null;
      const selectionFrame = selectionViewport(width, height, popup);
      const projection = geoOrthographic()
        .translate([
          popup ? (selectionFrame.left + selectionFrame.right) / 2 : width / 2,
          popup
            ? (selectionFrame.top + selectionFrame.bottom) / 2
            : height * 0.5,
        ])
        .scale(Math.min(width, height) * 0.44 * camera.zoom)
        .rotate([-camera.longitude, -camera.latitude, camera.roll])
        .clipAngle(90)
        .precision(0.5);
      compassRef.current?.style.setProperty(
        "--atlas-compass-bearing",
        `${atlasProjectedNorthBearing(projection, [camera.longitude, camera.latitude])}deg`,
      );
      const path = geoPath(projection, context);
      context.fillStyle = color("--ws-surface-subtle");
      context.fillRect(0, 0, width, height);
      context.beginPath();
      path({ type: "Sphere" });
      context.fillStyle = color("--ws-primary-soft");
      context.fill();
      context.strokeStyle = color("--ws-border-blue");
      context.lineWidth = 1;
      context.stroke();
      context.beginPath();
      path(grid);
      context.strokeStyle = color("--ws-border-blue");
      context.lineWidth = 0.6;
      context.stroke();
      if (land) {
        context.beginPath();
        path(land);
        context.fillStyle = color("--ws-surface");
        context.fill();
        context.strokeStyle = color("--ws-text-soft");
        context.lineWidth = 0.7;
        context.stroke();
      }
      if (geography) {
        context.beginPath();
        path(geography.deserts);
        context.fillStyle = color("--ws-accent-soft");
        context.fill();
        context.beginPath();
        path(geography.borders);
        context.strokeStyle = color("--ws-text-soft");
        context.lineWidth = 0.9;
        context.stroke();
        context.beginPath();
        path(geography.disputedBorders);
        context.setLineDash([4, 4]);
        context.stroke();
        context.setLineDash([]);
        context.beginPath();
        path(geography.rivers);
        context.strokeStyle = color("--ws-primary");
        context.globalAlpha = 0.45;
        context.lineWidth = 1.3;
        context.stroke();
        context.globalAlpha = 1;
      }
      // Draw the same verified courses that are used for hit testing. The
      // overview layer alone omits small rivers and cannot identify a place.
      for (const feature of selectableGeography) {
        if (feature.area) continue;
        context.beginPath();
        path(feature.shape);
        context.strokeStyle = color("--ws-primary");
        context.globalAlpha = 0.45;
        context.lineWidth = 1.3;
        context.stroke();
      }
      context.globalAlpha = 1;
      if (highlightedShape) {
        context.beginPath();
        path(highlightedShape);
        if (highlightedArea) {
          context.fillStyle = color("--ws-primary-soft");
          context.fill();
        }
        context.strokeStyle = color("--ws-primary");
        context.lineWidth = 3;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.stroke();
      }
      riverHaloRef.current?.setAttribute(
        "d",
        highlightedShape
          ? geoPath(projection).digits(1)(highlightedShape) || ""
          : "",
      );
      // Build projected, hemisphere-clipped paths only on a click, not while
      // dragging. CSS-pixel coordinates stay independent of canvas DPR.
      hitGeography.current = (x, y) => {
        const projected = geoPath(projection);
        context.save();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.lineWidth = 14;
        context.lineCap = "round";
        context.lineJoin = "round";
        try {
          // River strokes take priority where a river crosses a desert.
          for (const area of [false, true]) {
            for (const feature of selectableGeography) {
              if (feature.area !== area) continue;
              const shape = projected(feature.shape);
              if (!shape) continue;
              const target = new Path2D(shape);
              if (
                area
                  ? context.isPointInPath(target, x, y)
                  : context.isPointInStroke(target, x, y)
              )
                return feature.item;
            }
          }
        } finally {
          context.restore();
        }
        return undefined;
      };
      const points: Point[] = [];
      const addPoint = (item: Item, coordinates: [number, number] | null) => {
        if (!coordinates || !isGlobePointVisible(coordinates, camera)) return;
        const xy = projection(coordinates);
        if (!xy || xy[0] < 0 || xy[1] < 0 || xy[0] > width || xy[1] > height)
          return;
        points.push({ item, x: xy[0], y: xy[1] });
      };
      for (const item of mapItems) {
        if (selectedShape && item.place.id === selected?.place.id) continue;
        addPoint(
          item,
          item.place.id === ATLAS_DOKDO_ID
            ? ATLAS_DOKDO_COORDINATES
            : item.place.coordinates,
        );
      }
      // Shape badges are anchored on the visible geometry itself. A centroid
      // can fall outside a winding river or a concave island boundary.
      const shapeAnchor = highlightedShape
        ? atlasShapeLabelAnchor(
            highlightedShape,
            (coordinates) =>
              isGlobePointVisible(coordinates as [number, number], camera)
                ? projection(coordinates as [number, number])
                : null,
            selectionFrame,
          )
        : null;
      if (selected && shapeAnchor)
        points.push({ item: selected, x: shapeAnchor[0], y: shapeAnchor[1] });
      const occupied = new Set<string>();
      const rendered: Point[] = [];
      const ordered = [...points].sort(
        (a, b) =>
          Number(b.item.place.id === selected?.place.id) * 2 +
          Number(b.item.place.id === ATLAS_DOKDO_ID) -
          (Number(a.item.place.id === selected?.place.id) * 2 +
            Number(a.item.place.id === ATLAS_DOKDO_ID)),
      );
      context.fillStyle = color("--ws-primary");
      for (const point of ordered) {
        const cell = Math.floor(point.x / 12) + ":" + Math.floor(point.y / 12);
        const isDokdo = point.item.place.id === ATLAS_DOKDO_ID;
        if (occupied.has(cell) && !isDokdo) continue;
        occupied.add(cell);
        rendered.push(point);
        const active = point.item.place.id === selected?.place.id;
        if (active && selectedShape) continue;
        context.beginPath();
        context.arc(point.x, point.y, active ? 6 : 3, 0, Math.PI * 2);
        context.fill();
        if (active) {
          context.strokeStyle = color("--ws-surface");
          context.lineWidth = 2;
          context.stroke();
        }
      }
      drawnPoints.current = rendered;
      const active = rendered.find(
        (point) => point.item.place.id === selected?.place.id,
      );
      const halo = haloRef.current;
      if (halo) {
        halo.hidden = !active || !!selectedShape;
        if (active) {
          halo.style.left = active.x + "px";
          halo.style.top = active.y + "px";
        }
      }
      const labels = ordered.slice(
        0,
        Math.max(4, Math.min(18, Math.floor(width / 60))),
      );
      const boxes: { x: number; y: number; w: number; h: number }[] = [];
      if (popup)
        boxes.push({
          x: popup.offsetLeft,
          y: popup.offsetTop + popup.offsetHeight / 2,
          w: popup.offsetWidth,
          h: popup.offsetHeight,
        });
      const provinceLabel =
        provinceArea && shapeAnchor
          ? (() => {
              context.font = "700 14px 'Noto Sans KR', sans-serif";
              const textWidth = Math.min(
                width - 32,
                context.measureText(provinceArea.properties.name).width,
              );
              const x = Math.max(
                selectionFrame.left - 8,
                Math.min(
                  selectionFrame.right - textWidth + 8,
                  shapeAnchor[0] + textWidth + 8 <= selectionFrame.right
                    ? shapeAnchor[0]
                    : shapeAnchor[0] - textWidth,
                ),
              );
              const y = shapeAnchor[1];
              boxes.push({ x, y, w: textWidth, h: 44 });
              return { x, y, textWidth };
            })()
          : null;
      // Keep labels above both animated halo layers without another bitmap or
      // a render loop. Reuse this small SVG pool on the existing draw schedule.
      const labelNodes = labelsRef.current?.children;
      if (!labelNodes) return;
      for (const node of labelNodes) {
        const group = node as SVGGElement;
        group.style.display = "none";
        group.removeAttribute("data-globe-label");
        group.removeAttribute("data-globe-region");
        group.removeAttribute("data-geography-kind");
        group.classList.remove("is-active");
        group.setAttribute("role", "img");
        group.removeAttribute("aria-pressed");
        group.setAttribute("tabindex", "-1");
      }
      let labelIndex = 0;
      const labelledPlaces = new Set<string>();
      for (const point of labels) {
        const isDokdo = point.item.place.id === ATLAS_DOKDO_ID;
        const label = nameOf(point.item);
        const activeLabel = point.item.place.id === selected?.place.id;
        const emphasized = activeLabel;
        context.font = `${emphasized ? 700 : 500} 14px 'Noto Sans KR', sans-serif`;
        const textWidth = Math.min(
          width - 32,
          context.measureText(label).width,
        );
        const onShape = activeLabel && !!selectedShape;
        const x = onShape
          ? Math.max(
              selectionFrame.left - 8,
              Math.min(
                selectionFrame.right - textWidth + 8,
                point.x + textWidth + 8 <= selectionFrame.right
                  ? point.x
                  : point.x - textWidth,
              ),
            )
          : Math.min(width - textWidth - 12, Math.max(12, point.x + 10));
        const naturalY = onShape
          ? point.y
          : point.y < 100
            ? point.y + 22
            : point.y - 18;
        let y = onShape
          ? naturalY
          : emphasized
            ? Math.max(80, Math.min(height - 80, naturalY))
            : naturalY;
        const labelHeight = 44;
        const overlaps = (candidateY: number) =>
          boxes.some(
            (box) =>
              Math.abs(box.y - candidateY) < (box.h + labelHeight) / 2 &&
              x < box.x + box.w + 12 &&
              x + textWidth > box.x - 12,
          );
        if (isDokdo && !onShape) {
          for (const candidateY of [y, point.y + 32, point.y - 32, 80]) {
            const candidate = Math.max(80, Math.min(height - 80, candidateY));
            if (!overlaps(candidate)) {
              y = candidate;
              break;
            }
          }
        }
        if (y < 80 || y > height - 68 || overlaps(y)) continue;
        boxes.push({ x, y, w: textWidth, h: labelHeight });
        const group = labelNodes[labelIndex++] as SVGGElement;
        const background = group.children[0] as SVGRectElement;
        const text = group.children[1] as SVGTextElement;
        const ripple = group.children[2] as SVGRectElement;
        group.style.display = "";
        labelledPlaces.add(point.item.place.id);
        group.classList.toggle("is-active", activeLabel);
        group.setAttribute("data-globe-label", point.item.entry.id);
        group.setAttribute("role", "button");
        group.setAttribute("aria-label", `${label} 설명 보기`);
        group.setAttribute("aria-pressed", String(activeLabel));
        group.setAttribute("tabindex", "0");
        group.setAttribute("transform", `translate(${x},${y})`);
        background.style.display = emphasized ? "" : "none";
        background.setAttribute("width", String(textWidth + 16));
        ripple.style.display = activeLabel ? "" : "none";
        ripple.setAttribute("width", String(textWidth + 16));
        text.textContent = label;
        text.setAttribute("textLength", String(textWidth));
        (group.children[3] as SVGRectElement).setAttribute(
          "width",
          String(Math.max(44, textWidth + 16)),
        );
      }
      if (provinceArea && provinceLabel) {
        const label = provinceArea.properties.name;
        const { x, y, textWidth } = provinceLabel;
        const group = labelNodes[labelIndex++] as SVGGElement;
        group.style.display = "";
        group.classList.add("is-active");
        group.setAttribute(
          "data-globe-region",
          provinceArea.properties.regionId || "",
        );
        group.setAttribute("role", "button");
        group.setAttribute("tabindex", "0");
        group.setAttribute("aria-pressed", String(provinceDetailOpen));
        group.setAttribute("transform", `translate(${x},${y})`);
        group.setAttribute("aria-label", `${label} 설명 보기`);
        const background = group.children[0] as SVGRectElement;
        const text = group.children[1] as SVGTextElement;
        const ripple = group.children[2] as SVGRectElement;
        background.style.display = "";
        background.setAttribute("width", String(textWidth + 16));
        text.textContent = label;
        text.setAttribute("textLength", String(textWidth));
        ripple.style.display = "";
        ripple.setAttribute("width", String(textWidth + 16));
        (group.children[3] as SVGRectElement).setAttribute(
          "width",
          String(Math.max(44, textWidth + 16)),
        );
      }
      // Geographic labels share collision boxes with place names; selected
      // places always get priority. Draw these static labels in the same frame.
      context.font = "500 14px 'Noto Sans KR', sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      let geographicLabelCount = 0;
      for (const label of geography?.labels || []) {
        if (geographicLabelCount >= 28) break;
        if (
          camera.zoom < label.minZoom ||
          !isGlobePointVisible(label.coordinates, camera)
        )
          continue;
        const labelName = normalizeAtlasSearch(label.name);
        const labelItem = mapItems.find(
          (item) =>
            item.names.includes(labelName) || item.aliases.includes(labelName),
        );
        if (
          labelItem &&
          (labelledPlaces.has(labelItem.place.id) ||
            (selectedShape && labelItem.place.id === selected?.place.id))
        )
          continue;
        const xy = projection(label.coordinates);
        if (!xy) continue;
        const [x, y] = xy;
        const textWidth = context.measureText(label.name).width;
        const left = x - textWidth / 2;
        if (
          left < 8 ||
          x + textWidth / 2 > width - 8 ||
          y < 80 ||
          y > height - 36
        )
          continue;
        if (
          boxes.some(
            (box) =>
              Math.abs(box.y - y) < (box.h + 22) / 2 &&
              left < box.x + box.w + 12 &&
              left + textWidth > box.x - 12,
          )
        )
          continue;
        boxes.push({ x: left, y, w: textWidth, h: labelItem ? 44 : 22 });
        if (labelItem) {
          const group = labelNodes[labelIndex++] as SVGGElement;
          group.style.display = "";
          group.setAttribute("data-globe-label", labelItem.entry.id);
          group.setAttribute("data-geography-kind", label.kind);
          group.setAttribute("role", "button");
          group.setAttribute("tabindex", "0");
          group.setAttribute("aria-label", `${label.name} 설명 보기`);
          group.setAttribute("aria-pressed", "false");
          group.setAttribute("transform", `translate(${left},${y})`);
          (group.children[0] as SVGRectElement).style.display = "none";
          const text = group.children[1] as SVGTextElement;
          text.textContent = label.name;
          text.setAttribute("textLength", String(textWidth));
          (group.children[2] as SVGRectElement).style.display = "none";
          (group.children[3] as SVGRectElement).setAttribute(
            "width",
            String(Math.max(44, textWidth + 16)),
          );
          labelledPlaces.add(labelItem.place.id);
          geographicLabelCount += 1;
          continue;
        }
        context.lineWidth = 4;
        context.strokeStyle = color(
          label.kind === "ocean" ? "--ws-primary-soft" : "--ws-surface",
        );
        context.strokeText(label.name, x, y);
        context.fillStyle = color(
          label.kind === "desert" || label.kind === "terrain"
            ? "--ws-accent-text"
            : label.kind === "country"
              ? "--ws-text-muted"
              : "--ws-primary-text",
        );
        context.fillText(label.name, x, y);
        geographicLabelCount += 1;
      }
    };
    requestDraw();
  }, [
    land,
    geography,
    mapItems,
    requestDraw,
    selected,
    selectedRiver,
    selectedShape,
    selectedLandform,
    highlightedShape,
    highlightedArea,
    provinceArea,
    provinceDetailOpen,
    detailOpen,
    selectableGeography,
    size,
    popupSize,
    panel,
    wide,
  ]);

  const chooseEntry = useCallback(
    (entryId: string) => {
      const next = itemsById.get(entryId);
      if (!next) return;
      const subjectChanged = subject !== "all" && next.subject !== subject;
      const cleared: string[] = [];
      if (subjectChanged) {
        setSubject(next.subject);
      }
      if (unitId && (subjectChanged || next.entry.unitId !== unitId)) {
        setUnitId("");
        cleared.push("단원");
      }
      if (eraId && (subjectChanged || !next.entry.eraIds?.includes(eraId))) {
        setEraId("");
        cleared.push("시대");
      }
      if (
        subjectChanged ||
        (regionId &&
          !matchesGlobeRegion(next, subject, regionId, subregionId, areas))
      ) {
        setRegionId("");
        setSubregionId("");
        if (regionId) cleared.push("지역");
      }
      if (
        query &&
        (subjectChanged || !next.search.includes(normalizeAtlasSearch(query)))
      ) {
        setQuery("");
        cleared.push("검색");
      }
      if (subjectChanged || cleared.length) {
        setPage(0);
        setNotice(
          subjectChanged
            ? `${ATLAS_SUBJECT_LABELS[next.subject]}로 이동했다.${cleared.length ? ` ${cleared.join("·")} 조건을 해제했다.` : ""}`
            : `선택한 이야기를 보기 위해 ${cleared.join("·")} 조건을 해제했다.`,
        );
      } else setNotice("");
      pendingPanelFocus.current = "detail";
      setProvinceDetailOpen(false);
      setSelectedId(entryId);
      setSelectionRevision((value) => value + 1);
      setPanel("detail");
      setPanelOpen(false);
      if (next.place.coordinates)
        setCamera(focusGlobeView(viewRef.current, next.place.coordinates));
    },
    [
      itemsById,
      areas,
      subject,
      unitId,
      eraId,
      regionId,
      subregionId,
      query,
      setCamera,
    ],
  );
  const chooseFromList = (entryId: string) => {
    const item = itemsById.get(entryId);
    if (!item) return;
    pendingPanelFocus.current = "detail";
    setProvinceDetailOpen(false);
    setSelectedId(entryId);
    setSelectionRevision((value) => value + 1);
    setPanel("detail");
    setPanelOpen(false);
    setNotice("");
    if (item.place.coordinates)
      setCamera(focusGlobeView(viewRef.current, item.place.coordinates));
  };
  const openProvinceDetails = () => {
    if (!provinceArea) return;
    pendingPanelFocus.current = "detail";
    setProvinceDetailOpen(true);
    setPanel("detail");
    setSelectionRevision((value) => value + 1);
  };
  const resetFilters = () => {
    setProvinceDetailOpen(false);
    setUnitId("");
    setEraId("");
    setRegionId("");
    setSubregionId("");
    setQuery("");
    setPage(0);
    setSelectedId(null);
    setPanel("list");
    setNotice("");
  };
  const changeSubject = (next: GlobeSubject) => {
    setSubject(next);
    resetFilters();
    setCamera(
      next !== "korea"
        ? GLOBE_INITIAL_VIEW
        : { longitude: 127, latitude: 36, roll: 0, zoom: 2 },
    );
  };
  const changeRegion = (group: string, subregion: string) => {
    setProvinceDetailOpen(false);
    setRegionId(group);
    setSubregionId(subregion);
    setSelectedId(null);
    setPanel("list");
    setPage(0);
    setNotice("");
    setQuery("");
    const coordinates = [
      ...new Map(
        items
          .filter(
            (item) =>
              (subject === "all" || item.subject === subject) &&
              (!unitId || item.entry.unitId === unitId) &&
              (!eraId || item.entry.eraIds?.includes(eraId)) &&
              matchesGlobeRegion(item, subject, group, subregion, areas),
          )
          .flatMap(({ place }) =>
            place.coordinates ? [[place.id, place.coordinates] as const] : [],
          ),
      ).values(),
    ];
    const next = group
      ? fitGlobeRegionCamera(coordinates, size.width, size.height)
      : subject !== "korea"
        ? GLOBE_INITIAL_VIEW
        : { longitude: 127, latitude: 36, roll: 0, zoom: 2 };
    if (next) setCamera(next);
  };
  const returnToList = () => {
    setProvinceDetailOpen(false);
    const index = filtered.findIndex(
      (item) => item.place.id === selected?.place.id,
    );
    if (index >= 0) setPage(Math.floor(index / PAGE_SIZE));
    pendingPanelFocus.current = "list";
    setPanel("list");
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || wide || !panelOpen) return;
    const focus = document.activeElement as HTMLElement | null;
    const release = acquirePageScrollLock();
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      release();
      if (focus?.isConnected) focus.focus({ preventScroll: true });
    };
  }, [panelOpen, wide]);
  useEffect(() => {
    if (wide) setPanelOpen(false);
  }, [wide]);
  useEffect(() => {
    if (!pendingPanelFocus.current) return;
    if (pendingPanelFocus.current === "detail" && panel === "detail") {
      // The shared card owns its heading; make that title a programmatic focus
      // target without inserting an extra title or a new item in the Tab order.
      const title = detailRef.current?.querySelector<HTMLElement>("h2");
      if (!title) return;
      detailRef.current!.scrollTop = 0;
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
    } else if (pendingPanelFocus.current === "list" && panel === "list") {
      if (!wide && !panelOpen) {
        canvasRef.current?.focus({ preventScroll: true });
        pendingPanelFocus.current = null;
        return;
      }
      const rows =
        rootRef.current?.querySelectorAll<HTMLButtonElement>(
          "[data-globe-place]",
        );
      const row = Array.from(rows || []).find(
        (element) => element.dataset.globePlace === selected?.place.id,
      );
      (row || listHeadingRef.current)?.focus({ preventScroll: true });
    } else return;
    pendingPanelFocus.current = null;
  }, [
    panel,
    selected?.entry.id,
    provinceDetailOpen,
    selectionRevision,
    currentPage,
    wide,
    panelOpen,
  ]);

  const localPointer = (event: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const startGesture = (previous?: Gesture) => {
    const values = [...pointers.current.values()];
    gesture.current = {
      points: values,
      view: { ...viewRef.current },
      moved: previous?.moved || false,
      multiple: values.length > 1 || !!previous?.multiple,
    };
  };
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, localPointer(event));
    startGesture(gesture.current || undefined);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const original = gesture.current;
    if (!original || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, localPointer(event));
    const values = [...pointers.current.values()];
    const before = original.points;
    const radius =
      Math.min(size.width, size.height) * 0.44 * original.view.zoom;
    if (values.length >= 2 && before.length >= 2) {
      original.moved = true;
      original.multiple = true;
      updateView(
        pinchGlobeView(
          original.view,
          [before[0], before[1]],
          [values[0], values[1]],
          radius,
        ),
      );
    } else if (values.length === 1 && before.length === 1) {
      const dx = values[0].x - before[0].x,
        dy = values[0].y - before[0].y;
      if (Math.hypot(dx, dy) > 5) original.moved = true;
      if (original.moved)
        updateView(dragGlobeView(original.view, dx, dy, radius));
    }
  };
  const endPointer = (
    event: React.PointerEvent<HTMLCanvasElement>,
    cancelled = false,
  ) => {
    const original = gesture.current;
    if (!pointers.current.has(event.pointerId)) return;
    const pointer = localPointer(event);
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled && original && !original.moved && !original.multiple) {
      const hit = nearestGlobePoint(drawnPoints.current, pointer.x, pointer.y);
      if (hit) {
        chooseEntry(hit.item.entry.id);
      } else {
        const feature = hitGeography.current(pointer.x, pointer.y);
        if (feature) chooseEntry(feature.entry.id);
      }
    }
    if (pointers.current.size) startGesture(original || undefined);
    else gesture.current = null;
    commitView();
  };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
      setCamera({
        ...viewRef.current,
        zoom:
          viewRef.current.zoom *
          Math.exp(-Math.max(-120, Math.min(120, delta)) * 0.002),
      });
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, [setCamera, size.height]);
  const onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const current = viewRef.current;
    const step = (event.shiftKey ? 20 : 8) / current.zoom;
    let next: GlobeView | undefined;
    if (event.key === "ArrowLeft")
      next = { ...current, longitude: current.longitude - step };
    if (event.key === "ArrowRight")
      next = { ...current, longitude: current.longitude + step };
    if (event.key === "ArrowUp")
      next = { ...current, latitude: current.latitude + step };
    if (event.key === "ArrowDown")
      next = { ...current, latitude: current.latitude - step };
    if (event.key === "+" || event.key === "=")
      next = { ...current, zoom: current.zoom * 1.3 };
    if (event.key === "-" || event.key === "_")
      next = { ...current, zoom: current.zoom / 1.3 };
    if (event.key.toLowerCase() === "n") next = { ...current, roll: 0 };
    if (event.key === "Home") next = GLOBE_INITIAL_VIEW;
    if (next) {
      event.preventDefault();
      setCamera(next);
    }
  };

  const list = (
    <div className="history-globe__list">
      <div className="history-globe__panel-heading">
        <h2 ref={listHeadingRef} tabIndex={-1}>
          장소
        </h2>
        <span>{filtered.length.toLocaleString()}곳</span>
      </div>
      {filtered.length === 0 ? (
        <div className="history-globe__empty">
          <p>조건에 맞는 장소가 없다.</p>
          <button onClick={resetFilters}>필터 초기화</button>
        </div>
      ) : (
        <>
          <div className="history-globe__rows">
            {pageItems.map((item) => (
              <button
                key={item.place.id}
                data-globe-place={item.place.id}
                aria-pressed={selected?.place.id === item.place.id}
                onClick={() => chooseFromList(item.entry.id)}
              >
                <strong>{nameOf(item)}</strong>
              </button>
            ))}
          </div>
          <nav
            className="history-globe__pagination"
            aria-label="지구본 장소 목록 페이지"
          >
            <button
              disabled={currentPage === 0}
              aria-label="이전 장소 페이지"
              onClick={() => setPage(currentPage - 1)}
            >
              이전
            </button>
            <span>
              {currentPage + 1} / {pageCount}
            </span>
            <button
              disabled={currentPage + 1 >= pageCount}
              aria-label="다음 장소 페이지"
              onClick={() => setPage(currentPage + 1)}
            >
              다음
            </button>
          </nav>
        </>
      )}
    </div>
  );
  const detail = selected ? (
    <div className="history-globe__detail" ref={detailRef}>
      {selected.place.kind === "water" && riverError && (
        <div className="history-globe__river-error" role="alert">
          <p>물줄기를 불러오지 못했다.</p>
          <button onClick={() => setRiverAttempt((value) => value + 1)}>
            다시 시도
          </button>
        </div>
      )}
      <AtlasPlaceDetails
        dataset={dataset}
        entry={selected.entry}
        place={displayedPlace || selected.place}
        onSelectEntry={chooseEntry}
      />
    </div>
  ) : (
    list
  );
  return (
    <section
      className={`history-globe${wide ? " is-wide" : ""}${motionPaused ? " is-motion-paused" : ""}`}
      ref={rootRef}
    >
      <header className="history-globe__header">
        <h1>{navigation ? "역사 지도" : "지구본"}</h1>
        <InfoHelp
          label="지구본 조작과 지형 정보"
          sections={[
            {
              title: "조작",
              rows: [
                {
                  label: "회전",
                  content: "마우스나 손가락으로 지구본을 끈다.",
                },
                {
                  label: "확대·축소",
                  content: "휠 또는 두 손가락 벌리기·오므리기를 사용한다.",
                },
                {
                  label: "방위",
                  content:
                    "우하단 나침반은 화면 중앙의 방위를 가리킨다. 두 손가락을 비틀면 방향을 회전한다.",
                },
              ],
            },
            {
              title: "키보드",
              text: "방향키로 회전, +·−로 확대·축소, N으로 북쪽 복귀, Home으로 전체를 본다. 장소 목록에서도 지점을 선택할 수 있다.",
            },
            {
              title: "지형과 위치",
              text: (
                <>
                  좌표를 구형으로 투영한{" "}
                  <a
                    href="https://www.naturalearthdata.com/about/terms-of-use/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Natural Earth
                  </a>
                  의 현대 국경·하천·사막과 지명을 표시한다. 점선은 분쟁·통제선
                  등이며 역사 시대의 영토를 뜻하지 않는다. 작은 섬과 해안선은
                  세계 개관에 맞춰 단순화되어 있다. 8도는 현재 행정구역을 묶은
                  탐색 범위이며, 세계 권역은 현재 국가 경계와 UN M49 등의 지리
                  구분을 따른다. 역사 시대의 영토를 뜻하지 않는다.
                </>
              ),
            },
            {
              title: "자료 출처",
              items: [...atlasRiverCreditItems, ...atlasDokdoCreditItems],
            },
          ]}
        />
      </header>
      {navigation}
      <div className="history-globe__filters">
        <div className="atlas-filter-row">
          {navigation ? (
            <label htmlFor={id + "-subject"}>
              과목
              <select
                id={id + "-subject"}
                value={subject}
                onChange={(event) =>
                  changeSubject(event.target.value as GlobeSubject)
                }
              >
                <option value="all">전체</option>
                <option value="korea">한국사</option>
                <option value="world">세계사</option>
              </select>
            </label>
          ) : (
            <div
              className="history-globe__subjects"
              role="group"
              aria-label="역사 과목"
            >
              {(["all", "korea", "world"] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={subject === value}
                  onClick={() => changeSubject(value)}
                >
                  {value === "all" ? "전체" : ATLAS_SUBJECT_LABELS[value]}
                </button>
              ))}
            </div>
          )}
          <label htmlFor={id + "-unit"}>
            단원
            <select
              id={id + "-unit"}
              value={unitId}
              onChange={(event) => {
                setUnitId(event.target.value);
                setProvinceDetailOpen(false);
                setSelectedId(null);
                setPanel("list");
                setPage(0);
                setNotice("");
              }}
            >
              <option value="">전체 단원</option>
              {dataset.units
                .filter((unit) => subject === "all" || unit.subject === subject)
                .map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {subject === "all"
                      ? `${ATLAS_SUBJECT_LABELS[unit.subject]} · `
                      : ""}
                    {unit.title}
                  </option>
                ))}
            </select>
          </label>
          <label htmlFor={id + "-era"}>
            시대
            <select
              id={id + "-era"}
              value={eraId}
              onChange={(event) => {
                setEraId(event.target.value);
                setProvinceDetailOpen(false);
                setSelectedId(null);
                setPanel("list");
                setPage(0);
                setNotice("");
              }}
            >
              <option value="">전체 시대</option>
              {dataset.eras
                ?.filter((era) => subject === "all" || era.subject === subject)
                .map((era) => (
                  <option key={era.id} value={era.id}>
                    {subject === "all"
                      ? `${ATLAS_SUBJECT_LABELS[era.subject]} · `
                      : ""}
                    {era.title}
                  </option>
                ))}
            </select>
          </label>
          {subject === "all" ? (
            <>
              <label htmlFor={id + "-region"}>
                지역
                <select
                  id={id + "-region"}
                  value={regionId}
                  onChange={(event) => changeRegion(event.target.value, "")}
                >
                  <option value="">전체 지역</option>
                  <optgroup label="한국사 · 8도">
                    {ATLAS_KOREA_PROVINCES.map((region) => (
                      <option key={region.id} value={`korea:${region.id}`}>
                        한국사 · {region.title}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="세계사 · 권역">
                    {ATLAS_WORLD_REGION_GROUPS.map((region) => (
                      <option key={region.id} value={`world:${region.id}`}>
                        세계사 · {region.title}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
              {ATLAS_WORLD_REGION_GROUPS.find(
                (region) => regionId === `world:${region.id}`,
              )?.children.length ? (
                <label htmlFor={id + "-subregion"}>
                  세부 지역
                  <select
                    id={id + "-subregion"}
                    value={subregionId}
                    onChange={(event) =>
                      changeRegion(regionId, event.target.value)
                    }
                  >
                    <option value="">전체 세부 지역</option>
                    {ATLAS_WORLD_REGION_GROUPS.find(
                      (region) => regionId === `world:${region.id}`,
                    )?.children.map((region) => (
                      <option key={region.id} value={region.id}>
                        {region.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </>
          ) : (
            <AtlasRegionFilters
              subject={subject}
              groupId={regionId}
              subregionId={subregionId}
              onChange={changeRegion}
            />
          )}
        </div>
        <label className="atlas-filter-search" htmlFor={id + "-search"}>
          <span>지명 검색</span>
          <input
            type="search"
            aria-label="지명 검색"
            id={id + "-search"}
            value={query}
            placeholder="지명·옛 이름"
            onChange={(event) => {
              setQuery(event.target.value);
              setProvinceDetailOpen(false);
              setSelectedId(null);
              setPage(0);
              setPanel("list");
              setNotice("");
            }}
          />
        </label>
      </div>
      {notice && (
        <p className="history-globe__notice" role="status">
          {notice}
        </p>
      )}
      <div className="history-globe__workspace">
        <div
          className={`history-globe__map-shell${!wide || size.width < 650 ? " is-compact" : ""}`}
          ref={mapRef}
        >
          <canvas
            ref={canvasRef}
            tabIndex={0}
            role="img"
            aria-label={
              "역사 지구본. 방향키로 회전, 더하기와 빼기로 확대·축소." +
              (selected ? " 선택한 장소: " + nameOf(selected) : "")
            }
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => endPointer(event)}
            onPointerCancel={(event) => endPointer(event, true)}
            onLostPointerCapture={(event) => endPointer(event, true)}
            onKeyDown={onKeyDown}
          />
          <svg
            className="history-globe__river-layer"
            width={size.width}
            height={size.height}
            aria-hidden="true"
          >
            <path ref={riverHaloRef} className="history-globe__river-halo" />
          </svg>
          <div
            ref={haloRef}
            className="history-globe__halo"
            hidden
            aria-hidden="true"
          >
            <span />
            <span />
          </div>
          <svg
            ref={labelsRef}
            className="history-globe__labels"
            width={size.width}
            height={size.height}
            role="group"
            aria-label="지도 지명"
          >
            {Array.from({ length: 47 }, (_, index) => (
              <g
                key={index}
                style={{ display: "none" }}
                role="button"
                tabIndex={-1}
                onClick={(event) => {
                  const entryId = event.currentTarget.dataset.globeLabel;
                  if (entryId) chooseEntry(entryId);
                  else if (event.currentTarget.dataset.globeRegion)
                    openProvinceDetails();
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  const entryId = event.currentTarget.dataset.globeLabel;
                  if (!entryId && !event.currentTarget.dataset.globeRegion)
                    return;
                  event.preventDefault();
                  if (entryId) chooseEntry(entryId);
                  else openProvinceDetails();
                }}
              >
                <rect x={-8} y={-16} height={32} rx={8} />
                <text
                  dominantBaseline="central"
                  lengthAdjust="spacingAndGlyphs"
                />
                <rect
                  className="history-globe__label-ripple"
                  x={-8}
                  y={-16}
                  height={32}
                  rx={8}
                />
                <rect
                  className="history-globe__label-hit"
                  x={-8}
                  y={-22}
                  height={44}
                  rx={8}
                />
              </g>
            ))}
          </svg>
          <div className="history-globe__controls">
            {!wide && (
              <button
                className="history-globe__list-toggle"
                onClick={() => {
                  returnToList();
                  setPanelOpen(true);
                }}
              >
                장소 {filtered.length.toLocaleString()}
              </button>
            )}
            <div className="history-globe__control-cluster">
              <div
                className="history-globe__zoom-controls"
                role="group"
                aria-label="지구본 확대·축소"
              >
                <button
                  aria-label="지구본 축소"
                  disabled={view.zoom <= 1}
                  onClick={() =>
                    setCamera({
                      ...viewRef.current,
                      zoom: viewRef.current.zoom / 1.3,
                    })
                  }
                >
                  −
                </button>
                <output
                  ref={zoomRef}
                  className="history-globe__zoom"
                  aria-label="지도 확대 배율"
                >
                  {Math.round(view.zoom * 100)}%
                </output>
                <button
                  aria-label="지구본 확대"
                  disabled={view.zoom >= GLOBE_MAX_ZOOM}
                  onClick={() =>
                    setCamera({
                      ...viewRef.current,
                      zoom: viewRef.current.zoom * 1.3,
                    })
                  }
                >
                  +
                </button>
              </div>
              <button
                aria-label="지구본 전체 보기"
                onClick={() => setCamera(GLOBE_INITIAL_VIEW)}
              >
                전체
              </button>
            </div>
          </div>
          <AtlasCompass ref={compassRef} />
          {!land && !landError && (
            <div className="history-globe__loading" role="status">
              지형을 불러오는 중이다.
            </div>
          )}
          {landError && (
            <div className="history-globe__loading" role="alert">
              <span>지형을 불러오지 못했다.</span>
              <button onClick={() => setLoadAttempt((value) => value + 1)}>
                다시 시도
              </button>
            </div>
          )}
          {areaError &&
            (selected ? isAtlasAreaPlace(selected.place) : regionId) && (
              <div className="history-globe__loading" role="alert">
                <span>지역 범위를 불러오지 못했다.</span>
                <button onClick={() => setAreaAttempt((value) => value + 1)}>
                  다시 시도
                </button>
              </div>
            )}
          {detailOpen && (
            <div
              className="history-globe__popup"
              role="region"
              aria-label={
                (selected ? nameOf(selected) : provinceArea?.properties.name) +
                " 장소 설명"
              }
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  returnToList();
                }
              }}
            >
              <button
                className="history-globe__back"
                aria-label="장소 설명 닫기"
                onClick={returnToList}
              >
                ×
              </button>
              {selected
                ? detail
                : provinceArea && (
                    <div className="history-globe__detail" ref={detailRef}>
                      <AtlasAreaDetails area={provinceArea} />
                    </div>
                  )}
            </div>
          )}
          <div className="history-globe__attribution">
            <a
              href="https://www.naturalearthdata.com/about/terms-of-use/"
              target="_blank"
              rel="noreferrer"
            >
              Natural Earth
            </a>{" "}
            ·{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
            >
              © OpenStreetMap contributors
            </a>
          </div>
        </div>
        {wide && (
          <aside
            className="history-globe__sidebar"
            aria-label="지구본 장소 탐색"
          >
            {list}
          </aside>
        )}
      </div>
      {!wide && (
        <dialog
          ref={dialogRef}
          className="history-globe__dialog"
          aria-labelledby={id + "-dialog-title"}
          onCancel={() => setPanelOpen(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setPanelOpen(false);
          }}
        >
          <div className="history-globe__dialog-shell">
            <header>
              <h2 id={id + "-dialog-title"}>장소</h2>
              <button
                aria-label="장소 패널 닫기"
                onClick={() => setPanelOpen(false)}
              >
                닫기
              </button>
            </header>
            <div className="history-globe__dialog-body">{list}</div>
          </div>
        </dialog>
      )}
    </section>
  );
}
