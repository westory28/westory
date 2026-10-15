import React, {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ATLAS_SUBJECT_BOUNDS,
  ATLAS_SUBJECT_LABELS,
  matchesAtlasSearch,
  normalizeAtlasSearch,
  type AtlasDataset,
  type AtlasEntry,
  type AtlasPlace,
  type AtlasSubject,
  type AtlasUnit,
} from "../../lib/historyAtlas";
import {
  ATLAS_IDENTITY,
  ATLAS_MAX_ZOOM,
  constrainAtlasTransform,
  createAtlasPaths,
  createAtlasProjection,
  loadAtlasGeometry,
  zoomAtlasAt,
  type AtlasGeometry,
  type AtlasTransform,
} from "../../lib/historyAtlasGeometry";
import { acquirePageScrollLock } from "../../lib/pageScrollLock";
import "./historyAtlas.css";

interface HistoryAtlasProps {
  dataset: AtlasDataset;
  onOpenOriginals?: () => void;
  toolbar?: ReactNode;
}

type LocatedEntry = {
  entry: AtlasEntry;
  place: AtlasPlace;
  search: { names: string[]; aliases: string[]; text: string };
};
type MapPoint = {
  place: AtlasPlace;
  name: string;
  x: number;
  y: number;
  active: boolean;
};
const PAGE_SIZE = 40;
const entryName = ({ entry, place }: LocatedEntry) =>
  entry.displayName || place.name;
const locationStatus = (place: AtlasPlace) =>
  place.kind === "country" || place.kind === "region"
    ? "영역 자료"
    : "위치 미확정";
const searchRank = (item: LocatedEntry, normalized: string) => {
  if (!normalized) return 0;
  const { names, aliases } = item.search;
  if (names.includes(normalized)) return 0;
  if (aliases.includes(normalized)) return 1;
  return names.some((value) => value.startsWith(normalized)) ? 2 : 3;
};
const searchEntries = (items: LocatedEntry[], query: string) => {
  const normalized = normalizeAtlasSearch(query);
  if (!normalized) return items;
  return items
    .filter((item) => item.search.text.includes(normalized))
    .sort((a, b) => searchRank(a, normalized) - searchRank(b, normalized));
};

function AtlasHelp({
  label = "지도 조작과 지형 정보",
  children,
}: {
  label?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <span
      className="history-atlas__help"
      ref={root}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!root.current?.contains(document.activeElement)) setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="history-atlas__help-button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">i</span>
      </button>
      {open && (
        <span className="history-atlas__tooltip" id={id} role="tooltip">
          {children || (
            <>
              <strong>지도 조작</strong>
              <span>
                마우스로 끌어 이동하고, Ctrl 또는 ⌘와 휠로 확대합니다. 터치
                화면은 두 손가락을 사용하거나 ‘지도 이동’을 켜세요.
              </span>
              <span>
                지도에 키보드 초점을 두고 방향키로 이동, +·−로 확대·축소,
                Home으로 전체를 봅니다. 겹치는 지명은 확대하거나 장소 목록에서
                선택하세요.
              </span>
              <strong>지형과 위치</strong>
              <span>
                Natural Earth의 현대 자연지형을 단순화해 표시하며 국경은
                표시하지 않습니다. 지점은 도시 중심 또는 설명에 표시한 추정
                위치입니다. 한국사는 메르카토르, 세계사는 내추럴 어스 투영을
                사용합니다.
              </span>
              <span>
                지형:{" "}
                <a
                  href="https://www.naturalearthdata.com/about/terms-of-use/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Natural Earth
                </a>
                . 지명 좌표 일부:{" "}
                <a
                  href="https://www.geonames.org/"
                  target="_blank"
                  rel="noreferrer"
                >
                  GeoNames
                </a>{" "}
                (
                <a
                  href="https://creativecommons.org/licenses/by/4.0/"
                  target="_blank"
                  rel="noreferrer"
                >
                  CC BY 4.0
                </a>
                , 지명 대조·대표점 가공).
              </span>
            </>
          )}
        </span>
      )}
    </span>
  );
}

const AtlasBackground = memo(function AtlasBackground({
  paths,
  transform,
}: {
  paths: { land: string; rivers: string } | null;
  transform: AtlasTransform;
}) {
  if (!paths) return null;
  return (
    <g
      transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}
    >
      <path className="history-atlas__land" d={paths.land} />
      <path className="history-atlas__rivers" d={paths.rivers} />
    </g>
  );
});

