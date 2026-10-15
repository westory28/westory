import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = ts.transpileModule(
  readFileSync("src/lib/assessmentTelemetry.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  },
).outputText;
const { AssessmentTelemetryCollector } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

let now = 0;
const collector = new AssessmentTelemetryCollector(["a", "b", "c"], {
  now: () => now,
});
collector.visit("a");
now = 4000; // Image preparation, before observation is enabled.
collector.setRunning(true);
now = 6000;
collector.answer("a", "1");
now = 9000;
collector.setVisible(false);
now = 19000;
collector.setVisible(true);
now = 20000;
collector.answer("a", "2");
now = 22000;
collector.setConfidenceFocused(true);
now = 25000;
collector.setConfidence("a", "unsure");
collector.setConfidenceFocused(false);
collector.markHintViewed("a");
now = 26000;
collector.visit("b");
now = 28000;
collector.visit("a");
now = 32000;
collector.setRunning(false);
const snapshot = collector.snapshot();
assert.deepEqual(snapshot.questions.a, {
  activeMs: 13000,
  hiddenMs: 10000,
  confidenceMs: 3000,
  firstResponseMs: 2000,
  finalResponseMs: 6000,
  answerChangeCount: 1,
  revisitCount: 1,
  confidence: "unsure",
  hintViewed: true,
  quality: "complete",
});
assert.equal(snapshot.questions.b.activeMs, 2000);
assert.equal(snapshot.questions.b.firstResponseMs, null);
assert.equal(snapshot.questions.b.finalResponseMs, null);
assert.equal(snapshot.questions.c.activeMs, 0);
assert.equal(snapshot.questions.c.confidence, null);
now = 40000;
assert.deepEqual(
  collector.snapshot(),
  snapshot,
  "Paused and submitted snapshots must stop accumulating.",
);

const resumed = new AssessmentTelemetryCollector(["a", "b"], {
  restored: snapshot,
  answers: { a: "2" },
  resumed: true,
  now: () => now,
});
resumed.visit("a");
resumed.setRunning(true);
now += 1000;
const restoredSnapshot = resumed.snapshot();
assert.equal(restoredSnapshot.quality, "partial");
assert.equal(restoredSnapshot.questions.a.quality, "partial");
assert.equal(restoredSnapshot.questions.a.activeMs, 14000);
assert.equal(
  restoredSnapshot.questions.a.finalResponseMs,
  6000,
  "Review without changing the answer must retain final response time.",
);
assert.equal(restoredSnapshot.questions.a.revisitCount, 2);
assert.equal(restoredSnapshot.questions.b.firstResponseMs, null);

const text = new AssessmentTelemetryCollector(["short"], { now: () => now });
text.visit("short");
text.setRunning(true);
now += 1000;
text.answer("short", "고", false);
now += 1000;
text.answer("short", "고려", false);
assert.equal(
  text.snapshot().questions.short.answerChangeCount,
  0,
  "Keystrokes are not answer changes.",
);
text.commitAnswer("short");
now += 1000;
text.answer("short", "조", false);
now += 1000;
text.answer("short", "조선", false);
text.commitAnswer("short");
assert.equal(text.snapshot().questions.short.answerChangeCount, 1);
text.answer("short", "", false);
text.commitAnswer("short");
assert.equal(text.snapshot().questions.short.firstResponseMs, null);
assert.equal(text.snapshot().questions.short.finalResponseMs, null);
now += 1000;
text.answer("short", "고려", false);
text.commitAnswer("short");
assert.equal(
  text.snapshot().questions.short.firstResponseMs,
  1000,
  "Clearing then entering another answer must not rewrite the first response time.",
);
assert.equal(text.snapshot().questions.short.finalResponseMs, 5000);

snapshot.questions.a.activeMs = 0;
assert.equal(
  collector.snapshot().questions.a.activeMs,
  13000,
  "Snapshots must not expose mutable collector state.",
);
assert.equal(JSON.stringify(collector.snapshot()).includes('"answers"'), false);
console.log(
  "Assessment telemetry verified: monotonic visible time, hidden time, image wait, confidence time, unchanged review, revisits, text commits, restore quality, unanswered nulls and immutable snapshots.",
);
