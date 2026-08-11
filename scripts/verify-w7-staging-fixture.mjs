import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const STAGING_PROJECT_ID = "westory-staging-177587430482";
const PRODUCTION_PROJECT_ID = "history-quiz-yongsin";
const FIXTURE_OWNER = "w7-wis-staging-browser";
const CURRENT_SEMESTER_ID = "2026-2";
const ARCHIVE_SEMESTER_ID = "2026-1";
const args = process.argv.slice(2);
const valueArg = (name) =>
  String(
    args
      .find((value) => value.startsWith(`${name}=`))
      ?.slice(name.length + 1) || "",
  ).trim();
const projectId = valueArg("--project");
const testRunId = valueArg("--test-run-id");
const mode = ["setup", "verify", "cleanup"].find((name) =>
  args.includes(`--${name}`),
);
const modeCount = ["setup", "verify", "cleanup"].filter((name) =>
  args.includes(`--${name}`),
).length;

assert.notEqual(
  projectId,
  PRODUCTION_PROJECT_ID,
  "Production fixture access is forbidden.",
);
assert.equal(
  projectId,
  STAGING_PROJECT_ID,
  `Exact --project=${STAGING_PROJECT_ID} is required.`,
);
assert.equal(
  modeCount,
  1,
  "Choose exactly one of --setup, --verify, or --cleanup.",
);
assert.match(
  testRunId,
  /^w7-[a-z0-9][a-z0-9-]{7,63}$/u,
  "A scoped W7 testRunId is required.",
);

const password = String(process.env.WESTORY_W7_STAGING_PASSWORD || "");
if (mode === "setup") {
  assert.match(
    password,
    /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{16,}$/u,
  );
}

const requireFromFunctions = createRequire(resolve("functions/package.json"));
const { applicationDefault, deleteApp, initializeApp } =
  requireFromFunctions("firebase-admin/app");
const { getAuth } = requireFromFunctions("firebase-admin/auth");
const { FieldValue, getFirestore } = requireFromFunctions(
  "firebase-admin/firestore",
);
const app = initializeApp(
  { credential: applicationDefault(), projectId },
  `w7-wis-fixture-${createHash("sha256").update(testRunId).digest("hex").slice(0, 12)}`,
);
const auth = getAuth(app);
const db = getFirestore(app);

const sha256 = (value) =>
  createHash("sha256").update(String(value), "utf8").digest("hex");
const hashId = (prefix, ...parts) => `${prefix}_${sha256(parts.join("\n"))}`;
const canonicalValue = (value) => {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
};
const documentHash = (value) => sha256(JSON.stringify(canonicalValue(value)));
const idSuffix = sha256(testRunId).slice(0, 20);
const studentUid = `w7-student-${idSuffix}`;
const teacherUid = `w7-teacher-${idSuffix}`;
const studentEmail = `w7.student.${idSuffix}@yongshin-ms.ms.kr`;
const teacherEmail = `w7.teacher.${idSuffix}@yongshin-ms.ms.kr`;
const classId = `class-w7-${idSuffix}`;
const enrollmentId = `enr-w7-${idSuffix}`;
const slotId = `slot_${sha256(`${CURRENT_SEMESTER_ID}\n${studentUid}`).slice(0, 40)}`;
const currentAccountId = hashId("wisacct", CURRENT_SEMESTER_ID, studentUid);
const archiveAccountId = hashId("wisacct", ARCHIVE_SEMESTER_ID, studentUid);
const archiveLedgerId = hashId(
  "wisled",
  ARCHIVE_SEMESTER_ID,
  archiveAccountId,
  "GRANT",
  testRunId,
);
const productName = `W7 ${testRunId} 학습 상점`;
const productId = hashId("wisprod", productName);
const inventoryId = hashId("wisinv", CURRENT_SEMESTER_ID, productId);
const economyDisplayName = "2026학년도 2학기 위스";
const runPath = `w7_verification_runs/${testRunId}`;

const WIS_COMMAND_TYPES = new Set([
  "createSemesterEconomy",
  "createWisAccounts",
  "grantInitialWis",
  "grantWis",
  "deductWis",
  "adjustWis",
  "reverseWisEntry",
  "rebuildWisProjection",
  "transitionWisEconomy",
  "upsertWisProduct",
  "upsertWisInventory",
  "placeWisOrder",
  "reviewWisOrder",
]);

