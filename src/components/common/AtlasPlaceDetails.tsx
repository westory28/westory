import { useMemo, useState } from "react";
import type {
  AtlasDataset,
  AtlasEntry,
  AtlasPlace,
} from "../../lib/historyAtlas";
import {
  getAtlasPlaceProfile,
  isAtlasSourceContext,
} from "../../lib/historyAtlasProfiles";
import InfoHelp from "./InfoHelp";
import "./atlasPlaceDetails.css";

interface AtlasPlaceDetailsProps {
  dataset: AtlasDataset;
  entry: AtlasEntry;
  place: AtlasPlace;
  onSelectEntry: (entryId: string) => void;
}

const sentences = (text: string) =>
  text
    .trim()
    .split(/(?<=[.!?])\s+/u)
    .filter(Boolean);

/** The same reading structure is used on the flat atlas and the globe. */
export default function AtlasPlaceDetails({
  dataset,
  entry,
  place,
  onSelectEntry,
}: AtlasPlaceDetailsProps) {
  const [expandedPlace, setExpandedPlace] = useState<string | null>(null);
  const profile = useMemo(
    () => getAtlasPlaceProfile(place, dataset.entries),
    [place, dataset.entries],
  );
  const displayName = entry.displayName || place.name;
  const stories = useMemo(() => {
    const groups = new Map<string, AtlasEntry[]>();
    dataset.entries
      .filter((item) => item.placeId === place.id)
      .forEach((item) => {
        const key = `${item.period}|${item.displayName || place.name}`;
        groups.set(key, [...(groups.get(key) || []), item]);
      });
    return [...groups.values()];
  }, [dataset.entries, place.id, place.name]);
  const activeGroup = stories.find((group) =>
    group.some((item) => item.id === entry.id),
  ) || [entry];
  const shownStories =
    expandedPlace === place.id || stories.length <= 6
      ? stories
      : [
          ...stories.slice(0, 5),
          ...(stories.slice(0, 5).includes(activeGroup)
            ? stories.slice(5, 6)
            : [activeGroup]),
        ];
  const allContext = [
    ...new Set(activeGroup.flatMap((item) => sentences(item.summary))),
  ];
  const inProfile = (text: string) =>
    [profile.definition, ...profile.facts.map((fact) => fact.value)].some(
      (value) => value.includes(text),
    );
  const context = allContext.filter(
    (text) => !isAtlasSourceContext(text) && !inProfile(text),
  );
  const mapReferences = allContext
    .filter(isAtlasSourceContext)
    .map((text) =>
      text.replace(/[을를] 다루는 지도[·ㆍ]자료에 등장합니다\.$/u, ""),
    );
  const significance = [
    ...new Set(activeGroup.flatMap((item) => sentences(item.significance))),
  ].filter((text) => !inProfile(text));
  const aliases = [
    ...new Set(
      [
        place.name,
        place.modernName,
        ...stories.flat().map((item) => item.displayName),
      ].filter((name): name is string => !!name && name !== displayName),
    ),
  ];
  const related = useMemo(() => {
    const found = new Map<string, AtlasEntry>();
    const ids = new Set(
      activeGroup.flatMap((item) => item.relatedEntryIds || []),
    );
    dataset.entries.forEach((item) => {
      if (ids.has(item.id)) found.set(item.placeId, item);
    });
    activeGroup
      .flatMap((item) => item.relatedPlaceIds || [])
      .forEach((id) => {
        if (found.has(id)) return;
        const item =
          dataset.entries.find(
            (candidate) =>
              candidate.placeId === id && candidate.unitId === entry.unitId,
          ) || dataset.entries.find((candidate) => candidate.placeId === id);
        if (item) found.set(id, item);
      });
    return [...found.values()];
  }, [dataset.entries, activeGroup, entry.unitId]);
  const citations = useMemo(() => {
    const groups = new Map<
      string,
      { pdf: Set<number>; printed: Set<string> }
    >();
    [
      ...activeGroup.flatMap((item) => item.citations),
      ...(profile.textbookCitations || []),
    ].forEach((citation) => {
      if (!groups.has(citation.sourceId))
        groups.set(citation.sourceId, { pdf: new Set(), printed: new Set() });
      groups.get(citation.sourceId)!.pdf.add(citation.pdfPage);
      if (citation.printedPage)
        groups.get(citation.sourceId)!.printed.add(citation.printedPage);
    });
    return [...groups].map(([sourceId, pages]) => ({
      source: dataset.sources.find((source) => source.id === sourceId),
      sourceId,
      pages: [...pages.pdf].sort((a, b) => a - b),
      printedPages: [...pages.printed],
    }));
  }, [activeGroup, dataset.sources, profile]);
  return (
    <div className="atlas-place-details">
      <header className="atlas-place-details__header">
        <div className="atlas-place-details__title">
          <h2>{displayName}</h2>
          {place.locationNote && (
            <InfoHelp
              label={`${displayName} 위치 표시 근거`}
              sections={[
                {
                  title: "지도 표시 기준",
                  rows: [
                    { label: "위치 근거", content: place.locationNote },
                    {
                      label: "표시",
                      content: place.coordinates
                        ? "현대 자연지형 위에 표시한 대표 위치입니다."
                        : "위치를 확정하지 않은 자료는 임의의 점으로 표시하지 않습니다.",
                    },
                  ],
                },
              ]}
            />
          )}
        </div>
        {!place.coordinates && (
          <span className="atlas-place-details__status">
            {place.kind === "country" || place.kind === "region"
              ? "영역 자료"
              : "위치 미확정"}
          </span>
        )}
      </header>

      <section className="atlas-place-details__context">
        <div className="atlas-place-details__section-heading">
          <h3>역사 속 이 장소</h3>
          <span>{entry.period}</span>
        </div>
        <p className="atlas-place-details__definition">{profile.definition}</p>
        {entry.nameNote && (
          <p className="atlas-place-details__name-note">{entry.nameNote}</p>
        )}
        {context.length > 0 && (
          <ul>
            {context.map((paragraph) => (
              <li key={paragraph}>{paragraph}</li>
            ))}
          </ul>
        )}
        {significance.length > 0 && (
          <div className="atlas-place-details__meaning">
            <h3>기억할 점</h3>
            <ul>
              {significance.map((paragraph) => (
                <li key={paragraph}>{paragraph}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {stories.length > 1 && (
        <section
          className="atlas-place-details__periods"
          aria-label="시대별 이야기"
        >
          <h3>시대별 보기</h3>
          <div className="atlas-place-details__chips">
            {shownStories.map((group) => {
              const item =
                group.find((candidate) => candidate.id === entry.id) ||
                group[0];
              return (
                <button
                  type="button"
                  key={item.id}
                  aria-pressed={group === activeGroup}
                  onClick={() => onSelectEntry(item.id)}
                >
                  {item.period}
                  {item.displayName && item.displayName !== place.name
                    ? ` · ${item.displayName}`
                    : ""}
                </button>
              );
            })}
            {stories.length > 6 && (
              <button
                type="button"
                className="atlas-place-details__more"
                aria-expanded={expandedPlace === place.id}
                onClick={() =>
                  setExpandedPlace(expandedPlace === place.id ? null : place.id)
                }
              >
                {expandedPlace === place.id
                  ? "접기"
                  : `+${stories.length - 6}개 더 보기`}
              </button>
            )}
          </div>
        </section>
      )}

      {profile.facts.length > 0 && (
        <dl className="atlas-place-details__facts">
          {profile.facts.map((fact, index) => (
            <div key={`${fact.label}-${index}`}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {aliases.length > 0 && (
        <section className="atlas-place-details__names">
          <h3>다른 이름 · 현재 지명</h3>
          <div>
            {aliases.map((name) => {
              const story = stories
                .flat()
                .find(
                  (item) => item.displayName === name && item.id !== entry.id,
                );
              return story ? (
                <button
                  type="button"
                  key={name}
                  onClick={() => onSelectEntry(story.id)}
                >
                  {name} →
                </button>
              ) : (
                <span key={name}>{name}</span>
              );
            })}
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section className="atlas-place-details__related">
          <h3>함께 볼 장소</h3>
          <div>
            {related.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => onSelectEntry(item.id)}
              >
                {item.displayName ||
                  dataset.places.find(
                    (candidate) => candidate.id === item.placeId,
                  )?.name}{" "}
                →
              </button>
            ))}
          </div>
        </section>
      )}

      <details className="atlas-place-details__sources" key={entry.id}>
        <summary>
          출처 · 교과서 {citations.length}권
          {profile.sources.length
            ? ` · 참고 자료 ${profile.sources.length}곳`
            : ""}
        </summary>
        {mapReferences.length > 0 && (
          <div className="atlas-place-details__map-context">
            <strong>{entry.period} · 지명이 표시된 자료의 주제</strong>
            <ul>
              {mapReferences.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </div>
        )}
        <ul>
          {citations.map(({ source, sourceId, pages, printedPages }) => (
            <li key={sourceId}>
              <strong>{source?.title || sourceId}</strong>
              <span>{source?.edition}</span>
              {printedPages.length > 0 && (
                <span>본문 {printedPages.join(", ")}쪽</span>
              )}
              <span>PDF {pages.join(", ")}쪽</span>
            </li>
          ))}
          {profile.sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.title} ↗
              </a>
              {source.license && source.licenseUrl && (
                <a href={source.licenseUrl} target="_blank" rel="noreferrer">
                  {source.license}
                </a>
              )}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
