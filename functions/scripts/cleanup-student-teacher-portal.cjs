const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  initializeApp,
  applicationDefault,
  getApps,
} = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

const DEFAULT_PROJECT_ID = "history-quiz-yongsin";
const DEFAULT_SAMPLE_LIMIT = 20;
const FIREBASE_CLI_CLIENT_ID =
  process.env.FIREBASE_CLIENT_ID ||
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const FIREBASE_CLI_CLIENT_SECRET =
  process.env.FIREBASE_CLIENT_SECRET || "j9iVZfS8kkCEFUPaAeJV0sAi";

const getArgValue = (name) => {
  const prefix = `--${name}=`;
  return process.argv
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length);
};

const hasFlag = (name) => process.argv.includes(`--${name}`);

const resolveProjectId = () =>
  getArgValue("project") ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  DEFAULT_PROJECT_ID;

const resolveSampleLimit = () => {
  const raw = Number(getArgValue("sample-limit") || DEFAULT_SAMPLE_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SAMPLE_LIMIT;
};

const resolveFirebaseCliConfigPath = () => {
  if (process.env.FIREBASE_TOOLS_CONFIG_PATH) {
    return process.env.FIREBASE_TOOLS_CONFIG_PATH;
  }

  const candidates = [
    path.join(
      process.env.USERPROFILE || "",
      ".config",
      "configstore",
      "firebase-tools.json",
    ),
    path.join(process.env.APPDATA || "", "configstore", "firebase-tools.json"),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
};

const loadFirebaseCliRefreshToken = () => {
  const configPath = resolveFirebaseCliConfigPath();
  if (!configPath) return null;

  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const refreshToken = raw?.tokens?.refresh_token;
  const email = raw?.user?.email || "";
  if (!refreshToken) return null;

  return {
    configPath,
    email,
    refreshToken,
  };
};

const ensureCredentialSource = () => {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return {
      type: "google-application-credentials",
      path: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      cleanup: () => undefined,
    };
  }

  const cliAuth = loadFirebaseCliRefreshToken();
  if (!cliAuth) {
    throw new Error(
      [
        "No application default credentials were found.",
        "Set GOOGLE_APPLICATION_CREDENTIALS or sign in with `npx firebase-tools login` first.",
      ].join(" "),
    );
  }

  const credentialPath = path.join(
    os.tmpdir(),
    `westory-${(cliAuth.email || "firebase-cli").replace(/[^a-z0-9]+/gi, "_").toLowerCase()}-adc.json`,
  );
  const payload = {
    type: "authorized_user",
    client_id: FIREBASE_CLI_CLIENT_ID,
    client_secret: FIREBASE_CLI_CLIENT_SECRET,
    refresh_token: cliAuth.refreshToken,
  };
  fs.writeFileSync(credentialPath, JSON.stringify(payload, null, 2));
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;

  return {
    type: "firebase-cli-login",
    path: cliAuth.configPath,
    email: cliAuth.email,
    cleanup: () => {
      try {
        fs.unlinkSync(credentialPath);
      } catch (error) {
        if (error && error.code !== "ENOENT") {
          console.warn(
            "[cleanup] Failed to remove temporary ADC file:",
            error.message || error,
          );
        }
      }
    },
  };
};

const summarizeCandidate = (docSnap) => {
  const data = docSnap.data() || {};
  const staffPermissions = Array.isArray(data.staffPermissions)
    ? data.staffPermissions
    : [];
  return {
    id: docSnap.id,
    email: String(data.email || "").trim(),
    name: String(data.name || "").trim(),
    teacherPortalEnabled: Object.prototype.hasOwnProperty.call(
      data,
      "teacherPortalEnabled",
    )
      ? data.teacherPortalEnabled
      : "[missing]",
    staffPermissionsCount: staffPermissions.length,
    role: String(data.role || "").trim() || "[missing]",
  };
};

const scanStudents = async (db, sampleLimit) => {
  const snapshot = await db
    .collection("users")
    .where("role", "==", "student")
    .get();
  const docs = snapshot.docs;
  const candidates = docs.filter(
    (docSnap) => docSnap.get("teacherPortalEnabled") !== false,
  );
  const anomalies = candidates.filter((docSnap) => {
    const value = docSnap.get("staffPermissions");
    return Array.isArray(value) && value.length > 0;
  });

  const breakdown = candidates.reduce(
    (accumulator, docSnap) => {
      const value = docSnap.get("teacherPortalEnabled");
      if (value === true) accumulator.explicitTrue += 1;
      else if (value === null) accumulator.nullValue += 1;
      else if (typeof value === "undefined") accumulator.missing += 1;
      else accumulator.other += 1;
      return accumulator;
    },
    {
      explicitTrue: 0,
      nullValue: 0,
      missing: 0,
      other: 0,
    },
  );

  return {
    totalStudentsScanned: docs.length,
    candidateCount: candidates.length,
    anomalyCount: anomalies.length,
    breakdown,
    sample: candidates.slice(0, sampleLimit).map(summarizeCandidate),
    candidates,
  };
};

const applyCleanup = async (db, candidates) => {
  if (!candidates.length) return 0;

  const writer = db.bulkWriter();
  let writeCount = 0;
  writer.onWriteError((error) => {
    console.error(
      "[cleanup] Write failed:",
      error.documentRef?.path || "[unknown]",
      error.message,
    );
    return false;
  });

  for (const docSnap of candidates) {
    writeCount += 1;
    writer.update(docSnap.ref, {
      teacherPortalEnabled: false,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await writer.close();
  return writeCount;
};

const main = async () => {
  const apply = hasFlag("apply");
  const projectId = resolveProjectId();
  const sampleLimit = resolveSampleLimit();
  const credentialSource = ensureCredentialSource();

  try {
    if (!getApps().length) {
      initializeApp({
        credential: applicationDefault(),
        projectId,
      });
    }

    const db = getFirestore();
    const initial = await scanStudents(db, sampleLimit);
    const baseSummary = {
      mode: apply ? "apply" : "dry-run",
      projectId,
      credentialSource: credentialSource.type,
      credentialEmail: credentialSource.email || "",
      totalStudentsScanned: initial.totalStudentsScanned,
      candidateCount: initial.candidateCount,
      anomalyCount: initial.anomalyCount,
      breakdown: initial.breakdown,
      sample: initial.sample,
    };

    if (!apply) {
      console.log(JSON.stringify(baseSummary, null, 2));
      return;
    }

    const updatedCount = await applyCleanup(db, initial.candidates);
    const verification = await scanStudents(db, sampleLimit);
    const finalSummary = {
      ...baseSummary,
      updatedCount,
      remainingCandidateCount: verification.candidateCount,
      remainingSample: verification.sample,
    };

    console.log(JSON.stringify(finalSummary, null, 2));

    if (verification.candidateCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    credentialSource.cleanup();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
