/* Explicit one-time retirement of the former avatar generation. Dry-run is default. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldPath, Timestamp } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { catalog } = require('../studentAvatarCatalog');
const { resetAvatarOwner, isRetiredAvatar } = require('../avatarGenerationReset');

const argument = name => {
  const prefix = `--${name}=`;
  const inline = process.argv.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const hash = value => createHash('sha256').update(value).digest('hex');
const isOutside = (workspace, target) => {
  const relative = path.relative(workspace, target);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
};
function resolveBackupDirectory(workspace, requested) {
  const target = path.resolve(requested), actualWorkspace = fs.realpathSync(workspace);
  if (fs.existsSync(target)) throw new Error('Backup must be a new directory outside the repository');
  let ancestor = path.dirname(target);
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error('Backup parent directory is unavailable');
    ancestor = parent;
  }
  if (!fs.statSync(ancestor).isDirectory()) throw new Error('Backup ancestor must be a directory');
  const actualTarget = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, target));
  if (!isOutside(actualWorkspace, actualTarget)) throw new Error('Backup must be outside the repository after resolving links');
  return target;
}
function credential() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return { value: applicationDefault(), cleanup() {} };
  const candidates = [process.env.FIREBASE_TOOLS_CONFIG_PATH,
    path.join(process.env.USERPROFILE || '', '.config', 'configstore', 'firebase-tools.json'),
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json')].filter(Boolean);
  const filename = candidates.find(value => fs.existsSync(value));
  if (!filename) return { value: applicationDefault(), cleanup() {} };
  const token = JSON.parse(fs.readFileSync(filename, 'utf8'))?.tokens?.refresh_token;
  if (!token) throw new Error('Firebase CLI authentication is required');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'westory-avatar-reset-'));
  const temporary = path.join(directory, 'adc.json');
  fs.writeFileSync(temporary, JSON.stringify({ type: 'authorized_user',
    client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi', refresh_token: token }), { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = temporary;
  return { value: applicationDefault(), cleanup() { fs.unlinkSync(temporary); fs.rmdirSync(directory); delete process.env.GOOGLE_APPLICATION_CREDENTIALS; } };
}
async function main() {
  const apply = process.argv.includes('--apply'), projectId = argument('project') || 'history-quiz-yongsin';
  if (catalog.version !== 2) throw new Error('This migration is restricted to minimi catalog generation 2');
  const workspace = path.resolve(__dirname, '../..'), backupDirectory = argument('backup');
  if (apply && !backupDirectory) throw new Error('--apply requires --backup <new private directory outside the repository>');
  let backup = async () => {}, archive, descriptor;
  if (apply) {
    archive = resolveBackupDirectory(workspace, backupDirectory);
    fs.mkdirSync(archive, { recursive: true, mode: 0o700 });
    if (!isOutside(fs.realpathSync(workspace), fs.realpathSync(archive))) throw new Error('Backup destination changed while preparing it');
    const log = path.join(archive, 'avatar-reset.jsonl');
    descriptor = fs.openSync(log, 'wx', 0o600);
    backup = async value => { fs.writeSync(descriptor, JSON.stringify(value) + '\n'); fs.fsyncSync(descriptor); };
    await backup({ kind: 'manifest', projectId, catalogVersion: 2, startedAt: new Date().toISOString() });
  }
  const credentials = credential();
  const app = initializeApp({ credential: credentials.value, projectId, storageBucket: argument('bucket') || `${projectId}.firebasestorage.app` });
  const db = getFirestore(app), bucket = getStorage(app).bucket();
  const counts = { mode: apply ? 'apply' : 'dry-run', catalogVersion: 2, inventoryScanned: 0,
    inventoriesReset: 0, projectionsRemoved: 0, pricingReset: 0, storageObjects: 0,
    storageBytes: 0, storageDeleted: 0, storageConflicts: 0, pages: 0, documentSnapshotsRead: 0, documentsWritten: 0 };
  async function pages(query, visit) {
    let cursor;
    while (true) {
      const page = await (cursor ? query.startAfter(cursor) : query).limit(100).get(); counts.pages++;
      counts.documentSnapshotsRead += page.size;
      for (const document of page.docs) await visit(document);
      if (page.size < 100) break;
      cursor = page.docs[page.docs.length - 1];
    }
  }
  try {
    const inspectedOwners = new Set();
    for (const audience of ['student', 'teacher']) {
      await pages(db.collection(`${audience}_avatars`).select('catalogVersion').orderBy(FieldPath.documentId()), async doc => {
        counts.inventoryScanned++;
        if (![undefined, 1].includes(doc.data().catalogVersion)) return;
        const result = await resetAvatarOwner({ db, uid: doc.id, audience, apply, backup, onRead: n => { counts.documentSnapshotsRead += n; } });
        inspectedOwners.add(doc.id);
        counts.inventoriesReset += Number(result.inventory); counts.projectionsRemoved += Number(result.projection);
        if (apply) counts.documentsWritten += Number(result.inventory) + Number(result.projection);
      });
    }
    // Includes public images whose inventory was already missing. The query is
    // restricted to old avatar projections, not the entire users collection.
    await pages(db.collection('users').where('avatar', '!=', null)
      .select('avatar', 'role').orderBy('avatar').orderBy(FieldPath.documentId()), async doc => {
      if (inspectedOwners.has(doc.id)) return;
      if (!isRetiredAvatar(doc.data().avatar)) return;
      const audience = doc.data().role === 'student' ? 'student' : 'teacher';
      const result = await resetAvatarOwner({ db, uid: doc.id, audience, apply, backup, onRead: n => { counts.documentSnapshotsRead += n; } });
      counts.inventoriesReset += Number(result.inventory); counts.projectionsRemoved += Number(result.projection);
      if (apply) counts.documentsWritten += Number(result.inventory) + Number(result.projection);
    });
    const pricingRef = db.doc('avatar_catalog_settings/current');
    counts.pricingReset = Number(await db.runTransaction(async tx => {
      const snapshot = await tx.get(pricingRef);
      counts.documentSnapshotsRead++;
      if (!snapshot.exists || snapshot.data().catalogVersion === 2) return false;
      const value = snapshot.data();
      if (!Number.isSafeInteger(value.revision) || !Number.isSafeInteger(value.revision + 1)) throw new Error('Invalid pricing revision');
      if (apply) {
        await backup({ kind: 'pricing', path: pricingRef.path, before: value });
        tx.set(pricingRef, { schemaVersion: 1, catalogVersion: 2, revision: value.revision + 1,
          prices: {}, updatedAt: Timestamp.now(), updatedBy: 'system:minimi-v2-reset' });
      }
      return true;
    }, apply ? {} : { readOnly: true }));
    if (apply) counts.documentsWritten += counts.pricingReset;
    for (const audience of ['student', 'teacher']) {
      const prefix = `${audience}_avatar_thumbnails/v1/`;
      let pageToken;
      do {
        const [files, next] = await bucket.getFiles({ prefix, autoPaginate: false, maxResults: 100, ...(pageToken ? { pageToken } : {}) });
        for (const file of files) {
          if (!new RegExp(`^${prefix}[a-f0-9]{64}/[a-f0-9]{64}\\.webp$`).test(file.name)) throw new Error('Unexpected legacy thumbnail path; no broad deletion is allowed');
          const metadata = file.metadata; counts.storageObjects++; counts.storageBytes += Number(metadata.size || 0);
          if (apply) {
            const generation = metadata.generation;
            if (!/^\d+$/.test(String(generation))) throw new Error('Storage generation is required');
            const destination = path.join(archive, `${hash(file.name)}.webp`);
            await bucket.file(file.name, { generation }).download({ destination });
            await backup({ kind: 'storage', name: file.name, generation, backupFile: path.basename(destination) });
            try { await file.delete({ ifGenerationMatch: generation, ignoreNotFound: true }); counts.storageDeleted++; }
            catch (error) { if (Number(error.code) !== 412) throw error; counts.storageConflicts++; }
          }
        }
        pageToken = next?.pageToken;
      } while (pageToken);
    }
    if (apply) await backup({ kind: 'complete', counts, completedAt: new Date().toISOString() });
    console.log(JSON.stringify(counts, null, 2));
    if (counts.storageConflicts) process.exitCode = 2;
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); await deleteApp(app); credentials.cleanup(); }
}
if (require.main === module) main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
module.exports = { resolveBackupDirectory };
