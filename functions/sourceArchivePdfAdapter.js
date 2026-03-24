const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const {
  SOURCE_ARCHIVE_PDF_PROCESSOR_VERSION,
  normalizePreviewText,
  normalizeText,
  saveJsonStorageFile,
  saveTextStorageFile,
} = require("./sourceArchiveProcessor");
const { extractPdfWithFallback } = require("./sourceArchivePdfFallback");

const OPEN_DATALOADER_PARSER_KIND = "opendataloader-pdf";
const OPEN_DATALOADER_PACKAGE_NAME = "@opendataloader/pdf";

const normalizeWhitespace = (value) =>
  normalizeText(String(value || "").replace(/\s+/g, " "));

const toBoundingBox = (value) => {
  if (!Array.isArray(value) || value.length !== 4) {
    return null;
  }

  return {
    left: Number(value[0] || 0),
    bottom: Number(value[1] || 0),
    right: Number(value[2] || 0),
    top: Number(value[3] || 0),
  };
};

const loadOpenDataLoaderPdf = async () => {
  try {
    return await import(OPEN_DATALOADER_PACKAGE_NAME);
  } catch {
    return null;
  }
};

const listFilesRecursively = async (directoryPath) => {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const nextPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursively(nextPath);
      }
      return [nextPath];
    }),
  );
  return files.flat();
};

const findOutputFile = async (directoryPath, extensions) => {
  const files = await listFilesRecursively(directoryPath);
  return (
    files.find((filePath) =>
      extensions.some((extension) =>
        filePath.toLowerCase().endsWith(extension.toLowerCase()),
      ),
    ) || ""
  );
};

const extractTextFromOpenDataLoaderNode = (node) => {
  if (!node || typeof node !== "object") return "";

  if (typeof node.content === "string") {
    return normalizeWhitespace(node.content);
  }

  if (typeof node.text === "string") {
    return normalizeWhitespace(node.text);
  }

  if (Array.isArray(node.rows)) {
    return node.rows
      .flatMap((row) => (Array.isArray(row?.cells) ? row.cells : []))
      .map((cell) => extractTextFromOpenDataLoaderNode(cell))
      .filter(Boolean)
      .join(" ");
  }

  if (Array.isArray(node.kids)) {
    return node.kids
      .map((child) => extractTextFromOpenDataLoaderNode(child))
      .filter(Boolean)
      .join(" ");
  }

  return "";
};

const extractRowsFromOpenDataLoaderTable = (node) => {
  if (!Array.isArray(node?.rows)) return [];

  return node.rows
    .map((row) =>
      Array.isArray(row?.cells)
        ? row.cells
            .map((cell) => extractTextFromOpenDataLoaderNode(cell))
            .map((cell) => normalizeWhitespace(cell))
            .filter(Boolean)
        : [],
    )
    .filter((row) => row.length > 0);
};

const normalizeOpenDataLoaderBlock = (node, fallbackPageNumber, index) => {
  if (!node || typeof node !== "object") return null;

  const rawType = normalizeText(
    node.type || node.kind || node.blockType,
  ).toLowerCase();
  const rows =
    rawType === "table" ? extractRowsFromOpenDataLoaderTable(node) : [];
  const text =
    rawType === "table"
      ? rows.map((row) => row.join(" | ")).join("\n")
      : extractTextFromOpenDataLoaderNode(node);

  if (!text) return null;

  const pageNumber =
    Number(
      node["page number"] ||
        node.pageNumber ||
        node.page ||
        fallbackPageNumber ||
        1,
    ) || 1;

  return {
    id: `block-${index + 1}`,
    kind:
      rawType === "heading"
        ? "heading"
        : rawType === "table"
          ? "table"
          : "paragraph",
    headingLevel:
      rawType === "heading"
        ? Number(node["heading level"] || node.headingLevel || 1) || 1
        : 0,
    text: normalizeWhitespace(text),
    rows,
    lineCount: Math.max(1, String(text).split(/\n+/).length),
    itemCount: rows.length || 1,
    fontSize: Number(node["font size"] || node.fontSize || 0) || 0,
    bbox: toBoundingBox(node["bounding box"] || node.boundingBox),
    pageNumber,
  };
};

