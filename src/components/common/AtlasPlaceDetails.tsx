import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
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

/** Keep explanatory text outside the scrolling map popup. */
function AtlasDetailChip({
  children,
  title,
  description,
  pressed,
  onSelect,
}: {
  children: ReactNode;
  title: string;
  description: string;
  pressed?: boolean;
  onSelect: () => void;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const [open, setOpen] = useState(false);
  const cancelClose = () => clearTimeout(closeTimer.current);
  const close = () => {
    cancelClose();
    setOpen(false);
  };
  const show = () => {
    cancelClose();
    setOpen(true);
  };
  const leave = () => {
    if (document.activeElement === button.current) return;
    cancelClose();
    closeTimer.current = setTimeout(close, 120);
  };

  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (!open) return;
    const position = () => {
      const anchor = button.current;
      const popup = tooltip.current;
      if (!anchor || !popup) return;
      const bounds = anchor.getBoundingClientRect();
      popup.style.left = "0px";
      popup.style.top = "0px";
      const origin = popup.getBoundingClientRect();
      const left = Math.max(
        12,
        Math.min(bounds.left, window.innerWidth - origin.width - 12),
      );
      const top =
        bounds.bottom + origin.height + 8 <= window.innerHeight - 12
          ? bounds.bottom + 8
          : Math.max(12, bounds.top - origin.height - 8);
      popup.style.left = `${left - origin.left}px`;
      popup.style.top = `${top - origin.top}px`;
      popup.style.visibility = "visible";
    };
    position();
    const observer = new ResizeObserver(position);
    if (tooltip.current) observer.observe(tooltip.current);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, title, description]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !button.current?.contains(target) &&
        !tooltip.current?.contains(target)
      )
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-pressed={pressed}
        aria-describedby={open ? id : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") show();
        }}
        onPointerLeave={leave}
        onFocus={show}
        onBlur={close}
        onClick={() => {
          close();
          onSelect();
        }}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            id={id}
            ref={tooltip}
            className="atlas-place-details__tooltip"
            role="tooltip"
            style={{ visibility: "hidden" }}
            onPointerEnter={cancelClose}
            onPointerLeave={leave}
          >
            <strong>{title}</strong>
            <span>{description}</span>
          </div>,
          button.current?.closest("dialog") ||
            document.fullscreenElement ||
            document.body,
        )}
    </>
  );
}

