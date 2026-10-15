import type { AtlasDataset, AtlasEntry, AtlasSubject } from "./historyAtlas";
import { isAtlasSourceContext } from "./historyAtlasProfiles";

export interface AtlasHistoricalStory {
  id: string;
  subject: AtlasSubject;
  placeIds: string[];
  displayNames?: Record<string, string>;
  title: string;
  period: string;
  startYear: number;
  endYear?: number;
  eraIds: string[];
  unitId?: string;
  replacesEntryIds?: string[];
  summary: string;
  sources: {
    title: string;
    url: string;
    license?: string;
    licenseUrl?: string;
  }[];
  related?: {
    placeId: string;
    reason: string;
    /** Required for stories shared by multiple places: never copy a city's
     * relationship to every monument that appears in the same story. */
    fromPlaceIds?: string[];
  }[];
}

const eraUnits: Record<string, string> = {
  "k-prehistory": "korea-ancient",
  "k-gojoseon": "korea-ancient",
  "k-early-states": "korea-ancient",
  "k-three-kingdoms": "korea-ancient",
  "k-unified-silla": "korea-north-south",
  "k-balhae": "korea-north-south",
  "k-north-south": "korea-north-south",
  "k-later-three": "korea-goryeo",
  "k-goryeo": "korea-goryeo",
  "k-joseon-early": "korea-joseon",
  "k-joseon-late": "korea-late-joseon",
  "k-opening": "korea-modern",
  "k-colonial": "korea-modern",
  "k-modern": "korea-modern",
  "w-prehistory": "world-ancient",
  "w-ancient": "world-ancient",
  "w-medieval": "world-religions",
  "w-early-modern": "world-exchange",
  "w-modern": "world-nations",
  "w-wars": "world-wars",
  "w-contemporary": "world-contemporary",
};

/** Source-map captions remain as a provenance index. They never become events
 * or historical relationships merely by sharing a page, unit, or date range.
 */
export const addAtlasHistoricalStories = (
  dataset: AtlasDataset,
  stories: AtlasHistoricalStory[],
): AtlasDataset => ({
  ...dataset,
  entries: [
    ...stories.flatMap((story) =>
      story.placeIds.map(
        (placeId): AtlasEntry => ({
          id: `story-${story.id}-${placeId}`,
          placeId,
          displayName: story.displayNames?.[placeId],
          unitId:
            story.unitId ||
            (story.subject === "world" &&
            story.eraIds[0] === "w-medieval" &&
            story.startYear >= 1000
              ? "world-exchange"
              : eraUnits[story.eraIds[0]]),
          title: story.title,
          period: story.period,
          summary: story.summary,
          significance: "",
          eraIds: story.eraIds,
          citations: [],
          historicalStory: story,
        }),
      ),
    ),
    ...dataset.entries,
  ],
});

export const getAtlasHistoricalSummary = (entry: AtlasEntry) =>
  entry.historicalStory
    ? entry.summary
    : entry.summary
        .trim()
        .split(/(?<=[.!?])\s+/u)
        .filter((sentence) => !isAtlasSourceContext(sentence))
        .join(" ");

export const isAtlasHistoricalEntry = (entry: AtlasEntry) =>
  !!getAtlasHistoricalSummary(entry);

export const atlasEntrySubject = (dataset: AtlasDataset, entry: AtlasEntry) =>
  dataset.units.find((unit) => unit.id === entry.unitId)?.subject;

export const getAtlasHistoryEntries = (
  dataset: AtlasDataset,
  placeId: string,
  subject?: AtlasSubject,
) => {
  const found = new Map<string, AtlasEntry>();
  const replaced = new Set(
    dataset.entries.flatMap((entry) =>
      entry.placeId === placeId &&
      (!subject || atlasEntrySubject(dataset, entry) === subject)
        ? entry.historicalStory?.replacesEntryIds || []
        : [],
    ),
  );
  dataset.entries.forEach((entry) => {
    if (
      entry.placeId !== placeId ||
      replaced.has(entry.id) ||
      (subject && atlasEntrySubject(dataset, entry) !== subject) ||
      !isAtlasHistoricalEntry(entry)
    )
      return;
    const key =
      entry.historicalStory?.id ||
      getAtlasHistoricalSummary(entry).replace(/[\s.,·]/gu, "");
    if (!found.has(key)) found.set(key, entry);
  });
  return [...found.values()].sort(
    (a, b) =>
      atlasStoryStartYear(a) - atlasStoryStartYear(b) ||
      a.period.localeCompare(b.period, "ko", { numeric: true }),
  );
};

