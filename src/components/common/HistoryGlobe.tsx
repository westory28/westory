import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
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
import { loadAtlasRiverGeometry } from "../../lib/historyAtlasGeometry";
import {
  findAtlasRiver,
  type AtlasRiverCollection,
} from "../../lib/historyAtlasRivers";
import { acquirePageScrollLock } from "../../lib/pageScrollLock";
import AtlasPlaceDetails from "./AtlasPlaceDetails";
import InfoHelp from "./InfoHelp";
import { atlasRiverCreditItems } from "./AtlasRiverCredits";
import landUrl from "../../data/atlas/land-globe.json?url";
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
type Pointer = { x: number; y: number };
type Gesture = {
  points: Pointer[];
  view: GlobeView;
  moved: boolean;
  multiple: boolean;
};
const PAGE_SIZE = 40;
// Both portal layouts use the same DESIGN contract, even without inherited tokens.
const GLOBE_COLORS = {
  "--ws-surface-subtle": "#f8fafc",
  "--ws-primary-soft": "#eff6ff",
  "--ws-border-blue": "#dbeafe",
  "--ws-surface": "#ffffff",
  "--ws-text-soft": "#9ca3af",
  "--ws-primary": "#2563eb",
  "--ws-text": "#1f2937",
} as const;
const grid = geoGraticule10();
let landPromise: Promise<GeoPermissibleObjects> | undefined;
function loadLand() {
  if (!landPromise)
    landPromise = fetch(landUrl)
      .then((response) => {
        if (!response.ok) throw new Error("지형을 불러오지 못했습니다.");
        return response.json() as Promise<GeoPermissibleObjects>;
      })
      .catch((error) => {
        landPromise = undefined;
        throw error;
      });
  return landPromise;
}
const nameOf = (item: Item) => item.entry.displayName || item.place.name;

