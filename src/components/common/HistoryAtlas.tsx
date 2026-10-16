import React, {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { geoArea, geoCentroid, geoPath } from "d3-geo";
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
  atlasRegionCameraBounds,
  atlasShapeLabelAnchor,
  constrainAtlasTransform,
  createAtlasPaths,
  createAtlasProjection,
  fitAtlasSelection,
  fitAtlasRegionProjection,
  includeAtlasContextBounds,
  loadAtlasGeometry,
  reframeAtlasSelectionBounds,
  zoomAtlasAt,
  type AtlasGeometry,
  type AtlasTransform,
} from "../../lib/historyAtlasGeometry";
import { acquirePageScrollLock } from "../../lib/pageScrollLock";
import AtlasPlaceDetails from "./AtlasPlaceDetails";
import AtlasAreaDetails from "./AtlasAreaDetails";
import AtlasRegionFilters from "./AtlasRegionFilters";
import AtlasCompass from "./AtlasCompass";
import InfoHelp from "./InfoHelp";
import {
  atlasRiverCreditItems,
  atlasDokdoCreditItems,
} from "./AtlasRiverCredits";
import {
  atlasFocusExtent,
  atlasRiverPath,
  findAtlasRiver,
} from "../../lib/historyAtlasRivers";
import {
  findAtlasLandform,
  loadAtlasLandformGeometry,
} from "../../lib/historyAtlasLandforms";
import "./historyAtlas.css";
import {
  findAtlasArea,
  findAtlasRegionArea,
  matchesAtlasCurrentRegion,
  atlasAreaCameraBounds,
  isAtlasAreaPlace,
  loadAtlasAreaGeometry,
} from "../../lib/historyAtlasAreas";
import {
  ATLAS_DOKDO_COORDINATES,
  ATLAS_DOKDO_ID,
} from "../../data/historyAtlasDokdo";

interface HistoryAtlasProps {
  dataset: AtlasDataset;
  toolbar?: ReactNode;
  initialSubject?: AtlasSubject;
  navigation?: ReactNode;
  onSubjectChange?: (subject: AtlasSubject) => void;
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
  priority?: boolean;
  shape?: boolean;
};
const PAGE_SIZE = 40;
// Keep a city's identity stable while its historical names change by era.
const entryName = ({ place }: LocatedEntry) => place.name;
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

function AtlasHelp() {
  return (
    <InfoHelp
      label="지도 조작과 지형 정보"
      sections={[
        {
          title: "지도 조작",
          rows: [
            {
              label: "이동",
              content: "마우스 드래그 · 한 손가락 드래그",
            },
            {
              label: "확대·축소",
              content: "+·− 버튼 · 마우스 휠 · 두 손가락 벌리기",
            },
            {
              label: "키보드",
              content: "방향키 이동 · +/− 확대·축소 · Home 전체 보기",
            },
            {
              label: "장소 선택",
              content:
                "지명 또는 목록을 누르면 주변 지역과 함께 확대한다. 선택한 지점·강줄기는 파란 후광으로 표시한다.",
            },
          ],
        },
        {
          title: "지형과 위치",
          rows: [
            {
              label: "바탕 지도",
              content:
                "현대 자연지형을 단순화한 지도이며 역사적 국경은 표시하지 않는다.",
            },
            {
              label: "강",
              content:
                "확인된 물줄기를 선으로 표시한다. 축척상 작은 지류는 생략될 수 있다.",
            },
            {
              label: "위치",
              content: "도시·유적은 출처에 근거한 대표 위치로 표시한다.",
            },
            {
              label: "지역 범위",
              content:
                "8도는 현재 도·광역시 경계를 묶은 탐색 범위이다. 세계 지역은 현재 지리 분류와 해역 자료를 사용하며, 역사적 영토를 뜻하지 않는다.",
            },
          ],
        },
        {
          title: "자료 출처",
          items: [
            ...atlasRiverCreditItems,
            ...atlasDokdoCreditItems,
            <a
              key="osm"
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
            >
              OpenStreetMap · 현재 행정 경계
            </a>,
            <a
              key="ne"
              href="https://www.naturalearthdata.com/about/terms-of-use/"
              target="_blank"
              rel="noreferrer"
            >
              Natural Earth · 자연지형
            </a>,
            <a
              key="osm"
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
            >
              © OpenStreetMap contributors · ODbL · 하천 선형·독도 해안선
            </a>,
            <span key="gn">
              <a
                href="https://www.geonames.org/"
                target="_blank"
                rel="noreferrer"
              >
                GeoNames
              </a>{" "}
              ·{" "}
              <a
                href="https://creativecommons.org/licenses/by/4.0/"
                target="_blank"
                rel="noreferrer"
              >
                CC BY 4.0
              </a>{" "}
              · 일부 대표 좌표 가공
            </span>,
          ],
        },
      ]}
    />
  );
}

const AtlasBackground = memo(function AtlasBackground({
  paths,
  transform,
  selectedRiver,
}: {
  paths: { land: string; rivers: string } | null;
  transform: AtlasTransform;
  selectedRiver: string;
}) {
  if (!paths) return null;
  return (
    <g
      className="history-atlas__geography"
      transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}
    >
      <path className="history-atlas__land" d={paths.land} />
      <path className="history-atlas__rivers" d={paths.rivers} />
      {selectedRiver && (
        <>
          <path className="history-atlas__river-glow" d={selectedRiver} />
          <path className="history-atlas__river-selected" d={selectedRiver} />
        </>
      )}
    </g>
  );
});

