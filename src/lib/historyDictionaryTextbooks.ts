import { historyDictionaryTextbookEarlyReviews } from "../data/historyDictionaryTextbookEarly";
import { historyDictionaryTextbookLateReviews } from "../data/historyDictionaryTextbookLate";
import { historyDictionaryTextbookAtlasReviews } from "../data/historyDictionaryTextbookAtlas";
import { historyDictionaryTextbookSupplementReviews } from "../data/historyDictionaryTextbookSupplement";
import type { HistoryDictionaryTextbookReview } from "../data/historyDictionaryTextbookTypes";
import type {
  HistoryDictionaryAttribution,
  HistoryDictionaryCatalogTerm,
} from "./historyDictionaryCatalog";
import {
  expandHistoryDictionaryFacetIds,
  getHistoryDictionaryFacet,
} from "./historyDictionaryThemes";

export const historyDictionaryTextbookBooks = {
  history2: { title: "중학교 역사 ②(이병인 외)", pages: 209 },
  "history2-sem1": {
    title: "중학교 역사 ②(이병인 외) · 제공된 1학기 자료",
    pages: 107,
  },
  atlas: { title: "중학교 역사 부도 · 2022 개정", pages: 107 },
} as const;

export const historyDictionaryTextbookReviews: HistoryDictionaryTextbookReview[] =
  [
    ...historyDictionaryTextbookEarlyReviews,
    ...historyDictionaryTextbookLateReviews,
    ...historyDictionaryTextbookAtlasReviews,
    ...historyDictionaryTextbookSupplementReviews,
  ];

const normalize = (value: string) =>
  value.normalize("NFKC").replace(/\s+/gu, "");
const unique = (values: string[]) => [...new Set(values)];

/** Apply reviewed definitions without changing stored IDs or map links. */
export function applyHistoryDictionaryTextbookReviews(
  baseline: HistoryDictionaryCatalogTerm[],
  reviews = historyDictionaryTextbookReviews,
): HistoryDictionaryCatalogTerm[] {
  const terms = new Map(baseline.map((term) => [term.id, term]));
  const reviewedIds = new Set<string>();
  for (const review of reviews) {
    const matches = review.matchId
      ? [terms.get(review.matchId)].filter(Boolean)
      : review.kind === "place"
        ? []
        : [...terms.values()].filter(
            (term) =>
              term.kind === "history" &&
              normalize(term.word) === normalize(review.word),
          );
    if ((review.matchId && !matches.length) || matches.length > 1)
      throw new Error(`Ambiguous dictionary textbook match: ${review.word}`);
    const previous = matches[0];
    if (
      previous &&
      ![previous.word, ...previous.aliases].some(
        (name) => normalize(name) === normalize(review.word),
      )
    )
      throw new Error(
        `Textbook review points to a different headword: ${review.word}`,
      );
    const kind = previous?.kind || review.kind || "history";
    const id =
      previous?.id ||
      (kind === "place"
        ? `catalog-place-reference-${encodeURIComponent(review.word)}`
        : `catalog-history-${encodeURIComponent(review.word)}`);
    if (reviewedIds.has(id))
      throw new Error(`Duplicate textbook review: ${review.word}`);
    reviewedIds.add(id);
    const word = previous?.word || review.word;
    const facetIds = expandHistoryDictionaryFacetIds(
      kind === "place"
        ? [
            ...(previous?.facetIds || []).filter(
              (facetId) => !facetId.startsWith("region:"),
            ),
            ...review.facetIds,
          ]
        : review.facetIds,
    );
    const newSources: HistoryDictionaryAttribution[] = review.sources.map(
      (source) => ({
        title: `비상교육 · ${historyDictionaryTextbookBooks[source.book].title}, ${source.printedPage}쪽 (제공 PDF ${source.pdfPage}쪽)`,
        author: "이병인 외 · 비상교육",
        url: "",
        changes: review.externalSources?.length
          ? "교과서에서 용어와 학습 맥락 확인 · 뜻풀이는 함께 표시한 참고 자료로 보완"
          : "교과서의 학습 내용에 맞춰 뜻풀이를 새로 작성 · 교과서 원문과 이미지는 수록하지 않음",
        retrievedAt: "2026-10-18",
      }),
    );
    terms.set(id, {
      ...previous,
      id,
      word,
      definition: review.definition,
      aliases: unique([
        ...(previous?.aliases || []),
        ...review.aliases,
        ...(word === review.word ? [] : [review.word]),
      ]).filter((alias) => normalize(alias) !== normalize(word)),
      tags: unique(
        review.facetIds.map(
          (facetId) => getHistoryDictionaryFacet(facetId)!.label,
        ),
      ),
      facetIds,
      kind,
      // Each source keeps its own terms; supplied textbooks are not marked CC licensed.
      attributions: [
        ...newSources,
        ...(review.externalSources || []),
        ...(previous?.attributions || []),
      ],
    });
  }
  return [...terms.values()];
}
