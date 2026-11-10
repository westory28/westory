/** Only call this loader with assets from the student's authorized paper. */
export interface MockExamAssetManifest {
  imageUrls: string[];
  fontCharacters?: string;
}

interface AssetQuestion {
  question?: string;
  passage?: string | null;
  examplePassage?: string | null;
  passageSet?: {
    instruction?: string;
    passage?: string;
    image?: string | null;
  } | null;
  image?: string | null;
  options?: string[];
  choiceOptionImages?: Array<string | null>;
  matchingLeftOptions?: string[];
  matchingRightOptions?: Array<{ right: string; rightImage?: string | null }>;
  matchingPairs?: Array<{
    left: string;
    right: string;
    rightImage?: string | null;
  }>;
}

export interface MockExamAssetProgress {
  loaded: number;
  total: number;
}

const PAPER_FONT_CHARACTERS =
  "중학교 3학년 초시 복시 전시 추가 모의고사 역사과 회 문항 총 점 학년 반 번 이름 답 보기 다음 글을 읽고 물음에 답하시오 0123456789①②③④⑤()[]:.";

const uniqueCharacters = (value: string) => [...new Set(value)].sort().join("");

export const collectMockExamAssets = (
  questions: AssetQuestion[],
  studentLabel = "",
): MockExamAssetManifest => {
  const images = new Set<string>();
  const text = [PAPER_FONT_CHARACTERS, studentLabel];
  const addImage = (value: string | null | undefined) => {
    if (value?.trim()) images.add(value.trim());
  };
  for (const question of questions) {
    addImage(question.image);
    addImage(question.passageSet?.image);
    question.choiceOptionImages?.forEach(addImage);
    for (const pair of question.matchingRightOptions ||
      question.matchingPairs ||
      []) {
      addImage(pair.rightImage);
      text.push(pair.right);
    }
    text.push(
      question.question || "",
      question.passage || "",
      question.examplePassage || "",
      question.passageSet?.instruction || "",
      question.passageSet?.passage || "",
      ...(question.options || []),
      ...(question.matchingLeftOptions ||
        question.matchingPairs?.map((pair) => pair.left) ||
        []),
    );
  }
  return {
    imageUrls: [...images],
    fontCharacters: uniqueCharacters(text.join(" ")),
  };
};

export class MockExamAssetError extends Error {
  constructor(readonly reason: "image" | "font" | "timeout") {
    super(
      reason === "image"
        ? "시험지 그림을 모두 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요."
        : reason === "font"
          ? "시험지 글꼴을 불러오지 못했습니다. 다시 시도해 주세요."
          : "시험지 준비가 지연되고 있습니다. 연결을 확인하고 다시 시도해 주세요.",
    );
    this.name = "MockExamAssetError";
  }
}

interface PrepareOptions {
  signal?: AbortSignal;
  onProgress?: (progress: MockExamAssetProgress) => void;
}

interface AssetEnvironment {
  createImage: () => HTMLImageElement;
  fonts: Pick<FontFaceSet, "load">;
  timeoutMs?: number;
  concurrency?: number;
}

const abortError = () =>
  new DOMException("시험지 준비가 취소되었습니다.", "AbortError");

const waitWithSignal = <T>(promise: Promise<T>, signal: AbortSignal) =>
  new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason || abortError());
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });

