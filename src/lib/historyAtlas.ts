import type { AtlasHistoricalStory } from "./historyAtlasStories";

export type AtlasSubject = "korea" | "world";

export interface AtlasSource {
  id: string;
  title: string;
  edition: string;
}

export interface AtlasCitation {
  sourceId: string;
  pdfPage: number;
  printedPage?: string;
}

export interface AtlasPlace {
  id: string;
  name: string;
  modernName?: string;
  aliases?: string[];
  /** The source catalogue may lack a position; such places never enter the map dataset. */
  coordinates: [number, number] | null;
  kind?:
    | "settlement"
    | "site"
    | "region"
    | "country"
    | "water"
    | "mountain"
    | "desert"
    | "island";
  locationNote?: string;
}

export interface AtlasUnit {
  id: string;
  subject: AtlasSubject;
  title: string;
  period: string;
  /** West, south, east, north in WGS84 degrees. */
  bounds: [number, number, number, number];
}

export interface AtlasEntry {
  id: string;
  unitId: string;
  placeId: string;
  title: string;
  period: string;
  summary: string;
  /** Empty for source map labels that have no individual historical explanation. */
  significance: string;
  citations: AtlasCitation[];
  relatedPlaceIds?: string[];
  /** Overlapping periods (e.g. Unified Silla and North–South States) are intentional. */
  eraIds?: string[];
  displayName?: string;
  nameNote?: string;
  relatedEntryIds?: string[];
  /** Individually sourced event; source-map captions must not populate this. */
  historicalStory?: AtlasHistoricalStory;
}

export interface AtlasEra {
  id: string;
  subject: AtlasSubject;
  title: string;
}

export interface AtlasDataset {
  sources: AtlasSource[];
  units: AtlasUnit[];
  places: AtlasPlace[];
  entries: AtlasEntry[];
  eras?: AtlasEra[];
}

export const ATLAS_SUBJECT_LABELS: Record<AtlasSubject, string> = {
  korea: "한국사",
  world: "세계사",
};

export const ATLAS_SUBJECT_BOUNDS: Record<AtlasSubject, AtlasUnit["bounds"]> = {
  // Fit the peninsula, Jeju and Dokdo; wider unit views retain their own bounds.
  korea: [124, 33, 132, 43.1],
  world: [-180, -55, 180, 75],
};

export const normalizeAtlasSearch = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase("ko").replace(/\s+/gu, "");

export const matchesAtlasSearch = (
  entry: AtlasEntry,
  place: AtlasPlace,
  value: string,
) => {
  const query = normalizeAtlasSearch(value);
  return (
    !query ||
    [
      entry.title,
      entry.period,
      entry.displayName || "",
      entry.nameNote || "",
      place.name,
      place.modernName || "",
      ...(place.aliases || []),
    ].some((text) => normalizeAtlasSearch(text).includes(query))
  );
};
