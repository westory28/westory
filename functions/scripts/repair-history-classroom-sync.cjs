const { execFileSync } = require("node:child_process");
const { Firestore, Timestamp } = require("@google-cloud/firestore");
const { OAuth2Client } = require("google-auth-library");
const { createFirestoreStore } = require("../productionGateway/commandGateway");
const { timestampMs } = require("../productionGateway/historyClassroomSync");

const MAX_ROWS = 500;
const parseArgs = args => {
  const options = { project: "history-quiz-yongsin", apply: false, semesterId: "", assignmentIds: [], notifySince: "" };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--apply") { options.apply = true; continue; }
    if (argument === "--help") { options.help = true; continue; }
    const [key, inline] = argument.split("=", 2);
    if (!["--project", "--semester-id", "--assignment-id", "--notify-since"].includes(key)) throw new Error("Unsupported repair argument.");
    const value = inline === undefined ? args[++index] : inline;
    if (!value || value.startsWith("--")) throw new Error("A repair argument value is required.");
    if (key === "--assignment-id") options.assignmentIds.push(value);
    else options[{ "--project": "project", "--semester-id": "semesterId", "--notify-since": "notifySince" }[key]] = value;
  }
  options.assignmentIds = [...new Set(options.assignmentIds)];
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(options.project)) throw new Error("Invalid project.");
  if (options.semesterId && !/^\d{4}-[12]$/.test(options.semesterId)) throw new Error("Invalid semester.");
  if (!options.help && (!options.assignmentIds.length || options.assignmentIds.length > 20 ||
    options.assignmentIds.some(id => id.length > 180 || /[\/\\\u0000-\u001f]/u.test(id))))
    throw new Error("Specify 1 to 20 explicit assignment IDs.");
  if (options.notifySince && (!Number.isFinite(Date.parse(options.notifySince)) || !/Z$/.test(options.notifySince)))
    throw new Error("The notification cutoff must be a UTC ISO date.");
  return options;
};
const rootFor = semesterId => {
  const [year, semester] = semesterId.split("-");
  return `years/${year}/semesters/${semester}`;
};
const bounded = rows => {
  if (rows.length > MAX_ROWS) throw new Error("Repair exceeds its per-assignment bound.");
  return rows;
};
const eventTime = (result, attempt) => timestampMs(result?.submittedAtIso || result?.createdAt || attempt?.lockedAtIso || attempt?.updatedAt);

