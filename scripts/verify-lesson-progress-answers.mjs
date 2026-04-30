import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const tempDir = join(tmpdir(), `westory-lesson-progress-${Date.now()}`);
const outputFile = join(tempDir, "lessonProgressAnswers.mjs");

await mkdir(tempDir, { recursive: true });

try {
  await build({
    entryPoints: ["src/lib/lessonProgressAnswers.ts"],
    outfile: outputFile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });

  const { buildLessonAnswerSnapshot } = await import(
    `${pathToFileURL(outputFile).href}?t=${Date.now()}`
  );

  const snapshot = buildLessonAnswerSnapshot({
    existingAnswers: {
      "worksheet-page-1": { value: "old page 1", status: "wrong" },
      "worksheet-page-2": { value: "saved page 2", status: "correct" },
      "removed-blank": { value: "stale", status: "correct" },
    },
    renderedAnswers: [
      { key: "worksheet-page-1", value: "new page 1", status: "correct" },
      { key: "0", value: "inline answer", status: "correct" },
    ],
    worksheetBlankIds: ["worksheet-page-1", "worksheet-page-2"],
  });

  assert.deepEqual(snapshot.answers, {
    "0": { value: "inline answer", status: "correct" },
    "worksheet-page-1": { value: "new page 1", status: "correct" },
    "worksheet-page-2": { value: "saved page 2", status: "correct" },
  });
  assert.equal(snapshot.totalCount, 3);
  assert.equal(snapshot.filledCount, 3);

  const emptyHiddenPageSnapshot = buildLessonAnswerSnapshot({
    existingAnswers: {},
    renderedAnswers: [
      { key: "worksheet-page-1", value: "", status: "" },
      { key: "0", value: "", status: "" },
    ],
    worksheetBlankIds: ["worksheet-page-1", "worksheet-page-2"],
  });

  assert.deepEqual(emptyHiddenPageSnapshot.answers["worksheet-page-2"], {
    value: "",
    status: "",
  });
  assert.equal(emptyHiddenPageSnapshot.totalCount, 3);
  assert.equal(emptyHiddenPageSnapshot.filledCount, 0);

  console.log("lesson progress answer snapshot harness passed");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
