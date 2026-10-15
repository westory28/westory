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
import "./historyAtlas.css";

interface HistoryAtlasProps {
  dataset: AtlasDataset;
  onOpenOriginals?: () => void;
  toolbar?: ReactNode;
}

type LocatedEntry = { entry: AtlasEntry; place: AtlasPlace };
type MapPoint = { place: AtlasPlace; x: number; y: number; active: boolean };

function AtlasHelp() {
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
        aria-label="지도 조작과 지형 정보"
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
          <strong>지도 조작</strong>
          <span>
            마우스로 끌어 이동하고, Ctrl 또는 ⌘와 휠로 확대합니다. 터치 화면은
            두 손가락을 사용하거나 ‘지도 이동’을 켜세요.
          </span>
          <span>
            지도에 키보드 초점을 두고 방향키로 이동, +·−로 확대·축소, Home으로
            전체를 봅니다. 겹치는 지명은 확대하거나 장소 목록에서 선택하세요.
          </span>
          <strong>지형과 위치</strong>
          <span>
            Natural Earth의 현대 자연지형을 단순화해 표시하며 국경은 표시하지
            않습니다. 지점은 도시 중심 또는 설명에 표시한 추정 위치입니다.
            한국사는 메르카토르, 세계사는 내추럴 어스 투영을 사용합니다.
          </span>
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

function placeLabelLayout(points: MapPoint[], width: number, height: number) {
  const boxes: { left: number; top: number; right: number; bottom: number }[] =
    [];
  const accepted: MapPoint[] = [];
  return [...points]
    .sort((a, b) => Number(b.active) - Number(a.active))
    .map((point) => {
      const hitVisible =
        point.active ||
        !accepted.some(
          (other) => Math.hypot(point.x - other.x, point.y - other.y) < 32,
        );
      if (hitVisible) accepted.push(point);
      const naturalWidth = Math.max(40, point.place.name.length * 14 + 12);
      const labelWidth = point.active
        ? Math.min(naturalWidth, Math.max(1, width - 16))
        : naturalWidth;
      const labelHeight = Math.ceil(naturalWidth / labelWidth) * 24;
      const rightSide = point.x + labelWidth + 14 <= width - 8;
      const fitsLeft = point.x - labelWidth - 14 >= 8;
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
        left = Math.max(8, Math.min(width - labelWidth - 8, left));
        top = Math.max(8, Math.min(height - labelHeight - 8, top));
      }
      const box = {
        left,
        right: left + labelWidth,
        top,
        bottom: top + labelHeight,
      };
      const labelVisible =
        hitVisible &&
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
  const [subject, setSubject] = useState<AtlasSubject>("korea");
  const [unitId, setUnitId] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [focusRevision, setFocusRevision] = useState(0);
  const pendingFocusRef = useRef<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [mapWidth, setMapWidth] = useState(640);
  const [geometry, setGeometry] = useState<{
    subject: AtlasSubject;
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
  const wide = containerWidth >= 960;
  const mapHeight = wide ? 520 : 360;
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
  const bounds = useMemo(() => {
    const result: AtlasUnit["bounds"] = [
      ...(selectedUnit?.bounds || ATLAS_SUBJECT_BOUNDS[subject]),
    ];
    // An imported story must remain reachable even when it sits just outside a
    // curriculum editor's region. Search itself never changes the projection.
    dataset.entries.forEach((entry) => {
      if (
        unitsById.get(entry.unitId)?.subject !== subject ||
        (unitId && entry.unitId !== unitId)
      )
        return;
      const coordinates = placesById.get(entry.placeId)?.coordinates;
      if (!coordinates) return;
      const [longitude, latitude] = coordinates;
      result[0] = Math.max(-180, Math.min(result[0], longitude - 0.5));
      result[1] = Math.max(-80, Math.min(result[1], latitude - 0.5));
      result[2] = Math.min(180, Math.max(result[2], longitude + 0.5));
      result[3] = Math.min(80, Math.max(result[3], latitude + 0.5));
    });
    return result;
  }, [dataset.entries, placesById, selectedUnit, subject, unitId, unitsById]);
  const scopeEntries = useMemo(
    () =>
      dataset.entries.flatMap((entry): LocatedEntry[] => {
        const place = placesById.get(entry.placeId);
        if (!place || unitsById.get(entry.unitId)?.subject !== subject)
          return [];
        if (unitId && entry.unitId !== unitId) return [];
        return [{ entry, place }];
      }),
    [dataset.entries, placesById, unitsById, subject, unitId],
  );
  const entries = useMemo(
    () =>
      scopeEntries.filter(({ entry, place }) =>
        matchesAtlasSearch(entry, place, query),
      ),
    [scopeEntries, query],
  );
  const selected =
    entries.find(({ entry }) => entry.id === selectedId) || entries[0];
  const visiblePlaces = useMemo(
    () =>
      Array.from(
        new Map(entries.map(({ place }) => [place.id, place])).values(),
      ),
    [entries],
  );
  const samePlaceEntries = selected
    ? entries.filter(({ place }) => place.id === selected.place.id)
    : [];
  const projection = useMemo(
    () => createAtlasProjection(subject, bounds, mapWidth, mapHeight),
    [subject, bounds, mapWidth, mapHeight],
  );
  const paths = useMemo(
    () =>
      geometry?.subject === subject
        ? createAtlasPaths(geometry.data, projection)
        : null,
    [geometry, subject, projection],
  );
  const mapPoints = useMemo(() => {
    const points: MapPoint[] = [];
    visiblePlaces.forEach((place) => {
      const position = projection(place.coordinates);
      if (!position) return;
      const x = position[0] * transform.scale + transform.x;
      const y = position[1] * transform.scale + transform.y;
      if (x < 0 || x > mapWidth || y < 0 || y > mapHeight) return;
      points.push({ place, x, y, active: selected?.place.id === place.id });
    });
    return placeLabelLayout(points, mapWidth, mapHeight);
  }, [
    visiblePlaces,
    projection,
    transform,
    mapWidth,
    mapHeight,
    selected?.place.id,
  ]);

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
    loadAtlasGeometry(subject)
      .then((data) => {
        if (!disposed) setGeometry({ subject, data });
      })
      .catch(() => {
        if (!disposed) setGeometryError(true);
      });
    return () => {
      disposed = true;
    };
  }, [subject, geometryAttempt]);

  useEffect(() => {
    resetMap();
    setMoveMode(false);
  }, [subject, unitId, mapWidth, mapHeight, resetMap]);

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
    if (!selected || (!query.trim() && !pendingFocusRef.current)) return;
    if (
      pendingFocusRef.current &&
      pendingFocusRef.current !== selected.place.id
    )
      return;
    pendingFocusRef.current = null;
    // Persist the actual filtered selection, so removing a query cannot restore
    // an older fallback entry while leaving the camera at the search result.
    if (selectedId !== selected.entry.id) setSelectedId(selected.entry.id);
    const point = projection(selected.place.coordinates);
    if (!point) return;
    const current = transformRef.current;
    updateTransform(
      constrainAtlasTransform(
        {
          scale: current.scale,
          x: mapWidth / 2 - point[0] * current.scale,
          y: mapHeight / 2 - point[1] * current.scale,
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
  const changeQuery = (value: string) => {
    const matches = scopeEntries.filter(({ entry, place }) =>
      matchesAtlasSearch(entry, place, value),
    );
    const next =
      matches.find(({ entry }) => entry.id === selected?.entry.id) ||
      matches.find(({ entry }) => entry.id === selectedId) ||
      matches[0];
    setQuery(value);
    pendingFocusRef.current = null;
    if (next) {
      setSelectedId(next.entry.id);
      requestPlaceFocus(next.place.id);
    }
  };
  const focusPlace = (placeId: string) => {
    const next =
      entries.find(
        ({ entry, place }) =>
          place.id === placeId && entry.id === selected?.entry.id,
      ) || entries.find(({ place }) => place.id === placeId);
    if (!next) return;
    setSelectedId(next.entry.id);
    requestPlaceFocus(next.place.id);
  };
  const selectRelated = (placeId: string) => {
    const current = scopeEntries.find(({ place }) => place.id === placeId);
    if (current) {
      setQuery("");
      setSelectedId(current.entry.id);
      requestPlaceFocus(placeId);
      return;
    }
    const next = dataset.entries.find(
      (entry) =>
        entry.placeId === placeId &&
        unitsById.get(entry.unitId)?.subject === subject,
    );
    if (!next) return;
    setQuery("");
    setUnitId(next.unitId);
    setSelectedId(next.id);
    requestPlaceFocus(placeId);
  };
  const relatedPlaces = selected
    ? (selected.entry.relatedPlaceIds || []).flatMap((placeId) => {
        const place = placesById.get(placeId);
        return place &&
          dataset.entries.some(
            (entry) =>
              entry.placeId === placeId &&
              unitsById.get(entry.unitId)?.subject === subject,
          )
          ? [place]
          : [];
      })
    : [];

  return (
    <div
      ref={rootRef}
      className={`history-atlas${wide ? " history-atlas--wide" : ""}`}
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
              setUnitId("");
              setQuery("");
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
              setUnitId(event.target.value);
              setSelectedId("");
              pendingFocusRef.current = null;
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
              <button type="button" onClick={resetMap}>
                전체 보기
              </button>
            </div>
          </div>
          <div
            ref={mapRef}
            className={`history-atlas__map${moveMode ? " history-atlas__map--move" : ""}`}
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
                resetMap();
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
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${mapWidth} ${mapHeight}`}
              aria-hidden="true"
            >
              <AtlasBackground paths={paths} transform={transform} />
            </svg>
            {paths &&
              mapPoints.map((point) =>
                point.hitVisible ? (
                  <button
                    key={point.place.id}
                    type="button"
                    className={`history-atlas__point${point.active ? " is-active" : ""}`}
                    style={{ left: point.x, top: point.y }}
                    aria-label={`${point.place.name} 설명 보기`}
                    aria-pressed={point.active}
                    onClick={() => {
                      if (selected?.place.id === point.place.id) return;
                      const entry = entries.find(
                        ({ place }) => place.id === point.place.id,
                      );
                      if (entry) setSelectedId(entry.entry.id);
                    }}
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
                        {point.place.name}
                      </span>
                    )}
                  </button>
                ) : (
                  <span
                    key={point.place.id}
                    className="history-atlas__minor-dot"
                    aria-hidden="true"
                    style={{ left: point.x, top: point.y }}
                  />
                ),
              )}
            {!paths && (
              <div
                className="history-atlas__map-state"
                role={geometryError ? "alert" : "status"}
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
          </div>
          <div className="history-atlas__places">
            <div className="history-atlas__places-heading">
              <h2>장소</h2>
              <span>{visiblePlaces.length}곳</span>
            </div>
            {visiblePlaces.length ? (
              <>
                <select
                  className="history-atlas__place-select"
                  aria-label="지도에서 찾을 장소"
                  value={selected?.place.id || ""}
                  onChange={(event) => focusPlace(event.target.value)}
                >
                  {visiblePlaces.map((place) => (
                    <option key={place.id} value={place.id}>
                      {place.name}
                      {place.modernName && place.modernName !== place.name
                        ? ` · ${place.modernName}`
                        : ""}
                    </option>
                  ))}
                </select>
                <div
                  className="history-atlas__place-list"
                  role="group"
                  aria-label="장소 목록"
                >
                  {visiblePlaces.map((place) => (
                    <button
                      type="button"
                      key={place.id}
                      aria-pressed={selected?.place.id === place.id}
                      onClick={() => focusPlace(place.id)}
                    >
                      <span>{place.name}</span>
                      {place.modernName && place.modernName !== place.name && (
                        <small>{place.modernName}</small>
                      )}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="history-atlas__empty">
                <p>검색 결과가 없습니다.</p>
                <button
                  type="button"
                  className="history-atlas__button"
                  onClick={() => changeQuery("")}
                >
                  검색 지우기
                </button>
              </div>
            )}
          </div>
        </div>
        <section className="history-atlas__detail" aria-label="장소 설명">
          {selected ? (
            <>
              <div className="history-atlas__detail-heading">
                <span className="history-atlas__period">
                  {selected.entry.period}
                </span>
                <h2>{selected.place.name}</h2>
                {selected.place.modernName &&
                  selected.place.modernName !== selected.place.name && (
                    <p>현재 {selected.place.modernName}</p>
                  )}
              </div>
              {samePlaceEntries.length > 1 && (
                <label
                  className="history-atlas__story-select"
                  htmlFor={`${id}-story`}
                >
                  <span>시대별 이야기</span>
                  <select
                    id={`${id}-story`}
                    value={selected.entry.id}
                    onChange={(event) => setSelectedId(event.target.value)}
                  >
                    {samePlaceEntries.map(({ entry }) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.period} · {entry.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="history-atlas__story">
                <h3>{selected.entry.title}</h3>
                <p>{selected.entry.summary}</p>
                <h3>역사적 의미</h3>
                <p>{selected.entry.significance}</p>
              </div>
              {selected.place.locationNote && (
                <p className="history-atlas__location-note">
                  <strong>위치</strong> {selected.place.locationNote}
                </p>
              )}
              {relatedPlaces.length > 0 && (
                <div className="history-atlas__related">
                  <h3>함께 볼 장소</h3>
                  <div>
                    {relatedPlaces.map((place) => (
                      <button
                        key={place.id}
                        type="button"
                        onClick={() => selectRelated(place.id)}
                      >
                        {place.name}
                        <span aria-hidden="true"> →</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <details className="history-atlas__sources">
                <summary>
                  교과서 근거 · {selected.entry.citations.length}곳
                </summary>
                <ul>
                  {selected.entry.citations.map((citation, index) => {
                    const source = sourcesById.get(citation.sourceId);
                    return (
                      <li
                        key={`${citation.sourceId}-${citation.pdfPage}-${index}`}
                      >
                        <strong>{source?.title || citation.sourceId}</strong>
                        {source?.edition && <span>{source.edition}</span>}
                        <span>
                          본문 {citation.printedPage}쪽 · PDF {citation.pdfPage}
                          쪽
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
      </div>
    </div>
  );
}
