/** Reviewed learning definitions; textbook sentences and page images are not distributed. */
export interface HistoryDictionaryTextbookReview {
  word: string;
  definition: string;
  aliases: string[];
  facetIds: string[];
  /** Explicit existing entry for ambiguous names and atlas-linked places. */
  matchId?: string;
  kind?: "history" | "place";
  externalSources?: {
    title: string;
    author: string;
    url: string;
    license?: string;
    licenseUrl?: string;
    changes: string;
    retrievedAt: string;
  }[];
  sources: {
    book: "history2" | "history2-sem1" | "atlas";
    pdfPage: number;
    printedPage: number;
  }[];
}