const ownedFixturePaths = [
  runPath,
  `users/${studentUid}`,
  `users/${teacherUid}`,
  `semester_classes/${classId}`,
  `semester_enrollments/${enrollmentId}`,
  `semester_enrollment_slots/${slotId}`,
  `semester_manifests/${ARCHIVE_SEMESTER_ID}`,
  `semester_wis_economies/${ARCHIVE_SEMESTER_ID}`,
  `semester_wis_accounts/${archiveAccountId}`,
  `semester_wis_balances/${archiveAccountId}`,
  `semester_wis_rankings/${archiveAccountId}`,
  `semester_wis_ledger/${archiveLedgerId}`,
];

const readRequiredScopes = async ({ allowMissingArchive = false } = {}) => {
  const [currentManifest, archiveManifest, maintenance] = await db.getAll(
    db.doc(`semester_manifests/${CURRENT_SEMESTER_ID}`),
    db.doc(`semester_manifests/${ARCHIVE_SEMESTER_ID}`),
    db.doc("site_settings/student_maintenance"),
  );
  assert.equal(
    currentManifest.exists,
    true,
    "Current semester manifest is missing.",
  );
  assert.equal(
    currentManifest.data()?.status,
    "ACTIVE",
    "Current semester must be ACTIVE.",
  );
  if (!archiveManifest.exists) {
    assert.equal(
      allowMissingArchive,
      true,
      "Archive semester manifest is missing.",
    );
  } else {
    assert.ok(
      ["CLOSED", "ARCHIVED"].includes(
        String(archiveManifest.data()?.status || ""),
      ),
      "2026-1 must be closed or archived.",
    );
  }
  assert.equal(
    maintenance.exists ? maintenance.data()?.enabled === true : false,
    false,
    "Dedicated Staging maintenance must remain disabled for synthetic student QA.",
  );
  return {
    currentRevision: Number(currentManifest.data()?.revision || 0),
    archiveRevision: Number(archiveManifest.data()?.revision || 0),
    archiveMissing: !archiveManifest.exists,
  };
};

const queryByAccount = async (collectionName, accountId) =>
  (
    await db
      .collection(collectionName)
      .where("accountId", "==", accountId)
      .get()
  ).docs;

const commandEvidenceForActors = async () => {
  const documents = [];
  for (const collectionName of ["command_receipts", "command_audit_events"]) {
    for (const uid of [studentUid, teacherUid]) {
      const snapshot = await db
        .collection(collectionName)
        .where("actorUid", "==", uid)
        .get();
      for (const item of snapshot.docs) {
        assert.equal(
          WIS_COMMAND_TYPES.has(String(item.data()?.commandType || "")),
          true,
        );
        documents.push(item);
      }
    }
  }
  return documents;
};

const currentBusinessDocuments = async () => {
  const exact = await db.getAll(
    db.doc(`semester_wis_economies/${CURRENT_SEMESTER_ID}`),
    db.doc(`semester_wis_accounts/${currentAccountId}`),
    db.doc(`semester_wis_balances/${currentAccountId}`),
    db.doc(`semester_wis_rankings/${currentAccountId}`),
    db.doc(`wis_product_catalog/${productId}`),
    db.doc(`semester_wis_inventory/${inventoryId}`),
  );
  const linked = [];
  for (const collectionName of [
    "semester_wis_ledger",
    "semester_wis_orders",
    "semester_wis_reconciliation_reports",
  ]) {
    linked.push(...(await queryByAccount(collectionName, currentAccountId)));
  }
  return [...exact.filter((item) => item.exists), ...linked];
};

const deleteInBatches = async (documents) => {
  let deleted = 0;
  const unique = [
    ...new Map(documents.map((item) => [item.ref.path, item])).values(),
  ];
  for (let index = 0; index < unique.length; index += 400) {
    const batch = db.batch();
    unique.slice(index, index + 400).forEach((item) => batch.delete(item.ref));
    await batch.commit();
    deleted += Math.min(400, unique.length - index);
  }
  return deleted;
};

const deleteSessions = async () => {
  let deleted = 0;
  for (const uid of [studentUid, teacherUid]) {
    const snapshot = await db
      .collection(`application_sessions/${uid}/sessions`)
      .get();
    deleted += await deleteInBatches(snapshot.docs);
  }
  return deleted;
};

