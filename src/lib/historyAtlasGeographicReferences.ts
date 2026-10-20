import type { AtlasDataset, AtlasPlace, AtlasSubject } from "./historyAtlas";
import type { AtlasProfileSource } from "../data/historyAtlasPlaceProfiles";

export interface AtlasGeographicReference {
  place: AtlasPlace;
  definition: string;
  facts: { label: string; value: string }[];
  sources: AtlasProfileSource[];
  /** Independently reviewed modern reference envelope, not a drawn boundary. */
  evidenceBounds: [number, number, number, number];
  /** Exact existing physical-layer identity, never a historic frontier. */
  terrainId?: string;
}

/** Keep geographic background separate from dated events and textbook captions.
 * Both subjects use the same checked point and prose; the globe deduplicates by
 * place ID. Original source entries remain in the provenance ledger.
 */
export function addAtlasGeographicReferences(
  dataset: AtlasDataset,
  references: AtlasGeographicReference[],
): AtlasDataset {
  const places = new Map(dataset.places.map((place) => [place.id, place]));
  for (const reference of references) {
    const existing = places.get(reference.place.id);
    places.set(reference.place.id, {
      ...existing,
      ...reference.place,
      aliases: [
        ...new Set([
          ...(existing?.aliases || []),
          ...(reference.place.aliases || []),
        ]),
      ],
    });
  }
  const subjects: AtlasSubject[] = ["korea", "world"];
  return {
    ...dataset,
    places: [...places.values()],
    units: [
      ...dataset.units,
      ...subjects.map((subject) => ({
        id: `${subject}-geography`,
        subject,
        title: "동아시아 역사 지리",
        period: "지리적 배경",
        bounds: [73, 18, 145, 55] as [number, number, number, number],
      })),
    ],
    entries: [
      ...references.flatMap(({ place, definition, sources }) =>
        subjects.map((subject) => ({
          id: `geography-${subject}-${place.id}`,
          unitId: `${subject}-geography`,
          placeId: place.id,
          title: place.name,
          period: "지리적 배경",
          summary: definition,
          significance: "",
          citations: [],
          eraIds: [],
          geographicReference: { sources },
        })),
      ),
      ...dataset.entries,
    ],
  };
}
