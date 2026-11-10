const { HttpsError } = require("firebase-functions/v2/https");

// Check bytes before sharp/libvips chooses a native loader. MIME metadata and
// checking sharp.metadata().format are too late to keep SVG out of librsvg.
const rasterFormat = (bytes) => {
  if (!Buffer.isBuffer(bytes)) return "";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return "gif";
  if (bytes.length >= 4 && (bytes.subarray(0, 4).equals(Buffer.from([73, 73, 42, 0])) || bytes.subarray(0, 4).equals(Buffer.from([77, 77, 0, 42])))) return "tiff";
  if (bytes.length >= 16 && bytes.toString("ascii", 4, 8) === "ftyp") {
    const brand = bytes.toString("ascii", 8, 12);
    if (["avif", "avis"].includes(brand)) return "avif";
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "heif";
  }
  return "";
};
const mimeTypes = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };

const assertRasterImageBytes = (bytes, contentType, { legacyArchive = false } = {}) => {
  const format = rasterFormat(bytes);
  const allowed = legacyArchive ? ["png", "jpeg", "webp", "gif", "avif", "tiff", "heif"] : ["png", "jpeg", "webp"];
  if (!allowed.includes(format) || (contentType && mimeTypes[format] !== contentType)) {
    throw new HttpsError("invalid-argument", "이미지 형식과 실제 파일 내용이 일치하지 않습니다.", { reason: "IMAGE_RASTER_REQUIRED" });
  }
  return format;
};

module.exports = { assertRasterImageBytes };
