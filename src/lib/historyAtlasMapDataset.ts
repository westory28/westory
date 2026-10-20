import type { AtlasDataset, AtlasEntry, AtlasPlace } from "./historyAtlas";
import {
  getAtlasHistoricalSummary,
  type AtlasHistoricalStory,
} from "./historyAtlasStories";
import {
  atlasMapContextLinks,
  atlasMapContextOnlyAliases,
  atlasMapExcludedEntries,
  atlasMapExcludedRelationTargets,
  atlasMapLocationEvidence,
  atlasMapPlaceOverrides,
  atlasMapRelationEntryTargets,
} from "../data/historyAtlasMapCuration";
import {
  atlasLandformPlaceOverrides,
  atlasLandformLocationEvidence,
} from "../data/historyAtlasLandformRestoration";
import {
  atlasKoreaRestoredPlaceOverrides,
  atlasKoreaRestoredLocationEvidence,
  atlasKoreaRestoredStoryRelations,
} from "../data/historyAtlasKoreaRestoration";
import {
  atlasWorldAdditionalPlaceOverrides,
  atlasWorldAdditionalLocationEvidence,
} from "../data/historyAtlasWorldRestorationAdditional";

const mapPlaceOverrides = {
  ...atlasMapPlaceOverrides,
  ...atlasLandformPlaceOverrides,
  ...atlasKoreaRestoredPlaceOverrides,
  ...atlasWorldAdditionalPlaceOverrides,
};
const mapLocationEvidence: Record<string, AtlasHistoricalStory["sources"]> = {
  ...atlasMapLocationEvidence,
  ...atlasLandformLocationEvidence,
  ...atlasWorldAdditionalLocationEvidence,
  ...Object.fromEntries(
    Object.entries(atlasKoreaRestoredLocationEvidence).map(([id, evidence]) => [
      id,
      [
        { title: evidence.title, url: evidence.url },
        {
          title: evidence.coordinateTitle || `${evidence.title} · 위치 근거`,
          url: evidence.coordinateUrl,
          license: evidence.license,
          licenseUrl: evidence.licenseUrl,
        },
      ],
    ]),
  ),
};

export type AtlasMapExclusionReason =
  | "country-or-region"
  | "nonhistorical-facility"
  | "unverified-location"
  | "no-individual-history";

export interface AtlasMapPlaceAudit {
  placeId: string;
  name: string;
  included: boolean;
  reasons: AtlasMapExclusionReason[];
  entryIds: string[];
}

const hasVerifiedPoint = (place: AtlasPlace) =>
  !!place.coordinates &&
  place.coordinates.length === 2 &&
  place.coordinates.every(Number.isFinite) &&
  Math.abs(place.coordinates[0]) <= 180 &&
  Math.abs(place.coordinates[1]) <= 90 &&
  !!place.locationNote?.trim();

const isHistoricalEntry = (entry: AtlasEntry) =>
  !atlasMapExcludedEntries[entry.id] &&
  !!getAtlasHistoricalSummary(entry).trim() &&
  (entry.historicalStory
    ? entry.historicalStory.sources.length > 0
    : (entry.geographicReference?.sources.length || entry.citations.length) >
      0);

/** A map label needs a sourced historical account or reviewed geographic
 * reference, an identified place, and an evidenced coordinate. Unreviewed
 * captions and political territories stay in the source ledger.
 */
