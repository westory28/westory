import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

process.noDeprecation = true;

const STAGING_PROJECT_ID = "westory-staging-177587430482";
const STAGING_PROJECT_NUMBER = "894916304910";
const STAGING_APP_ID = "1:894916304910:web:bd8c8a9e3ed8bd1620dc5f";
const PRODUCTION_PROJECT_ID = "history-quiz-yongsin";
const STAGING_VISUAL_ORIGIN =
  "https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app";
const APP_CHECK_EXCHANGE_ENDPOINT = `https://content-firebaseappcheck.googleapis.com/v1/projects/${STAGING_PROJECT_ID}/apps/${STAGING_APP_ID}:exchangeDebugToken`;
const APP_CHECK_VERIFIED_AUDIENCE_SET = [
  `projects/${STAGING_PROJECT_ID}`,
  `projects/${STAGING_PROJECT_NUMBER}`,
].sort();
const APP_CHECK_VERIFIED_ISSUER = `https://firebaseappcheck.googleapis.com/${STAGING_PROJECT_NUMBER}`;
const APP_CHECK_EXCHANGE_TRANSPORT_CONTRACT = {
  method: "POST",
  contentType: "application/json",
  queryKeys: ["key"],
  requiredRequestHeaders: { "Content-Type": "application/json" },
  optionalRequestHeaders: ["X-Firebase-Client"],
  originHeaderPolicy: "exact-stable-alias-origin",
  refererHeaderPolicy: "exact-stable-alias-origin-slash",
  redirectMode: "error",
  requestBodyKeys: ["debug_token"],
  expectedStatus: 200,
  requiredResponseBodyKeys: ["token", "ttl"],
  ttlPattern: "^([\\d.]+)s$",
};
const FIXTURE_ID = "w10p-visual-fixture-v1";
const FIXTURE_REVISION = 1;
const ARTIFACT_SCHEMA_VERSION = "w10p-visual-fixture-audit-v2";
const AUDIT_MAX_AGE_SECONDS = 60 * 60;
const FIXTURE_OWNER = "w10p-visual-parity";
const FIXED_TIME = "2026-08-17T06:00:00.000Z";
const SEMESTER_ID = "2026-2";
const YEAR = "2026";
const SEMESTER = "2";
const CLASS_ID = "w10p-class-3-1";
const ENROLLMENT_ID = "w10p-enrollment-student";
const STUDENT_UID = "w10p-visual-student";
const TEACHER_UID = "w10p-visual-teacher";
const ADMIN_UID = "w10p-visual-admin";
const PREFLIGHT_UID = "w10p-visual-backup-preflight";
const STUDENT_EMAIL = "w10p-visual-student@yongshin-ms.ms.kr";
const TEACHER_EMAIL = "w10p-visual-teacher@yongshin-ms.ms.kr";
const ADMIN_EMAIL = "w10p-visual-admin@yongshin-ms.ms.kr";
const PREFLIGHT_EMAIL = "w10p-visual-backup-preflight@yongshin-ms.ms.kr";
const RUN_PATH = `w10p_visual_fixture_runs/${FIXTURE_ID}`;
const BACKUP_ROOT_PATH = `w10p_visual_fixture_backups/${FIXTURE_ID}`;
const BACKUP_DOCUMENTS_PATH = `${BACKUP_ROOT_PATH}/documents`;
const BACKUP_SCHEMA_VERSION = 2;
const ISOLATION_PROTOCOL_VERSION = 3;
const STRICT_COLLECTION_BACKUP_LIMIT = 200;
const AUXILIARY_COMMAND_LIMIT_PER_IDENTITY = 60;
const AUXILIARY_SESSION_LIMIT_PER_IDENTITY = 10;
const AUXILIARY_DELETE_LIMIT = 450;
const APPLICATION_SESSION_SCHEMA_VERSION = 2;
const APPLICATION_SESSION_AUTHORITY_GENERATION = "w1r2-2026-08-09";
const MAX_BACKUP_DOCUMENT_CANONICAL_BYTES = 512 * 1024;
const MAX_ATOMIC_RESTORE_BACKUP_CANONICAL_BYTES = 4 * 1024 * 1024;
const SETUP_STATES = new Set([
  "ACCESS_PROBING",
  "PREPARING",
  "BACKUP_READY",
  "ISOLATING",
  "ISOLATED",
  "AUTH_CREATING",
  "AUTH_READY",
  "READY",
  "CLEANING",
  "RESTORING",
  "RESTORED",
]);
const MAINTENANCE_PATH = "site_settings/student_maintenance";
const ASSESSMENT_SETTINGS_PATH = `years/${YEAR}/semesters/${SEMESTER}/assessment_config/settings`;
const ASSESSMENT_STATUS_PATH = `years/${YEAR}/semesters/${SEMESTER}/assessment_config/status`;
const markerlessOverwritePaths = new Set([
  MAINTENANCE_PATH,
  ASSESSMENT_SETTINGS_PATH,
  ASSESSMENT_STATUS_PATH,
]);

const args = process.argv.slice(2);
const valueArg = (name) =>
  String(
    args
      .find((value) => value.startsWith(`${name}=`))
      ?.slice(name.length + 1) || "",
  ).trim();
const projectId = valueArg("--project");
const outputArg = valueArg("--output");
const modes = ["dry-run", "verify-isolation", "setup", "audit", "cleanup"];
const selectedModes = modes.filter((mode) => args.includes(`--${mode}`));

assert.notEqual(
  projectId,
  PRODUCTION_PROJECT_ID,
  "Production access is forbidden.",
);
assert.equal(
  projectId,
  STAGING_PROJECT_ID,
  `Exact --project=${STAGING_PROJECT_ID} is required.`,
);
assert.equal(selectedModes.length, 1, "Choose exactly one fixture mode.");
const mode = selectedModes[0];
assert.equal(
  Boolean(outputArg) && mode !== "audit",
  false,
  "--output is allowed only with --audit.",
);
const auditOutputPath = outputArg ? resolve(outputArg) : "";
if (auditOutputPath) {
  const auditOutputParent = dirname(auditOutputPath);
  assert.equal(
    existsSync(auditOutputParent) && statSync(auditOutputParent).isDirectory(),
    true,
    "The audit output parent directory must already exist.",
  );
  assert.equal(
    existsSync(auditOutputPath),
    false,
    "The audit output path already exists.",
  );
}

const sha256 = (value) =>
  createHash("sha256").update(String(value), "utf8").digest("hex");
const fixtureCommandReceiptId = (actorUid, commandType, commandId) =>
  `cmd_${sha256(`${actorUid}\n${commandType}\n${commandId}`)}`;
const hashId = (prefix, ...parts) => `${prefix}_${sha256(parts.join("\n"))}`;
const NOTICE_DELIVERY_ID = hashId("noticedel", "w10p-notice", STUDENT_UID);
const slotId = `slot_${sha256(`${SEMESTER_ID}\n${STUDENT_UID}`).slice(0, 40)}`;
const wisAccountId = hashId("wisacct", SEMESTER_ID, STUDENT_UID);
const wisProductId = "w10p-visual-product";
const wisInventoryId = hashId("wisinv", SEMESTER_ID, wisProductId);
const wisLedgerId = hashId(
  "wisled",
  SEMESTER_ID,
  wisAccountId,
  "INITIAL_GRANT",
  "w10p-visual-grant",
);
const wisOrderId = hashId(
  "wisord",
  SEMESTER_ID,
  wisAccountId,
  wisInventoryId,
  FIXTURE_ID,
);
const wisOrderDebitLedgerId = hashId(
  "wisled",
  SEMESTER_ID,
  wisAccountId,
  "ORDER_DEBIT",
  wisOrderId,
);
const fixedDate = new Date(FIXED_TIME);
const oneDayLater = new Date("2026-08-18T06:00:00.000Z");
const imageUrl = "/icons/westory-wordmark.svg";

const canonicalize = (value) => {
  if (value instanceof Date) return { __timestamp: value.toISOString() };
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value.toDate === "function") {
    return { __timestamp: value.toDate().toISOString() };
  }
  if (Buffer.isBuffer(value)) return { __bytesSha256: sha256(value) };
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};
const canonicalJson = (value) => JSON.stringify(canonicalize(value));
const canonicalDouble = (value) => {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  if (Object.is(value, -0)) return "-0";
  return String(value);
};

const canonicalizeFixtureValue = (value) => {
  if (value === null) return ["null"];
  if (value === undefined) return ["undefined"];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "bigint") return ["integer", value.toString()];
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    !Object.is(value, -0)
  ) {
    return ["integer", String(value)];
  }
  if (typeof value === "number") return ["double", canonicalDouble(value)];
  if (value instanceof Date) {
    const milliseconds = value.getTime();
    const seconds = Math.floor(milliseconds / 1000);
    return [
      "timestamp",
      String(seconds),
      String((milliseconds - seconds * 1000) * 1_000_000),
    ];
  }
  if (Array.isArray(value))
    return ["array", value.map(canonicalizeFixtureValue)];
  if (
    value &&
    typeof value.toDate === "function" &&
    Number.isFinite(value.seconds) &&
    Number.isFinite(value.nanoseconds)
  ) {
    return ["timestamp", String(value.seconds), String(value.nanoseconds)];
  }
  if (value && typeof value.toDate === "function") {
    return canonicalizeFixtureValue(value.toDate());
  }
  if (
    value?.constructor?.name === "DocumentReference" &&
    typeof value.path === "string"
  ) {
    return ["reference", String(value.formattedName || value.path)];
  }
  if (
    value?.constructor?.name === "GeoPoint" &&
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude)
  ) {
    return [
      "geoPoint",
      canonicalDouble(value.latitude),
      canonicalDouble(value.longitude),
    ];
  }
  if (Buffer.isBuffer(value)) return ["bytes", value.toString("base64")];
  if (value?.constructor?.name === "Bytes" && value.toBase64) {
    return ["bytes", value.toBase64()];
  }
  if (
    value?.constructor?.name === "VectorValue" &&
    typeof value.toArray === "function"
  ) {
    return ["vector", value.toArray().map(canonicalDouble)];
  }
  if (value && typeof value === "object") {
    return [
      "map",
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalizeFixtureValue(value[key])]),
    ];
  }
  throw new TypeError("Unsupported Firestore fixture value type.");
};
const fixtureValueHash = (value) =>
  sha256(JSON.stringify(canonicalizeFixtureValue(value)));

const canonicalizeBackupValue = (value) => {
  if (value === null) return ["null"];
  if (value === undefined) return ["undefined"];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "bigint") return ["integer", value.toString()];
  if (typeof value === "number") return ["double", canonicalDouble(value)];
  if (value instanceof Date) return ["date", value.toISOString()];
  if (Array.isArray(value))
    return ["array", value.map(canonicalizeBackupValue)];
  if (
    value?.constructor?.name === "Timestamp" &&
    Number.isFinite(value.seconds) &&
    Number.isFinite(value.nanoseconds)
  ) {
    return ["timestamp", String(value.seconds), String(value.nanoseconds)];
  }
  if (
    value?.constructor?.name === "DocumentReference" &&
    typeof value.path === "string"
  ) {
    return ["reference", String(value.formattedName || value.path)];
  }
  if (
    value?.constructor?.name === "GeoPoint" &&
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude)
  ) {
    return [
      "geoPoint",
      canonicalDouble(value.latitude),
      canonicalDouble(value.longitude),
    ];
  }
  if (Buffer.isBuffer(value)) return ["bytes", value.toString("base64")];
  if (value?.constructor?.name === "Bytes" && value.toBase64) {
    return ["bytes", value.toBase64()];
  }
  if (
    value?.constructor?.name === "VectorValue" &&
    typeof value.toArray === "function"
  ) {
    return ["vector", value.toArray().map(canonicalDouble)];
  }
  if (value && typeof value === "object") {
    return [
      "map",
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalizeBackupValue(value[key])]),
    ];
  }
  throw new TypeError("Unsupported Firestore backup value type.");
};
const canonicalBackupJson = (value) =>
  JSON.stringify(canonicalizeBackupValue(value));

const assertLosslessBackupValue = (value, fieldPath = "root") => {
  if (typeof value === "bigint" || value === null || value === undefined)
    return;
  if (typeof value === "number") {
    assert.equal(
      Number.isSafeInteger(value) && !Object.is(value, -0),
      false,
      `A Firestore integral double cannot be restored losslessly: ${fieldPath}`,
    );
    return;
  }
  if (value instanceof Date || Buffer.isBuffer(value)) return;
  if (value?.constructor?.name === "DocumentReference") {
    assert.fail(
      `A decoded Firestore reference cannot prove its original project/database qualifier: ${fieldPath}`,
    );
  }
  if (["Timestamp", "GeoPoint", "Bytes"].includes(value?.constructor?.name))
    return;
  if (value?.constructor?.name === "VectorValue") {
    assert.equal(typeof value.toArray, "function");
    assert.equal(
      value.toArray().every((item) => typeof item === "number"),
      true,
    );
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertLosslessBackupValue(item, `${fieldPath}[${index}]`),
    );
    return;
  }
  if (value && typeof value === "object") {
    assert.equal(
      value.constructor === Object || value.constructor === undefined,
      true,
      `An unsupported Firestore value blocks backup: ${fieldPath}`,
    );
    for (const [key, child] of Object.entries(value)) {
      assertLosslessBackupValue(child, `${fieldPath}.${key}`);
    }
  }
};

const exactTimestampParts = (value) => {
  const rawSeconds = value?.seconds;
  const rawNanoseconds = value?.nanoseconds;
  const secondsAreExact =
    typeof rawSeconds === "bigint" || Number.isSafeInteger(rawSeconds);
  const nanosecondsAreExact =
    typeof rawNanoseconds === "bigint" || Number.isSafeInteger(rawNanoseconds);
  if (secondsAreExact && nanosecondsAreExact) {
    const seconds = BigInt(rawSeconds);
    const nanoseconds = BigInt(rawNanoseconds);
    if (nanoseconds >= 0n && nanoseconds < 1_000_000_000n) {
      return { seconds, nanoseconds };
    }
    return null;
  }
  const date =
    value instanceof Date
      ? value
      : value && typeof value.toDate === "function"
        ? value.toDate()
        : null;
  const milliseconds = date?.getTime();
  if (!Number.isSafeInteger(milliseconds)) return null;
  const seconds = Math.floor(milliseconds / 1000);
  return {
    seconds: BigInt(seconds),
    nanoseconds: BigInt(milliseconds - seconds * 1000) * 1_000_000n,
  };
};

const compareExactTimestamps = (left, right) => {
  const leftParts = exactTimestampParts(left);
  const rightParts = exactTimestampParts(right);
  assert.ok(leftParts && rightParts, "An exact timestamp is required.");
  if (leftParts.seconds !== rightParts.seconds) {
    return leftParts.seconds < rightParts.seconds ? -1 : 1;
  }
  if (leftParts.nanoseconds === rightParts.nanoseconds) return 0;
  return leftParts.nanoseconds < rightParts.nanoseconds ? -1 : 1;
};

const auxiliaryTimestampMillis = (value) => {
  const parts = exactTimestampParts(value);
  if (!parts) return Number.NaN;
  return Number(parts.seconds) * 1000 + Number(parts.nanoseconds) / 1_000_000;
};

const BACKUP_ACCESS_PROBE_KIND =
  "synthetic-fixture-id-token-backup-read-update-delete-create";
const backupAccessProbeCanary = (kind) => {
  const revisionHash = sha256(
    `${FIXTURE_ID}\n${FIXTURE_REVISION}\nbackup-access-${kind}-canary-v1`,
  );
  const documentId = sha256(`${revisionHash}\ndocument`);
  const data = {
    schemaVersion: 1,
    fixtureOwner: FIXTURE_OWNER,
    fixtureId: FIXTURE_ID,
    fixtureRevision: FIXTURE_REVISION,
    canaryPurpose: `backup-access-${kind}-deny-probe`,
    canaryRevision: revisionHash,
    payloadSentinelHash: sha256(
      `${FIXTURE_ID}\n${FIXTURE_REVISION}\n${kind}\npayload`,
    ),
  };
  return {
    kind,
    revisionHash,
    documentId,
    path: `${BACKUP_DOCUMENTS_PATH}/${documentId}`,
    data,
    documentHash: sha256(canonicalBackupJson(data)),
  };
};
const EXISTING_WRITE_CANARY = backupAccessProbeCanary("existing-update-delete");
const ABSENT_WRITE_CANARY = backupAccessProbeCanary("absent-create");
const POST_BACKUP_PROBE_REVISION_HASH = sha256(
  `${FIXTURE_ID}\n${FIXTURE_REVISION}\npost-backup-access-probe-v1`,
);
const PRE_BACKUP_EXISTING_WRITE_CANARY = backupAccessProbeCanary(
  "pre-backup-existing-update-delete",
);
const PRE_BACKUP_ABSENT_WRITE_CANARY = backupAccessProbeCanary(
  "pre-backup-absent-create",
);
const PRE_BACKUP_PROBE_REVISION_HASH = sha256(
  `${FIXTURE_ID}\n${FIXTURE_REVISION}\npre-backup-access-probe-v1`,
);
const PRE_BACKUP_AUTH_DISPLAY_NAME = `W10P preflight ${PRE_BACKUP_PROBE_REVISION_HASH.slice(
  0,
  12,
)}`;
const PRE_BACKUP_POSITIVE_CONTROL_PATH = `users/${PREFLIGHT_UID}/academic_records/access-control`;
const PRE_BACKUP_POSITIVE_CONTROL_SENTINEL_HASH = sha256(
  `${PRE_BACKUP_PROBE_REVISION_HASH}\npositive-control-sentinel`,
);
const PRE_BACKUP_POSITIVE_CONTROL_DATA = {
  schemaVersion: 1,
  fixtureOwner: FIXTURE_OWNER,
  fixtureId: FIXTURE_ID,
  fixtureRevision: FIXTURE_REVISION,
  fixturePurpose: "pre-backup-positive-control",
  probeRevision: PRE_BACKUP_PROBE_REVISION_HASH,
  sentinelHash: PRE_BACKUP_POSITIVE_CONTROL_SENTINEL_HASH,
};
const PRE_BACKUP_POSITIVE_CONTROL_DOCUMENT_HASH = sha256(
  canonicalBackupJson(PRE_BACKUP_POSITIVE_CONTROL_DATA),
);

const owned = (value) => ({
  ...value,
  fixtureId: FIXTURE_ID,
  fixtureOwner: FIXTURE_OWNER,
});

const hallOfFameConfig = {
  podiumImageUrl: "",
  podiumStoragePath: "",
  positionPreset: "classic_podium_v1",
  positions: {
    desktop: {
      first: { leftPercent: 50, topPercent: 26, widthPercent: 21 },
      second: { leftPercent: 26.5, topPercent: 40.5, widthPercent: 18 },
      third: { leftPercent: 73.5, topPercent: 40.5, widthPercent: 18 },
    },
    mobile: {
      first: { leftPercent: 50, topPercent: 28, widthPercent: 28 },
      second: { leftPercent: 28, topPercent: 46, widthPercent: 21 },
      third: { leftPercent: 72, topPercent: 46, widthPercent: 21 },
    },
  },
  leaderboardPanel: {
    desktop: { leftPercent: 71, topPercent: 0, widthPercent: 29 },
    mobile: { leftPercent: 50, topPercent: 0, widthPercent: 100 },
  },
  publicRange: { gradeRankLimit: 10, classRankLimit: 10, includeTies: true },
  recognitionPopup: { enabled: true, gradeEnabled: true, classEnabled: true },
};

const curriculumTree = [
  {
    id: "w10p-history-big",
    title: "W10P 역사 대단원",
    children: [
      {
        id: "w10p-lesson-unit",
        title: "W10P 수업 자료",
        children: [],
      },
      {
        id: "w10p-quiz-unit",
        title: "W10P 평가 단원",
        children: [],
      },
    ],
  },
];

const thinkCloudOptions = {
  allowDuplicateWord: true,
  allowDuplicateByStudent: true,
  inputMode: "sentence",
  anonymous: false,
  maxLength: 40,
  profanityFilter: true,
};

const wisLedgerEntry = {
  schemaVersion: 1,
  policyVersion: "w7-v1",
  ledgerEntryId: wisLedgerId,
  semesterId: SEMESTER_ID,
  accountId: wisAccountId,
  studentUid: STUDENT_UID,
  type: "INITIAL_GRANT",
  delta: 700,
  balanceBefore: 0,
  balanceAfter: 700,
  sourceId: "w10p-visual-grant",
  reason: "W10P 위스 기록",
  reversalEntryId: "",
  actorUid: TEACHER_UID,
  actorRole: "teacher",
  commandId: "w10p-visual-command",
  receiptId: "w10p-visual-receipt",
  createdAt: fixedDate,
};

const wisOrderDebitLedgerEntry = {
  schemaVersion: 1,
  policyVersion: "w7-v1",
  ledgerEntryId: wisOrderDebitLedgerId,
  semesterId: SEMESTER_ID,
  accountId: wisAccountId,
  studentUid: STUDENT_UID,
  type: "ORDER_DEBIT",
  delta: -100,
  balanceBefore: 700,
  balanceAfter: 600,
  sourceId: wisOrderId,
  reason: "상품 주문: W10P 위스 상품",
  actorUid: STUDENT_UID,
  actorRole: "student",
  commandId: FIXTURE_ID,
  receiptId: "w10p-visual-order-receipt",
  createdAt: oneDayLater,
};

const gradeFixture = (scoreKind, title, suffix) => {
  const written = scoreKind === "written_exam_essay";
  const rosterId = `w10p-roster-${suffix}`;
  const totalScore = written ? 37 : 18;
  const totalMaxScore = written ? 40 : 20;
  const legacyItem = {
    name: written ? "W10P 서술형" : "W10P 탐구 활동",
    shortName: "",
    itemKey: written ? "subjective-1" : "w10p-performance-1",
    groupKey: written ? "subjective" : "",
    groupLabel: written ? "서술형" : "",
    examSection: written ? "essay" : "",
    questionNumber: written ? 1 : 0,
    correctAnswer: written ? "W10P 모범 답안" : "",
    studentAnswer: written ? "W10P 학생 답안" : "",
    answerCorrect: written,
    answerStatus: written ? "correct" : "",
    answerChoices: [],
    feedback: `${title} 피드백`,
    score: totalScore,
    maxScore: totalMaxScore,
    ratio: 100,
    scoreEntered: true,
  };
  const legacyRecord = {
    uid: STUDENT_UID,
    grade: "3",
    class: "1",
    number: "1",
    studentName: "W10P 학생",
    items: [legacyItem],
    enteredScoreCount: 1,
    totalScore,
    totalMaxScore,
    feedback: `${title} 피드백`,
    evidence: `${title} 채점표`,
    academicStatus: "",
    isTransferred: false,
    transferStatus: "",
  };
  const enrollmentSnapshot = {
    enrollmentId: ENROLLMENT_ID,
    classId: CLASS_ID,
    displayName: "W10P 학생",
    studentNumber: "1",
    grade: "3",
    classNumber: "1",
    classDisplayName: "W10P 시각 검증 학급",
  };
  const rosterPath = `years/${YEAR}/semesters/${SEMESTER}/performance_score_rosters/${rosterId}`;
  const legacyScorePath = `users/${STUDENT_UID}/performance_scores/${rosterId}`;
  const recordId = `grade_${sha256(
    `MANUAL_IMPORT\n${SEMESTER_ID}\n${rosterId}\n${ENROLLMENT_ID}`,
  )}`;
  const logicalKey = `MANUAL_IMPORT:${SEMESTER_ID}:${rosterId}:${ENROLLMENT_ID}`;
  const sourceRefs = [
    rosterPath,
    `semester_enrollments/${ENROLLMENT_ID}`,
    `semester_classes/${CLASS_ID}`,
    legacyScorePath,
  ];
  const sourceHash = sha256(
    canonicalJson({
      rosterId,
      scoreKind,
      title,
      studentUid: STUDENT_UID,
      enrollmentId: ENROLLMENT_ID,
      items: legacyRecord.items,
      totalScore,
      totalMaxScore,
      feedback: legacyRecord.feedback,
      evidence: legacyRecord.evidence,
    }),
  );
  const gradeItems = [
    {
      itemId: `legacy-1-${sha256(legacyItem.itemKey).slice(0, 16)}`,
      maxScore: totalMaxScore,
      awardedScore: totalScore,
      evaluationKind: "TEACHER",
      evidence: canonicalJson({
        feedback: legacyItem.feedback,
        studentAnswer: legacyItem.studentAnswer,
        correctAnswer: legacyItem.correctAnswer,
        answerStatus: legacyItem.answerStatus,
        answerCorrect: legacyItem.answerCorrect,
        source: legacyRecord.evidence,
      }).slice(0, 2_000),
      reason: "Legacy grade roster import",
    },
  ];
  const baseRecord = {
    recordId,
    logicalKey,
    semesterId: SEMESTER_ID,
    studentUid: STUDENT_UID,
    enrollmentId: ENROLLMENT_ID,
    classId: CLASS_ID,
    sourceKind: "MANUAL_IMPORT",
    sourceId: rosterId,
    sourceRefs,
    sourceSnapshotHash: sourceHash,
    scoreKind,
    enrollmentSnapshot,
    definitionId: "",
    definitionRevision: 0,
    sourceHash,
    title,
    rubricVersion: "w6b-rubric-v1",
  };
  const evidenceHash = sha256(
    canonicalJson({
      recordId,
      gradeRevision: 1,
      semesterId: SEMESTER_ID,
      studentUid: STUDENT_UID,
      enrollmentId: ENROLLMENT_ID,
      classId: CLASS_ID,
      sourceKind: "MANUAL_IMPORT",
      sourceId: rosterId,
      sourceSnapshotHash: sourceHash,
      scoreKind,
      enrollmentSnapshot,
      title,
      rubricVersion: "w6b-rubric-v1",
      items: gradeItems,
      supersedesVersionId: "",
    }),
  );
  const versionId = `gradever_${sha256(`${recordId}\n1\n${evidenceHash}`)}`;
  const commandId = `w10p-visual-grade-${suffix}`;
  const receiptId = `w10p-visual-grade-receipt-${suffix}`;
  const version = owned({
    schemaVersion: 1,
    policyVersion: "w6b-v1",
    versionId,
    ...baseRecord,
    gradeRevision: 1,
    state: "OFFICIAL_PUBLISHED",
    items: gradeItems,
    totalScore,
    totalMaxScore,
    percent: Math.round((totalScore / totalMaxScore) * 10_000) / 100,
    evidenceHash,
    supersedesVersionId: "",
    reason: "W10P 시각 검증",
    createdBy: TEACHER_UID,
    createdByRole: "teacher",
    commandId,
    receiptId,
    createdAt: fixedDate,
  });
  const record = owned({
    schemaVersion: 1,
    policyVersion: "w6b-v1",
    ...baseRecord,
    revision: 1,
    gradeRevision: 1,
    status: "OFFICIAL_PENDING_SIGNATURE",
    currentVersionId: versionId,
    currentVersionRef: `semester_grade_versions/${versionId}`,
    evidenceHash,
    totalScore,
    totalMaxScore,
    percent: Math.round((totalScore / totalMaxScore) * 10_000) / 100,
    signatureRequired: true,
    provenance: "CURRENT",
    officialVersionId: null,
    officialAt: null,
    signedAttestationId: null,
    signedBy: null,
    signedAt: null,
    previousOfficialVersionId: "",
    createdBy: TEACHER_UID,
    createdAt: fixedDate,
    updatedBy: TEACHER_UID,
    updatedAt: fixedDate,
    commandId,
    receiptId,
  });
  const roster = owned({
    rosterId,
    schemaVersion: 1,
    policyVersion: "w10p-w6b-legacy-v1",
    revision: 1,
    scoreKind,
    scoreContentKind: written ? "essay" : "performance",
    title: written ? "W10P 정기시험 점수표" : "W10P 수행평가 점수표",
    subject: "W10P 사회",
    academicYear: YEAR,
    semester: SEMESTER,
    targetGrade: "3",
    targetClass: "1",
    classes: ["1"],
    items: [legacyItem],
    totalMaxScore,
    rowCount: 1,
    matchedCount: 1,
    unmatchedCount: 0,
    sourceFileName: `${suffix}.xlsx`,
    rows: [
      {
        rowNumber: 1,
        ...legacyRecord,
        matchStatus: "matched",
        matchMessage: "",
        isManual: false,
      },
    ],
    uploadedBy: TEACHER_UID,
    uploadedByEmail: TEACHER_EMAIL,
    updatedBy: TEACHER_UID,
    commandId,
    receiptId,
    createdAt: fixedDate,
    updatedAt: fixedDate,
  });
  const legacyScore = owned({
    schemaVersion: 1,
    policyVersion: "w10p-w6b-legacy-v1",
    scoreKind,
    scoreContentKind: written ? "essay" : "performance",
    rosterId,
    title: roster.title,
    subject: "W10P 사회",
    academicYear: YEAR,
    semester: SEMESTER,
    grade: "3",
    class: "1",
    number: "1",
    studentName: "W10P 학생",
    uid: STUDENT_UID,
    items: [legacyItem],
    enteredScoreCount: 1,
    totalScore,
    totalMaxScore,
    feedback: legacyRecord.feedback,
    evidence: legacyRecord.evidence,
    sourceFileName: `${suffix}.xlsx`,
    uploadedBy: TEACHER_UID,
    uploadedByEmail: TEACHER_EMAIL,
    uploadedAt: fixedDate,
    updatedAt: fixedDate,
    gradeRecordId: recordId,
    gradeVersionId: versionId,
    gradeRecordRevision: 1,
    gradeRevision: 1,
    projectionRevision: 1,
    commandId,
    receiptId,
  });
  return { recordId, versionId, record, version, roster, legacyScore };
};

const performanceGrade = gradeFixture(
  "performance",
  "W10P 수행평가 근거",
  "performance",
);
const writtenGrade = gradeFixture(
  "written_exam_essay",
  "W10P 정기시험 근거",
  "written",
);