function placeLabelLayout(
  points: MapPoint[],
  width: number,
  height: number,
  obstacle: { left: number; top: number; right: number; bottom: number } | null,
) {
  const boxes: { left: number; top: number; right: number; bottom: number }[] =
    obstacle ? [obstacle] : [];
  const occupied = new Map<string, MapPoint[]>();
  const labelLimit = Math.max(12, Math.floor((width * height) / 7500));
  return [...points]
    .sort(
      (a, b) =>
        Number(b.active) * 2 +
        Number(!!b.priority) -
        (Number(a.active) * 2 + Number(!!a.priority)),
    )
    .map((point) => {
      const emphasized = point.active;
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
        point.x > obstacle.left - 22 &&
        point.x < obstacle.right + 22 &&
        point.y > obstacle.top - 22 &&
        point.y < obstacle.bottom + 22;
      const hitVisible =
        !behindCard && (emphasized || point.priority || !overlaps);
      if (hitVisible) {
        const key = `${cellX}:${cellY}`;
        occupied.set(key, [...(occupied.get(key) || []), point]);
      }
      const textWidth = Math.max(24, point.name.length * 14);
      const naturalWidth = Math.max(40, textWidth + (emphasized ? 16 : 12));
      const frameLeft =
        emphasized &&
        obstacle &&
        point.y > obstacle.top - 22 &&
        point.y < obstacle.bottom + 22 &&
        point.x > obstacle.right + 22
          ? obstacle.right + 12
          : 8;
      const frameTop =
        emphasized && obstacle && point.y > obstacle.bottom + 22
          ? obstacle.bottom + 12
          : 8;
      const labelWidth = emphasized
        ? Math.min(naturalWidth, Math.max(1, width - frameLeft - 8))
        : naturalWidth;
      const labelHeight = emphasized
        ? Math.ceil(textWidth / Math.max(1, labelWidth - 16)) * 24 + 8
        : Math.ceil(naturalWidth / labelWidth) * 24;
      const rightSide =
        point.x + labelWidth + (point.shape ? -8 : 14) <= width - 8;
      const fitsLeft = point.x - labelWidth - 14 >= frameLeft;
      const centered = !!point.shape || (emphasized && !rightSide && !fitsLeft);
      let left = point.shape
        ? rightSide
          ? point.x - 8
          : point.x - labelWidth + 8
        : centered
          ? point.x - labelWidth / 2
          : rightSide
            ? point.x + 14
            : point.x - labelWidth - 14;
      let top = point.shape
        ? point.y - labelHeight / 2
        : centered
          ? point.y + labelHeight + 14 <= height - 8
            ? point.y + 14
            : point.y - labelHeight - 14
          : point.y - labelHeight / 2;
      if (emphasized) {
        left = Math.max(frameLeft, Math.min(width - labelWidth - 8, left));
        top = Math.max(frameTop, Math.min(height - labelHeight - 8, top));
      }
      const box = {
        left,
        right: left + labelWidth,
        top,
        bottom: top + labelHeight,
      };
      if (point.priority && !point.active) {
        // The base-map label has priority over ordinary names, while leaving
        // the selected label and the description popup unobscured.
        const collides = (candidate: typeof box) =>
          boxes.some(
            (other) =>
              candidate.left < other.right &&
              candidate.right > other.left &&
              candidate.top < other.bottom &&
              candidate.bottom > other.top,
          );
        for (const candidateTop of [
          top,
          point.y + 14,
          point.y - labelHeight - 14,
          frameTop,
        ]) {
          const candidate = {
            ...box,
            top: Math.max(
              frameTop,
              Math.min(height - labelHeight - 8, candidateTop),
            ),
          };
          candidate.bottom = candidate.top + labelHeight;
          if (!collides(candidate)) {
            top = candidate.top;
            box.top = top;
            box.bottom = candidate.bottom;
            break;
          }
        }
      }
      const labelVisible =
        hitVisible &&
        (emphasized || point.priority || boxes.length < labelLimit) &&
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
  toolbar,
  initialSubject = "korea",
  navigation,
  onSubjectChange,
}: HistoryAtlasProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const placesButtonRef = useRef<HTMLButtonElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const overlayRef = useRef<HTMLElement>(null);
  const focusDetailsAfterListRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [subject, setSubject] = useState<AtlasSubject>(initialSubject);
  const [unitId, setUnitId] = useState("");
  const [eraId, setEraId] = useState("");
  const [regionId, setRegionId] = useState("");
  const [subregionId, setSubregionId] = useState("");
  const [query, setQuery] = useState("");
  const [mobilePanel, setMobilePanel] = useState<"places" | null>(null);
  const [filterNotice, setFilterNotice] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [provinceDetailOpen, setProvinceDetailOpen] = useState(false);
  const [listPage, setListPage] = useState(0);
  const [viewBounds, setViewBounds] = useState<AtlasUnit["bounds"] | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState("");
  const [focusRevision, setFocusRevision] = useState(0);
  const pendingFocusRef = useRef<string | null>(null);
  const pendingVisualScaleRef = useRef<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [mapWidth, setMapWidth] = useState(640);
  const [overlayHeight, setOverlayHeight] = useState<number | null>(null);
  const [geometry, setGeometry] = useState<{
    subject: AtlasSubject;
    bounds: AtlasUnit["bounds"];
    data: AtlasGeometry;
  } | null>(null);
  const [geometryError, setGeometryError] = useState(false);
  const [areaError, setAreaError] = useState(false);
  const [landformGeometry, setLandformGeometry] = useState<Awaited<
    ReturnType<typeof loadAtlasLandformGeometry>
  > | null>(null);
  const [areaGeometry, setAreaGeometry] = useState<Awaited<
    ReturnType<typeof loadAtlasAreaGeometry>
  > | null>(null);
  const [geometryAttempt, setGeometryAttempt] = useState(0);
  const [transform, setTransform] = useState<AtlasTransform>(ATLAS_IDENTITY);
  const [cameraMoving, setCameraMoving] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const transformRef = useRef(transform);
  const movedRef = useRef(false);
  const dragRef = useRef<{
    x: number;
    y: number;
    start: AtlasTransform;
    pointerId: number;
  } | null>(null);
  const wide = containerWidth >= 900;
  const mapHeight = wide ? 640 : 480;
  const placesById = useMemo(
    () => new Map(dataset.places.map((place) => [place.id, place])),
    [dataset.places],
  );
  const unitsById = useMemo(
    () => new Map(dataset.units.map((unit) => [unit.id, unit])),
    [dataset.units],
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
  const dokdoItem = useMemo(
    () =>
      subject === "korea"
        ? subjectEntries.find(({ place }) => place.id === ATLAS_DOKDO_ID)
        : undefined,
    [subjectEntries, subject],
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
        ({ entry, place }) =>
          (!unitId || entry.unitId === unitId) &&
          (!eraId || entry.eraIds?.includes(eraId)) &&
          matchesAtlasCurrentRegion(
            place,
            subject,
            regionId,
            subregionId,
            areaGeometry,
          ),
      ),
    [
      subjectEntries,
      subject,
      unitId,
      eraId,
      regionId,
      subregionId,
      areaGeometry,
    ],
  );
  const entries = useMemo(
    () => searchEntries(scopeEntries, query),
    [scopeEntries, query],
  );
  const selected = entries.find(({ entry }) => entry.id === selectedId);
  const provinceArea =
    areaGeometry && !selected
      ? findAtlasRegionArea(subregionId || regionId, areaGeometry)
      : null;
  const overlayWidth = Math.min(wide ? 320 : 280, mapWidth - 16);
  const overlayMaxHeight = mapHeight * (wide ? 0.55 : 0.42);
  const overlayTop = !wide || mapWidth < 650 ? 56 : 8;
  const overlayObstacle = useMemo(
    () =>
      detailOpen && (selected || (provinceDetailOpen && provinceArea))
        ? {
            left: 8,
            top: overlayTop,
            right: 8 + overlayWidth,
            bottom: overlayTop + (overlayHeight ?? overlayMaxHeight),
          }
        : null,
    [
      detailOpen,
      !!selected,
      provinceDetailOpen,
      provinceArea,
      overlayTop,
      overlayHeight,
      mapHeight,
      overlayWidth,
      overlayMaxHeight,
    ],
  );
  const availableMapHeight =
    overlayObstacle && mapWidth < 650
      ? mapHeight - overlayObstacle.bottom - 8
      : mapHeight - 32;
  const availableMapTop =
    overlayObstacle && mapWidth < 650 ? overlayObstacle.bottom + 8 : 0;
  const visiblePlaces = useMemo(() => {
    const result = new Map<string, LocatedEntry>();
    entries.forEach((item) => {
      if (!result.has(item.place.id) || item.entry.id === selected?.entry.id)
        result.set(item.place.id, item);
    });
    return Array.from(result.values()).sort((a, b) =>
      entryName(a).localeCompare(entryName(b), "ko", { numeric: true }),
    );
  }, [entries, selected?.entry.id]);
  const mapPlaces = useMemo(
    () =>
      dokdoItem &&
      !visiblePlaces.some(({ place }) => place.id === ATLAS_DOKDO_ID)
        ? [...visiblePlaces, dokdoItem]
        : visiblePlaces,
    [visiblePlaces, dokdoItem],
  );
  const pageCount = Math.max(1, Math.ceil(visiblePlaces.length / PAGE_SIZE));
  const currentPage = Math.min(listPage, pageCount - 1);
  const pagePlaces = visiblePlaces.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const projection = useMemo(() => {
    const next = createAtlasProjection(subject, bounds, mapWidth, mapHeight);
    return provinceArea
      ? fitAtlasRegionProjection(next, provinceArea, {
          width: mapWidth,
          height: availableMapHeight,
          overlayRight: mapWidth >= 650 ? overlayObstacle?.right : undefined,
        })
      : next;
  }, [
    subject,
    bounds,
    mapWidth,
    mapHeight,
    provinceArea,
    availableMapHeight,
    overlayObstacle?.right,
  ]);
  const paths = useMemo(
    () =>
      geometry?.subject === subject && geometry.bounds === bounds
        ? createAtlasPaths(geometry.data, projection)
        : null,
    [geometry, subject, bounds, projection],
  );
  const riversByPlace = useMemo(() => {
    const result = new Map<
      string,
      NonNullable<ReturnType<typeof findAtlasRiver>>
    >();
    if (geometry?.subject !== subject || geometry.bounds !== bounds)
      return result;
    for (const { place } of visiblePlaces) {
      const river = findAtlasRiver(place, geometry.data.rivers);
      if (river) result.set(place.id, river);
    }
    return result;
  }, [visiblePlaces, geometry, subject, bounds]);
  const selectedRiver = selected
    ? riversByPlace.get(selected.place.id) || null
    : null;
  const landformsByPlace = useMemo(() => {
    const result = new Map<
      string,
      NonNullable<
        ReturnType<typeof findAtlasLandform> | ReturnType<typeof findAtlasArea>
      >
    >();
    for (const { place } of visiblePlaces) {
      const area =
        (areaGeometry && findAtlasArea(place, areaGeometry)) ||
        (landformGeometry && findAtlasLandform(place, landformGeometry));
      if (area) result.set(place.id, area);
    }
    return result;
  }, [visiblePlaces, landformGeometry, areaGeometry]);
  const selectedLandform = selected
    ? landformsByPlace.get(selected.place.id) || null
    : null;
  const selectedShape = selectedRiver || selectedLandform;
  const provincePath = provinceArea
    ? geoPath(projection)(provinceArea) || ""
    : "";
  const provinceLabel = provinceArea
    ? atlasShapeLabelAnchor(
        provinceArea,
        (coordinate) => {
          const point = projection(coordinate as [number, number]);
          return point
            ? [
                point[0] * transform.scale + transform.x,
                point[1] * transform.scale + transform.y,
              ]
            : null;
        },
        {
          left:
            overlayObstacle && mapWidth >= 650
              ? overlayObstacle.right + 48
              : 48,
          top: availableMapTop + 56,
          right: mapWidth - 48,
          bottom: mapHeight - 48,
        },
      )
    : null;
  const landformPaths = useMemo(() => {
    const path = geoPath(projection).digits(1);
    return [...landformsByPlace]
      .sort((a, b) => geoArea(b[1]) - geoArea(a[1]))
      .map(([placeId, area]) => ({
        placeId,
        path: path(area) || "",
      }));
  }, [landformsByPlace, projection]);
  const riverPaths = useMemo(
    () =>
      [...riversByPlace].map(([placeId, river]) => ({
        placeId,
        path: atlasRiverPath(river, projection),
      })),
    [riversByPlace, projection],
  );
  const selectedRiverPath = useMemo(
    () => atlasRiverPath(selectedRiver, projection),
    [selectedRiver, projection],
  );
  const displayedPlace = useMemo(
    () =>
      selected && selectedShape
        ? {
            ...selected.place,
            coordinates: geoCentroid(selectedShape) as [number, number],
            locationNote: selectedLandform
              ? selectedLandform.type === "Feature"
                ? selectedLandform.properties.locationNote
                : "현대 자연지형의 분포를 면으로 표시한다. 경계는 지도 축척에 맞춰 단순화한 것이다."
              : "확인된 현대 수계의 물줄기를 선으로 표시한다. 지도 축척에 맞춰 작은 굴곡은 단순화했다.",
          }
        : selected?.place,
    [selected?.place, selectedShape, selectedLandform],
  );
  const mapPoints = useMemo(() => {
    const points: MapPoint[] = [];
    mapPlaces.forEach((item) => {
      const { place } = item;
      const river =
        riversByPlace.get(place.id) || landformsByPlace.get(place.id);
      const coordinates =
        place.id === ATLAS_DOKDO_ID
          ? ATLAS_DOKDO_COORDINATES
          : river
            ? geoCentroid(river)
            : place.coordinates;
      if (!coordinates) return;
      const shapeViewport = {
        left:
          overlayObstacle && mapWidth >= 650 ? overlayObstacle.right + 24 : 24,
        top: availableMapTop + 24,
        right: mapWidth - 24,
        bottom: mapHeight - 48,
      };
      const position = river
        ? atlasShapeLabelAnchor(
            river,
            (coordinate) => {
              const point = projection(coordinate as [number, number]);
              return point
                ? [
                    point[0] * transform.scale + transform.x,
                    point[1] * transform.scale + transform.y,
                  ]
                : null;
            },
            shapeViewport,
          )
        : projection(coordinates);
      if (!position) return;
      const x = river
        ? position[0]
        : position[0] * transform.scale + transform.x;
      const y = river
        ? position[1]
        : position[1] * transform.scale + transform.y;
      if (x < 0 || x > mapWidth || y < 0 || y > mapHeight) return;
      points.push({
        place,
        name: entryName(item),
        x,
        y,
        active: selected?.place.id === place.id,
        priority: place.id === ATLAS_DOKDO_ID,
        shape: !!river,
      });
    });
    return placeLabelLayout(points, mapWidth, mapHeight, overlayObstacle);
  }, [
    mapPlaces,
    projection,
    transform,
    mapWidth,
    mapHeight,
    availableMapHeight,
    availableMapTop,
    selected?.place.id,
    overlayObstacle,
    riversByPlace,
    landformsByPlace,
  ]);
  const minorDotsPath = useMemo(
    () =>
      mapPoints
        .filter((point) => !point.hitVisible && !point.shape)
        .map(({ x, y }) => `M${x - 2},${y}a2,2 0 1,0 4,0a2,2 0 1,0 -4,0`)
        .join(""),
    [mapPoints],
  );
  const updateTransform = useCallback(
    (value: AtlasTransform, animate = false) => {
      setCameraMoving(animate);
      transformRef.current = value;
      setTransform(value);
    },
    [],
  );
  useEffect(() => {
    if (!cameraMoving) return;
    const timer = window.setTimeout(() => setCameraMoving(false), 300);
    return () => window.clearTimeout(timer);
  }, [cameraMoving, focusRevision]);
  useEffect(() => {
    let onscreen = true;
    const update = () => setMotionPaused(document.hidden || !onscreen);
    const observer = new IntersectionObserver(([entry]) => {
      onscreen = entry.isIntersecting;
      update();
    });
    if (mapRef.current) observer.observe(mapRef.current);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
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
    let disposed = false;
    setAreaError(false);
    setAreaGeometry(null);
    loadAtlasAreaGeometry(subject)
      .then((data) => {
        if (!disposed) setAreaGeometry(data);
      })
      .catch(() => {
        if (!disposed) setAreaError(true);
      });
    return () => {
      disposed = true;
    };
  }, [subject, geometryAttempt]);

  useEffect(() => {
    let disposed = false;
    loadAtlasLandformGeometry()
      .then((data) => {
        if (!disposed) setLandformGeometry(data);
      })
      .catch(() => {
        if (!disposed) setGeometryError(true);
      });
    return () => {
      disposed = true;
    };
  }, [geometryAttempt]);

  useEffect(() => {
    resetMap();
  }, [subject, bounds, mapWidth, mapHeight, resetMap]);

  useEffect(() => {
    setListPage(0);
  }, [subject, unitId, eraId, regionId, subregionId, query]);

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

  useLayoutEffect(() => {
    const card = overlayRef.current;
    const map = mapRef.current;
    if (
      !detailOpen ||
      !(selected || (provinceDetailOpen && provinceArea)) ||
      !card ||
      !map
    ) {
      setOverlayHeight(null);
      return;
    }
    const measure = () => {
      if (map.clientWidth <= 0 || card.clientWidth <= 0) return;
      const height = Math.min(mapHeight, card.offsetHeight);
      setOverlayHeight((previous) => (previous === height ? previous : height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    observer.observe(map);
    return () => observer.disconnect();
  }, [
    detailOpen,
    wide,
    selected?.entry.id,
    provinceDetailOpen,
    provinceArea,
    mapHeight,
    overlayTop,
  ]);

  useEffect(() => {
    if (detailOpen && selected) {
      if (!pendingFocusRef.current)
        pendingVisualScaleRef.current =
          projection.scale() * transformRef.current.scale;
      pendingFocusRef.current = selected.place.id;
      setFocusRevision((value) => value + 1);
    }
  }, [wide, detailOpen, subject, mapWidth, mapHeight, availableMapHeight]);

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

  useEffect(() => {
    if (panelOpen || !focusDetailsAfterListRef.current) return;
    focusDetailsAfterListRef.current = false;
    const frame = requestAnimationFrame(() => {
      const title = detailRef.current?.querySelector("h2");
      if (title) {
        title.tabIndex = -1;
        title.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [panelOpen]);

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
    if (provinceArea) setViewBounds(atlasAreaCameraBounds(provinceArea));
  }, [provinceArea]);

  useEffect(() => {
    if (!provinceArea) return;
    updateTransform(
      fitAtlasSelection(
        projection,
        {
          coordinates: geoCentroid(provinceArea) as [number, number],
          geometry: provinceArea,
        },
        {
          width: mapWidth,
          height: availableMapHeight,
          top: availableMapTop,
          mapHeight,
          overlayRight: mapWidth >= 650 ? overlayObstacle?.right : undefined,
        },
      ),
    );
  }, [
    provinceArea,
    projection,
    mapWidth,
    mapHeight,
    availableMapHeight,
    availableMapTop,
    overlayObstacle?.right,
    updateTransform,
  ]);

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
    if (
      selected.place.kind === "water" &&
      (geometry?.subject !== subject || geometry.bounds !== bounds)
    )
      return;
    if (selected.place.kind === "desert" && !landformGeometry) return;
    if (isAtlasAreaPlace(selected.place) && !areaGeometry) return;
    const coordinates = selectedShape
      ? geoCentroid(selectedShape)
      : selected.place.coordinates;
    if (!coordinates) {
      pendingFocusRef.current = null;
      return;
    }
    const selectionBounds = reframeAtlasSelectionBounds(
      subject,
      coordinates as [number, number],
      bounds,
      baseBounds,
    );
    if (selectionBounds !== bounds) {
      setViewBounds(selectionBounds === baseBounds ? null : selectionBounds);
      return;
    }
    const contextExtent = atlasFocusExtent(
      selected.place,
      subject,
      selectedShape,
    );
    const contextBounds = includeAtlasContextBounds(bounds, contextExtent);
    if (contextBounds !== bounds) {
      setViewBounds(contextBounds);
      return;
    }
    pendingFocusRef.current = null;
    updateTransform(
      fitAtlasSelection(
        projection,
        {
          coordinates: coordinates as [number, number],
          contextBounds: contextExtent,
          geometry: selectedShape,
          minimumScale:
            subject === "korea" &&
            !selectedShape &&
            pendingVisualScaleRef.current !== null
              ? pendingVisualScaleRef.current / projection.scale()
              : undefined,
        },
        {
          width: mapWidth,
          height: availableMapHeight,
          top: availableMapTop,
          mapHeight,
          overlayRight: mapWidth >= 650 ? overlayObstacle?.right : undefined,
        },
      ),
      true,
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
    availableMapHeight,
    availableMapTop,
    updateTransform,
    selectedShape,
    landformGeometry,
    areaGeometry,
    geometry,
    subject,
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
        if (!touch && event.touches.length === 1) movedRef.current = false;
        touch = null;
        return;
      }
      if (event.touches.length === 0) return;
      movedRef.current =
        event.touches.length > 1 || (!!touch && movedRef.current);
      if (event.cancelable && event.touches.length > 1) event.preventDefault();
      touch = { ...touchPoint(event), start: transformRef.current };
    };
    const move = (event: TouchEvent) => {
      if (!touch || event.touches.length === 0) return;
      if (event.touches.length !== touch.count) {
        begin(event);
        return;
      }
      const next = touchPoint(event);
      const distance = Math.hypot(next.x - touch.x, next.y - touch.y);
      if (
        !movedRef.current &&
        distance <= 5 &&
        Math.abs(next.distance - touch.distance) <= 5
      )
        return;
      movedRef.current = true;
      if (event.cancelable) event.preventDefault();
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
    const cancel = () => {
      touch = null;
      movedRef.current = true;
    };
    const wheel = (event: WheelEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".history-atlas__overlay")
      )
        return;
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? mapHeight : 1);
      zoom(Math.exp(-Math.max(-240, Math.min(240, delta)) * 0.003), [
        event.clientX - rect.left,
        event.clientY - rect.top,
      ]);
    };
    node.addEventListener("touchstart", begin, { passive: false });
    node.addEventListener("touchmove", move, { passive: false });
    node.addEventListener("touchend", end);
    node.addEventListener("touchcancel", cancel);
    node.addEventListener("wheel", wheel, { passive: false });
    return () => {
      node.removeEventListener("touchstart", begin);
      node.removeEventListener("touchmove", move);
      node.removeEventListener("touchend", end);
      node.removeEventListener("touchcancel", cancel);
      node.removeEventListener("wheel", wheel);
    };
  }, [mapWidth, mapHeight, updateTransform, zoom]);

  const requestPlaceFocus = (placeId: string) => {
    pendingVisualScaleRef.current =
      projection.scale() * transformRef.current.scale;
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
    setRegionId("");
    setSubregionId("");
    setQuery("");
    setFilterNotice("");
    setSelectedId("");
    pendingFocusRef.current = null;
  };
  const changeScope = (
    nextUnitId: string,
    nextEraId: string,
    nextRegionId = regionId,
    nextSubregionId = subregionId,
  ) => {
    if (nextUnitId !== unitId) setViewBounds(null);
    const regionChanged =
      nextRegionId !== regionId || nextSubregionId !== subregionId;
    if (regionChanged) {
      setProvinceDetailOpen(false);
      setListPage(0);
      setQuery("");
    }
    setUnitId(nextUnitId);
    setEraId(nextEraId);
    setRegionId(nextRegionId);
    setSubregionId(nextSubregionId);
    setFilterNotice("");
    const matches = searchEntries(
      subjectEntries.filter(
        ({ entry, place }) =>
          (!nextUnitId || entry.unitId === nextUnitId) &&
          (!nextEraId || entry.eraIds?.includes(nextEraId)) &&
          matchesAtlasCurrentRegion(
            place,
            subject,
            nextRegionId,
            nextSubregionId,
            areaGeometry,
          ),
      ),
      regionChanged ? "" : query,
    );
    if (regionChanged) {
      // Region browsing frames its actual places, not one arbitrary first row.
      const coordinates = [
        ...new Map(
          matches.flatMap(({ place }) =>
            place.coordinates ? [[place.id, place.coordinates] as const] : [],
          ),
        ).values(),
      ];
      setSelectedId("");
      setDetailOpen(false);
      pendingFocusRef.current = null;
      const area = areaGeometry
        ? findAtlasRegionArea(nextSubregionId || nextRegionId, areaGeometry)
        : null;
      const extent = area ? atlasAreaCameraBounds(area) : null;
      setViewBounds(
        extent
          ? extent
          : nextRegionId
            ? atlasRegionCameraBounds(coordinates, subject)
            : null,
      );
      resetMap();
      return;
    }
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
  const focusPlace = (placeId: string) => {
    const next =
      entries.find(
        ({ entry, place }) =>
          place.id === placeId && entry.id === selected?.entry.id,
      ) || entries.find(({ place }) => place.id === placeId);
    if (!next) {
      if (dokdoItem?.place.id === placeId) selectStory(dokdoItem);
      return;
    }
    setFilterNotice("");
    setSelectedId(next.entry.id);
    setDetailOpen(true);
    requestPlaceFocus(next.place.id);
    focusDetailsAfterListRef.current = panelOpen;
    setMobilePanel(null);
  };
  const selectStory = (next: LocatedEntry) => {
    const cleared: string[] = [];
    const nextSubject = unitsById.get(next.entry.unitId)?.subject || subject;
    if (nextSubject !== subject) return;
    if (unitId && next.entry.unitId !== unitId) {
      setUnitId("");
      setViewBounds(null);
      cleared.push("단원");
    }
    if (eraId && !next.entry.eraIds?.includes(eraId)) {
      setEraId("");
      cleared.push("시대");
    }
    if (
      regionId &&
      !matchesAtlasCurrentRegion(
        next.place,
        subject,
        regionId,
        subregionId,
        areaGeometry,
      )
    ) {
      setRegionId("");
      setSubregionId("");
      if (regionId) cleared.push("지역");
    }
    if (query && !matchesAtlasSearch(next.entry, next.place, query)) {
      setQuery("");
      cleared.push("검색");
    }
    setFilterNotice(
      cleared.length
        ? `${entryName(next)} 이야기로 이동하며 ${cleared.join("·")} 조건을 해제했다.`
        : "",
    );
    setSelectedId(next.entry.id);
    setDetailOpen(true);
    requestPlaceFocus(next.place.id);
    setMobilePanel(null);
  };
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
          <p>선택한 조건에 맞는 장소가 없다.</p>
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
        <AtlasPlaceDetails
          dataset={dataset}
          subject={subject}
          entry={selected.entry}
          place={displayedPlace || selected.place}
          onSelectEntry={(entryId) => {
            const next = entriesById.get(entryId);
            if (next) selectStory(next);
          }}
        />
      ) : (
        <p className="history-atlas__empty">선택한 조건에 맞는 장소가 없다.</p>
      )}
    </section>
  );

  return (
    <div
      ref={rootRef}
      className={`history-atlas${wide ? " history-atlas--wide" : ""}${containerWidth >= 1100 ? " history-atlas--large" : ""}${cameraMoving ? " history-atlas--focusing" : ""}${motionPaused ? " history-atlas--paused" : ""}`}
    >
      <div className="history-atlas__heading">
        <div className="history-atlas__heading-title">
          <h1>역사 지도</h1>
          <AtlasHelp />
        </div>
        <div className="history-atlas__actions">{toolbar}</div>
      </div>
      {navigation ?? (
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
                onSubjectChange?.(value);
                setDetailOpen(true);
                setViewBounds(null);
                setUnitId("");
                setEraId("");
                setRegionId("");
                setSubregionId("");
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
      )}
      <div className="history-atlas__filters">
        <div className="atlas-filter-row">
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
          <AtlasRegionFilters
            subject={subject}
            groupId={regionId}
            subregionId={subregionId}
            onChange={(group, subregion) =>
              changeScope(unitId, eraId, group, subregion)
            }
          />
        </div>
        <label className="atlas-filter-search" htmlFor={`${id}-search`}>
          <span>지명 검색</span>
          <div className="history-atlas__search">
            <input
              id={`${id}-search`}
              type="search"
              aria-label="지명 검색"
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
            {!wide && (
              <button
                ref={placesButtonRef}
                type="button"
                className="history-atlas__button history-atlas__places-trigger"
                aria-haspopup="dialog"
                aria-label="장소 목록 열기"
                aria-expanded={panelOpen}
                onClick={() => setMobilePanel("places")}
              >
                장소
              </button>
            )}
            <div className="history-atlas__map-actions">
              <button
                type="button"
                aria-label="지도 축소"
                className="history-atlas__zoom-out"
                disabled={transform.scale <= 0.5}
                onClick={() => zoom(1 / 1.4)}
              >
                −
              </button>
              <output className="history-atlas__zoom" aria-label="지도 배율">
                {Math.round(transform.scale * 100)}%
              </output>
              <button
                type="button"
                aria-label="지도 확대"
                className="history-atlas__zoom-in"
                disabled={transform.scale >= ATLAS_MAX_ZOOM}
                onClick={() => zoom(1.4)}
              >
                +
              </button>
              <button
                className="history-atlas__reset"
                type="button"
                aria-label="전체 보기"
                title="전체 보기"
                onClick={resetView}
              >
                전체
              </button>
            </div>
          </div>
          <div
            ref={mapRef}
            className={`history-atlas__map${overlayObstacle ? " history-atlas__map--detail" : ""}`}
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
              } else if (event.key === "Escape") {
                setDetailOpen(false);
              }
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
                return;
              }
              // A small dot may sit inside a nearby marker's 44px hit area.
              // Resolve the closest visible point before that button handles it.
              if (
                event.detail === 0 ||
                !(event.target instanceof Element) ||
                event.target.closest(
                  ".history-atlas__overlay, .history-atlas__selection-card, .history-atlas__reopen, .history-atlas__point-label, .history-atlas__province-label, .history-atlas__attribution",
                )
              )
                return;
              const rect = event.currentTarget.getBoundingClientRect();
              const x = event.clientX - rect.left;
              const y = event.clientY - rect.top;
              let nearest: MapPoint | undefined;
              let distance = 12;
              for (const point of mapPoints) {
                if (point.shape) continue;
                const nextDistance = Math.hypot(point.x - x, point.y - y);
                if (nextDistance < distance) {
                  nearest = point;
                  distance = nextDistance;
                }
              }
              if (nearest) {
                event.preventDefault();
                event.stopPropagation();
                focusPlace(nearest.place.id);
              }
            }}
          >
            {(selected || (provinceDetailOpen && provinceArea)) &&
              (detailOpen ? (
                <section
                  ref={overlayRef}
                  id={`${id}-overlay`}
                  className="history-atlas__overlay"
                  aria-label="선택 장소 설명"
                  style={{
                    width: overlayWidth,
                    maxHeight: overlayMaxHeight,
                    top: overlayTop,
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.stopPropagation();
                    setDetailOpen(false);
                    mapRef.current?.focus({ preventScroll: true });
                  }}
                  onPointerDown={(event) => {
                    if (event.pointerType !== "touch") movedRef.current = false;
                    event.stopPropagation();
                  }}
                >
                  <div className="history-atlas__overlay-heading">
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
                  {selected
                    ? placeDetail
                    : provinceArea && (
                        <div className="history-atlas__detail">
                          <AtlasAreaDetails area={provinceArea} />
                        </div>
                      )}
                </section>
              ) : selected ? (
                <button
                  type="button"
                  className="history-atlas__button history-atlas__reopen"
                  style={{ top: overlayTop }}
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
                  {entryName(selected)} · 설명
                </button>
              ) : null)}
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${mapWidth} ${mapHeight}`}
              aria-label="지도에 표시된 장소"
            >
              <AtlasBackground
                paths={paths}
                transform={transform}
                selectedRiver={selectedRiverPath}
              />
              {paths && (
                <g
                  transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}
                >
                  {landformPaths.map(({ placeId, path }) => (
                    <path
                      key={placeId}
                      data-place-id={placeId}
                      className={`history-atlas__landform${areaGeometry && findAtlasArea(placesById.get(placeId)!, areaGeometry) ? " is-area" : ""}${selected?.place.id === placeId ? " is-active" : ""}`}
                      d={path}
                      onClick={() => focusPlace(placeId)}
                    />
                  ))}
                  {provinceArea && (
                    <path
                      className="history-atlas__landform is-area is-active"
                      d={provincePath}
                      onClick={() => {
                        setProvinceDetailOpen(true);
                        setDetailOpen(true);
                      }}
                    >
                      <title>{provinceArea.properties.locationNote}</title>
                    </path>
                  )}
                  {riverPaths.map(({ placeId, path }) => (
                    <path
                      key={placeId}
                      data-place-id={placeId}
                      className="history-atlas__river-hit"
                      d={path}
                      onClick={() => focusPlace(placeId)}
                    />
                  ))}
                </g>
              )}
              {paths && (
                <path
                  className="history-atlas__minor-dots"
                  d={minorDotsPath}
                  aria-hidden="true"
                />
              )}
            </svg>
            {paths && provinceArea && provinceLabel && (
              <button
                type="button"
                className="history-atlas__province-label"
                style={{
                  left:
                    provinceLabel[0] +
                      provinceArea.properties.name.length * 14 +
                      8 <=
                    mapWidth - 8
                      ? provinceLabel[0] - 8
                      : provinceLabel[0] -
                        provinceArea.properties.name.length * 14 -
                        8,
                  top: provinceLabel[1],
                  width: provinceArea.properties.name.length * 14 + 16,
                }}
                aria-label={`${provinceArea.properties.name} 설명 보기`}
                onClick={() => {
                  setProvinceDetailOpen(true);
                  setDetailOpen(true);
                }}
              >
                {provinceArea.properties.name}
              </button>
            )}
            {paths &&
              mapPoints.map((point) =>
                point.hitVisible && !point.shape ? (
                  <button
                    key={point.place.id}
                    type="button"
                    className={`history-atlas__point${point.active ? " is-active" : ""}`}
                    style={{ left: point.x, top: point.y }}
                    aria-label={`${point.name} 설명 보기`}
                    aria-pressed={point.active}
                    onClick={() => focusPlace(point.place.id)}
                  >
                    <span className="history-atlas__dot" />
                  </button>
                ) : null,
              )}
            {paths &&
              mapPoints.map((point) =>
                point.hitVisible && point.labelVisible ? (
                  <span
                    key={point.place.id}
                    className={`history-atlas__label-anchor${point.active ? " is-active" : ""}`}
                    style={{ left: point.x, top: point.y }}
                  >
                    <button
                      type="button"
                      aria-label={`${point.name} 설명 보기`}
                      aria-pressed={point.active}
                      className="history-atlas__point-label"
                      onClick={() => focusPlace(point.place.id)}
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
                    </button>
                  </span>
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
                    <span>지형을 불러오지 못했다.</span>
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
            {paths &&
              areaError &&
              (selected ? isAtlasAreaPlace(selected.place) : regionId) && (
                <div
                  className="history-atlas__map-state"
                  role="alert"
                  style={
                    overlayObstacle
                      ? mapWidth >= 650
                        ? { left: overlayObstacle.right }
                        : { top: overlayObstacle.bottom }
                      : undefined
                  }
                >
                  <span>지역 범위를 불러오지 못했다.</span>
                  <button
                    type="button"
                    className="history-atlas__button"
                    onClick={() => setGeometryAttempt((value) => value + 1)}
                  >
                    다시 시도
                  </button>
                </div>
              )}
            <AtlasCompass />
            <div className="history-atlas__attribution">
              <a
                href="https://www.naturalearthdata.com/about/terms-of-use/"
                target="_blank"
                rel="noreferrer"
              >
                Natural Earth
              </a>
              {" · "}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
              >
                © OpenStreetMap contributors
              </a>
            </div>
            {!wide && !entries.length && !provinceArea && (
              <div
                className="history-atlas__selection-card history-atlas__empty"
                role="status"
              >
                <p>조건에 맞는 장소가 없다.</p>
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
              "button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], summary, [tabindex]:not([tabindex='-1'])",
            ),
          ).filter(
            (element) =>
              element.tabIndex >= 0 && element.getClientRects().length > 0,
          );
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
            <h2 id={`${id}-panel-title`} tabIndex={-1} data-panel-title>
              장소 목록
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
          {panelOpen && placeList}
        </div>
      </dialog>
    </div>
  );
}
