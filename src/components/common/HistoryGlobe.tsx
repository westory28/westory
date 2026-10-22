import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMapViewportHeight } from "./useMapViewportHeight";
import {
  geoCentroid,
  geoEquirectangular,
  geoGraticule10,
  geoOrthographic,
  geoPath,
  type GeoPermissibleObjects,
} from "d3-geo";
import {
  ATLAS_SUBJECT_LABELS,
  matchesAtlasTemporalScope,
  normalizeAtlasSearch,
  type AtlasDataset,
  type AtlasEntry,
  type AtlasPlace,
  type AtlasSubject,
} from "../../lib/historyAtlas";
import {
  GLOBE_INITIAL_VIEW,
  GLOBE_MAX_ZOOM,
  constrainGlobeView,
  dragGlobeView,
  focusGlobeView,
  globeCanvasSize,
  interpolateGlobeView,
  isGlobePointVisible,
  nearestGlobePoint,
  pinchGlobeView,
  type GlobeView,
} from "../../lib/historyGlobeMath";
import {
  globeInteractionGeometry,
  globeVisibleLines,
  globeVisibleTerrain,
} from "../../lib/historyGlobeRendering";
import {
  createGlobeSurface,
  GLOBE_SURFACE_WIDTH,
  GLOBE_SURFACE_HEIGHT,
  type GlobeSurface,
} from "../../lib/historyGlobeSurface";
import { getAtlasMountainTexture } from "../../lib/historyAtlasTerrainTexture";
import {
  findAtlasReferenceTerrain,
  loadAtlasTerrainGeometry,
  type AtlasTerrainCollection,
  type AtlasTerrainKind,
} from "../../lib/historyAtlasTerrain";
import {
  atlasProjectedNorthBearing,
  atlasShapeGeographicAnchor,
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
  ATLAS_COUNTRY_HELP,
  ATLAS_COUNTRY_LICENSE_URL,
  findAtlasCountryForPlace,
  loadAtlasCountryGeometry,
  type AtlasCountryFeature,
  type AtlasCountryGeometry,
} from "../../lib/historyAtlasCountries";
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
import AtlasCountryDetails from "./AtlasCountryDetails";
import AtlasRegionFilters from "./AtlasRegionFilters";
import AtlasFilterReset from "./AtlasFilterReset";
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
import {
  ATLAS_TERRAIN_HELP,
  atlasTerrainCreditItems,
} from "./AtlasTerrainCredits";
import landUrl from "../../data/atlas/land-globe.json?url";
import geographyUrl from "../../data/atlas/globe-geography.json?url";
import {
  ATLAS_DOKDO_COORDINATES,
  ATLAS_DOKDO_ID,
} from "../../data/historyAtlasDokdo";
import "./historyGlobe.css";
import "./atlasTerrain.css";

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
  label?: { entryId?: string; countryId?: string; region?: string };
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
  "--atlas-terrain-mountain": "#cbd8ca",
  "--atlas-terrain-ridge": "#6b826d",
  "--atlas-terrain-plateau": "#ded7c8",
  "--atlas-terrain-desert": "#edd5a5",
  "--atlas-terrain-sand": "#b58a50",
  "--atlas-terrain-plain": "#e6eddf",
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
  toolbar?: ReactNode;
  showTerrain?: boolean;
}