const deleteAuthUsers = async () => {
  let deleted = 0;
  for (const uid of [studentUid, teacherUid]) {
    try {
      const user = await auth.getUser(uid);
      assert.equal(user.customClaims?.fixtureOwner, FIXTURE_OWNER);
      assert.equal(user.customClaims?.testRunId, testRunId);
      await auth.deleteUser(uid);
      deleted += 1;
    } catch (error) {
      if (error?.code !== "auth/user-not-found") throw error;
    }
  }
  return deleted;
};

const cleanupFixture = async () => {
  const current = await currentBusinessDocuments();
  for (const item of current) {
    const data = item.data() || {};
    if (item.ref.path === `semester_wis_economies/${CURRENT_SEMESTER_ID}`) {
      assert.equal(
        data.createdBy,
        teacherUid,
        "Refusing a foreign current economy.",
      );
      assert.equal(
        data.displayName,
        economyDisplayName,
        "Refusing a foreign current economy name.",
      );
    } else if (item.ref.path === `wis_product_catalog/${productId}`) {
      assert.equal(
        data.createdBy,
        teacherUid,
        "Refusing a foreign W7 product.",
      );
      assert.equal(
        data.name,
        productName,
        "Refusing a foreign W7 product name.",
      );
    } else if (
      item.ref.path.includes(`/${currentAccountId}`) ||
      data.accountId === currentAccountId
    ) {
      assert.equal(data.semesterId, CURRENT_SEMESTER_ID);
      if (data.studentUid) assert.equal(data.studentUid, studentUid);
    } else if (item.ref.path === `semester_wis_inventory/${inventoryId}`) {
      assert.equal(data.semesterId, CURRENT_SEMESTER_ID);
      assert.equal(data.productId, productId);
    }
  }
  const evidence = await commandEvidenceForActors();
  const owned = await db.getAll(
    ...ownedFixturePaths.map((path) => db.doc(path)),
  );
  const existingOwned = owned.filter((snapshot) => {
    if (!snapshot.exists) return false;
    if (
      snapshot.ref.path === `semester_manifests/${ARCHIVE_SEMESTER_ID}` &&
      snapshot.data()?.fixtureOwner !== FIXTURE_OWNER
    ) {
      return false;
    }
    assert.equal(
      snapshot.data()?.fixtureOwner,
      FIXTURE_OWNER,
      `Refusing foreign path: ${snapshot.ref.path}`,
    );
    assert.equal(
      snapshot.data()?.testRunId,
      testRunId,
      `Refusing another run: ${snapshot.ref.path}`,
    );
    return true;
  });
  const deletedBusinessDocuments = await deleteInBatches(current);
  const deletedCommandDocuments = await deleteInBatches(evidence);
  const deletedFixtureDocuments = await deleteInBatches(existingOwned);
  const deletedSessions = await deleteSessions();
  const deletedAuthUsers = await deleteAuthUsers();

  assert.equal(
    (await currentBusinessDocuments()).length,
    0,
    "Residual current W7 business data remains.",
  );
  assert.equal(
    (await commandEvidenceForActors()).length,
    0,
    "Residual W7 receipt or audit data remains.",
  );
  const residualOwned = await db.getAll(
    ...ownedFixturePaths.map((path) => db.doc(path)),
  );
  assert.equal(
    residualOwned.some(
      (snapshot) =>
        snapshot.exists &&
        !(
          snapshot.ref.path === `semester_manifests/${ARCHIVE_SEMESTER_ID}` &&
          snapshot.data()?.fixtureOwner !== FIXTURE_OWNER
        ),
    ),
    false,
    "Residual W7 fixture data remains.",
  );
  for (const uid of [studentUid, teacherUid]) {
    assert.equal(
      (await db.collection(`application_sessions/${uid}/sessions`).get()).empty,
      true,
    );
  }
  return {
    deletedBusinessDocuments,
    deletedCommandDocuments,
    deletedFixtureDocuments,
    deletedSessions,
    deletedAuthUsers,
    residualBusinessDocuments: 0,
  };
};

