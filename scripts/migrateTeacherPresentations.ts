/**
 * Teacher presentation migration helper
 *
 * Usage examples:
 * 1. Single migration dry run
 *    npx tsx scripts/migrateTeacherPresentations.ts --year=2026 --semester=1 --lesson-id=lesson-a --teacher-uid=uid123 --class-id=3-2 --class-label="3학년 2반"
 *
 * 2. Single migration apply
 *    GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/migrateTeacherPresentations.ts --year=2026 --semester=1 --lesson-id=lesson-a --teacher-uid=uid123 --class-id=3-2 --class-label="3학년 2반" --apply
 *
 * 3. JSON mapping dry run
 *    npx tsx scripts/migrateTeacherPresentations.ts --mapping-file=./scripts/examples/teacherPresentationMigration.sample.json
 *
 * 4. CSV mapping apply
 *    GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/migrateTeacherPresentations.ts --mapping-file=./scripts/examples/teacherPresentationMigration.sample.csv --apply --overwrite
 *
 * Mapping fields:
 * - year
 * - semester
 * - lessonId
 * - teacherUid
 * - classId
 * - classLabel
 * - overwrite (optional)
 *
 * Safety notes:
 * - Dry run is the default.
 * - Apply mode requires an explicit --apply flag.
 * - firebase-admin installation and service account credentials are required for apply mode.
 * - Run a dry run first, then review source/target preview before applying writes.
 * - Legacy fallback reads are still enabled in production, so migration can be staged.
 * - Confirm the class context manually before applying writes.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

type MigrationMode = "dry-run" | "apply";
type MigrationResultStatus =
  | "migrated"
  | "skipped"
  | "missing source"
  | "target exists"
  | "invalid mapping";

type MigrationPlan = {
  year: string;
  semester: string;
  lessonId: string;
  teacherUid: string;
  classId: string;
  classLabel: string;
  mode: MigrationMode;
  overwrite: boolean;
};

type MappingRow = Partial<{
  year: string;
  semester: string;
  lessonId: string;
  teacherUid: string;
  classId: string;
  classLabel: string;
  overwrite: boolean | string;
}>;

type MigrationResult = {
  plan: MigrationPlan;
  status: MigrationResultStatus;
  detail: string;
};

type ReadPlansResult = {
  plans: MigrationPlan[];
  invalidResults: MigrationResult[];
};

type FirestoreCompat = {
  doc: (path: string) => {
    get: () => Promise<{
      exists: boolean;
      data: () => Record<string, unknown>;
    }>;
    set: (
      data: Record<string, unknown>,
      options?: { merge?: boolean },
    ) => Promise<void>;
  };
  FieldValue: {
    serverTimestamp: () => unknown;
  };
};

const REQUIRED_FIELDS = [
  "year",
  "semester",
  "lessonId",
  "teacherUid",
  "classId",
  "classLabel",
] as const;

const getArgValue = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length);
};

const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const parseBoolean = (value: unknown) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "y"].includes(value.trim().toLowerCase());
};

const sanitizeString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const buildLegacyPath = (plan: MigrationPlan) =>
  `years/${plan.year}/semesters/${plan.semester}/lesson_presentations/${plan.lessonId}/teachers/${plan.teacherUid}`;

const buildClassPath = (plan: MigrationPlan) =>
  `${buildLegacyPath(plan)}/classes/${plan.classId}`;

const readSinglePlan = (): MigrationPlan | null => {
  const year = getArgValue("year") || "";
  const semester = getArgValue("semester") || "";
  const lessonId = getArgValue("lesson-id") || "";
  const teacherUid = getArgValue("teacher-uid") || "";
  const classId = getArgValue("class-id") || "";
  const classLabel = getArgValue("class-label") || "";

  if (
    !year &&
    !semester &&
    !lessonId &&
    !teacherUid &&
    !classId &&
    !classLabel
  ) {
    return null;
  }

  if (
    !year ||
    !semester ||
    !lessonId ||
    !teacherUid ||
    !classId ||
    !classLabel
  ) {
    throw new Error(
      [
        "Missing required arguments.",
        "Required for single migration:",
        "  --year --semester --lesson-id --teacher-uid --class-id --class-label",
        "Or provide --mapping-file=...",
      ].join("\n"),
    );
  }

  return {
    year,
    semester,
    lessonId,
    teacherUid,
    classId,
    classLabel,
    mode: hasFlag("apply") ? "apply" : "dry-run",
    overwrite: hasFlag("overwrite"),
  };
};

const parseCsvLine = (line: string) => {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
};

const parseCsvMapping = (content: string): MappingRow[] => {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return header.reduce<MappingRow>((accumulator, key, index) => {
      accumulator[key as keyof MappingRow] = values[index] ?? "";
      return accumulator;
    }, {});
  });
};

const readMappingRows = async (mappingFile: string): Promise<MappingRow[]> => {
  const fullPath = path.resolve(mappingFile);
  const content = await readFile(fullPath, "utf8");
  const extension = path.extname(fullPath).toLowerCase();

  if (extension === ".json") {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      throw new Error("JSON mapping file must contain an array.");
    }
    return parsed as MappingRow[];
  }

  if (extension === ".csv") {
    return parseCsvMapping(content);
  }

  throw new Error("Unsupported mapping file. Use .json or .csv.");
};

const createPlanFromRow = (
  row: MappingRow,
  mode: MigrationMode,
  defaultOverwrite: boolean,
): MigrationPlan | null => {
  const year = sanitizeString(row.year);
  const semester = sanitizeString(row.semester);
  const lessonId = sanitizeString(row.lessonId);
  const teacherUid = sanitizeString(row.teacherUid);
  const classId = sanitizeString(row.classId);
  const classLabel = sanitizeString(row.classLabel);

  if (
    !year ||
    !semester ||
    !lessonId ||
    !teacherUid ||
    !classId ||
    !classLabel
  ) {
    return null;
  }

  return {
    year,
    semester,
    lessonId,
    teacherUid,
    classId,
    classLabel,
    mode,
    overwrite: parseBoolean(row.overwrite) || defaultOverwrite,
  };
};

const createInvalidResult = (detail: string): MigrationResult => ({
  plan: {
    year: "",
    semester: "",
    lessonId: "",
    teacherUid: "",
    classId: "",
    classLabel: "미확인 학급",
    mode: "dry-run",
    overwrite: false,
  },
  status: "invalid mapping",
  detail,
});

const readPlans = async (): Promise<ReadPlansResult> => {
  const mode: MigrationMode = hasFlag("apply") ? "apply" : "dry-run";
  const overwrite = hasFlag("overwrite");
  const mappingFile = getArgValue("mapping-file");
  const singlePlan = readSinglePlan();

  if (mappingFile) {
    const rows = await readMappingRows(mappingFile);
    if (!rows.length) {
      throw new Error("Mapping file is empty.");
    }

    const plans: MigrationPlan[] = [];
    const invalidResults: MigrationResult[] = [];

    rows.forEach((row, index) => {
      const plan = createPlanFromRow(row, mode, overwrite);
      if (!plan) {
        invalidResults.push(
          createInvalidResult(
            `Invalid mapping row #${index + 1}. Required fields: ${REQUIRED_FIELDS.join(", ")}`,
          ),
        );
        return;
      }
      plans.push(plan);
    });

    return { plans, invalidResults };
  }

  if (singlePlan) {
    return { plans: [singlePlan], invalidResults: [] };
  }

  throw new Error(
    [
      "No migration target was provided.",
      "Use either:",
      "  --year --semester --lesson-id --teacher-uid --class-id --class-label",
      "or",
      "  --mapping-file=./path/to/file.json",
    ].join("\n"),
  );
};

const printPlan = (plan: MigrationPlan, index: number, total: number) => {
  console.log(
    [
      "",
      `[${index + 1}/${total}] Teacher presentation migration plan`,
      `- mode: ${plan.mode}`,
      `- lesson: ${plan.lessonId}`,
      `- teacher: ${plan.teacherUid}`,
      `- class: ${plan.classLabel} (${plan.classId})`,
      `- source: ${buildLegacyPath(plan)}`,
      `- target: ${buildClassPath(plan)}`,
      `- overwrite existing target: ${plan.overwrite ? "yes" : "no"}`,
    ].join("\n"),
  );
};

const printSummary = (results: MigrationResult[]) => {
  const counts = results.reduce<Record<MigrationResultStatus, number>>(
    (accumulator, result) => {
      accumulator[result.status] += 1;
      return accumulator;
    },
    {
      migrated: 0,
      skipped: 0,
      "missing source": 0,
      "target exists": 0,
      "invalid mapping": 0,
    },
  );

  console.log("");
  console.log("Migration summary");
  console.log("-----------------");
  console.log(`- migrated: ${counts.migrated}`);
  console.log(`- skipped: ${counts.skipped}`);
  console.log(`- missing source: ${counts["missing source"]}`);
  console.log(`- target exists: ${counts["target exists"]}`);
  console.log(`- invalid mapping: ${counts["invalid mapping"]}`);
};

const loadFirestore = async (): Promise<FirestoreCompat> => {
  let admin: typeof import("firebase-admin");
  try {
    admin = await import("firebase-admin");
  } catch (_error) {
    throw new Error(
      [
        "firebase-admin is not installed.",
        "Install it first with:",
        "  npm install firebase-admin",
        "",
        "Then provide credentials with GOOGLE_APPLICATION_CREDENTIALS or your usual admin init flow.",
      ].join("\n"),
    );
  }

  if (!admin.apps.length) {
    admin.initializeApp();
  }

  return {
    doc: (docPath: string) => admin.firestore().doc(docPath),
    FieldValue: admin.firestore.FieldValue,
  };
};

const buildMigrationPayload = (
  sourceData: Record<string, unknown>,
  plan: MigrationPlan,
  firestore: FirestoreCompat,
) => ({
  lessonId: plan.lessonId,
  teacherUid: plan.teacherUid,
  classId: plan.classId,
  classLabel: plan.classLabel,
  currentPage:
    typeof sourceData.currentPage === "number" ? sourceData.currentPage : null,
  annotations: sourceData.annotations || {
    strokes: [],
    boxes: [],
    textNotes: [],
  },
  updatedAt: sourceData.updatedAt || firestore.FieldValue.serverTimestamp(),
  lastUsedAt: firestore.FieldValue.serverTimestamp(),
  migratedFromLegacyAt: firestore.FieldValue.serverTimestamp(),
  migratedFromLegacyPath: buildLegacyPath(plan),
});

const runPlan = async (
  plan: MigrationPlan,
  firestore: FirestoreCompat,
): Promise<MigrationResult> => {
  const sourceRef = firestore.doc(buildLegacyPath(plan));
  const targetRef = firestore.doc(buildClassPath(plan));

  const [sourceSnapshot, targetSnapshot] = await Promise.all([
    sourceRef.get(),
    targetRef.get(),
  ]);

  if (!sourceSnapshot.exists) {
    return {
      plan,
      status: "missing source",
      detail: "Legacy teacher document was not found.",
    };
  }

  if (targetSnapshot.exists && !plan.overwrite) {
    return {
      plan,
      status: "target exists",
      detail:
        "Target class document already exists. Use --overwrite to replace it.",
    };
  }

  const sourceData = sourceSnapshot.data();
  const payload = buildMigrationPayload(sourceData, plan, firestore);

  console.log(`- source exists: yes`);
  console.log(`- target exists: ${targetSnapshot.exists ? "yes" : "no"}`);
  console.log(
    JSON.stringify(
      {
        targetPath: buildClassPath(plan),
        payloadPreview: {
          lessonId: payload.lessonId,
          teacherUid: payload.teacherUid,
          classId: payload.classId,
          classLabel: payload.classLabel,
          currentPage: payload.currentPage,
          annotationStrokeCount: Array.isArray(
            (payload.annotations as { strokes?: unknown[] }).strokes,
          )
            ? (payload.annotations as { strokes?: unknown[] }).strokes!.length
            : 0,
        },
      },
      null,
      2,
    ),
  );

  if (plan.mode === "dry-run") {
    return {
      plan,
      status: targetSnapshot.exists ? "skipped" : "skipped",
      detail: "Dry run only. No writes were performed.",
    };
  }

  await targetRef.set(payload, { merge: true });
  return {
    plan,
    status: "migrated",
    detail: `Wrote target document ${buildClassPath(plan)}`,
  };
};

const main = async () => {
  const { plans, invalidResults } = await readPlans();
  const results: MigrationResult[] = [...invalidResults];

  console.log(
    [
      "Teacher presentation migration helper",
      `- mode: ${hasFlag("apply") ? "apply" : "dry-run"}`,
      `- valid items: ${plans.length}`,
      `- invalid items: ${invalidResults.length}`,
      "",
      "Check before running:",
      "- source legacy doc really belongs to this class context",
      "- target class label is confirmed by a teacher or admin",
      "- fallback reads remain enabled until migration is reviewed",
    ].join("\n"),
  );

  if (!plans.length) {
    printSummary(results);
    return;
  }

  const firestore = await loadFirestore();

  for (const [index, plan] of plans.entries()) {
    printPlan(plan, index, plans.length);
    const result = await runPlan(plan, firestore);
    results.push(result);
    console.log(`- result: ${result.status}`);
    console.log(`- detail: ${result.detail}`);
  }

  printSummary(results);

  if (hasFlag("apply")) {
    console.log(
      "Legacy fallback can remain enabled until the migrated class documents are verified in the teacher UI.",
    );
  }
};

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
