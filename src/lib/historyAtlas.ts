export type AtlasSubject = "korea" | "world";

export interface AtlasSource {
  id: string;
  title: string;
  edition: string;
}

export interface AtlasCitation {
  sourceId: string;
  pdfPage: number;
  printedPage: string;
}

export interface AtlasPlace {
  id: string;
  name: string;
  modernName?: string;
  aliases?: string[];
  coordinates: [number, number];
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
  significance: string;
  citations: AtlasCitation[];
  relatedPlaceIds?: string[];
}

export interface AtlasDataset {
  sources: AtlasSource[];
  units: AtlasUnit[];
  places: AtlasPlace[];
  entries: AtlasEntry[];
}

export const ATLAS_SUBJECT_LABELS: Record<AtlasSubject, string> = {
  korea: "한국사",
  world: "세계사",
};

export const ATLAS_SUBJECT_BOUNDS: Record<AtlasSubject, AtlasUnit["bounds"]> = {
  korea: [118, 31, 134, 44],
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
      place.name,
      place.modernName || "",
      ...(place.aliases || []),
    ].some((text) => normalizeAtlasSearch(text).includes(query))
  );
};
