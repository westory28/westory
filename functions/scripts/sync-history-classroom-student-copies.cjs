// Creates or repairs the roster-free student copies of History Classroom
// assignments from the teacher documents. Teacher documents are only read.
//
//   node functions/scripts/sync-history-classroom-student-copies.cjs --semester-id 2026-2
//   node functions/scripts/sync-history-classroom-student-copies.cjs --semester-id 2026-2 --apply --expect <fingerprint>
//
// The first form prints counts and a fingerprint and writes nothing. The
// second writes only when the plan still has that fingerprint. Running it
// again afterwards must report zero pending writes.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { Firestore, Timestamp, FieldValue } = require("@google-cloud/firestore");
const { GoogleAuth, OAuth2Client } = require("google-auth-library");
const { historyStudentCopy } = require("../productionGateway/assessmentLifecycle");

const VIEW_COLLECTION = "history_classroom_student_views";
const ASSIGNEE_COLLECTION = "history_classroom_assignees";
const fail = (message) => { throw new Error(message); };
const encode = (value) => {
  if (value instanceof Timestamp) return { __timestamp: [value.seconds, value.nanoseconds] };
  if (value instanceof Date) return { __date: value.toISOString() };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") {
    if (value.firestore && typeof value.path === "string") return { __reference: value.path };
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, encode(value[key])]));
  }
  return value === undefined ? null : value;
};
const stable = (value) => JSON.stringify(encode(value));
const hash = (value) => createHash("sha256").update(stable(value)).digest("hex");
const withoutUpdatedAt = ({ updatedAt, ...rest }) => rest;

const parseArgs = (args) => {
  const options = { project: "history-quiz-yongsin", semesterId: "", apply: false, expect: "" };
  for (let index = 0; index < args.length; index++) {
    const [key, inline] = args[index].split("=", 2);
    if (key === "--apply") { options.apply = true; continue; }
    const value = inline === undefined ? args[++index] : inline;
    if (!value || value.startsWith("--")) fail("An argument value is required.");
    if (key === "--project") options.project = value;
    else if (key === "--semester-id") options.semesterId = value;
    else if (key === "--expect") options.expect = value;
    else fail("Unsupported argument.");
  }
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(options.project)) fail("Invalid project.");
  if (!/^\d{4}-[12]$/.test(options.semesterId)) fail("Specify --semester-id, for example 2026-2.");
  if (options.apply && !/^[a-f0-9]{64}$/.test(options.expect)) fail("--apply requires --expect <fingerprint> from a preview run.");
  return options;
};

const createAuthorizedFirestore = async (projectId) => {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    if (!/^demo-westory-session-/.test(projectId)) fail("An isolated emulator project is required.");
    return new Firestore({ projectId });
  }
  let authClient;
  try {
    authClient = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/datastore"] }).getClient();
    await authClient.getAccessToken();
  } catch {
    // Reuse the signed-in Firebase CLI account in memory; never create or print credentials.
    const candidates = [process.env.FIREBASE_TOOLS_CONFIG_PATH,
      path.join(process.env.USERPROFILE || "", ".config/configstore/firebase-tools.json"),
      path.join(process.env.APPDATA || "", "configstore/firebase-tools.json")].filter(Boolean);
    const file = candidates.find((candidate) => fs.existsSync(candidate));
    if (!file) fail("ADC or an authenticated Firebase CLI account is required.");
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!config.tokens?.refresh_token) fail("An authenticated Firebase CLI account is required.");
    authClient = new OAuth2Client(process.env.FIREBASE_CLIENT_ID || "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
      process.env.FIREBASE_CLIENT_SECRET || "j9iVZfS8kkCEFUPaAeJV0sAi");
    authClient.setCredentials({ refresh_token: config.tokens.refresh_token });
  }
  return new Firestore({ projectId, authClient });
};

// What the copies of one assignment must be, compared with what exists.
const planAssignment = (semesterId, source, existingView, existingAssignees) => {
  const copy = historyStudentCopy(semesterId, source.id, source.data(), null);
  const writes = [], deletes = [];
  if (!existingView || stable(existingView) !== stable(copy.view)) writes.push({ path: copy.viewPath, data: copy.view });
  const wanted = new Set();
  for (const assignee of copy.assignees) {
    wanted.add(assignee.path);
    const existing = existingAssignees.get(assignee.path);
    if (!existing || stable(withoutUpdatedAt(existing)) !== stable(withoutUpdatedAt(assignee.data)))
      writes.push({ path: assignee.path, data: assignee.data, assignee: true });
  }
  for (const existingPath of existingAssignees.keys()) if (!wanted.has(existingPath)) deletes.push(existingPath);
  return { writes, deletes };
};