const eraStartYears: Record<string, number> = {
  "k-prehistory": -100000,
  "k-gojoseon": -2333,
  "k-early-states": -300,
  "k-three-kingdoms": -57,
  "k-unified-silla": 676,
  "k-balhae": 698,
  "k-north-south": 698,
  "k-later-three": 900,
  "k-goryeo": 918,
  "k-joseon-early": 1392,
  "k-joseon-late": 1600,
  "k-opening": 1876,
  "k-colonial": 1910,
  "k-modern": 1945,
  "w-prehistory": -100000,
  "w-ancient": -3500,
  "w-medieval": 500,
  "w-early-modern": 1500,
  "w-modern": 1750,
  "w-wars": 1870,
  "w-contemporary": 1945,
};

export const atlasStoryStartYear = (entry: AtlasEntry) => {
  if (entry.historicalStory) return entry.historicalStory.startYear;
  const year = entry.period.match(/^(기원전\s*)?(\d{3,4})(?:년|~)/u);
  if (year) return Number(year[2]) * (year[1] ? -1 : 1);
  return Math.min(
    ...(entry.eraIds || []).map((era) => eraStartYears[era] ?? Infinity),
  );
};

export interface AtlasHistoricalRelation {
  entry: AtlasEntry;
  reason: string;
  sources: AtlasHistoricalStory["sources"];
}

/** Explicit, evidenced edges only; reverse edges retain the complete reason. */
export const getAtlasHistoricalRelations = (
  dataset: AtlasDataset,
  entry: AtlasEntry,
  subject?: AtlasSubject,
): AtlasHistoricalRelation[] => {
  const found = new Map<string, AtlasHistoricalRelation>();
  const allowed = dataset.entries.filter(
    (item) => !subject || atlasEntrySubject(dataset, item) === subject,
  );
  const add = (
    placeId: string,
    reason: string,
    story: AtlasHistoricalStory,
    preferredEntry?: AtlasEntry,
  ) => {
    if (placeId === entry.placeId || found.has(placeId)) return;
    const target =
      preferredEntry ||
      allowed.find(
        (item) =>
          item.placeId === placeId &&
          item.historicalStory?.eraIds.some((era) =>
            story.eraIds.includes(era),
          ),
      ) ||
      allowed.find((item) => item.placeId === placeId);
    if (target)
      found.set(placeId, { entry: target, reason, sources: story.sources });
  };
  const story = entry.historicalStory;
  const appliesTo = (
    context: AtlasHistoricalStory,
    link: NonNullable<AtlasHistoricalStory["related"]>[number],
    placeId: string,
  ) =>
    (
      link.fromPlaceIds ||
      (context.placeIds.length === 1 ? context.placeIds : [])
    ).includes(placeId);
  story?.related?.forEach((link) => {
    if (appliesTo(story, link, entry.placeId))
      add(link.placeId, link.reason, story);
  });
  for (const other of allowed) {
    if (other.placeId !== entry.placeId || !other.historicalStory) continue;
    const context = other.historicalStory;
    context.related?.forEach((link) => {
      if (appliesTo(context, link, entry.placeId))
        add(link.placeId, link.reason, context);
    });
  }
  // Include incoming factual relationships even for an otherwise unannotated
  // destination. This keeps capital/state and event/site links bidirectional.
  for (const other of allowed) {
    const otherStory = other.historicalStory;
    if (!otherStory) continue;
    for (const link of otherStory.related || []) {
      if (
        link.placeId === entry.placeId &&
        appliesTo(otherStory, link, other.placeId)
      )
        add(other.placeId, link.reason, otherStory, other);
    }
  }
  return [...found.values()].sort((a, b) => {
    const name = (item: AtlasEntry) =>
      item.displayName ||
      dataset.places.find((p) => p.id === item.placeId)?.name ||
      "";
    return name(a.entry).localeCompare(name(b.entry), "ko", { numeric: true });
  });
};
