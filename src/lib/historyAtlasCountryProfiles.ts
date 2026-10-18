import sourceData from "../data/atlas/country-profiles.json";

export interface AtlasCountryProfileSource {
  role: string;
  title: string;
  author: string;
  url: string;
  historyUrl: string;
  revisionId: number;
  revisedAt: string;
  retrievedAt: string;
  license: string;
  licenseUrl: string;
  changes: string;
  sourceSha256: string;
}

export interface AtlasCountryProfile {
  id: string;
  name: string;
  overview: string;
  history: string[];
  relations: string[];
  relationshipStatus: "domestic" | "documented" | "not-found";
  sources: AtlasCountryProfileSource[];
}

const profiles = new Map(
  (sourceData.profiles as AtlasCountryProfile[]).map((profile) => [
    profile.id,
    profile,
  ]),
);

/** Source snapshots ship with the map; opening a country needs no Wikipedia call. */
export function getAtlasCountryProfile(id: string): AtlasCountryProfile | null {
  return profiles.get(id) || null;
}