const createDocs = new Map([
  [
    `users/${STUDENT_UID}`,
    owned({
      uid: STUDENT_UID,
      role: "student",
      email: STUDENT_EMAIL,
      name: "W10P 학생",
      displayName: "W10P 학생",
      grade: "3",
      class: "1",
      number: "1",
      studentGrade: "3",
      studentClass: "1",
      studentNumber: "1",
      teacherPortalEnabled: false,
      staffPermissions: [],
      privacyAgreed: true,
      consentAgreedItems: ["privacy", "terms"],
    }),
  ],
  [
    `users/${TEACHER_UID}`,
    owned({
      uid: TEACHER_UID,
      role: "teacher",
      email: TEACHER_EMAIL,
      name: "W10P 교사",
      displayName: "W10P 교사",
      teacherPortalEnabled: true,
      staffPermissions: [
        "lesson_read",
        "point_manage",
        "quiz_read",
        "student_list_read",
      ],
    }),
  ],
  [
    `users/${ADMIN_UID}`,
    owned({
      uid: ADMIN_UID,
      role: "teacher",
      email: ADMIN_EMAIL,
      name: "W10P 관리자",
      displayName: "W10P 관리자",
      teacherPortalEnabled: true,
      staffPermissions: [],
    }),
  ],
  [
    `users/${STUDENT_UID}/history_dictionary_words/w10p-history-term`,
    owned({
      uid: STUDENT_UID,
      termId: "w10p-history-term",
      word: "W10P 역사 용어",
      normalizedWord: "w10p 역사 용어",
      definition: "W10P 시각 검증을 위한 역사 용어 풀이입니다.",
      studentLevel: "middle",
      tags: ["W10P"],
      status: "saved",
      studentName: "W10P 학생",
      grade: "3",
      class: "1",
      number: "1",
      definitionSource: "teacher_reviewed",
      year: YEAR,
      semester: SEMESTER,
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    `users/${STUDENT_UID}/performance_scores/w10p-roster-performance`,
    performanceGrade.legacyScore,
  ],
  [
    `users/${STUDENT_UID}/performance_scores/w10p-roster-written`,
    writtenGrade.legacyScore,
  ],
  [
    `student_identities/${STUDENT_UID}`,
    owned({
      studentUid: STUDENT_UID,
      displayName: "W10P 학생",
      accountStatus: "ACTIVE",
      revision: 1,
      provenance: "CANONICAL",
      schemaVersion: 1,
      createdAt: fixedDate,
      createdBy: TEACHER_UID,
      updatedAt: fixedDate,
      updatedBy: TEACHER_UID,
    }),
  ],
  [
    `semester_classes/${CLASS_ID}`,
    owned({
      classId: CLASS_ID,
      semesterId: SEMESTER_ID,
      grade: "3",
      classNumber: "1",
      classKey: "3::1",
      displayName: "W10P 시각 검증 학급",
      homeroomTeacherUid: TEACHER_UID,
      status: "ACTIVE",
      revision: 1,
      provenance: "CANONICAL",
      schemaVersion: 1,
      createdAt: fixedDate,
      createdBy: TEACHER_UID,
      updatedAt: fixedDate,
      updatedBy: TEACHER_UID,
    }),
  ],
  [
    `semester_enrollments/${ENROLLMENT_ID}`,
    owned({
      enrollmentId: ENROLLMENT_ID,
      semesterId: SEMESTER_ID,
      studentUid: STUDENT_UID,
      classId: CLASS_ID,
      enrollmentStatus: "ACTIVE",
      status: "ACTIVE",
      source: {
        type: "MANUAL_EXCEPTION",
        sourceId: FIXTURE_ID,
        revision: 1,
      },
      revision: 1,
      provenance: "CANONICAL",
      effectiveFrom: "2026-08-17",
      effectiveTo: null,
      displayName: "W10P 학생",
      studentNumber: "1",
      snapshot: {
        displayName: "W10P 학생",
        grade: "3",
        classNumber: "1",
        classDisplayName: "W10P 시각 검증 학급",
        studentNumber: "1",
      },
      schemaVersion: 1,
      createdAt: fixedDate,
      createdBy: TEACHER_UID,
      updatedAt: fixedDate,
      updatedBy: TEACHER_UID,
    }),
  ],
  [
    `semester_enrollment_slots/${slotId}`,
    owned({
      slotId,
      semesterId: SEMESTER_ID,
      studentUid: STUDENT_UID,
      activeEnrollmentId: ENROLLMENT_ID,
      revision: 1,
      status: "ACTIVE",
      updatedAt: fixedDate,
      updatedBy: TEACHER_UID,
    }),
  ],
  [
    "semester_learning_contents/w10p-learning-content",
    owned({
      schemaVersion: 1,
      policyVersion: "w8-v1",
      contentId: "w10p-learning-content",
      semesterId: SEMESTER_ID,
      contentType: "LESSON",
      title: "W10P 수업 자료",
      summary: "W10P 학습 목록 시각 검증 자료",
      body: "W10P 수업 자료 본문",
      resourceUrl: "",
      status: "PUBLISHED",
      revision: 2,
      provenance: "CURRENT",
      readOnly: false,
      cutoverPlanId: null,
      audienceRoles: ["student"],
      targetClassIds: [CLASS_ID],
      availableFrom: "2026-01-01T00:00:00.000Z",
      availableUntil: "2027-01-01T00:00:00.000Z",
      publishedAt: FIXED_TIME,
      createdBy: TEACHER_UID,
      updatedBy: TEACHER_UID,
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    "semester_schedule_events/w10p-schedule-event",
    owned({
      schemaVersion: 1,
      policyVersion: "w8-v1",
      eventId: "w10p-schedule-event",
      semesterId: SEMESTER_ID,
      eventType: "SCHOOL",
      title: "W10P 시각 검증 일정",
      description: "W10P 일정 설명",
      startAt: "2026-08-17T00:00:00.000+09:00",
      endAt: "2026-08-17T23:59:59.999+09:00",
      allDay: true,
      period: "",
      status: "ACTIVE",
      sourceDomain: "USER",
      sourceReference: "legacy-calendar:event:w10p-schedule-event",
      targetClassIds: [CLASS_ID],
      targetUserIds: [],
      revision: 1,
      provenance: "CURRENT",
      readOnly: false,
      cutoverPlanId: null,
      createdBy: TEACHER_UID,
      updatedBy: TEACHER_UID,
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    "semester_attendance_sessions/w10p-attendance-session",
    owned({
      schemaVersion: 1,
      policyVersion: "w8-v1",
      sessionId: "w10p-attendance-session",
      semesterId: SEMESTER_ID,
      classId: CLASS_ID,
      className: "W10P 시각 검증 학급",
      date: "2026-08-17",
      period: "1",
      status: "OPEN",
      revision: 1,
      sourceEventId: "w10p-schedule-event",
      openedBy: TEACHER_UID,
      openedAt: FIXED_TIME,
      provenance: "CURRENT",
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    "semester_attendance_records/w10p-attendance-record",
    owned({
      schemaVersion: 1,
      policyVersion: "w8-v1",
      recordId: "w10p-attendance-record",
      sessionId: "w10p-attendance-session",
      semesterId: SEMESTER_ID,
      classId: CLASS_ID,
      studentUid: STUDENT_UID,
      studentName: "W10P 학생",
      enrollmentId: ENROLLMENT_ID,
      attendanceStatus: "EXCUSED",
      reason: "W10P 출석 사유",
      revision: 1,
      recordedBy: TEACHER_UID,
      recordedAt: FIXED_TIME,
      provenance: "CURRENT",
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    "semester_notices/w10p-notice",
    owned({
      schemaVersion: 1,
      policyVersion: "w8-v1",
      noticeId: "w10p-notice",
      semesterId: SEMESTER_ID,
      title: "W10P 시각 검증 공지",
      content: "W10P 시각 검증 공지 내용입니다.",
      status: "PUBLISHED",
      priority: "HIGH",
      revision: 2,
      provenance: "CURRENT",
      readOnly: false,
      cutoverPlanId: null,
      targetClassIds: [CLASS_ID],
      targetUserIds: [],
      targetRoles: ["student"],
      publishAt: "2026-01-01T00:00:00.000Z",
      expireAt: "2027-01-01T00:00:00.000Z",
      createdBy: TEACHER_UID,
      updatedBy: TEACHER_UID,
      createdAt: fixedDate,
      updatedAt: fixedDate,
      publishedAt: fixedDate,
    }),
  ],
  [
    `semester_notice_deliveries/${NOTICE_DELIVERY_ID}`,
    owned({
      schemaVersion: 1,
      policyVersion: "w8-v1",
      semesterId: SEMESTER_ID,
      provenance: "CURRENT",
      deliveryId: NOTICE_DELIVERY_ID,
      noticeId: "w10p-notice",
      noticeRevision: 2,
      recipientUid: STUDENT_UID,
      revision: 1,
      status: "DELIVERED",
      deliveredAt: fixedDate,
      dedupeKey: `w10p-notice:${STUDENT_UID}`,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/calendar/w10p-schedule-event`,
    owned({
      title: "W10P 시각 검증 일정",
      start: "2026-08-17",
      end: "2026-08-17",
      eventType: "event",
      targetType: "common",
      targetClass: "",
      description: "W10P 일정 설명",
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/lessons/w10p-lesson`,
    owned({
      unitId: "w10p-lesson-unit",
      title: "W10P 수업 자료",
      content: "W10P 수업 자료 본문",
      body: "W10P 수업 자료 본문",
      blocks: [
        {
          id: "w10p-lesson-block",
          type: "text",
          content: "W10P 수업 자료 본문",
        },
      ],
      status: "published",
      createdBy: TEACHER_UID,
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    "lessons/w10p-lesson",
    owned({
      unitId: "w10p-lesson-unit",
      title: "W10P 수업 자료",
      content: "W10P 수업 자료 본문",
      body: "W10P 수업 자료 본문",
      blocks: [
        {
          id: "w10p-lesson-block",
          type: "text",
          content: "W10P 수업 자료 본문",
        },
      ],
      status: "published",
      createdBy: TEACHER_UID,
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/map_resources/w10p-map`,
    owned({
      title: "W10P 역사 지도",
      description: "W10P 시각 검증 지도",
      sortOrder: 1,
      isPublished: true,
      imageUrl,
      tags: [],
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    "map_resources/w10p-map",
    owned({
      title: "W10P 역사 지도",
      description: "W10P 시각 검증 지도",
      sortOrder: 1,
      isPublished: true,
      imageUrl,
      tags: [],
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/history_classrooms/w10p-history-classroom`,
    owned({
      title: "W10P 역사교실",
      description: "W10P 역사교실 시각 검증 자료",
      mapResourceId: "w10p-map",
      mapTitle: "W10P 역사교실",
      pdfPageImages: [{ page: 1, imageUrl, width: 1000, height: 1400 }],
      pdfRegions: [],
      blanks: [
        {
          id: "w10p-blank-1",
          page: 1,
          left: 120,
          top: 180,
          width: 180,
          height: 52,
          answer: "W10P",
          prompt: "W10P 빈칸",
          source: "manual",
        },
      ],
      answerOptions: ["W10P"],
      timeLimitMinutes: 10,
      cooldownMinutes: 0,
      passThresholdPercent: 80,
      dueWindowDays: null,
      targetGrade: "3",
      targetClass: "1",
      targetStudentUid: STUDENT_UID,
      targetStudentUids: [STUDENT_UID],
      targetStudentAccessMap: { [STUDENT_UID]: true },
      targetStudentName: "W10P 학생",
      targetStudentNames: ["W10P 학생"],
      targetStudentReasons: { [STUDENT_UID]: "W10P 배정" },
      targetStudentNumber: "1",
      isPublished: true,
      publishedAt: fixedDate,
      createdAt: fixedDate,
      updatedAt: fixedDate,
      contentRevision: 1,
    }),
  ],
  [
    "history_classrooms/w10p-history-classroom",
    owned({
      title: "W10P 역사교실",
      description: "W10P 역사교실 시각 검증 자료",
      mapResourceId: "w10p-map",
      mapTitle: "W10P 역사교실",
      pdfPageImages: [{ page: 1, imageUrl, width: 1000, height: 1400 }],
      pdfRegions: [],
      blanks: [
        {
          id: "w10p-blank-1",
          page: 1,
          left: 120,
          top: 180,
          width: 180,
          height: 52,
          answer: "W10P",
          prompt: "W10P 빈칸",
          source: "manual",
        },
      ],
      answerOptions: ["W10P"],
      timeLimitMinutes: 10,
      cooldownMinutes: 0,
      passThresholdPercent: 80,
      targetGrade: "3",
      targetClass: "1",
      targetStudentUid: STUDENT_UID,
      targetStudentUids: [STUDENT_UID],
      targetStudentAccessMap: { [STUDENT_UID]: true },
      targetStudentName: "W10P 학생",
      targetStudentNames: ["W10P 학생"],
      targetStudentReasons: { [STUDENT_UID]: "W10P 배정" },
      targetStudentNumber: "1",
      isPublished: true,
      publishedAt: fixedDate,
      createdAt: fixedDate,
      updatedAt: fixedDate,
      contentRevision: 1,
    }),
  ],
  [
    "history_dictionary_terms/w10p-history-term",
    owned({
      word: "W10P 역사 용어",
      normalizedWord: "w10p 역사 용어",
      definition: "W10P 시각 검증을 위한 역사 용어 풀이입니다.",
      studentLevel: "middle",
      tags: ["W10P"],
      relatedUnitId: "w10p-lesson-unit",
      status: "published",
      createdBy: TEACHER_UID,
      updatedBy: TEACHER_UID,
      createdAt: fixedDate,
      updatedAt: fixedDate,
      publishedAt: fixedDate,
    }),
  ],
  [
    "source_archive/w10p-source",
    owned({
      schemaVersion: 1,
      mediaKind: "text",
      status: "ready",
      currentRevision: "w10p-v1",
      title: "W10P 사료",
      description: "W10P 시각 검증 사료",
      era: "고대",
      subject: "역사",
      unit: "W10P 수업 자료",
      type: "text",
      tags: ["W10P"],
      source: "W10P 합성 자료",
      searchText: "w10p 사료 역사",
      previewText: "W10P 사료 본문",
      pageCount: 1,
      file: {
        name: "",
        mimeType: "text/plain",
        storagePath: "",
        downloadUrl: "",
        size: 0,
        revision: "w10p-v1",
      },
      search: { text: "w10p 사료 역사", previewText: "W10P 사료 본문" },
      image: { imageUrl: "", storagePath: "" },
      createdBy: TEACHER_UID,
      updatedBy: TEACHER_UID,
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/think_cloud_sessions/w10p-think-cloud`,
    owned({
      schemaVersion: 1,
      policyVersion: "w8-v1",
      sessionId: "w10p-think-cloud",
      semesterId: SEMESTER_ID,
      targetClassId: CLASS_ID,
      title: "W10P 생각모아",
      description: "W10P 생각모아 시각 검증",
      targetGrade: "3",
      targetClass: "1",
      targetGradeLabel: "3학년",
      targetClassLabel: "1반",
      status: "active",
      options: thinkCloudOptions,
      createdBy: TEACHER_UID,
      createdByName: "W10P 교사",
      createdAt: fixedDate,
      activatedAt: fixedDate,
      updatedAt: fixedDate,
      revision: 1,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/think_cloud_sessions/w10p-think-cloud/responses/w10p-response-1`,
    owned({
      uid: STUDENT_UID,
      displayName: "W10P 학생",
      textRaw: "W10P 응답 하나",
      textNormalized: "w10p 응답 하나",
      createdAt: fixedDate,
      revision: 1,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/think_cloud_sessions/w10p-think-cloud/responses/w10p-response-2`,
    owned({
      uid: STUDENT_UID,
      displayName: "W10P 학생",
      textRaw: "W10P 응답 둘",
      textNormalized: "w10p 응답 둘",
      createdAt: oneDayLater,
      revision: 1,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/quiz_questions/1`,
    owned({
      category: "formative",
      unitId: "w10p-quiz-unit",
      subUnitId: null,
      type: "choice",
      question: "W10P 평가 문항",
      options: ["W10P 정답", "W10P 오답"],
      answer: 0,
      explanation: "W10P 평가 문항 해설",
      hintEnabled: true,
      hint: "W10P 힌트",
      contentRevision: 1,
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/quiz_results/w10p-quiz-result`,
    owned({
      uid: STUDENT_UID,
      name: "W10P 학생",
      studentName: "W10P 학생",
      email: STUDENT_EMAIL,
      grade: "3",
      class: "1",
      number: "1",
      gradeClass: "3 1 1번",
      unitId: "w10p-quiz-unit",
      category: "formative",
      score: 100,
      total: 1,
      details: [
        {
          id: 1,
          q: "W10P 평가 문항",
          u: "W10P 정답",
          a: 0,
          correct: true,
        },
      ],
      timestamp: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/performance_score_rosters/w10p-roster-performance`,
    performanceGrade.roster,
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/performance_score_rosters/w10p-roster-written`,
    writtenGrade.roster,
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/grading_plans/w10p-grading-plan`,
    owned({
      subject: "W10P 사회",
      targetGrade: "3",
      items: [
        { type: "정기", name: "W10P 정기시험", maxScore: 40, ratio: 50 },
        { type: "수행", name: "W10P 수행평가", maxScore: 20, ratio: 50 },
      ],
      academicYear: YEAR,
      semester: SEMESTER,
      revision: 1,
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    `semester_grade_records/${performanceGrade.recordId}`,
    performanceGrade.record,
  ],
  [
    `semester_grade_versions/${performanceGrade.versionId}`,
    performanceGrade.version,
  ],
  [`semester_grade_records/${writtenGrade.recordId}`, writtenGrade.record],
  [`semester_grade_versions/${writtenGrade.versionId}`, writtenGrade.version],
  [
    `semester_wis_economies/${SEMESTER_ID}`,
    owned({
      semesterId: SEMESTER_ID,
      schemaVersion: 1,
      policyVersion: "w7-v1",
      revision: 3,
      status: "ACTIVE_OPEN",
      displayName: "W10P 위스 경제",
      currencyName: "위스",
      initialGrantAmount: 700,
      integrityVersion: "w10p-aggregate-v1",
      accountCount: 1,
      initializedAccountCount: 1,
      ledgerEntryCount: 2,
      inventoryCount: 1,
      orderCount: 1,
      unresolvedLegacyIssueCount: 0,
      provenance: "CURRENT",
      readOnly: false,
      cutoverPlanId: null,
      createdBy: TEACHER_UID,
      updatedBy: TEACHER_UID,
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    `semester_wis_accounts/${wisAccountId}`,
    owned({
      schemaVersion: 1,
      policyVersion: "w7-v1",
      accountId: wisAccountId,
      semesterId: SEMESTER_ID,
      studentUid: STUDENT_UID,
      displayName: "W10P 학생",
      enrollmentId: ENROLLMENT_ID,
      classId: CLASS_ID,
      status: "ACTIVE",
      provenance: "CURRENT",
      readOnly: false,
      revision: 3,
      balance: 600,
      initialGrantLedgerEntryId: wisLedgerId,
      grade: "3",
      classNumber: "1",
      studentNumber: "1",
      earnedTotal: 700,
      rankEarnedTotal: 700,
      spentTotal: 100,
      adjustedTotal: 0,
      // The bounded visual projection intentionally exposes the one labelled
      // fixture row while the full ledger still attests the pending order.
      recentLedgerEntries: [wisLedgerEntry],
      cutoverPlanId: null,
      createdAt: fixedDate,
      updatedAt: oneDayLater,
      updatedBy: STUDENT_UID,
    }),
  ],
  [
    `semester_wis_balances/${wisAccountId}`,
    owned({
      schemaVersion: 1,
      policyVersion: "w7-v1",
      accountId: wisAccountId,
      semesterId: SEMESTER_ID,
      studentUid: STUDENT_UID,
      balance: 600,
      revision: 1,
      earnedTotal: 700,
      rankEarnedTotal: 700,
      spentTotal: 100,
      adjustedTotal: 0,
      ledgerRevision: 3,
      updatedAt: oneDayLater,
    }),
  ],
  [
    `semester_wis_rankings/${wisAccountId}`,
    owned({
      schemaVersion: 1,
      policyVersion: "w7-v1",
      accountId: wisAccountId,
      semesterId: SEMESTER_ID,
      studentUid: STUDENT_UID,
      displayName: "W10P 학생",
      enrollmentId: ENROLLMENT_ID,
      classId: CLASS_ID,
      grade: "3",
      classNumber: "1",
      balance: 600,
      rankEarnedTotal: 700,
      ledgerRevision: 3,
      rank: 1,
      updatedAt: oneDayLater,
    }),
  ],
  [`semester_wis_ledger/${wisLedgerId}`, owned(wisLedgerEntry)],
  [
    `semester_wis_ledger/${wisOrderDebitLedgerId}`,
    owned(wisOrderDebitLedgerEntry),
  ],
  [
    `wis_product_catalog/${wisProductId}`,
    owned({
      productId: wisProductId,
      schemaVersion: 1,
      policyVersion: "w7-v1",
      revision: 1,
      name: "W10P 위스 상품",
      description: "W10P 시각 검증 상품",
      imageUrl: "",
      active: true,
      createdBy: TEACHER_UID,
      updatedBy: TEACHER_UID,
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    `semester_wis_inventory/${wisInventoryId}`,
    owned({
      schemaVersion: 1,
      policyVersion: "w7-v1",
      inventoryId: wisInventoryId,
      semesterId: SEMESTER_ID,
      productId: wisProductId,
      productRevision: 1,
      productName: "W10P 위스 상품",
      revision: 2,
      price: 100,
      stock: 5,
      available: 4,
      reserved: 1,
      sold: 0,
      active: true,
      createdBy: TEACHER_UID,
      updatedBy: STUDENT_UID,
      createdAt: fixedDate,
      updatedAt: oneDayLater,
    }),
  ],
  [
    `semester_wis_orders/${wisOrderId}`,
    owned({
      schemaVersion: 1,
      policyVersion: "w7-v1",
      orderId: wisOrderId,
      semesterId: SEMESTER_ID,
      accountId: wisAccountId,
      studentUid: STUDENT_UID,
      enrollmentId: ENROLLMENT_ID,
      classId: CLASS_ID,
      inventoryId: wisInventoryId,
      productId: wisProductId,
      productName: "W10P 위스 상품",
      quantity: 1,
      unitPrice: 100,
      totalPrice: 100,
      debitLedgerEntryId: wisOrderDebitLedgerId,
      revision: 1,
      status: "REQUESTED",
      reviewReason: "",
      reviewedBy: "",
      createdAt: oneDayLater,
      reviewedAt: null,
      updatedAt: oneDayLater,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/point_wallets/${STUDENT_UID}`,
    owned({
      uid: STUDENT_UID,
      studentName: "W10P 학생",
      grade: "3",
      class: "1",
      number: "1",
      balance: 600,
      earnedTotal: 700,
      rankEarnedTotal: 700,
      spentTotal: 100,
      adjustedTotal: 0,
      lastTransactionAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/point_transactions/w10p-point-transaction`,
    owned({
      uid: STUDENT_UID,
      type: "manual_adjust",
      activityType: "manual_adjust",
      delta: 700,
      balanceAfter: 700,
      sourceId: "w10p-visual-grant",
      sourceLabel: "W10P 위스 기록",
      policyId: "current",
      createdBy: TEACHER_UID,
      createdAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/point_products/w10p-point-product`,
    owned({
      name: "W10P 위스 상품",
      description: "W10P 시각 검증 상품",
      price: 100,
      stock: 5,
      isActive: true,
      sortOrder: 1,
      imageUrl: "",
      createdAt: fixedDate,
      updatedAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/point_orders/w10p-point-order`,
    owned({
      uid: STUDENT_UID,
      studentName: "W10P 학생",
      grade: "3",
      class: "1",
      number: "1",
      productId: "w10p-point-product",
      productName: "W10P 위스 상품",
      priceSnapshot: 100,
      status: "requested",
      stockDeducted: false,
      requestedAt: fixedDate,
      reviewedBy: "",
      memo: "",
    }),
  ],
  [
    "site_settings/developer_logs/items/w10p-visual-fixture",
    owned({
      title: "W10P 시각 검증 일지",
      version: "W10P",
      category: "improvement",
      summary: "W10P 화면 비교용 합성 개발자 일지입니다.",
      bodyHtml: "<p>W10P 시각 검증 일지 본문입니다.</p>",
      images: [],
      isPinned: true,
      viewCount: 0,
      likeCount: 0,
      createdBy: TEACHER_UID,
      createdByName: "W10P 교사",
      createdAt: fixedDate,
      updatedAt: fixedDate,
      publishedAt: fixedDate,
    }),
  ],
]);

const overwriteDocs = new Map([
  [
    "site_settings/config",
    owned({
      year: YEAR,
      semester: SEMESTER,
      activeSemesterId: SEMESTER_ID,
      activeSemesterRevision: 1,
      semesterLifecycleStatus: "ACTIVE",
      semesterWritesEnabled: true,
      updatedAt: fixedDate,
    }),
  ],
  [
    "site_settings/semester_active",
    owned({
      semesterId: SEMESTER_ID,
      activeSemesterId: SEMESTER_ID,
      revision: 1,
      activeSemesterRevision: 1,
      previousSemesterId: null,
      activatedAt: fixedDate,
      activatedBy: ADMIN_UID,
      commandId: FIXTURE_ID,
    }),
  ],
  [
    MAINTENANCE_PATH,
    {
      enabled: false,
      blockedRoles: ["student"],
      bypassUids: [],
      title: "W10P 시각 검증 점검 안내",
      message: "W10P 시각 검증에서는 점검 모드를 사용하지 않습니다.",
      startedAt: null,
      updatedAt: fixedDate,
      updatedBy: ADMIN_UID,
      revision: 1,
    },
  ],
  [
    "site_settings/school_config",
    owned({
      schoolName: "W10P 시각 검증 학교",
      grades: [{ value: "3", label: "3학년" }],
      classes: [{ value: "1", label: "1반" }],
    }),
  ],
  [
    "site_settings/interface_config",
    owned({ hallOfFame: hallOfFameConfig, hallOfFameRevision: 1 }),
  ],
  [
    `semester_manifests/${SEMESTER_ID}`,
    owned({
      semesterId: SEMESTER_ID,
      schoolYear: YEAR,
      term: SEMESTER,
      displayName: "2026학년도 2학기",
      status: "ACTIVE",
      shellState: "CURRENT",
      startAt: "2026-08-01",
      endAt: "2027-02-28",
      revision: 1,
      stateRevision: 1,
      schemaVersion: 1,
      readinessPolicyVersion: "w3-v1",
      provenance: "CURRENT",
      blockingIssues: [],
      createdAt: fixedDate,
      createdBy: ADMIN_UID,
      updatedAt: fixedDate,
      updatedBy: ADMIN_UID,
      activatedAt: fixedDate,
      activatedBy: ADMIN_UID,
      activationCommandId: FIXTURE_ID,
      closedAt: null,
      closedBy: null,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/curriculum/tree`,
    owned({ tree: curriculumTree, updatedAt: fixedDate }),
  ],
  ["curriculum/tree", owned({ tree: curriculumTree, updatedAt: fixedDate })],
  [
    ASSESSMENT_SETTINGS_PATH,
    {
      "w10p-quiz-unit_formative": {
        active: true,
        questionCount: 1,
        randomOrder: false,
        questionOrder: "fixed",
        timeLimit: 600,
        allowRetake: true,
        cooldown: 0,
        hintLimit: 1,
        visibleTargetGrade: "3",
        visibleClassIds: ["3-1"],
        visibilityVersion: 2,
      },
    },
  ],
  [ASSESSMENT_STATUS_PATH, { "w10p-quiz-unit_formative": true }],
  [
    `years/${YEAR}/semesters/${SEMESTER}/exam_config/final_exam`,
    owned({
      schemaVersion: 1,
      policyVersion: "w10p-w6b-legacy-v1",
      academicYear: YEAR,
      semester: SEMESTER,
      revision: 1,
      objective: [{ score: 37, answer: 1 }],
      subjective: [
        { subItems: [{ score: 0, answer: "W10P 서술형 채점 기준" }] },
      ],
      releaseStatus: "RELEASED",
      releasePolicyVersion: "w6b-answer-release-v1",
      updatedAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/think_cloud_state/current`,
    owned({
      schemaVersion: 1,
      policyVersion: "w8-v1",
      semesterId: SEMESTER_ID,
      activeSessionId: "w10p-think-cloud",
      activeSessionIds: ["w10p-think-cloud"],
      revision: 1,
      updatedAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/think_cloud_state/${CLASS_ID}`,
    owned({
      schemaVersion: 1,
      policyVersion: "w8-v1",
      classId: CLASS_ID,
      semesterId: SEMESTER_ID,
      activeSessionId: "w10p-think-cloud",
      activeSessionIds: ["w10p-think-cloud"],
      revision: 1,
      updatedAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/point_policies/current`,
    owned({
      autoRewardEnabled: true,
      manualAdjustEnabled: true,
      allowNegativeBalance: false,
      attendanceDaily: 10,
      attendanceMonthlyBonus: 0,
      lessonView: 10,
      quizSolve: 10,
      updatedBy: TEACHER_UID,
      updatedAt: fixedDate,
    }),
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/point_public/hall_of_fame`,
    owned({
      year: YEAR,
      semester: SEMESTER,
      snapshotVersion: 7,
      snapshotKey: sha256(`${FIXTURE_ID}\nhall-of-fame`).slice(0, 32),
      rankingMetric: "cumulativeEarned",
      primaryGradeKey: "3",
      gradeTop3ByGrade: {
        3: [
          {
            uid: STUDENT_UID,
            rank: 1,
            podiumSlot: 1,
            grade: "3",
            class: "1",
            classKey: "3-1",
            studentName: "W10P 학생",
            displayName: "W10P 학생",
            currentBalance: 700,
            cumulativeEarned: 700,
            profileIcon: "",
          },
        ],
      },
      classTop3ByClassKey: {
        "3-1": [
          {
            uid: STUDENT_UID,
            rank: 1,
            podiumSlot: 1,
            grade: "3",
            class: "1",
            classKey: "3-1",
            studentName: "W10P 학생",
            displayName: "W10P 학생",
            currentBalance: 700,
            cumulativeEarned: 700,
            profileIcon: "",
          },
        ],
      },
      gradeLeaderboardByGrade: {},
      classLeaderboardByClassKey: {},
      leaderboardPolicy: {
        gradeRankLimit: 10,
        classRankLimit: 10,
        includeTies: true,
        storedRankLimit: 20,
      },
      updatedAt: fixedDate,
      updatedAtMs: fixedDate.getTime(),
      sourceUpdatedAtMs: fixedDate.getTime(),
    }),
  ],
]);

const strictCollections = new Map([
  ["users", [STUDENT_UID, TEACHER_UID, ADMIN_UID]],
  ["student_identities", [STUDENT_UID]],
  [`users/${STUDENT_UID}/history_dictionary_words`, ["w10p-history-term"]],
  [`users/${TEACHER_UID}/history_dictionary_words`, []],
  [`users/${ADMIN_UID}/history_dictionary_words`, []],
  [
    `users/${STUDENT_UID}/performance_scores`,
    ["w10p-roster-performance", "w10p-roster-written"],
  ],
  [`users/${TEACHER_UID}/performance_scores`, []],
  [`users/${ADMIN_UID}/performance_scores`, []],
  [`users/${STUDENT_UID}/sessions`, []],
  [`users/${TEACHER_UID}/sessions`, []],
  [`users/${ADMIN_UID}/sessions`, []],
  ["semester_classes", [CLASS_ID]],
  ["semester_enrollments", [ENROLLMENT_ID]],
  ["semester_enrollment_slots", [slotId]],
  ["semester_learning_contents", ["w10p-learning-content"]],
  ["semester_learning_progress", []],
  ["semester_learning_exemptions", []],
  ["semester_learning_exemption_requests", []],
  ["semester_schedule_events", ["w10p-schedule-event"]],
  ["semester_attendance_sessions", ["w10p-attendance-session"]],
  ["semester_attendance_records", ["w10p-attendance-record"]],
  ["semester_attendance_revisions", []],
  ["semester_notices", ["w10p-notice"]],
  ["semester_notice_deliveries", [NOTICE_DELIVERY_ID]],
  ["semester_notice_acknowledgements", []],
  [`years/${YEAR}/semesters/${SEMESTER}/calendar`, ["w10p-schedule-event"]],
  [`years/${YEAR}/semesters/${SEMESTER}/lessons`, ["w10p-lesson"]],
  ["lessons", ["w10p-lesson"]],
  [`years/${YEAR}/semesters/${SEMESTER}/map_resources`, ["w10p-map"]],
  ["map_resources", ["w10p-map"]],
  [
    `years/${YEAR}/semesters/${SEMESTER}/history_classrooms`,
    ["w10p-history-classroom"],
  ],
  ["history_classrooms", ["w10p-history-classroom"]],
  [`years/${YEAR}/semesters/${SEMESTER}/history_classroom_results`, []],
  ["history_classroom_results", []],
  ["history_dictionary_terms", ["w10p-history-term"]],
  ["history_dictionary_requests", []],
  ["source_archive", ["w10p-source"]],
  [
    `years/${YEAR}/semesters/${SEMESTER}/think_cloud_sessions`,
    ["w10p-think-cloud"],
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/think_cloud_sessions/w10p-think-cloud/responses`,
    ["w10p-response-1", "w10p-response-2"],
  ],
  [`years/${YEAR}/semesters/${SEMESTER}/quiz_questions`, ["1"]],
  [`years/${YEAR}/semesters/${SEMESTER}/quiz_results`, ["w10p-quiz-result"]],
  [
    `years/${YEAR}/semesters/${SEMESTER}/performance_score_rosters`,
    ["w10p-roster-performance", "w10p-roster-written"],
  ],
  [`years/${YEAR}/semesters/${SEMESTER}/grading_plans`, ["w10p-grading-plan"]],
  [
    "semester_grade_records",
    [performanceGrade.recordId, writtenGrade.recordId],
  ],
  [
    "semester_grade_versions",
    [performanceGrade.versionId, writtenGrade.versionId],
  ],
  ["semester_grade_requests", []],
  ["semester_grade_attestations", []],
  ["semester_assessment_attempts", []],
  ["semester_assessment_submissions", []],
  ["semester_assessment_results", []],
  ["semester_wis_economies", [SEMESTER_ID]],
  ["semester_wis_accounts", [wisAccountId]],
  ["semester_wis_balances", [wisAccountId]],
  ["semester_wis_rankings", [wisAccountId]],
  ["semester_wis_ledger", [wisLedgerId, wisOrderDebitLedgerId]],
  ["wis_product_catalog", [wisProductId]],
  ["semester_wis_inventory", [wisInventoryId]],
  ["semester_wis_orders", [wisOrderId]],
  [`years/${YEAR}/semesters/${SEMESTER}/point_wallets`, [STUDENT_UID]],
  [
    `years/${YEAR}/semesters/${SEMESTER}/point_transactions`,
    ["w10p-point-transaction"],
  ],
  [
    `years/${YEAR}/semesters/${SEMESTER}/point_products`,
    ["w10p-point-product"],
  ],
  [`years/${YEAR}/semesters/${SEMESTER}/point_orders`, ["w10p-point-order"]],
  ["site_settings/developer_logs/items", ["w10p-visual-fixture"]],
]);

const gradeEvidenceHashFor = (version) =>
  sha256(
    canonicalJson({
      recordId: version.recordId,
      gradeRevision: version.gradeRevision,
      semesterId: version.semesterId,
      studentUid: version.studentUid,
      enrollmentId: version.enrollmentId,
      classId: version.classId,
      sourceKind: version.sourceKind,
      sourceId: version.sourceId,
      sourceSnapshotHash: version.sourceSnapshotHash,
      scoreKind: version.scoreKind,
      enrollmentSnapshot: version.enrollmentSnapshot,
      title: version.title,
      rubricVersion: version.rubricVersion,
      items: version.items,
      supersedesVersionId: version.supersedesVersionId || "",
    }),
  );

const assertSeedPlanIntegrity = () => {
  for (const [path, data] of createDocs) {
    assert.equal(data.fixtureOwner, FIXTURE_OWNER);
    assert.equal(data.fixtureId, FIXTURE_ID);
    const segments = path.split("/");
    const id = segments.pop();
    const collectionPath = segments.join("/");
    assert.equal(
      strictCollections.has(collectionPath),
      true,
      `Create-only collection is missing from the strict allowlist: ${collectionPath}`,
    );
    assert.equal(
      strictCollections.get(collectionPath).includes(id),
      true,
      `Create-only ID is missing from the strict allowlist: ${collectionPath}`,
    );
  }
  for (const [collectionPath, ids] of strictCollections) {
    assert.equal(
      new Set(ids).size,
      ids.length,
      `Strict allowlist contains duplicate IDs: ${collectionPath}`,
    );
    for (const id of ids) {
      assert.equal(
        createDocs.has(`${collectionPath}/${id}`),
        true,
        `Strict allowlist ID has no create-only fixture document: ${collectionPath}`,
      );
    }
  }
  assert.equal(
    [...strictCollections.values()].reduce(
      (count, ids) => count + ids.length,
      0,
    ),
    createDocs.size,
  );
  assert.ok(
    createDocs.size + overwriteDocs.size + 1 <= 400,
    "Fixture setup must fit in one bounded Firestore batch.",
  );

  for (const [path, data] of overwriteDocs) {
    if (markerlessOverwritePaths.has(path)) {
      assert.equal(Object.hasOwn(data, "fixtureOwner"), false);
      assert.equal(Object.hasOwn(data, "fixtureId"), false);
    } else {
      assert.equal(data.fixtureOwner, FIXTURE_OWNER);
      assert.equal(data.fixtureId, FIXTURE_ID);
    }
  }
  assert.deepEqual(
    [...markerlessOverwritePaths].sort(),
    [MAINTENANCE_PATH, ASSESSMENT_SETTINGS_PATH, ASSESSMENT_STATUS_PATH].sort(),
  );
  const maintenance = overwriteDocs.get(MAINTENANCE_PATH);
  assert.deepEqual(Object.keys(maintenance).sort(), [
    "blockedRoles",
    "bypassUids",
    "enabled",
    "message",
    "revision",
    "startedAt",
    "title",
    "updatedAt",
    "updatedBy",
  ]);
  assert.deepEqual(
    [
      maintenance.enabled,
      maintenance.blockedRoles,
      maintenance.bypassUids,
      maintenance.startedAt,
      maintenance.revision,
    ],
    [false, ["student"], [], null, 1],
  );
  assert.deepEqual(Object.keys(overwriteDocs.get(ASSESSMENT_SETTINGS_PATH)), [
    "w10p-quiz-unit_formative",
  ]);
  assert.deepEqual(Object.keys(overwriteDocs.get(ASSESSMENT_STATUS_PATH)), [
    "w10p-quiz-unit_formative",
  ]);

  const identity = createDocs.get(`student_identities/${STUDENT_UID}`);
  const semesterClass = createDocs.get(`semester_classes/${CLASS_ID}`);
  const enrollment = createDocs.get(`semester_enrollments/${ENROLLMENT_ID}`);
  const enrollmentSlot = createDocs.get(`semester_enrollment_slots/${slotId}`);
  assert.deepEqual(
    [
      identity?.studentUid,
      identity?.accountStatus,
      identity?.revision,
      identity?.provenance,
      identity?.schemaVersion,
    ],
    [STUDENT_UID, "ACTIVE", 1, "CANONICAL", 1],
  );
  assert.deepEqual(
    [
      semesterClass?.semesterId,
      semesterClass?.classKey,
      semesterClass?.status,
      semesterClass?.revision,
      semesterClass?.provenance,
      semesterClass?.schemaVersion,
    ],
    [SEMESTER_ID, "3::1", "ACTIVE", 1, "CANONICAL", 1],
  );
  assert.deepEqual(
    [
      enrollment?.studentUid,
      enrollment?.semesterId,
      enrollment?.classId,
      enrollment?.enrollmentStatus,
      enrollment?.source?.type,
      enrollment?.revision,
      enrollment?.provenance,
      enrollment?.schemaVersion,
    ],
    [
      STUDENT_UID,
      SEMESTER_ID,
      CLASS_ID,
      "ACTIVE",
      "MANUAL_EXCEPTION",
      1,
      "CANONICAL",
      1,
    ],
  );
  assert.deepEqual(
    [
      enrollmentSlot?.slotId,
      enrollmentSlot?.semesterId,
      enrollmentSlot?.studentUid,
      enrollmentSlot?.activeEnrollmentId,
      enrollmentSlot?.revision,
      enrollmentSlot?.status,
    ],
    [slotId, SEMESTER_ID, STUDENT_UID, ENROLLMENT_ID, 1, "ACTIVE"],
  );
  assert.equal(
    NOTICE_DELIVERY_ID,
    hashId("noticedel", "w10p-notice", STUDENT_UID),
  );

  for (const fixture of [performanceGrade, writtenGrade]) {
    assert.match(fixture.recordId, /^grade_[a-f0-9]{64}$/u);
    assert.match(fixture.versionId, /^gradever_[a-f0-9]{64}$/u);
    assert.equal(fixture.record.currentVersionId, fixture.versionId);
    assert.equal(fixture.version.recordId, fixture.recordId);
    assert.equal(
      fixture.version.evidenceHash,
      gradeEvidenceHashFor(fixture.version),
    );
    assert.equal(
      fixture.versionId,
      `gradever_${sha256(
        `${fixture.recordId}\n${fixture.version.gradeRevision}\n${fixture.version.evidenceHash}`,
      )}`,
    );
    assert.equal(fixture.record.evidenceHash, fixture.version.evidenceHash);
    assert.equal(fixture.record.totalScore, fixture.version.totalScore);
    assert.equal(fixture.record.totalMaxScore, fixture.version.totalMaxScore);
  }
};

assertSeedPlanIntegrity();

const plan = {
  fixtureId: FIXTURE_ID,
  fixtureRevision: FIXTURE_REVISION,
  fixtureOwner: FIXTURE_OWNER,
  fixedTime: FIXED_TIME,
  projectId: STAGING_PROJECT_ID,
  authUids: [STUDENT_UID, TEACHER_UID, ADMIN_UID].sort(),
  createDocs: [...createDocs.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  ),
  overwriteDocs: [...overwriteDocs.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  ),
  strictCollections: [...strictCollections.entries()]
    .map(([path, ids]) => [path, [...ids].sort()])
    .sort(([left], [right]) => left.localeCompare(right)),
};
const planHash = sha256(canonicalJson(plan));
const MAX_ATOMIC_STRICT_BACKUP_COUNT =
  500 - overwriteDocs.size - createDocs.size - 2;
const MAX_ATOMIC_BACKUP_COUNT =
  MAX_ATOMIC_STRICT_BACKUP_COUNT + overwriteDocs.size;
assert.ok(
  MAX_ATOMIC_STRICT_BACKUP_COUNT >= 0,
  "The deterministic fixture plan cannot fit an atomic cutover.",
);
const fixtureActors = [
  { role: "student", uid: STUDENT_UID, email: STUDENT_EMAIL },
  { role: "teacher", uid: TEACHER_UID, email: TEACHER_EMAIL },
  { role: "admin", uid: ADMIN_UID, email: ADMIN_EMAIL },
];
const authContractRows = fixtureActors.map(({ role, uid, email }) => ({
  role,
  uidHash: sha256(uid),
  emailHash: sha256(email),
}));
const authAllowedUidSetHash = sha256(
  [STUDENT_UID, TEACHER_UID, ADMIN_UID].sort().join("\n"),
);
const strictAllowlistRows = [...strictCollections.entries()].map(
  ([collectionPath, ids]) => {
    const sortedIds = [...ids].sort();
    return {
      collectionPath,
      allowIdCount: sortedIds.length,
      allowIdSetHash: sha256(sortedIds.join("\n")),
    };
  },
);
const strictAllowlistManifestHash = sha256(canonicalJson(strictAllowlistRows));
const plannedMutationPaths = [
  ...new Set([...createDocs.keys(), ...overwriteDocs.keys()]),
].sort();
const plannedMutationChildAllowlist = new Map(
  plannedMutationPaths.map((path) => {
    const prefix = `${path}/`;
    const allowedChildIds = new Set();
    for (const collectionPath of strictCollections.keys()) {
      if (!collectionPath.startsWith(prefix)) continue;
      const remainder = collectionPath.slice(prefix.length);
      if (remainder && !remainder.includes("/")) {
        allowedChildIds.add(remainder);
      }
    }
    for (const descendantPath of plannedMutationPaths) {
      if (!descendantPath.startsWith(prefix)) continue;
      const segments = descendantPath.slice(prefix.length).split("/");
      if (segments.length >= 2) allowedChildIds.add(segments[0]);
    }
    return [path, [...allowedChildIds].sort()];
  }),
);
const plannedMutationTopologyAllowlistHash = sha256(
  canonicalJson(
    [...plannedMutationChildAllowlist.entries()]
      .map(([path, allowedChildIds]) => ({
        pathHash: sha256(path),
        allowedChildIds,
      }))
      .sort((left, right) => left.pathHash.localeCompare(right.pathHash)),
  ),
);

const allowedEmails = new Set([STUDENT_EMAIL, TEACHER_EMAIL, ADMIN_EMAIL]);
const emailPattern = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/giu;
const forbiddenPatterns = [
  /01[016789]-?\d{3,4}-?\d{4}/gu,
  /\d{6}-?[1-4]\d{6}/gu,
  /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/gu,
];

const collectStrings = (value, output = []) => {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value))
    value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === "object" && !(value instanceof Date)) {
    Object.values(value).forEach((item) => collectStrings(item, output));
  }
  return output;
};

const assertPrivacySafe = (documents) => {
  const strings = documents.flatMap(([, value]) => collectStrings(value));
  const emails = strings.flatMap((value) => value.match(emailPattern) || []);
  assert.equal(
    emails.every((email) => allowedEmails.has(email.toLowerCase())),
    true,
    "Unexpected email found in fixture data.",
  );
  const forbiddenCount = strings.reduce(
    (count, value) =>
      count +
      forbiddenPatterns.reduce((matches, pattern) => {
        pattern.lastIndex = 0;
        return matches + (value.match(pattern)?.length || 0);
      }, 0),
    0,
  );
  assert.equal(
    forbiddenCount,
    0,
    "Forbidden private text found in fixture data.",
  );
  return {
    scannedStringCount: strings.length,
    observedEmailCount: emails.length,
    observedEmailSetHash: sha256(
      [...new Set(emails.map((email) => email.toLowerCase()))]
        .sort()
        .join("\n"),
    ),
    forbiddenPatternCount: 0,
  };
};

const credentialsFromEnvironment = () => {
  let credentials;
  try {
    credentials = JSON.parse(process.env.W10P_VISUAL_CREDENTIALS_JSON || "{}");
  } catch (_error) {
    assert.fail("W10P visual credentials JSON is invalid.");
  }
  const expected = {
    student: STUDENT_EMAIL,
    teacher: TEACHER_EMAIL,
    admin: ADMIN_EMAIL,
  };
  for (const [role, email] of Object.entries(expected)) {
    assert.equal(
      String(credentials?.[role]?.email || "")
        .trim()
        .toLowerCase(),
      email,
      `The ${role} fixture email does not match the fixed contract.`,
    );
    const password = String(credentials?.[role]?.password || "");
    assert.match(
      password,
      /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{16,}$/u,
      `The ${role} fixture password must be a strong temporary password.`,
    );
  }
  return credentials;
};

const firebaseConfigFromEnvironment = () => {
  let firebaseConfig;
  try {
    firebaseConfig = JSON.parse(
      process.env.W10P_VISUAL_FIREBASE_CONFIG_JSON || "{}",
    );
  } catch (_error) {
    assert.fail("W10P visual Firebase config JSON is invalid.");
  }
  assert.ok(
    String(firebaseConfig?.apiKey || "").trim().length >= 20,
    "The staging Firebase API key is required for the live deny probe.",
  );
  assert.equal(
    String(firebaseConfig?.projectId || "").trim(),
    STAGING_PROJECT_ID,
    "The live deny probe Firebase project is not the dedicated staging project.",
  );
  assert.equal(
    String(firebaseConfig?.appId || "").trim(),
    STAGING_APP_ID,
    "The live deny probe Firebase App ID is not the dedicated staging web app.",
  );
  return firebaseConfig;
};

let appCheckDebugTokenSecret = "";
const appCheckDebugTokenFromEnvironment = () => {
  if (!appCheckDebugTokenSecret) {
    appCheckDebugTokenSecret = String(
      process.env.W10P_VISUAL_APPCHECK_DEBUG_TOKEN || "",
    ).trim();
    delete process.env.W10P_VISUAL_APPCHECK_DEBUG_TOKEN;
  }
  assert.equal(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      appCheckDebugTokenSecret,
    ),
    true,
    "A strong registered UUIDv4 App Check debug token is required.",
  );
  return appCheckDebugTokenSecret;
};

const sanitizedAuditArtifactText = (result) => {
  const text = `${JSON.stringify(result)}\n`;
  assert.deepEqual(JSON.parse(text), result);
  assert.equal(
    appCheckDebugTokenSecret ? text.includes(appCheckDebugTokenSecret) : false,
    false,
    "The raw App Check debug token reached the audit artifact.",
  );
  assert.doesNotMatch(
    text,
    /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/u,
    "A token-shaped value reached the audit artifact.",
  );
  assert.doesNotMatch(
    text,
    /@/u,
    "Raw email material reached the audit artifact.",
  );
  const rawFirebaseConfig = String(
    process.env.W10P_VISUAL_FIREBASE_CONFIG_JSON || "",
  );
  if (rawFirebaseConfig) {
    let parsedFirebaseConfig;
    try {
      parsedFirebaseConfig = JSON.parse(rawFirebaseConfig);
    } catch (_error) {
      assert.fail("W10P visual Firebase config JSON is invalid.");
    }
    for (const secret of [parsedFirebaseConfig?.apiKey].filter(Boolean)) {
      assert.equal(
        text.includes(String(secret)),
        false,
        "A Firebase credential reached the audit artifact.",
      );
    }
  }
  const rawCredentials = String(process.env.W10P_VISUAL_CREDENTIALS_JSON || "");
  if (rawCredentials) {
    let parsedCredentials;
    try {
      parsedCredentials = JSON.parse(rawCredentials);
    } catch (_error) {
      assert.fail("W10P visual credentials JSON is invalid.");
    }
    for (const secret of Object.values(parsedCredentials || {}).flatMap(
      (credential) => [credential?.email, credential?.password],
    )) {
      if (!secret) continue;
      assert.equal(
        text.includes(String(secret)),
        false,
        "A fixture credential reached the audit artifact.",
      );
    }
  }
  return text;
};

const writeAuditArtifactAtomically = (result) => {
  assert.ok(auditOutputPath, "The audit output path is missing.");
  const text = sanitizedAuditArtifactText(result);
  const temporaryPath = `${auditOutputPath}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  let renamed = false;
  try {
    writeFileSync(temporaryPath, text, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    assert.equal(
      existsSync(auditOutputPath),
      false,
      "The audit output path appeared during atomic creation.",
    );
    renameSync(temporaryPath, auditOutputPath);
    renamed = true;
    const writtenText = readFileSync(auditOutputPath, "utf8");
    assert.equal(writtenText, text);
    sanitizedAuditArtifactText(JSON.parse(writtenText));
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    if (renamed && existsSync(auditOutputPath)) unlinkSync(auditOutputPath);
    throw error;
  }
};

const assertBackupNamespaceDefaultDenied = () => {
  const rules = readFileSync(resolve("firestore.rules"), "utf8");
  assert.equal(
    rules.includes("w10p_visual_fixture_backups"),
    false,
    "The backup namespace must remain unmatched and default-denied.",
  );
  assert.equal(
    /match\s+\/\{(?:document|path)=\*\*\}\s*\{[\s\S]*?allow\s+(?:read|write|create|update|delete)/u.test(
      rules,
    ),
    false,
    "A root recursive wildcard grant would expose the backup namespace.",
  );
  return {
    namespaceHash: sha256(BACKUP_ROOT_PATH),
    rulesHash: sha256(rules),
    explicitGrantCount: 0,
    rootRecursiveWildcardGrantCount: 0,
    defaultDenyConfirmed: true,
  };
};

const notExecutedBackupAccessProbe = () => {
  const attestation = {
    status: "NOT_EXECUTED",
    requiredLiveAuditStatus: "VERIFIED_DENIED",
    sessionBound: false,
    requestCount: 0,
    temporarySessionWriteCount: 0,
    rawTokenOutputCount: 0,
    rawResponseBodyOutputCount: 0,
    rawDocumentPathOutputCount: 0,
    rawPiiOutputCount: 0,
  };
  return {
    ...attestation,
    attestationHash: sha256(canonicalJson(attestation)),
  };
};

const backupManifestRow = ({ kind, path, exists, dataHash }) => ({
  backupId: sha256(path),
  kind,
  pathHash: sha256(path),
  existed: exists,
  dataHash,
});

const backupManifestFor = (backups) => {
  const rows = backups
    .map(backupManifestRow)
    .sort((left, right) => left.backupId.localeCompare(right.backupId));
  return {
    rows,
    hash: sha256(canonicalJson(rows)),
  };
};

const safeResult = (suite, details = {}) => ({
  suite,
  passed: true,
  artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
  projectId: STAGING_PROJECT_ID,
  fixtureId: FIXTURE_ID,
  fixtureNamespace: FIXTURE_ID,
  fixtureRevision: FIXTURE_REVISION,
  planHash,
  ...details,
  productionAccess: 0,
  rawCredentialOutputCount: 0,
  rawPiiOutputCount: 0,
});

const dryRun = () => {
  const backupNamespace = assertBackupNamespaceDefaultDenied();
  const privacy = assertPrivacySafe([
    ...createDocs.entries(),
    ...overwriteDocs.entries(),
  ]);
  return safeResult("w10p-visual-fixture-dry-run", {
    plannedAuthUserCount: 3,
    authAllowedUidSetHash,
    authRoles: authContractRows,
    plannedCreateDocumentCount: createDocs.size,
    plannedOverwriteDocumentCount: overwriteDocs.size,
    strictCollectionCount: strictCollections.size,
    strictExpectedRowCount: [...strictCollections.values()].reduce(
      (count, ids) => count + ids.length,
      0,
    ),
    strictAllowlistManifestHash,
    strictCollections: strictAllowlistRows,
    isolation: {
      backupSchemaVersion: BACKUP_SCHEMA_VERSION,
      isolationProtocolVersion: ISOLATION_PROTOCOL_VERSION,
      strictCollectionBackupLimit: STRICT_COLLECTION_BACKUP_LIMIT,
      maximumStrictBackupDocumentCount: MAX_ATOMIC_STRICT_BACKUP_COUNT,
      maximumAtomicBackupDocumentCount: MAX_ATOMIC_BACKUP_COUNT,
      atomicFirestoreWriteLimit: 500,
      maximumAtomicRestoreBackupCanonicalBytes:
        MAX_ATOMIC_RESTORE_BACKUP_CANONICAL_BYTES,
      maximumBackupDocumentCanonicalBytes: MAX_BACKUP_DOCUMENT_CANONICAL_BYTES,
      singletonBackupDocumentCount: overwriteDocs.size,
      plannedMutationDocumentCount: plannedMutationPaths.length,
      plannedMutationTopologyAllowlistHash,
      crashSafeSetupStates: [...SETUP_STATES],
      backupNamespace,
      liveBackupAccessProbe: notExecutedBackupAccessProbe(),
    },
    credentialInputEnvironment: "W10P_VISUAL_CREDENTIALS_JSON",
    privacy,
    businessWrites: 0,
    adcNetworkAccess: 0,
  });
};

const verifyIsolationPure = () => {
  const backupNamespace = assertBackupNamespaceDefaultDenied();
  const firestoreTimestampLike = {
    constructor: { name: "Timestamp" },
    seconds: Math.floor(fixedDate.getTime() / 1000),
    nanoseconds: 0,
    toDate: () => new Date(FIXED_TIME),
  };
  assert.equal(
    fixtureValueHash({ createdAt: fixedDate }),
    fixtureValueHash({ createdAt: firestoreTimestampLike }),
    "Fixture value hashing must normalize equivalent Date and Timestamp values.",
  );
  assert.notEqual(
    fixtureValueHash({ createdAt: fixedDate }),
    fixtureValueHash({
      createdAt: {
        ...firestoreTimestampLike,
        seconds: firestoreTimestampLike.seconds + 1,
        toDate: () => new Date(fixedDate.getTime() + 1000),
      },
    }),
    "Fixture value hashing must reject a Timestamp with a different instant.",
  );
  assert.notEqual(
    fixtureValueHash({ createdAt: fixedDate }),
    fixtureValueHash({
      createdAt: {
        ...firestoreTimestampLike,
        nanoseconds: firestoreTimestampLike.nanoseconds + 1,
      },
    }),
    "Fixture value hashing must reject sub-millisecond Timestamp drift.",
  );
  assert.notEqual(
    fixtureValueHash({ value: 7 }),
    fixtureValueHash({ value: { __integer: "7" } }),
    "Fixture value hashing must type-separate integers from map sentinels.",
  );
  assert.notEqual(
    fixtureValueHash({ createdAt: fixedDate }),
    fixtureValueHash({
      createdAt: {
        __timestampSeconds: firestoreTimestampLike.seconds,
        __timestampNanoseconds: 0,
      },
    }),
    "Fixture value hashing must type-separate timestamps from map sentinels.",
  );
  assert.equal(
    compareExactTimestamps(
      { ...firestoreTimestampLike, nanoseconds: 1 },
      firestoreTimestampLike,
    ),
    1,
    "Auxiliary cleanup boundaries must detect a one-nanosecond late update.",
  );
  assert.notEqual(
    sha256(canonicalBackupJson({ createdAt: fixedDate })),
    sha256(canonicalBackupJson({ createdAt: firestoreTimestampLike })),
    "The fixture comparison regression case must exercise distinct backup encodings.",
  );
  const unsafeInt64 = 9_007_199_254_740_993n;
  assert.notEqual(
    sha256(canonicalBackupJson({ value: unsafeInt64 })),
    sha256(canonicalBackupJson({ value: Number(unsafeInt64) })),
    "Backup hashing must preserve int64 identity beyond Number precision.",
  );
  assert.doesNotThrow(() =>
    assertLosslessBackupValue({ integerValue: unsafeInt64, doubleValue: -0 }),
  );
  assert.throws(
    () => assertLosslessBackupValue({ integralDouble: 7 }),
    /integral double/u,
    "A safe integral double must fail closed before isolation writes.",
  );
  assert.throws(
    () =>
      assertLosslessBackupValue({
        reference: {
          constructor: { name: "DocumentReference" },
          path: "users/example",
          formattedName:
            "projects/foreign/databases/foreign/documents/users/example",
        },
      }),
    /cannot prove its original project\/database qualifier/u,
    "Decoded references must fail closed because their original qualifier is not provable.",
  );
  const fixtureReceipt = fixtureCommandReceiptId(
    TEACHER_UID,
    "createLearningContent",
    "018fd342-b2c1-7a11-8f9e-123456789abc",
  );
  assert.match(fixtureReceipt, /^cmd_[a-f0-9]{64}$/u);
  assert.notEqual(
    fixtureReceipt,
    fixtureCommandReceiptId(
      STUDENT_UID,
      "createLearningContent",
      "018fd342-b2c1-7a11-8f9e-123456789abc",
    ),
    "Receipt ownership must be bound to the exact fixture actor.",
  );
  const auxiliaryMaximumDeleteCount =
    fixtureActors.length * AUXILIARY_COMMAND_LIMIT_PER_IDENTITY * 2 +
    fixtureActors.length * AUXILIARY_SESSION_LIMIT_PER_IDENTITY +
    fixtureActors.length;
  assert.ok(auxiliaryMaximumDeleteCount <= AUXILIARY_DELETE_LIMIT);
  assert.ok(
    MAX_ATOMIC_BACKUP_COUNT < 500,
    "All backup documents must fit one atomic create batch.",
  );
  const classifyPreparingBackupCount = (actualCount, expectedCount) => {
    if (actualCount === 0) return "EMPTY";
    assert.equal(
      actualCount,
      expectedCount,
      "A partial PREPARING backup must fail closed.",
    );
    return "COMPLETE";
  };
  assert.equal(classifyPreparingBackupCount(0, 449), "EMPTY");
  assert.equal(classifyPreparingBackupCount(449, 449), "COMPLETE");
  assert.throws(() => classifyPreparingBackupCount(400, 449), /partial/u);
  const initialRows = new Map([
    ["collection/non-fixture-a", { revision: 7, nested: { value: "alpha" } }],
    ["collection/non-fixture-b", { revision: 9, values: [1, 2, 3] }],
    ["singleton/existing", { enabled: true, revision: 11 }],
  ]);
  const backups = [
    ...[...initialRows]
      .filter(([path]) => path.startsWith("collection/"))
      .map(([path, data]) => ({
        kind: "STRICT_ISOLATION",
        path,
        exists: true,
        data,
        dataHash: sha256(canonicalBackupJson(data)),
      })),
    {
      kind: "SINGLETON_OVERWRITE",
      path: "singleton/existing",
      exists: true,
      data: initialRows.get("singleton/existing"),
      dataHash: sha256(
        canonicalBackupJson(initialRows.get("singleton/existing")),
      ),
    },
    {
      kind: "SINGLETON_OVERWRITE",
      path: "singleton/absent",
      exists: false,
      data: null,
      dataHash: sha256(canonicalBackupJson(null)),
    },
  ];
  const fixtureSeeds = new Map([
    ["collection/fixture", owned({ revision: 1 })],
    ["singleton/existing", { enabled: false, revision: 1 }],
    ["singleton/absent", { enabled: false, revision: 1 }],
  ]);
  const manifest = backupManifestFor(backups);

  const cloneStore = (store) =>
    new Map([...store].map(([path, data]) => [path, structuredClone(data)]));
  const storeEntries = (store) =>
    [...store.entries()].sort(([left], [right]) => left.localeCompare(right));
  const valueHash = (value) => sha256(canonicalBackupJson(value));
  const restorePure = (current, expectedPhase) => {
    const before = cloneStore(current);
    const backupByPath = new Map(
      backups.map((backup) => [backup.path, backup]),
    );
    const expectedStrictPaths = (
      expectedPhase === "FIXTURE"
        ? [...fixtureSeeds.keys()]
        : [...backupByPath.keys()]
    )
      .filter((path) => path.startsWith("collection/"))
      .sort();
    const actualStrictPaths = [...current.keys()]
      .filter((path) => path.startsWith("collection/"))
      .sort();
    assert.deepEqual(
      actualStrictPaths,
      expectedStrictPaths,
      "Strict cleanup phase mismatch blocks restore.",
    );
    if (expectedPhase === "FIXTURE") {
      for (const [path, data] of fixtureSeeds) {
        assert.equal(current.has(path), true, "Fixture phase row is missing.");
        assert.equal(
          valueHash(current.get(path)),
          valueHash(data),
          "Unknown fixture phase value blocks restore.",
        );
      }
    } else {
      for (const backup of backups) {
        assert.equal(
          current.has(backup.path),
          backup.exists,
          "Original cleanup phase existence mismatch blocks restore.",
        );
        assert.equal(
          valueHash(current.has(backup.path) ? current.get(backup.path) : null),
          backup.dataHash,
          "Unknown original phase value blocks restore.",
        );
      }
    }
    for (const path of fixtureSeeds.keys()) current.delete(path);
    for (const backup of backups) {
      if (backup.exists) current.set(backup.path, structuredClone(backup.data));
      else current.delete(backup.path);
    }
    return { before, restored: current };
  };
  const setupCutoverPure = (current) => {
    const before = cloneStore(current);
    for (const backup of backups) {
      const currentExists = current.has(backup.path);
      assert.equal(
        currentExists,
        backup.exists,
        "Setup inventory existence changed before cutover.",
      );
      assert.equal(
        valueHash(currentExists ? current.get(backup.path) : null),
        backup.dataHash,
        "Setup inventory value changed before cutover.",
      );
    }
    const expectedStrictPaths = backups
      .filter((backup) => backup.kind === "STRICT_ISOLATION")
      .map((backup) => backup.path)
      .sort();
    const actualStrictPaths = [...current.keys()]
      .filter((path) => path.startsWith("collection/"))
      .sort();
    assert.deepEqual(
      actualStrictPaths,
      expectedStrictPaths,
      "Setup strict cardinality changed before cutover.",
    );
    for (const backup of backups.filter(
      (item) => item.kind === "STRICT_ISOLATION",
    )) {
      current.delete(backup.path);
    }
    for (const [path, data] of fixtureSeeds) {
      current.set(path, structuredClone(data));
    }
    return { before, isolated: current };
  };

  const crashStates = [
    "ACCESS_PROBING",
    "PREPARING",
    "BACKUP_READY",
    "ISOLATING",
    "ISOLATED",
    "AUTH_CREATING",
    "AUTH_READY",
    "READY",
    "CLEANING",
    "RESTORING",
    "RESTORED",
  ];
  let verifiedCrashStateCount = 0;
  for (const state of crashStates) {
    const store = cloneStore(initialRows);
    if (["READY", "CLEANING"].includes(state)) {
      setupCutoverPure(store);
    }
    const expectedPhase = ["READY", "CLEANING"].includes(state)
      ? "FIXTURE"
      : "ORIGINAL";
    restorePure(store, expectedPhase);
    assert.deepEqual(
      storeEntries(store),
      storeEntries(initialRows),
      `Pure isolation restore failed for ${state}.`,
    );
    restorePure(store, "ORIGINAL");
    assert.deepEqual(
      storeEntries(store),
      storeEntries(initialRows),
      `Pure isolation restore reentry failed for ${state}.`,
    );
    verifiedCrashStateCount += 1;
  }

  const setupRaceStore = cloneStore(initialRows);
  setupRaceStore.set("collection/non-fixture-a", { revision: 8 });
  const setupRaceBefore = cloneStore(setupRaceStore);
  assert.throws(
    () => setupCutoverPure(setupRaceStore),
    /changed before cutover/u,
  );
  assert.deepEqual(storeEntries(setupRaceStore), storeEntries(setupRaceBefore));

  const cleanupConflicts = [
    ["set", "collection/non-fixture-a", { revision: 8 }],
    ["set", "singleton/existing", { enabled: true, revision: 12 }],
    ["set", "collection/concurrent-extra", { revision: 1 }],
    ["delete", "singleton/existing", null],
  ];
  let conflictZeroOverwriteCount = 0;
  for (const [operation, path, value] of cleanupConflicts) {
    const conflictStore = cloneStore(initialRows);
    setupCutoverPure(conflictStore);
    if (operation === "delete") conflictStore.delete(path);
    else conflictStore.set(path, value);
    const conflictBefore = cloneStore(conflictStore);
    assert.throws(
      () => restorePure(conflictStore, "FIXTURE"),
      /blocks restore|phase row is missing/u,
    );
    assert.deepEqual(
      storeEntries(conflictStore),
      storeEntries(conflictBefore),
      "A cleanup conflict must perform zero overwrite.",
    );
    conflictZeroOverwriteCount += 1;
  }
  const preReadyDeleteStore = cloneStore(initialRows);
  preReadyDeleteStore.delete("collection/non-fixture-a");
  const preReadyDeleteBefore = cloneStore(preReadyDeleteStore);
  assert.throws(
    () => restorePure(preReadyDeleteStore, "ORIGINAL"),
    /phase existence mismatch|phase mismatch/u,
  );
  assert.deepEqual(
    storeEntries(preReadyDeleteStore),
    storeEntries(preReadyDeleteBefore),
    "A pre-READY concurrent delete must perform zero overwrite.",
  );
  conflictZeroOverwriteCount += 1;
  assert.throws(
    () =>
      assert.ok(
        STRICT_COLLECTION_BACKUP_LIMIT + 1 <= STRICT_COLLECTION_BACKUP_LIMIT,
        "Strict collection backup overflow.",
      ),
    /overflow/u,
  );
  assert.throws(
    () =>
      assert.ok(
        MAX_ATOMIC_STRICT_BACKUP_COUNT + 1 <= MAX_ATOMIC_STRICT_BACKUP_COUNT,
        "Atomic strict backup write limit exceeded.",
      ),
    /Atomic strict backup write limit/u,
  );
  assert.throws(
    () =>
      assert.ok(
        MAX_ATOMIC_RESTORE_BACKUP_CANONICAL_BYTES + 1 <=
          MAX_ATOMIC_RESTORE_BACKUP_CANONICAL_BYTES,
        "Atomic restore byte limit exceeded.",
      ),
    /Atomic restore byte limit/u,
  );
  assert.throws(
    () =>
      assert.ok(
        MAX_BACKUP_DOCUMENT_CANONICAL_BYTES + 1 <=
          MAX_BACKUP_DOCUMENT_CANONICAL_BYTES,
        "Backup document byte limit exceeded.",
      ),
    /Backup document byte limit/u,
  );
  assert.throws(
    () => assert.fail("A create-only fixture document already exists."),
    /already exists/u,
  );
  const preBackupGateProjection = {
    status: "VERIFIED_DENIED",
    appCheckBound: true,
    appCheckProjectBindingVerified: true,
    appCheckAppBindingVerified: true,
    appCheckTokenValidAtVerification: true,
    appCheckTokenLifetimeWithinMaximum: true,
    appCheckDebugTokenHash: "a".repeat(64),
    verifiedAppIdHash: sha256(STAGING_APP_ID),
    verifiedProjectIdHash: sha256(STAGING_PROJECT_ID),
    verifiedProjectNumberHash: sha256(STAGING_PROJECT_NUMBER),
    verifiedAudienceSetHash: sha256(
      canonicalJson(APP_CHECK_VERIFIED_AUDIENCE_SET),
    ),
    verifiedIssuerHash: sha256(APP_CHECK_VERIFIED_ISSUER),
    exchangeEndpointHash: sha256(APP_CHECK_EXCHANGE_ENDPOINT),
    exchangeTransportContractHash: sha256(
      canonicalJson(APP_CHECK_EXCHANGE_TRANSPORT_CONTRACT),
    ),
    appCheckExchangeRequestCount: 1,
    appCheckAdminVerificationCount: 1,
    appCheckHeaderRequestCount: 6,
    requestCount: 8,
    positiveControlPassed: true,
    readDenied: true,
    writeDenied: true,
    updateDenied: true,
    deleteDenied: true,
    createDenied: true,
    rawBackupWriteCount: 0,
    canaryResidualCount: 0,
    ephemeralAuthResidualCount: 0,
    ephemeralProfileResidualCount: 0,
    temporarySessionResidualCount: 0,
    positiveControlResidualCount: 0,
    rawAppCheckDebugTokenOutputCount: 0,
    rawAppCheckJwtOutputCount: 0,
  };
  const preBackupGate = (probe, onRawBackupWrite) => {
    assert.equal(probe.status, "VERIFIED_DENIED");
    for (const field of [
      "readDenied",
      "writeDenied",
      "updateDenied",
      "deleteDenied",
      "createDenied",
      "positiveControlPassed",
      "appCheckBound",
      "appCheckProjectBindingVerified",
      "appCheckAppBindingVerified",
      "appCheckTokenValidAtVerification",
      "appCheckTokenLifetimeWithinMaximum",
    ]) {
      assert.equal(probe[field], true);
    }
    for (const field of [
      "rawBackupWriteCount",
      "canaryResidualCount",
      "ephemeralAuthResidualCount",
      "ephemeralProfileResidualCount",
      "temporarySessionResidualCount",
      "positiveControlResidualCount",
      "rawAppCheckDebugTokenOutputCount",
      "rawAppCheckJwtOutputCount",
    ]) {
      assert.equal(probe[field], 0);
    }
    assert.match(probe.appCheckDebugTokenHash, /^[a-f0-9]{64}$/u);
    assert.equal(probe.verifiedAppIdHash, sha256(STAGING_APP_ID));
    assert.equal(probe.verifiedProjectIdHash, sha256(STAGING_PROJECT_ID));
    assert.equal(
      probe.verifiedProjectNumberHash,
      sha256(STAGING_PROJECT_NUMBER),
    );
    assert.equal(
      probe.verifiedAudienceSetHash,
      sha256(canonicalJson(APP_CHECK_VERIFIED_AUDIENCE_SET)),
    );
    assert.equal(probe.verifiedIssuerHash, sha256(APP_CHECK_VERIFIED_ISSUER));
    assert.equal(
      probe.exchangeEndpointHash,
      sha256(APP_CHECK_EXCHANGE_ENDPOINT),
    );
    assert.equal(
      probe.exchangeTransportContractHash,
      sha256(canonicalJson(APP_CHECK_EXCHANGE_TRANSPORT_CONTRACT)),
    );
    assert.equal(probe.appCheckExchangeRequestCount, 1);
    assert.equal(probe.appCheckAdminVerificationCount, 1);
    assert.equal(probe.appCheckHeaderRequestCount, 6);
    assert.equal(probe.requestCount, 8);
    onRawBackupWrite();
  };
  let successfulPreBackupGateWriteCount = 0;
  preBackupGate(preBackupGateProjection, () => {
    successfulPreBackupGateWriteCount += 1;
  });
  assert.equal(successfulPreBackupGateWriteCount, 1);
  const preBackupFailureCases = [
    null,
    { ...preBackupGateProjection, status: "NOT_EXECUTED" },
    { ...preBackupGateProjection, appCheckBound: false },
    { ...preBackupGateProjection, appCheckProjectBindingVerified: false },
    { ...preBackupGateProjection, appCheckAppBindingVerified: false },
    { ...preBackupGateProjection, appCheckTokenValidAtVerification: false },
    { ...preBackupGateProjection, appCheckTokenLifetimeWithinMaximum: false },
    { ...preBackupGateProjection, appCheckDebugTokenHash: "not-a-hash" },
    { ...preBackupGateProjection, verifiedAppIdHash: "b".repeat(64) },
    { ...preBackupGateProjection, verifiedAudienceSetHash: "b".repeat(64) },
    { ...preBackupGateProjection, exchangeEndpointHash: "b".repeat(64) },
    {
      ...preBackupGateProjection,
      exchangeTransportContractHash: "b".repeat(64),
    },
    { ...preBackupGateProjection, appCheckExchangeRequestCount: 0 },
    { ...preBackupGateProjection, appCheckAdminVerificationCount: 0 },
    { ...preBackupGateProjection, appCheckHeaderRequestCount: 5 },
    { ...preBackupGateProjection, requestCount: 7 },
    { ...preBackupGateProjection, positiveControlPassed: false },
    { ...preBackupGateProjection, readDenied: false },
    { ...preBackupGateProjection, writeDenied: false },
    { ...preBackupGateProjection, updateDenied: false },
    { ...preBackupGateProjection, deleteDenied: false },
    { ...preBackupGateProjection, createDenied: false },
    { ...preBackupGateProjection, rawBackupWriteCount: 1 },
    { ...preBackupGateProjection, canaryResidualCount: 1 },
    { ...preBackupGateProjection, ephemeralAuthResidualCount: 1 },
    { ...preBackupGateProjection, ephemeralProfileResidualCount: 1 },
    { ...preBackupGateProjection, temporarySessionResidualCount: 1 },
    { ...preBackupGateProjection, positiveControlResidualCount: 1 },
    { ...preBackupGateProjection, rawAppCheckDebugTokenOutputCount: 1 },
    { ...preBackupGateProjection, rawAppCheckJwtOutputCount: 1 },
  ];
  let preBackupFailureRawBackupWriteCount = 0;
  for (const invalid of preBackupFailureCases) {
    assert.throws(() =>
      preBackupGate(invalid, () => {
        preBackupFailureRawBackupWriteCount += 1;
      }),
    );
  }
  assert.equal(preBackupFailureRawBackupWriteCount, 0);
  const preBackupCrashArtifactRows = [
    [
      "auth",
      { owner: FIXTURE_OWNER, revision: PRE_BACKUP_PROBE_REVISION_HASH },
    ],
    [
      "profile",
      { owner: FIXTURE_OWNER, revision: PRE_BACKUP_PROBE_REVISION_HASH },
    ],
    [
      "session",
      { owner: FIXTURE_OWNER, revision: PRE_BACKUP_PROBE_REVISION_HASH },
    ],
    [
      "positive-control",
      { owner: FIXTURE_OWNER, revision: PRE_BACKUP_PROBE_REVISION_HASH },
    ],
    [
      "existing-canary",
      {
        owner: FIXTURE_OWNER,
        revision: PRE_BACKUP_EXISTING_WRITE_CANARY.revisionHash,
      },
    ],
    [
      "absent-canary",
      {
        owner: FIXTURE_OWNER,
        revision: PRE_BACKUP_ABSENT_WRITE_CANARY.revisionHash,
      },
    ],
  ];
  const cleanupPreBackupCrashArtifactsPure = (artifacts) => {
    const before = new Map(artifacts);
    for (const [key, value] of artifacts) {
      assert.equal(value.owner, FIXTURE_OWNER);
      const expectedRevision =
        key === "existing-canary"
          ? PRE_BACKUP_EXISTING_WRITE_CANARY.revisionHash
          : key === "absent-canary"
            ? PRE_BACKUP_ABSENT_WRITE_CANARY.revisionHash
            : PRE_BACKUP_PROBE_REVISION_HASH;
      assert.equal(value.revision, expectedRevision);
    }
    artifacts.clear();
    return before.size;
  };
  let preBackupProbeCrashRecoveryCaseCount = 0;
  for (let count = 0; count <= preBackupCrashArtifactRows.length; count += 1) {
    const artifacts = new Map(preBackupCrashArtifactRows.slice(0, count));
    assert.equal(cleanupPreBackupCrashArtifactsPure(artifacts), count);
    assert.equal(artifacts.size, 0);
    preBackupProbeCrashRecoveryCaseCount += 1;
  }
  const foreignPreBackupArtifact = new Map([
    [
      "positive-control",
      { owner: "foreign", revision: PRE_BACKUP_PROBE_REVISION_HASH },
    ],
  ]);
  const foreignPreBackupArtifactBefore = structuredClone([
    ...foreignPreBackupArtifact,
  ]);
  assert.throws(() =>
    cleanupPreBackupCrashArtifactsPure(foreignPreBackupArtifact),
  );
  assert.deepEqual(
    [...foreignPreBackupArtifact],
    foreignPreBackupArtifactBefore,
  );
  const actualBackupSentinel = {
    owner: FIXTURE_OWNER,
    revision: "actual-backup-document",
    dataHash: sha256("actual-backup-sentinel"),
  };
  const postBackupCrashArtifactRows = [
    [
      "existing-canary",
      { owner: FIXTURE_OWNER, revision: EXISTING_WRITE_CANARY.revisionHash },
    ],
    [
      "absent-canary",
      { owner: FIXTURE_OWNER, revision: ABSENT_WRITE_CANARY.revisionHash },
    ],
    [
      "probe-session",
      { owner: FIXTURE_OWNER, revision: POST_BACKUP_PROBE_REVISION_HASH },
    ],
  ];
  const cleanupPostBackupCrashArtifactsPure = (store) => {
    for (const [key, value] of store) {
      if (key === "actual-backup") continue;
      assert.equal(value.owner, FIXTURE_OWNER);
      const expectedRevision =
        key === "existing-canary"
          ? EXISTING_WRITE_CANARY.revisionHash
          : key === "absent-canary"
            ? ABSENT_WRITE_CANARY.revisionHash
            : POST_BACKUP_PROBE_REVISION_HASH;
      assert.equal(value.revision, expectedRevision);
    }
    for (const [key] of postBackupCrashArtifactRows) store.delete(key);
  };
  let postBackupProbeCrashRecoveryCaseCount = 0;
  for (let count = 0; count <= postBackupCrashArtifactRows.length; count += 1) {
    const store = new Map([
      ["actual-backup", structuredClone(actualBackupSentinel)],
      ...structuredClone(postBackupCrashArtifactRows.slice(0, count)),
    ]);
    cleanupPostBackupCrashArtifactsPure(store);
    assert.deepEqual([...store], [["actual-backup", actualBackupSentinel]]);
    postBackupProbeCrashRecoveryCaseCount += 1;
  }
  const foreignPostBackupArtifact = new Map([
    ["actual-backup", structuredClone(actualBackupSentinel)],
    [
      "existing-canary",
      { owner: "foreign", revision: EXISTING_WRITE_CANARY.revisionHash },
    ],
  ]);
  const foreignPostBackupArtifactBefore = structuredClone([
    ...foreignPostBackupArtifact,
  ]);
  assert.throws(() =>
    cleanupPostBackupCrashArtifactsPure(foreignPostBackupArtifact),
  );
  assert.deepEqual(
    [...foreignPostBackupArtifact],
    foreignPostBackupArtifactBefore,
  );
  return safeResult("w10p-visual-fixture-isolation-pure", {
    verifiedCrashStateCount,
    restoredDocumentCount: backups.length,
    restoredExistingDocumentCount: backups.filter((backup) => backup.exists)
      .length,
    restoredAbsentDocumentCount: backups.filter((backup) => !backup.exists)
      .length,
    exactRestoreHash: sha256(canonicalJson([...initialRows])),
    backupManifestHash: manifest.hash,
    setupTransactionRaceFailClosedCount: 1,
    cleanupTransactionRaceFailClosedCount: cleanupConflicts.length + 1,
    conflictZeroOverwriteCount,
    cleanupReentryCount: crashStates.length,
    overflowFailClosedCount: 1,
    atomicWriteLimitFailClosedCount: 1,
    atomicRestoreByteLimitFailClosedCount: 1,
    backupDocumentByteLimitFailClosedCount: 1,
    fixtureIdCollisionFailClosedCount: 1,
    preBackupProbeFailureCaseCount: preBackupFailureCases.length,
    preBackupFailureRawBackupWriteCount,
    preBackupProbeCrashRecoveryCaseCount,
    preBackupProbeForeignArtifactFailClosedCount: 1,
    postBackupProbeCrashRecoveryCaseCount,
    postBackupProbeForeignArtifactFailClosedCount: 1,
    postBackupProbeActualBackupUntouchedCount:
      postBackupProbeCrashRecoveryCaseCount,
    fixtureTimestampNormalizationCaseCount: 1,
    fixtureTimestampDriftRejectionCount: 1,
    fixtureTimestampSubMillisecondDriftRejectionCount: 1,
    fixtureTypeDomainCollisionRejectionCount: 2,
    backupInt64PrecisionCaseCount: 1,
    backupIntegralDoubleFailClosedCaseCount: 1,
    backupReferenceQualifierFailClosedCount: 1,
    atomicBackupCreateBatchMaximum: MAX_ATOMIC_BACKUP_COUNT,
    preparingBackupRecoveryCaseCount: 2,
    preparingPartialBackupFailClosedCount: 1,
    auxiliaryReceiptOwnershipCaseCount: 2,
    auxiliaryNanosecondBoundaryRejectionCount: 1,
    auxiliaryMaximumDeleteCount,
    userNotificationDeleteCount: 0,
    backupNamespace,
    businessWrites: 0,
    adcNetworkAccess: 0,
  });
};

if (mode === "dry-run") {
  console.log(JSON.stringify(dryRun()));
  process.exit(0);
}

if (mode === "verify-isolation") {
  console.log(JSON.stringify(verifyIsolationPure()));
  process.exit(0);
}

let app;
let backupApp;
let auth;
let appCheck;
let db;
let backupDb;
let deleteAdminApp;

const initializeAdmin = () => {
  for (const emulatorVariable of [
    "FIRESTORE_EMULATOR_HOST",
    "FIREBASE_AUTH_EMULATOR_HOST",
  ]) {
    assert.equal(
      String(process.env[emulatorVariable] || "").trim(),
      "",
      `${emulatorVariable} must be unset for the staging fixture.`,
    );
  }
  const requireFromFunctions = createRequire(resolve("functions/package.json"));
  const { applicationDefault, deleteApp, initializeApp } =
    requireFromFunctions("firebase-admin/app");
  const { getAuth } = requireFromFunctions("firebase-admin/auth");
  const { getAppCheck } = requireFromFunctions("firebase-admin/app-check");
  const { getFirestore } = requireFromFunctions("firebase-admin/firestore");
  deleteAdminApp = deleteApp;
  const appName = `w10p-visual-${sha256(`${FIXTURE_ID}\n${process.pid}`).slice(
    0,
    12,
  )}`;
  app = initializeApp(
    { credential: applicationDefault(), projectId: STAGING_PROJECT_ID },
    appName,
  );
  backupApp = initializeApp(
    { credential: applicationDefault(), projectId: STAGING_PROJECT_ID },
    `${appName}-lossless`,
  );
  auth = getAuth(app);
  appCheck = getAppCheck(app);
  db = getFirestore(app);
  backupDb = getFirestore(backupApp);
  backupDb.settings({ useBigInt: true });
};

const exchangeAndVerifyAppCheckToken = async (firebaseConfig) => {
  const debugToken = appCheckDebugTokenFromEnvironment();
  const response = await fetch(
    `${APP_CHECK_EXCHANGE_ENDPOINT}?key=${encodeURIComponent(
      firebaseConfig.apiKey,
    )}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: STAGING_VISUAL_ORIGIN,
        referer: `${STAGING_VISUAL_ORIGIN}/`,
      },
      body: JSON.stringify({ debug_token: debugToken }),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    },
  );
  assert.equal(
    response.status,
    200,
    `The registered App Check debug token exchange failed with HTTP ${response.status}.`,
  );
  let exchangePayload = await response.json();
  let token = String(exchangePayload?.token || "");
  const ttlMatch = String(exchangePayload?.ttl || "").match(/^([\d.]+)s$/u);
  assert.ok(ttlMatch, "The App Check exchange TTL is invalid.");
  const exchangedTtlSeconds = Number(ttlMatch[1]);
  assert.ok(
    exchangedTtlSeconds > 0,
    "The App Check exchange TTL must be positive.",
  );
  assert.ok(
    exchangedTtlSeconds <= 7 * 24 * 60 * 60,
    "The App Check exchange TTL exceeds the maximum validity window.",
  );
  assert.equal(
    /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$/u.test(token),
    true,
    "The App Check exchange did not return a signed token.",
  );
  const verification = await appCheck.verifyToken(token);
  const decoded = verification?.token || {};
  assert.equal(verification?.appId, STAGING_APP_ID);
  assert.equal(decoded.app_id, STAGING_APP_ID);
  assert.equal(decoded.sub, STAGING_APP_ID);
  assert.deepEqual(
    [...new Set(decoded.aud || [])].sort(),
    APP_CHECK_VERIFIED_AUDIENCE_SET,
  );
  assert.equal(decoded.iss, APP_CHECK_VERIFIED_ISSUER);
  const issuedAt = Number(decoded.iat || 0);
  const expiresAt = Number(decoded.exp || 0);
  const verifiedAt = Math.floor(Date.now() / 1_000);
  assert.ok(Number.isSafeInteger(issuedAt) && issuedAt > 0);
  assert.ok(Number.isSafeInteger(expiresAt) && expiresAt > issuedAt);
  assert.ok(issuedAt <= verifiedAt + 60);
  assert.ok(expiresAt >= verifiedAt + 60);
  assert.ok(expiresAt - issuedAt <= 7 * 24 * 60 * 60);
  assert.ok(
    Math.abs(expiresAt - issuedAt - exchangedTtlSeconds) <= 5,
    "The verified App Check lifetime does not match the exchange TTL.",
  );
  const binding = {
    appCheckBound: true,
    appCheckExchangeHttpStatus: response.status,
    appCheckExchangeRequestCount: 1,
    appCheckAdminVerificationCount: 1,
    appCheckProjectBindingVerified: true,
    appCheckAppBindingVerified: true,
    appCheckTokenValidAtVerification: true,
    appCheckTokenLifetimeWithinMaximum: true,
    appCheckDebugTokenHash: sha256(debugToken),
    verifiedAppIdHash: sha256(STAGING_APP_ID),
    verifiedProjectIdHash: sha256(STAGING_PROJECT_ID),
    verifiedProjectNumberHash: sha256(STAGING_PROJECT_NUMBER),
    verifiedAudienceSetHash: sha256(
      canonicalJson(APP_CHECK_VERIFIED_AUDIENCE_SET),
    ),
    verifiedIssuerHash: sha256(decoded.iss),
    exchangeEndpointHash: sha256(APP_CHECK_EXCHANGE_ENDPOINT),
    exchangeTransportContractHash: sha256(
      canonicalJson(APP_CHECK_EXCHANGE_TRANSPORT_CONTRACT),
    ),
    rawAppCheckDebugTokenOutputCount: 0,
    rawAppCheckJwtOutputCount: 0,
  };
  exchangePayload = null;
  return {
    token,
    binding,
    clear: () => {
      token = "";
    },
  };
};

const getSnapshots = async (paths) => {
  const snapshots = [];
  for (let index = 0; index < paths.length; index += 100) {
    snapshots.push(
      ...(await db.getAll(
        ...paths.slice(index, index + 100).map((path) => db.doc(path)),
      )),
    );
  }
  return snapshots;
};

const getBackupSnapshots = async (paths) => {
  const snapshots = [];
  for (let index = 0; index < paths.length; index += 100) {
    snapshots.push(
      ...(await backupDb.getAll(
        ...paths.slice(index, index + 100).map((path) => backupDb.doc(path)),
      )),
    );
  }
  return snapshots;
};

const assertAuthAbsent = async (uid, email) => {
  await assert.rejects(
    auth.getUser(uid),
    (error) => error?.code === "auth/user-not-found",
    "A fixed fixture Auth UID already exists.",
  );
  await assert.rejects(
    auth.getUserByEmail(email),
    (error) => error?.code === "auth/user-not-found",
    "A fixed fixture Auth email already exists.",
  );
};

const exactAuthFixtureIdentityScopeAudit = async ({ expectedSeeded }) => {
  const identities = [
    ["student", STUDENT_UID, STUDENT_EMAIL],
    ["teacher", TEACHER_UID, TEACHER_EMAIL],
    ["admin", ADMIN_UID, ADMIN_EMAIL],
  ];
  const rows = [];
  for (const [role, uid, email] of identities) {
    const [uidLookup, emailLookup] = await Promise.allSettled([
      auth.getUser(uid),
      auth.getUserByEmail(email),
    ]);
    const uidPresent = uidLookup.status === "fulfilled";
    const emailPresent = emailLookup.status === "fulfilled";
    if (expectedSeeded) {
      assert.equal(
        uidLookup.status,
        "fulfilled",
        "A scoped fixture Auth UID is missing.",
      );
      assert.equal(
        emailLookup.status,
        "fulfilled",
        "A scoped fixture Auth email is missing.",
      );
      const uidUser = uidLookup.value;
      const emailUser = emailLookup.value;
      assert.equal(uidUser.uid, uid);
      assert.equal(emailUser.uid, uid);
      assert.equal(String(uidUser.email || "").toLowerCase(), email);
      assert.equal(String(emailUser.email || "").toLowerCase(), email);
      for (const user of [uidUser, emailUser]) {
        assert.deepEqual(user.customClaims || {}, {
          fixtureOwner: FIXTURE_OWNER,
          fixtureId: FIXTURE_ID,
          fixtureRole: role,
        });
      }
    } else {
      for (const lookup of [uidLookup, emailLookup]) {
        assert.equal(
          lookup.status,
          "rejected",
          "A scoped fixture Auth identity already exists.",
        );
        assert.equal(
          lookup.reason?.code,
          "auth/user-not-found",
          "A scoped fixture Auth absence lookup failed unexpectedly.",
        );
      }
    }
    rows.push({
      role,
      uidHash: sha256(uid),
      emailHash: sha256(email),
      expectedPresent: expectedSeeded,
      actualPresent: uidPresent && emailPresent,
      uidExpectationMatched: uidPresent === expectedSeeded,
      emailExpectationMatched: emailPresent === expectedSeeded,
      customClaimsMatched: expectedSeeded && uidPresent && emailPresent,
    });
  }
  const result = {
    scopeKind: "fixture-auth-identities",
    scopeBoundary: "fixed-uid-and-email-pairs-only",
    tenantWideEnumerationPerformed: false,
    nonFixtureTenantUsersInScope: false,
    scopedIdentityCount: identities.length,
    scopedUidSetHash: authAllowedUidSetHash,
    scopedEmailSetHash: sha256(
      identities
        .map(([, , email]) => email)
        .sort()
        .join("\n"),
    ),
    expectedPresentIdentityCount: expectedSeeded ? identities.length : 0,
    actualPresentIdentityCount: rows.filter((row) => row.actualPresent).length,
    uidExpectationMatchCount: rows.filter((row) => row.uidExpectationMatched)
      .length,
    emailExpectationMatchCount: rows.filter(
      (row) => row.emailExpectationMatched,
    ).length,
    customClaimMatchCount: rows.filter((row) => row.customClaimsMatched).length,
    missingScopedIdentityCount: rows.filter(
      (row) => row.expectedPresent && !row.actualPresent,
    ).length,
    mismatchedScopedIdentityCount: rows.filter(
      (row) => !row.uidExpectationMatched || !row.emailExpectationMatched,
    ).length,
    uidLookupCount: identities.length,
    emailLookupCount: identities.length,
    identities: rows,
  };
  return {
    ...result,
    manifestHash: sha256(canonicalJson(result)),
  };
};

const deleteAuthUsers = async ({
  requireOwnership,
  allowIncompleteFixtureCreation = false,
  operationStartedAt = null,
}) => {
  const operationStartedAtMs = operationStartedAt?.toDate
    ? operationStartedAt.toDate().getTime()
    : new Date(operationStartedAt || 0).getTime();
  let deleted = 0;
  for (const [uid, email] of [
    [STUDENT_UID, STUDENT_EMAIL],
    [TEACHER_UID, TEACHER_EMAIL],
    [ADMIN_UID, ADMIN_EMAIL],
  ]) {
    try {
      const user = await auth.getUser(uid);
      if (requireOwnership) {
        const fixtureOwned =
          user.customClaims?.fixtureOwner === FIXTURE_OWNER &&
          user.customClaims?.fixtureId === FIXTURE_ID;
        const incompleteFixtureIdentity =
          allowIncompleteFixtureCreation &&
          String(user.email || "").toLowerCase() === email &&
          Object.keys(user.customClaims || {}).length === 0 &&
          Number.isFinite(operationStartedAtMs) &&
          new Date(user.metadata.creationTime).getTime() >=
            operationStartedAtMs - 5_000;
        assert.equal(
          fixtureOwned || incompleteFixtureIdentity,
          true,
          "A scoped Auth identity is not owned by this fixture run.",
        );
      }
      await auth.deleteUser(uid);
      deleted += 1;
    } catch (error) {
      if (error?.code !== "auth/user-not-found") throw error;
    }
  }
  return deleted;
};

const backupDocumentData = (backup) =>
  owned({
    schemaVersion: BACKUP_SCHEMA_VERSION,
    backupKind: backup.kind,
    originalPath: backup.path,
    originalPathHash: sha256(backup.path),
    originalExists: backup.exists,
    originalData: backup.exists ? backup.data : null,
    originalDataHash: backup.dataHash,
  });

const childCollectionIds = async (reference) =>
  (await reference.listCollections()).map((collection) => collection.id).sort();

const assertPlannedMutationChildTopology = async () => {
  const rows = await Promise.all(
    [...plannedMutationChildAllowlist.entries()].map(
      async ([path, allowedChildIds]) => {
        const actualChildIds = await childCollectionIds(db.doc(path));
        const allowed = new Set(allowedChildIds);
        assert.equal(
          actualChildIds.every((childId) => allowed.has(childId)),
          true,
          "A planned fixture mutation path has an unknown child collection.",
        );
        return {
          pathHash: sha256(path),
          allowedChildIds,
          actualChildIds,
        };
      },
    ),
  );
  rows.sort((left, right) => left.pathHash.localeCompare(right.pathHash));
  return {
    documentCount: rows.length,
    allowlistHash: plannedMutationTopologyAllowlistHash,
    observedHash: sha256(canonicalJson(rows)),
    rows,
  };
};

const backupNamespaceInventory = async () => {
  const rootRef = backupDb.doc(BACKUP_ROOT_PATH);
  const documentsRef = backupDb.collection(BACKUP_DOCUMENTS_PATH);
  const [root, rootChildCollectionIds, documentRefs, directDocuments] =
    await Promise.all([
      rootRef.get(),
      childCollectionIds(rootRef),
      documentsRef.listDocuments(),
      documentsRef.limit(MAX_ATOMIC_BACKUP_COUNT + 1).get(),
    ]);
  assert.ok(
    documentRefs.length <= MAX_ATOMIC_BACKUP_COUNT,
    "The fixture backup descendant inventory exceeds its bound.",
  );
  assert.ok(
    directDocuments.size <= MAX_ATOMIC_BACKUP_COUNT,
    "The fixture backup document inventory exceeds its bound.",
  );
  const documentIds = documentRefs.map((reference) => reference.id).sort();
  assert.equal(
    new Set(documentIds).size,
    documentIds.length,
    "The fixture backup descendant inventory contains duplicate IDs.",
  );
  for (const reference of documentRefs) {
    assert.deepEqual(
      await childCollectionIds(reference),
      [],
      "An unknown fixture backup descendant blocks cleanup.",
    );
  }
  return {
    rootExists: root.exists,
    rootChildCollectionIds,
    documentIds,
    existingDocumentIds: directDocuments.docs
      .map((document) => document.id)
      .sort(),
  };
};

const assertBackupNamespaceShape = async ({
  expectRoot,
  expectedBackupIds,
}) => {
  const inventory = await backupNamespaceInventory();
  const expectedIds = [...expectedBackupIds].sort();
  assert.equal(
    inventory.rootExists,
    expectRoot,
    "The fixture backup root presence is invalid.",
  );
  assert.deepEqual(
    inventory.rootChildCollectionIds,
    expectedIds.length > 0 ? ["documents"] : [],
    "The fixture backup root has an unknown child collection.",
  );
  assert.deepEqual(
    inventory.documentIds,
    expectedIds,
    "The fixture backup descendant IDs differ from the manifest.",
  );
  assert.deepEqual(
    inventory.existingDocumentIds,
    expectedIds,
    "The fixture backup document IDs differ from the manifest.",
  );
  return inventory;
};

const assertBackupNamespaceEmpty = async () => {
  await assertBackupNamespaceShape({
    expectRoot: false,
    expectedBackupIds: [],
  });
  assert.deepEqual(
    await childCollectionIds(backupDb.doc(RUN_PATH)),
    [],
    "The fixture run marker has an unknown orphan descendant.",
  );
};

const readIsolationInventory = async () => {
  const strictBackups = [];
  const collections = [];
  for (const [collectionPath, fixtureIds] of strictCollections) {
    const snapshot = await backupDb
      .collection(collectionPath)
      .limit(STRICT_COLLECTION_BACKUP_LIMIT + 1)
      .get();
    assert.ok(
      snapshot.size <= STRICT_COLLECTION_BACKUP_LIMIT,
      `Strict collection backup overflow: ${collectionPath}`,
    );
    const fixtureIdSet = new Set(fixtureIds);
    for (const document of snapshot.docs) {
      const data = document.data();
      assert.equal(
        fixtureIdSet.has(document.id),
        false,
        `A create-only fixture document already exists: ${collectionPath}`,
      );
      assert.notEqual(
        data?.fixtureOwner,
        FIXTURE_OWNER,
        `An untracked fixture-owned document exists: ${collectionPath}`,
      );
      assertLosslessBackupValue(data);
      strictBackups.push({
        kind: "STRICT_ISOLATION",
        path: document.ref.path,
        exists: true,
        data,
        dataHash: sha256(canonicalBackupJson(data)),
      });
    }
    collections.push({
      collectionPath,
      boundedReadLimit: STRICT_COLLECTION_BACKUP_LIMIT + 1,
      isolatedDocumentCount: snapshot.size,
      isolatedDocumentManifestHash: sha256(
        canonicalJson(
          snapshot.docs
            .map((document) => ({
              pathHash: sha256(document.ref.path),
              dataHash: sha256(canonicalBackupJson(document.data())),
            }))
            .sort((left, right) => left.pathHash.localeCompare(right.pathHash)),
        ),
      ),
    });
  }

  const overwriteSnapshots = await getBackupSnapshots([
    ...overwriteDocs.keys(),
  ]);
  const singletonBackups = overwriteSnapshots.map((snapshot) => {
    const data = snapshot.exists ? snapshot.data() : null;
    if (snapshot.exists) assertLosslessBackupValue(data);
    return {
      kind: "SINGLETON_OVERWRITE",
      path: snapshot.ref.path,
      exists: snapshot.exists,
      data,
      dataHash: sha256(canonicalBackupJson(data)),
    };
  });
  const backups = [...strictBackups, ...singletonBackups];
  assert.ok(
    strictBackups.length <= MAX_ATOMIC_STRICT_BACKUP_COUNT,
    "Strict isolation inventory cannot fit one atomic cutover and restore.",
  );
  const backupCanonicalByteCount = backups.reduce((count, backup) => {
    const byteCount = Buffer.byteLength(
      canonicalBackupJson(backup.exists ? backup.data : null),
      "utf8",
    );
    assert.ok(
      byteCount <= MAX_BACKUP_DOCUMENT_CANONICAL_BYTES,
      "A backup document exceeds its conservative canonical byte limit.",
    );
    return count + byteCount;
  }, 0);
  assert.ok(
    backupCanonicalByteCount <= MAX_ATOMIC_RESTORE_BACKUP_CANONICAL_BYTES,
    "Isolation inventory cannot fit the conservative atomic restore byte limit.",
  );
  const manifest = backupManifestFor(backups);
  assert.equal(
    new Set(manifest.rows.map((row) => row.backupId)).size,
    backups.length,
    "Backup paths are not unique.",
  );
  return {
    backups,
    manifest,
    strictBackupCount: strictBackups.length,
    singletonBackupCount: singletonBackups.length,
    backupCanonicalByteCount,
    collections,
  };
};

const isolationMarkerData = ({
  inventory,
  status,
  preBackupAccessProbe,
  auxiliaryPreflight,
  plannedMutationTopology,
}) =>
  owned({
    projectId: STAGING_PROJECT_ID,
    fixtureRevision: FIXTURE_REVISION,
    status,
    planHash,
    fixedTime: FIXED_TIME,
    createdAt: fixedDate,
    operationStartedAt: new Date(),
    backupSchemaVersion: BACKUP_SCHEMA_VERSION,
    isolationProtocolVersion: ISOLATION_PROTOCOL_VERSION,
    strictCollectionBackupLimit: STRICT_COLLECTION_BACKUP_LIMIT,
    strictCollectionCount: strictCollections.size,
    strictBackupCount: inventory.strictBackupCount,
    singletonBackupCount: inventory.singletonBackupCount,
    backupCount: inventory.backups.length,
    backupManifestHash: inventory.manifest.hash,
    backupCanonicalByteCount: inventory.backupCanonicalByteCount,
    maximumAtomicRestoreBackupCanonicalBytes:
      MAX_ATOMIC_RESTORE_BACKUP_CANONICAL_BYTES,
    maximumBackupDocumentCanonicalBytes: MAX_BACKUP_DOCUMENT_CANONICAL_BYTES,
    createdPathHashes: [...createDocs.keys()].map(sha256).sort(),
    overwritePathHashes: [...overwriteDocs.keys()].map(sha256).sort(),
    identityEmailHashes: [STUDENT_EMAIL, TEACHER_EMAIL, ADMIN_EMAIL]
      .map(sha256)
      .sort(),
    auxiliaryPreflightHash: auxiliaryPreflight.manifestHash,
    auxiliaryPreflightDocumentCount: auxiliaryPreflight.documentCount,
    auxiliaryPreflightNamespaceCount: auxiliaryPreflight.namespaceCount,
    plannedMutationTopologyAllowlistHash: plannedMutationTopology.allowlistHash,
    plannedMutationTopologyBaselineHash: plannedMutationTopology.observedHash,
    preBackupAccessProbe,
    preBackupAccessProbeAttestationHash: preBackupAccessProbe.attestationHash,
  });

const accessProbeMarkerData = (auxiliaryPreflight, plannedMutationTopology) =>
  owned({
    projectId: STAGING_PROJECT_ID,
    fixtureRevision: FIXTURE_REVISION,
    status: "ACCESS_PROBING",
    planHash,
    fixedTime: FIXED_TIME,
    createdAt: fixedDate,
    operationStartedAt: new Date(),
    backupSchemaVersion: BACKUP_SCHEMA_VERSION,
    isolationProtocolVersion: ISOLATION_PROTOCOL_VERSION,
    backupCount: 0,
    strictBackupCount: 0,
    singletonBackupCount: 0,
    backupManifestHash: backupManifestFor([]).hash,
    backupCanonicalByteCount: 0,
    auxiliaryPreflightHash: auxiliaryPreflight.manifestHash,
    auxiliaryPreflightDocumentCount: auxiliaryPreflight.documentCount,
    auxiliaryPreflightNamespaceCount: auxiliaryPreflight.namespaceCount,
    plannedMutationTopologyAllowlistHash: plannedMutationTopology.allowlistHash,
    plannedMutationTopologyBaselineHash: plannedMutationTopology.observedHash,
    preBackupProbeRevisionHash: PRE_BACKUP_PROBE_REVISION_HASH,
    preBackupIdentityUidHash: sha256(PREFLIGHT_UID),
    preBackupProfilePathHash: sha256(`users/${PREFLIGHT_UID}`),
    preBackupSessionRootPathHash: sha256(
      `application_sessions/${PREFLIGHT_UID}/sessions`,
    ),
    preBackupPositiveControlPathHash: sha256(PRE_BACKUP_POSITIVE_CONTROL_PATH),
    preBackupExistingCanaryPathHash: sha256(
      PRE_BACKUP_EXISTING_WRITE_CANARY.path,
    ),
    preBackupAbsentCanaryPathHash: sha256(PRE_BACKUP_ABSENT_WRITE_CANARY.path),
    rawBackupWriteCount: 0,
  });

const createAccessProbeMarker = async (
  auxiliaryPreflight,
  plannedMutationTopology,
) => {
  const currentTopology = await assertPlannedMutationChildTopology();
  assert.equal(
    currentTopology.observedHash,
    plannedMutationTopology.observedHash,
    "The planned mutation child topology changed before marker creation.",
  );
  const marker = accessProbeMarkerData(
    auxiliaryPreflight,
    plannedMutationTopology,
  );
  await db.runTransaction(async (transaction) => {
    const transactionalPreflight =
      await assertFixtureAuxiliaryDocumentsEmptyInTransaction(transaction);
    assert.equal(
      transactionalPreflight.manifestHash,
      auxiliaryPreflight.manifestHash,
      "The fixture auxiliary preflight changed before marker creation.",
    );
    const [runMarker, backupRoot] = await transaction.getAll(
      db.doc(RUN_PATH),
      db.doc(BACKUP_ROOT_PATH),
    );
    assert.equal(
      runMarker.exists || backupRoot.exists,
      false,
      "Fixture marker metadata changed before creation.",
    );
    transaction.create(db.doc(RUN_PATH), marker);
    transaction.create(db.doc(BACKUP_ROOT_PATH), marker);
  });
};

const promoteIsolationMarker = async (
  inventory,
  preBackupAccessProbe,
  auxiliaryPreflight,
  plannedMutationTopology,
) => {
  const marker = isolationMarkerData({
    inventory,
    status: "PREPARING",
    preBackupAccessProbe,
    auxiliaryPreflight,
    plannedMutationTopology,
  });
  await db.runTransaction(async (transaction) => {
    const [runMarker, backupRoot] = await transaction.getAll(
      db.doc(RUN_PATH),
      db.doc(BACKUP_ROOT_PATH),
    );
    const current = assertIsolationMarkerPair(runMarker, backupRoot, {
      allowedStatuses: new Set(["ACCESS_PROBING"]),
    });
    const promoted = {
      ...marker,
      operationStartedAt: current.operationStartedAt,
      accessProbeCompletedAt: new Date(),
    };
    transaction.set(db.doc(RUN_PATH), promoted);
    transaction.set(db.doc(BACKUP_ROOT_PATH), promoted);
  });
};

const setIsolationState = async (status, details = {}) => {
  assert.equal(SETUP_STATES.has(status), true, "Unknown fixture setup state.");
  const update = { status, ...details };
  const batch = db.batch();
  batch.update(db.doc(RUN_PATH), update);
  batch.update(db.doc(BACKUP_ROOT_PATH), update);
  await batch.commit();
};

const setPostBackupProbeMarkerState = async (state, details = {}) => {
  assert.equal(
    ["PROBING", "VERIFIED_CLEAN", "RECOVERED_CLEAN"].includes(state),
    true,
  );
  await db.runTransaction(async (transaction) => {
    const [runMarker, backupRoot] = await transaction.getAll(
      db.doc(RUN_PATH),
      db.doc(BACKUP_ROOT_PATH),
    );
    assertIsolationMarkerPair(runMarker, backupRoot, {
      allowedStatuses: new Set(["READY"]),
    });
    const update = {
      postBackupProbeState: state,
      postBackupProbeRevisionHash: POST_BACKUP_PROBE_REVISION_HASH,
      postBackupExistingCanaryPathHash: sha256(EXISTING_WRITE_CANARY.path),
      postBackupAbsentCanaryPathHash: sha256(ABSENT_WRITE_CANARY.path),
      ...details,
    };
    transaction.update(db.doc(RUN_PATH), update);
    transaction.update(db.doc(BACKUP_ROOT_PATH), update);
  });
};

const backupFromSnapshot = (document) => {
  const value = document.data() || {};
  assert.equal(value.fixtureOwner, FIXTURE_OWNER);
  assert.equal(value.fixtureId, FIXTURE_ID);
  assert.equal(Number(value.schemaVersion), BACKUP_SCHEMA_VERSION);
  assert.equal(document.id, sha256(String(value.originalPath || "")));
  assert.equal(value.originalPathHash, document.id);
  assert.equal(
    value.originalDataHash,
    sha256(
      canonicalBackupJson(value.originalExists ? value.originalData : null),
    ),
    "A fixture backup canonical hash is invalid.",
  );
  assert.equal(
    ["STRICT_ISOLATION", "SINGLETON_OVERWRITE"].includes(value.backupKind),
    true,
  );
  if (value.originalExists) assertLosslessBackupValue(value.originalData);
  return {
    kind: value.backupKind,
    path: value.originalPath,
    exists: value.originalExists === true,
    data: value.originalData,
    dataHash: value.originalDataHash,
  };
};

const loadBackups = async (markerData, { requireComplete = true } = {}) => {
  const expectedCount = Number(markerData.backupCount || 0);
  assert.ok(
    Number.isSafeInteger(expectedCount) && expectedCount >= 0,
    "The fixture backup count is invalid.",
  );
  const maximumCount = MAX_ATOMIC_BACKUP_COUNT;
  assert.ok(
    expectedCount <= maximumCount,
    "The fixture backup count exceeds its bound.",
  );
  const snapshot = await backupDb
    .collection(BACKUP_DOCUMENTS_PATH)
    .limit(maximumCount + 1)
    .get();
  assert.ok(
    snapshot.size <= maximumCount,
    "The fixture backup namespace exceeds its bound.",
  );
  if (requireComplete) {
    assert.equal(
      snapshot.size,
      expectedCount,
      "The fixture backup namespace is incomplete.",
    );
  }
  const backups = snapshot.docs.map(backupFromSnapshot);
  const manifest = backupManifestFor(backups);
  const backupCanonicalByteCount = backups.reduce((count, backup) => {
    const byteCount = Buffer.byteLength(
      canonicalBackupJson(backup.exists ? backup.data : null),
      "utf8",
    );
    assert.ok(
      byteCount <= MAX_BACKUP_DOCUMENT_CANONICAL_BYTES,
      "A verified backup document exceeds its canonical byte limit.",
    );
    return count + byteCount;
  }, 0);
  assert.ok(
    backupCanonicalByteCount <= MAX_ATOMIC_RESTORE_BACKUP_CANONICAL_BYTES,
    "Verified backups exceed the conservative atomic restore byte limit.",
  );
  if (requireComplete) {
    assert.equal(
      manifest.hash,
      markerData.backupManifestHash,
      "The fixture backup manifest hash is invalid.",
    );
    assert.equal(
      backupCanonicalByteCount,
      Number(markerData.backupCanonicalByteCount),
      "The fixture backup byte count is invalid.",
    );
  }
  return { backups, manifest, backupCanonicalByteCount };
};

const verifyPreBackupNamespaceDenied = async () => {
  await assertPreBackupProbeNamespaceEmpty();
  const accessProbeMarker = await db.doc(RUN_PATH).get();
  assert.equal(accessProbeMarker.exists, true);
  const accessProbeTopology = await assertPlannedMutationChildTopology();
  assert.equal(
    accessProbeTopology.observedHash,
    accessProbeMarker.data()?.plannedMutationTopologyBaselineHash,
    "The planned mutation child topology changed during pre-backup probing.",
  );
  const firebaseConfig = firebaseConfigFromEnvironment();
  const firestoreDocumentUrl = (path) =>
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      STAGING_PROJECT_ID,
    )}/databases/(default)/documents/${path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
  const firestoreRestDocument = (data) => ({
    fields: Object.fromEntries(
      Object.entries(data).map(([field, value]) => {
        if (typeof value === "string") return [field, { stringValue: value }];
        if (typeof value === "number") {
          assert.equal(Number.isSafeInteger(value), true);
          return [field, { integerValue: String(value) }];
        }
        if (typeof value === "boolean") {
          return [field, { booleanValue: value }];
        }
        assert.fail(`Unsupported pre-backup canary field: ${field}`);
      }),
    ),
  });
  const assertPermissionDenied = async (response, operation) => {
    const payload = await response.json();
    assert.equal(
      response.status,
      403,
      `The pre-backup ${operation} did not fail with HTTP 403.`,
    );
    const firestoreStatus = String(payload?.error?.status || "");
    assert.equal(
      firestoreStatus,
      "PERMISSION_DENIED",
      `The pre-backup ${operation} did not fail with PERMISSION_DENIED.`,
    );
    return { httpStatus: response.status, firestoreStatus };
  };
  const profileRef = db.doc(`users/${PREFLIGHT_UID}`);
  const positiveControlRef = db.doc(PRE_BACKUP_POSITIVE_CONTROL_PATH);
  const existingCanaryRef = db.doc(PRE_BACKUP_EXISTING_WRITE_CANARY.path);
  const absentCanaryRef = db.doc(PRE_BACKUP_ABSENT_WRITE_CANARY.path);
  const preflightProfile = {
    uid: PREFLIGHT_UID,
    email: PREFLIGHT_EMAIL,
    schoolEmail: PREFLIGHT_EMAIL,
    name: "W10P 보안 점검",
    role: "teacher",
    status: "active",
    isTeacher: true,
    teacherPortalEnabled: true,
    staffPermissions: [],
    fixtureOwner: FIXTURE_OWNER,
    fixtureId: FIXTURE_ID,
    fixtureRevision: FIXTURE_REVISION,
    fixturePurpose: "pre-backup-access-deny-probe",
    probeRevision: PRE_BACKUP_PROBE_REVISION_HASH,
  };
  const temporaryPassword = `${randomBytes(24).toString("base64url")}Aa1!`;
  let idToken = "";
  let signInPayload = null;
  let probeSessionRef = null;
  let probeSessionRevision = "";
  let ephemeralAuthCreated = false;
  let ephemeralAuthSetupWriteCount = 0;
  let ephemeralAuthCleanupWriteCount = 0;
  let ephemeralProfileSetupWriteCount = 0;
  let ephemeralProfileCleanupWriteCount = 0;
  let positiveControlSetupWriteCount = 0;
  let positiveControlCleanupWriteCount = 0;
  let positiveControlOriginalHashPreserved = false;
  let temporarySessionCreateWriteCount = 0;
  let temporarySessionCleanupWriteCount = 0;
  let adminCanarySetupWriteCount = 0;
  let conditionalCanaryCleanupWriteCount = 0;
  let ownershipMismatchCount = 0;
  let existingCanaryOriginalHashPreserved = false;
  let identityRequestCount = 0;
  let positiveControlReadRequestCount = 0;
  let existingReadRequestCount = 0;
  let absentReadRequestCount = 0;
  let updateRequestCount = 0;
  let deleteRequestCount = 0;
  let createRequestCount = 0;
  let existingReadResult = null;
  let positiveControlResult = null;
  let absentReadResult = null;
  let updateResult = null;
  let deleteResult = null;
  let createResult = null;
  const appCheckExchange = await exchangeAndVerifyAppCheckToken(firebaseConfig);
  const firestoreHeaders = (includeJson = false) => ({
    authorization: `Bearer ${idToken}`,
    "X-Firebase-AppCheck": appCheckExchange.token,
    ...(includeJson ? { "content-type": "application/json" } : {}),
  });
  try {
    await assertAuthAbsent(PREFLIGHT_UID, PREFLIGHT_EMAIL);
    const [
      profileBefore,
      positiveControlBefore,
      existingCanaryBefore,
      absentCanaryBefore,
    ] = await Promise.all([
      profileRef.get(),
      positiveControlRef.get(),
      existingCanaryRef.get(),
      absentCanaryRef.get(),
    ]);
    assert.equal(profileBefore.exists, false);
    assert.equal(positiveControlBefore.exists, false);
    assert.equal(existingCanaryBefore.exists, false);
    assert.equal(absentCanaryBefore.exists, false);

    await auth.createUser({
      uid: PREFLIGHT_UID,
      email: PREFLIGHT_EMAIL,
      displayName: PRE_BACKUP_AUTH_DISPLAY_NAME,
      password: temporaryPassword,
      emailVerified: true,
    });
    ephemeralAuthCreated = true;
    ephemeralAuthSetupWriteCount += 1;
    await auth.setCustomUserClaims(PREFLIGHT_UID, {
      fixtureOwner: FIXTURE_OWNER,
      fixtureId: FIXTURE_ID,
      fixtureRevision: FIXTURE_REVISION,
      fixtureRole: "teacher",
      fixturePurpose: "pre-backup-access-deny-probe",
      probeRevision: PRE_BACKUP_PROBE_REVISION_HASH,
    });
    ephemeralAuthSetupWriteCount += 1;
    await profileRef.create(preflightProfile);
    ephemeralProfileSetupWriteCount += 1;
    await positiveControlRef.create(PRE_BACKUP_POSITIVE_CONTROL_DATA);
    positiveControlSetupWriteCount += 1;
    await existingCanaryRef.create(PRE_BACKUP_EXISTING_WRITE_CANARY.data);
    adminCanarySetupWriteCount += 1;

    identityRequestCount += 1;
    const signInResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(
        firebaseConfig.apiKey,
      )}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: STAGING_VISUAL_ORIGIN,
          referer: `${STAGING_VISUAL_ORIGIN}/`,
        },
        body: JSON.stringify({
          email: PREFLIGHT_EMAIL,
          password: temporaryPassword,
          returnSecureToken: true,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      },
    );
    assert.equal(
      signInResponse.status,
      200,
      "The ephemeral pre-backup identity could not sign in.",
    );
    signInPayload = await signInResponse.json();
    idToken = String(signInPayload?.idToken || "");
    assert.ok(idToken.length > 100);
    assert.equal(String(signInPayload?.localId || ""), PREFLIGHT_UID);
    const tokenSegments = idToken.split(".");
    assert.equal(tokenSegments.length, 3);
    const tokenPayload = JSON.parse(
      Buffer.from(tokenSegments[1], "base64url").toString("utf8"),
    );
    const authTime = Number(tokenPayload?.auth_time || 0);
    assert.ok(Number.isSafeInteger(authTime) && authTime > 0);
    assert.equal(
      String(tokenPayload?.sub || tokenPayload?.user_id || ""),
      PREFLIGHT_UID,
    );
    probeSessionRevision = sha256(
      `${PRE_BACKUP_PROBE_REVISION_HASH}\n${authTime}`,
    );
    probeSessionRef = db.doc(
      `application_sessions/${PREFLIGHT_UID}/sessions/${authTime}`,
    );
    const sessionNow = new Date();
    await probeSessionRef.create({
      uid: PREFLIGHT_UID,
      email: PREFLIGHT_EMAIL,
      authTime,
      status: "active",
      createdAt: sessionNow,
      lastActivityAt: sessionNow,
      lastTouchAt: sessionNow,
      generalExpiresAt: new Date(sessionNow.getTime() + 10 * 60 * 1_000),
      highRiskExpiresAt: new Date(sessionNow.getTime() + 5 * 60 * 1_000),
      closedAt: null,
      schemaVersion: 2,
      authorityGeneration: "w1r2-2026-08-09",
      protocolVersion: 2,
      sessionRevision: probeSessionRevision,
      authorityModeAtOpen: "ENFORCE",
      fixtureOwner: FIXTURE_OWNER,
      fixtureId: FIXTURE_ID,
      fixtureRevision: FIXTURE_REVISION,
      fixturePurpose: "pre-backup-access-deny-probe",
      probeRevision: PRE_BACKUP_PROBE_REVISION_HASH,
    });
    temporarySessionCreateWriteCount += 1;

    positiveControlReadRequestCount += 1;
    const positiveControlResponse = await fetch(
      firestoreDocumentUrl(PRE_BACKUP_POSITIVE_CONTROL_PATH),
      {
        method: "GET",
        headers: firestoreHeaders(),
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      },
    );
    assert.equal(
      positiveControlResponse.status,
      200,
      "The pre-backup positive control was not readable.",
    );
    const positiveControlPayload = await positiveControlResponse.json();
    assert.equal(
      String(positiveControlPayload?.fields?.sentinelHash?.stringValue || ""),
      PRE_BACKUP_POSITIVE_CONTROL_SENTINEL_HASH,
      "The pre-backup positive control sentinel drifted.",
    );
    positiveControlResult = {
      httpStatus: positiveControlResponse.status,
      sentinelMatched: true,
    };

    existingReadRequestCount += 1;
    existingReadResult = await assertPermissionDenied(
      await fetch(firestoreDocumentUrl(PRE_BACKUP_EXISTING_WRITE_CANARY.path), {
        method: "GET",
        headers: firestoreHeaders(),
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      }),
      "existing canary read",
    );
    absentReadRequestCount += 1;
    absentReadResult = await assertPermissionDenied(
      await fetch(firestoreDocumentUrl(PRE_BACKUP_ABSENT_WRITE_CANARY.path), {
        method: "GET",
        headers: firestoreHeaders(),
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      }),
      "absent canary read",
    );
    updateRequestCount += 1;
    updateResult = await assertPermissionDenied(
      await fetch(
        `${firestoreDocumentUrl(
          PRE_BACKUP_EXISTING_WRITE_CANARY.path,
        )}?updateMask.fieldPaths=mutationAttempt&currentDocument.exists=true`,
        {
          method: "PATCH",
          headers: firestoreHeaders(true),
          body: JSON.stringify(
            firestoreRestDocument({
              mutationAttempt: sha256(
                `${PRE_BACKUP_EXISTING_WRITE_CANARY.revisionHash}\nunauthorized-update`,
              ),
            }),
          ),
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        },
      ),
      "existing canary update",
    );
    deleteRequestCount += 1;
    deleteResult = await assertPermissionDenied(
      await fetch(
        `${firestoreDocumentUrl(
          PRE_BACKUP_EXISTING_WRITE_CANARY.path,
        )}?currentDocument.exists=true`,
        {
          method: "DELETE",
          headers: firestoreHeaders(),
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        },
      ),
      "existing canary delete",
    );
    createRequestCount += 1;
    createResult = await assertPermissionDenied(
      await fetch(
        `${firestoreDocumentUrl(
          PRE_BACKUP_ABSENT_WRITE_CANARY.path,
        )}?currentDocument.exists=false`,
        {
          method: "PATCH",
          headers: firestoreHeaders(true),
          body: JSON.stringify(
            firestoreRestDocument(PRE_BACKUP_ABSENT_WRITE_CANARY.data),
          ),
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        },
      ),
      "absent canary create",
    );
  } finally {
    const cleanupErrors = [];
    try {
      conditionalCanaryCleanupWriteCount += await db.runTransaction(
        async (transaction) => {
          let cleanupWriteCount = 0;
          const [existingCanary, absentCanary] = await transaction.getAll(
            existingCanaryRef,
            absentCanaryRef,
          );
          for (const [snapshot, canary] of [
            [existingCanary, PRE_BACKUP_EXISTING_WRITE_CANARY],
            [absentCanary, PRE_BACKUP_ABSENT_WRITE_CANARY],
          ]) {
            if (!snapshot.exists) continue;
            const data = snapshot.data() || {};
            const ownershipMatches =
              data.fixtureOwner === FIXTURE_OWNER &&
              data.fixtureId === FIXTURE_ID &&
              data.fixtureRevision === FIXTURE_REVISION &&
              data.canaryPurpose === canary.data.canaryPurpose &&
              data.canaryRevision === canary.revisionHash;
            if (!ownershipMatches) {
              ownershipMismatchCount += 1;
              continue;
            }
            if (canary === PRE_BACKUP_EXISTING_WRITE_CANARY) {
              existingCanaryOriginalHashPreserved =
                sha256(canonicalBackupJson(data)) === canary.documentHash;
            }
            transaction.delete(snapshot.ref);
            cleanupWriteCount += 1;
          }
          return cleanupWriteCount;
        },
      );
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      if (probeSessionRef) {
        temporarySessionCleanupWriteCount += await db.runTransaction(
          async (transaction) => {
            const snapshot = await transaction.get(probeSessionRef);
            if (!snapshot.exists) return 0;
            const data = snapshot.data() || {};
            assert.equal(data.fixtureOwner, FIXTURE_OWNER);
            assert.equal(data.fixtureId, FIXTURE_ID);
            assert.equal(data.fixtureRevision, FIXTURE_REVISION);
            assert.equal(data.probeRevision, PRE_BACKUP_PROBE_REVISION_HASH);
            assert.equal(data.sessionRevision, probeSessionRevision);
            transaction.delete(probeSessionRef);
            return 1;
          },
        );
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      positiveControlCleanupWriteCount += await db.runTransaction(
        async (transaction) => {
          const snapshot = await transaction.get(positiveControlRef);
          if (!snapshot.exists) return 0;
          const data = snapshot.data() || {};
          const ownershipMatches =
            data.fixtureOwner === FIXTURE_OWNER &&
            data.fixtureId === FIXTURE_ID &&
            data.fixtureRevision === FIXTURE_REVISION &&
            data.fixturePurpose === "pre-backup-positive-control" &&
            data.probeRevision === PRE_BACKUP_PROBE_REVISION_HASH &&
            data.sentinelHash === PRE_BACKUP_POSITIVE_CONTROL_SENTINEL_HASH;
          if (!ownershipMatches) {
            ownershipMismatchCount += 1;
            return 0;
          }
          positiveControlOriginalHashPreserved =
            sha256(canonicalBackupJson(data)) ===
            PRE_BACKUP_POSITIVE_CONTROL_DOCUMENT_HASH;
          transaction.delete(positiveControlRef);
          return 1;
        },
      );
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      ephemeralProfileCleanupWriteCount += await db.runTransaction(
        async (transaction) => {
          const snapshot = await transaction.get(profileRef);
          if (!snapshot.exists) return 0;
          const data = snapshot.data() || {};
          const ownershipMatches =
            data.fixtureOwner === FIXTURE_OWNER &&
            data.fixtureId === FIXTURE_ID &&
            data.fixtureRevision === FIXTURE_REVISION &&
            data.fixturePurpose === "pre-backup-access-deny-probe" &&
            data.probeRevision === PRE_BACKUP_PROBE_REVISION_HASH;
          if (!ownershipMatches) {
            ownershipMismatchCount += 1;
            return 0;
          }
          transaction.delete(profileRef);
          return 1;
        },
      );
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      const user = await auth.getUser(PREFLIGHT_UID);
      const claims = user.customClaims || {};
      const claimsMatch =
        claims.fixtureOwner === FIXTURE_OWNER &&
        claims.fixtureId === FIXTURE_ID &&
        claims.fixtureRevision === FIXTURE_REVISION &&
        claims.fixturePurpose === "pre-backup-access-deny-probe" &&
        claims.probeRevision === PRE_BACKUP_PROBE_REVISION_HASH;
      const sameInvocationCreate =
        ephemeralAuthCreated &&
        ephemeralAuthSetupWriteCount === 1 &&
        String(user.email || "").toLowerCase() === PREFLIGHT_EMAIL &&
        user.displayName === PRE_BACKUP_AUTH_DISPLAY_NAME;
      if (claimsMatch || sameInvocationCreate) {
        await auth.deleteUser(PREFLIGHT_UID);
        ephemeralAuthCleanupWriteCount += 1;
      } else {
        ownershipMismatchCount += 1;
      }
    } catch (error) {
      if (error?.code !== "auth/user-not-found") cleanupErrors.push(error);
    }
    idToken = "";
    signInPayload = null;
    appCheckExchange.clear();
    const [
      profileAfter,
      positiveControlAfter,
      existingCanaryAfter,
      absentCanaryAfter,
      sessionAfter,
    ] = await Promise.all([
      profileRef.get(),
      positiveControlRef.get(),
      existingCanaryRef.get(),
      absentCanaryRef.get(),
      probeSessionRef ? probeSessionRef.get() : Promise.resolve(null),
    ]);
    let authResidualCount = 0;
    try {
      await auth.getUser(PREFLIGHT_UID);
      authResidualCount = 1;
    } catch (error) {
      if (error?.code !== "auth/user-not-found") cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) throw cleanupErrors[0];
    assert.equal(ownershipMismatchCount, 0);
    assert.equal(profileAfter.exists, false);
    assert.equal(positiveControlAfter.exists, false);
    assert.equal(existingCanaryAfter.exists || absentCanaryAfter.exists, false);
    assert.equal(sessionAfter?.exists || false, false);
    assert.equal(authResidualCount, 0);
  }

  assert.deepEqual(positiveControlResult, {
    httpStatus: 200,
    sentinelMatched: true,
  });
  assert.equal(positiveControlOriginalHashPreserved, true);
  for (const result of [
    existingReadResult,
    absentReadResult,
    updateResult,
    deleteResult,
    createResult,
  ]) {
    assert.deepEqual(result, {
      httpStatus: 403,
      firestoreStatus: "PERMISSION_DENIED",
    });
  }
  assert.equal(existingCanaryOriginalHashPreserved, true);
  const readRequestCount = existingReadRequestCount + absentReadRequestCount;
  const writeRequestCount =
    updateRequestCount + deleteRequestCount + createRequestCount;
  const accessRequestCount =
    positiveControlReadRequestCount + readRequestCount + writeRequestCount;
  const requestCount =
    identityRequestCount +
    appCheckExchange.binding.appCheckExchangeRequestCount +
    accessRequestCount;
  const attestation = {
    status: "VERIFIED_DENIED",
    probeKind:
      "ephemeral-synthetic-id-token-pre-backup-read-update-delete-create",
    sessionBound: true,
    ...appCheckExchange.binding,
    appCheckHeaderRequestCount: accessRequestCount,
    positiveControlPassed: true,
    positiveControlHttpStatus: positiveControlResult.httpStatus,
    positiveControlSentinelMatched: positiveControlResult.sentinelMatched,
    positiveControlOriginalHashPreserved,
    readDenied: true,
    existingReadDenied: true,
    absentReadDenied: true,
    writeDenied: true,
    updateDenied: true,
    deleteDenied: true,
    createDenied: true,
    existingReadHttpStatus: existingReadResult.httpStatus,
    existingReadFirestoreStatus: existingReadResult.firestoreStatus,
    absentReadHttpStatus: absentReadResult.httpStatus,
    absentReadFirestoreStatus: absentReadResult.firestoreStatus,
    updateHttpStatus: updateResult.httpStatus,
    updateFirestoreStatus: updateResult.firestoreStatus,
    deleteHttpStatus: deleteResult.httpStatus,
    deleteFirestoreStatus: deleteResult.firestoreStatus,
    createHttpStatus: createResult.httpStatus,
    createFirestoreStatus: createResult.firestoreStatus,
    projectIdHash: sha256(STAGING_PROJECT_ID),
    identityUidHash: sha256(PREFLIGHT_UID),
    identityEmailHash: sha256(PREFLIGHT_EMAIL),
    backupNamespaceHash: sha256(BACKUP_ROOT_PATH),
    localRulesSourceHash: sha256(
      readFileSync(resolve("firestore.rules"), "utf8"),
    ),
    probeRevisionHash: PRE_BACKUP_PROBE_REVISION_HASH,
    probeProfilePathHash: sha256(profileRef.path),
    probeSessionPathHash: sha256(probeSessionRef.path),
    positiveControlPathHash: sha256(positiveControlRef.path),
    positiveControlSentinelHash: PRE_BACKUP_POSITIVE_CONTROL_SENTINEL_HASH,
    positiveControlDocumentHash: PRE_BACKUP_POSITIVE_CONTROL_DOCUMENT_HASH,
    existingWriteCanaryPathHash: sha256(PRE_BACKUP_EXISTING_WRITE_CANARY.path),
    absentWriteCanaryPathHash: sha256(PRE_BACKUP_ABSENT_WRITE_CANARY.path),
    existingWriteCanaryRevisionHash:
      PRE_BACKUP_EXISTING_WRITE_CANARY.revisionHash,
    absentWriteCanaryRevisionHash: PRE_BACKUP_ABSENT_WRITE_CANARY.revisionHash,
    existingWriteCanaryDocumentHash:
      PRE_BACKUP_EXISTING_WRITE_CANARY.documentHash,
    absentWriteCanaryDocumentHash: PRE_BACKUP_ABSENT_WRITE_CANARY.documentHash,
    existingCanaryOriginalHashPreserved,
    requestCount,
    identityRequestCount,
    accessRequestCount,
    readRequestCount,
    writeRequestCount,
    positiveControlReadRequestCount,
    existingReadRequestCount,
    absentReadRequestCount,
    updateRequestCount,
    deleteRequestCount,
    createRequestCount,
    ephemeralAuthWriteCount:
      ephemeralAuthSetupWriteCount + ephemeralAuthCleanupWriteCount,
    ephemeralAuthSetupWriteCount,
    ephemeralAuthCleanupWriteCount,
    ephemeralAuthResidualCount: 0,
    ephemeralProfileWriteCount:
      ephemeralProfileSetupWriteCount + ephemeralProfileCleanupWriteCount,
    ephemeralProfileSetupWriteCount,
    ephemeralProfileCleanupWriteCount,
    ephemeralProfileResidualCount: 0,
    positiveControlWriteCount:
      positiveControlSetupWriteCount + positiveControlCleanupWriteCount,
    positiveControlSetupWriteCount,
    positiveControlCleanupWriteCount,
    positiveControlResidualCount: 0,
    temporarySessionWriteCount:
      temporarySessionCreateWriteCount + temporarySessionCleanupWriteCount,
    temporarySessionCleanupWriteCount,
    temporarySessionResidualCount: 0,
    adminCanarySetupWriteCount,
    conditionalCanaryCleanupWriteCount,
    canaryResidualCount: 0,
    ownershipMismatchCount,
    rawBackupWriteCount: 0,
    rawTokenOutputCount: 0,
    rawResponseBodyOutputCount: 0,
    rawDocumentPathOutputCount: 0,
    rawCanaryDocumentOutputCount: 0,
    rawPiiOutputCount: 0,
  };
  assert.equal(requestCount, 8);
  assert.equal(accessRequestCount, 6);
  assert.equal(readRequestCount, 2);
  assert.equal(writeRequestCount, 3);
  assert.equal(ephemeralAuthSetupWriteCount, 2);
  assert.equal(ephemeralAuthCleanupWriteCount, 1);
  assert.equal(ephemeralProfileSetupWriteCount, 1);
  assert.equal(ephemeralProfileCleanupWriteCount, 1);
  assert.equal(positiveControlReadRequestCount, 1);
  assert.equal(positiveControlSetupWriteCount, 1);
  assert.equal(positiveControlCleanupWriteCount, 1);
  assert.equal(temporarySessionCreateWriteCount, 1);
  assert.equal(temporarySessionCleanupWriteCount, 1);
  assert.equal(adminCanarySetupWriteCount, 1);
  assert.equal(conditionalCanaryCleanupWriteCount, 1);
  return {
    ...attestation,
    attestationHash: sha256(canonicalJson(attestation)),
  };
};

const verifyLiveBackupNamespaceDenied = async (backups) => {
  assert.ok(
    backups.length > 0,
    "The live backup deny probe requires a verified backup child.",
  );
  const credentials = credentialsFromEnvironment();
  const firebaseConfig = firebaseConfigFromEnvironment();
  const probeBackup = [...backups].sort((left, right) =>
    left.path.localeCompare(right.path),
  )[0];
  const probeDocumentPath = `${BACKUP_DOCUMENTS_PATH}/${sha256(
    probeBackup.path,
  )}`;
  const firestoreDocumentUrl = (path) =>
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      STAGING_PROJECT_ID,
    )}/databases/(default)/documents/${path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
  const firestoreRestDocument = (data) => ({
    fields: Object.fromEntries(
      Object.entries(data).map(([field, value]) => {
        if (typeof value === "string") return [field, { stringValue: value }];
        if (typeof value === "number") {
          assert.equal(Number.isSafeInteger(value), true);
          return [field, { integerValue: String(value) }];
        }
        if (typeof value === "boolean") {
          return [field, { booleanValue: value }];
        }
        assert.fail(`Unsupported live deny canary field: ${field}`);
      }),
    ),
  });
  const assertPermissionDenied = async (response, operation) => {
    const payload = await response.json();
    assert.equal(
      response.status,
      403,
      `The live backup child ${operation} did not fail with HTTP 403.`,
    );
    const firestoreStatus = String(payload?.error?.status || "");
    assert.equal(
      firestoreStatus,
      "PERMISSION_DENIED",
      `The live backup child ${operation} did not fail with PERMISSION_DENIED.`,
    );
    return { httpStatus: response.status, firestoreStatus };
  };

  let signInPayload = null;
  let idToken = "";
  let probeSessionRef = null;
  let probeSessionRevision = "";
  let identityRequestCount = 0;
  let readRequestCount = 0;
  let updateRequestCount = 0;
  let deleteRequestCount = 0;
  let createRequestCount = 0;
  let temporarySessionCreateWriteCount = 0;
  let temporarySessionCleanupWriteCount = 0;
  let adminCanarySetupWriteCount = 0;
  let conditionalCanaryCleanupWriteCount = 0;
  let canaryOwnershipMismatchCount = 0;
  let existingCanaryOriginalHashPreserved = false;
  let readResult = null;
  let updateResult = null;
  let deleteResult = null;
  let createResult = null;
  const existingCanaryRef = db.doc(EXISTING_WRITE_CANARY.path);
  const absentCanaryRef = db.doc(ABSENT_WRITE_CANARY.path);
  const appCheckExchange = await exchangeAndVerifyAppCheckToken(firebaseConfig);
  const firestoreHeaders = (includeJson = false) => ({
    authorization: `Bearer ${idToken}`,
    "X-Firebase-AppCheck": appCheckExchange.token,
    ...(includeJson ? { "content-type": "application/json" } : {}),
  });
  await setPostBackupProbeMarkerState("PROBING", {
    postBackupProbeStartedAt: new Date(),
    postBackupProbeArtifactResidualCount: 0,
  });
  try {
    const [existingCanaryBefore, absentCanaryBefore] = await Promise.all([
      existingCanaryRef.get(),
      absentCanaryRef.get(),
    ]);
    assert.equal(
      existingCanaryBefore.exists,
      false,
      "The deterministic existing write canary path is not empty.",
    );
    assert.equal(
      absentCanaryBefore.exists,
      false,
      "The deterministic absent write canary path is not empty.",
    );
    await existingCanaryRef.create(EXISTING_WRITE_CANARY.data);
    adminCanarySetupWriteCount += 1;

    identityRequestCount += 1;
    const signInResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(
        firebaseConfig.apiKey,
      )}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: STAGING_VISUAL_ORIGIN,
          referer: `${STAGING_VISUAL_ORIGIN}/`,
        },
        body: JSON.stringify({
          email: credentials.student.email,
          password: credentials.student.password,
          returnSecureToken: true,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      },
    );
    assert.equal(
      signInResponse.status,
      200,
      "The synthetic fixture identity could not start the live deny probe.",
    );
    signInPayload = await signInResponse.json();
    idToken = String(signInPayload?.idToken || "");
    assert.ok(idToken.length > 100, "The live deny probe ID token is missing.");
    assert.equal(
      String(signInPayload?.localId || ""),
      STUDENT_UID,
      "The live deny probe signed in as an unexpected identity.",
    );
    const tokenSegments = idToken.split(".");
    assert.equal(
      tokenSegments.length,
      3,
      "The live deny probe token is invalid.",
    );
    const tokenPayload = JSON.parse(
      Buffer.from(tokenSegments[1], "base64url").toString("utf8"),
    );
    const authTime = Number(tokenPayload?.auth_time || 0);
    assert.ok(
      Number.isSafeInteger(authTime) && authTime > 0,
      "The live deny probe token auth_time is invalid.",
    );
    assert.equal(
      String(tokenPayload?.sub || tokenPayload?.user_id || ""),
      STUDENT_UID,
      "The live deny probe token subject is invalid.",
    );
    probeSessionRevision = sha256(
      `${FIXTURE_ID}\nbackup-access-probe\n${authTime}`,
    );
    probeSessionRef = db.doc(
      `application_sessions/${STUDENT_UID}/sessions/${authTime}`,
    );
    const sessionNow = new Date();
    await probeSessionRef.create({
      uid: STUDENT_UID,
      email: STUDENT_EMAIL,
      authTime,
      status: "active",
      createdAt: sessionNow,
      lastActivityAt: sessionNow,
      lastTouchAt: sessionNow,
      generalExpiresAt: new Date(sessionNow.getTime() + 10 * 60 * 1_000),
      highRiskExpiresAt: new Date(sessionNow.getTime() + 5 * 60 * 1_000),
      closedAt: null,
      schemaVersion: 2,
      authorityGeneration: "w1r2-2026-08-09",
      protocolVersion: 2,
      sessionRevision: probeSessionRevision,
      authorityModeAtOpen: "ENFORCE",
      fixtureOwner: FIXTURE_OWNER,
      fixtureId: FIXTURE_ID,
      fixtureRevision: FIXTURE_REVISION,
      fixturePurpose: "backup-access-deny-probe",
      probeRevision: POST_BACKUP_PROBE_REVISION_HASH,
    });
    temporarySessionCreateWriteCount += 1;

    readRequestCount += 1;
    readResult = await assertPermissionDenied(
      await fetch(firestoreDocumentUrl(probeDocumentPath), {
        method: "GET",
        headers: firestoreHeaders(),
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      }),
      "read",
    );

    updateRequestCount += 1;
    updateResult = await assertPermissionDenied(
      await fetch(
        `${firestoreDocumentUrl(
          EXISTING_WRITE_CANARY.path,
        )}?updateMask.fieldPaths=mutationAttempt&currentDocument.exists=true`,
        {
          method: "PATCH",
          headers: firestoreHeaders(true),
          body: JSON.stringify(
            firestoreRestDocument({
              mutationAttempt: sha256(
                `${EXISTING_WRITE_CANARY.revisionHash}\nunauthorized-update`,
              ),
            }),
          ),
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        },
      ),
      "update",
    );

    deleteRequestCount += 1;
    deleteResult = await assertPermissionDenied(
      await fetch(
        `${firestoreDocumentUrl(
          EXISTING_WRITE_CANARY.path,
        )}?currentDocument.exists=true`,
        {
          method: "DELETE",
          headers: firestoreHeaders(),
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        },
      ),
      "delete",
    );

    createRequestCount += 1;
    createResult = await assertPermissionDenied(
      await fetch(
        `${firestoreDocumentUrl(
          ABSENT_WRITE_CANARY.path,
        )}?currentDocument.exists=false`,
        {
          method: "PATCH",
          headers: firestoreHeaders(true),
          body: JSON.stringify(firestoreRestDocument(ABSENT_WRITE_CANARY.data)),
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        },
      ),
      "create",
    );
  } finally {
    let cleanupError = null;
    try {
      conditionalCanaryCleanupWriteCount += await db.runTransaction(
        async (transaction) => {
          let cleanupWriteCount = 0;
          const [existingCanary, absentCanary] = await transaction.getAll(
            existingCanaryRef,
            absentCanaryRef,
          );
          for (const [snapshot, canary] of [
            [existingCanary, EXISTING_WRITE_CANARY],
            [absentCanary, ABSENT_WRITE_CANARY],
          ]) {
            if (!snapshot.exists) continue;
            const data = snapshot.data() || {};
            const ownershipMatches =
              data.fixtureOwner === FIXTURE_OWNER &&
              data.fixtureId === FIXTURE_ID &&
              data.fixtureRevision === FIXTURE_REVISION &&
              data.canaryPurpose === canary.data.canaryPurpose &&
              data.canaryRevision === canary.revisionHash;
            if (!ownershipMatches) {
              canaryOwnershipMismatchCount += 1;
              continue;
            }
            if (canary === EXISTING_WRITE_CANARY) {
              existingCanaryOriginalHashPreserved =
                sha256(canonicalBackupJson(data)) === canary.documentHash;
            }
            transaction.delete(snapshot.ref);
            cleanupWriteCount += 1;
          }
          return cleanupWriteCount;
        },
      );
    } catch (error) {
      cleanupError = error;
    }
    try {
      if (probeSessionRef) {
        temporarySessionCleanupWriteCount += await db.runTransaction(
          async (transaction) => {
            const snapshot = await transaction.get(probeSessionRef);
            if (!snapshot.exists) return 0;
            assert.equal(
              snapshot.data()?.fixtureOwner,
              FIXTURE_OWNER,
              "The live deny probe session ownership changed.",
            );
            assert.equal(
              snapshot.data()?.fixtureId,
              FIXTURE_ID,
              "The live deny probe session fixture changed.",
            );
            assert.equal(snapshot.data()?.fixtureRevision, FIXTURE_REVISION);
            assert.equal(
              snapshot.data()?.probeRevision,
              POST_BACKUP_PROBE_REVISION_HASH,
            );
            assert.equal(
              snapshot.data()?.sessionRevision,
              probeSessionRevision,
              "The live deny probe session revision changed.",
            );
            transaction.delete(probeSessionRef);
            return 1;
          },
        );
      }
    } catch (error) {
      cleanupError ||= error;
    }
    const [existingCanaryAfter, absentCanaryAfter, probeSessionAfter] =
      await Promise.all([
        existingCanaryRef.get(),
        absentCanaryRef.get(),
        probeSessionRef ? probeSessionRef.get() : Promise.resolve(null),
      ]);
    idToken = "";
    signInPayload = null;
    appCheckExchange.clear();
    if (cleanupError) throw cleanupError;
    assert.equal(
      canaryOwnershipMismatchCount,
      0,
      "A deterministic live deny canary was not owned by this fixture revision.",
    );
    assert.equal(
      existingCanaryAfter.exists || absentCanaryAfter.exists,
      false,
      "A deterministic live deny canary was not removed.",
    );
    assert.equal(
      probeSessionAfter?.exists || false,
      false,
      "The live deny probe session was not removed.",
    );
  }

  assert.equal(existingCanaryOriginalHashPreserved, true);
  assert.deepEqual(readResult, {
    httpStatus: 403,
    firestoreStatus: "PERMISSION_DENIED",
  });
  assert.deepEqual(updateResult, {
    httpStatus: 403,
    firestoreStatus: "PERMISSION_DENIED",
  });
  assert.deepEqual(deleteResult, {
    httpStatus: 403,
    firestoreStatus: "PERMISSION_DENIED",
  });
  assert.deepEqual(createResult, {
    httpStatus: 403,
    firestoreStatus: "PERMISSION_DENIED",
  });
  const requestCount =
    identityRequestCount +
    appCheckExchange.binding.appCheckExchangeRequestCount +
    readRequestCount +
    updateRequestCount +
    deleteRequestCount +
    createRequestCount;
  const writeRequestCount =
    updateRequestCount + deleteRequestCount + createRequestCount;
  const attestation = {
    status: "VERIFIED_DENIED",
    probeKind: BACKUP_ACCESS_PROBE_KIND,
    sessionBound: true,
    ...appCheckExchange.binding,
    appCheckHeaderRequestCount:
      readRequestCount +
      updateRequestCount +
      deleteRequestCount +
      createRequestCount,
    readDenied: true,
    writeDenied: true,
    updateDenied: true,
    deleteDenied: true,
    createDenied: true,
    readHttpStatus: readResult.httpStatus,
    readFirestoreStatus: readResult.firestoreStatus,
    updateHttpStatus: updateResult.httpStatus,
    updateFirestoreStatus: updateResult.firestoreStatus,
    deleteHttpStatus: deleteResult.httpStatus,
    deleteFirestoreStatus: deleteResult.firestoreStatus,
    createHttpStatus: createResult.httpStatus,
    createFirestoreStatus: createResult.firestoreStatus,
    projectIdHash: sha256(STAGING_PROJECT_ID),
    identityUidHash: sha256(STUDENT_UID),
    backupNamespaceHash: sha256(BACKUP_ROOT_PATH),
    backupManifestHash: backupManifestFor(backups).hash,
    localRulesSourceHash: sha256(
      readFileSync(resolve("firestore.rules"), "utf8"),
    ),
    probeSessionPathHash: sha256(probeSessionRef.path),
    readDocumentPathHash: sha256(probeDocumentPath),
    existingWriteCanaryPathHash: sha256(EXISTING_WRITE_CANARY.path),
    absentWriteCanaryPathHash: sha256(ABSENT_WRITE_CANARY.path),
    existingWriteCanaryRevisionHash: EXISTING_WRITE_CANARY.revisionHash,
    absentWriteCanaryRevisionHash: ABSENT_WRITE_CANARY.revisionHash,
    existingWriteCanaryDocumentHash: EXISTING_WRITE_CANARY.documentHash,
    absentWriteCanaryDocumentHash: ABSENT_WRITE_CANARY.documentHash,
    existingCanaryOriginalHashPreserved,
    requestCount,
    identityRequestCount,
    accessRequestCount:
      readRequestCount +
      updateRequestCount +
      deleteRequestCount +
      createRequestCount,
    readRequestCount,
    writeRequestCount,
    updateRequestCount,
    deleteRequestCount,
    createRequestCount,
    adminCanarySetupWriteCount,
    conditionalCanaryCleanupWriteCount,
    canaryOwnershipMismatchCount,
    canaryResidualCount: 0,
    temporarySessionWriteCount:
      temporarySessionCreateWriteCount + temporarySessionCleanupWriteCount,
    temporarySessionCleanupWriteCount,
    temporarySessionResidualCount: 0,
    rawTokenOutputCount: 0,
    rawResponseBodyOutputCount: 0,
    rawDocumentPathOutputCount: 0,
    rawCanaryDocumentOutputCount: 0,
    rawPiiOutputCount: 0,
  };
  assert.equal(requestCount, 6);
  assert.equal(writeRequestCount, 3);
  assert.equal(adminCanarySetupWriteCount, 1);
  assert.equal(conditionalCanaryCleanupWriteCount, 1);
  assert.equal(temporarySessionCreateWriteCount, 1);
  assert.equal(temporarySessionCleanupWriteCount, 1);
  const result = {
    ...attestation,
    attestationHash: sha256(canonicalJson(attestation)),
  };
  await setPostBackupProbeMarkerState("VERIFIED_CLEAN", {
    postBackupProbeCompletedAt: new Date(),
    postBackupProbeAttestationHash: result.attestationHash,
    postBackupProbeArtifactResidualCount: 0,
  });
  return result;
};

const createAndVerifyBackups = async (inventory) => {
  assert.ok(
    inventory.backups.length <= MAX_ATOMIC_BACKUP_COUNT,
    "The backup create batch exceeds its atomic bound.",
  );
  const batch = backupDb.batch();
  for (const backup of inventory.backups) {
    batch.create(
      backupDb.doc(`${BACKUP_DOCUMENTS_PATH}/${sha256(backup.path)}`),
      backupDocumentData(backup),
    );
  }
  await batch.commit();
  const marker = await db.doc(RUN_PATH).get();
  assert.equal(marker.exists, true);
  const stored = await loadBackups(marker.data() || {});
  assert.equal(stored.manifest.hash, inventory.manifest.hash);
  await setIsolationState("BACKUP_READY", {
    backupVerifiedCount: stored.backups.length,
    backupVerifiedManifestHash: stored.manifest.hash,
  });
  return stored;
};

const parentCollectionPath = (documentPath) =>
  String(documentPath).split("/").slice(0, -1).join("/");

const strictBackupsByCollection = (backups) => {
  const grouped = new Map(
    [...strictCollections.keys()].map((collectionPath) => [collectionPath, []]),
  );
  for (const backup of backups.filter(
    (item) => item.kind === "STRICT_ISOLATION",
  )) {
    const collectionPath = parentCollectionPath(backup.path);
    assert.equal(
      grouped.has(collectionPath),
      true,
      "A strict backup is outside the bounded collection manifest.",
    );
    grouped.get(collectionPath).push(backup);
  }
  for (const rows of grouped.values()) {
    rows.sort((left, right) => left.path.localeCompare(right.path));
  }
  return grouped;
};

const canonicalSnapshotHash = (snapshot) =>
  sha256(canonicalBackupJson(snapshot.exists ? snapshot.data() : null));

const assertSnapshotMatchesBackup = (snapshot, backup, message) => {
  assert.equal(snapshot.ref.path, backup.path);
  assert.equal(snapshot.exists, backup.exists, message);
  if (snapshot.exists) assertLosslessBackupValue(snapshot.data());
  assert.equal(canonicalSnapshotHash(snapshot), backup.dataHash, message);
};

const assertIsolationMarkerPair = (
  runMarker,
  backupRoot,
  { allowedStatuses },
) => {
  assert.equal(runMarker.exists, true, "The fixture run marker is missing.");
  assert.equal(backupRoot.exists, true, "The fixture backup root is missing.");
  const runData = runMarker.data() || {};
  const backupData = backupRoot.data() || {};
  for (const value of [runData, backupData]) {
    assert.equal(value.fixtureOwner, FIXTURE_OWNER);
    assert.equal(value.fixtureId, FIXTURE_ID);
    assert.equal(Number(value.fixtureRevision), FIXTURE_REVISION);
    assert.equal(value.projectId, STAGING_PROJECT_ID);
    assert.equal(value.planHash, planHash);
    assert.equal(Number(value.backupSchemaVersion), BACKUP_SCHEMA_VERSION);
    assert.equal(
      Number(value.isolationProtocolVersion),
      ISOLATION_PROTOCOL_VERSION,
    );
    assert.equal(value.backupManifestHash, runData.backupManifestHash);
    assert.match(value.auxiliaryPreflightHash, /^[a-f0-9]{64}$/u);
    assert.equal(value.auxiliaryPreflightHash, runData.auxiliaryPreflightHash);
    assert.equal(Number(value.auxiliaryPreflightDocumentCount), 0);
    assert.equal(
      Number(value.auxiliaryPreflightNamespaceCount),
      Number(runData.auxiliaryPreflightNamespaceCount),
    );
    assert.equal(
      value.plannedMutationTopologyAllowlistHash,
      plannedMutationTopologyAllowlistHash,
    );
    assert.equal(
      value.plannedMutationTopologyAllowlistHash,
      runData.plannedMutationTopologyAllowlistHash,
    );
    assert.match(value.plannedMutationTopologyBaselineHash, /^[a-f0-9]{64}$/u);
    assert.equal(
      value.plannedMutationTopologyBaselineHash,
      runData.plannedMutationTopologyBaselineHash,
    );
    assert.equal(
      allowedStatuses.has(value.status),
      true,
      "The fixture marker is in an unsafe state for this transaction.",
    );
  }
  assert.equal(runData.status, backupData.status);
  return runData;
};

const readTransactionIsolationState = async (transaction, singletonBackups) => {
  const headerSnapshots = await transaction.getAll(
    backupDb.doc(RUN_PATH),
    backupDb.doc(BACKUP_ROOT_PATH),
    ...singletonBackups.map((backup) => backupDb.doc(backup.path)),
  );
  const strictSnapshots = await Promise.all(
    [...strictCollections.keys()].map((collectionPath) =>
      transaction.get(
        backupDb
          .collection(collectionPath)
          .limit(STRICT_COLLECTION_BACKUP_LIMIT + 1),
      ),
    ),
  );
  return {
    runMarker: headerSnapshots[0],
    backupRoot: headerSnapshots[1],
    singletonSnapshots: headerSnapshots.slice(2),
    strictSnapshots,
  };
};

const assertStrictSetupSnapshot = (
  collectionPath,
  snapshot,
  expectedBackups,
) => {
  assert.ok(
    snapshot.size <= STRICT_COLLECTION_BACKUP_LIMIT,
    `Strict collection changed beyond its backup bound: ${collectionPath}`,
  );
  const expectedPaths = expectedBackups.map((backup) => backup.path).sort();
  const actualPaths = snapshot.docs.map((document) => document.ref.path).sort();
  assert.deepEqual(
    actualPaths,
    expectedPaths,
    `Strict collection changed after backup: ${collectionPath}`,
  );
  const backupByPath = new Map(
    expectedBackups.map((backup) => [backup.path, backup]),
  );
  for (const document of snapshot.docs) {
    assertSnapshotMatchesBackup(
      document,
      backupByPath.get(document.ref.path),
      `Strict document changed after backup: ${collectionPath}`,
    );
  }
};

const commitIsolationCutover = async (backups, expectedManifestHash) => {
  const [preCutoverRunMarker, preCutoverBackupRoot] = await db.getAll(
    db.doc(RUN_PATH),
    db.doc(BACKUP_ROOT_PATH),
  );
  const preCutoverMarkerData = assertIsolationMarkerPair(
    preCutoverRunMarker,
    preCutoverBackupRoot,
    { allowedStatuses: new Set(["ISOLATING"]) },
  );
  const preCutoverTopology = await assertPlannedMutationChildTopology();
  assert.equal(
    preCutoverTopology.observedHash,
    preCutoverMarkerData.plannedMutationTopologyBaselineHash,
    "The planned mutation child topology changed before cutover.",
  );
  const manifest = backupManifestFor(backups);
  assert.equal(
    manifest.hash,
    expectedManifestHash,
    "Cutover refused an unbound backup manifest.",
  );
  const strictBackups = backups.filter(
    (backup) => backup.kind === "STRICT_ISOLATION",
  );
  const singletonBackups = backups.filter(
    (backup) => backup.kind === "SINGLETON_OVERWRITE",
  );
  assert.equal(singletonBackups.length, overwriteDocs.size);
  const grouped = strictBackupsByCollection(backups);
  const writeCount =
    strictBackups.length + overwriteDocs.size + createDocs.size + 2;
  assert.ok(
    writeCount <= 500,
    "The atomic fixture cutover exceeds the Firestore write limit.",
  );

  await backupDb.runTransaction(async (transaction) => {
    const state = await readTransactionIsolationState(
      transaction,
      singletonBackups,
    );
    const markerData = assertIsolationMarkerPair(
      state.runMarker,
      state.backupRoot,
      { allowedStatuses: new Set(["ISOLATING"]) },
    );
    assert.equal(
      markerData.backupManifestHash,
      expectedManifestHash,
      "Cutover marker is not bound to the verified backup manifest.",
    );

    const collectionPaths = [...strictCollections.keys()];
    for (let index = 0; index < collectionPaths.length; index += 1) {
      const collectionPath = collectionPaths[index];
      assertStrictSetupSnapshot(
        collectionPath,
        state.strictSnapshots[index],
        grouped.get(collectionPath),
      );
    }
    for (let index = 0; index < singletonBackups.length; index += 1) {
      assertSnapshotMatchesBackup(
        state.singletonSnapshots[index],
        singletonBackups[index],
        "A singleton changed after backup.",
      );
    }

    for (const backup of strictBackups) {
      transaction.delete(backupDb.doc(backup.path));
    }
    for (const [path, data] of overwriteDocs) {
      transaction.set(backupDb.doc(path), data);
    }
    for (const [path, data] of createDocs) {
      transaction.create(backupDb.doc(path), data);
    }
    const ready = {
      status: "READY",
      isolatedDocumentCount: strictBackups.length,
      cutoverTransactionWriteCount: writeCount,
      cutoverCommittedAt: new Date(),
    };
    transaction.update(backupDb.doc(RUN_PATH), ready);
    transaction.update(backupDb.doc(BACKUP_ROOT_PATH), ready);
  });

  return {
    isolatedDocumentCount: strictBackups.length,
    cutoverTransactionWriteCount: writeCount,
  };
};

const expectedFixtureDataForPath = (path) =>
  createDocs.get(path) || overwriteDocs.get(path) || null;

const fixtureSnapshotMatchesSeed = (snapshot) => {
  if (!snapshot.exists) return false;
  assertLosslessBackupValue(snapshot.data());
  const expected = expectedFixtureDataForPath(snapshot.ref.path);
  if (!expected) return false;
  return (
    fixtureValueHash(
      stableFixtureDocument(snapshot.ref.path, snapshot.data()),
    ) === fixtureValueHash(stableFixtureDocument(snapshot.ref.path, expected))
  );
};

const assertCleanupStrictSnapshot = (
  collectionPath,
  snapshot,
  expectedBackups,
  expectedPhase,
) => {
  assert.ok(
    snapshot.size <= STRICT_COLLECTION_BACKUP_LIMIT,
    `Strict cleanup collection exceeds its backup bound: ${collectionPath}`,
  );
  const backupByPath = new Map(
    expectedBackups.map((backup) => [backup.path, backup]),
  );
  const fixturePaths = new Set(
    (strictCollections.get(collectionPath) || []).map(
      (id) => `${collectionPath}/${id}`,
    ),
  );
  const expectedPaths =
    expectedPhase === "FIXTURE"
      ? [...fixturePaths].sort()
      : [...backupByPath.keys()].sort();
  const actualPaths = snapshot.docs.map((document) => document.ref.path).sort();
  assert.deepEqual(
    actualPaths,
    expectedPaths,
    `Strict cleanup phase mismatch: ${collectionPath}`,
  );
  for (const document of snapshot.docs) {
    if (expectedPhase === "ORIGINAL") {
      assertSnapshotMatchesBackup(
        document,
        backupByPath.get(document.ref.path),
        `An unknown strict original value blocks cleanup: ${collectionPath}`,
      );
      continue;
    }
    assert.equal(
      fixturePaths.has(document.ref.path) &&
        fixtureSnapshotMatchesSeed(document),
      true,
      `An unknown strict row blocks cleanup: ${collectionPath}`,
    );
  }
};

const assertCleanupSingletonSnapshot = (snapshot, backup, expectedPhase) => {
  if (expectedPhase === "ORIGINAL") {
    assertSnapshotMatchesBackup(
      snapshot,
      backup,
      "A singleton no longer matches its backed-up original value.",
    );
    return;
  }
  assert.equal(snapshot.exists, true, "A fixture singleton is missing.");
  assert.equal(
    fixtureSnapshotMatchesSeed(snapshot),
    true,
    "An unknown singleton value blocks cleanup.",
  );
};

const cleanupExpectedPhase = (markerData) => {
  if (markerData.status === "CLEANING") {
    assert.ok(
      typeof markerData.cleanupOriginState === "string" &&
        markerData.cleanupOriginState.length > 0,
      "The cleanup origin state is missing.",
    );
    return markerData.cleanupOriginState === "READY" ? "FIXTURE" : "ORIGINAL";
  }
  assert.equal(
    ["RESTORING", "RESTORED"].includes(markerData.status),
    true,
    "The restore transaction received an unexpected marker state.",
  );
  return "ORIGINAL";
};

const verifyRestoredStrictCollections = async (backups) => {
  const grouped = strictBackupsByCollection(backups);
  const rows = [];
  for (const [collectionPath, expectedBackups] of grouped) {
    const snapshot = await backupDb
      .collection(collectionPath)
      .limit(STRICT_COLLECTION_BACKUP_LIMIT + 1)
      .get();
    assert.ok(
      snapshot.size <= STRICT_COLLECTION_BACKUP_LIMIT,
      `Restored strict collection exceeds its backup bound: ${collectionPath}`,
    );
    const expectedPaths = expectedBackups.map((backup) => backup.path).sort();
    const actualPaths = snapshot.docs
      .map((document) => document.ref.path)
      .sort();
    assert.deepEqual(
      actualPaths,
      expectedPaths,
      `Restored strict collection cardinality mismatch: ${collectionPath}`,
    );
    const backupByPath = new Map(
      expectedBackups.map((backup) => [backup.path, backup]),
    );
    for (const document of snapshot.docs) {
      assertSnapshotMatchesBackup(
        document,
        backupByPath.get(document.ref.path),
        `A strict document was not restored exactly: ${collectionPath}`,
      );
    }
    rows.push({
      collectionPath,
      expectedRowCount: expectedPaths.length,
      actualRowCount: actualPaths.length,
      extraRowCount: actualPaths.filter((path) => !backupByPath.has(path))
        .length,
      restoredManifestHash: sha256(
        canonicalJson(
          expectedBackups
            .map(backupManifestRow)
            .sort((left, right) => left.backupId.localeCompare(right.backupId)),
        ),
      ),
    });
  }
  return {
    collectionCount: rows.length,
    restoredRowCount: rows.reduce(
      (count, row) => count + row.actualRowCount,
      0,
    ),
    extraRowCount: rows.reduce((count, row) => count + row.extraRowCount, 0),
    manifestHash: sha256(canonicalJson(rows)),
    collections: rows,
  };
};

const restoreBackups = async (backups, expectedManifestHash) => {
  const topologyBeforeRestore = await assertPlannedMutationChildTopology();
  assert.equal(
    topologyBeforeRestore.allowlistHash,
    plannedMutationTopologyAllowlistHash,
  );
  const manifest = backupManifestFor(backups);
  assert.equal(
    manifest.hash,
    expectedManifestHash,
    "Restore refused an unbound backup manifest.",
  );
  const singletonBackups = backups.filter(
    (backup) => backup.kind === "SINGLETON_OVERWRITE",
  );
  const grouped = strictBackupsByCollection(backups);
  const writeCount = backups.length + createDocs.size + 2;
  assert.ok(
    writeCount <= 500,
    "The atomic fixture restore exceeds the Firestore write limit.",
  );

  const transactionResult = await backupDb.runTransaction(
    async (transaction) => {
      const state = await readTransactionIsolationState(
        transaction,
        singletonBackups,
      );
      const markerData = assertIsolationMarkerPair(
        state.runMarker,
        state.backupRoot,
        {
          allowedStatuses: new Set(["CLEANING", "RESTORING", "RESTORED"]),
        },
      );
      assert.equal(
        markerData.backupManifestHash,
        expectedManifestHash,
        "Restore marker is not bound to the verified backup manifest.",
      );
      const expectedPhase = cleanupExpectedPhase(markerData);

      const collectionPaths = [...strictCollections.keys()];
      for (let index = 0; index < collectionPaths.length; index += 1) {
        const collectionPath = collectionPaths[index];
        assertCleanupStrictSnapshot(
          collectionPath,
          state.strictSnapshots[index],
          grouped.get(collectionPath),
          expectedPhase,
        );
      }
      for (let index = 0; index < singletonBackups.length; index += 1) {
        assertCleanupSingletonSnapshot(
          state.singletonSnapshots[index],
          singletonBackups[index],
          expectedPhase,
        );
      }

      const deletedFixtureDocumentCount = Math.max(
        Number(markerData.deletedFixtureDocumentCount || 0),
        state.strictSnapshots.reduce(
          (count, snapshot) =>
            count +
            snapshot.docs.filter((document) =>
              createDocs.has(document.ref.path),
            ).length,
          0,
        ),
      );
      for (const path of createDocs.keys())
        transaction.delete(backupDb.doc(path));
      for (const backup of backups) {
        if (backup.exists)
          transaction.set(backupDb.doc(backup.path), backup.data);
        else transaction.delete(backupDb.doc(backup.path));
      }
      const restoring = {
        status: "RESTORING",
        restoredDocumentCount: backups.length,
        restoredBackupManifestHash: manifest.hash,
        restoreTransactionWriteCount: writeCount,
        restoreCommittedAt: markerData.restoreCommittedAt || new Date(),
        deletedFixtureDocumentCount,
      };
      transaction.update(backupDb.doc(RUN_PATH), restoring);
      transaction.update(backupDb.doc(BACKUP_ROOT_PATH), restoring);
      return {
        deletedFixtureDocumentCount,
        plannedMutationTopologyBaselineHash:
          markerData.plannedMutationTopologyBaselineHash,
      };
    },
  );

  const restoredSnapshots = await getBackupSnapshots(
    backups.map((backup) => backup.path),
  );
  for (let index = 0; index < backups.length; index += 1) {
    assertSnapshotMatchesBackup(
      restoredSnapshots[index],
      backups[index],
      "A document was not restored to its exact canonical value.",
    );
  }
  const strictRestoration = await verifyRestoredStrictCollections(backups);
  assert.equal(strictRestoration.extraRowCount, 0);
  const topologyAfterRestore = await assertPlannedMutationChildTopology();
  assert.equal(
    topologyAfterRestore.observedHash,
    transactionResult.plannedMutationTopologyBaselineHash,
    "The planned mutation child topology was not restored to its baseline.",
  );
  return {
    restoredDocumentCount: backups.length,
    restoredExistingDocumentCount: backups.filter((backup) => backup.exists)
      .length,
    restoredAbsentDocumentCount: backups.filter((backup) => !backup.exists)
      .length,
    restoredBackupManifestHash: manifest.hash,
    restoreTransactionWriteCount: writeCount,
    deletedFixtureDocumentCount: transactionResult.deletedFixtureDocumentCount,
    strictRestoration,
    plannedMutationTopology: topologyAfterRestore,
  };
};

const markIsolationRestored = async (backups, details) => {
  const singletonBackups = backups.filter(
    (backup) => backup.kind === "SINGLETON_OVERWRITE",
  );
  const grouped = strictBackupsByCollection(backups);
  await backupDb.runTransaction(async (transaction) => {
    const state = await readTransactionIsolationState(
      transaction,
      singletonBackups,
    );
    const markerData = assertIsolationMarkerPair(
      state.runMarker,
      state.backupRoot,
      { allowedStatuses: new Set(["RESTORING"]) },
    );
    assert.equal(
      markerData.backupManifestHash,
      backupManifestFor(backups).hash,
      "Final restore marker is not bound to the backup manifest.",
    );
    const collectionPaths = [...strictCollections.keys()];
    for (let index = 0; index < collectionPaths.length; index += 1) {
      const collectionPath = collectionPaths[index];
      assertCleanupStrictSnapshot(
        collectionPath,
        state.strictSnapshots[index],
        grouped.get(collectionPath),
        "ORIGINAL",
      );
    }
    for (let index = 0; index < singletonBackups.length; index += 1) {
      assertCleanupSingletonSnapshot(
        state.singletonSnapshots[index],
        singletonBackups[index],
        "ORIGINAL",
      );
    }
    const restored = {
      status: "RESTORED",
      restoreVerifiedAt: new Date(),
      ...details,
    };
    transaction.update(backupDb.doc(RUN_PATH), restored);
    transaction.update(backupDb.doc(BACKUP_ROOT_PATH), restored);
  });
};

const strictCollectionAudit = async ({ expectedSeeded }) => {
  const rows = [];
  for (const [collectionPath, expectedIds] of strictCollections) {
    const allowedIds = [...expectedIds].sort();
    const targetIds = expectedSeeded ? [...expectedIds].sort() : [];
    const cardinalityReadLimit = Math.max(1, targetIds.length + 1);
    const expectedSnapshots = await getSnapshots(
      targetIds.map((id) => `${collectionPath}/${id}`),
    );
    assert.equal(
      expectedSnapshots.every((snapshot) => snapshot.exists),
      true,
      `A strict fixture document is missing: ${collectionPath}`,
    );
    const snapshot = await db
      .collection(collectionPath)
      .limit(cardinalityReadLimit)
      .get();
    const actualIds = snapshot.docs.map((item) => item.id).sort();
    const targetIdSet = new Set(targetIds);
    assert.deepEqual(
      actualIds,
      targetIds,
      `Strict fixture collection cardinality mismatch: ${collectionPath}`,
    );
    rows.push({
      collectionPath,
      allowIdCount: allowedIds.length,
      allowIdSetHash: sha256(allowedIds.join("\n")),
      expectedRowCount: targetIds.length,
      expectedIdSetHash: sha256(targetIds.join("\n")),
      actualRowCount: actualIds.length,
      actualIdSetHash: sha256(actualIds.join("\n")),
      extraRowCount: actualIds.filter((id) => !targetIdSet.has(id)).length,
      cardinalityReadLimit,
      expectedDocumentReadCount: targetIds.length,
    });
  }
  return {
    collectionCount: rows.length,
    allowedRowCount: rows.reduce((count, row) => count + row.allowIdCount, 0),
    expectedRowCount: rows.reduce(
      (count, row) => count + row.expectedRowCount,
      0,
    ),
    actualRowCount: rows.reduce((count, row) => count + row.actualRowCount, 0),
    rowCount: rows.reduce((count, row) => count + row.actualRowCount, 0),
    allowlistManifestHash: sha256(
      canonicalJson(
        rows.map(({ collectionPath, allowIdCount, allowIdSetHash }) => ({
          collectionPath,
          allowIdCount,
          allowIdSetHash,
        })),
      ),
    ),
    manifestHash: sha256(canonicalJson(rows)),
    extraRowCount: rows.reduce((count, row) => count + row.extraRowCount, 0),
    collections: rows,
  };
};

const assertRoleProfiles = (snapshotsByPath) => {
  const expectedProfiles = [
    {
      uid: STUDENT_UID,
      email: STUDENT_EMAIL,
      role: "student",
      teacherPortalEnabled: false,
      permissions: [],
    },
    {
      uid: TEACHER_UID,
      email: TEACHER_EMAIL,
      role: "teacher",
      teacherPortalEnabled: true,
      permissions: [
        "lesson_read",
        "point_manage",
        "quiz_read",
        "student_list_read",
      ],
    },
    {
      uid: ADMIN_UID,
      email: ADMIN_EMAIL,
      role: "teacher",
      teacherPortalEnabled: true,
      permissions: [],
    },
  ];
  for (const expected of expectedProfiles) {
    const snapshot = snapshotsByPath.get(`users/${expected.uid}`);
    assert.equal(snapshot?.exists, true, "A fixture role profile is missing.");
    const data = snapshot.data() || {};
    assert.equal(data.uid, expected.uid);
    assert.equal(String(data.email || "").toLowerCase(), expected.email);
    assert.equal(data.role, expected.role);
    assert.equal(
      data.teacherPortalEnabled === true,
      expected.teacherPortalEnabled,
    );
    assert.deepEqual(
      [...(data.staffPermissions || [])].sort(),
      [...expected.permissions].sort(),
    );
  }
};

const stableFixtureDocument = (path, value) => {
  if (!/^users\/[^/]+$/u.test(path)) return value;
  const { lastLogin: _lastLogin, photoURL: _photoURL, ...stable } = value || {};
  return stable;
};

const assertPresentationAttestation = (snapshotsByPath) => {
  const data = (path) => {
    const snapshot = snapshotsByPath.get(path);
    assert.equal(
      snapshot?.exists,
      true,
      "A presentation fixture row is missing.",
    );
    return snapshot.data() || {};
  };
  const account = data(`semester_wis_accounts/${wisAccountId}`);
  const ranking = data(`semester_wis_rankings/${wisAccountId}`);
  const order = data(`semester_wis_orders/${wisOrderId}`);
  const legacyWallet = data(
    `years/${YEAR}/semesters/${SEMESTER}/point_wallets/${STUDENT_UID}`,
  );
  const legacyOrder = data(
    `years/${YEAR}/semesters/${SEMESTER}/point_orders/w10p-point-order`,
  );
  const hall = data(
    `years/${YEAR}/semesters/${SEMESTER}/point_public/hall_of_fame`,
  );

  const derivedRows = [
    ["teacher-points", account.studentUid, account.displayName],
    ["teacher-points-grant", account.studentUid, account.displayName],
    ["teacher-points-hall-of-fame", ranking.studentUid, ranking.displayName],
    ["teacher-points-requests", order.studentUid, account.displayName],
    ["legacy-teacher-points", legacyWallet.uid, legacyWallet.studentName],
    [
      "legacy-teacher-points-requests",
      legacyOrder.uid,
      legacyOrder.studentName,
    ],
  ];
  for (const [, uid, studentName] of derivedRows) {
    assert.equal(uid, STUDENT_UID);
    assert.equal(studentName, "W10P 학생");
  }
  assert.equal(order.productId, wisProductId);
  assert.equal(order.productName, "W10P 위스 상품");
  assert.equal(legacyOrder.productName, "W10P 위스 상품");

  const hallSurfaceRows = [
    ...(hall.gradeTop3ByGrade?.[3] || []).map((row) => [
      "public-hall-grade",
      row,
    ]),
    ...(hall.classTop3ByClassKey?.["3-1"] || []).map((row) => [
      "public-hall-class",
      row,
    ]),
  ];
  assert.equal(hallSurfaceRows.length, 2);
  for (const [, row] of hallSurfaceRows) {
    assert.equal(row.uid, STUDENT_UID);
    assert.equal(row.studentName, "W10P 학생");
    assert.equal(row.displayName, "W10P 학생");
  }

  const rows = [
    ...derivedRows,
    ...hallSurfaceRows.map(([surface, row]) => [
      surface,
      row.uid,
      row.studentName,
    ]),
  ].map(([surface, uid, studentName]) => ({
    surface,
    uidHash: sha256(uid),
    studentNameHash: sha256(studentName),
  }));
  return {
    teacherPointRowCount: 1,
    teacherGrantTargetCount: 1,
    teacherHallRankingCount: 1,
    teacherRequestRowCount: 1,
    legacyPointRowCount: 1,
    legacyRequestRowCount: 1,
    publicHallEntryCount: hallSurfaceRows.length,
    attestedPersonRowCount: rows.length,
    unexpectedPersonRowCount: 0,
    attestationHash: sha256(canonicalJson(rows)),
  };
};

const audit = async ({ requireLiveBackupAccessProbe = true } = {}) => {
  const marker = await db.doc(RUN_PATH).get();
  assert.equal(
    marker.exists,
    true,
    "The visual fixture run marker is missing.",
  );
  assert.equal(marker.data()?.fixtureId, FIXTURE_ID);
  assert.equal(marker.data()?.fixtureOwner, FIXTURE_OWNER);
  assert.equal(marker.data()?.fixtureRevision, FIXTURE_REVISION);
  assert.equal(marker.data()?.projectId, STAGING_PROJECT_ID);
  assert.equal(marker.data()?.planHash, planHash);
  assert.equal(marker.data()?.status, "READY");
  const backupRoot = await db.doc(BACKUP_ROOT_PATH).get();
  assert.equal(backupRoot.exists, true, "The fixture backup root is missing.");
  assert.equal(backupRoot.data()?.status, "READY");
  assert.equal(
    backupRoot.data()?.backupManifestHash,
    marker.data()?.backupManifestHash,
  );
  const preBackupAccessProbe = marker.data()?.preBackupAccessProbe;
  assert.ok(
    preBackupAccessProbe &&
      typeof preBackupAccessProbe === "object" &&
      !Array.isArray(preBackupAccessProbe),
    "The pre-backup access probe attestation is missing.",
  );
  const {
    attestationHash: preBackupAccessProbeAttestationHash,
    ...preBackupAccessProbeProjection
  } = preBackupAccessProbe;
  assert.equal(preBackupAccessProbe.status, "VERIFIED_DENIED");
  assert.equal(preBackupAccessProbe.appCheckBound, true);
  assert.equal(preBackupAccessProbe.appCheckProjectBindingVerified, true);
  assert.equal(preBackupAccessProbe.appCheckAppBindingVerified, true);
  assert.equal(preBackupAccessProbe.appCheckTokenValidAtVerification, true);
  assert.equal(preBackupAccessProbe.appCheckTokenLifetimeWithinMaximum, true);
  assert.equal(preBackupAccessProbe.appCheckExchangeRequestCount, 1);
  assert.equal(preBackupAccessProbe.appCheckAdminVerificationCount, 1);
  assert.equal(preBackupAccessProbe.appCheckHeaderRequestCount, 6);
  assert.equal(preBackupAccessProbe.requestCount, 8);
  assert.equal(preBackupAccessProbe.rawAppCheckDebugTokenOutputCount, 0);
  assert.equal(preBackupAccessProbe.rawAppCheckJwtOutputCount, 0);
  assert.match(preBackupAccessProbe.appCheckDebugTokenHash, /^[a-f0-9]{64}$/u);
  assert.equal(preBackupAccessProbe.verifiedAppIdHash, sha256(STAGING_APP_ID));
  assert.equal(
    preBackupAccessProbe.verifiedProjectIdHash,
    sha256(STAGING_PROJECT_ID),
  );
  assert.equal(
    preBackupAccessProbe.verifiedProjectNumberHash,
    sha256(STAGING_PROJECT_NUMBER),
  );
  assert.equal(
    preBackupAccessProbe.verifiedAudienceSetHash,
    sha256(canonicalJson(APP_CHECK_VERIFIED_AUDIENCE_SET)),
  );
  assert.equal(
    preBackupAccessProbe.verifiedIssuerHash,
    sha256(APP_CHECK_VERIFIED_ISSUER),
  );
  assert.equal(
    preBackupAccessProbe.exchangeEndpointHash,
    sha256(APP_CHECK_EXCHANGE_ENDPOINT),
  );
  assert.equal(
    preBackupAccessProbe.exchangeTransportContractHash,
    sha256(canonicalJson(APP_CHECK_EXCHANGE_TRANSPORT_CONTRACT)),
  );
  assert.equal(preBackupAccessProbe.positiveControlPassed, true);
  assert.equal(preBackupAccessProbe.positiveControlHttpStatus, 200);
  assert.equal(preBackupAccessProbe.positiveControlSentinelMatched, true);
  assert.equal(preBackupAccessProbe.readDenied, true);
  assert.equal(preBackupAccessProbe.writeDenied, true);
  assert.equal(preBackupAccessProbe.rawBackupWriteCount, 0);
  assert.equal(preBackupAccessProbe.canaryResidualCount, 0);
  assert.equal(preBackupAccessProbe.ephemeralAuthResidualCount, 0);
  assert.equal(preBackupAccessProbe.ephemeralProfileResidualCount, 0);
  assert.equal(preBackupAccessProbe.temporarySessionResidualCount, 0);
  assert.equal(preBackupAccessProbe.positiveControlResidualCount, 0);
  assert.equal(
    sha256(canonicalJson(preBackupAccessProbeProjection)),
    preBackupAccessProbeAttestationHash,
    "The pre-backup access probe attestation hash is invalid.",
  );
  assert.equal(
    marker.data()?.preBackupAccessProbeAttestationHash,
    preBackupAccessProbeAttestationHash,
  );
  assert.equal(
    backupRoot.data()?.preBackupAccessProbeAttestationHash,
    preBackupAccessProbeAttestationHash,
  );
  assert.equal(
    sha256(canonicalJson(backupRoot.data()?.preBackupAccessProbe)),
    sha256(canonicalJson(preBackupAccessProbe)),
    "The pre-backup access probe marker pair drifted.",
  );
  const backupState = await loadBackups(marker.data() || {});
  const backupNamespace = assertBackupNamespaceDefaultDenied();

  const allPaths = [...createDocs.keys(), ...overwriteDocs.keys()];
  const [snapshots, integritySnapshots] = await Promise.all([
    getSnapshots(allPaths),
    getBackupSnapshots(allPaths),
  ]);
  assert.equal(
    snapshots.every((snapshot) => snapshot.exists),
    true,
  );
  assert.equal(
    integritySnapshots.every((snapshot) => snapshot.exists),
    true,
  );
  assert.deepEqual(
    integritySnapshots.map((snapshot) => snapshot.ref.path),
    snapshots.map((snapshot) => snapshot.ref.path),
    "The exact and presentation audit snapshots cover different paths.",
  );
  for (const snapshot of integritySnapshots) {
    const data = snapshot.data();
    assertLosslessBackupValue(data);
    const expected = expectedFixtureDataForPath(snapshot.ref.path);
    assert.ok(expected, "A fixture document has no expected seed shape.");
    assert.equal(
      fixtureValueHash(stableFixtureDocument(snapshot.ref.path, data)),
      fixtureValueHash(stableFixtureDocument(snapshot.ref.path, expected)),
      "A fixture document differs from its exact deterministic seed shape.",
    );
  }
  for (const snapshot of snapshots) {
    if (!markerlessOverwritePaths.has(snapshot.ref.path)) {
      assert.equal(
        snapshot.data()?.fixtureOwner,
        FIXTURE_OWNER,
        "A fixture document lost its ownership marker.",
      );
      assert.equal(snapshot.data()?.fixtureId, FIXTURE_ID);
    }
    const expected =
      createDocs.get(snapshot.ref.path) || overwriteDocs.get(snapshot.ref.path);
    assert.ok(expected, "A fixture document has no expected seed shape.");
    assert.equal(
      sha256(
        canonicalJson(
          stableFixtureDocument(snapshot.ref.path, snapshot.data()),
        ),
      ),
      sha256(canonicalJson(stableFixtureDocument(snapshot.ref.path, expected))),
      "A fixture document differs from its deterministic seed shape.",
    );
  }
  const snapshotsByPath = new Map(
    snapshots.map((snapshot) => [snapshot.ref.path, snapshot]),
  );
  assertRoleProfiles(snapshotsByPath);
  const presentation = assertPresentationAttestation(snapshotsByPath);

  const authRows = [];
  for (const [role, uid, email] of [
    ["student", STUDENT_UID, STUDENT_EMAIL],
    ["teacher", TEACHER_UID, TEACHER_EMAIL],
    ["admin", ADMIN_UID, ADMIN_EMAIL],
  ]) {
    const user = await auth.getUser(uid);
    assert.equal(String(user.email || "").toLowerCase(), email);
    assert.equal(user.customClaims?.fixtureOwner, FIXTURE_OWNER);
    assert.equal(user.customClaims?.fixtureId, FIXTURE_ID);
    assert.equal(user.customClaims?.fixtureRole, role);
    authRows.push({
      role,
      uidHash: sha256(uid),
      emailHash: sha256(email),
    });
  }
  assert.deepEqual(authRows, authContractRows);
  const authFixtureIdentityScope = await exactAuthFixtureIdentityScopeAudit({
    expectedSeeded: true,
  });
  assert.equal(
    authFixtureIdentityScope.scopedUidSetHash,
    authAllowedUidSetHash,
  );
  const liveBackupAccessProbe = requireLiveBackupAccessProbe
    ? await verifyLiveBackupNamespaceDenied(backupState.backups)
    : notExecutedBackupAccessProbe();
  if (requireLiveBackupAccessProbe) {
    assert.equal(liveBackupAccessProbe.status, "VERIFIED_DENIED");
    assert.equal(liveBackupAccessProbe.appCheckBound, true);
    assert.equal(liveBackupAccessProbe.appCheckProjectBindingVerified, true);
    assert.equal(liveBackupAccessProbe.appCheckAppBindingVerified, true);
    assert.equal(liveBackupAccessProbe.appCheckTokenValidAtVerification, true);
    assert.equal(
      liveBackupAccessProbe.appCheckTokenLifetimeWithinMaximum,
      true,
    );
    assert.equal(liveBackupAccessProbe.appCheckExchangeRequestCount, 1);
    assert.equal(liveBackupAccessProbe.appCheckAdminVerificationCount, 1);
    assert.equal(liveBackupAccessProbe.appCheckHeaderRequestCount, 4);
    assert.equal(liveBackupAccessProbe.requestCount, 6);
    assert.equal(liveBackupAccessProbe.rawAppCheckDebugTokenOutputCount, 0);
    assert.equal(liveBackupAccessProbe.rawAppCheckJwtOutputCount, 0);
    assert.equal(
      liveBackupAccessProbe.appCheckDebugTokenHash,
      preBackupAccessProbe.appCheckDebugTokenHash,
    );
    assert.equal(
      liveBackupAccessProbe.verifiedAppIdHash,
      sha256(STAGING_APP_ID),
    );
    for (const field of [
      "verifiedProjectIdHash",
      "verifiedProjectNumberHash",
      "verifiedAudienceSetHash",
      "verifiedIssuerHash",
      "exchangeEndpointHash",
      "exchangeTransportContractHash",
    ]) {
      assert.equal(
        liveBackupAccessProbe[field],
        preBackupAccessProbe[field],
        `The pre/post App Check ${field} binding drifted.`,
      );
    }
  }
  const [postProbeRunMarker, postProbeBackupRoot] = await db.getAll(
    db.doc(RUN_PATH),
    db.doc(BACKUP_ROOT_PATH),
  );
  const postProbeMarkerData = assertIsolationMarkerPair(
    postProbeRunMarker,
    postProbeBackupRoot,
    { allowedStatuses: new Set(["READY"]) },
  );
  const postBackupProbeLifecycle = {
    state: postProbeMarkerData.postBackupProbeState,
    revisionHash: postProbeMarkerData.postBackupProbeRevisionHash,
    existingCanaryPathHash:
      postProbeMarkerData.postBackupExistingCanaryPathHash,
    absentCanaryPathHash: postProbeMarkerData.postBackupAbsentCanaryPathHash,
    attestationHash: postProbeMarkerData.postBackupProbeAttestationHash,
    artifactResidualCount:
      postProbeMarkerData.postBackupProbeArtifactResidualCount,
  };
  if (requireLiveBackupAccessProbe) {
    assert.deepEqual(postBackupProbeLifecycle, {
      state: "VERIFIED_CLEAN",
      revisionHash: POST_BACKUP_PROBE_REVISION_HASH,
      existingCanaryPathHash: sha256(EXISTING_WRITE_CANARY.path),
      absentCanaryPathHash: sha256(ABSENT_WRITE_CANARY.path),
      attestationHash: liveBackupAccessProbe.attestationHash,
      artifactResidualCount: 0,
    });
  }
  const postBackupProbeLifecycleHash = sha256(
    canonicalJson(postBackupProbeLifecycle),
  );

  const strict = await strictCollectionAudit({ expectedSeeded: true });
  assert.equal(strict.allowlistManifestHash, strictAllowlistManifestHash);
  const plannedMutationTopology = await assertPlannedMutationChildTopology();
  assert.equal(
    plannedMutationTopology.allowlistHash,
    postProbeMarkerData.plannedMutationTopologyAllowlistHash,
  );
  const privacy = assertPrivacySafe(
    snapshots.map((snapshot) => [snapshot.ref.path, snapshot.data()]),
  );
  const documentProjectionHash = sha256(
    canonicalJson(
      integritySnapshots
        .map((snapshot) => ({
          pathHash: sha256(snapshot.ref.path),
          documentHash: fixtureValueHash(
            stableFixtureDocument(snapshot.ref.path, snapshot.data()),
          ),
        }))
        .sort((left, right) => left.pathHash.localeCompare(right.pathHash)),
    ),
  );
  const authManifestHash = sha256(canonicalJson(authRows));
  const privacyAttestationHash = sha256(canonicalJson(privacy));
  const issuedAt = new Date();
  const freshness = {
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(
      issuedAt.getTime() + AUDIT_MAX_AGE_SECONDS * 1_000,
    ).toISOString(),
    maxAgeSeconds: AUDIT_MAX_AGE_SECONDS,
    fixedFixtureTime: FIXED_TIME,
  };
  const captureBinding = {
    fixtureNamespace: FIXTURE_ID,
    fixtureRevision: FIXTURE_REVISION,
    projectId: STAGING_PROJECT_ID,
    planHash,
    authAllowedUidSetHash,
    authManifestHash,
    authFixtureIdentityScopeManifestHash: authFixtureIdentityScope.manifestHash,
    fixtureDocumentCount: snapshots.length,
    documentProjectionHash,
    plannedMutationTopologyAllowlistHash: plannedMutationTopology.allowlistHash,
    plannedMutationTopologyObservedHash: plannedMutationTopology.observedHash,
    plannedMutationTopologyBaselineHash:
      postProbeMarkerData.plannedMutationTopologyBaselineHash,
    strictCollectionCount: strict.collectionCount,
    strictExpectedRowCount: strict.expectedRowCount,
    strictActualRowCount: strict.actualRowCount,
    strictAllowlistManifestHash: strict.allowlistManifestHash,
    strictManifestHash: strict.manifestHash,
    presentationAttestationHash: presentation.attestationHash,
    privacyAttestationHash,
    appCheckDebugTokenHash: preBackupAccessProbe.appCheckDebugTokenHash,
    verifiedAppIdHash: preBackupAccessProbe.verifiedAppIdHash,
    verifiedProjectIdHash: preBackupAccessProbe.verifiedProjectIdHash,
    verifiedProjectNumberHash: preBackupAccessProbe.verifiedProjectNumberHash,
    verifiedAudienceSetHash: preBackupAccessProbe.verifiedAudienceSetHash,
    verifiedIssuerHash: preBackupAccessProbe.verifiedIssuerHash,
    exchangeEndpointHash: preBackupAccessProbe.exchangeEndpointHash,
    exchangeTransportContractHash:
      preBackupAccessProbe.exchangeTransportContractHash,
    preBackupNamespaceAccessAttestationHash:
      preBackupAccessProbeAttestationHash,
    backupNamespaceAccessAttestationHash: liveBackupAccessProbe.attestationHash,
    postBackupProbeLifecycleHash,
    freshness,
    extraRowCount: 0,
  };

  return safeResult("w10p-visual-fixture-audit", {
    authRoleCount: authRows.length,
    authAllowedUidSetHash,
    authManifestHash,
    authRoles: authRows,
    authFixtureIdentityScope,
    isolation: {
      state: "READY",
      strictBackupCount: marker.data()?.strictBackupCount,
      singletonBackupCount: marker.data()?.singletonBackupCount,
      backupCount: backupState.backups.length,
      backupManifestHash: backupState.manifest.hash,
      backupCanonicalByteCount: backupState.backupCanonicalByteCount,
      maximumAtomicRestoreBackupCanonicalBytes:
        MAX_ATOMIC_RESTORE_BACKUP_CANONICAL_BYTES,
      maximumBackupDocumentCanonicalBytes: MAX_BACKUP_DOCUMENT_CANONICAL_BYTES,
      isolationProtocolVersion: ISOLATION_PROTOCOL_VERSION,
      rawBackupValueOutputCount: 0,
      backupNamespace,
      preBackupAccessProbe,
      liveBackupAccessProbe,
      postBackupProbeLifecycle,
      postBackupProbeLifecycleHash,
      plannedMutationTopology: {
        ...plannedMutationTopology,
        baselineHash: postProbeMarkerData.plannedMutationTopologyBaselineHash,
      },
    },
    fixtureDocumentCount: snapshots.length,
    documentProjectionHash,
    strict,
    presentation,
    privacy,
    privacyAttestationHash,
    freshness,
    captureBinding,
    captureBindingHash: sha256(canonicalJson(captureBinding)),
    extraRowCount: 0,
  });
};

const auxiliaryPreflightResult = () => {
  const projection = {
    schemaVersion: 1,
    fixedIdentityCount: fixtureActors.length,
    fixedUidSetHash: authAllowedUidSetHash,
    preBackupProbeIdentityCount: 1,
    preBackupProbeUidHash: sha256(PREFLIGHT_UID),
    commandCollectionCount: 2,
    preBackupProbeNamespaceCount: 6,
    namespaceCount: fixtureActors.length * 6 + 6,
    documentCount: 0,
    commandLimitPerIdentity: AUXILIARY_COMMAND_LIMIT_PER_IDENTITY,
    sessionLimitPerIdentity: AUXILIARY_SESSION_LIMIT_PER_IDENTITY,
    maximumCleanupDeleteCount: AUXILIARY_DELETE_LIMIT,
    allNamespacesEmpty: true,
  };
  return {
    ...projection,
    manifestHash: sha256(canonicalJson(projection)),
  };
};

const assertPreBackupProbeNamespaceEmpty = async () => {
  const profile = db.doc(`users/${PREFLIGHT_UID}`);
  const positiveControl = db.doc(PRE_BACKUP_POSITIVE_CONTROL_PATH);
  const existingCanary = db.doc(PRE_BACKUP_EXISTING_WRITE_CANARY.path);
  const absentCanary = db.doc(PRE_BACKUP_ABSENT_WRITE_CANARY.path);
  const sessionRoot = db.doc(`application_sessions/${PREFLIGHT_UID}`);
  const [
    profileSnapshot,
    positiveControlSnapshot,
    existingCanarySnapshot,
    absentCanarySnapshot,
    sessionRootSnapshot,
  ] = await db.getAll(
    profile,
    positiveControl,
    existingCanary,
    absentCanary,
    sessionRoot,
  );
  assert.equal(
    [
      profileSnapshot,
      positiveControlSnapshot,
      existingCanarySnapshot,
      absentCanarySnapshot,
      sessionRootSnapshot,
    ].some((snapshot) => snapshot.exists),
    false,
    "A pre-backup probe document already exists.",
  );
  const sessions = await sessionRoot
    .collection("sessions")
    .limit(AUXILIARY_SESSION_LIMIT_PER_IDENTITY + 1)
    .get();
  assert.ok(
    sessions.size <= AUXILIARY_SESSION_LIMIT_PER_IDENTITY,
    "The pre-backup probe session namespace exceeds its bound.",
  );
  assert.equal(
    sessions.empty,
    true,
    "A pre-backup probe application session already exists.",
  );
  assert.deepEqual(
    await childCollectionIds(sessionRoot),
    [],
    "The pre-backup probe session root has an unknown subcollection.",
  );
  const academicRecords = profile.collection("academic_records");
  const [profileChildren, academicRecordRefs, academicRecordDocuments] =
    await Promise.all([
      childCollectionIds(profile),
      academicRecords.listDocuments(),
      academicRecords.limit(2).get(),
    ]);
  assert.deepEqual(
    profileChildren,
    [],
    "The pre-backup probe profile has an unknown subcollection.",
  );
  assert.deepEqual(
    academicRecordRefs,
    [],
    "The pre-backup probe profile has an orphan academic-record descendant.",
  );
  assert.equal(
    academicRecordDocuments.empty,
    true,
    "The pre-backup probe profile has an academic-record document.",
  );
  assert.deepEqual(
    await childCollectionIds(positiveControl),
    [],
    "The pre-backup probe positive control has an unknown descendant.",
  );
  return auxiliaryPreflightResult();
};

const assertFixtureAuxiliaryNamespacesEmpty = async () => {
  const commandCollections = ["command_receipts", "command_audit_events"];
  for (const { uid } of fixtureActors) {
    for (const collectionName of commandCollections) {
      const snapshot = await db
        .collection(collectionName)
        .where("actorUid", "==", uid)
        .limit(AUXILIARY_COMMAND_LIMIT_PER_IDENTITY + 1)
        .get();
      assert.ok(
        snapshot.size <= AUXILIARY_COMMAND_LIMIT_PER_IDENTITY,
        "A fixture auxiliary command namespace exceeds its bound.",
      );
      assert.equal(
        snapshot.empty,
        true,
        "A fixed fixture UID already has command evidence.",
      );
    }
    const sessionRoot = db.doc(`application_sessions/${uid}`);
    const transition = db.doc(`application_session_transitions/${uid}`);
    const notifications = db.doc(`user_notifications/${uid}`);
    const [sessionRootSnapshot, transitionSnapshot, notificationSnapshot] =
      await db.getAll(sessionRoot, transition, notifications);
    assert.equal(
      sessionRootSnapshot.exists ||
        transitionSnapshot.exists ||
        notificationSnapshot.exists,
      false,
      "A fixed fixture UID already has auxiliary root data.",
    );
    const sessions = await sessionRoot
      .collection("sessions")
      .limit(AUXILIARY_SESSION_LIMIT_PER_IDENTITY + 1)
      .get();
    assert.ok(
      sessions.size <= AUXILIARY_SESSION_LIMIT_PER_IDENTITY,
      "A fixture application-session namespace exceeds its bound.",
    );
    assert.equal(
      sessions.empty,
      true,
      "A fixed fixture UID already has an application session.",
    );
    for (const reference of [sessionRoot, transition, notifications]) {
      assert.deepEqual(
        await childCollectionIds(reference),
        [],
        "A fixed fixture UID already has an auxiliary subcollection.",
      );
    }
  }
  await assertPreBackupProbeNamespaceEmpty();
  return auxiliaryPreflightResult();
};

const assertFixtureAuxiliaryDocumentsEmptyInTransaction = async (
  transaction,
) => {
  for (const { uid } of fixtureActors) {
    for (const collectionName of ["command_receipts", "command_audit_events"]) {
      const snapshot = await transaction.get(
        db
          .collection(collectionName)
          .where("actorUid", "==", uid)
          .limit(AUXILIARY_COMMAND_LIMIT_PER_IDENTITY + 1),
      );
      assert.ok(snapshot.size <= AUXILIARY_COMMAND_LIMIT_PER_IDENTITY);
      assert.equal(snapshot.empty, true);
    }
    const sessionRoot = db.doc(`application_sessions/${uid}`);
    const transition = db.doc(`application_session_transitions/${uid}`);
    const notifications = db.doc(`user_notifications/${uid}`);
    const [sessionRootSnapshot, transitionSnapshot, notificationSnapshot] =
      await transaction.getAll(sessionRoot, transition, notifications);
    assert.equal(
      sessionRootSnapshot.exists ||
        transitionSnapshot.exists ||
        notificationSnapshot.exists,
      false,
    );
    const sessions = await transaction.get(
      sessionRoot
        .collection("sessions")
        .limit(AUXILIARY_SESSION_LIMIT_PER_IDENTITY + 1),
    );
    assert.ok(sessions.size <= AUXILIARY_SESSION_LIMIT_PER_IDENTITY);
    assert.equal(sessions.empty, true);
  }
  const preflightProfile = db.doc(`users/${PREFLIGHT_UID}`);
  const preflightPositiveControl = db.doc(PRE_BACKUP_POSITIVE_CONTROL_PATH);
  const preflightExistingCanary = db.doc(PRE_BACKUP_EXISTING_WRITE_CANARY.path);
  const preflightAbsentCanary = db.doc(PRE_BACKUP_ABSENT_WRITE_CANARY.path);
  const preflightSessionRoot = db.doc(`application_sessions/${PREFLIGHT_UID}`);
  const preflightSnapshots = await transaction.getAll(
    preflightProfile,
    preflightPositiveControl,
    preflightExistingCanary,
    preflightAbsentCanary,
    preflightSessionRoot,
  );
  assert.equal(
    preflightSnapshots.some((snapshot) => snapshot.exists),
    false,
  );
  const preflightSessions = await transaction.get(
    preflightSessionRoot
      .collection("sessions")
      .limit(AUXILIARY_SESSION_LIMIT_PER_IDENTITY + 1),
  );
  assert.ok(preflightSessions.size <= AUXILIARY_SESSION_LIMIT_PER_IDENTITY);
  assert.equal(preflightSessions.empty, true);
  return auxiliaryPreflightResult();
};

const setup = async () => {
  const credentials = credentialsFromEnvironment();
  assertBackupNamespaceDefaultDenied();
  assertPrivacySafe([...createDocs.entries(), ...overwriteDocs.entries()]);
  assert.equal(
    (await db.doc(RUN_PATH).get()).exists,
    false,
    "Fixture already exists.",
  );
  await assertBackupNamespaceEmpty();
  await exactAuthFixtureIdentityScopeAudit({ expectedSeeded: false });
  const createdSnapshots = await getSnapshots([...createDocs.keys()]);
  assert.equal(
    createdSnapshots.some((snapshot) => snapshot.exists),
    false,
    "A create-only fixture document already exists.",
  );
  for (const [uid, email] of [
    [STUDENT_UID, STUDENT_EMAIL],
    [TEACHER_UID, TEACHER_EMAIL],
    [ADMIN_UID, ADMIN_EMAIL],
  ]) {
    await assertAuthAbsent(uid, email);
  }
  await assertAuthAbsent(PREFLIGHT_UID, PREFLIGHT_EMAIL);
  const auxiliaryPreflight = await assertFixtureAuxiliaryNamespacesEmpty();
  const plannedMutationTopology = await assertPlannedMutationChildTopology();

  const createdAuthUids = [];
  let markerCreated = false;
  try {
    await createAccessProbeMarker(auxiliaryPreflight, plannedMutationTopology);
    markerCreated = true;
    const preBackupAccessProbe = await verifyPreBackupNamespaceDenied();
    assert.equal(preBackupAccessProbe.status, "VERIFIED_DENIED");
    assert.equal(preBackupAccessProbe.positiveControlPassed, true);
    assert.equal(preBackupAccessProbe.readDenied, true);
    assert.equal(preBackupAccessProbe.writeDenied, true);
    assert.equal(preBackupAccessProbe.rawBackupWriteCount, 0);
    assert.equal(
      (await db.collection(BACKUP_DOCUMENTS_PATH).limit(1).get()).empty,
      true,
      "The pre-backup access probe left a canary document behind.",
    );
    const inventory = await readIsolationInventory();
    await promoteIsolationMarker(
      inventory,
      preBackupAccessProbe,
      auxiliaryPreflight,
      plannedMutationTopology,
    );
    const storedBackupState = await createAndVerifyBackups(inventory);
    await setIsolationState("AUTH_CREATING");
    for (const [role, uid, email, displayName] of [
      ["student", STUDENT_UID, STUDENT_EMAIL, "W10P 학생"],
      ["teacher", TEACHER_UID, TEACHER_EMAIL, "W10P 교사"],
      ["admin", ADMIN_UID, ADMIN_EMAIL, "W10P 관리자"],
    ]) {
      await auth.createUser({
        uid,
        email,
        displayName,
        password: String(credentials[role].password),
        emailVerified: true,
      });
      createdAuthUids.push(uid);
      await auth.setCustomUserClaims(uid, {
        fixtureOwner: FIXTURE_OWNER,
        fixtureId: FIXTURE_ID,
        fixtureRole: role,
      });
    }
    await setIsolationState("AUTH_READY", {
      createdAuthUserCount: createdAuthUids.length,
    });
    await setIsolationState("ISOLATING", {
      isolationTransactionPreparedAt: new Date(),
    });
    const cutover = await commitIsolationCutover(
      storedBackupState.backups,
      inventory.manifest.hash,
    );
    const audited = await audit();
    return safeResult("w10p-visual-fixture-setup", {
      createdAuthUserCount: createdAuthUids.length,
      createdDocumentCount: createDocs.size,
      overwrittenDocumentCount: overwriteDocs.size,
      isolatedDocumentCount: inventory.strictBackupCount,
      cutoverTransactionWriteCount: cutover.cutoverTransactionWriteCount,
      backupCount: inventory.backups.length,
      backupManifestHash: inventory.manifest.hash,
      auxiliaryPreflight,
      plannedMutationTopology: audited.isolation.plannedMutationTopology,
      isolation: audited.isolation,
      authFixtureIdentityScope: audited.authFixtureIdentityScope,
      strict: audited.strict,
      presentation: audited.presentation,
      privacy: audited.privacy,
      privacyAttestationHash: audited.privacyAttestationHash,
      freshness: audited.freshness,
      captureBinding: audited.captureBinding,
      captureBindingHash: audited.captureBindingHash,
      extraRowCount: 0,
    });
  } catch (error) {
    if (markerCreated) {
      try {
        await cleanup({ skipPreAudit: true });
      } catch (_cleanupError) {
        // The sanitized outer error reports failure without exposing credentials
        // or snapshot contents. The retained run marker permits an explicit retry.
      }
    } else {
      for (const uid of createdAuthUids) {
        try {
          await auth.deleteUser(uid);
        } catch (rollbackError) {
          if (rollbackError?.code !== "auth/user-not-found")
            throw rollbackError;
        }
      }
    }
    throw error;
  }
};

const assertCleanupMarkerData = (markerData) => {
  assert.equal(markerData.fixtureOwner, FIXTURE_OWNER);
  assert.equal(markerData.fixtureId, FIXTURE_ID);
  assert.equal(Number(markerData.fixtureRevision), FIXTURE_REVISION);
  assert.equal(markerData.projectId, STAGING_PROJECT_ID);
  assert.equal(markerData.planHash, planHash);
  assert.equal(SETUP_STATES.has(markerData.status), true);
  assert.match(markerData.auxiliaryPreflightHash, /^[a-f0-9]{64}$/u);
  assert.equal(Number(markerData.auxiliaryPreflightDocumentCount), 0);
  assert.equal(
    Number(markerData.auxiliaryPreflightNamespaceCount),
    fixtureActors.length * 6 + 6,
  );
  assert.equal(
    markerData.plannedMutationTopologyAllowlistHash,
    plannedMutationTopologyAllowlistHash,
  );
  assert.match(
    markerData.plannedMutationTopologyBaselineHash,
    /^[a-f0-9]{64}$/u,
  );
  if (markerData.status === "ACCESS_PROBING") {
    assert.equal(
      markerData.preBackupProbeRevisionHash,
      PRE_BACKUP_PROBE_REVISION_HASH,
    );
    assert.equal(markerData.preBackupIdentityUidHash, sha256(PREFLIGHT_UID));
    assert.equal(
      markerData.preBackupProfilePathHash,
      sha256(`users/${PREFLIGHT_UID}`),
    );
    assert.equal(
      markerData.preBackupSessionRootPathHash,
      sha256(`application_sessions/${PREFLIGHT_UID}/sessions`),
    );
    assert.equal(
      markerData.preBackupPositiveControlPathHash,
      sha256(PRE_BACKUP_POSITIVE_CONTROL_PATH),
    );
    assert.equal(
      markerData.preBackupExistingCanaryPathHash,
      sha256(PRE_BACKUP_EXISTING_WRITE_CANARY.path),
    );
    assert.equal(
      markerData.preBackupAbsentCanaryPathHash,
      sha256(PRE_BACKUP_ABSENT_WRITE_CANARY.path),
    );
    assert.equal(markerData.rawBackupWriteCount, 0);
    assert.equal(markerData.backupCount, 0);
    assert.equal(markerData.backupManifestHash, backupManifestFor([]).hash);
  }
};

const beginCleanupState = async () =>
  db.runTransaction(async (transaction) => {
    const [runMarker, backupRoot] = await transaction.getAll(
      db.doc(RUN_PATH),
      db.doc(BACKUP_ROOT_PATH),
    );
    const markerData = assertIsolationMarkerPair(runMarker, backupRoot, {
      allowedStatuses: SETUP_STATES,
    });
    if (["CLEANING", "RESTORING", "RESTORED"].includes(markerData.status)) {
      return markerData;
    }
    const cleanup = {
      status: "CLEANING",
      cleanupOriginState: markerData.status,
      cleanupStartedAt: new Date(),
    };
    transaction.update(db.doc(RUN_PATH), cleanup);
    transaction.update(db.doc(BACKUP_ROOT_PATH), cleanup);
    return { ...markerData, ...cleanup };
  });

const assertAuxiliaryCreatedWithinRun = (value, operationStartedAtMs) => {
  const valueMs = auxiliaryTimestampMillis(value);
  assert.equal(Number.isFinite(valueMs), true);
  assert.ok(
    valueMs >= operationStartedAtMs - 5_000,
    "An auxiliary document predates the fixture run.",
  );
};

const assertAuxiliarySnapshotTimeBoundary = (
  snapshot,
  operationStartedAtMs,
  cleanupStartedAt,
) => {
  assertAuxiliaryCreatedWithinRun(snapshot.createTime, operationStartedAtMs);
  assert.ok(
    compareExactTimestamps(snapshot.updateTime, cleanupStartedAt) <= 0,
    "An auxiliary document changed after cleanup started.",
  );
};

const deleteFixtureAuxiliary = async ({
  operationStartedAt,
  cleanupStartedAt,
}) => {
  const operationStartedAtMs = auxiliaryTimestampMillis(operationStartedAt);
  const cleanupStartedAtMs = auxiliaryTimestampMillis(cleanupStartedAt);
  assert.equal(Number.isFinite(operationStartedAtMs), true);
  assert.equal(Number.isFinite(cleanupStartedAtMs), true);
  assert.ok(compareExactTimestamps(cleanupStartedAt, operationStartedAt) >= 0);
  const commandSnapshots = new Map([
    ["command_receipts", []],
    ["command_audit_events", []],
  ]);
  const sessionSnapshots = [];
  const transitionSnapshots = [];

  for (const identity of fixtureActors) {
    for (const collectionName of commandSnapshots.keys()) {
      const snapshot = await db
        .collection(collectionName)
        .where("actorUid", "==", identity.uid)
        .limit(AUXILIARY_COMMAND_LIMIT_PER_IDENTITY + 1)
        .get();
      assert.ok(
        snapshot.size <= AUXILIARY_COMMAND_LIMIT_PER_IDENTITY,
        "A fixture command evidence namespace exceeds its cleanup bound.",
      );
      commandSnapshots.get(collectionName).push(...snapshot.docs);
    }

    const sessionRoot = db.doc(`application_sessions/${identity.uid}`);
    const transition = db.doc(
      `application_session_transitions/${identity.uid}`,
    );
    const notifications = db.doc(`user_notifications/${identity.uid}`);
    const [sessionRootSnapshot, transitionSnapshot, notificationSnapshot] =
      await db.getAll(sessionRoot, transition, notifications);
    assert.equal(
      sessionRootSnapshot.exists || notificationSnapshot.exists,
      false,
      "An unowned auxiliary root blocks cleanup.",
    );
    const sessions = await sessionRoot
      .collection("sessions")
      .limit(AUXILIARY_SESSION_LIMIT_PER_IDENTITY + 1)
      .get();
    assert.ok(
      sessions.size <= AUXILIARY_SESSION_LIMIT_PER_IDENTITY,
      "A fixture session namespace exceeds its cleanup bound.",
    );
    const sessionChildCollections = await childCollectionIds(sessionRoot);
    assert.deepEqual(
      sessionChildCollections,
      sessions.empty ? [] : ["sessions"],
      "An unknown application-session subcollection blocks cleanup.",
    );
    assert.deepEqual(
      await childCollectionIds(notifications),
      [],
      "An unknown notification subcollection blocks cleanup.",
    );
    assert.deepEqual(
      await childCollectionIds(transition),
      [],
      "An unknown session-transition subcollection blocks cleanup.",
    );
    sessionSnapshots.push(...sessions.docs);
    if (transitionSnapshot.exists) transitionSnapshots.push(transitionSnapshot);
  }

  const receipts = commandSnapshots.get("command_receipts");
  const audits = commandSnapshots.get("command_audit_events");
  const receiptById = new Map(
    receipts.map((snapshot) => [snapshot.id, snapshot]),
  );
  const auditById = new Map(audits.map((snapshot) => [snapshot.id, snapshot]));
  assert.equal(receiptById.size, receipts.length);
  assert.equal(auditById.size, audits.length);
  assert.deepEqual(
    [...receiptById.keys()].sort(),
    [...auditById.keys()].sort(),
  );

  const identityByUid = new Map(
    fixtureActors.map((identity) => [identity.uid, identity]),
  );
  const sessionByIdentityAndAuthTime = new Map();
  for (const snapshot of sessionSnapshots) {
    const data = snapshot.data() || {};
    const identity = identityByUid.get(String(data.uid || ""));
    const authTime = Number(data.authTime);
    assert.ok(identity, "An unknown session identity blocks cleanup.");
    assert.equal(data.email, identity.email);
    assert.equal(Number.isSafeInteger(authTime) && authTime > 0, true);
    assert.equal(snapshot.id, String(authTime));
    assert.equal(
      Number(data.schemaVersion),
      APPLICATION_SESSION_SCHEMA_VERSION,
    );
    assert.equal(
      data.authorityGeneration,
      APPLICATION_SESSION_AUTHORITY_GENERATION,
    );
    assert.equal(Number(data.protocolVersion) >= 2, true);
    assert.equal(["active", "closed"].includes(data.status), true);
    assert.match(String(data.sessionRevision || ""), /^[a-f0-9]{64}$/u);
    assert.equal(data.authorityModeAtOpen, "ENFORCE");
    assert.ok(authTime * 1_000 >= operationStartedAtMs - 5_000);
    assertAuxiliaryCreatedWithinRun(data.createdAt, operationStartedAtMs);
    assertAuxiliarySnapshotTimeBoundary(
      snapshot,
      operationStartedAtMs,
      cleanupStartedAt,
    );
    assert.deepEqual(
      await childCollectionIds(snapshot.ref),
      [],
      "An unknown session child collection blocks cleanup.",
    );
    sessionByIdentityAndAuthTime.set(`${identity.uid}:${authTime}`, snapshot);
  }

  for (const [receiptId, receiptSnapshot] of receiptById) {
    const receipt = receiptSnapshot.data() || {};
    const auditSnapshot = auditById.get(receiptId);
    const audit = auditSnapshot.data() || {};
    const identity = identityByUid.get(String(receipt.actorUid || ""));
    assert.ok(identity, "An unknown receipt identity blocks cleanup.");
    assert.equal(receipt.actorEmail, identity.email);
    assert.equal(receipt.actorRole, identity.role);
    assert.equal(Number(receipt.schemaVersion), 1);
    assert.equal(receipt.status, "SUCCEEDED");
    assert.equal(receipt.checkpoint, "COMMITTED");
    assert.equal(receipt.payloadHashAlgorithm, "sha256");
    assert.equal(typeof receipt.commandId, "string");
    assert.equal(typeof receipt.commandType, "string");
    assert.equal(
      receiptId,
      fixtureCommandReceiptId(
        identity.uid,
        receipt.commandType,
        receipt.commandId,
      ),
    );
    const authTime = Number(receipt.session?.authTime);
    assert.equal(Number.isSafeInteger(authTime) && authTime > 0, true);
    assert.equal(
      receipt.session?.ref,
      `application_sessions/${identity.uid}/sessions/${authTime}`,
    );
    const sessionSnapshot = sessionByIdentityAndAuthTime.get(
      `${identity.uid}:${authTime}`,
    );
    assert.ok(sessionSnapshot);
    assert.equal(
      receipt.session?.revisionHash,
      sha256(String(sessionSnapshot.data()?.sessionRevision || "")),
    );
    assert.equal(receipt.audit?.eventId, receiptId);
    assert.equal(receipt.audit?.ref, `command_audit_events/${receiptId}`);
    assertAuxiliaryCreatedWithinRun(receipt.createdAt, operationStartedAtMs);

    assert.equal(Number(audit.schemaVersion), 1);
    assert.equal(audit.eventId, receiptId);
    assert.equal(audit.eventType, "COMMAND_SUCCEEDED");
    assert.equal(audit.receiptRef, `command_receipts/${receiptId}`);
    assert.equal(audit.commandId, receipt.commandId);
    assert.equal(audit.commandType, receipt.commandType);
    assert.equal(audit.actorUid, identity.uid);
    assert.equal(audit.actorEmail, identity.email);
    assert.equal(audit.actorRole, identity.role);
    assert.equal(audit.actorCapability, receipt.actorCapability);
    assert.equal(audit.payloadHash, receipt.payloadHash);
    assert.equal(audit.sourceHash, receipt.sourceHash);
    assert.equal(canonicalJson(audit.target), canonicalJson(receipt.target));
    assert.equal(canonicalJson(audit.result), canonicalJson(receipt.result));
    assertAuxiliaryCreatedWithinRun(audit.createdAt, operationStartedAtMs);
    assertAuxiliaryCreatedWithinRun(receipt.completedAt, operationStartedAtMs);
    assertAuxiliarySnapshotTimeBoundary(
      receiptSnapshot,
      operationStartedAtMs,
      cleanupStartedAt,
    );
    assertAuxiliarySnapshotTimeBoundary(
      auditSnapshot,
      operationStartedAtMs,
      cleanupStartedAt,
    );
    for (const snapshot of [receiptSnapshot, auditSnapshot]) {
      assert.deepEqual(
        await childCollectionIds(snapshot.ref),
        [],
        "An unknown command evidence child collection blocks cleanup.",
      );
    }
  }

  for (const snapshot of transitionSnapshots) {
    const data = snapshot.data() || {};
    const identity = identityByUid.get(String(data.uid || ""));
    const fromAuthTime = Number(data.fromAuthTime);
    assert.ok(identity, "An unknown transition identity blocks cleanup.");
    assert.equal(snapshot.id, identity.uid);
    assert.equal(data.status, "pending");
    assert.equal(Number(data.schemaVersion), 1);
    assert.equal(
      data.authorityGeneration,
      APPLICATION_SESSION_AUTHORITY_GENERATION,
    );
    assert.equal(Number(data.protocolVersion) >= 2, true);
    assert.equal(Number.isSafeInteger(fromAuthTime) && fromAuthTime > 0, true);
    assert.equal(
      sessionByIdentityAndAuthTime.has(`${identity.uid}:${fromAuthTime}`),
      true,
    );
    assertAuxiliaryCreatedWithinRun(data.createdAt, operationStartedAtMs);
    assert.ok(compareExactTimestamps(data.expiresAt, data.createdAt) >= 0);
    assertAuxiliarySnapshotTimeBoundary(
      snapshot,
      operationStartedAtMs,
      cleanupStartedAt,
    );
  }

  const deletions = [
    ...receipts,
    ...audits,
    ...sessionSnapshots,
    ...transitionSnapshots,
  ];
  assert.ok(
    deletions.length <= AUXILIARY_DELETE_LIMIT,
    "Fixture auxiliary cleanup exceeds its atomic delete bound.",
  );
  if (deletions.length > 0) {
    const batch = db.batch();
    deletions.forEach((snapshot) =>
      batch.delete(snapshot.ref, { lastUpdateTime: snapshot.updateTime }),
    );
    await batch.commit();
  }
  return {
    commandDocumentCount: receipts.length + audits.length,
    auxiliaryDocumentCount:
      sessionSnapshots.length + transitionSnapshots.length,
    validatedDocumentCount: deletions.length,
    unownedDocumentDeleteCount: 0,
    recursiveDeleteCount: 0,
    userNotificationDeleteCount: 0,
  };
};

const cleanupPreBackupProbeArtifacts = async ({ operationStartedAt }) => {
  const operationStartedAtMs = operationStartedAt?.toDate
    ? operationStartedAt.toDate().getTime()
    : new Date(operationStartedAt || 0).getTime();
  const profileRef = db.doc(`users/${PREFLIGHT_UID}`);
  const positiveControlRef = db.doc(PRE_BACKUP_POSITIVE_CONTROL_PATH);
  const existingCanaryRef = db.doc(PRE_BACKUP_EXISTING_WRITE_CANARY.path);
  const absentCanaryRef = db.doc(PRE_BACKUP_ABSENT_WRITE_CANARY.path);
  const academicRecords = profileRef.collection("academic_records");
  const [
    positiveControlBeforeCleanup,
    profileChildIds,
    academicRecordRefs,
    academicRecordDocuments,
    positiveControlChildIds,
    existingCanaryChildIds,
    absentCanaryChildIds,
  ] = await Promise.all([
    positiveControlRef.get(),
    childCollectionIds(profileRef),
    academicRecords.listDocuments(),
    academicRecords.limit(2).get(),
    childCollectionIds(positiveControlRef),
    childCollectionIds(existingCanaryRef),
    childCollectionIds(absentCanaryRef),
  ]);
  const expectedAcademicRecordIds = positiveControlBeforeCleanup.exists
    ? [positiveControlRef.id]
    : [];
  assert.deepEqual(
    profileChildIds,
    expectedAcademicRecordIds.length > 0 ? ["academic_records"] : [],
    "An unknown pre-backup probe profile subcollection blocks cleanup.",
  );
  assert.deepEqual(
    academicRecordRefs.map((reference) => reference.id).sort(),
    expectedAcademicRecordIds,
    "An unknown pre-backup probe academic-record descendant blocks cleanup.",
  );
  assert.deepEqual(
    academicRecordDocuments.docs.map((document) => document.id).sort(),
    expectedAcademicRecordIds,
    "An unknown pre-backup probe academic-record document blocks cleanup.",
  );
  for (const childIds of [
    positiveControlChildIds,
    existingCanaryChildIds,
    absentCanaryChildIds,
  ]) {
    assert.deepEqual(
      childIds,
      [],
      "An unknown pre-backup probe descendant blocks cleanup.",
    );
  }
  let deletedDocumentCount = 0;
  deletedDocumentCount += await db.runTransaction(async (transaction) => {
    let transactionDeleteCount = 0;
    const [profile, positiveControl, existingCanary, absentCanary] =
      await transaction.getAll(
        profileRef,
        positiveControlRef,
        existingCanaryRef,
        absentCanaryRef,
      );
    for (const [snapshot, purpose, probeRevision] of [
      [profile, "pre-backup-access-deny-probe", PRE_BACKUP_PROBE_REVISION_HASH],
      [
        positiveControl,
        "pre-backup-positive-control",
        PRE_BACKUP_PROBE_REVISION_HASH,
      ],
      [
        existingCanary,
        PRE_BACKUP_EXISTING_WRITE_CANARY.data.canaryPurpose,
        PRE_BACKUP_EXISTING_WRITE_CANARY.revisionHash,
      ],
      [
        absentCanary,
        PRE_BACKUP_ABSENT_WRITE_CANARY.data.canaryPurpose,
        PRE_BACKUP_ABSENT_WRITE_CANARY.revisionHash,
      ],
    ]) {
      if (!snapshot.exists) continue;
      const data = snapshot.data() || {};
      assert.equal(data.fixtureOwner, FIXTURE_OWNER);
      assert.equal(data.fixtureId, FIXTURE_ID);
      assert.equal(data.fixtureRevision, FIXTURE_REVISION);
      assertAuxiliaryCreatedWithinRun(
        snapshot.createTime,
        operationStartedAtMs,
      );
      if (snapshot.ref.path.startsWith(BACKUP_DOCUMENTS_PATH)) {
        assert.equal(data.canaryPurpose, purpose);
        assert.equal(data.canaryRevision, probeRevision);
      } else {
        assert.equal(data.fixturePurpose, purpose);
        assert.equal(data.probeRevision, probeRevision);
      }
      transaction.delete(snapshot.ref);
      transactionDeleteCount += 1;
    }
    return transactionDeleteCount;
  });

  const preflightSessionRoot = db.doc(`application_sessions/${PREFLIGHT_UID}`);
  const [preflightSessionRootSnapshot, sessions] = await Promise.all([
    preflightSessionRoot.get(),
    preflightSessionRoot
      .collection("sessions")
      .limit(AUXILIARY_SESSION_LIMIT_PER_IDENTITY + 1)
      .get(),
  ]);
  assert.equal(
    preflightSessionRootSnapshot.exists,
    false,
    "The pre-backup probe session root is not owned by this run.",
  );
  assert.ok(
    sessions.size <= AUXILIARY_SESSION_LIMIT_PER_IDENTITY,
    "Pre-backup probe session cleanup is unbounded.",
  );
  assert.deepEqual(
    await childCollectionIds(preflightSessionRoot),
    sessions.empty ? [] : ["sessions"],
    "An unknown pre-backup probe session subcollection blocks cleanup.",
  );
  if (!sessions.empty) {
    const batch = db.batch();
    for (const session of sessions.docs) {
      const data = session.data() || {};
      const authTime = Number(data.authTime);
      assert.equal(data.fixtureOwner, FIXTURE_OWNER);
      assert.equal(data.fixtureId, FIXTURE_ID);
      assert.equal(data.fixtureRevision, FIXTURE_REVISION);
      assert.equal(data.fixturePurpose, "pre-backup-access-deny-probe");
      assert.equal(data.probeRevision, PRE_BACKUP_PROBE_REVISION_HASH);
      assert.equal(data.uid, PREFLIGHT_UID);
      assert.equal(data.email, PREFLIGHT_EMAIL);
      assert.equal(Number.isSafeInteger(authTime) && authTime > 0, true);
      assert.equal(session.id, String(authTime));
      assert.equal(
        Number(data.schemaVersion),
        APPLICATION_SESSION_SCHEMA_VERSION,
      );
      assert.equal(
        data.authorityGeneration,
        APPLICATION_SESSION_AUTHORITY_GENERATION,
      );
      assert.equal(Number(data.protocolVersion) >= 2, true);
      assert.equal(data.authorityModeAtOpen, "ENFORCE");
      assert.equal(
        data.sessionRevision,
        sha256(`${PRE_BACKUP_PROBE_REVISION_HASH}\n${authTime}`),
      );
      assertAuxiliaryCreatedWithinRun(session.createTime, operationStartedAtMs);
      assertAuxiliaryCreatedWithinRun(data.createdAt, operationStartedAtMs);
      assert.deepEqual(
        await childCollectionIds(session.ref),
        [],
        "An unknown pre-backup probe session descendant blocks cleanup.",
      );
      batch.delete(session.ref, { lastUpdateTime: session.updateTime });
      deletedDocumentCount += 1;
    }
    await batch.commit();
  }

  let deletedAuthUserCount = 0;
  try {
    const user = await auth.getUser(PREFLIGHT_UID);
    const claims = user.customClaims || {};
    const claimsMatch =
      claims.fixtureOwner === FIXTURE_OWNER &&
      claims.fixtureId === FIXTURE_ID &&
      claims.fixtureRevision === FIXTURE_REVISION &&
      claims.fixturePurpose === "pre-backup-access-deny-probe" &&
      claims.probeRevision === PRE_BACKUP_PROBE_REVISION_HASH;
    const incompleteSameRunIdentity =
      String(user.email || "").toLowerCase() === PREFLIGHT_EMAIL &&
      user.displayName === PRE_BACKUP_AUTH_DISPLAY_NAME &&
      Object.keys(claims).length === 0 &&
      Number.isFinite(operationStartedAtMs) &&
      new Date(user.metadata.creationTime).getTime() >=
        operationStartedAtMs - 5_000;
    assert.equal(
      claimsMatch || incompleteSameRunIdentity,
      true,
      "The pre-backup probe Auth identity is not owned by this run.",
    );
    await auth.deleteUser(PREFLIGHT_UID);
    deletedAuthUserCount = 1;
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
  }

  const [
    profileAfter,
    positiveAfter,
    existingAfter,
    absentAfter,
    sessionsAfter,
  ] = await Promise.all([
    profileRef.get(),
    positiveControlRef.get(),
    existingCanaryRef.get(),
    absentCanaryRef.get(),
    db
      .collection(`application_sessions/${PREFLIGHT_UID}/sessions`)
      .limit(1)
      .get(),
  ]);
  assert.equal(profileAfter.exists, false);
  assert.equal(positiveAfter.exists, false);
  assert.equal(existingAfter.exists || absentAfter.exists, false);
  assert.equal(sessionsAfter.empty, true);
  assert.deepEqual(await childCollectionIds(preflightSessionRoot), []);
  assert.deepEqual(await childCollectionIds(profileRef), []);
  assert.deepEqual(await academicRecords.listDocuments(), []);
  assert.equal((await academicRecords.limit(1).get()).empty, true);
  for (const reference of [
    positiveControlRef,
    existingCanaryRef,
    absentCanaryRef,
  ]) {
    assert.deepEqual(await childCollectionIds(reference), []);
  }
  await assert.rejects(
    auth.getUser(PREFLIGHT_UID),
    (error) => error?.code === "auth/user-not-found",
  );
  await assert.rejects(
    auth.getUserByEmail(PREFLIGHT_EMAIL),
    (error) => error?.code === "auth/user-not-found",
  );
  return {
    deletedDocumentCount,
    deletedAuthUserCount,
    residualDocumentCount: 0,
    residualAuthUserCount: 0,
    residualSessionCount: 0,
  };
};

const cleanupPostBackupProbeArtifacts = async ({
  markerStatus,
  operationStartedAt,
}) => {
  const operationStartedAtMs = auxiliaryTimestampMillis(operationStartedAt);
  assert.equal(Number.isFinite(operationStartedAtMs), true);
  const existingCanaryRef = db.doc(EXISTING_WRITE_CANARY.path);
  const absentCanaryRef = db.doc(ABSENT_WRITE_CANARY.path);
  for (const reference of [existingCanaryRef, absentCanaryRef]) {
    assert.deepEqual(
      await childCollectionIds(reference),
      [],
      "An unknown post-backup canary descendant blocks cleanup.",
    );
  }
  let deletedCanaryCount = 0;
  deletedCanaryCount += await db.runTransaction(async (transaction) => {
    let transactionDeleteCount = 0;
    const [existingCanary, absentCanary] = await transaction.getAll(
      existingCanaryRef,
      absentCanaryRef,
    );
    for (const [snapshot, canary] of [
      [existingCanary, EXISTING_WRITE_CANARY],
      [absentCanary, ABSENT_WRITE_CANARY],
    ]) {
      if (!snapshot.exists) continue;
      const data = snapshot.data() || {};
      assert.equal(data.fixtureOwner, FIXTURE_OWNER);
      assert.equal(data.fixtureId, FIXTURE_ID);
      assert.equal(data.fixtureRevision, FIXTURE_REVISION);
      assert.equal(data.canaryPurpose, canary.data.canaryPurpose);
      assert.equal(data.canaryRevision, canary.revisionHash);
      assertAuxiliaryCreatedWithinRun(
        snapshot.createTime,
        operationStartedAtMs,
      );
      transaction.delete(snapshot.ref);
      transactionDeleteCount += 1;
    }
    return transactionDeleteCount;
  });

  const sessionRoot = db.doc(`application_sessions/${STUDENT_UID}`);
  const sessionCollection = sessionRoot.collection("sessions");
  const [sessionRootSnapshot, sessions] = await Promise.all([
    sessionRoot.get(),
    sessionCollection.limit(AUXILIARY_SESSION_LIMIT_PER_IDENTITY + 1).get(),
  ]);
  assert.equal(
    sessionRootSnapshot.exists,
    false,
    "The post-backup probe session root is not owned by this run.",
  );
  assert.ok(
    sessions.size <= AUXILIARY_SESSION_LIMIT_PER_IDENTITY,
    "Post-backup probe session cleanup is unbounded.",
  );
  assert.deepEqual(
    await childCollectionIds(sessionRoot),
    sessions.empty ? [] : ["sessions"],
    "An unknown post-backup session subcollection blocks cleanup.",
  );
  const probeSessions = sessions.docs.filter((session) => {
    const data = session.data() || {};
    return data.fixturePurpose === "backup-access-deny-probe";
  });
  if (probeSessions.length > 0) {
    const batch = db.batch();
    for (const session of probeSessions) {
      const data = session.data() || {};
      const authTime = Number(data.authTime);
      assert.equal(data.fixtureOwner, FIXTURE_OWNER);
      assert.equal(data.fixtureId, FIXTURE_ID);
      assert.equal(data.fixtureRevision, FIXTURE_REVISION);
      assert.equal(data.probeRevision, POST_BACKUP_PROBE_REVISION_HASH);
      assert.equal(data.uid, STUDENT_UID);
      assert.equal(data.email, STUDENT_EMAIL);
      assert.equal(Number.isSafeInteger(authTime) && authTime > 0, true);
      assert.equal(session.id, String(authTime));
      assert.equal(
        Number(data.schemaVersion),
        APPLICATION_SESSION_SCHEMA_VERSION,
      );
      assert.equal(
        data.authorityGeneration,
        APPLICATION_SESSION_AUTHORITY_GENERATION,
      );
      assert.equal(Number(data.protocolVersion) >= 2, true);
      assert.equal(data.authorityModeAtOpen, "ENFORCE");
      assert.equal(
        data.sessionRevision,
        sha256(`${FIXTURE_ID}\nbackup-access-probe\n${authTime}`),
      );
      assertAuxiliaryCreatedWithinRun(session.createTime, operationStartedAtMs);
      assertAuxiliaryCreatedWithinRun(data.createdAt, operationStartedAtMs);
      assert.deepEqual(
        await childCollectionIds(session.ref),
        [],
        "An unknown post-backup probe session descendant blocks cleanup.",
      );
      batch.delete(session.ref, { lastUpdateTime: session.updateTime });
    }
    await batch.commit();
  }
  const [existingAfter, absentAfter, sessionsAfter] = await Promise.all([
    existingCanaryRef.get(),
    absentCanaryRef.get(),
    sessionCollection.limit(21).get(),
  ]);
  assert.equal(existingAfter.exists || absentAfter.exists, false);
  for (const reference of [existingCanaryRef, absentCanaryRef]) {
    assert.deepEqual(await childCollectionIds(reference), []);
  }
  assert.equal(
    sessionsAfter.docs.some(
      (session) =>
        session.data()?.fixturePurpose === "backup-access-deny-probe",
    ),
    false,
  );
  const result = {
    deletedCanaryCount,
    deletedSessionCount: probeSessions.length,
    residualCanaryCount: 0,
    residualSessionCount: 0,
  };
  if (markerStatus === "READY") {
    await setPostBackupProbeMarkerState("RECOVERED_CLEAN", {
      postBackupProbeRecoveredAt: new Date(),
      postBackupProbeArtifactResidualCount: 0,
    });
  }
  return result;
};

const assertOriginalsMatchBackupsBeforeCutover = async (backups) => {
  const singletonBackups = backups.filter(
    (backup) => backup.kind === "SINGLETON_OVERWRITE",
  );
  const grouped = strictBackupsByCollection(backups);
  await backupDb.runTransaction(async (transaction) => {
    const state = await readTransactionIsolationState(
      transaction,
      singletonBackups,
    );
    const markerData = assertIsolationMarkerPair(
      state.runMarker,
      state.backupRoot,
      { allowedStatuses: new Set(["CLEANING"]) },
    );
    assert.equal(markerData.cleanupOriginState, "PREPARING");
    const collectionPaths = [...strictCollections.keys()];
    for (let index = 0; index < collectionPaths.length; index += 1) {
      const collectionPath = collectionPaths[index];
      assertStrictSetupSnapshot(
        collectionPath,
        state.strictSnapshots[index],
        grouped.get(collectionPath),
      );
    }
    for (let index = 0; index < singletonBackups.length; index += 1) {
      assertSnapshotMatchesBackup(
        state.singletonSnapshots[index],
        singletonBackups[index],
        "A singleton changed before the cutover started.",
      );
    }
  });
};

const preparingBackupRecoveryState = async (markerData) => {
  const expectedCount = Number(markerData.backupCount || 0);
  const partialState = await loadBackups(markerData, {
    requireComplete: false,
  });
  if (partialState.backups.length === 0) {
    await assertBackupNamespaceShape({
      expectRoot: true,
      expectedBackupIds: [],
    });
    return { kind: "EMPTY", backups: [] };
  }
  assert.equal(
    partialState.backups.length,
    expectedCount,
    "A partial PREPARING backup cannot be recovered automatically.",
  );
  const completeState = await loadBackups(markerData);
  await assertOriginalsMatchBackupsBeforeCutover(completeState.backups);
  await assertBackupNamespaceShape({
    expectRoot: true,
    expectedBackupIds: completeState.backups.map((backup) =>
      sha256(backup.path),
    ),
  });
  return { kind: "COMPLETE", backups: completeState.backups };
};

const assertEarlyCleanupSurfaceRestored = async (markerData) => {
  const authFixtureIdentityScope = await exactAuthFixtureIdentityScopeAudit({
    expectedSeeded: false,
  });
  await assertAuthAbsent(PREFLIGHT_UID, PREFLIGHT_EMAIL);
  const createSnapshots = await getBackupSnapshots([...createDocs.keys()]);
  assert.equal(
    createSnapshots.some((snapshot) => snapshot.exists),
    false,
    "A fixture create path changed before the cutover started.",
  );
  const auxiliary = await assertFixtureAuxiliaryNamespacesEmpty();
  assert.equal(
    auxiliary.manifestHash,
    markerData.auxiliaryPreflightHash,
    "The early cleanup auxiliary surface differs from preflight.",
  );
  const topology = await assertPlannedMutationChildTopology();
  assert.equal(
    topology.observedHash,
    markerData.plannedMutationTopologyBaselineHash,
    "The early cleanup child topology differs from preflight.",
  );
  return { authFixtureIdentityScope, auxiliary, topology };
};

const markEarlyIsolationRestored = async ({
  cleanupOriginState,
  backupRecoveryKind,
  deletedAuthUserCount,
}) =>
  backupDb.runTransaction(async (transaction) => {
    const backupSnapshot = await transaction.get(
      backupDb
        .collection(BACKUP_DOCUMENTS_PATH)
        .limit(MAX_ATOMIC_BACKUP_COUNT + 1),
    );
    const [runMarker, backupRoot] = await transaction.getAll(
      backupDb.doc(RUN_PATH),
      backupDb.doc(BACKUP_ROOT_PATH),
    );
    const markerData = assertIsolationMarkerPair(runMarker, backupRoot, {
      allowedStatuses: new Set(["CLEANING"]),
    });
    assert.equal(markerData.cleanupOriginState, cleanupOriginState);
    let backupManifestHash = markerData.backupManifestHash;
    const update = {
      status: "RESTORED",
      restoredDocumentCount: 0,
      deletedFixtureDocumentCount: 0,
      deletedAuthUserCount,
      restoreVerifiedAt: new Date(),
    };
    if (backupRecoveryKind === "EMPTY") {
      assert.equal(backupSnapshot.empty, true);
      backupManifestHash = backupManifestFor([]).hash;
      Object.assign(update, {
        backupCount: 0,
        strictBackupCount: 0,
        singletonBackupCount: 0,
        backupManifestHash,
        backupCanonicalByteCount: 0,
        backupVerifiedCount: 0,
      });
    } else {
      assert.equal(backupRecoveryKind, "COMPLETE");
      assert.equal(
        backupSnapshot.size,
        Number(markerData.backupCount),
        "The complete PREPARING backup count changed during recovery.",
      );
      const backups = backupSnapshot.docs.map(backupFromSnapshot);
      assert.equal(
        backupManifestFor(backups).hash,
        markerData.backupManifestHash,
        "The complete PREPARING backup manifest changed during recovery.",
      );
    }
    update.restoredBackupManifestHash = backupManifestHash;
    transaction.update(runMarker.ref, update);
    transaction.update(backupRoot.ref, update);
    return { backupManifestHash };
  });

const cleanup = async ({ skipPreAudit = false } = {}) => {
  const finalizeMetadata = async () => {
    const runMarkerRef = backupDb.doc(RUN_PATH);
    const backupRootRef = backupDb.doc(BACKUP_ROOT_PATH);
    const [runMarker, backupRoot] = await backupDb.getAll(
      runMarkerRef,
      backupRootRef,
    );
    assert.equal(runMarker.exists, true, "The restored run marker is missing.");
    const runMarkerData = runMarker.data() || {};
    assertCleanupMarkerData(runMarkerData);
    assert.equal(runMarkerData.status, "RESTORED");
    assert.equal(
      Number(runMarkerData.backupSchemaVersion),
      BACKUP_SCHEMA_VERSION,
    );
    assert.equal(
      Number(runMarkerData.isolationProtocolVersion),
      ISOLATION_PROTOCOL_VERSION,
    );
    assertLosslessBackupValue(runMarkerData);
    assert.deepEqual(
      await childCollectionIds(runMarkerRef),
      [],
      "An unknown run-marker descendant blocks metadata cleanup.",
    );

    if (!backupRoot.exists) {
      await assertBackupNamespaceShape({
        expectRoot: false,
        expectedBackupIds: [],
      });
      await backupDb.runTransaction(async (transaction) => {
        const [transactionRunMarker, transactionBackupRoot] =
          await transaction.getAll(runMarkerRef, backupRootRef);
        assert.equal(transactionRunMarker.exists, true);
        assert.equal(transactionBackupRoot.exists, false);
        const value = transactionRunMarker.data() || {};
        assertCleanupMarkerData(value);
        assert.equal(value.status, "RESTORED");
        assert.equal(Number(value.backupSchemaVersion), BACKUP_SCHEMA_VERSION);
        assert.equal(
          Number(value.isolationProtocolVersion),
          ISOLATION_PROTOCOL_VERSION,
        );
        assertLosslessBackupValue(value);
        transaction.delete(transactionRunMarker.ref);
      });
    } else {
      const markerData = assertIsolationMarkerPair(runMarker, backupRoot, {
        allowedStatuses: new Set(["RESTORED"]),
      });
      const backupState = await loadBackups(markerData);
      const expectedBackupIds = backupState.backups
        .map((backup) => sha256(backup.path))
        .sort();
      await assertBackupNamespaceShape({
        expectRoot: true,
        expectedBackupIds,
      });
      await backupDb.runTransaction(async (transaction) => {
        const backupSnapshot = await transaction.get(
          backupDb
            .collection(BACKUP_DOCUMENTS_PATH)
            .limit(MAX_ATOMIC_BACKUP_COUNT + 1),
        );
        const [transactionRunMarker, transactionBackupRoot] =
          await transaction.getAll(runMarkerRef, backupRootRef);
        const transactionMarkerData = assertIsolationMarkerPair(
          transactionRunMarker,
          transactionBackupRoot,
          { allowedStatuses: new Set(["RESTORED"]) },
        );
        assert.equal(
          backupSnapshot.size,
          Number(transactionMarkerData.backupCount),
          "The backup count changed before metadata cleanup.",
        );
        const transactionBackups = backupSnapshot.docs.map(backupFromSnapshot);
        assert.equal(
          backupManifestFor(transactionBackups).hash,
          transactionMarkerData.backupManifestHash,
          "The backup manifest changed before metadata cleanup.",
        );
        assert.deepEqual(
          backupSnapshot.docs.map((document) => document.id).sort(),
          expectedBackupIds,
          "The backup IDs changed before metadata cleanup.",
        );
        for (const document of backupSnapshot.docs) {
          transaction.delete(document.ref);
        }
        transaction.delete(transactionBackupRoot.ref);
        transaction.delete(transactionRunMarker.ref);
      });
    }

    await assertBackupNamespaceShape({
      expectRoot: false,
      expectedBackupIds: [],
    });
    assert.deepEqual(await childCollectionIds(runMarkerRef), []);
    const residualMarker = await runMarkerRef.get();
    assert.equal(residualMarker.exists, false);
  };

  const initialMarker = await db.doc(RUN_PATH).get();
  if (!initialMarker.exists) {
    await assertBackupNamespaceEmpty();
    const authFixtureIdentityScope = await exactAuthFixtureIdentityScopeAudit({
      expectedSeeded: false,
    });
    await assertAuthAbsent(PREFLIGHT_UID, PREFLIGHT_EMAIL);
    const createdSnapshots = await getBackupSnapshots([...createDocs.keys()]);
    assert.equal(
      createdSnapshots.some((snapshot) => snapshot.exists),
      false,
    );
    const auxiliaryResidualAudit =
      await assertFixtureAuxiliaryNamespacesEmpty();
    const plannedMutationTopology = await assertPlannedMutationChildTopology();
    return safeResult("w10p-visual-fixture-cleanup", {
      alreadyCleaned: true,
      deletedFixtureDocumentCount: 0,
      deletedPlannedDocumentCount: 0,
      restoredDocumentCount: 0,
      deletedCommandDocumentCount: 0,
      deletedAuxiliaryDocumentCount: 0,
      deletedAuthUserCount: 0,
      residualFixtureDocumentCount: 0,
      residualAuthUserCount: 0,
      residualSessionCount: 0,
      residualCommandDocumentCount: 0,
      residualBackupDocumentCount: 0,
      residualRunMarkerCount: 0,
      residualTokenCount: 0,
      authFixtureIdentityScope,
      auxiliaryResidualAudit,
      plannedMutationTopology,
      extraRowCount: 0,
    });
  }

  const initialMarkerData = initialMarker.data() || {};
  assertCleanupMarkerData(initialMarkerData);
  const preBackupProbeCleanup = await cleanupPreBackupProbeArtifacts({
    operationStartedAt: initialMarkerData.operationStartedAt,
  });
  const postBackupProbeCleanup = await cleanupPostBackupProbeArtifacts({
    markerStatus: initialMarkerData.status,
    operationStartedAt: initialMarkerData.operationStartedAt,
  });
  if (initialMarkerData.status === "READY" && !skipPreAudit) {
    const credentialsAvailable = Boolean(
      String(process.env.W10P_VISUAL_CREDENTIALS_JSON || "").trim(),
    );
    const firebaseConfigAvailable = Boolean(
      String(process.env.W10P_VISUAL_FIREBASE_CONFIG_JSON || "").trim(),
    );
    assert.equal(
      credentialsAvailable,
      firebaseConfigAvailable,
      "Recovery cleanup probe inputs must be both present or both absent.",
    );
    await audit({
      requireLiveBackupAccessProbe:
        credentialsAvailable && firebaseConfigAvailable,
    });
  }

  const initialBackupRoot = await db.doc(BACKUP_ROOT_PATH).get();
  if (initialMarkerData.status === "RESTORED" && !initialBackupRoot.exists) {
    await assertEarlyCleanupSurfaceRestored(initialMarkerData);
    await finalizeMetadata();
    const restoredSurface =
      await assertEarlyCleanupSurfaceRestored(initialMarkerData);
    return safeResult("w10p-visual-fixture-cleanup", {
      interruptedSetupState: "RESTORED",
      restoredDocumentCount: initialMarkerData.restoredDocumentCount || 0,
      restoredBackupManifestHash: initialMarkerData.backupManifestHash,
      residualFixtureDocumentCount: 0,
      residualAuthUserCount: 0,
      residualSessionCount: 0,
      residualCommandDocumentCount: 0,
      residualBackupDocumentCount: 0,
      residualRunMarkerCount: 0,
      residualTokenCount: 0,
      authFixtureIdentityScope: restoredSurface.authFixtureIdentityScope,
      plannedMutationTopology: restoredSurface.topology,
      extraRowCount: 0,
    });
  }

  const markerData = await beginCleanupState();
  assertCleanupMarkerData(markerData);
  const cleanupOriginState =
    markerData.cleanupOriginState || initialMarkerData.status;

  if (markerData.status === "RESTORED") {
    await assertEarlyCleanupSurfaceRestored(markerData);
    await finalizeMetadata();
    const restoredSurface = await assertEarlyCleanupSurfaceRestored(markerData);
    return safeResult("w10p-visual-fixture-cleanup", {
      interruptedSetupState: "RESTORED",
      restoredDocumentCount: markerData.restoredDocumentCount || 0,
      restoredBackupManifestHash: markerData.backupManifestHash,
      residualFixtureDocumentCount: 0,
      residualAuthUserCount: 0,
      residualSessionCount: 0,
      residualCommandDocumentCount: 0,
      residualBackupDocumentCount: 0,
      residualRunMarkerCount: 0,
      residualTokenCount: 0,
      authFixtureIdentityScope: restoredSurface.authFixtureIdentityScope,
      plannedMutationTopology: restoredSurface.topology,
      extraRowCount: 0,
    });
  }

  const deletedAuthUserCount = await deleteAuthUsers({
    requireOwnership: true,
    allowIncompleteFixtureCreation: true,
    operationStartedAt: markerData.operationStartedAt,
  });

  if (["ACCESS_PROBING", "PREPARING"].includes(cleanupOriginState)) {
    let backupRecoveryKind = "EMPTY";
    if (cleanupOriginState === "PREPARING") {
      backupRecoveryKind = (await preparingBackupRecoveryState(markerData))
        .kind;
    } else {
      await assertBackupNamespaceShape({
        expectRoot: true,
        expectedBackupIds: [],
      });
    }
    await assertEarlyCleanupSurfaceRestored(markerData);
    await db.runTransaction(async (transaction) => {
      const transactionalPreflight =
        await assertFixtureAuxiliaryDocumentsEmptyInTransaction(transaction);
      assert.equal(
        transactionalPreflight.manifestHash,
        markerData.auxiliaryPreflightHash,
      );
    });
    const earlyRestoration = await markEarlyIsolationRestored({
      cleanupOriginState,
      backupRecoveryKind,
      deletedAuthUserCount,
    });
    await assertEarlyCleanupSurfaceRestored(markerData);
    await finalizeMetadata();
    const restoredSurface = await assertEarlyCleanupSurfaceRestored(markerData);
    return safeResult("w10p-visual-fixture-cleanup", {
      interruptedSetupState: cleanupOriginState,
      preBackupProbeCleanup,
      postBackupProbeCleanup,
      deletedFixtureDocumentCount: 0,
      deletedPlannedDocumentCount: 0,
      restoredDocumentCount: 0,
      restoredExistingDocumentCount: 0,
      restoredAbsentDocumentCount: 0,
      restoredBackupManifestHash: earlyRestoration.backupManifestHash,
      deletedCommandDocumentCount: 0,
      deletedAuxiliaryDocumentCount: 0,
      deletedAuthUserCount,
      residualFixtureDocumentCount: 0,
      residualAuthUserCount: 0,
      residualSessionCount: 0,
      residualCommandDocumentCount: 0,
      residualBackupDocumentCount: 0,
      residualRunMarkerCount: 0,
      residualTokenCount: 0,
      authFixtureIdentityScope: restoredSurface.authFixtureIdentityScope,
      plannedMutationTopology: restoredSurface.topology,
      extraRowCount: 0,
    });
  }

  const backupState = await loadBackups(markerData);
  const backups = backupState.backups;
  assert.equal(
    backups.filter((backup) => backup.kind === "SINGLETON_OVERWRITE").length,
    overwriteDocs.size,
  );
  const restoration = await restoreBackups(
    backups,
    markerData.backupManifestHash,
  );
  const auxiliary = await deleteFixtureAuxiliary({
    operationStartedAt: markerData.operationStartedAt,
    cleanupStartedAt: markerData.cleanupStartedAt,
  });

  const residualCreated = await getSnapshots([...createDocs.keys()]);
  assert.equal(
    residualCreated.some((snapshot) => snapshot.exists),
    false,
  );
  const authFixtureIdentityScope = await exactAuthFixtureIdentityScopeAudit({
    expectedSeeded: false,
  });
  assert.equal(
    authFixtureIdentityScope.scopedUidSetHash,
    authAllowedUidSetHash,
  );
  for (const collectionName of ["command_receipts", "command_audit_events"]) {
    for (const uid of [STUDENT_UID, TEACHER_UID, ADMIN_UID]) {
      assert.equal(
        (
          await db
            .collection(collectionName)
            .where("actorUid", "==", uid)
            .limit(1)
            .get()
        ).empty,
        true,
      );
    }
  }
  for (const uid of [STUDENT_UID, TEACHER_UID, ADMIN_UID]) {
    await assert.rejects(
      auth.getUser(uid),
      (error) => error?.code === "auth/user-not-found",
    );
    assert.equal(
      (
        await db
          .collection(`application_sessions/${uid}/sessions`)
          .limit(1)
          .get()
      ).empty,
      true,
    );
    for (const path of [
      `application_sessions/${uid}`,
      `application_session_transitions/${uid}`,
      `user_notifications/${uid}`,
    ]) {
      assert.equal((await db.doc(path).get()).exists, false);
    }
  }
  const auxiliaryResidualAudit = await assertFixtureAuxiliaryNamespacesEmpty();
  assert.equal(
    auxiliaryResidualAudit.manifestHash,
    markerData.auxiliaryPreflightHash,
    "The auxiliary namespaces were not restored to their preflight state.",
  );
  await markIsolationRestored(backups, {
    restoredDocumentCount: restoration.restoredDocumentCount,
    restoredBackupManifestHash: restoration.restoredBackupManifestHash,
    deletedFixtureDocumentCount: restoration.deletedFixtureDocumentCount,
    deletedAuthUserCount,
  });
  await assertEarlyCleanupSurfaceRestored(markerData);
  await finalizeMetadata();
  const finalRestoredSurface =
    await assertEarlyCleanupSurfaceRestored(markerData);

  return safeResult("w10p-visual-fixture-cleanup", {
    interruptedSetupState: cleanupOriginState,
    preBackupProbeCleanup,
    postBackupProbeCleanup,
    deletedFixtureDocumentCount: restoration.deletedFixtureDocumentCount,
    deletedPlannedDocumentCount: createDocs.size,
    ...restoration,
    restoredSingletonCount: backups.filter(
      (backup) => backup.kind === "SINGLETON_OVERWRITE",
    ).length,
    deletedCommandDocumentCount: auxiliary.commandDocumentCount,
    deletedAuxiliaryDocumentCount: auxiliary.auxiliaryDocumentCount,
    validatedAuxiliaryDocumentCount: auxiliary.validatedDocumentCount,
    unownedAuxiliaryDocumentDeleteCount: auxiliary.unownedDocumentDeleteCount,
    auxiliaryRecursiveDeleteCount: auxiliary.recursiveDeleteCount,
    userNotificationDeleteCount: auxiliary.userNotificationDeleteCount,
    auxiliaryResidualAudit,
    plannedMutationTopology: finalRestoredSurface.topology,
    deletedAuthUserCount,
    residualFixtureDocumentCount: 0,
    residualAuthUserCount: 0,
    residualSessionCount: 0,
    residualCommandDocumentCount: 0,
    residualBackupDocumentCount: 0,
    residualRunMarkerCount: 0,
    residualTokenCount: 0,
    authFixtureIdentityScope,
    strict: {
      ...restoration.strictRestoration,
      fixtureResidualRowCount: 0,
      restoredManifestHash: sha256(
        canonicalJson(
          backups
            .filter((backup) => backup.kind === "STRICT_ISOLATION")
            .map(backupManifestRow)
            .sort((left, right) => left.backupId.localeCompare(right.backupId)),
        ),
      ),
      allowlistManifestHash: strictAllowlistManifestHash,
    },
    extraRowCount: restoration.strictRestoration.extraRowCount,
  });
};

try {
  initializeAdmin();
  const result =
    mode === "setup"
      ? await setup()
      : mode === "audit"
        ? await audit()
        : await cleanup();
  if (auditOutputPath) writeAuditArtifactAtomically(result);
  console.log(JSON.stringify(result));
} catch (error) {
  const errorCode = String(error?.code || error?.name || "UNKNOWN")
    .replace(/[^A-Za-z0-9_/-]/g, "")
    .slice(0, 80);
  const messageHash = sha256(String(error?.message || "unknown"));
  console.error(
    JSON.stringify({
      suite: `w10p-visual-fixture-${mode}`,
      passed: false,
      artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
      projectId: STAGING_PROJECT_ID,
      fixtureId: FIXTURE_ID,
      fixtureNamespace: FIXTURE_ID,
      fixtureRevision: FIXTURE_REVISION,
      planHash,
      errorCode,
      errorMessageHash: messageHash,
      productionAccess: 0,
      rawCredentialOutputCount: 0,
      rawPiiOutputCount: 0,
    }),
  );
  process.exitCode = 1;
} finally {
  appCheckDebugTokenSecret = "";
  if (backupApp && deleteAdminApp) {
    try {
      await deleteAdminApp(backupApp);
    } catch (_deleteError) {
      process.exitCode = 1;
    }
  }
  if (app && deleteAdminApp) {
    try {
      await deleteAdminApp(app);
    } catch (_deleteError) {
      process.exitCode = 1;
    }
  }
}
