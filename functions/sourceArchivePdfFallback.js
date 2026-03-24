const {
  normalizePreviewText,
  normalizeText,
} = require("./sourceArchiveProcessor");

const FALLBACK_PARSER_KIND = "fallback-pdf-parser";
const FALLBACK_EXTRACTION_VERSION =
  "westory-source-archive-pdf/fallback-pdfjs-v1";

const normalizeWhitespace = (value) =>
  normalizeText(String(value || "").replace(/\s+/g, " "));

const median = (values) => {
  const numeric = values
    .map((value) => Number(value) || 0)
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  if (!numeric.length) return 0;
  const middle = Math.floor(numeric.length / 2);
  return numeric.length % 2 === 0
    ? (numeric[middle - 1] + numeric[middle]) / 2
    : numeric[middle];
};

const joinLineText = (items) => {
  let text = "";
  let previousRight = 0;

  items
    .slice()
    .sort((left, right) => left.x - right.x)
    .forEach((item, index) => {
      const needsGap =
        index > 0 && item.x - previousRight > Math.max(2, item.fontSize * 0.18);
      if (
        needsGap &&
        text &&
        !/\s$/.test(text) &&
        !/^[,.;:!?)]/.test(item.text) &&
        !/[-(/]$/.test(text)
      ) {
        text += " ";
      }

      text += item.text;
      previousRight = Math.max(previousRight, item.x + item.width);
    });

  return normalizeWhitespace(text);
};

const buildBoundingBox = (items) => {
  const left = Math.min(...items.map((item) => item.x));
  const top = Math.min(...items.map((item) => item.top));
  const right = Math.max(...items.map((item) => item.x + item.width));
  const bottom = Math.max(...items.map((item) => item.top + item.height));
  return {
    left: Number(left.toFixed(2)),
    top: Number(top.toFixed(2)),
    right: Number(right.toFixed(2)),
    bottom: Number(bottom.toFixed(2)),
  };
};

const buildLineRecords = (items) => {
  if (!items.length) return [];

  const lineTolerance = Math.max(
    2,
    median(items.map((item) => item.fontSize)) * 0.35,
  );
  const sorted = items.slice().sort((left, right) => {
    if (Math.abs(right.y - left.y) > lineTolerance) {
      return right.y - left.y;
    }
    return left.x - right.x;
  });

  const lines = [];
  for (const item of sorted) {
    const currentLine = lines[lines.length - 1];
    if (!currentLine || Math.abs(currentLine.y - item.y) > lineTolerance) {
      lines.push({
        y: item.y,
        items: [item],
      });
      continue;
    }
    currentLine.items.push(item);
  }

  return lines
    .map((line, index) => {
      const sortedItems = line.items
        .slice()
        .sort((left, right) => left.x - right.x);
      const text = joinLineText(sortedItems);
      const bbox = buildBoundingBox(sortedItems);
      const maxFontSize = Math.max(...sortedItems.map((item) => item.fontSize));
      return {
        id: `line-${index + 1}`,
        y: line.y,
        text,
        items: sortedItems,
        bbox,
        maxFontSize,
      };
    })
    .filter((line) => line.text);
};

const classifyBlock = ({ lines, medianFontSize }) => {
  const text = normalizeWhitespace(lines.map((line) => line.text).join(" "));
  const maxFontSize = Math.max(...lines.map((line) => line.maxFontSize));
  const tableLineCount = lines.filter((line) => line.items.length >= 3).length;

  if (
    lines.length <= 2 &&
    text.length <= 160 &&
    maxFontSize >= Math.max(13, medianFontSize * 1.22)
  ) {
    let headingLevel = 3;
    if (maxFontSize >= medianFontSize * 1.8) headingLevel = 1;
    else if (maxFontSize >= medianFontSize * 1.45) headingLevel = 2;
    return { kind: "heading", headingLevel };
  }

  if (tableLineCount >= Math.max(2, Math.ceil(lines.length / 2))) {
    return { kind: "table" };
  }

  return { kind: "paragraph" };
};

const buildBlockRecords = (lines) => {
  if (!lines.length) return [];

  const medianFontSize = median(lines.map((line) => line.maxFontSize)) || 11;
  const blockGapThreshold = Math.max(14, medianFontSize * 1.6);
  const blocks = [];

  for (const line of lines) {
    const previousLine = blocks[blocks.length - 1]?.lines?.slice(-1)[0] || null;
    const verticalGap = previousLine ? previousLine.y - line.y : 0;
    const shouldStartNewBlock =
      !blocks.length ||
      verticalGap >
        Math.max(blockGapThreshold, previousLine.maxFontSize * 1.25);

    if (shouldStartNewBlock) {
      blocks.push({ lines: [line] });
      continue;
    }

    blocks[blocks.length - 1].lines.push(line);
  }

  return blocks
    .map((block, index) => {
      const flattenedItems = block.lines.flatMap((line) => line.items);
      const classification = classifyBlock({
        lines: block.lines,
        medianFontSize,
      });
      const text = block.lines
        .map((line) => line.text)
        .join(classification.kind === "table" ? "\n" : " ");
      const rows =
        classification.kind === "table"
          ? block.lines.map((line) =>
              line.items
                .map((item) => normalizeWhitespace(item.text))
                .filter(Boolean),
            )
          : [];

      return {
        id: `block-${index + 1}`,
        kind: classification.kind,
        headingLevel: classification.headingLevel || 0,
        text: normalizeWhitespace(text),
        rows,
        lineCount: block.lines.length,
        itemCount: flattenedItems.length,
        fontSize: Number(
          Math.max(...block.lines.map((line) => line.maxFontSize)).toFixed(2),
        ),
        bbox: buildBoundingBox(flattenedItems),
      };
    })
    .filter((block) => block.text);
};

