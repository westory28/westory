const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { Firestore, Timestamp } = require("@google-cloud/firestore");
const { GoogleAuth, OAuth2Client } = require("google-auth-library");

const REPOSITORY_ROOT = path.resolve(__dirname, "../..");
const MAX_AUDITS = 100;
const error = message => { throw new Error(message); };
const rootFor = semesterId => `years/${semesterId.split("-")[0]}/semesters/${semesterId.split("-")[1]}`;
const encode = value => {
  if (value instanceof Timestamp) return { __timestamp: [value.seconds, value.nanoseconds] };
  if (value instanceof Date) return { __date: value.toISOString() };
  if (Buffer.isBuffer(value)) return { __bytes: value.toString("base64") };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") {
    if (value.firestore && typeof value.path === "string") return { __reference: value.path };
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, encode(value[key])]));
  }
  return value;
};
const stable = value => JSON.stringify(encode(value));
const hash = value => createHash("sha256").update(stable(value)).digest("hex");
const version = snapshot => snapshot.exists ? `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}` : null;
const stamp = value => value instanceof Timestamp && Number.isFinite(value.seconds) ? value : null;
const uid = value => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 180 ? value : null;
const planHash = plan => hash(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "planHash")));
const assertOutsideRepository = file => {
  if (!file || !path.isAbsolute(file)) error("An absolute output path is required.");
  const absolute = path.resolve(file);
  const relative = path.relative(REPOSITORY_ROOT.toLowerCase(), absolute.toLowerCase());
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)))
    error("Repair files must remain outside the repository.");
  // Resolve the existing parent too, so a junction cannot redirect a backup into Git.
  const realParent = fs.realpathSync(path.dirname(absolute));
  const realRelative = path.relative(fs.realpathSync(REPOSITORY_ROOT).toLowerCase(), realParent.toLowerCase());
  if (!realRelative || (!realRelative.startsWith(`..${path.sep}`) && realRelative !== ".." && !path.isAbsolute(realRelative)))
    error("Repair files must remain outside the repository.");
  return absolute;
};
const parseArgs = args => {
  const options = { project: "history-quiz-yongsin", semesterId: "", assignmentIds: [], apply: false, plan: "", backup: "", expectPlanHash: "" };
  const keys = { "--project": "project", "--semester-id": "semesterId", "--plan": "plan", "--backup": "backup", "--expect-plan-hash": "expectPlanHash" };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--apply") { options.apply = true; continue; }
    if (args[index] === "--help") { options.help = true; continue; }
    const [key, inline] = args[index].split("=", 2);
    if (!keys[key] && key !== "--assignment-id") error("Unsupported repair argument.");
    const value = inline === undefined ? args[++index] : inline;
    if (!value || value.startsWith("--")) error("A repair argument value is required.");
    if (key === "--assignment-id") options.assignmentIds.push(value);
    else options[keys[key]] = value;
  }
  options.assignmentIds = [...new Set(options.assignmentIds)].sort();
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(options.project)) error("Invalid project.");
  if (options.semesterId && !/^\d{4}-[12]$/.test(options.semesterId)) error("Invalid semester.");
  if (options.help) return options;
  if (!options.assignmentIds.length || options.assignmentIds.length > 20 ||
      options.assignmentIds.some(id => id.length > 180 || /[\/\\\u0000-\u001f]/u.test(id))) error("Specify 1 to 20 explicit assignment IDs.");
  options.plan = assertOutsideRepository(options.plan);
  if (options.apply) {
    if (!/^[0-9a-f]{64}$/.test(options.expectPlanHash)) error("The reviewed plan hash is required.");
    options.backup = assertOutsideRepository(options.backup);
    if (options.backup === options.plan) error("Plan and backup paths must differ.");
  } else if (options.backup || options.expectPlanHash) error("Backup and expected hash are apply-only arguments.");
  return options;
};
const assertActive = (pointer, manifest, semesterId) => {
  const active = pointer.data(), current = manifest.data();
  if (!pointer.exists || !manifest.exists || active.semesterId !== semesterId || current.semesterId !== semesterId ||
      current.status !== "ACTIVE" || current.readOnly === true || Number(active.revision) !== Number(current.revision))
    error("The canonical current semester is not writable.");
};
const buildRow = ({ source, definition, audits, semesterId, assignmentId }) => {
  const base = { assignmentId, sourcePath: `${rootFor(semesterId)}/history_classrooms/${assignmentId}`,
    definitionPath: `semester_assessment_definitions/history_classroom:${semesterId}:${assignmentId}`,
    sourceVersion: version(source), definitionVersion: version(definition), patch: {} };
  if (!source.exists) return { ...base, status: "missing-source" };
  const s = source.data();
  if (s.deletedAt != null) return { ...base, status: "deleted-source" };
  if (stamp(s.createdAt) && uid(s.createdBy)) return { ...base, status: "complete" };
  const d = definition.data();
  if (!definition.exists || d.semesterId !== semesterId || d.assessmentKind !== "HISTORY_CLASSROOM" || d.sourceId !== assignmentId ||
      d.definitionId !== `history_classroom:${semesterId}:${assignmentId}` || !stamp(d.createdAt) || !uid(d.createdBy))
    error("Canonical creation provenance is missing or inconsistent.");
  if ((s.createdAt != null && !stamp(s.createdAt)) || (s.createdBy != null && s.createdBy !== "" && !uid(s.createdBy)))
    error("Existing provenance is malformed; manual review is required.");
  const first = audits.filter(audit => {
    const a = audit.data();
    return ["saveHistoryClassroomAssignment", "upsertHistoryClassroomSource"].includes(a.commandType) &&
      a.eventType === "COMMAND_SUCCEEDED" && a.target?.kind === "history-classroom-source" && a.target?.id === assignmentId &&
      a.result?.sourceId === assignmentId && a.result?.contentRevision === 1;
  });
  if (first.length > 1) error("Ambiguous revision-one audit provenance.");
  const audit = first[0], a = audit?.data();
  // The old two-command flow created a source before its definition. Atomic
  // saves have the same commit timestamp; an upsert audit proves the earlier
  // source creation time and must not postdate the canonical definition.
  if (audit && (!stamp(a.createdAt) || a.actorUid !== d.createdBy ||
      (a.commandType === "saveHistoryClassroomAssignment" ? stable(a.createdAt) !== stable(d.createdAt)
        : a.createdAt.toMillis() > d.createdAt.toMillis())))
    error("Definition and revision-one audit provenance disagree.");
  const patch = {};
  if (!stamp(s.createdAt)) patch.createdAt = encode(audit ? a.createdAt : d.createdAt);
  if (!uid(s.createdBy)) patch.createdBy = d.createdBy;
  return { ...base, status: "repair", sourceRevision: Number(s.contentRevision || 0), patch,
    evidence: { kind: audit ? (a.commandType === "upsertHistoryClassroomSource" ? "revision-one-source-audit-and-later-definition"
      : "definition-and-revision-one-audit") : "definition", auditPath: audit?.ref.path || null,
      auditVersion: audit ? version(audit) : null } };
};
const createPlan = async ({ db, options }) => {
  const pointer = await db.doc("site_settings/semester_active").get();
  const semesterId = options.semesterId || pointer.data()?.semesterId;
  if (!/^\d{4}-[12]$/.test(semesterId || "")) error("An active semester is required.");
  const manifest = await db.doc(`semester_manifests/${semesterId}`).get();
  assertActive(pointer, manifest, semesterId);
  const rows = [];
  for (const assignmentId of options.assignmentIds) {
    const [source, definition, auditQuery] = await Promise.all([
      db.doc(`${rootFor(semesterId)}/history_classrooms/${assignmentId}`).get(),
      db.doc(`semester_assessment_definitions/history_classroom:${semesterId}:${assignmentId}`).get(),
      db.collection("command_audit_events").where("target.id", "==", assignmentId).limit(MAX_AUDITS + 1).get(),
    ]);
    if (auditQuery.size > MAX_AUDITS) error("The per-assignment audit bound was exceeded.");
    rows.push(buildRow({ source, definition, audits: auditQuery.docs, semesterId, assignmentId }));
  }
  const plan = { schemaVersion: 1, project: options.project, semesterId, assignmentIds: [...options.assignmentIds].sort(),
    pointerVersion: version(pointer), manifestVersion: version(manifest), rows };
  return { ...plan, planHash: planHash(plan) };
};
const assertReviewed = (plan, options) => {
  if (plan.schemaVersion !== 1 || plan.project !== options.project || plan.planHash !== options.expectPlanHash ||
      planHash(plan) !== options.expectPlanHash || (options.semesterId && plan.semesterId !== options.semesterId) ||
      stable(plan.assignmentIds) !== stable([...options.assignmentIds].sort())) error("The reviewed plan does not match this apply request.");
};
const applyPlan = async ({ db, options, plan, writeBackup = (file, data) => fs.writeFileSync(file, data, { flag: "wx", mode: 0o600 }) }) => {
  assertReviewed(plan, options);
  const currentPlan = await createPlan({ db, options });
  if (currentPlan.planHash !== plan.planHash) error("Source, definition, audit, or current semester changed after review.");
  const paths = [...new Set(["site_settings/semester_active", `semester_manifests/${plan.semesterId}`,
    ...plan.rows.flatMap(row => [row.sourcePath, row.definitionPath, row.evidence?.auditPath].filter(Boolean))])];
  const snapshots = await db.getAll(...paths.map(item => db.doc(item)));
  const expectedVersions = new Map([["site_settings/semester_active", plan.pointerVersion],
    [`semester_manifests/${plan.semesterId}`, plan.manifestVersion],
    ...plan.rows.flatMap(row => [[row.sourcePath, row.sourceVersion], [row.definitionPath, row.definitionVersion],
      ...(row.evidence?.auditPath ? [[row.evidence.auditPath, row.evidence.auditVersion]] : [])])]);
  if (snapshots.some(snapshot => version(snapshot) !== expectedVersions.get(snapshot.ref.path)))
    error("Repair backup versions differ from the reviewed plan.");
  const backup = { schemaVersion: 1, project: plan.project, semesterId: plan.semesterId, planHash: plan.planHash,
    savedAt: new Date().toISOString(), documents: snapshots.map(snapshot => ({ path: snapshot.ref.path, exists: snapshot.exists,
      updateTime: version(snapshot), data: snapshot.exists ? encode(snapshot.data()) : null })) };
  // Exclusive creation must succeed before the first transaction can write.
  writeBackup(options.backup, JSON.stringify(backup, null, 2));
  const repairRows = plan.rows.filter(item => item.status === "repair");
  await db.runTransaction(async transaction => {
    const currentSnapshots = await transaction.getAll(...paths.map(item => db.doc(item)));
    const byPath = new Map(currentSnapshots.map(snapshot => [snapshot.ref.path, snapshot]));
    if (currentSnapshots.some(snapshot => version(snapshot) !== expectedVersions.get(snapshot.ref.path)))
      error("Repair compare-and-swap conflict.");
    const pointer = byPath.get("site_settings/semester_active");
    const manifest = byPath.get(`semester_manifests/${plan.semesterId}`);
    for (const row of repairRows) {
      const source = byPath.get(row.sourcePath), definition = byPath.get(row.definitionPath);
      const audit = row.evidence.auditPath ? byPath.get(row.evidence.auditPath) : null;
      assertActive(pointer, manifest, plan.semesterId);
      const currentRow = buildRow({ source, definition, audits: audit ? [audit] : [], semesterId: plan.semesterId, assignmentId: row.assignmentId });
      if (stable(currentRow) !== stable(row)) error("Repair creation evidence changed.");
      const patch = {};
      if (row.patch.createdAt) patch.createdAt = new Timestamp(...row.patch.createdAt.__timestamp);
      if (row.patch.createdBy) patch.createdBy = row.patch.createdBy;
      // No updatedAt/contentRevision, publication, student, result, reward, or inbox writes.
      transaction.update(source.ref, patch, { lastUpdateTime: source.updateTime });
    }
  });
  const repaired = repairRows.length;
  return { mode: "apply", project: plan.project, semesterId: plan.semesterId, planHash: plan.planHash,
    repaired, skipped: plan.rows.length - repaired };
};
const createAuthorizedFirestore = async projectId => {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    if (!/^demo-westory-session-/.test(projectId)) error("An isolated emulator project is required.");
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
    const file = candidates.find(candidate => fs.existsSync(candidate));
    if (!file) error("ADC or an authenticated Firebase CLI account is required.");
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!config.tokens?.refresh_token) error("An authenticated Firebase CLI account is required.");
    authClient = new OAuth2Client(process.env.FIREBASE_CLIENT_ID || "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
      process.env.FIREBASE_CLIENT_SECRET || "j9iVZfS8kkCEFUPaAeJV0sAi");
    authClient.setCredentials({ refresh_token: config.tokens.refresh_token });
  }
  return new Firestore({ projectId, authClient });
};
const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("node functions/scripts/repair-history-classroom-created-metadata.cjs --assignment-id ID [--assignment-id ID] --plan ABSOLUTE_OUTSIDE_REPO_JSON [--semester-id YYYY-S] [--project PROJECT] [--apply --expect-plan-hash SHA256 --backup NEW_ABSOLUTE_OUTSIDE_REPO_JSON]");
    return;
  }
  const db = await createAuthorizedFirestore(options.project);
  try {
    if (options.apply) console.log(JSON.stringify(await applyPlan({ db, options, plan: JSON.parse(fs.readFileSync(options.plan, "utf8")) })));
    else {
      const plan = await createPlan({ db, options });
      fs.writeFileSync(options.plan, JSON.stringify(plan, null, 2), { flag: "wx", mode: 0o600 });
      console.log(JSON.stringify({ mode: "dry-run", project: plan.project, semesterId: plan.semesterId, planHash: plan.planHash,
        rows: plan.rows.map(({ assignmentId, status, patch, evidence }) => ({ assignmentId, status, fields: Object.keys(patch), evidence: evidence?.kind || null })) }));
    }
  } finally { await db.terminate(); }
};
if (require.main === module) main().catch(() => {
  console.error("History Classroom creation metadata repair failed. Check arguments, plan hash, backup path, credentials, source versions, and canonical creation evidence.");
  process.exitCode = 1;
});
module.exports = { parseArgs, createPlan, applyPlan, buildRow, planHash, createAuthorizedFirestore, assertOutsideRepository };