// Rebuilds read models and missing inbox events only. Canonical attempts,
// submissions, scores, rewards, reset markers and request/ticket state are never
// written. Every job rechecks the ACTIVE pointer and its exact source records.
const runRepair = async ({ db, options, createSync }) => {
  const store = createFirestoreStore(db);
  const pointer = await db.doc("site_settings/semester_active").get();
  const semesterId = options.semesterId || pointer.data()?.semesterId;
  if (!/^\d{4}-[12]$/.test(semesterId || "") || semesterId !== pointer.data()?.semesterId)
    throw new Error("Only the canonical current semester can be repaired.");
  const root = rootFor(semesterId), sinceMs = options.notifySince ? Date.parse(options.notifySince) : Infinity;
  const summaries = [];
  const countResult = (summary, result) => {
    summary.projections += Number(result.projectionMissing === true);
    summary.notifications += result.refs.filter(path => path.includes("/notification_inboxes/")).length;
  };
  for (const assignmentId of options.assignmentIds) {
    const definitionId = `history_classroom:${semesterId}:${assignmentId}`;
    const [results, attempts, requests] = await Promise.all([
      store.query("semester_assessment_results", { field: "definitionId", operator: "==", value: definitionId, limit: MAX_ROWS + 1 }),
      store.query("semester_assessment_attempts", { field: "definitionId", operator: "==", value: definitionId, limit: MAX_ROWS + 1 }),
      store.query(`${root}/history_classroom_exemption_requests`, { field: "assignmentId", operator: "==", value: assignmentId, limit: MAX_ROWS + 1 }),
    ]);
    [results, attempts, requests].forEach(bounded);
    const summary = { assignmentId, canonicalResults: results.length, lockedAttempts: 0, pendingRequests: 0,
      projections: 0, notifications: 0, unknownOutcomes: 0, skipped: 0 };
    const jobs = [
      ...results.filter(row => row.data?.assessmentKind === "HISTORY_CLASSROOM" && row.data?.completionSource !== "exemption")
        .map(row => ({ kind: "result", path: row.path, attemptId: row.data.attemptId || row.path.split("/").at(-1) })),
      ...attempts.filter(row => row.data?.status === "LOCKED" && !row.data.resetAt && ["VISIBILITY_HIDDEN", "NAVIGATION"].includes(row.data.lockReason))
        .map(row => ({ kind: "lock", path: row.path })),
      ...requests.filter(row => ["pending", "requested"].includes(row.data?.status))
        .map(row => ({ kind: "request", path: row.path })),
    ];
    for (const job of jobs) {
      const outcome = await store.runTransaction(async transaction => {
        const [active, manifest, definition, source, current] = await transaction.getAll([
          "site_settings/semester_active", `semester_manifests/${semesterId}`, `semester_assessment_definitions/${definitionId}`,
          `${root}/history_classrooms/${assignmentId}`, job.path,
        ]);
        if (active.data?.semesterId !== semesterId || manifest.data?.status !== "ACTIVE" ||
          Number(active.data?.revision || 0) !== Number(manifest.data?.revision || 0)) throw new Error("The active semester changed during repair.");
        if (!definition.exists || definition.data.semesterId !== semesterId || definition.data.assessmentKind !== "HISTORY_CLASSROOM" ||
          definition.data.sourceId !== assignmentId || !source.exists || source.data.deletedAt || !current.exists) return null;
        const timestamp = Timestamp.now();
        if (job.kind === "request") {
          const request = current.data;
          if (!["pending", "requested"].includes(request.status) || request.assignmentId !== assignmentId ||
            (request.semesterId && request.semesterId !== semesterId) || timestampMs(request.requestedAt || request.createdAt) < sinceMs) return null;
          const ticket = await transaction.get(`${root}/history_classroom_exemptions/${request.exemptionId}`);
          if (!ticket.exists || (ticket.data.uid || ticket.data.studentUid) !== request.uid ||
            (ticket.data.pendingRequestId || ticket.data.exemptionRequestId) !== job.path.split("/").at(-1)) return null;
          const plan = await createSync().prepareExemptions({ transaction, semesterId, kind: "requested", actorUid: request.uid, timestamp,
            items: [{ ...request, requestId: job.path.split("/").at(-1) }] });
          if (options.apply) plan.apply();
          return { ...plan, pendingRequest: true };
        }
        const attemptSnapshot = job.kind === "lock" ? current : await transaction.get(`semester_assessment_attempts/${job.attemptId}`);
        const attempt = attemptSnapshot.data || {};
        if (!attemptSnapshot.exists || attempt.definitionId !== definitionId || attempt.semesterId !== semesterId || attempt.assessmentKind !== "HISTORY_CLASSROOM") return null;
        let result = null, answers = attempt.answers || {};
        if (job.kind === "result") {
          result = current.data;
          if (attempt.status !== "SUBMITTED" || result.attemptId !== attempt.attemptId || result.studentUid !== attempt.studentUid ||
            result.semesterId !== semesterId || result.definitionId !== definitionId) return null;
          const submission = await transaction.get(`semester_assessment_submissions/${attempt.attemptId}`);
          if (!submission.exists || submission.data.studentUid !== attempt.studentUid || submission.data.attemptId !== attempt.attemptId ||
            submission.data.semesterId !== semesterId) return null;
          answers = submission.data.answers || {};
        } else {
          if (attempt.status !== "LOCKED" || attempt.resetAt || !["VISIBILITY_HIDDEN", "NAVIGATION"].includes(attempt.lockReason) ||
            timestampMs(source.data.retryResetByStudentUid?.[attempt.studentUid]) >= eventTime(null, attempt)) return null;
          const currentResults = bounded(await transaction.query("semester_assessment_results", {
            field: "definitionId", operator: "==", value: definitionId, limit: MAX_ROWS + 1,
          }));
          if (currentResults.some(row => row.data?.studentUid === attempt.studentUid &&
            (row.data?.completionSource === "exemption" || eventTime(row.data) >= eventTime(null, attempt)))) return null;
        }
        const notify = eventTime(result, attempt) >= sinceMs && !attempt.resetAt;
        const sync = createSync(notify ? {} : { prepareInput: null });
        const plan = await sync.prepareAttempt({ transaction, attempt, result, answers, lockReason: attempt.lockReason || "", timestamp });
        if (options.apply) plan.apply();
        return { ...plan, lockedAttempt: job.kind === "lock" };
      });
      if (!outcome) { summary.skipped++; continue; }
      if (outcome.lockedAttempt) summary.lockedAttempts++;
      if (outcome.pendingRequest) summary.pendingRequests++;
      if (outcome.unknownOutcome) summary.unknownOutcomes++;
      countResult(summary, outcome);
    }
    summaries.push(summary);
  }
  return { mode: options.apply ? "apply" : "dry-run", project: options.project, semesterId,
    notifySince: options.notifySince || null, assignments: summaries };
};
const createAuthorizedFirestore = projectId => {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    if (!/^demo-westory-session-/.test(projectId)) throw new Error("Repair emulator requires an isolated demo project.");
    return new Firestore({ projectId });
  }
  const authClient = new OAuth2Client();
  // No credentials or access tokens are written to disk or included in output.
  const command = process.platform === "win32" ? "cmd.exe" : "gcloud";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "gcloud.cmd auth print-access-token"] : ["auth", "print-access-token"];
  const accessToken = execFileSync(command, args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
  authClient.setCredentials({ access_token: accessToken, expiry_date: Date.now() + 50 * 60_000 });
  return new Firestore({ projectId, authClient });
};
const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("node functions/scripts/repair-history-classroom-sync.cjs --assignment-id ID [--assignment-id ID] [--semester-id YYYY-S] [--notify-since UTC_ISO] [--project PROJECT] [--apply]");
    return;
  }
  const db = createAuthorizedFirestore(options.project);
  process.env.GCLOUD_PROJECT = options.project;
  process.env.GOOGLE_CLOUD_PROJECT = options.project;
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: options.project });
  const createSync = require("../productionGateway/productionSource").createHistoryClassroomSync;
  try { console.log(JSON.stringify(await runRepair({ db, options, createSync }))); }
  finally { await db.terminate(); }
};
if (require.main === module) main().catch(() => {
  console.error("History Classroom repair failed. Check arguments, active semester, source consistency, credentials and the 500-record bound.");
  process.exitCode = 1;
});
module.exports = { parseArgs, runRepair, createAuthorizedFirestore };