const renderMarkdownBlock = (block) => {
  if (block.kind === "heading") {
    const headingDepth = Math.min(6, Math.max(1, block.headingLevel || 1));
    return `${"#".repeat(headingDepth)} ${block.text}`;
  }

  if (block.kind === "table") {
    const rows = block.rows.filter((row) => row.length > 0);
    if (!rows.length) return block.text;

    const header = rows[0];
    const separator = header.map(() => "---");
    const markdownRows = [`| ${header.join(" | ")} |`];
    if (rows.length > 1) {
      markdownRows.push(`| ${separator.join(" | ")} |`);
      markdownRows.push(
        ...rows.slice(1).map((row) => `| ${row.join(" | ")} |`),
      );
    }
    return markdownRows.join("\n");
  }

  return block.text;
};

const loadPdfJs = async () => import("pdfjs-dist/legacy/build/pdf.mjs");

const extractPdfWithFallback = async ({ inputBuffer, originalName }) => {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(inputBuffer),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
    useWorkerFetch: false,
    verbosity: 0,
  });

  const document = await loadingTask.promise;

  try {
    const metadata = await document.getMetadata().catch(() => null);
    const pages = [];
    const titleBlocks = [];
    const markdownParts = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent({
        disableCombineTextItems: false,
        includeMarkedContent: false,
      });

      const items = textContent.items
        .map((item) => {
          const text = normalizeWhitespace(item.str);
          if (!text) return null;

          const transform = Array.isArray(item.transform)
            ? item.transform
            : [0, 0, 0, 0, 0, 0];
          const x = Number(transform[4] || 0);
          const y = Number(transform[5] || 0);
          const width = Number(item.width || 0);
          const fontSize = Number(
            item.height || Math.abs(transform[3] || 0) || 0,
          );
          const top = Math.max(0, Number(viewport.height || 0) - y);

          return {
            text,
            x,
            y,
            top,
            width:
              width > 0
                ? width
                : Math.max(fontSize, text.length * Math.max(4, fontSize * 0.5)),
            height: fontSize > 0 ? fontSize : 10,
            fontSize: fontSize > 0 ? fontSize : 10,
          };
        })
        .filter(Boolean);

      const lines = buildLineRecords(items);
      const blocks = buildBlockRecords(lines);
      const pageText = blocks.map((block) => block.text).join("\n\n");

      blocks
        .filter((block) => block.kind === "heading")
        .forEach((block) => {
          titleBlocks.push({
            pageNumber,
            text: block.text,
            headingLevel: block.headingLevel,
          });
        });

      markdownParts.push(`<!-- page ${pageNumber} -->`);
      blocks.forEach((block) => {
        markdownParts.push(renderMarkdownBlock(block));
      });

      pages.push({
        pageNumber,
        width: Number(viewport.width || 0),
        height: Number(viewport.height || 0),
        text: pageText,
        blocks,
      });

      page.cleanup();
    }

    const metadataTitle = normalizeWhitespace(
      metadata?.info?.Title || metadata?.metadata?.get?.("dc:title") || "",
    );
    const derivedTitle =
      metadataTitle ||
      titleBlocks[0]?.text ||
      normalizeText(originalName).replace(/\.pdf$/i, "");
    const markdown = markdownParts.filter(Boolean).join("\n\n");
    const previewText = normalizePreviewText(
      pages.map((page) => page.text).join(" "),
    );

    return {
      parserKind: FALLBACK_PARSER_KIND,
      extractionVersion: FALLBACK_EXTRACTION_VERSION,
      previewText,
      title: derivedTitle,
      pageCount: document.numPages,
      markdown,
      manifest: {
        schemaVersion: 1,
        parserKind: FALLBACK_PARSER_KIND,
        extractionVersion: FALLBACK_EXTRACTION_VERSION,
        generatedAt: new Date().toISOString(),
        title: derivedTitle,
        previewText,
        source: {
          originalName: normalizeText(originalName),
          parser: "pdfjs-dist",
        },
        pageCount: document.numPages,
        titleBlocks,
        pages,
      },
    };
  } finally {
    await document.destroy();
  }
};

module.exports = {
  FALLBACK_PARSER_KIND,
  FALLBACK_EXTRACTION_VERSION,
  extractPdfWithFallback,
};