const flattenOpenDataLoaderNodes = (jsonDocument) => {
  if (Array.isArray(jsonDocument)) {
    return jsonDocument
      .map((node, index) => normalizeOpenDataLoaderBlock(node, 1, index))
      .filter(Boolean);
  }

  if (Array.isArray(jsonDocument?.kids)) {
    return jsonDocument.kids
      .map((node, index) => normalizeOpenDataLoaderBlock(node, 1, index))
      .filter(Boolean);
  }

  if (Array.isArray(jsonDocument?.pages)) {
    return jsonDocument.pages.flatMap((page, pageIndex) => {
      const pageNumber =
        Number(page?.["page number"] || page?.pageNumber || pageIndex + 1) ||
        pageIndex + 1;
      const pageNodes = Array.isArray(page?.kids)
        ? page.kids
        : Array.isArray(page?.blocks)
          ? page.blocks
          : [];
      return pageNodes
        .map((node, index) =>
          normalizeOpenDataLoaderBlock(node, pageNumber, index),
        )
        .filter(Boolean);
    });
  }

  return [];
};

const buildManifestPages = (pages, revisionPaths) =>
  pages.map((page) => ({
    pageNumber: page.pageNumber,
    path: `${revisionPaths.extractedPagesPath}/page-${String(page.pageNumber).padStart(3, "0")}.json`,
    blockCount: page.blocks.length,
    previewText: normalizePreviewText(page.text),
  }));

const buildPageArtifacts = (pages, revisionPaths) =>
  pages.map((page) => ({
    storagePath: `${revisionPaths.extractedPagesPath}/page-${String(page.pageNumber).padStart(3, "0")}.json`,
    payload: {
      pageNumber: page.pageNumber,
      blockCount: page.blocks.length,
      text: page.text,
      blocks: page.blocks,
    },
  }));

const finalizePdfExtraction = ({
  parserKind,
  extractionVersion,
  title,
  markdown,
  previewText,
  pages,
  titleBlocks,
  originalName,
  revisionPaths,
}) => {
  const normalizedPages = pages.map((page, index) => ({
    pageNumber: Number(page.pageNumber || index + 1) || index + 1,
    text: normalizeText(page.text),
    blocks: Array.isArray(page.blocks) ? page.blocks : [],
  }));
  const pageArtifacts = buildPageArtifacts(normalizedPages, revisionPaths);
  const manifest = {
    schemaVersion: 1,
    assetRevision: revisionPaths.revision,
    mediaKind: "pdf",
    parserKind,
    extractionVersion,
    generatedAt: new Date().toISOString(),
    title,
    previewText,
    pageCount: normalizedPages.length,
    contentPath: revisionPaths.extractedContentPath,
    titleBlocks,
    pages: buildManifestPages(normalizedPages, revisionPaths),
    source: {
      originalName: normalizeText(originalName),
    },
  };

  return {
    parserKind,
    extractionVersion,
    title,
    previewText,
    pageCount: normalizedPages.length,
    markdown,
    manifest,
    pageArtifacts,
  };
};

const normalizeOpenDataLoaderOutput = ({
  jsonDocument,
  markdownText,
  originalName,
  revisionPaths,
}) => {
  const blocks = flattenOpenDataLoaderNodes(jsonDocument);
  const pageCountFromBlocks = Math.max(
    0,
    ...blocks.map((block) => block.pageNumber || 0),
  );
  const pageCount =
    Number(
      jsonDocument?.["number of pages"] ||
        jsonDocument?.pageCount ||
        pageCountFromBlocks,
    ) || pageCountFromBlocks;
  const pages = Array.from({ length: pageCount }, (_, index) => ({
    pageNumber: index + 1,
    text: "",
    blocks: [],
  }));

  blocks.forEach((block) => {
    const pageIndex = Math.max(0, block.pageNumber - 1);
    if (!pages[pageIndex]) {
      pages[pageIndex] = {
        pageNumber: block.pageNumber,
        text: "",
        blocks: [],
      };
    }
    pages[pageIndex].blocks.push(block);
  });

  pages.forEach((page) => {
    page.text = page.blocks.map((block) => block.text).join("\n\n");
  });

  const titleBlocks = pages.flatMap((page) =>
    page.blocks
      .filter((block) => block.kind === "heading")
      .map((block) => ({
        pageNumber: page.pageNumber,
        text: block.text,
        headingLevel: block.headingLevel,
      })),
  );

  const previewText = normalizePreviewText(
    markdownText || pages.map((page) => page.text).join(" "),
  );
  const title = normalizeWhitespace(
    jsonDocument?.title ||
      titleBlocks[0]?.text ||
      normalizeText(originalName).replace(/\.pdf$/i, ""),
  );

  return finalizePdfExtraction({
    parserKind: OPEN_DATALOADER_PARSER_KIND,
    extractionVersion: SOURCE_ARCHIVE_PDF_PROCESSOR_VERSION,
    title,
    markdown: String(markdownText || ""),
    previewText,
    pages,
    titleBlocks,
    originalName,
    revisionPaths,
  });
};