/** The same reading structure is used on the flat atlas and the globe. */
export default function AtlasPlaceDetails({
  dataset,
  entry,
  place,
  subject,
  onSelectEntry,
}: AtlasPlaceDetailsProps) {
  const [expandedPlace, setExpandedPlace] = useState<string | null>(null);
  const contextSection = useRef<HTMLElement>(null);
  const [selectedRelation, setSelectedRelation] = useState<{
    placeId: string;
    subject?: AtlasSubject;
    reason: string;
    sources: AtlasProfileSource[];
  } | null>(null);
  const activeRelation =
    selectedRelation?.placeId === place.id &&
    selectedRelation.subject === subject
      ? selectedRelation
      : null;
  useEffect(() => {
    setSelectedRelation((relation) =>
      relation?.placeId === place.id && relation.subject === subject
        ? relation
        : null,
    );
  }, [place.id, subject]);
  const selectEntry = (entryId: string) => {
    onSelectEntry(entryId);
    requestAnimationFrame(() => {
      const section = contextSection.current;
      if (!section) return;
      let container = section.parentElement;
      while (container && container !== document.body) {
        if (
          container.scrollHeight > container.clientHeight &&
          /auto|scroll/u.test(getComputedStyle(container).overflowY)
        ) {
          container.scrollTo({
            top: 0,
            behavior: "instant",
          });
          break;
        }
        container = container.parentElement;
      }
      section.focus({ preventScroll: true });
    });
  };
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
      text.replace(/[을를] 다루는 지도[·ㆍ]자료에 등장(?:한다|합니다)\.$/u, ""),
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
  const relatedGroups = [
    {
      title: "관련 키워드",
      items: related.filter(({ entry: item }) => item.placeId === place.id),
    },
    {
      title: "함께 볼 장소",
      items: related.filter(({ entry: item }) => item.placeId !== place.id),
    },
  ].filter(({ items }) => items.length > 0);
  const referenceSources: AtlasProfileSource[] = [
    ...new Map<string, AtlasProfileSource>(
      [
        ...(activeEntry.historicalStory?.sources || []),
        ...(entry.geographicReference?.sources || []),
        ...(activeRelation?.sources || []),
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
    <div className="atlas-place-details atlas-place-details--scrollable">
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
                        ? "현대 자연지형 위에 표시한 대표 위치이다."
                        : "위치를 확정하지 않은 자료는 임의의 점으로 표시하지 않는다.",
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

      <div
        className="atlas-place-details__body"
        key={entry.id}
        role="region"
        aria-label={`${displayName} 설명 내용`}
        tabIndex={0}
      >
        <section
          className="atlas-place-details__context"
          ref={contextSection}
          tabIndex={-1}
        >
          <div className="atlas-place-details__section-heading">
            <h3>{activeGroup.length ? "역사 속 이 장소" : "장소 개요"}</h3>
            {activeGroup.length > 0 && <span>{activeEntry.period}</span>}
          </div>
          <p className="atlas-place-details__definition">
            {activeGroup.length
              ? getAtlasHistoricalSummary(activeEntry)
              : profile.definition}
          </p>
          {activeRelation && (
            <p className="atlas-place-details__relation-context">
              {activeRelation.reason}
            </p>
          )}
          {entry.nameNote && (
            <p className="atlas-place-details__name-note">{entry.nameNote}</p>
          )}
          {context.length > 0 && (
            <div className="atlas-place-details__paragraphs">
              {context
                .filter((paragraph) => !activeEntry.summary.includes(paragraph))
                .map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
            </div>
          )}
          {significance.length > 0 && (
            <div className="atlas-place-details__meaning">
              <h3>기억할 점</h3>
              <div className="atlas-place-details__paragraphs">
                {significance.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
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
                const samePeriod = stories.filter(
                  (story) => story[0].period === item.period,
                );
                const identifier =
                  samePeriod.length > 1
                    ? item.displayName &&
                      samePeriod.every(
                        (story) =>
                          story === group ||
                          story[0].displayName !== item.displayName,
                      )
                      ? item.displayName
                      : String(samePeriod.indexOf(group) + 1)
                    : "";
                return (
                  <AtlasDetailChip
                    key={item.id}
                    pressed={group === activeGroup}
                    title={
                      item.historicalStory?.title ||
                      item.displayName ||
                      place.name
                    }
                    description={getAtlasHistoricalSummary(item)}
                    onSelect={() => selectEntry(item.id)}
                  >
                    {item.period}
                    {identifier ? ` · ${identifier}` : ""}
                  </AtlasDetailChip>
                );
              })}
              {stories.length > 6 && (
                <button
                  type="button"
                  className="atlas-place-details__more"
                  aria-expanded={expandedPlace === place.id}
                  onClick={() =>
                    setExpandedPlace(
                      expandedPlace === place.id ? null : place.id,
                    )
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
                  <AtlasDetailChip
                    key={name}
                    title={story.historicalStory?.title || name}
                    description={getAtlasHistoricalSummary(story)}
                    onSelect={() => selectEntry(story.id)}
                  >
                    {name}
                  </AtlasDetailChip>
                ) : (
                  <span key={name}>{name}</span>
                );
              })}
            </div>
          </section>
        )}

        {relatedGroups.map(({ title, items }) => (
          <section className="atlas-place-details__related" key={title}>
            <h3>{title}</h3>
            <div>
              {items.map(({ entry: item, reason, sources, label }) => {
                const name =
                  label ||
                  item.displayName ||
                  dataset.places.find(
                    (candidate) => candidate.id === item.placeId,
                  )?.name ||
                  item.placeId;
                return (
                  <AtlasDetailChip
                    key={item.id}
                    title={name}
                    description={reason}
                    onSelect={() => {
                      setSelectedRelation({
                        placeId: item.placeId,
                        subject,
                        reason,
                        sources,
                      });
                      selectEntry(item.id);
                    }}
                  >
                    {name}
                  </AtlasDetailChip>
                );
              })}
            </div>
          </section>
        ))}

        <details className="atlas-place-details__sources" key={entry.id}>
          <summary>
            출처
            {citations.length ? ` · 교과서 ${citations.length}권` : ""}
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
    </div>
  );
}
