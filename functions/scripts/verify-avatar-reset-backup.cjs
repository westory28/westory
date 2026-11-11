const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { test } = require('node:test');
const { resolveBackupDirectory } = require('./reset-retired-avatars.cjs');

test('avatar reset backups reject repository descendants, deceptive dot names and junctions', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'westory-avatar-backup-test-'));
  const workspace = path.join(parent, 'repository'), outside = path.join(parent, 'private');
  fs.mkdirSync(workspace); fs.mkdirSync(outside);
  try {
    assert.throws(() => resolveBackupDirectory(workspace, path.join(workspace, 'backup')));
    assert.throws(() => resolveBackupDirectory(workspace, path.join(workspace, '..avatar-backup')));
    assert.throws(() => resolveBackupDirectory(workspace, path.join(workspace, 'missing', '..nested', 'backup')));
    assert.throws(() => resolveBackupDirectory(workspace, outside));
    const allowed = path.join(outside, 'new', 'backup');
    assert.equal(resolveBackupDirectory(workspace, allowed), allowed);
    const linked = path.join(outside, 'linked-repository');
    fs.symlinkSync(workspace, linked, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => resolveBackupDirectory(workspace, path.join(linked, 'new-backup')));
    assert.throws(() => resolveBackupDirectory(workspace, path.join(linked, 'missing', 'nested-backup')));
  } finally {
    const resolved = path.resolve(parent);
    assert.ok(path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('westory-avatar-backup-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