const buildPlan = async (db, semesterId) => {
  const [year, semester] = semesterId.split("-");
  const root = `years/${year}/semesters/${semester}`;
  const [sources, views, assignees] = await Promise.all([
    db.collection(`${root}/history_classrooms`).get(),
    db.collection(`${root}/${VIEW_COLLECTION}`).get(),
    db.collection(`${root}/${ASSIGNEE_COLLECTION}`).get(),
  ]);
  const viewById = new Map(views.docs.map((item) => [item.id, item.data()]));
  const assigneesByAssignment = new Map();
  for (const item of assignees.docs) {
    const assignmentId = String(item.data().assignmentId || "");
    if (!assigneesByAssignment.has(assignmentId)) assigneesByAssignment.set(assignmentId, new Map());
    assigneesByAssignment.get(assignmentId).set(item.ref.path, item.data());
  }
  const sourceIds = new Set(sources.docs.map((item) => item.id));
  const rows = sources.docs.map((source) => ({ id: source.id, updateTime: source.updateTime,
    ...planAssignment(semesterId, source, viewById.get(source.id), assigneesByAssignment.get(source.id) || new Map()) }));
  // Copies whose teacher document no longer exists grant nothing useful.
  const orphans = [...views.docs.filter((item) => !sourceIds.has(item.id)).map((item) => item.ref.path),
    ...assignees.docs.filter((item) => !sourceIds.has(String(item.data().assignmentId || ""))).map((item) => item.ref.path)];
  const fingerprint = hash({ semesterId, rows: rows.map((row) => ({ id: row.id, updateTime: row.updateTime,
    writes: row.writes.map((write) => [write.path, write.assignee ? withoutUpdatedAt(write.data) : write.data]), deletes: row.deletes })), orphans });
  return { root, rows, orphans, fingerprint, sourceCount: sources.size, viewCount: views.size, assigneeCount: assignees.size };
};

const summarize = (plan) => ({
  teacherDocuments: plan.sourceCount, existingCopies: plan.viewCount, existingAssigneeDocuments: plan.assigneeCount,
  pendingCopyWrites: plan.rows.reduce((total, row) => total + row.writes.filter((write) => !write.assignee).length, 0),
  pendingAssigneeWrites: plan.rows.reduce((total, row) => total + row.writes.filter((write) => write.assignee).length, 0),
  pendingAssigneeDeletes: plan.rows.reduce((total, row) => total + row.deletes.length, 0),
  orphanDocuments: plan.orphans.length, fingerprint: plan.fingerprint,
});

const apply = async (db, semesterId, plan) => {
  let written = 0, deleted = 0;
  for (const row of plan.rows.filter((item) => item.writes.length || item.deletes.length)) {
    await db.runTransaction(async (transaction) => {
      const sourceRef = db.doc(`${plan.root}/history_classrooms/${row.id}`);
      const source = await transaction.get(sourceRef);
      // A teacher saved in between: the server already rewrote these copies.
      if (!source.exists || !source.updateTime.isEqual(row.updateTime)) return;
      for (const write of row.writes) {
        transaction.set(db.doc(write.path), write.assignee ? { ...write.data, updatedAt: FieldValue.serverTimestamp() } : write.data);
        written += 1;
      }
      for (const stalePath of row.deletes) { transaction.delete(db.doc(stalePath)); deleted += 1; }
    });
  }
  for (const orphanPath of plan.orphans) { await db.doc(orphanPath).delete(); deleted += 1; }
  return { written, deleted };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const db = await createAuthorizedFirestore(options.project);
  const plan = await buildPlan(db, options.semesterId);
  if (!options.apply) {
    console.log(JSON.stringify({ mode: "preview", project: options.project, semesterId: options.semesterId, ...summarize(plan), productionWrites: 0 }));
    return;
  }
  if (plan.fingerprint !== options.expect) fail("The plan changed since the preview. Run the preview again.");
  const result = await apply(db, options.semesterId, plan);
  const after = await buildPlan(db, options.semesterId);
  console.log(JSON.stringify({ mode: "apply", project: options.project, semesterId: options.semesterId, ...result, remaining: summarize(after) }));
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`History Classroom student copy sync failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { buildPlan, planAssignment, summarize, apply };
