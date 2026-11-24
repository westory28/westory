// Releases the committed firestore.rules when `firebase deploy --only
// firestore:rules` keeps failing on a transient 503 from the Rules service.
// It does what the CLI does, in the same order, and retries only that error:
//
//   1. the three predeploy suites of firebase.json (always, never skipped)
//   2. compile the committed file (HEAD:firestore.rules)
//   3. create the ruleset and point the cloud.firestore release at it
//   4. read the release back and compare it with the committed file
//
//   node scripts/release-firestore-rules.mjs check     steps 1-2, changes nothing
//   node scripts/release-firestore-rules.mjs release   steps 1-4
//
// The previous ruleset id is printed; pointing the release back at it undoes
// the change.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { accessToken } from './wispi-bonus-claim-release-cloud.mjs';

const mode = process.argv[2];
assert.ok(['check', 'release'].includes(mode), 'Choose check or release');
const project = 'history-quiz-yongsin';
const base = `https://firebaserules.googleapis.com/v1/projects/${project}`;
const releaseName = `projects/${project}/releases/cloud.firestore`;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 26 });

assert.equal(git('status', '--porcelain', '--', 'firestore.rules').trim(), '', 'Commit firestore.rules first');
const content = git('show', 'HEAD:firestore.rules');
const predeploy = JSON.parse(await fs.readFile('firebase.json', 'utf8')).firestore?.predeploy || [];
assert.ok(predeploy.length > 0 && predeploy.every((command) => /^npm run [a-z0-9:-]+$/.test(command)), 'Unexpected predeploy commands');
for (const command of predeploy) {
  const run = spawnSync(command, { shell: true, stdio: ['ignore', 'ignore', 'inherit'] });
  assert.equal(run.status, 0, `${command} failed; nothing was released`);
  console.log(JSON.stringify({ predeploy: command, passed: true }));
}

const token = await accessToken();
const call = async (label, url, init = {}) => {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
    if (response.ok) return response.json();
    const text = await response.text();
    if (response.status !== 503 || attempt === 8) throw new Error(`${label} failed: ${response.status} ${text.slice(0, 200)}`);
    console.log(JSON.stringify({ label, attempt, status: 503, retrying: true }));
    await new Promise((resolve) => setTimeout(resolve, 4000 * attempt));
  }
};
const source = { files: [{ name: 'firestore.rules', content }] };
const before = await call('read release', `${base}/releases/cloud.firestore`);
const compiled = await call('compile', `${base}:test`, { method: 'POST', body: JSON.stringify({ source }) });
const errors = (compiled.issues || []).filter((issue) => issue.severity === 'ERROR');
assert.deepEqual(errors, [], 'The rules do not compile');
const previousRuleset = before.rulesetName.split('/').pop();
console.log(JSON.stringify({ mode, previousRuleset, warnings: (compiled.issues || []).length, errors: 0, bytes: content.length }));
if (mode === 'release') {
  const ruleset = await call('create ruleset', `${base}/rulesets`, { method: 'POST', body: JSON.stringify({ source }) });
  await call('update release', `${base}/releases/cloud.firestore`, { method: 'PATCH', body: JSON.stringify({ release: { name: releaseName, rulesetName: ruleset.name } }) });
  const after = await call('read release', `${base}/releases/cloud.firestore`);
  const live = await call('read ruleset', `https://firebaserules.googleapis.com/v1/${after.rulesetName}`);
  assert.equal(live.source.files[0].content, content, 'The released rules differ from the committed file');
  console.log(JSON.stringify({ released: after.rulesetName.split('/').pop(), updated: after.updateTime, liveEqualsHead: true, previousRuleset }));
}
