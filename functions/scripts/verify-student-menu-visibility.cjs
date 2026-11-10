const assert = require('node:assert/strict');
const { test } = require('node:test');
const { studentMenuVisible } = require('../studentMenuVisibility');
const { createStudentAvatarHandlers } = require('../studentAvatar');
const { fixture, req, purchase, save } = require('./verify-student-avatar.cjs');
const hidden = error => error.code === 'permission-denied' && error.details?.reason === 'STUDENT_MENU_HIDDEN';

test('legacy settings remain compatible; explicit hidden ancestors and malformed projections deny access', () => {
  for (const config of [undefined, {}, { studentMenuVisibility: {} }, { studentMenuVisibility: { mypage: true, avatar: true } }]) {
    assert.equal(studentMenuVisible(config, ['mypage', 'avatar']), true);
  }
  for (const visibility of [null, [], false, { mypage: false, avatar: true }, { avatar: false }, { avatar: 'true' }]) {
    assert.equal(studentMenuVisible({ studentMenuVisibility: visibility }, ['mypage', 'avatar']), false);
  }
  assert.equal(studentMenuVisible({ studentMenuVisibility: { yut: false } }, ['weplay', 'naval']), true);
});

test('hidden avatar or my page rejects studio, purchase and save without altering money or stored appearance', async () => {
  for (const key of ['mypage', 'avatar']) {
    const state = fixture();
    state.documents.set('site_settings/config', { studentMenuVisibility: { [key]: false } });
    await assert.rejects(state.api.getAvatarStudioState(req({ year: '2026', semester: '2' })), hidden);
    await assert.rejects(state.api.purchaseStudentAvatarItem(purchase()), hidden);
    await assert.rejects(state.api.saveStudentAvatar(await save()), hidden);
    assert.equal(state.writes.length, 0);
    assert.equal(state.bucket.objects.size, 0);
    assert.equal((await state.api.getStudentAvatar(req({}))).revision, 0, 'existing public appearance remains readable');
  }
});

test('a menu closed during thumbnail upload prevents commit and removes only the uncommitted image', async () => {
  const state = fixture();
  state.bucket.afterSave = async () => state.documents.set('site_settings/config', { studentMenuVisibility: { avatar: false } });
  await assert.rejects(state.api.saveStudentAvatar(await save()), hidden);
  assert.equal(state.writes.length, 0);
  assert.equal(state.bucket.objects.size, 0);
});

test('closed menu rejects stale purchase replay and teacher avatar saving remains available', async () => {
  const state = fixture();
  await state.api.purchaseStudentAvatarItem(purchase());
  const before = state.writes.length;
  state.documents.set('site_settings/config', { studentMenuVisibility: { mypage: false, avatar: false } });
  await assert.rejects(state.api.purchaseStudentAvatarItem(purchase()), hidden);
  assert.equal(state.writes.length, before);
  state.documents.set('users/avatar-teacher', { role: 'teacher' });
  const teacher = createStudentAvatarHandlers({ db: state.db, bucket: state.bucket, audience: 'teacher',
    assertSession: async request => ({ uid: request.auth.uid, email: request.auth.token.email }) });
  const input = await save();
  input.auth = { uid: 'avatar-teacher', token: { email: 'teacher@yongshin-ms.ms.kr' } };
  assert.equal((await teacher.saveStudentAvatar(input)).revision, 1);
});