export default function HistoryGlobe({
  dataset,
  initialSubject = "all",
  navigation,
  toolbar,
  showTerrain = false,
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
  const landClipRef = useRef<SVGPathElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const pendingPanelFocus = useRef<"detail" | "list" | null>(null);
  const [wide, setWide] = useState(false);
  const [size, setSize] = useState({ width: 600, height: 400 });
  const mapHeight = useMapViewportHeight(rootRef, mapRef, 480);
  const [popupSize, setPopupSize] = useState({ width: 0, height: 0 });
  const [subject, setSubject] = useState<GlobeSubject>(initialSubject);
  const [unitId, setUnitId] = useState("");
  const [eraId, setEraId] = useState("");
  const [regionId, setRegionId] = useState("");
  const [subregionId, setSubregionId] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedCountryId, setSelectedCountryId] = useState<string | null>(
    null,
  );
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [page, setPage] = useState(0);
  const [panel, setPanel] = useState<"list" | "detail">("list");
  const [panelOpen, setPanelOpen] = useState(false);
  const [provinceDetailOpen, setProvinceDetailOpen] = useState(false);
  const [regionSelectionDismissed, setRegionSelectionDismissed] =
    useState(false);
  const [notice, setNotice] = useState("");
  const [land, setLand] = useState<GeoPermissibleObjects | null>(null);
  const [geography, setGeography] = useState<GlobeGeography | null>(null);
  const [terrain, setTerrain] = useState<AtlasTerrainCollection | null>(null);
  const [terrainError, setTerrainError] = useState(false);
  const [countries, setCountries] = useState<AtlasCountryGeometry | null>(null);
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
  const cameraFrame = useRef<number | null>(null);
  const projectionCenter = useRef({ x: 0.5, y: 0.5 });
  const focusedSelection = useRef<{
    shape: GeoPermissibleObjects | null;
    revision: number;
    detailOpen: boolean;
  } | null>(null);
  const wheelCommit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelActive = useRef(false);
  const dirty = useRef(true);
  const inView = useRef(true);
  const movingSurface = useRef<GlobeSurface | null>(null);
  const surfaceUnavailable = useRef(false);

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
  const needsTerrain =
    showTerrain ||
    !!(
      selected?.entry.geographicReference &&
      ["mountain", "desert"].includes(selected.place.kind || "")
    );
  const selectedCountry = useMemo(
    () =>
      countries?.countries.features.find(
        (country) => country.properties.id === selectedCountryId,
      ) || null,
    [countries, selectedCountryId],
  );
  const selectedPlaceCountry = useMemo(
    () =>
      selected && countries && !selected.entry.geographicReference
        ? findAtlasCountryForPlace(selected.place, countries.countries)
        : null,
    [selected, countries],
  );
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
        matchesAtlasTemporalScope(item.entry, unitId, eraId) &&
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
  useEffect(() => {
    if (rowsRef.current) rowsRef.current.scrollTop = 0;
  }, [currentPage, filtered]);
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
      selected
        ? (geography && findAtlasLandform(selected.place, geography)) ||
          (terrain && findAtlasReferenceTerrain(selected.place, terrain))
        : null,
    [selected, geography, terrain],
  );
  const selectedArea = useMemo(
    () => (selected && areas ? findAtlasArea(selected.place, areas) : null),
    [selected, areas],
  );
  const provinceArea = useMemo(() => {
    if (regionSelectionDismissed || !areas || selected || selectedCountry)
      return null;
    const region = (subregionId || regionId).replace(/^(korea|world):/, "");
    return region ? findAtlasRegionArea(region, areas) : null;
  }, [
    regionSelectionDismissed,
    areas,
    selected,
    selectedCountry,
    regionId,
    subregionId,
  ]);
  const highlightedCountry = selectedCountry || selectedPlaceCountry;
  const selectedShape =
    selectedRiver || selectedPlaceCountry || selectedLandform || selectedArea;
  const highlightedShape = selectedCountry || selectedShape || provinceArea;
  const shapeLabelCoordinates = useMemo(
    () =>
      highlightedShape ? atlasShapeGeographicAnchor(highlightedShape) : null,
    [highlightedShape],
  );
  const highlightedArea =
    highlightedCountry || selectedLandform || selectedArea || provinceArea;
  const detailOpen =
    ((selected || selectedCountry) && panel === "detail") ||
    (provinceArea && provinceDetailOpen);
  const selectableGeography = useMemo(
    () =>
      filtered.flatMap((item) => {
        if (item.place.kind === "country") return [];
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
  const geographyLabels = useMemo(() => {
    const features: GlobeGeography["labels"] = (
      showTerrain ? terrain?.features || [] : []
    ).map((feature) => ({
      name: feature.properties.name,
      kind: feature.properties.kind === "desert" ? "desert" : "terrain",
      coordinates: feature.properties.coordinates,
      minZoom: feature.properties.minZoom / 1.7,
    }));
    const names = new Set(
      features.map((feature) => normalizeAtlasSearch(feature.name)),
    );
    return [
      ...features,
      ...(geography?.labels || []).filter(
        (label) =>
          (showTerrain ||
            (label.kind !== "desert" && label.kind !== "terrain")) &&
          !names.has(normalizeAtlasSearch(label.name)),
      ),
    ];
  }, [terrain, geography, showTerrain]);
  const geographyLabelItems = useMemo(() => {
    const names = new Map<string, Item>();
    for (const item of mapItems) {
      for (const name of [...item.names, ...item.aliases]) {
        if (!names.has(name)) names.set(name, item);
      }
    }
    return new Map(
      geographyLabels.map((label) => [
        label,
        names.get(normalizeAtlasSearch(label.name)),
      ]),
    );
  }, [geographyLabels, mapItems]);
  const terrainLayers = useMemo(() => {
    if (!terrain) return [];
    const layers = new Map<AtlasTerrainKind, MultiPolygon>();
    for (const feature of terrain.features) {
      const kind = feature.properties.kind;
      const layer = layers.get(kind) || {
        type: "MultiPolygon",
        coordinates: [],
      };
      layer.coordinates.push(
        ...(feature.geometry.type === "Polygon"
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates),
      );
      layers.set(kind, layer);
    }
    return [...layers].map(([kind, geometry]) => ({ kind, geometry }));
  }, [terrain]);

  const cancelDraw = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  }, []);
  const requestDraw = useCallback(() => {
    dirty.current = true;
    if (document.hidden || !inView.current || raf.current !== null) return;
    // Coalesce input into the next display frame; never add a timer before RAF.
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      if (document.hidden || !inView.current || !dirty.current) return;
      dirty.current = false;
      drawRef.current();
    });
  }, []);
  const updateView = useCallback(
    (next: GlobeView) => {
      viewRef.current = constrainGlobeView(next);
      requestDraw();
    },
    [requestDraw],
  );
  const commitView = useCallback(() => {
    setView({ ...viewRef.current });
    requestDraw();
  }, [requestDraw]);
  const cancelCamera = useCallback(() => {
    if (cameraFrame.current !== null) cancelAnimationFrame(cameraFrame.current);
    cameraFrame.current = null;
  }, []);
  const setCamera = useCallback(
    (next: GlobeView, center = projectionCenter.current) => {
      cancelCamera();
      const target = constrainGlobeView(next);
      const from = { ...viewRef.current };
      const origin = { ...projectionCenter.current };
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        projectionCenter.current = { ...center };
        updateView(target);
        commitView();
        return;
      }
      let started: number | null = null;
      const frame = (now: number) => {
        started ??= now;
        const progress = Math.max(0, Math.min(1, (now - started) / 300));
        const eased = 1 - (1 - progress) ** 3;
        projectionCenter.current = {
          x: origin.x + (center.x - origin.x) * eased,
          y: origin.y + (center.y - origin.y) * eased,
        };
        updateView(interpolateGlobeView(from, target, eased));
        if (progress < 1) cameraFrame.current = requestAnimationFrame(frame);
        else {
          cameraFrame.current = null;
          commitView();
        }
      };
      cameraFrame.current = requestAnimationFrame(frame);
    },
    [cancelCamera, updateView, commitView],
  );

  useEffect(() => {
    let active = true;
    setLandError(false);
    Promise.all([loadLand(), loadGeography(), loadAtlasCountryGeometry()])
      .then(([value, detail, countryGeometry]) => {
        if (active) {
          setLand(value);
          setGeography(detail);
          setCountries(countryGeometry);
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
    if (!needsTerrain || terrain) return;
    let active = true;
    setTerrainError(false);
    loadAtlasTerrainGeometry()
      .then((value) => {
        if (active) setTerrain(value);
      })
      .catch(() => {
        if (active) setTerrainError(true);
      });
    return () => {
      active = false;
    };
  }, [needsTerrain, terrain, loadAttempt]);
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
    // Late geometry must not restart automatic zoom while a finger is down.
    if (pointers.current.size) return;
    if ((!highlightedShape && !selected?.place.coordinates) || !mapRef.current)
      return;
    const previous = focusedSelection.current;
    if (
      previous?.shape === highlightedShape &&
      previous.revision === selectionRevision &&
      previous.detailOpen === !!detailOpen &&
      cameraFrame.current === null
    )
      return;
    const center = highlightedShape
      ? geoCentroid(highlightedShape)
      : selected!.place.coordinates!;
    if (!center.every(Number.isFinite)) return;
    const width = mapRef.current.clientWidth,
      height = mapRef.current.clientHeight;
    if (!width || !height) return;
    const projection = geoOrthographic()
      .translate([0, 0])
      .scale(1)
      .rotate([-center[0], -center[1], 0])
      .clipAngle(90);
    const viewport = selectionViewport(
      width,
      height,
      detailOpen ? detailRef.current?.parentElement || null : null,
    );
    let next = focusGlobeView(viewRef.current, center as [number, number]);
    if (highlightedShape) {
      const [[left, top], [right, bottom]] =
        geoPath(projection).bounds(highlightedShape);
      const scale = Math.min(
        ((viewport.right - viewport.left) * 0.85) /
          Math.max(0.01, 2 * Math.max(Math.abs(left), Math.abs(right))),
        ((viewport.bottom - viewport.top) * 0.85) /
          Math.max(0.01, 2 * Math.max(Math.abs(top), Math.abs(bottom))),
      );
      next = {
        ...next,
        zoom: Math.max(
          selected?.entry.geographicReference ? viewRef.current.zoom : 0,
          Math.min(GLOBE_MAX_ZOOM, scale / (Math.min(width, height) * 0.44)),
        ),
      };
    }
    focusedSelection.current = {
      shape: highlightedShape,
      revision: selectionRevision,
      detailOpen: !!detailOpen,
    };
    setCamera(next, {
      x: (viewport.left + viewport.right) / (2 * width),
      y: (viewport.top + viewport.bottom) / (2 * height),
    });
  }, [
    highlightedShape,
    selected,
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
        cancelCamera();
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
      cancelCamera();
    };
  }, [cancelDraw, cancelCamera, requestDraw]);

  useEffect(
    () => () => {
      movingSurface.current?.dispose();
      movingSurface.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!land || !geography || !countries || surfaceUnavailable.current) return;
    // Bake once after the map settles, never in an input/draw callback. The
    // fixed texture budget also bounds GPU memory on phones and tablets.
    let cancelled = false;
    let prepared = false;
    let timer: ReturnType<typeof setTimeout>;
    const prepare = () => {
      if (cancelled || prepared || document.hidden) return;
      if (
        gesture.current?.moved ||
        wheelActive.current ||
        cameraFrame.current !== null
      ) {
        timer = setTimeout(prepare, 160);
        return;
      }
      const root = rootRef.current;
      if (!root) return;
      const tokens = getComputedStyle(root);
      const color = (token: keyof typeof GLOBE_COLORS) =>
        tokens.getPropertyValue(token).trim() || GLOBE_COLORS[token];
      const texture = document.createElement("canvas");
      texture.width = GLOBE_SURFACE_WIDTH;
      texture.height = GLOBE_SURFACE_HEIGHT;
      const context = texture.getContext("2d", { alpha: false });
      if (!context) return;
      const projection = geoEquirectangular()
        .translate([texture.width / 2, texture.height / 2])
        .scale(texture.width / (2 * Math.PI))
        .precision(0.5);
      const path = geoPath(projection, context);
      context.fillStyle = color("--ws-primary-soft");
      context.fillRect(0, 0, texture.width, texture.height);
      context.beginPath();
      path(grid);
      context.strokeStyle = color("--ws-border-blue");
      context.lineWidth = 0.7;
      context.stroke();
      context.beginPath();
      path(land);
      context.fillStyle = color("--ws-surface");
      context.fill();
      context.save();
      context.clip();
      for (const { kind, geometry } of showTerrain ? terrainLayers : []) {
        context.beginPath();
        path(globeInteractionGeometry(geometry, projection.scale(), true));
        context.fillStyle = color(
          kind === "mountain"
            ? "--atlas-terrain-mountain"
            : kind === "desert"
              ? "--atlas-terrain-desert"
              : kind === "plateau"
                ? "--atlas-terrain-plateau"
                : "--atlas-terrain-plain",
        );
        context.fill();
      }
      context.beginPath();
      path(globeInteractionGeometry(countries.borders, projection.scale()));
      context.strokeStyle = color("--ws-accent-text");
      context.globalAlpha = 0.45;
      context.lineWidth = 0.9;
      context.stroke();
      context.beginPath();
      path(countries.disputedBorders);
      context.setLineDash([4, 4]);
      context.stroke();
      context.setLineDash([]);
      context.beginPath();
      path(globeInteractionGeometry(geography.rivers, projection.scale()));
      for (const feature of selectableGeography) {
        if (!feature.area)
          path(globeInteractionGeometry(feature.shape, projection.scale()));
      }
      context.strokeStyle = color("--ws-primary");
      context.lineWidth = 1.3;
      context.stroke();
      context.restore();
      context.beginPath();
      path(land);
      context.strokeStyle = color("--ws-text-soft");
      context.lineWidth = 0.7;
      context.stroke();
      movingSurface.current ||= createGlobeSurface(requestDraw);
      if (!movingSurface.current) surfaceUnavailable.current = true;
      else movingSurface.current.updateTexture(texture);
      if (canvasRef.current)
        canvasRef.current.dataset.globeTextureReady = String(
          movingSurface.current?.isReady() || false,
        );
      prepared = true;
    };
    const resumePreparation = () => {
      if (!document.hidden && !prepared) timer = setTimeout(prepare, 160);
    };
    document.addEventListener("visibilitychange", resumePreparation);
    timer = setTimeout(prepare, 160);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", resumePreparation);
      // Never reuse a texture with stale terrain visibility or filtered rivers.
      movingSurface.current?.invalidate();
      if (canvasRef.current)
        canvasRef.current.dataset.globeTextureReady = "false";
    };
  }, [
    land,
    geography,
    countries,
    terrainLayers,
    showTerrain,
    selectableGeography,
    requestDraw,
  ]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const tokens = getComputedStyle(root);
    const palette = Object.fromEntries(
      Object.entries(GLOBE_COLORS).map(([token, fallback]) => [
        token,
        tokens.getPropertyValue(token).trim() || fallback,
      ]),
    ) as Record<keyof typeof GLOBE_COLORS, string>;
    const desertPattern = () => {
      const tile = document.createElement("canvas");
      tile.width = tile.height = 8;
      const pen = tile.getContext("2d");
      if (!pen) return null;
      pen.fillStyle = palette["--atlas-terrain-sand"];
      pen.beginPath();
      pen.arc(2, 2, 0.7, 0, Math.PI * 2);
      pen.fill();
      return (
        canvasRef.current
          ?.getContext("2d", { alpha: false })
          ?.createPattern(tile, "repeat") || null
      );
    };
    const mountainTile = showTerrain
      ? getAtlasMountainTexture(palette["--atlas-terrain-ridge"])
      : null;
    const mountainTexture = mountainTile
      ? canvasRef.current
          ?.getContext("2d", { alpha: false })
          ?.createPattern(mountainTile.canvas, "repeat") || null
      : null;
    const desertTexture = showTerrain ? desertPattern() : null;
    const textWidths = new Map<string, number>();
    const motionLabels: {
      group: SVGGElement;
      coordinates: [number, number];
      offsetX: number;
      offsetY: number;
      width: number;
    }[] = [];
    const refreshTextWidths = () => {
      textWidths.clear();
      requestDraw();
    };
    document.fonts.addEventListener("loadingdone", refreshTextWidths);
    drawRef.current = () => {
      const canvas = canvasRef.current,
        root = rootRef.current;
      if (!canvas || !root) return;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      const { width, height } = size;
      const interacting =
        !!gesture.current?.moved ||
        wheelActive.current ||
        cameraFrame.current !== null;
      const backing = globeCanvasSize(
        width,
        height,
        interacting ? 1 : window.devicePixelRatio || 1,
      );
      if (
        canvas.width !== backing.pixelWidth ||
        canvas.height !== backing.pixelHeight
      ) {
        canvas.width = backing.pixelWidth;
        canvas.height = backing.pixelHeight;
      }
      context.setTransform(backing.dpr, 0, 0, backing.dpr, 0, 0);
      const color = (token: keyof typeof GLOBE_COLORS) => palette[token];
      const camera = viewRef.current;
      const zoomLabel = `${Math.round(camera.zoom * 100)}%`;
      if (zoomRef.current && zoomRef.current.textContent !== zoomLabel)
        zoomRef.current.textContent = zoomLabel;
      const popup = detailOpen
        ? detailRef.current?.parentElement || null
        : null;
      const projection = geoOrthographic()
        .translate([
          projectionCenter.current.x * width,
          projectionCenter.current.y * height,
        ])
        .scale(Math.min(width, height) * 0.44 * camera.zoom)
        .rotate([-camera.longitude, -camera.latitude, camera.roll])
        .clipAngle(90)
        .clipExtent([
          [-8, -8],
          [width + 8, height + 8],
        ])
        .precision(0.5);
      compassRef.current?.style.setProperty(
        "--atlas-compass-bearing",
        `${atlasProjectedNorthBearing(projection, [camera.longitude, camera.latitude])}deg`,
      );
      const path = geoPath(projection, context);
      const movingCanvas = interacting
        ? movingSurface.current?.render(
            backing.pixelWidth,
            backing.pixelHeight,
            camera,
            projectionCenter.current,
          )
        : null;
      const renderer = movingCanvas ? "webgl" : "canvas";
      canvas.dataset.globeTextureReady = String(
        movingSurface.current?.isReady() || false,
      );
      if (canvas.dataset.globeRenderer !== renderer)
        canvas.dataset.globeRenderer = renderer;
      // Reuse the exact projected coast for filling, clipping and stroking.
      // Projecting it into the current canvas path repeated all work each time.
      const landPath =
        land && (!movingCanvas || highlightedArea) ? new Path2D() : null;
      if (land && landPath)
        geoPath(projection, {
          beginPath() {},
          moveTo: (x, y) => landPath.moveTo(x, y),
          lineTo: (x, y) => landPath.lineTo(x, y),
          arc: (x, y, radius, start, end, anticlockwise) =>
            landPath.arc(x, y, radius, start, end, anticlockwise),
          closePath: () => landPath.closePath(),
        })(
          interacting
            ? globeInteractionGeometry(land, projection.scale(), true, 1)
            : land,
        );
      const measureLabelWidth = (text: string) => {
        const key = `${context.font}\0${text}`;
        let value = textWidths.get(key);
        if (value === undefined) {
          value = context.measureText(text).width;
          textWidths.set(key, value);
        }
        return value;
      };
      const lineGeometry = <T extends GeoPermissibleObjects>(shape: T): T =>
        globeVisibleLines(
          globeInteractionGeometry(
            shape,
            projection.scale(),
            false,
            interacting ? 1 : 0.35,
          ),
          projection,
          camera,
          width,
          height,
        );
      context.fillStyle = color("--ws-surface-subtle");
      context.fillRect(0, 0, width, height);
      if (movingCanvas) context.drawImage(movingCanvas, 0, 0, width, height);
      else {
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
        if (landPath) {
          context.fillStyle = color("--ws-surface");
          context.fill(landPath);
        }
        // All terrestrial fills share the visible coast. Different source
        // resolutions must never paint a second coast into the sea.
        context.save();
        if (landPath) context.clip(landPath);
        if (showTerrain && geography && !terrain) {
          context.beginPath();
          path(geography.deserts);
          context.fillStyle = color("--atlas-terrain-desert");
          context.fill();
        }
        for (const { kind, geometry } of showTerrain ? terrainLayers : []) {
          context.beginPath();
          path(
            globeVisibleTerrain(
              globeInteractionGeometry(
                geometry,
                projection.scale(),
                true,
                interacting ? 1 : 0.35,
              ),
              projection,
              camera,
              width,
              height,
            ),
          );
          context.fillStyle = color(
            kind === "mountain"
              ? "--atlas-terrain-mountain"
              : kind === "desert"
                ? "--atlas-terrain-desert"
                : kind === "plateau"
                  ? "--atlas-terrain-plateau"
                  : "--atlas-terrain-plain",
          );
          context.fill();
          const pattern =
            kind === "mountain"
              ? mountainTexture
              : kind === "desert"
                ? desertTexture
                : null;
          if (pattern && !interacting) {
            context.fillStyle = pattern;
            context.globalAlpha = 0.45;
            context.fill();
            context.globalAlpha = 1;
          }
        }
        if (highlightedCountry) {
          context.beginPath();
          path(highlightedCountry);
          context.fillStyle = color("--ws-accent-soft");
          context.globalAlpha = 0.35;
          context.fill();
          context.globalAlpha = 1;
        }
        if (countries) {
          context.beginPath();
          path(lineGeometry(countries.borders));
          context.strokeStyle = color("--ws-accent-text");
          context.globalAlpha = 0.45;
          context.lineWidth = 0.9;
          context.stroke();
          context.beginPath();
          path(lineGeometry(countries.disputedBorders));
          context.setLineDash([4, 4]);
          context.stroke();
          context.setLineDash([]);
          context.globalAlpha = 1;
        }
        if (geography) {
          context.beginPath();
          path(lineGeometry(geography.rivers));
          context.strokeStyle = color("--ws-primary");
          context.globalAlpha = 0.45;
          context.lineWidth = 1.3;
          context.stroke();
          context.globalAlpha = 1;
        }
        // Draw the same verified courses that are used for hit testing. The
        // overview layer alone omits small rivers and cannot identify a place.
        context.beginPath();
        for (const feature of selectableGeography) {
          if (feature.area) continue;
          path(lineGeometry(feature.shape));
        }
        context.strokeStyle = color("--ws-primary");
        context.globalAlpha = 0.45;
        context.lineWidth = 1.3;
        context.stroke();
        context.globalAlpha = 1;
        context.restore();
      }
      if (movingCanvas && highlightedCountry) {
        context.save();
        if (landPath) context.clip(landPath);
        context.beginPath();
        path(highlightedCountry);
        context.fillStyle = color("--ws-accent-soft");
        context.globalAlpha = 0.35;
        context.fill();
        context.restore();
      }
      const marineRegion =
        provinceArea?.properties.regionId?.startsWith("water");
      if (highlightedShape && !highlightedCountry) {
        context.save();
        if (landPath && highlightedArea && !marineRegion)
          context.clip(landPath);
        context.beginPath();
        path(highlightedShape);
        if (highlightedArea) {
          context.fillStyle = color("--ws-primary-soft");
          context.globalAlpha = 0.35;
          context.fill();
          context.globalAlpha = 1;
        }
        context.strokeStyle = color("--ws-primary");
        context.lineWidth = 3;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.stroke();
        context.restore();
      }
      // The continuous base coastline is always the final edge on top of
      // country/region fills, including Tanzania's islands and coastal inlets.
      if (landPath) {
        context.strokeStyle = color("--ws-text-soft");
        context.lineWidth = 0.7;
        context.stroke(landPath);
      }
      landClipRef.current?.setAttribute(
        "d",
        land && highlightedArea && !highlightedCountry && !marineRegion
          ? geoPath(projection).digits(1)(land) || ""
          : "",
      );
      if (land && highlightedArea && !highlightedCountry && !marineRegion)
        riverHaloRef.current?.setAttribute(
          "clip-path",
          `url(#${id}-land-clip)`,
        );
      else riverHaloRef.current?.removeAttribute("clip-path");
      riverHaloRef.current?.setAttribute(
        "d",
        highlightedShape && !highlightedCountry
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
      // The anchor belongs to the place. Hide it when it leaves the viewport;
      // never clamp it to an edge or select a new point on the visible boundary.
      const projectedAnchor =
        shapeLabelCoordinates &&
        isGlobePointVisible(shapeLabelCoordinates, camera)
          ? projection(shapeLabelCoordinates)
          : null;
      const shapeAnchor =
        projectedAnchor &&
        projectedAnchor[0] >= 0 &&
        projectedAnchor[0] <= width &&
        projectedAnchor[1] >= 0 &&
        projectedAnchor[1] <= height
          ? projectedAnchor
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
      drawnPoints.current = rendered.filter(
        (point) => point.item.place.kind !== "country",
      );
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
      // Keep labels attached to their geographic anchors during gestures.
      // Reuse the settled layout instead of measuring text, finding collision
      // slots and rewriting the entire SVG pool for every pointer frame.
      if (interacting && motionLabels.length) {
        for (const label of motionLabels) {
          const point = isGlobePointVisible(label.coordinates, camera)
            ? projection(label.coordinates)
            : null;
          const x = (point?.[0] || 0) + label.offsetX;
          const y = (point?.[1] || 0) + label.offsetY;
          const visible =
            point &&
            x >= 8 &&
            x + label.width <= width - 8 &&
            y >= 80 &&
            y <= height - 36;
          label.group.style.display = visible ? "" : "none";
          if (visible)
            label.group.setAttribute("transform", `translate(${x},${y})`);
        }
        return;
      }
      motionLabels.length = 0;
      const rememberLabel = (
        group: SVGGElement,
        coordinates: [number, number] | null,
        x: number,
        y: number,
        textWidth: number,
      ) => {
        const anchor = coordinates && projection(coordinates);
        if (coordinates && anchor)
          motionLabels.push({
            group,
            coordinates,
            offsetX: x - anchor[0],
            offsetY: y - anchor[1],
            width: textWidth,
          });
      };
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
                measureLabelWidth(provinceArea.properties.name),
              );
              const x = shapeAnchor[0] - textWidth / 2;
              const y = shapeAnchor[1];
              if (
                x < 8 ||
                x + textWidth > width - 8 ||
                y < 80 ||
                y > height - 68
              )
                return null;
              boxes.push({ x, y, w: textWidth, h: 44 });
              return { x, y, textWidth };
            })()
          : null;
      // Keep labels above both animated halo layers without another bitmap or
      // a render loop. Reuse this small SVG pool on the existing draw schedule.
      const labelNodes = labelsRef.current?.children;
      if (!labelNodes) return;
      const focusedLabel = document.activeElement;
      const claimedLabels = new Set<SVGGElement>();
      const claimLabel = (() => {
        const groups = Array.from(labelNodes) as SVGGElement[];
        const keyed = new Map(
          groups.map((group) => [group.getAttribute("data-globe-key"), group]),
        );
        let freeIndex = 0;
        return (key: string) => {
          const existing = keyed.get(key);
          let group =
            existing && !claimedLabels.has(existing) ? existing : undefined;
          if (!group) {
            while (
              freeIndex < groups.length &&
              (claimedLabels.has(groups[freeIndex]) ||
                groups[freeIndex] === focusedLabel)
            )
              freeIndex += 1;
            group = groups[freeIndex++];
          }
          if (group) {
            claimedLabels.add(group);
            group.setAttribute("data-globe-key", key);
          }
          return group;
        };
      })();
      for (const node of labelNodes) {
        const group = node as SVGGElement;
        group.style.display = "none";
        group.removeAttribute("data-globe-label");
        group.removeAttribute("data-globe-region");
        group.removeAttribute("data-globe-country");
        group.removeAttribute("data-geography-kind");
        group.classList.remove("is-active");
        group.setAttribute("role", "img");
        group.removeAttribute("aria-pressed");
        group.setAttribute("tabindex", "-1");
      }
      let geographicLabelCount = 0;
      const drawCountryLabel = (
        country: AtlasCountryFeature,
        active: boolean,
      ) => {
        const {
          name,
          coordinates,
          minZoom,
          id: countryId,
        } = country.properties;
        if (!active && camera.zoom < minZoom / 1.7) return false;
        const xy = active
          ? shapeAnchor
          : isGlobePointVisible(coordinates, camera)
            ? projection(coordinates)
            : null;
        if (!xy) return false;
        context.font = `${active ? 700 : 500} 14px 'Noto Sans KR', sans-serif`;
        const textWidth = Math.min(width - 32, measureLabelWidth(name));
        const offsets = active
          ? [[0, 0]]
          : [
              [0, 0],
              [0, -44],
              [0, 44],
              [-48, 0],
              [48, 0],
              [-48, -44],
              [48, -44],
              [-48, 44],
              [48, 44],
              [0, -88],
              [0, 88],
            ];
        const placement = offsets
          .map(([dx, dy]) => ({ x: xy[0] - textWidth / 2 + dx, y: xy[1] + dy }))
          .find(
            ({ x, y }) =>
              x >= 8 &&
              x + textWidth <= width - 8 &&
              y >= 80 &&
              y <= height - 36 &&
              !boxes.some(
                (box) =>
                  Math.abs(box.y - y) < (box.h + 44) / 2 &&
                  x < box.x + box.w + 12 &&
                  x + textWidth > box.x - 12,
              ),
          );
        if (!placement) return false;
        const { x, y } = placement;
        boxes.push({ x, y, w: textWidth, h: 44 });
        const group = claimLabel(`country:${countryId}`);
        if (!group) return false;
        rememberLabel(
          group,
          active ? shapeLabelCoordinates : coordinates,
          x,
          y,
          textWidth,
        );
        group.style.display = "";
        group.classList.toggle("is-active", active);
        group.setAttribute("data-globe-country", countryId);
        group.setAttribute("data-geography-kind", "country");
        group.setAttribute("role", "button");
        group.setAttribute("tabindex", "0");
        group.setAttribute("aria-label", `${name} 설명 보기`);
        group.setAttribute("aria-pressed", String(active));
        group.setAttribute("transform", `translate(${x},${y})`);
        const background = group.children[0] as SVGRectElement;
        background.style.display = active ? "" : "none";
        background.setAttribute("width", String(textWidth + 16));
        const text = group.children[1] as SVGTextElement;
        text.textContent = name;
        text.setAttribute("textLength", String(textWidth));
        (group.children[2] as SVGRectElement).style.display = "none";
        (group.children[3] as SVGRectElement).setAttribute(
          "width",
          String(Math.max(44, textWidth + 16)),
        );
        geographicLabelCount += 1;
        return true;
      };
      if (selectedCountry) drawCountryLabel(selectedCountry, true);
      const labelledPlaces = new Set<string>();
      for (const point of labels) {
        const isDokdo = point.item.place.id === ATLAS_DOKDO_ID;
        const activeLabel = point.item.place.id === selected?.place.id;
        const label =
          activeLabel && selectedPlaceCountry
            ? selectedPlaceCountry.properties.name
            : nameOf(point.item);
        const emphasized = activeLabel;
        context.font = `${emphasized ? 700 : 500} 14px 'Noto Sans KR', sans-serif`;
        const textWidth = Math.min(width - 32, measureLabelWidth(label));
        const onShape = activeLabel && !!selectedShape;
        const x = onShape ? point.x - textWidth / 2 : point.x + 10;
        let y = onShape ? point.y : point.y - 18;
        const labelHeight = 44;
        const overlaps = (candidateY: number) =>
          boxes.some(
            (box) =>
              Math.abs(box.y - candidateY) < (box.h + labelHeight) / 2 &&
              x < box.x + box.w + 12 &&
              x + textWidth > box.x - 12,
          );
        if (isDokdo && !onShape) {
          for (const candidateY of [y, point.y + 32, point.y - 32]) {
            if (
              candidateY >= 80 &&
              candidateY <= height - 80 &&
              !overlaps(candidateY)
            ) {
              y = candidateY;
              break;
            }
          }
        }
        if (
          x < 8 ||
          x + textWidth > width - 8 ||
          y < 80 ||
          y > height - 68 ||
          overlaps(y)
        )
          continue;
        boxes.push({ x, y, w: textWidth, h: labelHeight });
        const group = claimLabel(`place:${point.item.entry.id}`);
        if (!group) continue;
        rememberLabel(
          group,
          onShape
            ? shapeLabelCoordinates
            : isDokdo
              ? ATLAS_DOKDO_COORDINATES
              : point.item.place.coordinates,
          x,
          y,
          textWidth,
        );
        const background = group.children[0] as SVGRectElement;
        const text = group.children[1] as SVGTextElement;
        const ripple = group.children[2] as SVGRectElement;
        group.style.display = "";
        labelledPlaces.add(point.item.place.id);
        group.classList.toggle("is-active", activeLabel);
        group.setAttribute("data-globe-label", point.item.entry.id);
        if (activeLabel && selectedPlaceCountry)
          group.setAttribute("data-geography-kind", "country");
        group.setAttribute("role", "button");
        group.setAttribute("aria-label", `${label} 설명 보기`);
        group.setAttribute("aria-pressed", String(activeLabel));
        group.setAttribute("tabindex", "0");
        group.setAttribute("transform", `translate(${x},${y})`);
        background.style.display = emphasized ? "" : "none";
        background.setAttribute("width", String(textWidth + 16));
        ripple.style.display =
          activeLabel && !selectedPlaceCountry ? "" : "none";
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
        const group = claimLabel(`region:${provinceArea.properties.regionId}`);
        if (!group) return;
        rememberLabel(group, shapeLabelCoordinates, x, y, textWidth);
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
      for (const country of countries?.countries.features || []) {
        if (geographicLabelCount >= 28) break;
        if (country === highlightedCountry) continue;
        drawCountryLabel(country, false);
      }
      // Geographic labels share collision boxes with place names; selected
      // places always get priority. Draw these static labels in the same frame.
      context.font = "500 14px 'Noto Sans KR', sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      for (const label of geographyLabels) {
        if (geographicLabelCount >= 28) break;
        if (
          label.kind === "country" ||
          camera.zoom < label.minZoom ||
          !isGlobePointVisible(label.coordinates, camera)
        )
          continue;
        const labelItem = geographyLabelItems.get(label);
        if (
          labelItem &&
          (labelledPlaces.has(labelItem.place.id) ||
            (selectedShape && labelItem.place.id === selected?.place.id))
        )
          continue;
        const xy = projection(label.coordinates);
        if (!xy) continue;
        const [x, y] = xy;
        const textWidth = measureLabelWidth(label.name);
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
          const group = claimLabel(`place:${labelItem.entry.id}`);
          if (!group) continue;
          rememberLabel(group, label.coordinates, left, y, textWidth);
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
          label.kind === "desert"
            ? "--ws-accent-text"
            : label.kind === "terrain"
              ? "--ws-text-muted"
              : "--ws-primary-text",
        );
        context.fillText(label.name, x, y);
        geographicLabelCount += 1;
      }
    };
    requestDraw();
    return () => {
      document.fonts.removeEventListener("loadingdone", refreshTextWidths);
    };
  }, [
    land,
    geography,
    geographyLabels,
    geographyLabelItems,
    terrain,
    terrainLayers,
    showTerrain,
    countries,
    selectedCountry,
    selectedPlaceCountry,
    highlightedCountry,
    mapItems,
    requestDraw,
    selected,
    selectedRiver,
    selectedShape,
    selectedLandform,
    highlightedShape,
    shapeLabelCoordinates,
    highlightedArea,
    provinceArea,
    provinceDetailOpen,
    detailOpen,
    selectableGeography,
    size,
    popupSize,
    panel,
    wide,
    id,
  ]);

  const chooseCountry = useCallback(
    (countryId: string) => {
      if (
        !countries?.countries.features.some(
          (country) => country.properties.id === countryId,
        )
      )
        return;
      pendingPanelFocus.current = "detail";
      setSelectedCountryId(countryId);
      setSelectedId(null);
      setRegionId("");
      setSubregionId("");
      setProvinceDetailOpen(false);
      setPanel("detail");
      setPanelOpen(false);
      setNotice("");
      setSelectionRevision((value) => value + 1);
    },
    [countries],
  );
  const chooseEntry = useCallback(
    (entryId: string) => {
      const next = itemsById.get(entryId);
      if (!next) return;
      const subjectChanged = subject !== "all" && next.subject !== subject;
      const cleared: string[] = [];
      if (subjectChanged) {
        setSubject(next.subject);
      }
      if (
        unitId &&
        (subjectChanged ||
          (!next.entry.geographicReference && next.entry.unitId !== unitId))
      ) {
        setUnitId("");
        cleared.push("단원");
      }
      if (
        eraId &&
        (subjectChanged ||
          (!next.entry.geographicReference &&
            !next.entry.eraIds?.includes(eraId)))
      ) {
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
      setSelectedCountryId(null);
      setProvinceDetailOpen(false);
      setSelectedId(entryId);
      setSelectionRevision((value) => value + 1);
      setPanel("detail");
      setPanelOpen(false);
    },
    [itemsById, areas, subject, unitId, eraId, regionId, subregionId, query],
  );
  const chooseFromList = (entryId: string) => {
    const item = itemsById.get(entryId);
    if (!item) return;
    pendingPanelFocus.current = "detail";
    setSelectedCountryId(null);
    setProvinceDetailOpen(false);
    setSelectedId(entryId);
    setSelectionRevision((value) => value + 1);
    setPanel("detail");
    setPanelOpen(false);
    setNotice("");
  };
  const openProvinceDetails = () => {
    if (!provinceArea) return;
    pendingPanelFocus.current = "detail";
    setProvinceDetailOpen(true);
    setPanel("detail");
    setSelectionRevision((value) => value + 1);
  };
  const resetFilters = () => {
    cancelCamera();
    setSelectedCountryId(null);
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
      { x: 0.5, y: 0.5 },
    );
  };
  const changeRegion = (group: string, subregion: string) => {
    setRegionSelectionDismissed(false);
    setSelectedCountryId(null);
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
              matchesAtlasTemporalScope(item.entry, unitId, eraId) &&
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
    if (next) setCamera(next, { x: 0.5, y: 0.5 });
  };
  const returnToList = () => {
    cancelCamera();
    commitView();
    focusedSelection.current = null;
    setSelectedCountryId(null);
    setSelectedId(null);
    setProvinceDetailOpen(false);
    setRegionSelectionDismissed(true);
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
    selectedCountryId,
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
      label: previous?.label,
    };
  };
  const onPointerDown = (
    event: React.PointerEvent<HTMLCanvasElement | SVGGElement>,
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    cancelCamera();
    event.currentTarget.focus({ preventScroll: true });
    // Keep gesture events on the pressed surface, including SVG label touches.
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, localPointer(event));
    startGesture(gesture.current || undefined);
    if (pointers.current.size === 1 && event.currentTarget !== canvas) {
      const { globeLabel, globeCountry, globeRegion } =
        event.currentTarget.dataset;
      // The drawing pool can reuse this label node during a gesture.
      gesture.current!.label = {
        entryId: globeLabel,
        countryId: globeCountry,
        region: globeRegion,
      };
    }
  };
  const onPointerMove = (
    event: React.PointerEvent<HTMLCanvasElement | SVGGElement>,
  ) => {
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
    event: React.PointerEvent<HTMLCanvasElement | SVGGElement>,
    cancelled = false,
  ) => {
    const original = gesture.current;
    if (!pointers.current.has(event.pointerId)) return;
    const pointer = localPointer(event);
    if (
      original?.points.length === 1 &&
      Math.hypot(
        pointer.x - original.points[0].x,
        pointer.y - original.points[0].y,
      ) > 5
    )
      original.moved = true;
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled && original && !original.moved && !original.multiple) {
      if (original.label) {
        const { entryId, countryId, region } = original.label;
        if (entryId) chooseEntry(entryId);
        else if (countryId) chooseCountry(countryId);
        else if (region) openProvinceDetails();
      } else {
        const hit = nearestGlobePoint(
          drawnPoints.current,
          pointer.x,
          pointer.y,
        );
        if (hit) {
          chooseEntry(hit.item.entry.id);
        } else {
          const feature = hitGeography.current(pointer.x, pointer.y);
          if (feature) chooseEntry(feature.entry.id);
          else setSelectedCountryId(null);
        }
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
      cancelCamera();
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
      wheelActive.current = true;
      updateView({
        ...viewRef.current,
        zoom:
          viewRef.current.zoom *
          Math.exp(-Math.max(-120, Math.min(120, delta)) * 0.002),
      });
      if (wheelCommit.current !== null) clearTimeout(wheelCommit.current);
      wheelCommit.current = setTimeout(() => {
        wheelCommit.current = null;
        wheelActive.current = false;
        commitView();
      }, 120);
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", wheel);
      if (wheelCommit.current !== null) clearTimeout(wheelCommit.current);
      wheelCommit.current = null;
      wheelActive.current = false;
    };
  }, [updateView, commitView, cancelCamera, size.height]);
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
    if (event.key === "Home") {
      setSelectedCountryId(null);
      next = GLOBE_INITIAL_VIEW;
    }
    if (event.key === "Escape") returnToList();
    if (next) {
      event.preventDefault();
      setCamera(next, event.key === "Home" ? { x: 0.5, y: 0.5 } : undefined);
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
          <div className="history-globe__rows" ref={rowsRef}>
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
                  의 현대 해안선·하천과 지명을 표시한다. 작은 섬과 해안선은 세계
                  개관에 맞춰 단순화되어 있다. 8도는 현재 행정구역을 묶은 탐색
                  범위이며, 세계 권역은 현재 국가 경계와 UN M49 등의 지리 구분을
                  따른다. 역사 시대의 영토를 뜻하지 않는다.
                </>
              ),
            },
            { title: "지형 표현", text: ATLAS_TERRAIN_HELP },
            {
              title: "국가 영역",
              text: (
                <>
                  {ATLAS_COUNTRY_HELP}{" "}
                  <a
                    href="https://datacatalog.worldbank.org/search/dataset/0038272/world-bank-official-boundaries"
                    target="_blank"
                    rel="noreferrer"
                  >
                    World Bank Official Boundaries
                  </a>
                  {" · "}
                  <a
                    href={ATLAS_COUNTRY_LICENSE_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    CC BY 4.0
                  </a>
                </>
              ),
            },
            {
              title: "자료 출처",
              items: [
                ...atlasRiverCreditItems,
                ...atlasDokdoCreditItems,
                ...atlasTerrainCreditItems,
              ],
            },
          ]}
        />
        {toolbar && <div className="history-globe__toolbar">{toolbar}</div>}
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
                setSelectedCountryId(null);
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
                setSelectedCountryId(null);
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
              setSelectedCountryId(null);
              setProvinceDetailOpen(false);
              setSelectedId(null);
              setPage(0);
              setPanel("list");
              setNotice("");
            }}
          />
        </label>
        <AtlasFilterReset onReset={resetFilters} />
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
          style={{ height: mapHeight }}
        >
          <canvas
            ref={canvasRef}
            tabIndex={0}
            role="img"
            aria-label={
              "역사 지구본. 방향키로 회전, 더하기와 빼기로 확대·축소." +
              (selected ? " 선택한 장소: " + nameOf(selected) : "") +
              (selectedCountry
                ? " 선택한 국가: " + selectedCountry.properties.name
                : "")
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
            <defs>
              <clipPath id={id + "-land-clip"}>
                <path ref={landClipRef} />
              </clipPath>
            </defs>
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
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={(event) => endPointer(event)}
                onPointerCancel={(event) => endPointer(event, true)}
                onLostPointerCapture={(event) => {
                  if (event.target === event.currentTarget)
                    endPointer(event, true);
                }}
                onClick={(event) => {
                  // Pointer taps are handled on release; keep keyboard/AT click.
                  if (event.detail > 0) return;
                  const entryId = event.currentTarget.dataset.globeLabel;
                  if (entryId) chooseEntry(entryId);
                  else if (event.currentTarget.dataset.globeCountry)
                    chooseCountry(event.currentTarget.dataset.globeCountry);
                  else if (event.currentTarget.dataset.globeRegion)
                    openProvinceDetails();
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Escape" &&
                    event.currentTarget.dataset.globeCountry
                  ) {
                    event.preventDefault();
                    returnToList();
                    canvasRef.current?.focus({ preventScroll: true });
                    return;
                  }
                  if (event.key !== "Enter" && event.key !== " ") return;
                  const entryId = event.currentTarget.dataset.globeLabel;
                  const countryId = event.currentTarget.dataset.globeCountry;
                  if (
                    !entryId &&
                    !countryId &&
                    !event.currentTarget.dataset.globeRegion
                  )
                    return;
                  event.preventDefault();
                  if (entryId) chooseEntry(entryId);
                  else if (countryId) chooseCountry(countryId);
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
                onClick={() => {
                  setSelectedCountryId(null);
                  setCamera(GLOBE_INITIAL_VIEW, { x: 0.5, y: 0.5 });
                }}
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
          {(landError || (needsTerrain && terrainError)) && (
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
                (selectedCountry?.properties.name ||
                  (selected
                    ? nameOf(selected)
                    : provinceArea?.properties.name)) + " 장소 설명"
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
              {selectedCountry ? (
                <div className="history-globe__detail" ref={detailRef}>
                  <AtlasCountryDetails country={selectedCountry} />
                </div>
              ) : selected ? (
                detail
              ) : (
                provinceArea && (
                  <div className="history-globe__detail" ref={detailRef}>
                    <AtlasAreaDetails area={provinceArea} />
                  </div>
                )
              )}
            </div>
          )}
          <div className="history-globe__attribution">
            <a
              href="https://datacatalog.worldbank.org/search/dataset/0038272/world-bank-official-boundaries"
              target="_blank"
              rel="noreferrer"
            >
              World Bank
            </a>{" "}
            ·{" "}
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
            style={{ height: mapHeight, maxHeight: mapHeight }}
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
