import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

const projectId =
  process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w2a";
const adminUid = "w2a-admin";
const adminEmail = "westoria28@gmail.com";
const authTime = Math.floor(Date.now() / 1000) - 10;
const rules = readFileSync(resolve("firestore.rules"), "utf8");

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules,
  },
});

try {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(
      doc(db, "application_sessions", adminUid, "sessions", String(authTime)),
      {
        uid: adminUid,
        email: adminEmail,
        authTime,
        status: "active",
        schemaVersion: 2,
        authorityGeneration: "w1r2-2026-08-09",
        protocolVersion: 2,
        sessionRevision: "b".repeat(64),
        authorityModeAtOpen: "ENFORCE",
        generalExpiresAt: Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
        highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
      },
    );
    await setDoc(doc(db, "site_settings", "terms"), { text: "기존 약관" });
    await setDoc(doc(db, "site_settings", "consent"), {
      updatedAt: Timestamp.now(),
    });
    await setDoc(doc(db, "command_receipts", "existing-receipt"), {
      status: "SUCCEEDED",
    });
    await setDoc(doc(db, "command_audit_events", "existing-audit"), {
      eventType: "COMMAND_SUCCEEDED",
    });
    await setDoc(
      doc(db, "site_settings", "consent", "items", "existing-item"),
      {
        title: "기존 항목",
        text: "기존 내용",
        required: true,
        order: 1,
      },
    );
    await setDoc(
      doc(db, "years", "2026", "semesters", "2", "point_wallets", "student-1"),
      { uid: "student-1", balance: 10 },
    );
    await setDoc(
      doc(
        db,
        "years",
        "2026",
        "semesters",
        "2",
        "point_transactions",
        "existing-transaction",
      ),
      { uid: "student-1", delta: 10, balanceAfter: 10 },
    );
    await setDoc(
      doc(
        db,
        "years",
        "2026",
        "semesters",
        "2",
        "calendar",
        "holiday-existing",
      ),
      {
        title: "기존 공휴일",
        start: "2026-10-03",
        eventType: "holiday",
        targetType: "common",
      },
    );
  });

  const adminDb = testEnv
    .authenticatedContext(adminUid, {
      email: adminEmail,
      auth_time: authTime,
    })
    .firestore();

  await assertFails(
    setDoc(doc(adminDb, "site_settings", "terms"), { text: "직접 변경" }),
  );
  await assertFails(deleteDoc(doc(adminDb, "site_settings", "terms")));
  await assertFails(
    setDoc(
      doc(adminDb, "site_settings", "consent"),
      { updatedAt: Timestamp.now() },
      { merge: true },
    ),
  );
  await assertFails(deleteDoc(doc(adminDb, "site_settings", "consent")));
  await assertFails(
    setDoc(
      doc(adminDb, "site_settings", "consent", "items", "direct-create"),
      {
        title: "직접 생성",
        text: "차단",
        required: true,
        order: 2,
      },
    ),
  );
  await assertFails(
    setDoc(
      doc(
        adminDb,
        "site_settings",
        "consent",
        "deleted_items",
        "direct-tombstone",
      ),
      { itemId: "direct-tombstone" },
    ),
  );
  await assertFails(
    setDoc(doc(adminDb, "command_receipts", "direct-receipt"), {
      status: "SUCCEEDED",
    }),
  );
  await assertFails(
    setDoc(doc(adminDb, "command_audit_events", "direct-audit"), {
      event: "COMMAND_SUCCEEDED",
    }),
  );
  await assertFails(
    getDoc(doc(adminDb, "command_receipts", "direct-receipt")),
  );
  await assertFails(
    getDoc(doc(adminDb, "command_audit_events", "direct-audit")),
  );
  const existingReceiptRef = doc(
    adminDb,
    "command_receipts",
    "existing-receipt",
  );
  const existingAuditRef = doc(
    adminDb,
    "command_audit_events",
    "existing-audit",
  );
  await assertFails(getDoc(existingReceiptRef));
  await assertFails(updateDoc(existingReceiptRef, { status: "FAILED" }));
  await assertFails(deleteDoc(existingReceiptRef));
  await assertFails(getDoc(existingAuditRef));
  await assertFails(updateDoc(existingAuditRef, { eventType: "CHANGED" }));
  await assertFails(deleteDoc(existingAuditRef));

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await deleteDoc(doc(db, "site_settings", "terms"));
    await deleteDoc(doc(db, "site_settings", "consent"));
  });
  await assertFails(
    setDoc(doc(adminDb, "site_settings", "terms"), { text: "직접 생성" }),
  );
  await assertFails(
    setDoc(doc(adminDb, "site_settings", "consent"), {
      updatedAt: Timestamp.now(),
    }),
  );

  const existingConsentRef = doc(
    adminDb,
    "site_settings",
    "consent",
    "items",
    "existing-item",
  );
  await assertFails(updateDoc(existingConsentRef, { title: "직접 수정" }));
  await assertFails(deleteDoc(existingConsentRef));
  await assertSucceeds(
    setDoc(doc(adminDb, "site_settings", "privacy"), { text: "기존 경로" }),
  );

  const pointWalletRef = doc(
    adminDb,
    "years",
    "2026",
    "semesters",
    "2",
    "point_wallets",
    "student-1",
  );
  const pointTransactionRef = doc(
    adminDb,
    "years",
    "2026",
    "semesters",
    "2",
    "point_transactions",
    "existing-transaction",
  );
  await assertFails(updateDoc(pointWalletRef, { balance: 20 }));
  await assertFails(deleteDoc(pointWalletRef));
  await assertFails(updateDoc(pointTransactionRef, { delta: 20 }));
  await assertFails(deleteDoc(pointTransactionRef));
  await assertFails(
    setDoc(
      doc(
        adminDb,
        "years",
        "2026",
        "semesters",
        "2",
        "point_transactions",
        "direct-transaction",
      ),
      { uid: "student-1", delta: 1, balanceAfter: 11 },
    ),
  );

  const calendarPath = ["years", "2026", "semesters", "2", "calendar"];
  await assertFails(
    setDoc(doc(adminDb, ...calendarPath, "holiday-direct"), {
      title: "직접 공휴일",
      start: "2026-12-25",
      eventType: "holiday",
      targetType: "common",
    }),
  );
  const existingHolidayRef = doc(
    adminDb,
    ...calendarPath,
    "holiday-existing",
  );
  await assertFails(updateDoc(existingHolidayRef, { title: "직접 수정" }));
  await assertFails(deleteDoc(existingHolidayRef));

  const ordinaryEventRef = doc(adminDb, ...calendarPath, "ordinary-event");
  await assertSucceeds(
    setDoc(ordinaryEventRef, {
      title: "일반 일정",
      start: "2026-09-01",
      eventType: "event",
      targetType: "common",
    }),
  );
  await assertSucceeds(updateDoc(ordinaryEventRef, { title: "일반 일정 수정" }));
  await assertFails(updateDoc(ordinaryEventRef, { eventType: "holiday" }));
  await assertSucceeds(deleteDoc(ordinaryEventRef));

  const legacyEventRef = doc(adminDb, ...calendarPath, "legacy-event");
  await assertSucceeds(
    setDoc(legacyEventRef, {
      title: "유형 필드가 없는 기존 일정",
      start: "2026-09-02",
      targetType: "common",
    }),
  );
  await assertSucceeds(updateDoc(legacyEventRef, { title: "기존 일정 수정" }));
  await assertSucceeds(deleteDoc(legacyEventRef));

  console.log(
    JSON.stringify({
      suite: "w2a-command-gateway-rules",
      passed: true,
      cases: [
        "DIRECT_TERMS_CREATE_UPDATE_DELETE_DENIED",
        "DIRECT_CONSENT_ROOT_CREATE_UPDATE_DELETE_DENIED",
        "DIRECT_CONSENT_CREATE_UPDATE_DELETE_TOMBSTONE_DENIED",
        "DIRECT_RECEIPT_AND_AUDIT_CREATE_GET_UPDATE_DELETE_DENIED",
        "DIRECT_POINT_WALLET_AND_LEDGER_WRITE_DENIED",
        "UNMIGRATED_SETTINGS_WRITE_RETAINED",
        "DIRECT_HOLIDAY_CREATE_UPDATE_DELETE_DENIED",
        "ORDINARY_CALENDAR_CRUD_RETAINED",
        "LEGACY_CALENDAR_CRUD_RETAINED",
        "ORDINARY_TO_HOLIDAY_UPDATE_DENIED",
      ],
    }),
  );
} finally {
  await testEnv.cleanup();
}
