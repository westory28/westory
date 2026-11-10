// One-time, idempotent launch publication. Default is read-only dry-run.
// Authentication uses the operator's existing gcloud session; never print tokens.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const requireFunction = createRequire(
  path.join(repositoryRoot, "functions/package.json"),
);
const sharp = requireFunction("sharp");
const project = "history-quiz-yongsin";
const origin = "https://www.westory.kr";
const database = `projects/${project}/databases/(default)/documents`;
const endpoint = `https://firestore.googleapis.com/v1/${database}`;
const manifest = JSON.parse(
  fs.readFileSync(
    path.join(repositoryRoot, "scripts/content/gongsinmoongo-launch.json"),
    "utf8",
  ),
);
const apply = process.argv.includes("--apply");
const offline = process.argv.includes("--offline");
const reportDirectory = path.join(
  repositoryRoot,
  "output/gongsinmoongo-launch-20261110",
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const decode = (value) =>
  value.stringValue ??
  (value.integerValue !== undefined ? Number(value.integerValue) : undefined) ??
  value.doubleValue ??
  value.booleanValue ??
  value.timestampValue ??
  (value.arrayValue
    ? (value.arrayValue.values || []).map(decode)
    : undefined) ??
  (value.mapValue ? unpack(value.mapValue) : null);
const unpack = (document) =>
  Object.fromEntries(
    Object.entries(document.fields || {}).map(([key, value]) => [
      key,
      decode(value),
    ]),
  );
const encode = (value) =>
  value === null
    ? { nullValue: null }
    : Array.isArray(value)
      ? { arrayValue: { values: value.map(encode) } }
      : typeof value === "string"
        ? { stringValue: value }
        : typeof value === "boolean"
          ? { booleanValue: value }
          : typeof value === "number"
            ? Number.isInteger(value)
              ? { integerValue: String(value) }
              : { doubleValue: value }
            : { mapValue: { fields: pack(value) } };
const pack = (value) =>
  Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, encode(entry)]),
  );
const select = (...fields) => ({
  fields: fields.map((fieldPath) => ({ fieldPath })),
});
const equal = (fieldPath, value) => ({
  fieldFilter: { field: { fieldPath }, op: "EQUAL", value: encode(value) },
});