const verifyFixture = async () => {
  const scopes = await readRequiredScopes();
  const run = await db.doc(runPath).get();
  assert.equal(run.exists, true, "W7 verification run manifest is missing.");
  assert.equal(run.data()?.fixtureOwner, FIXTURE_OWNER);
  assert.equal(run.data()?.testRunId, testRunId);
  assert.equal(run.data()?.currentManifestRevision, scopes.currentRevision);

  const [
    economy,
    account,
    balance,
    ranking,
    product,
    inventory,
    archiveEconomy,
    archiveAccount,
    archiveLedger,
  ] = await db.getAll(
    db.doc(`semester_wis_economies/${CURRENT_SEMESTER_ID}`),
    db.doc(`semester_wis_accounts/${currentAccountId}`),
    db.doc(`semester_wis_balances/${currentAccountId}`),
    db.doc(`semester_wis_rankings/${currentAccountId}`),
    db.doc(`wis_product_catalog/${productId}`),
    db.doc(`semester_wis_inventory/${inventoryId}`),
    db.doc(`semester_wis_economies/${ARCHIVE_SEMESTER_ID}`),
    db.doc(`semester_wis_accounts/${archiveAccountId}`),
    db.doc(`semester_wis_ledger/${archiveLedgerId}`),
  );
  assert.equal(economy.exists, true);
  assert.equal(economy.data()?.displayName, economyDisplayName);
  assert.ok(
    ["ACTIVE_INITIALIZING", "ACTIVE_OPEN"].includes(economy.data()?.status),
  );
  assert.equal(account.exists, true);
  assert.equal(account.data()?.studentUid, studentUid);
  assert.equal(account.data()?.enrollmentId, enrollmentId);
  assert.ok(
    account.data()?.initialGrantLedgerEntryId,
    "Initial grant must be exactly-once recorded.",
  );
  assert.equal(balance.exists, true);
  assert.equal(ranking.exists, true);
  assert.equal(balance.data()?.balance, account.data()?.balance);
  assert.equal(ranking.data()?.balance, account.data()?.balance);
  assert.equal(product.exists, true);
  assert.equal(product.data()?.name, productName);
  assert.equal(inventory.exists, true);
  assert.equal(inventory.data()?.productId, productId);

  const ledger = await queryByAccount("semester_wis_ledger", currentAccountId);
  assert.ok(ledger.some((item) => item.data()?.type === "INITIAL_GRANT"));
  assert.ok(ledger.some((item) => item.data()?.type === "ORDER_DEBIT"));
  assert.ok(ledger.some((item) => item.data()?.type === "REVERSAL"));
  assert.equal(
    ledger.every((item) => item.data()?.semesterId === CURRENT_SEMESTER_ID),
    true,
  );
  const orders = await queryByAccount("semester_wis_orders", currentAccountId);
  assert.ok(orders.length > 0);
  assert.ok(
    orders.every((item) =>
      ["REJECTED", "FULFILLED"].includes(item.data()?.status),
    ),
  );
  const reports = await queryByAccount(
    "semester_wis_reconciliation_reports",
    currentAccountId,
  );
  assert.ok(reports.some((item) => item.data()?.status === "PASS"));

  assert.equal(
    archiveEconomy.exists && archiveAccount.exists && archiveLedger.exists,
    true,
  );
  assert.equal(archiveEconomy.data()?.status, "ARCHIVED");
  assert.equal(
    documentHash(archiveEconomy.data()),
    run.data()?.archiveEconomyHash,
  );
  assert.equal(
    documentHash(archiveAccount.data()),
    run.data()?.archiveAccountHash,
  );
  assert.equal(
    documentHash(archiveLedger.data()),
    run.data()?.archiveLedgerHash,
  );
  assert.equal(
    ledger.some((item) => item.data()?.sourceId === archiveLedgerId),
    false,
  );

  const evidence = await commandEvidenceForActors();
  const receipts = evidence.filter(
    (item) => item.ref.parent.id === "command_receipts",
  );
  const audits = evidence.filter(
    (item) => item.ref.parent.id === "command_audit_events",
  );
  const commandTypes = new Set(
    receipts.map((item) => item.data()?.commandType),
  );
  assert.deepEqual(
    commandTypes,
    WIS_COMMAND_TYPES,
    "Staging must exercise all 13 W7 commands.",
  );
  assert.equal(
    receipts.every((item) => item.data()?.status === "SUCCEEDED"),
    true,
  );
  assert.equal(receipts.length, audits.length);

  return {
    currentBalance: Number(account.data()?.balance || 0),
    ledgerCount: ledger.length,
    orderCount: orders.length,
    reconciliationCount: reports.length,
    commandTypeCount: commandTypes.size,
    receiptCount: receipts.length,
    archiveHashStable: true,
  };
};

