const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { createHash } = require("node:crypto");
const { gzipSync } = require("node:zlib");
const sharp = require("sharp");
const { assertRasterImageBytes } = require("../rasterImageSafety");

const root = path.resolve(__dirname, "..");
const releaseRoot = path.resolve(root, "../output/security-release");
const verifyRelease = process.argv.includes("--release");
const releaseFiles = {
  "sourceArchiveProcessor.js": "processSourceArchiveIncomingUpload/sourceArchiveProcessor.js",
  "productionGateway/sourceArchiveProcessor.js": "processSourceArchiveIncomingUpload/sourceArchiveProcessor.js",
  "productionGateway/mapManagement.js": "uploadMapAssetContent/mapManagement.js",
  "productionGateway/sourceArchiveManagement.js": "uploadSourceArchiveAsset/sourceArchiveManagement.js",
  "productionGateway/schoolBanners.js": "registerSchoolBanner/schoolBanners.js",
};
const load = (relative, mocks = {}) => {
  const released = verifyRelease && releaseFiles[relative];
  const filename = path.isAbsolute(relative) ? relative : released
    ? path.join(releaseRoot, released.split("/")[0], "functions", released.split("/")[1])
    : path.join(root, relative);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const context = { module, exports: module.exports, Buffer, console, process,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : localRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });
  return module.exports;
};
const auth = { uid: "fixture-teacher", token: { email: "fixture@yongshin-ms.ms.kr" } };
const session = async () => ({ uid: auth.uid, email: auth.token.email });
const snapshot = data => ({ exists: true, data: () => data });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const rejection = error => error.code === "invalid-argument" && error.details?.reason === "IMAGE_RASTER_REQUIRED";
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>');

