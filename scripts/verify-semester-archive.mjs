import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import ts from "typescript";
import { resolveConfig } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const blocked = (error) => error?.code === "archive/read-only";
const firestoreWrites = [
  "addDoc",
  "setDoc",
  "updateDoc",
  "deleteDoc",
  "writeBatch",
  "runTransaction",
  "executeWrite",
];
const storageWrites = [
  "uploadBytes",
  "uploadBytesResumable",
  "uploadString",
  "deleteObject",
  "updateMetadata",
];
const authWrites = [
  "signOut",
  "signInAnonymously",
  "signInWithCredential",
  "signInWithCustomToken",
  "signInWithEmailAndPassword",
  "signInWithEmailLink",
  "signInWithPhoneNumber",
  "signInWithPopup",
  "signInWithRedirect",
  "getRedirectResult",
  "createUserWithEmailAndPassword",
  "deleteUser",
  "updateCurrentUser",
  "updateEmail",
  "updatePassword",
  "updatePhoneNumber",
  "updateProfile",
  "verifyBeforeUpdateEmail",
  "applyActionCode",
  "confirmPasswordReset",
  "sendEmailVerification",
  "sendPasswordResetEmail",
  "sendSignInLinkToEmail",
  "revokeAccessToken",
  "linkWithCredential",
  "linkWithPhoneNumber",
  "linkWithPopup",
  "linkWithRedirect",
  "unlink",
  "reauthenticateWithCredential",
  "reauthenticateWithPhoneNumber",
  "reauthenticateWithPopup",
  "reauthenticateWithRedirect",
];

async function checkRuntime(mode, directory) {
  // Fresh processes are essential: archive mode is captured once at module load.
  globalThis.window = {
    location: {
      search:
        mode === "archive"
          ? "?archiveYear=2025&archiveSemester=1"
          : mode === "malformed"
            ? "?archiveYear=invalid"
            : "",
    },
  };
  // No network operation is needed to construct references. Fail immediately
  // if a future test accidentally starts an HTTP transport.
  globalThis.fetch = () => {
    throw new Error("Network is forbidden in this test");
  };
  const load = (name) =>
    import(pathToFileURL(join(directory, `${name}.mjs`)).href);
  const [f, s, a, archive, raw, { initializeApp }] = await Promise.all([
    load("archiveFirestore"),
    load("archiveStorage"),
    load("archiveAuth"),
    load("semesterArchive"),
    import("@firebase/firestore"),
    import("@firebase/app"),
  ]);
  const db = raw.getFirestore(
    initializeApp({ projectId: "demo-archive-verification" }, mode),
  );
  try {
    assert.equal(archive.isSemesterArchive, mode !== "normal");
    if (mode !== "normal") {
      for (const [module, names] of [
        [f, firestoreWrites],
        [s, storageWrites],
        [a, authWrites],
      ]) {
        for (const name of names) {
          // Intentionally invalid arguments: the archive guard must run before
          // SDK validation, task creation, or any chance of contacting a server.
          assert.throws(() => module[name](), blocked, name);
        }
      }
      assert.throws(() => new f.WriteBatch(), blocked);
      assert.throws(() => new f.Transaction(), blocked);
      assert.throws(() => f.collectionGroup(db, "lessons"));
      window.location.search = "";
      assert.throws(
        () => f.setDoc(),
        blocked,
        "Removing URL text must not unlock an open archive",
      );
    }
    if (mode === "malformed") {
      assert.equal(archive.archiveScope, null);
      assert.throws(() => f.doc(db, "settings/semester"));
      assert.throws(() => f.collection(db, "lessons"));
    } else {
      const prefix =
        mode === "archive"
          ? "years/2025/semesters/1"
          : "years/2026/semesters/2";
      const document = f.doc(db, "years/2026/semesters/2/lessons/a");
      assert.ok(document instanceof raw.DocumentReference);
      assert.equal(document.path, `${prefix}/lessons/a`);
      assert.equal(
        f.collection(db, "years", "2026", "semesters", "2", "lessons").path,
        `${prefix}/lessons`,
      );
      const parent = f.doc(db, "years/2026/semesters/2");
      const children = f.collection(parent, "lessons");
      assert.equal(children.path, `${prefix}/lessons`);
      assert.equal(f.doc(children, "a").path, `${prefix}/lessons/a`);
      const generated = f.doc(children);
      assert.equal(generated.parent.path, children.path);
      assert.equal(generated.id.length, 20);
      assert.equal(f.doc(db, "settings/semester").path, "settings/semester");
      assert.equal(f.doc(db, "users/teacher").path, "users/teacher");
      for (const name of [
        "curriculum",
        "lessons",
        "map_resources",
        "history_classrooms",
        "history_classroom_results",
        "quiz_questions",
        "quiz_results",
      ]) {
        assert.equal(
          f.doc(db, name, "item").path,
          mode === "archive"
            ? `years/2025/semesters/1/${name}/item`
            : `${name}/item`,
        );
      }
      const converter = {
        toFirestore: (data) => data,
        fromFirestore: (snapshot) => snapshot.data(),
      };
      // Start with an unwrapped ref to exercise reconstruction with its converter.
      const converted = raw
        .collection(db, "years/2026/semesters/2/lessons")
        .withConverter(converter);
      assert.equal(f.doc(converted, "a").converter, converter);
      assert.equal(f.doc(converted, "a").path, `${prefix}/lessons/a`);
      assert.ok(
        f.query(children, f.where("visible", "==", true)) instanceof raw.Query,
      );
      if (mode === "normal") {
        assert.equal(f.WriteBatch, raw.WriteBatch);
        assert.equal(f.Transaction, raw.Transaction);
        assert.equal(f.getDoc, raw.getDoc);
        assert.ok(f.writeBatch(db) instanceof raw.WriteBatch);
        assert.ok(raw.refEqual(document, raw.doc(db, document.path)));
        assert.equal(f.collectionGroup(db, "lessons").type, "query");
      }
    }
    for (const base of [
      "https://www.westory.kr/?old=yes#/teacher/settings",
      "https://example.github.io/westory/?old=yes#/teacher/settings",
    ]) {
      const result = new URL(
        archive.buildSemesterArchiveUrl({ year: "2025", semester: "1" }, base),
      );
      assert.equal(result.origin, new URL(base).origin);
      assert.equal(result.pathname, new URL(base).pathname);
      assert.equal(result.searchParams.get("archiveYear"), "2025");
      assert.equal(result.searchParams.get("archiveSemester"), "1");
      assert.equal(result.searchParams.has("old"), false);
      assert.equal(result.hash, "#/teacher/dashboard");
    }
    assert.throws(() =>
      archive.buildSemesterArchiveUrl(
        { year: "2025", semester: "3" },
        "https://www.westory.kr/",
      ),
    );
    const registry = archive.getPreviousArchiveSemesters({
      year: "2026",
      semester: "2",
      availableSemesters: [
        { year: "2025", semester: "1" },
        { year: "2026", semester: "2" },
        { year: "2027", semester: "1" },
        { year: "2026", semester: "1" },
        { year: "2025", semester: "1" },
        { year: "bad", semester: "1" },
        { year: "2024", semester: "3" },
        null,
      ],
    });
    assert.deepEqual(registry.previous, [
      { year: "2026", semester: "1" },
      { year: "2025", semester: "1" },
    ]);
    assert.throws(() =>
      archive.getPreviousArchiveSemesters({ year: "bad", semester: "1" }),
    );
    console.log(
      `PASS ${mode}: SDK guards, reference behavior, URL base, registry filtering`,
    );
  } finally {
    await raw.terminate(db);
  }
}

function listSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? listSources(path)
      : /\.[cm]?[jt]sx?$/.test(entry.name)
        ? [path]
        : [];
  });
}

function checkImportAndTransportInventory() {
  const facadePackages = new Map([
    ["src/lib/archiveFirestore.ts", "@firebase/firestore"],
    ["src/lib/archiveAuth.ts", "@firebase/auth"],
    ["src/lib/archiveStorage.ts", "@firebase/storage"],
  ]);
  const allowedFirebase = new Set([
    "firebase/app",
    "firebase/app-check",
    "firebase/auth",
    "firebase/firestore",
    "firebase/storage",
    "firebase/functions",
    "firebase/analytics",
  ]);
  let importCount = 0;
  let fetchCount = 0;
  let guardedFunctions = 0;
  for (const path of listSources(join(root, "src"))) {
    const name = relative(root, path).replaceAll("\\", "/");
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const inspectImport = (specifier, typeOnly = false) => {
      const value = specifier.text;
      if (
        !value ||
        !(
          /^(?:@firebase|firebase)(?:\/|$)/.test(value) ||
          /^(?:https?:|.*node_modules).*firebase/.test(value)
        )
      )
        return;
      importCount++;
      if (value.startsWith("@firebase/")) {
        assert.equal(
          facadePackages.get(name),
          value,
          `${name}: underlying SDK bypasses archive facade`,
        );
      } else {
        assert.ok(
          allowedFirebase.has(value),
          `${name}: unsupported Firebase import ${value}; lite/compat/CDN imports bypass archive guards`,
        );
        if (value === "firebase/functions" && !typeOnly) {
          assert.equal(
            name,
            "src/lib/firebase.ts",
            `${name}: Functions must use the guarded callable factory`,
          );
        }
      }
    };
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier)
          inspectImport(
            node.moduleSpecifier,
            node.importClause?.isTypeOnly || node.isTypeOnly,
          );
      }
      if (ts.isCallExpression(node)) {
        const expression = node.expression.getText(source);
        if (
          node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          expression === "require"
        ) {
          assert.ok(
            node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]),
            `${name}: inspect nonliteral module loading for guard bypasses`,
          );
          inspectImport(node.arguments[0]);
        }
        if (
          expression === "fetch" ||
          /^(?:window|globalThis)\.fetch$/.test(expression)
        ) {
          fetchCount++;
          const options = node.arguments[1];
          if (options) {
            assert.ok(
              ts.isObjectLiteralExpression(options),
              `${name}: inspect dynamic fetch options for writes`,
            );
            for (const property of options.properties) {
              assert.ok(
                !ts.isSpreadAssignment(property),
                `${name}: inspect spread fetch options for writes`,
              );
              const key = property.name
                ?.getText(source)
                .replaceAll(/["']/g, "");
              assert.notEqual(
                key,
                "body",
                `${name}: raw request body needs archive protection`,
              );
              if (key === "method") {
                assert.ok(
                  ts.isPropertyAssignment(property) &&
                    ts.isStringLiteralLike(property.initializer) &&
                    /^(GET|HEAD)$/i.test(property.initializer.text),
                  `${name}: new write transport needs archive protection`,
                );
              }
            }
          }
        }
        assert.ok(
          !/(?:^|\.)sendBeacon$/.test(expression),
          `${name}: beacon transport needs archive protection`,
        );
        assert.ok(
          !/\.currentUser\.(delete|updateEmail|updatePassword|updateProfile)$/.test(
            expression,
          ),
          `${name}: account mutation must use the guarded SDK function`,
        );
      }
      if (ts.isNewExpression(node)) {
        assert.ok(
          !/(?:^|\.)(XMLHttpRequest|WebSocket)$/.test(
            node.expression.getText(source),
          ),
          `${name}: new transport needs archive protection`,
        );
      }
      if (
        name === "src/lib/firebase.ts" &&
        ts.isVariableDeclaration(node) &&
        ["getFirebaseFunctions", "getHttpsCallable"].includes(
          node.name.getText(source),
        )
      ) {
        const body = node.initializer?.body;
        const first = body && ts.isBlock(body) ? body.statements[0] : null;
        assert.ok(
          first &&
            ts.isExpressionStatement(first) &&
            ts.isCallExpression(first.expression) &&
            first.expression.expression.getText(source) ===
              "assertArchiveWritable" &&
            first.expression.arguments.length === 0,
          `${node.name.getText(source)} must guard before creating/importing Functions`,
        );
        guardedFunctions++;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.equal(guardedFunctions, 2);
  console.log(
    `PASS AST inventory: ${importCount} Firebase imports, ${fetchCount} read transports, both Functions factories guarded`,
  );
}

async function main() {
  checkImportAndTransportInventory();
  const config = await resolveConfig(
    { root, configFile: join(root, "vite.config.ts") },
    "build",
  );
  for (const [specifier, filename] of [
    ["firebase/firestore", "archiveFirestore"],
    ["firebase/auth", "archiveAuth"],
    ["firebase/storage", "archiveStorage"],
  ]) {
    const alias = config.resolve.alias.find(({ find }) =>
      find instanceof RegExp ? find.test(specifier) : find === specifier,
    );
    assert.ok(alias, `${specifier} must resolve through an archive facade`);
    assert.equal(
      resolve(alias.replacement),
      join(root, "src/lib", `${filename}.ts`),
    );
    assert.ok(
      alias.find instanceof RegExp && !alias.find.test(`${specifier}/lite`),
      "SDK aliases must match exactly",
    );
  }
  console.log(
    "PASS resolved Vite aliases: static and dynamic SDK imports share the guarded modules",
  );
  const cache = join(root, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  // Keep temporary modules below node_modules so their external SDK imports
  // resolve normally; cleanup is limited to this newly created directory.
  const directory = mkdtempSync(join(cache, "semester-archive-verify-"));
  try {
    await build({
      absWorkingDir: root,
      entryPoints: [
        "archiveFirestore",
        "archiveAuth",
        "archiveStorage",
        "semesterArchive",
      ].map((name) => `src/lib/${name}.ts`),
      bundle: true,
      splitting: true,
      format: "esm",
      platform: "node",
      packages: "external",
      outdir: directory,
      outExtension: { ".js": ".mjs" },
    });
    for (const mode of ["archive", "malformed", "normal"]) {
      const result = spawnSync(
        process.execPath,
        [fileURLToPath(import.meta.url), "--mode", mode, directory],
        { cwd: root, encoding: "utf8", timeout: 30000 },
      );
      process.stdout.write(result.stdout || "");
      process.stderr.write(result.stderr || "");
      assert.ifError(result.error);
      assert.equal(result.status, 0, `${mode} verification failed`);
    }
  } finally {
    const child = relative(cache, directory);
    assert.ok(
      child.startsWith("semester-archive-verify-") &&
        !child.includes("..") &&
        !child.includes("/") &&
        !child.includes("\\"),
    );
    rmSync(directory, { recursive: true, force: true });
  }
  console.log("Semester archive verification passed without backend writes.");
}

if (process.argv[2] === "--mode")
  await checkRuntime(process.argv[3], process.argv[4]);
else await main();
