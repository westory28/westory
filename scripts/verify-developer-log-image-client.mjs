/** Real browser compression and session-bound callables, using synthetic images only. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = "src/lib/developerLogImages.ts";
const source = await fs.readFile(path.join(root, sourcePath), "utf8");
assert(
  !/firebase\/storage|getFirebaseStorage/.test(source),
  "The image client must not use the direct Storage SDK",
);
const evidence =
  process.env.DEVELOPER_LOG_IMAGE_EVIDENCE_DIR ||
  path.join(root, "output/developer-log-image-client-20261114");
await fs.mkdir(evidence, { recursive: true });
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    process.env.PLAYWRIGHT_MODULE_PATH ||
      path.join(
        os.homedir(),
        ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
      ),
  );
}
const bundle = await build({
  stdin: {
    contents: `import * as client from './${sourcePath}'; window.imageClient = client;`,
    loader: "ts",
    resolveDir: root,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  metafile: true,
  plugins: [
    {
      name: "local-image-service-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /^firebase\/storage$/ }, () => ({
          errors: [
            { text: "Direct Storage SDK is forbidden in this client fixture" },
          ],
        }));
        builder.onResolve(
          { filter: /^\.\/(firebase|applicationSession|brandWatermark)$/ },
          ({ path: specifier, importer }) => {
            if (!importer.replaceAll("\\", "/").endsWith(sourcePath)) return;
            return { path: specifier, namespace: "image-client-local" };
          },
        );
        builder.onLoad(
          { filter: /.*/, namespace: "image-client-local" },
          ({ path: specifier }) => ({
            loader: "js",
            contents:
              specifier === "./firebase"
                ? "export const auth = window.imageQa.auth;"
                : specifier === "./applicationSession"
                  ? "export const callWithApplicationSession = (...args) => window.imageQa.invoke(...args);"
                  : `export const prepareBrandWatermark = async () => { window.imageQa.prepared++; if(window.imageQa.prepareHook) await window.imageQa.prepareHook(); };
               export const drawBrandWatermark = (ctx,width,height) => { window.imageQa.drawn++; ctx.fillStyle='#24567a';ctx.fillRect(width-8,height-8,4,4); };`,
          }),
        );
      },
    },
  ],
});
assert(
  !Object.keys(bundle.metafile.inputs).some((file) =>
    /node_modules[\\/](@firebase|firebase)/.test(file),
  ),
  "The fixture must not include a real Firebase SDK",
);
const server = http.createServer((req, res) => {
  if (req.url === "/client.js")
    return res
      .writeHead(200, { "Content-Type": "text/javascript" })
      .end(bundle.outputFiles[0].contents);
  if (req.url === "/favicon.ico") return res.writeHead(204).end();
  res
    .writeHead(200, { "Content-Type": "text/html" })
    .end(
      '<!doctype html><meta charset="utf-8"><script>window.imageQa={auth:{currentUser:null},calls:[],prepared:0,drawn:0};window.imageQa.invoke=async(name,payload,user)=>{const q=window.imageQa;q.calls.push({name,payload,user});if(!q.handler)throw Error("Unexpected callable");return q.handler(name,payload,user);};</script><script type="module" src="/client.js"></script>',
    );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({
  headless: true,
  channel:
    process.env.PLAYWRIGHT_BROWSER_CHANNEL ||
    (process.platform === "win32" ? "msedge" : undefined),
});
const blockedRequests = [],
  pageErrors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(origin + "/") || /^(blob:|data:)/.test(url))
      return route.continue();
    blockedRequests.push(url);
    return route.abort();
  });
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.imageClient));
  const result = await page.evaluate(async () => {
    const client = window.imageClient,
      qa = window.imageQa;
    const checks = [],
      owner = { uid: "synthetic-admin-a" },
      other = { uid: "synthetic-admin-b" };
    const metadata = {
      imageUrl: "https://synthetic.invalid/server.webp",
      imageStoragePath: "developer_log_images/server-owned/image.webp",
      imageByteSize: 4242,
      imageWidth: 777,
      imageHeight: 333,
      imageMimeType: "image/webp",
    };
    const assert = (condition, message) => {
      if (!condition) throw new Error(message);
    };
    const equal = (actual, expected, message) =>
      assert(JSON.stringify(actual) === JSON.stringify(expected), message);
    const fail = async (operation, label) => {
      let error;
      try {
        await operation();
      } catch (caught) {
        error = caught;
      }
      assert(error instanceof Error, label + " must reject");
      return error;
    };
    const until = async (predicate) => {
      const deadline = Date.now() + 10000;
      while (!predicate()) {
        assert(Date.now() < deadline, "Synthetic gate did not open");
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    };
    const reset = () => {
      qa.auth.currentUser = owner;
      qa.calls.length = 0;
      qa.prepared = 0;
      qa.drawn = 0;
      qa.prepareHook = null;
      qa.handler = async () => ({ data: metadata });
    };
    const bitmapFile = async (width, height) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#8cbccf");
      gradient.addColorStop(1, "#e7af92");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#365477";
      ctx.fillRect(width / 5, height / 4, width / 2, height / 3);
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      return new File([blob], "synthetic.png", { type: "image/png" });
    };
    const large = await bitmapFile(2048, 1280),
      small = await bitmapFile(96, 64);
    const upload = (file = small) =>
      client.uploadDeveloperLogImage({
        postId: "synthetic-post-20261114",
        file,
      });
    let encoded;

    reset();
    qa.handler = async (name, payload, user) => {
      assert(
        name === "uploadDeveloperLogImageContent",
        "Upload must use the authenticated upload callable",
      );
      assert(user === owner, "The callable must receive the captured user");
      assert(
        qa.prepared > 0 && qa.drawn > 0,
        "Compression and watermark preparation must precede upload",
      );
      equal(
        Object.keys(payload).sort(),
        ["contentType", "imageBase64", "postId"],
        "Unexpected upload payload fields",
      );
      assert(
        payload.postId === "synthetic-post-20261114",
        "The upload must preserve postId",
      );
      assert(
        typeof payload.imageBase64 === "string" &&
          /^[A-Za-z0-9+/]+={0,2}$/.test(payload.imageBase64),
        "Upload requires plain base64, without a data URL prefix",
      );
      assert(
        payload.contentType === "image/webp",
        "The synthetic PNG must be compressed to WebP",
      );
      const bytes = Uint8Array.from(atob(payload.imageBase64), (character) =>
        character.charCodeAt(0),
      );
      assert(
        bytes.length > 0 && bytes.length <= 700 * 1024,
        "Compressed image exceeds the client limit",
      );
      const image = await createImageBitmap(
        new Blob([bytes], { type: payload.contentType }),
      );
      assert(
        image.width <= 1280 && image.height <= 1600 && image.width < 2048,
        "Real browser compression must reduce the large bitmap within limits",
      );
      encoded = {
        byteSize: bytes.length,
        width: image.width,
        height: image.height,
        contentType: payload.contentType,
      };
      image.close();
      return { data: metadata };
    };
    equal(
      await upload(large),
      metadata,
      "Use every server metadata field without replacing it with local estimates",
    );
    assert(
      qa.calls.length === 1,
      "A successful upload must make exactly one callable request",
    );
    checks.push({
      name: "real bitmap compression, one upload, exact payload and server metadata",
      calls: qa.calls.length,
    });

    reset();
    await fail(
      () => upload(new File(["plain"], "plain.txt", { type: "text/plain" })),
      "Non-image input",
    );
    assert(qa.calls.length === 0, "Rejected input must not upload");
    await fail(
      () =>
        upload(new File(["not an image"], "broken.png", { type: "image/png" })),
      "Undecodable bitmap",
    );
    assert(qa.calls.length === 0, "Decode failures must not upload");
    checks.push({
      name: "invalid image and decode failures propagate",
      calls: 0,
    });

    reset();
    const uploadError = Object.assign(new Error("synthetic upload denied"), {
      code: "functions/permission-denied",
    });
    qa.handler = async () => {
      throw uploadError;
    };
    assert(
      (await fail(() => upload(), "Callable upload error")) === uploadError,
      "Upload error must propagate intact",
    );
    assert(
      qa.calls.length === 1,
      "A failed upload must not silently retry or use Storage",
    );
    checks.push({ name: "upload callable failure propagates", calls: 1 });

    reset();
    qa.auth.currentUser = null;
    await fail(() => upload(), "Signed-out upload");
    assert(
      qa.calls.length === 0,
      "Signed-out upload must not reach the service",
    );
    checks.push({ name: "signed-out upload blocked", calls: 0 });

    reset();
    qa.prepareHook = () => {
      qa.auth.currentUser = other;
    };
    await fail(() => upload(), "Account change during compression");
    assert(
      qa.calls.length === 0,
      "A changed account must be blocked before upload",
    );
    checks.push({
      name: "account change during compression blocked before request",
      calls: 0,
    });

    reset();
    let releaseUpload;
    qa.handler = () =>
      new Promise((resolve) => {
        releaseUpload = resolve;
      });
    const pendingUpload = upload();
    await until(() => releaseUpload);
    qa.auth.currentUser = other;
    releaseUpload({ data: metadata });
    await fail(() => pendingUpload, "Account change after upload request");
    assert(
      qa.calls.length === 1 && qa.calls[0].user === owner,
      "An in-flight request belongs only to its original account",
    );
    checks.push({ name: "old account upload response blocked", calls: 1 });

    reset();
    qa.prepareHook = () => {
      qa.auth.currentUser = null;
    };
    await fail(() => upload(), "Logout during compression");
    assert(
      qa.calls.length === 0,
      "Logout during compression must prevent upload",
    );
    checks.push({ name: "logout during preparation blocked", calls: 0 });

    reset();
    qa.auth.currentUser = other;
    equal(
      await upload(),
      metadata,
      "A new account must be able to perform its own fresh upload",
    );
    assert(
      qa.calls.length === 1 && qa.calls[0].user === other,
      "Recovery must use the new user, not an earlier captured owner",
    );
    checks.push({
      name: "fresh account upload recovers after rejected stale requests",
      calls: 1,
    });

    reset();
    qa.auth.currentUser = null;
    for (const value of [undefined, null, "", " \t\n "])
      assert(
        (await client.tryDeleteDeveloperLogImage(value)) === false,
        "Missing image path must return false",
      );
    assert(qa.calls.length === 0, "Missing paths must make zero delete calls");
    checks.push({ name: "missing delete paths do nothing", calls: 0 });

    reset();
    qa.handler = async (name, payload, user) => {
      assert(
        name === "deleteDeveloperLogImageContent",
        "Delete must use its authenticated callable",
      );
      equal(
        payload,
        { storagePath: "developer_log_images/synthetic/image.webp" },
        "Delete must forward only the trimmed server path",
      );
      assert(user === owner, "Delete must capture the current account");
      return { data: { deleted: true } };
    };
    assert(
      (await client.tryDeleteDeveloperLogImage(
        "  developer_log_images/synthetic/image.webp  ",
      )) === true,
      "Successful delete must return true",
    );
    assert(qa.calls.length === 1, "Delete must make one request");
    checks.push({ name: "delete callable and normalized payload", calls: 1 });

    reset();
    qa.handler = async () => ({ data: { deleted: false } });
    assert(
      (await client.tryDeleteDeveloperLogImage(
        "developer_log_images/missing.webp",
      )) === false,
      "Server deletion status must be respected",
    );
    assert(qa.calls.length === 1, "No-op server delete must not retry");
    checks.push({ name: "server false deletion result preserved", calls: 1 });

    reset();
    qa.handler = async () => {
      throw new Error("synthetic delete failure");
    };
    assert(
      (await client.tryDeleteDeveloperLogImage(
        "developer_log_images/error.webp",
      )) === false,
      "Delete failure must return false",
    );
    assert(qa.calls.length === 1, "Delete failure must not silently retry");
    checks.push({ name: "delete service failure returns false", calls: 1 });

    reset();
    qa.auth.currentUser = null;
    assert(
      (await client.tryDeleteDeveloperLogImage(
        "developer_log_images/private.webp",
      )) === false,
      "Signed-out deletion must fail safely",
    );
    assert(
      qa.calls.length === 0,
      "Signed-out deletion must not reach the service",
    );
    checks.push({ name: "signed-out delete blocked", calls: 0 });

    reset();
    let releaseDelete;
    qa.handler = () =>
      new Promise((resolve) => {
        releaseDelete = resolve;
      });
    const pendingDelete = client.tryDeleteDeveloperLogImage(
      "developer_log_images/old-account.webp",
    );
    await until(() => releaseDelete);
    qa.auth.currentUser = other;
    releaseDelete({ data: { deleted: true } });
    assert(
      (await pendingDelete) === false,
      "A stale account delete response must not report success",
    );
    assert(
      qa.calls.length === 1 && qa.calls[0].user === owner,
      "In-flight deletion must retain its original owner",
    );
    checks.push({ name: "old account deletion response blocked", calls: 1 });
    return { checks, encoded, syntheticImagesOnly: true };
  });
  assert.deepEqual(
    blockedRequests,
    [],
    "The client attempted nonlocal networking",
  );
  assert.deepEqual(pageErrors, [], "Unexpected browser runtime error");
  const report = {
    passed: true,
    source: sourcePath,
    sourceSha256: createHash("sha256")
      .update(source.replaceAll("\r\n", "\n"))
      .digest("hex"),
    ...result,
    externalRequests: blockedRequests.length,
    directStorageSdk: false,
  };
  await fs.writeFile(
    path.join(evidence, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      passed: true,
      checks: result.checks.length,
      encoded: result.encoded,
      externalRequests: 0,
      evidence,
    }),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
