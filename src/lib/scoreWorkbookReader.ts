import JSZip from "jszip";

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
    if (!match) {
      zip.file(path, xml);
      continue;
    }
    const prefix = match[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    zip.file(
      path,
      xml
        .replace(new RegExp(`<(/?)${prefix}:`, "g"), "<$1")
        .replace(
          match[0],
          'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
        ),
    );
    changed = true;
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
