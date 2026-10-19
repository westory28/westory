const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { initializeApp, applicationDefault, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { createStudentProfileEmojiReconciliationService } = require("../studentProfileEmojiReconciliation");

const DEFAULT_PROJECT_ID = "history-quiz-yongsin";
const FIREBASE_CLI_CLIENT_ID = process.env.FIREBASE_CLIENT_ID ||
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const FIREBASE_CLI_CLIENT_SECRET = process.env.FIREBASE_CLIENT_SECRET || "j9iVZfS8kkCEFUPaAeJV0sAi";

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
    `westory-profile-emoji-${randomUUID()}-adc.json`,
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

// Inspect and apply use the same current-semester transaction as the live guards.
// No legacy wallet, balance, enrollment, ranking or policy is ever modified here.
const mapBounded = async (items, action, width = 8) => {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await action(items[index]);
    }
  }));
  return results;
};
const summarize = (results) => ({
  scannedCount: results.length,
  affectedCount: results.filter(item => item.status === "updated").length,
  validCount: results.filter(item => item.status === "valid").length,
  skippedCount: results.filter(item => item.status === "skipped").length,
  reasons: results.reduce((totals, item) => {
    const reason = item.reason || item.status;
    totals[reason] = (totals[reason] || 0) + 1;
    return totals;
  }, {}),
});

const main = async () => {
  const apply = hasFlag("apply");
  const projectId = resolveProjectId();
  const credentialSource = ensureCredentialSource();
  try {
    if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId });
    const db = getFirestore();
    const pointer = (await db.doc("site_settings/semester_active").get()).data();
    if (!/^\d{4}-[12]$/.test(pointer?.semesterId || "")) {
      throw new Error("An authoritative active semester is required; legacy fallback is forbidden.");
    }
    const [year, semester] = pointer.semesterId.split("-");
    if ((getArgValue("year") && getArgValue("year") !== year) ||
        (getArgValue("semester") && getArgValue("semester") !== semester)) {
      throw new Error("Only the current active semester may reset global student profiles.");
    }
    const manifest = (await db.doc(`semester_manifests/${pointer.semesterId}`).get()).data();
    if (manifest?.status !== "ACTIVE" || manifest.readOnly === true ||
        manifest.revision !== pointer.revision) throw new Error("Active semester is not ready.");
    const service = createStudentProfileEmojiReconciliationService({ db });
    const users = await db.collection("users").where("role", "==", "student").get();
    const inspect = () => mapBounded(users.docs, doc => service.inspectStudent(doc.id,
      { expectedSemesterId: pointer.semesterId }));
    const initial = await inspect();
    const affected = initial.filter(item => item.status === "updated");
    const base = { mode: apply ? "apply" : "dry-run", projectId,
      semesterId: pointer.semesterId, ...summarize(initial) };
    if (!apply) {
      console.log(JSON.stringify(base, null, 2));
      return;
    }
    const backupPath = path.resolve(getArgValue("backup") || path.join(os.tmpdir(),
      `westory-profile-emoji-backup-${Date.now()}-${randomUUID()}.json`));
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, JSON.stringify({ createdAt: new Date().toISOString(),
      projectId, semesterId: pointer.semesterId, profiles: affected }, null, 2), { flag: "wx", mode: 0o600 });
    const applied = await mapBounded(affected, item => service.reconcileStudent(item.uid,
      { apply: true, expectedBefore: item.before, expectedSemesterId: pointer.semesterId }));
    const verification = await inspect();
    const currentPointer = (await db.doc("site_settings/semester_active").get()).data();
    if (currentPointer?.semesterId !== pointer.semesterId || currentPointer?.revision !== pointer.revision)
      throw new Error("The active semester changed during correction. Inspect again.");
    const remaining = summarize(verification);
    console.log(JSON.stringify({ ...base, backupPath,
      updatedCount: applied.filter(item => item.status === "updated" && item.applied).length,
      remainingAffectedCount: remaining.affectedCount,
      skippedDuringApplyCount: applied.filter(item => item.status === "skipped").length,
      verification: remaining }, null, 2));
    if (remaining.affectedCount > 0) process.exitCode = 1;
  } finally {
    credentialSource.cleanup();
  }
};
if (require.main === module) main().catch(error => {
  console.error("[emoji-fix] Failed:", error.message || error);
  process.exitCode = 1;
});
module.exports = { main, summarize, mapBounded };