/** Cache decoded images only for this mounted runner; never persist question URLs. */
export const createMockExamAssetLoader = (
  environment: AssetEnvironment = {
    createImage: () => new Image(),
    fonts: document.fonts,
  },
) => {
  const decodedImages = new Map<string, HTMLImageElement>();
  const readyFontCharacters = new Map<string, Set<string>>();
  let current: AbortController | undefined;
  let disposed = false;

  const loadImage = (source: string, signal: AbortSignal) => {
    const cached = decodedImages.get(source);
    if (cached?.complete && cached.naturalWidth > 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const image = environment.createImage();
      let finished = false;
      let decoding = false;
      const cleanup = () => {
        image.onload = null;
        image.onerror = null;
        signal.removeEventListener("abort", abort);
      };
      const fail = (error: unknown) => {
        if (finished) return;
        finished = true;
        cleanup();
        image.removeAttribute("src");
        reject(error);
      };
      const abort = () => fail(signal.reason || abortError());
      const complete = async () => {
        if (finished || decoding) return;
        decoding = true;
        try {
          if (!image.naturalWidth) throw new MockExamAssetError("image");
          if (typeof image.decode === "function") await image.decode();
          if (finished || signal.aborted) return;
          finished = true;
          cleanup();
          decodedImages.set(source, image);
          resolve();
        } catch {
          fail(new MockExamAssetError("image"));
        }
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      image.onload = () => void complete();
      image.onerror = () => fail(new MockExamAssetError("image"));
      image.decoding = "async";
      image.src = source;
      if (image.complete && image.naturalWidth > 0) void complete();
    });
  };

  const loadFonts = async (characters: string, signal: AbortSignal) => {
    try {
      const body = uniqueCharacters(PAPER_FONT_CHARACTERS + characters);
      await Promise.all(
        [
          ['400 14px "Noto Serif KR"', body],
          ['700 14px "Noto Serif KR"', body],
          ['900 28px "Noto Serif KR"', PAPER_FONT_CHARACTERS],
        ].map(async ([font, text]) => {
          const ready = readyFontCharacters.get(font) || new Set<string>();
          const missing = [...text].filter(
            (character) => !ready.has(character),
          );
          if (!missing.length) return;
          const faces = await waitWithSignal(
            environment.fonts.load(font, missing.join("")),
            signal,
          );
          if (!faces.length) throw new MockExamAssetError("font");
          if (signal.aborted) throw signal.reason || abortError();
          missing.forEach((character) => ready.add(character));
          readyFontCharacters.set(font, ready);
        }),
      );
    } catch (error) {
      if (signal.aborted) throw signal.reason || abortError();
      throw error instanceof MockExamAssetError
        ? error
        : new MockExamAssetError("font");
    }
  };

  return {
    async prepare(
      manifest: MockExamAssetManifest,
      options: PrepareOptions = {},
    ) {
      if (disposed) throw abortError();
      current?.abort(abortError());
      const controller = new AbortController();
      current = controller;
      const { signal } = controller;
      const abort = () =>
        controller.abort(options.signal?.reason || abortError());
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      const timeout = setTimeout(
        () => controller.abort(new MockExamAssetError("timeout")),
        environment.timeoutMs || 30_000,
      );
      const urls = [
        ...new Set(
          manifest.imageUrls.map((source) => source.trim()).filter(Boolean),
        ),
      ];
      // At most one current paper remains referenced, including after a retry.
      const needed = new Set(urls);
      for (const source of decodedImages.keys()) {
        if (!needed.has(source)) decodedImages.delete(source);
      }
      let loaded = 0;
      let cursor = 0;
      const progress = () =>
        options.onProgress?.({ loaded, total: urls.length + 1 });
      progress();
      const worker = async () => {
        while (cursor < urls.length) {
          if (signal.aborted) throw signal.reason || abortError();
          const source = urls[cursor++];
          await loadImage(source, signal);
          loaded += 1;
          progress();
        }
      };
      try {
        await Promise.all([
          loadFonts(manifest.fontCharacters || "", signal).then(() => {
            loaded += 1;
            progress();
          }),
          ...Array.from(
            {
              length: Math.min(
                urls.length,
                Math.max(1, environment.concurrency || 4),
              ),
            },
            worker,
          ),
        ]);
        if (signal.aborted) throw signal.reason || abortError();
      } catch (error) {
        controller.abort(error);
        throw error;
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
        if (current === controller) current = undefined;
      }
    },
    dispose() {
      disposed = true;
      current?.abort(abortError());
      decodedImages.clear();
      readyFontCharacters.clear();
    },
  };
};
