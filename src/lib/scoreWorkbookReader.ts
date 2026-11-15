import JSZip from "jszip";

const cellPosition = (reference: string) => {
  const match = /^([A-Z]+)([1-9]\d*)$/.exec(reference);
  if (!match) return null;
  let column = 0;
  for (const letter of match[1])
    column = column * 26 + letter.charCodeAt(0) - 64;
  return { row: Number(match[2]), column };
};

// Some NEIS exports declare A1 even though their sheetData contains a full
// table. read-excel-file otherwise discards every cell outside that range.
// Removing only an inconsistent dimension lets its own parser reconstruct
// the range from actual cell coordinates, without changing any cell data.
const withoutTruncatedDimension = (xml: string) => {
  const dimension = /<dimension\b[^>]*(?:\/>|>[\s\S]*?<\/dimension>)/.exec(xml);
  if (!dimension) return xml;
  const reference = /\bref\s*=\s*(["'])(.*?)\1/.exec(dimension[0])?.[2] || "";
  const bounds = reference.split(":").map(cellPosition);
  const start = bounds[0];
  const end = bounds[bounds.length - 1];
  let inconsistent =
    bounds.length > 2 ||
    !start ||
    !end ||
    start.row > end.row ||
    start.column > end.column;
  if (!inconsistent && start && end) {
    const sheetData =
      /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml)?.[1] || "";
    for (const cell of sheetData.matchAll(
      /<c\b[^>]*\br\s*=\s*(["'])([A-Z]+[1-9]\d*)\1[^>]*>/g,
    )) {
      const position = cellPosition(cell[2])!;
      if (
        position.row < start.row ||
        position.row > end.row ||
        position.column < start.column ||
        position.column > end.column
      ) {
        inconsistent = true;
        break;
      }
    }
  }
  return inconsistent ? xml.replace(dimension[0], "") : xml;
};

// Some NEIS files saved by Hancom Cell use a prefix for the SpreadsheetML
// namespace. Normalize that namespace in memory for read-excel-file, without
// modifying the user's file, styles, values, or evaluation headers.
export const normalizeScoreWorkbookNamespaces = async (buffer: ArrayBuffer) => {
  const zip = await JSZip.loadAsync(buffer);
  let changed = false;
  const paths = Object.keys(zip.files).filter((path) =>
    /^xl\/(?:workbook|styles|sharedStrings|worksheets\/sheet\d+)\.xml$/.test(
      path,
    ),
  );
  for (const path of paths) {
    const entry = zip.file(path);
    if (!entry) continue;
    let xml = await entry.async("string");
    // Hancom wraps individual style entries in compatibility choices. Use
    // their standard fallback so style indices remain aligned with cells.
    xml = xml.replace(
      /<mc:AlternateContent\b[^>]*>[\s\S]*?<\/mc:AlternateContent>/g,
      (block) => {
        const fallback = /<mc:Fallback\b[^>]*>([\s\S]*?)<\/mc:Fallback>/.exec(
          block,
        );
        if (!fallback) return block;
        changed = true;
        return fallback[1];
      },
    );
    const match =
      /xmlns:([A-Za-z_][\w.-]*)="http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main"/.exec(
        xml,
      );
    if (match) {
      const prefix = match[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      xml = xml
        .replace(new RegExp(`<(/?)${prefix}:`, "g"), "<$1")
        .replace(
          match[0],
          'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
        );
      changed = true;
    }
    if (path.startsWith("xl/worksheets/")) {
      const normalized = withoutTruncatedDimension(xml);
      if (normalized !== xml) changed = true;
      xml = normalized;
    }
    zip.file(path, xml);
  }
  return changed ? zip.generateAsync({ type: "arraybuffer" }) : buffer;
};

export const readScoreWorkbookRows = async (
  file: File,
): Promise<unknown[][]> => {
  if (file.size > 20 * 1024 * 1024)
    throw new Error("점수 파일은 20MB 이하로 선택해 주세요.");
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const data = await normalizeScoreWorkbookNamespaces(await file.arrayBuffer());
  const workbookRows = (await readXlsxFile(new Blob([data]))) as unknown;
  return Array.isArray(workbookRows) &&
    workbookRows[0] &&
    !Array.isArray(workbookRows[0]) &&
    Array.isArray(workbookRows[0].data)
    ? workbookRows[0].data
    : (workbookRows as unknown[][]);
};
