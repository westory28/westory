import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Use generation-pinned production snapshots. This script prepares local bundles only.
// It never deploys, replaces a production index/package, or changes runtime settings.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const audit = path.resolve(
  root,
  process.argv[2] || "output/avatar-shop-20261114/release-audit",
);
const baselineCommit = process.argv[3];
const patchRoot = path.resolve(process.argv[4] || root);
const wardrobeRelease = process.argv.includes("--wardrobe");
const eventRelease = process.argv.includes("--event");
const polishRelease = process.argv.includes("--polish") || eventRelease;
assert.ok(!(wardrobeRelease && polishRelease), "Choose one release mode");
assert.match(
  baselineCommit || "",
  /^[a-f0-9]{40}$/,
  "Pass the explicit pre-change source baseline commit",
);
const readJson = async (file) =>
  JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const normalized = (value) => value.replace(/\r\n/g, "\n");
const relative = (base, file) =>
  path.relative(base, file).replaceAll("\\", "/");
const walk = async (directory) => {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    assert.ok(
      !entry.isSymbolicLink(),
      "Source snapshots must not contain links",
    );
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(file)));
    else result.push(file);
  }
  return result.sort();
};
const avatarTargets = new Set([
  "getStudentAvatar",
  "getAvatarStudioState",
  "purchaseStudentAvatarItem",
  "saveStudentAvatar",
  "getTeacherMyPage",
  "saveTeacherAvatar",
]);
const pricingTargets = new Set([
  "getAvatarCatalogPricing",
  "updateAvatarCatalogPricing",
]);
const projectionTargets = new Set([
  "getWisRankingPreview",
  "getWisEconomyState",
  "getWisEconomyStateFast",
]);
const eventTargets = new Set(["getGongsinmoongo", "manageGongsinmoongo"]);
const deletionHandler = (text) => {
  const start = text.indexOf("const createStudentAvatarDeletionHandler =");
  const end = text.indexOf("\nmodule.exports =", start);
  assert.ok(start > 0 && end > start, "Expected isolated avatar deletion handler");
  return { start, end, text: text.slice(start, end) };
};
const baselineFilesFor = (mode) =>
  mode === "event"
    ? ["gongsinmoongo.js", "studentMenuVisibility.js"]
    : mode === "cleanup"
      ? []
      : mode === "projection"
    ? ["avatarCatalog.json", "studentAvatarCatalog.js"]
    : mode === "pricing"
      ? [
          "avatarCatalog.json",
          "studentAvatarCatalog.js",
          "avatarCatalogPricing.js",
        ]
      : [
          "avatarCatalog.json",
          "studentAvatarCatalog.js",
          "avatarCatalogPricing.js",
          "studentAvatar.js",
        ];
const filesFor = (mode) =>
  mode === "event"
    ? ["avatarEvent.js", "gongsinmoongo.js", "avatarCatalog.json", "studentAvatarCatalog.js", "studentWisWallet.js"]
    : mode === "cleanup"
      ? ["studentAvatar.js"]
      : polishRelease
    ? mode === "avatar"
      ? ["avatarCatalog.json", "studentAvatarCatalog.js", "studentAvatar.js"]
      : ["avatarCatalog.json", "studentAvatarCatalog.js"]
    : wardrobeRelease
      ? mode === "avatar"
        ? ["avatarCatalog.json", "studentAvatar.js"]
        : ["avatarCatalog.json"]
      : baselineFilesFor(mode);
const groups = new Map();
const sourceMap = [];
const metadataFiles = (await fs.readdir(path.join(audit, "metadata")))
  .filter((file) => file.endsWith(".json"))
  .sort();