function placeLabelLayout(
  points: MapPoint[],
  width: number,
  height: number,
  obstacle: { right: number; bottom: number } | null,
) {
  const boxes: { left: number; top: number; right: number; bottom: number }[] =
    obstacle ? [{ left: 0, top: 0, ...obstacle }] : [];
  const occupied = new Map<string, MapPoint[]>();
  const labelLimit = Math.max(12, Math.floor((width * height) / 7500));
  return [...points]
    .sort((a, b) => Number(b.active) - Number(a.active))
    .map((point) => {
      const cellX = Math.floor(point.x / 44);
      const cellY = Math.floor(point.y / 44);
      let overlaps = false;
      for (let x = cellX - 1; x <= cellX + 1; x++) {
        for (let y = cellY - 1; y <= cellY + 1; y++) {
          if (
            occupied
              .get(`${x}:${y}`)
              ?.some(
                (other) =>
                  Math.hypot(point.x - other.x, point.y - other.y) < 44,
              )
          )
            overlaps = true;
        }
      }
      const behindCard =
        obstacle &&
        point.x < obstacle.right + 22 &&
        point.y < obstacle.bottom + 22;
      const hitVisible = !behindCard && (point.active || !overlaps);
      if (hitVisible) {
        const key = `${cellX}:${cellY}`;
        occupied.set(key, [...(occupied.get(key) || []), point]);
      }
      const naturalWidth = Math.max(40, point.name.length * 14 + 12);
      const frameLeft =
        point.active && obstacle && point.x > obstacle.right + 22
          ? obstacle.right + 12
          : 8;
      const frameTop =
        point.active && obstacle && point.y > obstacle.bottom + 22
          ? obstacle.bottom + 12
          : 8;
      const labelWidth = point.active
        ? Math.min(naturalWidth, Math.max(1, width - frameLeft - 8))
        : naturalWidth;
      const labelHeight = Math.ceil(naturalWidth / labelWidth) * 24;
      const rightSide = point.x + labelWidth + 14 <= width - 8;
      const fitsLeft = point.x - labelWidth - 14 >= frameLeft;
      const centered = point.active && !rightSide && !fitsLeft;
      let left = centered
        ? point.x - labelWidth / 2
        : rightSide
          ? point.x + 14
          : point.x - labelWidth - 14;
      let top = centered
        ? point.y + labelHeight + 14 <= height - 8
          ? point.y + 14
          : point.y - labelHeight - 14
        : point.y - labelHeight / 2;
      if (point.active) {
        left = Math.max(frameLeft, Math.min(width - labelWidth - 8, left));
        top = Math.max(frameTop, Math.min(height - labelHeight - 8, top));
      }
      const box = {
        left,
        right: left + labelWidth,
        top,
        bottom: top + labelHeight,
      };
      const labelVisible =
        hitVisible &&
        (point.active || boxes.length < labelLimit) &&
        box.left >= 4 &&
        box.right <= width - 4 &&
        box.top >= 4 &&
        box.bottom <= height - 4 &&
        (point.active ||
          !boxes.some(
            (other) =>
              box.left < other.right &&
              box.right > other.left &&
              box.top < other.bottom &&
              box.bottom > other.top,
          ));
      if (labelVisible) boxes.push(box);
      return {
        ...point,
        hitVisible,
        labelVisible,
        rightSide,
        centered,
        labelWidth,
        labelLeft: left - point.x + 22,
        labelTop: top - point.y + 22,
      };
    });
}