export const buildAtlasMapDataset = (source: AtlasDataset) => {
  const units = new Map(source.units.map((unit) => [unit.id, unit]));
  const entriesByPlace = new Map<string, AtlasEntry[]>();
  source.entries.forEach((entry) => {
    if (!units.has(entry.unitId) || !isHistoricalEntry(entry)) return;
    const entries = entriesByPlace.get(entry.placeId) || [];
    entries.push(entry);
    entriesByPlace.set(entry.placeId, entries);
  });
  const audit: AtlasMapPlaceAudit[] = [];
  const places = source.places.flatMap((original) => {
    const place = { ...original, ...mapPlaceOverrides[original.id] };
    if (atlasMapContextOnlyAliases[place.id])
      place.aliases = place.aliases?.filter(
        (alias) => !atlasMapContextOnlyAliases[place.id].includes(alias),
      );
    const reasons: AtlasMapExclusionReason[] = [];
    if (
      place.kind === "country" ||
      (place.kind === "region" &&
        !entriesByPlace
          .get(place.id)
          ?.some((entry) => entry.geographicReference))
    )
      reasons.push("country-or-region");
    // This is an exclusion guard, never the inclusion criterion. Independently
    // checked history and location are still required for every remaining name.
    if (
      /박물관|미술관|연구소|연구원|고속\s*(?:도로|국도)|공항|발전소|산업\s*단지|공업\s*단지/u.test(
        place.name,
      )
    )
      reasons.push("nonhistorical-facility");
    if (!hasVerifiedPoint(place)) reasons.push("unverified-location");
    const entries = entriesByPlace.get(place.id) || [];
    if (!entries.length) reasons.push("no-individual-history");
    audit.push({
      placeId: place.id,
      name: place.name,
      included: !reasons.length,
      reasons,
      entryIds: reasons.length ? [] : entries.map((entry) => entry.id),
    });
    return reasons.length ? [] : [place];
  });
  const placeIds = new Set(places.map((place) => place.id));
  const selectedEntries = source.entries.filter(
    (entry) => placeIds.has(entry.placeId) && isHistoricalEntry(entry),
  );
  const entryIds = new Set(selectedEntries.map((entry) => entry.id));
  const entryById = new Map(selectedEntries.map((entry) => [entry.id, entry]));
  const subjectsByPlace = new Map<string, Set<string>>();
  selectedEntries.forEach((entry) => {
    const subjects = subjectsByPlace.get(entry.placeId) || new Set<string>();
    subjects.add(units.get(entry.unitId)!.subject);
    subjectsByPlace.set(entry.placeId, subjects);
  });
  const entries = selectedEntries.map((entry): AtlasEntry => {
    const subject = units.get(entry.unitId)!.subject;
    const inSubject = (placeId: string) =>
      subjectsByPlace.get(placeId)?.has(subject) || false;
    const relatedEntryIds = entry.relatedEntryIds?.filter(
      (id) =>
        entryIds.has(id) &&
        units.get(entryById.get(id)!.unitId)?.subject === subject,
    );
    const originalStory = entry.historicalStory;
    if (!originalStory)
      return {
        ...entry,
        summary: getAtlasHistoricalSummary(entry),
        relatedPlaceIds: entry.relatedPlaceIds?.filter(inSubject),
        relatedEntryIds,
      };
    const storyPlaceIds = originalStory.placeIds.filter(inSubject);
    const related = [
      ...(originalStory.related || []),
      ...(atlasMapContextLinks[originalStory.id] || []),
      ...(atlasKoreaRestoredStoryRelations[originalStory.id] || []),
    ].flatMap((originalLink) => {
      if (
        atlasMapExcludedRelationTargets[originalStory.id]?.includes(
          originalLink.placeId,
        )
      )
        return [];
      const targetEntryId =
        atlasMapRelationEntryTargets[originalStory.id]?.[originalLink.placeId];
      const link = targetEntryId
        ? { ...originalLink, targetEntryId }
        : originalLink;
      if (!inSubject(link.placeId)) return [];
      if (link.targetEntryId) {
        const target = entryById.get(link.targetEntryId);
        if (
          !target ||
          target.placeId !== link.placeId ||
          units.get(target.unitId)?.subject !== subject
        )
          return [];
      }
      // Preserve the original scope before pruning multi-place stories.
      const fromPlaceIds = (
        link.fromPlaceIds ||
        (originalStory.placeIds.length === 1 ? originalStory.placeIds : [])
      ).filter((id) => storyPlaceIds.includes(id));
      return fromPlaceIds.length ? [{ ...link, fromPlaceIds }] : [];
    });
    const extraSources = mapLocationEvidence[entry.placeId] || [];
    return {
      ...entry,
      relatedPlaceIds: entry.relatedPlaceIds?.filter(inSubject),
      relatedEntryIds,
      historicalStory: {
        ...originalStory,
        placeIds: storyPlaceIds,
        displayNames: originalStory.displayNames
          ? Object.fromEntries(
              Object.entries(originalStory.displayNames).filter(([id]) =>
                storyPlaceIds.includes(id),
              ),
            )
          : undefined,
        replacesEntryIds: originalStory.replacesEntryIds?.filter((id) =>
          entryIds.has(id),
        ),
        sources: [
          ...new Map(
            [...originalStory.sources, ...extraSources].map((item) => [
              item.url,
              item,
            ]),
          ).values(),
        ],
        related,
      },
    };
  });
  const dataset: AtlasDataset = { ...source, places, entries };
  return { dataset, audit };
};
