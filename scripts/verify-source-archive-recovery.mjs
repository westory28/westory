import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { File } from "node:buffer";
import ts from "typescript";

const source = readFileSync("src/lib/sourceArchive.ts", "utf8");
const ast = ts.createSourceFile(
  "sourceArchive.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
);
const names = new Set(["editorRecoveries", "sourceArchiveEditorRecovery"]);
const statements = ast.statements.filter(
  (statement) =>
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some((declaration) =>
      names.has(declaration.name.getText(ast)),
    ),
);
assert.equal(statements.length, 2);
const code = ts.transpileModule(
  statements.map((statement) => statement.getText(ast)).join("\n"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { sourceArchiveEditorRecovery: recovery } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);

const selectedFile = new File(["raw fixture pdf bytes"], "fixture.pdf", {
  type: "application/pdf",
});
const snapshot = {
  draft: {
    title: "다시 인증한 뒤 보존할 제목",
    description: "편집 중 내용",
    updatedAt: { seconds: 1, nanoseconds: 10 },
  },
  selectedFile,
  tagInput: "역사,사료",
  panelMode: "create",
};
let fail;
const first = recovery.run(
  "teacher-one",
  snapshot,
  () =>
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
);
await Promise.resolve();
assert.equal(recovery.peek("teacher-one"), first);
assert.equal(recovery.peek("teacher-two"), undefined);
assert.equal(first.pending, true);
assert.throws(() =>
  recovery.run("teacher-one", snapshot, async () => "duplicate"),
);
recovery.acknowledge("teacher-one", first);
assert.equal(
  recovery.peek("teacher-one"),
  first,
  "pending work must survive unmount",
);
fail(new Error("fixture reauthentication interrupted"));
const outcome = await first.settled;
assert.equal(outcome.ok, false);
assert.equal(first.pending, false);
const remounted = recovery.peek("teacher-one");
assert.equal(remounted.draft.title, snapshot.draft.title);
assert.equal(remounted.tagInput, "역사,사료");
assert.equal(remounted.selectedFile.name, "fixture.pdf");
assert.equal(await remounted.selectedFile.text(), "raw fixture pdf bytes");
assert.deepEqual(remounted.draft.updatedAt, { seconds: 1, nanoseconds: 10 });
recovery.acknowledge("teacher-one", remounted);
assert.equal(recovery.peek("teacher-one"), undefined);

const successful = recovery.run(
  "teacher-one",
  snapshot,
  async () => "server-canonical-asset",
);
assert.deepEqual(await successful.settled, {
  ok: true,
  assetId: "server-canonical-asset",
});
recovery.acknowledge("teacher-one", first);
assert.equal(
  recovery.peek("teacher-one"),
  successful,
  "a stale component must not remove a newer recovery",
);
recovery.acknowledge("teacher-one", successful);
assert.equal(recovery.peek("teacher-one"), undefined);
assert.doesNotMatch(source, /\b(?:setDoc|uploadBytes)\s*\(/u);
const manager = readFileSync(
  "src/pages/teacher/ManageSourceArchive.tsx",
  "utf8",
);
assert.doesNotMatch(manager, /setHandoffAction/u);
assert.match(manager, /activeOwnerRef\.current !== ownerUid/u);
assert.match(manager, /sourceArchiveEditorRecovery\.run/u);
console.log(
  JSON.stringify({
    suite: "source-archive-recovery",
    status: "PASS",
    scenarios: [
      "raw-file-remount",
      "draft-remount",
      "owner-isolation",
      "pending-single-flight",
      "failure-retained",
      "canonical-success",
      "stale-acknowledgement",
    ],
    productionAccess: 0,
  }),
);