(async () => {
  const fixtures = {};
  for (const format of ["png", "jpeg", "webp", "gif", "avif", "tiff"]) {
    fixtures[format] = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#345678" } })[format]().toBuffer();
    assert.equal(assertRasterImageBytes(fixtures[format], undefined, { legacyArchive: true }), format);
  }
  for (const format of ["png", "jpeg", "webp"]) {
    assert.equal(assertRasterImageBytes(fixtures[format], `image/${format}`), format);
  }
  assert.throws(() => assertRasterImageBytes(fixtures.png, "image/jpeg"), rejection);
  assert.throws(() => assertRasterImageBytes(fixtures.gif), rejection);
  const unsafe = [svg, Buffer.concat([Buffer.from([239, 187, 191]), svg]),
    Buffer.concat([Buffer.from('<?xml version="1.0"?>\n'), svg]), gzipSync(svg), Buffer.from("not an image")];
  for (const bytes of unsafe) {
    assert.throws(() => assertRasterImageBytes(bytes, "image/png"), rejection);
    assert.throws(() => assertRasterImageBytes(bytes, undefined, { legacyArchive: true }), rejection);
  }

  // Both processor copies preserve existing raster variants; rejected input
  // never reaches sharp, including its metadata parser.
  for (const filename of ["sourceArchiveProcessor.js", "productionGateway/sourceArchiveProcessor.js"]) {
    let nativeCalls = 0;
    const processor = load(filename, { sharp: (...args) => { nativeCalls++; return sharp(...args); } });
    for (const bytes of unsafe) await assert.rejects(processor.renderSourceArchiveVariants({ inputBuffer: bytes }), rejection);
    assert.equal(nativeCalls, 0);
    for (const bytes of Object.values(fixtures)) {
      const result = await processor.renderSourceArchiveVariants({ inputBuffer: bytes });
      assert.equal(result.originalWidth, 8);
      assert.equal(result.originalHeight, 6);
      assert.equal(result.displayResult.info.format, "webp");
      assert.equal(result.thumbResult.info.format, "webp");
    }
    assert.equal(nativeCalls, 6);
  }

  // A caller can claim a raster MIME in a valid owned ticket. Reject before
  // metadata/transactions/storage so the new boundary adds zero server I/O.
  for (const bytes of unsafe) {
    let reads = 0, writes = 0, metadataCalls = 0;
    const ticket = { ownerUid: auth.uid, storagePath: "map_uploads/fixture/source", status: "PENDING", expiresAtMs: 1000,
      byteSize: bytes.length, sha256: digest(bytes), kind: "PAGE", contentType: "image/png", assetId: "fixture" };
    const db = { doc: name => ({ get: async () => { reads++; return snapshot(name.startsWith("users/") ? { role: "teacher" } : ticket); } }),
      getAll: async () => { reads += 2; return [snapshot(ticket), snapshot({ role: "teacher" })]; },
      runTransaction: async () => { writes++; throw new Error("Unexpected transaction"); } };
    const bucket = { file: () => { writes++; throw new Error("Unexpected storage access"); } };
    const data = { uploadId: "fixture", contentBase64: bytes.toString("base64") };
    const imageMetadata = async () => { metadataCalls++; throw new Error("Unexpected native image parser"); };
    const maps = load("productionGateway/mapManagement.js");
    await assert.rejects(maps.createMapUploadHandler({ db, bucket, assertSession: session, now: () => 1, imageMetadata })({ auth, data }), rejection);
    assert.equal(reads, 2); assert.equal(writes, 0); assert.equal(metadataCalls, 0);
    reads = 0;
    const archive = load("productionGateway/sourceArchiveManagement.js");
    await assert.rejects(archive.createSourceArchiveUploadHandler({ db, bucket, assertSession: session, now: () => 1, imageMetadata })({ auth, data }), rejection);
    assert.equal(reads, 2); assert.equal(writes, 0); assert.equal(metadataCalls, 0);
    reads = 0;
    const banners = load("productionGateway/schoolBanners.js", {
      sharp: () => { metadataCalls++; throw new Error("Unexpected native image parser"); },
      "./studentMaintenance": { onCallWithStudentMaintenance: (_options, handler) => handler },
      "./sessionAuthority": { assertActiveApplicationSession: session },
    });
    await assert.rejects(banners.createRegisterSchoolBannerHandler({ db, bucket, assertSession: session })({ auth,
      data: { semesterId: "2026-2", requestId: "fixture-request", title: "합성 배너", contentBase64: data.contentBase64 } }), rejection);
    assert.equal(reads, 0); assert.equal(writes, 0); assert.equal(metadataCalls, 0);
  }

  // A rejected finalized lesson upload keeps its existing FAILED recovery
  // marker, and never grants a download token or writes a processed asset.
  let nativeCalls = 0, storageWrites = 0, failureWrites = 0;
  const ticket = { uploadId: "fixture", storagePath: "lesson_uploads/fixture/source", status: "PENDING", expiresAtMs: Date.now() + 60000,
    byteSize: svg.length, sha256: digest(svg), kind: "IMAGE", contentType: "image/png" };
  const ticketRef = { get: async () => snapshot(ticket) };
  const lessonDb = { doc: () => ticketRef, runTransaction: async callback => callback({
    get: async () => snapshot(ticket), set: (_ref, data) => { failureWrites++; Object.assign(ticket, data); },
  }) };
  const lesson = load("productionGateway/lessonAssetUploads.js", {
    sharp: () => { nativeCalls++; throw new Error("Unexpected native image parser"); },
    "firebase-admin/firestore": { getFirestore: () => lessonDb, FieldValue: {} },
    "firebase-admin/storage": { getStorage: () => ({ bucket: () => ({ file: () => ({ download: async () => [svg],
      setMetadata: async () => { storageWrites++; } }) }) }) },
    "firebase-functions/params": { storageBucket: "fixture" },
    "firebase-functions/v2/storage": { onObjectFinalized: (_options, handler) => handler },
  });
  await lesson.processLessonAssetUpload({ data: { name: ticket.storagePath, bucket: "fixture", generation: "1", size: svg.length, contentType: ticket.contentType } });
  assert.equal(nativeCalls, 0); assert.equal(storageWrites, 0); assert.equal(failureWrites, 1); assert.equal(ticket.status, "FAILED");
  if (verifyRelease) {
    for (const target of ["processLessonAssetUpload", "uploadLessonAssetContent"]) {
      let calls = 0;
      const verifier = load(path.join(releaseRoot, target, "functions/lessonAssetVerification.js"), {
        sharp: (...args) => { calls++; return sharp(...args); },
      });
      for (const bytes of unsafe) await assert.rejects(verifier.validateLessonAssetBytes({
        kind: "IMAGE", contentType: "image/png", byteSize: bytes.length, sha256: digest(bytes),
      }, bytes), rejection);
      assert.equal(calls, 0);
      for (const format of ["png", "jpeg", "webp"]) {
        const bytes = fixtures[format];
        await verifier.validateLessonAssetBytes({ kind: "IMAGE", contentType: `image/${format}`, byteSize: bytes.length, sha256: digest(bytes) }, bytes);
      }
      assert.equal(calls, 3);
      const pdf = Buffer.from("%PDF-1.4\nsynthetic fixture\n%%EOF");
      assert.equal((await verifier.validateLessonAssetBytes({ kind: "PDF", contentType: "application/pdf", byteSize: pdf.length, sha256: digest(pdf) }, pdf)).mediaKind, "pdf");
      assert.equal(calls, 3, "PDF verification never enters the image parser");
    }
    for (const target of fs.readdirSync(releaseRoot)) {
      const manifestPath = path.join(releaseRoot, target, "release-manifest.json");
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath));
      const changed = new Map(manifest.changes.map(item => [item.path, item.afterSha256]));
      for (const item of manifest.baselineFiles) assert.equal(digest(fs.readFileSync(path.join(releaseRoot, target, "functions", item.path))), changed.get(item.path) || item.sha256);
      assert.equal(digest(fs.readFileSync(path.join(releaseRoot, target, "functions/rasterImageSafety.js"))), changed.get("rasterImageSafety.js"));
    }
  }
  console.log(`PASS ${verifyRelease ? "staged production" : "local"} raster image boundary: PNG/JPEG/WebP and legacy GIF/AVIF/TIFF conversion; SVG/XML/BOM/SVGZ rejection before native parser; upload failures add zero reads/writes and preserve lesson failure recovery.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
