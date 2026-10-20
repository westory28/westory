import {
  geoBounds,
  geoCentroid,
  geoDistance,
  geoPath,
  type GeoPermissibleObjects,
  type GeoProjection,
} from "d3-geo";
import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
} from "geojson";
import type { AtlasPlace, AtlasSubject, AtlasUnit } from "./historyAtlas";

type RiverFeature = Feature<
  LineString | MultiLineString,
  { name?: string; name_en?: string; name_alt?: string; source?: string }
>;
export type AtlasRiverCollection = FeatureCollection<
  LineString | MultiLineString
>;

const names: Record<string, string[]> = {
  한강: ["Han", "Namhan", "한강", "남한강", "북한강"],
  남한강: ["Namhan", "남한강"],
  낙동강: ["Nakdong", "낙동강"],
  압록강: ["Yalu", "압록강"],
  두만강: ["Tumen", "두만강"],
  대동강: ["Taedong", "대동강"],
  금강: ["Geum", "금강"],
  섬진강: ["Seomjin", "섬진강"],
  청천강: ["Chongchon", "청천강"],
  예성강: ["Yesong", "Ryesong", "예성강", "례성강"],
  우수리강: ["Ussuri"],
  랴오허강: ["Liao He", "Liao"],
  쑹화강: ["Songhua", "Sungari"],
  // Natural Earth names the upper/middle course “Huang” (10m rivernum 66),
  // while only the lower course also carries “Yellow” (rivernum 95).
  // All three source features are needed; selecting Yellow alone drops most
  // of the river, including its headwaters and the Ordos bend.
  황허강: ["Huang", "Huang He", "Yellow"],
  창장강: ["Chang Jiang", "Yangtze", "Jinsha", "Tongtian"],
  나일강: ["Nile", "White Nile", "Blue Nile"],
  // FAO identifies the Turkish names Dicle and Firat as these same rivers;
  // selecting only the English lower-course names omits the Turkish reaches.
  티그리스강: ["Tigris", "Dicle"],
  유프라테스강: ["Euphrates", "Firat"],
  아마존강: ["Amazonas", "Amazon", "Solimões"],
  파라나강: ["Paraná", "Parana"],
  매켄지강: ["Mackenzie"],
  유콘강: ["Yukon"],
  콜로라도강: ["Colorado"],
  리오그란데강: ["Rio Grande", "Río Bravo"],
  미시시피강: ["Mississippi"],
  예니세이강: ["Yenisey", "Yenisei"],
  레나강: ["Lena"],
  인더스강: ["Indus"],
  갠지스강: ["Ganges", "Ganga"],
  볼가강: ["Volga"],
  돈강: ["Don"],
  콩고강: ["Congo", "Lualaba"],
  나이저강: ["Niger"],
  오비강: ["Ob", "Ob’"],
  메콩강: ["Mekong", "Lancang Jiang"],
  화이허강: ["Huai He", "Huai"],
  헤이룽강: ["Amur", "Heilong Jiang"],
  오하이오강: ["Ohio"],
  다뉴브강: ["Danube", "Donau"],
  가르강: ["Gard", "Gardon"],
  테네시강: ["Tennessee"],
  위강: ["Wei He", "Wei"],
  잠베지강: ["Zambezi", "Zambesi"],
};
const koreanRivers = new Set([
  "한강",
  "남한강",
  "낙동강",
  "압록강",
  "두만강",
  "대동강",
  "금강",
  "섬진강",
  "청천강",
  "예성강",
]);
const normalize = (name: string) =>
  name
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[’'\s.-]/gu, "");

/** Select all source segments of one river, never a straight line between cities. */
export function findAtlasRiver(
  place: AtlasPlace,
  geometry: GeoPermissibleObjects,
): AtlasRiverCollection | null {
  if (place.kind !== "water" || geometry.type !== "FeatureCollection")
    return null;
  const aliases = new Set(
    [...(names[place.name] || []), place.name, ...(place.aliases || [])].map(
      normalize,
    ),
  );
  const features = (geometry as AtlasRiverCollection).features.filter(
    (feature): feature is RiverFeature => {
      if (
        feature.type !== "Feature" ||
        !feature.geometry ||
        !["LineString", "MultiLineString"].includes(feature.geometry.type)
      )
        return false;
      const properties = feature.properties || {};
      if (
        ![properties.name, properties.name_en, properties.name_alt].some(
          (name) => typeof name === "string" && aliases.has(normalize(name)),
        )
      )
        return false;
      const center = geoCentroid(feature);
      // Han and Colorado each name multiple unrelated rivers. Geography resolves them.
      if (koreanRivers.has(place.name))
        return (
          center[0] >= 123 &&
          center[0] <= 132 &&
          center[1] >= 32 &&
          center[1] <= 44
        );
      return (
        !place.coordinates ||
        geoDistance(place.coordinates, center) < Math.PI / 4
      );
    },
  );
  // Prefer the more detailed OSM segments when that river is available there.
  const osmNames = new Set(
    features
      .filter((feature) => feature.properties?.source === "OpenStreetMap")
      .map((feature) => feature.properties?.name),
  );
  const filtered =
    osmNames.size && (koreanRivers.has(place.name) || place.name === "랴오허강")
      ? features.filter(
          (feature) => feature.properties?.source === "OpenStreetMap",
        )
      : features;
  return filtered.length
    ? { type: "FeatureCollection", features: filtered }
    : null;
}

export function atlasRiverPath(
  river: AtlasRiverCollection | null,
  projection: GeoProjection,
) {
  return river ? geoPath(projection).digits(1)(river) || "" : "";
}

export function atlasFocusExtent(
  place: AtlasPlace,
  subject: AtlasSubject,
  river?: GeoPermissibleObjects | null,
): AtlasUnit["bounds"] | null {
  const point = place.coordinates || (river ? geoCentroid(river) : null);
  if (!point || !point.every(Number.isFinite)) return null;
  const korean =
    point[0] >= 123 && point[0] <= 132 && point[1] >= 32 && point[1] <= 44;
  const minWidth = subject === "korea" ? 3 : 18;
  const minHeight = subject === "korea" ? 3 : 14;
  const [[west, south], [east, north]] = river
    ? geoBounds(river)
    : [point, point];
  if (korean && subject !== "korea") {
    // Keep both Koreas visible even when the selected place is near an edge.
    return [
      Math.min(123.5, west - 0.5),
      Math.min(32.5, south - 0.5),
      Math.max(132.5, east + 0.5),
      Math.max(43, north + 0.5),
    ];
  }
  const centerX = (west + east) / 2;
  const centerY = (south + north) / 2;
  const halfWidth = Math.max(minWidth / 2, (east - west) * 0.65);
  const halfHeight = Math.max(minHeight / 2, (north - south) * 0.65);
  return [
    Math.max(-180, centerX - halfWidth),
    Math.max(-80, centerY - halfHeight),
    Math.min(180, centerX + halfWidth),
    Math.min(80, centerY + halfHeight),
  ];
}
