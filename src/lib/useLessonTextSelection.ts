import { useEffect, useRef, useState } from "react";
import type { LessonWorksheetPageImage } from "./lessonWorksheet";
import type { LessonPdfGlyph } from "./lessonPdfGlyphTypes";
import type { createLessonPdfGlyphReader } from "./lessonPdfGlyphs";

type Status = "idle" | "loading" | "ready" | "empty" | "error";
export const useLessonTextSelection = ({
  enabled,
  source,
  pageImage,
}: {
  enabled: boolean;
  source: File | string | undefined;
  pageImage: LessonWorksheetPageImage | undefined;
}) => {
  const reader = useRef<ReturnType<typeof createLessonPdfGlyphReader> | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    source: typeof source;
    key: string;
    regions: LessonPdfGlyph[];
    maskUrl: string;
    status: Status;
  }>({ source: undefined, key: "", regions: [], maskUrl: "", status: "idle" });
  const key = pageImage
    ? `${pageImage.page}:${pageImage.width}:${pageImage.height}:${pageImage.imageUrl}`
    : "";
  useEffect(() => {
    return () => {
      void reader.current?.destroy().catch(() => {});
      reader.current = null;
    };
  }, [source, attempt]);
  useEffect(() => {
    let cancelled = false;
    if (!enabled || !pageImage) {
      setResult({ source, key, regions: [], maskUrl: "", status: "idle" });
      return;
    }
    setResult({
      source,
      key,
      regions: [],
      maskUrl: "",
      status: source ? "loading" : "error",
    });
    if (!source) return;
    void (async () => {
      const { createLessonPdfGlyphReader } = await import("./lessonPdfGlyphs");
      if (cancelled) return;
      const active = (reader.current ??= createLessonPdfGlyphReader(source));
      try {
        const { regions, maskUrl } = await active.read(pageImage);
        if (!cancelled)
          setResult({
            source,
            key,
            regions,
            maskUrl,
            status: regions.length ? "ready" : "empty",
          });
      } catch {
        if (!cancelled)
          setResult({ source, key, regions: [], maskUrl: "", status: "error" });
      }
    })().catch(() => {
      if (!cancelled)
        setResult({ source, key, regions: [], maskUrl: "", status: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, source, key, attempt]);
  const current = enabled && result.source === source && result.key === key;
  return {
    regions: current ? result.regions : [],
    maskUrl: current ? result.maskUrl : "",
    status: current
      ? result.status
      : enabled
        ? ("loading" as const)
        : ("idle" as const),
    retry: () => setAttempt((a) => a + 1),
  };
};