/** One local atlas renderer is shared by the teacher and student reading views. */
export default function HistoryAtlas({
  dataset,
  onOpenOriginals,
  toolbar,
}: HistoryAtlasProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const placesButtonRef = useRef<HTMLButtonElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [subject, setSubject] = useState<AtlasSubject>("korea");
  const [unitId, setUnitId] = useState("");
  const [eraId, setEraId] = useState("");
  const [query, setQuery] = useState("");
  const [mobilePanel, setMobilePanel] = useState<"places" | "detail" | null>(
    null,
  );
  const [filterNotice, setFilterNotice] = useState("");
  const [detailOpen, setDetailOpen] = useState(true);
  const [listPage, setListPage] = useState(0);
  const [viewBounds, setViewBounds] = useState<AtlasUnit["bounds"] | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState("");
  const [focusRevision, setFocusRevision] = useState(0);
  const pendingFocusRef = useRef<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [mapWidth, setMapWidth] = useState(640);
  const [geometry, setGeometry] = useState<{
    subject: AtlasSubject;
    bounds: AtlasUnit["bounds"];
    data: AtlasGeometry;
  } | null>(null);
  const [geometryError, setGeometryError] = useState(false);
  const [geometryAttempt, setGeometryAttempt] = useState(0);
  const [transform, setTransform] = useState<AtlasTransform>(ATLAS_IDENTITY);
  const [moveMode, setMoveMode] = useState(false);
  const transformRef = useRef(transform);
  const movedRef = useRef(false);
  const dragRef = useRef<{
    x: number;
    y: number;
    start: AtlasTransform;
    pointerId: number;
  } | null>(null);
  const wide = containerWidth >= 900;
  const mapHeight = wide ? 640 : 400;
  const placesById = useMemo(
    () => new Map(dataset.places.map((place) => [place.id, place])),
    [dataset.places],
  );
  const unitsById = useMemo(
    () => new Map(dataset.units.map((unit) => [unit.id, unit])),
    [dataset.units],
  );
  const sourcesById = useMemo(
    () => new Map(dataset.sources.map((source) => [source.id, source])),
    [dataset.sources],
  );
  const subjectUnits = useMemo(
    () => dataset.units.filter((unit) => unit.subject === subject),
    [dataset.units, subject],
  );
  const selectedUnit = subjectUnits.find((unit) => unit.id === unitId);
  const subjectEras = useMemo(
    () => (dataset.eras || []).filter((era) => era.subject === subject),
    [dataset.eras, subject],
  );
  const baseBounds = selectedUnit?.bounds || ATLAS_SUBJECT_BOUNDS[subject];
  const bounds = viewBounds || baseBounds;
  const allEntries = useMemo(
    () =>
      dataset.entries.flatMap((entry): LocatedEntry[] => {
        const place = placesById.get(entry.placeId);
        if (!place || !unitsById.has(entry.unitId)) return [];
        const names = [entry.displayName || "", place.name].map(
          normalizeAtlasSearch,
        );
        const aliases = [place.modernName || "", ...(place.aliases || [])].map(
          normalizeAtlasSearch,
        );
        const text = [
          ...names,
          ...aliases,
          ...[entry.title, entry.period, entry.nameNote || ""].map(
            normalizeAtlasSearch,
          ),
        ].join("\0");
        return [{ entry, place, search: { names, aliases, text } }];
      }),
    [dataset.entries, placesById, unitsById],
  );
  const subjectEntries = useMemo(
    () =>
      allEntries.filter(
        ({ entry }) => unitsById.get(entry.unitId)?.subject === subject,
      ),
    [allEntries, unitsById, subject],
  );
  const entriesById = useMemo(
    () => new Map(allEntries.map((item) => [item.entry.id, item])),
    [allEntries],
  );
  const entriesByPlace = useMemo(() => {
    const result = new Map<string, LocatedEntry[]>();
    subjectEntries.forEach((item) => {
      const group = result.get(item.place.id);
      if (group) group.push(item);
      else result.set(item.place.id, [item]);
    });
    return result;
  }, [subjectEntries]);
  const scopeEntries = useMemo(
    () =>
      subjectEntries.filter(
        ({ entry }) =>
          (!unitId || entry.unitId === unitId) &&
          (!eraId || entry.eraIds?.includes(eraId)),
      ),
    [subjectEntries, unitId, eraId],
  );
  const entries = useMemo(
    () => searchEntries(scopeEntries, query),
    [scopeEntries, query],
  );
  const selected =
    entries.find(({ entry }) => entry.id === selectedId) || entries[0];
  const overlayWidth = Math.min(360, mapWidth - 32);
  const overlayMaxHeight = mapWidth >= 650 ? mapHeight - 32 : mapHeight - 144;
  const overlayObstacle = useMemo(
    () =>
      wide && detailOpen && selected
        ? { right: 16 + overlayWidth, bottom: 16 + overlayMaxHeight }
        : null,
    [wide, detailOpen, !!selected, overlayWidth, overlayMaxHeight],
  );
  const visiblePlaces = useMemo(() => {
    const result = new Map<string, LocatedEntry>();
    entries.forEach((item) => {
      if (!result.has(item.place.id) || item.entry.id === selected?.entry.id)
        result.set(item.place.id, item);
    });
    return Array.from(result.values());
  }, [entries, selected?.entry.id]);
  const pageCount = Math.max(1, Math.ceil(visiblePlaces.length / PAGE_SIZE));
  const currentPage = Math.min(listPage, pageCount - 1);
  const pagePlaces = visiblePlaces.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const samePlaceEntries = selected
    ? entriesByPlace.get(selected.place.id) || []
    : [];
  const projection = useMemo(
    () => createAtlasProjection(subject, bounds, mapWidth, mapHeight),
    [subject, bounds, mapWidth, mapHeight],
  );
  const paths = useMemo(
    () =>
      geometry?.subject === subject && geometry.bounds === bounds
        ? createAtlasPaths(geometry.data, projection)
        : null,
    [geometry, subject, bounds, projection],
  );
  const mapPoints = useMemo(() => {
    const points: MapPoint[] = [];
    visiblePlaces.forEach((item) => {
      const { place } = item;
      if (!place.coordinates) return;
      const position = projection(place.coordinates);
      if (!position) return;
      const x = position[0] * transform.scale + transform.x;
      const y = position[1] * transform.scale + transform.y;
      if (x < 0 || x > mapWidth || y < 0 || y > mapHeight) return;
      points.push({
        place,
        name: entryName(item),
        x,
        y,
        active: selected?.place.id === place.id,
      });
    });
    return placeLabelLayout(points, mapWidth, mapHeight, overlayObstacle);
  }, [
    visiblePlaces,
    projection,
    transform,
    mapWidth,
    mapHeight,
    selected?.place.id,
    overlayObstacle,
  ]);
  const minorDotsPath = useMemo(
    () =>
      mapPoints
        .filter((point) => !point.hitVisible)
        .map(({ x, y }) => `M${x - 2},${y}a2,2 0 1,0 4,0a2,2 0 1,0 -4,0`)
        .join(""),
    [mapPoints],
  );

  const updateTransform = useCallback((value: AtlasTransform) => {
    transformRef.current = value;
    setTransform(value);
  }, []);
  const resetMap = useCallback(
    () => updateTransform(ATLAS_IDENTITY),
    [updateTransform],
  );

  useEffect(() => {
    const root = rootRef.current;
    const map = mapRef.current;
    if (!root || !map) return;
    const measure = () => {
      const rootWidth = root.getBoundingClientRect().width;
      const measuredMapWidth = map.getBoundingClientRect().width;
      // Original-resource navigation can hide this mounted view; preserve its
      // geographic viewport until it is visible at a real size again.
      if (rootWidth > 0 && measuredMapWidth > 0) {
        setContainerWidth(rootWidth);
        setMapWidth(measuredMapWidth);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(map);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    setGeometryError(false);
    loadAtlasGeometry(subject, bounds)
      .then((data) => {
        if (!disposed) setGeometry({ subject, bounds, data });
      })
      .catch(() => {
        if (!disposed) setGeometryError(true);
      });
    return () => {
      disposed = true;
    };
  }, [subject, bounds, geometryAttempt]);

  useEffect(() => {
    resetMap();
    setMoveMode(false);
  }, [subject, bounds, mapWidth, mapHeight, resetMap]);

  useEffect(() => {
    setListPage(0);
  }, [subject, unitId, eraId, query]);

  useEffect(() => {
    const index = visiblePlaces.findIndex(
      ({ place }) => place.id === selected?.place.id,
    );
    if (index >= 0) setListPage(Math.floor(index / PAGE_SIZE));
  }, [selected?.place.id, visiblePlaces]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [currentPage]);

  useEffect(() => {
    detailRef.current?.scrollTo({ top: 0 });
  }, [selected?.entry.id]);

  useEffect(() => {
    if (wide) setMobilePanel(null);
  }, [wide]);

  useEffect(() => {
    if (wide && detailOpen && selected) {
      pendingFocusRef.current = selected.place.id;
      setFocusRevision((value) => value + 1);
    }
  }, [wide, detailOpen, subject, mapWidth, mapHeight]);

  const panelOpen = mobilePanel !== null && !wide;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !panelOpen) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog.showModal();
    const unlock = acquirePageScrollLock();
    return () => {
      dialog.close();
      unlock();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      else placesButtonRef.current?.focus({ preventScroll: true });
    };
  }, [panelOpen]);

  useEffect(() => {
    if (panelOpen)
      dialogRef.current
        ?.querySelector<HTMLElement>("[data-panel-title]")
        ?.focus({ preventScroll: true });
  }, [mobilePanel, panelOpen]);

  const zoom = useCallback(
    (
      factor: number,
      point: [number, number] = [mapWidth / 2, mapHeight / 2],
    ) => {
      updateTransform(
        zoomAtlasAt(transformRef.current, factor, point, mapWidth, mapHeight),
      );
    },
    [mapWidth, mapHeight, updateTransform],
  );

  useEffect(() => {
    if (!selected || !pendingFocusRef.current) return;
    if (
      pendingFocusRef.current &&
      pendingFocusRef.current !== selected.place.id
    )
      return;
    // Persist the actual filtered selection, so removing a query cannot restore
    // an older fallback entry while leaving the camera at the search result.
    if (selectedId !== selected.entry.id) setSelectedId(selected.entry.id);
    const coordinates = selected.place.coordinates;
    if (!coordinates) {
      pendingFocusRef.current = null;
      return;
    }
    const [lon, lat] = coordinates;
    const contains = (extent: AtlasUnit["bounds"]) =>
      lon >= extent[0] &&
      lon <= extent[2] &&
      lat >= extent[1] &&
      lat <= extent[3];
    if (!contains(bounds)) {
      if (contains(baseBounds)) setViewBounds(null);
      else {
        const halfWidth = Math.min(
          20,
          Math.max(4, (baseBounds[2] - baseBounds[0]) / 2),
        );
        const halfHeight = Math.min(
          16,
          Math.max(4, (baseBounds[3] - baseBounds[1]) / 2),
        );
        setViewBounds([
          Math.max(-180, lon - halfWidth),
          Math.max(-80, lat - halfHeight),
          Math.min(180, lon + halfWidth),
          Math.min(80, lat + halfHeight),
        ]);
      }
      return;
    }
    pendingFocusRef.current = null;
    const point = projection(coordinates);
    if (!point) return;
    const current = transformRef.current;
    const targetX =
      overlayObstacle && mapWidth >= 650
        ? (overlayObstacle.right + mapWidth) / 2
        : mapWidth / 2;
    const targetY =
      overlayObstacle && mapWidth < 650
        ? (overlayObstacle.bottom + mapHeight) / 2
        : mapHeight / 2;
    updateTransform(
      constrainAtlasTransform(
        {
          scale: current.scale,
          x: targetX - point[0] * current.scale,
          y: targetY - point[1] * current.scale,
        },
        mapWidth,
        mapHeight,
      ),
    );
  }, [
    query,
    focusRevision,
    selected?.place,
    selected?.entry.id,
    selectedId,
    projection,
    bounds,
    baseBounds,
    overlayObstacle,
    mapWidth,
    mapHeight,
    updateTransform,
  ]);

  useEffect(() => {
    const node = mapRef.current;
    if (!node) return;
    let touch: {
      x: number;
      y: number;
      distance: number;
      start: AtlasTransform;
      count: number;
    } | null = null;
    const touchPoint = (event: TouchEvent) => {
      const rect = node.getBoundingClientRect();
      const first = event.touches[0];
      const second = event.touches[1] || first;
      return {
        x: (first.clientX + second.clientX) / 2 - rect.left,
        y: (first.clientY + second.clientY) / 2 - rect.top,
        distance: Math.hypot(
          first.clientX - second.clientX,
          first.clientY - second.clientY,
        ),
        count: event.touches.length,
      };
    };
    const begin = (event: TouchEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".history-atlas__overlay")
      ) {
        touch = null;
        return;
      }
      if (event.touches.length === 0) return;
      movedRef.current = false;
      if (event.touches.length > 1 || moveMode) {
        if (event.cancelable && event.touches.length > 1)
          event.preventDefault();
        touch = { ...touchPoint(event), start: transformRef.current };
      } else touch = null;
    };
    const move = (event: TouchEvent) => {
      if (!touch || event.touches.length === 0) return;
      if (event.touches.length !== touch.count) {
        begin(event);
        return;
      }
      const next = touchPoint(event);
      if (event.cancelable) event.preventDefault();
      if (
        Math.hypot(next.x - touch.x, next.y - touch.y) > 5 ||
        Math.abs(next.distance - touch.distance) > 5
      )
        movedRef.current = true;
      const zoomed = zoomAtlasAt(
        touch.start,
        next.count > 1 && touch.distance > 0
          ? next.distance / touch.distance
          : 1,
        [touch.x, touch.y],
        mapWidth,
        mapHeight,
      );
      updateTransform(
        constrainAtlasTransform(
          {
            ...zoomed,
            x: zoomed.x + next.x - touch.x,
            y: zoomed.y + next.y - touch.y,
          },
          mapWidth,
          mapHeight,
        ),
      );
    };
    const end = (event: TouchEvent) => {
      if (event.touches.length === 0) touch = null;
      else {
        const moved = movedRef.current;
        begin(event);
        movedRef.current = moved;
      }
    };
    const wheel = (event: WheelEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".history-atlas__overlay")
      )
        return;
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      zoom(Math.exp(-event.deltaY * 0.003), [
        event.clientX - rect.left,
        event.clientY - rect.top,
      ]);
    };
    node.addEventListener("touchstart", begin, { passive: false });
    node.addEventListener("touchmove", move, { passive: false });
    node.addEventListener("touchend", end);
    node.addEventListener("touchcancel", end);
    node.addEventListener("wheel", wheel, { passive: false });
    return () => {
      node.removeEventListener("touchstart", begin);
      node.removeEventListener("touchmove", move);
      node.removeEventListener("touchend", end);
      node.removeEventListener("touchcancel", end);
      node.removeEventListener("wheel", wheel);
    };
  }, [mapWidth, mapHeight, moveMode, updateTransform, zoom]);

  const requestPlaceFocus = (placeId: string) => {
    pendingFocusRef.current = placeId;
    setFocusRevision((value) => value + 1);
  };
  const resetView = () => {
    setDetailOpen(false);
    setViewBounds(null);
    pendingFocusRef.current = null;
    resetMap();
  };
  const clearFilters = () => {
    setViewBounds(null);
    setUnitId("");
    setEraId("");
    setQuery("");
    setFilterNotice("");
    setSelectedId("");
    pendingFocusRef.current = null;
  };
  const changeScope = (nextUnitId: string, nextEraId: string) => {
    if (nextUnitId !== unitId) setViewBounds(null);
    setUnitId(nextUnitId);
    setEraId(nextEraId);
    setFilterNotice("");
    const matches = searchEntries(
      subjectEntries.filter(
        ({ entry }) =>
          (!nextUnitId || entry.unitId === nextUnitId) &&
          (!nextEraId || entry.eraIds?.includes(nextEraId)),
      ),
      query,
    );
    const next =
      matches.find(({ entry }) => entry.id === selected?.entry.id) ||
      matches[0];
    setSelectedId(next?.entry.id || "");
    pendingFocusRef.current = null;
    if (next) requestPlaceFocus(next.place.id);
    if (next) setDetailOpen(true);
  };
  const changeQuery = (value: string) => {
    const matches = searchEntries(scopeEntries, value);
    const normalized = normalizeAtlasSearch(value);
    const bestRank = matches[0] ? searchRank(matches[0], normalized) : 0;
    const next =
      matches.find(
        (item) =>
          item.entry.id === selected?.entry.id &&
          searchRank(item, normalized) === bestRank,
      ) ||
      matches.find(
        (item) =>
          item.entry.id === selectedId &&
          searchRank(item, normalized) === bestRank,
      ) ||
      matches[0];
    setQuery(value);
    setFilterNotice("");
    pendingFocusRef.current = null;
    if (next) {
      setDetailOpen(true);
      setSelectedId(next.entry.id);
      requestPlaceFocus(next.place.id);
    }
  };
  const focusPlace = (placeId: string, focusMap = true) => {
    const next =
      entries.find(
        ({ entry, place }) =>
          place.id === placeId && entry.id === selected?.entry.id,
      ) || entries.find(({ place }) => place.id === placeId);
    if (!next) return;
    setFilterNotice("");
    setSelectedId(next.entry.id);
    setDetailOpen(true);
    if (focusMap || wide) requestPlaceFocus(next.place.id);
    if (!wide) setMobilePanel("detail");
  };
  const selectStory = (next: LocatedEntry) => {
    const cleared: string[] = [];
    const nextSubject = unitsById.get(next.entry.unitId)?.subject || subject;
    const subjectChanged = nextSubject !== subject;
    if (subjectChanged) {
      setSubject(nextSubject);
      setViewBounds(null);
    }
    if (unitId && next.entry.unitId !== unitId) {
      setUnitId("");
      setViewBounds(null);
      cleared.push("단원");
    }
    if (eraId && (subjectChanged || !next.entry.eraIds?.includes(eraId))) {
      setEraId("");
      cleared.push("시대");
    }
    if (
      query &&
      (subjectChanged || !matchesAtlasSearch(next.entry, next.place, query))
    ) {
      setQuery("");
      cleared.push("검색");
    }
    setFilterNotice(
      subjectChanged
        ? `${entryName(next)} 이야기로 이동하며 ${ATLAS_SUBJECT_LABELS[nextSubject]}로 전환했습니다.${cleared.length ? ` ${cleared.join("·")} 조건을 해제했습니다.` : ""}`
        : cleared.length
          ? `${entryName(next)} 이야기로 이동하며 ${cleared.join("·")} 조건을 해제했습니다.`
          : "",
    );
    setSelectedId(next.entry.id);
    setDetailOpen(true);
    requestPlaceFocus(next.place.id);
    if (!wide) setMobilePanel("detail");
  };
  const relatedStories = useMemo(() => {
    if (!selected) return [];
    const result = new Map<string, LocatedEntry>();
    (selected.entry.relatedEntryIds || []).forEach((entryId) => {
      const item = entriesById.get(entryId);
      if (item) result.set(item.entry.id, item);
    });
    (selected.entry.relatedPlaceIds || []).forEach((placeId) => {
      if (Array.from(result.values()).some((item) => item.place.id === placeId))
        return;
      const item =
        scopeEntries.find((item) => item.place.id === placeId) ||
        entriesByPlace.get(placeId)?.[0] ||
        allEntries.find((item) => item.place.id === placeId);
      if (item) result.set(item.entry.id, item);
    });
    return Array.from(result.values());
  }, [selected, entriesById, entriesByPlace, scopeEntries, allEntries]);
  const locationExplanation = selected
    ? selected.place.locationNote ||
      (!selected.place.coordinates
        ? "위치가 확정되지 않아 지도에 핀을 표시하지 않습니다."
        : ["region", "country", "water", "mountain"].includes(
              selected.place.kind || "",
            )
          ? "표시는 지명의 대표 위치이며 영역이나 경계를 뜻하지 않습니다."
          : "")
    : "";

  const placeList = (
    <section className="history-atlas__places" aria-label="장소 목록">
      <div className="history-atlas__places-heading">
        <h2>장소</h2>
        <span>{visiblePlaces.length}곳</span>
      </div>
      {visiblePlaces.length ? (
        <>
          <div className="history-atlas__place-list" ref={listRef}>
            {pagePlaces.map((item) => (
              <button
                type="button"
                key={item.place.id}
                aria-pressed={selected?.place.id === item.place.id}
                onClick={() => focusPlace(item.place.id)}
              >
                <span>{entryName(item)}</span>
                <small>
                  {item.entry.period}
                  {!item.place.coordinates
                    ? ` · ${locationStatus(item.place)}`
                    : ""}
                </small>
              </button>
            ))}
          </div>
          {pageCount > 1 && (
            <nav
              className="history-atlas__pagination"
              aria-label="장소 목록 페이지"
            >
              <button
                type="button"
                className="history-atlas__button"
                aria-label="이전 장소 페이지"
                disabled={currentPage === 0}
                onClick={() => setListPage(currentPage - 1)}
              >
                이전
              </button>
              <span>
                {currentPage + 1} / {pageCount}
              </span>
              <button
                type="button"
                className="history-atlas__button"
                aria-label="다음 장소 페이지"
                disabled={currentPage + 1 >= pageCount}
                onClick={() => setListPage(currentPage + 1)}
              >
                다음
              </button>
            </nav>
          )}
        </>
      ) : (
        <div className="history-atlas__empty">
          <p>선택한 단원·시대·검색어에 맞는 장소가 없습니다.</p>
          <button
            type="button"
            className="history-atlas__button"
            onClick={clearFilters}
          >
            필터 초기화
          </button>
        </div>
      )}
    </section>
  );

  const placeDetail = (
    <section
      ref={detailRef}
      className="history-atlas__detail"
      aria-label="장소 설명"
    >
      {filterNotice && (
        <p className="history-atlas__filter-notice" role="status">
          {filterNotice}
        </p>
      )}
      {selected ? (
        <>
          <div className="history-atlas__detail-heading">
            <span className="history-atlas__period">
              {selected.entry.period}
            </span>
            <div className="history-atlas__place-title">
              <h2>{entryName(selected)}</h2>
              {locationExplanation && (
                <AtlasHelp label={`${entryName(selected)} 위치 정보`}>
                  <span>{locationExplanation}</span>
                </AtlasHelp>
              )}
            </div>
            {selected.entry.nameNote ? (
              <p>{selected.entry.nameNote}</p>
            ) : (
              selected.place.modernName &&
              selected.place.modernName !== entryName(selected) && (
                <p>현재 {selected.place.modernName}</p>
              )
            )}
            {!selected.place.coordinates && (
              <span className="history-atlas__location-status">
                {locationStatus(selected.place)}
              </span>
            )}
          </div>
          <div className="history-atlas__story">
            <h3>{selected.entry.title}</h3>
            <p>{selected.entry.summary}</p>
            {selected.entry.significance.trim() && (
              <>
                <h3>역사적 의미</h3>
                <p>{selected.entry.significance}</p>
              </>
            )}
          </div>
          {samePlaceEntries.length > 1 && (
            <div
              className="history-atlas__story-choices"
              role="group"
              aria-label="같은 장소의 시대별 이야기"
            >
              <h3 className="history-atlas__story-choices-label">
                시대별 이야기
              </h3>
              {samePlaceEntries.map((item) => (
                <button
                  type="button"
                  key={item.entry.id}
                  aria-pressed={item.entry.id === selected.entry.id}
                  onClick={() => selectStory(item)}
                >
                  {item.entry.period} · {entryName(item)}
                </button>
              ))}
            </div>
          )}
          {relatedStories.length > 0 && (
            <div className="history-atlas__related">
              <h3>함께 볼 장소</h3>
              <div>
                {relatedStories.map((item) => (
                  <button
                    key={item.entry.id}
                    type="button"
                    onClick={() => selectStory(item)}
                  >
                    {entryName(item)}
                    <span aria-hidden="true"> →</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <details className="history-atlas__sources" key={selected.entry.id}>
            <summary>교과서 근거 · {selected.entry.citations.length}곳</summary>
            <ul>
              {selected.entry.citations.map((citation, index) => {
                const source = sourcesById.get(citation.sourceId);
                const printedPage = citation.printedPage?.trim();
                return (
                  <li key={`${citation.sourceId}-${citation.pdfPage}-${index}`}>
                    <strong>{source?.title || citation.sourceId}</strong>
                    {source?.edition && <span>{source.edition}</span>}
                    <span>
                      {printedPage ? `본문 ${printedPage}쪽 · ` : ""}
                      PDF {citation.pdfPage}쪽
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        </>
      ) : (
        <p className="history-atlas__empty">
          선택한 조건에 맞는 장소가 없습니다.
        </p>
      )}
    </section>
  );

  return (
    <div
      ref={rootRef}
      className={`history-atlas${wide ? " history-atlas--wide" : ""}${containerWidth >= 1100 ? " history-atlas--large" : ""}`}
    >
      <div className="history-atlas__heading">
        <div className="history-atlas__heading-title">
          <h1>역사 지도</h1>
          <AtlasHelp />
        </div>
        <div className="history-atlas__actions">
          {toolbar}
          {onOpenOriginals && (
            <button
              type="button"
              className="history-atlas__button"
              onClick={onOpenOriginals}
            >
              기존 지도 자료
            </button>
          )}
        </div>
      </div>
      <div
        className="history-atlas__subjects"
        role="group"
        aria-label="역사 과목"
      >
        {(["korea", "world"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={subject === value}
            onClick={() => {
              setSubject(value);
              setDetailOpen(true);
              setViewBounds(null);
              setUnitId("");
              setEraId("");
              setQuery("");
              setFilterNotice("");
              setSelectedId("");
              pendingFocusRef.current = null;
            }}
          >
            {ATLAS_SUBJECT_LABELS[value]}
          </button>
        ))}
      </div>
      <div className="history-atlas__filters">
        <label htmlFor={`${id}-unit`}>
          <span>단원</span>
          <select
            id={`${id}-unit`}
            value={unitId}
            onChange={(event) => {
              changeScope(event.target.value, eraId);
            }}
          >
            <option value="">전체 단원</option>
            {subjectUnits.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.title}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-era`}>
          <span>시대</span>
          <select
            id={`${id}-era`}
            value={eraId}
            onChange={(event) => {
              changeScope(unitId, event.target.value);
            }}
          >
            <option value="">전체 시대</option>
            {subjectEras.map((era) => (
              <option key={era.id} value={era.id}>
                {era.title}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-search`}>
          <span>지명 검색</span>
          <div className="history-atlas__search">
            <input
              id={`${id}-search`}
              type="search"
              value={query}
              placeholder="지명 또는 옛 이름"
              onChange={(event) => changeQuery(event.target.value)}
            />
            {query && (
              <button
                type="button"
                aria-label="지명 검색 지우기"
                onClick={() => changeQuery("")}
              >
                ×
              </button>
            )}
          </div>
        </label>
      </div>
      <div className="history-atlas__workspace">
        <div className="history-atlas__map-column">
          <div className="history-atlas__map-toolbar">
            <span className="history-atlas__map-period">
              {selectedUnit?.period || ATLAS_SUBJECT_LABELS[subject]}
            </span>
            {!wide && (
              <button
                ref={placesButtonRef}
                type="button"
                className="history-atlas__button history-atlas__places-trigger"
                aria-haspopup="dialog"
                aria-expanded={panelOpen}
                onClick={() => setMobilePanel("places")}
              >
                장소 {visiblePlaces.length}
              </button>
            )}
            <div className="history-atlas__map-actions">
              <button
                type="button"
                className="history-atlas__move"
                aria-pressed={moveMode}
                onClick={() => setMoveMode(!moveMode)}
              >
                지도 이동
              </button>
              <button
                type="button"
                aria-label="지도 축소"
                disabled={transform.scale <= 1}
                onClick={() => zoom(1 / 1.4)}
              >
                −
              </button>
              <button
                type="button"
                aria-label="지도 확대"
                disabled={transform.scale >= ATLAS_MAX_ZOOM}
                onClick={() => zoom(1.4)}
              >
                +
              </button>
              <button type="button" onClick={resetView}>
                전체 보기
              </button>
            </div>
          </div>
          <div
            ref={mapRef}
            className={`history-atlas__map${moveMode ? " history-atlas__map--move" : ""}${overlayObstacle ? " history-atlas__map--detail" : ""}`}
            style={{ height: mapHeight }}
            role="region"
            aria-label={`${ATLAS_SUBJECT_LABELS[subject]} 지도. 방향키로 이동, 더하기와 빼기로 확대·축소, Home으로 전체 보기`}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              const steps: Record<string, [number, number]> = {
                ArrowLeft: [48, 0],
                ArrowRight: [-48, 0],
                ArrowUp: [0, 48],
                ArrowDown: [0, -48],
              };
              if (steps[event.key]) {
                event.preventDefault();
                const [x, y] = steps[event.key];
                const current = transformRef.current;
                updateTransform(
                  constrainAtlasTransform(
                    { ...current, x: current.x + x, y: current.y + y },
                    mapWidth,
                    mapHeight,
                  ),
                );
              } else if (event.key === "+" || event.key === "=") {
                event.preventDefault();
                zoom(1.4);
              } else if (event.key === "-") {
                event.preventDefault();
                zoom(1 / 1.4);
              } else if (event.key === "Home") {
                event.preventDefault();
                resetView();
              } else if (event.key === "Escape") setMoveMode(false);
            }}
            onPointerDown={(event) => {
              if (event.pointerType === "touch" || event.button !== 0) return;
              movedRef.current = false;
              dragRef.current = {
                x: event.clientX,
                y: event.clientY,
                start: transformRef.current,
                pointerId: event.pointerId,
              };
              if (
                event.target === event.currentTarget ||
                event.target instanceof SVGElement
              )
                event.currentTarget.focus({ preventScroll: true });
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current;
              if (!drag || drag.pointerId !== event.pointerId) return;
              if (!(event.buttons & 1)) {
                dragRef.current = null;
                return;
              }
              const x = event.clientX - drag.x;
              const y = event.clientY - drag.y;
              if (Math.hypot(x, y) <= 5 && !movedRef.current) return;
              movedRef.current = true;
              if (!event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.setPointerCapture(event.pointerId);
              updateTransform(
                constrainAtlasTransform(
                  { ...drag.start, x: drag.start.x + x, y: drag.start.y + y },
                  mapWidth,
                  mapHeight,
                ),
              );
            }}
            onPointerUp={(event) => {
              dragRef.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
            onLostPointerCapture={() => {
              dragRef.current = null;
            }}
            onClickCapture={(event) => {
              if (movedRef.current && event.detail !== 0) {
                event.preventDefault();
                event.stopPropagation();
                movedRef.current = false;
              }
            }}
          >
            {wide &&
              selected &&
              (detailOpen ? (
                <section
                  id={`${id}-overlay`}
                  className="history-atlas__overlay"
                  aria-label="선택 장소 설명"
                  style={{ width: overlayWidth, maxHeight: overlayMaxHeight }}
                  onPointerDown={(event) => {
                    movedRef.current = false;
                    event.stopPropagation();
                  }}
                >
                  <div className="history-atlas__overlay-heading">
                    <span>장소 설명</span>
                    <button
                      type="button"
                      className="history-atlas__button"
                      aria-label="장소 설명 닫기"
                      onClick={() => {
                        setDetailOpen(false);
                        mapRef.current?.focus({ preventScroll: true });
                      }}
                    >
                      ×
                    </button>
                  </div>
                  {placeDetail}
                </section>
              ) : (
                <button
                  type="button"
                  className="history-atlas__button history-atlas__reopen"
                  aria-expanded={false}
                  aria-controls={`${id}-overlay`}
                  onPointerDown={(event) => {
                    movedRef.current = false;
                    event.stopPropagation();
                  }}
                  onClick={() => {
                    setDetailOpen(true);
                    requestPlaceFocus(selected.place.id);
                  }}
                >
                  선택 장소 설명
                </button>
              ))}
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${mapWidth} ${mapHeight}`}
              aria-hidden="true"
            >
              <AtlasBackground paths={paths} transform={transform} />
              {paths && (
                <path className="history-atlas__minor-dots" d={minorDotsPath} />
              )}
            </svg>
            {paths &&
              mapPoints.map((point) =>
                point.hitVisible ? (
                  <button
                    key={point.place.id}
                    type="button"
                    className={`history-atlas__point${point.active ? " is-active" : ""}`}
                    style={{ left: point.x, top: point.y }}
                    aria-label={`${point.name} 설명 보기`}
                    aria-pressed={point.active}
                    onClick={() => focusPlace(point.place.id, false)}
                  >
                    <span className="history-atlas__dot" />
                    {point.labelVisible && (
                      <span
                        className="history-atlas__point-label"
                        style={{
                          left: point.labelLeft,
                          top: point.labelTop,
                          width: point.labelWidth,
                          textAlign: point.centered
                            ? "center"
                            : point.rightSide
                              ? "left"
                              : "right",
                        }}
                      >
                        {point.name}
                      </span>
                    )}
                  </button>
                ) : null,
              )}
            {!paths && (
              <div
                className="history-atlas__map-state"
                role={geometryError ? "alert" : "status"}
                style={
                  overlayObstacle
                    ? mapWidth >= 650
                      ? { left: overlayObstacle.right }
                      : { top: overlayObstacle.bottom }
                    : undefined
                }
              >
                {geometryError ? (
                  <>
                    <span>지형을 불러오지 못했습니다.</span>
                    <button
                      type="button"
                      className="history-atlas__button"
                      onClick={() => setGeometryAttempt((value) => value + 1)}
                    >
                      다시 시도
                    </button>
                  </>
                ) : (
                  "지도를 불러오는 중…"
                )}
              </div>
            )}
            <span className="history-atlas__north" aria-hidden="true">
              ↑<span>북</span>
            </span>
            {!wide && selected && (
              <button
                type="button"
                className="history-atlas__selection-card"
                onPointerDown={(event) => {
                  movedRef.current = false;
                  event.stopPropagation();
                }}
                onTouchStart={(event) => event.stopPropagation()}
                onClick={() => setMobilePanel("detail")}
                aria-haspopup="dialog"
              >
                <span>
                  <small>{selected.entry.period}</small>
                  <strong>{entryName(selected)}</strong>
                </span>
                <span>설명 보기 →</span>
              </button>
            )}
            {!wide && !selected && (
              <div
                className="history-atlas__selection-card history-atlas__empty"
                role="status"
              >
                <p>조건에 맞는 장소가 없습니다.</p>
                <button
                  type="button"
                  className="history-atlas__button"
                  onClick={clearFilters}
                >
                  필터 초기화
                </button>
              </div>
            )}
          </div>
        </div>
        {wide && (
          <aside className="history-atlas__side-panel" aria-label="장소 탐색">
            {placeList}
          </aside>
        )}
      </div>
      <dialog
        ref={dialogRef}
        className="history-atlas__drawer"
        aria-labelledby={`${id}-panel-title`}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex='-1'])",
            ),
          ).filter((element) => element.getClientRects().length > 0);
          if (!controls.length) {
            event.preventDefault();
            return;
          }
          const index = controls.indexOf(document.activeElement as HTMLElement);
          if (event.shiftKey && index <= 0) {
            event.preventDefault();
            controls[controls.length - 1].focus();
          } else if (
            !event.shiftKey &&
            (index < 0 || index === controls.length - 1)
          ) {
            event.preventDefault();
            controls[0].focus();
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          setMobilePanel(null);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setMobilePanel(null);
        }}
      >
        <div className="history-atlas__drawer-inner">
          <div className="history-atlas__drawer-heading">
            {mobilePanel === "detail" && (
              <button
                type="button"
                className="history-atlas__button"
                onClick={() => setMobilePanel("places")}
              >
                ← 장소
              </button>
            )}
            <h2 id={`${id}-panel-title`} tabIndex={-1} data-panel-title>
              {mobilePanel === "detail" ? "장소 설명" : "장소 목록"}
            </h2>
            <button
              type="button"
              className="history-atlas__button"
              aria-label="장소 패널 닫기"
              onClick={() => setMobilePanel(null)}
            >
              ×
            </button>
          </div>
          {panelOpen && (mobilePanel === "places" ? placeList : placeDetail)}
        </div>
      </dialog>
    </div>
  );
}
