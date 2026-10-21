import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getYutManagementProgress } from '../yutManagement.mjs';
import { createYutRoom, addYutPlayer, readyYutPlayer, startYutGame } from '../yutCore.mjs';

const piece = (node, lane = 'outer') => ({ id: '1', node, lane });
const player = (uid, pieces, active = true) => ({ uid, pieces, active });
const room = (players, status = 'playing') => ({ players, status });

test('monitor ranks completed pieces before remaining distance, includes ties and excludes leavers', () => {
  const source = room([
    player('near', [piece('o19'), piece('o19')]),
    player('finished', [piece('finish'), piece('home')]),
    player('tied', [piece('finish'), piece('home')]),
    player('left', [piece('finish'), piece('finish')], false),
  ]);
  const before = structuredClone(source);
  const result = getYutManagementProgress(source);
  assert.deepEqual(result.leadingUids, ['finished', 'tied']);
  assert.deepEqual(result.standings.map(entry => entry.uid), ['finished', 'tied', 'near']);
  assert.equal(result.standings[0].finishedPieces, 1);
  assert.equal(result.standings[0].totalPieces, 2);
  assert.deepEqual(source, before, 'projection does not alter room data');
});

test('remaining distance follows shortcuts, center choices, exact finish and legacy positions', () => {
  const score = (node, lane = 'outer') => -getYutManagementProgress(room([
    player('a', [piece(node, lane)]),
  ])).standings[0].progress;
  assert.equal(score('finish'), 0);
  assert.equal(score('home'), 11);
  assert.equal(score('o5'), 6);
  assert.equal(score('o6'), 10);
  assert.equal(score('o10'), 6);
  assert.equal(score('a1', 'a'), 5);
  assert.equal(score('a5', 'a'), 6);
  assert.equal(score('center', 'a'), 3);
  assert.equal(score('center', 'b'), 3);
  assert.equal(score('b5', 'b'), 1);
  assert.equal(score('o19'), 1);
  assert.equal(score('o20'), 1);
  assert.deepEqual(getYutManagementProgress(room([
    player('a', [piece('center', 'a')]), player('b', [piece('b2', 'b')]),
  ])).leadingUids, ['a']);
});

test('real newly started rooms tie; waiting and unavailable positions cannot claim a leader', () => {
  let source = createYutRoom({ id: 'test', code: 'AB2345', classId: 'test', classLabel: '', host: { uid: 'a', name: 'A' }, nowMs: 1000 });
  source = addYutPlayer(source, { uid: 'b', name: 'B' }, 1001);
  assert.deepEqual(getYutManagementProgress(source), { standings: [], leadingUids: [] });
  source = readyYutPlayer(source, 'b', true, 1002);
  source = startYutGame(source, 1003);
  assert.deepEqual(getYutManagementProgress(source).leadingUids, ['a', 'b']);
  assert.deepEqual(getYutManagementProgress(room([player('bad', [piece('unknown')])])), { standings: [], leadingUids: [] });
  assert.deepEqual(getYutManagementProgress(room([])), { standings: [], leadingUids: [] });
});