async function main() {
  if (apply && offline)
    throw new Error("--offline and --apply cannot be combined.");
  const publicDirectory = path.join(
    repositoryRoot,
    "public",
    manifest.publicRoot,
  );
  const assets = await Promise.all(
    [manifest.cover, ...manifest.panels].map(async (item) => {
      if (!/^[a-z0-9-]+\.webp$/.test(item.file))
        throw new Error("Invalid asset filename.");
      const bytes = fs.readFileSync(path.join(publicDirectory, item.file));
      const metadata = await sharp(bytes).metadata();
      if (metadata.format !== "webp" || !metadata.width || !metadata.height)
        throw new Error(`Invalid WebP: ${item.file}`);
      if (
        metadata.width > 1600 ||
        metadata.height > 2400 ||
        bytes.length > 3 * 1024 * 1024
      )
        throw new Error(`Oversized asset: ${item.file}`);
      return {
        ...item,
        width: metadata.width,
        height: metadata.height,
        bytes: bytes.length,
        sha256: hash(bytes),
        url: `${origin}${manifest.publicRoot}/${item.file}`,
      };
    }),
  );
  const [cover, ...panels] = assets;
  if (cover.width !== 1200 || cover.height !== 675)
    throw new Error("The notice cover must be 1200×675.");
  const imageHtml = (asset) =>
    `<img src="${escapeHtml(asset.url)}" width="${asset.width}" height="${asset.height}" alt="${escapeHtml(asset.alt)}">`;
  const bodyHtml = `<article class="westory-event-article we-notice-images we-notice-images--reopen" aria-label="${escapeHtml(manifest.title)}">\n<figure class="we-notice-images__cover">${imageHtml(cover)}</figure>\n<section class="we-notice-images__details">${panels.map((asset) => `<figure>${imageHtml(asset)}</figure>`).join("\n")}</section>\n</article>`;
  fs.mkdirSync(reportDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(reportDirectory, "article-preview.html"),
    bodyHtml,
  );
  const assetReport = assets.map(({ file, width, height, bytes, sha256 }) => ({
    file,
    width,
    height,
    bytes,
    sha256,
  }));
  if (offline) {
    console.log(
      JSON.stringify(
        {
          mode: "offline",
          postId: manifest.postId,
          assets: assetReport,
          bodySha256: hash(bodyHtml),
        },
        null,
        2,
      ),
    );
    return;
  }

  const accessToken = execSync("gcloud auth print-access-token", {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const api = async (suffix, payload, allowMissing = false) => {
    const response = await fetch(endpoint + suffix, {
      method: payload ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok)
      throw new Error(
        `Firestore request failed (${response.status}); nothing in the response is logged.`,
      );
    return response.json();
  };
  const query = async (parent, structuredQuery) =>
    (await api(`${parent}:runQuery`, { structuredQuery })).flatMap((row) =>
      row.document ? [row.document] : [],
    );
  const configDocument = await api(
    "/site_settings/config?mask.fieldPaths=year&mask.fieldPaths=semester",
  );
  const config = unpack(configDocument);
  const semesterId = `${config.year}-${config.semester}`;
  const scope = `/years/${config.year}/semesters/${config.semester}`;
  const postPath = `/site_settings/developer_logs/items/${manifest.postId}`;
  const noticePath = `${scope}/notices/${manifest.noticeId}`;
  const [
    activeDocument,
    semesterDocument,
    settingsDocument,
    publicDocument,
    authorDocuments,
    anchors,
    existingPost,
    existingNotice,
  ] = await Promise.all([
    api("/site_settings/semester_active"),
    api(`/semester_manifests/${semesterId}`),
    api(`${scope}/gongsinmoongo_config/settings`, undefined, true),
    api(`${scope}/gongsinmoongo_config/public`, undefined, true),
    query("", {
      from: [{ collectionId: "users" }],
      where: equal("email", "westoria28@gmail.com"),
      select: select("email", "role", "name", "displayName"),
      limit: 2,
    }),
    query(scope, {
      from: [{ collectionId: "notices" }],
      where: equal("developerLogPostId", manifest.afterPostId),
      select: select("noticeOrder", "targetType", "publishAt", "imageUrl"),
      limit: 2,
    }),
    api(postPath, undefined, true),
    api(noticePath, undefined, true),
  ]);
  const active = unpack(activeDocument);
  const semester = unpack(semesterDocument);
  if (
    active.semesterId !== semesterId ||
    semester.status !== "ACTIVE" ||
    semester.readOnly === true ||
    active.revision !== semester.revision
  )
    throw new Error("Active semester changed or is read-only.");
  if (
    authorDocuments.length !== 1 ||
    unpack(authorDocuments[0]).role !== "teacher"
  )
    throw new Error("The launch author did not resolve to one teacher.");
  if (anchors.length !== 1)
    throw new Error("The core-point notice did not resolve uniquely.");
  const anchorDocument = anchors[0];
  const anchor = unpack(anchorDocument);
  if (
    !Number.isFinite(anchor.noticeOrder) ||
    anchor.targetType !== "common" ||
    !anchor.imageUrl ||
    (anchor.publishAt && Date.parse(anchor.publishAt) > Date.now())
  )
    throw new Error(
      "The core-point notice is not a published common image with explicit ordering.",
    );
  const [sameOrder, following] = await Promise.all([
    query(scope, {
      from: [{ collectionId: "notices" }],
      where: equal("noticeOrder", anchor.noticeOrder),
      select: select("noticeOrder"),
      limit: 2,
    }),
    query(scope, {
      from: [{ collectionId: "notices" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "noticeOrder" },
          op: "GREATER_THAN",
          value: encode(anchor.noticeOrder),
        },
      },
      orderBy: [
        { field: { fieldPath: "noticeOrder" }, direction: "ASCENDING" },
      ],
      select: select("noticeOrder"),
      limit: 2,
    }),
  ]);
  if (sameOrder.length !== 1)
    throw new Error(
      "The core-point notice has a tied order; resolve it before publication.",
    );
  const nextDocument = following.find(
    (document) => document.name !== `${database}${noticePath}`,
  );
  const nextOrder = nextDocument
    ? unpack(nextDocument).noticeOrder
    : anchor.noticeOrder + 2;
  const noticeOrder = (anchor.noticeOrder + nextOrder) / 2;
  if (!(noticeOrder > anchor.noticeOrder && noticeOrder < nextOrder))
    throw new Error("No stable ordering gap is available.");
  const settings = settingsDocument ? unpack(settingsDocument) : {};
  const publicSettings = publicDocument ? unpack(publicDocument) : {};
  const featureEnabled =
    settings.enabled === true &&
    publicSettings.enabled === true &&
    settings.revision === publicSettings.revision;
  const authorDocument = authorDocuments[0];
  const author = unpack(authorDocument);
  const postData = {
    title: manifest.title,
    version: "",
    category: manifest.category,
    summary: "",
    bodyHtml,
    images: [],
    isPinned: false,
    viewCount: 0,
    likeCount: 0,
    createdBy: authorDocument.name.split("/").at(-1),
    createdByName: author.name || author.displayName || "방재석",
  };
  const noticeData = {
    targetType: "common",
    targetClass: "",
    category: "normal",
    content: manifest.noticeContent,
    imageUrl: cover.url,
    imageStoragePath: "",
    imageWidth: cover.width,
    imageHeight: cover.height,
    imageByteSize: cover.bytes,
    imageMimeType: "image/webp",
    noticeOrder,
    developerLogPostId: manifest.postId,
    createdBy: postData.createdBy,
  };
  const report = {
    mode: apply ? "apply" : "dry-run",
    scope: semesterId,
    featureEnabled,
    postId: manifest.postId,
    noticeId: manifest.noticeId,
    afterPostId: manifest.afterPostId,
    noticeOrder,
    existing: Boolean(existingPost || existingNotice),
    assets: assetReport,
    bodySha256: hash(bodyHtml),
    postUrl: `${origin}/#/developer-log/${manifest.postId}`,
  };

  if (existingPost || existingNotice) {
    if (!existingPost || !existingNotice)
      throw new Error(
        "Partial existing publication found; inspect before retrying.",
      );
    const post = unpack(existingPost);
    const notice = unpack(existingNotice);
    if (
      post.title !== postData.title ||
      post.category !== postData.category ||
      post.bodyHtml !== bodyHtml ||
      Object.entries(noticeData).some(([key, value]) => notice[key] !== value)
    )
      throw new Error(
        "An existing publication differs; do not overwrite editorial changes.",
      );
    console.log(
      JSON.stringify(
        { ...report, mode: "already-published", writes: 0 },
        null,
        2,
      ),
    );
    return;
  }
  console.log(JSON.stringify(report, null, 2));
  fs.writeFileSync(
    path.join(reportDirectory, "publication-plan.json"),
    JSON.stringify(report, null, 2),
  );
  if (!apply) return;
  if (!featureEnabled)
    throw new Error(
      "The feature is not enabled consistently; publish only after live feature verification.",
    );
  for (const asset of assets) {
    const response = await fetch(asset.url, { cache: "no-store" });
    if (
      !response.ok ||
      hash(Buffer.from(await response.arrayBuffer())) !== asset.sha256
    )
      throw new Error(`Production asset does not match: ${asset.file}`);
  }
  const timestamps = (fields) =>
    fields.map((fieldPath) => ({
      fieldPath,
      setToServerValue: "REQUEST_TIME",
    }));
  const verifyDocuments = [
    configDocument,
    activeDocument,
    semesterDocument,
    authorDocument,
    anchorDocument,
    settingsDocument,
    publicDocument,
    nextDocument,
  ].filter(Boolean);
  const writes = verifyDocuments.map((document) => ({
    verify: document.name,
    currentDocument: { updateTime: document.updateTime },
  }));
  writes.push({
    update: { name: `${database}${postPath}`, fields: pack(postData) },
    currentDocument: { exists: false },
    updateTransforms: timestamps(["createdAt", "updatedAt", "publishedAt"]),
  });
  writes.push({
    update: { name: `${database}${noticePath}`, fields: pack(noticeData) },
    currentDocument: { exists: false },
    updateTransforms: timestamps(["createdAt", "updatedAt", "publishAt"]),
  });
  const commit = await api(":commit", { writes });
  const [publishedPost, publishedNotice] = await Promise.all([
    api(postPath),
    api(noticePath),
  ]);
  if (
    unpack(publishedPost).bodyHtml !== bodyHtml ||
    unpack(publishedNotice).developerLogPostId !== manifest.postId ||
    unpack(publishedNotice).noticeOrder !== noticeOrder
  )
    throw new Error(
      "Publication committed but read-back verification did not match.",
    );
  const finalReport = {
    ...report,
    mode: "published",
    commitTime: commit.commitTime,
    writes: 2,
    existingNoticeWrites: 0,
  };
  fs.writeFileSync(
    path.join(reportDirectory, "publication-result.json"),
    JSON.stringify(finalReport, null, 2),
  );
  console.log(JSON.stringify(finalReport, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
