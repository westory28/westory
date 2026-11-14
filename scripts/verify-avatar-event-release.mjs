import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const audit = path.resolve(root, process.argv[2] || 'output/avatar-polish-20261114/backend/release-audit');
const require = createRequire(import.meta.url);
const plans = JSON.parse(await fs.readFile(path.join(audit, 'prepared-release.json'), 'utf8'));
const fixture = require('../functions/scripts/verify-student-avatar.cjs');
const sha = value => createHash('sha256').update(value).digest('hex');
const handler = text => text.slice(text.indexOf('const createStudentAvatarDeletionHandler ='), text.indexOf('\nmodule.exports =', text.indexOf('const createStudentAvatarDeletionHandler =')));
const results = [];
for (const plan of plans.filter(row => ['event', 'cleanup'].includes(row.mode))) {
  const directory = path.join(plan.directory, 'functions');
  const manifest = JSON.parse(await fs.readFile(path.join(plan.directory, 'release-manifest.json'), 'utf8'));
  if (plan.mode === 'event') {
    const module = require(path.join(directory, 'gongsinmoongo.js'));
    assert.deepEqual(module.defaultSettings().avatarEvent, { enabled: false, rewardWis: 100 });
    const wallet = await fs.readFile(path.join(directory, 'studentWisWallet.js'));
    assert.equal(sha(wallet), sha(await fs.readFile(path.join(root, 'functions/studentWisWallet.js'))));
    for (const file of ['avatarEvent.js', 'gongsinmoongo.js', 'avatarCatalog.json', 'studentAvatarCatalog.js'])
      assert.equal(sha(await fs.readFile(path.join(directory, file))), sha(await fs.readFile(path.join(root, 'functions', file))));
    assert.deepEqual(manifest.changes.filter(row => row.before === null).map(row => row.path), ['avatarEvent.js']);
  } else {
    const read = async file => (await fs.readFile(file, 'utf8')).replace(/\r\n/g, '\n');
    const original = await read(path.join(audit, 'originals', plan.targets[0], 'studentAvatar.js'));
    const patched = await read(path.join(directory, 'studentAvatar.js'));
    const current = await read(path.join(root, 'functions/studentAvatar.js'));
    assert.equal(handler(patched), handler(current));
    assert.equal(patched.replace(handler(patched), ''), original.replace(handler(original), ''), 'Only the deletion handler is transplanted');
    const state = fixture.fixture();
    const uid = fixture.uid, digest = sha(uid), markerPath = `avatar_event_participations/${digest}`;
    state.documents.set(markerPath, { schemaVersion: 1, thumbnailPath: 'private/image', questionId: 'private-question', rewardedAt: 2 });
    state.documents.set(fixture.avatarPath, { studentUid: uid });
    state.bucket.objects.set(`student_avatar_thumbnails/v2/${digest}/event.webp`, {});
    state.bucket.objects.set('student_avatar_thumbnails/v2/another-user/keep.webp', {});
    state.documents.delete(`users/${uid}`);
    const cleanup = require(path.join(directory, 'studentAvatar.js')).createStudentAvatarDeletionHandler(state);
    const event = { id: 'prepared-event-delete', params: { uid }, data: { data: () => ({ role: 'student' }) } };
    await cleanup(event); await cleanup(event);
    assert.deepEqual(state.documents.get(markerPath), { schemaVersion: 1, deleted: true, participated: true, rewarded: true });
    assert.equal(state.documents.has(fixture.avatarPath), false);
    assert.equal(state.bucket.objects.size, 1);
  }
  results.push({ group: plan.group, mode: plan.mode, passed: true });
}
assert.equal(results.filter(row => row.mode === 'cleanup').length, 1);
assert(results.some(row => row.mode === 'event'));
await fs.writeFile(path.join(audit, 'event-prepared-verification.json'), JSON.stringify({ passed: true, results }, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, results }, null, 2));
