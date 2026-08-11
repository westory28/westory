import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from "firebase/auth";
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import { getBytes, ref, uploadBytes } from "firebase/storage";

const projectId = "demo-westory-maintenance";
const firestoreRules = readFileSync(resolve("firestore.rules"), "utf8");
const storageRules = readFileSync(resolve("storage.rules"), "utf8");
const authHost = "http://127.0.0.1:9099";
const firestoreHost = "127.0.0.1";
const firestorePort = 8080;
const functionsHost = "127.0.0.1";
const functionsPort = 5001;
const storageHost = "127.0.0.1";
const storagePort = 9199;
const bucketUrl = `gs://${projectId}.appspot.com`;
const includeFunctions = process.argv.includes("--include-functions");
const browserSeed = process.argv.includes("--browser-seed");
const storageWriteBytes = new TextEncoder().encode(
  "%PDF-1.4\n% maintenance emulator probe\n%%EOF\n",
);
const storageWriteMetadata = { contentType: "application/pdf" };

const firebaseConfig = {
  apiKey: "demo-api-key",
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
  storageBucket: `${projectId}.appspot.com`,
};

const apps = [];
const checks = [];

const userSpecs = {
  student: {
    email: "maintenance.student@yongshin-ms.ms.kr",
    role: "student",
  },
  teacher: {
    email: "maintenance.teacher@yongshin-ms.ms.kr",
    role: "teacher",
  },
  admin: {
    email: "westoria28@gmail.com",
    role: "admin",
  },
  bypass: {
    email: "maintenance.bypass@yongshin-ms.ms.kr",
    role: "student",
  },
  missingProfile: {
    email: "maintenance.missing@yongshin-ms.ms.kr",
    role: null,
  },
  malformedRole: {
    email: "maintenance.malformed@yongshin-ms.ms.kr",
    role: { malformed: true },
  },
};

const createAuthClient = async (key, spec) => {
  const app = initializeApp(firebaseConfig, `maintenance-${key}`);
  apps.push(app);

  const auth = getAuth(app);
  connectAuthEmulator(auth, authHost, { disableWarnings: true });
  const credential = await createUserWithEmailAndPassword(
    auth,
    spec.email,
    "Maintenance!123",
  );

  const functions = getFunctions(app, "asia-northeast3");
  connectFunctionsEmulator(functions, functionsHost, functionsPort);

  return {
    ...spec,
    uid: credential.user.uid,
    functions,
  };
};

const createAnonymousFunctionsClient = () => {
  const app = initializeApp(firebaseConfig, "maintenance-anonymous");
  apps.push(app);
  const functions = getFunctions(app, "asia-northeast3");
  connectFunctionsEmulator(functions, functionsHost, functionsPort);
  return { functions };
};

const profilePayload = (user) => ({
  uid: user.uid,
  email: user.email,
  role: user.role,
  name: `Maintenance ${user.role}`,
  grade: user.role === "student" ? "2" : "",
  class: user.role === "student" ? "6" : "",
  number: user.role === "student" ? "10" : "",
  staffPermissions: [],
  teacherPortalEnabled: false,
});

const maintenancePayload = (enabled, bypassUid, revision) => ({
  enabled,
  blockedRoles: ["student"],
  bypassUids: [bypassUid],
  title: "위스토리 2학기 준비 중",
  message:
    "새 학기를 위한 시스템 점검과 서비스 개편이 진행 중입니다.\n학생 서비스는 점검이 완료될 때까지 잠시 이용할 수 없습니다.\n더 안정적이고 편리한 위스토리로 다시 만나겠습니다.",
  startedAt: enabled
    ? Timestamp.fromDate(new Date("2026-08-11T00:00:00.000Z"))
    : null,
  updatedAt: Timestamp.fromDate(new Date(`2026-08-11T00:00:0${revision}.000Z`)),
  updatedBy: "maintenance-emulator-test",
  revision,
});

const attendancePayload = (uid) => ({
  uid,
  scope: "2026-2",
  year: "2026",
  semester: "2",
  date: "2026-08-11",
  checkedAt: "maintenance-emulator-test",
});

const succeeds = async (label, operation) => {
  await assertSucceeds(operation);
  checks.push(label);
};

const fails = async (label, operation) => {
  await assertFails(operation);
  checks.push(label);
};

const callPrintClientInfo = (client) =>
  httpsCallable(client.functions, "getPrintClientInfo")({});