export default function HistoryGlobe({ dataset }: { dataset: AtlasDataset }) {
  const id = useId();
  const rootRef = useRef<HTMLElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);
  const riverHaloRef = useRef<SVGPathElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const pendingPanelFocus = useRef<"detail" | "list" | null>(null);
  const [wide, setWide] = useState(false);
  const [size, setSize] = useState({ width: 600, height: 400 });
  const [subject, setSubject] = useState<AtlasSubject>("world");
  const [unitId, setUnitId] = useState("");
  const [eraId, setEraId] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [panel, setPanel] = useState<"list" | "detail">("list");
  const [panelOpen, setPanelOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [land, setLand] = useState<GeoPermissibleObjects | null>(null);
  const [landError, setLandError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [rivers, setRivers] = useState<AtlasRiverCollection | null>(null);
  const [riverError, setRiverError] = useState(false);
  const [riverAttempt, setRiverAttempt] = useState(0);
  const [view, setView] = useState<GlobeView>(GLOBE_INITIAL_VIEW);
  const viewRef = useRef(view);
  const pointers = useRef(new Map<number, Pointer>());
  const gesture = useRef<Gesture | null>(null);
  const drawnPoints = useRef<Point[]>([]);
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
  const filtered = useMemo(() => {
    const normalized = normalizeAtlasSearch(query);
    const result = items.filter(
      (item) =>
        item.subject === subject &&
        (!unitId || item.entry.unitId === unitId) &&
        (!eraId || item.entry.eraIds?.includes(eraId)) &&
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
    return [...unique.values()];
  }, [items, subject, unitId, eraId, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const mapItems = useMemo(() => {
    const result = filtered.filter((item) => item.place.coordinates);
    if (
      selected?.place.coordinates &&
      !result.some((item) => item.place.id === selected.place.id)
    )
      result.push(selected);
    return result;
  }, [filtered, selected]);
  const selectedRiver = useMemo(
    () => (selected && rivers ? findAtlasRiver(selected.place, rivers) : null),
    [selected, rivers],
  );
  const verifiedRiverPlaceIds = useMemo(() => {
    if (!rivers) return new Set<string>();
    return new Set(
      dataset.places
        .filter((place) => findAtlasRiver(place, rivers))
        .map((place) => place.id),
    );
  }, [dataset.places, rivers]);
  const displayedPlace = useMemo(
    () =>
      selected && selectedRiver
        ? {
            ...selected.place,
            coordinates: geoCentroid(selectedRiver) as [number, number],
            locationNote:
              "확인된 현대 수계의 물줄기를 선으로 표시합니다. 지도 축척에 맞춰 작은 굴곡은 단순화했습니다.",
          }
        : selected?.place,
    [selected?.place, selectedRiver],
  );
  const hasOsmRiver = !!selectedRiver?.features.some(
    (feature) => feature.properties?.source === "OpenStreetMap",
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
    loadLand()
      .then((value) => {
        if (active) setLand(value);
      })
      .catch(() => {
        if (active) setLandError(true);
      });
    return () => {
      active = false;
    };
  }, [loadAttempt]);
  useEffect(() => {
    if (selected?.place.kind !== "water") return;
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
  }, [selected?.place.id, selected?.place.kind, riverAttempt]);
  useEffect(() => {
    if (!selectedRiver || !mapRef.current) return;
    const center = geoCentroid(selectedRiver);
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
      geoPath(projection).bounds(selectedRiver);
    const scale = Math.min(
      (width - 80) / Math.max(0.01, right - left),
      (height - 160) / Math.max(0.01, bottom - top),
    );
    setCamera({
      longitude: center[0],
      latitude: center[1],
      roll: 0,
      zoom: Math.min(GLOBE_MAX_ZOOM, scale / (Math.min(width, height) * 0.44)),
    });
  }, [selectedRiver, setCamera]);
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
    const visibility = () => {
      rootRef.current?.classList.toggle("is-hidden", document.hidden);
      if (document.hidden) {
        cancelDraw();
        pointers.current.clear();
        gesture.current = null;
      } else requestDraw();
    };
    document.addEventListener("visibilitychange", visibility);
    const observer = new IntersectionObserver(([entry]) => {
      inView.current = entry.isIntersecting;
      rootRef.current?.classList.toggle("is-offscreen", !entry.isIntersecting);
      if (entry.isIntersecting) requestDraw();
      else cancelDraw();
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
      const projection = geoOrthographic()
        .translate([width / 2, height / 2])
        .scale(Math.min(width, height) * 0.44 * camera.zoom)
        .rotate([-camera.longitude, -camera.latitude, camera.roll])
        .clipAngle(90)
        .precision(0.5);
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
      if (selectedRiver) {
        context.beginPath();
        path(selectedRiver);
        context.strokeStyle = color("--ws-primary");
        context.lineWidth = 3;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.stroke();
      }
      riverHaloRef.current?.setAttribute(
        "d",
        selectedRiver ? geoPath(projection).digits(1)(selectedRiver) || "" : "",
      );
      const points: Point[] = [];
      const addPoint = (item: Item, coordinates: [number, number] | null) => {
        if (!coordinates || !isGlobePointVisible(coordinates, camera)) return;
        const xy = projection(coordinates);
        if (!xy || xy[0] < 0 || xy[1] < 0 || xy[0] > width || xy[1] > height)
          return;
        points.push({ item, x: xy[0], y: xy[1] });
      };
      for (const item of mapItems) {
        if (selectedRiver && item.place.id === selected?.place.id) continue;
        addPoint(item, item.place.coordinates);
      }
      // A verified river has a course, not an arbitrary city-style point. Its
      // geographical centroid anchors only the label, including null-point data.
      if (selected && selectedRiver)
        addPoint(selected, geoCentroid(selectedRiver));
      const occupied = new Set<string>();
      const rendered: Point[] = [];
      const ordered = [...points].sort(
        (a, b) =>
          Number(b.item.place.id === selected?.place.id) -
          Number(a.item.place.id === selected?.place.id),
      );
      context.fillStyle = color("--ws-primary");
      for (const point of ordered) {
        const cell = Math.floor(point.x / 12) + ":" + Math.floor(point.y / 12);
        if (occupied.has(cell)) continue;
        occupied.add(cell);
        rendered.push(point);
        const active = point.item.place.id === selected?.place.id;
        if (active && selectedRiver) continue;
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
        halo.hidden = !active || !!selectedRiver;
        if (active) {
          halo.style.left = active.x + "px";
          halo.style.top = active.y + "px";
        }
      }
      const labels = ordered.slice(
        0,
        Math.max(4, Math.min(18, Math.floor(width / 60))),
      );
      const boxes: { x: number; y: number; w: number }[] = [];
      context.font = "500 14px 'Noto Sans KR', sans-serif";
      context.textBaseline = "middle";
      for (const point of labels) {
        const label = nameOf(point.item);
        const textWidth = Math.min(
          width - 32,
          context.measureText(label).width,
        );
        const x = Math.min(width - textWidth - 12, Math.max(12, point.x + 10));
        const activeLabel = point.item.place.id === selected?.place.id;
        const naturalY = point.y < 100 ? point.y + 22 : point.y - 18;
        const y = activeLabel
          ? Math.max(80, Math.min(height - 80, naturalY))
          : naturalY;
        if (
          y < 80 ||
          y > height - 68 ||
          boxes.some(
            (box) =>
              Math.abs(box.y - y) < 22 &&
              x < box.x + box.w + 12 &&
              x + textWidth > box.x - 12,
          )
        )
          continue;
        boxes.push({ x, y, w: textWidth });
        context.strokeStyle = color("--ws-surface");
        context.lineWidth = 4;
        context.lineJoin = "round";
        context.strokeText(label, x, y, textWidth);
        context.fillStyle = color("--ws-text");
        context.fillText(label, x, y, textWidth);
      }
    };
    requestDraw();
  }, [land, mapItems, requestDraw, selected, selectedRiver, size]);

  const chooseEntry = useCallback(
    (entryId: string) => {
      const next = itemsById.get(entryId);
      if (!next) return;
      const outside =
        next.subject !== subject ||
        (unitId && next.entry.unitId !== unitId) ||
        (eraId && !next.entry.eraIds?.includes(eraId)) ||
        query;
      if (outside) {
        setSubject(next.subject);
        setUnitId("");
        setEraId("");
        setQuery("");
        setPage(0);
        setNotice(
          next.subject !== subject
            ? ATLAS_SUBJECT_LABELS[next.subject] +
                "로 이동하고 검색·단원·시대 조건을 해제했습니다."
            : "선택한 이야기를 보기 위해 검색·단원·시대 조건을 해제했습니다.",
        );
      } else setNotice("");
      pendingPanelFocus.current = "detail";
      setSelectedId(entryId);
      setPanel("detail");
      if (next.place.coordinates)
        setCamera(focusGlobeView(viewRef.current, next.place.coordinates));
    },
    [itemsById, subject, unitId, eraId, query, setCamera],
  );
  const chooseFromList = (entryId: string) => {
    const item = itemsById.get(entryId);
    if (!item) return;
    pendingPanelFocus.current = "detail";
    setSelectedId(entryId);
    setPanel("detail");
    setNotice("");
    if (item.place.coordinates)
      setCamera(focusGlobeView(viewRef.current, item.place.coordinates));
  };
  const resetFilters = () => {
    setUnitId("");
    setEraId("");
    setQuery("");
    setPage(0);
    setSelectedId(null);
    setPanel("list");
    setNotice("");
  };
  const changeSubject = (next: AtlasSubject) => {
    setSubject(next);
    resetFilters();
    setCamera(
      next === "world"
        ? GLOBE_INITIAL_VIEW
        : { longitude: 127, latitude: 36, roll: 0, zoom: 2 },
    );
  };
  const returnToList = () => {
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
    if (!pendingPanelFocus.current || (!wide && !panelOpen)) return;
    if (pendingPanelFocus.current === "detail" && panel === "detail") {
      // The shared card owns its heading; make that title a programmatic focus
      // target without inserting an extra title or a new item in the Tab order.
      const title = detailRef.current?.querySelector<HTMLElement>("h2");
      if (!title) return;
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
    } else if (pendingPanelFocus.current === "list" && panel === "list") {
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
  }, [panel, selected?.entry.id, currentPage, wide, panelOpen]);

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
        chooseFromList(hit.item.entry.id);
        if (!wide) setPanelOpen(true);
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
          <p>조건에 맞는 장소가 없습니다.</p>
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
                <span>
                  {item.entry.period}
                  {!item.place.coordinates &&
                  !verifiedRiverPlaceIds.has(item.place.id)
                    ? " · 위치 미확정"
                    : ""}
                </span>
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
      <button className="history-globe__back" onClick={returnToList}>
        ← 장소 목록
      </button>
      {selected.place.kind === "water" && riverError && (
        <div className="history-globe__river-error" role="alert">
          <p>물줄기를 불러오지 못했습니다.</p>
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
      className={"history-globe" + (wide ? " is-wide" : "")}
      ref={rootRef}
    >
      <header className="history-globe__header">
        <h1>지구본</h1>
        <InfoHelp
          label="지구본 조작과 지형 정보"
          sections={[
            {
              title: "조작",
              rows: [
                {
                  label: "회전",
                  content: "마우스나 손가락으로 지구본을 끕니다.",
                },
                {
                  label: "확대·축소",
                  content: "휠 또는 두 손가락 벌리기·오므리기를 사용합니다.",
                },
                {
                  label: "북쪽",
                  content:
                    "N 버튼으로 북쪽을 위로 맞춥니다. 두 손가락을 비틀면 방향을 회전합니다.",
                },
              ],
            },
            {
              title: "키보드",
              text: "방향키로 회전, +·−로 확대·축소, N으로 북쪽 복귀, Home으로 전체를 봅니다. 장소 목록에서도 지점을 선택할 수 있습니다.",
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
                  의 현대 자연지형입니다. 작은 섬과 해안선은 세계 개관에 맞춰
                  단순화되어 있습니다. 각 장소의 대표점 근거는 위치 정보에서
                  확인할 수 있습니다.
                </>
              ),
            },
            {
              title: "자료 출처",
              items: atlasRiverCreditItems,
            },
          ]}
        />
      </header>
      <div className="history-globe__filters">
        <div
          className="history-globe__subjects"
          role="group"
          aria-label="역사 과목"
        >
          {(["korea", "world"] as const).map((value) => (
            <button
              key={value}
              aria-pressed={subject === value}
              onClick={() => changeSubject(value)}
            >
              {ATLAS_SUBJECT_LABELS[value]}
            </button>
          ))}
        </div>
        <label htmlFor={id + "-unit"}>
          단원
          <select
            id={id + "-unit"}
            value={unitId}
            onChange={(event) => {
              setUnitId(event.target.value);
              setSelectedId(null);
              setPanel("list");
              setPage(0);
              setNotice("");
            }}
          >
            <option value="">전체 단원</option>
            {dataset.units
              .filter((unit) => unit.subject === subject)
              .map((unit) => (
                <option key={unit.id} value={unit.id}>
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
              setSelectedId(null);
              setPanel("list");
              setPage(0);
              setNotice("");
            }}
          >
            <option value="">전체 시대</option>
            {dataset.eras
              ?.filter((era) => era.subject === subject)
              .map((era) => (
                <option key={era.id} value={era.id}>
                  {era.title}
                </option>
              ))}
          </select>
        </label>
        <label className="history-globe__search" htmlFor={id + "-search"}>
          지명 검색
          <input
            type="search"
            id={id + "-search"}
            value={query}
            placeholder="지명·옛 이름"
            onChange={(event) => {
              setQuery(event.target.value);
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
        <div className="history-globe__map-shell" ref={mapRef}>
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
          </div>
          <div className="history-globe__controls">
            {!wide && (
              <button
                onClick={() => {
                  returnToList();
                  setPanelOpen(true);
                }}
              >
                장소 {filtered.length.toLocaleString()}
              </button>
            )}
            <span className="history-globe__control-spacer" />
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
            <button
              aria-label="북쪽을 위로"
              title="북쪽을 위로"
              onClick={() => setCamera({ ...viewRef.current, roll: 0 })}
            >
              N ↑
            </button>
            <button onClick={() => setCamera(GLOBE_INITIAL_VIEW)}>전체</button>
          </div>
          {!land && !landError && (
            <div className="history-globe__loading" role="status">
              지형을 불러오는 중입니다.
            </div>
          )}
          {landError && (
            <div className="history-globe__loading" role="alert">
              <span>지형을 불러오지 못했습니다.</span>
              <button onClick={() => setLoadAttempt((value) => value + 1)}>
                다시 시도
              </button>
            </div>
          )}
          {!wide && selected && (
            <button
              className="history-globe__selection"
              onClick={() => {
                pendingPanelFocus.current = "detail";
                setPanel("detail");
                setPanelOpen(true);
              }}
            >
              <strong>{nameOf(selected)}</strong>
              <span>{selected.entry.period} · 설명 보기</span>
            </button>
          )}
          <div className="history-globe__attribution">
            <a
              href="https://www.naturalearthdata.com/about/terms-of-use/"
              target="_blank"
              rel="noreferrer"
            >
              Natural Earth
            </a>
            {hasOsmRiver && (
              <>
                {" "}
                ·{" "}
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noreferrer"
                >
                  © OpenStreetMap contributors
                </a>
              </>
            )}
          </div>
        </div>
        {wide && (
          <aside
            className="history-globe__sidebar"
            aria-label="지구본 장소 탐색"
          >
            {panel === "detail" ? detail : list}
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
              <h2 id={id + "-dialog-title"}>
                {panel === "detail" ? "장소 설명" : "장소"}
              </h2>
              <button
                aria-label="장소 패널 닫기"
                onClick={() => setPanelOpen(false)}
              >
                닫기
              </button>
            </header>
            <div className="history-globe__dialog-body">
              {panel === "detail" ? detail : list}
            </div>
          </div>
        </dialog>
      )}
    </section>
  );
}