const tryExtractWithOpenDataLoader = async ({
  inputBuffer,
  originalName,
  revisionPaths,
}) => {
  const packageApi = await loadOpenDataLoaderPdf();
  const convert = packageApi?.convert || packageApi?.default?.convert;
  if (typeof convert !== "function") {
    return null;
  }

  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "westory-opendataloader-"),
  );
  const inputPath = path.join(tempRoot, "input.pdf");
  const outputDir = path.join(tempRoot, "output");

  try {
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(inputPath, inputBuffer);

    await convert([inputPath], {
      outputDir,
      format: "markdown,json",
      quiet: true,
      useStructTree: true,
    });

    const jsonPath = await findOutputFile(outputDir, [".json"]);
    const markdownPath = await findOutputFile(outputDir, [".md", ".markdown"]);
    if (!jsonPath || !markdownPath) {
      throw new Error("opendataloader-output-missing");
    }

    const [jsonText, markdownText] = await Promise.all([
      fs.readFile(jsonPath, "utf8"),
      fs.readFile(markdownPath, "utf8"),
    ]);

    return normalizeOpenDataLoaderOutput({
      jsonDocument: JSON.parse(jsonText),
      markdownText,
      originalName,
      revisionPaths,
    });
  } catch (error) {
    console.warn(
      "OpenDataLoader PDF adapter unavailable, using fallback parser:",
      error,
    );
    return null;
  } finally {
    await fs
      .rm(tempRoot, { recursive: true, force: true })
      .catch(() => undefined);
  }
};

const extractSourceArchivePdf = async ({
  inputBuffer,
  originalName,
  revisionPaths,
}) => {
  const openDataLoaderResult = await tryExtractWithOpenDataLoader({
    inputBuffer,
    originalName,
    revisionPaths,
  });
  if (openDataLoaderResult) {
    return openDataLoaderResult;
  }

  const fallbackResult = await extractPdfWithFallback({
    inputBuffer,
    originalName,
    revisionPaths,
  });

  return finalizePdfExtraction({
    parserKind: fallbackResult.parserKind,
    extractionVersion: fallbackResult.extractionVersion,
    title: fallbackResult.title,
    markdown: fallbackResult.markdown,
    previewText: fallbackResult.previewText,
    pages: Array.isArray(fallbackResult.manifest?.pages)
      ? fallbackResult.manifest.pages
      : [],
    titleBlocks: Array.isArray(fallbackResult.manifest?.titleBlocks)
      ? fallbackResult.manifest.titleBlocks
      : [],
    originalName,
    revisionPaths,
  });
};

const saveSourceArchivePdfArtifacts = async ({
  bucket,
  inputBuffer,
  originalName,
  revisionPaths,
}) => {
  const extraction = await extractSourceArchivePdf({
    inputBuffer,
    originalName,
    revisionPaths,
  });

  await saveTextStorageFile({
    bucket,
    storagePath: revisionPaths.extractedContentPath,
    text: extraction.markdown,
    contentType: "text/markdown; charset=utf-8",
  });
  await saveJsonStorageFile({
    bucket,
    storagePath: revisionPaths.extractedManifestPath,
    data: extraction.manifest,
  });
  await Promise.all(
    extraction.pageArtifacts.map((pageArtifact) =>
      saveJsonStorageFile({
        bucket,
        storagePath: pageArtifact.storagePath,
        data: pageArtifact.payload,
      }),
    ),
  );

  return {
    parserKind: extraction.parserKind,
    extractionVersion: extraction.extractionVersion,
    previewText: extraction.previewText,
    pageCount: extraction.pageCount,
    title: extraction.title,
    extractedContentPath: revisionPaths.extractedContentPath,
    extractedManifestPath: revisionPaths.extractedManifestPath,
    generatedPaths: [
      revisionPaths.extractedContentPath,
      revisionPaths.extractedManifestPath,
      ...extraction.pageArtifacts.map(
        (pageArtifact) => pageArtifact.storagePath,
      ),
    ],
  };
};

module.exports = {
  OPEN_DATALOADER_PARSER_KIND,
  extractSourceArchivePdf,
  saveSourceArchivePdfArtifacts,
};
