import { useMemo, useState } from "react";
import type {
  AtlasDataset,
  AtlasEntry,
  AtlasPlace,
  AtlasSubject,
} from "../../lib/historyAtlas";
import {
  atlasEntrySubject,
  getAtlasHistoryEntries,
  getAtlasHistoricalSummary,
  getAtlasHistoricalRelations,
} from "../../lib/historyAtlasStories";
import {
  getAtlasPlaceProfile,
  isAtlasSourceContext,
  type AtlasProfileSource,
} from "../../lib/historyAtlasProfiles";
import InfoHelp from "./InfoHelp";
import "./atlasPlaceDetails.css";

interface AtlasPlaceDetailsProps {
  dataset: AtlasDataset;
  entry: AtlasEntry;
  place: AtlasPlace;
  /** Omitted on the globe, where stories may span both subjects. */
  subject?: AtlasSubject;
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
  subject,
  onSelectEntry,
}: AtlasPlaceDetailsProps) {
  const [expandedPlace, setExpandedPlace] = useState<string | null>(null);
  const placeEntries = useMemo(
    () =>
      dataset.entries.filter(
        (item) =>
          item.placeId === place.id &&
          (!subject || atlasEntrySubject(dataset, item) === subject),
      ),
    [dataset, place.id, subject],
  );
  const profile = useMemo(() => getAtlasPlaceProfile(place), [place]);
  const displayName = entry.displayName || place.name;
  const stories = useMemo(() => {
    const groups = new Map<string, AtlasEntry[]>();
    getAtlasHistoryEntries(dataset, place.id, subject).forEach((item) => {
      const key =
        item.historicalStory?.id ||
        `${item.period}|${item.displayName || place.name}`;
      groups.set(key, [...(groups.get(key) || []), item]);
    });
    return [...groups.values()];
  }, [dataset, place.id, place.name, subject]);
  const activeGroup =
    stories.find((group) => group.some((item) => item.id === entry.id)) ||
    stories.find((group) =>
      group.some((item) =>
        item.historicalStory?.replacesEntryIds?.includes(entry.id),
      ),
    ) ||
    stories.find((group) =>
      group.some((item) =>
        item.eraIds?.some((era) => entry.eraIds?.includes(era)),
      ),
    ) ||
    [];
  const activeEntry = activeGroup[0] || entry;
  const shownStories =
    expandedPlace === place.id || stories.length <= 6
      ? stories
      : [
          ...stories.slice(0, 5),
          ...(!activeGroup.length || stories.slice(0, 5).includes(activeGroup)
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
  const mapReferences = [
    ...new Set(placeEntries.flatMap((item) => sentences(item.summary))),
  ]
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
        ...placeEntries.map((item) => item.displayName),
      ].filter((name): name is string => !!name && name !== displayName),
    ),
  ];
  const related = useMemo(
    () => getAtlasHistoricalRelations(dataset, activeEntry, subject),
    [dataset, activeEntry, subject],
  );
  const referenceSources: AtlasProfileSource[] = [
    ...new Map<string, AtlasProfileSource>(
      [
        ...(activeEntry.historicalStory?.sources || []),
        ...related.flatMap((relation) => relation.sources),
        ...profile.sources,
      ].map((source) => [
        source.url,
        /https:\/\/(?:ko|en)\.wikipedia\.org\//u.test(source.url)
          ? {
              ...source,
              title: source.title.replace(/^위키백과 ·/u, "위키백과 기여자 ·"),
              license: "CC BY-SA 4.0 · 변경: 문장 요약·재작성",
              licenseUrl:
                "https://creativecommons.org/licenses/by-sa/4.0/deed.ko",
            }
          : source,
      ]),
    ).values(),
  ];
  const citations = useMemo(() => {
    const groups = new Map<
      string,
      { pdf: Set<number>; printed: Set<string> }
    >();
    [
      ...placeEntries.flatMap((item) => item.citations),
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
  }, [placeEntries, dataset.sources, profile]);
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
          <h3>{activeGroup.length ? "역사 속 이 장소" : "장소 개요"}</h3>
          {activeGroup.length > 0 && <span>{activeEntry.period}</span>}
        </div>
        <p className="atlas-place-details__definition">
          {activeGroup.length
            ? getAtlasHistoricalSummary(activeEntry)
            : profile.definition}
        </p>
        {entry.nameNote && (
          <p className="atlas-place-details__name-note">{entry.nameNote}</p>
        )}
        {context.length > 0 && (
          <ul>
            {context
              .filter((paragraph) => !activeEntry.summary.includes(paragraph))
              .map((paragraph) => (
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

      {stories.length > 0 && (
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
                  {item.historicalStory
                    ? ` · ${item.historicalStory.title}`
                    : ""}
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
            {related.map(({ entry: item, reason }) => (
              <button
                type="button"
                key={item.id}
                onClick={() => onSelectEntry(item.id)}
              >
                <strong>
                  {item.displayName ||
                    dataset.places.find(
                      (candidate) => candidate.id === item.placeId,
                    )?.name}{" "}
                  →
                </strong>
                <span>{reason}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <details className="atlas-place-details__sources" key={entry.id}>
        <summary>
          출처 · 교과서 {citations.length}권
          {referenceSources.length
            ? ` · 참고 자료 ${referenceSources.length}곳`
            : ""}
        </summary>
        {mapReferences.length > 0 && (
          <div className="atlas-place-details__map-context">
            <strong>지명이 표시된 자료의 주제</strong>
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
          {referenceSources.map((source) => (
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
