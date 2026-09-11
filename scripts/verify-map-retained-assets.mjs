import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { transform } from "esbuild";

// Exercise the production selector without initializing Firebase or a browser.
const source = await fs.readFile(
  new URL("../src/lib/mapManagement.ts", import.meta.url),
  "utf8",
);
const start = source.indexOf("export const getAttachedMapUploadIds =");
const end = source.indexOf("type Config =", start);
assert.ok(start >= 0 && end > start);
const compiled = await transform(source.slice(start, end), {
  loader: "ts",
  format: "esm",
});
const { getAttachedMapUploadIds: select } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled.code).toString("base64")
);
const asset = (uploadId, kind, sourceUploadId) => ({
  uploadId,
  kind,
  sourceUploadId,
  storagePath: `map_uploads/${uploadId}/source`,
  url: `https://example.invalid/${uploadId}`,
});
const oldPdf = asset("old-pdf", "PDF"),
  oldPage = asset("old-page", "PAGE", oldPdf.uploadId);
const newPdf = asset("new-pdf", "PDF"),
  newPage = asset("new-page", "PAGE", newPdf.uploadId);
const oldImage = asset("old-image", "IMAGE"),
  newImage = asset("new-image", "IMAGE");
const retained = [oldPdf, oldPage, newPdf, newPage, oldImage, newImage];
const pdfDocument = (pdf) => ({
  type: "pdf",
  fileUrl: pdf.url,
  storagePath: pdf.storagePath,
  imageUrl: "",
  pdfPageImages: [
    { page: 1, imageUrl: pdf === oldPdf ? oldPage.url : newPage.url },
  ],
});
const imageDocument = (image) => ({
  type: "image",
  fileUrl: image.url,
  storagePath: image.storagePath,
  imageUrl: image.url,
});

assert.deepEqual(
  select(pdfDocument(newPdf), retained),
  ["new-pdf", "new-page"],
  "PDF replacement drops every retained original/page ticket from the previous PDF",
);
assert.deepEqual(
  select(imageDocument(newImage), retained),
  ["new-image"],
  "image replacement drops the old image and PDF tickets",
);
assert.deepEqual(
  select(
    {
      type: "google",
      googleQuery: "한반도",
      fileUrl: "",
      storagePath: "",
      pdfPageImages: [],
    },
    retained,
  ),
  [],
  "changing a restored draft to Google submits no unused uploads",
);
assert.deepEqual(
  select({ type: "iframe", embedUrl: "https://example.invalid/map" }, retained),
  [],
  "changing a restored draft to iframe submits no unused uploads",
);
assert.deepEqual(
  select({ ...pdfDocument(newPdf), pdfPageImages: [] }, retained),
  ["new-pdf"],
  "removing pages excludes their tickets; the server still validates PDF page completeness",
);
assert.deepEqual(
  select(
    {
      ...pdfDocument(newPdf),
      pdfPageImages: [{ page: 1, imageUrl: oldPage.url }],
    },
    retained,
  ),
  ["new-pdf"],
  "a page bound to another PDF never rides on the new source ticket",
);
assert.deepEqual(
  select(imageDocument({ ...newImage, url: oldImage.url }), retained),
  [],
  "an image URL/storagePath mismatch cannot select a partially matching upload",
);
const submitted = structuredClone(pdfDocument(oldPdf));
const before = JSON.stringify(retained);
assert.deepEqual(
  select(submitted, retained),
  ["old-pdf", "old-page"],
  "an unchanged unconfirmed payload reuses the same original ticket IDs",
);
assert.equal(
  JSON.stringify(retained),
  before,
  "selection does not discard retry metadata",
);
console.log(
  "Map retained asset selection: 9 checks passed; Firebase/browser/network not initialized.",
);