for (const filename of metadataFiles) {
  const target = filename.slice(0, -5),
    [name, region] = target.split("--");
  const mode = avatarTargets.has(name)
    ? "avatar"
    : pricingTargets.has(name)
      ? "pricing"
      : projectionTargets.has(name)
        ? "projection"
        : eventRelease && eventTargets.has(name)
          ? "event"
          : eventRelease && name === "cleanupStudentAvatarOnUserDelete"
            ? "cleanup"
            : null;
  assert.ok(
    mode && ["us-central1", "asia-northeast3"].includes(region),
    `Unexpected target: ${target}`,
  );
  const metadata = await readJson(path.join(audit, "metadata", filename));
  assert.equal(
    metadata.name,
    `projects/history-quiz-yongsin/locations/${region}/functions/${name}`,
  );
  assert.equal(metadata.state, "ACTIVE", target);
  assert.equal(metadata.buildConfig.runtime, "nodejs22", target);
  const source = path.join(audit, "originals", target);
  const baseline = await Promise.all(
    (await walk(source)).map(async (file) => ({
      path: relative(source, file),
      sha256: sha(await fs.readFile(file)),
    })),
  );
  // Whole-file transplant is allowed only after matching the original to the reviewed baseline.
  for (const file of baselineFilesFor(mode)) {
    const expected = execFileSync(
      "git",
      ["show", `${baselineCommit}:functions/${file}`],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(
      normalized(await fs.readFile(path.join(source, file), "utf8")),
      normalized(expected),
      `Unreviewed production difference: ${target}/${file}`,
    );
  }
  const key = `${mode}-${sha(JSON.stringify(baseline)).slice(0, 12)}`;
  if (!groups.has(key))
    groups.set(key, { name: key, mode, source, baseline, targets: [] });
  groups.get(key).targets.push({
    name,
    region,
    metadata: filename,
    sourceArchiveSha256: sha(await fs.readFile(`${source}.zip`)),
  });
  sourceMap.push({ target, source: target, metadata: filename });
}
assert.equal(
  sourceMap.length,
  eventRelease ? 15 : 12,
  "Every reviewed deployed target, including both getWisEconomyState regions, must be audited",
);
await fs.writeFile(
  path.join(audit, "source-map.json"),
  JSON.stringify(sourceMap, null, 2) + "\n",
);
if (process.argv.includes("--audit-only")) {
  console.log(
    JSON.stringify(
      {
        passed: true,
        targets: sourceMap.length,
        groups: [...groups.values()].map((group) => ({
          name: group.name,
          mode: group.mode,
          files: group.baseline.length,
          targets: group.targets.map(
            (target) => `${target.name}--${target.region}`,
          ),
        })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const probe = `
  const functions = require(process.argv[1]);
  const names = JSON.parse(process.argv[2]);
  const result = Object.fromEntries(names.map(name => {
    if (typeof functions[name] !== 'function' || !functions[name].__endpoint) throw Error('Missing callable export: ' + name);
    return [name, functions[name].__endpoint];
  }));
  process.stdout.write(JSON.stringify(result));
`;
const report = [];
for (const group of groups.values()) {
  const directory = path.join(audit, "releases", group.name),
    destination = path.join(directory, "functions");
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(group.source, destination, {
    recursive: true,
    force: true,
    filter: (file) => path.basename(file) !== "node_modules",
  });
  const allowed = filesFor(group.mode);
  if (group.mode === "cleanup") {
    const file = path.join(destination, "studentAvatar.js");
    const original = normalized(await fs.readFile(file, "utf8"));
    const before = deletionHandler(original);
    const baseline = normalized(execFileSync("git", ["show", `${baselineCommit}:functions/studentAvatar.js`], { cwd: root, encoding: "utf8" }));
    assert.equal(before.text, deletionHandler(baseline).text, "Unreviewed production cleanup handler difference");
    const after = deletionHandler(normalized(await fs.readFile(path.join(patchRoot, "functions/studentAvatar.js"), "utf8")));
    await fs.writeFile(file, original.slice(0, before.start) + after.text + original.slice(before.end));
  } else {
    for (const file of allowed)
      await fs.copyFile(path.join(patchRoot, "functions", file), path.join(destination, file));
  }
  if (group.mode === "event") {
    // The production Q&A archive predates the current canonical wallet's loaded
    // snapshot guard. Upgrade that exact reviewed dependency, not the live index.
    const wallet = normalized(await fs.readFile(path.join(patchRoot, "functions/studentWisWallet.js"), "utf8"));
    assert.equal(wallet, normalized(execFileSync("git", ["show", `${baselineCommit}:functions/studentWisWallet.js`], { cwd: root, encoding: "utf8" })));
  }
  const changes = [];
  for (const before of group.baseline) {
    const after = sha(await fs.readFile(path.join(destination, before.path)));
    if (after !== before.sha256)
      changes.push({ path: before.path, before: before.sha256, after });
  }
  const added = allowed.filter(file => !group.baseline.some(entry => entry.path === file));
  assert.deepEqual(added, group.mode === "event" ? ["avatarEvent.js"] : []);
  for (const file of added) changes.push({ path: file, before: null, after: sha(await fs.readFile(path.join(destination, file))) });
  assert.deepEqual(
    changes.map((entry) => entry.path).sort(),
    allowed.slice().sort(),
    "Only the reviewed avatar files may change",
  );
  assert.deepEqual(
    (await walk(destination)).map((file) => relative(destination, file)),
    [...group.baseline.map((entry) => entry.path), ...added].sort(),
  );
  for (const file of allowed.filter((file) => file.endsWith(".js")))
    execFileSync(process.execPath, ["--check", path.join(destination, file)]);
  const names = [...new Set(group.targets.map((target) => target.name))];
  const nodeEnvironment = {
    ...process.env,
    GCLOUD_PROJECT: "demo-westory-avatar-release",
    GOOGLE_CLOUD_PROJECT: "demo-westory-avatar-release",
    NODE_PATH: path.join(root, "functions/node_modules"),
  };
  const endpoints = JSON.parse(
    execFileSync(
      process.execPath,
      ["-e", probe, path.join(destination, "index.js"), JSON.stringify(names)],
      { env: nodeEnvironment, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    ),
  );
  const originalEndpoints = JSON.parse(
    execFileSync(
      process.execPath,
      ["-e", probe, path.join(group.source, "index.js"), JSON.stringify(names)],
      { env: nodeEnvironment, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    ),
  );
  assert.deepEqual(
    endpoints,
    originalEndpoints,
    "Callable declarations/runtime options must remain identical",
  );
  for (const target of group.targets) {
    assert.ok(
      endpoints[target.name].region.includes(target.region),
      `Missing production region: ${target.name}--${target.region}`,
    );
    if (target.name === "getWisEconomyState")
      assert.deepEqual([...endpoints[target.name].region].sort(), [
        "asia-northeast3",
        "us-central1",
      ]);
  }
  await fs.writeFile(
    path.join(directory, "firebase.json"),
    JSON.stringify(
      {
        functions: {
          source: "functions",
          codebase: "default",
          ignore: [
            "node_modules",
            ".git",
            "firebase-debug.log",
            "firebase-debug.*.log",
          ],
        },
      },
      null,
      2,
    ) + "\n",
  );
  const deploymentCommand = `firebase deploy --only "${names.map((name) => `functions:${name}`).join(",")}" --project history-quiz-yongsin --config firebase.json`;
  const manifest = {
    name: group.name,
    patchKind: eventRelease ? "event" : polishRelease ? "polish" : wardrobeRelease ? "wardrobe" : "shop",
    baselineCommit,
    patchRoot,
    targets: group.targets,
    changes,
    baselineFiles: group.baseline,
    callableDeclarations: endpoints,
    preserved: [
      "index.js and all exports",
      "package.json and package-lock.json",
      "runtime declarations",
      "all unrelated source files and session/role authorization",
    ],
    ...(group.mode === "event" ? { dependencyUpgrades: ["v2 avatar catalog/sanitizer for saved snapshot validation", "current reviewed canonical studentWisWallet snapshot guard"], addedFiles: added } : {}),
    ...(group.mode === "cleanup" ? { partialTransplants: ["studentAvatar.js:createStudentAvatarDeletionHandler only"] } : {}),
    deploymentCommand,
  };
  await fs.writeFile(
    path.join(directory, "release-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  report.push({
    group: group.name,
    mode: group.mode,
    directory,
    targets: group.targets.map((target) => `${target.name}--${target.region}`),
    changedFiles: changes.map((entry) => entry.path),
    preservedFiles: group.baseline.length - changes.length,
    deploymentCommand,
  });
}
await fs.writeFile(
  path.join(audit, "prepared-release.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