const callUpdateMaintenanceConfig = (client, data) =>
  httpsCallable(client.functions, "updateStudentMaintenanceConfig")(data);

const callableSucceeds = async (label, client) => {
  const response = await callPrintClientInfo(client);
  if (typeof response.data?.maskedIp !== "string") {
    throw new Error(`${label}: callable response did not include maskedIp.`);
  }
  checks.push(label);
};

const callableFails = async (label, client, expectedCode) => {
  try {
    await callPrintClientInfo(client);
  } catch (error) {
    if (error?.code === expectedCode) {
      checks.push(label);
      return;
    }
    throw new Error(
      `${label}: expected ${expectedCode}, received ${error?.code || error}.`,
      { cause: error },
    );
  }
  throw new Error(`${label}: callable unexpectedly succeeded.`);
};

const main = async () => {
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: firestoreHost,
      port: firestorePort,
      rules: firestoreRules,
    },
    storage: {
      host: storageHost,
      port: storagePort,
      rules: storageRules,
    },
  });

  try {
    await Promise.all([testEnv.clearFirestore(), testEnv.clearStorage()]);

    const users = Object.fromEntries(
      await Promise.all(
        Object.entries(userSpecs).map(async ([key, spec]) => [
          key,
          await createAuthClient(key, spec),
        ]),
      ),
    );
    const anonymousFunctions = createAnonymousFunctionsClient();

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      const adminStorage = context.storage(bucketUrl);

      for (const user of Object.values(users)) {
        if (user.role !== null) {
          await setDoc(doc(adminDb, "users", user.uid), profilePayload(user));
        }
      }

      await setDoc(doc(adminDb, "lessons", "maintenance-probe"), {
        title: "Maintenance emulator probe",
      });
      await setDoc(
        doc(adminDb, "site_settings", "student_maintenance"),
        maintenancePayload(true, users.bypass.uid, 1),
      );
      await uploadBytes(
        ref(adminStorage, "lesson_pdfs/maintenance-probe/probe.txt"),
        new TextEncoder().encode("maintenance-emulator-probe"),
        { contentType: "text/plain" },
      );
    });

    if (browserSeed) {
      console.log(
        JSON.stringify(
          {
            projectId,
            password: "Maintenance!123",
            users: Object.fromEntries(
              Object.entries(users).map(([key, user]) => [
                key,
                { uid: user.uid, email: user.email, role: user.role },
              ]),
            ),
            maintenanceEnabled: true,
          },
          null,
          2,
        ),
      );
      return;
    }

    const clients = Object.fromEntries(
      Object.entries(users).map(([key, user]) => {
        const context = testEnv.authenticatedContext(user.uid, {
          email: user.email,
          email_verified: true,
        });
        return [
          key,
          {
            db: context.firestore(),
            storage: context.storage(bucketUrl),
          },
        ];
      }),
    );
    const anonymousContext = testEnv.unauthenticatedContext();
    const anonymous = {
      db: anonymousContext.firestore(),
      storage: anonymousContext.storage(bucketUrl),
    };

    const lessonRef = (client) =>
      doc(client.db, "lessons", "maintenance-probe");
    const maintenanceRef = (client) =>
      doc(client.db, "site_settings", "student_maintenance");
    const ownUserRef = (key) => doc(clients[key].db, "users", users[key].uid);
    const storageProbe = (client) =>
      ref(client.storage, "lesson_pdfs/maintenance-probe/probe.txt");
    const storageWriteProbe = (client, key) =>
      ref(client.storage, `lesson_pdfs/maintenance-${key}-write/probe.txt`);

    // Enabled: students and unknown roles are fenced from representative data.
    await fails(
      "enabled student Firestore document read is denied",
      getDoc(lessonRef(clients.student)),
    );
    await fails(
      "enabled student Firestore collection read is denied",
      getDocs(collection(clients.student.db, "lessons")),
    );
    await fails(
      "enabled student existing Firestore write is denied",
      setDoc(
        doc(
          clients.student.db,
          "users",
          users.student.uid,
          "attendance",
          "maintenance-probe",
        ),
        attendancePayload(users.student.uid),
      ),
    );
    await succeeds(
      "enabled student can read own user document",
      getDoc(ownUserRef("student")),
    );
    await succeeds(
      "enabled student can read maintenance config",
      getDoc(maintenanceRef(clients.student)),
    );

    for (const key of ["missingProfile", "malformedRole"]) {
      await fails(
        `enabled ${key} Firestore read is denied`,
        getDoc(lessonRef(clients[key])),
      );
      await succeeds(
        `enabled ${key} can read own user document`,
        getDoc(ownUserRef(key)),
      );
      await succeeds(
        `enabled ${key} can read maintenance config`,
        getDoc(maintenanceRef(clients[key])),
      );
    }

    for (const key of ["teacher", "admin", "bypass"]) {
      await succeeds(
        `enabled ${key} representative Firestore read remains allowed`,
        getDoc(lessonRef(clients[key])),
      );
    }
    await succeeds(
      "enabled teacher patch-note collection read remains within rules limits",
      getDocs(
        collection(
          clients.teacher.db,
          "teacherPatchNotes",
          users.teacher.uid,
          "notes",
        ),
      ),
    );
    await succeeds(
      "enabled bypass student existing Firestore write remains allowed",
      setDoc(
        doc(
          clients.bypass.db,
          "users",
          users.bypass.uid,
          "attendance",
          "maintenance-probe",
        ),
        attendancePayload(users.bypass.uid),
      ),
    );

    for (const key of ["student", "teacher", "admin", "bypass"]) {
      await fails(
        `enabled ${key} cannot write maintenance config from a client`,
        updateDoc(maintenanceRef(clients[key]), {
          message: `unauthorized-${key}`,
        }),
      );
    }

    await fails(
      "enabled anonymous Firestore read remains denied",
      getDoc(lessonRef(anonymous)),
    );
    await fails(
      "enabled anonymous maintenance config read remains denied",
      getDoc(maintenanceRef(anonymous)),
    );

    await fails(
      "enabled student Storage read is denied",
      getBytes(storageProbe(clients.student)),
    );
    await fails(
      "enabled student Storage write is denied",
      uploadBytes(
        storageWriteProbe(clients.student, "student"),
        storageWriteBytes,
        storageWriteMetadata,
      ),
    );
    for (const key of ["missingProfile", "malformedRole"]) {
      await fails(
        `enabled ${key} Storage read is denied`,
        getBytes(storageProbe(clients[key])),
      );
    }
    for (const key of ["teacher", "admin", "bypass"]) {
      await succeeds(
        `enabled ${key} representative Storage read remains allowed`,
        getBytes(storageProbe(clients[key])),
      );
    }
    await succeeds(
      "enabled admin existing Storage write remains allowed",
      uploadBytes(
        storageWriteProbe(clients.admin, "admin"),
        storageWriteBytes,
        storageWriteMetadata,
      ),
    );
    await fails(
      "enabled anonymous Storage read remains denied",
      getBytes(storageProbe(anonymous)),
    );

    if (includeFunctions) {
      await callableFails(
        "enabled student callable is denied",
        users.student,
        "functions/permission-denied",
      );
      await callableFails(
        "enabled missing profile callable is denied",
        users.missingProfile,
        "functions/permission-denied",
      );
      await callableFails(
        "enabled malformed role callable is denied",
        users.malformedRole,
        "functions/permission-denied",
      );
      for (const key of ["teacher", "admin", "bypass"]) {
        await callableSucceeds(
          `enabled ${key} callable remains allowed`,
          users[key],
        );
      }
      await callableFails(
        "enabled anonymous callable remains denied",
        anonymousFunctions,
        "functions/unauthenticated",
      );
    }

    // Disabled: the maintenance fence disappears while the baseline rules remain.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "site_settings", "student_maintenance"),
        maintenancePayload(false, users.bypass.uid, 2),
      );
    });

    await succeeds(
      "disabled student Firestore document read is restored",
      getDoc(lessonRef(clients.student)),
    );
    await succeeds(
      "disabled student Firestore collection read is restored",
      getDocs(collection(clients.student.db, "lessons")),
    );
    await succeeds(
      "disabled student existing Firestore write is restored",
      setDoc(
        doc(
          clients.student.db,
          "users",
          users.student.uid,
          "attendance",
          "maintenance-probe",
        ),
        attendancePayload(users.student.uid),
      ),
    );
    for (const key of ["missingProfile", "malformedRole"]) {
      await succeeds(
        `disabled ${key} representative Firestore read is restored`,
        getDoc(lessonRef(clients[key])),
      );
    }
    await succeeds(
      "disabled student Storage read is restored",
      getBytes(storageProbe(clients.student)),
    );
    for (const key of ["missingProfile", "malformedRole"]) {
      await succeeds(
        `disabled ${key} representative Storage read is restored`,
        getBytes(storageProbe(clients[key])),
      );
    }
    await fails(
      "disabled student Storage write remains denied by baseline rules",
      uploadBytes(
        storageWriteProbe(clients.student, "student-disabled"),
        storageWriteBytes,
        storageWriteMetadata,
      ),
    );
    await fails(
      "disabled admin still cannot write maintenance config from a client",
      updateDoc(maintenanceRef(clients.admin), {
        message: "unauthorized-admin-disabled",
      }),
    );
    await fails(
      "disabled anonymous Firestore read remains denied",
      getDoc(lessonRef(anonymous)),
    );
    await fails(
      "disabled anonymous Storage read remains denied",
      getBytes(storageProbe(anonymous)),
    );

    if (includeFunctions) {
      for (const key of ["student", "missingProfile", "malformedRole"]) {
        await callableSucceeds(
          `disabled ${key} callable access is restored`,
          users[key],
        );
      }
    }

    // Missing config is the rollout-safe default: the fence is disabled.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(
        doc(context.firestore(), "site_settings", "student_maintenance"),
      );
    });
    await succeeds(
      "missing config keeps baseline Firestore access enabled",
      getDoc(lessonRef(clients.student)),
    );
    await succeeds(
      "missing config keeps baseline Storage access enabled",
      getBytes(storageProbe(clients.student)),
    );
    if (includeFunctions) {
      await callableSucceeds(
        "missing config keeps baseline callable access enabled",
        users.student,
      );
    }

    // Extra fields fail closed consistently across client/server/rules schema readers.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "site_settings", "student_maintenance"),
        {
          ...maintenancePayload(false, users.bypass.uid, 3),
          unexpectedField: true,
        },
      );
    });
    await fails(
      "extra-key config fails closed for representative Firestore access",
      getDoc(lessonRef(clients.teacher)),
    );
    await fails(
      "extra-key config fails closed for representative Storage access",
      getBytes(storageProbe(clients.teacher)),
    );
    if (includeFunctions) {
      await callableFails(
        "extra-key config fails closed for callable access",
        users.teacher,
        "functions/unavailable",
      );
    }

    // A malformed existing config fails closed, but the admin callable can recover it.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "site_settings", "student_maintenance"),
        {
          enabled: false,
          blockedRoles: ["student"],
          bypassUids: [],
        },
      );
    });
    await fails(
      "malformed config fails closed for representative Firestore access",
      getDoc(lessonRef(clients.teacher)),
    );
    await fails(
      "malformed config fails closed for representative Storage access",
      getBytes(storageProbe(clients.teacher)),
    );
    if (includeFunctions) {
      await callableFails(
        "malformed config fails closed for callable access",
        users.teacher,
        "functions/unavailable",
      );
      const repairResponse = await callUpdateMaintenanceConfig(users.admin, {
        enabled: false,
        blockedRoles: ["student"],
        bypassUids: [users.bypass.uid],
        title: "위스토리 2학기 준비 중",
        message:
          "새 학기를 위한 시스템 점검과 서비스 개편이 진행 중입니다.\n학생 서비스는 점검이 완료될 때까지 잠시 이용할 수 없습니다.\n더 안정적이고 편리한 위스토리로 다시 만나겠습니다.",
      });
      if (repairResponse.data?.enabled !== false) {
        throw new Error("Admin recovery callable did not save disabled state.");
      }
      checks.push("admin callable recovers malformed maintenance config");

      const auditSnapshot = await assertSucceeds(
        getDocs(
          collection(
            clients.admin.db,
            "site_settings",
            "student_maintenance",
            "audit",
          ),
        ),
      );
      if (auditSnapshot.empty) {
        throw new Error("Maintenance audit record was not created.");
      }
      checks.push("admin maintenance update creates a readable audit record");
      await succeeds(
        "recovered disabled config restores baseline Firestore access",
        getDoc(lessonRef(clients.student)),
      );
    }

    console.log(
      JSON.stringify(
        {
          projectId,
          includeFunctions,
          checks,
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.allSettled(apps.map((app) => deleteApp(app)));
    await testEnv.cleanup();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
