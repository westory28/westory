import sourceArchivePdfAdapter from "../sourceArchivePdfAdapter.js";

const { extractSourceArchivePdf } = sourceArchivePdfAdapter;

const buildPdfBuffer = (text) => {
  const objects = [];
  const addObject = (body) => {
    objects.push(body);
  };

  addObject("<< /Type /Catalog /Pages 2 0 R >>");
  addObject("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  addObject("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>");

  const escapedText = String(text || "").replace(/([\\\\()])/g, "\\$1");
  const streamBody = `BT\n/F1 24 Tf\n72 720 Td\n(${escapedText}) Tj\nET`;
  addObject(`<< /Length ${Buffer.byteLength(streamBody, "utf8")} >>\nstream\n${streamBody}\nendstream`);
  addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdfText = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((objectBody, index) => {
    offsets.push(Buffer.byteLength(pdfText, "utf8"));
    pdfText += `${index + 1} 0 obj\n${objectBody}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdfText, "utf8");
  pdfText += `xref\n0 ${objects.length + 1}\n`;
  pdfText += "0000000000 65535 f \n";

  for (let index = 1; index <= objects.length; index += 1) {
    pdfText += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  pdfText += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdfText, "utf8");
};

const revisionPaths = {
  revision: "smoke-revision",
  extractedPagesPath: "source-archive/smoke/smoke-revision/extracted/pages",
  extractedContentPath: "source-archive/smoke/smoke-revision/extracted/content.md",
  extractedManifestPath: "source-archive/smoke/smoke-revision/extracted/manifest.json",
};

const extraction = await extractSourceArchivePdf({
  inputBuffer: buildPdfBuffer("OpenDataLoader PDF smoke test"),
  originalName: "smoke.pdf",
  revisionPaths,
});

if (!extraction?.parserKind || Number(extraction?.pageCount || 0) < 1) {
  throw new Error("source-archive-pdf-smoke-failed");
}

console.log(JSON.stringify({
  parserKind: extraction.parserKind,
  extractionVersion: extraction.extractionVersion,
  pageCount: extraction.pageCount,
  previewText: extraction.previewText,
  pageArtifactCount: Array.isArray(extraction.pageArtifacts)
    ? extraction.pageArtifacts.length
    : 0,
}, null, 2));