try {
  if (mode === "cleanup") {
    const result = await cleanupFixture();
    console.log(
      JSON.stringify({
        suite: "w7-staging-fixture-cleanup",
        passed: true,
        projectId,
        testRunId,
        ...result,
        productionAccess: 0,
      }),
    );
  } else if (mode === "verify") {
    const result = await verifyFixture();
    console.log(
      JSON.stringify({
        suite: "w7-staging-fixture-verify",
        passed: true,
        projectId,
        testRunId,
        ...result,
        productionAccess: 0,
      }),
    );
  } else {
    await cleanupFixture();
    const scopes = await readRequiredScopes({ allowMissingArchive: true });
    const currentEconomy = await db
      .doc(`semester_wis_economies/${CURRENT_SEMESTER_ID}`)
      .get();
    assert.equal(
      currentEconomy.exists,
      false,
      "Dedicated Staging already has a current W7 economy.",
    );
    for (const user of [
      { uid: studentUid, email: studentEmail, displayName: "W7 합성 학생" },
      { uid: teacherUid, email: teacherEmail, displayName: "W7 합성 교사" },
    ]) {
      await auth.createUser({ ...user, password, emailVerified: true });
      await auth.setCustomUserClaims(user.uid, {
        fixtureOwner: FIXTURE_OWNER,
        testRunId,
      });
    }
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const batch = db.batch();
    const createOwned = (path, value) =>
      batch.create(db.doc(path), {
        ...value,
        fixtureOwner: FIXTURE_OWNER,
        testRunId,
        expiresAt,
      });
    createOwned(`users/${studentUid}`, {
      uid: studentUid,
      email: studentEmail,
      role: "student",
      name: "합성학생",
      grade: "3",
      class: "1",
      number: "97",
      studentName: "합성학생",
      studentGrade: "3",
      studentClass: "1",
      studentNumber: "97",
      customNameConfirmed: true,
      privacyAgreed: true,
      consentAgreedItems: ["privacy", "terms"],
    });
    createOwned(`users/${teacherUid}`, {
      uid: teacherUid,
      email: teacherEmail,
      role: "teacher",
      name: "W7 합성 교사",
      teacherPortalEnabled: true,
      staffPermissions: ["point_manage", "student_list_read"],
      permissions: { point_manage: true, student_list_read: true },
    });
    createOwned(`semester_classes/${classId}`, {
      classId,
      semesterId: CURRENT_SEMESTER_ID,
      grade: "3",
      classNumber: "1",
      classKey: "3::1",
      displayName: "3학년 1반",
      homeroomTeacherUid: teacherUid,
      status: "ACTIVE",
    });
    createOwned(`semester_enrollments/${enrollmentId}`, {
      enrollmentId,
      semesterId: CURRENT_SEMESTER_ID,
      studentUid,
      classId,
      enrollmentStatus: "ACTIVE",
      provenance: "CURRENT",
      snapshot: {
        displayName: "합성학생",
        studentNumber: "97",
        grade: "3",
        classNumber: "1",
      },
    });
    createOwned(`semester_enrollment_slots/${slotId}`, {
      slotId,
      semesterId: CURRENT_SEMESTER_ID,
      studentUid,
      activeEnrollmentId: enrollmentId,
      status: "ACTIVE",
    });
    if (scopes.archiveMissing) {
      createOwned(`semester_manifests/${ARCHIVE_SEMESTER_ID}`, {
        schemaVersion: 1,
        policyVersion: "w3-v1",
        semesterId: ARCHIVE_SEMESTER_ID,
        schoolYear: 2026,
        term: 1,
        displayName: "2026학년도 1학기 W7 합성 보관 학기",
        startDate: "2026-03-01",
        endDate: "2026-08-31",
        revision: 1,
        status: "ARCHIVED",
        shellState: "ARCHIVE",
        createdAt: now,
        updatedAt: now,
      });
    }
    createOwned(`semester_wis_economies/${ARCHIVE_SEMESTER_ID}`, {
      schemaVersion: 1,
      policyVersion: "w7-v1",
      semesterId: ARCHIVE_SEMESTER_ID,
      revision: 4,
      status: "ARCHIVED",
      displayName: "2026학년도 1학기 위스 보관본",
      currencyName: "위스",
      initialGrantAmount: 300,
      createdBy: teacherUid,
      createdAt: now,
      updatedAt: now,
    });
    createOwned(`semester_wis_accounts/${archiveAccountId}`, {
      schemaVersion: 1,
      policyVersion: "w7-v1",
      accountId: archiveAccountId,
      semesterId: ARCHIVE_SEMESTER_ID,
      economyId: ARCHIVE_SEMESTER_ID,
      studentUid,
      enrollmentId: `archive-${enrollmentId}`,
      classId: "archive-class",
      displayName: "합성학생",
      status: "ARCHIVED",
      revision: 2,
      balance: 777,
      initialGrantLedgerEntryId: archiveLedgerId,
      createdBy: teacherUid,
      createdAt: now,
      updatedAt: now,
    });
    createOwned(`semester_wis_balances/${archiveAccountId}`, {
      accountId: archiveAccountId,
      semesterId: ARCHIVE_SEMESTER_ID,
      studentUid,
      balance: 777,
      revision: 2,
      ledgerRevision: 2,
      status: "ARCHIVED",
      updatedAt: now,
    });
    createOwned(`semester_wis_rankings/${archiveAccountId}`, {
      accountId: archiveAccountId,
      semesterId: ARCHIVE_SEMESTER_ID,
      studentUid,
      displayName: "합성학생",
      balance: 777,
      ledgerRevision: 2,
      status: "ARCHIVED",
      updatedAt: now,
    });
    createOwned(`semester_wis_ledger/${archiveLedgerId}`, {
      schemaVersion: 1,
      policyVersion: "w7-v1",
      ledgerEntryId: archiveLedgerId,
      entryId: archiveLedgerId,
      semesterId: ARCHIVE_SEMESTER_ID,
      economyId: ARCHIVE_SEMESTER_ID,
      accountId: archiveAccountId,
      studentUid,
      type: "GRANT",
      transactionType: "GRANT",
      amount: 777,
      delta: 777,
      direction: "CREDIT",
      sourceId: testRunId,
      reason: "2026-1 보관본 무결성 검증",
      commandId: `archive-${testRunId}`,
      receiptId: `archive-${testRunId}`,
      createdBy: teacherUid,
      createdAt: now,
    });
    await batch.commit();
    const [archiveEconomy, archiveAccount, archiveLedger] = await db.getAll(
      db.doc(`semester_wis_economies/${ARCHIVE_SEMESTER_ID}`),
      db.doc(`semester_wis_accounts/${archiveAccountId}`),
      db.doc(`semester_wis_ledger/${archiveLedgerId}`),
    );
    await db.doc(runPath).set({
      fixtureOwner: FIXTURE_OWNER,
      testRunId,
      projectId,
      status: "READY",
      studentUid,
      teacherUid,
      studentEmail,
      teacherEmail,
      classId,
      enrollmentId,
      currentAccountId,
      archiveAccountId,
      productId,
      inventoryId,
      productName,
      economyDisplayName,
      currentManifestRevision: scopes.currentRevision,
      archiveManifestRevision: scopes.archiveMissing
        ? 1
        : scopes.archiveRevision,
      archiveEconomyHash: documentHash(archiveEconomy.data()),
      archiveAccountHash: documentHash(archiveAccount.data()),
      archiveLedgerHash: documentHash(archiveLedger.data()),
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
    });
    console.log(
      JSON.stringify({
        suite: "w7-staging-fixture-setup",
        passed: true,
        projectId,
        testRunId,
        studentUid,
        teacherUid,
        studentEmail,
        teacherEmail,
        currentManifestRevision: scopes.currentRevision,
        archiveManifestRevision: scopes.archiveMissing
          ? 1
          : scopes.archiveRevision,
        productName,
        economyDisplayName,
        productionAccess: 0,
      }),
    );
  }
} finally {
  await deleteApp(app);
}
